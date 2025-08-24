/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  initDraftOrder,
  configureDraft,
  startDraft,
  endDraft,
  setEntrySettings,
  ensureSeasonSchedule,
  getScheduleAllWeeks,
  allMembersPaidOrFree,
  currentDrafter,
} from "../lib/storage";
import EntryFeePanel from "./EntryFeePanel";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sched, setSched] = useState([]);
  const [error, setError] = useState("");

  // Load league live
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Load member list (one-shot)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const arr = await listMemberUsernames(leagueId);
        if (mounted) setMembers(arr);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  const isOwner = useMemo(
    () => !!(league?.owner && username && league.owner === username),
    [league, username]
  );

  const draftOrder = useMemo(
    () => (Array.isArray(league?.draft?.order) ? league.draft.order : []),
    [league]
  );

  const draftStatus = league?.draft?.status || "scheduled";
  const onClock = currentDrafter(league);

  // Load schedule table (if exists)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const weeks = await getScheduleAllWeeks(leagueId);
        if (mounted) setSched(weeks || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  const handleSeedOrderFromMembers = async () => {
    setBusy(true);
    setError("");
    try {
      const seeded = await initDraftOrder({ leagueId });
      alert(`Draft order set from members:\n${seeded.join(" → ")}`);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleResetDraftKeepOrder = async () => {
    setBusy(true);
    setError("");
    try {
      await configureDraft({ leagueId, order: draftOrder });
      alert("Draft reset to round 1 (order preserved).");
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleStartDraft = async () => {
    setBusy(true);
    setError("");
    try {
      // Block if payments enabled and someone hasn’t paid
      const ok = await allMembersPaidOrFree({ leagueId });
      if (!ok) {
        setError("All members must pay (or disable entry fee) before starting the draft.");
        setBusy(false);
        return;
      }
      await startDraft({ leagueId });
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleEndDraft = async () => {
    setBusy(true);
    setError("");
    try {
      await endDraft({ leagueId });
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleEnsureSchedule = async (recreate) => {
    setBusy(true);
    setError("");
    try {
      const res = await ensureSeasonSchedule({ leagueId, totalWeeks: 14, recreate });
      if (res?.weeksCreated?.length) {
        alert(`Schedule written for weeks: ${res.weeksCreated.join(", ")}`);
      } else {
        alert("Schedule already exists (no change).");
      }
      const weeks = await getScheduleAllWeeks(leagueId);
      setSched(weeks || []);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!leagueId) {
    return <div style={{ color: "crimson" }}>No league loaded. (Missing leagueId prop)</div>;
  }
  if (!league) {
    return <div>Loading league…</div>;
  }

  return (
    <div>
      <h2>Admin: {league?.name || leagueId}</h2>

      {error && (
        <div style={{ margin: "8px 0", color: "crimson" }}>
          {error}
        </div>
      )}

      {/* Entry fee / payments */}
      <section style={sectionStyle}>
        <h3 style={h3Style}>Pi Payments</h3>
        <p style={{ marginTop: -6, color: "#666" }}>
          Require entry fees before drafting. Amount can be 0 for free leagues.
        </p>
        <EntryFeePanel leagueId={leagueId} username={username} isOwner={isOwner} />
      </section>

      {/* Draft controls */}
      <section style={sectionStyle}>
        <h3 style={h3Style}>Draft Setup</h3>
        <div style={{ marginBottom: 8, color: "#444" }}>
          <b>Status:</b> {draftStatus}
          {draftStatus === "live" && onClock ? <> • <b>On the clock:</b> {onClock}</> : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button disabled={busy} onClick={handleSeedOrderFromMembers}>
            Seed order from members
          </button>
          <button disabled={busy || draftOrder.length === 0} onClick={handleResetDraftKeepOrder}>
            Reset draft (keep order)
          </button>
          <button disabled={busy || draftStatus === "live"} onClick={handleStartDraft}>
            Start draft
          </button>
          <button disabled={busy || draftStatus !== "live"} onClick={handleEndDraft}>
            End draft
          </button>
        </div>

        <div>
          <b>Draft order:</b>{" "}
          {draftOrder.length ? draftOrder.join(" → ") : <i>(not set)</i>}
        </div>
      </section>

      {/* Scheduling */}
      <section style={sectionStyle}>
        <h3 style={h3Style}>Season Schedule</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button disabled={busy} onClick={() => handleEnsureSchedule(false)}>
            Ensure schedule (keep if exists)
          </button>
          <button disabled={busy} onClick={() => handleEnsureSchedule(true)}>
            Recreate schedule
          </button>
        </div>

        {sched.length === 0 ? (
          <div style={{ color: "#666" }}>No schedule found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {sched.map((w) => (
              <div key={w.week} style={{ marginBottom: 8 }}>
                <b>Week {w.week}</b>
                <ul style={{ marginTop: 4 }}>
                  {(w.matchups || []).map((m, i) => (
                    <li key={i}>
                      {m.home} vs {m.away}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Members */}
      <section style={sectionStyle}>
        <h3 style={h3Style}>Members</h3>
        <div>{members.length ? members.join(", ") : "(none)"}</div>
      </section>
    </div>
  );
}

const sectionStyle = { padding: 12, border: "1px solid #eee", borderRadius: 8, margin: "12px 0" };
const h3Style = { margin: "0 0 8px 0" };
