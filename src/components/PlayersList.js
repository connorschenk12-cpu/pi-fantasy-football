/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  listenLeagueClaims,
  listenTeam,
  addDropPlayer,
  draftActive,
  getLeague,
} from "../lib/storage";

export default function PlayersList({ leagueId, username, currentWeek }) {
  const [players, setPlayers] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [claims, setClaims] = useState(new Map());
  const [team, setTeam] = useState(null);
  const [league, setLeague] = useState(null);

  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [week, setWeek] = useState(Number(currentWeek || 1));

  // Load league (for draft lock + status)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const l = await getLeague(leagueId);
        if (mounted) setLeague(l);
      } catch (e) { console.error(e); }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Load players + players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        const map = await listPlayersMap({ leagueId });
        if (mounted) {
          setPlayers(arr || []);
          setPlayersMap(map || new Map());
        }
      } catch (e) {
        console.error("listPlayers error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Listen to claims (ownership)
  useEffect(() => {
    if (!leagueId) return () => {};
    const unsub = listenLeagueClaims(leagueId, setClaims);
    return () => unsub && unsub();
  }, [leagueId]);

  // Listen to *my* team (to offer drop choices)
  useEffect(() => {
    if (!leagueId || !username) return () => {};
    const unsub = listenTeam({ leagueId, username, onChange: setTeam });
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Keep week in sync with parent
  useEffect(() => setWeek(Number(currentWeek || 1)), [currentWeek]);

  const teams = useMemo(() => {
    const s = new Set();
    (players || []).forEach((p) => { if (p.team) s.add(p.team); });
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

  const myOwned = useMemo(() => {
    const owned = new Set();
    (claims || new Map()).forEach((val, pid) => {
      if (val?.claimedBy === username) owned.add(pid);
    });
    return owned;
  }, [claims, username]);

  const isDraftLocked = useMemo(() => {
    if (!league) return false;
    return Boolean(league?.settings?.lockAddDuringDraft && draftActive(league));
  }, [league]);

  // Build a flat list of my current players (roster + bench) for optional drop-with-add flow
  const myPlayerIds = useMemo(() => {
    const ids = new Set();
    if (team?.roster) Object.values(team.roster).forEach((pid) => pid && ids.add(String(pid)));
    if (Array.isArray(team?.bench)) team.bench.forEach((pid) => pid && ids.add(String(pid)));
    return Array.from(ids);
  }, [team]);

  const myPlayersForDropdown = useMemo(() => {
    return myPlayerIds
      .map((pid) => ({ id: pid, name: playerDisplay(playersMap.get(pid)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [myPlayerIds, playersMap]);

  const [dropWithAddId, setDropWithAddId] = useState("");

  async function handleAdd(p) {
    try {
      if (!leagueId || !username) return;
      if (isDraftLocked) {
        alert("Add/Drop is disabled during the draft.");
        return;
      }
      await addDropPlayer({
        leagueId,
        username,
        addId: p.id,
        dropId: dropWithAddId || null,
      });
      setDropWithAddId("");
    } catch (e) {
      console.error("addDropPlayer(add) error:", e);
      alert(String(e?.message || e));
    }
  }

  async function handleDrop(p) {
    try {
      if (!leagueId || !username) return;
      if (isDraftLocked) {
        alert("Add/Drop is disabled during the draft.");
        return;
      }
      await addDropPlayer({
        leagueId,
        username,
        addId: null,
        dropId: p.id,
      });
    } catch (e) {
      console.error("addDropPlayer(drop) error:", e);
      alert(String(e?.message || e));
    }
  }

  function ownerOf(pid) {
    const c = claims.get(pid);
    return c?.claimedBy || null;
  }

  return (
    <div>
      {/* Controls */}
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

        {/* Optional: 1-click add+drop (choose a player to drop when adding a new one) */}
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span>Drop with Add:</span>
          <select
            value={dropWithAddId}
            onChange={(e) => setDropWithAddId(e.target.value)}
          >
            <option value="">(none)</option>
            {myPlayersForDropdown.map((mp) => (
              <option key={mp.id} value={mp.id}>{mp.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isDraftLocked && (
        <div style={{ margin: "8px 0", padding: 8, background: "#fff3cd", border: "1px solid #ffeeba", borderRadius: 6 }}>
          Add/Drop is temporarily disabled during the draft.
        </div>
      )}

      {/* Table */}
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj (W{week})</th>
            <th style={{ textAlign: "right" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const name = playerDisplay(p);
            const opp = opponentForWeek(p, week) || "-";
            const proj = projForWeek(p, week).toFixed(1);
            const mine = myOwned.has(p.id);
            const owner = ownerOf(p.id);

            let actionCell = null;
            if (!username) {
              actionCell = <span style={{ color: "#777" }}>Log in to manage</span>;
            } else if (mine) {
              actionCell = (
                <button
                  onClick={() => handleDrop(p)}
                  disabled={isDraftLocked}
                  title={isDraftLocked ? "Disabled during draft" : "Drop this player"}
                >
                  Drop
                </button>
              );
            } else if (owner && owner !== username) {
              actionCell = <span style={{ color: "#999" }}>Owned by {owner}</span>;
            } else {
              actionCell = (
                <button
                  onClick={() => handleAdd(p)}
                  disabled={isDraftLocked}
                  title={isDraftLocked ? "Disabled during draft" : "Add to my team (bench)"}
                >
                  Add
                </button>
              );
            }

            return (
              <tr key={p.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
                <td>{name}</td>
                <td>{p.position || "-"}</td>
                <td>{p.team || "-"}</td>
                <td>{opp}</td>
                <td>{proj}</td>
                <td style={{ textAlign: "right" }}>{actionCell}</td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#999", paddingTop: 12 }}>
                No players match your filters. Add players to Firestore or clear filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
