import React, { useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Not logged in.");
  const [diag, setDiag] = useState({});

  function collectDiagnostics(extra = {}) {
    const info = {
      href: typeof window !== "undefined" ? window.location.href : "(no window)",
      hasPi: !!(typeof window !== "undefined" && window.Pi),
      piKeys: typeof window !== "undefined" && window.Pi ? Object.keys(window.Pi) : [],
      ...extra,
    };
    setDiag(info);
    console.log("🔎 DIAG:", info);
  }

  function onIncompletePaymentFound(payment) {
    console.log("⚠️ Incomplete payment found:", payment);
  }

  async function login(scopes) {
    if (!window.Pi) {
      setStatus("❌ Pi SDK not found. Open this in Pi Browser.");
      collectDiagnostics({ reason: "no SDK" });
      return;
    }

    setStatus(`⏳ Authenticating (${scopes.join(", ")})...`);

    // Watchdog: if Pi.authenticate never resolves, we fail in 12s
    let timeoutId;
    const watchdog = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Auth timed out")), 12000);
    });

    try {
      const authPromise = window.Pi.authenticate(scopes, onIncompletePaymentFound);
      const result = await Promise.race([authPromise, watchdog]);
      clearTimeout(timeoutId);

      // SDKs sometimes return { user } or just the user object:
      const u = result?.user || result;
      if (!u?.username) throw new Error("No username returned from SDK");

      setUser(u);
      setStatus("✅ Logged in!");
      collectDiagnostics({ success: true, scopes });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("❌ Auth failed/hung:", err);
      setStatus("❌ Authentication failed or timed out. See diagnostics below.");
      collectDiagnostics({ error: String(err), scopes });
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
      <h1>Pi Fantasy Football</h1>
      <p>{status}</p>

      {!user && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => login(["username"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username only)
          </button>
          <button onClick={() => login(["username", "payments"])} style={{ padding: 10, fontSize: 16 }}>
            Login (username + payments)
          </button>
          <button
            onClick={() => {
              // force refresh to bust stale cache/state
              window.location.href = window.location.href + (window.location.search ? "&" : "?") + "t=" + Date.now();
            }}
            style={{ padding: 10, fontSize: 16 }}
          >
            Hard refresh
          </button>
          <button onClick={() => collectDiagnostics()} style={{ padding: 10, fontSize: 16 }}>
            Show diagnostics
          </button>
        </div>
      )}

      {user && (
        <div style={{ marginTop: 16 }}>
          <p><strong>Logged in as:</strong> {user.username}</p>
          <pre style={{ textAlign: "left", background: "#f6f8fa", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {JSON.stringify(user, null, 2)}
          </pre>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Diagnostics</h3>
      <pre style={{ textAlign: "left", background: "#f6f8fa", padding: 12, borderRadius: 8, overflowX: "auto" }}>
        {JSON.stringify(diag, null, 2)}
      </pre>
    </div>
  );
}

export default App;
