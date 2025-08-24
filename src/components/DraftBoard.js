/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listPlayers,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  draftPick,
  isMyTurn,
  currentDrafter,
  autoDraftIfExpired,
  hasPaidEntry,
  listMemberUsernames,
} from "../lib/storage";

export default function DraftBoard({ leagueId, username, currentWeek=1 }) {
  const [league, setLeague] = useState(null);
  const [players, setPlayers] = useState([]);
  const [pmap, setPmap] = useState(new Map());
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");

  // live league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // players & map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        if (mounted) {
          setPlayers(arr || []);
          const map = await listPlayersMap({ leagueId });
          setPmap(map);
        }
      } catch (e) {
        console.error("listPlayers:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // simple pick clock / auto-draft tick
  useEffect(() => {
    if (!leagueId) return;
    const t = setInterval(() => {
      autoDraftIfExpired({ leagueId, currentWeek }).catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [leagueId, currentWeek]);

  const order = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const onClock = currentDrafter(league);
  const myTurn = isMyTurn(league, username);

  const canUserDraft = useMemo(() => {
    if (league?.draft?.status !== "live") return false;
    // payments gate: if enabled, all must be paid
    if (league?.entry?.enabled) {
      // quick local check: if any missing paid, block UI; server still blocks by status
      const paid = league?.entry?.paid || {};
      for (const u of order) if (!paid[u]) return false;
    }
    return myTurn;
  }, [league, order, myTurn]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (players || [])
      .filter((p) => (pos === "ALL" ? true : String(p.position || "").toUpperCase() === pos))
      .filter((p) => {
        if (!needle) return true;
        const nm = playerDisplay(p).toLowerCase();
        return nm.includes(needle) || String(p.id || "").toLowerCase().includes(needle);
      })
      .sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
  }, [players, q, pos, currentWeek]);

  const doPick = async (p) => {
    try {
      await draftPick({
        leagueId,
        username,
        playerId: p.id,
        playerPosition: p.position,
        slot: null,
      });
    } catch (e) {
      console.error("draftPick:", e);
      alert(String(e?.message || e));
    }
  };

  // Very lightweight “everyone paid?” banner
  const allPaidBanner = useMemo(() => {
    if (!league?.entry?.enabled) return null;
    const paid = league?.entry?.paid || {};
    const missing = (order || []).filter((u) => !paid[u]);
    if (missing.length === 0) return null;
    return (
      <div style={{ padding: 8, border: "1px dashed #d33", borderRadius: 6, color: "#a00", marginBottom: 8 }}>
        Payments required before drafting: waiting on {missing.join(", ")}.
      </div>
    );
  }, [league, order]);

  if (!league) return <div>Loading draft…</div>;

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Draft Board</h3>

      <div style={{ marginBottom: 8, color: "#555" }}>
        Status: <b>{league?.draft?.status || "unknown"}</b>
      </div>

      {allPaidBanner}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "#666" }}>On the clock</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{onClock || "-"}</div>
        </div>
        <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "#666" }}>Round</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{league?.draft?.round || 1}</div>
        </div>
        <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "#666" }}>Pick Clock</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {league?.draft?.deadline ? Math.max(0, Math.ceil((league.draft.deadline - Date.now()) / 1000)) : "-"}s
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Search players…"
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
      </div>

      {league?.draft?.status !== "live" && (
        <div style={{ color: "#777", marginBottom: 8 }}>
          Draft isn’t live yet. Start it from the Admin tab when ready.
        </div>
      )}

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Player</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Proj (W{currentWeek})</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
              <td>{playerDisplay(p)}</td>
              <td>{p.position || "-"}</td>
              <td>{p.team || "-"}</td>
              <td>{projForWeek(p, currentWeek).toFixed(1)}</td>
              <td style={{ textAlign: "right" }}>
                <button
                  disabled={!canUserDraft}
                  onClick={() => doPick(p)}
                  title={canUserDraft ? "Draft player" : "Not your turn / draft not live / unpaid"}
                >
                  Draft
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#999", paddingTop: 12 }}>
                No available players match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Order row */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Draft Order</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(order || []).map((u, i) => (
            <div
              key={`${u}-${i}`}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #ddd",
                background: u === onClock ? "#ffe" : "#fafafa",
                fontWeight: u === onClock ? 700 : 400,
              }}
            >
              {i + 1}. {u}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
