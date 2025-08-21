/* eslint-disable react-hooks/exhaustive-deps */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import PlayersList from "./PlayersList";
import {
  listenLeague,
  listenTeam,
  listPlayers,
  getLeagueClaims,
  canDraft,
  draftPick,
  releasePlayerAndClearSlot,
} from "../lib/storage";

export default function LeagueHome({ league, me, onBack, onShowNews }) {
  const leagueId = league?.id;

  // ----- State (hooks must be top-level, never inside conditionals)
  const [activeTab, setActiveTab] = useState("myteam"); // 'myteam' | 'players' | 'draft'
  const [leagueState, setLeagueState] = useState(league || null);
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [pickSlot, setPickSlot] = useState("FLEX"); // default slot for draft UI
  const [pickPlayerId, setPickPlayerId] = useState("");

  // ----- Derived data (ALWAYS safe to compute with useMemo at top level)
  const playersById = useMemo(() => {
    const m = new Map();
    (players || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  const rosterDisplay = useMemo(() => {
    const r = team?.roster || {};
    const toRow = (slot) => {
      const id = r[slot];
      const p = id ? playersById.get(id) : null;
      return { slot, id, name: p?.displayName || p?.name || (id ? id : "—"), team: p?.team || "", pos: p?.position || "" };
    };
    return ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].map(toRow);
  }, [team, playersById]);

  const isMyTurnToDraft = useMemo(() => {
    if (!leagueState) return false;
    const d = leagueState.draft || {};
    const order = Array.isArray(d.order) ? d.order : [];
    const pointer = Number.isInteger(d.pointer) ? d.pointer : 0;
    const current = order[pointer];
    return canDraft(leagueState) && current === me;
  }, [leagueState, me]);

  // ----- Effects & listeners
  useEffect(() => {
    if (!leagueId) return;
    // live league updates
    const un = listenLeague(leagueId, setLeagueState);
    return () => un && un();
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !me) return;
    // my team listener
    const un = listenTeam({ leagueId, username: me, onChange: setTeam });
    return () => un && un();
  }, [leagueId, me]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!leagueId) return;
      const [p, c] = await Promise.all([listPlayers({ leagueId }), getLeagueClaims(leagueId)]);
      if (!cancelled) {
        setPlayers(p || []);
        setClaims(c || new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // ----- Actions
  async function handleDraftPick() {
    try {
      if (!pickPlayerId) {
        alert("Choose a player ID to draft (temporarily input ID).");
        return;
      }
      const pos = playersById.get(pickPlayerId)?.position || "";
      await draftPick({
        leagueId,
        username: me,
        playerId: pickPlayerId,
        playerPosition: pos,
        slot: pickSlot || pos,
      });
      setPickPlayerId("");
    } catch (e) {
      alert(e.message || "Draft pick failed");
    }
  }

  async function handleRelease(playerId) {
    try {
      await releasePlayerAndClearSlot({ leagueId, username: me, playerId });
    } catch (e) {
      alert(e.message || "Release failed");
    }
  }

  // ----- Render helpers (no hooks inside)
  function renderMyTeam() {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>My Team</h3>
        {team ? (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Slot</th>
                  <th style={th}>Player</th>
                  <th style={th}>Team</th>
                  <th style={th}>Pos</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rosterDisplay.map((row) => (
                  <tr key={row.slot}>
                    <td style={td}>{row.slot}</td>
                    <td style={td}>{row.name}</td>
                    <td style={td}>{row.team}</td>
                    <td style={td}>{row.pos}</td>
                    <td style={td}>
                      {row.id ? (
                        <button onClick={() => handleRelease(row.id)} style={{ padding: 6 }}>
                          Release
                        </button>
                      ) : (
                        <span style={{ opacity: 0.5 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginTop: 16 }}>Bench</h4>
            <ul>
              {(team.bench || []).map((id) => {
                const p = playersById.get(id);
                return <li key={id}>{p?.displayName || p?.name || id}</li>;
              })}
              {(team.bench || []).length === 0 && <li style={{ opacity: 0.6 }}>No bench players yet</li>}
            </ul>
          </>
        ) : (
          <p>Loading team…</p>
        )}
      </div>
    );
  }

  function renderPlayers() {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>Players</h3>
        <PlayersList leagueId={leagueId} username={me} onShowNews={onShowNews} />
      </div>
    );
  }

  function renderDraft() {
    const d = leagueState?.draft || {};
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>Draft</h3>
        <p>
          Status: <b>{d.status || "unscheduled"}</b>
        </p>
        {d.order && d.order.length > 0 && (
          <p>
            Round {d.round || 1} · Direction {d.direction === -1 ? "⬅︎" : "➜"} · Current:{" "}
            <b>{(d.order[(Number.isInteger(d.pointer) ? d.pointer : 0)] || "—")}</b>
          </p>
        )}

        {isMyTurnToDraft ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Slot:&nbsp;
              <select value={pickSlot} onChange={(e) => setPickSlot(e.target.value)}>
                {["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Player ID:&nbsp;
              <input
                value={pickPlayerId}
                onChange={(e) => setPickPlayerId(e.target.value)}
                placeholder="type an ID (temporary UI)"
                style={{ width: 220 }}
              />
            </label>
            <button onClick={handleDraftPick} style={{ padding: 8 }}>Draft</button>
          </div>
        ) : (
          <p style={{ opacity: 0.7 }}>
            {canDraft(leagueState)
              ? "Waiting for your turn…"
              : "Draft not live yet."}
          </p>
        )}

        {Array.isArray(d.picks) && d.picks.length > 0 && (
          <>
            <h4 style={{ marginTop: 16 }}>Picks</h4>
            <ol>
              {d.picks.map((p, i) => {
                const pl = playersById.get(p.playerId);
                const label = pl?.displayName || pl?.name || p.playerId;
                return (
                  <li key={i}>
                    #{p.overall} · R{p.round}P{p.pickInRound} — {p.username} selected {label} ({p.slot})
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    );
  }

  // ----- Main render (no hooks here, just JSX)
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onBack} style={{ padding: 6 }}>← Back</button>
        <h2 style={{ margin: 0 }}>{leagueState?.name || "League"}</h2>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <TabButton label="My Team"  id="myteam" active={activeTab} onClick={setActiveTab} />
        <TabButton label="Players"  id="players" active={activeTab} onClick={setActiveTab} />
        <TabButton label="Draft"    id="draft"   active={activeTab} onClick={setActiveTab} />
      </div>

      {activeTab === "myteam" && renderMyTeam()}
      {activeTab === "players" && renderPlayers()}
      {activeTab === "draft" && renderDraft()}
    </div>
  );
}

/* ---------- tiny UI helpers ---------- */
function TabButton({ label, id, active, onClick }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid #ddd",
        background: isActive ? "#111" : "#fff",
        color: isActive ? "#fff" : "#111",
        cursor: "pointer"
      }}
    >
      {label}
    </button>
  );
}

const th = { textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" };
const td = { borderBottom: "1px solid #f5f5f5", padding: "6px 4px" };
