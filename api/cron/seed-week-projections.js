// /api/cron/seed-week-projections.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

const PPR = {
  passYds: 0.04, passTD: 4, passInt: -2,
  rushYds: 0.1, rushTD: 6,
  recYds: 0.1, recTD: 6, rec: 1,
  fumbles: -2,
};
const n = (v) => (v == null ? 0 : Number(v) || 0);
const points = (row) => Math.round((
  n(row.passYds) * PPR.passYds +
  n(row.passTD) * PPR.passTD +
  n(row.passInt) * PPR.passInt +
  n(row.rushYds) * PPR.rushYds +
  n(row.rushTD) * PPR.rushTD +
  n(row.recYds)  * PPR.recYds +
  n(row.recTD)   * PPR.recTD +
  n(row.rec)     * PPR.rec +
  n(row.fumbles) * PPR.fumbles
) * 10) / 10;

async function fetchJson(u, where) {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${where} ${r.status}: ${t.slice(0,200)}`);
  }
  return r.json();
}

function pickSeason(url, fallbackYear) {
  // prefer ?season=YYYY if provided in request, else current year
  return Number(fallbackYear || new Date().getFullYear());
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const week = Number(url.searchParams.get("week") || "1");
    const season = pickSeason(url, url.searchParams.get("season"));

    if (!Number.isFinite(week) || week < 1) {
      return res.status(400).json({ ok: false, error: "week query param required (>=1)" });
    }

    // pull all players
    const snap = await adminDb.collection("players").get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const withEids = docs.filter((p) => p.espnId);

    let updated = 0;
    let lookedUp = 0;
    const perBatch = 400;

    for (let i = 0; i < withEids.length; i += perBatch) {
      const batch = adminDb.batch();
      const slice = withEids.slice(i, i + perBatch);

      // resolve per-athlete season totals → per-game PPR
      const results = await Promise.allSettled(slice.map(async (p) => {
        const statsUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${p.espnId}/statistics/${season}`;
        const j = await fetchJson(statsUrl, "athlete-stats");

        // The shape varies; find totals in any categories list
        // We’ll scan for values by “name”/“abbreviation” strings.
        const categories = j?.splits?.categories || j?.categories || [];
        const get = (groupName, pred) => {
          const g = categories.find(c => (c?.name || "").toLowerCase() === groupName);
          if (!g || !Array.isArray(g?.stats)) return 0;
          const s = g.stats.find(s =>
            pred(s?.name) || pred(s?.shortDisplayName) || pred(s?.abbreviation)
          );
          return s?.value != null ? Number(s.value) : 0;
        };

        // totals (season)
        const passYds = get("passing", v => v === "yards" || v === "YDS");
        const passTD  = get("passing", v => v === "touchdowns" || v === "TD");
        const passInt = get("passing", v => v === "interceptions" || v === "INT");

        const rushYds = get("rushing", v => v === "yards" || v === "YDS");
        const rushTD  = get("rushing", v => v === "touchdowns" || v === "TD");

        const recYds  = get("receiving", v => v === "yards" || v === "YDS");
        const recTD   = get("receiving", v => v === "touchdowns" || v === "TD");
        const rec     = get("receiving", v => v === "receptions" || v === "REC");

        // fumbles (lost)
        const fumbles = get("fumbles", v => v === "lost" || v === "LOST");

        // games played can show up in a “games”/“general” group
        const games =
          get("games", v => v === "gamesPlayed") ||
          get("general", v => v === "gamesPlayed") ||
          0;

        lookedUp += 1;

        const perGame = games > 0
          ? points({ passYds: passYds / games, passTD: passTD / games, passInt: passInt / games,
                     rushYds: rushYds / games, rushTD: rushTD / games,
                     recYds: recYds / games, recTD: recTD / games, rec: rec / games,
                     fumbles: fumbles / games })
          : 0;

        return { id: p.id, perGame };
      }));

      // write projections[week] = perGame (only when > 0)
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { id, perGame } = r.value || {};
        if (!id) continue;

        const ref = adminDb.collection("players").doc(String(id));
        batch.set(ref, {
          projections: { [String(week)]: perGame || 0 },
          updatedAt: new Date(),
        }, { merge: true });
        updated += 1;
      }

      await batch.commit();
    }

    return res.status(200).json({
      ok: true,
      season,
      week,
      lookedUp,
      updated,
      note: "Baseline projections = season per-game PPR",
    });
  } catch (e) {
    console.error("seed-week-projections fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
