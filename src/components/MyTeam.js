/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  listenLeague,
  listenTeam,
  ensureTeam,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  moveToStarter,
  moveToBench,
  fetchWeekStats, // <-- new helper from storage.js (see section 2)
} from "../lib/storage";
import { computeFantasyPoints } from "../lib/scoring"; // <-- see section 3

/**
 * Props:
 *  - leagueId (string, required)
 *  - username (string, required)
 */
export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [weekStats, setWeekStats] = useState({}); // { [playerId]: rawStatObj }

  // Get league (for currentWeek)
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure and listen to my team
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        if (!leagueId || !username) return;
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error("ensureTeam/listenTeam error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Load players map for name/metadata lookups
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  const currentWeek = Number(league?.settings?.currentWeek || 1);
  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // Collect all my playerIds for this screen
  const allMyIds = useMemo(() => {
    const ids = new Set();
    ROSTER_SLOTS.forEach((s) => {
      const pid = roster?.[s];
      if (pid) ids.add(pid);
    });
    (bench || []).forEach((pid) => pid && ids.add(pid));
    return Array.from(ids);
  }, [roster, bench]);

  // Fetch LIVE week stats for those players (FPts will be 0 if nothing returned)
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        if (!leagueId || allMyIds.length === 0) {
          setWeekStats({});
          return;
        }
        const stats = await fetchWeekStats({ week: currentWeek, ids: allMyIds });
        if (!aborted) setWeekStats(stats || {});
      } catch (e) {
        console.error("fetchWeekStats error:", e);
        if (!aborted) setWeekStats({});
      }
    })();
    return () => {
      aborted = true;
    };
  }, [leagueId, currentWeek, allMyIds]);

  const handleBenchToSlot = async (playerId, slot) => {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter error:", e);
      alert(String(e?.message || e));
    }
  };
  const handleSlotToBench = async (slot) => {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench error:", e);
      alert(String(e?.message || e));
    }
  };

  const startersRows = useMemo(() => {
    return (ROSTER_SLOTS || []).map((slot) => {
      const pid = roster?.[slot] || null;
      const p = pid ? playersMap.get(pid) : null;
      const raw = pid ? weekStats[pid] : null; // raw stats for this week from API
      const fpts = raw ? computeFantasyPoints(raw) : 0; // zero until live stats exist
      const proj = p ? Number(projForWeek(p, currentWeek) || 0) : 0;

      return {
        slot,
        id: pid,
        name: p ? playerDisplay(p) : "(empty)",
        pos: p?.position || "-",
        team: p?.team || "-",
        // optional show-yards/tds if your raw has them
        passYds: Number(raw?.passYds || raw?.passingYds || 0),
        rushYds: Number(raw?.rushYds || raw?.rushingYds || 0),
        recYds: Number(raw?.recYds || raw?.receivingYds || 0),
        tds:
          Number(raw?.passTd || 0) +
          Number(raw?.rushTd || 0) +
          Number(raw?.recTd || 0),
        fptsWeek: fpts,
        projWeek: proj,
      };
    });
  }, [roster, playersMap, weekStats, currentWeek]);

  const benchRows = useMemo(() => {
    return (bench || []).map((pid) => {
      const p = pid ? playersMap.get(pid) : null;
      const raw = pid ? weekStats[pid] : null;
      const fpts = raw ? computeFantasyPoints(raw) : 0;
      const proj = p ? Number(projForWeek(p, currentWeek) || 0) : 0;

      return {
        id: pid,
        name: p ? playerDisplay(p) : String(pid || ""),
        pos: p?.position || "-",
        team: p?.team || "-",
        passYds: Number(raw?.passYds || raw?.passingYds || 0),
        rushYds: Number(raw?.rushYds || raw?.rushingYds || 0),
        recYds: Number(raw?.recYds || raw?.receivingYds || 0),
        tds:
          Number(raw?.passTd || 0) +
          Number(raw?.rushTd || 0) +
          Number(raw?.recTd || 0),
        fptsWeek: fpts,
        projWeek: proj,
      };
    });
  }, [bench, playersMap, weekStats, currentWeek]);

  const startersTotals = useMemo(() => {
    return startersRows.reduce(
      (acc, r) => {
        acc.passYds += r.passYds;
        acc.rushYds += r.rushYds;
        acc.recYds += r.recYds;
        acc.tds += r.tds;
        acc.fptsWeek += r.fptsWeek;
        acc.projWeek += r.projWeek;
        return acc;
      },
      { passYds: 0, rushYds: 0, recYds: 0, tds: 0, fptsWeek: 0, projWeek: 0 }
    );
  }, [startersRows]);

  return (
    <div>
      <div style={{ marginBottom: 8, color: "#555" }}>
        <b>Week {currentWeek}</b> — FPts = live stats (0 if no games yet). Proj = projections.
      </div>

      {/* Starters */}
      <h3 style={{ margin: "16px 0 8px" }}>Starters</h3>
      <div style={{ overflowX: "auto" }}>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", minWidth: 840 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 56 }}>Slot</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Team</th>
              <th style={{ textAlign: "right" }}>Pass Yds</th>
              <th style={{ textAlign: "right" }}>Rush Yds</th>
              <th style={{ textAlign: "right" }}>Rec Yds</th>
              <th style={{ textAlign: "right" }}>TDs</th>
              <th style={{ textAlign: "right" }}>FPts</th>
              <th style={{ textAlign: "right" }}>Proj</th>
              <th style={{ width: 140 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {startersRows.map((r) => (
              <tr key={r.slot} style={{ borderBottom: "1px solid #f1f1f1" }}>
                <td><b>{r.slot}</b></td>
                <td>{r.name}</td>
                <td>{r.pos}</td>
                <td>{r.team}</td>
                <td style={{ textAlign: "right" }}>{r.passYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.rushYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.recYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.tds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.fptsWeek.toFixed(1)}</td>
                <td style={{ textAlign: "right" }}>{r.projWeek.toFixed(1)}</td>
                <td>
                  {r.id ? (
                    <button onClick={() => handleSlotToBench(r.slot)}>Send to Bench</button>
                  ) : (
                    <span style={{ color: "#999" }}>(empty)</span>
                  )}
                </td>
              </tr>
            ))}
            <tr style={{ background: "#fafafa" }}>
              <td />
              <td colSpan={3}><b>Totals</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.passYds.toFixed(0)}</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.rushYds.toFixed(0)}</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.recYds.toFixed(0)}</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.tds.toFixed(0)}</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.fptsWeek.toFixed(1)}</b></td>
              <td style={{ textAlign: "right" }}><b>{startersTotals.projWeek.toFixed(1)}</b></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bench */}
      <h3 style={{ margin: "20px 0 8px" }}>Bench</h3>
      <div style={{ overflowX: "auto" }}>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", minWidth: 840 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th>Name</th>
              <th>Pos</th>
              <th>Team</th>
              <th style={{ textAlign: "right" }}>Pass Yds</th>
              <th style={{ textAlign: "right" }}>Rush Yds</th>
              <th style={{ textAlign: "right" }}>Rec Yds</th>
              <th style={{ textAlign: "right" }}>TDs</th>
              <th style={{ textAlign: "right" }}>FPts</th>
              <th style={{ textAlign: "right" }}>Proj</th>
              <th style={{ width: 220 }}>Move to Slot…</th>
            </tr>
          </thead>
          <tbody>
            {benchRows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #f1f1f1" }}>
                <td>{r.name}</td>
                <td>{r.pos}</td>
                <td>{r.team}</td>
                <td style={{ textAlign: "right" }}>{r.passYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.rushYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.recYds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.tds.toFixed(0)}</td>
                <td style={{ textAlign: "right" }}>{r.fptsWeek.toFixed(1)}</td>
                <td style={{ textAlign: "right" }}>{r.projWeek.toFixed(1)}</td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const slot = e.target.value;
                      if (slot) handleBenchToSlot(r.id, slot);
                    }}
                  >
                    <option value="">Select slot…</option>
                    {ROSTER_SLOTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {benchRows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ color: "#999", paddingTop: 12 }}>
                  (no bench players)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
