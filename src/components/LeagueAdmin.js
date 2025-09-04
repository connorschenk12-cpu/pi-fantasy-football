/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useMemo, useState } from "react";

export default function LeagueAdmin() {
  const thisSeason = useMemo(() => new Date().getFullYear(), []);
  const [saving, setSaving] = useState(false);
  const [week, setWeek] = useState(1);
  const [season, setSeason] = useState(thisSeason);
  const [overwrite, setOverwrite] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function runTask(task, params = {}) {
    try {
      setSaving(true);
      setLastResult(null);

      const qs = new URLSearchParams({
        task,
        ...Object.fromEntries(
          Object.entries(params).filter(
            ([, v]) => v !== undefined && v !== null && v !== ""
          )
        ),
      });

      // If you require a cron secret header in prod, you can read from window.ENV_CRON_SECRET
      // or remove this header completely if not needed.
      const res = await fetch(`/api/cron?${qs.toString()}`, {
        headers: {
          // "x-cron-secret": window?.ENV_CRON_SECRET || "", // <- uncomment if you need it
        },
      });

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        const payload = json || {};
        setLastResult({ ok: false, status: res.status, payload });
        alert(
          `Task "${task}" failed (status ${res.status})\n` +
            JSON.stringify(payload, null, 2)
        );
        return;
      }

      setLastResult({ ok: true, status: res.status, payload: json });
      alert(
        `Task "${task}" complete!\n` + JSON.stringify(json, null, 2)
      );
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

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <label>
          Week{" "}
          <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {Array.from({ length: 18 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                W{i + 1}
              </option>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Overwrite existing projections
        </label>
      </div>

      {/* PRIMARY one-click workflow */}
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Data Maintenance</h3>
        <p style={{ marginTop: 0, color: "#666" }}>
          Runs <strong>refresh players (ESPN)</strong> →{" "}
          <strong>backfill headshots</strong> → <strong>dedupe</strong>.
        </p>
        <div className="btnrow">
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => runTask("full-refresh", { loop: 1 })}
          >
            {saving ? "Refreshing…" : "Full Refresh (ESPN)"}
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("prune", { loop: 1 })}
          >
            Prune Players (Keep Fantasy-Relevant Only)
          </button>
        </div>
      </div>

      {/* Optional advanced actions */}
      <details className="card" style={{ padding: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Advanced tasks
        </summary>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("refresh", { loop: 1 })}
          >
            Refresh Players Only
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("headshots", { loop: 1 })}
          >
            Backfill Headshots Only
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("dedupe", { loop: 1 })}
          >
            Dedupe Players Only
          </button>

          {/* Baseline projections (kept) */}
          <button
            className="btn"
            disabled={saving}
            onClick={() =>
              runTask("projections", {
                week,
                season,
                loop: 1,
                overwrite: overwrite ? 1 : 0,
              })
            }
          >
            Seed Projections (Baseline) W{week}, {season}
          </button>

          {/* NEW: Props-based projections */}
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() =>
              runTask("projections", {
                source: "props",
                week,
                season,
                loop: 1,
                overwrite: overwrite ? 1 : 0,
              })
            }
          >
            Seed Projections (Props) W{week}, {season}
          </button>

          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("matchups", { week, season, loop: 1 })}
          >
            Seed Matchups (W{week}, {season})
          </button>
          <button
            className="btn"
            disabled={saving}
            onClick={() => runTask("settle", { loop: 1 })}
          >
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
