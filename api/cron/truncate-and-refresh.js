// api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

export const config = {
  maxDuration: 60, // Node function limit on Vercel
};

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
  const r = await fetch(url, { cache: "no-store" });
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
    // -------- optional auth for cron ----------
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
    const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
    const teams = teamItems
      .map((t) => t?.team)
      .filter(Boolean)
      .map((t) => ({ id: t.id, slug: t.abbreviation || t.slug || t.name }));

    if (!teams.length) {
      return res.status(500).json({ ok: false, where: "teams-parse", error: "no teams found" });
    }

    // fetch each roster
    const rosterUrls = teams.map((t) => `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`);
    const rosterResults = await Promise.allSettled(rosterUrls.map((u) => fetchJson(u, `roster:${u}`)));

    // -------- 3) normalize & dedupe ----------
    const collected = [];
    rosterResults.forEach((r, idx) => {
      if (r.status !== "fulfilled") {
        console.warn("Roster fetch failed:", teams[idx]?.id, r.reason?.message || r.reason);
        return;
      }
      const data = r.value || {};
      const roster = data?.team?.athletes || []; // sometimes grouped by position
      // roster can be: [{ items: [players...] }, { items: [...] }] OR flat array
      const buckets = Array.isArray(roster) ? roster : [];
      for (const bucket of buckets) {
        const items = bucket?.items || bucket || [];
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          // ESPN item shape
          const pid = it?.id ?? it?.uid ?? null;
          const person = it?.athlete || it;
          const pos = person?.position?.abbreviation || person?.position?.name || person?.position || it?.position;
          const team = person?.team?.abbreviation || person?.team?.name || person?.team?.displayName || data?.team?.abbreviation;

          const espnId =
            person?.id ??
            person?.uid ??
            pid ??
            null;

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
            team: normTeam(team),
            espnId: espnId ? String(espnId) : null,
            // headshot from espnId; if roster had one, we could also use person.headshot.href
            photo: espnHeadshot(espnId),
            // compact fields we support downstream
            projections: {}, // none from this endpoint (future: add projection source if desired)
            matchups: {},    // none here
          };
          if (player.id) collected.push(player);
        }
      }
    });

    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
      // if needed, we could prefer ones that have espnId/headshot; here all should have espnId
    }
    const finalPlayers = Array.from(byIdent.values());
    const countReceived = finalPlayers.length;

    // -------- 4) write in chunks (new batch per chunk) ----------
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
      source: "espn:teams+rosters",
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res
      .status(500)
      .json({ ok: false, where: "truncate-and-refresh", error: String(e?.message || e) });
  }
}
