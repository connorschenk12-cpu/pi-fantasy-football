/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague, listenTeam, ensureTeam, moveToStarter, moveToBench,
  ROSTER_SLOTS, listPlayersMap, playerDisplay,
  computeTeamPoints, computeSeasonProjected
} from "../lib/storage";
import PlayersList from "./PlayersList";
import DraftBoard from "./DraftBoard";
import LeagueAdmin from "./LeagueAdmin";
import LeagueTab from "./LeagueTab";

export default function LeagueHome({ leagueId, username, onBack }) {
  const [league, setLeague] = useState(null);
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [tab, setTab] = useState("team");

  const currentWeek = Number(league?.settings?.currentWeek || 1);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    (async () => setPlayersMap(await listPlayersMap({ leagueId })))();
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let unsub = null;
    (async () => {
      if (!leagueId || !username) return;
      await ensureTeam({ leagueId, username });
      unsub = listenTeam({ leagueId, username, onChange: setTeam });
    })();
    return () => unsub && unsub();
  }, [leagueId, username]);

  const isOwner = useMemo(() => league?.owner === username, [league?.owner, username]);

  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const thisWeek = useMemo(
    () => computeTeamPoints({ roster, week: currentWeek, playersMap }),
    [roster, currentWeek, playersMap]
  );
  const seasonProj = useMemo(
    () => computeSeasonProjected({ roster, playersMap, weeks: 18 }),
    [roster, playersMap]
  );

  async function handleBenchToSlot(playerId, slot){
    try { await moveToStarter({ leagueId, username, playerId, slot }); }
    catch(e){ console.error(e); alert(String(e?.message||e)); }
  }
  async function handleSlotToBench(slot){
    try { await moveToBench({ leagueId, username, slot }); }
    catch(e){ console.error(e); alert(String(e?.message||e)); }
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={onBack}>&larr; Back</button>
      </div>

      <h2>{league?.name || leagueId}</h2>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <TabButton label="My Team" active={tab==="team"} onClick={()=>setTab("team")} />
        <TabButton label="Players" active={tab==="players"} onClick={()=>setTab("players")} />
        {league?.draft?.status !== "done" && (
          <TabButton label="Draft" active={tab==="draft"} onClick={()=>setTab("draft")} />
        )}
        <TabButton label="League" active={tab==="league"} onClick={()=>setTab("league")} />
        {isOwner && <TabButton label="Admin" active={tab==="admin"} onClick={()=>setTab("admin")} />}
      </div>

      {tab==="team" && (
        <div>
          <div style={{ marginBottom: 8 }}>
            <b>Week {currentWeek} Total:</b> {thisWeek.total.toFixed(2)} pts &nbsp;|&nbsp;
            <b>Season Projected:</b> {seasonProj.toFixed(2)} pts
          </div>

          <h3>Starters</h3>
          <table style={{ width:"100%", borderCollapse:"collapse", marginBottom:12 }}>
            <thead>
              <tr>
                <th align="left">Slot</th>
                <th align="left">Player</th>
                <th align="right">Week {currentWeek}</th>
                <th align="right">Season Proj</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ROSTER_SLOTS.map((s)=>{
                const pid = roster[s]||null;
                const p = pid ? playersMap.get(pid):null;
                const line = thisWeek.lines.find(l=>l.slot===s);
                const weekPts = line ? line.points : 0;
                const season = p ? computeSeasonProjected({ roster:{[s]:pid}, playersMap }) : 0;
                return (
                  <tr key={s} style={{ borderTop:"1px solid #eee" }}>
                    <td>{s}</td>
                    <td>{p ? playerDisplay(p) : "(empty)"}</td>
                    <td align="right">{weekPts.toFixed(2)}</td>
                    <td align="right">{season.toFixed(2)}</td>
                    <td align="right">
                      {pid && <button onClick={()=>handleSlotToBench(s)}>Send to Bench</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3>Bench</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {bench.map(pid=>{
              const p = playersMap.get(pid);
              return (
                <li key={pid} style={{ marginBottom: 6 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span>{p ? playerDisplay(p) : pid}</span>
                    <select defaultValue="" onChange={(e)=>{ const slot=e.target.value; if(slot) handleBenchToSlot(pid, slot); }}>
                      <option value="">Move to slot…</option>
                      {ROSTER_SLOTS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </li>
              );
            })}
            {bench.length===0 && <li>(no bench players)</li>}
          </ul>
        </div>
      )}

      {tab==="players" && <PlayersList leagueId={leagueId} currentWeek={currentWeek} />}

      {tab==="draft" && league?.draft?.status!=="done" && (
        <DraftBoard leagueId={leagueId} username={username} currentWeek={currentWeek} />
      )}

      {tab==="league" && <LeagueTab leagueId={leagueId} />}

      {tab==="admin" && isOwner && <LeagueAdmin leagueId={leagueId} username={username} />}
    </div>
  );
}

function TabButton({ label, active, onClick }){
  return (
    <button
      onClick={onClick}
      style={{
        padding:"6px 10px", borderRadius:6,
        border: active ? "2px solid #333" : "1px solid #ccc",
        background: active ? "#f2f2f2" : "#fff",
        fontWeight: active ? 700 : 400,
      }}
    >{label}</button>
  );
}
