/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
// Robust ESPN team + roster import (HTTPS + flexible roster parsing)

import fetchJsonNoStore from "../util/fetchJsonNoStore.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- normalizers ----
const normPos = (pos) => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
};
const normTeam = (t) => String(t || "").toUpperCase().trim();

const displayName = (p) =>
  p?.name ||
  p?.fullName ||
  p?.displayName ||
  (p?.firstName && p?.lastName ? `${p.firstName} ${p.lastName}` : null) ||
  (p?.first && p?.last ? `${p.first} ${p.last}` : null) ||
  (p?.preferredName && p?.lastName ? `${p.preferredName} ${p.lastName}` : null) ||
  String(p?.id || p?.uid || "");

const espnHeadshot = (espnId) => {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
};

const identityFor = (p) => {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
};

// Pull athletes out of a variety of ESPN shapes
function extractAthletesFromTeamPayload(data) {
  const out = [];

  // Shape A: team.athletes is an array of groups; each has items[]
  const groupList = data?.team?.athletes;
  if (Array.isArray(groupList)) {
    for (const group of groupList) {
      const items = Array.isArray(group?.items) ? group.items : [];
      for (const it of items) {
        out.push(it?.athlete || it);
      }
    }
  }

  // Shape B: data.athletes directly
  if (Array.isArray(data?.athletes)) {
    for (const it of data.athletes) out.push(it?.athlete || it);
  }

  // Shape C: team.roster.entries[]
  const rosterEntries = data?.team?.roster?.entries;
  if (Array.isArray(rosterEntries)) {
    for (const ent of rosterEntries) {
      if (ent?.player) out.push(ent.player);
      else out.push(ent?.athlete || ent);
    }
  }

  // Shape D: team.athletes is a flat array (no groups)
  if (Array.isArray(data?.team?.athletes) && data.team.athletes.length && !data.team.athletes[0]?.items) {
    for (const it of data.team.athletes) out.push(it?.athlete || it);
  }

  // Deduplicate by espn id
  const seen = new Set();
  const dedup = [];
  for (const a of out) {
    const id = String(a?.id || a?.uid || displayName(a) || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    dedup.push(a);
  }
  return dedup;
}

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) Pull teams (HTTPS)
  const teamsJson = await fetchJsonNoStore(TEAMS_URL, "teams");
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({
      id: String(t.id),
      abbr: t.abbreviation || t.shortDisplayName || t.name,
      name: t.displayName || t.name,
    }));

  if (!teams.length) {
    return { ok: false, where: "teams-parse", error: "no teams found" };
  }

  // 2) Fetch rosters per team (HTTPS)
  const rosterUrls = teams.map(
    (t) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
  );

  const results = await Promise.allSettled(
    rosterUrls.map((u) => fetchJsonNoStore(u, `roster:${u}`))
  );

  // 3) Normalize allowed positions + synthesize DEF
  const ALLOWED = new Set(["QB", "RB", "WR", "TE", "K"]);

  const collected = [];
  results.forEach((res, idx) => {
    const teamMeta = teams[idx];
    const teamAbbr = normTeam(teamMeta?.abbr);
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", teamMeta?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};
    const athletes = extractAthletesFromTeamPayload(data);

    for (const person of athletes) {
      const espnId = person?.id ?? person?.uid ?? null;

      const posRaw =
        person?.position?.abbreviation ||
        person?.position?.abbrev ||
        person?.position?.name ||
        person?.position ||
        person?.defaultPositionId ||
        null;
      const pos = normPos(posRaw);

      const pTeam =
        person?.team?.abbreviation ||
        person?.proTeamAbbreviation ||
        person?.proTeam || // sometimes number code
        teamAbbr;

      const name = displayName(person);

      const player = {
        id: String(espnId || name || "").trim(),
        name: name || String(espnId || ""),
        position: pos,
        team: normTeam(pTeam),
        espnId: espnId ? String(espnId) : null,
        photo: espnHeadshot(espnId),
        projections: {},
        matchups: {},
      };

      // keep only fantasy-relevant positions
      if (!player.position || !ALLOWED.has(player.position)) continue;
      if (!player.id) continue;

      collected.push(player);
    }
  });

  // Add one D/ST per team
  for (const t of teams) {
    const abbr = normTeam(t.abbr);
    const id = `DEF:${abbr}`;
    collected.push({
      id,
      name: `${abbr} D/ST`,
      position: "DEF",
      team: abbr,
      espnId: null,
      photo: null,
      projections: {},
      matchups: {},
    });
  }

  // 4) De-dupe by identity
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // If you only see ~32 here, it means the roster parsing returned nothing.
  console.log(`ESPN import: parsed ${countReceived} players (incl. synthesized DEF)`);

  // 5) Write in chunks
  let written = 0;
  for (let i = 0; i < finalPlayers.length; i += 400) {
    const chunk = finalPlayers.slice(i, i + 400);
    const batch = adminDb.batch();
    for (const raw of chunk) {
      const ref = adminDb.collection("players").doc(String(raw.id));
      batch.set(
        ref,
        {
          id: String(raw.id),
          name: raw.name,
          position: raw.position,
          team: raw.team || null,
          espnId: raw.espnId || null,
          photo: raw.photo || null,
          projections: raw.projections || {},
          matchups: raw.matchups || {},
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    written += chunk.length;
    // eslint-disable-next-line no-await-in-loop
    await sleep(80);
  }

  return {
    ok: true,
    source: "espn:teams+rosters (+D/ST)",
    written,
    countReceived,
  };
}

export default refreshPlayersFromEspn;
