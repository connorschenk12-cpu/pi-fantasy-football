/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  emptyRoster,
  asId,
  listPlayersMap,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  projForWeek,
  opponentForWeek,
} from "../lib/storage";
import PlayerBadge from "./common/PlayerBadge";

function normPos(p) {
  const x = String(p || "").toUpperCase();
  if (x === "PK") return "K";
  if (x === "DST" || x === "D/ST" || x === "D-ST") return "DEF";
  return x;
}

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState({ roster: emptyRoster(), bench: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  // live team
  useEffect(() => {
    if (!leagueId || !username) return;
    const unsub = listenTeam({
      leagueId,
      username,
      onChange: (t) => {
        setTeam(t || { roster: emptyRoster(), bench: [] });
      },
    });
    return () => unsub && unsub();
  }, [leagueId, username]);

  // players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m = await listPlayersMap();
        if (mounted) setPlayersMap(m || new Map());
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const pById = (pid) => (pid ? playersMap.get(asId(pid)) : null);

  const rosterLines = useMemo(() => {
    return (ROSTER_SLOTS || []).map((slot) => {
      const pid = team?.roster?.[slot] || null;
      const player = pById(pid);
      const projected = player ? projForWeek(player, week) : 0;
      const opp = player ? opponentForWeek(player, week) : "";
      const pos = player ? normPos(player.position) : "-";
      return { slot, pid, player, projected, opp, pos };
    });
  }, [team, playersMap, week]);

  const benchPlayers = useMemo(() => {
    const ids = Array.isArray(team?.bench) ? team.bench : [];
    return ids.map((pid) => pById(pid)).filter(Boolean);
  }, [team, playersMap]);

  async function doMoveToStarter(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter:", e);
      alert(String(e?.message || e));
    }
  }

  async function doBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench:", e);
      alert(String(e?.message || e));
    }
  }

  async function doRelease(playerId) {
    const ok = typeof window !== "undefined" ? window.confirm("Release this player?") : true;
    if (!ok) return;
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId });
    } catch (e) {
      console.error("releasePlayerAndClearSlot:", e);
      alert(String(e?.message || e));
    }
  }

  return (
    <div className="my-team">
      <h2>Starters</h2>
      <table className="table wide-names">
        {/* Force sane column widths so Player column is visible */}
        <colgroup>
          <col style={{ width: 64 }} />      {/* Slot */}
          <col />                             {/* Player (flex) */}
          <col style={{ width: 84 }} />      {/* Opp */}
          <col style={{ width: 120 }} />     {/* Proj */}
          <col style={{ width: 180 }} />     {/* Actions */}
        </colgroup>
        <thead>
          <tr>
            <th>Slot</th>
            <th>Player</th>
            <th>Opp</th>
            <th className="num">Proj (W{week})</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rosterLines.map(({ slot, pid, player, projected, opp, pos }) => (
            <tr key={slot}>
              <td>{slot}</td>
              <td>
                {player ? (
                  <>
                    <PlayerBadge player={player} />
                    <span className="player-sub">
                      {pos}
                      {player.team ? ` • ${player.team}` : ""}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "#888" }}>— empty —</span>
                )}
              </td>
              <td>{opp || "-"}</td>
              <td className="num">{projected ? projected.toFixed(1) : "0.0"}</td>
              <td>
                {player ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => doBench(slot)}>
                      Bench
                    </button>
                    <button className="btn btn-danger" onClick={() => doRelease(pid)}>
                      Release
                    </button>
                  </div>
                ) : (
                  <span style={{ color: "#999" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Bench</h2>
      <table className="table wide-names">
        <colgroup>
          <col />                          {/* Player (flex) */}
          <col style={{ width: 84 }} />    {/* Opp */}
          <col style={{ width: 120 }} />   {/* Proj */}
          <col style={{ width: 220 }} />   {/* Start At */}
        </colgroup>
        <thead>
          <tr>
            <th>Player</th>
            <th>Opp</th>
            <th className="num">Proj (W{week})</th>
            <th>Start At</th>
          </tr>
        </thead>
        <tbody>
          {benchPlayers.map((bp) => {
            const pos = normPos(bp?.position);

            const slotOptions = (() => {
              switch (pos) {
                case "QB":
                  return ["QB"];
                case "RB":
                  return ["RB1", "RB2", "FLEX"];
                case "WR":
                  return ["WR1", "WR2", "FLEX"];
                case "TE":
                  return ["TE", "FLEX"];
                case "K":
                  return ["K"];
                case "DEF":
                  return ["DEF"];
                default:
                  return ["FLEX"];
              }
            })();

            const legalTargets = slotOptions.filter((slot) => {
              if (slot.startsWith("RB")) return pos === "RB";
              if (slot.startsWith("WR")) return pos === "WR";
              return (
                (slot === "QB" && pos === "QB") ||
                (slot === "TE" && pos === "TE") ||
                (slot === "K" && pos === "K") ||
                (slot === "DEF" && pos === "DEF") ||
                (slot === "FLEX" && (pos === "RB" || pos === "WR" || pos === "TE"))
              );
            });

            return (
              <tr key={bp.id}>
                <td>
                  <PlayerBadge player={bp} />
                  <span className="player-sub">
                    {pos}
                    {bp.team ? ` • ${bp.team}` : ""}
                  </span>
                </td>
                <td>{opponentForWeek(bp, week) || "-"}</td>
                <td className="num">{projForWeek(bp, week).toFixed(1)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {legalTargets.map((slot) => (
                      <button
                        key={slot}
                        className="btn btn-primary"
                        onClick={() => doMoveToStarter(bp.id, slot)}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          {benchPlayers.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#999", paddingTop: 12 }}>
                No one on your bench yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
