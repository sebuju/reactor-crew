"use strict";
// chunks: xe sm
const {check, commissionPreset} = require("./lib.js");
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
const run = (secs, dt, n) => { for(let i=0, N=Math.round(secs/dt);i<N;i++) coreStep(dt, n); };

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
  check("equilibrium samarium worth against its derivation on the code's own xenon worth", smW,
    PT.coreKXE[c]*gP/PT.coreSig[c], 1e-6,
    "w_Sm = K_Xe gamma_Pm/sigma_X phi, the xenon worth scale times the Sm/Xe cross-section ratio", {unit:"pcm"});
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
