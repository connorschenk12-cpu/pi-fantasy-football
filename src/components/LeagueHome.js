/* eslint-disable no-console */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";

import {
  listenLeague,
  listenTeam,
  ensureTeam,
  hasPaidEntry,
} from "../lib/storage";

// Tabs
import MyTeam from "./MyTeam";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueTab from "./LeagueTab";
import MatchupsTab from "./MatchupsTab";
import LeagueAdmin from "./LeagueAdmin";

// Payments UI (make sure this file exists)
import EntryFeePanel from "./EntryFeePanel";

/**
 * Props:
 * - leagueId   (string)
 * - username   (string)
 * - onBack?    (function)
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // "team" | "players" | "draft" | "league" | "matchups" | "admin"

  // Load / listen to league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure team and listen to it
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

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  const isOwner = useMemo(
    () => !!league?.owner && !!username && league.owner === username,
    [league?.owner, username]
  );

  const draftStatus = league?.draft?.status || "scheduled"; // scheduled | live | done
  const showDraftTab = draftStatus !== "done"; // hide draft tab after it completes (per earlier request)

  const paymentsEnabled = !!league?.entry?.enabled;
  const userHasPaid = hasPaidEntry(league, username);

  // Tabs to show
  const tabs = useMemo(() => {
    const t = [
      { key: "team", label: "My Team" },
      { key: "players", label: "Players" },
    ];
    if (showDraftTab) t.push({ key: "draft", label: "Draft" });
    t.push({ key: "league", label: "League" });
    t.push({ key: "matchups", label: "Matchups" });
    if (isOwner) t.push({ key: "admin", label: "Admin" });
    return t;
  }, [isOwner, showDraftTab]);

  if (!leagueId) {
    return (
      <div style={{ padding: 12 }}>
        <h3>No league selected</h3>
        {onBack && (
          <button onClick={onBack} style={{ marginTop: 8 }}>
            &larr; Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
        {onBack && <button onClick={onBack}>&larr; Back</button>}
        <h2 style={{ margin: 0 }}>{league?.name || leagueId}</h2>
        <span style={{ marginLeft: "auto", color: "#666", fontSize: 13 }}>
          Week {currentWeek}
        </span>
      </div>

      {/* Tab bar */}
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

      {/* Tab contents */}
      {tab === "team" && (
        <div>
          {/* Payments: show in My Team only BEFORE draft starts, if enabled.
              Also show to unpaid non-admins; owner can still see the panel to verify. */}
          {paymentsEnabled && draftStatus !== "done" && (
            <div style={{ marginBottom: 12 }}>
              <EntryFeePanel leagueId={leagueId} username={username} />
              {!userHasPaid && (
                <div style={{ color: "#b00", marginTop: 6 }}>
                  Entry required before drafting.
                </div>
              )}
            </div>
          )}

          {/* Your MyTeam component (handles lineup, bench, points, etc.) */}
          <MyTeam leagueId={leagueId} username={username} />
        </div>
      )}

      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {tab === "draft" && showDraftTab && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {tab === "league" && (
        <LeagueTab leagueId={leagueId} username={username} />
      )}

      {tab === "matchups" && (
        <MatchupsTab leagueId={leagueId} currentWeek={currentWeek} />
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
      }}
    >
      {label}
    </button>
  );
}
