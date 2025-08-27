// src/pages/api/stats/week.js
// If you use the App Router, adapt to: export async function GET(req) { ... }

export default async function handler(req, res) {
  try {
    const { week } = req.query;
    const weekNum = Number(week || 1);

    // Figure out the "season" (roughly Sep–Feb is NFL season crossing the new year)
    const now = new Date();
    const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    // Regular season == seasontype=2; preseason=1; playoffs=3
    const seasontype = 2;

    // 1) Scoreboard => list of event (game) IDs for this week
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&seasontype=${seasontype}&week=${weekNum}`;
    const sc = await fetch(scoreboardUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!sc.ok) {
      return res.status(200).json({ stats: {}, note: `scoreboard not ok ${sc.status}` });
    }
    const scJson = await sc.json();
    const events = Array.isArray(scJson?.events) ? scJson.events : [];

    // 2) For each event, grab live "summary" (includes box score / leaders / athletes)
    //    Build a single { [athleteId]: statRow } map.
    const statsMap = new Map();

    // PPR scoring weights
    const S = {
      passYds: 0.04,  // 1 per 25
      passTD: 4,
      passInt: -2,
      rushYds: 0.1,   // 1 per 10
      rushTD: 6,
      recYds: 0.1,    // 1 per 10
      recTD: 6,
      rec: 1,
      fumbles: -2,
    };
    const n = (v) => (v == null ? 0 : Number(v) || 0);
    const computePoints = (row) => {
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
      return Math.round(pts * 10) / 10;
    };

    // Helpers to normalize ESPN team/athlete shapes into our minimal row
    const teamAbbrev = (team) =>
      team?.abbreviation ||
      team?.team?.abbreviation ||
      team?.shortDisplayName ||
      team?.displayName ||
      '';

    const addRow = (athlete, team, partial) => {
      const espnId = String(athlete?.id || '');
      if (!espnId) return;

      const first = athlete?.firstName || '';
      const last  = athlete?.lastName || '';
      const full  = athlete?.displayName || [first, last].filter(Boolean).join(' ').trim() || '';
      const pos   = (athlete?.position?.abbreviation || athlete?.position?.name || '').toUpperCase();
      const teamAbbr = teamAbbrev(team);

      const row = {
        id: espnId,
        espnId,
        name: full,
        firstName: first,
        lastName: last,
        position: pos,
        team: teamAbbr,
        ...partial,
      };
      row.points = computePoints(row);

      // primary key: espnId
      statsMap.set(espnId, row);
      // secondary fuzzy key: name|team (uppercase, trimmed)
      const fuzzyKey = `${full.toUpperCase()}|${teamAbbr.toUpperCase()}`.trim();
      if (full && teamAbbr) statsMap.set(fuzzyKey, row);
    };

    // Pull summary per game
    // ESPN "summary" path: /summary?event={eventId}
    const summaries = await Promise.all(
      events.map(async (ev) => {
        const eventId = ev?.id || ev?.uid?.split('~').pop();
        if (!eventId) return null;
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      })
    );

    // 3) Extract box score / leaders into player stat rows
    for (const sum of summaries) {
      if (!sum) continue;

      // Box score players are in sum.boxscore.players[].statistics (grouped by type)
      const teams = Array.isArray(sum?.boxscore?.players) ? sum.boxscore.players : [];
      for (const t of teams) {
        const teamObj = t?.team || t?.teamData || null;
        const athletes = Array.isArray(t?.statistics) ? t.statistics : [];
        // statistics is an array of stat-groups (passing, rushing, receiving, fumbles, etc)
        for (const group of athletes) {
          const atts = Array.isArray(group?.athletes) ? group.athletes : [];
          for (const a of atts) {
            const athlete = a?.athlete || a; // sometimes nested
            const statVals = a?.stats || a?.statistics || [];
            const labels   = a?.labels || group?.labels || []; // e.g., ["CMP/ATT","YDS","TD","INT"]

            // We’ll populate our neutral schema fields:
            let passYds=0, passTD=0, passInt=0, rushYds=0, rushTD=0, recYds=0, recTD=0, rec=0, fumbles=0;

            // ESPN’s stats are arrays of strings; we need to parse by label
            // Try common groups: passing, rushing, receiving, fumbles (labels vary per group)
            if (group?.type?.toLowerCase?.().includes('pass')) {
              // Typical labels: ["CMP/ATT","YDS","TD","INT","QBR","RTG","SACKS"] — we want YDS, TD, INT
              labels.forEach((lab, i) => {
                const v = Number(String(statVals[i] || '0').replace(/[^\d.-]/g, '')) || 0;
                const key = lab.toUpperCase();
                if (key.includes('YDS')) passYds = v;
                if (key === 'TD') passTD = v;
                if (key === 'INT') passInt = v;
              });
            }
            if (group?.type?.toLowerCase?.().includes('rush')) {
              labels.forEach((lab, i) => {
                const v = Number(String(statVals[i] || '0').replace(/[^\d.-]/g, '')) || 0;
                const key = lab.toUpperCase();
                if (key.includes('YDS')) rushYds = v;
                if (key === 'TD') rushTD = v;
              });
            }
            if (group?.type?.toLowerCase?.().includes('receiv')) {
              labels.forEach((lab, i) => {
                const v = Number(String(statVals[i] || '0').replace(/[^\d.-]/g, '')) || 0;
                const key = lab.toUpperCase();
                if (key === 'REC' || key.includes('RECEPTIONS')) rec = v;
                if (key.includes('YDS')) recYds = v;
                if (key === 'TD') recTD = v;
              });
            }
            if (group?.type?.toLowerCase?.().includes('fumble')) {
              labels.forEach((lab, i) => {
                const key = lab.toUpperCase();
                if (key.includes('LOST')) {
                  const v = Number(String(statVals[i] || '0').replace(/[^\d.-]/g, '')) || 0;
                  fumbles = v;
                }
              });
            }

            addRow(athlete, teamObj, {
              passYds, passTD, passInt,
              rushYds, rushTD,
              recYds,  recTD,  rec,
              fumbles,
            });
          }
        }
      }
    }

    // 4) Return a plain object (Next/Vercel can’t serialize Maps)
    const out = {};
    for (const [k, v] of statsMap.entries()) out[k] = v;

    res.status(200).json({ stats: out, source: 'espn-live', week: weekNum, year });
  } catch (e) {
    console.error('week handler error', e);
    res.status(200).json({ stats: {}, error: String(e?.message || e) });
  }
}
