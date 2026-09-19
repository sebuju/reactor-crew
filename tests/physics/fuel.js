"use strict";
// chunks: e0 e5 l0 l5 t0 t1 t2 t3 t4 t5 t6 t7 t8
/* the fuel pin between fission and water: e = the core's energy tick by tick over a rod step, l = the pin's lag with its water held, t = its time constant against a conduction estimate and its heat capacity against the drawn UO2 */
const {check, commissionPreset} = require("./lib.js");
const mode = process.argv[2], pre = +mode.slice(1);
const G = commissionPreset(pre), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[pre][0], XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;
const ROW = "core heat reaches the water through the fuel pin", CAP = "fuel heat capacity";
const rk = PT.coreRated[c]*1000, gq = PT.coreGraphQ[c], ua = PT.corePinUA[c];
const tauF = () => G.XTAU_F*PT.coreRodD[c]/G.ROD_D0;
const filmMean = () => { let f = 0; for(let k=0;k<XNN;k++) f += W[k]*ST.csNFilm[nb+k]; return f; };

if(mode[0] === "e"){
  sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); G.uiBlkSinkOff("rodStep"); G.uiBlkSinkOff("boronDem");
  G.act("rodCommon", ST.csRodPos[c] + 0.02);
  const Cn = tauF()*ua, phi = new Float64Array(XNN), Tf = new Float64Array(XNN), Tg = new Float64Array(XNN), disp = new Float64Array(XNN);
  let res = 0, resInj = 0, worst = 0, heatT = 0, n0 = sc[G.SC_N], nMax = n0, nMin = n0;
  for(let t=0;t<500;t++){
    for(let k=0;k<XNN;k++){ phi[k] = ST.csPhi[nb+k]; Tf[k] = ST.csNTf[nb+k]; Tg[k] = ST.csNTg[nb+k]; disp[k] = ST.csNDisp[nb+k]; }
    G.step(0.02);
    const heat = ST.csHeat[c];
    let fis = 0, stk = 0, dUf = 0, dUs = 0;
    for(let k=0;k<XNN;k++){
      fis += heat*phi[k]*(1 - gq)*(1 - disp[k])*rk*W[k]; stk += gq*heat*phi[k]*rk*W[k];
      dUf += Cn*W[k]*(ST.csNTf[nb+k] - Tf[k]);
      if(gq > 0) dUs += PT.coreGraphKg[c]*W[k]*G.graphCp(Tg[k])*(ST.csNTg[nb+k] - Tg[k]); }
    const zr = ST.csQOx[c]*rk, water = ST.csFQ[c] + ST.csGQ[c];
    const r = (fis + stk + zr)*0.02 - dUf - dUs - water*0.02;
    res += r; resInj += (fis + stk + zr)*0.02 - dUf - dUs - (fis + ST.csGQ[c])*0.02;
    worst = Math.max(worst, Math.abs(r)/(heat*rk*0.02)); heatT += heat*rk*0.02;
    nMax = Math.max(nMax, sc[G.SC_N]); nMin = Math.min(nMin, sc[G.SC_N]); }
  const note = "n " + n0.toFixed(4) + " -> " + sc[G.SC_N].toFixed(4) + " (range " + nMin.toFixed(4) + ".." + nMax.toFixed(4) + "), fuel C " + (Cn/1000).toFixed(2) + " MJ/K";
  check(name + ": core energy over a 10 s rod step, fission + Zr = d(fuel U) + d(stack U) + heat to water", res/heatT, 0, 1e-6,
    "first law on the core: the fuel and the stack store what they do not pass to the water", {abs:true, unit:"of heat x time", note:note + "; worst tick " + worst.toExponential(2)});
  check(name + ": fault injected, the water heated at fission power: the core energy check fails", Math.abs(resInj/heatT) > 1e-6 ? 1 : 0, 1, 0,
    "the energy check above must be able to fail", {abs:true, note:"residual " + (resInj/heatT).toExponential(2) + " of heat x time"});
}

if(mode[0] === "l"){
  const snap = G.engSnap(G.engSnapNew());
  const run = rodK => { G.engRestore(snap);
    const cs = G.E_CS, heat = ST.csHeat[c]*1.05, Tc = Float64Array.from(ST.csNTc.subarray(nb, nb + XNN)), V = Float64Array.from(ST.csNV.subarray(nb, nb + XNN));
    const Tf0 = Float64Array.from(ST.csNTf.subarray(nb, nb + XNN)), law = Tf0.slice(), tF = tauF(), tau = tF/filmMean(), d0 = PT.coreRodD[c];
    let t = 0;
    PT.coreRodD[c] = d0*rodK;
    while(t < tau - 1e-9){
      cs[0] = 0.02; cs[1] = heat; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 0;
      cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c);
      for(let k=0;k<XNN;k++){ const f = ST.csNFilm[nb+k], teq = Tc[k] + heat*rk/ua*ST.csPhi[nb+k]*(1 - gq)/f;
        law[k] = teq + (law[k] - teq)*Math.exp(-0.02*f/tF); }
      G.eCoreStep(c); t += 0.02;
      for(let k=0;k<XNN;k++){ ST.csNTc[nb+k] = Tc[k]; ST.csNV[nb+k] = V[k]; } }
    PT.coreRodD[c] = d0;
    let got = 0, want = 0;
    for(let k=0;k<XNN;k++){ got += W[k]*(ST.csNTf[nb+k] - Tf0[k]); want += W[k]*(law[k] - Tf0[k]); }
    return {err:got/want - 1, tau, t}; };
  const a = run(1), b = run(2);
  check(name + ": pin outflow after a +5 % fission step, water held, against 1 - exp(-t/tau) at t = tau", a.err, 0, 0.01,
    "a lumped pin: C dT/dt = q - UA (T - T_water), tau = C/UA = tauF/film, solved exactly on the drivers the node saw", {abs:true, unit:"of the law",
      note:"tau " + a.tau.toFixed(2) + " s"});
  check(name + ": fault injected, the pin's capacity doubled: the lag check fails", Math.abs(b.err) > 0.01 ? 1 : 0, 1, 0,
    "the lag check above must be able to fail", {abs:true, note:"off by " + (b.err*100).toFixed(1) + " %"});
}

if(mode[0] === "t"){
  const COOL = G.COOLANT[G.coreD(G.IX.coreId[c]).cool].id;
  /* UO2 95 % TD, cp and k near 900-1200 K (MATPRO); gap conductance and water film typical of an LWR (Todreas & Kazimi, Nuclear Systems I, ch. 8) */
  const RHO = 10400, CP = 300, K = 3.0, HGAP = 5700, KCLAD = 16, HFILM = 34000;
  const Ro = PT.coreRodD[c]/2, R = Ro - G.ROD_CLAD;
  const parts = [R*R/(8*K), R/(2*HGAP), R*R*Math.log(Ro/R)/(2*KCLAD), R*R/(2*Ro*HFILM)].map(x => RHO*CP*x);
  const real = parts.reduce((a, b) => a + b, 0), f = filmMean(), tau = tauF()/f;
  const note = "model tauF " + tauF().toFixed(2) + " s / film " + f.toFixed(3) + "; lumped " + real.toFixed(2) + " s = pellet " + parts[0].toFixed(2) +
    " + gap " + parts[1].toFixed(2) + " + clad " + parts[2].toFixed(2) + " + film " + parts[3].toFixed(2) + " (pellet R " + (R*1000).toFixed(2) + " mm, coolant " + COOL + ")";
  const SRC = "lumped pin: tau = rho cp pi R^2 [1/(8 pi k) + 1/(2 pi R h_gap) + ln(Ro/R)/(2 pi k_clad) + 1/(2 pi Ro h_film)], UO2 10400 kg/m3, 0.30 kJ/kg/K, 3 W/m/K (MATPRO; k 2.5-4 and cp 0.27-0.33 over 700-1500 K: the 30 %)";
  /* sodium's film is thinner than water's, so the water figure bounds it; a salt or gas film is thicker and is not estimated */
  if(COOL === "MSR" || COOL === "HTGR")
    check(name + ": fuel time constant at rest, " + COOL + " film not estimated: the lumped figure is a floor", tau, real, 0, SRC, {unit:"s", pass:false, gap:ROW, note});
  else check(name + ": fuel time constant at rest against a lumped conduction estimate", tau, real, 0.3, SRC, {unit:"s", gap:ROW, note});
  const v = G.latVols(G.coreD(G.IX.coreId[c])), C = tauF()*ua, Cr = v.fuel*PT.coreCoreHgt[c]*RHO*CP/1000;
  check(name + ": fuel heat capacity, tauF x pin UA against the drawn UO2 mass x cp", C, Cr, 0.3,
    "UO2 volume off the lattice (fuel area x core height) x 10400 kg/m3 x 0.30 kJ/kg/K", {unit:"kJ/K", gap:CAP,
      note:"UO2 " + (v.fuel*PT.coreCoreHgt[c]*RHO/1000).toFixed(1) + " t, ratio " + (C/Cr).toFixed(2) + ", pin UA " + ua.toFixed(0) + " kW/K"});
}
