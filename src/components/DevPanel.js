// src/components/DevPanel.js
import React, { useState } from "react";
import { joinLeague, initDraftOrder, setDraftStatus } from "../lib/storage";

export default function DevPanel({ me, setMe, league, onLeagueUpdate }) {
  const [fakeUser, setFakeUser] = useState("");
  const [addCount, setAddCount] = useState(3);

  async function impersonate() {
    if (!fakeUser.trim()) return;
    setMe(fakeUser.trim());
  }

  async function addMembers() {
    if (!league?.id) return alert("Open a league first");
    const base = "user";
    const n = Math.max(1, Math.min(12, Number(addCount) || 1));
    for (let i = 1; i <= n; i++) {
      await joinLeague({ leagueId: league.id, username: `${base}${i}` });
    }
    alert(`Added ${n} fake members`);
    onLeagueUpdate && onLeagueUpdate();
  }

  async function randomizeDraft() {
    if (!league?.id) return alert("Open a league first");
    await initDraftOrder(league.id);
    await setDraftStatus(league.id, "live");
    alert("Draft order set and draft is LIVE");
    onLeagueUpdate && onLeagueUpdate();
  }

  return (
    <div style={{ marginTop: 12, padding: 10, border: "1px dashed #aaa", borderRadius: 8 }}>
      <b>Dev Tools (sandbox only)</b>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <input placeholder="impersonate username…" value={fakeUser} onChange={(e)=>setFakeUser(e.target.value)} style={{ padding: 6 }} />
        <button onClick={impersonate} style={{ padding: 6 }}>Impersonate</button>
        <span style={{ opacity: 0.7 }}>Current: <b>{me || "—"}</b></span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <input type="number" value={addCount} onChange={(e)=>setAddCount(e.target.value)} style={{ padding: 6, width: 80 }} />
        <button onClick={addMembers} style={{ padding: 6 }}>Add Fake Members</button>
        <button onClick={randomizeDraft} style={{ padding: 6 }}>Randomize Draft & Go LIVE</button>
      </div>
    </div>
  );
}
