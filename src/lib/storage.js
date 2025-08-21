/* eslint-disable no-console */
// src/lib/storage.js
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, increment, writeBatch
} from "firebase/firestore";
import { db } from "../firebase";

/** ---------- ROSTER/DRAFT CONSTANTS ---------- **/
export const ROSTER_SLOTS = ["QB","WR1","WR2","RB1","RB2","TE","FLEX","K","DEF"]; // 9 starters
export const BENCH_SIZE = 4;               // 4 bench spots
export const DRAFT_ROUNDS = ROSTER_SLOTS.length + BENCH_SIZE; // = 13? (No, 9 + 4 = 13) -> user asked for 12 total; we’ll make FLEX overlap with WR/RB to keep 12.
// To hit exactly 12 rounds total, we’ll keep 8 fixed slots + FLEX (makes 9) + 3 bench = 12.
// Adjust per user request:
export const BENCH_SIZE_OVERRIDE = 3; // 3 bench -> total 12 rounds
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE_OVERRIDE; // 9 + 3 = 12

export const PICK_CLOCK_MS = 5000; // 5 seconds

/** Default empty roster that supports WR1/WR2, RB1/RB2 */
export function emptyRoster() {
  const r = {};
  ROSTER_SLOTS.forEach((s) => r[s] = null);
  return r;
}

/** Resolve default slot for a given football position */
export function defaultSlotForPosition(pos) {
  const p = String(pos || "").toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return pickFirstOpen(["RB1","RB2"]) || "FLEX";
  if (p === "WR") return pickFirstOpen(["WR1","WR2"]) || "FLEX";
  if (p === "TE") return "TE";
  if (p === "K")  return "K";
  if (p === "DEF") return "DEF";
  return "FLEX";
}
function pickFirstOpen(slots, r=null) {
  const roster = r || {}; // allow external roster
  for (const s of slots) {
    if (!roster[s]) return s;
  }
  return null;
}

/** ---------- BASIC LEAGUE / TEAM LISTENERS ---------- **/

export function listenLeague(leagueId, onChange) {
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) onChange({ id: snap.id, ...snap.data() });
    else onChange(null);
  });
}

export async function getLeague(leagueId) {
  const s = await getDoc(doc(db, "leagues", leagueId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function ensureTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      owner: username,
      roster: emptyRoster(),
      bench: [],
      createdAt: serverTimestamp(),
    }, { merge: true });
  }
  return ref;
}

export function listenTeam({ leagueId, username, onChange }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** ---------- PLAYERS / CLAIMS ---------- **/

export async function listPlayers({ leagueId }) {
  // First try league-scoped players
  const leaguePlayersRef = collection(db, "leagues", leagueId, "players");
  const leagueSnap = await getDocs(leaguePlayersRef);
  if (!leagueSnap.empty) {
    const arr = [];
    leagueSnap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    return arr;
  }
  // Fallback: global players
  const snap = await getDocs(collection(db, "players"));
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, d.data()));
    onChange(m);
  });
}

/** ---------- ENTRY / PAYMENTS GATE ---------- **/

export function hasPaidEntry(league, username) {
  return !!league?.entry?.enabled
    ? !!league?.entry?.paid?.[username]
    : true;
}

/** ---------- DRAFT STATE & HELPERS ---------- **/

export function canDraft(league) {
  return league?.draft?.status === "live";
}

export function draftActive(league) {
  return canDraft(league);
}

export function isMyTurn(league, username) {
  const d = league?.draft || {};
  const order = Array.isArray(d.order) ? d.order : [];
  const ptr = Number.isInteger(d.pointer) ? d.pointer : 0;
  return canDraft(league) && order[ptr] === username;
}

/** compute current round (1-indexed) out of DRAFT_ROUNDS_TOTAL based on picksTaken */
export function currentRound(league) {
  const picksTaken = Number(league?.draft?.picksTaken || 0);
  return Math.min(Math.floor(picksTaken / leagueDraftTeamCount(league)) + 1, DRAFT_ROUNDS_TOTAL);
}
export function leagueDraftTeamCount(league) {
  return Math.max(1, Array.isArray(league?.draft?.order) ? league.draft.order.length : 1);
}

/** Set up a 12-round draft */
export async function configureDraft({ leagueId, order }) {
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    draft: {
      status: "scheduled",
      order,             // array of usernames picking in order
      pointer: 0,        // index into order
      direction: 1,      // 1 forward, -1 reverse (snake can flip each round)
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: null,    // server time (ms) when current pick expires
    },
    settings: {
      ...(await getDoc(ref)).data()?.settings,
      // lock add-drop during draft
      lockAddDuringDraft: true,
    }
  });
}

/** Start draft (set status live, and create first deadline) */
export async function startDraft({ leagueId }) {
  const ref = doc(db, "leagues", leagueId);
  const now = Date.now();
  await updateDoc(ref, {
    "draft.status": "live",
    "draft.deadline": now + PICK_CLOCK_MS
  });
}

/** End draft */
export async function endDraft({ leagueId }) {
  await updateDoc(doc(db, "leagues", leagueId), {
    "draft.status": "done",
    "settings.lockAddDuringDraft": false
  });
}

/** Pick helper: writes claim + puts into roster slot or bench */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  const lref = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(lref);
  if (!leagueSnap.exists()) throw new Error("League not found");
  const league = leagueSnap.data();

  if (!canDraft(league)) throw new Error("Draft is not live");

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const onClock = order[ptr] || null;
  if (onClock !== username) throw new Error("Not your turn");

  // reserve claim
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  // ensure team doc
  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.data() || { roster: emptyRoster(), bench: [] };

  // Decide target slot
  const r = team.roster || {};
  let targetSlot = slot;
  if (!targetSlot) {
    // pick a best slot based on position & current roster state
    if (playerPosition === "RB") {
      targetSlot = r.RB1 ? (r.RB2 ? "FLEX" : "RB2") : "RB1";
    } else if (playerPosition === "WR") {
      targetSlot = r.WR1 ? (r.WR2 ? "FLEX" : "WR2") : "WR1";
    } else {
      targetSlot = defaultSlotForPosition(playerPosition);
    }
  }

  // If chosen starter slot is filled, drop to bench
  let benchInsert = false;
  if (targetSlot !== "FLEX" && r[targetSlot]) {
    benchInsert = true;
  } else if (targetSlot === "FLEX" && r.FLEX) {
    benchInsert = true;
  }

  const batch = writeBatch(db);

  // write claim (ownership)
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  // update team roster/bench
  const newTeam = { ...team };
  if (benchInsert) {
    newTeam.bench = Array.isArray(newTeam.bench) ? [...newTeam.bench] : [];
    newTeam.bench.push(playerId);
  } else {
    newTeam.roster = { ...(newTeam.roster || emptyRoster()) };
    newTeam.roster[targetSlot] = playerId;
  }
  batch.set(teamRef, newTeam, { merge: true });

  // advance draft pointer, round, picksTaken, and set next deadline
  const teamsCount = leagueDraftTeamCount(league);
  let picksTaken = Number(league?.draft?.picksTaken || 0) + 1;
  let round = Number(league?.draft?.round || 1);
  let pointer = ptr + 1;
  let direction = Number(league?.draft?.direction || 1);

  if (pointer >= teamsCount) {
    // end of a round -> snake direction & reset pointer accordingly
    pointer = teamsCount - 1;
    direction = -1;
  }
  if (pointer < 0) {
    pointer = 0;
    direction = 1;
    round += 1;
  }

  // Compute pointer by moving one step in current direction from previous onClock
  // Simpler approach: compute global pick index then map to serpentine position.
  // But since we only need 12 rounds quick, we will alternate direction by round:
  const globalPickIndex = picksTaken; // after adding current pick
  if (globalPickIndex % teamsCount === 0) {
    // just completed a set; flip direction & increment round if needed
    direction = direction * -1;
    if (direction === 1) round += 1;
  }
  // Compute next pointer based on round direction:
  const mod = picksTaken % teamsCount;
  pointer = (direction === 1) ? mod : (teamsCount - 1 - mod);

  // Done when picksTaken reaches roundsTotal * teamCount
  const roundsTotal = Number(league?.draft?.roundsTotal || DRAFT_ROUNDS_TOTAL);
  const doneAll = picksTaken >= (roundsTotal * teamsCount);

  const nextDeadline = doneAll ? null : (Date.now() + PICK_CLOCK_MS);

  batch.update(lref, {
    "draft.pointer": Math.max(0, Math.min(teamsCount - 1, pointer)),
    "draft.direction": direction,
    "draft.round": Math.max(1, round),
    "draft.picksTaken": picksTaken,
    "draft.deadline": nextDeadline,
    "draft.status": doneAll ? "done" : "live",
  });

  await batch.commit();
}

/** Auto-pick top available (by projection for currentWeek) */
export async function autoPickBestAvailable({ leagueId, currentWeek }) {
  const league = await getLeague(leagueId);
  if (!canDraft(league)) return;

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const username = order[ptr];
  if (!username) return;

  // Find available players
  const players = await listPlayers({ leagueId });
  const claimsSnap = await getDocs(collection(db, "leagues", leagueId, "claims"));
  const owned = new Set();
  claimsSnap.forEach((d) => owned.add(d.id));

  const available = players.filter(p => !owned.has(p.id));
  available.sort((a,b) => (projForWeek(b, currentWeek) - projForWeek(a, currentWeek)));

  const pick = available[0];
  if (!pick) {
    // nothing left -> just advance pointer to end draft
    await draftPick({ leagueId, username, playerId: "NOPLAYER", playerPosition: "FLEX", slot: "FLEX" }).catch(()=>{});
    return;
  }
  await draftPick({ leagueId, username, playerId: pick.id, playerPosition: pick.position, slot: null });
}

/** Projection helper: reads supported shapes on player doc */
export function projForWeek(p, week) {
  const wStr = String(week);
  if (p?.projections && p.projections[wStr] != null) return Number(p.projections[wStr]) || 0;
  if (p?.projections && p.projections[week] != null) return Number(p.projections[week]) || 0;
  if (p?.projByWeek && p.projByWeek[wStr] != null) return Number(p.projByWeek[wStr]) || 0;
  if (p?.projByWeek && p.projByWeek[week] != null) return Number(p.projByWeek[week]) || 0;
  const keyed = p?.[`projW${week}`];
  if (keyed != null) return Number(keyed) || 0;
  return 0;
}

/** ---------- TEAM UTILITIES: move/start/release ---------- **/

export async function moveToStarter({ leagueId, username, playerId, slot }) {
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const bench = Array.isArray(team.bench) ? [...team.bench] : [];
  const idx = bench.indexOf(playerId);
  if (idx === -1) throw new Error("Player not on bench");
  bench.splice(idx, 1);

  const roster = { ...(team.roster || emptyRoster()) };
  // if slot occupied, send previous to bench
  if (roster[slot]) bench.push(roster[slot]);
  roster[slot] = playerId;

  await updateDoc(tRef, { roster, bench });
}

export async function moveToBench({ leagueId, username, slot }) {
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const roster = { ...(team.roster || emptyRoster()) };
  const bench = Array.isArray(team.bench) ? [...team.bench] : [];

  const id = roster[slot];
  if (!id) return;
  roster[slot] = null;
  bench.push(id);

  await updateDoc(tRef, { roster, bench });
}

export async function releasePlayerAndClearSlot({ leagueId, username, playerId }) {
  // remove from bench or starter slot; and delete claim
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const roster = { ...(team.roster || emptyRoster()) };
  const bench = Array.isArray(team.bench) ? [...team.bench] : [];

  // clear from roster if present
  for (const s of Object.keys(roster)) {
    if (roster[s] === playerId) roster[s] = null;
  }
  // remove from bench
  const idx = bench.indexOf(playerId);
  if (idx >= 0) bench.splice(idx, 1);

  const batch = writeBatch(db);
  batch.set(tRef, { roster, bench }, { merge: true });
  batch.delete(doc(db, "leagues", leagueId, "claims", playerId));
  await batch.commit();
}

/** Add/drop from Players tab (blocked during draft if locked) */
export async function addDropPlayer({ leagueId, username, addId, dropId }) {
  const league = await getLeague(leagueId);
  if (league?.settings?.lockAddDuringDraft && draftActive(league)) {
    throw new Error("Add/Drop is disabled during the draft.");
  }
  const teamRef = await ensureTeam({ leagueId, username });
  const snap = await getDoc(teamRef);
  const team = snap.data() || { roster: emptyRoster(), bench: [] };

  const batch = writeBatch(db);

  if (dropId) {
    // release (also removes claim)
    const claimRef = doc(db, "leagues", leagueId, "claims", dropId);
    const roster = { ...(team.roster || emptyRoster()) };
    const bench = Array.isArray(team.bench) ? [...team.bench] : [];
    for (const s of Object.keys(roster)) if (roster[s] === dropId) roster[s] = null;
    const idx = bench.indexOf(dropId);
    if (idx >= 0) bench.splice(idx, 1);
    batch.set(teamRef, { roster, bench }, { merge: true });
    batch.delete(claimRef);
  }

  if (addId) {
    // claim & bench
    const claimRef = doc(db, "leagues", leagueId, "claims", addId);
    batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });
    const bench = Array.isArray(team.bench) ? [...team.bench] : [];
    bench.push(addId);
    batch.set(teamRef, { bench }, { merge: true });
  }

  await batch.commit();
}

/** ---------- LIST/CREATE LEAGUES (trimmed helpers) ---------- **/

export async function createLeague({ name, owner, order }) {
  const ref = await addDoc(collection(db, "leagues"), {
    name,
    owner,
    createdAt: serverTimestamp(),
    settings: {
      currentWeek: 1,
      lockAddDuringDraft: false,
    },
    draft: {
      status: "scheduled",
      order: order || [owner],
      pointer: 0,
      direction: 1,
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: null,
    }
  });
  return { id: ref.id, name, owner };
}

export async function listMyLeagues({ username }) {
  const q1 = query(collection(db, "leagues"), where("owner", "==", username));
  const s1 = await getDocs(q1);
  const out = [];
  s1.forEach((d) => out.push({ id: d.id, ...d.data() }));
  // could also query membership collections if you store members
  return out;
}
