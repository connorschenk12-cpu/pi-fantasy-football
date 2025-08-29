// api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

export const config = {
  maxDuration: 60,
};

const H = { "x-espn-site-app": "sports" };

function normPos(pos) {
  return String(pos || "").toUpperCase();
}
function normTeam(team) {
  return String(team || "").toUpperCase();
}
function displayName(p) {
  return (
    p.name ||
    p.fullName ||
    p.displayName ||
    (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
    String(p.id || "")
  );
}
function espnHeadshot(espnId) {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
}

async function fetchJson(url, where) {
  const r = await fetch(url, { cache: "no-store", headers: H });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`fetch failed @ ${where} (${r.status}) ${text}`.slice(0, 500));
  }
  return r.json();
}

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export default async function handler(req, res) {
  try {
    // -------- optional auth (leave env unset to disable) ----------
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // -------- 1) wipe existing GLOBAL players (chunked) ----------
    const existingSnap = await adminDb.collection("players").get();
    const toDelete = existingSnap.docs.map((d) => d.ref);
    let deleted = 0;

    while (toDelete.length) {
      const chunk = toDelete.splice(0, 400);
      const batch = adminDb.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      deleted += chunk.length;
    }

    // -------- 2) pull ESPN teams and rosters ----------
    const teamsJson = await fetchJson(TEAMS_URL, "teams");
    // Try a few shapes ESPN uses
    const teamItems =
      teamsJson?.sports?.[0]?.leagues?.[0]?.teams ??
      teamsJson?.leagues?.[0]?.teams ??
      teamsJson?.teams ??
      [];

    const teams = (Array.isArray(teamItems) ? teamItems : [])
      .map((t) => t?.team || t) // some items are { team: {...} }
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        abbr: t.abbreviation || t.slug || t.name,
      }))
      .filter((t) => t.id);

    if (!teams.length) {
      console.error("ESPN teams parse failed. Root keys seen:", Object.keys(teamsJson || {}));
      return res.status(500).json({ ok: false, where: "teams-parse", error: "no teams found" });
    }

    // Build roster URLs (use HTTPS)
    const rosterUrls = teams.map(
      (t) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
    );

    const rosterResults = await Promise.allSettled(
      rosterUrls.map((u) => fetchJson(u, `roster:${u}`))
    );

    // -------- 3) normalize & dedupe ----------
    let rosterFulfilled = 0;
    let rosterRejected = 0;
    const collected = [];

    rosterResults.forEach((r, idx) => {
      const teamMeta = teams[idx];
      if (r.status !== "fulfilled") {
        rosterRejected += 1;
        console.warn("Roster fetch failed:", teamMeta?.id, r.reason?.message || r.reason);
        return;
      }
      rosterFulfilled += 1;

      const data = r.value || {};
      // ESPN roster shape tends to be { team: { athletes: [ { items:[players...] }, ... ] } }
      const roster = data?.team?.athletes || data?.athletes || [];
      const buckets = Array.isArray(roster) ? roster : [];
      for (const bucket of buckets) {
        const items = bucket?.items || bucket || [];
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          const person = it?.athlete || it;
          const pos =
            person?.position?.abbreviation ||
            person?.position?.name ||
            person?.position ||
            it?.position;
          const abbr =
            person?.team?.abbreviation ||
            person?.team?.shortDisplayName ||
            person?.team?.name ||
            teamMeta?.abbr ||
            "";

          const espnId = person?.id ?? person?.uid ?? it?.id ?? it?.uid ?? null;

          const name =
            person?.displayName ||
            (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
            person?.name ||
            it?.displayName ||
            it?.name ||
            espnId;

          const player = {
            id: String(espnId || name || "").trim(),
            name: displayName({ name }),
            position: normPos(pos),
            team: normTeam(abbr),
            espnId: espnId ? String(espnId) : null,
            photo: espnHeadshot(espnId),
            projections: {},
            matchups: {},
          };
          if (player.id) collected.push(player);
        }
      }
    });

    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());
    const countReceived = finalPlayers.length;

    // -------- 4) write in chunks (NEW batch per chunk) ----------
    let written = 0;
    let idx = 0;
    while (idx < finalPlayers.length) {
      const chunk = finalPlayers.slice(idx, idx + 400);
      const batch = adminDb.batch();
      for (const raw of chunk) {
        const id = String(raw.id);
        const ref = adminDb.collection("players").doc(id);
        batch.set(
          ref,
          {
            id,
            name: raw.name,
            position: raw.position,
            team: raw.team,
            espnId: raw.espnId,
            photo: raw.photo,
            projections: raw.projections || {},
            matchups: raw.matchups || {},
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      written += chunk.length;
      idx += chunk.length;
    }

    return res.status(200).json({
      ok: true,
      deleted,
      written,
      countReceived,
      rosterFulfilled,
      rosterRejected,
      source: "espn:teams+rosters",
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res
      .status(500)
      .json({ ok: false, where: "truncate-and-refresh", error: String(e?.message || e) });
  }
}
