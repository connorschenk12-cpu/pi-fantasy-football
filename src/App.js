/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import LeagueHome from "./components/LeagueHome";
import Leagues from "./components/Leagues";

function getPi() {
  if (typeof window !== "undefined" && window.Pi && typeof window.Pi.init === "function") {
    return window.Pi;
  }
  return null;
}

export default function App() {
  const [piReady, setPiReady] = useState(false);
  const [username, setUsername] = useState(null);
  const [leagueId, setLeagueId] = useState(null);
  const [err, setErr] = useState(null);

  // Parse URL params early
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const lid = params.get("league");
      if (lid) setLeagueId(lid);

      // Dev-only fast login: ?devuser=alice
      const devuser = params.get("devuser");
      if (devuser) setUsername(devuser);
    } catch (e) {
      console.warn("URL parse failed", e);
    }
  }, []);

  // Initialize Pi SDK (if present)
  useEffect(() => {
    const Pi = getPi();
    if (!Pi) {
      // No Pi SDK (desktop browser or blocked). We can still show the manual login button.
      setPiReady(false);
      return;
    }
    try {
      // In Pi Browser sandbox, keep sandbox:true. In production Pi Browser, you can remove it.
      Pi.init({ version: "2.0", sandbox: true });
      setPiReady(true);
    } catch (e) {
      console.error("Pi.init error", e);
      setErr(e);
    }
  }, []);

  async function doLogin(scopes = ["username"]) {
    try {
      const Pi = getPi();
      if (!Pi) {
        setErr(
          new Error(
            "Pi SDK not found. Open this app in Pi Browser or use ?devuser=YourName for dev login."
          )
        );
        return;
      }
      const user = await Pi.authenticate(scopes, (payment) =>
        console.log("incompletePayment", payment)
      );
      const uname = user?.user?.username;
      if (!uname) throw new Error("No username returned from Pi SDK");
      setUsername(uname);
    } catch (e) {
      console.error("Login failed", e);
      setErr(e);
    }
  }

  // UI states

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Problem</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>{String(err)}</pre>
        <p>
          Tip: try <a href="/auth-test.html">/auth-test.html</a> in Pi Browser, or add{" "}
          <code>?devuser=YourName</code> to the URL for a dev-only login.
        </p>
        <button onClick={() => setErr(null)}>Dismiss</button>
      </div>
    );
  }

  // If you used ?devuser=..., username is already set.
  const manualDevLoginActive = !!username;

  // If not logged in:
  if (!username) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Welcome to Pi Fantasy Football</h2>
        <p style={{ marginTop: 8, marginBottom: 16 }}>
          {piReady
            ? "Log in with your Pi account."
            : "Pi SDK not detected yet. If you're in Pi Browser and still see this, try the Login button or use ?devuser=YourName for a dev login."}
        </p>
        <button onClick={() => doLogin(["username"])}>Login with Pi</button>
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Dev tip: append <code>?devuser=alice</code> to the URL to bypass Pi login temporarily.
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div style={{ padding: 12 }}>
      {!leagueId ? (
        <Leagues username={username} onOpenLeague={(lid) => setLeagueId(lid)} />
      ) : (
        <LeagueHome leagueId={leagueId} username={username} onBack={() => setLeagueId(null)} />
      )}
      {manualDevLoginActive && (
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>
          Dev login active (via <code>?devuser=</code>). Remove the param to use real Pi auth.
        </div>
      )}
    </div>
  );
}
