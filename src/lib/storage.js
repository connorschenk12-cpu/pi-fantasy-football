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
import { db } from "../lib/firebase";

/**
 * =========================================================
 *  SMALL UTILITIES
 * =========================================================
 */

export function asId(x) {
  // Normalize to string id (Firestore doc.id is string; some datasets use numbers)
  if (x == null) return "";
  return typeof x === "string" ? x : String(x);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * =========================================================
 *  ROSTER / DRAFT CONSTANTS
 * =========================================================
 */

// Starters: QB, WR1, WR2, RB1, RB2, TE, FLEX, K, DEF
export const ROSTER_SLOTS = [
  "QB",
  "WR1",
  "WR2",
  "RB1",
  "RB2",
  "TE",
  "FLEX",
  "K",
  "DEF",
];

// 9 starters + 3 bench = 12 total rounds
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12
export const PICK_CLOCK_MS = 5000; // 5 second pick clock

export function emptyRoster() {
  const r = {};
  ROSTER_SLOTS.forEach((s) => (r[s] = null));
  return r;
}

function pickFirstOpen(slots, roster) {
  for (const s of slots) {
    if (!roster[s]) return s;
  }
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

/**
 * =========================================================
 *  LEAGUE / TEAM IO
 * =========================================================
 */

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

export async function listTeams(leagueId) {
  const col = collection(db, "leagues", leagueId, "teams");
  const snap = await getDocs(col);
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

export async function listMemberUsernames(leagueId) {
  const col = collection(db, "leagues", leagueId, "members");
  const snap = await getDocs(col);
  const out = [];
  snap.forEach((d) => out.push(d.id));
  return out;
}

/**
 * =========================================================
 *  LOCAL DATASET NAME MAP (fixes “players show as numbers”)
 * =========================================================
 *
 * We enrich Firestore player docs with names from src/data/players.js
 * so UI never shows numeric ids.
 */

let _localNamesCache = null;

async function getLocalPlayerNameMap() {
  if (_localNamesCache) return _localNamesCache;
  try {
    // Dynamic import so builds are okay even if file is temporarily missing
    const mod = await import("../data/players");
    const arr = (mod && (mod.default || mod.players || mod.PLAYERS)) || [];
    const m = new Map();
    for (const raw of arr) {
      const id =
        asId(raw.id ?? raw.playerId ?? raw.player_id ?? raw.PlayerID ?? raw.pid);
      if (!id) continue;
      const name =
        raw.name ??
        raw.fullName ??
        raw.playerName ??
        [raw.firstName, raw.lastName].filter(Boolean).join(" ");
      const team = raw.team ?? raw.Team ?? raw.nfl ?? raw.NFL ?? null;
      const position =
        raw.position ?? raw.pos ?? raw.Position ?? raw.POS ?? null;
      if (name) m.set(id, { name, team: team || null, position: position || null });
    }
    _localNamesCache = m;
    return m;
  } catch (e) {
    console.warn("[storage] local players dataset not found or failed to load:", e?.message || e);
    _localNamesCache = new Map();
    return _localNamesCache;
  }
}

/**
 * =========================================================
 *  PLAYERS
 * =========================================================
 */

export async function listPlayers({ leagueId }) {
  // Prefer league-local players (leagues/{id}/players)
  let arr = [];
  if (leagueId) {
    const lpRef = collection(db, "leagues", leagueId, "players");
    const lSnap = await getDocs(lpRef);
    if (!lSnap.empty) {
      lSnap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    }
  }
  // Fallback to global /players
  if (arr.length === 0) {
    const snap = await getDocs(collection(db, "players"));
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  }

  // Enrich names/position/team from local dataset if missing
  const nameMap = await getLocalPlayerNameMap();
  arr = arr.map((p) => {
    const id = asId(p.id);
    const fromLocal = nameMap.get(id);
    return {
      ...p,
      id,
      name: p.name || (fromLocal ? fromLocal.name : undefined) || String(id),
      team: p.team || (fromLocal ? fromLocal.team : undefined) || p.NFL || p.nfl || null,
      position: p.position || (fromLocal ? fromLocal.position : undefined) || p.pos || null,
    };
  });

  return arr;
}

export async function listPlayersMap({ leagueId }) {
  const arr = await listPlayers({ leagueId });
  const map = new Map();
  arr.forEach((p) => map.set(asId(p.id), p));
  return map;
}

export function playerDisplay(p) {
  if (!p) return "(empty)";
  return p.name || p.fullName || p.playerName || String(p.id) || "(unknown)";
}

/**
 * =========================================================
 *  PROJECTIONS / POINTS / OPPONENT
 * =========================================================
 */

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
  // Live stats integration could replace this; for now, mirror projections or 0 pre-season
  return projForWeek(p, week);
}

export function computeTeamPoints({ roster, week, playersMap }) {
  const lines = [];
  let total = 0;
  (ROSTER_SLOTS || []).forEach((slot) => {
    const pid = roster?.[slot] || null;
    const p = pid ? playersMap.get(asId(pid)) : null;
    const pts = p ? pointsForPlayer(p, week) : 0;
    total += Number(pts || 0);
    lines.push({ slot, playerId: pid, player: p, points: pts });
  });
  return { lines, total: Math.round(total * 10) / 10 };
}

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

/**
 * =========================================================
 *  CLAIMS (ownership)
 * =========================================================
 */

export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, d.data()));
    onChange(m);
  });
}

/**
 * =========================================================
 *  ENTRY / PAYMENTS
 * =========================================================
 */

export function hasPaidEntry(league, username) {
  return league?.entry?.enabled ? !!league?.entry?.paid?.[username] : true;
}

export async function setEntrySettings({ leagueId, enabled, amount = 0 }) {
  await updateDoc(doc(db, "leagues", leagueId), {
    entry: {
      enabled: !!enabled,
      amount: Number(amount || 0),
      paid: {}, // keep old mapping if it exists (merge in next set)
    },
  });
}

export async function payEntryForUser({ leagueId, username, amount }) {
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const entry = snap.data().entry || {};
  const required = Number(entry.amount || 0);
  if (entry.enabled && required > 0 && Number(amount) < required) {
    throw new Error(`Entry is ${required} PI`);
  }
  await updateDoc(ref, {
    [`entry.paid.${username}`]: true,
    [`entry.paidAmount.${username}`]: Number(amount || 0),
  });
}

/**
 * =========================================================
 *  DRAFT HELPERS & ACTIONS
 * =========================================================
 */

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
    settings: { ...(prev.settings || {}), lockAddDuringDraft: true },
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

/** Perform a draft pick (handles bench fallback if slot full) */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error("League not found");
  const league = leagueSnap.data();

  if (!canDraft(league)) throw new Error("Draft is not live");

  const order = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const ptr = Number.isInteger(league?.draft?.pointer) ? league.draft.pointer : 0;
  const onClock = order[ptr] || null;
  if (onClock !== username) throw new Error("Not your turn");

  // deny duplicates
  const claimRef = doc(db, "leagues", leagueId, "claims", asId(playerId));
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  // ensure team
  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists() ? teamSnap.data() : { roster: emptyRoster(), bench: [] };

  // decide slot
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

  // if filled, bench
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

  // update team
  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };
  if (sendToBench) newTeam.bench.push(asId(playerId));
  else newTeam.roster[targetSlot] = asId(playerId);
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

/** Auto-pick best available by projection for currentWeek */
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
  claimsSnap.forEach((d) => owned.add(asId(d.id)));

  const available = players.filter((p) => !owned.has(asId(p.id)));
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

/**
 * =========================================================
 *  TEAM UTILITIES (move/release/add-drop)
 * =========================================================
 */

export async function moveToStarter({ leagueId, username, playerId, slot }) {
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const bench = Array.isArray(team.bench) ? [...team.bench] : [];
  const idx = bench.indexOf(asId(playerId));
  if (idx === -1) throw new Error("Player not on bench");
  bench.splice(idx, 1);

  const roster = { ...(team.roster || emptyRoster()) };
  if (roster[slot]) bench.push(roster[slot]); // swap
  roster[slot] = asId(playerId);

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
  bench.push(asId(id));

  await updateDoc(tRef, { roster, bench });
}

export async function releasePlayerAndClearSlot({ leagueId, username, playerId }) {
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");
  const team = snap.data();

  const roster = { ...(team.roster || emptyRoster()) };
  const bench = Array.isArray(team.bench) ? [...team.bench] : [];

  for (const s of Object.keys(roster)) if (roster[s] === asId(playerId)) roster[s] = null;
  const idx = bench.indexOf(asId(playerId));
  if (idx >= 0) bench.splice(idx, 1);

  const batch = writeBatch(db);
  batch.set(tRef, { roster, bench }, { merge: true });
  batch.delete(doc(db, "leagues", leagueId, "claims", asId(playerId)));
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
    const claimRef = doc(db, "leagues", leagueId, "claims", asId(dropId));
    const roster = { ...(team.roster || emptyRoster()) };
    const bench = Array.isArray(team.bench) ? [...team.bench] : [];
    for (const s of Object.keys(roster)) if (roster[s] === asId(dropId)) roster[s] = null;
    const idx = bench.indexOf(asId(dropId));
    if (idx >= 0) bench.splice(idx, 1);
    batch.set(teamRef, { roster, bench }, { merge: true });
    batch.delete(claimRef);
  }

  if (addId) {
    const claimRef = doc(db, "leagues", leagueId, "claims", asId(addId));
    batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });
    const bench = Array.isArray(team.bench) ? [...team.bench] : [];
    bench.push(asId(addId));
    batch.set(teamRef, { bench }, { merge: true });
  }

  await batch.commit();
}

/**
 * =========================================================
 *  LEAGUE CREATION / MEMBERSHIP
 * =========================================================
 */

export async function createLeague({ name, owner, order }) {
  const ref = await addDoc(collection(db, "leagues"), {
    name,
    owner,
    createdAt: serverTimestamp(),
    settings: { currentWeek: 1, lockAddDuringDraft: false },
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

  // Owned
  const qOwned = query(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // Member (scan)
  const all = await getDocs(leaguesCol);
  for (const d of all.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) {
      if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
    }
  }
  return out;
}

/**
 * =========================================================
 *  SCHEDULE / MATCHUPS
 * =========================================================
 */

/** Simple round-robin with BYE if odd team count */
export function generateScheduleRoundRobin(usernames, totalWeeks) {
  const teams = [...new Set(usernames || [])].filter(Boolean);
  if (teams.length < 2) return [];

  const arr = [...teams];
  if (arr.length % 2 === 1) arr.push("__BYE__");
  const n = arr.length;
  const rounds = Math.min(totalWeeks || teams.length - 1, 18);
  const half = n / 2;

  let left = arr.slice(0, half);
  let right = arr.slice(half).reverse();

  const schedule = [];
  for (let week = 1; week <= rounds; week++) {
    const matchups = [];
    for (let i = 0; i < half; i++) {
      const home = left[i];
      const away = right[i];
      if (home !== "__BYE__" && away !== "__BYE__") matchups.push({ home, away });
    }
    schedule.push({ week, matchups });

    // circle method rotation
    const fixed = left[0];
    const movedFromLeft = left.splice(1, 1)[0];
    const movedFromRight = right.shift();
    left = [fixed, movedFromRight, ...left];
    right.push(movedFromLeft);
  }
  return schedule;
}

export async function writeSchedule(leagueId, schedule) {
  if (!leagueId || !Array.isArray(schedule)) throw new Error("Invalid schedule");
  const batch = writeBatch(db);
  schedule.forEach((w) => {
    const ref = doc(db, "leagues", leagueId, "schedule", `week-${w.week}`);
    batch.set(ref, w, { merge: true });
  });
  await batch.commit();
}

export function listenScheduleWeek(leagueId, week, onChange) {
  if (!leagueId || !week) return () => {};
  const ref = doc(db, "leagues", leagueId, "schedule", `week-${week}`);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? snap.data() : { week, matchups: [] });
  });
}

export async function getScheduleWeek(leagueId, week) {
  const ref = doc(db, "leagues", leagueId, "schedule", `week-${week}`);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : { week, matchups: [] };
}

export async function getScheduleAllWeeks(leagueId) {
  const colRef = collection(db, "leagues", leagueId, "schedule");
  const snap = await getDocs(colRef);
  const arr = [];
  snap.forEach((d) => arr.push(d.data()));
  arr.sort((a, b) => Number(a.week) - Number(b.week));
  return arr;
}

/** Ensure season schedule exists (or recreate). Writes week-1..N docs. */
export async function ensureSeasonSchedule({ leagueId, totalWeeks = 14, recreate = false }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const members = await listMemberUsernames(leagueId);
  if (members.length < 2) throw new Error("Need at least 2 team members to schedule.");
  const schedule = generateScheduleRoundRobin(members, totalWeeks);

  const colRef = collection(db, "leagues", leagueId, "schedule");
  const existing = await getDocs(colRef);
  const exists = !existing.empty;

  if (exists && !recreate) return { weeksCreated: [] };

  await writeSchedule(leagueId, schedule);
  return { weeksCreated: schedule.map((w) => w.week) };
}

/**
 * =========================================================
 *  SEEDERS (LOCAL → FIRESTORE)
 * =========================================================
 */

export async function seedPlayersFromLocalToLeague({ leagueId, max = 5000, overwrite = false }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const nameMap = await getLocalPlayerNameMap();
  const all = [];

  // Re-open the local dataset to get full rows (id, name, position, team, projections if present)
  try {
    const mod = await import("../data/players");
    const raw = (mod && (mod.default || mod.players || mod.PLAYERS)) || [];
    raw.forEach((r) => {
      const id = asId(r.id ?? r.playerId ?? r.player_id ?? r.PlayerID ?? r.pid);
      if (!id) return;
      const base = nameMap.get(id) || {};
      const position = r.position ?? r.pos ?? r.Position ?? base.position ?? null;
      const team = r.team ?? r.Team ?? base.team ?? null;
      const name =
        r.name ??
        r.fullName ??
        r.playerName ??
        [r.firstName, r.lastName].filter(Boolean).join(" ") ||
        base.name ||
        String(id);

      const projections =
        r.projections ||
        r.projByWeek ||
        // tolerate keyed projW1, projW2... → flatten
        (() => {
          const acc = {};
          for (let w = 1; w <= 18; w++) {
            const k1 = `projW${w}`;
            if (r[k1] != null) acc[String(w)] = Number(r[k1]) || 0;
          }
          return Object.keys(acc).length ? acc : undefined;
        })();

      all.push({
        id,
        name,
        position,
        team,
        projections: projections || {},
      });
    });
  } catch {
    // Fallback: just use names map keys
    nameMap.forEach((v, id) => {
      all.push({
        id,
        name: v.name,
        position: v.position ?? null,
        team: v.team ?? null,
        projections: {},
  });
    });
  }

  const trimmed = all.slice(0, Math.max(0, Math.min(max, all.length)));
  const batches = chunk(trimmed, 400);
  for (const group of batches) {
    const batch = writeBatch(db);
    for (const p of group) {
      const ref = doc(db, "leagues", leagueId, "players", asId(p.id));
      batch.set(ref, overwrite ? p : { ...p }, { merge: !overwrite });
    }
    await batch.commit();
  }
  return { written: trimmed.length, datasetSize: all.length };
}

/**
 * =========================================================
 *  QUALITY CHECKS / GUARDS (small helpers used by UI)
 * =========================================================
 */

export function allMembersPaid(league) {
  if (!league?.entry?.enabled) return true;
  const order = league?.draft?.order || [];
  if (order.length === 0) return false;
  for (const u of order) {
    if (!league.entry.paid || !league.entry.paid[u]) return false;
  }
  return true;
}

export function draftTabAvailable(league) {
  return league?.draft?.status !== "done";
}

export function isOwner(league, username) {
  return !!(league?.owner && username && league.owner === username);
}
