/* eslint-disable no-console */
// src/server/cron/seedWeekMatchups.js
// Stub example: sets opponent to "" (unknown) for the week.
// Replace "lookupOpponent" with real schedule logic if you have a source.

function toWeek(week) {
  const w = Number(week);
  return Number.isFinite(w) && w > 0 ? String(w) : "1";
}

// TODO: replace with real opponent lookup
function lookupOpponent(player, weekKey) {
  return ""; // e.g., "DAL", "PHI", etc.
}

export async function seedWeekMatchups({ adminDb, week, season }) {
  const weekKey = toWeek(week);
  const snap = await adminDb.collection("players").get();
  const docs = snap.docs;

  let updated = 0;

  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = adminDb.batch();

    for (const d of chunk) {
      const p = d.data() || {};
      const opp = lookupOpponent(p, weekKey);
      const matchups = { ...(p.matchups || {}) };
      const prev = matchups[weekKey] || {};
      matchups[weekKey] = { ...prev, opp };

      batch.set(d.ref, { matchups, updatedAt: new Date() }, { merge: true });
      updated += 1;
    }

    await batch.commit();
  }

  return { ok: true, week: weekKey, season: season || null, updated };
}
