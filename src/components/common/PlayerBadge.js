/* eslint-disable react/prop-types */
// src/components/common/PlayerBadge.js
import React from "react";
import { playerDisplay } from "../../lib/storage";

// Heuristic: look for any likely headshot field on the player object.
// If none, we’ll render an initials bubble.
function getHeadshotUrl(p) {
  return (
    p?.headshotUrl ||
    p?.headshot ||
    p?.photoUrl ||
    p?.photo ||
    p?.image ||
    p?.img ||
    null
  );
}

function initialsFromName(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return (first + last).toUpperCase();
}

export default function PlayerBadge({ player, size = 28, right = null }) {
  const name = playerDisplay(player);
  const url = getHeadshotUrl(player);

  const containerStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  };
  const avatarStyle = {
    width: size,
    height: size,
    flex: "0 0 auto",
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(0,0,0,0.08)",
    background:
      "linear-gradient(135deg, rgba(0,0,0,0.05), rgba(0,0,0,0.02))",
    display: "grid",
    placeItems: "center",
    fontSize: Math.max(12, Math.floor(size * 0.45)),
    fontWeight: 700,
    color: "#223",
  };
  const imgStyle = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  };
  const nameStyle = {
    fontWeight: 600,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    overflow: "hidden",
    maxWidth: 260,
  };
  const metaStyle = {
    color: "#667085",
    fontWeight: 500,
    marginLeft: 6,
  };

  return (
    <span style={containerStyle} title={name}>
      <span style={avatarStyle}>
        {url ? (
          // Note: add `referrerPolicy="no-referrer"` if your image host requires it.
          <img src={url} alt={name} style={imgStyle} />
        ) : (
          initialsFromName(name)
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "baseline", minWidth: 0 }}>
        <span style={nameStyle}>{name}</span>
        {right ? <span style={metaStyle}>{right}</span> : null}
      </span>
    </span>
  );
}
