/* eslint-disable no-console */
// src/components/common/PlayerName.jsx
import React, { useEffect, useMemo, useState } from "react";
import { asId, playerDisplay, listPlayersMap } from "../../lib/storage";

/**
 * Usage examples:
 *   <PlayerName player={playerObj} />
 *   <PlayerName playerId={id} playersMap={playersMap} />
 *   <PlayerName playerId={id} leagueId={leagueId} />  // will lazy-load a map
 *
 * Props:
 * - player:     full player object (optional)
 * - playerId:   id (string/number/object-with-id) if you don't have the object
 * - playersMap: Map of id -> player (optional; preferred for performance)
 * - leagueId:   if playersMap isn't provided, we can lazy-load one when this is given
 * - fallback:   text to show if name can't be resolved (default "(unknown)")
 * - showId:     if true, include the id after the name (useful for debugging)
 */
export default function PlayerName({
  player,
  playerId,
  playersMap,
  leagueId,
  fallback = "(unknown)",
  showId = false,
}) {
  const pid = useMemo(() => asId(player?.id ?? playerId), [player, playerId]);

  // If a map isn't provided, we can (optionally) fetch one when leagueId is known
  const [localMap, setLocalMap] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!playersMap && leagueId) {
      (async () => {
        try {
          const map = await listPlayersMap({ leagueId });
          if (alive) setLocalMap(map || new Map());
        } catch (e) {
          console.error("PlayerName listPlayersMap failed:", e);
          if (alive) setLocalMap(new Map());
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [playersMap, leagueId]);

  const map = playersMap || localMap;

  // Resolve a player object from props or map (try a few common key variants)
  const resolved = useMemo(() => {
    if (player && (player.name || player.fullName || player.playerName || player.id != null)) {
      return player;
    }
    if (!map || !pid) return null;

    // Primary lookup by canonical id
    let p = map.get(pid);
    if (p) return p;

    // Try simple numeric/string flip (some rosters store numbers; docs keyed by strings)
    const num = Number(pid);
    if (Number.isFinite(num)) {
      p = map.get(String(num)) || map.get(num);
      if (p) return p;
    }

    // Last resort: iterate and match by .id equality after canonicalization
    for (const v of map.values()) {
      if (asId(v?.id) === pid) return v;
    }
    return null;
  }, [player, pid, map]);

  const name = useMemo(() => {
    const n = playerDisplay(resolved || (pid ? { id: pid } : null));
    return n && n.trim() ? n : fallback;
  }, [resolved, pid, fallback]);

  // Helpful tooltip for quick debugging in UI
  const title = useMemo(() => {
    if (!resolved) return pid ? `id: ${pid}` : "";
    const parts = [];
    if (resolved.position) parts.push(resolved.position);
    if (resolved.team) parts.push(resolved.team);
    if (pid) parts.push(`id:${pid}`);
    return parts.join(" • ");
  }, [resolved, pid]);

  return (
    <span title={title}>
      {name}
      {showId && pid ? <span style={{ color: "#999" }}> ({pid})</span> : null}
    </span>
  );
}
