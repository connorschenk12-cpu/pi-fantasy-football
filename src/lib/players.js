// src/lib/players.js
// Helpers to resolve player names by ID using local data/players.js if available.

let NAME_BY_ID = {};

// We don't know the exact export shape of your data/players.js, so we
// defensively handle a few common shapes.
try {
  // eslint-disable-next-line import/no-unresolved
  // Expecting something like:
  //  - export const NAME_BY_ID = { "123": "Josh Allen", ... }
  //  - export const PLAYERS = [{ id:"123", name:"..." }, ...]
  //  - export default [{ id:"123", name:"..." }, ...]
  //  - export const INDEX = { "123": { name:"..." }, ... }
  //  - export const players = [...]
  // Any of the above is fine — we’ll try to normalize into NAME_BY_ID.
  // IMPORTANT: keep this a static import for CRA build.
  // If this import fails (file missing), we just keep an empty map.
  // eslint-disable-next-line import/extensions
  // eslint-disable-next-line import/no-relative-packages
  // NOTE: path assumes file exists at src/data/players.js
  // If yours lives elsewhere, move it there.
  // eslint-disable-next-line import/no-unresolved
  // eslint-disable-next-line import/extensions
  // eslint-disable-next-line import/no-absolute-path
  // eslint-disable-next-line
} catch (e) {
  // No local data; leave NAME_BY_ID = {}
}

// Static import (wrapped in try/catch above causes bundlers to complain),
// so we duplicate here without try:
let Raw = {};
try {
  // If the file exists, this succeeds.
  // If it doesn't, CRA will error; in that case comment out this import.
  // eslint-disable-next-line import/no-unresolved
  Raw = require("../data/players"); // CommonJS require works fine in CRA
  Raw = Raw && Raw.__esModule ? Raw : { default: Raw };
} catch (_) {
  Raw = {};
}

// Normalize into NAME_BY_ID
(function normalize() {
  const src = Raw || {};
  const out = {};

  const add = (id, name) => {
    if (!id) return;
    const n =
      name ||
      null;
    if (n) out[String(id)] = String(n);
  };

  // If explicit map
  if (src.NAME_BY_ID && typeof src.NAME_BY_ID === "object") {
    Object.entries(src.NAME_BY_ID).forEach(([id, name]) => add(id, name));
  }

  // If an INDEX map of objects
  if (src.INDEX && typeof src.INDEX === "object") {
    Object.entries(src.INDEX).forEach(([id, obj]) =>
      add(id, obj?.name || obj?.fullName || obj?.playerName || obj?.displayName)
    );
  }

  // If arrays under different keys
  const arrays =
    (Array.isArray(src.default) && src.default) ||
    (Array.isArray(src.PLAYERS) && src.PLAYERS) ||
    (Array.isArray(src.players) && src.players) ||
    [];

  arrays.forEach((p) =>
    add(
      p?.id ?? p?.playerId ?? p?.pid ?? p?.ID,
      p?.name ||
        p?.fullName ||
        p?.playerName ||
        p?.displayName ||
        (p?.firstName && p?.lastName ? `${p.firstName} ${p.lastName}` : null) ||
        p?.n ||
        p?.N
    )
  );

  NAME_BY_ID = out;
})();

/** Return a display name for an ID, or null if unknown locally */
export function getNameById(id) {
  if (id == null) return null;
  return NAME_BY_ID[String(id)] || null;
}

/** Expose the raw map (read-only-ish) */
export function nameIndex() {
  return { ...NAME_BY_ID };
}
