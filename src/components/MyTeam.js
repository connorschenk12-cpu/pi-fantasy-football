/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  listPlayers,
  ROSTER_SLOTS,
} from "../../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import PlayerName from "../PlayerName";

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
  const [playersMap, setPlayersMap] = useState(new Map());

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

  // Load players → build a Map for fast lookups and nice names
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const arr = await listPlayers({ leagueId });
        if (!mounted) return;
        const m = new Map();
        arr.forEach((p) => m.set(p.id, p));
        setPlayersMap(m);
      } catch (e) {
        console.error("load players error:", e);
        setPlayersMap(new Map());
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const roster = team?.roster || {};
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

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team" active={tab === "team"} onClick={() => setTab("team")} />
        <TabButton label="Players" active={tab === "players"} onClick={() => setTab("players")} />
        <TabButton label="Draft" active={tab === "draft"} onClick={() => setTab("draft")} />
        <TabButton label="League" active={tab === "league"} onClick={() => setTab("league")} />
        {isOwner && (
          <TabButton label="Admin" active={tab === "admin"} onClick={() => setTab("admin")} />
        )}
      </div>

      {tab === "team" && (
        <div>
          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => (
              <li key={s} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ width: 40 }}>{s}</b>
                  <span>
                    <PlayerName id={roster[s]} playersMap={playersMap} fallback="(empty)" showPos showTeam />
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

          <h3>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map((pid) => (
              <li key={pid} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>
                    <PlayerName id={pid} playersMap={playersMap} />
                  </span>
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

      {tab === "league" && (
        <SimpleLeagueTab leagueId={leagueId} playersMap={playersMap} />
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

/** Minimal “League” tab (safe version) that won’t throw errors */
function SimpleLeagueTab({ leagueId, playersMap }) {
  const [teams, setTeams] = useState([]);
  const [league, setLeague] = useState(null);

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        const { listTeams, listenLeague } = await import("../../lib/storage");
        unsub = listenLeague(leagueId, setLeague);
        const t = await listTeams(leagueId);
        setTeams(t || []);
      } catch (e) {
        console.error("SimpleLeagueTab load error:", e);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  return (
    <div>
      <h3>League</h3>
      {league?.standings ? (
        <p style={{ marginTop: 0 }}>Teams: {Object.keys(league.standings).length}</p>
      ) : null}

      {teams.length === 0 ? (
        <p>No teams yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {teams.map((t) => (
            <div key={t.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{t.name || t.id}</strong>
                <span style={{ opacity: 0.8 }}>
                  {league?.standings?.[t.id]
                    ? `W-L: ${league.standings[t.id].wins}-${league.standings[t.id].losses}`
                    : ""}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <em>Starters:</em>
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0 0" }}>
                  {ROSTER_SLOTS.map((slot) => (
                    <li key={slot}>
                      <b style={{ width: 40, display: "inline-block" }}>{slot}</b>{" "}
                      <PlayerName id={t?.roster?.[slot]} playersMap={playersMap} fallback="(empty)" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
