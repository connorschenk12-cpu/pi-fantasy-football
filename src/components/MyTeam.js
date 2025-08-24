/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenTeam,
  ensureTeam,
  ROSTER_SLOTS,
  listPlayersMap,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
} from "../lib/storage";

/**
 * Props:
 *  - leagueId
 *  - username
 *  - currentWeek
 */
export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        if (!leagueId || !username) return;
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
        const pm = await listPlayersMap({ leagueId });
        setPlayersMap(pm);
      } catch (e) {
        console.error("MyTeam init error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  const week = Number(currentWeek || 1);
  const roster = useMemo(() => team?.roster || {}, [team]);
  const bench = useMemo(() => (Array.isArray(team?.bench) ? team.bench : []), [team]);

  const lines = useMemo(() => {
    const arr = [];
    let total = 0;
    (ROSTER_SLOTS || []).forEach((slot) => {
      const pid = roster?.[slot] || null;
      const p = pid ? playersMap.get(pid) : null;
      const name = displayName(p, pid);
      const opp = p ? opponentForWeek(p, week) : "";
      const proj = p ? projForWeek(p, week) : 0;
      total += Number(proj || 0);
      arr.push({ slot, pid, name, opp, proj });
    });
    return { rows: arr, total: Math.round(total * 10) / 10 };
  }, [playersMap, roster, week]);

  const handleBenchToSlot = async (playerId, slot) => {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter error:", e);
      alert(String(e?.message || e));
    }
  };
  const handleSlotToBench = async (slot) => {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench error:", e);
      alert(String(e?.message || e));
    }
  };

  return (
    <div>
      <h3>My Team</h3>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ width: 60 }}>Slot</th>
            <th>Name</th>
            <th>Opp (W{week})</th>
            <th>Proj (W{week})</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.rows.map((row) => (
            <tr key={row.slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{row.slot}</b></td>
              <td>{row.name}</td>
              <td>{row.opp || "-"}</td>
              <td>{row.proj.toFixed(1)}</td>
              <td>
                {row.pid && (
                  <button onClick={() => handleSlotToBench(row.slot)}>
                    Send to Bench
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} />
            <td><b>{lines.total.toFixed(1)}</b></td>
            <td />
          </tr>
        </tbody>
      </table>

      <h4>Bench</h4>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {bench.map((pid) => {
          const p = playersMap.get(pid);
          const name = displayName(p, pid);
          return (
            <li key={pid} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>{name}</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (!slot) return;
                    handleBenchToSlot(pid, slot);
                  }}
                >
                  <option value="">Move to slot…</option>
                  {(ROSTER_SLOTS || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
        {bench.length === 0 && <li style={{ color: "#888" }}>(no bench players)</li>}
      </ul>
    </div>
  );
}

function displayName(player, fallbackId) {
  if (!player) return String(fallbackId || "(empty)");
  return player.name || player.fullName || player.playerName || String(player.id) || String(fallbackId);
}
