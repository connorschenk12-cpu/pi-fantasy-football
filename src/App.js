import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function handleLogin() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open this in Pi Browser.");
      return;
    }

    try {
      setStatus("⏳ Authenticating...");
      const authResult = await window.Pi.authenticate(
        ["username", "payments"],
        onIncompletePaymentFound
      );
      console.log("✅ Authentication success:", authResult);
      setUser(authResult.user);
      setStatus("✅ Logged in!");
    } catch (err) {
      console.error("❌ Authentication failed:", err);
      // Common causes: wrong App ID in Pi.init, App URL mismatch in Portal
      setStatus("❌ Authentication failed. Check App ID & App URL in Portal.");
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <button onClick={handleLogin} style={{ padding: 10, fontSize: 16 }}>
          Login with Pi
        </button>
      )}

      {user && (
        <div style={{ marginTop: 16 }}>
          <p>
            <strong>Logged in as:</strong> {user.username}
          </p>
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
