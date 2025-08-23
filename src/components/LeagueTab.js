/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { listenLeague, listTeams, ROSTER_SLOTS } from "../../lib/storage";
import PlayerName from "../PlayerName";

/**
 * This is a safe, minimal League tab that:
 * - lists teams with W/L (if standings exist)
 * - shows each team’s starters with real names (via PlayerName)
 * It intentionally avoids schedule/admin logic so it won’t crash.
 */
export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());

  // league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // teams
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const t = await listTeams(leagueId);
        if (!mounted) return;
        setTeams(t || []);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // players map
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { listPlayers } = await import("../../lib/storage");
        const arr = await listPlayers({ leagueId });
        if (!mounted) return;
        const m = new Map();
        arr.forEach((p) => m.set(p.id, p));
        setPlayersMap(m);
      } catch (e) {
        console.error("load players in LeagueTab:", e);
        setPlayersMap(new Map());
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  return (
    <div>
      <h3>League</h3>
      {league?.standings ? (
        <p style={{ marginTop: 0 }}>
          Teams: {Object.keys(league.standings).length}
        </p>
      ) : null}

      {teams.length === 0 ? (
        <p>No teams yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {teams.map((t) => (
            <div key={t.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{t.name || t.id}</strong>
                <span style={{ opacity: 0.8 }}>
                  {league?.standings?.[t.id]
                    ? `W-L: ${league.standings[t.id].wins}-${league.standings[t.id].losses}`
                    : ""}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <em>Starters:</em>
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0 0" }}>
                  {ROSTER_SLOTS.map((slot) => (
                    <li key={slot}>
                      <b style={{ width: 40, display: "inline-block" }}>{slot}</b>{" "}
                      <PlayerName id={t?.roster?.[slot]} playersMap={playersMap} fallback="(empty)" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
