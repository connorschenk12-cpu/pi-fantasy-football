/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  // league/team
  listenLeague,
  listenTeam,
  // players & points
  listPlayersMap,
  playerDisplay,
  computeTeamPoints,
  projForWeek,
  opponentForWeek,
  fetchWeekStats,
  // roster actions
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  allowedSlotsForPlayer,
  // constants
  ROSTER_SLOTS,
  // payments
  hasPaidEntry,
  leagueIsFree,
  paymentCheckoutUrl,
} from "../lib/storage.js";

export default function MyTeam({ leagueId, username, currentWeek = 1 }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(new Map());
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

  // load players map (once per league)
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

  const week = Number(currentWeek || 1);

  // load week stats -> statsMap
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await fetchWeekStats({ leagueId, week }); // Map<string, {points, ...}>
        if (live) setStatsMap(map || new Map());
      } catch (e) {
        console.warn("fetchWeekStats error:", e);
        if (live) setStatsMap(new Map());
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId, week]);

  // compute team points using actual when present else projection
  const points = useMemo(() => {
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
    if (!window.confirm("Release this player from your team?")) return;
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

  const benchIds = Array.isArray(team?.bench) ? team.bench : [];
  const roster = team?.roster || {};

  // Payment CTA (only when enabled and not paid)
  const showPaymentCTA = entryRequired && !alreadyPaid;
  const amountPi = Number(league?.entry?.amountPi || 0);
  const payHref = paymentCheckoutUrl({ leagueId, username });

  const fmt1 = (n) => Number(n || 0).toFixed(1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{team?.name || username}</h3>
        <div style={{ color: "#666" }}>
          Week {week} Total: <b>{fmt1(points.total)}</b>
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <b>Entry Fee:</b> {amountPi.toFixed(2)} Pi
              <div style={{ color: "#666", marginTop: 6 }}>
                Pay to become eligible (this banner hides once your payment is recorded).
              </div>
            </div>
            <a href={payHref} style={{ textDecoration: "none" }}>
              <button>Pay Entry with Pi</button>
            </a>
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
              <th style={{ width: 70, textAlign: "right" }}>Proj</th>
              <th style={{ width: 70, textAlign: "right" }}>Actual</th>
              <th style={{ width: 80, textAlign: "right" }}>Used</th>
              <th style={{ width: 260 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => {
              const pid = roster[slot] || null;
              const p = pid ? playersMap.get(String(pid)) : null;
              const line = points.lines.find((l) => l.slot === slot);
              const used = line ? Number(line.points || 0) : 0;
              const proj = p ? projForWeek(p, week) : 0;

              // try to show opponent shorthand, if any
              const opp = p ? (opponentForWeek(p, week) || "—") : "—";

              // actual from statsMap (computeTeamPoints prefers actual, falls back to proj)
              const actual = line ? Number(line.actual || 0) : 0;

              return (
                <tr key={slot} style={{ borderBottom: "1px solid #f6f6f6" }}>
                  <td><b>{slot}</b></td>
                  <td>{p ? playerDisplay(p) : <span style={{ color: "#999" }}>(empty)</span>}</td>
                  <td>{opp}</td>
                  <td style={{ textAlign: "right" }}>{fmt1(proj)}</td>
                  <td style={{ textAlign: "right" }}>{fmt1(actual)}</td>
                  <td style={{ textAlign: "right" }}>
                    <b>{fmt1(used)}</b>
                  </td>
                  <td>
                    {p ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button disabled={acting} onClick={() => handleMoveToBench(slot)}>
                          Move to Bench
                        </button>
                        <button disabled={acting} onClick={() => handleRelease(pid)}>
                          Release
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
                <th style={{ width: 70, textAlign: "right" }}>Proj</th>
                <th style={{ width: 70, textAlign: "right" }}>Actual</th>
                <th>Allowed Slots</th>
                <th style={{ width: 320 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {benchIds.map((pid) => {
                const p = playersMap.get(String(pid));
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
                const opp = opponentForWeek(p, week) || "—";
                const proj = projForWeek(p, week) || 0;
                const srow = statsMap.get(String(p.id)) || null;
                const actual = srow ? Number(srow.points || 0) : 0;

                return (
                  <tr key={pid} style={{ borderBottom: "1px solid #f6f6f6" }}>
                    <td>{playerDisplay(p)}</td>
                    <td>{opp}</td>
                    <td style={{ textAlign: "right" }}>{fmt1(proj)}</td>
                    <td style={{ textAlign: "right" }}>{fmt1(actual)}</td>
                    <td>
                      {allowed.length ? allowed.join(", ") : <span style={{ color: "#999" }}>—</span>}
                    </td>
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
                          Release
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
        • “Actual” uses the /api/stats/week feed; “Proj” comes from stored projections if present.<br />
        • “Used” = Actual (if available) otherwise Proj.<br />
        • You can only place players in legal positions (QB/RB/WR/TE/FLEX/K/DEF).
      </div>
    </div>
  );
}
