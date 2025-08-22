/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { listPlayers, projForWeek } from "../lib/storage";

/**
 * Props:
 * - leagueId (string)
 * - currentWeek (number)   // used for projections sort
 * - onDraft(player)        // optional: for DraftBoard, shows Draft button
 * - allowDraftButton (bool)
 */
export default function PlayersList({
  leagueId,
  currentWeek = 1,
  onDraft,
  allowDraftButton = false,
}) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const list = await listPlayers({ leagueId });
        if (!alive) return;
        setPlayers(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("PlayersList load error:", e);
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const filtered = useMemo(() => {
    let arr = Array.isArray(players) ? players.slice() : [];

    // Basic sanitization: ensure we can read name/position/team safely
    arr = arr.map((p) => ({
      id: p?.id ?? "",
      name: (p?.name ?? "").toString(),
      position: (p?.position ?? "").toString().toUpperCase(),
      team: (p?.team ?? "").toString().toUpperCase(),
      projections: p?.projections ?? p?.projByWeek ?? {},
      ...p,
    }));

    // Text search by name (fallback to id)
    const needle = (q || "").toString().trim().toLowerCase();
    if (needle) {
      arr = arr.filter((p) => {
        const hay1 = p.name ? p.name.toLowerCase() : "";
        const hay2 = p.id ? String(p.id).toLowerCase() : "";
        return hay1.indexOf(needle) >= 0 || hay2.indexOf(needle) >= 0;
      });
    }

    // Position filter
    const pf = (posFilter || "ALL").toUpperCase();
    if (pf !== "ALL") {
      arr = arr.filter((p) => p.position === pf);
    }

    // Team filter
    const tf = (teamFilter || "ALL").toUpperCase();
    if (tf !== "ALL") {
      arr = arr.filter((p) => p.team === tf);
    }

    // Sort by projected points (desc) for currentWeek
    arr.sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));
    return arr;
  }, [players, q, posFilter, teamFilter, currentWeek]);

  const uniqueTeams = useMemo(() => {
    const set = new Set();
    for (const p of players) {
      const t = (p?.team ?? "").toString().toUpperCase();
      if (t) set.add(t);
    }
    return ["ALL", ...Array.from(set).sort()];
  }, [players]);

  const positions = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

  return (
    <div>
      <h3>Players</h3>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search player name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)} style={{ padding: 8 }}>
          {positions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ padding: 8 }}>
          {uniqueTeams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading && <div>Loading players…</div>}
      {!loading && error && <div style={{ color: "red" }}>Error: {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div>
          No players found. Make sure you’ve added data to:
          <code> /players </code> (global) or <code> /leagues/{leagueId}/players</code> (league-scoped).
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {filtered.map((p) => {
            const proj = projForWeek(p, currentWeek);
            return (
              <li key={p.id} style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.name || p.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {p.position || "N/A"} · {p.team || "N/A"} · Proj W{currentWeek}: {proj}
                  </div>
                </div>
                {allowDraftButton && typeof onDraft === "function" && (
                  <button onClick={() => onDraft(p)} style={{ padding: "6px 10px" }}>
                    Draft
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
