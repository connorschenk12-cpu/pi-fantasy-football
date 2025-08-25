/* eslint-disable no-console */
import React, { useEffect, useState } from "react";

function safeStr(v) {
  return typeof v === "string" ? v : String(v ?? "");
}

export default function PlayerNews({ playerId }) {
  const [items, setItems] = useState([]);
  const pid = safeStr(playerId);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        if (!pid) {
          if (alive) setItems([]);
          return;
        }
        // Basic defensive fetch: no assumptions about URL shapes
        const res = await fetch(`/api/news/player?id=${encodeURIComponent(pid)}`);
        if (!res.ok) throw new Error(`News fetch ${res.status}`);
        const json = await res.json();
        const arr = Array.isArray(json?.items) ? json.items : [];
        if (alive) setItems(arr);
      } catch (e) {
        console.warn("PlayerNews error:", e);
        if (alive) setItems([]);
      }
    }

    run();
    return () => { alive = false; };
  }, [pid]);

  if (!pid) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <h4 style={{ margin: "8px 0" }}>News</h4>
      {items.length === 0 && (
        <div style={{ color: "#888" }}>No recent news.</div>
      )}
      <ul style={{ paddingLeft: 16 }}>
        {items.map((it, idx) => {
          const title = safeStr(it.title || it.headline || "Update");
          const url = safeStr(it.url || it.link || "");
          return (
            <li key={idx} style={{ marginBottom: 6 }}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">{title}</a>
              ) : (
                <span>{title}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
