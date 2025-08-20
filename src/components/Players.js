// src/components/Players.js
import React, { useEffect, useState } from "react";
import { listPlayers } from "../lib/storage";

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await listPlayers();
        setPlayers(data);
      } catch (err) {
        console.error("Error loading players:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p>Loading players...</p>;

  return (
    <div>
      <h2>Available Players</h2>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            {p.name} — {p.position} ({p.team})
          </li>
        ))}
      </ul>
    </div>
  );
}
