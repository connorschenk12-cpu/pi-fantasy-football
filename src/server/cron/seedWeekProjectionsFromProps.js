/* eslint-disable no-console */
// src/server/cron/seedWeekProjectionsFromProps.js
// Build projections from betting props stored in Firestore:
//   /props/{season}/week-{week}/lines/{espnId}
//
// Each doc should contain implied mean stats (not raw over/under numbers), e.g.:
// {
//   position: "QB"|"RB"|"WR"|"TE"|"K"|"DEF",
//   team: "BAL",
//   name: "Lamar Jackson",
//   passYds: 235.5, passTD: 1.6, passInt: 0.7,
//   rushYds: 44.5,  rushTD: 0.35,
//   rec: 0,         recYds: 0, recTD: 0,
//   fumbles: 0
// }
// Any missing fields are treated as 0.

function n(v) {
  return v == null ? 0 : Number(v) || 0;
}

// PPR scoring (matches your front-end helpers)
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

// Compute fantasy points from implied means
function computePointsFromProps(row) {
  const pts =
    n(row.passYds) * S.passYds +
    n(row.passTD) * S.passTD +
    n(row.passInt) * S.passInt +
    n(row.rushYds) * S.rushYds +
    n(row.rushTD) * S.rushTD +
    n(row.recYds) * S.recYds +
    n(row.recTD) * S.recTD +
    n(row.rec) * S.rec +
    n(row.fumbles) * S.fumbles;

  // one decimal like your UI
  return Math.round(pts * 10) / 10;
}

export async function seedWeekProjectionsFromProps({
  adminDb,
  week,
  season,
  limit,       // unused here; we process all docs in the props subcollection
  cursor,      // unused
  overwrite = false,
}) {
  if (!adminDb) throw new Error("adminDb required");
  if (!season || !week) {
    return { ok: false, error: "missing season/week" };
  }

  const linesCol = adminDb
    .collection("props")
    .doc(String(season))
    .collection(`week-${week}`)
    .doc("lines")
    // If you prefer one-doc-per-player under a subcollection "items"
    // .collection("items");
    // But this implementation assumes "lines" is a *collection*, so:
    // 👇 change to: .collection("lines")
  ;

  // Most folks want "lines" as a subcollection:
  // /props/{season}/week-{week}/lines/{espnId}
  const colRef = adminDb
    .collection("props")
    .doc(String(season))
    .collection(`week-${week}`)
    .collection("lines");

  const playersCol = adminDb.collection("players");

  const snap = await colRef.get();
  const found = snap.size;

  if (!found) {
    return {
      ok: true,
      source: "props",
      processed: 0,
      updated: 0,
      skipped: 0,
      done: true,
      note: "no props docs for given week/season",
    };
  }

  // Make a quick index of existing players by espnId for faster writes
  const playersByEspn = new Map();
  const playersSnap = await playersCol
    .where("espnId", ">", "") // only players that actually have espnId
    .get();

  playersSnap.forEach((d) => {
    const p = d.data() || {};
    if (p.espnId) playersByEspn.set(String(p.espnId), d.ref);
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  // Batch writes for speed
  const batchSize = 400;
  let batch = adminDb.batch();
  let inBatch = 0;

  for (const doc of snap.docs) {
    processed++;
    const espnId = doc.id; // we expect {espnId} as the doc id
    const row = doc.data() || {};
    const points = computePointsFromProps(row);

    const playerRef = playersByEspn.get(String(espnId));
    if (!playerRef) {
      // Silent skip for players not in your "players" collection
      skipped++;
      continue;
    }

    // Merge into projections[week]
    // Respect overwrite flag: if projections[week] exists and !overwrite, skip
    const playerDoc = await playerRef.get();
    const pdata = playerDoc.data() || {};
    const projections = { ...(pdata.projections || {}) };

    if (!overwrite && projections[String(week)] != null) {
      skipped++;
      continue;
    }

    projections[String(week)] = points;

    batch.set(playerRef, { projections }, { merge: true });
    updated++;
    inBatch++;

    if (inBatch >= batchSize) {
      await batch.commit();
      batch = adminDb.batch();
      inBatch = 0;
    }
  }

  if (inBatch > 0) {
    await batch.commit();
  }

  return {
    ok: true,
    source: "props",
    processed,
    updated,
    skipped,
    done: true,
  };
}

export default seedWeekProjectionsFromProps;
