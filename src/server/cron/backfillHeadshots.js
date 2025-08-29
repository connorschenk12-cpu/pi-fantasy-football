/* eslint-disable no-console */
// src/server/cron/backfillHeadshots.js

const espnHeadshot = (espnId) => {
  const idStr = String(espnId || "").replace(/[^\d]/g, "");
  return idStr ? `https://a.espncdn.com/i/headshots/nfl/players/full/${idStr}.png` : null;
};

export async function backfillHeadshots({ adminDb }) {
  const snap = await adminDb.collection("players").get();
  const docs = snap.docs;
  let touched = 0;

  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = adminDb.batch();
    for (const d of chunk) {
      const p = d.data() || {};
      if (!p.photo && p.espnId) {
        const photo = espnHeadshot(p.espnId);
        if (photo) {
          batch.set(d.ref, { photo }, { merge: true });
          touched += 1;
        }
      }
    }
    await batch.commit();
  }

  return { ok: true, updated: touched };
}
