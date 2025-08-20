// Simple localStorage helpers so it works on your phone now.
// Later we swap these to Firebase with the same function names.

const KEY = "piff_leagues_v1";

export function loadLeagues() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLeagues(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

// Create a league owned by username; returns leagueId
export function createLeague({ name, owner }) {
  const leagues = loadLeagues();
  const leagueId = genId();
  leagues[leagueId] = {
    id: leagueId,
    name,
    owner,
    members: [owner],
    createdAt: Date.now(),
  };
  saveLeagues(leagues);
  return leagueId;
}

// Join by leagueId; idempotent for same user
export function joinLeague({ leagueId, username }) {
  const leagues = loadLeagues();
  if (!leagues[leagueId]) throw new Error("League not found");
  const m = new Set(leagues[leagueId].members || []);
  m.add(username);
  leagues[leagueId].members = Array.from(m);
  saveLeagues(leagues);
  return leagues[leagueId];
}

// Return leagues where user is a member
export function listMyLeagues(username) {
  const leagues = loadLeagues();
  return Object.values(leagues).filter(l => (l.members || []).includes(username));
}

function genId() {
  // short human-ish id: 4 chars + '-' + 4 chars
  const s = () => Math.random().toString(36).slice(2, 6);
  return `${s()}-${s()}`;
}
