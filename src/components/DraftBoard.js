/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listPlayers,
  getClaimsSet,
  projForWeek,
  draftPick,
  isMyTurn,
  asId,
} from "../lib/storage";
import PlayerName from "./common/PlayerName.jsx";

export default function DraftBoard({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [players, setPlayers] = useState([]);
  const [owned, setOwned] = useState(new Set());
  const [pos, setPos] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!leagueId) return;
    const off = listenLeague(leagueId, setLeague);
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        setPlayers(arr || []);
        const s = await getClaimsSet(leagueId);
        setOwned(s);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => off && off();
  }, [leagueId]);

  // remove already-drafted (claimed) players; add filters
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (players || [])
      .filter((p) => !owned.has(asId(p.id)))
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => (team === "ALL" ? true : String(p.team || "") === team))
      .filter((p) => {
        if (!needle) return true;
        const nm = (p.name || p.fullName || p.playerName || "").toLowerCase();
        return nm.includes(needle) || String(p.id).toLowerCase().includes(needle);
      })
      .sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
  }, [players, owned, pos, team, q, currentWeek]);

  const teams = useMemo(() => {
    const s = new Set();
    (players || []).forEach((p) => p.team && s.add(p.team));
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  const canPick = isMyTurn(league, username);

  async function handlePick(p) {
    try {
      await draftPick({
        leagueId,
        username,
        playerId: p.id,
        playerPosition: p.position,
        slot: null,
      });
      const s = await getClaimsSet(leagueId);
      setOwned(s); // update ownership → removes from board
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  return (
    <div>
      <h3>Draft Board {canPick ? "(You're on the clock!)" : ""}</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="ALL">All</option>
          <option value="QB">QB</option>
          <option value="RB">RB</option>
          <option value="WR">WR</option>
          <option value="TE">TE</option>
          <option value="K">K</option>
          <option value="DEF">DEF</option>
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Proj</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f4f4f4" }}>
              <td><PlayerName leagueId={leagueId} playerId={p.id} fallback={p.name} /></td>
              <td>{p.position || "-"}</td>
              <td>{p.team || "-"}</td>
              <td>{projForWeek(p, currentWeek).toFixed(1)}</td>
              <td>
                <button disabled={!canPick} onClick={() => handlePick(p)}>
                  {canPick ? "Draft" : "Waiting…"}
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={5} style={{ color: "#999" }}>No available players.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
