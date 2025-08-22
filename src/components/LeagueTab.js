/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  listTeams,
  listSeasonSchedule,
  playerDisplay,
  listPlayersMap,
} from "../lib/storage";

export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    (async () => {
      setTeams(await listTeams(leagueId));
      setSchedule(await listSeasonSchedule(leagueId));
      setPlayersMap(await listPlayersMap({ leagueId }));
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  if (!leagueId) return <div>No league.</div>;
  if (!league) return <div>Loading league…</div>;

  const standings = league?.standings || {};

  return (
    <div>
      <h3>League Overview</h3>

      <section style={{ marginBottom: 16 }}>
        <h4>Teams & Records</h4>
        <table border="1" cellPadding="6">
          <thead>
            <tr>
              <th>Team</th>
              <th>W</th>
              <th>L</th>
              <th>T</th>
              <th>PF</th>
              <th>PA</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(t => {
              const rec = standings[t.id] || { wins:0, losses:0, ties:0, pointsFor:0, pointsAgainst:0 };
              return (
                <tr key={t.id}>
                  <td>{t.name || t.id}</td>
                  <td>{rec.wins || 0}</td>
                  <td>{rec.losses || 0}</td>
                  <td>{rec.ties || 0}</td>
                  <td>{rec.pointsFor || 0}</td>
                  <td>{rec.pointsAgainst || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h4>Full Season Schedule</h4>
        {schedule.length === 0 && <div>No schedule yet.</div>}
        {schedule.map(weekDoc => (
          <div key={weekDoc.week} style={{ marginBottom: 12 }}>
            <b>Week {weekDoc.week}</b>
            <ul>
              {(weekDoc.matchups || []).map((m, i) => (
                <li key={i}>
                  {m.home} vs {m.away}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
