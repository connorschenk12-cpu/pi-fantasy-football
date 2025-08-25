/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  ensureTeam,
  listPlayers,       // ← use the same source as Players tab
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
} from "../lib/storage";

// Build a tolerant index for many possible id shapes
function buildPlayerIndex(players = []) {
  const idx = new Map();
  const put = (k, p) => {
    if (k == null) return;
    const key = String(k).trim();
    if (!key) return;
    if (!idx.has(key)) idx.set(key, p);
  };

  for (const p of players) {
    // canonical and numeric forms
    put(p.id, p);
    if (p?.id != null && !Number.isNaN(Number(p.id))) put(String(Number(p.id)), p);

    // common alternates we’ve seen in data
    put(p.playerId, p);
    put(p.pid, p);
    put(p.espnId, p);
    put(p.yahooId, p);
    put(p.sleeperId, p);
    put(p.externalId, p);

    // sometimes roster stores {id: "..."} objects; this lets us match JSONified forms
    if (typeof p.id === "object" && p.id?.id != null) put(p.id.id, p);
  }
  return idx;
}

// Try to resolve any roster value (string/number/object) to a player using the index.
// Falls back to a slow scan once (rare).
function resolvePlayer(raw, idx, players) {
  if (raw == null) return null;

  // (a) direct try
  const direct = idx.get(String(raw));
  if (direct) return direct;

  // (b) number/string coercion
  const coerce = idx.get(String(Number(raw)));
  if (coerce) return coerce;

  // (c) object like {id: "..."}
  if (typeof raw === "object" && raw.id != null) {
    const objHit =
      idx.get(String(raw.id)) || idx.get(String(Number(raw.id)));
    if (objHit) return objHit;
  }

  // (d) last-resort scan by any known id field
  const candidate = players.find((p) => {
    const keys = [
      p.id,
      p.playerId,
      p.pid,
      p.espnId,
      p.yahooId,
      p.sleeperId,
      p.externalId,
    ].filter((k) => k != null);
    const rawStr = String(raw);
    const rawNum = String(Number(raw));
    return keys.some((k) => rawStr === String(k) || rawNum === String(Number(k)));
  });
  return candidate || null;
}

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);        // ← same flow as Players tab
  const [index, setIndex] = useState(new Map());     // tolerant index
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

  // Load players exactly like Players tab does
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        if (!alive) return;
        setPlayers(arr || []);
        setIndex(buildPlayerIndex(arr || []));
      } catch (e) {
        console.error("listPlayers (MyTeam):", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const p = resolvePlayer(raw, index, players);
      return { slot, rawId: raw, p };
    });
  }, [roster, index, players]);

  const benchRows = useMemo(() => {
    return bench.map((raw) => {
      const p = resolvePlayer(raw, index, players);
      return { rawId: raw, p };
    });
  }, [bench, index, players]);

  async function handleBenchToSlot(playerIdOrRaw, slot) {
    try {
      // playerIdOrRaw may be number/string/object; extract an id to move
      const found = resolvePlayer(playerIdOrRaw, index, players);
      const idToUse =
        (found?.id != null ? String(found.id) : String(playerIdOrRaw));
      await moveToStarter({ leagueId, username, playerId: idToUse, slot });
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

  function nameOf(p, fallbackRaw) {
    if (p) return playerDisplay(p);
    return `(unknown: ${String(fallbackRaw)})`;
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

  return (
    <div>
      <h3>Starters — Week {week}</h3>
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
          {starters.map(({ slot, rawId, p }) => (
            <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td><b>{slot}</b></td>
              <td>{nameOf(p, rawId)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                {p || rawId ? (
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
          {benchRows.map(({ rawId, p }, i) => (
            <tr key={`${String(rawId)}-${i}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
              <td>{nameOf(p, rawId)}</td>
              <td>{posOf(p)}</td>
              <td>{teamOf(p)}</td>
              <td>{oppOf(p)}</td>
              <td>{projOf(p)}</td>
              <td>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const slot = e.target.value;
                    if (slot) handleBenchToSlot(rawId, slot);
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
    </div>
  );
}
