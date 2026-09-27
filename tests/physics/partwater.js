"use strict";
// chunks: still still,0.5 slot drain dam books
// inputs: tools/lumped.js tools/particles.js
/* The PARTICLES mockup's water (tools/particles.js) against hydrostatics, Pascal, Torricelli, Ritter and its own books. */
const fs = require("fs"), path = require("path");
const {check, load, inBundle, watch, watchNote} = require("./lib.js");
const mode = process.argv[2] || "still", ppc = process.argv[3] !== undefined ? +process.argv[3] : NaN, dt = 0.02;
const tool = f => fs.readFileSync(path.join(__dirname, "..", "..", "tools", f), "utf8");
const G = load(), P = inBundle(tool("lumped.js") + "\n" + tool("particles.js") + "\nPART");
const GW = G.GW, GH = G.GH, N = GW*GH, MPC = G.MPC, DEPTH = G.ROOM_DEPTH, g = 9.80665, RHO = 1000, VC = MPC*MPC*DEPTH;
const at = (x, y) => y*GW + x;

function build(boxes, cells){
  const m = {}, put = (x, y) => { m[x + "," + y] = {m:"liner", t:600}; };
  for(const [x0, x1, y0, y1] of boxes){
    for(let x=x0;x<=x1;x++){ put(x, y0); put(x, y1); }
    for(let y=y0;y<=y1;y++){ put(x0, y); put(x1, y); } }
  for(const [x, y] of cells || []) put(x, y);
  G.D.mat = m;
  if(isFinite(ppc)) P.K.ppc = ppc;
  P.build();
}
function pool(x0, x1, y0, y1){
  if(P.lay){ for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) P.lay(at(x, y), 1); return; }
  const s = Math.sqrt(P.K.ppc), w = x1 - x0 + 1, h = y1 - y0 + 1, nx = Math.round(w*s), ny = Math.round(h*s), m = RHO*VC/P.K.ppc;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){ const p = P.L.np++;
    P.kind[p] = 1; P.px[p] = x0 + (i + 0.5)*w/nx; P.py[p] = y0 + (j + 0.5)*h/ny; P.vx[p] = 0; P.vy[p] = 0; P.pm[p] = m; }
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
const INC = "water is incompressible (bulk modulus 2.2 GPa): a submerged cell holds its own volume";
const INCN = "0.1 is the weak compressibility allowed a coarse SPH; judged over blocks of 4 cells, mean over the window, so one particle over its share (6 % at 4 per cell) is grain, not clumping";
/* the worst mean fill of the blocks whose cells all stand below the cell their surface is in; a block is a list of [cell, depth k from the bottom, surface height h] */
function worstBlock(F, blocks){ const w = {f:1, at:"-"};
  for(const [lab, b] of blocks){ if(!b.every(([, k, h]) => k <= Math.ceil(h) - 2)) continue;
    const f = b.reduce((a, [i]) => a + F[i], 0)/b.length; if(Math.abs(f - 1) > Math.abs(w.f - 1)){ w.f = f; w.at = lab; } }
  return w; }
const RITTER = "Ritter 1892, Z. Ver. Deutscher Ing. 36(33) 947-954: the ideal dry-bed dam break";
const tag = () => P.K.ppc + " fine particles per cell" + (P.K.open ? ", open water " + P.K.open + " cells per particle" : "");

if(mode === "still"){
  /* 3 rows of water wall to wall in a sealed box, 28 cells wide */
  build([[15, 44, 8, 25]]);
  pool(16, 43, 22, 24);
  const m0 = water();
  march({cap:2});
  let vmax = 0; const F = meanFill();
  const W = march({cap:8, each:() => { vmax = Math.max(vmax, fastest()); F.add(); }});
  const f = F.get(), hc = [], blocks = [];
  let lo = Infinity, hi = -Infinity;
  for(let x=16;x<=43;x++){ const h = colOf(f, x, 9, 24); hc[x] = h; lo = Math.min(lo, h); hi = Math.max(hi, h); }
  for(let x=16;x<43;x+=2) for(let k=0;k<4;k+=2){ const b = [];
    for(let a=0;a<2;a++) for(let c=0;c<2;c++) b.push([at(x + a, 24 - k - c), k + c, hc[x + a]]);
    blocks.push([x + "-" + (x + 1) + "," + (23 - k) + "-" + (24 - k), b]); }
  const w = worstBlock(f, blocks);
  check("a pool 3 rows deep at " + tag() + ", laid at rest, stays at rest", vmax, 0, 0.05, HYD, {abs:true, unit:"m/s", note:"fastest water particle over 8 s after 2 s to settle; " + watchNote(W)});
  check("...and stays level", hi - lo, 0, 0.25, "hydrostatics: a free surface at rest is level", {abs:true, unit:"cell",
    note:"column heights off the mean fill over 8 s; the quarter cell is the particle grain at the surface"});
  check("...and every 2x2 block below the surface cell holds its own volume", w.f, 1, 0.1, INC, {abs:true, unit:"fill",
    note:"worst at " + w.at + "; " + INCN});
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
  const W = march({cap:30, window:2, sig:[{name:"tank less slot", read:() => tank() - slot(), ref:0, tol:0.25}],
    each:k => { const o = (k % n)*25; ring[o] = fastest(); for(let j=0;j<24;j++) ring[o + 1 + j] = wf(sc[j]); }});
  const m = Math.min(n, W.k); let vmax = 0; const f = new Float64Array(24);
  for(let r=0;r<m;r++){ const o = r*25; vmax = Math.max(vmax, ring[o]); for(let j=0;j<24;j++) f[j] += ring[o + 1 + j]/m; }
  const ht = tank(), hs = f.slice(0, 14).reduce((a, b) => a + b, 0);
  // the slot and the duct are one cell across, so a block is 4 cells along them; the leftover end joins the block before it
  const run = (j0, j1, deep) => { const out = []; for(let j=j0;j<=j1;j+=4){ const e = j1 - j < 6 ? j1 : j + 3, b = [];
      for(let q=j;q<=e;q++) b.push([q, deep ? q : 0, hs]);
      out.push([(j < 14 ? "slot " : "duct ") + (sc[j]%GW) + "," + ((sc[j]/GW)|0) + " to " + (sc[e]%GW) + "," + ((sc[e]/GW)|0), b]); if(e === j1) break; }
    return out; };
  const wb = worstBlock(f, run(0, 13, true).concat(run(14, 23, false))), worst = wb.f, where = wb.at;
  check("communicating vessels at " + tag() + ": tank level against slot level", ht - hs, 0, 0.25,
    "Pascal: connected water at rest under one gas pressure stands at one level", {abs:true, unit:"cell",
      note:"tank " + ht.toFixed(2) + ", slot " + hs.toFixed(2) + " (mean over the last 2 s) cells over the floor; laid " + V.toFixed(1) + " cells, which level at " + ((V - 10)/17).toFixed(2) + "; " + watchNote(W)});
  check("...every 4-cell block of slot and duct below the slot's surface cell holds its own volume", worst, 1, 0.1, INC, {abs:true, unit:"fill", note:"worst " + where + "; " + INCN});
  check("...fastest water particle over the last 2 s", vmax, 0, 0.05, HYD, {abs:true, unit:"m/s"});
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
    drainRig();
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
