// api/tools/dedupe-players.js
/* eslint-disable no-console */

import { adminDb } from "../../src/lib/firebaseAdmin.js";

// ---------- helpers ----------
const norm = (s) => String(s || "").trim().toLowerCase();

function identityFor(p) {
  const eid =
    p.espnId ??
    p.espn_id ??
    (p.espn && (p.espn.playerId || p.espn.id)) ??
    null;
  if (eid) return `espn:${String(eid)}`;
  const name =
    p.name ||
    p.displayName ||
    p.fullName ||
    p.playerName ||
    (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
    "";
  const team = p.team || p.nflTeam || p.proTeam || "";
  const pos = (p.position || p.pos || "").toString().toUpperCase();
  return `ntp:${norm(name)}|${norm(team)}|${norm(pos)}`;
}

function ts(p) {
  const raw = p.updatedAt;
  if (!raw) return 0;
  try {
    if (raw.toDate) return raw.toDate().getTime();      // Firestore Timestamp (client-like)
    if (raw.seconds) return Number(raw.seconds) * 1000; // Firestore Timestamp (admin)
    if (raw instanceof Date) return raw.getTime();
    return Number(raw) || 0;
  } catch (_) {
    return 0;
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const toNumOrNull = (v) => (v == null || v === "" ? null : Number(v));
const gt0 = (v) => isNum(v) && v > 0;

function normalizeProj(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = toNumOrNull(v);
    if (n == null || Number.isNaN(n)) continue;
    out[String(k)] = n;
  }
  return out;
}
function mergeProjections(a = {}, b = {}) {
  const A = normalizeProj(a);
  const B = normalizeProj(b);
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  const out = {};
  for (const k of keys) {
    const av = A[k];
    const bv = B[k];
    // prefer incoming if positive; else keep existing if defined; else take numeric bv (incl 0) or 0
    out[k] = gt0(bv) ? bv : (av != null ? av : (isNum(bv) ? bv : 0));
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
function mergeMatchups(a = {}, b = {}) {
  const A = normalizeMatchups(a);
  const B = normalizeMatchups(b);
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  const out = {};
  for (const k of keys) {
    const ea = A[k] || {};
    const eb = B[k] || {};
    out[k] = eb.opp ? { ...ea, ...eb } : { ...ea };
  }
  return out;
}

function pickBest(a, b) {
  // Prefer doc with fresher updatedAt; tie-breaker: the one with more projections keys
  const ta = ts(a);
  const tb = ts(b);
  if (ta !== tb) return ta > tb ? a : b;

  const pa = a?.projections ? Object.keys(a.projections).length : 0;
  const pb = b?.projections ? Object.keys(b.projections).length : 0;
  if (pa !== pb) return pa > pb ? a : b;

  // Final fallback: keep a
  return a;
}

function httpish(u) {
  if (!u || typeof u !== "string") return false;
  return /^https?:\/\//i.test(u);
}

function choosePhoto(a, b) {
  const ca =
    a.photo || a.photoUrl || a.photoURL || a.headshot || a.headshotUrl || a.image || a.imageUrl || a.img || a.avatar || null;
  const cb =
    b.photo || b.photoUrl || b.photoURL || b.headshot || b.headshotUrl || b.image || b.imageUrl || b.img || b.avatar || null;
  // prefer ESPN if either has espnId
  const eida =
    a.espnId ?? a.espn_id ?? (a.espn && (a.espn.playerId || a.espn.id)) ?? null;
  const eidb =
    b.espnId ?? b.espn_id ?? (b.espn && (b.espn.playerId || b.espn.id)) ?? null;
  const eid = eida || eidb;
  if (eid) {
    const idStr = String(eid).replace(/[^\d]/g, "");
    if (idStr) return `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png`;
  }
  if (httpish(cb)) return cb;
  if (httpish(ca)) return ca;
  return null;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const apply = /(^|\b)(apply=1|apply=true)(\b|$)/i.test(req.url || "");

    // 1) read all global players
    const snap = await adminDb.collection("players").get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data(), __ref: d.ref }));

    // 2) group by identity
    const groups = new Map();
    for (const p of all) {
      const key = identityFor(p);
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }

    // 3) figure out merges/deletions
    const mergePlans = [];
    const deletes = [];

    for (const [_, arr] of groups.entries()) {
      if (arr.length <= 1) continue;

      // pick canonical
      let canonical = arr[0];
      for (let i = 1; i < arr.length; i++) {
        canonical = pickBest(canonical, arr[i]);
      }

      // compute “super” doc by merging fields from others into canonical
      let merged = { ...canonical };
      for (const p of arr) {
        if (p.id === canonical.id) continue;

        // strengthen projections & matchups
        merged.projections = mergeProjections(merged.projections, p.projections);
        merged.matchups = mergeMatchups(merged.matchups, p.matchups);

        // prefer filled team/position/name if missing
        merged.team = merged.team || p.team || p.nflTeam || p.proTeam || null;
        merged.position = (merged.position || p.position || p.pos || "").toString().toUpperCase() || null;

        // prefer having espnId
        const eidMerged =
          merged.espnId ??
          merged.espn_id ??
          (merged.espn && (merged.espn.playerId || merged.espn.id)) ??
          null;
        const eidP =
          p.espnId ??
          p.espn_id ??
          (p.espn && (p.espn.playerId || p.espn.id)) ??
          null;
        if (!eidMerged && eidP) merged.espnId = String(eidP);

        // photo
        merged.photo = choosePhoto(merged, p);
      }

      // ensure name is set
      merged.name =
        merged.name ||
        merged.displayName ||
        merged.fullName ||
        merged.playerName ||
        (merged.firstName && merged.lastName ? `${merged.firstName} ${merged.lastName}` : null) ||
        canonical.name ||
        canonical.id;

      mergePlans.push({ id: canonical.id, ref: canonical.__ref, data: merged });

      // all non-canonical become deletes
      for (const p of arr) if (p.id !== canonical.id) deletes.push(p.__ref);
    }

    // 4) apply if requested
    let updated = 0;
    let deleted = 0;

    if (apply) {
      // write merges in chunks
      for (let i = 0; i < mergePlans.length; i += 400) {
        const batch = adminDb.batch();
        const chunk = mergePlans.slice(i, i + 400);
        for (const m of chunk) {
          batch.set(m.ref, {
            id: m.id,
            name: m.data.name || m.id,
            position: (m.data.position || "").toString().toUpperCase() || null,
            team: m.data.team || null,
            projections: m.data.projections || {},
            matchups: m.data.matchups || {},
            espnId:
              m.data.espnId ??
              m.data.espn_id ??
              (m.data.espn && (m.data.espn.playerId || m.data.espn.id)) ??
              null,
            photo: m.data.photo || null,
            updatedAt: new Date(),
          }, { merge: true });
        }
        await batch.commit();
        updated += chunk.length;
      }

      // delete duplicates in chunks
      for (let i = 0; i < deletes.length; i += 400) {
        const batch = adminDb.batch();
        const chunk = deletes.slice(i, i + 400);
        for (const ref of chunk) batch.delete(ref);
        await batch.commit();
        deleted += chunk.length;
      }
    }

    return res.status(200).json({
      ok: true,
      applied: !!apply,
      mergedCandidates: mergePlans.length,
      deleteCandidates: deletes.length,
      updated,
      deleted,
    });
  } catch (e) {
    console.error("dedupe-players error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
