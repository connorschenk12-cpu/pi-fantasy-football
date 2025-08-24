/* eslint-disable no-console */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import { listenLeague } from "../lib/storage";

import MyTeam from "./MyTeam";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import LeagueTab from "./LeagueTab";
import MatchupsTab from "./MatchupsTab";

/**
 * Props:
 *  - leagueId   (string, required)
 *  - username   (string, required)
 *  - onBack?    (function) optional back handler
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [tab, setTab] = useState("team"); // team | players | draft | league | matchups | admin

  // Live league listener
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  const isOwner = useMemo(() => {
    return !!league?.owner && !!username && league.owner === username;
  }, [league?.owner, username]);

  const currentWeek = Number(league?.settings?.currentWeek || 1);
  const draftStatus = league?.draft?.status || "scheduled"; // scheduled | live | done

  // Hide "Draft" tab after draft is done
  const tabs = useMemo(() => {
    const base = [
      { key: "team", label: "My Team" },
      { key: "players", label: "Players" },
      ...(draftStatus === "done" ? [] : [{ key: "draft", label: "Draft" }]),
      { key: "league", label: "League" },
      { key: "matchups", label: "Matchups" },
    ];
    if (isOwner) base.push({ key: "admin", label: "Admin" });
    return base;
  }, [draftStatus, isOwner]);

  // If current tab disappeared (e.g., draft finished), bounce to "team"
  useEffect(() => {
    if (!tabs.find((t) => t.key === tab)) setTab("team");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  if (!leagueId || !username) {
    return (
      <div style={{ padding: 12, color: "#b00" }}>
        Missing league or user context. (leagueId={String(leagueId)}, username={String(username)})
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
        {onBack && (
          <button onClick={onBack}>&larr; Back</button>
        )}
        <h2 style={{ margin: 0 }}>{league?.name || "League"}</h2>
        <span style={{ color: "#666", fontSize: 13 }}>
          Week {currentWeek} • Draft: {draftStatus}
          {isOwner ? " • (Commissioner)" : ""}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <TabButton
            key={t.key}
            label={t.label}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
          />
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        {tab === "team" && <MyTeam leagueId={leagueId} username={username} />}

        {tab === "players" && (
          <PlayersList leagueId={leagueId} currentWeek={currentWeek} username={username} />
        )}

        {tab === "draft" && draftStatus !== "done" && (
          <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
        )}

        {tab === "league" && (
          <LeagueTab leagueId={leagueId} username={username} />
        )}

        {tab === "matchups" && (
          <MatchupsTab leagueId={leagueId} username={username} currentWeek={currentWeek} />
        )}

        {tab === "admin" && isOwner && (
          <LeagueAdmin leagueId={leagueId} username={username} />
        )}
      </div>
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
