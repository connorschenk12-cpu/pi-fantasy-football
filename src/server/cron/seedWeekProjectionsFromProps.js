/* eslint-disable no-console */
// src/server/cron/seedWeekProjectionsFromProps.js
import { Timestamp } from "firebase-admin/firestore";

/** Scoring weights (adjust if your league differs) */
const S = {
  passYds: 0.04,
  passTD: 4,
  passInt: -2,
  rushYds: 0.1,
  rushTD: 6,
  recYds: 0.1,
  recTD: 6,
  rec: 1,
  fumbles: -2,
};

const toNum = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const normPos = (p) => {
  const x = String(p || "").toUpperCase().trim();
  if (x === "PK") return "K";
  if (x === "DST" || x === "D/ST") return "DEF";
  return x;
};
const normTeam = (t) => String(t || "").toUpperCase().trim();

/** Build a few robust lookup keys for players map */
function keysForPlayer(p) {
  const out = new Set();
  const id = String(p.id || "").trim();
  const espn = String(p.espnId || "").trim();
  const name = String(p.name || "").trim().toLowerCase();
  const team = normTeam(p.team || "");
  const pos = normPos(p.position || "");

  if (id) out.add(`id:${id}`);
  if (espn) out.add(`espn:${espn}`);
  if (name && team) out.add(`nt:${name}|${team}`);
  if (name && team && pos) out.add(`ntp:${name}|${team}|${pos}`);
  return out;
}

/** Build players lookup maps (by espnId and by name+team(+pos)) */
async function loadPlayersMaps(adminDb) {
  const snap = await adminDb.collection("players").get();
  const byEspn = new Map();
  const byNameTeam = new Map();
  const byNameTeamPos = new Map();

  snap.forEach((doc) => {
    const p = { id: doc.id, ...(doc.data() || {}) };
    const espn = p.espnId ? String(p.espnId) : null;
    const name = String(p.name || "").toLowerCase();
    const team = normTeam(p.team || "");
    const pos = normPos(p.position || "");

    if (espn) byEspn.set(espn, p);
    if (name && team) byNameTeam.set(`${name}|${team}`, p);
    if (name && team && pos) byNameTeamPos.set(`${name}|${team}|${pos}`, p);
  });

  return { byEspn, byNameTeam, byNameTeamPos };
}

/** Compute fantasy points from a props/lines record */
function computeProjectionFromProps(line, pos) {
  const passYds = toNum(line.passYds ?? line.pass_yds ?? line.pyds);
  const passTD  = toNum(line.passTD  ?? line.pass_tds ?? line.ptd);
  const passInt = toNum(line.passInt ?? line.ints     ?? line.int);

  const rushYds = toNum(line.rushYds ?? line.rush_yds ?? line.ryds);
  const rushTD  = toNum(line.rushTD  ?? line.rush_tds ?? line.rtd);

  const recYds  = toNum(line.recYds  ?? line.rec_yds  ?? line.reyds);
  const recTD   = toNum(line.recTD   ?? line.rec_tds  ?? line.retd);
  const rec     = toNum(line.receptions ?? line.rec   ?? line.recp);

  const fumbles = toNum(line.fumbles ?? line.fum ?? 0);

  // Basic position guardrails: if a QB has no pass props but has rush, still score those; vice versa.
  const pts =
    passYds * S.passYds +
    passTD * S.passTD +
    passInt * S.passInt +
    rushYds * S.rushYds +
    rushTD * S.rushTD +
    recYds * S.recYds +
    recTD * S.recTD +
    rec * S.rec +
    fumbles * S.fumbles;

  return Math.round(pts * 10) / 10;
}

/** Read props “lines” for (season, week) from either nested or flat schema */
async function readPropsLines(adminDb, { season, week }) {
  // 1) Preferred nested shape:
  // props / nfl (doc) / <season> (subcol) / <week> (doc) / lines (subcol) / {doc per player}
  try {
    const base = adminDb.collection("props").doc("nfl").collection(String(season));
    const weekDoc = await base.doc(String(week)).get();
    if (weekDoc.exists) {
      const linesCol = base.doc(String(week)).collection("lines");
      const snap = await linesCol.get();
      if (!snap.empty) {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() || {}) }));
        return arr;
      }
    }
  } catch (e) {
    console.warn("props nested read failed (will try flat):", e?.message || e);
  }

  // 2) Flat fallback: propsLines where season==X and week==Y
  try {
    const snap = await adminDb
      .collection("propsLines")
      .where("season", "==", Number(season))
      .where("week", "==", Number(week))
      .get();

    if (!snap.empty) {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() || {}) }));
      return arr;
    }
  } catch (e) {
    console.warn("props flat read failed:", e?.message || e);
  }

  return [];
}

/** Try to match a props line to a player */
function matchPlayerForLine(line, maps) {
  const pos = normPos(line.pos || line.position);
  const team = normTeam(line.team);

  // 1) espnId, if present
  const espnId =
    line.espnId ??
    line.espn_id ??
    (line.player && line.player.espnId) ??
    (line.ids && line.ids.espn);
  if (espnId && maps.byEspn.has(String(espnId))) return maps.byEspn.get(String(espnId));

  // 2) name + team (+ pos)
  const name =
    (line.name ||
      line.playerName ||
      (line.firstName && line.lastName && `${line.firstName} ${line.lastName}`) ||
      "").toLowerCase();
  if (name && team && pos && maps.byNameTeamPos.has(`${name}|${team}|${pos}`)) {
    return maps.byNameTeamPos.get(`${name}|${team}|${pos}`);
  }
  if (name && team && maps.byNameTeam.has(`${name}|${team}`)) {
    return maps.byNameTeam.get(`${name}|${team}`);
  }

  return null;
}

/**
 * Seed projections from props lines.
 * Expected line shape (flexible keys supported):
 * {
 *   espnId?: "3043078",
 *   name: "Patrick Mahomes",
 *   team: "KC",
 *   pos: "QB",
 *   passYds?: 299.5, passTD?: 2.5, passInt?: 0.5,
 *   rushYds?: 18.5, rushTD?: 0.1,
 *   recYds?: 0, recTD?: 0, receptions?: 0,
 *   fumbles?: 0
 * }
 */
export async function seedWeekProjectionsFromProps({
  adminDb,
  week = 1,
  season,
  overwrite = false,
}) {
  if (!adminDb) throw new Error("adminDb required");
  if (!season || !week) {
    return { ok: true, source: "props", processed: 0, updated: 0, skipped: 0, done: true, note: "season/week required" };
  }

  // load props
  const lines = await readPropsLines(adminDb, { season, week });
  if (!lines.length) {
    return { ok: true, source: "props", processed: 0, updated: 0, skipped: 0, done: true, note: "no props docs for given week/season" };
  }

  // build player maps
  const maps = await loadPlayersMaps(adminDb);

  const weekKey = String(week);
  const writes = [];
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for (const line of lines) {
    processed++;

    const pos = normPos(line.pos || line.position);
    if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(pos)) {
      skipped++;
      continue;
    }

    const player = matchPlayerForLine(line, maps);
    if (!player) {
      skipped++;
      continue;
    }

    const current = player.projections || {};
    if (!overwrite && current[weekKey] != null) {
      skipped++;
      continue;
    }

    // Kickers/DEF: very rough if you have only a team total line; skip unless provided.
    if (pos === "K" || pos === "DEF") {
      const val = toNum(line.points ?? line.fantasy ?? line.kicker ?? line.defPoints);
      if (!val) { skipped++; continue; }
      current[weekKey] = Number(val.toFixed(1));
    } else {
      const pts = computeProjectionFromProps(line, pos);
      if (!pts || isNaN(pts)) { skipped++; continue; }
      current[weekKey] = pts;
    }

    writes.push((batch) => {
      batch.set(
        adminDb.collection("players").doc(player.id),
        { projections: current, projectionsUpdatedAt: Timestamp.now(), projectionsSource: "props" },
        { merge: true }
      );
    });
    updated++;
  }

  // commit in chunks
  let i = 0;
  while (i < writes.length) {
    const batch = adminDb.batch();
    for (const fn of writes.slice(i, i + 400)) fn(batch);
    await batch.commit();
    i += 400;
    if (writes.length > 400) await new Promise((r) => setTimeout(r, 50));
  }

  return { ok: true, source: "props", processed, updated, skipped, done: true };
}

export default seedWeekProjectionsFromProps;
