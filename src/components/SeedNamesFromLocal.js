// src/components/SeedNamesFromLocal.js
/* eslint-disable no-console */
import React, { useState } from "react";
import { bulkUpsertPlayerNames, ensurePlayerNameFields } from "../lib/storage";

// IMPORTANT: This imports your local player list.
// Expecting data/players.js to export an array like:
//   export default [{ id: "123", name: "Patrick Mahomes", position:"QB", team:"KC" }, ...]
import LOCAL_PLAYERS from "../../data/players";

export default function SeedNamesFromLocal({ leagueId }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const runLocalSeed = async () => {
    try {
      setBusy(true);
      setMsg("Writing names from data/players.js …");
      const res = await bulkUpsertPlayerNames({
        leagueId,
        playersArray: Array.isArray(LOCAL_PLAYERS) ? LOCAL_PLAYERS : [],
      });
      setMsg(`Updated ${res.updated} player docs with 'name'.`);
    } catch (e) {
      console.error(e);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const runInfer = async () => {
    try {
      setBusy(true);
      setMsg("Inferring names from existing fields …");
      const res = await ensurePlayerNameFields({ leagueId });
      setMsg(`Inferred & set ${res.updated} missing names.`);
    } catch (e) {
      console.error(e);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: "1px dashed #ddd", padding: 10, borderRadius: 8 }}>
      <h4 style={{ margin: 0 }}>Player Name Fix</h4>
      <p style={{ marginTop: 6, color: "#666" }}>
        If players show as numbers, they’re missing a <code>name</code> field. Use one of these:
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={runLocalSeed} disabled={busy}>Seed from <code>data/players.js</code></button>
        <button onClick={runInfer} disabled={busy}>Infer from existing fields</button>
      </div>
      {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
