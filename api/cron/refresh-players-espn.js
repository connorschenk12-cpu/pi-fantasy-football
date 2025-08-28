/* eslint-disable no-console */
// api/cron/refresh-players-espn.js
import { seedPlayersToGlobal } from "../../src/lib/storage.js";

export default async function handler(req, res) {
  try {
    // Optional: simple secret check for cron
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Absolute base URL for server-side fetch to your internal route
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const fallback =
      process.env.NODE_ENV === "development" ? "http://localhost:3000" : `${proto}://${host}`;
    const base = process.env.NEXT_PUBLIC_BASE_URL || fallback;

    let upstream;
    try {
      upstream = await fetch(`${base}/api/players/espn`, { cache: "no-store" });
    } catch (err) {
      console.error("refresh-players-espn: fetch to /api/players/espn failed:", err);
      return res.status(502).json({
        ok: false,
        where: "fetch(/api/players/espn)",
        error: String(err?.message || err),
        base,
      });
    }

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      console.error("refresh-players-espn upstream failed:", upstream.status, body);
      return res
        .status(502)
        .json({ ok: false, error: `ESPN upstream failed (${upstream.status})`, body, base });
    }

    let data;
    try {
      data = await upstream.json();
    } catch (err) {
      console.error("refresh-players-espn: invalid JSON from /api/players/espn:", err);
      return res
        .status(502)
        .json({ ok: false, error: "invalid JSON from /api/players/espn", details: String(err) });
    }

    const players = Array.isArray(data.players) ? data.players : [];
    let result;
    try {
      result = await seedPlayersToGlobal(players);
    } catch (err) {
      console.error("refresh-players-espn: seedPlayersToGlobal crashed:", err);
      return res.status(500).json({
        ok: false,
        where: "seedPlayersToGlobal",
        error: String(err?.message || err),
      });
    }

    return res.json({
      ok: true,
      written: result.written,
      countReceived: players.length,
    });
  } catch (e) {
    console.error("refresh-players-espn top-level error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
