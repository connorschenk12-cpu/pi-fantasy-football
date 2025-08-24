/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listTeams,
  getScheduleWeek,
  listPlayersMap,
  ROSTER_SLOTS,
  projForWeek,
} from "../lib/storage";

/** Optional helper: compute actual points from a stats map { [playerId]: { points: number } } */
function actualPointsFor(pid, statsMap) {
  if (!pid || !statsMap) return 0;
  const s = statsMap[pid];
  if (!s) return 0;
  // If you store per-stat breakdowns, sum here; for now accept `points` if present
  if (typeof s.points === "number") return s.points;
  return 0;
}

export default function MatchupsTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [week, setWeek] = useState(1);
  const [schedule, setSchedule] = useState({ week: 1, matchups: [] });
  const [teamsById, setTeamsById] = useState({});
  const [playersMap, setPlayersMap] = useState(new Map());
  const [stats, setStats] = useState(null); // { [playerId]: {...} }

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
      setWeek(Number(l?.settings?.currentWeek || 1));
    });
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!leagueId) return;
      try {
        const arr = await listTeams(leagueId);
        if (!alive) return;
        const by = {};
        arr.forEach((t) => (by[t.id] = t));
        setTeamsById(by);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!leagueId || !week) return;
      try {
        const w = await getScheduleWeek(leagueId, week);
        if (alive) setSchedule(w || { week, matchups: [] });
      } catch (e) {
        console.error("getScheduleWeek error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId, week]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pm = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(pm);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  // TODO: wire your real stats source here; leaving null shows 0 actual
  useEffect(() => {
    setStats(null);
  }, [leagueId, week]);

  const rows = useMemo(() => {
    const out = [];
    (schedule?.matchups || []).forEach((m) => {
      const home = teamsById[m.home];
      const away = teamsById[m.away];
      const homeLines = [];
      const awayLines = [];
      let homeProj = 0;
      let awayProj = 0;
      let homeActual = 0;
      let awayActual = 0;

      ROSTER_SLOTS.forEach((slot) => {
        const hp = home?.roster?.[slot];
        const ap = away?.roster?.[slot];

        const hpProj = hp ? projForWeek(playersMap.get(hp), week) : 0;
        const apProj = ap ? projForWeek(playersMap.get(ap), week) : 0;
        const hpAct = hp ? actualPointsFor(hp, stats) : 0;
        const apAct = ap ? actualPointsFor(ap, stats) : 0;

        homeProj += hpProj; awayProj += apProj;
        homeActual += hpAct; awayActual += apAct;

        homeLines.push({ slot, pid: hp, proj: hpProj, act: hpAct });
        awayLines.push({ slot, pid: ap, proj: apProj, act: apAct });
      });

      out.push({
        key: `${m.home}_${m.away}`,
        homeId: m.home,
        awayId: m.away,
        home,
        away,
        homeLines,
        awayLines,
        totals: {
          homeProj: Number(homeProj.toFixed(1)),
          awayProj: Number(awayProj.toFixed(1)),
          homeActual: Number(homeActual.toFixed(1)),
          awayActual: Number(awayActual.toFixed(1)),
        },
      });
    });
    return out;
  }, [schedule, teamsById, playersMap, stats, week]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Matchups</h3>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 && <div style={{ color: "#777" }}>No matchups scheduled for week {week}.</div>}

      {rows.map((r) => (
        <div key={r.key} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <div>{r.home?.name || r.homeId}</div>
            <div>
              Actual: {r.totals.homeActual} – {r.totals.awayActual}
              <span style={{ color: "#999", marginLeft: 8 }}>
                (Proj: {r.totals.homeProj} – {r.totals.awayProj})
              </span>
            </div>
            <div>{r.away?.name || r.awayId}</div>
          </div>

          <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th width="60">Slot</th>
                <th>Home Player</th>
                <th>Proj</th>
                <th>Act</th>
                <th>Away Player</th>
                <th>Proj</th>
                <th>Act</th>
              </tr>
            </thead>
            <tbody>
              {r.homeLines.map((hl, idx) => {
                const al = r.awayLines[idx];
                return (
                  <tr key={hl.slot} style={{ borderBottom: "1px solid #fafafa" }}>
                    <td><b>{hl.slot}</b></td>
                    <td><PlayerName id={hl.pid} leagueId={leagueId} /></td>
                    <td>{hl.proj.toFixed(1)}</td>
                    <td>{hl.act.toFixed(1)}</td>
                    <td><PlayerName id={al.pid} leagueId={leagueId} /></td>
                    <td>{al.proj.toFixed(1)}</td>
                    <td>{al.act.toFixed(1)}</td>
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
