import React, { useEffect, useMemo, useState } from "react";
import { listenTeam, listPlayers, releasePlayerAndClearSlot } from "../lib/storage";

const ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

export default function MyTeam({ leagueId, username }) {
  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    const unsub = listenTeam({ leagueId, username, onChange: setTeam });
    (async () => {
      const p = await listPlayers({ leagueId });
      setPlayers(p || []);
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  const byId = useMemo(() => {
    const m = new Map();
    (players || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  if (!team) return <p>Loading my team…</p>;

  const roster = team.roster || {};

  return (
    <div>
      <h3>My Team</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {ORDER.map((slot) => {
          const id = roster[slot] || null;
          const player = id ? byId.get(id) : null;

          return (
            <li key={slot} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 60, fontWeight: 700 }}>{slot}</div>
              <div style={{ flex: 1 }}>
                {player ? (
                  <>
                    <strong>{player.name || player.id}</strong>{" "}
                    <span style={{ opacity: 0.7 }}>
                      ({String(player.position || "").toUpperCase()}
                      {player.team ? ` – ${player.team}` : ""})
                    </span>
                  </>
                ) : (
                  <span style={{ opacity: 0.6 }}>Empty</span>
                )}
              </div>
              {player && (
                <button
                  onClick={async () => {
                    try {
                      await releasePlayerAndClearSlot({ leagueId, username, playerId: player.id, slot });
                    } catch (e) {
                      alert(e.message || "Failed to release");
                    }
                  }}
                  style={{ padding: 6 }}
                >
                  Release
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
