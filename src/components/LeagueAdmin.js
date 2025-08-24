/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  getLeague,
  listenLeague,
  listMemberUsernames,
  initDraftOrder,
  startDraft,
  endDraft,
  configureDraft,
  ensureSeasonSchedule,
  setEntrySettings, // optional; no-op if not present in storage.js
} from "../lib/storage";

/**
 * Props:
 * - leagueId (string, required)
 * - username (string, required)
 */
export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [ensuringSched, setEnsuringSched] = useState(false);
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryAmount, setEntryAmount] = useState(0);

  // live league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => setLeague(l));
    return () => unsub && unsub();
  }, [leagueId]);

  // fetch members (once)
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!leagueId) return;
      try {
        const arr = await listMemberUsernames(leagueId);
        if (mounted) setMembers(arr);
      } catch (e) {
        console.error("listMemberUsernames error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  // init local entry settings UI from league whenever it changes
  useEffect(() => {
    const enabled = !!league?.entry?.enabled;
    const amount = Number(league?.entry?.amount || 0);
    setEntryEnabled(enabled);
    setEntryAmount(amount || 0);
  }, [league?.entry]);

  const isOwner = useMemo(() => {
    if (!league?.owner || !username) return false;
    return league.owner === username;
  }, [league?.owner, username]);

  const draft = league?.draft || {};
  const draftStatus = draft.status || "scheduled";
  const canConfigureDraft = isOwner && draftStatus !== "done";
  const canStartDraft = isOwner && draftStatus === "scheduled";

  const handleInitOrder = async () => {
    try {
      setCreatingOrder(true);
      const order = await initDraftOrder({ leagueId });
      await configureDraft({ leagueId, order });
      alert("Draft order initialized.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleStartDraft = async () => {
    try {
      await startDraft({ leagueId });
      alert("Draft started!");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  const handleEndDraft = async () => {
    try {
      await endDraft({ leagueId });
      alert("Draft marked as done.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  const handleEnsureSchedule = async () => {
    try {
      setEnsuringSched(true);
      const res = await ensureSeasonSchedule({ leagueId, totalWeeks: 14, recreate: true });
      console.log("ensureSeasonSchedule:", res);
      alert("Season schedule (re)created.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setEnsuringSched(false);
    }
  };

  const handleSaveEntry = async () => {
    try {
      // setEntrySettings may be a no-op if not exported; guard
      if (typeof setEntrySettings === "function") {
        await setEntrySettings({ leagueId, enabled: entryEnabled, amount: Number(entryAmount || 0) });
        alert("Entry fee settings saved.");
      } else {
        alert("Entry fee saving not wired in storage.js yet.");
      }
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  return (
    <div>
      <div style={{ padding: "8px 0", color: "#666", fontSize: 12 }}>
        Admin tab • {leagueId ? `League: ${leagueId}` : "No leagueId"}{" "}
        {username ? `• You: ${username}` : ""}
      </div>

      {!league && (
        <div style={{ color: "#999" }}>
          Loading league…
        </div>
      )}

      {league && (
        <>
          <h3 style={{ marginTop: 0 }}>{league.name || "League"}</h3>
          <p style={{ marginTop: 0 }}>
            Owner: <b>{league.owner}</b> • Members: <b>{members.length}</b>
          </p>

          {/* Entry / Payments */}
          <section style={{ border: "1px solid #eee", padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <h4 style={{ margin: "0 0 8px" }}>Entry / Payments</h4>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                <input
                  type="checkbox"
                  checked={entryEnabled}
                  onChange={(e) => setEntryEnabled(e.target.checked)}
                />{" "}
                Enable entry fee
              </label>
              <label>
                Amount:&nbsp;
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={entryAmount}
                  onChange={(e) => setEntryAmount(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                &nbsp;Pi
              </label>
              <button onClick={handleSaveEntry}>Save</button>
            </div>
            <div style={{ color: "#666", marginTop: 6, fontSize: 12 }}>
              (Players will see a “Pay entry” action in their “My Team” tab when enabled.)
            </div>
          </section>

          {/* Draft controls (hidden when done) */}
          {draftStatus !== "done" && (
            <section style={{ border: "1px solid #eee", padding: 12, borderRadius: 8, marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>Draft Setup</h4>
              <div style={{ marginBottom: 6 }}>
                Status: <b>{draftStatus}</b>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={!canConfigureDraft || creatingOrder} onClick={handleInitOrder}>
                  {creatingOrder ? "Seeding…" : "Seed Draft Order"}
                </button>
                <button disabled={!canStartDraft} onClick={handleStartDraft}>
                  Start Draft
                </button>
                <button onClick={handleEndDraft}>
                  Mark Draft Done
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                (Draft controls are available until the draft is marked done.)
              </div>
            </section>
          )}

          {/* Schedule */}
          <section style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
            <h4 style={{ margin: "0 0 8px" }}>Season Schedule</h4>
            <button onClick={handleEnsureSchedule} disabled={ensuringSched}>
              {ensuringSched ? "Working…" : "Ensure / Recreate Schedule"}
            </button>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
              Generates a 14-week round-robin schedule from league members.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
