/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenTeam,
  ensureTeam,
  ROSTER_SLOTS,
  moveToStarter,
  moveToBench,
  listPlayersMap,
  computeTeamPoints,
  playerDisplay,
} from "../lib/storage";
import PlayerName from "./common/PlayerName";

/**
 * Props:
 *  - leagueId (string)
 *  - username (string)
 */
export default function MyTeam({ leagueId, username }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());

  // ensure + listen to my team
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        if (!leagueId || !username) return;
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error("ensure/listen team error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // load players map for names
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await listPlayersMap({ leagueId });
        if (!cancelled) setPlayersMap(m);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

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

  // (Optional) compute projected total if you pass a week in from parent later
  const week = 1;
  const totals = useMemo(
    () => computeTeamPoints({ roster, week, playersMap }),
    [roster, week, playersMap]
  );

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Starters</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {ROSTER_SLOTS.map((s) => {
          const pid = roster[s];
          const p = pid ? playersMap.get(pid) : null;
          return (
            <li key={s} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <b style={{ width: 44 }}>{s}</b>
                <span>
                  {pid ? (
                    <PlayerName leagueId={leagueId} playerId={pid} fallback={playerDisplay(p)} />
                  ) : (
                    "(empty)"
                  )}
                </span>
                {pid && (
                  <button onClick={() => handleSlotToBench(s)} style={{ marginLeft: 8 }}>
                    Send to Bench
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ marginTop: 12, marginBottom: 8, color: "#444" }}>
        Projected total (W{week}): <b>{totals.total.toFixed(1)}</b>
      </div>

      <h3>Bench</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {bench.map((pid) => {
          const p = playersMap.get(pid);
          return (
            <li key={pid} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ minWidth: 220 }}>
                  <PlayerName leagueId={leagueId} playerId={pid} fallback={playerDisplay(p)} />
                </span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (slot) handleBenchToSlot(pid, slot);
                  }}
                >
                  <option value="">Move to slot…</option>
                  {ROSTER_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
        {bench.length === 0 && <li>(no bench players)</li>}
      </ul>
    </div>
  );
}
