// src/components/LeagueAdmin.js
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  initDraftOrder,
  setDraftOrder,
  setDraftStatus,
  scheduleDraft,
  initLeagueDefaults,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, me, owner }) {
  const [league, setLeague] = useState(null);
  const [customOrderText, setCustomOrderText] = useState("");
  const [scheduleISO, setScheduleISO] = useState("");

  const isOwner = owner === me;

  useEffect(() => {
    const unsub = listenLeague(leagueId, (l) => setLeague(l || null));
    return () => unsub && unsub();
  }, [leagueId]);

  if (!isOwner) {
    return <p>Only the league owner can access admin settings.</p>;
  }

  async function handleGenerateOrder() {
    try {
      await initDraftOrder(leagueId);
      alert("✅ Random draft order created (status: scheduled). Review below, then Start Draft.");
    } catch (e) {
      alert(e.message || "Failed to create draft order");
    }
  }

  async function handleStartDraft() {
    try {
      await setDraftStatus(leagueId, "live");
      alert("✅ Draft is now LIVE");
    } catch (e) {
      alert(e.message || "Failed to set LIVE");
    }
  }

  async function handleCompleteDraft() {
    try {
      await setDraftStatus(leagueId, "complete");
      alert("✅ Draft marked COMPLETE");
    } catch (e) {
      alert(e.message || "Failed to complete");
    }
  }

  async function handleResetToUnscheduled() {
    try {
      await setDraftStatus(leagueId, "unscheduled");
      alert("✅ Draft reset to UNSCHEDULED");
    } catch (e) {
      alert(e.message || "Failed to reset");
    }
  }

  async function handleCustomOrderSave() {
    try {
      const arr = customOrderText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await setDraftOrder(leagueId, arr);
      alert("✅ Custom draft order saved (status: scheduled)");
    } catch (e) {
      alert(e.message || "Failed to save order");
    }
  }

  async function handleSchedule() {
    try {
      if (!scheduleISO) return alert("Enter a date/time");
      await scheduleDraft(leagueId, scheduleISO);
      alert("✅ Draft scheduled");
    } catch (e) {
      alert(e.message || "Failed to schedule");
    }
  }

  async function handleEnsureDefaults() {
    try {
      await initLeagueDefaults(leagueId);
      alert("✅ League defaults ensured");
    } catch (e) {
      alert(e.message || "Failed to set defaults");
    }
  }

  const order = league?.draft?.order || [];
  const status = league?.draft?.status || "unscheduled";
  const round = league?.draft?.round || 1;
  const pointer = league?.draft?.pointer ?? 0;
  const upNext = order.length ? order[pointer] : null;

  return (
    <div style={{ marginTop: 8, border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
      <h3>League Admin</h3>
      <p>
        <strong>Draft status:</strong> {status}
      </p>
      <p>
        <strong>Round:</strong> {round}{" "}
        {upNext ? (
          <>
            — <strong>Up:</strong> {upNext}
          </>
        ) : null}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button onClick={handleEnsureDefaults} style={{ padding: 10 }}>
          Ensure Defaults
        </button>
        <button onClick={handleGenerateOrder} style={{ padding: 10 }}>
          Generate Random Order
        </button>
        <button onClick={handleStartDraft} style={{ padding: 10 }}>
          Start Draft (LIVE)
        </button>
        <button onClick={handleCompleteDraft} style={{ padding: 10 }}>
          Mark Draft Complete
        </button>
        <button onClick={handleResetToUnscheduled} style={{ padding: 10 }}>
          Reset to Unscheduled
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4>Custom Draft Order</h4>
        <p style={{ marginTop: -6, opacity: 0.8 }}>
          Enter a comma-separated list of usernames (must be league members).
        </p>
        <textarea
          value={customOrderText}
          onChange={(e) => setCustomOrderText(e.target.value)}
          placeholder="userA, userB, userC"
          rows={3}
          style={{ width: "100%", padding: 8 }}
        />
        <button onClick={handleCustomOrderSave} style={{ marginTop: 8, padding: 8 }}>
          Save Custom Order
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4>Schedule Draft</h4>
        <input
          type="datetime-local"
          value={scheduleISO}
          onChange={(e) => setScheduleISO(e.target.value)}
          style={{ padding: 8 }}
        />
        <button onClick={handleSchedule} style={{ marginLeft: 8, padding: 8 }}>
          Save Schedule
        </button>
      </div>

      {order.length > 0 && (
        <>
          <h4 style={{ marginTop: 16 }}>Current Draft Order</h4>
          <ol>
            {order.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
