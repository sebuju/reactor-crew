"use strict";
/* Room contents as particles, a mockup set beside the cell grid in fluidbench. Water is coarse position-based SPH
   (Clavet, Beaudoin and Poulin 2005, double density relaxation); steam, hydrogen and heat are parcels that rise, draw in
   air as they go, crowd under a ceiling and ride the door jets. The air is lumped: one charge, temperature and pressure per
   gas pocket, cut at doors. The paint draws smooth fields off the particles, never a dot. */
// a door is a short gap in a thin wall line; a corridor between two thick walls is not one. 1 = passes sideways, 2 = up and down
function roomDoors(W, H, isW, max){
  const d = new Int8Array(W*H);
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
  return d;
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
const G = 9.81, T0 = 273.15, RU = 8.314462618, CW = 4190, LV = 2.257e6, RHO_W = 1000, GAM = 1.4, CP_AIR = 1005, QH2 = H2_LHV*1000;
const MX_O = O2_MMOL, MX_N = (AIR_MMOL - O2_FRAC0*O2_MMOL)/(1 - O2_FRAC0), CV_N = 20.8, CV_O = 21.1, CV_H = 20.4, CV_V = 25.3;
const KW = 1, KV = 2, KH = 3, KQ = 4;
const MAXP = 12000, EPS = 1e-3;
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
  ["open",  "WATER", "cells per particle in open water", 0.25, 4, 0.25, 1, true],
  ["stiff", "WATER", "stiffness",                 0.1,  1,    0.05,  0.3],
  ["near",  "WATER", "near push",                 0.1,  1,    0.05,  0.1],
  ["pull",  "WATER", "pull short of neighbours",  0,    1,    0.01,  0],
  ["visc",  "WATER", "viscosity",                 0,    20,   1,     4],
  ["vb",    "WATER", "quadratic viscosity",       0,    1,    0.05,  0.3],
  ["sub",   "WATER", "substeps per tick",         1,    6,    1,     3],
  ["dmax",  "WATER", "max move per substep cells", 0.1, 1,    0.05,  0.45],
  ["vcap",  "WATER", "max water speed m/s",       2,    40,   1,     15],
  ["wpull", "WATER", "walls pull water (0/1)",    0,    1,    1,     0],
  ["spr",   "WATER", "mass spread radius cells",  0.5,  1.5,  0.05,  0.75],
  ["split", "WATER", "split above x target mass", 1.3,  2.5,  0.1,   1.6],
  ["join",  "WATER", "join below x target mass",  0.3,  0.75, 0.05,  0.6],
  ["jcap",  "WATER", "joined mass cap x target",  1,    1.5,  0.05,  1.25],
  ["grav",  "WATER", "gravity x",                 0.75, 10,    0.25,  1],
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
];
// built whole: filled key by key it fell into dictionary mode, and every knob read in a pair loop was a hash lookup
const K = Object.fromEntries(KNOBS.map(r => [r[0], r[6]]));
const L = {wclamp:0, pdrop:0, npair:0, ready:false, t:0, tick:0, inj:null, hot:-1, np:0, npk:0, nlive:0, nb:0, nj:0, inKg:0, nsplit:0, njoin:0, nref:0, audit:false, aerr:new Float64Array(4)};
let W = 0, H = 0, N = 0, MW0 = 0, S0 = 1, HK0 = 1, HTOP = 1, LMAX = 0, RHO0 = 0, RN0 = 0, NC = 0, nRoom = 0;
const Vc = MPC*MPC*ROOM_DEPTH, Af = MPC*ROOM_DEPTH, P0 = ROOM_P0*1000, N0 = P0*Vc/(RU*T_HULL);
let px, py, qx, qy, rx, ry, mvx, mvy, vx, vy, ox, oy, pm, pT, pE, pv, pr, pd, pf, ph, pl, pw, kind, burn, age, pq, sg, cS, cCur, cP, pcel, pfo, sp0, pst, psx, psy;
let lv, ax, jst, pass = 0, DV = 0, SV, tagA, tagB, nearW, nearF, wtO, wtT, dist, que, TN, TO, WT0, WT1, WTX1, WTX2, spC, spW, spX, spY, rhoA, rnA, prP, prN, prA, prB, prQ, prR, prG;
let wall, wSat, bubX, bubN, nWall, wall9, room, isDoor, fill, pc, bd, bRef, bTop, nN, nO, eA, cond, condE, vAcc, vAT, bq, pk, jetX, jetY, stack;
let bW, bWE, bV, bH, bHv, bQT, bF;
let kV, kN, kO, kE, kT, kP, kA, kQ, kS, kNP, kC, kPE, kM;
let jCa, jCb, jAxis, jArea, jU, jC0, jCells;
// floats that outlive a call or cross one live in arrays: a let boxed each write, and an argument boxed wherever the call did not inline
const HM = new Float64Array(1);   // the largest water kernel
const INJ = new Float64Array(4);  // what each source holds under one particle: water, vapour, hydrogen, heat
const RS = new Int32Array(1);     // the dice
const DT = new Float64Array(2);   // the tick's dt and the substep's
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
  if(!(m > 0 && m < Infinity) || a !== a || b !== b) return Math.hypot(a, b); const u = a/m, v = b/m; return Math.sqrt(u*u + v*v)*m; };
// both take a cell, never a position, so no float crosses a call that may not inline: solid() of Math.floor(), cellAt() of |0
const solid = (ix, iy) => ix < 0 || iy < 0 || ix >= W || iy >= H || wall[iy*W + ix] === 1;
const cellAt = (ix, iy) => Math.min(H-1, Math.max(0, iy))*W + Math.min(W-1, Math.max(0, ix));
const cellOf = p => cellAt(px[p]|0, py[p]|0);
const gasC = i => !wall[i] && fill[i] < K.fgas;
// the table registers: p asked and its Tsat (kept, as every particle of a body asks at one p), T and its psat, MPa, H2 fraction and its speed
const TS = new Float64Array([NaN, 0, 0, 0, 0, 0, 0]);
function tsatA(c){ const p = pAt(c); if(p !== TS[0]){ TS[0] = p; TS[4] = Math.max(2e3, p)/1e6; satTA(SAT_WATER, TS, 4, 1); } }
function psatA(p){ const t = pT[p]; if(t < 647){ TS[2] = t; curveA(SAT_WATER, CV_SP, TS, 2, 3); TS[3] *= 1e6; } else TS[3] = 1e12; }
const open = j => gasC(j) && !isDoor[j], doorGas = j => gasC(j) && isDoor[j] !== 0, wet = j => !wall[j] && pc[j] < 0;
const vgOf = i => Vc*Math.max(0.05, 1 - Math.min(1, fill[i]));
const pAt = c => pc[c] >= 0 ? kP[pc[c]] : bd[c] >= 0 ? bRef[bd[c]] : P0;
const airT = c => pc[c] >= 0 ? kT[pc[c]] + bQT[c] : T_HULL;
const molOf = p => kind[p] === KH ? pm[p]/H2_MMOL : kind[p] === KV ? pm[p]/H2O_MMOL : 0;
// pv*N0 is the moles a parcel has mixed with, its own included, so squeezing or heating the pocket leaves the share alone
const xOf = p => molOf(p)/(pv[p]*N0);
const h2At = i => bH[i] > 0 ? bH[i]/H2_MMOL/(Math.max(1, bHv[i])*N0) : 0;
const rOf = p => Math.min(RMAX, Math.sqrt(pv[p]/Math.PI));
const dTOf = p => pE[p]/(1.2*CP_AIR*Vc*pv[p]);
// capped, so no pair or wall reaches past what nearW and the wall tags were cut for
const hOf = p => kind[p] === KW ? Math.min(HTOP, HK0*Math.sqrt(pm[p]/MW0)) : 0;
// hot loops read pr, pd, pf, ph, pl (log2 of the mass in fine particles) and pw (a pair's density mass factor), never the helpers: a float a call that does not inline hands back is boxed
function derive(){ let m = 0; for(let p=0;p<L.np;p++){ pr[p] = rOf(p); pd[p] = dTOf(p); pf[p] = xOf(p); ph[p] = hOf(p); if(ph[p] > m) m = ph[p];
  pl[p] = Math.log2(pm[p]/MW0); pw[p] = pm[p]/MW0*HK0*HK0; } HM[0] = m; }

function build(){
  W = GW; H = GH; N = W*H;
  const F = k => new Float64Array(k), I = k => new Int32Array(k);
  px = F(MAXP); py = F(MAXP); qx = F(MAXP); qy = F(MAXP); rx = F(MAXP); ry = F(MAXP); mvx = F(MAXP); mvy = F(MAXP); vx = F(MAXP); vy = F(MAXP); ox = F(MAXP); oy = F(MAXP); pm = F(MAXP); pT = F(MAXP); pE = F(MAXP); pv = F(MAXP); pr = F(MAXP); pd = F(MAXP); pf = F(MAXP); ph = F(MAXP); pl = F(MAXP); pw = F(MAXP);
  kind = new Uint8Array(MAXP); burn = new Uint8Array(MAXP); age = F(MAXP); pq = F(MAXP); sg = new Uint8Array(MAXP); cS = I(N + 1); cCur = I(N); cP = I(MAXP); pcel = I(MAXP); pfo = F(MAXP); sp0 = F(MAXP); pst = F(MAXP); psx = F(MAXP); psy = F(MAXP);
  wall = new Uint8Array(N); nWall = new Uint8Array(N); wall9 = new Uint8Array(N);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wall[y*W+x] = matWall(x, y) ? 1 : 0;
  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y*W+x] === 1;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ nWall[y*W+x] = (isW(x-1, y) ? 1 : 0) + (isW(x+1, y) ? 1 : 0) + (isW(x, y-1) ? 1 : 0) + (isW(x, y+1) ? 1 : 0);
    let k = 0; for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++) if(isW(x+a, y+b)) k++; wall9[y*W+x] = k; }
  wSat = new Int32Array((W + 1)*(H + 1));
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wSat[(y + 1)*(W + 1) + x + 1] = wall[y*W+x] + wSat[y*(W + 1) + x + 1] + wSat[(y + 1)*(W + 1) + x] - wSat[y*(W + 1) + x];
  isDoor = roomDoors(W, H, isW, DOOR_MAX);
  room = new Int32Array(N).fill(-1); stack = new Int32Array(N);
  nRoom = 0;
  for(let i=0;i<N;i++) if(!wall[i] && !isDoor[i] && room[i] < 0) gridFlood(W, H, room, stack, i, nRoom++, j => !wall[j] && !isDoor[j]);
  for(let i=0;i<N;i++) if(isDoor[i]) room[i] = -2;
  lv = I(N); ax = new Uint8Array(N); jst = I(MAXP); tagA = I(N); tagB = I(N); nearW = new Uint8Array(N); nearF = new Uint8Array(N); dist = I(N); que = I(N); spC = I(1024); spW = F(1024); spX = F(1024); spY = F(1024); rhoA = F(MAXP); rnA = F(MAXP); prP = F(MAXP); prN = F(MAXP); prA = I(32*MAXP); prB = I(32*MAXP); prQ = F(32*MAXP); prR = F(32*MAXP); prG = F(32*MAXP);
  fill = F(N); pc = I(N); bd = I(N); bRef = F(N); bTop = F(N); nN = F(N); nO = F(N); eA = F(N); cond = F(N); condE = F(N); vAcc = F(N); vAT = F(N); bq = F(N);
  pk = F(N); jetX = F(N); jetY = F(N); bubX = new Uint8Array(N); bubN = new Uint8Array(N);
  bW = F(N); bWE = F(N); bV = F(N); bH = F(N); bHv = F(N); bQT = F(N); bF = new Uint8Array(N);
  kV = F(N); kN = F(N); kO = F(N); kE = F(N); kT = F(N); kP = F(N); kA = F(N); kQ = F(N); kS = F(N); kNP = F(N); kC = F(N); kPE = F(N); kM = F(N);
  // one junction per door run; the cells either side of it stand for the two pockets
  const ja = [], jb = [], jx = [], jl = [], cells = [];
  for(let x=0;x<W;x++) for(let y=0;y<H;y++){ const i = y*W+x; if(isDoor[i] !== 1 || (y > 0 && isDoor[i-W] === 1)) continue;
    let e = y; while(e+1 < H && isDoor[(e+1)*W+x] === 1) e++;
    ja.push(i-1); jb.push(i+1); jx.push(0); jl.push(e-y+1); const c = []; for(let k=y;k<=e;k++) c.push(k*W+x); cells.push(c); }
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i = y*W+x; if(isDoor[i] !== 2 || (x > 0 && isDoor[i-1] === 2)) continue;
    let e = x; while(e+1 < W && isDoor[y*W+e+1] === 2) e++;
    ja.push(i-W); jb.push(i+W); jx.push(1); jl.push(e-x+1); const c = []; for(let k=x;k<=e;k++) c.push(y*W+k); cells.push(c); }
  const nj = L.nj = ja.length;
  jCa = Int32Array.from(ja); jCb = Int32Array.from(jb); jAxis = Uint8Array.from(jx); jArea = Float64Array.from(jl, n => n*Af); jU = F(nj);
  jC0 = new Int32Array(nj+1); cells.forEach((c, j) => { jC0[j+1] = jC0[j] + c.length; }); jCells = Int32Array.from(cells.flat());
  reset();
}

// the particle size is read here: a fine particle is a 1/ppc share of a cell, and it feels the ones within two spacings
function reset(){
  S0 = 1/Math.sqrt(K.ppc); MW0 = RHO_W*Vc/K.ppc; HK0 = 2*S0; LMAX = Math.max(0, Math.round(Math.log2(K.open*K.ppc))); HTOP = HK0*Math.sqrt(1.6*Math.pow(2, LMAX)); HM[0] = HK0;
  // lq..: the lattice rows a flat wall stands in for, seen from the first row at rest; wq..: the same half-plane as a continuum
  let lq = 0, lq2 = 0, lq3 = 0, lq2u = 0, wq = 0, wq2 = 0, wq3 = 0, wq2u = 0, vq = 0, vq2 = 0; RHO0 = 0; RN0 = 0;
  for(let a=-6;a<=6;a++) for(let b=-6;b<=6;b++){ const r = Math.hypot(a, b)*S0; if(!(r > 0 && r < HK0)) continue; const q = 1 - r/HK0;
    RHO0 += q*q; RN0 += q*q*q; if(b >= 1){ lq += q*b*S0/r; lq2 += q*q; lq3 += q*q*q; lq2u += q*q*b*S0/r; vq += b*q*b*S0/r; vq2 += b*q*q*b*S0/r; } }
  NC = vq2/vq;
  const ds = S0/40;
  for(let y=S0/2 + ds/2;y<HK0;y+=ds) for(let x=-HK0 + ds/2;x<HK0;x+=ds){ const r = Math.hypot(x, y); if(r >= HK0) continue; const q = 1 - r/HK0, w = ds*ds/(S0*S0);
    wq += w*q*y/r; wq2 += w*q*q; wq3 += w*q*q*q; wq2u += w*q*q*y/r; }
  walls(Math.ceil(HTOP)); tables(LMAX + 2, lq/wq, lq2u/wq2u, lq2/wq2, lq3/wq3); sizes(); wallTable();
  L.np = 0; RS[0] = 1; INJ.fill(0); SS[0] = 0; SS[1] = 7; SS[2] = 0; sL.fill(0); bT.fill(0);
  cond.fill(0); condE.fill(0); vAcc.fill(0); vAT.fill(0); bq.fill(0); pk.fill(0); jetX.fill(0); jetY.fill(0); fill.fill(0); jU.fill(0);
  for(let i=0;i<N;i++){ if(wall[i]){ nN[i] = 0; nO[i] = 0; eA[i] = 0; continue; }
    nN[i] = N0*(1 - O2_FRAC0); nO[i] = N0*O2_FRAC0; eA[i] = (nN[i]*CV_N + nO[i]*CV_O)*(T_HULL - T0); }
  L.t = 0; L.tick = 0; L.inj = null; L.hot = -1; L.inKg = 0; L.nsplit = 0; L.njoin = 0; L.nref = 0; L.wclamp = 0; L.pdrop = 0; L.aerr.fill(0); L.ready = true;
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
  const dw = 2*DV + 1; SV = new Uint8Array(N*dw*dw);
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
// per level, the kernel integrated over a wall square at an offset (1/8 cell grid, one quadrant): q^2, q^3, q u_x, q^2 u_x, each scaled so
// a flat wall gives the first row at rest what the lattice rows it replaces would
function tables(NL, cQ, cQ2, cD, cN){
  TN = new Int32Array(NL); TO = new Int32Array(NL + 1);
  for(let l=0;l<NL;l++){ const h = HK0*Math.pow(2, l/2); TN[l] = Math.ceil((h + 0.5)*8) + 1; TO[l+1] = TO[l] + TN[l]*TN[l]; }
  WT0 = new Float64Array(TO[NL]); WT1 = new Float64Array(TO[NL]); WTX1 = new Float64Array(TO[NL]); WTX2 = new Float64Array(TO[NL]);
  for(let l=0;l<NL;l++){ const h = HK0*Math.pow(2, l/2), n = TN[l], kd = HK0*HK0/(S0*S0*h*h)/64, ku = 4/(h*h)/64;
    for(let b=0;b<n;b++) for(let a=0;a<n;a++){ let s1 = 0, s2 = 0, s3 = 0, s2x = 0;
      for(let j=0;j<8;j++) for(let i=0;i<8;i++){ const ex = a/8 - 0.5 + (i + 0.5)/8, ey = b/8 - 0.5 + (j + 0.5)/8, r = Math.hypot(ex, ey);
        if(r >= h || r < 1e-9) continue; const q = 1 - r/h; s1 += q*ex/r; s2 += q*q; s3 += q*q*q; s2x += q*q*ex/r; }
      const o = TO[l] + b*n + a; WT0[o] = cD*kd*s2; WT1[o] = cN*kd*s3; WTX1[o] = cQ*ku*s1; WTX2[o] = cQ2*ku*s2x; } }
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
function seesC(ca, cb){
  const a = cb%W - ca%W, b = ((cb/W)|0) - ((ca/W)|0), dw = 2*DV + 1;
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
    // through a corner exactly: either side cell stops it
    if(Math.abs(tx - ty) < 1e-12){ const a = cy*W + cx + sx, b = (cy + sy)*W + cx;
      if(wall[a] || wall[b]){ if(!out) return wall[a] ? a : b; inW = true; } }
    if(tx < ty){ tx += tdx; cx += sx; } else { ty += tdy; cy += sy; }
    const i = cy*W + cx;
    if(wall[i]){ if(!out) return i; inW = true; } else if(inW) return i; }
  return -1;
}
// what the wall cells in reach add to a water particle: WS = density, near density, and the push per unit P and per unit Pn (x, y)
const WS = new Float64Array(6);
// the wall cells in reach that particle p's room counts, as it stands in cell c; past the board's edge is wall, or water on its floor
// never went still
function wallAt(p, c){
  const x = px[p], y = py[p], R = Math.ceil(ph[p]), cx = c%W, cy = (c/W)|0, NL = TN.length, w = W, h = H, rg = room[c];
  const lf = Math.max(0, Math.min(NL - 1, pl[p])), l0 = Math.min(NL - 2, lf|0), t = lf - l0;
  const A0 = WT0, A1 = WT1, X1 = WTX1, X2 = WTX2, tn = TN, to = TO, nTop = tn[l0+1];
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0;
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
      s1 += w00*A1[k] + w10*A1[k+1] + w01*A1[k+n] + w11*A1[k+n+1];
      s4 += sx*(w00*X2[k] + w10*X2[k+1] + w01*X2[k+n] + w11*X2[k+n+1]);
      s5 += sy*(w00*X2[kt] + w01*X2[kt+1] + w10*X2[kt+n] + w11*X2[kt+n+1]); } }
  WS[0] = s0; WS[1] = s1; WS[2] = s2; WS[3] = s3; WS[4] = s4; WS[5] = s5;
}
// wtT: per cell near a wall, per level of its span (lv - 1 to lv + 1), wallAt() on a grid of points WQ apart, 6 floats a point
const WG = 9, WQ = WG - 1, WL = 3;
function wallTable(){
  const NL = TN.length, q = MAXP - 1, st = WL*WG*WG*6; let n = 0;
  wtO = new Int32Array(N).fill(-1);
  for(let c=0;c<N;c++) if(nearW[c]){ wtO[c] = n; n += st; }
  wtT = new Float32Array(n);
  for(let c=0;c<N;c++){ if(wtO[c] < 0) continue; const cx = c%W, cy = (c/W)|0, lo = Math.max(0, lv[c] - 1), hi = Math.min(NL - 1, lv[c] + 1);
    for(let l=lo;l<=hi;l++){ pl[q] = l; ph[q] = Math.min(HTOP, HK0*Math.pow(2, l/2));
      for(let j=0;j<WG;j++) for(let i=0;i<WG;i++){ px[q] = cx + i/WQ; py[q] = cy + j/WQ; wallAt(q, c);
        const o = wtO[c] + (((l - lo)*WG + j)*WG + i)*6; for(let k=0;k<6;k++) wtT[o+k] = WS[k]; } } }
}
// all = 0: the first-moment pair WS[2], WS[3] only, all viscosity() reads; bilinear in the point, linear in the level, clamped to the cell's span
function wallSum(p, c, all){
  for(let k=0;k<6;k++) WS[k] = 0;
  const o = wtO[c]; if(o < 0) return;
  const lo = Math.max(0, lv[c] - 1), hi = Math.min(TN.length - 1, lv[c] + 1);
  let lf = pl[p]; if(lf < lo){ lf = lo; L.wclamp++; } else if(lf > hi){ lf = hi; L.wclamp++; }
  const l0 = Math.min(hi - 1, lf|0), t = lf - l0;
  let fx = (px[p] - c%W)*WQ, fy = (py[p] - ((c/W)|0))*WQ;
  fx = fx < 0 ? 0 : fx > WQ ? WQ : fx; fy = fy < 0 ? 0 : fy > WQ ? WQ : fy;
  const i0 = Math.min(WQ - 1, fx|0), j0 = Math.min(WQ - 1, fy|0), a = fx - i0, b = fy - j0, T = wtT, k0 = all ? 0 : 2, k1 = all ? 6 : 4, r = WG*6;
  for(let l=0;l<2;l++){ const wl = l ? t : 1 - t, e = o + (((l0 - lo + l)*WG + j0)*WG + i0)*6;
    const w00 = (1 - a)*(1 - b)*wl, w10 = a*(1 - b)*wl, w01 = (1 - a)*b*wl, w11 = a*b*wl;
    for(let k=k0;k<k1;k++) WS[k] += w00*T[e+k] + w10*T[e+6+k] + w01*T[e+r+k] + w11*T[e+r+6+k]; }
}

function spawn(k){
  const x = SPA[0], y = SPA[1], m = SPA[2], T = SPA[3], u = SPA[4], v = SPA[5];
  if(L.np >= MAXP || solid(Math.floor(x), Math.floor(y))) return -1;
  const p = L.np++;
  kind[p] = k; px[p] = x; py[p] = y; qx[p] = x; qy[p] = y; ox[p] = x; oy[p] = y; vx[p] = u; vy[p] = v; pm[p] = m; pT[p] = T; pE[p] = 0; burn[p] = 0; age[p] = 0; pq[p] = 0; sg[p] = 0; pfo[p] = 0; sp0[p] = hyp(u, v); pst[p] = 1; psx[p] = u; psy[p] = v;
  ph[p] = hOf(p);
  pv[p] = k === KQ ? 1 : Math.max(0.05, molOf(p)/N0*T/T_HULL);
  return p;
}
function kill(p){ const q = --L.np; if(p === q) return;
  kind[p] = kind[q]; px[p] = px[q]; py[p] = py[q]; qx[p] = qx[q]; qy[p] = qy[q]; ox[p] = ox[q]; oy[p] = oy[q]; vx[p] = vx[q]; vy[p] = vy[q];
  pm[p] = pm[q]; pT[p] = pT[q]; pE[p] = pE[q]; pv[p] = pv[q]; ph[p] = ph[q]; burn[p] = burn[q]; age[p] = age[q]; pq[p] = pq[q]; sg[p] = sg[q]; pfo[p] = pfo[q]; sp0[p] = sp0[q]; pst[p] = pst[q]; psx[p] = psx[q]; psy[p] = psy[q]; }
function sweep(){ for(let p=L.np-1;p>=0;p--) if(kind[p] === 0) kill(p); }
// water laid at rest: frac of the cell on a lattice in it at the cell's own size, one a cell at most; laid fine and joined up, a pool stirred for seconds
function lay(i, frac){
  const n = Math.max(1, Math.round(frac*RHO_W*Vc/Math.min(mT(i), RHO_W*Vc))), nx = Math.ceil(Math.sqrt(n)), ny = Math.ceil(n/nx), m = frac*RHO_W*Vc/n, x0 = i%W, y0 = (i/W)|0;
  for(let k=0;k<n;k++){ const a = k%nx, b = (k/nx)|0, row = b < ny - 1 ? nx : n - nx*(ny - 1);
    SPA[0] = x0 + (a + 0.5)/row; SPA[1] = y0 + (b + 0.5)/ny; SPA[2] = m; SPA[3] = T_HULL; SPA[4] = 0; SPA[5] = 0; spawn(KW); }
}

const mT = c => MW0*Math.pow(2, lv[c]);
// AU: what one split or join moved of mass, x and y momentum and energy, after less before; the audit sums it over the pass
const AU = new Float64Array(4);
function book4(p, s){ if(!L.audit) return; const m = pm[p]*s, u = vx[p]*MPC, v = vy[p]*MPC;
  AU[0] += m; AU[1] += m*u; AU[2] += m*v; AU[3] += m*(CW*(pT[p] - T0) + 0.5*(u*u + v*v)); }
function split(p, c){
  if(L.np >= MAXP){ L.nref++; return; }
  const m = pm[p]/2, d = 0.25*S0*Math.sqrt(m/MW0), ux = ax[c] === 0 ? d : 0, uy = ax[c] === 0 ? 0 : d, x = px[p], y = py[p];
  let xa = x - ux, ya = y - uy, xb = x + ux, yb = y + uy;
  if(solid(Math.floor(xa), Math.floor(ya))){ xa = x; ya = y; }
  if(solid(Math.floor(xb), Math.floor(yb))){ xb = x; yb = y; }
  book4(p, -1);
  SPA[0] = xb; SPA[1] = yb; SPA[2] = m; SPA[3] = pT[p]; SPA[4] = vx[p]; SPA[5] = vy[p];
  const q = spawn(KW);
  pm[p] = m; pE[p] /= 2; pE[q] = pE[p]; pfo[q] = pfo[p]; pst[q] = pst[p]; psx[q] = psx[p]; psy[q] = psy[p]; px[p] = xa; py[p] = ya; qx[p] = xa; qy[p] = ya; ox[p] = xa; oy[p] = ya; ph[p] = hOf(p);
  jst[p] = pass; jst[q] = pass; L.nsplit++;
  book4(p, 1); book4(q, 1);
}
// the pair's lost kinetic energy stays as heat, so a join keeps mass, momentum and energy
function join(p, c){
  const x = px[p], y = py[p], hp = hOf(p), R = Math.ceil(hp), cx = c%W, cy = (c/W)|0, cap = K.jcap*mT(c);
  let best = -1, d2 = hp*hp;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
    for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(j === p || kind[j] !== KW || jst[j] === pass) continue;
      const dx = px[j] - x, dy = py[j] - y, r2 = dx*dx + dy*dy; if(r2 >= d2) continue;
      const cj = cellOf(j); if(pm[p] + pm[j] > cap || pm[p] + pm[j] > K.jcap*mT(cj)) continue;
      SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(c, cj)) continue;
      best = j; d2 = r2; }
  if(best < 0) return;
  const j = best, a = pm[p], b = pm[j], s = a + b, du = vx[p] - vx[j], dv = vy[p] - vy[j];
  book4(p, -1); book4(j, -1);
  const dKE = 0.5*a*b/s*(du*du + dv*dv)*MPC*MPC;
  // a splash starts where the faster of the two stood: the drop that landed, not the body it landed in
  const pFast = vx[p]*vx[p] + vy[p]*vy[p] >= vx[j]*vx[j] + vy[j]*vy[j]; SPH[1] = pFast ? x : px[j]; SPH[2] = pFast ? y : py[j];
  px[j] = (px[j]*b + x*a)/s; py[j] = (py[j]*b + y*a)/s; vx[j] = (vx[j]*b + vx[p]*a)/s; vy[j] = (vy[j]*b + vy[p]*a)/s;
  pT[j] = (pT[j]*b + pT[p]*a)/s + dKE/(s*CW); pm[j] = s; pE[j] += pE[p]; pfo[j] = (pfo[j]*b + pfo[p]*a)/s;
  pst[j] = (pst[j]*b + pst[p]*a)/s; psx[j] = (psx[j]*b + psx[p]*a)/s; psy[j] = (psy[j]*b + psy[p]*a)/s;
  qx[j] = px[j]; qy[j] = py[j]; ph[j] = hOf(j);
  kind[p] = 0; jst[p] = pass; jst[j] = pass; L.njoin++;
  book4(j, 1);
  // a drop landing on a pool joins it the tick it arrives: the pair's closing speed is the hit
  const hs = Math.sqrt(du*du + dv*dv)*MPC; if(hs > K.fhit){ SPH[0] = hs; SPH[3] = 0; SPH[4] = 0; splash(j); }
}
function adapt(){
  grid(); pass++;
  let M = 0, PA = 0, KE = 0;
  if(L.audit){ for(let k=0;k<4;k++) AU[k] = 0;
    for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue; const v = Math.sqrt(vx[p]*vx[p] + vy[p]*vy[p])*MPC; M += pm[p]; PA += pm[p]*v; KE += 0.5*pm[p]*v*v; } }
  const n0 = L.np, e0 = L.nsplit + L.njoin;
  for(let p=0;p<n0;p++){ if(kind[p] !== KW || jst[p] === pass) continue;
    const c = cellOf(p), t = mT(c);
    if(pm[p] > K.split*t) split(p, c);
    else if(pm[p] < K.join*t) join(p, c); }
  if(L.audit && L.nsplit + L.njoin > e0){ const e = L.aerr;
    e[0] = Math.max(e[0], Math.abs(AU[0])/M); e[1] = Math.max(e[1], Math.abs(AU[1])/PA); e[2] = Math.max(e[2], Math.abs(AU[2])/PA); e[3] = Math.max(e[3], Math.abs(AU[3])/KE); }
}

function bin(){
  bW.fill(0); bWE.fill(0); bV.fill(0); bH.fill(0); bHv.fill(0); bQT.fill(0); bF.fill(0);
  for(let p=0;p<L.np;p++){ const c = cellOf(p), k = kind[p];
    if(k === KW) book(p, c);
    else if(k === KV) bV[c] += pm[p];
    else if(k === KH){ bH[c] += pm[p]; bHv[c] += pv[p]; if(burn[p]) bF[c] = 1; }
    else if(k === KQ) bQT[c] = Math.max(bQT[c], dTOf(p)); }
  for(let i=0;i<N;i++) fill[i] = wall[i] ? 1 : bW[i]/(RHO_W*Vc);
}
// a water particle's mass over the cells it can see within its spacing: a particle bigger than a cell fills its neighbours, not one cell many times
function book(p, c){
  const x = px[p], y = py[p], R = Math.max(K.spr, 0.5*hOf(p)), Rc = Math.ceil(R), cx = c%W, cy = (c/W)|0;
  let n = 0, sw = 0;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc);gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++){ const i = gy*W + gx;
    if(wall[i]) continue;
    // out of reach with margin to spare whatever hyp() rounds to, so the call is skipped
    const ex = gx + 0.5 - x, ey = gy + 0.5 - y; if(ex*ex + ey*ey >= R*R*(1 + 1e-12)) continue;
    const d = hyp(ex, ey); if(d >= R) continue;
    SEG[2] = gx + 0.5; SEG[3] = gy + 0.5; if(!seesC(c, i)) continue;
    const w = (1 - d/R)*(1 - d/R); spC[n] = i; spW[n] = w; sw += w; n++; }
  const m = pm[p], e = m*CW*(pT[p] - T0);
  for(let k=0;k<n;k++){ const f = spW[k]/sw; bW[spC[k]] += m*f; bWE[spC[k]] += e*f; }
}

// the pocket's gas is one mixture at one temperature: the air, the heat parcels and the steam and hydrogen parcels all share it
const cvOf = k => kN[k]*CV_N + kO[k]*CV_O + kC[k];
function state(k){ const cv = cvOf(k);
  kT[k] = cv > 0 ? T0 + (kE[k] + kQ[k] + kPE[k])/cv : T_HULL;
  kP[k] = RU*(kN[k] + kO[k] + kNP[k])*kT[k]/kV[k]; }

// in stages, each its own function: one body this size runs out of inlining budget, and every float a helper hands back is boxed
function pockets(live){ airOut(); const nk = label(); roofs(nk); sums(nk); settle(nk, live); spread(); bodies(); bubs(); }
// air in a cell the water has taken moves to a gas neighbour, up first; with none beside it, up a cell, so a trapped bubble climbs
function airOut(){
  for(let i=0;i<N;i++){ if(wall[i] || gasC(i) || !(nN[i] + nO[i] > 0)) continue;
    const x = i%W; let j = -1;
    if(i >= W && gasC(i-W)) j = i-W; else if(x > 0 && gasC(i-1)) j = i-1; else if(x < W-1 && gasC(i+1)) j = i+1;
    else if(i+W < N && gasC(i+W)) j = i+W; else if(i >= W && !wall[i-W]) j = i-W;
    if(j < 0) continue;
    nN[j] += nN[i]; nO[j] += nO[i]; eA[j] += eA[i]; nN[i] = 0; nO[i] = 0; eA[i] = 0; }
}
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
  for(let k=0;k<nk;k++){ kA[k] = 0; kV[k] = 0; kN[k] = 0; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; kV[k]++; kN[k] += nN[i] + nO[i]; if(i < W || wall[i-W]) kA[k] = 1; }
  // a void under a roof with next to no air in it is a gap between particles too: as a vacuum it would boil cold water
  for(let k=0;k<nk;k++) if(kN[k] < 0.1*N0*kV[k]) kA[k] = 0;
  let nl = 0; for(let k=0;k<nk;k++) if(kA[k]) nl++; L.nlive = nl;
  // only a roof holds air: a pocket with water over all of it is a gap between particles, and its air rises to the pocket over it
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0 || kA[k]) continue;
    let j = i - W; while(j >= 0 && !wall[j] && (pc[j] < 0 || !kA[pc[j]])) j -= W;
    if(j < 0 || wall[j]){ pc[i] = -1; continue; }
    nN[j] += nN[i]; nO[j] += nO[i]; eA[j] += eA[i]; nN[i] = 0; nO[i] = 0; eA[i] = 0; pc[i] = -1; }
}
function sums(nk){
  for(let k=0;k<nk;k++){ kV[k] = 0; kN[k] = 0; kO[k] = 0; kE[k] = 0; kA[k] = 0; kQ[k] = 0; kS[k] = 0; kNP[k] = 0; kC[k] = 0; kPE[k] = 0; kM[k] = 0; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue;
    kV[k] += vgOf(i); kN[k] += nN[i]; kO[k] += nO[i]; kE[k] += eA[i]; kA[k] += 2*MPC*MPC + Af*nWall[i]; if(mT(i) > kM[k]) kM[k] = mT(i); }
  for(let p=0;p<L.np;p++){ const k = pc[cellOf(p)], kd = kind[p]; if(k < 0 || kd === KW) continue;
    if(kd === KQ){ kQ[k] += pE[p]; continue; }
    const n = molOf(p), c = n*(kd === KH ? CV_H : CV_V); kS[k] += pv[p]; kNP[k] += n; kC[k] += c; kPE[k] += c*(pT[p] - T0); }
  // the parcels mix with no more gas than the pocket holds, a pocket full of them is evenly mixed, and a parcel never with less
  // than its own
  for(let p=0;p<L.np;p++){ const k = pc[cellOf(p)]; if(k < 0 || kind[p] === KW || kind[p] === KQ) continue;
    const cap = (kN[k] + kO[k] + kNP[k])/N0; if(kS[k] > cap) pv[p] *= cap/kS[k]; pv[p] = Math.max(pv[p], molOf(p)/N0); }
}
function settle(nk, live){ const dt = live ? DT[0] : 0;
  for(let k=0;k<nk;k++){ if(!(kV[k] > 0)){ kV[k] = Vc; kT[k] = T_HULL; kP[k] = P0; continue; } state(k);
    if(dt > 0){ const d = kT[k] - T_HULL;
      kE[k] -= Math.sign(d)*Math.min(0.5*Math.abs(d)*cvOf(k), K.hwall*kA[k]*Math.abs(d)*dt); state(k); } }
  if(dt > 0) doors();
}
function spread(){
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; const s = vgOf(i)/kV[k];
    nN[i] = kN[k]*s; nO[i] = kO[k]*s; eA[i] = kE[k]*s;
    const g = (kP[k] - P0)/1000; if(g > pk[i]) pk[i] = g; }
}
// water pressure is the gas over the highest free surface plus the weight under it; the surface is read off cell fill so it never jumps a row (bTop < 0: none yet, -1 - top row)
function bodies(){
  bd.fill(-1); let nb = 0;
  for(let i=0;i<N;i++) if(bd[i] < 0 && wet(i)){ bRef[nb] = 1e30; bTop[nb] = -1 - ((i/W)|0); gridFlood(W, H, bd, stack, i, nb++, wet); }
  L.nb = nb;
  for(let i=W;i<N;i++){ const b = bd[i]; if(b < 0 || pc[i-W] < 0) continue; const s = ((i/W)|0) + 1 - fill[i] - fill[i-W]; if(bTop[b] < 0 || s < bTop[b]){ bTop[b] = s; bRef[b] = kP[pc[i-W]]; } }
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
    const u = Math.min(50, f*nd*mm/dt/(rho*jArea[j]))/MPC*(d === a ? 1 : -1);
    jU[j] = u*MPC;
    for(let k=jC0[j];k<jC0[j+1];k++){ const i = jCells[k], o = jAxis[j] ? W : 1;
      for(let c=i-o;c<=i+o;c+=o) if(c >= 0 && c < N){ if(jAxis[j]) jetY[c] = u; else jetX[c] = u; } }
    state(a); state(b); }
}

function sources(){
  L.hot = -1;
  const q = L.inj; if(!q || q.cell < 0 || wall[q.cell]) return;
  const i = q.cell, r = q.rate, x = i%W + 0.5, y = ((i/W)|0) + 0.5, dt = DT[0];
  if(q.kind === "fluid"){
    if(r > 0){ INJ[0] += r*dt; L.inKg += r*dt;
      while(INJ[0] >= MW0){ SPA[0] = x + (rnd() - 0.5)*0.6; SPA[1] = y + (rnd() - 0.5)*0.6; SPA[2] = MW0; SPA[3] = T_HULL; SPA[4] = (rnd() - 0.5)*2; SPA[5] = 2;
        if(spawn(KW) < 0) break; INJ[0] -= MW0; } }
    else { let need = -r*dt;
      for(let p=L.np-1;p>=0 && need > 0;p--){ const dx = px[p] - x, dy = py[p] - y; if(kind[p] !== KW || dx*dx + dy*dy > 2.25) continue;
        SEG[0] = x; SEG[1] = y; SEG[2] = px[p]; SEG[3] = py[p]; if(!sees(i, cellOf(p), null)) continue;
        const g = Math.min(pm[p], need); pm[p] -= g; need -= g; L.inKg -= g; if(pm[p] < 1e-9) kill(p); } }
  }
  else if(q.kind === "heat"){ const E = r*1000*dt;
    if(fill[i] >= 0.5){ let m = 0; for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) m += pm[p];
      if(m > 0){ for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) pT[p] = Math.max(274, pT[p] + E/(m*CW)); return; } }
    if(r > 0){ INJ[3] += E; const e0 = r*1000/K.emit;
      while(INJ[3] >= e0){ SPA[0] = x + (rnd() - 0.5)*0.4; SPA[1] = y; SPA[2] = 0; SPA[3] = T_HULL; SPA[4] = rnd() - 0.5; SPA[5] = -1;
        const p = spawn(KQ); if(p < 0) break; pE[p] = e0; INJ[3] -= e0; }
      if(airT(i) + r/(0.01*(2*Af + 2*MPC*MPC)) >= H2_IGN_SURF) L.hot = i; }
    else if(pc[i] >= 0){ const cv = nN[i]*CV_N + nO[i]*CV_O; eA[i] -= Math.min(-E, Math.max(0, eA[i] - cv*(150 - T0))); }
  }
  else if(q.kind === "h2" || q.kind === "steam"){
    const k = q.kind === "h2" ? KH : KV, Ts = k === KH ? T_HULL : 373.15, m0 = Math.abs(r)/K.emit;
    if(r > 0){ L.inKg += r*dt; if(k === KH) INJ[2] += r*dt; else INJ[1] += r*dt;
      while((k === KH ? INJ[2] : INJ[1]) >= m0){
        SPA[0] = x + (rnd() - 0.5)*0.4; SPA[1] = y + (rnd() - 0.5)*0.4; SPA[2] = m0; SPA[3] = Ts; SPA[4] = (rnd() - 0.5)*4; SPA[5] = -2 - 2*rnd();
        if(spawn(k) < 0) break;
        if(k === KH) INJ[2] -= m0; else INJ[1] -= m0; } }
  }
  else if(q.kind === "o2"){ const n = r*dt/O2_MMOL; if(r < 0 && -n > nO[i]) return;
    nO[i] += n; eA[i] += n*CV_O*(T_HULL - T0); L.inKg += n*O2_MMOL; }
  else if(q.kind === "gas"){ const m = nN[i]*MX_N + nO[i]*MX_O; if(!(m > 0)) return;
    const f = Math.min(0.5, Math.abs(r)*dt/m); L.inKg -= f*m; nN[i] *= 1 - f; nO[i] *= 1 - f; eA[i] *= 1 - f; }
}

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
// bubN: a bubble within gasPush()'s widest reach of the cell, rows then columns, so a particle deep in a body skips its search
function bubs(){
  const D = Math.ceil(Math.max(K.spr, 0.5*HTOP));
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let k = 0; for(let a=Math.max(0, x-D);a<=Math.min(W-1, x+D) && !k;a++) if(bub(y*W + a)) k = 1; bubX[y*W + x] = k; }
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let k = 0; for(let b=Math.max(0, y-D);b<=Math.min(H-1, y+D) && !k;b++) if(bubX[b*W + x]) k = 1; bubN[y*W + x] = k; }
}
const bodyAt = c => bd[c] >= 0 ? bd[c] : c >= W && bd[c-W] >= 0 ? bd[c-W] : c+W < N && bd[c+W] >= 0 ? bd[c+W] : c%W > 0 && bd[c-1] >= 0 ? bd[c-1] : c%W < W-1 && bd[c+1] >= 0 ? bd[c+1] : -1;
// a pocket pressing harder than the water beside it does work p dV on it, V less the share of each cell book() gives the particle: the push is
// the gradient of that share, so it has no step where a particle crosses a cell edge, and a sealed bell holds the water out
function gasPush(p, c){ const dts = DT[1];
  if(!bubN[c]) return; const b = bodyAt(c); if(b < 0) return;
  const x = px[p], y = py[p], R = Math.max(K.spr, 0.5*ph[p]), Rc = Math.ceil(R), cx = c%W, cy = (c/W)|0, gw = RHO_W*K.grav*G*MPC;
  let n = 0, sw = 0, sx = 0, sy = 0, hot = 0;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc) && !hot;gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++) if(bub(gy*W + gx)){ hot = 1; break; }
  if(!hot) return;
  hot = 0;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc);gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++){ const i = gy*W + gx;
    if(wall[i]) continue;
    const ex = gx + 0.5 - x, ey = gy + 0.5 - y, d = Math.sqrt(ex*ex + ey*ey); if(d >= R) continue;
    SEG[2] = gx + 0.5; SEG[3] = gy + 0.5; if(!seesC(c, i)) continue;
    const u = 1 - d/R, k = d > 1e-9 ? 2*u/(R*d) : 0;
    spC[n] = i; spW[n] = u*u; spX[n] = k*ex; spY[n] = k*ey; sw += u*u; sx += k*ex; sy += k*ey; n++;
    if(bub(i)) hot = 1; }
  if(!hot || !(sw > 0)) return;
  let ax = 0, ay = 0;
  for(let q=0;q<n;q++){ const i = spC[q]; if(!bub(i)) continue;
    const e = kP[pc[i]] - bRef[b] - gw*Math.max(0, ((i/W)|0) + 0.5 - bTop[b]); if(!(e > 0)) continue;
    ax -= e*(spX[q]*sw - spW[q]*sx)/(sw*sw); ay -= e*(spY[q]*sw - spW[q]*sy)/(sw*sw); }
  const a = Math.sqrt(ax*ax + ay*ay)/(RHO_W*MPC), s = a > 20*G ? 20*G/a : 1, f = s*dts/(RHO_W*MPC*MPC);
  vx[p] += ax*f; vy[p] += ay*f;
}
function forces(){ const dts = DT[1];
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(k === KW){ vy[p] += K.grav*G/MPC*dts; gasPush(p, c); continue; }
    // a parcel rises at about sqrt(g' r), g' its buoyancy as mixed so far: a diluted parcel slows
    let ub = 3;
    if(pc[c] >= 0){ const x = xOf(p), ta = kT[pc[c]];
      const gp = k === KH ? G*x*(1 - H2_MMOL/AIR_MMOL) : k === KV ? G*x*(1 - H2O_MMOL/AIR_MMOL*ta/pT[p]) : G*pd[p]/ta;
      ub = Math.min(4, Math.sqrt(Math.max(0, gp)*pr[p]*MPC)); }
    const f = Math.min(1, K.rise*dts);
    vx[p] += (jetX[c] - vx[p])*f + (rnd() - 0.5)*K.turb*dts;
    vy[p] += (jetY[c] - ub/MPC - vy[p])*f + (rnd() - 0.5)*K.turb*dts; }
}
// the columns of row gy particle p's reach can touch, one run of cP: widened 1e-6 against rounding, the board's edge rows and columns always in (cellAt() clamps past them)
const SPAN = new Int32Array(2);
function span(p, gy, cx, R){
  const x = px[p], y = py[p], hq = 0.5*(ph[p] + HM[0]), hq2 = hq*hq;
  const ey = gy === 0 || gy === H - 1 ? 0 : gy > y ? gy - y : y > gy + 1 ? y - (gy + 1) : 0;
  if(ey*ey >= hq2){ SPAN[0] = 1; SPAN[1] = 0; return; }
  const half = Math.sqrt(hq2 - ey*ey) + 1e-6, x0 = Math.max(0, cx-R), x1 = Math.min(W-1, cx+R);
  SPAN[0] = x0 === 0 ? 0 : Math.max(x0, Math.floor(x - half)); SPAN[1] = x1 === W-1 ? x1 : Math.min(x1, Math.floor(x + half));
}
// the water pairs within their kernel that see each other, each once (a < b): q = 1 - r/h, r, and g = q^2/h^2 for the density;
// a pair's kernel is the mean of its two, so it is the same seen from either end
function pairs(){
  const X = px, Y = py, PH = ph, KD = kind, S = cS, Q = cP, C = pcel, A = prA, B = prB, PQ = prQ, PR = prR, PG = prG, w = W, hm = HM[0], n = L.np, cap = A.length;
  let k = 0;
  for(let p=0;p<n;p++){ if(KD[p] !== KW) continue;
    const x = X[p], y = Y[p], hp = PH[p], c = cellOf(p), cx = c%w, cy = (c/w)|0, R = Math.ceil(0.5*(hp + hm));
    SEG[0] = x; SEG[1] = y;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++){ span(p, gy, cx, R); if(SPAN[0] > SPAN[1]) continue;
      for(let gi=S[gy*w + SPAN[0]], g1=S[gy*w + SPAN[1] + 1];gi<g1;gi++){ const j = Q[gi]; if(j <= p || KD[j] !== KW) continue;
        const dx = X[j] - x, dy = Y[j] - y, r2 = dx*dx + dy*dy, h = 0.5*(hp + PH[j]); if(r2 >= h*h) continue;
        SEG[2] = X[j]; SEG[3] = Y[j]; if(!seesC(c, C[j])) continue;
        if(k === cap){ L.pdrop++; continue; }
        const r = Math.sqrt(r2), q = 1 - r/h; A[k] = p; B[k] = j; PQ[k] = q; PR[k] = r; PG[k] = q*q/(h*h); k++; } } }
  L.npair = k;
}
// what a pair moves is split by mass, so momentum closes
function viscosity(){ const dts = DT[1];
  const X = px, Y = py, VX = vx, VY = vy, PM = pm, KD = kind, A = prA, B = prB, PQ = prQ, PR = prR, visc = K.visc, vb = K.vb, n = L.np;
  pairs();
  for(let k=0, m=L.npair;k<m;k++){ const r = PR[k]; if(r < 1e-6) continue; const p = A[k], j = B[k], mp = PM[p], mj = PM[j];
    // viscous stress follows the strain rate both ways: damped only as they close, particles rattled apart with nothing to stop them
    const ux = (X[j] - X[p])/r, uy = (Y[j] - Y[p])/r, u = (VX[p] - VX[j])*ux + (VY[p] - VY[j])*uy;
    const I = 0.5*dts*PQ[k]*(visc*u + vb*u*Math.abs(u)), s = 2/(mp + mj), ip = I*mj*s, ij = I*mp*s;
    VX[p] -= ip*ux; VY[p] -= ip*uy; VX[j] += ij*ux; VY[j] += ij*uy; }
  // the wall is water at rest that does not move: it drags on what moves against it as a neighbour would, or water rattles on a floor forever
  for(let p=0;p<n;p++){ if(KD[p] !== KW) continue;
    wallSum(p, cellOf(p), 0); const wn = Math.sqrt(WS[2]*WS[2] + WS[3]*WS[3]);
    if(wn > 0){ const ux = WS[2]/wn, uy = WS[3]/wn, u = VX[p]*ux + VY[p]*uy, k = Math.min(1, dts*wn*(visc + vb*Math.abs(u)));
      VX[p] -= k*u*ux; VY[p] -= k*u*uy; } }
}
function relax(){
  const X = px, Y = py, PM = pm, KD = kind, MX = mvx, MY = mvy, A = prA, B = prB, PQ = prQ, PR = prR, PG = prG, RH = rhoA, RN = rnA, PP = prP, PN = prN, n = L.np;
  const PW = pw, rho0 = RHO0, rn0 = RN0, pull = K.pull, stiff = K.stiff, near = K.near, wpull = K.wpull;
  pairs();
  const m = L.npair;
  for(let p=0;p<n;p++){ RH[p] = 0; RN[p] = 0; }
  for(let k=0;k<m;k++){ const p = A[k], j = B[k], g = PG[k], gq = g*PQ[k]; RH[p] += PW[j]*g; RN[p] += PW[j]*gq; RH[j] += PW[p]*g; RN[j] += PW[p]*gq; }
  for(let p=0;p<n;p++){ if(KD[p] !== KW) continue;
    // the wall is water at rest that does not move: it fills the kernel it cuts, and it takes none of the push
    wallSum(p, cellOf(p), 1); const rho = RH[p] + WS[0], rn = RN[p] + WS[1];
    // the pull keeps its own gain, so stiffness only sets how hard water resists squeezing
    // a push that never lets go, held by a pull, is a pair potential with a well at the lattice spacing: a crystal with a shear strength
    const P = (rho < rho0 ? pull : stiff)*(rho - rho0), Pn = near*Math.max(0, rn - rn0);
    // the gains are per substep in cells whatever the size, as at one particle a cell: scaled down with size, big water stood loose and never settled
    // the wall stands for lattice rows that never move, so it keeps the lattice's rest balance: with the pairs' push alone it is too stiff and feeds energy in
    const Pw = P - near*NC*rn, Pnw = near*rn;
    let sx = -(Pw*WS[2] + Pnw*WS[4]), sy = -(Pw*WS[3] + Pnw*WS[5]);
    // a wall a metre across does not pull water to it: tension drew a surface particle onto the face, and the face threw it back
    if(!wpull && sx*WS[2] + sy*WS[3] > 0){ sx = 0; sy = 0; }
    PP[p] = P; PN[p] = Pn; MX[p] += sx; MY[p] += sy; }
  // each end pushes the pair with its own pressure, so the pair takes the sum of the two
  for(let k=0;k<m;k++){ const r = PR[k]; if(r < 1e-6) continue; const p = A[k], j = B[k], q = PQ[k], mp = PM[p], mj = PM[j];
    const ux = (X[j] - X[p])/r, uy = (Y[j] - Y[p])/r, D = 0.5*((PP[p] + PP[j])*q + (PN[p] + PN[j])*q*q), s = 2/(mp + mj), dj = D*mp*s, dp = D*mj*s;
    MX[j] += dj*ux; MY[j] += dj*uy; MX[p] -= dp*ux; MY[p] -= dp*uy; }
  // every push reads the positions the pass began at: moved in place, the pool's result hung on the order its particles are stored in, and one wall rattled
  for(let p=0;p<n;p++){ X[p] += MX[p]; Y[p] += MY[p]; MX[p] = 0; MY[p] = 0; }
}
// parcels crowd apart to the room their mixture takes, so a layer under a ceiling thickens downward as more arrives
function repel(){
  const R = Math.ceil(2*RMAX);
  for(let p=0;p<L.np;p++){ if(kind[p] === KW) continue;
    const x = px[p], y = py[p], rp = pr[p], c = cellOf(p), cx = c%W, cy = (c/W)|0;
    SEG[0] = x; SEG[1] = y;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(j <= p || kind[j] === KW) continue;
        const dx = px[j] - x, dy = py[j] - y, d0 = rp + pr[j], r2 = dx*dx + dy*dy; if(r2 >= d0*d0 || r2 < 1e-12) continue;
        SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(c, cellOf(j))) continue;
        const r = Math.sqrt(r2), D = 0.5*K.crowd*(d0 - r); px[j] += D*dx/r; py[j] += D*dy/r; px[p] -= D*dx/r; py[p] -= D*dy/r; } }
}
// no particle moves more than K.dmax a substep, and it meets a wall one axis at a time, so it never tunnels
function collide(p){
  const xo = ox[p], yo = oy[p]; let dx = px[p] - xo, dy = py[p] - yo;
  const d = Math.sqrt(dx*dx + dy*dy); if(d > K.dmax){ dx *= K.dmax/d; dy *= K.dmax/d; }
  let x = xo + dx, y = yo + dy;
  if(solid(Math.floor(x), Math.floor(yo))){ const c = Math.floor(xo); x = dx > 0 ? c + 1 - EPS : c + EPS; }
  if(solid(Math.floor(x), Math.floor(y))){ const c = Math.floor(yo); y = dy > 0 ? c + 1 - EPS : c + EPS; }
  if(solid(Math.floor(x), Math.floor(y))){ x = xo; y = yo; }
  // a water particle has a size: its centre keeps an eighth of its kernel off a wall face, where the wall term would throw it back hard
  if(kind[p] === KW){ const sd = 0.125*ph[p], cx = Math.floor(x), cy = Math.floor(y);
    if(x - cx < sd && solid(cx - 1, Math.floor(y))) x = cx + sd; else if(x - cx > 1 - sd && solid(cx + 1, Math.floor(y))) x = cx + 1 - sd;
    if(y - cy < sd && solid(Math.floor(x), cy - 1)) y = cy + sd; else if(y - cy > 1 - sd && solid(Math.floor(x), cy + 1)) y = cy + 1 - sd; }
  px[p] = x; py[p] = y;
}
function sub(){ const dts = DT[1];
  derive(); forces();
  grid(); viscosity();
  for(let p=0;p<L.np;p++){ ox[p] = px[p]; oy[p] = py[p]; px[p] += vx[p]*dts; py[p] += vy[p]*dts; }
  grid(); relax(); repel();
  // not physics: a hard push between coarse particles turns straight into speed, and this hides the spike
  const lim = K.vcap/MPC;
  for(let p=0;p<L.np;p++){ collide(p); vx[p] = (px[p] - ox[p])/dts; vy[p] = (py[p] - oy[p])/dts;
    if(kind[p] === KW){ const s2 = vx[p]*vx[p] + vy[p]*vy[p]; if(s2 > lim*lim){ const k = lim/Math.sqrt(s2); vx[p] *= k; vy[p] *= k; } } }
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
function flamP(p){ const c = cellOf(p), k = pc[c]; return k >= 0 && kO[k] > 1e-6*(kN[k] + kO[k]); }
// dh of a parcel's hydrogen burns with the pocket's oxygen: the steam leaves with the heat its reactants carried, the heat of
// reaction goes straight into the air of the cell
function burnOff(p, c){ const dh = BOA[0];
  const k = pc[c], nh = dh/H2_MMOL, eo = nh/2*CV_O*(kT[k] - T0);
  pm[p] -= dh; kO[k] -= nh/2; nO[c] -= nh/2; eA[c] += dh*QH2 - eo; bq[c] += dh*QH2;
  PVA[0] = dh*(1 + O2_PER_H2); PVA[1] = T0 + (nh*CV_H*(pT[p] - T0) + eo)/(nh*CV_V); putV(c);
}
function hotAt(p){ const h = L.hot; if(h < 0) return false;
  const dx = px[p] - (h%W + 0.5), dy = py[p] - (((h/W)|0) + 0.5), d = pr[p] + 0.7;
  if(dx*dx + dy*dy > d*d) return false;
  SEG[0] = px[p]; SEG[1] = py[p]; SEG[2] = h%W + 0.5; SEG[3] = ((h/W)|0) + 0.5; return sees(cellOf(p), h, nearF) === 1; }
// phase()'s per-particle helpers take indices and hand back no float, so its loop boxes nothing whether they inline or not
function boil(p, c){ tsatA(c); const ts = TS[1];
  if(pT[p] > ts){ const dm = Math.min(pm[p], pm[p]*CW*(pT[p] - ts)/LV); pm[p] -= dm; pT[p] = ts; PVA[0] = dm; PVA[1] = ts; putV(c); }
  if(pm[p] < 0.05*MW0){ cond[c] += pm[p]; condE[c] += pm[p]*CW*(pT[p] - T0); kind[p] = 0; } }
// a gas parcel takes its pocket's temperature over about 2 s; what it gives up or takes goes to the air of its cell
function relaxT(p, c){ const dt = DT[0], cv = molOf(p)*(kind[p] === KH ? CV_H : CV_V); if(!(cv > 0)) return;
  const q = cv*(pT[p] - kT[pc[c]])*Math.min(1, dt/2); pT[p] -= q/cv; eA[c] += q; }
const lights = (p, c) => flamP(p) && (hotAt(p) || airT(c) >= H2_IGN);
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
function hydrogen(p, c){ const dt = DT[0];
  if(pc[c] >= 0) relaxT(p, c);
  if(!burn[p]){ if(lights(p, c)){ burn[p] = 1; age[p] = 0; } return; }
  if(!flamP(p)){ burn[p] = 0; return; }
  TS[5] = xOf(p); h2SlA(TS, 5, 6);
  const kk = pc[c], S = H2_TURB*Math.max(SL_MIN, TS[6])*Math.min(1, kO[kk]/((kN[kk] + kO[kk])*O2_FRAC0)), rm = pr[p]*MPC;
  const dh = Math.min(pm[p]*Math.min(1, dt*S/rm), Math.max(0, kO[kk])*2*H2_MMOL);
  BOA[0] = dh; burnOff(p, c);
  pq[p] = dh*rm/(dt*0.1*pv[p]*N0*H2_MMOL*H2_TURB*SL_MIN);
  age[p] += dt*S/rm;
  // a flame that has crossed its parcel lights the ones it touches
  if(age[p] >= 1){ const x = px[p], y = py[p], R = Math.ceil(2*RMAX + 0.5), cx = x|0, cy = y|0;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let gi=cS[gy*W+gx], g1=cS[gy*W+gx+1];gi<g1;gi++){ const j = cP[gi]; if(kind[j] !== KH || burn[j]) continue;
        SEG[0] = x; SEG[1] = y; SEG[2] = px[j]; SEG[3] = py[j]; if(!seesC(cellOf(p), cellOf(j))) continue;
        const dx = px[j] - x, dy = py[j] - y, d = pr[p] + pr[j] + 0.5; if(dx*dx + dy*dy > d*d) continue;
        if(flamP(j)){ burn[j] = 2; age[j] = 0; } } }
  if(age[p] >= BURN_OUT){ BOA[0] = Math.min(pm[p], Math.max(0, kO[kk])*2*H2_MMOL); burnOff(p, c); burn[p] = 0; pq[p] = 0; }
  if(!(pm[p] > 1e-9)){ BOA[0] = pm[p]; burnOff(p, c); kind[p] = 0; }
}
function phase(){ const dt = DT[0];
  bin(); grid();
  for(let p=0;p<L.np;p++) if(kind[p] !== KW){ const c = cellOf(p);
    pv[p] += dt*K.diff + 2*K.mix*Math.sqrt(pv[p])*Math.max(0, qy[p] - py[p] + jetY[c]*dt); }
  derive();
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(k === KW) boil(p, c);
    else if(k === KV) vapour(p, c);
    else if(k === KQ){ if(pd[p] < 2){ const to = pc[c] >= 0 ? c : colGasAbove(c); if(to >= 0){ eA[to] += pE[p]; kind[p] = 0; } } }
    else if(k === KH) hydrogen(p, c); }
  for(let p=0;p<L.np;p++) if(burn[p] === 2) burn[p] = 1;
  burnShove();
  sweep();
  // what boils, burns or condenses leaves in lots: a steam parcel, a drop of condensate
  for(let c=0;c<N;c++){ const x = c%W + 0.5, y = ((c/W)|0) + 0.5;
    if(vAcc[c] >= K.vmin){ SPA[0] = x + (rnd() - 0.5)*0.6; SPA[1] = y + (rnd() - 0.5)*0.6; SPA[2] = vAcc[c]; SPA[3] = vAT[c]; SPA[4] = (rnd() - 0.5)*2; SPA[5] = -2;
      if(spawn(KV) >= 0){ vAcc[c] = 0; vAT[c] = 0; } }
    if(cond[c] >= 0.1*MW0){ SPA[0] = x + (rnd() - 0.5)*0.6; SPA[1] = y + (rnd() - 0.5)*0.3; SPA[2] = cond[c]; SPA[3] = T0 + condE[c]/(cond[c]*CW); SPA[4] = 0; SPA[5] = 0;
      if(spawn(KW) >= 0){ cond[c] = 0; condE[c] = 0; } } }
}
// a long release is kept inside the pool: a parcel that has thinned out splits in two while there is room, and once the pool
// runs full, two parcels of a kind that overlap by half merge
function crowd(){
  const n = L.np;
  if(n < 0.6*MAXP) for(let p=0;p<n;p++){ const k = kind[p]; if(k === KW || burn[p] || pv[p] <= PVMAX) continue;
    const r = rOf(p); SPA[0] = px[p] + 0.3*r; SPA[1] = py[p]; SPA[2] = pm[p]/2; SPA[3] = pT[p]; SPA[4] = vx[p]; SPA[5] = vy[p];
    const q = spawn(k); if(q < 0) break;
    pm[p] /= 2; pE[p] /= 2; pE[q] = pE[p]; pv[p] /= 2; pv[q] = pv[p]; px[p] = Math.max(0, px[p] - 0.3*r); if(solid(Math.floor(px[p]), Math.floor(py[p]))) px[p] = ox[p]; }
  if(L.np < 0.7*MAXP) return;
  grid(); derive();
  for(let p=0;p<L.np;p++){ const k = kind[p]; if(k === KW || k === 0 || burn[p]) continue;
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
  qx.set(px); qy.set(py);
  for(let p=0;p<L.np;p++) sp0[p] = hyp(vx[p], vy[p]);
  for(let s=0;s<K.sub;s++) sub();
  hits();
  adapt();
  phase(); crowd(); bin(); pockets(1);
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
      const s = Math.min(1, 1.5/Math.max(r, 0.5)), u = (kind[p] === KW ? kPa*1000*0.01/(RHO_W*MPC) : Math.min(40, kPa/5))*s/MPC;
      vx[p] += u*dx/r; vy[p] += u*dy/r; sg[p] = 1; }
  for(let i=0;i<N;i++){ if(wall[i] || pc[i] !== k) continue; const d = hyp(i%W + 0.5 - cx, ((i/W)|0) + 0.5 - cy);
    pk[i] = Math.max(pk[i], kPa*Math.min(1, 1.5/Math.max(d, 1e-9))); }
}
// a game rule: a burning cell shoves once a tick like a charge of the pressure its heat builds in the 1.5-cell core before sound
// clears it
function burnShove(){ const dt = DT[0];
  for(let c=0;c<N;c++){ const q = bq[c]; if(!(q > 0)) continue; bq[c] = 0; if(pc[c] < 0) continue;
    const kPa = (GAM - 1)*q/dt*(1.5*MPC/340)/(Math.PI*2.25*Vc)/1000; if(kPa >= 0.5){ SHV[0] = kPa; shove(c); } }
}

// the charge's energy lands in the pocket as a pressure step; every particle near it is thrown out along the line from the charge
function blast(cell, kPa){
  if(cell < 0 || wall[cell]) return;
  const k = pc[cell], cx = cell%W + 0.5, cy = ((cell/W)|0) + 0.5;
  if(k >= 0){ const E = kPa*1000*kV[k]/(GAM - 1); for(let i=0;i<N;i++) if(pc[i] === k) eA[i] += E*vgOf(i)/kV[k]; }
  grid(); SHV[0] = kPa; shove(cell);
  // the charge's fireball fills the core the pressure step already takes at full strength, and lights what it touches there
  for(let p=0;p<L.np;p++){ if(kind[p] !== KH || burn[p]) continue; const dx = px[p] - cx, dy = py[p] - cy, d = 1.5 + rOf(p);
    if(dx*dx + dy*dy > d*d) continue;
    SEG[0] = cx; SEG[1] = cy; SEG[2] = px[p]; SEG[3] = py[p]; if(sees(cell, cellOf(p), null) && flamP(p)){ burn[p] = 1; age[p] = 0; } }
  bin(); pockets(0);
}

/* ---------- paint: fields splatted off the particles, water cut at a level so a pool reads as one surface ---------- */
const RG = 3;
let cvW = null, cvG = null, cvP = null, cxW, cxG, cxP, imW, imG, imP, mP, fW, fS, fT, fA, fB, fD, pW, gH, gV, gQ, gF, gS, gSv, SEGB;
const PV = new Float64Array(16), CX = new Float64Array(8);
// a particle paints only the room it stands in and the doorways out of it, so nothing shows through a wall
const VIS = new Uint8Array(1024), SPL = new Float64Array([0, 0, 0, 0, 0, 1, 1, 0]); // R, a, a2, a3, a4, stretch and its unit axis: a float passed to a call that is not inlined is boxed, once per particle per frame
function splat(f, res, p, f2, f3, f4){
  const x = rx[p], y = ry[p], R = SPL[0], a = SPL[1], a2 = SPL[2], a3 = SPL[3], a4 = SPL[4], st = SPL[5], ex = SPL[6], ey = SPL[7];
  const w = W*res, h = H*res, X = x*res, Y = y*res, Rp = R*res, R2 = Rp*Rp, Rb = Rp*st, c = cellAt(x|0, y|0), rg = room[c];
  const i0 = Math.max(0, Math.floor(X - Rb)), i1 = Math.min(w-1, Math.ceil(X + Rb)), j0 = Math.max(0, Math.floor(Y - Rb)), j1 = Math.min(h-1, Math.ceil(Y + Rb));
  // a particle paints only the cells it can see, one sight test per cell, not per pixel
  const gx0 = (i0/res)|0, gy0 = (j0/res)|0, gw = ((i1/res)|0) - gx0 + 1, gh = ((j1/res)|0) - gy0 + 1, vis = gw*gh <= VIS.length;
  if(vis){ SEG[0] = x; SEG[1] = y;
    for(let v=0;v<gh;v++) for(let u=0;u<gw;u++){ const i = (gy0 + v)*W + gx0 + u; SEG[2] = gx0 + u + 0.5; SEG[3] = gy0 + v + 0.5; VIS[v*gw + u] = wall[i] ? 0 : seesC(c, i); } }
  // cell by cell, so the room and sight tests run once a cell; each pixel still takes one add a particle, so the order is free
  for(let v=0;v<gh;v++){ const gy = gy0 + v, ja = Math.max(j0, gy*res), jb = Math.min(j1, gy*res + res - 1);
    for(let u=0;u<gw;u++){ const gx = gx0 + u, rp = room[gy*W + gx];
      if(rp === -1 || (rp !== rg && rp !== -2 && rg !== -2) || (vis && !VIS[v*gw + u])) continue;
      const ia = Math.max(i0, gx*res), ib = Math.min(i1, gx*res + res - 1);
      for(let j=ja;j<=jb;j++){ const dy = j + 0.5 - Y;
        for(let i=ia;i<=ib;i++){ const dx = i + 0.5 - X, da = (dx*ex + dy*ey)/st, dc = (dy*ex - dx*ey)*st, d2 = da*da + dc*dc; if(d2 >= R2) continue;
          const q = 1 - d2/R2, k = q*q, o = j*w + i; f[o] += k*a; if(f2){ f2[o] += k*a2; f3[o] += k*a3; } if(f4) f4[o] += k*a4; } } } }
}
// gS the glow's cover, fading in over the last GLOW_OFF m/s above its cut; gSv the cover times the speed share, for the colour
function glowSplat(p){ if(!sg[p]) return; const v = hyp(vx[p], vy[p])*MPC;
  SPL[1] = Math.min(1, Math.max(0, (v - GLOW_OFF)/GLOW_OFF)); SPL[2] = SPL[1]*Math.min(1, v/GLOW_FULL); SPL[3] = 0; splat(gS, RG, p, gSv, gSv); }
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a)/(b - a))); return t*t*(3 - 2*t); };
const OV = new Float64Array(4), DOTC = ["", "#5aa9d6", "#e8f4f6", "#a48ad6", "#f0a830"];
function over(r, g, b, a){ a = Math.min(0.95, a*K.gop); if(!(a > 0.004)) return;
  OV[0] = OV[0]*(1 - a) + r*a; OV[1] = OV[1]*(1 - a) + g*a; OV[2] = OV[2]*(1 - a) + b*a; OV[3] = OV[3] + a*(1 - OV[3]); }
// al: how far the wall clock is into the next tick; drawn between the tick's start and end, a 50 Hz sim moves on every frame
function paint(ctx, dots, al){
  if(!L.ready) return;
  if(!(al < 1)) al = 1;
  for(let p=0;p<L.np;p++){ rx[p] = al === 1 ? px[p] : qx[p] + (px[p] - qx[p])*al; ry[p] = al === 1 ? py[p] : qy[p] + (py[p] - qy[p])*al; }
  const RW = K.wpx;
  if(!cvW || cvW.width !== W*RW || cvW.height !== H*RW){
    cvW = document.createElement("canvas"); cvW.width = W*RW; cvW.height = H*RW; cxW = cvW.getContext("2d"); imW = cxW.createImageData(W*RW, H*RW);
    cvG = document.createElement("canvas"); cvG.width = W*RG; cvG.height = H*RG; cxG = cvG.getContext("2d"); imG = cxG.createImageData(W*RG, H*RG);
    fW = new Float32Array(W*RW*H*RW); fS = new Float32Array(fW.length); fT = new Float32Array(fW.length); fA = new Float32Array(fW.length); SEGB = new Float64Array(8*fW.length); fB = new Float32Array(fW.length); fD = new Float32Array(fW.length); pW = new Uint8Array(fW.length);
    gH = new Float32Array(W*RG*H*RG); gV = new Float32Array(gH.length); gQ = new Float32Array(gH.length); gF = new Float32Array(gH.length); gS = new Float32Array(gH.length); gSv = new Float32Array(gH.length); }
  fW.fill(0); fS.fill(0); fT.fill(0); fA.fill(0); gH.fill(0); gV.fill(0); gQ.fill(0); gF.fill(0); gS.fill(0); gSv.fill(0);
  const RWK = K.blob/Math.sqrt(K.ppc);
  derive();
  for(let p=0;p<L.np;p++){ const k = kind[p];
    if(k === KW){ const sp = 0.5*ph[p], m = pm[p]/MW0*S0*S0/(sp*sp); SPL[0] = K.blob*sp; SPL[1] = m; SPL[2] = m*Math.sqrt(vx[p]*vx[p] + vy[p]*vy[p])*MPC; SPL[3] = m*pT[p]; SPL[4] = m*pfo[p];
      // flying water is stretched along its path at the same area; only this splat sets the stretch, and hands it back at 1
      const sv = hyp(psx[p], psy[p]); SPL[5] = pst[p]; SPL[6] = sv > 0 ? psx[p]/sv : 1; SPL[7] = sv > 0 ? psy[p]/sv : 0;
      splat(fW, RW, p, fS, fT, fA);
      SPL[5] = 1; SPL[6] = 1; SPL[7] = 0;
      glowSplat(p);
      continue; }
    SPL[0] = pr[p] + K.gblur;
    glowSplat(p);
    if(k === KH){ SPL[1] = pf[p]; splat(gH, RG, p, null, null);
      if(burn[p]){ SPL[1] = pq[p]*(0.8 + 0.4*Math.sin(p*7.1 + L.t*40)); splat(gF, RG, p, null, null); } }
    else if(k === KV){ SPL[1] = pf[p]; splat(gV, RG, p, null, null); }
    else { SPL[1] = pd[p]; splat(gQ, RG, p, null, null); } }
  const th = K.merge*K.ppc*Math.PI*RWK*RWK/3, dW = imW.data, lo = 0.45*th, ww = W*RW, wh = H*RW;
  // speed and temperature per pixel off the raw field, before smoothing moves it
  for(let o=0;o<fW.length;o++){ const f = fW[o]; if(f > lo){ fS[o] /= f; fT[o] /= f; fA[o] /= f; } else { fS[o] = 0; fT[o] = 0; fA[o] = 0; } }
  for(let j=0;j<wh;j++){ const cy = ((j/RW)|0)*W; for(let i=0;i<ww;i++) pW[j*ww + i] = wall[cy + ((i/RW)|0)]; }
  // a lone particle's bump never reaches the cut, so each one also stands for a disk of its own water: th at its rim, 2 th at its centre;
  // a pixel only it covers takes its speed, temperature and air; a flying one is an ellipse of the same area stretched along its path
  for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue;
    const rd = Math.sqrt(pm[p]/(RHO_W*Vc)/Math.PI)*RW, R2 = 2*rd*rd, X = rx[p]*RW, Y = ry[p]*RW, sv = hyp(vx[p], vy[p]), sp = sv*MPC;
    const ss2 = hyp(psx[p], psy[p]), st = pst[p], ex = ss2 > 0 ? psx[p]/ss2 : 0, ey = ss2 > 0 ? psy[p]/ss2 : 1, ext = 1.415*rd*st;
    const i0 = Math.max(0, Math.floor(X - ext)), i1 = Math.min(ww-1, Math.ceil(X + ext)), j0 = Math.max(0, Math.floor(Y - ext)), j1 = Math.min(wh-1, Math.ceil(Y + ext));
    for(let j=j0;j<=j1;j++){ const dy = j + 0.5 - Y;
      for(let i=i0;i<=i1;i++){ const o = j*ww + i, dx = i + 0.5 - X, da = (dx*ex + dy*ey)/st, dc = (dy*ex - dx*ey)*st, d2 = da*da + dc*dc; if(d2 >= R2 || pW[o]) continue;
        const v = th*(2 - d2/(rd*rd)); if(!(v > fW[o])) continue;
        if(fT[o] === 0){ fS[o] = sp; fT[o] = pT[p]; fA[o] = pfo[p]; }
        fW[o] = v; } } }
  // 1-2-1 passes over open pixels only, so a wall never drags the edge off its face
  for(let s=0;s<K.wsmooth;s++){
    for(let o=0;o<fW.length;o++){ if(pW[o]){ fB[o] = 0; continue; } const i = o%ww; let v = 2*fW[o], w = 2;
      if(i > 0 && !pW[o-1]){ v += fW[o-1]; w++; } if(i < ww-1 && !pW[o+1]){ v += fW[o+1]; w++; } fB[o] = v/w; }
    for(let o=0;o<fW.length;o++){ if(pW[o]) continue; let v = 2*fB[o], w = 2;
      if(o >= ww && !pW[o-ww]){ v += fB[o-ww]; w++; } if(o + ww < fW.length && !pW[o+ww]){ v += fB[o+ww]; w++; } fW[o] = v/w; } }
  // water is kept off a wall, so the wall's first pixel takes its wet neighbour's field and the edge runs on under the wall paint
  for(let o=0;o<fW.length;o++){ if(!pW[o]) continue; const i = o%ww; let m = 0;
    if(i > 0 && !pW[o-1] && fW[o-1] > m) m = fW[o-1];
    if(i < ww-1 && !pW[o+1] && fW[o+1] > m) m = fW[o+1];
    if(o >= ww && !pW[o-ww] && fW[o-ww] > m) m = fW[o-ww];
    if(o + ww < fW.length && !pW[o+ww] && fW[o+ww] > m) m = fW[o+ww];
    fW[o] = m; }
  // pixels to the nearest open gas pixel (chamfer, two passes): white water is air mixed in, so it foams only near a free surface
  const BIG = 1e9;
  for(let o=0;o<fW.length;o++) fD[o] = !pW[o] && !(fW[o] > th) ? 0 : BIG;
  // a wall stays BIG and is skipped, so no depth is measured through it to gas in another room
  for(let o=0;o<fW.length;o++){ if(fD[o] === 0 || pW[o]) continue; const i = o%ww; let d = fD[o];
    if(i > 0 && fD[o-1] + 1 < d) d = fD[o-1] + 1;
    if(o >= ww){ if(fD[o-ww] + 1 < d) d = fD[o-ww] + 1;
      if(i > 0 && fD[o-ww-1] + 1.414 < d) d = fD[o-ww-1] + 1.414; if(i < ww-1 && fD[o-ww+1] + 1.414 < d) d = fD[o-ww+1] + 1.414; }
    fD[o] = d; }
  for(let o=fW.length-1;o>=0;o--){ if(fD[o] === 0 || pW[o]) continue; const i = o%ww; let d = fD[o];
    if(i < ww-1 && fD[o+1] + 1 < d) d = fD[o+1] + 1;
    if(o + ww < fW.length){ if(fD[o+ww] + 1 < d) d = fD[o+ww] + 1;
      if(i < ww-1 && fD[o+ww+1] + 1.414 < d) d = fD[o+ww+1] + 1.414; if(i > 0 && fD[o+ww-1] + 1.414 < d) d = fD[o+ww-1] + 1.414; }
    fD[o] = d; }
  const fdp = K.fdepth*RW, dkp = K.wdark*RW;
  // opaque everywhere: the traced edge is the only alpha, so a stretched pixel never fades it
  for(let o=0;o<fW.length;o++){ const q = o*4, hk = ss(300, 380, fT[o]), fo = Math.max(ss(0.2*K.foam, K.foam, fS[o])*(1 - ss(0, fdp, fD[o])), fA[o]);
    let r = 40 + (190 - 40)*hk, g = 110 + (225 - 110)*hk, b = 170 + (235 - 170)*hk;
    // light dies away exponentially below the surface (Beer-Lambert)
    if(dkp > 0){ const dk = 1 - Math.exp(-fD[o]/dkp); r += (8 - r)*dk; g += (32 - g)*dk; b += (64 - b)*dk; }
    r += (230 - r)*fo; g += (242 - g)*fo; b += (246 - b)*fo;
    dW[q] = r; dW[q+1] = g; dW[q+2] = b; dW[q+3] = 255; }
  cxW.putImageData(imW, 0, 0);
  const dG = imG.data;
  for(let o=0;o<gH.length;o++){
    if(gQ[o] === 0 && gV[o] === 0 && gH[o] === 0 && gS[o] === 0 && gF[o] === 0){ dG[o*4+3] = 0; continue; }
    OV[0] = 0; OV[1] = 0; OV[2] = 0; OV[3] = 0;
    over(240, 168, 48, Math.min(0.45, gQ[o]/150));
    over(232, 244, 246, Math.min(0.7, 1.5*gV[o]));
    const h = gH[o]; if(h > 0.002) over(130, 115, 224, Math.min(0.55, 1.4*h));
    const gc = gS[o]; if(gc > 0.004){ const s = gSv[o]/gc, t = s < 0.5 ? 2*s : 2*s - 1;
      if(s < 0.5) over(255*t, 90*t, 69*t, Math.min(0.7, gc)); else over(255, 90 + 80*t, 69 - 39*t, Math.min(0.7, gc)); }
    const fl = gF[o]; if(fl > 0.02){ over(255, 106, 30, Math.min(0.9, fl)); over(255, 210, 122, Math.min(0.8, Math.max(0, fl - 0.5))); }
    const q = o*4, A = OV[3]; if(!(A > 0)){ dG[q+3] = 0; continue; }
    dG[q] = OV[0]/A; dG[q+1] = OV[1]/A; dG[q+2] = OV[2]/A; dG[q+3] = 255*A; }
  cxG.putImageData(imG, 0, 0);
  const x0 = GX, y0 = rowTop(0), bw = W*CELL, bh = rowTop(H) - y0, sx = bw/ww, sy = bh/wh, ox0 = x0 + 0.5*sx, oy0 = y0 + 0.5*sy;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  // the wall paint is see-through, so the edge carried on under it is cut at the wall's face
  ctx.save(); ctx.beginPath();
  for(let Y=0;Y<H;Y++){ const ya = rowTop(Y), yh = rowTop(Y + 1) - ya;
    for(let X=0;X<W;){ if(wall[Y*W + X]){ X++; continue; } let e = X; while(e + 1 < W && !wall[Y*W + e + 1]) e++;
      ctx.rect(x0 + X*CELL, ya, (e + 1 - X)*CELL, yh); X = e + 1; } }
  ctx.clip();
  if(K.wpix > 0){ const n = K.wpix, pxw = W*n, pxh = H*n, k = RW/n;
    if(!cvP || cvP.width !== pxw || cvP.height !== pxh){
      cvP = document.createElement("canvas"); cvP.width = pxw; cvP.height = pxh; cxP = cvP.getContext("2d"); imP = cxP.createImageData(pxw, pxh); mP = new Uint8Array(pxw*pxh); }
    // the field read bilinearly at each block's centre, so the stair follows the traced edge
    for(let v=0;v<pxh;v++){ const fy = Math.min(wh - 1.001, Math.max(0, (v + 0.5)*k - 0.5)), j = fy|0, ty = fy - j;
      for(let u=0;u<pxw;u++){ const fx = Math.min(ww - 1.001, Math.max(0, (u + 0.5)*k - 0.5)), i = fx|0, tx = fx - i, o = j*ww + i;
        mP[v*pxw + u] = (fW[o]*(1 - tx) + fW[o+1]*tx)*(1 - ty) + (fW[o+ww]*(1 - tx) + fW[o+ww+1]*tx)*ty > th ? 1 : 0; } }
    const dP = imP.data, lit = Math.min(1, K.wline);
    for(let v=0;v<pxh;v++) for(let u=0;u<pxw;u++){ const b = v*pxw + u, q = b*4;
      if(!mP[b]){ dP[q+3] = 0; continue; }
      const c = ((((v + 0.5)*k)|0)*ww + (((u + 0.5)*k)|0))*4, top = v === 0 || !mP[b - pxw] ? lit : 0;
      dP[q] = dW[c] + (214 - dW[c])*top; dP[q+1] = dW[c+1] + (236 - dW[c+1])*top; dP[q+2] = dW[c+2] + (244 - dW[c+2])*top; dP[q+3] = 255; }
    cxP.putImageData(imP, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = K.wop; ctx.drawImage(cvP, x0, y0, bw, bh);
  } else {
  // marching squares on the pixel centres at the merge level: each square's inside polygon, all one clockwise path, so the fill has no seams
  ctx.beginPath(); let ns = 0;
  for(let j=0;j<wh-1;j++){ let run = -1;
    for(let i=0;i<ww-1;i++){ const o = j*ww + i, a = fW[o], b = fW[o+1], c = fW[o+ww+1], d = fW[o+ww];
      const ia = a > th, ib = b > th, ic = c > th, id = d > th;
      if(ia && ib && ic && id){ if(run < 0) run = i; continue; }
      if(run >= 0){ ctx.rect(ox0 + run*sx, oy0 + j*sy, (i - run)*sx, sy); run = -1; }
      if(!(ia || ib || ic || id)) continue;
      let n = 0, nc = 0, s0 = 0;
      if(ia){ PV[n++] = i; PV[n++] = j; }
      if(ia !== ib){ if(ia) s0 = nc; PV[n++] = CX[2*nc] = i + (th - a)/(b - a); PV[n++] = CX[2*nc+1] = j; nc++; }
      if(ib){ PV[n++] = i + 1; PV[n++] = j; }
      if(ib !== ic){ if(ib) s0 = nc; PV[n++] = CX[2*nc] = i + 1; PV[n++] = CX[2*nc+1] = j + (th - b)/(c - b); nc++; }
      if(ic){ PV[n++] = i + 1; PV[n++] = j + 1; }
      if(ic !== id){ if(ic) s0 = nc; PV[n++] = CX[2*nc] = i + 1 - (th - c)/(d - c); PV[n++] = CX[2*nc+1] = j + 1; nc++; }
      if(id){ PV[n++] = i; PV[n++] = j + 1; }
      if(id !== ia){ if(id) s0 = nc; PV[n++] = CX[2*nc] = i; PV[n++] = CX[2*nc+1] = j + 1 - (th - d)/(a - d); nc++; }
      ctx.moveTo(ox0 + PV[0]*sx, oy0 + PV[1]*sy);
      for(let m=2;m<n;m+=2) ctx.lineTo(ox0 + PV[m]*sx, oy0 + PV[m+1]*sy);
      ctx.closePath();
      // the surface runs from each crossing that leaves the water to the next one back into it
      for(let e=0;e<nc;e+=2){ const u = (s0 + e)%nc, v = (s0 + e + 1)%nc;
        SEGB[ns++] = CX[2*u]; SEGB[ns++] = CX[2*u+1]; SEGB[ns++] = CX[2*v]; SEGB[ns++] = CX[2*v+1]; } }
    if(run >= 0) ctx.rect(ox0 + run*sx, oy0 + j*sy, (ww - 1 - run)*sx, sy); }
  // filled with the colour bitmap as a pattern, not clipped to it, so a filter can feather the edge
  const pat = ctx.createPattern(cvW, "no-repeat"); pat.setTransform({a: sx, b: 0, c: 0, d: sy, e: x0, f: y0});
  ctx.save(); ctx.globalAlpha = K.wop; ctx.fillStyle = pat; if(K.wsoft > 0) ctx.filter = "blur(" + K.wsoft + "px)"; ctx.fill(); ctx.restore();
  if(K.wline > 0 && ns > 0){ ctx.beginPath();
    for(let s=0;s<ns;s+=4){ ctx.moveTo(ox0 + SEGB[s]*sx, oy0 + SEGB[s+1]*sy); ctx.lineTo(ox0 + SEGB[s+2]*sx, oy0 + SEGB[s+3]*sy); }
    ctx.lineWidth = K.wline/ctx.getTransform().a; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(214,236,244,0.8)"; ctx.stroke(); } }
  ctx.restore();
  // a drop fades over its last 0.4 s, never shrinks: under 2 screen pixels in radius a circle rasterises as a speck, so the floor is on
  // the mean size and each drop keeps its own share of it; drawn back along its path to this frame
  // bubbles as thin rings, wobbling as they rise; one pops by cell fill, so a ring is drawn only where the painted water is
  { const px1 = 1/ctx.getTransform().a, r0 = Math.max(0.07*CELL, 1.5*px1); ctx.beginPath();
    for(let i=0;i<MAXB;i++){ if(!(bT[i] > 0)) continue; const bx = bX[i] + 0.08*Math.sin(bP[i]), by = bY[i];
      const fi = Math.floor(bx*RW), fj = Math.floor(by*RW); if(fi < 0 || fj < 0 || fi >= ww || fj >= wh) continue;
      const o = fj*ww + fi; if(pW[o] || !(fW[o] > th)) continue;
      const x = x0 + bx*CELL, y = y0 + by*CELL, r = r0*bR[i];
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2*Math.PI); }
    ctx.globalAlpha = 0.7*K.wop; ctx.lineWidth = px1; ctx.strokeStyle = "#dcecf2"; ctx.stroke(); ctx.globalAlpha = 1; }
  if(K.spray > 0){ const back = DT[0]*(al - 1), r0 = Math.max(K.sdrop*CELL, 2/ctx.getTransform().a);
    ctx.fillStyle = "#dcecf2";
    for(let i=0;i<MAXS;i++){ if(!(sL[i] > 0)) continue; const x = x0 + (sX[i] + sU[i]*back)*CELL, y = y0 + (sY[i] + sV[i]*back)*CELL;
      ctx.globalAlpha = 0.9*K.wop*Math.min(1, sL[i]/0.4); const sv = Math.sqrt(sU[i]*sU[i] + sV[i]*sV[i]), st = Math.min(3, 1 + K.dstr*sv*MPC), r = r0*sR[i];
      ctx.beginPath(); ctx.ellipse(x, y, r*st, r/st, Math.atan2(sV[i], sU[i]), 0, 2*Math.PI); ctx.fill(); }
    ctx.globalAlpha = 1; }
  ctx.drawImage(cvG, x0, y0, bw, bh);
  if(dots){
    for(let p=0;p<L.np;p++){ ctx.globalAlpha = 0.9; ctx.fillStyle = burn[p] ? "#ffd27a" : DOTC[kind[p]];
      ctx.beginPath(); ctx.arc(x0 + rx[p]*CELL, y0 + ry[p]*CELL, CELL*(kind[p] === KW ? 0.09 : 0.06), 0, 6.283); ctx.fill(); } }
  ctx.restore();
}

const colGasAbove = i => { let k = i; while(k >= 0 && pc[k] < 0 && !wall[k]) k -= W; return k >= 0 && pc[k] >= 0 ? k : -1; };
const src = {
  name: "PARTICLES",
  ok: () => L.ready,
  paint,
  T: i => wall[i] ? NaN : pc[i] >= 0 ? airT(i) : bW[i] > 0 ? T0 + bWE[i]/(bW[i]*CW) : T_HULL,
  P: i => { if(wall[i]) return 0; if(pc[i] >= 0) return (kP[pc[i]] - P0)/1000;
    const k = colGasAbove(i); return k < 0 ? (pAt(i) - P0)/1000 : (kP[pc[k]] + RHO_W*G*(((i - k)/W)|0)*MPC - P0)/1000; },
  pk: i => pk[i],
  h2f: h2At,
  o2f: i => { const k = pc[i]; if(k < 0) return O2_FRAC0; const x = h2At(i);
    return kO[k]/Math.max(1e-9, kN[k] + kO[k])*(1 - Math.min(1, x)); },
  vap: i => bV[i],
  gas: i => nN[i]*MX_N + nO[i]*MX_O + bV[i] + bH[i],
  water: i => bW[i],
  waterT: i => bW[i] > 0 ? T0 + bWE[i]/(bW[i]*CW) : NaN,
  flame: i => bF[i] === 1,
  lump: i => wall[i] ? -1 : pc[i] >= 0 ? pc[i] : -2 - bd[i],
  door: i => isDoor[i] !== 0,
  info: i => { if(wall[i]) return "WALL"; const k = pc[i];
    return k >= 0 ? "GAS POCKET " + k + "  " + kV[k].toFixed(0) + " m3 of gas  " + (kT[k]).toFixed(0) + " K" : "UNDER WATER, body " + bd[i]; },
  tot: () => { const r = {gas:0, h2:0, o2:0, vap:0, wat:0, pool:0, pk:0, maxT:-1e9};
    for(let i=0;i<N;i++){ if(wall[i]) continue; r.gas += nN[i]*MX_N + nO[i]*MX_O + bV[i] + bH[i]; r.h2 += bH[i]; r.o2 += nO[i]*MX_O;
      r.vap += bV[i] + vAcc[i]; r.wat += bW[i] + cond[i]; }
    r.wat += INJ[0]; r.vap += INJ[1]; r.h2 += INJ[2];
    for(let k=0;k<L.npk;k++){ r.pk = Math.max(r.pk, (kP[k] - P0)/1000); r.maxT = Math.max(r.maxT, kT[k]); }
    return r; },
};

return { build, reset, step, blast, lay, src, L, K, KNOBS, _stage: {grid, viscosity, relax, wallSum, derive},
  inject: (kind, rate, cell) => { L.inj = {kind, rate, cell}; },
  off: () => { L.inj = null; },
  get np(){ return L.np; }, get px(){ return px; }, get py(){ return py; }, get vx(){ return vx; }, get vy(){ return vy; },
  get kind(){ return kind; }, get pm(){ return pm; }, get pv(){ return pv; }, get burn(){ return burn; },
  get fill(){ return fill; }, get pc(){ return pc; }, get kP(){ return kP; }, get pT(){ return pT; }, get lv(){ return lv; } };
})();
