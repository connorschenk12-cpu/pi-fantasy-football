/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable react-hooks/exhaustive-deps */
// src/components/PlayersList.js
import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, projForWeek, addDropPlayer } from "../lib/storage";

const th = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee" };
const td = { padding: "6px 8px", borderBottom: "1px solid #f3f3f3" };

export default function PlayersList({
  leagueId,
  username,
  currentWeek = 1,
  onChangeWeek,
  addLocked = false
}) {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [posFilter, setPosFilter] = useState("ALL");

  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      const arr = await listPlayers({ leagueId });
      setPlayers(arr);
    })();
  }, [leagueId]);

  const teams = useMemo(() => {
    const s = new Set();
    players.forEach((p) => { if (p.team) s.add(p.team); });
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  const filtered = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    return players
      .filter((p) => (teamFilter === "ALL" ? true : (p.team === teamFilter)))
      .filter((p) => (posFilter === "ALL" ? true : (String(p.position||"").toUpperCase() === posFilter)))
      .filter((p) => {
        if (!q) return true;
        const name = (p.displayName || p.name || p.id || "").toLowerCase();
        const pid  = (p.id || "").toLowerCase();
        return name.includes(q) || pid.includes(q);
      })
      .sort((a,b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
  }, [players, search, teamFilter, posFilter, currentWeek]);

  async function addToBench(p) {
    try {
      await addDropPlayer({ leagueId, username, addId: p.id, dropId: null });
      alert(`Added ${p.displayName || p.name || p.id} to your bench.`);
    } catch (e) {
      alert(e.message || "Add failed");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <input
          value={search}
          onChange={(e)=>setSearch(e.target.value)}
          placeholder="Search by player name or id…"
          style={{ padding: 8, minWidth: 220 }}
        />
        <label>
          Team:&nbsp;
          <select value={teamFilter} onChange={(e)=>setTeamFilter(e.target.value)}>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Pos:&nbsp;
          <select value={posFilter} onChange={(e)=>setPosFilter(e.target.value)}>
            {["ALL","QB","RB","WR","TE","K","DEF"].map((p)=>(
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Week:&nbsp;
          <select value={currentWeek} onChange={(e)=>onChangeWeek && onChangeWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }).map((_, i) => (
              <option key={i+1} value={i+1}>Week {i+1}</option>
            ))}
          </select>
        </label>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Player</th>
            <th style={th}>Pos</th>
            <th style={th}>NFL</th>
            <th style={th}>Proj (W{currentWeek})</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const proj = projForWeek(p, currentWeek);
            return (
              <tr key={p.id}>
                <td style={td}>{p.displayName || p.name || p.id}</td>
                <td style={td}>{p.position || ""}</td>
                <td style={td}>{p.team || ""}</td>
                <td style={td}>{Number.isFinite(proj) ? proj.toFixed(1) : "0.0"}</td>
                <td style={td}>
                  <button onClick={() => addToBench(p)} style={{ padding: 6 }} disabled={addLocked}>
                    {addLocked ? "Locked (draft)" : "Add"}
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td style={td} colSpan={5}>(No players match your filters.)</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
