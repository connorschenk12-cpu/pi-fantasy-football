/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const normPos = (pos) => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST") return "DEF";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) Teams (for consistent abbr + id)
  const teamsJson = await fetchJsonNoStore(TEAMS_URL, { method: "GET" });
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({
      id: String(t.id),
      abbr: (t.abbreviation || t.shortDisplayName || t.name || "").toUpperCase(),
      name: t.displayName || t.name,
    }));
  if (!teams.length) return { ok: false, where: "teams-parse", error: "no teams found" };

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamByAbbr = new Map(teams.map((t) => [t.abbr, t]));

  // 2) Rosters (by team)
  const rosterUrls = teams.map(
    (t) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
  );
  const results = await Promise.allSettled(rosterUrls.map((u) => fetchJsonNoStore(u)));

  // 3) Normalize players
  const collected = [];
  results.forEach((res, idx) => {
    const T = teams[idx];
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", T?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};
    const buckets = Array.isArray(data?.team?.athletes) ? data.team.athletes : [];
    for (const bucket of buckets) {
      const items = Array.isArray(bucket?.items) ? bucket.items : [];
      for (const it of items) {
        const pid = it?.id ?? it?.uid ?? null;
        const person = it?.athlete || it;
        const posRaw =
          person?.position?.abbreviation ||
          person?.position?.name ||
          person?.position ||
          it?.position;
        const pos = normPos(posRaw);

        const teamId = String(person?.team?.id || T?.id || "");
        const teamAbbr =
          (person?.team?.abbreviation ||
            person?.team?.shortDisplayName ||
            person?.team?.name ||
            T?.abbr ||
            "").toUpperCase();

        const espnId = person?.id ?? person?.uid ?? pid ?? null;
        const name =
          person?.displayName ||
          (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
          person?.name ||
          it?.displayName ||
          it?.name ||
          espnId;

        const player = {
          id: String(espnId || name || "").trim(),
          name: displayName({ name }),
          position: pos,
          team: normTeam(teamAbbr),
          espnId: espnId ? String(espnId) : null,
          espnTeamId: teamId || null,                 // <-- add this
          photo: espnHeadshot(espnId),
          projections: {},
          matchups: {},
        };

        // Keep only fantasy-relevant positions
        if (!player.position) continue;
        if (!["QB", "RB", "WR", "TE", "K"].includes(player.position)) continue;
        if (!player.id) continue;

        collected.push(player);
      }
    }
  });

  // 3b) Add D/ST for each team with espnTeamId
  for (const t of teams) {
    const abbr = t.abbr;
    const id = `DEF:${abbr}`;
    collected.push({
      id,
      name: `${abbr} D/ST`,
      position: "DEF",
      team: abbr,
      espnId: null,
      espnTeamId: t.id,      // <-- set id for DEF too
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

  // 5) Write
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
          espnTeamId: raw.espnTeamId || null,   // <-- persist
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
    await sleep(60);
  }

  return { ok: true, source: "espn:teams+rosters (+D/ST)", written, countReceived };
}

export default refreshPlayersFromEspn;
