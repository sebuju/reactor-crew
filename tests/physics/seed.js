"use strict";
/* Commissioning's seed walk (eAdvectSeed) against the direction water can actually travel: a check valve
   passes one way, so a line commissions in the state of whatever can REACH it. The rig is the fidelity row's
   own shape - a hot boundary, a check valve pointing back at it, and a stub behind the valve that nothing
   anchors. A pressurizer is not a seed anchor (PT.tankHold), so the hot boundary is the only state on offer. */
const {load, check, rig} = require("./lib.js");
const G = load();

let stub;
rig(R => {
  R.tank("hotT", 4, 10, 0.3, {vol:50, fluid:"contaminated"});        // FLUID.contaminated: 400 K, and a seed anchor
  const t = R.fit(16, 10, "tee");
  R.tank("pz", 26, 10, 0.3, {vol:50, hold:{p:0.3}, check:true});     // a pressurizer, so no anchor; checked, so one way OUT
  R.run(R.port("hotT", G.partOf("hotT").w, 0), R.port(t, -1, 0));
  /* netBuild reads the tank off the run's FIRST end first, so the checked tank needs the other end to be no tank at all */
  stub = R.run(R.port(t, G.partOf(t).w, 0), R.port("pz", -1, 0));
});
const PT = G.PT, ST = G.ST;
const key = G.pipeNetwork().find(r => G.runIdOf(r) === stub || r.rid === stub).key;
const i = G.P.net.index[G.runNodeOf(key)];
const hot = PT.tankFluidT[G.IX.tank.get("hotT")];

const eds = []; for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++) eds.push(PT.adjEdge[k]);
const dio = eds.map(e => PT.edDiode[e]);
check("the rig's stub does sit behind a check valve", dio.some(d => d !== 0) ? 1 : 0, 1, 0,
  "a checked tank's line passes out of the tank only (netBuild, PT.edDiode); without one the walk below proves nothing",
  {abs:true, note:"edge diodes " + dio.join(",")});

/* the walk re-run with only this node's state missing, so what reaches it is the only thing that can fill it */
const seedT = () => { const save = Float64Array.from(ST.hBy);
  ST.hBy[i] = NaN; G.eAdvectSeed();
  const T = G.eNodeT(i); ST.hBy.set(save); G.eNetInvalidate(); return T; };

const walled = seedT();
const was = eds.map(e => PT.edDiode[e]);
for(const e of eds) PT.edDiode[e] = 0;
const blind = seedT();
eds.forEach((e, j) => PT.edDiode[e] = was[j]);

check("seed does not cross a check valve against its pass direction", Math.abs(walled - hot), 0, 1,
  "water does not arrive where it cannot flow to: a check valve passes one way, so the state a line commissions in is the state of whatever can reach it",
  {unit:"K", abs:true, pass:Math.abs(walled - hot) > 1,
   note:"stub " + walled.toFixed(2) + " K, the boundary it cannot reach " + hot.toFixed(2) + " K"});
check("fault injected, diode stood down: the walk carries the hot boundary across", blind, hot, 0.5,
  "the check above must be able to fail", {unit:"K", abs:true, note:"stub " + blind.toFixed(2) + " K"});
