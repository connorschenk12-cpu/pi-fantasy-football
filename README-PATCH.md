# Dues collection fix — files to drop into your repo

New files:
- src/lib/piPlatform.js       (server-only Pi Platform API client)
- api/payments/approve.js     (new)
- api/payments/complete.js    (new)

Modified files (replace the existing ones):
- src/components/EntryFeeButton.js
- src/App.js
- api/payments/pi-webhook.js  (only a comment added — now marked unused/legacy)

## Setup required
1. In your Pi Developer Portal, get your app's server API key.
2. In Vercel project settings (NOT in .env.local, and never with REACT_APP_ prefix), add:
   PI_API_KEY=your_key_here
3. Redeploy.

## What changed
- Dues are no longer marked "paid" client-side. The client only starts the Pi
  payment; your server approves it (api/payments/approve.js), and only marks
  it paid after Pi confirms the on-chain transaction
  (api/payments/complete.js), via recordSuccessfulEntryPayment() in storage.js.
- Server verifies the payment amount and metadata against the league's actual
  entry fee before approving/completing — a tampered client can't pay the
  wrong amount or credit the wrong team.
- App.js now actually resolves dangling "incomplete payment" callbacks Pi
  fires on login, instead of just logging them.

## Stats fix (api/stats/week.js)
Two bugs fixed:
1. Scoreboard URL was missing `/site/` (`apis/v2/...` -> `apis/site/v2/...`) — this
   alone made the whole endpoint fail before it reached player stats. Confirmed
   live against ESPN's real API.
2. The box score fetch used an endpoint
   (`site.web.api.espn.com/apis/common/v3/.../boxscore`) that doesn't appear to
   be a real, working ESPN endpoint. Replaced with the documented
   `site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}`
   endpoint, and rewrote the parser to match its actual response shape
   (`boxscore.players[].statistics[].labels` + `.athletes[].stats`).

Caveat: I could verify #1 live and could verify the box score's *shape* live
(via the identical NBA endpoint, which returned the exact structure the new
parser expects), but couldn't get a live NFL response through my own tooling
during this session (repeated 400s on three different real NFL game IDs vs.
success on the identical NBA URL pattern — looks like a quirk on my end, not
ESPN's, since multiple independently-dated 2026 sources confirm this NFL URL
still works). Worth a quick real deploy test before you rely on it for a live
scoring run.
