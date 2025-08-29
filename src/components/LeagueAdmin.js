/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useMemo, useState } from "react";

export default function LeagueAdmin() {
  const thisSeason = useMemo(() => new Date().getFullYear(), []);
  const [saving, setSaving] = useState(false);
  const [week, setWeek] = useState(1);
  const [season, setSeason] = useState(thisSeason);
  const [lastResult, setLastResult] = useState(null);

  async function runTask(task, params = {}) {
    try {
      setSaving(true);
      setLastResult(null);

      const qs = new URLSearchParams({ task, ...Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
      ) });

      const res = await fetch(`/api/cron?${qs.toString()}`);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }

      if (!res.ok) {
        const payload = json || {};
        const msg = payload.error || payload.message || `HTTP ${res.status}`;
        setLastResult({ ok: false, status: res.status, payload });
        alert(`Refresh failed (status ${res.status})\n${JSON.stringify(payload, null, 2)}`);
        return;
      }

      setLastResult({ ok: true, status: res.status, payload: json });
      alert(`Refresh complete!\n${JSON.stringify(json, null, 2)}`);
    } catch (e) {
      console.error(e);
      setLastResult({ ok: false, error: String(e?.message || e) });
      alert(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>League Admin</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <label>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>W{i + 1}</option>
            ))}
          </select>
        </label>
        <label>
          Season{" "}
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            style={{ width: 96 }}
          />
        </label>
      </div>

      {/* PRIMARY one-click workflow */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Data Maintenance</h3>
        <p style={{ marginTop: 0, color: "#666" }}>
          Runs <strong>refresh players (ESPN)</strong> → <strong>backfill headshots</strong> → <strong>dedupe</strong>.
        </p>
        <button
          className="btn btn-primary"
          disabled={saving}
          onClick={() => runTask("full-refresh")}
        >
          {saving ? "Refreshing…" : "Full Refresh (ESPN)"}
        </button>
      </div>

      {/* Optional advanced actions */}
      <details className="card" style={{ padding: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced tasks</summary>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="btn" disabled={saving} onClick={() => runTask("refresh")}>
            Refresh Players Only
          </button>
          <button className="btn" disabled={saving} onClick={() => runTask("headshots")}>
            Backfill Headshots Only
          </button>
          <button className="btn" disabled={saving} onClick={() => runTask("dedupe")}>
            Dedupe Players Only
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("projections", { week, season })}
          >
            Seed Projections (W{week}, {season})
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("matchups", { week, season })}
          >
            Seed Matchups (W{week}, {season})
          </button>
          <button className="btn" disabled={saving} onClick={() => runTask("settle")}>
            Settle Season (Winners → Payouts)
          </button>
        </div>
      </details>

      {/* Last result panel */}
      <div style={{ marginTop: 16, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
        <h4 style={{ margin: "12px 0 6px" }}>Last result</h4>
        <div
          style={{
            padding: 10,
            background: "#f7f7f7",
            border: "1px solid #eee",
            borderRadius: 6,
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          {lastResult ? JSON.stringify(lastResult, null, 2) : "(none yet)"}
        </div>
      </div>
    </div>
  );
}
