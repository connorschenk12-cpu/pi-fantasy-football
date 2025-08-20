import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function handleLogin() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open in Pi Browser.");
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
      setStatus("❌ Authentication failed. Check app settings.");
    }
  }

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>
      {!user && (
        <button onClick={handleLogin} style={{ padding: "10px", fontSize: "16px" }}>
          Login with Pi
        </button>
      )}
      {user && (
        <div>
          <p><strong>Logged in as:</strong> {user.username}</p>
          <pre>{JSON.stringify(user, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
