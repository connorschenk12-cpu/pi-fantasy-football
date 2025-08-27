// /api/stats/week.js
// Returns live/week player stats collapsed by player (PPR computed).
// Query: ?week=1&season=2025&seasontype=2
// Default: seasontype=2 (regular). We auto-detect current season if not provided.

const PPR = {
  passYds: 0.04,
  passTD: 4,
  passInt: -2,
  rushYds: 0.1,
  rushTD: 6,
  recYds: 0.1,
  recTD: 6,
  rec: 1,
  fumbles: -2,
};

function n(v) { return v == null ? 0 : Number(v) || 0; }

function computePoints(row) {
  return Math.round((
    n(row.passYds) * PPR.passYds +
    n(row.passTD) * PPR.passTD +
    n(row.passInt) * PPR.passInt +
    n(row.rushYds) * PPR.rushYds +
    n(row.rushTD) * PPR.rushTD +
    n(row.recYds) * PPR.recYds +
    n(row.recTD) * PPR.recTD +
    n(row.rec)    * PPR.rec +
    n(row.fumbles)* PPR.fumbles
  ) * 10) / 10;
}

/**
 * Normalize a single ESPN "boxscore player" into our compact stat row.
 * We key by multiple ids client-side already; here we expose:
 * - id: ESPN athlete id as string
 * - nameTeamKey: "NAME|TEAM" for extra matching (uppercased)
 */
function normalizePlayerStat(p, teamAbbr) {
  // ESPN offensive stats live under various aggregates; we unify the common ones.
  const athlete = p?.athlete;
  const id = athlete?.id != null ? String(athlete.id) : null;

  // Basic name
  const name = (athlete?.displayName || "").toUpperCase().trim();
  const team = (teamAbbr || athlete?.team?.abbreviation || "").toUpperCase().trim();
  const nameTeamKey = name && team ? `${name}|${team}` : null;

  // Split stats are arrays like [{name:"Passing Yards", abbreviation:"YDS", value: 245}, ...]
  // ESPN groups by categories (e.g., "passing", "rushing", "receiving", "fumbles")
  const cats = Array.isArray(p?.statistics) ? p.statistics : [];

  const grab = (groupName, abbr) => {
    const g = cats.find(c => (c?.name || "").toLowerCase() === groupName);
    if (!g || !Array.isArray(g?.stats)) return 0;
    const s = g.stats.find(s => (s?.shortDisplayName === abbr) || (s?.abbreviation === abbr) || (s?.name === abbr));
    return s?.value != null ? Number(s.value) : 0;
  };

  const passYds = grab("passing", "YDS");
  const passTD  = grab("passing", "TD");
  const passInt = grab("passing", "INT");

  const rushYds = grab("rushing", "YDS");
  const rushTD  = grab("rushing", "TD");

  const recYds  = grab("receiving", "YDS");
  const recTD   = grab("receiving", "TD");
  const rec     = grab("receiving", "REC");

  // fumbles are typically in "fumbles" group under "LOST"
  const fumbles = grab("fumbles", "LOST");

  const row = { passYds, passTD, passInt, rushYds, rushTD, recYds, recTD, rec, fumbles };
  return { id, nameTeamKey, ...row, points: computePoints(row) };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const weekParam = Number(url.searchParams.get("week"));
    const season = Number(url.searchParams.get("season")) || new Date().getFullYear();
    const seasontype = Number(url.searchParams.get("seasontype")) || 2; // 2=regular, 3=post

    if (!Number.isFinite(weekParam) || weekParam <= 0) {
      return res.status(400).json({ error: "week is required (e.g., ?week=3)" });
    }

    // 1) Get all games for the week
    const scoreboard = `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${weekParam}&seasontype=${seasontype}&season=${season}`;
    const sc = await fetch(scoreboard, { headers: { "x-espn-site-app": "sports" } });
    if (!sc.ok) return res.status(502).json({ error: "ESPN scoreboard fetch failed" });
    const scJson = await sc.json();

    // 2) For each competition (game), pull boxscore
    const events = Array.isArray(scJson?.events) ? scJson.events : [];
    const compIds = [];
    for (const e of events) {
      const comps = Array.isArray(e?.competitions) ? e.competitions : [];
      for (const c of comps) {
        if (c?.id) compIds.push(String(c.id));
      }
    }

    // If no games, return empty
    if (compIds.length === 0) return res.status(200).json({ stats: {} });

    // 3) Fetch boxscore per competition and accumulate player rows
    const statsById = new Map();
    const statsByNameTeam = new Map();

    await Promise.all(compIds.map(async (cid) => {
      const boxUrl = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/competitions/${cid}/boxscore`;
      const r = await fetch(boxUrl, { headers: { "x-espn-site-app": "sports" } });
      if (!r.ok) return;

      const json = await r.json();

      // boxscore.teams: two entries, each has team.abbreviation and statistics.players
      const teams = Array.isArray(json?.boxscore?.teams) ? json.boxscore.teams : [];
      for (const t of teams) {
        const teamAbbr = t?.team?.abbreviation || t?.team?.shortDisplayName;
        const players = Array.isArray(t?.statistics?.players) ? t.statistics.players : [];

        for (const player of players) {
          const norm = normalizePlayerStat(player, teamAbbr);
          if (!norm.id && !norm.nameTeamKey) continue;

          // Merge (some players appear in multiple categories across the same game)
          const applyMerge = (existing, add) => {
            const merged = {
              passYds: n(existing?.passYds) + n(add.passYds),
              passTD:  n(existing?.passTD)  + n(add.passTD),
              passInt: n(existing?.passInt) + n(add.passInt),
              rushYds: n(existing?.rushYds) + n(add.rushYds),
              rushTD:  n(existing?.rushTD)  + n(add.rushTD),
              recYds:  n(existing?.recYds)  + n(add.recYds),
              recTD:   n(existing?.recTD)   + n(add.recTD),
              rec:     n(existing?.rec)     + n(add.rec),
              fumbles: n(existing?.fumbles) + n(add.fumbles),
            };
            return { ...merged, points: computePoints(merged) };
          };

          if (norm.id) {
            const prev = statsById.get(norm.id);
            statsById.set(norm.id, applyMerge(prev, norm));
          }
          if (norm.nameTeamKey) {
            const prev = statsByNameTeam.get(norm.nameTeamKey);
            statsByNameTeam.set(norm.nameTeamKey, applyMerge(prev, norm));
          }
        }
      }
    }));

    // 4) Ship a hybrid object:
    //    - primary keys: ESPN athlete id
    //    - also include NAME|TEAM keys for the looser matching you added
    const out = {};
    for (const [id, row] of statsById.entries()) out[id] = row;
    for (const [key, row] of statsByNameTeam.entries()) {
      // Avoid clobbering ids if key looks numeric
      if (!out[key]) out[key] = row;
    }

    res.status(200).json({ stats: out });
  } catch (err) {
    console.error("week stats error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
