/* eslint-disable no-console */
import React, { useEffect, useState } from "react";
import {
  listenLeague,
  initDraftOrder,
  configureDraft,
  startDraft,
  endDraft,
  setDraftStatus,
  ensureSeasonSchedule,
  listMemberUsernames,
} from "../lib/storage";

export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);

  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, setLeague);
    (async () => setMembers(await listMemberUsernames(leagueId)))();
    return () => unsub && unsub();
  }, [leagueId]);

  if (!leagueId) return <div>No league loaded. (Missing leagueId)</div>;
  if (!league) return <div>Loading league…</div>;

  const isOwner = league?.owner === username;

  // Once draft is done, only show lightweight admin actions.
  if (league?.draft?.status === "done") {
    return (
      <div>
        <h3>Admin</h3>
        {!isOwner && <div>You are not the league owner.</div>}
        <p>Draft complete. You can (re)generate the season schedule if needed.</p>
        {isOwner && (
          <>
            <button onClick={() => ensureSeasonSchedule({ leagueId })}>
              Ensure / Recreate Season Schedule
            </button>
            <p style={{ marginTop: 8 }}>
              CurrentWeek: {league?.settings?.currentWeek || 1}
            </p>
          </>
        )}
      </div>
    );
  }

  // Pre / Live draft controls
  return (
    <div>
      <h3>Admin</h3>
      {!isOwner && <div>You are not the league owner.</div>}
      <p>Status: <b>{league?.draft?.status || "unknown"}</b></p>

      {isOwner && (
        <>
          <div style={{ margin: "8px 0" }}>
            <button onClick={async () => {
              const order = await initDraftOrder({ leagueId });
              alert("Draft order set:\n" + order.join(" → "));
            }}>Seed Draft Order From Members</button>
          </div>

          <div style={{ margin: "8px 0" }}>
            <button onClick={async () => {
              // keep same order, just reset pointers
              await configureDraft({
                leagueId,
                order: league?.draft?.order || members,
              });
              alert("Draft reconfigured.");
            }}>Reset Draft (keep order)</button>
          </div>

          <div style={{ margin: "8px 0" }}>
            <button onClick={() => startDraft({ leagueId })}>Start Draft</button>
            <button style={{ marginLeft: 8 }} onClick={async () => {
              await endDraft({ leagueId });
              alert("Draft ended, schedule created (if missing).");
            }}>End Draft</button>
            <button style={{ marginLeft: 8 }} onClick={() => setDraftStatus({ leagueId, status: "scheduled" })}>
              Mark Scheduled
            </button>
            <button style={{ marginLeft: 8 }} onClick={() => setDraftStatus({ leagueId, status: "live" })}>
              Mark Live
            </button>
            <button style={{ marginLeft: 8 }} onClick={() => setDraftStatus({ leagueId, status: "done" })}>
              Mark Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
