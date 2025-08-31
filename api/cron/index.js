/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// ESPN refresh (already paged internally)
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";

// Projections: support both legacy (season-avg) and props-based
import * as Proj from "../../src/server/cron/seedWeekProjections.js";
import * as PropsProj from "../../src/server/cron/seedWeekProjectionsFromProps.js";

// Matchups / headshots / dedupe / settle
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

function pageParams(url) {
  const limit = Number(url.searchParams.get("limit")) || 25; // gentle default
  const cursor = url.searchParams.get("cursor") || null;
  return { limit: Math.max(1, Math.min(limit, 100)), cursor };
}

// Normalize possible default/named exports
const runSeedWeekProjections =
  Proj.seedWeekProjections || Proj.default || null;

const runSeedWeekProjectionsFromProps =
  PropsProj.seedWeekProjectionsFromProps || PropsProj.default || null;

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();

    const { limit, cursor } = pageParams(url);
    const week = Number(url.searchParams.get("week") || 1);
    const season = Number(url.searchParams.get("season") || new Date().getFullYear());
    const overwrite = !!Number(url.searchParams.get("overwrite") || 0);
    const source = (url.searchParams.get("source") || "").toLowerCase(); // "" | "props"

    switch (task) {
      case "refresh": {
        const out = await refreshPlayersFromEspn({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "projections": {
        if (source === "props") {
          if (!runSeedWeekProjectionsFromProps) {
            return res.status(500).json({ ok: false, error: "seedWeekProjectionsFromProps not available" });
          }
          const out = await runSeedWeekProjectionsFromProps({
            adminDb, week, season, limit, cursor, overwrite, req
          });
          return res.status(200).json(out);
        }
        if (!runSeedWeekProjections) {
          return res.status(500).json({ ok: false, error: "seedWeekProjections not available" });
        }
        const out = await runSeedWeekProjections({
          adminDb, week, season, limit, cursor, overwrite, req
        });
        return res.status(200).json(out);
      }

      case "matchups": {
        const out = await seedWeekMatchups({ adminDb, week, season, limit, cursor, req });
        return res.status(200).json(out);
      }

      case "headshots": {
        const out = await backfillHeadshots({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "dedupe": {
        const out = await dedupePlayers({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "settle": {
        const out = await settleSeason({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint: "use ?task=refresh|projections|matchups|headshots|dedupe|settle&limit=25&cursor=<from-last>&source=props"
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
