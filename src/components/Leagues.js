import React, { useEffect, useState } from "react";
import { createLeague, joinLeague, listMyLeagues } from "../lib/storage";

export default function Leagues({ username, onOpenLeague }) {
  const [leagueName, setLeagueName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [mine, setMine] = useState([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listMyLeagues(username);
      setMine(data);
    } catch (e) {
      setMsg("❌ Failed to load leagues");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function handleCreate() {
    const name = leagueName.trim();
    if (!name) return setMsg("Enter a league name");
    setLoading(true);
    try {
      const id = await createLeague({ name, owner: username });
      setLeagueName("");
      setMsg(`✅ League created: ${name} (ID: ${id})`);
      await refresh();
    } catch (e) {
      setMsg("❌ Failed to create league");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    const id = joinId.trim();
    if (!id) return setMsg("Enter a league ID");
    setLoading(true);
    try {
      await joinLeague({ leagueId: id, username });
      setJoinId("");
      setMsg(`✅ Joined league ${id}`);
      await refresh();
    } catch (e) {
      setMsg("❌ League not found");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <h2>Leagues</h2>
      {msg && <p>{msg}</p>}
      {loading && <p>Loading…</p>}

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
            placeholder="League ID (Firestore doc id)"
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
              Members: {(l.members || []).join(", ")}
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
