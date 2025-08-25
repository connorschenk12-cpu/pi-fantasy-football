/* eslint-disable no-console */
// src/components/DebugPanel.js
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  ROSTER_SLOTS,
  listenTeam,
  listPlayersMap,
  playerDisplay,
  asId,
} from "../lib/storage";

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Mono({ children }) {
  return <span style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{children}</span>;
}

function Row({ left, right }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
      <div style={{ width: 180, color: "#555" }}>{left}</div>
      <div><Mono>{right}</Mono></div>
    </div>
  );
}

export default function DebugPanel({ leagueId, username }) {
  const [team, setTeam] = useState(null);
  const [playersMap, setPlayersMap] = useState(new Map());

  const [leaguePlayersSample, setLeaguePlayersSample] = useState({ count: 0, rows: [] });
  const [globalPlayersSample, setGlobalPlayersSample] = useState({ count: 0, rows: [] });

  const [lookupId, setLookupId] = useState("");
  const [lookupLeagueDoc, setLookupLeagueDoc] = useState(null);
  const [lookupGlobalDoc, setLookupGlobalDoc] = useState(null);

  const [notes, setNotes] = useState([]);

  // Subscribe to my team
  useEffect(() => {
    if (!leagueId || !username) return;
    const unsub = listenTeam({ leagueId, username, onChange: setTeam });
    return () => unsub && unsub();
  }, [leagueId, username]);

  // Load players map
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const map = await listPlayersMap({ leagueId });
        if (alive) setPlayersMap(map || new Map());
      } catch (e) {
        console.error("listPlayersMap failed", e);
      }
    })();
    return () => { alive = false; };
  }, [leagueId]);

  // Sample league + global players (small page)
  useEffect(() => {
    if (!leagueId) return;
    (async () => {
      try {
        const lSnap = await getDocs(collection(db, "leagues", leagueId, "players"));
        const lRows = [];
        lSnap.forEach((d) => lRows.push({ id: d.id, ...d.data() }));
        setLeaguePlayersSample({ count: lRows.length, rows: lRows.slice(0, 25) });
      } catch (e) {
        console.error("sample league players error", e);
      }
      try {
        const gSnap = await getDocs(collection(db, "players"));
        const gRows = [];
        gSnap.forEach((d) => gRows.push({ id: d.id, ...d.data() }));
        setGlobalPlayersSample({ count: gRows.length, rows: gRows.slice(0, 25) });
      } catch (e) {
        console.error("sample global players error", e);
      }
    })();
  }, [leagueId]);

  // Derived
  const roster = team?.roster || {};
  const bench = Array.isArray(team?.bench) ? team.bench : [];

  const starters = useMemo(() => {
    return (ROSTER_SLOTS || []).map((slot) => {
      const rawId = roster[slot] ?? null;
      const id = asId(rawId);
      const p = id ? playersMap.get(id) : null;
      return { slot, rawId, id, p };
    });
  }, [roster, playersMap]);

  const benchRows = useMemo(() => {
    return (bench || []).map((rawId) => {
      const id = asId(rawId);
      const p = id ? playersMap.get(id) : null;
      return { rawId, id, p };
    });
  }, [bench, playersMap]);

  // Health checks
  useEffect(() => {
    const n = [];

    // Check id types
    starters.forEach(({ slot, rawId, id }) => {
      if (rawId && typeof rawId !== "string") {
        n.push(`Starter ${slot} rawId is ${typeof rawId} (${JSON.stringify(rawId)}) → coerced to "${id}"`);
      }
    });
    benchRows.forEach(({ rawId, id }) => {
      if (rawId && typeof rawId !== "string") {
        n.push(`Bench rawId is ${typeof rawId} (${JSON.stringify(rawId)}) → coerced to "${id}"`);
      }
    });

    // Check unresolved ids
    starters.forEach(({ slot, id, p }) => {
      if (id && !p) n.push(`Starter ${slot} id "${id}" not found in playersMap`);
    });
    benchRows.forEach(({ id, p }) => {
      if (id && !p) n.push(`Bench id "${id}" not found in playersMap`);
    });

    // Sample warnings (name missing)
    const missingNames = [];
    playersMap.forEach((pv, pid) => {
      const name = playerDisplay(pv);
      if (!name || name === "(unknown)" || name === "(empty)" || name === String(pid)) {
        missingNames.push(pid);
      }
    });
    if (missingNames.length) {
      n.push(`Players with weak/missing names in playersMap: ${missingNames.slice(0, 15).join(", ")}${missingNames.length > 15 ? " …" : ""}`);
    }

    setNotes(n);
  }, [starters, benchRows, playersMap]);

  async function doLookup() {
    setLookupLeagueDoc(null);
    setLookupGlobalDoc(null);
    const id = asId(lookupId);
    if (!id) return;
    try {
      const l = await getDoc(doc(db, "leagues", leagueId, "players", id));
      if (l.exists()) setLookupLeagueDoc({ id: l.id, ...l.data() });
    } catch (e) {
      console.error("lookup league doc error", e);
    }
    try {
      const g = await getDoc(doc(db, "players", id));
      if (g.exists()) setLookupGlobalDoc({ id: g.id, ...g.data() });
    } catch (e) {
      console.error("lookup global doc error", e);
    }
  }

  return (
    <div style={{ background: "#fafafa", padding: 12, borderRadius: 8 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Debug Panel</div>

      <Section title="Context">
        <Row left="leagueId" right={leagueId || "(none)"} />
        <Row left="username" right={username || "(none)"} />
        <Row left="team doc exists" right={team ? "yes" : "no"} />
        <Row left="playersMap size" right={String(playersMap.size)} />
        <Row left="league players count" right={String(leaguePlayersSample.count)} />
        <Row left="global players count" right={String(globalPlayersSample.count)} />
      </Section>

      <Section title="My Starters (resolved)">
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 60 }}>Slot</th>
              <th style={{ width: 180 }}>rawId</th>
              <th style={{ width: 140 }}>used id</th>
              <th>Name</th>
              <th style={{ width: 70 }}>Pos</th>
              <th style={{ width: 70 }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {starters.map(({ slot, rawId, id, p }) => (
              <tr key={slot} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td><b>{slot}</b></td>
                <td><Mono>{JSON.stringify(rawId)}</Mono></td>
                <td><Mono>{id || ""}</Mono></td>
                <td>{p ? playerDisplay(p) : "(unresolved)"}</td>
                <td>{p?.position || "-"}</td>
                <td>{p?.team || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Bench (resolved)">
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 180 }}>rawId</th>
              <th style={{ width: 140 }}>used id</th>
              <th>Name</th>
              <th style={{ width: 70 }}>Pos</th>
              <th style={{ width: 70 }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {(benchRows || []).map(({ rawId, id, p }) => (
              <tr key={JSON.stringify(rawId)} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td><Mono>{JSON.stringify(rawId)}</Mono></td>
                <td><Mono>{id || ""}</Mono></td>
                <td>{p ? playerDisplay(p) : "(unresolved)"}</td>
                <td>{p?.position || "-"}</td>
                <td>{p?.team || "-"}</td>
              </tr>
            ))}
            {benchRows.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#999" }}>(no bench)</td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="League Players (sample)">
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 180 }}>id</th>
              <th>Name</th>
              <th style={{ width: 70 }}>Pos</th>
              <th style={{ width: 70 }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {leaguePlayersSample.rows.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td><Mono>{p.id}</Mono></td>
                <td>{playerDisplay(p)}</td>
                <td>{p.position || p.pos || "-"}</td>
                <td>{p.team || p.nflTeam || p.proTeam || "-"}</td>
              </tr>
            ))}
            {leaguePlayersSample.rows.length === 0 && (
              <tr><td colSpan={4} style={{ color: "#999" }}>(none)</td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Global Players (sample)">
        <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ width: 180 }}>id</th>
              <th>Name</th>
              <th style={{ width: 70 }}>Pos</th>
              <th style={{ width: 70 }}>Team</th>
            </tr>
          </thead>
          <tbody>
            {globalPlayersSample.rows.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td><Mono>{p.id}</Mono></td>
                <td>{playerDisplay(p)}</td>
                <td>{p.position || p.pos || "-"}</td>
                <td>{p.team || p.nflTeam || p.proTeam || "-"}</td>
              </tr>
            ))}
            {globalPlayersSample.rows.length === 0 && (
              <tr><td colSpan={4} style={{ color: "#999" }}>(none)</td></tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Lookup a player id">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            placeholder="Enter a player id (e.g. '1234')"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            style={{ flex: "1 1 280px" }}
          />
          <button onClick={doLookup}>Lookup</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>League-scoped</div>
            {lookupLeagueDoc ? (
              <pre style={{ background: "#f7f7f7", padding: 8, borderRadius: 6 }}>
{JSON.stringify(lookupLeagueDoc, null, 2)}
              </pre>
            ) : (
              <div style={{ color: "#999" }}>(none)</div>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Global</div>
            {lookupGlobalDoc ? (
              <pre style={{ background: "#f7f7f7", padding: 8, borderRadius: 6 }}>
{JSON.stringify(lookupGlobalDoc, null, 2)}
              </pre>
            ) : (
              <div style={{ color: "#999" }}>(none)</div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Notes / Warnings">
        {notes.length === 0 ? (
          <div style={{ color: "#999" }}>(no issues detected)</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notes.map((n, i) => (
              <li key={i}><Mono>{n}</Mono></li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
