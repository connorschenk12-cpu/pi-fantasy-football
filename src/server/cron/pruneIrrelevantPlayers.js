/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
// Deletes any player whose position is NOT one of: QB, RB, WR, TE, K, DEF

const KEEP = new Set(["QB","RB","WR","TE","K","DEF"]);

export async function pruneIrrelevantPlayers({ adminDb, limit = 500 }) {
  if (!adminDb) throw new Error("adminDb required");
  const col = adminDb.collection("players");

  // Scan in name order to keep a stable cursor; use __name__ as tiebreaker if you want.
  const snap = await col.orderBy("name").limit(Number(limit) || 500).get();
  if (snap.empty) {
    return { ok: true, checked: 0, deleted: 0, done: true };
  }

  let checked = 0, deleted = 0;
  const batch = adminDb.batch();

  for (const doc of snap.docs) {
    checked++;
    const pos = String(doc.get("position") || "").toUpperCase();
    if (!KEEP.has(pos)) {
      batch.delete(doc.ref);
      deleted++;
    }
  }

  if (deleted) await batch.commit();

  // naive paging: when < limit we’re likely done;
  const done = snap.size < (Number(limit) || 500);
  return { ok: true, checked, deleted, done };
}

export default pruneIrrelevantPlayers;
