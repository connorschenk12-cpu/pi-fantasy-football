/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, projForWeek, opponentForWeek } from "../lib/storage";

export default function PlayersList({ leagueId, currentWeek = 1 }) {
  const [players, setPlayers] = useState([]);
  const [week, setWeek] = useState(currentWeek);
  const [teamFilter, setTeamFilter] = useState(""); // NFL team filter like KC, DAL…

  useEffect(() => {
    (async () => { setPlayers(await listPlayers({ leagueId })); })();
  }, [leagueId]);

  const teamsList = useMemo(() => {
    const s = new Set();
    players.forEach(p => { if (p.team) s.add(p.team); });
    return ["", ...Array.from(s).sort()];
  }, [players]);

  const enhanced = useMemo(() => {
    const arr = players.map(p => {
      const wk = projForWeek(p, week);
      // crude season total: sum of all available projection weeks on the doc
      let season = 0;
      if (p.projections && typeof p.projections === "object") {
        Object.values(p.projections).forEach(v => season += Number(v||0));
      }
      const opp = opponentForWeek(p, week);
      return { ...p, weekProj: wk, seasonProj: Math.round(season*100)/100, opp };
    });
    return arr
      .filter(p => (teamFilter ? String(p.team||"") === teamFilter : true))
      .sort((a,b)=> b.weekProj - a.weekProj);
  }, [players, week, teamFilter]);

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <label>Week:&nbsp;
          <select value={week} onChange={e=>setWeek(Number(e.target.value))}>
            {Array.from({length:18},(_,i)=>i+1).map(w=>(
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </label>
        <label>Team:&nbsp;
          <select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)}>
            {teamsList.map(t => <option key={t||"ALL"} value={t}>{t || "All teams"}</option>)}
          </select>
        </label>
      </div>

      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Pos</th>
            <th align="left">NFL</th>
            <th align="left">Opp</th>
            <th align="right">Week Proj</th>
            <th align="right">Season Proj</th>
          </tr>
        </thead>
        <tbody>
          {enhanced.map(p=>(
            <tr key={p.id} style={{ borderTop:"1px solid #eee" }}>
              <td>{p.name || p.fullName || p.playerName || p.id}</td>
              <td>{p.position}</td>
              <td>{p.team || "-"}</td>
              <td>{p.opp || "-"}</td>
              <td align="right">{p.weekProj?.toFixed(2)}</td>
              <td align="right">{p.seasonProj?.toFixed(2)}</td>
            </tr>
          ))}
          {!enhanced.length && (
            <tr><td colSpan={6} style={{ padding:12, textAlign:"center" }}>
              No players found. Add players to Firestore.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
