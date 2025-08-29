/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// internal tasks
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { dedupePlayers } from "../../src/server/cron/dedupePlayers.js";
import { backfillHeadshots } from "../../src/server/cron/backfillHeadshots.js";
import { seedWeekProjections } from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups } from "../../src/server/cron/seedWeekMatchups.js";
import { settleSeason } from "../../src/server/cron/settleSeason.js";

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

async function runStep(name, fn) {
  const t0 = Date.now();
  try {
    const res = await fn();
    return {
      name,
      ok: true,
      ms: Date.now() - t0,
      ...(res && typeof res === "object" ? res : { result: res })
    };
  } catch (e) {
    console.error(`[cron] step "${name}" failed:`, e);
    return {
      name,
      ok: false,
      ms: Date.now() - t0,
      error: String(e?.message || e),
      stack: e?.stack ? String(e.stack).slice(0, 2000) : undefined
    };
  }
}

export default async function handler(req, res) {
  try {
    // allow GET or POST
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");

    // quick health check
    if (task === "check") {
      // simple read to ensure Firestore admin is wired
      const col = adminDb.collection("_health");
      await col.doc("check").set({ at: Date.now() }, { merge: true });
      const snap = await col.doc("check").get();
      return res.status(200).json({ ok: true, adminDb: !!snap.exists, ts: snap.get("at") });
    }

    if (task === "refresh") {
      // 1) Refresh players from ESPN (teams+rosters), 2) Dedupe, 3) Headshots
      const steps = [];
      steps.push(await runStep("refreshPlayersFromEspn", () => refreshPlayersFromEspn({ adminDb })));
      steps.push(await runStep("dedupePlayers", () => dedupePlayers({ adminDb })));
      steps.push(await runStep("backfillHeadshots", () => backfillHeadshots({ adminDb })));

      const agg = { ok: steps.every(s => s.ok), steps };

      // surface common top-level fields if present from step 1
      const first = steps[0] || {};
      if (first?.countReceived != null) agg.countReceived = first.countReceived;
      if (first?.written != null) agg.written = first.written;
      if (first?.deleted != null) agg.deleted = first.deleted;
      if (first?.source) agg.source = first.source;

      const code = agg.ok ? 200 : 500;
      return res.status(code).json(agg);
    }

    if (task === "projections") {
      const out = await runStep("seedWeekProjections", () => seedWeekProjections({ adminDb, week, season }));
      return res.status(out.ok ? 200 : 500).json(out);
    }

    if (task === "matchups") {
      const out = await runStep("seedWeekMatchups", () => seedWeekMatchups({ adminDb, week, season }));
      return res.status(out.ok ? 200 : 500).json(out);
    }

    if (task === "dedupe") {
      const out = await runStep("dedupePlayers", () => dedupePlayers({ adminDb }));
      return res.status(out.ok ? 200 : 500).json(out);
    }

    if (task === "headshots") {
      const out = await runStep("backfillHeadshots", () => backfillHeadshots({ adminDb }));
      return res.status(out.ok ? 200 : 500).json(out);
    }

    if (task === "settle") {
      const out = await runStep("settleSeason", () => settleSeason({ adminDb }));
      return res.status(out.ok ? 200 : 500).json(out);
    }

    return res.status(400).json({
      ok: false,
      error: "unknown task",
      hint: "use ?task=refresh|projections|matchups|headshots|dedupe|settle|check"
    });
  } catch (e) {
    console.error("cron index fatal:", e);
    // make sure the error text reaches the browser
    return res.status(500).json({
      ok: false,
      where: "cron-index",
      error: String(e?.message || e),
      stack: e?.stack ? String(e.stack).slice(0, 2000) : undefined
    });
  }
}
