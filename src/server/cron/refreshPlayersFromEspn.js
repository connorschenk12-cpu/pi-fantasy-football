/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ALLOWED = new Set(["QB","RB","WR","TE","K"]);

const normPos = (pos) => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
};
const normTeam = (t) => String(t || "").toUpperCase().trim();
const safeStr = (x) => (x == null ? "" : String(x));
const displayName = (p) =>
  p.name ||
  p.fullName ||
  p.displayName ||
  (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
  safeStr(p.id || "");

const espnHeadshot = (espnId) => {
  const idStr = safeStr(espnId).replace(/[^\d]/g, "");
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
  // 1) teams
  const teamsJson = await fetchJsonNoStore(TEAMS_URL, { headers: { "user-agent": "pi-fantasy/1.0" } });
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({
      id: safeStr(t.id),
      abbr: t.abbreviation || t.shortDisplayName || t.name,
      name: t.displayName || t.name,
    }));

  if (!teams.length) return { ok: false, where: "teams-parse", error: "no teams found" };

  // 2) rosters
  const rosterUrls = teams.map(
    (t) => `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
  );
  const results = await Promise.allSettled(
    rosterUrls.map((u) => fetchJsonNoStore(u, { headers: { "user-agent": "pi-fantasy/1.0" } }))
  );

  // 3) normalize
  const collected = [];
  results.forEach((res, idx) => {
    const teamMeta = teams[idx];
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", teamMeta?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};
    const buckets = Array.isArray(data?.team?.athletes) ? data.team.athletes : [];

    for (const bucket of buckets) {
      const items = bucket?.items || bucket || [];
      if (!Array.isArray(items)) continue;

      // ESPN sometimes has depth info at item or nested athlete
      for (const it of items) {
        const person = it?.athlete || it;
        const posRaw =
          person?.position?.abbreviation ||
          person?.position?.name ||
          person?.position ||
          it?.position;
        const pos = normPos(posRaw);

        // keep only fantasy-relevant offensive positions
        if (!ALLOWED.has(pos)) continue;

        const espnId = person?.id ?? person?.uid ?? it?.id ?? it?.uid ?? null;
        const name =
          person?.displayName ||
          (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
          person?.name ||
          it?.displayName ||
          it?.name ||
          espnId;

        const teamAbbr =
          person?.team?.abbreviation ||
          person?.team?.name ||
          person?.team?.displayName ||
          teamMeta?.abbr;

        // depth & starter heuristics
        const depth =
          Number(it?.depthChartOrder) ||
          Number(person?.depthChartOrder) ||
          Number(person?.depth) ||
          Number(it?.depth) ||
          null;

        const isStarter =
          Boolean(it?.starter) ||
          Boolean(person?.starter) ||
          (depth != null ? depth === 1 : false);

        collected.push({
          id: safeStr(espnId || name).trim(),
          name: displayName({ name }),
          position: pos,
          team: normTeam(teamAbbr),
          espnId: espnId ? safeStr(espnId) : null,
          photo: espnHeadshot(espnId),
          depth: depth || null,
          starter: !!isStarter,
          projections: {},
          matchups: {},
        });
      }
    }
  });

  // 3b) add one DEF per team
  for (const t of teams) {
    const abbr = normTeam(t.abbr);
    collected.push({
      id: `DEF:${abbr}`,
      name: `${abbr} D/ST`,
      position: "DEF",
      team: abbr,
      espnId: null,
      photo: null,
      depth: 1,
      starter: true,
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

  // 5) write
  let written = 0;
  for (let i = 0; i < finalPlayers.length; i += 400) {
    const chunk = finalPlayers.slice(i, i + 400);
    const batch = adminDb.batch();
    for (const raw of chunk) {
      const ref = adminDb.collection("players").doc(safeStr(raw.id));
      batch.set(
        ref,
        {
          id: safeStr(raw.id),
          name: raw.name,
          position: raw.position,
          team: raw.team || null,
          espnId: raw.espnId || null,
          photo: raw.photo || null,
          depth: raw.depth ?? null,
          starter: !!raw.starter,
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

  return { ok: true, source: "espn:teams+rosters (+D/ST)", written, countReceived };
}

export default refreshPlayersFromEspn;
