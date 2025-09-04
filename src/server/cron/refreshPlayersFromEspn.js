/* eslint-disable no-console */
// src/server/cron/refreshPlayersFromEspn.js

import fetchJsonNoStore from "../util/fetchJsonNoStore.js"; // <-- NOTE: one level up from /cron

// ESPN endpoints
const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE", "K"]); // no IDP, no OL

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  (p?.id != null ? String(p.id) : "");

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

// Robustly extract roster entries from the ESPN team response.
function extractRosterBuckets(teamJson) {
  // Common shapes we’ve seen:
  // - team.athletes is an array of groups; each group has "items" (array of players)
  // - team.athletes might already be a flat-ish array of players
  // - occasionally athletes live at "athletes"
  const buckets = [];

  const teamObj = teamJson?.team ?? teamJson ?? {};
  const primary = teamObj.athletes ?? teamJson?.athletes ?? [];

  if (Array.isArray(primary)) {
    for (const group of primary) {
      if (!group) continue;
      if (Array.isArray(group.items)) {
        buckets.push([...group.items]);
      } else if (Array.isArray(group.athletes)) {
        buckets.push([...group.athletes]);
      } else if (group.id || group.athlete || group.displayName) {
        // Sometimes it's already a flat player item
        buckets.push([group]);
      }
    }
  }

  // Fallback: if nothing, try a single flat list at teamObj.athletes.items
  const maybeItems = teamObj?.athletes?.items;
  if (Array.isArray(maybeItems)) {
    buckets.push([...maybeItems]);
  }

  return buckets;
}

export async function refreshPlayersFromEspn({ adminDb }) {
  try {
    // 1) pull teams
    const teamsJson = await fetchJsonNoStore(TEAMS_URL, {
      headers: { "user-agent": "Mozilla/5.0 (server)" },
    });
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

    // 2) fetch rosters (limit concurrency to be kind)
    const rosterUrls = teams.map(
      (t) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`
    );

    const collected = [];
    const errors = [];

    // Simple concurrency window
    const WINDOW = 8;
    for (let i = 0; i < rosterUrls.length; i += WINDOW) {
      const slice = rosterUrls.slice(i, i + WINDOW);
      const chunkTeams = teams.slice(i, i + WINDOW);

      const results = await Promise.allSettled(
        slice.map((u) => fetchJsonNoStore(u, { headers: { "user-agent": "Mozilla/5.0 (server)" } }))
      );

      results.forEach((res, idx) => {
        const teamMeta = chunkTeams[idx];
        if (res.status !== "fulfilled") {
          errors.push({ team: teamMeta?.abbr, error: String(res.reason?.message || res.reason) });
          return;
        }
        const data = res.value || {};
        const buckets = extractRosterBuckets(data);

        for (const bucket of buckets) {
          if (!Array.isArray(bucket)) continue;
          for (const it of bucket) {
            const person = it?.athlete || it;

            // ESPN pos can be various shapes
            const posRaw =
              person?.position?.abbreviation ||
              person?.position?.name ||
              person?.position ||
              it?.position;

            const pos = normPos(posRaw);
            if (!ALLOWED_POS.has(pos)) continue; // skip IDP/OL/etc.

            const espnId = person?.id ?? person?.uid ?? it?.id ?? it?.uid ?? null;
            const name = displayName(person) || displayName(it) || espnId;

            // team abbrev from item or fallback to meta
            const teamAbbr =
              person?.team?.abbreviation ||
              person?.team?.name ||
              person?.team?.displayName ||
              teamMeta?.abbr;

            const player = {
              id: String(espnId || name || "").trim(),
              name: String(name || "").trim(),
              position: pos,
              team: normTeam(teamAbbr),
              espnId: espnId ? String(espnId) : null,
              photo: espnHeadshot(espnId),
              projections: {},
              matchups: {},
            };

            if (!player.id || !player.position) continue;
            collected.push(player);
          }
        }
      });

      // gentle throttle between windows
      await sleep(120);
    }

    // 3) synthesize D/ST per team
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

    // 4) de-dupe by identity
    const byIdent = new Map();
    for (const p of collected) {
      const k = identityFor(p);
      if (!byIdent.has(k)) byIdent.set(k, p);
    }
    const finalPlayers = Array.from(byIdent.values());
    const countReceived = finalPlayers.length;

    if (countReceived === 0) {
      return { ok: false, where: "roster-parse", error: "no players parsed", errors };
    }

    // 5) write to Firestore in chunks
    let written = 0;
    const batchSize = 400;
    for (let i = 0; i < finalPlayers.length; i += batchSize) {
      const chunk = finalPlayers.slice(i, i + batchSize);
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
      errors,
    };
  } catch (e) {
    console.error("refreshPlayersFromEspn fatal:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// Provide default export too
export default refreshPlayersFromEspn;
