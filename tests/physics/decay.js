"use strict";
/* fission-product decay heat against the published standard, not against the model's own fit */
const {check, commissionPreset} = require("./lib.js");
const G = commissionPreset(0);
const ST = G.ST, N = G.E_DEC_N;
const ROW = "decay heat after shutdown";

/* ANSI/ANS-5.1-1979 Table 7, thermal fission of U-235: alpha MeV/(fission s), lambda 1/s, typed a second time */
const A = [6.5057e-01, 5.1264e-01, 2.4384e-01, 1.3850e-01, 5.5440e-02, 2.2225e-02, 3.3088e-03, 9.3015e-04,
  8.0943e-04, 1.9567e-04, 3.2535e-05, 7.5595e-06, 2.5232e-06, 4.9948e-07, 1.8531e-07, 2.6608e-08,
  2.2398e-09, 8.1641e-12, 8.7797e-11, 2.5131e-14, 3.2176e-16, 4.5038e-17, 7.4791e-17];
const L = [2.2138e+01, 5.1587e-01, 1.9594e-01, 1.0314e-01, 3.3656e-02, 1.1681e-02, 3.5870e-03, 1.3930e-03,
  6.2630e-04, 1.8906e-04, 5.4988e-05, 2.0958e-05, 1.0010e-05, 2.5438e-06, 6.6361e-07, 1.2290e-07,
  2.7213e-08, 4.3714e-09, 7.5780e-10, 2.4786e-10, 2.2384e-13, 2.4600e-14, 1.5699e-14];
/* the standard's own infinite-irradiation form, over the 200 MeV/fission it is normalised on */
const Q = 200;
const ans = t => { let s = 0; for(let i=0;i<A.length;i++) s += A[i]/L[i]*Math.exp(-L[i]*t); return s/Q; };
const SRC = "ANSI/ANS-5.1-1979 Table 7 (U-235 thermal), infinite irradiation, on 200 MeV/fission; fission products only, no capture in fission products and no U-239 or Np-239";
/* JEF Report 17 ch. 9: ANS-5.1 agrees with the Tobias experimental standard to about 4 % */
const TOL = 0.05;

check("group count: the standard's own 23", N, A.length, 0, SRC, {abs:true});
check("decay heat at shutdown after infinite irradiation", 1 - G.PROMPT_F, ans(0), TOL, SRC, {unit:"of rated", gap:ROW,
  note:"the standard reads " + (ans(0)*100).toFixed(3) + " %; 1 - PROMPT_F is held at " + ((1 - G.PROMPT_F)*100).toFixed(3) +
    " % so the rest point closes on the fission partition"});
/* the same partition FIS_* is built from, typed a second time: delayed beta 6.500 + delayed gamma 6.330 over
   everything recoverable, which is ER 194.077 less neutrinos plus the 7.5 MeV capture gamma MT=458 omits */
{ const endf = (6.500 + 6.330)/(169.130 + 4.8276 + 0.008074 + 7.2813 + 7.5 + 6.500 + 6.330);
  check("decay heat at shutdown, against evaluated fission energy release", 1 - G.PROMPT_F, endf, 0.02,
    "ENDF/B-VIII.0 U-235 MF=1 MT=458 over its own recoverable total plus the 7.5 MeV capture gamma this model carries",
    {unit:"of rated", gap:ROW, note:"evaluated " + (endf*100).toFixed(3) + " %, the ANS-5.1 fit " + (ans(0)*100).toFixed(3) + " %"}); }

/* the eleven-group Way-Wigner fit this replaced, for the distance it was carrying */
const ww = t => 0.0622*(Math.pow(t, -0.2) - Math.pow(t + 9.46e7, -0.2));

/* U-239 and Np-239 after infinite irradiation, ANSI/ANS-5.1-1979 eqs. 14-15 as commonly quoted: 0.474 and 0.419 MeV a decay,
   R U-238 captures per fission; half-lives 23.45 min and 2.356 d (NUBASE2020, as commonly quoted) */
const EU = 0.474, EN = 0.419, lU = Math.LN2/(23.45*60), lN = Math.LN2/(2.356*86400), R = G.PT.coreCapR[0];
const actU = t => EU*R*Math.exp(-lU*t)/Q, actN = t => EN*R*(lU*Math.exp(-lN*t) - lN*Math.exp(-lU*t))/(lU - lN)/Q;
const ASRC = "ANSI/ANS-5.1-1979 eqs. 14-15 (as commonly quoted), U-239 0.474 MeV and Np-239 0.419 MeV a decay, infinite irradiation";
check("STOCK PWR: U-238 captures per fission at its rest burnup, R", R, 0.65, 0, "NRC ML021720702 (Appendix K decay heat standards): R = 0.7 chosen for a PWR, 0.6 in the standard's own example; the behaviour is a band",
  {pass:R >= 0.5 && R <= 0.8, note:"off the law's own U-238 capture and fission rates at the core's burnup"});
{ let s = G.PT.corePrompt[0]; for(let g=0;g<N;g++) s += G.E_DEC_A[g];
  check("the rest closes on the rated heat: prompt, fission products, U-239 and Np-239", s + (EU + EN)*R/Q, 1, 1e-12,
    "energy: at rest the heat is the rated fission power, whatever share of it is born late", {abs:true}); }

ST.csN[0] = 1;
for(let g=0;g<N;g++) ST.csDec[g] = G.E_DEC_A[g];
ST.csU239[0] = actU(0); ST.csNp239[0] = actN(0);
ST.csN[0] = 0;
let t = 0, worst = 0, worstT = 0;
for(const at of [1, 10, 100, 1000, 3600, 36000, 86400, 3e5]){
  while(t < at){ const dt = Math.min(at - t, t < 100 ? 0.02 : t < 1e4 ? 1 : 20); G.eCoreDecayStep(dt); t += dt; }
  const want = ans(at) + actU(at) + actN(at), err = Math.abs(ST.csDecay[0]/want - 1);
  if(err > worst){ worst = err; worstT = at; }
  check("decay heat " + at + " s after shutdown, fission products, U-239 and Np-239", ST.csDecay[0], want, TOL, SRC + "; " + ASRC, {unit:"of rated", gap:ROW,
    note:"Np-239 " + (actN(at)*100).toFixed(4) + " %; Way-Wigner, the fit this replaced, reads " + (ww(at)*100).toFixed(4) + " %"});
  if(at >= 3600) check("Np-239 heat " + at + " s after shutdown against its Bateman chain from U-239", ST.csNp239[0], actN(at), 1e-6,
    "the two-member chain solved exactly: " + ASRC, {unit:"of rated"});
  if(at === 86400) check("fault injected, Np-239 carries no energy: the 1-day check fails", Math.abs((ST.csDecay[0] - ST.csNp239[0])/want - 1) > TOL ? 1 : 0, 1, 0,
    "the decay check must be able to fail on the actinide it adds", {abs:true}); }
/* the same march with every amplitude 10 % high, which is what a mis-normalised table would do */
{ ST.csN[0] = 1;
  for(let g=0;g<N;g++) ST.csDec[g] = G.E_DEC_A[g]*1.1;
  ST.csU239[0] = actU(0); ST.csNp239[0] = actN(0);
  ST.csN[0] = 0;
  let u = 0;
  while(u < 100){ const dt = Math.min(100 - u, 0.02); G.eCoreDecayStep(dt); u += dt; }
  const bad = Math.abs(ST.csDecay[0]/(ans(100) + actU(100) + actN(100)) - 1);
  check("fault injected, every group's amplitude x 1.1: the curve fails", bad > TOL ? 1 : 0, 1, 0,
    "the decay checks above must be able to fail", {abs:true,
      note:"at 100 s the faulted march reads " + (bad*100).toFixed(1) + " % out against a " + (TOL*100).toFixed(0) +
        " % tolerance; worst true error " + (worst*100).toFixed(2) + " % at " + worstT + " s"}); }
