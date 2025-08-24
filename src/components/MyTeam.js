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
  pointsForPlayer,
  moveToStarter,
  moveToBench,
} from "../lib/storage";

/**
 * Props:
 *  - leagueId (string, required)
 *  - username (string, required)
 */
export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());

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

  // ---------- stat helpers (tolerant to several shapes) ----------
  const getWeekStat = (p, week, keyVariants) => {
    // Try nested weekly shapes first
    const w = String(week);
    const weekly =
      p?.stats?.week?.[w] ??
      p?.stats?.byWeek?.[w] ??
      p?.weeklyStats?.[w] ??
      null;

    if (weekly) {
      for (const k of keyVariants) {
        if (weekly[k] != null) return Number(weekly[k]) || 0;
      }
    }
    // Fallback flat keys like statW1 etc.
    for (const k of keyVariants) {
      const kk = `${k}W${week}`;
      if (p?.[kk] != null) return Number(p[kk]) || 0;
    }
    return 0;
  };

  const getSeasonStat = (p, keyVariants) => {
    const season =
      p?.stats?.season ??
      p?.seasonStats ??
      null;
    if (season) {
      for (const k of keyVariants) {
        if (season[k] != null) return Number(season[k]) || 0;
      }
    }
    // Fallback to flat fields on the player record
    for (const k of keyVariants) {
      if (p?.[k] != null) return Number(p[k]) || 0;
    }
    return 0;
  };

  const statExtractors = useMemo(() => {
    return {
      passYds: (p) => getSeasonStat(p, ["passYds", "passingYds", "passYards", "seasonPassYds"]),
      rushYds: (p) => getSeasonStat(p, ["rushYds", "rushingYds", "rushYards", "seasonRushYds"]),
      recYds:  (p) => getSeasonStat(p, ["recYds", "receivingYds", "recYards", "seasonRecYds"]),
      tds:     (p) => getSeasonStat(p, ["td", "tds", "touchdowns", "totalTd"]),
      // Weekly fantasy points + projections
      fptsWeek: (p) => {
        // If you have real weekly fantasy scoring, replace this with a scoring function.
        // For now, use pointsForPlayer (same value as proj unless you store actuals).
        return Number(pointsForPlayer(p, currentWeek) || 0);
      },
      projWeek: (p) => Number(projForWeek(p, currentWeek) || 0),
    };
  }, [currentWeek]);

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

      const row = {
        slot,
        id: pid,
        name: p ? playerDisplay(p) : "(empty)",
        pos: p?.position || "-",
        team: p?.team || "-",
        passYds: p ? statExtractors.passYds(p) : 0,
        rushYds: p ? statExtractors.rushYds(p) : 0,
        recYds:  p ? statExtractors.recYds(p) : 0,
        tds:     p ? statExtractors.tds(p) : 0,
        fptsWeek: p ? statExtractors.fptsWeek(p) : 0,
        projWeek: p ? statExtractors.projWeek(p) : 0,
      };
      return row;
    });
  }, [roster, playersMap, statExtractors]);

  const benchRows = useMemo(() => {
    return (bench || []).map((pid) => {
      const p = pid ? playersMap.get(pid) : null;
      return {
        id: pid,
        name: p ? playerDisplay(p) : String(pid || ""),
        pos: p?.position || "-",
        team: p?.team || "-",
        passYds: p ? statExtractors.passYds(p) : 0,
        rushYds: p ? statExtractors.rushYds(p) : 0,
        recYds:  p ? statExtractors.recYds(p) : 0,
        tds:     p ? statExtractors.tds(p) : 0,
        fptsWeek: p ? statExtractors.fptsWeek(p) : 0,
        projWeek: p ? statExtractors.projWeek(p) : 0,
      };
    });
  }, [bench, playersMap, statExtractors]);

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
        <b>Week {currentWeek}</b> — manage your starters and bench. Projections show this week.
      </div>

      {/* Starters table */}
      <h3 style={{ margin: "16px 0 8px" }}>Starters</h3>
      <div style={{ overflowX: "auto" }}>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", minWidth: 720 }}>
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

      {/* Bench table */}
      <h3 style={{ margin: "20px 0 8px" }}>Bench</h3>
      <div style={{ overflowX: "auto" }}>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", minWidth: 720 }}>
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
