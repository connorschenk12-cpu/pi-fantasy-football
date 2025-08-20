import React, { useEffect, useState } from "react";

function App() {
  const [piUser, setPiUser] = useState(null);
  const [leagueName, setLeagueName] = useState("");
  const [myLeagues, setMyLeagues] = useState([]);

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

  const handleCreateLeague = () => {
    if (!leagueName.trim()) return;

    // In the future, we'll save this to a database.
    setMyLeagues([...myLeagues, leagueName]);
    setLeagueName("");
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Pi Fantasy Football</h1>

      {piUser ? (
        <div>
          <p>Welcome, {piUser.username}!</p>

          <h2>Create a League</h2>
          <input
            type="text"
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder="Enter league name"
          />
          <button onClick={handleCreateLeague} style={{ marginLeft: "10px" }}>
            Create League
          </button>

          <h2>My Leagues</h2>
          {myLeagues.length > 0 ? (
            <ul>
              {myLeagues.map((league, index) => (
                <li key={index}>{league}</li>
              ))}
            </ul>
          ) : (
            <p>No leagues yet. Create one above!</p>
          )}
        </div>
      ) : (
        <p>Loading Pi user...</p>
      )}
    </div>
  );
}

export default App;
