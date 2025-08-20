import React, { useEffect, useState } from "react";
import { createLeague, joinLeague, listMyLeagues } from "../lib/storage";

export default function Leagues({ username, onOpenLeague }) {
  const [leagueName, setLeagueName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [mine, setMine] = useState([]);
  const [msg, setMsg] = useState("");

  function refresh() {
    setMine(listMyLeagues(username));
  }

  useEffect(() => {
    refresh();
  }, [username]);

  function handleCreate() {
    const name = leagueName.trim();
    if (!name) return setMsg("Enter a league name");
    const id = createLeague({ name, owner: username });
    setLeagueName("");
    setMsg(`✅ League created: ${name} (ID: ${id})`);
    refresh();
  }

  function handleJoin() {
    const id = joinId.trim();
    if (!id) return setMsg("Enter a league ID");
    try {
      joinLeague({ leagueId: id, username });
      setJoinId("");
      setMsg(`✅ Joined league ${id}`);
      refresh();
    } catch (e) {
      setMsg("❌ League not found");
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2>Leagues</h2>
      {msg && <p>{msg}</p>}

      <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <div>
          <h3>Create a League</h3>
          <input
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder="League name"
            style={{ padding: 10, width: "100%" }}
          />
          <button onClick={handleCreate} style={{ marginTop: 8, padding: 10, width: "100%" }}>
            Create
          </button>
        </div>

        <div>
          <h3>Join a League</h3>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="League ID (e.g. abcd-1234)"
            style={{ padding: 10, width: "100%" }}
          />
          <button onClick={handleJoin} style={{ marginTop: 8, padding: 10, width: "100%" }}>
            Join
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>My Leagues</h3>
      {mine.length === 0 ? (
        <p>No leagues yet. Create one above or paste an ID to join.</p>
      ) : (
        <ul style={{ paddingLeft: 16 }}>
          {mine.map((l) => (
            <li key={l.id} style={{ marginBottom: 8 }}>
              <strong>{l.name}</strong> — ID: <code>{l.id}</code>
              <br />
              Members: {l.members.join(", ")}
              <br />
              <button
                onClick={() => onOpenLeague(l)}
                style={{ marginTop: 6, padding: 8 }}
              >
                Open League
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
