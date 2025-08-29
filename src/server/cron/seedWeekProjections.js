/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Minimal, quota-safe projection seeding.
// - Keeps existing projections
// - Only fills in MISSING values with simple baselines by position
// - Chunked + backoff so it won't hit quota and die

const BATCH_SIZE = 200;
const SLEEP_MS   = 120;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const quota = msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota");
      if (!quota || attempt >= MAX_RETRIES) throw e;
      const delay = 250 + attempt * 250;
      console.warn(`${label}: quota hit, retrying in ${delay}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

const BASE = {
  QB: 15.0,
  RB: 12.0,
  WR: 11.0,
  TE: 8.0,
  K: 7.0,
  DEF: 6.0,
};

function posKey(p) {
  return String(p.position || p.pos || "").toUpperCase() || "WR";
}

export async function seedWeekProjections({ adminDb, week } = {}) {
  if (!adminDb) throw new Error("adminDb required");

  const w = Number(week);
  if (!Number.isFinite(w) || w <= 0) {
    return { ok: false, error: "week is required (?week=1..18)" };
  }

  const allSnap = await withBackoff(() => adminDb.collection("players").get(), "players-read");
  const docs = allSnap.docs;

  const field = String(w);
  const toPatch = [];

  for (const d of docs) {
    const p = d.data() || {};
    const pos = posKey(p);
    const cur = p?.projections?.[field] ?? p?.projections?.[w];
    if (cur != null && Number(cur) > 0) continue; // keep a non-zero value

    const base = BASE[pos] != null ? BASE[pos] : BASE.WR; // default baseline
    const patch = { [`projections.${field}`]: Number(base) };
    toPatch.push({ ref: d.ref, patch });
  }

  let updated = 0;
  for (let i = 0; i < toPatch.length; i += BATCH_SIZE) {
    const chunk = toPatch.slice(i, i + BATCH_SIZE);
    const batch = adminDb.batch();
    for (const { ref, patch } of chunk) {
      batch.set(ref, patch, { merge: true });
      updated += 1;
    }
    await withBackoff(() => batch.commit(), "projections-write");
    await sleep(SLEEP_MS);
  }

  return { ok: true, week: w, updated };
}
