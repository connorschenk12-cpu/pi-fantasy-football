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
  deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/* =========================================================
   ROSTER / DRAFT CONSTANTS & HELPERS
   ========================================================= */

// Starters: QB, WR1, WR2, RB1, RB2, TE, FLEX, K, DEF
export const ROSTER_SLOTS = ["QB", "WR1", "WR2", "RB1", "RB2", "TE", "FLEX", "K", "DEF"];
export const BENCH_SIZE = 3;
export const DRAFT_ROUNDS_TOTAL = ROSTER_SLOTS.length + BENCH_SIZE; // 12
export const PICK_CLOCK_MS = 5000; // 5s auto-pick clock

export function emptyRoster() {
  const r = {};
  ROSTER_SLOTS.forEach((s) => (r[s] = null));
  return r;
}

/** Canonicalize any id to a string (so Map keys match consistently) */
export function asId(x) {
  if (x == null) return null;
  if (typeof x === "object" && x.id != null) return String(x.id).trim();
  return String(x).trim();
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

/* ---------- Slot rules (enforce legal positions per slot) ---------- */
export const SLOT_RULES = {
  QB:   ["QB"],
  WR1:  ["WR"],
  WR2:  ["WR"],
  RB1:  ["RB"],
  RB2:  ["RB"],
  TE:   ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K:    ["K"],
  DEF:  ["DEF"],
};

export function isSlotAllowedForPosition(slot, pos) {
  const s = String(slot || "").toUpperCase();
  const p = String(pos || "").toUpperCase();
  const allowed = SLOT_RULES[s] || [];
  return allowed.includes(p);
}
export function allowedSlotsForPosition(pos) {
  const p = String(pos || "").toUpperCase();
  return Object.keys(SLOT_RULES).filter((slot) => SLOT_RULES[slot].includes(p));
}
export function allowedSlotsForPlayer(player) {
  const pos = (player?.position || player?.pos || "").toString().toUpperCase();
  return allowedSlotsForPosition(pos);
}

/* =========================================================
   LEAGUE / TEAM READ & LISTEN
   ========================================================= */

export function listenLeague(leagueId, onChange) {
  if (!leagueId) return () => {};
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => console.warn("listenLeague onSnapshot error:", err));
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
  }, (err) => console.warn("listenTeam onSnapshot error:", err));
}

export function listenTeamById(leagueId, teamId, onChange) {
  if (!leagueId || !teamId) return () => {};
  const ref = doc(db, "leagues", leagueId, "teams", teamId);
  return onSnapshot(ref, (snap) => {
    onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => console.warn("listenTeamById onSnapshot error:", err));
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

export async function listMyLeagues({ username }) {
  const leaguesCol = collection(db, "leagues");

  // Owned
  const qOwned = query(leaguesCol, where("owner", "==", username));
  const sOwned = await getDocs(qOwned);
  const out = [];
  sOwned.forEach((d) => out.push({ id: d.id, ...d.data() }));

  // As member
  const all = await getDocs(leaguesCol);
  for (const d of all.docs) {
    const memSnap = await getDoc(doc(db, "leagues", d.id, "members", username));
    if (memSnap.exists()) {
      if (!out.find((x) => x.id === d.id)) out.push({ id: d.id, ...d.data() });
    }
  }
  return out;
}

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
      scheduledAt: null,
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

/* =========================================================
   PLAYERS
   ========================================================= */

export function playerDisplay(p) {
  if (!p) return "(empty)";
  const firstLast =
    (p.firstName || p.firstname || p.fname || "") +
    (p.lastName || p.lastname || p.lname ? " " + (p.lastName || p.lastname || p.lname) : "");
  return (
    p.name ||
    p.displayName ||
    p.fullName ||
    p.playerName ||
    (firstLast.trim() || null) ||
    (p.nickname || null) ||
    (p.player || null) ||
    (p.player_id_name || null) ||
    (p.PlayerName || null) ||
    (p.Player || null) ||
    (p.Name || null) ||
    (p.n || null) ||
    (p.title || null) ||
    (p.label || null) ||
    (p.text || null) ||
    (p.id != null ? String(p.id) : "(unknown)")
  );
}

/** Returns players (league-scoped first, then global) and de-dupes by id & (name|team|pos) */
export async function listPlayers({ leagueId }) {
  const raw = [];

  if (leagueId) {
    const lpRef = collection(db, "leagues", leagueId, "players");
    const lSnap = await getDocs(lpRef);
    lSnap.forEach((d) => raw.push({ id: d.id, ...d.data() }));
  }

  if (raw.length === 0) {
    const gSnap = await getDocs(collection(db, "players"));
    gSnap.forEach((d) => raw.push({ id: d.id, ...d.data() }));
  }

  const normalized = raw.map((p) => {
    const id = asId(p.id);
    const position = (p.position || p.pos || "").toString().toUpperCase() || null;
    const name =
      p.name ??
      p.fullName ??
      p.playerName ??
      (typeof p.id === "string" ? p.id : null);
    const team = p.team || p.nflTeam || p.proTeam || null;
    return { ...p, id, name, position, team };
  });

  const byId = new Map();
  for (const p of normalized) {
    if (!p.id) continue;
    if (!byId.has(p.id)) byId.set(p.id, p);
  }

  const byKey = new Map();
  for (const p of byId.values()) {
    const key =
      `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }

  return Array.from(byKey.values());
}

/** Build keys that might reference this player (cross-provider ids) */
function indexKeysFor(p) {
  const base = [
    p?.id,
    p?.playerId,
    p?.player_id,
    p?.pid,
    p?.sleeperId,
    p?.sleeper_id,
    p?.espnId,
    p?.yahooId,
    p?.gsisId,
    p?.externalId,
  ].map(asId).filter(Boolean);

  const out = new Set(base);
  for (const k of base) {
    const n = Number(k);
    if (Number.isFinite(n)) out.add(String(n));
  }
  return Array.from(out);
}

/** Map of players keyed by many alternate ids so lookups succeed */
export async function listPlayersMap({ leagueId }) {
  const arr = await listPlayers({ leagueId });
  const map = new Map();
  for (const p of arr) {
    for (const k of indexKeysFor(p)) {
      if (!map.has(k)) map.set(k, p);
    }
  }
  return map;
}

/** Direct fetch by canonical doc id (league-scoped first, then global) */
export async function getPlayerById({ leagueId, id }) {
  const pid = asId(id);
  if (!pid) return null;

  if (leagueId) {
    const lref = doc(db, "leagues", leagueId, "players", pid);
    const ls = await getDoc(lref);
    if (ls.exists()) return { id: ls.id, ...ls.data() };
  }
  const gref = doc(db, "players", pid);
  const gs = await getDoc(gref);
  if (gs.exists()) return { id: gs.id, ...gs.data() };

  return null;
}

export async function seedPlayersToGlobal(players = []) {
  if (!Array.isArray(players) || players.length === 0) return { written: 0 };
  const batch = writeBatch(db);
  let written = 0;
  players.forEach((raw) => {
    const id = asId(raw.id);
    if (!id) return;
    batch.set(
      doc(db, "players", id),
      {
        id,
        name: playerDisplay(raw),
        position: (raw.position || raw.pos || "").toString().toUpperCase(),
        team: raw.team || raw.nflTeam || raw.proTeam || null,
        projections: raw.projections || null,
        matchups: raw.matchups || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    written += 1;
  });
  await batch.commit();
  return { written };
}

export async function seedPlayersToLeague(leagueId, players = []) {
  if (!leagueId || !Array.isArray(players) || players.length === 0) return { written: 0 };
  const batch = writeBatch(db);
  let written = 0;
  players.forEach((raw) => {
    const id = asId(raw.id);
    if (!id) return;
    batch.set(
      doc(db, "leagues", leagueId, "players", id),
      {
        id,
        name: playerDisplay(raw),
        position: (raw.position || raw.pos || "").toString().toUpperCase(),
        team: raw.team || raw.nflTeam || raw.proTeam || null,
        projections: raw.projections || null,
        matchups: raw.matchups || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    written += 1;
  });
  await batch.commit();
  return { written };
}

export async function setPlayerName({ leagueId, id, name }) {
  const pid = asId(id);
  if (!pid) throw new Error("Missing player id");
  const ref = leagueId
    ? doc(db, "leagues", leagueId, "players", pid)
    : doc(db, "players", pid);
  await updateDoc(ref, { name, updatedAt: serverTimestamp() });
}

/* =========================================================
   PROJECTED & ACTUAL POINTS
   ========================================================= */

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

/** Stats API (robust to multiple shapes) -> Map */
export async function fetchWeekStats({ leagueId, week }) {
  try {
    const res = await fetch(`/api/stats/week?week=${encodeURIComponent(week)}${leagueId ? `&league=${encodeURIComponent(leagueId)}` : ""}`);
    if (!res.ok) return new Map();

    const data = await res.json();
    const out = new Map();

    // PPR scoring
    const S = { passYds: 0.04, passTD: 4, passInt: -2, rushYds: 0.1, rushTD: 6, recYds: 0.1, recTD: 6, rec: 1, fumbles: -2 };
    const n = (v) => (v == null ? 0 : Number(v) || 0);
    const computePoints = (row) =>
      Math.round((
        n(row.passYds) * S.passYds +
        n(row.passTD)  * S.passTD  +
        n(row.passInt) * S.passInt +
        n(row.rushYds) * S.rushYds +
        n(row.rushTD)  * S.rushTD  +
        n(row.recYds)  * S.recYds  +
        n(row.recTD)   * S.recTD   +
        n(row.rec)     * S.rec     +
        n(row.fumbles) * S.fumbles
      ) * 10) / 10;

    if (Array.isArray(data)) {
      for (const row of data) {
        const id = row?.id != null ? String(row.id) : null;
        if (!id) continue;
        const pts = row.points != null ? Number(row.points) || 0 : computePoints(row);
        out.set(id, { ...row, points: pts });
      }
      return out;
    }

    if (data && data.stats && typeof data.stats === "object") {
      for (const [idRaw, raw] of Object.entries(data.stats)) {
        const id = String(idRaw);
        const row = raw || {};
        const norm = {
          passYds:  row.passYds  ?? row.pass_yd  ?? 0,
          passTD:   row.passTD   ?? row.pass_td  ?? 0,
          passInt:  row.passInt  ?? row.pass_int ?? 0,
          rushYds:  row.rushYds  ?? row.rush_yd  ?? 0,
          rushTD:   row.rushTD   ?? row.rush_td  ?? 0,
          recYds:   row.recYds   ?? row.rec_yd   ?? 0,
          recTD:    row.recTD    ?? row.rec_td   ?? 0,
          rec:      row.rec      ?? 0,
          fumbles:  row.fumbles  ?? row.fum_lost ?? 0,
        };
        const pts = row.points != null ? Number(row.points) || 0 : computePoints(norm);
        out.set(id, { ...norm, points: pts });
      }
      return out;
    }

    return new Map();
  } catch (e) {
    console.warn("fetchWeekStats failed:", e);
    return new Map();
  }
}

/* ---- Loose id matching for actual points ---- */

function candidateIdsForStats(p) {
  const ids = [
    p?.id, p?.sleeperId, p?.player_id, p?.externalId, p?.pid, p?.espnId, p?.yahooId, p?.gsisId,
  ].map(asId).filter(Boolean);
  const plus = new Set(ids);
  for (const k of ids) {
    const n = Number(k);
    if (Number.isFinite(n)) plus.add(String(n));
  }
  return Array.from(plus);
}

export function actualPointsForPlayerLoose(p, statsMap) {
  if (!p || !statsMap?.get) return 0;
  const canonical = asId(p.id);
  const ids = [canonical, ...candidateIdsForStats(p).filter((x) => x !== canonical)];
  for (const k of ids) {
    if (!k) continue;
    const row = statsMap.get(k);
    if (row && row.points != null) return Number(row.points) || 0;
  }
  return 0;
}
// --- shim so older components that import `pointsForPlayer` keep working ---
export function pointsForPlayer(p, week, statsMap = null) {
  const actual = statsMap ? actualPointsForPlayer(p, week, statsMap) : 0;
  const proj = projForWeek(p, week);
  return actual || proj || 0;
}
// ---------- scoring helpers ----------
export function actualPointsForPlayer(p, week, statsMap) {
  const id = asId(p?.id);
  if (!id || !statsMap?.get) return 0;
  const row = statsMap.get(id);
  if (!row) return 0;
  if (row.points != null) return Number(row.points) || 0;
  // If your /api/stats/week returns per-stat fields, you can compute here too.
  return 0;
}

export function pointsForPlayer(p, week, statsMap = null) {
  const actual = statsMap ? actualPointsForPlayer(p, week, statsMap) : 0;
  const proj = projForWeek(p, week);
  return actual || proj || 0;
}
/** Sum up team points using actual when present else projection */
export function computeTeamPoints({ roster, week, playersMap, statsMap }) {
  const lines = [];
  let total = 0;
  (ROSTER_SLOTS || []).forEach((slot) => {
    const pidRaw = roster?.[slot] || null;
    const pid = asId(pidRaw);
    const p = pid ? playersMap.get(pid) : null;
    const actual = p ? actualPointsForPlayerLoose(p, statsMap) : 0;
    const projected = p ? projForWeek(p, week) : 0;
    const points = actual || projected || 0;
    total += Number(points || 0);
    lines.push({ slot, playerId: pid, player: p, actual, projected, points });
  });
  return { lines, total: Math.round(total * 10) / 10 };
}

/* =========================================================
   CLAIMS (ownership)
   ========================================================= */

export function listenLeagueClaims(leagueId, onChange) {
  if (!leagueId) return () => {};
  const ref = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(ref, (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(asId(d.id), d.data()));
    onChange(m);
  }, (err) => console.warn("listenLeagueClaims onSnapshot error:", err));
}

export async function getClaimsSet(leagueId) {
  if (!leagueId) return new Set();
  const ref = collection(db, "leagues", leagueId, "claims");
  const snap = await getDocs(ref);
  const s = new Set();
  snap.forEach((d) => s.add(asId(d.id)));
  return s;
}

/* =========================================================
   ENTRY / PAYMENTS (flag only + helper)
   ========================================================= */

export async function setEntrySettings({ leagueId, enabled, amountPi }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data() : {};
  await updateDoc(ref, {
    entry: {
      ...(prev.entry || {}),
      enabled: !!enabled,
      amountPi: Number(amountPi || 0),
    },
  });
}

export function hasPaidEntry(league, username) {
  if (!league?.entry?.enabled) return true; // free/disabled => treat as paid
  return !!(league?.entry?.paid && league.entry.paid[username]);
}

export async function payEntry({ leagueId, username, txId = null }) {
  if (!leagueId || !username) throw new Error("Missing leagueId/username");
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const league = snap.data();
  if (!league?.entry?.enabled) return true;

  const paid = { ...(league.entry?.paid || {}) };
  paid[username] = { paidAt: serverTimestamp(), txId: txId || "manual-ok" };
  await updateDoc(ref, { "entry.paid": paid });
  return true;
}

export async function allMembersPaidOrFree(leagueId) {
  const league = await getLeague(leagueId);
  if (!league) return false;
  if (!league.entry?.enabled) return true;
  const members = await listMemberUsernames(leagueId);
  const paid = league.entry?.paid || {};
  return members.every((u) => !!paid[u]);
}

/** Link target for your payment page/flow (Pi) */
export function paymentCheckoutUrl({ leagueId, username }) {
  return `/payments?league=${encodeURIComponent(leagueId)}&user=${encodeURIComponent(username)}`;
}

/* =========================================================
   DRAFT HELPERS & ACTIONS
   ========================================================= */

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

/** Configure the draft order + reset status/pointer */
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
      scheduledAt: prev?.draft?.scheduledAt || null,
    },
    settings: { ...(prev.settings || {}), lockAddDuringDraft: true },
  });
}

/** NEW: schedule the draft for a future time */
export async function setDraftSchedule({ leagueId, startsAtMs }) {
  const lref = doc(db, "leagues", leagueId);
  const snap = await getDoc(lref);
  const prev = snap.exists() ? snap.data() : {};

  await updateDoc(lref, {
    draft: {
      ...(prev.draft || {}),
      status: "scheduled",
      scheduledAt: Number(startsAtMs) || null,
      pointer: 0,
      direction: 1,
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: Number(startsAtMs) || null, // optional use by cron to flip live
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
  await updateDoc(ref, { "draft.status": "live", "draft.deadline": Date.now() + PICK_CLOCK_MS });
}

// Returns leagues whose draft is scheduled and overdue
export async function findDueDrafts(nowMs = Date.now()) {
  const leaguesCol = collection(db, "leagues");
  const all = await getDocs(leaguesCol);
  const due = [];
  all.forEach((d) => {
    const L = d.data();
    const scheduledAt = Number(L?.draft?.scheduledAt || 0);
    if (L?.draft?.status === "scheduled" && scheduledAt && nowMs >= scheduledAt) {
      due.push({ id: d.id, ...L });
    }
  });
  return due;
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

/** Perform a draft pick (now enforces slot rules) */
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

  // Deny duplicate claims
  const claimRef = doc(db, "leagues", leagueId, "claims", asId(playerId));
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  const pos = String(playerPosition || "").toUpperCase();
  let targetSlot = slot ? String(slot).toUpperCase() : null;

  if (targetSlot && !isSlotAllowedForPosition(targetSlot, pos)) {
    throw new Error(`Cannot place ${pos} in ${targetSlot}.`);
  }

  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists() ? teamSnap.data() : { roster: emptyRoster(), bench: [] };
  const rosterCopy = { ...(team.roster || emptyRoster()) };

  // If no slot provided, choose the first valid open slot; else FLEX (still validated by rules)
  if (!targetSlot) {
    const preferred = allowedSlotsForPosition(pos).find((s) => !rosterCopy[s]);
    targetSlot = preferred || "FLEX";
  }

  // If target slot filled, send to bench
  const sendToBench = !!rosterCopy[targetSlot];

  const batch = writeBatch(db);

  // claim
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  // put on team
  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };
  if (sendToBench) newTeam.bench.push(asId(playerId));
  else newTeam.roster[targetSlot] = asId(playerId);
  batch.set(teamRef, newTeam, { merge: true });

  // advance pointer (snake) based on global pick index
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

// pick best available (by projections) for the team on clock
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

  await draftPick({ leagueId, username, playerId: pick.id, playerPosition: pick.position, slot: null });
}

// auto-draft on clock expiry
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
   TEAM UTILITIES (move/release/add-drop)
   ========================================================= */

export async function moveToStarter({ leagueId, username, playerId, slot }) {
  const tRef = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(tRef);
  if (!snap.exists()) throw new Error("Team not found");

  // Load player to enforce slot rule
  const player = await getPlayerById({ leagueId, id: playerId });
  const pos = (player?.position || "").toUpperCase();
  if (!isSlotAllowedForPosition(slot, pos)) {
    throw new Error(`Cannot place ${pos} in ${slot}.`);
  }

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

/** Add/Drop (add to bench). Blocked during draft if locked. */
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

/* =========================================================
   SCHEDULE / MATCHUPS
   ========================================================= */

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
  }, (err) => console.warn("listenScheduleWeek onSnapshot error:", err));
}

export async function getScheduleWeek(leagueId, week) {
  if (!leagueId || !week) return { week, matchups: [] };
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

/** Ensure schedule exists (or recreate). Writes week-1..N docs. */
export async function ensureSeasonSchedule({ leagueId, totalWeeks = 14, recreate = false }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const members = await listMemberUsernames(leagueId);
  if (members.length < 2) throw new Error("Need at least 2 team members to schedule.");

  const schedule = generateScheduleRoundRobin(members, totalWeeks);

  const colRef = collection(db, "leagues", leagueId, "schedule");
  const existing = await getDocs(colRef);
  const exists = !existing.empty;

  if (exists && !recreate) {
    return { weeksCreated: [] };
  }

  await writeSchedule(leagueId, schedule);
  return { weeksCreated: schedule.map((w) => w.week) };
}

/** Back-compat wrapper that some components import */
export function ensureOrRecreateSchedule(leagueId, totalWeeks = 14) {
  return ensureSeasonSchedule({ leagueId, totalWeeks, recreate: true });
}

export async function listMatchups(leagueId, week) {
  const colRef = collection(db, "leagues", leagueId, "matchups");
  const qq = Number.isFinite(week) ? query(colRef, where("week", "==", Number(week))) : colRef;
  const snap = await getDocs(qq);
  const arr = [];
  snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
  return arr;
}

export function listenMatchups(leagueId, week, onChange) {
  const colRef = collection(db, "leagues", leagueId, "matchups");
  const qq = Number.isFinite(week) ? query(colRef, where("week", "==", Number(week))) : colRef;
  return onSnapshot(qq, (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    onChange(arr);
  }, (err) => console.warn("listenMatchups onSnapshot error:", err));
}

export async function setMatchupResult({ leagueId, week, home, away, homePts, awayPts }) {
  const ref = doc(db, "leagues", leagueId, "results", `week-${week}_${home}_vs_${away}`);
  await setDoc(
    ref,
    { leagueId, week, home, away, homePts, awayPts, at: serverTimestamp() },
    { merge: true }
  );
}

/* =========================================================
   SMALL UTILITIES
   ========================================================= */

export function teamRecordLine(league, username) {
  const st = league?.standings?.[username] || { wins: 0, losses: 0, ties: 0 };
  return `${st.wins || 0}-${st.losses || 0}${st.ties ? `-${st.ties}` : ""}`;
}
export function leagueIsFree(league) {
  return !(league?.entry?.enabled) || Number(league?.entry?.amountPi || 0) === 0;
}
export function memberCanDraft(league, username) {
  if (league?.entry?.enabled && !hasPaidEntry(league, username)) return false;
  return true;
}
