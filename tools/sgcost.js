"use strict";
// node tools/sgcost.js
// job 25 (docs/plan-nocode-gaps.md): weigh the exact variable-cp stage law against the current secant,
// re-measure NUSCALE/EPR against it, and look at what moved the stage's w by 16% (6951 -> 8033 kg/s).
const path = require("path");
const B = require(path.join(__dirname, "bundle.js"));
const { performance: perf } = require("perf_hooks");

// the eval-proxy boot idiom tests/physics/lib.js uses: every bundle global (reassigned or not) resolves live
const ev = B.headless("(n => eval(n))");
const G = new Proxy({}, { get: (t, k) => (typeof k === "string" ? ev(k) : undefined) });

// IAPWS-IF97 region 1, and the exact variable-cp boiling-shell integral: copied verbatim from
// tests/physics/lib.js / tests/physics/hx.js, the hand-written comparator, never a number the sim printed
const R1 = [[0,-2,0.14632971213167],[0,-1,-0.84548187169114],[0,0,-3.756360367204],[0,1,3.3855169168385],[0,2,-0.95791963387872],
  [0,3,0.15772038513228],[0,4,-0.016616417199501],[0,5,8.1214629983568e-4],[1,-9,2.8319080123804e-4],[1,-7,-6.0706301565874e-4],
  [1,-1,-0.018990068218419],[1,0,-0.032529748770505],[1,1,-0.021841717175414],[1,3,-5.283835796993e-5],[2,-3,-4.7184321073267e-4],
  [2,0,-3.0001780793026e-4],[2,1,4.7661393906987e-5],[2,3,-4.4141845330846e-6],[2,17,-7.2694996297594e-16],[3,-4,-3.1679644845054e-5],
  [3,0,-2.8270797985312e-6],[3,6,-8.5205128120103e-10],[4,-5,-2.2425281908e-6],[4,-2,-6.5171222895601e-7],[4,10,-1.4341729937924e-13],
  [5,-8,-4.0516996860117e-7],[8,-11,-1.2734301741641e-9],[8,-6,-1.7424871230634e-10],[21,-29,-6.8762131295531e-19],
  [23,-31,1.4478307828521e-20],[29,-38,2.6335781662795e-23],[30,-39,-1.1947622640071e-23],[31,-40,1.8228094581404e-24],
  [32,-41,-9.3537087292458e-26]];
const RW = 0.461526;
const if97 = (p, T) => { const pi = p/16.53, tau = 1386/T; let gp = 0, gt = 0, gtt = 0;
  for(const [I, J, n] of R1){ gp += -n*I*Math.pow(7.1 - pi, I - 1)*Math.pow(tau - 1.222, J);
    gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1);
    gtt += n*Math.pow(7.1 - pi, I)*J*(J - 1)*Math.pow(tau - 1.222, J - 2); }
  return {v: pi*gp*RW*T/(p*1000), h: RW*T*tau*gt, cp: -RW*tau*tau*gtt}; };
const TofH = (p, h) => { let lo = 273.16, hi = 623.15; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(if97(p, m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };
// dh defaults to hx.js's own 0.01: a fine quadrature against the model's tOfHA (a table lookup, cheap per step).
// Against the from-scratch IF97 bisection (TofH, ~80 if97() evals per step) 0.01 costs ~5.5 s for ONE stage ONE tick
// (measured directly, not printed here) - a second, standalone data point for how heavy the exact law's own reference is.
const hOut = (hin, hs, Ts, T, ntuW, dh) => { dh = dh || 0.01; let h = hin, I = 0;
  while(h > hs + dh){ const d = dh/(T(h - dh/2) - Ts);
    if(I + d >= ntuW) return h - dh*(ntuW - I)/d;
    I += d; h -= dh; }
  return h; };

function march(secs){ const n = Math.round(secs/0.02); for(let i=0;i<n;i++) G.step(0.02); }

// same method as hx.js's STOCK check: stage 0, 10 s in, the exact law on the model's own h(T, p) (tOfHA, table-backed,
// itself built off IF97 by the water-table refit); withIF97 additionally spot-checks against the from-scratch IF97
// bisection at a coarse step (cheap: dh 0.5 instead of 0.01), never at hx.js's full precision - see the cost note above
function measureStage(name, presetIdx, withIF97){
  G.plantPreset(presetIdx); G.buildLayout(); G.commission();
  march(10);
  const PT = G.PT, ST = G.ST, SX = G.SX, b = PT.sgBoiler[0];
  G.eStageStream(0, 0);
  const at = SX.stgN[0], w = SX.stgW[0], Ts = ST.sgTBy[b], p = G.eNodeP(at), c = G.eNodeSat(at);
  const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02);
  const filmK = 1 - 0.85*Math.min(Math.max(ST.sc[G.SC_VF], 0), 1);
  const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1)*filmK;
  G.E_SQ[0] = fl; G.E_SQ[1] = filmK; G.eSgQ(0);
  const Q = G.E_SQ[2], io = new Float64Array(G.MX_N);
  const Tmodel = h => { io[G.MX_P] = p; io[G.MX_H] = h; G.tOfHA(c, io); return io[G.MX_T]; };
  const hin = ST.hBy[at], qOwn = w*(hin - hOut(hin, G.hOfTP(c, Ts, p), Ts, Tmodel, UA/w));
  const distPct = (Q - qOwn)/qOwn*100;
  let line = "  " + name.padEnd(10) + " model " + (Q/1000).toFixed(1) + " MW   exact(model h) " + (qOwn/1000).toFixed(1) +
    " MW   dist " + distPct.toFixed(2) + "%   UA " + UA.toFixed(0) + " kW/K   w " + w.toFixed(1) + " kg/s   nSG " + PT.n.sg;
  if(withIF97){
    const Tin = Tmodel(hin), hin97 = if97(p, Tin).h;
    const q97 = w*(hin97 - hOut(hin97, if97(p, Ts).h, Ts, h => TofH(p, h), UA/w, 0.5));
    line += "   exact(raw IF97, coarse) " + (q97/1000).toFixed(1) + " MW  (" + ((qOwn - q97)/q97*100).toFixed(2) + "% vs model h)";
  }
  console.log(line);
  return { Q, qOwn, UA, w, at, p, c, Ts, hin, fl, filmK, b, distPct, nSg: PT.n.sg };
}

console.log("\n== A. cost of the exact quadrature vs the current secant, per stage per tick ==");
const stock = measureStage("STOCK", 0, true);
{
  const ioT = new Float64Array(G.MX_N);
  // the current production path: exactly what tick.js calls once per stage per tick
  const secantOnce = () => { G.E_SQ[0] = stock.fl; G.E_SQ[1] = stock.filmK; G.eSgQ(0); };
  // the drop-in swap: identical setup (UA, eStageStream, Ts lookup), the closed form replaced by hOut()'s quadrature
  const exactOnce = () => {
    const io = G.E_SQ, fl = io[0] = stock.fl, filmK = io[1] = stock.filmK, b = G.PT.sgBoiler[0];
    G.eBoilerLvlA(b);
    const fill = G.clamp(G.E_BL[0]/G.E_SG_DRY, 0, 1);
    const UA = G.PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*fill*filmK;
    G.eStageStream(0, 0);
    let Ts = G.ST.sgTBy[b];
    if(!(Ts > 0)){ G.eSecPA(0); G.E_SG2[0] = G.E_SP[0]; G.satTA(G.eBoilerSatOf(b), G.E_SG2, 0, 1); Ts = G.E_SG2[1]; }
    const at = G.SX.stgN[0], w = G.SX.stgW[0], p = G.eNodeP(at), c = G.eNodeSat(at), hin = G.ST.hBy[at];
    const Tmodel = h => { ioT[G.MX_P] = p; ioT[G.MX_H] = h; G.tOfHA(c, ioT); return ioT[G.MX_T]; };
    io[2] = w*(hin - hOut(hin, G.hOfTP(c, Ts, p), Ts, Tmodel, UA/w));
  };
  const bench = (fn, n) => { for(let i=0;i<Math.min(5,n);i++) fn(); const t0 = perf.now(); for(let i=0;i<n;i++) fn(); return (perf.now() - t0)/n; };
  const secMs = bench(secantOnce, 8000);
  // calibrate the quadrature's N so the bench itself stays well inside the 10 s script budget
  const probeMs = bench(exactOnce, 3);
  const exN = Math.max(5, Math.min(150, Math.round(150/Math.max(probeMs, 0.05))));
  const exMs = bench(exactOnce, exN);
  console.log("  secant (current)  " + (secMs*1000).toFixed(2) + " us/stage/tick  (n=8000)");
  console.log("  exact quadrature  " + (exMs*1000).toFixed(1) + " us/stage/tick  (n=" + exN + ")");

  // tick budget: same method as tools/ticktime.js (warm, then time a batch of G.step(0.02))
  for(let k=0;k<50;k++) G.step(0.02);
  const NT = 150, t0 = perf.now(); for(let k=0;k<NT;k++) G.step(0.02); const tickMs = (perf.now() - t0)/NT;
  console.log("  tick budget        " + tickMs.toFixed(3) + " ms/tick (STOCK, warm, tools/ticktime.js method)");
  const fracOne = exMs/tickMs*100, fracAll = exMs*stock.nSg/tickMs*100;
  console.log("  exact law as a fraction of the tick: " + fracOne.toFixed(2) + "% (this stage alone), " +
    fracAll.toFixed(2) + "% if every one of STOCK's " + stock.nSg + " stage(s) paid it");
}

console.log("\n== C. the 16% move in w (6951 -> 8033 kg/s), STOCK ==");
{
  // STOCK is still the live preset from section A - no need to re-commission
  const P = G.P, a = G.COOLANT[G.priD().cool], f = G.coolFig(a);
  const wNow = G.SX.stgW[0];
  console.log("  current stage-0 w  " + wNow.toFixed(1) + " kg/s   (row's history: 6951 -> 8033)");
  console.log("  coolBoils(STOCK's row)  " + G.coolBoils(a) + "   (35b7417/48c553d only change coreRatedKgs()'s divisor for a BOILING row)");
  console.log("  P.sat.cp " + P.sat.cp.toFixed(4) + "  coolFig(a).cp " + f.cp.toFixed(4) +
    "  equal object? " + (P.sat.cp === f.cp) + "   (satCurveFor() sets c.cp = coolFig(a).cp, same WeakMap entry)");
  console.log("  coreDT0() " + G.coreDT0().toFixed(3) + "  a.dT0 " + a.dT0 +
    "  P.wRated " + P.wRated.toFixed(1) + "  reconstructed pre-48c553d wRated " + (P.rated*1000/(P.sat.cp*G.coreDT0())).toFixed(1));
  console.log("  -> for a non-boiling row these are IDENTICAL by construction: the rated-flow commits (19:04, 19/09) are");
  console.log("     a no-op for STOCK/NUSCALE/EPR. NOT SEPARATED from here: the remaining candidate between the two");
  console.log("     dated measurements is the Fink UO2 pin/film rework (2fbb6a2, 3b1e327, cf7da10, 2cb761c, aaf7a06,");
  console.log("     c0ea3d8, all ~19/09 20:08-20:09), which does touch a UO2 core like STOCK but was not ablated here.");
}

console.log("\n== B. NUSCALE and EPR against the exact law, same method as STOCK ==");
const iNuscale = G.PLANTPRE.findIndex(p => p[0] === "NUSCALE");
const iEpr = G.PLANTPRE.findIndex(p => p[0] === "EPR");
measureStage("NUSCALE", iNuscale);
measureStage("EPR", iEpr);
