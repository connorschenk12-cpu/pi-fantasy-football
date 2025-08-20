import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// --- Initialize the Pi SDK as early as possible ---
(function initPi() {
  // Only run if the SDK is present (Pi Browser)
  if (typeof window !== "undefined" && window.Pi) {
    try {
      // ⬇️ REPLACE THIS with your real App ID from the Pi Developer Portal
      // Portal → Your App → General Settings → "App ID"
      const APP_ID = "<REPLACE_WITH_YOUR_APP_ID>";

      window.Pi.init({
        version: "2.0",
        appId: fantasy-football-f6a0c6cf6115e138,   // <- critical for auth to succeed
      });

      console.log("✅ Pi SDK initialized with appId:", APP_ID);
    } catch (e) {
      console.error("❌ Pi SDK init error:", e);
    }
  } else {
    console.warn("⚠️ Pi SDK not found (open in Pi Browser).");
  }
})();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
