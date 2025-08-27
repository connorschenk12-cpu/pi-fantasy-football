/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  // data
  listenLeague,
  listenTeam,
  listPlayersMap,
  // scoring & helpers
  fetchWeekStats,
  computeTeamPoints,
  projForWeek,
  playerDisplay,
  opponentForWeek,
  allowedSlotsForPlayer,
  ROSTER_SLOTS,
  // team actions
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  // payments
  hasPaidEntry,
  leagueIsFree,
  // optional; if you don't have this helper just leave the href as "/payments"
  paymentCheckoutUrl,
} from "../lib/storage.js";

/** Client-side scoring in case the API doesn't return a "points" number */
const SCORING = {
  passYds: 0.04, // 1 per 25
  passTD: 4,
  passInt: -2,
  rushYds: 0.1, // 1 per 10
  rushTD: 6,
  recYds: 0.1, // 1 per 10
  recTD: 6,
  rec: 1, // PPR (change to 0 for standard)
  fumbles: -2,
};

function computePointsFromRow(row) {
  if (!row) return 0;
  const s = SCORING;
  const n = (v) => (v == null ? 0 : Number(v) || 0);
  const pts =
    n(row.passYds) * s.passYds +
    n(row.passTD) * s.passTD +
    n(row.passInt) * s.passInt +
    n(row.rushYds) * s.rushYds +
    n(row.rushTD) * s.rushTD +
    n(row.recYds) * s.recYds +
    n(row.recTD) * s.recTD +
    n(row.rec) * s.rec +
    n(row.fumbles) * s.fumbles;
  return Math.round(pts * 10) / 10;
}

/** Try multiple IDs so stats can match players regardless of provider */
function firstStatRowForPlayer(p, statsMap) {
  if (!p || !statsMap) return null;
  const candidates = [
    p?.id,
    p?.sleeperId,
    p?.player_id,
    p?.externalId,
    p?.pid,
  ]
    .map((x) => (x == null ? null : String(x)))
    .filter(Boolean);

  for (const k of candidates) {
    if (statsMap.has(k)) return statsMap.get(k);
  }
  // last chance: exact roster id (if caller already has it)
  return null;
}

export default function MyTeam({ leagueId, username, currentWeek = 1 }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const week = Number(currentWeek || 1);

  // Live league + team
  useEffect(() => {
    if (!leagueId) return;
    const unsubLeague = listenLeague(leagueId, (L) => setLeague(L));
    const unsubTeam = listenTeam({ leagueId, username, onChange: setTeam });
    return () => {
      unsubLeague && unsubLeague();
      unsubTeam && unsubTeam();
    };
  }, [leagueId, username]);

  // Load players
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (live) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId]);

  // Load weekly stats from API → Map(playerIdVariant -> {…stats…, points?})
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const map = await fetchWeekStats({ leagueId, week });
        // `fetchWeekStats` in storage.js may return either:
        //  - Map(id -> {points, ...})
        //  - Map(id -> {raw stats w/o points})
        // If points missing, compute them here.
        if (map && map.forEach) {
          const out = new Map();
          map.forEach((row, k) => {
            const pts = row && row.points != null ? Number(row.points) || 0 : computePointsFromRow(row);
            out.set(String(k), { ...row, points: pts });
          });
          if (live) setStatsMap(out);
        } else if (live) {
          setStatsMap(new Map());
        }
      } catch (e) {
        console.error("fetchWeekStats:", e);
        if (live) setStatsMap(new Map());
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId, week]);

  // Totals (uses actual if present, else projection)
  const points = useMemo(() => {
    if (!team) return { lines: [], total: 0 };
    // computeTeamPoints uses statsMap.get(playerId).points — we’ll make sure
    // each row in statsMap now has a .points from the effect above.
    return computeTeamPoints({
      roster: team?.roster || {},
      week,
      playersMap,
      statsMap,
    });
  }, [team, playersMap, statsMap, week]);

  // Payment state
  const entryRequired = useMemo(() => !leagueIsFree(league), [league]);
  const alreadyPaid = useMemo(() => hasPaidEntry(league, username), [league, username]);
  const amountPi = Number(league?.entry?.amountPi || 0);
  const payUrl =
    typeof paymentCheckoutUrl === "function"
      ? paymentCheckoutUrl({ leagueId, username })
      : `/payments?league=${encodeURIComponent(leagueId)}&user=${encodeURIComponent(username)}`;

  // Actions
  async function handleMoveToStarter(pid, slot) {
    setActing(true);
    try {
      await moveToStarter({ leagueId, username, playerId: pid, slot });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleMoveToBench(slot) {
    setActing(true);
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleRelease(pid) {
    if (!window.confirm("Release this player from your team?")) return;
    setActing(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId: pid });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  if (loading || !league || !team) {
    return <div>Loading your team…</div>;
  }

  const draftStatus = league?.draft?.status || "scheduled";
  const draftDone = draftStatus === "done";
  const benchIds = Array.isArray(team?.bench) ? team.bench : [];
  const roster = team?.roster || {};
  const showPaymentCTA = entryRequired && !alreadyPaid;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{team?.name || username}</h3>
        <div style={{ color: "#666" }}>
          Week {week} Team Total: <b>{points.total.toFixed(1)}</b>
        </div>
      </div>

      {/* Payment CTA */}
      {showPaymentCTA && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            border: "1px dashed #e6b800",
            background: "#fffbe6",
            borderRadius: 8,
          }}
        >
          <b>Entry Fee:</b> {amountPi.toFixed(2)} Pi
          <div style={{ marginTop: 8 }}>
            <a href={payUrl} style={{ textDecoration: "none" }}>
              <button>Pay Entry Fee</button>
            </a>
          </div>
          <div style={{ color: "#666", marginTop: 6 }}>
            After payment, your provider webhook (or admin action) should record it in{" "}
            <code>league.entry.paid[username]</code>; this banner will disappear automatically.
          </div>
        </div>
      )}

      {/* Draft status */}
      <div style={{ color: "#666", marginBottom: 12 }}>
        Draft status: <b>{draftStatus}</b>
        {league?.draft?.scheduledAt ? (
          <> &middot; Scheduled for {new Date(league.draft.scheduledAt).toLocaleString()}</>
        ) : null}
      </div>

      {/* Starters */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Starters</h4>
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 70 }}>Slot</th>
              <th>Player</th>
              <th style={{ width: 70 }}>Opp</th>
              <th style={{ width: 88, textAlign: "right" }}>Proj</th>
              <th style={{ width: 88, textAlign: "right" }}>Actual</th>
              <th style={{ width: 88, textAlign: "right" }}>Used</th>
              <th style={{ width: 240 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => {
              const pid = roster[slot] || null;
              const p = pid ? playersMap.get(String(pid)) : null;

              const opp = p ? opponentForWeek(p, week) : "";
              const proj = p ? Number(projForWeek(p, week) || 0) : 0;

              const srow = p ? firstStatRowForPlayer(p, statsMap) : null;
              const actual = srow ? Number((srow.points != null ? srow.points : computePointsFromRow(srow)) || 0) : 0;

              const used = actual || proj || 0;

              return (
                <tr key={slot} style={{ borderBottom: "1px solid #f6f6f6" }}>
                  <td><b>{slot}</b></td>
                  <td>{p ? playerDisplay(p) : <span style={{ color: "#999" }}>(empty)</span>}</td>
                  <td>{opp || "—"}</td>
                  <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{actual ? actual.toFixed(1) : "—"}</td>
                  <td style={{ textAlign: "right" }}><b>{used.toFixed(1)}</b></td>
                  <td>
                    {p ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button disabled={acting} onClick={() => handleMoveToBench(slot)}>
                          Move to Bench
                        </button>
                        <button disabled={acting} onClick={() => handleRelease(pid)}>
                          Release
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bench */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Bench</h4>
        {benchIds.length === 0 ? (
          <div style={{ color: "#999" }}>No one on the bench.</div>
        ) : (
          <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Player</th>
                <th style={{ width: 70 }}>Opp</th>
                <th style={{ width: 88, textAlign: "right" }}>Proj</th>
                <th style={{ width: 88, textAlign: "right" }}>Actual</th>
                <th style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {benchIds.map((pid) => {
                const p = playersMap.get(String(pid));
                if (!p) {
                  return (
                    <tr key={pid}>
                      <td colSpan={5} style={{ color: "crimson" }}>
                        Unknown player id on bench: {String(pid)}
                      </td>
                    </tr>
                  );
                }
                const allowed = allowedSlotsForPlayer(p);
                const opp = opponentForWeek(p, week) || "—";
                const proj = Number(projForWeek(p, week) || 0);
                const srow = firstStatRowForPlayer(p, statsMap);
                const actual = srow ? Number((srow.points != null ? srow.points : computePointsFromRow(srow)) || 0) : 0;

                return (
                  <tr key={pid} style={{ borderBottom: "1px solid #f6f6f6" }}>
                    <td>{playerDisplay(p)}</td>
                    <td>{opp}</td>
                    <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{actual ? actual.toFixed(1) : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {allowed.map((slot) => (
                          <button
                            key={slot}
                            disabled={acting}
                            onClick={() => handleMoveToStarter(pid, slot)}
                          >
                            Start at {slot}
                          </button>
                        ))}
                        <button disabled={acting} onClick={() => handleRelease(pid)}>
                          Release
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* After-draft reminder for payments still due */}
      {draftDone && showPaymentCTA && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            border: "1px dashed #e6b800",
            background: "#fffbe6",
          }}
        >
          The draft is complete—please complete your entry payment to keep your team eligible.
        </div>
      )}
    </div>
  );
}
