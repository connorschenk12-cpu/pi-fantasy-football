// src/lib/storage.js
import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  query,
  where,
} from "firebase/firestore";

/* =========================================
   PLAYERS
   ========================================= */

// Try league-scoped players first; if empty, fall back to global players
export async function listPlayers({ leagueId }) {
  try {
    const leagueCol = collection(db, "leagues", leagueId, "players");
    const leagueSnap = await getDocs(leagueCol);
    if (!leagueSnap.empty) {
      return leagueSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch {
    // ignore and fall through to global
  }
  const globalCol = collection(db, "players");
  const globalSnap = await getDocs(globalCol);
  return globalSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* =========================================
   CLAIMS (availability per league)
   ========================================= */

export async function getLeagueClaims(leagueId) {
  const claimsCol = collection(db, "leagues", leagueId, "claims");
  const snap = await getDocs(claimsCol);
  const map = new Map();
  snap.forEach((d) => map.set(d.id, d.data()));
  return map;
}

export function listenLeagueClaims(leagueId, onChange) {
  const claimsCol = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(claimsCol, (qs) => {
    const map = new Map();
    qs.forEach((d) => map.set(d.id, d.data()));
    onChange(map);
  });
}

/* =========================================
   TEAMS
   ========================================= */

export async function ensureTeam({ leagueId, username }) {
  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(teamRef);
  if (!snap.exists()) {
    await setDoc(teamRef, {
      username,
      roster: { QB: null, RB: null, WR: null, TE: null, FLEX: null, K: null, DEF: null },
      bench: [],
      createdAt: Date.now(),
    });
  }
  return teamRef;
}

export function listenTeam({ leagueId, username, onChange }) {
  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(teamRef, (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  });
}

export async function releasePlayerAndClearSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    // Only the drafter can release (or relax this if you prefer)
    const cSnap = await tx.get(claimRef);
    if (!cSnap.exists()) return; // nothing to do
    const c = cSnap.data() || {};
    if (c.claimedBy && c.claimedBy !== username) {
      throw new Error(`Only ${c.claimedBy} can release this player`);
    }

    const tSnap = await tx.get(teamRef);
    if (!tSnap.exists()) return;
    const data = tSnap.data() || {};
    const roster = { ...(data.roster || {}) };

    const upper = String(slot).toUpperCase();
    const current = roster[upper];
    const currentId = typeof current === "object" ? (current.id || current.playerId) : current;

    if (currentId === playerId) {
      roster[upper] = null;
      tx.update(teamRef, { roster });
    }
    tx.delete(claimRef);
  });
}

/* =========================================
   DRAFT GATING + CLAIMS
   ========================================= */

export function canDraft(league) {
  return (league?.draft?.status || "unscheduled") === "live";
}

// Claim a player into a roster slot (validates slot vs position; draft must be LIVE)
export async function claimPlayerToSlot({
  leagueId,
  username,
  playerId,
  playerPosition, // "QB" | "RB" | "WR" | "TE" | "K" | "DEF"
  slot,           // "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF"
}) {
  const claimRef  = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef   = doc(db, "leagues", leagueId, "teams", username);
  const leagueRef = doc(db, "leagues", leagueId);

  await runTransaction(db, async (tx) => {
    // Gate: only allow while draft is live
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists()) throw new Error("League not found");
    const status = leagueSnap.data()?.draft?.status;
    if (status !== "live") throw new Error("Draft is not live yet. You cannot draft players.");

    // Already claimed?
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const c = claimSnap.data() || {};
      throw new Error(`Player already claimed by ${c.claimedBy || "someone else"}`);
    }

    // Ensure team exists
    let teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) {
      tx.set(teamRef, {
        username,
        roster: { QB: null, RB: null, WR: null, TE: null, FLEX: null, K: null, DEF: null },
        bench: [],
        createdAt: Date.now(),
      });
      teamSnap = await tx.get(teamRef);
    }

    const upperSlot = String(slot).toUpperCase();
    const upperPos  = String(playerPosition || "").toUpperCase();
    const roster    = { ...((teamSnap.data() && teamSnap.data().roster) || {}) };

    // Validate slot compatibility
    const isFlex = upperSlot === "FLEX";
    const validForFlex = upperPos === "RB" || upperPos === "WR" || upperPos === "TE";
    if (!isFlex && upperSlot !== upperPos) {
      throw new Error(`Cannot place a ${upperPos} into ${upperSlot}`);
    }
    if (isFlex && !validForFlex) {
      throw new Error(`Only RB/WR/TE can be assigned to FLEX`);
    }

    // Assign + write claim
    roster[upperSlot] = playerId;
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp(), position: upperPos });
    tx.update(teamRef, { roster });
  });
}

/* =========================================
   LEAGUE CORE + DRAFT META
   ========================================= */

export async function getLeague(leagueId) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() || null) : null;
}

export function listenLeague(leagueId, onChange) {
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(ref, (snap) => onChange(snap.exists() ? (snap.data() || null) : null));
}

// Initialize default settings/draft fields if missing
export async function initLeagueDefaults(leagueId) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const data = snap.data() || {};

  const defaults = {
    draft: data.draft || { status: "unscheduled", scheduledAt: null, startedAt: null },
    settings: data.settings || {
      maxTeams: 10,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      bench: 5,
      scoring: {
        passYds: 0.04, passTD: 4,
        rushYds: 0.1,  rushTD: 6,
        recYds: 0.1,   recTD: 6,
        reception: 0,  // set to 1 later for PPR
        int: -2, fumble: -2,
      },
    },
  };

  await updateDoc(ref, {
    draft: defaults.draft,
    settings: defaults.settings,
  });

  const updated = await getDoc(ref);
  return updated.data();
}

export async function scheduleDraft(leagueId, isoDateString) {
  const when = new Date(isoDateString);
  if (isNaN(+when)) throw new Error("Invalid date/time");
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    draft: {
      status: "scheduled",
      scheduledAt: when.toISOString(),
      startedAt: null,
    },
  });
}

export async function setDraftStatus(leagueId, status) {
  if (!["unscheduled", "scheduled", "live", "complete"].includes(status)) {
    throw new Error("Invalid draft status");
  }
  const ref = doc(db, "leagues", leagueId);
  const patch =
    status === "live"
      ? { draft: { status: "live", scheduledAt: null, startedAt: new Date().toISOString() } }
      : { draft: { status } };
  await updateDoc(ref, patch);
}

/* =========================================
   LEAGUE LISTING / CREATION / JOIN
   ========================================= */

export async function listMyLeagues(username) {
  if (!username) return [];

  const leaguesCol = collection(db, "leagues");

  // Owner leagues
  const ownerQ = query(leaguesCol, where("owner", "==", username));
  const ownerSnap = await getDocs(ownerQ);

  // Member leagues
  const memberQ = query(leaguesCol, where("members", "array-contains", username));
  const memberSnap = await getDocs(memberQ);

  const map = new Map();
  ownerSnap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
  memberSnap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));

  // Normalize
  return Array.from(map.values()).map((l) => ({
    id: l.id,
    name: l.name || "Untitled League",
    owner: l.owner || "",
    members: Array.isArray(l.members) ? l.members : [],
    draft: l.draft || { status: "unscheduled", scheduledAt: null, startedAt: null },
    settings: l.settings || {},
  }));
}

// Create a new league (owner auto-added to members)
export async function createLeague({ name, owner, id }) {
  const leagueId =
    id ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `lg_${Math.random().toString(36).slice(2)}`);

  const ref = doc(db, "leagues", leagueId);

  await setDoc(ref, {
    id: leagueId,
    name: name || "New League",
    owner,
    members: [owner],
    draft: { status: "unscheduled", scheduledAt: null, startedAt: null },
    settings: {
      maxTeams: 10,
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      bench: 5,
      scoring: {
        passYds: 0.04, passTD: 4,
        rushYds: 0.1,  rushTD: 6,
        recYds: 0.1,   recTD: 6,
        reception: 0,
        int: -2, fumble: -2,
      },
    },
    createdAt: Date.now(),
  });

  const snap = await getDoc(ref);
  return snap.data();
}

// Join an existing league by ID (adds user to members if not present)
export async function joinLeague({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");

  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? data.members : [];

  if (!members.includes(username)) {
    members.push(username);
    await updateDoc(ref, { members });
  }
  const updated = await getDoc(ref);
  return updated.data();
}
