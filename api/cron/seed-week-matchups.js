// /api/cron/seed-week-matchups.js
/* eslint-disable no-console */
import { adminDb } from "../../src/lib/firebaseAdmin.js";

export const config = { maxDuration: 60 };

async function fetchJson(u, label) {
  const r = await fetch(u, { headers: { "x-espn-site-app": "sports" }, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${label} ${r.status}: ${t.slice(0,200)}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const week = url.searchParams.get("week");
    const season = Number(url.searchParams.get("season")) || new Date().getFullYear();
    const seasontype = Number(url.searchParams.get("seasontype")) || 2;

    const sbUrl = week
      ? `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?week=${encodeURIComponent(week)}&seasontype=${seasontype}&season=${season}`
      : `https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard?seasontype=${seasontype}&season=${season}`;

    const sc = await fetchJson(sbUrl, "scoreboard");
    const events = Array.isArray(sc?.events) ? sc.events : [];
    const opp = new Map(); // teamAbbr -> opponentAbbr

    for (const e of events) {
      const c = Array.isArray(e?.competitions) ? e.competitions[0] : null;
      const teams = Array.isArray(c?.competitors) ? c.competitors : [];
      if (teams.length === 2) {
        const a = teams[0]?.team?.abbreviation;
        const b = teams[1]?.team?.abbreviation;
        if (a && b) { opp.set(a.toUpperCase(), b.toUpperCase()); opp.set(b.toUpperCase(), a.toUpperCase()); }
      }
    }

    // batch update players.matchups[week].opp where team matches
    const snap = await adminDb.collection("players").get();
    let touched = 0;
    let i = 0;
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const perBatch = 400;

    while (i < docs.length) {
      const slice = docs.slice(i, i + perBatch);
      const batch = adminDb.batch();
      for (const p of slice) {
        const t = (p.team || "").toUpperCase();
        const o = opp.get(t);
        if (!o) continue;
        const ref = adminDb.collection("players").doc(String(p.id));
        batch.set(ref, { matchups: { [String(week || "")]: { opp: o } }, updatedAt: new Date() }, { merge: true });
        touched += 1;
      }
      await batch.commit();
      i += perBatch;
    }

    return res.status(200).json({ ok: true, week: week || "auto", season, touched });
  } catch (e) {
    console.error("seed-week-matchups fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
