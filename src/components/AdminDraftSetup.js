// src/components/AdminDraftSetup.js
import React, { useMemo, useState } from "react";
import { configureDraft, startDraft, endDraft } from "../lib/storage";

export default function AdminDraftSetup({ league }) {
  const leagueId = league?.id;
  const [orderText, setOrderText] = useState(
    // prefill with current order if it exists
    Array.isArray(league?.draft?.order) ? league.draft.order.join(",") : "you,bot1,bot2,bot3"
  );
  const [busy, setBusy] = useState(false);
  const status = league?.draft?.status || "scheduled";
  const rounds = league?.draft?.roundsTotal || 12;

  const order = useMemo(() => orderText.split(",").map(s => s.trim()).filter(Boolean), [orderText]);

  async function handleConfigure() {
    if (!leagueId) return alert("No league loaded.");
    if (order.length === 0) return alert("Enter at least one username in the order list.");
    try {
      setBusy(true);
      await configureDraft({ leagueId, order });
      alert(`Draft configured with ${order.length} teams • ${rounds} rounds.`);
    } catch (e) {
      alert(e.message || "Configure failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    try {
      setBusy(true);
      await startDraft({ leagueId });
    } catch (e) {
      alert(e.message || "Start failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    try {
      setBusy(true);
      await endDraft({ leagueId });
    } catch (e) {
      alert(e.message || "End failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Draft Admin</div>

      <div style={{ marginBottom: 6, fontSize: 14 }}>
        Status: <b>{status}</b> · Rounds: <b>{rounds}</b>
      </div>

      <label style={{ display: "block", marginBottom: 6 }}>
        Draft Order (comma separated usernames):
      </label>
      <textarea
        value={orderText}
        onChange={(e)=>setOrderText(e.target.value)}
        style={{ width: "100%", minHeight: 70, fontFamily: "monospace" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={handleConfigure} disabled={busy}>Configure Draft</button>
        <button onClick={handleStart} disabled={busy || status === "live"}>Start Draft</button>
        <button onClick={handleEnd} disabled={busy || status !== "live"}>End Draft</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        Configure sets the order and enables a 5s pick clock. During a live draft, add/drop is locked.
      </div>
    </div>
  );
}
