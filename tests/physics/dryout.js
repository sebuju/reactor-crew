"use strict";
// chunks: take stage book core
// preset: 0
/* a source never vanishes: take = the take-up cap by hand, stage = a stage's two streams pass the same heat, book = the core's refused heat is carried, core = a surface its water will not cool keeps its heat */
const {check, commissionPreset, swap, watch, if97, if97r2, tsat} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0), PT = G.PT, ST = G.ST, SX = G.SX, S = G.E_SRC, c = 0, XNN = G.XNN, W = G.nodeW, DT = 0.02;
ST.sc[G.SC_DICEOFF] = 1;
const ROW = "heat into a node that has lost its water";
const hW = (T, p) => T < tsat(p) ? if97(p, T).h : if97r2(p, T).h;
const still = i => { for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++) ST.edW[PT.adjEdge[k]] = 0; };
const take = (i, q, Ts) => { SX.tSrc[i] = 0; S[0] = q; S[1] = Ts; S[3] = DT; G.eSrcTake(i); return SX.tSrc[i]; };

if(mode === "take"){
  const i = PT.coreNode0, p = 7, m = 1000, T = 500, SRC = "IAPWS-IF97 region 1 by hand; the engine's steam tables interpolate h to ~3e-7";
  still(i); ST.pBy[i] = p; ST.mBy[i] = m; ST.hBy[i] = hW(T, p);
  const up = m*(hW(540, p) - hW(T, p))/DT, dn = m*(hW(T, p) - hW(460, p))/DT;
  check("a node of 1 t at 500 K, 7 MPa, nothing arriving, offered half what it takes toward a 540 K surface: it takes all of it", take(i, up/2, 540), up/2, 0, "nothing to refuse", {unit:"kW"});
  check("the same node offered twice what it takes toward 540 K: it takes m (h(540 K) - h)/dt", take(i, 2*up, 540), up, 1e-5, SRC, {unit:"kW"});
  check("the same node cooled toward a 460 K surface, twice what it gives: it gives m (h - h(460 K))/dt", take(i, -2*dn, 460), -dn, 1e-5, SRC, {unit:"kW"});
  ST.hBy[i] = G.hOfTP(G.SAT_WATER, 540, p);
  check("a node already at the surface's own temperature takes nothing", take(i, up, 540), 0, 0, "no temperature difference, no heat", {abs:true, unit:"kW"});
  ST.hBy[i] = hW(T, p);
  let e = -1, f = -1;
  for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const o = PT.adjOther[k]; if(PT.nodeBooked[o] || ST.mBy[o] !== ST.mBy[o]) continue; e = PT.adjEdge[k]; f = o; break; }
  const w = 50, Tf = 400;
  ST.edW[e] = PT.edV[e] === i ? w : -w; ST.hBy[f] = hW(Tf, p); ST.pBy[f] = p; SX.fX[f] = 0;
  const arr = up + w*(hW(540, p) - hW(Tf, p));
  check("the same node with 50 kg/s arriving at 400 K, offered three times its holdup's share: it takes its holdup's and the arrivals' way to 540 K", take(i, 3*up, 540), arr, 1e-5, SRC, {unit:"kW"});
  const back = swap(G, "eTakeCapA", " + E_NIN[2]*hs - E_NIN[3]", "");
  const bad = take(i, 3*up, 540); back();
  check("fault injected, the arrivals left out: the check above fails", Math.abs(bad/arr - 1) > 1e-5 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"takes " + (bad/arr).toFixed(4) + " of it"});
}

if(mode === "stage"){
  watch(G, {cap:5*DT});
  const k = 0, sh = PT.stgShell[k], A = PT.stgA0[k], B = PT.stgB0[k], a = PT.stgPart[k], b = PT.sgBoiler[PT.stgSg[k]];
  const heat = () => { const E = G.E_TK; E[G.E_TK_HEAT] = ST.sc[G.SC_HEAT]; E[G.E_TK_FLOW] = ST.sc[G.SC_FLOWNET]; G.eSgHeatStep(); };
  const sides = () => { G.eAdvectSrc(DT); const s = SX.tSrc, mq = SX.tMetQ;
    return {give:-(s[A] - mq[A]) - (s[B] - mq[B]), take:s[sh] - mq[sh] - ST.sgSwQBy[PT.stgSg[k]] + (a >= 0 ? ST.skinQ[a] : 0)}; };
  heat(); const q0 = ST.hbSgQ[b];
  still(sh); ST.mBy[sh] = 1e-3; SX.fWet[sh] = 0;
  heat(); const q1 = ST.hbSgQ[b], d = sides();
  check("a generator whose shell holds 1 g and is fed nothing: the primary gives what the shell takes, every kW", d.give - d.take, 0, 1e-12*q0, "first law across the tubes", {abs:true, unit:"kW", note:"passes " + q1.toExponential(3) + " kW against " + q0.toExponential(3) + " kW wet"});
  check("the same shell: the stage passes what 1 g of shell water takes toward the primary", q1/q0, 0, 1e-4, "a dry surface heats no water", {abs:true, unit:"of the wet duty"});
  const back1 = swap(G, "eSgHeatStep", "if(q > 0){ S[0] = -sg;", "if(false){ S[0] = -sg;");
  const back2 = swap(G, "eSrcAdd", "SX.tSrc[i] += q;", "SX.tSrc[i] += q*SX.fWet[i];");
  heat(); const f = sides(); back1(); back2();
  check("fault injected, the old gate on the dry shell: the check above fails", Math.abs(f.give - f.take) > 1e-12*q0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"primary gives " + f.give.toExponential(3) + " kW, shell takes " + f.take.toExponential(3)});
}

/* the core at 100 min of decay heat, pumped 20 s to shed its full-power stored heat, then its vessel emptied to 1 mg of steam with nothing arriving and its level off the bottom */
const dryCore = (ticks, each) => {
  const i = PT.coreNode0, p = 7, Ts = tsat(p), cs = G.E_CS, hg = G.satHg(G.SAT_WATER, p);
  let dec = 0; for(let k=0;k<G.E_DEC_N;k++) dec += G.E_DEC_A[k]*Math.exp(-G.E_DEC_L[k]*6000);
  ST.csPCore[c] = p; ST.csDecay[c] = dec; ST.csQRef[c] = 0;
  watch(G, {cap:1000*DT, step:() => { cs[0] = DT; cs[1] = dec; cs[2] = Ts; cs[3] = 1; cs[4] = 1; cs[5] = 1; cs[6] = PT.coreCp[c]*Ts; G.eCoreStep(c); }});
  watch(G, {cap:ticks*DT, step:() => {
    still(i); ST.pBy[i] = p; ST.mBy[i] = 1e-6; ST.hBy[i] = hg;
    const pre = {row:ST.csQRef[c]}; G.eCoreQWaterA(c); pre.offer = G.E_CQW[0];
    G.eAdvectSrc(DT); pre.acc = SX.tSrc[i] - SX.tMetQ[i]; pre.rowT = ST.csQRef[c];
    cs[0] = DT; cs[1] = dec; cs[2] = Ts; cs[3] = 0; cs[4] = 0; cs[5] = 0; cs[6] = PT.coreCp[c]*Ts;
    each(pre, dec, () => G.eCoreStep(c)); }});
};

if(mode === "book"){
  let off = 0, res = 0;
  const run = () => { off = 0; res = 0; dryCore(250, (pre, dec, step) => { off += Math.abs(pre.offer); res = Math.max(res, Math.abs(pre.offer - pre.acc - (pre.rowT - pre.row))); step(); }); return res/(off/250); };
  const snap = G.engSnap(G.engSnapNew()), r = run(), offMean = off/250;
  check("core at decay heat, its vessel empty: every tick offered = taken + refused into the core's own row, worst", r, 0, 1e-12,
    "conservation of energy: a source the water refuses is kept, never destroyed", {abs:true, unit:"of the tick's offer", note:"mean offer " + offMean.toFixed(0) + " kW"});
  G.engRestore(snap);
  const back = swap(G, "eCoreSrc", "ST.csQRef[c] += Q[0] - Q[2];", "");
  const rf = run(); back();
  check("fault injected, the refused heat dropped as the old gate dropped it: the check above fails", rf > 1e-12 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + rf.toExponential(2) + " of the offer"});
}

if(mode === "core"){
  const nb = c*XNN, rk = PT.coreRated[c]*1000;
  let C = 0;
  const U = () => { let u = 0; C = 0; for(let k=0;k<XNN;k++){ const q = nb + k;
    G.E_FU[0] = ST.csNTf[q]; G.eFuelHA(c); u += ST.csNFu[q]*G.E_FU[1]; C += ST.csNFu[q]*G.E_FU[2];
    G.E_CL[0] = ST.csNTcl[q]; G.E_CL[4] = ST.csNTcl[q]; G.eCladHA(c); u += ST.csNCl[q]*G.E_CL[1]; C += ST.csNCl[q]*G.E_CL[2]; } return u; };
  const tcl = () => { let m = 0, hi = 0; for(let k=0;k<XNN;k++){ m += W[k]*ST.csNTcl[nb+k]; hi = Math.max(hi, ST.csNTcl[nb+k]); } return {m, hi}; };
  const N = 1000, run = () => { let worst = 0, heatT = 0, back = 0, t0 = null, t1 = null, n = 0;
    dryCore(N, (pre, dec, step) => {
      let fis = 0; for(let k=0;k<XNN;k++) fis += ST.csNDw[nb+k]; fis *= dec*rk;
      const u0 = U(), r0 = ST.csQRef[c]; step();
      const P = r0 - ST.csQRef[c], out = ST.csFQ[c] + ST.csGQ[c] + ST.csDQ[c] + ST.csCQ[c];
      const r = (fis + ST.csQOx[c]*rk + P)*DT - (U() - u0) - out*DT;
      worst = Math.max(worst, Math.abs(r)/(C*G.E_FUEL_DT)); heatT += fis*DT; back += P*DT;
      if(++n === N/2) t0 = tcl(); if(n === N) t1 = tcl(); });
    return {worst, heatT, back, mean:(t1.m - t0.m)/(N/2*DT), hot:(t1.hi - t0.hi)/(N/2*DT), hi:t1.hi}; };
  const snap = G.engSnap(G.engSnapNew()), a = run();
  check("core at decay heat, its vessel empty: pins' fission + refused heat handed back = d(fuel U) + d(clad U) + heat offered, worst tick", a.worst, 0, 1,
    "first law on the pins, the fuel and the can on their own h(T) (fuel.js p, clad.js cl grade those against published data); both temperatures are inverted from h to E_FUEL_DT 1e-6 K", {abs:true, unit:"of their heat capacity x 1e-6 K", note:"handed back " + (a.back/a.heatT*100).toFixed(1) + " % of the heat"});
  check("the same core: cans heat up, area mean and hottest over 10-20 s", a.mean, 0.7, 0.3,
    "uncovered rods at decay heat heat up 0.4-1.0 K/s depending on the location in the core (NEA/CSNI/R(2000)21 sec. 2)",
    {abs:true, unit:"K/s", pass:a.mean <= 1.0 && a.hot >= 0.4, note:"mean " + a.mean.toFixed(3) + ", hottest " + a.hot.toFixed(3) + " K/s, hottest can " + a.hi.toFixed(0) + " K; passes if the span overlaps the band"});
  G.engRestore(snap);
  const back = swap(G, "eCoreStep", "const qR = rf ? rf*refW[q]/(pinUA*nodeW[q]) : 0", "const qR = 0");
  const f = run(); back();
  check("fault injected, the refused heat taken off the row and not put into the cans: the first-law check fails", f.worst > 1 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + f.worst.toExponential(2)});
}
