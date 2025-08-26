// src/pages/api/payments/markPaid.js
import { payEntry } from "../../../lib/storage.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { leagueId, username } = req.body || {};
    if (!leagueId || !username) return res.status(400).json({ error: "leagueId and username required" });

    // In production, only call this from your provider webhook after verifying payment.
    await payEntry({ leagueId, username, txId: "dev-manual" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("markPaid error:", e);
    return res.status(500).json({ error: e?.message || "Unexpected error" });
  }
}
