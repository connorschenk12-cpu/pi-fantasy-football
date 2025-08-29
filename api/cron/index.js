/* eslint-disable no-console */
// /api/cron/index.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// tasks
import { refreshPlayersFromEspn } from "../../src/server/cron/refreshPlayersFromEspn.js";
import { backfillHeadshots }      from "../../src/server/cron/backfillHeadshots.js";
import { dedupePlayers }          from "../../src/server/cron/dedupePlayers.js";
import { seedWeekProjections }    from "../../src/server/cron/seedWeekProjections.js";
import { seedWeekMatchups }       from "../../src/server/cron/seedWeekMatchups.js";
import { settleSeason }           from "../../src/server/cron/settleSeason.js";

export const config = { maxDuration: 60 };

function unauthorized(req) {
  const need = process.env.CRON_SECRET;
  if (!need) return false;
  const got = req.headers["x-cron-secret"];
  return got !== need;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  try {
    if (unauthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const task = (url.searchParams.get("task") || "").toLowerCase();
    const week = url.searchParams.get("week");
    const season = url.searchParams.get("season");

    if (task === "refresh") {
      const out = await refreshPlayersFromEspn({ adminDb });
      return res.status(200).json(out);
    }

    if (task === "headshots") {
      const out = await backfillHeadshots({ adminDb });
      return res.status(200).json(out);
    }

    if (task === "dedupe") {
      const out = await dedupePlayers({ adminDb });
      return res.status(200).json(out);
    }

    if (task === "projections") {
      const out = await seedWeekProjections({ adminDb, week, season });
      return res.status(200).json(out);
    }

    if (task === "matchups") {
      const out = await seedWeekMatchups({ adminDb, week, season });
      return res.status(200).json(out);
    }

    if (task === "settle") {
      const out = await settleSeason({ adminDb });
      return res.status(200).json(out);
    }

    if (task === "full-refresh") {
      const steps = [];

      const r1 = await refreshPlayersFromEspn({ adminDb });
      steps.push({ step: "refreshPlayersFromEspn", ...r1 });
      await sleep(500);

      const r2 = await backfillHeadshots({ adminDb });
      steps.push({ step: "backfillHeadshots", ...r2 });
      await sleep(500);

      const r3 = await dedupePlayers({ adminDb });
      steps.push({ step: "dedupePlayers", ...r3 });

      return res.status(200).json({ ok: true, steps });
    }

    return res.status(400).json({
      ok: false,
      error: "unknown task",
      hint: "use ?task=refresh|headshots|dedupe|projections|matchups|settle|full-refresh",
    });
  } catch (e) {
    console.error("cron index fatal:", e);
    // Bubble up Firestore quota messages to the client for visibility
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
