/* eslint-disable no-console */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  ROSTER_SLOTS,
} from "../lib/storage";

import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import MatchupsTab from "./MatchupsTab";
import LeagueTab from "./LeagueTab";
import PlayerName from "./common/PlayerName";

/**
 * Props:
 * - leagueId (string)
 * - username (string)
 * - onBack() (function)
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // "team" | "players" | "draft" | "matchups" | "league" | "admin"

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // Listen to league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure team exists then listen to it
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

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // Move bench -> slot
  const handleBenchToSlot = async (playerId, slot) => {
    if (!slot) return;
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter error:", e);
      alert(String(e?.message || e));
    }
  };

  // Move slot -> bench
  const handleSlotToBench = async (slot) => {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      console.error("moveToBench error:", e);
      alert(String(e?.message || e));
    }
  };

  // Hide the Draft tab if the draft is finished
  const showDraftTab = (league?.draft?.status || "scheduled") !== "done";

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2 style={{ margin: "8px 0" }}>{league?.name || leagueId}</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        {showDraftTab && (
          <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        )}
        <TabButton
          label="Matchups"
          active={tab === "matchups"}
          onClick={() => setTab("matchups")}
        />
        <TabButton label="League" active={tab === "league"} onClick={() => setTab("league")} />
        {isOwner && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {/* My Team */}
      {tab === "team" && (
        <div>
          <h3 style={{ marginTop: 0 }}>Starters (Week {currentWeek})</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {ROSTER_SLOTS.map((s) => (
              <li key={s} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ width: 40 }}>{s}</b>
                  <span>
                    {roster[s] ? (
                      <PlayerName leagueId={leagueId} playerId={roster[s]} />
                    ) : (
                      "(empty)"
                    )}
                  </span>
                  {roster[s] && (
                    <button onClick={() => handleSlotToBench(s)} style={{ marginLeft: 8 }}>
                      Send to Bench
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <h3 style={{ marginTop: 16 }}>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {bench.map((pid) => (
              <li key={pid} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span><PlayerName leagueId={leagueId} playerId={pid} /></span>
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
            ))}
            {bench.length === 0 && <li>(no bench players)</li>}
          </ul>
        </div>
      )}

      {/* Players */}
      {tab === "players" && (
        <PlayersList
          leagueId={leagueId}
          league={league}
          username={username}
          currentWeek={currentWeek}
        />
      )}

      {/* Draft */}
      {tab === "draft" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {/* Matchups */}
      {tab === "matchups" && (
        <MatchupsTab leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* League (other rosters + full schedule) */}
      {tab === "league" && (
        <LeagueTab leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* Admin (owner only) */}
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
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
