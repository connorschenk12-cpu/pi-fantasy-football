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
import { db } from "./firebase";

export async function createLeague({ name, owner }) {
  const leaguesCol = collection(db, "leagues");
  const newDoc = await addDoc(leaguesCol, {
    name,
    owner,
    members: [owner],
    createdAt: serverTimestamp(),
  });
  await updateDoc(newDoc, { id: newDoc.id });
  return newDoc.id;
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

import { collection, doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// Creates/initializes a team doc for a user in a league
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

// Fetch a user's team
export async function getTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
