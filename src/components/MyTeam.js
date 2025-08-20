import React, { useEffect, useMemo, useState } from "react";
import { ensureTeam, listenTeam, releasePlayerAndClearSlot } from "../lib/storage";
import { PLAYERS } from "../data/players";

const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

// Defensive helpers
const isObj = (x) => x && typeof x === "object";
function safeText(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  try { return JSON.stringify(x); } catch { return String(x); }
}

// Accepts either a string playerId OR an object { id, name, pos/position }
function playerLabel(slotValue) {
  if (!slotValue) return "— empty —";

  // If the slot stored a full player object:
  if (isObj(slotValue)) {
    const id = slotValue.id || slotValue.playerId || "";
    const name = slotValue.name || "";
    const pos = slotValue.pos || slotValue.position || "";
    if (name && pos) return `${name} (${pos})`;
    if (name) return name;
    if (id) return safeText(id);
    return safeText(slotValue);
  }

  // If the slot stored a string id:
  const id = String(slotValue);
  const found = (PLAYERS || []).find((p) => p.id === id);
  if (found) return `${found.name} (${found.pos || found.position || "?"})`;
  return id; // fallback to raw id
}

export default function MyTeam({ leagueId, username, onBack }) {
  const [team, setTeam] = useState(null);
  const [saving, setSaving] = useState(false);

  // Always coerce roster to an object with our expected keys
  const roster = useMemo(() => {
    const r = (team && team.roster) || {};
    const out = {};
    SLOT_ORDER.forEach((k) => { out[k] = r[k] ?? null; });
    return out;
  }, [team]);

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({ leagueId, username, onChange: (t) => {
          // Extra guard: if someone accidentally wrote an array into roster, normalize.
          if (t && (Array.isArray(t.roster) || typeof t.roster !== "object")) {
            t = { ...t, roster: {} };
          }
          setTeam(t);
        }});
      } catch (e) {
        console.error("Team listener error:", e);
        alert(
          e?.message?.toLowerCase().includes("offline")
            ? "You're offline or Firestore was blocked. Retrying when the network returns."
            : "Failed to load your team."
        );
      }
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  async function handleRemove(slot) {
    const current = roster[String(slot).toUpperCase()];
    if (!current) return;

    // Handle either object or string
    const playerId = isObj(current) ? (current.id || current.playerId || "") : String(current);
    if (!playerId) return;

    setSaving(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId, slot });
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to release player");
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

      {/* Tiny debug panel to help if this ever breaks again */}
      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        <div><strong>leagueId:</strong> {safeText(leagueId)}</div>
        <div><strong>username:</strong> {safeText(username)}</div>
        {team && <div><strong>team doc keys:</strong> {Object.keys(team).join(", ")}</div>}
      </div>
    </div>
  );
}
