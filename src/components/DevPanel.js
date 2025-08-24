/* eslint-disable no-console */
import React from "react";
import ProjectionsSeeder from "./ProjectionsSeeder";

/**
 * Developer utilities, safe to remove in production.
 * Props: { leagueId }
 */
export default function DevPanel({ leagueId }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Developer Tools</h3>
      <ProjectionsSeeder leagueId={leagueId} />
    </div>
  );
}
