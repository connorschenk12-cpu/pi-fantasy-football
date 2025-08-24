// src/components/LeagueHome.js
import React, { useEffect, useState } from "react";
import {
  listenTeam,
  computeTeamPoints,
  listPlayersMap,
  pointsForPlayer,
  projForWeek,
  ROSTER_SLOTS,
} from "../lib/storage";
import PlayerName from "./common/PlayerName";

export default function LeagueHome({ leagueId, username, currentWeek = 1 }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());

  // Subscribe to my team
  useEffect(() => {
    if (!leagueId || !username) return;
    return listenTeam({
      leagueId,
      username,
      onChange: setTeam,
    });
  }, [leagueId, username]);

  // Load all players for mapping
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      const map = await listPlayersMap({ leagueId });
      setPlayersMap(map);
    })();
  }, [leagueId]);

  if (!team) return <div>Loading team…</div>;

  const { roster = {}, bench = [] } = team;
  const computed = computeTeamPoints({ roster, week: currentWeek, playersMap });

  return (
    <div style={{ padding: 16 }}>
      <h2>{username} — My Team (Week {currentWeek})</h2>

      {/* Starters */}
      <h3>Starters</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <th>Slot</th>
            <th>Player</th>
            <th>Team</th>
            <th>Pos</th>
            <th>Proj (W{currentWeek})</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {ROSTER_SLOTS.map((slot) => {
            const pid = roster[slot];
            const p = pid ? playersMap.get(pid) : null;
            return (
              <tr key={slot} style={{ borderBottom: "1px solid #eee" }}>
                <td>{slot}</td>
                <td>
                  {pid ? (
                    <PlayerName id={pid} leagueId={leagueId} />
                  ) : (
                    <span style={{ color: "#999" }}>(empty)</span>
                  )}
                </td>
                <td>{p?.team || "-"}</td>
                <td>{p?.position || "-"}</td>
                <td>{projForWeek(p, currentWeek).toFixed(1)}</td>
                <td>{pointsForPlayer(p, currentWeek).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Bench */}
      <h3 style={{ marginTop: 24 }}>Bench</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #ccc" }}>
            <th>Player</th>
            <th>Team</th>
            <th>Pos</th>
            <th>Proj (W{currentWeek})</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {bench.map((pid) => {
            const p = playersMap.get(pid);
            return (
              <tr key={pid} style={{ borderBottom: "1px solid #eee" }}>
                <td>
                  <PlayerName id={pid} leagueId={leagueId} />
                </td>
                <td>{p?.team || "-"}</td>
                <td>{p?.position || "-"}</td>
                <td>{projForWeek(p, currentWeek).toFixed(1)}</td>
                <td>{pointsForPlayer(p, currentWeek).toFixed(1)}</td>
              </tr>
            );
          })}
          {bench.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#999" }}>
                No players on bench
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Team Total */}
      <h3 style={{ marginTop: 24 }}>Team Total (Week {currentWeek})</h3>
      <p>
        <b>{computed.total.toFixed(1)} points</b>
      </p>
    </div>
  );
}
