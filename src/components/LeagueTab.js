/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { listTeams, getScheduleWeek, ensureOrRecreateSchedule } from "../lib/storage";

export default function LeagueTab({ leagueId }) {
  const [teams, setTeams] = useState([]);
  const [weeks, setWeeks] = useState([1,2,3,4,5,6,7,8,9,10,11,12,13,14]);
  const [weekView, setWeekView] = useState(1);
  const [schedule, setSchedule] = useState({ week: 1, matchups: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => { setTeams(await listTeams(leagueId)); })();
  }, [leagueId]);

  useEffect(() => {
    (async () => { setSchedule(await getScheduleWeek(leagueId, weekView)); })();
  }, [leagueId, weekView]);

  async function onEnsureSchedule() {
    try {
      setBusy(true); setMsg("");
      const wrote = await ensureOrRecreateSchedule({ leagueId, totalWeeks: 14 });
      setMsg(`Schedule generated/updated: ${wrote} weeks.`);
      setSchedule(await getScheduleWeek(leagueId, weekView));
    } catch (e) {
      console.error(e); setMsg(String(e?.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <button disabled={busy} onClick={onEnsureSchedule}>Ensure / Recreate Schedule</button>
        {msg && <span style={{ marginLeft: 8 }}>{msg}</span>}
      </div>

      <h3>Teams</h3>
      <ul>
        {teams.map(t => <li key={t.id}>{t.id} {t.name ? `– ${t.name}` : ""}</li>)}
      </ul>

      <h3>Schedule</h3>
      <label>Week:&nbsp;</label>
      <select value={weekView} onChange={(e)=>setWeekView(Number(e.target.value))}>
        {weeks.map(w => <option key={w} value={w}>Week {w}</option>)}
      </select>

      {schedule?.matchups?.length ? (
        <ul style={{ marginTop: 10 }}>
          {schedule.matchups.map((m, i)=>(
            <li key={i}>{m.home} vs {m.away}</li>
          ))}
        </ul>
      ) : (
        <p style={{ marginTop: 10 }}>No matchups scheduled for week {weekView}.</p>
      )}
    </div>
  );
}
