/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listTeams,
  getScheduleAllWeeks,
  ensureSeasonSchedule,
  playerDisplay,
  listPlayersMap,
} from "../lib/storage";

export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [schedule, setSchedule] = useState([]);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    (async () => {
      try {
        if (!leagueId) return;
        const arr = await listTeams(leagueId);
        setTeams(arr || []);
        const m = await listPlayersMap({ leagueId });
        setPlayersMap(m);
        const sched = await getScheduleAllWeeks(leagueId);
        setSchedule(sched || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [leagueId]);

  const standings = useMemo(() => league?.standings || {}, [league]);

  async function handleEnsureSchedule() {
    try {
      const res = await ensureSeasonSchedule({ leagueId });
      if (res?.weeksCreated?.length) {
        alert(`Created/updated weeks: ${res.weeksCreated.join(", ")}`);
        const sched = await getScheduleAllWeeks(leagueId);
        setSchedule(sched || []);
      } else {
        alert("Schedule already exists.");
      }
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section>
        <h3>Teams</h3>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
              <th>Owner</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th>PF</th>
              <th>PA</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const s = standings[t.id] || {};
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid #f4f4f4" }}>
                  <td>{t.name || t.id}</td>
                  <td>{s.wins || 0}</td>
                  <td>{s.losses || 0}</td>
                  <td>{s.ties || 0}</td>
                  <td>{s.pointsFor || 0}</td>
                  <td>{s.pointsAgainst || 0}</td>
                </tr>
              );
            })}
            {teams.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#666" }}>
                  No teams yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Season Schedule</h3>
          <button onClick={handleEnsureSchedule}>Ensure/Recreate Schedule</button>
        </div>
        {schedule.length === 0 ? (
          <div style={{ color: "#666", marginTop: 6 }}>No schedule yet.</div>
        ) : (
          schedule.map((w) => (
            <div key={w.week} style={{ marginTop: 10 }}>
              <b>Week {w.week}</b>
              <ul style={{ margin: "6px 0 0 18px" }}>
                {(w.matchups || []).map((m, i) => (
                  <li key={i}>
                    {m.home} vs {m.away}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
