// api/tools/dedupe-players.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = {
  maxDuration: 60, // give ourselves enough time in serverless
};

// ---------- helpers ----------
function asId(x) {
  if (x == null) return null;
  if (typeof x === "object" && x.id != null) return String(x.id).trim();
  return String(x).trim();
}

// normalize strings for identity key
function norm(s) {
  return String(s || "").trim().toLowerCase();
}

// pick a display-ish name
function displayName(p) {
  const firstLast =
    (p.firstName || p.firstname || p.fname || "") +
    (p.lastName || p.lastname || p.lname ? " " + (p.lastName || p.lastname || p.lname) : "");
  return (
    p.name ||
    p.displayName ||
    p.fullName ||
    p.playerName ||
    (firstLast.trim() || null) ||
    (p.nickname || null) ||
    (p.id != null ? String(p.id) : "(unknown)")
  );
}

// identity: prefer espnId; else name|team|pos
function identityFor(p) {
  const eid =
    p.espnId ??
    p.espn_id ??
    (p.espn && (p.espn.playerId || p.espn.id)) ??
    null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${norm(displayName(p))}|${norm(p.team || p.nflTeam || p.proTeam)}|${norm(
    (p.position || p.pos || "").toString().toUpperCase()
  )}`;
  return `ntp:${k}`;
}

// interpret updatedAt across shapes to ms
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

// score: prefer more recent; break ties by richer data (projections/photo/espnId)
function score(p) {
  const t = ts(p);
  const projCount = p?.projections ? Object.keys(p.projections).length : 0;
  const hasPhoto =
    !!(p.photo || p.photoUrl || p.photoURL || p.headshot || p.headshotUrl || p.image || p.imageUrl);
  const hasEspn = !!(p.espnId || p.espn_id || (p.espn && (p.espn.playerId || p.espn.id)));
  // weight: time dominant, then espnId, then projections, then photo
  return t * 1e6 + (hasEspn ? 1e5 : 0) + projCount * 10 + (hasPhoto ? 5 : 0);
}

// merge projections (keep positive incoming; fall back to existing)
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
    if (v && typeof v === "object") {
      out[String(k)] = {
        opp: v.opp ?? v.opponent ?? v.vs ?? v.against ?? "",
        ...v,
      };
    }
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

function pickBestDoc(docs) {
  let best = null;
  let bestScore = -Infinity;
  for (const d of docs) {
    const s = score(d.data);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

export default async function handler(req, res) {
  const dryRun = !("apply" in (req.query || {})) && !("apply" in (req.body || {}));
  try {
    // Optional simple auth header (matches what LeagueAdmin sends)
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 1) Load all global players
    const snap = await adminDb.collection("players").get();
    if (snap.empty) {
      return res.status(200).json({
        ok: true,
        dryRun,
        total: 0,
        groups: 0,
        duplicateGroups: 0,
        duplicates: [],
        message: "No players found.",
      });
    }

    // 2) Group by identity
    const groups = new Map();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const idKey = identityFor(data);
      const arr = groups.get(idKey) || [];
      arr.push({ id: doc.id, ref: doc.ref, data });
      groups.set(idKey, arr);
    }

    // 3) For each group, decide winner and losers, and prepare merges
    let duplicateGroups = 0;
    let toDelete = [];
    let toUpdate = [];
    const examples = [];

    for (const [idKey, docs] of groups.entries()) {
      if (docs.length <= 1) continue;

      duplicateGroups += 1;
      const winner = pickBestDoc(docs);
      const losers = docs.filter((d) => d !== winner);

      // Merge all losers' data into winner
      let merged = { ...winner.data };
      for (const L of losers) {
        const ld = L.data || {};
        // identity-ish fields
        merged.espnId =
          merged.espnId ??
          merged.espn_id ??
          ld.espnId ??
          ld.espn_id ??
          (ld.espn && (ld.espn.playerId || ld.espn.id)) ??
          null;

        // photo
        merged.photo =
          merged.photo ||
          merged.photoUrl ||
          merged.headshot ||
          merged.image ||
          ld.photo ||
          ld.photoUrl ||
          ld.headshot ||
          ld.image ||
          null;

        // projections & matchups
        merged.projections = mergeProjections(merged.projections, ld.projections);
        merged.matchups = mergeMatchups(merged.matchups, ld.matchups);

        // keep best name/position/team if missing
        merged.name = merged.name || displayName(ld);
        merged.position = (merged.position || merged.pos || "").toString().toUpperCase() ||
                          (ld.position || ld.pos || "");
        merged.team = merged.team || ld.team || ld.nflTeam || ld.proTeam || null;
      }

      // normalize minimal shape
      merged = {
        ...merged,
        id: asId(winner.id),
        name: displayName(merged),
        position: (merged.position || merged.pos || "").toString().toUpperCase() || null,
        team: merged.team || merged.nflTeam || merged.proTeam || null,
        updatedAt: new Date(),
      };

      toUpdate.push({ ref: winner.ref, data: merged });
      toDelete.push(...losers.map((l) => l.ref));

      if (examples.length < 15) {
        examples.push({
          identity: idKey,
          keep: winner.id,
          remove: losers.map((l) => l.id),
        });
      }
    }

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        total: snap.size,
        groups: groups.size,
        duplicateGroups,
        toUpdate: toUpdate.length,
        toDelete: toDelete.length,
        examples,
        tip: "Add ?apply=1 to apply changes.",
      });
    }

    // 4) Apply: update winners, delete losers in chunks
    let updated = 0;
    let deleted = 0;

    const CHUNK = 400;
    for (let i = 0; i < Math.max(toUpdate.length, toDelete.length); i += CHUNK) {
      const batch = adminDb.batch();

      // updates chunked
      for (let j = i; j < Math.min(i + CHUNK, toUpdate.length); j++) {
        const { ref, data } = toUpdate[j];
        batch.set(ref, data, { merge: true });
        updated++;
      }
      // deletes chunked
      for (let j = i; j < Math.min(i + CHUNK, toDelete.length); j++) {
        const ref = toDelete[j];
        batch.delete(ref);
        deleted++;
      }

      await batch.commit();
    }

    return res.status(200).json({
      ok: true,
      dryRun: false,
      total: snap.size,
      groups: groups.size,
      duplicateGroups,
      updated,
      deleted,
      examples,
    });
  } catch (err) {
    console.error("dedupe-players error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: process.env.NODE_ENV !== "production" ? err?.stack : undefined,
      where: "dedupe-players",
    });
  }
}
