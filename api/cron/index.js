/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { seedWeekProjections } from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups } from "../../src/server/cron/seedWeekMatchups.js";
import { backfillHeadshots } from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers } from "../../src/server/cron/dedupePlayers.js";
import { settleSeason } from "../../src/server/cron/settleSeason.js";

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false; // no secret set => allow (dev)
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

export default async function handler(req, res) {
  try {
    // Basic CORS (optional)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cron-secret");
    if (req.method === "OPTIONS") return res.status(204).end();

    if (unauthorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");

    switch (task) {
      case "refresh": {
        // Chain: refresh → dedupe → headshots
        const step1 = await refreshPlayersFromEspn({ adminDb });
        const step2 = await dedupePlayers({ adminDb });
        const step3 = await backfillHeadshots({ adminDb });
        return res.status(200).json({ ok: true, steps: { step1, step2, step3 } });
      }

      case "projections": {
        const r = await seedWeekProjections({ adminDb, week, season });
        return res.status(200).json(r);
      }

      case "matchups": {
        const r = await seedWeekMatchups({ adminDb, week, season });
        return res.status(200).json(r);
      }

      case "headshots": {
        const r = await backfillHeadshots({ adminDb });
        return res.status(200).json(r);
      }

      case "dedupe": {
        const r = await dedupePlayers({ adminDb });
        return res.status(200).json(r);
      }

      case "settle": {
        const r = await settleSeason({ adminDb });
        return res.status(200).json(r);
      }

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint: "use ?task=refresh|projections|matchups|headshots|dedupe|settle",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      stack: e?.stack,
    });
  }
}
