/* eslint-disable no-console */
// src/components/common/PlayerName.jsx
import React, { useEffect, useMemo, useState } from "react";
import { onSnapshot, collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";

// A very small global cache so we don't refetch on every mount
let _globalPlayersMap = null;
let _leagueMaps = new Map(); // leagueId -> Map

async function loadPlayersCollection(colRef) {
  const snap = await getDocs(colRef);
  const map = new Map();
  snap.forEach((d) => {
    const p = { id: d.id, ...d.data() };
    // normalize common fields
    p.name = p.name || p.fullName || p.playerName || null;
    p.position = p.position || p.pos || null;
    p.team = p.team || p.nflTeam || p.proTeam || null;
    map.set(p.id, p);
  });
  return map;
}

/** Get a cached global players map (from /players). */
export async function getGlobalPlayersMap() {
  if (_globalPlayersMap) return _globalPlayersMap;
  const colRef = collection(db, "players");
  _globalPlayersMap = await loadPlayersCollection(colRef);
  return _globalPlayersMap;
}

/** Get a cached league-local map (leagues/{leagueId}/players), falling back to global. */
export async function getLeaguePlayersMap(leagueId) {
  if (!leagueId) return getGlobalPlayersMap();
  if (_leagueMaps.has(leagueId)) return _leagueMaps.get(leagueId);

  // Try league-scoped first
  const colRef = collection(db, "leagues", leagueId, "players");
  const leagueSnap = await getDocs(colRef);
  if (!leagueSnap.empty) {
    const map = await loadPlayersCollection(colRef);
    _leagueMaps.set(leagueId, map);
    return map;
  }

  // Fallback to global
  const g = await getGlobalPlayersMap();
  _leagueMaps.set(leagueId, g);
  return g;
}

export function usePlayersMap(leagueId) {
  const [map, setMap] = useState(null);

  useEffect(() => {
    let unsub = null;
    let cancelled = false;
    (async () => {
      try {
        // Watch league collection if it exists; else watch global
        const leagueCol = collection(db, "leagues", leagueId || "_skip_", "players");
        // We try league first; if empty, watch global instead:
        const leagueFirst = await getDocs(leagueCol);
        if (!cancelled && !leagueFirst.empty) {
          unsub = onSnapshot(leagueCol, (snap) => {
            const m = new Map();
            snap.forEach((d) => {
              const p = { id: d.id, ...d.data() };
              p.name = p.name || p.fullName || p.playerName || null;
              p.position = p.position || p.pos || null;
              p.team = p.team || p.nflTeam || p.proTeam || null;
              m.set(p.id, p);
            });
            setMap(m);
            _leagueMaps.set(leagueId, m);
          });
          return;
        }

        // Global fallback live listener
        const globalCol = collection(db, "players");
        unsub = onSnapshot(globalCol, (snap) => {
          const m = new Map();
          snap.forEach((d) => {
            const p = { id: d.id, ...d.data() };
            p.name = p.name || p.fullName || p.playerName || null;
            p.position = p.position || p.pos || null;
            p.team = p.team || p.nflTeam || p.proTeam || null;
            m.set(p.id, p);
          });
          setMap(m);
          _globalPlayersMap = m;
        });
      } catch (e) {
        console.error("usePlayersMap error:", e);
      }
    })();

    return () => unsub && unsub();
  }, [leagueId]);

  return map;
}

export function displayNameFrom(p) {
  if (!p) return null;
  return p.name || p.fullName || p.playerName || null;
}

/** PlayerName — resolves an id (string/number) to a human name, with fallbacks. */
export default function PlayerName({ id, leagueId, fallback = null }) {
  const map = usePlayersMap(leagueId);

  const text = useMemo(() => {
    if (!id) return fallback ?? "(empty)";
    // If map loaded & has the id, use it
    if (map && map.has(String(id))) {
      const p = map.get(String(id));
      return displayNameFrom(p) || String(id);
    }
    // If we haven't loaded yet, at least show the id to avoid blanks
    return String(id);
  }, [id, map, fallback]);

  return <span>{text}</span>;
}
