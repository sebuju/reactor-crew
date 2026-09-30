"use strict";
// chunks: still still,0.5 slot drain dam books pour step bench full full,9 full,4,1 full,4,2 full,0.5 grad slide slosh yield,0.01 yield,0.03 yield,0.1
// inputs: tools/particles.js
/* The PARTICLES mockup's water (tools/particles.js) against hydrostatics, Pascal, Torricelli, Ritter and its own books. */
const fs = require("fs"), path = require("path");
const {check, load, inBundle, watch, watchNote, sheetF, SHEAR, ulp, fricFault, partSlide} = require("./lib.js");
const mode = process.argv[2] || "still", ppc = mode !== "yield" && process.argv[3] !== undefined ? +process.argv[3] : NaN,
  open = process.argv[4] !== undefined ? +process.argv[4] : NaN, dt = 0.02;
const fa = process.argv.find(a => a === "--fault" || a.startsWith("--fault=")), fault = fa === "--fault" ? "kick" : fa ? fa.slice(8) : "";
const tool = f => fs.readFileSync(path.join(__dirname, "..", "..", "tools", f), "utf8");
const G = load(), P = inBundle(fricFault(tool("particles.js"), fault) + "\nPART");
const sa = process.argv.find(a => a.startsWith("--stiff=")), stiffAsk = sa ? +sa.slice(8) : NaN;
if(isFinite(stiffAsk)) P.K.stiff = stiffAsk;
const GW = G.GW, GH = G.GH, N = GW*GH, MPC = G.MPC, DEPTH = G.ROOM_DEPTH, g = 9.80665, RHO = 1000, VC = MPC*MPC*DEPTH;
const at = (x, y) => y*GW + x;

function build(boxes, cells){
  const m = {}, put = (x, y) => { m[x + "," + y] = {m:"liner", t:600}; };
  for(const [x0, x1, y0, y1] of boxes){
    for(let x=x0;x<=x1;x++){ put(x, y0); put(x, y1); }
    for(let y=y0;y<=y1;y++){ put(x0, y); put(x1, y); } }
  for(const [x, y] of cells || []) put(x, y);
  make(m);
}
function make(m){
  G.D.mat = m;
  if(isFinite(ppc)) P.K.ppc = ppc;
  if(isFinite(open)) P.K.open = open;
  P.build();
}
function pool(x0, x1, y0, y1){
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) P.lay(at(x, y), 1);
}
let ms = 0, steps = 0;
const step = () => { const t0 = process.hrtime.bigint(); P.step(dt); ms += Number(process.hrtime.bigint() - t0)/1e6; steps++; };
const march = o => watch(G, Object.assign({step, dt}, o));
const cost = () => (ms/steps).toFixed(2) + " ms per step over " + steps + " steps, " + nWater() + " water particles";
const nWater = () => { let k = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) k++; return k; };
const water = () => { let m = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) m += P.pm[p]; return m; };
const fastest = () => { let v = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) v = Math.max(v, Math.hypot(P.vx[p], P.vy[p])); return v*MPC; };
const wf = i => P.src.water(i)/(RHO*VC);
const cells = f => { let k = 0; for(let i=0;i<N;i++) if(f(i)) k += wf(i); return k; };
const colOf = (F, x, y0, y1) => { let k = 0; for(let y=y0;y<=y1;y++) k += F[at(x, y)]; return k; };
const massCheck = (what, m0, note) => check(what + ", water against what was laid", water(), m0, 1e-9,
  "conservation of mass: nothing enters or leaves the box", {unit:"kg", note:note || ""});
const perCell = m0 => (nWater()/(m0/(RHO*VC))).toFixed(2) + " water particles per cell of water";
/* the fill a window's steps averaged, so the particle grain does not read as clumping */
function meanFill(){ const s = new Float64Array(N); let n = 0;
  return {add:() => { for(let i=0;i<N;i++) s[i] += wf(i); n++; }, get:() => s.map(v => v/n)}; }
const HYD = "hydrostatics: a pool at rest stays at rest";
/* the free surface by its top particles, as a count of whole particles per column reads their grain: per bin of bw columns from x0,
   the height over floor fy of the highest water particle's centre, NaN for an empty bin */
function tops(x0, n, bw, fy){ const t = new Float64Array(n).fill(NaN);
  for(let p=0;p<P.np;p++){ if(P.kind[p] !== 1) continue; const b = Math.floor((P.px[p] - x0)/bw), h = fy - P.py[p]; if(b >= 0 && b < n && !(h <= t[b])) t[b] = h; }
  return t; }
function topMean(){ const s = [], c = []; return {add:t => t.forEach((v, i) => { if(v === v){ s[i] = (s[i] || 0) + v; c[i] = (c[i] || 0) + 1; } }), get:() => s.map((v, i) => v/c[i])}; }
const INC = "water is incompressible (bulk modulus 2.2 GPa): a submerged cell holds its own volume";
const INCN = "0.1 is the weak compressibility allowed a coarse SPH; judged over blocks of 4 cells, mean over the window, so one particle over its share (6 % at 4 per cell) is grain, not clumping";
/* the worst mean fill of the blocks whose cells all stand below the cell their surface is in; a block is a list of [cell, depth k from the bottom, surface height h] */
function worstBlock(F, blocks){ const w = {f:1, at:"-"};
  for(const [lab, b] of blocks){ if(!b.every(([, k, h]) => k <= Math.ceil(h) - 2)) continue;
    const f = b.reduce((a, [i]) => a + F[i], 0)/b.length; if(Math.abs(f - 1) > Math.abs(w.f - 1)){ w.f = f; w.at = lab; } }
  return w; }
const RITTER = "Ritter 1892, Z. Ver. Deutscher Ing. 36(33) 947-954: the ideal dry-bed dam break";
const tag = () => P.K.ppc + " fine particles per cell" + (P.K.open ? ", open water " + P.K.open + " cells per particle" : "") + (isFinite(stiffAsk) ? ", stiffness " + stiffAsk : "");
const colHeights = (x0, x1, y0, y1) => { const h = new Float64Array(x1 - x0 + 1);
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) h[x - x0] += wf(at(x, y)); return h; };
function levelOf(sum, n, x0, x1){
  const c = x1 - x0 + 1, h = Array.from(sum, s => s/n), mean = h.reduce((a, b) => a + b, 0)/c, xm = (c - 1)/2;
  let dev = 0, sxy = 0, sxx = 0;
  h.forEach((v, k) => { dev = Math.max(dev, Math.abs(v - mean)); sxy += (k - xm)*(v - mean); sxx += (k - xm)*(k - xm); });
  return {h, mean, dev, tilt:sxy/sxx*c};
}
// both level boxes stand on inner floor row 24, whose bottom edge is y 25
const FLOOR = 25;
const mechE = () => { let k = 0, e = 0;
  for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ const u = P.vx[p]*MPC, v = P.vy[p]*MPC, m = P.pm[p];
    k += 0.5*m*(u*u + v*v); e += m*(0.5*(u*u + v*v) + g*(FLOOR - P.py[p])*MPC); }
  return {k, e}; };
/* the strain energy U + W the push is the gradient of, J, for any mix of sizes and liquids: U = sum A Phi(rho) + B near nz (rn - rn0)+^2/2 with Phi' = P and
   A, B = m MPC^2 h^3/(4, 6 pw dts^2), plus the wall's own W (particles.js wallE()); into out per particle; nzFix holds the crowding divisor at given values */
function strainU(out, nzFix, bAsA){
  const n = P.np, D = P.dnA, T = P.wsA, K = P.kind, M = P.pm, PH = P.ph, PW = P.pw, dts = P.DT[1], r0 = P.RHO0, n0 = P.RN0, st = P.K.stiff, pu = P.K.pull, ne = P.K.near;
  let s = 0;
  for(let p=0;p<n;p++){ if(P.LQ[K[p]] !== 1){ if(out) out[p] = 0; continue; }
    const rho = D[2*p] + T[8*p], rn = D[2*p+1] + T[8*p+1], x = rho - r0, nz = nzFix ? nzFix[p] : rho > r0 ? r0/rho : 1, en = Math.max(0, rn - n0);
    const phi = x > 0 ? st*r0*(x - r0*Math.log1p(x/r0)) : 0.5*pu*x*x, c = M[p]*MPC*MPC*PH[p]*PH[p]*PH[p]/(PW[p]*dts*dts);
    P.wallE(T[8*p], T[8*p+1]);
    const u = c*(phi/4 + 0.5*ne*nz*en*en/(bAsA ? 4 : 6) + P.WE[0]); if(out) out[p] = u; s += u; }
  return s;
}
/* the energy of the water, kinetic plus height, stage by stage through sub(): at each tap the velocity the positions imply, (x - ox)/dts,
   and the height at the midpoint of the drift, which symplectic Euler under gravity alone holds exactly */
function ledger(e0){
  const gl = (fault === "g" ? 9.81 : g)*P.K.grav, e = new Float64Array(12000), mx = new Float64Array(12000), my = new Float64Array(12000);
  const S = {grav:0, air:0, visc:0, viscP:0, dragP:0, dragN:0, push:0, repel:0, collP:0, collN:0, capP:0, capN:0, out:0, dU:0, dUout:0, dUg:0, dUp:0, dUr:0, dUc:0, dUsj:0, nsp:0, njo:0};
  // U where no pair list stands: the pairs rebuilt for it, which only reorders the next build's rounding, as everything after sub() bins afresh
  const uNow = () => { P._stage.grid(); P._stage.pairs(); P._stage.wallPass(); return strainU(null); };
  const dUat = k => { const u = uNow(); S[k] += u - r.Ul; r.Ul = u; };
  const win = () => ({lo:Infinity, at:null, tLo:0, rise:0, d:null, t0:0, t1:0});
  const pk = new Float64Array(12000);
  const r = {on:false, gWorst:0, nSub:0, nAir:0, U:0, uMax:0, E6:0, tk:-1, Ul:NaN, sj:0, ns:0, nj:0, jSteps:0, jUp:0, jAt:NaN, bub:false, first:NaN, last:NaN, wT:win(), wM:win(), closed:null, kicked:false, churn:0, cT:[], cS:[], cX:[], cY:[]};
  const track = (w, E) => { if(E < w.lo){ w.lo = E; w.at = Object.assign({}, S); w.tLo = P.L.t; }
    if(E - w.lo > w.rise){ w.rise = E - w.lo; w.d = {}; for(const k in S) w.d[k] = S[k] - w.at[k]; w.t0 = w.tLo; w.t1 = P.L.t; } };
  const eOf = (m, y, u, v, dts) => 0.5*m*(u*u + v*v)*MPC*MPC + m*gl*(FLOOR - (y - 0.5*v*dts))*MPC;
  const eV = p => eOf(P.pm[p], P.py[p], P.vx[p], P.vy[p], P.DT[1]);
  const eX = (p, x, y) => { const dts = P.DT[1]; return eOf(P.pm[p], y, (x - P.ox[p])/dts, (y - P.oy[p])/dts, dts); };
  const eI = p => eX(p, P.px[p], P.py[p]);
  const stage = f => { let s = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ const x = f(p), d = x - e[p]; e[p] = x; s += d; } return s; };
  const water = f => { let s = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) s += f(p); return s; };
  const close = () => { const Em = water(p => e[p]), E = Em + r.U; if(isNaN(r.first)) r.first = E; r.last = E; track(r.wT, E); track(r.wM, Em);
    r.uMax = Math.max(r.uMax, r.U); r.closed = Object.assign({}, S); };
  const tap = k => {
    if(k === 2 && !r.on && P.L.t >= e0 - 1e-9){ r.on = true; stage(eI); r.U = strainU(null); r.Ul = r.U; r.tk = P.L.tick; r.sj = P.L.nsplit + P.L.njoin; r.ns = P.L.nsplit; r.nj = P.L.njoin; close(); return; }
    if(!r.on) return;
    if(k === 0){ let bub = false, E = 0;
      if(P.L.tick !== r.tk){ r.tk = P.L.tick; const u = uNow(), sj = P.L.nsplit + P.L.njoin, dj = P.L.njoin - r.nj, ds = P.L.nsplit - r.ns;
        S.dUout += u - r.Ul; if(sj !== r.sj) S.dUsj += u - r.Ul; S.nsp += ds; S.njo += dj;
        if(dj > 0 && ds === 0){ r.jSteps++; if(u - r.Ul > r.jUp){ r.jUp = u - r.Ul; r.jAt = P.L.t; } }
        r.sj = sj; r.ns = P.L.nsplit; r.nj = P.L.njoin; r.Ul = u; }
      for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ e[p] = eV(p); E += e[p];
        const cx = Math.min(GW - 1, Math.max(0, P.px[p]|0)), cy = Math.min(GH - 1, Math.max(0, P.py[p]|0)); if(P.bubN[cy*GW + cx]) bub = true; }
      if(fault !== "ledger") S.out += E - r.E6; else S.out = 0;
      r.bub = bub; }
    else if(k === 2){ const s = stage(eI), dts = P.DT[1];
      if(r.bub){ S.air += s; r.nAir++; } else { S.grav += s; r.gWorst = Math.max(r.gWorst, Math.abs(s)/water(p => 0.5*P.pm[p]*gl*gl*dts*dts)); }
      r.nSub++; const U = strainU(null); S.dU += U - r.U; S.dUg += U - r.Ul; r.U = U; r.Ul = U; close();
      if(fault === "stage" && !r.kicked && P.L.t >= 20 - 1e-9){ r.kicked = true; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) P.py[p] -= 0.01; } }
    else if(k === 3){ const s = stage(eI); S.visc += s; S.viscP += Math.max(0, s);
      for(let p=0;p<P.np;p++){ mx[p] = P.mvA[2*p]; my[p] = P.mvA[2*p+1]; } }
    else if(k === 4){
      if(fault === "jam" && P.L.t >= 20 - 1e-9){ const wl = P.A.wall;
        for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ const cx = P.px[p]|0, cy = P.py[p]|0; if(cy + 1 < GH && wl[at(cx, cy + 1)]){ P.py[p] += 0.3; my[p] += 0.3; } } }
      for(let p=0;p<P.np;p++){ if(P.kind[p] !== 1) continue;
        const d = eX(p, P.px[p] - mx[p], P.py[p] - my[p]), x = eI(p); if(d > e[p]) S.dragP += d - e[p]; else S.dragN += d - e[p]; S.push += x - d; pk[p] = x - d; e[p] = x; }
      dUat("dUp"); }
    else if(k === 5){ S.repel += stage(eI); dUat("dUr"); }
    else if(k === 6){ let E = 0, c0 = 0, cx = 0, cy = 0;
      for(let p=0;p<P.np;p++){ if(P.kind[p] !== 1) continue;
        const u = eI(p), c = eV(p), j = Math.min(Math.max(0, pk[p]), Math.max(0, e[p] - u)); c0 += j; cx += j*P.px[p]; cy += j*P.py[p];
        if(u > e[p]) S.collP += u - e[p]; else S.collN += u - e[p]; if(c > u) S.capP += c - u; else S.capN += c - u; e[p] = c; E += c; }
      dUat("dUc");
      r.E6 = E; r.churn += c0; r.cT.push(P.L.t); r.cS.push(c0); r.cX.push(cx); r.cY.push(cy); } };
  return {tap, r};
}
/* what carries the weight of water at rest, per substep off the taps, up positive, kg cell, summed from on(): the wall push (tap 4),
   collide (tap 5 to 6), the rest of water() (tap 2 to 4 less the wall) and the weight */
function carry(){
  const y2 = new Float64Array(P.py.length), y5 = new Float64Array(P.py.length), s = {wall:0, coll:0, rest:0, grav:0}, cum = [];
  let on = false;
  const tap = k => { if(!on) return; const n = P.np, K = P.kind, M = P.pm, Y = P.py, D = P.wdA;
    if(k === 2) for(let p=0;p<n;p++){ if(K[p] === 1) y2[p] = Y[p]; }
    else if(k === 4){ const wl = P.A.wall;
      for(let p=0;p<n;p++){ if(K[p] !== 1) continue; let d = D[2*p+1];
        if(fault === "wallhalf"){ const cx = P.px[p]|0, cy = Y[p]|0; if(cy + 1 < GH && wl[at(cx, cy + 1)]){ Y[p] -= 0.5*d; d *= 0.5; } }
        s.wall -= M[p]*d; s.rest -= M[p]*(Y[p] - y2[p] - d); } }
    else if(k === 5) for(let p=0;p<n;p++){ if(K[p] === 1) y5[p] = Y[p]; }
    else if(k === 6){ const dts = P.DT[1];
      for(let p=0;p<n;p++) if(K[p] === 1){ s.coll -= M[p]*(Y[p] - y5[p]); s.grav += M[p]*g*P.K.grav*dts*dts/MPC; } } };
  return {tap, on:() => { on = true; }, mark:() => cum.push(Object.assign({}, s)),
    over:k => { const b = cum[Math.max(0, cum.length - 1 - k)], e = cum[cum.length - 1], o = {}; for(const q in e) o[q] = e[q] - (k >= cum.length ? 0 : b[q]); return o; }};
}
function carryChecks(o, lab){
  const why = fault === "wallhalf" ? "FAULT INJECTED: over the window half the wall push taken back at tap 4 over a floor; " : "";
  check("...the floor and walls carry the weight: (wall push + collide) over the weight, " + lab, (o.wall + o.coll)/o.grav, 1, 0.05, "Newton's third law at rest: the floor and walls carry the whole weight of water at rest",
    {abs:true, unit:"-", note:why + "wall " + (o.wall/o.grav).toFixed(4) + ", collide " + (o.coll/o.grav).toFixed(4) + ", the rest of the push stage (pairs, viscosity, drag) " + (o.rest/o.grav).toFixed(4) + " of the weight"});
  check("...collide carries none of it at rest, " + lab, o.coll/o.grav, 0, 0.02, "a floor holds water at rest by its pressure; an impact guard carries nothing at rest",
    {abs:true, unit:"of the weight", note:why + "collide's ph/8 standoff is the impact guard"});
}
/* a march to o.cap: the mechanical energy's worst rise over its running minimum from o.e0 s, the column heights over the last slosh period 2L/sqrt(g h), the calm time after o.calm0 s */
function settle(o){
  const c = o.x1 - o.x0 + 1, Tsl = 2*c*MPC/Math.sqrt(g*o.hbar*MPC), sum = new Float64Array(c), led = ledger(o.e0);
  let n = 0, k0 = NaN, lo = Infinity, rise = 0, calm = NaN, run = NaN;
  P.tap = led.tap;
  const W = march({cap:o.cap, each:(k, t) => { if(o.each) o.each(k, t);
    if(t >= o.e0 - 1e-9){ const E = mechE(); if(isNaN(k0)) k0 = E.k; lo = Math.min(lo, E.e); rise = Math.max(rise, E.e - lo); }
    if(t > o.cap - Tsl){ const h = colHeights(o.x0, o.x1, o.y0, o.y1); for(let j=0;j<c;j++) sum[j] += h[j]; n++; }
    if(t > o.calm0 && isNaN(calm)){ if(fastest() < 0.05){ if(isNaN(run)) run = t; if(t - run >= 2 - 1e-9) calm = run; } else run = NaN; } }});
  P.tap = null;
  return {W, Tsl, k0, rise, calm, lev:levelOf(sum, n, o.x0, o.x1), led:led.r};
}
function riseCheck(what, r, o, pre){
  check(what + " at " + tag() + ", after it the water's mechanical energy never rises", r.rise, 0, 0.02*r.k0,
    "second law: water with no source loses mechanical energy to viscosity and never gains it", {abs:true, unit:"J",
      note:(pre || "") + "from " + o.e0 + " s; kinetic energy then " + r.k0.toFixed(0) + " J; calm (fastest under 0.05 m/s for 2 s) " + (isNaN(r.calm) ? "never" : "from " + r.calm.toFixed(2) + " s") + "; " + watchNote(r.W)});
  const L = r.led, S = L.closed, J = x => x.toFixed(0);
  const lines = S => "gravity " + S.grav.toExponential(2) + ", air " + J(S.air) + ", viscosity " + J(S.visc) + ", wall drag +" + J(S.dragP) + " " + J(S.dragN) + ", push " + J(S.push) + ", repel " + J(S.repel) +
    ", collide +" + J(S.collP) + " " + J(S.collN) + ", cap +" + J(S.capP) + " " + J(S.capN) + ", outside " + J(S.out) + ", dU " + J(S.dU) + " (gravity's drift " + J(S.dUg) + ", viscosity + push + wall drag " + J(S.dUp) + ", repel " + J(S.dUr) + ", collide + cap " + J(S.dUc) +
    ", outside sub() " + J(S.dUout) + ", " + J(S.dUsj) + " of it over steps that split or joined, " + S.nsp + " splits, " + S.njo + " joins), R = push + dU " + J(S.push + S.dU);
  const winText = (what, w) => !w.d ? what + " never rose over its running minimum" : what + " rose " + J(w.rise) + " J from " + w.t0.toFixed(2) + " to " + w.t1.toFixed(2) + " s: " + lines(w.d);
  const sum = S.grav + S.air + S.visc + S.dragP + S.dragN + S.push + S.repel + S.collP + S.collN + S.capP + S.capN + S.out + S.dU;
  check("...its energy ledger closes stage by stage through sub()", sum - (L.last - L.first), 0, 1e-9*r.k0, "conservation of energy: the lines are differences of one energy at the same taps, so they sum to its change",
    {abs:true, unit:"J", note:"kinetic + height + strain " + J(L.first) + " to " + J(L.last) + " J over " + L.nSub + " substeps (" + L.nAir + " with an air pocket in reach); " + lines(S) +
      "; largest U " + J(L.uMax) + " J; " + winText("kinetic + height (midpoint)", L.wM) + (fault === "ledger" ? "; FAULT INJECTED: the outside line dropped" : "")});
  check("...the gravity stage, worst substep with no air pocket in reach", L.gWorst, 0, 1e-9, "symplectic Euler: under gravity alone kinetic energy plus the height at the drift's midpoint is exact",
    {abs:true, unit:"of 1/2 sum m g^2 dts^2", note:(fault === "g" ? "FAULT INJECTED: the ledger reads g = 9.81; " : "") + (L.nSub - L.nAir) + " substeps judged"});
  const stageNote = fault === "stage" ? "FAULT INJECTED: every water particle moved 0.01 cell up at tap 2 at 20 s; " : "";
  const take = (name, pos, neg, how, gap) => check("...the " + name + " stage takes energy and never gives it: its positive part from " + o.e0 + " s", pos, 0, 1e-6*r.k0,
    "second law: a drag, a fixed wall and a limiter take energy", {abs:true, unit:"J", gap, note:stageNote + how + "; positive " + J(pos) + " J, negative " + J(neg) + " J"});
  take("viscosity", S.viscP, S.visc - S.viscP, "summed per substep over the water, as a pair drag moves energy between its two ends");
  take("wall drag", S.dragP, S.dragN, "summed per particle per substep", "coarse water gains energy");
  take("collide", S.collP, S.collN, "summed per particle per substep", "coarse water gains energy");
  take("speed cap", S.capP, S.capN, "summed per particle per substep");
  let wb = {s:0, t0:0, t1:0, x:0, y:0}; for(let i=0, j=0, s=0, sx=0, sy=0;j<L.cT.length;j++){ s += L.cS[j]; sx += L.cX[j]; sy += L.cY[j];
    while(L.cT[j] - L.cT[i] > 1 + 1e-9){ s -= L.cS[i]; sx -= L.cX[i]; sy -= L.cY[i]; i++; }
    if(s > wb.s) wb = {s, t0:L.cT[i], t1:L.cT[j], x:sx/s, y:sy/s}; }
  check("...the push drives no energy into a wall face that collide takes back: churn from " + o.e0 + " s", L.churn, 0, 0.02*r.k0,
    "a fixed face does no steady work on water: an impact loses energy once, it does not pump it round", {abs:true, unit:"J",
      note:(fault === "jam" ? "FAULT INJECTED: from 20 s every water particle over a wall cell moved 0.3 cell down at tap 4; " : "") + "per water particle per substep min(push gain, collide loss); worst 1 s window " +
        J(wb.s) + " J from " + wb.t0.toFixed(2) + " to " + wb.t1.toFixed(2) + " s" + (wb.s > 0 ? ", centred at cell " + wb.x.toFixed(1) + "," + wb.y.toFixed(1) : "")});
  check("...the strain energy over a step that joined particles and split none never rises: the largest rise", L.jUp, 0, 1e-9*L.uMax, "relabelling water makes no strain energy: a join may only keep or lose it",
    {abs:true, unit:"J", note:(fault === "join0" ? "FAULT INJECTED: no join refused; " : "") + L.jSteps + " such steps from " + o.e0 + " s" + (L.jUp > 0 ? ", the worst at " + L.jAt.toFixed(2) + " s" : "") +
      "; " + P.L.jref + " joins refused over the run; tolerance 1e-9 of the largest U, " + J(L.uMax) + " J"});
  check("...kinetic + height + strain energy never rises over its running minimum", L.wT.rise, 0, 0.02*r.k0, "first law: with no source the energy a squeezable water holds, kinetic + height + strain, never rises",
    {abs:true, unit:"J", gap:"coarse water gains energy", note:(fault === "kick" ? "FAULT INJECTED: 1 m/s up at 20 s; " : "") + "sampled at every substep's density moment; kinetic + height at step ends rose " + J(r.rise) + " J; " + winText("kinetic + height + strain", L.wT)});
}
// the bench's 200 t/s, the last step cut to land tot exactly; true once it is off
const pourTo = (tot, cell) => { const left = tot - P.L.inKg; if(left < 1e-6){ P.off(); return true; } if(left < 200000*dt) P.inject("fluid", left/dt, cell); return false; };
function settleChecks(what, r, o, src, m0){
  const wd = Math.sqrt(P.K.open), lv = r.lev;
  riseCheck(what, r, o);
  check("...its mean surface is level", lv.dev, 0, 0.5*wd, src, {abs:true, unit:"cell",
    note:"worst column off the mean over the last " + r.Tsl.toFixed(1) + " s; mean " + lv.mean.toFixed(2) + " cells; columns " + lv.h.map(v => v.toFixed(2)).join(" ")});
  check("...and not tilted", lv.tilt, 0, 0.25*wd, src + "; a pile holds a slope, water holds none", {abs:true, unit:"cell", note:"least-squares tilt end to end"});
  massCheck(what, m0, cost());
}

if(mode === "still"){
  /* 3 rows of water wall to wall in a sealed box, 28 cells wide */
  build([[15, 44, 8, 25]]);
  pool(16, 43, 22, 24);
  const m0 = water();
  const cr = carry(); P.tap = cr.tap;
  march({cap:20});
  cr.on();
  let vmax = 0; const F = meanFill(), bw = Math.ceil(1/Math.sqrt(P.K.ppc)), nb = Math.floor(28/bw), TM = topMean();
  const W = march({cap:8, each:() => { vmax = Math.max(vmax, fastest()); F.add(); cr.mark(); TM.add(tops(16, nb, bw, FLOOR)); }});
  P.tap = null;
  const f = F.get(), hc = [], blocks = [], tb = TM.get().filter(v => v === v), lo = Math.min(...tb), hi = Math.max(...tb);
  for(let x=16;x<=43;x++) hc[x] = colOf(f, x, 9, 24);
  for(let x=16;x<43;x+=2) for(let k=0;k<4;k+=2){ const b = [];
    for(let a=0;a<2;a++) for(let c=0;c<2;c++) b.push([at(x + a, 24 - k - c), k + c, hc[x + a]]);
    blocks.push([x + "-" + (x + 1) + "," + (23 - k) + "-" + (24 - k), b]); }
  const w = worstBlock(f, blocks);
  check("a pool 3 rows deep at " + tag() + ", laid at rest, stays at rest", vmax, 0, 0.05, HYD, {abs:true, unit:"m/s", note:"fastest water particle over 8 s after 20 s for the lay, which is not hydrostatic, to settle; " + watchNote(W)});
  check("...and stays level", hi - lo, 0, 0.5/Math.sqrt(P.K.ppc), "hydrostatics: a free surface at rest is level", {abs:true, unit:"cell",
    note:"half a particle spacing is what a surface of particles resolves; the top particle's height in each " + bw + "-column bin, mean over 8 s, highest less lowest of " + tb.length + " bins"});
  check("...and every 2x2 block below the surface cell holds its own volume", w.f, 1, Math.max(0.1, 1/(4*P.K.ppc)), INC, {abs:true, unit:"fill",
    note:"worst at " + w.at + "; " + INCN});
  carryChecks(cr.over(Infinity), "over the 8 s");
  massCheck("the pool at rest", m0, perCell(m0) + "; " + cost());
}

if(mode === "slot"){
  /* communicating vessels: a tank and a one-cell slot joined by a one-row duct along the floor, both open to one gas space on top */
  const w = [];
  for(let x=1;x<GW-1;x++) w.push([x, 24]);
  for(let y=10;y<=23;y++) w.push([9, y], [37, y]);
  for(let y=10;y<=22;y++) w.push([26, y], [35, y]);
  for(let x=27;x<=35;x++) w.push([x, 22]);
  build([[0, GW - 1, 0, GH - 1]], w);
  pool(10, 25, 16, 23);
  const m0 = water(), V = m0/(RHO*VC), n = Math.round(2/dt);
  const tank = () => cells(i => i%GW >= 10 && i%GW <= 25 && ((i/GW)|0) <= 23)/16, slot = () => { let k = 0; for(let y=1;y<=23;y++) k += wf(at(36, y)); return k; };
  const ring = new Float64Array(n*25), sc = [];
  for(let y=23;y>=10;y--) sc.push(at(36, y));
  for(let x=26;x<=35;x++) sc.push(at(x, 23));
  const cr = carry(); P.tap = cr.tap; cr.on();
  const tt = [], ts = [], top = t => { let s = 0, k = 0; for(const v of t) if(v === v){ s += v; k++; } return s/k; };
  const W = march({cap:30, window:2, sig:[{name:"tank less slot", read:() => tank() - slot(), ref:0, tol:0.25}],
    each:k => { const o = (k % n)*25; ring[o] = fastest(); for(let j=0;j<24;j++) ring[o + 1 + j] = wf(sc[j]); cr.mark(); tt.push(top(tops(10, 16, 1, 24))); ts.push(tops(36, 1, 1, 24)[0]); }});
  P.tap = null;
  const m = Math.min(n, W.k); let vmax = 0; const f = new Float64Array(24);
  for(let r=0;r<m;r++){ const o = r*25; vmax = Math.max(vmax, ring[o]); for(let j=0;j<24;j++) f[j] += ring[o + 1 + j]/m; }
  const hs = f.slice(0, 14).reduce((a, b) => a + b, 0), ht = top(tt.slice(-m)), hts = top(ts.slice(-m));
  // the slot and the duct are one cell across, so a block is 4 cells along them; the leftover end joins the block before it
  const run = (j0, j1, deep) => { const out = []; for(let j=j0;j<=j1;j+=4){ const e = j1 - j < 6 ? j1 : j + 3, b = [];
      for(let q=j;q<=e;q++) b.push([q, deep ? q : 0, hs]);
      out.push([(j < 14 ? "slot " : "duct ") + (sc[j]%GW) + "," + ((sc[j]/GW)|0) + " to " + (sc[e]%GW) + "," + ((sc[e]/GW)|0), b]); if(e === j1) break; }
    return out; };
  const wb = worstBlock(f, run(0, 13, true).concat(run(14, 23, false))), worst = wb.f, where = wb.at;
  check("communicating vessels at " + tag() + ": tank level against slot level", ht - hts, 0, 0.25,
    "Pascal: connected water at rest under one gas pressure stands at one level", {abs:true, unit:"cell",
      note:"top particles, tank " + ht.toFixed(2) + " (mean of its 16 columns), slot " + hts.toFixed(2) + " (mean over the last 2 s) cells over the floor; by fill the slot holds " + hs.toFixed(2) + "; laid " + V.toFixed(1) + " cells, which level at " + ((V - 10)/17).toFixed(2) + "; " + watchNote(W)});
  check("...every 4-cell block of slot and duct below the slot's surface cell holds its own volume", worst, 1, 0.1, INC, {abs:true, unit:"fill", note:"worst " + where + "; " + INCN});
  check("...fastest water particle over the last 2 s", vmax, 0, 0.05, HYD, {abs:true, unit:"m/s"});
  carryChecks(cr.over(m), "over the last 2 s");
  massCheck("communicating vessels", m0, perCell(m0) + "; " + cost());
}

/* a tank 20 cells wide and 12 rows deep on a floor with a one-cell slot in its middle; a gap in the floor outside it vents the two gas spaces into one */
const F = 20, TX0 = 20, TX1 = 39, SLOT = 29, VENT = 50, A = 20*MPC*DEPTH, a = MPC*DEPTH;
function drainRig(){
  const w = [];
  for(let x=1;x<GW-1;x++) if(x !== SLOT && x !== VENT) w.push([x, F]);
  for(let y=7;y<F;y++) w.push([TX0 - 1, y], [TX1 + 1, y]);
  build([[0, GW - 1, 0, GH - 1]], w);
  pool(TX0, TX1, 8, F - 1);
}
const inTank = i => i%GW >= TX0 && i%GW <= TX1 && ((i/GW)|0) < F;

if(mode === "drain"){
  drainRig();
  const m0 = water(), Hs = [], Vs = [], n = Math.round(0.5/dt);
  let win1 = null, win2 = null;
  const rate = k => ({H:Hs[k - (n >> 1)], Q:(Vs[k - n] - Vs[k])/(n*dt)});
  const W = march({cap:30, each:k => { Vs[k] = cells(inTank)*VC; Hs[k] = Vs[k]/A;
      if(!win1 && k*dt >= 1 && k >= n) win1 = rate(k);
      if(win1 && !win2 && k >= n && Hs[k - (n >> 1)] <= win1.H/4) win2 = rate(k); },
    event:() => win2 ? "the level has fallen to a quarter" : ""});
  const corr = Math.sqrt(1 - Math.pow(a/A, 2));
  const q1 = win1 ? win1.Q*corr : NaN, q2 = win2 ? win2.Q*corr : NaN, h1 = win1 ? win1.H : NaN, h2 = win2 ? win2.H : NaN;
  check("slot drain at " + tag() + ", rate at h over rate at h/4", q1/q2, Math.sqrt(h1/h2), 0.1, "Torricelli 1643: the rate through a hole goes as sqrt(h)",
    {unit:"-", note:"h " + h1.toFixed(3) + " / " + h2.toFixed(3) + " m over the tank floor, 0.5 s windows, the first from 1 s; " + watchNote(W)});
  check("slot drain, rate at h against the 2D slot's free streamline", q1, 0.611*a*Math.sqrt(2*g*h1), 0.15,
    "Kirchhoff 1869: a 2D slot's jet contracts to pi/(pi+2) = 0.611 of its width, rate Cc a sqrt(2 g h)",
    {unit:"m3/s", note:"a " + a.toFixed(3) + " m2, approach speed taken out; " + (q1/(a*Math.sqrt(2*g*h1))).toFixed(3) + " a sqrt(2 g h); " + cost()});
  massCheck("slot drain", m0);
}

if(mode === "dam"){
  /* water 3 rows deep from x 7 to 15 against a dam face, dry floor to x 36 */
  const X1 = 15, XR = 36, FL = 24, h0 = 3*MPC, c = Math.sqrt(g*h0);
  build([[6, XR + 1, 8, FL + 1]]);
  pool(7, X1, FL - 2, FL);
  const m0 = water();
  let dm = null;
  const W = march({cap:1.2, each:(k, t) => { if(dm || t < 1 - 1e-9) return;
    dm = {t, h:(cells(i => i%GW === X1) + cells(i => i%GW === X1 + 1))/2*MPC, past:cells(i => i%GW > X1 && i%GW <= XR)*VC*RHO}; },
    event:() => dm ? "1 s has passed" : ""});
  check("dam break 3 rows deep at " + tag() + ", depth at the dam line at 1 s", dm.h, 4/9*h0, 0.1, RITTER + ": h = 4/9 h0 at the dam line",
    {unit:"m", note:"h0 " + h0.toFixed(3) + " m; " + watchNote(W)});
  check("dam break, mass past the dam line at 1 s", dm.past, RHO*DEPTH*8*c*c*c*dm.t/(27*g), 0.1,
    RITTER + ": the flux at the dam line is 4/9 h0 x 2/3 sqrt(g h0) from the start, so rho D 8 c^3 t / (27 g) has passed", {unit:"kg", note:cost()});
  massCheck("dam break", m0);
}

if(mode === "books"){
  if(!P.L.aerr) check("split and join audit", NaN, 0, 0, "the audit is missing: tools/particles.js has no L.aerr", {abs:true, unit:"-"});
  else {
    // open water coarser than a gap, so the drain crosses levels and splits and joins
    P.K.open = 1; drainRig();
    P.L.audit = true;
    const W = march({cap:10});
    const e = P.L.aerr, note = P.L.nsplit + " splits, " + P.L.njoin + " joins, " + P.L.nref + " splits refused; " + watchNote(W) + "; " + cost();
    check("split and join, mass across the pass", e[0], 0, 1e-12, "conservation of mass", {abs:true, unit:"of the mass", note});
    check("split and join, x momentum across the pass", e[1], 0, 1e-12, "conservation of momentum", {abs:true, unit:"of sum m|v|"});
    check("split and join, y momentum across the pass", e[2], 0, 1e-12, "conservation of momentum", {abs:true, unit:"of sum m|v|"});
    check("split and join, total energy across the pass", e[3], 0, 1e-6,
      "conservation of energy: a join's lost kinetic energy is heat; judged against the kinetic energy, which the thermal would hide 1e5 times over", {abs:true, unit:"of KE"});
    check("split and join both seen", P.L.nsplit > 0 && P.L.njoin > 0 ? 1 : 0, 1, 0, "a conservation check that sees no event checks nothing", {abs:true, unit:"-"});
  }
}

if(mode === "pour"){
  /* 100 cells of water poured in 5 s into an empty box 38 cells wide */
  build([[10, 49, 6, 25]]);
  P.inject("fluid", 100*RHO*VC/5, at(20, 9));
  const o = {cap:45, e0:6, calm0:5, hbar:100/38, x0:11, x1:48, y0:7, y1:24, each:(k, t) => { if(t >= 5 - 1e-9) P.off(); }};
  settleChecks("the pour", settle(o), o, "hydrostatics: the free surface of water at rest is level; averaged over one slosh period 2L/sqrt(g h)", P.L.inKg);
}

if(mode === "step"){
  /* 5 rows left, 3 right, released at rest */
  build([[10, 49, 6, 25]]);
  pool(11, 29, 20, 24); pool(30, 48, 22, 24);
  const m0 = water(), o = {cap:30, e0:0.5, calm0:0, hbar:4, x0:11, x1:48, y0:7, y1:24};
  settleChecks("a two-row step", settle(o), o, "Stoker 1957, Water Waves ch. 10: a step in a wet bed collapses into a bore and a rarefaction and ends level", m0);
}

if(mode === "bench"){
  /* fluidbench as it opens: the sealed room mid-board, 450 t poured at the bench's 200 t/s into cell 54,17 outside it */
  build([[15, 44, 8, 25]]);
  P.inject("fluid", 200000, at(54, 17));
  const n = Math.round(2/dt), M = 12000, X = new Float64Array(n*M), Y = new Float64Array(n*M);
  let off = -1, since = 0, moved = Infinity, ev = -1, rest = -1, worst = Infinity;
  const W = march({cap:150, each:(k, t) => {
      if(off < 0 && pourTo(450000, at(54, 17))) off = t;
      const e = P.L.nsplit + P.L.njoin, o = (k % n)*M;
      if(e !== ev){ ev = e; since = 0; }
      for(let p=0;p<P.np;p++){ X[o + p] = P.px[p]; Y[o + p] = P.py[p]; }
      if(++since <= n || off < 0){ moved = Infinity; return; }
      const b = ((k + 1) % n)*M; let d = 0;
      for(let p=0;p<P.np;p++) if(P.kind[p] === 1) d = Math.max(d, Math.hypot(P.px[p] - X[b + p], P.py[p] - Y[b + p]));
      moved = d;
      if(d >= 0.05){ rest = -1; worst = d; } else if(rest < 0){ rest = t; worst = d; } else worst = Math.max(worst, d); },
    event:t => rest >= 0 && t - rest >= 5 - 1e-9 ? "no water particle moved 0.05 cell in any 2 s for 5 s" : ""});
  check("450 t poured into the bench's default room at " + tag() + ", the water comes to rest: largest move of any particle over 2 s, worst over 5 s", worst, 0, 0.05,
    "hydrostatics: water with no source comes to rest; judged on behaviour, so the time it takes is a reading, not a mark", {abs:true, unit:"cell",
      note:"pour ended at " + off.toFixed(2) + " s; " + watchNote(W) + "; 0.05 cell is " + (0.05*MPC*100).toFixed(1) + " cm, under the particle grain"});
  check("the bench pour, water booked plus what the source holds under one particle, against what was poured", P.src.tot().wat, P.L.inKg, 1e-9,
    "conservation of mass: nothing enters but the pour and nothing leaves the board", {unit:"kg", note:cost()});
}

if(mode === "full"){
  /* 300 t poured at the bench's 200 t/s into an open-topped tank 28 cells wide: trapped air rises out, so nothing gives the water back energy */
  make(P.room("pour").mat);
  P.inject("fluid", 200000, at(22, 10));
  let off = -1;
  const o = {cap:45, e0:2, calm0:2, hbar:12, x0:16, x1:43, y0:3, y1:24, each:(k, t) => { if(off < 0 && pourTo(300000, at(22, 10))) off = t;
    if(fault === "kick" && k === Math.round(20/dt)) for(let p=0;p<P.np;p++) if(P.kind[p] === 1) P.vy[p] -= 1/MPC; }};
  riseCheck("300 t poured into an open-topped room", settle(o), o, (fault === "kick" ? "FAULT INJECTED: every water particle kicked 1 m/s up at 20 s; " : "") + "pour ended at " + off.toFixed(2) + " s; ");
  check("the open-topped pour, water booked plus what the source holds under one particle, against what was poured", P.src.tot().wat, P.L.inKg, 1e-9,
    "conservation of mass: nothing enters but the pour and nothing leaves the board", {unit:"kg", note:cost()});
}

if(mode === "slosh"){
  /* a tank 28 cells long, a third full, its surface laid tilted one row up and down at the ends, released: the first mode's amplitude a1 is
     the projection of the column heights on cos(pi x/L), its extrema taken between crossings of a twentieth of its first reading, the first step binned */
  const X0 = 16, NC = 28, FL = 24, h0 = 16/3, tilt = 1, L = NC*MPC, hm = h0*MPC, k = Math.PI/L, om = Math.sqrt(g*k*Math.tanh(k*hm)), Tp = 2*Math.PI/om;
  build([[X0 - 1, X0 + NC, 8, FL + 1]]);
  for(let i=0;i<NC;i++){ const H = h0 + tilt*(i + 0.5 - NC/2)/(NC/2); for(let y=FL, r=H;r > 1e-9;y--, r--) P.lay(at(X0 + i, y), Math.min(1, r)); }
  const a1 = () => { if(fault === "slosh0") return 0; const h = colHeights(X0, X0 + NC - 1, 9, FL), m = h.reduce((a, b) => a + b, 0)/NC;
    let s = 0; for(let i=0;i<NC;i++) s += (h[i] - m)*Math.cos(Math.PI*(i + 0.5)/NC); return 2*s/NC; };
  const ext = [];
  let A0 = NaN, thr = NaN;
  let sgn = 0, pk = 0, tpk = 0;
  const W = march({cap:Math.ceil(10.5*Tp), each:(n, t) => { const a = a1(); if(n === 1){ A0 = Math.abs(a); thr = A0/20; }
    if(sgn === 0){ if(Math.abs(a) > thr) sgn = Math.sign(a); }
    else if(a*sgn < -thr){ ext.push({A:pk, t:tpk}); sgn = -sgn; pk = 0; }
    if(sgn !== 0 && a*sgn > pk){ pk = a*sgn; tpk = t; } },
    event:() => ext.length >= 21 ? "10 cycles read" : ""});
  const dec = []; for(let i=0;i + 2<ext.length && i < 20;i++) dec.push(Math.log(ext[i].A/ext[i + 2].A));
  const nu = 2.414e-5*Math.pow(10, 247.8/(P.pT[0] - 140))/RHO, sq = Math.sqrt(nu*om/2), s2 = Math.sinh(2*k*hm);
  const aK = sq/L*(1 + (Math.PI - 2*k*hm)/s2), aKB = aK + sq/(DEPTH);
  const last = Math.min(ext.length - 1, 20), aS = ext.length > 2 ? Math.log(ext[0].A/ext[last - (last % 2)].A)/(ext[last - (last % 2)].t - ext[0].t) : NaN;
  const T2 = ext.length > 2 ? 2*(ext[ext.length - 1].t - ext[0].t)/(ext.length - 1) : NaN;
  const minDec = dec.length ? Math.min(...dec) : NaN;
  check("a slosh in a tank a third full at " + tag() + ": the first mode's log decrement every cycle, the least", minDec, 0, 0, "second law: water with no source loses mechanical energy, so a free slosh never grows",
    {abs:true, unit:"-", pass:dec.length >= 2 && minDec > 0, note:(fault === "slosh0" ? "FAULT INJECTED: the surface read as still; " : "") + dec.length + " decrements, ln(A_n/A_n+2) from each extremum while above a twentieth of the first: " + dec.map(v => v.toFixed(3)).join(" ") +
      "; first amplitude " + A0.toFixed(3) + " cell; period " + (isNaN(T2) ? "-" : T2.toFixed(2)) + " s against " + Tp.toFixed(2) + " s by linear theory, sqrt(g k tanh kh); " + watchNote(W) + "; " + cost()});
  check("...its damping rate against Keulegan's, the laminar boundary layers of a clean tank: the least a real tank loses", aS/aK, 1, 0, "Keulegan 1959, J. Fluid Mech. 6, 33-50: Stokes layers on the walls; alpha = sqrt(nu w/2)/L (1 + (pi - 2kh)/sinh 2kh) + sqrt(nu w/2)/B",
    {abs:true, unit:"x Keulegan", pass:aS >= aK, note:"alpha " + aS.toExponential(3) + " /s against " + aK.toExponential(3) + " /s for the room's two-dimensional tank, " + aKB.toExponential(3) + " /s with the room's depth " + DEPTH + " m as its breadth; nu " + nu.toExponential(3) + " m2/s at " + P.pT[0].toFixed(1) + " K (Vogel's fit to IAPWS); a real slosh halves in " + (Math.LN2/aK).toFixed(0) + " s"});
}

if(mode === "grad"){
  /* the pool of still, one step on so the substep is set; one particle probed while every other stands where it is */
  build([[15, 44, 8, 25]]);
  pool(16, 43, 22, 24);
  P.step(dt);
  P.K.visc = 0; P.K.vb = 0; P.K.fric = 0; const sf = /^stiff\d+$/.test(fault) ? +fault.slice(5) : 1; P.K.stiff *= sf;
  const S = P._stage, h = 1e-6, near = P.K.near;
  let n, X0, Y0, ua, ub, nz0, W8, bulk, wet;
  const snap = () => { n = P.np; X0 = Float64Array.from(P.px.subarray(0, n)); Y0 = Float64Array.from(P.py.subarray(0, n)); ua = new Float64Array(n); ub = new Float64Array(n);
    put(0, X0[0], Y0[0]); nz0 = new Float64Array(n); W8 = []; bulk = []; wet = [];
    for(let p=0;p<n;p++){ const rho = P.dnA[2*p] + P.wsA[8*p]; nz0[p] = rho > P.RHO0 ? P.RHO0/rho : 1; W8[p] = Array.from(P.wsA.subarray(8*p, 8*p + 8));
      if(P.LQ[P.kind[p]] !== 1) continue; if(W8[p].every(v => v === 0)) bulk.push(p); else if(W8[p][0] > 0) wet.push(p); } };
  const restore = () => { P.px.set(X0); P.py.set(Y0); };
  const put = (p, x, y) => { restore(); P.px[p] = x; P.py[p] = y; P.L.pbuilt = false; S.grid(); S.pairs(); S.wallPass(); };
  const push = (p, x, y) => { put(p, x, y); S.water(); const d = [P.px[p] - x, P.py[p] - y]; restore(); return d; };
  const gradD = (p, nzFix, bAsA) => { const d = [0, 0], c = P.DT[1]*P.DT[1]/(P.pm[p]*MPC*MPC);
    for(let a=0;a<2;a++){ put(p, X0[p] + (a ? 0 : h), Y0[p] + (a ? h : 0)); strainU(ua, nzFix, bAsA);
      put(p, X0[p] - (a ? 0 : h), Y0[p] - (a ? h : 0)); strainU(ub, nzFix, bAsA);
      let s = 0; for(let k=0;k<n;k++) s += ua[k] - ub[k]; d[a] = -s/(2*h)*c; }
    restore(); return d; };
  const rel = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])/Math.hypot(a[0], a[1]);
  snap();
  const top = (list, k) => list.map(p => [p, Math.hypot(...push(p, X0[p], Y0[p]))]).sort((a, b) => b[1] - a[1]).slice(0, k).map(a => a[0]);
  P.K.near = 0;
  const pb = top(bulk, 4);
  let g1 = 0; for(const p of pb) g1 = Math.max(g1, rel(push(p, X0[p], Y0[p]), gradD(p, null, false)));
  check("the particle water's push on a bulk particle against -dU/dx, near push off", g1, 0, 1e-5, "a pressure from an equation of state is the gradient of its strain energy",
    {abs:true, unit:"relative", note:"worst of the " + pb.length + " bulk particles pushed hardest; central difference, step 1e-6 cell; U = sum A Phi(rho), A = m MPC^2 h^3/(4 pw dts^2)"});
  P.K.near = near;
  let g2 = 0, g2l = 0; for(const p of pb){ const d = push(p, X0[p], Y0[p]); g2 = Math.max(g2, rel(d, gradD(p, nz0, fault === "B"))); g2l = Math.max(g2l, rel(d, gradD(p, null, false))); }
  check("...near push on, against -dU/dx with the crowding divisor held", g2, 0, 1e-5, "a pressure from an equation of state is the gradient of its strain energy",
    {abs:true, unit:"relative", note:(fault === "B" ? "FAULT INJECTED: B taken as A; " : "") + "B = m MPC^2 h^3/(6 pw dts^2); against -dU/dx with nz = rho0/rho live, " + g2l.toExponential(3) + " relative: the crowding divisor on the near push"});
  const loop = p => { const x = X0[p], y = Y0[p], r = 0.02, N = 256; let w = 0, f = 0;
    for(let i=0;i<N;i++){ const a0 = 2*Math.PI*i/N, a1 = 2*Math.PI*(i + 1)/N, xa = x + r*Math.cos(a0), ya = y + r*Math.sin(a0), xb = x + r*Math.cos(a1), yb = y + r*Math.sin(a1);
      const d = push(p, (xa + xb)/2, (ya + yb)/2), s = Math.hypot(d[0], d[1]);
      if(fault === "curl"){ const am = (a0 + a1)/2; d[0] -= 0.01*s*Math.sin(am); d[1] += 0.01*s*Math.cos(am); }
      w += d[0]*(xb - xa) + d[1]*(yb - ya); f += s; }
    return {w, ref:f/N*2*Math.PI*r}; };
  const curl = fault === "curl" ? "FAULT INJECTED: a curl field of 1 % of the push added; " : "";
  const lb = loop(pb[0]);
  check("...the push's work round a closed circle, bulk particle", Math.abs(lb.w)/lb.ref, 0, 1e-4, "a conservative force does no net work round a closed path",
    {abs:true, unit:"of |f| 2 pi r", note:curl + "radius 0.02 cell, 256 chord midpoints; near push on"});
  const pw = wet.reduce((a, p) => W8[p][0] > W8[a][0] ? p : a, wet[0]), lw = loop(pw);
  const dw = push(pw, X0[pw], Y0[pw]);
  check("...the particle deepest in the wall, against -d(U + W)/dx with the crowding divisor held", rel(dw, gradD(pw, nz0, false)), 0, 1e-5, "a pressure from an equation of state is the gradient of its strain energy",
    {abs:true, unit:"relative", note:"fill of the wall " + W8[pw][0].toFixed(3) + "; push " + dw.map(v => v.toExponential(3)).join(", ") + " cell, so the sign is judged too, as the loop cannot"});
  check("...the same for a particle within a kernel of the floor", Math.abs(lw.w)/lw.ref, 0, 1e-4, "a conservative force does no net work round a closed path",
    {abs:true, unit:"of |f| 2 pi r", note:curl + "the particle deepest in the wall, fill of the wall " + W8[pw][0].toFixed(3) + " at " + X0[pw].toFixed(2) + "," + Y0[pw].toFixed(2)});
  const tab = (p, x, y) => { P.px[p] = x; P.py[p] = y; S.wallSum(p, Math.min(GW - 1, Math.max(0, X0[p]|0)), Math.min(GH - 1, Math.max(0, Y0[p]|0)));
    const t = [P.wsA[8*p], P.wsA[8*p+1]]; P.px[p] = X0[p]; P.py[p] = Y0[p]; return t; };
  const rows = [];
  for(const p of wet) for(let a=0;a<2;a++){ const tp = tab(p, X0[p] + (a ? 0 : h), Y0[p] + (a ? h : 0)), tm = tab(p, X0[p] - (a ? 0 : h), Y0[p] - (a ? h : 0));
    rows.push({d0:(tp[0] - tm[0])/(2*h), d1:(tp[1] - tm[1])/(2*h), w0:W8[p][4 + a], w1:W8[p][6 + a]}); }
  const worst = (d, w) => { const m = Math.max(...rows.map(q => Math.abs(q[d]))), use = rows.filter(q => Math.abs(q[d]) > 0.1*m);
    return {n:use.length, worst:Math.max(...use.map(q => Math.abs(q[w]/q[d] - 1)))}; };
  const s0 = worst("d0", "w0"), s1 = worst("d1", "w1");
  check("...the wall push's gradient of the fill against the central difference of the fill", Math.max(s0.worst, s1.worst), 0, 1e-5, "a gradient of a table is the gradient of what it tabulates",
    {abs:true, unit:"relative", note:"worst over " + s0.n + " and " + s1.n + " probes, density and near density: " + s0.worst.toExponential(2) + ", " + s1.worst.toExponential(2) + "; step 1e-6 cell, probes with a gradient over a tenth of the largest"});
  const gain = p => { const ya = push(p, X0[p], Y0[p] + h)[1], wa = P.wdA[2*p+1], yb = push(p, X0[p], Y0[p] - h)[1], wb = P.wdA[2*p+1];
    return [-(ya - yb)/(2*h), -(wa - wb)/(2*h)]; };
  const kw = gain(pw), kb = gain(pb[0]);
  check("...the first row's gain k = -d(push_y)/dy, the particle deepest in the wall alone", kw[0], 0.5, 0.5, "an explicit update x <- x - k (x - x*) closes on x* without overshoot only for 0 < k < 1, and diverges past 2",
    {abs:true, unit:"-", pass:kw[0] > 0 && kw[0] < 1, note:(sf !== 1 ? "FAULT INJECTED: stiffness " + sf + " times; " : "") + "the wall term alone " + kw[1].toFixed(4) + "; the bulk particle pushed hardest " + kb[0].toFixed(4) + "; central difference, step 1e-6 cell, every other particle held; W's g0 " + P.WR.g0.toFixed(4) + ", g1 " + P.WR.g1.toFixed(4) + ", L0 " + P.WR.L0.toFixed(4) + ", L1 " + P.WR.L1.toFixed(4)});
  const yl = 25 - 0.5/Math.sqrt(P.K.ppc), q = pb[0], fl = [];
  for(const x of [29.5, 30, 30.5]){ P.px[q] = x; P.py[q] = yl; S.wallSum(q, x|0, 24); fl.push([P.wsA[8*q], P.wsA[8*q+5], P.wsA[8*q+7]]); }
  P.px[q] = X0[q]; P.py[q] = Y0[q];
  const fw = Math.max(...fl.map(v => Math.max(Math.abs(v[1]/P.WR.gc0 - 1), Math.abs(v[2]/P.WR.gc1 - 1))));
  check("...the wall table's slope of the fill at the first row over a flat floor, against the continuum's", fw, 0, 0.01, "the fill is the kernel integrated over the wall: its slope as the face moves is the kernel's integral along the face line",
    {abs:true, unit:"relative", note:"worst of density and near density at 3 points mid-span, S0/2 off the floor; table fill " + fl[0][0].toFixed(4) + " against " + P.WR.T0.toFixed(4) + "; slopes " + fl.map(v => v[1].toFixed(4)).join(" ") + " against gc0 " + P.WR.gc0.toFixed(4) + "; 1 % is the table's 1/8-cell grid"});

  /* two sizes and two liquids in one pool at 9 fine particles per cell, open water 0.25, at rest: in a third of the cells two pairs laid
     as one particle each, in another third sodium at water's volume */
  P.K.ppc = 9; P.K.open = 0.25; build([[15, 44, 8, 25]]); pool(16, 43, 18, 24);
  const m0 = P.pm[0], rNa = P.A.MF[1], lvs = new Set();
  for(let y=18;y<=24;y++) for(let x=16;x<=43;x++){ const c = (x + y)%3, ps = []; lvs.add(P.lv[at(x, y)]);
    for(let p=0;p<P.np;p++) if(P.kind[p] === 1 && (P.px[p]|0) === x && (P.py[p]|0) === y) ps.push(p);
    if(c === 1) for(let i=0;i + 2<ps.length;i+=2){ const a = ps[i], b = ps[i + 1]; P.px[b] = (P.px[a] + P.px[b])/2; P.py[b] = (P.py[a] + P.py[b])/2; P.pm[b] += P.pm[a]; P.kind[a] = 0; }
    if(c === 2) for(const p of ps){ P.kind[p] = 5; P.pvf[p] = RHO/rNa; P.pm[p] = m0*rNa/RHO; } }
  S.derive(); snap();
  const cls = p => P.kind[p] === 5 ? 2 : P.pm[p] > 1.5*m0 ? 1 : 0, CLS = ["water", "water laid two as one", "sodium"];
  const mixed = p => { for(let j=0;j<n;j++){ if(j === p || P.LQ[P.kind[j]] !== 1 || cls(j) === cls(p)) continue;
    const r = Math.hypot(X0[j] - X0[p], Y0[j] - Y0[p]); if(r < 0.5*(P.ph[p] + P.ph[j])) return true; } return false; };
  const pm3 = [0, 1, 2].map(k => top(bulk.filter(p => cls(p) === k && mixed(p)), 1)[0]);
  const cnt = [0, 1, 2].map(k => bulk.filter(p => cls(p) === k).length);
  const mixNote = "bulk particles " + CLS.map((s, k) => s + " " + cnt[k] + " (h " + P.ph[pm3[k]].toFixed(3) + " cell)").join(", ") + "; levels in the pool " + [...lvs].join(", ");
  const gm = pm3.map(p => rel(push(p, X0[p], Y0[p]), gradD(p, nz0, false)));
  check("mixed sizes and liquids: the push on the particle of each kind pushed hardest with another kind in its kernel, against -dU/dx, nz held", Math.max(...gm), 0, 1e-5,
    "a pressure from an equation of state is the gradient of its strain energy", {abs:true, unit:"relative", note:CLS.map((s, k) => s + " " + gm[k].toExponential(3)).join(", ") + "; " + mixNote});
  const lw0 = p => { const l = loop(p); return Math.abs(l.w)/l.ref; }, ln = pm3.map(lw0);
  P.K.near = 0; const lm = pm3.map(lw0); P.K.near = near;
  check("...the push's work round a closed circle, near push off", Math.max(...lm), 0, 1e-4, "a conservative force does no net work round a closed path",
    {abs:true, unit:"of |f| 2 pi r", note:curl + CLS.map((s, k) => s + " " + lm[k].toExponential(3)).join(", ") + "; radius 0.02 cell, 256 chord midpoints; near push on, with its crowding divisor live: " +
      ln.map(v => v.toExponential(3)).join(", ")});
  put(0, X0[0], Y0[0]); S.water();
  let mx = 0, my = 0, ma = 0;
  for(let p=0;p<n;p++){ if(P.LQ[P.kind[p]] !== 1) continue; const dx = P.px[p] - X0[p] - P.wdA[2*p], dy = P.py[p] - Y0[p] - P.wdA[2*p+1];
    mx += P.pm[p]*dx; my += P.pm[p]*dy; ma += P.pm[p]*Math.hypot(dx, dy); }
  restore();
  check("...one substep's pair pushes, sum of m dx over the pool", Math.hypot(mx, my)/ma, 0, 1e-12, "conservation of momentum: pair forces are equal and opposite",
    {abs:true, unit:"of sum m |dx|", note:"the wall's push taken off each particle; the pool at rest, so no viscous or shear impulse"});
  /* a join priced by joinDU() against U summed afresh before and after the same join done by hand: bulk water, water by the floor, sodium */
  const M0 = Float64Array.from(P.pm.subarray(0, n)), K0 = Uint8Array.from(P.kind.subarray(0, n)), cu = MPC*MPC/(P.DT[1]*P.DT[1]);
  const mate = p => { let b = -1, d = P.ph[p]*P.ph[p]; for(let j=0;j<n;j++){ if(j === p || P.kind[j] !== P.kind[p]) continue; const r = (X0[j] - X0[p])**2 + (Y0[j] - Y0[p])**2; if(r < d){ d = r; b = j; } } return b; };
  const jd = [pm3[0], wet.find(p => P.kind[p] === 1 && W8[p][0] > 0.2), pm3[2]].map(p => { const j = mate(p);
    put(0, X0[0], Y0[0]); const u0 = strainU(null), du = S.joinDU(p, j)*cu, a = P.pm[p], b = P.pm[j], s = a + b;
    if(P.kind[p] !== 1) P.pvf[j] = (P.pvf[j]*b + P.pvf[p]*a)/s;
    P.px[j] = (X0[j]*b + X0[p]*a)/s; P.py[j] = (Y0[j]*b + Y0[p]*a)/s; P.pm[j] = s; P.kind[p] = 0; S.derive(); P.L.pbuilt = false; S.grid(); S.pairs(); S.wallPass();
    const got = strainU(null) - u0; P.pm.set(M0); P.kind.set(K0); P.pvf[j] = P.pvf[p]; restore(); S.derive();
    return {r:Math.abs(du - got)/Math.abs(got), du, got}; });
  check("...a join's change in U as joinDU() prices it, against U summed before and after the join", Math.max(...jd.map(v => v.r)), 0, 1e-9, "the change of a sum is the sum of the changes of its terms",
    {abs:true, unit:"relative", note:["bulk water", "water by the floor", "sodium"].map((s, k) => s + " " + jd[k].du.toExponential(4) + " J against " + jd[k].got.toExponential(4) + " (" + jd[k].r.toExponential(2) + ")").join(", ")});
}

if(mode === "slide"){
  /* water sliding along every kind of wall face: one particle along a floor, a ceiling, both side walls, a machine's skin and concrete, one
     out of the push's reach, one falling beside a wall; then a sheet on a floor and a full duct. The truth reads the liquid's own state */
  const u0 = 0.5, EPS_ST = 4.5e-5, EPS_CO = 1e-3, CW = 4190, vogel = T => 2.414e-5*Math.pow(10, 247.8/(T - 140));
  const FN = {fric0:"off", fric2:"doubled", fricE:"unheated", fricW:"on floors and ceilings only", fricR:"untested for touch"}[fault];
  const fn = FN ? "FAULT INJECTED: the wall shear " + FN + "; " : "";
  const MOODY = "; roughness Moody 1944, commercial steel 0.045 mm, concrete 0.3-3 mm (1 mm); water's mu Vogel, 2.414e-5 10^(247.8/(T - 140)) Pa s";
  const liner = (x0, x1, y0, y1, floor, extra) => { const m = {}, put = (x, y, k) => { m[x + "," + y] = {m:k || "liner", t:600}; };
    for(let x=x0;x<=x1;x++){ put(x, y0); put(x, y1, floor); } for(let y=y0;y<y1;y++){ put(x0, y); put(x1, y); }
    for(const [x, y] of extra || []) put(x, y); return m; };
  const rigUp = (m, parts, grav) => { G.D.mat = m; G.dTouch(); P.parts(parts || []); P.K.grav = grav; P.K.fric = 1;
    if(isFinite(ppc)) P.K.ppc = ppc; if(isFinite(open)) P.K.open = open; P.build(); };
  const one = (x, y, f) => { P.lay(at(x, y), (f || 1)/P.K.ppc); return P.np - 1; };
  const block = []; for(let y=20;y<=24;y++) for(let x=10;x<=49;x++) block.push(at(x, y));
  const cases = [
    {what:"a water particle sliding along a liner floor", box:[1, 58, 8, 25], at:[29, 24], ax:0, grav:1, u0},
    {what:"a water particle sliding along a liner ceiling, gravity off", box:[1, 58, 8, 25], at:[29, 9], ax:0, grav:0, u0},
    {what:"a water particle sliding up a liner left wall, gravity off", box:[1, 58, 0, 33], at:[2, 20], ax:1, grav:0, u0:-u0},
    {what:"a water particle sliding down a liner right wall, gravity off", box:[1, 58, 0, 33], at:[57, 12], ax:1, grav:0, u0},
    {what:"a water particle sliding along a machine's skin", box:[1, 58, 8, 25], parts:[{kind:"machine", cells:block}], at:[29, 19], ax:0, grav:1, u0, lo:13, hi:47},
    {what:"a water particle sliding along a lined-concrete floor", box:[1, 58, 8, 25], floor:"lined", at:[29, 24], ax:0, grav:1, u0, eps:EPS_CO}];
  for(const c of cases){ const [x0, x1, y0, y1] = c.box;
    rigUp(liner(x0, x1, y0, y1, c.floor), c.parts, c.grav); const q = one(...c.at);
    march({cap:1});
    const lo = c.lo ?? (c.ax ? y0 + 4 : x0 + 4), hi = c.hi ?? (c.ax ? y1 - 3 : x1 - 3), pos = () => c.ax ? P.py[q] : P.px[q], V = () => c.ax ? P.vy : P.vx;
    partSlide(G, P, {q, ax:c.ax, u0:c.u0, a:0, dt, cap:60, step, eps:c.eps ?? EPS_ST, mu:vogel, what:c.what + " at " + tag(), note:fn + "given " + c.u0 + " m/s after 1 s at rest" + MOODY + "; ",
      stop:() => pos() < lo || pos() > hi ? "within 3 cells of the face's end" : Math.abs(V()[q]*MPC) < 0.05*u0 ? "slowed to 5 % of u0" : ""}); }
  {
    rigUp(liner(1, 58, 0, 33), null, 0); const q = one(2, 20, 0.25); P.px[q] = 2.8;
    march({cap:1}); P.vy[q] = u0/MPC; const W = march({cap:2});
    check("a water particle a side wall's push does not reach, given " + u0 + " m/s along it at " + tag() + ", gravity off: its speed after 2 s over u0", Math.abs(P.vy[q]*MPC)/u0, 1, 1e-9,
      "a wall shears only what touches it", {abs:true, unit:"-", note:fn + "kernel " + P.ph[q].toFixed(3) + " cell, " + (P.px[q] - 2).toFixed(3) + " cell off the face; " + watchNote(W)});
  }
  {
    rigUp(liner(1, 58, 0, 33), null, 0); const q = one(2, 3);
    march({cap:1}); P.K.grav = 1;
    partSlide(G, P, {q, ax:1, u0:0, a:g*P.K.grav, dt, cap:1, step, eps:EPS_ST, mu:vogel, what:"a water particle falling beside a liner wall at " + tag(), note:fn + "held 1 s with gravity off, then let fall" + MOODY + "; "});
  }
  const solidAt = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH || P.A.wall[at(x, y)] === 1;
  /* the shear impulse this substep, kg m/s along x, off the check's own face runs: per column of open cells its ceiling and floor, each taking
     the water nearer it than the column's middle, wet where a water particle in the face's cell lies within its kernel of the face */
  function impulse(){ const R = new Map(), get = k => R.get(k) || (R.set(k, {M:0, V:0, P:0, U:0, t:0}), R.get(k)), dts = P.DT[1];
    for(let p=0;p<P.np;p++){ if(P.kind[p] !== 1) continue; const x = P.px[p], y = P.py[p], cx = Math.floor(x), cy = Math.floor(y);
      let a = cy, b = cy; while(!solidAt(cx, a - 1)) a--; while(!solidAt(cx, b + 1)) b++;
      const m = P.pm[p], v = m*P.pvf[p]/RHO, r = get(cx + "," + a + "," + (y < (a + b + 1)/2 ? 0 : 1)), fp = Math.sqrt(v/DEPTH);
      r.M += m; r.V += v; r.P += m*P.vx[p]*MPC; r.U += m*vogel(P.pT[p]);
      if(cy === a && y - cy < P.ph[p]) get(cx + "," + a + ",0").t += fp;
      if(cy === b && cy + 1 - y < P.ph[p]) get(cx + "," + a + ",1").t += fp; }
    let J = 0, wet = 0;
    for(const r of R.values()){ if(!(r.t > 0 && r.M > 0)) continue; wet++;
      const A = MPC*DEPTH*Math.min(1, r.t/MPC), h = r.V/A, u = r.P/r.M, rho = r.M/r.V, f = sheetF(rho*Math.abs(u)*4*h/(r.U/r.M), EPS_ST/(4*h));
      J -= f/8*rho*u*Math.abs(u)*A*dts; }
    return {J, wet}; }
  const mom = () => { let s = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) s += P.pm[p]*P.vx[p]*MPC; return s; };
  function slab(what, m, cells, frac){
    rigUp(m, null, 1); for(const [x, y] of cells) P.lay(at(x, y), frac);
    march({cap:1});
    for(let p=0;p<P.np;p++) if(P.kind[p] === 1) P.vx[p] = u0/MPC;
    const p0 = mom(), b0 = P.BK[P.BI.FRQ], e3 = new Float64Array(P.pT.length), v3 = new Float64Array(P.pT.length), nj = P.L.njoin + P.L.nsplit;
    let J = 0, wet = 0, sub = 0, heat = 0, ke = 0, fl = 0, x3 = 0, st = 0;
    const mx = () => { let s = 0; for(let p=0;p<P.np;p++) if(P.kind[p] === 1) s += P.pm[p]*P.px[p]; return s; };
    P.tap = k => { if(k === 3){ const r = impulse(); J += r.J; wet += r.wet; sub++; x3 = mx();
        for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ e3[p] = P.pT[p]*P.pm[p]*CW; v3[p] = P.vx[p]*MPC; } }
      else if(k === 4){ st += (mx() - x3)/P.DT[1]*MPC;
        for(let p=0;p<P.np;p++) if(P.kind[p] === 1){ const e = P.pT[p]*P.pm[p]*CW, v = P.vx[p]*MPC; heat += e - e3[p]; ke += 0.5*P.pm[p]*(v3[p]*v3[p] - v*v); fl += 2*ulp(e); } } };
    const W = march({cap:0.5}); P.tap = null;
    const t = W.t, book = P.BK[P.BI.FRQ] - b0, ev = P.L.njoin + P.L.nsplit - nj;
    // judged on the stage the shear acts in: the air's push on the water's two ends (gasPush()) is a second force along the faces in a duct
    check(what + " at " + tag() + ", given " + u0 + " m/s: the rate its momentum along the faces changes in water()'s wall stage (taps 3 to 4) over " + t.toFixed(2) + " s", st/t, J/t, 0.01,
      "Newton's second law: in that stage the wall shear is the only force along the faces (pair pushes sum to zero, the wall drag acts along the normal); " + SHEAR, {unit:"N",
        note:fn + "shear read off the water at every substep by the check's own face runs, each face taking the water nearer it than its column's middle; " + (wet/sub).toFixed(1) + " wet faces a substep; over the whole step " + ((mom() - p0)/t).toFixed(3) + " N, the rest of it from outside the stage; " + ev + " splits and joins" + MOODY + "; " + watchNote(W)});
    check("...heat gained and heat booked against the kinetic energy the shear took", Math.max(Math.abs(heat - ke), Math.abs(book - ke)), 0, 1e-9*Math.abs(ke) + fl,
      "first law: the energy a wall's shear takes stays in the liquid as heat", {abs:true, unit:"J",
        note:"kinetic energy along x taken between taps 3 and 4 " + ke.toExponential(6) + " J, heat " + heat.toExponential(6) + ", booked " + book.toExponential(6) + "; the tolerance adds the rounding floor of the stored heat, " + fl.toExponential(2) + " J; " + cost()});
  }
  const row = []; for(let x=23;x<=34;x++) row.push([x, 24]);
  slab("a sheet of water one particle deep and 12 cells long on a liner floor", liner(1, 58, 8, 25), row, 0.5);
  // the lid stops 2 cells short of each end, so the air the water is laid over leaves into one pocket: laid in a sealed duct it went to one side, a bar over the other
  const duct = [], lid = []; for(let x=20;x<=39;x++) duct.push([x, 23], [x, 24]); for(let x=4;x<=55;x++) lid.push([x, 22]);
  slab("water filling a duct 2 cells high over 20 of its 52 cells, open at both ends", liner(1, 58, 8, 25, null, lid), duct, 1);
}

if(mode === "yield"){
  /* the grad pool's box, water 5 rows deep, 20 s to rest; then a steady sideways acceleration a on every water particle for 20 s, the
     column heights averaged over the last period of the first slosh mode, so a slosh about the new level reads as its mean */
  const a = +process.argv[3], aw = fault === "yield0" ? 0 : a, X0 = 16, NC = 28, D0 = 5, L = NC*MPC, k = Math.PI/L, Tp = 2*Math.PI/Math.sqrt(g*k*Math.tanh(k*D0*MPC));
  build([[15, 44, 8, 25]]);
  pool(X0, X0 + NC - 1, 25 - D0, 24);
  const read = (cap, kick) => { const sum = new Float64Array(NC); let n = 0;
    const W = march({cap, each:(s, t) => { if(kick) for(let p=0;p<P.np;p++) if(P.kind[p] === 1) P.vx[p] += kick*g*dt/MPC;
      if(t > cap - Tp){ const h = colHeights(X0, X0 + NC - 1, 9, 24); for(let j=0;j<NC;j++) sum[j] += h[j]; n++; } }});
    const l = levelOf(sum, n, X0, X0 + NC - 1); return {slope:l.tilt/NC, dev:l.dev, W}; };
  const rest = read(20, 0), on = read(20, aw);
  check("water " + D0 + " rows deep at rest, then " + a + " g sideways for 20 s: its surface's slope against a/g", on.slope, a, 0.5, "d'Alembert: a liquid has no shear strength, so its free surface settles normal to the effective gravity, slope a/g for any a > 0",
    {unit:"-", note:(fault === "yield0" ? "FAULT INJECTED: a applied as 0; " : "") + "least squares over " + NC + " columns, each averaged over the last " + Tp.toFixed(2) + " s (the first mode's period by linear theory); within half of a/g, a surface read to the particle grain; slope at rest " +
      rest.slope.toExponential(2) + ", its largest column off the mean " + rest.dev.toFixed(3) + " cell; under a " + on.dev.toFixed(3) + " cell; fastest water at the end " + fastest().toFixed(3) + " m/s; " + tag() + "; " + watchNote(on.W) + "; " + cost()});
}
