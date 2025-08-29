// src/server/cron/backfillHeadshots.js
/* eslint-disable no-console */
import { getBulkWriterWithBackoff, sleep } from "./firestoreWrite.js";

function isHttpUrl(u) {
  return !!u && typeof u === "string" && /^https?:\/\//i.test(u);
}
function isEspnHeadshot(u) {
  return isHttpUrl(u) && /espncdn\.com\/i\/headshots\/nfl\/players\/full\/\d+\.png/i.test(u);
}
function espnHeadshot(espnId) {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
}

/**
 * Backfill missing headshots using ESPN id.
 * - Does NOT overwrite a non-ESPN custom photo
 * - If photo is empty or already ESPN-style (but wrong/missing), updates it
 */
export async function backfillHeadshots({ adminDb }) {
  const col = adminDb.collection("players");
  const snap = await col.get();

  if (snap.empty) {
    return { ok: true, scanned: 0, updated: 0, skipped: 0 };
  }

  const writer = getBulkWriterWithBackoff(adminDb);
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const d of snap.docs) {
    scanned += 1;
    const p = d.data() || {};
    const espnId = p.espnId ?? p.espn_id ?? null;

    // If the doc already has a custom (non-ESPN) http photo, skip
    if (isHttpUrl(p.photo) && !isEspnHeadshot(p.photo)) {
      skipped += 1;
      continue;
    }

    // If no espnId, we can't backfill
    if (!espnId) {
      skipped += 1;
      continue;
    }

    const desired = espnHeadshot(espnId);
    if (!desired) {
      skipped += 1;
      continue;
    }

    if (p.photo === desired) {
      skipped += 1; // already correct
      continue;
    }

    writer.set(d.ref, { photo: desired, updatedAt: new Date() }, { merge: true });
    updated += 1;

    // small pacing after bursts
    if (updated % 300 === 0) await sleep(250);
  }

  await writer.close();
  return { ok: true, scanned, updated, skipped };
}
