import React, { useState } from "react";
import Leagues from "./components/Leagues";

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");
  const [view, setView] = useState("home"); // "home" | "leagues" | "league"
  const [activeLeague, setActiveLeague] = useState(null);

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function login(scopes) {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open in Pi Browser.");
      return;
    }
    try {
      setStatus(`⏳ Authenticating (${scopes.join(", ")})...`);
      const result = await window.Pi.authenticate(scopes, onIncompletePaymentFound);
      const u = result?.user || result;
      if (!u?.username) throw new Error("No username returned");
      setUser(u);
      setStatus("✅ Logged in!");
    } catch (err) {
      console.error("❌ Authentication failed:", err);
      setStatus("❌ Authentication failed or timed out. Check Sandbox authorization & Dev Portal URL.");
    }
  }

  function openLeagues() {
    if (!user) return setStatus("Please log in first.");
    setView("leagues");
  }

  function handleOpenLeague(l) {
    setActiveLeague(l);
    setView("league");
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={() => login(["username"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username only)
          </button>
          <button onClick={() => login(["username", "payments"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username + payments)
          </button>
        </div>
      )}

      {user && (
        <>
          <div style={{ marginBottom: 16 }}>
            <strong>Logged in as:</strong> {user.username}
          </div>

          {view === "home" && (
            <div style={{ display: "grid", gap: 12 }}>
              <button onClick={openLeagues} style={{ padding: 12 }}>
                Go to Leagues
              </button>
              {/* future: “My Team”, “Weekly Matchup”, etc. */}
            </div>
          )}

          {view === "leagues" && (
            <Leagues username={user.username} onOpenLeague={handleOpenLeague} />
          )}

          {view === "league" && activeLeague && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setView("leagues")} style={{ marginBottom: 12, padding: 8 }}>
                ← Back to Leagues
              </button>
              <h2>{activeLeague.name}</h2>
              <p><strong>League ID:</strong> <code>{activeLeague.id}</code></p>
              <p><strong>Members:</strong> {activeLeague.members.join(", ")}</p>

              {/* Stubs for next steps */}
              <h3 style={{ marginTop: 16 }}>Team Roster (coming soon)</h3>
              <p>Pick players here. (We’ll wire this up next.)</p>

              <h3 style={{ marginTop: 16 }}>Weekly Matchup (coming soon)</h3>
              <p>See who you’re facing and projected points.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
