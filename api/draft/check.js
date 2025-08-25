// api/draft/check.js
import { db } from "../../src/lib/firebase";
import {
  findDueDrafts,
  startDraft,
} from "../../src/lib/storage";

export const config = {
  runtime: "edge",
};

// GET or POST → scans leagues; if a league has draft.status="scheduled"
// and draft.scheduledAt <= now, it flips to "live" and sets the clock.
export default async function handler(req) {
  try {
    const now = Date.now();
    const due = await findDueDrafts(now);

    let started = 0;
    for (const league of due) {
      await startDraft({ leagueId: league.id });
      started += 1;
    }

    return new Response(
      JSON.stringify({ ok: true, started, checked: due.length }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
