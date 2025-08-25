// src/pages/payments.jsx
import React, { useMemo } from "react";

export default function PaymentsPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const leagueId = params.get("league") || "";
  // optionally pass username from your auth context

  // TODO: your real Pi SDK init + checkout start
  // This page can render the provider button or auto-launch the flow.

  return (
    <div style={{ padding: 16 }}>
      <h2>Complete Entry Payment</h2>
      <p>League: <b>{leagueId}</b></p>

      {/* Replace with your Pi provider button */}
      <button
        onClick={() => {
          // 1) Launch provider payment UI
          // 2) On success, provider POSTs to /api/payments/pi-webhook
          // 3) Optionally redirect back to /app
          alert("Replace this button with your Pi payment UI.");
        }}
      >
        Pay with Pi
      </button>

      <p style={{ marginTop: 10, color: "#666" }}>
        After the payment is confirmed, your entry will be marked as paid automatically.
      </p>
    </div>
  );
}
