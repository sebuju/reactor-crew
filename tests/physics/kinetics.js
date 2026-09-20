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
/* the shared group table against Keepin's own figures, digit for digit */
const KU = "Keepin (1965) U-235 thermal delayed-neutron groups", KP = "Keepin (1965) Pu-239 thermal delayed-neutron groups";
const KU_B = [.033,.219,.196,.395,.115,.042], KU_L = [.0124,.0305,.111,.301,1.14,3.01];
const KP_B = [.038,.280,.216,.328,.103,.035], KP_L = [.0129,.0311,.134,.331,1.26,3.21];
G.DNG.U235.bet.forEach((b, g) => check("DNG U-235 abundance group " + (g + 1), b, KU_B[g], 0, KU, {abs:true}));
G.DNG.U235.lam.forEach((l, g) => check("DNG U-235 decay constant group " + (g + 1), l, KU_L[g], 0, KU, {abs:true, unit:"1/s"}));
G.DNG.PU239.bet.forEach((b, g) => check("DNG Pu-239 abundance group " + (g + 1), b, KP_B[g], 0, KP, {abs:true}));
G.DNG.PU239.lam.forEach((l, g) => check("DNG Pu-239 decay constant group " + (g + 1), l, KP_L[g], 0, KP, {abs:true, unit:"1/s"}));
/* asymptotic periods at +100 pcm from the inhour root on each shape at the same beta total and Lambda: the shape alone is worth 16 % */
const rootOn = (bb, ll) => { const f = T => L/T + bb.reduce((s, b, g) => s + b/(1 + ll[g]*T), 0) - 100e-5;
  let lo = 1e-3, hi = 1e5; for(let i=0;i<200;i++){ const m = (lo + hi)/2; if((f(m) > 0) === (f(lo) > 0)) lo = m; else hi = m; } return (lo + hi)/2; };
check("asymptotic period at +100 pcm on the simulated U-235 groups", rootOn(bet, lam), 54.8654, 1e-4, KU + ": inhour root at beta 650 pcm, Lambda 1.043e-5 s", {unit:"s"});
const bP = G.DNG.PU239.bet.map(x => x*B);
check("asymptotic period at +100 pcm on the Pu-239 groups", rootOn(bP, G.DNG.PU239.lam), 63.6442, 1e-4, KP + ": inhour root at the same beta and Lambda", {unit:"s"});
check("fault injected, Pu core on the U-235 shape: the Pu period check fails", Math.abs(rootOn(bet, lam)/63.6442 - 1) > 1e-4 ? 1 : 0, 1, 0, "the Pu period check above must be able to fail", {abs:true, note:"reads " + rootOn(bet, lam).toFixed(2) + " s"});
