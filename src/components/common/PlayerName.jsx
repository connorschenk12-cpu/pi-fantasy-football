/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { db } from "../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

const cache = new Map(); // `${scope}:${playerId}` -> { name }

function extractName(p, id) {
  if (!p) return String(id ?? "");
  return (
    p.name ||
    p.fullName ||
    p.playerName ||
    p.displayName ||
    p.Name ||
    p.PlayerName ||
    (p.firstName || p.FirstName ? `${p.firstName || p.FirstName} ${p.lastName || p.LastName || ""}`.trim() : null) ||
    p.meta?.name ||
    p.profile?.name ||
    p.info?.name ||
    String(id ?? "")
  );
}

export default function PlayerName({ leagueId, playerId, fallback = "" }) {
  const pid = String(playerId ?? "");
  const [name, setName] = useState(() => {
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
      // 1) league-scoped
      if (leagueId) {
        const k = `league:${leagueId}:${pid}`;
        if (cache.has(k)) {
          if (!cancelled) setName(cache.get(k).name);
          return;
        }
        try {
          const ref = doc(db, "leagues", leagueId, "players", pid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const nm = extractName(snap.data(), pid);
            cache.set(k, { name: nm });
            if (!cancelled) setName(nm);
            return;
          }
        } catch (e) {
          console.warn("PlayerName league read error:", e);
        }
      }

      // 2) global fallback
      const gk = `global:${pid}`;
      if (cache.has(gk)) {
        if (!cancelled) setName(cache.get(gk).name);
        return;
      }
      try {
        const gref = doc(db, "players", pid);
        const gsnap = await getDoc(gref);
        if (gsnap.exists()) {
          const nm = extractName(gsnap.data(), pid);
          cache.set(gk, { name: nm });
          if (!cancelled) setName(nm);
          return;
        }
      } catch (e) {
        console.warn("PlayerName global read error:", e);
      }

      // 3) last resort
      if (!cancelled) setName(String(pid));
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, pid]);

  return <>{name ?? fallback ?? String(pid)}</>;
}
