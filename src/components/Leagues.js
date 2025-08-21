import React, { useEffect, useState } from "react";
import { listMyLeagues, createLeague, joinLeague } from "../lib/storage";

export default function Leagues({ username, onOpenLeague }) {
  const [leagues, setLeagues] = useState([]);
  const [newLeagueName, setNewLeagueName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [msg, setMsg] = useState("");

  async function refresh() {
    try {
      const ls = await listMyLeagues(username);
      setLeagues(ls);
    } catch (e) {
      setMsg(e.message || "Failed to load leagues");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line
  }, [username]);

  async function handleCreate() {
    setMsg("");
    try {
      const l = await createLeague({ name: newLeagueName.trim(), owner: username });
      setNewLeagueName("");
      setMsg("✅ League created");
      await refresh();
      onOpenLeague && onOpenLeague(l);
    } catch (e) {
      setMsg(e.message || "Failed to create league");
    }
  }

  async function handleJoin() {
    setMsg("");
    try {
      const l = await joinLeague({ leagueId: joinId.trim(), username });
      setJoinId("");
      setMsg("✅ Joined league");
      await refresh();
      onOpenLeague && onOpenLeague(l);
    } catch (e) {
      setMsg(e.message || "Failed to join league");
    }
  }

  return (
    <div>
      <h2>My Leagues</h2>
      {msg && <p>{msg}</p>}

      {!leagues.length ? <p>No leagues yet.</p> : (
        <ul style={{ paddingLeft: 16 }}>
          {leagues.map((l) => (
            <li key={l.id} style={{ marginBottom: 6 }}>
              <button onClick={() => onOpenLeague(l)} style={{ padding: 8 }}>
                {l.name} <span style={{ opacity: 0.6 }}>({l.id})</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 16 }}>
        <h3>Create League</h3>
        <input
          placeholder="League name"
          value={newLeagueName}
          onChange={(e) => setNewLeagueName(e.target.value)}
          style={{ padding: 8, width: "260px" }}
        />
        <button onClick={handleCreate} style={{ marginLeft: 8, padding: 8 }}>
          Create
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>Join League</h3>
        <input
          placeholder="League ID"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          style={{ padding: 8, width: "260px" }}
        />
        <button onClick={handleJoin} style={{ marginLeft: 8, padding: 8 }}>
          Join
        </button>
      </div>
    </div>
  );
}
