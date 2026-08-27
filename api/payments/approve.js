// api/payments/approve.js
/* eslint-disable no-console */
import { getPayment, approvePayment, cancelPayment } from "../../src/lib/piPlatform.js";
import { getLeague } from "../../src/lib/storage.js";

/**
 * Step 1 of the dues (U2A) flow.
 * Client calls this from EntryFeeButton's onReadyForServerApproval(paymentId).
 * We do NOT trust anything the client sends except the paymentId — we look the
 * payment up on Pi's servers and validate it against the league before approving.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) return res.status(400).json({ ok: false, error: "paymentId required" });

    const payment = await getPayment(paymentId);

    const leagueId = payment?.metadata?.leagueId;
    const username = payment?.metadata?.username;
    const amountPi = Number(payment?.amount || 0);

    if (!leagueId || !username) {
      await cancelPayment(paymentId).catch(() => {});
      return res.status(400).json({ ok: false, error: "Payment missing leagueId/username metadata" });
    }

    const league = await getLeague(leagueId);
    if (!league) {
      await cancelPayment(paymentId).catch(() => {});
      return res.status(404).json({ ok: false, error: "League not found" });
    }

    const expectedFee = Number(league?.entry?.feePi ?? league?.entry?.amountPi ?? 0);
    if (!league?.entry?.enabled || expectedFee <= 0) {
      await cancelPayment(paymentId).catch(() => {});
      return res.status(400).json({ ok: false, error: "This league is not collecting dues" });
    }

    // Amount must match the league's entry fee exactly (small float tolerance).
    if (Math.abs(amountPi - expectedFee) > 0.0001) {
      await cancelPayment(paymentId).catch(() => {});
      return res.status(400).json({ ok: false, error: "Payment amount does not match league dues" });
    }

    // Already paid? Don't double-approve.
    if (league?.entry?.paid && league.entry.paid[username]) {
      await cancelPayment(paymentId).catch(() => {});
      return res.status(409).json({ ok: false, error: "Dues already recorded for this team" });
    }

    await approvePayment(paymentId);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("payments/approve error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
