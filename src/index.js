/* eslint-disable no-console */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

function safeRender() {
  try {
    const rootEl = document.getElementById("root");
    if (!rootEl) throw new Error('#root not found in index.html');
    const root = createRoot(rootEl);
    root.render(<App />);
  } catch (e) {
    const fatal = document.getElementById("fatal");
    if (fatal) {
      fatal.style.display = "block";
      fatal.textContent = "Bootstrap error: " + (e && e.message ? e.message : e);
    }
    console.error("Bootstrap error:", e);
  }
}

safeRender();
