/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenLeague,
  listenTeam,
  ensureTeam,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
  allowedSlotsForPlayer,
  hasPaidEntry,
} from "../lib/storage";

import { hasPaidEntry } from "../lib/storage"; // already exported

function PaymentsGate({ league, leagueId, username }) {
  if (!league?.entry?.enabled) return null;
  const paid = hasPaidEntry(league, username);

  // Your real Pi checkout URL (or in-app route that opens provider UI)
  const checkoutUrl = `/payments?league=${encodeURIComponent(leagueId)}`;

  return (
    <div style={{ margin: "12px 0", padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
      {paid ? (
        <div style={{ color: "#2a9d8f" }}>✅ Entry paid</div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            Entry Fee: <b>{league?.entry?.amountPi || 0} π</b>
          </div>
          <a href={checkoutUrl}>
            <button>Go to Payments</button>
          </a>
          <div style={{ color: "#888", marginTop: 6, fontSize: 12 }}>
            Once payment completes, the provider will call our webhook and your entry will be marked paid.
          </div>
        </>
      )}
    </div>
  );
}
export default function MyTeam({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  // League sub (used for entry payments + draft state)
  useEffect(() => {
    if (!leagueId) return;
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

  // Load players (for id → name lookups)
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
    return () => { alive = false; };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench.map(String) : [];

  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const id = roster[slot] != null ? String(roster[slot]) : null;
      const p = id ? playersMap.get(id) : null;
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
  }

  const showPayment =
    !!league &&
    !!league.entry &&
    league.entry.enabled === true &&
    !hasPaidEntry(league, username);

  return (
    <div>
      {/* ENTRY FEE NOTICE (My Team only) */}
      {showPayment && (
        <div style={{ marginBottom: 14, padding: 12, border: "1px solid #f3d07b", background: "#fff8e5", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Entry Fee Required</div>
          <div style={{ marginBottom: 10 }}>
            Please complete your entry payment to participate in the draft and season.
          </div>
          {/* Replace the href with your real payments flow URL */}
          <a href="/payments" style={{ textDecoration: "none" }}>
            <button>Go to Payments</button>
          </a>
        </div>
      )}

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
            const p = playersMap.get(pid);
            const allowed = allowedSlotsForPlayer(p);
            return (
              <tr key={pid} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{nameOf(p)}</td>
                <td>{posOf(p)}</td>
                <td>{teamOf(p)}</td>
                <td>{oppOf(p)}</td>
                <td>{projOf(p)}</td>
                <td>
                  {allowed.length ? (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const slot = e.target.value;
                        if (slot) handleBenchToSlot(pid, slot);
                      }}
                    >
                      <option value="">Choose slot</option>
                      {allowed.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "#999" }}>(no valid slots)</span>
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
