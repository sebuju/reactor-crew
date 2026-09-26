"use strict";
// chunks: real,pred ulp
// preset: 0
const path = require("path");
const {check, watch, watchNote, transit, commissionPreset, colebrook, if97, psat} = require("./lib.js");
const {ulpNext} = require(path.join(__dirname, "..", "..", "tools", "bundle.js"));
const mode = process.argv.slice(2).includes("ulp") ? "ulp" : "real";
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, SX = G.SX, sc = ST.sc;
const stop = () => { G.act("scram"); G.act("flowDem", 0); for(let p=0;p<PT.n.pump;p++) if(PT.pumpPrimary[p]) ST.flowBy[p] = 0; };
const LOOP_SRC = "loop momentum balance: buoyancy sum(rho g dz) round the engine's own node temperatures = sum of Darcy-Colebrook and stated losses; rho, mu of water from IAPWS (saturated-liquid density)";

/* the core loop walked downstream along the edges carrying its flow, and the flow its momentum balance carries; self: friction at that flow, not today's */
function loopTruth(self){
  const core = PT.coreNode[0], loop = [];
  let at = core, guard = 0;
  do {
    let best = -1, bw = 0;
    for(let e=0;e<PT.n.edge;e++){ const w = ST.edW[e], u = PT.edU[e], v = PT.edV[e];
      const from = w >= 0 ? u : v; if(from !== at || PT.nodeCirc[u] !== PT.nodeCirc[core]) continue;
      if(Math.abs(w) > bw){ bw = Math.abs(w); best = e; } }
    if(best < 0) break;
    loop.push(best); at = ST.edW[best] >= 0 ? PT.edV[best] : PT.edU[best];
  } while(at !== core && ++guard < 200);
  const g = 9.80665, rhoT = T => 1/if97(psat(T), T).v, muT = T => 2.414e-5*Math.pow(10, 247.8/(T - 140));
  let B = 0;
  for(const e of loop){ const w = ST.edW[e], from = w >= 0 ? PT.edU[e] : PT.edV[e], to = w >= 0 ? PT.edV[e] : PT.edU[e];
    B += rhoT(G.eNodeT(from))*g*(PT.nodeZ[from] - PT.nodeZ[to]); }
  const Rof = s => { let R = 0;
    for(const e of loop){ const w = ST.edW[e], T = G.eNodeT(w >= 0 ? PT.edU[e] : PT.edV[e]), rho = rhoT(T);
      let K, A;
      if(PT.edCk[e] === 0){ const C = PT.edC0[e]; A = 1; K = 1/(C*C); }
      else { const D = G.boreM(PT.edBore[e]); A = Math.PI/4*D*D;
        K = colebrook(4*Math.abs(w)*s/(Math.PI*D*muT(T)), 4.5e-5/D)*Math.max(PT.edLen[e], 0.1)/D + PT.edK0[e]; }
      R += K/(2*rho*A*A); }
    return R; };
  const wc = Math.abs(SX.netCoreKg[0]);
  let wt = B > 0 ? Math.sqrt(B/Rof(1)) : 0;
  if(self) for(let i=0;i<50 && wt > 0;i++) wt = Math.sqrt(B/Rof(wt/wc));
  const closed = at === core;
  return {w:wt, closed, opt:{unit:"kg/s", pass:closed ? undefined : false,
    note:(closed ? "" : "loop walk did not close; ") + loop.length + " edges, buoyancy " + (B/1e3).toFixed(2) + " kPa"}};
}

if(mode === "real"){
  stop();
  /* half a second in the pumps still drive the loop, so the prediction and the real flow are different things */
  watch(G, {cap:0.5});
  const L0 = loopTruth(true), early = {pred:sc[G.SC_NAT]*G.PK[G.PK_NETREF], w:L0.w, real:Math.abs(SX.netCoreKg[0]), opt:L0.opt};
  const win = transit(G), real = () => Math.abs(SX.netCoreKg[0])/loopTruth().w, pred = () => sc[G.SC_NAT]*G.PK[G.PK_NETREF]/loopTruth().w;
  const w = watch(G, {cap:3*win, horizon:44.5, window:win, sig:[{name:"real", read:real, ref:1, tol:0.10}, {name:"pred", read:pred, ref:1, tol:0.10}]});
  check("thermosiphon prediction (SC_NAT x rated core flow) 0.5 s after pump stop", early.pred, early.w, 0.10,
    LOOP_SRC + "; friction priced at the balance's own flow, since the real flow is still pumped",
    Object.assign({}, early.opt, {note:early.opt.note + ", real flow " + early.real.toFixed(0) + " kg/s"}));
  const L = loopTruth(), at = "; " + watchNote(w) + " after the first 0.5 s of a 45 s question, window " + win.toFixed(1) + " s";
  check("natural circulation, core loop flow after pump stop, watched to 45 s", Math.abs(SX.netCoreKg[0]), L.w, 0.10, LOOP_SRC,
    Object.assign({}, L.opt, {note:L.opt.note + at}));
  check("thermosiphon prediction (SC_NAT x rated core flow) after pump stop, watched to 45 s", sc[G.SC_NAT]*G.PK[G.PK_NETREF], L.w, 0.10,
    LOOP_SRC + "; the prediction solves the same loop with the pumps stopped", L.opt);
}

/* two marches off one t = 0 state, the second with 1 ulp in one enthalpy on the core's circuit */
if(mode === "ulp"){
  const N = Math.round(20/0.02), c = PT.nodeCirc[PT.coreNode[0]], cn = [];
  for(let i=0;i<PT.n.node;i++) if(PT.nodeCirc[i] === c) cn.push(i);
  const W = 1 + 2*cn.length, rel = (a, b) => a === b ? 0 : Math.abs(a - b)/Math.max(Math.abs(a), 1e-9);
  const A = {nat:0, inp:0, bumped:-1}, rec = new Float64Array(N*W);
  stop();
  const s0 = G.snapS();
  watch(G, {cap:20, each:k => { const o = (k - 1)*W; rec[o] = sc[G.SC_NAT];
    for(let j=0;j<cn.length;j++){ rec[o+1+j] = ST.hBy[cn[j]]; rec[o+1+cn.length+j] = ST.pBy[cn[j]]; } }});
  G.restoreS(s0);
  { const i = cn.find(j => ST.hBy[j] === ST.hBy[j] && ST.hBy[j] !== 0); ST.hBy[i] = ulpNext(ST.hBy[i]); A.bumped = i; }
  watch(G, {cap:20, each:k => { const o = (k - 1)*W; A.nat = Math.max(A.nat, rel(rec[o], sc[G.SC_NAT]));
    for(let j=0;j<cn.length;j++){ const h = rec[o+1+j], p = rec[o+1+cn.length+j];
      if(h === h) A.inp = Math.max(A.inp, rel(h, ST.hBy[cn[j]]));
      if(p === p) A.inp = Math.max(A.inp, rel(p, ST.pBy[cn[j]])); } }});
  const tol = G.E_NAT_TOL, bound = 0.56*A.inp + tol;
  check("thermosiphon prediction, worst split over 20 s after pump stop from 1 ulp in one enthalpy", A.nat, bound, 0,
    "single-phase natural circulation w = sqrt(B/R), turbulent friction: dw/w = 0.56 dB/B, so a relative input split s moves the loop by 0.56 s (Todreas & Kazimi, Nuclear Systems I); plus the fixed point's own tolerance E_NAT_TOL",
    {pass:A.nat <= bound, note:"hBy[" + A.bumped + "], worst core-circuit hBy/pBy split " + A.inp.toExponential(2) + ", E_NAT_TOL " + tol});
}
