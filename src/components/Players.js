import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, getLeagueClaims, claimPlayerAndAssignSlot, listenLeagueClaims } from "../lib/storage";

const SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

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
        const p = await listPlayers();
        setPlayers(p);
        // initial claims pull + subscribe for live updates
        const initial = await getLeagueClaims(leagueId);
        setClaims(initial);
        unsub = listenLeagueClaims(leagueId, (map) => setClaims(map));
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
    players.forEach((p) => {
      const claim = claims.get(p.id);
      map.set(p.id, claim ? claim.claimedBy : null);
    });
    return map;
  }, [players, claims]);

  async function handleClaim(p) {
    const slot = slotByPlayer[p.id] || "";
    if (!slot) return setMsg("Pick a slot first.");
    try {
      setMsg(`⏳ Claiming ${p.name} to ${slot}...`);
      await claimPlayerAndAssignSlot({ leagueId, username, playerId: p.id, slot });
      setMsg(`✅ Added ${p.name} to ${slot}`);
    } catch (e) {
      console.error(e);
      setMsg(`❌ ${e.message || "Could not claim player"}`);
    }
  }

  if (loading) return <p>Loading players…</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Available Players</h3>
      {msg && <p>{msg}</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {players.map((p) => {
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <strong>{p.name}</strong> <span style={{ opacity: 0.7 }}>({p.position || p.pos})</span>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {claimedBy ? (mine ? "You own this player" : `Claimed by ${claimedBy}`) : "Available"}
                  </div>
                </div>

                {!claimedBy && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      value={slotByPlayer[p.id] || ""}
                      onChange={(e) => setSlotByPlayer((s) => ({ ...s, [p.id]: e.target.value }))}
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
