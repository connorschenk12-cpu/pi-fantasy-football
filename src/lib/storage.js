/* eslint-disable no-console */
// src/lib/storage.js
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc, onSnapshot,
  query, where, serverTimestamp, writeBatch
} from "firebase/firestore";
import { db } from "../firebase";

/** =========================
 *  ROSTER / DRAFT CONSTANTS
 *  ========================= */
export const ROSTER_SLOTS = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];

// 9 starters + 3 bench = 12 total rounds
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12

// Five-second pick clock
export const PICK_CLOCK_MS = 5000;

/** Create an empty roster object that includes all starter slots */
export function emptyRoster() {
  const r = {};
  ROSTER_SLOTS.forEach((s) => (r[s] = null));
  return r;
}

/** Pick the first open slot from a list */
function pickFirstOpen(slots, roster) {
  for (const s of slots) {
    if (!roster[s]) return s;
  }
  return null;
}

/** Resolve a default slot for a given position, based on current roster */
export function defaultSlotForPosition(pos, roster = {}) {
  const p = String(pos || "").toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB") return pickFirstOpen(["RB1", "RB2"], roster) || "FLEX";
  if (p === "WR") return pickFirstOpen(["WR1", "WR2"], roster) || "FLEX";
  if (p === "TE") return "TE";
  if (p === "K") return "K";
  if (p === "DEF") return "DEF";
  return "FLEX";
}

/** =========================
 *  LEAGUE / TEAM LISTENERS
 *  ========================= */
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
    await setDoc(
      ref,
      {
        owner: username,
        roster: emptyRoster(),
        bench: [],
        wins: 0,
        losses: 0,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  return ref;
}

export function listenTeam({ leagueId, username, onChange }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** =========================
 *  PLAYERS & CLAIMS
 *  ========================= */
export async function listPlayers({ leagueId }) {
  // Try league-scoped players first
  const leaguePlayersRef = collection(db, "leagues", leagueId, "players");
  const leagueSnap = await getDocs(leaguePlayersRef);
  if (!leagueSnap.empty) {
    const arr = [];
    leagueSnap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    return arr;
  }
  // Fallback to global players
  const snap = await getDocs(collection(db, "players"));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, d.data()));
    onChange(m);
  });
}

/** =========================
 *  ENTRY / PAYMENTS GATE
 *  ========================= */
export function hasPaidEntry(league, username) {
  return league?.entry?.enabled ? !!league?.entry?.paid?.[username] : true;
}

/** =========================
 *  DRAFT STATE HELPERS
 *  ========================= */
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
export function leagueDraftTeamCount(league) {
  return Math.max(1, Array.isArray(league?.draft?.order) ? league.draft.order.length : 1);
}
export function currentRound(league) {
  const picksTaken = Number(league?.draft?.picksTaken || 0);
  return Math.min(
    Math.floor(picksTaken / leagueDraftTeamCount(league)) + 1,
    DRAFT_ROUNDS_TOTAL
  );
}

export async function setDraftStatus({ leagueId, status }) {
  await updateDoc(doc(db, "leagues", leagueId), { "draft.status": status });
}

/** Configure draft (scheduled) with an explicit order */
export async function configureDraft({ leagueId, order }) {
  const lref = doc(db, "leagues", leagueId);
  const snap = await getDoc(lref);
  const prev = snap.exists() ? snap.data() : {};
  await updateDoc(lref, {
    draft: {
      status: "scheduled",
      order: Array.isArray(order) && order.length ? order : prev?.draft?.order || [],
      pointer: 0,
      direction: 1,
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: null,
    },
    settings: {
      ...(prev.settings || {}),
      lockAddDuringDraft: true, // block adds during draft
    },
  });
}

/** Start draft: set status live + start the timer */
export async function startDraft({ leagueId }) {
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    "draft.status": "live",
    "draft.deadline": Date.now() + PICK_CLOCK_MS,
  });
}

/** End draft: unlock adds */
export async function endDraft({ leagueId }) {
  await updateDoc(doc(db, "leagues", leagueId), {
    "draft.status": "done",
    "settings.lockAddDuringDraft": false,
  });
}

/** Perform a draft pick (handles bench fallback if slot full) */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  // Load league
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error("League not found");
  const league = leagueSnap.data();

  if (!canDraft(league)) throw new Error("Draft is not live");

  // Whose turn?
  const order = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const ptr = Number.isInteger(league?.draft?.pointer) ? league.draft.pointer : 0;
  const onClock = order[ptr] || null;
  if (onClock !== username) throw new Error("Not your turn");

  // Deny duplicate claims
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  // Ensure team
  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists()
    ? teamSnap.data()
    : { roster: emptyRoster(), bench: [] };

  // Decide target slot
  const rosterCopy = { ...(team.roster || emptyRoster()) };
  let targetSlot = slot;
  if (!targetSlot) {
    const pos = String(playerPosition || "").toUpperCase();
    if (pos === "RB") {
      targetSlot = rosterCopy.RB1 ? (rosterCopy.RB2 ? "FLEX" : "RB2") : "RB1";
    } else if (pos === "WR") {
      targetSlot = rosterCopy.WR1 ? (rosterCopy.WR2 ? "FLEX" : "WR2") : "WR1";
    } else {
      targetSlot = defaultSlotForPosition(pos, rosterCopy);
    }
  }

  // If chosen starter slot is filled, drop to bench
  let sendToBench = false;
  if (targetSlot !== "FLEX" && rosterCopy[targetSlot]) sendToBench = true;
  if (targetSlot === "FLEX" && rosterCopy.FLEX) sendToBench = true;

  const batch = writeBatch(db);

  // claim ownership
  batch.set(
    claimRef,
    { claimedBy: username, at: serverTimestamp() },
    { merge: true }
  );

  // put onto team
  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };

  if (sendToBench) {
    newTeam.bench.push(playerId);
  } else {
    newTeam.roster[targetSlot] = playerId;
  }
  batch.set(teamRef, newTeam, { merge: true });

  // advance pointer, track picks & round, set next deadline
  const teamsCount = Math.max(1, Array.isArray(order) ? order.length : 1);
  const prevPicks = Number(league?.draft?.picksTaken || 0);
  const picksTaken = prevPicks + 1;
  const roundsTotal = Number(league?.draft?.roundsTotal || DRAFT_ROUNDS_TOTAL);

  // Compute next pointer in snake fashion based on global pick index
  const mod = picksTaken % teamsCount;
  const round = Math.floor(picksTaken / teamsCount) + 1;
  const direction = round % 2 === 1 ? 1 : -1; // odd round: forward, even round: reverse
  const pointer = direction === 1 ? mod : teamsCount - 1 - mod;

  const doneAll = picksTaken >= roundsTotal * teamsCount;
  const nextDeadline = doneAll ? null : Date.now() + PICK_CLOCK_MS;

  batch.update(leagueRef, {
    "draft.pointer": Math.max(0, Math.min(teamsCount - 1, pointer)),
    "draft.direction": direction,
    "draft.round": Math.max(1, Math.min(roundsTotal, round)),
    "draft.picksTaken": picksTaken,
    "draft.deadline": nextDeadline,
    "draft.status": doneAll ? "done" : "live",
  });

  await batch.commit();
}

/** Projection reader tolerant to a few shapes */
export function projForWeek(p, week) {
  const w = String(week);
  if (p?.projections && p.projections[w] != null) return Number(p.projections[w]) || 0;
  if (p?.projections && p.projections[week] != null) return Number(p.projections[week]) || 0;
  if (p?.projByWeek && p.projByWeek[w] != null) return Number(p.projByWeek[w]) || 0;
  if (p?.projByWeek && p.projByWeek[week] != null) return Number(p.projByWeek[week]) || 0;
  const keyed = p?.[`projW${week}`];
  if (keyed != null) return Number(keyed) || 0;
  return 0;
}

/** Auto-pick: highest projection for currentWeek among available players */
export async function autoPickBestAvailable({ leagueId, currentWeek }) {
  const league = await getLeague(leagueId);
  if (!canDraft(league)) return;

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const username = order[ptr];
  if (!username) return;

  const players = await listPlayers({ leagueId });
  const claimsSnap = await getDocs(collection(db, "leagues", leagueId, "claims"));
  const owned = new Set();
  claimsSnap.forEach((d) => owned.add(d.id));

  const available = players.filter((p) => !owned.has(p.id));
  available.sort(
    (a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek)
  );

  const pick = available[0];
  if (!pick) return;

  await draftPick({
    leagueId,
    username,
    playerId: pick.id,
    playerPosition: pick.position,
    slot: null,
  });
}

/** =========================
 *  TEAM UTILITIES (move/release/add-drop)
 *  ========================= */
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
  if (roster[slot]) bench.push(roster[slot]); // swap to bench if occupied
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
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const roster = { ...(team.roster || emptyRoster()) };
  const bench = Array.isArray(team.bench) ? [...team.bench] : [];

  // clear from roster
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

/** Add/Drop (disabled during live draft if locked) */
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
    // release (also deletes claim)
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
    const claimRef = doc(db, "leagues", leagueId, "claims", addId);
    batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });
    const bench = Array.isArray(team.bench) ? [...team.bench] : [];
    bench.push(addId);
    batch.set(teamRef, { bench }, { merge: true });
  }

  await batch.commit();
}

/** =========================
 *  LEAGUE CREATION / MEMBERSHIP
 *  ========================= */
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
      order: Array.isArray(order) && order.length ? order : [owner],
      pointer: 0,
      direction: 1,
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: null,
    },
  });
  return { id: ref.id, name, owner };
}

/** Join a league (adds membership doc + ensures team) */
export async function joinLeague({ leagueId, username }) {
  if (!leagueId || !username) throw new Error("leagueId and username are required");

  // Add membership: leagues/{leagueId}/members/{username}
  const memRef = doc(db, "leagues", leagueId, "members", username);
  const memSnap = await getDoc(memRef);
  if (!memSnap.exists()) {
    await setDoc(memRef, { username, joinedAt: serverTimestamp() }, { merge: true });
  }

  // Ensure team exists
  await ensureTeam({ leagueId, username });

  // (Optional) reverse index at users/{username}/memberships/{leagueId}
  return true;
}

/** list leagues the user owns OR has joined */
export async function listMyLeagues({ username }) {
  const leaguesCol = collection(db, "leagues");

  // Owned
  const qOwned = query(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // Joined (scan leagues for membership doc — fine for small N)
  const allLeagues = await getDocs(leaguesCol);
  for (const d of allLeagues.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) {
      if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
    }
  }

  return out;
}

/** =========================
 *  TEAMS / RECORDS / SCHEDULE (NEW)
 *  ========================= */

/** Return all teams in a league with safe defaults for wins/losses */
export async function listTeams(leagueId) {
  const teamsCol = collection(db, "leagues", leagueId, "teams");
  const snap = await getDocs(teamsCol);
  const out = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    out.push({
      id: d.id,
      owner: data.owner || d.id,
      name: data.name || data.owner || d.id,
      roster: data.roster || {},
      bench: Array.isArray(data.bench) ? data.bench : [],
      wins: Number(data.wins || 0),
      losses: Number(data.losses || 0),
    });
  });
  return out;
}

/**
 * Generate a single round-robin schedule for N teams.
 * Writes to: leagues/{leagueId}/schedule/{weekNumber} -> { week, matchups: [{home, away}] }
 * Teams are usernames (team doc IDs).
 */
export async function generateScheduleRoundRobin(leagueId) {
  const teams = await listTeams(leagueId);
  const ids = teams.map((t) => t.id);
  if (ids.length < 2) throw new Error("Need at least 2 teams to schedule");

  // Circle method (single round-robin)
  const arr = [...ids];
  const bye = arr.length % 2 !== 0 ? "__BYE__" : null;
  if (bye) arr.push(bye);

  const n = arr.length;
  const rounds = n - 1;
  let left = arr.slice(0, n / 2);
  let right = arr.slice(n / 2).reverse();

  const weeks = [];
  for (let r = 0; r < rounds; r++) {
    const pairings = [];
    for (let i = 0; i < left.length; i++) {
      const home = left[i];
      const away = right[i];
      if (home !== "__BYE__" && away !== "__BYE__") {
        pairings.push({ home, away });
      }
    }
    weeks.push(pairings);

    // rotate
    const l0 = left[0];
    const r0 = right[0];
    right.shift();
    left.splice(1, 0, r0);
    right.push(left.pop());
    left[0] = l0;
  }

  // Write schedule docs
  const batch = writeBatch(db);
  weeks.forEach((matchups, idx) => {
    const wk = idx + 1;
    const wref = doc(db, "leagues", leagueId, "schedule", String(wk));
    batch.set(wref, { week: wk, matchups }, { merge: true });
  });
  await batch.commit();
}

/** Listen to one week’s schedule (matchups) */
export function listenScheduleWeek(leagueId, week, onChange) {
  const wref = doc(db, "leagues", leagueId, "schedule", String(week));
  return onSnapshot(wref, (snap) => {
    if (!snap.exists()) return onChange({ week, matchups: [] });
    const data = snap.data() || {};
    onChange({ week: Number(data.week || week), matchups: data.matchups || [] });
  });
}

/**
 * Save a result for a matchup and update records.
 * result: { week, home, away, homePoints, awayPoints }
 * Writes result to: leagues/{leagueId}/results/{week}_{home}_{away}
 * Updates wins/losses on each team doc.
 */
export async function saveMatchResult(leagueId, result) {
  const { week, home, away, homePoints, awayPoints } = result;
  if (!week || !home || !away) throw new Error("Missing result fields");
  const rid = `${week}_${home}_${away}`;
  const rref = doc(db, "leagues", leagueId, "results", rid);

  const homeRef = doc(db, "leagues", leagueId, "teams", home);
  const awayRef = doc(db, "leagues", leagueId, "teams", away);
  const [homeSnap, awaySnap] = await Promise.all([getDoc(homeRef), getDoc(awayRef)]);
  const h = homeSnap.data() || {};
  const a = awaySnap.data() || {};

  let hW = Number(h.wins || 0), hL = Number(h.losses || 0);
  let aW = Number(a.wins || 0), aL = Number(a.losses || 0);

  if (Number(homePoints) > Number(awayPoints)) hW += 1;
  else if (Number(awayPoints) > Number(homePoints)) aW += 1;
  else {
    // If you want ties, change logic. For now, award away the win on ties.
    aW += 1;
  }

  const batch = writeBatch(db);
  batch.set(rref, {
    week,
    home, away,
    homePoints: Number(homePoints || 0),
    awayPoints: Number(awayPoints || 0),
    savedAt: serverTimestamp()
  }, { merge: true });

  batch.set(homeRef, { wins: hW, losses: hL }, { merge: true });
  batch.set(awayRef, { wins: aW, losses: aL }, { merge: true });
  await batch.commit();
}
/** =========================
 *  MATCHUPS / LIVE SCORING HELPERS
 *  ========================= */

/** Listen to any team by id (not only current user) */
export function listenTeamById(leagueId, teamId, onChange) {
  if (!leagueId || !teamId) return () => {};
  const ref = doc(db, "leagues", leagueId, "teams", teamId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/** Fetch all players (league-scoped first, then global) as a map id -> player */
export async function listPlayersMap({ leagueId }) {
  const arr = await listPlayers({ leagueId });
  const map = new Map();
  arr.forEach((p) => map.set(p.id, p));
  return map;
}

/** Friendly player name for rendering */
export function playerDisplay(p) {
  if (!p) return "(empty)";
  return p.name || p.fullName || p.playerName || p.id || "(unknown)";
}

/** Points for a single player for a given week (uses projections for now) */
export function pointsForPlayer(p, week) {
  // Uses your existing proj reader. Later you can swap to live stats seamlessly.
  return projForWeek(p, week);
}

/** Compute starter lines and total for a team roster */
export function computeTeamPoints({ roster, week, playersMap }) {
  const lines = [];
  let total = 0;
  (ROSTER_SLOTS || []).forEach((slot) => {
    const pid = roster?.[slot] || null;
    const p = pid ? playersMap.get(pid) : null;
    const pts = p ? pointsForPlayer(p, week) : 0;
    total += Number(pts || 0);
    lines.push({ slot, playerId: pid, player: p, points: pts });
  });
  return { lines, total: Math.round(total * 100) / 100 };
}
