/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  listPlayersMap,
  listenLeague,
  listenLeagueClaims,
  draftPick,
  projForWeek,
  playerDisplay,
  currentDrafter,
} from "../lib/storage";

export default function DraftBoard({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [players, setPlayers] = useState([]);
  const [claimsMap, setClaimsMap] = useState(new Map());
  const [pos, setPos] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const week = Number(currentWeek || 1);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!leagueId) return;
      const arr = await listPlayers({ leagueId });
      if (mounted) setPlayers(arr);
    })().catch(console.error);
    return () => { mounted = false; };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeagueClaims(leagueId, (m) => setClaimsMap(m));
    return () => unsub && unsub();
  }, [leagueId]);

  const owned = useMemo(() => new Set(Array.from(claimsMap.keys())), [claimsMap]);

  const teams = useMemo(() => {
    const s = new Set();
    players.forEach((p) => p.team && s.add(p.team));
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  const available = useMemo(() => {
    return players.filter((p) => !owned.has(String(p.id)));
  }, [players, owned]);

  const filtered = useMemo(() => {
    return available
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => (team === "ALL" ? true : String(p.team || "") === team))
      .sort((a, b) => projForWeek(b, week) - projForWeek(a, week));
  }, [available, pos, team, week]);

  const onPick = async (p) => {
    try {
      if (!league) throw new Error("No league");
      const onClock = currentDrafter(league);
      if (onClock !== username) {
        alert(`It's ${onClock}'s turn.`);
        return;
      }
      await draftPick({
        leagueId,
        username,
        playerId: p.id,
        playerPosition: p.position,
        slot: null,
      });
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  const onClearFilters = () => { setPos("ALL"); setTeam("ALL"); };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <b>Draft Board</b>
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
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={onClearFilters}>Clear</button>
        <span style={{ marginLeft: "auto" }}>
          On the clock: <b>{currentDrafter(league) || "-"}</b>
        </span>
      </div>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th><th>Pos</th><th>Team</th><th>Proj (W{week})</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
              <td>{playerDisplay(p)}</td>
              <td>{p.position || "-"}</td>
              <td>{p.team || "-"}</td>
              <td>{projForWeek(p, week).toFixed(1)}</td>
              <td><button onClick={() => onPick(p)}>Draft</button></td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={5} style={{ color: "#999", paddingTop: 12 }}>No available players.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
