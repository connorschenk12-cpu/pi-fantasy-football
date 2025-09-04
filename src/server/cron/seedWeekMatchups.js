/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

/** Compact yyyy-mm-dd -> yyyymmdd */
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Guess Week 1 Thursday (first Thu on/after Sep 5) */
function guessOpeningThursdayUTC(season) {
  const d = new Date(Date.UTC(season, 8, 5)); // Sep 5 @ 00:00Z
  const delta = (4 - d.getUTCDay() + 7) % 7;  // Thu = 4
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

/** Thu..Tue window for a given NFL week */
function thursThroughTueRange(season, week) {
  const openingThu = guessOpeningThursdayUTC(season);
  const thu = new Date(openingThu);
  thu.setUTCDate(openingThu.getUTCDate() + (week - 1) * 7);
  const tue = new Date(thu);
  tue.setUTCDate(thu.getUTCDate() + 5);
  return `${ymd(thu)}-${ymd(tue)}`;
}

/** Build ESPN URLs to try in order */
function buildUrls({ season, week }) {
  const bust = `&_=${Date.now()}`;
  const u1 = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}${bust}`;
  const dates = thursThroughTueRange(season, week);
  const u2 = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dates}${bust}`;
  return [u1, u2];
}

/** Parse ESPN scoreboard -> [{home, away, date}] */
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
        "").toUpperCase().trim();
    if (home && away) out.push({ home: abbr(home), away: abbr(away), date });
  }
  return out;
}

/** Retry helper */
async function getWithRetries(url, { attempts = 3, baseDelayMs = 300 } = {}) {
  const headers = {
    "user-agent": "pi-fantasy-football/1.0 (+vercel)",
    accept: "application/json,*/*;q=0.9",
  };
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJsonNoStore(url, { headers, cache: "no-store" });
    } catch (e) {
      lastErr = e;
      const status = e?.status || 0;
      const transient = status >= 500 || status === 0;
      if (!transient) break; // don’t retry 4xx
      const delay = baseDelayMs * Math.pow(2, i) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error("fetch failed");
}

/** Commit batched writes politely */
async function commitInChunks(adminDb, fns, chunk = 400, pauseMs = 50) {
  let i = 0, total = 0;
  while (i < fns.length) {
    const batch = adminDb.batch();
    const slice = fns.slice(i, i + chunk);
    slice.forEach((fn) => fn(batch));
    await batch.commit();
    total += slice.length;
    i += slice.length;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return total;
}

export async function seedWeekMatchups({
  adminDb,
  week = 1,
  season,
}) {
  if (!adminDb) throw new Error("adminDb required");
  if (!season || !week) throw new Error("season and week required");

  const urls = buildUrls({ season, week });
  const errors = [];
  let games = [];
  let usedUrl = null;

  for (const u of urls) {
    try {
      const json = await getWithRetries(u, { attempts: 3, baseDelayMs: 350 });
      const events = parseEvents(json);
      if (events.length) {
        games = events;
        usedUrl = u;
        break;
      }
    } catch (e) {
      errors.push({ url: u, status: e?.status || 0, message: String(e?.message || e) });
      continue;
    }
  }

  if (!games.length) {
    // Graceful, non-throwing response so your API doesn’t 500
    return {
      ok: false,
      reason: "upstream-500-or-empty",
      tried: urls,
      errors,
    };
  }

  // team -> {opp, date}
  const opp = new Map();
  for (const g of games) {
    opp.set(g.home, { opp: g.away, date: g.date || null });
    opp.set(g.away, { opp: g.home, date: g.date || null });
  }

  const weekKey = String(week);
  const writes = [];

  // Update every player on each team with week opp/date
  for (const [team, meta] of opp.entries()) {
    const snap = await adminDb.collection("players").where("team", "==", team).get();
    if (snap.empty) continue;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const matchups = { ...(data.matchups || {}) };
      matchups[weekKey] = { ...(matchups[weekKey] || {}), opp: meta.opp, date: meta.date };
      writes.push((batch) => batch.set(doc.ref, { matchups }, { merge: true }));
    });
  }

  const updated = await commitInChunks(adminDb, writes, 400, 40);

  return {
    ok: true,
    reason: "updated",
    updated,
    teams: opp.size,
    url: usedUrl,
  };
}

export default seedWeekMatchups;
