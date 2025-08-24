/* eslint-disable no-console */
import React, { useState } from "react";
import { writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

// IMPORTANT: This path is correct from src/components/*
import players from "../data/players";

/**
 * Seeds players into Firestore:
 *  - global:   players/{playerId}
 *  - league:   leagues/{leagueId}/players/{playerId}  (optional box)
 *
 * Props:
 *  - leagueId (optional but recommended)
 */
export default function ProjectionsSeeder({ leagueId }) {
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(500);
  const [writeLeagueScope, setWriteLeagueScope] = useState(true);

  const onSeed = async () => {
    try {
      if (!Array.isArray(players) || players.length === 0) {
        return setStatus("No local players found in src/data/players.js");
      }
      setStatus("Seeding…");

      // write in chunks to avoid 500-limit per batch
      const chunkSize = 450;
      const toWrite = players.slice(0, Number(limit) || players.length);

      for (let i = 0; i < toWrite.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = toWrite.slice(i, i + chunkSize);
        slice.forEach((p) => {
          const id = String(p.id || p.playerId || p.srid || p.key || "").trim();
          if (!id) return;

          const base = {
            id,
            name: p.name || p.fullName || p.playerName || String(id),
            position: p.position || "",
            team: p.team || "",
            projections: p.projections || p.projByWeek || {},
            matchups: p.matchups || {},
            updatedAt: serverTimestamp(),
          };

          // global doc
          batch.set(doc(db, "players", id), base, { merge: true });

          // league-scoped doc (if chosen and league provided)
          if (writeLeagueScope && leagueId) {
            batch.set(doc(db, "leagues", leagueId, "players", id), base, { merge: true });
          }
        });
        await batch.commit();
      }

      setStatus(`Seeded ${toWrite.length} players${writeLeagueScope && leagueId ? " (global + league)" : " (global only)"}.`);
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
    }
  };

  return (
    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
      <h4>Seed Players</h4>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
        Loads players from <code>src/data/players.js</code> into Firestore.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label>
          Limit:{" "}
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            style={{ width: 90 }}
          />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={writeLeagueScope}
            onChange={(e) => setWriteLeagueScope(e.target.checked)}
          />
          Also write to this league’s players collection
        </label>
      </div>

      <button onClick={onSeed}>
        Seed {limit} players {writeLeagueScope && leagueId ? "(global + league)" : "(global only)"}
      </button>

      <div style={{ marginTop: 8, color: status.startsWith("Error") ? "#b22" : "#444" }}>
        {status || "Idle"}
      </div>
    </div>
  );
}
