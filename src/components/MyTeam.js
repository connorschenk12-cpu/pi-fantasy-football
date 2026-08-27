/* eslint-disable no-console */
// src/components/MyTeam.js
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ROSTER_SLOTS,
  listenTeam,
  emptyRoster,
  asId,
  listPlayersMap,
  moveToStarter,
  moveToBench,
  releasePlayerAndClearSlot,
  projForWeek,
  opponentForWeek,
} from "../lib/storage";
import PlayerBadge from "./common/PlayerBadge";

function normPos(p) {
  const x = String(p || "").toUpperCase();

  if (x === "PK") return "K";
  if (x === "DST" || x === "D/ST" || x === "D-ST") return "DEF";

  return x;
}

export default function MyTeam({ leagueId, username, currentWeek }) {
  const [team, setTeam] = useState({
    roster: emptyRoster(),
    bench: [],
  });
  const [playersMap, setPlayersMap] = useState(new Map());
  const week = Number(currentWeek || 1);

  // Live team
  useEffect(() => {
    if (!leagueId || !username) return undefined;

    const unsub = listenTeam({
      leagueId,
      username,
      onChange: (t) => {
        setTeam(t || { roster: emptyRoster(), bench: [] });
      },
    });

    return () => {
      if (unsub) unsub();
    };
  }, [leagueId, username]);

  // Players map
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const m = await listPlayersMap();

        if (mounted) {
          setPlayersMap(m || new Map());
        }
      } catch (e) {
        console.error("listPlayersMap error:", e);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const pById = useCallback(
    (pid) => (pid ? playersMap.get(asId(pid)) : null),
    [playersMap]
  );

  const rosterLines = useMemo(() => {
    return (ROSTER_SLOTS || []).map((slot) => {
      const pid = team?.roster?.[slot] || null;
      const player = pById(pid);
      const projected = player ? projForWeek(player, week) : 0;
      const opp = player ? opponentForWeek(player, week) : "";
      const pos = player ? normPos(player.position) : "-";

      return {
        slot,
        pid,
        player,
        projected,
        opp,
        pos,
      };
    });
  }, [team, week, pById]);

  const benchPlayers = useMemo(() => {
    const ids = Array.isArray(team?.bench) ? team.bench : [];

    return ids.map((pid) => pById(pid)).filter(Boolean);
  }, [team, pById]);

  async function doMoveToStarter(playerId, slot) {
    try {
      await moveToStarter({
        leagueId,
        username,
        playerId,
        slot,
      });
    } catch (e) {
      console.error("moveToStarter:", e);
      alert(String(e?.message || e));
    }
  }

  async function doBench(slot) {
    try {
      await moveToBench({
        leagueId,
        username,
        slot,
      });
    } catch (e) {
      console.error("moveToBench:", e);
      alert(String(e?.message || e));
    }
  }

  async function doRelease(playerId) {
    const ok =
      typeof window !== "undefined"
        ? window.confirm("Release this player?")
        : true;

    if (!ok) return;

    try {
      await releasePlayerAndClearSlot({
        leagueId,
        username,
     
