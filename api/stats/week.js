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

const n = (v) => (v == null ? 0 : Number(v) || 0);

function computePoints(row) {
  return Math.round(
    (
      n(row.passYds) * PPR.passYds +
      n(row.passTD) * PPR.passTD +
      n(row.passInt) * PPR.passInt +
      n(row.rushYds) * PPR.rushYds +
      n(row.rushTD) * PPR.rushTD +
      n(row.recYds) * PPR.recYds +
      n(row.recTD) * PPR.recTD +
      n(row.rec)    * PPR.rec +
      n(row.fumbles)* PPR.fumbles
    ) * 10
  ) / 10;
}

// Safe fetch that returns null on 404/empty instead of throwing
async function fetchJson(url, where) {
  const r = await fetch(url, { headers: { "x-espn-site-app": "sports" }, cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`fetch ${where} ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Normalize a single ESPN "boxscore player" into our compact stat row.
 * We key by:
 *  - id: ESPN athlete id as string
 *  - nameTeamKey: "NAME|TEAM" for looser matching
 */
function normalizePlayerStat(p, teamAbbr) {
  const athlete = p?.athlete || {};
  const id = athlete?.id != null ? String(athlete.id) : null;

  const name = (athlete?.displayName || "").toUpperCase().trim();
  const team = (teamAbbr || athlete?.team?.abbreviation || "").toUpperCase().trim();
  const nameTeamKey = name && team ? `${name}|${team}` : null;

  // stats groups come like: statistics: [{ name:'passing', stats:[{shortDisplayName:'YDS', value:...}, ...] }, ...]
  const cats = Array.isArray(p?.statistics) ? p.statistics : [];
  const grab = (groupName, abbr) => {
    const g = cats.find((c) => (c?.name || "").toLowerCase() === groupName);
    if (!g || !Array.isArray(g?.stats)) return 0;
    const s = g.stats.find(
      (s) =>
        s?.shortDisplayName === abbr ||
        s?.abbreviation === abbr ||
        s?.name === abbr
    );
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
      // For safety, return 200 with empty stats rather than 400 to avoid breaking clients
      return res.status(200).json({ stats: {} });
    }

    // Correct endpoint: /apis/site/v2/...
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${weekParam}&seasontype=${seasontype}&season=${season}`;
    const scJson = await fetchJson(scoreboardUrl, "scoreboard");

    // Off weeks or preseason gaps can 404 or return no events
    const events = Array.isArray(scJson?.events) ? scJson.events : [];
    if (!events.length) {
      return res.status(200).json({ stats: {} });
    }

    const compIds = [];
    for (const e of events) {
      const comps = Array.isArray(e?.competitions) ? e.competitions : [];
      for (const c of comps) if (c?.id) compIds.push(String(c.id));
    }
    if (!compIds.length) return res.status(200).json({ stats: {} });

    const statsById = new Map();
    const statsByNameTeam = new Map();

    // helper to merge category fragments
    const mergeRows = (a = {}, b = {}) => {
      const merged = {
        passYds: n(a.passYds) + n(b.passYds),
        passTD:  n(a.passTD)  + n(b.passTD),
        passInt: n(a.passInt) + n(b.passInt),
        rushYds: n(a.rushYds) + n(b.rushYds),
        rushTD:  n(a.rushTD)  + n(b.rushTD),
        recYds:  n(a.recYds)  + n(b.recYds),
        recTD:   n(a.recTD)   + n(b.recTD),
        rec:     n(a.rec)     + n(b.rec),
        fumbles: n(a.fumbles) + n(b.fumbles),
      };
      return { ...merged, points: computePoints(merged) };
    };

    await Promise.all(
      compIds.map(async (cid) => {
        const boxUrl = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/competitions/${cid}/boxscore`;
        const json = await fetchJson(boxUrl, `boxscore:${cid}`);
        if (!json) return;

        const teams = Array.isArray(json?.boxscore?.teams) ? json.boxscore.teams : [];
        for (const t of teams) {
          const teamAbbr = t?.team?.abbreviation || t?.team?.shortDisplayName || "";
          const players = Array.isArray(t?.statistics?.players) ? t.statistics.players : [];
          for (const player of players) {
            const norm = normalizePlayerStat(player, teamAbbr);
            if (!norm.id && !norm.nameTeamKey) continue;

            if (norm.id) {
              const prev = statsById.get(norm.id);
              statsById.set(norm.id, mergeRows(prev, norm));
            }
            if (norm.nameTeamKey) {
              const prev = statsByNameTeam.get(norm.nameTeamKey);
              statsByNameTeam.set(norm.nameTeamKey, mergeRows(prev, norm));
            }
          }
        }
      })
    );

    const out = {};
    for (const [id, row] of statsById.entries()) out[id] = row;
    for (const [key, row] of statsByNameTeam.entries()) {
      // Avoid clobbering if numeric
      if (!out[key]) out[key] = row;
    }

    res.status(200).json({ stats: out });
  } catch (err) {
    // Don’t 500 your app if ESPN is flaky — log and return empty.
    console.error("week stats error:", err);
    res.status(200).json({ stats: {} });
  }
}
