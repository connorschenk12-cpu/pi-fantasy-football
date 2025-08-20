// src/App.js
import React, { useEffect, useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Loading Pi User...");

  useEffect(() => {
    console.log("🔵 App mounted");

    if (!window.Pi) {
      console.error("❌ window.Pi is not defined. Make sure to open in Pi Browser.");
      setStatus("Pi SDK not found. Open in Pi Browser.");
      return;
    }

    console.log("✅ Pi SDK detected:", window.Pi);

    // Try authentication
    window.Pi.authenticate(
      ["username", "payments"],
      onIncompletePaymentFound
    ).then(function(authResult) {
      console.log("✅ Authentication success:", authResult);
      setUser(authResult.user);
      setStatus("User loaded!");
    }).catch(function(err) {
      console.error("❌ Authentication failed:", err);
      setStatus("Authentication failed.");
    });
  }, []);

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>
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
