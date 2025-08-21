import React, { useEffect, useState } from "react";

export default function PlayerNews({ name, onClose }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/news/player?name=${encodeURIComponent(name)}`);
      const j = await r.json();
      setItems(j.items || []);
    })();
  }, [name]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }}>
      <div style={{ maxWidth: 700, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>News: {name}</h3>
          <button onClick={onClose} style={{ padding: 6 }}>✕</button>
        </div>
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {items.map((it, i) => (
            <li key={i} style={{ marginBottom: 8 }}>
              <a href={it.url} target="_blank" rel="noreferrer">{it.title}</a>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{it.publishedAt}</div>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p>No recent headlines found.</p>}
      </div>
    </div>
  );
}
