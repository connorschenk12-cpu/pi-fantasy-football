// api/payments/pi-webhook.js
import { NextResponse } from "next/server";
import { payEntry } from "../../src/lib/storage";
import { db } from "../../src/lib/firebase";

// NOTE: If using Edge runtime, swap to `export const config = { runtime: "edge" }`
// and adjust to the Web Fetch API instead of NextResponse.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    // 1) Verify signature from Pi (depends on their docs). Pseudocode:
    // const signature = req.headers["x-pi-signature"];
    // verifySignatureOrThrow(signature, req.rawBody, process.env.PI_WEBHOOK_SECRET);

    const { leagueId, username, txId, amountPi, status } = req.body || {};
    if (status !== "COMPLETED") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (!leagueId || !username || !txId) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // 2) (Optionally) validate amountPi against your league entry amount.
    // 3) Record payment as paid:
    await payEntry({ leagueId, username, txId });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("pi-webhook error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
