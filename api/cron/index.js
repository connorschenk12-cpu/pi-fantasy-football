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
import * as PruneMod from "../../src/server/cron/pruneIrrelevantPlayers.js";

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
  return { limit: Math.max(1, Math.min(limit, 1000)), cursor };
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

const pruneIrrelevant =
  PruneMod.pruneIrrelevantPlayers || PruneMod.default;

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const source = (url.searchParams.get("source") || "").toLowerCase(); // e.g. "props"

    const { limit } = pageParams(url);
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");

    // cursor variants we might receive
    let cursor = url.searchParams.get("cursor"); // legacy single string
    let cursorName = url.searchParams.get("cursorName");
    let cursorId = url.searchParams.get("cursorId");

    switch (task) {
      case "refresh": {
        if (typeof refreshPlayersFromEspn !== "function") {
          return res.status(500).json({ ok: false, error: "refreshPlayersFromEspn not available" });
        }
        const out = await refreshPlayersFromEspn({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "projections": {
        // Choose source (normal vs props)
        const ProjFn = source === "props" ? seedWeekProjectionsFromProps : seedWeekProjections;
        if (typeof ProjFn !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekProjections not available" });
        }

        // Default looping behavior:
        // If no cursor params were provided, loop through all pages this run.
        const loopParam = url.searchParams.get("loop") || url.searchParams.get("all");
        const loop = !!(loopParam || (!cursor && !cursorName && !cursorId));

        let processed = 0, updated = 0, skipped = 0;
        let iterations = 0;
        let done = false;
        let lastResp = null;

        do {
          const resp = await ProjFn({
            adminDb,
            week: week != null ? Number(week) : undefined,
            season: season != null ? Number(season) : undefined,
            limit,
            // pass whatever cursor shape your seeder supports
            cursor,
            cursorName,
            cursorId,
            overwrite,
            req,
          });

          lastResp = resp || {};
          processed += Number(lastResp.processed || 0);
          updated   += Number(lastResp.updated || 0);
          skipped   += Number(lastResp.skipped || 0);
          done = !!lastResp.done;

          // advance cursors – handle both shapes
          cursorName = lastResp.nextCursorName ?? cursorName ?? null;
          cursorId   = lastResp.nextCursorId   ?? cursorId   ?? null;
          cursor     = lastResp.nextCursor     ?? cursor     ?? null;

          iterations += 1;
          // guardrail
          if (iterations > 500) break;
        } while (loop && !done);

        const payload = {
          ok: true,
          processed,
          updated,
          skipped,
          done,
          nextCursor: cursor || null,
          nextCursorName: cursorName || null,
          nextCursorId: cursorId || null,
          ...(loop ? {} : { hint: "Add &loop=1 to process all pages in one call." }),
        };
        return res.status(200).json(payload);
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekMatchups not available" });
        }
        const out = await seedWeekMatchups({ adminDb, week: Number(week), season: Number(season), limit, cursorName, cursorId, req });
        return res.status(200).json(out);
      }

      case "headshots": {
        if (typeof backfillHeadshots !== "function") {
          return res.status(500).json({ ok: false, error: "backfillHeadshots not available" });
        }
        const out = await backfillHeadshots({ adminDb, limit, cursorName, cursorId });
        return res.status(200).json(out);
      }

      case "dedupe": {
        if (typeof dedupePlayers !== "function") {
          return res.status(500).json({ ok: false, error: "dedupePlayers not available" });
        }
        const out = await dedupePlayers({ adminDb, limit, cursorName, cursorId });
        return res.status(200).json(out);
      }

      case "settle": {
        if (typeof settleSeason !== "function") {
          return res.status(500).json({ ok: false, error: "settleSeason not available" });
        }
        const out = await settleSeason({ adminDb, limit, cursorName, cursorId });
        return res.status(200).json(out);
      }

      case "prune": {
        if (typeof pruneIrrelevant !== "function") {
          return res.status(500).json({ ok: false, error: "pruneIrrelevantPlayers not available" });
        }
        let totalChecked = 0, totalDeleted = 0, loops = 0, done = false;
        const pageSize = Math.max(1, Math.min(Number(url.searchParams.get("limit") || limit || 500), 2000));
        do {
          const r = await pruneIrrelevant({ adminDb, limit: pageSize });
          totalChecked += Number(r.checked || 0);
          totalDeleted += Number(r.deleted || 0);
          done = !!r.done;
          loops++;
          if (loops > 200) break; // safety
        } while (!done);
        return res.status(200).json({ ok: true, checked: totalChecked, deleted: totalDeleted, done });
      }

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint: "use ?task=refresh|projections|matchups|headshots|dedupe|settle|prune&limit=25&cursor=<from-last>&source=props",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
