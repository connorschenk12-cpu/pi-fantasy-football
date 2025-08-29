// src/server/cron/seedWeekMatchups.js
/* eslint-disable no-console */

// Small pacing helpers to stay under quota
const WRITE_CHUNK = 250;   // docs per batch
const PAUSE_MS    = 250;   // pause between batches
const SLOW_MS     = 60;    // between HTTP calls

const ESPN_BASE = "https://site.api.espn.com/apis/v2/sports/football/nfl";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, where, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        headers: { "user-agent": "fantasy-cron/1.0", "x-espn-site-app": "sports" },
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${where} ${r.status}: ${text.slice(0, 160)}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(250 * i);
    }
  }
  throw lastErr;
}

function normTeam(x) {
  return String(x || "").toUpperCase();
}

/**
 * Build a map of TEAM -> OPPONENT for a given week from the ESPN scoreboard.
 */
async function opponentMapForWeek({ week, season, seasontype = 2 }) {
  const url = `${ESPN_BASE}/scoreboard?week=${week}&seasontype=${seasontype}&season=${season}`;
  const sc = await fetchJson(url, "scoreboard");
  const events = Array.isArray(sc?.events) ? sc.events : [];
  const map = new Map();

  for (const e of events) {
    const comps = Array.isArray(e?.competitions) ? e.competitions : [];
    for (const c of comps) {
      const cmps = Array.isArray(c?.competitors) ? c.competitors : [];
      if (cmps.length !== 2) continue;
      const a = cmps[0]?.team?.abbreviation || cmps[0]?.team?.shortDisplayName;
      const b = cmps[1]?.team?.abbreviation || cmps[1]?.team?.shortDisplayName;
      if (!a || !b) continue;
      map.set(normTeam(a), normTeam(b));
      map.set(normTeam(b), normTeam(a));
    }
  }
  return map;
}

/**
 * Writes matchups[week] = { opp } for every player whose team is in the opponent map.
 * Does not touch other weeks; merges in place.
 */
export async function seedWeekMatchups({ adminDb, week, season }) {
  const W = Number(week || 1);
  const Y = Number(season || new Date().getFullYear());

  // 1) Build TEAM->OPP map
  const oppMap = await opponentMapForWeek({ week: W, season: Y, seasontype: 2 });

  // If no games parsed, avoid spamming writes—bail with note
  if (oppMap.size === 0) {
    return { ok: true, note: "No games parsed for that week/season.", week: W, season: Y, updated: 0 };
  }

  // 2) Load all players once
  const snap = await adminDb.collection("players").get();
  const players = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3) Prepare throttled updates
  let updated = 0;
  let idx = 0;

  while (idx < players.length) {
    const chunk = players.slice(idx, idx + WRITE_CHUNK);
    const batch = adminDb.batch();

    for (const p of chunk) {
      const team = normTeam(p.team || p.nflTeam || p.proTeam);
      const opp  = oppMap.get(team) || "";

      // Nothing to write if we don't know the opponent
      if (!opp) continue;

      // Merge existing matchups
      const existing = (p.matchups && typeof p.matchups === "object") ? p.matchups : {};
      const next = { ...existing, [String(W)]: { ...(existing[String(W)] || {}), opp } };

      const ref = adminDb.collection("players").doc(String(p.id));
      batch.set(ref, { matchups: next, updatedAt: new Date() }, { merge: true });
      updated += 1;
    }

    await batch.commit();
    idx += chunk.length;
    await sleep(PAUSE_MS);
  }

  return { ok: true, week: W, season: Y, updated };
}
