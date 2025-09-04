/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js

export async function seedWeekProjections({
  adminDb,
  week = 1,
  season,
  limit = 25,
  cursor = null,
  overwrite = false,
}) {
  if (!adminDb) throw new Error("adminDb required");

  const db = adminDb;
  const playersCol = db.collection("players");

  // ORDER BY name, then id — cursor must match this exact chain
  let q = playersCol.orderBy("name").orderBy("id").limit(Number(limit) || 25);

  if (cursor) {
    // cursor is "name|id"
    const [cName, cId] = String(cursor).split("|");
    if (cName && cId) {
      q = q.startAfter(cName, cId);
    } else if (cName) {
      // fallback: allow old single-name cursors if they exist
      q = q.startAfter(cName);
    }
  }

  const snap = await q.get();

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let nextCursor = null;

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
      pos === "RB" ?  9.0 :
      pos === "WR" ?  9.0 :
      pos === "TE" ?  7.0 :
      pos === "K"  ?  6.0 :
      pos === "DEF"?  6.0 : 5.0;

    projections[key] = Number(base.toFixed(1));

    await doc.ref.set({ projections }, { merge: true });
    updated++;
  }

  if (!snap.empty) {
    const last = snap.docs[snap.docs.length - 1];
    const lastName = last.get("name") || "";
    const lastId = last.get("id") || last.id;
    nextCursor = `${lastName}|${lastId}`;
  }

  const done = snap.empty || snap.size < (Number(limit) || 25);

  return { ok: true, processed, updated, skipped, done, nextCursor };
}

export default seedWeekProjections;
