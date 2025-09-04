/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
import fetchJsonNoStore from "./fetchJsonNoStore.js";

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ALLOWED = new Set(["QB","RB","WR","TE","K"]);

const s = (x) => (x == null ? "" : String(x));
const normPos  = (pos) => {
  const p = s(pos).toUpperCase().trim();
  if (p === "PK") return "K";
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
};
const normTeam = (t) => s(t).toUpperCase().trim();

const displayName = (p) =>
  p.name || p.fullName || p.displayName ||
  (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
  s(p.id || "");

const espnHeadshot = (espnId) => {
  const idStr = s(espnId).replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
};

const identityFor = (p) => {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeGetRosterBuckets(json) {
  // ESPN responses vary by season/deploy:
  // - team.athletes: [{ position: {...}, items:[{athlete:{...}}] }]
  // - team.roster.athletes: [{...}]
  // - athletes: [...]
  const t = json?.team || {};
  if (Array.isArray(t.athletes)) return t.athletes;
  if (Array.isArray(t?.roster?.athletes)) return t.roster.athletes;
  if (Array.isArray(json?.athletes)) return json.athletes;
  return [];
}

function extractItems(bucket) {
  // bucket may be {items:[...]} or already an array of athletes
  if (Array.isArray(bucket?.items)) return bucket.items;
  if (Array.isArray(bucket)) return bucket;
  return [];
}

function readPos(obj) {
  return (
    obj?.position?.abbreviation ||
    obj?.position?.name ||
    obj?.defaultPosition?.abbreviation ||
    obj?.defaultPosition?.name ||
    obj?.pos ||
    obj?.position
  );
}

function readDepth(obj) {
  const n =
    Number(obj?.depthChartOrder) ||
    Number(obj?.depth) ||
    Number(obj?.athlete?.depthChartOrder) ||
    Number(obj?.athlete?.depth) ||
    null;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) teams
  const teamsJson = await fetchJsonNoStore(TEAMS_URL, { headers: { "user-agent": "pi-fantasy/1.0" } });
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({ id: s(t.id), abbr: t.abbreviation || t.shortDisplayName || t.name, name: t.displayName || t.name }));

  if (!teams.length) return { ok:false, where:"teams-parse", error:"no teams found" };

  // 2) rosters
  const rosterUrls = teams.map((t) =>
    `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
  );
  const results = await Promise.allSettled(
    rosterUrls.map((u) => fetchJsonNoStore(u, { headers: { "user-agent": "pi-fantasy/1.0" } }))
  );

  const collected = [];
  results.forEach((res, idx) => {
    const teamMeta = teams[idx];
    if (res.status !== "fulfilled") {
      console.warn("Roster fetch failed:", teamMeta?.id, res.reason?.message || res.reason);
      return;
    }
    const data = res.value || {};

    const buckets = safeGetRosterBuckets(data);
    const depthCounter = new Map(); // `${TEAM}|${POS}` -> int

    const nextDepth = (team, pos) => {
      const k = `${team}|${pos}`;
      const cur = depthCounter.get(k) || 0;
      const nxt = cur + 1;
      depthCounter.set(k, nxt);
      return nxt;
    };

    for (const bucket of buckets) {
      const items = extractItems(bucket);
      for (const it of items) {
        const person = it?.athlete || it;
        const pos = normPos(readPos(person) || readPos(it));
        if (!ALLOWED.has(pos)) continue;

        const espnId = person?.id ?? person?.uid ?? it?.id ?? it?.uid ?? null;
        const name =
          person?.displayName ||
          (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
          person?.name || it?.displayName || it?.name || espnId;

        const teamAbbr =
          person?.team?.abbreviation ||
          person?.team?.name ||
          person?.team?.displayName ||
          teamMeta?.abbr;

        const explicitDepth = readDepth(it) ?? readDepth(person);
        const depth = explicitDepth || nextDepth(normTeam(teamAbbr), pos);
        const starter = depth === 1;

        collected.push({
          id: s(espnId || name).trim(),
          name: displayName({ name }),
          position: pos,
          team: normTeam(teamAbbr),
          espnId: espnId ? s(espnId) : null,
          photo: espnHeadshot(espnId),
          depth,
          starter,
          projections: {},
          matchups: {},
        });
      }
    }
  });

  // 2b) D/ST per team
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

  // 3) de-dupe
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // 4) write in chunks
  let written = 0;
  for (let i = 0; i < finalPlayers.length; i += 400) {
    const chunk = finalPlayers.slice(i, i + 400);
    const batch = adminDb.batch();
    for (const raw of chunk) {
      const ref = adminDb.collection("players").doc(s(raw.id));
      batch.set(
        ref,
        {
          id: s(raw.id),
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

  return { ok:true, source:"espn:teams+rosters (+D/ST)", written, countReceived };
}

export default refreshPlayersFromEspn;
