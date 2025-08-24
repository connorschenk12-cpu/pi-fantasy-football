/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenScheduleWeek,
  listPlayersMap,
  listenTeamById,
  computeTeamPoints,
  asId,
  ROSTER_SLOTS,
} from "../lib/storage";
import PlayerName from "./common/PlayerName";

export default function MatchupsTab({ leagueId, currentWeek }) {
  const [sched, setSched] = useState({ week: Number(currentWeek || 1), matchups: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const [teams, setTeams] = useState({}); // username -> team

  const week = Number(currentWeek || 1);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenScheduleWeek(leagueId, week, setSched);
    return () => unsub && unsub();
  }, [leagueId, week]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(m);
      } catch (e) { console.error(e); }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Subscribe to each team in the week’s matchups
  useEffect(() => {
    if (!leagueId) return;
    const unsubs = [];
    const nextTeams = {};

    (sched.matchups || []).forEach(({ home, away }) => {
      [home, away].forEach((u) => {
        const unsub = listenTeamById(leagueId, u, (t) => {
          nextTeams[u] = t;
          // force shallow copy to trigger re-render
          setTeams((prev) => ({ ...prev, [u]: t }));
        });
        unsubs.push(unsub);
      });
    });

    return () => unsubs.forEach((u) => u && u());
  }, [leagueId, sched.matchups]);

  const rows = useMemo(() => {
    return (sched.matchups || []).map(({ home, away }) => {
      const homeTeam = teams[home] || {};
      const awayTeam = teams[away] || {};
      const homeTotals = computeTeamPoints({ roster: homeTeam.roster || {}, week, playersMap });
      const awayTotals = computeTeamPoints({ roster: awayTeam.roster || {}, week, playersMap });
      return { home, away, homeTeam, awayTeam, homeTotals, awayTotals };
    });
  }, [sched.matchups, teams, week, playersMap]);

  if (!sched || (sched.matchups || []).length === 0) {
    return <div style={{ color: "#999" }}>No matchups scheduled for week {week}.</div>;
  }

  return (
    <div>
      <h3>Week {week} Matchups</h3>
      {rows.map((m) => (
        <div key={`${m.home}_vs_${m.away}`} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <b>{m.home}</b>
            <span>{m.homeTotals.total.toFixed(1)} — {m.awayTotals.total.toFixed(1)}</span>
            <b>{m.away}</b>
          </div>

          <table width="100%" cellPadding="4" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Slot</th>
                <th>Home Player</th>
                <th style={{ textAlign: "right" }}>Pts</th>
                <th> </th>
                <th>Away Player</th>
                <th style={{ textAlign: "right" }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {ROSTER_SLOTS.map((slot) => {
                const hRaw = (m.homeTeam.roster || {})[slot] ?? null;
                const aRaw = (m.awayTeam.roster || {})[slot] ?? null;

                const hKey = hRaw == null ? null : (playersMap.has(hRaw) ? hRaw : asId(hRaw));
                const aKey = aRaw == null ? null : (playersMap.has(aRaw) ? aRaw : asId(aRaw));

                const h = hKey == null ? null : playersMap.get(hKey);
                const a = aKey == null ? null : playersMap.get(aKey);

                const hPts = (m.homeTotals.lines.find((l) => l.slot === slot)?.points) || 0;
                const aPts = (m.awayTotals.lines.find((l) => l.slot === slot)?.points) || 0;

                return (
                  <tr key={slot} style={{ borderBottom: "1px solid #f7f7f7" }}>
                    <td>{slot}</td>
                    <td><PlayerName id={hRaw} playersMap={playersMap} /></td>
                    <td style={{ textAlign: "right" }}>{hPts.toFixed(1)}</td>
                    <td style={{ color: "#ccc" }}>vs</td>
                    <td><PlayerName id={aRaw} playersMap={playersMap} /></td>
                    <td style={{ textAlign: "right" }}>{aPts.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
