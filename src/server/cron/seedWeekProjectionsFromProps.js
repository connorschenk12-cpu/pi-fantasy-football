/* eslint-disable no-console */
// src/server/cron/seedWeekProjectionsFromProps.js
//
// Turn sportsbook prop lines into PPR fantasy projections.
// Expected shapes:
// - Collection: props
//   Doc ID: arbitrary. Each doc is a single player for a week and (optionally) book.
//   Fields (examples; use whatever your feeder writes):
//     playerId        (string)  -> optional, canonical (e.g., "espn-3916387" or your players doc id)
//     name            (string)  -> required if no playerId
//     team            (string)  -> "KC", "BAL", etc. (better matching)
//     pos             (string)  -> "QB","RB","WR","TE","K","DEF"
//     week            (number)  -> NFL week
//     season          (number)  -> season year
//     book            (string)  -> e.g., "DK", "FD", "PB", etc.
//     // lines (numbers) — use the ones you have:
//     passYdsLine, passTDLine, passIntLine,
//     rushYdsLine, rushAttLine, rushTDLine,
//     recYdsLine, recLine, recTDLine,
//     // odds (American odds) — use any you have:
//     passTDOdds, rushTDOdds, recTDOdds, anyTDOdds
//
// Notes:
// - If multiple lines for same player/week across books, we average them.
// - For TDs, if *_TDLine exists (e.g., 0.5), we use that; otherwise if *_TDOdds or anyTDOdds exist,
//   we convert American odds to implied probability of at least 1 TD and treat E[TD] ≈ p.
// - Interceptions: if passIntLine exists we use it; else we apply a mild rate (0.7) if there’s a passYdsLine.
// - Kickers: if you have FG/XP props, add them; otherwise keep 0 (or a small baseline if you want).
// - DEF: we don’t project DEF from props here (leave as-is).
//
// Scoring: full PPR (adjust if your app uses different):
//   QB/RB/WR/TE: PassYds*0.04 + PassTD*4 + INT*(-2) + RushYds*0.1 + RushTD*6 + Rec*1 + RecYds*0.1 + RecTD*6
//
// To run: /api/cron?task=projections&source=props&week=1&season=2025&overwrite=1

const PPR = {
  passYds: 0.04,
  passTD: 4,
  passInt: -2,
  rushYds: 0.1,
  rushTD: 6,
  rec: 1,
  recYds: 0.1,
  recTD: 6,
};

function amOddsToProb(americanOdds) {
  if (americanOdds == null || americanOdds === 0) return null;
  const a = Number(americanOdds);
  if (!Number.isFinite(a)) return null;
  // American → implied probability
  // +150 -> 100/(150+100) ≈ 0.4
  // -150 -> 150/(150+100) ≈ 0.6
  if (a > 0) return 100 / (a + 100);
  if (a < 0) return Math.abs(a) / (Math.abs(a) + 100);
  return null;
}

function safeUpper(x) {
  return String(x || "").toUpperCase().trim();
}

function samePlayerKey({ name, team, pos }) {
  return `${safeUpper(name)}|${safeUpper(team)}|${safeUpper(pos)}`;
}

// Merge multiple book props for same player/week -> averaged lines/odds
function accumulateProps(rows) {
  const acc = {
    n: 0,
    passYdsLine: 0, passTDLine: 0, passIntLine: 0,
    rushYdsLine: 0, rushTDLine: 0,
    recYdsLine: 0, recLine: 0, recTDLine: 0,
    anyTDOdds: null, passTDOdds: null, rushTDOdds: null, recTDOdds: null,
    pos: null,
  };
  for (const r of rows) {
    acc.n += 1;
    // sum numeric lines if present
    ["passYdsLine","passTDLine","passIntLine","rushYdsLine","rushTDLine","recYdsLine","recLine","recTDLine"].forEach(k => {
      const v = Number(r[k]);
      if (Number.isFinite(v)) acc[k] += v;
    });
    // store last seen pos (or ensure consistent)
    if (!acc.pos) acc.pos = r.pos;
    // prefer odds closer to pick’em (higher info). Average if multiple present.
    ["anyTDOdds","passTDOdds","rushTDOdds","recTDOdds"].forEach(k => {
      const v = Number(r[k]);
      if (!Number.isFinite(v)) return;
      const prev = acc[k];
      if (prev == null) acc[k] = v;
      else acc[k] = (prev + v) / 2;
    });
  }
  // average
  Object.keys(acc).forEach(k => {
    if (/_Line$/.test(k) || /Line$/.test(k)) {
      if (acc.n > 0) acc[k] = acc[k] / acc.n;
    }
  });
  return acc;
}

// Build expected fantasy points from merged props
function projectFromProps(pos, props) {
  const p = safeUpper(pos);

  // TD expectation
  // Prefer *_TDLine if present (e.g., 0.5). Else convert *_TDOdds or anyTDOdds -> E[TD] ≈ probability of >=1 TD.
  const tdViaLine = (k) => {
    const v = Number(props[k]);
    return Number.isFinite(v) ? Math.max(0, v) : null;
  };
  const tdViaOdds = (k) => {
    const v = Number(props[k]);
    const prob = amOddsToProb(v);
    return prob != null ? Math.max(0, prob) : null;
  };

  const passYds = Number(props.passYdsLine) || 0;
  const rushYds = Number(props.rushYdsLine) || 0;
  const recYds  = Number(props.recYdsLine) || 0;
  const recs    = Number(props.recLine)     || 0;

  // interceptions: use line if given, else soft expectation if we have pass yards
  let passInt = Number(props.passIntLine);
  if (!Number.isFinite(passInt)) passInt = passYds > 0 ? 0.7 : 0;

  let passTD = tdViaLine("passTDLine");
  if (passTD == null) passTD = tdViaOdds("passTDOdds");
  if (passTD == null) passTD = 0;

  let rushTD = tdViaLine("rushTDLine");
  if (rushTD == null) rushTD = tdViaOdds("rushTDOdds");
  if (rushTD == null) rushTD = 0;

  let recTD = tdViaLine("recTDLine");
  if (recTD == null) recTD = tdViaOdds("recTDOdds");
  if (recTD == null) recTD = 0;

  // If only anyTDOdds present, spread small credit to appropriate buckets by position
  if (passTD === 0 && rushTD === 0 && recTD === 0) {
    const any = tdViaOdds("anyTDOdds") || 0;
    if (any > 0) {
      if (p === "QB") passTD = any;        // QB: TD most likely via passing
      else if (p === "RB") rushTD = any;   // RB: rushing
      else if (p === "WR" || p === "TE") recTD = any; // pass catcher: receiving
    }
  }

  // PPR scoring
  const points =
    passYds * PPR.passYds +
    passTD  * PPR.passTD  +
    passInt * PPR.passInt +
    rushYds * PPR.rushYds +
    rushTD  * PPR.rushTD  +
    recs    * PPR.rec     +
    recYds  * PPR.recYds  +
    recTD   * PPR.recTD;

  // Safety: clamp to one decimal
  return Math.round(points * 10) / 10;
}

export async function seedWeekProjectionsFromProps({
  adminDb,
  week = 1,
  season,
  overwrite = true,
  books, // optional array of book codes to include
}) {
  if (!adminDb) throw new Error("adminDb required");

  const db = adminDb;
  const playersCol = db.collection("players");
  const propsCol   = db.collection("props");

  // 1) Load props for the requested week (and season if provided)
  let q = propsCol.where("week", "==", Number(week));
  if (season != null) q = q.where("season", "==", Number(season));
  if (books && Array.isArray(books) && books.length) {
    // If you store "book" field, you can filter by one (or iterate + filter client-side).
    // Firestore doesn't support IN on arbitrary long lists; if needed, fetch all and filter below.
  }
  const propsSnap = await q.get();

  if (propsSnap.empty) {
    return { ok: true, processed: 0, updated: 0, skipped: 0, done: true, note: "no props docs for given week/season" };
  }

  // 2) Group props by player (prefer playerId, else name+team+pos key)
  const byKey = new Map();
  const rows = [];
  propsSnap.forEach((d) => rows.push({ id: d.id, ...d.data() }));

  for (const r of rows) {
    if (books && Array.isArray(books) && books.length && r.book && !books.includes(r.book)) {
      continue; // skip books not requested
    }
    const key =
      (r.playerId && String(r.playerId)) ||
      samePlayerKey({ name: r.name, team: r.team, pos: r.pos });

    if (!key) continue;

    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  // 3) Build a lookup to players collection
  //    We’ll try direct match on playerId (= players doc id) first.
  const getPlayerDoc = async (key, anyRow) => {
    // Case A: playerId exists -> doc id
    if (anyRow.playerId) {
      const pRef = playersCol.doc(String(anyRow.playerId));
      const pSnap = await pRef.get();
      if (pSnap.exists) return pSnap;
    }
    // Case B: espnId present in props -> try players where espnId == value
    if (anyRow.espnId) {
      const q = await playersCol.where("espnId", "==", String(anyRow.espnId)).limit(1).get();
      if (!q.empty) return q.docs[0];
    }
    // Case C: fallback name+team+pos
    const name = safeUpper(anyRow.name);
    const team = safeUpper(anyRow.team);
    const pos  = safeUpper(anyRow.pos);
    if (!name) return null;

    // You may not have composite indexes for name/team/pos; keep it simple:
    // try name-only first, then filter by team/pos in memory.
    const q2 = await playersCol.where("name", "==", anyRow.name).get();
    if (!q2.empty) {
      const list = q2.docs.map((d) => ({ snap: d, data: d.data() }));
      // pick best match by team+pos if possible
      let best = list[0];
      for (const cand of list) {
        const cTeam = safeUpper(cand.data.team);
        const cPos  = safeUpper(cand.data.position || cand.data.pos);
        if (cTeam === team && cPos === pos) { best = cand; break; }
        if (cTeam === team) { best = cand; } // weaker match
      }
      return best.snap;
    }

    return null;
  };

  // 4) Compute projections and write
  let processed = 0;
  let updated   = 0;
  let skipped   = 0;

  for (const [key, group] of byKey) {
    processed += 1;
    const merged = accumulateProps(group);
    const pos = merged.pos || group[0].pos || null;
    if (!pos) { skipped += 1; continue; }

    const pts = projectFromProps(pos, merged);
    if (!Number.isFinite(pts) || pts <= 0) { skipped += 1; continue; }

    const anyRow = group[0];
    const pSnap  = await getPlayerDoc(key, anyRow);
    if (!pSnap || !pSnap.exists) {
      skipped += 1;
      continue;
    }

    const projections = pSnap.get("projections") || {};
    const wKey = String(week);
    if (!overwrite && projections[wKey] != null) {
      skipped += 1;
      continue;
    }

    projections[wKey] = pts;

    await pSnap.ref.set({ projections }, { merge: true });
    updated += 1;
  }

  return {
    ok: true,
    processed,
    updated,
    skipped,
    done: true,
  };
}

export default seedWeekProjectionsFromProps;
