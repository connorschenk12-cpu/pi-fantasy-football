/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Seeds per-week projections. This version is quota-safe and idempotent.
// NOTE: Replace `computeProjection(p)` with your actual model/source.

const SLEEP_MS = 120;
const BATCH_SIZE = 150;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function validInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function currentSeasonDefault() {
  const now = new Date();
  return now.getUTCFullYear();
}

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const isQuota = msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      if (!isQuota || attempt >= MAX_RETRIES) throw e;
      const delay = (220 + 220 * attempt);
      console.warn(`${label}: quota hit; retrying in ${delay}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

/** TODO: plug in your real projection source here. */
function computeProjection(p, { week, season }) {
  // placeholder: light baseline by position so your UI isn’t all zeros
  const pos = String(p.position || "").toUpperCase();
  const base =
    pos === "QB" ? 16 :
    pos === "RB" ? 12 :
    pos === "WR" ? 11 :
    pos === "TE" ? 8 :
    pos === "K"  ? 7 :
    pos === "DEF"? 6 : 5;
  return base;
}

export async function seedWeekProjections({ adminDb, week, season } = {}) {
  const wk = validInt(week);
  if (!wk) throw new Error("week is required for projections seeding");
  const ssn = validInt(season) || currentSeasonDefault();

  // 1) read players in pages (Firestore admin .get() returns all; throttle our writes)
  const snap = await withBackoff(() => adminDb.collection("players").get(), "players-read");
  const docs = snap.docs;

  // 2) write in chunks
  let updated = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = adminDb.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);

    for (const d of chunk) {
      const p = d.data() || {};
      const projections = { ...(p.projections || {}) };
      // Only set if missing — keeps any better numbers you may seed later.
      if (projections[String(wk)] == null) {
        projections[String(wk)] = computeProjection(p, { week: wk, season: ssn });
        batch.set(d.ref, { projections }, { merge: true });
        updated += 1;
      }
    }

    await withBackoff(() => batch.commit(), "projections-write");
    await sleep(SLEEP_MS);
  }

  return { ok: true, updated, week: wk, season: ssn };
}
