/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

/**
 * Build ESPN scoreboard URLs to try, in order.
 * 1) week+seasontype+season
 * 2) dates fallback (Thu..Tue window) if #1 had no events
 */
function buildScoreboardUrls({ season, week, datesRange = null }) {
  const urls = [];
  // canonical week/season (regular season = seasontype 2)
  if (season && week) {
    urls.push(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`
    );
  }
  // fallback by dates (ESPN accepts yyyymmdd or yyyymmdd-yyyymmdd)
  if (datesRange) {
    urls.push(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${datesRange}`
    );
  }
  return urls;
}

/** yyyy-mm-dd -> yyyymmdd */
function ymdCompact(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** For a given week anchor (Thursday), return Thu..Tue span */
function thursThroughTueRange(anchorDate) {
  // anchorDate should be the Thursday of the target week
  const start = new Date(anchorDate);
  const end = new Date(anchorDate);
  end.setDate(end.getDate() + 5); // Thu..Tue

  return `${ymdCompact(start)}-${ymdCompact(end)}`;
}

/**
 * Very light "opening week" anchor guesser:
 * For a given season (year), the NFL Week 1 Thursday is usually
 * the first Thursday after Labor Day. This picker chooses the
 * first Thursday in September >= Sep 5.
 */
function guessOpeningThursdayUTC(season) {
  const d = new Date(Date.UTC(season, 8, 5)); // Sep 5, <season> @ 00:00Z
  // advance to first Thursday (Thursday = 4 using getUTCDay)
  const day = d.getUTCDay();
  const delta = (4 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

/** Parse ESPN scoreboard JSON into simple [{home, away, date}] */
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

    const abbr = (t) =>
      (t?.team?.abbreviation ||
        t?.team?.shortDisplayName ||
        t?.team?.name ||
        "").toUpperCase();

    if (home && away) {
      out.push({ home: abbr(home), away: abbr(away), date });
    }
  }
  return out;
}

/** Batch write helper with gentle throttling */
async function commitInChunks(adminDb, writes, { chunk = 400, pauseMs = 60 } = {}) {
  let i = 0;
  let committed = 0;
  while (i < writes.length) {
    const batch = adminDb.batch();
    const slice = writes.slice(i, i + chunk);
    for (const fn of slice) fn(batch);
    await batch.commit();
    committed += slice.length;
    i += slice.length;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return committed;
}

/**
 * Seed week matchups: set players.{id}.matchups[week] = { opp, date }
 * For each game, every player on team HOME gets opp=AWAY, and vice versa.
 */
export async function seedWeekMatchups({
  adminDb,
  week = 1,
  season,
  limit,     // unused here; we do full write for the week
  cursor,    // unused here
  req,       // unused here
}) {
  if (!adminDb) throw new Error("adminDb required");
  if (!season || !week) throw new Error("season and week required");

  // 1) Try canonical week+season first
  const tryUrls = [];
  tryUrls.push(...buildScoreboardUrls({ season, week }));

  // 2) Fallback to a date span (Thu..Tue) if the first attempt yields no events.
  //    Guess opening Thursday for W1, otherwise offset from it.
  const openingThu = guessOpeningThursdayUTC(season);
  const thursdayOfWeek = new Date(openingThu);
  thursdayOfWeek.setUTCDate(openingThu.getUTCDate() + (week - 1) * 7);
  const datesRange = thursThroughTueRange(thursdayOfWeek);

  // Add fallback URL second
  tryUrls.push(...buildScoreboardUrls({ season, week, datesRange }));

  let games = [];
  let usedUrl = null;

  for (const u of tryUrls) {
    try {
      const json = await fetchJsonNoStore(u);
      const events = parseEvents(json);
      if (events.length) {
        games = events;
        usedUrl = u;
        break;
      }
    } catch (e) {
      console.warn("scoreboard fetch failed:", u, e?.message || e);
    }
  }

  if (!games.length) {
    return { ok: true, reason: "no-games", updated: 0, teams: 0 };
  }

  // 3) Build team->opponent map for this week
  const oppMap = new Map(); // teamAbbr -> { opp, date }
  for (const g of games) {
    oppMap.set(g.home, { opp: g.away, date: g.date || null });
    oppMap.set(g.away, { opp: g.home, date: g.date || null });
  }

  // 4) Write to all players for each team
  // players where team == abbr → set matchups[week] = {opp, date}
  const writes = [];
  const weekKey = String(week);

  for (const [team, meta] of oppMap.entries()) {
    const snap = await adminDb.collection("players").where("team", "==", team).get();
    if (snap.empty) continue;

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const matchups = { ...(data.matchups || {}) };
      matchups[weekKey] = {
        ...(matchups[weekKey] || {}),
        opp: meta.opp,
        date: meta.date || matchups[weekKey]?.date || null,
      };

      writes.push((batch) => {
        batch.set(doc.ref, { matchups }, { merge: true });
      });
    });
  }

  const updated = await commitInChunks(adminDb, writes, { chunk: 400, pauseMs: 50 });

  return {
    ok: true,
    reason: "updated",
    updated,
    teams: oppMap.size,
    url: usedUrl,
  };
}

export default seedWeekMatchups;
