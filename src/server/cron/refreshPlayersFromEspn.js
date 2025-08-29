// src/server/cron/refreshPlayersFromEspn.js
/* eslint-disable no-console */
import { getBulkWriterWithBackoff, sleep /*, writeChunkWithRetry*/ } from "./firestoreWrite.js";

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

function normPos(pos) { return String(pos || "").toUpperCase(); }
function normTeam(team) { return String(team || "").toUpperCase(); }
function displayName(p) {
  return (
    p.name ||
    p.fullName ||
    p.displayName ||
    (p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null) ||
    String(p.id || "")
  );
}
function espnHeadshot(espnId) {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
}
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

// Small concurrency runner so we don't pull 32 teams all at once
async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 0) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __error: e }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) pull teams
  const teamsJson = await fetchJson(TEAMS_URL, "teams");
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map((t) => t?.team)
    .filter(Boolean)
    .map((t) => ({ id: t.id, slug: t.abbreviation || t.slug || t.name }));
  if (!teams.length) return { ok: false, where: "teams-parse", error: "no teams found" };

  // 2) fetch rosters with limited concurrency (e.g., 6 at a time)
  const rosterUrls = teams.map((t) => `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`);
  const rosterResults = await mapWithConcurrency(rosterUrls, 6, (u) => fetchJson(u, `roster:${u}`));

  // 3) normalize & dedupe
  const collected = [];
  rosterResults.forEach((data, idx) => {
    if (data?.__error) {
      console.warn("Roster fetch failed:", teams[idx]?.id, data.__error?.message || data.__error);
      return;
    }
    const roster = data?.team?.athletes || [];
    const buckets = Array.isArray(roster) ? roster : [];
    for (const bucket of buckets) {
      const items = bucket?.items || bucket || [];
      if (!Array.isArray(items)) continue;
      for (const it of items) {
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
          projections: {}, // none here
          matchups: {},    // none here
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

  // 4) UPSERT with throttling/backoff (BulkWriter)
  const writer = getBulkWriterWithBackoff(adminDb);
  let written = 0;

  for (let i = 0; i < finalPlayers.length; i++) {
    const raw = finalPlayers[i];
    const ref = adminDb.collection("players").doc(String(raw.id));

    writer.set(ref, {
      id: raw.id,
      name: raw.name,
      position: raw.position,
      team: raw.team,
      espnId: raw.espnId,
      photo: raw.photo,
      projections: raw.projections || {},
      matchups: raw.matchups || {},
      updatedAt: new Date(),
    }, { merge: true });

    // pace a hair every ~300 writes to be kind to quotas
    if (i > 0 && i % 300 === 0) await sleep(250);
    written += 1;
  }

  await writer.close(); // flush + wait

  return {
    ok: true,
    source: "espn:teams+rosters",
    written,
    countReceived,
    deleted: 0, // we didn't truncate
  };
}
