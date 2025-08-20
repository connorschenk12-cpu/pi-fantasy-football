import React, { useMemo, useState } from "react";
import MyTeam from "./MyTeam";

export default function LeagueHome({ league, me, onBack }) {
  const [showTeam, setShowTeam] = useState(false);
  const isOwner = useMemo(() => league.owner === me, [league, me]);

  if (showTeam) {
    return (
      <MyTeam
        leagueId={league.id}
        username={me}
        onBack={() => setShowTeam(false)}
      />
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={onBack} style={{ marginBottom: 12, padding: 8 }}>
        ← Back to Leagues
      </button>

      <h2>{league.name}</h2>
      <p><strong>League ID:</strong> <code>{league.id}</code></p>
      <p><strong>Owner:</strong> {league.owner}</p>

      <h3 style={{ marginTop: 16 }}>Members</h3>
      <ul style={{ paddingLeft: 16 }}>
        {(league.members || []).map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>

      <div style={{ display: "grid", gap: 10, marginTop: 16, maxWidth: 320 }}>
        <button onClick={() => setShowTeam(true)} style={{ padding: 10 }}>
          Open “My Team”
        </button>

        {isOwner && (
          <button
            onClick={() => alert("Draft/Start Season coming soon")}
            style={{ padding: 10 }}
          >
            Start Season (owner)
          </button>
        )}
      </div>
    </div>
  );
}
