/* eslint-disable no-console */
// src/components/admin/EspnIdBackfill.js
import React, { useState } from "react";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { asId } from "../../lib/storage";

function parseCsv(text) {
  // Supports: id,espnId  OR  name,team,espnId  OR  id,name,espnId
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(",").map((x) => x.trim());
    if (parts.length === 2) {
      const [idOrName, espnId] = parts;
      out.push({ key: idOrName, espnId });
    } else if (parts.length >= 3) {
      const [idOrName, teamOrName, espnId] = parts;
      out.push({ key: idOrName, team: teamOrName, espnId });
    }
  }
  return out;
}

export default function EspnIdBackfill({ leagueId = null }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([]);

  async function run() {
    setLoading(true);
    setLog([]);
    try {
      // build index: key -> espnId
      // Accept raw JSON array too
      let rows = [];
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j)) rows = j;
      } catch (_) {
        rows = parseCsv(text);
      }
      if (rows.length === 0) {
        alert("Paste a CSV or JSON with at least one mapping.");
        setLoading(false);
        return;
      }

      const keyToEspn = new Map();
      for (const r of rows) {
        if (!r) continue;
        const espnId = String(r.espnId || r.espn_id || "").trim();
        if (!espnId) continue;

        // Keys we’ll try to match on
        const keys = new Set();
        if (r.key) keys.add(String(r.key).trim().toLowerCase()); // could be doc id or player name
        if (r.id) keys.add(String(r.id).trim().toLowerCase());
        if (r.name) keys.add(String(r.name).trim().toLowerCase());
        if (r.team) keys.add(`${String(r.name || r.key || "").trim().toLowerCase()}|${String(r.team).trim().toLowerCase()}`);

        for (const k of keys) if (k) keyToEspn.set(k, espnId);
      }

      // load players (global or league-scoped)
      const col = leagueId
        ? collection(db, "leagues", leagueId, "players")
        : collection(db, "players");

      const snap = await getDocs(col);
      let updates = 0;
      for (const d of snap.docs) {
        const p = d.data() || {};
        const idKey = String(d.id).toLowerCase();
        const nameKey = String(
          p.name ||
            p.fullName ||
            p.playerName ||
            ""
        ).toLowerCase();
        const team = String(p.team || p.nflTeam || p.proTeam || "").toLowerCase();
        const nameTeamKey = `${nameKey}|${team}`;

        const match =
          keyToEspn.get(idKey) ||
          keyToEspn.get(nameKey) ||
          keyToEspn.get(nameTeamKey) ||
          null;

        if (match && !p.espnId) {
          await updateDoc(doc(col, d.id), { espnId: match });
          updates += 1;
          setLog((prev) => [...prev, `✅ ${d.id} ← espnId ${match}`]);
        } else {
          setLog((prev) => [
            ...prev,
            match
              ? `⏭️ ${d.id} already has espnId`
              : `⁉️ ${d.id} no mapping found`
          ]);
        }
      }

      alert(`Backfill complete. Updated ${updates} player(s).`);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <h4 style={{ marginTop: 0 }}>
        ESPN ID Backfill {leagueId ? `(League ${leagueId})` : "(Global)"}
      </h4>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>
        Paste CSV or JSON. CSV examples:
        <pre style={{ background: "#fafafa", padding: 8, borderRadius: 6 }}>
id,espnId
justin-jefferson,4047646
{"{"} "key": "Patrick Mahomes", "team": "KC", "espnId": "3139477" {"}"}
name,team,espnId
Patrick Mahomes,KC,3139477
        </pre>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="CSV or JSON here…"
        rows={8}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <div style={{ marginTop: 8 }}>
        <button disabled={loading} onClick={run}>
          {loading ? "Backfilling…" : "Apply ESPN IDs"}
        </button>
      </div>
      <div style={{ marginTop: 10, maxHeight: 180, overflow: "auto", fontSize: 12 }}>
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
