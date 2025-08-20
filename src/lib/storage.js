// src/lib/storage.js (Firestore-backed)
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

// Create a league owned by username; returns leagueId
export async function createLeague({ name, owner }) {
  const leaguesCol = collection(db, "leagues");
  const newDoc = await addDoc(leaguesCol, {
    name,
    owner,
    members: [owner],
    createdAt: serverTimestamp(),
  });
  // Also store its id field for convenience
  await updateDoc(newDoc, { id: newDoc.id });
  return newDoc.id;
}

// Join by leagueId; idempotent for same user
export async function joinLeague({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  await updateDoc(ref, { members: arrayUnion(username) });
  const updated = await getDoc(ref);
  return updated.data();
}

// Return leagues where user is a member
export async function listMyLeagues(username) {
  const leaguesCol = collection(db, "leagues");
  const q = query(leaguesCol, where("members", "array-contains", username));
  const qs = await getDocs(q);
  return qs.docs.map((d) => d.data());
}
