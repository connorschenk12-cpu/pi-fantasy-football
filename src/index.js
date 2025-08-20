import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// --- Initialize the Pi SDK ---
(function initPi() {
  if (typeof window !== "undefined" && window.Pi) {
    try {
      const APP_ID = "fantasy-football-f6a0c6cf6115e138"; // 👈 Your slug from portal

      window.Pi.init({
        version: "2.0",
        appId: APP_ID,
      });

      console.log("✅ Pi SDK initialized with appId:", APP_ID);
    } catch (e) {
      console.error("❌ Pi SDK init error:", e);
    }
  } else {
    console.warn("⚠️ Pi SDK not found (must open in Pi Browser).");
  }
})();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
