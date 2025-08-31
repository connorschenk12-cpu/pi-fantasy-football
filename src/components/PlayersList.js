/* eslint-disable no-console */
// src/components/PlayersList.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,            // GLOBAL-only (no args)
  projForWeek,
  opponentForWeek,
  addDropPlayer,
  listenLeagueClaims,
} from "../lib/storage";
import PlayerBadge from "./common/PlayerBadge";

export default function PlayersList({ leagueId, league, username, currentWeek }) {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [week, setWeek] = useState(Number(currentWeek || 1));
  const [claims, setClaims] = useState(new Map());

  // Load GLOBAL players
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const arr = await listPlayers();
        if (mounted) setPlayers(arr || []);
      } catch (e) {
        console.error("listPlayers error:", e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Listen to league claims so we can show "Owned by ..."
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeagueClaims(leagueId, setClaims);
    return () => unsub && unsub();
  }, [leagueId]);

  // Sync week from parent prop
  useEffect(() => setWeek(Number(currentWeek || 1)), [currentWeek]);

  // Build team list
  const teams = useMemo(() => {
    const s = new Set();
    (players || []).forEach((p) => { if (p.team) s.add(p.team); });
    return ["ALL", ...Array.from(s).sort()];
  }, [players]);

  // Filter + precompute projection/opponent + sort by highest projection
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();

    const base = (players || [])
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => (teamFilter === "ALL" ? true : String(p.team || "") === teamFilter))
      .filter((p) => {
        if (!needle) return true;
        const name = (p.name || "").toLowerCase();
        const idStr = String(p.id || "").toLowerCase();
        return name.includes(needle) || idStr.includes(needle);
      })
      .map((p) => {
        const projection = Number(projForWeek(p, week) || 0);
        const opp = opponentForWeek(p, week) || "";
        const claimedBy = claims.get(p.id)?.claimedBy || null;
        return { ...p, projection, opp, claimedBy };
      });

    // Sort: projection desc, then name asc, then team asc
    base.sort((a, b) => {
      if (b.projection !== a.projection) return b.projection - a.projection;
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      const at = (a.team || "").toLowerCase();
      const bt = (b.team || "").toLowerCase();
      return at < bt ? -1 : at > bt ? 1 : 0;
    });

    return base;
  }, [players, q, pos, teamFilter, week, claims]);

  const canManage =
    !!username &&
    !!league &&
    !(league?.settings?.lockAddDuringDraft && league?.draft?.status === "live");

  async function handleAdd(pId) {
    if (!canManage) return;
    try {
      await addDropPlayer({ leagueId, username, addId: pId, dropId: null });
      alert("Added to your bench.");
    } catch (e) {
      console.error("addDropPlayer(add):", e);
      alert(String(e?.message || e));
    }
  }

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
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: 18 }).map((_, i) => (
            <option key={i + 1} value={i + 1}>Week {i + 1}</option>
          ))}
        </select>
      </div>

      <table className="table wide-names">
        <thead>
          <tr>
            <th>Name</th>
            <th>Opp</th>
            <th className="num">Proj (W{week})</th>
            {username && <th>Manage</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <PlayerBadge player={p} />
                <span className="player-sub">
                  {(p.position || "-")}{p.team ? ` • ${p.team}` : ""}
                </span>
              </td>
              <td>{p.opp || "-"}</td>
              <td className="num">{p.projection.toFixed(1)}</td>
              {username && (
                <td>
                  {p.claimedBy ? (
                    <span style={{ color: "#999" }}>Owned by {p.claimedBy}</span>
                  ) : canManage ? (
                    <button className="btn btn-primary" onClick={() => handleAdd(p.id)}>Add</button>
                  ) : (
                    <span style={{ color: "#999" }}>Locked (draft)</span>
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={username ? 4 : 3} style={{ color: "#999", paddingTop: 12 }}>
                No players match your filters. If this is a fresh deploy, try “Refresh Players”
                in <b>League Admin → Data Maintenance</b>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
