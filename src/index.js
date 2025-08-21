import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// ---- Pi SDK init helper --------------------------------------------
const PI_APP_ID = "fantasy-football-f6a0c6cf6115e138"; // your Pi App slug
export async function initPi() {
  if (!window.Pi) return { ok: false, error: "Pi SDK not found" };
  try {
    // Sandbox: keep true while testing in Pi Sandbox wrapper
    window.Pi.init({ version: "2.0", appId: PI_APP_ID, sandbox: true });
    return { ok: true };
  } catch (e) {
    // Fallback: init without appId (still works in sandbox)
    try {
      window.Pi.init({ version: "2.0", sandbox: true });
      return { ok: true, note: "Initialized without appId" };
    } catch (err) {
      return { ok: false, error: err?.message || "Pi.init failed" };
    }
  }
}

export async function piLogin(scopes = ["username"]) {
  if (!window.Pi) throw new Error("Pi SDK not loaded");
  const auth = await window.Pi.authenticate(scopes);
  // Returns { user: { username }, accessToken: string, ... }
  return auth;
}
// --------------------------------------------------------------------

const container = document.getElementById("root");
createRoot(container).render(<App />);
