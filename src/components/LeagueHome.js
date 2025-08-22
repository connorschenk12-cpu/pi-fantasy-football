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
  opponentForWeek,
  computeTeamPoints,
  listTeams,
  listenScheduleWeek,
} from "../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";

/**
 * Props:
 * - leagueId
 * - username
 * - onBack()
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // team | players | draft | league | matchups | admin
  const [playersMap, setPlayersMap] = useState(new Map());
  const [allTeams, setAllTeams] = useState([]);
  const [weekSchedule, setWeekSchedule] = useState({ week: 1, matchups: [] });

  const currentWeek = Number(league?.settings?.currentWeek || 1);
  const draftDone = league?.draft?.status === "done";

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

  // Load players map (names, projections, opponents)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const map = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Load league teams (for "League" tab)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const teams = await listTeams(leagueId);
        if (mounted) setAllTeams(teams);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // Listen to schedule for current week (for "Matchups" tab)
  useEffect(() => {
    if (!leagueId || !currentWeek) return;
    const unsub = listenScheduleWeek(leagueId, currentWeek, (data) => {
      setWeekSchedule(data || { week: currentWeek, matchups: [] });
    });
    return () => unsub && unsub();
  }, [leagueId, currentWeek]);

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

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

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2>{league?.name || leagueId}</h2>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        {!draftDone && (
          <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        )}
        <TabButton label="League" active={tab === "league"} onClick={() => setTab("league")} />
        <TabButton label="Matchups" active={tab === "matchups"} onClick={() => setTab("matchups")} />
        {isOwner && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {/* My Team */}
      {tab === "team" && (
        <div>
          <h3>Starters — Week {currentWeek}</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s];
              const p = pid ? playersMap.get(pid) : null;
              const opp = p ? opponentForWeek(p, currentWeek) : "";
              return (
                <li key={s} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ width: 40 }}>{s}</b>
                    <span>
                      {p ? `${playerDisplay(p)} ${opp ? `(${opp})` : ""}` : "(empty)"}{" "}
                    </span>
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

          <h3>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map((pid) => {
              const p = playersMap.get(pid);
              return (
                <li key={pid} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{p ? playerDisplay(p) : pid}</span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const slot = e.target.value;
                        if (slot) handleBenchToSlot(pid, slot);
                      }}
                    >
                      <option value="">Move to slot…</option>
                      {ROSTER_SLOTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
            {bench.length === 0 && <li>(no bench players)</li>}
          </ul>

          {/* Team total preview */}
          <TeamTotalPreview
            title={`Projected Total (Week ${currentWeek})`}
            roster={roster}
            playersMap={playersMap}
            week={currentWeek}
          />
        </div>
      )}

      {/* Players */}
      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* Draft */}
      {tab === "draft" && !draftDone && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {/* League (other teams) */}
      {tab === "league" && (
        <div>
          <h3>Teams in League</h3>
          {allTeams.length === 0 && <p>(no other teams yet)</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {allTeams.map((t) => {
              const wins = Number(t?.wins || 0);
              const losses = Number(t?.losses || 0);
              const teamName = t?.name || t?.id;
              // quick projected total
              const { total } = computeTeamPoints({
                roster: t?.roster || {},
                week: currentWeek,
                playersMap,
              });
              return (
                <li key={t.id} style={{ marginBottom: 10, borderBottom: "1px solid #eee", paddingBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <b>{teamName}</b> — <span>{wins}-{losses}</span>
                    </div>
                    <div>Proj: {total}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Matchups */}
      {tab === "matchups" && (
        <MatchupsView
          leagueId={leagueId}
          week={currentWeek}
          schedule={weekSchedule}
          playersMap={playersMap}
        />
      )}

      {/* Admin */}
      {tab === "admin" && isOwner && (
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

/** Small helper to show a team's projected total */
function TeamTotalPreview({ title, roster, week, playersMap }) {
  const { total } = computeTeamPoints({ roster, week, playersMap });
  return (
    <div style={{ padding: "8px 0" }}>
      <b>{title}:</b> {total}
    </div>
  );
}

/** Matchups view for the current week */
function MatchupsView({ leagueId, week, schedule, playersMap }) {
  const matchups = Array.isArray(schedule?.matchups) ? schedule.matchups : [];

  if (!matchups.length) {
    return <p>No matchups scheduled for week {week}.</p>;
  }

  return (
    <div>
      <h3>Week {week} Matchups</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {matchups.map((m, idx) => (
          <MatchupRow
            key={`${m.home}_vs_${m.away}_${idx}`}
            leagueId={leagueId}
            home={m.home}
            away={m.away}
            week={week}
            playersMap={playersMap}
          />
        ))}
      </ul>
    </div>
  );
}

/** Single matchup line: shows both teams + projected totals */
function MatchupRow({ leagueId, home, away, week, playersMap }) {
  const [homeTeam, setHomeTeam] = useState(null);
  const [awayTeam, setAwayTeam] = useState(null);

  useEffect(() => {
    const unsubHome = listenTeam({ leagueId, username: home, onChange: setHomeTeam });
    const unsubAway = listenTeam({ leagueId, username: away, onChange: setAwayTeam });
    return () => {
      unsubHome && unsubHome();
      unsubAway && unsubAway();
    };
  }, [leagueId, home, away]);

  const homePts = computeTeamPoints({
    roster: homeTeam?.roster || {},
    week,
    playersMap,
  }).total;

  const awayPts = computeTeamPoints({
    roster: awayTeam?.roster || {},
    week,
    playersMap,
  }).total;

  return (
    <li style={{ marginBottom: 10, borderBottom: "1px solid #eee", paddingBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <b>{homeTeam?.name || home}</b>
          <div>Proj: {homePts}</div>
        </div>
        <div style={{ alignSelf: "center" }}>vs</div>
        <div style={{ flex: 1, textAlign: "right" }}>
          <b>{awayTeam?.name || away}</b>
          <div>Proj: {awayPts}</div>
        </div>
      </div>
    </li>
  );
}
