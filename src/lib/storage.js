// src/lib/storage.js
import { db } from "./firebase";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  runTransaction,
  onSnapshot
} from "firebase/firestore";

/** ----------------------
 *  Leagues (CRUD-ish)
 *  ---------------------- */
export async function createLeague({ name, owner }) {
  const leaguesCol = collection(db, "leagues");
  const newDocRef = await addDoc(leaguesCol, {
    name,
    owner,
    members: [owner],
    createdAt: serverTimestamp(),
  });
  await updateDoc(newDocRef, { id: newDocRef.id });
  return newDocRef.id;
}

export async function joinLeague({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  await updateDoc(ref, { members: arrayUnion(username) });
  const updated = await getDoc(ref);
  return updated.data();
}

export async function listMyLeagues(username) {
  const leaguesCol = collection(db, "leagues");
  const q = query(leaguesCol, where("members", "array-contains", username));
  const qs = await getDocs(q);
  return qs.docs.map((d) => d.data());
}

/** ----------------------
 *  Players (read-only list)
 *  ---------------------- */
export async function listPlayers() {
  const qs = await getDocs(collection(db, "players"));
  return qs.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** ----------------------
 *  Teams / Rosters
 *  ---------------------- */
export async function ensureTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username,
      roster: { QB: null, RB: null, WR: null, TE: null, FLEX: null, K: null, DEF: null },
      bench: [],
      createdAt: Date.now(),
    });
  }
  return ref.id;
}

export async function getTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function setRosterSlot({ leagueId, username, slot, playerId }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const teamSnap = await getDoc(ref);
  if (!teamSnap.exists()) throw new Error("Team not found");
  const team = teamSnap.data();
  const slotUpper = String(slot).toUpperCase();
  const newRoster = { ...(team.roster || {}) };
  newRoster[slotUpper] = playerId || null;
  await updateDoc(ref, { roster: newRoster });
  const updated = await getDoc(ref);
  return updated.data();
}

/** ----------------------
 *  Claims (prevent duplicates in a league)
 *  ---------------------- */
export async function getLeagueClaims(leagueId) {
  const qs = await getDocs(collection(db, "leagues", leagueId, "claims"));
  const map = new Map();
  qs.docs.forEach((d) => map.set(d.id, d.data()));
  return map;
}

/**
 * Atomically claim a player for a user AND assign to a roster slot.
 * Requires playerId format like "qb_mahomes" so we can validate slot↔position quickly.
 */
export async function claimPlayerAndAssignSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef  = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    // check claim
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const { claimedBy } = claimSnap.data();
      throw new Error(`Player already claimed by ${claimedBy}`);
    }

    // ensure team
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

    const team = teamSnap.data();
    const upper = String(slot).toUpperCase();
    const newRoster = { ...(team.roster || {}) };

    // simple validation based on id prefix (qb_, rb_, wr_, te_, k_, def_)
    const posPrefix = String(playerId).split("_")[0].toUpperCase(); // "QB", "RB", etc.
    const isFlex = upper === "FLEX";
    const validForFlex = posPrefix === "RB" || posPrefix === "WR" || posPrefix === "TE";

    if (!isFlex && upper !== posPrefix) {
      throw new Error(`Player ${playerId} cannot be assigned to ${upper}`);
    }
    if (isFlex && !validForFlex) {
      throw new Error(`Only RB/WR/TE can be assigned to FLEX`);
    }

    newRoster[upper] = playerId;

    // write both claim and roster
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp() });
    tx.update(teamRef, { roster: newRoster });
  });
}

/** Release a claimed player (owner only) and clear the given slot if it matches. */
export async function releasePlayerAndClearSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef  = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists()) return; // nothing to do
    const { claimedBy } = claimSnap.data();
    if (claimedBy !== username) throw new Error("You do not own this player");

    const teamSnap = await tx.get(teamRef);
    if (teamSnap.exists()) {
      const data = teamSnap.data();
      const upper = String(slot).toUpperCase();
      const newRoster = { ...(data.roster || {}) };
      if (newRoster[upper] === playerId) {
        newRoster[upper] = null;
        tx.update(teamRef, { roster: newRoster });
      }
    }
    tx.delete(claimRef);
  });
}

// 🔔 Live listeners
import { onSnapshot } from "firebase/firestore";

/** Listen to all player claims in a league. Returns unsubscribe fn. */
export function listenLeagueClaims(leagueId, onChange) {
  const colRef = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(colRef, (qs) => {
    const map = new Map();
    qs.docs.forEach((d) => map.set(d.id, d.data()));
    onChange(map);
  });
}

/** Listen to the current user's team document. Returns unsubscribe fn. */
export function listenTeam({ leagueId, username, onChange }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? snap.data() : null);
  });
}
