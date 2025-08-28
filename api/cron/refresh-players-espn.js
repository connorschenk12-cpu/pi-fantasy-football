// pages/api/cron/refresh-players-espn.js
/* eslint-disable no-console */
import { seedPlayersToGlobal } from "@/src/lib/storage";

export default async function handler(req, res) {
  try {
    // Optional: simple secret check for cron
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Pull latest from your existing ESPN adapter
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/players/espn`);
    if (!r.ok) {
      return res.status(502).json({ error: "ESPN upstream failed" });
    }
    const { players = [] } = await r.json();

    // Normalize/win with ESPN fields if present (optional)
    // seedPlayersToGlobal already keeps name/pos/team/espnId/photo/updatedAt
    const result = await seedPlayersToGlobal(players);
    return res.json({ ok: true, written: result.written });
  } catch (e) {
    console.error("refresh-players-espn error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
