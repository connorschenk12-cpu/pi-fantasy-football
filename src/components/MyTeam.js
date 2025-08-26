/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  listPlayersMap,
  fetchWeekStats,
  opponentForWeek,
  projForWeek,
  pointsForPlayer,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  allowedSlotsForPlayer,
  hasPaidEntry,
  leagueIsFree,
  ROSTER_SLOTS,
  asId,
} from "../lib/storage";

export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // Subscribe to league + my team
  useEffect(() => {
    if (!leagueId || !username) return;
    const un1 = listenLeague(leagueId, (L) => setLeague(L));
    const un2 = listenTeam({ leagueId, username, onChange: (T) => setTeam(T) });
    return () => {
      if (un1) un1();
      if (un2) un2();
    };
  }, [leagueId, username]);

  // Load players + week stats
  const currentWeek = useMemo(
    () => Number(league?.settings?.currentWeek || 1),
    [league]
  );

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (!cancelled) setPlayersMap(map);
      } catch (e) {
        console.warn("listPlayersMap failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !currentWeek) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchWeekStats({ leagueId, week: currentWeek });
        if (!cancelled) setStatsMap(m);
      } catch (e) {
        console.warn("fetchWeekStats:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, currentWeek]);

  const entryRequired = useMemo(() => !leagueIsFree(league), [league]);
  const alreadyPaid = useMemo(() => hasPaidEntry(league, username), [league, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  function playerById(id) {
    const key = asId(id);
    return key ? playersMap.get(key) : null;
  }

  async function handleMoveToStarter(pid, slot) {
    if (!pid || !slot) return;
    setActing(true);
    try {
      await moveToStarter({ leagueId, username, playerId: pid, slot });
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleBenchSlot(slot) {
    setActing(true);
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  async function handleDrop(pid) {
    if (!pid) return;
    if (!window.confirm("Drop this player from your team?")) return;
    setActing(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId: pid });
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setActing(false);
    }
  }

  function StarterRow({ slot }) {
    const pid = roster[slot] || null;
    const P = playerById(pid);
    const name = P?.name || "(empty)";
    const pos = (P?.position || "").toUpperCase();
    const opp = P ? opponentForWeek(P, currentWeek) : "";
    const proj = P ? projForWeek(P, currentWeek) : 0;
    const pts = P ? pointsForPlayer(P, currentWeek, statsMap) : 0;

    return (
      <tr>
        <td style={{ fontWeight: 600 }}>{slot}</td>
        <td>{name}</td>
        <td>{pos}</td>
        <td>{opp}</td>
        <td>{proj ? proj.toFixed(1) : "—"}</td>
        <td>{pts ? pts.toFixed(1) : "—"}</td>
        <td style={{ whiteSpace: "nowrap" }}>
          {pid ? (
            <>
              <button disabled={acting} onClick={() => handleBenchSlot(slot)}>Bench</button>{" "}
              <button disabled={acting} onClick={() => handleDrop(pid)}>Drop</button>
            </>
          ) : (
            <span style={{ color: "#888" }}>—</span>
          )}
        </td>
      </tr>
    );
  }

  function BenchRow({ pid }) {
    const P = playerById(pid);
    const name = P?.name || "(unknown)";
    const pos = (P?.position || "").toUpperCase();
    const validSlots = allowedSlotsForPlayer(P);

    return (
      <tr>
        <td>Bench</td>
        <td>{name}</td>
        <td>{pos}</td>
        <td colSpan={2}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {validSlots.map((s) => (
              <button
                key={s}
                disabled={acting}
                onClick={() => handleMoveToStarter(pid, s)}
                title={`Start at ${s}`}
              >
                Start at {s}
              </button>
            ))}
          </div>
        </td>
        <td>—</td>
        <td>
          <button disabled={acting} onClick={() => handleDrop(pid)}>Drop</button>
        </td>
      </tr>
    );
  }

  if (!league || !team) {
    return <div>Loading your team…</div>;
  }

  // Payment CTA (only if required & not already paid)
  const showPayCTA = entryRequired && !alreadyPaid;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3>My Team</h3>
        <div style={{ color: "#666" }}>
          Week {currentWeek}
        </div>
      </div>

      {showPayCTA && (
        <div
          style={{
            padding: 12,
            border: "1px solid #f0c36d",
            background: "#fff8e1",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <b>Entry fee required:</b>{" "}
            {Number(league?.entry?.amountPi || 0)} Pi
          </div>
          <button
            onClick={() => {
              // Forward to your actual Payments page/flow
              window.location.href = `/payments?leagueId=${encodeURIComponent(leagueId)}`;
            }}
          >
            Go to Payments
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th>Slot</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Opp</th>
              <th>Proj</th>
              <th>Pts</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ROSTER_SLOTS.map((slot) => (
              <StarterRow key={slot} slot={slot} />
            ))}
            {bench.length > 0 && (
              <tr>
                <td colSpan={7} style={{ paddingTop: 10, color: "#666" }}>
                  Bench
                </td>
              </tr>
            )}
            {bench.map((pid) => (
              <BenchRow key={asId(pid)} pid={pid} />
            ))}
          </tbody>
        </table>
      </div>

      {loading && <div style={{ marginTop: 8, color: "#777" }}>Loading stats…</div>}
    </div>
  );
}
