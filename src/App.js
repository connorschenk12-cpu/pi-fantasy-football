import React, { useEffect, useState } from "react";
import { initPi, piLogin } from "./index";
import Leagues from "./components/Leagues";
import LeagueHome from "./components/LeagueHome";
import PlayerNews from "./components/PlayerNews";
import { useState } from "react";
// ...
const [newsName, setNewsName] = useState(null);


export default function App() {
  const [me, setMe] = useState(null);
  const [phase, setPhase] = useState("init"); // init | login | authed
  const [openLeague, setOpenLeague] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const res = await initPi();
      if (!res.ok) {
        setErr(res.error || "Pi init failed");
        setPhase("login");
      } else {
        setPhase("login");
      }
    })();
  }, []);

  async function handleLogin() {
    setErr("");
    try {
      const auth = await piLogin(["username"]); // add "payments" later
      setMe(auth?.user?.username || null);
      setPhase("authed");
    } catch (e) {
      setErr(e?.message || "Authentication failed");
    }
  }

  if (phase !== "authed" || !me) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Pi Fantasy Football</h1>
        <p style={{ opacity: 0.8 }}>Welcome! Log in with Pi to continue.</p>
        {err && <p style={{ color: "#d00" }}>⚠️ {err}</p>}
        <button onClick={handleLogin} style={{ padding: 10 }}>Login with Pi</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Pi Fantasy Football</h1>
      <div style={{ marginBottom: 8, opacity: 0.8 }}>
        Logged in as <strong>{me}</strong>
      </div>

   {!openLeague ? (
  <Leagues username={me} onOpenLeague={setOpenLeague} />
) : (
  <LeagueHome league={openLeague} me={me} onBack={() => setOpenLeague(null)} onShowNews={setNewsName} />
)}
{newsName && <PlayerNews name={newsName} onClose={() => setNewsName(null)} />}

    </div>
  );
}
