// src/components/LeagueAdmin.js
/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  initDraftOrder,
  startDraft,
  endDraft,
  ensureSeasonSchedule,
  getScheduleAllWeeks,
} from "../lib/storage";
import SeedPlayers from "./SeedPlayers";

/**
 * Props:
 * - leagueId? (string)  // preferred
 * - league?  (object with {id,...})
 * - username (string)
 */
export default function LeagueAdmin(props) {
  // normalize league id from props safely (avoid undefined var)
  const lid = props.leagueId || props.league?.id || null;
  const username = props.username || null;

  // local league state (live)
  const [league, setLeague] = useState(props.league || null);

  useEffect(() => {
    if (!lid) return;
    const unsub = listenLeague(lid, setLeague);
    return () => unsub && unsub();
  }, [lid]);

  const isOwner = useMemo(
    () => Boolean(league?.owner && username && league.owner === username),
    [league?.owner, username]
  );

  // ---- schedule view state ----
  const [sched, setSched] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refreshSchedule = async () => {
    if (!lid) return;
    try {
      setBusy(true);
      const weeks = await getScheduleAllWeeks(lid);
      setSched(weeks || []);
      setMsg("");
    } catch (e) {
      console.error(e);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refreshSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lid]);

  // ---- admin actions ----
  const onInitDraftOrder = async () => {
    if (!lid) return alert("No league loaded");
    try {
      setBusy(true);
      setMsg("Initializing draft order from members…");
      const order = await initDraftOrder({ leagueId: lid });
      setMsg(`Draft order set: ${order.join(" → ")}`);
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onStartDraft = async () => {
    if (!lid) return alert("No league loaded");
    try {
      setBusy(true);
      setMsg("Starting draft…");
      await startDraft({ leagueId: lid });
      setMsg("Draft is now LIVE.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onEndDraft = async () => {
    if (!lid) return alert("No league loaded");
    try {
      setBusy(true);
      setMsg("Ending draft…");
      await endDraft({ leagueId: lid });
      setMsg("Draft marked DONE.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onEnsureSchedule = async () => {
    if (!lid) return alert("No league loaded");
    try {
      setBusy(true);
      setMsg("Ensuring season schedule (round-robin) …");
      const res = await ensureSeasonSchedule({
        leagueId: lid,
        totalWeeks: 14,
        recreate: true, // set true to overwrite if needed
      });
      setMsg(
        res.weeksCreated?.length
          ? `Wrote weeks: ${res.weeksCreated.join(", ")}`
          : "Schedule already existed (no changes)."
      );
      await refreshSchedule();
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!lid) {
    return (
      <div style={{ color: "#b00" }}>
        No league loaded. (Missing league or leagueId)
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
          {JSON.stringify(
            {
              "prop.leagueId": props.leagueId ?? null,
              "prop.league?.id": props.league?.id ?? null,
              username: username ?? null,
            },
            null,
            2
          )}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>League Admin</h3>
      <div style={{ color: "#666", marginBottom: 6 }}>
        League ID: <code>{lid}</code>
      </div>
      {!isOwner && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffeeba", padding: 8, borderRadius: 6, marginBottom: 12 }}>
          You are <b>not</b> the league owner. Some actions will be disabled.
        </div>
      )}

      {/* ---- Draft controls ---- */}
      <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>Draft</h4>
        <div style={{ marginBottom: 8 }}>
          Status: <b>{league?.draft?.status || "unknown"}</b>{" "}
          {league?.draft?.order?.length ? (
            <span style={{ color: "#888" }}>
              &nbsp;• Teams: {league.draft.order.length} • Round: {league?.draft?.round || 1}
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onInitDraftOrder} disabled={!isOwner || busy}>Init Draft Order</button>
          <button onClick={onStartDraft} disabled={!isOwner || busy}>Start Draft</button>
          <button onClick={onEndDraft} disabled={!isOwner || busy}>End Draft</button>
        </div>
      </section>

      {/* ---- Player seeding ---- */}
      <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <SeedPlayers leagueId={lid} />
      </section>

      {/* ---- Schedule ---- */}
      <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Season Schedule</h4>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <button onClick={onEnsureSchedule} disabled={!isOwner || busy}>
            Ensure / Recreate Schedule
          </button>
          <button onClick={refreshSchedule} disabled={busy}>Refresh</button>
        </div>
        {busy && <div>Working…</div>}
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
        <ScheduleTable weeks={sched} />
      </section>
    </div>
  );
}

function ScheduleTable({ weeks }) {
  if (!weeks || weeks.length === 0) {
    return <div style={{ color: "#888" }}>No schedule saved yet.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table cellPadding="6" style={{ borderCollapse: "collapse", minWidth: 520 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Week</th>
            <th>Matchups</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week} style={{ borderBottom: "1px solid #f3f3f3" }}>
              <td>Week {w.week}</td>
              <td>
                {(w.matchups || []).length === 0
                  ? <i style={{ color: "#999" }}>—</i>
                  : (w.matchups || []).map((m, i) => (
                      <div key={i}>
                        <code>{m.home}</code> vs <code>{m.away}</code>
                      </div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
