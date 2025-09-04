/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
// Fetch NFL teams + rosters from ESPN, keep only QB/RB/WR/TE/K + synthesize one DEF per team.

import fetchJsonNoStore from "./fetchJsonNoStore.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
// Use the explicit /roster endpoint — it’s simpler/more consistent than ?enable=roster
const rosterUrl = (teamId) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;

const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE", "K"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normPos = (pos) => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST" || p === "D-ST") return "DEF";
  return p;
};
const normTeam = (t) => String(t || "").toUpperCase().trim();

const displayName = (p) =>
  p.name ||
  p.fullName ||
  p.displayName ||
  (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
  String(p.id || "");

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

export async function refreshPlayersFromEspn({ adminDb }) {
  if (!adminDb) throw new Error("adminDb required");

  // 1) Teams
  const teamsJson = await fetchJsonNoStore(TEAMS_URL, { method: "GET" });
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

  // 2) Fetch rosters (roster endpoint)
  const results = await Promise.allSettled(
    teams.map((t) => fetchJsonNoStore(rosterUrl(t.id), { method: "GET" }))
  );

  const collected = [];

  results.forEach((res, idx) => {
    const teamMeta = teams[idx];
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", teamMeta?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};

    // ESPN roster endpoint usually has: data.athletes = [{ position, items: [...] }, ...]
    const groups = Array.isArray(data?.athletes) ? data.athletes : [];

    const flat = [];
    for (const g of groups) {
      if (Array.isArray(g?.items)) flat.push(...g.items);
    }

    for (const it of flat) {
      const person = it?.athlete || it;
      const posRaw =
        person?.position?.abbreviation ||
        person?.position?.name ||
        person?.position ||
        it?.position;
      const pos = normPos(posRaw);
      if (!ALLOWED_POS.has(pos)) continue;

      const teamAbbr =
        person?.team?.abbreviation ||
        person?.team?.name ||
        person?.team?.displayName ||
        teamMeta?.abbr;

      const espnId = person?.id ?? person?.uid ?? it?.id ?? null;

      const name =
        person?.displayName ||
        (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
        person?.name ||
        it?.displayName ||
        it?.name ||
        espnId;

      if (!name) continue;

      collected.push({
        id: String(espnId || name).trim(),
        name: displayName({ name }),
        position: pos,
        team: normTeam(teamAbbr),
        espnId: espnId ? String(espnId) : null,
        photo: espnHeadshot(espnId),
        projections: {},
        matchups: {},
      });
    }
  });

  // 3) Add one D/ST per team
  for (const t of teams) {
    const abbr = normTeam(t.abbr);
    const name = `${abbr} D/ST`;
    const id = `DEF:${abbr}`;
    collected.push({
      id,
      name,
      position: "DEF",
      team: abbr,
      espnId: null,
      photo: null,
      projections: {},
      matchups: {},
    });
  }

  // 4) Dedupe
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

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
    await batch.commit();
    written += chunk.length;
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
