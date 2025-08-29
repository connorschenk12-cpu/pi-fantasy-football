/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
// Builds a map TEAM -> OPPONENT from ESPN scoreboard for the given week,
// then stamps every player on that team with matchups[week].opp = OPP.
// Quota-safe (chunked + backoff) and 404-safe (no-games returns ok:true).

const BATCH_SIZE = 200;     // writes per commit
const SLEEP_MS   = 120;     // small pause between commits
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const quota = msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota");
      if (!quota || attempt >= MAX_RETRIES) throw e;
      const delay = 250 + attempt * 250;
      console.warn(`${label}: quota hit, retrying in ${delay}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

async function fetchJson(url, where) {
  const r = await fetch(url, { headers: { "x-espn-site-app": "sports" } });
  if (r.status === 404) {
    // ESPN returns 404 for weeks that don't exist; bubble a typed signal
    const body = await r.text().catch(() => "");
    const err = new Error(`scoreboard 404: ${body || "{code:404}"}`);
    err._is404 = true;
    throw err;
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${where} ${r.status}: ${body.slice(0, 400)}`);
  }
  return r.json();
}

export async function seedWeekMatchups({ adminDb, week, season, seasontype = 2 } = {}) {
  if (!adminDb) throw new Error("adminDb required");

  const w = Number(week);
  if (!Number.isFinite(w) || w <= 0) {
    return { ok: false, error: "week is required (?week=1..18)" };
  }
  const yr = Number(season) || new Date().getFullYear();
  const st = Number(seasontype) || 2; // 2 = regular

  const scoreboard = `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${w}&seasontype=${st}&season=${yr}`;

  let scJson;
  try {
    scJson = await fetchJson(scoreboard, "scoreboard");
  } catch (e) {
    if (e?._is404) {
      console.warn(`No games for week=${w} season=${yr} seasontype=${st}`);
      return { ok: true, reason: "no-games", updated: 0, teams: 0 };
    }
    throw e;
  }

  const events = Array.isArray(scJson?.events) ? scJson.events : [];
  if (events.length === 0) {
    return { ok: true, reason: "no-games", updated: 0, teams: 0 };
  }

  // Build TEAM -> OPP map (both directions)
  const teamOpp = new Map(); // "BUF" -> "NYJ"
  for (const e of events) {
    const comps = Array.isArray(e?.competitions) ? e.competitions : [];
    for (const c of comps) {
      const competitors = Array.isArray(c?.competitors) ? c.competitors : [];
      if (competitors.length !== 2) continue;
      const a = competitors[0]?.team?.abbreviation || competitors[0]?.team?.shortDisplayName;
      const b = competitors[1]?.team?.abbreviation || competitors[1]?.team?.shortDisplayName;
      const A = (a || "").toUpperCase();
      const B = (b || "").toUpperCase();
      if (A && B) {
        teamOpp.set(A, B);
        teamOpp.set(B, A);
      }
    }
  }

  if (teamOpp.size === 0) {
    return { ok: true, reason: "parsed-zero", updated: 0, teams: 0 };
  }

  // Load all players once (simplest & avoids 'in' query limits)
  const allSnap = await withBackoff(() => adminDb.collection("players").get(), "players-read");
  const docs = allSnap.docs;

  // Prepare patches for players whose team is in the map
  const fieldKey = `matchups.${w}`;
  const toPatch = [];
  for (const d of docs) {
    const p = d.data() || {};
    const team = String(p.team || p.nflTeam || p.proTeam || "").toUpperCase();
    const opp = teamOpp.get(team);
    if (!opp) continue;
    toPatch.push({ ref: d.ref, patch: { [fieldKey]: { ...(p.matchups?.[w] || {}), opp } } });
  }

  // Apply in batches
  let updated = 0;
  for (let i = 0; i < toPatch.length; i += BATCH_SIZE) {
    const chunk = toPatch.slice(i, i + BATCH_SIZE);
    const batch = adminDb.batch();
    for (const { ref, patch } of chunk) {
      batch.set(ref, patch, { merge: true });
      updated += 1;
    }
    await withBackoff(() => batch.commit(), "matchups-write");
    await sleep(SLEEP_MS);
  }

  return { ok: true, week: w, season: yr, teams: teamOpp.size, updated };
}
