/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  ensureTeam,
  listPlayers,       // same source as Players tab
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
} from "../lib/storage";

/** Build a tolerant index for many possible id shapes */
function buildPlayerIndex(players = []) {
  const idx = new Map();
  const put = (k, p) => {
    if (k == null) return;
    const key = String(k).trim();
    if (!key) return;
    if (!idx.has(key)) idx.set(key, p);
  };

  for (const p of players) {
    put(p.id, p);
    // numeric/string coercions
    if (p?.id != null && !Number.isNaN(Number(p.id))) put(String(Number(p.id)), p);

    // common alternates we’ve seen in data
    put(p.playerId, p);
    put(p.pid, p);
    put(p.espnId, p);
    put(p.yahooId, p);
    put(p.sleeperId, p);
    put(p.externalId, p);
    put(p.PlayerID, p);       // some caps variants
    put(p.player_id, p);
    put(p.PlayerId, p);

    // some old seeds saved name as id (rare)
    if (p.name) put(p.name, p);

    // object-y ids
    if (typeof p.id === "object" && p.id?.id != null) {
      put(p.id.id, p);
      if (!Number.isNaN(Number(p.id.id))) put(String(Number(p.id.id)), p);
    }
  }
  return idx;
}

/** Normalize any roster value into possible lookup keys */
function* candidateKeys(raw) {
  if (raw == null) return;
  // simple
  yield String(raw);
  // number coercion
  if (!Number.isNaN(Number(raw))) yield String(Number(raw));
  // arrays: sometimes stored like ["123"]
  if (Array.isArray(raw)) {
    for (const x of raw) {
      yield String(x);
      if (!Number.isNaN(Number(x))) yield String(Number(x));
    }
  }
  // objects: { id }, { playerId }, { pid }, { value }, DocumentReference-like
  if (typeof raw === "object") {
    const cand = [
      raw.id,
      raw.playerId,
      raw.pid,
      raw.value,
      raw.key,
      raw.ref?.id,
      raw.doc?.id,
    ].filter((v) => v != null);
    for (const v of cand) {
      yield String(v);
      if (!Number.isNaN(Number(v))) yield String(Number(v));
    }
    // brute force: any enumerable prop that looks like an id
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (v != null && (k.toLowerCase().includes("id") || typeof v === "string" || typeof v === "number")) {
        yield String(v);
        if (!Number.isNaN(Number(v))) yield String(Number(v));
      }
    }
  }
}

/** Resolve any roster value (string/number/object/array) to a player */
function resolvePlayer(raw, idx, players) {
  // fast path: index lookups
  for (const key of candidateKeys(raw)) {
    const hit = idx.get(key);
    if (hit) return hit;
  }

  // slow path: scan by any likely id field
  const rawStr = String(raw);
  const rawNum = String(Number(raw));
  const hit = players.find((p) => {
    const ids = [
      p.id, p.playerId, p.pid, p.espnId, p.yahooId, p.sleeperId, p.externalId,
      p.PlayerID, p.player_id, p.PlayerId, p.name,
      typeof p.id === "object" ? p.id?.id : null,
    ].filter((v) => v != null);
    return ids.some((v) => rawStr === String(v) || rawNum === String(Number(v)));
  });

  return hit || null;
}

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [index, setIndex] = useState(new Map());
  const [showDebug, setShowDebug] = useState(false); // quick toggle to see raw ids
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

  // Load players exactly like Players tab
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
      const found = resolvePlayer(playerIdOrRaw, index, players);
      const idToUse =
        found?.id != null
          ? String(found.id)
          : Array.isArray(playerIdOrRaw)
          ? String(playerIdOrRaw[0])
          : typeof playerIdOrRaw === "object" && playerIdOrRaw?.id != null
          ? String(playerIdOrRaw.id)
          : String(playerIdOrRaw);
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

  const fmtRaw = (v) => {
    try {
      if (v == null) return "null";
      if (typeof v === "string" || typeof v === "number") return String(v);
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  function nameOf(p, fallbackRaw) {
    if (p) return playerDisplay(p);
    // Force-show the raw when unknown so we can identify the shape
    return `(unknown → ${fmtRaw(fallbackRaw)})`;
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>Starters — Week {week}</h3>
        <button onClick={() => setShowDebug((s) => !s)} style={{ fontSize: 12 }}>
          {showDebug ? "Hide debug" : "Show debug"}
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
            <tr key={`${fmtRaw(rawId)}-${i}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
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

      {showDebug && (
        <div style={{ marginTop: 16, padding: 12, background: "#fafafa", border: "1px dashed #ddd" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Debug — raw roster values</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
{JSON.stringify(
  {
    roster,
    bench,
    // helpful to confirm some player samples loaded:
    samplePlayers: players.slice(0, 5).map((p) => ({ id: p.id, name: p.name, pos: p.position })),
  },
  null,
  2
)}
          </pre>
        </div>
      )}
    </div>
  );
}
