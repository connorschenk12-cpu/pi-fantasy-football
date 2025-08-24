/* eslint-disable no-console */
import React from "react";

/** Safely check for '//' in a value that might not be a string */
function hasDoubleSlash(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.indexOf("//") >= 0;
}

/**
 * Very simple player news block.
 * Props:
 *   - player (player object) OR playerId (string)
 *   - news (array) optional; otherwise we just show a friendly placeholder
 */
export default function PlayerNews({ player, playerId, news }) {
  const pid = player?.id ?? playerId ?? "";
  const name =
    player?.name ||
    player?.fullName ||
    player?.playerName ||
    (player?.firstName && player?.lastName ? `${player.firstName} ${player.lastName}` : null) ||
    pid ||
    "Player";

  // If you later fetch real news, pass it via the `news` prop as an array of:
  // { id, title, source, url, publishedAt }
  const items = Array.isArray(news) ? news : [];

  if (!items.length) {
    return (
      <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
        <b>News for {name}</b>
        <div style={{ color: "#777", marginTop: 6 }}>No recent news available.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 8, border: "1px solid #eee", borderRadius: 6 }}>
      <b>News for {name}</b>
      <ul style={{ marginTop: 6 }}>
        {items.map((n) => {
          const safeUrl = hasDoubleSlash(n?.url) ? n.url : null;
          return (
            <li key={n.id || n.url || n.title}>
              {safeUrl ? (
                <a href={safeUrl} target="_blank" rel="noreferrer">
                  {n.title || "(untitled)"}{" "}
                </a>
              ) : (
                <span>{n.title || "(untitled)"} </span>
              )}
              <span style={{ color: "#777" }}>
                {n.source ? `— ${n.source}` : ""} {n.publishedAt ? `(${n.publishedAt})` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
