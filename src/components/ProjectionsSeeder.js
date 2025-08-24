/* eslint-disable no-console */
import React, { useState } from "react";

export default function ProjectionsSeeder({ leagueId }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function seedFromSleeper(globalOnly = false) {
    try {
      setBusy(true);
      setMsg("Seeding from Sleeper…");
      const url = globalOnly
        ? `/api/players/sync`
        : `/api/players/sync?leagueId=${encodeURIComponent(leagueId)}`;
      const resp = await fetch(url);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      setMsg(`Imported ${json.count} players into ${json.scope}.`);
    } catch (e) {
      console.error(e);
      alert(String(e?.message || e));
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <h4 style={{ margin: "0 0 8px" }}>Roster Data / Projections</h4>
      <p style={{ marginTop: 0 }}>
        Import the full NFL player pool directly from Sleeper (no API key).  
        This also seeds simple baseline weekly projections so the UI shows non-zero values.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={() => seedFromSleeper(true)}>
          Seed Global Players (Sleeper)
        </button>
        <button disabled={busy} onClick={() => seedFromSleeper(false)}>
          Seed This League&apos;s Players (Sleeper)
        </button>
      </div>
      {msg && <div style={{ marginTop: 8, color: "#0a0" }}>{msg}</div>}
    </div>
  );
}
