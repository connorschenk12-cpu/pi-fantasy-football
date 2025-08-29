// api/cron/dedupe-players.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const BATCH_CHUNK = 300;

const asId = (x) => (x == null ? null : String(x).trim());
const norm = (s) => String(s || "").trim().toLowerCase();
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const toNum = (v) => (v == null || v === "" ? null : Number(v));
const gt0 = (v) => isNum(v) && v > 0;

function ts(p) {
  const raw = p?.updatedAt;
  if (!raw) return 0;
  try {
    if (raw.toDate) return raw.toDate().getTime(); // Firestore Timestamp
    if (raw.seconds) return Number(raw.seconds) * 1000; // Admin Timestamp
    if (raw instanceof Date) return raw.getTime();
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? (p.espn && (p.espn.playerId || p.espn.id)) ?? null;
  if (eid) return `espn:${String(eid)}`;
  const name = (p.name || p.fullName || p.playerName || "").toLowerCase();
  const tm = (p.team || p.nflTeam || p.proTeam || "").toLowerCase();
  const pos = (p.position || p.pos || "").toLowerCase();
  return `ntp:${name}|${tm}|${pos}`;
}

function better(a, b) {
  const ta = ts(a);
  const tb = ts(b);
  if (ta !== tb) return ta > tb ? a : b;
  return a; // stable
}

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
function mergeProjections(a0 = {}, b0 = {}) {
  const a = normalizeProj(a0);
  const b = normalizeProj(b0);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    out[k] = gt0(vb) ? vb : (va != null ? va : (isNum(vb) ? vb : 0));
  }
  return out;
}
function normalizeMatchups(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") out[String(k)] = { opp: v.opp ?? v.opponent ?? "", ...v };
  }
  return out;
}
function mergeMatchups(a0 = {}, b0 = {}) {
  const a = normalizeMatchups(a0);
  const b = normalizeMatchups(b0);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const ea = a[k] || {};
    const eb = b[k] || {};
    out[k] = eb.opp ? { ...ea, ...eb } : { ...ea };
  }
  return out;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const snap = await adminDb.collection("players").get();
    if (snap.empty) return res.json({ ok: true, deduped: 0, kept: 0, deleted: 0 });

    // 1) group by identity
    const groups = new Map(); // ident -> [docs...]
    for (const d of snap.docs) {
      const row = { id: d.id, ...d.data() };
      const ident = identityFor(row);
      if (!groups.has(ident)) groups.set(ident, []);
      groups.get(ident).push(row);
    }

    // 2) choose best per group & collect removes
    const keepers = [];
    const deletes = [];
    for (const arr of groups.values()) {
      if (arr.length === 1) {
        keepers.push(arr[0]);
        continue;
      }
      // pick the freshest
      let best = arr[0];
      for (let i = 1; i < arr.length; i++) best = better(best, arr[i]);

      // merge info into best
      let merged = { ...best };
      for (const p of arr) {
        if (p.id === best.id) continue;
        merged = {
          ...merged,
          // prefer non-empty canonical fields, but keep best's if already set
          name: merged.name || p.name || merged.fullName || p.fullName || merged.playerName || p.playerName || merged.id,
          position: (merged.position || p.position || "").toUpperCase() || null,
          team: merged.team || p.team || p.nflTeam || p.proTeam || null,
          espnId: merged.espnId || p.espnId || p.espn_id || (p.espn && (p.espn.playerId || p.espn.id)) || null,
          photo: merged.photo || p.photo || p.photoUrl || p.headshot || p.image || null,
          projections: mergeProjections(merged.projections, p.projections),
          matchups: mergeMatchups(merged.matchups, p.matchups),
        };
      }

      keepers.push(merged);
      for (const p of arr) if (p.id !== merged.id) deletes.push(p.id);
    }

    // 3) write keepers (merge) + delete duplicates in safe chunks
    let wrote = 0;
    let removed = 0;
    let batch = adminDb.batch();
    let ops = 0;

    for (const k of keepers) {
      const ref = adminDb.collection("players").doc(asId(k.id));
      batch.set(
        ref,
        {
          id: asId(k.id),
          name: k.name,
          position: (k.position || "").toUpperCase() || null,
          team: k.team || null,
          espnId: k.espnId || null,
          photo: k.photo || null,
          projections: k.projections || {},
          matchups: k.matchups || {},
          updatedAt: new Date(),
        },
        { merge: true }
      );
      ops++; wrote++;

      if (ops >= BATCH_CHUNK) {
        await batch.commit();
        batch = adminDb.batch();
        ops = 0;
      }
    }

    for (const id of deletes) {
      const ref = adminDb.collection("players").doc(asId(id));
      batch.delete(ref);
      ops++; removed++;

      if (ops >= BATCH_CHUNK) {
        await batch.commit();
        batch = adminDb.batch();
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    return res.json({
      ok: true,
      groups: groups.size,
      kept: wrote,
      deleted: removed,
    });
  } catch (e) {
    console.error("dedupe-players error:", e);
    return res.status(500).json({ ok: false, where: "dedupe-players", error: String(e?.message || e) });
  }
}
