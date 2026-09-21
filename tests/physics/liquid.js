"use strict";
// chunks: dam still
/* Water on the floor against the dam break's published solution and measurements, and a pool at rest. */
const {check, commissionPreset, if97} = require("./lib.js");
const mode = process.argv[2] || "dam";
const G = commissionPreset(0), s = G.ST, GW = G.GW, N = GW*G.GH, MPC = G.MPC, g = 9.80665;
s.sc[G.SC_DICEOFF] = 1;
G.eLqBind();
const RHO = 1/if97(0.1013, 293).v, q = G.E_LQ[0], at = (x, y) => y*GW + x, cap = RHO*G.ROOM_VCELL, FLOOR = 29;
const wTot = () => { let k = 0; for(let i=0;i<N;i++) k += s.roomWater[i]; return k; };
/* a pool laid at rest on the board's floor row: full rows, its hydrostatic pressure, the gas it displaced spread at rest */
function pool(x0, x1, rows){
  const e = G.hOfT(G.SAT_WATER, 293);
  for(let r=0;r<rows;r++) for(let x=x0;x<=x1;x++){ const i = at(x, FLOOR - r), kg = G.eLqCap(q, i); G.eLiqLandAt(q, i, kg, kg*e, 0); }
  s.roomWU.fill(0); s.roomWV.fill(0); s.roomPU.fill(0); s.roomPV.fill(0); s.gsDisp.fill(0);
  for(const F of [s.roomM, s.roomH2, s.roomO2, s.roomVap]){ let t = 0, v = 0;
    for(let y=1;y<=FLOOR;y++) for(let x=7;x<=36;x++){ const i = at(x, y); t += F[i]; v += G.eRoomVgas(i); }
    for(let y=1;y<=FLOOR;y++) for(let x=7;x<=36;x++){ const i = at(x, y); F[i] = t*G.eRoomVgas(i)/v; } }
  G.step(0.02);
  for(let r=0;r<rows;r++) for(let x=x0;x<=x1;x++){ const i = at(x, FLOOR - r); s.roomWP[i] = s.roomP[i] + RHO*g*(rows - r)*MPC/1000; }
}
const RITTER = "Ritter 1892, Z. Ver. Deutscher Ing. 36(33) 947-954: the ideal dry-bed dam break";

if(mode === "dam"){
  /* one cell of water from x 7 to 15, dry floor to x 36; the front is the farthest floor cell over 1 % full */
  const X1 = 15, h0 = MPC, c = Math.sqrt(g*h0), w0 = wTot();
  pool(7, X1, 1);
  const w1 = wTot();
  let front = X1, t = 0.02, vmax = 0, clamp = 0, dam = null;
  const hit = [];
  for(let k=0;k<240;k++){ G.step(0.02); t += 0.02;
    let f = front; for(let x=front+1;x<=36;x++) if(s.roomWater[at(x, FLOOR)] > 0.01*cap) f = x;
    if(f > front){ front = f; hit.push([t, f]); }
    for(let i=0;i<N;i++){ const v = Math.max(Math.abs(s.roomWU[i]), Math.abs(s.roomWV[i])); if(v > vmax) vmax = v; if(v >= G.LIQ_V_MAX*(1 - 1e-9)) clamp++; }
    if(!dam && t >= 1 - 1e-9) dam = {h:(s.roomWater[at(X1, FLOOR)] + s.roomWater[at(X1 + 1, FLOOR)])/2/cap*h0, u:s.roomWU[at(X1, FLOOR)]}; }
  const speed = (t0, t1) => { const a = hit.filter(h => h[0] >= t0 && h[0] <= t1); return a.length > 1 ? (a[a.length-1][1] - a[0][1])*MPC/(a[a.length-1][0] - a[0][0]) : NaN; };
  const v1 = speed(0.1, 1.2), v2 = speed(1.2, 2.4), v4 = speed(2.4, 4.8);
  check("dam break, front over its first second, against the ideal inviscid front", v1, 2*c, 0.1,
    RITTER + ", front at 2 sqrt(g h0)", {unit:"m/s", gap:"water on the floor", note:"h0 " + h0.toFixed(3) + " m, one cell; " + (v1/c).toFixed(2) + " sqrt(g h0)"});
  check("dam break, front at 2-4 s, against measured frictional fronts", v4, 1.64*c, 0.061,
    "Dressler 1954 laboratory dam breaks: 1.54-1.74 sqrt(g h0) a few seconds after release", {unit:"m/s", gap:"water on the floor",
      note:(v4/c).toFixed(2) + " sqrt(g h0); band " + (1.54*c).toFixed(2) + "-" + (1.74*c).toFixed(2)});
  check("dam break, depth at the dam line at 1 s", dam.h, 4/9*h0, 0.1, RITTER + ": h = 4/9 h0 at the dam line", {unit:"m", gap:"water on the floor"});
  check("dam break, speed at the dam line at 1 s", dam.u, 2/3*c, 0.1, RITTER + ": u = 2/3 sqrt(g h0) at the dam line",
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
  for(let k=0;k<100;k++) G.step(0.02);
  let vmax = 0, lo = Infinity, hi = -Infinity;
  for(let k=0;k<400;k++){ G.step(0.02);
    for(let i=0;i<N;i++) vmax = Math.max(vmax, Math.abs(s.roomWU[i]), Math.abs(s.roomWV[i])); }
  for(let x=7;x<=36;x++){ const z = G.eLqSurf(q, at(x, FLOOR)); if(z < lo) lo = z; if(z > hi) hi = z; }
  check("a pool laid at rest stays at rest", vmax, 0, G.LIQ_REST, "hydrostatics: a level pool has no pressure gradient to drive it",
    {abs:true, unit:"m/s", note:"fastest face over 8 s after 2 s to settle; tolerance the solve's own rest speed"});
  check("...and stays level", hi - lo, 0, 0.005, "hydrostatics: a free surface at rest is level", {abs:true, unit:"m"});
}
