/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayersMap,
  listenTeam,
  listenLeague,
  moveToBench,
  moveToStarter,
  releasePlayerAndClearSlot,
  computeTeamPoints,
  asId,
  ROSTER_SLOTS,
} from "../lib/storage";
import PlayerBadge from "./common/PlayerBadge";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [week, setWeek] = useState(Number(currentWeek || 1));

  // Subscribe to league + team
  useEffect(() => {
    if (!leagueId) return;
    const unsubL = listenLeague(leagueId, setLeague);
    const unsubT = listenTeam({ leagueId, username, onChange: setTeam });
    return () => {
      unsubL && unsubL();
      unsubT && unsubT();
    };
  }, [leagueId, username]);

  useEffect(() => setWeek(Number(currentWeek || 1)), [currentWeek]);

  // Load global players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      const map = await listPlayersMap();
      if (mounted) setPlayersMap(map || new Map());
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const points = useMemo(() => {
    if (!team) return { lines: [], total: 0 };
    return computeTeamPoints({ roster: team.roster, week, playersMap });
  }, [team, week, playersMap]);

  async function handleBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench:", e);
      alert(String(e?.message || e));
    }
  }

  async function handleStarter(pid, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId: pid, slot });
    } catch (e) {
      console.error("moveToStarter:", e);
      alert(String(e?.message || e));
    }
  }

  async function handleRelease(pid) {
    if (!window.confirm("Release this player?")) return;
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId: pid });
    } catch (e) {
      console.error("releasePlayerAndClearSlot:", e);
      alert(String(e?.message || e));
    }
  }

  const rosterLines = useMemo(() => {
    return (ROSTER_SLOTS || []).map((slot) => {
      const pid = asId(team?.roster?.[slot] || null);
      const p = pid ? playersMap.get(pid) : null;
      const pts = points.lines.find((l) => l.slot === slot);
      return { slot, pid, player: p, pts };
    });
  }, [team, playersMap, points]);

  const benchLines = useMemo(() => {
    return (team?.bench || []).map((pid) => {
      const p = playersMap.get(asId(pid));
      return { pid, player: p };
    });
  }, [team, playersMap]);

  return (
    <div>
      <h2>My Team</h2>
      <div style={{ marginBottom: 8 }}>
        Week:{" "}
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>
              Week {i + 1}
            </option>
          ))}
        </select>
      </div>

      <h3>Starters</h3>
      <table className="table wide-names">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Name</th>
            <th className="num">Points</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rosterLines.map((line) => (
            <tr key={line.slot}>
              <td>{line.slot}</td>
              <td>
                {line.player ? (
                  <PlayerBadge player={line.player} />
                ) : (
                  <span style={{ color: "#999" }}>Empty</span>
                )}
              </td>
              <td className="num">{line.pts?.points?.toFixed(1) || "-"}</td>
              <td>
                {line.pid && (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleBench(line.slot)}
                    >
                      Bench
                    </button>{" "}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleRelease(line.pid)}
                    >
                      Release
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Bench</h3>
      <table className="table wide-names">
        <thead>
          <tr>
            <th>Name</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {benchLines.map((line) => (
            <tr key={line.pid}>
              <td>
                {line.player ? (
                  <PlayerBadge player={line.player} />
                ) : (
                  <span style={{ color: "#999" }}>Unknown</span>
                )}
              </td>
              <td>
                {line.pid && (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleStarter(line.pid, "FLEX")}
                    >
                      Start
                    </button>{" "}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleRelease(line.pid)}
                    >
                      Release
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, fontWeight: "bold" }}>
        Total Points: {points.total.toFixed(1)}
      </div>
    </div>
  );
}
