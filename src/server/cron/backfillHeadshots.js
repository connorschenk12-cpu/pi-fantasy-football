/* eslint-disable no-console */
// src/server/cron/backfillHeadshots.js
// Pages through players and only fills missing headshots.
// Uses exponential backoff on commit. Cursor: "<name>|<id>"

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function commitWithBackoff(batch, attempt=0){
  try { await batch.commit(); }
  catch(e){
    const msg = String(e?.message||e);
    if (/RESOURCE_EXHAUSTED/i.test(msg) && attempt < 5){
      const wait = 300 * Math.pow(2, attempt);
      console.warn(`headshots: backoff ${wait}ms (attempt ${attempt+1})`);
      await sleep(wait);
      return commitWithBackoff(batch, attempt+1);
    }
    throw e;
  }
}

function espnHeadshot(espnId){
  const idStr = String(espnId||"").replace(/[^\d]/g,"");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
}

export async function backfillHeadshots({ adminDb, limit=25, cursor=null }){
  const col = adminDb.collection("players");
  let q = col.orderBy("name").orderBy("id").limit(Math.max(1, Math.min(limit, 100)));

  if (cursor && cursor.includes("|")){
    const [n,i] = cursor.split("|");
    q = q.startAfter(n, i);
  }

  const snap = await q.get();
  if (snap.empty) return { ok:true, done:true, processed:0, updated:0 };

  let processed = 0;
  let updated = 0;
  const batch = adminDb.batch();

  for (const d of snap.docs){
    processed += 1;
    const p = d.data() || {};
    if (p.photo) continue;

    const espnId =
      p.espnId ?? p.espn_id ?? (p.espn && (p.espn.playerId || p.espn.id)) ?? null;
    const photo = espnHeadshot(espnId);
    if (!photo) continue;

    batch.set(d.ref, { photo, updatedAt: new Date() }, { merge:true });
    updated += 1;
  }

  if (updated > 0){
    await commitWithBackoff(batch);
    await sleep(300);
  }

  const last = snap.docs[snap.docs.length-1];
  const nextCursor = `${last.get("name")||""}|${last.get("id")||last.id}`;

  return { ok:true, processed, updated, done: snap.size < Math.max(1, Math.min(limit, 100)), nextCursor };
}

export default backfillHeadshots;
