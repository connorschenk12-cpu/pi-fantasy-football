/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Minimal working seeder that writes a placeholder projection if missing.
// Replace the projection logic later with your real source.

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

  let q = playersCol.orderBy("name").limit(Number(limit) || 25);
  if (cursor) {
    // cursor must match the same orderBy field; we use name here
    q = q.startAfter(cursor);
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

    // Defensive players / OL have no projections -> skip
    const pos = String(data.position || "").toUpperCase();
    if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(pos)) {
      skipped++;
      continue;
    }

    // If we don't want to overwrite and a value exists, skip
    if (!overwrite && projections[key] != null) {
      skipped++;
      continue;
    }

    // Placeholder logic: set a tiny baseline so UI sorts consistently
    // (e.g., QBs slightly above others). Replace with real logic later.
    const base =
      pos === "QB" ? 12.0 :
      pos === "RB" ? 9.0 :
      pos === "WR" ? 9.0 :
      pos === "TE" ? 7.0 :
      pos === "K"  ? 6.0 :
      pos === "DEF"? 6.0 : 5.0;

    projections[key] = Number(base.toFixed(1));

    await doc.ref.set({ projections }, { merge: true });
    updated++;
  }

  if (!snap.empty) {
    const last = snap.docs[snap.docs.length - 1];
    // use the same field as orderBy — we used 'name'
    nextCursor = last.get("name") || last.id;
  }

  const done = snap.empty || snap.size < (Number(limit) || 25);

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done,
    nextCursor,
  };
}

// Provide a default export too, so dynamic import styles work.
export default seedWeekProjections;
