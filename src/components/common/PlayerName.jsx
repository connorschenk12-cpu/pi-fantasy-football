// src/components/common/PlayerName.jsx
/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

/**
 * Props:
 *   id          (string|number) player id
 *   leagueId    (string) optional; if provided we try league-scoped players first
 *   fallback    (string|ReactNode) optional fallback UI while loading / missing
 *   preferShort (boolean) if true, show short/last name when available
 *
 * This component is intentionally tiny and self-contained so you can use it anywhere.
 * It memo-caches lookups per session to avoid repeat reads for the same id.
 */

// Simple in-memory cache: { "<leagueId>|<id>": { name, team, position } }
const nameCache = new Map();

function idKey(leagueId, id) {
  const pid = String(id ?? "").trim();
  const lid = String(leagueId ?? "").trim();
  return `${lid}|${pid}`;
}

async function fetchNameOnce(leagueId, id) {
  const key = idKey(leagueId, id);
  if (nameCache.has(key)) return nameCache.get(key);

  const pid = String(id ?? "").trim();
  if (!pid) {
    nameCache.set(key, null);
    return null;
  }

  // 1) league-scoped player doc
  if (leagueId) {
    try {
      const leagueDoc = await getDoc(doc(db, "leagues", leagueId, "players", pid));
      if (leagueDoc.exists()) {
        const d = leagueDoc.data();
        const rec = normalizePlayerRecord(pid, d);
        nameCache.set(key, rec);
        return rec;
      }
    } catch (e) {
      // Non-fatal: just fall through to global
      console.warn("[PlayerName] league lookup failed:", e);
    }
  }

  // 2) global players/{id}
  try {
    const globalDoc = await getDoc(doc(db, "players", pid));
    if (globalDoc.exists()) {
      const d = globalDoc.data();
      const rec = normalizePlayerRecord(pid, d);
      nameCache.set(key, rec);
      return rec;
    }
  } catch (e) {
    console.warn("[PlayerName] global lookup failed:", e);
  }

  // 3) give up
  nameCache.set(key, null);
  return null;
}

function normalizePlayerRecord(id, data) {
  // Try common name fields; fall back to the id
  const name =
    data?.name ||
    data?.fullName ||
    data?.playerName ||
    data?.displayName ||
    String(id);

  // Provide a "short" name if you want to show condensed format elsewhere
  // e.g., "Mahomes P." / "P. Mahomes" — here we’ll use last name if possible.
  let short = name;
  const parts = String(name).split(/\s+/).filter(Boolean);
  if (parts.length > 1) short = parts[parts.length - 1];
  // Expose some helpful extras, but only `name` is required by <PlayerName />
  return {
    id: String(id),
    name,
    shortName: short,
    team: data?.team ?? data?.nflTeam ?? "",
    position: data?.position ?? data?.pos ?? "",
  };
}

export default function PlayerName({ id, leagueId, fallback = null, preferShort = false }) {
  const [rec, setRec] = useState(() => nameCache.get(idKey(leagueId, id)) ?? undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = idKey(leagueId, id);
      if (nameCache.has(key)) {
        if (!cancelled) setRec(nameCache.get(key));
        return;
      }
      const r = await fetchNameOnce(leagueId, id);
      if (!cancelled) setRec(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, id]);

  if (rec === undefined) {
    // loading state
    return fallback ?? <span style={{ color: "#999" }}>…</span>;
  }
  if (!rec) {
    // unknown
    return <span style={{ color: "#999" }}>{String(id || "(unknown)")}</span>;
  }

  return <span>{preferShort ? rec.shortName : rec.name}</span>;
}
