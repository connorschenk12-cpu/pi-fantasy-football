/* eslint-disable no-console */
import React, { useState } from "react";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

/**
 * Props:
 * - leagueId?: string | null  (null => backfill global /players; else leagues/{leagueId}/players)
 *
 * What it does:
 * 1) Fetch Sleeper's NFL players JSON (public endpoint)
 * 2) Build maps -> sleeperId -> espn_id & name -> espn_id
 * 3) Scan your Firestore players (global or league-scoped)
 * 4) When it finds an espn_id, writes:
 *    - espnId: string
 *    - headshotUrl: https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png
 */
export default function EspnIdBackfill({ leagueId = null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function normName(n) {
    return String(n || "")
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setResult(null);

    try {
      // 1) Sleeper catalog
      const url = "https://api.sleeper.app/v1/players/nfl";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Sleeper fetch failed: ${res.status}`);
      const data = await res.json(); // big object keyed by player_id

      // 2) Build lookups
      const bySleeper = new Map(); // sleeper_id -> espn_id
      const byName = new Map();    // normalized name -> espn_id
      const byNameTeamPos = new Map(); // "name|team|pos" -> espn_id

      for (const [sleeperId, row] of Object.entries(data)) {
        const espn = row?.espn_id ?? row?.espn ?? null;
        if (!espn) continue;

        const espnId = String(espn);
        const full = normName(row?.full_name || `${row?.first_name || ""} ${row?.last_name || ""}`);
        const team = String(row?.team || row?.fantasy_positions?.[0] || row?.position || "").toUpperCase();
        const pos  = String(row?.position || row?.fantasy_positions?.[0] || "").toUpperCase();

        bySleeper.set(String(sleeperId), espnId);
        if (full) byName.set(full, espnId);
        if (full) byNameTeamPos.set(`${full}|${team}|${pos}`, espnId);
      }

      // 3) Load Firestore players to update
      const colRef = leagueId
        ? collection(db, "leagues", leagueId, "players")
        : collection(db, "players");
      const snap = await getDocs(colRef);

      let scanned = 0;
      let already = 0;
      let matched = 0;
      let wrote = 0;

      // Batch in chunks
      let batch = writeBatch(db);
      let ops = 0;

      const commitIfNeeded = async (force = false) => {
        if (ops >= 400 || force) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      };

      for (const d of snap.docs) {
        scanned += 1;
        const p = d.data() || {};
        // If already has espnId & headshotUrl, skip
        if (p.espnId && p.headshotUrl) {
          already += 1;
          continue;
        }

        // Try to find espnId
        let espnId = null;

        // (a) If sleeperId on your doc matches
        const sleeperId =
          String(p.sleeperId ?? p.sleeper_id ?? p.id ?? "").trim() || null;
        if (sleeperId && bySleeper.has(String(sleeperId))) {
          espnId = bySleeper.get(String(sleeperId));
        }

        // (b) Try by normalized name (+ optional team/pos)
        if (!espnId) {
          const name =
            p.name ??
            p.displayName ??
            p.fullName ??
            p.playerName ??
            [p.firstName, p.lastName].filter(Boolean).join(" ") ??
            null;
          const team = String(p.team || p.nflTeam || p.proTeam || "").toUpperCase();
          const pos  = String(p.position || p.pos || "").toUpperCase();

          const key = normName(name || "");
          if (key) {
            const keyedTeamPos = `${key}|${team}|${pos}`;
            if (byNameTeamPos.has(keyedTeamPos)) {
              espnId = byNameTeamPos.get(keyedTeamPos);
            } else if (byName.has(key)) {
              espnId = byName.get(key);
            }
          }
        }

        if (!espnId) continue;

        matched += 1;
        const headshotUrl = `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;

        batch.update(doc(colRef, d.id), {
          espnId: String(espnId),
          headshotUrl,
          updatedAt: serverTimestamp(),
        });
        ops += 1;
        wrote += 1;

        await commitIfNeeded(false);
      }

      await commitIfNeeded(true);

      setResult({
        scanned,
        alreadyWithPhotos: already,
        matched,
        updated: wrote,
        scope: leagueId ? `league ${leagueId}` : "global",
      });
      alert("Headshot backfill complete.");
    } catch (e) {
      console.error(e);
      setResult({ error: String(e?.message || e) });
      alert(`Headshot backfill failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb12">
      <div className="card-title">Headshots (ESPN) Backfill</div>
      <div className="row wrap ai-center gap12">
        <div className="muted">
          Source: Sleeper NFL catalog → write <code>espnId</code> and <code>headshotUrl</code> to{" "}
          {leagueId ? <b>league-scoped</b> : <b>global</b>} players.
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={run}>
          {busy ? "Running…" : "Run headshot backfill now"}
        </button>
      </div>
      {result && !result.error && (
        <div className="muted mt8">
          Scanned: <b>{result.scanned}</b> · Already had photos: <b>{result.alreadyWithPhotos}</b> ·
          Matched ESPN IDs: <b>{result.matched}</b> · Updated: <b>{result.updated}</b> · Scope:{" "}
          <b>{result.scope}</b>
        </div>
      )}
      {result?.error && (
        <div style={{ color: "crimson", marginTop: 8 }}>
          Error: {result.error}
        </div>
      )}
    </div>
  );
}
