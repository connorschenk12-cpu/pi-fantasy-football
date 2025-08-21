// src/components/WeekScheduleAdmin.js
import React, { useMemo, useState } from "react";
import { db } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";

/**
 * WeekScheduleAdmin
 * Admin tool for a league:
 * - Set currentWeek manually
 * - (Optional) Paste a weekSchedule array to auto-advance weeks in the UI:
 *   settings.weekSchedule = [{start: <ms>, end: <ms>}, ...]
 */
export default function WeekScheduleAdmin({ leagueId, currentSettings }) {
  const [week, setWeek] = useState(Number(currentSettings?.currentWeek || 1));
  const [scheduleText, setScheduleText] = useState(
    currentSettings?.weekSchedule ? JSON.stringify(currentSettings.weekSchedule, null, 2) : ""
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const validWeek = useMemo(() => Number.isInteger(week) && week >= 1 && week <= 18, [week]);

  async function saveWeek() {
    if (!validWeek) {
      setMsg("Week must be an integer between 1 and 18.");
      return;
    }
    try {
      setBusy(true);
      await updateDoc(doc(db, "leagues", leagueId), {
        "settings.currentWeek": week
      });
      setMsg(`Saved currentWeek = ${week}`);
    } catch (e) {
      setMsg(e.message || "Failed to save currentWeek");
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    try {
      setBusy(true);
      const parsed = JSON.parse(scheduleText || "[]");
      if (!Array.isArray(parsed)) throw new Error("weekSchedule must be an array");
      // Validate a little
      parsed.forEach((w, i) => {
        if (typeof w?.start !== "number" || typeof w?.end !== "number") {
          throw new Error(`weekSchedule[${i}] must have numeric start and end (ms)`);
        }
      });
      await updateDoc(doc(db, "leagues", leagueId), {
        "settings.weekSchedule": parsed
      });
      setMsg(`Saved weekSchedule (${parsed.length} weeks). UI auto-advances based on 'end'.`);
    } catch (e) {
      setMsg(e.message || "Failed to save weekSchedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #eaeaea", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Week Schedule / Current Week</div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label>currentWeek:&nbsp;
          <input type="number" value={week} min={1} max={18} onChange={(e)=>setWeek(Number(e.target.value))} />
        </label>
        <button onClick={saveWeek} disabled={!validWeek || busy}>{busy ? "Saving…" : "Save currentWeek"}</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Optional: weekSchedule (array of {"{start,end}"} in ms)</div>
        <textarea
          value={scheduleText}
          onChange={(e)=>setScheduleText(e.target.value)}
          placeholder='[{"start": 1756684800000, "end": 1757289599000}, ...]'
          style={{ width: "100%", minHeight: 160, fontFamily: "monospace" }}
        />
        <button onClick={saveSchedule} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? "Saving…" : "Save weekSchedule"}
        </button>
      </div>

      {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        If <code>settings.weekSchedule</code> is set, your app will default to the first week whose <code>end</code> is in the future.
      </div>
    </div>
  );
}
