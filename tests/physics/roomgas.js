"use strict";
// chunks: read move source pocket fill cavity swell lock slug breakhl breaksl flash evict
const {check, commissionPreset, march, blastExcess, if97, TofH, tsat, psat, inBundle, if97r2} = require("./lib.js");
const mode = process.argv[2] || "read";
const EVFAULT = mode === "evict" && process.argv.includes("fault");
if(EVFAULT) require("./lib.js").load(src => { const a = "Math.min(Math.max(E_RR[RR_VG] + disp[i], 0), nV)/m", r = src.replace(a, "Math.max(E_RR[RR_VG] + disp[i], 0)/m");
  if(r === src) throw new Error("evict fault: line not found"); return r; });
/* every eCgSolve return hands its system to global.__CGTAP while the scratch still holds it */
if(mode === "read") require("./lib.js").load(src => src.replace(/function eCgSolve\(([^)]*)\)\{/, (m, a) =>
  "function eCgSolve(" + a + "){ const __it = eCgSolve__(" + a + "); if(global.__CGTAP) global.__CGTAP(b, x, dI, ax, ay, tol, max, __it, E_GC); return __it; } function eCgSolve__(" + a + "){"));
if(mode === "cavity" && process.argv.includes("fault")) require("./lib.js").load(src => {
  const a = "vd[i] = W[i] > 0 && !(Mm[i] > 0) && !eLqFull(lq, i) ? (eGasNear(i) < 0 ? E_VD_SEALED : E_VD_FLASH) : 0;", r = src.replace(a, "vd[i] = 0;");
  if(r === src) throw new Error("cavity fault: line not found"); return r; });
if(mode === "lock" && process.argv.includes("fault")) require("./lib.js").load(src => {
  const WALK = "  let over = false;\n  for(let i=N-1;i>=0;i--){\n    if(!(cap[i] > 0 && M[i] > cap[i] && stand[i])) continue;\n" +
    "    const ex = M[i] - cap[i], eE = E ? E[i]*ex/M[i] : 0;\n    M[i] -= ex; if(E) E[i] -= eE;\n" +
    "    E_RR[RR_LKG] = ex; E_RR[RR_LKJ] = eE; E_RR[RR_LV0] = 0; E_RR[RR_LDSP] = 1; eLiqLand(q, i);\n    over = true;\n  }\n" +
    "  if(over) for(let i=0;i<N;i++){ h[i] = M[i]/(R[i]*A); full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0; }\n  eLqStandWalk(N, full, stand);\n";
  const a = "  eLqStandWalk(N, full, stand);\n  for(let i=0;i<N;i++) stiff[i] =", b = "b[i] = (stiff[i] && M[i] > cap[i] ? M[i] - cap[i] : 0) - (";
  const r = src.replace(a, "  eLqStandWalk(N, full, stand);\n" + WALK + a.slice(a.indexOf("\n") + 1)).replace(b, "b[i] = -(");
  if(r.indexOf("let over = false;") < 0 || r.indexOf(b) >= 0) throw new Error("lock fault: line not found"); return r; });
if(mode === "lock" && process.argv.includes("faultvdp")) require("./lib.js").load(src => {
  const a = "E[i] += M[i]/E_RR[RR_WRHO]*(w - LP[i]);", r = src.replace(a, "");
  if(r === src) throw new Error("lock faultvdp: line not found"); return r; });
if(mode === "lock" && process.argv.includes("faultkap")) require("./lib.js").load(src => {
  const a = "E_RR[RR_WKAP] = kh > 0 && ks > 0 ? ks : 1/WATER_BULK;", r = src.replace(a, "E_RR[RR_WKAP] = kh > 0 ? kh*1e-6 : 1/WATER_BULK;");
  if(r === src) throw new Error("lock faultkap: line not found"); return r; });
if(mode === "swell" && process.argv.includes("fault")) require("./lib.js").load(src => {
  const b = "b[i] = (stiff[i] && M[i] > cap[i] ? M[i] - cap[i] : 0) - (", r = src.replace(b, "b[i] = -(");
  if(r === src) throw new Error("swell fault: line not found"); return r; });
const G = mode === "pocket" || mode === "fill" || mode === "evict" || mode === "cavity" || mode === "swell" || mode === "lock" ? require("./lib.js").load() : commissionPreset(0);
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
let solve = null;
global.__CGTAP = (b, x, dI, ax, ay, tol, max, it, gc) => { if(!solve && it > 0) solve = cgResidual(b, x, dI, ax, ay, gc, tol, max, it); };
for(let i=0;i<N;i++) ST.roomT[i] += 60;
march(0.02);
{ const r = worst(); check("compartment gas after a 60 K step in every cell", r.pm, r.pi, 1e-3, SRC, {unit:"kPa", pass:r.n > 0 && r.w <= 1e-3, note:"worst of " + r.n + " cells, cell " + r.at}); }
cgCheck("the gas pressure solve after a 60 K step", solve);
/* every liquid solve with pockets over 3 s after the break, the worst residual judged */
solve = null;
let sch = 0, nSolve = 0;
global.__CGTAP = (b, x, dI, ax, ay, tol, max, it, gc) => { if(gc.n === 0) return;
  const s = cgResidual(b, x, dI, ax, ay, gc, tol, max, it); nSolve++;
  if(s.sch > sch) sch = s.sch;
  if(!solve || s.rel/s.tol > solve.rel/solve.tol || s.it >= s.max) solve = s; };
G.act("hit", require("../../tools/bundle.js").pipeOnLoop({IX:() => G.IX, PT:() => G.PT, runOfCell:(x, y) => G.pipeMap().cellOwner[x + "," + y] || []}));
march(3);
cgCheck("the liquid solve with its gas pockets' Schur term, after a pipe break", solve, sch > 1e-3,
  nSolve + " solves, pockets' term up to " + sch.toExponential(1) + " of ||b||");
}
/* ||b - A x||/||b|| with A applied here face by face from its definition, the pockets' term -c c^T/Dt from its own; sch = ||that term||/||b|| */
function cgResidual(b, x, dI, ax, ay, gc, tol, max, it){
  const GW = G.GW, y = new Float64Array(N), sx = new Float64Array(N), s = new Float64Array(gc.n), lab = gc.lab, w = gc.w, wf = gc.wf;
  for(let i=0;i<N;i++) y[i] = dI[i]*x[i];
  for(let i=0;i<N-1;i++){ const q = ax[i]*(x[i] - x[i+1]); y[i] += q; y[i+1] -= q; }
  for(let i=0;i<N-GW;i++){ const q = ay[i]*(x[i] - x[i+GW]); y[i] += q; y[i+GW] -= q; }
  const up = i => i < N-GW && wf[i] > 0 ? lab[i+GW] : -1;
  if(gc.n > 0){
    for(let i=0;i<N;i++){ if(lab[i] >= 0 && w[i] > 0) s[lab[i]] += w[i]*x[i]; if(up(i) >= 0) s[up(i)] += wf[i]*x[i]; }
    for(let r=0;r<gc.n;r++) s[r] /= gc.Dt[r];
    for(let i=0;i<N;i++){ if(lab[i] >= 0 && w[i] > 0) sx[i] += w[i]*s[lab[i]]; if(up(i) >= 0) sx[i] += wf[i]*s[up(i)]; }
  }
  let rn = 0, bn = 0, sn = 0;
  for(let i=0;i<N;i++){ const e = b[i] - y[i] + sx[i]; rn += e*e; bn += b[i]*b[i]; sn += sx[i]*sx[i]; }
  return {rel: Math.sqrt(rn/bn), sch: Math.sqrt(sn/bn), tol, it, max, n: gc.n};
}
function cgCheck(name, s, seen, note){
  check(name + ": the returned pressure meets its own residual", s ? s.rel : NaN, 0, s ? s.tol : 0,
    "conjugate gradients stops on ||b - A x|| <= tol ||b||, recomputed here from the assembled system", {abs:true,
    pass: !!s && s.it < s.max && s.rel <= s.tol && seen !== false,
    note: (s ? "worst: " + s.it + " iterations of " + s.max + (s.n ? ", " + s.n + " gas pockets" : "") : "no live solve seen") + (note ? "; " + note : "")});
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
function box(x0, x1, y0, y1, walls, wet, T, p){
  const {rig, layWater} = require("./lib.js"), L = {m:"liner", t:600};
  rig((R, GG) => { const D = GG.D; D.mat = D.mat || {};
    for(let x=x0-1;x<=x1+1;x++){ D.mat[x + "," + (y0-1)] = L; D.mat[x + "," + (y1+1)] = L; }
    for(let y=y0;y<=y1;y++){ D.mat[(x0-1) + "," + y] = L; D.mat[(x1+1) + "," + y] = L; }
    for(const [x, y] of walls) D.mat[x + "," + y] = L; });
  ST = G.ST;
  const cells = [];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){ const i = y*G.GW + x; if(!G.PT.rTight[i]) cells.push(i); }
  layWater(G, cells, wet, T || 293, p);
  return cells;
}
const molOf = i => (ST.roomM[i] - ST.roomVap[i] - ST.roomH2[i])/0.02896 + ST.roomVap[i]/0.018015 + ST.roomH2[i]/0.002016;
const gasOf = cells => { let n = 0, v = 0, nt = 0, m = 0;
  for(const i of cells){ if(!(ST.roomM[i] > 0)) continue; n += molOf(i); nt += molOf(i)*ST.roomT[i]; v += G.eRoomVgas(i); m += ST.roomM[i]; }
  return {p: nt*RU/v/1000, V: v, m, n}; };
const ADIA = "adiabatic compression of a trapped ideal gas: p V^gamma = constant, gamma of the model's own dry air";
const ENERGY = "Bagnold 1939: the work a squeezed air pocket takes is at most the drive's work plus the kinetic energy, the fall of the water that squeezes it, and the volume that water gains by heat or condensation; friction only loses. A cavity's own vapour at p_sat(T_w) is a drive, as any pressure that does work on the water is";
/* per gas pocket per tick: W = mean p times the volume lost, against p_drive dV + the start KE, one tick's fall and swell of the water bodies touching it, and the volume of the gas it lost as condensate */
function pocketAudit(dt){
  const GW = G.GW, SX = G.SX, vgas = G.eRoomVgas, gasCell = G.eGasCell, runs = G.eLqRuns, g = 9.80665;
  const v0 = new Float64Array(N), p0 = new Float64Array(N), ke = new Float64Array(N), fall = new Float64Array(N);
  const body = new Int32Array(N), bKe = new Float64Array(N), bFall = new Float64Array(N), lab = new Int32Array(N), Q = new Int32Array(N);
  const seen = new Int32Array(N), sv0 = new Float64Array(N), m0 = new Float64Array(N), gm0 = new Float64Array(N), bEx = new Float64Array(N), RR = G.E_RR, RW = G.RR_WRHO, wrho = G.eRoomWRhoA;
  let mark = 0, svMax = 0, pv = 0;
  const nbr = (i, d) => { const X = i%GW; return d === 0 ? (i >= GW ? i - GW : -1) : d === 1 ? (X > 0 ? i - 1 : -1) : d === 2 ? (X < GW-1 ? i + 1 : -1) : (i < N-GW ? i + GW : -1); };
  return {
    pre(){ const W = ST.roomWater, U = ST.roomWU, V = ST.roomWV;
      for(let i=0;i<N;i++){ const X = i%GW; v0[i] = vgas(i); p0[i] = (ST.roomP[i] + G.ROOM_P0)*1000;
        const u = Math.max(Math.abs(U[i]), X > 0 ? Math.abs(U[i-1]) : 0), v = Math.max(Math.abs(V[i]), i >= GW ? Math.abs(V[i-GW]) : 0);
        ke[i] = 0.5*W[i]*(u*u + v*v); fall[i] = W[i]*g*(v + g*dt)*dt; body[i] = -1; m0[i] = W[i]; gm0[i] = ST.roomM[i]; sv0[i] = W[i] > 0 ? (wrho(i), 1/RR[RW]) : 0; }
      svMax = 0; for(let i=0;i<N;i++) if(sv0[i] > svMax) svMax = sv0[i]; if(!(svMax > 0)) svMax = 1e-3;
      pv = 0; for(let i=0;i<N;i++) if(SX.gsVoid[i] && SX.gsVoid[i] !== G.E_VD_GAS && p0[i] > pv) pv = p0[i];
      let nb = 0;
      for(let s=0;s<N;s++){ if(!(W[s] > 0) || body[s] >= 0) continue;
        let h = 0, t = 0; body[s] = nb; Q[t++] = s; bKe[nb] = 0; bFall[nb] = 0;
        while(h < t){ const i = Q[h++]; bKe[nb] += ke[i]; bFall[nb] += fall[i];
          for(let d=0;d<4;d++){ const j = nbr(i, d); if(j >= 0 && body[j] < 0 && W[j] > 0 && runs(i, j)){ body[j] = nb; Q[t++] = j; } } }
        nb++; } },
    post(pDrive){
      const bx = SX.rBx, by = SX.rBy, vg = new Float64Array(N), out = [], W1 = ST.roomWater;
      bEx.fill(0); for(let i=0;i<N;i++) if(body[i] >= 0) bEx[body[i]] += (W1[i] > 0 ? (wrho(i), W1[i]/RR[RW]) : 0) - m0[i]*sv0[i];
      for(let i=0;i<N;i++){ vg[i] = vgas(i); lab[i] = -1; }
      const gas = i => ST.roomM[i] > 0 && gasCell(vg[i]);
      let n = 0, b1 = 0, l1 = -1, b2 = 0;
      for(let s=0;s<N;s++){ if(lab[s] >= 0 || !gas(s)) continue;
        let h = 0, t = 0; lab[s] = n; Q[t++] = s;
        while(h < t){ const i = Q[h++], X = i%GW;
          const js = [X < GW-1 && bx[i] ? i + 1 : -1, X > 0 && bx[i-1] ? i - 1 : -1, i < N-GW && by[i] ? i + GW : -1, i >= GW && by[i-GW] ? i - GW : -1];
          for(const j of js) if(j >= 0 && lab[j] < 0 && gas(j)){ lab[j] = n; Q[t++] = j; } }
        n++; }
      for(let i=0;i<N;i++){ if(lab[i] < 0) continue; const p = p0[i];
        if(p > b1){ if(lab[i] !== l1) b2 = b1; b1 = p; l1 = lab[i]; } else if(p > b2 && lab[i] !== l1) b2 = p; }
      const V0 = new Float64Array(n), V1 = new Float64Array(n), P0 = new Float64Array(n), P1 = new Float64Array(n), pk = new Float64Array(n), at = new Int32Array(n).fill(-1);
      for(let i=0;i<N;i++){ const r = lab[i]; if(r < 0) continue; const p1 = (ST.roomP[i] + G.ROOM_P0)*1000;
        V0[r] += v0[i]; V1[r] += vg[i]; P0[r] += p0[i]*v0[i]; P1[r] += p1*vg[i]; if(p1 > pk[r]){ pk[r] = p1; at[r] = i; } }
      for(let r=0;r<n;r++){ const dV = V0[r] - V1[r]; if(!(dV > 0)) continue;
        mark++; let kin = 0, dz = 0, ex = 0, cond = 0;
        for(let i=0;i<N;i++){ if(lab[i] !== r) continue; cond += gm0[i] - ST.roomM[i];
          for(let d=-1;d<4;d++){ const j = d < 0 ? i : nbr(i, d); if(j < 0) continue; const bb = body[j];
            if(bb >= 0 && seen[bb] !== mark){ seen[bb] = mark; kin += bKe[bb]; dz += bFall[bb]; ex += bEx[bb]; } } }
        const W = 0.5*(P0[r]/V0[r] + P1[r]/V1[r])*dV, drv = Math.max(pDrive, r === l1 ? b2 : b1, pv);
        out.push({W, bound:drv*dV + kin + dz + P1[r]/V1[r]*(Math.max(0, ex) + Math.max(0, cond)*svMax), cell:at[r], dV, pk:pk[r], drv}); }
      return out; } };
}
const eTally = () => ({n:0, bad:0, r:0, t:0, cell:-1, W:0, B:0, pk:0, drv:0});
function eCount(E, list, t){
  for(const o of list){ E.n++; const r = o.W/o.bound;
    if(o.W > 1.02*o.bound) E.bad++;
    if(r > E.r){ E.r = r; E.t = t; E.cell = o.cell; E.W = o.W; E.B = o.bound; E.pk = o.pk; E.drv = o.drv; } }
}
const eNote = E => E.n + " pocket-ticks, " + E.bad + " over; worst " + E.r.toFixed(3) + " of the bound at " + E.t.toFixed(2) + " s, cell "
  + (E.cell%G.GW) + "," + ((E.cell/G.GW)|0) + ": work " + (E.W/1000).toFixed(2) + " kJ against " + (E.B/1000).toFixed(2) + " kJ, peak cell "
  + (E.pk/1e6).toFixed(3) + " MPa, drive " + (E.drv/1e6).toFixed(3) + " MPa; the kinetic side counts every water body touching the pocket, generous by construction";

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
  const rim = (G.GH - 1 - BB)*G.MPC, cols = c => new Set(c.map(i => i%GW)).size;
  const side = cells.filter(i => { const x = i%GW, y = (i/GW)|0; return x < BL && y <= BB; });
  const level = c => rim + c.reduce((a, i) => a + ST.roomWater[i], 0)/1000/(cols(c)*G.MPC*G.ROOM_DEPTH);
  // the two surfaces still slosh about half a kPa at 7 s, so the balance is read as a mean over the last 3 s
  let dp = 0, head = 0, lb = 0, ls = 0;
  for(let k=0;k<275;k++){ G.step(0.02);
    if(k >= 125){ dp += (gasOf(bell).p - gasOf(side).p)/150; head += 9.80665*(level(side) - level(bell))/150; lb += level(bell)/150; ls += level(side)/150; } }
  check("a trapped pocket holds the water at the depth its gas balances", dp, head, 0.01,
    "hydrostatics: the gas pressure difference across the two free surfaces is rho g times their height difference",
    {unit:"kPa", note:"surfaces " + lb.toFixed(3) + " m in the bell and " + ls.toFixed(3) + " m outside, both means over 4-7 s"});
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

if(mode === "evict"){
  // a floor of water under air in a sealed box: 10 mg of air put into one flooded cell is pushed to the air above
  const X0 = 20, X1 = 30, Y0 = 10, Y1 = 20;
  const cells = box(X0, X1, Y0, Y1, [], (x, y) => y === Y1 ? 1 : 0);
  const GW = G.GW, i = Y1*GW + 25, up = (Y1 - 1)*GW + 25, disp = () => ST.gsDisp;
  for(let k=0;k<50;k++) G.step(0.02);
  const dM = 1e-5, o2 = ST.roomO2[up]/ST.roomM[up], RR = G.E_RR, Ra = RU/0.02896/1000;
  const Ugas = () => { let u = 0; for(const j of cells){ if(!(ST.roomM[j] > 0)) continue; G.eRoomGasA(j); u += RR[G.RR_UC]; } return u; };
  const dSum = () => { let d = 0; for(const j of cells) if(j !== i) d += disp()[j]; return d; };
  const snap = G.snapS();
  const u0 = Ugas(), d0 = dSum(); G.step(0.02); const dC = dSum() - d0; G.step(0.02); const uC = Ugas() - u0;
  G.restoreS(snap);
  const T = ST.roomT[up], p = (G.ROOM_P0 + ST.roomP[i])*1000, flooded = !G.eGasCell(G.eRoomVgas(i)) && !(ST.roomM[i] > 0);
  ST.roomM[i] = dM; ST.roomO2[i] = dM*o2; ST.roomVap[i] = 0; ST.roomH2[i] = 0; ST.roomT[i] = T;
  const m = ST.roomM[i]; G.eRoomGasA(i); const u = RR[G.RR_UC]/m, h = u + Ra*T;
  const u1 = Ugas() - u*m, d1 = dSum(); G.step(0.02); const dP = dSum() - d1; G.step(0.02); const uP = Ugas() - u1;
  const want = m*Ra*1000*T/p, got = dP - dC, gain = uP - uC, ref = m*h;
  const note = (EVFAULT ? "FAULT: the old line books the floor volume; " : "") + "cell " + (i%GW) + "," + Y1 + (flooded ? " flooded, empty" : " NOT a flooded empty cell") + ", air " + T.toFixed(1) + " K at " + (p/1000).toFixed(2) + " kPa";
  check("an evicted gas books its own ideal-gas volume on the cells it joins", got, want, 1e-9,
    "ideal gas V = m R T / p, R 8.314462618 J/mol/K (CODATA), M_air 28.96 g/mol",
    {unit:"m3", pass:flooded && Math.abs(got - want) <= 1e-9*want, note:note + "; the same step with no poke booked " + dC.toExponential(2) + " m3"});
  check("the pocket gains the evicted gas's enthalpy, not the floor's p V", gain, ref, 0.02,
    "first law, a vessel filled through an opening: dU = dm h, h = u + R T (the flow work)",
    {unit:"kJ", pass:flooded && Math.abs(gain - ref) <= 0.02*ref, note:note + "; over the eviction tick and the gas tick that pays its work; the same two ticks with no poke drifted " + uC.toExponential(2) + " kJ against a tolerance of " + (0.02*ref).toExponential(2) + " kJ"});
}

if(mode === "cavity"){
  // a sealed box of saturated water at 500 K; its top middle cell loses 30 % of its water, a cavity with no gas to rise to
  const FAULT = process.argv.includes("fault"), T0 = 500, X0 = 20, X1 = 28, Y0 = 14, Y1 = 20, ps = psat(T0);
  const cells = box(X0, X1, Y0, Y1, [], () => 1, T0, ps);
  for(const i of cells) ST.roomTS[i] = T0;
  const GW = G.GW, c = Y0*GW + ((X0 + X1) >> 1), cut = 0.3*ST.roomWater[c];
  ST.roomWaterE[c] -= ST.roomWaterE[c]*cut/ST.roomWater[c]; ST.roomWater[c] -= cut;
  const Tw = i => TofH(psat(T0), ST.roomWaterE[i]/ST.roomWater[i]), pAbs = i => (ST.roomP[i] + G.ROOM_P0)/1000;
  const watE = () => cells.reduce((a, i) => a + ST.roomWaterE[i], 0), vap = () => cells.reduce((a, i) => a + ST.roomVap[i], 0);
  let n = 0, worst = 0, e2 = NaN, dE = 0, hg = 0, mv = 0, T1 = 0, vdp = 0;
  const wv = i => { if(!(ST.roomWater[i] > 0)) return 0; G.eRoomWRhoA(i); return ST.roomWater[i]/G.E_RR[G.RR_WRHO]; };
  // the gas step reads first in a tick, so a cavity is judged against its water as the tick found it
  for(let k=0;k<10;k++){ const E0 = watE(), v0 = vap(), Tp = cells.map(i => ST.roomWater[i] > 0 ? Tw(i) : 0), P0 = cells.map(i => ST.roomWP[i]);
    G.step(0.02);
    cells.forEach((i, j) => { if(ST.roomWater[i] > 0 && G.SX.gsVoid[i] === G.E_VD_SEALED){ const want = psat(Tp[j]), e = Math.abs(pAbs(i) - want)/want; n++; if(e > worst) worst = e; } });
    if(k === 0){ T1 = Tw(c); dE = watE() - E0; mv = vap() - v0; hg = if97r2(psat(T1), T1).h; cells.forEach((i, j) => { vdp += wv(i)*(ST.roomWP[i] - P0[j]); }); }
    if(k === 1 && ST.roomM[c] > 0){ const want = psat(T1); e2 = Math.abs(pAbs(c) - want)/want; } }
  const SAT = "IAPWS-IF97 region 4: a cavity in water holds its own vapour at p_sat(T) of the water around it";
  const note = "cell " + (c%GW) + "," + Y0 + ", water at " + Tw(c).toFixed(1) + " K, p_sat " + psat(Tw(c)).toFixed(3) + " MPa" + (FAULT ? "; FAULT: the cavity reads the ring" : "");
  check("a cavity sealed in the water reads its own vapour pressure, never a gas it holds none of", worst, 0, 0.02, SAT,
    {abs:true, unit:"relative", pass:n > 0 && worst <= 0.02, note:n + " cavity reads over 10 ticks; " + note});
  check("...and fills with its own steam at that pressure", e2, 0, 0.02, SAT + "; ideal steam p = m R T / V, R 461.5 J/kg/K",
    {abs:true, unit:"relative", note:"read on the tick after the flash; " + note});
  check("...its steam's latent heat out of the water", vdp - dE, mv*hg, 0.02,
    "first law: the water gives up h_g(T) = h_f + h_fg for every kilogram of vapour it makes, h_g on IF97 region 2 at p_sat(T), and gains V dp as its own pressure moves (dh = v dp at constant entropy)",
    {unit:"kJ", note:mv.toExponential(3) + " kg of steam at " + hg.toFixed(1) + " kJ/kg; the water's V dp over the tick " + vdp.toFixed(1) + " kJ; " + note});
}

if(mode === "swell"){
  // a diving bell at rest, water level inside and out; every water cell heated 10 K in place, the swell parts between the pocket and the free surface
  const X0 = 10, X1 = 30, Y0 = 8, Y1 = 24, BL = 14, BR = 20, BB = 16, WL = 12, T0 = 293, T1 = 303, walls = [];
  for(let y=Y0;y<=BB;y++) walls.push([BL, y], [BR, y]);
  const cells = box(X0, X1, Y0, Y1, walls, (x, y) => y >= WL ? 1 : 0, T0);
  const GW = G.GW, inBell = i => { const x = i%GW, y = (i/GW)|0; return x > BL && x < BR && y <= BB; };
  const bell = cells.filter(i => inBell(i) && ((i/GW)|0) < WL), air = cells.filter(i => !inBell(i) && ((i/GW)|0) < WL);
  const wet = cells.filter(i => ST.roomWater[i] > 0), gam = G.GAM_AIR, rho = 1/if97(0.1013, T1).v, g = 9.80665;
  ST.roomWU.fill(0); ST.roomWV.fill(0);
  for(let k=0;k<20;k++) G.step(0.02);
  let dV = 0;
  for(const i of wet){ const m = ST.roomWater[i], p = (G.ROOM_P0 + ST.roomWP[i])/1000;
    dV += m*(if97(p, T1).v - if97(p, T0).v); ST.roomWaterE[i] = m*G.hOfTP(G.SAT_WATER, T1, p); }
  for(const i of cells){ ST.roomT[i] = T1; ST.roomTS[i] = T1; }
  // the swell is shed within a tick, so the baseline is read before one runs
  const b0 = gasOf(bell), o0 = gasOf(air), cols = c => new Set(c.map(i => i%GW)).size, A = n => n*G.MPC*G.ROOM_DEPTH;
  const Ain = A(cols(bell)), Aout = A(cols(air));
  // quasi-static: each gas on its adiabat, the two surfaces apart by the head between the gases
  const kp = gam*b0.p*1000/b0.V, ko = gam*o0.p*1000/o0.V, want = dV*(ko + rho*g/Aout)/(kp + rho*g/Ain + ko + rho*g/Aout);
  let sum = 0, n = 0;
  for(let k=0;k<150;k++){ G.step(0.02); if(k >= 50){ sum += b0.V - gasOf(bell).V; n++; } }
  const got = sum/n;
  const note = "swell " + dV.toFixed(4) + " m3 of " + wet.length + " cells heated " + T0 + " -> " + T1 + " K; pocket " + b0.V.toFixed(2) + " m3, outer air " + o0.V.toFixed(2) + " m3, surfaces " + Ain.toFixed(2) + " and " + Aout.toFixed(2) + " m2; the pocket's loss averaged over 1-3 s" + (process.argv.includes("fault") ? "; FAULT: the over-cap source taken out" : "");
  check("water swelling in place parts between a sealed pocket and a free surface by their compliances", got, want, 0.05,
    "hydrostatics and the adiabat: gamma p_p dV_p / V_p - gamma p_o dV_s / V_o = rho g (dV_s / A_out - dV_p / A_in), dV_p + dV_s = the swell, v(T, p) on IAPWS-IF97 region 1",
    {unit:"m3", note});
}

if(mode === "lock"){
  // water heated 2 K in a box with no gas and no free surface: a hydraulic lock
  const T0 = 293, F2 = process.argv.includes("fault2"), LFN = process.argv.includes("faultvdp") ? "; FAULT: the water's V dp taken out" : process.argv.includes("faultkap") ? "; FAULT: the stiff solve on the isenthalpic compressibility" : "";
  if(F2) inBundle("occupied = (function(o){ const c = {}; return function(skip, opt){ if(skip) return o(skip, opt); const k = JSON.stringify(opt || {}), g = graphSlot(\"occupied\");"
    + " if(c.at !== g) { c.at = g; c.m = {}; } return c.m[k] || (c.m[k] = o(skip, opt)); }; })(occupied)");
  const lockCase = (tag, pre) => {
    if(pre) require("./lib.js").rig((R, GG) => { const D = GG.D; D.mat = D.mat || {}; for(let y=5;y<=25;y++) D.mat["20," + y] = {m:"liner", t:600}; });
    const lock = box(20, 26, 12, 16, [], () => 1, T0);
    let occBad = 0, occAt = "";
    for(let Y=0;Y<G.GH;Y++) for(let X=0;X<G.GW;X++){ const i = Y*G.GW + X, c = G.D.mat && G.D.mat[X + "," + Y];
      const occ = !!c || G.LAY.parts.some(p => X >= p.x && X < p.x + p.w && Y >= p.y && Y < p.y + p.h), tight = !!c && !!G.matRow(c.m).tight;
      if(G.PT.rOcc[i] !== (occ ? 1 : 0) || G.PT.rTight[i] !== (tight ? 1 : 0)){ occBad++; if(!occAt) occAt = X + "," + Y + " reads occ " + G.PT.rOcc[i] + " tight " + G.PT.rTight[i]; } }
    check(tag + "every cell's occupancy and tightness is what the drawing puts there", occBad, 0, 0,
      "geometry: a cell is occupied where a part's box or paint stands and gas-tight where that paint is a tight material",
      {abs:true, unit:"cells", note:(occAt || "all " + G.GW*G.GH + " cells agree") + (F2 ? "; FAULT2: the grid cached without its paint sig" : "")});
    for(let k=0;k<5;k++) G.step(0.02);
    // q kJ/kg into each cell at constant volume: u1 = u0 + q and v1 = v0, solved on IF97 region 1 by Newton
    const u97 = (p, T) => { const r = if97(p, T); return r.h - p*1000*r.v; }, law = [];
    for(const i of lock){ const m = ST.roomWater[i], p0 = (G.ROOM_P0 + ST.roomWP[i])/1000, t0 = TofH(p0, ST.roomWaterE[i]/m);
      const q = if97(p0, t0 + 2).h - if97(p0, t0).h, v0 = if97(p0, t0).v, u1 = u97(p0, t0) + q;
      let p = p0 + 1, T = t0 + 2;
      for(let k=0;k<30;k++){ const f1 = if97(p, T).v - v0, f2 = u97(p, T) - u1, e = 1e-6, a = (if97(p + e, T).v - if97(p, T).v)/e, b = (if97(p, T + e).v - if97(p, T).v)/e;
        const c = (u97(p + e, T) - u97(p, T))/e, d = (u97(p, T + e) - u97(p, T))/e, det = a*d - b*c;
        p -= (f1*d - f2*b)/det; T -= (a*f2 - c*f1)/det; }
      law.push({i, p0, t0, dp:p - p0, dT:T - t0}); ST.roomWaterE[i] += m*q; ST.roomTS[i] = t0 + 2; }
    for(let k=0;k<25;k++) G.step(0.02);
    let got = 0, want = 0, gT = 0, wT = 0;
    for(const L of law){ const p1 = (G.ROOM_P0 + ST.roomWP[L.i])/1000; got += (p1 - L.p0)/law.length; want += L.dp/law.length; gT += (TofH(p1, ST.roomWaterE[L.i]/ST.roomWater[L.i]) - L.t0)/law.length; wT += L.dT/law.length; }
    check(tag + "a sealed full body given q at constant volume: its mean pressure rise", got, want, 0.02,
      "first law at constant volume, u1 = u0 + q with v1 = v0, the state (p1, T1) solved on IAPWS-IF97 region 1 (u = h - p v); q the enthalpy of 2 K at each cell's own start",
      {unit:"MPa", note:lock.length + " cells after 0.5 s" + LFN});
    check(tag + "...and its mean temperature rise", gT, wT, 0.02,
      "the same first law: T1 off the model's own (p, h) on IF97 region 1 against the (p1, T1) solved at u1 = u0 + q, v1 = v0",
      {unit:"K", note:lock.length + " cells after 0.5 s" + LFN});
    let fit = 0, dp = 0, fAt = "";
    for(const i of lock){ const m = ST.roomWater[i], p = (G.ROOM_P0 + ST.roomWP[i])/1000, T = TofH(p, ST.roomWaterE[i]/m);
      const e = Math.abs(m*if97(p, T).v/G.ROOM_VCELL - 1); if(e > fit){ fit = e; fAt = (i%G.GW) + "," + ((i/G.GW)|0) + " at " + p.toFixed(3) + " MPa, " + T.toFixed(2) + " K, m v/V - 1 = " + (m*if97(p, T).v/G.ROOM_VCELL - 1).toExponential(2); } dp += (p - 0.1013)/lock.length; }
    check(tag + "a sealed full body heated 2 K in place holds the pressure its water fits the box at", fit, 0, 1 - G.LIQ_FULL_K,
      "equation of state: a body with no way out keeps its mass and volume, so p is where v(p, T) on IAPWS-IF97 region 1 is the box's volume over its mass; tolerance the model's own full-cell threshold",
      {abs:true, unit:"relative", note:"worst of " + lock.length + " cells after 0.5 s, " + fAt + "; mean pressure " + dp.toFixed(3) + " MPa over 1 atm" + (process.argv.includes("fault") ? "; FAULT: the overflow walk put back" : "")}); };
  lockCase("built after a rig with a liner at x=20: ", true);
  lockCase("", false);
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
  const FAULT2 = process.argv.includes("fault2");
  if(FAULT2) inBundle("(function(){ const o = eLiqStep, R = " + YC*GW + ";"
    + " eLiqStep = function(dt, q){ if(q.tag === 0) for(let x=14;x<=29;x++) ST.roomWU[R + x] *= 1.3;"
    + " return o.apply(this, arguments); }; })()");
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
  const aud = pocketAudit(0.02), En = eTally();
  for(let k=0;k<150;k++){ aud.pre(); G.step(0.02); eCount(En, aud.post(0), (k + 1)*0.02);
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
  check("slug: per pocket per tick, the work on the gas within the drive's work and the water's energy", En.bad, 0, 0, ENERGY,
    {abs:true, unit:"pocket-ticks", note:eNote(En) + (FAULT2 ? "; FAULT2: slug face speeds x1.3 before every water step" : "")});
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
    A = {pmax:0, pAt:"", src:0, clamp:0, t0:sc[G.SC_T], blast:"", bw:0, bwAt:"", fmax:0, fAt:"", fT:300, tScr:-1, rod0:0, rod1:-1, e:eTally()}; }
  // liquid past its bubble point, not yet boiled: saturated liquid at its own temperature
  const TofHf = h => { let lo = 273.16, hi = 623.15; for(let k=0;k<60;k++){ const m = (lo + hi)/2; if(if97(psat(m), m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };
  const aud = pocketAudit(0.02), PT = G.PT, cellAt = i => "cell " + (i%G.GW) + "," + ((i/G.GW)|0) + " at " + sc[G.SC_T].toFixed(2) + " s";
  while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL){
    aud.pre(); G.step(0.02);
    const t = sc[G.SC_T] - A.t0;
    let pd = 0;
    for(let o=0;o<PT.nOpen;o++){ if(!(G.eOpenKg(o) > 0)) continue; const nd = G.eOpenFl(o); if(nd >= 0 && ST.pBy[nd] > pd) pd = ST.pBy[nd]; }
    if(pd > A.src) A.src = pd;
    eCount(A.e, aud.post(pd*1e6), t);
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
  check("60 s " + what + " break: per pocket per tick, the work on the gas within the drive's work and the water's energy", A.e.bad, 0, 0, ENERGY,
    {abs:true, unit:"pocket-ticks", pass:A.src > 0 && A.e.bad === 0, note:eNote(A.e) + "; highest cell of the run " + A.pmax.toFixed(2) + " MPa, " + A.pAt + ", against a highest drive of " + A.src.toFixed(2) + " MPa"});
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

if(mode === "flash"){
  // the split through its own door: a water node's h let go into a cell held at p
  const PT = G.PT, FAULT = process.argv.includes("fault"), i = ci, P = [0.101325, 0.2, 0.5], H = [500, 1000, 1500, 2000];
  let nd = -1; for(let k=0;k<PT.n.node && nd < 0;k++) if(PT.sats[PT.nodeSat[k]] === G.SAT_WATER) nd = k;
  const h0 = ST.hBy[nd], p0 = ST.roomP[i];
  let worst = 0, at = "", rows = [];
  for(let a=0;a<P.length;a++) for(const h of H){ const p = P[a], pm = FAULT ? [0.2, 0.5, 1.0][a] : p;
    ST.hBy[nd] = h; ST.roomP[i] = pm*1000 - G.ROOM_P0;
    G.eFlashXA(PT.sats[PT.nodeSat[nd]], nd, i); const x = G.E_RR[G.RR_X];
    const Ts = tsat(p), hf = if97(p, Ts).h, hg = if97r2(p, Ts).h, xt = Math.min(1, Math.max(0, (h - hf)/(hg - hf))), e = Math.abs(x - xt);
    rows.push(h + "@" + p + ": " + x.toFixed(4) + "/" + xt.toFixed(4));
    if(e > worst){ worst = e; at = h + " kJ/kg at " + p + " MPa: " + x.toFixed(4) + " against " + xt.toFixed(4); } }
  ST.hBy[nd] = h0; ST.roomP[i] = p0;
  check("flash split of water let go into a room, on IF97", worst, 0, 0.01,
    "isenthalpic flash: x = (h - h_f(p))/h_fg(p), h_f on IAPWS-IF97 region 1 and h_g on region 2 at T_sat(p) (region 4)",
    {abs:true, unit:"quality", pass:nd >= 0 && worst <= 0.01, note:"worst " + at + "; model/IF97 " + rows.join(", ") + (FAULT ? "; FAULT: the cell read at the next pressure up (0.2, 0.5, 1.0 MPa)" : "")});
}
