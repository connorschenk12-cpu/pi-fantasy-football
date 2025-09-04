/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Uses a composite cursor (name + __name__) so pagination never stalls.
// Writes a basic placeholder projection unless overwrite=true.

export async function seedWeekProjections({
  adminDb,
  week = 1,
  season,
  limit = 25,
  cursorName = null, // string
  cursorId = null,   // doc id string
  overwrite = false,
}) {
  if (!adminDb) throw new Error("adminDb required");

  const db = adminDb;
  const col = db.collection("players");

  // stable composite ordering to support (name, id) cursor
  let q = col.orderBy("name").orderBy("__name__").limit(Math.max(1, Math.min(1000, Number(limit) || 25)));

  if (cursorName && cursorId) {
    q = q.startAfter(cursorName, cursorId);
  }

  const snap = await q.get();

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let nextCursor = null;
  let nextCursorName = null;
  let nextCursorId = null;

  for (const doc of snap.docs) {
    processed++;
    const data = doc.data() || {};
    const projections = data.projections || {};
    const key = String(week || 1);

    if (!overwrite && projections[key] != null) {
      skipped++;
      continue;
    }

    const pos = String(data.position || "").toUpperCase();
    const base =
      pos === "QB" ? 12.0 :
      pos === "RB" ? 9.0  :
      pos === "WR" ? 9.0  :
      pos === "TE" ? 7.0  :
      pos === "K"  ? 6.0  :
      pos === "DEF"? 6.0  : 5.0;

    projections[key] = Number(base.toFixed(1));

    await doc.ref.set({ projections }, { merge: true });
    updated++;
  }

  if (!snap.empty) {
    const last = snap.docs[snap.docs.length - 1];
    nextCursorName = last.get("name") || "";
    nextCursorId = last.id;
    nextCursor = `${nextCursorName}||${nextCursorId}`;
  }

  const done = snap.empty || snap.size < (Number(limit) || 25);

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done,
    // human and machine friendly cursors:
    nextCursor,          // "Name||docId"
    nextCursorName,
    nextCursorId,
  };
}

export default seedWeekProjections;
