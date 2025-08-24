/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listTeams,
  listPlayersMap,
  playerDisplay,
  getScheduleAllWeeks,
} from "../lib/storage";

export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [weeks, setWeeks] = useState([]);

  // Load league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Load teams + players map
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
        console.error("LeagueTab init error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  // Load full season schedule docs
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const all = await getScheduleAllWeeks(leagueId);
        if (!alive) return;
        setWeeks(all || []);
      } catch (e) {
        console.error("getScheduleAllWeeks error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const teamIds = useMemo(() => teams.map(t => t.id), [teams]);

  return (
    <div>
      <h3>League Overview</h3>
      {!leagueId && <div style={{ color: "#a00" }}>Missing leagueId</div>}
      <div style={{ marginBottom: 10, color: "#666" }}>
        {league?.name ? `League: ${league.name}` : "Loading league…"}
      </div>

      {/* Rosters */}
      <h4>Rosters</h4>
      {teams.length === 0 ? (
        <div style={{ color: "#999" }}>No teams yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          {teams.map((t) => (
            <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.name || t.id}</div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                Owner: {t.owner || t.id}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Starters</div>
                <table cellPadding="4" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {Object.entries(t.roster || {}).map(([slot, pid]) => {
                      const p = pid ? playersMap.get(pid) : null;
                      return (
                        <tr key={slot} style={{ borderBottom: "1px solid #f4f4f4" }}>
                          <td style={{ width: 48, color: "#666" }}>{slot}</td>
                          <td>{p ? playerDisplay(p) : "(empty)"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Bench</div>
                {(t.bench || []).length === 0 ? (
                  <div style={{ color: "#999" }}>(no bench players)</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {(t.bench || []).map((pid) => {
                      const p = playersMap.get(pid);
                      return <li key={pid}>{p ? playerDisplay(p) : pid}</li>;
                    })}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full season schedule */}
      <h4 style={{ marginTop: 16 }}>Season Schedule</h4>
      {weeks.length === 0 ? (
        <div style={{ color: "#999" }}>
          No schedule documents found yet. The admin can generate the season schedule from the Admin tab.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
          {weeks.map((w) => (
            <div key={w.week} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Week {w.week}</div>
              {(w.matchups || []).length === 0 ? (
                <div style={{ color: "#999" }}>(no matchups)</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {w.matchups.map((m, idx) => (
                    <li key={idx}>
                      {m.home} vs {m.away}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* tiny sanity footer */}
      <div style={{ marginTop: 12, fontSize: 12, color: "#888" }}>
        {`Teams loaded: ${teamIds.length} • Weeks loaded: ${weeks.length}`}
      </div>
    </div>
  );
}
