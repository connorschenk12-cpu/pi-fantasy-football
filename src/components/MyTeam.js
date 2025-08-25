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

  // Load initial players map
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

  // Canonical roster + bench ids
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

  // If some roster/bench ids are missing from playersMap, lazy-fetch them and cache
  useEffect(() => {
    if (!leagueId || allNeededIds.length === 0) return;
    let cancelled = false;

    (async () => {
      const missing = allNeededIds.filter((pid) => pid && !playersMap.has(pid));
      if (missing.length === 0) return;

      try {
        const updates = [];
        for (const pid of missing) {
          const p = await getPlayerById({ leagueId, id: pid });
          if (p) updates.push([pid, p]);
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
  }, [leagueId, allNeededIds, playersMap]);

  // Build starters view
  const starters = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const raw = roster[slot] ?? null;
      const key = asId(raw);
      const p = key ? playersMap.get(key) : null;
      return { slot, id: key, p };
    });
  }, [roster, playersMap]);

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

  // Safe field helpers
  function nameOf(p) {
    return p ? playerDisplay(p) : "(empty)";
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
            const p = pid ? playersMap.get(pid) : null;
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
