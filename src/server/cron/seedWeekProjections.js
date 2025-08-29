/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Quota-safe, cursorable projection seeder. Call repeatedly until done.
//
// Usage:
//   /api/cron?task=projections&week=1               (defaults: limit=80)
//   /api/cron?task=projections&week=1&cursor=abc    (continue)
//   /api/cron?task=projections&week=1&limit=50      (even slower)

import { FieldPath } from "firebase-admin/firestore";

const DEFAULT_LIMIT = 80;              // small page to avoid spikes
const MIN_LIMIT = 20;
const MAX_LIMIT = 200;

const SLEEP_READ_MS = 150;             // pause after each read page
const SLEEP_AFTER_COMMIT_MS = 250;     // pause after each commit batch

const MAX_RETRIES = 5;                 // backoff retries on RESOURCE_EXHAUSTED
const BASE_BACKOFF_MS = 300;           // 300 -> 600 -> 1200 -> 2400 -> 4800 (+ jitter)

const BASE = { QB: 15, RB: 12, WR: 11, TE: 8, K: 7, DEF: 6 };
const posKey = (p) =>
  String(p?.position || p?.pos || "").toUpperCase() || "WR";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isQuotaErr = (e) => {
  const msg = String(e?.message || e || "");
  return (
    e?.code === 8 ||                       // grpc RESOURCE_EXHAUSTED
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.toLowerCase().includes("quota")
  );
};

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (!isQuotaErr(e) || attempt >= MAX_RETRIES) throw e;
      const jitter = Math.floor(Math.random() * 100);
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter;
      console.warn(`${label}: quota hit; retry in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

export async function seedWeekProjections({ adminDb, week, limit, cursor } = {}) {
  if (!adminDb) throw new Error("adminDb required");
  const w = Number(week);
  if (!Number.isFinite(w) || w <= 0) {
    return { ok: false, error: "week is required (?week=1..18)" };
  }

  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, MIN_LIMIT), MAX_LIMIT);
  const field = String(w);

  // Build query (paged by documentId)
  let q = adminDb
    .collection("players")
    .orderBy(FieldPath.documentId())
    .limit(pageSize)
    .select("position", "projections");

  if (cursor) q = q.startAfter(String(cursor));

  // Read one page (with backoff)
  const snap = await withBackoff(() => q.get(), "projections.read");
  const docs = snap.docs || [];
  if (docs.length === 0) {
    return { ok: true, week: w, updated: 0, page: 0, done: true };
  }

  // Decide which docs need a fill (only if missing/zero)
  const patches = [];
  for (const d of docs) {
    const data = d.data() || {};
    const existing =
      (data.projections && data.projections[field]) ??
      (data.projections && data.projections[w]);

    if (existing != null && Number(existing) > 0) continue; // keep positive values

    const base = BASE[posKey(data)] ?? BASE.WR;
    patches.push({ ref: d.ref, patch: { [`projections.${field}`]: base } });
  }

  // Use BulkWriter for automatic throttled retries
  const writer = adminDb.bulkWriter();
  let updated = 0;
  writer.onWriteError((err) => {
    if (isQuotaErr(err)) {
      const attempt = err.failedAttempts || 0;
      const jitter = Math.floor(Math.random() * 100);
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter;
      console.warn(`bulkWriter quota: retry in ${delay}ms (attempt ${attempt + 1})`);
      return true; // let BulkWriter retry with its own backoff
    }
    return false; // do not retry other errors
  });

  // Schedule writes
  for (const { ref, patch } of patches) {
    writer.set(ref, patch, { merge: true });
  }

  await withBackoff(() => writer.close(), "projections.write"); // flush all
  updated = patches.length;

  // Gentle sleeps to smooth traffic
  await sleep(SLEEP_AFTER_COMMIT_MS);
  await sleep(SLEEP_READ_MS);

  const lastDoc = docs[docs.length - 1];
  const nextCursor = lastDoc?.id || null;

  return {
    ok: true,
    week: w,
    updated,
    page: docs.length,
    nextCursor,
    done: !nextCursor,
  };
}
