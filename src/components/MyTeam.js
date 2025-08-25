/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  // league + team
  listenLeague,
  listenTeam,
  ensureTeam,
  // players
  listPlayersMap,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  // moves
  moveToStarter,
  moveToBench,
  // entry/payments
  hasPaidEntry,
} from "../lib/storage";

/** Small banner that renders entry-fee state & a Payments button */
function PaymentsGate({ league, leagueId, username }) {
  if (!league?.entry?.enabled) return null; // free league or disabled

  const paid = hasPaidEntry(league, username);
  const amount = Number(league?.entry?.amountPi || 0);
  const checkoutUrl = `/payments?league=${encodeURIComponent(leagueId)}`;

  return (
    <div style={{ margin: "12px 0 16px", padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
      {paid ? (
        <div style={{ color: "#2a9d8f" }}>✅ Entry paid</div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            Entry Fee: <b>{amount} π</b>
          </div>
          <a href={checkoutUrl}>
            <button>Go to Payments</button>
          </a>
          <div style={{ color: "#888", marginTop: 6, fontSize: 12 }}>
            After payment completes, the provider will call our webhook to mark you as paid.
          </div>
        </>
      )}
    </div>
  );
}

/** Allowed lineup slots per position */
function validSlotsFor(p) {
  const pos = String(p?.position || "").toUpperCase();
  if (!pos) return [];
  if (pos === "QB") return ["QB"];
  if (pos === "RB") return ["RB1", "RB2", "FLEX"];
  if (pos === "WR") return ["WR1", "WR2", "FLEX"];
  if (pos === "TE") return ["TE", "FLEX"];
  if (pos === "K") return ["K"];
  if (pos === "DEF") return ["DEF"];
  return [];
}

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  // Live league doc (for entry status, etc.)
  useEffect(() => {
    if (!leagueId) return () => {};
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure team + subscribe
  useEffect(() => {
    if (!leagueId || !username) return;
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error("ensureTeam/listenTeam:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Load players (for id → object lookups)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const id = roster[slot] || null;
      const p = id ? playersMap.get(String(id)) : null;
      return { slot, id, p };
    });
  }, [roster, playersMap]);

  async function handleBenchToSlot(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter:", e);
      alert(String(e?.message || e));
    }
  }

  async function handleSlotToBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench:", e);
      alert(String(e?.message || e));
    }
  }

  function nameOf(p) {
    // If we found the object, use playerDisplay; otherwise show (empty)
    return p ? playerDisplay(p) : "(empty)";
  }

  function posOf(p) {
    return p?.position || "-";
  }

  function teamOf(p) {
    return p?.team || "-";
  }

  function oppOf(p) {
    return p ? (opponentForWeek(p, week) || "-") : "-";
  }

  function projOf(p) {
    const val = p ? projForWeek(p, week) : 0;
    return (Number.isFinite(val) ? val : 0).toFixed(1);
    // (Actual live points will replace this once your stats feed is wired)
  }

  return (
    <div>
      {/* Payments prompt (before/after draft, hidden if already paid or entry disabled) */}
      <PaymentsGate league={league} leagueId={leagueId} username={username} />

      <h3>Starters — Week {week}</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ width: 60 }}>Slot</th>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {starters.map(({ slot, id, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                {id ? (
                  <button onClick={() => handleSlotToBench(slot)}>Send to Bench</button>
                ) : (
                  <span style={{ color: "#999" }}>(empty)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Bench</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj</th>
            <th>Move to slot…</th>
          </tr>
        </thead>
        <tbody>
          {bench.map((pid) => {
            const p = playersMap.get(String(pid));
            const options = validSlotsFor(p);
            return (
              <tr key={pid} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{nameOf(p)}</td>
                <td>{posOf(p)}</td>
                <td>{teamOf(p)}</td>
                <td>{oppOf(p)}</td>
                <td>{projOf(p)}</td>
                <td>
                  {options.length ? (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const slot = e.target.value;
                        if (slot) handleBenchToSlot(pid, slot);
                      }}
                    >
                      <option value="">Choose slot</option>
                      {options.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "#999" }}>No eligible slots</span>
                  )}
                </td>
              </tr>
            );
          })}
          {bench.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#999" }}>(no bench players)</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
