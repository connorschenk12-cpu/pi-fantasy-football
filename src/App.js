/* eslint-disable no-console */
// src/App.js
import React, { useEffect, useMemo, useState } from "react";
import Leagues from "./components/Leagues";
import LeagueHome from "./components/LeagueHome";

const APP_ID = "fantasy-football-f6a0c6cf6115e138"; // your slug/appId
const USE_SANDBOX = true; // testing in Pi Browser sandbox

function getPi() {
  if (typeof window === "undefined") return null;
  return window.Pi || null;
}

async function piInitIfNeeded(Pi) {
  if (!Pi) return false;
  try {
    // If you’ve already initialized elsewhere, this is harmless
    if (!Pi.initialized) {
      Pi.init({ appId: APP_ID, version: "2.0", sandbox: USE_SANDBOX });
    }
    return true;
  } catch (e) {
    console.error("Pi.init failed:", e);
    return false;
  }
}

async function piAuthUsernameOnly() {
  const Pi = getPi();
  if (!Pi) throw new Error("Pi SDK not found (are you in Pi Browser?)");
  await piInitIfNeeded(Pi);
  const scopes = ["username"];
  // onIncompletePaymentFound is required; we won’t use payments yet
  const onIncompletePaymentFound = () => ({});
  const res = await Pi.authenticate(scopes, onIncompletePaymentFound);
  const username = res?.user?.username;
  if (!username) throw new Error("Pi auth returned no username");
  return { username };
}

function setCachedUser(u) {
  try {
    window.__PI_USER = u || null;
    if (u) localStorage.setItem("__PI_USER", JSON.stringify(u));
    else localStorage.removeItem("__PI_USER");
  } catch {}
}

function getCachedUser() {
  try {
    if (window.__PI_USER?.username) return window.__PI_USER;
    const raw = localStorage.getItem("__PI_USER");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.username ? parsed : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [username, setUsername] = useState(null);
  const [leagueId, setLeagueId] = useState(null);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(true);

  // Pull from cache immediately
  useEffect(() => {
    const cached = getCachedUser();
    if (cached?.username) {
      setUsername(cached.username);
      setLoading(false);
      return;
    }
    setLoading(false);
  }, []);

  // Optional: dev query param override (?devUser=alice)
  useEffect(() => {
    if (username) return;
    try {
      const u = new URL(window.location.href);
      const devUser = u.searchParams.get("devUser");
      if (devUser) {
        setUsername(devUser);
        setCachedUser({ username: devUser, dev: true });
      }
    } catch {}
  }, [username]);

  // Try automatic Pi login once if in Pi Browser
  useEffect(() => {
    (async () => {
      if (username) return;        // already have a user
      if (loading) return;         // still booting cache
      setAuthError("");
      const Pi = getPi();
      if (!Pi) return;             // not in Pi Browser; user can use dev login
      try {
        setLoading(true);
        const u = await piAuthUsernameOnly();
        setUsername(u.username);
        setCachedUser(u);
        setLoading(false);
      } catch (e) {
        console.error(e);
        setAuthError(String(e?.message || e));
        setLoading(false);
      }
    })();
  }, [username, loading]);

  const hasPi = !!getPi();
  const diag = useMemo(() => {
    const Pi = getPi();
    const d = {
      href: typeof window !== "undefined" ? window.location.href : null,
      hasPi,
      initialized: Pi?.initialized ?? null,
      sandboxFlag: USE_SANDBOX,
      appId: APP_ID,
      cachedUser: getCachedUser(),
      username,
      authError,
    };
    return d;
  }, [hasPi, username, authError]);

  async function handlePiLogin() {
    setAuthError("");
    try {
      setLoading(true);
      const u = await piAuthUsernameOnly();
      setUsername(u.username);
      setCachedUser(u);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setAuthError(String(e?.message || e));
      setLoading(false);
    }
  }

  function handleDevLogin() {
    const v = prompt("Enter a dev username (only for testing):", "devuser");
    if (!v) return;
    setUsername(v);
    setCachedUser({ username: v, dev: true });
  }

  function handleClearCache() {
    setUsername(null);
    setCachedUser(null);
    // reload to clear any state
    if (typeof window !== "undefined") window.location.reload();
  }

  // Auth gate
  if (!username) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Loading Pi user…</h2>
        <div style={{ color: "#666", marginBottom: 10 }}>
          If this never finishes, open in <b>Pi Browser</b> and log in.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button onClick={handlePiLogin} disabled={loading}>
            {loading ? "Authenticating…" : "Login with Pi (username only)"}
          </button>
          <button onClick={handleDevLogin} disabled={loading}>Dev Login (mock)</button>
          <button onClick={handleClearCache} disabled={loading}>Clear Cached User</button>
        </div>
        {authError && (
          <div style={{ background: "#f8d7da", color: "#721c24", padding: 8, borderRadius: 6 }}>
            Auth error: {authError}
          </div>
        )}
        <pre
          style={{
            marginTop: 12,
            padding: 8,
            background: "#f7f7f7",
            border: "1px dashed #ddd",
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
{JSON.stringify(diag, null, 2)}
        </pre>
      </div>
    );
  }

  // Main app
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
      <div style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        Logged in as: <b>{username}</b>{" "}
        {getCachedUser()?.dev ? <i>(dev mock)</i> : null}
        {" · "}
        <button onClick={handleClearCache} style={{ fontSize: 12 }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
