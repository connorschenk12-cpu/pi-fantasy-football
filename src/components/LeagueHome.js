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
  listTeams,
} from "../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";

export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [tab, setTab] = useState("team"); // 'team' | 'players' | 'draft' | 'league' | 'admin'
  const [allTeams, setAllTeams] = useState([]);
  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // League
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Players map
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId) return;
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      alive = false;
    };
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

  // Load all teams when 'league' tab is active (or when league changes)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!leagueId || tab !== "league") return;
        const t = await listTeams(leagueId);
        if (alive) setAllTeams(t);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId, tab]);

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

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        <TabButton label="League" active={tab === "league"} onClick={() => setTab("league")} />
        {isOwner && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {/* TEAM TAB */}
      {tab === "team" && (
        <div>
          <h3>Starters — Week {currentWeek}</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s] || null;
              const p = pid ? playersMap.get(pid) : null;
              const name = p ? playerDisplay(p) : "(empty)";
              const opp = p ? opponentForWeek(p, currentWeek) : "";
              return (
                <li key={s} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <b style={{ width: 44 }}>{s}</b>
                    <span style={{ minWidth: 180 }}>{name}</span>
                    <span style={{ color: "#666" }}>{opp ? `• Opp: ${opp}` : ""}</span>
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

          <h3>Bench — Week {currentWeek}</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map((pid) => {
              const p = playersMap.get(pid);
              const name = p ? playerDisplay(p) : pid;
              const opp = p ? opponentForWeek(p, currentWeek) : "";
              return (
                <li key={pid} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ minWidth: 180 }}>{name}</span>
                    <span style={{ color: "#666" }}>{opp ? `• Opp: ${opp}` : ""}</span>
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
        </div>
      )}

      {/* PLAYERS TAB */}
      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* DRAFT TAB */}
      {tab === "draft" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {/* LEAGUE TAB */}
      {tab === "league" && <LeagueTab leagueId={leagueId} teams={allTeams} />}

      {/* ADMIN TAB */}
      {tab === "admin" && isOwner && (
        <LeagueAdmin leagueId={leagueId} username={username} league={league} />
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

/** Simple league overview list */
function LeagueTab({ leagueId, teams }) {
  return (
    <div>
      <h3>League Teams</h3>
      {(!teams || teams.length === 0) && <p>No teams yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {teams.map((t) => {
          const record = t?.record || t?.standings || {};
          const w = record.wins ?? 0;
          const l = record.losses ?? 0;
          const name = t?.name || t?.owner || t?.id;
          return (
            <li key={t.id} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <b style={{ minWidth: 180 }}>{name}</b>
                <span style={{ color: "#666" }}>
                  W-L: {w}-{l}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p style={{ color: "#888", fontSize: 12 }}>
        (Tip: records will update when you add weekly results logic.)
      </p>
    </div>
  );
}
