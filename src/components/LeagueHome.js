/* eslint-disable react-hooks/exhaustive-deps */
// src/components/LeagueHome.js
import React, { useEffect, useMemo, useState } from "react";
import PlayersList from "./PlayersList";
import LeagueAdmin from "./LeagueAdmin";
import EntryFeeButton from "./EntryFeeButton";
import DevPanel from "./DevPanel";
import DraftBoard from "./DraftBoard";
import {
  listenLeague,
  listenTeam,
  listPlayers,
  getLeagueClaims,
  listenLeagueClaims,
  canDraft,
  draftPick,
  releasePlayerAndClearSlot,
  moveToBench,
  moveToStarter,
  hasPaidEntry,
} from "../lib/storage";

export default function LeagueHome({ league, me, onBack, onShowNews }) {
  const leagueId = league?.id;

  const [activeTab, setActiveTab] = useState("myteam"); // 'myteam' | 'players' | 'draft' | 'admin'
  const [leagueState, setLeagueState] = useState(league || null);
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [pickSlot, setPickSlot] = useState("FLEX");
  const [pickQuery, setPickQuery] = useState("");
  const [pickPlayerId, setPickPlayerId] = useState("");

  // bench start-slot choices keyed by playerId
  const [slotChoiceByPlayer, setSlotChoiceByPlayer] = useState({});

  /* ---------- live league + team ---------- */
  useEffect(() => {
    if (!leagueId) return;
    const un = listenLeague(leagueId, setLeagueState);
    return () => un && un();
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId || !me) return;
    const un = listenTeam({ leagueId, username: me, onChange: setTeam });
    return () => un && un();
  }, [leagueId, me]);

  /* ---------- players + claims (live) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!leagueId) return;
      const p = await listPlayers({ leagueId });
      if (!cancelled) setPlayers(p || []);
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    const un = listenLeagueClaims(leagueId, (map) => setClaims(map || new Map()));
    return () => un && un();
  }, [leagueId]);

  /* ---------- maps + derived ---------- */
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

  const draftIsFreeOrPaid = useMemo(() => {
    const entryEnabled = !!leagueState?.entry?.enabled;
    if (!entryEnabled) return true;          // free leagues -> draft allowed
    return hasPaidEntry(leagueState, me);    // paid leagues -> must have paid
  }, [leagueState, me]);

  function defaultSlotForPosition(pos) {
    const p = String(pos || "").toUpperCase();
    if (["QB","RB","WR","TE","K","DEF"].includes(p)) return p;
    return "FLEX";
  }

  /* ---------- draft: suggestions & recommended ---------- */
  const availablePlayers = useMemo(() => {
    const out = [];
    for (const p of players) {
      if (!claims.has(p.id)) out.push(p);
    }
    return out;
  }, [players, claims]);

  const normalizedQuery = pickQuery.trim().toLowerCase();
  const nameMatches = useMemo(() => {
    if (!normalizedQuery) return [];
    const max = 10;
    const arr = [];
    for (const p of availablePlayers) {
      const name = (p.displayName || p.name || "").toLowerCase();
      const team = (p.team || "").toLowerCase();
      if (name.includes(normalizedQuery) || team.includes(normalizedQuery)) {
        arr.push(p);
        if (arr.length >= max) break;
      }
    }
    // sort by projection desc if available
    arr.sort((a, b) => Number(b.projPoints || 0) - Number(a.projPoints || 0));
    return arr;
  }, [normalizedQuery, availablePlayers]);

  const recommendedTop = useMemo(() => {
    const top = [...availablePlayers];
    top.sort((a, b) => Number(b.projPoints || 0) - Number(a.projPoints || 0));
    return top.slice(0, 12);
  }, [availablePlayers]);

  async function handleDraftPick() {
    try {
      let chosenId = pickPlayerId;
      if (!chosenId && nameMatches.length > 0) {
        chosenId = nameMatches[0].id;
      }
      if (!chosenId) {
        alert("Choose a player by clicking a suggestion or enter a name.");
        return;
      }
      const pos = playersById.get(chosenId)?.position || "";
      await draftPick({
        leagueId,
        username: me,
        playerId: chosenId,
        playerPosition: pos,
        slot: pickSlot || pos,
      });
      setPickQuery("");
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

  /* ---------- render sections ---------- */
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
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button onClick={() => handleRelease(row.id)} style={{ padding: 6 }}>
                            Release
                          </button>
                          <button onClick={() => moveToBench({ leagueId, username: me, slot: row.slot })} style={{ padding: 6 }}>
                            Bench
                          </button>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.5 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{ marginTop: 16 }}>Bench</h4>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(team.bench || []).map((id) => {
                const p = playersById.get(id);
                const label = p?.displayName || p?.name || id;
                const chosen = slotChoiceByPlayer[id] ?? defaultSlotForPosition(p?.position);
                return (
                  <li key={id} style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{label} · {p?.team} · {p?.position}</span>
                    <select
                      value={chosen}
                      onChange={(e) => setSlotChoiceByPlayer((prev) => ({ ...prev, [id]: e.target.value }))}
                      style={{ padding: 4 }}
                    >
                      {["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      onClick={async () => {
                        try {
                          await moveToStarter({ leagueId, username: me, playerId: id, slot: slotChoiceByPlayer[id] ?? defaultSlotForPosition(p?.position) });
                        } catch (e) {
                          alert(e.message || "Failed to start player");
                        }
                      }}
                      style={{ padding: 6 }}
                    >
                      Start
                    </button>
                  </li>
                );
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
        <PlayersList
          leagueId={leagueId}
          username={me}
          onShowNews={onShowNews}
        />
      </div>
    );
  }

  function renderDraft() {
    const d = leagueState?.draft || {};
    const order = Array.isArray(d.order) ? d.order : [];

    return (
      <div>
        <h3 style={{ marginTop: 0 }}>Draft</h3>
        <p>
          Status: <b>{d.status || "unscheduled"}</b>
          {order.length > 0 && <> · Round {d.round || 1} · Direction {d.direction === -1 ? "⬅︎ (reverse)" : "➜ (forward)"} · On the clock: <b>{order[(Number.isInteger(d.pointer) ? d.pointer : 0)] || "—"}</b></>}
        </p>

        <DraftBoard league={leagueState} playersById={playersById} />

        {canDraft(leagueState) && draftIsFreeOrPaid ? (
          isMyTurnToDraft ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
                <label>
                  Slot:&nbsp;
                  <select value={pickSlot} onChange={(e) => setPickSlot(e.target.value)}>
                    {["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: "1 1 320px" }}>
                  Search name/team:&nbsp;
                  <input
                    value={pickQuery}
                    onChange={(e) => {
                      setPickQuery(e.target.value);
                      setPickPlayerId(""); // reset manual selection when typing
                    }}
                    placeholder="e.g. Patrick Mahomes, KC"
                    style={{ width: 320 }}
                  />
                </label>
                <button onClick={handleDraftPick} style={{ padding: 8 }}>Draft</button>
              </div>

              {/* suggestions */}
              {pickQuery.trim() && (
                <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Suggestions</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
                    {nameMatches.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setPickPlayerId(p.id); setPickQuery(p.displayName || p.name || ""); }}
                        style={{ textAlign: "left", padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
                      >
                        <div style={{ fontWeight: 600 }}>{p.displayName || p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>{p.team} · {p.position} · Proj {Number(p.projPoints || 0).toFixed(1)}</div>
                      </button>
                    ))}
                    {nameMatches.length === 0 && <div style={{ opacity: 0.6 }}>No matches</div>}
                  </div>
                </div>
              )}

              {/* recommended top available */}
              <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Recommended (top available)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
                  {recommendedTop.map((p) => (
                    <button
                      key={p.id}
                      onClick={async () => {
                        try {
                          await draftPick({
                            leagueId,
                            username: me,
                            playerId: p.id,
                            playerPosition: p.position,
                            slot: defaultSlotForPosition(p.position),
                          });
                        } catch (e) {
                          alert(e.message || "Draft pick failed");
                        }
                      }}
                      style={{ textAlign: "left", padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
                    >
                      <div style={{ fontWeight: 600 }}>{p.displayName || p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{p.team} · {p.position} · Proj {Number(p.projPoints || 0).toFixed(1)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p style={{ opacity: 0.7, marginTop: 12 }}>Waiting for your turn…</p>
          )
        ) : (
          <p style={{ color: "#b00" }}>
            {leagueState?.entry?.enabled
              ? "Please pay the entry fee to participate in the draft."
              : "Draft is not live yet."}
          </p>
        )}
      </div>
    );
  }

  function renderAdmin() {
    return (
      <div>
        <h3 style={{ marginTop: 0 }}>League Admin</h3>
        <LeagueAdmin isOwner={leagueState?.owner === me} league={leagueState} />
        {!hasPaidEntry(leagueState, me) && !!leagueState?.entry?.enabled && (
          <div style={{ marginTop: 12 }}>
            <EntryFeeButton league={leagueState} username={me} onPaid={() => {}} />
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <DevPanel me={me} setMe={() => {}} league={leagueState} onLeagueUpdate={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onBack} style={{ padding: 6 }}>← Back</button>
        <h2 style={{ margin: 0 }}>{leagueState?.name || "League"}</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team"  id="myteam" active={activeTab} onClick={setActiveTab} />
        <TabButton label="Players"  id="players" active={activeTab} onClick={setActiveTab} />
        <TabButton label="Draft"    id="draft"   active={activeTab} onClick={setActiveTab} />
        {leagueState?.owner === me && (
          <TabButton label="Admin"  id="admin"   active={activeTab} onClick={setActiveTab} />
        )}
      </div>

      {activeTab === "myteam" && renderMyTeam()}
      {activeTab === "players" && renderPlayers()}
      {activeTab === "draft" && renderDraft()}
      {activeTab === "admin" && leagueState?.owner === me && renderAdmin()}
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
