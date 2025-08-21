// src/components/LeagueAdmin.js
import React, { useState } from "react";

export default function LeagueAdmin({ isOwner }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!isOwner) return null;

  async function syncPlayers() {
    try {
      setBusy(true);
      setMsg("Syncing players from Sleeper…");
      const r = await fetch("/api/players/sync", { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Sync failed");
      setMsg(`Imported/updated ${j.imported} players ✅`);
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8, padding: 8, border: "1px dashed #ddd", borderRadius: 8 }}>
      <b>Admin tools</b>
      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={syncPlayers} disabled={busy} style={{ padding: 8 }}>
          {busy ? "Syncing…" : "Sync Global Players"}
        </button>
      </div>
      {msg && <div style={{ marginTop: 6, fontSize: 13 }}>{msg}</div>}
    </div>
  );
}
