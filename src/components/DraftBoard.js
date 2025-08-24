/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  listPlayersMap,
  draftPick,
  isMyTurn,
} from "../lib/storage";
import PlayerName from "./common/PlayerName";

export default function DraftBoard({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const onClock = order[ptr];

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const m = await listPlayersMap({ leagueId });
      if (mounted) setPlayersMap(m);
    })();
    return () => (mounted = false);
  }, [leagueId]);

  const pick = async (playerId) => {
    try {
      const p = playersMap.get(playerId);
      await draftPick({
        leagueId,
        username,
        playerId,
        playerPosition: p?.position || "",
        slot: null,
      });
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <b>Status:</b> {league?.draft?.status || "scheduled"} •{" "}
        <b>On clock:</b> {onClock || "-"} {isMyTurn(league, username) ? " (Your turn!)" : ""}
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
        (For brevity this DraftBoard just shows whose turn it is. Use Players tab to filter, then
        pick via your existing UI, or add quick-pick buttons here wired to <code>pick(playerId)</code>.)
      </div>

      {/* Example: show last 10 drafted if you store them under leagues/{id}/draftPicks */}
      {/* Omitted for now */}
    </div>
  );
}
