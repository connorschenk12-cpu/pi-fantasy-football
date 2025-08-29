/* eslint-disable no-console */
// src/server/cron/dedupePlayers.js
// Keep one doc per identity; prefer the doc whose id matches espnId (if any),
// else the one with a more recent updatedAt.

function identityFor(p) {
  const eid = p.espnId ?? p.espn_id ?? null;
  if (eid) return `espn:${String(eid)}`;
  const k = `${(p.name || "").toLowerCase()}|${(p.team || "").toLowerCase()}|${(p.position || "").toLowerCase()}`;
  return `ntp:${k}`;
}
function ts(p) {
  const raw = p.updatedAt;
  if (!raw) return 0;
  try {
    if (raw.toDate) return raw.toDate().getTime();
    if (raw.seconds) return Number(raw.seconds) * 1000;
    if (raw instanceof Date) return raw.getTime();
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}

export async function dedupePlayers({ adminDb }) {
  const snap = await adminDb.collection("players").get();
  const docs = snap.docs;

  const groups = new Map(); // ident -> [{ref, data}]
  for (const d of docs) {
    const data = d.data() || {};
    const ident = identityFor(data);
    if (!groups.has(ident)) groups.set(ident, []);
    groups.get(ident).push({ ref: d.ref, data });
  }

  let deleted = 0;
  let kept = 0;

  for (const entries of groups.values()) {
    if (entries.length <= 1) { kept += entries.length; continue; }

    // choose winner
    entries.sort((a, b) => {
      const ta = ts(a.data);
      const tb = ts(b.data);
      if (ta !== tb) return tb - ta; // newer first
      return String(a.ref.id).localeCompare(String(b.ref.id)); // stable
    });

    const winner = entries[0];
    // If any doc id equals espnId, prefer that one
    const idxByEspnId = entries.findIndex(e => e.data?.espnId && String(e.data.espnId) === String(e.ref.id));
    const chosen = idxByEspnId >= 0 ? entries[idxByEspnId] : winner;

    // delete the rest
    const losers = entries.filter(e => e.ref.path !== chosen.ref.path);
    for (let i = 0; i < losers.length; i += 400) {
      const chunk = losers.slice(i, i + 400);
      const batch = adminDb.batch();
      chunk.forEach((e) => batch.delete(e.ref));
      await batch.commit();
      deleted += chunk.length;
    }
    kept += 1;
  }

  return { ok: true, kept, deleted };
}
