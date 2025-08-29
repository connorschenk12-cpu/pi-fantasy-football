/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Dummy seeder example: writes 0.0 for every player for the given week
// Replace the "computeProjection" section with your real model/source.

function toWeek(week) {
  const w = Number(week);
  return Number.isFinite(w) && w > 0 ? String(w) : "1";
}

// Example projection function (replace with real logic)
function computeProjection(player, week) {
  // TODO: plug into a real projection source
  // Keep an object keyed by week string: { "1": 12.3, "2": 10.1, ... }
  return 0.0;
}

export async function seedWeekProjections({ adminDb, week, season }) {
  const weekKey = toWeek(week);
  const snap = await adminDb.collection("players").get();
  const docs = snap.docs;

  let updated = 0;

  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = adminDb.batch();

    for (const d of chunk) {
      const p = d.data() || {};
      const next = computeProjection(p, weekKey);

      // Merge into projections map
      const projections = { ...(p.projections || {}) };
      projections[weekKey] = Number.isFinite(next) ? Number(next) : 0;

      batch.set(d.ref, { projections, updatedAt: new Date() }, { merge: true });
      updated += 1;
    }

    await batch.commit();
  }

  return { ok: true, week: weekKey, season: season || null, updated };
}
