/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenScheduleWeek,
  listenLeague,
  listenTeamById,
  listPlayersMap,
  computeTeamPoints,
  playerDisplay,
} from "../lib/storage";

export default function MatchupsTab({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [week, setWeek] = useState(1);
  const [sched, setSched] = useState({ week: 1, matchups: [] });
  const [playersMap, setPlayersMap] = useState(null);

  // Default week from league settings
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
      const w = Number(l?.settings?.currentWeek || 1);
      setWeek((prev) => prev || w);
    });
    return () => unsub && unsub();
  }, [leagueId]);

  // Load schedule for selected week
  useEffect(() => {
    if (!leagueId || !week) return;
    const unsub = listenScheduleWeek(leagueId, week, setSched);
    return () => unsub && unsub();
  }, [leagueId, week]);

  // Load players map (for names & points)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  // Default to your matchup if present; otherwise first matchup
  const myIndex = useMemo(() => {
    if (!username || !sched?.matchups?.length) return 0;
    const idx = sched.matchups.findIndex(
      (m) => m.home === username || m.away === username
    );
    return Math.max(0, idx);
  }, [sched.matchups, username]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => setSelectedIdx(myIndex), [myIndex]);

  const current = sched?.matchups?.[selectedIdx] || null;

  // Subscribe to both teams
  const [home, setHome] = useState(null);
  const [away, setAway] = useState(null);
  useEffect(() => {
    if (!leagueId || !current) return;
    const u1 = listenTeamById(leagueId, current.home, setHome);
    const u2 = listenTeamById(leagueId, current.away, setAway);
    return () => { u1 && u1(); u2 && u2(); };
  }, [leagueId, current?.home, current?.away]);

  const weekOptions = useMemo(() => {
    // Show 1..18 for NFL; adjust as you wish
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }, []);

  const canRender = playersMap && current && home && away;

  return (
    <div>
      <Toolbar
        week={week}
        setWeek={setWeek}
        matchups={sched?.matchups || []}
        selectedIdx={selectedIdx}
        setSelectedIdx={setSelectedIdx}
        username={username}
      />

      {!canRender && (
        <p>Loading matchup…</p>
      )}

      {canRender && (
        <Scoreboard
          week={week}
          home={home}
          away={away}
          playersMap={playersMap}
        />
      )}

      <SmallHint />
    </div>
  );
}

function Toolbar({ week, setWeek, matchups, selectedIdx, setSelectedIdx, username }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
      <div>
        <b>Week:</b>{" "}
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </div>

      <div>
        <b>Matchup:</b>{" "}
        <select value={selectedIdx} onChange={(e) => setSelectedIdx(Number(e.target.value))}>
          {matchups.length === 0 && <option value={0}>(no matchups)</option>}
          {matchups.map((m, idx) => (
            <option key={`${m.home}_vs_${m.away}_${idx}`} value={idx}>
              {m.home === username ? "You" : m.home} vs {m.away === username ? "You" : m.away}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Scoreboard({ week, home, away, playersMap }) {
  const homeCalc = useMemo(() => computeTeamPoints({ roster: home?.roster, week, playersMap }), [home, week, playersMap]);
  const awayCalc = useMemo(() => computeTeamPoints({ roster: away?.roster, week, playersMap }), [away, week, playersMap]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr", gap: 16 }}>
      <TeamPanel title={home?.name || home?.owner || home?.id} calc={homeCalc} align="right" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <h2 style={{ margin: 0 }}>vs</h2>
      </div>
      <TeamPanel title={away?.name || away?.owner || away?.id} calc={awayCalc} align="left" />
    </div>
  );
}

function TeamPanel({ title, calc, align }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "4px 0" }}>Slot</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "4px 0" }}>Player</th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "4px 0" }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {calc.lines.map((ln) => (
            <tr key={ln.slot}>
              <td style={{ padding: "4px 0" }}>{ln.slot}</td>
              <td style={{ padding: "4px 0" }}>{playerDisplay(ln.player)}</td>
              <td style={{ textAlign: "right", padding: "4px 0" }}>{Number(ln.points || 0).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={{ borderTop: "1px solid #ddd", paddingTop: 6 }}><b>Total</b></td>
            <td style={{ textAlign: "right", borderTop: "1px solid #ddd", paddingTop: 6 }}>
              <b>{Number(calc.total || 0).toFixed(1)}</b>
            </td>
          </tr>
        </tfoot>
      </table>
      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
        (Using weekly projections until live stats are wired.)
      </div>
    </div>
  );
}

function SmallHint() {
  return (
    <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
      Tip: You can switch to any other matchup in the dropdown to view their projected scoring.
    </div>
  );
}
