/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Defensive module imports (support named or default)
import * as RefreshMod from "../../src/server/cron/refreshPlayersFromEspn.js";
import * as ProjMod from "../../src/server/cron/seedWeekProjections.js";
import * as ProjPropsMod from "../../src/server/cron/seedWeekProjectionsFromProps.js";
import * as MatchupsMod from "../../src/server/cron/seedWeekMatchups.js";
import * as HeadshotsMod from "../../src/server/cron/backfillHeadshots.js";
import * as DedupeMod from "../../src/server/cron/dedupePlayers.js";
import * as SettleMod from "../../src/server/cron/settleSeason.js";

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

// Resolve possible named/default exports
const refreshPlayersFromEspn =
  RefreshMod.refreshPlayersFromEspn || RefreshMod.default;

const seedWeekProjections =
  ProjMod.seedWeekProjections || ProjMod.default;

const seedWeekProjectionsFromProps =
  ProjPropsMod.seedWeekProjectionsFromProps || ProjPropsMod.default;

const seedWeekMatchups =
  MatchupsMod.seedWeekMatchups || MatchupsMod.default;

const backfillHeadshots =
  HeadshotsMod.backfillHeadshots || HeadshotsMod.default;

const dedupePlayers =
  DedupeMod.dedupePlayers || DedupeMod.default;

const settleSeason =
  SettleMod.settleSeason || SettleMod.default;

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const source = (url.searchParams.get("source") || "").toLowerCase(); // e.g. "props"

    const { limit, cursor } = pageParams(url);
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");

    let out;

    switch (task) {
      case "refresh": {
        if (typeof refreshPlayersFromEspn !== "function") {
          return res.status(500).json({ ok: false, error: "refreshPlayersFromEspn not available" });
        }
        out = await refreshPlayersFromEspn({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "projections": {
        // choose source (normal vs props)
        const ProjFn = source === "props" ? seedWeekProjectionsFromProps : seedWeekProjections;
        if (typeof ProjFn !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekProjections not available" });
        }
        out = await ProjFn({
          adminDb,
          week: week != null ? Number(week) : undefined,
          season: season != null ? Number(season) : undefined,
          limit,
          cursor,
          overwrite,
          req,
        });
        return res.status(200).json(out);
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekMatchups not available" });
        }
        out = await seedWeekMatchups({ adminDb, week: Number(week), season: Number(season), limit, cursor, req });
        return res.status(200).json(out);
      }

      case "headshots": {
        if (typeof backfillHeadshots !== "function") {
          return res.status(500).json({ ok: false, error: "backfillHeadshots not available" });
        }
        out = await backfillHeadshots({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "dedupe": {
        if (typeof dedupePlayers !== "function") {
          return res.status(500).json({ ok: false, error: "dedupePlayers not available" });
        }
        out = await dedupePlayers({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "settle": {
        if (typeof settleSeason !== "function") {
          return res.status(500).json({ ok: false, error: "settleSeason not available" });
        }
        out = await settleSeason({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint: "use ?task=refresh|projections|matchups|headshots|dedupe|settle&limit=25&cursor=<from-last>&source=props",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
