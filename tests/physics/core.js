"use strict";
// chunks: 0 1 2 3 4 6 7 8
/* the commissioned core at rest: its flux shape a solution of its own equation, xenon at equilibrium on that shape, and a critical core with rods and boron held holds still; RBMK-1000 is run by hand (node tests/physics/core.js 5), not gated */
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2];
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, nc = PT.n.core;
const GAP = pre === 5 ? "RBMK-1000 at rated power" : "";
/* the plant around the core, not the core: BWR/4's shell settle has no root */
const GAP_REST = GAP || (name === "BWR/4" ? "BWR/4 cycle" : "");

{ const snap = G.engSnap(G.engSnapNew());
  for(let c=0;c<nc;c++){ const nb = c*XNN, phi0 = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN));
    G.eCoreRestStep(c, ST.csFlowNet[c]);
    let d = 0; for(let k=0;k<XNN;k++) d = Math.max(d, Math.abs(ST.csPhi[nb+k] - phi0[k])/phi0[k]);
    check(name + ": core " + c + " flux shape, one more rest pass moves it", d, 0, 1e-6,
      "a steady flux is a solution of its own diffusion equation: one more iteration from it returns it", {abs:true, unit:"of the node's flux", gap:GAP}); }
  G.engRestore(snap); G.eNetInvalidate(); }

for(let c=0;c<nc;c++){ const nb = c*XNN, n = ST.csN[c];
  const gI = PT.coreGI[c], gX = PT.coreGX[c], lI = PT.coreLamI[c], lX = PT.coreLamX[c], sg = PT.coreSig[c];
  let dI = 0, dX = 0;
  for(let k=0;k<XNN;k++){ const fl = n*ST.csPhi[nb+k], I = gI*fl/lI, X = (gI + gX)*fl/(lX + sg*fl);
    dI = Math.max(dI, Math.abs(ST.csXI[nb+k]/I - 1)); dX = Math.max(dX, Math.abs(ST.csXX[nb+k]/X - 1)); }
  const src = "I-135 / Xe-135 balance with d/dt = 0: I = gI.phi/lamI, X = (gI + gX).phi/(lamX + sig.phi) (Lamarsh & Baratta, Introduction to Nuclear Engineering, ch. 7)";
  check(name + ": core " + c + " iodine at equilibrium on the node's own flux, worst node", dI, 0, 1e-9, src, {abs:true, unit:"relative", gap:GAP});
  check(name + ": core " + c + " xenon at equilibrium on the node's own flux, worst node", dX, 0, 1e-9, src, {abs:true, unit:"relative", gap:GAP}); }

{ sc[G.SC_DICEOFF] = 1;
  G.uiBlkSinkOff("rodStep"); G.uiBlkSinkOff("boronDem");
  const h0 = Float64Array.from(ST.csHeat.subarray(0, nc));
  const rho = new Float64Array(nc), heat = new Float64Array(nc);
  for(let c=0;c<nc;c++) rho[c] = Math.abs(ST.csRho[c]);
  for(let t=0;t<150;t++){ G.step(0.02);
    for(let c=0;c<nc;c++){ rho[c] = Math.max(rho[c], Math.abs(ST.csRho[c])); heat[c] = Math.max(heat[c], Math.abs(ST.csHeat[c]/h0[c] - 1)); } }
  for(let c=0;c<nc;c++){
    check(name + ": core " + c + " net reactivity over 3 s at rest, rods and boron held", rho[c], 0, 0.5,
      "a critical core at constant boundary conditions has dn/dt = 0 with every precursor at equilibrium: rho = 0; 0.5 pcm is 1/1300 of beta", {abs:true, unit:"pcm", gap:GAP_REST});
    check(name + ": core " + c + " heat over 3 s at rest, rods and boron held", heat[c], 0, 1e-3,
      "a critical core at constant boundary conditions: n constant", {abs:true, unit:"of commissioned", gap:GAP_REST}); } }
