/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const ABBR_ALIASES = {
  // common alternates → canonical (ESPN) codes
  JAC: "JAX",
  ARZ: "ARI",
  NOR: "NO",
  NOP: "NO",
  GNB: "GB",
  KAN: "KC",
  SFO: "SF",
  TBB: "TB",
  WAS: "WSH",
  WFT: "WSH",
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
};

const canonAbbr = (a) => {
  if (!a) return "";
  const up = String(a).toUpperCase();
  return ABBR_ALIASES[up] || up;
};

function buildWeekUrl({ season, week }) {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`;
}

function parseEvents(json) {
  const leagues = json?.sports?.[0]?.leagues?.[0];
  const events = leagues?.events || json?.events || [];
  const out = [];

  for (const ev of events) {
    const comp = Array.isArray(ev?.competitions) ? ev.competitions[0] : null;
    const date = ev?.date || comp?.date || null;
    const teams = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = teams.find((t) => t?.homeAway === "home");
    const away = teams.find((t) => t?.homeAway === "away");
    if (home && away) {
      out.push({
        home: {
          id: String(home?.team?.id || ""),
          abbr: canonAbbr(home?.team?.abbreviation || home?.team?.shortDisplayName || home?.team?.name),
        },
        away: {
          id: String(away?.team?.id || ""),
          abbr: canonAbbr(away?.team?.abbreviation || away?.team?.shortDisplayName || away?.team?.name),
        },
        date,
      });
    }
  }
  return out;
}

async function commitInChunks(adminDb, writes, { chunk = 400, pauseMs = 50 } = {}) {
  let i = 0;
  while (i < writes.length) {
    const batch = adminDb.batch();
    const slice = writes.slice(i, i + chunk);
    for (const fn of slice) fn(batch);
    await batch.commit();
    i += slice.length;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
}

export async function seedWeekMatchups({
  adminDb,
  week = 1,
  season,
}) {
  if (!adminDb) throw new Error("adminDb required");
  if (!season || !week) throw new Error("season and week required");

  // map team id -> canonical abbr from the teams feed
  const teamsJson = await fetchJsonNoStore(TEAMS_URL);
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const idToAbbr = {};
  for (const t of teamItems) {
    const tt = t?.team;
    if (!tt) continue;
    idToAbbr[String(tt.id)] = canonAbbr(tt.abbreviation || tt.shortDisplayName || tt.name);
  }

  const url = buildWeekUrl({ season, week });
  const sb = await fetchJsonNoStore(url);
  const games = parseEvents(sb);
  if (!games.length) return { ok: true, reason: "no-games", updated: 0, teams: 0, url };

  // Build mappings
  const byTeamId = new Map();     // "134" -> { oppId, oppAbbr, date }
  const byAbbr = new Map();       // "KC"  -> { oppAbbr, date }
  for (const g of games) {
    const homeAbbr = idToAbbr[g.home.id] || g.home.abbr;
    const awayAbbr = idToAbbr[g.away.id] || g.away.abbr;

    byTeamId.set(g.home.id, { oppId: g.away.id, oppAbbr: awayAbbr, date: g.date });
    byTeamId.set(g.away.id, { oppId: g.home.id, oppAbbr: homeAbbr, date: g.date });

    byAbbr.set(homeAbbr, { oppAbbr: awayAbbr, date: g.date });
    byAbbr.set(awayAbbr, { oppAbbr: homeAbbr, date: g.date });
  }

  const weekKey = String(week);
  const writes = [];

  // Prefer joining by espnTeamId (exact), then fallback to team abbr
  for (const [tid, meta] of byTeamId.entries()) {
    // 1) by espnTeamId
    const q1 = await adminDb.collection("players").where("espnTeamId", "==", String(tid)).get();
    if (!q1.empty) {
      q1.forEach((doc) => {
        const data = doc.data() || {};
        const matchups = { ...(data.matchups || {}) };
        matchups[weekKey] = { ...(matchups[weekKey] || {}), opp: meta.oppAbbr, date: meta.date || null };
        writes.push((batch) => batch.set(doc.ref, { matchups }, { merge: true }));
      });
      continue;
    }

    // 2) fallback by abbr
    const abbr = idToAbbr[tid];
    if (!abbr) continue;
    const q2 = await adminDb.collection("players").where("team", "==", abbr).get();
    if (!q2.empty) {
      q2.forEach((doc) => {
        const data = doc.data() || {};
        const matchups = { ...(data.matchups || {}) };
        matchups[weekKey] = { ...(matchups[weekKey] || {}), opp: meta.oppAbbr, date: meta.date || null };
        writes.push((batch) => batch.set(doc.ref, { matchups }, { merge: true }));
      });
    }
  }

  await commitInChunks(adminDb, writes, { chunk: 400, pauseMs: 40 });

  return {
    ok: true,
    reason: "updated",
    updated: writes.length,
    teams: byTeamId.size,
    url,
  };
}

export default seedWeekMatchups;
