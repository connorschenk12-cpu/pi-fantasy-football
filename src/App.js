import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);

  // Login with Pi
  const login = async () => {
    try {
      // Pi SDK is loaded via <script>, available as window.Pi
      const Pi = window.Pi;

      const authResult = await Pi.authenticate(
        ["username", "payments"],
        (incompletePayment) => {
          console.log("Incomplete payment found:", incompletePayment);
        }
      );

      setUser(authResult.user);
    } catch (err) {
      console.error("Pi login error:", err);
      alert("Failed to login with Pi. Make sure you are in Pi Browser.");
    }
  };

  // Test payment
  const testPayment = () => {
    const Pi = window.Pi;

    Pi.createPayment(
      {
        amount: 1, // Testnet Pi amount
        memo: "Test Pi Payment",
        metadata: { purpose: "testing" }
      },
      {
        onReadyForServerApproval: (paymentId) => console.log("Approve:", paymentId),
        onReadyForServerCompletion: (paymentId, txid) =>
          console.log("Payment completed:", paymentId, txid),
        onCancel: () => console.log("Payment cancelled"),
        onError: (err) => console.error("Payment error:", err)
      }
    );
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Hello Pioneer 👋</h1>
      {!user ? (
        <button onClick={login} style={{ padding: "10px 20px", fontSize: "16px" }}>
          Login with Pi
        </button>
      ) : (
        <div>
          <p>Welcome, {user.username}!</p>
          <button onClick={testPayment} style={{ padding: "10px 20px", fontSize: "16px" }}>
            Test Payment
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
