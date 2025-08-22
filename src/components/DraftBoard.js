/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  draftPick,
  autoDraftIfExpired,
  isMyTurn,
  listPlayers,
  projForWeek,
} from "../lib/storage";
import PlayersList from "./PlayersList";

/**
 * Props:
 * - leagueId
 * - username
 * - currentWeek
 */
export default function DraftBoard({ leagueId, username, currentWeek = 1 }) {
  const [league, setLeague] = useState(null);
  const [available, setAvailable] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [error, setError] = useState("");

  // League listener
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => setLeague(l));
    return () => unsub && unsub();
  }, [leagueId]);

  // Fetch available players once (UI filters/sorts)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingPlayers(true);
        const list = await listPlayers({ leagueId });
        if (!alive) return;
        setAvailable(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("DraftBoard listPlayers error:", e);
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoadingPlayers(false);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  // Auto-pick on timer expiry
  useEffect(() => {
    let t;
    const tick = async () => {
      try {
        await autoDraftIfExpired({ leagueId, currentWeek });
      } catch (e) {
        // not fatal
      } finally {
        t = setTimeout(tick, 1000);
      }
    };
    t = setTimeout(tick, 1000);
    return () => clearTimeout(t);
  }, [leagueId, currentWeek]);

  const order = useMemo(() => {
    return Array.isArray(league?.draft?.order) ? league.draft.order : [];
  }, [league]);

  const pointer = useMemo(() => {
    const p = league?.draft?.pointer;
    return Number.isInteger(p) ? p : 0;
  }, [league]);

  const onClockUser = order[pointer] || null;
  const myTurn = isMyTurn(league, username);

  const handleDraft = async (player) => {
    try {
      setError("");
      await draftPick({
        leagueId,
        username,
        playerId: player?.id,
        playerPosition: (player?.position || "").toString().toUpperCase(),
        slot: null,
      });
    } catch (e) {
      console.error("draftPick error:", e);
      setError(String(e?.message || e));
    }
  };

  const status = league?.draft?.status || "scheduled";
  const deadline = Number(league?.draft?.deadline || 0);
  const msLeft = Math.max(0, deadline ? (deadline - Date.now()) : 0);
  const secondsLeft = Math.ceil(msLeft / 1000);

  return (
    <div>
      <h3>Draft Board</h3>

      <div style={{ marginBottom: 6, fontSize: 14 }}>
        Status: <b>{status}</b>{' '}
        {status === "live" && (
          <>· On clock: <b>{onClockUser || "(unknown)"}</b> · Time left: <b>{secondsLeft}s</b></>
        )}
      </div>

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      {status !== "live" && (
        <div style={{ margin: "8px 0", fontStyle: "italic" }}>
          Draft is not live yet. Start the draft from Admin when everyone has joined.
        </div>
      )}

      {status === "live" && (
        <div style={{ margin: "10px 0" }}>
          {myTurn ? (
            <div>Your turn — pick a player below.</div>
          ) : (
            <div>Waiting for <b>{onClockUser || "someone"}</b>…</div>
          )}
        </div>
      )}

      <PlayersList
        leagueId={leagueId}
        currentWeek={currentWeek}
        allowDraftButton={status === "live" && myTurn}
        onDraft={handleDraft}
      />
    </div>
  );
}
