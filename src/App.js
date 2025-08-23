/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import LeagueHome from "./components/LeagueHome";
import Leagues from "./components/Leagues";

function getPi() {
  if (typeof window !== "undefined" && window.Pi && window.Pi.init) return window.Pi;
  return null;
}

export default function App(){
  const [piReady, setPiReady] = useState(false);
  const [username, setUsername] = useState(null);
  const [leagueId, setLeagueId] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const lid = params.get("league");
      if (lid) setLeagueId(lid);
    } catch(e){ console.warn("URL parse failed", e); }
  }, []);

  useEffect(() => {
    const Pi = getPi();
    if (!Pi) { setPiReady(false); return; }
    try {
      Pi.init({ version:"2.0", sandbox: true }); // remove sandbox:true in production
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
      const user = await Pi.authenticate(scope, (p)=>console.log("incompletePayment", p));
      const uname = user?.user?.username;
      if (!uname) throw new Error("No username returned");
      setUsername(uname);
    } catch(e){
      console.error("Login failed", e);
      setErr(e);
    }
  }

  if (err) {
    return (
      <div style={{padding:16}}>
        <h2>Login Error</h2>
        <pre style={{whiteSpace:"pre-wrap"}}>{String(err)}</pre>
        <p>Try <a href="/auth-test.html">/auth-test.html</a> in Pi Browser.</p>
        <button onClick={() => setErr(null)}>Dismiss</button>
      </div>
    );
  }

  if (!piReady) {
    return (
      <div style={{padding:16}}>
        <h2>Loading Pi user…</h2>
        <button onClick={() => doLogin(["username"])}>Login with Pi</button>
      </div>
    );
  }

  if (!username) {
    return (
      <div style={{padding:16}}>
        <h2>Welcome to Pi Fantasy Football</h2>
        <button onClick={() => doLogin(["username"])}>Login with Pi</button>
      </div>
    );
  }

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
