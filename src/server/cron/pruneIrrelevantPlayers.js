/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
// Remove players that can never score fantasy points (OL, IDP, etc.)

const KEEP = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

function normPos(pos) {
  return String(pos || "").toUpperCase().trim();
}

/**
 * Prunes player docs whose `position` is not one of KEEP.
 * Supports paging with `limit` and `cursor` (cursor = last 'name' value).
 *
 * @param {object} opts
 * @param {import('firebase-admin').firestore.Firestore} opts.adminDb
 * @param {number} [opts.limit=250]
 * @param {string|null} [opts.cursor=null] - value to startAfter for 'name'
 * @param {boolean} [opts.dryRun=false] - if true, don't delete, just count
 */
export async function pruneIrrelevantPlayers({
  adminDb,
  limit = 250,
  cursor = null,
  dryRun = false,
} = {}) {
  if (!adminDb) throw new Error("adminDb required");

  const col = adminDb.collection("players");

  // We page by name so we don’t need composite indexes.
  let q = col.orderBy("name").limit(Math.max(1, Math.min(1000, Number(limit) || 250)));
  if (cursor) q = q.startAfter(cursor);

  const snap = await q.get();
  let scanned = 0;
  let deleted = 0;
  let kept = 0;

  // Batch deletes in chunks of <= 500
  let batch = adminDb.batch();
  let opsInBatch = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data() || {};
    const pos = normPos(data.position);

    // keep only fantasy-relevant positions
    const isKeep = KEEP.has(pos);

    if (!isKeep) {
      deleted++;
      if (!dryRun) {
        batch.delete(doc.ref);
        opsInBatch++;
        if (opsInBatch >= 450) {
          await batch.commit();
          batch = adminDb.batch();
          opsInBatch = 0;
        }
      }
    } else {
      kept++;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  const nextCursor = !snap.empty ? (snap.docs[snap.docs.length - 1].get("name") || snap.docs[snap.docs.length - 1].id) : null;
  const done = snap.empty || snap.size < (Number(limit) || 250);

  return {
    ok: true,
    scanned,
    kept,
    deleted,
    done,
    nextCursor,
    dryRun,
  };
}

export default pruneIrrelevantPlayers;
