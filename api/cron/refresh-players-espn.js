/* eslint-disable no-console */
import { seedPlayersToGlobal } from "@/src/lib/storage";

export default async function handler(req, res) {
  try {
    // Build absolute base URL for server-side fetch:
    const proto = (req.headers["x-forwarded-proto"] || "https");
    const host  = req.headers.host;
    // If running locally, fall back to localhost
    const fallback = process.env.NODE_ENV === "development" ? "http://localhost:3000" : `${proto}://${host}`;
    const base = process.env.NEXT_PUBLIC_BASE_URL || fallback;

    // Call your in-app ESPN adapter with an absolute URL
    const r = await fetch(`${base}/api/players/espn`, { cache: "no-store" });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, error: `ESPN upstream failed (${r.status})`, body });
    }
    const { players = [] } = await r.json();

    // Seed/merge into global players
    const result = await seedPlayersToGlobal(players);
    return res.json({ ok: true, written: result.written });
  } catch (e) {
    console.error("refresh-players-espn error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
