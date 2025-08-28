// pages/api/players/espn.js
/* eslint-disable no-console */

// This route returns an array of normalized players shaped like:
// [{ id, name, team, position, espnId, photo, projections: { "1": 12.3, "2": ... }, matchups?: {...} }]
// It's designed to be consumed by /api/cron/refresh-players-espn.js -> seedPlayersToGlobal(players)

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

// ESPN Fantasy (undocumented) projections endpoint.
// We request by week (scoringPeriodId) and read "appliedTotal" per player for PPR points.
// If ESPN changes this, we still return the roster without projections.
const ESPN_FFL_PLAYERS = (season, scoringPeriodId) =>
  `https://site.web.api.espn.com/apis/fantasy/v2/games/ffl/seasons/${season}/players?scoringPeriodId=${scoringPeriodId}&view=players_wl`;

// --------- tiny helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function seasonForToday() {
  const now = new Date();
  const y = now.getUTCFullYear();
  // NFL season rolls in late summer; if it’s Jan–Apr we still want the same season as last fall
  // but leaving it simple: current year is fine for most of the year.
  return Number(process.env.NFL_SEASON || y);
}
function normalizePos(p) {
  const raw = String(p || "").toUpperCase();
  if (raw === "DST" || raw === "DEF") return "DEF";
  return raw;
}
function playerName(row) {
  return (
    row?.full_name ||
    (row?.first_name && row?.last_name ? `${row.first_name} ${row.last_name}` : null) ||
    row?.last_name ||
    row?.name ||
    ""
  );
}
function espnHeadshotUrl(espnId) {
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${String(espnId).replace(/[^\d]/g, "")}.png`;
}
function sleeperHeadshotUrl(sleeperId) {
  return `https://sleepercdn.com/content/nfl/players/full/${sleeperId}.jpg`;
}
function safeNum(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

// --------- ESPN projections pull (best-effort) ----------
async function fetchEspnWeekProjections(season, week, { retries = 2 } = {}) {
  const url = ESPN_FFL_PLAYERS(season, week);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`espn ${week} ${r.status}`);
      const j = await r.json();

      // Shape we expect:
      // j.players: [{ id, firstName, lastName, ... stats: [{ scoringPeriodId, appliedTotal, ...}] }, ...]
      const map = new Map();
      const arr = Array.isArray(j?.players) ? j.players : [];

      for (const row of arr) {
        const pid = row?.id ?? row?.player?.id;
        if (!pid) continue;

        // Find a stat line for that exact week
        const stats = row?.stats || row?.player?.stats || [];
        let points = 0;
        for (const s of stats) {
          if (s?.scoringPeriodId === week && (s.appliedTotal != null || s.appliedStatTotal != null)) {
            points = safeNum(s.appliedTotal ?? s.appliedStatTotal, 0);
            break;
          }
        }
        if (points != null) {
          map.set(String(pid), points);
        }
      }
      return map; // Map<espnId_String, points_Number>
    } catch (e) {
      if (attempt === retries) {
        console.warn(`ESPN projections week ${week} failed:`, e?.message || e);
        return new Map();
      }
      // small backoff
      await sleep(250 * (attempt + 1));
    }
  }
  return new Map();
}

// Pull weeks 1..W (default 18)
async function fetchAllEspnProjections(season, maxWeek = 18) {
  const out = Array.from({ length: maxWeek + 1 }, () => new Map()); // index by week
  for (let w = 1; w <= maxWeek; w++) {
    out[w] = await fetchEspnWeekProjections(season, w);
    // be nice to ESPN
    await sleep(120);
  }
  return out; // [Map(), Map(espnId->pts), ...] index by week number
}

// --------- handler ----------
export default async function handler(req, res) {
  try {
    const season = seasonForToday();
    const maxWeek = Number(process.env.NFL_WEEKS || 18);

    // 1) Base roster & ESPN ID from Sleeper (great coverage + keeps team/pos current)
    const r = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (!r.ok) {
      return res.status(502).json({ error: "Sleeper catalog fetch failed" });
    }
    const catalog = await r.json(); // object keyed by sleeper player_id

    const players = [];
    for (const [sleeperId, row] of Object.entries(catalog || {})) {
      // Filter to active-ish offensive + K/DEF
      const pos = normalizePos(row?.position);
      if (!pos || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(pos)) continue;

      const team = row?.team || row?.pro_team || null;
      const name = playerName(row).trim();
      if (!name) continue;

      const espnId = row?.espn_id ? String(row.espn_id) : null;

      // prefer ESPN headshot when espnId exists, else Sleeper fallback
      const photo = espnId ? espnHeadshotUrl(espnId) : sleeperHeadshotUrl(sleeperId);

      players.push({
        // Use Sleeper ID as canonical id in our DB (stable, stringy, unique)
        id: String(sleeperId),
        name,
        team,
        position: pos,
        espnId,
        photo,
        // projections: filled below
        projections: null,
      });
    }

    // 2) ESPN projections (optional but desired). If this fails, we still return players.
    let weeks = null;
    try {
      weeks = await fetchAllEspnProjections(season, maxWeek); // weeks[w] => Map(espnId -> pts)
    } catch (e) {
      console.warn("fetchAllEspnProjections failed, continuing without projections:", e?.message || e);
    }

    if (weeks) {
      // Build projections object per player: { "1": 12.3, ... }
      for (const p of players) {
        if (!p.espnId) continue;
        const proj = {};
        for (let w = 1; w <= maxWeek; w++) {
          const m = weeks[w];
          const pts = m?.get?.(String(p.espnId));
          if (pts != null) proj[String(w)] = safeNum(pts, 0);
        }
        if (Object.keys(proj).length > 0) {
          p.projections = proj;
        }
      }
    }

    // 3) Response
    // Set short cache headers so manual hits don't thump ESPN too hard.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ok: true, season, players });
  } catch (e) {
    console.error("players/espn error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
