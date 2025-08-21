// /api/news/player.js
// Usage: /api/news/player?name=Christian%20McCaffrey
function toXml(text) {
  // very small RSS parse (headlines + links + time)
  const items = [];
  const parts = text.split("<item>").slice(1);
  for (const raw of parts) {
    const title = (raw.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1] ||
                  (raw.match(/<title>(.*?)<\/title>/) || [])[1] || "";
    const link  = (raw.match(/<link>(.*?)<\/link>/) || [])[1] || "";
    const pub   = (raw.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
    if (title && link) items.push({ title, url: link, publishedAt: pub });
  }
  return items.slice(0, 10);
}

export default async function handler(req, res) {
  const name = (req.query.name || "").toString().trim();
  if (!name) return res.status(400).json({ ok: false, error: "name required" });

  const q = encodeURIComponent(`${name} NFL`);
  const rssUrl = `https://news.google.com/rss/search?q=${q}`;
  try {
    const r = await fetch(rssUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await r.text();
    const items = toXml(xml);
    res.setHeader("Cache-Control", "max-age=900, s-maxage=1800");
    return res.status(200).json({ ok: true, name, items });
  } catch (e) {
    return res.status(200).json({ ok: true, name, items: [] });
  }
}
