"use strict";
// chunks: dam deep still load
/* Water on the floor against the dam break's published solution and measurements, and a pool at rest. */
const {check, commissionPreset, if97, watch} = require("./lib.js");
const mode = process.argv[2] || "dam";
const G = commissionPreset(mode === "load" ? 3 : 0), s = G.ST, GW = G.GW, N = GW*G.GH, MPC = G.MPC, g = 9.80665;
s.sc[G.SC_DICEOFF] = 1;
G.eLqBind();
// the containment the rigs stand in: its floor row and right-hand wall on the board commissioned
const RHO = 1/if97(0.1013, 293).v, q = G.E_LQ[0], at = (x, y) => y*GW + x, cap = RHO*G.ROOM_VCELL, FLOOR = mode === "load" ? 36 : 37, XR = mode === "load" ? 48 : 36;
const wTot = () => { let k = 0; for(let i=0;i<N;i++) k += s.roomWater[i]; return k; };
/* everything at rest, the gas a laid liquid displaced spread over the room at one pressure */
function still(){
  s.roomWU.fill(0); s.roomWV.fill(0); s.roomPU.fill(0); s.roomPV.fill(0); s.gsDisp.fill(0);
  for(const F of [s.roomM, s.roomH2, s.roomO2, s.roomVap]){ let t = 0, v = 0;
    for(let y=1;y<=FLOOR;y++) for(let x=7;x<=XR;x++){ const i = at(x, y); t += F[i]; v += G.eRoomVgas(i); }
    for(let y=1;y<=FLOOR;y++) for(let x=7;x<=XR;x++){ const i = at(x, y); F[i] = t*G.eRoomVgas(i)/v; } }
}
/* a pool laid at rest on the board's floor row: full rows, its hydrostatic pressure */
function pool(x0, x1, rows){
  const e = G.hOfT(G.SAT_WATER, 293);
  for(let r=0;r<rows;r++) for(let x=x0;x<=x1;x++){ const i = at(x, FLOOR - r), kg = G.eLqCap(q, i); G.eLiqLandAt(q, i, kg, kg*e, 0); }
  still();
  G.step(0.02);
  for(let r=0;r<rows;r++) for(let x=x0;x<=x1;x++){ const i = at(x, FLOOR - r); s.roomWP[i] = s.roomP[i] + RHO*g*(rows - r)*MPC/1000; }
}
const RITTER = "Ritter 1892, Z. Ver. Deutscher Ing. 36(33) 947-954: the ideal dry-bed dam break";

/* water `rows` cells deep from x 7 to X1, dry floor to x 36; the front is the farthest floor cell deeper than FR h0 */
const X1 = 15, FR = 0.01;
const depth = x => { let k = 0; for(let y=1;y<=FLOOR;y++) k += s.roomWater[at(x, y)]; return k/cap*MPC; };
function dam(rows, ticks, each){
  const h0 = rows*MPC, w0 = wTot();
  pool(7, X1, rows);
  const w1 = wTot(), hit = [];
  let front = X1, t = 0.02;
  watch(G, {cap:ticks*0.02, each:() => { t += 0.02;
    let f = front; for(let x=front+1;x<=36;x++) if(depth(x) > FR*h0) f = x;
    if(f > front){ front = f; hit.push([t, f]); }
    if(each) each(t, front); }});
  const speed = (t0, t1) => { const a = hit.filter(h => h[0] >= t0 && h[0] <= t1); return a.length > 1 ? (a[a.length-1][1] - a[0][1])*MPC/(a[a.length-1][0] - a[0][0]) : NaN; };
  return {h0, c:Math.sqrt(g*h0), w0, w1, speed};
}
/* Ritter's depth at x from the dam face at time t */
const ritterH = (x, t, h0) => { const c = Math.sqrt(g*h0); return x < -c*t ? h0 : x > 2*c*t ? 0 : Math.pow(2*c - x/t, 2)/(9*g); };
/* and its velocity: the rarefaction carries the water from 2/3 c at the dam line to 2 c at the tip */
const ritterU = (x, t, h0) => { const c = Math.sqrt(g*h0); return x < -c*t || x > 2*c*t ? 0 : 2/3*(c + x/t); };

if(mode === "dam"){
  let vmax = 0, clamp = 0, dm = null, prof = null, spd = null;
  const D = dam(1, 240, (t, front) => {
    for(let i=0;i<N;i++){ const v = Math.max(Math.abs(s.roomWU[i]), Math.abs(s.roomWV[i])); if(v > vmax) vmax = v; if(v >= G.LIQ_V_MAX*(1 - 1e-9)) clamp++; }
    if(dm || t < 1 - 1e-9) return;
    dm = {h:(s.roomWater[at(X1, FLOOR)] + s.roomWater[at(X1 + 1, FLOOR)])/2/cap*MPC, u:s.roomWU[at(X1, FLOOR)]};
    prof = []; spd = [];
    for(let x=X1-3;x<=Math.min(36, Math.max(front + 1, X1 + 1 + Math.ceil(2*Math.sqrt(g*MPC)*t/MPC)));x++){ const xc = (x - X1 - 0.5)*MPC; prof.push([x, depth(x), ritterH(xc, t, MPC)]);
      const xf = (x - X1)*MPC; if(ritterH(xf, t, MPC) > FR*MPC) spd.push([x, s.roomWU[at(x, FLOOR)], ritterU(xf, t, MPC)]); } });
  const {h0, c, w0, w1} = D, v1 = D.speed(0.1, 1.2), v2 = D.speed(1.2, 2.4), v4 = D.speed(2.4, 4.8), vt = 2*c - 3*Math.sqrt(g*FR*h0);
  check("dam break, front over its first second, against Ritter's contour at the depth it is detected at", v1, vt, 0.1,
    RITTER + ", the depth-h contour moves at 2 sqrt(g h0) - 3 sqrt(g h)", {unit:"m/s", gap:"water on the floor",
      note:"h0 " + h0.toFixed(3) + " m, one cell; contour " + FR + " h0; " + (v1/c).toFixed(2) + " sqrt(g h0) against " + (vt/c).toFixed(2)});
  const on = prof.filter(r => r[2] > FR*h0), rms = Math.sqrt(on.reduce((a, r) => a + Math.pow((r[1] - r[2])/h0, 2), 0)/on.length);
  check("dam break, depth profile at 1 s against Ritter's", rms, 0, 0.15, RITTER + ": h = (2 sqrt(g h0) - x/t)^2/(9 g) between -sqrt(g h0) t and 2 sqrt(g h0) t",
    {abs:true, unit:"RMS of h0", gap:"water on the floor", note:"x, model m, Ritter m: " + prof.map(r => r[0] + " " + r[1].toFixed(3) + " " + r[2].toFixed(3)).join("; ")});
  const urms = Math.sqrt(spd.reduce((a, r) => a + Math.pow((r[1] - r[2])/c, 2), 0)/spd.length);
  check("dam break, face speeds at 1 s against Ritter's", urms, 0, 0.15,
    RITTER + ": u = 2/3 (sqrt(g h0) + x/t) between -sqrt(g h0) t and 2 sqrt(g h0) t",
    {abs:true, unit:"RMS of sqrt(g h0)", gap:"water on the floor",
      note:"x, model m/s, Ritter m/s: " + spd.map(r => r[0] + " " + r[1].toFixed(3) + " " + r[2].toFixed(3)).join("; ")});
  check("dam break, front at 2-4 s, against measured frictional fronts", v4, 1.64*c, 0.061,
    "Dressler 1954 laboratory dam breaks: 1.54-1.74 sqrt(g h0) a few seconds after release", {unit:"m/s", gap:"water on the floor",
      note:(v4/c).toFixed(2) + " sqrt(g h0); band " + (1.54*c).toFixed(2) + "-" + (1.74*c).toFixed(2)});
  check("dam break, depth at the dam line at 1 s", dm.h, 4/9*h0, 0.1, RITTER + ": h = 4/9 h0 at the dam line", {unit:"m", gap:"water on the floor"});
  check("dam break, speed at the dam line at 1 s", dm.u, 2/3*c, 0.1, RITTER + ": u = 2/3 sqrt(g h0) at the dam line",
    {unit:"m/s", gap:"water on the floor"});
  check("dam break, the front decelerates", v1 > v2 && v2 > v4 ? 1 : 0, 1, 0,
    "Whitham 1955, Proc. R. Soc. A 227: friction slows a real front with time", {abs:true, unit:"-",
      note:"over 0.1-1.2 / 1.2-2.4 / 2.4-4.8 s: " + [v1, v2, v4].map(v => (v/c).toFixed(2)).join(" / ") + " sqrt(g h0)"});
  check("dam break, faces held at the LIQ_V_MAX guard", clamp, 0, 0, "LIQ_V_MAX is a guard on a face velocity, never a model term",
    {abs:true, unit:"face-ticks", note:"fastest face " + vmax.toFixed(2) + " m/s"});
  check("dam break, water on the floor against what was laid", Math.abs(wTot() - w1), 0, 240*N*cap*Math.pow(2, -24)*1e-3,
    "conservation of mass: nothing enters or leaves the floor", {abs:true, unit:"kg", note:(w1 - w0).toFixed(1) + " kg laid"});
}

if(mode === "still"){
  /* two and a half cells of water wall to wall: at rest it stays at rest and level */
  const e = G.hOfT(G.SAT_WATER, 293);
  for(let x=7;x<=36;x++){ const i = at(x, FLOOR - 2), kg = 0.5*G.eLqCap(q, i); G.eLiqLandAt(q, i, kg, kg*e, 0); }
  pool(7, 36, 2);
  watch(G, {cap:2});
  let vmax = 0, lo = Infinity, hi = -Infinity;
  watch(G, {cap:8, each:() => { for(let i=0;i<N;i++) vmax = Math.max(vmax, Math.abs(s.roomWU[i]), Math.abs(s.roomWV[i])); },
    fail:() => vmax > G.LIQ_REST ? "a face moved at " + vmax.toFixed(4) + " m/s" : ""});
  for(let x=7;x<=36;x++){ const z = G.eLqSurf(q, at(x, FLOOR)); if(z < lo) lo = z; if(z > hi) hi = z; }
  check("a pool laid at rest stays at rest", vmax, 0, G.LIQ_REST, "hydrostatics: a level pool has no pressure gradient to drive it",
    {abs:true, unit:"m/s", note:"fastest face over 8 s after 2 s to settle; tolerance the solve's own rest speed"});
  check("...and stays level", hi - lo, 0, 0.005, "hydrostatics: a free surface at rest is level", {abs:true, unit:"m"});
}

if(mode === "deep"){
  /* the same break one, two and three cells deep: Ritter's solution has no length but h0, so the front goes as sqrt(h0) */
  const s0 = G.snapS(), v = [];
  for(const n of [1, 2, 3]){ G.restoreS(s0); v.push(dam(n, 60).speed(0.1, 1.2)); }
  const c1 = Math.sqrt(g*MPC), note = "fronts " + v.map((x, k) => (x/(c1*Math.sqrt(k + 1))).toFixed(2)).join(" / ") + " sqrt(g h0) at 1 / 2 / 3 cells deep";
  for(const n of [2, 3]) check("dam break " + n + " cells deep, front speed over the one-cell front", v[n-1]/v[0], Math.sqrt(n), 0.1,
    RITTER + ": the shallow-water solution scales with sqrt(g h0) alone, so the FR h0 contour does too", {unit:"-", gap:"water on the floor", note});
}

if(mode === "load"){
  /* the liquid-metal preset: water one cell deep in the basin between the wall at x 6 and the step at x 18; metal laid in the row over it at x 13-17 */
  const Y = FLOOR, X0 = 7, XE = 17, M0 = 13, m = G.E_LQ[1], A = MPC*G.ROOM_DEPTH;
  pool(X0, XE, 1);
  watch(G, {cap:0.5});
  const km = 0.9*G.PK[G.PK_RFIRERHO]*G.ROOM_VCELL, w0 = wTot(), p0 = () => { let k = 0; for(let i=0;i<N;i++) k += s.roomPool[i]; return k; };
  for(let x=M0;x<=XE;x++) G.eLiqLandAt(m, at(x, Y - 1), km, km*G.PK[G.PK_RFIRECP]*50, 0);
  still();
  const pm0 = p0();
  G.step(0.02);
  let worst = 0, wAt = "";
  for(let x=M0;x<=XE;x++){ const i = at(x, Y), o = at(x, Y - 1);
    const want = s.roomP[o] + (s.roomWater[i] + s.roomPool[i] + s.roomPool[o])*g/A/1000, e1 = Math.abs(s.roomWP[i] - want)/(want - s.roomP[o]);
    if(e1 >= worst){ worst = e1; wAt = "x " + x + ": " + s.roomWP[i].toFixed(3) + " kPa against " + want.toFixed(3) + " (metal " + (s.roomPool[i] + s.roomPool[o]).toFixed(0) + " kg, water " + s.roomWater[i].toFixed(0) + " kg)"; } }
  check("water under a floating metal layer carries its weight", worst, 0, 0.01, "hydrostatics: the floor pressure is the gas's plus the weight of every liquid over it per unit area",
    {abs:true, unit:"of the liquid head", pass:worst <= 0.01, note:"worst " + wAt + ", one tick after the metal was laid"});
  watch(G, {cap:49*0.02});
  const surf = x => G.eLqSurf(q, at(x, Y)), under = surf(XE - 1), beside = surf(X0);
  check("the water surface under the metal stands lower than beside it", under < beside ? 1 : 0, 1, 0,
    "Archimedes: a floating layer sinks the surface it rests on by its own weight over the water's", {abs:true, unit:"-",
      note:"at 1 s, " + under.toFixed(4) + " m under x " + (XE - 1) + " against " + beside.toFixed(4) + " m at x " + X0 + "; water " + (wTot() - w0).toFixed(1) + " kg and metal " + (p0() - pm0).toFixed(1) + " kg moved by the reaction and the fire over the window"});
}
