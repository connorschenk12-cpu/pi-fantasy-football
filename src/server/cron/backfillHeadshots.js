// api/cron/backfill-headshots.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";
const BATCH_CHUNK = 350;

const norm = (s) => String(s || "").trim().toLowerCase();
const displayName = (p) =>
  p.name ||
  p.full_name ||
  p.fullName ||
  `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
  String(p.id || "");

const espnHeadshot = (espnId) =>
  `https://a.espncdn.com/i/headshots/nfl/players/full/${String(espnId).replace(/[^\d]/g, "")}.png`;
const sleeperHeadshot = (playerId) =>
  `https://sleepercdn.com/content/nfl/players/full/${playerId}.jpg`;

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    // 1) load Sleeper catalog
    const sleeperResp = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (!sleeperResp.ok) {
      return res.status(502).json({ ok: false, error: "Sleeper fetch failed" });
    }
    const sleeperMap = await sleeperResp.json(); // { [player_id]: row }

    // quick index: name|team|pos
    const byKey = new Map();
    for (const [pid, row] of Object.entries(sleeperMap || {})) {
      const nm = norm(
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
      const exact = byKey.get(`${nm}|${tm}|${ps}`);
      if (exact) return exact;

      const loose = byKey.get(`${nm}|${tm}|`);
      if (loose) return loose;

      for (const [k, v] of byKey.entries()) {
        if (k.startsWith(`${nm}|`)) return v;
      }
      return null;
    };

    // 2) iterate global players and patch missing fields
    const globalSnap = await adminDb.collection("players").get();
    let updated = 0;
    let already = 0;
    let scanned = 0;

    let batch = adminDb.batch();
    let ops = 0;

    for (const doc of globalSnap.docs) {
      scanned++;
      const p = doc.data() || {};
      const haveHeadshot =
        p.photo || p.photoUrl || p.photoURL || p.headshot || p.headshotUrl || p.image || p.imageUrl;

      if (p.espnId && haveHeadshot) {
        already++;
        continue;
      }

      let espnId = p.espnId || p.espn_id || null;
      let photo =
        p.photo || p.photoUrl || p.photoURL || p.headshot || p.headshotUrl || p.image || p.imageUrl || null;

      if (!espnId || !photo) {
        const match = matchSleeper(p);
        if (match) {
          if (!espnId && match.espn_id) espnId = String(match.espn_id);
          if (!photo) {
            photo = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
          }
        }
      }

      if (espnId || photo) {
        batch.update(doc.ref, {
          ...(espnId ? { espnId } : {}),
          ...(photo ? { photo } : {}),
          updatedAt: new Date(),
        });
        ops++;
        updated++;
      }

      if (ops >= BATCH_CHUNK) {
        await batch.commit();
        batch = adminDb.batch(); // IMPORTANT: new batch after commit
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    return res.json({
      ok: true,
      scanned,
      globalUpdated: updated,
      globalAlreadyHadPhotos: already,
    });
  } catch (err) {
    console.error("backfill-headshots error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
