/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  ensureSeasonSchedule,
  initDraftOrder,
  configureDraft,
  startDraft,
  endDraft,
  setEntrySettings,
  allMembersPaidOrFree,
} from "../lib/storage";

/**
 * Props:
 * - leagueId (required)
 * - username (required) — used to detect owner permissions
 */
export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const isOwner = useMemo(() => league?.owner && username ? league.owner === username : false, [league, username]);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const m = await listMemberUsernames(leagueId);
        if (!alive) return;
        setMembers(m || []);
      } catch (e) {
        console.error("listMemberUsernames error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const draft = league?.draft || {};
  const entry = league?.entry || { enabled: false, amountPi: 0, paid: {} };
  const canStartDraft = draft?.status === "scheduled" && (allMembersPaidOrFree(league));

  const onSeedSchedule = async () => {
    try {
      setBusy(true);
      if (members.length < 2) {
        alert("Need at least 2 members to schedule a season.");
        return;
      }
      await ensureSeasonSchedule({ leagueId, totalWeeks: 14, recreate: true });
      alert("Season schedule (re)created.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onInitOrder = async () => {
    try {
      setBusy(true);
      const order = await initDraftOrder({ leagueId });
      await configureDraft({ leagueId, order });
      alert("Draft order seeded.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onStartDraft = async () => {
    try {
      setBusy(true);
      if (!allMembersPaidOrFree(league)) {
        alert("All members must pay (or league must be free) before starting the draft.");
        return;
      }
      await startDraft({ leagueId });
      alert("Draft started.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onEndDraft = async () => {
    try {
      setBusy(true);
      await endDraft({ leagueId });
      alert("Draft marked as done.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onSetEntry = async (enabled, amountPi) => {
    try {
      setBusy(true);
      await setEntrySettings({ leagueId, enabled, amountPi });
      alert("Entry settings saved.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!leagueId) return <div style={{ color: "#a00" }}>No league loaded. (Missing leagueId prop)</div>;
  if (!isOwner) return <div style={{ color: "#a00" }}>You are not the league owner.</div>;
  if (!league) return <div>Loading league…</div>;

  return (
    <div>
      <h3>Admin</h3>

      <section style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Draft Status</div>
        <div style={{ marginBottom: 6 }}>Status: <b>{draft.status || "scheduled"}</b></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onInitOrder} disabled={busy}>Seed Draft Order</button>
          <button onClick={onStartDraft} disabled={busy || !canStartDraft}>Start Draft</button>
          <button onClick={onEndDraft} disabled={busy}>End Draft</button>
        </div>
        {!allMembersPaidOrFree(league) && (
          <div style={{ color: "#a00", marginTop: 6 }}>
            All members must pay entry (or set league to free) before starting the draft.
          </div>
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Entry / Payments</div>
        <div style={{ marginBottom: 8 }}>
          <label>
            <input
              type="checkbox"
              checked={!!entry.enabled}
              onChange={(e) => onSetEntry(e.target.checked, Number(entry.amountPi || 0))}
              disabled={busy}
            />{" "}
            Enable Entry Fee
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span>Amount (π):</span>
          <input
            type="number"
            min={0}
            value={Number(entry.amountPi || 0)}
            onChange={(e) => onSetEntry(!!entry.enabled, Number(e.target.value || 0))}
            disabled={busy}
            style={{ width: 100 }}
          />
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          Members who have paid: {Object.keys(entry.paid || {}).length}/{members.length}
        </div>
      </section>

      <section>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Season Schedule</div>
        <button onClick={onSeedSchedule} disabled={busy}>Ensure/Recreate Season Schedule</button>
      </section>
    </div>
  );
}
