// src/components/ProjectionsSeeder.js
import React, { useState } from "react";
import { db } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

/**
 * ProjectionsSeeder
 * Admin tool: paste JSON to seed weekly projections onto player documents.
 *
 * Writes to each player doc at:
 *  - projections.{WEEK} = number
 *  - oppByWeek.{WEEK}   = string (e.g., "BUF")
 *  - kickoffByWeek.{WEEK} = number (ms timestamp)
 *
 * Accepts JSON in either of these shapes:
 *
 * SHAPE A (flat map):
 * {
 *   "week": 1,
 *   "projections": {
 *     "patrick_mahomes": { "points": 24.8, "opponent": "CIN", "kickoff": 1757361000000 },
 *     "travis_kelce":    { "points": 17.1, "opponent": "CIN", "kickoff": 1757361000000 }
 *   }
 * }
 *
 * SHAPE B (array):
 * {
 *   "week": 1,
 *   "list": [
 *     { "playerId": "patrick_mahomes", "points": 24.8, "opponent": "CIN", "kickoff": 1757361000000 },
 *     { "playerId": "travis_kelce",    "points": 17.1, "opponent": "CIN", "kickoff": 1757361000000 }
 *   ]
 * }
 */
export default function ProjectionsSeeder() {
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function seed(parsed) {
    const week = Number(parsed?.week);
    if (!Number.isInteger(week) || week < 1) {
      throw new Error("Invalid or missing 'week' (must be integer >= 1).");
    }

    // Normalize to an array [{playerId, points, opponent, kickoff}]
    let items = [];
    if (parsed?.projections && typeof parsed.projections === "object") {
      items = Object.entries(parsed.projections).map(([playerId, v]) => ({
        playerId,
        points: Number(v?.points ?? v?.projectedPoints ?? 0),
        opponent: v?.opponent || "",
        kickoff: Number(v?.kickoff || 0)
      }));
    } else if (Array.isArray(parsed?.list)) {
      items = parsed.list.map((r) => ({
        playerId: r.playerId,
        points: Number(r?.points ?? r?.projectedPoints ?? 0),
        opponent: r?.opponent || "",
        kickoff: Number(r?.kickoff || 0)
      }));
    } else {
      throw new Error("Provide either {week, projections:{...}} or {week, list:[...] }.");
    }

    // Write each player doc
    let ok = 0, fail = 0;
    for (const it of items) {
      if (!it.playerId) { fail++; continue; }
      try {
        const ref = doc(db, "players", it.playerId);
        const exists = await getDoc(ref);
        if (!exists.exists()) {
          // Skip players that aren't in your pool yet
          fail++;
          continue;
        }
        const data = {
          projections: { [String(week)]: Number.isFinite(it.points) ? it.points : 0 },
        };
        if (it.opponent) {
          data["oppByWeek"] = { [String(week)]: it.opponent };
        }
        if (Number.isFinite(it.kickoff) && it.kickoff > 0) {
          data["kickoffByWeek"] = { [String(week)]: it.kickoff };
        }
        await setDoc(ref, data, { merge: true });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    return { ok, fail };
  }

  async function handleSeed() {
    setMsg("");
    try {
      setBusy(true);
      const parsed = JSON.parse(jsonText);
      const { ok, fail } = await seed(parsed);
      setMsg(`Done. Wrote projections for ${ok} players. Skipped/failed: ${fail}.`);
    } catch (e) {
      setMsg(e.message || "Seeding failed");
    } finally {
      setBusy(false);
    }
  }

  async function seedDemoWeek1() {
    // A tiny demo payload you can tweak before real data
    const demo = {
      week: 1,
      projections: {
        "patrick_mahomes": { points: 25.3, opponent: "CIN", kickoff: Date.now() + 7*24*3600*1000 },
        "travis_kelce":    { points: 17.4, opponent: "CIN", kickoff: Date.now() + 7*24*3600*1000 },
        "ja_marr_chase":   { points: 18.1, opponent: "KC",  kickoff: Date.now() + 7*24*3600*1000 },
        "christian_mccaffrey": { points: 21.9, opponent: "SEA", kickoff: Date.now() + 7*24*3600*1000 }
      }
    };
    setJsonText(JSON.stringify(demo, null, 2));
  }

  return (
    <div style={{ border: "1px solid #eaeaea", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Projections Seeder (Admin)</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={seedDemoWeek1} disabled={busy}>Load demo W1 JSON</button>
        <button onClick={handleSeed} disabled={busy}>{busy ? "Seeding…" : "Seed Now"}</button>
      </div>
      <textarea
        value={jsonText}
        onChange={(e)=>setJsonText(e.target.value)}
        placeholder='Paste JSON: {"week":1,"projections":{"player_id":{"points":12.3,"opponent":"BUF","kickoff":1757...}}}'
        style={{ width: "100%", minHeight: 180, fontFamily: "monospace" }}
      />
      {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Notes: Writes to <code>players/{'{playerId}'}</code>. Fields: <code>projections</code>, <code>oppByWeek</code>, <code>kickoffByWeek</code>.
      </div>
    </div>
  );
}
