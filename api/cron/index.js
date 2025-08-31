/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// paged helpers
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { seedWeekProjections } from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups } from "../../src/server/cron/seedWeekMatchups.js";
import { backfillHeadshots } from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers } from "../../src/server/cron/dedupePlayers.js";
import { settleSeason } from "../../src/server/cron/settleSeason.js";

// NEW: props-backed projections
import { seedWeekProjectionsFromProps } from "../../src/server/cron/seedWeekProjectionsFromProps.js";

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

function pageParams(url) {
  const limit = Number(url.searchParams.get("limit")) || 25; // gentle default
  const cursor = url.searchParams.get("cursor") || null;
  return { limit: Math.max(1, Math.min(limit, 100)), cursor };
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok:false, error:"unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    const { limit, cursor } = pageParams(url);
    const week      = url.searchParams.get("week");
    const season    = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");
    const source    = (url.searchParams.get("source") || "").toLowerCase(); // "props" to use props-backed seeder

    let out;

    switch (task) {
      case "refresh":
        // ESPN team/roster import is already chunked internally
        out = await refreshPlayersFromEspn({ adminDb, limit, cursor });
        return res.status(200).json(out);

      case "projections":
        if (source === "props") {
          out = await seedWeekProjectionsFromProps({
            adminDb,
            week: Number(week) || 1,
            season: Number(season) || new Date().getFullYear(),
            limit,
            cursor,
            overwrite: overwrite === "1" || overwrite === "true",
            req,
          });
        } else {
          out = await seedWeekProjections({
            adminDb,
            week: Number(week),
            season: Number(season),
            limit,
            cursor,
            overwrite,
            req
          });
        }
        return res.status(200).json(out);

      case "matchups":
        out = await seedWeekMatchups({ adminDb, week: Number(week), season: Number(season), limit, cursor, req });
        return res.status(200).json(out);

      case "headshots":
        out = await backfillHeadshots({ adminDb, limit, cursor });
        return res.status(200).json(out);

      case "dedupe":
        out = await dedupePlayers({ adminDb, limit, cursor });
        return res.status(200).json(out);

      case "settle":
        out = await settleSeason({ adminDb, limit, cursor });
        return res.status(200).json(out);

      default:
        return res.status(400).json({
          ok:false,
          error:"unknown task",
          hint:"use ?task=refresh|projections|matchups|headshots|dedupe|settle&limit=25&cursor=<from-last>&source=props"
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
