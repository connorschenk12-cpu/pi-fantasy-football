/* eslint-disable no-console */
// src/server/cron/pruneIrrelevantPlayers.js
const KEEP = new Set(["QB","RB","WR","TE","K","DEF"]);
const IDP_OL = new Set([
  "C","G","LG","RG","LT","RT","OL","T","OT","OG",
  "DE","DT","DL","EDGE","NT","LB","ILB","OLB","MLB",
  "CB","DB","S","FS","SS",
  "P","LS"
]);

export async function pruneIrrelevantPlayers({ adminDb, limit = 1000 }) {
  const col = adminDb.collection("players");
  let checked = 0, deleted = 0;
  let cursorName = null, cursorId = null;
  const start = Date.now();

  while (true) {
    let q = col.orderBy("name").orderBy("id").limit(Math.min(Number(limit) || 1000, 1000));
    if (cursorName || cursorId) q = q.startAfter(cursorName || "", cursorId || "");
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

    const last = snap.docs[snap.docs.length - 1];
    cursorName = last.get("name") || "";
    cursorId = last.get("id") || last.id;

    if (Date.now() - start > 45_000) break; // keep serverless happy
    if (snap.size < (Number(limit) || 1000)) break;
  }

  return { ok:true, checked, deleted, done:true };
}

export default pruneIrrelevantPlayers;
