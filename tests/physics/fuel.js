"use strict";
// chunks: p0 e0 e5 l0 l5 t0 t1 t2 t3 t4 t5 t6 t7 t8
/* the fuel pin between fission and water: p = UO2's own heat law and the engine's enthalpy door, e = the core's energy tick by tick over a rod step, l = the pin's lag with its water held, t = its capacity, time constant and pellet rise against the drawing */
const {check, commissionPreset} = require("./lib.js");
const mode = process.argv[2], pre = +mode.slice(1);
const G = commissionPreset(pre), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;
const ROW = "core heat reaches the water through the fuel pin", CAP = "fuel heat capacity";
const rk = PT.coreRated[c]*1000, gq = PT.coreGraphQ[c];
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

/* the drawing counted by hand: fuel slots x 4 quadrants x rods per bundle x pellet area x height */
const drawnKg = () => {
  const cd = G.coreD(G.IX.coreId[c]); let n = 0;
  for(let q=0;q<G.LQ*G.LQ;q++) if(G.latFuel(cd, q)) n++;
  const rods = 4*n*(G.LAT_P0/G.ROD_P)**2, R = (cd.rodD ?? G.ROD_D0)/2 - G.ROD_CLAD;
  return {rods, R, len:cd.lat.len, kg:rods*Math.PI*R*R*cd.lat.len*10400};
};
const tfMean = () => { let t = 0; for(let k=0;k<XNN;k++) t += W[k]*ST.csNTf[nb+k]; return t; };

if(mode[0] === "p"){
  const worst = (lo, hi, f, col) => TAB.filter(r => r[0] >= lo && r[0] <= hi && r[col] > 0)
    .reduce((m, r) => Math.max(m, Math.abs(f(r[0])/r[col] - 1)), 0);
  const SRC = "Fink & Petri, Thermophysical properties of uranium dioxide, ANL/RE-97/2 (1997), Table 1.1.2";
  check("UO2 cp, Fink 2000 law against the ANL table at 298-2000 K, worst", worst(0, 2000, T => finkCp(T)*1000, 2), 0, 0.02, SRC + ", cp uncertainty 2 % to 2000 K", {abs:true, unit:"of cp"});
  check("UO2 h(T) - h(298.15), Fink 2000 law against the ANL table at 400-3000 K, worst", worst(0, 3000, finkH, 1), 0, 0.01, SRC + ", h uncertainty 1 %", {abs:true, unit:"of h"});
  const hi = worst(2001, 3120, T => finkCp(T)*1000, 2), hm = worst(3120, 3120, finkH, 1);
  check("UO2 above 2000 K: the smooth Fink 2000 cp against the table's 2670 K transition and flat 167 J/mol/K", hi, 0, 0.08, SRC + ", cp uncertainty 8 % above the transition",
    {abs:true, unit:"of cp", pass:false, gap:CAP, note:"h at 3120 K off by " + (hm*100).toFixed(1) + " %"});
  /* Fink 2000 eq. (5), liquid J/mol over the solid at 298.15 K; its step over eq. (1) at 3120 K is the heat of fusion, 70 +- 4 kJ/mol (section 4) */
  const hLiq = T => 8.0383e5 + 0.25136*T - 1.3288e9/T, fus = (hLiq(3120) - finkH(3120)*FM*1000)/FM/1000;
  check("UO2 heat of fusion, engine against Fink 2000 (liquid eq. 5 minus solid eq. 1 at 3120 K)", G.E_FUSE_KJ, fus, 4/70,
    "Fink, J. Nucl. Mater. 279 (2000) 1-18, section 4: 70 +- 4 kJ/mol", {unit:"kJ/kg", note:"paper's own step " + (fus*FM).toFixed(2) + " kJ/mol"});
  check("fault injected, the superseded 74.8 kJ/mol (277.1 kJ/kg): the fusion check fails", Math.abs(277.1/fus - 1) > 4/70 ? 1 : 0, 1, 0,
    "the fusion check above must be able to fail", {abs:true});
  const bad = worst(0, 2000, T => finkCp(T, 1.1)*1000, 2);
  check("fault injected, Fink's C1 x 1.1: the cp check fails", bad > 0.02 ? 1 : 0, 1, 0, "the cp check above must be able to fail", {abs:true, note:"worst " + (bad*100).toFixed(1) + " %"});
  const io = G.E_FU, eng = T => { io[0] = T; G.eFuelHA(c); return io[1]; };
  let dh = 0; for(let T=300;T<3100;T+=50) dh = Math.max(dh, Math.abs(eng(T) - finkH(T)));
  check("engine eFuelHA() against the test's own Fink, 300-3100 K", dh, 0, 1e-9, "Fink 2000 solid law, written out twice", {abs:true, unit:"kJ/kg"});
  const trip = n => { let e = 0;
    for(let T=300;T<=3100;T+=50) for(const off of [-200, -20, -2, 2, 20, 200]){
      const g = Math.min(3100, Math.max(300, T + off));
      io[0] = T; G.eFuelHA(c); io[3] = io[1]; io[0] = g; G.eFuelTA(c, n); e = Math.max(e, Math.abs(io[0] - T)); }
    return e; };
  const e0 = trip(G.E_FUEL_NEWT), e2 = trip(G.E_FUEL_NEWT - 2);
  check("engine eFuelTA(eFuelHA(T)) round trip, 300-3100 K, started up to 200 K off", e0, 0, 1e-9,
    "identity: T -> h -> T", {abs:true, unit:"K", note:G.E_FUEL_NEWT + " Newton steps"});
  check("fault injected, two Newton steps fewer: the round trip fails", e2 > 1e-9 ? 1 : 0, 1, 0, "the round trip above must be able to fail", {abs:true, note:"worst " + e2.toExponential(2) + " K"});
}

if(mode[0] === "e"){
  sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); G.uiBlkSinkOff("rodStep"); G.uiBlkSinkOff("boronDem");
  G.act("rodCommon", ST.csRodPos[c] + 0.02);
  const m = drawnKg().kg, phi = new Float64Array(XNN), Tf = new Float64Array(XNN), Tg = new Float64Array(XNN), disp = new Float64Array(XNN);
  let res = 0, resInj = 0, worst = 0, heatT = 0, n0 = sc[G.SC_N], nMax = n0, nMin = n0;
  for(let t=0;t<500;t++){
    for(let k=0;k<XNN;k++){ phi[k] = ST.csPhi[nb+k]; Tf[k] = ST.csNTf[nb+k]; Tg[k] = ST.csNTg[nb+k]; disp[k] = ST.csNDisp[nb+k]; }
    G.step(0.02);
    const heat = ST.csHeat[c];
    let fis = 0, stk = 0, dUf = 0, dUs = 0;
    for(let k=0;k<XNN;k++){
      fis += heat*phi[k]*(1 - gq)*(1 - disp[k])*rk*W[k]; stk += gq*heat*phi[k]*rk*W[k];
      dUf += m*W[k]*(finkH(ST.csNTf[nb+k]) - finkH(Tf[k]));
      if(gq > 0) dUs += PT.coreGraphKg[c]*W[k]*G.graphCp(Tg[k])*(ST.csNTg[nb+k] - Tg[k]); }
    const zr = ST.csQOx[c]*rk, water = ST.csFQ[c] + ST.csGQ[c];
    const r = (fis + stk + zr)*0.02 - dUf - dUs - water*0.02;
    res += r; resInj += (fis + stk + zr)*0.02 - dUf - dUs - (fis + ST.csGQ[c])*0.02;
    worst = Math.max(worst, Math.abs(r)/(heat*rk*0.02)); heatT += heat*rk*0.02;
    nMax = Math.max(nMax, sc[G.SC_N]); nMin = Math.min(nMin, sc[G.SC_N]); }
  const note = "n " + n0.toFixed(4) + " -> " + sc[G.SC_N].toFixed(4) + " (range " + nMin.toFixed(4) + ".." + nMax.toFixed(4) + "), UO2 " + (m/1000).toFixed(1) + " t";
  check(name + ": core energy over a 10 s rod step, fission + Zr = d(fuel U) + d(stack U) + heat to water", res/heatT, 0, 1e-6,
    "first law on the core, the fuel priced as the drawn UO2 x Fink's h(T)", {abs:true, unit:"of heat x time", note:note + "; worst tick " + worst.toExponential(2)});
  check(name + ": fault injected, the water heated at fission power: the core energy check fails", Math.abs(resInj/heatT) > 1e-6 ? 1 : 0, 1, 0,
    "the energy check above must be able to fail", {abs:true, note:"residual " + (resInj/heatT).toExponential(2) + " of heat x time"});
}

if(mode[0] === "l"){
  const snap = G.engSnap(G.engSnapNew()), ua = PT.corePinUA[c];
  const run = capK => { G.engRestore(snap);
    const cs = G.E_CS, heat = ST.csHeat[c]*1.05, Tc = Float64Array.from(ST.csNTc.subarray(nb, nb + XNN)), V = Float64Array.from(ST.csNV.subarray(nb, nb + XNN));
    const Tf0 = Float64Array.from(ST.csNTf.subarray(nb, nb + XNN)), law = Tf0.slice(), m0 = PT.coreFuelKg[c], m = drawnKg().kg;
    const tau = m*finkCp(tfMean())/(ua*filmMean());
    let t = 0;
    PT.coreFuelKg[c] = m0*capK;
    while(t < tau - 1e-9){
      cs[0] = 0.02; cs[1] = heat; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 0;
      cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c);
      for(let k=0;k<XNN;k++){ const f = ST.csNFilm[nb+k], teq = Tc[k] + heat*rk/ua*ST.csPhi[nb+k]*(1 - gq)/f;
        law[k] = teq + (law[k] - teq)*Math.exp(-0.02*f*ua/(m*finkCp(law[k]))); }
      G.eCoreStep(c); t += 0.02;
      for(let k=0;k<XNN;k++){ ST.csNTc[nb+k] = Tc[k]; ST.csNV[nb+k] = V[k]; } }
    PT.coreFuelKg[c] = m0;
    let got = 0, want = 0;
    for(let k=0;k<XNN;k++){ got += W[k]*(ST.csNTf[nb+k] - Tf0[k]); want += W[k]*(law[k] - Tf0[k]); }
    return {err:got/want - 1, tau}; };
  const a = run(1), b = run(2);
  check(name + ": pin outflow after a +5 % fission step, water held, against 1 - exp(-t/tau) at t = tau", a.err, 0, 0.01,
    "a lumped pin: m cp(T) dT/dt = q - UA (T - T_water), the drawn UO2 and Fink's cp, solved on the drivers the node saw", {abs:true, unit:"of the law",
      note:"tau " + a.tau.toFixed(2) + " s"});
  check(name + ": fault injected, the pin's capacity doubled: the lag check fails", Math.abs(b.err) > 0.01 ? 1 : 0, 1, 0,
    "the lag check above must be able to fail", {abs:true, note:"off by " + (b.err*100).toFixed(1) + " %"});
}

if(mode[0] === "t"){
  const COOL = G.COOLANT[G.coreD(G.IX.coreId[c]).cool].id;
  /* UO2 95 % TD and k near 900-1200 K (MATPRO); gap conductance and water film typical of an LWR (Todreas & Kazimi, Nuclear Systems I, ch. 8) */
  const RHO = 10400, K = 3.0, HGAP = 5700, KCLAD = 16, HFILM = 34000;
  const dr = drawnKg(), Tm = tfMean(), cp = finkCp(Tm), f = filmMean(), ua = PT.corePinUA[c]*f;
  const Ro = PT.coreRodD[c]/2, R = Ro - G.ROD_CLAD;
  const res = k => [1/(8*Math.PI*k), 1/(2*Math.PI*R*HGAP), Math.log(Ro/R)/(2*Math.PI*KCLAD), 1/(2*Math.PI*Ro*HFILM*f)];
  const parts = res(K).map(x => RHO*cp*1000*Math.PI*R*R*x);
  const real = parts.reduce((a, b) => a + b, 0), C = PT.coreFuelKg[c]*cp, tau = C/ua;
  const note = "model " + tau.toFixed(2) + " s at film " + f.toFixed(3) + "; lumped " + real.toFixed(2) + " s = pellet " + parts[0].toFixed(2) +
    " + gap " + parts[1].toFixed(2) + " + clad " + parts[2].toFixed(2) + " + film " + parts[3].toFixed(2) + " (pellet R " + (R*1000).toFixed(2) + " mm, cp " + cp.toFixed(3) + " at " + Tm.toFixed(0) + " K, coolant " + COOL + ")";
  const SRC = "lumped pin: tau = rho cp pi R^2 [1/(8 pi k) + 1/(2 pi R h_gap) + ln(Ro/R)/(2 pi k_clad) + 1/(2 pi Ro h_film)], UO2 10400 kg/m3, Fink cp, 3 W/m/K (MATPRO; k 2.5-4 over 700-1500 K: the 30 %)";
  /* sodium's film is thinner than water's, so the water figure bounds it; a salt or gas film is thicker and is not estimated */
  const est = COOL !== "MSR" && COOL !== "HTGR";
  if(!est) check(name + ": fuel time constant at rest, " + COOL + " film not estimated: the lumped figure is a floor", tau, real, 0, SRC, {unit:"s", pass:false, gap:ROW, note});
  else check(name + ": fuel time constant at rest against a lumped conduction estimate", tau, real, 0.3, SRC, {unit:"s", gap:ROW, note});
  const Cr = dr.kg*cp;
  check(name + ": fuel heat capacity against the drawn UO2 mass x cp", C, Cr, 0.01,
    "rods counted off the drawing (fuel slots x 4 x bundle rods) x pellet area x height x 10400 kg/m3 x Fink cp at the mean pellet", {unit:"kJ/K", gap:CAP,
      note:"UO2 " + (dr.kg/1000).toFixed(1) + " t, " + dr.rods.toFixed(0) + " rods, pin UA x film " + ua.toFixed(0) + " kW/K"});
  check(name + ": fault injected, the quadrant factor dropped: the capacity check fails", Math.abs(C/4/Cr - 1) > 0.01 ? 1 : 0, 1, 0,
    "the capacity check above must be able to fail", {abs:true});
  let rise = 0; for(let k=0;k<XNN;k++) rise += W[k]*(ST.csNTf[nb+k] - ST.csNTc[nb+k]);
  const qlin = ST.csFQ[c]*1000/(dr.rods*dr.len), sum = a => a.reduce((x, y) => x + y, 0);
  const want = qlin*sum(res(K)), wantBad = qlin*sum(res(K/2));
  const SRC2 = "conduction through pellet, gap, clad and film at the rest heat flux (Todreas & Kazimi ch. 8), q' off the drawn rods, 3 W/m/K, h_gap 5.7, k_clad 16, h_film 34 kW/m2K x the film share";
  const note2 = "q' " + (qlin/1000).toFixed(2) + " kW/m, R' " + (sum(res(K))*1000).toFixed(2) + " mK.m/W";
  if(!est) check(name + ": mean pellet over its water at rest, " + COOL + " film not estimated", rise, want, 0, SRC2, {unit:"K", pass:false, gap:ROW, note:note2});
  else {
    check(name + ": mean pellet over its water at rest against conduction", rise, want, 0.3, SRC2, {unit:"K", gap:ROW, note:note2});
    check(name + ": fault injected, the pellet conductivity halved: the rise check fails", Math.abs(rise/wantBad - 1) > 0.3 ? 1 : 0, 1, 0,
      "the rise check above must be able to fail", {abs:true, note:"off by " + ((rise/wantBad - 1)*100).toFixed(0) + " %"});
  }
}
