/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  listPlayersMap,
  playerDisplay,
  computeTeamPoints,
  ROSTER_SLOTS,
  hasPaidEntry,
  allPaidOrFree,
} from "../lib/storage";

import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import MatchupsTab from "./MatchupsTab";

/**
 * Props:
 * - leagueId
 * - username
 * - onBack()
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [tab, setTab] = useState("team"); // team | players | draft | league | matchups | admin
  const [paidGateOk, setPaidGateOk] = useState(true);

  // League
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure team + listen
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

  // Load players map for name lookups + points
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const m = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(m);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Check payment gate (free league counts as OK)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const ok = await allPaidOrFree(leagueId);
        if (mounted) setPaidGateOk(ok);
      } catch (e) {
        console.error("allPaidOrFree error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId, league?.entry?.enabled, league?.entry?.paid, league?.entry?.amount]);

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const totals = useMemo(() => {
    return computeTeamPoints({ roster, week: currentWeek, playersMap });
  }, [roster, currentWeek, playersMap]);

  const canShowDraftTab = (league?.draft?.status !== "done") && paidGateOk;

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

  // Banner logic
  const paymentsEnabled = !!league?.entry?.enabled;
  const iHavePaid = hasPaidEntry(league, username);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2>{league?.name || leagueId}</h2>

      {/* Payment/Draft gate messaging */}
      {league?.draft?.status !== "done" && (
        <div style={{ margin: "10px 0" }}>
          {paymentsEnabled ? (
            iHavePaid ? (
              paidGateOk ? (
                <small style={{ color: "green" }}>
                  All members have paid. Draft can begin when the owner starts it.
                </small>
              ) : (
                <small style={{ color: "#b35c00" }}>
                  Waiting for all members to pay the entry fee before the draft can start.
                </small>
              )
            ) : (
              <small style={{ color: "crimson" }}>
                You haven’t paid the entry fee yet. Go to <b>Admin</b> → “Pi Payments” to pay.
              </small>
            )
          ) : (
            <small>League is free. Draft can begin when the owner starts it.</small>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <TabButton label="My Team"   active={tab === "team"}     onClick={() => setTab("team")} />
        <TabButton label="Players"   active={tab === "players"}  onClick={() => setTab("players")} />
        {canShowDraftTab && (
          <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        )}
        <TabButton label="League"    active={tab === "league"}   onClick={() => setTab("league")} />
        <TabButton label="Matchups"  active={tab === "matchups"} onClick={() => setTab("matchups")} />
        {/* hide Admin after draft is done */}
        {isOwner && league?.draft?.status !== "done" && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {/* TEAM */}
      {tab === "team" && (
        <div>
          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s];
              const player = pid ? playersMap.get(pid) : null;
              const name = playerDisplay(player);
              const opp = player ? opponentForWeekSafe(player, currentWeek) : "";
              const pts = player ? Math.round((Number(computePts(player, currentWeek)) || 0) * 100) / 100 : 0;
              return (
                <li key={s} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ width: 40 }}>{s}</b>
                    <span style={{ minWidth: 180 }}>
                      {pid ? `${name}` : "(empty)"}
                      {opp ? ` — ${opp}` : ""}
                    </span>
                    <span style={{ minWidth: 90 }}>Proj: {pts.toFixed(1)}</span>
                    {pid && (
                      <button onClick={() => handleSlotToBench(s)} style={{ marginLeft: 8 }}>
                        Send to Bench
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div style={{ marginTop: 6, fontWeight: 600 }}>
            Team projected total (W{currentWeek}): {totals.total.toFixed(1)}
          </div>

          <h3 style={{ marginTop: 18 }}>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map((pid) => {
              const p = playersMap.get(pid);
              const name = playerDisplay(p) || pid;
              const opp = p ? opponentForWeekSafe(p, currentWeek) : "";
              const pts = p ? Math.round((Number(computePts(p, currentWeek)) || 0) * 100) / 100 : 0;
              return (
                <li key={pid} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ minWidth: 180 }}>
                      {name}
                      {opp ? ` — ${opp}` : ""}
                    </span>
                    <span style={{ minWidth: 90 }}>Proj: {pts.toFixed(1)}</span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const slot = e.target.value;
                        if (slot) handleBenchToSlot(pid, slot);
                      }}
                    >
                      <option value="">Move to slot…</option>
                      {ROSTER_SLOTS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
            {bench.length === 0 && <li>(no bench players)</li>}
          </ul>
        </div>
      )}

      {/* PLAYERS */}
      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* DRAFT */}
      {tab === "draft" && canShowDraftTab && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {/* LEAGUE – keep whatever you already had here if you have a LeagueTab component */}
      {tab === "league" && (
        <div>
          <p>Browse teams and the full season schedule in the League tab (if you have a dedicated component, render it here).</p>
          {/* If you already have <LeagueTab /> just swap this for:
              <LeagueTab leagueId={leagueId} currentWeek={currentWeek} />
          */}
        </div>
      )}

      {/* MATCHUPS */}
      {tab === "matchups" && (
        <MatchupsTab leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* ADMIN */}
      {tab === "admin" && isOwner && league?.draft?.status !== "done" && (
        <LeagueAdmin leagueId={leagueId} username={username} />
      )}
    </div>
  );
}

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        border: active ? "2px solid #333" : "1px solid #ccc",
        background: active ? "#f2f2f2" : "#fff",
        fontWeight: active ? 700 : 400,
      }}
    >
      {label}
    </button>
  );
}

// small local helpers using your storage projections/opponent
function computePts(p, week) {
  // reuse projForWeek semantics without importing again
  const w = String(week);
  if (p?.projections && p.projections[w] != null) return Number(p.projections[w]) || 0;
  if (p?.projByWeek && p.projByWeek[w] != null) return Number(p.projByWeek[w]) || 0;
  if (p?.[`projW${w}`] != null) return Number(p[`projW${w}`]) || 0;
  if (p?.proj != null) return Number(p.proj) || 0;
  if (p?.avgPoints != null) return Number(p.avgPoints) || 0;
  if (p?.rank != null) return Math.max(0, 25 - Number(p.rank));
  return 0;
}
function opponentForWeekSafe(p, week) {
  const w = String(week);
  const m = p?.matchups?.[w] ?? p?.matchups?.[week];
  if (m && (m.opp || m.opponent)) return m.opp || m.opponent;
  if (p?.oppByWeek && p.oppByWeek[w] != null) return p.oppByWeek[w];
  if (p?.[`oppW${w}`] != null) return p[`oppW${w}`];
  return "";
}
