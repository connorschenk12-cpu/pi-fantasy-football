// src/components/admin/EspnIdBackfill.js
/* eslint-disable no-console */
import React, { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { listPlayers } from "../../lib/storage";

const TEAM_ALIASES = { JAX:"JAC", LA:"LAR", OAK:"LV", STL:"LAR", SD:"LAC", WAS:"WAS" };
const fixTeam = t => TEAM_ALIASES[String(t||"").toUpperCase()] || String(t||"").toUpperCase();
const fixPos  = p => String(p||"").toUpperCase();
const fixName = n => String(n||"").trim().toLowerCase()
  // remove suffixes/punctuation for better matching
  .replace(/\./g,"").replace(/ jr$| sr$| ii$| iii$| iv$| v$/g,"")
  .replace(/'/g,"");

const key = (name, team, pos) => `${fixName(name)}|${fixTeam(team)}|${fixPos(pos)}`;

export default function EspnIdBackfill({ leagueId = null }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  async function updatePlayerDoc(pid, payload) {
    if (leagueId) {
      try {
        await updateDoc(doc(db, "leagues", leagueId, "players", String(pid)), payload);
        return;
      } catch {}
    }
    await updateDoc(doc(db, "players", String(pid)), payload);
  }

  async function run() {
    setBusy(true);
    try {
      // 1) your players
      const players = await listPlayers({ leagueId });
      const byKey = new Map();
      for (const p of players) {
        const name = p.name || p.fullName || p.playerName;
        const pos  = p.position || p.pos;
        const team = p.team || p.nflTeam || p.proTeam;
        if (!name || !pos) continue;
        byKey.set(key(name, team, pos), p);
      }

      // 2) Sleeper dump
      const res = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!res.ok) throw new Error("Failed to fetch Sleeper players");
      const sleeper = await res.json();

      // 3) index (only rows that have espn_id)
      const idx = new Map();
      for (const sid in sleeper) {
        const s = sleeper[sid];
        if (!s) continue;
        const sName = s.full_name || (s.first_name && s.last_name ? `${s.first_name} ${s.last_name}` : null);
        const sTeam = s.team;
        const sPos  = s.position;
        const espn  = s.espn_id;
        if (!sName || !sTeam || !sPos || !espn) continue;
        const k = key(sName, sTeam, sPos);
        if (!idx.has(k)) idx.set(k, s);
      }

      // 4) match & write espnId
      let scanned = players.length, matched = 0, updated = 0, already = 0, misses = 0;

      for (const p of players) {
        const k = key(
          p.name || p.fullName || p.playerName,
          p.team || p.nflTeam || p.proTeam,
          p.position || p.pos
        );
        const s = idx.get(k);
        if (!s) { misses++; continue; }

        matched++;
        const have = p.espnId || p.espn_id || (p.espn && (p.espn.id || p.espn.playerId));
        if (have) { already++; continue; }

        await updatePlayerDoc(p.id, { espnId: String(s.espn_id) });
        updated++;
      }

      const out = { scanned, matched, updated, already, misses, scope: leagueId ? leagueId : "global" };
      setSummary(out);
      alert(
        `ESPN Backfill\nScanned: ${scanned}\nMatched: ${matched}\nUpdated: ${updated}\nAlready had: ${already}\nMisses: ${misses}\nScope: ${out.scope}`
      );
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row gap12 ai-center">
        <button className="btn" disabled={busy} onClick={run}>
          {busy ? "Running…" : "Run ESPN ID Backfill"}
        </button>
        <div className="muted">Maps via Sleeper & writes <code>espnId</code> for ESPN headshots.</div>
      </div>
      {summary && (
        <div className="muted mt8">
          Scanned: {summary.scanned} · Matched: {summary.matched} · Updated: {summary.updated} · Already: {summary.already} · Misses: {summary.misses} · Scope: {summary.scope}
        </div>
      )}
    </div>
  );
}
