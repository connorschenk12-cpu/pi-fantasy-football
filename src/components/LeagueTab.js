/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { listenLeague, listTeams, listPlayersMap } from "../lib/storage";
import PlayerName from "./common/PlayerName.jsx";

export default function LeagueTab({ leagueId }) {
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());

  useEffect(() => {
    if (!leagueId) return;
    const off = listenLeague(leagueId, setLeague);
    (async () => {
      const t = await listTeams(leagueId);
      setTeams(t);
      const pm = await listPlayersMap({ leagueId });
      setPlayersMap(pm);
    })();
    return () => off && off();
  }, [leagueId]);

  const teamRows = useMemo(() => {
    return (teams || []).map((t) => {
      const starters = [];
      Object.keys(t.roster || {}).forEach((slot) => {
        starters.push({ slot, playerId: t.roster[slot] });
      });
      return { id: t.id, starters, name: t.name || t.id };
    });
  }, [teams]);

  return (
    <div>
      <h3>League</h3>
      {league?.name && <div style={{ marginBottom: 8 }}>League: <b>{league.name}</b></div>}

      {teamRows.map((t) => (
        <div key={t.id} style={{ border: "1px solid #eee", padding: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.name}</div>
          <table width="100%" cellPadding="4" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {t.starters.map((s) => (
                <tr key={s.slot}>
                  <td style={{ width: 60 }}><b>{s.slot}</b></td>
                  <td>
                    <PlayerName leagueId={leagueId} playerId={s.playerId} fallback="(empty)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {teamRows.length === 0 && <div>No teams yet.</div>}
    </div>
  );
}
