"use strict";
// chunks: read move source pocket fill slug breakhl breaksl
const {check, commissionPreset, march, blastExcess, if97, TofH, tsat, psat, inBundle} = require("./lib.js");
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
  const s = G.ST, GW = G.GW, cap = G.ROOM_VCELL/if97(0.1013, 293).v, h0 = G.hOfTP(G.SAT_WATER, 293, 0.1013), zf = i => (G.GH - 1 - ((i/GW)|0))*G.MPC;
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

if(mode === "slug"){
  // Bagnold's air spring (Bagnold 1939): a water slug at known speed hits a trapped air pocket.
  // Sealed liner box 8..44/8..26; channel row 20, closed at x=14; pocket x=15..20, slug x=21..28;
  // the rest of the box is the back volume, so the back pressure stays about constant.
  const FAULT = process.argv.includes("fault");
  const YC = 20, PX0 = 15, NP = 6, SX0 = 21, NS = 8;
  const Unum = process.argv.slice(3).map(Number).find(v => v > 0), U = Unum || 8;
  const walls = [];
  for(let x=14;x<=29;x++){ walls.push([x, YC-1], [x, YC+1]); }
  walls.push([14, YC]);
  box(8, 44, 8, 26, walls, (x, y) => (y === YC && x >= SX0 && x < SX0 + NS) ? 1 : 0);
  // the rig rebuilds the board, so the grid is read after it, never before
  const GW = G.GW, MPC = G.MPC;
  const pocket = [], slug = [];
  for(let x=PX0;x<PX0+NP;x++) pocket.push(YC*GW + x);
  for(let x=SX0;x<SX0+NS;x++) slug.push(YC*GW + x);
  ST.roomWU.fill(0); ST.roomWV.fill(0);
  // a pre-seeded void is refilled by the gas step within one tick, so the fault is injected
  // at liquid time: every water pass sees one open pocket cell with no gas in it.
  if(FAULT){ const d = pocket[2], n = pocket[3];
    inBundle("(function(){ const o = eLiqStep, D = " + d + ", N2 = " + n + ";"
      + " eLiqStep = function(dt, q){ if(q.tag === 0 && ST.roomM[D] > 0){"
      + " ST.roomM[N2] += ST.roomM[D]; ST.roomH2[N2] += ST.roomH2[D];"
      + " ST.roomO2[N2] += ST.roomO2[D]; ST.roomVap[N2] += ST.roomVap[D];"
      + " ST.roomM[D] = 0; ST.roomH2[D] = 0; ST.roomO2[D] = 0; ST.roomVap[D] = 0; }"
      + " return o.apply(this, arguments); }; })()"); }
  const rho = 1/if97(0.1013, 293).v, p0kPa = G.ROOM_P0, gam = G.GAM_AIR;
  const x0 = NP*MPC, L = NS*MPC, p0 = p0kPa*1000;
  let mSlug = 0; for(const i of slug) mSlug += ST.roomWater[i];
  const KE = 0.5*mSlug*U*U/1000;
  for(let x=SX0-1;x<=SX0+NS-1;x++) ST.roomWU[YC*GW + x] = -U;
  const b0 = gasOf(pocket);
  const Earea = 0.5*rho*L*U*U;
  const f = xm => p0*x0/(gam - 1)*(Math.pow(x0/xm, gam - 1) - 1) - p0*(x0 - xm) - Earea;
  let lo = 1e-6, hi = x0;
  for(let k=0;k<200;k++){ const m = (lo + hi)/2; if(f(m) > 0) lo = m; else hi = m; }
  const xm = (lo + hi)/2, pm = p0*Math.pow(x0/xm, gam)/1000;
  const T = 2*Math.PI*Math.sqrt(rho*L*x0/(gam*p0));
  // T/4 is the small-amplitude truth only; at this amplitude the time truth is the same
  // Bagnold ODE integrated, since a hardening spring peaks earlier (no closed form).
  let s = 0, v = U, tnl = 0;
  { const dt = T/4000;
    for(let k=0;k<4000*4;k++){ const x = x0 - s;
      if(x <= 0 || v < 0) break;
      v += (p0 - p0*Math.pow(x0/x, gam))/(rho*L)*dt; s += v*dt; tnl += dt; } }
  const dx = 0.5*MPC;
  const pmHi = p0*Math.pow(x0/Math.max(xm - dx, 1e-6), gam)/1000, pmLo = p0*Math.pow(x0/(xm + dx), gam)/1000;
  const gridTol = Math.max(Math.abs(pmHi - pm), Math.abs(pmLo - pm))/pm;
  let Vprev = b0.V, pprev = b0.p, cumW = 0, pmax = 0, tPeak = -1, Wpeak = 0, mPeak = b0.m;
  const diag = process.argv.includes("diag");
  const resCell = 10*G.GW + 40;
  let pbPrev = ST.roomP[resCell] + G.ROOM_P0, drvW = 0, drvPeak = 0;
  for(let k=0;k<150;k++){ G.step(0.02);
    const b = gasOf(pocket);
    if(b.V > 0) cumW += 0.5*(pprev + b.p)*(Vprev - b.V);
    const pb = ST.roomP[resCell] + G.ROOM_P0;
    drvW += 0.5*(pbPrev + pb)*(Vprev - b.V);
    if(b.p > pmax){ pmax = b.p; tPeak = (k + 1)*0.02; Wpeak = cumW; drvPeak = drvW; mPeak = b.m; }
    if(diag && k < 40){ let mw = 0; for(const i of slug) mw += ST.roomWater[i];
      console.error("t=" + ((k+1)*0.02).toFixed(2) + " V=" + b.V.toFixed(3) + " p=" + b.p.toFixed(1) + " m=" + b.m.toFixed(3) + " slugW=" + mw.toFixed(0) + " pb=" + pb.toFixed(1) + " wu=" + ST.roomWU[pocket[pocket.length-1]].toFixed(2)); }
    Vprev = b.V; pprev = b.p; pbPrev = pb; }
  const BAGNOLD = "Bagnold 1939, Interim report on wave-pressure research, J. Inst. Civil Eng. 12, 202-226: 1/2 rho L u^2 = p0 x0/(gamma-1)[(x0/xm)^(gamma-1)-1] - p0(x0-xm), pm = p0(x0/xm)^gamma, T = 2 pi sqrt(rho L x0/(gamma p0))";
  check("slug: peak pocket pressure against Bagnold's air spring", pmax, pm, gridTol, BAGNOLD,
    {unit:"kPa", note:"analytic peak " + (pm/1000).toFixed(3) + " MPa (in the 0.3-3 MPa window), xm " + xm.toFixed(3) + " m; tolerance the pm spread moving xm half a cell (" + (100*gridTol).toFixed(1) + " %)" + (FAULT ? "; FAULT: pocket cell emptied into its neighbour" : "")});
  check("slug: compression work never exceeds the slug's kinetic energy plus the drive's work", Wpeak, KE + drvPeak, 0.02, BAGNOLD,
    {unit:"kJ", pass:Wpeak <= (KE + drvPeak)*1.02, note:"work to the first peak " + Wpeak.toFixed(2) + " kJ against KE " + KE.toFixed(2) + " kJ plus back-gas work " + drvPeak.toFixed(2) + " kJ; friction may only lose energy" + (FAULT ? "; FAULT: pocket cell emptied into its neighbour" : "")});
  check("slug: time to the first peak against the Bagnold time", tPeak, tnl, 0.02 + 0.5*MPC/U, BAGNOLD,
    {abs:true, unit:"s", note:"peak at " + tPeak.toFixed(2) + " s against the integrated " + tnl.toFixed(2) + " s (linear T/4 " + (T/4).toFixed(2) + " s does not hold at this amplitude); tolerance one tick plus half a cell at U (" + (0.5*MPC/U).toFixed(3) + " s)"});
  check("slug: the pocket holds its gas through the squeeze", Math.abs(mPeak - b0.m)/b0.m, 0, 50*EPS32, CONS,
    {abs:true, unit:"relative", note:b0.m.toFixed(4) + " kg at launch, " + mPeak.toFixed(4) + " kg at the first peak; the pocket joins the back volume on rebound, so the count stops at the peak"});
}

// a break marched 60 s in slices of the 10 s budget, the state carried between them
if(mode === "breakhl" || mode === "breaksl"){
  const fs = require("fs"), os = require("os"), path = require("path");
  const cut = mode === "breakhl" ? "pipe:28,15" : "pipe:35,4", what = mode === "breakhl" ? "hot-leg" : "steam-line";
  const fBin = path.join(os.tmpdir(), "rc-phys-" + mode + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-" + mode + ".json");
  const SECS = 60, WALL = 7000, t0 = Date.now(), sc = ST.sc;
  const SLB_SRC = "NUREG-0800 SRP 15.1.5; AP1000 DCD Rev. 18 Table 15.1.2-1 sheet 2, steam system piping failure from zero load: rupture 0.0 s, \"S\" signal on low steam line pressure 1.4 s; at power the reactor trips on the S signal (DCD 15.1.5)";
  let A;
  if(process.argv.includes("--resume") && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
  else { sc[G.SC_DICEOFF] = 1;
    // presets commission with protection defeated; a real plant runs with it in
    for(const id in G.D.blocks){ const b = G.D.blocks[id]; if(b.mode === "sink" && b.sink === "scram") G.act("blkOn", G.IX.block.get(id)); }
    G.actId("hit", cut);
    A = {pmax:0, pAt:"", src:0, clamp:0, t0:sc[G.SC_T], blast:"", bw:0, bwAt:"", fmax:0, fAt:"", fT:300, tScr:-1, rod0:0, rod1:-1}; }
  // liquid past its bubble point, not yet boiled: saturated liquid at its own temperature
  const TofHf = h => { let lo = 273.16, hi = 623.15; for(let k=0;k<60;k++){ const m = (lo + hi)/2; if(if97(psat(m), m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };
  const PT = G.PT, cellAt = i => "cell " + (i%G.GW) + "," + ((i/G.GW)|0) + " at " + sc[G.SC_T].toFixed(2) + " s";
  while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
    G.step(0.02);
    const t = sc[G.SC_T] - A.t0;
    for(let o=0;o<PT.nOpen;o++){ if(!(G.eOpenKg(o) > 0)) continue; const nd = G.eOpenFl(o); if(nd >= 0 && ST.pBy[nd] > A.src) A.src = ST.pBy[nd]; }
    for(let i=0;i<N;i++){ const p = (ST.roomP[i] + G.ROOM_P0)/1000;
      if(p > A.pmax){ A.pmax = p; A.pAt = cellAt(i); }
      if(ST.roomT[i] >= G.ROOM_TMAX) A.clamp++;
      const w = ST.roomWater[i], pool = ST.roomPool[i] > 0 ? ST.roomPool[i]/PT.rFireRho[i] : 0;
      if(!((w/550 + pool)/V0 > A.fmax)) continue;
      const pw = (Math.max(0, ST.roomWP[i]) + G.ROOM_P0)/1000, h = w > 0 ? ST.roomWaterE[i]/w : 0, hot = w > 0 && pw < 22 && h > if97(pw, tsat(pw)).h;
      const T = !(w > 0) ? 300 : hot ? TofHf(h) : TofH(pw, h);
      const f = (w*(w > 0 ? if97(hot ? psat(T) : pw, T).v : 0) + pool)/V0;
      if(f > A.fmax){ A.fmax = f; A.fT = T; A.fAt = cellAt(i); } }
    if(t <= 1) for(let a=0;a<PT.n.part;a++){ const lim = PT.partBlast[a]; if(!lim) continue;
      if(ST.dmgBy[a]){ if(ST.dmgWhy[a] === G.E_WHY_BLAST && A.blast.indexOf(G.IX.partId[a] + " ") < 0) A.blast += G.IX.partId[a] + " "; continue; }
      const e = blastExcess(G, a); if(e/lim > A.bw){ A.bw = e/lim; A.bwAt = G.IX.partId[a] + " " + e.toFixed(2) + " of " + lim + " kPa at " + t.toFixed(2) + " s"; } }
    if(A.tScr < 0 && ST.csScrammed[0]){ A.tScr = t; A.rod0 = ST.csRodPos[0]; }
    if(A.tScr >= 0 && A.rod1 < 0 && t >= A.tScr + 1) A.rod1 = ST.csRodPos[0]; }
  if(sc[G.SC_T] < SECS - 1e-9){
    fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
    process.stdout.write("@@MORE\n"); process.exit(0); }
  for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);
  check("60 s " + what + " break: no room cell reads more than the break is driven by", A.pmax, A.src, 0,
    "water or steam driven into a pocket by a circuit at p cannot compress it past p: no correlation, no tolerance",
    {unit:"MPa", pass:A.src > 0 && A.pmax <= A.src, note:"worst " + A.pAt + ", against the highest pressure any open break discharged from"});
  check("60 s " + what + " break: cell-ticks at the ROOM_TMAX guard", A.clamp, 0, 0,
    "ROOM_TMAX is a runaway guard, not a temperature: nothing in a reactor compartment reaches 20 000 K", {abs:true, unit:"cell-ticks"});
  const hi = Math.max(A.src, psat(Math.min(A.fT, 623.15))), tol = if97(Math.max(0.101325, psat(A.fT)), A.fT).v/if97(hi, A.fT).v - 1;
  check("60 s " + what + " break: the fullest cell's water and pool over its volume", A.fmax, 1, tol,
    "conservation of volume: liquid at its IF97 region 1 density at the cell's own T and p plus the pool fits the cell; tolerance water's compressibility up to the drive pressure",
    {abs:true, unit:"of ROOM_VCELL", pass:A.fmax <= 1 + tol, note:"worst " + A.fAt + ", water at " + A.fT.toFixed(0) + " K"});
  if(mode === "breaksl") check("steam-line break: parts wrecked on the blast path in the first second", A.blast ? A.blast.trim().split(" ").length : 0, 0, 0,
    "Biggs 1964: a rise the whole compartment shares loads by its pressure difference, the crush path; only a front the compartment has not shared is a blast",
    {abs:true, unit:"parts", note:(A.blast ? "wrecked: " + A.blast + "; " : "") + "worst corrected excess of an intact part " + (A.bwAt || "-")});
  const ins = A.rod1 > A.rod0;
  if(mode === "breaksl") check("steam-line break: scram demanded after the break, rods inserting", A.tScr, 0, 2,
    SLB_SRC, {abs:true, unit:"s", pass:A.tScr >= 0 && A.tScr <= 2 && ins,
      note:A.tScr < 0 ? "never scrammed in 60 s" : "rods " + A.rod0.toFixed(3) + " -> " + A.rod1.toFixed(3) + " one second after the demand"});
  else check("hot-leg break: the reactor is scrammed", A.tScr >= 0 ? 1 : 0, 1, 0,
    "a LOCA trips a real PWR on low pressurizer pressure or containment pressure High-1 (NUREG-1431 Rev. 4, Table 3.3.1-1 Function 18; Table 3.3.2-1 Function 1.c)",
    {abs:true, unit:"scrammed", pass:A.tScr >= 0 && ins, note:A.tScr < 0 ? "never scrammed in 60 s" : "demanded " + A.tScr.toFixed(2) + " s after the break"});
}
