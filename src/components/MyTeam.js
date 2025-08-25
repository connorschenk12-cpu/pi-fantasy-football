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
  getPlayerById, // fallback fetch if a mapped player lacks name
} from "../lib/storage";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [resolved, setResolved] = useState(new Map()); // id -> richer player
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

  // Build starter rows (matchups uses this same style)
  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const pid = asId(raw);
      // prefer resolved → playersMap
      const p = pid
        ? (resolved.get(pid) || playersMap.get(pid) || null)
        : null;
      return { slot, pid, p };
    });
  }, [roster, playersMap, resolved]);

  // Opportunistically resolve any players that still show up as (unknown)
  useEffect(() => {
    if (!leagueId) return;
    const want = new Set();

    // collect ids from starters + bench
    ROSTER_SLOTS.forEach((slot) => {
      const pid = asId(roster[slot]);
      if (pid) want.add(pid);
    });
    (bench || []).forEach((b) => {
      const pid = asId(b);
      if (pid) want.add(pid);
    });

    // for any id that maps to a player without a usable display name, fetch by doc id
    (async () => {
      const updates = new Map(resolved);
      for (const pid of want) {
        const p0 = playersMap.get(pid);
        const hasGoodName =
          !!(p0 && playerDisplay(p0) && playerDisplay(p0) !== "(unknown)" && playerDisplay(p0) !== "(empty)");

        if (!hasGoodName) {
          try {
            const fetched = await getPlayerById({ leagueId, id: pid });
            if (fetched && playerDisplay(fetched) && playerDisplay(fetched) !== "(unknown)") {
              updates.set(pid, fetched);
            }
          } catch (e) {
            // ignore
          }
        }
      }
      if (updates.size !== resolved.size) {
        setResolved(updates);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, roster, bench, playersMap]);

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

  const nameOf = (p) => (p ? playerDisplay(p) : "(empty)");
  const posOf = (p) => p?.position || "-";
  const teamOf = (p) => p?.team || "-";
  const oppOf = (p) => (p ? (opponentForWeek(p, week) || "-") : "-");
  const projOf = (p) => {
    const val = p ? projForWeek(p, week) : 0;
    return (Number.isFinite(val) ? val : 0).toFixed(1);
  };

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
          {starters.map(({ slot, pid, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                {pid ? (
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
          {bench.map((pidRaw) => {
            const pid = asId(pidRaw);
            const p = pid ? (resolved.get(pid) || playersMap.get(pid) || null) : null;
            return (
              <tr key={pid || String(pidRaw)} style={{ borderBottom: "1px solid #f5f5f5" }}>
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
