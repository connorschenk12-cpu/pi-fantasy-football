// /api/cron/truncate-and-refresh.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

const CORE_TEAMS =
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams?limit=1000";

// Fallback site API
const SITE_TEAM = (id) =>
  `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}?enable=roster`;
const SITE_TEAMS =
  "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

// --------- tiny utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(url, where, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
      }
      return await r.json();
    } catch (e) {
      last = e;
      await sleep(150 * (i + 1));
    }
  }
  throw new Error(`fetch failed @ ${where}: ${String(last?.message || last)}`);
}

function normPos(x) { return String(x || "").toUpperCase(); }
function normTeam(x) { return String(x || "").toUpperCase(); }
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
function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}
function mapLimit(items, limit, worker) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let i = 0, active = 0, done = 0;
    function next() {
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(worker(items[idx], idx))
          .then((val) => { results[idx] = val; active--; done++; done === items.length ? resolve(results) : next(); })
          .catch(reject);
      }
    }
    items.length ? next() : resolve(results);
  });
}

// --------- Core collection walker (HAL) ----------
async function fetchAllRefs(startUrl, where) {
  const out = [];
  let url = startUrl;
  let guard = 0;
  while (url && guard < 120) {
    guard++;
    const json = await fetchJson(url, `${where}[page${guard}]`);
    const items = Array.isArray(json?.items) ? json.items : [];
    for (const it of items) {
      // Some collections expose $ref, some expose href, some wrap under athlete.$ref
      const ref = it?.$ref || it?.href || it?.athlete?.$ref || it?.athlete?.href || null;
      if (ref) out.push(ref);
    }
    url = json?.page?.next?.$ref || json?.page?.next?.href || null;
  }
  return out;
}

// Resolve position abbreviation if only a $ref is present
async function resolvePositionAbbr(a) {
  try {
    const pRef = a?.position?.$ref || a?.position?.href || null;
    if (!pRef) return a?.position?.abbreviation || a?.position?.abbrev || null;
    const p = await fetchJson(pRef, "position-ref");
    return p?.abbreviation || p?.abbrev || null;
  } catch {
    return a?.position?.abbreviation || a?.position?.abbrev || null;
  }
}

// --------- MAIN handler ----------
export default async function handler(req, res) {
  const debug = {
    core: { teamRefs: 0, teamsOk: 0, athleteCollections: 0, athleteRefs: 0, athleteDocs: 0 },
    site: { teams: 0, rosterPlayers: 0 },
    collectedBeforeDedupe: 0,
    deleted: 0,
    written: 0,
    notes: [],
  };

  try {
    // 1) CORE: teams -> athletes (paginated) -> athlete docs
    const teamsIndex = await fetchJson(CORE_TEAMS, "core-teams");
    const teamRefs = Array.isArray(teamsIndex?.items)
      ? teamsIndex.items.map((x) => x?.$ref || x?.href).filter(Boolean)
      : [];
    debug.core.teamRefs = teamRefs.length;

    const coreTeams = await mapLimit(teamRefs, 8, async (ref) => {
      try {
        const t = await fetchJson(ref, "core-team");
        const abbr = t?.abbreviation || t?.shortDisplayName || t?.displayName || t?.name || null;
        const athletesUrl = t?.athletes?.$ref || t?.athletes?.href || null;
        if (!abbr || !athletesUrl) return null;
        return { abbr, athletesUrl: `${athletesUrl}?limit=400` };
      } catch {
        return null;
      }
    });
    const validCoreTeams = coreTeams.filter(Boolean);
    debug.core.teamsOk = validCoreTeams.length;

    const perTeamRefs = await mapLimit(validCoreTeams, 8, async (t) => {
      try {
        const refs = await fetchAllRefs(t.athletesUrl, `core-athletes:${t.abbr}`);
        return { abbr: t.abbr, refs };
      } catch (e) {
        debug.notes.push(`core-athletes-fail:${t.abbr}`);
        return { abbr: t.abbr, refs: [] };
      }
    });

    let athleteJobs = [];
    for (const row of perTeamRefs) {
      debug.core.athleteCollections += 1;
      debug.core.athleteRefs += row.refs.length;
      for (const ref of row.refs) athleteJobs.push({ teamAbbr: row.abbr, ref });
    }

    const collected = [];

    await mapLimit(athleteJobs, 12, async (job) => {
      try {
        const a = await fetchJson(job.ref, "core-athlete");
        debug.core.athleteDocs += 1;

        const espnId = a?.id != null ? String(a.id) : null;
        let posAbbr = a?.position?.abbreviation || a?.position?.abbrev || null;
        if (!posAbbr) posAbbr = await resolvePositionAbbr(a);

        const player = {
          id: String(espnId || a?.uid || a?.slug || a?.guid || a?.displayName || "").trim(),
          name: displayName({ name: a?.displayName }),
          position: normPos(posAbbr),
          team: normTeam(job.teamAbbr),
          espnId,
          photo: espnHeadshot(espnId),
          projections: {},
          matchups: {},
        };
        if (player.id) collected.push(player);
      } catch {
        // skip this athlete
      }
    });

    // 2) If Core looks too small, also merge Site API rosters (teams -> ?enable=roster)
    if (collected.length < 1200) {
      try {
        const siteTeams = await fetchJson(SITE_TEAMS, "site-teams");
        const items = Array.isArray(siteTeams?.sports?.[0]?.leagues?.[0]?.teams)
          ? siteTeams.sports[0].leagues[0].teams
          : [];
        const siteTeamIds = items
          .map((t) => t?.team?.id)
          .filter(Boolean)
          .map(String);
        debug.site.teams = siteTeamIds.length;

        await mapLimit(siteTeamIds, 8, async (tid) => {
          try {
            const data = await fetchJson(SITE_TEAM(tid), `site-roster:${tid}`);
            const teamAbbr =
              data?.team?.abbreviation || data?.team?.shortDisplayName || data?.team?.name || "";
            const roster = Array.isArray(data?.team?.athletes) ? data.team.athletes : [];
            // roster may be buckets: [{position, items:[...]}, ...] OR flat
            for (const bucket of roster) {
              const items = Array.isArray(bucket?.items) ? bucket.items : Array.isArray(roster) ? roster : [];
              for (const it of items) {
                const person = it?.athlete || it;
                const espnId = person?.id != null ? String(person.id) : null;
                const pos =
                  person?.position?.abbreviation || person?.position?.name || it?.position || null;
                const p = {
                  id: String(espnId || person?.uid || person?.displayName || "").trim(),
                  name: displayName({ name: person?.displayName }),
                  position: normPos(pos),
                  team: normTeam(teamAbbr),
                  espnId,
                  photo: espnHeadshot(espnId),
                  projections: {},
                  matchups: {},
                };
                if (p.id) {
                  collected.push(p);
                  debug.site.rosterPlayers += 1;
                }
              }
              // If this bucket was actually a player object, break
              if (!Array.isArray(bucket?.items)) break;
            }
          } catch {
            // skip one team
          }
        });
      } catch (e) {
        debug.notes.push(`site-fallback-failed:${String(e?.message || e)}`);
      }
    }

    debug.collectedBeforeDedupe = collected.length;

    // 3) Dedupe (espnId > name|team|pos)
    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());

    // 4) Wipe & write (400-doc chunks)
    const existingSnap = await adminDb.collection("players").get();
    const toDelete = existingSnap.docs.map((d) => d.ref);
    while (toDelete.length) {
      const chunk = toDelete.splice(0, 400);
      const batch = adminDb.batch();
      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
      debug.deleted += chunk.length;
    }

    let i = 0;
    while (i < finalPlayers.length) {
      const chunk = finalPlayers.slice(i, i + 400);
      const batch = adminDb.batch();
      for (const raw of chunk) {
        const ref = adminDb.collection("players").doc(String(raw.id));
        batch.set(
          ref,
          {
            id: String(raw.id),
            name: raw.name,
            position: raw.position || null,
            team: raw.team || null,
            espnId: raw.espnId || null,
            photo: raw.photo || null,
            projections: raw.projections || {},
            matchups: raw.matchups || {},
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      debug.written += chunk.length;
      i += chunk.length;
    }

    return res.status(200).json({
      ok: true,
      deleted: debug.deleted,
      written: debug.written,
      countReceived: finalPlayers.length,
      source:
        collected.length < 1200
          ? "espn:core teams+athletes (paginated) + site fallback"
          : "espn:core teams+athletes (paginated)",
      debug,
    });
  } catch (e) {
    console.error("truncate-and-refresh fatal:", e);
    return res.status(500).json({
      ok: false,
      where: "truncate-and-refresh",
      error: String(e?.message || e),
    });
  }
}
