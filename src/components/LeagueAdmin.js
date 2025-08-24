/* eslint-disable no-console */
import React from "react";
import AdminDraftSetup from "./AdminDraftSetup";
import ProjectionsSeeder from "./ProjectionsSeeder";

export default function LeagueAdmin({ leagueId }) {
  if (!leagueId) return <div style={{ color: "#b22" }}>No league loaded.</div>;
  return (
    <div>
      <h3>League Admin</h3>
      <AdminDraftSetup leagueId={leagueId} />
      <div style={{ height: 12 }} />
      <ProjectionsSeeder leagueId={leagueId} />
    </div>
  );
}
