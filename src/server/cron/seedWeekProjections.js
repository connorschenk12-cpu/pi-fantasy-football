/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Cursor-based, quota-safe projection filler. Call repeatedly with ?cursor=... until done.

import { FieldPath } from "firebase-admin/firestore";

const WRITE_BATCH_SIZE = 100;   // keep small to avoid write bursts
const QUERY_LIMIT = 300;        // max docs per page (override via ?limit=)
const SLEEP_BETWEEN_COMMITS_MS = 200;
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBackoff(fn, label = "op") {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const quota =
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.toLowerCase().includes("quota");
      if (!quota || attempt >= MAX_RETRIES) throw e;
      const delay = 250 * Math.pow(2, attempt); // 250, 500, 1000, 2000, 4000
      console.warn(
        `${label}: quota hit, retrying in ${delay}ms (attempt ${
          attempt + 1
        }/${MAX_RETRIES})`
      );
      await sleep(delay);
      attempt += 1;
    }
  }
}

const BASE = { QB: 15, RB: 12, WR: 11, TE: 8, K: 7, DEF: 6 };
const posKey = (p) =>
  String(p?.position || p?.pos || "").toUpperCase() || "WR";

/**
 * Seed/patch projections for a given week:
 * - Only fills missing/zero values (won't clobber real numbers)
 * - Paginates by document ID using a cursor
 * - Throttles commits and retries on quota
 */
export async function seedWeekProjections({
  adminDb,
  week,
  limit,
  cursor,
} = {}) {
    if (!adminDb) throw new Error("adminDb required");
    const w = Number(week);
    if (!Number.isFinite(w) || w <= 0)
      return { ok: false, error: "week is required (?week=1..18)" };

    const pageSize = Math.min(Math.max(Number(limit) || QUERY_LIMIT, 50), 500);

    // Build paged query by document ID so we can resume via cursor
    let q = adminDb
      .collection("players")
      .orderBy(FieldPath.documentId())
      .limit(pageSize)
      .select("position", "projections");
    if (cursor) q = q.startAfter(String(cursor));

    // Read one page
    const snap = await withBackoff(() => q.get(), "projections-read");
    const docs = snap.docs || [];
    if (docs.length === 0) {
      return { ok: true, week: w, updated: 0, done: true };
    }

    // Prepare patches (only fill missing/zero)
    const field = String(w);
    const toPatch = [];
    for (const d of docs) {
      const data = d.data() || {};
      const existing =
        (data.projections && data.projections[field]) ??
        (data.projections && data.projections[w]);
      if (existing != null && Number(existing) > 0) continue; // keep positive values
      const base = BASE[posKey(data)] ?? BASE.WR;
      toPatch.push({ ref: d.ref, patch: { [`projections.${field}`]: base } });
    }

    // Apply in very small commits
    let updated = 0;
    for (let i = 0; i < toPatch.length; i += WRITE_BATCH_SIZE) {
      const chunk = toPatch.slice(i, i + WRITE_BATCH_SIZE);
      if (chunk.length === 0) break;
      const batch = adminDb.batch();
      for (const { ref, patch } of chunk) {
        batch.set(ref, patch, { merge: true });
      }
      await withBackoff(() => batch.commit(), "projections-write");
      updated += chunk.length;
      await sleep(SLEEP_BETWEEN_COMMITS_MS);
    }

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
