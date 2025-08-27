// api/cron/backfill-headshots.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

// Sleeper NFL players catalog (no auth)
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
// Sleeper also has stable headshots by player_id as a fallback:
function sleeperHeadshot(playerId) {
  return `https://sleepercdn.com/content/nfl/players/full/${playerId}.jpg`;
}

export const config = {
  maxDuration: 60, // Vercel edge limit (if using node func, it’s fine too)
};

export default async function handler(req, res) {
  try {
    // 1) Load Sleeper catalog
    const sleeperResp = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
    if (!sleeperResp.ok) {
      return res.status(502).json({ ok: false, error: "Sleeper fetch failed" });
    }
    const sleeperMap = await sleeperResp.json(); // object keyed by sleeper player_id

    // Build a quick lookup by (name|team|pos)
    // Sleeper fields we care about: full_name, team, position, espn_id, player_id
    const byKey = new Map();
    for (const [pid, row] of Object.entries(sleeperMap || {})) {
      const nm = norm(row.full_name || row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.last_name || "");
      const tm = norm(row.team);
      const ps = norm(row.position);
      const key = `${nm}|${tm}|${ps}`;
      if (!byKey.has(key)) byKey.set(key, { ...row, player_id: pid });
    }

    // helper: try to map a single player doc to sleeper row
    function matchSleeper(p) {
      const nm = norm(displayName(p));
      const tm = norm(p.team);
      const ps = norm(p.position);
      const exact = byKey.get(`${nm}|${tm}|${ps}`);
      if (exact) return exact;

      // fallback: ignore position if needed
      const loose = byKey.get(`${nm}|${tm}|`);
      if (loose) return loose;

      // last resort: name only (can be ambiguous)
      for (const [k, v] of byKey.entries()) {
        if (k.startsWith(`${nm}|`)) return v;
      }
      return null;
    }

    // 2) Update GLOBAL players collection
    const globalSnap = await adminDb.collection("players").get();
    let updated = 0, already = 0, total = globalSnap.size;

    const batch = adminDb.batch();
    let ops = 0;
    for (const doc of globalSnap.docs) {
      const p = doc.data() || {};
      // Skip if you already have a headshot
      if (p.headshotUrl) { already++; continue; }

      let espnId = p.espnId || p.espn_id;
      let headshotUrl = p.headshotUrl || p.photo || p.imageUrl || null;

      if (!espnId || !headshotUrl) {
        const match = matchSleeper(p);
        if (match) {
          if (!espnId && match.espn_id) espnId = String(match.espn_id);
          // Prefer ESPN if we found espn_id; else Sleeper fallback
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

      // Commit in chunks to avoid 500+ doc batches
      if (ops >= 400) {
        await batch.commit();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();

    // 3) Optionally, loop each league’s scoped players, too
    // Comment this section out if you don’t use league-scoped players.
    const leaguesSnap = await adminDb.collection("leagues").get();
    let leagueDocsTouched = 0;
    for (const L of leaguesSnap.docs) {
      const lPlayers = await adminDb.collection("leagues").doc(L.id).collection("players").get();
      if (lPlayers.empty) continue;

      const lbatch = adminDb.batch();
      let lops = 0;
      for (const pd of lPlayers.docs) {
        const p = pd.data() || {};
        if (p.headshotUrl) continue;

        let espnId = p.espnId || p.espn_id;
        let headshotUrl = p.headshotUrl || p.photo || p.imageUrl || null;

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

        if (lops >= 400) {
          await lbatch.commit();
          lops = 0;
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
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
