// src/components/PlayersList.js
import React, { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";

export default function PlayersList() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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

  if (loading) return <p>Loading players…</p>;
  if (err) return <p style={{ color: "#b00" }}>❌ {err}</p>;
  if (!players.length) {
    return (
      <div style={{ marginTop: 12 }}>
        <h3>Available Players</h3>
        <p>No players found in Firestore <code>players</code> collection.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <h3>Available Players ({players.length})</h3>
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
