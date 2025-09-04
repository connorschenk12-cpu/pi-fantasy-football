/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// import defensively (named or default)
import * as RefreshMod from "../../src/server/cron/refreshPlayersFromEspn.js";
import * as ProjMod from "../../src/server/cron/seedWeekProjections.js";
import * as MatchupsMod from "../../src/server/cron/seedWeekMatchups.js";
import * as HeadshotsMod from "../../src/server/cron/backfillHeadshots.js";
import * as DedupeMod from "../../src/server/cron/dedupePlayers.js";
import * as SettleMod from "../../src/server/cron/settleSeason.js";
import * as PruneMod from "../../src/server/cron/pruneIrrelevantPlayers.js";

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
  const cursorName = url.searchParams.get("cursorName") || null;
  const cursorId = url.searchParams.get("cursorId") || null;
  return {
    limit: Math.max(1, Math.min(limit, 1000)),
    cursor,
    cursorName,
    cursorId,
  };
}

// resolve functions
const refreshPlayersFromEspn = RefreshMod.refreshPlayersFromEspn || RefreshMod.default;
const seedWeekProjections    = ProjMod.seedWeekProjections || ProjMod.default;
const seedWeekMatchups       = MatchupsMod.seedWeekMatchups || MatchupsMod.default;
const backfillHeadshots      = HeadshotsMod.backfillHeadshots || HeadshotsMod.default;
const dedupePlayers          = DedupeMod.dedupePlayers || DedupeMod.default;
const settleSeason           = SettleMod.settleSeason || SettleMod.default;
const pruneIrrelevantPlayers = PruneMod.pruneIrrelevantPlayers || PruneMod.default;

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok:false, error:"unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    const { limit, cursor, cursorName, cursorId } = pageParams(url);
    const week      = url.searchParams.get("week");
    const season    = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite"); // "1" to force overwrite
    const loopParam = url.searchParams.get("loop");
    const loop = loopParam == null ? 1 : Number(loopParam); // default loop=1

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
        let total = { ok:true, processed:0, updated:0, skipped:0, done:false };
        let loops = 0;
        let nextName = cursorName || null;
        let nextId   = cursorId || null;

        do {
          const page = await seedWeekProjections({
            adminDb,
            week: week != null ? Number(week) : 1,
            season: season != null ? Number(season) : undefined,
            limit,
            cursorName: nextName,
            cursorId: nextId,
            overwrite: overwrite === "1",
          });
          total.processed += page.processed || 0;
          total.updated   += page.updated   || 0;
          total.skipped   += page.skipped   || 0;
          total.done = !!page.done;

          nextName = page.nextCursorName || null;
          nextId   = page.nextCursorId || null;
          loops++;
        } while (!total.done && loop && loops < 200);

        return res.status(200).json({
          ok:true,
          ...total,
          nextCursorName: nextName,
          nextCursorId: nextId,
        });
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok:false, error:"seedWeekMatchups not available" });
        }
        out = await seedWeekMatchups({ adminDb, week: Number(week || 1), season: Number(season), limit });
        return res.status(200).json(out);
      }

      case "headshots": {
        if (typeof backfillHeadshots !== "function") {
          return res.status(500).json({ ok:false, error:"backfillHeadshots not available" });
        }
        out = await backfillHeadshots({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "dedupe": {
        if (typeof dedupePlayers !== "function") {
          return res.status(500).json({ ok:false, error:"dedupePlayers not available" });
        }
        out = await dedupePlayers({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "settle": {
        if (typeof settleSeason !== "function") {
          return res.status(500).json({ ok:false, error:"settleSeason not available" });
        }
        out = await settleSeason({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "prune": {
        if (typeof pruneIrrelevantPlayers !== "function") {
          return res.status(500).json({ ok:false, error:"pruneIrrelevantPlayers not available" });
        }
        out = await pruneIrrelevantPlayers({ adminDb, limit: Math.max(500, limit) });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok:false,
          error:"unknown task",
          hint:"use ?task=refresh|projections|matchups|headshots|dedupe|settle|prune&limit=25&overwrite=1"
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
