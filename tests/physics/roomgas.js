"use strict";
// chunks: read move source
const {check, commissionPreset, march} = require("./lib.js");
const mode = process.argv[2] || "read";
const G = commissionPreset(0);
const ST = G.ST, N = G.GW*G.GH, RU = 8.314462618, V0 = G.ROOM_VCELL;
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
G.act("blast", ci, 5000);
const m0 = gasTot();
const a = drive(100);
check("gas transport invents no mass, 5 MPa blast", a.res, 0, resTol(100), CONS, {abs:true, unit:"kg", note:"sum of the non-negativity clamp over 100 ticks"});
check("room gas total, closed, over a blast", Math.abs(gasTot() - m0)/m0, 0, 100*EPS32, CONS + "; the room holds mass in f32, so 100 ticks hold to 100 x 2^-24", {abs:true, unit:"relative"});
check("no cell holds negative gas, blast", a.neg, 0, 0, "mass is non-negative", {abs:true, unit:"cells"});

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
