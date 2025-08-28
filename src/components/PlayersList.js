/* eslint-disable no-console */
// src/components/PlayersList.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  projForWeek,
  opponentForWeek,
  addDropPlayer,
  listenLeagueClaims,
} from "../lib/storage";

// NEW: pretty name + headshot
import PlayerBadge from "./common/PlayerBadge";

export default function PlayersList({ leagueId, league, username, currentWeek }) {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [week, setWeek] = useState(Number(currentWeek || 1));
  const [claims, setClaims] = useState(new Map());

  // Load players
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

  // Claims map
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeagueClaims(leagueId, setClaims);
    return () => unsub && unsub();
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
        const name = (p.name || "").toLowerCase();
        const idStr = String(p.id || "").toLowerCase();
        return name.includes(needle) || idStr.includes(needle);
      })
      .sort((a, b) => projForWeek(b, week) - projForWeek(a, week));
  }, [players, q, pos, teamFilter, week]);

  // Can user add/drop? (disabled during draft if league.settings.lockAddDuringDraft is true)
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

      <table className="table table-sm wide-names">
        <thead>
          <tr>
            <th className="col-player">Name</th>
            <th>Opp</th>
            <th>Proj (W{week})</th>
            {username && <th>Manage</th>}
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const claimedBy = claims.get(p.id)?.claimedBy || null;
            return (
              <tr key={p.id}>
                <td className="col-player">
                  <div>
                    <PlayerBadge player={p} />
                    <div className="dim" style={{ fontSize: "0.92em", marginTop: 2 }}>
                      {p.team || "—"} · {p.position || "—"}
                    </div>
                  </div>
                </td>
                <td>{opponentForWeek(p, week) || "-"}</td>
                <td>{projForWeek(p, week).toFixed(1)}</td>
                {username && (
                  <td>
                    {claimedBy ? (
                      <span style={{ color: "#999" }}>Owned by {claimedBy}</span>
                    ) : canManage ? (
                      <button className="btn" onClick={() => handleAdd(p.id)}>Add</button>
                    ) : (
                      <span style={{ color: "#999" }}>Locked (draft)</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={username ? 4 : 3} style={{ color: "#999", paddingTop: 12 }}>
                No players match your filters. Add players to Firestore or clear filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
