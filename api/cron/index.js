/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Defensive module imports (support named OR default exports)
import * as RefreshMod from "../../src/server/cron/refreshPlayersFromEspn.js";
import * as ProjMod from "../../src/server/cron/seedWeekProjections.js";
import * as ProjPropsMod from "../../src/server/cron/seedWeekProjectionsFromProps.js";
import * as MatchupsMod from "../../src/server/cron/seedWeekMatchups.js";
import * as HeadshotsMod from "../../src/server/cron/backfillHeadshots.js";
import * as DedupeMod from "../../src/server/cron/dedupePlayers.js";
import * as SettleMod from "../../src/server/cron/settleSeason.js";
import * as PruneMod from "../../src/server/cron/pruneIrrelevantPlayers.js";

export const config = { maxDuration: 60 };

// ---- helpers ----
function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

function pageParams(url) {
  const limit = Number(url.searchParams.get("limit")) || 25; // default
  const cursor = url.searchParams.get("cursor") || null;
  const batch = (url.searchParams.get("batch") || "").toLowerCase(); // "all" to loop
  return { limit: Math.max(1, Math.min(limit, 100)), cursor, batch };
}

function resolve(fnModule) {
  return fnModule?.default || Object.values(fnModule).find((v) => typeof v === "function");
}

const refreshPlayersFromEspn      = RefreshMod.refreshPlayersFromEspn || resolve(RefreshMod);
const seedWeekProjections         = ProjMod.seedWeekProjections || resolve(ProjMod);
const seedWeekProjectionsFromProps= ProjPropsMod.seedWeekProjectionsFromProps || resolve(ProjPropsMod);
const seedWeekMatchups            = MatchupsMod.seedWeekMatchups || resolve(MatchupsMod);
const backfillHeadshots           = HeadshotsMod.backfillHeadshots || resolve(HeadshotsMod);
const dedupePlayers               = DedupeMod.dedupePlayers || resolve(DedupeMod);
const settleSeason                = SettleMod.settleSeason || resolve(SettleMod);
const pruneIrrelevantPlayers     = PruneMod.pruneIrrelevantPlayers || resolve(PruneMod);

// Loop a paginated worker until done/time nearly up
async function runPaged(worker, { args, limit, cursor, batch }) {
  if (batch !== "all") {
    const out = await worker({ ...args, limit, cursor });
    return out;
  }

  const started = Date.now();
  const SOFT_DEADLINE_MS = 55_000; // leave headroom for Vercel's 60s cap

  let processed = 0, updated = 0, skipped = 0;
  let page = 0, nextCursor = cursor, lastOut = null, done = false;

  while (!done) {
    page += 1;
    // eslint-disable-next-line no-await-in-loop
    const out = await worker({ ...args, limit, cursor: nextCursor });
    lastOut = out || {};
    processed += Number(out?.processed || 0);
    updated   += Number(out?.updated || 0);
    skipped   += Number(out?.skipped || 0);
    nextCursor = out?.nextCursor || null;
    done = !!out?.done || !nextCursor;

    if (Date.now() - started > SOFT_DEADLINE_MS) {
      return {
        ok: true,
        processed,
        updated,
        skipped,
        done: false,
        nextCursor,
        pages: page,
        note: "Soft deadline reached; resume with nextCursor.",
      };
    }
  }

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done: true,
    nextCursor: null,
    pages: page,
    lastPage: lastOut,
  };
}

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const source = (url.searchParams.get("source") || "").toLowerCase(); // e.g. "props"

    const { limit, cursor, batch } = pageParams(url);
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");
    const overwrite = url.searchParams.get("overwrite");

    let out;

    switch (task) {
      case "refresh": {
        if (typeof refreshPlayersFromEspn !== "function") {
          return res.status(500).json({ ok: false, error: "refreshPlayersFromEspn not available" });
        }
        // refresh is internally chunked; still allow batch=all if worker supports it
        out = await runPaged(refreshPlayersFromEspn, {
          args: { adminDb },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "projections": {
        const ProjFn = source === "props" ? seedWeekProjectionsFromProps : seedWeekProjections;
        if (typeof ProjFn !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekProjections not available" });
        }
        out = await runPaged(ProjFn, {
          args: {
            adminDb,
            week: week != null ? Number(week) : undefined,
            season: season != null ? Number(season) : undefined,
            overwrite,
            req, // if your worker inspects headers
          },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "matchups": {
        if (typeof seedWeekMatchups !== "function") {
          return res.status(500).json({ ok: false, error: "seedWeekMatchups not available" });
        }
        out = await runPaged(seedWeekMatchups, {
          args: {
            adminDb,
            week: week != null ? Number(week) : undefined,
            season: season != null ? Number(season) : undefined,
            req,
          },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "headshots": {
        if (typeof backfillHeadshots !== "function") {
          return res.status(500).json({ ok: false, error: "backfillHeadshots not available" });
        }
        out = await runPaged(backfillHeadshots, {
          args: { adminDb },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "dedupe": {
        if (typeof dedupePlayers !== "function") {
          return res.status(500).json({ ok: false, error: "dedupePlayers not available" });
        }
        out = await runPaged(dedupePlayers, {
          args: { adminDb },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "settle": {
        if (typeof settleSeason !== "function") {
          return res.status(500).json({ ok: false, error: "settleSeason not available" });
        }
        out = await runPaged(settleSeason, {
          args: { adminDb },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      case "prune": {
        if (typeof pruneIrrelevantPlayers !== "function") {
          return res.status(500).json({ ok: false, error: "pruneIrrelevantPlayers not available" });
        }
        out = await runPaged(pruneIrrelevantPlayers, {
          args: { adminDb },
          limit,
          cursor,
          batch,
        });
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({
          ok: false,
          error: "unknown task",
          hint:
            "use ?task=refresh|projections|matchups|headshots|dedupe|settle|prune" +
            "&limit=25&cursor=<from-last>&batch=all&source=props",
        });
    }
  } catch (e) {
    console.error("cron index fatal:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
