/* eslint-disable no-console */
// api/tools/dedupe-players.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

function norm(s) {
  return String(s || "").trim().toLowerCase();
}
function asId(x) {
  if (x == null) return null;
  if (typeof x === "object" && x.id != null) return String(x.id).trim();
  return String(x).trim();
}
function playerDisplay(p) {
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
    (p.player || null) ||
    (p.player_id_name || null) ||
    (p.PlayerName || null) ||
    (p.Player || null) ||
    (p.Name || null) ||
    (p.n || null) ||
    (p.title || null) ||
    (p.label || null) ||
    (p.text || null) ||
    (p.id != null ? String(p.id) : "(unknown)")
  );
}

// ---------- projections/matchups merge ----------
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
function mergeProjections(a = {}, b = {}) {
  const A = normalizeProj(a);
  const B = normalizeProj(b);
  const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
  const out = {};
  for (const k of keys) {
    const va = A[k];
    const vb = B[k];
    out[k] = gt0(vb) ? vb : (va != null ? va : (isNum(vb) ? vb : 0));
  }
  return out;
}
function normalizeMatchups(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      out[String(k)] = { opp: v.opp ?? v.opponent ?? v.vs ?? v.against ?? "", ...v };
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

// ---------- identity & tie-breakers ----------
function espnIdOf(p) {
  return (
    p.espnId ??
    p.espn_id ??
    (p.espn && (p.espn.playerId || p.espn.id)) ??
    null
  );
}
function identityFor(p) {
  const eid = espnIdOf(p);
  if (eid) return `espn:${String(eid)}`;
  const name = norm(playerDisplay(p));
  const team = norm(p.team || p.nflTeam || p.proTeam);
  const pos  = norm(p.position || p.pos);
  return `ntp:${name}|${team}|${pos}`;
}
function ts(p) {
  const raw = p.updatedAt;
  if (!raw) return 0;
  try {
    if (raw.toDate) return raw.toDate().getTime();     // client Timestamp
    if (raw.seconds) return Number(raw.seconds) * 1000;// admin Timestamp
    if (raw instanceof Date) return raw.getTime();
    return Number(raw) || 0;
  } catch (_) { return 0; }
}
function hasPhoto(p) {
  return !!(p.photo || p.photoUrl || p.photoURL || p.headshot || p.headshotUrl || p.image || p.imageUrl || p.img || p.avatar);
}
// Return preferred doc between a and b
function better(a, b) {
  const ta = ts(a), tb = ts(b);
  if (ta !== tb) return ta > tb ? a : b;
  const aHasEspn = !!espnIdOf(a), bHasEspn = !!espnIdOf(b);
  if (aHasEspn !== bHasEspn) return aHasEspn ? a : b;
  const aPhoto = hasPhoto(a), bPhoto = hasPhoto(b);
  if (aPhoto !== bPhoto) return aPhoto ? a : b;
  return a; // stable
}

function chooseDocId(base) {
  const eid = espnIdOf(base);
  if (eid) return `espn-${String(eid)}`;
  const name = norm(playerDisplay(base)).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  const team = norm(base.team || base.nflTeam || base.proTeam).replace(/[^a-z0-9]+/g, "-").slice(0, 16);
  const pos  = norm(base.position || base.pos).replace(/[^a-z0-9]+/g, "-").slice(0, 8);
  return `p-${name}-${team}-${pos}`;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    // Require a header secret if you like (optional)
    const apply = req.query.apply === "1" || req.query.apply === "true";

    const snap = await adminDb.collection("players").get();
    if (snap.empty) return res.json({ ok: true, total: 0, groups: 0, merged: 0, deleted: 0, applied: apply });

    // Group docs by identity
    const groups = new Map(); // identity -> array of {id, data}
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const ident = identityFor({ id: doc.id, ...data });
      if (!groups.has(ident)) groups.set(ident, []);
      groups.get(ident).push({ id: doc.id, data });
    });

    let merged = 0, deleted = 0;
    const plans = []; // list of {keepId, keepData, deleteIds[]}

    for (const [ident, arr] of groups.entries()) {
      if (arr.length === 1) continue; // no dupes
      // pick the best doc to keep
      let winner = { id: arr[0].id, ...arr[0].data };
      for (let i = 1; i < arr.length; i++) {
        const cand = { id: arr[i].id, ...arr[i].data };
        winner = better(winner, cand);
      }

      // merge everything into winner
      let mergedProjections = {};
      let mergedMatchups = {};
      let photo = winner.photo || winner.photoUrl || winner.headshot || winner.image || null;
      let team  = winner.team || winner.nflTeam || winner.proTeam || null;
      let pos   = (winner.position || winner.pos || "").toString().toUpperCase() || null;
      let name  = playerDisplay(winner);
      let eid   = espnIdOf(winner);

      for (const r of arr) {
        mergedProjections = mergeProjections(mergedProjections, r.data.projections || r.data.projByWeek || {});
        mergedMatchups    = mergeMatchups(mergedMatchups, r.data.matchups || {});
        if (!photo) photo = r.data.photo || r.data.photoUrl || r.data.headshot || r.data.image || null;
        if (!team)  team  = r.data.team || r.data.nflTeam || r.data.proTeam || team;
        if (!pos)   pos   = (r.data.position || r.data.pos || pos || "").toString().toUpperCase() || null;
        if (!eid)   eid   = espnIdOf(r.data) || eid;
        if (!name || name === "(unknown)") name = playerDisplay(r.data);
      }

      // Decide keep doc id: if winner already matches espn, prefer espn-<id>
      let keepId = winner.id;
      const desiredId = eid ? `espn-${String(eid)}` : keepId;
      if (desiredId && desiredId !== keepId) keepId = desiredId;

      const keepData = {
        id: keepId,
        name,
        position: pos,
        team,
        projections: mergedProjections,
        matchups: mergedMatchups,
        espnId: eid ?? null,
        photo: photo || null,
        updatedAt: new Date(),
      };

      const deleteIds = arr.map((r) => r.id).filter((id) => id !== keepId);

      // If the "winner" had a non-espn id but we want espn-<id>, we will upsert keepId and delete all others (including previous winner.id)
      plans.push({ keepId, keepData, deleteIds });
      merged += 1;
      deleted += deleteIds.length;
    }

    if (!apply) {
      return res.json({
        ok: true,
        total: snap.size,
        groups: groups.size,
        mergedCandidates: merged,
        deleteCandidates: deleted,
        applied: false,
        hint: "Run with ?apply=1 to perform the merge+delete.",
      });
    }

    // Apply in chunks
    const CHUNK = 400;
    // 1) Upserts (ensure keep docs exist with merged data)
    for (let i = 0; i < plans.length; i += CHUNK) {
      const batch = adminDb.batch();
      for (const p of plans.slice(i, i + CHUNK)) {
        const ref = adminDb.collection("players").doc(p.keepId);
        batch.set(ref, p.keepData, { merge: true });
      }
      await batch.commit();
    }

    // 2) Deletes
    const allDeleteIds = plans.flatMap((p) => p.deleteIds);
    for (let i = 0; i < allDeleteIds.length; i += CHUNK) {
      const batch = adminDb.batch();
      for (const id of allDeleteIds.slice(i, i + CHUNK)) {
        batch.delete(adminDb.collection("players").doc(id));
      }
      await batch.commit();
    }

    return res.json({
      ok: true,
      total: snap.size,
      groups: groups.size,
      merged: merged,
      deleted: deleted,
      applied: true,
    });
  } catch (err) {
    console.error("dedupe-players error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
