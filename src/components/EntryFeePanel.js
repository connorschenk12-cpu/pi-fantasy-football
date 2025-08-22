/* eslint-disable no-console */
import React, { useState } from "react";
import { markEntryPaid } from "../lib/storage";

export default function EntryFeePanel({ league, username }) {
  const [busy, setBusy] = useState(false);
  const price = Number(league?.entry?.pricePi || 0);

  async function pay() {
    try {
      setBusy(true);
      const Pi = window.Pi;
      if (Pi && Pi.createPayment && price > 0) {
        await Pi.createPayment({
          amount: price,
          memo: `Entry fee for ${league?.name || league?.id}`,
          metadata: { leagueId: league?.id || "" },
        }, {
          onReadyForServerApproval: async (paymentId) => {
            await markEntryPaid({ leagueId: league.id, username, txId: paymentId, amountPi: price });
          },
          onReadyForServerCompletion: async () => {},
          onCancel: () => {},
          onError: (err) => { throw err; },
        });
      } else {
        // Sandbox / free leagues / no Pi SDK path:
        await markEntryPaid({ leagueId: league.id, username, txId: "sandbox", amountPi: price });
      }
      alert("Entry recorded. You’re good!");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    } finally { setBusy(false); }
  }

  const paid = !!league?.entry?.paid?.[username];

  return (
    <div style={{ border:"1px solid #ddd", borderRadius:8, padding:12, marginTop:8 }}>
      <div><b>Entry:</b> {league?.entry?.enabled ? `${price} π` : "Disabled (free league)"}</div>
      {!paid && league?.entry?.enabled ? (
        <button disabled={busy} onClick={pay} style={{ marginTop:8 }}>Pay Entry</button>
      ) : (
        <div style={{ marginTop:8, color:"#0a0" }}>{league?.entry?.enabled ? "Paid ✅" : "No payment required"}</div>
      )}
    </div>
  );
}
