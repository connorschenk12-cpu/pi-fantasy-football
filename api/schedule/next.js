// /api/schedule/next.js
// Returns a simple map: { "SF": { week, kickoff, opponent }, ... }
function nflSeasonYear() {
  const now = new Date();
  // NFL regular season spans year boundaries; adjust if needed.
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function handler(req, res) {
  const season = Number(req.query.season || nflSeasonYear());
  const url = `https://api.sleeper.app/schedule/nfl/regular/${season}`;

  let map = {};
  try {
    const r = await fetch(url, { next: { revalidate: 3600 } });
    const weeks = await r.json(); // [{ week, games: [{ home, away, start_time }]} ...]
    const now = Date.now();

    // For each team, find the next game in the future
    for (const w of weeks || []) {
      for (const g of w.games || []) {
        const kick = g.start_time ? new Date(g.start_time).getTime() : 0;
        if (!kick || kick < now) continue;
        for (const team of [g.home, g.away]) {
          if (map[team]) continue;
          const opp = team === g.home ? g.away : g.home;
          map[team] = { week: w.week, kickoff: new Date(kick).toISOString(), opponent: opp };
        }
      }
    }
  } catch (_) { /* ignore; return empty */ }

  res.setHeader("Cache-Control", "max-age=600, s-maxage=3600");
  res.status(200).json({ ok: true, season, next: map });
}
