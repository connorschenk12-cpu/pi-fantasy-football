/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Seeds simple placeholder projections (replace later with a real feed).
// Fixed pagination: orderBy('name').orderBy('__name__') + composite cursor "name|docId".
// Supports multi-page processing in a single invocation via `pages`.

export async function seedWeekProjections({
  adminDb,
  week = 1,
  season,
  limit = 25,
  cursor = null,           // "Name|DocId" or null
  overwrite = false,       // set true to re-write existing values
  pages = 1,               // how many pages to walk in this run
}) {
  if (!adminDb) throw new Error("adminDb required");

  const db = adminDb;
  const playersCol = db.collection("players");

  const parseCursor = (c) => {
    if (!c) return null;
    const i = String(c).lastIndexOf("|");
    if (i < 0) return null;
    const name = c.slice(0, i);
    const id = c.slice(i + 1);
    return { name, id };
  };

  const makeCursor = (doc) => {
    const n = doc.get("name") || "";
    return `${n}|${doc.id}`;
  };

  const wKey = String(week || 1);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let nextCursor = cursor || null;

  for (let page = 0; page < Math.max(1, Number(pages)); page++) {
    let q = playersCol
      .orderBy("name")
      .orderBy("__name__")
      .limit(Math.max(1, Math.min(Number(limit) || 25, 1000)));

    const cur = parseCursor(nextCursor);
    if (cur) q = q.startAfter(cur.name, cur.id);

    const snap = await q.get();
    if (snap.empty) {
      nextCursor = null;
      break;
    }

    for (const doc of snap.docs) {
      processed++;
      const data = doc.data() || {};
      const projections = data.projections || {};

      if (!overwrite && projections[wKey] != null) {
        skipped++;
        continue;
      }

      // Placeholder baseline: keep UI sortable until you wire a real source
      const pos = String(data.position || "").toUpperCase();
      const base =
        pos === "QB" ? 12.0 :
        pos === "RB" ? 9.0  :
        pos === "WR" ? 9.0  :
        pos === "TE" ? 7.0  :
        pos === "K"  ? 6.0  :
        pos === "DEF"? 6.0  : 5.0;

      projections[wKey] = Number(base.toFixed(1));
      await doc.ref.set({ projections }, { merge: true });
      updated++;
    }

    // prepare next page cursor
    const last = snap.docs[snap.docs.length - 1];
    nextCursor = makeCursor(last);

    // if we got fewer than limit, we've reached the end
    if (snap.size < (Number(limit) || 25)) break;
  }

  const done = !nextCursor;

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done,
    nextCursor,
  };
}

export default seedWeekProjections;
