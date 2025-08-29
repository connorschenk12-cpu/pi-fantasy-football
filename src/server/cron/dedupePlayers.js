// src/server/cron/dedupePlayers.js
/* eslint-disable no-console */
import { getBulkWriterWithBackoff, sleep } from "./firestoreWrite.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const toNum = (v) => (v == null || v === "" ? null : Number(v));
const gt0 = (v) => isNum(v) && v > 0;

function normalizeProj(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const num = toNum(v);
    if (num == null || Number.isNaN(num)) continue;
    out[String(k)] = num;
  }
  return out;
}
function mergeProjections(existing = {}, incoming = {}) {
  const a = normalizeProj(existing);
  const b = normalizeProj(incoming);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    // prefer incoming if it's a positive number; else keep existing if defined
    out[k] = gt0(vb) ? vb : (va != null ? va : (isNum(vb) ? vb : 0));
  }
  return out;
}
function normalizeMatchups(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      out[String(k)] = {
        opp: v.opp ?? v.opponent ?? v.vs ?? v.against ?? "",
        ...v,
      };
    }
  }
  return out;
}
function mergeMatchups(existing = {}, incoming = {}) {
  const a = normalizeMatchups(existing);
  const b = normalizeMatchups(incoming);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const ea = a[k] || {};
    const eb = b[k] || {};
    // prefer incoming if it has an opponent label
    out[k] = eb.opp ? { ...ea, ...eb } : { ...ea };
  }
  return out;
}

// interpret updatedAt across shapes
function ts(p) {
  const raw = p.updatedAt;
  if (!raw) return 0;
  try {
    if (raw.toDate) return raw.toDate().getTime();      // Firestore Timestamp (client)
    if (raw.seconds) return Number(raw.seconds) * 1000; // Firestore Timestamp (admin)
    if (raw instanceof Date) return raw.getTime();      // Date
    return Number(raw) || 0;                            // ms
  } catch (_) {
    return 0;
  }
}

// winner choice: prefer espnId presence, then newer updatedAt, then keep first (stable)
function better(a, b) {
  const aHasEspn = !!(a.espnId ?? a.espn_id);
  const bHasEspn = !!(b.espnId ?? b.espn_id);
  if (aHasEspn !== bHasEspn) return aHasEspn ? a : b;
  const ta = ts(a);
  const tb = ts(b);
  if (ta !== tb) return ta > tb ? a : b;
  return a;
}

// identity: espnId if present, else name|team|position
function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export async function dedupePlayers({ adminDb }) {
  const col = adminDb.collection("players");
  const snap = await col.get();
  if (snap.empty) return { ok: true, scanned: 0, groups: 0, deleted: 0, merged: 0 };

  // 1) group by identity
  const groups = new Map(); // ident -> [docs...]
  let scanned = 0;
  for (const d of snap.docs) {
    scanned += 1;
    const p = d.data() || {};
    p.__ref = d.ref;
    const ident = identityFor(p);
    if (!groups.has(ident)) groups.set(ident, []);
    groups.get(ident).push(p);
  }

  // 2) choose a winner per group; merge projections/matchups into winner; delete others
  const writer = getBulkWriterWithBackoff(adminDb);
  let deleted = 0;
  let merged = 0;
  let groupCount = 0;

  for (const [ident, arr] of groups.entries()) {
    groupCount += 1;
    if (arr.length === 1) continue;

    // pick champion
    let champion = arr[0];
    for (let i = 1; i < arr.length; i++) champion = better(champion, arr[i]);

    // merge in the rest
    let nextProjections = champion.projections || {};
    let nextMatchups = champion.matchups || {};
    let changed = false;

    for (const p of arr) {
      if (p === champion) continue;
      const mergedProj = mergeProjections(nextProjections, p.projections);
      const mergedM = mergeMatchups(nextMatchups, p.matchups);

      const projChanged = JSON.stringify(mergedProj) !== JSON.stringify(nextProjections);
      const matchChanged = JSON.stringify(mergedM) !== JSON.stringify(nextMatchups);
      if (projChanged || matchChanged) changed = true;

      nextProjections = mergedProj;
      nextMatchups = mergedM;
    }

    // write champion updates if changed
    if (changed) {
      writer.set(
        champion.__ref,
        { projections: nextProjections, matchups: nextMatchups, updatedAt: new Date() },
        { merge: true }
      );
      merged += 1;
    }

    // delete losers
    for (const p of arr) {
      if (p === champion) continue;
      writer.delete(p.__ref);
      deleted += 1;
    }

    // tiny pacing
    if ((deleted + merged) % 300 === 0) await sleep(250);
  }

  await writer.close();
  return { ok: true, scanned, groups: groupCount, deleted, merged };
}
