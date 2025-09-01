/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
// Removes players that can never score fantasy points (defenders, OL, etc.)
// Keeps only: QB, RB, WR, TE, K, DEF

export async function pruneIrrelevantPlayers({
  adminDb,
  limit = 500,
  cursor = null,
}) {
  if (!adminDb) throw new Error("adminDb required");

  const KEEP = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

  const col = adminDb.collection("players");
  let q = col.orderBy("name").limit(Number(limit) || 500);
  if (cursor) q = q.startAfter(cursor);

  const snap = await q.get();

  let processed = 0;
  let removed = 0;
  let kept = 0;
  let nextCursor = null;

  const batch = adminDb.batch();

  for (const doc of snap.docs) {
    processed++;
    const p = doc.data() || {};
    const pos = String(p.position || "").toUpperCase();

    if (!KEEP.has(pos)) {
      batch.delete(doc.ref);
      removed++;
    } else {
      kept++;
    }
  }

  if (!snap.empty) {
    const last = snap.docs[snap.docs.length - 1];
    nextCursor = last.get("name") || last.id;
  }

  if (removed > 0) {
    await batch.commit();
  }

  const done = snap.empty || snap.size < (Number(limit) || 500);

  return { ok: true, processed, removed, kept, done, nextCursor };
}

export default pruneIrrelevantPlayers;
