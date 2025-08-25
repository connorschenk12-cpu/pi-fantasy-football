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
  canonId,   // <-- NEW
} from "../lib/storage";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [showDebug, setShowDebug] = useState(false);
  const week = Number(currentWeek || 1);

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
      const rawId = roster[slot] ?? null;
      const key = canonId(rawId);             // <-- canonical lookup
      const p = key ? playersMap.get(key) : null;
      return { slot, id: rawId, key, p };
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

  function nameOf(p, rawId) {
    if (p) return playerDisplay(p);
    if (rawId != null && rawId !== "") return String(asId(rawId));
    return "(empty)";
  }
  const posOf = (p) => p?.position || "-";
  const teamOf = (p) => p?.team || "-";
  const oppOf  = (p) => (p ? (opponentForWeek(p, week) || "-") : "-");
  const projOf = (p) => {
    const val = p ? projForWeek(p, week) : 0;
    return (Number.isFinite(val) ? val : 0).toFixed(1);
  };

  const mapKeys = useMemo(() => Array.from(playersMap.keys()), [playersMap]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>My Team — Week {week}</h3>
        <button onClick={() => setShowDebug((v) => !v)} style={{ fontSize: 12 }}>
          {showDebug ? "Hide debug" : "Show debug"}
        </button>
      </div>

      {showDebug && (
        <div
          style={{
            margin: "10px 0 16px",
            padding: 10,
            border: "1px dashed #bbb",
            borderRadius: 6,
            background: "#fafafa",
            fontFamily: "monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
{`playersMap size: ${playersMap.size}
first few keys: ${mapKeys.slice(0, 10).join(", ")}

roster (raw):
${JSON.stringify(roster, null, 2)}

bench (raw):
${JSON.stringify(bench, null, 2)}
`}
        </div>
      )}

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginTop: 12 }}>
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
          {starters.map(({ slot, id: rawId, key, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p, rawId)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                {rawId ? (
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
            const key = canonId(pid);              // <-- canonical lookup
            const p = key ? playersMap.get(key) : null;
            return (
              <tr key={String(pid)} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{nameOf(p, pid)}</td>
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
