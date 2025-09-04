/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Defensive module imports (support named or default)
import * as RefreshMod from "../../src/server/cron/refreshPlayersFromEspn.js";
import * as ProjMod from "../../src/server/cron/seedWeekProjections.js";
import * as MatchupsMod from "../../src/server/cron/seedWeekMatchups.js";
import * as HeadshotsMod from "../../src/server/cron/backfillHeadshots.js";
import * as DedupeMod from "../../src/server/cron/dedupePlayers.js";
import * as SettleMod from "../../src/server/cron/settleSeason.js";
import * as PruneMod from "../../src/server/cron/pruneIrrelevantPlayers.js"; // optional

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

function pageParams(url) {
  const limit = Number(url.searchParams.get("limit")) || 25;
  const cursor = url.searchParams.get("cursor") || null;
  return { limit: Math.max(1, Math.min(limit, 1000)), cursor };
}

const refreshPlayersFromEspn = RefreshMod.refreshPlayersFromEspn || RefreshMod.default;
const seedWeekProjections   = ProjMod.seedWeekProjections || ProjMod.default;
const seedWeekMatchups      = MatchupsMod.seedWeekMatchups || MatchupsMod.default;
const backfillHeadshots     = HeadshotsMod.backfillHeadshots || HeadshotsMod.default;
const dedupePlayers         = DedupeMod.dedupePlayers || DedupeMod.default;
const settleSeason          = SettleMod.settleSeason || SettleMod.default;
const pruneIrrelevant       = PruneMod.pruneIrrelevantPlayers || PruneMod.default;

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok:false, error:"unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const loop = url.searchParams.get("loop") || url.searchParams.get("all"); // truthy = loop all pages
    const { limit } = pageParams(url);

    const week   = url.searchParams.get("week");
    const season = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");

    let out;

    switch (task) {
      case "refresh": {
        if (typeof refreshPlayersFromEspn !== "function") {
          return res.status(500).json({ ok:false, error:"refreshPlayersFromEspn not available" });
        }
        out = await refreshPlayersFromEspn({ adminDb });
        return res.status(200).json(out);
      }

      case "projections": {
        if (typeof seedWeekProjections !== "function") {
          return res.status(500).json({ ok:false, error:"seedWeekProjections not available" });
        }

        // loop server-side if loop=1/all=1 present
        let totalProcessed = 0, totalUpdated = 0, totalSkipped = 0;
        let cursorName = url.searchParams.get("cursorName");
        let cursorId   = url.searchParams.get("cursorId");
        let pages = 0;
        let done = false;

        do {
          // safety cap for a single invocation
          if (pages >= 200) break;
          const r = await seedWeekProjections({
            adminDb,
            week: week != null ? Number(week) : undefined,
            season: season != null ? Number(season) : undefined,
            limit,
            cursorName,
            cursorId,
            overwrite: overwrite === "true" || overwrite === "1",
          });
          totalProcessed += r.processed;
          totalUpdated   += r.updated;
          totalSkipped   += r.skipped;
          cursorName = r.nextCursorName || null;
          cursorId   = r.nextCursorId || null;
          done = !!r.done;
          pages += 1;
        } while (loop && !done && cursorId);

        return res.status(200).json({
          ok: true,
          processed: totalProcessed,
          updated: totalUpdated,
          skipped: totalSkipped,
          done,
          nextCursorName: cursorName,
          nextCursorId: cursorId,
          hint: "Call again with ?cursorName=<...>&cursorId=<...> or add &loop=1 to process all pages in one call.",
        });
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok:false, error:"seedWeekMatchups not available" });
        }
        out = await seedWeekMatchups({ adminDb, week: Number(week), season: Number(season) });
        return res.status(200).json(out);
      }

      case "headshots": {
        if (typeof backfillHeadshots !== "function") {
          return res.status(500).json({ ok:false, error:"backfillHeadshots not available" });
        }
        out = await backfillHeadshots({ adminDb, limit });
        return res.status(200).json(out);
      }

      case "dedupe": {
        if (typeof dedupePlayers !== "function") {
          return res.status(500).json({ ok:false, error:"dedupePlayers not available" });
        }
        out = await dedupePlayers({ adminDb, limit });
        return res.status(200).json(out);
      }

      case "settle": {
        if (typeof settleSeason !== "function") {
          return res.status(500).json({ ok:false, error:"settleSeason not available" });
        }
        out = await settleSeason({ adminDb, limit });
        return res.status(200).json(out);
      }

      case "prune": {
        if (typeof pruneIrrelevant !== "function") {
          return res.status(500).json({ ok:false, error:"pruneIrrelevantPlayers not available" });
        }
        out = await pruneIrrelevant({ adminDb, limit });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok:false,
          error:"unknown task",
          hint:"use ?task=refresh|projections|matchups|headshots|dedupe|settle|prune&limit=25&cursorName=...&cursorId=...&loop=1",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
