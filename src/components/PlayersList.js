/* eslint-disable react-hooks/exhaustive-deps */
// src/components/PlayersList.js
import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, listenLeagueClaims, ensureTeam, addDropPlayer } from "../lib/storage";

export default function PlayersList({ leagueId, username, onShowNews, currentWeek = 1, onChangeWeek }) {
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    let canceled = false;
    (async () => {
      const p = await listPlayers({ leagueId });
      if (!canceled) setPlayers(p || []);
    })();
    return () => { canceled = true; };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    const un = listenLeagueClaims(leagueId, (m) => setClaims(m || new Map()));
    return () => un && un();
  }, [leagueId]);

  const teams = useMemo(() => {
    const s = new Set();
    players.forEach(p => { if (p.team) s.add(p.team); });
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  const filtered = useMemo(() => {
    let list = players.slice();
    if (teamFilter !== "ALL") {
      list = list.filter(p => p.team === teamFilter);
    }
    const nq = q.trim().toLowerCase();
    if (nq) {
      list = list.filter(p => (p.displayName || p.name || "").toLowerCase().includes(nq));
    }
    // sort by projected points (selected week) desc
    list.sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
    return list;
  }, [players, teamFilter, q, currentWeek]);

  async function addToBench(p) {
    try {
      await ensureTeam({ leagueId, username });
      await addDropPlayer({ leagueId, username, addId: p.id, dropId: null });
      alert(`${p.displayName || p.name} added to your bench`);
    } catch (e) {
      alert(e.message || "Failed to add player");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <label>
          Week:&nbsp;
          <select value={currentWeek} onChange={(e)=>onChangeWeek && onChangeWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }).map((_, i) => (
              <option key={i+1} value={i+1}>Week {i+1}</option>
            ))}
          </select>
        </label>
        <label>
          Team:&nbsp;
          <select value={teamFilter} onChange={(e)=>setTeamFilter(e.target.value)}>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 240px" }}>
          Search name:&nbsp;
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Type a player name" style={{ width: 240 }} />
        </label>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Team</th>
            <th style={th}>Pos</th>
            <th style={th}>Proj (W{currentWeek})</th>
            <th style={th}>Status</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const name = p.displayName || p.name || p.id;
            const claimedBy = claims.get(p.id)?.claimedBy || null;
            const available = !claimedBy;
            const proj = projForWeek(p, currentWeek);
            return (
              <tr key={p.id}>
                <td style={td}>
                  <span style={{ fontWeight: 600 }}>{name}</span>{" "}
                  <button onClick={() => onShowNews && onShowNews(name)} style={{ marginLeft: 6, padding: "2px 6px" }}>
                    News
                  </button>
                </td>
                <td style={td}>{p.team || "—"}</td>
                <td style={td}>{p.position || "—"}</td>
                <td style={td}>{proj.toFixed(1)}</td>
                <td style={td} title={claimedBy ? `Owned by ${claimedBy}` : "Available"}>
                  {available ? "Available" : `Owned by ${claimedBy}`}
                </td>
                <td style={td}>
                  {available ? (
                    <button onClick={() => addToBench(p)} style={{ padding: 6 }}>
                      Add
                    </button>
                  ) : (
                    <span style={{ opacity: 0.5 }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...td, textAlign: "center", opacity: 0.6 }}>
                No players match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function projForWeek(p, week) {
  const wStr = String(week);
  if (p?.projections && p.projections[wStr] != null) return Number(p.projections[wStr]) || 0;
  if (p?.projections && p.projections[week] != null) return Number(p.projections[week]) || 0;
  if (p?.projByWeek && p.projByWeek[wStr] != null) return Number(p.projByWeek[wStr]) || 0;
  if (p?.projByWeek && p.projByWeek[week] != null) return Number(p.projByWeek[week]) || 0;
  const keyed = p?.[`projW${week}`];
  if (keyed != null) return Number(keyed) || 0;
  return 0;
}

const th = { textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" };
const td = { borderBottom: "1px solid #f5f5f5", padding: "6px 4px" };
