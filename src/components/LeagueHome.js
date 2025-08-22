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
  listPlayers,
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
  const [playersById, setPlayersById] = useState({});
  const currentWeek = Number(league?.settings?.currentWeek || 1);

  // Listen to league doc
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // Ensure team + listen to my team doc
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

  // Load players once and build a lookup map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const all = await listPlayers({ leagueId });
        if (!mounted) return;
        const map = {};
        for (const p of all) map[p.id] = p;
        setPlayersById(map);
      } catch (e) {
        console.error("load players error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  const isOwner = useMemo(() => {
    return league?.owner && username
      ? String(league.owner).toLowerCase() === String(username).toLowerCase()
      : false;
  }, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  // Helpers to render nicer labels
  const labelOf = (playerId) => {
    if (!playerId) return "(empty)";
    const p = playersById[playerId];
    if (!p) return playerId; // fallback while map loads
    const name = p.name || p.fullName || playerId;
    const pos = p.position || p.pos || "";
    const tm = p.team || p.teamAbbr || p.nflTeam || "";
    return `${name}${pos ? ` · ${pos}` : ""}${tm ? ` · ${tm}` : ""}`;
  };

  // Move bench -> starter slot
  const handleBenchToSlot = async (playerId, slot) => {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error("moveToStarter error:", e);
      alert(String(e?.message || e));
    }
  };
  // Move starter slot -> bench
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

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team"   active={tab === "team"}   onClick={() => setTab("team")} />
        <TabButton label="Players"   active={tab === "players"} onClick={() => setTab("players")} />
        <TabButton label="Draft"     active={tab === "draft"}   onClick={() => setTab("draft")} />
        {isOwner && (
          <TabButton label="Admin"   active={tab === "admin"}   onClick={() => setTab("admin")} />
        )}
      </div>

      {/* TEAM TAB */}
      {tab === "team" && (
        <div>
          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s];
              return (
                <li key={s} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ width: 50 }}>{s}</b>
                    <span>{labelOf(pid)}</span>
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
            {bench.map((pid) => (
              <li key={pid} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{labelOf(pid)}</span>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const slot = e.target.value;
                      if (slot) handleBenchToSlot(pid, slot);
                    }}
                  >
                    <option value="">Move to slot…</option>
                    {ROSTER_SLOTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
            {bench.length === 0 && <li>(no bench players)</li>}
          </ul>
        </div>
      )}

      {/* PLAYERS TAB */}
      {tab === "players" && (
        <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
      )}

      {/* DRAFT TAB */}
      {tab === "draft" && (
        <DraftBoard
          leagueId={leagueId}
          username={username}
          currentWeek={currentWeek}
          playersById={playersById} // ensures Draft shows names too
        />
      )}

      {/* ADMIN TAB */}
      {tab === "admin" && isOwner && (
        league ? (
          <LeagueAdmin league={league} leagueId={leagueId} username={username} />
        ) : (
          <div>Loading league…</div>
        )
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
