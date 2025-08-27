/* eslint-disable no-console */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import { listenLeague } from "../lib/storage";

import MyTeam from "./MyTeam";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import MatchupsTab from "./MatchupsTab";
import LeagueTab from "./LeagueTab";

/**
 * Props:
 * - leagueId (string)
 * - username (string)
 * - onBack() (function)
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [tab, setTab] = useState("team"); // "team" | "players" | "draft" | "matchups" | "league" | "admin"

  // Listen to league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const currentWeek = Number(league?.settings?.currentWeek || 1);
  const showDraftTab = (league?.draft?.status || "scheduled") !== "done";

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2 style={{ margin: "8px 0" }}>{league?.name || leagueId}</h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <TabButton label="My Team"  active={tab === "team"}     onClick={() => setTab("team")} />
        <TabButton label="Players"  active={tab === "players"}  onClick={() => setTab("players")} />
        {showDraftTab && (
          <TabButton label="Draft"   active={tab === "draft"}    onClick={() => setTab("draft")} />
        )}
        <TabButton label="Matchups" active={tab === "matchups"} onClick={() => setTab("matchups")} />
        <TabButton label="League"   active={tab === "league"}   onClick={() => setTab("league")} />
        {isOwner && (
          <TabButton label="Admin"   active={tab === "admin"}    onClick={() => setTab("admin")} />
        )}
      </div>

      {/* My Team — now rendered by the dedicated component */}
      {tab === "team" && (
        <MyTeam leagueId={leagueId} username={username} currentWeek={currentWeek} />
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
      {tab === "matchups" && <MatchupsTab leagueId={leagueId} currentWeek={currentWeek} />}

      {/* League (other rosters + full schedule) */}
      {tab === "league" && <LeagueTab leagueId={leagueId} currentWeek={currentWeek} />}

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
