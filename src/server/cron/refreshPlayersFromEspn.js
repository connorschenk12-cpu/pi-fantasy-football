// src/server/cron/refreshPlayersFromEspn.js
/* eslint-disable no-console */
import { sleep } from "./firestoreWrite.js";

/** Tunables to stay under Firestore limits on Hobby/free tiers */
const WRITE_CHUNK = 250;     // docs per batch
const PAUSE_MS    = 250;     // pause between batches

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const TEAMS_URL = `${BASE}/teams`;

function normPos(pos)  { return String(pos || "").toUpperCase(); }
function normTeam(t)   { return String(t || "").toUpperCase(); }
function displayName(p){ return p?.name || p?.fullName || p?.displayName ||
  (p?.firstName && p?.lastName ? `${p.firstName} ${p.lastName}` : null) || String(p?.id || ""); }

function espnHeadshot(espnId) {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
}

async function fetchJson(url, where, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, {
        cache: "no-store",
        headers: { "user-agent": "fantasy-refresh/1.0", "x-espn-site-app": "sports" },
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${where} ${r.status}: ${text.slice(0, 140)}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleep(250 * i);
    }
  }
  throw lastErr;
}

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}

export async function refreshPlayersFromEspn({ adminDb }) {
  // 1) fetch teams
  let teamsOK = 0, teamsFailed = 0;
  const teamsJson = await fetchJson(TEAMS_URL, "teams");
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems
    .map(t => t?.team)
    .filter(Boolean)
    .map(t => ({ id: t.id, abbr: t.abbreviation || t.slug || t.name }));

  // If ESPN changed shape or blocked us, don’t nuke your collection—just return explanation
  if (!teams.length) {
    return { ok: true, source: "espn:teams+rosters", written: 0, countReceived: 0, deleted: 0,
             note: "No teams parsed from ESPN; not deleting existing data." };
  }

  // 2) pull each roster (HTTPS + retry)
  const collected = [];
  for (const t of teams) {
    const url = `${BASE}/teams/${t.id}?enable=roster`;
    try {
      const data = await fetchJson(url, `roster:${t.id}`);
      teamsOK += 1;

      // ESPN “athletes” can be grouped by position buckets
      const roster = Array.isArray(data?.team?.athletes) ? data.team.athletes : [];
      for (const bucket of roster) {
        const items = bucket?.items || bucket || [];
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          const person = it?.athlete || it;
          const espnId = person?.id ?? person?.uid ?? it?.id ?? null;
          const pos    = person?.position?.abbreviation || person?.position?.name || person?.position || it?.position;
          const team   = person?.team?.abbreviation || person?.team?.name || person?.team?.displayName || data?.team?.abbreviation;
          const name   = person?.displayName ||
                         (person?.firstName && person?.lastName ? `${person.firstName} ${person.lastName}` : null) ||
                         person?.name || it?.displayName || it?.name || espnId;

          const player = {
            id: String(espnId || name || "").trim(),
            name: displayName({ name }),
            position: normPos(pos),
            team: normTeam(team),
            espnId: espnId ? String(espnId) : null,
            photo: espnHeadshot(espnId),
            projections: {},
            matchups: {},
          };
          if (player.id) collected.push(player);
        }
      }
    } catch (e) {
      teamsFailed += 1;
      console.warn("Roster fetch failed:", t.id, e?.message || e);
      // keep going; we’ll just miss that team for this run
    }

    // light pacing across 32 teams to avoid burst rate limits
    await sleep(60);
  }

  // 3) dedupe in-memory (espnId > name|team|pos)
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // 4) write in throttled chunks
  let written = 0;
  let idx = 0;
  while (idx < finalPlayers.length) {
    const chunk = finalPlayers.slice(idx, idx + WRITE_CHUNK);
    const batch = adminDb.batch();
    for (const raw of chunk) {
      const ref = adminDb.collection("players").doc(String(raw.id));
      batch.set(ref, {
        id: raw.id,
        name: raw.name,
        position: raw.position || null,
        team: raw.team || null,
        espnId: raw.espnId || null,
        photo: raw.photo || null,
        projections: raw.projections || {},
        matchups: raw.matchups || {},
        updatedAt: new Date(),
      }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    idx += chunk.length;
    await sleep(PAUSE_MS);
  }

  return {
    ok: true,
    source: "espn:teams+rosters",
    written,
    countReceived,
    deleted: 0, // we’re not truncating here; use truncate flow if you truly want a wipe
    teamsTotal: teams.length,
    teamsOK,
    teamsFailed,
  };
}
