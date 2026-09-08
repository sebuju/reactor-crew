"use strict";
/* The field is STATE (s.roomT) rather than a per-tick kernel like rad.js, because heat has memory. */

// m - THE ASSUMPTION: air mass and every hydrogen concentration scale on it
const ROOM_DEPTH = 4.0;
const ROOM_RHO = 1.2, ROOM_CP = 1.0;      // air: kg/m^3, kJ/kg/K
// W/m^2/K - free convection off a lagged industrial surface
const ROOM_H = 6;
/* m^2/s - the one fit here. H2_UP binds the explicit stability cap at 0.63 m^2/s (dt=0.02); past it, substep rather than raise this. */
const ROOM_MIX = 0.35;
// hot air rises: the conductance up out of a cell against the one down into it
const ROOM_UP = 3.0;
// fraction that crosses an occupied cell: a machine is a wall
const ROOM_BLOCK = 0.12;
/* K - a runaway guard only, set clear of the measured worst case (severed hot leg 17210 K) and priced against ROOM_CGAME. */
const ROOM_TMAX = 20000;
/* K - what the ship was BUILT at, and what the compartment starts at; not a boundary, because the skin radiates. */
const T_HULL = 293;
/* Painted metal hull, the figure RADCOAT's default coating carries; ONE number, because there is one skin and the player cannot buy another. */
const HULL_EMIS = 0.85;
// m^2 of skin ONE OUTWARD FACE of a hull cell carries
const HULL_FACE_A = MPC*ROOM_DEPTH;

/* Bought balance standing in for the structure and the condensation on it. SOURCE side only: g0 is priced off ROOM_C, so the stencil divides it straight back out and the stability limit does not move; never applied to ROOM_MOL or ROOM_MAIR, which are real air. */
const ROOM_CGAME = 50;
/* ROOM_CAIR is the REAL air in one cell, ROOM_C that air plus the ballast: a slow source heats at ROOM_C, a deflagration at ROOM_CAIR because the steel has no time to take any of it. */
const ROOM_CAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO*ROOM_CP;
const ROOM_C = ROOM_CAIR*ROOM_CGAME;
/* A bang is at constant volume, so it heats at cv; ROOM_CP stays right for everything that FLOWS. */
const ROOM_CV = 0.718;
const ROOM_CVAIR = ROOM_CAIR*ROOM_CV/ROOM_CP;
// kW/K, one cell of hot surface
const ROOM_HK = ROOM_H*MPC*MPC/1000;
/* kg of compartment air per second one ventilation SET moves, removed AT THE CELLS IT IS STANDING IN, so siting decides what it is worth. A bigger footprint buys nothing: the set is rated, not the hole it sits in. */
const ROOM_VENT_KGS = 50;
/* kg of nitrogen per second one inerting set puts in; a fraction of the fan because it is bottled gas rather than a duct to the rest of the ship. */
const INERT_KGS = 10;

/* THE ONE DOOR onto how hot a box is, so field, readout and damage criterion cannot disagree; a role that moves no heat returns null. */
function partTemp(s, p){
  const R = ROLE[p.role];
  if(!R || R.thermal === "none") return null;
  if(p.role === "sg")   return s.sgTBy[p.id];
  // an exchanger has no pot: what the box contains is what its own nodes hold
  if(p.role === "ihx"){ let t=0, n=0;
    for(const IN of roleIns(p)) for(const f of [IN.a, IN.b]){
      t += netTempAt(s, coreFold(p.id+f)); n++; }
    return n ? t/n : s.Tavg; }
  if(p.role === "cond") return s.condTBy[p.id];
  if(p.role === "radiator") return s.radTBy[p.id];
  return s.Tavg;                          // thermal:"source" - the vessel itself
}
/* partTemp() is what a machine CONTAINS; this is the metal between that and the air, and it is the thing that fails. On S, because a skin with no memory is not a skin. */
const ROOM_SKIN_TAU = 45;                 // s, skin against the air
const SKIN_PROC_K = 20;                   // contents-side conductance / air-side
const skinCap = n => ROOM_SKIN_TAU*n*ROOM_HK;         // kJ/K
const partSkin = (s, p) => { const v = s && s.partT && s.partT[p.id];
  return v === undefined ? (partTemp(s, p) ?? T_HULL) : v; };
// kW the CONTENTS lose through their own skin, one tick old because the room is stepped after the pots
const skinQOf = (s, id) => (s.skinQ && s.skinQ[id]) || 0;
// summed per ROLE, because the vessel, condenser and radiator fleets each share one pot
const skinQRole = (s, role) => { let q = 0;
  for(const p of LAY.parts) if(p.role === role) q += skinQOf(s, p.id);
  return q; };
/* THE RUN'S OWN NODE, never the machines it lands on or its kind: an isolated line holds what it holds. */
function runFluidNodes(s, key){
  const net = P.net;
  if(!net || !net.index) return null;
  const nid = runNodeOf(key);
  return net.index[nid] === undefined ? null : [nid];
}
const nodeMean = (nodes, read) => { let t = 0, n = 0;
  for(const nd of nodes || []){ const v = read(nd); if(isFinite(v)){ t += v; n++; } }
  return n ? t/n : null; };
const runFluidT = (s, key) => nodeMean(runFluidNodes(s, key), nd => netTempAt(s, nd));
/* ENTHALPY, not temperature: a hole flashes, and the latent heat in the jet is most of what the compartment gets. */
function runFluidH(s, key){
  const nodes = runFluidNodes(s, key);
  const h = nodeMean(nodes, nd => netHAt(s, nd));
  return h === null ? null : {h, c:netSatOf(nodes[0])};
}
/* The DONOR node's water, never a mean of the two sides: averaging in the outlet cools the jet by its own effect. Donor = higher pressure, advectStep()'s upwind rule. */
function partFluidNode(s, id){
  const net = P.net;
  if(!net || !net.index) return null;
  let best = null, bp = -Infinity;
  for(const face of ["t","r","b","l"]){
    const nm = coreFold(id + face);
    if(!nm || net.index[nm] === undefined) continue;
    const p = netPAt(s, nm);
    if(!(p > bp)) continue;
    if(!isFinite(netTempAt(s, nm))) continue;
    bp = p; best = nm;
  }
  return best;
}
function partFluidH(s, id){
  const nd = partFluidNode(s, id);
  if(!nd) return null;
  const h = netHAt(s, nd);
  // the NODE travels with the reading: a spray needs the pressure it is leaving
  return isFinite(h) ? {h, c:netSatOf(nd), nd} : null;
}
/* Heat and hydrogen leave through the same hole at the same rate, so both ask this one reader. */
// a break key names a PART (no colon in it) or a RUN (its key always has one)
const breakPart = k => { const t = k.slice(6); return t.indexOf(":") < 0 ? t : null; };
// ...or a reactor CAVITY ("break:cav:"+core id): the core's cells, the cavity node's own water
const breakCav = k => k.indexOf("break:cav:") === 0 ? k.slice(10) : null;
const openFluidH = (s, k) => { const pid = breakPart(k), cid = breakCav(k);
  if(cid){ const nd = "cav:"+cid, h = netHAt(s, nd); return isFinite(h) ? {h, c:netSatOf(nd), nd} : null; }
  return pid ? partFluidH(s, pid) : runFluidH(s, k.slice(6)); };
/* One walk for the heat, hydrogen and fire passes: fn(cells, rate, fl, key), key as advectH2Out is keyed. */
function roomLiqOuts(s, G, fn){
  const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
  for(const k in s.spillBy){
    const fl = openFluidH(s, k);
    if(fl) fn(roomOpenCells(s, G, k), s.spillBy[k], fl, k);
  }
  for(const fid in s.reliefVent){
    if(tgt[fid] || out[fid]) continue;
    const fl = partFluidH(s, fid);
    if(!fl) continue;
    const q = G.parts.find(w => w.p.id === fid);
    fn(q ? q.cells : [], s.reliefVent[fid], fl, "vent:"+fid);
  }
}
/* A hole nobody can measure does not spray: a torn machine and a breached cavity state no bore. */
const openBoreM = key => {
  if(key.indexOf("vent:") === 0) return fitBoreMm(key.slice(5))/1000;
  if(key.indexOf("break:cav:") === 0) return 0;
  const t = key.slice(6);
  if(t.indexOf(":") < 0) return 0;
  const r = P.net && P.net.byKey && P.net.byKey[t];
  return r ? runBoreMm(r)/1000 : 0;
};

/* Memoised on the arrangement: everything in here is a fact about where things are, never about what they are doing. */
let roomCache = null, roomCacheSig = "";
function roomGeom(){
  /* A wall is always a wall, so damage is NOT in this key: a shot cell still separates and what crosses it goes through roomHoleStep()'s orifice. */
  const sig = laySig()+"|"+pipeSig()+matSig();
  if(roomCache && roomCacheSig === sig) return roomCache;
  const N = GW*GH;
  const occ = new Uint8Array(N);
  const parts = [], runs = [], hull = new Uint8Array(N), face = new Uint8Array(N);
  const g = occupied(null, {pipes:false, ports:false});
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(g[Y][X]) occ[i] = 1;
    if(hullCell(X,Y)) hull[i] = 1;
    /* A corner carries two faces; hullCell() answering true off-grid is what makes an edge cell count exactly one. */
    if(hull[i]) for(const f in DIRV){ const d = DIRV[f];
      if(hullCell(X+d[0],Y+d[1])) face[i]++; }
  }
  /* Which machine stands in this cell, walked once: the ignition test asks per cell per tick. Last one wins, as occupied() answers an overlap. */
  const own = new Int32Array(N).fill(-1);
  // ...and which cells a CATCH PAN stands in, on the same walk
  const pan = new Uint8Array(N);
  for(const p of LAY.parts){
    const cells = [];
    for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
      if(X>=0&&X<GW&&Y>=0&&Y<GH) cells.push(Y*GW+X);
    if(cells.length){ for(const i of cells){ own[i] = parts.length;
      if(p.role === "pan") pan[i] = 1; } parts.push({p, cells}); }
  }
  for(const r of pipeNetwork()){
    if(!r.cells) continue;
    runs.push({key:r.key, cells:r.cells.map(([x,y])=>y*GW+x)});
  }
  /* Walked once rather than per tick: shellsOf() is a graph walk. */
  const shellValves = {};
  for(const p of LAY.parts) if(p.role === "sg") shellValves[p.id] = [];
  if(typeof reliefFitIds === "function")
    for(const fid of reliefFitIds())
      for(const id of shellsOf(fid)) if(shellValves[id]) shellValves[id].push(fid);

  /* One per EDGE, so every pair is priced exactly once. Blocked through an occupied cell at either end - a machine is a wall. */
  const g0 = ROOM_MIX*ROOM_C/(MPC*MPC);   // kW/K between two open cells
  /* `blk` is a product over BOTH cells of a face, so a zero here kills all four faces in both directions for every field that diffuses on these arrays: what leaves a region leaves through the hole. matWall() is the one predicate. */
  const tight = new Uint8Array(N);
  for(const k in (D.mat||{})){ const j=k.indexOf(","), X=+k.slice(0,j), Y=+k.slice(j+1);
    if(X>=0&&X<GW&&Y>=0&&Y<GH && matWall(X,Y)) tight[Y*GW+X]=1; }
  const blk = i => tight[i] ? 0 : (occ[i] ? ROOM_BLOCK : 1);
  const gx = new Float64Array(N), gUp = new Float64Array(N), gDn = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(X<GW-1) gx[i] = g0*blk(i)*blk(i+1);
    if(Y<GH-1){ const b = g0*blk(i)*blk(i+GW);
      gUp[i] = b*ROOM_UP; gDn[i] = b; }
  }
  /* Obstacle-generated turbulence off the occ array the stencil already built, so a plant drawn tight accelerates its own flame. */
  const turb = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    let n = 0;
    if(X>0 && occ[i-1]) n++;
    if(X<GW-1 && occ[i+1]) n++;
    if(Y>0 && occ[i-GW]) n++;
    if(Y<GH-1 && occ[i+GW]) n++;
    turb[i] = 1 + H2_TURB*n/4;
  }
  roomCache = {occ, tight, face, own, pan, turb, parts, runs, shellValves, gx, gUp, gDn};
  roomCacheSig = sig;
  return roomCache;
}

/* Scratch, never read across a call: NOT state, every element is written before it is read. */
let roomSrc = null, roomD = null, roomD2 = null;
const roomScratch = () => { const N = GW*GH;
  // re-cut on N, not on first call: the hull is draggable
  if(!roomSrc || roomSrc.length !== N){
    roomSrc = new Float64Array(N); roomD = new Float64Array(N); roomD2 = new Float64Array(N); }
  return N; };

/* A discharging jet ENTRAINS: ROOM_ENTRAIN*ROOM_JET_TAU over the air in one cell IS the size of the plume, and the temperature it delivers, h/(ROOM_ENTRAIN*ROOM_CP), is the same for a weep and a rupture - only the volume differs. */
const ROOM_ENTRAIN = 25;                  // kg of room air per kg of discharge
const ROOM_JET_TAU = 1.0;                 // s to entrain it
const ROOM_MAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO;   // kg of air in one cell

/* s.roomM is kg of gas per cell; pressure follows from it and the air's own temperature by the ideal gas law, so a discharge really raises it and a hole really lowers it. */
const R_AIR = 0.000287;                   // MPa*m3/(kg*K)
const ROOM_VCELL = MPC*MPC*ROOM_DEPTH;    // m3 of one cell
// absolute MPa, off a mass and a temperature - the ONE pressure read
const roomPOf = (kg, vol, T) => kg*R_AIR*T/Math.max(vol, 1e-6);
/* One orifice law for any hole between any two gas volumes; AREA m2, PRESSURES MPa absolute, DENSITY of the UPSTREAM gas. */
const roomHoleKgs = (aM2, pUp, pDn, rhoUp) =>
  flowW(ORIF_CD*Math.max(aM2,0), rhoUp, pUp, pDn);

/* One expression: heat and hydrogen leave through the same hole at the same rate and must land in the same cells. */
const roomPlumeFor = (cells, kgps) => roomPlume(cells,
  clamp(Math.round(kgps*ROOM_ENTRAIN*ROOM_JET_TAU/ROOM_MAIR), cells.length, GW*GH));

/* A plume is NOT well mixed: weight 1/(1+ring) off the breadth-first ring, so the opening is the hot end and the far side is a draught. */
function roomShare(cells, kgps, put){
  if(!cells.length) return;
  // the plume is roomQ[0..n) - see roomPlume(), which hands back a COUNT
  const n = roomPlumeFor(cells, kgps);
  let w = 0;
  for(let k=0;k<n;k++) w += 1/(1+roomRing[roomQ[k]]);
  for(let k=0;k<n;k++){ const i=roomQ[k]; put(i, 1/(1+roomRing[i])/w); }
}
function roomSpread(F, cells, kgps, amount){
  if(!(amount > 0)) return;
  roomShare(cells, kgps, (i,f) => { F[i] += amount*f; });
}
const roomJet = (src, cells, kW, kgps) => roomSpread(src, cells, kgps, kW);
/* The machinery half of the gas law, and the door anything venting into a compartment calls: the same plume and cells, but a MASS. */
const roomAddGas = (s, cells, kg, kgps) =>
  roomSpread(s.roomM, cells, kgps, kg);
/* Charged in ENTHALPY, never cp*dT, and against each cell's OWN air, so the plume both heats and cools and the room can only approach the jet. */
function roomJetLiq(src, T, cells, kg, h, c){
  if(!(kg > 0)) return;
  roomShare(cells, kg, (i,f) => { src[i] += kg*f*(h - hOfT(c, T[i])); });
}
/* Breadth-first out of the opening, deterministic for the snapshot round trip; it crosses an occupied cell, because a machine deflects a gas rather than sealing it. The queue and the mark are module state and the answer is a COUNT. */
let roomSeen = null, roomQ = null, roomRing = null, roomPlumeGen = 0;
let roomMark = 0, roomTail = 0;
const roomPush = (j, r) => { roomSeen[j] = roomMark; roomRing[j] = r; roomQ[roomTail++] = j; };
function roomPlume(cells, n){
  const N = GW*GH;
  if(!roomSeen){ roomSeen = new Int32Array(N); roomQ = new Int32Array(N);
                 roomRing = new Int32Array(N); }
  roomMark = ++roomPlumeGen;
  const mark = roomMark;
  // a plume is gas, and blk already refuses a gas-tight cell everywhere else
  const tight = roomGeom().tight;
  let head = 0; roomTail = 0;
  for(const i of cells) if(roomSeen[i] !== mark) roomPush(i, 0);
  while(head < roomTail && roomTail < n){
    const i = roomQ[head++], X = i%GW, Y = (i/GW)|0, r = roomRing[i]+1;
    const ok = j => roomSeen[j]!==mark && !tight[j] && roomTail<n;
    if(Y>0)      { const j=i-GW; if(ok(j)) roomPush(j, r); }
    if(X>0)      { const j=i-1;  if(ok(j)) roomPush(j, r); }
    if(X<GW-1)   { const j=i+1;  if(ok(j)) roomPush(j, r); }
    if(Y<GH-1)   { const j=i+GW; if(ok(j)) roomPush(j, r); }
  }
  return roomTail;
}
// kJ/kg a kilogram of secondary steam is worth to the room, above ambient water
const roomSteamH = () => steamRise() + CP_W*(T_FEED - T_HULL);

/* Sources, transport, sink, in that order; nothing here writes anything but s.roomT, s.roomH2 and the readouts off them. */
function roomStep(s, dt){
  const G = roomGeom(), T = s.roomT, N = roomScratch();
  const src = roomSrc, d = roomD;
  src.fill(0);

  /* Contents -> skin -> air, every arrow both ways, and what the room gets is booked against the pot it came out of (s.skinQ, spent in step.js). */
  const live = {};
  for(const q of G.parts){
    const id = q.p.id, n = q.cells.length, Tp = partTemp(s, q.p);
    const proc = Tp !== null && isFinite(Tp);
    live[id] = 1;
    if(s.partT[id] === undefined) s.partT[id] = proc ? Tp : T_HULL;
    const Ts = s.partT[id];
    let air = 0;
    for(const i of q.cells) air += T[i];
    const qProc = proc ? n*ROOM_HK*SKIN_PROC_K*(Tp - Ts) : 0;
    s.skinQ[id] = qProc;
    s.partT[id] = clamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt,
                        T_SPACE, ROOM_TMAX);
    for(const i of q.cells) src[i] += ROOM_HK*(Ts - T[i]);
  }
  for(const id in s.partT) if(!live[id]){ delete s.partT[id]; delete s.skinQ[id]; }
  /* A run's wall is the same pot; with no readable fluid it falls to the air at its own time constant rather than pinning at the reactor's mean. */
  // one skin per REGION: a lumped run is infinite axial conductance, so a penetration would carry a broken compartment's air out through its own wall
  const liveRun = {}, regOf = matRegions().of;
  for(const r of G.runs){
    const seg = {};
    // a cell the wall was painted over is not air, and is in no region
    for(const i of r.cells){ const ri = regOf[i]; if(ri < 0) continue;
      if(!seg[ri]) seg[ri] = []; seg[ri].push(i); }
    const Tf = runFluidT(s, r.key);
    for(const ri in seg){
      const cells = seg[ri], key = r.key+"#"+ri, n = cells.length;
      liveRun[key] = 1;
      if(s.runT[key] === undefined) s.runT[key] = Tf === null ? T_HULL : Tf;
      const Ts = s.runT[key];
      let air = 0;
      for(const i of cells) air += T[i];
      const qProc = Tf === null ? 0 : n*ROOM_HK*SKIN_PROC_K*(Tf - Ts);
      s.runT[key] = clamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt,
                          T_SPACE, ROOM_TMAX);
      for(const i of cells) src[i] += ROOM_HK*(Ts - T[i]);
    }
  }
  for(const k in s.runT) if(!liveRun[k]) delete s.runT[k];

  /* net.fitTarget is the gate - a tank to catch this, or straight into the room - and net.fitVentOut the second, gone up the stack because the valve's open face is against the skin. */
  const cellsOf = id => { const q = G.parts.find(w => w.p.id === id); return q ? q.cells : []; };
  const tgt = (P.net && P.net.fitTarget) || {}, out = (P.net && P.net.fitVentOut) || {};
  for(const fid in s.reliefSteam){
    if(tgt[fid] || out[fid]) continue;               // caught in a tank, or vented outside
    roomJet(src, cellsOf(fid), s.reliefSteam[fid]*roomSteamH(), s.reliefSteam[fid]);
    roomAddGas(s, cellsOf(fid), s.reliefSteam[fid]*dt, s.reliefSteam[fid]);
  }
  /* A hole has no set point, bore or stack, so this is gated on neither map: gating it would make a plant safe by accident. */
  for(const id in s.sgVentBy){
    let byValve = 0;
    for(const fid of (G.shellValves[id] || [])) byValve += s.reliefSteam[fid] || 0;
    const hole = Math.max(0, s.sgVentBy[id] - byValve);
    roomJet(src, cellsOf(id), hole*roomSteamH(), hole);
    roomAddGas(s, cellsOf(id), hole*dt, hole);
  }
  /* The shell's hydrogen (sgReactStep(), step.js) leaves in proportion to what it is venting, in the same plume, so it collects at the deckhead. */
  for(const id in s.sgH2By){
    const m = s.sgH2By[id], rate = s.sgVentBy[id] || 0;
    if(!(m > 0) || !(rate > 0)) continue;
    const f = Math.min(1, rate*dt/Math.max(s.sgSteamBy[id] || 0, 1e-6));
    s.sgH2By[id] = m - m*f;
    roomSpread(s.roomH2, cellsOf(id), rate, m*f);
  }
  /* The primary side as LIQUID, in the state the opening is actually passing; invRate()'s % of loop inventory bridged through loopKg(). */
  const kgOf = rate => Math.max(0, rate)/100*loopKg();
  roomLiqOuts(s, G, (cells, rate, fl) => {
    /* A fluid that burns lands as a pool and gives its heat up through its own surface (roomFireStep), so charging the air here would spend the same joules twice. */
    if(fl.c.burn) return;
    const kg = kgOf(rate);
    roomJetLiq(src, T, cells, kg, fl.h, fl.c);
    roomAddGas(s, cells, kg*dt, kg);
  });
  roomFireStep(s, dt, G, src);

  /* No network presence at all, the shield/catcher idiom; on the main board, so a blackout leaves the room with nothing but its hull. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || partWrecked(s, q.p.id)) continue;
    /* Against T_HULL: the set moves this air to the rest of the ship and draws the same mass back, so there is no mass loss to carry. */
    const ua = ROOM_VENT_KGS*ROOM_CP/q.cells.length;
    for(const i of q.cells) src[i] -= ua*(T[i] - T_HULL);
  }

  /* Explicit, four neighbours, one pass over edges; the vertical pair is ASYMMETRIC and that is the buoyancy. */
  for(let i=0;i<N;i++) d[i] = src[i];
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*(T[i]-T[i+1]);
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X, j = i+GW, dT = T[j]-T[i];     // j is BELOW i on this grid
    const q = (dT > 0 ? G.gUp[i] : G.gDn[i])*dT;    // positive: heat rising into i
    d[i] += q; d[j] -= q;
  }
  /* Stefan-Boltzmann on the panels' own T_SPACE, folded into the same explicit step so the hull is an ordinary cell with one extra term; finite because only what the air conducts to the skin feeds it. Floored at T_SPACE, so a compartment colder than T_HULL is legal. */
  { const k = HULL_EMIS*SIGMA*HULL_FACE_A/1000;      // kW per K^4 per face
    for(let i=0;i<N;i++) if(G.face[i])
      d[i] -= k*G.face[i]*(Math.pow(T[i],4) - Math.pow(T_SPACE,4)); }
  for(let i=0;i<N;i++) T[i] = clamp(T[i] + d[i]/ROOM_C*dt, T_SPACE, ROOM_TMAX);

  roomH2Step(s, dt, G);
  /* After the diffusion: the hole is the ONLY path between two volumes and must see what each holds this tick. */
  roomCondense(s, dt);
  roomHoleStep(s, dt);
  roomShipLeak(s, dt);

  { let mx = 0, at = -1;
    for(let i=0;i<N;i++) if(T[i] > mx){ mx = T[i]; at = i; }
    s.roomMax = mx; s.roomMaxAt = at; }
}

/* s.spillBy is keyed the way netBuild() names its break edges, and only the cells actually cut are open. */
function roomOpenCells(s, G, key){
  { const pid = breakPart(key) || breakCav(key);
    if(pid){ const q = G.parts.find(w => w.p.id === pid); return q ? q.cells : []; } }
  const r = P.net.byKey[key.slice(6)];
  if(!r || !r.cells) return [];
  const out = [];
  for(const [x,y] of r.cells) if(cellBroken(s, x, y)) out.push(y*GW+x);
  /* A wrecked nozzle is an opening on this run too, discharging at the PORT's cell rather than any pipe cell. */
  for(const pid of [r.pa, r.pb]){
    if(!pid || !portWrecked(s, pid)) continue;
    const c = portCell(pid);
    if(c) out.push(c[1]*GW+c[0]);
  }
  return out;
}

/* Hydrogen leaves with the escaping steam and deflagrates past the flammability limits and auto-ignition; ROOM_DEPTH sets every concentration here. */
const H2_LFL = 0.04;                      // volume fraction in air
/* A cell of nearly pure hydrogen is the SAFE one: there is no air left in it to burn. */
const H2_UFL = 0.75;
const H2_IGN = 773;                       // K
const H2_LHV = 120000;                    // kJ/kg
const H2_MMOL = 0.002016, AIR_MMOL = 0.02896;   // kg/mol
// kg in ONE tick's deflagration worth a log line; see the caller in step.js
const H2_BURN_EV = 1.0;
// moles of air in one cell - the denominator every concentration divides by
const ROOM_MOL = MPC*MPC*ROOM_DEPTH*ROOM_RHO/AIR_MMOL;

/* kg per cell on S, s.roomH2's shape. Combustion is capped at 2 H2 : 1 O2, so a rich cell burns weakly and a sealed corner smothers its own fire; diffuses on the same stencil with NO buoyancy bias. */
const O2_FRAC0 = 0.2095;                  // volume fraction of dry air
const O2_MMOL = 0.032;                    // kg/mol
const O2_LOC = 0.05;                      // limiting oxygen concentration for H2 in air
// kg of O2 one cell holds at ambient, and what the ventilation set puts back
const ROOM_O2_0 = O2_FRAC0*ROOM_MOL*O2_MMOL;
// kg of oxygen a kilogram of hydrogen wants: 2 H2 + O2 -> 2 H2O, arithmetic
const O2_PER_H2 = O2_MMOL/(2*H2_MMOL);
/* Hydrogen's own buoyancy against air's ROOM_UP: it collects at the DECKHEAD, and the molar mass ratio IS the bias rather than a second typed number. The explicit stability cap allows about 28 at dt=0.02. */
const H2_UP = AIR_MMOL/H2_MMOL;

/* Laminar burning velocity m/s against hydrogen fraction: a limit mixture takes about nine seconds to cross one MPC cell and a stoichiometric one a sixth of a second. */
const H2_SL = [[0.04,0.05],[0.10,0.40],[0.20,1.30],[0.30,2.60],
               [0.40,3.00],[0.60,1.60],[0.75,0.30]];
function h2Sl(f){
  if(f <= H2_SL[0][0] || f >= H2_SL[H2_SL.length-1][0]) return 0;
  for(let k=1;k<H2_SL.length;k++){ const x1 = H2_SL[k][0], y1 = H2_SL[k][1],
                                   x0 = H2_SL[k-1][0], y0 = H2_SL[k-1][1];
    if(f <= x1) return y0 + (y1-y0)*(f-x0)/(x1-x0); }
  return 0;
}
/* Bought: obstacle-generated turbulence, the mechanism a laminar velocity cannot express, applied off roomGeom()'s occ array. */
const H2_TURB = 4;
/* Constant-volume combustion off the SAME q the heat term uses. There is no detonation switch: the axis is burning velocity against ROOM_P_TAU's relief time, and H2_TURB and ROOM_P_TAU are the two to hold still while measuring anything else. */
const ROOM_P0 = 101.3;                    // kPa, ambient
const ROOM_P_TAU = 0.5;                   // s

/* Read off the same roomH2Frac() the layer draws, so a cell cannot draw as safe and burn. */
const roomFlamOf = (f,fo2) => f >= H2_LFL && f <= H2_UFL && fo2 >= O2_LOC;
const roomFlam = (s,i) => roomFlamOf(roomH2Frac(s,i), roomO2Frac(s,i));
/* The front burns into the UNBURNT share (1 - roomFlame), never the cell average, or a cell dilutes itself below the limit halfway through its own passage. Floored, because the last sliver is arithmetically pure hydrogen and would quench on the RICH limit rather than run out. */
const ROOM_FR_MIN = 0.1;
const roomFrontU = (s,i) => Math.max(ROOM_FR_MIN, 1 - s.roomFlame[i]);
const roomFrontFrac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(ROOM_MOL*roomFrontU(s,i) + n) : 0; };
const roomFrontO2 = (s,i) => s.roomO2[i]/O2_MMOL
  /(ROOM_MOL*roomFrontU(s,i) + s.roomH2[i]/H2_MMOL);
// the continuation test; roomFlam() is the IGNITION test, and an unlit cell answers both the same
const roomFlamFront = (s,i) => roomFlamOf(roomFrontFrac(s,i), roomFrontO2(s,i));
/* Three sources, ONE predicate: the air, the metal skin the gas actually touches, and a wrecked box sparking at any temperature. */
function roomIgnites(s, G, i){
  if(s.roomT[i] >= H2_IGN) return true;
  const k = G.own[i];
  if(k < 0) return false;
  const p = G.parts[k].p;
  return partSkin(s, p) >= H2_IGN || partWrecked(s, p.id);
}

/* A metal fire is a SURFACE, not a front, so this is a pool with a mass and a temperature; energy is the state, datum LIQUID AT THE MELTING POINT, so a negative energy is exactly the latent heat of fusion. lhv/o2 are the Na2O2 reaction; the w* columns are the same metal meeting WATER, which needs neither oxygen nor a spark. rate, wrate, wast and eta are bought. */
const FIRE = {
  NA:{ lhv:11111, o2:0.6959, ign:400, melt:371, boil:1156, lf:113,
       rate:0.011111, loc:0.05, emis:0.80, hConv:0.010, sigma:0.180, eta:0.40,
       wlhv:7994, wh2:0.04385, wh2o:0.7836, wrate:2.0, wast:0.02, wastMax:20 },
};
const FIRE_KEYS = Object.keys(FIRE);
// kg of metal in ONE passage worth a log line, H2_BURN_EV's job in its own units
const FIRE_EV_KG = 1.0;
// ONE pool field, so ONE fuel: a second FIRE row wants a fuel key per cell
const fireRow = () => FIRE[FIRE_KEYS[0]];
/* The pool is the substance the circuit was carrying, so weight and cp are that fluid's own columns and never a second copy here. */
let fireCoolRow = null;
const fireCool = () => fireCoolRow
  || (fireCoolRow = COOLANT.filter(a => a.burn === FIRE_KEYS[0])[0] || null);
const fireCp  = () => { const a = fireCool(); return a ? a.cp : 1; };
const fireRho = () => { const a = fireCool(); return a ? a.dens*RHO_K : 1000; };
/* THE ONE DOOR: it happens on the deck and inside a generator, and the two may not disagree about one reaction. Nothing here reads oxygen. */
const swReact = (row, kgNa) => ({q: kgNa*row.wlhv, h2: kgNa*row.wh2, h2o: kgNa*row.wh2o});
// ...and how much metal a given mass of water will take, the same row read back
const swNaFor = (row, kgH2O) => kgH2O/row.wh2o;
/* Bought: a liquid metal running out over steel stops at a few millimetres, and this is the only thing keeping a gram from burning over a whole cell. */
const POOL_DMIN = 0.01;                   // metres
/* A pool falls to the deck and spreads along it, which is what sets the surface a metal fire burns from; a cell holds ROOM_VCELL and no more, so a deep spill stacks. POOL_SPREAD is bought - anything above about 2/s is the same picture one tick later. */
const POOL_SPREAD = 5;                    // per second
let poolDM = null, poolDE = null;
function poolFlow(s, dt, G){
  const M = s.roomPool, E = s.roomPoolE, N = GW*GH;
  const cap = ROOM_VCELL*fireRho(), k = Math.min(1, POOL_SPREAD*dt);
  // nothing on the deck runs nowhere, and the sweeps below are whole-grid
  { let any = false; for(let i=0;i<N;i++) if(M[i] !== 0 || E[i] !== 0){ any = true; break; }
    if(!any) return; }
  if(!poolDM || poolDM.length !== N){ poolDM = new Float64Array(N); poolDE = new Float64Array(N); }
  poolDM.fill(0); poolDE.fill(0);
  /* A wall or a machine box is a floor. Only the TARGET is asked, so metal standing in a wrecked machine's own cells can still run out of them. */
  const shut = j => G.tight[j] || (G.occ[j] && !G.pan[j]);
  /* ...except a CATCH PAN: the one occupied cell the pool may enter, over any face, and its only way out is its own drain line (panDrain()). */
  const runs = (i, j) => !shut(j) && !(G.pan[i] && !G.pan[j]);
  // fluxes off the SAME field, so the answer does not depend on the sweep order
  const move = (i, j, want) => { const take = Math.min(want, M[i], cap - M[j]);
    if(!(take > 0)) return;
    const e = E[i]*take/M[i];
    poolDM[i] -= take; poolDE[i] -= e; poolDM[j] += take; poolDE[j] += e; };
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X, j = i+GW;                       // j is BELOW i on this grid
    if(M[i] > 0 && runs(i, j)) move(i, j, M[i]*k);
  }
  /* Sideways only while it is deeper than POOL_DMIN: levelling on the difference alone has no stopping point, and a gram spread over the bay is not a pool. */
  const dmin = cap*POOL_DMIN/ROOM_DEPTH;
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, j = i+1, d = (M[i] - M[j])/2;
    if(d > 0){ if(runs(i, j) && M[i] > dmin) move(i, j, Math.min(d, M[i]-dmin)*k); }
    else if(d < 0 && runs(j, i) && M[j] > dmin) move(j, i, Math.min(-d, M[j]-dmin)*k);
  }
  for(let i=0;i<N;i++){ M[i] += poolDM[i]; E[i] += poolDE[i];
    if(M[i] <= 0){ M[i] = 0; E[i] = 0; } }
}
/* The JET decides, not a switch: gas Weber number rho_air*v^2*d/sigma off the hole's own velocity and bore, so a small hole sprays and a wide tear dribbles. */
const SPRAY_WE0 = 13, SPRAY_WE1 = 40.3;
/* Liquid above the datum, pinned at the melting point while the latent heat comes out, solid below that. */
function poolT(m, E){
  if(!(m > 0)) return T_HULL;
  const f = fireRow(), cp = fireCp(), eF = -m*f.lf;
  if(E >= 0) return f.melt + E/(m*cp);
  return E > eF ? f.melt : f.melt + (E - eF)/(m*cp);
}
const roomPoolT = (s,i) => poolT(s.roomPool[i], s.roomPoolE[i]);
// the same three tests the burn takes, so a cell cannot draw cold and burn
const roomPoolLit = (s,i) => { const f = fireRow();
  return s.roomPool[i] > 0 && (i < GW || !(s.roomPool[i-GW] > 0))
      && roomPoolT(s,i) >= f.ign && roomO2Frac(s,i) >= f.loc; };
// what the metal put into the air THIS tick, kJ per cell - read by the one q
let fireQ = null;
// which region's sump is standing in each cell this tick, -1 for a dry one
let fireWet = null;
/* The bund is in poolFlow(); this is the drain, into a sealed tank the board does not draw. The metal was booked out at the opening it left through, so nothing here moves a book. A wrecked pan is still a bund and drains nothing. */
const PAN_DRAIN_KGS = 20;                 // kg/s one pan's drain line passes
function panDrain(s, dt, G){
  const M = s.roomPool, E = s.roomPoolE;
  for(const q of G.parts){
    if(q.p.role !== "pan" || partWrecked(s, q.p.id)) continue;
    let want = PAN_DRAIN_KGS*dt;
    for(const i of q.cells){
      if(!(want > 0)) break;
      const take = Math.min(want, M[i]);
      if(!(take > 0)) continue;
      E[i] -= E[i]*take/M[i];
      M[i] -= take; want -= take;
      s.panBy[q.p.id] = (s.panBy[q.p.id] || 0) + take;
      if(M[i] <= 0){ M[i] = 0; E[i] = 0; }
    }
  }
}

function roomFireStep(s, dt, G, src){
  const N = GW*GH, f = fireRow(), cp = fireCp();
  const M = s.roomPool, E = s.roomPoolE, O = s.roomO2, T = s.roomT;
  if(!fireQ || fireQ.length !== N) fireQ = new Float64Array(N);
  fireQ.fill(0);
  s.roomFireOn = 0;
  if(!fireCool()) return;
  // roomPGauge() is a whole-grid pass, so it is asked once and only if metal is arriving
  let gz = null, on = 0;
  roomLiqOuts(s, G, (cells, rate, fl, key) => {
    const row = fl.c.burn && FIRE[fl.c.burn];
    if(!row || !cells.length) return;
    /* The kilograms the TRANSPORT booked, never the solve's rate: this mass sits on the deck and must be the same mass that left the loop. */
    const kg = advectOutKg[key] || 0;
    if(!(kg > 0)) return;
    if(!gz) gz = roomPGauge(s);
    const pN = netPAt(s, fl.nd)*1e6, pR = (ROOM_P0 + gz[cells[0]])*1000;
    const v = Math.sqrt(2*Math.max(0, pN - pR)/fireRho());
    const d = openBoreM(key);
    const we = ROOM_RHO*v*v*d/row.sigma;
    const frac = d > 0 ? clamp((we - SPRAY_WE0)/(SPRAY_WE1 - SPRAY_WE0), 0, 1) : 0;
    /* The ignition test on the metal itself, at the temperature it is leaving at - the same test the pool takes. */
    const Tin = tOfH(fl.c, netPAt(s, fl.nd), fl.h);
    const want = Tin >= row.ign ? kg*frac*row.eta : 0;
    let burnt = 0;
    if(want > 0) roomShare(cells, kg/dt, (i, sh) => {
      const m = Math.min(want*sh, O[i]/row.o2);
      if(!(m > 0)) return;
      O[i] -= m*row.o2;
      // its combustion AND the heat it was carrying: this mass never reaches the deck
      fireQ[i] += m*(row.lhv + cp*(Tin - row.melt));
      burnt += m; on++;
    });
    s.fireEv.kg += burnt; s.fireEv.q += burnt*row.lhv;
    // what did not burn in flight is on the deck, over the opening's own cells and not a plume: a liquid falls
    const per = (kg - burnt)/cells.length;
    if(per > 0) for(const i of cells){ M[i] += per; E[i] += per*cp*(Tin - row.melt); }
  });
  poolFlow(s, dt, G);
  panDrain(s, dt, G);
  /* The sump is a book per REGION and the pool a field per CELL, so they meet only through the flood line; the region, so reacted kilograms come off the right book. */
  if(!fireWet || fireWet.length !== N) fireWet = new Int32Array(N);
  fireWet.fill(-1);
  for(const g of matRegionsBounded()){
    const q = regionFlooded(s, g); if(!q) continue;
    const line = q.bot + 1 - q.rows, k = regionKey(g);
    for(const i of g.cells) if(((i/GW)|0) >= line) fireWet[i] = k;
  }
  const A0 = MPC*MPC;
  for(let i=0;i<N;i++){
    let m = M[i];
    if(!(m > 0)) continue;
    /* Metal standing on more metal floats and covers the whole cell, so the column is what the area asks; one cell down saturates it. */
    const A = Math.min(A0, (m + (i+GW < N ? M[i+GW] : 0))/(fireRho()*POOL_DMIN));
    let Tp = poolT(m, E[i]);
    const fo2 = roomO2Frac(s, i);
    // only the FREE surface burns: a stack is one fire, not three
    const open = i < GW || !(M[i-GW] > 0);
    /* Water needs neither air nor a spark, so this is ungated on oxygen, ignition and temperature. Standing sump water first, then whatever steam a break put in the air; the rate is the smaller of what the surface passes and what water is there. */
    if(open && f.wlhv){
      const kS = fireWet[i], sump = kS >= 0 ? (s.sump[kS] || 0) : 0;
      const vap = Math.max(0, s.roomM[i] - ROOM_MAIR);
      const mw = Math.min(f.wrate*A*dt, m, swNaFor(f, sump + vap));
      if(mw > 0){
        const r = swReact(f, mw);
        let need = r.h2o;
        if(sump > 0){ const take = Math.min(need, sump);
          /* sumpStep() booked these kilograms back onto the ship; reacted, they are gone, and the book closes on the line it was credited on. */
          s.sump[kS] =sump - take; book(s, "sump", take); need -= take; }
        if(need > 0) s.roomM[i] -= Math.min(need, vap);
        M[i] = m = m - mw;
        E[i] += r.q - mw*cp*(Tp - f.melt);
        s.roomH2[i] += r.h2;
        s.fireEv.kg += mw; s.fireEv.q += r.q;
        on++;
        // so the air test below sees the heat this released rather than seeing it next tick
        Tp = poolT(m, E[i]);
      }
    }
    if(open && Tp >= f.ign && fo2 >= f.loc){
      /* Diffusion-limited, so the published rate is the rate IN AIR and falls with the oxygen over it: a sealed bay smothers a metal fire. */
      const mb = Math.min(f.rate*(fo2/O2_FRAC0)*A*dt, m, O[i]/f.o2);
      if(mb > 0){
        M[i] = m = m - mb;
        O[i] -= mb*f.o2;
        // released at the surface into the pool; the metal that burnt takes its own sensible heat with it
        E[i] += mb*f.lhv - mb*cp*(Tp - f.melt);
        s.fireEv.kg += mb; s.fireEv.q += mb*f.lhv;
        on++;
      }
    }
    if(!(m > 0)){ M[i] = 0; E[i] = 0; continue; }
    Tp = poolT(m, E[i]);
    let q = (f.hConv*(Tp - T[i])
             + f.emis*SIGMA*(Math.pow(Tp,4) - Math.pow(T[i],4))/1000)*A;     // kW
    /* advectSrc()'s rule: a film over a full cell has almost no capacity behind it, so an uncapped explicit source drives it below the room and the fourth power to NaN. */
    const qCap = m*cp*(Tp - T[i])/dt;
    q = q > 0 ? Math.min(q, Math.max(0, qCap)) : Math.max(q, Math.min(0, qCap));
    E[i] -= q*dt; src[i] += q;
    /* Past its boiling point the metal would burn as vapour, a phase this does not carry, so the energy goes straight into the air rather than being dropped. */
    const eMax = m*cp*(f.boil - f.melt);
    if(E[i] > eMax){ src[i] += (E[i] - eMax)/dt; E[i] = eMax; }
  }
  s.roomFireOn = on;
}

function roomH2Step(s, dt, G){
  const N = GW*GH, H = s.roomH2, O = s.roomO2, Fl = s.roomFlame, Pr = s.roomP;
  const T = s.roomT, Pk = s.roomPPk;
  /* Off the real kilograms (roomPOf()), so a discharge raises it and a hole lowers it; the BLAST below rides on top of this. */
  const pGauge = roomPGauge(s);
  s.roomBurnOn = 0;
  /* Hydrogen is a species the transport carries (s.h2By, advectH2Out by edge key), so the field has already lost it and nothing here debits s.h2. */
  if(s.h2 > 0){
    const H2OUT = advectH2Out;
    const put = (cells, rate, key) => {
      const m = H2OUT[key];
      if(!(m > 0) || !cells.length) return;
      // the same plume the heat went into, off the same opening at the same rate
      roomSpread(H, cells, Math.max(0, rate)/100*loopKg(), m);
    };
    roomLiqOuts(s, G, (cells, rate, fl, key) => put(cells, rate, key));
  }
  /* The set moves air against the rest of the ship, so it carries gas both ways; with the hull sealed this is the only removal path that is not a fire. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || partWrecked(s, q.p.id)) continue;
    const f = Math.min(1, ROOM_VENT_KGS/q.cells.length/ROOM_MAIR*dt);
    // ...and the AIR with them, so a set running in a pressurised compartment brings it back down
    for(const i of q.cells){ H[i] -= H[i]*f; O[i] += (ROOM_O2_0 - O[i])*f;
      s.roomM[i] += (ROOM_MAIR - s.roomM[i])*f; }
  }
  /* The vent set's expression with the target reversed: nitrogen in, oxygen and hydrogen to zero, mass unmoved. NO POWER, so a blackout does not take it away - and it does not stop sodium meeting water. */
  for(const q of G.parts){
    if(q.p.role !== "inert" || partWrecked(s, q.p.id)) continue;
    const f = Math.min(1, INERT_KGS/q.cells.length/ROOM_MAIR*dt);
    for(const i of q.cells){ H[i] -= H[i]*f; O[i] -= O[i]*f; }
  }
  /* One stencil, two biases: hydrogen carries H2_UP and collects at the deckhead, oxygen carries none. */
  roomDiffuse(H, G, dt, H2_UP);
  roomDiffuse(O, G, dt, 1);

  /* s.roomFlame is how far the front has crossed each cell, 0..1, on S: it advances at its own mixture's burning velocity times the clutter around it, and nothing latches. */
  for(let i=0;i<N;i++)
    if(Fl[i] <= 0 && H[i] > 0 && roomFlam(s,i) && roomIgnites(s,G,i)) Fl[i] = 1e-6;
  let burned = 0, on = 0, pmax = 0;
  for(let i=0;i<N;i++){
    let q = 0;
    if(Fl[i] > 0){
      if(!roomFlamFront(s,i)) Fl[i] = 0;
      else {
        const adv = Math.min(1, h2Sl(roomFrontFrac(s,i))*G.turb[i]*dt/MPC);
        /* The advance consumes the DEFICIENT reactant, or a rich cell releases more per tick than a stoichiometric one; the peak lands at 29.6 vol% with nothing naming it. */
        const m = Math.min(H[i], O[i]/O2_PER_H2)*adv;
        if(m > 0){
          H[i] -= m; O[i] -= m*O2_PER_H2;
          burned += m; q = m*H2_LHV;
        }
        const nf = Math.min(1, Fl[i] + adv);
        if(nf >= 1 && Fl[i] < 1){
          const X = i%GW, Y = (i/GW)|0;
          const nb = [];
          if(X>0) nb.push(i-1); if(X<GW-1) nb.push(i+1);
          if(Y>0) nb.push(i-GW); if(Y<GH-1) nb.push(i+GW);
          for(const j of nb) if(Fl[j] <= 0 && roomFlam(s,j)) Fl[j] = 1e-6;
        }
        Fl[i] = nf;
        on++;
      }
    }
    /* The metal fire's fast half joins the deflagration here and nowhere else, and both heat the cell's own air at cv (ROOM_CVAIR); the pool's slow half is an ordinary source in src[]. */
    if(fireQ && fireQ[i] > 0) q += fireQ[i];
    if(q > 0) T[i] = Math.min(ROOM_TMAX, T[i] + q/ROOM_CVAIR);
    /* Constant-volume gas law off the SAME q, against a compartment that leaks. The denominator is AMBIENT: P0/T_HULL is rho*R, so this is identically (gamma-1)*q/V and has no temperature in it. Only the EXCESS over the volume's own static pressure is a transient, so only that relaxes. */
    const gz = pGauge[i];
    const p = Pr[i] + (q > 0 ? ROOM_P0*(q/ROOM_CVAIR)/T_HULL : 0)
              - Math.max(0, Pr[i]-gz)/ROOM_P_TAU*dt;
    Pr[i] = Math.max(gz, p > 0 ? p : 0);
    if(Pr[i]-gz > pmax) pmax = Pr[i]-gz;      // the bang is the excess over what the volume holds on its own
    /* Monotonic and on S, because "this compartment has been blown up" is a fact about the run: it saves, it loads, and a replay lands on the same battlefield. */
    if(Pr[i] > Pk[i]) Pk[i] = Pr[i];
  }
  s.roomBurnOn = on; s.roomPMax = pmax;
  if(s.roomFireOn && pmax > s.fireEv.p) s.fireEv.p = pmax;
  /* One event per explosion: a front at 0.05 m/s never trips a per-tick gate, so step.js writes the line when the last flame goes out. */
  if(burned > 0 || on){ s.burnEv.kg += burned;
    if(pmax > s.burnEv.p) s.burnEv.p = pmax; }
}

/* The heat pass walks this inline because it also carries the sources; here the BIAS is an argument, so hydrogen and oxygen share one walk. Conserving and CLOSED: the skin is sealed metal. */
function roomDiffuse(F, G, dt, up){
  const N = roomScratch(), d = roomD2;
  /* Both fluxes are exactly zero on a uniform field, and an intact ship's oxygen is flat every tick; the DRIFT also needs it empty, the symmetric pass only flat. */
  { const f0 = F[0]; let flat = true;
    for(let i=1;i<N;i++) if(F[i] !== f0){ flat = false; break; }
    if(flat && (up === 1 || f0 === 0)) return; }
  d.fill(0);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*(F[i]-F[i+1])/ROOM_C;
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    /* A DRIFT, not a faster diffusion: priced off the amount in each cell, the flux vanishes at F[i] = up*F[j] - an exponential profile with a scale height. up = 1 is the plain symmetric pass. j is BELOW i on this grid. */
    const i = Y*GW+X, j = i+GW;
    const q = G.gDn[i]*(up*F[j] - F[i])/ROOM_C;
    d[i] += q; d[j] -= q;
  }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
  /* No hull term: the stencil is edge-based and conserving, so no-flux is already the default, and the sealed skin is what is wanted. */
}

/* Each connected gas volume (matRegions()) is LUMPED - one mass, one mean temperature, one pressure - because pressure equalises inside one far faster than a tick; between volumes there is nothing but the orifice matHoles() found. */
let ROOM_VOL_SCR = null;
const roomVolScr = n => { let z = ROOM_VOL_SCR;
  if(!z || z.M.length !== n) z = ROOM_VOL_SCR = {M:new Float64Array(n), V:new Float64Array(n), MT:new Float64Array(n), T:new Float64Array(n), P:new Float64Array(n), RHO:new Float64Array(n)};
  z.M.fill(0); z.V.fill(0); z.MT.fill(0); return z; };
function roomVols(s){
  const R = matRegions(), n = R.regions.length;
  const Z = roomVolScr(n), M = Z.M, V = Z.V, MT = Z.MT;
  for(let i=0;i<GW*GH;i++){ const r = R.of[i]; if(r<0) continue;
    const m = s.roomM[i];
    M[r] += m; V[r] += ROOM_VCELL; MT[r] += m*s.roomT[i]; }
  const T = Z.T, P = Z.P, RHO = Z.RHO;
  for(let r=0;r<n;r++){
    T[r] = M[r] > 0 ? MT[r]/M[r] : T_HULL;
    RHO[r] = V[r] > 0 ? M[r]/V[r] : ROOM_RHO;
    P[r] = roomPOf(M[r], V[r], T[r]);
  }
  return {R, n, M, V, T, P, RHO};
}
// kPa above ambient per cell, one array so the burn term and the damage sweeps read the same figure
let pGaugeScr = null;
function roomPGauge(s){
  const q = roomVols(s), N = GW*GH;
  const g = (pGaugeScr && pGaugeScr.length === N) ? pGaugeScr.fill(0) : (pGaugeScr = new Float64Array(N));
  for(let i=0;i<N;i++){ const r = q.R.of[i]; if(r<0) continue;
    g[i] = Math.max(0, (q.P[r] - ROOM_P0/1000)*1000); }
  return g;
}
/* Dry air plus vapour: the vapour cannot exceed its saturation partial pressure at the air's temperature, and what will not stay a gas lands on the floor. Instant, because any lag would be a fitted number standing in for an undrawn surface. */
const R_VAP = 0.0004615;                  // MPa*m3/(kg*K)
function roomCondense(s, dt){
  const q = roomVols(s);
  for(let r=0;r<q.n;r++){
    const g = q.R.regions[r], n = g.cells.length;
    const air = ROOM_MAIR*n;
    const vap = q.M[r] - air;
    if(!(vap > 0)) continue;
    // what the air at this temperature will hold as vapour, and no more
    const cap = satP(SAT_WATER, q.T[r])*q.V[r]/(R_VAP*Math.max(q.T[r],1));
    const drop = vap - cap;
    if(!(drop > 0)) continue;
    /* No book: s.roomM is the compartment's GAS and is in none, and these kilograms were already booked out at the opening they left through. */
    const f = drop/q.M[r];
    for(const i of g.cells) s.roomM[i] -= s.roomM[i]*f;
  }
}

/* Every hole is priced by the SAME relation a pipe break is, and what crosses carries the donor's hydrogen, oxygen and enthalpy into the cell on the far side. Mass is lumped over the volume afterwards; temperature is NOT levelled, because that is the diffusion pass's job. */
function roomHoleStep(s, dt){
  const holes = matHoles(s);
  for(const k in s.holeQ) s.holeQ[k].q = 0;      // refilled, never rebuilt
  if(!holes.length){ for(const k in s.holeQ) delete s.holeQ[k]; return; }
  const q = roomVols(s);
  /* The overshoot guard below is a statement about the PAIR, so with n holes open each may take only 1/n of it; the orifice term is untouched, so area still scales. */
  const share = {};
  for(const h of holes){ const k = Math.min(h.a,h.b)+":"+Math.max(h.a,h.b);
    share[k] = (share[k]||0)+1; }
  for(const h of holes){
    const up = q.P[h.a] >= q.P[h.b] ? h.a : h.b, dn = up === h.a ? h.b : h.a;
    if(!(q.M[up] > 0)) continue;
    const w = roomHoleKgs(h.area, q.P[up], q.P[dn], q.RHO[up]);
    /* It may not overshoot the balance: past half the difference in one tick the two volumes ring instead of settling. IN PRESSURE, never in density - a hot region at equal pressure is lighter than the cold ship. */
    const kUp = q.T[up]/q.V[up], kDn = q.T[dn]/q.V[dn];
    const even = Math.max(0, (q.P[up]-q.P[dn])/(R_AIR*(kUp+kDn)));
    const nSh = share[Math.min(h.a,h.b)+":"+Math.max(h.a,h.b)] || 1;
    const dm = Math.min(w*dt, q.M[up]*0.5, even*0.5/nSh);
    if(!(dm > 0)) continue;
    const f = dm/q.M[up];
    // what leaves the donor volume, taken from every cell of it in proportion
    const cUp = q.R.regions[up].cells, cDn = q.R.regions[dn].cells;
    let h2=0, o2=0, en=0;
    for(const i of cUp){ const take = s.roomM[i]*f;
      s.roomM[i] -= take;
      const fh = s.roomH2[i]*f, fo = s.roomO2[i]*f;
      s.roomH2[i] -= fh; s.roomO2[i] -= fo;
      h2 += fh; o2 += fo; en += take*ROOM_CP*s.roomT[i]; }
    // ...and it arrives AT THE HOLE, in the cell on the far side of it
    let land = -1;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const X=h.x+dx, Y=h.y+dy;
      if(X<0||X>=GW||Y<0||Y>=GH) continue;
      if(q.R.of[Y*GW+X] === dn){ land = Y*GW+X; break; }
    }
    if(land < 0) land = cDn[0];
    const was = s.roomM[land], now = was + dm;
    s.roomT[land] = clamp((was*ROOM_CP*s.roomT[land] + en)/Math.max(now*ROOM_CP, 1e-9),
                          T_SPACE, ROOM_TMAX);
    s.roomM[land] = now;
    s.roomH2[land] += h2; s.roomO2[land] += o2;
    /* kg/s and which way, so the renderer draws the jet off the flow rather than a proxy. Refilled, never rebuilt. */
    s.holeQ[h.x+","+h.y] = {q: dm/dt, to: land};
  }
  // a cell that is no longer a hole stops drawing one
  for(const k in s.holeQ) if(!holes.some(h=>h.x+","+h.y===k)) delete s.holeQ[k];
  /* Redone off a fresh sum: the loop above moved mass between volumes, so the totals it started with are stale by exactly what crossed. */
  { const R = q.R;
    const M = new Float64Array(q.n), N = new Float64Array(q.n);
    for(let i=0;i<GW*GH;i++){ const r=R.of[i]; if(r<0) continue; M[r]+=s.roomM[i]; N[r]++; }
    for(let i=0;i<GW*GH;i++){ const r=R.of[i]; if(r<0) continue; s.roomM[i]=M[r]/N[r]; } }
}
/* A bounded region is sealed and holds what it is given; the ship at large is not, so it bleeds MASS back toward what the compartment holds at rest, at the cell's OWN temperature. Air, not plant inventory, so no book. */
function roomShipLeak(s, dt){
  const R = matRegions();
  for(const g of R.regions){
    if(g.bounded) continue;
    const f = Math.min(1, dt/ROOM_P_TAU);
    for(const i of g.cells){
      const m0 = ROOM_P0/1000*ROOM_VCELL/(R_AIR*Math.max(s.roomT[i], 1));
      s.roomM[i] += (m0 - s.roomM[i])*f;
    }
  }
}

/* The worst cell a machine stands in; the damage criterion and the PART TEMP layer both read it, so picture and failure cannot disagree. */
function roomAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomT[Y*GW+X]);
  return v || T_HULL;
}
// the worst blast it has EVER seen there, which is what the scar draws off; a peak, not an integral
function roomScarAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomPPk[Y*GW+X]);
  return v;
}
function roomPAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomP[Y*GW+X]);
  return v;
}
// the same cells, the BANG only: what the burn put on top of the volume's own static pressure (roomPGauge)
function roomBlastAt(s, p, g){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH){ const i = Y*GW+X; v = Math.max(v, s.roomP[i]-g[i]); }
  return v;
}
// volume fraction, the same expression the ignition test uses so a cell cannot draw as safe and burn
const roomH2Frac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(ROOM_MOL + n) : 0; };
// off the SAME denominator, so a rich cell is oxygen-poor by arithmetic rather than a second rule
const roomO2Frac = (s,i) => s.roomO2[i]/O2_MMOL/(ROOM_MOL + s.roomH2[i]/H2_MMOL);
// off the same partSkin()/partTsurv() the damage integral reads, so the alarm and the failure name one set
const roomOverIds = s => LAY.parts.filter(p => { const l = partTsurv(p);
  return l && fitted(p) && partSkin(s,p) > l; }).map(p => p.id);
const roomH2Peak = s => { let v = 0;
  for(let i=0;i<s.roomH2.length;i++){ const f = roomH2Frac(s,i); if(f > v) v = f; }
  return v; };
