/* eslint-disable no-console */
import React, { useState } from "react";
import { writeBatch, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import players from "../data/players";

/**
 * Only patches the `name` field (and position/team if present) for existing player ids.
 */
export default function SeedNamesFromLocal({ leagueId }) {
  const [status, setStatus] = useState("");

  const onPatch = async () => {
    try {
      if (!Array.isArray(players) || players.length === 0) {
        return setStatus("No local players found in src/data/players.js");
      }
      setStatus("Patching names…");

      const chunkSize = 450;
      for (let i = 0; i < players.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = players.slice(i, i + chunkSize);

        slice.forEach((p) => {
          const id = String(p.id || p.playerId || p.srid || p.key || "").trim();
          if (!id) return;

          const patch = {
            name: p.name || p.fullName || p.playerName || String(id),
          };
          if (p.position) patch.position = p.position;
          if (p.team) patch.team = p.team;

          batch.set(doc(db, "players", id), patch, { merge: true });
          if (leagueId) {
            batch.set(doc(db, "leagues", leagueId, "players", id), patch, { merge: true });
          }
        });

        await batch.commit();
      }

      setStatus("Patched player names.");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  return (
    <div style={{ padding: 10, border: "1px dashed #ccc", borderRadius: 6, marginTop: 10 }}>
      <button onClick={onPatch}>Patch Names from Local Dataset</button>
      <div style={{ marginTop: 6 }}>{status}</div>
    </div>
  );
}
