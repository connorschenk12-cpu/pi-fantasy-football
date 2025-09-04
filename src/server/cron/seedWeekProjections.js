/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js

export async function seedWeekProjections({
  adminDb,
  week = 1,
  season,
  limit = 250,
  cursorName = null,
  cursorId = null,
  cursor = null,          // legacy single-cursor
  overwrite = false,
}) {
  if (!adminDb) throw new Error("adminDb required");
  const db = adminDb;
  const playersCol = db.collection("players");

  // --- build query (order by name, id for stable paging)
  let q = playersCol.orderBy("name").orderBy("id").limit(Math.max(1, Math.min(Number(limit) || 250, 500)));
  if (cursorName || cursorId) {
    q = q.startAfter(cursorName || "", cursorId || "");
  } else if (cursor) {
    // fallback: if only a name cursor is provided
    q = q.startAfter(cursor, "");
  }

  const snap = await q.get();
  if (snap.empty) {
    return { ok: true, processed: 0, updated: 0, skipped: 0, done: true };
  }

  // helper: role-aware baseline
  const bandFor = (pos, starter, depth) => {
    const d = Number(depth || 0) || null;
    const isStarter = !!starter || d === 1;

    const tier = (hi, mid, low) => (isStarter ? hi : d === 2 ? mid : low);

    switch (pos) {
      case "QB":  return tier(16.0, 8.0, 3.0);
      case "RB":  return tier(12.0, 6.0, 2.0);
      case "WR":  return tier(12.0, 6.0, 2.0);
      case "TE":  return tier(9.0,  4.0, 1.5);
      case "K":   return tier(7.0,  4.0, 2.0);
      case "DEF": return 7.0;
      default:    return 5.0;
    }
  };

  const key = String(week || 1);
  let processed = 0, updated = 0, skipped = 0;

  const batch = db.batch();
  let batched = 0;

  const started = Date.now();

  for (const doc of snap.docs) {
    processed++;
    const data = doc.data() || {};
    const pos = String(data.position || "").toUpperCase();
    const projections = data.projections || {};
    const existing = projections[key];

    // respect existing non-zero unless overwrite=true
    if (!overwrite && existing != null && Number(existing) > 0) {
      skipped++;
      continue;
    }

    const base = bandFor(pos, data.starter, data.depth);
    projections[key] = Number(base.toFixed(1));

    batch.set(doc.ref, { projections }, { merge: true });
    batched++;

    // commit periodically and watch time budget
    if (batched >= 400 || Date.now() - started > 45_000) {
      await batch.commit();
      updated += batched;
      batched = 0;
    }
  }

  if (batched) {
    await batch.commit();
    updated += batched;
  }

  const last = snap.docs[snap.docs.length - 1];
  const nextCursorName = last.get("name") || "";
  const nextCursorId = last.get("id") || last.id;

  const done = snap.size < (Number(limit) || 250);

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done,
    nextCursorName,
    nextCursorId,
    hint: "Call again with ?cursorName=<...>&cursorId=<...> or add &loop=1 to process all pages in one call.",
  };
}

export default seedWeekProjections;
