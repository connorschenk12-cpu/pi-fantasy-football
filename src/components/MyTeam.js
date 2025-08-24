/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenTeam,
  ensureTeam,
  listPlayersMap,
  computeTeamPoints,
  ROSTER_SLOTS,
} from "../lib/storage";
import PlayerName from "./common/PlayerName";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  useEffect(() => {
    if (!leagueId || !username) return;
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(m);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const totals = useMemo(() => {
    return computeTeamPoints({ roster, week, playersMap });
  }, [roster, week, playersMap]);

  return (
    <div>
      <h3>Starters (Week {week}) — Total: {totals.total.toFixed(1)}</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {ROSTER_SLOTS.map((s) => {
          const pid = roster[s] || null;
          const p = pid ? playersMap.get(pid) : null;
          const pts = totals.lines.find((l) => l.slot === s)?.points || 0;
          return (
            <li key={s} style={{ marginBottom: 6 }}>
              <b style={{ width: 40, display: "inline-block" }}>{s}</b>{" "}
              <PlayerName id={pid} playersMap={playersMap} />{" "}
              <span style={{ color: "#888" }}>{p?.position || ""} {p?.team ? `• ${p.team}` : ""}</span>
              <span style={{ float: "right" }}>{pts.toFixed(1)}</span>
            </li>
          );
        })}
      </ul>

      <h3>Bench</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {bench.length === 0 && <li>(empty)</li>}
        {bench.map((pid) => {
          const p = playersMap.get(pid);
          return (
            <li key={pid} style={{ marginBottom: 6 }}>
              <PlayerName id={pid} playersMap={playersMap} />{" "}
              <span style={{ color: "#888" }}>{p?.position || ""} {p?.team ? `• ${p.team}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
