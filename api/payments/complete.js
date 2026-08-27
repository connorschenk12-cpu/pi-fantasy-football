// api/payments/complete.js
/* eslint-disable no-console */
import { getPayment, completePayment } from "../../src/lib/piPlatform.js";
import { getLeague, recordSuccessfulEntryPayment } from "../../src/lib/storage.js";

/**
 * Step 2 of the dues (U2A) flow.
 * Client calls this from EntryFeeButton's onReadyForServerCompletion(paymentId, txid).
 * We call Pi's /complete endpoint (which itself verifies the on-chain tx matches the
 * payment), then re-fetch the payment to confirm it's genuinely done before touching
 * Firestore. Only a payment Pi reports as complete can mark a team paid.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { paymentId, txid } = req.body || {};
    if (!paymentId || !txid) {
      return res.status(400).json({ ok: false, error: "paymentId and txid required" });
    }

    // Ask Pi to complete the payment — this checks the txid against the real
    // Stellar transaction and rejects if it doesn't match what was approved.
    await completePayment(paymentId, txid);

    // Re-fetch as the source of truth rather than trusting our own completePayment() response.
    const payment = await getPayment(paymentId);
    const isDone = !!payment?.status?.developer_completed && !!payment?.status?.transaction_verified;
    if (!isDone) {
      return res.status(409).json({ ok: false, error: "Pi has not confirmed this payment yet" });
    }

    const leagueId = payment?.metadata?.leagueId;
    const username = payment?.metadata?.username;
    const amountPi = Number(payment?.amount || 0);
    if (!leagueId || !username) {
      return res.status(400).json({ ok: false, error: "Payment missing leagueId/username metadata" });
    }

    // Idempotency: if we already recorded this team as paid (e.g. a retried request), don't double-credit the pool.
    const league = await getLeague(leagueId);
    if (league?.entry?.paid && league.entry.paid[username]) {
      return res.status(200).json({ ok: true, alreadyRecorded: true });
    }

    await recordSuccessfulEntryPayment({ leagueId, username, amountPi, paymentId: txid });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("payments/complete error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
