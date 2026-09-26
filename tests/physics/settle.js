"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
/* commissioning's rest state on one preset, against the shell's mass balance, steady continuity, stored mass at rest and each pump's suction off the saturation line */
const {check, commissionPreset, psat, if97} = require("./lib.js");
const pre = +process.argv[2];
const G = commissionPreset(pre);
const P = G.P, PT = G.PT, ST = G.ST, SX = G.SX, net = P.net, nb = PT.n.boiler, ids = G.IX.boilerId, name = G.PLANTPRE[pre][0];
const IF97 = "IAPWS-IF97 (2007 revision) region 4";
const GAPS = {"BWR/4":"BWR/4 cycle"};

check("IF97 region 4 in this test: psat(500 K)", psat(500), 2.63889776, 1e-8, IF97 + " verification table", {unit:"MPa"});

/* the settled field: every free node with no store passes what it takes */
{ const snap = G.engSnap(G.engSnapNew());
  G.eSettleSteady();
  const n = PT.n.node, E = PT.n.edge;
  const worstOf = q => { const d = new Float64Array(n), thru = new Float64Array(n); let big = 0;
    for(let e=0;e<E;e++){ d[PT.edU[e]] -= q[e]; d[PT.edV[e]] += q[e]; const a = Math.abs(q[e]); thru[PT.edU[e]] += a/2; thru[PT.edV[e]] += a/2; if(a > big) big = a; }
    let worst = 0, at = "";
    for(let i=0;i<n;i++){ if(SX.fixHas[i] || SX.stCap[i] > 0 || SX.nDeg[i]) continue;
      const r = Math.abs(d[i])/Math.max(thru[i], big); if(r > worst){ worst = r; at = net.name[i]; } }
    return [worst, at]; };
  const q = Float64Array.from(SX.edQ), [worst, at] = worstOf(q);
  check(name + ": settled field continuity, worst free node (" + at + ")", worst, 0, 1e-9, "continuity: sum of flows at a node with no store is 0", {abs:true, unit:"of throughput"});
  let e0 = 0; for(let e=0;e<E;e++) if(Math.abs(q[e]) > Math.abs(q[e0])) e0 = e;
  q[e0] *= 1 + 1e-6;
  check(name + ": fault injected, largest edge flow off by 1e-6: continuity fails", worstOf(q)[0] > 1e-9 ? 1 : 0, 1, 0, "the continuity check above must be able to fail", {abs:true});
  G.engRestore(snap); G.eNetInvalidate(); }

/* each running pump's suction against ITS OWN required suction at rest: NPSH available is p - p_sat(T) there, water against IF97, any other fluid against its own table */
{ const water = PT.sats[PT.satWater];
  for(let p=0;p<PT.n.pump;p++){ const si = PT.pumpSuc[p]; if(si < 0 || !(ST.flowBy[p] > 0)) continue;
    const c = G.eNodeSat(si), T = G.eNodeT(si), pS = G.eNodeP(si), ps = c === water ? psat(T) : G.satP(c, T);
    const inRecirc = PT.nodeCirc[si] >= 0 && G.nodeGraph().coreCirc === PT.nodeCirc[si];
    check(name + ": " + G.IX.pumpId[p] + " suction over its own NPSHr at rest (T " + T.toFixed(1) + " K)", pS - ps - PT.pumpNPSHr[p], 0, 0,
      "a pump at rated duty does not cavitate: NPSH available exceeds REQUIRED, not merely saturation (ANSI/HI 9.6.1, ISO 9906); " + (c === water ? IF97 : "the coolant's own saturation table"),
      {unit:"MPa", pass: pS - ps - PT.pumpNPSHr[p] > 0, gap: inRecirc ? GAPS[name] || "" : "",
       note:"NPSHa " + (pS - ps).toFixed(4) + " NPSHr " + PT.pumpNPSHr[p].toFixed(4) + " MPa"}); } }

/* each vacuum condenser's hotwell column on its condensate nozzle: the water's own depth over the drawn height's prism of the pool */
for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q], m = ST.mBy[i];
  if(i < 0 || !PT.condVac[q] || G.eNodeSat(i) !== PT.sats[PT.satWater] || !(m > 0)) continue;
  const T = G.eNodeT(i), rho = 1/if97(G.eNodeP(i), T).v, H = PT.condPoolH[q], h = m*H/(rho*PT.nodeVol[i]);
  G.ePoolHA(i);
  check(name + ": " + G.IX.condId[q] + " hotwell column on its condensate nozzle at rest", G.E_EC[4], rho*9.80665e-6*h, 1e-6,
    "hydrostatics: rho g h over the water's own depth h = m/(rho A), A the pool's volume over its drawn height; rho " + IF97.replace("region 4", "region 1") + " at the pool's own T",
    {unit:"MPa", note:"depth " + h.toFixed(3) + " of " + H.toFixed(3) + " m drawn, T " + T.toFixed(1) + " K"}); }

/* each condenser's steam space at rest: enthalpy the field lands on it less what it drains, against the tubes, its skin and the shaft and feed-heater duty its steam still carries */
const condFirstLaw = q => { const i = PT.condVes[q], hf = G.satH(G.eNodeSat(i), G.eNodeP(i)); let e = 0;
  for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed], w = PT.edV[ed] === i ? w0 : -w0;
    e += w*(w < 0 && PT.edLiqAt[ed] === i ? hf : ST.hBy[w0 > 0 ? PT.edU[ed] : PT.edV[ed]]); }
  let feed = 0; for(let b=0;b<nb;b++) feed += G.eFeedHeatKW(b);
  const a = PT.condPart[q], rej = G.eCondRej(q);
  return [(e - rej - (a >= 0 ? ST.skinQ[a] : 0) - (G.eMwE()*1000 + feed)/PT.n.cond)/rej, rej]; };
for(let q=0;q<PT.n.cond;q++){ if(PT.condVes[q] < 0 || !PT.condVac[q]) continue;
  const [r, rej] = condFirstLaw(q);
  check(name + ": " + G.IX.condId[q] + " steam space first law at rest", r, 0, 1e-3, "first law on a control volume at steady state: sum of w.h in - out = heat removed", {abs:true, unit:"of the tube duty", note:"tubes " + (rej/1000).toFixed(1) + " MW"});
  const snap = G.engSnap(G.engSnapNew());
  ST.condTBy[q] += 0.1;
  check(name + ": fault injected, " + G.IX.condId[q] + " 0.1 K hotter: the first law check fails", Math.abs(condFirstLaw(q)[0]) > 1e-3 ? 1 : 0, 1, 0, "the first law check above must be able to fail", {abs:true});
  G.engRestore(snap); G.eNetInvalidate(); }

const pumpMargin = id => { const p = G.IX.pumpId.indexOf(id), si = PT.pumpSuc[p], pS = G.eNodeP(si); return pS - psat(G.eNodeT(si)) - 1e-6*pS; };

/* first tick off the settle: feed in = steam out, and every node's water where it was */
{ const snap = G.engSnap(G.engSnapNew()), m0 = Float64Array.from(ST.mBy);
  ST.sc[G.SC_DICEOFF] = 1; G.step(0.02);
  for(let b=0;b<nb;b++)
    check(name + ": first tick feed = steam, " + ids[b], ST.sgFedBy[b], ST.steamBy[b], 1e-2, "shell mass balance at rest", {unit:"kg/s"});
  let worst = 0, at = "";
  for(let i=0;i<PT.n.node;i++){ const m = m0[i]; if(!(m > 0) || PT.nodeCont[i] || PT.nodeBooked[i]) continue;
    const r = Math.abs(ST.mBy[i] - m)/m; if(r > worst){ worst = r; at = net.name[i]; } }
  check(name + ": first tick, worst node mass change (" + at + ")", worst, 0, 1e-6, "conservation at steady state: a node at rest neither fills nor drains", {abs:true, unit:"of its mass per tick", gap:"Commissioned plant on its first tick"});
  /* the SAME kind of node (a steam generator's right-face port) on every preset that has one: BWR/4's build owns the miss if the shared builder does not move the others too */
  for(let i=0;i<PT.n.node;i++){ if(!/^sg\d+r$/.test(net.name[i])) continue;
    const m = m0[i]; if(!(m > 0) || PT.nodeCont[i] || PT.nodeBooked[i]) continue;
    const r = Math.abs(ST.mBy[i] - m)/m;
    check(name + ": first tick, " + net.name[i] + " mass change", r, 0, 1e-6, "conservation at steady state: a node at rest neither fills nor drains", {abs:true, unit:"of its mass per tick", gap: name === "BWR/4" ? "Commissioned plant on its first tick" : ""}); }
  G.engRestore(snap); G.eNetInvalidate(); }

/* WINDSCALE, renamed CALDER HALL: does the condenser tube duty still step across tick 1 on the COND_P0 floor? */
if(name === "CALDER HALL" && PT.n.cond > 0){ const snap = G.engSnap(G.engSnapNew());
  const q = 0, restRej = G.eCondRej(q), restP = ST.condPBy[q];
  ST.sc[G.SC_DICEOFF] = 1; G.step(0.02);
  const tick1Rej = G.eCondRej(q), tick1P = ST.condPBy[q];
  check(name + ": condenser tube duty, rest to tick 1", (tick1Rej - restRej)/restRej, 0, 1e-3, "first law at steady state: the duty should not step across a tick that changes nothing",
    {abs:true, unit:"of rest duty", note:"rest " + (restRej/1000).toFixed(3) + " MW at " + restP.toFixed(6) + " MPa, tick1 " + (tick1Rej/1000).toFixed(3) + " MW at " + tick1P.toFixed(6) + " MPa, floor " + G.COND_P0 + " MPa"});
  G.engRestore(snap); G.eNetInvalidate(); }

/* the suction check seen to fail: the condensate pump's suction water heated to 0.5 K over its own saturation */
if(G.IX.pumpId.indexOf("cpump") >= 0){ const snap = G.engSnap(G.engSnapNew());
  const si = PT.pumpSuc[G.IX.pumpId.indexOf("cpump")], c = G.eNodeSat(si);
  ST.hBy[si] = G.hOfT(c, G.satT(c, G.eNodeP(si)) + 0.5);
  const m = pumpMargin("cpump");
  check(name + ": fault injected, cpump suction heated past saturation: the suction check fails", m <= 0 ? 1 : 0, 1, 0, "the suction check above must be able to fail", {abs:true, note:"margin " + m.toExponential(2) + " MPa"});
  G.engRestore(snap); G.eNetInvalidate(); }

/* the loop's pressure at its own tap, 1 s from rest, against the base its HI and LO PRESS alarms and its pressure trip are set from */
{ const snap = G.engSnap(G.engSnapNew()), ci = PT.coreCirc0, pn = PT.circPNode[ci];
  const SRC = "a pressure alarm or trip is set a stated margin off the pressure the plant runs at, read at the same tapping (NUREG-1431 Rev. 4, Table 3.3.1-1 Function 8: 2385 psig over a 2235 psig operating pressure)";
  const march = () => { G.engRestore(snap); G.eNetInvalidate(); ST.sc[G.SC_DICEOFF] = 1;
    for(let i=0;i<50;i++) G.step(0.02); return G.eLoopP(ci)/P.P0; };
  const clear = r => r > 0.935 && r < 1.05, r = march();
  check(name + ": loop pressure at its tap after 1 s at rest over its alarm base", r, 1, 0.05, SRC,
    {pass:clear(r), note:"tap " + (pn >= 0 ? net.name[pn] : "none") + ", LO PRESS under 0.935, HI PRESS over 1.05, trip at " + (PT.rpsSet[G.RPS_CH.findIndex(q => q[0] === "php")]/P.P0).toFixed(4)});
  if(name === "CALDER HALL"){
    PT.circPNode[ci] = PT.coreNode0;
    const rc = march();
    PT.circPNode[ci] = pn;
    check(name + ": fault injected, tap moved to the core, a circulator's head off the base: the check fails", clear(rc) ? 0 : 1, 1, 0, "the tapping check above must be able to fail", {abs:true, note:"ratio " + rc.toFixed(4)});
    G.engRestore(snap); G.eNetInvalidate(); ST.sc[G.SC_DICEOFF] = 1;
    G.IX.blockId.forEach((id, k) => { const b = G.D.blocks[id]; if(b.mode === "sink" && b.sink === "scram") ST.blkOn[k] = 1; });
    for(let i=0;i<PT.n.node;i++) if(PT.nodeCirc[i] === ci) ST.mBy[i] *= 1.15;
    let tr = 0; for(let i=0;i<500 && !ST.sc[G.SC_SCRAMMED];i++){ G.step(0.02); tr = i*0.02; }
    check(name + ": fault injected, 15 % more gas in the circuit: the reactor trips", ST.sc[G.SC_SCRAMMED] ? 1 : 0, 1, 0, SRC, {abs:true, note:"at " + tr.toFixed(2) + " s, loop " + (G.eLoopP(ci)/P.P0).toFixed(4) + " of base"}); }
  G.engRestore(snap); G.eNetInvalidate(); }

if(pre !== 0) return;
/* STOCK: the settle is a function of the plant, and a nudge moves the valve by the root's own sensitivity */
const c0 = P.turbC;
const settle = c => { P.turbC = c; P.snap0 = null; G.resetPlant(); return Float64Array.from(ST.fregBy.subarray(0, nb)); };
const base = settle(c0), again = settle(c0);
{ let d = 0; for(let b=0;b<nb;b++) d = Math.max(d, Math.abs(again[b] - base[b]));
  check(name + ": same plant settled twice lands the same feed valve", d, 0, 1e-4, "a rest state is a function of the plant, not of the last settle; the tube UA refit stops at a 1e-4 miss", {abs:true, unit:"valve fraction"}); }
for(const rel of [1e-6, -1e-6, 1e-4, -1e-4]){
  const v = settle(c0*(1 + rel));
  let d = 0; for(let b=0;b<nb;b++) d = Math.max(d, Math.abs(v[b] - base[b]));
  check(name + ": turbine C nudged by " + rel + ": feed valve moves", d, 0, 1e-3, "continuity of a regular root: |dv| ~ rel x steam/|dFeed/dv|, far under 1e-3 here", {abs:true, unit:"valve fraction"}); }
