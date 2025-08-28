/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  listPlayersMap,
  computeTeamPoints,
  projForWeek,
  opponentForWeek,
  fetchWeekStats,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  allowedSlotsForPlayer,
  ROSTER_SLOTS,
  hasPaidEntry,
  leagueIsFree,
  payEntry, // sandbox flagging after Pi payment
} from "../lib/storage.js";

// NEW: pretty badge with headshot
import PlayerBadge from "./common/PlayerBadge";

// Pi helper
function getPi() {
  if (typeof window !== "undefined" && window.Pi && typeof window.Pi.init === "function") {
    return window.Pi;
  }
  return null;
}

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

  const week = Number(currentWeek || 1);

  // fetch weekly stats (serverless endpoint -> Map)
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await fetchWeekStats({ leagueId, week });
        if (live) setStatsMap(map || new Map());
      } catch (e) {
        console.warn("fetchWeekStats failed:", e);
        if (live) setStatsMap(new Map()); // fall back gracefully
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId, week]);

  // compute totals with stats
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

  // 🔑 Pay league dues via Pi
  async function handlePayDues() {
    try {
      const Pi = getPi();
      if (!Pi) {
        alert("Pi SDK not found. Open this app in Pi Browser (sandbox).");
        return;
      }
      try {
        await Pi.authenticate(["username", "payments"], (payment) =>
          console.log("incompletePayment", payment)
        );
      } catch (e) {
        console.warn("Re-auth for payments scope failed:", e);
        alert("We need the Pi payments permission to continue.");
        return;
      }
      const amount = Number(league?.entry?.amountPi || 0);
      if (!amount) {
        alert("No league dues amount set.");
        return;
      }
      const memo = `League ${leagueId} entry for @${username}`;
      await Pi.createPayment(
        { amount, memo, metadata: { leagueId, username } },
        {
          onReadyForServerApproval: (paymentId) => console.log("onReadyForServerApproval", paymentId),
          onReadyForServerCompletion: (paymentId, txId) =>
            console.log("onReadyForServerCompletion", paymentId, txId),
          onCancel: (paymentId) => console.log("Payment cancelled", paymentId),
          onError: (error, paymentId) => {
            console.error("Payment error", paymentId, error);
            alert(error?.message || String(error));
          },
        }
      );
      await payEntry({ leagueId, username, txId: "pi-sandbox" });
      alert("Payment recorded (sandbox). Thanks!");
    } catch (e) {
      console.error("handlePayDues error:", e);
      alert(e?.message || String(e));
    }
  }

  function lineFor(slot) {
    return points.lines.find((l) => l.slot === slot) || {
      slot,
      playerId: null,
      player: null,
      actual: 0,
      projected: 0,
      points: 0,
    };
  }

  if (loading || !league || !team) {
    return <div className="container">Loading your team…</div>;
  }

  const benchIds = Array.isArray(team?.bench) ? team.bench : [];
  const roster = team?.roster || {};
  const showPaymentCTA = entryRequired && !alreadyPaid;
  const amountPi = Number(league?.entry?.amountPi || 0);

  return (
    <div className="container">
      {/* Debug marker */}
      <div className="ribbon ribbon-info mb12">
        <b>MyTeam v3 marker:</b> if you can see this box, the latest MyTeam.js is LIVE.
      </div>

      <div className="header">
        <h3 className="m0">{team?.name || username}</h3>
        <div className="badge">Week {week} • Total {points.total.toFixed(1)}</div>
      </div>

      {!leagueIsFree(league) && (
        <div className="muted mb12">
          Current prize pool:{" "}
          <b>{Number(league?.treasury?.poolPi || 0).toFixed(2)} Pi</b>{" "}
          · Rake:{" "}
          <b>{((Number(league?.entry?.rakeBps || 0)) / 100).toFixed(2)}%</b>
        </div>
      )}

      {showPaymentCTA && (
        <div className="ribbon ribbon-warn mb12">
          <div className="ribbon-title">Entry Fee Due</div>
          <div className="ribbon-body">
            <div className="mb8"><b>Amount:</b> {amountPi.toFixed(2)} Pi</div>
            <button className="btn btn-primary" onClick={handlePayDues}>Pay League Dues</button>
          </div>
        </div>
      )}

      {/* Starters */}
      <div className="card mb12">
        <div className="card-title">Starters</div>
        <div className="table-wrap">
          <table className="table lineup">
            <thead>
              <tr>
                <th className="slot">Slot</th>
                <th className="player">Player</th>
                <th>Opp</th>
                <th style={{ textAlign: "right" }}>Proj</th>
                <th style={{ textAlign: "right" }}>Actual</th>
                <th style={{ textAlign: "right" }}>Pts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ROSTER_SLOTS.map((slot) => {
                const pid = roster[slot] || null;
                const p = pid ? playersMap.get(String(pid)) : null;
                const line = lineFor(slot);
                const proj = p ? projForWeek(p, week) : 0;
                const actual = line.actual || 0;
                const opp = p ? opponentForWeek(p, week) : "";

                return (
                  <tr key={slot}>
                    <td className="slot"><b>{slot}</b></td>
                    <td className="player">
                      {p ? (
                        <>
                          <PlayerBadge player={p} right={opp ? `vs ${opp}` : ""} />
                          <span className="player-sub">
                            {(p.team || "-")}{p.position ? ` • ${p.position}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="muted">(empty)</span>
                      )}
                    </td>
                    <td>{opp || "—"}</td>
                    <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{actual ? actual.toFixed(1) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{Number(line.points || 0).toFixed(1)}</td>
                    <td>
                      {p ? (
                        <div className="btnbar">
                          <button className="btn btn-ghost" disabled={acting} onClick={() => handleMoveToBench(slot)}>Bench</button>
                          <button className="btn btn-danger" disabled={acting} onClick={() => handleRelease(pid)}>Release</button>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bench */}
      <div className="card">
        <div className="card-title">Bench</div>
        {benchIds.length === 0 ? (
          <div className="muted">No one on the bench.</div>
        ) : (
          <div className="table-wrap">
            <table className="table lineup">
              <thead>
                <tr>
                  <th className="player">Player</th>
                  <th>Allowed Slots</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {benchIds.map((pid) => {
                  const p = playersMap.get(String(pid));
                  if (!p) {
                    return (
                      <tr key={pid}>
                        <td colSpan={3} style={{ color: "crimson" }}>
                          Unknown player id on bench: {String(pid)}
                        </td>
                      </tr>
                    );
                  }
                  const allowed = allowedSlotsForPlayer(p);
                  return (
                    <tr key={pid}>
                      <td className="player">
                        <PlayerBadge player={p} />
                        <span className="player-sub">
                          {(p.team || "-")}{p.position ? ` • ${p.position}` : ""}
                        </span>
                      </td>
                      <td>{allowed.length ? allowed.join(", ") : "—"}</td>
                      <td>
                        <div className="btnbar">
                          {allowed.map((slot) => (
                            <button
                              key={slot}
                              className="btn btn-primary"
                              disabled={acting}
                              onClick={() => handleMoveToStarter(pid, slot)}
                            >
                              Start at {slot}
                            </button>
                          ))}
                          <button
                            className="btn btn-danger"
                            disabled={acting}
                            onClick={() => handleRelease(pid)}
                          >
                            Release
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
