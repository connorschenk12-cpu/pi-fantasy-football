// src/lib/storage.js

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
import { db } from "./firebase"; // <-- make sure this points to your Firebase init

// ----------------------------
// Player Functions
// ----------------------------

// Get all players
export async function getAllPlayers() {
  const playersCol = collection(db, "players");
  const snap = await getDocs(playersCol);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// ----------------------------
// Draft Functions
// ----------------------------

// Subscribe to draft updates
export function subscribeToDraft(leagueId, callback) {
  const ref = doc(db, "drafts", leagueId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, ...snap.data() });
    }
  });
}

// Make a draft pick
export async function makeDraftPick(leagueId, pickNumber, playerId, teamId) {
  const draftRef = doc(db, "drafts", leagueId);
  await runTransaction(db, async (transaction) => {
    const draftSnap = await transaction.get(draftRef);
    if (!draftSnap.exists()) throw new Error("Draft not found");

    const draft = draftSnap.data();
    if (draft.picks[pickNumber]) throw new Error("Pick already made");

    draft.picks[pickNumber] = { playerId, teamId, timestamp: Date.now() };
    transaction.update(draftRef, { picks: draft.picks });
  });
}

// ----------------------------
// League Functions
// ----------------------------

// List leagues for a given user
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

// Create a new league
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
        passYds: 0.04,
        passTD: 4,
        rushYds: 0.1,
        rushTD: 6,
        recYds: 0.1,
        recTD: 6,
        reception: 0,
        int: -2,
        fumble: -2,
      },
    },
    createdAt: serverTimestamp(),
  });
  return (await getDoc(ref)).data();
}

// Join an existing league
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

// ----------------------------
// Roster Functions
// ----------------------------

// Get a user's roster
export async function getRoster(leagueId, username) {
  const ref = doc(db, "leagues", leagueId, "rosters", username);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : { players: [] };
}

// Update a user's roster
export async function updateRoster(leagueId, username, roster) {
  const ref = doc(db, "leagues", leagueId, "rosters", username);
  await setDoc(ref, roster, { merge: true });
}
