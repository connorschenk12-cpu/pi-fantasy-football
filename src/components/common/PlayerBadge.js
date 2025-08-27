// src/components/common/PlayerBadge.js
import React from "react";
import { headshotUrlFor } from "../../lib/headshots";
import { playerDisplay } from "../../lib/storage";

export default function PlayerBadge({ player, right = null, sub = null }) {
  const name = playerDisplay(player);
  const headshot = headshotUrlFor(player);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          overflow: "hidden",
          background: "#f2f3f5",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: "#667085",
          border: "1px solid #e5e7eb",
          flex: "0 0 auto",
        }}
        title={name}
      >
        {headshot ? (
          <img
            src={headshot}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              // fallback to initials if the provider 404s
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement.textContent = initials(name);
            }}
          />
        ) : (
          initials(name)
        )}
      </div>

      <div style={{ display: "grid", minWidth: 0 }}>
        <div style={{ fontWeight: 600, lineHeight: 1.15, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: "#667085" }}>
          {sub || player.position || ""}
        </div>
      </div>

      {right && (
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#667085" }}>
          {right}
        </div>
      )}
    </div>
  );
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "??";
}
