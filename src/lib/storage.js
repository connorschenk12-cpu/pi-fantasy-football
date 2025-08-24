/* eslint-disable no-console */
// src/lib/storage.js
// Single, consolidated storage / domain layer for the app.
// - League & Teams
// - Players (list, map, seeding, hydration)
// - Draft (snake, timer, auto-pick)
// - Claims / Add-Drop
// - Schedule & Matchups
// - Entry Fees gating
// - Standings
// - Live Stats hook
// - Utility listeners

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
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// Optional: local dataset used to seed and to hydrate names if Firestore docs lack them.
import localPlayers from "../data/players"; // MUST be inside src/, not outside

/* =======================================================================
   CONSTANTS / SETTINGS
   ======================================================================= */

export const ROSTER_SLOTS = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12
export const PICK_CLOCK_MS = 5000; // 5s draft timer

/** Current NFL season length for schedule helpers (regular-season fantasy weeks) */
export const DEFAULT_SEASON_WEEKS = 14;

/** Default scoring (placeholder). Extend to match your league. */
export const DEFAULT_SCORING = {
  passYds: 0.04, // 1 pt per 25 pass yds
  passTD: 4,
  passInt: -2,
  rushYds: 0.1, // 1 pt per 10 rush yds
  rushTD: 6,
  recYds: 0.1, // 1 pt per 10 rec yds
  recTD: 6,
  rec: 0.5,     // half-PPR
  fumbles: -2,
  xp: 1,
  fg: 3,
  defTD: 6,
  defInt: 2,
  defSack: 1,
  defPa: 0, // you can build a table by points-allowed if desired
};

/* =======================================================================
   LOCAL DATASET INDEX (used for hydration/fallbacks for names & projections)
   ======================================================================= */

const LOCAL_PLAYERS = Array.isArray(localPlayers) ? localPlayers : [];
const LOCAL_BY_ID = new Map();
for (const lp of LOCAL_PLAYERS) {
  if (lp && lp.id != null) LOCAL_BY_ID.set(String(lp.id), lp);
}

/* =======================================================================
   ROSTER HELPERS
   ======================================================================= */

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

/* =======================================================================
   LEAGUE / TEAMS
   ======================================================================= */

export function listenLeague(leagueId, onChange) {
  if (!leagueId) return () => {};
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function getLeague(leagueId) {
  if (!leagueId) return null;
  const s = await getDoc(doc(db, "leagues", leagueId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function ensureTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      owner: username,
      name: username,
      roster: emptyRoster(),
      bench: [],
      createdAt: serverTimestamp(),
    });
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

/* =======================================================================
   PLAYERS (LIST, MAP, DISPLAY, OPPONENT, PROJECTIONS)
   ======================================================================= */

/** List players for league (leagues/{league}/players) if exists, else global /players */
export async function listPlayers({ leagueId }) {
  if (leagueId) {
    const lpRef = collection(db, "leagues", leagueId, "players");
    const lSnap = await getDocs(lpRef);
    if (!lSnap.empty) {
      const arr = [];
      lSnap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
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

/** Display name with aggressive fallbacks */
export function playerDisplay(p) {
  if (!p) return "(empty)";
  const direct =
    p.name || p.fullName || p.playerName || p.displayName || null;
  if (direct) return direct;
  // Fallback to local dataset:
  const idStr = String(p.id);
  const lp = LOCAL_BY_ID.get(idStr);
  if (lp) return lp.name || lp.fullName || lp.playerName || lp.displayName || idStr;
  return idStr;
}

/** Team code (fallback to local dataset) */
export function playerTeam(p) {
  if (!p) return "";
  if (p.team) return p.team;
  const lp = LOCAL_BY_ID.get(String(p.id));
  return lp?.team || "";
}

/** Position (fallback to local dataset) */
export function playerPosition(p) {
  if (!p) return "";
  if (p.position) return p.position;
  const lp = LOCAL_BY_ID.get(String(p.id));
  return lp?.position || "";
}

/** Opponent text for a given week (supports many shapes; else fallback to local) */
export function opponentForWeek(p, week) {
  if (!p || week == null) return "";
  const w = String(week);
  const m = p?.matchups?.[w] ?? p?.matchups?.[week] ?? null;
  if (m && (m.opp || m.opponent)) return m.opp || m.opponent;
  if (p?.oppByWeek && p.oppByWeek[w] != null) return p.oppByWeek[w];
  if (p?.opponentByWeek && p.opponentByWeek[w] != null) return p.opponentByWeek[w];
  if (p?.[`oppW${w}`] != null) return p[`oppW${w}`];
  if (p?.[`opponentW${w}`] != null) return p[`opponentW${w}`];

  // fallback to local dataset:
  const lp = LOCAL_BY_ID.get(String(p.id));
  if (!lp) return "";
  const lm = lp?.matchups?.[w] ?? lp?.matchups?.[week] ?? null;
  if (lm && (lm.opp || lm.opponent)) return lm.opp || lm.opponent;
  if (lp?.oppByWeek && lp.oppByWeek[w] != null) return lp.oppByWeek[w];
  if (lp?.opponentByWeek && lp.opponentByWeek[w] != null) return lp.opponentByWeek[w];
  if (lp?.[`oppW${w}`] != null) return lp[`oppW${w}`];
  if (lp?.[`opponentW${w}`] != null) return lp[`opponentW${w}`];

  return "";
}

/** Projection reader with many shapes + local fallback */
export function projForWeek(p, week) {
  const w = String(week);
  if (p?.projections && p.projections[w] != null) return Number(p.projections[w]) || 0;
  if (p?.projByWeek && p.projByWeek[w] != null) return Number(p.projByWeek[w]) || 0;
  const keyed = p?.[`projW${week}`];
  if (keyed != null) return Number(keyed) || 0;

  // fallback to local dataset
  const lp = LOCAL_BY_ID.get(String(p?.id));
  if (!lp) return 0;
  if (lp?.projections && lp.projections[w] != null) return Number(lp.projections[w]) || 0;
  if (lp?.projByWeek && lp.projByWeek[w] != null) return Number(lp.projByWeek[w]) || 0;
  const lKeyed = lp?.[`projW${week}`];
  if (lKeyed != null) return Number(lKeyed) || 0;

  return 0;
}

/** Fantasy points for a week. For now, fallback = projections until live stats flow. */
export function pointsForPlayer(p, week, statsMap = null, scoring = DEFAULT_SCORING) {
  // If you have a stats map (from /api/stats/week), use it:
  if (statsMap) {
    const st = statsMap[String(p?.id)];
    if (st && typeof st.fantasyPoints === "number") {
      return st.fantasyPoints;
    }
    // If raw stats present, compute fantasy with your scoring:
    if (st) return computeFantasyFromRaw(st, scoring);
  }
  // Fallback to projections:
  return projForWeek(p, week);
}

/** Compute fantasy points from a raw stat line (extend as you wish) */
export function computeFantasyFromRaw(st, scoring = DEFAULT_SCORING) {
  let pts = 0;
  pts += (st.passYds || 0) * (scoring.passYds || 0);
  pts += (st.passTD || 0) * (scoring.passTD || 0);
  pts += (st.passInt || 0) * (scoring.passInt || 0);
  pts += (st.rushYds || 0) * (scoring.rushYds || 0);
  pts += (st.rushTD || 0) * (scoring.rushTD || 0);
  pts += (st.recYds || 0) * (scoring.recYds || 0);
  pts += (st.recTD || 0) * (scoring.recTD || 0);
  pts += (st.rec || 0) * (scoring.rec || 0);
  pts += (st.fumbles || 0) * (scoring.fumbles || 0);
  pts += (st.xp || 0) * (scoring.xp || 0);
  pts += (st.fg || 0) * (scoring.fg || 0);
  pts += (st.defTD || 0) * (scoring.defTD || 0);
  pts += (st.defInt || 0) * (scoring.defInt || 0);
  pts += (st.defSack || 0) * (scoring.defSack || 0);
  // Add more tables (e.g., points-allowed) if needed
  return Math.round(pts * 10) / 10;
}

/** Compute lineup sum for a week; uses statsMap if provided, else projections */
export function computeTeamPoints({ roster, week, playersMap, statsMap = null, scoring = DEFAULT_SCORING }) {
  const lines = [];
  let total = 0;
  (ROSTER_SLOTS || []).forEach((slot) => {
    const pid = roster?.[slot] || null;
    const p = pid ? playersMap.get(pid) || LOCAL_BY_ID.get(String(pid)) : null;
    const pts = p ? pointsForPlayer(p, week, statsMap, scoring) : 0;
    total += Number(pts || 0);
    lines.push({
      slot,
      playerId: pid,
      player: p,
      name: playerDisplay(p),
      team: playerTeam(p),
      position: playerPosition(p),
      opponent: opponentForWeek(p, week),
      points: pts,
      projected: projForWeek(p, week),
    });
  });
  return { lines, total: Math.round(total * 10) / 10 };
}

/* =======================================================================
   CLAIMS (ownership)
   ======================================================================= */

export function listenLeagueClaims(leagueId, onChange) {
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, d.data()));
    onChange(m);
  });
}

export async function getClaimsMap(leagueId) {
  const ref = collection(db, "leagues", leagueId, "claims");
  const s = await getDocs(ref);
  const m = new Map();
  s.forEach((d) => m.set(d.id, d.data()));
  return m;
}

/* =======================================================================
   ENTRY FEES (gating draft)
   ======================================================================= */

export function hasPaidEntry(league, username) {
  return league?.entry?.enabled ? !!league?.entry?.paid?.[username] : true;
}

export function entryFeeAmount(league) {
  const amt = Number(league?.entry?.amount || 0);
  return isFinite(amt) ? amt : 0;
}

export function allMembersPaid(league, members) {
  if (!league?.entry?.enabled) return true;
  const amt = entryFeeAmount(league);
  if (amt <= 0) return true;
  const paid = league?.entry?.paid || {};
  return (members || []).every((u) => !!paid[u]);
}

export async function setEntryFeeConfig({ leagueId, enabled, amount }) {
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, {
    "entry.enabled": !!enabled,
    "entry.amount": Number(amount || 0),
  });
}

export async function recordEntryPayment({ leagueId, username, amount }) {
  // You can add validation of 'amount' if you need exact value checks
  const ref = doc(db, "leagues", leagueId);
  await updateDoc(ref, { [`entry.paid.${username}`]: true });
  return true;
}

/* =======================================================================
   DRAFT (helpers, actions, autopick & clock)
   ======================================================================= */

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
  // gate on entry fees if enabled and > 0
  const league = await getLeague(leagueId);
  const members = await listMemberUsernames(leagueId);
  if (!allMembersPaid(league, members)) {
    throw new Error("All members must pay entry fee (or set entry to free/disabled) before draft.");
  }
  await updateDoc(doc(db, "leagues", leagueId), {
    "draft.status": "live",
    "draft.deadline": Date.now() + (Number(league?.draft?.clockMs) || PICK_CLOCK_MS),
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

/** Perform a draft pick, auto-benching if slot is taken */
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  // Load league
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

  // duplicate claim check
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  // ensure team
  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists() ? teamSnap.data() : { roster: emptyRoster(), bench: [] };

  // pick slot
  const rosterCopy = { ...(team.roster || emptyRoster()) };
  let targetSlot = slot;
  const pos = String(playerPosition || "").toUpperCase();
  if (!targetSlot) {
    if (pos === "RB") targetSlot = rosterCopy.RB1 ? (rosterCopy.RB2 ? "FLEX" : "RB2") : "RB1";
    else if (pos === "WR") targetSlot = rosterCopy.WR1 ? (rosterCopy.WR2 ? "FLEX" : "WR2") : "WR1";
    else targetSlot = defaultSlotForPosition(pos, rosterCopy);
  }

  // if filled, send to bench
  let sendToBench = false;
  if (targetSlot !== "FLEX" && rosterCopy[targetSlot]) sendToBench = true;
  if (targetSlot === "FLEX" && rosterCopy.FLEX) sendToBench = true;

  const batch = writeBatch(db);

  // claim
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  // add to team
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

/** Auto-pick best available by currentWeek projections */
export async function autoPickBestAvailable({ leagueId, currentWeek }) {
  const league = await getLeague(leagueId);
  if (!canDraft(league)) return;

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const username = order[ptr];
  if (!username) return;

  const players = await listPlayers({ leagueId });
  const claims = await getClaimsMap(leagueId);
  const owned = new Set([...claims.keys()]);

  const available = players.filter((p) => !owned.has(p.id));
  available.sort((a, b) => projForWeek(b, currentWeek) - projForWeek(a, currentWeek));

  const pick = available[0];
  if (!pick) return;

  await draftPick({
    leagueId,
    username,
    playerId: pick.id,
    playerPosition: pick.position || playerPosition(pick),
    slot: null,
  });
}

/** Auto-draft if clock expired */
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

/* =======================================================================
   TEAM ACTIONS (move / bench / release / add-drop)
   ======================================================================= */

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
  if (roster[slot]) bench.push(roster[slot]); // swap
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

  for (const s of Object.keys(roster)) if (roster[s] === playerId) roster[s] = null;
  const idx = bench.indexOf(playerId);
  if (idx >= 0) bench.splice(idx, 1);

  const batch = writeBatch(db);
  batch.set(tRef, { roster, bench }, { merge: true });
  batch.delete(doc(db, "leagues", leagueId, "claims", playerId));
  await batch.commit();
}

/** Add/Drop (blocked while draft is live if lockAddDuringDraft=true) */
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

/* =======================================================================
   LEAGUE CREATION / MEMBERSHIP / LISTING
   ======================================================================= */

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
    entry: { enabled: false, amount: 0, paid: { [owner]: true } }, // owner paid by default for free leagues
  });

  // Add membership + ensure team
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

  // owned
  const qOwned = query(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // joined
  const all = await getDocs(leaguesCol);
  for (const d of all.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) {
      if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
    }
  }
  return out;
}

/* =======================================================================
   SCHEDULE / MATCHUPS / RESULTS / STANDINGS
   ======================================================================= */

/** Simple round-robin generator; BYE if odd */
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

    // rotate (circle method)
    const fixed = left[0];
    const movedFromLeft = left.splice(1, 1)[0];
    const movedFromRight = right.shift();
    left = [fixed, movedFromRight, ...left];
    right.push(movedFromLeft);
  }
  return schedule;
}

/** Write week docs under leagues/{league}/schedule/week-{week} */
export async function writeSchedule(leagueId, schedule) {
  if (!leagueId || !Array.isArray(schedule)) throw new Error("Invalid schedule");
  const batch = writeBatch(db);
  schedule.forEach((w) => {
    const ref = doc(db, "leagues", leagueId, "schedule", `week-${w.week}`);
    batch.set(ref, w, { merge: true });
  });
  await batch.commit();
}

/** Ensure / recreate the season schedule */
export async function ensureSeasonSchedule({ leagueId, totalWeeks = DEFAULT_SEASON_WEEKS, recreate = false }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const members = await listMemberUsernames(leagueId);
  if (members.length < 2) throw new Error("Need at least 2 team members to schedule.");

  const colRef = collection(db, "leagues", leagueId, "schedule");
  const existing = await getDocs(colRef);
  if (!existing.empty && !recreate) {
    return { weeksCreated: [], alreadyExists: true };
  }

  const schedule = generateScheduleRoundRobin(members, totalWeeks);
  await writeSchedule(leagueId, schedule);
  return { weeksCreated: schedule.map((w) => w.week), alreadyExists: false };
}

/** Wrapper for your components that referenced different name earlier */
export async function ensureOrRecreateSchedule({ leagueId, weeks = DEFAULT_SEASON_WEEKS }) {
  return ensureSeasonSchedule({ leagueId, totalWeeks: weeks, recreate: true });
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

/** Optional matchups collection (if you use a separate index) */
export async function listMatchups(leagueId, week) {
  const sched = await getScheduleWeek(leagueId, week);
  // flatten schedule doc into a format your UI expects if needed
  return sched?.matchups || [];
}

export function listenMatchups(leagueId, week, onChange) {
  // Proxy to schedule week listener for simplicity
  return listenScheduleWeek(leagueId, week, (w) => onChange(w?.matchups || []));
}

/** Record a final result (if you simulate/close out a week) */
export async function setMatchupResult({ leagueId, week, home, away, homePts, awayPts }) {
  const ref = doc(db, "leagues", leagueId, "results", `week-${week}_${home}_vs_${away}`);
  await setDoc(
    ref,
    { leagueId, week, home, away, homePts, awayPts, at: serverTimestamp() },
    { merge: true }
  );
  await updateStandingsFromResult({ leagueId, home, away, homePts, awayPts });
}

/** Standings helper */
export async function updateStandingsFromResult({ leagueId, home, away, homePts, awayPts }) {
  const lref = doc(db, "leagues", leagueId);
  const snap = await getDoc(lref);
  if (!snap.exists()) return;
  const league = snap.data();
  const standings = { ...(league.standings || {}) };
  const ensureRow = (u) => (standings[u] ||= { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });

  ensureRow(home);
  ensureRow(away);
  standings[home].pointsFor += Number(homePts || 0);
  standings[home].pointsAgainst += Number(awayPts || 0);
  standings[away].pointsFor += Number(awayPts || 0);
  standings[away].pointsAgainst += Number(homePts || 0);

  if (homePts > awayPts) standings[home].wins++, standings[away].losses++;
  else if (homePts < awayPts) standings[away].wins++, standings[home].losses++;
  else standings[home].ties++, standings[away].ties++;

  await updateDoc(lref, { standings });
}

/* =======================================================================
   LIVE STATS FETCHER (backed by your /api/stats/week endpoint)
   ======================================================================= */

export async function fetchWeekStats({ week, ids = [] }) {
  try {
    const qs = new URLSearchParams();
    if (week != null) qs.set("week", String(week));
    if (ids.length) qs.set("ids", ids.join(","));
    const res = await fetch(`/api/stats/week?${qs.toString()}`);
    if (!res.ok) return {};
    return (await res.json()) || {};
  } catch (e) {
    console.error("fetchWeekStats error:", e);
    return {};
  }
}

/* =======================================================================
   SEEDING / HYDRATION (from local dataset)
   ======================================================================= */

/** Seed global /players from src/data/players.js */
export async function seedPlayersGlobal({ limit = null, overwrite = false } = {}) {
  const arr = limit ? LOCAL_PLAYERS.slice(0, limit) : LOCAL_PLAYERS;
  const batch = writeBatch(db);
  for (const p of arr) {
    const ref = doc(db, "players", String(p.id));
    if (overwrite) batch.set(ref, p, { merge: true });
    else batch.set(ref, { ...p }, { merge: true });
  }
  await batch.commit();
  return { written: arr.length, scope: "global" };
}

/** Seed league-scoped players: leagues/{leagueId}/players */
export async function seedPlayersToLeague({ leagueId, limit = null, overwrite = false } = {}) {
  if (!leagueId) throw new Error("Missing leagueId");
  const arr = limit ? LOCAL_PLAYERS.slice(0, limit) : LOCAL_PLAYERS;
  const batch = writeBatch(db);
  for (const p of arr) {
    const ref = doc(db, "leagues", leagueId, "players", String(p.id));
    batch.set(ref, overwrite ? p : { ...p }, { merge: true });
  }
  await batch.commit();
  return { written: arr.length, scope: "league", leagueId };
}

/** Hydrate missing name fields for global players from local dataset */
export async function hydrateMissingNamesGlobal() {
  const snap = await getDocs(collection(db, "players"));
  const batch = writeBatch(db);
  let updates = 0;
  snap.forEach((d) => {
    const data = d.data() || {};
    const hasName = data.name || data.fullName || data.playerName || data.displayName;
    if (!hasName) {
      const lp = LOCAL_BY_ID.get(String(d.id));
      if (lp && (lp.name || lp.fullName || lp.playerName || lp.displayName)) {
        batch.set(d.ref, {
          name: lp.name || "",
          fullName: lp.fullName || "",
          playerName: lp.playerName || "",
          displayName: lp.displayName || "",
          team: data.team || lp.team || "",
          position: data.position || lp.position || "",
        }, { merge: true });
        updates++;
      }
    }
  });
  if (updates) await batch.commit();
  return { updated: updates };
}

/** Hydrate missing name fields for league players from local dataset */
export async function hydrateMissingNamesLeague(leagueId) {
  const snap = await getDocs(collection(db, "leagues", leagueId, "players"));
  const batch = writeBatch(db);
  let updates = 0;
  snap.forEach((d) => {
    const data = d.data() || {};
    const hasName = data.name || data.fullName || data.playerName || data.displayName;
    if (!hasName) {
      const lp = LOCAL_BY_ID.get(String(d.id));
      if (lp && (lp.name || lp.fullName || lp.playerName || lp.displayName)) {
        batch.set(d.ref, {
          name: lp.name || "",
          fullName: lp.fullName || "",
          playerName: lp.playerName || "",
          displayName: lp.displayName || "",
          team: data.team || lp.team || "",
          position: data.position || lp.position || "",
        }, { merge: true });
        updates++;
      }
    }
  });
  if (updates) await batch.commit();
  return { updated: updates, leagueId };
}

/** Seed projections (global) from local dataset */
export async function seedProjectionsGlobalFromLocal({ overwrite = false } = {}) {
  const snap = await getDocs(collection(db, "players"));
  const batch = writeBatch(db);
  let writes = 0;
  snap.forEach((d) => {
    const lp = LOCAL_BY_ID.get(String(d.id));
    if (lp && (lp.projections || lp.projByWeek)) {
      const payload = {};
      if (lp.projections) payload.projections = lp.projections;
      if (lp.projByWeek) payload.projByWeek = lp.projByWeek;
      batch.set(d.ref, payload, { merge: true });
      writes++;
    }
  });
  if (writes) await batch.commit();
  return { updated: writes };
}

/** Seed projections (league) from local dataset */
export async function seedProjectionsLeagueFromLocal({ leagueId, overwrite = false } = {}) {
  if (!leagueId) throw new Error("Missing leagueId");
  const snap = await getDocs(collection(db, "leagues", leagueId, "players"));
  const batch = writeBatch(db);
  let writes = 0;
  snap.forEach((d) => {
    const lp = LOCAL_BY_ID.get(String(d.id));
    if (lp && (lp.projections || lp.projByWeek)) {
      const payload = {};
      if (lp.projections) payload.projections = lp.projections;
      if (lp.projByWeek) payload.projByWeek = lp.projByWeek;
      batch.set(d.ref, payload, { merge: true });
      writes++;
    }
  });
  if (writes) await batch.commit();
  return { updated: writes, leagueId };
}

/** Convenience: ensure lots of players with names+projections exist for league */
export async function seedLeaguePlayersAndProjections({ leagueId, limit = null, overwrite = false } = {}) {
  await seedPlayersToLeague({ leagueId, limit, overwrite });
  await hydrateMissingNamesLeague(leagueId);
  await seedProjectionsLeagueFromLocal({ leagueId, overwrite });
  return { ok: true };
}

/* =======================================================================
   MISC UTILITIES
   ======================================================================= */

export async function setCurrentWeek({ leagueId, week }) {
  await updateDoc(doc(db, "leagues", leagueId), { "settings.currentWeek": Number(week || 1) });
}

export function getCurrentWeek(league) {
  return Number(league?.settings?.currentWeek || 1);
}

/** Compute season-long projected points for a roster (sum over weeks) */
export async function computeSeasonProjected({ roster, playersMap, weeks = DEFAULT_SEASON_WEEKS }) {
  const bySlot = {};
  let total = 0;
  for (const slot of ROSTER_SLOTS) {
    const pid = roster?.[slot];
    const p = pid ? playersMap.get(pid) || LOCAL_BY_ID.get(String(pid)) : null;
    let sum = 0;
    if (p) {
      for (let w = 1; w <= weeks; w++) sum += projForWeek(p, w);
    }
    bySlot[slot] = Math.round(sum * 10) / 10;
    total += sum;
  }
  return { bySlot, total: Math.round(total * 10) / 10 };
}
