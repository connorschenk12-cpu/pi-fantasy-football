/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  playerDisplay,
  projForWeek,
  opponentForWeek,
} from "../lib/storage";

export default function PlayersList({ leagueId, currentWeek }) {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [week, setWeek] = useState(Number(currentWeek || 1));

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        if (mounted) setPlayers(arr || []);
      } catch (e) {
        console.error("listPlayers error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  useEffect(() => {
    setWeek(Number(currentWeek || 1));
  }, [currentWeek]);

  const teams = useMemo(() => {
    const s = new Set();
    (players || []).forEach((p) => {
      if (p.team) s.add(p.team);
    });
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (players || [])
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => (teamFilter === "ALL" ? true : String(p.team || "") === teamFilter))
      .filter((p) => {
        if (!needle) return true;
        const name = playerDisplay(p).toLowerCase();
        const idStr = String(p.id || "").toLowerCase();
        return name.includes(needle) || idStr.includes(needle);
      })
      .sort((a, b) => (projForWeek(b, week) - projForWeek(a, week)));
  }, [players, q, pos, teamFilter, week]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Search players by name or id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 240px" }}
        />
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="ALL">All</option>
          <option value="QB">QB</option>
          <option value="RB">RB</option>
          <option value="WR">WR</option>
          <option value="TE">TE</option>
          <option value="K">K</option>
          <option value="DEF">DEF</option>
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>
              Week {i + 1}
            </option>
          ))}
        </select>
      </div>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj (W{week})</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
              <td>{playerDisplay(p)}</td>
              <td>{p.position || "-"}</td>
              <td>{p.team || "-"}</td>
              <td>{opponentForWeek(p, week) || "-"}</td>
              <td>{projForWeek(p, week).toFixed(1)}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#999", paddingTop: 12 }}>
                No players match your filters. Add players to Firestore or clear filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
