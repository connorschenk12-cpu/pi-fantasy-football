/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  setEntrySettings,
  payEntry,
  allMembersPaidOrFree,
  ensureSeasonSchedule,
  ensureOrRecreateSchedule,
  configureDraft,
  initDraftOrder,
  startDraft,
  endDraft,
  leagueIsFree,
  memberCanDraft,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryAmount, setEntryAmount] = useState(0);

  // Subscribe to league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
      setEntryEnabled(!!l?.entry?.enabled);
      setEntryAmount(Number(l?.entry?.amountPi || 0));
    });
    return () => unsub && unsub();
  }, [leagueId]);

  // Load members
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const m = await listMemberUsernames(leagueId);
        if (alive) setMembers(m || []);
      } catch (e) {
        console.error("listMemberUsernames:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const canStartDraft = useMemo(() => {
    if (!league) return false;
    if (!leagueIsFree(league) && !league?.entry?.paid) return false;
    return true;
  }, [league]);

  async function handleSaveEntry() {
    setLoading(true);
    try {
      await setEntrySettings({
        leagueId,
        enabled: entryEnabled,
        amountPi: Number(entryAmount || 0),
      });
      alert("Entry settings saved.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePayEntrySelf() {
    setLoading(true);
    try {
      await payEntry({ leagueId, username, txId: "manual-ok" });
      alert("Marked your entry as paid.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleEnsureSchedule() {
    setLoading(true);
    try {
      await ensureSeasonSchedule({ leagueId, totalWeeks: 14, recreate: false });
      alert("Schedule ensured (existing preserved).");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRecreateSchedule() {
    setLoading(true);
    try {
      await ensureOrRecreateSchedule(leagueId, 14);
      alert("Schedule recreated.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSeedDraftOrder() {
    setLoading(true);
    try {
      const order = await initDraftOrder({ leagueId });
      await configureDraft({ leagueId, order });
      alert(`Draft order set: ${order.join(", ")}`);
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStartDraft() {
    setLoading(true);
    try {
      const ok = await allMembersPaidOrFree(leagueId);
      if (!ok) {
        alert("All members must pay (or league must be free) before starting the draft.");
        return;
      }
      await startDraft({ leagueId });
      alert("Draft started.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleEndDraft() {
    setLoading(true);
    try {
      await endDraft({ leagueId });
      alert("Draft marked complete.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h2>Admin</h2>

      {!league && <div style={{ color: "#999" }}>Loading league…</div>}

      {league && (
        <>
          <section style={{ border: "1px solid #eee", padding: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Entry / Payments</h3>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                <input
                  type="checkbox"
                  checked={entryEnabled}
                  onChange={(e) => setEntryEnabled(e.target.checked)}
                  disabled={loading}
                />{" "}
                Enable entry payments
              </label>
              <label>
                Amount (π):{" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={entryAmount}
                  onChange={(e) => setEntryAmount(e.target.value)}
                  disabled={loading}
                  style={{ width: 120 }}
                />
              </label>
              <button onClick={handleSaveEntry} disabled={loading}>
                Save
              </button>
              <button onClick={handlePayEntrySelf} disabled={loading || !entryEnabled}>
                Mark MY entry paid (manual)
              </button>
            </div>
            <div style={{ marginTop: 8, color: "#666" }}>
              Members: {members.join(", ") || "(none)"}
            </div>
          </section>

          <section style={{ border: "1px solid #eee", padding: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Schedule</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleEnsureSchedule} disabled={loading}>
                Ensure Season Schedule
              </button>
              <button onClick={handleRecreateSchedule} disabled={loading}>
                Recreate Schedule
              </button>
            </div>
          </section>

          <section style={{ border: "1px solid #eee", padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Draft</h3>
            <div style={{ marginBottom: 6, color: "#666" }}>
              Status: <b>{league?.draft?.status || "(none)"}</b>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleSeedDraftOrder} disabled={loading}>
                Seed Draft Order (members)
              </button>
              <button onClick={handleStartDraft} disabled={loading || !canStartDraft}>
                Start Draft
              </button>
              <button onClick={handleEndDraft} disabled={loading}>
                End Draft
              </button>
            </div>
            {!canStartDraft && (
              <div style={{ marginTop: 8, color: "#a00" }}>
                All members must pay (or league must be free) before you can start the draft.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
