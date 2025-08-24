/* eslint-disable react/prop-types */
import React from "react";
import { playerDisplay } from "../../lib/storage";

/**
 * Show a player's name given an id and a playersMap.
 * Props:
 *  - id: string (playerId)
 *  - playersMap: Map<playerId, playerDoc>
 *  - fallback?: string
 */
export default function PlayerName({ id, playersMap, fallback = "" }) {
  if (!id) return <span>{fallback || "(empty)"}</span>;
  const p = playersMap?.get ? playersMap.get(id) : null;
  return <span>{playerDisplay(p) || String(id)}</span>;
}
