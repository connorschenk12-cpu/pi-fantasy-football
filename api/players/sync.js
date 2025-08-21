// /api/players/sync.js
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBWEBHSEPR8JummZhprqMS80DOptQHoYKg",
  authDomain: "pi-fantasy-football.firebaseapp.com",
  projectId: "pi-fantasy-football",
  storageBucket: "pi-fantasy-football.firebasestorage.app",
  messagingSenderId: "133234554090",
  appId: "1:133234554090:web:254d166d2b13640440d393"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Map Sleeper positions to our app positions
const POS_MAP = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF" };

// Filter to active fantasy-relevant players
function keepPlayer(p) {
  if (!p || p.active === false) return false;
  if (!p.position) return false;
  const pos = POS_MAP[p.position];
  if (!pos) return false;
  // Team defenses come through as type: "DEF"
  if (pos === "DEF" && !p.team) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  try {
    // Sleeper all players (this is a big JSON; do not call too often)
    // Official docs point to v1; community clients also use /players/nfl
    // We set a 1h cache on Vercel’s edge for safety.
    const r = await fetch("https://api.sleeper.app/v1/players/nfl", { next: { revalidate: 3600 } });
    const all = await r.json();

    let count = 0;
    for (const pid in all) {
      const sp = all[pid];
      if (!keepPlayer(sp)) continue;

      const id = String(pid);
      const data = {
        id,
        name: sp.full_name || sp.first_name && sp.last_name ? `${sp.first_name} ${sp.last_name}` : sp.last_name || sp.first_name || sp.nickname || "Unknown",
        position: POS_MAP[sp.position],
        team: sp.team || (sp.fantasy_positions && sp.fantasy_positions[0]) || "",
        bye: sp.bye_week || null,
        // For defenses, use team name as display
        displayName: POS_MAP[sp.position] === "DEF" ? `${sp.team} D/ST` : (sp.full_name || sp.last_name || sp.first_name || "Player"),
        sleeper: {
          id,
          status: sp.status || null,
          depth_chart_order: sp.depth_chart_order ?? null
        }
      };
      await setDoc(doc(db, "players", id), data, { merge: true });
      count++;
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, imported: count });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "sync failed" });
  }
}
