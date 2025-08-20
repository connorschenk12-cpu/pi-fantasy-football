import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function handleLoginUsernameOnly() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open this in Pi Browser.");
      return;
    }
    try {
      setStatus("⏳ Authenticating (username only)...");
      const authResult = await window.Pi.authenticate(["username"], onIncompletePaymentFound);
      console.log("✅ Auth success:", authResult);
      setUser(authResult.user || authResult); // Some SDK returns { user }, others return user
      setStatus("✅ Logged in!");
    } catch (err) {
      console.error("❌ Authentication failed:", err);
      setStatus("❌ Authentication failed. Check App URL & App ID in Portal.");
    }
  }

  async function handleLoginWithPayments() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open this in Pi Browser.");
      return;
    }
    try {
      setStatus("⏳ Authenticating (username + payments)...");
      const authResult = await window.Pi.authenticate(["username", "payments"], onIncompletePaymentFound);
      console.log("✅ Auth+payments success:", authResult);
      setUser(authResult.user || authResult);
      setStatus("✅ Logged in with payments!");
    } catch (err) {
      console.error("❌ Auth with payments failed:", err);
      setStatus("❌ Payments scope failed. Try username-only first and confirm your Testnet wallet + permissions.");
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={handleLoginUsernameOnly} style={{ padding: 10, fontSize: 16 }}>
            Login (username only)
          </button>
          <button onClick={handleLoginWithPayments} style={{ padding: 10, fontSize: 16 }}>
            Login (username + payments)
          </button>
        </div>
      )}

      {user && (
        <div style={{ marginTop: 16 }}>
          <p><strong>Logged in as:</strong> {user.username || "(no username?)"}</p>
          <pre
            style={{
              textAlign: "left",
              background: "#f6f8fa",
              padding: 12,
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default App;
