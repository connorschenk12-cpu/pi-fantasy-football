import React, { useState, useEffect } from "react";
import Leagues from "./components/Leagues";
import LeagueHome from "./components/LeagueHome";

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");
  const [view, setView] = useState("home"); // 'home' | 'leagues' | 'league'
  const [activeLeague, setActiveLeague] = useState(null); // <- always use this var

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
    setActiveLeague(l || null);
    setView("league");
  }

  // Auto-join handler for ?join=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const toJoin = params.get("join");
    if (!toJoin || !user) return;

    (async () => {
      try {
        // lazy import to avoid circular refs
        const { joinLeague } = await import("./lib/storage");
        await joinLeague({ leagueId: toJoin, username: user.username });
        setStatus(`✅ Joined league ${toJoin}`);
        const url = new URL(window.location.href);
        url.searchParams.delete("join");
        window.history.replaceState({}, "", url.toString());
        setView("leagues");
      } catch (e) {
        console.error(e);
        setStatus("❌ League not found for join link.");
      }
    })();
  }, [user]);

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
            </div>
          )}

          {view === "leagues" && (
            <Leagues username={user.username} onOpenLeague={handleOpenLeague} />
          )}

          {view === "league" && (
            activeLeague ? (
              <LeagueHome
                league={activeLeague}
                me={user.username}
                onBack={() => setView("leagues")}
              />
            ) : (
              <div>
                <p>⚠️ No league selected.</p>
                <button onClick={() => setView("leagues")} style={{ padding: 8 }}>
                  ← Back to Leagues
                </button>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
