/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
import { fetchJsonNoStore } from "../util/fetchJsonNoStore.js";

// ESPN endpoints
const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const normPos = (pos) => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST") return "DEF";
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

// tiny delay to be nice to Firestore
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) pull teams
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

  // 2) fetch rosters
  const rosterUrls = teams.map(
    (t) => `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
  );
  const results = await Promise.allSettled(
    rosterUrls.map((u) => fetchJsonNoStore(u, `roster:${u}`))
  );

  // 3) normalize players
  const collected = [];
  results.forEach((res, idx) => {
    const teamMeta = teams[idx];
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", teamMeta?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};
    const roster = data?.team?.athletes || [];
    const buckets = Array.isArray(roster) ? roster : [];

    for (const bucket of buckets) {
      const items = bucket?.items || bucket || [];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const pid = it?.id ?? it?.uid ?? null;
        const person = it?.athlete || it;
        const posRaw =
          person?.position?.abbreviation ||
          person?.position?.name ||
          person?.position ||
          it?.position;
        const pos = normPos(posRaw);

        const teamAbbr =
          person?.team?.abbreviation ||
          person?.team?.name ||
          person?.team?.displayName ||
          teamMeta?.abbr;

        const espnId = person?.id ?? person?.uid ?? pid ?? null;

        const name =
          person?.displayName ||
          (person?.firstName && person?.lastName
            ? `${person.firstName} ${person.lastName}`
            : null) ||
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
          photo: espnHeadshot(espnId),
          projections: {},
          matchups: {},
        };

        // keep only positions we support (QB/RB/WR/TE/K/DEF); ignore strange depth entries
        if (!player.position) continue;
        if (!["QB", "RB", "WR", "TE", "K"].includes(player.position)) continue;
        if (!player.id) continue;

        collected.push(player);
      }
    }
  });

  // 3b) Synthesize D/ST per team (not present in roster feed)
  for (const t of teams) {
    const abbr = normTeam(t.abbr);
    const name = `${abbr} D/ST`;
    const id = `DEF:${abbr}`; // stable deterministic id
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

  // 4) de-dupe
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // 5) write in chunks
  let written = 0;
  let i = 0;
  while (i < finalPlayers.length) {
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
    i += chunk.length;
    await sleep(100); // gentle throttle
  }

  return {
    ok: true,
    source: "espn:teams+rosters (+D/ST)",
    written,
    countReceived,
  };
}
