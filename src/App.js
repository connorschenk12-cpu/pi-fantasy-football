import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);

  const login = async () => {
    try {
      const Pi = window.Pi;
      const authResult = await Pi.authenticate(["username", "payments"]);
      setUser(authResult.user);
    } catch (err) {
      console.error("Pi login error:", err);
      alert("Login failed. Use Pi Browser.");
    }
  };

  return (
    <div>
      {!user ? (
        <button onClick={login}>Login with Pi</button>
      ) : (
        <p>Welcome, {user.username}!</p>
      )}
    </div>
  );
}

export default App;
