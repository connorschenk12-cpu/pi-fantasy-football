/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  ROSTER_SLOTS,
  emptyRoster,
} from "../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";

/**
 * Props:
 * - leagueId
 * - username
 * - onBack()
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // team | players | draft | admin
  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // League
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
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

  // Owner check (case-insensitive)
  const isOwner = useMemo(() => {
    const a = (league?.owner || "").trim().toLowerCase();
    const b = (username || "").trim().toLowerCase();
    return !!a && !!b && a === b;
  }, [league?.owner, username]);

  const roster = team?.roster || emptyRoster();
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
      <div style={{ fontSize: 12, color: "#666", marginTop: -6 }}>
        Owner: <b>{league?.owner || "…"}</b> &middot; You: <b>{username || "…"}</b>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        {/* Always show Admin tab; LeagueAdmin enforces owner-only inside */}
        <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
      </div>

      {tab === "team" && (
        <div>
          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => (
              <li key={s} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ width: 44 }}>{s}</b>
                  <span>{roster[s] || "(empty)"}</span>
                  {roster[s] && (
                    <button onClick={() => handleSlotToBench(s)} style={{ marginLeft: 8 }}>
                      Send to Bench
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <h3>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map((pid) => (
              <li key={pid} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{pid}</span>
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

      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {tab === "draft" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {tab === "admin" && (
        <div>
          {!isOwner && (
            <div style={{ marginBottom: 8, color: "#b00", fontSize: 13 }}>
              You’re not the league owner, so some actions will be disabled.
            </div>
          )}
          <LeagueAdmin leagueId={leagueId} username={username} />
        </div>
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
