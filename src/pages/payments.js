// src/pages/payments.js
/* Simple placeholder page.
   In production, send the user into your real Pi flow.
   The "Mark as Paid" button calls our API to update Firestore.
*/
import React, { useState } from "react";

export default function Payments() {
  const [leagueId, setLeagueId] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");

  async function handleMarkPaid() {
    setLoading(true);
    setErr("");
    setOk(false);
    try {
      const res = await fetch("/api/payments/markPaid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, username }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed");
      setOk(true);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 20 }}>
      <h2>Payments</h2>
      <p>In production, this page should launch your Pi payment flow. For now, you can mark your entry as paid to test.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <label>
          League ID:
          <input value={leagueId} onChange={(e) => setLeagueId(e.target.value)} />
        </label>
        <label>
          Username:
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <button disabled={loading || !leagueId || !username} onClick={handleMarkPaid}>
          {loading ? "Saving…" : "Mark as Paid"}
        </button>
        {ok && <div style={{ color: "green" }}>Marked as paid. Return to My Team—the banner should be gone.</div>}
        {err && <div style={{ color: "crimson" }}>{err}</div>}
      </div>
    </div>
  );
}
