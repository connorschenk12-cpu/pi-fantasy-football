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
    const cSnap = await tx.get(claimRef);
    if (!cSnap.exists()) return;
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
   DRAFT GATING (legacy claim) + TURN-BASED DRAFT
   ========================================= */

export function canDraft(league) {
  return (league?.draft?.status || "unscheduled") === "live";
}

// (Legacy helper; still useful for admin/testing)
// Validates slot vs position and writes claim + roster, but DOES NOT manage turns.
export async function claimPlayerToSlot({
  leagueId,
  username,
  playerId,
  playerPosition, // "QB" | "RB" | "WR" | "TE" | "K" | "DEF"
  slot,           // "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF"
}) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  const leagueRef = doc(db, "leagues", leagueId);

  await runTransaction(db, async (tx) => {
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists()) throw new Error("League not found");
    const status = leagueSnap.data()?.draft?.status;
    if (status !== "live") throw new Error("Draft is not live yet. You cannot draft players.");

    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const c = claimSnap.data() || {};
      throw new Error(`Player already claimed by ${c.claimedBy || "someone else"}`);
    }

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
    const upperPos = String(playerPosition || "").toUpperCase();
    const roster = { ...((teamSnap.data() && teamSnap.data().roster) || {}) };

    const isFlex = upperSlot === "FLEX";
    const validForFlex = ["RB", "WR", "TE"].includes(upperPos);
    if (!isFlex && upperSlot !== upperPos) {
      throw new Error(`Cannot place a ${upperPos} into ${upperSlot}`);
    }
    if (isFlex && !validForFlex) {
      throw new Error(`Only RB/WR/TE can be assigned to FLEX`);
    }
    if (roster[upperSlot]) {
      throw new Error(`${upperSlot} is already filled.`);
    }

    roster[upperSlot] = playerId;
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp(), position: upperPos });
    tx.update(teamRef, { roster });
  });
}

// Turn-enforced snake draft; records pick and advances pointer/round/direction.
export async function draftPick({
  leagueId,
  username,
  playerId,
  playerPosition, // "RB", ...
  slot,           // "RB", "FLEX", ...
}) {
  const leagueRef = doc(db, "leagues", leagueId);
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists()) throw new Error("League not found");
    const league = leagueSnap.data() || {};
    const draft = league.draft || {};
    const status = draft.status || "unscheduled";
    if (status !== "live") throw new Error("Draft is not live.");

    const order = Array.isArray(draft.order) ? draft.order : [];
    if (order.length < 2) throw new Error("Draft order not initialized.");
    const pointer = Number.isInteger(draft.pointer) ? draft.pointer : 0;
    const currentUser = order[pointer];
    if (currentUser !== username) {
      throw new Error(`It's ${currentUser}'s turn to pick.`);
    }

    // player not already claimed?
    const existingClaim = await tx.get(claimRef);
    if (existingClaim.exists()) {
      const c = existingClaim.data() || {};
      throw new Error(`Player already drafted by ${c.claimedBy || "someone else"}`);
    }

    // ensure team doc
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
    const upperPos = String(playerPosition || "").toUpperCase();
    const roster = { ...((teamSnap.data() && teamSnap.data().roster) || {}) };

    const isFlex = upperSlot === "FLEX";
    const validForFlex = ["RB", "WR", "TE"].includes(upperPos);
    if (!isFlex && upperSlot !== upperPos) {
      throw new Error(`Cannot place a ${upperPos} into ${upperSlot}`);
    }
    if (isFlex && !validForFlex) {
      throw new Error(`Only RB/WR/TE can be assigned to FLEX`);
    }
    if (roster[upperSlot]) {
      throw new Error(`${upperSlot} is already filled.`);
    }

    // write claim + roster
    roster[upperSlot] = playerId;
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp(), position: upperPos });
    tx.update(teamRef, { roster });

    // record pick & advance pointer (snake)
    const round = Number.isInteger(draft.round) ? draft.round : 1;
    const direction = draft.direction === -1 ? -1 : 1;
    const totalRounds = draft.totalRounds || 15;
    const teamCount = order.length;

    const pickInRound = direction === 1 ? pointer + 1 : teamCount - pointer; // 1..N
    const overall = (round - 1) * teamCount + pickInRound;

    const newPicks = Array.isArray(draft.picks) ? draft.picks.slice() : [];
    newPicks.push({
      overall,
      round,
      pickInRound,
      username,
      playerId,
      slot: upperSlot,
      ts: Date.now(),
    });

    // advance pointer
    let newPointer = pointer + direction;
    let newRound = round;
    let newDirection = direction;

    if (newPointer >= teamCount || newPointer < 0) {
      // end of round: flip direction, advance round
      newRound = round + 1;
      newDirection = direction * -1;
      newPointer = newDirection === 1 ? 0 : teamCount - 1;
    }

    const draftComplete = newRound > totalRounds;

    tx.update(leagueRef, {
      draft: {
        ...draft,
        picks: newPicks,
        pointer: draftComplete ? pointer : newPointer,
        round: draftComplete ? round : newRound,
        direction: draftComplete ? direction : newDirection,
        status: draftComplete ? "complete" : "live",
      },
    });
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
        reception: 0,
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
      ? { draft: { ...(await (await getDoc(ref)).data()?.draft), status: "live", scheduledAt: null, startedAt: new Date().toISOString() } }
      : { draft: { ...(await (await getDoc(ref)).data()?.draft), status } };
  await updateDoc(ref, patch);
}

/* =========================================
   DRAFT ORDER (init / custom)
   ========================================= */

// Creates a random snake draft order and initializes turn state.
export async function initDraftOrder(leagueId) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const data = snap.data() || {};
  const members = Array.isArray(data.members) ? [...data.members] : [];
  if (members.length < 2) throw new Error("Add at least 2 members before creating draft order.");

  // Fisher–Yates shuffle
  for (let i = members.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [members[i], members[j]] = [members[j], members[i]];
  }

  // Total rounds = starters + bench (simple baseline)
  const slots = data?.settings?.rosterSlots || { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DEF:1 };
  const totalRounds = Object.values(slots).reduce((a, b) => a + (b || 0), 0) + (data?.settings?.bench ?? 5);

  await updateDoc(ref, {
    draft: {
      ...(data.draft || {}),
      status: "scheduled",
      order: members,
      pointer: 0,
      round: 1,
      direction: 1,
      totalRounds,
      picks: [],
    },
  });

  return (await getDoc(ref)).data();
}

// Owner can provide a custom order array (usernames)
export async function setDraftOrder(leagueId, orderArray) {
  if (!Array.isArray(orderArray) || orderArray.length < 2) throw new Error("Provide 2+ usernames.");
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const data = snap.data() || {};
  await updateDoc(ref, {
    draft: {
      ...(data.draft || {}),
      order: orderArray,
      pointer: 0,
      round: 1,
      direction: 1,
      picks: [],
    },
  });
}

/* =========================================
   LEAGUE LISTING / CREATION / JOIN
   ========================================= */

export async function listMyLeagues(username) {
  if (!username) return [];
  const leaguesCol = collection(db, "leagues");

  const ownerQ = query(leaguesCol, where("owner", "==", username));
  const memberQ = query(leaguesCol, where("members", "array-contains", username));

  const [ownerSnap, memberSnap] = await Promise.all([getDocs(ownerQ), getDocs(memberQ)]);
  const map = new Map();

  ownerSnap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
  memberSnap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));

  return Array.from(map.values()).map((l) => ({
    id: l.id,
    name: l.name || "Untitled League",
    owner: l.owner || "",
    members: Array.isArray(l.members) ? l.members : [],
    draft: l.draft || { status: "unscheduled", scheduledAt: null, startedAt: null },
    settings: l.settings || {},
  }));
}

// Create a new league (owner auto-added)
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

// Join an existing league by ID
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
  return (await getDoc(ref)).data();
}
