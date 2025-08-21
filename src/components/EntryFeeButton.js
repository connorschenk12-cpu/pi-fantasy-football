// src/components/EntryFeeButton.js
import React, { useState } from "react";
import { markEntryPaid } from "../lib/storage";

/**
 * EntryFeeButton
 * - Shows a button to pay the entry fee (π).
 * - Sandbox-only "server" logic: marks paid as soon as onReadyForServerApproval fires.
 * - In production, you'd forward the payment to your server to verify/approve/complete.
 */
export default function EntryFeeButton({ league, username, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const fee = Number(league?.entry?.feePi || 0);
  const enabled = !!league?.entry?.enabled;

  if (!enabled || fee <= 0) return null;

  async function pay() {
    try {
      setMsg("");
      if (typeof window === "undefined" || !window.Pi) {
        throw new Error("Pi SDK not available. Open in Pi Browser (sandbox).");
      }

      setBusy(true);

      // Ensure we’re initialized (safe to call multiple times)
      try {
        window.Pi.init?.({ version: "2.0", sandbox: true });
      } catch {
        // ignore init errors here; Pi.init may already be called elsewhere
      }

      // Ensure we have payments scope
      try {
        await window.Pi.authenticate(["username", "payments"]);
      } catch (e) {
        throw new Error(e?.message || "Failed to get payments permission");
      }

      const payment = await window.Pi.createPayment(
        {
          amount: fee,
          memo: `Entry fee for ${league?.name || "league"}`,
          metadata: { leagueId: league?.id, username },
        },
        {
          onReadyForServerApproval: async (data) => {
            // SANDBOX ONLY: instantly mark paid (no backend yet)
            try {
              await markEntryPaid(league.id, username, data?.identifier || "sandbox", fee);
              setMsg("Payment recorded (sandbox).");
              onPaid && onPaid();
            } catch (e) {
              setMsg(e?.message || "Failed to record payment");
            }
          },
          onReadyForServerCompletion: async () => {
            // No-op in sandbox
          },
          onCancel: () => {
            setMsg("Payment cancelled.");
          },
          onError: (err) => {
            setMsg(err?.message || "Payment error");
          },
        }
      );

      if (!payment) throw new Error("Payment failed to start.");
    } catch (e) {
      setMsg(e?.message || "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={pay} disabled={busy} style={{ padding: 8 }}>
        {busy ? "Processing…" : `Pay Entry Fee (${fee} π)`}
      </button>
      {msg && <span style={{ fontSize: 13, opacity: 0.8 }}>{msg}</span>}
    </div>
  );
}
