/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  listPlayersMap,
  playerDisplay,
  computeTeamPoints,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  allowedSlotsForPlayer,
  ROSTER_SLOTS,
  hasPaidEntry,
  leagueIsFree,
  fetchWeekStats,
  projForWeek,
  actualPointsForPlayer,
  opponentForWeek,
} from "../lib/storage.js";

export default function MyTeam({ leagueId, username, currentWeek = 1 }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(null); // Map<playerId, { points, ... }>
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // subscribe league + my team
  useEffect(() => {
    if (!leagueId) return;
    const unsubLeague = listenLeague(leagueId, (L) => setLeague(L));
    const unsubTeam = listenTeam({ leagueId, username, onChange: setTeam });
    return () => {
      unsubLeague && unsubLeague();
      unsubTeam && unsubTeam();
    };
  }, [leagueId, username]);

  // load players map
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (live) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId]);

  // load week stats (actuals)
  const week = Number(currentWeek || 1);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await fetchWeekStats({ leagueId, week });
        if (live) setStatsMap(m);
      } catch (e) {
        console.error("fetchWeekStats:", e);
        if (live) setStatsMap(new Map());
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId, week]);

  // compute totals & per-slot actual/proj for starters
  const starterPoints = useMemo(() => {
    if (!team) return { lines: [], total: 0 };
    return computeTeamPoints({
      roster: team?.roster || {},
      week,
      playersMap,
      statsMap,
    });
  }, [team, playersMap, statsMap, week]);

  const entryRequired = useMemo(() => !leagueIsFree(league), [league]);
  const alreadyPaid = useMemo(() => hasPaidEntry(league, username), [league, username]);

  const draftStatus = league?.draft?.status || "scheduled";
  const draftDone = draftStatus === "done";

  async function handleMoveToStarter(pid, slot) {
    setActing(true);
    try {
      await moveToStarter({ leagueId, username, playerId: pid, slot });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleMoveToBench(slot) {
    setActing(true);
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleRelease(pid) {
    if (!window.confirm("Drop this player from your team?")) return;
    setActing(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId: pid });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  if (loading || !league || !team) {
    return <div>Loading your team…</div>;
  }

  const roster = team?.roster || {};
  const benchIds = Array.isArray(team?.bench) ? team.bench : [];

  // Payment CTA (in My Team)
  const showPaymentCTA = entryRequired && !alreadyPaid;
  const amountPi = Number(league?.entry?.amountPi || 0);

  // helper: compute stats for *any* player (used for bench too)
  function lineForPlayer(pid) {
    const p = pid ? playersMap.get(String(pid)) : null;
    if (!p) return { p: null, proj: 0, actual: 0, scored: 0, opp: "" };
    const proj = projForWeek(p, week) || 0;
    const actual = actualPointsForPlayer(p, week, statsMap) || 0;
    const scored = actual || proj || 0;
    const opp = opponentForWeek(p, week) || "";
    return { p, proj, actual, scored, opp };
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{team?.name || username}</h3>
        <div style={{ color: "#666" }}>
          Week {week} Total: <b>{starterPoints.total.toFixed(1)}</b>
        </div>
      </div>

      {/* Entry Payment CTA */}
      {showPaymentCTA && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            border: "1px dashed #e6b800",
            background: "#fffbe6",
            borderRadius: 8,
          }}
        >
          <b>Entry Fee:</b> {amountPi.toFixed(2)} Pi
          <div style={{ marginTop: 8 }}>
            <a href="/payments" style={{ textDecoration: "none" }}>
              <button>Go to Payments</button>
            </a>
          </div>
          <div style={{ color: "#666", marginTop: 6 }}>
            Once your provider webhook records the payment, this banner disappears automatically.
          </div>
        </div>
      )}

      {/* Draft status banner */}
      <div style={{ color: "#666", marginBottom: 12 }}>
        Draft status: <b>{draftStatus}</b>
        {league?.draft?.scheduledAt ? (
          <> &middot; Scheduled for {new Date(league.draft.scheduledAt).toLocaleString()}</>
        ) : null}
      </div>

      {/* Starters */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Starters</h4>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 70 }}>Slot</th>
              <th>Player</th>
              <th style={{ width: 80 }}>Opp</th>
              <th style={{ width: 90, textAlign: "right" }}>Proj</th>
              <th style={{ width: 90, textAlign: "right" }}>Actual</th>
              <th style={{ width: 90, textAlign: "right" }}>Scored</th>
              <th style={{ width: 260 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => {
              const pid = roster[slot] || null;
              const { p, proj, actual, scored, opp } = lineForPlayer(pid);
              return (
                <tr key={slot} style={{ borderBottom: "1px solid #f6f6f6" }}>
                  <td><b>{slot}</b></td>
                  <td>{p ? playerDisplay(p) : <span style={{ color: "#999" }}>(empty)</span>}</td>
                  <td>{p ? (opp || "—") : "—"}</td>
                  <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{actual.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{scored.toFixed(1)}</td>
                  <td>
                    {p ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button disabled={acting} onClick={() => handleMoveToBench(slot)}>
                          Move to Bench
                        </button>
                        <button disabled={acting} onClick={() => handleRelease(pid)}>
                          Drop
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bench */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Bench</h4>
        {benchIds.length === 0 ? (
          <div style={{ color: "#999" }}>No one on the bench.</div>
        ) : (
          <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Player</th>
                <th style={{ width: 80 }}>Opp</th>
                <th style={{ width: 90, textAlign: "right" }}>Proj</th>
                <th style={{ width: 90, textAlign: "right" }}>Actual</th>
                <th>Allowed Slots</th>
                <th style={{ width: 320 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {benchIds.map((pid) => {
                const { p, proj, actual, opp } = lineForPlayer(pid);
                if (!p) {
                  return (
                    <tr key={pid}>
                      <td colSpan={6} style={{ color: "crimson" }}>
                        Unknown player id on bench: {String(pid)}
                      </td>
                    </tr>
                  );
                }
                const allowed = allowedSlotsForPlayer(p);
                return (
                  <tr key={pid} style={{ borderBottom: "1px solid #f6f6f6" }}>
                    <td>{playerDisplay(p)}</td>
                    <td>{opp || "—"}</td>
                    <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{actual.toFixed(1)}</td>
                    <td>{allowed.length ? allowed.join(", ") : <span style={{ color: "#999" }}>—</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {allowed.map((slot) => (
                          <button
                            key={slot}
                            disabled={acting}
                            onClick={() => handleMoveToStarter(pid, slot)}
                          >
                            Start at {slot}
                          </button>
                        ))}
                        <button disabled={acting} onClick={() => handleRelease(pid)}>
                          Drop
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Helpful hints */}
      <div style={{ color: "#777", marginTop: 12 }}>
        • You can only place players in legal positions (QB/RB/WR/TE/FLEX/K/DEF).<br />
        • “Scored” uses Actual if available; otherwise Projected.<br />
        • Payment button appears here until your entry is recorded as paid.
      </div>

      {/* After-draft reminder for payments still due */}
      {draftDone && showPaymentCTA && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            border: "1px dashed #e6b800",
            background: "#fffbe6",
          }}
        >
          The draft is complete—please complete your entry payment to keep your team eligible.
        </div>
      )}
    </div>
  );
}
