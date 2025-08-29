// /api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = {
  maxDuration: 60,
};

// ESPN CORE endpoints (HAL-style; everything is $ref-based)
const TEAMS_CORE =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams?limit=1000";

// ---------- small helpers ----------
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

// Simple concurrency limiter
function mapLimit(items, limit, worker) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let i = 0;
    let active = 0;
    let done = 0;

    function next() {
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(worker(items[idx], idx))
          .then((val) => {
            results[idx] = val;
            active--;
            done++;
            if (done === items.length) resolve(results);
            else next();
          })
          .catch((err) => reject(err));
      }
    }
    if (items.length === 0) resolve(results);
    else next();
  });
}

// Fetch all pages for a Core API collection (has items + page.next.$ref)
async function fetchAllPages(startUrl, where) {
  let out = [];
  let next = startUrl;
  let guard = 0;
  while (next && guard < 100) {
    guard++;
    const json = await fetchJson(next, `${where}[page${guard}]`);
    const items = Array.isArray(json?.items) ? json.items : [];
    for (const it of items) {
      if (it?.$ref) out.push(it.$ref);
    }
    next = json?.page?.next?.$ref || null;
  }
  return out;
}

// identity: espnId > name|team|pos
function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export default async function handler(req, res) {
  const debug = {
    teamsFetched: 0,
    athleteCollectionsWalked: 0,
    athleteRefsSeen: 0,
    athleteDocsFetched: 0,
    collectedBeforeDedupe: 0,
    deleted: 0,
    written: 0,
    notes: [],
  };

  try {
    // 1) Fetch all teams from CORE
    const teamsIndex = await fetchJson(TEAMS_CORE, "teams-core");
    const teamRefs = Array.isArray(teamsIndex?.items)
      ? teamsIndex.items.map((x) => x?.$ref).filter(Boolean)
      : [];
    if (teamRefs.length === 0) {
      return res.status(500).json({ ok: false, where: "teams-core", error: "no team refs" });
    }

    // Pull each team doc (to get abbreviation + athletes link)
    const teams = await mapLimit(teamRefs, 8, async (ref) => {
      try {
        const t = await fetchJson(ref, "team-doc");
        // team abbreviation found directly; athletes collection ref at t.athletes.$ref
        const teamAbbr =
          t?.abbreviation || t?.shortDisplayName || t?.displayName || t?.name || null;
        const rosterUrl = t?.athletes?.$ref || null;
        if (!teamAbbr || !rosterUrl) return null;
        return { teamAbbr, rosterUrl };
      } catch (_) {
        return null;
      }
    });
    const validTeams = teams.filter(Boolean);
    debug.teamsFetched = validTeams.length;
    if (validTeams.length === 0) {
      return res.status(500).json({ ok: false, where: "teams-resolve", error: "no teams valid" });
    }

    // 2) For each team, walk the athletes collection (paginated) and collect athlete refs
    const rosterRefsByTeam = await mapLimit(validTeams, 8, async (t) => {
      try {
        const refs = await fetchAllPages(`${t.rosterUrl}?limit=400`, `athletes:${t.teamAbbr}`);
        debug.athleteCollectionsWalked += 1;
        debug.athleteRefsSeen += refs.length;
        return { teamAbbr: t.teamAbbr, refs };
      } catch (e) {
        debug.notes.push(`roster-walk-fail:${t.teamAbbr}`);
        return { teamAbbr: t.teamAbbr, refs: [] };
      }
    });

    // Flatten to [ { teamAbbr, ref } ... ]
    const athleteJobs = [];
    for (const row of rosterRefsByTeam) {
      for (const ref of row.refs) athleteJobs.push({ teamAbbr: row.teamAbbr, ref });
    }

    // 3) Fetch athlete docs (limit concurrency), normalize minimal player record
    const collected = [];
    await mapLimit(athleteJobs, 12, async (job) => {
      try {
        const a = await fetchJson(job.ref, "athlete-doc");
        debug.athleteDocsFetched += 1;

        const espnId = a?.id != null ? String(a.id) : null;

        // Try to get position abbreviation if present inline; if not, leave null
        const posAbbr =
          a?.position?.abbreviation ||
          a?.position?.abbrev || // just in case
          null;

        const player = {
          id: String(espnId || a?.uid || a?.slug || a?.guid || a?.displayName || "").trim(),
          name: displayName({ name: a?.displayName }),
          position: normPos(posAbbr),
          team: normTeam(job.teamAbbr),
          espnId,
          photo: espnHeadshot(espnId),
          projections: {}, // projections come from other sources; keep empty here
          matchups: {}, // not part of this import
        };

        if (player.id) collected.push(player);
      } catch (_) {
        // ignore single athlete failure
      }
    });

    debug.collectedBeforeDedupe = collected.length;

    // 4) Dedupe: espnId > name|team|pos
    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());

    // 5) Wipe & write (chunked)
    // wipe existing GLOBAL players
    const existingSnap = await adminDb.collection("players").get();
    const toDelete = existingSnap.docs.map((d) => d.ref);
    while (toDelete.length) {
      const chunk = toDelete.splice(0, 400);
      const batch = adminDb.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      debug.deleted += chunk.length;
    }

    // write new players
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
      debug.written += chunk.length;
      idx += chunk.length;
    }

    return res.status(200).json({
      ok: true,
      deleted: debug.deleted,
      written: debug.written,
      countReceived: finalPlayers.length,
      source: "espn:core teams+athletes (paginated)",
      debug,
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res
      .status(500)
      .json({ ok: false, where: "truncate-and-refresh", error: String(e?.message || e) });
  }
}
