/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenScheduleWeek,
  listenTeamById,
  listPlayersMap,
  fetchWeekStats,
  computeTeamPoints,
} from "../lib/storage";
import PlayerName from "./common/PlayerName.jsx";

export default function MatchupsTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [week, setWeek] = useState(1);
  const [schedule, setSchedule] = useState({ week: 1, matchups: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(new Map());
  const [teams, setTeams] = useState({}); // username -> team doc

  useEffect(() => {
    if (!leagueId) return;
    const off = listenLeague(leagueId, (l) => {
      setLeague(l);
      setWeek(Number(l?.settings?.currentWeek || 1));
    });
    return () => off && off();
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !week) return;
    const off = listenScheduleWeek(leagueId, week, setSchedule);
    (async () => {
      const pm = await listPlayersMap({ leagueId });
      setPlayersMap(pm);
      const sm = await fetchWeekStats({ leagueId, week });
      setStatsMap(sm);
    })();
    return () => off && off();
  }, [leagueId, week]);

  // bring teams for the two sides we need
  useEffect(() => {
    const offs = [];
    (schedule.matchups || []).forEach((m) => {
      if (m.home && !teams[m.home]) {
        offs.push(
          listenTeamById(leagueId, m.home, (t) =>
            setTeams((prev) => ({ ...prev, [m.home]: t || null }))
          )
        );
      }
      if (m.away && !teams[m.away]) {
        offs.push(
          listenTeamById(leagueId, m.away, (t) =>
            setTeams((prev) => ({ ...prev, [m.away]: t || null }))
          )
        );
      }
    });
    return () => offs.forEach((off) => off && off());
  }, [leagueId, schedule, teams]);

  const rows = useMemo(() => {
    return (schedule.matchups || []).map((m) => {
      const home = teams[m.home] || {};
      const away = teams[m.away] || {};
      const h = computeTeamPoints({ roster: home.roster || {}, week, playersMap, statsMap });
      const a = computeTeamPoints({ roster: away.roster || {}, week, playersMap, statsMap });
      return { ...m, homePts: h.total, awayPts: a.total };
    });
  }, [schedule, teams, week, playersMap, statsMap]);

  return (
    <div>
      <h3>Matchups</h3>
      <div style={{ marginBottom: 8 }}>
        <label>Week&nbsp;</label>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      {(rows || []).map((m, idx) => (
        <div key={idx} style={{ border: "1px solid #eee", padding: 10, margin: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{m.home}</b>
            <span>{m.homePts.toFixed(1)} – {m.awayPts.toFixed(1)}</span>
            <b>{m.away}</b>
          </div>
        </div>
      ))}

      {(!rows || rows.length === 0) && (
        <div style={{ color: "#999" }}>No matchups scheduled for week {week}.</div>
      )}
    </div>
  );
}
