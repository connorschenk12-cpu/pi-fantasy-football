/* eslint-disable no-console */
// src/server/cron/seedWeekProjectionsFromProps.js
// Seeds players.projections[<week>] using your /api/props/week endpoint.
// Matching is by (name|team|pos), with PK->K and DST/D-ST/DST -> DEF normalization.

function normPos(pos) {
  if (!pos) return "";
  const p = String(pos).trim().toUpperCase();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST" || p === "D-ST") return "DEF";
  return p;
}

function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Build a key like "name|team|pos" in lowercase
function keyFor(name, team, pos) {
  return [
    String(name || "").trim().toLowerCase(),
    String(team || "").trim().toLowerCase(),
    String(normPos(pos) || "").trim().toLowerCase(),
  ].join("|");
}

/**
 * Expected shape of /api/props/week response (flexible):
 * {
 *   ok: true,
 *   week: 1,
 *   season: 2025,
 *   rows: [
 *     { name: "Josh Allen", team: "BUF", pos: "QB", fantasyPoints: 22.3 }  // preferred field
 *     // or { points: 22.3 } or { line: 22.3 } etc. We'll pick the first numeric we find.
 *   ]
 * }
 */
export async function seedWeekProjectionsFromProps({
  adminDb,
  week = 1,
  season = new Date().getFullYear(),
  limit = 25,
  cursor = null,
  overwrite = false,
  req,
}) {
  if (!adminDb) throw new Error("adminDb required");

  // 1) Pull props once per invocation
  let propsJson = null;
  try {
    const base = req ? baseUrlFromReq(req) : "";
    const url  = `${base}/api/props/week?week=${encodeURIComponent(week)}&season=${encodeURIComponent(season)}`;
    const resp = await fetch(url, { headers: { "cache-control": "no-store" } });
    if (!resp.ok) {
      return { ok:false, error:`props fetch failed: ${resp.status}`, processed:0, updated:0, skipped:0, done:true };
    }
    propsJson = await resp.json();
  } catch (e) {
    console.warn("seedWeekProjectionsFromProps: props fetch error:", e);
    return { ok:false, error: String(e?.message || e), processed:0, updated:0, skipped:0, done:true };
  }

  const rows = Array.isArray(propsJson?.rows) ? propsJson.rows : [];
  if (!rows.length) {
    return { ok:true, processed:0, updated:0, skipped:0, done:true, note:"no props rows" };
  }

  // 2) Build a props lookup keyed by name|team|pos
  const propsMap = new Map();
  for (const r of rows) {
    const k = keyFor(r.name, r.team, r.pos);
    if (!k) continue;
    // pick the first numeric field we recognize for fantasy point projection
    const pts =
      safeNumber(r.fantasyPoints, NaN) ??
      safeNumber(r.points, NaN) ??
      safeNumber(r.line, NaN) ??
      safeNumber(r.fp, NaN);
    if (!Number.isFinite(pts)) continue;
    propsMap.set(k, Number(pts));
  }

  // 3) Page through players by "name" (to keep index simple)
  //    Cursor is just the last "name" we saw (optionally pipe+id if you prefer).
  const playersCol = adminDb.collection("players");
  let q = playersCol.orderBy("name", "asc").limit(Number(limit) || 25);

  // If your prior run used "Name|id" as cursor, split safely
  if (cursor) {
    const nameOnly = String(cursor).split("|")[0];
    q = q.startAfter(nameOnly);
  }

  const snap = await q.get();

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    processed++;
    const p = doc.data() || {};
    const name = p.name || "";
    const team = p.team || p.nflTeam || p.proTeam || "";
    const pos  = normPos(p.position || p.pos || "");
    const k    = keyFor(name, team, pos);

    const propsPts = propsMap.get(k);
    if (!Number.isFinite(propsPts)) {
      skipped++;
      continue;
    }

    const wKey = String(week);
    const prevProj = (p.projections && Number(p.projections[wKey])) || 0;

    const shouldWrite =
      overwrite ||
      !p.projections ||
      p.projections[wKey] == null ||
      Number(prevProj) === 0;

    if (!shouldWrite) {
      skipped++;
      continue;
    }

    await doc.ref.set(
      { projections: { ...(p.projections || {}), [wKey]: Number(propsPts) } },
      { merge: true }
    );
    updated++;
  }

  const lastDoc = snap.docs[snap.docs.length - 1];
  const done = snap.empty || !lastDoc || snap.size < (Number(limit) || 25);
  const nextCursor = lastDoc ? `${lastDoc.get("name") || lastDoc.id}|${lastDoc.id}` : null;

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done,
    nextCursor,
  };
}
