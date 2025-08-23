/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { listPlayers } from "../lib/storage";
import PlayerName from "./common/PlayerName";

/**
 * Props:
 *  - leagueId
 *  - currentWeek (number)
 */
export default function LeagueTab({ leagueId, currentWeek = 1 }) {
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [weekData, setWeekData] = useState(null);

  // Load teams
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        const col = collection(db, "leagues", leagueId, "teams");
        const snap = await getDocs(col);
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setTeams(arr);
      } catch (e) {
        console.error("LeagueTab teams error:", e);
      }
    })();
  }, [leagueId]);

  // Load players -> map
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        const m = new Map();
        arr.forEach((p) => m.set(p.id, p));
        setPlayersMap(m);
      } catch (e) {
        console.error("LeagueTab players error:", e);
      }
    })();
  }, [leagueId]);

  // Load schedule for current week (if exists)
  useEffect(() => {
    if (!leagueId || !currentWeek) return;
    (async () => {
      try {
        const ref = doc(db, "leagues", leagueId, "schedule", `week-${currentWeek}`);
        const s = await getDoc(ref);
        setWeekData(s.exists() ? s.data() : null);
      } catch (e) {
        console.error("LeagueTab schedule error:", e);
      }
    })();
  }, [leagueId, currentWeek]);

  const teamIndex = useMemo(() => {
    const m = new Map();
    teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [teams]);

  return (
    <div>
      <h3>Teams</h3>
      <div style={{ display: "grid", gap: 12 }}>
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} playersMap={playersMap} />
        ))}
        {teams.length === 0 && <div>No teams found.</div>}
      </div>

      <hr style={{ margin: "16px 0" }} />

      <h3>Week {currentWeek} Matchups</h3>
      {!weekData && <div>No schedule found for this week.</div>}
      {weekData && Array.isArray(weekData.matchups) && weekData.matchups.length === 0 && (
        <div>No matchups scheduled for this week.</div>
      )}
      {weekData && Array.isArray(weekData.matchups) && weekData.matchups.length > 0 && (
        <ul>
          {weekData.matchups.map((m, i) => (
            <li key={i}>
              <b>{m.home}</b> vs <b>{m.away}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamCard({ team, playersMap }) {
  const roster = team?.roster || {};
  const starters = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        {team?.name || team?.id}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {starters.map((s) => (
            <tr key={s}>
              <td style={{ padding: "4px 6px", width: 60, opacity: 0.8 }}>{s}</td>
              <td style={{ padding: "4px 6px" }}>
                <PlayerName playerId={roster[s]} playersMap={playersMap} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
