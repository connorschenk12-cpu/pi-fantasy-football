/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Defensive imports (handle both named and default exports)
import * as RefreshMod  from "../../src/server/cron/refreshPlayersFromEspn.js";
import * as ProjMod     from "../../src/server/cron/seedWeekProjections.js";
import * as PropsMod    from "../../src/server/cron/seedWeekProjectionsFromProps.js";
import * as MatchupsMod from "../../src/server/cron/seedWeekMatchups.js";
import * as HeadshotsMod from "../../src/server/cron/backfillHeadshots.js";
import * as DedupeMod   from "../../src/server/cron/dedupePlayers.js";
import * as SettleMod   from "../../src/server/cron/settleSeason.js";
import * as PruneMod    from "../../src/server/cron/pruneIrrelevantPlayers.js";

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
  return { limit: Math.max(1, Math.min(limit, 500)), cursor };
}

// Resolve named/default exports
const refreshPlayersFromEspn =
  RefreshMod.refreshPlayersFromEspn || RefreshMod.default;

const seedWeekProjections =
  ProjMod.seedWeekProjections || ProjMod.default;

const seedWeekProjectionsFromProps =
  PropsMod.seedWeekProjectionsFromProps || PropsMod.default;

const seedWeekMatchups =
  MatchupsMod.seedWeekMatchups || MatchupsMod.default;

const backfillHeadshots =
  HeadshotsMod.backfillHeadshots || HeadshotsMod.default;

const dedupePlayers =
  DedupeMod.dedupePlayers || DedupeMod.default;

const settleSeason =
  SettleMod.settleSeason || SettleMod.default;

const pruneIrrelevantPlayers =
  PruneMod.pruneIrrelevantPlayers || PruneMod.default;

// Small helper to loop baseline seeder until done (handles either nextCursor or nextCursorName/Id)
async function runBaselineProjectionsAllPages({ week, season, overwrite = false, limit = 250 }) {
  if (typeof seedWeekProjections !== "function") {
    throw new Error("seedWeekProjections not available");
  }

  let grandProcessed = 0;
  let grandUpdated = 0;
  let grandSkipped = 0;

  let cursor = null;
  let safety = 999; // hard stop just in case

  // Loop pages
  // We try to use whatever cursor style the seeder returns.
  //  - If it returns { nextCursor }, we pass it back as ?cursor
  //  - If it returns { nextCursorName, nextCursorId } we pass ?cursorName & ?cursorId (if your seeder supports it)
  // For compatibility, we still pass only 'cursor' when calling the function.
  while (safety-- > 0) {
    const out = await seedWeekProjections({
      adminDb,
      week,
      season,
      overwrite,
      limit,
      cursor,
    });

    grandProcessed += Number(out.processed || 0);
    grandUpdated   += Number(out.updated || 0);
    grandSkipped   += Number(out.skipped || 0);

    const done = !!out.done || out.processed === 0 || (out.nextCursor == null && out.nextCursorName == null);
    if (done) {
      return {
        ok: true,
        processed: grandProcessed,
        updated: grandUpdated,
        skipped: grandSkipped,
        done: true,
      };
    }

    // prefer explicit nextCursor; otherwise try to synthesize from name|id
    if (out.nextCursor) {
      cursor = out.nextCursor;
    } else if (out.nextCursorName) {
      // If your seeder understands name-only, this will work.
      // Otherwise, it will still continue by name. (Your latest seeder used name ordering.)
      // Concatenate to keep it unique if your seeder expects it:
      if (out.nextCursorId) cursor = `${out.nextCursorName}|${out.nextCursorId}`;
      else cursor = out.nextCursorName;
    } else {
      cursor = null;
    }
  }

  return {
    ok: true,
    processed: grandProcessed,
    updated: grandUpdated,
    skipped: grandSkipped,
    done: true,
    note: "terminated by safety loop",
  };
}

// Check if there are props for a given week/season
async function propsExistForWeek({ week, season }) {
  try {
    const q = season != null
      ? adminDb.collection("props").where("week", "==", Number(week)).where("season", "==", Number(season)).limit(1)
      : adminDb.collection("props").where("week", "==", Number(week)).limit(1);
    const s = await q.get();
    return !s.empty;
  } catch (e) {
    console.warn("propsExistForWeek error:", e);
    return false;
  }
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok:false, error:"unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task   = (url.searchParams.get("task") || "").toLowerCase();
    const source = (url.searchParams.get("source") || "auto").toLowerCase(); // auto | props | baseline

    const { limit, cursor } = pageParams(url);
    const week      = url.searchParams.get("week");
    const season    = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");
    const loopParam = url.searchParams.get("loop"); // optional override

    // If loop is omitted, we default to loop=true for projections baseline
    const loop = loopParam == null ? true : String(loopParam) === "1" || String(loopParam).toLowerCase() === "true";

    let out;

    switch (task) {
      case "refresh": {
        if (typeof refreshPlayersFromEspn !== "function") {
          return res.status(500).json({ ok:false, error:"refreshPlayersFromEspn not available" });
        }
        out = await refreshPlayersFromEspn({ adminDb, limit, cursor });
        return res.status(200).json(out);
      }

      case "projections": {
        // Decide source:
        let use = source;
        if (use === "auto") {
          const hasProps = await propsExistForWeek({ week: Number(week || 1), season: season != null ? Number(season) : undefined });
          use = hasProps ? "props-then-fill" : "baseline";
        }

        // Run props first (overwrite=true for any players present in props)
        if (use === "props" || use === "props-then-fill") {
          if (typeof seedWeekProjectionsFromProps !== "function") {
            return res.status(500).json({ ok:false, error:"seedWeekProjectionsFromProps not available" });
          }
          const propsResult = await seedWeekProjectionsFromProps({
            adminDb,
            week: Number(week || 1),
            season: season != null ? Number(season) : undefined,
            overwrite: true,
          });

          // If user asked specifically for props only:
          if (use === "props") {
            return res.status(200).json({ ok:true, source:"props", ...propsResult });
          }

          // Otherwise, fill gaps with baseline if requested (overwrite=false)
          if (typeof seedWeekProjections !== "function") {
            return res.status(200).json({
              ok: true,
              source: "props-only",
              props: propsResult,
              warning: "Baseline seeder not available, skipped fill step",
            });
          }

          if (loop) {
            const baselineResult = await runBaselineProjectionsAllPages({
              week: Number(week || 1),
              season: season != null ? Number(season) : undefined,
              overwrite: false, // only fill missing
              limit: Math.max(50, Math.min(limit || 250, 500)),
            });

            return res.status(200).json({
              ok: true,
              source: "props-then-fill",
              props: propsResult,
              baselineFill: baselineResult,
            });
          } else {
            // single page baseline fill (rarely useful, but kept)
            const baselineOnce = await seedWeekProjections({
              adminDb,
              week: Number(week || 1),
              season: season != null ? Number(season) : undefined,
              overwrite: false,
              limit,
              cursor,
            });
            return res.status(200).json({
              ok: true,
              source: "props-then-fill",
              props: propsResult,
              baselineFill: baselineOnce,
            });
          }
        }

        // Baseline only (e.g., no props found or explicit override)
        if (use === "baseline") {
          if (typeof seedWeekProjections !== "function") {
            return res.status(500).json({ ok:false, error:"seedWeekProjections not available" });
          }
          if (loop) {
            const baselineResult = await runBaselineProjectionsAllPages({
              week: Number(week || 1),
              season: season != null ? Number(season) : undefined,
              overwrite: overwrite === "1" || String(overwrite).toLowerCase() === "true",
              limit: Math.max(50, Math.min(limit || 250, 500)),
            });
            return res.status(200).json({ ok:true, source:"baseline", ...baselineResult });
          } else {
            const once = await seedWeekProjections({
              adminDb,
              week: Number(week || 1),
              season: season != null ? Number(season) : undefined,
              overwrite: overwrite === "1" || String(overwrite).toLowerCase() === "true",
              limit,
              cursor,
            });
            return res.status(200).json({ ok:true, source:"baseline", ...once });
          }
        }

        // Fallback
        return res.status(400).json({ ok:false, error:`invalid source '${source}'` });
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok:false, error:"seedWeekMatchups not available" });
        }
        out = await seedWeekMatchups({
          adminDb,
          week: Number(week || 1),
          season: season != null ? Number(season) : undefined,
          limit,
          cursor,
          req,
        });
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
        out = await pruneIrrelevantPlayers({ adminDb });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok:false,
          error:"unknown task",
          hint:"use ?task=refresh|projections|matchups|headshots|dedupe|settle|prune&limit=25&cursor=<from-last>&source=props",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
