// src/lib/scoring.js
export const DEFAULT_SCORING = {
  passYds: 0.04,  // 1 pt per 25 pass yds
  passTD: 4,
  passInt: -2,
  rushYds: 0.1,   // 1 pt per 10 rush yds
  rushTD: 6,
  recYds: 0.1,    // 1 pt per 10 rec yds
  recTD: 6,
  rec: 0,         // set to 1 for full PPR if you want
  fumbles: -2,
  // placeholders for K/DEF if you add later:
  kickPts: 0,
  defPts: 0,
};

export function computeFantasyPoints(stat, scoring = DEFAULT_SCORING) {
  if (!stat) return 0;
  const s = scoring || DEFAULT_SCORING;
  const total =
    (stat.passYds || 0) * s.passYds +
    (stat.passTD  || 0) * s.passTD  +
    (stat.passInt || 0) * s.passInt +
    (stat.rushYds || 0) * s.rushYds +
    (stat.rushTD  || 0) * s.rushTD  +
    (stat.recYds  || 0) * s.recYds  +
    (stat.recTD   || 0) * s.recTD   +
    (stat.rec     || 0) * s.rec     +
    (stat.fumbles || 0) * s.fumbles;

  return Math.round((total + Number.EPSILON) * 100) / 100;
}
