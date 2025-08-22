/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenScheduleWeek,
  listTeams,
  listPlayersMap,
  computeTeamPoints,
} from "../lib/storage";

/**
 * Props:
 * - leagueId
 * - currentWeek
 */
export default function MatchupsTab({ leagueId, currentWeek = 1 }) {
  const [week, setWeek] = useState(currentWeek);
  const [schedule, setSchedule] = useState({ week, matchups: [] });
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());

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
        const [ts, pm] = await Promise.all([
          listTeams(leagueId),
          listPlayersMap({ leagueId }),
        ]);
        if (mounted) {
          setTeams(ts);
          setPlayersMap(pm);
        }
      } catch (e) {
        console.error("MatchupsTab load error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId, week]);

  const teamById = useMemo(() => {
    const m = new Map();
    teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [teams]);

  const rows = useMemo(() => {
    const out = [];
    (schedule?.matchups || []).forEach((m) => {
      const home = teamById.get(m.home);
      const away = teamById.get(m.away);
      const homePts = home ? computeTeamPoints({ roster: home.roster || {}, week, playersMap }).total : 0;
      const awayPts = away ? computeTeamPoints({ roster: away.roster || {}, week, playersMap }).total : 0;
      out.push({ ...m, homePts, awayPts });
    });
    return out;
  }, [schedule?.matchups, teamById, playersMap, week]);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="weekSel"><b>Week</b>: </label>{" "}
        <select
          id="weekSel"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </div>

      {!rows.length && (
        <div style={{ color: "#b35c00" }}>
          No matchups scheduled for week {week}. Ask your commissioner to (re)generate a schedule in Admin.
        </div>
      )}

      {!!rows.length && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Home</th>
              <th style={th}>Projected</th>
              <th style={th}>Away</th>
              <th style={th}>Projected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td style={td}>{r.home}</td>
                <td style={td}>{r.homePts.toFixed(1)}</td>
                <td style={td}>{r.away}</td>
                <td style={td}>{r.awayPts.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th = { textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 4px" };
const td = { borderBottom: "1px solid #eee", padding: "6px 4px" };
