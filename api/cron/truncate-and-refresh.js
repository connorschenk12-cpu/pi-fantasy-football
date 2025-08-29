// api/cron/truncate-and-refresh.js
/* eslint-disable no-console */

// Uses your Admin SDK (server) to delete & re-seed
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const BATCH_LIMIT = 400;

export const config = { maxDuration: 60 }; // Vercel serverless limit (bump if you’re on pro)

function absoluteUrl(req, path) {
  // Build an absolute URL to our own API route (players/espn)
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-vercel-deployment-url"] || req.headers.host;
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

function espnHeadshotById(espnId) {
  const id = String(espnId || "").replace(/[^\d]/g, "");
  return id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : null;
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} ${url}`);
  return r.json();
}

// Hard delete all docs in "players" in chunks
async function truncatePlayers() {
  let total = 0;
  // Keep querying & deleting until empty
  while (true) {
    const snap = await adminDb.collection("players").limit(500).get();
    if (snap.empty) break;

    let ops = 0;
    let batch = adminDb.batch();

    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      ops += 1;
      total += 1;
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        ops = 0;
        batch = adminDb.batch();
      }
    }
    if (ops > 0) await batch.commit();
  }
  return total;
}

export default async function handler(req, res) {
  try {
    // Optional secret check
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 1) TRUNCATE all global players
    const deleted = await truncatePlayers();

    // 2) FETCH fresh ESPN roster (via your local route)
    // If you haven't added it yet, use the version I sent for api/players/espn.js
    const url = absoluteUrl(req, "/api/players/espn");
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      return res.status(502).json({ ok: false, step: "fetch", error: `players/espn ${r.status}` });
    }
    const data = await r.json();
    const players = Array.isArray(data.players) ? data.players : [];

    // 3) WRITE players back into Firestore (chunked batches)
    let written = 0;
    let ops = 0;
    let batch = adminDb.batch();

    for (const p of players) {
      const id = String(p.id || "").trim();
      if (!id) continue;

      const ref = adminDb.collection("players").doc(id);
      batch.set(
        ref,
        {
          id,
          name: p.name || "",
          position: (p.position || "").toUpperCase() || null, // QB/RB/WR/TE/K/DEF
          team: p.team || null, // e.g. ATL
          espnId: p.espnId ?? (id && /^\d+$/.test(id) ? Number(id) : null),
          photo: p.photo || (p.espnId ? espnHeadshotById(p.espnId) : null),
          projections: null, // you can backfill later from projections endpoint
          matchups: null,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      ops += 1;
      written += 1;

      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        ops = 0;
        batch = adminDb.batch();
      }
    }
    if (ops > 0) await batch.commit();

    return res.status(200).json({
      ok: true,
      deleted,
      written,
      source: "espn",
    });
  } catch (e) {
    console.error("truncate-and-refresh error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
