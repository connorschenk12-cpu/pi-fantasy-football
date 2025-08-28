// api/cron/refresh-players-espn.js
/* eslint-disable no-console */
import { seedPlayersToGlobal } from "../../src/lib/storage.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  try {
    // Accept GET/POST from the browser (no secret check, for now)

    // Pull latest from your ESPN adapter living in the same project
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/players/espn`, {
      cache: "no-store",
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "ESPN upstream failed", status: r.status, body: txt });
    }

    const data = await r.json().catch(() => ({}));
    const players = Array.isArray(data?.players) ? data.players : [];

    const result = await seedPlayersToGlobal(players);
    return res.status(200).json({ ok: true, written: result.written });
  } catch (e) {
    console.error("refresh-players-espn error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
