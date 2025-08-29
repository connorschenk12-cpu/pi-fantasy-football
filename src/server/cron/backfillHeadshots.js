/* eslint-disable no-console */
import { adminDb } from "../../lib/firebaseAdmin.js";

export async function backfillHeadshots({ adminDb: injected } = {}) {
  const db = injected || adminDb;

  const snap = await db.collection("players").get();
  const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: 150, maxOpsPerSecond: 300 } });
  writer.onWriteError((err) => (err.code === 8 && err.failedAttempts < 5 ? true : false));

  let touched = 0;
  for (const d of snap.docs) {
    const p = d.data() || {};
    if (p.photo) continue;
    const eid = p.espnId || p.espn_id;
    if (!eid) continue;
    const idStr = String(eid).replace(/[^\d]/g, "");
    if (!idStr) continue;
    const url = `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png`;
    writer.update(d.ref, { photo: url, updatedAt: new Date() });
    touched += 1;
  }
  await writer.close();
  return { ok:true, updated:touched };
}
