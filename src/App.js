import React, { useState } from "react";

const TIMEOUT_MS = 15000;
const SLUG_APP_ID = "fantasy-football-f6a0c6cf6115e138"; // your slug

export default function App() {
  const [status, setStatus] = useState("Not initialized.");
  const [user, setUser] = useState(null);
  const [diag, setDiag] = useState({
    href: typeof window !== "undefined" ? window.location.href : "(no window)",
    hasPi: !!(typeof window !== "undefined" && window.Pi),
  });

  function log(extra = {}) {
    const info = {
      href: window.location.href,
      hasPi: !!window.Pi,
      initialized: !!(window.Pi && window.Pi.initialized),
      authenticated: !!(window.Pi && window.Pi.authenticated),
      ...extra,
    };
    setDiag(info);
    console.log("🔎 DIAG:", info);
  }

  async function showHostInfo() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open in Pi Browser.");
      log({ reason: "no SDK" });
      return;
    }
    try {
      const infoFn = window.Pi.getPiHostAppInfo || window.Pi.getPiHostAppName;
      const hostInfo = infoFn ? await infoFn() : "(no host info fn)";
      setStatus("ℹ️ Host info fetched.");
      log({ hostInfo });
    } catch (e) {
      setStatus("⚠️ Could not fetch host info.");
      log({ hostInfoError: String(e) });
    }
  }

  function initWithAppId() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found.");
      log({ reason: "no SDK" });
      return;
    }
    try {
      window.Pi.init({ version: "2.0", appId: SLUG_APP_ID });
      setStatus("✅ Initialized WITH appId.");
      log({ initMode: "with-appId", appId: SLUG_APP_ID, piKeys: Object.keys(window.Pi) });
    } catch (e) {
      setStatus("❌ Init (with appId) error.");
      log({ initError: String(e) });
    }
  }

  function initWithoutAppId() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found.");
      log({ reason: "no SDK" });
      return;
    }
    try {
      window.Pi.init({ version: "2.0" }); // no appId — let Pi Browser attach context
      setStatus("✅ Initialized WITHOUT appId.");
      log({ initMode: "without-appId", piKeys: Object.keys(window.Pi) });
    } catch (e) {
      setStatus("❌ Init (without appId) error.");
      log({ initError: String(e) });
    }
  }

  async function loginUsername() {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found.");
      log({ reason: "no SDK" });
      return;
    }
    setStatus("⏳ Authenticating (username)...");
    log({ phase: "before-auth", scopesTried: ["username"] });
    // watchdog to avoid silent hang
    const watchdog = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Auth timed out")), TIMEOUT_MS)
    );
    try {
      const authPromise = window.Pi.authenticate(["username"], (p) =>
        console.log("⚠️ Incomplete payment (ignored):", p)
      );
      const result = await Promise.race([authPromise, watchdog]);
      const u = result?.user || result;
      if (!u?.username) throw new Error("No username returned from SDK");
      setUser(u);
      setStatus("✅ Logged in (username).");
      log({ phase: "after-auth", success: true, user: u });
    } catch (e) {
      setStatus("❌ Authentication failed or timed out.");
      log({ phase: "auth-error", error: String(e) });
    }
  }

  function hardRefresh() {
    const url = new URL(window.location.href);
    url.searchParams.set("t", Date.now().toString());
    window.location.replace(url.toString());
  }

  return (
    <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={showHostInfo} style={{ padding: 10 }}>Show host info</button>
        <button onClick={initWithAppId} style={{ padding: 10 }}>Init WITH appId</button>
        <button onClick={initWithoutAppId} style={{ padding: 10 }}>Init WITHOUT appId</button>
        <button onClick={loginUsername} style={{ padding: 10 }}>Login (username)</button>
        <button onClick={hardRefresh} style={{ padding: 10 }}>Hard refresh</button>
      </div>

      {user && (
        <div style={{ marginTop: 12 }}>
          <p><strong>Logged in as:</strong> {user.username}</p>
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Diagnostics</h3>
      <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, overflowX: "auto" }}>
        {JSON.stringify(diag, null, 2)}
      </pre>
    </div>
  );
}
