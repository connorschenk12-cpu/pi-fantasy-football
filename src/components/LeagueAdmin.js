/* eslint-disable no-alert, no-console */
import React, { useEffect, useMemo, useState } from "react";

import {
  // league
  listenLeague,
  listMemberUsernames,

  // draft
  configureDraft,
  initDraftOrder,
  startDraft,
  endDraft,

  // schedule
  ensureSeasonSchedule,

  // optional admin utilities
  addBotsToLeague,
  repairTeamPlayerIds,
  simulateFullDraft,
} from "../lib/storage";

/**
 * LeagueAdmin
 * Props:
 *   - leagueId: string
 *   - username: string (current user)
 */
export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [orderText, setOrderText] = useState(""); // CSV order editor
  const [weeks, setWeeks] = useState(14);
  const [recreateSchedule, setRecreateSchedule] = useState(false);
  const [busy, setBusy] = useState(false);

  // ---- fetch league
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  // ---- fetch members (once)
  useEffect(() => {
    (async () => {
      try {
        if (!leagueId) return;
        const m = await listMemberUsernames(leagueId);
        setMembers(m);
      } catch (e) {
        console.error("listMemberUsernames error:", e);
      }
    })();
  }, [leagueId]);

  // ---- seed order text from league (and update when league changes)
  useEffect(() => {
    const arr = Array.isArray(league?.draft?.order) ? league.draft.order : [];
    setOrderText(arr.join(", "));
  }, [league?.draft?.order]);

  const isOwner = useMemo(() => {
    return league?.owner && username ? league.owner === username : false;
  }, [league?.owner, username]);

  const draftStatus = league?.draft?.status || "scheduled";
  const canStartDraft = isOwner && draftStatus === "scheduled" && (members?.length || 0) >= 2;
  const canEndDraft = isOwner && draftStatus === "live";

  if (!leagueId) {
    return (
      <div style={{ padding: 12, color: "#a00" }}>
        <b>No league loaded.</b> (Missing leagueId prop)
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div style={{ padding: 12 }}>
        <h3>Admin</h3>
        <div style={{ color: "#666" }}>
          You must be the league owner to see admin controls.
        </div>
      </div>
    );
  }

  const currentOrder = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const membersOnly = (members || []).join(", ");

  // -------- handlers
  const handleConfigureOrder = async () => {
    try {
      setBusy(true);
      const parsed = orderText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parsed.length) throw new Error("Provide a comma-separated list of usernames.");
      await configureDraft({ leagueId, order: parsed });
      alert("Draft order saved.");
    } catch (e) {
      alert(`Configure draft error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleInitOrder = async () => {
    try {
      setBusy(true);
      const order = await initDraftOrder({ leagueId });
      setOrderText(order.join(", "));
      alert(`Draft order initialized from members:\n${order.join(", ")}`);
    } catch (e) {
      alert(`Init order error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleEnsureSchedule = async () => {
    try {
      setBusy(true);
      const { weeksCreated } = await ensureSeasonSchedule({
        leagueId,
        totalWeeks: Number(weeks || 14),
        recreate: !!recreateSchedule,
      });
      if (!weeksCreated?.length) {
        alert("Schedule already exists (no changes).");
      } else {
        alert(`Schedule written for weeks: ${weeksCreated.join(", ")}`);
      }
    } catch (e) {
      alert(`Ensure schedule error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStartDraft = async () => {
    try {
      setBusy(true);
      // sanity checks:
      if (!currentOrder.length) {
        throw new Error("Set draft order first.");
      }
      if ((members?.length || 0) < 2) {
        throw new Error("Need at least two members in the league.");
      }
      await startDraft({ leagueId });
      alert("Draft started!");
    } catch (e) {
      alert(`Start draft error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleEndDraft = async () => {
    try {
      setBusy(true);
      await endDraft({ leagueId });
      alert("Draft ended.");
    } catch (e) {
      alert(`End draft error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  // Optional admin utilities (bots, repair, simulate)
  const handleAddBots = async (howMany = 3) => {
    try {
      setBusy(true);
      const res = await addBotsToLeague({ leagueId, howMany });
      alert(`Bots added: ${res?.added?.length || 0}`);
    } catch (e) {
      alert(`Add bots error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  const handleRepairIds = async () => {
    try {
      setBusy(true);
      const res = await repairTeamPlayerIds({ leagueId });
      alert(
        `Repair run.\nTeams touched: ${res?.touchedTeams || 0}\nRepairs made: ${res?.repairs || 0}`
      );
    } catch (e) {
      alert(`Repair error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  const handleSimDraft = async () => {
    try {
      setBusy(true);
      const res = await simulateFullDraft({ leagueId, currentWeek: 1 });
      alert(`Simulated draft. Picks: ${res?.picksTaken || "n/a"}`);
    } catch (e) {
      alert(`Simulate error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 12, opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
      <h2>League Admin</h2>
      <div style={{ color: "#666", marginBottom: 6 }}>
        <div><b>League:</b> {league?.name || leagueId}</div>
        <div><b>Owner:</b> {league?.owner}</div>
        <div><b>Draft status:</b> {draftStatus}</div>
        <div><b>Members:</b> {membersOnly || "(none)"}</div>
      </div>

      {/* Draft Setup */}
      {draftStatus !== "done" && (
        <section style={sectionStyle}>
          <h3>Draft Setup</h3>
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Draft order (CSV):</label>
            <textarea
              rows={3}
              style={taStyle}
              value={orderText}
              onChange={(e) => setOrderText(e.target.value)}
              placeholder="user1, user2, user3"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={handleConfigureOrder}>Save Order</button>
              <button onClick={handleInitOrder}>Init From Members</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>Season weeks:</label>{" "}
                <input
                  type="number"
                  min={1}
                  max={18}
                  value={weeks}
                  onChange={(e) => setWeeks(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={recreateSchedule}
                  onChange={(e) => setRecreateSchedule(e.target.checked)}
                />
                Recreate schedule if already exists
              </label>
              <button onClick={handleEnsureSchedule}>Ensure Season Schedule</button>
            </div>
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!canStartDraft} onClick={handleStartDraft}>
              Start Draft
            </button>
            <button disabled={!canEndDraft} onClick={handleEndDraft}>
              End Draft
            </button>
          </div>
        </section>
      )}

      {/* Admin Utilities (optional) */}
      <section style={sectionStyle}>
        <h3>Admin Utilities</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => handleAddBots(3)}>Add 3 Bots</button>
          <button onClick={handleRepairIds}>Repair Player IDs</button>
          <button onClick={handleSimDraft}>Simulate Full Draft</button>
        </div>
        <p style={{ color: "#666", marginTop: 8 }}>
          These are one-off helpers for testing and fixing common issues.
        </p>
      </section>

      {/* Read-only Entry Fee status (editable amount/toggle typically lives in MyTeam or a dedicated Payments panel) */}
      <section style={sectionStyle}>
        <h3>Entry Fee</h3>
        <div>
          <b>Enabled:</b> {league?.entry?.enabled ? "Yes" : "No"}{" "}
          &nbsp;&nbsp; <b>Amount:</b> {Number(league?.entry?.amount || 0)}&nbsp;Pi
        </div>
        <div style={{ color: "#666", marginTop: 6 }}>
          Note: Payments are usually taken in the My Team tab per user (and draft is blocked until
          all members have paid unless the league is free).
        </div>
      </section>
    </div>
  );
}

/* ---------- small styles ---------- */
const sectionStyle = {
  border: "1px solid #eee",
  borderRadius: 8,
  padding: 12,
  margin: "12px 0",
  background: "#fafafa",
};

const labelStyle = { display: "inline-block", fontWeight: 600, marginBottom: 4 };

const taStyle = {
  width: "100%",
  minHeight: 64,
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ddd",
  fontFamily: "inherit",
  fontSize: 14,
};
