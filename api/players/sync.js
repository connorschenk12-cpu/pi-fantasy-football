// api/players/sync.js
// Vercel/Next serverless endpoint to import full player pool from Sleeper → Firestore
// Usage:
//   GET /api/players/sync            -> writes to global "players" collection
//   GET /api/players/sync?leagueId=XYZ  -> ALSO mirrors into leagues/XYZ/players
//
// Notes:
// - No API key needed.
// - We include baseline projections so UI has non-zero values immediately.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, setDoc, writeBatch } from "firebase/firestore";

// --- Firebase init (reads REACT_APP_* or NEXT_PUBLIC_* on Vercel) ---
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Helper: small baseline projections to avoid 0.0 everywhere ---
function baselineWeeklyProjections(position) {
  // VERY basic, replace later with a real feed if you want:
  const table = {
    QB: 18,
    RB: 12,
    WR: 12,
    TE: 8,
    K: 7,
    DEF: 7,
  };
  const base = table[position] ?? 6;
  const out = {};
  for (let w = 1; w <= 18; w++) out[String(w)] = base;
  return out;
}

// --- Normalize a Sleeper player entry → our schema ---
function toFirestorePlayer(sleeper) {
  const id = String(sleeper.player_id);
  const position = String(sleeper.position || "").toUpperCase();
  const team = sleeper.team || sleeper.search_full_team || null; // fallback if present
  const defTeam = position === "DEF" ? (team || sleeper.search_full_team || "FA") : null;
  const name =
    sleeper.full_name ||
    [sleeper.first_name, sleeper.last_name].filter(Boolean).join(" ") ||
    id;

  // Filter to fantasy-relevant types:
  const allowed = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
  if (!allowed.has(position)) return null;

  return {
    id,
    name,
    position,
    team: position === "DEF" ? defTeam : team, // DST uses team code as "name" in UI often
    // you can keep extra useful bits if you like:
    status: sleeper.status || null,
    number: sleeper.number ?? null,
    // Create baseline projections so UI has non-zero immediately:
    projections: baselineWeeklyProjections(position),
  };
}

export default async function handler(req, res) {
  try {
    const { leagueId } = req.query;

    const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!resp.ok) {
      res.status(502).json({ ok: false, error: "Failed to fetch Sleeper players" });
      return;
    }
    const all = await resp.json(); // Object keyed by player_id -> player

    // Transform and filter
    const docs = [];
    for (const key of Object.keys(all)) {
      const p = toFirestorePlayer(all[key]);
      if (p && p.team) docs.push(p); // keep only players with a team (active roster & DST)
    }

    // Write in batches (global "players")
    const chunk = 400; // Firestore batch limit safety
    for (let i = 0; i < docs.length; i += chunk) {
      const batch = writeBatch(db);
      const section = docs.slice(i, i + chunk);
      for (const p of section) {
        batch.set(doc(db, "players", p.id), p, { merge: true });
      }
      await batch.commit();
    }

    // Optionally mirror into league-scoped collection
    if (leagueId) {
      for (let i = 0; i < docs.length; i += chunk) {
        const batch = writeBatch(db);
        const section = docs.slice(i, i + chunk);
        for (const p of section) {
          batch.set(doc(db, "leagues", leagueId, "players", p.id), p, { merge: true });
        }
        await batch.commit();
      }
    }

    res.json({
      ok: true,
      count: docs.length,
      scope: leagueId ? `players + leagues/${leagueId}/players` : "players",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
