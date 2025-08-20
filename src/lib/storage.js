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
  onSnapshot,
} from "firebase/firestore";

/** ----------------------
 *  Helpers
 *  ---------------------- */
function arr(x) {
  return Array.isArray(x) ? x : [];
}
function obj(x) {
  return x && typeof x === "object" ? x : {};
}

/** ----------------------
 *  Leagues
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
  const data = obj(snap.data());
  const members = new Set(arr(data.members));
  members.add(username);
  await updateDoc(ref, { members: Array.from(members) });
  const updated = await getDoc(ref);
  return obj(updated.data());
}

export async function listMyLeagues(username) {
  const leaguesCol = collection(db, "leagues");
  const q = query(leaguesCol, where("members", "array-contains", username));
  const qs = await getDocs(q);
  return qs.docs.map((d) => {
    const data = obj(d.data());
    return { ...data, id: data.id || d.id, members: arr(data.members) };
  });
}

/** ----------------------
 *  Players (read-only)
 *  ---------------------- */
/**
 * Load players for a league if present (leagues/{leagueId}/players).
 * If none, fall back to global collection "players".
 * Returns array of { id, name, position/pos, team? }
 */
export async function listPlayers({ leagueId } = {}) {
  async function load(colRef) {
    const qs = await getDocs(colRef);
    return qs.docs.map((d) => {
      const data = obj(d.data());
      return {
        id: d.id,
        name: data.name || "",
        position: data.position || data.pos || "", // accept either key
        team: data.team || "",
        ...data,
      };
    });
  }

  // Try league-scoped first
  if (leagueId) {
    const leagueScoped = collection(db, "leagues", leagueId, "players");
    const got = await getDocs(leagueScoped);
    if (!got.empty) {
      return load(leagueScoped);
    }
  }

  // Fallback: global
  const globalCol = collection(db, "players");
  return load(globalCol);
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
  return snap.exists() ? obj(snap.data()) : null;
}

export async function setRosterSlot({ leagueId, username, slot, playerId }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const teamSnap = await getDoc(ref);
  if (!teamSnap.exists()) throw new Error("Team not found");
  const team = obj(teamSnap.data());
  const slotUpper = String(slot).toUpperCase();
  const newRoster = { ...obj(team.roster) };
  newRoster[slotUpper] = playerId || null;
  await updateDoc(ref, { roster: newRoster });
  const updated = await getDoc(ref);
  return obj(updated.data());
}

/** ----------------------
 *  Claims (prevent duplicates per league)
 *  ---------------------- */
export async function getLeagueClaims(leagueId) {
  const qs = await getDocs(collection(db, "leagues", leagueId, "claims"));
  const map = new Map();
  qs.docs.forEach((d) => map.set(d.id, obj(d.data())));
  return map;
}

/**
 * Atomically claim + assign to a roster slot.
 * Requires playerId format like "qb_xxx", "rb_xxx", etc for quick validation.
 */
export async function claimPlayerAndAssignSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef  = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    // claim check
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const { claimedBy } = obj(claimSnap.data());
      throw new Error(`Player already claimed by ${claimedBy}`);
    }

    // ensure team exists
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

    const team = obj(teamSnap.data());
    const upper = String(slot).toUpperCase();
    const newRoster = { ...obj(team.roster) };

    // validate slot by id prefix (qb_, rb_, wr_, te_, k_, def_)
    const posPrefix = String(playerId).split("_")[0].toUpperCase();
    const isFlex = upper === "FLEX";
    const validForFlex = posPrefix === "RB" || posPrefix === "WR" || posPrefix === "TE";
    if (!isFlex && upper !== posPrefix) throw new Error(`Player ${playerId} cannot be assigned to ${upper}`);
    if (isFlex && !validForFlex) throw new Error(`Only RB/WR/TE can be assigned to FLEX`);

    newRoster[upper] = playerId;

    // write claim + roster
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp() });
    tx.update(teamRef, { roster: newRoster });
  });
}

export async function releasePlayerAndClearSlot({ leagueId, username, playerId, slot }) {
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef  = doc(db, "leagues", leagueId, "teams", username);

  await runTransaction(db, async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists()) return;
    const { claimedBy } = obj(claimSnap.data());
    if (claimedBy !== username) throw new Error("You do not own this player");

    const teamSnap = await tx.get(teamRef);
    if (teamSnap.exists()) {
      const data = obj(teamSnap.data());
      const upper = String(slot).toUpperCase();
      const newRoster = { ...obj(data.roster) };
      if (newRoster[upper] === playerId) {
        newRoster[upper] = null;
        tx.update(teamRef, { roster: newRoster });
      }
    }
    tx.delete(claimRef);
  });
}

/** ----------------------
 *  Live listeners
 *  ---------------------- */
export function listenLeagueClaims(leagueId, onChange) {
  const colRef = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(colRef, (qs) => {
    const map = new Map();
    qs.docs.forEach((d) => map.set(d.id, obj(d.data())));
    onChange(map);
  });
}

export function listenTeam({ leagueId, username, onChange }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? obj(snap.data()) : null);
  });
}
