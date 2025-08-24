/* eslint-disable no-console */
import React from "react";
import PlayersList from "./PlayersList";

/**
 * Thin wrapper tab for PlayersList.
 * Props:
 *  - leagueId
 *  - currentWeek
 */
export default function Players({ leagueId, currentWeek }) {
  return (
    <div>
      <h3>Players</h3>
      <PlayersList leagueId={leagueId} currentWeek={currentWeek} />
    </div>
  );
}
