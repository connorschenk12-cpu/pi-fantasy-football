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
    <div className="container">
      <div className="mb8">
        <button className="btn btn-ghost" onClick={onBack}>
          &larr; Back
        </button>
      </div>

      <div className="header">
        <h2 className="m0">{league?.name || leagueId}</h2>
        <span className="badge">Week {currentWeek}</span>
      </div>

      {/* Tabs */}
      <div className="tabbar">
        <button
          className={`tab ${tab === "team" ? "active" : ""}`}
          onClick={() => setTab("team")}
        >
          My Team
        </button>
        <button
          className={`tab ${tab === "players" ? "active" : ""}`}
          onClick={() => setTab("players")}
        >
          Players
        </button>
        {showDraftTab && (
          <button
            className={`tab ${tab === "draft" ? "active" : ""}`}
            onClick={() => setTab("draft")}
          >
            Draft
          </button>
        )}
        <button
          className={`tab ${tab === "matchups" ? "active" : ""}`}
          onClick={() => setTab("matchups")}
        >
          Matchups
        </button>
        <button
          className={`tab ${tab === "league" ? "active" : ""}`}
          onClick={() => setTab("league")}
        >
          League
        </button>
        {isOwner && (
          <button
            className={`tab ${tab === "admin" ? "active" : ""}`}
            onClick={() => setTab("admin")}
          >
            Admin
          </button>
        )}
      </div>

      {/* My Team */}
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
