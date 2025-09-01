/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
// Deletes players whose normalized position is NOT one of QB,RB,WR,TE,K,DEF.

const ALLOWED = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function normalizePosition(pos) {
  if (!pos) return "";
  const p = String(pos).toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST" || p === "D-ST") return "DEF";
  return p;
}

export async function pruneIrrelevantPlayers({ adminDb, limit = 500, cursor = null }) {
  if (!adminDb) throw new Error("adminDb required");
  const db = adminDb;

  // page by name (stable & already indexed from earlier work)
  let q = db.collection("players").orderBy("name").limit(Math.max(1, Math.min(Number(limit) || 500, 500)));
  if (cursor) q = q.startAfter(cursor);

  const snap = await q.get();
  if (snap.empty) {
    return { ok: true, processed: 0, deleted: 0, kept: 0, done: true, nextCursor: null };
  }

  let processed = 0, deleted = 0, kept = 0;

  // Firestore Admin allows batches of up to 500 writes
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    processed++;
    const data = doc.data() || {};
    const pos = normalizePosition(data.position || data.pos);

    if (!ALLOWED.has(pos)) {
      batch.delete(doc.ref);
      deleted++;
      ops++;
    } else {
      kept++;
    }

    if (ops >= 490) { // keep some headroom
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  const last = snap.docs[snap.docs.length - 1];
  const nextCursor = last.get("name") || last.id;
  const done = snap.size < (Number(limit) || 500);

  return { ok: true, processed, deleted, kept, done, nextCursor };
}

export default pruneIrrelevantPlayers;
