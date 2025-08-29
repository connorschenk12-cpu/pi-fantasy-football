/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Paged + throttled seeding of per-week projections.
// Call via: /api/cron?task=projections&week=1&limit=50[&cursor=<name|id>][&overwrite=true]

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function commitWithBackoff(batch, attempt=0){
  try { await batch.commit(); }
  catch(e){
    const msg = String(e?.message||e);
    if (/RESOURCE_EXHAUSTED/i.test(msg) && attempt < 5){
      const wait = 300 * Math.pow(2, attempt);
      console.warn(`projections: backoff ${wait}ms (attempt ${attempt+1})`);
      await sleep(wait);
      return commitWithBackoff(batch, attempt+1);
    }
    throw e;
  }
}

// very light baseline PPR projections just to keep UI meaningful
const BASELINE = {
  QB: 16.0,
  RB: 12.0,
  WR: 11.0,
  TE: 8.0,
  K: 7.0,
  DEF: 6.0,
};

function normPos(p){
  const raw = (p?.position || p?.pos || "").toString().toUpperCase();
  if (raw.includes("DST") || raw === "D/ST" || raw === "DEFENSE") return "DEF";
  return raw || "FLEX";
}

function computeProjection(p){
  const pos = normPos(p);
  if (BASELINE[pos] != null) return BASELINE[pos];
  // unknown position → very small baseline
  return 5.0;
}

/**
 * Page through players ordered by (name, id).
 * For each player, if projections[week] is missing (or overwrite=true),
 * set a baseline value.
 */
export async function seedWeekProjections({
  adminDb,
  week,
  season,          // currently unused (here for future external sources)
  limit = 50,
  cursor = null,
  overwrite = false,
}) {
  if (!Number.isFinite(Number(week)) || Number(week) <= 0) {
    return { ok:false, error:"week is required and must be > 0" };
  }
  const wKey = String(week);

  const pageSize = Math.max(1, Math.min(Number(limit)||50, 100));
  const col = adminDb.collection("players");

  let q = col.orderBy("name").orderBy("id").limit(pageSize);
  if (cursor && cursor.includes("|")){
    const [n,i] = cursor.split("|");
    q = q.startAfter(n, i);
  }

  const snap = await q.get();
  if (snap.empty) return { ok:true, done:true, processed:0, updated:0, skipped:0 };

  let processed = 0;
  let updated = 0;
  let skipped  = 0;

  const batch = adminDb.batch();

  for (const d of snap.docs){
    processed += 1;
    const p = d.data() || {};
    const projections = (p.projections && typeof p.projections === "object") ? { ...p.projections } : {};

    const hasValue = projections[wKey] != null && projections[wKey] !== "";
    if (hasValue && !String(overwrite).toLowerCase().startsWith("t")) {
      skipped += 1;
      continue;
    }

    // Only set if missing OR overwrite=true
    const value = computeProjection(p);
    projections[wKey] = Number(value) || 0;

    batch.set(d.ref, { projections, updatedAt: new Date() }, { merge:true });
    updated += 1;
  }

  if (updated > 0){
    await commitWithBackoff(batch);
    await sleep(250);
  }

  const last = snap.docs[snap.docs.length-1];
  const nextCursor = `${last.get("name")||""}|${last.get("id")||last.id}`;

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done: snap.size < pageSize,
    nextCursor,
  };
}

export default seedWeekProjections;
