// src/components/EntryFeeButton.js
import React, { useState } from "react";
import { markEntryPaid } from "../lib/storage";

export default function EntryFeeButton({ league, username, onPaid }) {
  const [busy, setBusy] = useState(false);
  const fee = Number(league?.entry?.feePi || 0);
  const enabled = !!league?.entry?.enabled;

  if (!enabled || fee <= 0) return null;

  async function pay() {
    try {
      if (!window.Pi) throw new Error("Pi SDK not available");
      setBusy(true);

      // request payments scope if not already granted
      const scopes = ["username", "payments"];
      await window.Pi.authenticate(scopes); // no-op if already granted

      const payment = await window.Pi.createPayment({
        amount: fee,
        memo: `Entry fee for ${league?.name || "league"}`,
        metadata: { leagueId: league?.id, username },
      }, {
        onReadyForServerApproval: async (data) => {
          // SANDBOX ONLY: instantly mark as paid (no backend yet)
          await markEntryPaid(league.id, username, data.identifier, fee);
          onPaid && onPaid();
        },
        onReadyForServerCompletion: async () => {},
        onCancel: () => {},
        onError: (err) => { throw err; },
      });

      if (!payment) throw new Error("Payment failed to start");
      alert("Entry fee recorded (sandbox)");
    } catch (e) {
      alert(e.message || "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={pay} disabled={busy} style={{ padding: 8 }}>
      {busy ? "Processing…" : `Pay Entry Fee (${fee} π)`}
    </button>
  );
}
