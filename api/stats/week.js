// /api/stats/week.js
/* eslint-disable no-console */

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
const points = (row) => Math.round((
  n(row.passYds) * PPR.passYds +
  n(row.passTD) * PPR.passTD +
  n(row.passInt) * PPR.passInt +
  n(row.rushYds) * PPR.rushYds +
  n(row.rushTD) * PPR.rushTD +
  n(row.recYds)  * PPR.recYds +
  n(row.recTD)   * PPR.recTD +
  n(row.rec)     * PPR.rec +
  n(row.fumbles) * PPR.fumbles
) * 10) / 10;

async function fetchJson(url, label) {
  const r = await fetch(url, { headers: { "x-espn-site-app": "sports" }, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${label} ${r.status}: ${t.slice(0,200)}`);
  }
  return r.json();
}

function normalizePlayerStat(p, teamAbbr) {
  const athlete = p?.athlete || {};
  const id = athlete?.id != null ? String(athlete.id) : null;

  const name = (athlete?.displayName || "").toUpperCase().trim();
  const team = (teamAbbr || athlete?.team?.abbreviation || "").toUpperCase().trim();
  const nameTeamKey = name && team ? `${name}|${team}` : null;

  const cats = Array.isArray(p?.statistics) ? p.statistics : [];
  const grab = (groupName, pred) => {
    const g = cats.find(c => (c?.name || "").toLowerCase() === groupName);
    if (!g || !Array.isArray(g?.stats)) return 0;
    const s = g.stats.find(s =>
      pred(s?.shortDisplayName) || pred(s?.abbreviation) || pred(s?.name)
    );
    return s?.value != null ? Number(s.value) : 0;
  };

  const passYds = grab("passing", v => v === "YDS");
  const passTD  = grab("passing", v => v === "TD");
  const passInt = grab("passing", v => v === "INT");

  const rushYds = grab("rushing", v => v === "YDS");
  const rushTD  = grab("rushing", v => v === "TD");

  const recYds  = grab("receiving", v => v === "YDS");
  const recTD   = grab("receiving", v => v === "TD");
  const rec     = grab("receiving", v => v === "REC");

  const fumbles = grab("fumbles", v => v === "LOST");

  const row = { passYds, passTD, passInt, rushYds, rushTD, recYds, recTD, rec, fumbles };
  return { id, nameTeamKey, ...row, points: points(row) };
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const week = url.searchParams.get("week");
    const season = Number(url.searchParams.get("season")) || new Date().getFullYear();
    const seasontype = Number(url.searchParams.get("seasontype")) || 2; // 2=regular

    // If week not provided, let ESPN pick the "current" week by omitting &week=
    const sbUrl = week
      ? `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&seasontype=${seasontype}&season=${season}`
      : `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&season=${season}`;

    const sb = await fetchJson(sbUrl, "scoreboard");
    const events = Array.isArray(sb?.events) ? sb.events : [];

    const compIds = [];
    for (const e of events) {
      const comps = Array.isArray(e?.competitions) ? e.competitions : [];
      for (const c of comps) if (c?.id) compIds.push(String(c.id));
    }
    if (compIds.length === 0) return res.status(200).json({ stats: {} });

    const statsById = new Map();
    const statsByNameTeam = new Map();

    const merge = (a, b) => {
      const m = {
        passYds: n(a?.passYds) + n(b.passYds),
        passTD:  n(a?.passTD)  + n(b.passTD),
        passInt: n(a?.passInt) + n(b.passInt),
        rushYds: n(a?.rushYds) + n(b.rushYds),
        rushTD:  n(a?.rushTD)  + n(b.rushTD),
        recYds:  n(a?.recYds)  + n(b.recYds),
        recTD:   n(a?.recTD)   + n(b.recTD),
        rec:     n(a?.rec)     + n(b.rec),
        fumbles: n(a?.fumbles) + n(b.fumbles),
      };
      return { ...m, points: points(m) };
    };

    await Promise.all(compIds.map(async (cid) => {
      const boxUrl = `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/competitions/${cid}/boxscore`;
      const j = await fetchJson(boxUrl, "boxscore");
      const teams = Array.isArray(j?.boxscore?.teams) ? j.boxscore.teams : [];
      for (const t of teams) {
        const teamAbbr = t?.team?.abbreviation || t?.team?.shortDisplayName;
        const players = Array.isArray(t?.statistics?.players) ? t.statistics.players : [];
        for (const player of players) {
          const norm = normalizePlayerStat(player, teamAbbr);
          if (!norm.id && !norm.nameTeamKey) continue;

          if (norm.id) {
            const prev = statsById.get(norm.id);
            statsById.set(norm.id, prev ? merge(prev, norm) : norm);
          }
          if (norm.nameTeamKey) {
            const prev = statsByNameTeam.get(norm.nameTeamKey);
            statsByNameTeam.set(norm.nameTeamKey, prev ? merge(prev, norm) : norm);
          }
        }
      }
    }));

    const out = {};
    for (const [id, row] of statsById.entries()) out[id] = row;
    for (const [key, row] of statsByNameTeam.entries()) if (!out[key]) out[key] = row;

    res.status(200).json({ stats: out });
  } catch (err) {
    console.error("week stats error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
