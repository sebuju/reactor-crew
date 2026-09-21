"use strict";
/* The field is STATE (s.roomT) rather than a per-tick kernel like rad.js, because heat has memory. */

// m - THE ASSUMPTION: air mass and every hydrogen concentration scale on it
const ROOM_DEPTH = 4.0;
/* K - what the ship was BUILT at, and what the compartment starts at; not a boundary, because the skin radiates. */
const T_HULL = 293;
/* s.roomM is kg of gas per cell; pressure follows from it, the cell's own temperature and the room the liquids leave it, by the ideal gas law, so a discharge really raises it and a hole really lowers it. */
const R_AIR = 0.000287;                   // MPa*m3/(kg*K)
const ROOM_VCELL = MPC*MPC*ROOM_DEPTH;    // m3 of one cell
const ROOM_P0 = 101.3;                    // kPa, ambient
// kg/m3 dry air HAS at the pressure and temperature the ship was built at; the seeding density, never a capacity
const ROOM_RHO = ROOM_P0/1000/(R_AIR*T_HULL);
// W/m^2/K - free convection off a lagged industrial surface
const ROOM_H = 6;
/* m^2/s, the one fit here, and it is a MASS exchange rate: a face passes ROOM_MIX*min(m_i,m_j)/MPC^2 kg/s
   and what that carries is the two cells' own enthalpies, so the explicit cap is MPC^2/(8*ROOM_MIX*gamma)
   however empty a cell gets. H2_UP binds it at 0.63 m^2/s (dt=0.02); past it, substep rather than raise this. */
const ROOM_MIX = 0.35;
// hot air rises: the conductance up out of a cell against the one down into it
const ROOM_UP = 3.0;
// fraction that crosses an occupied cell: a machine is a wall
const ROOM_BLOCK = 0.12;
// K - a runaway guard only
const ROOM_TMAX = 20000;
/* Painted metal hull, the figure RADCOAT's default coating carries; ONE number, because there is one skin and the player cannot buy another. */
const HULL_EMIS = 0.85;
// m^2 of skin ONE OUTWARD FACE of a hull cell carries
const HULL_FACE_A = MPC*ROOM_DEPTH;

/* The structure a cell stands in: its own floor and deckhead, plus a hull plate per outward face.
   A machine's skin is NOT here - ROOM_HK already exchanges with it. Mild steel plate, 8 mm, the thin
   end of a machinery-space flat; stiffeners and girders are not counted, so this is a floor on the
   real structure rather than an estimate of it. */
const ROOM_PLATE = 0.008;                 // m
const STEEL_CP = 0.49;                    // kJ/kg/K
const ROOM_A_DECK = 2*MPC*MPC;            // m2 of floor plus deckhead in one cell
const ROOM_CSTRUCT = STEEL_RHO*STEEL_CP*ROOM_PLATE*ROOM_A_DECK;        // kJ/K
const ROOM_CSTRUCT_F = STEEL_RHO*STEEL_CP*ROOM_PLATE*HULL_FACE_A;      // kJ/K per outward face
const ROOM_GSTRUCT = ROOM_H*ROOM_A_DECK/1000;                          // kW/K
const ROOM_GSTRUCT_F = ROOM_H*HULL_FACE_A/1000;                        // kW/K per outward face
// kW/K, one cell of hot surface
const ROOM_HK = ROOM_H*MPC*MPC/1000;
/* kg of compartment air per second one ventilation SET moves, removed AT THE CELLS IT IS STANDING IN, so siting decides what it is worth. A bigger footprint buys nothing: the set is rated, not the hole it sits in. */
const ROOM_VENT_KGS = 50;
/* kg of nitrogen per second one inerting set puts in; a fraction of the fan because it is bottled gas rather than a duct to the rest of the ship. */
const INERT_KGS = 10;

/* partTemp() is what a machine CONTAINS; this is the metal between that and the air, and it is the thing that fails. On S, because a skin with no memory is not a skin. */
const ROOM_SKIN_TAU = 45;                 // s, skin against the air
const SKIN_PROC_K = 20;                   // contents-side conductance / air-side
const skinCap = n => ROOM_SKIN_TAU*n*ROOM_HK;         // kJ/K

/* Memoised on the arrangement: everything in here is a fact about where things are, never about what they are doing. */
let roomCache = null, roomSigA = null, roomSigB = null, roomSigC = null, roomCacheSeq = 0;
function roomGeom(){
  /* A wall is always a wall here, so damage is NOT in this key: roomGeomLive() opens a shot cell. */
  /* the three terms compared one at a time: joined, this key was built on every layer of every frame */
  const sA = laySig(), sB = pipeSig(), sC = matSig();
  if(roomCache && roomSigA === sA && roomSigB === sB && roomSigC === sC) return roomCache;
  return roomGeomBuild(sA, sB, sC);
}
// apart from the cached path above, because a function holding closures allocates their context on every entry
function roomGeomBuild(sA, sB, sC){
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
  /* kg/s a face passes between two open cells, per kg of the lighter side: what it carries is enthalpy, so this is not a kW/K */
  const g0 = ROOM_MIX/(MPC*MPC);
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
  roomSigA = sA; roomSigB = sB; roomSigC = sC; roomCacheSeq++;
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
  const dp = s && s.dmgParts;
  if(dp) for(let n=0;n<dp.length;n++){ const id = dp[n];
    if(typeof id !== "string" || id.indexOf("mat:") !== 0) continue;
    const j = id.indexOf(","), x = +id.slice(4,j), y = +id.slice(j+1);
    if(x>=0 && x<GW && y>=0 && y<GH && matWall(x,y)) open += "|"+x+","+y;
  }
  if(!open) return G;
  const sig = roomCacheSeq+open;
  if(roomLiveCache && roomLiveSig === sig) return roomLiveCache;
  return roomGeomLiveBuild(G, sig, open);
}
// apart, for roomGeomBuild()'s reason
function roomGeomLiveBuild(G, sig, open){
  const N = GW*GH, hole = new Uint8Array(N);
  for(const k of open.split("|")){ if(!k) continue;
    const j = k.indexOf(","); hole[(+k.slice(j+1))*GW + (+k.slice(0,j))] = 1; }
  const blk = i => hole[i] ? 1 : G.tight[i] ? 0 : (G.occ[i] ? ROOM_BLOCK : 1);
  const g0 = ROOM_MIX/(MPC*MPC);
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


/* A discharging jet ENTRAINS: ROOM_ENTRAIN*ROOM_JET_TAU over the air in one cell IS the size of the plume, and the temperature it delivers, h/(ROOM_ENTRAIN*cp), is the same for a weep and a rupture - only the volume differs. */
const ROOM_ENTRAIN = 25;                  // kg of room air per kg of discharge
const ROOM_JET_TAU = 1.0;                 // s to entrain it
const ROOM_MAIR = MPC*MPC*ROOM_DEPTH*ROOM_RHO;   // kg of air in one cell


// kJ/kg a kilogram of secondary steam is worth to the room, above ambient water
const roomSteamH = () => satHg(SAT_WATER, sgDesPSuggest()) - hOfTP(SAT_WATER, T_HULL, ROOM_P0/1000);




/* Hydrogen leaves with the escaping steam and deflagrates past the flammability limits and auto-ignition; ROOM_DEPTH sets every concentration here. */
const H2_LFL = 0.04;                      // volume fraction in air
/* A cell of nearly pure hydrogen is the SAFE one: there is no air left in it to burn. */
const H2_UFL = 0.75;
/* K, BULK autoignition of hydrogen in air: the published band is 773-858 (NFPA 497 500 C, IEC
   60079-20-1 560 C, ISO/TR 15916 585 C) and the low end is the conservative one for a stoichiometric
   mixture at 1 atm. A small HOT SURFACE is a different and higher threshold - the gas next to it is only
   there briefly - and the measured band is 1000-1170 K (Mevel, Melguizo-Gavilanes, Boeck & Shepherd,
   Int. J. Heat Fluid Flow 2019, 9.3 x 5.1 mm SS316 glow plug; Morreale et al., WHEC 2010, 1033 K on a
   steel coil; Tamm et al. 1987 via NUREG/CR-6530, 1050 K turbulent / 1123 K quiescent in 50 mol% steam).
   The threshold moves 128 K on cylinder orientation alone and up to 50 K on surface chemistry, so it is
   not one constant; 1050 K is the middle of the band that three independent sources agree on. */
const H2_IGN = 773;                       // K, band bottom kept: a room cell is a large volume, and the low end is the conservative one
const H2_IGN_SURF = 1050;                 // K
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

/* The gas in a cell is air, water vapour and hydrogen, and its heat capacity is the mass of each times
   that species' own c_p(T). NIST WebBook Shomate rows, [Thi, A..H] per range, c_p J/mol/K at t = T/1000;
   shoCpA() (pipenet.js) is the evaluator and the one polynomial. NIST has no row for air, because air is
   a mixture: c_p,air is mass-weighted over N2, O2, Ar and CO2 at dry-air composition, which is how the
   published air tables are built, so it is the law and not a fit. */
const AIR_MIX = [
  [0.7553, {mmol:0.0280134, sho:[500, 28.98641, 1.853978, -9.647459, 16.63537, 0.000117, -8.671914, 226.4168, 0,
                                2000, 19.50583, 19.88705, -8.598535, 1.369784, 0.527601, -4.935202, 212.3900, 0,
                                6000, 35.51872, 1.128728, -0.196103, 0.014662, -4.553760, -18.97091, 224.9810, 0]}],
  [0.2315, {mmol:0.0319988, sho:[700, 31.32234, -20.23531, 57.86644, -36.50624, -0.007374, -8.903471, 246.7945, 0,
                                2000, 30.03235, 8.772972, -3.988133, 0.788313, -0.741599, -11.32468, 236.1663, 0,
                                6000, 20.91111, 10.72071, -2.020498, 0.146449, 9.245722, 5.337651, 237.6185, 0]}],
  [0.0129, {mmol:0.039948, sho:[6000, 20.78600, 2.825911e-7, -1.464191e-7, 1.092131e-8, -3.661371e-8, -6.197350, 179.9990, 0]}],
  [0.0005, {mmol:0.0440095, sho:[1200, 24.99735, 55.18696, -33.69137, 7.948387, -0.136638, -403.6075, 228.2431, -393.5224,
                                6000, 58.16639, 2.720074, -0.492289, 0.038844, -6.447293, -425.9186, 263.6125, -393.5224]}],
];
const VAP_SHO = {mmol:H2O_MMOL, sho:[1700, 30.09200, 6.832514, 6.793435, -2.534480, 0.082139, -250.8810, 223.3967, -241.8264,
                                     6000, 41.96426, 8.622053, -1.499780, 0.098119, -11.15764, -272.1797, 219.7809, -241.8264]};
const H2_SHO = {mmol:H2_MMOL, sho:[1000, 33.066178, -11.363417, 11.432816, -2.772874, -0.158558, -9.980797, 172.707974, 0,
                                   2500, 18.563083, 12.257357, -2.859786, 0.268238, 1.977990, -1.147438, 156.288133, 0,
                                   6000, 43.413560, -4.293079, 1.272428, -0.096876, -20.533862, -38.515158, 162.081354, 0]};
/* K, the ends of the fits. Outside them c_p is held at the end value: past 6000 K the hydrogen row's own
   polynomial turns c_p negative, and below 298 K its E/t^2 term runs away from the real gas. An extrapolation guard, not a fit. */
const SHO_TLO = 298.15, SHO_THI = 6000;
const RGAS_U = 8.314462618;               // J/mol/K, CODATA
// kJ/kg/K, R/M per species; air's M is the mixture's own, which is AIR_MMOL
const ROOM_SP_R = [RGAS_U/AIR_MMOL/1000, RGAS_U/H2O_MMOL/1000, RGAS_U/H2_MMOL/1000];
const ROOM_SP_AIR = 0, ROOM_SP_VAP = 1, ROOM_SP_H2 = 2;
/* c_p kJ/kg/K and u kJ/kg on one uniform grid, so the tick interpolates instead of walking four Shomate
   ranges per cell. u is the trapezoid integral of the SAME linear interpolant, so du/dT is exactly the
   c_p the lookup answers, and the datum is u(T_SPACE) = 0. Grid step from the accuracy check in
   tests/physics/roomgas.js, which compares the interpolant against shoCpA directly. */
const ROOM_CPT0 = T_SPACE, ROOM_CPDT = (SHO_TLO - T_SPACE)/30;
const ROOM_CPN = Math.ceil((ROOM_TMAX - T_SPACE)/ROOM_CPDT) + 1;
const ROOM_CPINV = 1/ROOM_CPDT;
const ROOM_CPTAB = new Float64Array(ROOM_CPN*3), ROOM_UTAB = new Float64Array(ROOM_CPN*3);
{ const io = new Float64Array(2);
  const raw = (s, T) => { io[0] = T < SHO_TLO ? SHO_TLO : T > SHO_THI ? SHO_THI : T;
    if(s === ROOM_SP_VAP){ shoCpA(VAP_SHO, io, 0, 1); return io[1]; }
    if(s === ROOM_SP_H2){ shoCpA(H2_SHO, io, 0, 1); return io[1]; }
    let v = 0; for(const [w, c] of AIR_MIX){ shoCpA(c, io, 0, 1); v += w*io[1]; } return v; };
  for(let s=0;s<3;s++){ const o = s*ROOM_CPN;
    ROOM_CPTAB[o] = raw(s, ROOM_CPT0);
    let u = 0;
    for(let k=1;k<ROOM_CPN;k++){ const c = raw(s, ROOM_CPT0 + k*ROOM_CPDT);
      ROOM_CPTAB[o+k] = c;
      u += ((ROOM_CPTAB[o+k-1] + c)/2 - ROOM_SP_R[s])*ROOM_CPDT;
      ROOM_UTAB[o+k] = u; } } }
/* io[k] = T in; io[o] = c_p kJ/kg/K, io[o+1] = u kJ/kg of species s */
function roomSpA(s, io, k, o){
  const x = (io[k] - ROOM_CPT0)*ROOM_CPINV;
  let j = x|0; if(j < 0) j = 0; else if(j > ROOM_CPN - 2) j = ROOM_CPN - 2;
  const b = x - j, p = s*ROOM_CPN + j, c0 = ROOM_CPTAB[p], c1 = ROOM_CPTAB[p+1];
  io[o] = c0 + (c1 - c0)*b;
  io[o+1] = ROOM_UTAB[p] + ((c0 - ROOM_SP_R[s]) + (c1 - c0)*b/2)*b*ROOM_CPDT;
}
const ROOM_SPIO = new Float64Array(3);
const roomSpCp = (s, T) => { ROOM_SPIO[2] = T; roomSpA(s, ROOM_SPIO, 2, 0); return ROOM_SPIO[0]; };
// dry air at the temperature the ship was built at: the one gamma the quasi-static lag is timed on
const GAM_AIR = roomSpCp(ROOM_SP_AIR, T_HULL)/(roomSpCp(ROOM_SP_AIR, T_HULL) - ROOM_SP_R[0]);

/* Laminar burning velocity m/s against hydrogen fraction: a limit mixture takes about nine seconds to cross one MPC cell and a stoichiometric one a sixth of a second. */
const H2_SL = [[0.04,0.05],[0.10,0.40],[0.20,1.30],[0.30,2.60],
               [0.40,3.00],[0.60,1.60],[0.75,0.30]];
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
const leanCapK = (x, y, max) => { const m = Math.sqrt(x*x + y*y);
  return m > 0 ? max*Math.tanh(m/max)/m : 1; };
/* The BLAST tool's charge, tools/wavemock.html's: a Gaussian BLAST_SIG cells wide peaking at kPa, into
   open air on the charge's own side of every intact wall, as the heat that raises it - a charge is a burn. One cell is a grid-scale source and rings as a checkerboard (17-27 % of lit cells). */
const BLAST_SIG = 2.4;

/* The linear solve knows no vacuum: behind a strong front it drives a cell below zero, and clamping that creates gas. So a cell's OUTFLOW is cut to what it holds plus what it is given this tick - the NET, never the gross: a face passes many times a small cell's content in a tick (a choked hole off a few MPa moves a quarter of a tonne), and capping the gross stops the through-flow and piles the inflow without bound. The inflow counted is after its own donors' cuts, so it is iterated. With `cap`, a cell's INFLOW is cut the same way to the room it has plus what it passes on, so a liquid never lands past a cell's cap.
   The tail grows its factors from the always-safe start, so every iterate is already feasible and any stopping point conserves exactly. This count buys back chained through-flow - a chain longer than it passes less than the solve asked for - and is not a correctness parameter. */
const FACE_TAIL = 16;
/* Species ride the face kilograms as a mass fraction, upwind and IMPLICIT: what leaves a cell is what it holds once this tick's inflow has mixed in, so gas passing through a cell smaller than the tick's flow carries the upstream share instead of piling its own. Symmetric Gauss-Seidel sweeps of that mixing, so a chain of through-flow in either direction settles in a pair; each update is a convex blend, so every share stays in [0, 1] and a species never outweighs its gas. `inn` is faceInflow() of the same faces. */
const ADV_SWEEPS = 4;

/* The front burns into the UNBURNT share (1 - roomFlame), never the cell average, or a cell dilutes itself below the limit halfway through its own passage. Floored, because the last sliver is arithmetically pure hydrogen and would quench on the RICH limit rather than run out. */
const ROOM_FR_MIN = 0.1;

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
const fireCp  = () => { const a = fireCool(); return a ? coolFig(a).cp : 1; };
const fireRho = () => { const a = fireCool(); return a ? coolFig(a).rho : 1000; };
/* Bought: a liquid metal running out over steel stops at a few millimetres, and this is the only thing keeping a gram from burning over a whole cell. */
const POOL_DMIN = 0.01;                   // metres
/* The water on the floor carries s.roomWaterE, datum liquid at H_DATUM; the metal carries s.roomPoolE. */
const WATER_RHO = 1000;                   // kg/m3
function zFloorA(i, io, o){ io[o] = (GH-1-((i/GW)|0))*MPC; }
const ZF_IO = new Float64Array(1);
const zFloor = i => { zFloorA(i, ZF_IO, 0); return ZF_IO[0]; };
// metres of liquid standing in the cell; one cell full is MPC
const liqFill = (M, rho, i) => M[i]/(rho*MPC*ROOM_DEPTH);
// share of a cell under which it holds no gas: the grid's resolution, a finer pocket rises as a bubble (eGasDisplace)
const ROOM_VG_MIN = 0.01;
/* Only paint is a floor, a gas-tight wall or shielding; a machine box is open frame to a liquid, and a CATCH PAN's only way out is its own drain line (panDrain()). */
const liqShut = (G, j) => !(G.hole && G.hole[j]) && (G.tight[j] || (G.occ[j] && G.own[j] < 0));
const liqRuns = (G, i, j) => !liqShut(G, j) && !(G.pan[i] && !G.pan[j]);
// a liquid and the one it shares the cell with, which takes that much of the cell's room
// U is the liquid under this one in a cell: the metal floats on the water, the water ignores the metal
// the bundle is a view onto s's own arrays, stable for s's whole life; one per s, not one per cell
let liqWaterC = null, liqWaterFor = null;
const liqWater = s => liqWaterFor === s ? liqWaterC : (liqWaterFor = s,
  liqWaterC = {M:s.roomWater, E:s.roomWaterE, rho:WATER_RHO, bulk:WATER_BULK, vu:s.roomWU, vv:s.roomWV, P:s.roomWP, O:s.roomPool, oRho:fireRho(), U:null, tag:"water"});
let liqMetalC = null, liqMetalFor = null;
const liqMetal = s => liqMetalFor === s ? liqMetalC : (liqMetalFor = s,
  liqMetalC = {M:s.roomPool, E:s.roomPoolE, rho:fireRho(), bulk:fireCool().bulk, vu:s.roomPoolU, vv:s.roomPoolV, P:s.roomPoolP, O:s.roomWater, oRho:WATER_RHO, U:s.roomWater, tag:"metal"});
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
// passes a liquid solve may take to agree with the gas it squeezes
const LIQ_GAS_IT = 6;
// m/s the liquid in a cell is moving, the fastest of its four faces
const liqSpeed = (q, i) => { const X = i%GW; let v = 0;
  if(X < GW-1) v = Math.max(v, Math.abs(q.vu[i]));
  if(X > 0) v = Math.max(v, Math.abs(q.vu[i-1]));
  if(i < GW*GH-GW) v = Math.max(v, Math.abs(q.vv[i]));
  if(i >= GW) v = Math.max(v, Math.abs(q.vv[i-GW]));
  return v; };
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
// the same three tests the burn takes, so a cell cannot draw cold and burn
const roomPoolLit = (s,i) => { const f = fireRow();
  return s.roomPool[i] > 0 && (i < GW || !(s.roomPool[i-GW] > 0))
      && roomPoolT(s,i) >= f.ign && roomO2Frac(s,i) >= f.loc; };
/* The bund is liqShut()'s; this is the drain, into a sealed tank the board does not draw, water first because it is on the bottom. The metal was booked out at the opening it left through; the water was booked back onto the ship when it landed, so it goes back off here. A wrecked pan is still a bund and drains nothing. */
const PAN_DRAIN_KGS = 20;                 // kg/s one pan's drain line passes




/* Per cell: the steam cannot exceed its saturation pressure at the cell's own temperature, and what will not stay a gas lands on that cell's floor as water. Instant, because any lag would be a fitted number standing in for an undrawn surface. It was booked out of the plant at the opening, so landing it comes back onto the held side against a negative `sump` line. */
const R_VAP = 0.0004615;                  // MPa*m3/(kg*K)

/* kPa·cells over the static (roomPStatic()) on the open-air cell outside each face cell, times the
   face's inward normal; the renderer's lean asks here, and `lit` is the most `w` reaches on those cells. */
// one register, read and dropped: the lean asks it per part per frame
const PART_LOAD = {fx:0, fy:0, lit:0};
const partLoadAt = (P, G, gz, w, X, Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return 0; const i = Y*GW+X;
  if(G.occ[i] || G.tight[i]) return 0;
  if(w[i] > PART_LOAD.lit) PART_LOAD.lit = w[i];
  return P[i] - gz[i]; };
function partLoad(s, p, gz, G, w){
  G = G || roomGeom();
  const P = s.roomP;
  PART_LOAD.lit = 0;
  let fx = 0, fy = 0;
  for(let j=0;j<p.h;j++) fx += partLoadAt(P,G,gz,w,p.x-1,p.y+j) - partLoadAt(P,G,gz,w,p.x+p.w,p.y+j);
  for(let j=0;j<p.w;j++) fy += partLoadAt(P,G,gz,w,p.x+j,p.y-1) - partLoadAt(P,G,gz,w,p.x+j,p.y+p.h);
  PART_LOAD.fx = fx; PART_LOAD.fy = fy;
  return PART_LOAD;
}
// cells per unit load; a bigger box is a heavier one and leans less
const partLeanK = p => LEAN_K/(10*3)*(6*3)/(p.w*p.h);
/* Moles of everything in a cell that is not hydrogen, off the cell's OWN gas: a pressurised cell holds more air, so the same hydrogen is a smaller fraction of it, and a cell full of steam is inert by arithmetic. */
const roomMolX = (s,i) => Math.max(0, s.roomM[i] - s.roomH2[i] - s.roomVap[i])/AIR_MMOL + s.roomVap[i]/H2O_MMOL;
// off the SAME denominator, so a rich cell is oxygen-poor by arithmetic rather than a second rule
const roomO2Frac = (s,i) => s.roomO2[i]/O2_MMOL/Math.max(1e-9, roomMolX(s,i) + s.roomH2[i]/H2_MMOL);
