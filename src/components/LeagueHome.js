// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import MyTeam from "./MyTeam";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import { listenLeague } from "../lib/storage";

export default function LeagueHome({ league, me, onBack }) {
  // Keep a live copy of the league doc
  const [liveLeague, setLiveLeague] = useState(league || null);
  const [tab, setTab] = useState("players"); // 'team' | 'players' | 'draft' | 'admin'

  useEffect(() => {
    if (!league?.id) return;
    const unsub = listenLeague(league.id, (l) => setLiveLeague(l || league));
    return () => unsub && unsub();
  }, [league?.id, league]);

  const l = liveLeague || league;
  if (!l) {
    return (
      <div style={{ marginTop: 8 }}>
        <button onClick={onBack} style={{ marginBottom: 12, padding: 8 }}>
          ← Back to Leagues
        </button>
        <p>⚠️ League not found.</p>
      </div>
    );
  }

  const isOwner = useMemo(() => l.owner === me, [l, me]);
  const members = Array.isArray(l.members) ? l.members : [];
  const draftStatus = l?.draft?.status || "unscheduled";

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={onBack} style={{ marginBottom: 12, padding: 8 }}>
        ← Back to Leagues
      </button>

      <h2>{l.name}</h2>
      <p>
        <strong>League ID:</strong> <code>{l.id}</code>
      </p>
      <p>
        <strong>Owner:</strong> {l.owner}
      </p>
      <p>
        <strong>Draft status:</strong> {draftStatus}
      </p>

      <h3 style={{ marginTop: 16 }}>Members</h3>
      {members.length === 0 ? (
        <p>No members yet.</p>
      ) : (
        <ul style={{ paddingLeft: 16 }}>
          {members.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setTab("team")}
          style={{ padding: 8, fontWeight: tab === "team" ? 700 : 400 }}
        >
          My Team
        </button>
        <button
          onClick={() => setTab("players")}
          style={{ padding: 8, fontWeight: tab === "players" ? 700 : 400 }}
        >
          Players
        </button>
        <button
          onClick={() => setTab("draft")}
          style={{ padding: 8, fontWeight: tab === "draft" ? 700 : 400 }}
        >
          Draft
        </button>
        {isOwner && (
          <button
            onClick={() => setTab("admin")}
            style={{ padding: 8, fontWeight: tab === "admin" ? 700 : 400 }}
          >
            Admin
          </button>
        )}
      </div>

      {/* Tab content */}
      <div style={{ marginTop: 16 }}>
        {tab === "team" && (
          <MyTeam leagueId={l.id} username={me} onBack={() => setTab("players")} />
        )}
        {tab === "players" && <PlayersList leagueId={l.id} />}
        {tab === "draft" && <DraftBoard leagueId={l.id} username={me} />}
        {tab === "admin" && isOwner && (
          <LeagueAdmin leagueId={l.id} me={me} owner={l.owner} />
        )}
      </div>
    </div>
  );
}
