/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// tasks
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
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    // Common optional params
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");
    const limit = url.searchParams.get("limit");
    const cursor = url.searchParams.get("cursor");
    const team = url.searchParams.get("team"); // some tasks might use it later

    let out;

    switch (task) {
      case "refresh":
        out = await refreshPlayersFromEspn({ adminDb, limit, cursor, team });
        break;

      case "projections":
        out = await seedWeekProjections({ adminDb, week, season, limit, cursor });
        break;

      case "matchups":
        out = await seedWeekMatchups({ adminDb, week, season, limit, cursor });
        break;

      case "headshots":
        out = await backfillHeadshots({ adminDb, limit, cursor });
        break;

      case "dedupe":
        out = await dedupePlayers({ adminDb, limit, cursor });
        break;

      case "settle":
        out = await settleSeason({ adminDb, limit, cursor });
        break;

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint:
            "use ?task=refresh|projections|matchups|headshots|dedupe|settle " +
            "and optionally &week=&season=&limit=&cursor=",
        });
    }

    // Standardize HTTP status
    if (out && out.ok) return res.status(200).json(out);
    return res.status(500).json(out || { ok: false, error: "unknown failure" });
  } catch (e) {
    console.error("cron index fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
