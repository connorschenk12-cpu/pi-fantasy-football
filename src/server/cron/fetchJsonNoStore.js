// src/server/util/fetchJsonNoStore.js
// Lightweight JSON fetcher that disables caching and throws on non-2xx

async function fetchJsonNoStore(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('accept')) headers.set('accept', 'application/json,*/*;q=0.9');

  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const err = new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

// CJS + ESM friendly exports
module.exports = fetchJsonNoStore;
module.exports.default = fetchJsonNoStore;
module.exports.fetchJsonNoStore = fetchJsonNoStore;
