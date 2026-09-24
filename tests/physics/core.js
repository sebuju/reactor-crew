"use strict";
// chunks: 0 1 2 3 4 5 6 7 8
/* the commissioned core at rest: its flux shape a solution of its own equation, xenon at equilibrium on that shape, and a critical core with rods and boron held holds still */
const {check, commissionPreset} = require("./lib.js");
const pre = +process.argv[2];
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, nc = PT.n.core;
/* the plant around the core, not the core: BWR/4's shell settle has no root */
const GAP_REST = name === "BWR/4" ? "BWR/4 cycle" : "";

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

/* F_q is a LOCAL flux peak and is what a burnout correlation asks for; F_dH is the hottest CHANNEL's integrated rise and is what a margin to boiling asks for */
{ const c = 0, XNZ = G.XNZ, XNR = G.XNR, nb = c*XNN, RW = G.ringW, ROW = "enthalpy-rise peaking";
  const cp = PT.coreCp[c], Tin = G.eNetCoreInH(c)/cp, sat = G.satT(PT.coreSat[c], ST.csPCore[c]);
  let mean = 0, hot = 0;
  for(let i=0;i<XNR;i++){ const r = ST.csNTct[nb + i*XNZ + XNZ - 1] - Tin; mean += RW[i]*r; if(r > hot) hot = r; }
  const fdh = hot/Math.max(mean, 1e-9), fq = ST.csFq[c];
  const both = "F_dH " + fdh.toFixed(4) + ", F_q " + fq.toFixed(4);
  if(pre === 0){
    const WSRC = "Westinghouse four-loop technical specification limits, F_dH 1.65 and F_q 2.50 at rated power: a core is operated at or under them, and a real PWR runs nominal F_dH about 1.45-1.55 and nominal F_q about 1.9-2.2";
    check(name + ": enthalpy-rise peaking, the hottest channel's integrated rise over the core mean", fdh, 1.65, 0, WSRC,
      {pass:fdh <= 1.65, note:both});
    check(name + ": total flux peaking, the hottest node over the core mean", fq, 2.50, 0, WSRC,
      {pass:fq <= 2.50, gap:ROW, note:both});
  }
  if(PT.coreDnbLaw[c] === G.E_DNB_BOIL){
    const lim = nb + ST.csDnbrRing[c]*XNZ + ST.csDnbrLev[c], sub = sat - Tin;
    const onQ = sub/Math.max(mean*fq, 1e-3);
    check(name + ": the margin to boiling is the inlet subcooling over the LIMITING CHANNEL'S own integrated rise",
      sub/Math.max(ST.csNTct[lim] - Tin, 1e-3), ST.csDnbrMin[c], 1e-12,
      "how close a channel is to boiling is set by how far its own coolant has heated, which is the enthalpy-rise peaking, not by the local flux peak",
      {note:both + ", subcooling " + sub.toFixed(1) + " K, core mean rise " + mean.toFixed(1) + " K, limiting ring " + ST.csDnbrRing[c] + " plane " + ST.csDnbrLev[c]});
    check(name + ": fault injected, the same margin built on the flux peak instead: it does not reconstruct",
      Math.abs(onQ/ST.csDnbrMin[c] - 1) > 1e-6 ? 1 : 0, 1, 0,
      "the reconstruction above must be able to tell the two peaking factors apart", {abs:true,
        note:"built on F_q it reads " + onQ.toFixed(4) + " against the model's " + ST.csDnbrMin[c].toFixed(4)});
  } }

/* W-3 (Tong 1967) is stated in psia, lbm/h/ft2, inches and Btu/lbm; the test side carries it in those units and converts with derived factors, so a conversion that drifts is caught */
if(PT.coreDnbLaw[0] === G.E_DNB_W3){
  const c = 0, PSI = 6894.757, LBM = 0.45359237, FT = 0.3048, IN = 0.0254, BTU = 1055.056;
  const toPsia = 1e6/PSI, toGi = FT*FT/LBM*3600, toIn = 1/IN, toBtu = LBM/BTU*1000, toWm2 = BTU/3600/(FT*FT);
  const w3 = (pMPa, gSI, x, dM, dhSub) => {
    const p = Math.min(Math.max(pMPa*toPsia, 1000), 2300), g = Math.min(Math.max(gSI*toGi/1e6, 1), 5);
    const de = Math.min(Math.max(dM*toIn, 0.2), 0.7), q = Math.min(Math.max(x, -0.15), 0.15), hs = Math.max(dhSub, 0)*toBtu;
    return toWm2*1e6*((2.022 - 4.302e-4*p) + (0.1722 - 9.84e-5*p)*Math.exp((18.177 - 4.129e-3*p)*q))
      *((0.1484 - 1.596*q + 0.1729*q*Math.abs(q))*g + 1.037)*(1.157 - 0.869*q)
      *(0.2664 + 0.8357*Math.exp(-3.151*de))*(0.8258 + 7.94e-4*hs); };
  const pMPa = ST.csPCore[c], gSI = PT.coreG0[c]*PT.coreFlowK[c]*G.SX.coreFN[c];
  const cp = PT.coreCp[c], Tin = G.eNetCoreInH(c)/cp, dhSub = cp*(G.satT(PT.coreSat[c], pMPa) - Tin);
  const qMean = PT.coreRated[c]*1e6/PT.coreAHeat[c], x0 = 0;
  G.E_MN[0] = 1; G.E_MN[1] = 1; G.E_MN[2] = Tin; G.E_MN[3] = Tin;
  G.E_MN[4] = gSI/PT.coreG0[c]; G.E_MN[5] = x0; G.E_MN[6] = dhSub; G.E_MN[8] = pMPa; G.E_MN[9] = 0; G.E_MN[10] = Infinity;
  G.eMarginNode(c);
  const modelChf = G.E_MN[7]*qMean;
  check(name + ": the W-3 critical heat flux at the core's own rest conditions, against the paper's own units",
    modelChf, w3(pMPa, gSI, x0, PT.coreDh[c], dhSub), 1e-5,
    "W-3, Tong 1967, stated for 1000-2300 psia, 1-5 Mlbm/h/ft2, 0.2-0.7 in and quality -0.15 to 0.15; the test side converts with 1 psi = 6894.757 Pa, 1 lbm = 0.45359237 kg, 1 ft = 0.3048 m, 1 in = 0.0254 m, 1 Btu = 1055.056 J",
    {unit:"W/m2", note:"the engine carries the same conversions rounded to six figures, which is the whole of the distance; p " +
      (pMPa*toPsia).toFixed(0) + " psia, G " + (gSI*toGi/1e6).toFixed(3) + " Mlbm/h/ft2, d_e " +
      (PT.coreDh[c]*toIn).toFixed(3) + " in, inlet subcooling " + (dhSub*toBtu).toFixed(1) + " Btu/lbm"});
}

{ sc[G.SC_DICEOFF] = 1;
  G.uiBlkSinkOff("rodStep"); G.uiBlkSinkOff("boronDem");
  const h0 = Float64Array.from(ST.csHeat.subarray(0, nc));
  const rho = new Float64Array(nc), heat = new Float64Array(nc);
  G.step(0.02); const loss = Array.from({length:nc}, (_, c) => G.eCircLoss(c));
  for(let c=0;c<nc;c++) rho[c] = Math.abs(ST.csRho[c] - loss[c]);
  for(let t=1;t<150;t++){ G.step(0.02);
    for(let c=0;c<nc;c++){ rho[c] = Math.max(rho[c], Math.abs(ST.csRho[c] - loss[c])); heat[c] = Math.max(heat[c], Math.abs(ST.csHeat[c]/h0[c] - 1)); } }
  for(let c=0;c<nc;c++){
    check(name + ": core " + c + " net reactivity over 3 s at rest, rods and boron held", rho[c], 0, 0.5,
      "a critical core at constant boundary conditions has dn/dt = 0 with every precursor at equilibrium: rho = the precursors' loss to the loop, 0 for a fuel that stays put; 0.5 pcm is 1/1300 of beta", {abs:true, unit:"pcm", gap:GAP_REST, note:loss[c] ? "circulating, held at " + loss[c].toFixed(2) + " pcm" : ""});
    check(name + ": core " + c + " heat over 3 s at rest, rods and boron held", heat[c], 0, 1e-3,
      "a critical core at constant boundary conditions: n constant", {abs:true, unit:"of commissioned", gap:GAP_REST}); } }
