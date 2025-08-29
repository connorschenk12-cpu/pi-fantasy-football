/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js
// Pulls ESPN teams + rosters and writes to Firestore (GLOBAL "players" collection).

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const normPos = (pos) => String(pos || "").toUpperCase();
const normTeam = (team) => String(team || "").toUpperCase();
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

async function fetchJson(url, where) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`fetch failed @ ${where} (${r.status}) ${text}`.slice(0, 500));
  }
  return r.json();
}

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export async function refreshPlayersFromEspn({ adminDb, limitTeams = null } = {}) {
  // 1) Fetch teams list
  const teamsJson = await fetchJson(TEAMS_URL, "teams");
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({ id: t.id, abbr: t.abbreviation || t.slug || t.name }));

  if (!teams.length) {
    return { ok: false, where: "teams-parse", error: "no teams found", countReceived: 0, written: 0, deleted: 0, source: "espn:teams+rosters" };
  }

  const useTeams = Array.isArray(limitTeams) ? teams.filter(t => limitTeams.includes(String(t.id))) : teams;

  // 2) Fetch each roster
  const rosterUrls = useTeams.map((t) => `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`);
  const rosterResults = await Promise.allSettled(rosterUrls.map((u) => fetchJson(u, `roster:${u}`)));

  // 3) Normalize + dedupe in memory
  const collected = [];
  rosterResults.forEach((r, idx) => {
    if (r.status !== "fulfilled") {
      console.warn("Roster fetch failed:", useTeams[idx]?.id, r.reason?.message || r.reason);
      return;
    }
    const data = r.value || {};
    const roster = data?.team?.athletes || []; // array of buckets OR items
    const buckets = Array.isArray(roster) ? roster : [];
    for (const bucket of buckets) {
      const items = bucket?.items || bucket || [];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        // ESPN item shape
        const pid = it?.id ?? it?.uid ?? null;
        const person = it?.athlete || it;
        const pos = person?.position?.abbreviation || person?.position?.name || person?.position || it?.position;
        const team = person?.team?.abbreviation || person?.team?.name || person?.team?.displayName || data?.team?.abbreviation;

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
          position: normPos(pos),
          team: normTeam(team),
          espnId: espnId ? String(espnId) : null,
          photo: espnHeadshot(espnId),
          projections: {},
          matchups: {},
          updatedAt: new Date(),
        };
        if (player.id) collected.push(player);
      }
    }
  });

  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // 4) Write in chunks
  let written = 0;
  for (let i = 0; i < finalPlayers.length; i += 400) {
    const chunk = finalPlayers.slice(i, i + 400);
    const batch = adminDb.batch();
    for (const raw of chunk) {
      const id = String(raw.id);
      const ref = adminDb.collection("players").doc(id);
      batch.set(ref, raw, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }

  return { ok: true, deleted: 0, written, countReceived, source: "espn:teams+rosters" };
}
