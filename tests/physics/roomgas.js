"use strict";
// chunks: read move source pocket fill breakhl breaksl
const {check, commissionPreset, march} = require("./lib.js");
const mode = process.argv[2] || "read";
const G = mode === "pocket" || mode === "fill" ? require("./lib.js").load() : commissionPreset(0);
let ST = G.ST;
const N = G.GW*G.GH, RU = 8.314462618, V0 = G.ROOM_VCELL;
const SRC = "ideal gas p V = (m_air/M_air + m_H2O/M_H2O + m_H2/M_H2) R T; M 28.96, 18.015, 2.016 g/mol, R 8.314462618 J/mol/K (CODATA)";
function worst(){
  let w = -1, at = -1, pm = 0, pi = 0, n = 0;
  for(let i=0;i<N;i++){ const V = V0 - ST.roomWater[i]/1000 - (ST.roomPool[i] > 0 ? ST.roomPool[i]/G.PT.rFireRho[i] : 0);
    if(!(V > 0.02*V0) || !(ST.roomM[i] > 0)) continue;
    const air = ST.roomM[i] - ST.roomH2[i] - ST.roomVap[i];
    const p = (air/0.02896 + ST.roomVap[i]/0.018015 + ST.roomH2[i]/0.002016)*RU*ST.roomT[i]/V/1000;
    const e = Math.abs(ST.roomP[i] + G.ROOM_P0 - p)/p; n++;
    if(e > w){ w = e; at = i; pm = ST.roomP[i] + G.ROOM_P0; pi = p; } }
  return {w, at, pm, pi, n};
}

const CONS = "conservation of mass: a transport operator relocates a cell's contents, it creates none";
/* one IEEE 754 rounding per store: the room fields are binary32, the face kilograms binary64 */
const EPS32 = Math.pow(2, -24), EPS64 = Math.pow(2, -52);
const gasTot = () => { let k = 0; for(let i=0;i<N;i++) k += ST.roomM[i]; return k; };
const ci = ((G.GH>>1)|0)*G.GW + ((G.GW>>1)|0);
/* an open cell no ventilator and no inerting part reaches, so a source there is the only term on it */
function quietCell(){
  const PT = G.PT, vent = new Uint8Array(N);
  for(let a=0;a<PT.n.part;a++){ const r = PT.partRoomRole[a]; if(r !== 1 && r !== 2) continue;
    for(let k=PT.partCell0[a];k<PT.partCell0[a+1];k++) vent[PT.partCellIx[k]] = 1; }
  let best = -1, bd = 1e9;
  for(let i=0;i<N;i++){
    if(vent[i] || !(G.eRoomVgas(i) > 0.9*V0) || !(ST.roomM[i] > 0) || PT.cellRegion[i] < 0) continue;
    const d = Math.abs(i%G.GW - ci%G.GW) + Math.abs((i/G.GW|0) - (ci/G.GW|0));
    if(d < bd){ bd = d; best = i; } }
  return best;
}
function drive(n){
  let res = 0, neg = 0;
  for(let j=0;j<n;j++){ G.step(0.02); res += ST.sc[G.SC_FACERES];
    for(let i=0;i<N;i++) if(ST.roomM[i] < 0 || ST.roomH2[i] < 0 || ST.roomO2[i] < 0 || ST.roomVap[i] < 0) neg++; }
  return {res, neg};
}
/* the clamp can only round, so its floor is one double ulp of the inventory per tick */
const resTol = n => n*gasTot()*EPS64;

if(mode === "read"){
march(2);
{ const r = worst(); check("compartment gas, every open cell, at rest", r.pm, r.pi, 1e-3, SRC, {unit:"kPa", pass:r.n > 0 && r.w <= 1e-3, note:"worst of " + r.n + " cells, cell " + r.at}); }
for(let i=0;i<N;i++) ST.roomT[i] += 60;
march(0.02);
{ const r = worst(); check("compartment gas after a 60 K step in every cell", r.pm, r.pi, 1e-3, SRC, {unit:"kPa", pass:r.n > 0 && r.w <= 1e-3, note:"worst of " + r.n + " cells, cell " + r.at}); }
}

if(mode === "move"){
march(1);
/* the closed statement needs the room to BE closed, so it is asked on a charge that breaks nothing and
   the premise is checked rather than assumed; the 5 MPa charge below breaks pipes and is not closed */
const dmg0 = ST.sc[G.SC_DMGGEN];
G.act("blast", ci, 120);
const m0 = gasTot();
const z = drive(100);
check("room gas total, closed, over a charge that breaks nothing", Math.abs(gasTot() - m0)/m0, 0, 100*EPS32,
  CONS + "; the room holds mass in f32, so 100 ticks hold to 100 x 2^-24", {abs:true, unit:"relative",
    pass:ST.sc[G.SC_DMGGEN] === dmg0 && Math.abs(gasTot() - m0)/m0 <= 100*EPS32,
    note:"120 kPa at cell " + (ci%G.GW) + "," + ((ci/G.GW)|0) + "; " + (ST.sc[G.SC_DMGGEN] - dmg0) + " parts broke"});
G.act("blast", ci, 5000);
const a = drive(100);
check("gas transport invents no mass, 5 MPa blast", a.res + z.res, 0, resTol(200), CONS, {abs:true, unit:"kg", note:"sum of the non-negativity clamp over 200 ticks"});
check("no cell holds negative gas, blast", a.neg + z.neg, 0, 0, "mass is non-negative", {abs:true, unit:"cells"});

/* a break, a floor hole and 10 t/s of water: the flashing and displacement that drive the limiter hardest */
G.actId("hit", "pipe:28,15"); G.actId("hit", "mat:20,30");
G.actId("injectOn", "fluid", 10000, 15*G.GW + 12);
const b = drive(200);
check("gas transport invents no mass, break and flood", b.res, 0, resTol(200), CONS, {abs:true, unit:"kg", note:"sum of the non-negativity clamp over 200 ticks"});
check("no cell holds negative gas, break and flood", b.neg, 0, 0, "mass is non-negative", {abs:true, unit:"cells"});
}

if(mode === "source"){
march(1);
/* the room vents and condenses, so its gas is not closed; a source is isolated differentially, against
   the same ticks without it. Hydrogen, because steam meets its own saturation line on the way. */
const RATE = 5, TICKS = 50, want = RATE*0.02*TICKS, qc = quietCell();
const snap = G.snapS();
const s0 = gasTot();
const q = drive(TICKS), base = gasTot() - s0;
G.restoreS(snap);
G.actId("injectOn", "h2", RATE, qc);
const c = drive(TICKS);
check("a hydrogen source raises the gas by exactly its rate", gasTot() - s0 - base, want, TICKS*EPS32*gasTot()/want, CONS, {unit:"kg", note:"cell " + (qc%G.GW) + "," + ((qc/G.GW)|0) + ", against the same ticks with no source, which moved " + base.toExponential(2) + " kg"});
check("gas transport invents no mass, under a hydrogen source", c.res + q.res, 0, resTol(2*TICKS), CONS, {abs:true, unit:"kg"});
check("no cell holds negative gas, under a hydrogen source", c.neg + q.neg, 0, 0, "mass is non-negative", {abs:true, unit:"cells"});
}

// a sealed liner box, water laid at rest with its hydrostatic pressure, air above it
function box(x0, x1, y0, y1, walls, wet){
  const {rig} = require("./lib.js"), L = {m:"liner", t:600};
  rig((R, GG) => { const D = GG.D; D.mat = D.mat || {};
    for(let x=x0-1;x<=x1+1;x++){ D.mat[x + "," + (y0-1)] = L; D.mat[x + "," + (y1+1)] = L; }
    for(let y=y0;y<=y1;y++){ D.mat[(x0-1) + "," + y] = L; D.mat[(x1+1) + "," + y] = L; }
    for(const [x, y] of walls) D.mat[x + "," + y] = L; });
  ST = G.ST;
  const s = G.ST, GW = G.GW, cap = 1000*G.ROOM_VCELL, h0 = G.hOfTP(G.SAT_WATER, 293, 0.1013), zf = i => (G.GH - 1 - ((i/GW)|0))*G.MPC;
  const cells = [];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){ const i = y*GW + x; if(G.PT.rTight[i]) continue; cells.push(i);
    const f = wet(x, y); if(!(f > 0)) continue;
    s.roomWater[i] = f*cap; s.roomWaterE[i] = f*cap*h0; s.roomM[i] *= 1 - f; s.roomO2[i] *= 1 - f; s.roomVap[i] = 0; s.roomH2[i] = 0; }
  for(const i of cells){ if(!(s.roomWater[i] > 0)) continue; let t = i; while(s.roomWater[t - GW] > 0) t -= GW;
    s.roomWP[i] = 9.80665*(zf(t) + G.MPC*s.roomWater[t]/cap - zf(i)); }
  return cells;
}
const molOf = i => (ST.roomM[i] - ST.roomVap[i] - ST.roomH2[i])/0.02896 + ST.roomVap[i]/0.018015 + ST.roomH2[i]/0.002016;
const gasOf = cells => { let n = 0, v = 0, nt = 0, m = 0;
  for(const i of cells){ if(!(ST.roomM[i] > 0)) continue; n += molOf(i); nt += molOf(i)*ST.roomT[i]; v += G.eRoomVgas(i); m += ST.roomM[i]; }
  return {p: nt*RU/v/1000, V: v, m, n}; };
const ADIA = "adiabatic compression of a trapped ideal gas: p V^gamma = constant, gamma of the model's own dry air";

if(mode === "pocket"){
  // a diving bell: outside water six rows higher drives in under the rim, and only the trapped air stops it
  const X0 = 10, X1 = 40, Y0 = 6, Y1 = 26, BL = 20, BR = 30, BB = 17, WL = 12, walls = [];
  for(let y=Y0;y<=BB;y++) walls.push([BL, y], [BR, y]);
  const cells = box(X0, X1, Y0, Y1, walls, (x, y) => y > BB || (!(x > BL && x < BR) && y >= WL) ? 1 : 0);
  const GW = G.GW, bell = cells.filter(i => { const x = i%GW, y = (i/GW)|0; return x > BL && x < BR && y <= BB; });
  const b0 = gasOf(bell), n0 = cells.reduce((a, i) => a + molOf(i), 0);
  let worst = 0, at = 0, dV = 0;
  for(let k=0;k<75;k++){ G.step(0.02);
    const b = gasOf(bell), want = b0.p*Math.pow(b0.V/b.V, G.GAM_AIR), e = Math.abs(b.p - want)/want;
    if(e > worst){ worst = e; at = k + 1; } if(b0.V - b.V > dV) dV = b0.V - b.V; }
  check("a trapped pocket rides its own adiabat as the water drives into it", worst, 0, 0.01, ADIA,
    {abs:true, unit:"relative", pass:dV > 0.05*b0.V && worst <= 0.01,
     note:"worst of 75 ticks at tick " + at + "; the water took up to " + (100*dV/b0.V).toFixed(1) + " % of the pocket, " + b0.V.toFixed(1) + " m3 at " + b0.p.toFixed(1) + " kPa"});
  check("the pocket holds its air: none leaves under the rim", Math.abs(gasOf(bell).m - b0.m)/b0.m, 0, 75*EPS32,
    "a gas under a closed deckhead cannot pass down through the water that seals it; the room holds mass in f32",
    {abs:true, unit:"relative", note:b0.m.toFixed(4) + " kg"});
  check("the box's gas moles, closed, over the flood", Math.abs(cells.reduce((a, i) => a + molOf(i), 0) - n0)/n0, 0, 75*EPS32, CONS,
    {abs:true, unit:"relative"});
  for(let k=0;k<275;k++) G.step(0.02);
  const rim = (G.GH - 1 - BB)*G.MPC, cols = c => new Set(c.map(i => i%GW)).size;
  const side = cells.filter(i => { const x = i%GW, y = (i/GW)|0; return x < BL && y <= BB; });
  const level = c => rim + c.reduce((a, i) => a + ST.roomWater[i], 0)/1000/(cols(c)*G.MPC*G.ROOM_DEPTH);
  const dp = gasOf(bell).p - gasOf(side).p, head = 9.80665*(level(side) - level(bell));
  check("a trapped pocket holds the water at the depth its gas balances", dp, head, 0.01,
    "hydrostatics: the gas pressure difference across the two free surfaces is rho g times their height difference",
    {unit:"kPa", note:"surfaces " + level(bell).toFixed(3) + " m in the bell and " + level(side).toFixed(3) + " m outside, after 7 s"});
}

if(mode === "fill"){
  // a well one cell wide, open at its top: each cell passes 97 % to full with the box's air over it
  const X0 = 20, X1 = 40, Y0 = 8, Y1 = 26, WX = 30, WT = 20, walls = [];
  for(let y=WT;y<=Y1;y++) walls.push([WX - 1, y], [WX + 1, y]);
  box(X0, X1, Y0, Y1, walls, (x, y) => x === WX && y === Y1 ? 0.96 : 0);
  const GW = G.GW, ref = (WT - 3)*GW + WX, col = [];
  for(let y=Y1;y>=Y1-2;y--) col.push(y*GW + WX);
  G.actId("injectOn", "fluid", 20, Y1*GW + WX);
  let worst = 0, n = 0, note = "";
  for(let k=0;k<400;k++){ G.step(0.02);
    for(const i of col){ const f = ST.roomWater[i]/(1000*G.ROOM_VCELL);
      if(!(f >= 0.97)) continue;
      const e = Math.abs(ST.roomP[i] - ST.roomP[ref]); n++;
      if(e > worst){ worst = e; note = "cell row " + ((i/GW)|0) + " at " + (100*f).toFixed(2) + " % full, tick " + (k + 1); } } }
  check("a cell filling from 97 % to full reads the gas it shares", worst, 0, 0.05,
    "a gas space joined to the air above it is at that air's pressure; a full cell reads the gas it would rise to",
    {abs:true, unit:"kPa", pass:n > 0 && worst <= 0.05, note:n + " readings over three cells; worst " + note + "; tolerance the gas solve's own rest threshold"});
}

// a break marched 60 s in slices of the 10 s budget, the state carried between them
if(mode === "breakhl" || mode === "breaksl"){
  const fs = require("fs"), os = require("os"), path = require("path");
  const cut = mode === "breakhl" ? "pipe:28,15" : "pipe:35,4", what = mode === "breakhl" ? "hot-leg" : "steam-line";
  const fBin = path.join(os.tmpdir(), "rc-phys-" + mode + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-" + mode + ".json");
  const SECS = 60, WALL = 7000, t0 = Date.now(), sc = ST.sc;
  let A;
  if(process.argv.includes("--resume") && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
  else { sc[G.SC_DICEOFF] = 1; G.actId("hit", cut); A = {pmax:0, pAt:"", src:0, clamp:0}; }
  while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
    G.step(0.02);
    for(let o=0;o<G.PT.nOpen;o++){ if(!(G.eOpenKg(o) > 0)) continue; const nd = G.eOpenFl(o); if(nd >= 0 && ST.pBy[nd] > A.src) A.src = ST.pBy[nd]; }
    for(let i=0;i<N;i++){ const p = (ST.roomP[i] + G.ROOM_P0)/1000;
      if(p > A.pmax){ A.pmax = p; A.pAt = "cell " + (i%G.GW) + "," + ((i/G.GW)|0) + " at " + sc[G.SC_T].toFixed(2) + " s"; }
      if(ST.roomT[i] >= G.ROOM_TMAX) A.clamp++; } }
  if(sc[G.SC_T] < SECS - 1e-9){
    fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
    process.stdout.write("@@MORE\n"); process.exit(0); }
  for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);
  check("60 s " + what + " break: no room cell reads more than the break is driven by", A.pmax, A.src, 0,
    "water or steam driven into a pocket by a circuit at p cannot compress it past p: no correlation, no tolerance",
    {unit:"MPa", pass:A.src > 0 && A.pmax <= A.src, note:"worst " + A.pAt + ", against the highest pressure any open break discharged from"});
  check("60 s " + what + " break: cell-ticks at the ROOM_TMAX guard", A.clamp, 0, 0,
    "ROOM_TMAX is a runaway guard, not a temperature: nothing in a reactor compartment reaches 20 000 K", {abs:true, unit:"cell-ticks"});
}
