import React, { useEffect, useState } from "react";

function App() {
  const [piUser, setPiUser] = useState(null);

  useEffect(() => {
    // Initialize Pi SDK
    if (window.Pi) {
      window.Pi.init({ version: "2.0" });

      // Example auth flow
      window.Pi.authenticate(
        ["username", "payments"], // permissions
        (authResult) => {
          console.log("Auth result:", authResult);
          setPiUser(authResult.user);
        },
        (error) => {
          console.error("Auth failed:", error);
        }
      );
    }
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Pi Fantasy Football</h1>
      {piUser ? (
        <p>Welcome, {piUser.username}!</p>
      ) : (
        <p>Loading Pi user...</p>
      )}
    </div>
  );
}

export default App;
