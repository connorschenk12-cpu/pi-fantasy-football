// src/lib/scoring.js
// Simple projected scoring using your existing projForWeek() helper.
// Bench does not count.

import { projForWeek } from "./storage";

/**
 * Compute a team's projected score and per-player breakdown for a week.
 * team: { roster: { SLOT: playerId|null }, bench: [...] }
 * playersMap: Map<playerId, playerDoc>
 * returns { total: number, parts: Array<{slot,id,name,position,team,proj,opp}> }
 */
export function computeTeamProjectedScore(team, playersMap, week, opponentForWeekFn) {
  const parts = [];
  let total = 0;

  if (!team || !team.roster) {
    return { total: 0, parts: [] };
  }

  for (const [slot, pid] of Object.entries(team.roster)) {
    if (!pid) continue;
    const p = playersMap.get(pid);
    const proj = p ? Number(projForWeek(p, week) || 0) : 0;
    const opp = p && opponentForWeekFn ? opponentForWeekFn(p, week) : "";
    total += proj;
    parts.push({
      slot,
      id: pid,
      name: p ? (p.name || p.fullName || p.display || p.id) : pid,
      position: p?.position || "",
      team: p?.team || p?.nflTeam || "",
      proj,
      opp,
    });
  }

  // Sort starter rows by largest contribution
  parts.sort((a, b) => b.proj - a.proj);

  return { total, parts };
}
