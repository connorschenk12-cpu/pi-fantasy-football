/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import LeagueHome from "./src/components/LeagueHome"; // adjust if your path is "./components/LeagueHome"
import Leagues from "./src/components/Leagues";

function getPi() {
  // Pi SDK is injected in index.html
  if (typeof window !== "undefined" && window.Pi && window.Pi.init) return window.Pi;
  return null;
}

export default function App(){
  const [piReady, setPiReady] = useState(false);
  const [username, setUsername] = useState(null);
  const [leagueId, setLeagueId] = useState(null);
  const [err, setErr] = useState(null);

  // Read leagueId from URL (?league=xxxxx)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const lid = params.get("league");
      if (lid) setLeagueId(lid);
    } catch(e){ console.warn("URL parse failed", e); }
  }, []);

  // Init Pi if present
  useEffect(() => {
    const Pi = getPi();
    if (!Pi) { setPiReady(false); return; }
    try {
      // Use sandbox if you were using it before; otherwise remove sandbox:true
      Pi.init({ version:"2.0", sandbox: true }); 
      setPiReady(true);
    } catch(e){
      console.error("Pi.init error", e);
      setErr(e);
    }
  }, []);

  async function doLogin(scope = ["username"]){
    try {
      const Pi = getPi();
      if (!Pi) {
        setErr(new Error("Pi SDK not found. Open in Pi Browser or try /auth-test.html"));
        return;
      }
      const user = await Pi.authenticate(scope, onIncompletePaymentFound);
      const uname = user?.user?.username;
      console.log("Pi.authenticate ->", user);
      if (!uname) throw new Error("No username returned");
      setUsername(uname);
    } catch(e){
      console.error("Login failed", e);
      setErr(e);
    }
  }

  function onIncompletePaymentFound(payment){
    console.log("onIncompletePaymentFound", payment);
    // noop for now
  }

  // Very defensive UI
  if (err) {
    return (
      <div style={{padding:16}}>
        <h2>Login Error</h2>
        <pre style={{whiteSpace:"pre-wrap"}}>{String(err)}</pre>
        <p>Try opening <a href="/auth-test.html">/auth-test.html</a> to verify Pi login.</p>
        <button onClick={() => { setErr(null); }}>Dismiss</button>
      </div>
    );
  }

  if (!piReady) {
    return (
      <div style={{padding:16}}>
        <h2>Loading Pi user…</h2>
        <p>If this never finishes, open this app in <b>Pi Browser</b> or test <a href="/auth-test.html">/auth-test.html</a>.</p>
        <button onClick={() => doLogin(["username"])}>Login with Pi</button>
      </div>
    );
  }

  if (!username) {
    return (
      <div style={{padding:16}}>
        <h2>Welcome to Pi Fantasy Football</h2>
        <button onClick={() => doLogin(["username"])}>Login with Pi</button>
        <p style={{opacity:0.7, marginTop:8}}>
          Trouble? Test <a href="/auth-test.html">/auth-test.html</a>.
        </p>
      </div>
    );
  }

  // You’re logged in. Show your leagues (and pass a callback to open a league).
  return (
    <div style={{padding:12}}>
      {!leagueId ? (
        <Leagues
          username={username}
          onOpenLeague={(lid) => setLeagueId(lid)}
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
