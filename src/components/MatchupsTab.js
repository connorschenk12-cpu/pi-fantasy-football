/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenScheduleWeek,
  listPlayersMap,
  listenTeamById,
  computeTeamPoints,
  ROSTER_SLOTS,
} from "../lib/storage";

/**
 * Props:
 * - leagueId
 * - currentWeek
 */
export default function MatchupsTab({ leagueId, currentWeek }) {
  const [week, setWeek] = useState(Number(currentWeek || 1));
  const [schedule, setSchedule] = useState({ week: Number(currentWeek || 1), matchups: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const [teamCache, setTeamCache] = useState({}); // { username: teamDoc }

  useEffect(() => {
    setWeek(Number(currentWeek || 1));
  }, [currentWeek]);

  // schedule listener
  useEffect(() => {
    if (!leagueId || !week) return;
    const unsub = listenScheduleWeek(leagueId, week, (s) => setSchedule(s || { week, matchups: [] }));
    return () => unsub && unsub();
  }, [leagueId, week]);

  // players map (once per leagueId)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // subscribe to any teams appearing in the week’s matchups
  useEffect(() => {
    if (!leagueId) return;
    const unsubs = [];
    const usernames = new Set();
    (schedule?.matchups || []).forEach((m) => {
      if (m.home) usernames.add(m.home);
      if (m.away) usernames.add(m.away);
    });
    usernames.forEach((u) => {
      const unsub = listenTeamById(leagueId, u, (t) => {
        setTeamCache((prev) => ({ ...prev, [u]: t || null }));
      });
      unsubs.push(unsub);
    });
    return () => { unsubs.forEach((fn) => fn && fn()); };
  }, [leagueId, schedule?.matchups]);

  const rows = useMemo(() => {
    const out = [];
    (schedule?.matchups || []).forEach((m, idx) => {
      const home = teamCache[m.home] || null;
      const away = teamCache[m.away] || null;
      const homePts = home ? computeTeamPoints({ roster: home.roster || {}, week, playersMap }).total : 0;
      const awayPts = away ? computeTeamPoints({ roster: away.roster || {}, week, playersMap }).total : 0;
      out.push({ id: `${m.home}_vs_${m.away}_${idx}`, home: m.home, away: m.away, homePts, awayPts });
    });
    return out;
  }, [schedule?.matchups, teamCache, week, playersMap]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <b>Week:</b>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 && (
        <div style={{ color: "#999" }}>
          No matchups scheduled for week {week}. Use the Admin tab → Ensure / Recreate Schedule.
        </div>
      )}

      {rows.map((r) => (
        <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <b>{r.home}</b>
            <span>vs</span>
            <b>{r.away}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
            <span>{r.homePts.toFixed(1)}</span>
            <span>{r.awayPts.toFixed(1)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
