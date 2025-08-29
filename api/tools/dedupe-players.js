// api/tools/dedupe-players.js
/* eslint-disable no-console */

import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

// ----- helpers -----
const norm = (s) => String(s || "").trim().toLowerCase();
const asId = (x) => (x == null ? null : String(x).trim());

function getEspnId(p) {
  return (
    p.espnId ??
    p.espn_id ??
    (p.espn && (p.espn.playerId || p.espn.id)) ??
    null
  );
}

function identityFor(p) {
  const eid = getEspnId(p);
  if (eid != null && String(eid).trim() !== "") return `espn:${String(eid)}`;
  const name =
    p.name ||
    p.displayName ||
    p.fullName ||
    p.playerName ||
    (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : "");
  const team = p.team || p.nflTeam || p.proTeam || "";
  const pos = (p.position || p.pos || "").toString().toUpperCase();
  return `ntp:${norm(name)}|${norm(team)}|${norm(pos)}`;
}

// unify updatedAt across shapes and fallback to Firestore updateTime
function tsFromDataOrMeta(data, metaUpdateTime) {
  const raw = data?.updatedAt;
  try {
    if (!raw) return metaUpdateTime || 0;
    if (raw?.toDate) return raw.toDate().getTime();
    if (raw?.seconds) return Number(raw.seconds) * 1000;
    if (raw instanceof Date) return raw.getTime();
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  } catch (_) {}
  return metaUpdateTime || 0;
}

// keep newer; if tie, keep the one that has espnId; then smallest id for stability
function chooseKeeper(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a._t !== b._t) return a._t > b._t ? a : b;
  const aHasEspn = a._hasEspn ? 1 : 0;
  const bHasEspn = b._hasEspn ? 1 : 0;
  if (aHasEspn !== bHasEspn) return aHasEspn > bHasEspn ? a : b;
  return a.id < b.id ? a : b;
}

// build an auth guard if you want (optional)
function checkSecret(req) {
  const needs = !!process.env.CRON_SECRET;
  if (!needs) return { ok: true };
  const got = req.headers["x-cron-secret"];
  if (got && got === process.env.CRON_SECRET) return { ok: true };
  return { ok: false, status: 401, body: { ok: false, error: "unauthorized" } };
}

export default async function handler(req, res) {
  try {
    const auth = checkSecret(req);
    if (!auth.ok) return res.status(auth.status).json(auth.body);

    const apply = String(req.query.apply || "") === "1";
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 5000)));

    // 1) read all docs from global players (cap with limit for safety)
    const col = adminDb.collection("players");
    const snap = await col.get();

    const rows = [];
    let count = 0;
    for (const d of snap.docs) {
      if (count >= limit) break;
      const data = d.data() || {};
      const metaUpdateTime = d.updateTime ? Date.parse(d.updateTime.toDate().toISOString()) : 0;
      const record = {
        id: d.id,
        _ref: d.ref,
        _t: tsFromDataOrMeta(data, metaUpdateTime),
        _hasEspn: !!getEspnId(data),
        ...data,
      };
      rows.push(record);
      count += 1;
    }

    // 2) group by identity
    const groups = new Map();
    for (const r of rows) {
      const key = identityFor(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    // 3) decide keepers + duplicates
    const deletions = [];
    const summary = [];
    for (const [key, arr] of groups.entries()) {
      if (arr.length <= 1) continue;
      // pick a keeper
      let keeper = null;
      for (const r of arr) keeper = chooseKeeper(keeper, r);
      const dupes = arr.filter((x) => x.id !== keeper.id);

      if (dupes.length) {
        summary.push({
          key,
          keep: keeper.id,
          remove: dupes.map((d) => d.id),
        });
        deletions.push(...dupes.map((d) => d._ref));
      }
    }

    // 4) apply deletes in chunks (fresh batch per chunk)
    let deleted = 0;
    if (apply && deletions.length) {
      const CHUNK = 400;
      for (let i = 0; i < deletions.length; i += CHUNK) {
        const slice = deletions.slice(i, i + CHUNK);
        const batch = adminDb.batch();
        slice.forEach((ref) => batch.delete(ref));
        await batch.commit();
        deleted += slice.length;
      }
    }

    // 5) respond
    return res.status(200).json({
      ok: true,
      mode: apply ? "apply" : "dry-run",
      scanned: rows.length,
      groups: groups.size,
      duplicateGroups: summary.length,
      toDelete: deletions.length,
      deleted,
      preview: summary.slice(0, 25), // show a sample
    });
  } catch (err) {
    console.error("dedupe-players error:", err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
}
