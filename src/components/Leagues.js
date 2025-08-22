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
  const [error, setError] = useState("");

  // Handle ?join=LEAGUE_ID
  const joinTarget = useMemo(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get("join");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError("");
        setLoading(true);
        if (!username) {
          // Do not query Firestore with undefined username
          setMyLeagues([]);
          return;
        }
        // If there's a join param, attempt to join once
        if (joinTarget) {
          try {
            await joinLeague({ leagueId: joinTarget, username });
          } catch (e) {
            console.warn("joinLeague error (ignored):", e);
          }
        }
        const list = await listMyLeagues({ username });
        if (alive) setMyLeagues(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("Leagues load error:", e);
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
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
      const list = await listMyLeagues({ username });
      setMyLeagues(list);
      if (res?.id && typeof onOpenLeague === "function") onOpenLeague(res.id);
    } catch (e) {
      console.error("createLeague error:", e);
      setError(String(e?.message || e));
    } finally {
      setCreating(false);
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

      {error && <div style={{ color: "red", marginBottom: 8 }}>Error: {error}</div>}
      {loading && <div>Loading…</div>}

      {!loading && myLeagues.length === 0 && username && (
        <div style={{ marginBottom: 8 }}>You have no leagues yet. Create one below.</div>
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
              justifyContent: "space-between"
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{l.name || l.id}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Owner: {l.owner || "(unknown)"}
                </div>
              </div>
              <button onClick={() => onOpenLeague && onOpenLeague(l.id)}>Open</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} style={{ marginTop: 16 }}>
        <input
          type="text"
          placeholder="New league name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8, marginRight: 8 }}
        />
        <button disabled={creating || !name.trim()} type="submit">
          {creating ? "Creating…" : "Create League"}
        </button>
      </form>
    </div>
  );
}
