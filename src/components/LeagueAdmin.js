// src/pages/LeagueAdmin.js (or src/components/LeagueAdmin.js)
import React, { useState } from "react";
import { useParams } from "react-router-dom";

// Adjust the import path if your file is located elsewhere
import {
  seedPlayersToGlobal,
  seedPlayersToLeague,
} from "../lib/storage";

function useLeagueIdFromPropsOrRoute(props) {
  const params = useParams?.() || {};
  return props.leagueId || params.leagueId || null;
}

export default function LeagueAdmin(props) {
  const leagueId = useLeagueIdFromPropsOrRoute(props);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [debug, setDebug] = useState(null);

  async function importEspn(scope) {
    setBusy(true);
    setMsg("");
    setDebug(null);
    try {
      const r = await fetch("/api/players/espn");
      if (!r.ok) {
        throw new Error(`Failed to fetch /api/players/espn (${r.status})`);
      }
      const json = await r.json();

      // Accept either { players: [...] } or a raw array
      const playersRaw = Array.isArray(json) ? json : json.players || [];
      if (!Array.isArray(playersRaw) || playersRaw.length === 0) {
        throw new Error("No players returned from /api/players/espn");
      }

      // Keep only items that have an id (storage guards will also noop invalid rows)
      const players = playersRaw.filter((p) => p && (p.id != null));

      // optional: trim to NFL only if your endpoint sometimes mixes sports
      // const players = playersRaw.filter((p) => p && p.id != null && (p.league === 'nfl' || p.sport === 'football'));

      let res;
      if (scope === "league") {
        if (!leagueId) throw new Error("No leagueId available to import into this league.");
        res = await seedPlayersToLeague(leagueId, players);
        setMsg(
          `ESPN import complete → League ${leagueId}. Received: ${players.length}. Wrote: ${res?.written ?? 0}.`
        );
      } else {
        res = await seedPlayersToGlobal(players);
        setMsg(
          `ESPN import complete → Global. Received: ${players.length}. Wrote: ${res?.written ?? 0}.`
        );
      }

      setDebug({
        sample: players.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name || p.fullName || p.displayName,
          team: p.team || p.nflTeam || p.proTeam,
          pos: p.position || p.pos,
          espnId: p.espnId,
        })),
      });
    } catch (e) {
      console.error(e);
      setMsg(`Import failed: ${e.message || e.toString()}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      {/* Admin: ESPN Players Import */}
      <div className="card mb12">
        <div className="header">
          <h3 className="card-title m0">Data Tools · ESPN Players</h3>
          <div className="right">
            {leagueId ? (
              <span className="badge">League: {leagueId}</span>
            ) : (
              <span className="badge">No league selected</span>
            )}
          </div>
        </div>

        <p className="dim m0">
          Pull a fresh player catalog from the internal API at{" "}
          <code>/api/players/espn</code> and seed your database. This will also carry
          through <code>espnId</code> for headshots and normalize <code>position</code> /{" "}
          <code>team</code>.
        </p>

        <div className="btnrow mt12">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => importEspn("global")}
            title="Import ESPN players into global /players"
          >
            {busy ? "Importing…" : "Import ESPN → Global"}
          </button>

          <button
            className="btn"
            disabled={busy || !leagueId}
            onClick={() => importEspn("league")}
            title="Import ESPN players into this league's /players"
          >
            {busy ? "Importing…" : "Import ESPN → This League"}
          </button>
        </div>

        {msg ? (
          <div className="marker mt12">
            {msg}
          </div>
        ) : null}

        {debug ? (
          <details className="mt12">
            <summary className="dim">View sample of imported rows</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(debug, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>

      {/* You can keep your existing admin blocks below */}
      {/* <div className="card mb12">…other admin tools…</div> */}
    </div>
  );
}
