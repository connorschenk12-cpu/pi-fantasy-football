// src/components/DraftBoard.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  getLeagueClaims,
  listenLeagueClaims,
  ensureTeam,
  listenLeague,
  draftPick,
} from "../lib/storage";

const SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const asMap = (x) => (x instanceof Map ? x : new Map());

export default function DraftBoard({ leagueId, username }) {
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [slotByPlayer, setSlotByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [league, setLeague] = useState(null);

  useEffect(() => {
    let unsubClaims = null;
    let unsubLeague = null;

    (async () => {
      try {
        const p = await listPlayers({ leagueId });
        setPlayers(Array.isArray(p) ? p : []);

        const initial = await getLeagueClaims(leagueId);
        setClaims(asMap(initial));
        unsubClaims = listenLeagueClaims(leagueId, (map) => setClaims(asMap(map)));

        unsubLeague = listenLeague(leagueId, (l) => setLeague(l || null));

        await ensureTeam({ leagueId, username });
      } catch (e) {
        console.error(e);
        setMsg("❌ Failed to load draft board");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      unsubClaims && unsubClaims();
      unsubLeague && unsubLeague();
    };
  }, [leagueId, username]);

  const draftStatus = league?.draft?.status || "unscheduled";
  const draftingEnabled = draftStatus === "live";

  const myTurn = useMemo(() => {
    const order = league?.draft?.order || [];
    const pointer = league?.draft?.pointer ?? 0;
    return order.length > 0 && order[pointer] === username;
  }, [league, username]);

  const turnText = useMemo(() => {
    const order = league?.draft?.order || [];
    const pointer = league?.draft?.pointer ?? 0;
    const round = league?.draft?.round ?? 1;
    if (!order.length) return "Draft order not set";
    const who = order[pointer];
    return `Round ${round} — Up: ${who}`;
  }, [league]);

  const availability = useMemo(() => {
    const map = new Map();
    (players || []).forEach((p) => {
      const claim = asMap(claims).get(p.id);
      map.set(p.id, claim ? claim.claimedBy : null);
    });
    return map;
  }, [players, claims]);

  async function handleDraft(p) {
    const chosenSlot = (slotByPlayer && slotByPlayer[p.id]) || "";
    if (!chosenSlot) return setMsg("Pick a slot first.");
    const pos = String(p.position || p.pos || "").toUpperCase();
    if (!pos) return setMsg("Player is missing a position.");
    if (!myTurn) return setMsg("It's not your turn.");

    try {
      setMsg(`⏳ Drafting ${p.name || p.id} → ${chosenSlot}...`);
      await draftPick({
        leagueId,
        username,
        playerId: p.id,
        playerPosition: pos,
        slot: chosenSlot,
      });
      setMsg(`✅ Drafted ${p.name || p.id} to ${chosenSlot}`);
    } catch (e) {
      console.error(e);
      setMsg(`❌ ${e.message || "Draft failed"}`);
    }
  }

  if (loading) return <p>Loading draft board…</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Draft Board</h3>
      <p style={{ marginTop: -6, opacity: 0.8 }}>
        Draft status: <strong>{draftStatus}</strong>
        {!draftingEnabled && " — drafting is disabled until the draft is LIVE"}
      </p>
      <p style={{ marginTop: -6, opacity: 0.8 }}>
        {turnText}
        {myTurn ? " — Your turn" : ""}
      </p>
      {msg && <p>{msg}</p>}

      {!players.length ? (
        <p>
          No players found. Add to global <code>players</code> or{" "}
          <code>leagues/{leagueId}/players</code>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {players.map((p) => {
            const pos = p.position || p.pos || "";
            const claimedBy = availability.get(p.id);
            const mine = claimedBy && claimedBy === username;

            return (
              <li
                key={p.id}
                style={{
                  padding: 10,
                  marginBottom: 8,
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  background: mine ? "#eefbf0" : claimedBy ? "#f8f9fb" : "#fff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong>{p.name || p.id}</strong>{" "}
                    <span style={{ opacity: 0.7 }}>
                      ({String(pos).toUpperCase()}
                      {p.team ? ` – ${p.team}` : ""})
                    </span>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {claimedBy
                        ? mine
                          ? "You drafted this player"
                          : `Drafted by ${claimedBy}`
                        : "Available"}
                    </div>
                  </div>

                  {!claimedBy && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={(slotByPlayer && slotByPlayer[p.id]) || ""}
                        onChange={(e) =>
                          setSlotByPlayer((s) => ({ ...(s || {}), [p.id]: e.target.value }))
                        }
                        style={{ padding: 8 }}
                        disabled={!draftingEnabled || !myTurn}
                      >
                        <option value="">
                          {draftingEnabled
                            ? myTurn
                              ? "Select slot"
                              : "Waiting for your turn"
                            : `Draft ${draftStatus}`}
                        </option>
                        {SLOTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleDraft(p)}
                        style={{ padding: 8 }}
                        disabled={!draftingEnabled || !myTurn}
                      >
                        Draft
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
