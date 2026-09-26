"use strict";
// chunks: xe sm eq
const {check, commissionPreset, watch} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, c = 0, nb = 0, XNN = G.XNN, K = G.XE_CLOCK;
const lI = PT.coreLamI[c], lX = PT.coreLamX[c], lP = PT.coreLamP[c];
const snap = G.engSnap(G.engSnapNew());
/* the core's own step and nothing else, at a flux held by hand: the poison ODE is the question, not the plant around it */
const coreStep = (dt, n) => { const cs = G.E_CS; ST.csN[c] = n;
  cs[0] = dt; cs[1] = ST.csHeat[c]; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 1;
  cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], 1e-3); cs[6] = G.eNetCoreInH(c);
  G.eCoreStep(c); };
const mean = a => { let v = 0; for(let k=0;k<XNN;k++) v += G.nodeW[k]*a[nb+k]; return v; };
const run = (secs, dt, n) => watch(G, {dt, cap:secs, step:() => coreStep(dt, n)});

if(mode === "xe"){
  const I0 = mean(ST.csXI), X0 = mean(ST.csXX);
  const bateman = (li, lx, t) => X0*Math.exp(-lx*t) + li*I0/(lx - li)*(Math.exp(-li*t) - Math.exp(-lx*t));
  let t = 0; const seen = [];
  for(const h of [2, 5, 11]){ const at = h*3600/K;
    run(at - t, 0.02, 0); t = at; const x = mean(ST.csXX);
    seen.push([at, x]);
    check("xenon " + h + " h after shutdown (" + at.toFixed(0) + " s at the " + K + "x clock)", x/X0, bateman(lI, lX, at)/X0, 1e-3,
      "Bateman I-135 -> Xe-135 with no flux: half-lives 6.57 h and 9.14 h (ENDF/B-VIII.0), both clocks x" + K, {unit:"of equilibrium"}); }
  check("Xe-135 half-life read off the clock", Math.LN2/lX*K/3600, 9.14, 1e-6, "Xe-135 half-life 9.14 h (ENDF/B-VIII.0)", {unit:"h"});
  check("I-135 half-life read off the clock", Math.LN2/lI*K/3600, 6.57, 1e-6, "I-135 half-life 6.57 h (ENDF/B-VIII.0)", {unit:"h"});
  const [at, x] = seen[1], w = bateman(G.XE.lamI*400, G.XE.lamX*400, at)/X0;
  check("fault injected, the curve read at a 400x clock while the model runs " + K + "x", Math.abs(x/X0 - w)/w > 1e-3 ? 1 : 0, 1, 0,
    "the Bateman checks above must be able to fail", {abs:true, note:"measured " + (x/X0).toFixed(4) + " against " + w.toFixed(4)});
}

if(mode === "sm"){
  check("Pm-149 half-life read off the clock", Math.LN2/lP*K/3600, 53.08, 1e-6, "Pm-149 half-life 53.08 h (NUBASE2020)", {unit:"h"});
  const gP = PT.coreGP[c], sigS = PT.coreSigS[c], sEq = gP/sigS;
  for(const n of [1, 0.4]){
    for(let k=0;k<XNN;k++){ ST.csPm[nb+k] = gP*n*ST.csPhi[nb+k]/lP; ST.csSm[nb+k] = sEq; }
    run(1, 0.02, n);
    let d = 0; for(let k=0;k<XNN;k++) d = Math.max(d, Math.abs(ST.csSm[nb+k] - sEq)/sEq);
    check("equilibrium Sm-149 at " + (n*100) + " % flux stays put", d, 0, 1e-6,
      "analytic: S_eq = gamma_Pm Sigma_f/sigma_Sm, independent of the flux", {abs:true, unit:"of S_eq"});
    G.engRestore(snap); }
  coreStep(0.02, PT.coreN0[c]);
  const smW = -G.SX.coreO[G.E_CO_SM], xeW = -G.SX.coreO[G.E_CO_XE];
  check("equilibrium samarium worth in the tick against the design's", smW, G.derived().smW, 1e-6,
    "w_Sm = gamma_Pm (Sf/Sa) at critical, flux-independent (Lamarsh & Baratta sec. 7.5)", {unit:"pcm"});
  check("equilibrium samarium worth: a few hundred pcm, below xenon's", smW, 0.0108/2.43*1e5, 0,
    "Lamarsh & Baratta, Introduction to Nuclear Engineering, sec. 7.5: rho_Sm = -gamma_Pm/nu, ~450 pcm on U-235 (as commonly quoted, not read at source); behaviour, not the decimal",
    {unit:"pcm", pass:smW > 200 && smW < 1000 && smW < xeW, note:"xenon " + xeW.toFixed(0) + " pcm"});
  /* one Pm half-life at no flux; dt 0.25 s keeps the explicit step's own error near 3e-5 of the rise */
  const shut = lam => { G.engRestore(snap); PT.coreLamP[c] = lam;
    const P0 = mean(ST.csPm), S0 = mean(ST.csSm), T = Math.LN2/lP;
    run(T, 0.25, 0); const S = mean(ST.csSm), Pm = mean(ST.csPm);
    PT.coreLamP[c] = lP;
    return {rise:S - S0, want:P0*(1 - Math.exp(-lP*T)), book:(S + Pm) - (S0 + P0), P0}; };
  const r = shut(lP);
  check("Sm-149 after shutdown: one Pm half-life lands half the standing Pm", r.rise, r.want, 1e-4,
    "Bateman, Pm-149 -> Sm-149 with no flux (Pm-149 53.08 h, NUBASE2020)", {unit:"normalised"});
  check("Sm-149 never decays: Pm + Sm conserved with no flux", r.book/r.P0, 0, 1e-12,
    "conservation: Sm-149 is stable", {abs:true, unit:"of standing Pm"});
  const f = shut(2*lP);
  check("fault injected, Pm decay constant x2", Math.abs(f.rise - f.want)/f.want > 1e-4 ? 1 : 0, 1, 0,
    "the post-shutdown check above must be able to fail", {abs:true, note:"rise " + f.rise.toExponential(4) + " against " + f.want.toExponential(4)});
}

if(mode === "eq"){
  const d0 = G.derived(), cD = G.priD(), XE = G.XE, g = XE.gI + XE.gX;
  const LAM = "Lamarsh & Baratta, Introduction to Nuclear Engineering, sec. 7.5 (as commonly quoted, not read at source): X = (gI + gX) F/(lamX + sigX phi), rho = -(gI + gX)(Sf/Sa) phi/(phi + lamX/sigX)";
  const DOE = "DOE-HDBK-1019/2-93, Reactor Theory (Nuclear Parameters), Module 3, Xenon (read)";
  /* the burnout ratio off its inputs, spelt out */
  { const bk = G.latBook(cD, 0, d0.bu), th = G.thermShareOf(cD, d0.bu), a = G.COOLANT[cD.cool], Tn = Math.min(a.Tref, G.coolTsat(a, a.P0));
    let gF = 0, w = 0; const io = new Float64Array(2);
    for(const k in bk.sfis){ const s = bk.sfis[k]*G.NUC[k].sf/G.NUC[k].sa; G.westcottA(k, "gf", Tn, io); gF += s*io[0]; w += s; }
    gF /= w;
    const Ef = G.heatShares(cD).Q0/G.PROMPT_F*1.602176634e-13, F = th*cD.power*1e6/Ef, V = bk.sfV*1e4*4*G.latM(cD).hgt*100;
    const s = 2.65e-18*1.159/gF*(F/V)/XE.lamX;
    check("STOCK PWR: burnout over decay at rated power off the core's own fission rate", d0.sigK, s, 1e-9,
      "sigma_X g_X phi/lamX with phi = thermal fissions/(Sigma_f g_F V): Xe-135 2.65e6 b, g 1.159 (ENDF/B-VII.1 at 293.6 K, Pritychenko & Mughabghab 2012 Table VII, read)",
      {unit:"", note:"thermal flux " + (d0.phi/1e13).toFixed(2) + "e13 /cm2/s at the 2200 m/s rate, fission g " + gF.toFixed(3)});
    const xs = d0.xeW/(1e5*g*G.COOLANT[cD.cool].xe);
    check("STOCK PWR: equilibrium worth against its closed form on its own burnout", xs, G.xeBook(cD, d0.leak, d0.bu).S*s/(1 + s), 1e-9, LAM, {unit:"of (gI+gX)"}); }
  check("STOCK PWR: the tick's equilibrium xenon at mean flux against the design's worth", PT.coreKXE[c]*G.eXeEq(c, 1), d0.xeW, 1e-9,
    "one equilibrium: the tick's node law at unit flux carries the design's worth", {unit:"pcm"});
  check("STOCK PWR: equilibrium xenon worth at full power", d0.xeW, 2650, 150,
    "about 2500 pcm in a PWR (nuclear-power.com, secondary) to 2800 pcm (Westinghouse Technology Systems Manual sec. 2.1, seen quoted, not read)",
    {abs:true, unit:"pcm", gap:"xenon off the core's own flux", note:"burnout " + d0.sigK.toFixed(2) + " at " + d0.bu.toFixed(1) + " MWd/kgHM"});
  const at = n => n*d0.sigK/(1 + n*d0.sigK)*(1 + d0.sigK)/d0.sigK;
  check("STOCK PWR: equilibrium xenon at 25 % power over 100 %", at(0.25), 0.5, 0,
    DOE + ": 'equilibrium xenon-135 at 25% power is more than half the value at 100% power for many reactors'",
    {pass:at(0.25) > 0.5, unit:"", gap:"xenon off the core's own flux"});
  check("STOCK PWR: hours to the xenon peak after a trip from full power", d0.xePk.h, 10, 2,
    DOE + ": 'the peak in xenon-135 concentration about 10 hours after shutdown'", {abs:true, unit:"h", gap:"xenon off the core's own flux", note:"peak x" + d0.xePk.x.toFixed(2)});
  check("no burnout: a trip adds no xenon peak", G.xePeak(1e-6).x, 1, 1e-4,
    DOE + ": at very low flux 'most xenon is removed by decay ... reactor shutdown does not cause any xenon-135 peaking effect'", {unit:"of equilibrium"});
  const iCal = G.PLANTPRE.findIndex(r => r[0] === "CALDER HALL");
  G.plantPreset(iCal); G.buildLayout(); const dC = G.derived();
  const sat = d => d.sigK/(1 + d.sigK);
  check("CALDER HALL: low-flux pile's equilibrium xenon further short of its saturation than STOCK PWR's", sat(dC), sat(d0), 0,
    LAM + ": the worth grows as phi/(phi + phiX)", {pass:sat(dC) < sat(d0), unit:"of saturation", note:"worth " + dC.xeW.toFixed(0) + " against " + d0.xeW.toFixed(0) + " pcm; burnout " + dC.sigK.toFixed(3) + ", thermal flux " + (dC.phi/1e13).toFixed(2) + "e13"});
  check("CALDER HALL: smaller xenon peak after a trip than STOCK PWR", dC.xePk.x, d0.xePk.x, 0,
    DOE + ": the peak grows with the flux the core ran at", {pass:dC.xePk.x < d0.xePk.x, unit:"of equilibrium"});
  const f3 = {sigK:3};
  check("fault injected, burnout held at 3 for every core: the two CALDER HALL checks fail", sat(f3) < sat(f3) || G.xePeak(3).x < G.xePeak(3).x ? 0 : 1, 1, 0,
    "the two CALDER HALL checks above must be able to fail", {abs:true, note:"both piles at x" + G.xePeak(3).x.toFixed(2) + " of equilibrium after a trip"});
}
