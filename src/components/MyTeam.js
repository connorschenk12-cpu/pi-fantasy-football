/* eslint-disable no-console */
// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ROSTER_SLOTS,
  emptyRoster,
  listenLeague,
  listenTeam,
  listPlayersMap,
  headshotUrlFor,
  asId,
  allowedSlotsForPlayer,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  fetchWeekStats,
  computeTeamPoints,
  projForWeek,
  opponentForWeek,
} from "../lib/storage.js";

export default function MyTeam({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState({ roster: emptyRoster(), bench: [] });
  const [playersMap, setPlayersMap] = useState(new Map());
  const [statsMap, setStatsMap] = useState(new Map());
  const [saving, setSaving] = useState(false);
  const [week, setWeek] = useState(1);

  // load league (for currentWeek)
  useEffect(() => {
    if (!leagueId) return;
    return listenLeague(leagueId, (L) => {
      setLeague(L);
      const w = Number(L?.settings?.currentWeek || 1);
      setWeek(w);
    });
  }, [leagueId]);

  // load my team
  useEffect(() => {
    if (!leagueId || !username) return;
    return listenTeam({ leagueId, username, onChange: (T) => setTeam(T || { roster: emptyRoster(), bench: [] }) });
  }, [leagueId, username]);

  // load global players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const map = await listPlayersMap();
        if (mounted) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap failed:", e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // fetch live stats for week (optional; safe if empty)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sm = await fetchWeekStats({ leagueId, week });
        if (mounted) setStatsMap(sm);
      } catch (e) {
        console.warn("fetchWeekStats:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId, week]);

  const roster = team?.roster || emptyRoster();
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const lineup = useMemo(() => {
    return ROSTER_SLOTS.map((slot) => {
      const pid = asId(roster[slot]);
      const p = pid ? playersMap.get(pid) : null;
      const photo = p ? headshotUrlFor(p) : null;
      const projected = p ? projForWeek(p, week) : 0;
      const opp = p ? opponentForWeek(p, week) : "";
      return { slot, pid, p, photo, projected, opp };
    });
  }, [roster, playersMap, week]);

  const benchRows = useMemo(() => {
    return bench.map((pid) => {
      const p = playersMap.get(asId(pid));
      const photo = p ? headshotUrlFor(p) : null;
      const projected = p ? projForWeek(p, week) : 0;
      const opp = p ? opponentForWeek(p, week) : "";
      return { pid: asId(pid), p, photo, projected, opp };
    });
  }, [bench, playersMap, week]);

  const totals = useMemo(() => {
    return computeTeamPoints({ roster, week, playersMap, statsMap });
  }, [roster, week, playersMap, statsMap]);

  async function toStarter(pid, slot) {
    if (!leagueId || !username || !pid || !slot) return;
    setSaving(true);
    try {
      const p = playersMap.get(asId(pid));
      await moveToStarter({ leagueId, username, playerId: pid, slot, playerPosition: p?.position });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toBench(slot) {
    if (!leagueId || !username || !slot) return;
    setSaving(true);
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function release(pid) {
    if (!leagueId || !username || !pid) return;
    if (!confirm("Release this player?")) return;
    setSaving(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId: pid });
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h3 className="m0">My Team</h3>
        <div className="row gap8 ai-center">
          <span className="badge">Week {week}</span>
          <span className="badge">Projected Total: {totals.total}</span>
        </div>
      </div>

      {/* Starters */}
      <div className="card mb12">
        <div className="card-title">Starters</div>
        <div className="list">
          {lineup.map(({ slot, pid, p, photo, projected, opp }) => (
            <div key={slot} className="row ai-center gap12 py8 bb">
              <div style={{ width: 44 }} className="badge">{slot}</div>
              {p ? (
                <>
                  <img
                    src={photo || "/avatar.png"}
                    alt={p.name}
                    width={44}
                    height={44}
                    style={{ borderRadius: 6, objectFit: "cover", background: "#f2f2f2" }}
                  />
                  <div className="col grow">
                    <div className="row gap8 wrap">
                      <b>{p.name}</b>
                      <span className="badge">{p.position}</span>
                      <span className="badge">{p.team}</span>
                      {!!opp && <span className="badge">vs {opp}</span>}
                    </div>
                  </div>
                  <div className="row gap12 ai-center">
                    <div className="muted">Proj: <b>{projected}</b></div>
                    <button
                      className="btn"
                      disabled={saving}
                      onClick={() => toBench(slot)}
                    >
                      Bench
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={saving}
                      onClick={() => release(pid)}
                    >
                      Release
                    </button>
                  </div>
                </>
              ) : (
                <div className="col grow muted">— empty —</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bench */}
      <div className="card">
        <div className="card-title">Bench</div>
        {benchRows.length === 0 ? (
          <div className="muted">No bench players yet.</div>
        ) : (
          <div className="list">
            {benchRows.map(({ pid, p, photo, projected, opp }) => {
              if (!p) return null;
              const legalSlots = allowedSlotsForPlayer(p);
              return (
                <div key={pid} className="row ai-center gap12 py8 bb">
                  <img
                    src={photo || "/avatar.png"}
                    alt={p.name}
                    width={44}
                    height={44}
                    style={{ borderRadius: 6, objectFit: "cover", background: "#f2f2f2" }}
                  />
                  <div className="col grow">
                    <div className="row gap8 wrap">
                      <b>{p.name}</b>
                      <span className="badge">{p.position}</span>
                      <span className="badge">{p.team}</span>
                      {!!opp && <span className="badge">vs {opp}</span>}
                    </div>
                  </div>
                  <div className="row gap8 ai-center">
                    <div className="muted">Proj: <b>{projected}</b></div>
                    <select
                      className="input"
                      disabled={saving}
                      defaultValue=""
                      onChange={(e) => {
                        const slot = e.target.value;
                        if (slot) toStarter(pid, slot);
                      }}
                    >
                      <option value="">Start in…</option>
                      {legalSlots.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-danger"
                      disabled={saving}
                      onClick={() => release(pid)}
                    >
                      Release
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
