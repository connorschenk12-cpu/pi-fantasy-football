/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  ensureTeam,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
  asId,
} from "../lib/storage";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [showDebug, setShowDebug] = useState(false);
  const week = Number(currentWeek || 1);

  // Ensure team + subscribe
  useEffect(() => {
    if (!leagueId || !username) return;
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error("ensureTeam/listenTeam:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Load players (for id → name lookups)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // Coerce ids before Map lookup
  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const id = asId(raw);
      const p = id ? playersMap.get(id) : null;
      return { slot, rawId: raw, id, p };
    });
  }, [roster, playersMap]);

  const benchRows = useMemo(() => {
    return bench.map((raw) => {
      const id = asId(raw);
      const p = id ? playersMap.get(id) : null;
      return { rawId: raw, id, p };
    });
  }, [bench, playersMap]);

  async function handleBenchToSlot(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter:", e);
      alert(String(e?.message || e));
    }
  }

  async function handleSlotToBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench:", e);
      alert(String(e?.message || e));
    }
  }

  function nameOf(p, fallbackId) {
    return p ? playerDisplay(p) : fallbackId ? `(unknown: ${fallbackId})` : "(empty)";
  }

  function posOf(p) {
    return p?.position || "-";
  }

  function teamOf(p) {
    return p?.team || "-";
  }

  function oppOf(p) {
    return p ? (opponentForWeek(p, week) || "-") : "-";
  }

  function projOf(p) {
    const val = p ? projForWeek(p, week) : 0;
    return (Number.isFinite(val) ? val : 0).toFixed(1);
  }

  // Simple inline debug panel (no external import)
  function DebugBlock() {
    // collect all roster/bench ids we tried
    const tried = [
      ...starters.map((r) => r.id).filter(Boolean),
      ...benchRows.map((r) => r.id).filter(Boolean),
    ];
    const missing = tried.filter((id) => !playersMap.has(id));
    const exampleKeys = Array.from(playersMap.keys()).slice(0, 20);

    return (
      <div style={{ marginTop: 12, padding: 12, border: "1px dashed #bbb", borderRadius: 6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Debug</div>
        <div style={{ fontSize: 12, color: "#333" }}>
          <div>playersMap size: {playersMap.size}</div>
          <div>example player ids (first 20): {exampleKeys.join(", ") || "(none)"}</div>
          <div>missing ids encountered: {missing.join(", ") || "(none)"}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <table width="100%" cellPadding="4" style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th>Area</th>
                <th>Slot/Idx</th>
                <th>rawId</th>
                <th>asId</th>
                <th>found?</th>
                <th>name (if found)</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((r) => (
                <tr key={`s-${r.slot}`} style={{ borderBottom: "1px solid #f8f8f8" }}>
                  <td>starter</td>
                  <td>{r.slot}</td>
                  <td>{JSON.stringify(r.rawId)}</td>
                  <td>{String(r.id || "")}</td>
                  <td>{r.p ? "yes" : "no"}</td>
                  <td>{r.p ? playerDisplay(r.p) : ""}</td>
                </tr>
              ))}
              {benchRows.map((r, i) => (
                <tr key={`b-${i}`} style={{ borderBottom: "1px solid #f8f8f8" }}>
                  <td>bench</td>
                  <td>{i}</td>
                  <td>{JSON.stringify(r.rawId)}</td>
                  <td>{String(r.id || "")}</td>
                  <td>{r.p ? "yes" : "no"}</td>
                  <td>{r.p ? playerDisplay(r.p) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Starters — Week {week}</h3>
        <button onClick={() => setShowDebug((v) => !v)}>
          {showDebug ? "Hide Debug" : "Show Debug"}
        </button>
      </div>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ width: 60 }}>Slot</th>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {starters.map(({ slot, id, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p, id)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                {id ? (
                  <button onClick={() => handleSlotToBench(slot)}>Send to Bench</button>
                ) : (
                  <span style={{ color: "#999" }}>(empty)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Bench</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Opp</th>
            <th>Proj</th>
            <th>Move to slot…</th>
          </tr>
        </thead>
        <tbody>
          {benchRows.map(({ id, p }, i) => (
            <tr key={`${id || "empty"}-${i}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td>{nameOf(p, id)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (slot) handleBenchToSlot(id, slot);
                  }}
                >
                  <option value="">Choose slot</option>
                  {ROSTER_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {benchRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#999" }}>(no bench players)</td>
            </tr>
          )}
        </tbody>
      </table>

      {showDebug && <DebugBlock />}
    </div>
  );
}
