import React, { useState } from "react";

const TIMEOUT_MS = 15000;

export default function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");
  const [diag, setDiag] = useState({});

  function logDiag(extra = {}) {
    const info = {
      href: typeof window !== "undefined" ? window.location.href : "(no window)",
      hasPi: !!(typeof window !== "undefined" && window.Pi),
      piKeys:
        typeof window !== "undefined" && window.Pi
          ? Object.keys(window.Pi)
          : [],
      ...extra,
    };
    setDiag(info);
    console.log("🔎 DIAG:", info);
  }

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function piReady() {
    if (!window.Pi) throw new Error("Pi SDK not found (open in Pi Browser).");
    // If the SDK exposes a readiness check, use it
    try {
      if (typeof window.Pi.checkInitialized === "function") {
        await window.Pi.checkInitialized();
      }
    } catch (e) {
      // Not fatal—Pi.init ran in index.js. Continue.
      console.warn("Pi.checkInitialized warning:", e);
    }
    // Optional: helpful host info in diagnostics
    if (typeof window.Pi.getPiHostAppInfo === "function") {
      try {
        const info = await window.Pi.getPiHostAppInfo();
        logDiag({ hostInfo: info });
      } catch {}
    }
  }

  async function ensureConsent(scopes) {
    // Some SDK builds allow checking consented scopes
    try {
      const consented = window.Pi.consentedScopes || [];
      const missing = scopes.filter((s) => !consented.includes(s));
      if (missing.length && typeof window.Pi.requestPermission === "function") {
        await window.Pi.requestPermission(missing);
      }
    } catch (e) {
      // Not fatal—authenticate should still prompt.
      console.warn("requestPermission warning:", e);
    }
  }

  async function login(scopes) {
    setStatus(`⏳ Authenticating (${scopes.join(", ")})...`);
    logDiag({ phase: "before-auth", scopes });

    try {
      await piReady();
      await ensureConsent(scopes);

      // Watchdog to avoid infinite hang
      const watchdog = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Auth timed out")), TIMEOUT_MS)
      );

      const authPromise = window.Pi.authenticate(
        scopes,
        onIncompletePaymentFound
      );

      const result = await Promise.race([authPromise, watchdog]);

      const u = result?.user || result;
      if (!u?.username) throw new Error("No username returned from SDK");

      setUser(u);
      setStatus("✅ Logged in!");
      logDiag({ phase: "after-auth", success: true, scopes, user: u });
    } catch (err) {
      console.error("❌ Authentication error:", err);
      setStatus("❌ Authentication failed or timed out. See diagnostics below.");
      logDiag({ phase: "auth-error", error: String(err), scopes });
    }
  }

  const hardRefresh = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("t", Date.now().toString());
    window.location.replace(url.toString());
  };

  return (
    <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => login(["username"])}
            style={{ padding: 10, fontSize: 16 }}
          >
            Login (username only)
          </button>
          <button
            onClick={() => login(["username", "payments"])}
            style={{ padding: 10, fontSize: 16 }}
          >
            Login (username + payments)
          </button>
          <button onClick={hardRefresh} style={{ padding: 10, fontSize: 16 }}>
            Hard refresh
          </button>
          <button onClick={() => logDiag()} style={{ padding: 10, fontSize: 16 }}>
            Show diagnostics
          </button>
        </div>
      )}

      {user && (
        <div style={{ marginTop: 16 }}>
          <p>
            <strong>Logged in as:</strong> {user.username}
          </p>
          <pre
            style={{
              textAlign: "left",
              background: "#f6f8fa",
              padding: 12,
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Diagnostics</h3>
      <pre
        style={{
          textAlign: "left",
          background: "#f6f8fa",
          padding: 12,
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(diag, null, 2)}
      </pre>
    </div>
  );
}
