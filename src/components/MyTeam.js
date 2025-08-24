/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  ROSTER_SLOTS,
  listPlayersMap,
  playerDisplay,
  projForWeek,
  computeTeamPoints,
} from "../lib/storage";
import EntryFeePanel from "./EntryFeePanel";
import PlayerName from "./common/PlayerName";

/**
 * Props:
 * - leagueId
 * - username
 */
export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [busy, setBusy] = useState(false);

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // League
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure + listen team
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        if (!leagueId || !username) return;
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Load players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(m || new Map());
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const totals = useMemo(() => {
    return computeTeamPoints({ roster, week: currentWeek, playersMap });
  }, [roster, playersMap, currentWeek]);

  const handleBenchToSlot = async (playerId, slot) => {
    try {
      setBusy(true);
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const handleSlotToBench = async (slot) => {
    try {
      setBusy(true);
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!leagueId || !username) {
    return <div style={{ color: "crimson" }}>Missing league or username.</div>;
  }
  if (!league || !team) {
    return <div>Loading your team…</div>;
  }

  return (
    <div>
      {/* Show entry fee panel if enabled and user not paid */}
      {league?.entry?.enabled && !league?.entry?.paid?.[username] && (
        <div style={{ marginBottom: 12 }}>
          <EntryFeePanel leagueId={leagueId} username={username} isOwner={false} />
        </div>
      )}

      <h3>Starters (Week {currentWeek})</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ width: 60 }}>Slot</th>
            <th>Name</th>
            <th style={{ width: 70 }}>Pos</th>
            <th style={{ width: 70 }}>Team</th>
            <th style={{ width: 100, textAlign: "right" }}>Proj</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {ROSTER_SLOTS.map((slot) => {
            const pid = roster?.[slot] || null;
            const p = pid ? playersMap.get(pid) : null;
            const proj = p ? projForWeek(p, currentWeek) : 0;
            return (
              <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td><b>{slot}</b></td>
                <td>
                  {p ? (
                    <PlayerName player={p} fallbackId={pid} />
                  ) : (
                    <span style={{ color: "#888" }}>(empty)</span>
                  )}
                </td>
                <td>{p?.position || "-"}</td>
                <td>{p?.team || "-"}</td>
                <td style={{ textAlign: "right" }}>{proj.toFixed(1)}</td>
                <td>
                  {pid && (
                    <button disabled={busy} onClick={() => handleSlotToBench(slot)}>
                      Send to Bench
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1px solid #ddd", fontWeight: 700 }}>
            <td colSpan={4}>Total</td>
            <td style={{ textAlign: "right" }}>{totals.total.toFixed(1)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <h3>Bench</h3>
      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Name</th>
            <th style={{ width: 70 }}>Pos</th>
            <th style={{ width: 70 }}>Team</th>
            <th style={{ width: 180 }}>Move to slot…</th>
          </tr>
        </thead>
        <tbody>
          {bench.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#888" }}>
                (no bench players)
              </td>
            </tr>
          )}
          {bench.map((pid) => {
            const p = playersMap.get(pid);
            return (
              <tr key={pid} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td>{p ? <PlayerName player={p} fallbackId={pid} /> : pid}</td>
                <td>{p?.position || "-"}</td>
                <td>{p?.team || "-"}</td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const slot = e.target.value;
                      if (slot) handleBenchToSlot(pid, slot);
                    }}
                  >
                    <option value="">Choose slot…</option>
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
        </tbody>
      </table>
    </div>
  );
}
