/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// step functions
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { backfillHeadshots } from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers } from "../../src/server/cron/dedupePlayers.js";
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

async function safeRun(name, fn) {
  try {
    const t0 = Date.now();
    const res = await fn();
    const ms = Date.now() - t0;
    return { ok: true, name, ms, ...res };
  } catch (e) {
    console.error(`[cron] ${name} failed:`, e);
    return { ok: false, name, error: String(e?.message || e) };
  }
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");

    // ---------- COMBINED REFRESH PIPELINE ----------
    if (task === "refresh") {
      const steps = [];

      // 1) pull players from ESPN (no truncate here)
      steps.push(
        await safeRun("refreshPlayersFromEspn", () =>
          refreshPlayersFromEspn({ adminDb })
        )
      );

      // 2) dedupe players
      steps.push(
        await safeRun("dedupePlayers", () =>
          dedupePlayers({ adminDb })
        )
      );

      // 3) backfill headshots
      steps.push(
        await safeRun("backfillHeadshots", () =>
          backfillHeadshots({ adminDb })
        )
      );

      const ok = steps.every((s) => s.ok);
      const summary = {
        ok,
        steps,
        hint: "See 'steps' array for per-step status. Even if one failed, later steps may have run.",
      };
      return res.status(ok ? 200 : 500).json(summary);
    }

    // ---------- INDIVIDUAL TASKS ----------
    if (task === "headshots") {
      const r = await backfillHeadshots({ adminDb });
      return res.status(200).json({ ok: true, ...r });
    }

    if (task === "dedupe") {
      const r = await dedupePlayers({ adminDb });
      return res.status(200).json({ ok: true, ...r });
    }

    if (task === "projections") {
      const r = await seedWeekProjections({ adminDb, week, season });
      return res.status(200).json({ ok: true, ...r });
    }

    if (task === "matchups") {
      const r = await seedWeekMatchups({ adminDb, week, season });
      return res.status(200).json({ ok: true, ...r });
    }

    if (task === "settle") {
      const r = await settleSeason({ adminDb });
      return res.status(200).json({ ok: true, ...r });
    }

    return res.status(400).json({
      ok: false,
      error: "unknown task",
      hint:
        "use ?task=refresh|headshots|dedupe|projections|matchups|settle",
    });
  } catch (e) {
    console.error("cron index fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
