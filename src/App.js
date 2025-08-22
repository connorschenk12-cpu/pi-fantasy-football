/* eslint-disable no-console */
// src/App.js
import React, { useEffect, useState } from "react";
import Leagues from "./components/Leagues";
import LeagueHome from "./components/LeagueHome";

/**
 * Minimal Pi auth bootstrap:
 * - Tries to init window.Pi if present (Pi Browser)
 * - Falls back to username only auth
 * - Stores user in both React state and window.__PI_USER
 */
async function piLoginUsernameOnly() {
  if (typeof window === "undefined") return null;
  const Pi = window.Pi;
  if (!Pi) {
    console.warn("Pi SDK not found. Are you in Pi Browser?");
    return null;
  }
  try {
    // If you need sandbox: Pi.init({ appId: "YOUR_APP_ID", version: "2.0", sandbox: true });
    if (!Pi.initialized) {
      Pi.init({ version: "2.0" });
    }
    const scopes = ["username"];
    const auth = await Pi.authenticate(scopes, () => ({}));
    const username = auth?.user?.username || null;
    if (!username) return null;
    return { username };
  } catch (e) {
    console.error("Pi auth failed:", e);
    return null;
  }
}

export default function App() {
  const [username, setUsername] = useState(null);
  const [leagueId, setLeagueId] = useState(null);

  // 1) Try cached user from previous page
  useEffect(() => {
    const cached = (typeof window !== "undefined" && window.__PI_USER) || null;
    if (cached?.username) setUsername(cached.username);
  }, []);

  // 2) If missing, attempt Pi auth (Pi Browser)
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (username) return;
      const u = await piLoginUsernameOnly();
      if (mounted && u?.username) {
        window.__PI_USER = u; // cache for other screens
        setUsername(u.username);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [username]);

  // Render state
  if (!username) {
    return (
      <div style={{ padding: 12 }}>
        <h3>Loading Pi user…</h3>
        <div style={{ fontSize: 13, color: "#666" }}>
          If this never finishes, open this app in <b>Pi Browser</b> and log in.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      {!leagueId ? (
        <Leagues
          username={username}
          onOpenLeague={(id) => setLeagueId(id)}
        />
      ) : (
        <LeagueHome
          leagueId={leagueId}
          username={username}
          onBack={() => setLeagueId(null)}
        />
      )}
    </div>
  );
}
