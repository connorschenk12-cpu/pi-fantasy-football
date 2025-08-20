import React, { useMemo } from "react";

export default function LeagueHome({ league, me, onBack }) {
  const isOwner = useMemo(() => league.owner === me, [league, me]);

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

      {isOwner && (
        <>
          <h3 style={{ marginTop: 16 }}>Owner Tools</h3>
          <button
            onClick={() => alert("Starting season soon — draft/roster coming next!")}
            style={{ padding: 10 }}
          >
            Start Season (coming soon)
          </button>
        </>
      )}
    </div>
  );
}
