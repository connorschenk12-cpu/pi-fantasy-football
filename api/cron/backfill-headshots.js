// api/cron/backfill-headshots.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const norm = (s) => String(s || "").trim().toLowerCase();
const displayName = (p) =>
  p.name ||
  p.full_name ||
  p.fullName ||
  `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
  String(p.id || "");
const espnHeadshot = (espnId) =>
  `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
const sleeperHeadshot = (playerId) =>
  `https://sleepercdn.com/content/nfl/players/full/${playerId}.jpg`;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    // Accept GET/POST from the browser (no secret check, for now)

    // 1) Load Sleeper catalog
    const sleeperResp = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (!sleeperResp.ok) {
      const txt = await sleeperResp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "Sleeper fetch failed", status: sleeperResp.status, body: txt });
    }
    const sleeperMap = await sleeperResp.json();

    const byKey = new Map();
    for (const [pid, row] of Object.entries(sleeperMap || {})) {
      const nm =
        norm(
          row.full_name ||
            (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.last_name || "")
        );
      const tm = norm(row.team);
      const ps = norm(row.position);
      const key = `${nm}|${tm}|${ps}`;
      if (!byKey.has(key)) byKey.set(key, { ...row, player_id: pid });
    }

    const matchSleeper = (p) => {
      const nm = norm(displayName(p));
      const tm = norm(p.team);
      const ps = norm(p.position);
      return (
        byKey.get(`${nm}|${tm}|${ps}`) ||
        byKey.get(`${nm}|${tm}|`) ||
        [...byKey.entries()].find(([k]) => k.startsWith(`${nm}|`))?.[1] ||
        null
      );
    };

    // 2) Update GLOBAL players
    const globalSnap = await adminDb.collection("players").get();
    let updated = 0, already = 0, total = globalSnap.size;

    let batch = adminDb.batch();
    let ops = 0;

    for (const doc of globalSnap.docs) {
      const p = doc.data() || {};
      // Prefer any existing explicit headshot fields you use
      const existingUrl = p.headshotUrl || p.photo || p.imageUrl || p.photoUrl || null;
      if (existingUrl) { already++; continue; }

      let espnId = p.espnId || p.espn_id;
      let headshotUrl = existingUrl;

      if (!espnId || !headshotUrl) {
        const match = matchSleeper(p);
        if (match) {
          if (!espnId && match.espn_id) espnId = String(match.espn_id);
          if (!headshotUrl) {
            headshotUrl = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
          }
        }
      }

      if (headshotUrl || espnId) {
        batch.update(doc.ref, {
          ...(espnId ? { espnId } : {}),
          ...(headshotUrl ? { headshotUrl } : {}),
          updatedAt: new Date(),
        });
        ops++; updated++;
      }

      if (ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();

    // 3) League-scoped players (optional)
    const leaguesSnap = await adminDb.collection("leagues").get();
    let leagueDocsTouched = 0;

    for (const L of leaguesSnap.docs) {
      const lPlayers = await adminDb.collection("leagues").doc(L.id).collection("players").get();
      if (lPlayers.empty) continue;

      let lbatch = adminDb.batch();
      let lops = 0;

      for (const pd of lPlayers.docs) {
        const p = pd.data() || {};
        const existingUrl = p.headshotUrl || p.photo || p.imageUrl || p.photoUrl || null;
        if (existingUrl) continue;

        let espnId = p.espnId || p.espn_id;
        let headshotUrl = existingUrl;

        if (!espnId || !headshotUrl) {
          const match = matchSleeper(p);
          if (match) {
            if (!espnId && match.espn_id) espnId = String(match.espn_id);
            if (!headshotUrl) {
              headshotUrl = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
            }
          }
        }

        if (espnId || headshotUrl) {
          lbatch.update(pd.ref, {
            ...(espnId ? { espnId } : {}),
            ...(headshotUrl ? { headshotUrl } : {}),
            updatedAt: new Date(),
          });
          lops++; leagueDocsTouched++;
        }

        if (lops >= 400) { await lbatch.commit(); lbatch = adminDb.batch(); lops = 0; }
      }
      if (lops > 0) await lbatch.commit();
    }

    return res.status(200).json({
      ok: true,
      totalGlobal: total,
      globalUpdated: updated,
      globalAlreadyHadPhotos: already,
      leagueDocsTouched,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
