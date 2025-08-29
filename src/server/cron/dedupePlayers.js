/* eslint-disable no-console */
// src/server/cron/dedupePlayers.js
// Page through players, keep the best doc per identity, and rewrite conflicts minimally.
// Identity priority: espnId > (name|team|pos). Fresher updatedAt wins.

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function commitWithBackoff(batch, attempt=0){
  try { await batch.commit(); }
  catch(e){
    const msg = String(e?.message||e);
    if (/RESOURCE_EXHAUSTED/i.test(msg) && attempt < 5){
      const wait = 300 * Math.pow(2, attempt);
      console.warn(`dedupe: backoff ${wait}ms (attempt ${attempt+1})`);
      await sleep(wait);
      return commitWithBackoff(batch, attempt+1);
    }
    throw e;
  }
}

function ts(p){
  const v = p?.updatedAt;
  try{
    if (!v) return 0;
    if (v.toDate) return v.toDate().getTime();
    if (v.seconds) return Number(v.seconds)*1000;
    if (v instanceof Date) return v.getTime();
    return Number(v) || 0;
  }catch{ return 0; }
}

function identityFor(p){
  const eid = p.espnId ?? p.espn_id ?? (p.espn && (p.espn.playerId || p.espn.id)) ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name||"").toLowerCase()}|${(p.team||"").toLowerCase()}|${(p.position||"").toLowerCase()}`;
  return `ntp:${k}`;
}

function chooseBest(a,b){
  const ta = ts(a), tb = ts(b);
  if (ta !== tb) return ta > tb ? a : b;
  // Prefer one that has espnId/photo/projections populated
  const score = (x)=> (x.espnId?3:0) + (x.photo?1:0) + (x.projections && Object.keys(x.projections||{}).length?1:0);
  const sa = score(a), sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a;
}

export async function dedupePlayers({ adminDb, limit=50, cursor=null }){
  const pageSize = Math.max(1, Math.min(Number(limit)||50, 100));
  const col = adminDb.collection("players");

  // Read a page
  let q = col.orderBy("name").orderBy("id").limit(pageSize);
  if (cursor && cursor.includes("|")){
    const [n,i] = cursor.split("|");
    q = q.startAfter(n, i);
  }
  const snap = await q.get();
  if (snap.empty) return { ok:true, done:true, processed:0, removed:0, merged:0 };

  // Build identities within this page (local dedupe per page to avoid huge memory)
  const byIdent = new Map();
  const bucket = [];
  for (const d of snap.docs){
    const p = { id: d.id, ...(d.data()||{}) };
    const ident = identityFor(p);
    const cur = byIdent.get(ident);
    if (!cur) byIdent.set(ident, { best: p, rest: [] });
    else cur.rest.push(p);
    bucket.push(p);
  }

  // For each identity with conflicts, keep best and remove/merge others
  let processed = snap.size;
  let removed = 0;
  let merged  = 0;

  const batch = adminDb.batch();

  for (const [ident, grp] of byIdent.entries()){
    if (grp.rest.length === 0) continue;

    // compute best among all
    let winner = grp.best;
    for (const r of grp.rest) winner = chooseBest(winner, r);

    // apply minimal merges: keep winner's docId === winner.id; delete others
    for (const candidate of [grp.best, ...grp.rest]){
      if (candidate.id === winner.id) continue;

      // Merge: if winner lacks some lightweight fields, copy from candidate
      const updates = {};
      if (!winner.espnId && candidate.espnId) updates.espnId = candidate.espnId;
      if (!winner.photo  && candidate.photo)  updates.photo  = candidate.photo;
      if (!winner.team   && candidate.team)   updates.team   = candidate.team;
      if (!winner.position && candidate.position) updates.position = candidate.position;

      // Merge projections shallowly (prefer winner’s existing)
      if (candidate.projections && typeof candidate.projections === "object"){
        const mergedProj = { ...(winner.projections||{}) };
        for (const [wk, val] of Object.entries(candidate.projections)){
          if (mergedProj[wk] == null && val != null) mergedProj[wk] = Number(val) || 0;
        }
        if (Object.keys(mergedProj).length !== Object.keys(winner.projections||{}).length){
          updates.projections = mergedProj;
        }
      }

      if (Object.keys(updates).length){
        batch.set(col.doc(winner.id), { ...updates, updatedAt: new Date() }, { merge:true });
        merged += 1;
      }

      // delete the duplicate doc
      batch.delete(col.doc(candidate.id));
      removed += 1;
    }
  }

  if (removed || merged){
    await commitWithBackoff(batch);
    await sleep(300);
  }

  const last = snap.docs[snap.docs.length-1];
  const nextCursor = `${last.get("name")||""}|${last.get("id")||last.id}`;

  return { ok:true, processed, removed, merged, done: snap.size < pageSize, nextCursor };
}

export default dedupePlayers;
