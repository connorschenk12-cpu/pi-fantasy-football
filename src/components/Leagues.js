/* eslint-disable no-console */
import React, { useEffect, useMemo, useState } from "react";
import { createLeague, listMyLeagues, joinLeague } from "../lib/storage";

/**
 * Props:
 * - username (string)
 * - onOpenLeague(leagueId)
 */
export default function Leagues({ username, onOpenLeague }) {
  const [myLeagues, setMyLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Handle ?join=LEAGUE_ID
  const joinTarget = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("join");
    } catch {
      return null;
    }
  }, []);

  async function reload() {
    try {
      setError("");
      setLoading(true);
      if (!username) {
        setMyLeagues([]);
        return;
      }
      if (joinTarget) {
        try {
          await joinLeague({ leagueId: joinTarget, username });
          setInfo(`Joined league: ${joinTarget}`);
        } catch (e) {
          console.warn("joinLeague (auto) failed:", e);
        }
      }
      const list = await listMyLeagues({ username });
      setMyLeagues(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("Leagues load error:", e);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, joinTarget]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!username) {
      setError("Please log in first.");
      return;
    }
    if (!name.trim()) return;
    try {
      setCreating(true);
      const res = await createLeague({ name: name.trim(), owner: username, order: [username] });
      setName("");
      await reload();
      if (res?.id && typeof onOpenLeague === "function") onOpenLeague(res.id);
    } catch (e) {
      console.error("createLeague error:", e);
      setError(String(e?.message || e));
    } finally {
      setCreating(false);
    }
  };

  const handleJoinId = async (e) => {
    e.preventDefault();
    if (!username) {
      setError("Please log in first.");
      return;
    }
    const id = (joinId || "").trim();
    if (!id) return;
    try {
      await joinLeague({ leagueId: id, username });
      setInfo(`Joined league: ${id}`);
      setJoinId("");
      await reload();
    } catch (e) {
      console.error("join by id error:", e);
      setError(String(e?.message || e));
    }
  };

  const copyJoinLink = async (leagueId) => {
    try {
      const base = window.location.origin;
      const link = `${base}/?join=${leagueId}`;
      await navigator.clipboard.writeText(link);
      setInfo("Join link copied to clipboard!");
      setTimeout(() => setInfo(""), 2000);
    } catch (e) {
      console.error("copyJoinLink error:", e);
      setError("Failed to copy. You can share: " + window.location.origin + "/?join=" + leagueId);
    }
  };

  return (
    <div>
      <h2>My Leagues</h2>

      {!username && (
        <div style={{ color: "#b00", marginBottom: 8 }}>
          You’re not logged in yet. Log in to load your leagues.
        </div>
      )}

      {info && <div style={{ color: "green", marginBottom: 8 }}>{info}</div>}
      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}
      {loading && <div>Loading…</div>}

      {!loading && myLeagues.length === 0 && username && (
        <div style={{ marginBottom: 8 }}>You have no leagues yet. Create one below or join by ID.</div>
      )}

      {!loading && myLeagues.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {myLeagues.map((l) => (
            <li key={l.id} style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 10,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{l.name || l.id}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Owner: {l.owner || "(unknown)"} · League ID: <code>{l.id}</code>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onOpenLeague && onOpenLeague(l.id)}>Open</button>
                <button onClick={() => copyJoinLink(l.id)}>Copy Join Link</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="New league name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8, minWidth: 220 }}
        />
        <button disabled={creating || !name.trim()} type="submit">
          {creating ? "Creating…" : "Create League"}
        </button>
      </form>

      <form onSubmit={handleJoinId} style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Join by League ID"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          style={{ padding: 8, minWidth: 220 }}
        />
        <button type="submit" disabled={!joinId.trim()}>Join</button>
      </form>
    </div>
  );
}
