import { Pi } from "pi-sdk";
import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);

  // Login with Pi
  const login = async () => {
    try {
      const authResult = await Pi.authenticate(['username', 'payments'], (payment) => {
        console.log("Incomplete payment found:", payment);
      });
      setUser(authResult.user);
    } catch (err) {
      console.error(err);
    }
  };

  // Test Payment
  const testPayment = () => {
    Pi.createPayment({
      amount: 1,
      memo: "Test Pi Payment",
      metadata: { purpose: "testing" }
    }, {
      onReadyForServerApproval: (paymentId) => console.log("Approve:", paymentId),
      onReadyForServerCompletion: (paymentId, txid) => console.log("Completed:", paymentId, txid),
      onCancel: () => console.log("Cancelled"),
      onError: (err) => console.error(err)
    });
  };

  return (
    <div>
      <h1>Hello Pioneer 👋</h1>
      {!user ? (
        <button onClick={login}>Login with Pi</button>
      ) : (
        <div>
          <p>Welcome, {user.username}!</p>
          <button onClick={testPayment}>Test Payment</button>
        </div>
      )}
    </div>
  );
}

export default App;
