/* src/components/common/PlayerName.jsx */
/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

// Simple in-memory cache so we don't re-fetch names repeatedly
const cache = new Map(); // key: `${scope}:${playerId}` -> { name, loaded: true }

function extractName(p, fallbackId) {
  if (!p) return String(fallbackId ?? "");
  return (
    p.name ||
    p.fullName ||
    p.playerName ||
    p.displayName ||
    p.Name ||       // sometimes capitalized
    p.PlayerName || // sometimes weird casing
    p.title ||
    String(fallbackId ?? "")
  );
}

/**
 * Props:
 * - leagueId (string)
 * - playerId (string|number)
 * - fallback (optional string to show while loading)
 */
export default function PlayerName({ leagueId, playerId, fallback = "" }) {
  const pid = String(playerId ?? "");

  const [name, setName] = useState(() => {
    // prefer cached league-scoped name, then global
    const k1 = `league:${leagueId}:${pid}`;
    const k2 = `global:${pid}`;
    if (cache.has(k1)) return cache.get(k1).name;
    if (cache.has(k2)) return cache.get(k2).name;
    return null;
  });

  useEffect(() => {
    let cancelled = false;
    if (!pid) return;

    (async () => {
      // 1) Try league-scoped player doc
      if (leagueId) {
        const key = `league:${leagueId}:${pid}`;
        if (cache.has(key)) {
          if (!cancelled) setName(cache.get(key).name);
          return;
        }
        try {
          const ref = doc(db, "leagues", leagueId, "players", pid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const nm = extractName(snap.data(), pid);
            cache.set(key, { name: nm, loaded: true });
            if (!cancelled) setName(nm);
            return;
          }
        } catch (e) {
          console.warn("PlayerName league read error:", e);
        }
      }

      // 2) Fall back to global players/{pid}
      const gkey = `global:${pid}`;
      if (cache.has(gkey)) {
        if (!cancelled) setName(cache.get(gkey).name);
        return;
      }
      try {
        const gref = doc(db, "players", pid);
        const gsnap = await getDoc(gref);
        if (gsnap.exists()) {
          const nm = extractName(gsnap.data(), pid);
          cache.set(gkey, { name: nm, loaded: true });
          if (!cancelled) setName(nm);
          return;
        }
      } catch (e) {
        console.warn("PlayerName global read error:", e);
      }

      // 3) If nothing found, just show the id as a last resort
      if (!cancelled) setName(String(pid));
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, pid]);

  if (!pid) return null;
  return <>{name ?? fallback ?? String(pid)}</>;
}
