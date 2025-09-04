// src/server/cron/fetchJsonNoStore.js
export default async function fetchJsonNoStore(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("accept")) headers.set("accept", "application/json,*/*;q=0.9");
  if (!headers.has("user-agent")) headers.set("user-agent", "Mozilla/5.0 (compatible; FantasyBot/1.0)");
  if (!headers.has("referer")) headers.set("referer", "https://site.api.espn.com/");
  const res = await fetch(url, { ...init, headers, cache: "no-store" });

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const err = new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
