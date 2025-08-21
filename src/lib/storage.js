// src/lib/storage.js  (FULL FILE)
import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, serverTimestamp, runTransaction, query, where
} from "firebase/firestore";
import { computeFantasyPoints, DEFAULT_SCORING } from "./scoring";

/* ===== Players ===== */
export async function listPlayers({ leagueId } = {}) {
  try {
    if (leagueId) {
      const leagueCol = collection(db, "leagues", leagueId, "players");
      const leagueSnap = await getDocs(leagueCol);
      if (!leagueSnap.empty) return leagueSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch {}
  const globalCol = collection(db, "players");
  const globalSnap = await getDocs(globalCol);
  return globalSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// optional local import helper
export async function importPlayersGlobal(players = []) {
  for (const p of players) {
    await setDoc(doc(db, "players", p.id), p, { merge: true });
  }
}

/* ===== Claims / Availability ===== */
export async function getLeagueClaims(leagueId) {
  const claimsCol = collection(db, "leagues", leagueId, "claims");
  const snap = await getDocs(claimsCol);
  const map = new Map();
  snap.forEach((d) => map.set(d.id, d.data()));
  return map;
}
export function listenLeagueClaims(leagueId, onChange) {
  const claimsCol = collection(db, "leagues", leagueId, "claims");
  return onSnapshot(claimsCol, (qs) => {
    const map = new Map();
    qs.forEach((d) => map.set(d.id, d.data()));
    onChange(map);
  });
}

/* ===== Teams & Lineups ===== */
export async function ensureTeam({ leagueId, username }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username,
      roster: { QB: null, RB: null, WR: null, TE: null, FLEX: null, K: null, DEF: null },
      bench: [],
      createdAt: Date.now(),
    });
  }
  return ref;
}
export function listenTeam({ leagueId, username, onChange }) {
  const ref = doc(db, "leagues", leagueId, "teams", username);
  return onSnapshot(ref, (s) => onChange(s.exists() ? s.data() : null));
}
export async function setWeeklyLineup({ leagueId, username, week, starters }) {
  const ref = doc(db, "leagues", leagueId, "teams", username, "lineups", String(week));
  await setDoc(ref, { starters, savedAt: Date.now() });
}
export async function getWeeklyLineup({ leagueId, username, week }) {
  const ref = doc(db, "leagues", leagueId, "teams", username, "lineups", String(week));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : { starters: {} };
}

// Release a player you own: clear from roster & bench, and free the claim.
export async function releasePlayerAndClearSlot({ leagueId, username, playerId }) {
  if (!leagueId || !username || !playerId) {
    throw new Error("leagueId, username, and playerId are required");
  }

  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const txRef   = doc(collection(db, "leagues", leagueId, "transactions")); // auto-id

  await runTransaction(db, async (tx) => {
    // Make sure team exists
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() || {};
    const roster = { ...(team.roster || {}) };
    const bench  = Array.isArray(team.bench) ? team.bench.slice() : [];

    // Validate ownership of the claim (if the claim exists)
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists()) {
      const claim = claimSnap.data() || {};
      if (claim.claimedBy !== username) {
        throw new Error("You do not own this player");
      }
      // Remove the claim so the player becomes available league-wide
      tx.delete(claimRef);
    }

    // Clear from roster (any slot the player occupies)
    Object.keys(roster).forEach((slot) => {
      if (roster[slot] === playerId) roster[slot] = null;
    });

    // Remove from bench if present
    const idx = bench.indexOf(playerId);
    if (idx >= 0) bench.splice(idx, 1);

    // Persist team updates
    tx.update(teamRef, { roster, bench });

    // Log transaction (optional)
    tx.set(txRef, {
      createdAt: Date.now(),
      type: "release",
      username,
      playerId
    });
  });
}

export async function addDropPlayer({ leagueId, username, addId, dropId }) {
  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  const addClaimRef = doc(db, "leagues", leagueId, "claims", addId);
  const dropClaimRef = dropId ? doc(db, "leagues", leagueId, "claims", dropId) : null;
  const txRef = doc(collection(db, "leagues", leagueId, "transactions"));
  await runTransaction(db, async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() || {};
    const bench = Array.isArray(team.bench) ? team.bench.slice() : [];
    const roster = { ...(team.roster || {}) };

    const addSnap = await tx.get(addClaimRef);
    if (addSnap.exists()) throw new Error("Player already claimed");
    if (dropId) {
      const dropSnap = await tx.get(dropClaimRef);
      if (!dropSnap.exists() || dropSnap.data()?.claimedBy !== username) {
        throw new Error("You do not own the player to drop");
      }
      const bidx = bench.indexOf(dropId);
      if (bidx >= 0) bench.splice(bidx, 1);
      Object.keys(roster).forEach((slot) => { if (roster[slot] === dropId) roster[slot] = null; });
      tx.delete(dropClaimRef);
    }
    bench.push(addId);
    tx.set(addClaimRef, { claimedBy: username, claimedAt: serverTimestamp() });
    tx.update(teamRef, { bench, roster });
    tx.set(txRef, { createdAt: Date.now(), type: "add-drop", username, addId, dropId: dropId || null });
  });
}

/* ===== Draft ===== */
export function canDraft(league) {
  return (league?.draft?.status || "unscheduled") === "live";
}
export async function draftPick({ leagueId, username, playerId, playerPosition, slot }) {
  const leagueRef = doc(db, "leagues", leagueId);
  const claimRef = doc(db, "leagues", leagueId, "claims", playerId);
  const teamRef = doc(db, "leagues", leagueId, "teams", username);
  await runTransaction(db, async (tx) => {
    const leagueSnap = await tx.get(leagueRef);
    if (!leagueSnap.exists()) throw new Error("League not found");
    const league = leagueSnap.data() || {};
    const draft = league.draft || {};
    if ((draft.status || "unscheduled") !== "live") throw new Error("Draft is not live.");
    const order = Array.isArray(draft.order) ? draft.order : [];
    const pointer = Number.isInteger(draft.pointer) ? draft.pointer : 0;
    const currentUser = order[pointer];
    if (currentUser !== username) throw new Error(`It's ${currentUser}'s turn to pick.`);
    const existingClaim = await tx.get(claimRef);
    if (existingClaim.exists()) throw new Error("Player already drafted");

    let teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) {
      tx.set(teamRef, { username, roster: { QB:null,RB:null,WR:null,TE:null,FLEX:null,K:null,DEF:null }, bench: [], createdAt: Date.now() });
      teamSnap = await tx.get(teamRef);
    }
    const upperSlot = String(slot).toUpperCase();
    const upperPos = String(playerPosition || "").toUpperCase();
    const roster = { ...((teamSnap.data() && teamSnap.data().roster) || {}) };
    const isFlex = upperSlot === "FLEX";
    const validForFlex = ["RB", "WR", "TE"].includes(upperPos);
    if (!isFlex && upperSlot !== upperPos) throw new Error(`Cannot place a ${upperPos} into ${upperSlot}`);
    if (isFlex && !validForFlex) throw new Error(`Only RB/WR/TE can be assigned to FLEX`);
    if (roster[upperSlot]) throw new Error(`${upperSlot} is already filled.`);

    roster[upperSlot] = playerId;
    tx.set(claimRef, { claimedBy: username, claimedAt: serverTimestamp(), position: upperPos });
    tx.update(teamRef, { roster });

    const round = Number.isInteger(draft.round) ? draft.round : 1;
    const direction = draft.direction === -1 ? -1 : 1;
    const teamCount = order.length;
    const totalRounds = draft.totalRounds || 15;
    const pickInRound = direction === 1 ? pointer + 1 : teamCount - pointer;
    const overall = (round - 1) * teamCount + pickInRound;
    const newPicks = Array.isArray(draft.picks) ? draft.picks.slice() : [];
    newPicks.push({ overall, round, pickInRound, username, playerId, slot: upperSlot, ts: Date.now() });
    let newPointer = pointer + direction;
    let newRound = round;
    let newDirection = direction;
    if (newPointer >= teamCount || newPointer < 0) {
      newRound = round + 1;
      newDirection = direction * -1;
      newPointer = newDirection === 1 ? 0 : teamCount - 1;
    }
    const draftComplete = newRound > totalRounds;
    tx.update(leagueRef, {
      draft: {
        ...draft,
        picks: newPicks,
        pointer: draftComplete ? pointer : newPointer,
        round: draftComplete ? round : newRound,
        direction: draftComplete ? direction : newDirection,
        status: draftComplete ? "complete" : "live",
      },
    });
  });
}

/* ===== League Core ===== */
export async function getLeague(leagueId){ const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); return s.exists()? (s.data()||null):null; }
export function listenLeague(leagueId,onChange){ const ref=doc(db,"leagues",leagueId); return onSnapshot(ref,(s)=>onChange(s.exists()?(s.data()||null):null)); }
export async function initLeagueDefaults(leagueId){
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); if(!s.exists()) throw new Error("League not found");
  const data=s.data()||{};
  const defaults={
    draft:data.draft||{status:"unscheduled",scheduledAt:null,startedAt:null},
    settings:data.settings||{maxTeams:10,rosterSlots:{QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DEF:1},bench:5,scoring:DEFAULT_SCORING,season:2025,currentWeek:1},
    entry:{enabled:false,feePi:0,paid:[]},
    payouts:{winnerPi:0}
  };
  await updateDoc(ref,defaults); return (await getDoc(ref)).data();
}
export async function scheduleDraft(leagueId, iso){ const when=new Date(iso); if(isNaN(+when)) throw new Error("Invalid date/time"); const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); const data=s.data()||{}; await updateDoc(ref,{draft:{...(data.draft||{}),status:"scheduled",scheduledAt:when.toISOString(),startedAt:null}}); }
export async function setDraftStatus(leagueId,status){
  if(!["unscheduled","scheduled","live","complete"].includes(status)) throw new Error("Invalid draft status");
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); const data=s.data()||{}; const prev=data.draft||{};
  const patch=status==="live"?{draft:{...prev,status:"live",scheduledAt:null,startedAt:new Date().toISOString()}}:{draft:{...prev,status}};
  await updateDoc(ref,patch);
}
export async function initDraftOrder(leagueId){
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); if(!s.exists()) throw new Error("League not found");
  const data=s.data()||{}; const members=Array.isArray(data.members)?[...data.members]:[]; if(members.length<2) throw new Error("Need at least 2 members");
  for(let i=members.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [members[i],members[j]]=[members[j],members[i]]; }
  const slots=data?.settings?.rosterSlots||{QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DEF:1}; const totalRounds=Object.values(slots).reduce((a,b)=>a+(b||0),0)+(data?.settings?.bench??5);
  await updateDoc(ref,{draft:{...(data.draft||{}),status:"scheduled",order:members,pointer:0,round:1,direction:1,totalRounds,picks:[]}}); return (await getDoc(ref)).data();
}
export async function setDraftOrder(leagueId,orderArray){
  if(!Array.isArray(orderArray)||orderArray.length<2) throw new Error("Provide 2+ usernames");
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); const data=s.data()||{};
  await updateDoc(ref,{draft:{...(data.draft||{}),order:orderArray,pointer:0,round:1,direction:1,picks:[]}})
}

/* ===== League list/create/join ===== */
export async function listMyLeagues(username){
  if(!username) return [];
  const leaguesCol=collection(db,"leagues");
  const ownerQ=query(leaguesCol,where("owner","==",username));
  const memberQ=query(leaguesCol,where("members","array-contains",username));
  const [o,m]=await Promise.all([getDocs(ownerQ),getDocs(memberQ)]);
  const map=new Map(); o.forEach((d)=>map.set(d.id,{id:d.id,...d.data()})); m.forEach((d)=>map.set(d.id,{id:d.id,...d.data()}));
  return Array.from(map.values());
}
export async function createLeague({ name, owner, id }){
  const leagueId=id||(typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():`lg_${Math.random().toString(36).slice(2)}`);
  const ref=doc(db,"leagues",leagueId);
  await setDoc(ref,{ id:leagueId, name:name||"New League", owner, members:[owner],
    draft:{status:"unscheduled",scheduledAt:null,startedAt:null},
    settings:{maxTeams:10,rosterSlots:{QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DEF:1},bench:5,scoring:DEFAULT_SCORING,season:2025,currentWeek:1},
    entry:{enabled:false,feePi:0,paid:[]}, payouts:{winnerPi:0}, createdAt:Date.now() });
  return (await getDoc(ref)).data();
}
export async function joinLeague({ leagueId, username }){
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); if(!s.exists()) throw new Error("League not found");
  const data=s.data()||{}; const members=Array.isArray(data.members)?data.members:[]; if(!members.includes(username)){ members.push(username); await updateDoc(ref,{members}); }
  return (await getDoc(ref)).data();
}

/* ===== Schedule & Matchups (simple RR generator you had) ===== */
export async function generateSchedule({ leagueId, weeks=14 }) {
  const ref=doc(db,"leagues",leagueId); const s=await getDoc(ref); if(!s.exists()) throw new Error("League not found");
  const data=s.data()||{}; const members=Array.isArray(data.members)?data.members.slice():[]; if(members.length<2) throw new Error("Need 2+ members");
  const matchupsCol=collection(db,"leagues",leagueId,"matchups");
  let week=1; const rotations=members.slice(1);
  for(;week<=weeks;week++){
    const left=[members[0],...rotations.slice(0,Math.floor(rotations.length/2))];
    const right=[...rotations.slice(Math.floor(rotations.length/2))].reverse();
    const pairs=[]; for(let i=0;i<right.length;i++){ pairs.push([left[i+1]||left[0], right[i]]); }
    pairs.unshift([members[0], rotations[0]]);
    for(const [home,away] of pairs){ if(!home||!away) continue;
      const id=`${data.settings.season}-${week}-${home}-vs-${away}`;
      await setDoc(doc(matchupsCol,id),{id,week,season:data.settings.season,home,away,status:"scheduled",createdAt:Date.now()});
    }
    rotations.push(rotations.shift());
  }
}
export async function listMatchups({ leagueId, week }) {
  const col=collection(db,"leagues",leagueId,"matchups"); const s=await getDocs(col);
  return s.docs.map((d)=>d.data()).filter((m)=>m.week===week);
}

/* ===== Scoring helpers ===== */
export function totalPointsForLineup({ lineup, statsByPlayer, scoring = DEFAULT_SCORING }) {
  if (!lineup) return 0;
  let sum = 0;
  Object.values(lineup || {}).forEach((playerId) => {
    if (!playerId) return;
    const stat = statsByPlayer[playerId] || null;
    sum += computeFantasyPoints(stat, scoring);
  });
  return Number(sum.toFixed(2));
}

/* ===== NEW: projections & next-game helpers ===== */
export async function fetchProjections(week) {
  const r = await fetch(`/api/stats/week?week=${encodeURIComponent(week||1)}`);
  const j = await r.json();
  return j.stats || {};
}
export async function fetchNextGames(season) {
  const r = await fetch(`/api/schedule/next?season=${encodeURIComponent(season || "")}`);
  const j = await r.json();
  return j.next || {};
}
