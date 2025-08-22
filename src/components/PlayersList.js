/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  projForWeek,
  playerDisplay,
  opponentForWeek,
} from "../lib/storage";

export default function PlayersList({ leagueId, currentWeek }) {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        if (!alive) return;
        // sort by projection desc
        arr.sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
        setPlayers(arr);
      } catch (e) {
        console.error("PlayersList load error:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId, currentWeek]);

  const teams = useMemo(() => {
    const s = new Set();
    players.forEach((p) => {
      if (p?.team) s.add(p.team);
      // also support p.nflTeam, etc.
      if (p?.nflTeam) s.add(p.nflTeam);
    });
    return Array.from(s).sort();
  }, [players]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players.filter((p) => {
      const name = playerDisplay(p).toLowerCase();
      const team = (p.team || p.nflTeam || "").toLowerCase();
      const matchesName = !needle || name.includes(needle);
      const matchesTeam = !teamFilter || teamFilter.toLowerCase() === team;
      return matchesName && matchesTeam;
    });
  }, [players, q, teamFilter]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search player by name…"
          style={{ flex: 1, padding: 8 }}
        />
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
        >
          <option value="">All Teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {filtered.map((p) => {
          const proj = projForWeek(p, currentWeek);
          const opp = opponentForWeek(p, currentWeek);
          return (
            <li key={p.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ minWidth: 180 }}>{playerDisplay(p)}</div>
                <div style={{ width: 70, color: "#666" }}>{p.position || ""}</div>
                <div style={{ width: 70, color: "#666" }}>{p.team || p.nflTeam || ""}</div>
                <div style={{ minWidth: 120, color: "#666" }}>
                  {opp ? `Opp: ${opp}` : ""}
                </div>
                <div style={{ marginLeft: "auto" }}>
                  Proj W{currentWeek}: <b>{Number(proj || 0).toFixed(1)}</b>
                </div>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && <li>No players found.</li>}
      </ul>
    </div>
  );
}
