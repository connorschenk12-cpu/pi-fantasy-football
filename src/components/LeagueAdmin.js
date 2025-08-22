/* eslint-disable no-console */
/* eslint-disable react-hooks/exhaustive-deps */

// src/pages/LeaguePage.js
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import PlayersList from "../components/PlayersList";
import DraftBoard from "../components/DraftBoard";
import LeagueAdmin from "../components/LeagueAdmin";

import {
  listenLeague,
  listenTeam,
  emptyRoster,
} from "../lib/storage";

/**
 * Props:
 * - username (required)
 * - leagueId (optional, if you don't use /league/:leagueId routing)
 */
export default function LeaguePage({ username, leagueId: leagueIdProp }) {
  const params = useParams?.() || {};
  const leagueId = leagueIdProp || params.leagueId;
  const navigate = useNavigate?.();

  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // "team" | "players" | "draft" | "admin"
  const [error, setError] = useState("");

  // --- Load league doc ---
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => setLeague(l));
    return () => unsub && unsub();
  }, [leagueId]);

  // --- Load my team doc ---
  useEffect(() => {
    if (!leagueId || !username) return;
    const unsub = listenTeam({
      leagueId,
      username,
      onChange: (t) => setTeam(t),
    });
    return () => unsub && unsub();
  }, [leagueId, username]);

  // --- Owner check ---
  const isOwner = useMemo(
    () => !!(league && username && league.owner === username),
    [league, username]
  );

  // --- Join link helper (to share) ---
  const joinLink = useMemo(() => {
    try {
      const base = window.location.origin;
      return `${base}/?join=${leagueId || ""}`;
    } catch {
      return "";
    }
  }, [leagueId]);

  // --- Basic roster/bench formatting helpers ---
  const roster = team?.roster || emptyRoster();
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // --- Light styles for tabs ---
  const TabBtn = ({ id, children }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #ddd",
        background: tab === id ? "#f2f6ff" : "white",
        cursor: "pointer",
        fontWeight: tab === id ? 700 : 500,
      }}
    >
      {children}
    </button>
  );

  // --- Guard rails / empty states ---
  if (!leagueId) {
    return (
      <div style={{ padding: 16 }}>
        <h2>League</h2>
        <div style={{ color: "#b00" }}>No league selected.</div>
        {navigate && (
          <button
            style={{ marginTop: 12 }}
            onClick={() => navigate("/")}
          >
            Back to Leagues
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {navigate && (
          <button onClick={() => navigate("/")}>&larr; Back</button>
        )}
        <h2 style={{ margin: 0 }}>
          {league?.name || "League"}{" "}
          <span style={{ fontSize: 12, color: "#666", fontWeight: 400 }}>
            (ID: {leagueId})
          </span>
        </h2>
      </div>

      <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
        Owner: <b>{league?.owner || "…"}</b> · Your username: <b>{username || "…"}</b>
      </div>

      <div style={{ marginTop: 10 }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Share Join Link:</span>{" "}
        <code style={{ fontSize: 12 }}>{joinLink}</code>{" "}
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(joinLink);
              alert("Join link copied to clipboard!");
            } catch {
              alert("Copy failed. You can copy the link text manually.");
            }
          }}
          style={{ padding: "4px 8px" }}
        >
          Copy
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, color: "red" }}>Error: {error}</div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 16,
          borderBottom: "1px solid #eaeaea",
          paddingBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <TabBtn id="team">My Team</TabBtn>
        <TabBtn id="players">Players</TabBtn>
        <TabBtn id="draft">Draft</TabBtn>
        {isOwner && <TabBtn id="admin">Admin</TabBtn>}
      </div>

      {/* Content */}
      <div style={{ marginTop: 16 }}>
        {tab === "team" && (
          <div>
            <h3 style={{ marginTop: 0 }}>My Team</h3>
            {!team && <div>Loading your team…</div>}
            {team && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 820 }}>
                {/* Roster */}
                <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Starters</div>
                  <table width="100%" style={{ borderCollapse: "collapse" }}>
                    <tbody>
                      {Object.keys(roster).map((slot) => (
                        <tr key={slot} style={{ borderBottom: "1px solid #f3f3f3" }}>
                          <td style={{ padding: "6px 4px", width: 70 }}>
                            <b>{slot}</b>
                          </td>
                          <td style={{ padding: "6px 4px" }}>
                            {roster[slot] ? roster[slot] : <i>empty</i>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Bench */}
                <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Bench</div>
                  {bench.length === 0 ? (
                    <div><i>No bench players yet.</i></div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {bench.map((pid) => (
                        <li key={pid} style={{ padding: "4px 0" }}>{pid}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "players" && (
          <div>
            <h3 style={{ marginTop: 0 }}>Players</h3>
            <PlayersList leagueId={leagueId} username={username} />
          </div>
        )}

        {tab === "draft" && (
          <div>
            <h3 style={{ marginTop: 0 }}>Draft</h3>
            {!league ? (
              <div>Loading league…</div>
            ) : (
              <DraftBoard leagueId={leagueId} username={username} />
            )}
          </div>
        )}

        {tab === "admin" && isOwner && (
          <div>
            <h3 style={{ marginTop: 0 }}>Admin</h3>
            {!league ? (
              <div>Loading league…</div>
            ) : (
              <LeagueAdmin leagueId={leagueId} username={username} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
