// src/server/cron/seedWeekProjections.js
/* eslint-disable no-console */

// Pacing for Firestore writes
const WRITE_CHUNK = 250;
const PAUSE_MS    = 250;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Simple “fallback” baselines so we don't write 0s.
// Used only when a player has no projection for the target week.
const BASELINE = {
  QB: 14.0,
  RB: 9.0,
  WR: 8.0,
  TE: 6.0,
  K:  7.0,
  DEF: 6.0,
};

function normPos(p) {
  return String(p || "").toUpperCase();
}

/**
 * chooseProjection(existingValue, position)
 * - If an existing value is a finite number, keep it.
 * - Otherwise provide a modest baseline by position (not 0).
 */
function chooseProjection(prev, pos) {
  if (prev != null && Number.isFinite(Number(prev))) {
    return Number(prev);
  }
  const key = normPos(pos);
  if (BASELINE[key] != null) return BASELINE[key];
  // FLEX/unknown
  return 6.0;
}

/**
 * Seeds/merges projections for a given week.
 * - Does NOT erase other weeks.
 * - If a player already has a number for this week, we leave it alone.
 * - Otherwise a small baseline is filled so lists can sort sanely.
 *
 * If you later add a real projection source, replace the chooseProjection()
 * call with your model/ingest result.
 */
export async function seedWeekProjections({ adminDb, week, season }) {
  const W = Number(week || 1);       // season unused here, but kept for symmetry
  const snap = await adminDb.collection("players").get();
  const players = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let updated = 0;
  let idx = 0;

  while (idx < players.length) {
    const chunk = players.slice(idx, idx + WRITE_CHUNK);
    const batch = adminDb.batch();

    for (const p of chunk) {
      const pos = normPos(p.position || p.pos);
      const existing = (p.projections && typeof p.projections === "object") ? p.projections : {};
      const has = existing[String(W)];

      const nextVal = chooseProjection(has, pos);

      // Only write if we're actually changing something
      if (has == null || Number(has) !== Number(nextVal)) {
        const next = { ...existing, [String(W)]: Number(nextVal) };
        const ref = adminDb.collection("players").doc(String(p.id));
        batch.set(ref, { projections: next, updatedAt: new Date() }, { merge: true });
        updated += 1;
      }
    }

    await batch.commit();
    idx += chunk.length;
    await sleep(PAUSE_MS);
  }

  return { ok: true, week: W, season: season || null, updated };
}
