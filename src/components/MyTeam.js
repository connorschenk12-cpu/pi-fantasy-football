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
  asId,
} from "../lib/storage";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
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

  // robust getter: accepts "12", 12, or {id:"12"}
  function getPlayer(anyId) {
    const key = asId(anyId);
    return key ? playersMap.get(key) : null;
  }

  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const rawId = roster[slot] || null;
      const p = getPlayer(rawId);
      return { slot, id: rawId, p };
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

  return (
    <div>
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
            const p = getPlayer(pid);
            const key = asId(pid);
            return (
              <tr key={key || String(pid)} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{nameOf(p)}</td>
                <td>{posOf(p)}</td>
                <td>{teamOf(p)}</td>
                <td>{oppOf(p)}</td>
                <td>{projOf(p)}</td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const slot = e.target.value;
                      if (slot) handleBenchToSlot(pid, slot);
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
