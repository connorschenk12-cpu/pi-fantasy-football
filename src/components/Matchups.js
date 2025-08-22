/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listTeams,
  listPlayersMap,
  listMatchups,
  opponentForWeek,
} from "../lib/storage";
import { computeTeamProjectedScore } from "../lib/scoring";

/**
 * Props:
 * - leagueId (string)
 * - defaultWeek (number) optional; falls back to league.settings.currentWeek
 */
export default function Matchups({ leagueId, defaultWeek }) {
  const [league, setLeague] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [teams, setTeams] = useState([]); // [{id, roster, bench, ...}]
  const [week, setWeek] = useState(defaultWeek || 1);
  const [matchups, setMatchups] = useState([]); // [{id, week, home, away}]
  const [selected, setSelected] = useState(null); // matchup id

  // Listen league (for currentWeek, maybe future schedules)
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
      const w = Number(l?.settings?.currentWeek || defaultWeek || 1);
      setWeek(w);
    });
    return () => unsub && unsub();
  }, [leagueId, defaultWeek]);

  // Load players map
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map);
      } catch (e) {
        console.error("playersMap error:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  // Load teams
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const t = await listTeams(leagueId);
        if (alive) setTeams(t);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  // Load matchups for week
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId || !Number.isFinite(week)) return;
        const m = await listMatchups(leagueId, week);
        if (alive) {
          setMatchups(m);
          if (m.length && !selected) setSelected(m[0].id);
        }
      } catch (e) {
        console.error("listMatchups error:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId, week]); // deliberately not including `selected`

  const teamsById = useMemo(() => {
    const m = new Map();
    teams.forEach((t) => m.set(t.id, t));
    return m;
  }, [teams]);

  const selMatchup = useMemo(
    () => matchups.find((m) => m.id === selected) || null,
    [matchups, selected]
  );

  const homeScore = useMemo(() => {
    if (!selMatchup) return { total: 0, parts: [] };
    const team = teamsById.get(selMatchup.home);
    return computeTeamProjectedScore(team, playersMap, week, opponentForWeek);
  }, [selMatchup, teamsById, playersMap, week]);

  const awayScore = useMemo(() => {
    if (!selMatchup) return { total: 0, parts: [] };
    const team = teamsById.get(selMatchup.away);
    return computeTeamProjectedScore(team, playersMap, week, opponentForWeek);
  }, [selMatchup, teamsById, playersMap, week]);

  const weeks = useMemo(() => {
    // Offer 1..18 just to explore; you can trim to season length
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Matchups</h3>
        <label>
          Week:&nbsp;
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label style={{ marginLeft: "auto" }}>
          View:&nbsp;
          <select
            value={selected || ""}
            onChange={(e) => setSelected(e.target.value || null)}
          >
            {matchups.map((m) => (
              <option key={m.id} value={m.id}>
                {m.home} vs {m.away}
              </option>
            ))}
            {matchups.length === 0 && <option value="">(no matchups)</option>}
          </select>
        </label>
      </div>

      {!selMatchup && <p>No matchup selected.</p>}

      {selMatchup && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* HOME */}
          <TeamCard
            title={`${selMatchup.home} (Home)`}
            score={homeScore}
          />

          {/* AWAY */}
          <TeamCard
            title={`${selMatchup.away} (Away)`}
            score={awayScore}
          />
        </div>
      )}
    </div>
  );
}

function TeamCard({ title, score }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <div style={{ marginLeft: "auto", fontSize: 18 }}>
          Total: <b>{score.total.toFixed(1)}</b>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
        {score.parts.map((p) => (
          <li key={`${p.slot}-${p.id}`} style={{ padding: "4px 0", borderBottom: "1px solid #f1f1f1" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 42, fontWeight: 600 }}>{p.slot}</div>
              <div style={{ minWidth: 180 }}>{p.name}</div>
              <div style={{ width: 60, color: "#666" }}>{p.position}</div>
              <div style={{ width: 60, color: "#666" }}>{p.team}</div>
              <div style={{ minWidth: 100, color: "#666" }}>{p.opp ? `Opp: ${p.opp}` : ""}</div>
              <div style={{ marginLeft: "auto" }}>
                {p.proj.toFixed(1)}
              </div>
            </div>
          </li>
        ))}
        {score.parts.length === 0 && <li>(no starters set)</li>}
      </ul>
    </div>
  );
}
