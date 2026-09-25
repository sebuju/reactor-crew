"use strict";
// chunks: p0 e0 e5 e7 l0 l5 l7 t0 t1 t2 t3 t4 t5 t6 t7 t8 s0 s5 s7
/* the fuel pin between fission and water: p = UO2's own heat law and the engine's enthalpy door, e = the core's energy tick by tick over a rod step, l = the pin's lag with its water held, t = its capacity, time constant and pellet rise against the drawing, s = the heat that never enters the pin */
const {check, commissionPreset, coreShareHand, CLAD_OWN} = require("./lib.js");
const mode = process.argv[2], pre = +mode.slice(1);
const G = commissionPreset(pre), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;
const ROW = "core heat reaches the water through the fuel pin", CAP = "fuel heat capacity";
const rk = PT.coreRated[c]*1000;
/* share of rated per unit node weight into the water (w), the blocks (b) and the control channels (c) at flux p, void a and rod coverage cov, on the core's own decay heat carried by decay weight pd (p when absent) */
const outside = (p, heat, a, cov, pd = p) => { const s = coreShareHand(G, c, a, cov), hd = ST.csDecay[c], hp = heat - hd;
  return {w:p*hp*s.wp + pd*hd*s.wd, b:p*hp*s.bp + pd*hd*s.bd, c:p*hp*s.cp + pd*hd*s.cd}; };
/* the drawn moderator's own cp, kJ/kg/K */
const modCp = T => { const io = new Float64Array(2); io[0] = T; G.MODER[PT.coreModRow[c]].cpA(io, 0, 1); return io[1]; };
const filmMean = () => { let f = 0; for(let k=0;k<XNN;k++) f += W[k]*ST.csNFilm[nb+k]; return f; };

/* Fink, J. Nucl. Mater. 279 (2000) 1-18, solid UO2 per mol; k1 scales C1 for the fault */
const FM = 0.27003, FC1 = 81.613, FTH = 548.68, FC2 = 2.285e-3, FC3 = 2.360e7, FEA = 18531.7, T0 = 298.15;
const finkCp = (T, k1 = 1) => { const x = Math.exp(FTH/T);
  return (k1*FC1*FTH*FTH*x/(T*T*(x - 1)*(x - 1)) + 2*FC2*T + FC3*FEA*Math.exp(-FEA/T)/(T*T))/FM/1000; };
const finkH = (T, k1 = 1) => (k1*FC1*FTH*(1/(Math.exp(FTH/T) - 1) - 1/(Math.exp(FTH/T0) - 1)) + FC2*(T*T - T0*T0)
  + FC3*(Math.exp(-FEA/T) - Math.exp(-FEA/T0)))/FM/1000;
/* Fink & Petri, ANL/RE-97/2 (1997) Table 1.1.2: K, h - h(298.15) kJ/kg, cp J/kg/K; stated uncertainty h 1 % to 3120 K, cp 2 % to 2000 K */
const TAB = [[298.15, 0, 235.55], [400, 25.61, 264.07], [500, 52.85, 279.58], [600, 81.34, 289.63], [800, 140.68, 302.72], [1000, 202.18, 311.94],
  [1200, 265.35, 319.60], [1500, 362.84, 330.40], [1800, 464.01, 345.68], [2000, 534.92, 365.47], [2200, 611.30, 401.98], [2500, 746.30, 511.58],
  [2600, 800.22, 568.72], [2700, 861.73, 618.67], [3000, 1047.33, 618.67], [3120, 1121.57, 618.67]];

/* natural U metal, Kim & Hofman, ANL AAA Fuels Handbook (2003) sec. 2.6: cp J/mol/K per phase, transitions and latent heats Table 2-13 */
const UMM = 0.23803, UPH = [[942, 24.959, 2.132e-3, 2.370e-5, 2791], [1049, 42.928, 0, 0, 4757], [1408, 38.284, 0, 0, 0], [Infinity, 48.660, 0, 0, 0]];
const uCp = T => { const p = UPH.find(r => T <= r[0]); return (p[1] + p[2]*T + p[3]*T*T)/UMM/1000; };
const uH = T => { let h = 0, lo = T0;
  for(const [hi, a, b, cc, L] of UPH){ const t = Math.min(T, hi), F = x => a*x + b*x*x/2 + cc*x*x*x/3;
    h += F(t) - F(lo); if(T <= hi) break; h += L; lo = hi; }
  return h/UMM/1000; };
/* each fuel's own figures: kg/m3, cp and h(T) kJ/kg, k W/m/K at the mean pellet */
const IFR_K = [[293, 27], [373, 29.1], [473, 31.1], [573, 33.4], [673, 35.8], [773, 38.2], [873, 40.6], [973, 43.2], [1073, 45.7], [1173, 48.3]];
const kU = T => { const i = Math.max(0, IFR_K.findIndex(r => r[0] >= T) - 1), [a, ka] = IFR_K[i], [b, kb] = IFR_K[i + 1]; return ka + (T - a)*(kb - ka)/(b - a); };
const FUEL_OWN = {
  "U METAL NATURAL": {rho:18700, cp:uCp, h:uH, k:kU, src:"Calder Hall bar 18.7 g/cm3 (Nuclear Engineering Dec. 1956), ANL handbook cp, IFR handbook k (SAS4A Table 10.3.4)"}};
/* Fink 2000 eq. 20, k(T) for 95 % dense UO2, W/m/K */
const finkK = T => { const t = T/1000;
  return 100/(7.5408 + 17.692*t + 3.6142*t*t) + 6400/Math.pow(t, 2.5)*Math.exp(-16.35/t); };
const UO2_OWN = {rho:10400, cp:T => finkCp(T), h:T => finkH(T), k:finkK, src:"UO2 10400 kg/m3, Fink cp and k (J. Nucl. Mater. 279 (2000) eq. 1 and eq. 20, 95 % TD)"};
const fuelOwn = () => FUEL_OWN[G.FUEL[G.coreD(G.IX.coreId[c]).fuel].name] || UO2_OWN;
/* the drawing counted by hand: fuel slots x 4 quadrants x rods per bundle x pellet area x height */
const drawnKg = () => {
  const cd = G.coreD(G.IX.coreId[c]); let n = 0;
  for(let q=0;q<G.LQ*G.LQ;q++) if(G.latFuel(cd, q)) n++;
  const rods = 4*n*(G.LAT_P0/G.rodPOf(cd))**2, R = G.rodD(cd)/2 - G.cladOf(cd).thick;
  return {rods, R, len:cd.lat.len, kg:rods*Math.PI*R*R*cd.lat.len*fuelOwn().rho};
};
const tfMean = () => { let t = 0; for(let k=0;k<XNN;k++) t += W[k]*ST.csNTf[nb+k]; return t; };
const tcMean = () => { let t = 0; for(let k=0;k<XNN;k++) t += W[k]*ST.csNTc[nb+k]; return t; };

if(mode[0] === "p"){
  const worst = (lo, hi, f, col) => TAB.filter(r => r[0] >= lo && r[0] <= hi && r[col] > 0)
    .reduce((m, r) => Math.max(m, Math.abs(f(r[0])/r[col] - 1)), 0);
  const SRC = "Fink & Petri, Thermophysical properties of uranium dioxide, ANL/RE-97/2 (1997), Table 1.1.2";
  check("UO2 cp, Fink 2000 law against the ANL table at 298-2000 K, worst", worst(0, 2000, T => finkCp(T)*1000, 2), 0, 0.02, SRC + ", cp uncertainty 2 % to 2000 K", {abs:true, unit:"of cp"});
  check("UO2 h(T) - h(298.15), Fink 2000 law against the ANL table at 400-3000 K, worst", worst(0, 3000, finkH, 1), 0, 0.01, SRC + ", h uncertainty 1 %", {abs:true, unit:"of h"});
  const hi = worst(2001, 3120, T => finkCp(T)*1000, 2), hm = worst(3120, 3120, finkH, 1);
  check("UO2 above 2000 K: the smooth Fink 2000 cp against the table's 2670 K transition and flat 167 J/mol/K", hi, 0, 0.08, SRC + ", cp uncertainty 8 % above the transition",
    {abs:true, unit:"of cp", pass:false, gap:CAP, note:"decided 20/09/26, outcome B: Fink 2000 eq. 1 carried over the 1997 table's flat 167 J/mol/K above 2670 K; h at 3120 K off by " + (hm*100).toFixed(1) + " %"});
  /* Fink 2000 eq. (5), liquid J/mol over the solid at 298.15 K; its step over eq. (1) at 3120 K is the heat of fusion, 70 +- 4 kJ/mol (section 4) */
  const hLiq = T => 8.0383e5 + 0.25136*T - 1.3288e9/T, fus = (hLiq(3120) - finkH(3120)*FM*1000)/FM/1000;
  check("UO2 heat of fusion, engine against Fink 2000 (liquid eq. 5 minus solid eq. 1 at 3120 K)", PT.coreFuseKJ[c], fus, 4/70,
    "Fink, J. Nucl. Mater. 279 (2000) 1-18, section 4: 70 +- 4 kJ/mol", {unit:"kJ/kg", note:"paper's own step " + (fus*FM).toFixed(2) + " kJ/mol"});
  check("fault injected, the superseded 74.8 kJ/mol (277.1 kJ/kg): the fusion check fails", Math.abs(277.1/fus - 1) > 4/70 ? 1 : 0, 1, 0,
    "the fusion check above must be able to fail", {abs:true});
  const bad = worst(0, 2000, T => finkCp(T, 1.1)*1000, 2);
  check("fault injected, Fink's C1 x 1.1: the cp check fails", bad > 0.02 ? 1 : 0, 1, 0, "the cp check above must be able to fail", {abs:true, note:"worst " + (bad*100).toFixed(1) + " %"});
  const io = G.E_FU, eng = T => { io[0] = T; G.eFuelHA(c); return io[1]; };
  let dh = 0; for(let T=300;T<3100;T+=50) dh = Math.max(dh, Math.abs(eng(T) - finkH(T)));
  check("engine eFuelHA() against the test's own Fink, 300-3100 K", dh, 0, 1e-9, "Fink 2000 solid law, written out twice", {abs:true, unit:"kJ/kg"});
  const trip = tol => { let e = 0;
    for(let T=300;T<=3100;T+=50) for(const off of [-200, -20, -2, 2, 20, 200]){
      const g = Math.min(3100, Math.max(300, T + off));
      io[0] = T; G.eFuelHA(c); io[3] = io[1]; io[0] = g; G.eFuelTA(c, G.E_FUEL_NEWT, tol); e = Math.max(e, Math.abs(io[0] - T)); }
    return e; };
  const e0 = trip(G.E_FUEL_DT), e2 = trip(1);
  check("engine eFuelTA(eFuelHA(T)) round trip, 300-3100 K, started up to 200 K off", e0, 0, 1e-9,
    "identity: T -> h -> T", {abs:true, unit:"K", note:"Newton exits on a step under " + G.E_FUEL_DT + " K, at most " + G.E_FUEL_NEWT + " steps"});
  check("fault injected, the Newton exit loosened to a 1 K step: the round trip fails", e2 > 1e-9 ? 1 : 0, 1, 0, "the round trip above must be able to fail", {abs:true, note:"worst " + e2.toExponential(2) + " K"});
  const tm = PT.coreTmelt[c], liq = T => finkH(tm) + (hLiq(T) - hLiq(tm))/FM/1000, flat = T => finkH(tm) + 131*(T - tm)/FM/1000;
  const liqErr = f => [3200, 3500, 4000, 4500].reduce((m, T) => Math.max(m, Math.abs(eng(T) - f(T))), 0);
  check("engine liquid UO2 eFuelHA() against Fink 2000 eq. 5 at 3200-4500 K", liqErr(liq), 0, 1e-9,
    "Fink, J. Nucl. Mater. 279 (2000) eq. 5, joined to the solid at tmelt " + tm + " K", {abs:true, unit:"kJ/kg"});
  const flatErr = liqErr(flat);
  check("fault injected, the liquid on a flat 131 J/mol/K: the liquid check fails", flatErr > 1e-9 ? 1 : 0, 1, 0, "the liquid check above must be able to fail", {abs:true, note:"worst " + flatErr.toFixed(2) + " kJ/kg"});
  let eL = 0;
  for(let T=tm-300;T<=tm+300;T+=25) for(const off of [-200, -20, 20, 200]){
    io[0] = T; G.eFuelHA(c); io[3] = io[1]; io[0] = T + off; G.eFuelTA(c, G.E_FUEL_NEWT, G.E_FUEL_DT); eL = Math.max(eL, Math.abs(io[0] - T)); }
  check("engine eFuelTA(eFuelHA(T)) round trip across tmelt, " + (tm - 300) + "-" + (tm + 300) + " K, started 200 K off", eL, 0, 1e-9,
    "identity: T -> h -> T", {abs:true, unit:"K"});

  /* U-10Zr, Billone's fit (IFR Metallic Fuels Handbook, SAS4A/SASSYS-1 eq. 10.3-108), J/kg/K, integrated by hand */
  const uz = G.FUEL.findIndex(r => r.name === "U-ZR METALLIC");
  const bF = T => 6.625*T + 0.3066*T*T/2 - 4.58e6/T, T0z = 298.15;
  const bH = T => (T <= 1000 ? bF(T) - bF(T0z) : T <= 1506 ? bF(1000) - bF(T0z) + 180.1*(T - 1000) : bF(1000) - bF(T0z) + 180.1*506 + 221.9*(T - 1506))/1000;
  const rowH = (f, T) => { io[0] = T; io[4] = T; G.eFuelRowA(f); return io[5]; };
  const uzErr = h => { let e = 0; for(let T=300;T<=1700;T+=25) e = Math.max(e, Math.abs(rowH(uz, T) - h(T))); return e; };
  const SRCZ = "Billone's U-10Zr cp (SAS4A/SASSYS-1 5.7 eq. 10.3-108): 6.625 + 0.3066 T + 4.58e6/T^2 below 1000 K, 180.1 to the 1506 K solidus, 221.9 liquid";
  check("engine U-10Zr h(T) - h(298.15) against Billone's fit, 300-1700 K", uzErr(bH), 0, 1e-9, SRCZ, {abs:true, unit:"kJ/kg"});
  const uzBad = uzErr(T => bH(T) + (T > 1000 ? 5 : 0));
  check("fault injected, a 5 kJ/kg step at 1000 K: the U-10Zr check fails", uzBad > 1e-9 ? 1 : 0, 1, 0, "the U-10Zr check above must be able to fail", {abs:true});
  const oneHot = f => { const v = new Float64Array(G.FUEL.length); v[f] = 1; G.engBuildFuelMix(PT, c, v); };
  const tripRow = (f, lo, hi) => { oneHot(f); let e = 0;
    for(let T=lo;T<=hi;T+=25) for(const off of [-200, -20, 20, 200]){
      io[0] = T; G.eFuelHA(c); io[3] = io[1]; io[0] = Math.max(300, T + off); G.eFuelTA(c, G.E_FUEL_NEWT, G.E_FUEL_DT); e = Math.max(e, Math.abs(io[0] - T)); }
    return e; };
  const eZ = tripRow(uz, 300, G.FUEL[uz].tmelt + 200);
  check("engine eFuelTA(eFuelHA(T)) round trip on U-10Zr, 300-" + (G.FUEL[uz].tmelt + 200) + " K, started up to 200 K off, never below 300 K", eZ, 0, 1e-9, "identity: T -> h -> T", {abs:true, unit:"K"});
  /* U metal, Kim & Hofman, ANL AAA Fuels Handbook (2003) Table 2-14: K, cp J/mol/K, H - H298 kJ/mol; a transition listed twice, below then above */
  const um = G.FUEL.findIndex(r => r.name === "U METAL NATURAL"), UM = 0.23803;
  const UTAB = [[300, 27.700, 0.051], [400, 29.684, 2.919], [500, 31.997, 5.999], [600, 34.762, 9.333], [700, 38.021, 12.968], [800, 41.791, 16.955],
    [900, 46.081, 21.344], [942, 48.038, 23.320, 0], [942, 42.928, 26.111, 1], [1000, 42.928, 28.600], [1049, 42.928, 30.704, 0], [1049, 38.284, 35.461, 1],
    [1100, 38.284, 37.414], [1200, 38.284, 41.242], [1300, 38.284, 45.070], [1400, 38.284, 48.899]];
  const SRCU = "Kim & Hofman, ANL AAA Fuels Handbook (2003) sec. 2.6, Table 2-14 (Oetting, Rand & Ackermann 1976); no uncertainty stated, its fit and its own table differ by up to 0.3 %";
  const rowAt = (f, T, up) => { io[0] = T; io[4] = up ? T + 1e-6 : T; G.eFuelRowA(f); return [io[5], io[6]]; };
  const uErr = (f, dropL) => UTAB.reduce((m, [T, cp, H, up]) => { const [h, c1] = rowAt(f, T, up);
    const want = H/UM - (dropL && T >= 942 && !(T === 942 && !up) ? 2.791/UM : 0);
    return Math.max(m, Math.abs(c1/(cp/UM/1000) - 1), T > 300 ? Math.abs(h/want - 1) : 0); }, 0);
  check("engine U metal cp and h(T) - h(298.15) against the ANL table, 300-1400 K, worst", uErr(um), 0, 0.005, SRCU, {abs:true, unit:"of the value"});
  const uBad = UTAB.reduce((m, [T, cp, H, up]) => { const [h] = rowAt(um, T, up), bad = h - (T > 942 || (T === 942 && up) ? 2.791/UM : 0);
    return Math.max(m, Math.abs(bad/(H/UM) - 1)); }, 0);
  check("fault injected, the alpha-beta latent heat dropped: the U metal check fails", uBad > 0.005 ? 1 : 0, 1, 0, "the U metal check above must be able to fail", {abs:true, note:"worst " + (uBad*100).toFixed(1) + " %"});
  const eU = tripRow(um, 300, 1600);
  check("engine eFuelTA(eFuelHA(T)) round trip on U metal, 300-1600 K, started up to 200 K off", eU, 0, 1e-9, "identity: T -> h -> T", {abs:true, unit:"K"});
  let eJ = 0;
  for(const [Tb, L] of [[942, 2.791], [1049, 4.757]]){ io[0] = Tb; G.eFuelHA(c); io[3] = io[1] + L/UM/2; io[0] = Tb - 50; G.eFuelTA(c, G.E_FUEL_NEWT, G.E_FUEL_DT); eJ = Math.max(eJ, Math.abs(io[0] - Tb)); }
  check("engine eFuelTA() inside each U metal latent jump returns the transition exactly", eJ, 0, 0, "a target mid-jump is the transition temperature (942, 1049 K)", {abs:true, unit:"K"});
  G.engBuildFuelMix(PT, c, G.fuelVolW(G.coreD(G.IX.coreId[c])));
}

if(mode[0] === "e"){
  sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); G.uiBlkSinkOff("rodStep"); G.uiBlkSinkOff("boronDem");
  G.act("rodCommon", ST.csRodPos[c] + 0.02);
  const own = fuelOwn(), h20 = sc[G.SC_H2], dk = drawnKg(), m = dk.kg, phi = new Float64Array(XNN), Tf = new Float64Array(XNN), Tk = new Float64Array(XNN), Tg = new Float64Array(XNN), TgC = new Float64Array(XNN), disp = new Float64Array(XNN), V = new Float64Array(XNN);
  const cd0 = G.coreD(G.IX.coreId[c]), can0 = G.cladOf(cd0), canOwn = CLAD_OWN[can0.name], mk = dk.rods*Math.PI*G.rodD(cd0)*dk.len*can0.thick*can0.rho;
  let res = 0, resInj = 0, resK = 0, worst = 0, heatT = 0, dirT = 0, n0 = sc[G.SC_N], nMax = n0, nMin = n0;
  for(let t=0;t<500;t++){
    for(let k=0;k<XNN;k++){ phi[k] = ST.csPhi[nb+k]; Tf[k] = ST.csNTf[nb+k]; Tk[k] = ST.csNTcl[nb+k]; Tg[k] = ST.csNTg[nb+k]; TgC[k] = ST.csNTgC[nb+k]; disp[k] = ST.csNDisp[nb+k]; V[k] = ST.csNV[nb+k]; }
    G.step(0.02);
    const heat = ST.csHeat[c];
    let pin = 0, stk = 0, dir = 0, dUf = 0, dUs = 0, dUk = 0;
    for(let k=0;k<XNN;k++){ const o = outside(phi[k], heat, V[k], ST.csNCov[nb+k]);
      pin += (heat*phi[k] - o.w - o.b - o.c)*(1 - disp[k])*rk*W[k]; stk += (o.b + o.c)*rk*W[k]; dir += o.w*rk*W[k];
      dUf += m*W[k]*(own.h(ST.csNTf[nb+k]) - own.h(Tf[k]));
      dUk += mk*W[k]*(canOwn.h(ST.csNTcl[nb+k]) - canOwn.h(Tk[k]));
      if(PT.coreGraphKg[c] > 0) dUs += PT.coreGraphKg[c]*W[k]*modCp(Tg[k])*(ST.csNTg[nb+k] - Tg[k]);
      if(PT.coreGraphKgC[c] > 0) dUs += PT.coreGraphKgC[c]*W[k]*modCp(TgC[k])*(ST.csNTgC[nb+k] - TgC[k]); }
    const zr = ST.csQOx[c]*rk, water = ST.csFQ[c] + ST.csGQ[c] + ST.csDQ[c] + ST.csCQ[c];
    const r = (pin + stk + dir + zr)*0.02 - dUf - dUs - dUk - water*0.02;
    res += r; resInj += (pin + stk + dir + zr)*0.02 - dUf - dUs - dUk - (water - ST.csDQ[c])*0.02; resK += r + dUk;
    worst = Math.max(worst, Math.abs(r)/(heat*rk*0.02)); heatT += heat*rk*0.02; dirT += dir*0.02;
    nMax = Math.max(nMax, sc[G.SC_N]); nMin = Math.min(nMin, sc[G.SC_N]); }
  const note = "n " + n0.toFixed(4) + " -> " + sc[G.SC_N].toFixed(4) + " (range " + nMin.toFixed(4) + ".." + nMax.toFixed(4) + "), fuel " + (m/1000).toFixed(1) + " t, direct to water " + (dirT/heatT*100).toFixed(2) + " %";
  check(name + ": core energy over a 10 s rod step, fission + Zr = d(fuel U) + d(clad U) + d(stack U) + heat to water", res/heatT, 0, 1e-12,
    "first law on the core, the fuel priced as the drawn fuel x its own h(T): " + own.src + "; the can as the drawn rods x pi D x wall x its density x its own h(T): " + canOwn.src,
    {abs:true, unit:"of heat x time", note:note + "; worst tick " + worst.toExponential(2) + ", can " + (mk/1000).toFixed(2) + " t"});
  check(name + ": fault injected, the direct heat not handed to the water: the core energy check fails", Math.abs(resInj/heatT) > 1e-12 ? 1 : 0, 1, 0,
    "the energy check above must be able to fail", {abs:true, note:"residual " + (resInj/heatT).toExponential(2) + " of heat x time"});
  check(name + ": fault injected, the can's own heat left out of the sum: the core energy check fails", Math.abs(resK/heatT) > 1e-12 ? 1 : 0, 1, 0,
    "the energy check above must be able to fail", {abs:true, note:"residual " + (resK/heatT).toExponential(2) + " of heat x time"});
  const cd = G.coreD(G.IX.coreId[c]), can = G.cladOf(cd);
  if(!can.zr){
    check(name + ": " + can.name + " can makes no hydrogen over the rod step", sc[G.SC_H2] - h20, 0, 0, "no Zr in the core: no Zr + 2 H2O reaction", {abs:true, unit:"kg"});
    /* a can over its melting point is lost at once; a Zircaloy can at the same temperature bursts on its own law's time */
    const snap = G.engSnap(G.engSnapNew()), hot = can.tsol + 150;
    const burnIn = zr => { G.engRestore(snap);
      const row0 = PT.coreCladRow[c];
      if(zr){ PT.coreCladRow[c] = 0; PT.coreCladThick[c] = G.CLAD[0].thick; }
      for(let k=0;k<XNN;k++){ ST.csNTc[nb+k] = hot; ST.csNTcl[nb+k] = hot; ST.csNTf[nb+k] = hot + 1; }
      G.step(0.02);
      let d = 0; for(let k=0;k<XNN;k++) d = Math.max(d, ST.csNDmg[nb+k]);
      PT.coreCladRow[c] = row0; PT.coreCladThick[c] = can.thick; return d; };
    const dMg = burnIn(false), dZr = burnIn(true);
    check(name + ": a node over the " + can.name + " can's " + can.tsol + " K solidus is damaged within one tick", dMg, 1, 0, "the can melts: magnesium's ~650 C (Frost, Nuclear Fuel Elements)", {abs:true, note:"at " + hot + " K"});
    check(name + ": fault injected, the same node on a Zircaloy can: one tick is not enough", dZr < 1 ? 1 : 0, 1, 0,
      "Zircaloy bursts on its own time (E_BURST_TAU), so the melt check above must be able to fail", {abs:true, note:"damage " + dZr.toFixed(3) + " after one tick"});
  }
}

if(mode[0] === "l"){
  const snap = G.engSnap(G.engSnapNew()), ua = PT.corePinUA[c];
  const run = capK => { G.engRestore(snap);
    const cs = G.E_CS, heat = ST.csHeat[c]*1.05, Tc = Float64Array.from(ST.csNTc.subarray(nb, nb + XNN)), V = Float64Array.from(ST.csNV.subarray(nb, nb + XNN));
    const Tf0 = Float64Array.from(ST.csNTf.subarray(nb, nb + XNN)), law = Tf0.slice(), lawK = Float64Array.from(ST.csNTcl.subarray(nb, nb + XNN)), m0 = PT.coreFuelKg[c], dk = drawnKg(), m = dk.kg;
    const cd = G.coreD(G.IX.coreId[c]), can = G.cladOf(cd), mk = dk.rods*Math.PI*G.rodD(cd)*dk.len*can.thick*can.rho, cpk = CLAD_OWN[can.name].cp;
    const cpf = fuelOwn().cp, tau = m*cpf(tfMean())/(ua*filmMean());
    let t = 0;
    PT.coreFuelKg[c] = m0*capK;
    while(t < tau - 1e-9){
      cs[0] = 0.02; cs[1] = heat; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 1;
      cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c);
      const phi = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN)), cov = Float64Array.from(ST.csNCov.subarray(nb, nb + XNN));
      G.eCoreStep(c); t += 0.02;
      /* pellet and can as two lumps on the conductances the tick used, RK4 in 40 substeps */
      for(let k=0;k<XNN;k++){ const f = ST.csNFilm[nb+k], hc = ST.csNHc[nb+k], gs = f*hc/(hc - f), pd = ST.csNDw[nb+k]/W[k], o = outside(phi[k], heat, V[k], cov[k], pd), q = ((heat - ST.csDecay[c])*phi[k] + ST.csDecay[c]*pd - o.w - o.b - o.c)*rk/ua;
        const d = (a, b) => [(q - gs*(a - b))*ua/(m*cpf(a)),(gs*(a - b) - hc*(b - Tc[k]))*ua/(mk*cpk(b)/1000)];
        const h = 0.02/40; let a = law[k], b = lawK[k];
        for(let s=0;s<40;s++){ const k1 = d(a, b), k2 = d(a + h/2*k1[0], b + h/2*k1[1]), k3 = d(a + h/2*k2[0], b + h/2*k2[1]), k4 = d(a + h*k3[0], b + h*k3[1]);
          a += h/6*(k1[0] + 2*k2[0] + 2*k3[0] + k4[0]); b += h/6*(k1[1] + 2*k2[1] + 2*k3[1] + k4[1]); }
        law[k] = a; lawK[k] = b; }
      for(let k=0;k<XNN;k++){ ST.csNTc[nb+k] = Tc[k]; ST.csNV[nb+k] = V[k]; } }
    PT.coreFuelKg[c] = m0;
    let got = 0, want = 0;
    for(let k=0;k<XNN;k++){ got += W[k]*(ST.csNTf[nb+k] - Tf0[k]); want += W[k]*(law[k] - Tf0[k]); }
    return {err:got/want - 1, tau}; };
  const a = run(1), b = run(2), mk0 = PT.coreCladM[c]; PT.coreCladM[c] = mk0/2; const k = run(1); PT.coreCladM[c] = mk0;
  check(name + ": pellet's rise after a +5 % fission step, water held, against pellet and can as two lumps at t = tau", a.err, 0, 1e-6,
    "two lumps in series: m_f cp_f dT_f/dt = q - g (T_f - T_can), m_can cp_can dT_can/dt = g (T_f - T_can) - h (T_can - T_water), the drawn fuel and can on their own cp, solved on the drivers the node saw",
    {abs:true, unit:"of the law", note:"tau " + a.tau.toFixed(2) + " s"});
  check(name + ": fault injected, the pin's capacity doubled: the lag check fails", Math.abs(b.err) > 1e-6 ? 1 : 0, 1, 0,
    "the lag check above must be able to fail", {abs:true, note:"off by " + (b.err*100).toFixed(1) + " %"});
  check(name + ": fault injected, the can's mass halved: the lag check fails", Math.abs(k.err) > 1e-6 ? 1 : 0, 1, 0,
    "the lag check above must be able to fail", {abs:true, note:"off by " + (k.err*100).toExponential(2) + " %"});
}

if(mode[0] === "t" && G.fuelDissolved(G.coreD(G.IX.coreId[c]))){
  let rise = 0; for(let k=0;k<XNN;k++) rise = Math.max(rise, Math.abs(ST.csNTf[nb+k] - ST.csNTc[nb+k]));
  check(name + ": fuel heat capacity outside the salt", PT.coreFuelKg[c], 0, 0, "a fuel dissolved in its coolant has no pellet: its heat capacity is the salt's own", {abs:true, unit:"kg"});
  check(name + ": fuel over its salt at rest, worst node", rise, 0, 0, "the fission heat is born in the salt, so there is no rise to carry it across", {abs:true, unit:"K"});
}
else if(mode[0] === "t"){
  const COOL = G.COOLANT[G.coreD(G.IX.coreId[c]).cool].id;
  /* gap conductance and water film typical of an LWR (Todreas & Kazimi, Nuclear Systems I, ch. 8); Zircaloy k MATPRO; Magnox k on a line between pure Mg 156 and Mg-1.5Al 100 W/m/K (J. Magnes. Alloys 8, 2020) */
  const cd = G.coreD(G.IX.coreId[c]), own = fuelOwn(), Tm = tfMean();
  /* CO2 by Dittus-Boelter on Calder Hall's zone B annulus: 3.95 in channel, 54 mm element, 1964/1696 lb/s; NIST at 0.7 MPa, 500 K: mu 24.004 uPa.s, k 0.033109 W/m/K, cp 1.0233 kJ/kg/K */
  const co2Film = () => { const D = 3.95*0.0254, d = 0.054, G0 = 890.9/1696/(Math.PI/4*(D*D - d*d)), Re = G0*(D - d)/24.004e-6, Pr = 1023.3*24.004e-6/0.033109;
    return 0.023*Re**0.8*Pr**0.4*0.033109/(D - d); };
  const RHO = own.rho, K = own.k(Tm), HGAP = 5700, KCLAD = {"ZIRCALOY":16, "MAGNOX AL80":156 - 56*0.8/1.5}[G.cladOf(cd).name];
  const HFILM = {"CO2":co2Film()}[G.COOLANT[cd.cool].id] ?? 34000;
  const dr = drawnKg(), cp = own.cp(Tm), f = filmMean(), ua = PT.corePinUA[c]*f;
  const Ro = PT.coreRodD[c]/2, R = Ro - G.cladOf(cd).thick, fin = G.finOf(cd);
  const qlin = ST.csFQ[c]*1000/(dr.rods*dr.len);
  const rOut = [1/(2*Math.PI*R*HGAP), Math.log(Ro/R)/(2*Math.PI*KCLAD), 1/(2*Math.PI*Ro*HFILM*fin*f)];
  /* the pellet's volume mean over its surface on the fuel's OWN k(T): int k dT = q'(1 - r2/R2)/(4 pi).
     A flat k reduces this to 1/(8 pi k) exactly, so one form covers UO2 and the metals. */
  const pelRes = (kOf, rSum = rOut[0] + rOut[1] + rOut[2]) => { if(!(qlin > 0)) return 0;
    const A = qlin/(4*Math.PI), N = 4000, Ts = tcMean() + qlin*rSum;
    let T = Ts, mean = 0;
    for(let i=0;i<N;i++){ const Tx = T + A/kOf(T)*(0.5/N); mean += Tx/N; T += A/kOf(Tx)/N; }
    return (mean - Ts)/qlin; };
  const res = (kOf, rSum) => [pelRes(kOf, rSum), rOut[0], rOut[1], rOut[2]];
  const parts = res(own.k).map(x => RHO*cp*1000*Math.PI*R*R*x);
  const real = parts.reduce((a, b) => a + b, 0), C = PT.coreFuelKg[c]*cp, tau = C/ua;
  const note = "model " + tau.toFixed(2) + " s at film " + f.toFixed(3) + "; lumped " + real.toFixed(2) + " s = pellet " + parts[0].toFixed(2) +
    " + gap " + parts[1].toFixed(2) + " + clad " + parts[2].toFixed(2) + " + film " + parts[3].toFixed(2) + " (pellet R " + (R*1000).toFixed(2) + " mm, cp " + cp.toFixed(3) + " at " + Tm.toFixed(0) + " K, coolant " + COOL + ")";
  const SRC = "lumped pin: tau = rho cp pi R^2 [1/(8 pi k) + 1/(2 pi R h_gap) + ln(Ro/R)/(2 pi k_clad) + 1/(2 pi Ro h_film fin)], " + own.src;
  /* sodium's film is thinner than water's, so the water figure bounds it; a gas film is thicker and is not estimated */
  const est = COOL !== "HTGR";
  const kind = G.FUEL[cd.fuel].name;
  if(!est) check(name + ": fuel time constant at rest, " + COOL + " film not estimated: the lumped figure is a floor", tau, real, 0, SRC, {unit:"s", pass:false, gap:ROW, note});
  else check(name + ": fuel time constant at rest against a lumped conduction estimate", tau, real, 0.3, SRC, {unit:"s", gap:ROW, note});
  const Cr = dr.kg*cp;
  check(name + ": fuel heat capacity against the drawn fuel mass x its cp", C, Cr, 0.01,
    "rods counted off the drawing (fuel slots x 4 x bundle rods) x pellet area x height x the fuel's own density and cp at the mean pellet: " + own.src, {unit:"kJ/K", gap:CAP,
      note:kind + " " + (dr.kg/1000).toFixed(1) + " t, " + dr.rods.toFixed(0) + " rods, pin UA x film " + ua.toFixed(0) + " kW/K"});
  check(name + ": fault injected, the quadrant factor dropped: the capacity check fails", Math.abs(C/4/Cr - 1) > 0.01 ? 1 : 0, 1, 0,
    "the capacity check above must be able to fail", {abs:true});
  let rise = 0; for(let k=0;k<XNN;k++) rise += W[k]*(ST.csNTf[nb+k] - ST.csNTc[nb+k]);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const want = qlin*sum(res(own.k)), wantBad = qlin*sum(res(T => own.k(T)/2));
  const SRC2 = "conduction through pellet, gap, clad and film at the rest heat flux (Todreas & Kazimi ch. 8), q' off the drawn rods, the pellet on the conductivity integral of " + own.src + ", h_gap 5.7, k_clad " + KCLAD.toFixed(0) + ", h_film " + (HFILM/1000).toFixed(3) + " kW/m2K x fin " + fin + " x the film share";
  const note2 = "q' " + (qlin/1000).toFixed(2) + " kW/m, R' " + (sum(res(own.k))*1000).toFixed(2) + " mK.m/W, effective pellet k " +
    (qlin/(4*Math.PI)/2/Math.max(pelRes(own.k)*qlin, 1e-9)).toFixed(2) + " W/m/K against " + K.toFixed(2) + " at the mean pellet";
  if(!est) check(name + ": mean pellet over its water at rest, " + COOL + " film not estimated", rise, want, 0, SRC2, {unit:"K", pass:false, gap:ROW, note:note2});
  else {
    check(name + ": mean pellet over its water at rest against conduction", rise, want, 0.3, SRC2, {unit:"K", gap:ROW, note:note2});
    check(name + ": fault injected, the pellet conductivity halved: the rise check fails", Math.abs(rise/wantBad - 1) > 0.3 ? 1 : 0, 1, 0,
      "the rise check above must be able to fail", {abs:true, note:"off by " + ((rise/wantBad - 1)*100).toFixed(0) + " %"});
  }
}

if(mode[0] === "s"){
  const HAND = "the law written out by hand (tests/physics/lib.js heatShareHand())";
  const k0 = nb + G.XNZ/2, v0 = ST.csNV[k0], x0 = ST.csNCov[k0], io = G.E_HSP;
  const wp = () => io[G.E_HS_WP] + io[G.E_HS_SP] + io[G.E_HS_AP], wd = () => io[G.E_HS_WD] + io[G.E_HS_SD] + io[G.E_HS_AD];
  let e = 0;
  const cm = PT.coreCovMax[c];
  for(const a of [0, 0.5, 1]) for(const cov of [0, 0.4, 1, cm/2, cm]){
    ST.csNV[k0] = a; ST.csNCov[k0] = cov; G.eHeatSplitA(c, k0); const s = coreShareHand(G, c, a, cov);
    e = Math.max(e, Math.abs(wp() - s.wp), Math.abs(io[G.E_HS_BP] - s.bp), Math.abs(wd() - s.wd), Math.abs(io[G.E_HS_BD] - s.bd)); }
  check(name + ": engine water and block shares over void and rod coverage 0-" + cm.toFixed(3) + " against the law by hand", e, 0, 1e-12, HAND, {abs:true, unit:"of fission heat"});
  ST.csNV[k0] = 1; ST.csNCov[k0] = 0; G.eHeatSplitA(c, k0);
  check(name + ": a node at void 1 with the bank out: the water's own share", io[G.E_HS_WP] + io[G.E_HS_WD], 0, 0, "no water, nothing deposited in it", {abs:true, unit:"of fission heat"});
  ST.csNCov[k0] = 0; G.eHeatSplitA(c, k0);
  check(name + ": a node at rod coverage 0: the absorber's share", io[G.E_HS_AP] + io[G.E_HS_AD], 0, 0, "nothing there absorbs nothing", {abs:true, unit:"of fission heat"});
  ST.csNV[k0] = v0; ST.csNCov[k0] = x0;

  sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram");
  G.eScram(c);
  ST.csN[c] = 0; for(let g=0;g<6;g++) ST.csC[c*6+g] = 0;
  const phi = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN)), V = Float64Array.from(ST.csNV.subarray(nb, nb + XNN));
  G.step(0.02);
  /* the bank is driving in, so the coverage the tick priced the heat at is the one it left behind */
  const C = ST.csNCov.subarray(nb, nb + XNN);
  let want = 0, bad = 0; const hd = ST.csDecay[c];
  for(let k=0;k<XNN;k++){ const s = coreShareHand(G, c, V[k], C[k]); want += ST.csNDw[nb+k]*hd*s.wd*rk; bad += ST.csNDw[nb+k]*hd*s.wp*rk; }
  check(name + ": after a scram with n forced to 0, the direct heat in the water", ST.csDQ[c], want, 1e-12,
    "decay heat carries delayed gamma only: hd x FIS_FGD x the water's gamma share, where its decay weight is, summed by hand", {unit:"kW", note:"n " + ST.csN[c].toExponential(2) + ", decay " + (hd*100).toFixed(2) + " % of rated"});
  check(name + ": fault injected, decay heat priced on the prompt shares (neutrons and prompt gamma): the scram check fails", Math.abs(bad/want - 1) > 1e-12 ? 1 : 0, 1, 0,
    "the scram check above must be able to fail", {abs:true, note:"off by " + ((bad/want - 1)*100).toFixed(1) + " %"});

  const cd = G.coreD(G.IX.coreId[c]), hs = G.heatShares(cd), Fq = G.corePredict(cd, {rf:G.REFL[cd.refl]}).Fq, dr = drawnKg();
  const pinMW = G.latQLim(cd).q*dr.rods*dr.len/Fq/1000;
  check(name + ": rated power x the pin's rest share against the pin limit x rods x length / Fq", G.latRating(cd)*hs.pin0, pinMW, 1e-12,
    "the pin carries only its own share: rating = pin limit / pin share", {unit:"MW", note:"pin share " + (hs.pin0*100).toFixed(2) + " %, rods counted by hand " + dr.rods.toFixed(0)});
}
