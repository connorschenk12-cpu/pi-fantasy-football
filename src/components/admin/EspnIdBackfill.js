/* eslint-disable no-console */
// src/components/admin/EspnIdBackfill.js
import React, { useState } from "react";
import { bulkSetEspnIds } from "../../lib/storage";

export default function EspnIdBackfill({ leagueId = null }) {
  const [jsonText, setJsonText] = useState("{\n  \"player-id-1\": 15880,\n  \"player-id-2\": 14876\n}");
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState(null);

  async function handleUploadFile(file) {
    try {
      const text = await file.text();
      setJsonText(text);
    } catch (e) {
      alert("Could not read file: " + (e?.message || e));
    }
  }

  async function handleApply() {
    let mapping;
    try {
      mapping = JSON.parse(jsonText);
      if (typeof mapping !== "object" || Array.isArray(mapping)) {
        throw new Error("Expected a plain object mapping of { playerId: espnId }");
      }
    } catch (e) {
      alert("Invalid JSON: " + (e?.message || e));
      return;
    }

    setUpdating(true);
    setResult(null);
    try {
      const res = await bulkSetEspnIds({ leagueId, mapping });
      setResult(res);
      alert(`Mapped ESPN IDs for ${res.updated} players.`);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">ESPN ID Backfill</div>
      <div className="muted" style={{ marginBottom: 8 }}>
        Paste JSON mapping of your internal player IDs → ESPN IDs. Example:
      </div>
      <pre className="code" style={{ margin: 0, padding: 8, overflow: "auto" }}>
{`{
  "patrick-mahomes": 3139477,
  "justin-jefferson": 4241389
}`}
      </pre>

      <div className="muted" style={{ margin: "8px 0" }}>
        Scope: <b>{leagueId ? `League ${leagueId}` : "Global players collection"}</b>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])}
        />
        <button className="btn btn-ghost" onClick={() => setJsonText("{\n\n}")}>Clear</button>
        <button className="btn btn-primary" disabled={updating} onClick={handleApply}>
          {updating ? "Updating…" : "Apply Mapping"}
        </button>
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        rows={10}
        style={{ width: "100%", marginTop: 8, fontFamily: "monospace" }}
      />

      {result && (
        <div className="muted" style={{ marginTop: 8 }}>
          Updated: <b>{result.updated}</b>
        </div>
      )}
    </div>
  );
}
