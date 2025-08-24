/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenScheduleWeek,
  listTeams,
  listPlayersMap,
  computeTeamPoints,
  ROSTER_SLOTS,
  playerDisplay,
} from "../lib/storage";

/**
 * Props:
 * - leagueId (required)
 * - currentWeek (number, required)
 */
export default function MatchupsTab({ leagueId, currentWeek }) {
  const [week, setWeek] = useState(Number(currentWeek || 1));
  const [schedule, setSchedule] = useState({ week: Number(currentWeek || 1), matchups: [] });
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());

  // keep local week in sync with prop
  useEffect(() => setWeek(Number(currentWeek || 1)), [currentWeek]);

  // live schedule for selected week
  useEffect(() => {
    if (!leagueId || !week) return;
    const unsub = listenScheduleWeek(leagueId, week, setSchedule);
    return () => unsub && unsub();
  }, [leagueId, week]);

  // static data we need for scoring display
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const [t, pm] = await Promise.all([listTeams(leagueId), listPlayersMap({ leagueId })]);
        if (!alive) return;
        setTeams(t || []);
        setPlayersMap(pm || new Map());
      } catch (e) {
        console.error("MatchupsTab init error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const teamsById = useMemo(() => {
    const m = new Map();
    (teams || []).forEach((t) => m.set(t.id, t));
    return m;
  }, [teams]);

  const rendered = useMemo(() => {
    const out = [];
    for (const m of schedule?.matchups || []) {
      const homeTeam = teamsById.get(m.home);
      const awayTeam = teamsById.get(m.away);
      if (!homeTeam || !awayTeam) continue;

      const homeScore = computeTeamPoints({ roster: homeTeam.roster || {}, week, playersMap });
      const awayScore = computeTeamPoints({ roster: awayTeam.roster || {}, week, playersMap });
      out.push({ m, homeTeam, awayTeam, homeScore, awayScore });
    }
    return out;
  }, [schedule, teamsById, playersMap, week]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Matchups</h3>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      {rendered.length === 0 ? (
        <div style={{ color: "#999" }}>No matchups scheduled for week {week}.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 12 }}>
          {rendered.map(({ m, homeTeam, awayTeam, homeScore, awayScore }, idx) => (
            <div key={`${m.home}_${m.away}_${idx}`} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div><b>{homeTeam.name || m.home}</b></div>
                <div style={{ fontWeight: 700 }}>{homeScore.total.toFixed(1)}</div>
              </div>
              <Lines roster={homeTeam.roster || {}} week={week} playersMap={playersMap} />
              <hr style={{ margin: "10px 0", border: "none", borderTop: "1px solid #f1f1f1" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div><b>{awayTeam.name || m.away}</b></div>
                <div style={{ fontWeight: 700 }}>{awayScore.total.toFixed(1)}</div>
              </div>
              <Lines roster={awayTeam.roster || {}} week={week} playersMap={playersMap} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Lines({ roster, week, playersMap }) {
  return (
    <table cellPadding="4" style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {ROSTER_SLOTS.map((slot) => {
          const pid = roster[slot] || null;
          const p = pid ? playersMap.get(pid) : null;
          return (
            <tr key={slot} style={{ borderBottom: "1px solid #f9f9f9" }}>
              <td style={{ width: 48, color: "#666" }}>{slot}</td>
              <td>{p ? playerDisplay(p) : "(empty)"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
