// /api/stats/week.js
// Returns live/week player stats collapsed by player (PPR computed).
// Query: ?week=1&season=2025&seasontype=2 (defaults: season=current year, seasontype=2 regular)

export const config = {
  maxDuration: 60, // give the function enough time on Vercel
};

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

/** Tiny retry helper for flaky ESPN calls */
async function fetchJson(url, where, tries = 2) {
  let lastErr;
  for (let i = 0; i < Math.max(1, tries); i++) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        headers: { "x-espn-site-app": "sports" },
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`fetch ${where} ${r.status}: ${t.slice(0, 200)}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      // brief jittered backoff
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 150 + Math.random() * 250));
    }
  }
  throw lastErr || new Error(`fetch failed @ ${where}`);
}

/**
 * Normalize a single ESPN "boxscore player" into our compact stat row.
 * Emits:
 *  - id: ESPN athlete id (string)
 *  - nameTeamKey: "NAME|TEAM" (uppercased) for loose matching
 */
function normalizePlayerStat(p, teamAbbr) {
  const athlete = p?.athlete;
  const id = athlete?.id != null ? String(athlete.id) : null;

  const name = (athlete?.displayName || "").toUpperCase().trim();
  const team = (teamAbbr || athlete?.team?.abbreviation || "").toUpperCase().trim();
  const nameTeamKey = name && team ? `${name}|${team}` : null;

  const cats = Array.isArray(p?.statistics) ? p.statistics : [];

  const grab = (groupName, abbr) => {
    const g = cats.find(c => (c?.name || "").toLowerCase() === groupName);
    if (!g || !Array.isArray(g?.stats)) return 0;
    const s = g.stats.find(s =>
      s?.shortDisplayName === abbr || s?.abbreviation === abbr || s?.name === abbr
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
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);

    const weekParam = Number(url.searchParams.get("week"));
    const season = Number(url.searchParams.get("season")) || new Date().getFullYear();
    let seasontype = Number(url.searchParams.get("seasontype"));
    seasontype = [1, 2, 3].includes(seasontype) ? seasontype : 2; // 1=pre, 2=reg, 3=post

    if (!Number.isFinite(weekParam) || weekParam <= 0) {
      return res.status(400).json({ error: "week is required (e.g., ?week=3)" });
    }

    // 1) Scoreboard for the requested week
    const sbUrl = `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${weekParam}&seasontype=${seasontype}&season=${season}`;
    const scJson = await fetchJson(sbUrl, "scoreboard");

    const events = Array.isArray(scJson?.events) ? scJson.events : [];
    const compIds = [];
    for (const e of events) {
      const comps = Array.isArray(e?.competitions) ? e.competitions : [];
      for (const c of comps) if (c?.id) compIds.push(String(c.id));
    }

    if (compIds.length === 0) return res.status(200).json({ stats: {} });

    // 2) Fetch boxscore per game and accumulate rows
    const statsById = new Map();
    const statsByNameTeam = new Map();

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

    await Promise.all(compIds.map(async (cid) => {
      const boxUrl = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/competitions/${cid}/boxscore`;
      let json;
      try {
        json = await fetchJson(boxUrl, `boxscore:${cid}`);
      } catch {
        return; // skip game if boxscore fails
      }

      const teams = Array.isArray(json?.boxscore?.teams) ? json.boxscore.teams : [];
      for (const t of teams) {
        const teamAbbr = t?.team?.abbreviation || t?.team?.shortDisplayName;
        const players = Array.isArray(t?.statistics?.players) ? t.statistics.players : [];

        for (const player of players) {
          const norm = normalizePlayerStat(player, teamAbbr);
          if (!norm.id && !norm.nameTeamKey) continue;

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

    // 3) Output: primary by ESPN athlete id, plus NAME|TEAM keys for looser matching
    const out = {};
    for (const [id, row] of statsById.entries()) out[id] = row;
    for (const [key, row] of statsByNameTeam.entries()) {
      if (!(key in out)) out[key] = row; // don't overwrite numeric ids
    }

    res.status(200).json({ stats: out });
  } catch (err) {
    console.error("week stats error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
