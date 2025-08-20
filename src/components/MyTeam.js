import React, { useEffect, useMemo, useState } from "react";
import { ensureTeam, getTeam, setRosterSlot } from "../lib/storage";
import { PLAYERS } from "../data/players";

const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

function optionsForSlot(slot) {
  const S = slot.toUpperCase();
  if (S === "FLEX") return PLAYERS.filter(p => ["RB","WR","TE"].includes(p.pos));
  return PLAYERS.filter(p => p.pos === S);
}

export default function MyTeam({ leagueId, username, onBack }) {
  const [team, setTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const roster = useMemo(() => team?.roster || {}, [team]);

  useEffect(() => {
    (async () => {
      await ensureTeam({ leagueId, username });
      const t = await getTeam({ leagueId, username });
      setTeam(t);
    })();
  }, [leagueId, username]);

  async function handleSet(slot, playerId) {
    setSaving(true);
    try {
      const updated = await setRosterSlot({ leagueId, username, slot, playerId });
      setTeam(updated);
    } catch (e) {
      alert("Failed to save slot");
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
            <div key={slot} style={{ display: "grid", gap: 6 }}>
              <label><strong>{slot}</strong></label>
              <select
                value={roster[slot] || ""}
                onChange={(e) => handleSet(slot, e.target.value || null)}
                disabled={saving}
                style={{ padding: 10 }}
              >
                <option value="">{saving ? "Saving…" : "— Select —"}</option>
                {optionsForSlot(slot).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.pos})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
