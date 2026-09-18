"use strict";
const {check, commissionPreset} = require("./lib.js");
const G = commissionPreset(0);
const ST = G.ST, N = G.E_DEC_N, T0 = 9.46e7;
ST.csN[0] = 1;
for(let g=0;g<N;g++) ST.csDec[g] = G.E_DEC_A[g];
ST.csN[0] = 0;
const ww = t => 0.0622*(Math.pow(t, -0.2) - Math.pow(t + T0, -0.2));
let t = 0;
for(const at of [10, 100, 1000, 3600, 36000, 86400, 3e5]){
  while(t < at){ const dt = Math.min(at - t, t < 100 ? 0.02 : t < 1e4 ? 1 : 20); G.eCoreDecayStep(dt); t += dt; }
  check("decay heat " + at + " s after shutdown", ST.csDecay[0], ww(at), 0.05,
    "Way-Wigner P/P0 = 0.0622[t^-0.2 - (t+T0)^-0.2], T0 = 3 years at power", {unit:"of rated"}); }
