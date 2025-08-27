// src/lib/headshots.js
export function headshotUrlFor(p) {
  if (!p) return null;

  // 1) Explicit fields you might store on the player doc
  const direct =
    p.headshotUrl || p.photo || p.image || p.img || p.avatar || null;
  if (direct) return ensureHttps(direct);

  // 2) Known provider patterns — fill in whichever IDs you have on players
  // Sleeper: https://sleepercdn.com/ (PNG/JPG depending on era)
  const sleeperId = p.sleeperId || p.sleeper_id;
  if (sleeperId) {
    return `https://sleepercdn.com/content/nfl/players/thumb/${sleeperId}.jpg`;
    // If some return 404, try `.png` or `players/${sleeperId}.jpg`
  }

  // ESPN: full-size headshots
  const espnId = p.espnId || p.espn_id;
  if (espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }

  // NFL GSIS (not always predictable; often requires mapping)
  const gsisId = p.gsisId || p.gsis_id;
  if (gsisId) {
    // Some builds host your own images under /public/headshots
    // return `/headshots/${gsisId}.jpg`;
  }

  // 3) If you ship local images, drop them in public/headshots/{id}.jpg
  // and uncomment this block:
  // if (p.id) return `/headshots/${p.id}.jpg`;

  // 4) No image found
  return null;
}

function ensureHttps(url) {
  try {
    const u = new URL(url, window?.location?.origin || "https://example.com");
    if (u.protocol !== "https:") u.protocol = "https:";
    return u.toString();
  } catch {
    return url;
  }
}
