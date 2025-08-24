// src/components/LeagueHome.js
/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  ROSTER_SLOTS,
  hasPaidEntry,
} from "../lib/storage";

import MyTeam from "./MyTeam";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import MatchupsTab from "./MatchupsTab";
import LeagueTab from "./LeagueTab";
import LeagueAdmin from "./LeagueAdmin";
import EntryFeePanel from "./EntryFeePanel";

/**
 * Props:
 * - leagueId (string)
 * - username (string)
 * - onBack() (function)
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // 'team' | 'players' | 'draft' | 'matchups' | 'league' | 'admin'

  // Keep week from league settings (default 1)
  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // ----- League listener
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // ----- Ensure my team exists + listen to it
  useEffect(() => {
    if (!leagueId || !username) return;
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: setTeam });
      } catch (e) {
        console.error("ensureTeam/listenTeam error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  // ----- Derived flags
  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const draftStatus = String(league?.draft?.status || "scheduled"); // scheduled | live | done
  const showDraftTab = draftStatus !== "done"; // hide after draft ends

  // If we somehow land on a hidden tab (e.g., draft finished), bump to "team"
  useEffect(() => {
    if (!showDraftTab && tab === "draft") setTab("team");
  }, [showDraftTab, tab]);

  // Simple null guard
  if (!leagueId) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={onBack}>&larr; Back</button>
        <p style={{ color: "crimson" }}>No league selected.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
        <h2 style={{ margin: 0 }}>{league?.name || leagueId}</h2>
        <span style={{ marginLeft: "auto", color: "#666" }}>
          Week {currentWeek}
        </span>
      </div>

      {/* Entry fee callout (if enabled and unpaid) */}
      {league?.entry?.enabled && !hasPaidEntry(league, username) && (
        <div
          style={{
            border: "1px solid #f0c36d",
            background: "#fff8e5",
            padding: 10,
            borderRadius: 6,
            marginBottom: 10,
          }}
        >
          <b>Entry fee required:</b>{" "}
          {Number(league?.entry?.amount || 0)} Pi. Please pay to participate.
          <div style={{ marginTop: 8 }}>
            <EntryFeePanel leagueId={leagueId} username={username} />
          </div>
        </div>
      )}

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

      {/* Content */}
      {tab === "team" && (
        <MyTeam
          leagueId={leagueId}
          username={username}
          currentWeek={currentWeek}
          rosterSlots={ROSTER_SLOTS}
        />
      )}

      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {tab === "draft" && showDraftTab && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {tab === "matchups" && (
        <MatchupsTab leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {tab === "league" && (
        <LeagueTab leagueId={leagueId} currentWeek={currentWeek} />
      )}

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
      aria-pressed={active ? "true" : "false"}
    >
      {label}
    </button>
  );
}
