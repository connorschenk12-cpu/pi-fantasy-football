/* eslint-disable no-console */
import { adminDb } from "../../lib/firebaseAdmin.js";

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export async function dedupePlayers({ adminDb: injected } = {}) {
  const db = injected || adminDb;

  const snap = await db.collection("players").get();
  const byIdent = new Map();
  const dupes = [];

  for (const d of snap.docs) {
    const p = d.data() || {};
    const key = identityFor(p);
    const cur = byIdent.get(key);
    if (!cur) byIdent.set(key, { ref: d.ref, data: p });
    else {
      // keep the one with espnId/photo or newer updatedAt
      const better = (a, b) => {
        const aScore =
          (a.data.espnId ? 2 : 0) + (a.data.photo ? 1 : 0) + (a.data.updatedAt ? 0.1 : 0);
        const bScore =
          (b.data.espnId ? 2 : 0) + (b.data.photo ? 1 : 0) + (b.data.updatedAt ? 0.1 : 0);
        return aScore >= bScore ? a : b;
      };
      const keep = better(cur, { ref: d.ref, data: p });
      const drop = keep.ref.isEqual(cur.ref) ? { ref: d.ref } : cur;
      byIdent.set(key, keep);
      dupes.push(drop.ref);
    }
  }

  if (!dupes.length) return { ok:true, deleted:0 };
  const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: 150, maxOpsPerSecond: 300 } });
  writer.onWriteError((err) => (err.code === 8 && err.failedAttempts < 5 ? true : false));
  for (const ref of dupes) writer.delete(ref);
  await writer.close();
  return { ok:true, deleted: dupes.length };
}
