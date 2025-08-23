/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  initDraftOrder,
  configureDraft,
  startDraft,
  endDraft,
  setDraftStatus,
  ensureSeasonSchedule,
} from "../lib/storage";
import { db } from "../firebase";
import { doc, updateDoc, setDoc } from "firebase/firestore";
import SeedPlayers from "./SeedPlayers";

// ...inside your component’s JSX, near other admin tools:
<SeedPlayers leagueId={leagueId} />
/**
 * Props: { leagueId, username }
 * – Restores draft scheduling controls
 * – Adds payments config (owner sets) and safe projection seeding
 * – Adds “Ensure/Recreate Schedule”
 */
export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(false);
  const [entryEnabled, setEntryEnabled] = useState(false);
  const [entryAmount, setEntryAmount] = useState(0);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    setEntryEnabled(Boolean(league?.entry?.enabled));
    setEntryAmount(Number(league?.entry?.amount || 0));
  }, [league]);

  const isOwner = useMemo(() => {
    if (!league || !username) return false;
    return league.owner === username;
  }, [league, username]);

  async function handleInitOrderFromMembers() {
    try {
      setLoading(true);
      const members = await listMemberUsernames(leagueId);
      if (members.length < 1) {
        alert("No members found.");
        return;
      }
      await initDraftOrder({ leagueId });
      alert(`Draft order initialized:\n${members.join(" → ")}`);
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfigureWithOrderText() {
    const txt = prompt(
      "Enter draft order (comma separated usernames). Example: alice,bob,charlie"
    );
    if (!txt) return;
    const order = txt
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (order.length === 0) {
      alert("No usernames provided.");
      return;
    }
    try {
      setLoading(true);
      await configureDraft({ leagueId, order });
      alert("Draft configured with provided order.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStartDraft() {
    try {
      // Block start if entry is enabled and someone hasn’t paid
      if (league?.entry?.enabled) {
        const paid = league?.entry?.paid || {};
        const members = await listMemberUsernames(leagueId);
        const allPaid = members.every((u) => paid?.[u]);
        if (!allPaid) {
          alert(
            "All members must pay before the draft can start (or disable entry fees)."
          );
          return;
        }
      }
      setLoading(true);
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
    try {
      setLoading(true);
      await endDraft({ leagueId });
      alert("Draft ended.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSetStatus(status) {
    try {
      setLoading(true);
      await setDraftStatus({ leagueId, status });
      alert(`Draft status = ${status}`);
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEntrySettings() {
    try {
      setLoading(true);
      const ref = doc(db, "leagues", leagueId);
      await updateDoc(ref, {
        "entry.enabled": Boolean(entryEnabled),
        "entry.amount": Number(entryAmount) || 0,
      });
      alert("Entry settings saved.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Safe seeding: only MERGE into `players/{id}.projections`
  // Example dummy projections: everyone gets 10.0 for weeks 1..18
  async function handleSeedProjections() {
    try {
      setLoading(true);
      const count = Number(
        prompt(
          "Seed projections for how many players? (This is a demo filler; names will NOT be touched)",
          "100"
        )
      );
      const weeks = 18;
      // We’ll create a “seedProjections/{leagueId}” marker (optional), and rely on an
      // existing Cloud Function/Server action, but here’s a direct Firestore-style demo:
      // Put a flag doc to indicate you kicked off a job (optional)
      await setDoc(
        doc(db, "leagues", leagueId, "adminFlags", "seedProjections"),
        { at: Date.now(), count, weeks },
        { merge: true }
      );
      alert(
        "Seeding projections: this demo assumes a backend job merges projections into players docs.\n"
        + "IMPORTANT: That job must ONLY set {projections:{...}} with merge:true — never overwrite the whole player doc."
      );
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function handleEnsureSchedule() {
    try {
      setLoading(true);
      const res = await ensureSeasonSchedule({ leagueId });
      if (res?.weeksCreated?.length) {
        alert(`Created/updated schedule for weeks: ${res.weeksCreated.join(", ")}`);
      } else {
        alert("Schedule already exists.");
      }
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  if (!leagueId) return <div>No league loaded. (Missing leagueId)</div>;
  if (!league) return <div>Loading league…</div>;
  if (!isOwner) return <div>You are not the league owner.</div>;

  const draft = league?.draft || {};

  return (
    <div style={{ padding: 8 }}>
      <h3 style={{ marginTop: 0 }}>Admin</h3>

      {/* Payments config */}
      <section style={box}>
        <h4>Pi Payments</h4>
        <label style={row}>
          <input
            type="checkbox"
            checked={entryEnabled}
            onChange={(e) => setEntryEnabled(e.target.checked)}
          />
          <span>Require entry fee before drafting</span>
        </label>
        <label style={row}>
          <span style={{ width: 140 }}>Entry Amount (Pi):</span>
          <input
            type="number"
            value={entryAmount}
            onChange={(e) => setEntryAmount(Number(e.target.value))}
            style={{ width: 120 }}
            min={0}
          />
        </label>
        <button onClick={handleSaveEntrySettings} disabled={loading}>
          Save Entry Settings
        </button>
        <div style={hint}>Non-owners pay from the “My Team” tab before draft.</div>
      </section>

      {/* Draft controls */}
      <section style={box}>
        <h4>Draft Controls</h4>
        <div style={row}>
          <b>Status:</b>&nbsp;{draft.status || "(none)"}&nbsp;
          {draft.order?.length ? (
            <span>
              &middot; Teams: {draft.order.length} &middot; Round: {draft.round || 1} &middot; Picks:{" "}
              {draft.picksTaken || 0}
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button onClick={handleInitOrderFromMembers} disabled={loading}>
            Init Order From Members
          </button>
          <button onClick={handleConfigureWithOrderText} disabled={loading}>
            Configure Order (Manual)
          </button>
          <button onClick={() => handleSetStatus("scheduled")} disabled={loading}>
            Set Scheduled
          </button>
          <button onClick={handleStartDraft} disabled={loading}>
            Start Draft
          </button>
          <button onClick={handleEndDraft} disabled={loading}>
            End Draft
          </button>
        </div>
        <div style={hint}>
          Draft can’t start while entry fees are enabled and unpaid members remain.
        </div>
      </section>

      {/* Projections seed (safe merge) */}
      <section style={box}>
        <h4>Seed Projections (Safe Merge)</h4>
        <p style={hint}>
          This should <b>only</b> MERGE into <code>players/{'{id}'}.projections</code>. Names/teams/positions must not be overwritten.
        </p>
        <button onClick={handleSeedProjections} disabled={loading}>
          Seed Demo Projections
        </button>
      </section>

      {/* Schedule */}
      <section style={box}>
        <h4>Schedule</h4>
        <button onClick={handleEnsureSchedule} disabled={loading}>
          Ensure/Recreate Season Schedule
        </button>
        <div style={hint}>
          Creates round-robin matchups in <code>leagues/{'{leagueId}'}/schedule/week-N</code>.
        </div>
      </section>
    </div>
  );
}

const box = {
  padding: 12,
  border: "1px solid #ddd",
  borderRadius: 6,
  marginBottom: 12,
  background: "#fff",
};

const row = { display: "flex", alignItems: "center", gap: 8, margin: "6px 0" };
const hint = { fontSize: 12, color: "#666", marginTop: 6 };
