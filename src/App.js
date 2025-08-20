import React, { useState } from "react";

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function login(scopes) {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open in Pi Browser.");
      return;
    }
    try {
      setStatus(`⏳ Authenticating (${scopes.join(", ")})...`);
      const result = await window.Pi.authenticate(scopes, onIncompletePaymentFound);
      const u = result?.user || result;
      if (!u?.username) throw new Error("No username returned");
      setUser(u);
      setStatus("✅ Logged in!");
    } catch (err) {
      console.error("❌ Authentication failed:", err);
      setStatus("❌ Authentication failed or timed out. Check Sandbox authorization & Dev Portal URL.");
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => login(["username"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username only)
          </button>
          <button onClick={() => login(["username", "payments"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username + payments)
          </button>
        </div>
      )}

      {user && (
        <div style={{ marginTop: 16 }}>
          <p><strong>Logged in as:</strong> {user.username}</p>
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
