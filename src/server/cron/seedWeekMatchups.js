/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
// Seeds opponent matchups for a given week into each player doc.
// Tolerant to ESPN schedule gaps + throttles Firestore to avoid quota.

const SLEEP_MS = 120;          // tiny pause between batches
const BATCH_SIZE = 200;        // conservative writes per batch
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, label) {
  const r = await fetch(url, { headers: { "x-espn-site-app": "sports" }, cache: "no-store" });
  if (!r.ok) throw new Error(`${label} ${r.status}: ${await r.text()}`.slice(0, 500));
  return r.json();
}

function validInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function currentSeasonDefault() {
  const now = new Date();
  return now.getUTCFullYear(); // simple default; NFL season overlaps but good enough as a fallback
}

/** Try ESPN scoreboard with a few fallbacks (seasontype 2=regular, 1=pre, 3=post) */
async function loadScoreboardSmart({ week, season, seasontype }) {
  const seasonUse = validInt(season) || currentSeasonDefault();
  const weekUse = validInt(week);
  const typesToTry = [seasontype ? Number(seasontype) : 2, 1, 3]; // prefer requested/regular, then pre, then post

  if (!weekUse) throw new Error("week is required for matchups seeding");

  let lastErr = null;
  for (const st of typesToTry) {
    const url = `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${weekUse}&seasontype=${st}&season=${seasonUse}`;
    try {
      const json = await fetchJson(url, "scoreboard");
      if (Array.isArray(json?.events) && json.events.length > 0) {
        return { json, season: seasonUse, week: weekUse, seasontype: st };
      }
      // If response is OK but empty, try next seasontype.
    } catch (e) {
      lastErr = e;
      // 404 or 5xx — try next seasontype
    }
  }
  throw lastErr || new Error("No scoreboard data found for provided week/season.");
}

function collectOpponents(scoreboardJson) {
  // Map teamAbbr -> opponentAbbr for the week
  const opp = new Map();
  const evts = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
  for (const e of evts) {
    const comps = Array.isArray(e?.competitions) ? e.competitions : [];
    for (const c of comps) {
      const teams = Array.isArray(c?.competitors) ? c.competitors : [];
      if (teams.length !== 2) continue;
      const a = (teams[0]?.team?.abbreviation || teams[0]?.team?.shortDisplayName || "").toUpperCase();
      const b = (teams[1]?.team?.abbreviation || teams[1]?.team?.shortDisplayName || "").toUpperCase();
      if (!a || !b) continue;
      opp.set(a, b);
      opp.set(b, a);
    }
  }
  return opp;
}

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const isQuota = msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      if (!isQuota || attempt >= MAX_RETRIES) throw e;
      const delay = (200 + 200 * attempt);
      console.warn(`${label}: quota hit; retrying in ${delay}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

export async function seedWeekMatchups({ adminDb, week, season, seasontype } = {}) {
  // 1) get scoreboard (smart)
  const { json, week: wk, season: ssn, seasontype: st } =
    await withBackoff(() => loadScoreboardSmart({ week, season, seasontype }), "scoreboard");

  const oppMap = collectOpponents(json);
  if (oppMap.size === 0) {
    return { ok: true, updated: 0, reason: "no-games", week: wk, season: ssn, seasontype: st };
  }

  // 2) read all players (we only set opponent for teams we know)
  const playersSnap = await withBackoff(() => adminDb.collection("players").get(), "players-read");
  const docs = playersSnap.docs;

  // 3) write in small batches
  let updated = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = adminDb.batch();

    for (const d of chunk) {
      const p = d.data() || {};
      const team = (p.team || p.nflTeam || p.proTeam || "").toUpperCase();
      const opp = oppMap.get(team) || "";
      const matchups = { ...(p.matchups || {}) };
      matchups[String(wk)] = { ...(matchups[String(wk)] || {}), opp };

      batch.set(d.ref, { matchups }, { merge: true });
      updated += 1;
    }

    await withBackoff(() => batch.commit(), "players-write");
    await sleep(SLEEP_MS);
  }

  return { ok: true, updated, week: wk, season: ssn, seasontype: st };
}
