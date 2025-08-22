/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  configureDraft,
  startDraft,
  endDraft,
  setDraftStatus,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // local editor for draft order (one username per line)
  const [orderText, setOrderText] = useState("");

  // Load league safely
  useEffect(() => {
    setError("");
    setLeague(null);
    if (!leagueId) return;
    try {
      const unsub = listenLeague(leagueId, (l) => {
        setLeague(l);
        if (l?.draft?.order && Array.isArray(l.draft.order)) {
          setOrderText(l.draft.order.join("\n"));
        }
      });
      return () => unsub && unsub();
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    }
  }, [leagueId]);

  // owner check (case-insensitive)
  const isOwner = useMemo(() => {
    const a = (league?.owner || "").trim().toLowerCase();
    const b = (username || "").trim().toLowerCase();
    return !!a && !!b && a === b;
  }, [league?.owner, username]);

  const draft = league?.draft || {};
  const status = String(draft.status || "scheduled");
  const orderArray = Array.isArray(draft.order) ? draft.order : [];
  const roundsTotal = Number(draft.roundsTotal || 12);
  const pointer = Number.isFinite(draft.pointer) ? draft.pointer : 0;

  // Helpers
  function cleanOrder(text) {
    return String(text || "")
      .split(/\r?\n/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function onSaveOrder() {
    if (!leagueId) return setError("No leagueId");
    const arr = cleanOrder(orderText);
    if (!arr.length) return setError("Enter at least one username for the order.");
    try {
      setSaving(true);
      await configureDraft({ leagueId, order: arr });
      setSaving(false);
      alert("Draft order saved & draft set to scheduled.");
    } catch (e) {
      console.error(e);
      setSaving(false);
      setError(String(e?.message || e));
    }
  }

  async function onStart() {
    if (!leagueId) return setError("No leagueId");
    try {
      setSaving(true);
      await startDraft({ leagueId });
      setSaving(false);
      alert("Draft started.");
    } catch (e) {
      console.error(e);
      setSaving(false);
      setError(String(e?.message || e));
    }
  }

  async function onEnd() {
    if (!leagueId) return setError("No leagueId");
    try {
      setSaving(true);
      await endDraft({ leagueId });
      setSaving(false);
      alert("Draft ended.");
    } catch (e) {
      console.error(e);
      setSaving(false);
      setError(String(e?.message || e));
    }
  }

  async function onSetStatus(next) {
    if (!leagueId) return setError("No leagueId");
    try {
      setSaving(true);
      await setDraftStatus({ leagueId, status: next });
      setSaving(false);
      alert(`Draft status set to ${next}.`);
    } catch (e) {
      console.error(e);
      setSaving(false);
      setError(String(e?.message || e));
    }
  }

  // Render guards
  if (!leagueId) {
    return <Box>
      <h3>Admin</h3>
      <Alert type="error">No league loaded. (Missing <code>leagueId</code> prop)</Alert>
    </Box>;
  }

  if (!league) {
    return <Box>
      <h3>Admin</h3>
      <div>Loading league…</div>
    </Box>;
  }

  return (
    <Box>
      <h3 style={{ marginTop: 0 }}>Admin</h3>

      {!isOwner && (
        <Alert type="warn">
          You’re not the league owner (<b>{league?.owner || "?"}</b>). Actions are disabled.
        </Alert>
      )}

      {error && <Alert type="error">Error: {error}</Alert>}

      {/* Draft status & pointer */}
      <Section title="Draft Status">
        <Row><b>Status:</b> <code>{status}</code></Row>
        <Row><b>Pointer (index):</b> <code>{pointer}</code></Row>
        <Row><b>Rounds total:</b> <code>{roundsTotal}</code></Row>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button disabled={!isOwner || saving} onClick={() => onSetStatus("scheduled")}>
            Set Scheduled
          </button>
          <button disabled={!isOwner || saving} onClick={onStart}>
            Start Draft (live)
          </button>
          <button disabled={!isOwner || saving} onClick={onEnd}>
            End Draft (done)
          </button>
        </div>
      </Section>

      {/* Draft order editor */}
      <Section title="Draft Order (one username per line)">
        <textarea
          value={orderText}
          onChange={(e) => setOrderText(e.target.value)}
          placeholder="alice\nbob\ncharlie"
          rows={Math.max(4, Math.min(12, orderArray.length || 6))}
          style={{ width: "100%", fontFamily: "monospace", padding: 8 }}
        />
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={!isOwner || saving} onClick={onSaveOrder}>
            Save Order & Schedule
          </button>
          <button
            type="button"
            onClick={() => setOrderText(orderArray.join("\n"))}
            disabled={saving}
          >
            Reset to current
          </button>
        </div>
        {!!orderArray.length && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            Current order: {orderArray.join(" → ")}
          </div>
        )}
      </Section>
    </Box>
  );
}

/** ---------- Tiny UI helpers (no external deps) ---------- */
function Box({ children }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }) {
  return <div style={{ margin: "4px 0" }}>{children}</div>;
}

function Alert({ type = "info", children }) {
  const colors = {
    info: "#155724",
    warn: "#856404",
    error: "#721c24",
  };
  const bgs = {
    info: "#d4edda",
    warn: "#fff3cd",
    error: "#f8d7da",
  };
  return (
    <div
      style={{
        background: bgs[type] || "#eef5ff",
        color: colors[type] || "#0c5460",
        border: "1px solid rgba(0,0,0,0.08)",
        padding: "8px 10px",
        borderRadius: 6,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}
