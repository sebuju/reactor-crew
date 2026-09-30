"use strict";
/* Room contents as particles, a mockup set beside the cell grid in fluidbench. Water is coarse position-based SPH
   (Clavet, Beaudoin and Poulin 2005, double density relaxation); steam, hydrogen and heat are parcels that rise, draw in
   air as they go, crowd under a ceiling and ride the door jets. The air is lumped: one charge, temperature and pressure per
   gas pocket, cut at doors. The paint draws smooth fields off the particles, never a dot. */
// a door is a short gap in a thin wall line; a corridor between two thick walls is not one. 1 = passes sideways, 2 = up and down
function roomDoors(d, W, H, isW, max){
  d.fill(0);
  for(let x=0;x<W;x++) for(let y=0;y<H;){
    if(isW(x, y)){ y++; continue; }
    let e = y; while(!isW(x, e+1)) e++;
    if(y > 0 && e < H-1 && e-y < max && ((!isW(x-1, y-1) && !isW(x+1, y-1)) || (!isW(x-1, e+1) && !isW(x+1, e+1))))
      for(let k=y;k<=e;k++) d[k*W+x] = 1;
    y = e+1;
  }
  for(let y=0;y<H;y++) for(let x=0;x<W;){
    if(isW(x, y)){ x++; continue; }
    let e = x; while(!isW(e+1, y)) e++;
    if(x > 0 && e < W-1 && e-x < max && ((!isW(x-1, y-1) && !isW(x-1, y+1)) || (!isW(e+1, y-1) && !isW(e+1, y+1))))
      for(let k=x;k<=e;k++) if(!d[y*W+k]) d[y*W+k] = 2;
    x = e+1;
  }
}
// 4-connected fill from i0: a cell j that ok(j, i) lets in from its neighbour i takes id
function gridFlood(W, H, lab, stack, i0, id, ok){
  let sp = 0; stack[sp++] = i0; lab[i0] = id;
  while(sp){ const i = stack[--sp], x = i%W, y = (i/W)|0;
    if(x > 0 && lab[i-1] < 0 && ok(i-1, i)){ lab[i-1] = id; stack[sp++] = i-1; }
    if(x < W-1 && lab[i+1] < 0 && ok(i+1, i)){ lab[i+1] = id; stack[sp++] = i+1; }
    if(y > 0 && lab[i-W] < 0 && ok(i-W, i)){ lab[i-W] = id; stack[sp++] = i-W; }
    if(y < H-1 && lab[i+W] < 0 && ok(i+W, i)){ lab[i+W] = id; stack[sp++] = i+W; } }
}
// laminar burning velocity of hydrogen in air at volume fraction io[k], off the H2_SL table, into io[o]
function h2SlA(io, k, o){ const x = io[k]; io[o] = 0;
  if(x <= H2_SL[0][0] || x >= H2_SL[H2_SL.length-1][0]) return;
  for(let j=1;j<H2_SL.length;j++) if(x <= H2_SL[j][0]){ const a = H2_SL[j-1], b = H2_SL[j]; io[o] = a[1] + (b[1]-a[1])*(x-a[0])/(b[0]-a[0]); return; }
}
const PART = (() => {
const G = 9.80665, T0 = 273.15, RU = 8.314462618, CW = 4190, LV = 2.257e6, RHO_W = 1000, GAM = 1.4, CP_AIR = 1005, QH2 = H2_LHV*1000, QCO = CO_LHV*1000;
const MX_O = O2_MMOL, MX_N = (AIR_MMOL - O2_FRAC0*O2_MMOL)/(1 - O2_FRAC0), CV_N = 20.8, CV_O = 21.1, CV_H = 20.4, CV_V = 25.3;
const KW = 1, KV = 2, KH = 3, KQ = 4, KM = 5, KX = 6, KC = 7, KD = 8, KS = 9;
// the classes a kind's code is asked for: a liquid, a fuel
const LQ = Uint8Array.of(0, 1, 0, 0, 0, 1, 1, 0, 0, 0), FU = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0);
const liq = k => LQ[k] === 1, fuel = k => FU[k] === 1;
const MAXP = 12000, EPS = 1e-3, MAXSRC = 32;
const DOOR_MAX = 4;
const PVMAX = 9, RMAX = Math.sqrt(PVMAX/Math.PI);
// not physics, a game rule: hydrogen burns at any mix while its pocket has oxygen, never slower than a 10 % mix's laminar speed
const SL_MIN = 0.4;
// a burning parcel keeps e^-age of its hydrogen: at 1 % left the rest goes at once and the flame is out
const BURN_OUT = Math.log(100);
// a shoved particle glows like a cooling ember as it slows: orange at GLOW_FULL m/s, red, then black, gone below GLOW_OFF m/s
const GLOW_FULL = 10, GLOW_OFF = 1;
/* the knobs: [key, group, label, min, max, step, default, clears]; the ranges are the ones the water stays water across.
   mix: a rising thermal widens by a fraction of the height it climbs (Scorer 1957 has a quarter in 3D; a slab of cells
   dilutes faster, so the default is lower) */
// water a metre across does not bead, and a pull on a particle short of neighbours kept a pool at rest stirring: it is off by default.
// The gains are per substep and were tuned at 3; they hold from 1 to 9 particles a cell where no other count does
const KNOBS = [
  ["ppc",   "WATER", "particles per cell in a gap", 2,  9,    1,     4,    true],
  ["open",  "WATER", "cells per particle in open water", 0.25, 4, 0.25, 0.25, true],
  ["stiff", "WATER", "stiffness",                 0.1,  1,    0.05,  0.25],
  ["near",  "WATER", "near push",                 0.1,  1,    0.05,  0.1],
  ["pull",  "WATER", "pull short of neighbours",  0,    1,    0.01,  0],
  ["visc",  "WATER", "viscosity",                 0,    20,   1,     4],
  ["vb",    "WATER", "quadratic viscosity",       0,    10,    0.05,  0.3],
  ["sub",   "WATER", "substeps per tick",         1,    6,    1,     3],
  ["dmax",  "WATER", "max move per substep cells", 0.1, 1,    0.05,  0.45],
  ["vcap",  "WATER", "max water speed m/s",       2,    40,   1,     15],
  ["wpull", "WATER", "walls pull water (0/1)",    0,    1,    1,     0],
  ["spr",   "WATER", "mass spread radius cells",  0.5,  1.5,  0.05,  0.75],
  ["split", "WATER", "split above x target mass", 1.3,  2.5,  0.1,   1.6],
  ["join",  "WATER", "join below x target mass",  0.3,  0.75, 0.05,  0.6],
  ["jcap",  "WATER", "joined mass cap x target",  1,    1.5,  0.05,  1.25],
  ["grav",  "WATER", "gravity x",                 0.75, 10,    0.25,  1],
  // not physics, a game rule: a particle cannot thin to the film a real spill stops in, so at 1 (Darcy) a lone one slides for minutes
  ["fric",  "WATER", "wall friction x (1 = Darcy)", 1,  300,  1,     100],
  ["rise",  "GAS",   "buoyancy response 1/s",     0.5,  10,   0.5,   3],
  ["turb",  "GAS",   "turbulence",                0,    200,  10,    60],
  ["mix",   "GAS",   "mixing while rising",       0,    0.4,  0.025, 0.15],
  ["diff",  "GAS",   "diffusion cells2/s",        0,    0.2,  0.01,  0.02],
  ["crowd", "GAS",   "crowding",                  0,    0.05, 0.005, 0.01],
  ["cond",  "GAS",   "condensation 1/s",          0,    1,    0.025, 0.3],
  ["emit",  "GAS",   "puffs per second",          5,    60,   5,     25],
  ["fgas",  "GAS",   "gas below water fill",      0.3,  0.9,  0.05,  0.6],
  ["cd",    "GAS",   "door discharge coefficient", 0.3, 1,    0.05,  0.6],
  ["hwall", "GAS",   "wall heat transfer W/m2K",  0,    50,   1,     5],
  ["vmin",  "GAS",   "steam lot kg",              0.05, 1,    0.05,  0.2],
  ["blob",  "PAINT", "water blob size",           1.2,  2.4,  0.1,   1.8],
  ["merge", "PAINT", "water merge level",         0.15, 0.6,  0.05,  0.15],
  ["wline", "PAINT", "water surface line px",     0,    3,    0.5,   1],
  ["wpix",  "PAINT", "water pixel art blocks per cell (0 = smooth)", 0, 16, 1, 0],
  ["wsoft", "PAINT", "water edge softness px",    0,    8,    0.5,   0],
  ["wsmooth","PAINT","water edge smoothing passes", 0,  4,    1,     0],
  ["wop",   "PAINT", "water opacity",             0.3,  1,    0.05,  0.85],
  ["foam",  "PAINT", "foam at speed m/s",         1,    10,   0.5,   5],
  ["fdepth","PAINT", "foam depth under surface cells", 0.25, 3, 0.25, 1],
  ["wdark", "PAINT", "water darkens over depth cells (0 = off)", 0, 20, 1, 20],
  ["fhit",  "PAINT", "foam from a hit, m/s lost", 0.5,  10,   0.5,   2],
  ["flife", "PAINT", "foam fade time s",          0.1,  5,    0.1,   1.5],
  ["spray", "PAINT", "spray drops per hit (0 = off)", 0, 32,   1,     16],
  ["sprayv","PAINT", "spray speed x hit speed",   0.1,  2,    0.05,  1],
  ["sdrop", "PAINT", "spray drop radius cells",   0.05, 0.5,  0.05,  0.15],
  ["dstr",  "PAINT", "flying drop stretch per m/s (0 = round)", 0, 0.5, 0.01, 0.15],
  ["bub",   "PAINT", "bubbles per s from full foam (0 = off)", 0, 20, 1, 4],  ["gblur", "PAINT", "gas blur cells",            0.3,  3,    0.1,   1.2],
  ["gop",   "PAINT", "gas opacity x",             0.25, 2,    0.25,  1],
  ["wpx",   "PAINT", "water pixels per cell",     3,    6,    3,     3],
  ["hs",    "PAINT", "heat shimmer px per 100 K", 0,    20,   0.5,   4],
  ["hsc",   "PAINT", "heat shimmer scale cells",  0.25, 4,    0.25,  1],
  ["hsv",   "PAINT", "heat shimmer rise cells/s", 0,    5,    0.25,  1],
  // of the order of sodium-fire aerosol in the ABCOVE tests (not read)
  ["sd",    "CHEM",  "smoke particle diameter um", 0.5, 50,   0.5,   2],
  ["decay", "CHEM",  "corium decay heat, share of rated", 0, 0.05, 0.001, 0.01],
];
// built whole: filled key by key it fell into dictionary mode, and every knob read in a pair loop was a hash lookup
const K = Object.fromEntries(KNOBS.map(r => [r[0], r[6]]));
const L = {wclamp:0, swap:1, pcgIt:0, pcgN:0, pcgSum:0, pcgMax:0, pdrop:0, npair:0, nstraight:0, ncand:0, nflag:0, pbuilt:false, ready:false, t:0, tick:0, inj:null, hot:-1, np:0, npk:0, nlive:0, nb:0, nj:0, inKg:0, nsplit:0, njoin:0, nref:0, jref:0, njq:0, audit:false, aerr:new Float64Array(4)};
let W = 0, H = 0, N = 0, MW0 = 0, S0 = 1, HK0 = 1, HTOP = 1, SKIN = 0.3, LMAX = 0, RHO0 = 0, RN0 = 0, nRoom = 0;
const Vc = MPC*MPC*ROOM_DEPTH, Af = ROOM_A_FACE, P0 = ROOM_P0*1000, N0 = P0*Vc/(RU*T_HULL);
let px, py, qx, qy, mvA, wdA, vx, vy, ox, oy, pm, pT, pE, pv, pr, pd, pf, ph, pl, pw, pmu, kind, burn, age, pq, sg, cS, cCur, cP, pcel, pfo, sp0, pst, psx, psy;
let lv, mtC, ax, jst, pass = 0, DV = 0, SV, tagA, tagB, nearW, nearF, wtO, wtT, dist, que, TN, TO, WT0, WT1, WTX1, spC, spW, spX, spY, dnA, prP, prE, prQ, prBX, prBY, cA, cB, kfA, kfB, pbX, pbY, cvx, nearV, near2, cvn, wsA, jnQ, jnD;
let wall, wSat, bubX, bubN, bkA, nWall, wall9, room, isDoor, fill, pc, bd, bRef, bTop, nN, nO, eA, cond, condE, vAcc, vAT, bq, pk, jetX, jetY, stack;
let bW, bWE, bV, bH, bHv, bQT, bF;
// the wall shear's sums per half cell (2c + the half nearer the high face) and per face, and each wall cell's roughness m
let fM, fV, fPp, fPn, fU, fD, fS, tA, tB, rgh;
// pvf: a liquid particle's volume over the water it would be at its mass, exactly 1 for water; the cargo each particle carries
let pvf, pFp, pSo, pMr, pCF, pCK, pCZ, pCS, pCX, pDw, frz, pFci, pSrc;
// gwall: the gas map, where a machine block is open frame; lfill: the cell's volume share of every liquid
let gwall, gone, lfill, hotC, hotL, bM, bME, bXm, bXT, bLV, bFp, nFpN, nFpV, dep, abl, crust, condFp, condSo, gAcc, gAT, bC, bD, bS;
let mach, pan, vent, inert, catc, conc, catWet, kFN, kFV, vfC, crC, vTk, vphi, vsrc, vnX, vnY, kQv, cBase, cTop, cM, cE, cR, cWm, cWo, cSo, cF, cK, cZ, cSt, cX, cT, cdZ, cdK, cdS, cdX, cdE, fciQ;
let rG, rL, rAir, rC, gF, gFl, rSg, rVol, rLq, kRm, kCell, kV, kVg, rPk, kN, kO, kE, kT, kP, kA, kQ, kS, kNP, kC, kPE, kM, kLv, kPv;
let jCa, jCb, jAxis, jArea, jU, jC0, jCells;
// the solver's system and scratch, a cell each
let sM, sAx, sAy, sDg, sB, cgR, cgZ, cgS, cgQ, cgE;
// the swap's per particle rise credit cells, candidate above, its distance squared, partner this substep, swapped flag; the paint's offset
// cells from where a swap put it and the speed cells/s it closes at, never read by the physics
let swC, swB, swD, swP, swF, sdx, sdy, sdv;
// floats that outlive a call or cross one live in arrays: a let boxed each write, and an argument boxed wherever the call did not inline
const HM = new Float64Array(1);   // the largest water kernel
const LIQ = new Uint8Array(1), GFN = new Int32Array(1), STR = new Uint8Array(1);   // any liquid on the board; forced gas cells listed; air left off every pocket
// the source table, a row a source and row 0 inject()'s; rRem holds what each row keeps under one particle: water, vapour, hydrogen, heat, metal, corium, CO, CO2
const S_FLUID = 1, S_HEAT = 2, S_H2 = 3, S_STEAM = 4, S_O2 = 5, S_GAS = 6, S_BREAK = 7, S_METAL = 8, S_COR = 9, S_CO = 10, S_CO2 = 11, S_FP = 12;
const SK = {fluid:S_FLUID, heat:S_HEAT, h2:S_H2, steam:S_STEAM, o2:S_O2, gas:S_GAS, break:S_BREAK, metal:S_METAL, corium:S_COR, co:S_CO, co2:S_CO2, fp:S_FP};
const rOn = new Uint8Array(MAXSRC), rKd = new Uint8Array(MAXSRC), rMr = new Uint8Array(MAXSRC), rDch = new Uint8Array(MAXSRC), rCl = new Int32Array(MAXSRC);
const rRt = new Float64Array(MAXSRC), rTk = new Float64Array(MAXSRC), rUj = new Float64Array(MAXSRC), rVj = new Float64Array(MAXSRC);
const rH = new Float64Array(MAXSRC), rFN = new Float64Array(MAXSRC), rFV = new Float64Array(MAXSRC);
const rDp = new Float64Array(MAXSRC), rBo = new Float64Array(MAXSRC), rDw = new Float64Array(MAXSRC), rPv = new Float64Array(MAXSRC);
const rTot = new Float64Array(MAXSRC), rDone = new Float64Array(MAXSRC), rCm = new Float64Array(5*MAXSRC), rRem = new Float64Array(8*MAXSRC), rP = new Int32Array(MAXSRC).fill(-1);
const HOT = new Int32Array(4);    // how many cells hotL lists; an FCI charge waiting; a gas lot waiting; fission products in the air
const HAS = new Uint8Array(10);   // the kinds the last bin() saw or spawn() made since, and at 0 fission products in water
const PN = new Int32Array(6);     // parts: any, gas sets (vents and inerting), vents OUT, machines, pans, catchers
const N2_MMOL = 0.0280134, NAOH_PER_NA = 39.997/22.990;   // kg/mol N2; kg NaOH a kg of Na makes, 2 Na + 2 H2O -> 2 NaOH + H2 (IUPAC masses)
// h_f at p MPa, kJ/kg: a break states its circuit's pressure and no enthalpy when its water is saturated
const hfAt = p => { FL[0] = p; satHA(SAT_WATER, FL, 0, 3); return FL[3]; };
// the books of what left the board or changed form, kg or J
const B_RELN = 0, B_RELV = 1, B_RELG = 2, B_RELS = 3, B_DRW = 4, B_DRM = 5, B_DRFP = 6, B_DRSO = 7, B_COROUT = 8, B_COROUTE = 9, B_INERT = 10, B_VENTIN = 11,
  B_NAAIR = 12, B_NAWAT = 13, B_DECAY = 14, B_SMOKE = 15, B_H2MADE = 16, B_ABLKG = 17, B_CHEMQ = 18, B_FCIQ = 19, B_DCHQ = 20, B_FLOOD = 21, B_SPRAY = 22, B_RELQ = 23, B_METIN = 24, B_CORIN = 25, B_CORINE = 26, B_ABLQ = 27,
  B_INF = 28, B_INK = 29, B_INZ = 30, B_INS = 31, B_INX = 32, B_OUTF = 33, B_OUTK = 34, B_OUTZ = 35, B_OUTS = 36, B_OUTX = 37, B_SKINQ = 38,
  B_BRKV = 39, B_BRKW = 40, B_QDOWN = 41, B_QUP = 42, B_ABLV = 43, B_ABLH = 44, B_ABLC = 45, B_ABLD = 46, B_ABLFE = 47, B_FRQ = 48, B_NB = 49;
const BK = new Float64Array(B_NB);
const BI = {RELN:B_RELN, RELV:B_RELV, RELG:B_RELG, RELS:B_RELS, DRW:B_DRW, DRM:B_DRM, DRFP:B_DRFP, DRSO:B_DRSO, COROUT:B_COROUT, COROUTE:B_COROUTE,
  INERT:B_INERT, VENTIN:B_VENTIN, NAAIR:B_NAAIR, NAWAT:B_NAWAT, DECAY:B_DECAY, SMOKE:B_SMOKE, H2MADE:B_H2MADE, ABLKG:B_ABLKG, CHEMQ:B_CHEMQ, FCIQ:B_FCIQ,
  DCHQ:B_DCHQ, FLOOD:B_FLOOD, SPRAY:B_SPRAY, RELQ:B_RELQ, METIN:B_METIN, CORIN:B_CORIN, CORINE:B_CORINE, ABLQ:B_ABLQ, INF:B_INF, INK:B_INK, INZ:B_INZ,
  INS:B_INS, INX:B_INX, OUTF:B_OUTF, OUTK:B_OUTK, OUTZ:B_OUTZ, OUTS:B_OUTS, OUTX:B_OUTX, SKINQ:B_SKINQ, BRKV:B_BRKV, BRKW:B_BRKW, QDOWN:B_QDOWN, QUP:B_QUP,
  ABLV:B_ABLV, ABLH:B_ABLH, ABLC:B_ABLC, ABLD:B_ABLD, ABLFE:B_ABLFE, FRQ:B_FRQ};
// the gas lots a reaction makes and a cell holds until one is worth a parcel: hydrogen, CO, CO2, smoke
const NG = 4, GK = Uint8Array.of(KH, KC, KD, KS);
// the bench parts: 1 machine, 2 pan, 3 vent, 4 inerting set, 5 core catcher
const MAXPART = 64, PK_OF = {machine:1, pan:2, vent:3, inert:4, catcher:5};
const paK = new Uint8Array(MAXPART), paDir = new Uint8Array(MAXPART), paN = new Int32Array(MAXPART);
const paQ = new Float64Array(MAXPART), paB = new Float64Array(MAXPART), paT = new Float64Array(MAXPART), paSk = new Float64Array(MAXPART), paSac = new Float64Array(MAXPART), paFe = new Float64Array(MAXPART), paWa = new Float64Array(MAXPART);
let PARTS = [];
// kg/mol and J/mol/K at constant volume per kind code; CO and CO2 off the NIST Shomate rows room.js carries, at 298.15 K
const IM = Float64Array.of(0, 0, H2O_MMOL, H2_MMOL, 0, 0, 0, CO_MMOL, CO2_MMOL, 0);
const CVK = Float64Array.of(0, 0, CV_V, CV_H, 0, 0, 0, roomSpCp(ROOM_SP_CO, 298.15)*CO_MMOL*1000 - RU, roomSpCp(ROOM_SP_CO2, 298.15)*CO2_MMOL*1000 - RU, 0);
// Na2O2 kg/m3, and dry air's viscosity at T_HULL on Sutherland's law (C 110.4 K, 1.458e-6 Pa s K^-1/2)
const RHO_SM = 2805, MU_AIR = 1.458e-6*Math.pow(T_HULL, 1.5)/(T_HULL + 110.4);
// a face with no MAT row (a machine skin, a pan or catcher floor, the board's edge) is steel
const EPS_ST = matRow("steel").rough;
const RS = new Int32Array(1);     // the dice
const DT = new Float64Array(2);   // the tick's dt and the substep's
let TAP = null;
const SPA = new Float64Array(6);  // spawn()'s x, y, m, T, u, v
const PVA = new Float64Array(2);  // putV()'s m, T
const BOA = new Float64Array(1);  // burnOff()'s dh
const SHV = new Float64Array(1);  // shove()'s kPa
const SPH = new Float64Array(5);  // splash()'s hit speed m/s, where (cells) and the speed its spray carries (cells/s)
// spray is paint only: it rolls its own dice, so the sim's run is the same with it on or off
const MAXS = 1024, sX = new Float64Array(MAXS), sY = new Float64Array(MAXS), sU = new Float64Array(MAXS), sV = new Float64Array(MAXS), sL = new Float64Array(MAXS), sR = new Float64Array(MAXS), SS = new Int32Array(3);
const MAXB = 512, bX = new Float64Array(MAXB), bY = new Float64Array(MAXB), bR = new Float64Array(MAXB), bP = new Float64Array(MAXB), bT = new Float64Array(MAXB);
const srnd = () => { let s = SS[1]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; SS[1] = s; return (s >>> 0)/4294967296; };

const rnd = () => { let s = RS[0]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; RS[0] = s; return (s >>> 0)/4294967296; };
// Math.hypot's own two-argument algorithm, bit for bit: the builtin is never inlined, so every call boxed both floats
const hyp = (a, b) => { a = Math.abs(a); b = Math.abs(b); const m = a > b ? a : b;
  if(!(m < Infinity) || a !== a || b !== b) return Math.hypot(a, b); if(m === 0) return 0; const u = a/m, v = b/m; return Math.sqrt(u*u + v*v)*m; };
// both take a cell, never a position, so no float crosses a call that may not inline: solid() of Math.floor(), cellAt() of |0
const solid = (ix, iy) => ix < 0 || iy < 0 || ix >= W || iy >= H || wall[iy*W + ix] === 1;
const gsolid = (ix, iy) => ix < 0 || iy < 0 || ix >= W || iy >= H || gwall[iy*W + ix] === 1;
const cellAt = (ix, iy) => Math.min(H-1, Math.max(0, iy))*W + Math.min(W-1, Math.max(0, ix));
const cxOf = p => Math.min(W-1, Math.max(0, px[p]|0)), cyOf = p => Math.min(H-1, Math.max(0, py[p]|0)), cellOf = p => cyOf(p)*W + cxOf(p);
const gasC = i => !gwall[i] && (lfill[i] < K.fgas || gF[i] === 1);
// the table registers: p asked and its Tsat (kept, as every particle of a body asks at one p), T and its psat, MPa, H2 fraction and its speed
const TS = new Float64Array([NaN, 0, 0, 0, 0, 0, 0]);
function tsatA(c){ const p = pAt(c); if(p !== TS[0]){ TS[0] = p; TS[4] = Math.max(2e3, p)/1e6; satTA(SAT_WATER, TS, 4, 1); } }
function psatA(p){ const t = pT[p]; if(t < 647){ TS[2] = t; curveA(SAT_WATER, CV_SP, TS, 2, 3); TS[3] *= 1e6; } else TS[3] = 1e12; }
const open = j => gasC(j) && !isDoor[j], doorGas = j => gasC(j) && isDoor[j] !== 0, wet = j => !wall[j] && pc[j] < 0;
const vgOf = i => Vc*Math.max(0.05, 1 - Math.min(1, lfill[i]));
const pAt = c => pc[c] >= 0 ? kP[pc[c]] : bd[c] >= 0 ? bRef[bd[c]] : P0;
const airT = c => pc[c] >= 0 ? kT[pc[c]] + bQT[c] : T_HULL;
const molOf = p => IM[kind[p]] > 0 ? pm[p]/IM[kind[p]] : 0;
// pv*N0 is the moles a parcel has mixed with, its own included, so squeezing or heating the pocket leaves the share alone
const xOf = p => molOf(p)/(pv[p]*N0);
const h2At = i => bH[i] > 0 ? bH[i]/H2_MMOL/(Math.max(1, bHv[i])*N0) : 0;
const rOf = p => Math.min(RMAX, Math.sqrt(pv[p]/Math.PI));
const dTOf = p => pE[p]/(1.2*CP_AIR*Vc*pv[p]);
// capped, so no pair or wall reaches past what nearW and the wall tags were cut for
const hOf = p => LQ[kind[p]] === 1 ? Math.min(HTOP, HK0*Math.sqrt(pm[p]/MW0*pvf[p])) : 0;
// hot loops read pr, pd, pf, ph, pl (log2 of the volume in fine particles) and pw (a pair's density volume factor), never the helpers: a float a call that does not inline hands back is boxed
// a liquid's viscosity Pa s at the step's starting temperature: water on Vogel's fit to IAPWS, 2.414e-5 10^(247.8/(T - 140)), sodium's one figure, corium on its UO2 melt law
function derive(){ let m = 0; for(let p=0;p<L.np;p++){ pr[p] = rOf(p); pd[p] = dTOf(p); pf[p] = xOf(p); ph[p] = hOf(p); if(ph[p] > m) m = ph[p];
  const k = kind[p]; pmu[p] = k === KW ? 2.414e-5*Math.exp(247.8*Math.LN10/(pT[p] - 140)) : k === KM ? MF[2] : k === KX ? MF[3]*Math.exp(MF[4]/pT[p]) : 0;
  pl[p] = Math.log2(pm[p]/MW0*pvf[p]); pw[p] = pm[p]/MW0*HK0*HK0*pvf[p]; } HM[0] = m; }

function build(){
  W = GW; H = GH; N = W*H;
  const F = k => new Float64Array(k), I = k => new Int32Array(k);
  px = F(MAXP); py = F(MAXP); qx = F(MAXP); qy = F(MAXP); mvA = F(2*MAXP); wdA = F(2*MAXP); vx = F(MAXP); vy = F(MAXP); ox = F(MAXP); oy = F(MAXP); pm = F(MAXP); pT = F(MAXP); pE = F(MAXP); pv = F(MAXP); pr = F(MAXP); pd = F(MAXP); pf = F(MAXP); ph = F(MAXP); pl = F(MAXP); pw = F(MAXP); pmu = F(MAXP);
  kind = new Uint8Array(MAXP); burn = new Uint8Array(MAXP); age = F(MAXP); pq = F(MAXP); sg = new Uint8Array(MAXP); cS = I(N + 1); cCur = I(N); cP = I(MAXP); pcel = I(MAXP); pfo = F(MAXP); sp0 = F(MAXP); pst = F(MAXP); psx = F(MAXP); psy = F(MAXP);
  pvf = F(MAXP); pFp = F(MAXP); pSo = F(MAXP); pMr = new Uint8Array(MAXP); pCF = F(MAXP); pCK = F(MAXP); pCZ = F(MAXP); pCS = F(MAXP); pCX = F(MAXP); pDw = F(MAXP); frz = new Uint8Array(MAXP); pFci = new Uint8Array(MAXP); pSrc = new Uint8Array(MAXP);
  wall = new Uint8Array(N); gwall = new Uint8Array(N); gone = new Uint8Array(N); nWall = new Uint8Array(N); wall9 = new Uint8Array(N); conc = F(N);
  wSat = new Int32Array((W + 1)*(H + 1)); cvx = new Uint8Array((W + 1)*(H + 1)); isDoor = new Int8Array(N); room = I(N); stack = I(N);
  mach = new Int16Array(N); pan = new Int16Array(N); vent = new Int16Array(N); inert = new Int16Array(N); catc = new Int16Array(N);
  lv = I(N); mtC = F(N); ax = new Uint8Array(N); jst = I(MAXP); tagA = I(N); tagB = I(N); nearW = new Uint8Array(N); nearF = new Uint8Array(N); near2 = new Uint8Array(N); cvn = new Uint8Array(N); dist = I(N); que = I(N); spC = I(1024); spW = F(1024); spX = F(1024); spY = F(1024); dnA = F(2*MAXP); prP = F(2*MAXP); prE = I(64*MAXP); prQ = F(96*MAXP);
  prBX = F(32*MAXP); prBY = F(32*MAXP); cA = I(32*MAXP); cB = I(32*MAXP); kfA = I(4*MAXP); kfB = I(4*MAXP); pbX = F(MAXP); pbY = F(MAXP); nearV = new Uint8Array(N); wsA = F(8*MAXP); jnQ = I(JN); jnD = F(2*JN);
  wtO = I(N); wtT = new Float32Array(N*WL*WG*WG*4);
  jCa = I(N); jCb = I(N); jAxis = new Uint8Array(N); jArea = F(N); jU = F(N); jC0 = I(N + 1); jCells = I(N);
  sM = new Uint8Array(N); sAx = F(N); sAy = F(N); sDg = F(N); sB = F(N); cgR = F(N); cgZ = F(N); cgS = F(N); cgQ = F(N); cgE = F(N);
  sdx = F(MAXP); sdy = F(MAXP); sdv = F(MAXP); swC = F(MAXP); swB = I(MAXP); swD = F(MAXP); swP = I(MAXP).fill(-1); swF = new Uint8Array(MAXP);
  lfill = F(N); hotC = new Uint8Array(N); hotL = I(N); bM = F(N); bME = F(N); bXm = F(N); bXT = F(N); bLV = F(N); bFp = F(N); nFpN = F(N); nFpV = F(N); dep = F(N);
  abl = F(N); crust = F(N); condFp = F(N); condSo = F(N); vfC = F(N); crC = new Float32Array(N); vTk = F(N); vphi = F(N); vsrc = F(N); vnX = F(N); vnY = F(N); kQv = F(N); cBase = I(N); cTop = I(N); cM = F(N); cE = F(N); cR = F(N); cWm = F(N); cWo = F(N); cSo = F(N);
  cF = F(N); cK = F(N); cZ = F(N); cSt = F(N); cX = F(N); cT = F(N); cdZ = F(N); cdK = F(N); cdS = F(N); cdX = F(N); cdE = F(N); fciQ = F(N); gAcc = F(NG*N); gAT = F(NG*N); bC = F(N); bD = F(N); bS = F(N); kFN = F(N); kFV = F(N);
  catWet = new Uint8Array(MAXPART);
  fill = F(N); pc = I(N); bd = I(N); bRef = F(N); bTop = F(N); nN = F(N); nO = F(N); eA = F(N); cond = F(N); condE = F(N); vAcc = F(N); vAT = F(N); bq = F(N);
  pk = F(N); jetX = F(N); jetY = F(N); bubX = new Uint8Array(N); bubN = new Uint8Array(N); bkA = new Uint8Array(N);
  bW = F(N); bWE = F(N); bV = F(N); bH = F(N); bHv = F(N); bQT = F(N); bF = new Uint8Array(N);
  fM = F(2*N); fV = F(2*N); fPp = F(2*N); fPn = F(2*N); fU = F(2*N); fD = F(2*N); fS = F(2*N); tA = F(N); tB = F(N); rgh = F(N);
  kV = F(N); kN = F(N); kO = F(N); kE = F(N); kT = F(N); kP = F(N); kA = F(N); kQ = F(N); kS = F(N); kNP = F(N); kC = F(N); kPE = F(N); kM = F(N); kLv = new Uint8Array(N); kVg = F(N); kPv = F(N); rPk = I(N); rSg = F(N); rG = new Uint8Array(N); rL = new Uint8Array(N); rAir = F(N); rC = I(N); gF = new Uint8Array(N); gFl = I(N); rVol = F(N); rLq = F(N); kRm = I(N); kCell = I(N);
  MF[0] = fireCp()*1000; MF[1] = fireRho(); MF[2] = fireCool().mu; MF[3] = CORIUM.muMelt[0]; MF[4] = CORIUM.muMelt[1]; { const c = concreteOf(); CR[0] = c.h2o; CR[1] = c.co2; CR[2] = c.rho; CR[3] = c.tAbl; CR[4] = c.dhAbl; CR[5] = c.aniso; }
  partMasks();
  reset();
}
const isGW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || gwall[y*W+x] === 1;
const isLW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y*W+x] === 1;
const roomOk = j => !gwall[j] && !isDoor[j];
// the bench parts as cell masks, each cell its part's index or -1; a part list is the bench's, never D's
function partMasks(){
  mach.fill(-1); pan.fill(-1); vent.fill(-1); inert.fill(-1); catc.fill(-1); paN.fill(0); PN.fill(0); vnX.fill(0); vnY.fill(0); vphi.fill(0);
  const n = Math.min(MAXPART, PARTS.length);
  for(let a=0;a<n;a++){ const q = PARTS[a], k = PK_OF[q.kind] || 0, M = k === 1 ? mach : k === 2 ? pan : k === 3 ? vent : k === 4 ? inert : k === 5 ? catc : null;
    paK[a] = k; paT[a] = q.T ?? T_HULL; paDir[a] = q.dir === "in" ? 1 : 0; paSac[a] = q.sac ?? CORIUM.catchSac; paFe[a] = q.fe ?? CORIUM.catchFe; paWa[a] = q.water ?? CORIUM.catchWater;
    if(!M) continue;
    for(const i of q.cells) if(i >= 0 && i < N && M[i] < 0){ M[i] = a; paN[a]++; }
    if(!paN[a]) continue;
    PN[0]++; if(k === 3 || k === 4) PN[1]++; if(k === 3 && !paDir[a]) PN[2]++; if(k === 1) PN[3]++; if(k === 2) PN[4]++; if(k === 5) PN[5]++; }
}
// everything the drawing and the parts decide, rebuilt in place: both wall maps, doors, rooms, the junctions
function geomCore(){
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i = y*W+x, m = matOf(x, y), g = matWall(x, y) && !gone[i] ? 1 : 0;
    gwall[i] = g; wall[i] = g === 1 || mach[i] >= 0 || catc[i] >= 0 ? 1 : 0; conc[i] = g === 1 && m.agg ? matThick(x, y)/1000 : 0;
    rgh[i] = g === 1 && mach[i] < 0 && catc[i] < 0 ? m.rough : EPS_ST; }
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ nWall[y*W+x] = (isGW(x-1, y) ? 1 : 0) + (isGW(x+1, y) ? 1 : 0) + (isGW(x, y-1) ? 1 : 0) + (isGW(x, y+1) ? 1 : 0);
    let k = 0; for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++) if(isGW(x+a, y+b)) k++; wall9[y*W+x] = k; }
  wSat.fill(0);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wSat[(y + 1)*(W + 1) + x + 1] = wall[y*W+x] + wSat[y*(W + 1) + x + 1] + wSat[(y + 1)*(W + 1) + x] - wSat[y*(W + 1) + x];
  // a wall corner a path can bend round: one wall cell of the four at it, or two across a diagonal
  for(let y=0;y<=H;y++) for(let x=0;x<=W;x++){ const a = isLW(x-1, y-1), b = isLW(x, y-1), c = isLW(x-1, y), d = isLW(x, y), n = +a + +b + +c + +d;
    cvx[y*(W + 1) + x] = n === 1 || (n === 2 && a === d) ? 1 : 0; }
  roomDoors(isDoor, W, H, isGW, DOOR_MAX);
  room.fill(-1); nRoom = 0;
  for(let i=0;i<N;i++) if(!gwall[i] && !isDoor[i] && room[i] < 0) gridFlood(W, H, room, stack, i, nRoom++, roomOk);
  rVol.fill(0); for(let i=0;i<N;i++) if(room[i] >= 0) rVol[room[i]] += Vc;
  for(let i=0;i<N;i++) if(isDoor[i]) room[i] = -2;
  near(near2, 2);
  // per cell, bit sy + 1 + (sx + 1)/2: the diagonal neighbour (sx, sy) is wall and the two cells beside it are not, the corner collide() eases round
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let m = 0;
    for(let sy=-1;sy<=1;sy+=2) for(let sx=-1;sx<=1;sx+=2) if(solid(x + sx, y + sy) && !solid(x + sx, y) && !solid(x, y + sy)) m |= 1 << (sy + 1 + ((sx + 1) >> 1));
    cvn[y*W + x] = m; }
  // one junction per door run; the cells either side of it stand for the two pockets
  let nj = 0; jC0[0] = 0;
  for(let x=0;x<W;x++) for(let y=0;y<H;y++){ const i = y*W+x; if(isDoor[i] !== 1 || (y > 0 && isDoor[i-W] === 1)) continue;
    let e = y; while(e+1 < H && isDoor[(e+1)*W+x] === 1) e++;
    jCa[nj] = i-1; jCb[nj] = i+1; jAxis[nj] = 0; jArea[nj] = (e-y+1)*Af; let o = jC0[nj]; for(let k=y;k<=e;k++) jCells[o++] = k*W+x; jC0[++nj] = o; }
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i = y*W+x; if(isDoor[i] !== 2 || (x > 0 && isDoor[i-1] === 2)) continue;
    let e = x; while(e+1 < W && isDoor[y*W+e+1] === 2) e++;
    jCa[nj] = i-W; jCb[nj] = i+W; jAxis[nj] = 1; jArea[nj] = (e-x+1)*Af; let o = jC0[nj]; for(let k=x;k<=e;k++) jCells[o++] = y*W+k; jC0[++nj] = o; }
  L.nj = nj;
}
// a cell from which a pair's reach, its bend round a corner and SKIN of travel can take in a wall corner
function nearCorner(){
  const DC = Math.ceil(1.5*HTOP + 3*SKIN);
  for(let c=0;c<N;c++){ const cx = c%W, cy = (c/W)|0; let k = 0;
    for(let Y=Math.max(0, cy-DC);Y<=Math.min(H, cy+1+DC) && !k;Y++) for(let X=Math.max(0, cx-DC);X<=Math.min(W, cx+1+DC);X++) if(cvx[Y*(W + 1) + X]){ k = 1; break; }
    nearV[c] = k; }
}
// a wall burnt through or a part painted: the geometry is rebuilt and the particles kept; one left inside a new wall moves to the nearest cell it may stand in
function geom(){
  partMasks(); geomCore(); nearCorner(); walls(Math.ceil(HTOP)); sizes(); wallTable();
  for(let c=0;c<N;c++) mtC[c] = MW0*Math.pow(2, lv[c]);
  for(let p=0;p<L.np;p++){ const c = cellOf(p), lq = LQ[kind[p]] === 1; if(!(lq ? wall[c] : gwall[c])) continue;
    const j = nearestOpen(c, lq ? wall : gwall); if(j < 0) continue;
    px[p] = j%W + 0.5; py[p] = ((j/W)|0) + 0.5; qx[p] = px[p]; qy[p] = py[p]; ox[p] = px[p]; oy[p] = py[p]; vx[p] = 0; vy[p] = 0; }
  for(let i=0;i<N;i++){ if(!gwall[i] || !(nN[i] + nO[i] > 0 || nFpN[i] + nFpV[i] > 0)) continue; const j = nearestOpen(i, gwall); if(j < 0) continue;
    nN[j] += nN[i]; nO[j] += nO[i]; eA[j] += eA[i]; nFpN[j] += nFpN[i]; nFpV[j] += nFpV[i]; nN[i] = 0; nO[i] = 0; eA[i] = 0; nFpN[i] = 0; nFpV[i] = 0; }
  L.pbuilt = false; grid(); bin(); pockets(0);
}
// the nearest cell, breadth first, the map M leaves open; -1 for none
function nearestOpen(c, M){
  dist.fill(-1); let qh = 0, qt = 0; que[qt++] = c; dist[c] = 0;
  while(qh < qt){ const i = que[qh++]; if(!M[i]) return i; const x = i%W;
    if(x > 0 && dist[i-1] < 0){ dist[i-1] = 0; que[qt++] = i-1; } if(x < W-1 && dist[i+1] < 0){ dist[i+1] = 0; que[qt++] = i+1; }
    if(i >= W && dist[i-W] < 0){ dist[i-W] = 0; que[qt++] = i-W; } if(i+W < N && dist[i+W] < 0){ dist[i+W] = 0; que[qt++] = i+W; } }
  return -1;
}

// the wall's own energy W per particle, over m MPC^2 h^3/(pw dts^2): the rows a wall stands for push back g0 (g1 near) times harder than the
// gradient of U under a uniform squeeze toward it, and a first row's density rises L0 (L1) times its fill; into WE: W, dW/dT0, dW/dT1
const WR = {T0:0, T1:0, gc0:0, gc1:0, g0:1, g1:1, L0:1, L1:1}, WE = new Float64Array(3);
const phiS = r => { const x = r - RHO0; return x > 0 ? K.stiff*RHO0*(x - RHO0*Math.log1p(x/RHO0)) : 0; };
const pS = r => r > RHO0 ? K.stiff*(r - RHO0)*RHO0/r : 0;
function wallE(T0, T1){ const r = RHO0 + WR.L0*(T0 - WR.T0), e = WR.L1*Math.max(0, T1 - WR.T1);
  WE[0] = (WR.g0 - 1)/WR.L0*phiS(r)/4 + (WR.g1 - 1)*K.near*e*e/(2*WR.L1)/6; WE[1] = (WR.g0 - 1)*pS(r)/4; WE[2] = (WR.g1 - 1)*K.near*e/6; }
// the particle size is read here: a fine particle is a 1/ppc share of a cell, and it feels the ones within two spacings
function reset(){
  S0 = 1/Math.sqrt(K.ppc); MW0 = RHO_W*Vc/K.ppc; HK0 = 2*S0; LMAX = Math.max(0, Math.round(Math.log2(K.open*K.ppc))); HTOP = HK0*Math.sqrt(1.6*Math.pow(2, LMAX)); HM[0] = HK0; SKIN = 0.3*HK0;
  gone.fill(0); geomCore(); nearCorner();
  // lq..: the lattice rows a flat wall stands in for, seen from the first row at rest; wq..: the same half-plane as a continuum
  // lq2u, dl..: the same rows' near push and how their fill rises as the water squeezes toward the wall; gc..: the continuum's slope at the first row
  let lq = 0, lq2 = 0, lq3 = 0, wq = 0, wq2 = 0, wq3 = 0, lq2u = 0, dl2 = 0, dl3 = 0, gc0 = 0, gc1 = 0; RHO0 = 0; RN0 = 0;
  for(let a=-6;a<=6;a++) for(let b=-6;b<=6;b++){ const r = Math.hypot(a, b)*S0; if(!(r > 0 && r < HK0)) continue; const q = 1 - r/HK0;
    RHO0 += q*q; RN0 += q*q*q; if(b >= 1){ lq += q*b*S0/r; lq2 += q*q; lq3 += q*q*q; lq2u += q*q*b*S0/r; dl2 += 2*q*b*b*S0*S0/(HK0*r); dl3 += 3*q*q*b*b*S0*S0/(HK0*r); } }
  const ds = S0/40;
  for(let y=S0/2 + ds/2;y<HK0;y+=ds) for(let x=-HK0 + ds/2;x<HK0;x+=ds){ const r = Math.hypot(x, y); if(r >= HK0) continue; const q = 1 - r/HK0, w = ds*ds/(S0*S0);
    wq += w*q*y/r; wq2 += w*q*q; wq3 += w*q*q*q; }
  for(let x=-HK0 + ds/2;x<HK0;x+=ds){ const r = Math.hypot(x, S0/2); if(r >= HK0) continue; const q = 1 - r/HK0; gc0 += q*q*ds/(S0*S0); gc1 += q*q*q*ds/(S0*S0); }
  gc0 *= lq2/wq2; gc1 *= lq3/wq3;
  WR.T0 = lq2; WR.T1 = lq3; WR.gc0 = gc0; WR.gc1 = gc1; WR.g0 = lq/(HK0/4*gc0); WR.g1 = lq2u/(HK0/6*gc1); WR.L0 = 1 + dl2/(S0/2*gc0); WR.L1 = 1 + dl3/(S0/2*gc1);
  walls(Math.ceil(HTOP)); tables(LMAX + 2, lq/wq, lq2/wq2, lq3/wq3); sizes(); wallTable();
  for(let c=0;c<N;c++) mtC[c] = MW0*Math.pow(2, lv[c]);
  L.np = 0; RS[0] = 1; SS[0] = 0; SS[1] = 7; SS[2] = 0; sL.fill(0); bT.fill(0);
  rOn.fill(0); rRem.fill(0); rDone.fill(0); rDch.fill(0); rP.fill(-1); hotC.fill(0); HOT.fill(0); HAS.fill(1); BK.fill(0);
  cond.fill(0); condE.fill(0); vAcc.fill(0); vAT.fill(0); bq.fill(0); pk.fill(0); jetX.fill(0); jetY.fill(0); fill.fill(0); lfill.fill(0); jU.fill(0);
  nFpN.fill(0); nFpV.fill(0); dep.fill(0); abl.fill(0); crust.fill(0); fciQ.fill(0); condFp.fill(0); condSo.fill(0); gAcc.fill(0); gAT.fill(0); catWet.fill(0);
  for(let a=0;a<MAXPART;a++) paSk[a] = paT[a];
  for(let i=0;i<N;i++){ if(gwall[i]){ nN[i] = 0; nO[i] = 0; eA[i] = 0; continue; }
    nN[i] = N0*(1 - O2_FRAC0); nO[i] = N0*O2_FRAC0; eA[i] = (nN[i]*CV_N + nO[i]*CV_O)*(T_HULL - T0); }
  L.t = 0; L.tick = 0; L.inj = null; L.inKg = 0; L.nsplit = 0; L.njoin = 0; L.nref = 0; L.jref = 0; L.wclamp = 0; L.pdrop = 0; L.pbuilt = false; L.aerr.fill(0); L.ready = true;
  bin(); pockets(0);
}

// a wall cell counts for the rooms that reach it through wall alone, so a kernel never counts a wall on a thin wall's far side
function walls(D){
  tagA.fill(-1); tagB.fill(-1); L.tagDrop = 0;
  const nb = (i, f) => { const x = i%W, y = (i/W)|0;
    for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++){ const u = x + a, v = y + b; if((a || b) && u >= 0 && v >= 0 && u < W && v < H) f(v*W + u); } };
  for(let r=0;r<nRoom;r++){ dist.fill(-1); let qh = 0, qt = 0;
    for(let i=0;i<N;i++){ if(!wall[i]) continue; let on = false; nb(i, j => { if(room[j] === r) on = true; }); if(on){ dist[i] = 1; que[qt++] = i; } }
    while(qh < qt){ const i = que[qh++];
      if(tagA[i] < 0) tagA[i] = r; else if(tagB[i] < 0) tagB[i] = r; else L.tagDrop++;
      if(dist[i] < D) nb(i, j => { if(wall[j] && dist[j] < 0){ dist[j] = dist[i] + 1; que[qt++] = j; } }); } }
  near(nearW, D);
  // what reaches further than a water kernel: gas crowding, a flame lighting its neighbours, a painted blob
  DV = Math.ceil(Math.max(D, 1.2*HTOP, 2*RMAX + 0.5, RMAX + 3)); near(nearF, DV);
  // sees() for every cell pair in reach as far as the cells tell it: 0 other rooms, 1 no wall in the box of the two cells, 2 only the line itself can tell
  const dw = 2*DV + 1; if(!SV || SV.length !== N*dw*dw) SV = new Uint8Array(N*dw*dw);
  for(let c=0;c<N;c++){ const cx = c%W, cy = (c/W)|0, ra = room[c];
    for(let b=-DV;b<=DV;b++) for(let a=-DV;a<=DV;a++){ const u = cx + a, v = cy + b; if(u < 0 || v < 0 || u >= W || v >= H) continue;
      const rb = room[v*W + u], x0 = Math.min(cx, u), x1 = Math.max(cx, u) + 1, y0 = Math.min(cy, v), y1 = Math.max(cy, v) + 1, w = W + 1;
      SV[c*dw*dw + (b + DV)*dw + a + DV] = ra !== rb && ra !== -2 && rb !== -2 ? 0 : wSat[y1*w + x1] - wSat[y0*w + x1] - wSat[y1*w + x0] + wSat[y0*w + x0] === 0 ? 1 : 2; } }
}
function near(m, D){
  for(let i=0;i<N;i++){ const x = i%W, y = (i/W)|0; m[i] = 0;
    for(let b=-D;b<=D && !m[i];b++) for(let a=-D;a<=D;a++){ const u = x + a, v = y + b; if(u < 0 || v < 0 || u >= W || v >= H || wall[v*W + u]){ m[i] = 1; break; } } }
}
// a particle is small only where the space is narrow: two across any gap, open water at LMAX, and no step of more than one level
function sizes(){
  for(let y=0;y<H;y++) for(let x=0;x<W;){ if(wall[y*W+x]){ x++; continue; }
    let e = x; while(e+1 < W && !wall[y*W+e+1]) e++; for(let k=x;k<=e;k++) que[y*W+k] = e - x + 1; x = e + 1; }
  for(let x=0;x<W;x++) for(let y=0;y<H;){ if(wall[y*W+x]){ y++; continue; }
    let e = y; while(e+1 < H && !wall[(e+1)*W+x]) e++; for(let k=y;k<=e;k++) dist[k*W+x] = e - y + 1; y = e + 1; }
  for(let i=0;i<N;i++){ if(wall[i]){ lv[i] = 0; ax[i] = 0; continue; }
    const t = Math.min(que[i], dist[i]); ax[i] = que[i] >= dist[i] ? 0 : 1;
    lv[i] = Math.max(0, Math.min(LMAX, Math.floor(2*Math.log2(t/(2*S0)) + 1e-9))); }
  for(let moved=true;moved;){ moved = false;
    for(let i=0;i<N;i++){ if(wall[i]) continue; const x = i%W; let m = lv[i];
      if(x > 0 && !wall[i-1] && lv[i-1] + 1 < m) m = lv[i-1] + 1;
      if(x < W-1 && !wall[i+1] && lv[i+1] + 1 < m) m = lv[i+1] + 1;
      if(i >= W && !wall[i-W] && lv[i-W] + 1 < m) m = lv[i-W] + 1;
      if(i+W < N && !wall[i+W] && lv[i+W] + 1 < m) m = lv[i+W] + 1;
      if(m < lv[i]){ lv[i] = m; moved = true; } } }
}
// per level, the kernel integrated over a wall square at an offset (1/8 cell grid, one quadrant): q^2, q^3, q u_x, each scaled so
// a flat wall gives the first row at rest what the lattice rows it replaces would
function tables(NL, cQ, cD, cN){
  TN = new Int32Array(NL); TO = new Int32Array(NL + 1);
  for(let l=0;l<NL;l++){ const h = HK0*Math.pow(2, l/2); TN[l] = Math.ceil((h + 0.5)*8) + 1; TO[l+1] = TO[l] + TN[l]*TN[l]; }
  WT0 = new Float64Array(TO[NL]); WT1 = new Float64Array(TO[NL]); WTX1 = new Float64Array(TO[NL]);
  for(let l=0;l<NL;l++){ const h = HK0*Math.pow(2, l/2), n = TN[l], kd = HK0*HK0/(S0*S0*h*h)/64, ku = 4/(h*h)/64;
    for(let b=0;b<n;b++) for(let a=0;a<n;a++){ let s1 = 0, s2 = 0, s3 = 0;
      for(let j=0;j<8;j++) for(let i=0;i<8;i++){ const ex = a/8 - 0.5 + (i + 0.5)/8, ey = b/8 - 0.5 + (j + 0.5)/8, r = Math.hypot(ex, ey);
        if(r >= h || r < 1e-9) continue; const q = 1 - r/h; s1 += q*ex/r; s2 += q*q; s3 += q*q*q; }
      const o = TO[l] + b*n + a; WT0[o] = cD*kd*s2; WT1[o] = cN*kd*s3; WTX1[o] = cQ*ku*s1; } }
}
// ca sees cb along SEG: the same room or a door, and no wall between; the walk is skipped where the mask nr has no wall in reach of either, never when nr is null
const SEG = new Float64Array(4);
function sees(ca, cb, nr){
  const ra = room[ca], rb = room[cb];
  if(ra !== rb && ra !== -2 && rb !== -2) return 0;
  if(ca === cb || (nr !== null && (!nr[ca] || !nr[cb]))) return 1;
  return clear() || hit(false) < 0 ? 1 : 0;
}
// sees() along SEG, the cells asked first off the table walls() builds
function seesC(ca, cb){ return seesAB(ca, cb, cb%W - ca%W, ((cb/W)|0) - ((ca/W)|0)); }
// seesC() with cb's offset from ca, a columns and b rows, already known
function seesAB(ca, cb, a, b){ const dw = 2*DV + 1;
  const s = a >= -DV && a <= DV && b >= -DV && b <= DV ? SV[ca*dw*dw + (b + DV)*dw + a + DV] : 2;
  return s === 2 ? sees(ca, cb, null) : s;
}
// hit(false) finds no wall when the box of SEG's end cells holds none, save an end within 1e-7 of a grid corner, where it looks one cell past
function clear(){
  const sx0 = SEG[0], sy0 = SEG[1], sx1 = SEG[2], sy1 = SEG[3];
  if(!(sx0 >= 0 && sy0 >= 0 && sx1 >= 0 && sy1 >= 0 && sx0 < W && sx1 < W && sy0 < H && sy1 < H)) return false;
  // int32 cells: indices built off Math.floor() read as floats, and the loads that took them boxed
  const x0 = sx0|0, y0 = sy0|0, x1 = sx1|0, y1 = sy1|0, fx = sx1 - x1, fy = sy1 - y1;
  if((fx < 1e-7 || fx > 1 - 1e-7) && (fy < 1e-7 || fy > 1 - 1e-7)) return false;
  const a = Math.min(x0, x1), b = Math.max(x0, x1) + 1, c = Math.min(y0, y1), d = Math.max(y0, y1) + 1, w = W + 1;
  return wSat[d*w + b] - wSat[c*w + b] - wSat[d*w + a] + wSat[c*w + a] === 0;
}
// the first wall cell the segment SEG enters, or with out, the first open cell it enters after a wall; -1 for none
function hit(out){
  const x = SEG[0], y = SEG[1], dx = SEG[2] - x, dy = SEG[3] - y, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const fx = Math.floor(x), fy = Math.floor(y);
  let cx = fx|0, cy = fy|0, n = Math.abs(Math.floor(SEG[2]) - fx) + Math.abs(Math.floor(SEG[3]) - fy), inW = false;
  const tdx = dx !== 0 ? Math.abs(1/dx) : 1e30, tdy = dy !== 0 ? Math.abs(1/dy) : 1e30;
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx)*tdx : 1e30, ty = dy !== 0 ? (dy > 0 ? cy + 1 - y : y - cy)*tdy : 1e30;
  while(n-- > 0){
    // through a corner exactly: either side cell stops sight; out enters neither, or a 1/8-grid table point hides wall and a flat wall pushes along itself
    if(Math.abs(tx - ty) < 1e-12){ const a = cy*W + cx + sx, b = (cy + sy)*W + cx;
      if(!out){ if(wall[a] || wall[b]) return wall[a] ? a : b; }
      else if(n > 0){ tx += tdx; cx += sx; n--; } }
    if(tx < ty){ tx += tdx; cx += sx; } else { ty += tdy; cy += sy; }
    const i = cy*W + cx;
    if(wall[i]){ if(!out) return i; inW = true; } else if(inW) return i; }
  return -1;
}
// what the wall cells in reach add to a water particle: WS = density, near density, and the drag's direction and strength (x, y)
const WS = new Float64Array(4);
// the wall cells in reach that particle p's room counts, as it stands in cell c; past the board's edge is wall, or water on its floor
// never went still
function wallAt(p, c){
  const x = px[p], y = py[p], R = Math.ceil(ph[p]), cx = c%W, cy = (c/W)|0, NL = TN.length, w = W, h = H, rg = room[c];
  const lf = Math.max(0, Math.min(NL - 1, pl[p])), l0 = Math.min(NL - 2, lf|0), t = lf - l0;
  const A0 = WT0, A1 = WT1, X1 = WTX1, tn = TN, to = TO, nTop = tn[l0+1];
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  for(let gy=cy-R;gy<=cy+R;gy++) for(let gx=cx-R;gx<=cx+R;gx++){
    if(gx >= 0 && gy >= 0 && gx < w && gy < h){ const i = gy*w + gx; if(wall[i] !== 1 || !(rg === -2 ? tagA[i] >= 0 : tagA[i] === rg || tagB[i] === rg)) continue; }
    const dx = gx + 0.5 - x, dy = gy + 0.5 - y, ax = Math.abs(dx)*8, ay = Math.abs(dy)*8, ia = ax|0, ib = ay|0, fa = ax - ia, fb = ay - ib;
    // off the upper level's table is off the lower one's too: nothing to add, so nothing to walk
    if(ia + 1 >= nTop || ib + 1 >= nTop) continue;
    // past one cell a kernel can reach a wall across open water in its own room; one seen through its own body is not hidden, or a floor
    // drops the cells beside a particle as it moves and throws it about
    if(R > 1){ SEG[0] = x; SEG[1] = y; SEG[2] = Math.min(w - 1, Math.max(0, gx)) + 0.5; SEG[3] = Math.min(h - 1, Math.max(0, gy)) + 0.5; if(hit(true) >= 0) continue; }
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    for(let l=l0;l<=l0+1;l++){ const n = tn[l]; if(ia + 1 >= n || ib + 1 >= n) continue;
      const wl = l === l0 ? 1 - t : t, o = to[l], k = o + ib*n + ia, kt = o + ia*n + ib;
      const w00 = (1 - fa)*(1 - fb)*wl, w10 = fa*(1 - fb)*wl, w01 = (1 - fa)*fb*wl, w11 = fa*fb*wl;
      s2 += sx*(w00*X1[k] + w10*X1[k+1] + w01*X1[k+n] + w11*X1[k+n+1]);
      // the y integrals are the x ones with the offset transposed: fb runs along the row, fa down it
      s3 += sy*(w00*X1[kt] + w01*X1[kt+1] + w10*X1[kt+n] + w11*X1[kt+n+1]);
      s0 += w00*A0[k] + w10*A0[k+1] + w01*A0[k+n] + w11*A0[k+n+1];
      s1 += w00*A1[k] + w10*A1[k+1] + w01*A1[k+n] + w11*A1[k+n+1]; } }
  WS[0] = s0; WS[1] = s1; WS[2] = s2; WS[3] = s3;
}
// wtT: per cell near a wall, per level of its span (lv - 1 to lv + 1), wallAt() on a grid of points 1/WQ apart, one point past each
// side of the cell, 4 floats a point
const WQ = 8, WG = WQ + 3, WL = 3;
function wallTable(){
  const NL = TN.length, q = MAXP - 1, st = WL*WG*WG*4, x0 = px[q], y0 = py[q], l0 = pl[q], h0 = ph[q]; let n = 0;
  wtO.fill(-1);
  for(let c=0;c<N;c++) if(nearW[c]){ wtO[c] = n; n += st; }
  for(let c=0;c<N;c++){ if(wtO[c] < 0) continue; const cx = c%W, cy = (c/W)|0, lo = Math.max(0, lv[c] - 1), hi = Math.min(NL - 1, lv[c] + 1);
    for(let l=lo;l<=hi;l++){ pl[q] = l; ph[q] = Math.min(HTOP, HK0*Math.pow(2, l/2));
      for(let j=0;j<WG;j++) for(let i=0;i<WG;i++){ px[q] = cx + (i - 1)/WQ; py[q] = cy + (j - 1)/WQ; wallAt(q, c);
        const o = wtO[c] + (((l - lo)*WG + j)*WG + i)*4; for(let k=0;k<4;k++) wtT[o+k] = WS[k]; } } }
  px[q] = x0; py[q] = y0; pl[q] = l0; ph[q] = h0;
}
const CRX = new Float64Array(4), CRDX = new Float64Array(4), CRY = new Float64Array(4), CRDY = new Float64Array(4);
function crW(a, w, d){ const a2 = a*a, a3 = a2*a;
  w[0] = (-a3 + 2*a2 - a)/2; w[1] = (3*a3 - 5*a2 + 2)/2; w[2] = (-3*a3 + 4*a2 + a)/2; w[3] = (a3 - a2)/2;
  d[0] = (-3*a2 + 4*a - 1)/2; d[1] = (9*a2 - 10*a)/2; d[2] = (-9*a2 + 8*a + 1)/2; d[3] = (3*a2 - 2*a)/2; }
// what the wall cells in reach add to water particle p in cell (cx, cy), into wsA, eight a particle: the fill T0, T1 and the drag's (x, y),
// Catmull-Rom in the point so the gradient has no step for water at rest to sit on, linear in the level, clamped to the cell's span;
// then the exact gradient of that same T0, T1
function wallSum(p, cx, cy){
  const S = wsA, s = 8*p, c = cy*W + cx;
  for(let k=0;k<8;k++) S[s+k] = 0;
  const o = wtO[c]; if(o < 0) return;
  const lo = Math.max(0, lv[c] - 1), hi = Math.min(TN.length - 1, lv[c] + 1);
  let lf = pl[p]; if(lf < lo){ lf = lo; L.wclamp++; } else if(lf > hi){ lf = hi; L.wclamp++; }
  const l0 = Math.min(hi - 1, lf|0), t = lf - l0;
  const ux = (px[p] - cx)*WQ, uy = (py[p] - cy)*WQ, fx = ux < 0 ? 0 : ux > WQ ? WQ : ux, fy = uy < 0 ? 0 : uy > WQ ? WQ : uy;
  const kx = fx === ux ? WQ : 0, ky = fy === uy ? WQ : 0;
  const i0 = Math.min(WQ - 1, fx|0), j0 = Math.min(WQ - 1, fy|0), T = wtT, X = CRX, DX = CRDX, Y = CRY, DY = CRDY;
  crW(fx - i0, X, DX); crW(fy - j0, Y, DY);
  let q0 = 0, q1 = 0, q2 = 0, q3 = 0, x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for(let l=0;l<2;l++){ const wl = l ? t : 1 - t, b = o + (l0 - lo + l)*WG*WG*4;
    for(let jj=0;jj<4;jj++){ const r = b + ((j0 + jj)*WG + i0)*4, wy = wl*Y[jj], dy = wl*DY[jj];
      for(let ii=0;ii<4;ii++){ const e = r + 4*ii, w = wy*X[ii], dx = wy*DX[ii], ey = dy*X[ii];
        q0 += w*T[e]; q1 += w*T[e+1]; q2 += w*T[e+2]; q3 += w*T[e+3];
        x0 += dx*T[e]; y0 += ey*T[e]; x1 += dx*T[e+1]; y1 += ey*T[e+1]; } } }
  S[s] = q0; S[s+1] = q1; S[s+2] = q2; S[s+3] = q3; S[s+4] = kx*x0; S[s+5] = ky*y0; S[s+6] = kx*x1; S[s+7] = ky*y1;
}

function spawn(k){
  const x = SPA[0], y = SPA[1], m = SPA[2], T = SPA[3], u = SPA[4], v = SPA[5];
  if(L.np >= MAXP || (LQ[k] === 1 ? solid(Math.floor(x), Math.floor(y)) : gsolid(Math.floor(x), Math.floor(y)))) return -1;
  const p = L.np++; L.pbuilt = false; HAS[k] = 1;
  kind[p] = k; px[p] = x; py[p] = y; qx[p] = x; qy[p] = y; ox[p] = x; oy[p] = y; vx[p] = u; vy[p] = v; pm[p] = m; pT[p] = T; pE[p] = 0; burn[p] = 0; age[p] = 0; pq[p] = 0; sg[p] = 0; pfo[p] = 0; sp0[p] = hyp(u, v); pst[p] = 1; psx[p] = u; psy[p] = v;
  pvf[p] = 1; pFp[p] = 0; pSo[p] = 0; pMr[p] = 0; pCF[p] = 0; pCK[p] = 0; pCZ[p] = 0; pCS[p] = 0; pCX[p] = 0; pDw[p] = 0; frz[p] = 0; pFci[p] = 0; pSrc[p] = 0; swC[p] = 0; sdx[p] = 0; sdy[p] = 0;
  ph[p] = hOf(p);
  pv[p] = k === KQ ? 1 : Math.max(0.05, molOf(p)/N0*T/T_HULL);
  return p;
}
function kill(p){ const q = --L.np; L.pbuilt = false; if(p === q) return;
  kind[p] = kind[q]; px[p] = px[q]; py[p] = py[q]; qx[p] = qx[q]; qy[p] = qy[q]; ox[p] = ox[q]; oy[p] = oy[q]; vx[p] = vx[q]; vy[p] = vy[q];
  pm[p] = pm[q]; pT[p] = pT[q]; pE[p] = pE[q]; pv[p] = pv[q]; ph[p] = ph[q]; burn[p] = burn[q]; age[p] = age[q]; pq[p] = pq[q]; sg[p] = sg[q]; pfo[p] = pfo[q]; sp0[p] = sp0[q]; pst[p] = pst[q]; psx[p] = psx[q]; psy[p] = psy[q];
  pvf[p] = pvf[q]; pFp[p] = pFp[q]; pSo[p] = pSo[q]; pMr[p] = pMr[q]; pCF[p] = pCF[q]; pCK[p] = pCK[q]; pCZ[p] = pCZ[q]; pCS[p] = pCS[q]; pCX[p] = pCX[q]; pDw[p] = pDw[q]; frz[p] = frz[q]; pFci[p] = pFci[q]; pSrc[p] = pSrc[q]; swC[p] = swC[q]; sdx[p] = sdx[q]; sdy[p] = sdy[q]; sdv[p] = sdv[q]; if(pSrc[p]) rP[pSrc[p] - 1] = p; }
function sweep(){ for(let p=L.np-1;p>=0;p--) if(kind[p] === 0) kill(p); }
// water laid at rest: frac of the cell on a lattice in it at the cell's own size, one a cell at most; laid fine and joined up, a pool stirred for seconds
function lay(i, frac){
  const n = Math.max(1, Math.round(frac*RHO_W*Vc/Math.min(mT(i), RHO_W*Vc))), nx = Math.ceil(Math.sqrt(n)), ny = Math.ceil(n/nx), m = frac*RHO_W*Vc/n, x0 = i%W, y0 = (i/W)|0;
  for(let k=0;k<n;k++){ const a = k%nx, b = (k/nx)|0, row = b < ny - 1 ? nx : n - nx*(ny - 1);
    SPA[0] = x0 + (a + 0.5)/row; SPA[1] = y0 + (b + 0.5)/ny; SPA[2] = m; SPA[3] = T_HULL; SPA[4] = 0; SPA[5] = 0; spawn(KW); }
}

const mT = c => mtC[c];
// AU: what one split or join moved of mass, x and y momentum and energy, after less before; the audit sums it over the pass
const AU = new Float64Array(4);
function book4(p, s){ if(!L.audit || kind[p] !== KW) return; const m = pm[p]*s, u = vx[p]*MPC, v = vy[p]*MPC;
  AU[0] += m; AU[1] += m*u; AU[2] += m*v; AU[3] += m*(CW*(pT[p] - T0) + 0.5*(u*u + v*v)); }
function split(p, c){
  if(L.np >= MAXP){ L.nref++; return; }
  const k = kind[p], m = pm[p]/2, d = 0.25*S0*Math.sqrt(m/MW0*pvf[p]), ux = ax[c] === 0 ? d : 0, uy = ax[c] === 0 ? 0 : d, x = px[p], y = py[p];
  let xa = x - ux, ya = y - uy, xb = x + ux, yb = y + uy;
  if(solid(Math.floor(xa), Math.floor(ya))){ xa = x; ya = y; }
  if(solid(Math.floor(xb), Math.floor(yb))){ xb = x; yb = y; }
  book4(p, -1);
  SPA[0] = xb; SPA[1] = yb; SPA[2] = m; SPA[3] = pT[p]; SPA[4] = vx[p]; SPA[5] = vy[p];
  const q = spawn(k);
  pm[p] = m; pE[p] /= 2; pE[q] = pE[p]; pfo[q] = pfo[p]; pst[q] = pst[p]; psx[q] = psx[p]; psy[q] = psy[p]; px[p] = xa; py[p] = ya; qx[p] = xa; qy[p] = ya; ox[p] = xa; oy[p] = ya;
  pvf[q] = pvf[p]; pFp[p] /= 2; pFp[q] = pFp[p]; pSo[p] /= 2; pSo[q] = pSo[p]; pMr[q] = pMr[p]; frz[q] = frz[p]; pFci[q] = pFci[p];
  if(k === KX){ pCF[p] /= 2; pCF[q] = pCF[p]; pCK[p] /= 2; pCK[q] = pCK[p]; pCZ[p] /= 2; pCZ[q] = pCZ[p]; pCS[p] /= 2; pCS[q] = pCS[p]; pCX[p] /= 2; pCX[q] = pCX[p]; pDw[p] /= 2; pDw[q] = pDw[p]; }
  ph[p] = hOf(p); ph[q] = hOf(q);
  jst[p] = pass; jst[q] = pass; L.nsplit++;
  book4(p, 1); book4(q, 1);
}
// q of the live pair a-b as pairs() finds it, at the particles' places and sizes now; 0 for none
function pairQ(a, b){ if(b < a){ const t = a; a = b; b = t; }
  const xa = px[a], ya = py[a], dx = px[b] - xa, dy = py[b] - ya, r2 = dx*dx + dy*dy, h = 0.5*(ph[a] + ph[b]); if(r2 >= h*h) return 0;
  const r = Math.sqrt(r2), ca = cellOf(a), cb = cellOf(b);
  SEG[0] = xa; SEG[1] = ya; SEG[2] = px[b]; SEG[3] = py[b];
  if(!nearV[ca]) return seesAB(ca, cb, cb%W - ca%W, ((cb/W)|0) - ((ca/W)|0)) ? 1 - r/h : 0;
  if(clear() || hit(false) < 0) return 1 - r/h;
  BND[0] = h; bend(a, b); return BND[0] < h ? 1 - BND[0]/h : 0;
}
// a particle's share of U over MPC^2/dts^2 (water()'s U) at density rho, near density rn and wall fill T0, T1
function uOf(m, h, w, rho, rn, T0, T1){ const x = rho - RHO0, nz = x > 0 ? RHO0/rho : 1, e = rn > RN0 ? rn - RN0 : 0;
  wallE(T0, T1); return m*h*h*h/w*((x > 0 ? phiS(rho) : 0.5*K.pull*x*x)/4 + K.near*nz*e*e/12 + WE[0]); }
// the change in U over MPC^2/dts^2 if p joined j, off the densities pairs() and wallPass() left; each neighbour's density change into
// jnQ, jnD and j's new density into JU, for joinApply(). A neighbour list past JN reads as a rise, so the join is refused
const JN = 1024, JU = new Float64Array(2), JS = new Float64Array(13);
function joinDU(p, j){
  const D = dnA, T = wsA, a = pm[p], b = pm[j], s = a + b, vf = kind[p] === KW ? 1 : (pvf[j]*b + pvf[p]*a)/s, vn = s/MW0*vf;
  const hn = Math.min(HTOP, HK0*Math.sqrt(vn)), wn = vn*HK0*HK0, xn = (px[j]*b + px[p]*a)/s, yn = (py[j]*b + py[p]*a)/s;
  const R = Math.ceil(ph[p] + HTOP) + 1, cx = Math.min(W-1, Math.max(0, xn|0)), cy = Math.min(H-1, Math.max(0, yn|0));
  let n = 0;
  for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
    for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const q = cP[gi]; if(q === p || q === j || LQ[kind[q]] !== 1) continue;
      if(n === JN) return Infinity;
      const qp = pairQ(q, p), qj = pairQ(q, j), hp = 0.5*(ph[q] + ph[p]), hj = 0.5*(ph[q] + ph[j]), gp = qp*qp/(hp*hp), gj = qj*qj/(hj*hj);
      jnQ[n] = q; jnD[2*n] = -pw[p]*gp - pw[j]*gj; jnD[2*n+1] = -pw[p]*gp*qp - pw[j]*gj*qj; n++; }
  let du = -uOf(a, ph[p], pw[p], D[2*p] + T[8*p], D[2*p+1] + T[8*p+1], T[8*p], T[8*p+1]) - uOf(b, ph[j], pw[j], D[2*j] + T[8*j], D[2*j+1] + T[8*j+1], T[8*j], T[8*j+1]);
  JS[0] = px[j]; JS[1] = py[j]; JS[2] = ph[j]; JS[3] = pw[j]; JS[4] = pl[j]; for(let k=0;k<8;k++) JS[5+k] = T[8*j+k];
  px[j] = xn; py[j] = yn; ph[j] = hn; pw[j] = wn; pl[j] = Math.log2(vn); wallSum(j, cxOf(j), cyOf(j));
  let rj = 0, nj = 0;
  for(let i=0;i<n;i++){ const q = jnQ[i], qn = pairQ(q, j), h = 0.5*(ph[q] + hn), g = qn*qn/(h*h), o = 8*q;
    jnD[2*i] += wn*g; jnD[2*i+1] += wn*g*qn; rj += pw[q]*g; nj += pw[q]*g*qn;
    const r0 = D[2*q] + T[o], n0 = D[2*q+1] + T[o+1];
    du += uOf(pm[q], ph[q], pw[q], r0 + jnD[2*i], n0 + jnD[2*i+1], T[o], T[o+1]) - uOf(pm[q], ph[q], pw[q], r0, n0, T[o], T[o+1]); }
  du += uOf(s, hn, wn, rj + T[8*j], nj + T[8*j+1], T[8*j], T[8*j+1]);
  JU[0] = rj; JU[1] = nj; L.njq = n;
  px[j] = JS[0]; py[j] = JS[1]; ph[j] = JS[2]; pw[j] = JS[3]; pl[j] = JS[4]; for(let k=0;k<8;k++) T[8*j+k] = JS[5+k];
  return du;
}
// the densities after the join joinDU() priced, so the next join in the pass is priced on them
function joinApply(j){ const D = dnA, n = L.njq;
  for(let i=0;i<n;i++){ const q = jnQ[i]; D[2*q] += jnD[2*i]; D[2*q+1] += jnD[2*i+1]; }
  D[2*j] = JU[0]; D[2*j+1] = JU[1]; pl[j] = Math.log2(pm[j]/MW0*pvf[j]); pw[j] = pm[j]/MW0*HK0*HK0*pvf[j]; wallSum(j, cxOf(j), cyOf(j)); }
// the pair's lost kinetic energy stays as heat, so a join keeps mass, momentum and energy; a join that would raise U is refused, as
// relabelling water makes no strain energy
function join(p, c){
  const k = kind[p], x = px[p], y = py[p], hp = hOf(p), R = Math.ceil(hp), cx = c%W, cy = (c/W)|0, cap = K.jcap*mT(c), vp = pm[p]*pvf[p];
  let best = -1, d2 = hp*hp;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
    for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(j === p || kind[j] !== k || jst[j] === pass || frz[j]) continue;
      const dx = px[j] - x, dy = py[j] - y, r2 = dx*dx + dy*dy; if(r2 >= d2) continue;
      const cj = cellOf(j), v = vp + pm[j]*pvf[j]; if(v > cap || v > K.jcap*mT(cj)) continue;
      SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(c, cj)) continue;
      best = j; d2 = r2; }
  if(best < 0) return;
  if(joinDU(p, best) > 0){ L.jref++; return; }
  const j = best, a = pm[p], b = pm[j], s = a + b, du = vx[p] - vx[j], dv = vy[p] - vy[j];
  book4(p, -1); book4(j, -1);
  const dKE = 0.5*a*b/s*(du*du + dv*dv)*MPC*MPC;
  // a splash starts where the faster of the two stood: the drop that landed, not the body it landed in
  const pFast = vx[p]*vx[p] + vy[p]*vy[p] >= vx[j]*vx[j] + vy[j]*vy[j]; SPH[1] = pFast ? x : px[j]; SPH[2] = pFast ? y : py[j];
  px[j] = (px[j]*b + x*a)/s; py[j] = (py[j]*b + y*a)/s; vx[j] = (vx[j]*b + vx[p]*a)/s; vy[j] = (vy[j]*b + vy[p]*a)/s;
  if(k === KW) pT[j] = (pT[j]*b + pT[p]*a)/s + dKE/(s*CW); else pE[j] += dKE;
  pm[j] = s; pE[j] += pE[p]; pfo[j] = (pfo[j]*b + pfo[p]*a)/s;
  pst[j] = (pst[j]*b + pst[p]*a)/s; psx[j] = (psx[j]*b + psx[p]*a)/s; psy[j] = (psy[j]*b + psy[p]*a)/s;
  if(k !== KW){ pvf[j] = (pvf[j]*b + pvf[p]*a)/s; pCF[j] += pCF[p]; pCK[j] += pCK[p]; pCZ[j] += pCZ[p]; pCS[j] += pCS[p]; pCX[j] += pCX[p]; pDw[j] += pDw[p];
    if(pFci[p]) pFci[j] = 1; liqT(j); }
  pFp[j] += pFp[p]; pSo[j] += pSo[p];
  qx[j] = px[j]; qy[j] = py[j]; ph[j] = hOf(j); joinApply(j);
  kind[p] = 0; jst[p] = pass; jst[j] = pass; L.njoin++; L.pbuilt = false;
  book4(j, 1);
  // a drop landing on a pool joins it the tick it arrives: the pair's closing speed is the hit
  const hs = Math.sqrt(du*du + dv*dv)*MPC; if(k === KW && hs > K.fhit){ SPH[0] = hs; SPH[3] = 0; SPH[4] = 0; splash(j); }
}
// a metal or corium particle's temperature off its enthalpy, and whether it has frozen where it stands
function liqT(p){ if(kind[p] === KM) metalT(p); else if(kind[p] === KX) corT(p); }
// the metal fire's one fuel (room.js: one pool field, one FIRE row): its coolant's cp J/kg/K, density and viscosity Pa s, then corium's mu = a exp(b/T), set at build
const MF = new Float64Array(5);
// the metal's registers: [0] kg and [1] J in, [2] K out; [3] K in, J a kg out
const MR = new Float64Array(4);
// ePoolTA() (src/eng/room.js), J on the datum liquid at the melting point: liquid above it, the fusion shelf, solid below
function poolTA(){ const m = MR[0], E = MR[1], f = FIRE[FIRE_KEYS[0]], cp = MF[0], eF = -m*f.lf*1000;
  MR[2] = !(m > 0) ? T_HULL : E >= 0 ? f.melt + E/(m*cp) : E > eF ? f.melt : f.melt + (E - eF)/(m*cp); }
function metalT(p){ MR[0] = pm[p]; MR[1] = pE[p]; poolTA(); pT[p] = MR[2];
  frz[p] = pE[p] <= -pm[p]*FIRE[FIRE_KEYS[pMr[p]]].lf*1000 && rests(p) ? 1 : 0; }
// J a kg of metal holds at MR[3] K on the melt datum, solid below the melting point, into MR[3]
function metalEA(){ const f = FIRE[FIRE_KEYS[0]], T = MR[3]; MR[3] = T >= f.melt ? MF[0]*(T - f.melt) : -f.lf*1000 + MF[0]*(T - f.melt); }
function adapt(){
  grid(); pass++;
  let M = 0, PA = 0, KE = 0;
  if(L.audit){ for(let k=0;k<4;k++) AU[k] = 0;
    for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue; const v = Math.sqrt(vx[p]*vx[p] + vy[p]*vy[p])*MPC; M += pm[p]; PA += pm[p]*v; KE += 0.5*pm[p]*v*v; } }
  const n0 = L.np, e0 = L.nsplit + L.njoin;
  for(let p=0;p<n0;p++){ if(LQ[kind[p]] !== 1 || jst[p] === pass || frz[p]) continue;
    const c = cellOf(p); if(pm[p]*pvf[p] > K.split*mT(c)) split(p, c); }
  // joins are priced on the densities where the water stands after the splits
  grid(); pairs(); wallPass();
  for(let p=0;p<n0;p++){ if(LQ[kind[p]] !== 1 || jst[p] === pass || frz[p]) continue;
    const c = cellOf(p); if(pm[p]*pvf[p] < K.join*mT(c)) join(p, c); }
  if(L.audit && L.nsplit + L.njoin > e0){ const e = L.aerr;
    e[0] = Math.max(e[0], Math.abs(AU[0])/M); e[1] = Math.max(e[1], Math.abs(AU[1])/PA); e[2] = Math.max(e[2], Math.abs(AU[2])/PA); e[3] = Math.max(e[3], Math.abs(AU[3])/KE); }
}

function bin(){
  bW.fill(0); bWE.fill(0); bV.fill(0); bH.fill(0); bHv.fill(0); bQT.fill(0); bF.fill(0);
  // a bin no particle filled last time is already clear
  if(HAS[KM]){ bM.fill(0); bME.fill(0); } if(HAS[KX]){ bXm.fill(0); bXT.fill(0); } if(HAS[KM] || HAS[KX]) bLV.fill(0);
  if(HAS[0]) bFp.fill(0); if(HAS[KC]) bC.fill(0); if(HAS[KD]) bD.fill(0); if(HAS[KS]) bS.fill(0);
  HAS.fill(0);
  for(let p=0;p<L.np;p++){ const k = kind[p]; HAS[k] = 1;
    if(LQ[k] === 1){ book(p, cxOf(p), cyOf(p)); continue; }
    const c = cellOf(p);
    if(k === KV) bV[c] += pm[p];
    else if(k === KH){ bH[c] += pm[p]; bHv[c] += pv[p]; if(burn[p]) bF[c] = 1; }
    else if(k === KQ) bQT[c] = Math.max(bQT[c], dTOf(p));
    else if(k === KC){ bC[c] += pm[p]; if(burn[p]) bF[c] = 1; }
    else if(k === KD) bD[c] += pm[p];
    else if(k === KS) bS[c] += pm[p]; }
  if(HAS[KM] || HAS[KX] || PN[3] > 0) for(let i=0;i<N;i++){ fill[i] = wall[i] ? 1 : bW[i]/(RHO_W*Vc); lfill[i] = gwall[i] ? 1 : wall[i] ? 0 : fill[i] + bLV[i]/Vc; }
  else { for(let i=0;i<N;i++) fill[i] = wall[i] ? 1 : bW[i]/(RHO_W*Vc); lfill.set(fill); }
  rooms();
}
// a water particle's mass over the cells it can see within its spacing: a particle bigger than a cell fills its neighbours, not one cell many times
function book(p, cx, cy){
  const x = px[p], y = py[p], R = Math.max(K.spr, 0.5*hOf(p)), Rc = Math.ceil(R), RR = R*R*(1 + 1e-12), c = cy*W + cx;
  let n = 0, sw = 0;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc);gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++){ const i = gy*W + gx;
    if(wall[i]) continue;
    // out of reach with margin to spare whatever hyp() rounds to, so the call is skipped
    const ex = gx + 0.5 - x, ey = gy + 0.5 - y; if(ex*ex + ey*ey >= RR) continue;
    const d = hyp(ex, ey); if(d >= R) continue;
    SEG[2] = gx + 0.5; SEG[3] = gy + 0.5; if(!seesAB(c, i, gx - cx, gy - cy)) continue;
    const w = (1 - d/R)*(1 - d/R); spC[n] = i; spW[n] = w; sw += w; n++; }
  const m = pm[p], kd = kind[p];
  if(kd === KW){ const e = m*CW*(pT[p] - T0);
    for(let k=0;k<n;k++){ const f = spW[k]/sw; bW[spC[k]] += m*f; bWE[spC[k]] += e*f; }
    const fp = pFp[p]; if(fp > 0){ HAS[0] = 1; for(let k=0;k<n;k++) bFp[spC[k]] += fp*spW[k]/sw; }
    return; }
  const e = kd === KM ? pE[p] : m*pT[p], v = m*pvf[p]/RHO_W, B = kd === KM ? bM : bXm, BE = kd === KM ? bME : bXT;
  for(let k=0;k<n;k++){ const f = spW[k]/sw; B[spC[k]] += m*f; BE[spC[k]] += e*f; bLV[spC[k]] += v*f; }
}

// the pocket's gas is one mixture at one temperature: the air, the heat parcels and the steam and hydrogen parcels all share it
function state(k){ const cv = kN[k]*CV_N + kO[k]*CV_O + kC[k];
  kT[k] = cv > 0 ? T0 + (kE[k] + kQ[k] + kPE[k])/cv : T_HULL;
  kP[k] = RU*(kN[k] + kO[k] + kNP[k])*kT[k]/kV[k]; }

// in stages, each its own function: one body this size runs out of inlining budget, and every float a helper hands back is boxed
function pockets(live){ STR[0] = 0; keepGas(); airOut(); const nk = label(); roofs(nk); sums(nk); settle(nk, live); spread(); bodies(); bubs(); }
// per room while liquid is on the board: liquid, any gas cell left, least-filled roof cell, air moles
function rooms(){ LIQ[0] = HAS[KW] || HAS[KM] || HAS[KX] ? 1 : 0; if(!LIQ[0]) return;
  for(let r=0;r<nRoom;r++){ rLq[r] = 0; rG[r] = 0; rAir[r] = 0; rC[r] = -1; }
  for(let i=0;i<N;i++){ const r = room[i]; if(r < 0) continue; const f = lfill[i]; rLq[r] += f; rAir[r] += nN[i] + nO[i];
    if(f < K.fgas) rG[r] = 1; else if(i < W || gwall[i-W]){ const b = rC[r]; if(b < 0 || f < lfill[b]) rC[r] = i; } }
}
// liquid thrown thin over every cell of a room leaves its air between the drops: the room's least-filled cell under its roof stays gas
function keepGas(){ for(let n=0;n<GFN[0];n++) gF[gFl[n]] = 0; GFN[0] = 0; if(!LIQ[0]) return;
  for(let r=0;r<nRoom;r++) if(!rG[r] && rAir[r] > 0 && rC[r] >= 0){ gF[rC[r]] = 1; gFl[GFN[0]++] = rC[r]; } }
// air in a cell the water has taken moves to a gas neighbour, up first; with none beside it, up a cell, so a trapped bubble climbs
function airOut(){
  for(let i=0;i<N;i++){ if(gwall[i] || gasC(i) || !(nN[i] + nO[i] > 0)) continue;
    const x = i%W; let j = -1;
    if(i >= W && gasC(i-W)) j = i-W; else if(x > 0 && gasC(i-1)) j = i-1; else if(x < W-1 && gasC(i+1)) j = i+1;
    else if(i+W < N && gasC(i+W)) j = i+W; else if(i >= W && !gwall[i-W]) j = i-W;
    if(j < 0 || !gasC(j)) STR[0] = 1; if(j < 0) continue;
    moveAir(i, j); }
}
function moveAir(i, j){ nN[j] += nN[i]; nO[j] += nO[i]; eA[j] += eA[i]; nN[i] = 0; nO[i] = 0; eA[i] = 0;
  nFpN[j] += nFpN[i]; nFpV[j] += nFpV[i]; nFpN[i] = 0; nFpV[i] = 0; }
function label(){
  pc.fill(-1); let nk = 0;
  for(let i=0;i<N;i++) if(pc[i] < 0 && open(i)) gridFlood(W, H, pc, stack, i, nk++, open);
  for(let i=0;i<N;i++){ if(pc[i] >= 0 || !gasC(i)) continue;
    const a = isDoor[i] === 1 ? i-1 : i-W, b = isDoor[i] === 1 ? i+1 : i+W;
    pc[i] = a >= 0 && pc[a] >= 0 && !isDoor[a] ? pc[a] : b < N && pc[b] >= 0 && !isDoor[b] ? pc[b] : -1;
    if(pc[i] < 0) gridFlood(W, H, pc, stack, i, nk++, doorGas); }
  L.npk = nk;
  return nk;
}
function roofs(nk){
  for(let k=0;k<nk;k++){ kA[k] = 0; kV[k] = 0; kN[k] = 0; kLv[k] = 0; kRm[k] = -1; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; kV[k]++; kN[k] += nN[i] + nO[i]; if(i < W || gwall[i-W]) kA[k] = 1;
    if(vent[i] >= 0 && paDir[vent[i]] === 0) kLv[k] = 1; const r = room[i]; if(r >= 0){ kRm[k] = r; kCell[k] = i; } }
  for(let ch=1, it=0;ch && it<nk;it++){ ch = 0; for(let j=0;j<L.nj;j++){ const a = pc[jCa[j]], b = pc[jCb[j]]; if(a >= 0 && b >= 0 && kLv[a] !== kLv[b]){ kLv[a] = 1; kLv[b] = 1; ch = 1; } } }
  // a near-empty void is a gap between particles (as vacuum it would boil cold water), unless a vent OUT is drawing the room down
  for(let k=0;k<nk;k++) if(kN[k] < 0.1*N0*kV[k] && !kLv[k]) kA[k] = 0;
  // liquid thrown to the roof cuts every region off it but the air is still there: such a room keeps its largest region
  if(LIQ[0]){ for(let r=0;r<nRoom;r++){ rL[r] = 0; rPk[r] = -1; }
    for(let k=0;k<nk;k++){ const r = kRm[k]; if(r < 0) continue; if(kA[k]) rL[r] = 1; else if(rPk[r] < 0 || kV[k] > kV[rPk[r]]) rPk[r] = k; }
    for(let r=0;r<nRoom;r++){ const k = rPk[r]; if(!rL[r] && k >= 0 && rAir[r] >= 0.1*N0*kV[k]) kA[k] = 1; rPk[r] = -1; }
    for(let k=0;k<nk;k++){ const r = kRm[k]; if(r >= 0 && kA[k] && (rPk[r] < 0 || kV[k] > kV[rPk[r]])) rPk[r] = k; } }
  let nl = 0; for(let k=0;k<nk;k++) if(kA[k]) nl++; L.nlive = nl;
  // only a roof holds air: a pocket with water over all of it is a gap between particles, and its air rises to the pocket over it
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0 || kA[k]) continue;
    let j = i - W; while(j >= 0 && !gwall[j] && (pc[j] < 0 || !kA[pc[j]])) j -= W;
    if(j < 0 || gwall[j]){ pc[i] = -1; STR[0] = 1; continue; }
    moveAir(i, j); pc[i] = -1; }
}
function sums(nk){
  // kV is the room's free volume (room less liquid) shared by gas cells, so thrown liquid cannot squeeze the air out; kVg spreads the air
  const lq = LIQ[0] === 1;
  if(lq && STR[0]) gather();
  if(lq) for(let r=0;r<nRoom;r++) rSg[r] = 0;
  for(let k=0;k<nk;k++){ kVg[k] = 0; kN[k] = 0; kO[k] = 0; kE[k] = 0; kA[k] = 0; kQ[k] = 0; kS[k] = 0; kNP[k] = 0; kC[k] = 0; kPE[k] = 0; kM[k] = 0; kFN[k] = 0; kFV[k] = 0; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; const v = vgOf(i); kVg[k] += v; if(lq && room[i] >= 0) rSg[room[i]] += v;
    kN[k] += nN[i]; kO[k] += nO[i]; kE[k] += eA[i]; kA[k] += 2*MPC*MPC + Af*nWall[i]; if(mT(i) > kM[k]) kM[k] = mT(i); }
  for(let k=0;k<nk;k++){ const r = kRm[k]; kV[k] = lq && r >= 0 && rSg[r] > 0 && kVg[k] > 0 ? Math.max(0.05*Vc, kVg[k]*Math.max(0.05, (rVol[r] - rLq[r]*Vc)/rSg[r])) : kVg[k]; }
  if(HOT[3]) for(let i=0;i<N;i++){ const k = pc[i]; if(k >= 0){ kFN[k] += nFpN[i]; kFV[k] += nFpV[i]; } }
  for(let p=0;p<L.np;p++){ const kd = kind[p]; if(LQ[kd] === 1 || kd === KS) continue; const k = pc[cellOf(p)]; if(k < 0) continue;
    if(kd === KQ){ kQ[k] += pE[p]; continue; }
    const n = molOf(p), c = n*CVK[kd]; kS[k] += pv[p]; kNP[k] += n; kC[k] += c; kPE[k] += c*(pT[p] - T0); }
  // the parcels mix with no more gas than the pocket holds, a pocket full of them is evenly mixed, and a parcel never with less
  // than its own
  for(let p=0;p<L.np;p++){ const kd = kind[p]; if(LQ[kd] === 1 || kd === KQ || kd === KS) continue; const k = pc[cellOf(p)]; if(k < 0) continue;
    const cap = (kN[k] + kO[k] + kNP[k])/N0; if(kS[k] > cap) pv[p] *= cap/kS[k]; pv[p] = Math.max(pv[p], molOf(p)/N0); }
}
// air the liquid left in cells off every pocket rises to the live pocket over it, or with none, joins its room's largest
function gather(){
  for(let i=0;i<N;i++){ const r = room[i]; if(pc[i] >= 0 || r < 0 || rPk[r] < 0 || !(nN[i] + nO[i] + nFpN[i] + nFpV[i] > 0)) continue;
    let j = i - W; while(j >= 0 && !gwall[j] && (pc[j] < 0 || !kA[pc[j]])) j -= W;
    moveAir(i, j >= 0 && !gwall[j] ? j : kCell[rPk[r]]); }
}
function settle(nk, live){ const dt = live ? DT[0] : 0;
  for(let k=0;k<nk;k++){ if(!(kV[k] > 0)){ kV[k] = Vc; kT[k] = T_HULL; kP[k] = P0; continue; } state(k);
    if(dt > 0){ const d = kT[k] - T_HULL, ad = d < 0 ? -d : d, q = Math.min(0.5*ad*(kN[k]*CV_N + kO[k]*CV_O + kC[k]), K.hwall*kA[k]*ad*dt);
      kE[k] -= d < 0 ? -q : d > 0 ? q : d*q; state(k); } }
  if(dt > 0) doors();
}
function spread(){
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; const s = vgOf(i)/kVg[k];
    nN[i] = kN[k]*s; nO[i] = kO[k]*s; eA[i] = kE[k]*s; if(HOT[3]){ nFpN[i] = kFN[k]*s; nFpV[i] = kFV[k]*s; }
    const g = (kP[k] - P0)/1000; if(g > pk[i]) pk[i] = g; }
}
// water pressure is the gas over the highest free surface plus the weight under it; the surface is read off cell fill so it never jumps a row (bTop < 0: none yet, -1 - top row)
function bodies(){
  bd.fill(-1); let nb = 0;
  for(let i=0;i<N;i++) if(bd[i] < 0 && wet(i)){ bRef[nb] = 1e30; bTop[nb] = -1 - ((i/W)|0); gridFlood(W, H, bd, stack, i, nb++, wet); }
  L.nb = nb;
  for(let i=W;i<N;i++){ const b = bd[i]; if(b < 0 || pc[i-W] < 0) continue; const s = ((i/W)|0) + 1 - lfill[i] - lfill[i-W]; if(bTop[b] < 0 || s < bTop[b]){ bTop[b] = s; bRef[b] = kP[pc[i-W]]; } }
  for(let i=0;i<N;i++){ const b = bd[i]; if(b < 0 || bTop[b] >= 0) continue; const x = i%W;
    if(i >= W && pc[i-W] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i-W]]);
    if(i+W < N && pc[i+W] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i+W]]);
    if(x > 0 && pc[i-1] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i-1]]);
    if(x < W-1 && pc[i+1] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i+1]]); }
  for(let b=0;b<nb;b++){ if(bTop[b] < 0) bTop[b] = -1 - bTop[b]; if(bRef[b] > 1e29) bRef[b] = P0; }
}

// an orifice between two pockets, never past equal pressure; the donor pays the enthalpy it sends, so it cools as it empties
function doors(){
  jetX.fill(0); jetY.fill(0);
  for(let j=0;j<L.nj;j++){ const a = pc[jCa[j]], b = pc[jCb[j]]; jU[j] = 0;
    if(a < 0 || b < 0 || a === b) continue;
    const dp = kP[a] - kP[b], d = dp >= 0 ? a : b, r = d === a ? b : a, nd = kN[d] + kO[d];
    if(!(nd > 0) || !(Math.abs(dp) > 0)) continue;
    const dt = DT[0], mm = (kN[d]*MX_N + kO[d]*MX_O)/nd, rho = kP[d]*mm/(RU*kT[d]);
    const w = K.cd*jArea[j]*Math.sqrt(2*rho*Math.abs(dp)), eq = Math.abs(dp)/(RU*kT[d])*kV[a]*kV[b]/(kV[a] + kV[b]);
    const f = Math.min(w/mm*dt, 0.5*eq)/nd, qn = kN[d]*f, qo = kO[d]*f, qe = kE[d]*f + (qn + qo)*RU*kT[d];
    kN[d] -= qn; kO[d] -= qo; kE[d] -= qe; kN[r] += qn; kO[r] += qo; kE[r] += qe;
    const fn = kFN[d]*f, fv = kFV[d]*f; kFN[d] -= fn; kFV[d] -= fv; kFN[r] += fn; kFV[r] += fv;
    const u = Math.min(50, f*nd*mm/dt/(rho*jArea[j]))/MPC*(d === a ? 1 : -1);
    jU[j] = u*MPC;
    for(let k=jC0[j];k<jC0[j+1];k++){ const i = jCells[k], o = jAxis[j] ? W : 1;
      for(let c=i-o;c<=i+o;c+=o) if(c >= 0 && c < N){ if(jAxis[j]) jetY[c] = u; else jetX[c] = u; } }
    state(a); state(b); }
}

function sources(){
  hotC.fill(0); HOT[0] = 0;
  for(let r=0;r<MAXSRC;r++){ const i = rCl[r]; if(rOn[r] === 1 && i >= 0 && !gwall[i]) source(r); }
  if(PN[1] > 0) gasParts();
  if(PN[3] > 0) skins();
}
// eRoomStep()'s machine skin (src/eng/room.js), copied: contents to skin to each cell's air; at H2_IGN_SURF it lights
function skins(){ const dt = DT[0];
  for(let a=0;a<MAXPART;a++) paQ[a] = 0;
  for(let i=0;i<N;i++){ const a = mach[i]; if(a < 0 || gwall[i]) continue; const q = ROOM_HK*(airT(i) - paSk[a]); paQ[a] += q; eA[i] -= 1000*q*dt; }
  for(let a=0;a<MAXPART;a++){ if(paK[a] !== 1 || !paN[a]) continue; const n = paN[a], qp = n*ROOM_HK*SKIN_PROC_K*(paT[a] - paSk[a]);
    BK[B_SKINQ] += 1000*qp*dt; paSk[a] = Math.min(ROOM_TMAX, Math.max(T_SPACE, paSk[a] + (qp + paQ[a])/skinCap(n)*dt)); }
  for(let i=0;i<N;i++){ const a = mach[i]; if(a >= 0 && paSk[a] >= H2_IGN_SURF) hot(i); }
}
// the cell a release into cell i puts its gas in: i's own air, or the gas over the liquid it is under
const airCell = i => pc[i] >= 0 ? i : colGasAbove(i) >= 0 ? colGasAbove(i) : i;
// inerting sets put nitrogen in and take nothing out; a vent OUT takes every gas off its cells in proportion to its mass there, a vent IN blows in air
function gasParts(){ const dt = DT[0];
  // a parcel at an OUT set's intake goes in whole while the set's step has room for it; the rest of the step is shared over the cell's gas
  if(PN[2] > 0){ for(let i=0;i<N;i++){ const v = vent[i]; vTk[i] = v >= 0 && paDir[v] === 0 && !gwall[i] ? ROOM_VENT_KGS/paN[v]*dt : 0; }
    let n = 0;
    for(let p=0;p<L.np;p++){ const k = kind[p]; if(LQ[k] === 1 || k === KQ) continue; const c = cellOf(p); if(!(pm[p] <= vTk[c])) continue;
      vTk[c] -= pm[p]; BK[k === KS ? B_RELS : B_RELG] += pm[p]; kind[p] = 0; n++; }
    if(n) sweep(); }
  for(let i=0;i<N;i++){ vfC[i] = 0; if(gwall[i]) continue;
    const a = inert[i]; if(a >= 0){ const n = INERT_KGS/paN[a]*dt/N2_MMOL; nN[i] += n; eA[i] += n*CV_N*(T_HULL - T0); BK[B_INERT] += n*N2_MMOL; }
    const v = vent[i]; if(v < 0) continue;
    const kg0 = ROOM_VENT_KGS/paN[v]*dt;
    if(paDir[v] === 1){ const n = kg0/AIR_MMOL, nn = n*(1 - O2_FRAC0), no = n*O2_FRAC0; nN[i] += nn; nO[i] += no; eA[i] += (nn*CV_N + no*CV_O)*(T_HULL - T0); BK[B_VENTIN] += kg0; continue; }
    const kg = vTk[i], m = Math.max(0, nN[i]*MX_N + nO[i]*MX_O + bV[i] + bH[i] + bC[i] + bD[i] + bS[i] + nFpN[i] + nFpV[i] - (kg0 - kg)); if(!(m > 0)) continue;
    const f = Math.min(1, kg/m); vfC[i] = f;
    BK[B_RELG] += f*(nN[i]*MX_N + nO[i]*MX_O); BK[B_RELN] += f*nFpN[i]; BK[B_RELV] += f*nFpV[i];
    nN[i] *= 1 - f; nO[i] *= 1 - f; eA[i] *= 1 - f; nFpN[i] *= 1 - f; nFpV[i] *= 1 - f; }
  if(PN[2] > 0) for(let p=0;p<L.np;p++){ const k = kind[p]; if(LQ[k] === 1) continue; const f = vfC[cellOf(p)]; if(!(f > 0)) continue;
    if(k === KQ){ BK[B_RELQ] += pE[p]*f; pE[p] *= 1 - f; } else { BK[k === KS ? B_RELS : B_RELG] += pm[p]*f; pm[p] *= 1 - f; } }
  if(PN[2] > 0) ventField();
}
// a vent OUT is a potential-flow sink (walls closed, the pocket expanding evenly to feed it)
function ventField(){ const D = ROOM_DEPTH;
  for(let k=0;k<L.npk;k++) kQv[k] = 0;
  for(let i=0;i<N;i++){ const v = vent[i], k = pc[i]; vsrc[i] = 0; if(v < 0 || paDir[v] === 1 || k < 0) continue;
    const nd = kN[k] + kO[k]; if(!(nd > 0)) continue;
    const q = ROOM_VENT_KGS/paN[v]*nd*RU*kT[k]/(kP[k]*(kN[k]*MX_N + kO[k]*MX_O)); vsrc[i] = q/D; kQv[k] += q; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k >= 0 && kQv[k] > 0) vsrc[i] -= kQv[k]*vgOf(i)/(kVg[k]*D); }
  for(let y=0, i=0;y<H;y++) for(let x=0;x<W;x++, i++){ const k = pc[i], on = k >= 0 && kQv[k] > 0;
    sAx[i] = on && x < W-1 && pc[i+1] === k ? 1 : 0; sAy[i] = on && y < H-1 && pc[i+W] === k ? 1 : 0; }
  for(let y=0, i=0;y<H;y++) for(let x=0;x<W;x++, i++){ const d = sAx[i] + sAy[i] + (x > 0 ? sAx[i-1] : 0) + (y > 0 ? sAy[i-W] : 0);
    sDg[i] = d; sM[i] = d > 0 ? 1 : 0; sB[i] = -vsrc[i]; }
  pcg(sM, sAx, sAy, sDg, sB, vphi);
  const s2 = 1/(2*MPC*MPC);
  for(let i=0;i<N;i++){ const k = pc[i]; vnX[i] = 0; vnY[i] = 0; if(k < 0 || !(kQv[k] > 0)) continue; const x = i%W, f = vphi[i];
    const ux = ((x > 0 && pc[i-1] === k ? vphi[i-1] - f : 0) + (x < W-1 && pc[i+1] === k ? f - vphi[i+1] : 0))*s2;
    const uy = ((i >= W && pc[i-W] === k ? vphi[i-W] - f : 0) + (i+W < N && pc[i+W] === k ? f - vphi[i+W] : 0))*s2;
    const u = hyp(ux, uy), c = u*MPC > 50 ? 50/(u*MPC) : 1; vnX[i] = ux*c; vnY[i] = uy*c; }
}
// conjugate gradients preconditioned by MIC(0) (Bridson 2008, Fluid Simulation for Computer Graphics) on the cells mask[c] = 1:
// dg[c] x[c] - sum a x[nb] = b[c], ax[c] the link to c + 1 and ay[c] to c + W, 0 where either end is off the mask; x warm; its iterations
const PCG_MAX = 500, PCG_TOL = 1e-10, MIC_T = 0.97, MIC_S = 0.25;
function pcg(mask, ax, ay, dg, b, x){
  const r = cgR, z = cgZ, s = cgS, q = cgQ, e = cgE;
  let bm = 0;
  for(let i=0;i<N;i++) if(mask[i]){ const v = b[i] < 0 ? -b[i] : b[i]; if(v > bm) bm = v; }
  if(!(bm > 0)){ for(let i=0;i<N;i++) if(mask[i]) x[i] = 0; return cgDone(0); }
  const tol = PCG_TOL*bm;
  for(let y=0, i=0;y<H;y++) for(let X=0;X<W;X++, i++){ if(!mask[i]){ e[i] = 0; continue; }
    const l = X > 0 ? ax[i-1]*e[i-1] : 0, u = y > 0 ? ay[i-W]*e[i-W] : 0;
    let d = dg[i] - l*l - u*u - MIC_T*((X > 0 ? ax[i-1]*ay[i-1]*e[i-1]*e[i-1] : 0) + (y > 0 ? ay[i-W]*ax[i-W]*e[i-W]*e[i-W] : 0));
    if(d < MIC_S*dg[i]) d = dg[i];
    e[i] = 1/Math.sqrt(d); }
  for(let i=0;i<N;i++) s[i] = mask[i] ? x[i] : 0;
  cgA(mask, ax, ay, dg, s, q);
  let rm = 0;
  for(let i=0;i<N;i++){ if(!mask[i]){ r[i] = 0; continue; } r[i] = b[i] - q[i]; const v = r[i] < 0 ? -r[i] : r[i]; if(v > rm) rm = v; }
  if(rm <= tol) return cgDone(0);
  cgM(mask, ax, ay, e, r, q, z);
  let sig = 0; for(let i=0;i<N;i++){ s[i] = z[i]; sig += r[i]*z[i]; }
  for(let it=1;it<=PCG_MAX;it++){
    cgA(mask, ax, ay, dg, s, q);
    let sq = 0; for(let i=0;i<N;i++) sq += s[i]*q[i];
    if(!(sq > 0)) return cgDone(it);
    const al = sig/sq; rm = 0;
    for(let i=0;i<N;i++){ if(!mask[i]) continue; x[i] += al*s[i]; r[i] -= al*q[i]; const v = r[i] < 0 ? -r[i] : r[i]; if(v > rm) rm = v; }
    if(rm <= tol) return cgDone(it);
    cgM(mask, ax, ay, e, r, q, z);
    let sn = 0; for(let i=0;i<N;i++) sn += r[i]*z[i];
    const be = sn/sig; sig = sn;
    for(let i=0;i<N;i++) s[i] = z[i] + be*s[i]; }
  return cgDone(PCG_MAX);
}
function cgDone(it){ L.pcgIt = it; L.pcgN++; L.pcgSum += it; if(it > L.pcgMax) L.pcgMax = it; return it; }
// q = A s over the mask, 0 off it
function cgA(mask, ax, ay, dg, s, q){
  for(let y=0, i=0;y<H;y++) for(let X=0;X<W;X++, i++){ if(!mask[i]){ q[i] = 0; continue; }
    let v = dg[i]*s[i];
    if(X > 0) v -= ax[i-1]*s[i-1]; if(X < W-1) v -= ax[i]*s[i+1]; if(y > 0) v -= ay[i-W]*s[i-W]; if(y < H-1) v -= ay[i]*s[i+W];
    q[i] = v; }
}
// z = M^-1 r through the incomplete factor, forward then back; q its scratch
function cgM(mask, ax, ay, e, r, q, z){
  for(let y=0, i=0;y<H;y++) for(let X=0;X<W;X++, i++){ if(!mask[i]){ q[i] = 0; continue; }
    let t = r[i]; if(X > 0) t += ax[i-1]*e[i-1]*q[i-1]; if(y > 0) t += ay[i-W]*e[i-W]*q[i-W]; q[i] = t*e[i]; }
  for(let y=H-1, i=N-1;y>=0;y--) for(let X=W-1;X>=0;X--, i--){ if(!mask[i]){ z[i] = 0; continue; }
    let t = q[i]; if(X < W-1) t += ax[i]*e[i]*z[i+1]; if(y < H-1) t += ay[i]*e[i]*z[i+W]; z[i] = t*e[i]; }
}
function hot(i){ if(!hotC[i]){ hotC[i] = 1; hotL[HOT[0]++] = i; } }
// a spawned lot of kind k a row holds under slot sl: m0 kg a lot, at the row's temperature
function lots(r, k, sl, m0){ const i = rCl[r], x = i%W + 0.5, y = ((i/W)|0) + 0.5;
  while(rRem[sl] >= m0){
    SPA[0] = x + (rnd() - 0.5)*0.4; SPA[1] = y + (rnd() - 0.5)*0.4; SPA[2] = m0; SPA[3] = rTk[r]; SPA[4] = (rnd() - 0.5)*4 + rUj[r]/MPC; SPA[5] = -2 - 2*rnd() + rVj[r]/MPC;
    if(spawn(k) < 0) break;
    rRem[sl] -= m0; }
}
// a liquid row fills its open particle rP (pSrc its row + 1) as mass arrives, as a stream pushes aside what it enters; under liquid the stream holds together until it is full
function openOf(r, k, m0){ const p = rP[r];
  if(p >= 0 && p < L.np && pSrc[p] === r + 1 && kind[p] === k && pm[p] < m0*(1 - 1e-9) && (cellOf(p) === rCl[r] || pc[rCl[r]] < 0)) return p;
  if(p >= 0 && p < L.np && pSrc[p] === r + 1) pSrc[p] = 0;
  rP[r] = -1; return -1; }
function openNew(r, k){ const i = rCl[r];
  SPA[0] = i%W + 0.5 + (rnd() - 0.5)*0.6; SPA[1] = ((i/W)|0) + 0.5 + (rnd() - 0.5)*0.6; SPA[2] = 0; SPA[3] = rTk[r]; SPA[4] = (rnd() - 0.5)*2 + rUj[r]/MPC; SPA[5] = 2 + rVj[r]/MPC;
  const p = spawn(k); if(p >= 0){ pSrc[p] = r + 1; rP[r] = p; } return p; }
// in air nothing is pushed aside, so a row there makes whole particles, rem kg its holding against m0; under liquid it grows one
function openAt(r, k, m0, rem){ const p = openOf(r, k, m0); if(p >= 0) return p; if(pc[rCl[r]] >= 0 && rem < m0) return -1; return openNew(r, k); }
// g kg arriving into p at the row's own velocity; a new particle keeps the spread it was made with
function feedV(r, p, g){ if(!(pm[p] > 0)) return; const s = pm[p] + g; vx[p] = (vx[p]*pm[p] + g*rUj[r]/MPC)/s; vy[p] = (vy[p]*pm[p] + g*(2 + rVj[r]/MPC))/s; }
function source(r){
  const i = rCl[r], R = rRt[r], x = i%W + 0.5, y = ((i/W)|0) + 0.5, dt = DT[0], o = 8*r, sk = rKd[r];
  if(sk === S_FLUID){
    if(R > 0){ rRem[o] += R*dt; L.inKg += R*dt;
      while(rRem[o] > 0){ const p = openAt(r, KW, MW0, rRem[o]); if(p < 0) break;
        const g = Math.min(rRem[o], MW0 - pm[p]); feedV(r, p, g); pT[p] = (pm[p]*pT[p] + g*rTk[r])/(pm[p] + g); pm[p] += g; ph[p] = hOf(p); rRem[o] -= g; } }
    else { let need = -R*dt;
      for(let p=L.np-1;p>=0 && need > 0;p--){ const dx = px[p] - x, dy = py[p] - y; if(kind[p] !== KW || dx*dx + dy*dy > 2.25) continue;
        SEG[0] = x; SEG[1] = y; SEG[2] = px[p]; SEG[3] = py[p]; if(!sees(i, cellOf(p), null)) continue;
        const g = Math.min(pm[p], need); DMA[0] = g; drainFp(p); pm[p] -= g; need -= g; L.inKg -= g; if(pm[p] < 1e-9) kill(p); } }
  }
  else if(sk === S_HEAT){ const E = R*1000*dt;
    if(fill[i] >= 0.5){ let m = 0; for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) m += pm[p];
      if(m > 0){ for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) pT[p] = Math.max(274, pT[p] + E/(m*CW)); return; } }
    if(R > 0){ rRem[o+3] += E; const e0 = R*1000/K.emit;
      while(rRem[o+3] >= e0){ SPA[0] = x + (rnd() - 0.5)*0.4; SPA[1] = y; SPA[2] = 0; SPA[3] = T_HULL; SPA[4] = rnd() - 0.5; SPA[5] = -1;
        const p = spawn(KQ); if(p < 0) break; pE[p] = e0; rRem[o+3] -= e0; }
      if(airT(i) + R/(0.01*(2*Af + 2*MPC*MPC)) >= H2_IGN_SURF) hot(i); }
    else if(pc[i] >= 0){ const cv = nN[i]*CV_N + nO[i]*CV_O; eA[i] -= Math.min(-E, Math.max(0, eA[i] - cv*(150 - T0))); }
  }
  else if(sk === S_H2 || sk === S_STEAM || sk === S_CO || sk === S_CO2){
    const k = sk === S_H2 ? KH : sk === S_STEAM ? KV : sk === S_CO ? KC : KD, sl = o + (k === KH ? 2 : k === KV ? 1 : k === KC ? 6 : 7);
    if(R > 0){ L.inKg += R*dt; rRem[sl] += R*dt; lots(r, k, sl, Math.abs(R)/K.emit); }
  }
  else if(sk === S_BREAK){ if(!(R > 0)) return; flashA(r, i);
    const xf = FL[0], Ts = FL[1], a = airCell(i), fa = rFV[r]*xf/FP_PC;
    nFpN[a] += rFN[r]*dt; L.inKg += R*dt; HOT[3] = 1;
    BK[B_BRKV] += xf*R*dt; BK[B_BRKW] += (1 - xf)*R*dt;
    if(xf > 0){ rRem[o+1] += xf*R*dt; rTk[r] = Ts; lots(r, KV, o+1, xf*R/K.emit); }
    if(!(xf < 1)){ nFpV[a] += rFV[r]*dt; return; }
    nFpV[a] += fa*dt; rRem[o] += (1 - xf)*R*dt; rRem[o+4] += (rFV[r] - fa)*dt;
    while(rRem[o] > 0){ const p = openAt(r, KW, MW0, rRem[o]); if(p < 0) break;
      const g = Math.min(rRem[o], MW0 - pm[p]), fp = rRem[o+4]*g/rRem[o]; feedV(r, p, g);
      pT[p] = (pm[p]*pT[p] + g*Ts)/(pm[p] + g); pm[p] += g; pFp[p] += fp; ph[p] = hOf(p); rRem[o+4] -= fp; rRem[o] -= g; }
  }
  else if(sk === S_FP){ const a = airCell(i); nFpN[a] += rFN[r]*dt; nFpV[a] += rFV[r]*dt; HOT[3] = 1; }
  // eFireStep()'s opening: a jet sprays on the gas Weber number and its spray share burns in flight in the air it enters, the rest pours
  else if(sk === S_METAL){ if(!(R > 0)) return;
    const f = FIRE[FIRE_KEYS[rMr[r]]], Tin = rTk[r], kg = R*dt, v = Math.sqrt(2*Math.max(0, rDp[r])/MF[1]), d = rBo[r];
    const we = ROOM_RHO*v*v*d/f.sigma, frac = d > 0 ? Math.min(1, Math.max(0, (we - SPRAY_WE0)/(SPRAY_WE1 - SPRAY_WE0))) : 0;
    const a = airCell(i), want = Tin >= f.ign && pc[a] >= 0 ? kg*frac*f.eta : 0, burnt = Math.min(want, nO[a]*O2_MMOL/f.o2);
    BK[B_METIN] += kg;
    if(burnt > 0){ nO[a] -= burnt*f.o2/O2_MMOL; eA[a] += burnt*(f.lhv + MF[0]/1000*(Tin - f.melt))*1000;
      GPA[0] = burnt*(1 + f.o2); GPA[1] = kT[pc[a]] + bQT[a]; gPut(a, 3); BK[B_SPRAY] += burnt; BK[B_SMOKE] += burnt*(1 + f.o2); }
    rRem[o+4] += kg - burnt; const m0 = MW0*MF[1]/RHO_W;
    MR[3] = Tin; metalEA();
    while(rRem[o+4] > 0){ const p = openAt(r, KM, m0, rRem[o+4]); if(p < 0) break; if(!(pm[p] > 0)){ pvf[p] = RHO_W/MF[1]; pMr[p] = rMr[r]; }
      const g = Math.min(rRem[o+4], m0 - pm[p]); feedV(r, p, g); pm[p] += g; pE[p] += g*MR[3]; metalT(p); ph[p] = hOf(p); rRem[o+4] -= g; }
  }
  // a pour of rTot kg at its composition; a vessel failing over dchP0 first blows its dispersed share into the air (dch())
  else if(sk === S_COR){ if(!(R > 0)) return;
    if(!rDch[r]){ rDch[r] = 1; if(rPv[r] >= CORIUM.dchP0 && rTot[r] < Infinity) dch(r, i); }
    const left = rTot[r] - rDone[r]; if(!(left > 0) && !(rRem[o+5] > 0)) return;
    const kg = Math.max(0, Math.min(R*dt, left)); rDone[r] += kg; rRem[o+5] += kg;
    const c = 5*r, v = RHO_W*((rCm[c] + rCm[c+1])/CORIUM.rhoDebris + rCm[c+3]/CORIUM.hdRho + rCm[c+4]/CORIUM.slagRho), m0 = MW0/v;
    CM[0] = rCm[c]; CM[1] = rCm[c+1]; CM[2] = rCm[c+3]; CM[3] = rCm[c+4]; CM[4] = rTk[r]; corEA(); CSA[1] = CM[7];
    // the pour's last share, if it fits under the join cap, goes into the particle it is filling, not a new one too small to sink
    const q = rP[r], cap = q >= 0 && q < L.np && pSrc[q] === r + 1 && pm[q] + rTot[r] - rDone[r] + rRem[o+5] <= K.jcap*m0 ? K.jcap*m0 : m0;
    while(rRem[o+5] > 0){ const p = openAt(r, KX, cap, rDone[r] < rTot[r] ? rRem[o+5] : Infinity); if(p < 0) break;
      const g = Math.min(rRem[o+5], cap - pm[p]); feedV(r, p, g); CSA[0] = g; corFeed(r, p); rRem[o+5] -= g; }
  }
  else if(sk === S_O2){ const n = R*dt/O2_MMOL; if(R < 0 && -n > nO[i]) return;
    nO[i] += n; eA[i] += n*CV_O*(T_HULL - T0); L.inKg += n*O2_MMOL; }
  else if(sk === S_GAS){ const m = nN[i]*MX_N + nO[i]*MX_O; if(!(m > 0)) return;
    const f = Math.min(0.5, Math.abs(R)*dt/m); L.inKg -= f*m; nN[i] *= 1 - f; nO[i] *= 1 - f; eA[i] *= 1 - f; }
}
// CSA[0] kg of row r's corium at SPA holding CSA[1] J/kg
const CSA = new Float64Array(2);
function corSpawn(r){ const q = spawn(KX); if(q < 0) return -1; corFeed(r, q); return q; }
// CSA[0] kg of row r's corium into q
function corFeed(r, q){ const c = 5*r, m = CSA[0], e = CSA[1];
  pCF[q] += rCm[c]*m; pCK[q] += rCm[c+1]*m; pCZ[q] += rCm[c+2]*m; pCS[q] += rCm[c+3]*m; pCX[q] += rCm[c+4]*m; pE[q] += e*m; pDw[q] += rDw[r]*m; pm[q] = pCF[q] + pCK[q] + pCS[q] + pCX[q];
  BK[B_CORIN] += m; BK[B_CORINE] += e*m; BK[B_INF] += rCm[c]*m; BK[B_INK] += rCm[c+1]*m; BK[B_INZ] += rCm[c+2]*m; BK[B_INS] += rCm[c+3]*m; BK[B_INX] += rCm[c+4]*m;
  corT(q); ph[q] = hOf(q); }
// eCorDch() (src/eng/room.js), copied, the TCE limit; the dispersed share then flies out as particles at the gas's temperature, not counted twice
function dch(r, i){ const p = rPv[r], f = Math.min(CORIUM.dchMax, CORIUM.dchMax*(p - CORIUM.dchP0)/(CORIUM.dchP1 - CORIUM.dchP0));
  const a = airCell(i), k = pc[a]; if(!(f > 0) || k < 0) return;
  const c = 5*r, Md = f*rTot[r], F = rCm[c]*Md, Kc = rCm[c+1]*Md, S = rCm[c+3]*Md, X = rCm[c+4]*Md, Tg = kT[k];
  CM[0] = F; CM[1] = Kc; CM[2] = S; CM[3] = X; CM[4] = rTk[r]; corEA(); const E0 = CM[7]; CM[4] = Tg; corEA();
  const dE = Math.max(0, E0 - CM[7]);
  BK[B_CORIN] += Md; BK[B_CORINE] += E0; BK[B_INF] += F; BK[B_INK] += Kc; BK[B_INZ] += rCm[c+2]*Md; BK[B_INS] += S; BK[B_INX] += X;
  let vap = 0; for(let j=0;j<N;j++) if(pc[j] === k) vap += bV[j];
  const wv = 2*H2O_MMOL/E_ZR_M, dZ = Math.min(rCm[c+2]*Md, vap/wv), q = dE + dZ*CORIUM.qZrH2o*1000, s = vap > 0 ? dZ*wv/vap : 0;
  for(let j=0;j<L.np;j++) if(kind[j] === KV && pc[cellOf(j)] === k) pm[j] *= 1 - s;
  GPA[0] = dZ*2*H2_MMOL/E_ZR_M; GPA[1] = Tg; gPut(a, 0); BK[B_H2MADE] += dZ*2*H2_MMOL/E_ZR_M; BK[B_DCHQ] += q; BK[B_CHEMQ] += dZ*CORIUM.qZrH2o*1000;
  for(let j=0;j<N;j++) if(pc[j] === k) eA[j] += q*vgOf(j)/kVg[k];
  const K2 = Kc + dZ*CORIUM.zro2PerZrO, Z2 = rCm[c+2]*Md - dZ, m2 = F + K2 + S + X;
  CM[0] = F; CM[1] = K2; CM[2] = S; CM[3] = X; CM[4] = Tg; corEA(); const e2 = CM[7]/m2;
  const rho = m2/((F + K2)/CORIUM.rhoDebris + S/CORIUM.hdRho + X/CORIUM.slagRho), v = Math.min(K.vcap, Math.sqrt(2*Math.max(0, p*1e6 - kP[k])/rho))/MPC;
  const m0 = MW0*rho/RHO_W, x = i%W + 0.5, y = ((i/W)|0) + 0.5;
  rDone[r] += Md;
  for(let left=m2;left>1e-9;){ const m = Math.min(m0, left), th = Math.PI*rnd();
    SPA[0] = x; SPA[1] = y; SPA[2] = m; SPA[3] = Tg; SPA[4] = v*Math.cos(th); SPA[5] = -v*Math.sin(th);
    const q2 = spawn(KX); if(q2 < 0) break; const w = m/m2;
    pCF[q2] = F*w; pCK[q2] = K2*w; pCZ[q2] = Z2*w; pCS[q2] = S*w; pCX[q2] = X*w; pE[q2] = e2*m; pDw[q2] = rDw[r]*m*Md/m2; corT(q2); ph[q2] = hOf(q2); left -= m; }
}
// eFlashXA() (src/eng/room.js) at the pocket's own pressure: the share of row r's water that flashes into FL[0], Tsat into FL[1]
const FL = new Float64Array(8);
function flashA(r, i){ const io = FL; io[0] = pAt(i)/1e6;
  satTA(SAT_WATER, io, 0, 1); curveA(SAT_WATER, CV_HFG, io, 1, 2); satHA(SAT_WATER, io, 0, 3);
  const hfg = io[2], x = hfg > 0 ? Math.min(1, Math.max(0, (rH[r] - io[3])/hfg)) : 1; io[0] = x; }
// a share DMA[0] kg drained off water particle p takes its share of the dissolved fission products and NaOH off the board with it
const DMA = new Float64Array(1);
function drainFp(p){ if(!(pm[p] > 0)) return; const f = Math.min(1, DMA[0]/pm[p]), a = pFp[p]*f, b = pSo[p]*f; pFp[p] -= a; pSo[p] -= b; BK[B_DRFP] += a; BK[B_DRSO] += b; }

// the particles of cell c are cP[cS[c]..cS[c+1]), ids high to low, and a row's cells lie end to end; pcel is the cell each was binned in
function grid(){
  const S = cS, U = cCur, Q = cP, C = pcel, n = L.np, nc = N;
  S.fill(0);
  for(let p=0;p<n;p++){ const c = cellOf(p); C[p] = c; S[c+1]++; }
  for(let c=0;c<nc;c++){ S[c+1] += S[c]; U[c] = S[c+1]; }
  for(let p=0;p<n;p++) Q[--U[C[p]]] = p;
}
// a pocket with less gas than one water particle holds is a gap in the grain, not a bubble: it keeps its air but pushes nothing
const bub = i => pc[i] >= 0 && kV[pc[i]]*RHO_W >= kM[pc[i]];
// bubN: a bubble within gasPush()'s widest reach of the cell, rows then columns, so a particle deep in a body skips its search; a pocket
// no harder than the softest body's reference pushes no water anywhere, as a free surface's own air, so it is left out
function bubs(){
  const D = Math.ceil(Math.max(K.spr, 0.5*HTOP));
  let bmin = Infinity; for(let b=0;b<L.nb;b++) if(bRef[b] < bmin) bmin = bRef[b];
  for(let k=0;k<L.npk;k++) bkA[k] = kV[k]*RHO_W >= kM[k] && kP[k] > bmin ? 1 : 0;
  for(let i=0;i<N;i++){ const k = pc[i]; bubN[i] = k >= 0 ? bkA[k] : 0; }
  // a running count over the window, the cell entering added and the one leaving dropped
  for(let y=0;y<H;y++){ const r = y*W; let k = 0; for(let a=0;a<D && a<W;a++) k += bubN[r + a];
    for(let x=0;x<W;x++){ if(x+D < W) k += bubN[r + x+D]; if(x-D-1 >= 0) k -= bubN[r + x-D-1]; bubX[r + x] = k > 0 ? 1 : 0; } }
  for(let x=0;x<W;x++){ let k = 0; for(let b=0;b<D && b<H;b++) k += bubX[b*W + x];
    for(let y=0;y<H;y++){ if(y+D < H) k += bubX[(y+D)*W + x]; if(y-D-1 >= 0) k -= bubX[(y-D-1)*W + x]; bubN[y*W + x] = k > 0 ? 1 : 0; } }
}
const bodyAt = c => bd[c] >= 0 ? bd[c] : c >= W && bd[c-W] >= 0 ? bd[c-W] : c+W < N && bd[c+W] >= 0 ? bd[c+W] : c%W > 0 && bd[c-1] >= 0 ? bd[c-1] : c%W < W-1 && bd[c+1] >= 0 ? bd[c+1] : -1;
// a pocket pressing harder than the water beside it does work p dV on it, V less the share of each cell book() gives the particle: the push is
// the gradient of that share, so it has no step where a particle crosses a cell edge, and a sealed bell holds the water out
function gasPush(p, c){ const dts = DT[1];
  const b = bodyAt(c); if(b < 0) return;
  const x = px[p], y = py[p], R = Math.max(K.spr, 0.5*ph[p]), Rc = Math.ceil(R), cx = c%W, cy = (c/W)|0, gw = RHO_W*K.grav*G*MPC;
  let n = 0, sw = 0, sx = 0, sy = 0, hot = 0;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc) && !hot;gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++) if(bub(gy*W + gx)){ hot = 1; break; }
  if(!hot) return;
  hot = 0;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc);gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++){ const i = gy*W + gx;
    if(wall[i]) continue;
    const ex = gx + 0.5 - x, ey = gy + 0.5 - y, d = Math.sqrt(ex*ex + ey*ey); if(d >= R) continue;
    SEG[2] = gx + 0.5; SEG[3] = gy + 0.5; if(!seesAB(c, i, gx - cx, gy - cy)) continue;
    const u = 1 - d/R, k = d > 1e-9 ? 2*u/(R*d) : 0;
    spC[n] = i; spW[n] = u*u; spX[n] = k*ex; spY[n] = k*ey; sw += u*u; sx += k*ex; sy += k*ey; n++;
    if(bub(i)) hot = 1; }
  if(!hot || !(sw > 0)) return;
  let ax = 0, ay = 0;
  for(let q=0;q<n;q++){ const i = spC[q]; if(!bub(i)) continue;
    const e = kP[pc[i]] - bRef[b] - gw*Math.max(0, ((i/W)|0) + 0.5 - bTop[b]); if(!(e > 0)) continue;
    ax -= e*(spX[q]*sw - spW[q]*sx)/(sw*sw); ay -= e*(spY[q]*sw - spW[q]*sy)/(sw*sw); }
  const rho = RHO_W/pvf[p], a = Math.sqrt(ax*ax + ay*ay)/(rho*MPC), s = a > 20*G ? 20*G/a : 1, f = s*dts/(rho*MPC*MPC);
  vx[p] += ax*f; vy[p] += ay*f;
}
// each particle's forces, then its predicted position: a force reads no other particle's position
function forces(){ const dts = DT[1];
  const vs = RHO_SM*G*K.sd*K.sd*1e-12/(18*MU_AIR);
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(frz[p]){ vx[p] = 0; vy[p] = 0; ox[p] = px[p]; oy[p] = py[p]; continue; }
    if(LQ[k] === 1){ vy[p] += K.grav*G/MPC*dts; if(bubN[c]) gasPush(p, c); }
    else {
      // a parcel rises at about sqrt(g' r), g' its buoyancy as mixed so far: a diluted parcel slows; CO2 sinks, and smoke falls at its Stokes speed
      let ub = 3;
      if(k === KS) ub = -vs;
      else if(pc[c] >= 0){ const x = xOf(p), ta = kT[pc[c]];
        if(k === KC || k === KD){ const gp = G*x*(1 - IM[k]/AIR_MMOL); ub = (gp < 0 ? -1 : 1)*Math.min(4, Math.sqrt(Math.abs(gp)*pr[p]*MPC)); }
        else { const gp = k === KH ? G*x*(1 - H2_MMOL/AIR_MMOL) : k === KV ? G*x*(1 - H2O_MMOL/AIR_MMOL*ta/pT[p]) : G*pd[p]/ta;
          ub = Math.min(4, Math.sqrt(Math.max(0, gp)*pr[p]*MPC)); } }
      const f = Math.min(1, K.rise*dts);
      vx[p] += (jetX[c] + vnX[c] - vx[p])*f + (rnd() - 0.5)*K.turb*dts;
      vy[p] += (jetY[c] + vnY[c] - ub/MPC - vy[p])*f + (rnd() - 0.5)*K.turb*dts; }
    ox[p] = px[p]; oy[p] = py[p]; px[p] += vx[p]*dts; py[p] += vy[p]*dts; }
}
// the columns of row gy particle p's reach plus SKIN can touch, one run of cP: widened 1e-6 against rounding, the board's edge rows and columns always in (cellAt() clamps past them)
const SPAN = new Int32Array(2);
function span(p, gy, cx, R){
  const x = px[p], y = py[p], hq = 0.5*(ph[p] + HM[0]) + SKIN, hq2 = hq*hq;
  const ey = gy === 0 || gy === H - 1 ? 0 : gy > y ? gy - y : y > gy + 1 ? y - (gy + 1) : 0;
  if(ey*ey >= hq2){ SPAN[0] = 1; SPAN[1] = 0; return; }
  const half = Math.sqrt(hq2 - ey*ey) + 1e-6, x0 = Math.max(0, cx-R), x1 = Math.min(W-1, cx+R);
  SPAN[0] = x0 === 0 ? 0 : Math.max(x0, Math.floor(x - half)); SPAN[1] = x1 === W-1 ? x1 : Math.min(x1, Math.floor(x + half));
}
// the candidate pairs, each once (a < b): the water pairs within their kernel plus SKIN at the build. Those a wall corner may cut or bend
// are listed apart in kfA, kfB and have their sight asked at each use; the rest had it settled here, and it holds until a particle moves SKIN/2
function pbuild(){
  const X = px, Y = py, PH = ph, KD = kind, S = cS, Q = cP, C = pcel, A = cA, B = cB, FA = kfA, FB = kfB, w = W, hm = HM[0], n = L.np, cap = A.length, fcap = FA.length, sk = SKIN;
  let k = 0, kf = 0;
  for(let p=0;p<n;p++){ if(LQ[KD[p]] !== 1) continue;
    const x = X[p], y = Y[p], hp = PH[p], c = cellOf(p), cx = c%w, cy = (c/w)|0, R = Math.ceil(0.5*(hp + hm) + sk), nv = nearV[c];
    pbX[p] = x; pbY[p] = y;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++){ span(p, gy, cx, R); if(SPAN[0] > SPAN[1]) continue;
      for(let gi=S[gy*w + SPAN[0]], g1=S[gy*w + SPAN[1] + 1];gi<g1;gi++){ const j = Q[gi]; if(j <= p || LQ[KD[j]] !== 1) continue;
        const xj = X[j], yj = Y[j], dx = xj - x, dy = yj - y, r2 = dx*dx + dy*dy, h = 0.5*(hp + PH[j]) + sk; if(r2 >= h*h) continue;
        SEG[0] = x; SEG[1] = y; SEG[2] = xj; SEG[3] = yj;
        let f = 0;
        if(!nv){ if(!seesAB(c, C[j], C[j] - gy*w - cx, gy - cy)) continue; }
        // with each end moving at most SKIN/2 the line keeps its sight while no corner lies that close to it, and a bent path shortens by SKIN at most
        else if(clear() || hit(false) < 0){ if(nearCvx()) f = 1; }
        else { BND[0] = h; bend(p, j); if(!(BND[0] < h)) continue; f = 1; }
        if(f){ if(kf === fcap){ L.pdrop++; continue; } FA[kf] = p; FB[kf] = j; kf++; continue; }
        if(k === cap){ L.pdrop++; continue; }
        A[k] = p; B[k] = j; k++; } } }
  L.ncand = k; L.nflag = kf; L.pbuilt = true;
}
// a wall corner lies within SKIN/2 of SEG
function nearCvx(){ const w = W + 1, xa = SEG[0], ya = SEG[1], xb = SEG[2], yb = SEG[3], d = 0.5*SKIN, dx = xb - xa, dy = yb - ya, l2 = dx*dx + dy*dy;
  const X0 = Math.max(0, Math.floor(Math.min(xa, xb) - d)), X1 = Math.min(W, Math.ceil(Math.max(xa, xb) + d));
  const Y0 = Math.max(0, Math.floor(Math.min(ya, yb) - d)), Y1 = Math.min(H, Math.ceil(Math.max(ya, yb) + d));
  for(let Y=Y0;Y<=Y1;Y++) for(let X=X0;X<=X1;X++){ if(!cvx[Y*w + X]) continue;
    const ex = X - xa, ey = Y - ya; let t = l2 > 0 ? (ex*dx + ey*dy)/l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ux = ex - t*dx, uy = ey - t*dy; if(ux*ux + uy*uy <= d*d) return true; }
  return false; }
// the live water pairs, each once (a < b): q = 1 - r/h and g = q^2/h^2 over the length r of the pair's path, and the way each end leaves along it;
// a pair's kernel is the mean of its two, so it is the same seen from either end; a blocked path bends round the corners (bend()), so a
// pair fades out round a tip: switched off whole by sight, it fed the water round it
function pairs(){
  const X = px, Y = py, PH = ph, KD = kind, n = L.np, s2 = 0.25*SKIN*SKIN;
  let ok = L.pbuilt;
  if(ok) for(let p=0;p<n;p++){ if(LQ[KD[p]] !== 1) continue; const dx = X[p] - pbX[p], dy = Y[p] - pbY[p]; if(dx*dx + dy*dy > s2){ ok = false; break; } }
  if(!ok) pbuild();
  const A = cA, B = cB, E = prE, Q = prQ, BX = prBX, BY = prBY, D = dnA, PW = pw, m = L.ncand;
  for(let p=0;p<2*n;p++) D[p] = 0;
  let k = 0;
  for(let i=0;i<m;i++){ const p = A[i], j = B[i], dx = X[j] - X[p], dy = Y[j] - Y[p], r2 = dx*dx + dy*dy, h = 0.5*(PH[p] + PH[j]);
    if(r2 >= h*h) continue;
    const r = Math.sqrt(r2), ir = r >= 1e-6 ? 1/r : 0, ax = dx*ir, ay = dy*ir, ih = 1/h, q = 1 - r*ih, g = q*q*ih*ih, gq = g*q;
    E[2*k] = p; E[2*k+1] = j; Q[3*k] = q; Q[3*k+1] = ax; Q[3*k+2] = ay; k++;
    D[2*p] += PW[j]*g; D[2*p+1] += PW[j]*gq; D[2*j] += PW[p]*g; D[2*j+1] += PW[p]*gq; }
  L.nstraight = k;
  for(let i=0, mf=L.nflag;i<mf;i++){ const p = kfA[i], j = kfB[i], xa = X[p], ya = Y[p], dx = X[j] - xa, dy = Y[j] - ya, r2 = dx*dx + dy*dy, h = 0.5*(PH[p] + PH[j]);
    if(r2 >= h*h) continue;
    let r = Math.sqrt(r2), ax = 0, ay = 0, bx = 0, by = 0;
    if(r >= 1e-6){ ax = dx/r; ay = dy/r; bx = -ax; by = -ay; }
    SEG[0] = xa; SEG[1] = ya; SEG[2] = X[j]; SEG[3] = Y[j];
    if(!clear() && hit(false) >= 0){ BND[0] = h; bend(p, j); r = BND[0]; if(!(r < h)) continue; ax = BND[1]; ay = BND[2]; bx = BND[3]; by = BND[4]; }
    const q = 1 - r/h, g = q*q/(h*h), gq = g*q; E[2*k] = p; E[2*k+1] = j; Q[3*k] = q; Q[3*k+1] = ax; Q[3*k+2] = ay; BX[k] = bx; BY[k] = by; k++;
    D[2*p] += PW[j]*g; D[2*p+1] += PW[j]*gq; D[2*j] += PW[p]*g; D[2*j+1] += PW[p]*gq; }
  L.npair = k;
}
// the shortest path from p to j round the wall corners in reach, through one corner or along one cell face between two, into BND if it
// is shorter than BND[0]: its length, and the unit way p leaves along it (1, 2) and j does (3, 4)
const BND = new Float64Array(5);
function bend(p, j){
  const xa = px[p], ya = py[p], xb = px[j], yb = py[j], w = W + 1, e = 0.5*BND[0];
  const X0 = Math.max(0, Math.floor(Math.min(xa, xb) - e)), X1 = Math.min(W, Math.ceil(Math.max(xa, xb) + e));
  const Y0 = Math.max(0, Math.floor(Math.min(ya, yb) - e)), Y1 = Math.min(H, Math.ceil(Math.max(ya, yb) + e));
  // the corners p and j leave toward, kept as corners so no float crosses a call
  let best = BND[0], va = -1, vb = -1;
  for(let Y=Y0;Y<=Y1;Y++) for(let X=X0;X<=X1;X++){ if(!cvx[Y*w + X]) continue;
    const ux = X - xa, uy = Y - ya, da = Math.sqrt(ux*ux + uy*uy); if(!(da < best)) continue;
    let la = -1;
    const vx1 = X - xb, vy1 = Y - yb, db = Math.sqrt(vx1*vx1 + vy1*vy1);
    if(da + db < best){ la = leg(p, X, Y) ? 1 : 0; if(la && leg(j, X, Y)){ best = da + db; va = Y*w + X; vb = va; } }
    // along the face to the next corner: the cell face between them has wall on one side only
    for(let s=0;s<4;s++){ const X2 = s === 0 ? X + 1 : s === 1 ? X - 1 : X, Y2 = s === 2 ? Y + 1 : s === 3 ? Y - 1 : Y;
      if(X2 < 0 || Y2 < 0 || X2 > W || Y2 > H || !cvx[Y2*w + X2]) continue;
      const mx = Math.min(X, X2), my = Math.min(Y, Y2), f1 = s < 2 ? solid(mx, my - 1) : solid(mx - 1, my), f2 = solid(mx, my); if(f1 === f2) continue;
      const wx = X2 - xb, wy = Y2 - yb, d2 = Math.sqrt(wx*wx + wy*wy); if(!(da + 1 + d2 < best)) continue;
      if(la < 0) la = leg(p, X, Y) ? 1 : 0;
      if(la && leg(j, X2, Y2)){ best = da + 1 + d2; va = Y*w + X; vb = Y2*w + X2; } } }
  if(va < 0) return;
  const ux = va%w - xa, uy = ((va/w)|0) - ya, da = Math.sqrt(ux*ux + uy*uy), wx = vb%w - xb, wy = ((vb/w)|0) - yb, db = Math.sqrt(wx*wx + wy*wy);
  BND[0] = best; BND[1] = da > 1e-9 ? ux/da : 0; BND[2] = da > 1e-9 ? uy/da : 0; BND[3] = db > 1e-9 ? wx/db : 0; BND[4] = db > 1e-9 ? wy/db : 0;
}
// particle q sees the wall corner (X, Y) past no wall: the line stops 1e-5 short, as a line ending on a corner reads either cell beside it
function leg(q, X, Y){ const x = px[q], y = py[q], dx = x - X, dy = y - Y, d = Math.sqrt(dx*dx + dy*dy); if(d < 1e-9) return true;
  const u = 1e-5/d; SEG[0] = x; SEG[1] = y; SEG[2] = X + dx*u; SEG[3] = Y + dy*u; return clear() || hit(false) < 0; }
// wallSum() of every water particle where it stands: water() reads the one pass
function wallPass(){ for(let p=0;p<L.np;p++) if(LQ[kind[p]] === 1) wallSum(p, cxOf(p), cyOf(p)); }
// viscosity on the predicted positions, so each impulse moves its particle too, as it would have moved had it come before the prediction;
// then the density relaxation, minus the gradient of U = sum m h^3/(pw dts^2) (Phi(rho)/4 + near nz (rn - rn0)^2/12) for any mix of sizes and
// liquids: a pair's force is equal and opposite and moves each end by it over its own mass, so momentum closes, save for a pair bent round a
// corner, whose corner takes the difference. A straight pair's B end leaves along -A. U carries mass, not volume, so each liquid is as stiff as
// water at its own density and a lighter liquid floats
function water(){ const dts = DT[1];
  const X = px, Y = py, VX = vx, VY = vy, PM = pm, PH = ph, PW = pw, KD = kind, M = mvA, E = prE, Q = prQ, BX = prBX, BY = prBY, D = dnA, PP = prP, T = wsA, n = L.np;
  const rho0 = RHO0, rn0 = RN0, pull = K.pull, stiff = K.stiff, near = K.near, wpull = K.wpull, visc = K.visc, vb = K.vb, ks = L.nstraight, m = L.npair;
  for(let p=0;p<n;p++){ if(LQ[KD[p]] !== 1) continue;
    // the wall is water at rest that does not move: it fills the kernel it cuts, and it takes none of the push
    const o = 8*p, w2 = T[o+2], w3 = T[o+3], rho = D[2*p] + T[o], rn = D[2*p+1] + T[o+1];
    // the pull keeps its own gain, so stiffness only sets how hard water resists squeezing
    // a push that never lets go, held by a pull, is a pair potential with a well at the lattice spacing: a crystal with a shear strength
    // a push summed over a crowd at full gain overshoots the overlap and makes energy: past rest it is divided by the crowding (Macklin and Mueller 2013)
    const nz = rho > rho0 ? rho0/rho : 1;
    const P = (rho < rho0 ? pull : stiff)*(rho - rho0)*nz, Pn = near*Math.max(0, rn - rn0)*nz;
    // the gains are per substep in cells whatever the size, as at one particle a cell: scaled down with size, big water stood loose and never settled
    // minus the gradient of U + W in the wall's fill, so a fixed wall does no work round a loop; the wall stands for rows of p's own liquid
    const cu = PH[p]*PH[p]*PH[p]/PW[p], mc = PM[p]*cu;
    wallE(T[o], T[o+1]); const a0 = P/4 + WE[1], a1 = Pn/6 + WE[2];
    let sx = -cu*(a0*T[o+4] + a1*T[o+6]), sy = -cu*(a0*T[o+5] + a1*T[o+7]);
    // a wall a metre across does not pull water to it: tension drew a surface particle onto the face, and the face threw it back
    if(!wpull && sx*w2 + sy*w3 > 0){ sx = 0; sy = 0; }
    PP[2*p] = mc*P; PP[2*p+1] = mc*Pn; M[2*p] += sx; M[2*p+1] += sy; wdA[2*p] = sx; wdA[2*p+1] = sy; }
  // viscous stress follows the strain rate both ways: damped only as they close, particles rattled apart with nothing to stop them;
  // each end pushes the pair with its own pressure, so the pair takes the sum of the two
  for(let k=0;k<ks;k++){ const p = E[2*k], j = E[2*k+1], q = Q[3*k], mp = PM[p], mj = PM[j], ax = Q[3*k+1], ay = Q[3*k+2];
    const u = VX[p]*ax + VY[p]*ay - VX[j]*ax - VY[j]*ay;
    const I = 0.5*dts*q*(visc*u + vb*u*Math.abs(u)), s = 2/(mp + mj), ip = I*mj*s, ij = I*mp*s;
    VX[p] -= ip*ax; VY[p] -= ip*ay; VX[j] += ij*ax; VY[j] += ij*ay;
    X[p] -= ip*ax*dts; Y[p] -= ip*ay*dts; X[j] += ij*ax*dts; Y[j] += ij*ay*dts;
    const hh = 0.5*(PH[p] + PH[j]), f = 0.5*q/(hh*hh*hh)*(PW[j]*(PP[2*p] + PP[2*p+1]*q) + PW[p]*(PP[2*j] + PP[2*j+1]*q)), dj = f/mj, dp = f/mp;
    M[2*j] += dj*ax; M[2*j+1] += dj*ay; M[2*p] -= dp*ax; M[2*p+1] -= dp*ay; }
  for(let k=ks;k<m;k++){ const p = E[2*k], j = E[2*k+1], q = Q[3*k], mp = PM[p], mj = PM[j], ax = Q[3*k+1], ay = Q[3*k+2], bx = BX[k], by = BY[k];
    const u = VX[p]*ax + VY[p]*ay + VX[j]*bx + VY[j]*by;
    const I = 0.5*dts*q*(visc*u + vb*u*Math.abs(u)), s = 2/(mp + mj), ip = I*mj*s, ij = I*mp*s;
    VX[p] -= ip*ax; VY[p] -= ip*ay; VX[j] -= ij*bx; VY[j] -= ij*by;
    X[p] -= ip*ax*dts; Y[p] -= ip*ay*dts; X[j] -= ij*bx*dts; Y[j] -= ij*by*dts;
    const hh = 0.5*(PH[p] + PH[j]), f = 0.5*q/(hh*hh*hh)*(PW[j]*(PP[2*p] + PP[2*p+1]*q) + PW[p]*(PP[2*j] + PP[2*j+1]*q)), dj = f/mj, dp = f/mp;
    M[2*j] -= dj*bx; M[2*j+1] -= dj*by; M[2*p] -= dp*ax; M[2*p+1] -= dp*ay; }
  if(TAP !== null) TAP(3);
  shear(0); shear(1);
  // the wall is water at rest that does not move: it drags on what moves against it as a neighbour would, or water rattles on a floor forever.
  // Every push reads the positions the pass began at: moved in place, the pool's result hung on the order its particles are stored in
  for(let p=0;p<n;p++){
    if(LQ[KD[p]] === 1){ const wx = T[8*p+2], wy = T[8*p+3], wn = Math.sqrt(wx*wx + wy*wy);
      if(wn > 0){ const ux = wx/wn, uy = wy/wn, u = VX[p]*ux + VY[p]*uy, k = Math.min(1, dts*wn*(visc + vb*Math.abs(u)));
        VX[p] -= k*u*ux; VY[p] -= k*u*uy; X[p] -= k*u*ux*dts; Y[p] -= k*u*uy*dts; } }
    X[p] += M[2*p]; Y[p] += M[2*p+1]; M[2*p] = 0; M[2*p+1] = 0; }
}
// the wall's shear on liquid sliding along it, per face run: a column (a = 0: floor and ceiling, along x) or a row (a = 1: side walls,
// along y) of open cells between two walls, each face taking the half nearer it, depth-averaged (Saint-Venant)
function shear(a){ const dts = DT[1], n = L.np, Nq = a ? px : py, Tq = a ? py : px, Tv = a ? vy : vx, D = ROOM_DEPTH;
  fM.fill(0); fV.fill(0); fPp.fill(0); fPn.fill(0); fU.fill(0); fD.fill(1); tA.fill(0); tB.fill(0);
  let wet = 0;
  for(let p=0;p<n;p++){ const k = kind[p]; if(LQ[k] !== 1 || frz[p]) continue;
    const cx = cxOf(p), cy = cyOf(p), c = cy*W + cx; if(wall[c]) continue;
    const s = Nq[p] - (a ? cx : cy), i = 2*c + (s < 0.5 ? 0 : 1), m = pm[p], v = m*pvf[p]/RHO_W, mv = m*Tv[p];
    fM[i] += m; fV[i] += v; if(mv > 0) fPp[i] += mv; else fPn[i] += mv; fU[i] += m*pmu[p];
    // a face shears only what its push reaches: a particle it holds off is one touching it
    const fp = Math.sqrt(v/D), h = ph[p];
    if(s < h && (a ? solid(cx - 1, cy) : solid(cx, cy - 1))){ tA[c] += fp; wet = 1; }
    if(1 - s < h && (a ? solid(cx + 1, cy) : solid(cx, cy + 1))){ tB[c] += fp; wet = 1; } }
  if(!wet) return;
  const nl = a ? W : H, nr = a ? H : W, st = a ? 1 : W, sr = a ? W : 1;
  for(let r=0;r<nr;r++) for(let l=0;l<nl;){ if(wall[r*sr + l*st]){ l++; continue; }
    let e = l; while(e + 1 < nl && !wall[r*sr + (e + 1)*st]) e++;
    const lo = r*sr + l*st, hi = r*sr + e*st, len = e - l + 1;
    wrun(lo, st, len, 0, l > 0 ? lo - st : -1);
    wrun(hi, -st, len, 1, e + 1 < nl && !(a === 0 && pan[hi] >= 0) ? hi + st : -1);
    l = e + 1; }
  for(let p=0;p<n;p++){ const k = kind[p]; if(LQ[k] !== 1 || frz[p]) continue;
    const cx = cxOf(p), cy = cyOf(p), c = cy*W + cx; if(wall[c]) continue;
    const i = 2*c + (Nq[p] - (a ? cx : cy) < 0.5 ? 0 : 1), l = fD[i], v = Tv[p]; if(l === 1 || !(v*fS[i] > 0)) continue;
    const dv = (1 - l)*v; Tv[p] -= dv; Tq[p] -= dv*dts; const q = 0.5*pm[p]*(v*v - (v - dv)*(v - dv))*MPC*MPC; BK[B_FRQ] += q;
    heatIn(p, q); }
}
function heatIn(p, q){ if(kind[p] === KW) pT[p] += q/(pm[p]*CW); else { pE[p] += q; liqT(p); } }
// one face's run, len half cells from cell c0 out along d, its wall cell w (-1: steel): Darcy, tau = (f/8) rho u|u| on Dh = 4h, f the larger of
// the laminar sheet's 96/Re and Haaland 1983; implicit, so the run never reverses. The impulse comes off the particles moving the run's way, each
// scaled by one factor into fD (its sign in fS): a same loss off every particle sped up those moving against the run
function wrun(c0, d, len, hi, w){ const t = hi ? tB[c0] : tA[c0]; if(!(t > 0)) return;
  let M = 0, V = 0, Pp = 0, Pn = 0, U = 0;
  for(let j=0;j<len;j++){ const i = 2*(c0 + (j >> 1)*d) + ((j & 1) ^ hi); M += fM[i]; V += fV[i]; Pp += fPp[i]; Pn += fPn[i]; U += fU[i]; }
  if(!(M > 0)) return;
  const A = MPC*ROOM_DEPTH*Math.min(1, t/MPC), h = V/A, u = (Pp + Pn)/M*MPC, au = Math.abs(u), rho = M/V, mu = U/M, Re = rho*au*4*h/mu;
  if(u === 0) return;
  let k = 3*mu/(rho*h*h);
  // Haaland's log leaves its range at small Re, where the sheet is laminar anyway
  if(Re > 100){ const x = -1.8*Math.log10(Math.pow((w < 0 ? EPS_ST : rgh[w])/(4*h)/3.7, 1.11) + 6.9/Re), kt = au/(8*x*x*h); if(kt > k) k = kt; }
  k *= K.fric;
  const u1 = u/(1 + DT[1]*k), l = 1 - M*(u - u1)/MPC/(u > 0 ? Pp : Pn), s = u > 0 ? 1 : -1;
  for(let j=0;j<len;j++){ const i = 2*(c0 + (j >> 1)*d) + ((j & 1) ^ hi); fD[i] = l; fS[i] = s; }
}
// parcels crowd apart to the room their mixture takes, so a layer under a ceiling thickens downward as more arrives
function repel(){
  const R = Math.ceil(2*RMAX);
  for(let p=0;p<L.np;p++){ if(LQ[kind[p]] === 1) continue;
    const c = cellOf(p); if(!gasC(c)) continue;
    const cx = c%W, cy = (c/W)|0;
    // a wall crowds as p's mirror image would; smoke is aerosol mass, not gas volume, and must reach a face to settle on it
    if(kind[p] !== KS){ const r = Math.min(pr[p], RMAX), n = Math.ceil(r), fx = px[p] - cx, fy = py[p] - cy, k = K.crowd; let mx = 0, my = 0;
      for(let s=1;s<=n;s++) if(gsolid(cx - s, cy)){ mx += Math.max(0, k*(r - fx - s + 1)); break; }
      for(let s=1;s<=n;s++) if(gsolid(cx + s, cy)){ mx -= Math.max(0, k*(r - s + fx)); break; }
      for(let s=1;s<=n;s++) if(gsolid(cx, cy - s)){ my += Math.max(0, k*(r - fy - s + 1)); break; }
      for(let s=1;s<=n;s++) if(gsolid(cx, cy + s)){ my -= Math.max(0, k*(r - s + fy)); break; }
      if((mx !== 0 || my !== 0) && gasAt((px[p] + mx)|0, (py[p] + my)|0)){ px[p] += mx; py[p] += my; } }
    const x = px[p], y = py[p], rp = pr[p];
    SEG[0] = x; SEG[1] = y;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(j <= p || LQ[kind[j]] === 1) continue;
        const dx = px[j] - x, dy = py[j] - y, d0 = rp + pr[j], r2 = dx*dx + dy*dy; if(r2 >= d0*d0 || r2 < 1e-12) continue;
        const cj = cellOf(j); if(!gasC(cj)) continue;
        SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(c, cj)) continue;
        const r = Math.sqrt(r2), D = 0.5*K.crowd*(d0 - r), ux = D*dx/r, uy = D*dy/r;
        if(!gasAt((px[j] + ux)|0, (py[j] + uy)|0) || !gasAt((px[p] - ux)|0, (py[p] - uy)|0)) continue;
        px[j] += ux; py[j] += uy; px[p] -= ux; py[p] -= uy; } }
}
// crowding stands in for the pocket's own volume: it never pushes a parcel into the water
const gasAt = (ix, iy) => gasC(cellAt(ix, iy));
const inMargin = (x, y, sd) => { const cx = Math.floor(x), cy = Math.floor(y);
  return solid(cx, cy) || x - cx < sd && solid(cx - 1, cy) || x - cx > 1 - sd && solid(cx + 1, cy) || y - cy < sd && solid(cx, cy - 1) || y - cy > 1 - sd && solid(cx, cy + 1); };
// no particle moves more than K.dmax a substep, and it meets a wall one axis at a time, so it never tunnels
function collide(p){
  const xo = ox[p], yo = oy[p]; let dx = px[p] - xo, dy = py[p] - yo;
  const d = Math.sqrt(dx*dx + dy*dy); if(d > K.dmax){ dx *= K.dmax/d; dy *= K.dmax/d; }
  let x = xo + dx, y = yo + dy;
  // a move under a cell asks solid() no further than two cells from where it began
  if(K.dmax < 1 && xo >= 0 && yo >= 0 && xo < W && yo < H && !near2[(yo|0)*W + (xo|0)]){ px[p] = x; py[p] = y; return; }
  // a move that stays in its cell asks only that cell, three times over
  const ixo = Math.floor(xo), iyo = Math.floor(yo), lq = LQ[kind[p]] === 1;
  if(Math.floor(x) !== ixo || Math.floor(y) !== iyo || (lq ? solid(ixo, iyo) : gsolid(ixo, iyo))){
    if(lq ? solid(Math.floor(x), iyo) : gsolid(Math.floor(x), iyo)){ x = dx > 0 ? ixo + 1 - EPS : ixo + EPS; }
    if(lq ? solid(Math.floor(x), Math.floor(y)) : gsolid(Math.floor(x), Math.floor(y))){ y = dy > 0 ? iyo + 1 - EPS : iyo + EPS; }
    if(lq ? solid(Math.floor(x), Math.floor(y)) : gsolid(Math.floor(x), Math.floor(y))){ x = xo; y = yo; } }
  // a liquid particle has a size: its centre keeps an eighth of its kernel off a wall face, where the wall term would throw it back hard
  if(lq){ const sd = 0.125*ph[p], cx = Math.floor(x), cy = Math.floor(y);
    if(x - cx < sd && solid(cx - 1, Math.floor(y))) x = cx + sd; else if(x - cx > 1 - sd && solid(cx + 1, Math.floor(y))) x = cx + 1 - sd;
    if(y - cy < sd && solid(Math.floor(x), cy - 1)) y = cy + sd; else if(y - cy > 1 - sd && solid(Math.floor(x), cy + 1)) y = cy + 1 - sd;
    // and as far off a corner the wall turns round, so a particle slipping round it is eased out, never thrown across a cell line
    const gx = Math.floor(x), gy = Math.floor(y), X = x - gx < 0.5 ? gx : gx + 1, Y = y - gy < 0.5 ? gy : gy + 1, sx = X === gx ? -1 : 1, sy = Y === gy ? -1 : 1;
    if(gx >= 0 && gy >= 0 && gx < W && gy < H ? (cvn[gy*W + gx] >> (sy + 1 + ((sx + 1) >> 1)) & 1) === 1 : solid(gx + sx, gy + sy) && !solid(gx + sx, gy) && !solid(gx, gy + sy)){ const ex = x - X, ey = y - Y, d = Math.sqrt(ex*ex + ey*ey);
      if(d < sd && d > 1e-9){ x = X + ex*sd/d; y = Y + ey*sd/d; } } }
  px[p] = x; py[p] = y;
}
// SPH's light liquid: a particle under a live pair partner of higher density and more mass, within 45 degrees of straight up, trades places
// with it once it has banked the gap at U = sqrt(g R drho/rho_h)/2 (Collins 1965); a glide instead is pulled back by the lattice each substep.
// Each keeps its velocity, and the height the pair lets down is heat in both by mass
const mixed = () => HAS[KW] + HAS[KM] + HAS[KX] >= 2 || HAS[KX] > 0;
function swap(){ const n = L.np, dts = DT[1], gg = K.grav*G, E = prE, m = L.nstraight;
  for(let p=0;p<n;p++){ swB[p] = -1; swD[p] = Infinity; swP[p] = -1; swF[p] = 0;
    const d = Math.sqrt(sdx[p]*sdx[p] + sdy[p]*sdy[p]); if(d > 0){ const k = Math.max(0, d - sdv[p]*dts)/d; sdx[p] *= k; sdy[p] *= k; } }
  if(L.swap !== 1 || !mixed()) return;
  for(let k=0;k<m;k++){ const a = E[2*k], b = E[2*k+1]; if(frz[a] || frz[b]) continue;
    const d = pvf[a] - pvf[b]; if(!(d > 1e-9*pvf[b] || d < -1e-9*pvf[a])) continue;
    const l = d > 0 ? a : b, h = d > 0 ? b : a; if(!(pm[l] < pm[h])) continue;
    const dy = py[l] - py[h], dx = px[l] - px[h]; if(!(dy > 0) || Math.abs(dx) >= dy) continue;
    const r2 = dx*dx + dy*dy; if(r2 < swD[l]){ swD[l] = r2; swB[l] = h; } }
  // the bank is kept while the partner above wobbles out of the cone for a substep: zeroed then, a small, slow particle never got there
  for(let l=0;l<n;l++){ const h = swB[l]; if(h < 0) continue;
    const V = pm[l]*pvf[l]/RHO_W, rl = RHO_W/pvf[l], rh = RHO_W/pvf[h];
    const U = 0.5*Math.sqrt(gg*Math.sqrt(V/(Math.PI*ROOM_DEPTH))*(rh - rl)/rh)/MPC; swC[l] = Math.min(1, swC[l] + U*dts);
    const xl = px[l], yl = py[l], xh = px[h], yh = py[h], dy = yl - yh;
    if(swC[l] < dy || swF[l] || swF[h] || inMargin(xh, yh, 0.125*ph[l]) || inMargin(xl, yl, 0.125*ph[h])) continue;
    swC[l] -= dy; px[l] = xh; py[l] = yh; px[h] = xl; py[h] = yl; swF[l] = 1; swF[h] = 1; swP[l] = h; swP[h] = l;
    sdx[l] += xl - xh; sdy[l] += dy; sdx[h] += xh - xl; sdy[h] -= dy; sdv[l] = U; sdv[h] = U;
    // the paint blends from the tick's start: moved with the swap, or it shows the offset twice for a frame
    qx[l] += xh - xl; qy[l] -= dy; qx[h] += xl - xh; qy[h] += dy;
    const q = (pm[h] - pm[l])*gg*dy*MPC, s = pm[l] + pm[h]; heatIn(l, q*pm[l]/s); heatIn(h, q*pm[h]/s); }
}
function sub(){ const dts = DT[1];
  if(TAP !== null) TAP(0);
  forces();
  if(TAP !== null) TAP(1);
  grid(); pairs(); wallPass();
  if(TAP !== null) TAP(2);
  water();
  if(TAP !== null) TAP(4);
  repel();
  if(TAP !== null) TAP(5);
  // not physics: a hard push between coarse particles turns straight into speed, and this hides the spike
  const lim = K.vcap/MPC;
  for(let p=0;p<L.np;p++){ if(frz[p]){ px[p] = ox[p]; py[p] = oy[p]; vx[p] = 0; vy[p] = 0; continue; }
    collide(p); vx[p] = (px[p] - ox[p])/dts; vy[p] = (py[p] - oy[p])/dts;
    if(LQ[kind[p]] === 1){ const s2 = vx[p]*vx[p] + vy[p]*vy[p]; if(s2 > lim*lim){ const k = lim/Math.sqrt(s2); vx[p] *= k; vy[p] *= k; } } }
  if(TAP !== null) TAP(7);
  swap();
  if(TAP !== null) TAP(8);
  if(TAP !== null) TAP(6);
}

// a hit of SPH[0] m/s at (SPH[1], SPH[2]) foams particle p, and throws spray along the surface normal there, off the fill of the
// cells either side (a wall is full), carrying (SPH[3], SPH[4]); a hit with no air beside it throws none
function splash(p){ const ds = SPH[0], x = SPH[1], y = SPH[2], hit = Math.min(1, ds/(2*K.fhit));
  if(hit > pfo[p]) pfo[p] = hit;
  const cx = x|0, cy = y|0, fL = fill[cellAt(cx - 1, cy)], fR = fill[cellAt(cx + 1, cy)], fU = fill[cellAt(cx, cy - 1)], fDn = fill[cellAt(cx, cy + 1)];
  let nx = fL - fR, ny = fU - fDn; const nl = Math.sqrt(nx*nx + ny*ny);
  if(!(nl > 0.1)) return;
  nx /= nl; ny /= nl;
  const n = Math.round(K.spray*hit);
  for(let k=0;k<n;k++){ const i = SS[0]; SS[0] = (i + 1)%MAXS;
    const s = K.sprayv*ds/MPC*(0.5 + 0.5*srnd()), a = (srnd() - 0.5)*1.2, ca = Math.cos(a), sa = Math.sin(a);
    sX[i] = x + 0.3*nx; sY[i] = y + 0.3*ny; sU[i] = s*(nx*ca - ny*sa) + SPH[3]; sV[i] = s*(nx*sa + ny*ca) + SPH[4]; sL[i] = 1.5; sR[i] = 0.7 + 0.6*srnd(); }
}
// water that loses speed hard in one tick has hit something; a drop that lands and joins is caught in join() instead
function hits(){ const dt = DT[0], fade = Math.exp(-dt/K.flife), g = K.grav*G/MPC, ke = 1 - Math.exp(-dt/0.1);
  for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue;
    pfo[p] *= fade;
    // the paint's stretch: flying means little water in the 3x3 cells round it (a wall counts as full), so a settling surface keeps
    // its shape; speed and stretch eased over 0.1 s, as the raw velocity is noisy and the 3x3 window jumps a cell at a time
    const cx = px[p]|0, cy = py[p]|0; let fm = 0; for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++) fm += fill[cellAt(cx + a, cy + b)];
    psx[p] += (vx[p] - psx[p])*ke; psy[p] += (vy[p] - psy[p])*ke;
    pst[p] += (Math.min(3, 1 + K.dstr*hyp(psx[p], psy[p])*MPC*(1 - ss(0.12, 0.35, fm/9))) - pst[p])*ke;
    const ds = (sp0[p] - hyp(vx[p], vy[p]))*MPC;
    if(ds > K.fhit){ SPH[0] = ds; SPH[1] = px[p]; SPH[2] = py[p]; SPH[3] = 0.3*vx[p]; SPH[4] = 0.3*vy[p]; splash(p); }
    // foamy water lets its air go as bubbles
    if(pfo[p] > 0.05 && srnd() < K.bub*pfo[p]*dt){ const i = SS[2]; SS[2] = (i + 1)%MAXB;
      bX[i] = px[p] + (srnd() - 0.5)*0.6; bY[i] = py[p] + (srnd() - 0.5)*0.6; bR[i] = 0.6 + 0.8*srnd(); bP[i] = 6.283*srnd(); bT[i] = 4; } }
  for(let i=0;i<MAXS;i++){ if(!(sL[i] > 0)) continue;
    sV[i] += g*dt; sX[i] += sU[i]*dt; sY[i] += sV[i]*dt; sL[i] -= dt;
    if(sX[i] < 0 || sY[i] < 0 || sX[i] >= W || sY[i] >= H){ sL[i] = 0; continue; }
    const c = cellAt(sX[i]|0, sY[i]|0); if(wall[c] || (sV[i] > 0 && fill[c] > 0.5)) sL[i] = 0; }
  // a bubble rises at about 0.2 to 0.4 m/s by size and pops where its cell is mostly air, flicking up one fine speck
  for(let i=0;i<MAXB;i++){ if(!(bT[i] > 0)) continue;
    bY[i] -= (0.2 + 0.15*bR[i])/MPC*dt; bP[i] += 9*dt; bT[i] -= dt;
    if(bY[i] < 0){ bT[i] = 0; continue; }
    const c = cellAt((bX[i] + 0.08*Math.sin(bP[i]))|0, bY[i]|0);
    if(wall[c]){ bT[i] = 0; continue; }
    if(fill[c] < 0.4){ bT[i] = 0; if(K.spray > 0){ const k = SS[0]; SS[0] = (k + 1)%MAXS;
      sX[k] = bX[i]; sY[k] = bY[i]; sU[k] = (srnd() - 0.5)*1.5; sV[k] = -(1.5 + 2*srnd()); sL[k] = 1; sR[k] = 0.4 + 0.2*srnd(); } } }
}
function putV(c){ const m = PVA[0], T = PVA[1]; if(!(m > 0)) return; vAT[c] = (vAT[c]*vAcc[c] + m*T)/(vAcc[c] + m); vAcc[c] += m; }
// a flame lives only while its pocket's oxygen is at or over the limiting oxygen concentration, as a mole fraction of every gas there
function flamP(p){ const c = cellOf(p), k = pc[c]; return k >= 0 && kO[k] >= O2_LOC*(kN[k] + kO[k] + kNP[k]); }
// m kg of gas kind GK[g] made in cell c at T, held until it is worth a parcel
// GPA[0] kg at GPA[1] K
const GPA = new Float64Array(2);
function gPut(c, g){ const m = GPA[0], T = GPA[1]; if(!(m > 0)) return; const o = g*N + c; HOT[2] = 1; gAT[o] = (gAT[o]*gAcc[o] + m*T)/(gAcc[o] + m); gAcc[o] += m; }
// dh of a parcel's fuel burns with the pocket's oxygen, one O2 to two of either fuel: the product leaves with the heat its reactants carried,
// the heat of reaction goes straight into the air of the cell
function burnOff(p, c){ const dh = BOA[0], co = kind[p] === KC;
  const k = pc[c], nh = dh/(co ? CO_MMOL : H2_MMOL), eo = nh/2*CV_O*(kT[k] - T0), Q = co ? QCO : QH2;
  pm[p] -= dh; kO[k] -= nh/2; nO[c] -= nh/2; eA[c] += dh*Q - eo; bq[c] += dh*Q;
  if(co){ GPA[0] = dh*(1 + O2_PER_CO); GPA[1] = T0 + (nh*CVK[KC]*(pT[p] - T0) + eo)/(nh*CVK[KD]); gPut(c, 2); return; }
  PVA[0] = dh*(1 + O2_PER_H2); PVA[1] = T0 + (nh*CV_H*(pT[p] - T0) + eo)/(nh*CV_V); putV(c);
}
function hotAt(p){
  for(let k=0, n=HOT[0];k<n;k++){ const h = hotL[k], dx = px[p] - (h%W + 0.5), dy = py[p] - (((h/W)|0) + 0.5), d = pr[p] + 0.7;
    if(dx*dx + dy*dy > d*d) continue;
    SEG[0] = px[p]; SEG[1] = py[p]; SEG[2] = h%W + 0.5; SEG[3] = ((h/W)|0) + 0.5; if(sees(cellOf(p), h, nearF) === 1) return true; }
  return false; }
// phase()'s per-particle helpers take indices and hand back no float, so its loop boxes nothing whether they inline or not
function boil(p, c){ tsatA(c); const ts = TS[1];
  if(pT[p] > ts){ const dm = Math.min(pm[p], pm[p]*CW*(pT[p] - ts)/LV); if(pFp[p] > 0){ DMA[0] = dm; boilFp(p, c); } pm[p] -= dm; pT[p] = ts; PVA[0] = dm; PVA[1] = ts; putV(c); }
  if(pm[p] < 0.05*MW0 && !pSrc[p]){ cond[c] += pm[p]; condE[c] += pm[p]*CW*(pT[p] - T0); condFp[c] += pFp[p]; condSo[c] += pSo[p]; kind[p] = 0; } }
// the volatile fission products of the boiled share go to the air over the water at 1/FP_PC of it; the NaOH stays
function boilFp(p, c){ const g = colGasAbove(c); if(g < 0) return; const a = pFp[p]*DMA[0]/pm[p]/FP_PC; pFp[p] -= a; nFpV[g] += a; HOT[3] = 1; }
// a gas parcel takes its pocket's temperature over about 2 s; what it gives up or takes goes to the air of its cell
function relaxT(p, c){ const dt = DT[0], cv = molOf(p)*CVK[kind[p]]; if(!(cv > 0)) return;
  const q = cv*(pT[p] - kT[pc[c]])*Math.min(1, dt/2); pT[p] -= q/cv; eA[c] += q; }
const lights = (p, c) => flamP(p) && (hotAt(p) || airT(c) >= (kind[p] === KC ? CO_IGN : H2_IGN));
// a smoke parcel that touches a floor, wall or ceiling, or is under a liquid, stays there
function smoke(p, c){ const x = px[p] - (c%W), y = py[p] - ((c/W)|0), cx = c%W, cy = (c/W)|0, e = 2*EPS;
  if(pc[c] < 0 || (y > 1 - e && gsolid(cx, cy + 1)) || (y < e && gsolid(cx, cy - 1)) || (x < e && gsolid(cx - 1, cy)) || (x > 1 - e && gsolid(cx + 1, cy)) || !(pm[p] > 1e-9)){
    dep[c] += pm[p]; kind[p] = 0; } }
function vapour(p, c){ const dt = DT[0], g = pc[c] >= 0;
  // a game rule, not physics: steam rains out anywhere in the room, faster beside a wall; the latent heat leaves through the walls
  const rate = !g ? 3 : K.cond*Math.max(1, wall9[c]);
  if(rate > 0){ const dm = pm[p]*(1 - Math.exp(-rate*dt)); pm[p] -= dm; cond[c] += dm; condE[c] += dm*CW*(T_HULL - T0); }
  if(g){ relaxT(p, c);
    // steam mixed into cooler air past saturation is fog: it rains out and its latent heat warms the air
    psatA(p); const xs = TS[3]/kP[pc[c]], x = xOf(p);
    if(x > xs){ const dm = Math.min(pm[p], (x - xs)*pv[p]*N0*H2O_MMOL*Math.min(1, dt)); pm[p] -= dm; cond[c] += dm; condE[c] += dm*CW*(pT[p] - T0); eA[c] += dm*LV; } }
  if(pm[p] < 1e-4){ cond[c] += pm[p]; condE[c] += pm[p]*CW*(T_HULL - T0); kind[p] = 0; }
}
// a fuel parcel: hydrogen, or CO at CO_SL_K of hydrogen's flame speed on the same table
function hydrogen(p, c){ const dt = DT[0], co = kind[p] === KC, M = co ? CO_MMOL : H2_MMOL;
  if(pc[c] >= 0) relaxT(p, c);
  if(!burn[p]){ if(lights(p, c)){ burn[p] = 1; age[p] = 0; } return; }
  if(!flamP(p)){ burn[p] = 0; return; }
  TS[5] = xOf(p); h2SlA(TS, 5, 6);
  const kk = pc[c], S = (co ? CO_SL_K : 1)*H2_TURB*Math.max(SL_MIN, TS[6])*Math.min(1, kO[kk]/((kN[kk] + kO[kk])*O2_FRAC0)), rm = pr[p]*MPC;
  const dh = Math.min(pm[p]*Math.min(1, dt*S/rm), Math.max(0, kO[kk])*2*M);
  BOA[0] = dh; burnOff(p, c);
  pq[p] = dh*rm/(dt*0.1*pv[p]*N0*M*H2_TURB*SL_MIN);
  age[p] += dt*S/rm;
  // a flame that has crossed its parcel lights the ones it touches
  if(age[p] >= 1){ const x = px[p], y = py[p], R = Math.ceil(2*RMAX + 0.5), cx = x|0, cy = y|0;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(FU[kind[j]] !== 1 || burn[j]) continue;
        SEG[0] = x; SEG[1] = y; SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(cellOf(p), cellOf(j))) continue;
        const dx = px[j] - x, dy = py[j] - y, d = pr[p] + pr[j] + 0.5; if(dx*dx + dy*dy > d*d) continue;
        if(flamP(j)){ burn[j] = 2; age[j] = 0; } } }
  if(age[p] >= BURN_OUT){ BOA[0] = Math.min(pm[p], Math.max(0, kO[kk])*2*M); burnOff(p, c); burn[p] = 0; pq[p] = 0; }
  if(!(pm[p] > 1e-9)){ BOA[0] = pm[p]; burnOff(p, c); kind[p] = 0; }
}
// the cells are binned as the last tick ended: a heat parcel's reading one tick old is all ignition asks of them
function phase(){ const dt = DT[0];
  grid();
  for(let p=0;p<L.np;p++) if(LQ[kind[p]] !== 1){ const c = cellOf(p);
    pv[p] += dt*K.diff + 2*K.mix*Math.sqrt(pv[p])*Math.max(0, qy[p] - py[p] + jetY[c]*dt); }
  // no two parcels mixed with the same air: a pocket's parcels hold its gas volume at most
  for(let k=0;k<L.npk;k++) kPv[k] = 0;
  for(let p=0;p<L.np;p++){ const k = kind[p]; if(k === 0 || LQ[k] === 1) continue; const g = pc[cellOf(p)]; if(g >= 0) kPv[g] += pv[p]; }
  for(let k=0;k<L.npk;k++) kPv[k] = kPv[k] > kVg[k]/Vc ? kVg[k]/(Vc*kPv[k]) : 1;
  for(let p=0;p<L.np;p++){ const k = kind[p]; if(k === 0 || LQ[k] === 1) continue; const g = pc[cellOf(p)]; if(g >= 0) pv[p] *= kPv[g]; }
  derive();
  metals(); corium(); if(PN[4] > 0) pans();
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(k === KW) boil(p, c);
    else if(k === KV) vapour(p, c);
    else if(k === KQ){ if(pd[p] < 2){ const to = pc[c] >= 0 ? c : colGasAbove(c); if(to >= 0){ eA[to] += pE[p]; kind[p] = 0; } } }
    else if(k === KH || k === KC) hydrogen(p, c);
    else if(k === KD){ if(pc[c] >= 0) relaxT(p, c); if(!(pm[p] > 1e-9)) kind[p] = 0; }
    else if(k === KS) smoke(p, c); }
  for(let p=0;p<L.np;p++) if(burn[p] === 2) burn[p] = 1;
  burnShove();
  sweep();
  // what boils, burns or condenses leaves in lots: a steam parcel, a drop of condensate
  for(let c=0;c<N;c++){ const x = c%W + 0.5, y = ((c/W)|0) + 0.5;
    if(vAcc[c] >= K.vmin){ SPA[0] = x + (rnd() - 0.5)*0.6; SPA[1] = y + (rnd() - 0.5)*0.6; SPA[2] = vAcc[c]; SPA[3] = vAT[c]; SPA[4] = (rnd() - 0.5)*2; SPA[5] = -2;
      if(spawn(KV) >= 0){ vAcc[c] = 0; vAT[c] = 0; } }
    if(cond[c] >= 0.1*MW0){ SPA[0] = x + (rnd() - 0.5)*0.6; SPA[1] = y + (rnd() - 0.5)*0.3; SPA[2] = cond[c]; SPA[3] = T0 + condE[c]/(cond[c]*CW); SPA[4] = 0; SPA[5] = 0;
      const q = spawn(KW); if(q >= 0){ pFp[q] = condFp[c]; pSo[q] = condSo[c]; condFp[c] = 0; condSo[c] = 0; cond[c] = 0; condE[c] = 0; } } }
  // a smoke lot is K.vmin kg; a gas lot holds a steam lot's moles
  if(HOT[2]) HOT[2] = 0; else return;
  for(let g=0;g<NG;g++){ const k = GK[g], m0 = k === KS ? K.vmin : K.vmin/H2O_MMOL*IM[k];
    for(let c=0;c<N;c++){ const o = g*N + c; if(gAcc[o] > 0) HOT[2] = 1; if(!(gAcc[o] >= m0)) continue;
      SPA[0] = c%W + 0.5 + (rnd() - 0.5)*0.6; SPA[1] = ((c/W)|0) + 0.5 + (rnd() - 0.5)*0.6; SPA[2] = gAcc[o]; SPA[3] = gAT[o]; SPA[4] = (rnd() - 0.5)*2; SPA[5] = k === KS || k === KD ? 0 : -2;
      if(spawn(k) >= 0){ gAcc[o] = 0; gAT[o] = 0; } } }
}
// eFireStep()'s pool laws (src/eng/room.js), copied, on each cell's metal particles and handed back by mass share
function metals(){
  if(!HAS[KM]) return;
  const dt = DT[0], n = L.np;
  cM.fill(0); cE.fill(0); cWm.fill(0); cSo.fill(0);
  for(let p=0;p<n;p++){ const k = kind[p], c = pcel[p]; if(k === KM){ cM[c] += pm[p]; cE[c] += pE[p]; } else if(k === KW) cWm[c] += pm[p]; }
  cWo.set(cWm);
  const f = FIRE[FIRE_KEYS[0]], cp = MF[0], cpk = cp/1000, rho = MF[1], A0 = Af;
  for(let i=0;i<N;i++){ const m0 = cM[i]; if(!(m0 > 0)) continue;
    let m = m0, E = cE[i];
    const A = Math.min(A0, (m + (i+W < N ? cM[i+W] : 0))/(rho*POOL_DMIN)), j = i - W, open = i < W || !(cM[j] > 0);
    MR[0] = m; MR[1] = E; poolTA(); let Tp = MR[2];
    if(open && f.wlhv){ const b = i+W < N ? i+W : i, wa = cWm[i] + (b !== i ? cWm[b] : 0), mw = Math.min(f.wrate*A*dt, m, wa/f.wh2o);
      if(mw > 0){ const take = mw*f.wh2o, s = take/wa, so = mw*NAOH_PER_NA;
        cSo[i] += so*cWm[i]/wa; if(b !== i) cSo[b] += so*cWm[b]/wa;
        cWm[i] -= cWm[i]*s; if(b !== i) cWm[b] -= cWm[b]*s;
        m -= mw; E += (mw*f.wlhv - mw*cpk*(Tp - f.melt))*1000;
        GPA[0] = mw*f.wh2; GPA[1] = Tp; gPut(i, 0); BK[B_NAWAT] += mw; BK[B_H2MADE] += mw*f.wh2;
        MR[0] = m; MR[1] = E; poolTA(); Tp = MR[2]; } }
    const g = j >= 0 && pc[j] >= 0 ? pc[j] : -1;
    if(open && g >= 0 && Tp >= f.ign){ const fo2 = kO[g]/(kN[g] + kO[g] + kNP[g]);
      if(fo2 >= f.loc){ const mb = Math.min(f.rate*(fo2/O2_FRAC0)*A*dt, m, nO[j]*O2_MMOL/f.o2);
        if(mb > 0){ m -= mb; nO[j] -= mb*f.o2/O2_MMOL; E += (mb*f.lhv - mb*cpk*(Tp - f.melt))*1000;
          GPA[0] = mb*(1 + f.o2); GPA[1] = kT[g] + bQT[j]; gPut(j, 3); BK[B_NAAIR] += mb; BK[B_SMOKE] += mb*(1 + f.o2); } } }
    if(m > 0 && g >= 0){ MR[0] = m; MR[1] = E; poolTA(); Tp = MR[2]; const Ta = kT[g] + bQT[j];
      let q = (f.hConv*(Tp - Ta) + f.emis*SIGMA*(Tp*Tp*Tp*Tp - Ta*Ta*Ta*Ta)/1000)*A;
      const qc = m*cpk*(Tp - Ta)/dt; q = q > 0 ? Math.min(q, Math.max(0, qc)) : Math.max(q, Math.min(0, qc));
      E -= q*dt*1000; eA[j] += q*dt*1000; }
    const eMax = m*cp*(f.boil - f.melt); if(E > eMax){ eA[airCell(i)] += E - eMax; E = eMax; }
    cR[i] = m > 0 ? m/m0 : 0; cE[i] = m > 0 ? E/m0 : 0; }
  for(let p=0;p<n;p++){ const k = kind[p], c = pcel[p];
    if(k === KM){ const r = cR[c]; if(!(r > 0)){ kind[p] = 0; continue; } pE[p] = cE[c]*pm[p]; pm[p] *= r; metalT(p); }
    else if(k === KW && cWo[c] > 0 && cWm[c] < cWo[c]){ const s = pm[p]/cWo[c]; pSo[p] += cSo[c]*s; pm[p] *= cWm[c]/cWo[c];
      if(!(pm[p] > 1e-9)){ condSo[c] += pSo[p]; condFp[c] += pFp[p]; kind[p] = 0; } } }
}
// the corium's enthalpy, copies of eFuelRowA(), eCladHA() and eMeltPoolTA() with 316 steel added: F fuel, K can (Z its metal Zr), S steel, X slag, kJ over 298.15 K
const ZRY = CLAD[0], SST = CLAD[2], HF_U = 70/E_UO2_M, FE_W = SST.compW.Fe, FE_M = 0.055845, FEO_M = 0.071844;
// kJ a mole of Fe gives taking the O of H2O or CO2 to FeO: formation enthalpies FeO(s) -272.04 (as commonly quoted, not read at source), H2O(g) -241.8, CO2 -393.5, CO -110.5
const Q_FE_H2O = 272.04 - 241.8, Q_FE_CO2 = 272.04 + 110.5 - 393.5;
const phRows = cp => { const m = 1000*cp.M, r = []; let Tlo = E_T_STP, h = 0;
  for(let p=0;p<cp.ph.length;p++){ const [Thi, a, b, c, d, e] = cp.ph[p], F = t => (t*(a + t*(b/2 + t*(c/3 + t*d/4))) - e/t)/m;
    r.push(Thi, a, b, c, d, e, h - F(Tlo), m); if(p < cp.ph.length - 1){ h += F(Thi) - F(Tlo); Tlo = Thi; } }
  return Float64Array.from(r); };
const PH_Z = phRows(ZRY.cp), PH_S = phRows(SST.cp), ZG = Float64Array.from(ZRY.cp.gauss);
// CM, the mix's registers: [0] F, [1] K, [2] S, [3] X kg, [4] T, [5] kJ and [6] a starting T for mixTA(), [7] corEA()'s J, [8] [9] one material's h and cp, [10] erfA()'s x
const CM = new Float64Array(11);
// kJ/kg over 298.15 K into CM[8], kJ/kg/K into CM[9], of the phase rows R at CM[4]
function phA(R){ const T = CM[4]; let o = 0; while(o + 8 < R.length && T > R[o]) o += 8;
  const a = R[o+1], b = R[o+2], c = R[o+3], d = R[o+4], e = R[o+5], m = R[o+7];
  CM[8] = (T*(a + T*(b/2 + T*(c/3 + T*d/4))) - e/T)/m + R[o+6]; CM[9] = (a + T*(b + T*(c + T*d)) + e/(T*T))/m; }
// Abramowitz and Stegun 7.1.26, as eErfA()
function erfA(){ const x = CM[10], a = x < 0 ? -x : x, t = 1/(1 + 0.3275911*a), y = 1 - t*(0.254829592 + t*(-0.284496736 + t*(1.421413741 + t*(-1.453152027 + t*1.061405429))))*Math.exp(-a*a); CM[10] = x < 0 ? -y : y; }
// CX: [0] T, [1] kJ of the mix, [2] kJ/K, [3] solidus K, [4] kJ at it, [5] fusion held kJ
const CX = new Float64Array(6);
function mixH(){ const F = CM[0], K = CM[1], S = CM[2], X = CM[3], T = CM[4]; let h = 0, c = 0;
  if(F > 0){ const t = Math.min(T, 3120), x = Math.exp(E_UO2_TH/t), a = Math.exp(-E_UO2_EA/t);
    let hu = (E_UO2_C1*E_UO2_TH*(1/(x - 1) - E_UO2_E0) + E_UO2_C2*(t*t - E_T_STP*E_T_STP) + E_UO2_C3*(a - E_UO2_A0))/(1000*E_UO2_M);
    let cu = (E_UO2_C1*E_UO2_TH*E_UO2_TH*x/(t*t*(x - 1)*(x - 1)) + 2*E_UO2_C2*t + E_UO2_C3*E_UO2_EA*a/(t*t))/(1000*E_UO2_M);
    if(T > 3120){ hu += (E_UO2_L1*(T - 3120) - E_UO2_L2*(1/T - 1/3120))/(1000*E_UO2_M); cu = (E_UO2_L1 + E_UO2_L2/(T*T))/(1000*E_UO2_M); }
    h += F*hu; c += F*cu; }
  if(K > 0){ phA(PH_Z); let hz = CM[8], cz = CM[9];
    if(T > ZG[3]){ const s = Math.sqrt(ZG[2]), k = ZG[0]*s*Math.sqrt(Math.PI)/2000;
      CM[10] = (Math.min(T, ZG[4]) - ZG[1])/s; erfA(); const e1 = CM[10]; CM[10] = (ZG[3] - ZG[1])/s; erfA(); hz += k*(e1 - CM[10]);
      if(T < ZG[4]) cz += ZG[0]*Math.exp(-(T - ZG[1])*(T - ZG[1])/ZG[2])/1000; }
    h += K*hz; c += K*cz; }
  if(S > 0){ phA(PH_S); h += S*CM[8]; c += S*CM[9]; }
  h += X*CORIUM.slagCp*(T - E_T_STP); c += X*CORIUM.slagCp;
  CX[1] = h; CX[2] = c; }
// the mix's solidus, the sensible kJ at it and the fusion it holds there; leaves CM[4] at the solidus
function mixS(){ const F = CM[0], K = CM[1], S = CM[2], X = CM[3], m = F + K + S + X;
  CX[3] = (F*CORIUM.ceramicT + K*ZRY.tsol + S*SST.tsol + X*CR[3])/m; CM[4] = CX[3]; mixH(); CX[4] = CX[1]; CX[5] = F*HF_U + K*ZRY.hfus + S*SST.hfus; }
// T into CX[0] of CM[5] kJ: pinned at the solidus while the fusion comes out, Newton inside the side it falls on
function mixTA(){ const E = CM[5], T0g = CM[6]; mixS(); const ts = CX[3], Hs = CX[4], Lc = CX[5];
  if(E >= Hs && E <= Hs + Lc){ CX[0] = ts; return; }
  const Et = E < Hs ? E : E - Lc, lo = E < Hs ? E_FUEL_TLO : ts, hi = E < Hs ? ts : E_FUEL_THI;
  let T = Math.max(lo, Math.min(hi, T0g > 300 ? T0g : 2500));
  for(let i=0;i<60;i++){ CM[4] = T; mixH(); const f = CX[1] - Et, d = CX[2]; if(!(d > 0)) break;
    const T1 = Math.max(lo, Math.min(hi, T - f/d)), dT = T1 - T; T = T1; if(dT < 1e-6 && dT > -1e-6) break; }
  CX[0] = T; CX[3] = ts; CX[4] = Hs; CX[5] = Lc; }
// J the mix holds at CM[4] K, molten past its solidus, into CM[7]
function corEA(){ const T = CM[4]; mixS(); const Lc = T >= CX[3] ? CX[5] : 0; CM[4] = T; mixH(); CM[7] = 1000*(CX[1] + Lc); }
// a corium particle's temperature, its volume share, and frozen once it is solid and has come to rest
function corT(p){ const F = pCF[p], K = pCK[p], S = pCS[p], X = pCX[p], m = F + K + S + X; if(!(m > 0)) return;
  CM[0] = F; CM[1] = K; CM[2] = S; CM[3] = X; CM[5] = pE[p]/1000; CM[6] = pT[p]; mixTA(); pT[p] = CX[0];
  pvf[p] = RHO_W*((F + K)/CORIUM.rhoDebris + S/CORIUM.hdRho + X/CORIUM.slagRho)/m;
  frz[p] = pE[p] < 1000*CX[4] && rests(p) ? 1 : 0; }
// a solid particle stands only on what it touches, a floor as deep in its fill as the wall holds a first row at rest, or frozen melt under it
// within their radii (a quarter kernel), and falls when that goes: frozen anywhere in the cell row over it, and kept frozen, it hung in the air
function rests(p){ const x = px[p], y = py[p], cx = cxOf(p), cy = cyOf(p), rp = 0.25*ph[p];
  if((cy + 1 >= H || solid(cx, cy + 1)) && wsA[8*p] >= WR.T0) return true;
  for(let gy=cy;gy<=Math.min(H-1, cy+2);gy++) for(let gx=Math.max(0, cx-2);gx<=Math.min(W-1, cx+2);gx++){ const c = gy*W + gx;
    for(let gi=cS[c], g1=cS[c+1];gi<g1;gi++){ const q = cP[gi]; if(q === p || q >= L.np || !frz[q]) continue;
      const dx = px[q] - x, dy = py[q] - y, d = rp + 0.25*ph[q]; if(dy > 0 && dx*dx + dy*dy <= d*d) return true; } }
  return false; }
// the concrete under a melt, off concreteOf() at build: h2o, co2 kg/kg, rho kg/m3, tAbl K, dhAbl kJ/kg, aniso
const CR = new Float64Array(6);
// eChfZuberA() (src/eng/core.js): Zuber's CHF W/m2 at ZB[5] MPa into ZB[4]
const ZB = new Float64Array(10);
// past the critical point nothing boils, so there is no boiling crisis to cap a flux
function chfA(){ const io = ZB; if(!(io[5] < WATER_PC)){ io[4] = Infinity; return; } satTA(SAT_WATER, io, 5, 6);
  curveA(SAT_WATER, CV_RF, io, 6, 7); curveA(SAT_WATER, CV_RG, io, 6, 8); curveA(SAT_WATER, CV_HFG, io, 6, 9); sigmaA(SAT_WATER, io, 6, 5);
  const rf = io[7], rg = io[8]; io[4] = 0.131*io[9]*1000*Math.sqrt(rg)*Math.pow(io[5]*G_SI*Math.max(rf - rg, 1e-3), 0.25); }
// eCorAblateA() (src/eng/room.js), copied, the steel's iron taking the oxygen after the Zr: AB [F, K, Z, S, X, kJ, K], Q kJ AB[8] over AB[9] m2, Fe2O3 share AB[10]; depth out AB[7]
const AB = new Float64Array(11);
function ablate(g){ const r = CR, T = AB[6], Q = AB[8], fe = AB[10], mc = Q/r[4]; AB[7] = mc/(r[2]*AB[9]); if(!(mc > 0)) return;
  let Z = AB[2], S = AB[3], slag = mc*(1 - r[0] - r[1]), chem = 0, ox = 0;
  if(fe > 0){ const dz = Math.min(Z, fe*mc/(2*0.159687/(3*E_ZR_M))); Z -= dz; ox += dz*CORIUM.zro2PerZrO; chem += dz*CORIUM.qZrFe; slag -= dz*CORIUM.zro2PerZrO; }
  const nw = mc*r[0]/H2O_MMOL, nc = mc*r[1]/CO2_MMOL, nz = fe > 0 ? 0 : Z/E_ZR_M, z1 = Math.min(nz, nw/2), z2 = Math.min(nz - z1, nc/2);
  Z -= (z1 + z2)*E_ZR_M; ox += (z1 + z2)*E_ZR_M*CORIUM.zro2PerZrO; chem += (z1*CORIUM.qZrH2o + z2*CORIUM.qZrCo2)*E_ZR_M;
  const w1 = nw - 2*z1, c1 = nc - 2*z2, nFe = fe > 0 ? 0 : S*FE_W/FE_M, f1 = Math.min(nFe, w1), f2 = Math.min(nFe - f1, c1);
  S -= (f1 + f2)*FE_M; slag += (f1 + f2)*FEO_M; chem += f1*Q_FE_H2O + f2*Q_FE_CO2;
  const nv = w1 - f1, nh = 2*z1 + f1, nd = c1 - f2, no = 2*z2 + f2;
  PVA[0] = nv*H2O_MMOL; PVA[1] = T; putV(g); GPA[1] = T; GPA[0] = nh*H2_MMOL; gPut(g, 0); GPA[0] = no*CO_MMOL; gPut(g, 1); GPA[0] = nd*CO2_MMOL; gPut(g, 2);
  const hg = (nv*CV_V + nh*CV_H + nd*CVK[KD] + no*CVK[KC])*(T - T0)/1000, hs = slag*CORIUM.slagCp*(r[3] - E_T_STP);
  AB[2] = Z; AB[1] += ox; AB[3] = S; AB[4] += slag; AB[5] += hs + chem - Q;
  BK[B_ABLKG] += mc; BK[B_ABLQ] += 1000*(Q - hs - hg); BK[B_CHEMQ] += 1000*chem; BK[B_H2MADE] += nh*H2_MMOL; BK[B_QDOWN] += 1000*Q;
  BK[B_ABLV] += nv*H2O_MMOL; BK[B_ABLH] += nh*H2_MMOL; BK[B_ABLC] += no*CO_MMOL; BK[B_ABLD] += nd*CO2_MMOL; BK[B_ABLFE] += f1 + f2; }
// eCorStep() (src/eng/room.js), copied, on each column's corium particles and handed back by mass share; its spreading is the particles' own flow
function corium(){
  crC.fill(0); if(!HAS[KX]){ crust.fill(0); return; }
  const dt = DT[0], n = L.np, A = Af;
  cM.fill(0); cE.fill(0); cF.fill(0); cK.fill(0); cZ.fill(0); cSt.fill(0); cX.fill(0); cWm.fill(0); cWo.fill(0);
  for(let p=0;p<n;p++) if(kind[p] === KW){ const c = pcel[p]; cWm[c] += pm[p]; cWo[c] += pm[p]*pT[p]; }
  const dec = K.decay;
  for(let p=0;p<n;p++){ if(kind[p] !== KX) continue; const c = pcel[p];
    const q = dec*pDw[p]*dt; pE[p] += q; BK[B_DECAY] += q;
    if(!pFci[p] && cWm[c] > 0){ pFci[p] = 1; tsatA(c); const Ts = TS[1];
      CM[0] = pCF[p]; CM[1] = pCK[p]; CM[2] = pCS[p]; CM[3] = pCX[p]; CM[4] = Ts; corEA();
      const k = pCK[p] > (pCF[p] + pCK[p] + pCX[p])/2 ? CORIUM.fciMet : CORIUM.fciOx, e = k*Math.max(0, pE[p] - CM[7]);
      if(e > 0){ pE[p] -= e; fciQ[c] += e; BK[B_FCIQ] += e; HOT[1] = 1; } }
    cM[c] += pm[p]; cE[c] += pE[p]; cF[c] += pCF[p]; cK[c] += pCK[p]; cZ[c] += pCZ[p]; cSt[c] += pCS[p]; cX[c] += pCX[p]; cT[c] = pT[p]; }
  // a column of melt is one pool, as eCorStep()'s floor cell is (its convection mixes it): summed on its lowest cell, cBase, its top cTop
  for(let x=0;x<W;x++) for(let i=(H-1)*W + x;i>=0;i-=W){ cBase[i] = -1; if(!(cM[i] > 0)) continue;
    const b = i+W < N && cBase[i+W] >= 0 ? cBase[i+W] : i; cBase[i] = b; cTop[b] = i; if(b === i) continue;
    cM[b] += cM[i]; cE[b] += cE[i]; cF[b] += cF[i]; cK[b] += cK[i]; cZ[b] += cZ[i]; cSt[b] += cSt[i]; cX[b] += cX[i];
    cM[i] = 0; cE[i] = 0; cF[i] = 0; cK[i] = 0; cZ[i] = 0; cSt[i] = 0; cX[i] = 0; }
  let dirty = 0;
  for(let i=0;i<N;i++){ const m = cM[i]; cR[i] = 1; if(!(m > 0)){ crust[i] = 0; continue; }
    AB[0] = cF[i]; AB[1] = cK[i]; AB[2] = cZ[i]; AB[3] = cSt[i]; AB[4] = cX[i]; AB[5] = cE[i]/1000;
    CM[0] = AB[0]; CM[1] = AB[1]; CM[2] = AB[3]; CM[3] = AB[4]; CM[5] = AB[5]; CM[6] = cT[i]; mixTA(); AB[6] = CX[0];
    const T = CX[0], ts = CX[3], Lc = CX[5], V = (AB[0] + AB[1])/CORIUM.rhoDebris + AB[3]/CORIUM.hdRho + AB[4]/CORIUM.slagRho, hL = V/A;
    const b = i + W, code = b >= N ? 0 : catc[b] >= 0 ? 2 : !wall[b] ? 4 : conc[b] > 0 ? 1 : 3, g = airCell(i);
    if(code === 2 && !catWet[catc[b]]) flood(catc[b]);
    if(code !== 4){ const cold = code === 3 || (code === 2 && abl[i] >= paSac[catc[b]]);
      const Qd = CORIUM.hMcci*Math.max(0, T - (cold ? ts : CR[3]))*A*dt/1000;
      if(!cold){ AB[8] = Qd; AB[9] = A; AB[10] = code === 2 ? paFe[catc[b]] : 0; ablate(g); abl[i] += AB[7];
        if(code === 0 && abl[i] >= CORIUM.basemat){ cR[i] = 0; abl[i] = 0;
          BK[B_COROUT] += AB[0] + AB[1] + AB[3] + AB[4]; BK[B_COROUTE] += 1000*AB[5]; BK[B_OUTF] += AB[0]; BK[B_OUTK] += AB[1]; BK[B_OUTZ] += AB[2]; BK[B_OUTS] += AB[3]; BK[B_OUTX] += AB[4]; continue; }
        if(code === 1 && abl[i] >= conc[b]){ gone[b] = 1; dirty = 1; abl[i] = 0; } }
      else { if(cWm[i] > 0){ QW[0] = Qd; heatW(i); } else eA[g] += 1000*Qd; AB[5] -= Qd; } }
    for(let l=0, c=i;c>=cTop[i];l++, c-=W) for(let d=-1;d<=1;d+=2){ const X0 = c%W + d, j = c + d; if(X0 < 0 || X0 >= W || !(conc[j] > 0)) continue;
      const As = Math.min(MPC, hL - l*MPC)*ROOM_DEPTH; if(!(As > 0)) continue; AB[8] = CR[5]*CORIUM.hMcci*Math.max(0, T - CR[3])*As*dt/1000; AB[9] = As; AB[10] = 0; ablate(g); abl[j] += AB[7];
      if(abl[j] >= conc[j]){ gone[j] = 1; dirty = 1; abl[j] = 0; } }
    { const t = cTop[i], Tt = T < ts ? T : ts, wc = cWm[t] > 0 ? t : t >= W && cWm[t-W] > 0 ? t - W : -1;
      if(wc >= 0){ const Tw = cWo[wc]/cWm[wc]; ZB[5] = pAt(wc)/1e6; chfA();
        const d0 = Math.max(crust[i], COR_DMIN), qu = Math.max(0, Math.min(ZB[4], CORIUM.kMelt*(Tt - Tw)/d0)), lat = Lc/m;
        if(lat > 0) crust[i] = Math.max(COR_DMIN, Math.min(hL, d0 + (qu - CORIUM.hMcci*Math.max(0, T - ts))/(CORIUM.rhoDebris*lat*1000)*dt));
        const Q = qu*A*dt/1000; QW[0] = Q; heatW(wc); AB[5] -= Q; BK[B_QUP] += 1000*Q; }
      else { const Tg = pc[g] >= 0 ? kT[pc[g]] + bQT[g] : T_HULL, qu = Math.max(0, CORIUM.emis*SIGMA*(Tt*Tt*Tt*Tt - Tg*Tg*Tg*Tg)), Q = qu*A*dt/1000; eA[g] += 1000*Q; AB[5] -= Q; } }
    // what the pool gained, handed to its particles: K's oxide where the Zr was, the steel's loss by share, slag by mass, and one heat a kg, as it is mixed
    cR[i] = 2; cdZ[i] = cZ[i] > 0 ? AB[2]/cZ[i] : 1; cdK[i] = AB[1] - cK[i]; cdS[i] = cSt[i] > 0 ? AB[3]/cSt[i] : 1; cdX[i] = AB[4] - cX[i]; cdE[i] = 1000*AB[5] - cE[i]; }
  for(let p=0;p<n;p++){ if(kind[p] !== KX) continue; const c = cBase[pcel[p]], r = cR[c];
    if(r === 0){ kind[p] = 0; continue; }
    if(r !== 2) continue;
    const w = pm[p]/cM[c], wz = cZ[c] > 0 ? pCZ[p]/cZ[c] : w;
    pCZ[p] *= cdZ[c]; pCK[p] += cdK[c]*wz; pCS[p] *= cdS[c]; pCX[p] += cdX[c]*w; pE[p] = (cE[c] + cdE[c])*w;
    pm[p] = pCF[p] + pCK[p] + pCS[p] + pCX[p]; corT(p); ph[p] = hOf(p); }
  for(let i=0;i<N;i++){ if(cR[i] !== 2 || !(crust[i] > 0)) continue; for(let c=i;c>=cTop[i];c-=W) crC[c] = crust[i]/MPC; }
  if(dirty) geom();
}
const COR_DMIN = 1e-3;
// QW[0] kJ into the water particles of cell c by mass share
const QW = new Float64Array(1);
function heatW(c){ const m = cWm[c]; if(!(m > 0)) return; const dT = 1000*QW[0]/(m*CW);
  for(let gi=cS[c], g1=cS[c+1];gi<g1;gi++){ const p = cP[gi]; if(kind[p] === KW) pT[p] += dT; } }
// a core catcher floods once, when the melt first reaches it: catchWater m over its floor, at T_HULL, laid over its cells
function flood(a){ catWet[a] = 1;
  for(let b=0;b<N;b++){ if(catc[b] !== a) continue; let left = paWa[a]/MPC;
    for(let c=b-W;c>=0 && left > 0 && !wall[c];c-=W){ const f = Math.min(1, left); lay(c, f); BK[B_FLOOD] += f*RHO_W*Vc; left -= f; } }
}
// a pan's drain line takes PAN_DRAIN_KGS off the particles in its cells, water first: it is on the bottom
function pans(){ const dt = DT[0];
  for(let a=0;a<MAXPART;a++) paB[a] = paK[a] === 2 ? PAN_DRAIN_KGS*dt : 0;
  for(let w=0;w<2;w++){ const kk = w === 0 ? KW : KM;
    for(let p=0;p<L.np;p++){ if(kind[p] !== kk) continue; const a = pan[pcel[p]]; if(a < 0 || !(paB[a] > 0)) continue;
      const g = Math.min(pm[p], paB[a]); paB[a] -= g;
      if(kk === KW){ DMA[0] = g; drainFp(p); BK[B_DRW] += g; } else { pE[p] -= pE[p]*g/pm[p]; BK[B_DRM] += g; }
      pm[p] -= g; if(!(pm[p] > 1e-9)) kind[p] = 0; else if(kk === KM) metalT(p); } }
}
// a long release is kept inside the pool: a parcel that has thinned out splits in two while there is room, and once the pool
// runs full, two parcels of a kind that overlap by half merge
function crowd(){
  const n = L.np;
  if(n < 0.6*MAXP) for(let p=0;p<n;p++){ const k = kind[p]; if(LQ[k] === 1 || burn[p] || pv[p] <= PVMAX) continue;
    const r = rOf(p); SPA[0] = px[p] + 0.3*r; SPA[1] = py[p]; SPA[2] = pm[p]/2; SPA[3] = pT[p]; SPA[4] = vx[p]; SPA[5] = vy[p];
    const q = spawn(k); if(q < 0) break;
    pm[p] /= 2; pE[p] /= 2; pE[q] = pE[p]; pv[p] /= 2; pv[q] = pv[p]; px[p] = Math.max(0, px[p] - 0.3*r); if(solid(Math.floor(px[p]), Math.floor(py[p]))) px[p] = ox[p]; }
  if(L.np < 0.7*MAXP) return;
  grid(); derive();
  for(let p=0;p<L.np;p++){ const k = kind[p]; if(LQ[k] === 1 || k === 0 || burn[p]) continue;
    const cp = cellOf(p);
    for(let gi=cS[cp], g1=cS[cp+1];gi<g1;gi++){ const j = cP[gi]; if(j === p || kind[j] !== k || burn[j]) continue;
      const dx = px[j] - px[p], dy = py[j] - py[p], d = 0.5*(pr[p] + pr[j]); if(dx*dx + dy*dy > d*d) continue;
      const a = k === KQ ? pE[j] : pm[j], b = k === KQ ? pE[p] : pm[p], s = a + b; if(!(s > 0)) continue;
      px[j] = (px[j]*a + px[p]*b)/s; py[j] = (py[j]*a + py[p]*b)/s; vx[j] = (vx[j]*a + vx[p]*b)/s; vy[j] = (vy[j]*a + vy[p]*b)/s;
      pT[j] = (pT[j]*a + pT[p]*b)/s; pv[j] += pv[p]; pr[j] = rOf(j); if(k === KQ) pE[j] = s; else pm[j] = s;
      kind[p] = 0; break; } }
  sweep();
}

function step(dt){
  if(!L.ready) return;
  DT[0] = dt; DT[1] = dt/K.sub;
  sources();
  for(let p=0;p<L.np;p++){ qx[p] = px[p]; qy[p] = py[p]; sp0[p] = hyp(vx[p], vy[p]); }
  derive();
  for(let s=0;s<K.sub;s++) sub();
  hits();
  adapt();
  phase(); crowd(); bin(); pockets(1);
  if(HOT[1]) fci();
  for(let p=0;p<L.np;p++) if(sg[p] && !(hyp(vx[p], vy[p])*MPC >= GLOW_OFF)) sg[p] = 0;
  L.t += dt; L.tick++;
}

// a pressure of kPa at a cell throws every particle it reaches out along the line from it and marks the pocket's peak; the grid
// must be current
function shove(cell){ const kPa = SHV[0];
  const k = pc[cell], cx = cell%W + 0.5, cy = ((cell/W)|0) + 0.5, X = cx|0, Y = cy|0;
  for(let gy=Math.max(0, Y-12);gy<=Math.min(H-1, Y+12);gy++) for(let gx=Math.max(0, X-12);gx<=Math.min(W-1, X+12);gx++)
    for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const p = cP[gi]; if(kind[p] === 0) continue;
      const dx = px[p] - cx, dy = py[p] - cy, r = hyp(dx, dy); if(r > 12 || r < 1e-6) continue;
      SEG[0] = cx; SEG[1] = cy; SEG[2] = px[p]; SEG[3] = py[p]; if(!sees(cell, cellOf(p), null)) continue;
      const s = Math.min(1, 1.5/Math.max(r, 0.5)), u = (LQ[kind[p]] === 1 ? kPa*1000*0.01*pvf[p]/(RHO_W*MPC) : Math.min(40, kPa/5))*s/MPC;
      vx[p] += u*dx/r; vy[p] += u*dy/r; sg[p] = 1; }
  for(let i=0;i<N;i++){ if(gwall[i] || pc[i] !== k) continue; const d = hyp(i%W + 0.5 - cx, ((i/W)|0) + 0.5 - cy);
    pk[i] = Math.max(pk[i], kPa*Math.min(1, 1.5/Math.max(d, 1e-9))); }
}
// a game rule: a burning cell shoves once a tick like a charge of the pressure its heat builds in the 1.5-cell core before sound
// clears it
function burnShove(){ const dt = DT[0];
  for(let c=0;c<N;c++){ const q = bq[c]; if(!(q > 0)) continue; bq[c] = 0; if(pc[c] < 0) continue;
    const kPa = (GAM - 1)*q/dt*(1.5*MPC/340)/(Math.PI*2.25*Vc)/1000; if(kPa >= 0.5){ SHV[0] = kPa; shove(c); } }
}

// a melt quenched in water throws a share of its heat over saturation as a charge in the gas over the water, kPa = (gamma - 1) E/V there
function fci(){ HOT[1] = 0;
  for(let c=0;c<N;c++){ const e = fciQ[c]; if(!(e > 0)) continue; fciQ[c] = 0;
    const g = colGasAbove(c), k = g >= 0 ? pc[g] : -1;
    if(k < 0){ BK[B_FCIQ] -= e; heatAt(c, e); continue; }
    blast(g, (GAM - 1)*e/kV[k]/1000); }
}
// J into the water particles of cell c, or its air
function heatAt(c, e){ let m = 0; for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === c) m += pm[p];
  if(m > 0){ for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === c) pT[p] += e/(m*CW); } else eA[airCell(c)] += e; }
// the charge's energy lands in the pocket as a pressure step; every particle near it is thrown out along the line from the charge
function blast(cell, kPa){
  if(cell < 0 || gwall[cell]) return;
  const k = pc[cell], cx = cell%W + 0.5, cy = ((cell/W)|0) + 0.5;
  if(k >= 0){ const E = kPa*1000*kV[k]/(GAM - 1); for(let i=0;i<N;i++) if(pc[i] === k) eA[i] += E*vgOf(i)/kVg[k]; }
  grid(); SHV[0] = kPa; shove(cell);
  // the charge's fireball fills the core the pressure step already takes at full strength, and lights what it touches there
  for(let p=0;p<L.np;p++){ if(FU[kind[p]] !== 1 || burn[p]) continue; const dx = px[p] - cx, dy = py[p] - cy, d = 1.5 + rOf(p);
    if(dx*dx + dy*dy > d*d) continue;
    SEG[0] = cx; SEG[1] = cy; SEG[2] = px[p]; SEG[3] = py[p]; if(sees(cell, cellOf(p), null) && flamP(p)){ burn[p] = 1; age[p] = 0; } }
  bin(); pockets(0);
}
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a)/(b - a))); return t*t*(3 - 2*t); };

const colGasAbove = i => { let k = i; while(k >= 0 && pc[k] < 0 && !gwall[k]) k -= W; return k >= 0 && pc[k] >= 0 ? k : -1; };
// a pinned source: {kind, rate, cell, T, u, v} and what its kind reads (p MPa, h kJ/kg, fpN, fpV kg/s, fire, dp Pa, bore m, comp {F, K, Z, S, X} shares, dw W/kg, pv MPa, tot kg); its row, or -1 when the table is full
function srcAdd(q){
  let r = 1; while(r < MAXSRC && rOn[r]) r++; if(r >= MAXSRC) return -1;
  const o = 8*r, c = q.comp || {};
  rKd[r] = SK[q.kind] || 0; rRt[r] = +q.rate || 0; rCl[r] = q.cell; rTk[r] = q.T ?? (q.kind === "steam" ? 373.15 : T_HULL); rUj[r] = q.u || 0; rVj[r] = q.v || 0;
  rH[r] = q.h ?? (q.p ? hfAt(q.p) : 0); rFN[r] = q.fpN || 0; rFV[r] = q.fpV || 0; rMr[r] = Math.max(0, FIRE_KEYS.indexOf(q.fire || FIRE_KEYS[0]));
  rDp[r] = q.dp || 0; rBo[r] = q.bore || 0; rDw[r] = q.dw || 0; rPv[r] = q.pv || 0; rTot[r] = q.tot ?? Infinity; rDone[r] = 0; rDch[r] = 0;
  // Z is the metal Zr inside the can K, so it is no share of its own
  const f = [c.F || 0, c.K || 0, Math.min(c.Z || 0, c.K || 0), c.S || 0, c.X || 0], t = f[0] + f[1] + f[3] + f[4];
  for(let j=0;j<5;j++) rCm[5*r+j] = t > 0 ? f[j]/t : 0;
  for(let j=0;j<8;j++) rRem[o+j] = 0; rP[r] = -1;
  rOn[r] = 1; return r;
}
// what row r has booked in and not yet made into a particle, made now as one short one: a click shorter than a particle's worth still pours
function flush(r){ const i = rCl[r], o = 8*r, sk = rKd[r]; if(!rOn[r] || i < 0 || i >= N || gwall[i]) return;
  const put = (k, m) => { SPA[0] = i%W + 0.5; SPA[1] = ((i/W)|0) + 0.5; SPA[2] = m; SPA[3] = rTk[r]; SPA[4] = rUj[r]/MPC; SPA[5] = (LQ[k] === 1 ? 2 : -2) + rVj[r]/MPC; return spawn(k); };
  if((sk === S_FLUID || sk === S_BREAK) && rRem[o] > 0){ const q = put(KW, rRem[o]); if(q >= 0){ if(sk === S_BREAK){ pFp[q] = rRem[o+4]; rRem[o+4] = 0; } rRem[o] = 0; } }
  if(sk === S_METAL && rRem[o+4] > 0){ const m = rRem[o+4], q = put(KM, m); if(q >= 0){ MR[3] = rTk[r]; metalEA(); pvf[q] = RHO_W/MF[1]; pMr[q] = rMr[r]; pE[q] = m*MR[3]; metalT(q); ph[q] = hOf(q); rRem[o+4] = 0; } }
  if(sk === S_COR && rRem[o+5] > 0){ const c = 5*r; CM[0] = rCm[c]; CM[1] = rCm[c+1]; CM[2] = rCm[c+3]; CM[3] = rCm[c+4]; CM[4] = rTk[r]; corEA();
    SPA[0] = i%W + 0.5; SPA[1] = ((i/W)|0) + 0.5; SPA[2] = rRem[o+5]; SPA[3] = rTk[r]; SPA[4] = rUj[r]/MPC; SPA[5] = 2 + rVj[r]/MPC; CSA[0] = rRem[o+5]; CSA[1] = CM[7];
    if(corSpawn(r) >= 0) rRem[o+5] = 0; }
  if(sk === S_HEAT && rRem[o+3] > 0){ const q = put(KQ, 0); if(q >= 0){ pE[q] = rRem[o+3]; rRem[o+3] = 0; } }
  for(let s=1;s<8;s++){ const k = s === 1 ? KV : s === 2 ? KH : s === 6 ? KC : s === 7 ? KD : 0; if(!k || !(rRem[o+s] > 0) || (s === 1 && sk !== S_STEAM && sk !== S_BREAK)) continue;
    if(put(k, rRem[o+s]) >= 0) rRem[o+s] = 0; }
}
const src = {
  name: "PARTICLES",
  add: srcAdd,
  drop: r => { if(r >= 0 && r < MAXSRC){ flush(r); openOf(r, 0, 0); rOn[r] = 0; } },
  move: (r, cell) => { if(r >= 0 && r < MAXSRC) rCl[r] = cell; },
  clear: () => { rOn.fill(0); L.inj = null; },
  row: r => r >= 0 && r < MAXSRC && rOn[r] ? {kind:Object.keys(SK).find(k => SK[k] === rKd[r]), rate:rRt[r], cell:rCl[r], T:rTk[r], done:rDone[r]} : null,
  ok: () => L.ready,
  paint: (back, box, dots, al) => PARTGL.frame(back, box, dots, al),
  T: i => gwall[i] ? NaN : pc[i] >= 0 ? airT(i) : bW[i] > 0 ? T0 + bWE[i]/(bW[i]*CW) : T_HULL,
  P: i => { if(gwall[i]) return 0; if(pc[i] >= 0) return (kP[pc[i]] - P0)/1000;
    const k = colGasAbove(i); return k < 0 ? (pAt(i) - P0)/1000 : (kP[pc[k]] + RHO_W*G*(((i - k)/W)|0)*MPC - P0)/1000; },
  pk: i => pk[i],
  h2f: h2At,
  o2f: i => { const k = pc[i]; if(k < 0) return O2_FRAC0; const x = h2At(i);
    return kO[k]/Math.max(1e-9, kN[k] + kO[k])*(1 - Math.min(1, x)); },
  vap: i => bV[i],
  gas: i => nN[i]*MX_N + nO[i]*MX_O + bV[i] + bH[i] + bC[i] + bD[i],
  h2kg: i => bH[i],
  air: i => nN[i]*MX_N + nO[i]*MX_O,
  coKg: i => bC[i],
  co2Kg: i => bD[i],
  depV: i => dep[i],
  fpn: i => nFpN[i],
  fpv: i => nFpV[i],
  lfill: i => lfill[i],
  pocket: i => pc[i],
  body: i => bd[i],
  wallV: i => gwall[i] ? 2 : wall[i] ? 1 : 0,
  concV: i => conc[i],
  partV: i => mach[i] >= 0 ? 1 : pan[i] >= 0 ? 2 : vent[i] >= 0 ? 3 : inert[i] >= 0 ? 4 : catc[i] >= 0 ? 5 : 0,
  heatV: i => bQT[i],
  condV: i => cond[i],
  ablV: i => abl[i],
  crustV: i => crust[i],
  jetV: i => Math.sqrt(jetX[i]*jetX[i] + jetY[i]*jetY[i]),
  water: i => bW[i],
  waterT: i => bW[i] > 0 ? T0 + bWE[i]/(bW[i]*CW) : NaN,
  pool: i => bM[i],
  poolT: i => { MR[0] = bM[i]; MR[1] = bME[i]; poolTA(); return MR[2]; },
  poolLit: i => { if(!(bM[i] > 0) || (i >= W && bM[i-W] > 0)) return false; const f = FIRE[FIRE_KEYS[0]], j = i >= W ? i - W : i, k = pc[j];
    MR[0] = bM[i]; MR[1] = bME[i]; poolTA(); return k >= 0 && MR[2] >= f.ign && kO[k] >= f.loc*(kN[k] + kO[k] + kNP[k]); },
  cor: i => bXm[i],
  corT: i => bXm[i] > 0 ? bXT[i]/bXm[i] : NaN,
  cof: i => molF(i, bC[i]/CO_MMOL),
  co2f: i => molF(i, bD[i]/CO2_MMOL),
  smoke: i => bS[i] + dep[i],
  fp: i => nFpN[i] + nFpV[i] + bFp[i],
  flame: i => bF[i] === 1,
  lump: i => gwall[i] ? -1 : pc[i] >= 0 ? pc[i] : -2 - bd[i],
  door: i => isDoor[i] !== 0,
  infoHead: i => { if(gwall[i]) return "WALL" + (conc[i] > 0 ? "  CONCRETE " + (conc[i]*1000).toFixed(0) + " mm" : ""); const k = pc[i];
    const part = mach[i] >= 0 ? "MACHINE " + paSk[mach[i]].toFixed(0) + " K skin  " : pan[i] >= 0 ? "PAN  " : vent[i] >= 0 ? (paDir[vent[i]] ? "VENT IN  " : "VENT OUT  ") : inert[i] >= 0 ? "INERTING  " : catc[i] >= 0 ? "CATCHER  " : "";
    return part + (k >= 0 ? "GAS POCKET " + k : "UNDER LIQUID, body " + bd[i]); },
  info: i => { const h = src.infoHead(i), k = pc[i];
    return gwall[i] || k < 0 ? h : h + "  " + kV[k].toFixed(0) + " m3 of gas  " + (kT[k]).toFixed(0) + " K"; },
  pocketV: i => pc[i] >= 0 ? kV[pc[i]] : NaN,
  pocketT: i => pc[i] >= 0 ? kT[pc[i]] : NaN,
  tot: () => { const r = {gas:0, h2:0, o2:0, vap:0, wat:0, pool:0, cor:0, co:0, co2:0, smoke:0, fp:0, pk:0, maxT:-1e9, pockets:[]};
    for(let i=0;i<N;i++){ if(!gwall[i]){ r.gas += nN[i]*MX_N + nO[i]*MX_O + bV[i] + bH[i] + bC[i] + bD[i]; r.h2 += bH[i]; r.o2 += nO[i]*MX_O;
      r.vap += bV[i] + vAcc[i]; r.wat += bW[i] + cond[i]; r.co += bC[i]; r.co2 += bD[i]; r.smoke += bS[i] + dep[i]; r.fp += nFpN[i] + nFpV[i] + bFp[i]; }
      r.pool += bM[i]; r.cor += bXm[i]; }
    for(let s=0;s<MAXSRC;s++){ r.wat += rRem[8*s]; r.vap += rRem[8*s+1]; r.h2 += rRem[8*s+2]; }
    for(let k=0;k<L.npk;k++){ r.pk = Math.max(r.pk, (kP[k] - P0)/1000); r.maxT = Math.max(r.maxT, kT[k]); }
    for(let k=0;k<L.npk;k++){ if(!(kVg[k] > 0)) continue; r.pockets.push({id:k, V:kV[k], p:(kP[k] - P0)/1000, T:kT[k]}); }
    return r; },
};
// n mol of a species over every gas mole in cell i
function molF(i, n){ const k = pc[i]; if(k < 0 || !(n > 0)) return 0; return n/Math.max(1e-9, (kN[k] + kO[k] + kNP[k])*vgOf(i)/kVg[k]); }

// CAVITY: lined concrete over the board's bottom as its basemat, a pan and a vent; PLANT: a sealed box round one machine block; POUR: an open-topped tank
function benchRoom(kind){ const mat = {}, parts = [], at = (x, y) => y*GW + x, put = (x, y, m, t) => { mat[x + "," + y] = {m, t}; };
  if(kind === "cavity"){
    for(let y=16;y<GH;y++){ put(15, y, "lined", 1000); put(44, y, "lined", 1000); }
    for(let x=15;x<=44;x++) put(x, 16, "lined", 1000);
    parts.push({kind:"pan", cells:[at(40, GH-1), at(41, GH-1), at(42, GH-1), at(43, GH-1)]}, {kind:"vent", cells:[at(20, 17), at(21, 17)], dir:"out"}); }
  else if(kind === "plant"){
    for(let x=15;x<=44;x++){ put(x, 8, "liner", 600); put(x, 25, "liner", 600); } for(let y=8;y<=25;y++){ put(15, y, "liner", 600); put(44, y, "liner", 600); }
    const c = []; for(let y=18;y<=24;y++) for(let x=26;x<=33;x++) c.push(at(x, y));
    parts.push({kind:"machine", cells:c, T:900}); }
  else if(kind === "pour"){
    for(let y=2;y<=25;y++){ put(15, y, "liner", 600); put(44, y, "liner", 600); } for(let x=15;x<=44;x++) put(x, 25, "liner", 600); }
  return {mat, parts};
}
// the GPU paint's view: refilled per frame, as build() replaces the arrays
function gl(o){
  o.W = W; o.H = H; o.DV = DV; o.SV = SV; o.wall = wall; o.room = room; o.MW0 = MW0; o.S0 = S0; o.MC = RHO_W*Vc; o.K = K; o.L = L; o.DT = DT; o.derive = derive;
  o.GLOW_FULL = GLOW_FULL; o.GLOW_OFF = GLOW_OFF; o.MAXS = MAXS; o.MAXB = MAXB;
  o.sX = sX; o.sY = sY; o.sU = sU; o.sV = sV; o.sL = sL; o.sR = sR; o.bX = bX; o.bY = bY; o.bR = bR; o.bP = bP; o.bT = bT;
  o.px = px; o.py = py; o.qx = qx; o.qy = qy; o.sdx = sdx; o.sdy = sdy; o.vx = vx; o.vy = vy; o.pm = pm; o.pT = pT; o.pfo = pfo; o.psx = psx; o.psy = psy; o.pst = pst;
  o.ph = ph; o.pr = pr; o.pd = pd; o.pf = pf; o.pq = pq; o.sg = sg; o.burn = burn; o.kind = kind; o.frz = frz; o.pv = pv; o.pvf = pvf; o.Vc = Vc; o.crC = crC;
}
return { build, reset, step, blast, lay, src, gl, L, K, KNOBS, LQ, _stage: {grid, pairs, wallPass, water, wallSum, derive, joinDU, pcg},
  inject: (kind, rate, cell) => { L.inj = {kind, rate, cell}; rOn[0] = 1; rKd[0] = SK[kind] || 0; rRt[0] = rate; rCl[0] = cell; rTk[0] = kind === "steam" ? 373.15 : T_HULL; rUj[0] = 0; rVj[0] = 0; },
  off: () => { L.inj = null; flush(0); openOf(0, 0, 0); rOn[0] = 0; },
  parts: list => { PARTS = list || []; if(L.ready){ geom(); for(let a=0;a<MAXPART;a++) paSk[a] = paT[a]; } },
  geom, BK, BI, room: benchRoom,
  // the state the checks read, as it stands now
  get A(){ return {pE, pvf, pFp, pSo, pCF, pCK, pCZ, pCS, pCX, pDw, frz, pFci, pcel, nN, nO, eA, nFpN, nFpV, dep, abl, crust, gone, hotC, hotL, wall, gwall, conc,
    kN, kO, kNP, kV, kT, kE, kQ, kPE, kC, vnX, vnY, bW, bM, bXm, bC, bD, bS, bV, bH, bFp, vAcc, cond, condE, gAcc, gAT, condFp, condSo, paSk, catWet, lfill, HOT, rRem, rDone, CX, MF, CR}; },
  mix: {mixH, mixS, mixTA, corEA, poolTA, metalEA, chfA, ablate, CM, CX, MR, ZB, FL, AB},
  get np(){ return L.np; }, get px(){ return px; }, get py(){ return py; }, get vx(){ return vx; }, get vy(){ return vy; },
  get kind(){ return kind; }, get pm(){ return pm; }, get pv(){ return pv; }, get burn(){ return burn; },
  get fill(){ return fill; }, get pc(){ return pc; }, get kP(){ return kP; }, get pT(){ return pT; }, get lv(){ return lv; },
  get pfo(){ return pfo; }, get pst(){ return pst; }, get psx(){ return psx; }, get psy(){ return psy; }, rings: {sX, sY, sU, sV, sL, sR, bX, bY, bR, bP, bT},
  set tap(f){ TAP = f; }, get mvA(){ return mvA; }, get wdA(){ return wdA; }, get WR(){ return WR; }, wallE, WE, get dnA(){ return dnA; }, get wsA(){ return wsA; }, get pw(){ return pw; }, get ph(){ return ph; },
  get SW(){ return swP; },
  get pvf(){ return pvf; }, get ox(){ return ox; }, get oy(){ return oy; }, get bubN(){ return bubN; }, get RHO0(){ return RHO0; }, get RN0(){ return RN0; }, DT };
})();
