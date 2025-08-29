// api/players/espn.js
/* eslint-disable no-console */

/**
 * ESPN sources (no auth):
 * - Teams list:        https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams
 * - Team w/ roster:    https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/:id?enable=roster
 *
 * We normalize to ONE canonical player per ESPN athlete:
 *   id       -> String(athlete.id)
 *   espnId   -> Number(athlete.id)
 *   name     -> athlete.fullName
 *   position -> athlete.position.abbreviation (QB/RB/WR/TE/K/DEF*)
 *   team     -> team.abbreviation (ATL, BUF, …). For team defenses we synthesize one "DEF" row.
 *   photo    -> stable ESPN headshot by ID
 *
 * Notes:
 * - Team defenses are not listed as athletes. We create a synthetic DEF per team: id = "{teamId}-DEF".
 * - No projections here—this endpoint is your "roster canon". Seed projections elsewhere if needed.
 */

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

function espnHeadshotById(espnId) {
  const id = String(espnId).replace(/[^\d]/g, "");
  return id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png` : null;
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} ${url}`);
  return r.json();
}

function normalizeAthlete(a, teamAbbr) {
  const espnId = a?.id;
  if (espnId == null) return null;

  const pos = (a?.position?.abbreviation || "").toUpperCase();
  const name = a?.fullName || a?.displayName || a?.shortName || String(espnId);

  return {
    id: String(espnId),           // 🔑 canonical id = espnId (string)
    espnId: Number(espnId),       // numeric copy
    name,
    position: pos || null,        // QB/RB/WR/TE/K (players only)
    team: teamAbbr || null,       // e.g. ATL
    photo: espnHeadshotById(espnId),
    // leave projections/matchups empty here (seedPlayersToGlobal will merge later)
  };
}

function synthDefense(teamId, teamAbbr, teamName) {
  const id = `T${teamId}-DEF`;
  return {
    id,
    espnId: null,
    name: `${teamName} DEF`,
    position: "DEF",
    team: teamAbbr || null,
    photo: null, // optional: you can assign a shield logo if you have one
  };
}

export default async function handler(req, res) {
  try {
    // 1) Get teams
    const teamsJson = await fetchJson(`${BASE}/teams`);
    // ESPN embeds teams under sports[0].leagues[0].teams[]
    const teamsArr =
      teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map(t => t?.team)?.filter(Boolean) || [];

    if (teamsArr.length === 0) {
      return res.status(500).json({ ok: false, error: "No teams from ESPN" });
    }

    // 2) For each team, pull roster
    const players = [];
    for (const T of teamsArr) {
      const teamId = T.id;
      const teamAbbr = T.abbreviation || null;
      const teamName = T.displayName || T.name || teamAbbr || `Team ${teamId}`;

      // roster
      const detail = await fetchJson(`${BASE}/teams/${teamId}?enable=roster`);
      const rosterEntries =
        detail?.team?.athletes?.flatMap(g => g?.items || []) ||
        detail?.athletes?.flatMap(g => g?.items || []) || [];

      for (const a of rosterEntries) {
        const norm = normalizeAthlete(a, teamAbbr);
        if (norm && norm.position && norm.position !== "DEF") players.push(norm);
      }

      // Add a synthetic Defense row per team so DEF slot is available in drafts
      players.push(synthDefense(teamId, teamAbbr, teamName));
    }

    // 3) De-dupe by canonical id (espnId-string or T{teamId}-DEF)
    const byId = new Map();
    for (const p of players) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    const unique = Array.from(byId.values());

    return res.status(200).json({
      ok: true,
      count: unique.length,
      players: unique,
    });
  } catch (e) {
    console.error("players/espn error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
