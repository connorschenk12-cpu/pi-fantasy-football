/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  ensureTeam,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
  asId,                // <-- IMPORTANT: coerce ids before Map lookup
} from "../lib/storage";
import DebugPanel from "./DebugPanel"; // <-- toggleable debug view

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [showDebug, setShowDebug] = useState(false);
  const week = Number(currentWeek || 1);

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
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // IMPORTANT: coerce roster ids with asId before Map.get(...)
  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const id = asId(raw);
      const p = id ? playersMap.get(id) : null;
      return { slot, rawId: raw, id, p };
    });
  }, [roster, playersMap]);

  const benchRows = useMemo(() => {
    return bench.map((raw) => {
      const id = asId(raw);
      const p = id ? playersMap.get(id) : null;
      return { rawId: raw, id, p };
    });
  }, [bench, playersMap]);

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

  function nameOf(p, fallbackId) {
    // If we found the object, use playerDisplay; otherwise show “(unknown)” + id for clarity
    return p ? playerDisplay(p) : fallbackId ? `(unknown: ${fallbackId})` : "(empty)";
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Starters — Week {week}</h3>
        <button onClick={() => setShowDebug((v) => !v)}>
          {showDebug ? "Hide Debug" : "Show Debug"}
        </button>
      </div>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginTop: 8 }}>
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
          {starters.map(({ slot, rawId, id, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p, id)}</td>
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
          {benchRows.map(({ rawId, id, p }) => (
            <tr key={JSON.stringify(rawId)} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td>{nameOf(p, id)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (slot) handleBenchToSlot(id, slot);
                  }}
                >
                  <option value="">Choose slot</option>
                  {ROSTER_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {benchRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#999" }}>(no bench players)</td>
            </tr>
          )}
        </tbody>
      </table>

      {showDebug && (
        <div style={{ marginTop: 16 }}>
          <DebugPanel leagueId={leagueId} username={username} />
        </div>
      )}
    </div>
  );
}
