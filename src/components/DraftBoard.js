// src/components/DraftBoard.js
import React, { useMemo } from "react";

/**
 * Shows: team order, current pointer, recent picks, and a board grid (rounds x teams).
 * Expects: league.draft = { order[], pointer, round, direction, totalRounds, picks[] }
 * picks items: { overall, round, pickInRound, username, playerId, slot, ts }
 */
export default function DraftBoard({ league, playersById }) {
  const draft = league?.draft || {};
  const order = Array.isArray(draft.order) ? draft.order : [];
  const totalRounds = draft.totalRounds || Math.max(1, order.length ? 15 : 1);
  const currentIdx = Number.isInteger(draft.pointer) ? draft.pointer : 0;

  const picksByRoundAndUser = useMemo(() => {
    // Map: round -> username -> pick object
    const map = new Map();
    (draft.picks || []).forEach((p) => {
      const r = p.round || 1;
      if (!map.has(r)) map.set(r, new Map());
      map.get(r).set(p.username, p);
    });
    return map;
  }, [draft.picks]);

  const recentPicks = useMemo(() => {
    const arr = (draft.picks || []).slice(-10);
    return arr.reverse(); // latest first
  }, [draft.picks]);

  if (order.length === 0) {
    return <p style={{ opacity: 0.7 }}>No draft order yet.</p>;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Team order bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {order.map((u, idx) => (
          <span
            key={u + idx}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #ddd",
              background: idx === currentIdx ? "#111" : "#fff",
              color: idx === currentIdx ? "#fff" : "#111",
              fontWeight: idx === currentIdx ? 700 : 500
            }}
          >
            {u}{idx === currentIdx ? " • On the clock" : ""}
          </span>
        ))}
      </div>

      {/* Board grid (snake) */}
      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr>
              <th style={th}>Rnd</th>
              {order.map((u, i) => (
                <th key={u + i} style={th}>{u}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRounds }).map((_, rIdx) => {
              const roundNumber = rIdx + 1;
              const snakeOrder = roundNumber % 2 === 1 ? order : [...order].reverse();
              return (
                <tr key={roundNumber}>
                  <td style={{ ...td, fontWeight: 700 }}>#{roundNumber}</td>
                  {snakeOrder.map((user, colIdx) => {
                    const p = picksByRoundAndUser.get(roundNumber)?.get(user);
                    const pl = p ? playersById.get(p.playerId) : null;
                    const label = p ? (pl?.displayName || pl?.name || p.playerId) : "";
                    return (
                      <td key={user + colIdx} style={td}>
                        {p ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{label}</div>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              {pl?.team || "—"} · {pl?.position || p.slot}
                            </div>
                          </div>
                        ) : (
                          <span style={{ opacity: 0.3 }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent picks */}
      {recentPicks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent picks</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {recentPicks.map((p, i) => {
              const pl = playersById.get(p.playerId);
              const label = pl?.displayName || pl?.name || p.playerId;
              return (
                <li key={i}>
                  #{p.overall} · R{p.round}P{p.pickInRound} — <b>{p.username}</b> selected {label} ({p.slot})
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

const th = { textAlign: "left", borderBottom: "1px solid #eee", padding: "6px 4px" };
const td = { borderBottom: "1px solid #f5f5f5", padding: "6px 4px", verticalAlign: "top" };
