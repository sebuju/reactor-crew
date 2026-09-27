"use strict";
// chunks: still fall fall,0.01 dam dam,0.01 deep drain
// inputs: tools/cellular.js
/* The CELLULAR mockup's water (tools/cellular.js) against hydrostatics, free fall, Ritter's dam break and Torricelli. */
const fs = require("fs"), path = require("path");
const {check, load, inBundle, watch, watchNote} = require("./lib.js");
const mode = process.argv[2] || "still", dt = +(process.argv[3] || 0.02);
const G = load(), C = inBundle(fs.readFileSync(path.join(__dirname, "..", "..", "tools", "cellular.js"), "utf8") + "\nCELLR");
const GW = G.GW, GH = G.GH, N = GW*GH, MPC = G.MPC, DEPTH = G.ROOM_DEPTH, g = 9.80665, RHO = 1000, VC = MPC*MPC*DEPTH, FULL = 0.98;
const at = (x, y) => y*GW + x, zBot = y => (GH - y - 1)*MPC, zMid = y => zBot(y) + MPC/2;

/* liner walls: a box's rim less the cells open() names, plus loose cells */
function build(boxes, cells){
  const m = {}, put = (x, y) => { m[x + "," + y] = {m:"liner", t:600}; };
  for(const [x0, x1, y0, y1, open] of boxes){
    const rim = (x, y) => { if(!open || !open(x, y)) put(x, y); };
    for(let x=x0;x<=x1;x++){ rim(x, y0); rim(x, y1); }
    for(let y=y0;y<=y1;y++){ rim(x0, y); rim(x1, y); } }
  for(const [x, y] of cells || []) put(x, y);
  G.D.mat = m; C.build();
}
let ms = 0, steps = 0;
const step = () => { const t0 = process.hrtime.bigint(); C.step(dt); ms += Number(process.hrtime.bigint() - t0)/1e6; steps++; };
const march = o => watch(G, Object.assign({step, dt}, o));
const vol = f => { let k = 0; for(let i=0;i<N;i++) if(!f || f(i)) k += C.w[i]; return k*VC; };
const outOfCell = () => { let k = 0; for(let i=0;i<N;i++) if(C.w[i] > 1 + 1e-12 || C.w[i] < 0) k++; return k; };
const maxAbs = a => { let v = 0; if(!a) return NaN; for(let i=0;i<a.length;i++) v = Math.max(v, Math.abs(a[i])); return v; };
const fastest = () => Math.max(maxAbs(C.fU), C.fV ? maxAbs(C.fV) : 0);
const col = x => { let k = 0; for(let y=0;y<GH;y++) k += C.w[at(x, y)]; return k*MPC; };
const massCheck = (what, v0) => check(what + ", water against what was laid", vol()*RHO, v0*RHO, 1e-9,
  "conservation of mass: nothing enters or leaves the box", {unit:"kg"});
const cost = () => (ms/steps).toFixed(3) + " ms per C.step() over " + steps + " steps";
const HYD = "hydrostatics: a level pool has no pressure gradient to drive it";
const RITTER = "Ritter 1892, Z. Ver. Deutscher Ing. 36(33) 947-954: the ideal dry-bed dam break";

if(mode === "still"){
  /* two rows and a part of water wall to wall in a sealed box: at rest it stays at rest and level, whatever its surface cell holds */
  for(const top of [0.5, 0.8]){
    build([[15, 44, 8, 25]]);
    for(let x=16;x<=43;x++){ C.lay(at(x, 24), 1); C.lay(at(x, 23), 1); C.lay(at(x, 22), top); }
    const v0 = vol(), rows = (2 + top) + " rows";
    march({cap:2});
    let vmax = 0;
    march({cap:8, each:() => { vmax = Math.max(vmax, fastest()); }});
    let lo = Infinity, hi = -Infinity;
    for(let x=16;x<=43;x++){ const z = zBot(24) + col(x); lo = Math.min(lo, z); hi = Math.max(hi, z); }
    check("a pool " + rows + " deep laid at rest stays at rest", vmax, 0, 0.05, HYD, {abs:true, unit:"m/s", note:"fastest face over 8 s after 2 s to settle"});
    check("...and stays level", hi - lo, 0, 0.005, "hydrostatics: a free surface at rest is level", {abs:true, unit:"m"});
    massCheck("the pool " + rows + " deep", v0); }
}

if(mode === "fall"){
  /* a slab one row thick laid at rest high in a sealed box: it falls at g and lands at sqrt(2 h / g) */
  build([[0, GW - 1, 0, GH - 1]]);
  const YS = 6, YF = GH - 2, h = zBot(YS) - zBot(YF);
  for(let x=25;x<=34;x++) C.lay(at(x, YS), 1);
  const v0 = vol(), z0 = zMid(YS);
  const com = () => { let m = 0, z = 0; for(let i=0;i<N;i++){ m += C.w[i]; z += C.w[i]*zMid((i/GW)|0); } return z/m; };
  const landed = () => { let k = 0;
    for(let x=1;x<GW-1;x++) for(let y=YF;y>=1;y--){ const f = C.w[at(x, y)]; k += f; if(f < FULL) break; }
    return k*VC; };
  let d08 = NaN, tLand = NaN, out = 0, vHalf = NaN;
  const W = march({cap:3, each:(k, t) => { out += outOfCell();
    const l = landed();
    if(isNaN(tLand) && l > 1e-3*v0) tLand = t;
    if(isNaN(d08) && t >= 0.8 - dt/2 && !(l > 1e-3*v0)) d08 = z0 - com(); },
    event:t => landed() >= 0.5*v0 ? (vHalf = C.fV ? maxAbs(C.fV) : NaN, "half the water has landed") : ""});
  const tHalf = W.end === "event" ? W.t : NaN, lim = C.L.lim !== undefined ? "; " + C.L.lim + " ticks the limiter left short" : "";
  check("falling water, drop of its centre of mass at 0.8 s", d08, g*0.8*0.8/2, 0.05, "Newton: a body at rest in air falls g t^2/2",
    {unit:"m", note:"dt " + dt + "; first water on the floor (over 1e-3 of it) at " + (isNaN(tLand) ? "-" : tLand.toFixed(2)) + " s" + lim});
  check("falling water, half of it on the floor", tHalf, Math.sqrt(2*h/g), 0.1, "Newton: a fall from rest through h takes sqrt(2 h / g)",
    {unit:"s", note:"h " + h.toFixed(3) + " m, dt " + dt + "; " + W.end + " at " + W.t.toFixed(2) + " s"});
  check("falling water, fastest vertical face as half of it lands", vHalf, Math.sqrt(2*g*h), 0.15, "Newton: a fall from rest through h lands at sqrt(2 g h)",
    {unit:"m/s", note:C.fV ? "dt " + dt : "the mockup states no vertical face speed"});
  check("falling water, cells over full or under empty", out, 0, 0, "a cell holds between none and its own volume", {abs:true, unit:"cell-ticks", note:"slack 1e-12"});
  massCheck("falling water", v0);
}

/* water `rows` deep from x 7 to X1 against a dam face, dry floor to x 36; the front is the farthest column deeper than FR h0 */
const X1 = 15, XR = 36, FLOOR = 24, FR = 0.01;
const ritterH = (x, t, h0) => { const c = Math.sqrt(g*h0); return x < -c*t ? h0 : x > 2*c*t ? 0 : Math.pow(2*c - x/t, 2)/(9*g); };
function dam(rows, cap, each){
  C.reset();
  for(let r=0;r<rows;r++) for(let x=7;x<=X1;x++) C.lay(at(x, FLOOR - r), 1);
  const h0 = rows*MPC, v0 = vol(), hit = [];
  let front = X1;
  march({cap, each:(k, t) => {
    let f = front; for(let x=front+1;x<=XR;x++) if(col(x) > FR*h0) f = x;
    if(f > front){ front = f; hit.push([t, f]); }
    if(each) each(t, front); }});
  const speed = (t0, t1) => { const a = hit.filter(q => q[0] >= t0 && q[0] <= t1); return a.length > 1 ? (a[a.length-1][1] - a[0][1])*MPC/(a[a.length-1][0] - a[0][0]) : NaN; };
  return {h0, c:Math.sqrt(g*h0), v0, speed};
}
if(mode === "dam" || mode === "deep") build([[6, XR + 1, 8, FLOOR + 1]]);

if(mode === "dam"){
  let dm = null, prof = null;
  const D = dam(1, 4.8, (t, front) => {
    if(dm || t < 1 - 1e-9) return;
    dm = {t, h:(col(X1) + col(X1 + 1))/2, u:C.uAt(X1, FLOOR), past:vol(i => i%GW > X1 && i%GW <= XR)*RHO};
    prof = [];
    for(let x=X1-3;x<=Math.min(XR, Math.max(front + 1, X1 + 1 + Math.ceil(2*Math.sqrt(g*MPC)*t/MPC)));x++) prof.push([x, col(x), ritterH((x - X1 - 0.5)*MPC, t, MPC)]); });
  const {h0, c, v0} = D, v1 = D.speed(0.1, 1.2), v2 = D.speed(1.2, 2.4), v4 = D.speed(2.4, 4.8), vt = 2*c - 3*Math.sqrt(g*FR*h0);
  const on = prof.filter(r => r[2] > FR*h0), rms = Math.sqrt(on.reduce((a, r) => a + Math.pow((r[1] - r[2])/h0, 2), 0)/on.length);
  check("dam break, depth profile at 1 s against Ritter's", rms, 0, 0.15, RITTER + ": h = (2 sqrt(g h0) - x/t)^2/(9 g) between -sqrt(g h0) t and 2 sqrt(g h0) t",
    {abs:true, unit:"RMS of h0", note:"dt " + dt + "; x, model m, Ritter m: " + prof.map(r => r[0] + " " + r[1].toFixed(3) + " " + r[2].toFixed(3)).join("; ")});
  check("dam break, depth at the dam line at 1 s", dm.h, 4/9*h0, 0.1, RITTER + ": h = 4/9 h0 at the dam line", {unit:"m"});
  check("dam break, speed at the dam line at 1 s", dm.u, 2/3*c, 0.1, RITTER + ": u = 2/3 sqrt(g h0) at the dam line", {unit:"m/s"});
  check("dam break, mass past the dam line at 1 s", dm.past, RHO*DEPTH*8*c*c*c*dm.t/(27*g), 0.1,
    RITTER + ": the flux at the dam line is 4/9 h0 x 2/3 sqrt(g h0) from the start, so rho D 8 c^3 t / (27 g) has passed", {unit:"kg"});
  check("dam break, the front decelerates", v1 > v2 && v2 > v4 ? 1 : 0, 1, 0, "Whitham 1955, Proc. R. Soc. A 227: friction slows a real front with time",
    {abs:true, unit:"-", note:"over 0.1-1.2 / 1.2-2.4 / 2.4-4.8 s: " + [v1, v2, v4].map(v => (v/c).toFixed(2)).join(" / ") + " sqrt(g h0)"});
  check("dam break, front over its first second, against Ritter's contour at the depth it is detected at", v1, vt, 0.1,
    RITTER + ", the depth-h contour moves at 2 sqrt(g h0) - 3 sqrt(g h)", {unit:"m/s", gap:"water on the floor",
      note:"h0 " + h0.toFixed(3) + " m, one cell; contour " + FR + " h0; " + (v1/c).toFixed(2) + " sqrt(g h0) against " + (vt/c).toFixed(2)});
  check("dam break, front at 2.4-4.8 s, against measured frictional fronts", v4, 1.64*c, 0.061,
    "Dressler 1954 laboratory dam breaks: 1.54-1.74 sqrt(g h0) a few seconds after release", {unit:"m/s", gap:"water on the floor",
      note:(v4/c).toFixed(2) + " sqrt(g h0); band " + (1.54*c).toFixed(2) + "-" + (1.74*c).toFixed(2) + "; " + cost()});
  massCheck("dam break", v0);
}

if(mode === "deep"){
  /* Ritter's solution has no length but h0, so the front goes as sqrt(h0) */
  const v = [1, 2, 3].map(n => dam(n, 1.2).speed(0.1, 1.2)), c1 = Math.sqrt(g*MPC);
  const note = "fronts " + v.map((x, k) => (x/(c1*Math.sqrt(k + 1))).toFixed(2)).join(" / ") + " sqrt(g h0) at 1 / 2 / 3 rows deep";
  for(const n of [2, 3]) check("dam break " + n + " rows deep, front speed over the one-row front", v[n-1]/v[0], Math.sqrt(n), 0.1,
    RITTER + ": the shallow-water solution scales with sqrt(g h0) alone, so the FR h0 contour does too", {unit:"-", note});
}

if(mode === "drain"){
  /* a tank 20 cells wide and 6 rows deep on a floor with a one-cell slot in its middle; a gap in the floor outside it vents the two gas spaces into one */
  const F = 16, TX0 = 20, TX1 = 39, SLOT = 29, VENT = 50, A = 20*MPC*DEPTH, a = MPC*DEPTH;
  const cells = [];
  for(let x=1;x<GW-1;x++) if(x !== SLOT && x !== VENT) cells.push([x, F]);
  for(let y=6;y<F;y++) cells.push([TX0 - 1, y], [TX1 + 1, y]);
  build([[0, GW - 1, 0, GH - 1]], cells);
  for(let y=F-6;y<F;y++) for(let x=TX0;x<=TX1;x++) C.lay(at(x, y), 1);
  const v0 = vol(), inTank = i => i%GW >= TX0 && i%GW <= TX1 && ((i/GW)|0) < F, level = () => vol(inTank)/A;
  const Hs = [], Vs = [], n = Math.round(0.5/dt);
  let win1 = null, win2 = null;
  const rate = k => ({H:Hs[k - (n >> 1)], Q:(Vs[k - n] - Vs[k])/(n*dt)});
  const W = march({cap:30, each:k => { Vs[k] = vol(inTank); Hs[k] = Vs[k]/A;
      if(!win1 && k*dt >= 1 && k >= n) win1 = rate(k);
      if(win1 && !win2 && k >= n && Hs[k - (n >> 1)] <= win1.H/4) win2 = rate(k); },
    event:() => win2 ? "the level has fallen to a quarter" : ""});
  const corr = Math.sqrt(1 - Math.pow(a/A, 2)), lim = C.L.lim !== undefined ? "; " + C.L.lim + " ticks the limiter left short" : "";
  const q1 = win1 ? win1.Q*corr : NaN, q2 = win2 ? win2.Q*corr : NaN, h1 = win1 ? win1.H : NaN, h2 = win2 ? win2.H : NaN;
  check("slot drain, rate at h over rate at h/4", q1/q2, Math.sqrt(h1/h2), 0.1, "Torricelli 1643: the rate through a hole goes as sqrt(h)",
    {unit:"-", note:"h " + h1.toFixed(3) + " / " + h2.toFixed(3) + " m over the tank floor, 0.5 s windows, the first from 1 s; " + watchNote(W)});
  check("slot drain, rate at h against the 2D slot's free streamline", q1, 0.611*a*Math.sqrt(2*g*h1), 0.15,
    "Kirchhoff 1869: a 2D slot's jet contracts to pi/(pi+2) = 0.611 of its width, rate Cc a sqrt(2 g h)",
    {unit:"m3/s", note:"a " + a.toFixed(3) + " m2, approach speed taken out; " + (q1/(a*Math.sqrt(2*g*h1))).toFixed(3) + " a sqrt(2 g h)" + lim + "; " + cost()});
  massCheck("slot drain", v0);
}
