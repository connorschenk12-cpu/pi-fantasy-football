import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

(function initPi() {
  if (typeof window !== "undefined" && window.Pi) {
    try {
      const APP_ID = "fantasy-football-f6a0c6cf6115e138"; // your slug
      window.Pi.init({
        version: "2.0",
        appId: APP_ID,
        sandbox: true, // <<< important while developing/testing
      });
      console.log("✅ Pi SDK initialized (sandbox) with appId:", APP_ID);
    } catch (e) {
      console.error("❌ Pi SDK init error:", e);
    }
  } else {
    console.warn("⚠️ Pi SDK not found. Open in Pi Browser.");
  }
})();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
