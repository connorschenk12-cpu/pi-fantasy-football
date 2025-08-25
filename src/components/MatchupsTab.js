/* eslint-disable no-console */
// src/components/MatchupsTab.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenScheduleWeek,
  listenTeamById,
  listPlayersMap,
  playerDisplay,
  pointsForPlayer,
} from "../lib/storage";

export default function MatchupsTab({ leagueId, currentWeek = 1 }) {
  const week = Number(currentWeek || 1);
  const [schedule, setSchedule] = useState({ week, matchups: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const [teamsState, setTeamsState] = useState({}); // { username: teamDoc }

  // Schedule for the week
  useEffect(() => {
    if (!leagueId || !week) return;
    const unsub = listenScheduleWeek(leagueId, week, setSchedule);
    return () => unsub && unsub();
  }, [leagueId, week]);

  // Load player map once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  // Subscribe to teams that appear in this week's matchups
  useEffect(() => {
    if (!leagueId) return;
    const usernames = new Set();
    (schedule?.matchups || []).forEach((m) => {
      if (m?.home) usernames.add(m.home);
      if (m?.away) usernames.add(m.away);
    });

    const unsubs = [];
    usernames.forEach((uname) => {
      const unsub = listenTeamById(leagueId, uname, (t) => {
        setTeamsState((prev) => ({ ...prev, [uname]: t || null }));
      });
      unsubs.push(unsub);
    });

    return () => unsubs.forEach((fn) => fn && fn());
  }, [leagueId, schedule]);

  function teamStarters(username) {
    const t = teamsState[username];
    const roster = t?.roster || {};
    return ROSTER_SLOTS.map((slot) => {
      const pid = roster[slot] || null;
      const p = pid ? playersMap.get(pid) : null;
      const pts = p ? pointsForPlayer(p, week) : 0;
      return { slot, pid, p, pts };
    });
  }

  function teamTotal(username) {
    return teamStarters(username).reduce((sum, row) => sum + Number(row.pts || 0), 0);
  }

  const matchups = useMemo(() => schedule?.matchups || [], [schedule]);

  if (!matchups.length) {
    return <div>No matchups scheduled for week {week}.</div>;
  }

  return (
    <div>
      <h3>Week {week} Matchups</h3>
      {matchups.map((m, idx) => {
        const homeRows = teamStarters(m.home);
        const awayRows = teamStarters(m.away);
        const homeTotal = teamTotal(m.home).toFixed(1);
        const awayTotal = teamTotal(m.away).toFixed(1);

        return (
          <div
            key={idx}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>{m.home} vs {m.away}</h4>
              <div>
                <b>{homeTotal}</b> — <b>{awayTotal}</b>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Home starters */}
              <div>
                <h5 style={{ margin: "6px 0" }}>{m.home}</h5>
                <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                      <th style={{ width: 50 }}>Slot</th>
                      <th>Name</th>
                      <th style={{ width: 60, textAlign: "right" }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {homeRows.map((row) => (
                      <tr key={`${m.home}-${row.slot}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td><b>{row.slot}</b></td>
                        <td>{row.p ? playerDisplay(row.p) : "(empty)"}</td>
                        <td style={{ textAlign: "right" }}>{Number(row.pts || 0).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Away starters */}
              <div>
                <h5 style={{ margin: "6px 0" }}>{m.away}</h5>
                <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                      <th style={{ width: 50 }}>Slot</th>
                      <th>Name</th>
                      <th style={{ width: 60, textAlign: "right" }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awayRows.map((row) => (
                      <tr key={`${m.away}-${row.slot}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td><b>{row.slot}</b></td>
                        <td>{row.p ? playerDisplay(row.p) : "(empty)"}</td>
                        <td style={{ textAlign: "right" }}>{Number(row.pts || 0).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
