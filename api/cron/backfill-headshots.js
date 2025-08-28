/* eslint-disable no-console */
// api/cron/backfill-headshots.js
import { adminDb } from "@/src/lib/firebaseAdmin";

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

function norm(s) {
  return String(s || "").trim().toLowerCase();
}
function displayName(p) {
  return (
    p.name ||
    p.full_name ||
    p.fullName ||
    `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
    String(p.id || "")
  );
}
function espnHeadshot(espnId) {
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
}
function sleeperHeadshot(playerId) {
  return `https://sleepercdn.com/content/nfl/players/full/${playerId}.jpg`;
}

export default async function handler(req, res) {
  try {
    // Optional: cron secret
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 1) Load Sleeper catalog
    const sleeperResp = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (!sleeperResp.ok) {
      const body = await sleeperResp.text().catch(() => "");
      return res
        .status(502)
        .json({ ok: false, error: `Sleeper fetch failed (${sleeperResp.status})`, body });
    }
    const sleeperMap = await sleeperResp.json(); // object keyed by player_id

    // Build quick lookup by (name|team|pos)
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

    function matchSleeper(p) {
      const nm = norm(displayName(p));
      const tm = norm(p.team);
      const ps = norm(p.position);
      const exact = byKey.get(`${nm}|${tm}|${ps}`);
      if (exact) return exact;

      // fallback: ignore position if needed
      const loose = byKey.get(`${nm}|${tm}|`);
      if (loose) return loose;

      // last resort: name only
      for (const [k, v] of byKey.entries()) {
        if (k.startsWith(`${nm}|`)) return v;
      }
      return null;
    }

    // 2) Update GLOBAL players collection
    const globalSnap = await adminDb.collection("players").get();
    let updated = 0,
      already = 0,
      total = globalSnap.size;

    let batch = adminDb.batch();
    let ops = 0;

    for (const doc of globalSnap.docs) {
      const p = doc.data() || {};

      // If any photo field already present, skip
      const hasPhoto =
        p.headshotUrl || p.photo || p.photoUrl || p.photoURL || p.imageUrl || p.image || p.headshot;
      if (hasPhoto) {
        already++;
        continue;
      }

      let espnId = p.espnId || p.espn_id;
      let headshotUrl = null;

      // Try to resolve via Sleeper
      const match = matchSleeper(p);
      if (match) {
        if (!espnId && match.espn_id) espnId = String(match.espn_id);
        headshotUrl = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
      }

      if (espnId || headshotUrl) {
        batch.update(doc.ref, {
          ...(espnId ? { espnId } : {}),
          ...(headshotUrl ? { headshotUrl, photo: headshotUrl } : {}), // write to both common fields
          updatedAt: new Date(),
        });
        ops++;
        updated++;

        // Commit in chunks to stay under Firestore limits
        if (ops >= 400) {
          await batch.commit();
          batch = adminDb.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();

    // 3) Also touch league-scoped players (optional; safe to keep)
    const leaguesSnap = await adminDb.collection("leagues").get();
    let leagueDocsTouched = 0;

    for (const L of leaguesSnap.docs) {
      const lPlayers = await adminDb.collection("leagues").doc(L.id).collection("players").get();
      if (lPlayers.empty) continue;

      let lbatch = adminDb.batch();
      let lops = 0;

      for (const pd of lPlayers.docs) {
        const p = pd.data() || {};
        const hasPhoto =
          p.headshotUrl ||
          p.photo ||
          p.photoUrl ||
          p.photoURL ||
          p.imageUrl ||
          p.image ||
          p.headshot;
        if (hasPhoto) continue;

        let espnId = p.espnId || p.espn_id;
        let headshotUrl = null;

        const match = matchSleeper(p);
        if (match) {
          if (!espnId && match.espn_id) espnId = String(match.espn_id);
          headshotUrl = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
        }

        if (espnId || headshotUrl) {
          lbatch.update(pd.ref, {
            ...(espnId ? { espnId } : {}),
            ...(headshotUrl ? { headshotUrl, photo: headshotUrl } : {}),
            updatedAt: new Date(),
          });
          lops++;
          leagueDocsTouched++;

          if (lops >= 400) {
            await lbatch.commit();
            lbatch = adminDb.batch();
            lops = 0;
          }
        }
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
    console.error("backfill-headshots error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
