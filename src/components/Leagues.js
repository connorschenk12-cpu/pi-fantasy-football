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
          <button
            onClick={handleCreate}
            style={{ marginTop: 8, padding: 10, width: "100%" }}
          >
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
          <button
            onClick={handleJoin}
            style={{ marginTop: 8, padding: 10, width: "100%" }}
          >
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
           <li key={l.id} style={{ marginBottom: 12 }}>
  <strong>{l.name}</strong> — ID: <code>{l.id}</code>
  <br />
  Members: {(l.members || []).join(", ")}
  <br />
  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
    <button onClick={() => onOpenLeague(l)} style={{ padding: 8 }}>
      Open League
    </button>
    <button
      onClick={async () => {
        try {
          const url = `${window.location.origin}?join=${encodeURIComponent(l.id)}`;
          await navigator.clipboard.writeText(url);
          alert("Join link copied!");
        } catch {
          alert("Could not copy — long press and copy the ID.");
        }
      }}
      style={{ padding: 8 }}
    >
      Copy Join Link
    </button>
    <button
      onClick={async () => {
        const url = `${window.location.origin}?join=${encodeURIComponent(l.id)}`;
        const text = `Join my Pi Fantasy Football league: ${l.name}\n${url}`;
        try {
          if (window.Pi?.openShareDialog) {
            await window.Pi.openShareDialog({ title: "Pi Fantasy Football", text, url });
          } else if (navigator.share) {
            await navigator.share({ title: "Pi Fantasy Football", text, url });
          } else {
            await navigator.clipboard.writeText(url);
            alert("Share link copied!");
          }
        } catch (e) {
          console.log("Share cancelled/failed:", e);
        }
      }}
      style={{ padding: 8 }}
    >
      Share
    </button>
  </div>
</li>

          ))}
        </ul>
      )}
    </div>
  );
}
