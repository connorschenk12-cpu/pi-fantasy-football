/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listPlayersMap,
  playerDisplay,
  isMyTurn,
  draftPick,
  autoDraftIfExpired,
  canDraft,
  currentRound,
} from "../lib/storage";

/**
 * Props:
 *  - leagueId
 *  - username
 *  - currentWeek
 */
export default function DraftBoard({ leagueId, username, currentWeek }) {
  const [league, setLeague] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState("ALL");

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const pm = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(pm);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  // Background: check pick clock -> auto draft if expired
  useEffect(() => {
    let t = null;
    if (!leagueId) return undefined;
    const tick = async () => {
      try {
        await autoDraftIfExpired({ leagueId, currentWeek: Number(currentWeek || 1) });
      } catch (e) {
        // non-fatal
      } finally {
        t = setTimeout(tick, 1500);
      }
    };
    tick();
    return () => t && clearTimeout(t);
  }, [leagueId, currentWeek]);

  const order = useMemo(() => (league?.draft?.order || []), [league]);
  const pointer = Number(league?.draft?.pointer || 0);
  const round = currentRound(league || {});

  const available = useMemo(() => {
    // Available = players not in claims; but we don’t listen to claims here to keep it simple.
    // For searching, we only filter by name/pos locally.
    const arr = Array.from(playersMap.values());
    return arr
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return playerDisplay(p).toLowerCase().includes(needle) || String(p.id).toLowerCase().includes(needle);
      })
      .slice(0, 300);
  }, [playersMap, search, pos]);

  const onDraft = async (playerId) => {
    try {
      const p = playersMap.get(playerId);
      if (!p) return alert("Player not found");
      await draftPick({
        leagueId,
        username,
        playerId,
        playerPosition: p.position,
        slot: null,
      });
    } catch (e) {
      console.error("draftPick error:", e);
      alert(String(e?.message || e));
    }
  };

  const live = canDraft(league || {});
  const myTurn = isMyTurn(league || {}, username);

  return (
    <div>
      <h3>Draft Board</h3>

      <div style={{ marginBottom: 8, color: live ? "#0a0" : "#999" }}>
        Status: <b>{league?.draft?.status || "scheduled"}</b>
        {" · "}Round <b>{round}</b>
        {" · "}On the clock: <b>{order[pointer] || "-"}</b>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="Search player name or id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
      </div>

      {!live && (
        <div style={{ marginBottom: 12, color: "#b26" }}>
          Draft is not live yet. The commissioner can start it from the Admin tab.
        </div>
      )}

      {live && myTurn && (
        <div style={{ marginBottom: 12, color: "#0a0" }}>
          <b>It's your turn!</b> Pick any available player below.
        </div>
      )}

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {available.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td>{playerDisplay(p)}</td>
              <td>{p.position || "-"}</td>
              <td>{p.team || "-"}</td>
              <td>
                <button
                  disabled={!live || !myTurn}
                  onClick={() => onDraft(p.id)}
                  title={!live ? "Draft not live" : (!myTurn ? "Not your turn" : "Draft")}
                >
                  Draft
                </button>
              </td>
            </tr>
          ))}
          {available.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#999", paddingTop: 12 }}>
                No players match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
