// api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

const CORE_TEAMS =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams?lang=en&region=us&limit=500";

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
    throw new Error(`fetch failed @ ${where} (${r.status}) ${text}`.slice(0, 400));
  }
  return r.json();
}

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

// simple concurrency limiter
async function pMap(items, limit, worker) {
  const ret = [];
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return ret;
}

export default async function handler(req, res) {
  const debug = {
    step: "start",
    teamsCount: 0,
    teamRefsFetched: 0,
    rosterCollectionsFetched: 0,
    rosterItemRefsSeen: 0,
    athleteDetailsFetched: 0,
    collectedBeforeDedupe: 0,
    deleted: 0,
    written: 0,
    notes: [],
    sampleTeams: [],
  };

  try {
    // Optional auth (leave CRON_SECRET unset to disable)
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // -------- 1) Get team list from Core API --------
    debug.step = "core-teams";
    const teamsRoot = await fetchJson(CORE_TEAMS, "core-teams-root");
    // teamsRoot.items -> [{ $ref: "…/teams/1" }, ...]
    const teamRefs = Array.isArray(teamsRoot?.items) ? teamsRoot.items.map((x) => x?.$ref).filter(Boolean) : [];
    debug.teamsCount = teamRefs.length;
    debug.sampleTeams = teamRefs.slice(0, 5);

    if (!teamRefs.length) {
      debug.notes.push("No team refs from Core API");
      return res.status(200).json({ ok: true, ...debug });
    }

    // -------- 2) Fetch each team doc (for abbreviation & id) --------
    const teamDocs = await pMap(teamRefs, 10, async (ref) => {
      try {
        const t = await fetchJson(ref, `team:${ref}`);
        debug.teamRefsFetched += 1;
        return {
          id: t?.id,
          abbr: t?.abbreviation || t?.shortDisplayName || t?.name || "",
          rosterUrl: t?.athletes?.$ref ? `${t.athletes.$ref}?limit=400` : null, // /teams/{id}/athletes
        };
      } catch (e) {
        debug.notes.push(`team-fetch-failed:${ref}`);
        return null;
      }
    });

    const teams = teamDocs.filter(Boolean).filter((t) => t.rosterUrl);
    if (!teams.length) {
      debug.notes.push("No team roster URLs");
      return res.status(200).json({ ok: true, ...debug });
    }

    // -------- 3) Fetch each team roster collection (athletes list) --------
    const rosterCollections = await pMap(teams, 8, async (t) => {
      try {
        const rc = await fetchJson(t.rosterUrl, `roster:${t.id}`);
        debug.rosterCollectionsFetched += 1;
        const athleteRefs = Array.isArray(rc?.items) ? rc.items.map((x) => x?.$ref).filter(Boolean) : [];
        debug.rosterItemRefsSeen += athleteRefs.length;
        return { team: t, refs: athleteRefs };
      } catch (e) {
        debug.notes.push(`roster-fetch-failed:${t.id}`);
        return { team: t, refs: [] };
      }
    });

    // Flatten athlete refs with their team abbr for context
    const athleteRefPairs = [];
    for (const rc of rosterCollections) {
      for (const ref of rc.refs) {
        athleteRefPairs.push({ ref, teamAbbr: rc.team.abbr });
      }
    }
    if (!athleteRefPairs.length) {
      debug.notes.push("No athlete refs");
      return res.status(200).json({ ok: true, ...debug });
    }

    // -------- 4) Fetch athlete detail for each ref (name, pos, team) --------
    const collected = [];
    await pMap(athleteRefPairs, 12, async ({ ref, teamAbbr }) => {
      try {
        const a = await fetchJson(ref, `athlete:${ref}`);
        debug.athleteDetailsFetched += 1;

        const espnId = a?.id ?? a?.uid ?? null;
        const name =
          a?.displayName ||
          (a?.firstName && a?.lastName ? `${a.firstName} ${a.lastName}` : null) ||
          a?.shortName ||
          a?.name ||
          espnId;

        // position can be nested
        const posAbbr =
          a?.position?.abbreviation ||
          a?.position?.name ||
          a?.position ||
          "";

        // team abbr sometimes present on a.team or from the parent context
        const team =
          a?.team?.abbreviation ||
          a?.team?.shortDisplayName ||
          teamAbbr ||
          "";

        const player = {
          id: String(espnId || name || "").trim(),
          name: displayName({ name }),
          position: normPos(posAbbr),
          team: normTeam(team),
          espnId: espnId ? String(espnId) : null,
          photo: espnHeadshot(espnId),
          projections: {},
          matchups: {},
        };

        if (player.id) collected.push(player);
      } catch (e) {
        // skip one athlete if it fails
      }
    });

    debug.collectedBeforeDedupe = collected.length;

    // -------- 5) De-dupe by (espnId) or (name|team|pos) --------
    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());
    const countReceived = finalPlayers.length;

    // -------- 6) Truncate + write (chunked, fresh batch each time) --------
    // delete existing
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

    // write new
    debug.step = "write-new";
    let written = 0, idx = 0;
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
      source: "espn:core-v2 teams + athletes",
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res
      .status(500)
      .json({ ok: false, where: debug.step || "unknown", error: String(e?.message || e), debug });
  }
}
