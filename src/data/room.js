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

/* Bought balance standing in for the structure and the condensation on it. SOURCE side only: g0 is priced off ROOM_C, so the stencil divides it straight back out and the stability limit does not move; never applied to ROOM_MAIR, which is real air. */
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
/* The one split, because two books share these kilograms: what flashes is roomAddGas()'s and the rest is sumpStep()'s, and both ask here or the same water is counted as air and as floor. */
function openFlashX(s, fl, i){
  if(!fl || !fl.c) return 1;
  const p = (ROOM_P0 + (s.roomP && i >= 0 ? Math.max(0, s.roomP[i]) : 0))/1000;
  const c = fl.c, hfg = hfgOf(c, satT(c, p));
  return hfg > 0 ? clamp((fl.h - satH(c, p))/hfg, 0, 1) : 1;
}
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
  /* A wall is always a wall here, so damage is NOT in this key: roomGeomLive() opens a shot cell. */
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
  /* The face mask itself, symmetric: the diffusion prices it with g0 and lays ROOM_UP on top, the wave takes it bare, so both reflect off exactly what matWall() calls a wall. */
  const bx = new Float64Array(N), by = new Float64Array(N);
  const gx = new Float64Array(N), gUp = new Float64Array(N), gDn = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(X<GW-1){ bx[i] = blk(i)*blk(i+1); gx[i] = g0*bx[i]; }
    if(Y<GH-1){ by[i] = blk(i)*blk(i+GW); const b = g0*by[i];
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
  roomCache = {occ, tight, face, own, pan, turb, parts, runs, shellValves, bx, by, gx, gUp, gDn, hole:null, comp:null};
  roomCacheSig = sig;
  return roomCache;
}
/* Which cells the air joins without crossing a wall, off the face mask itself; a machine passes ROOM_BLOCK, so it joins. */
function roomComp(G){
  if(G.comp) return G.comp;
  const N = GW*GH, c = new Int32Array(N).fill(-1), st = [];
  let n = 0;
  for(let i0=0;i0<N;i0++){
    if(c[i0] >= 0) continue;
    c[i0] = n; st.push(i0);
    while(st.length){
      const i = st.pop(), X = i%GW;
      if(X<GW-1 && G.bx[i] && c[i+1] < 0){ c[i+1] = n; st.push(i+1); }
      if(X>0 && G.bx[i-1] && c[i-1] < 0){ c[i-1] = n; st.push(i-1); }
      if(i+GW<N && G.by[i] && c[i+GW] < 0){ c[i+GW] = n; st.push(i+GW); }
      if(i>=GW && G.by[i-GW] && c[i-GW] < 0){ c[i-GW] = n; st.push(i-GW); }
    }
    n++;
  }
  return G.comp = c;
}

/* A shot wall cell is an ordinary open cell: gas, heat, species and liquid all cross it. The design object itself where nothing is wrecked, and only the sim takes this. */
let roomLiveCache = null, roomLiveSig = "";
function roomGeomLive(s){
  const G = roomGeom();
  let open = "";
  if(s && s.dmgParts) for(const id of s.dmgParts){
    if(typeof id !== "string" || id.indexOf("mat:") !== 0) continue;
    const j = id.indexOf(","), x = +id.slice(4,j), y = +id.slice(j+1);
    if(x>=0 && x<GW && y>=0 && y<GH && matWall(x,y)) open += "|"+x+","+y;
  }
  if(!open) return G;
  const sig = roomCacheSig+open;
  if(roomLiveCache && roomLiveSig === sig) return roomLiveCache;
  const N = GW*GH, hole = new Uint8Array(N);
  for(const k of open.split("|")){ if(!k) continue;
    const j = k.indexOf(","); hole[(+k.slice(j+1))*GW + (+k.slice(0,j))] = 1; }
  const blk = i => hole[i] ? 1 : G.tight[i] ? 0 : (G.occ[i] ? ROOM_BLOCK : 1);
  const g0 = ROOM_MIX*ROOM_C/(MPC*MPC);
  const bx = new Float64Array(N), by = new Float64Array(N);
  const gx = new Float64Array(N), gUp = new Float64Array(N), gDn = new Float64Array(N);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW+X;
    if(X<GW-1){ bx[i] = blk(i)*blk(i+1); gx[i] = g0*bx[i]; }
    if(Y<GH-1){ by[i] = blk(i)*blk(i+GW); const b = g0*by[i];
      gUp[i] = b*ROOM_UP; gDn[i] = b; }
  }
  roomLiveCache = Object.assign({}, G, {bx, by, gx, gUp, gDn, hole, comp:null});
  roomLiveSig = sig;
  return roomLiveCache;
}

/* Scratch, never read across a call: NOT state, every element is written before it is read. */
let roomSrc = null, roomD = null, roomD2 = null, roomY = null;
const roomScratch = () => { const N = GW*GH;
  // re-cut on N, not on first call: the hull is draggable
  if(!roomSrc || roomSrc.length !== N){
    roomSrc = new Float64Array(N); roomD = new Float64Array(N); roomD2 = new Float64Array(N); roomY = new Float64Array(N); }
  return N; };

/* A discharging jet ENTRAINS: ROOM_ENTRAIN*ROOM_JET_TAU over the air in one cell IS the size of the plume, and the temperature it delivers, h/(ROOM_ENTRAIN*ROOM_CP), is the same for a weep and a rupture - only the volume differs. */
const ROOM_ENTRAIN = 25;                  // kg of room air per kg of discharge
const ROOM_JET_TAU = 1.0;                 // s to entrain it
const ROOM_MAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO;   // kg of air in one cell

/* s.roomM is kg of gas per cell; pressure follows from it, the cell's own temperature and the room the liquids leave it, by the ideal gas law, so a discharge really raises it and a hole really lowers it. */
const R_AIR = 0.000287;                   // MPa*m3/(kg*K)
const ROOM_VCELL = MPC*MPC*ROOM_DEPTH;    // m3 of one cell
const ROOM_P0 = 101.3;                    // kPa, ambient
// absolute MPa, off a mass and a temperature - the ONE pressure read
const roomPOf = (kg, vol, T) => kg*R_AIR*T/Math.max(vol, 1e-6);

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
// hydrogen is gas, so it is part of s.roomM: the transport carries every species as a share of it
function roomAddH2(s, cells, kgps, kg){
  if(!(kg > 0)) return;
  roomShare(cells, kgps, (i,f) => { s.roomH2[i] += kg*f; s.roomM[i] += kg*f; });
}
/* The door anything venting STEAM into a compartment calls: the same plume and cells, as a MASS on the same weights times the gas room each cell has, so the rise is highest at the opening and a cell the liquids fill takes none; the pressure is the read. */
let addGasI = [], addGasW = [];
function roomAddGas(s, cells, kg, kgps){
  if(!(kg > 0)) return;
  addGasI.length = 0; addGasW.length = 0;
  let w = 0;
  roomShare(cells, kgps, (i,f) => { const v = f*roomVgas(s, i); addGasI.push(i); addGasW.push(v); w += v; });
  if(!(w > 0)) return;
  for(let k=0;k<addGasI.length;k++){ const i = addGasI[k], dm = kg*addGasW[k]/w;
    s.roomM[i] += dm; s.roomVap[i] += dm; }
}
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
  // re-cut on N like roomScratch(): a hull that grew leaves a short queue that silently drops pushes
  if(!roomSeen || roomSeen.length !== N){
    roomSeen = new Int32Array(N); roomQ = new Int32Array(N);
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

/* The INJECT tool's room half: heat rides the same src[] a fire does, so the cell's own ballast
   prices it; hydrogen, oxygen and steam go in as mass, and `gas` is the cell's whole inventory out.
   Fluid aimed at a node is injectFluid()'s (step.js), because plant inventory is a book and compartment
   air is not; aimed at bare deck it is water on this cell's floor, which is on the ledger (sumpKg()), so it books against `inject` the same way. */
function injectRoom(s, dt, src, G){
  const q = s.inject, i = q && q.target;
  if(!q || !q.rate || typeof i !== "number" || i < 0 || i >= GW*GH) return;
  if(q.kind === "heat"){ src[i] += q.rate; return; }
  if(q.kind === "gas"){
    if(!(q.rate < 0)) return;
    const f = Math.min(1, -q.rate*dt/Math.max(s.roomM[i], 1e-9));
    for(const F of roomGasFields(s)) F[i] -= F[i]*f;
    return; }
  if(q.kind === "fluid"){
    const W = s.roomWater, dm = q.rate > 0 ? q.rate*dt : -Math.min(-q.rate*dt, W[i]);
    if(!dm) return;

    // the tool states a rate and nothing else: the speed is the one a cell face needs to carry it
    if(dm > 0){ liqLand(s, G, liqWater(s), i, dm, dm*hOfT(SAT_WATER, T_HULL), q.rate/(WATER_RHO*MPC*ROOM_DEPTH)); book(s, "inject", -dm); return; }
    s.roomWaterE[i] += s.roomWaterE[i]*dm/W[i]; gsScratch(); gsDisp[i] += dm/WATER_RHO;
    W[i] += dm;
    book(s, "inject", -dm);
    return; }
  if(!(q.rate > 0)) return;
  const dm = q.rate*dt;
  if(q.kind === "h2") s.roomH2[i] += dm;
  else if(q.kind === "o2") s.roomO2[i] += dm;
  else if(q.kind === "steam") s.roomVap[i] += dm;
  else return;
  s.roomM[i] += dm;
}

/* Sources, transport, sink, in that order; nothing here writes anything but s.roomT, s.roomH2 and the readouts off them. */
function roomStep(s, dt){
  const G = roomGeomLive(s), T = s.roomT, N = roomScratch();
  const src = roomSrc, d = roomD;
  src.fill(0);
  /* First, off last tick's field: this tick's sources reach the pressure one tick later. */
  const pmax = roomGasStep(s, dt, G, src);

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
    const nd = shellNode(id), ms = (s.mBy[nd]||0)*clamp(netQualAt(s,nd),0,1);
    const f = Math.min(1, rate*dt/Math.max(ms, 1e-6));
    s.sgH2By[id] = m - m*f;
    roomAddH2(s, cellsOf(id), rate, m*f);
  }
  /* What the opening is actually passing, in the state it passes it: the kilograms the transport booked on that edge this tick. */
  roomLiqOuts(s, G, (cells, rate, fl, key) => {
    /* A fluid that burns lands as a pool and gives its heat up through its own surface (roomFireStep), so charging the air here would spend the same joules twice. */
    if(fl.c.burn) return;
    /* Only what FLASHES is a gas in here; the rest is on the floor and is sumpStep()'s kilogram, not this book's. */
    const kg = (advectOutKg[key] || 0)/dt*openFlashX(s, fl, cells.length ? cells[0] : -1);
    roomJetLiq(src, T, cells, kg, fl.h, fl.c);
    roomAddGas(s, cells, kg*dt, kg);
  });
  injectRoom(s, dt, src, G);
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

  roomH2Step(s, dt, G, pmax);
  roomCondense(s);

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
/* A torn machine drains from the bottom of its box as one stream: shared over every cell of the box, it rained a thread down each column it spans. */
function roomPourCells(key, cells){
  if(key.indexOf("break:") !== 0 || !(breakPart(key) || breakCav(key)) || !cells.length) return cells;
  let lo = -1;
  for(const i of cells) lo = Math.max(lo, (i/GW)|0);
  const row = cells.filter(i => ((i/GW)|0) === lo).sort((a,b) => a-b);
  return [row[row.length>>1]];
}

/* Hydrogen leaves with the escaping steam and deflagrates past the flammability limits and auto-ignition; ROOM_DEPTH sets every concentration here. */
const H2_LFL = 0.04;                      // volume fraction in air
/* A cell of nearly pure hydrogen is the SAFE one: there is no air left in it to burn. */
const H2_UFL = 0.75;
const H2_IGN = 773;                       // K
const H2_LHV = 120000;                    // kJ/kg
const H2_MMOL = 0.002016, AIR_MMOL = 0.02896, H2O_MMOL = 0.018015;   // kg/mol
// kg in ONE tick's deflagration worth a log line; see the caller in step.js
const H2_BURN_EV = 1.0;
// kg of air one cell holds at ambient, which is what the ship was built at
const ROOM_M0 = ROOM_P0/1000*ROOM_VCELL/(R_AIR*T_HULL);

/* kg per cell on S, s.roomH2's shape. Combustion is capped at 2 H2 : 1 O2, so a rich cell burns weakly and a sealed corner smothers its own fire; diffuses on the same stencil with NO buoyancy bias. */
const O2_FRAC0 = 0.2095;                  // volume fraction of dry air
const O2_MMOL = 0.032;                    // kg/mol
const O2_LOC = 0.05;                      // limiting oxygen concentration for H2 in air
// kg of O2 one cell holds at ambient, and what the ventilation set puts back
const ROOM_O2_0 = O2_FRAC0*ROOM_M0/AIR_MMOL*O2_MMOL;
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
/* Constant-volume combustion off the SAME q the heat term uses. There is no detonation switch: the axis is burning velocity against how fast the gas transport relieves the cell, and H2_TURB is the one to hold still while measuring anything else. */

/* The gas is ONE field on the grid: mass per cell (s.roomM), momentum on the faces (s.roomPU +x,
   s.roomPV +y, kg/m2/s - a mass flux, so a cell that empties or fills does not rescale it), and the
   pressure a read off each cell's own mass, temperature and gas volume.
   Linearised Euler taken implicitly, one solve a tick (tools/wavemock.html's A, theta 1), written in
   the kilograms a face passes so the mass the solve predicts is the mass that moves. The heat pass
   owns temperature and a cell's air sits in ROOM_CGAME times its own capacity, so the gas is
   ISOTHERMAL: its compliance is V/(R*T) and its sound speed sqrt(R*T), not sqrt(GAMMA*R*T). */
const R_SI = 287;                         // J/kg/K
// kPa across an open face below which the field is at rest, and m/s at ambient density below which a face is not moving
const WAVE_P_LO = 0.05, WAVE_U_LO = 0.01;
// relative residual: at 1e-4 what the solve left drew as a speckle of 0.5 kPa steps over a room being slowly compressed; 1e-7 is the loosest that draws nothing
const CG_TOL = 1e-7, CG_MAX = 200;
// kPa of bang a face must take to mark, and what reads as a full mark over it (tools/wavemock.html)
const HIT_LO = 5, HIT_FULL = 50;
// cells a part leans per 10 kPa on one 3-cell face of a 6x3 box, and the most a drawn lean may reach
const LEAN_K = 0.3, LEAN_MAX = 1;
// soft, so a small lean is still the linear one and a big one sits just under `max`
const leanCap = (v, max) => { const m = Math.hypot(v.x, v.y);
  if(!(m > 0)) return v; const k = max*Math.tanh(m/max)/m; return {x:v.x*k, y:v.y*k}; };
// iterations the last gas solve took, 0 when the gate stood it down - a readout for the tools, never state
let roomCgIt = 0;
/* Bumped every read: s.roomP changes here and nowhere else, so a reader's cache keys on it. */
let roomPGen = 0;

/* kJ into one cell's air at constant volume; the pressure that goes with it is the read. */
function roomBang(s, i, kJ){
  if(!(kJ > 0) || i < 0 || i >= GW*GH) return;
  s.roomT[i] = Math.min(ROOM_TMAX, s.roomT[i] + kJ/ROOM_CVAIR);
}
/* The BLAST tool's charge, tools/wavemock.html's: a Gaussian BLAST_SIG cells wide peaking at kPa, into
   open air on the charge's own side of every intact wall, as the heat that raises it - a charge is a burn. One cell is a grid-scale source and rings as a checkerboard (17-27 % of lit cells). */
const BLAST_SIG = 2.4;
function roomBlastCharge(s, i, kPa){
  if(!(kPa > 0) || i < 0 || i >= GW*GH) return;
  const G = roomGeomLive(s), comp = roomComp(G), X0 = i%GW, Y0 = (i/GW)|0, R = Math.ceil(3*BLAST_SIG), k = 1/(2*BLAST_SIG*BLAST_SIG);
  for(let Y=Math.max(0,Y0-R);Y<=Math.min(GH-1,Y0+R);Y++) for(let X=Math.max(0,X0-R);X<=Math.min(GW-1,X0+R);X++){
    const j = Y*GW+X;
    if(G.occ[j] || G.tight[j] || comp[j] !== comp[i]) continue;
    roomBang(s, j, kPa*Math.exp(-((X-X0)*(X-X0)+(Y-Y0)*(Y-Y0))*k)*ROOM_CVAIR*T_HULL/ROOM_P0);
  }
}

let gsP = null, gsVg = null, gsDI = null, gsAx = null, gsAy = null, gsB = null, gsX = null,
    gsR = null, gsZ = null, gsD = null, gsAp = null, gsJ = null, gsFx = null, gsFy = null, gsOut = null, gsF = null, gsM0 = null, gsK = null, gsKi = null, gsIn = null, gsDisp = null;
function gsScratch(){
  const N = GW*GH;
  if(gsP && gsP.length === N) return N;
  const f = () => new Float64Array(N);
  gsP = f(); gsVg = f(); gsDI = f(); gsAx = f(); gsAy = f(); gsB = f(); gsX = f();
  gsR = f(); gsZ = f(); gsD = f(); gsAp = f(); gsJ = f(); gsFx = f(); gsFy = f(); gsOut = f(); gsF = f(); gsM0 = f(); gsK = f(); gsKi = f(); gsIn = f(); gsDisp = f();
  return N;
}
// y = A x, A = diag(dI) + the face Laplacian; SPD, because every face coefficient is symmetric in its two cells
function roomCgApply(x, y, dI, ax, ay){
  const N = GW*GH;
  for(let i=0;i<N;i++) y[i] = dI[i]*x[i];
  for(let i=0;i<N-1;i++){ const a = ax[i]; if(a === 0) continue;
    const q = a*(x[i]-x[i+1]); y[i] += q; y[i+1] -= q; }
  for(let i=0;i<N-GW;i++){ const a = ay[i]; if(a === 0) continue;
    const q = a*(x[i]-x[i+GW]); y[i] += q; y[i+GW] -= q; }
}
const cgCapWarned = {};
// symmetric Gauss-Seidel: z = (D+U)^-1 D (D+L)^-1 r, SPD, so CG may take it
function roomCgPrecond(z, r, J, ax, ay){
  const N = GW*GH;
  for(let i=0;i<N;i++){ let v = r[i], X = i%GW;
    if(X > 0) v += ax[i-1]*z[i-1];
    if(i >= GW) v += ay[i-GW]*z[i-GW];
    z[i] = v/J[i]; }
  for(let i=N-1;i>=0;i--){ let v = z[i]*J[i], X = i%GW;
    if(X < GW-1) v += ax[i]*z[i+1];
    if(i < N-GW) v += ay[i]*z[i+GW];
    z[i] = v/J[i]; }
}
// conjugate gradient from x on roomCgPrecond(); returns the iterations it took
function roomCgSolve(b, x, dI, ax, ay, tol, max, tag){
  const N = GW*GH, r = gsR, z = gsZ, d = gsD, Ap = gsAp, J = gsJ;
  for(let i=0;i<N;i++) J[i] = dI[i];
  for(let i=0;i<N-1;i++){ J[i] += ax[i]; J[i+1] += ax[i]; }
  for(let i=0;i<N-GW;i++){ J[i] += ay[i]; J[i+GW] += ay[i]; }
  roomCgApply(x, Ap, dI, ax, ay);
  let bn = 0, rz = 0;
  for(let i=0;i<N;i++){ r[i] = b[i]-Ap[i]; bn += b[i]*b[i]; }
  roomCgPrecond(z, r, J, ax, ay);
  for(let i=0;i<N;i++){ d[i] = z[i]; rz += r[i]*z[i]; }
  bn = Math.sqrt(bn);
  if(!(bn > 0)){ x.fill(0); return 0; }
  let it = 0;
  for(;it<max;it++){
    let rn = 0; for(let i=0;i<N;i++) rn += r[i]*r[i];
    if(Math.sqrt(rn) <= tol*bn) break;
    roomCgApply(d, Ap, dI, ax, ay);
    let dAd = 0; for(let i=0;i<N;i++) dAd += d[i]*Ap[i];
    const a = rz/dAd;
    let rz1 = 0;
    for(let i=0;i<N;i++){ x[i] += a*d[i]; r[i] -= a*Ap[i]; }
    roomCgPrecond(z, r, J, ax, ay);
    for(let i=0;i<N;i++) rz1 += r[i]*z[i];
    const bt = rz1/rz; rz = rz1;
    for(let i=0;i<N;i++) d[i] = z[i] + bt*d[i];
  }
  if(it >= max && !cgCapWarned[tag]){ cgCapWarned[tag] = true;
    console.warn("[room] "+tag+" solve stopped at "+max+" iterations short of its tolerance"); }
  return it;
}
// kg each cell is given across its faces this tick, off the face kilograms (positive toward +x, +y)
function faceInflow(inn, fx, fy){
  const N = GW*GH;
  inn.fill(0);
  for(let i=0;i<N-1;i++){ const m = fx[i]; if(m > 0) inn[i+1] += m; else if(m < 0) inn[i] -= m; }
  for(let i=0;i<N-GW;i++){ const m = fy[i]; if(m > 0) inn[i+GW] += m; else if(m < 0) inn[i] -= m; }
}
/* The linear solve knows no vacuum: behind a strong front it drives a cell below zero, and clamping that creates gas. So a cell's OUTFLOW is cut to what it holds plus what it is given this tick - the NET, never the gross: a face passes many times a small cell's content in a tick (a choked hole off a few MPa moves a quarter of a tonne), and capping the gross stops the through-flow and piles the inflow without bound. The inflow counted is after its own donors' cuts, so it is iterated. With `cap`, a cell's INFLOW is cut the same way to the room it has plus what it passes on, so a liquid never lands past a cell's cap. */
const FACE_TAIL = 16;
function faceLimit(Mm, fx, fy, n, cap){
  const N = GW*GH, out = gsOut, inn = gsJ, k = gsK.fill(1), ki = gsKi.fill(1);
  for(let it=0;it<n;it++){ let moved = false;
    out.fill(0); inn.fill(0);
    for(let i=0;i<N;i++){
      if(fx[i] > 0){ out[i] += fx[i]*ki[i+1]; inn[i+1] += fx[i]*k[i]; } else if(fx[i] < 0){ out[i+1] -= fx[i]*ki[i]; inn[i] -= fx[i]*k[i+1]; }
      if(fy[i] > 0){ out[i] += fy[i]*ki[i+GW]; inn[i+GW] += fy[i]*k[i]; } else if(fy[i] < 0){ out[i+GW] -= fy[i]*ki[i]; inn[i] -= fy[i]*k[i+GW]; }
    }
    for(let i=0;i<N;i++){ const have = Mm[i] + inn[i]*ki[i], v = out[i] > have ? have/out[i] : 1; if(v !== k[i]) moved = true; k[i] = v; }
    // a full cell passes on what it is given: its pressure is state, so the grams of compression need not land
    if(cap) for(let i=0;i<N;i++){ const room = Math.max(0, cap[i] - Mm[i]) + out[i]*k[i], v = inn[i] > room ? room/inn[i] : 1; if(v !== ki[i]) moved = true; ki[i] = v; }
    if(!moved) break;
  }
  for(let i=0;i<N;i++){
    if(fx[i] > 0) fx[i] *= k[i]*ki[i+1]; else if(fx[i] < 0) fx[i] *= k[i+1]*ki[i];
    if(fy[i] > 0) fy[i] *= k[i]*ki[i+GW]; else if(fy[i] < 0) fy[i] *= k[i+GW]*ki[i];
  }
  // the fixed point stops at n whether or not it converged, and faceMove()'s clamp would then create mass: shave the overdraw off the scaled fluxes until none is left
  let cut = 0;
  for(let it=0;it<=FACE_TAIL;it++){
    out.fill(0);
    faceInflow(inn, fx, fy);
    for(let i=0;i<N-1;i++){ const m = fx[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+1] -= m; }
    for(let i=0;i<N-GW;i++){ const m = fy[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+GW] -= m; }
    cut = 0;
    for(let i=0;i<N;i++){ const have = Mm[i] + inn[i], ex = out[i] - have;
      const v = ex > have*1e-9 + 1e-9 ? (have > 0 ? have/out[i] : 0) : 1;
      k[i] = v; if(v !== 1 && ex > cut) cut = ex; }
    if(!cut || it === FACE_TAIL) break;
    for(let i=0;i<N-1;i++){ if(fx[i] > 0) fx[i] *= k[i]; else if(fx[i] < 0) fx[i] *= k[i+1]; }
    for(let i=0;i<N-GW;i++){ if(fy[i] > 0) fy[i] *= k[i]; else if(fy[i] < 0) fy[i] *= k[i+GW]; }
  }
  if(cut && !cgCapWarned["faceTail"+n]){ cgCapWarned["faceTail"+n] = true;
    console.warn("[room] faceLimit("+n+") still overdraws a cell by "+cut.toFixed(6)+" kg after "+FACE_TAIL+" tail passes"); }
}
// move the face kilograms; a cell never goes below empty
function faceMove(Mm, fx, fy){
  const N = GW*GH, d = gsF.fill(0);
  for(let i=0;i<N-1;i++) if(fx[i] !== 0){ d[i] -= fx[i]; d[i+1] += fx[i]; }
  for(let i=0;i<N-GW;i++) if(fy[i] !== 0){ d[i] -= fy[i]; d[i+GW] += fy[i]; }
  for(let i=0;i<N;i++) if(d[i] !== 0) Mm[i] = Math.max(0, Mm[i] + d[i]);
}
/* Species ride the face kilograms as a mass fraction, upwind and IMPLICIT: what leaves a cell is what it holds once this tick's inflow has mixed in, so gas passing through a cell smaller than the tick's flow carries the upstream share instead of piling its own. Symmetric Gauss-Seidel sweeps of that mixing, so a chain of through-flow in either direction settles in a pair; each update is a convex blend, so every share stays in [0, 1] and a species never outweighs its gas. `inn` is faceInflow() of the same faces. */
const ADV_SWEEPS = 4;
let gsY0 = null, gsY = null;
function roomAdvect(F, M0, M1, fx, fy, inn, lim){
  const N = GW*GH;
  if(!gsY0 || gsY0.length !== N){ gsY0 = new Float64Array(N); gsY = new Float64Array(N); }
  const y0 = gsY0, y = gsY;
  if(lim === undefined) lim = 1;
  for(let i=0;i<N;i++){ y0[i] = M0[i] > 0 ? Math.min(lim, F[i]/M0[i]) : 0; y[i] = y0[i]; }
  const upd = i => { const X = i%GW; let n = M0[i]*y0[i];
    if(X > 0 && fx[i-1] > 0) n += fx[i-1]*y[i-1];
    if(X < GW-1 && fx[i] < 0) n -= fx[i]*y[i+1];
    if(i >= GW && fy[i-GW] > 0) n += fy[i-GW]*y[i-GW];
    if(i < N-GW && fy[i] < 0) n -= fy[i]*y[i+GW];
    const w = M0[i] + inn[i]; y[i] = w > 0 ? n/w : y0[i]; };
  for(let it=0;it<ADV_SWEEPS;it++){ for(let i=0;i<N;i++) upd(i); for(let i=N-1;i>=0;i--) upd(i); }
  for(let i=0;i<N;i++) F[i] = y[i]*M1[i];
}
/* One tick of the gas: predict the face velocities off one implicit solve, move the mass on them,
   carry the species and the enthalpy (into src[], priced by the heat pass against ROOM_C), then read
   the pressure. Returns the worst cell over its own compartment's mean, which a bang is judged on. */
function roomGasStep(s, dt, G, src){
  const N = gsScratch(), Mm = s.roomM, T = s.roomT, U = s.roomPU, V = s.roomPV, bx = G.bx, by = G.by;
  const p = gsP, vg = gsVg;
  /* The room a landing liquid took since the last solve is a SOURCE: the pressure is read at the room the gas had, and the solve pushes the difference out over the tick, rather than reading a compressed cell and shocking its neighbours. */
  const disp = gsDisp;
  let anyDisp = false;
  for(let i=0;i<N;i++){ vg[i] = roomVgas(s, i); if(disp[i] !== 0) anyDisp = true; p[i] = roomPOf(Mm[i], roomGasCell(vg[i]) ? vg[i] + disp[i] : vg[i], T[i])*1e6; }
  /* A cell the liquids fill is not a gas cell: its faces are shut to the gas, or the momentum arriving at a cell that has just filled is stopped in one tick by megapascals. */
  const fxOpen = i => bx[i] !== 0 && roomGasCell(vg[i]) && roomGasCell(vg[i+1]);
  const fyOpen = i => by[i] !== 0 && roomGasCell(vg[i]) && roomGasCell(vg[i+GW]);
  /* The gate: a field with no step across any open face and no face moving costs nothing. */
  let live = anyDisp;
  const pLo = WAVE_P_LO*1000, uLo = WAVE_U_LO*ROOM_RHO;
  for(let i=0;i<N && !live;i++)
    if(Math.abs(U[i]) > uLo || Math.abs(V[i]) > uLo
       || (fxOpen(i) && Math.abs(p[i]-p[i+1]) > pLo)
       || (fyOpen(i) && Math.abs(p[i]-p[i+GW]) > pLo)) live = true;
  if(!live){ U.fill(0); V.fill(0); roomCgIt = 0; gsX.fill(0); disp.fill(0); }
  else {
    const kp = gsDI, gx = gsAx, gy = gsAy, b = gsB, x = gsX, A = MPC*ROOM_DEPTH, gA = dt*dt*A/MPC;
    // kg per Pa: the cell's own compliance, and what a face passes in one tick per Pa across it
    for(let i=0;i<N;i++){
      kp[i] = vg[i]/(R_SI*Math.max(T[i], 1));
      if(!fxOpen(i)){ gx[i] = 0; U[i] = 0; } else gx[i] = gA*bx[i];
      if(!fyOpen(i)){ gy[i] = 0; V[i] = 0; } else gy[i] = gA*by[i];
    }
    const fx = gsFx, fy = gsFy;
    // the kilograms last tick's momentum carries, and the solve is in the increment over last tick's pressure
    for(let i=0;i<N;i++){
      fx[i] = gx[i] !== 0 ? U[i]*A*dt : 0;
      fy[i] = gy[i] !== 0 ? V[i]*A*dt : 0;
    }
    for(let i=0;i<N;i++){ const X = i%GW;
      b[i] = -(fx[i] - (X > 0 ? fx[i-1] : 0) + fy[i] - (i >= GW ? fy[i-GW] : 0)); }
    for(let i=0;i<N;i++) if(disp[i] !== 0 && roomGasCell(vg[i])) b[i] += Mm[i]*disp[i]/(vg[i] + disp[i]);
    disp.fill(0);
    for(let i=0;i<N-1;i++){ const q = gx[i]*(p[i]-p[i+1]); b[i] -= q; b[i+1] += q; }
    for(let i=0;i<N-GW;i++){ const q = gy[i]*(p[i]-p[i+GW]); b[i] -= q; b[i+GW] += q; }
    if(roomCgIt === 0) x.fill(0);
    roomCgIt = roomCgSolve(b, x, kp, gx, gy, CG_TOL, CG_MAX, "gas");
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) fx[i] -= gx[i]*((p[i+1]+x[i+1]) - (p[i]+x[i]));
      if(gy[i] !== 0) fy[i] -= gy[i]*((p[i+GW]+x[i+GW]) - (p[i]+x[i]));
    }
    // the momentum is what actually crossed
    faceLimit(Mm, fx, fy, 4);
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) U[i] = fx[i]/(A*dt); else fx[i] = 0;
      if(gy[i] !== 0) V[i] = fy[i]/(A*dt); else fy[i] = 0;
    }
    const M0 = gsM0; M0.set(Mm);
    faceInflow(gsIn, fx, fy);
    faceMove(Mm, fx, fy);
    for(const F of [s.roomH2, s.roomO2, s.roomVap]) roomAdvect(F, M0, Mm, fx, fy, gsIn);
    /* A cell's capacity is fixed (ROOM_C) and does not follow its gas, so the receiver's gain comes off the donor: charged only to the receiver, a circulation the heat stencil drives creates energy every tick. Capped at an eighth of the cell per face, advectSrc()'s rule, or a blast's kilograms drive the explicit heat pass past level. */
    const mix = m => { const g = Math.abs(m)*ROOM_CP; return g*ROOM_C/(ROOM_C + 8*g)/dt; };
    for(let i=0;i<N;i++){
      if(fx[i] !== 0){ const a = fx[i] > 0 ? i : i+1, c = a === i ? i+1 : i;
        const q = mix(fx[i])*(T[a] - T[c]); src[c] += q; src[a] -= q; }
      if(fy[i] !== 0){ const a = fy[i] > 0 ? i : i+GW, c = a === i ? i+GW : i;
        const q = mix(fy[i])*(T[a] - T[c]); src[c] += q; src[a] -= q; }
    }
  }
  roomPGen++;
  const Pr = s.roomP, Pk = s.roomPPk;
  for(let i=0;i<N;i++) if(roomGasCell(vg[i])) Pr[i] = roomPOf(Mm[i], vg[i], T[i])*1000 - ROOM_P0;
  /* A cell the liquids fill holds no gas to read, so it carries the gas it would rise to: read off its own empty volume it is a vacuum, and read off the cell over it, a flood under a deck reads the deck plate's untouched air and the level pass holds it there against the open side. */
  for(let i=0;i<N;i++){
    if(!roomGasCell(vg[i])){ const w = roomGasRing(s, G, i);
      let q = 0;
      for(let k=0;k<gdRing.length;k+=2) q += Pr[gdRing[k]]*gdRing[k+1];
      Pr[i] = w > 0 ? q/w : (i >= GW ? Pr[i-GW] : 0); }
    /* Monotonic and on S, because "this compartment has been blown up" is a fact about the run: it saves, it loads, and a replay lands on the same battlefield. */
    if(Pr[i] > Pk[i]) Pk[i] = Pr[i]; }
  const st = roomPStatic(s);
  let pmax = 0;
  for(let i=0;i<N;i++){ const e = Pr[i] - st[i]; if(e > pmax) pmax = e; }
  return pmax;
}

/* Read off the same roomH2Frac() the layer draws, so a cell cannot draw as safe and burn. */
const roomFlamOf = (f,fo2) => f >= H2_LFL && f <= H2_UFL && fo2 >= O2_LOC;
const roomFlam = (s,i) => roomFlamOf(roomH2Frac(s,i), roomO2Frac(s,i));
/* The front burns into the UNBURNT share (1 - roomFlame), never the cell average, or a cell dilutes itself below the limit halfway through its own passage. Floored, because the last sliver is arithmetically pure hydrogen and would quench on the RICH limit rather than run out. */
const ROOM_FR_MIN = 0.1;
const roomFrontU = (s,i) => Math.max(ROOM_FR_MIN, 1 - s.roomFlame[i]);
const roomFrontFrac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(roomMolX(s,i)*roomFrontU(s,i) + n) : 0; };
const roomFrontO2 = (s,i) => s.roomO2[i]/O2_MMOL
  /Math.max(1e-9, roomMolX(s,i)*roomFrontU(s,i) + s.roomH2[i]/H2_MMOL);
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
/* The water on the floor carries s.roomWaterE, datum liquid at H_DATUM; the metal carries s.roomPoolE. */
const WATER_RHO = 1000;                   // kg/m3
const zFloor = i => (GH-1-((i/GW)|0))*MPC;
// metres of liquid standing in the cell; one cell full is MPC
const liqFill = (M, rho, i) => M[i]/(rho*MPC*ROOM_DEPTH);
// m3 of gas over whatever stands on the cell's floor, never under ROOM_VG_MIN of the cell
const ROOM_VG_MIN = 0.01;
const roomVgas = (s, i) => Math.max(ROOM_VG_MIN*ROOM_VCELL,
  ROOM_VCELL - s.roomWater[i]/WATER_RHO - s.roomPool[i]/fireRho());
// ...and a cell whose gas room is at that floor is the liquids', not the gas's
const roomGasCell = vg => vg > ROOM_VG_MIN*ROOM_VCELL*1.0001;
/* Only paint is a floor, a gas-tight wall or shielding; a machine box is open frame to a liquid, and a CATCH PAN's only way out is its own drain line (panDrain()). */
const liqShut = (G, j) => !(G.hole && G.hole[j]) && (G.tight[j] || (G.occ[j] && G.own[j] < 0));
const liqRuns = (G, i, j) => !liqShut(G, j) && !(G.pan[i] && !G.pan[j]);
// a liquid and the one it shares the cell with, which takes that much of the cell's room
// U is the liquid under this one in a cell: the metal floats on the water, the water ignores the metal
const liqWater = s => ({M:s.roomWater, E:s.roomWaterE, rho:WATER_RHO, bulk:WATER_BULK, vu:s.roomWU, vv:s.roomWV, P:s.roomWP, O:s.roomPool, oRho:fireRho(), U:null, tag:"water"});
const liqMetal = s => ({M:s.roomPool, E:s.roomPoolE, rho:fireRho(), bulk:fireCool().bulk, vu:s.roomPoolU, vv:s.roomPoolV, P:s.roomPoolP, O:s.roomWater, oRho:WATER_RHO, U:s.roomWater, tag:"metal"});
const liqCap = (q, j) => Math.max(0, q.rho*(ROOM_VCELL - q.O[j]/q.oRho));
// full to the tolerance of its own compressibility: a stiff cell breathes a few grams as its pressure moves
const LIQ_FULL_K = 1 - 1e-4;
const liqFull = (q, j) => q.M[j] >= liqCap(q, j)*LIQ_FULL_K;
// on a floor, or on full cells all the way down to one
const liqStands = (q, G, i) => { for(;;){ const j = i+GW; if(j >= GW*GH || !liqRuns(G, i, j)) return true; if(!liqFull(q, j)) return false; i = j; } };
// every cell of a standing column shares the surface of its top cell
function liqTop(q, G, i){
  const M = q.M;
  if(!(M[i] > 0) || liqShut(G, i)) return i;
  while(i >= GW && M[i-GW] > 0 && liqRuns(G, i-GW, i) && liqFull(q, i)) i -= GW;
  return i;
}
const liqSurf = (q, G, i) => { const t = liqTop(q, G, i); return zFloor(t) + liqFill(q.M, q.rho, t); };
// the gas a cell holds, every species riding with the total
const roomGasFields = s => [s.roomM, s.roomH2, s.roomO2, s.roomVap];
const G_SI = G_MPA*1e6;                   // m/s2
// Pa, water's bulk modulus; the metal's is on its COOLANT row
const WATER_BULK = 2.2e9;
// s/m^(1/3), Manning on smooth steel plate (Chow)
const LIQ_MANNING = 0.012;
// orifice discharge coefficient: the loss where a standing body leaves through a hole shot in a wall
const LIQ_CD = 0.6;
// the inertia on a vertical face is the deeper of its two cells, a falling film its own, floored at this share of a cell
const LIQ_L_MIN = 0.05*MPC;
// m/s, a guard on a face velocity, never a model term
const LIQ_V_MAX = 30;
// m/s under which a cell is at rest, and m of depth step under which a face is
const LIQ_REST = 0.05, LIQ_H_LO = 0.001;
const LIQ_CG_TOL = 1e-9, LIQ_CG_MAX = 400;
// iterations the last liquid solve took, a readout for the tools like roomCgIt
let liqCgIt = 0;
let lqP = null, lqH = null, lqHc = null, lqCap = null, lqComp = null, lqAx = null, lqAy = null, lqAyD = null, lqB = null, lqX = null,
    lqFx = null, lqFy = null, lqM0 = null, lqDI = null, lqGas = null, lqAwx = null, lqAwy = null, lqLcap = null, lqLat = null, lqFull = null, lqStand = null, lqStiff = null;
function lqScratch(){
  const N = GW*GH;
  if(lqP && lqP.length === N) return N;
  const f = () => new Float64Array(N);
  lqP = f(); lqH = f(); lqHc = f(); lqCap = f(); lqComp = f(); lqAx = f(); lqAy = f(); lqAyD = f(); lqB = f(); lqX = f();
  lqFx = f(); lqFy = f(); lqM0 = f(); lqDI = f(); lqGas = f(); lqAwx = f(); lqAwy = f(); lqLcap = f(); lqLat = f();
  lqFull = new Uint8Array(N); lqStand = new Uint8Array(N); lqStiff = new Uint8Array(N);
  return N;
}
// m/s the liquid in a cell is moving, the fastest of its four faces
const liqSpeed = (q, i) => { const X = i%GW; let v = 0;
  if(X < GW-1) v = Math.max(v, Math.abs(q.vu[i]));
  if(X > 0) v = Math.max(v, Math.abs(q.vu[i-1]));
  if(i < GW*GH-GW) v = Math.max(v, Math.abs(q.vv[i]));
  if(i >= GW) v = Math.max(v, Math.abs(q.vv[i-GW]));
  return v; };
/* One tick of a liquid: a pressure at every cell's floor and a speed on every face, one implicit solve of
   roomGasStep()'s shape, then the mass moves on the faces it solved and its energy rides with it.
   p is the pressure at the cell's own floor, Pa absolute. A cell with room left is a free surface,
   p = pGas + rho*g*h, compliance A/g. A full cell carried by the floor is liquid alone: its pressure is
   STATE (q.P), the solve moves it on compliance cap/K, and it is a free surface again once it has gas over it
   or has drained under its cap. Gravity is in p and needs no term of its own.
   A full cell in the air is a lump: a free surface with more head than a cell, pressing on nothing beside
   it. A vertical face onto a cell with room left pushes against that cell's gas, not its floor, so the
   receiver takes it as a source; every other face is symmetric. */
function liqStep(s, dt, G, q){
  const N = lqScratch(), M = q.M, E = q.E, rho = q.rho, K = q.bulk, vu = q.vu, vv = q.vv, LP = q.P;
  gsScratch();
  const A = MPC*ROOM_DEPTH, rg = rho*G_SI, p = lqP, h = lqH, hc = lqHc, cap = lqCap, comp = lqComp, full = lqFull, stand = lqStand, gas = lqGas, stiff = lqStiff;
  const cd2 = 2*LIQ_CD*LIQ_CD, n2g = G_SI*LIQ_MANNING*LIQ_MANNING, P0 = ROOM_P0*1000;
  let any = false;
  for(let i=0;i<N && !any;i++) if(M[i] > 0) any = true;
  if(!any){ vu.fill(0); vv.fill(0); return; }
  for(let i=0;i<N;i++){
    cap[i] = liqShut(G, i) ? 0 : liqCap(q, i);
    hc[i] = cap[i]/(rho*A);
    h[i] = M[i]/(rho*A);
    gas[i] = (ROOM_P0 + s.roomP[i])*1000;
    full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0;
  }
  // carried by the floor through full cells
  const standWalk = () => { for(let i=N-1;i>=0;i--){ const j = i+GW; stand[i] = (j >= N || !liqRuns(G, i, j)) ? 1 : (full[j] && stand[j]) ? 1 : 0; } };
  standWalk();
  // a carried cell over its cap is not a mound: the excess climbs the column, liqLand()'s own law
  for(let i=N-1;i>=GW;i--){
    if(!(cap[i] > 0 && M[i] > cap[i] && stand[i] && liqRuns(G, i, i-GW) && !liqShut(G, i-GW))) continue;
    const ex = M[i] - cap[i], eE = E ? E[i]*ex/M[i] : 0;
    M[i] -= ex; M[i-GW] += ex; if(E){ E[i] -= eE; E[i-GW] += eE; }
    gsDisp[i-GW] += ex/rho;
    h[i] = M[i]/(rho*A); h[i-GW] = M[i-GW]/(rho*A);
    full[i-GW] = cap[i-GW] > 0 && M[i-GW] >= cap[i-GW]*LIQ_FULL_K ? 1 : 0;
  }
  standWalk();
  const zf = i => q.U ? liqFill(q.U, q.oRho, i) : 0;
  const pFree = i => gas[i] + rg*h[i];
  // stiff: full, carried, liquid or a ceiling over it (a full cell with gas over it is a free surface at its own top)
  for(let i=0;i<N;i++) stiff[i] = full[i] && stand[i] && (i < GW || !liqRuns(G, i, i-GW) || h[i-GW] > LIQ_H_LO) ? 1 : 0;
  for(let i=0;i<N;i++) p[i] = stiff[i] ? P0 + LP[i]*1000 : pFree(i);
  const hw = i => Math.min(h[i], hc[i]);
  // N per metre of face from one side over a face hm high: its liquid to its own top, its gas over that; a falling cell presses with its gas alone
  const side = (i, hm) => { const w = Math.min(hw(i), hm); return stand[i] ? (p[i] + rg*zf(i))*w - rg*w*w/2 + gas[i]*(hm - w) : gas[i]*hm; };
  const driveX = (i, j) => { const hm = Math.max(hw(i), hw(j)); return hm > 0 ? (side(i, hm) - side(j, hm))/hm : 0; };
  const runsX = i => cap[i] > 0 && cap[i+1] > 0 && liqRuns(G, i, i+1) && liqRuns(G, i+1, i);
  const runsY = i => cap[i] > 0 && cap[i+GW] > 0 && liqRuns(G, i, i+GW);
  const writeP = () => { for(let i=0;i<N;i++) LP[i] = M[i] > 0 ? ((stand[i] ? p[i] : gas[i]) - P0)/1000 : 0; };
  /* The gate: a film thinner than LIQ_H_LO steps nowhere, and a body at rest with every face still costs nothing. */
  let live = false;
  const dLo = rg*LIQ_H_LO;
  for(let i=0;i<N && !live;i++){ const X = i%GW;
    if(X < GW-1 && runsX(i) && (h[i] > 0 || h[i+1] > 0) && (Math.abs(vu[i]) > LIQ_REST || Math.abs(driveX(i, i+1)) > dLo)) live = true;
    if(i < N-GW && runsY(i) && (h[i] > 0 || h[i+GW] > 0)){ const j = i+GW;
      const d = p[i] - (full[j] ? p[j] - rg*Math.min(h[j], hc[j]) : gas[j]);
      if(Math.abs(vv[i]) > LIQ_REST || Math.abs(d) > dLo) live = true; } }
  if(!live){ vu.fill(0); vv.fill(0); liqCgIt = 0; writeP(); return; }

  const ax = lqAx, ay = lqAy, ayD = lqAyD, b = lqB, x = lqX, fx = lqFx, fy = lqFy, dI = lqDI, awx = lqAwx, awy = lqAwy, lat = lqLat;
  const fallV = k => Math.max(k < N-GW ? Math.abs(vv[k]) : 0, k >= GW ? Math.abs(vv[k-GW]) : 0);
  for(let pass=0;pass<2;pass++){
  for(let i=0;i<N;i++) comp[i] = cap[i] > 0 ? (stiff[i] ? Math.max(cap[i]/K, 1e-9) : A/G_SI) : 1;
  ax.fill(0); ay.fill(0); ayD.fill(0); fx.fill(0); fy.fill(0); awx.fill(0); awy.fill(0); lat.fill(0);
  for(let i=0;i<N;i++){ const X = i%GW;
    if(X < GW-1 && runsX(i)){ const j = i+1, hf = Math.max(hw(i), hw(j));
      // water in the air crosses a face sideways only where it moves sideways faster than it falls
      const lz = !stand[i] && !stand[j] &&
        Math.max(Math.abs(vu[i]), X > 0 ? Math.abs(vu[i-1]) : 0, X < GW-2 ? Math.abs(vu[i+1]) : 0) <= Math.max(fallV(i), fallV(j), LIQ_REST);
      const d0 = lz ? 0 : driveX(i, j);
      if(hf > 0 && !lz){ const v = vu[i], up = v > 0 ? i : v < 0 ? j : (d0 >= 0 ? i : j), dn = up === i ? j : i;
        const Aw = ROOM_DEPTH*hf, L = MPC;
        let c = n2g*Math.abs(v)/Math.pow(Math.max(hf, 1e-3), 4/3);
        if(full[up] && !(full[dn] && stand[dn]) && G.hole && (G.hole[i] || G.hole[j])) c += Math.abs(v)/(cd2*L);
        const vup = v > 0 ? (X > 0 && awx[i-1] > 0 ? vu[i-1] : 0) : v < 0 ? (X < GW-2 && runsX(j) ? vu[j] : 0) : 0;
        const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
        awx[i] = Aw; ax[i] = g; fx[i] = rho*Aw*dt*(v + dt*adv*vup)/den + g*d0;
        fx[i] += (lat[i] - lat[j])*dt*dt/L; } }
    if(i < N-GW && runsY(i)){ const j = i+GW, v = vv[i];
      const d0 = p[i] - (full[j] ? p[j] - rg*Math.min(h[j], hc[j]) : gas[j]);
      // the face is as wide as the side that holds liquid: a still face over a full cell is that cell's, or a lid could never push up
      let up = v > 0 ? i : v < 0 ? j : (d0 > 0 ? i : d0 < 0 ? j : (M[i] >= M[j] ? i : j));
      if(!(M[up] > 0)) up = up === i ? j : i;
      const dn = up === i ? j : i;
      const f = cap[up] > 0 ? Math.min(1, M[up]/cap[up]) : 0;
      // the inertia is the deeper of the two: a film over a body rides the body, a film over air is its own
      if(f > 0){ const Aw = A*f, L = Math.max(hw(i), hw(j), LIQ_L_MIN), hf = Math.max(f*MPC, 1e-3);
        // a stream landing on a body: its momentum flux, half to each side of the cell it lands in
        if(!stand[i] && stand[j] && v > 0) lat[j] += 0.5*rho*Aw*v*v;
        let c = n2g*Math.abs(v)/Math.pow(hf, 4/3);
        if(full[up] && !(full[dn] && stand[dn]) && G.hole && (G.hole[i] || G.hole[j])) c += Math.abs(v)/(cd2*L);
        const vup = v > 0 ? (i >= GW && awy[i-GW] > 0 ? vv[i-GW] : 0) : v < 0 ? (j < N-GW && runsY(j) ? vv[j] : 0) : 0;
        const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
        awy[i] = Aw; fy[i] = rho*Aw*dt*(v + dt*adv*vup)/den + g*d0;
        if(full[j]) ay[i] = g; else ayD[i] = g; } } }
  for(let i=0;i<N;i++){ const X = i%GW;
    dI[i] = comp[i] + ayD[i];
    b[i] = -(fx[i] - (X > 0 ? fx[i-1] : 0) + fy[i] - (i >= GW ? fy[i-GW] : 0)); }
  x.fill(0);
  liqCgIt = roomCgSolve(b, x, dI, ax, ay, LIQ_CG_TOL, LIQ_CG_MAX, q.tag);
  for(let i=0;i<N;i++){
    if(ax[i] !== 0) fx[i] += ax[i]*(x[i] - x[i+1]);
    if(ay[i] !== 0) fy[i] += ay[i]*(x[i] - x[i+GW]);
    else if(ayD[i] !== 0) fy[i] += ayD[i]*x[i];
  }
  /* A full cell with gas over it is a lid: a free surface at its own ceiling, so it drains as a free cell; fed from the side it must push what it is given up through that ceiling, which only a stiff cell can, so a lid the pass fills goes stiff and the pass is taken again. */
  if(pass === 0){ let lid = false;
    for(let i=0;i<N;i++){ const X = i%GW;
      if(!full[i] || stiff[i] || !stand[i]) continue;
      const net = -fx[i] + (X > 0 ? fx[i-1] : 0) - fy[i] + (i >= GW ? fy[i-GW] : 0);
      if(net > 1e-3){ stiff[i] = 1; lid = true; } }
    if(lid) continue; }
  break;
  }
  for(let i=0;i<N;i++){
    if(awx[i] > 0){ const v = clamp(fx[i]/(rho*awx[i]*dt), -LIQ_V_MAX, LIQ_V_MAX); fx[i] = rho*awx[i]*dt*v; } else fx[i] = 0;
    if(awy[i] > 0){ let v = clamp(fy[i]/(rho*awy[i]*dt), -LIQ_V_MAX, LIQ_V_MAX);
      // a pan's rim: nothing leaves upward until it is brim full
      if(v < 0 && !liqRuns(G, i+GW, i) && !full[i+GW]) v = 0;
      fy[i] = rho*awy[i]*dt*v; } else fy[i] = 0;
  }
  // only a cell the floor carries is capped: a cell in the air is free to pile, or the throttle at the bottom of a stream propagates up it as one incompressible pipe
  for(let i=0;i<N;i++) lqLcap[i] = stand[i] ? cap[i] : Infinity;
  faceLimit(M, fx, fy, 128, lqLcap);
  for(let i=0;i<N;i++){
    vu[i] = awx[i] > 0 ? fx[i]/(rho*awx[i]*dt) : 0;
    vv[i] = awy[i] > 0 ? fy[i]/(rho*awy[i]*dt) : 0;
  }
  const M0 = lqM0; M0.set(M);
  faceInflow(gsIn, fx, fy);
  faceMove(M, fx, fy);
  if(E) roomAdvect(E, M0, M, fx, fy, gsIn, Infinity);
  for(let i=0;i<N;i++) if(M[i] <= 0){ M[i] = 0; if(E) E[i] = 0; }
  /* The gas swap, one face at a time: the volume that crossed pushes the same volume of the receiver's gas back over that face, no further. */
  const gf = roomGasFields(s);
  const swap = (a, c, m) => { const dV = m/rho, f = Math.min(1, dV/(roomVgas(s, c) + dV));
    for(const F of gf){ const g = F[c]*f; F[c] -= g; F[a] += g; } };
  for(let i=0;i<N;i++){
    if(fx[i] > 0) swap(i, i+1, fx[i]); else if(fx[i] < 0) swap(i+1, i, -fx[i]);
    if(fy[i] > 0) swap(i, i+GW, fy[i]); else if(fy[i] < 0) swap(i+GW, i, -fy[i]);
  }
  // the solved pressure is the stiff cells' state; a free cell reads its own head off its new mass
  for(let i=0;i<N;i++){ h[i] = M[i]/(rho*A); full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0; p[i] = stiff[i] ? p[i] + x[i] : pFree(i); }
  standWalk();
  writeP();
}
/* Where a source lands: a full cell has no room, so the liquid goes on up the column to the first cell
   that has some, the surface of the body it joined; a sealed column brim full takes it on its top cell. */
function liqLand(s, G, q, i, kg, kJ, v0){
  if(!(kg > 0)) return;
  while(i >= GW && liqFull(q, i) && liqRuns(G, i, i-GW) && !liqShut(G, i-GW)) i -= GW;
  gsScratch(); gsDisp[i] += kg/q.rho;
  q.M[i] += kg;
  if(q.E) q.E[i] += kJ || 0;
  // a source arrives at the speed it left its opening at, not at rest
  if(v0 > 0 && i < GW*GH-GW && liqRuns(G, i, i+GW) && !liqFull(q, i+GW)) q.vv[i] = Math.max(q.vv[i], Math.min(v0, LIQ_V_MAX));
}
const liqSettle = liqStep;
let gdQ = null, gdSeen = null, gdK = 0;
const gdRing = [];
/* The nearest ring of cells still holding gas that a bubble leaving i reaches, rising up or sideways through the liquid: flat pairs of cell and weight (face times gas room) in gdRing, the summed weight returned, 0 for none. */
function roomGasRing(s, G, i){
  const N = GW*GH;
  if(!gdQ || gdQ.length !== N){ gdQ = new Int32Array(N); gdSeen = new Int32Array(N); gdK = 0; }
  const k = ++gdK, q = gdQ, nb = gdRing;
  let h = 0, n = 0, w = 0;
  nb.length = 0;
  const put = (j, b) => { if(!(b > 0) || gdSeen[j] === k) return; gdSeen[j] = k;
    const vg = roomVgas(s, j);
    if(roomGasCell(vg)){ nb.push(j, b*vg); w += b*vg; } else q[n++] = j; };
  gdSeen[i] = k; q[n++] = i;
  while(h < n && !nb.length)
    for(const end = n; h < end; h++){ const a = q[h], X = a%GW;
      if(a >= GW) put(a-GW, G.by[a-GW]);
      if(X < GW-1) put(a+1, G.bx[a]);
      if(X > 0) put(a-1, G.bx[a-1]); }
  return w;
}
/* Liquid landing takes the gas room it lands in, and that gas goes to roomGasRing(). Handed to full neighbours instead, it piles up under the water at a hundred atmospheres and bursts out the tick a cell opens. */
const roomDispOf = () => { gsScratch(); return gsDisp; };
function roomGasDisplace(s, G, i, dV){
  if(!(dV > 0)) return;
  const w = roomGasRing(s, G, i), nb = gdRing;
  if(!(w > 0)) return;
  const f = Math.min(1, dV/roomVgas(s, i));
  for(const F of roomGasFields(s)){ const g = F[i]*f;
    F[i] -= g;
    for(let k=0;k<nb.length;k+=2) F[nb[k]] += g*nb[k+1]/w; }
}
// the water surface in and beside a machine in rows from the top, or null: the metal burns a machine, it does not drown it
function partFloodLine(s, p, G){
  const W = s && s.roomWater;
  if(!p || !W) return null;
  G = G || roomGeomLive(s);
  const q = liqWater(s);
  let surf = -Infinity;
  // the box's own columns too: water runs in through the frame
  for(let X=Math.max(0,p.x-1);X<=Math.min(GW-1,p.x+p.w);X++){
    for(let Y=Math.max(0,p.y);Y<Math.min(GH,p.y+p.h);Y++){ const i = Y*GW+X;
      if(!(W[i] > 0) || liqShut(G, i) || !liqStands(q, G, i)) continue;
      const v = liqSurf(q, G, i);
      if(v > surf) surf = v; }
  }
  if(!(surf > -Infinity)) return null;
  const line = GH - surf/MPC;
  return p.y + p.h > line ? line : null;
}
// kg standing in a region and its deepest surface over the region's lowest floor, m
function regionFlood(s, g){
  const W = s && s.roomWater;
  if(!W || !g) return null;
  const G = roomGeomLive(s), q = liqWater(s);
  let kg = 0, top = -Infinity, bot = -1;
  for(const i of g.cells){ const Y = (i/GW)|0;
    if(Y > bot) bot = Y;
    if(!(W[i] > 0)) continue;
    kg += W[i];
    if(!liqStands(q, G, i)) continue;
    const v = liqSurf(q, G, i);
    if(v > top) top = v; }
  return kg > 0 ? {kg, d: top > -Infinity ? Math.max(0, top - zFloor(bot*GW)) : 0} : null;
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
// K, off the water's own energy; a cell holding none reads the hull
const roomWaterT = (s,i) => s.roomWater[i] > 0 ? H_DATUM + s.roomWaterE[i]/(s.roomWater[i]*CP_W) : T_HULL;
/* The water's three exchanges and nothing else: it boils off what it holds past saturation at the gas over it, into that cell's steam; it trades with its own air on ROOM_H over its free surface, capped at its own capacity (advectSrc()'s rule); the sodium-water reaction takes its share where it consumes it. */
function roomWaterHeat(s, dt, G, src){
  const N = GW*GH, W = s.roomWater, E = s.roomWaterE, T = s.roomT, A = MPC*ROOM_DEPTH, hk = ROOM_H*A/1000;
  const q = liqWater(s);
  for(let i=0;i<N;i++){
    const m = W[i];
    if(!(m > 0)) continue;
    const pk = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000, Ts = satT(SAT_WATER, pk), hf = satH(SAT_WATER, pk);
    if(E[i] > m*hf){
      const hfg = hfgOf(SAT_WATER, Ts), dm = Math.min(m, (E[i] - m*hf)/hfg);
      W[i] = m - dm; E[i] -= dm*(hf + hfg);
      s.roomVap[i] += dm; s.roomM[i] += dm; book(s, "sump", dm);
      src[i] += dm*(hf + hfg - hOfT(SAT_WATER, T[i]))/dt;
      if(W[i] <= 0){ W[i] = 0; src[i] += E[i]/dt; E[i] = 0; continue; }
    }
    // a free surface: room over it, or nothing standing on it
    if(liqFull(q, i) && i >= GW && W[i-GW] > 0 && !liqShut(G, i-GW)) continue;
    const Tw = roomWaterT(s, i);
    let qk = hk*(Tw - T[i]);
    const cap = W[i]*CP_W*(Tw - T[i])/dt;
    qk = qk > 0 ? Math.min(qk, Math.max(0, cap)) : Math.max(qk, Math.min(0, cap));
    E[i] -= qk*dt; src[i] += qk;
  }
}
// the same three tests the burn takes, so a cell cannot draw cold and burn
const roomPoolLit = (s,i) => { const f = fireRow();
  return s.roomPool[i] > 0 && (i < GW || !(s.roomPool[i-GW] > 0))
      && roomPoolT(s,i) >= f.ign && roomO2Frac(s,i) >= f.loc; };
// what the metal put into the air THIS tick, kJ per cell - read by the one q
let fireQ = null;
/* The bund is liqShut()'s; this is the drain, into a sealed tank the board does not draw, water first because it is on the bottom. The metal was booked out at the opening it left through; the water was booked back onto the ship when it landed, so it goes back off here. A wrecked pan is still a bund and drains nothing. */
const PAN_DRAIN_KGS = 20;                 // kg/s one pan's drain line passes
function panDrain(s, dt, G){
  for(const q of G.parts){
    if(q.p.role !== "pan" || partWrecked(s, q.p.id)) continue;
    let want = PAN_DRAIN_KGS*dt;
    for(const [M, E, W] of [[s.roomWater, s.roomWaterE, true], [s.roomPool, s.roomPoolE, false]])
      for(const i of q.cells){
        if(!(want > 0)) break;
        const take = Math.min(want, M[i]);
        if(!(take > 0)) continue;
        E[i] -= E[i]*take/M[i];
        if(W) book(s, "sump", take);
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
  const cool = fireCool();
  let on = 0;
  if(cool) roomLiqOuts(s, G, (cells, rate, fl, key) => {
    const row = fl.c.burn && FIRE[fl.c.burn];
    if(!row || !cells.length) return;
    /* The kilograms the TRANSPORT booked, never the solve's rate: this mass sits on the deck and must be the same mass that left the loop. */
    const kg = advectOutKg[key] || 0;
    if(!(kg > 0)) return;
    const pN = netPAt(s, fl.nd)*1e6, pR = (ROOM_P0 + s.roomP[cells[0]])*1000;
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
    // what did not burn in flight is on the deck, at the opening (roomPourCells()) and not a plume: a liquid falls
    const pour = roomPourCells(key, cells), per = (kg - burnt)/pour.length;
    if(per > 0) for(const i of pour) liqLand(s, G, liqMetal(s), i, per, per*cp*(Tin - row.melt), v);
  });
  const W = s.roomWater;
  if(cool) liqSettle(s, dt, G, liqMetal(s));
  liqSettle(s, dt, G, liqWater(s));
  panDrain(s, dt, G);
  roomWaterHeat(s, dt, G, src);
  // a cell the liquids fill holds no gas: what the swaps left in it goes where there is room
  for(let i=0;i<N;i++)
    if(s.roomM[i] > 0 && !roomGasCell(roomVgas(s, i))) roomGasDisplace(s, G, i, ROOM_VCELL);
  if(!cool) return;
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
    /* Water needs neither air nor a spark, so this is ungated on oxygen, ignition and temperature. The water in the pool's own cell first - a pool floats on it - then whatever steam a break put in the air; the rate is the smaller of what the surface passes and what water is there. */
    if(open && f.wlhv){
      const sump = W[i], vap = s.roomVap[i];
      const mw = Math.min(f.wrate*A*dt, m, swNaFor(f, sump + vap));
      if(mw > 0){
        const r = swReact(f, mw);
        let need = r.h2o;
        if(sump > 0){ const take = Math.min(need, sump);
          /* sumpStep() booked these kilograms back onto the ship; reacted, they are gone, and the book closes on the line it was credited on. */
          s.roomWaterE[i] -= s.roomWaterE[i]*take/sump; W[i] = sump - take; book(s, "sump", take); need -= take; }
        if(need > 0){ const t = Math.min(need, vap); s.roomM[i] -= t; s.roomVap[i] -= t; }
        M[i] = m = m - mw;
        E[i] += r.q - mw*cp*(Tp - f.melt);
        s.roomH2[i] += r.h2; s.roomM[i] += r.h2;
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

function roomH2Step(s, dt, G, pmax){
  const N = GW*GH, H = s.roomH2, O = s.roomO2, Fl = s.roomFlame;
  const T = s.roomT;
  s.roomBurnOn = 0;
  /* Hydrogen is a species the transport carries (s.h2By, advectH2Out by edge key), so the field has already lost it and nothing here debits s.h2. */
  if(s.h2 > 0){
    const H2OUT = advectH2Out;
    const put = (cells, rate, key) => {
      const m = H2OUT[key];
      if(!(m > 0) || !cells.length) return;
      // the same plume the heat went into, off the same opening at the same rate
      roomAddH2(s, cells, Math.max(0, rate)/100*loopKg(), m);
    };
    roomLiqOuts(s, G, (cells, rate, fl, key) => put(cells, rate, key));
  }
  /* The set moves air against the rest of the ship, so it carries gas both ways; with the hull sealed this is the only removal path that is not a fire. */
  if(!s.blackout) for(const q of G.parts){
    if(q.p.role !== "vent" || partWrecked(s, q.p.id)) continue;
    const f = Math.min(1, ROOM_VENT_KGS/q.cells.length/ROOM_MAIR*dt);
    /* ...and the AIR with them, toward what the rest of the ship holds at ambient and the cell's own temperature and room: the one place the ship outside the drawing exists. */
    for(const i of q.cells){ H[i] -= H[i]*f; s.roomVap[i] -= s.roomVap[i]*f;
      const m0 = ROOM_P0/1000*roomVgas(s, i)/(R_AIR*Math.max(T[i], 1));
      O[i] += (ROOM_O2_0/ROOM_M0*m0 - O[i])*f;
      s.roomM[i] += (m0 - s.roomM[i])*f; }
  }
  /* The vent set's expression with the target reversed: nitrogen in, oxygen and hydrogen to zero, mass unmoved. NO POWER, so a blackout does not take it away - and it does not stop sodium meeting water. */
  for(const q of G.parts){
    if(q.p.role !== "inert" || partWrecked(s, q.p.id)) continue;
    const f = Math.min(1, INERT_KGS/q.cells.length/ROOM_MAIR*dt);
    for(const i of q.cells){ H[i] -= H[i]*f; O[i] -= O[i]*f; }
  }
  /* One stencil, two biases: hydrogen carries H2_UP and collects at the deckhead, oxygen carries none. */
  roomDiffuse(s, H, G, dt, H2_UP);
  roomDiffuse(s, O, G, dt, 1);

  /* s.roomFlame is how far the front has crossed each cell, 0..1, on S: it advances at its own mixture's burning velocity times the clutter around it, and nothing latches. */
  for(let i=0;i<N;i++)
    if(Fl[i] <= 0 && H[i] > 0 && roomFlam(s,i) && roomIgnites(s,G,i)) Fl[i] = 1e-6;
  let burned = 0, on = 0;
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
    if(q > 0) roomBang(s, i, q);
  }
  roomScarStep(s, G, roomPStatic(s));
  s.roomBurnOn = on; s.roomPMax = pmax;
  if(s.roomFireOn && pmax > s.fireEv.p) s.fireEv.p = pmax;
  /* One event per explosion: a front at 0.05 m/s never trips a per-tick gate, so step.js writes the line when the last flame goes out. */
  if(burned > 0 || on){ s.burnEv.kg += burned;
    if(pmax > s.burnEv.p) s.burnEv.p = pmax; }
}

/* The heat pass walks this inline because it also carries the sources; here the BIAS is an argument, so hydrogen and oxygen share one walk. Conserving and CLOSED: the skin is sealed metal. */
function roomDiffuse(s, F, G, dt, up){
  const N = roomScratch(), d = roomD2, y = roomY, M = s.roomM;
  /* Fick runs on the mass fraction, through the gas the thinner side holds: priced off kilograms, a cell the water fills pulls its neighbours' oxygen in until it holds more than its own gas. */
  for(let i=0;i<N;i++) y[i] = M[i] > 0 ? F[i]/M[i] : 0;
  /* Both fluxes are exactly zero on a uniform field, and an intact ship's oxygen is flat every tick; the DRIFT also needs it empty, the symmetric pass only flat. */
  { const y0 = y[0]; let flat = true;
    for(let i=1;i<N;i++) if(y[i] !== y0){ flat = false; break; }
    if(flat && (up === 1 || y0 === 0)) return; }
  d.fill(0);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW+X, q = G.gx[i]*Math.min(M[i], M[i+1])*(y[i]-y[i+1])/ROOM_C;
    d[i] -= q; d[i+1] += q;
  }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    /* A DRIFT, not a faster diffusion: the flux vanishes at y[i] = up*y[j] - an exponential profile with a scale height. up = 1 is the plain symmetric pass. j is BELOW i on this grid. */
    const i = Y*GW+X, j = i+GW;
    const q = G.gDn[i]*Math.min(M[i], M[j])*(up*y[j] - y[i])/ROOM_C;
    d[i] += q; d[j] -= q;
  }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
  /* No hull term: the stencil is edge-based and conserving, so no-flux is already the default, and the sealed skin is what is wanted. */
}

/* The static pressure each cell stands in: its compartment's MEAN, a read over the view (regionPMean()), so a bang is what a cell carries over it. Memoised on the read. */
let pStatScr = null, pStatFor = null, pStatAt = -1;
function roomPStatic(s){
  const N = GW*GH;
  if(pStatScr && pStatScr.length === N && pStatFor === s && pStatAt === roomPGen) return pStatScr;
  if(!pStatScr || pStatScr.length !== N) pStatScr = new Float64Array(N);
  const of = matRegions().of, m = regionPMean(s);
  for(let i=0;i<N;i++) pStatScr[i] = of[i] < 0 ? 0 : m[of[i]];
  pStatFor = s; pStatAt = roomPGen;
  return pStatScr;
}
/* Per cell: the steam cannot exceed its saturation pressure at the cell's own temperature, and what will not stay a gas lands on that cell's floor as water. Instant, because any lag would be a fitted number standing in for an undrawn surface. It was booked out of the plant at the opening, so landing it comes back onto the held side against a negative `sump` line. */
const R_VAP = 0.0004615;                  // MPa*m3/(kg*K)
function roomCondense(s){
  const N = GW*GH, Vp = s.roomVap, T = s.roomT, G = roomGeomLive(s), q = liqWater(s);
  for(let i=0;i<N;i++){
    const v = Vp[i];
    if(!(v > 0)) continue;
    const Tk = Math.max(T[i], 1), drop = Math.min(v, s.roomM[i]) - satP(SAT_WATER, Tk)*roomVgas(s, i)/(R_VAP*Tk);
    if(!(drop > 0)) continue;
    Vp[i] = v - drop; s.roomM[i] -= drop; liqLand(s, G, q, i, drop, drop*hOfT(SAT_WATER, T[i]));
    book(s, "sump", -drop);
  }
}

/* The worst cell a machine stands in; the damage criterion and the HEAT layer both read it, so picture and failure cannot disagree. */
function roomAt(s, p){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH) v = Math.max(v, s.roomT[Y*GW+X]);
  return v || T_HULL;
}
/* A passage is one rise and fall of the bang at a cell: the tracker rides it up and books the peak
   once it has fallen to half, so the next echo is a passage of its own. Ungated, or it misses the fall. */
function roomScarStep(s, G, st){
  const N = GW*GH, P = s.roomP, scar = s.roomScar, cur = s.roomScarCur;
  for(let i=0;i<N;i++){
    if(G.occ[i] || G.tight[i]) continue;
    const a = Math.abs(P[i] - st[i]);
    if(a > cur[i]) cur[i] = a;
    else if(a < cur[i]*0.5){ if(cur[i] > HIT_LO) scar[i] += cur[i] - HIT_LO; cur[i] = a; }
  }
}
/* kPa·cells over the static (roomPStatic()) on the open-air cell outside each face cell, times the
   face's inward normal; the renderer's lean asks here, and `lit` is the most `w` reaches on those cells. */
function partLoad(s, p, gz, G, w){
  G = G || roomGeom();
  const P = s.roomP;
  let lit = 0;
  const q = (X, Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return 0; const i = Y*GW+X;
    if(G.occ[i] || G.tight[i]) return 0;
    if(w[i] > lit) lit = w[i];
    return P[i] - gz[i]; };
  let fx = 0, fy = 0;
  for(let j=0;j<p.h;j++) fx += q(p.x-1, p.y+j) - q(p.x+p.w, p.y+j);
  for(let j=0;j<p.w;j++) fy += q(p.x+j, p.y-1) - q(p.x+j, p.y+p.h);
  return {fx, fy, lit};
}
// cells; a bigger box is a heavier one and leans less
const partLeanOf = (p, f) => { const k = LEAN_K/(10*3)*(6*3)/(p.w*p.h); return {x:f.fx*k, y:f.fy*k}; };
/* One walk over a machine's own cells; `g` is the volume's static pressure per cell, so passing it
   asks for the BANG - what a source put ON TOP - and leaving it out asks for the field itself. The
   field may sit below gauge behind a front, and neither reader wants a negative. */
function roomPAt(s, p, g){
  let v = 0;
  for(let X=p.x;X<p.x+p.w;X++) for(let Y=p.y;Y<p.y+p.h;Y++)
    if(X>=0&&X<GW&&Y>=0&&Y<GH){ const i = Y*GW+X;
      const q = g ? s.roomP[i]-g[i] : s.roomP[i];
      if(q > v) v = q; }
  return v;
}
/* Moles of everything in a cell that is not hydrogen, off the cell's OWN gas: a pressurised cell holds more air, so the same hydrogen is a smaller fraction of it, and a cell full of steam is inert by arithmetic. */
const roomMolX = (s,i) => Math.max(0, s.roomM[i] - s.roomH2[i] - s.roomVap[i])/AIR_MMOL + s.roomVap[i]/H2O_MMOL;
// volume fraction, the same expression the ignition test uses so a cell cannot draw as safe and burn
const roomH2Frac = (s,i) => { const n = s.roomH2[i]/H2_MMOL;
  return n > 0 ? n/(roomMolX(s,i) + n) : 0; };
// off the SAME denominator, so a rich cell is oxygen-poor by arithmetic rather than a second rule
const roomO2Frac = (s,i) => s.roomO2[i]/O2_MMOL/Math.max(1e-9, roomMolX(s,i) + s.roomH2[i]/H2_MMOL);
// off the same partSkin()/partTsurv() the damage integral reads, so the alarm and the failure name one set
const roomOverIds = s => LAY.parts.filter(p => { const l = partTsurv(p);
  return l && fitted(p) && partSkin(s,p) > l; }).map(p => p.id);
const roomH2Peak = s => { let v = 0;
  for(let i=0;i<s.roomH2.length;i++){ const f = roomH2Frac(s,i); if(f > v) v = f; }
  return v; };
