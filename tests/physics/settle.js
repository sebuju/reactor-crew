"use strict";
// chunks: 0 1 2 3 4 6 7 8
/* commissioning's rest state on one preset, against the shell's mass balance, steady continuity, stored mass at rest and each pump's suction off the saturation line; RBMK-1000 is out (its reference never settles, a stated row) */
const {check, commissionPreset, psat} = require("./lib.js");
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

/* each running pump's suction off the saturation line at rest: water against IF97, any other fluid against its own table */
{ const water = PT.sats[PT.satWater];
  for(let p=0;p<PT.n.pump;p++){ const si = PT.pumpSuc[p]; if(si < 0 || !(ST.flowBy[p] > 0)) continue;
    const c = G.eNodeSat(si), T = G.eNodeT(si), pS = G.eNodeP(si), ps = c === water ? psat(T) : G.satP(c, T);
    const inRecirc = PT.nodeCirc[si] >= 0 && G.nodeGraph().coreCirc === PT.nodeCirc[si];
    check(name + ": " + G.IX.pumpId[p] + " suction over saturation at rest (T " + T.toFixed(1) + " K)", pS - ps, 0, 0,
      "a pump at rated duty does not cavitate: NPSH available exceeds required (ANSI/HI 9.6.1); " + (c === water ? IF97 : "the coolant's own saturation table"),
      {unit:"MPa", pass: pS - ps > 1e-6*pS, gap: inRecirc ? GAPS[name] || "" : ""}); } }

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
  G.engRestore(snap); G.eNetInvalidate(); }

/* the suction check seen to fail: the condensate pump's suction water heated to 0.5 K over its own saturation */
if(G.IX.pumpId.indexOf("cpump") >= 0){ const snap = G.engSnap(G.engSnapNew());
  const si = PT.pumpSuc[G.IX.pumpId.indexOf("cpump")], c = G.eNodeSat(si);
  ST.hBy[si] = G.hOfT(c, G.satT(c, G.eNodeP(si)) + 0.5);
  const m = pumpMargin("cpump");
  check(name + ": fault injected, cpump suction heated past saturation: the suction check fails", m <= 0 ? 1 : 0, 1, 0, "the suction check above must be able to fail", {abs:true, note:"margin " + m.toExponential(2) + " MPa"});
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
