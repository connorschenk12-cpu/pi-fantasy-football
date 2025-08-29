// api/cron/refresh-players-espn.js
/* eslint-disable no-console */
import { seedPlayersToGlobal } from "../../src/lib/storage.js";

function resolveBaseUrl() {
  // Prefer explicit base, else Vercel env, else localhost for dev
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const base = resolveBaseUrl();
    const upstream = `${base}/api/players/espn`;

    const r = await fetch(upstream, { cache: "no-store" });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error("ESPN upstream failed:", r.status, body);
      return res.status(502).json({ ok: false, error: "ESPN upstream failed", status: r.status });
    }

    const data = await r.json().catch(() => ({}));
    const players = Array.isArray(data?.players) ? data.players : [];

    const result = await seedPlayersToGlobal(players);
    return res.json({ ok: true, written: result.written, countReceived: players.length });
  } catch (e) {
    console.error("refresh-players-espn error:", e);
    return res.status(500).json({ ok: false, where: "refresh-players-espn", error: String(e?.message || e) });
  }
}
