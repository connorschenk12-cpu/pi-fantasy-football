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
  query as fsQuery,
  where,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

// Optional local dataset fallback so player names don't appear as numbers
// Make sure this file exists: src/data/players.js and exports an array of objects:
// [{ id: "123", name: "Patrick Mahomes", position: "QB", team: "KC", projections: {"1": 25.1, ...}, ...}, ...]
import localPlayersArr from "../data/players";

/* ======================================================================================
   SMALL UTILITIES
   ====================================================================================== */

export function asId(x) {
  if (x == null) return "";
  return typeof x === "string" ? x : String(x);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* Build a quick local map for name/position/team fallback */
const LOCAL_PLAYERS_MAP = (() => {
  const m = new Map();
  try {
    (localPlayersArr || []).forEach((p) => {
      if (!p || p.id == null) return;
      m.set(asId(p.id), p);
    });
  } catch (e) {
    // ignore
  }
  return m;
})();

/* ======================================================================================
   ROSTER / DRAFT CONSTANTS
   ====================================================================================== */

// Starters: QB, WR1, WR2, RB1, RB2, TE, FLEX, K, DEF
export const ROSTER_SLOTS = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];

// 9 starters + 3 bench = 12 rounds
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12
export const PICK_CLOCK_MS = 5000; // 5s auto-pick clock

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

/* ======================================================================================
   LEAGUE / TEAM IO
   ====================================================================================== */

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

/* ======================================================================================
   PLAYERS (with local fallback so names don't show as numbers)
   ====================================================================================== */

export async function listPlayers({ leagueId }) {
  // Prefer league-local players collection if present
  if (leagueId) {
    const lpRef = collection(db, "leagues", leagueId, "players");
    const lSnap = await getDocs(lpRef);
    if (!lSnap.empty) {
      const arr = [];
      lSnap.forEach((d) => arr.push(ensureDisplayFields({ id: asId(d.id), ...d.data() })));
      return arr;
    }
  }

  // Fall back to global "players" collection
  const snap = await getDocs(collection(db, "players"));
  const out = [];
  snap.forEach((d) => out.push(ensureDisplayFields({ id: asId(d.id), ...d.data() })));
  return out;
}

export async function listPlayersMap({ leagueId }) {
  const arr = await listPlayers({ leagueId });
  const map = new Map();
  arr.forEach((p) => map.set(asId(p.id), p));
  return map;
}

/** Use Firestore data, but patch name/position/team from local fallback when missing */
function ensureDisplayFields(p) {
  const id = asId(p.id);
  const local = LOCAL_PLAYERS_MAP.get(id);
  const name =
    p.name ?? p.fullName ?? p.playerName ?? (local ? (local.name || local.fullName || local.playerName) : null);
  const position = p.position ?? (local ? local.position : null);
  const team = p.team ?? (local ? local.team : null);
  const projections = p.projections ?? p.projByWeek ?? (local ? (local.projections || local.projByWeek) : undefined);

  return {
    ...p,
    name: name ?? id, // last resort: id shown
    position: position ?? p.position ?? null,
    team: team ?? p.team ?? null,
    projections: projections,
  };
}

export function playerDisplay(p) {
  if (!p) return "(empty)";
  return p.name || p.fullName || p.playerName || String(p.id) || "(unknown)";
}

/* ======================================================================================
   PROJECTIONS / LIVE POINTS
   ====================================================================================== */

export function projForWeek(p, week) {
  const w = String(week);
  if (p?.projections && p.projections[w] != null) return Number(p.projections[w]) || 0;
  if (p?.projections && p.projections[week] != null) return Number(p.projections[week]) || 0;
  if (p?.projByWeek && p.projByWeek[w] != null) return Number(p.projByWeek[w]) || 0;
  if (p?.projByWeek && p.projByWeek[week] != null) return Number(p.projByWeek[week]) || 0;
  const keyed = p?.[`projW${week}`];
  if (keyed != null) return Number(keyed) || 0;
  // fall back to local projections if present
  const local = LOCAL_PLAYERS_MAP.get(asId(p?.id));
  if (local?.projections && local.projections[w] != null) return Number(local.projections[w]) || 0;
  return 0;
}

/** opponent string for given week if encoded in various shapes */
export function opponentForWeek(p, week) {
  if (!p || week == null) return "";
  const w = String(week);
  const m = p?.matchups?.[w] ?? p?.matchups?.[week] ?? null;
  if (m && (m.opp || m.opponent)) return m.opp || m.opponent;
  if (p?.oppByWeek && p.oppByWeek[w] != null) return p.oppByWeek[w];
  if (p?.opponentByWeek && p.opponentByWeek[w] != null) return p.opponentByWeek[w];
  if (p?.[`oppW${w}`] != null) return p[`oppW${w}`];
  if (p?.[`opponentW${w}`] != null) return p[`opponentW${w}`];
  const local = LOCAL_PLAYERS_MAP.get(asId(p?.id));
  if (local?.matchups && local.matchups[w] && (local.matchups[w].opp || local.matchups[w].opponent))
    return local.matchups[w].opp || local.matchups[w].opponent;
  return "";
}

/** Replace with real data source later. For now returns 0s until you wire the /api/stats/week endpoint/app logic. */
export async function fetchWeekStats(/* { leagueId, week } */) {
  // TODO: connect to your /api/stats/week route or a 3rd-party feed
  return {}; // { [playerId]: { pts: number, rushingYds, passingYds, receivingYds, tds, ... } }
}

/** compute points for a player for a given week (uses live stats if present) */
export function pointsForPlayer(p, week, liveStats = null) {
  const sid = asId(p?.id);
  const ls = liveStats && liveStats[sid];
  if (ls && typeof ls.pts === "number") return Number(ls.pts) || 0;
  return 0; // before Week 1 or no live data
}

/** roster lines + total using live points (with projection alongside for display) */
export function computeTeamPoints({ roster, week, playersMap, liveStats }) {
  const lines = [];
  let total = 0;
  (ROSTER_SLOTS || []).forEach((slot) => {
    const pid = roster?.[slot] || null;
    const p = pid ? playersMap.get(asId(pid)) : null;
    const pts = p ? pointsForPlayer(p, week, liveStats) : 0;
    total += Number(pts || 0);
    lines.push({
      slot,
      playerId: pid,
      player: p,
      points: pts,
      projected: p ? projForWeek(p, week) : 0,
      opponent: p ? opponentForWeek(p, week) : "",
    });
  });
  // round to 1 decimal
  return { lines, total: Math.round(total * 10) / 10 };
}

/* ======================================================================================
   CLAIMS (ownership)
   ====================================================================================== */

export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(asId(d.id), d.data()));
    onChange(m);
  });
}

export async function getClaimsSet(leagueId) {
  const ref = collection(db, "leagues", leagueId, "claims");
  const snap = await getDocs(ref);
  const set = new Set();
  snap.forEach((d) => set.add(asId(d.id)));
  return set;
}

/* ======================================================================================
   ENTRY / PAYMENTS (simple gating flags)
   ====================================================================================== */

export function hasPaidEntry(league, username) {
  return league?.entry?.enabled ? !!(league?.entry?.paid && league.entry.paid[username]) : true;
}

export async function setEntrySettings({ leagueId, isEnabled, price }) {
  const ref = doc(db, "leagues", leagueId);
  const payload = {};
  if (typeof isEnabled === "boolean") payload["entry.enabled"] = isEnabled;
  if (price != null) payload["entry.price"] = Number(price) || 0;
  await updateDoc(ref, payload);
}

/** Simulated "payment" — in production, hook into Pi payment flow then call this to mark paid */
export async function payEntry({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    [`entry.paid.${username}`]: true,
  });
}

export async function allMembersPaidOrFree(leagueId) {
  const league = await getLeague(leagueId);
  if (!league?.entry?.enabled) return true;
  const members = await listMemberUsernames(leagueId);
  const paid = league.entry?.paid || {};
  for (const u of members) {
    if (!paid[u]) return false;
  }
  return true;
}

/* ======================================================================================
   DRAFT HELPERS & ACTIONS
   ====================================================================================== */

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
export function currentDrafter(league) {
  const d = league?.draft || {};
  const order = Array.isArray(d.order) ? d.order : [];
  const ptr = Number.isInteger(d.pointer) ? d.pointer : 0;
  return order[ptr] || null;
}

/** Admin: set order + reset draft state (scheduled) */
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

/** Build initial order from members subcollection */
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
  const ok = await allMembersPaidOrFree(leagueId);
  if (!ok) throw new Error("All entry fees must be paid before starting the draft.");
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, { "draft.status": "live", "draft.deadline": Date.now() + PICK_CLOCK_MS });
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

/** Core pick: claims + team update + snake pointer advance */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error("League not found");
  const league = leagueSnap.data();

  if (!canDraft(league)) throw new Error("Draft is not live");

  // Turn check
  const order = Array.isArray(league?.draft?.order) ? league.draft.order : [];
  const ptr = Number.isInteger(league?.draft?.pointer) ? league.draft.pointer : 0;
  const onClock = order[ptr] || null;
  if (onClock !== username) throw new Error("Not your turn");

  // deny dup
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
    if (pos === "RB") targetSlot = rosterCopy.RB1 ? (rosterCopy.RB2 ? "FLEX" : "RB2") : "RB1";
    else if (pos === "WR") targetSlot = rosterCopy.WR1 ? (rosterCopy.WR2 ? "FLEX" : "WR2") : "WR1";
    else targetSlot = defaultSlotForPosition(pos, rosterCopy);
  }

  // starter full? → bench
  let sendToBench = false;
  if (targetSlot !== "FLEX" && rosterCopy[targetSlot]) sendToBench = true;
  if (targetSlot === "FLEX" && rosterCopy.FLEX) sendToBench = true;

  const batch = writeBatch(db);

  // claim ownership
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  // team update
  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };
  if (sendToBench) newTeam.bench.push(asId(playerId));
  else newTeam.roster[targetSlot] = asId(playerId);

  batch.set(teamRef, newTeam, { merge: true });

  // snake advance
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
    "draft.pointer": clamp(pointer, 0, teamsCount - 1),
    "draft.direction": direction,
    "draft.round": clamp(round, 1, roundsTotal),
    "draft.picksTaken": picksTaken,
    "draft.deadline": nextDeadline,
    "draft.status": doneAll ? "done" : "live",
  });

  await batch.commit();
}

/** pick best available by projection for a given week */
export async function autoPickBestAvailable({ leagueId, currentWeek }) {
  const league = await getLeague(leagueId);
  if (!canDraft(league)) return;

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const username = order[ptr];
  if (!username) return;

  const players = await listPlayers({ leagueId });
  const owned = await getClaimsSet(leagueId);

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

/** auto-draft when clock expires */
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

/* ======================================================================================
   TEAM UTILITIES (move/release/add-drop)
   ====================================================================================== */

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

  for (const s of Object.keys(roster)) if (asId(roster[s]) === asId(playerId)) roster[s] = null;
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
    for (const s of Object.keys(roster)) if (asId(roster[s]) === asId(dropId)) roster[s] = null;
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

/* ======================================================================================
   LEAGUE CREATION / MEMBERSHIP
   ====================================================================================== */

export async function createLeague({ name, owner, order }) {
  const ref = await addDoc(collection(db, "leagues"), {
    name,
    owner,
    createdAt: serverTimestamp(),
    settings: { currentWeek: 1, lockAddDuringDraft: false },
    entry: { enabled: false, price: 0, paid: { [owner]: true } },
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
  // Ensure membership + team
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
  const qOwned = fsQuery(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // Member
  const all = await getDocs(leaguesCol);
  for (const d of all.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
  }
  return out;
}

/* ======================================================================================
   SCHEDULE / MATCHUPS
   ====================================================================================== */

/** Simple round-robin; if odd team count, uses a BYE. */
export function generateScheduleRoundRobin(usernames, totalWeeks) {
  const teams = [...new Set(usernames || [])].filter(Boolean);
  if (teams.length < 2) return [];

  // Add BYE if odd
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

    // rotate (circle method)
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

  if (exists && !recreate) {
    return { weeksCreated: [] }; // already there, do nothing
  }

  await writeSchedule(leagueId, schedule);
  return { weeksCreated: schedule.map((w) => w.week) };
}
