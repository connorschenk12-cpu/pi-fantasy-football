// src/components/PlayerName.jsx
import React from "react";

/**
 * Props:
 * - id: playerId (string)
 * - playersMap: Map<string, playerObj>
 * - fallback?: string shown if no player found (default: playerId)
 * - showPos?: boolean
 * - showTeam?: boolean
 */
export default function PlayerName({ id, playersMap, fallback, showPos = false, showTeam = false }) {
  if (!id) return <span>(empty)</span>;
  const p = playersMap?.get ? playersMap.get(id) : null;

  if (!p) {
    return <span>{fallback ?? id}</span>;
  }

  const name = p.name || p.fullName || p.playerName || id;
  const bits = [name];

  if (showPos && p.position) bits.push(p.position);
  if (showTeam && (p.team || p.nflTeam)) bits.push(p.team || p.nflTeam);

  return <span>{bits.join(" · ")}</span>;
}
