/* eslint-disable no-console */
// api/cron/backfill-headshots.js
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = {
  // Give the function more wall clock to finish batching
  maxDuration: 60,
};

const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

// Limit how many docs we attempt in one run so we never exceed time limits
const GLOBAL_LIMIT = 3500;
const LEAGUE_LIMIT_PER_LEAGUE = 800;
const BATCH_WRITE_MAX = 400;

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
  const startedAt = Date.now();
  try {
    // Optional: simple secret check for cron
    const auth = req.headers["x-cron-secret"];
    if (process.env.CRON_SECRET && auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // 1) Load Sleeper catalog once
    let sleeperResp;
    try {
      sleeperResp = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    } catch (err) {
      console.error("Sleeper fetch failed:", err);
      return res.status(502).json({ ok: false, where: "fetch Sleeper", error: String(err) });
    }

    if (!sleeperResp.ok) {
      const body = await sleeperResp.text().catch(() => "");
      console.error("Sleeper non-200:", sleeperResp.status, body);
      return res.status(502).json({ ok: false, where: "Sleeper", status: sleeperResp.status, body });
    }

    let sleeperMap;
    try {
      sleeperMap = await sleeperResp.json();
    } catch (err) {
      console.error("Invalid Sleeper JSON:", err);
      return res.status(502).json({ ok: false, where: "parse Sleeper JSON", error: String(err) });
    }

    // Build a quick lookup by (name|team|pos)
    const byKey = new Map();
    for (const [pid, row] of Object.entries(sleeperMap || {})) {
      const nm = norm(
        row.full_name ||
          (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.last_name || "")
      );
      const tm = norm(row.team || "");
      const ps = norm(row.position || "");
      const key = `${nm}|${tm}|${ps}`;
      if (!byKey.has(key)) byKey.set(key, { ...row, player_id: pid });
    }

    function matchSleeper(p) {
      const nm = norm(displayName(p));
      const tm = norm(p.team || p.nflTeam || p.proTeam || "");
      const ps = norm(p.position || p.pos || "");
      const exact = byKey.get(`${nm}|${tm}|${ps}`);
      if (exact) return exact;

      const loose = byKey.get(`${nm}|${tm}|`);
      if (loose) return loose;

      for (const [k, v] of byKey.entries()) {
        if (k.startsWith(`${nm}|`)) return v;
      }
      return null;
    }

    // 2) Update GLOBAL players collection (capped)
    const globalSnap = await adminDb.collection("players").get();
    const totalGlobal = globalSnap.size;

    let updatedGlobal = 0;
    let alreadyGlobal = 0;
    let examinedGlobal = 0;

    let batch = adminDb.batch();
    let ops = 0;

    for (const doc of globalSnap.docs) {
      if (examinedGlobal >= GLOBAL_LIMIT) break;
      examinedGlobal++;

      const p = doc.data() || {};
      const hasPhoto =
        p.headshotUrl || p.photo || p.photoUrl || p.photoURL || p.imageUrl || p.image || p.headshot;
      if (hasPhoto) {
        alreadyGlobal++;
        continue;
      }

      let espnId = p.espnId || p.espn_id || null;
      let headshotUrl = null;

      const match = matchSleeper(p);
      if (match) {
        if (!espnId && match.espn_id) espnId = String(match.espn_id);
        headshotUrl = match.espn_id ? espnHeadshot(match.espn_id) : sleeperHeadshot(match.player_id);
      }

      if (espnId || headshotUrl) {
        batch.update(doc.ref, {
          ...(espnId ? { espnId } : {}),
          ...(headshotUrl ? { headshotUrl, photo: headshotUrl } : {}),
          updatedAt: new Date(),
        });
        ops++;
        updatedGlobal++;

        if (ops >= BATCH_WRITE_MAX) {
          await batch.commit();
          batch = adminDb.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();

    // 3) League-scoped players (optional; also capped per league)
    const leaguesSnap = await adminDb.collection("leagues").get();
    let leagueDocsTouched = 0;
    let leaguesProcessed = 0;

    for (const L of leaguesSnap.docs) {
      leaguesProcessed++;

      const lPlayers = await adminDb.collection("leagues").doc(L.id).collection("players").get();
      if (lPlayers.empty) continue;

      let lbatch = adminDb.batch();
      let lops = 0;
      let lcount = 0;

      for (const pd of lPlayers.docs) {
        if (lcount >= LEAGUE_LIMIT_PER_LEAGUE) break;
        lcount++;

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

        let espnId = p.espnId || p.espn_id || null;
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

          if (lops >= BATCH_WRITE_MAX) {
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
      millis: Date.now() - startedAt,
      sleeperCount: Object.keys(sleeperMap || {}).length,
      global: {
        total: totalGlobal,
        examined: examinedGlobal,
        updated: updatedGlobal,
        alreadyHadPhotos: alreadyGlobal,
      },
      leaguesProcessed,
      leagueDocsTouched,
      caps: {
        GLOBAL_LIMIT,
        LEAGUE_LIMIT_PER_LEAGUE,
        BATCH_WRITE_MAX,
      },
    });
  } catch (err) {
    console.error("backfill-headshots top-level error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
