// src/server/util/fetchJsonNoStore.js
// Lightweight JSON fetcher that disables caching and throws on non-2xx

export default async function fetchJsonNoStore(url, init = {}, label = "fetch") {
  const headers = new Headers(init.headers || {});
  if (!headers.has("accept")) {
    headers.set("accept", "application/json,*/*;q=0.9");
  }

  // Force no caching (both browser + Vercel)
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    next: { revalidate: 0 },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text; // fallback if not JSON
  }

  if (!res.ok) {
    const err = new Error(`${label} failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}
