// /api/players/espn.js
// Returns a normalized list of NFL players directly from ESPN's public endpoints.
// Use this to seed Firestore via your existing seedPlayersToGlobal/seedPlayersToLeague.

export default async function handler(req, res) {
  try {
    // ESPN "all athletes" feed (unofficial). It’s paginated but ~2000 covers NFL.
    // If pagination changes, follow `paging.next` and concat results.
    const url = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes?limit=2000";
    const r = await fetch(url, { headers: { "x-espn-site-app": "sports" } });
    if (!r.ok) return res.status(502).json({ error: "ESPN athletes fetch failed" });
    const data = await r.json();

    // data.athletes is an array of team blocks; inside each, `items` are players.
    const out = [];
    const teams = (data?.athletes || []);

    for (const t of teams) {
      const teamAbbr =
        t?.team?.abbreviation || t?.team?.shortName || t?.team?.displayName || "";
      const items = Array.isArray(t?.items) ? t.items : [];

      for (const a of items) {
        // Core identifiers
        const espnId = a?.id != null ? String(a.id) : null;
        if (!espnId) continue;

        // Name pieces
        const first = a?.firstName || a?.first_name || "";
        const last  = a?.lastName  || a?.last_name  || "";
        const displayName =
          a?.displayName || a?.fullName || [first, last].filter(Boolean).join(" ") || `#${espnId}`;

        // Position + team
        const position =
          (a?.position?.abbreviation || a?.position?.name || a?.position?.displayName || "").toUpperCase() || null;
        const team = (a?.team?.abbreviation || teamAbbr || "").toUpperCase() || null;

        // Prefer ESPN headshot pattern; fall back to any image they give us
        const photo =
          a?.headshot?.href ||
          (espnId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : null);

        out.push({
          // Keep your schema friendly
          id: espnId,            // you can also choose to map this to your own stable id
          espnId,                // explicit
          name: displayName,
          firstName: first || undefined,
          lastName: last  || undefined,
          position,
          team,
          photo,
          // room for future:
          // projections: null,
          // matchups: null,
          updatedAt: Date.now(),
        });
      }
    }

    res.status(200).json({ players: out });
  } catch (err) {
    console.error("espn players error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
