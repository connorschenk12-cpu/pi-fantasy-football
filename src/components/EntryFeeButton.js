// src/components/EntryFeeButton.js
import React, { useState } from "react";

/**
 * EntryFeeButton
 * Starts a Pi payment for league dues. The actual "this team is paid" write only
 * happens on the server (api/payments/complete.js), after Pi confirms the on-chain
 * transaction — the client never marks itself as paid.
 */
export default function EntryFeeButton({ league, username, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const fee = Number(league?.entry?.feePi ?? league?.entry?.amountPi ?? 0);
  const enabled = !!league?.entry?.enabled;

  if (!enabled || fee <= 0) return null;

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `Request to ${url} failed`);
    }
    return json;
  }

  async function pay() {
    try {
      setMsg("");
      if (typeof window === "undefined" || !window.Pi) {
        throw new Error("Pi SDK not available. Open in Pi Browser (sandbox).");
      }

      setBusy(true);

      try {
        window.Pi.init?.({ version: "2.0", sandbox: true });
      } catch {
        // Pi.init may already be called elsewhere; ignore.
      }

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
          onReadyForServerApproval: async (paymentId) => {
            try {
              await postJson("/api/payments/approve", { paymentId });
            } catch (e) {
              setMsg(e?.message || "Server could not approve payment");
            }
          },
          onReadyForServerCompletion: async (paymentId, txid) => {
            try {
              await postJson("/api/payments/complete", { paymentId, txid });
              setMsg("Dues paid!");
              onPaid && onPaid();
            } catch (e) {
              setMsg(e?.message || "Server could not confirm payment");
            }
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
