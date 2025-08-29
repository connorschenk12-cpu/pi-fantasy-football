/* eslint-disable no-console */
// src/server/cron/seedWeekProjections.js
// Paged + throttled projection seeder.
// Strategy: for a target week, if a player's projections[week] is missing (or overwrite=true),
// fill it with a lightweight estimate = last week's actual points from /api/stats/week.
// Safe on Firestore quotas: small pages + commit backoff + only-write-when-needed.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function commitWithBackoff(batch, attempt = 0) {
  try {
    await batch.commit();
  } catch (e) {
    const msg = String(e?.message || e);
    if (/RESOURCE_EXHAUSTED/i.test(msg) && attempt < 5) {
      const wait = 300 * Math.pow(2, attempt); // 300, 600, 1200, 2400, 4800
      console.warn(`Projections: backoff ${wait}ms (attempt ${attempt + 1})`);
      await sleep(wait);
      return commitWithBackoff(batch, attempt + 1);
    }
    throw e;
  }
}

/**
 * Fetch compact stats map for a given week from your own API.
 * Returns a Map keyed by ESPN athlete id (string) -> { points: number }
 */
async function fetchStatsMap({ req, week, season }) {
  if (!Number.isFinite(week) || week <= 0) return new Map();
  try {
    // Build absolute URL to your serverless route
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const url = new URL(`/api/stats/week`, origin);
    url.searchParams.set("week", String(week));
    if (Number.isFinite(season)) url.searchParams.set("season", String(season));

    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) {
      console.warn("fetchStatsMap: non-200:", r.status);
      return new Map();
    }
    const json = await r.json();
    const obj = json?.stats || {};
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) {
      const pts = v && v.points != null ? Number(v.points) || 0 : 0;
      // Only numeric id keys are ESPN ids; but your /api/stats/week also returns NAME|TEAM keys.
      // We still store all keys; the player lookup uses espnId (numeric-as-string) primarily.
      m.set(String(k), { points: pts });
    }
    return m;
  } catch (e) {
    console.warn("fetchStatsMap error:", e);
    return new Map();
  }
}

/**
 * Cursor model:
 *   We orderBy('name').orderBy('id') and pass last doc's {name,id} back as cursor: "<name>|<id>"
 * Query params you can forward through /api/cron/index.js:
 *   ?task=projections&week=3&season=2025&limit=20&overwrite=false&cursor=<name>|<id>
 */
export async function seedWeekProjections({ adminDb, week, season, limit, cursor, overwrite, req }) {
  // ---- Validate inputs ----
  const wk = Number(week);
  if (!Number.isFinite(wk) || wk <= 0) {
    return { ok: false, error: "week is required and must be > 0" };
  }

  const pageSize = Math.max(1, Math.min(Number(limit) || 20, 50)); // gentle page
  const allowOverwrite = String(overwrite || "").toLowerCase() === "true";

  // ---- Pre-fetch previous week's stats once (cheap) ----
  const prevWeek = wk - 1;
  const prevStats = prevWeek >= 1 ? await fetchStatsMap({ req, week: prevWeek, season: Number(season) || undefined }) : new Map();

  // ---- Page query ----
  const playersCol = adminDb.collection("players");
  let q = playersCol.orderBy("name").orderBy("id").limit(pageSize);

  // Cursor format "<name>|<id>"
  let cursorName = null;
  let cursorId = null;
  if (cursor && typeof cursor === "string" && cursor.includes("|")) {
    const [n, i] = cursor.split("|");
    cursorName = n;
    cursorId = i;
  }
  if (cursorName != null && cursorId != null) {
    q = q.startAfter(cursorName, cursorId);
  }

  const snap = await q.get();
  if (snap.empty) {
    return { ok: true, done: true, processed: 0, updated: 0 };
  }

  // ---- Build writes (only if needed) ----
  let processed = 0;
  let updated = 0;
  const batch = adminDb.batch();

  for (const d of snap.docs) {
    processed += 1;
    const p = d.data() || {};
    const proj = (p.projections && typeof p.projections === "object") ? { ...p.projections } : {};
    const hasAlready = proj[wk] != null && !Number.isNaN(Number(proj[wk]));

    if (hasAlready && !allowOverwrite) {
      continue; // nothing to do
    }

    // Derive a lightweight projection:
    // Prefer previous week's actual points (by ESPN id).
    let value = null;

    const espnId =
      p.espnId ??
      p.espn_id ??
      (p.espn && (p.espn.playerId || p.espn.id)) ??
      null;

    if (espnId != null) {
      const row = prevStats.get(String(espnId));
      if (row && row.points != null) value = Number(row.points) || 0;
    }

    // If still null, keep existing value when overwriting, else skip
    if (value == null) {
      if (allowOverwrite && hasAlready) {
        // respect what's there (no change)
        continue;
      } else {
        // Skip write; we don't invent numbers without signal
        continue;
      }
    }

    // Only write if different or missing
    if (!hasAlready || Number(proj[wk]) !== value) {
      proj[wk] = value;
      batch.set(d.ref, { projections: proj, updatedAt: new Date() }, { merge: true });
      updated += 1;
    }
  }

  if (updated > 0) {
    await commitWithBackoff(batch);
    await sleep(300);
  }

  // Next cursor
  const last = snap.docs[snap.docs.length - 1];
  const nextCursor = `${last.get("name") || ""}|${last.get("id") || last.id}`;

  return {
    ok: true,
    done: snap.size < pageSize,
    processed,
    updated,
    nextCursor,
    week: wk,
    usedPrevWeek: prevWeek >= 1 ? prevWeek : null,
  };
}

// Convenience wrapper if you want the same file to support a default export (optional)
export default seedWeekProjections;
