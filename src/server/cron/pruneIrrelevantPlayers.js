/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
const KEEP = new Set(["QB","RB","WR","TE","K","DEF"]);
const IDP_OL = new Set([
  "C","G","LG","RG","LT","RT","OL",
  "DE","DT","DL","EDGE","LB","ILB","OLB","MLB",
  "CB","DB","S","FS","SS",
  "NT"
]);

export async function pruneIrrelevantPlayers({ adminDb, limit = 1000 }) {
  const col = adminDb.collection("players");
  let checked = 0;
  let deleted = 0;

  // Scan in chunks by name ascending
  let cursor = null;
  let loops = 0;
  const started = Date.now();

  do {
    let q = col.orderBy("name").limit(Math.min(1000, Number(limit) || 1000));
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = adminDb.batch();
    let batched = 0;

    for (const d of snap.docs) {
      checked++;
      const p = d.data() || {};
      const pos = String(p.position || "").toUpperCase().trim();

      if (!KEEP.has(pos) || IDP_OL.has(pos)) {
        batch.delete(d.ref);
        deleted++;
        batched++;
      }
    }

    if (batched) await batch.commit();

    cursor = snap.docs[snap.docs.length - 1]?.get("name") || snap.docs[snap.docs.length - 1]?.id || null;
    loops++;

    // time/loop guard for serverless
    if (Date.now() - started > 45_000) break;
    if (loops > 200) break;
  } while (cursor);

  return { ok: true, checked, deleted, done: !cursor };
}

export default pruneIrrelevantPlayers;
