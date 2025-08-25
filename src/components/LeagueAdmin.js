/* eslint-disable no-console */
// src/components/LeagueAdmin.js
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  listMemberUsernames,
  initDraftOrder,
  startDraft,
  endDraft,
  setDraftSchedule,
  ensureOrRecreateSchedule,
  allMembersPaidOrFree,
  memberCanDraft,
  teamRecordLine,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [whenLocal, setWhenLocal] = useState(""); // datetime-local value
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    return () => unsub && unsub();
  }, [leagueId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const arr = await listMemberUsernames(leagueId);
        if (alive) setMembers(arr);
      } catch (e) {
        console.error("listMemberUsernames:", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  const isOwner = useMemo(
    () => !!league && league.owner === username,
    [league, username]
  );

  async function handleSeedOrder() {
    try {
      const seeded = await initDraftOrder({ leagueId });
      alert(`Draft order seeded: ${seeded.join(" → ")}`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function handleSchedule() {
    if (!whenLocal) {
      alert("Pick a date & time first.");
      return;
    }
    try {
      setSaving(true);
      const startsAtMs = Date.parse(whenLocal);
      await setDraftSchedule({ leagueId, startsAtMs });
      alert("Draft scheduled.");
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function handleGoLiveNow() {
    try {
      await startDraft({ leagueId });
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function handleEndDraft() {
    try {
      await endDraft({ leagueId });
      alert("Draft marked as done.");
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function handleRecreateSchedule() {
    try {
      const out = await ensureOrRecreateSchedule(leagueId, 14);
      alert(`Weeks (re)created: ${out.weeksCreated.join(", ") || "(already existed)"}`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  if (!league) return <div>Loading league…</div>;
  if (!isOwner) return <div>(Admin tools are only visible to the league owner.)</div>;

  const status = league?.draft?.status || "scheduled";
  const scheduledAt = league?.draft?.scheduledAt ? new Date(league.draft.scheduledAt) : null;

  return (
    <div>
      <h3>League Admin</h3>

      <div style={{ marginBottom: 12, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <div><b>Draft Status:</b> {status}
          {scheduledAt && status === "scheduled" && (
            <> — scheduled for <b>{scheduledAt.toLocaleString()}</b></>
          )}
        </div>
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          <button onClick={handleSeedOrder}>Seed Draft Order from Members</button>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="datetime-local"
              value={whenLocal}
              onChange={(e) => setWhenLocal(e.target.value)}
            />
            <button disabled={saving} onClick={handleSchedule}>
              {saving ? "Saving…" : "Schedule Draft"}
            </button>
            <button onClick={handleGoLiveNow}>Go Live Now</button>
            <button onClick={handleEndDraft}>Mark Draft Done</button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <b>Regular Season Schedule</b>
        <div style={{ marginTop: 8 }}>
          <button onClick={handleRecreateSchedule}>
            (Re)create Round-Robin (14 weeks)
          </button>
        </div>
      </div>

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <b>Members</b>
        <ul>
          {members.map((m) => {
            const can = memberCanDraft(league, m);
            const rec = teamRecordLine(league, m);
            return (
              <li key={m}>
                {m} — {can ? "eligible" : "blocked"} — record: {rec}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
