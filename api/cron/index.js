/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Task handlers (server-only modules living under src/server/cron)
import { refreshPlayersFromEspn }   from "../../src/server/cron/refreshPlayersFromEspn.js";
import { seedWeekProjections }      from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups }         from "../../src/server/cron/seedWeekMatchups.js";
import { backfillHeadshots }        from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers }            from "../../src/server/cron/dedupePlayers.js";
import { settleSeason }             from "../../src/server/cron/settleSeason.js";
import { truncateAndRefresh }       from "../../src/server/cron/truncateAndRefresh.js";

export const config = { maxDuration: 60 };

// Optional: simple header secret. If you don't want auth, just delete this fn and the check below.
function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    // Normalize optional params
    const weekParam   = url.searchParams.get("week");
    const seasonParam = url.searchParams.get("season");
    const week   = weekParam   != null ? Number(weekParam)   : undefined;
    const season = seasonParam != null ? Number(seasonParam) : undefined;

    switch (task) {
      case "refresh":
        // From ESPN teams/rosters (non-destructive)
        return res.status(200).json(await refreshPlayersFromEspn({ adminDb }));

      case "truncate":
      case "truncate-and-refresh":
        // Wipe players (global) then repopulate from ESPN
        return res.status(200).json(await truncateAndRefresh({ adminDb }));

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
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint:
            "use ?task=refresh|truncate|truncate-and-refresh|projections|matchups|headshots|dedupe|settle",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
