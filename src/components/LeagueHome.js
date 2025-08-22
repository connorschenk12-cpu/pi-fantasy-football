/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  ensureTeam,
  moveToStarter,
  moveToBench,
  ROSTER_SLOTS,
  hasPaidEntry,
  playerDisplay,
  listPlayersMap,
} from "../lib/storage";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import PlayersList from "./PlayersList";

// Firestore (for marking a payment as paid)
import { db } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";

/**
 * Props:
 * - leagueId
 * - username
 * - onBack()
 */
export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [tab, setTab] = useState("team"); // team | players | draft | league | admin
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

  // Load players map (so we can render names instead of IDs)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const m = await listPlayersMap({ leagueId });
        if (mounted) setPlayersMap(m);
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();
    return () => {
      mounted = false;
    };
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

  const handleMarkPaid = async () => {
    try {
      const lgRef = doc(db, "leagues", leagueId);
      await updateDoc(lgRef, {
        [`entry.paid.${username}`]: true,
      });
      alert("Payment recorded.");
    } catch (e) {
      console.error("payment error:", e);
      alert("Payment failed: " + (e.message || e));
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
          {/* Entry Fee Payment (only before draft and only if not paid) */}
          {league?.draft?.status !== "done" &&
            league?.entry?.enabled &&
            !hasPaidEntry(league, username) && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  background: "#fffef5",
                }}
              >
                <h3 style={{ marginTop: 0 }}>League Entry Fee</h3>
                <p style={{ margin: "6px 0" }}>
                  Amount: <b>{league.entry.amount} Pi</b>
                </p>
                <button onClick={handleMarkPaid}>Pay Now</button>
                <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                  (Draft is blocked until all members have paid or entry is disabled.)
                </div>
              </div>
            )}

          <h3>Starters</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ROSTER_SLOTS.map((s) => {
              const pid = roster[s] || null;
              const p = pid ? playersMap.get(pid) : null;
              const name = playerDisplay(p);
              return (
                <li key={s} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ width: 40 }}>{s}</b>
                    <span>{pid ? name : "(empty)"}</span>
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
            {bench.map((pid) => {
              const p = playersMap.get(pid);
              const name = playerDisplay(p);
              return (
                <li key={pid} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{name}</span>
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
              );
            })}
            {bench.length === 0 && <li>(no bench players)</li>}
          </ul>
        </div>
      )}

      {tab === "players" && <PlayersList leagueId={leagueId} currentWeek={currentWeek} />}

      {tab === "draft" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {tab === "league" && (
        <div style={{ padding: 8 }}>
          <p>View other teams and schedules here (UI coming next).</p>
        </div>
      )}

      {tab === "admin" && isOwner && <LeagueAdmin leagueId={leagueId} username={username} />}
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
