/* eslint-disable react-hooks/exhaustive-deps */
// src/components/DraftBoard.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  listenLeague, projForWeek, autoPickBestAvailable, isMyTurn, canDraft, startDraft, endDraft
} from "../lib/storage";

export default function DraftBoard({ league, playersById }) {
  const leagueId = league?.id;
  const [liveLeague, setLiveLeague] = useState(league || null);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef(null);

  useEffect(() => {
    if (!leagueId) return;
    const un = listenLeague(leagueId, (lg) => setLiveLeague(lg));
    return () => un && un();
  }, [leagueId]);

  // local clock tick (500ms)
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tickRef.current);
  }, []);

  const d = liveLeague?.draft || {};
  const order = Array.isArray(d.order) ? d.order : [];
  const onClock = order[Number(d.pointer) || 0];

  const currentWeek = Number(liveLeague?.settings?.currentWeek || 1);
  const msLeft = useMemo(() => {
    if (!d?.deadline) return 0;
    return Math.max(0, Number(d.deadline) - now);
  }, [d?.deadline, now]);

  // Autopick when expired (any client can do this; in test you’re single user anyway)
  useEffect(() => {
    if (!liveLeague?.id) return;
    if (!canDraft(liveLeague)) return;
    if (!d?.deadline) return;
    if (msLeft > 0) return;

    // deadline passed -> auto pick best available
    (async () => {
      await autoPickBestAvailable({ leagueId: liveLeague.id, currentWeek });
    })();
    // next deadline is written by draftPick()
  }, [msLeft, d?.deadline, liveLeague?.id, currentWeek]);

  const statusLine = useMemo(() => {
    const rd = d.round || 1;
    const tot = d.roundsTotal || 12;
    const pointerName = onClock || "—";
    if (d.status === "live") {
      return `Round ${rd}/${tot} • On the clock: ${pointerName} • ${Math.ceil(msLeft/1000)}s`;
    }
    return `Draft status: ${d.status || "scheduled"}`;
  }, [d.status, d.round, d.roundsTotal, onClock, msLeft]);

  async function handleStart() {
    await startDraft({ leagueId });
  }
  async function handleEnd() {
    await endDraft({ leagueId });
  }

  // Simple visual of order & pointer
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Draft Board</div>
      <div style={{ marginBottom: 8 }}>{statusLine}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {order.map((u, i) => (
          <div key={u + i} style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: i === (d.pointer || 0) ? "#111" : "#fff",
            color: i === (d.pointer || 0) ? "#fff" : "#111"
          }}>
            {u}
          </div>
        ))}
      </div>

      {d.status === "scheduled" && (
        <button onClick={handleStart} style={{ padding: "8px 12px" }}>Start Draft</button>
      )}
      {d.status === "live" && (
        <button onClick={handleEnd} style={{ padding: "8px 12px" }}>End Draft</button>
      )}
    </div>
  );
}
