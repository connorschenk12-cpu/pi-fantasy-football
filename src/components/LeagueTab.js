/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listTeams,
  listPlayersMap,
  ROSTER_SLOTS,
  playerDisplay,
  getScheduleAllWeeks,
} from "../lib/storage";

/**
 * Props:
 * - leagueId
 */
export default function LeagueTab({ leagueId }) {
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [weeks, setWeeks] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const [t, pmap, sched] = await Promise.all([
          listTeams(leagueId),
          listPlayersMap({ leagueId }),
          getScheduleAllWeeks(leagueId).catch(() => []),
        ]);
        if (mounted) {
          setTeams(t || []);
          setPlayersMap(pmap || new Map());
          setWeeks(Array.isArray(sched) ? sched : []);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  const teamsSorted = useMemo(() => {
    return [...(teams || [])].sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  }, [teams]);

  return (
    <div>
      {/* Teams */}
      <h3 style={{ marginTop: 0 }}>Teams & Rosters</h3>
      {teamsSorted.length === 0 && (
        <div style={{ color: "#999" }}>
          No teams found yet. Have users join the league.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {teamsSorted.map((t) => (
          <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.name || t.id}</div>
            <table width="100%" cellPadding="4" style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {ROSTER_SLOTS.map((slot) => {
                  const pid = t?.roster?.[slot] || null;
                  const p = pid ? playersMap.get(pid) : null;
                  return (
                    <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ width: 48, color: "#666" }}>{slot}</td>
                      <td>{p ? playerDisplay(p) : "(empty)"}</td>
                      <td style={{ textAlign: "right", color: "#888" }}>{p?.team || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Bench */}
            <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>Bench:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {Array.isArray(t?.bench) && t.bench.length > 0 ? (
                t.bench.map((pid) => {
                  const p = playersMap.get(pid);
                  return <li key={pid}>{p ? playerDisplay(p) : "(empty)"}</li>;
                })
              ) : (
                <li>(none)</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {/* Schedule */}
      <h3 style={{ marginTop: 18 }}>Season Schedule</h3>
      {weeks.length === 0 && (
        <div style={{ color: "#999" }}>
          No schedule found. Use the Admin tab to “Ensure / Recreate Schedule”.
        </div>
      )}
      {weeks.map((w) => (
        <div key={w.week} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Week {w.week}</div>
          {(w.matchups || []).length === 0 ? (
            <div style={{ color: "#999" }}>No matchups.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {w.matchups.map((m, i) => (
                <li key={`${w.week}_${i}`}>
                  {m.home} vs {m.away}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
