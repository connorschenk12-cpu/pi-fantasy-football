import React, { useEffect, useMemo, useState } from "react";
import { ensureTeam, listenTeam, releasePlayerAndClearSlot } from "../lib/storage";
import { PLAYERS } from "../data/players";

const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

function playerLabel(id) {
  if (!id) return "— empty —";
  const found = PLAYERS.find((p) => p.id === id);
  return found ? `${found.name} (${found.pos || found.position})` : id;
}

export default function MyTeam({ leagueId, username, onBack }) {
  const [team, setTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const roster = useMemo(() => team?.roster || {}, [team]);

 // inside MyTeam.js
useEffect(() => {
  let unsub = null;
  (async () => {
    try {
      await ensureTeam({ leagueId, username });
      unsub = listenTeam({ leagueId, username, onChange: setTeam });
    } catch (e) {
      console.error("Team listener error:", e);
      alert(
        e?.message?.includes("offline")
          ? "You're offline or Firestore was blocked. Retrying when the network returns."
          : "Failed to load your team."
      );
    }
  })();
  return () => unsub && unsub();
}, [leagueId, username]);


  async function handleRemove(slot) {
    const playerId = roster[String(slot).toUpperCase()];
    if (!playerId) return;
    setSaving(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId, slot });
    } catch (e) {
      alert(e.message || "Failed to release player");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={onBack} style={{ marginBottom: 12, padding: 8 }}>
        ← Back
      </button>

      <h3>My Team</h3>
      {!team ? (
        <p>Loading team…</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {SLOT_ORDER.map((slot) => (
            <div key={slot} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 60 }}><strong>{slot}</strong></div>
              <div style={{ flex: 1 }}>{playerLabel(roster[slot])}</div>
              <button
                onClick={() => handleRemove(slot)}
                disabled={!roster[slot] || saving}
                style={{ padding: 8 }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
