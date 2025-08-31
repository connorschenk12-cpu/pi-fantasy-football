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

// Owner rake fixed at 2% (200 basis points) for paid leagues
const OWNER_RAKE_BPS = 200;

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

// ✅ Normalizer to unify positions (PK → K, D/ST → DEF, etc.)
export function normalizePosition(pos) {
  if (!pos) return null;
  const p = String(pos).toUpperCase().trim();
  if (p === "PK") return "K";       // Place Kicker → K
  if (p === "DST" || p === "D/ST") return "DEF"; // Defense
  return p;
}

function pickFirstOpen(slots, roster) {
  for (const s of slots) if (!roster[s]) return s;
  return null;
}

export function defaultSlotForPosition(pos, roster = {}) {
  const p = normalizePosition(pos);
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
  QB: ["QB"],
  WR1: ["WR"],
  WR2: ["WR"],
  RB1: ["RB"],
  RB2: ["RB"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K: ["K"],
  DEF: ["DEF"],
};

export function isSlotAllowedForPosition(slot, pos) {
  const s = String(slot || "").toUpperCase();
  const p = normalizePosition(pos);
  const allowed = SLOT_RULES[s] || [];
  return allowed.includes(p);
}
export function allowedSlotsForPosition(pos) {
  const p = normalizePosition(pos);
  return Object.keys(SLOT_RULES).filter((slot) => SLOT_RULES[slot].includes(p));
}
export function allowedSlotsForPlayer(player) {
  const pos = normalizePosition(player?.position || player?.pos);
  return allowedSlotsForPosition(pos);
}
/* =========================================================
   LEAGUE / TEAM READ & LISTEN
   ========================================================= */

export function listenLeague(leagueId, onChange) {
  if (!leagueId) return () => {};
  const ref = doc(db, "leagues", leagueId);
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    (err) => console.warn("listenLeague onSnapshot error:", err)
  );
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
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    (err) => console.warn("listenTeam onSnapshot error:", err)
  );
}

export function listenTeamById(leagueId, teamId, onChange) {
  if (!leagueId || !teamId) return () => {};
  const ref = doc(db, "leagues", leagueId, "teams", teamId);
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    (err) => console.warn("listenTeamById onSnapshot error:", err)
  );
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
    settings: { currentWeek: 1, lockAddDuringDraft: false, seasonEnded: false },
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
    // treasury is created lazily on first payment
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
   PLAYERS (GLOBAL-ONLY SOURCE) + DE-DUPE
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

/** GLOBAL-ONLY: return players from the root "players" collection and de-dupe */
export async function listPlayers() {
  const raw = [];
  const gSnap = await getDocs(collection(db, "players"));
  gSnap.forEach((d) => raw.push({ id: d.id, __leagueScoped: false, ...d.data() }));

  const normalized = raw.map((p) => {
    const id = asId(p.id);
    const position = normalizePosition(p.position || p.pos);
    const name =
      p.name ??
      p.fullName ??
      p.playerName ??
      (typeof p.id === "string" ? p.id : null);
    const team = p.team || p.nflTeam || p.proTeam || null;
    const espnId =
      p.espnId ??
      p.espn_id ??
      (p.espn && (p.espn.playerId || p.espn.id)) ??
      null;
    const photo =
      p.photo ||
      p.photoUrl ||
      p.photoURL ||
      p.headshot ||
      p.headshotUrl ||
      p.image ||
      p.imageUrl ||
      p.img ||
      p.avatar ||
      null;

    return { ...p, id, name, position, team, espnId, photo };
  });

  function identityFor(p) {
    const eid = p.espnId ?? p.espn_id ?? null;
    if (eid) return `espn:${String(eid)}`;
    const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
    return `ntp:${k}`;
  }

  function ts(p) {
    const raw = p.updatedAt;
    if (!raw) return 0;
    try {
      if (raw.toDate) return raw.toDate().getTime();
      if (raw.seconds) return Number(raw.seconds) * 1000;
      if (raw instanceof Date) return raw.getTime();
      return Number(raw) || 0;
    } catch { return 0; }
  }

  function better(a, b) {
    const ta = ts(a), tb = ts(b);
    if (ta !== tb) return ta > tb ? a : b;
    const aIsGlobal = !a.__leagueScoped, bIsGlobal = !b.__leagueScoped;
    if (aIsGlobal !== bIsGlobal) return aIsGlobal ? a : b;
    return a;
  }

  const enriched = normalized.map((p) => ({ ...p, __leagueScoped: !!p.__leagueScoped }));
  const byIdent = new Map();
  for (const p of enriched) {
    const idKey = identityFor(p);
    const cur = byIdent.get(idKey);
    if (!cur) byIdent.set(idKey, p);
    else byIdent.set(idKey, better(cur, p));
  }

  return Array.from(byIdent.values()).map(({ __leagueScoped, ...rest }) => rest);
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
    p?.espn_id,
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
export async function listPlayersMap() {
  const arr = await listPlayers();
  const map = new Map();
  for (const p of arr) {
    for (const k of indexKeysFor(p)) {
      if (!map.has(k)) map.set(k, p);
    }
  }
  return map;
}

/** Direct fetch by canonical doc id from global */
export async function getPlayerById({ id }) {
  const pid = asId(id);
  if (!pid) return null;
  const gref = doc(db, "players", pid);
  const gs = await getDoc(gref);
  if (gs.exists()) {
    const row = { id: gs.id, ...gs.data() };
    // normalize PK -> K on read
    row.position = normalizePosition(row.position || row.pos);
    return row;
  }
  return null;
}

/* ---------- projection + matchup merge + identity helpers ---------- */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const toNum = (v) => (v == null || v === "" ? null : Number(v));
const gt0 = (v) => isNum(v) && v > 0;

function normalizeProj(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const num = toNum(v);
    if (num == null || Number.isNaN(num)) continue;
    out[String(k)] = num;
  }
  return out;
}

function mergeProjections(existing = {}, incoming = {}) {
  const a = normalizeProj(existing);
  const b = normalizeProj(incoming);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const va = a[k], vb = b[k];
    out[k] = gt0(vb) ? vb : (va != null ? va : (isNum(vb) ? vb : 0));
  }
  return out;
}

function normalizeMatchups(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      out[String(k)] = { opp: v.opp ?? v.opponent ?? v.vs ?? v.against ?? "", ...v };
    }
  }
  return out;
}

function mergeMatchups(existing = {}, incoming = {}) {
  const a = normalizeMatchups(existing);
  const b = normalizeMatchups(incoming);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const ea = a[k] || {};
    const eb = b[k] || {};
    out[k] = eb.opp ? { ...ea, ...eb } : { ...ea };
  }
  return out;
}

function identityForWrite(p) {
  const espnId =
    p.espnId ?? p.espn_id ?? (p.espn && (p.espn.playerId || p.espn.id)) ?? null;
  if (espnId) return `espn:${String(espnId)}`;
  const name = (p.name || p.displayName || "").toLowerCase().trim();
  const team = (p.team || p.nflTeam || p.proTeam || "").toLowerCase().trim();
  const pos  = (p.position || p.pos || "").toString().toLowerCase().trim();
  return `ntp:${name}|${team}|${pos}`;
}

function safeSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Seed/merge into GLOBAL players (dedupe + fresh batch per chunk + PK→K normalize) */
export async function seedPlayersToGlobal(players = []) {
  if (!Array.isArray(players) || players.length === 0) return { written: 0 };

  const existingSnap = await getDocs(collection(db, "players"));
  const existingById = new Map();
  const idByIdentity = new Map();
  existingSnap.forEach((d) => {
    const row = { id: d.id, ...d.data() };
    existingById.set(d.id, row);
    idByIdentity.set(identityForWrite(row), d.id);
  });

  const writes = [];
  for (const raw of players) {
    const espnId =
      raw.espnId ??
      raw.espn_id ??
      (raw.espn && (raw.espn.playerId || raw.espn.id)) ??
      null;

    const position = normalizePosition(raw.position || raw.pos);
    const team     = raw.team || raw.nflTeam || raw.proTeam || null;
    const name     = playerDisplay(raw);
    const photo    = raw.photo || raw.photoUrl || raw.headshot || raw.image || null;

    const identity = identityForWrite({ ...raw, name, team, position, espnId });

    let docId = idByIdentity.get(identity);
    if (!docId) {
      docId = espnId
        ? `espn-${String(espnId)}`
        : `p-${safeSlug(name)}-${safeSlug(team || "fa")}-${safeSlug(position || "")}`;
    }

    const prev = existingById.get(docId) || {};
    const nextProjections = mergeProjections(prev.projections, raw.projections);
    const nextMatchups    = mergeMatchups(prev.matchups, raw.matchups);

    writes.push({
      docId,
      data: {
        id: docId,
        name,
        position,
        team,
        projections: nextProjections,
        matchups: nextMatchups,
        espnId: espnId ?? prev.espnId ?? null,
        photo: photo || prev.photo || null,
        updatedAt: serverTimestamp(),
      },
    });

    const merged = {
      ...prev, id: docId, name, position, team,
      projections: nextProjections, matchups: nextMatchups,
      espnId: espnId ?? prev.espnId ?? null, photo: photo || prev.photo || null,
    };
    existingById.set(docId, merged);
    idByIdentity.set(identity, docId);
  }

  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + CHUNK)) {
      batch.set(doc(db, "players", w.docId), w.data, { merge: true });
    }
    await batch.commit();
  }

  return { written: writes.length };
}

/* =========================================================
   PROJECTED & ACTUAL POINTS / MATCHUPS / STATS
   ========================================================= */

function nameTeamKey(p) {
  const name = (p.name || p.displayName || "").toUpperCase().trim();
  const team = (p.team || p.nflTeam || p.proTeam || "").toUpperCase().trim();
  return name && team ? `${name}|${team}` : null;
}

function candidateIdsForStats(p) {
  const ids = [
    p?.id, p?.sleeperId, p?.player_id, p?.externalId, p?.pid, p?.espnId, p?.yahooId, p?.gsisId,
  ].map(asId).filter(Boolean);

  const plus = new Set(ids);
  for (const k of ids) {
    const n = Number(k);
    if (Number.isFinite(n)) plus.add(String(n));
  }
  const nt = nameTeamKey(p);
  if (nt) plus.add(nt);
  return Array.from(plus);
}

export function actualPointsForPlayerLoose(p, statsMap) {
  if (!p || !statsMap?.get) return 0;
  const canonical = asId(p.id);
  const ids = [canonical, ...candidateIdsForStats(p).filter((x) => x && x !== canonical)];
  for (const k of ids) {
    const row = statsMap.get ? statsMap.get(k) : statsMap[k];
    if (row && row.points != null) return Number(row.points) || 0;
  }
  return 0;
}

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
    const res = await fetch(
      `/api/stats/week?week=${encodeURIComponent(week)}${
        leagueId ? `&league=${encodeURIComponent(leagueId)}` : ""
      }`
    );
    if (!res.ok) return new Map();

    const data = await res.json();
    const out = new Map();

    const S = { passYds: 0.04, passTD: 4, passInt: -2, rushYds: 0.1, rushTD: 6, recYds: 0.1, recTD: 6, rec: 1, fumbles: -2 };
    const n = (v) => (v == null ? 0 : Number(v) || 0);
    const computePoints = (row) =>
      Math.round(
        (
          n(row.passYds) * S.passYds +
          n(row.passTD) * S.passTD +
          n(row.passInt) * S.passInt +
          n(row.rushYds) * S.rushYds +
          n(row.rushTD) * S.rushTD +
          n(row.recYds) * S.recYds +
          n(row.recTD) * S.recTD +
          n(row.rec) * S.rec +
          n(row.fumbles) * S.fumbles
        ) * 10
      ) / 10;

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
          passYds: row.passYds ?? row.pass_yd ?? 0,
          passTD: row.passTD ?? row.pass_td ?? 0,
          passInt: row.passInt ?? row.pass_int ?? 0,
          rushYds: row.rushYds ?? row.rush_yd ?? 0,
          rushTD: row.rushTD ?? row.rush_td ?? 0,
          recYds: row.recYds ?? row.rec_yd ?? 0,
          recTD: row.recTD ?? row.rec_td ?? 0,
          rec: row.rec ?? 0,
          fumbles: row.fumbles ?? row.fum_lost ?? 0,
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

// ---------- scoring helpers ----------
export function actualPointsForPlayer(p, week, statsMap) {
  const id = asId(p?.id);
  if (!id || !statsMap?.get) return 0;
  const row = statsMap.get(id);
  if (row && row.points != null) return Number(row.points) || 0;
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
  return onSnapshot(
    ref,
    (snap) => {
      const m = new Map();
      snap.forEach((d) => m.set(asId(d.id), d.data()));
      onChange(m);
    },
    (err) => console.warn("listenLeagueClaims onSnapshot error:", err)
  );
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
   TREASURY HELPERS (shared by payments & settlement)
   ========================================================= */

// payouts format:
// treasury = {
//   poolPi: number,       // prize pool (net of rake)
//   rakePi: number,       // accumulated rake
//   txs: Array< {...} >,  // entry payment log [{kind:'entry', username, amountPi, rakePi, netPi, txId, at}]
//   payouts: { pending: Array<...>, sent: Array<...> }
// }

function normalizeTreasury(league) {
  const t = league?.treasury || {};
  const payouts = t?.payouts || {};
  return {
    poolPi: Number(t?.poolPi || 0),
    rakePi: Number(t?.rakePi || 0),
    txs: Array.isArray(t?.txs) ? t.txs : [],
    payouts: {
      pending: Array.isArray(payouts?.pending) ? payouts.pending : [],
      sent: Array.isArray(payouts?.sent) ? payouts.sent : [],
    },
  };
}

/* =========================================================
   ENTRY / PAYMENTS (flag + rake + pool)
   ========================================================= */

export async function setEntrySettings({ leagueId, enabled, amountPi }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data() : {};

  const amt = Number(amountPi || 0);
  const isPaidLeague = !!enabled && amt > 0;

  await updateDoc(ref, {
    entry: {
      ...(prev.entry || {}),
      enabled: !!enabled,
      amountPi: amt,
      // lock rake to 2% for paid leagues, 0% for free leagues
      rakeBps: isPaidLeague ? 200 : 0,
    },
  });
}

export function hasPaidEntry(league, username) {
  if (!league?.entry?.enabled) return true; // free/disabled => treat as paid
  return !!(league?.entry?.paid && league.entry.paid[username]);
}

/**
 * Mark a successful entry payment and update treasury pool/rake.
 * Call this after a confirmed Pi payment (e.g. your /payments return step or webhook).
 */
export async function recordSuccessfulEntryPayment({
  leagueId,
  username,
  amountPi,
  paymentId = "sandbox",
}) {
  if (!leagueId || !username) throw new Error("Missing args");

  const ref = doc(db, "leagues", leagueId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("League not found");
  const L = snap.data();

  const isFree = !L?.entry?.enabled || Number(L?.entry?.amountPi || 0) === 0;
  const rakeBps = isFree ? 0 : Number(L?.entry?.rakeBps ?? 200) || 0;

  const amt = Number(amountPi || 0);
  const rakePi = Math.round(((amt * rakeBps) / 10000) * 10000) / 10000;
  const netPi = Math.round((amt - rakePi) * 10000) / 10000;

  const paid = { ...(L.entry?.paid || {}) };
  paid[username] = { paidAt: serverTimestamp(), txId: paymentId };

  const T = normalizeTreasury(L);
  const newPool = Number((T.poolPi + netPi).toFixed(4));
  const newRake = Number((T.rakePi + rakePi).toFixed(4));
  const txs = [
    ...T.txs,
    {
      kind: "entry",
      username,
      amountPi: amt,
      rakePi,
      netPi,
      txId: paymentId,
      at: serverTimestamp(),
    },
  ];

  await updateDoc(ref, {
    "entry.paid": paid,
    "treasury.poolPi": newPool,
    "treasury.rakePi": newRake,
    "treasury.txs": txs,
  });

  return { netPi, rakePi };
}

/** Legacy manual marking (kept for back-compat; does not update pool) */
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
  return Math.min(Math.floor(picksTaken / leagueDraftTeamCount(league)) + 1, ROSTER_SLOTS.length + 3);
}
export function currentDrafter(league) {
  const d = league?.draft || {};
  const order = Array.isArray(d.order) ? d.order : [];
  const ptr = Number.isInteger(d.pointer) ? d.pointer : 0;
  return order[ptr] || null;
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
      roundsTotal: ROSTER_SLOTS.length + 3,
      clockMs: 5000,
      deadline: null,
      scheduledAt: prev?.draft?.scheduledAt || null,
    },
    settings: { ...(prev.settings || {}), lockAddDuringDraft: true },
  });
}

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
      roundsTotal: ROSTER_SLOTS.length + 3,
      clockMs: 5000,
      deadline: Number(startsAtMs) || null,
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
  await updateDoc(ref, { "draft.status": "live", "draft.deadline": Date.now() + 5000 });
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

/** Perform a draft pick (enforces slot rules) */
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

  const claimRef = doc(db, "leagues", leagueId, "claims", asId(playerId));
  const claimSnap = await getDoc(claimRef);
  if (claimSnap.exists()) throw new Error("Player already owned");

  const pos = normalizePosition(playerPosition);
  let targetSlot = slot ? String(slot).toUpperCase() : null;

  if (targetSlot && !isSlotAllowedForPosition(targetSlot, pos)) {
    throw new Error(`Cannot place ${pos} in ${targetSlot}.`);
  }

  const teamRef = await ensureTeam({ leagueId, username });
  const teamSnap = await getDoc(teamRef);
  const team = teamSnap.exists() ? teamSnap.data() : { roster: emptyRoster(), bench: [] };
  const rosterCopy = { ...(team.roster || emptyRoster()) };

  if (!targetSlot) {
    const preferred = allowedSlotsForPosition(pos).find((s) => !rosterCopy[s]);
    targetSlot = preferred || "FLEX";
  }

  const sendToBench = !!rosterCopy[targetSlot];

  const batch = writeBatch(db);
  batch.set(claimRef, { claimedBy: username, at: serverTimestamp() }, { merge: true });

  const newTeam = {
    roster: { ...(team.roster || emptyRoster()) },
    bench: Array.isArray(team.bench) ? [...team.bench] : [],
  };
  if (sendToBench) newTeam.bench.push(asId(playerId));
  else newTeam.roster[targetSlot] = asId(playerId);
  batch.set(teamRef, newTeam, { merge: true });

  const teamsCount = Math.max(1, Array.isArray(order) ? order.length : 1);
  const prevPicks = Number(league?.draft?.picksTaken || 0);
  const picksTaken = prevPicks + 1;
  const roundsTotal = Number(league?.draft?.roundsTotal || (ROSTER_SLOTS.length + 3));

  const mod = picksTaken % teamsCount;
  const round = Math.floor(picksTaken / teamsCount) + 1;
  const direction = round % 2 === 1 ? 1 : -1;
  const pointer = direction === 1 ? mod : teamsCount - 1 - mod;

  const doneAll = picksTaken >= roundsTotal * teamsCount;
  const nextDeadline = doneAll ? null : Date.now() + (Number(league?.draft?.clockMs) || 5000);

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

export async function autoPickBestAvailable({ leagueId, currentWeek }) {
  const league = await getLeague(leagueId);
  if (!canDraft(league)) return;

  const order = league?.draft?.order || [];
  const ptr = Number(league?.draft?.pointer || 0);
  const username = order[ptr];
  if (!username) return;

  const players = await listPlayers();
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

export async function autoDraftIfExpired({ leagueId, currentWeek = 1 }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) return { acted: false, reason: "no-league" };
  const league = leagueSnap.data();

  if (!canDraft(league)) return { acted: false, reason: "not-live" };

  const now = Date.now();
  const clockMs = Number(league?.draft?.clockMs || 5000);
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
  const roundsTotal = Number(post?.draft?.roundsTotal || (ROSTER_SLOTS.length + 3));
  const doneAll = picksTaken >= roundsTotal * teamsCount;

  await updateDoc(leagueRef, {
    "draft.deadline": doneAll ? null : Date.now() + Number(post?.draft?.clockMs || clockMs),
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

  const player = await getPlayerById({ id: playerId });
  const pos = normalizePosition(player?.position || "");
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
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.exists() ? snap.data() : { week, matchups: [] });
    },
    (err) => console.warn("listenScheduleWeek onSnapshot error:", err)
  );
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
  return onSnapshot(
    qq,
    (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      onChange(arr);
    },
    (err) => console.warn("listenMatchups onSnapshot error:", err)
  );
}

export async function setMatchupResult({ leagueId, week, home, away, homePts, awayPts }) {
  const ref = doc(db, "leagues", leagueId, "results", `week-${week}_${home}_vs_${away}`);
  await setDoc(
    ref,
    { leagueId, week, home, away, homePts, awayPts, at: serverTimestamp() },
    { merge: true }
  );
}

// --- League settings helpers (week & season end) ---
export async function setCurrentWeek({ leagueId, week }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const w = Math.max(1, Number(week || 1));
  await updateDoc(doc(db, "leagues", leagueId), {
    "settings.currentWeek": w,
  });
}

/** Accepts either {ended} or {seasonEnded} for convenience */
export async function setSeasonEnded({ leagueId, ended, seasonEnded }) {
  if (!leagueId) throw new Error("Missing leagueId");
  const value = ended ?? seasonEnded ?? false;
  await updateDoc(doc(db, "leagues", leagueId), {
    "settings.seasonEnded": !!value,
  });
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

/* ------------------- Headshots (ESPN + overrides) ------------------- */
function isHttpUrl(u) {
  if (!u || typeof u !== "string") return false;
  return /^https?:\/\//i.test(u);
}
export function headshotUrlFor(p) {
  if (!p) return null;

  const espnId =
    p.espnId ??
    p.espn_id ??
    (p.espn && (p.espn.playerId || p.espn.id)) ??
    null;

  if (espnId) {
    const idStr = String(espnId).replace(/[^\d]/g, "");
    if (idStr) return `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png`;
  }

  const direct =
    p.photo ||
    p.photoUrl ||
    p.photoURL ||
    p.headshot ||
    p.headshotUrl ||
    p.image ||
    p.imageUrl ||
    p.img ||
    p.avatar ||
    null;

  if (isHttpUrl(direct)) return direct;
  return null; // no known headshot
}

/* =========================================================
   TREASURY / AUTO-SETTLEMENT / PAYOUTS QUEUE
   ========================================================= */

// --- constants you can tweak ---
const MAX_WINNERS = 1; // simple: 1st place takes all
const MIN_PAYOUT_PI = 0.01; // ignore dust

/** Find leagues that should be settled.
 *  Simple rule: draft done AND seasonEnd flag true (or currentWeek>=18). */
export async function listLeaguesNeedingSettlement() {
  const leaguesCol = collection(db, "leagues");
  const snap = await getDocs(leaguesCol);
  const out = [];
  snap.forEach((d) => {
    const L = { id: d.id, ...d.data() };
    const curWeek = Number(L?.settings?.currentWeek || 1);
    const seasonEnded = !!L?.settings?.seasonEnded || curWeek >= 18;
    if (L?.draft?.status === "done" && seasonEnded) out.push(L);
  });
  return out;
}

/** Compute winners + shares (very simple: 1st place takes all) */
export async function computeSeasonWinners(league) {
  if (!league) return { winners: [], totalPoolPi: 0, payouts: [] };

  const T = normalizeTreasury(league);
  const totalPool = Number(T.poolPi || 0);

  const standings = league?.standings || {};
  const rows = Object.entries(standings).map(([username, s]) => ({
    username,
    wins: Number(s?.wins || 0),
    losses: Number(s?.losses || 0),
    ties: Number(s?.ties || 0),
    pointsFor: Number(s?.pointsFor || 0),
    pointsAgainst: Number(s?.pointsAgainst || 0),
  }));

  if (rows.length === 0 || totalPool < MIN_PAYOUT_PI) {
    return { winners: [], totalPoolPi: totalPool, payouts: [] };
  }

  // Sort: wins desc, pointsFor desc, losses asc, then name
  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.username.localeCompare(b.username);
  });

  const k = Math.max(1, Math.min(MAX_WINNERS, rows.length));
  const winners = rows.slice(0, k).map((r, i) => ({ username: r.username, rank: i + 1 }));

  // Equal split among winners (rounded to 4dp, fix remainder on the first)
  const base = Math.floor((totalPool / winners.length) * 10000) / 10000;
  const amounts = winners.map(() => base);
  const used = base * winners.length;
  const remainder = Math.round((totalPool - used) * 10000) / 10000;
  if (remainder > 0 && amounts.length > 0) amounts[0] = Math.round((amounts[0] + remainder) * 10000) / 10000;

  const payouts = winners.map((w, i) => ({ ...w, amountPi: amounts[i] })).filter(p => p.amountPi >= MIN_PAYOUT_PI);

  return { winners, totalPoolPi: totalPool, payouts };
}

/* -------------------- Payout queue helpers -------------------- */

function _newPayoutId(username) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `po-${Date.now()}-${username}-${rand}`;
}

export async function getTreasury(leagueId) {
  const snap = await getDoc(doc(db, "leagues", leagueId));
  if (!snap.exists()) return normalizeTreasury(null);
  return normalizeTreasury(snap.data());
}

/** Enqueue season payouts if not already queued/sent. Idempotent-ish. */
export async function enqueueSeasonPayouts({ leagueId }) {
  const lref = doc(db, "leagues", leagueId);
  const ls = await getDoc(lref);
  if (!ls.exists()) throw new Error("League not found");
  const league = ls.data();

  const { payouts } = await computeSeasonWinners(league);
  if (!payouts.length) return { enqueued: [] };

  const T = normalizeTreasury(league);
  const existingPending = Array.isArray(T.payouts.pending) ? T.payouts.pending : [];
  const existingSent = Array.isArray(T.payouts.sent) ? T.payouts.sent : [];

  const already = new Set(
    [...existingPending, ...existingSent].map(p => `${p.username}|${Number(p.amountPi || 0).toFixed(4)}`)
  );

  const add = [];
  for (const p of payouts) {
    const key = `${p.username}|${Number(p.amountPi || 0).toFixed(4)}`;
    if (!already.has(key)) {
      add.push({
        id: _newPayoutId(p.username),
        kind: "season",
        username: p.username,
        rank: p.rank,
        amountPi: Number(p.amountPi.toFixed(4)),
        reason: "Season winnings",
        status: "pending",
        at: serverTimestamp(),
      });
    }
  }

  if (!add.length) return { enqueued: [] };

  const newPending = [...existingPending, ...add];
  await updateDoc(lref, { "treasury.payouts.pending": newPending });
  return { enqueued: add.map(p => p.id) };
}

export async function listPendingPayouts(leagueId) {
  const snap = await getDoc(doc(db, "leagues", leagueId));
  if (!snap.exists()) return [];
  const T = normalizeTreasury(snap.data());
  return T.payouts.pending;
}

export async function listSentPayouts(leagueId) {
  const snap = await getDoc(doc(db, "leagues", leagueId));
  if (!snap.exists()) return [];
  const T = normalizeTreasury(snap.data());
  return T.payouts.sent;
}

/** Mark a specific pending payout as sent, move to 'sent', deduct pool, and log tx */
export async function markPayoutSent({ leagueId, payoutId, txId = "manual" }) {
  const lref = doc(db, "leagues", leagueId);
  const ls = await getDoc(lref);
  if (!ls.exists()) throw new Error("League not found");
  const L = ls.data();
  const T = normalizeTreasury(L);

  const pending = Array.isArray(T.payouts.pending) ? [...T.payouts.pending] : [];
  const idx = pending.findIndex(p => p.id === payoutId);
  if (idx === -1) throw new Error("Payout not found in pending");

  const P = pending[idx];
  pending.splice(idx, 1);

  const sent = Array.isArray(T.payouts.sent) ? [...T.payouts.sent] : [];
  const toSend = {
    ...P,
    status: "sent",
    sentAt: serverTimestamp(),
    txId,
  };
  sent.push(toSend);

  const newPool = Math.max(0, Number((T.poolPi - Number(P.amountPi || 0)).toFixed(4)));
  const txs = Array.isArray(T.txs) ? [...T.txs] : [];
  txs.push({
    kind: "payout",
    username: P.username,
    amountPi: Number(P.amountPi || 0),
    txId,
    at: serverTimestamp(),
  });

  await updateDoc(lref, {
    "treasury.poolPi": newPool,
    "treasury.payouts.pending": pending,
    "treasury.payouts.sent": sent,
    "treasury.txs": txs,
  });

  return { sent: payoutId, poolPi: newPool };
}

/** Remove a pending payout without sending (admin cancel) */
export async function cancelPendingPayout({ leagueId, payoutId }) {
  const lref = doc(db, "leagues", leagueId);
  const ls = await getDoc(lref);
  if (!ls.exists()) throw new Error("League not found");
  const L = ls.data();
  const T = normalizeTreasury(L);

  const pending = Array.isArray(T.payouts.pending) ? [...T.payouts.pending] : [];
  const newPending = pending.filter(p => p.id !== payoutId);
  if (newPending.length === pending.length) return { canceled: false };

  await updateDoc(lref, { "treasury.payouts.pending": newPending });
  return { canceled: true };
}

/** One-shot: if league ready, enqueue payouts (doesn't auto-send money) */
export async function settleLeagueIfReady({ leagueId }) {
  const lref = doc(db, "leagues", leagueId);
  const ls = await getDoc(lref);
  if (!ls.exists()) throw new Error("League not found");
  const L = ls.data();

  const curWeek = Number(L?.settings?.currentWeek || 1);
  const seasonEnded = !!L?.settings?.seasonEnded || curWeek >= 18;
  const ready = L?.draft?.status === "done" && seasonEnded;
  if (!ready) return { enqueued: [], reason: "not-ready" };

  const res = await enqueueSeasonPayouts({ leagueId });
  return { enqueued: res.enqueued, reason: res.enqueued.length ? "queued" : "already-queued" };
}

/* =========================================================
   ADMIN / DEBUG HELPERS
   ========================================================= */

export async function clearAllClaims(leagueId) {
  const col = collection(db, "leagues", leagueId, "claims");
  const snap = await getDocs(col);
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function resetDraftState({ leagueId }) {
  const lref = doc(db, "leagues", leagueId);
  await updateDoc(lref, {
    draft: {
      status: "scheduled",
      order: [],
      pointer: 0,
      direction: 1,
      round: 1,
      picksTaken: 0,
      roundsTotal: DRAFT_ROUNDS_TOTAL,
      clockMs: PICK_CLOCK_MS,
      deadline: null,
      scheduledAt: null,
    },
    "settings.lockAddDuringDraft": false,
  });
}

export async function wipeSchedule(leagueId) {
  const colRef = collection(db, "leagues", leagueId, "schedule");
  const snap = await getDocs(colRef);
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
