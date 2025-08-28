// pages/api/cron/refresh-players-espn.js
/* eslint-disable no-console */
import { seedPlayersToGlobal } from "@/src/lib/storage";
import { runHeadshotBackfill } from "./backfill-headshots.js";

export const config = {
  maxDuration: 60, // safety for Vercel cron
};

export default async function handler(req, res) {
  try {
    // Optional: simple secret check for cron
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // 1) Pull latest from your ESPN adapter endpoint
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/players/espn`
    );
    if (!r.ok) {
      return res.status(502).json({ error: "ESPN upstream failed" });
    }
    const { players = [] } = await r.json();

    // 2) Seed to GLOBAL collection
    const seedResult = await seedPlayersToGlobal(players);

    // 3) Immediately run headshot + ESPN ID backfill
    const backfillResult = await runHeadshotBackfill();

    return res.json({
      ok: true,
      written: seedResult.written,
      backfill: backfillResult,
    });
  } catch (e) {
    console.error("refresh-players-espn error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
