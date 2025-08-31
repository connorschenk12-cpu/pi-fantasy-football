/* eslint-disable no-console */
// src/server/cron/seedWeekProjectionsFromProps.js
// Same API shape as above, but imagine you’ll fill this with “props/lines” data later.
// For now it mirrors the baseline behavior so your button always works.

export async function seedWeekProjectionsFromProps({
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

    if (!overwrite && projections[key] != null) {
      skipped++;
      continue;
    }

    // Placeholder “props” baseline, slightly different just to distinguish
    const pos = String(data.position || "").toUpperCase();
    const base =
      pos === "QB" ? 13.0 :
      pos === "RB" ? 9.5 :
      pos === "WR" ? 9.5 :
      pos === "TE" ? 7.5 :
      pos === "K"  ? 6.0 :
      pos === "DEF"? 6.0 : 5.0;

    projections[key] = Number(base.toFixed(1));

    await doc.ref.set({ projections }, { merge: true });
    updated++;
  }

  if (!snap.empty) {
    const last = snap.docs[snap.docs.length - 1];
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

export default seedWeekProjectionsFromProps;
