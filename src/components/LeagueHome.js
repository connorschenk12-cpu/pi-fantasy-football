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
} from "../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import LeagueTab from "./LeagueTab"; // shows teams + full season schedule

/**
 * Props:
 * - leagueId (string)
 * - username (string)
 * - onBack() (function)
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // "team" | "players" | "draft" | "league" | "admin"
  const [playersMap, setPlayersMap] = useState(new Map());

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // Load league + players map
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    (async () => {
      try {
        setPlayersMap(await listPlayersMap({ leagueId }));
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure my team exists and listen to it
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

  const isOwner = useMemo(() => league?.owner === username, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  async function handleBenchToSlot(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter error:", e);
      alert(String(e?.message || e));
    }
  }
  async function handleSlotToBench(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench error:", e);
      alert(String(e?.message || e));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2>{league?.name || leagueId}</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        {league?.draft?.status !== "done" && (
          <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        )}
        <TabButton label="League" active={tab === "league"} onClick={() => setTab("league")} />
        {isOwner && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {/* My Team */}
      {tab === "team" && (
        <div>
          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s] || null;
              const p = pid ? playersMap.get(pid) : null;
              return (
                <li key={s} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ width: 40 }}>{s}</b>
                    <span>{p ? playerDisplay(p) : "(empty)"}</span>
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
        </div>
      )}

      {/* Players */}
      {tab === "players" && <PlayersList leagueId={leagueId} currentWeek={currentWeek} />}

      {/* Draft (hidden once status === "done") */}
      {tab === "draft" && league?.draft?.status !== "done" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {/* League overview + full schedule */}
      {tab === "league" && <LeagueTab leagueId={leagueId} />}

      {/* Admin (owner only) */}
      {tab === "admin" && isOwner && <LeagueAdmin leagueId={leagueId} username={username} />}
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
