// /api/stats/week.js
// Pull weekly projections (QB/RB/WR/TE/K/DEF) from Sleeper projections endpoint
// Note: Projections endpoints are undocumented but widely used by the community libs.
// We handle failures gracefully and return {} when unavailable.
export default async function handler(req, res) {
  const season = Number(new Date().getFullYear()); // adjust if needed
  const week = Number(req.query.week || 1);

  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const params = positions.map(p => `position[]=${encodeURIComponent(p)}`).join("&");
  const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${params}`;

  let stats = {};
  try {
    const r = await fetch(url, { next: { revalidate: 300 } });
    if (r.ok) {
      const arr = await r.json(); // [{ player_id, stats: { pass_yd, pass_td, ... } }, ...]
      // Normalize to our scoring keys
      for (const row of arr || []) {
        const id = String(row.player_id);
        const s = row.stats || {};
        stats[id] = {
          passYds: s.pass_yd || 0,
          passTD: s.pass_td || 0,
          passInt: s.pass_int || 0,
          rushYds: s.rush_yd || 0,
          rushTD: s.rush_td || 0,
          recYds:  s.rec_yd || 0,
          recTD:   s.rec_td || 0,
          rec:     s.rec || 0,
          fumbles: s.fum_lost || 0
        };
      }
    }
  } catch (_) { /* swallow; fallback below */ }

  res.setHeader("Cache-Control", "max-age=60, s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ ok: true, week, season, stats });
}

