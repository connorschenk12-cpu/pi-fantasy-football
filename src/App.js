/* eslint-disable react-hooks/exhaustive-deps */
// src/App.js
import React, { useEffect, useState } from "react";
import Leagues from "./components/Leagues";
import LeagueHome from "./components/LeagueHome";
import PlayerNews from "./components/PlayerNews";

export default function App() {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState("init"); // init | ready | error
  const [error, setError] = useState(null);
  const [openLeague, setOpenLeague] = useState(null);
  const [newsName, setNewsName] = useState(null);

  // Pi SDK init (sandbox true so it works in Pi Browser sandbox)
  useEffect(() => {
    try {
      if (!window.Pi) {
        setStatus("error");
        setError("Pi SDK not found. Open in Pi Browser.");
        return;
      }
      // Init without appId in sandbox mode
      window.Pi.init({ version: "2.0", sandbox: true });
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, []);

  async function login() {
    try {
      if (!window.Pi) throw new Error("Pi SDK not available");
      const scopes = ["username"]; // add "payments" later when enabling entry fees
      const auth = await window.Pi.authenticate(scopes);
      const uname = auth?.user?.username || null;
      if (!uname) throw new Error("No username returned");
      setMe(uname);
    } catch (e) {
      alert(e.message || "Login failed");
    }
  }

  if (status === "init") {
    return <div style={{ padding: 16 }}>Loading Pi SDK…</div>;
  }
  if (status === "error") {
    return (
      <div style={{ padding: 16 }}>
        <h3>App Error</h3>
        <p>{error}</p>
        <p style={{ opacity: 0.7 }}>Open this app inside the Pi Browser sandbox.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Pi Fantasy Football</h2>
        <div>
          {!me ? (
            <button onClick={login} style={{ padding: "8px 12px" }}>Login with Pi</button>
          ) : (
            <span>Signed in as <b>{me}</b></span>
          )}
        </div>
      </header>

      {!me ? (
        <p>Please sign in with Pi to continue.</p>
      ) : !openLeague ? (
        <Leagues username={me} onOpenLeague={setOpenLeague} />
      ) : (
        <LeagueHome
          league={openLeague}
          me={me}
          onBack={() => setOpenLeague(null)}
          onShowNews={setNewsName}
        />
      )}

      {newsName && <PlayerNews name={newsName} onClose={() => setNewsName(null)} />}
    </div>
  );
}
