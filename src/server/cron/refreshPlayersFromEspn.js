/* eslint-disable no-console */
import { adminDb } from "../../lib/firebaseAdmin.js";

const TEAMS_URL = "http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

// --- helpers ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normPos(pos) { return String(pos || "").toUpperCase(); }
function normTeam(team) { return String(team || "").toUpperCase(); }
function displayName(p) {
  return (
    p.name || p.fullName || p.displayName ||
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

export async function refreshPlayersFromEspn({ adminDb: injected } = {}) {
  const db = injected || adminDb;

  // 1) pull teams
  const teamsJson = await fetchJson(TEAMS_URL, "teams");
  const teamItems = teamsJson?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamItems.map((t) => t?.team).filter(Boolean).map((t) => ({
    id: t.id, slug: t.abbreviation || t.slug || t.name
  }));
  if (!teams.length) return { ok:false, where:"teams-parse", error:"no teams found" };

  // 2) pull rosters (sequential to be gentle on ESPN)
  const collected = [];
  for (const t of teams) {
    const url = `http://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`;
    try {
      const data = await fetchJson(url, `roster:${t.id}`);
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
      // tiny pause between teams to be nice to ESPN
      await sleep(50);
    } catch (e) {
      console.warn("Roster fetch failed:", t?.id, e?.message || e);
    }
  }

  // 3) dedupe in-memory
  const byIdent = new Map();
  for (const p of collected) {
    const k = identityFor(p);
    if (!byIdent.has(k)) byIdent.set(k, p);
  }
  const finalPlayers = Array.from(byIdent.values());
  const countReceived = finalPlayers.length;

  // 4) write with BulkWriter (throttled + retries on RESOURCE_EXHAUSTED)
  const writer = db.bulkWriter({
    // tame per-second rate; Firestore will auto-throttle further if needed
    throttling: { initialOpsPerSecond: 150, maxOpsPerSecond: 300 },
  });
  writer.onWriteError((err) => {
    // gRPC 8 == RESOURCE_EXHAUSTED; retry up to 5 times with backoff
    if (err.code === 8 && err.failedAttempts < 5) {
      const delay = 250 * Math.pow(2, err.failedAttempts); // 250ms, 500ms, 1s, 2s, 4s
      return new Promise((resolve) => setTimeout(() => resolve(true), delay));
    }
    return false; // don't retry other errors
  });

  let written = 0;
  for (const p of finalPlayers) {
    const ref = db.collection("players").doc(String(p.id));
    writer.set(ref, {
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      espnId: p.espnId || null,
      photo: p.photo || null,
      projections: p.projections || {},
      matchups: p.matchups || {},
      updatedAt: new Date(),
    }, { merge: true });
    written += 1;
  }
  await writer.close(); // flush all

  return { ok:true, written, countReceived, source:"espn:teams+rosters" };
}
