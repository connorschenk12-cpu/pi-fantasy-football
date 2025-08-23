// src/components/SeedPlayers.js
/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { seedPlayersFromLocal, upsertPlayers } from "../lib/storage";

export default function SeedPlayers({ leagueId }) {
  const [localMod, setLocalMod] = useState(null);
  const [previewCount, setPreviewCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Dynamically import local data file
        const mod = await import("../data/players.js");
        if (!mounted) return;

        // Try to detect array length for preview
        let arr =
          (Array.isArray(mod.default) && mod.default) ||
          (Array.isArray(mod.PLAYERS) && mod.PLAYERS) ||
          (Array.isArray(mod.players) && mod.players) ||
          null;

        if (!arr && mod.NAME_BY_ID && typeof mod.NAME_BY_ID === "object") {
          arr = Object.keys(mod.NAME_BY_ID);
        }
        if (!arr && mod.INDEX && typeof mod.INDEX === "object") {
          arr = Object.keys(mod.INDEX);
        }

        setLocalMod(mod);
        setPreviewCount(Array.isArray(arr) ? arr.length : (arr ?  Object.keys(arr).length : 0));
      } catch (e) {
        console.error("Could not import ../data/players.js", e);
        setMsg("Could not import ../data/players.js — make sure it exists.");
      }
    })();
    return () => { mounted = false; };
  }, []);

  const runSeedLeague = async () => {
    if (!leagueId) return alert("No leagueId");
    if (!localMod) return alert("No local players module loaded");
    try {
      setBusy(true);
      setMsg("Seeding league players...");
      const res = await seedPlayersFromLocal({ leagueId, localModule: localMod });
      setMsg(`Seeded ${res.count} players to this league.`);
    } catch (e) {
      console.error(e);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const runSeedGlobal = async () => {
    if (!localMod) return alert("No local players module loaded");
    try {
      setBusy(true);
      setMsg("Seeding global players...");
      // Re-use the helper by extracting an array exactly like seedPlayersFromLocal
      let arr =
        (Array.isArray(localMod.default) && localMod.default) ||
        (Array.isArray(localMod.PLAYERS) && localMod.PLAYERS) ||
        (Array.isArray(localMod.players) && localMod.players) ||
        null;

      if (!arr && localMod.NAME_BY_ID && typeof localMod.NAME_BY_ID === "object") {
        arr = Object.entries(localMod.NAME_BY_ID).map(([id, name]) => ({ id, name }));
      }
      if (!arr && localMod.INDEX && typeof localMod.INDEX === "object") {
        arr = Object.entries(localMod.INDEX).map(([id, v]) => ({
          id,
          name:
            v?.name ||
            v?.fullName ||
            v?.playerName ||
            v?.displayName ||
            (v?.firstName && v?.lastName ? `${v.firstName} ${v.lastName}` : null),
          position: v?.position,
          team: v?.team || v?.proTeam,
          projections: v?.projections || v?.projByWeek || undefined,
        }));
      }

      if (!Array.isArray(arr)) throw new Error("Could not detect an array in src/data/players.js");

      const res = await upsertPlayers({ leagueId: null, playersArray: arr });
      setMsg(`Seeded ${res.count} players to the global 'players' collection.`);
    } catch (e) {
      console.error(e);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: "1px solid #eee", padding: 12, borderRadius: 8, marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Seed Players</h3>
      <p style={{ margin: "6px 0", color: "#555" }}>
        Local data detected: <b>{previewCount}</b> players in <code>src/data/players.js</code>.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={runSeedLeague} disabled={busy || !localMod || !leagueId}>
          Seed League Players
        </button>
        <button onClick={runSeedGlobal} disabled={busy || !localMod}>
          Seed Global Players
        </button>
      </div>
      {busy && <div style={{ marginTop: 8 }}>Working…</div>}
      {msg && <div style={{ marginTop: 8, color: "#333" }}>{msg}</div>}
      <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
        Tip: Seeding into the league collection (<code>leagues/&lt;leagueId&gt;/players</code>) keeps each league independent.
        Global seeding populates <code>players</code> for all leagues.
      </div>
    </div>
  );
}
