"use strict";
/* Question: which mechanism carries the excess in d(void)/d(power) at a held core inlet?
   The slope is measured on the core's own rest pass with each mechanism frozen at its 100 % value,
   one at a time and then all together. node tools/voidsplit.js [which ...] */
const path = require("path");
const B = require(path.join(__dirname, "bundle.js"));
const ev = B.headless("(n => eval(n))");
const G = new Proxy({}, {get:(t, k) => typeof k === "string" ? ev(k) : undefined});

const PRE = 5, c = 0;
G.plantPreset(PRE); G.buildLayout(); G.commission();
const PT = G.PT, ST = G.ST, SX = G.SX, XNN = G.XNN, XNZ = G.XNZ, XNR = G.XNR;
const snap = G.engSnap(G.engSnapNew());
const sat = G.eNodeSat(PT.coreNode[c]), pc = ST.csPCore[c], hfC = G.satH(sat, pc);

ev("globalThis.__origVQ = eVoidQualA; globalThis.__origSQ = eSubQualA; globalThis.__origRS = eRodShape; globalThis.__origAX = eCoreAxialA; 0");
ev("globalThis.__vqRec = null; globalThis.__vqPlay = null; globalThis.__vqI = 0; 0");
ev(`eVoidQualA = function(){ if(globalThis.__vqPlay){ E_VQ[2] = globalThis.__vqPlay[globalThis.__vqI % globalThis.__vqPlay.length]; globalThis.__vqI++; return; }
  globalThis.__origVQ(); if(globalThis.__vqRec) globalThis.__vqRec.push(E_VQ[2]); }`);
const flat = `eCoreAxialA = function(cc, mflux){ globalThis.__origAX(cc, mflux);
  const S0 = PT.coreSat[cc], p = ST.csPCore[cc];
  for(let j=0;j<XNZ;j++){ E_AXP[j] = p;
    E_RV[0] = p; satRvlA(S0, E_RV, 0, 1); E_AXRV[j] = E_RV[1];
    E_RV[4] = p; satTA(S0, E_RV, 4, 4); const Ts = E_RV[4];
    E_AXS[j] = Ts; eVgjA(S0);
    E_AXD[j] = E_RV[2]*E_RV[4]/Math.max(PT.coreG0[cc], 1e-9);
    if(PT.coreGas[cc]) E_AXFG[j] = PT.coreHfg[cc];
    else { E_RV[0] = Ts; curveA(S0, CV_HFG, E_RV, 0, 1); E_AXFG[j] = E_RV[1]; }
    E_AXJL[j] = Math.exp(-p/JL_P); } }`;
const off = () => ev("eVoidQualA = eVoidQualA; eSubQualA = globalThis.__origSQ; eRodShape = globalThis.__origRS; eCoreAxialA = globalThis.__origAX; globalThis.__vqPlay = null; globalThis.__vqRec = null; 0");

function rest(heat, inP, fz){
  G.engRestore(snap);
  const h0 = ST.coreInH[c];
  ST.csHeat[c] = heat; ST.coreInH[c] = hfC - (hfC - h0)*(inP === undefined ? heat : inP);
  off();
  if(fz){
    if(fz.chw){ ev("globalThis.__vqPlay = globalThis.__CHW; globalThis.__vqI = 0; 0"); }
    if(fz.flat) ev("eVoidQualA = function(){ E_VQ[2] = 0; }");
    if(fz.xd) ev(`eSubQualA = function(){ E_VQ[2] = Math.max(E_VQ[0], 0); }`);
    if(fz.phi) ev("eRodShape = function(){}");
    if(fz.axp) ev(flat);
  }
  for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
    for(let k=0;k<XNN;k++){ ST.csNV[c*XNN+k] = ST.csNVt[c*XNN+k]; ST.csNTc[c*XNN+k] = ST.csNTct[c*XNN+k]; } }
  off();
  const o = SX.coreO;
  return {vd:o[G.E_CO_VD], v:ST.csVNode[c], chw:Array.from(ST.csChW.subarray(c*XNR, c*XNR + XNR))};
}

/* the 100 % channel weighting, recorded as the quality the weighting law reads, so freezing it is exact */
ev("globalThis.__vqRec = []; 0");
G.engRestore(snap); ST.csHeat[c] = 1;
for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
  for(let k=0;k<XNN;k++){ ST.csNV[c*XNN+k] = ST.csNVt[c*XNN+k]; ST.csNTc[c*XNN+k] = ST.csNTct[c*XNN+k]; } }
ev("globalThis.__CHW = globalThis.__vqRec.slice(-" + XNN + "); globalThis.__vqRec = null; 0");
const chw100 = Array.from(ST.csChW.subarray(c*XNR, c*XNR + XNR));

const aV = PT.coreAV[c];
const slope = fz => { const lo = rest(1 - 0.005, 1, fz), hi = rest(1 + 0.005, 1, fz);
  return {s:(hi.vd - lo.vd)/aV, v:(hi.v + lo.v)/2, chw:hi.chw}; };

const want = process.argv.slice(2);
const cases = [["live", null], ["chw", {chw:1}], ["phi", {phi:1}], ["xd", {xd:1}], ["axp", {axp:1}],
  ["flat", {flat:1}], ["all", {chw:1, phi:1, xd:1, axp:1}], ["allf", {flat:1, phi:1, xd:1, axp:1}]];
const R = {};
for(const [n, fz] of cases){ if(want.length && want.indexOf(n) < 0) continue;
  const r = slope(fz); R[n] = r.s;
  process.stdout.write(n.padEnd(5) + " dalpha/dP " + r.s.toFixed(6) + " per %  void " + r.v.toFixed(4) +
    (R.live !== undefined && n !== "live" ? "  delta " + (r.s - R.live).toFixed(6) : "") + "\n"); }
if(R.live !== undefined && R.all !== undefined){
  let sum = 0; for(const n of ["chw", "phi", "xd", "axp"]) if(R[n] !== undefined) sum += R[n] - R.live;
  process.stdout.write("sum of single deltas " + sum.toFixed(6) + "  all-frozen delta " + (R.all - R.live).toFixed(6) +
    "  residual " + (R.all - R.live - sum).toFixed(6) + "\n"); }
process.stdout.write("csChW at 100 %: " + chw100.map(x => x.toFixed(3)).join(" ") + "\n");
process.stdout.write("axial drop " + G.E_AX[0].toFixed(4) + " MPa, friction " + G.E_AX[2].toFixed(4) +
  " MPa, Re " + G.E_AX[1].toFixed(0) + ", core throttle " + G.coreDpOf(G.roleId("core")) + " MPa\n");
