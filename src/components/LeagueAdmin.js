import React, { useEffect, useState } from "react";
import { initLeagueDefaults, scheduleDraft, setDraftStatus, listenLeague } from "../lib/storage";

export default function LeagueAdmin({ leagueId, me, owner }) {
  const [league, setLeague] = useState(null);
  const [when, setWhen] = useState("");

  const isOwner = owner === me;

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        await initLeagueDefaults(leagueId);
        unsub = listenLeague(leagueId, setLeague);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  if (!isOwner) {
    return <p>Only the league owner can manage settings.</p>;
  }

  const status = league?.draft?.status || "unscheduled";
  const scheduledAt = league?.draft?.scheduledAt || null;

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <h3>League Admin</h3>
      <div>
        <div><strong>Draft status:</strong> {status}</div>
        {scheduledAt && <div><strong>Scheduled at:</strong> {scheduledAt}</div>}
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <span>Schedule draft (local time):</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          style={{ padding: 8 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={async () => {
            if (!when) return alert("Pick a date/time first");
            try {
              await scheduleDraft(leagueId, when);
              alert("Draft scheduled");
            } catch (e) {
              alert(e.message || "Failed to schedule draft");
            }
          }}
          style={{ padding: 10 }}
        >
          Save Draft Schedule
        </button>

        <button
          onClick={async () => {
            try {
              await setDraftStatus(leagueId, "live");
              alert("Draft is now LIVE");
            } catch (e) {
              alert(e.message || "Failed to set live");
            }
          }}
          style={{ padding: 10 }}
        >
          Start Draft (set LIVE)
        </button>

        <button
          onClick={async () => {
            try {
              await setDraftStatus(leagueId, "complete");
              alert("Draft marked COMPLETE");
            } catch (e) {
              alert(e.message || "Failed to complete draft");
            }
          }}
          style={{ padding: 10 }}
        >
          Complete Draft
        </button>
      </div>
    </div>
  );
}
