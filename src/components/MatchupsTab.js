/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenScheduleWeek,
  listPlayersMap,
  listenTeamById,
  computeTeamPoints,
} from "../lib/storage";

export default function MatchupsTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [week, setWeek] = useState(1);
  const [schedule, setSchedule] = useState({ week: 1, matchups: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const currentWeek = Number(league?.settings?.currentWeek || 1);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    setWeek(currentWeek || 1);
  }, [currentWeek]);

  useEffect(() => {
    if (!leagueId || !week) return;
    const unsub = listenScheduleWeek(leagueId, week, setSchedule);
    return () => unsub && unsub();
  }, [leagueId, week]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
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

  const matchups = Array.isArray(schedule?.matchups) ? schedule.matchups : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <b>Week:</b>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>
              Week {i + 1}
            </option>
          ))}
        </select>
      </div>

      {matchups.length === 0 ? (
        <div style={{ color: "#666" }}>No matchups scheduled for week {week}.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {matchups.map((m, idx) => (
            <MatchupCard
              key={idx}
              leagueId={leagueId}
              week={week}
              home={m.home}
              away={m.away}
              playersMap={playersMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchupCard({ leagueId, week, home, away, playersMap }) {
  const [homeTeam, setHomeTeam] = useState(null);
  const [awayTeam, setAwayTeam] = useState(null);

  useEffect(() => {
    if (!leagueId || !home) return;
    const unsub = listenTeamById(leagueId, home, setHomeTeam);
    return () => unsub && unsub();
  }, [leagueId, home]);

  useEffect(() => {
    if (!leagueId || !away) return;
    const unsub = listenTeamById(leagueId, away, setAwayTeam);
    return () => unsub && unsub();
  }, [leagueId, away]);

  const homeScore = useMemo(() => {
    if (!homeTeam) return { total: 0, lines: [] };
    return computeTeamPoints({
      roster: homeTeam.roster || {},
      week,
      playersMap,
    });
  }, [homeTeam, playersMap, week]);

  const awayScore = useMemo(() => {
    if (!awayTeam) return { total: 0, lines: [] };
    return computeTeamPoints({
      roster: awayTeam.roster || {},
      week,
      playersMap,
    });
  }, [awayTeam, playersMap, week]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <b>{home}</b>
        <div>
          <b>{homeScore.total.toFixed(1)}</b> &nbsp;–&nbsp; <b>{awayScore.total.toFixed(1)}</b>
        </div>
        <b>{away}</b>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Side roster={homeTeam?.roster} week={week} playersMap={playersMap} />
        <Side roster={awayTeam?.roster} week={week} playersMap={playersMap} />
      </div>
    </div>
  );
}

function Side({ roster, week, playersMap }) {
  const slots = Object.keys(roster || {});
  return (
    <div>
      {slots.map((slot) => {
        const pid = roster?.[slot];
        const p = pid ? playersMap.get(pid) : null;
        const name =
          (p?.name || p?.fullName || p?.playerName || (pid ? String(pid) : "(empty)"));
        const pts = p?.projections?.[String(week)] ?? 0;
        return (
          <div key={slot} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              <b>{slot}</b>: {name}
            </span>
            <span>{Number(pts || 0).toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
