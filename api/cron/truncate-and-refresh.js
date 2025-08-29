// api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

const H = { "x-espn-site-app": "sports" };
const TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?lang=en&region=us";

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
  const debug = {
    step: "start",
    teamsCount: 0,
    rosterFulfilled: 0,
    rosterRejected: 0,
    sampleTeamIds: [],
    sampleTeamAbbrs: [],
    sampleRosterBucketsSeen: 0,
    collectedBeforeDedupe: 0,
    deleted: 0,
    written: 0,
  };

  try {
    // Optional auth (leave CRON_SECRET unset to disable)
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 1) Pull ESPN teams (HTTPS + lang/region) and parse
    debug.step = "fetch-teams";
    const teamsJson = await fetchJson(TEAMS_URL, "teams");

    // ESPN uses a few shapes over time; try all:
    const teamItems =
      teamsJson?.sports?.[0]?.leagues?.[0]?.teams ??
      teamsJson?.leagues?.[0]?.teams ??
      teamsJson?.teams ??
      [];

    const teams = (Array.isArray(teamItems) ? teamItems : [])
      .map((t) => t?.team || t)
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        abbr: t.abbreviation || t.slug || t.name,
      }))
      .filter((t) => t.id);

    debug.teamsCount = teams.length;
    debug.sampleTeamIds = teams.slice(0, 6).map((t) => t.id);
    debug.sampleTeamAbbrs = teams.slice(0, 6).map((t) => t.abbr);

    if (!teams.length) {
      console.error("ESPN teams parse failed. root keys:", Object.keys(teamsJson || {}));
      return res.status(200).json({ ok: true, ...debug, note: "no-teams-parsed" });
    }

    // 2) Build roster URLs (HTTPS + lang/region)
    const rosterUrls = teams.map(
      (t) =>
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster&lang=en&region=us`
    );

    const rosterResults = await Promise.allSettled(
      rosterUrls.map((u) => fetchJson(u, `roster:${u}`))
    );

    // 3) Normalize
    const collected = [];
    for (let i = 0; i < rosterResults.length; i++) {
      const r = rosterResults[i];
      if (r.status !== "fulfilled") {
        debug.rosterRejected += 1;
        console.warn("Roster fetch failed:", teams[i]?.id, r.reason?.message || r.reason);
        continue;
      }
      debug.rosterFulfilled += 1;

      const data = r.value || {};
      // Most common: { team: { athletes: [ { items:[...] }, ... ] } }
      const roster =
        data?.team?.athletes ??
        data?.athletes ??
        data?.roster ??
        [];
      const buckets = Array.isArray(roster) ? roster : [];
      debug.sampleRosterBucketsSeen += buckets.length;

      for (const bucket of buckets) {
        // bucket can be { position:..., items:[...] } OR already the items array
        const items = Array.isArray(bucket?.items) ? bucket.items : (Array.isArray(bucket) ? bucket : []);
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
            teams[i]?.abbr ||
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
    }

    debug.collectedBeforeDedupe = collected.length;

    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());
    const countReceived = finalPlayers.length;

    // 4) Wipe existing (if any) and write new (fresh batch per chunk)
    debug.step = "delete-old";
    const existingSnap = await adminDb.collection("players").get();
    const toDelete = existingSnap.docs.map((d) => d.ref);
    while (toDelete.length) {
      const chunk = toDelete.splice(0, 400);
      const batch = adminDb.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      debug.deleted += chunk.length;
    }

    debug.step = "write-new";
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
    debug.written = written;

    return res.status(200).json({
      ok: true,
      ...debug,
      countReceived,
      source: "espn:teams+rosters",
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res
      .status(500)
      .json({ ok: false, where: debug.step || "unknown", error: String(e?.message || e), debug });
  }
}
