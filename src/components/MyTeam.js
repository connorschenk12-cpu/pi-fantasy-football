// src/components/MyTeam.js
import React, { useEffect, useMemo, useState } from "react";
import { ensureTeam, listenTeam, releasePlayerAndClearSlot } from "../lib/storage";
import { db } from "../lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";

const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

// Small helpers
const isObj = (x) => x && typeof x === "object";
const toUpper = (s) => String(s || "").toUpperCase();

export default function MyTeam({ leagueId, username, onBack }) {
  const [team, setTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [playersMap, setPlayersMap] = useState({}); // id -> {name, position, team}

  // Live: load players into a lookup map
  useEffect(() => {
    // listener to global players
    const unsubGlobal = onSnapshot(collection(db, "players"), (qs) => {
      const map = {};
      qs.forEach((d) => {
        const data = d.data() || {};
        map[d.id] = {
          id: d.id,
          name: data.name || "",
          position: data.position || data.pos || "",
          team: data.team || "",
        };
      });
      setPlayersMap((prev) => ({ ...prev, ...map }));
    });

    // listener to league-scoped players (if you start using that later)
    const unsubLeague = onSnapshot(
      collection(db, "leagues", leagueId, "players"),
      (qs) => {
        // if the subcollection doesn't exist yet, Firestore just returns empty
        const map = {};
        qs.forEach((d) => {
          const data = d.data() || {};
          map[d.id] = {
            id: d.id,
            name: data.name || "",
            position: data.position || data.pos || "",
            team: data.team || "",
          };
        });
        // league players override global if same id appears
        setPlayersMap((prev) => ({ ...prev, ...map }));
      },
      // ignore failures silently; global still works
      () => {}
    );

    return () => {
      unsubGlobal && unsubGlobal();
      unsubLeague && unsubLeague();
    };
  }, [leagueId]);

  // Live: ensure team exists and listen to it
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        await ensureTeam({ leagueId, username });
        unsub = listenTeam({
          leagueId,
          username,
          onChange: (t) => {
            // normalize shape
            if (!t || typeof t !== "object") return setTeam(null);
            const roster = t.roster && typeof t.roster === "object" ? t.roster : {};
            const normalized = {};
            SLOT_ORDER.forEach((k) => (normalized[k] = roster[k] ?? null));
            setTeam({ ...t, roster: normalized });
          },
        });
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

  const roster = useMemo(() => (team?.roster ? team.roster : {}), [team]);

  // Resolve a roster slot value (id or object) to a label
  function renderSlotLabel(slotValue) {
    if (!slotValue) return "— empty —";

    // If someone stored an object in the slot, try to read its fields
    if (isObj(slotValue)) {
      const id = slotValue.id || slotValue.playerId || "";
      const name = slotValue.name || "";
      const pos = slotValue.pos || slotValue.position || "";
      const team = slotValue.team || "";
      if (name) return `${name}${pos ? ` (${pos})` : ""}${team ? ` – ${team}` : ""}`;
      if (id && playersMap[id]) {
        const p = playersMap[id];
        return `${p.name}${p.position ? ` (${p.position})` : ""}${p.team ? ` – ${p.team}` : ""}`;
      }
      return id || "—";
    }

    // If the slot stores a string id
    const id = String(slotValue);
    const p = playersMap[id];
    if (!p) return id; // fallback if not found (should be rare)
    return `${p.name}${p.position ? ` (${p.position})` : ""}${p.team ? ` – ${p.team}` : ""}`;
  }

  async function handleRemove(slot) {
    const upper = toUpper(slot);
    const current = roster[upper];
    if (!current) return;

    const playerId = isObj(current) ? (current.id || current.playerId || "") : String(current);
    if (!playerId) return;

    setSaving(true);
    try {
      await releasePlayerAndClearSlot({ leagueId, username, playerId, slot: upper });
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
              <div style={{ flex: 1 }}>{renderSlotLabel(roster[slot])}</div>
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

      {/* Tiny debug */}
      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        <div><strong>leagueId:</strong> {leagueId}</div>
        <div><strong>username:</strong> {username}</div>
        {team && <div><strong>team doc keys:</strong> {Object.keys(team).join(", ")}</div>}
        <div><strong>players loaded:</strong> {Object.keys(playersMap).length}</div>
      </div>
    </div>
  );
}
