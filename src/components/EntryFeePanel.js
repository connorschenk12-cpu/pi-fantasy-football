/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { listenLeague, payEntry, setEntrySettings, hasPaidEntry } from "../lib/storage";

export default function EntryFeePanel({ leagueId, username, isOwner=false }) {
  const [league, setLeague] = useState(null);
  const [amount, setAmount] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const paid = hasPaidEntry(league, username);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => {
      setLeague(l);
      setEnabled(!!l?.entry?.enabled);
      setAmount(Number(l?.entry?.amount || 0));
    });
    return () => unsub && unsub();
  }, [leagueId]);

  const saveSettings = async () => {
    try {
      await setEntrySettings({ leagueId, enabled, amount: Number(amount || 0) });
      alert("Entry settings saved.");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  const handlePay = async () => {
    try {
      // In production you’d open Pi Browser payment flow and get a txId back.
      // For now we simulate a txId so you can unblock your draft:
      const fakeTx = `sandbox_${Date.now()}`;
      await payEntry({ leagueId, username, txId: fakeTx });
      alert("Payment recorded (sandbox).");
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
    }
  };

  if (!league) return null;

  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, margin: "8px 0" }}>
      <h3 style={{ marginTop: 0 }}>League Entry Fees</h3>

      {isOwner && (
        <>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Require entry fee
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span>Amount (π):</span>
            <input
              type="number"
              value={amount}
              min={0}
              step="0.1"
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: 120 }}
            />
            <button onClick={saveSettings}>Save</button>
          </div>
          <div style={{ color: "#666", marginBottom: 12 }}>
            Draft cannot start until all members have paid, unless entry fees are disabled (0 π is okay).
          </div>
          <hr />
        </>
      )}

      {enabled ? (
        paid ? (
          <div style={{ color: "green" }}>
            You’re marked as <b>PAID</b>. Tx: {league?.entry?.paid?.[username]?.txId || "(sandbox)"}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 8 }}>
              Entry fee due: <b>{Number(amount || 0).toFixed(2)} π</b>
            </div>
            <button onClick={handlePay}>Pay Entry Fee (sandbox)</button>
          </div>
        )
      ) : (
        <div style={{ color: "#666" }}>Entry fees are disabled for this league.</div>
      )}
    </div>
  );
}
