// src/components/Players.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listPlayers,
  getLeagueClaims,
  listenLeagueClaims,
  claimPlayerAndAssignSlot,
} from "../lib/storage";

const SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const asMap = (x) => (x instanceof Map ? x : new Map());

export default function Players({ leagueId, username }) {
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [slotByPlayer, setSlotByPlayer] = useState({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        // Load players (league-scoped first, fallback to global)
        const p = await listPlayers({ leagueId });
        setPlayers(Array.isArray(p) ? p : []);
        // Initial claims + live updates
        const initial = await getLeagueClaims(leagueId);
        setClaims(asMap(initial));
        unsub = listenLeagueClaims(leagueId, (map) => setClaims(asMap(map)));
      } catch (e) {
        console.error(e);
        setMsg("❌ Failed to load players/claims");
      } finally {
        setLoading(false);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  const availability = useMemo(() => {
    const map = new Map();
    (players || []).forEach((p) => {
      const claim = asMap(claims).get(p.id);
      map.set(p.id, claim ? claim.claimedBy : null);
    });
    return map;
  }, [players, claims]);

  async function handleClaim(p) {
    const slot = (slotByPlayer && slotByPlayer[p.id]) || "";
    if (!slot) return setMsg("Pick a slot first.");
    try {
      setMsg(`⏳ Claiming ${p.name} to ${slot}...`);
      await claimPlayerAndAssignSlot({
        leagueId,
        username,
        playerId: p.id,
        slot,
      });
      setMsg(`✅ Added ${p.name} to ${slot}`);
    } catch (e) {
      console.error(e);
      setMsg(`❌ ${e.message || "Could not claim player"}`);
    }
  }

  if (loading) return <p>Loading players…</p>;

  if (!players.length) {
    return (
      <div style={{ marginTop: 16 }}>
        <h3>Available Players</h3>
        <p>No players found. Add players to Firestore:
          <code> leagues/{leagueId}/players </code> or global <code>players</code>.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Available Players</h3>
      {msg && <p>{msg}</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {players.map((p) => {
          const position = p.position || p.pos || "";
          const claimedBy = availability.get(p.id) || null;
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <strong>{p.name || p.id}</strong>{" "}
                  <span style={{ opacity: 0.7 }}>({position})</span>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {claimedBy ? (mine ? "You own this player" : `Claimed by ${claimedBy}`) : "Available"}
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
                    >
                      <option value="">Select slot</option>
                      {SLOTS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button onClick={() => handleClaim(p)} style={{ padding: 8 }}>
                      Add to Team
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
