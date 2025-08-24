/* eslint-disable react/prop-types */
import React from "react";
import { playerDisplay, asId } from "../../lib/storage";

export default function PlayerName({ id, playersMap, fallback = "" }) {
  if (id == null || id === "") return <span>{fallback || "(empty)"}</span>;
  const key = playersMap?.has(id) ? id : asId(id);
  const p = playersMap?.get ? playersMap.get(key) : null;
  return <span>{playerDisplay(p) || String(id)}</span>;
}
