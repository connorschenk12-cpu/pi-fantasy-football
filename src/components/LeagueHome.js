/* eslint-disable react-hooks/exhaustive-deps */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listenTeam,
  listPlayers,
  projForWeek,
  isMyTurn,
  canDraft,
  moveToBench,
  moveToStarter,
  addDropPlayer,
} from "../lib/storage";
import DraftBoard from "./DraftBoard";
import PlayersList from "./PlayersList";
import AdminDraftSetup from "./AdminDraftSetup";

const box = { border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 12 };
const h2 = { margin: "8px 0 4px 0" };
const th = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee" };
const td = { padding: "6px 8px", borderBottom: "1px solid #f3f3f3" };

export default function LeagueHome({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [tab, setTab] = useState("myteam");
  const [weekOverride, setWeekOverride] = useState(null); // allow manual week switch in UI

  // live league
  useEffect(() => {
    if (!leagueId) return;
    const un = listenLeague(leagueId, (lg) => setLeague(lg));
    return () => un && un();
  }, [leagueId]);

  // live team
  useEffect(() => {
    if (!leagueId || !username) return;
    const un = listenTeam({ leagueId, username, onChange: (t) => setTeam(t) });
    return () => un && un();
  }, [leagueId, username]);

  // load players (global or league-scoped)
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      const arr = await listPlayers({ leagueId });
      setPlayers(arr);
    })();
  }, [leagueId]);

  const playersById = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  const currentWeek = useMemo(() => {
    if (weekOverride) return weekOverride;
    const w = Number(league?.settings?.currentWeek || 1);
    return w >= 1 ? w : 1;
  }, [league?.settings?.currentWeek, weekOverride]);

  const draft = league?.draft || {};
  const addLocked = !!league?.settings?.lockAddDuringDraft && draft?.status === "live";

  // --------- My Team helpers ----------
  const rosterRows = useMemo(() => {
    const r = team?.roster || {};
    const toRow = (slot) => {
      const id = r[slot];
      const p = id ? playersById.get(id) : null;
      return {
        slot,
        id,
        name: p?.displayName || p?.name || (id ? id : "—"),
        pos: p?.position || "",
        nfl: p?.team || "",
        proj: id ? projForWeek(p, currentWeek) : 0
      };
    };
    return ["QB","WR1","WR2","RB1","RB2","TE","FLEX","K","DEF"].map(toRow);
  }, [team, playersById, currentWeek]);

  async function benchSlot(slot) {
    try {
      await moveToBench({ leagueId, username, slot });
    } catch (e) {
      alert(e.message || "Failed to move to bench");
    }
  }

  async function startFromBench(playerId, slot) {
    try {
      await moveToStarter({ leagueId, username, playerId, slot });
    } catch (e) {
      alert(e.message || "Failed to start player");
    }
  }

  // --------- UI ---------
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 12 }}>
      <h1 style={{ margin: "8px 0 12px 0" }}>{league?.name || "League"}</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <TabButton id="myteam" tab={tab} setTab={setTab} label="My Team" />
        <TabButton id="players" tab={tab} setTab={setTab} label="Players" />
        <TabButton id="draft" tab={tab} setTab={setTab} label="Draft" />
        <TabButton id="admin" tab={tab} setTab={setTab} label="Admin" />
      </div>

      {/* Week switcher */}
      <div style={{ ...box }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b>Week:</b>
          <select value={currentWeek} onChange={(e) => setWeekOverride(Number(e.target.value))}>
            {Array.from({ length: 18 }).map((_, i) => (
              <option key={i+1} value={i+1}>Week {i+1}</option>
            ))}
          </select>
          <span style={{ opacity: 0.7 }}>
            (Defaults to league’s currentWeek: {Number(league?.settings?.currentWeek || 1)})
          </span>
        </div>
      </div>

      {tab === "myteam" && (
        <section style={box}>
          <h2 style={h2}>Starters</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={th}>Slot</th>
                <th style={th}>Player</th>
                <th style={th}>Pos</th>
                <th style={th}>NFL</th>
                <th style={th}>Proj (W{currentWeek})</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rosterRows.map((r) => (
                <tr key={r.slot}>
                  <td style={td}><b>{r.slot}</b></td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.pos}</td>
                  <td style={td}>{r.nfl}</td>
                  <td style={td}>{r.proj.toFixed(1)}</td>
                  <td style={td}>
                    {r.id ? (
                      <button onClick={() => benchSlot(r.slot)} style={{ padding: 6 }}>
                        To Bench
                      </button>
                    ) : (
                      <span style={{ opacity: 0.5 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={h2}>Bench</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Player</th>
                <th style={th}>Pos</th>
                <th style={th}>NFL</th>
                <th style={th}>Proj</th>
                <th style={th}>Start To…</th>
              </tr>
            </thead>
            <tbody>
              {(team?.bench || []).map((id) => {
                const p = playersById.get(id);
                return (
                  <tr key={id}>
                    <td style={td}>{p?.displayName || p?.name || id}</td>
                    <td style={td}>{p?.position || ""}</td>
                    <td style={td}>{p?.team || ""}</td>
                    <td style={td}>{projForWeek(p, currentWeek).toFixed(1)}</td>
                    <td style={td}>
                      <BenchStartMenu playerId={id} onStart={(slot) => startFromBench(id, slot)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === "players" && (
        <section style={box}>
          <PlayersList
            leagueId={leagueId}
            username={username}
            currentWeek={currentWeek}
            onChangeWeek={setWeekOverride}
            addLocked={addLocked}
          />
        </section>
      )}

      {tab === "draft" && (
        <section style={box}>
          <DraftBoard league={league} playersById={playersById} />
          <p style={{ marginTop: 6, opacity: 0.7 }}>
            Draft status: <b>{draft?.status || "scheduled"}</b>
            {Array.isArray(draft?.order) && draft.order.length > 0 && (
              <> · Round {draft?.round || 1} of {draft?.roundsTotal || 12} · On the clock: <b>{draft?.order?.[draft?.pointer || 0] || "—"}</b></>
            )}
          </p>
          {canDraft(league) && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              While draft is live, Adds are locked; picks auto-draft after the 5s clock.
            </div>
          )}
        </section>
      )}

      {tab === "admin" && (
        <section style={box}>
          <h2 style={h2}>Admin</h2>
          <AdminDraftSetup league={league} />
        </section>
      )}
    </div>
  );
}

function TabButton({ id, tab, setTab, label }) {
  const active = id === tab;
  return (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        border: "1px solid #ddd",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
        cursor: "pointer"
      }}
    >
      {label}
    </button>
  );
}

function BenchStartMenu({ onStart }) {
  const [open, setOpen] = useState(false);
  const slots = ["QB","WR1","WR2","RB1","RB2","TE","FLEX","K","DEF"];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ padding: 6 }}>
        Start…
      </button>
      {open && (
        <div
          style={{
            position: "absolute", zIndex: 10, background: "#fff",
            border: "1px solid #ddd", borderRadius: 6, padding: 6
          }}
        >
          {slots.map((s) => (
            <div key={s}>
              <button onClick={() => { setOpen(false); onStart(s); }} style={{ padding: 6 }}>
                {s}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
