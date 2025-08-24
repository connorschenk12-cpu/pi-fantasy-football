/* eslint-disable no-console */
// src/components/ProjectionsSeeder.js
import React, { useState } from "react";
import { doc, setDoc, writeBatch, collection } from "firebase/firestore";
import { db } from "../lib/firebase";
import players from "../data/players"; // ✅ correct path (one "..")

/**
 * Props:
 * - leagueId (optional): if provided, enables "Seed to League" button
 *
 * Usage:
 * <ProjectionsSeeder leagueId={leagueId} />
 */
export default function ProjectionsSeeder({ leagueId }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function seedGlobal() {
    try {
      setBusy(true);
      setMsg("Seeding global players…");
      const batch = writeBatch(db);

      players.forEach((p) => {
        // minimal normalization (ensure id is string, keep name/position/team/projections)
        const id = String(p.id);
        const data = {
          id,
          name: p.name || p.fullName || `Player ${id}`,
          position: p.position || "",
          team: p.team || "",
          projections: p.projections || {},
          matchups: p.matchups || {}, // keep if present
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, "players", id), data, { merge: true });
      });

      await batch.commit();
      setMsg(`Seeded ${players.length} players to global collection.`);
    } catch (e) {
      console.error(e);
      setMsg(`Error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function seedLeague() {
    if (!leagueId) {
      setMsg("No leagueId provided.");
      return;
    }
    try {
      setBusy(true);
      setMsg(`Seeding players to league ${leagueId}…`);
      const col = collection(db, "leagues", leagueId, "players");
      const batch = writeBatch(db);

      players.forEach((p) => {
        const id = String(p.id);
        const data = {
          id,
          name: p.name || p.fullName || `Player ${id}`,
          position: p.position || "",
          team: p.team || "",
          projections: p.projections || {},
          matchups: p.matchups || {},
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(col, id), data, { merge: true });
      });

      await batch.commit();
      setMsg(`Seeded ${players.length} players to league ${leagueId}.`);
    } catch (e) {
      console.error(e);
      setMsg(`Error: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
      <h3>Players / Projections Seeder</h3>
      <p style={{ marginTop: 0 }}>
        Use this to (re)seed player docs with names, positions, teams, and projections.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={seedGlobal} disabled={busy}>
          {busy ? "Working…" : "Seed Global Players"}
        </button>
        {leagueId && (
          <button onClick={seedLeague} disabled={busy}>
            {busy ? "Working…" : `Seed Players to League (${leagueId})`}
          </button>
        )}
      </div>
      {msg && <div style={{ marginTop: 8, color: "#555" }}>{msg}</div>}
    </div>
  );
}
