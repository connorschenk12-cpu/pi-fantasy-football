import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, getLeagueClaims, listenLeagueClaims } from "../lib/storage";

const asMap = (x) => (x instanceof Map ? x : new Map());

export default function PlayersList({ leagueId }) {
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        const p = await listPlayers({ leagueId });
        setPlayers(Array.isArray(p) ? p : []);
        const c = await getLeagueClaims(leagueId);
        setClaims(asMap(c));
        unsub = listenLeagueClaims(leagueId, (map) => setClaims(asMap(map)));
      } finally {
        setLoading(false);
      }
    })();
    return () => unsub && unsub();
  }, [leagueId]);

  const availability = useMemo(() => {
    const map = new Map();
    (players || []).forEach((p) => {
      const claim = asMap(claims).get(p.id);
      map.set(p.id, claim ? claim.claimedBy : null);
    });
    return map;
  }, [players, claims]);

  if (loading) return <p>Loading players…</p>;

  if (!players.length) {
    return (
      <p>
        No players found. Add to global <code>players</code> or{" "}
        <code>leagues/{leagueId}/players</code>.
      </p>
    );
  }

  return (
    <div>
      <h3>Available Players</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {players.map((p) => {
          const pos = String(p.position || p.pos || "").toUpperCase();
          const claimedBy = availability.get(p.id);
          return (
            <li key={p.id} style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 8 }}>
              <strong>{p.name || p.id}</strong>{" "}
              <span style={{ opacity: 0.7 }}>
                ({pos}{p.team ? ` – ${p.team}` : ""})
              </span>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {claimedBy ? `Drafted by ${claimedBy}` : "Available"}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
