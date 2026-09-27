"use strict";
/* Room contents as particles, a mockup set beside the cell grid in fluidbench. Water is coarse position-based SPH
   (Clavet, Beaudoin and Poulin 2005, double density relaxation); steam, hydrogen and heat are parcels that rise, draw in
   air as they go, crowd under a ceiling and ride the door jets. The air is lumped: one charge, temperature and pressure per
   gas pocket, cut at doors. The paint draws smooth fields off the particles, never a dot. Shares roomDoors, gridFlood and
   h2Sl with lumped.js. */
const PART = (() => {
const G = 9.81, T0 = 273.15, RU = 8.314462618, CW = 4190, LV = 2.257e6, RHO_W = 1000, GAM = 1.4, CP_AIR = 1005, QH2 = H2_LHV*1000;
const MX_O = O2_MMOL, MX_N = (AIR_MMOL - O2_FRAC0*O2_MMOL)/(1 - O2_FRAC0), CV_N = 20.8, CV_O = 21.1, CV_H = 20.4, CV_V = 25.3;
const KW = 1, KV = 2, KH = 3, KQ = 4;
const MAXP = 12000, DMAX = 0.45, EPS = 1e-3, VB = 0.3;
const VMIN = 0.2, QMIN = 2e5, FILL_GAS = 0.6, DOOR_MAX = 4, CD = 0.6, H_WALL = 5;
// water a metre across does not bead: the pull a particle short of neighbours gives is only what keeps coarse water from spraying.
// The gains are per substep; SUB is what they were tuned at, and it holds from 1 to 9 particles a cell where no other count does
const PULL = 0.15, SUB = 3;
const PVMAX = 9, RMAX = Math.sqrt(PVMAX/Math.PI);
// Coward and Jones (1952): a hydrogen-air flame travels up at 4.1 %, sideways at 6.0 %, down at 9.0 %
const LFL_SIDE = 0.06, LFL_DOWN = 0.09;
/* the knobs: [key, group, label, min, max, step, default, clears]; the ranges are the ones the water stays water across.
   mix: a rising thermal widens by a fraction of the height it climbs (Scorer 1957 has a quarter in 3D; a slab of cells
   dilutes faster, so the default is lower) */
const KNOBS = [
  ["ppc",   "WATER", "particles per cell",        2,    9,    1,     4,    true],
  ["stiff", "WATER", "stiffness",                 0.1,  0.5,  0.05,  0.3],
  ["near",  "WATER", "near push",                 0.1,  0.6,  0.05,  0.3],
  ["visc",  "WATER", "viscosity",                 0,    20,   1,     4],
  ["grav",  "WATER", "gravity x",                 0.75, 10,    0.25,  1],
  ["rise",  "GAS",   "buoyancy response 1/s",     0.5,  10,   0.5,   3],
  ["turb",  "GAS",   "turbulence",                0,    200,  10,    60],
  ["mix",   "GAS",   "mixing while rising",       0,    0.4,  0.025, 0.15],
  ["diff",  "GAS",   "diffusion cells2/s",        0,    0.2,  0.01,  0.02],
  ["crowd", "GAS",   "crowding",                  0,    0.05, 0.005, 0.01],
  ["cond",  "GAS",   "wall condensation 1/s",     0,    0.5,  0.025, 0.1],
  ["emit",  "GAS",   "puffs per second",          5,    60,   5,     25],
  ["blob",  "PAINT", "water blob size",           1.2,  2.4,  0.1,   1.8],
  ["merge", "PAINT", "water merge level",         0.15, 0.6,  0.05,  0.3],
  ["foam",  "PAINT", "foam at speed m/s",         1,    10,   0.5,   5],
  ["gblur", "PAINT", "gas blur cells",            0.3,  3,    0.1,   1.2],
  ["gop",   "PAINT", "gas opacity x",             0.25, 2,    0.25,  1],
];
const K = {}; for(const r of KNOBS) K[r[0]] = r[6];
const L = {ready:false, t:0, tick:0, inj:null, hot:-1, np:0, npk:0, nb:0, nj:0, blasts:[], inKg:0};
let W = 0, H = 0, N = 0, Vc = 0, Af = 0, P0 = 0, MW0 = 0, S0 = 1, HK0 = 1, HTOP = 1, hMax = 1, LMAX = 0, RHO0 = 0, NC = 0, N0 = 0, seed = 1, nRoom = 0;
let px, py, qx, qy, rx, ry, vx, vy, ox, oy, pm, pT, pE, pv, pr, pd, pf, ph, kind, burn, age, gHead, gNext;
let tagA, tagB, nearW, dist, que, TN, TO, WT0, WT1, WTX1, WTX2, spC, spW, nbJ, nbQ, nbR;
let wall, nWall, wall9, room, isDoor, fill, pc, bd, bRef, nN, nO, eA, cond, condE, vAcc, vAT, qAcc, pk, jetX, jetY, stack;
let bW, bWE, bV, bH, bHv, bQT, bF;
let kV, kN, kO, kE, kT, kP, kA, kQ, kS, kNP, kC, kPE;
let jCa, jCb, jAxis, jArea, jU, jC0, jCells;
let injW = 0, injV = 0, injH = 0, injQ = 0;

const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0)/4294967296; };
const solid = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[(y|0)*W + (x|0)] === 1;
const cellAt = (x, y) => Math.min(H-1, Math.max(0, y|0))*W + Math.min(W-1, Math.max(0, x|0));
const cellOf = p => cellAt(px[p], py[p]);
const gasC = i => !wall[i] && fill[i] < FILL_GAS;
const tsat = p => satT(SAT_WATER, Math.max(2e3, p)/1e6);
const psat = t => t < 647 ? satP(SAT_WATER, t)*1e6 : 1e12;
const open = j => gasC(j) && !isDoor[j], doorGas = j => gasC(j) && isDoor[j] !== 0, wet = j => !wall[j] && pc[j] < 0;
const vgOf = i => Vc*Math.max(0.05, 1 - Math.min(1, fill[i]));
const pAt = c => pc[c] >= 0 ? kP[pc[c]] : bd[c] >= 0 ? bRef[bd[c]] : P0;
const airT = c => pc[c] >= 0 ? kT[pc[c]] + bQT[c] : T_HULL;
const molOf = p => kind[p] === KH ? pm[p]/H2_MMOL : kind[p] === KV ? pm[p]/H2O_MMOL : 0;
const xOf = p => molOf(p)/(pv[p]*N0);
const rOf = p => Math.min(RMAX, Math.sqrt(pv[p]/Math.PI));
const dTOf = p => pE[p]/(1.2*CP_AIR*Vc*pv[p]);
// capped, so no pair or wall reaches past what nearW and the wall tags were cut for
const hOf = p => kind[p] === KW ? Math.min(HTOP, HK0*Math.sqrt(pm[p]/MW0)) : 0;
// a hot loop reads pr, pd, pf and ph, never rOf(), dTOf(), xOf() or hOf(): a float a call that is not inlined hands back is a fresh heap number
function derive(){ hMax = 0; for(let p=0;p<L.np;p++){ pr[p] = rOf(p); pd[p] = dTOf(p); pf[p] = xOf(p); ph[p] = hOf(p); if(ph[p] > hMax) hMax = ph[p]; } }

function build(){
  W = GW; H = GH; N = W*H; Vc = MPC*MPC*ROOM_DEPTH; Af = MPC*ROOM_DEPTH; P0 = ROOM_P0*1000;
  const F = k => new Float64Array(k), I = k => new Int32Array(k);
  px = F(MAXP); py = F(MAXP); qx = F(MAXP); qy = F(MAXP); rx = F(MAXP); ry = F(MAXP); vx = F(MAXP); vy = F(MAXP); ox = F(MAXP); oy = F(MAXP); pm = F(MAXP); pT = F(MAXP); pE = F(MAXP); pv = F(MAXP); pr = F(MAXP); pd = F(MAXP); pf = F(MAXP); ph = F(MAXP);
  kind = new Uint8Array(MAXP); burn = new Uint8Array(MAXP); age = F(MAXP); gHead = I(N); gNext = I(MAXP);
  wall = new Uint8Array(N); nWall = new Uint8Array(N); wall9 = new Uint8Array(N);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) wall[y*W+x] = matWall(x, y) ? 1 : 0;
  const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wall[y*W+x] === 1;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ nWall[y*W+x] = (isW(x-1, y) ? 1 : 0) + (isW(x+1, y) ? 1 : 0) + (isW(x, y-1) ? 1 : 0) + (isW(x, y+1) ? 1 : 0);
    let k = 0; for(let b=-1;b<=1;b++) for(let a=-1;a<=1;a++) if(isW(x+a, y+b)) k++; wall9[y*W+x] = k; }
  isDoor = roomDoors(W, H, isW, DOOR_MAX);
  room = new Int32Array(N).fill(-1); stack = new Int32Array(N);
  nRoom = 0;
  for(let i=0;i<N;i++) if(!wall[i] && !isDoor[i] && room[i] < 0) gridFlood(W, H, room, stack, i, nRoom++, j => !wall[j] && !isDoor[j]);
  for(let i=0;i<N;i++) if(isDoor[i]) room[i] = -2;
  tagA = I(N); tagB = I(N); nearW = new Uint8Array(N); dist = I(N); que = I(N); spC = I(1024); spW = F(1024); nbJ = I(MAXP); nbQ = F(MAXP); nbR = F(MAXP);
  fill = F(N); pc = I(N); bd = I(N); bRef = F(N); nN = F(N); nO = F(N); eA = F(N); cond = F(N); condE = F(N); vAcc = F(N); vAT = F(N); qAcc = F(N);
  pk = F(N); jetX = F(N); jetY = F(N);
  bW = F(N); bWE = F(N); bV = F(N); bH = F(N); bHv = F(N); bQT = F(N); bF = new Uint8Array(N);
  kV = F(N); kN = F(N); kO = F(N); kE = F(N); kT = F(N); kP = F(N); kA = F(N); kQ = F(N); kS = F(N); kNP = F(N); kC = F(N); kPE = F(N);
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
  S0 = 1/Math.sqrt(K.ppc); MW0 = RHO_W*Vc/K.ppc; HK0 = 2*S0; LMAX = 0; HTOP = HK0*Math.sqrt(1.6*Math.pow(2, LMAX)); hMax = HK0;
  // lq..: the lattice rows a flat wall stands in for, seen from the first row at rest; wq..: the same half-plane as a continuum
  let lq = 0, lq2 = 0, lq3 = 0, lq2u = 0, wq = 0, wq2 = 0, wq3 = 0, wq2u = 0, vq = 0, vq2 = 0; RHO0 = 0;
  for(let a=-6;a<=6;a++) for(let b=-6;b<=6;b++){ const r = Math.hypot(a, b)*S0; if(!(r > 0 && r < HK0)) continue; const q = 1 - r/HK0;
    RHO0 += q*q; if(b >= 1){ lq += q*b*S0/r; lq2 += q*q; lq3 += q*q*q; lq2u += q*q*b*S0/r; vq += b*q*b*S0/r; vq2 += b*q*q*b*S0/r; } }
  // the near push never lets go: a tension in step with it cancels its stress across a row line at RHO0, else water at rest stands loose
  NC = vq2/vq;
  const ds = S0/40;
  for(let y=S0/2 + ds/2;y<HK0;y+=ds) for(let x=-HK0 + ds/2;x<HK0;x+=ds){ const r = Math.hypot(x, y); if(r >= HK0) continue; const q = 1 - r/HK0, w = ds*ds/(S0*S0);
    wq += w*q*y/r; wq2 += w*q*q; wq3 += w*q*q*q; wq2u += w*q*q*y/r; }
  walls(Math.ceil(HTOP)); tables(LMAX + 2, lq/wq, lq2u/wq2u, lq2/wq2, lq3/wq3);
  L.np = 0; seed = 1; injW = 0; injV = 0; injH = 0; injQ = 0;
  cond.fill(0); condE.fill(0); vAcc.fill(0); vAT.fill(0); qAcc.fill(0); pk.fill(0); jetX.fill(0); jetY.fill(0); fill.fill(0); jU.fill(0);
  N0 = P0*Vc/(RU*T_HULL);
  for(let i=0;i<N;i++){ if(wall[i]){ nN[i] = 0; nO[i] = 0; eA[i] = 0; continue; }
    nN[i] = N0*(1 - O2_FRAC0); nO[i] = N0*O2_FRAC0; eA[i] = (nN[i]*CV_N + nO[i]*CV_O)*(T_HULL - T0); }
  L.t = 0; L.tick = 0; L.inj = null; L.hot = -1; L.blasts = []; L.inKg = 0; L.ready = true;
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
  for(let i=0;i<N;i++){ const x = i%W, y = (i/W)|0; nearW[i] = 0;
    for(let b=-D;b<=D && !nearW[i];b++) for(let a=-D;a<=D;a++){ const u = x + a, v = y + b; if(u >= 0 && v >= 0 && u < W && v < H && wall[v*W + u]){ nearW[i] = 1; break; } } }
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
// a pair or a spread sees along SEG, from a in cell ca to b in cell cb: the same room or a door, and no wall between when both are near one
const SEG = new Float64Array(4);
function sees(ca, cb){
  const ra = room[ca], rb = room[cb];
  if(ra !== rb && ra !== -2 && rb !== -2) return 0;
  if(!nearW[ca] || !nearW[cb] || ca === cb) return 1;
  const x = SEG[0], y = SEG[1], dx = SEG[2] - x, dy = SEG[3] - y, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  let cx = Math.floor(x), cy = Math.floor(y), n = Math.abs(Math.floor(SEG[2]) - cx) + Math.abs(Math.floor(SEG[3]) - cy);
  const tdx = dx !== 0 ? Math.abs(1/dx) : 1e30, tdy = dy !== 0 ? Math.abs(1/dy) : 1e30;
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx)*tdx : 1e30, ty = dy !== 0 ? (dy > 0 ? cy + 1 - y : y - cy)*tdy : 1e30;
  while(n-- > 0){
    // through a corner exactly: either side cell stops it
    if(Math.abs(tx - ty) < 1e-12 && (wall[cy*W + cx + sx] || wall[(cy + sy)*W + cx])) return 0;
    if(tx < ty){ tx += tdx; cx += sx; } else { ty += tdy; cy += sy; }
    if(wall[cy*W + cx]) return 0; }
  return 1;
}
// what the wall cells in reach add to a water particle: WS = density, near density, and the push per unit P and per unit Pn (x, y)
const WS = new Float64Array(6);
function wallSum(p, c){
  for(let k=0;k<6;k++) WS[k] = 0;
  if(!nearW[c]) return;
  const x = px[p], y = py[p], rg = room[c], R = Math.ceil(ph[p]), cx = c%W, cy = (c/W)|0, NL = TN.length;
  const lf = Math.max(0, Math.min(NL - 1, Math.log2(pm[p]/MW0))), l0 = Math.min(NL - 2, lf|0), t = lf - l0;
  for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++){ const i = gy*W + gx;
    if(!wall[i] || (rg !== -2 && tagA[i] !== rg && tagB[i] !== rg) || (rg === -2 && tagA[i] < 0)) continue;
    const dx = gx + 0.5 - x, dy = gy + 0.5 - y, ax = Math.abs(dx)*8, ay = Math.abs(dy)*8, ia = ax|0, ib = ay|0, fa = ax - ia, fb = ay - ib;
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    for(let l=l0;l<=l0+1;l++){ const n = TN[l]; if(ia + 1 >= n || ib + 1 >= n) continue;
      const wl = l === l0 ? 1 - t : t, o = TO[l], k = o + ib*n + ia, kt = o + ia*n + ib;
      const w00 = (1 - fa)*(1 - fb)*wl, w10 = fa*(1 - fb)*wl, w01 = (1 - fa)*fb*wl, w11 = fa*fb*wl;
      WS[0] += w00*WT0[k] + w10*WT0[k+1] + w01*WT0[k+n] + w11*WT0[k+n+1];
      WS[1] += w00*WT1[k] + w10*WT1[k+1] + w01*WT1[k+n] + w11*WT1[k+n+1];
      WS[2] += sx*(w00*WTX1[k] + w10*WTX1[k+1] + w01*WTX1[k+n] + w11*WTX1[k+n+1]);
      WS[4] += sx*(w00*WTX2[k] + w10*WTX2[k+1] + w01*WTX2[k+n] + w11*WTX2[k+n+1]);
      // the y integrals are the x ones with the offset transposed: fb runs along the row, fa down it
      WS[3] += sy*(w00*WTX1[kt] + w01*WTX1[kt+1] + w10*WTX1[kt+n] + w11*WTX1[kt+n+1]);
      WS[5] += sy*(w00*WTX2[kt] + w01*WTX2[kt+1] + w10*WTX2[kt+n] + w11*WTX2[kt+n+1]); } }
}

function spawn(k, x, y, m, T, u, v){
  if(L.np >= MAXP || solid(x, y)) return -1;
  const p = L.np++;
  kind[p] = k; px[p] = x; py[p] = y; qx[p] = x; qy[p] = y; ox[p] = x; oy[p] = y; vx[p] = u; vy[p] = v; pm[p] = m; pT[p] = T; pE[p] = 0; burn[p] = 0; age[p] = 0;
  ph[p] = hOf(p);
  pv[p] = k === KQ ? 1 : Math.max(0.05, molOf(p)/N0*T/T_HULL);
  return p;
}
function kill(p){ const q = --L.np; if(p === q) return;
  kind[p] = kind[q]; px[p] = px[q]; py[p] = py[q]; qx[p] = qx[q]; qy[p] = qy[q]; ox[p] = ox[q]; oy[p] = oy[q]; vx[p] = vx[q]; vy[p] = vy[q];
  pm[p] = pm[q]; pT[p] = pT[q]; pE[p] = pE[q]; pv[p] = pv[q]; ph[p] = ph[q]; burn[p] = burn[q]; age[p] = age[q]; }
function sweep(){ for(let p=L.np-1;p>=0;p--) if(kind[p] === 0) kill(p); }

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
  const x = px[p], y = py[p], R = Math.max(0.75, 0.5*hOf(p)), Rc = Math.ceil(R), cx = c%W, cy = (c/W)|0;
  let n = 0, sw = 0;
  SEG[0] = x; SEG[1] = y;
  for(let gy=Math.max(0, cy-Rc);gy<=Math.min(H-1, cy+Rc);gy++) for(let gx=Math.max(0, cx-Rc);gx<=Math.min(W-1, cx+Rc);gx++){ const i = gy*W + gx;
    if(wall[i]) continue;
    const d = Math.hypot(gx + 0.5 - x, gy + 0.5 - y); if(d >= R) continue;
    SEG[2] = gx + 0.5; SEG[3] = gy + 0.5; if(!sees(c, i)) continue;
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
function pockets(dt){ airOut(); const nk = label(); roofs(nk); sums(nk); settle(nk, dt); spread(); bodies(); }
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
  // only a roof holds air: a pocket with water over all of it is a gap between particles, and its air rises to the pocket over it
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0 || kA[k]) continue;
    let j = i - W; while(j >= 0 && !wall[j] && (pc[j] < 0 || !kA[pc[j]])) j -= W;
    if(j < 0 || wall[j]){ pc[i] = -1; continue; }
    nN[j] += nN[i]; nO[j] += nO[i]; eA[j] += eA[i]; nN[i] = 0; nO[i] = 0; eA[i] = 0; pc[i] = -1; }
}
function sums(nk){
  for(let k=0;k<nk;k++){ kV[k] = 0; kN[k] = 0; kO[k] = 0; kE[k] = 0; kA[k] = 0; kQ[k] = 0; kS[k] = 0; kNP[k] = 0; kC[k] = 0; kPE[k] = 0; }
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue;
    kV[k] += vgOf(i); kN[k] += nN[i]; kO[k] += nO[i]; kE[k] += eA[i]; kA[k] += 2*MPC*MPC + Af*nWall[i]; }
  for(let p=0;p<L.np;p++){ const k = pc[cellOf(p)], kd = kind[p]; if(k < 0 || kd === KW) continue;
    if(kd === KQ){ kQ[k] += pE[p]; continue; }
    const n = molOf(p), c = n*(kd === KH ? CV_H : CV_V); kS[k] += pv[p]; kNP[k] += n; kC[k] += c; kPE[k] += c*(pT[p] - T0); }
  // a mixture takes no more room than the pocket has: a pocket full of it is evenly mixed
  for(let p=0;p<L.np;p++){ const k = pc[cellOf(p)]; if(k < 0 || kind[p] === KW || kind[p] === KQ) continue;
    const cap = kV[k]/Vc; if(kS[k] > cap) pv[p] *= cap/kS[k]; }
}
function settle(nk, dt){
  for(let k=0;k<nk;k++){ if(!(kV[k] > 0)){ kV[k] = Vc; kT[k] = T_HULL; kP[k] = P0; continue; } state(k);
    if(dt > 0){ const d = kT[k] - T_HULL;
      kE[k] -= Math.sign(d)*Math.min(0.5*Math.abs(d)*cvOf(k), H_WALL*kA[k]*Math.abs(d)*dt); state(k); } }
  if(dt > 0) doors(dt);
}
function spread(){
  for(let i=0;i<N;i++){ const k = pc[i]; if(k < 0) continue; const s = vgOf(i)/kV[k];
    nN[i] = kN[k]*s; nO[i] = kO[k]*s; eA[i] = kE[k]*s;
    const g = (kP[k] - P0)/1000; if(g > pk[i]) pk[i] = g; }
}
function bodies(){
  bd.fill(-1); let nb = 0;
  for(let i=0;i<N;i++) if(bd[i] < 0 && wet(i)){ bRef[nb] = 1e30; gridFlood(W, H, bd, stack, i, nb++, wet); }
  L.nb = nb;
  for(let i=0;i<N;i++){ const b = bd[i]; if(b < 0) continue; const x = i%W;
    if(i >= W && pc[i-W] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i-W]]);
    if(i+W < N && pc[i+W] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i+W]]);
    if(x > 0 && pc[i-1] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i-1]]);
    if(x < W-1 && pc[i+1] >= 0) bRef[b] = Math.min(bRef[b], kP[pc[i+1]]); }
  for(let b=0;b<nb;b++) if(bRef[b] > 1e29) bRef[b] = P0;
}

// an orifice between two pockets, never past equal pressure; the donor pays the enthalpy it sends, so it cools as it empties
function doors(dt){
  jetX.fill(0); jetY.fill(0);
  for(let j=0;j<L.nj;j++){ const a = pc[jCa[j]], b = pc[jCb[j]]; jU[j] = 0;
    if(a < 0 || b < 0 || a === b) continue;
    const dp = kP[a] - kP[b], d = dp >= 0 ? a : b, r = d === a ? b : a, nd = kN[d] + kO[d];
    if(!(nd > 0) || !(Math.abs(dp) > 0)) continue;
    const mm = (kN[d]*MX_N + kO[d]*MX_O)/nd, rho = kP[d]*mm/(RU*kT[d]);
    const w = CD*jArea[j]*Math.sqrt(2*rho*Math.abs(dp)), eq = Math.abs(dp)/(RU*kT[d])*kV[a]*kV[b]/(kV[a] + kV[b]);
    const f = Math.min(w/mm*dt, 0.5*eq)/nd, qn = kN[d]*f, qo = kO[d]*f, qe = kE[d]*f + (qn + qo)*RU*kT[d];
    kN[d] -= qn; kO[d] -= qo; kE[d] -= qe; kN[r] += qn; kO[r] += qo; kE[r] += qe;
    const u = Math.min(50, f*nd*mm/dt/(rho*jArea[j]))/MPC*(d === a ? 1 : -1);
    jU[j] = u*MPC;
    for(let k=jC0[j];k<jC0[j+1];k++){ const i = jCells[k], o = jAxis[j] ? W : 1;
      for(let c=i-o;c<=i+o;c+=o) if(c >= 0 && c < N){ if(jAxis[j]) jetY[c] = u; else jetX[c] = u; } }
    state(a); state(b); }
}

function sources(dt){
  L.hot = -1;
  const q = L.inj; if(!q || q.cell < 0 || wall[q.cell]) return;
  const i = q.cell, r = q.rate, x = i%W + 0.5, y = ((i/W)|0) + 0.5;
  if(q.kind === "fluid"){
    if(r > 0){ injW += r*dt; L.inKg += r*dt;
      while(injW >= MW0 && spawn(KW, x + (rnd() - 0.5)*0.6, y + (rnd() - 0.5)*0.6, MW0, T_HULL, (rnd() - 0.5)*2, 2) >= 0) injW -= MW0; }
    else { let need = -r*dt;
      for(let p=L.np-1;p>=0 && need > 0;p--){ const dx = px[p] - x, dy = py[p] - y; if(kind[p] !== KW || dx*dx + dy*dy > 2.25) continue;
        const g = Math.min(pm[p], need); pm[p] -= g; need -= g; L.inKg -= g; if(pm[p] < 1e-9) kill(p); } }
  }
  else if(q.kind === "heat"){ const E = r*1000*dt;
    if(fill[i] >= 0.5){ let m = 0; for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) m += pm[p];
      if(m > 0){ for(let p=0;p<L.np;p++) if(kind[p] === KW && cellOf(p) === i) pT[p] = Math.max(274, pT[p] + E/(m*CW)); return; } }
    if(r > 0){ injQ += E; const e0 = r*1000/K.emit;
      while(injQ >= e0){ const p = spawn(KQ, x + (rnd() - 0.5)*0.4, y, 0, T_HULL, (rnd() - 0.5), -1); if(p < 0) break; pE[p] = e0; injQ -= e0; }
      if(airT(i) + r/(0.01*(2*Af + 2*MPC*MPC)) >= H2_IGN_SURF) L.hot = i; }
    else if(pc[i] >= 0){ const cv = nN[i]*CV_N + nO[i]*CV_O; eA[i] -= Math.min(-E, Math.max(0, eA[i] - cv*(150 - T0))); }
  }
  else if(q.kind === "h2" || q.kind === "steam"){
    const k = q.kind === "h2" ? KH : KV, Ts = k === KH ? T_HULL : 373.15, m0 = Math.abs(r)/K.emit;
    if(r > 0){ L.inKg += r*dt; if(k === KH) injH += r*dt; else injV += r*dt;
      while((k === KH ? injH : injV) >= m0){
        if(spawn(k, x + (rnd() - 0.5)*0.4, y + (rnd() - 0.5)*0.4, m0, Ts, (rnd() - 0.5)*4, -2 - 2*rnd()) < 0) break;
        if(k === KH) injH -= m0; else injV -= m0; } }
  }
  else if(q.kind === "o2"){ const n = r*dt/O2_MMOL; if(r < 0 && -n > nO[i]) return;
    nO[i] += n; eA[i] += n*CV_O*(T_HULL - T0); L.inKg += n*O2_MMOL; }
  else if(q.kind === "gas"){ const m = nN[i]*MX_N + nO[i]*MX_O; if(!(m > 0)) return;
    const f = Math.min(0.5, Math.abs(r)*dt/m); L.inKg -= f*m; nN[i] *= 1 - f; nO[i] *= 1 - f; eA[i] *= 1 - f; }
}

function grid(){
  gHead.fill(-1);
  for(let p=0;p<L.np;p++){ const c = cellOf(p); gNext[p] = gHead[c]; gHead[c] = p; }
}
function pushFrom(p, j, sx, sy, ref, dts){
  if(j < 0 || j >= N || pc[j] < 0) return;
  const d = kP[pc[j]] - ref; if(!(d > 0)) return;
  const a = Math.min(d/(RHO_W*MPC), 20*G)/MPC*dts; vx[p] -= sx*a; vy[p] -= sy*a;
}
function forces(dts){
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(k === KW){ vy[p] += K.grav*G/MPC*dts;
      // a pocket pressing harder than the lowest one on the same water pushes its face in: a sealed bell holds the water out
      const b = bd[c]; if(b < 0) continue; const x = c%W, ref = bRef[b];
      // one call site: four spend the inlining budget, and xOf() and rnd() below stay real calls that box what they return
      for(let f=0;f<4;f++){ const sx = f < 2 ? 0 : f === 2 ? -1 : 1, sy = f === 0 ? -1 : f === 1 ? 1 : 0;
        if((sx < 0 && x === 0) || (sx > 0 && x === W-1)) continue;
        pushFrom(p, c + sy*W + sx, sx, sy, ref, dts); }
      continue; }
    // a parcel rises at about sqrt(g' r), g' its buoyancy as mixed so far: a diluted parcel slows
    let ub = 3;
    if(pc[c] >= 0){ const x = xOf(p), ta = kT[pc[c]];
      const gp = k === KH ? G*x*(1 - H2_MMOL/AIR_MMOL) : k === KV ? G*x*(1 - H2O_MMOL/AIR_MMOL*ta/pT[p]) : G*pd[p]/ta;
      ub = Math.min(4, Math.sqrt(Math.max(0, gp)*pr[p]*MPC)); }
    const f = Math.min(1, K.rise*dts);
    vx[p] += (jetX[c] - vx[p])*f + (rnd() - 0.5)*K.turb*dts;
    vy[p] += (jetY[c] - ub/MPC - vy[p])*f + (rnd() - 0.5)*K.turb*dts; }
}
// a pair's kernel is the mean of its two, so it is the same seen from either end; what it moves is split by mass, so momentum closes
function viscosity(dts){
  for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue;
    const x = px[p], y = py[p], hp = ph[p], mp = pm[p], c = cellAt(x, y), cx = c%W, cy = (c/W)|0, R = Math.ceil(0.5*(hp + hMax));
    SEG[0] = x; SEG[1] = y;
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let j=gHead[gy*W+gx];j>=0;j=gNext[j]){ if(j <= p || kind[j] !== KW) continue;
        const dx = px[j] - x, dy = py[j] - y, r2 = dx*dx + dy*dy, h = 0.5*(hp + ph[j]); if(r2 >= h*h || r2 < 1e-12) continue;
        SEG[2] = px[j]; SEG[3] = py[j]; if(!sees(c, cellAt(px[j], py[j]))) continue;
        const r = Math.sqrt(r2), ux = dx/r, uy = dy/r, u = (vx[p] - vx[j])*ux + (vy[p] - vy[j])*uy; if(!(u > 0)) continue;
        const I = 0.5*dts*(1 - r/h)*(K.visc*u + VB*u*u), s = 2/(mp + pm[j]), ip = I*pm[j]*s, ij = I*mp*s;
        vx[p] -= ip*ux; vy[p] -= ip*uy; vx[j] += ij*ux; vy[j] += ij*uy; } }
}
function relax(){
  for(let p=0;p<L.np;p++){ if(kind[p] !== KW) continue;
    const x = px[p], y = py[p], hp = ph[p], mp = pm[p], c = cellAt(x, y), cx = c%W, cy = (c/W)|0, R = Math.ceil(0.5*(hp + hMax));
    const y0 = Math.max(0, cy-R), y1 = Math.min(H-1, cy+R), x0 = Math.max(0, cx-R), x1 = Math.min(W-1, cx+R);
    let rho = 0, rn = 0, nn = 0;
    SEG[0] = x; SEG[1] = y;
    for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++) for(let j=gHead[gy*W+gx];j>=0;j=gNext[j]){ if(j === p || kind[j] !== KW) continue;
      const dx = px[j] - x, dy = py[j] - y, r2 = dx*dx + dy*dy, h = 0.5*(hp + ph[j]); if(r2 >= h*h) continue;
      SEG[2] = px[j]; SEG[3] = py[j]; if(!sees(c, cellAt(px[j], py[j]))) continue;
      const r = Math.sqrt(r2), q = 1 - r/h, m = pm[j]/MW0*HK0*HK0/(h*h); rho += m*q*q; rn += m*q*q*q;
      if(r2 >= 1e-12){ nbJ[nn] = j; nbQ[nn] = q; nbR[nn] = r; nn++; } }
    // the wall is water at rest that does not move: it fills the kernel it cuts, and it takes none of the push
    wallSum(p, c); rho += WS[0]; rn += WS[1];
    // the pull keeps its own gain, so stiffness only sets how hard water resists squeezing
    const P = (rho < RHO0 ? PULL : K.stiff)*(rho - RHO0) - K.near*NC*rn, Pn = K.near*rn;
    let sx = -(P*WS[2] + Pn*WS[4]), sy = -(P*WS[3] + Pn*WS[5]);
    // a wall a metre across does not pull water to it: tension drew a surface particle onto the face, and the face threw it back
    if(sx*WS[2] + sy*WS[3] > 0){ sx = 0; sy = 0; }
    for(let k=0;k<nn;k++){ const j = nbJ[k], r = nbR[k], q = nbQ[k], ux = (px[j] - x)/r, uy = (py[j] - y)/r;
      const D = 0.5*(P*q + Pn*q*q), s = 2/(mp + pm[j]), dj = D*mp*s, dp = D*pm[j]*s;
      px[j] += dj*ux; py[j] += dj*uy; sx -= dp*ux; sy -= dp*uy; }
    px[p] += sx; py[p] += sy; }
}
// parcels crowd apart to the room their mixture takes, so a layer under a ceiling thickens downward as more arrives
function repel(){
  const R = Math.ceil(2*RMAX);
  for(let p=0;p<L.np;p++){ if(kind[p] === KW) continue;
    const x = px[p], y = py[p], rp = pr[p], cx = Math.min(W-1, Math.max(0, x|0)), cy = Math.min(H-1, Math.max(0, y|0));
    for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
      for(let j=gHead[gy*W+gx];j>=0;j=gNext[j]){ if(j <= p || kind[j] === KW) continue;
        const dx = px[j] - x, dy = py[j] - y, d0 = rp + pr[j], r2 = dx*dx + dy*dy; if(r2 >= d0*d0 || r2 < 1e-12) continue;
        const r = Math.sqrt(r2), D = 0.5*K.crowd*(d0 - r); px[j] += D*dx/r; py[j] += D*dy/r; px[p] -= D*dx/r; py[p] -= D*dy/r; } }
}
// no particle moves more than DMAX a substep, and it meets a wall one axis at a time, so it never tunnels
function collide(p){
  const xo = ox[p], yo = oy[p]; let dx = px[p] - xo, dy = py[p] - yo;
  const d = Math.sqrt(dx*dx + dy*dy); if(d > DMAX){ dx *= DMAX/d; dy *= DMAX/d; }
  let x = xo + dx, y = yo + dy;
  if(solid(x, yo)){ const c = Math.floor(xo); x = dx > 0 ? c + 1 - EPS : c + EPS; }
  if(solid(x, y)){ const c = Math.floor(yo); y = dy > 0 ? c + 1 - EPS : c + EPS; }
  if(solid(x, y)){ x = xo; y = yo; }
  px[p] = x; py[p] = y;
}
function sub(dts){
  derive(); forces(dts);
  grid(); viscosity(dts);
  for(let p=0;p<L.np;p++){ ox[p] = px[p]; oy[p] = py[p]; px[p] += vx[p]*dts; py[p] += vy[p]*dts; }
  grid(); relax(); repel();
  for(let p=0;p<L.np;p++){ collide(p); vx[p] = (px[p] - ox[p])/dts; vy[p] = (py[p] - oy[p])/dts; }
}

function putV(c, m, T){ if(!(m > 0)) return; vAT[c] = (vAT[c]*vAcc[c] + m*T)/(vAcc[c] + m); vAcc[c] += m; }
function flamP(p, lim){ const c = cellOf(p), k = pc[c]; if(k < 0) return false;
  const x = xOf(p), fo = kO[k]/Math.max(1e-9, kN[k] + kO[k]);
  return x >= lim && x <= H2_UFL && fo*(1 - x) >= O2_LOC; }
// dh of a parcel's hydrogen burns with the pocket's oxygen: the steam leaves with the heat its reactants carried, the heat of
// reaction goes to a hot-gas parcel
function burnOff(p, c, dh){
  const k = pc[c], nh = dh/H2_MMOL, eo = nh/2*CV_O*(kT[k] - T0);
  pm[p] -= dh; kO[k] -= nh/2; nO[c] -= nh/2; eA[c] -= eo; qAcc[c] += dh*QH2;
  putV(c, dh*(1 + O2_PER_H2), T0 + (nh*CV_H*(pT[p] - T0) + eo)/(nh*CV_V));
}
function hotAt(p){ const h = L.hot; if(h < 0) return false;
  const dx = px[p] - (h%W + 0.5), dy = py[p] - (((h/W)|0) + 0.5), d = pr[p] + 0.7;
  return dx*dx + dy*dy <= d*d; }
// phase()'s per-particle helpers take indices and hand back no float, so its loop boxes nothing whether they inline or not
function boil(p, c){ const ts = tsat(pAt(c));
  if(pT[p] > ts){ const dm = Math.min(pm[p], pm[p]*CW*(pT[p] - ts)/LV); pm[p] -= dm; pT[p] = ts; putV(c, dm, ts); }
  if(pm[p] < 0.05*MW0){ cond[c] += pm[p]; condE[c] += pm[p]*CW*(pT[p] - T0); kind[p] = 0; } }
const lights = (p, c) => flamP(p, H2_LFL) && (hotAt(p) || airT(c) >= H2_IGN);
function phase(dt){
  bin(); grid();
  for(let p=0;p<L.np;p++) if(kind[p] !== KW && kind[p] !== KQ){ const c = cellOf(p);
    pv[p] += dt*K.diff + 2*K.mix*Math.sqrt(pv[p])*Math.max(0, qy[p] - py[p] + jetY[c]*dt); }
  derive();
  for(let p=0;p<L.np;p++){ const k = kind[p], c = cellOf(p);
    if(k === KW){ boil(p, c); continue; }
    if(k === KV){ const g = pc[c] >= 0;
      // steam meets a cold wall or water and condenses there; the latent heat leaves through the wall and the condensate drips
      const rate = !g ? 3 : K.cond*wall9[c];
      if(rate > 0){ const dm = pm[p]*(1 - Math.exp(-rate*dt)); pm[p] -= dm; cond[c] += dm; condE[c] += dm*CW*(T_HULL - T0); }
      if(g){ const cv = pm[p]/H2O_MMOL*CV_V, q = cv*(pT[p] - kT[pc[c]])*Math.min(1, dt/2); pT[p] -= q/cv; eA[c] += q;
        // steam mixed into cooler air past saturation is fog: it rains out and its latent heat warms the air
        const xs = psat(pT[p])/kP[pc[c]], x = xOf(p);
        if(x > xs){ const dm = Math.min(pm[p], (x - xs)*pv[p]*N0*H2O_MMOL*Math.min(1, dt)); pm[p] -= dm; cond[c] += dm; condE[c] += dm*CW*(pT[p] - T0); eA[c] += dm*LV; } }
      if(pm[p] < 1e-4){ cond[c] += pm[p]; condE[c] += pm[p]*CW*(T_HULL - T0); kind[p] = 0; } }
    else if(k === KQ){ if(pd[p] < 2){ const to = pc[c] >= 0 ? c : colGasAbove(c); if(to >= 0){ eA[to] += pE[p]; kind[p] = 0; } } }
    else if(k === KH){
      if(!burn[p]){ if(lights(p, c)){ burn[p] = 1; age[p] = 0; } continue; }
      if(!flamP(p, H2_LFL)){ burn[p] = 0; continue; }
      const kk = pc[c], S = H2_TURB*h2Sl(xOf(p)), rm = pr[p]*MPC;
      const dh = Math.min(pm[p]*Math.min(1, dt*S/rm), Math.max(0, kO[kk])*2*H2_MMOL);
      burnOff(p, c, dh);
      age[p] += dt*S/rm;
      // a flame that has crossed its parcel lights the flammable ones it touches: easiest upward, hardest down
      if(age[p] >= 1){ const x = px[p], y = py[p], R = Math.ceil(2*RMAX + 0.5), cx = x|0, cy = y|0;
        for(let gy=Math.max(0, cy-R);gy<=Math.min(H-1, cy+R);gy++) for(let gx=Math.max(0, cx-R);gx<=Math.min(W-1, cx+R);gx++)
          for(let j=gHead[gy*W+gx];j>=0;j=gNext[j]){ if(kind[j] !== KH || burn[j]) continue;
            const dx = px[j] - x, dy = py[j] - y, d = pr[p] + pr[j] + 0.5; if(dx*dx + dy*dy > d*d) continue;
            if(flamP(j, dy < -0.3 ? H2_LFL : dy > 0.3 ? LFL_DOWN : LFL_SIDE)){ burn[j] = 2; age[j] = 0; } } }
      if(!(pm[p] > 1e-9)){ burnOff(p, c, pm[p]); kind[p] = 0; } } }
  for(let p=0;p<L.np;p++) if(burn[p] === 2) burn[p] = 1;
  sweep();
  // what boils, burns or condenses leaves in lots: a steam parcel, a hot-gas parcel, a drop of condensate
  for(let c=0;c<N;c++){ const x = c%W + 0.5, y = ((c/W)|0) + 0.5;
    if(vAcc[c] >= VMIN && spawn(KV, x + (rnd() - 0.5)*0.6, y + (rnd() - 0.5)*0.6, vAcc[c], vAT[c], (rnd() - 0.5)*2, -2) >= 0){ vAcc[c] = 0; vAT[c] = 0; }
    if(qAcc[c] >= QMIN){ const p = spawn(KQ, x + (rnd() - 0.5)*0.6, y + (rnd() - 0.5)*0.6, 0, T_HULL, (rnd() - 0.5)*2, -2); if(p >= 0){ pE[p] = qAcc[c]; qAcc[c] = 0; } }
    if(cond[c] >= 0.1*MW0 && spawn(KW, x + (rnd() - 0.5)*0.6, y + (rnd() - 0.5)*0.3, cond[c], T0 + condE[c]/(cond[c]*CW), 0, 0) >= 0){ cond[c] = 0; condE[c] = 0; } }
}
// a long release is kept inside the pool: a parcel that has thinned out splits in two while there is room, and once the pool
// runs full, two parcels of a kind that overlap by half merge
function crowd(){
  const n = L.np;
  if(n < 0.6*MAXP) for(let p=0;p<n;p++){ const k = kind[p]; if(k === KW || burn[p] || pv[p] <= PVMAX) continue;
    const r = rOf(p), q = spawn(k, px[p] + 0.3*r, py[p], pm[p]/2, pT[p], vx[p], vy[p]); if(q < 0) break;
    pm[p] /= 2; pE[p] /= 2; pE[q] = pE[p]; pv[p] /= 2; pv[q] = pv[p]; px[p] = Math.max(0, px[p] - 0.3*r); if(solid(px[p], py[p])) px[p] = ox[p]; }
  if(L.np < 0.7*MAXP) return;
  grid(); derive();
  for(let p=0;p<L.np;p++){ const k = kind[p]; if(k === KW || k === 0 || burn[p]) continue;
    for(let j=gHead[cellOf(p)];j>=0;j=gNext[j]){ if(j === p || kind[j] !== k || burn[j]) continue;
      const dx = px[j] - px[p], dy = py[j] - py[p], d = 0.5*(pr[p] + pr[j]); if(dx*dx + dy*dy > d*d) continue;
      const a = k === KQ ? pE[j] : pm[j], b = k === KQ ? pE[p] : pm[p], s = a + b; if(!(s > 0)) continue;
      px[j] = (px[j]*a + px[p]*b)/s; py[j] = (py[j]*a + py[p]*b)/s; vx[j] = (vx[j]*a + vx[p]*b)/s; vy[j] = (vy[j]*a + vy[p]*b)/s;
      pT[j] = (pT[j]*a + pT[p]*b)/s; pv[j] += pv[p]; pr[j] = rOf(j); if(k === KQ) pE[j] = s; else pm[j] = s;
      kind[p] = 0; break; } }
  sweep();
}

function step(dt){
  if(!L.ready) return;
  sources(dt);
  qx.set(px); qy.set(py);
  for(let s=0;s<SUB;s++) sub(dt/SUB);
  phase(dt); crowd(); bin(); pockets(dt);
  L.t += dt; L.tick++;
}

// the charge's energy lands in the pocket as a pressure step; every particle near it is thrown out along the line from the charge
function blast(cell, kPa){
  if(cell < 0 || wall[cell]) return;
  const k = pc[cell], cx = cell%W + 0.5, cy = ((cell/W)|0) + 0.5;
  if(k >= 0){ const E = kPa*1000*kV[k]/(GAM - 1); for(let i=0;i<N;i++) if(pc[i] === k) eA[i] += E*vgOf(i)/kV[k]; }
  for(let p=0;p<L.np;p++){ const dx = px[p] - cx, dy = py[p] - cy, r = Math.hypot(dx, dy); if(r > 12 || r < 1e-6) continue;
    const s = Math.min(1, 1.5/Math.max(r, 0.5)), u = (kind[p] === KW ? kPa*1000*0.01/(RHO_W*MPC) : Math.min(40, kPa/5))*s/MPC;
    vx[p] += u*dx/r; vy[p] += u*dy/r; }
  for(let i=0;i<N;i++){ if(wall[i] || pc[i] !== k) continue; const d = Math.hypot(i%W + 0.5 - cx, ((i/W)|0) + 0.5 - cy);
    pk[i] = Math.max(pk[i], kPa*Math.min(1, 1.5/Math.max(d, 1e-9))); }
  bin(); pockets(0);
  L.blasts.push({cell, t:L.t, k}); if(L.blasts.length > 8) L.blasts.shift();
}

/* ---------- paint: fields splatted off the particles, water cut at a level so a pool reads as one surface ---------- */
const RW = 6, RG = 3;
let cvW = null, cvG = null, cxW, cxG, imW, imG, fW, fS, fT, gH, gV, gQ, gF;
// a particle paints only the room it stands in and the doorways out of it, so nothing shows through a wall
const SPL = new Float64Array(4); // R, a, a2, a3: a float passed to a call that is not inlined is boxed, once per particle per frame
function splat(f, res, p, f2, f3){
  const x = rx[p], y = ry[p], R = SPL[0], a = SPL[1], a2 = SPL[2], a3 = SPL[3];
  const w = W*res, h = H*res, X = x*res, Y = y*res, Rp = R*res, R2 = Rp*Rp, rg = room[cellAt(x, y)];
  const i0 = Math.max(0, Math.floor(X - Rp)), i1 = Math.min(w-1, Math.ceil(X + Rp)), j0 = Math.max(0, Math.floor(Y - Rp)), j1 = Math.min(h-1, Math.ceil(Y + Rp));
  for(let j=j0;j<=j1;j++){ const dy = j + 0.5 - Y, row = ((j/res)|0)*W;
    for(let i=i0;i<=i1;i++){ const dx = i + 0.5 - X, d2 = dx*dx + dy*dy, rp = room[row + ((i/res)|0)];
      if(d2 >= R2 || rp === -1 || (rp !== rg && rp !== -2 && rg !== -2)) continue;
      const q = 1 - d2/R2, k = q*q, o = j*w + i; f[o] += k*a; if(f2){ f2[o] += k*a2; f3[o] += k*a3; } } }
}
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a)/(b - a))); return t*t*(3 - 2*t); };
const OV = new Float64Array(4), DOTC = ["", "#5aa9d6", "#e8f4f6", "#a48ad6", "#f0a830"];
function over(r, g, b, a){ a = Math.min(0.95, a*K.gop); if(!(a > 0.004)) return;
  OV[0] = OV[0]*(1 - a) + r*a; OV[1] = OV[1]*(1 - a) + g*a; OV[2] = OV[2]*(1 - a) + b*a; OV[3] = OV[3] + a*(1 - OV[3]); }
// al: how far the wall clock is into the next tick; drawn between the tick's start and end, a 50 Hz sim moves on every frame
function paint(ctx, dots, al){
  if(!L.ready) return;
  if(!(al < 1)) al = 1;
  for(let p=0;p<L.np;p++){ rx[p] = al === 1 ? px[p] : qx[p] + (px[p] - qx[p])*al; ry[p] = al === 1 ? py[p] : qy[p] + (py[p] - qy[p])*al; }
  if(!cvW || cvW.width !== W*RW || cvW.height !== H*RW){
    cvW = document.createElement("canvas"); cvW.width = W*RW; cvW.height = H*RW; cxW = cvW.getContext("2d"); imW = cxW.createImageData(W*RW, H*RW);
    cvG = document.createElement("canvas"); cvG.width = W*RG; cvG.height = H*RG; cxG = cvG.getContext("2d"); imG = cxG.createImageData(W*RG, H*RG);
    fW = new Float32Array(W*RW*H*RW); fS = new Float32Array(fW.length); fT = new Float32Array(fW.length);
    gH = new Float32Array(W*RG*H*RG); gV = new Float32Array(gH.length); gQ = new Float32Array(gH.length); gF = new Float32Array(gH.length); }
  fW.fill(0); fS.fill(0); fT.fill(0); gH.fill(0); gV.fill(0); gQ.fill(0); gF.fill(0);
  const RWK = K.blob/Math.sqrt(K.ppc);
  derive();
  for(let p=0;p<L.np;p++){ const k = kind[p];
    if(k === KW){ const m = pm[p]/MW0; SPL[0] = RWK; SPL[1] = m; SPL[2] = m*Math.sqrt(vx[p]*vx[p] + vy[p]*vy[p])*MPC; SPL[3] = m*pT[p];
      splat(fW, RW, p, fS, fT); continue; }
    SPL[0] = pr[p] + K.gblur;
    if(k === KH){ SPL[1] = pf[p]; splat(gH, RG, p, null, null);
      if(burn[p]){ SPL[1] = 0.8 + 0.4*Math.sin(p*7.1 + L.t*40); splat(gF, RG, p, null, null); } }
    else if(k === KV){ SPL[1] = pf[p]; splat(gV, RG, p, null, null); }
    else { SPL[1] = pd[p]; splat(gQ, RG, p, null, null); } }
  const th = K.merge*K.ppc*Math.PI*RWK*RWK/3, dW = imW.data;
  for(let o=0;o<fW.length;o++){ const f = fW[o], a = ss(0.45*th, 1.1*th, f), q = o*4;
    if(!(a > 0)){ dW[q+3] = 0; continue; }
    const sp = fS[o]/f, hk = ss(300, 380, fT[o]/f), rim = a*(1 - ss(1.1*th, 2.4*th, f)), fo = Math.max(ss(0.2*K.foam, K.foam, sp), 0.55*rim);
    let r = 40 + (190 - 40)*hk, g = 110 + (225 - 110)*hk, b = 170 + (235 - 170)*hk;
    r += (230 - r)*fo; g += (242 - g)*fo; b += (246 - b)*fo;
    dW[q] = r; dW[q+1] = g; dW[q+2] = b; dW[q+3] = 255*a*0.85; }
  cxW.putImageData(imW, 0, 0);
  const dG = imG.data;
  for(let o=0;o<gH.length;o++){ OV[0] = 0; OV[1] = 0; OV[2] = 0; OV[3] = 0;
    over(240, 168, 48, Math.min(0.45, gQ[o]/150));
    over(232, 244, 246, Math.min(0.7, 1.5*gV[o]));
    const h = gH[o]; if(h > 0.002) over(h >= H2_LFL ? 180 : 130, h >= H2_LFL ? 150 : 115, 224, Math.min(0.55, 1.4*h));
    const fl = gF[o]; if(fl > 0.02){ over(255, 106, 30, Math.min(0.9, fl)); over(255, 210, 122, Math.min(0.8, Math.max(0, fl - 0.5))); }
    const q = o*4, A = OV[3]; if(!(A > 0)){ dG[q+3] = 0; continue; }
    dG[q] = OV[0]/A; dG[q+1] = OV[1]/A; dG[q+2] = OV[2]/A; dG[q+3] = 255*A; }
  cxG.putImageData(imG, 0, 0);
  const x0 = GX, y0 = rowTop(0), bw = W*CELL, bh = rowTop(H) - y0;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cvW, x0, y0, bw, bh); ctx.drawImage(cvG, x0, y0, bw, bh);
  for(const bl of L.blasts){ const a = L.t - bl.t; if(a < 0 || a > 1) continue;
    const X = x0 + (bl.cell%W + 0.5)*CELL, Y = y0 + (((bl.cell/W)|0) + 0.5)*CELL;
    ctx.save(); ctx.beginPath();
    for(let i=0;i<N;i++) if(pc[i] >= 0 && pc[i] === bl.k) ctx.rect(x0 + (i%W)*CELL, y0 + ((i/W)|0)*CELL, CELL, CELL);
    ctx.clip();
    if(a < 0.3){ ctx.globalAlpha = 0.3*(1 - a/0.3); ctx.fillStyle = "#ff5a45"; ctx.fillRect(x0, y0, bw, bh); }
    ctx.globalAlpha = 0.9*(1 - a); ctx.strokeStyle = "#ff5a45"; ctx.lineWidth = CELL*0.4;
    ctx.beginPath(); ctx.arc(X, Y, 340*a/MPC*CELL, 0, 6.283); ctx.stroke(); ctx.restore(); }
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
  h2f: i => bH[i] > 0 ? bH[i]/H2_MMOL/(Math.max(1, bHv[i])*N0) : 0,
  o2f: i => { const k = pc[i]; if(k < 0) return O2_FRAC0; const x = bH[i] > 0 ? bH[i]/H2_MMOL/(Math.max(1, bHv[i])*N0) : 0;
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
    r.wat += injW; r.vap += injV; r.h2 += injH;
    for(let k=0;k<L.npk;k++){ r.pk = Math.max(r.pk, (kP[k] - P0)/1000); r.maxT = Math.max(r.maxT, kT[k]); }
    return r; },
};

return { build, reset, step, blast, src, L, K, KNOBS,
  inject: (kind, rate, cell) => { L.inj = {kind, rate, cell}; },
  off: () => { L.inj = null; },
  get np(){ return L.np; }, get px(){ return px; }, get py(){ return py; }, get vx(){ return vx; }, get vy(){ return vy; },
  get kind(){ return kind; }, get pm(){ return pm; }, get pv(){ return pv; }, get burn(){ return burn; },
  get fill(){ return fill; }, get pc(){ return pc; }, get kP(){ return kP; } };
})();
