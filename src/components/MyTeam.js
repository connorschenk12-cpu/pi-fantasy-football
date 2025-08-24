/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  ROSTER_SLOTS,
  listPlayersMap,
  fetchWeekStats,
  computeTeamPoints,
} from "../lib/storage";
import PlayerName from "./common/PlayerName.jsx";

export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(new Map());

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  useEffect(() => {
    if (!leagueId) return;
    const off = listenLeague(leagueId, setLeague);
    return () => off && off();
  }, [leagueId]);

  useEffect(() => {
    let unsub = null;
    (async () => {
      if (!leagueId || !username) return;
      await ensureTeam({ leagueId, username });
      unsub = listenTeam({ leagueId, username, onChange: setTeam });
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  useEffect(() => {
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        setPlayersMap(map);
        const sMap = await fetchWeekStats({ leagueId, week: currentWeek });
        setStatsMap(sMap);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [leagueId, currentWeek]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const totals = useMemo(() => {
    return computeTeamPoints({ roster, week: currentWeek, playersMap, statsMap });
  }, [roster, currentWeek, playersMap, statsMap]);

  async function handleBenchToSlot(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      alert(String(e?.message || e));
    }
  }
  async function handleSlotToBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  return (
    <div>
      <h3>My Team</h3>

      <h4>Starters</h4>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ width: 60 }}>Slot</th>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Pts (W{currentWeek})</th>
          </tr>
        </thead>
        <tbody>
          {ROSTER_SLOTS.map((slot) => {
            const pid = roster?.[slot];
            const p = pid ? playersMap.get(String(pid)) : null;
            const line = totals.lines.find((l) => l.slot === slot) || { points: 0 };
            return (
              <tr key={slot} style={{ borderBottom: "1px solid #f4f4f4" }}>
                <td><b>{slot}</b></td>
                <td><PlayerName leagueId={leagueId} playerId={pid} fallback="(empty)" /></td>
                <td>{p?.position || "-"}</td>
                <td>{p?.team || "-"}</td>
                <td>{Number(line.points || 0).toFixed(1)}</td>
                <td>
                  {pid && (
                    <button onClick={() => handleSlotToBench(slot)}>Send to Bench</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: "right" }}><b>Total</b></td>
            <td><b>{totals.total.toFixed(1)}</b></td>
          </tr>
        </tfoot>
      </table>

      <h4 style={{ marginTop: 16 }}>Bench</h4>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {bench.map((pid) => {
          const p = playersMap.get(String(pid));
          return (
            <li key={pid} style={{ marginBottom: 6 }}>
              <PlayerName leagueId={leagueId} playerId={pid} fallback="(empty)" />{" "}
              <small>({p?.position || "-"} – {p?.team || "-"})</small>
              {"  "}
              <select
                defaultValue=""
                onChange={(e) => e.target.value && handleBenchToSlot(pid, e.target.value)}
                style={{ marginLeft: 8 }}
              >
                <option value="">Move to slot…</option>
                {ROSTER_SLOTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </li>
          );
        })}
        {bench.length === 0 && <li>(no bench players)</li>}
      </ul>
    </div>
  );
}
