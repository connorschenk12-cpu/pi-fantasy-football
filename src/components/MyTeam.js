/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  listPlayersMap,
  playerDisplay,
  computeTeamPoints,
  fetchWeekStats,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  allowedSlotsForPlayer,
  ROSTER_SLOTS,
  hasPaidEntry,
  leagueIsFree,
  payEntry,
} from "../lib/storage.js";

/**
 * Build a map of -> { rosterId } => { points, raw }
 * We normalize stats that may be keyed by alternate ids (Sleeper, ESPN, Yahoo, GSIS, etc.)
 * to the roster's canonical player id (player.id).
 */
function normalizeStatsToRosterIds(statsObj, playersMap) {
  const out = new Map();
  if (!statsObj || !(playersMap instanceof Map)) return out;

  // Build a quick helper to coerce to trimmed string
  const asId = (x) => (x == null ? null : String(x).trim());

  // Pull raw keys in the server response once (so lookups are O(1))
  const rawKeys = new Set(Object.keys(statsObj || {}).map((k) => String(k)));

  // For every player we know about, try to find a matching key in stats by any known alt id
  for (const p of playersMap.values()) {
    const possibles = [
      p?.id,
      p?.playerId,
      p?.player_id,
      p?.pid,
      p?.sleeperId,
      p?.sleeper_id,
      p?.espnId,
      p?.yahooId,
      p?.gsisId,
      p?.externalId,
    ]
      .map(asId)
      .filter(Boolean);

    // Also try numeric string variants (e.g., "12345")
    const withNums = new Set(possibles);
    for (const k of possibles) {
      const n = Number(k);
      if (Number.isFinite(n)) withNums.add(String(n));
    }
    // Try to find the first alt id that exists in the stats blob
    let matchedKey = null;
    for (const k of withNums) {
      if (rawKeys.has(k)) {
        matchedKey = k;
        break;
      }
    }
    if (!matchedKey) continue;

    const row = statsObj[matchedKey];
    if (!row) continue;

    // We expect /api/stats/week to already provide a fantasy total in the storage.js wrapper,
    // but if you changed that, keep raw here. We'll trust storage.fetchWeekStats for points.
    // Here we only store raw (if needed), but MyTeam passes in the already-processed Map.
    // This function is for a "raw stats" object. We'll keep for safety if the caller uses it.
    // (Used below only if we fetch raw and compute here; for now we convert Map->Map as identity.)
  }

  // This function is used only if we fetched raw JSON here.
  // In our current flow, fetchWeekStats already returns a Map keyed by *its* ids.
  // We'll never reach here unless someone wires differently.
  return out;
}

export default function MyTeam({ leagueId, username, currentWeek = 1 }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [statsMap, setStatsMap] = useState(new Map()); // Map<rosterId || altId, { points, raw }>
  const [errMsg, setErrMsg] = useState("");

  // subscribe league + my team
  useEffect(() => {
    if (!leagueId) return;
    const unsubLeague = listenLeague(leagueId, (L) => setLeague(L));
    const unsubTeam = listenTeam({ leagueId, username, onChange: setTeam });
    return () => {
      unsubLeague && unsubLeague();
      unsubTeam && unsubTeam();
    };
  }, [leagueId, username]);

  // load players map
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const map = await listPlayersMap({ leagueId });
        if (live) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap:", e);
        if (live) setErrMsg(e?.message || String(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [leagueId]);

  // fetch week stats and normalize to our roster ids when possible
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await fetchWeekStats({ leagueId, week: Number(currentWeek || 1) });
        if (!live) return;

        // We want a Map keyed by our roster *player.id* if we can map it,
        // otherwise fall back to whatever keys fetchWeekStats gave us.
        // Build a translation from any alt-id to roster id where possible.
        const translated = new Map();

        // Pre-index known players by all alt ids -> canonical roster id
        const altToRoster = new Map();
        for (const p of playersMap.values()) {
          const ids = [
            p?.id,
            p?.playerId,
            p?.player_id,
            p?.pid,
            p?.sleeperId,
            p?.sleeper_id,
            p?.espnId,
            p?.yahooId,
            p?.gsisId,
            p?.externalId,
          ]
            .map((x) => (x == null ? null : String(x).trim()))
            .filter(Boolean);

          for (const k of ids) {
            altToRoster.set(k, String(p.id));
            const n = Number(k);
            if (Number.isFinite(n)) altToRoster.set(String(n), String(p.id));
          }
        }

        // Translate keys from the stats map
        for (const [k, v] of m.entries()) {
          const key = String(k);
          const rosterId = altToRoster.get(key) || key; // fall back if unknown
          // If multiple alt keys map to same roster id, keep the first non-zero points
          if (!translated.has(rosterId) || (v?.points ?? 0) > ((translated.get(rosterId)?.points) ?? 0)) {
            translated.set(rosterId, v);
          }
        }
        setStatsMap(translated);
      } catch (e) {
        console.error("fetchWeekStats:", e);
        if (live) setStatsMap(new Map());
      }
    })();

    return () => {
      live = false;
    };
  }, [leagueId, playersMap, currentWeek]);

  const week = Number(currentWeek || 1);

  // compute points using (actual || projected)
  const points = useMemo(() => {
    if (!team) return { lines: [], total: 0 };
    return computeTeamPoints({
      roster: team?.roster || {},
      week,
      playersMap,
      statsMap, // actuals now wired
    });
  }, [team, playersMap, statsMap, week]);

  const entryRequired = useMemo(() => !leagueIsFree(league), [league]);
  const alreadyPaid = useMemo(() => hasPaidEntry(league, username), [league, username]);

  const draftStatus = league?.draft?.status || "scheduled";

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

  async function handlePayNowDev() {
    // Dev toggle that marks you paid in Firestore, hides banner
    setActing(true);
    try {
      await payEntry({ leagueId, username });
      alert("Marked as paid (dev). Replace with your real Pi flow later.");
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

  const benchIds = Array.isArray(team?.bench) ? team.bench : [];
  const roster = team?.roster || {};

  // Payment CTA (now actionable)
  const showPaymentCTA = entryRequired && !alreadyPaid;
  const amountPi = Number(league?.entry?.amountPi || 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{team?.name || username}</h3>
        <div style={{ color: "#666" }}>
          Week {week} Total: <b>{points.total.toFixed(1)}</b>
        </div>
      </div>

      {errMsg ? (
        <div style={{ color: "crimson", marginTop: 6 }}>{errMsg}</div>
      ) : null}

      {/* Entry Payment CTA */}
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
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Replace this DEV button with your real Pi payment flow */}
            <button disabled={acting} onClick={handlePayNowDev}>Pay Entry Now (dev)</button>
          </div>
          <div style={{ color: "#666", marginTop: 6 }}>
            This dev button just marks you paid in Firestore. Wire your actual Pi payment flow later;
            once a webhook records payment, this banner disappears automatically.
          </div>
        </div>
      )}

      {/* Draft status banner */}
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
              <th style={{ width: 240, textAlign: "right" }}>Actual · Proj · Used</th>
              <th style={{ width: 260 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => {
              const pid = roster[slot] || null;
              const p = pid ? playersMap.get(String(pid)) : null;

              // Pull the actual and projected points for this player
              const statRow = pid ? statsMap.get(String(pid)) : null;
              const actual = Number(statRow?.points || 0);
              const projected = p ? Number(p?.projections?.[String(week)] ?? p?.projections?.[week] ?? 0) : 0;
              const used = actual || projected || 0;

              return (
                <tr key={slot} style={{ borderBottom: "1px solid #f6f6f6" }}>
                  <td><b>{slot}</b></td>
                  <td>{p ? playerDisplay(p) : <span style={{ color: "#999" }}>(empty)</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {actual.toFixed(1)} · {projected.toFixed(1)} · <b>{used.toFixed(1)}</b>
                  </td>
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
                <th>Allowed Slots</th>
                <th style={{ width: 320 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {benchIds.map((pid) => {
                const p = playersMap.get(String(pid));
                if (!p) {
                  return (
                    <tr key={pid}>
                      <td colSpan={3} style={{ color: "crimson" }}>
                        Unknown player id on bench: {String(pid)}
                      </td>
                    </tr>
                  );
                }
                const allowed = allowedSlotsForPlayer(p);
                const statRow = statsMap.get(String(pid));
                const actual = Number(statRow?.points || 0);
                const projected = Number(p?.projections?.[String(week)] ?? p?.projections?.[week] ?? 0);

                return (
                  <tr key={pid} style={{ borderBottom: "1px solid #f6f6f6" }}>
                    <td>
                      {playerDisplay(p)}
                      <div style={{ color: "#777", fontSize: 12 }}>
                        Actual {actual.toFixed(1)} · Proj {projected.toFixed(1)}
                      </div>
                    </td>
                    <td>
                      {allowed.length ? allowed.join(", ") : <span style={{ color: "#999" }}>—</span>}
                    </td>
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
                        <button disabled={acting} onClick={() => handleRelease(pid)}>Release</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Helpful hints */}
      <div style={{ color: "#777", marginTop: 12 }}>
        • You can only place players in legal positions (QB/RB/WR/TE/FLEX/K/DEF).<br />
        • If a starter slot is filled, “Move to Bench” swaps roster spots safely.<br />
        • Actual points come from <code>/api/stats/week</code>; if you see 0.0 actuals, your roster IDs might not map to that provider’s IDs yet.
      </div>
    </div>
  );
}
