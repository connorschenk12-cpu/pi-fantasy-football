/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  initDraftOrder,
  configureDraft,
  startDraft,
  endDraft,
} from "../lib/storage";

/**
 * Simple Admin panel section for draft setup.
 * Props: { leagueId }
 */
export default function AdminDraftSetup({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  const doInitOrder = async () => {
    try {
      setStatus("Initializing draft order…");
      const members = await initDraftOrder({ leagueId });
      setStatus(`Draft order set from members: ${members.join(", ")}`);
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  const doConfigure = async () => {
    try {
      setStatus("Configuring draft…");
      const order = league?.draft?.order || [];
      await configureDraft({ leagueId, order });
      setStatus("Draft configured.");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  const doStart = async () => {
    try {
      setStatus("Starting draft…");
      await startDraft({ leagueId });
      setStatus("Draft started.");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  const doEnd = async () => {
    try {
      setStatus("Ending draft…");
      await endDraft({ leagueId });
      setStatus("Draft ended.");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  return (
    <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
      <h4>Draft Setup</h4>
      <div style={{ marginBottom: 8, color: "#555" }}>
        Status: <b>{league?.draft?.status || "scheduled"}</b>
        {" · "}
        Teams: <b>{(league?.draft?.order || []).length}</b>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={doInitOrder}>Init Order (from members)</button>
        <button onClick={doConfigure}>Configure Draft</button>
        <button onClick={doStart}>Start Draft</button>
        <button onClick={doEnd}>End Draft</button>
      </div>
      {status && <div style={{ marginTop: 8 }}>{status}</div>}
    </div>
  );
}
