// src/lib/scoring.js

// Basic PPR scoring you can tweak anytime.
export const SCORING_DEFAULT = {
  // Offense
  passYds: 0.04,      // 1 pt / 25 pass yds
  passTD: 4,
  passInt: -2,
  rushYds: 0.1,       // 1 pt / 10 rush yds
  rushTD: 6,
  rec: 1,             // PPR
  recYds: 0.1,        // 1 pt / 10 rec yds
  recTD: 6,
  fumbles: -2,

  // Kicker (very simple)
  xp: 1,
  fg: 3,

  // Team DEF/ST (very simple baseline)
  sack: 1,
  defInt: 2,
  defFR: 2,
  defTD: 6,
  // If you later add points-allowed tiers, handle here.
};

// Small helper to coerce to number
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Compute fantasy points from a stat line.
 * `stats` can include any of the fields referenced below; missing fields are treated as 0.
 * This works for QB/RB/WR/TE, K, and DEF with a minimal set of common fields.
 */
export function computeFantasyPoints(stats = {}, position = "", scoring = SCORING_DEFAULT) {
  const s = stats || {};
  let pts = 0;

  // QB/RB/WR/TE common
  pts += n(s.passYds) * scoring.passYds;
  pts += n(s.passTD) * scoring.passTD;
  pts += n(s.passInt) * scoring.passInt;

  pts += n(s.rushYds) * scoring.rushYds;
  pts += n(s.rushTD) * scoring.rushTD;

  const recs = s.rec != null ? s.rec : s.receptions;
  pts += n(recs) * scoring.rec;

  pts += n(s.recYds) * scoring.recYds;
  pts += n(s.recTD) * scoring.recTD;

  pts += n(s.fumbles) * scoring.fumbles;

  // Kicker
  const xp = s.xp != null ? s.xp : s.xpMade;
  const fg = s.fg != null ? s.fg : s.fgMade;
  pts += n(xp) * scoring.xp;
  pts += n(fg) * scoring.fg;

  // Defense/ST (simple)
  pts += n(s.sacks) * scoring.sack;
  const defInts = s.int != null ? s.int : s.interceptions;
  pts += n(defInts) * scoring.defInt;
  const defFR = s.fr != null ? s.fr : s.fumRec;
  pts += n(defFR) * scoring.defFR;
  pts += n(s.defTD) * scoring.defTD;

  // Round to 0.1
  return Math.round(pts * 10) / 10;
}

/**
 * Optional: if your player projections are stored as a stat-object per week,
 * we can convert them to fantasy points using the same scoring.
 * If your projections are already a single number, we just return that.
 */
export function computeProjectedFromPlayer(p, week, scoring = SCORING_DEFAULT) {
  const w = String(week);
  const direct =
    (p?.projections && typeof p.projections[w] === "number" && p.projections[w]) ??
    (p?.projByWeek && typeof p.projByWeek[w] === "number" && p.projByWeek[w]);

  if (typeof direct === "number") return direct;

  const obj =
    (p?.projections && typeof p.projections[w] === "object" && p.projections[w]) ??
    (p?.projByWeek && typeof p.projByWeek[w] === "object" && p.projByWeek[w]);

  if (obj && typeof obj === "object") {
    return computeFantasyPoints(obj, p?.position, scoring);
  }
  return 0;
}
