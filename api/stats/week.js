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
    throw new Error(`${label} ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * ESPN's NFL boxscore (from the /summary?event= endpoint) reports each stat
 * category as parallel arrays: `labels` (e.g. ["C/ATT","YDS","AVG","TD","INT",...])
 * and each athlete's `stats` (same-length array of string values in that order).
 * Some labels are combined values like "C/ATT" -> "18/27"; we split those we need.
 */
function statByLabel(category, label) {
  const labels = Array.isArray(category?.labels) ? category.labels : [];
  const idx = labels.findIndex((l) => (l || "").toUpperCase() === label);
  return idx;
}

function parseTeamBoxscore(teamEntry, out) {
  const teamAbbr = (teamEntry?.team?.abbreviation || teamEntry?.team?.shortDisplayName || "").toUpperCase().trim();
  const categories = Array.isArray(teamEntry?.statistics) ? teamEntry.statistics : [];

  const byCategoryName = {};
  for (const cat of categories) {
    const name = (cat?.name || "").toLowerCase();
    if (name) byCategoryName[name] = cat;
  }

  const collectFrom = (categoryName, wanted) => {
    const cat = byCategoryName[categoryName];
    if (!cat) return;
    const athletes = Array.isArray(cat?.athletes) ? cat.athletes : [];
    for (const a of athletes) {
      const athlete = a?.athlete || {};
      const id = athlete?.id != null ? String(athlete.id) : null;
      const name = (athlete?.displayName || "").toUpperCase().trim();
      const nameTeamKey = name && teamAbbr ? `${name}|${teamAbbr}` : null;
      if (!id && !nameTeamKey) continue;

      const key = id || nameTeamKey;
      if (!out[key]) {
        out[key] = { id, nameTeamKey, passYds: 0, passTD: 0, passInt: 0, rushYds: 0, rushTD: 0, recYds: 0, recTD: 0, rec: 0, fumbles: 0 };
      }
      const row = out[key];
      const stats = Array.isArray(a?.stats) ? a.stats : [];

      for (const [field, label, transform] of wanted) {
        const idx = statByLabel(cat, label);
        if (idx === -1) continue;
        const raw = stats[idx];
        row[field] = n(row[field]) + (transform ? transform(raw) : n(raw));
      }
    }
  };

  collectFrom("passing", [
    ["passYds", "YDS"],
    ["passTD", "TD"],
    ["passInt", "INT"],
  ]);
  collectFrom("rushing", [
    ["rushYds", "YDS"],
    ["rushTD", "TD"],
  ]);
  collectFrom("receiving", [
    ["recYds", "YDS"],
    ["recTD", "TD"],
    ["rec", "REC"],
  ]);
  collectFrom("fumbles", [
    ["fumbles", "LOST"],
  ]);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const week = url.searchParams.get("week");
    const season = Number(url.searchParams.get("season")) || new Date().getFullYear();
    const seasontype = Number(url.searchParams.get("seasontype")) || 2; // 2=regular

    // If week not provided, let ESPN pick the "current" week by omitting &week=
    const sbUrl = week
      ? `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&seasontype=${seasontype}&season=${season}`
      : `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&season=${season}`;

    const sb = await fetchJson(sbUrl, "scoreboard");
    const events = Array.isArray(sb?.events) ? sb.events : [];

    const eventIds = events.map((e) => e?.id).filter(Boolean).map(String);
    if (eventIds.length === 0) return res.status(200).json({ stats: {} });

    const merged = {};

    await Promise.all(eventIds.map(async (eventId) => {
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;
      let j;
      try {
        j = await fetchJson(summaryUrl, `summary(${eventId})`);
      } catch (e) {
        // Games that haven't started yet, or a transient ESPN error, shouldn't
        // take down the whole week's stats — skip just this game.
        console.warn(`Skipping event ${eventId}:`, e?.message || e);
        return;
      }
      const teamEntries = Array.isArray(j?.boxscore?.players) ? j.boxscore.players : [];
      for (const teamEntry of teamEntries) {
        parseTeamBoxscore(teamEntry, merged);
      }
    }));

    const out = {};
    for (const [key, row] of Object.entries(merged)) {
      const finalRow = { ...row, points: points(row) };
      if (row.id) out[row.id] = finalRow;
      if (row.nameTeamKey && !out[row.nameTeamKey]) out[row.nameTeamKey] = finalRow;
    }

    res.status(200).json({ stats: out });
  } catch (err) {
    console.error("week stats error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
