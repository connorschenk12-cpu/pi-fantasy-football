/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  configureDraft,
  initDraftOrder,
  startDraft,
  endDraft,
  setEntrySettings,
  setDraftSchedule,
  ensureOrRecreateSchedule, // back-compat wrapper exported from storage.js
  leagueIsFree,
  // NEW:
  setCurrentWeek,
  setSeasonEnded,
} from "../lib/storage.js";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);

  // Entry settings form state
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryAmountPi, setEntryAmountPi] = useState(0);

  // Draft scheduling form state (HTML datetime-local expects "YYYY-MM-DDTHH:mm")
  const [draftDateTime, setDraftDateTime] = useState("");

  const isOwner = useMemo(
    () => !!league && league.owner === username,
    [league, username]
  );

  // Subscribe to league
  useEffect(() => {
    if (!leagueId) return;
    return listenLeague(leagueId, (L) => setLeague(L));
  }, [leagueId]);

  // Load members list
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        setMembers(await listMemberUsernames(leagueId));
      } catch (e) {
        console.error("listMemberUsernames:", e);
      }
    })();
  }, [leagueId]);

  // Seed form defaults when league loads/updates
  useEffect(() => {
    if (!league) return;
    setEntryEnabled(!!league?.entry?.enabled);
    setEntryAmountPi(Number(league?.entry?.amountPi || 0));

    const sched = Number(league?.draft?.scheduledAt || 0);
    if (sched) {
      // Convert ms to local "YYYY-MM-DDTHH:mm"
      const dt = new Date(sched);
      const pad = (n) => String(n).padStart(2, "0");
      const local = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
        dt.getHours()
      )}:${pad(dt.getMinutes())}`;
      setDraftDateTime(local);
    } else {
      setDraftDateTime("");
    }
  }, [league]);

  if (!league) {
    return <div>Loading league settings…</div>;
  }

  if (!isOwner) {
    return <div style={{ color: "#666" }}>Only the league owner can view admin tools.</div>;
  }

  async function handleInitDraftOrder() {
    setSaving(true);
    try {
      const order = await initDraftOrder({ leagueId });
      alert("Draft order set: " + order.join(" → "));
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleStartDraftNow() {
    setSaving(true);
    try {
      await startDraft({ leagueId });
      alert("Draft started!");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleEndDraft() {
    setSaving(true);
    try {
      await endDraft({ leagueId });
      alert("Draft ended.");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEntry() {
    setSaving(true);
    try {
      await setEntrySettings({
        leagueId,
        enabled: !!entryEnabled,
        amountPi: Number(entryAmountPi || 0),
      });
      alert("Entry settings saved.");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleScheduleDraft() {
    if (!draftDateTime) {
      alert("Pick a date & time first.");
      return;
    }
    setSaving(true);
    try {
      const ms = new Date(draftDateTime).getTime();
      await setDraftSchedule({ leagueId, startsAtMs: ms });
      alert("Draft scheduled!");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleWriteSchedule() {
    setSaving(true);
    try {
      // Always (re)create a round-robin schedule (14 weeks default here)
      await ensureOrRecreateSchedule(leagueId, 14);
      alert("Season schedule created.");
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const schedStr = (() => {
    const s = Number(league?.draft?.scheduledAt || 0);
    return s ? new Date(s).toLocaleString() : "—";
  })();

  const currentWeek = Number(league?.settings?.currentWeek || 1);
  const seasonEnded = !!league?.settings?.seasonEnded;

  return (
    <div>
      <h3>League Admin</h3>

      <div style={{ marginBottom: 20 }}>
        <div><b>League:</b> {league?.name}</div>
        <div><b>Owner:</b> {league?.owner}</div>
        <div><b>Members:</b> {members.join(", ")}</div>
      </div>

      {/* Draft Controls */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Draft Controls</h4>

        <div style={{ marginBottom: 8 }}>
          <div><b>Status:</b> {league?.draft?.status || "scheduled"}</div>
          <div><b>Scheduled for:</b> {schedStr}</div>
          <div><b>Clock (ms):</b> {league?.draft?.clockMs || 5000}</div>
          <div><b>Rounds:</b> {league?.draft?.roundsTotal || 12}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button disabled={saving} onClick={handleInitDraftOrder}>Initialize Draft Order</button>
          <button disabled={saving} onClick={handleWriteSchedule}>Recreate Season Schedule</button>
          <button disabled={saving} onClick={handleStartDraftNow}>Start Draft Now</button>
          <button disabled={saving} onClick={handleEndDraft}>End Draft</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>
            <b>Schedule draft (local time)</b>
          </label>
          <input
            type="datetime-local"
            value={draftDateTime}
            onChange={(e) => setDraftDateTime(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <button disabled={saving} onClick={handleScheduleDraft}>
              Save Draft Schedule
            </button>
          </div>
          <div style={{ color: "#777", marginTop: 8 }}>
            When the timestamp is reached, your cron/edge job should call
            <code> findDueDrafts()</code> and then <code>startDraft()</code> for each due league.
          </div>
        </div>
      </div>

      {/* Entry Settings */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Entry Settings</h4>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label>
            <input
              type="checkbox"
              checked={entryEnabled}
              onChange={(e) => setEntryEnabled(e.target.checked)}
            />{" "}
            Require entry fee
          </label>
          <label>
            Amount (Pi):{" "}
            <input
              type="number"
              min="0"
              step="0.01"
              value={entryAmountPi}
              onChange={(e) => setEntryAmountPi(e.target.value)}
              style={{ width: 100 }}
              disabled={!entryEnabled}
            />
          </label>
          <button disabled={saving} onClick={handleSaveEntry}>Save</button>
        </div>

        {!leagueIsFree(league) && (
          <div style={{ color: "#777", marginTop: 8 }}>
            Payments are collected in the <b>My Team</b> tab via your provider flow.
          </div>
        )}
      </div>

      {/* Season Controls */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>Season Controls</h4>

        <div style={{ color: "#555", marginBottom: 8 }}>
          Current Week: <b>{currentWeek}</b>{" · "}
          Season Ended: <b>{seasonEnded ? "Yes" : "No"}</b>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Set Week:{" "}
            <input
              id="admin-week-input"
              type="number"
              min="1"
              step="1"
              defaultValue={currentWeek}
              style={{ width: 80 }}
            />
          </label>
          <button
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true);
                const input = document.getElementById("admin-week-input");
                const w = Number(input?.value || 1);
                await setCurrentWeek({ leagueId, week: w });
                // auto-mark ended at 18+
                if (w >= 18 && !seasonEnded) {
                  await setSeasonEnded({ leagueId, seasonEnded: true });
                }
                alert("Week updated.");
              } catch (err) {
                console.error(err);
                alert(err?.message || String(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            Save Week
          </button>

          <button
            disabled={saving || seasonEnded}
            onClick={async () => {
              try {
                setSaving(true);
                await setSeasonEnded({ leagueId, seasonEnded: true });
                alert("Season marked as ended.");
              } catch (err) {
                console.error(err);
                alert(err?.message || String(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            End Season Now
          </button>

          <button
            disabled={saving}
            title="Calls the daily cron endpoint immediately to compute winners and enqueue payouts."
            onClick={async () => {
              try {
                setSaving(true);
                const r = await fetch("/api/cron/settle-season");
                const j = await r.json().catch(() => ({}));
                alert(`Settlement triggered.\n${JSON.stringify(j)}`);
              } catch (err) {
                console.error(err);
                alert(err?.message || String(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            Run Payout Settlement
          </button>
        </div>

        <div style={{ color: "#777", marginTop: 8, lineHeight: 1.4 }}>
          • When <b>Week ≥ 18</b> or <b>Season Ended = Yes</b>, the daily cron will settle the league.<br />
          • Ensure all entry payments are recorded and <code>treasury.poolPi</code> is funded.<br />
          • The cron enqueues payouts and calls your server to send Pi (see <code>sendPiServerSide</code>).
        </div>
      </div>
    </div>
  );
}
