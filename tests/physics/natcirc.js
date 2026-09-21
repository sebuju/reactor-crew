"use strict";
// chunks: real,pred ulp
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset, colebrook, if97, psat} = require("./lib.js");
const {ulpNext} = require(path.join(__dirname, "..", "..", "tools", "bundle.js"));
const args = process.argv.slice(2), resume = args.includes("--resume"), mode = args.includes("ulp") ? "ulp" : "real";
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, SX = G.SX, sc = ST.sc, WALL = 7000, t0 = Date.now();
const tmp = s => path.join(os.tmpdir(), "rc-phys-natcirc-" + mode + s);
const fBin = tmp(".bin"), fJs = tmp(".json"), fRec = tmp(".rec"), fS0 = tmp(".s0");
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

function more(A, extra){
  fs.writeFileSync(fBin, Buffer.from(G.snapS())); fs.writeFileSync(fJs, JSON.stringify(A));
  if(extra) extra();
  process.stdout.write("@@MORE\n"); process.exit(0);
}
const done = () => { for(const f of [fBin, fJs, fRec, fS0]) if(fs.existsSync(f)) fs.unlinkSync(f); };
const resumed = () => resume && fs.existsSync(fJs);
if(resumed()) G.restoreS(new Uint8Array(fs.readFileSync(fBin)));

if(mode === "real"){
  let A = resumed() ? JSON.parse(fs.readFileSync(fJs, "utf8")) : null;
  if(!A){ stop(); A = {}; }
  /* half a second in the pumps still drive the loop, so the prediction and the real flow are different things */
  if(!A.early){ while(sc[G.SC_T] < 0.5 - 1e-9) G.step(0.02);
    const L = loopTruth(true);
    A.early = {pred:sc[G.SC_NAT]*G.PK[G.PK_NETREF], w:L.w, real:Math.abs(SX.netCoreKg[0]), opt:L.opt}; }
  while(sc[G.SC_T] < 45 - 1e-9 && Date.now() - t0 < WALL) G.step(0.02);
  if(sc[G.SC_T] < 45 - 1e-9) more(A);
  done();
  check("thermosiphon prediction (SC_NAT x rated core flow) 0.5 s after pump stop", A.early.pred, A.early.w, 0.10,
    LOOP_SRC + "; friction priced at the balance's own flow, since the real flow is still pumped",
    Object.assign({}, A.early.opt, {note:A.early.opt.note + ", real flow " + A.early.real.toFixed(0) + " kg/s"}));
  const L = loopTruth();
  check("natural circulation, core loop flow 45 s after pump stop", Math.abs(SX.netCoreKg[0]), L.w, 0.10, LOOP_SRC, L.opt);
  check("thermosiphon prediction (SC_NAT x rated core flow) 45 s after pump stop", sc[G.SC_NAT]*G.PK[G.PK_NETREF], L.w, 0.10,
    LOOP_SRC + "; the prediction solves the same loop with the pumps stopped", L.opt);
}

/* two marches off one t = 0 state, the second with 1 ulp in one enthalpy on the core's circuit */
if(mode === "ulp"){
  const N = Math.round(20/0.02), c = PT.nodeCirc[PT.coreNode[0]], cn = [];
  for(let i=0;i<PT.n.node;i++) if(PT.nodeCirc[i] === c) cn.push(i);
  const W = 1 + 2*cn.length, rel = (a, b) => a === b ? 0 : Math.abs(a - b)/Math.max(Math.abs(a), 1e-9);
  let A;
  if(resumed()) A = JSON.parse(fs.readFileSync(fJs, "utf8"));
  else { stop(); fs.writeFileSync(fS0, Buffer.from(G.snapS())); A = {phase:0, k:0, nat:0, inp:0, bumped:-1}; }
  const rec = fs.existsSync(fRec) ? new Float64Array(new Uint8Array(fs.readFileSync(fRec)).buffer) : new Float64Array(N*W);
  while(A.phase < 2 && Date.now() - t0 < WALL){
    G.step(0.02);
    const o = A.k*W;
    if(A.phase === 0){ rec[o] = sc[G.SC_NAT];
      for(let j=0;j<cn.length;j++){ rec[o+1+j] = ST.hBy[cn[j]]; rec[o+1+cn.length+j] = ST.pBy[cn[j]]; } }
    else { A.nat = Math.max(A.nat, rel(rec[o], sc[G.SC_NAT]));
      for(let j=0;j<cn.length;j++){ const h = rec[o+1+j], p = rec[o+1+cn.length+j];
        if(h === h) A.inp = Math.max(A.inp, rel(h, ST.hBy[cn[j]]));
        if(p === p) A.inp = Math.max(A.inp, rel(p, ST.pBy[cn[j]])); } }
    if(++A.k < N) continue;
    A.phase++; A.k = 0;
    if(A.phase === 1){ G.restoreS(new Uint8Array(fs.readFileSync(fS0)));
      const i = cn.find(j => ST.hBy[j] === ST.hBy[j] && ST.hBy[j] !== 0);
      ST.hBy[i] = ulpNext(ST.hBy[i]); A.bumped = i; }
  }
  if(A.phase < 2) more(A, () => fs.writeFileSync(fRec, Buffer.from(rec.buffer)));
  done();
  const tol = G.E_NAT_TOL, bound = 0.56*A.inp + tol;
  check("thermosiphon prediction, worst split over 20 s after pump stop from 1 ulp in one enthalpy", A.nat, bound, 0,
    "single-phase natural circulation w = sqrt(B/R), turbulent friction: dw/w = 0.56 dB/B, so a relative input split s moves the loop by 0.56 s (Todreas & Kazimi, Nuclear Systems I); plus the fixed point's own tolerance E_NAT_TOL",
    {pass:A.nat <= bound, note:"hBy[" + A.bumped + "], worst core-circuit hBy/pBy split " + A.inp.toExponential(2) + ", E_NAT_TOL " + tol});
}
