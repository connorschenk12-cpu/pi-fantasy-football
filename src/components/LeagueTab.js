/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { listenLeague, listTeams, getScheduleAllWeeks, ROSTER_SLOTS } from "../lib/storage";
import PlayerName from "./common/PlayerName";

export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [weeks, setWeeks] = useState([]);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const t = await listTeams(leagueId);
        if (alive) setTeams(t || []);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const arr = await getScheduleAllWeeks(leagueId);
        if (alive) setWeeks(arr || []);
      } catch (e) {
        console.error("getScheduleAllWeeks error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const sortedTeams = useMemo(() => {
    return [...(teams || [])].sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  }, [teams]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section>
        <h3>League</h3>
        <div>Name: <b>{league?.name || leagueId}</b></div>
        <div>Owner: {league?.owner || "-"}</div>
        <div>Current Week: {league?.settings?.currentWeek ?? "-"}</div>
      </section>

      <section>
        <h3>Teams & Rosters</h3>
        {sortedTeams.length === 0 && <div style={{ color: "#777" }}>No teams yet.</div>}
        {sortedTeams.map((t) => (
          <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.name || t.id}</div>
            <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th width="60">Slot</th>
                  <th>Player</th>
                </tr>
              </thead>
              <tbody>
                {ROSTER_SLOTS.map((slot) => {
                  const pid = t?.roster?.[slot] || null;
                  return (
                    <tr key={slot} style={{ borderBottom: "1px solid #fafafa" }}>
                      <td><b>{slot}</b></td>
                      <td><PlayerName id={pid} leagueId={leagueId} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: 6 }}>
              <b>Bench:</b>{" "}
              {(Array.isArray(t.bench) ? t.bench : []).map((pid) => (
                <span key={pid} style={{ marginRight: 8 }}>
                  <PlayerName id={pid} leagueId={leagueId} />
                </span>
              ))}
              {(Array.isArray(t.bench) ? t.bench : []).length === 0 && <i>(empty)</i>}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>Season Schedule</h3>
        {weeks.length === 0 && <div style={{ color: "#777" }}>No schedule saved yet.</div>}
        {weeks.map((w) => (
          <div key={w.week} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Week {w.week}</div>
            {(w.matchups || []).length === 0 ? (
              <div style={{ color: "#999" }}>(no matchups)</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {w.matchups.map((m, idx) => (
                  <li key={idx}>{m.home} vs {m.away}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
