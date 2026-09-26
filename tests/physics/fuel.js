"use strict";
// chunks: p0 e0 e5 e7 l0 l5 l7 s0 s5 s7
// preset: arg
/* the fuel pin between fission and water: p = UO2's own heat law and the engine's enthalpy door, e = the core's energy tick by tick over a rod step, l = the pin's lag with its water held, s = the heat that never enters the pin */
const {check, commissionPreset, coreShareHand, CLAD_OWN, watch} = require("./lib.js");
const mode = process.argv[2], pre = +mode.slice(1);
const G = commissionPreset(pre), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;
const {pin, CAP, FM, finkCp, finkH, TAB} = require("./plant/fuel.js"), {rk, outside, modCp, filmMean, fuelOwn, drawnKg, tfMean} = pin(G);

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
  watch(G, {cap:10, step:() => {
    for(let k=0;k<XNN;k++){ phi[k] = ST.csPhi[nb+k]; Tf[k] = ST.csNTf[nb+k]; Tk[k] = ST.csNTcl[nb+k]; Tg[k] = ST.csNTg[nb+k]; TgC[k] = ST.csNTgC[nb+k]; disp[k] = ST.csNDisp[nb+k]; V[k] = ST.csNV[nb+k]; }
    G.step(0.02); },
  each:() => {
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
    nMax = Math.max(nMax, sc[G.SC_N]); nMin = Math.min(nMin, sc[G.SC_N]); }});
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
    PT.coreFuelKg[c] = m0*capK;
    watch(G, {cap:tau + 0.02, event:t => t >= tau - 1e-9 ? "t = tau" : "", step:() => {
      cs[0] = 0.02; cs[1] = heat; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 1;
      cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c);
      const phi = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN)), cov = Float64Array.from(ST.csNCov.subarray(nb, nb + XNN));
      G.eCoreStep(c);
      /* pellet and can as two lumps on the conductances the tick used, RK4 in 40 substeps */
      for(let k=0;k<XNN;k++){ const f = ST.csNFilm[nb+k], hc = ST.csNHc[nb+k], gs = f*hc/(hc - f), pd = ST.csNDw[nb+k]/W[k], o = outside(phi[k], heat, V[k], cov[k], pd), q = ((heat - ST.csDecay[c])*phi[k] + ST.csDecay[c]*pd - o.w - o.b - o.c)*rk/ua;
        const d = (a, b) => [(q - gs*(a - b))*ua/(m*cpf(a)),(gs*(a - b) - hc*(b - Tc[k]))*ua/(mk*cpk(b)/1000)];
        const h = 0.02/40; let a = law[k], b = lawK[k];
        for(let s=0;s<40;s++){ const k1 = d(a, b), k2 = d(a + h/2*k1[0], b + h/2*k1[1]), k3 = d(a + h/2*k2[0], b + h/2*k2[1]), k4 = d(a + h*k3[0], b + h*k3[1]);
          a += h/6*(k1[0] + 2*k2[0] + 2*k3[0] + k4[0]); b += h/6*(k1[1] + 2*k2[1] + 2*k3[1] + k4[1]); }
        law[k] = a; lawK[k] = b; }
      for(let k=0;k<XNN;k++){ ST.csNTc[nb+k] = Tc[k]; ST.csNV[nb+k] = V[k]; } }});
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
