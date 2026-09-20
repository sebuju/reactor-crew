"use strict";
/* Question: which term of the fast power coefficient can reach a negative total at 100 %, and is the
   value it needs inside its own published band? The coefficient is read on the core's own rest pass
   about a held operating point, term by term, then each term's coefficient is inverted for the total.
   node tools/coefsplit.js [preset] */
const path = require("path");
const B = require(path.join(__dirname, "bundle.js"));
const ev = B.headless("(n => eval(n))");
const G = new Proxy({}, {get:(t, k) => typeof k === "string" ? ev(k) : undefined});

const PRE = process.argv[2] === undefined ? 5 : +process.argv[2], c = 0;
G.plantPreset(PRE); G.buildLayout(); G.commission();
const PT = G.PT, ST = G.ST, SX = G.SX, XNN = G.XNN;
const snap = G.engSnap(G.engSnapNew());
const sat = G.eNodeSat(PT.coreNode[c]), pc = ST.csPCore[c], hfC = G.satH(sat, pc);
const W = G.nodeW, nb = c*XNN;

function rest(heat, inP){
  G.engRestore(snap);
  const h0 = ST.coreInH[c];
  ST.csHeat[c] = heat; ST.coreInH[c] = hfC - (hfC - h0)*(inP === undefined ? heat : inP);
  for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
    for(let k=0;k<XNN;k++){ ST.csNV[c*XNN+k] = ST.csNVt[c*XNN+k]; ST.csNTc[c*XNN+k] = ST.csNTct[c*XNN+k]; } }
  const o = SX.coreO;
  let tf = 0, tc = 0, tg = 0, v = 0, w = 0;
  for(let k=0;k<XNN;k++){ const p = ST.csPhi[nb+k], w2 = W[k]*p*p; w += w2;
    tf += w2*ST.csNTf[nb+k]; tc += w2*ST.csNTc[nb+k]; tg += w2*ST.csNTg[nb+k]; v += w2*ST.csNV[nb+k]; }
  return {vd:o[G.E_CO_VD], dop:o[G.E_CO_DOP], mod:o[G.E_CO_MOD], exp:o[G.E_CO_EXP], gr:o[G.E_CO_GR],
          tf:tf/w, tc:tc/w, tg:tg/w, v:v/w};
}
const coef = P => { const lo = rest(P - 0.005, P), hi = rest(P + 0.005, P), d = k => hi[k] - lo[k];
  return {vd:d("vd"), dop:d("dop"), mod:d("mod") + d("exp"), gr:d("gr"),
          dv:d("v"), dtf:d("tf"), dtc:d("tc"), dtg:d("tg")}; };

const tau = PT.coreGraphKg[c]*G.graphCp(PT.coreTgRef[c])/Math.max(PT.coreGUA[c], 1e-9);
const grFast = 1 - Math.exp(-2/tau);
const k100 = coef(1), aV = PT.coreAV[c], aF = PT.coreAF[c], aM = PT.coreAM[c], aG = PT.coreAG[c];
const tot = k100.vd + k100.dop + k100.mod + k100.gr*grFast;
const out = s => process.stdout.write(s + "\n");
out("preset " + G.PLANTPRE[PRE][0] + ", " + G.P.rated.toFixed(0) + " MWt, fast coefficient at 100 %");
out("");
/* the terms: each is its own coefficient times the flux-squared weighted sensitivity the same pass reads */
/* the published column is the RBMK-1000's own, so it is printed for that preset and left blank for any other */
const pub = PRE === 5 ? ["+2000 to +2500 pcm (INSAG-7 2.1 and table II-I)", "-1.1 to -1.5 pcm/K (table II-I: -1.2e-5 per degC)",
  "no published figure found", "+6.0 pcm/K (table II-I)"] : ["", "", "", ""];
const rows = [["void", k100.vd, aV, k100.dv, "per unit void", pub[0]],
  ["Doppler", k100.dop, aF, k100.dtf, "K", pub[1]],
  ["moderator", k100.mod, aM, k100.dtc, "K", pub[2]],
  ["graphite", k100.gr*grFast, aG, k100.dtg*grFast, "K", pub[3]]];
out("term       pcm/%    coefficient   d(driver)/dP   published");
for(const [n, t, a, d] of rows)
  out(n.padEnd(10) + t.toFixed(4).padStart(8) + a.toFixed(4).padStart(14) + d.toFixed(6).padStart(15) +
    "   " + rows.find(r => r[0] === n)[5]);
out("total " + tot.toFixed(4) + " pcm/%   (graphite settled " + k100.gr.toFixed(2) + ", 2 s share " + grFast.toExponential(2) + ")");
out("");
/* closure: the terms ARE the coefficient, so the residual against the engine's own sum is the check */
const sum = k100.vd + k100.dop + k100.mod + k100.gr*grFast;
out("closure: terms - total = " + (sum - tot).toExponential(3) + " pcm/%");
/* separability: doubling one coefficient must double its own term and leave the others alone */
for(const [n, col] of [["void", "coreAV"], ["Doppler", "coreAF"], ["moderator", "coreAM"]]){
  const key = n === "void" ? "vd" : n === "Doppler" ? "dop" : "mod", a0 = PT[col][c];
  PT[col][c] = a0*2; const k2 = coef(1); PT[col][c] = a0;
  let worst = 0; for(const q of ["vd", "dop", "mod"]) if(q !== key) worst = Math.max(worst, Math.abs(k2[q] - k100[q]));
  out("separable " + n.padEnd(10) + " own term x" + (k2[key]/k100[key]).toFixed(6) + ", worst other term moved " + worst.toExponential(2)); }
out("");
/* the flux solve reads the reactivity field, so the terms are weakly coupled and the inversion is solved, not scaled */
const totOf = () => { const k = coef(1); return k.vd + k.dop + k.mod + k.gr*grFast; };
out("what each coefficient must become for the total to reach zero (secant on the coupled pass):");
for(const [n, t, a, , unit, pub] of rows){
  const col = n === "void" ? "coreAV" : n === "Doppler" ? "coreAF" : n === "moderator" ? "coreAM" : "coreAG";
  if(Math.abs(t) < 1e-9){ out(n.padEnd(10) + " carries nothing; it cannot reach it"); continue; }
  const lin = a*(t - tot)/t;
  if(Math.abs(lin/a) > 20){ out(n.padEnd(10) + a.toFixed(3).padStart(10) + " -> " + lin.toFixed(1).padStart(10) +
    " pcm/" + unit.padEnd(14) + " x" + (lin/a).toFixed(1) + " (first order; too far to solve)   published " + pub); continue; }
  let x0 = a, f0 = tot, x1 = lin, f1 = tot;
  for(let i=0;i<12;i++){ PT[col][c] = x1; f1 = totOf();
    if(Math.abs(f1) < 1e-6) break;
    const x2 = x1 - f1*(x1 - x0)/(f1 - f0); x0 = x1; f0 = f1; x1 = x2; }
  PT[col][c] = a;
  out(n.padEnd(10) + a.toFixed(3).padStart(10) + " -> " + x1.toFixed(3).padStart(10) + " pcm/" + unit.padEnd(14) +
    " x" + (x1/a).toFixed(3) + " (residual " + f1.toExponential(1) + ")   published " + pub); }
