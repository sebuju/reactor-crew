"use strict";
// chunks: pwr msr
/* point kinetics: pwr = the inhour equation and the shared group tables, msr = a fuel dissolved in its coolant, its precursors leaving the core */
const {check, load, commissionPreset, inBundle, march} = require("./lib.js");
const mode = process.argv[2] || "pwr";
const G0 = load(), pre = mode === "msr" ? G0.PLANTPRE.findIndex(r => r[0] === "MSRE") : 0;
const G = commissionPreset(pre);
const PT = G.PT, ST = G.ST, c = 0, gb = 0, L = PT.coreLAM[c];
const bet = [], lam = [];
for(let g=0;g<6;g++){ bet.push(PT.coreBet[gb+g]); lam.push(PT.coreLam[gb+g]); }
const B = bet.reduce((a, b) => a + b, 0);
/* the inhour equation's own root for the asymptotic period; mu the groups' loss to the loop, 0 for a fixed fuel */
const inhour = (rho, lo, hi, mu) => { const m = mu || [0, 0, 0, 0, 0, 0];
  const f = T => { const w = 1/T; return L*w + bet.reduce((s, b, g) => s + b*(w + m[g])/(w + lam[g] + m[g]), 0) - rho; };
  for(let i=0;i<200;i++){ const x = (lo + hi)/2; if((f(x) > 0) === (f(lo) > 0)) lo = x; else hi = x; }
  return (lo + hi)/2; };
function period(pcm, secs, n0, mu){
  const m = mu || [0, 0, 0, 0, 0, 0];
  ST.csN[c] = n0;
  for(let g=0;g<6;g++) ST.csC[gb+g] = bet[g]*n0/(L*(lam[g] + m[g]));
  const dt = 0.02, N = Math.round(secs/dt); let a = 0, b = 0;
  for(let i=0;i<N;i++){ ST.csRho[c] = pcm; G.eCoreKineticsStep(dt);
    if(i === N - 501) a = Math.log(ST.csN[c]); if(i === N - 1) b = Math.log(ST.csN[c]); }
  return 10/(b - a);
}
const SRC = "inhour equation rho = Lambda/T + sum beta_i/(1+lambda_i T) with the model's own six groups (Keepin U-235 shape) and Lambda";

if(mode === "pwr"){
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
}

if(mode === "msr"){
  const K = G.P.cores[G.IX.coreId[c]], ROW = "a molten-salt reactor's fuel";
  const MS = "MSRE fuel salt LiF-BeF2-ZrF4-UF4 65-29.1-5-0.9 mol % (ORNL-4541, ORNL-TM-728): cp 0.47 Btu/lb/F, 141 lb/ft3 at 1200 F, liquidus 434 C; as commonly quoted, not read at source";
  check("MSRE: fuel mass in pins", PT.coreFuelKg[c], 0, 0, "a dissolved fuel has no pellet", {abs:true, unit:"kg"});
  check("MSRE: gap resistance", PT.corePinRg[c], 0, 0, "a dissolved fuel has no gap", {abs:true, unit:"K.m/W"});
  check("MSRE: clad zirconium", K.cladKg, 0, 0, "a dissolved fuel has no clad", {abs:true, unit:"kg"});
  march(10);
  let d = 0; for(let k=0;k<G.XNN;k++) d = Math.max(d, Math.abs(ST.csNTf[k] - ST.csNTc[k]));
  check("MSRE: fuel temperature against salt temperature, every node after 10 s", d, 0, 0, "the fuel is the salt", {abs:true, unit:"K"});
  const cD = G.coreD(G.IX.coreId[c]), a = G.COOLANT[cD.cool], salt = G.FUEL[G.zoneFuelOf(cD, 0)];
  check("MSRE: salt heat capacity", a.cp, 0.47*4.1868, 0.01, MS, {unit:"kJ/kg/K"});
  check("MSRE: salt density", a.dens*G.RHO_K, 141*16.0185, 0.01, MS, {unit:"kg/m3"});
  check("MSRE: salt freezes (the fuel row's melting point)", salt.tmelt, 434 + 273.15, 1, MS, {abs:true, unit:"K"});

  /* the precursors' loss to the loop at the drawn flow, and none at rest */
  const mu = () => { G.eCircMuA(c); return Array.from(G.E_CMU); };
  const beff = m => bet.reduce((s, b, g) => s + b*lam[g]/(lam[g] + m[g]), 0)/B;
  const m1 = mu(), r1 = beff(m1), fn = G.SX.coreFN[c];
  const PUB = "MSRE U-235: static beta 0.00666, circulation loss 0.212 % dk/k (ORNL-TM-1647 / ORNL-4233), ratio 0.68; as commonly quoted, not read at source";
  check("MSRE: effective delayed fraction over static at the drawn flow", r1, (0.666 - 0.212)/0.666, 0.10, PUB,
    {abs:true, gap:Math.abs(r1 - 0.682) > 0.10 ? ROW : "", note:"core transit " + G.E_CMU[6].toFixed(2) + " s, loop " + G.E_CMU[7].toFixed(2) + " s at flow " + fn.toFixed(3) + " of reference"});
  G.SX.coreFN[c] = 0; const m0 = mu();
  check("MSRE: effective delayed fraction at zero flow", beff(m0), 1, 0, "a fuel that stands still keeps every precursor", {abs:true});
  G.SX.coreFN[c] = fn;
  /* a step of 50 pcm over each state's own critical point: the circulating core runs faster, by what its groups say */
  const loss = bet.reduce((s, b, g) => s + b*m1[g]/(lam[g] + m1[g]), 0);
  const Tr = period(loss*1e5 + 50, 200, 1e-3, m1);
  G.SX.coreFN[c] = 0; const Tz = period(50, 200, 1e-3); G.SX.coreFN[c] = fn;
  check("MSRE: asymptotic period at +50 pcm over critical, circulating", Tr, inhour(loss + 50e-5, 1e-3, 1e5, m1), 0.02, SRC + ", each group losing mu_i = (1 - exp(-lambda_i tau_loop))/tau_core", {unit:"s"});
  check("MSRE: the circulating period is shorter than the standing one", Tr, Tz, 0, "fewer delayed neutrons: a faster reactor", {pass:Tr < Tz, unit:"s", note:"standing " + Tz.toFixed(1) + " s"});
  const keep = G.eCircMuA;
  inBundle("eCircMuA = function(){ for(let g=0;g<6;g++) E_CMU[g] = 0; }");
  const rBad = beff(mu());
  inBundle("eCircMuA = " + keep.toString().replace(/^function eCircMuA/, "function"));
  check("fault injected, the static beta at the drawn flow: the circulating check fails", Math.abs(rBad - 0.682) > 0.10 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"reads " + rBad.toFixed(3)});
}
