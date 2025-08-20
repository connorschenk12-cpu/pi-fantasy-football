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
  }, [username]); // correct dependency

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
        </div>
        <button onClick={handleCreate} style={{ marginTop: 8, padding: 10, width: "100%" }}>
          Create
        </button>

        <div>
          <h3>Join a League</h3>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="League ID (Firestore doc id)"
            style={{ padding: 10, width: "100%" }}
          />
        </div>
        <button onClick={handleJoin} style={{ marginTop: 8, padding: 10, width: "100%" }}>
          Join
        </button>
      </div>

      <h3 style={{ marginTop: 24
