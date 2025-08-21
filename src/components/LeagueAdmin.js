// src/components/LeagueAdmin.js
import React, { useState } from "react";
import { setEntryFee } from "../lib/storage";

export default function LeagueAdmin({ isOwner, league }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [fee, setFee] = useState(Number(league?.entry?.feePi || 0));
  const [enabled, setEnabled] = useState(!!league?.entry?.enabled);

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

  async function saveEntry() {
    try {
      setBusy(true);
      await setEntryFee(league.id, enabled, fee);
      setMsg("Entry settings saved");
    } catch (e) {
      setMsg(e.message || "Failed to save");
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

      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          <input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} /> Entry fee enabled
        </label>
        <input type="number" value={fee} onChange={(e)=>setFee(e.target.value)} style={{ width: 100, padding: 6 }} />
        <button onClick={saveEntry} disabled={busy} style={{ padding: 8 }}>Save Entry</button>
      </div>

      {msg && <div style={{ marginTop: 6, fontSize: 13 }}>{msg}</div>}
    </div>
  );
}
