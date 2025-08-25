/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  ensureTeam,
  listPlayersMap,
  getPlayerById,
  asId,
  playerDisplay,
  projForWeek,
  opponentForWeek,
  moveToStarter,
  moveToBench,
} from "../lib/storage";

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  // 1) Ensure team + live subscribe
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

  // 2) Load initial player map
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

  // 3) Build a reverse index of alternate IDs → player
  const reverseIndex = useMemo(() => {
    const idx = new Map();
    playersMap.forEach((p) => {
      const cand = new Set([
        asId(p?.id),
        asId(p?.playerId),
        asId(p?.player_id),
        asId(p?.pid),
        asId(p?.sleeperId),
        asId(p?.sleeper_id),
        asId(p?.gsisId),
        asId(p?.espnId),
        asId(p?.yahooId),
        asId(p?.externalId),
      ].filter(Boolean));
      cand.forEach((k) => {
        if (!idx.has(k)) idx.set(k, p);
        // also index numeric<->string flips
        const n = Number(k);
        if (Number.isFinite(n)) {
          const kNum = String(n);
          if (!idx.has(kNum)) idx.set(kNum, p);
        }
      });
    });
    return idx;
  }, [playersMap]);

  // 4) Canonicalize roster + bench ids we need
  const roster = team?.roster || {};
  const benchIds = Array.isArray(team?.bench) ? team.bench : [];
  const allNeededIds = useMemo(() => {
    const ids = new Set();
    ROSTER_SLOTS.forEach((slot) => {
      const pid = roster?.[slot];
      if (pid != null) ids.add(asId(pid));
    });
    benchIds.forEach((pid) => ids.add(asId(pid)));
    return Array.from(ids).filter(Boolean);
  }, [roster, benchIds]);

  // 5) Resolve helper: try map → reverseIndex → lazy fetch
  function resolveFromCaches(rawId) {
    const key = asId(rawId);
    if (!key) return null;
    // direct map hit
    const direct = playersMap.get(key);
    if (direct) return direct;
    // reverse index hit
    const alt = reverseIndex.get(key);
    if (alt) return alt;
    // try numeric/string flip in reverse index
    const n = Number(key);
    if (Number.isFinite(n)) {
      const alt2 = reverseIndex.get(String(n));
      if (alt2) return alt2;
    }
    return null;
  }

  useEffect(() => {
    if (!leagueId || allNeededIds.length === 0) return;
    let cancelled = false;

    (async () => {
      const missing = allNeededIds.filter((pid) => {
        const p = resolveFromCaches(pid);
        return !p;
      });
      if (missing.length === 0) return;

      try {
        const updates = [];
        for (const m of missing) {
          const p = await getPlayerById({ leagueId, id: m });
          if (p) updates.push([asId(m), p]);
        }
        if (!cancelled && updates.length) {
          setPlayersMap((prev) => {
            const next = new Map(prev);
            for (const [pid, p] of updates) next.set(pid, p);
            return next;
          });
        }
      } catch (e) {
        console.error("lazy load players by id:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, allNeededIds]); // deliberately not depending on playersMap/reverseIndex to avoid loops

  // 6) Starters view
  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const p = resolveFromCaches(raw);
      return { slot, id: asId(raw), p };
    });
  }, [roster, reverseIndex, playersMap]); // reverseIndex/playersMap updates will re-resolve

  // actions
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

  // field helpers
  const nameOf = (p) => (p ? playerDisplay(p) : "(empty)");
  const posOf = (p) => p?.position || "-";
  const teamOf = (p) => p?.team || "-";
  const oppOf = (p) => (p ? (opponentForWeek(p, week) || "-") : "-");
  const projOf = (p) => {
    const val = p ? projForWeek(p, week) : 0;
    return (Number.isFinite(val) ? val : 0).toFixed(1);
  };

  return (
    <div>
      <h3>Starters — Week {week}</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
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
              <td>{nameOf(p)}</td>
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
          {benchIds.map((rawId) => {
            const pid = asId(rawId);
            const p = resolveFromCaches(pid);
            return (
              <tr key={pid || String(rawId)} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{nameOf(p)}</td>
                <td>{posOf(p)}</td>
                <td>{teamOf(p)}</td>
                <td>{oppOf(p)}</td>
                <td>{projOf(p)}</td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const slot = e.target.value;
                      if (slot) handleBenchToSlot(pid, slot);
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
            );
          })}
          {benchIds.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#999" }}>(no bench players)</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
