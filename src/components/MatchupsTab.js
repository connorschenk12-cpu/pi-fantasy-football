/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import {
  listTeams,
  listPlayersMap,
  computeTeamPoints,
  playerDisplay,
  ROSTER_SLOTS,
} from "../lib/storage";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Props:
 * - leagueId
 * - currentWeek
 * - playersMap (optional; if not provided we'll load it)
 */
export default function MatchupsTab({ leagueId, currentWeek = 1, playersMap: incomingMap }) {
  const [schedule, setSchedule] = useState(null); // { week, matchups: [{home, away}] }
  const [teams, setTeams] = useState([]); // [{id, roster, bench, name}]
  const [playersMap, setPlayersMap] = useState(incomingMap || new Map());
  const [loading, setLoading] = useState(true);

  // load week schedule doc
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        const ref = doc(db, "leagues", leagueId, "schedule", `week-${currentWeek}`);
        const snap = await getDoc(ref);
        setSchedule(snap.exists() ? snap.data() : { week: currentWeek, matchups: [] });
      } catch (e) {
        console.error("load schedule error:", e);
        setSchedule({ week: currentWeek, matchups: [] });
      }
    })();
  }, [leagueId, currentWeek]);

  // load teams
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        const arr = await listTeams(leagueId);
        setTeams(arr);
      } catch (e) {
        console.error("listTeams error:", e);
        setTeams([]);
      }
    })();
  }, [leagueId]);

  // load players map (if not provided)
  useEffect(() => {
    if (incomingMap && incomingMap.size) {
      setPlayersMap(incomingMap);
      return;
    }
    if (!leagueId) return;
    (async () => {
      try {
        const pm = await listPlayersMap({ leagueId });
        setPlayersMap(pm);
      } catch (e) {
        console.error("listPlayersMap error:", e);
        setPlayersMap(new Map());
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId, incomingMap]);

  useEffect(() => {
    if (incomingMap && incomingMap.size) setLoading(false);
  }, [incomingMap]);

  if (!leagueId) return <div>Missing league.</div>;
  if (loading) return <div>Loading matchups…</div>;

  const teamById = new Map(teams.map((t) => [t.id, t]));

  const renderTeamBlock = (teamId) => {
    const team = teamById.get(teamId);
    if (!team) return <div>Unknown team: {teamId}</div>;

    const { lines, total } = computeTeamPoints({
      roster: team.roster || {},
      week: currentWeek,
      playersMap,
    });

    return (
      <div
        style={{
          flex: 1,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 8,
          minWidth: 240,
        }}
      >
        <h4 style={{ margin: "0 0 6px" }}>{team.name || team.id}</h4>
        <table style={{ width: "100%", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Slot</th>
              <th style={{ textAlign: "left" }}>Player</th>
              <th style={{ textAlign: "right" }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => {
              const line = lines.find((l) => l.slot === slot) || {
                playerId: null,
                player: null,
                points: 0,
              };
              return (
                <tr key={slot}>
                  <td>{slot}</td>
                  <td>{line.player ? playerDisplay(line.player) : "(empty)"}</td>
                  <td style={{ textAlign: "right" }}>{Number(line.points || 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ fontWeight: 700 }}>
                Total
              </td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{total.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <div>
      <h3>Week {currentWeek} Matchups</h3>
      {!schedule || !schedule.matchups || schedule.matchups.length === 0 ? (
        <div>No matchups scheduled for week {currentWeek}.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {schedule.matchups.map((m, idx) => (
            <div
              key={`${m.home}_vs_${m.away}_${idx}`}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "stretch",
                flexWrap: "wrap",
                border: "1px solid #ccc",
                padding: 10,
                borderRadius: 8,
              }}
            >
              {renderTeamBlock(m.home)}
              <div style={{ alignSelf: "center", fontWeight: 700 }}>vs</div>
              {renderTeamBlock(m.away)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
