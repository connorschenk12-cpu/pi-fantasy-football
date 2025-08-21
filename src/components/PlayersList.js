/* eslint-disable react-hooks/exhaustive-deps */
// src/components/PlayersList.js
import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, listenLeagueClaims, ensureTeam, addDropPlayer } from "../lib/storage";

export default function PlayersList({ leagueId, username, onShowNews }) {
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
    // sort by projected points desc
    list.sort((a, b) => Number(b.projPoints || 0) - Number(a.projPoints || 0));
    return list;
  }, [players, teamFilter, q]);

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
            <th style={th}>Proj</th> {/* <- fixed: removed stray '}' */}
            <th style={th}>Status</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const name = p.displayName || p.name || p.id;
            const claimedBy = claims.get(p.id)?.claimedBy || null;
            const available = !claimedBy;
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
                <td style={td}>{Number(p.projPoints || 0).toFixed(1)}</td>
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

const th = { textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" };
const td = { borderBottom: "1px solid #f5f5f5", padding: "6px 4px" };
