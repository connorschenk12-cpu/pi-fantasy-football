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
  ensureOrRecreateSchedule,
  leagueIsFree,
  // season controls
  setCurrentWeek,
  setSeasonEnded,
} from "../lib/storage.js";
import EspnIdBackfill from "./admin/EspnIdBackfill";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);

  // Entry settings form state
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryAmountPi, setEntryAmountPi] = useState(0);

  // Draft scheduling form state (HTML datetime-local expects "YYYY-MM-DDTHH:mm")
  const [draftDateTime, setDraftDateTime] = useState("");

  const isOwner = useMemo(() => !!league && league.owner === username, [league, username]);

  {isOwner && (
  <EspnIdBackfill leagueId={null} />
)}
  
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
    return <div className="container">Loading league settings…</div>;
  }

  if (!isOwner) {
    return (
      <div className="container">
        <div className="ribbon ribbon-info">Only the league owner can view admin tools.</div>
      </div>
    );
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
    <div className="container">
      {/* Header */}
      <div className="header">
        <h3 className="m0">League Admin</h3>
        <div className="badge">
          Week {currentWeek} • {members.length} teams
        </div>
      </div>

      {/* League summary */}
      <div className="card mb12">
        <div className="card-title">Overview</div>
        <div className="grid2">
          <div><b>League:</b> {league?.name}</div>
          <div><b>Owner:</b> {league?.owner}</div>
          <div className="col-span-2"><b>Members:</b> {members.join(", ") || "—"}</div>
        </div>
      </div>

      {/* Draft Controls */}
      <div className="card mb12">
        <div className="card-title">Draft Controls</div>

        <div className="grid2 mb8">
          <div><b>Status:</b> {league?.draft?.status || "scheduled"}</div>
          <div><b>Scheduled for:</b> {schedStr}</div>
          <div><b>Clock (ms):</b> {league?.draft?.clockMs || 5000}</div>
          <div><b>Rounds:</b> {league?.draft?.roundsTotal || 12}</div>
        </div>

        <div className="btnbar">
          <button className="btn btn-primary" disabled={saving} onClick={handleInitDraftOrder}>
            Initialize Draft Order
          </button>
          <button className="btn btn-ghost" disabled={saving} onClick={handleWriteSchedule}>
            Recreate Season Schedule
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={handleStartDraftNow}>
            Start Draft Now
          </button>
          <button className="btn btn-danger" disabled={saving} onClick={handleEndDraft}>
            End Draft
          </button>
        </div>

        <div className="mt12">
          <label className="block mb4"><b>Schedule draft (local time)</b></label>
          <input
            className="input"
            type="datetime-local"
            value={draftDateTime}
            onChange={(e) => setDraftDateTime(e.target.value)}
          />
          <div className="mt8">
            <button className="btn" disabled={saving} onClick={handleScheduleDraft}>
              Save Draft Schedule
            </button>
          </div>
          <div className="muted mt8">
            When the timestamp is reached, your cron/edge job should call <code>findDueDrafts()</code> and then{" "}
            <code>startDraft()</code> for each due league.
          </div>
        </div>
      </div>

      {/* Entry Settings */}
      <div className="card mb12">
        <div className="card-title">Entry Settings</div>

        <div className="row wrap gap12 ai-center">
          <label className="row ai-center gap8">
            <input
              type="checkbox"
              checked={entryEnabled}
              onChange={(e) => setEntryEnabled(e.target.checked)}
            />
            Require entry fee
          </label>

        <label className="row ai-center gap8">
            Amount (Pi):
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={entryAmountPi}
              onChange={(e) => setEntryAmountPi(e.target.value)}
              style={{ width: 120 }}
              disabled={!entryEnabled}
            />
          </label>

          <button className="btn btn-primary" disabled={saving} onClick={handleSaveEntry}>
            Save
          </button>
        </div>

        {!leagueIsFree(league) && (
          <div className="muted mt8">
            Payments are collected in the <b>My Team</b> tab via your provider flow.
          </div>
        )}
      </div>

      {/* Season Controls */}
      <div className="card">
        <div className="card-title">Season Controls</div>

        <div className="mb8">
          <span className="badge">Current Week: {currentWeek}</span>{" "}
          <span className="badge" style={{ marginLeft: 6 }}>
            Season Ended: {seasonEnded ? "Yes" : "No"}
          </span>
        </div>

        <div className="row wrap gap12 ai-center">
          <label className="row ai-center gap8">
            Set Week:
            <input
              id="admin-week-input"
              className="input"
              type="number"
              min="1"
              step="1"
              defaultValue={currentWeek}
              style={{ width: 100 }}
            />
          </label>

          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true);
                const input = document.getElementById("admin-week-input");
                const w = Number(input?.value || 1);
                await setCurrentWeek({ leagueId, week: w });
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
            className="btn btn-danger"
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
            className="btn"
            title="Calls the daily cron endpoint immediately to compute winners and enqueue payouts."
            disabled={saving}
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

        <div className="muted mt8" style={{ lineHeight: 1.5 }}>
          • When <b>Week ≥ 18</b> or <b>Season Ended = Yes</b>, the daily cron will settle the league.<br />
          • Ensure all entry payments are recorded and <code>treasury.poolPi</code> is funded.<br />
          • The cron enqueues payouts and calls your server to send Pi (see <code>sendPiServerSide</code>).
        </div>
      </div>
    </div>
  );
}
