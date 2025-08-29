// /api/cron/settle-season.js
/* eslint-disable no-console */
import { NextResponse } from "next/server"; // if you're on Next 13+; else use req,res signature
import {
  listLeaguesNeedingSettlement,
  computeSeasonWinners,
  enqueueLeaguePayouts,
  trySendPendingPayouts // calls your server-side Pi payment and marks success
} from "../../src/lib/storage.js";

// If you're not on Next middleware style, export default async function handler(req, res) { ... }
export async function GET() {
  try {
    // 1) find leagues that need settlement
    const leagues = await listLeaguesNeedingSettlement();

    let settled = 0, enqueued = 0, sent = 0;
    for (const L of leagues) {
      // 2) figure winners + shares
      const winners = await computeSeasonWinners(L); // [{username, sharePi}]
      if (!winners.length) continue;

      // 3) move funds from pool → payouts queue (atomic in Firestore)
      const { totalEnqueued } = await enqueueLeaguePayouts({ leagueId: L.id, winners });
      enqueued += totalEnqueued;
      settled += 1;
    }

    // 4) Try to actually push Pi to winners (server-to-user).
    // Wire your Pi server API inside storage.trySendPendingPayouts().
    const { sentCount } = await trySendPendingPayouts();
    sent += sentCount;

    return NextResponse.json({ ok: true, checked: leagues.length, settled, enqueued, sent });
  } catch (e) {
    console.error("settle-season cron error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// For older Next (pages/api) style, use:
// export default async function handler(req, res) { ... res.status(200).json(...); }
