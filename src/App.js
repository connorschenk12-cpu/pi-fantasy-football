import React, { useState, useEffect } from "react";

function App() {
  const [piUser, setPiUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function initPi() {
      if (!window.Pi) {
        setError("Pi SDK not found. Please open in Pi Browser.");
        return;
      }

      try {
        // Initialize Pi SDK
        window.Pi.init({ version: "2.0" });

        // Authenticate user
        const scopes = ["username", "payments"];
        const user = await window.Pi.authenticate(
          scopes,
          (payment) => console.log("Payment callback:", payment)
        );

        setPiUser(user);
      } catch (err) {
        console.error("Pi Authentication failed:", err);
        setError(err.message);
      }
    }

    initPi();
  }, []);

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h1>Pi Fantasy Football</h1>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {!piUser && !error && <p>Loading Pi user...</p>}

      {piUser && (
        <div>
          <h2>Welcome, {piUser.username}!</h2>
          <p>Your Pi ID: {piUser.uid}</p>
        </div>
      )}
    </div>
  );
}

export default App;
