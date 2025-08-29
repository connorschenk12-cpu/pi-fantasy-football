// src/server/cron/firestoreWrite.js
/* eslint-disable no-console */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Best: use BulkWriter (Admin SDK) with automatic backoff
export function getBulkWriterWithBackoff(adminDb) {
  const writer = adminDb.bulkWriter({ throttle: true });
  writer.onWriteError((err) => {
    const willRetry = err.failedAttempts < 5; // exponential backoff up to 5 tries
    if (willRetry) {
      const delay = 200 * Math.pow(2, err.failedAttempts); // 200, 400, 800, 1600, 3200ms
      console.warn(`[BulkWriter] retrying ${err.operationType} ${err.documentRef.path} after ${delay}ms`, err.error);
      return err.retryAfter(delay);
    }
    console.error("[BulkWriter] giving up:", err.error?.message || err.error);
    return false;
  });
  return writer;
}

// Fallback if you don't want BulkWriter: chunked batches + sleep + retry
export async function writeChunkWithRetry(adminDb, ops, { chunkSize = 200, baseDelay = 250 } = {}) {
  let written = 0;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const slice = ops.slice(i, i + chunkSize);
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempts += 1;
      const batch = adminDb.batch();
      for (const { ref, data, opts } of slice) {
        batch.set(ref, data, opts || { merge: true });
      }
      try {
        await batch.commit();
        written += slice.length;
        // small pacing delay between chunks
        await sleep(baseDelay);
        break;
      } catch (e) {
        if (attempts >= 5) {
          console.error("Batch commit failed permanently:", e);
          throw e;
        }
        const delay = baseDelay * Math.pow(2, attempts); // 250, 500, 1000, 2000, 4000
        console.warn(`Batch commit failed (attempt ${attempts}), retrying in ${delay}ms`, e?.message || e);
        await sleep(delay);
      }
    }
  }
  return written;
}
