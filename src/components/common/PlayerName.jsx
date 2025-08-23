import React from "react";

export default function PlayerName({ playerId, playersMap, fallback = "(empty)" }) {
  if (!playerId) return <span style={{ opacity: 0.7 }}>{fallback}</span>;
  const p = playersMap?.get?.(playerId);
  const label =
    p?.name || p?.fullName || p?.playerName || p?.displayName || String(playerId);
  return <span>{label}</span>;
}
