/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import {
  listenLeague,
  configureDraft,
  setDraftStatus,
} from "../lib/storage";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

/**
 * Props:
 * - leagueId
 * - username
 */
export default function LeagueAdmin({ leagueId, username }) {
  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // League
  useEffect(() => {
    if (!leagueId) return;
    const unsub = listenLeague(leagueId, (l) => setLeague(l));
    return () => unsub && unsub();
  }, [leagueId]);

  // Members list
  useEffect(() => {
    if (!leagueId) return;
    const ref = collection(db, "leagues", leagueId, "members");
    const unsub = onSnapshot(ref, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push(d.id || d.data()?.username));
      const unique = Array.from(new Set(arr.filter(Boolean)));
      setMembers(unique);
    }, (err) => {
      console.error("members onSnapshot error:", err);
      setMembers([]);
    });
    return () => unsub && unsub();
  }, [leagueId]);

  const isOwner = (league?.owner && username) ? league.owner === username : false;
  const loaded = !!leagueId && !!league;

  const draftOrder = useMemo(() => {
    const base = members && members.length ? members.slice() : (league?.owner ? [league.owner] : []);
    return base;
  }, [members, league?.owner]);

  const status = league?.draft?.status || "scheduled";

  const guard = () => {
    if (!leagueId) throw new Error("No leagueId provided");
    if (!league) throw new Error("No league loaded");
  };

  const doConfigure = async () => {
    try {
      setError(""); setBusy(true);
      guard();
      await configureDraft({ leagueId, order: draftOrder });
    } catch (e) {
      console.error("configureDraft error:", e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    try {
      setError(""); setBusy(true);
      guard();
      if (!draftOrder.length) throw new Error("No members in league to start a draft.");
      await setDraftStatus({ leagueId, status: "live" });
    } catch (e) {
      console.error("startDraft error:", e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doPause = async () => {
    try {
      setError(""); setBusy(true);
      guard();
      await setDraftStatus({ leagueId, status: "paused" });
    } catch (e) {
      console.error("pauseDraft error:", e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doEnd = async () => {
    try {
      setError(""); setBusy(true);
      guard();
      await setDraftStatus({ leagueId, status: "done" });
    } catch (e) {
      console.error("endDraft error:", e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!isOwner) {
    return <div>Only the league owner can access Admin.</div>;
  }

  return (
    <div>
      <h3>Admin</h3>
      {!loaded && <div style={{ marginBottom: 8 }}>Loading league…</div>}
      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}

      <div style={{ marginBottom: 8 }}>
        <div><b>Status:</b> {status}</div>
        <div><b>Members:</b> {draftOrder.join(", ") || "(none yet)"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={doConfigure} disabled={busy || !loaded}>
          Initialize Draft Order
        </button>
        <button onClick={doStart} disabled={busy || !loaded || draftOrder.length === 0}>
          Start Draft
        </button>
        <button onClick={doPause} disabled={busy || !loaded || status !== "live"}>
          Pause Draft
        </button>
        <button onClick={doEnd} disabled={busy || !loaded}>
          End Draft
        </button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
        Share your join link from the Leagues page so members can join.
        You can re-initialize the order any time before the draft starts.
      </div>
    </div>
  );
}
