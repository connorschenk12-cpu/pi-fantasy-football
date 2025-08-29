/* eslint-disable no-console */
// src/server/cron/settleSeason.js

function normalizeTreasury(league) {
  const t = league?.treasury || {};
  const payouts = t?.payouts || {};
  return {
    poolPi: Number(t?.poolPi || 0),
    rakePi: Number(t?.rakePi || 0),
    txs: Array.isArray(t?.txs) ? t.txs : [],
    payouts: {
      pending: Array.isArray(payouts?.pending) ? payouts.pending : [],
      sent: Array.isArray(payouts?.sent) ? payouts.sent : [],
    },
  };
}

export async function settleSeason({ adminDb }) {
  const leaguesSnap = await adminDb.collection("leagues").get();
  const leagues = leaguesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let enqueued = 0;

  for (const L of leagues) {
    const curWeek = Number(L?.settings?.currentWeek || 1);
    const seasonEnded = !!L?.settings?.seasonEnded || curWeek >= 18;
    if (L?.draft?.status !== "done" || !seasonEnded) continue;

    const st = L?.standings || {};
    const entries = Object.entries(st).map(([u, row]) => ({
      username: u,
      pointsFor: Number(row?.pointsFor || 0),
      wins: Number(row?.wins || 0),
    }));

    if (entries.length === 0) continue;

    entries.sort((a, b) => (b.wins - a.wins) || (b.pointsFor - a.pointsFor));
    const winner = entries[0]?.username;
    if (!winner) continue;

    const T = normalizeTreasury(L);
    const pot = Number(T.poolPi || 0);
    if (pot <= 0.009) continue; // ignore dust

    const ref = adminDb.collection("leagues").doc(L.id);
    const pending = [...(T.payouts.pending || [])];
    const alreadyPending = pending.some((p) => p.username === winner && p.amountPi);
    if (alreadyPending) continue;

    pending.push({
      id: `${L.id}_${winner}_${Date.now()}`,
      leagueId: L.id,
      username: winner,
      amountPi: Math.round(pot * 100) / 100,
      createdAt: new Date(),
      status: "pending",
    });

    await ref.set(
      {
        treasury: {
          ...T,
          poolPi: 0,
          payouts: { ...T.payouts, pending },
        },
      },
      { merge: true }
    );

    enqueued += 1;
  }

  return { ok: true, enqueued };
}
