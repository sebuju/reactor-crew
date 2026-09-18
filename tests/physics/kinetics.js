"use strict";
const {check, commissionPreset} = require("./lib.js");
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, c = 0, gb = 0, L = PT.coreLAM[c];
const bet = [], lam = [];
for(let g=0;g<6;g++){ bet.push(PT.coreBet[gb+g]); lam.push(PT.coreLam[gb+g]); }
const B = bet.reduce((a, b) => a + b, 0);
/* the inhour equation's own root for the asymptotic period */
const inhour = (rho, lo, hi) => { const f = T => L/T + bet.reduce((s, b, g) => s + b/(1 + lam[g]*T), 0) - rho;
  for(let i=0;i<200;i++){ const m = (lo + hi)/2; if((f(m) > 0) === (f(lo) > 0)) lo = m; else hi = m; }
  return (lo + hi)/2; };
function period(pcm, secs, n0){
  ST.csN[c] = n0;
  for(let g=0;g<6;g++) ST.csC[gb+g] = bet[g]*n0/(L*lam[g]);
  const dt = 0.02, N = Math.round(secs/dt); let a = 0, b = 0;
  for(let i=0;i<N;i++){ ST.csRho[c] = pcm; G.eCoreKineticsStep(dt);
    if(i === N - 501) a = Math.log(ST.csN[c]); if(i === N - 1) b = Math.log(ST.csN[c]); }
  return 10/(b - a);
}
const SRC = "inhour equation rho = Lambda/T + sum beta_i/(1+lambda_i T) with the model's own six groups (Keepin U-235 shape) and Lambda";
for(const pcm of [50, 100, 200]){
  const T = inhour(pcm*1e-5, 1e-3, 1e5);
  check("asymptotic period, +" + pcm + " pcm step", period(pcm, 120, 1e-3), T, 0.02, SRC, {unit:"s"}); }
check("asymptotic period, -500 pcm step", period(-500, 1200, 1), inhour(-500e-5, -1e5, -1/lam[0] - 1e-9), 0.02, SRC, {unit:"s"});
check("delayed neutron groups: beta fractions", bet[3]/B, 0.395, 1e-3, "Keepin (1965) U-235 thermal group 4 abundance 0.395", {abs:true});
check("delayed neutron groups: longest decay constant", lam[0], 0.0124, 1e-4, "Keepin (1965) U-235 thermal group 1, 0.0124 1/s", {abs:true, unit:"1/s"});
