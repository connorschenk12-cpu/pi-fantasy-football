import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, getLeagueClaims, addDropPlayer, fetchProjections, fetchNextGames } from "../lib/storage";
import { computeFantasyPoints, DEFAULT_SCORING } from "../lib/scoring";

export default function PlayersList({ leagueId, username }) {
  const [players, setPlayers] = useState([]);
  const [claims, setClaims] = useState(new Map());
  const [projections, setProjections] = useState({});
  const [nextGames, setNextGames] = useState({});
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const p = await listPlayers({ leagueId });
      setPlayers(p || []);
      const c = await getLeagueClaims(leagueId);
      setClaims(c || new Map());
      const week = 1; // could read league currentWeek if passed
      setProjections(await fetchProjections(week));
      setNextGames(await fetchNextGames());
    })();
  }, [leagueId]);

  const byId = useMemo(() => {
    const m = new Map(); players.forEach(p => m.set(p.id, p)); return m;
  }, [players]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter(p => (filter === "ALL" || p.position === filter))
      .filter(p => (q ? (p.displayName || p.name || "").toLowerCase().includes(q) : true))
      .map(p => {
        const proj = projections[p.id] || null;
        const opp = p.position === "DEF" ? "" : (nextGames[p.team]?.opponent || "");
        const oppText = p.position === "DEF"
          ? (nextGames[p.team]?.opponent ? `vs ${nextGames[p.team]?.opponent}` : "")
          : (opp ? `@ ${opp === p.team ? "??" : opp}` : "");
        const kickoff = nextGames[p.team]?.kickoff ? new Date(nextGames[p.team].kickoff).toLocaleString() : "";
        const points = proj ? computeFantasyPoints(proj, DEFAULT_SCORING) : 0;
        return { ...p, points, oppText, kickoff };
      })
      .sort((a, b) => b.points - a.points);
  }, [players, filter, search, projections, nextGames]);

  async function handleAdd(p) {
    try {
      await addDropPlayer({ leagueId, username, addId: p.id, dropId: null });
      alert(`Added ${p.displayName || p.name}`);
    } catch (e) {
      alert(e.message || "Failed to add");
    }
  }

  function newsUrl(p) {
    const nm = encodeURIComponent((p.displayName || p.name || "").trim());
    return `/news?name=${nm}`; // handled by PlayerNews route below (or use modal)
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {["ALL","QB","RB","WR","TE","K","DEF"].map(pos => (
          <button key={pos} onClick={() => setFilter(pos)} style={{ padding: 6, fontWeight: filter===pos?700:400 }}>{pos}</button>
        ))}
        <input placeholder="Search player…" value={search} onChange={(e)=>setSearch(e.target.value)} style={{ padding: 6, flex: 1, minWidth: 180 }} />
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((p) => {
          const isClaimed = claims.has(p.id);
          return (
            <li key={p.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.displayName || p.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{p.team} · {p.position} {p.bye ? `· Bye ${p.bye}` : ""}</div>
                  <div style={{ fontSize: 12 }}>{p.oppText} {p.kickoff ? `· ${p.kickoff}` : ""}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{p.points.toFixed(1)}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href={newsUrl(p)} style={{ textDecoration: "none" }}>📰 News</a>
                  <button disabled={isClaimed} onClick={() => handleAdd(p)} style={{ padding: 6 }}>
                    {isClaimed ? "Taken" : "Add"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && <p>No players found (try syncing players and refreshing).</p>}
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
        Projections & schedule via Sleeper; headlines via Google News RSS.
      </p>
    </div>
  );
}
