// src/components/PlayersList.js
import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { getApp } from "firebase/app";
import { collection, onSnapshot, getDocs } from "firebase/firestore";

export default function PlayersList({ leagueId }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [debug, setDebug] = useState({ projectId: "", globalCount: 0, leagueCount: null });

  useEffect(() => {
    const app = getApp();
    const projectId = app.options?.projectId || "(unknown)";

    (async () => {
      try {
        // Count global players once
        const globalSnap = await getDocs(collection(db, "players"));
        const globalCount = globalSnap.size;

        // Count league-scoped players if leagueId was provided
        let leagueCount = null;
        if (leagueId) {
          const leagueSnap = await getDocs(collection(db, "leagues", leagueId, "players"));
          leagueCount = leagueSnap.size;
        }
        setDebug({ projectId, globalCount, leagueCount });
      } catch (e) {
        // ignore counting errors
      }
    })();
  }, [leagueId]);

  useEffect(() => {
    // Live listener to the global "players" collection
    const colRef = collection(db, "players");
    const unsub = onSnapshot(
      colRef,
      (qs) => {
        const rows = qs.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || "",
            position: data.position || data.pos || "",
            team: data.team || "",
          };
        });
        setPlayers(rows);
        setErr("");
        setLoading(false);
      },
      (error) => {
        console.error("PlayersList listener error:", error);
        setErr(error?.message || "Failed to load players");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return (
    <div style={{ marginTop: 12 }}>
      <h3>Available Players {loading ? "" : `(${players.length})`}</h3>

      {/* Tiny debug panel so you can verify you're on the right Firebase project */}
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
        <div><strong>projectId:</strong> {debug.projectId}</div>
        <div><strong>global players:</strong> {debug.globalCount}</div>
        {debug.leagueCount !== null && (
          <div><strong>leagues/{leagueId}/players:</strong> {debug.leagueCount}</div>
        )}
      </div>

      {loading && <p>Loading players…</p>}
      {err && <p style={{ color: "#b00" }}>❌ {err}</p>}

      {!loading && !err && players.length === 0 && (
        <p>No players found in global <code>players</code> collection.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {players.map((p) => (
          <li
            key={p.id}
            style={{
              padding: 10,
              marginBottom: 8,
              border: "1px solid #ddd",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <strong>{p.name || p.id}</strong>{" "}
            <span style={{ opacity: 0.7 }}>
              ({p.position || "?"}{p.team ? ` – ${p.team}` : ""})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
