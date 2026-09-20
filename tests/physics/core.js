"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
/* the commissioned core at rest: its flux shape a solution of its own equation, xenon at equilibrium on that shape, and a critical core with rods and boron held holds still */
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2];
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, nc = PT.n.core;
/* the plant around the core, not the core: BWR/4's shell settle has no root */
const GAP_REST = name === "BWR/4" ? "BWR/4 cycle" : name === "CALDER HALL" ? "CALDER HALL at rest" : "";

/* the plan area of one lattice cell is fuel, clad, water, block and tube metal and nothing else */
{ const cD = G.priD(), v = G.latVols(cD), L = cD.lat, a = G.COOLANT[cD.cool];
  const cell = L.pitch*L.pitch, p0 = G.LAT_P0*G.LAT_P0;
  const clad = v.nF*(G.latRodFrac(cD) - G.latFuelFrac(cD))*p0;
  const bore = (cD.tube && cD.tube.bore || 0)/1000, wall = bore > 0 ? G.tubeWallMm(a.P0, a, cD)/1000 : 0;
  const tube = v.nF*Math.PI*(bore + wall)*wall;
  check(name + ": the drawn cell closes, fuel + clad + water + block + tube against the pitch squared",
    (v.fuel + clad + v.cool + v.mod + tube)/((v.nF + v.nM)*cell), 1, 1e-9,
    "area is conserved: every square metre of the lattice plan is one of the five", {unit:"of the plan area"});
  if(!(bore > 0)){
    check(name + ": states no bore, so a fuel slot is rods and water only", v.cool/(v.nF*(cell - G.latRodFrac(cD)*p0)), 1, 1e-12,
      "a water lattice's coolant is the whole cell less the rods", {unit:"of the water area"});
    check(name + ": states no bore, so only a moderator slot holds block", v.mod - v.nM*cell, 0, 1e-12,
      "a water lattice's moderator is the slots drawn as moderator", {abs:true, unit:"m2"});
  } else {
    const rods = G.latRodFrac(cD)*p0, w1 = v.cool/v.nF*1e4;
    check(name + ": water per fuel channel against the real machine's channel", w1, 1e4*(Math.PI/4*0.080*0.080 - 18*Math.PI/4*0.0136*0.0136), 0.01,
      "RBMK-1000 cell: an 80 mm pressure-tube bore around 18 fuel rods at 13.6 mm leaves 24.1 cm2 of water (INSAG-7 annex I)",
      {unit:"cm2", note:"drawn bore " + (bore*1000).toFixed(0) + " mm, " + Math.round(G.latBundle(cD).nRod) + " rods at " + (G.rodD(cD)*1000).toFixed(1) + " mm"});
    check(name + ": block per fuel cell against the real machine's cell", v.mod/v.nF*1e4, 1e4*(0.25*0.25 - Math.PI/4*0.088*0.088), 0.01,
      "RBMK-1000 cell: a 250 mm graphite block with an 88 mm tube through it leaves 564 cm2 of graphite (INSAG-7 annex I)",
      {unit:"cm2", note:"drawn pitch " + (L.pitch*1000).toFixed(0) + " mm, tube OD " + ((bore + 2*wall)*1000).toFixed(1) +
        " mm off a Barlow wall of " + (wall*1000).toFixed(1) + " mm against the real 4.0 mm"});
    const bad = Math.PI/4*(1.2*bore)*(1.2*bore) - rods;
    check(name + ": fault injected, bore 20 % wide: the water check fails", Math.abs(bad*1e4/w1 - 1) > 0.01 ? 1 : 0, 1, 0,
      "the water check above must be able to fail", {abs:true});
  } }

{ const snap = G.engSnap(G.engSnapNew());
  for(let c=0;c<nc;c++){ const nb = c*XNN, phi0 = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN));
    G.eCoreRestStep(c, ST.csFlowNet[c]);
    let d = 0; for(let k=0;k<XNN;k++) d = Math.max(d, Math.abs(ST.csPhi[nb+k] - phi0[k])/phi0[k]);
    check(name + ": core " + c + " flux shape, one more rest pass moves it", d, 0, 1e-6,
      "a steady flux is a solution of its own diffusion equation: one more iteration from it returns it", {abs:true, unit:"of the node's flux"}); }
  G.engRestore(snap); G.eNetInvalidate(); }

for(let c=0;c<nc;c++){ const nb = c*XNN, n = ST.csN[c];
  const gI = PT.coreGI[c], gX = PT.coreGX[c], lI = PT.coreLamI[c], lX = PT.coreLamX[c], sg = PT.coreSig[c];
  let dI = 0, dX = 0;
  for(let k=0;k<XNN;k++){ const fl = n*ST.csPhi[nb+k], I = gI*fl/lI, X = (gI + gX)*fl/(lX + sg*fl);
    dI = Math.max(dI, Math.abs(ST.csXI[nb+k]/I - 1)); dX = Math.max(dX, Math.abs(ST.csXX[nb+k]/X - 1)); }
  const src = "I-135 / Xe-135 balance with d/dt = 0: I = gI.phi/lamI, X = (gI + gX).phi/(lamX + sig.phi) (Lamarsh & Baratta, Introduction to Nuclear Engineering, ch. 7)";
  check(name + ": core " + c + " iodine at equilibrium on the node's own flux, worst node", dI, 0, 1e-9, src, {abs:true, unit:"relative"});
  check(name + ": core " + c + " xenon at equilibrium on the node's own flux, worst node", dX, 0, 1e-9, src, {abs:true, unit:"relative"}); }

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
