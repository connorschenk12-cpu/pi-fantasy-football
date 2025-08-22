/* eslint-disable no-console */
// src/lib/storage.js
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

/* =========================================================
 *  ROSTER / DRAFT CONSTANTS
 * ======================================================= */

// Starters: QB, WR1, WR2, RB1, RB2, TE, FLEX, K, DEF
export const ROSTER_SLOTS = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];

// 9 starters + 3 bench = 12 total rounds
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12
export const PICK_CLOCK_MS = 5000; // 5 seconds per pick

export function emptyRoster() {
  const r = {};
  ROSTER_SLOTS.forEach((s) => (r[s] = null));
  return r;
}

function pickFirstOpen(slots, roster) {
  for (const s of slots) if (!roster[s]) return s;
  return null;
}

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

/* =========================================================
 *  OPPONENT / TEAMS UTIL
 * ======================================================= */

export function opponentForWeek(p, week) {
  if (!p || week == null) return "";
  const w = String(week);

  const m = p?.matchups?.[w] ?? p?.matchups?.[week] ?? null;
  if (m && (m.opp || m.opponent)) return m.opp || m.opponent;

  if (p?.oppByWeek && p.oppByWeek[w] != null) return p.oppByWeek[w];
  if (p?.opponentByWeek && p.opponentByWeek[w] != null) return p.opponentByWeek[w];

  if (p?.[`oppW${w}`] != null) return p[`oppW${w}`];
  if (p?.[`opponentW${w}`] != null) return p[`opponentW${w}`];

  return "";
}

export async function listTeams(leagueId) {
  const col = collection(db, "leagues", leagueId, "teams");
  const snap = await getDocs(col);
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

/* =========================================================
 *  LEAGUE / TEAM READ & LISTEN
 * ======================================================= */

export function listenLeague(leagueId, onChange) {
  if (!leagueId) return () => {};
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
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
        name: username,
        roster: emptyRoster(),
        bench: [],
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  return ref;
}

export function listenTeam({ leagueId, username, onChange }) {
  if (!leagueId || !username) return () => {};
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export function listenTeamById(leagueId, teamId, onChange) {
  if (!leagueId || !teamId) return () => {};
  const ref = doc(db, "leagues", leagueId, "teams", teamId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/* =========================================================
 *  MEMBERS
 * ======================================================= */

export async function listMembers(leagueId) {
  const colRef = collection(db, "leagues", leagueId, "members");
  const snap = await getDocs(colRef);
  const arr = [];
  snap.forEach((d) => arr.push(d.id)); // username as doc id
  return arr;
}

// Back-compat alias for components importing listMemberUsernames
export async function listMemberUsernames(leagueId) {
  return await listMembers(leagueId);
}

/* =========================================================
 *  PLAYERS
 * ======================================================= */

export async function listPlayers({ leagueId }) {
  // League-level players override global players if present
  if (leagueId) {
    const leaguePlayersRef = collection(db, "leagues", leagueId, "players");
    const leagueSnap = await getDocs(leaguePlayersRef);
    if (!leagueSnap.empty) {
      const arr = [];
      leagueSnap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      return arr;
    }
  }
  const snap = await getDocs(collection(db, "players"));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function listPlayersMap({ leagueId }) {
  const arr = await listPlayers({ leagueId });
  const map = new Map();
  arr.forEach((p) => map.set(p.id, p));
  return map;
}

export function playerDisplay(p) {
  if (!p) return "(empty)";
  return p.name || p.fullName || p.playerName || String(p.id) || "(unknown)";
}

/** Projections tolerant to multiple shapes */
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

export function pointsForPlayer(p, week) {
  return projForWeek(p, week);
}

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

/** Ownership map for draft/add/drop */
export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, d.data()));
    onChange(m);
  });
}

/* =========================================================
 *  ENTRY / PAYMENTS (simple gate)
 * ======================================================= */

export function hasPaidEntry(league, username) {
  return league?.entry?.enabled ? !!league?.entry?.paid?.[username] : true;
}

/* =========================================================
 *  DRAFT HELPERS
 * ======================================================= */

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
  return Math.min(Math.floor(picksTaken / leagueDraftTeamCount(league)) + 1, DRAFT_ROUNDS_TOTAL);
}

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
      lockAddDuringDraft: true,
    },
  });
}

export async function initDraftOrder({ leagueId }) {
  const memCol = collection(db, "leagues", leagueId, "members");
  const memSnap = await getDocs(memCol);
  const members = [];
  memSnap.forEach((d) => members.push(d.id));
  if (members.length === 0) throw new Error("No members to seed draft order.");
  await configureDraft({ leagueId, order: members });
  return members;
}

export async function startDraft({ leagueId }) {
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    "draft.status": "live",
    "draft.deadline": Date.now() + PICK_CLOCK_MS,
  });
}

export async function endDraft({ leagueId }) {
  await updateDoc(doc(db, "leagues", leagueId), {
    "draft.status": "done",
    "draft.deadline": null,
    "settings.lockAddDuringDraft": false,
  });
}

export async function setDraftStatus({ leagueId, status }) {
  const allowed = new Set(["scheduled", "live", "done"]);
  if (!allowed.has(status)) throw new Error("Invalid status");
  await updateDoc(doc(db, "leagues", leagueId), { "draft.status": status });
}

/** Draft pick with bench fallback if slot filled */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error("League not found");
  const league = leagueSnap.data();

  if (!canDraft(league)) throw new Error("Draft is not live");

  // turn check
  const order = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const ptr = Number.isInteger(league?.draft?.pointer) ? league.draft.pointer : 0;
  const onClock = order[ptr] || null;
  if (onClock !== username) throw new Error("Not your turn");

  // duplicate check
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  // team
  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists() ? teamSnap.data() : { roster: emptyRoster(), bench: [] };

  // target slot
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

  // if slot full → bench
  let sendToBench = false;
  if (targetSlot !== "FLEX" && rosterCopy[targetSlot]) sendToBench = true;
  if (targetSlot === "FLEX" && rosterCopy.FLEX) sendToBench = true;

  const batch = writeBatch(db);

  // claim
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  // update team
  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };
  if (sendToBench) newTeam.bench.push(playerId);
  else newTeam.roster[targetSlot] = playerId;

  batch.set(teamRef, newTeam, { merge: true });

  // advance pointer (snake)
  const teamsCount = Math.max(1, Array.isArray(order) ? order.length : 1);
  const prevPicks = Number(league?.draft?.picksTaken || 0);
  const picksTaken = prevPicks + 1;
  const roundsTotal = Number(league?.draft?.roundsTotal || DRAFT_ROUNDS_TOTAL);

  const mod = picksTaken % teamsCount;
  const round = Math.floor(picksTaken / teamsCount) + 1;
  const direction = round % 2 === 1 ? 1 : -1;
  const pointer = direction === 1 ? mod : teamsCount - 1 - mod;

  const doneAll = picksTaken >= roundsTotal * teamsCount;
  const nextDeadline = doneAll ? null : Date.now() + (Number(league?.draft?.clockMs) || PICK_CLOCK_MS);

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

/** Best available (by projections) for auto-pick */
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
  available.sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));

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

/** Auto-draft if the pick clock has expired */
export async function autoDraftIfExpired({ leagueId, currentWeek = 1 }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) return { acted: false, reason: "no-league" };
  const league = leagueSnap.data();

  if (!canDraft(league)) return { acted: false, reason: "not-live" };

  const now = Date.now();
  const clockMs = Number(league?.draft?.clockMs || PICK_CLOCK_MS);
  const deadline = Number(league?.draft?.deadline || 0);

  if (!deadline) {
    await updateDoc(leagueRef, { "draft.deadline": now + clockMs });
    return { acted: true, reason: "set-deadline" };
  }
  if (now < deadline) return { acted: false, reason: "not-expired" };

  await autoPickBestAvailable({ leagueId, currentWeek });

  const postSnap = await getDoc(leagueRef);
  if (!postSnap.exists()) return { acted: true, reason: "post-missing" };
  const post = postSnap.data();

  const teamsCount = leagueDraftTeamCount(post);
  const picksTaken = Number(post?.draft?.picksTaken || 0);
  const roundsTotal = Number(post?.draft?.roundsTotal || DRAFT_ROUNDS_TOTAL);
  const doneAll = picksTaken >= roundsTotal * teamsCount;

  await updateDoc(leagueRef, {
    "draft.deadline": doneAll ? null : Date.now() + Number(post?.draft?.clockMs || PICK_CLOCK_MS),
    ...(doneAll ? { "draft.status": "done" } : {}),
  });

  return { acted: true, reason: doneAll ? "finished" : "auto-picked" };
}

/* =========================================================
 *  TEAM UTILITIES (move / bench / release / add-drop)
 * ======================================================= */

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
  if (roster[slot]) bench.push(roster[slot]); // swap down if occupied
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

  for (const s of Object.keys(roster)) {
    if (roster[s] === playerId) roster[s] = null;
  }
  const idx = bench.indexOf(playerId);
  if (idx >= 0) bench.splice(idx, 1);

  const batch = writeBatch(db);
  batch.set(tRef, { roster, bench }, { merge: true });
  batch.delete(doc(db, "leagues", leagueId, "claims", playerId));
  await batch.commit();
}

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

/* =========================================================
 *  LEAGUE CREATION / MEMBERSHIP
 * ======================================================= */

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
    standings: {
      [owner]: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    },
  });
  await setDoc(doc(db, "leagues", ref.id, "members", owner), {
    username: owner,
    joinedAt: serverTimestamp(),
  });
  await ensureTeam({ leagueId: ref.id, username: owner });
  return { id: ref.id, name, owner };
}

export async function joinLeague({ leagueId, username }) {
  if (!leagueId || !username) throw new Error("leagueId and username are required");
  const memRef = doc(db, "leagues", leagueId, "members", username);
  const memSnap = await getDoc(memRef);
  if (!memSnap.exists()) {
    await setDoc(memRef, { username, joinedAt: serverTimestamp() }, { merge: true });
  }
  await ensureTeam({ leagueId, username });
  return true;
}

export async function listMyLeagues({ username }) {
  const leaguesCol = collection(db, "leagues");

  // leagues I own
  const qOwned = query(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // leagues I joined
  const allLeagues = await getDocs(leaguesCol);
  for (const d of allLeagues.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) {
      if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
    }
  }
  return out;
}

/* =========================================================
 *  SCHEDULE / MATCHUPS
 * ======================================================= */

/** Simple round-robin generator. Returns [{week, matchups:[{home,away}]}...] */
export function generateScheduleRoundRobin(usernames, totalWeeks) {
  const teams = [...new Set(usernames || [])].filter(Boolean);
  if (teams.length < 2) return [];

  const rounds = Math.min(totalWeeks || teams.length - 1, 18);
  const schedule = [];

  // pad to even with BYE
  const arr = [...teams];
  if (arr.length % 2 === 1) arr.push("__BYE__");
  const n = arr.length;
  const half = n / 2;

  let left = arr.slice(0, half);
  let right = arr.slice(half).reverse();

  for (let week = 1; week <= rounds; week++) {
    const matchups = [];
    for (let i = 0; i < half; i++) {
      const home = left[i];
      const away = right[i];
      if (home !== "__BYE__" && away !== "__BYE__") {
        matchups.push({ home, away });
      }
    }
    schedule.push({ week, matchups });

    // rotate (circle method)
    const fixed = left[0];
    const moveFromLeft = left.splice(1, 1)[0];
    const moveFromRight = right.pop();
    left.push(moveFromRight);
    right.unshift(moveFromLeft);
    left[0] = fixed;
  }
  return schedule;
}

/** Write schedule docs under leagues/{leagueId}/schedule/week-{n} */
export async function writeSchedule(leagueId, schedule) {
  if (!leagueId || !Array.isArray(schedule)) throw new Error("Invalid schedule");
  const batch = writeBatch(db);
  schedule.forEach((w) => {
    const ref = doc(db, "leagues", leagueId, "schedule", `week-${w.week}`);
    batch.set(ref, w, { merge: true });
  });
  await batch.commit();
}

/** Read schedule for a given week (one doc per week) */
export async function getScheduleWeek(leagueId, week) {
  const ref = doc(db, "leagues", leagueId, "schedule", `week-${week}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : { week, matchups: [] };
}

/** Live listen to a week schedule */
export function listenScheduleWeek(leagueId, week, onChange) {
  if (!leagueId || !week) return () => {};
  const ref = doc(db, "leagues", leagueId, "schedule", `week-${week}`);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? snap.data() : { week, matchups: [] });
  });
}

/** Ensure a season schedule exists (idempotent). Returns schedule array. */
export async function ensureSeasonSchedule(leagueId, totalWeeks = 14) {
  if (!leagueId) throw new Error("leagueId required");

  // If week-1 exists with matchups, assume schedule already created
  const wk1Ref = doc(db, "leagues", leagueId, "schedule", "week-1");
  const wk1Snap = await getDoc(wk1Ref);
  if (wk1Snap.exists() && Array.isArray(wk1Snap.data()?.matchups) && wk1Snap.data().matchups.length) {
    // Already present — return the first few weeks to the caller
    const arr = [];
    for (let w = 1; w <= totalWeeks; w++) {
      const s = await getScheduleWeek(leagueId, w);
      arr.push(s);
    }
    return arr;
  }

  // Build from members
  const members = await listMembers(leagueId);
  if (members.length < 2) throw new Error("Need at least 2 members to create a schedule");

  const schedule = generateScheduleRoundRobin(members, totalWeeks);
  await writeSchedule(leagueId, schedule);
  return schedule;
}

/** Optional: record a final result */
export async function setMatchupResult({ leagueId, week, home, away, homePts, awayPts }) {
  const ref = doc(db, "leagues", leagueId, "results", `week-${week}_${home}_vs_${away}`);
  await setDoc(
    ref,
    { leagueId, week, home, away, homePts, awayPts, at: serverTimestamp() },
    { merge: true }
  );
}
