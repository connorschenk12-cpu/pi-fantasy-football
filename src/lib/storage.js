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

