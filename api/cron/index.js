/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// ---- internal helpers (move your existing logic in here) ----
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { seedWeekProjections } from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups } from "../../src/server/cron/seedWeekMatchups.js";
import { backfillHeadshots } from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers } from "../../src/server/cron/dedupePlayers.js";
import { settleSeason } from "../../src/server/cron/settleSeason.js";

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok:false, error:"unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    // optional common params
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");

    switch (task) {
      case "refresh":
        return res.status(200).json(await refreshPlayersFromEspn({ adminDb }));
      case "projections":
        return res.status(200).json(await seedWeekProjections({ adminDb, week, season }));
      case "matchups":
        return res.status(200).json(await seedWeekMatchups({ adminDb, week, season }));
      case "headshots":
        return res.status(200).json(await backfillHeadshots({ adminDb }));
      case "dedupe":
        return res.status(200).json(await dedupePlayers({ adminDb }));
      case "settle":
        return res.status(200).json(await settleSeason({ adminDb }));
      default:
        return res.status(400).json({ ok:false, error:"unknown task", hint:"use ?task=refresh|projections|matchups|headshots|dedupe|settle" });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
