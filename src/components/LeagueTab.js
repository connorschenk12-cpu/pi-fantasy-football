/* eslint-disable no-console */
// src/components/LeagueTab.js
import React, { useEffect, useMemo, useState } from "react";
import { listTeams, listPlayers } from "../lib/storage";

export default function LeagueTab({ leagueId, playersById: externalMap }) {
  const [teams, setTeams] = useState([]);
  const [playersById, setPlayersById] = useState(externalMap || {});
  const [expanded, setExpanded] = useState(null); // username of expanded team

  // Load teams
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!leagueId) return;
        const t = await listTeams(leagueId);
        if (!mounted) return;
        setTeams(t);
      } catch (e) {
        console.error("listTeams error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId]);

  // If player map not provided, fetch
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (externalMap && Object.keys(externalMap).length) return;
        if (!leagueId) return;
        const all = await listPlayers({ leagueId });
        if (!mounted) return;
        const map = {};
        for (const p of all) map[p.id] = p;
        setPlayersById(map);
      } catch (e) {
        console.error("LeagueTab load players error:", e);
      }
    })();
    return () => { mounted = false; };
  }, [leagueId, externalMap]);

  const sorted = useMemo(() => {
    // Sort by win %, then wins desc, losses asc, then owner asc
    const copy = [...teams];
    copy.sort((a, b) => {
      const aw = Number(a.wins || 0), al = Number(a.losses || 0);
      const bw = Number(b.wins || 0), bl = Number(b.losses || 0);
      const aPct = aw + al > 0 ? aw / (aw + al) : 0;
      const bPct = bw + bl > 0 ? bw / (bw + bl) : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (bw !== aw) return bw - aw;
      if (al !== bl) return al - bl;
      return String(a.owner || a.id).localeCompare(String(b.owner || b.id));
    });
    return copy;
  }, [teams]);

  const labelOf = (playerId) => {
    if (!playerId) return "(empty)";
    const p = playersById[playerId];
    if (!p) return playerId;
    const name = p.name || p.fullName || playerId;
    const pos = p.position || p.pos || "";
    const tm = p.team || p.teamAbbr || p.nflTeam || "";
    return `${name}${pos ? ` · ${pos}` : ""}${tm ? ` · ${tm}` : ""}`;
  };

  return (
    <div>
      <h3>League Teams</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "6px 4px" }}>Team</th>
            <th style={{ padding: "6px 4px" }}>Owner</th>
            <th style={{ padding: "6px 4px" }}>Record</th>
            <th style={{ padding: "6px 4px" }}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const teamName = t.name || t.owner || t.id;
            const record = `${Number(t.wins || 0)}-${Number(t.losses || 0)}`;
            const isOpen = expanded === t.id;
            return (
              <React.Fragment key={t.id}>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "6px 4px" }}>{teamName}</td>
                  <td style={{ padding: "6px 4px" }}>{t.owner || t.id}</td>
                  <td style={{ padding: "6px 4px" }}>{record}</td>
                  <td style={{ padding: "6px 4px" }}>
                    <button onClick={() => setExpanded(isOpen ? null : t.id)}>
                      {isOpen ? "Hide Roster" : "View Roster"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={4} style={{ padding: "8px 4px", background: "#fafafa" }}>
                      <b>Starters</b>
                      <ul style={{ margin: "6px 0 10px 0" }}>
                        {t.roster
                          ? Object.entries(t.roster).map(([slot, pid]) => (
                              <li key={slot}>
                                <b style={{ width: 44, display: "inline-block" }}>{slot}</b>{" "}
                                {labelOf(pid)}
                              </li>
                            ))
                          : <li>(no starters)</li>}
                      </ul>
                      <b>Bench</b>
                      <ul style={{ margin: 0 }}>
                        {Array.isArray(t.bench) && t.bench.length > 0
                          ? t.bench.map((pid) => <li key={pid}>{labelOf(pid)}</li>)
                          : <li>(empty bench)</li>}
                      </ul>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 8, color: "#666" }}>(no teams yet)</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
