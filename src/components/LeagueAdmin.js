/* eslint-disable no-alert */
/* src/components/LeagueAdmin.js */
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  setEntryFee,
  payEntryFee,
  getEntryStatus,
  ensureOrRecreateSchedule,
  seedDemoProjections,
  syncMembersFromTeams,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [entryAmount, setEntryAmount] = useState(0);
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryPaid, setEntryPaid] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
    });
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    (async () => {
      if (!leagueId) return;
      const e = await getEntryStatus(leagueId);
      setEntryAmount(e.amount || 0);
      setEntryEnabled(!!e.enabled);
      setEntryPaid(e.paid || {});
    })();
  }, [leagueId]);

  if (!leagueId) {
    return <div style={{ color: "crimson" }}>No league loaded. (Missing leagueId)</div>;
  }
  if (!league) return <div>Loading league…</div>;

  const isOwner = league?.owner === username;

  async function handleSaveEntry() {
    setBusy(true);
    try {
      await setEntryFee({ leagueId, amount: Number(entryAmount) || 0, enabled: entryEnabled });
      alert("Entry settings saved.");
    } catch (e) {
      alert(`Failed to save: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    setBusy(true);
    try {
      await payEntryFee({ leagueId, username });
      const e = await getEntryStatus(leagueId);
      setEntryPaid(e.paid || {});
      alert("Payment recorded.");
    } catch (e) {
      alert(`Payment failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleEnsureSchedule(force = false) {
    setBusy(true);
    try {
      const res = await ensureOrRecreateSchedule({ leagueId, totalWeeks: 14, force });
      alert(res.wrote ? `Schedule (weeks=${res.weeks}) created.` : `Schedule already exists.`);
    } catch (e) {
      alert(`Schedule error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncMembers() {
    setBusy(true);
    try {
      const ids = await syncMembersFromTeams(leagueId);
      alert(`Synced members from teams: ${ids.join(", ")}`);
    } catch (e) {
      alert(`Sync error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSeedProjections() {
    if (!window.confirm("Seed demo projections for all players? This will overwrite missing projections.")) return;
    setBusy(true);
    try {
      const n = await seedDemoProjections({ leagueId, weeks: 18 });
      alert(`Demo projections seeded for ${n} players.`);
    } catch (e) {
      alert(`Seeding error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  const yourPaid = !!entryPaid?.[username];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Pi Payments (Entry Fee)">
        {!isOwner && league?.entry?.enabled && !yourPaid && (
          <div style={{ marginBottom: 8, color: "crimson" }}>
            You must pay the entry fee before drafting.
          </div>
        )}

        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <label>
            <span style={{ display: "block", fontWeight: 600 }}>Enabled</span>
            <input
              type="checkbox"
              checked={entryEnabled}
              onChange={(e) => setEntryEnabled(e.target.checked)}
              disabled={!isOwner || busy}
            />
          </label>
          <label>
            <span style={{ display: "block", fontWeight: 600 }}>Entry amount (Pi)</span>
            <input
              type="number"
              min="0"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              disabled={!isOwner || busy}
            />
          </label>

          {isOwner && (
            <button onClick={handleSaveEntry} disabled={busy}>
              Save Entry Settings
            </button>
          )}

          {!isOwner && entryEnabled && (
            <button onClick={handleMarkPaid} disabled={busy || yourPaid}>
              {yourPaid ? "Paid" : `Pay ${entryAmount} Pi (record payment)`}
            </button>
          )}

          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
            (Payments are recorded on the league document. To wire real Pi payments, replace the
            “record payment” button with Pi SDK flow and call <code>payEntryFee</code> after success.)
          </div>

          <div style={{ marginTop: 8 }}>
            <b>Who has paid?</b>
            <div style={{ fontSize: 14 }}>
              {Object.keys(entryPaid || {}).length === 0
                ? "(no payments recorded)"
                : Object.keys(entryPaid).join(", ")}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Schedule">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => handleEnsureSchedule(false)} disabled={busy}>
            Ensure schedule
          </button>
          <button onClick={() => handleEnsureSchedule(true)} disabled={busy}>
            Recreate schedule (overwrite)
          </button>
          <button onClick={handleSyncMembers} disabled={busy}>
            Sync members from teams
          </button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
          If you see “need at least 2 members”, click “Sync members from teams”, then “Ensure schedule”.
        </div>
      </Panel>

      <Panel title="Utilities">
        <button onClick={handleSeedProjections} disabled={busy}>
          Seed demo projections (weeks 1–18)
        </button>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
          This writes simple weekly projections per position so your Players / My Team tabs show
          non-zero projected points. Replace later with your live feed.
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </section>
  );
}
