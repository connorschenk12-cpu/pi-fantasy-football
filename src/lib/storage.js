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
} from "firebase/firestore";

/**
 * Create a league owned by `owner`; returns the new Firestore doc id.
 */
export async function createLeague({ name, owner }) {
  const leaguesCol = collection(db, "leagues");
  const newDocRef = await addDoc(leaguesCol, {
    name,
    owner,
    members: [owner],
    createdAt: serverTimestamp(),
  });
  // Save the id inside the document for convenience
  await updateDoc(newDocRef, { id: newDocRef.id });
  return newDocRef.id;
}

/**
 * Join a league by document id; idempotent for the same username.
 */
export async function joinLeague({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  await updateDoc(ref, { members: arrayUnion(username) });
  const updated = await getDoc(ref);
  return updated.data();
}

/**
 * List leagues where `username` is a member.
 */
export async function listMyLeagues(username) {
  const leaguesCol = collection(db, "leagues");
  const q = query(leaguesCol, where("members", "array-contains", username));
  const qs = await getDocs(q);
  return qs.docs.map((d) => d.data());
}

/**
 * Ensure a team document exists for `username` in `leagueId`.
 */
export async function ensureTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username,
      roster: {
        QB: null,
        RB: null,
        WR: null,
        TE: null,
        FLEX: null,
        K: null,
        DEF: null,
      },
      bench: [],
      createdAt: Date.now(),
    });
  }
  return ref.id;
}

/**
 * Fetch a user's team in a league.
 */
export async function getTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/**
 * Set a single roster slot (e.g., QB -> playerId). For FLEX, allow RB/WR/TE.
 */
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
// Add to storage.js
export async function listPlayers() {
  const snap = await getDocs(collection(db, "players"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

import {
  runTransaction,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

/**
 * Return a Map of playerId -> { claimedBy }
 */
export async function getLeagueClaims(leagueId) {
  const qs = await getDocs(collection(db, "leagues", leagueId, "claims"));
  const map = new Map();
  qs.docs.forEach((d) => map.set(d.id, d.data()));
  return map;
}

/**
 * Atomically claim a player for a user AND set them in a roster slot.
 * Throws if player already claimed by someone else.
 */
export async function claimPlayerAndAssignSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef  = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    // Check claim
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const { claimedBy } = claimSnap.data();
      throw new Error(`Player already claimed by ${claimedBy}`);
    }

    // Ensure team exists
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) {
      tx.set(teamRef, {
        username,
        roster: { QB: null, RB: null, WR: null, TE: null, FLEX: null, K: null, DEF: null },
        bench: [],
        createdAt: Date.now(),
      });
    }

    const teamData = (await tx.get(teamRef)).data();
    const newRoster = { ...(teamData.roster || {}) };
    const upper = String(slot).toUpperCase();

    // Basic slot validation
    const posFromId = playerId.split("_")[0].toUpperCase(); // e.g. "qb", "rb" from "qb_mahomes" (works for your starter pool)
    const isFlex = upper === "FLEX";
    const validForFlex = posFromId === "RB" || posFromId === "WR" || posFromId === "TE";
    if (!isFlex && upper !== posFromId) {
      throw new Error(`Player ${playerId} cannot be assigned to slot ${upper}`);
    }
    if (isFlex && !validForFlex) {
      throw new Error(`Only RB/WR/TE can go to FLEX`);
    }

    newRoster[upper] = playerId;

    // Write claim + team roster
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp() });
    tx.update(teamRef, { roster: newRoster });
  });
}

/**
 * (Optional) Release a claimed player (owner only) and clear slot if matching.
 */
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
      const newRoster = { ...(data.roster || {}) };
      const upper = String(slot).toUpperCase();
      if (newRoster[upper] === playerId) {
        newRoster[upper] = null;
        tx.update(teamRef, { roster: newRoster });
      }
    }
    tx.delete(claimRef);
  });
}


