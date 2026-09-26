"use strict";
// chunks: cise cpr tmin
// preset: - 0 0
/* the crisis law each core is judged on, raw: cise = CISE-4 by hand, cpr = the ring's critical power ratio against the closed form, tmin = the rewet temperature; each family's rest margin is plant.js */
const {check, load, commissionPreset, swap, tsat} = require("./lib.js");
const mode = process.argv[2];
const PC = 22.064;
/* CISE-4 as INL/EXT-06-11725 eqs A24-A28 (Todreas & Kazimi 1990), SI */
const cise = (p, G, D, L) => { const r = 1 - p/PC, gs = 3375*r*r*r;
  const a = G <= gs ? 1/(1 + 1.481e-4*Math.pow(r, -3)*G) : r/Math.pow(G/1000, 1/3), b = 0.199*Math.pow(PC/p - 1, 0.4)*G*Math.pow(D, 1.4);
  return {a, b, x:a*L/(b + L)}; };
const SRC_CISE = "CISE-4, INL/EXT-06-11725 eqs A24-A28 citing Todreas & Kazimi (1990), SI";
/* Groeneveld & Stewart (1982) as TRACE V5.0 eqs 6-128-6-131 */
const tminGS = p => { const f = q => 557.85 + 44.1*q - 3.72*q*q;
  return p < 9 ? f(p) : (f(9) - tsat(9))*(PC - p)/(PC - 9) + tsat(p); };

if(mode === "cise"){
  const G = load(), io = G.E_CISE; let e = 0;
  for(const g of [1000, 2000]) for(const L of [1, 2, 3]){
    io[0] = 7; io[1] = g; io[2] = 0.012; G.eCiseA();
    e = Math.max(e, Math.abs(io[3]*L/(io[4] + L)/cise(7, g, 0.012, L).x - 1)); }
  check("CISE-4 critical quality at 7 MPa, G 1000 and 2000 kg/m2s, D 12 mm, L_B 1, 2, 3 m against the formula typed here, worst", e, 0, 1e-12, SRC_CISE, {abs:true});
  const r = 1 - 7/PC, gs = 3375*r*r*r, lo = 1/(1 + 1.481e-4*Math.pow(r, -3)*gs), hi = r/Math.pow(gs/1000, 1/3);
  check("the two branches of a meet at G* = 3375 (1 - P/Pc)^3", hi/lo - 1, 0, 2e-4, SRC_CISE + "; the published coefficients are rounded", {abs:true, note:"a " + lo.toFixed(5) + " below, " + hi.toFixed(5) + " above"});
  io[0] = 7; io[1] = 1000; io[2] = 0.012; G.eCiseA();
  check("b at 7 MPa, G 1000, D 12 mm", io[4], 0.56, 0.02, SRC_CISE + ", the D exponent read as 1.4: b ~0.56 m", {unit:"m"});
}

if(mode === "cpr"){
  const G = commissionPreset(0), XNZ = G.XNZ, a = 0.68, b = 0.55, hfg = 1500, hs = 2350, hIn = 2250, dz = 0.37, rise = 12, L = XNZ*dz;
  const run = () => { for(let j=0;j<XNZ;j++){ G.E_CPD[j] = rise; G.E_CPS[j] = hs; G.E_CPF[j] = hfg; G.E_CPA[j] = a; G.E_CPB[j] = b; }
    G.E_CPR[0] = hIn; G.E_CPR[1] = dz; G.eCprRingA(0, 0); return {lam:G.ST.csCpr[0], j:G.ST.csCprJ[0]}; };
  const want = (a*hfg + hs - hIn)/((b + L)*rise/dz), got = run();
  check("a uniformly heated channel's critical power ratio by bisection against the closed form (x_e linear in z: lambda = (a h_fg + h_sat - h_in)/((b + L) q'))",
    got.lam, want, 1e-6, SRC_CISE + ": x_e(L) = x_c(L - z_B), z_B where x_e crosses 0, solved by hand", {note:"crisis at plane " + got.j + " of " + (XNZ - 1)});
  const back = swap(G, "eCprTestA", "const L = z - zB,", "const L = z,");
  const f = run(); back();
  check("fault injected, the boiling length measured from the channel inlet: the check above fails", Math.abs(f.lam/want - 1) > 1e-6 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"reads " + f.lam.toFixed(4)});
}

if(mode === "tmin"){
  const G = commissionPreset(0), PT = G.PT, ST = G.ST, c = 0, XNZ = G.XNZ, io = G.E_TM, SRC = "Groeneveld & Stewart (1982), TRACE V5.0 Theory Manual eqs 6-128-6-131, IF97 region 4 by hand";
  let e = 0;
  for(const p of [1, 7, 15.5]){ io[0] = p; io[1] = tsat(p); G.eTminWA(); e = Math.max(e, Math.abs(io[2]/tminGS(p) - 1)); }
  check("T_min against Groeneveld-Stewart typed here at 1, 7 and 15.5 MPa, worst", e, 0, 1e-12, SRC, {abs:true, note:"15.5 MPa: " + tminGS(15.5).toFixed(1) + " K, " + (tminGS(15.5) - tsat(15.5)).toFixed(1) + " K over saturation"});
  /* a departed node is held in film boiling while its can is over T_min at its plane's own pressure, and rewets under it */
  ST.sc[G.SC_DICEOFF] = 1;
  const cs = G.E_CS, k = 5, snap = G.engSnap(G.engSnapNew());
  const tick = () => { cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 1;
    cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c); G.eCoreStep(c); };
  tick(); const p = G.E_AXP[k], tm = tminGS(p);
  const held = dT => { G.engRestore(snap); ST.csNDnb[k] = 1; ST.csNTcl[k] = tm + dT; ST.csNHc[k] *= G.E_DNB_FILM; tick(); return ST.csNDnb[k]; };
  const up = held(1), dn = held(-1);
  check("a departed node with its can 1 K over T_min at " + p.toFixed(2) + " MPa stays in film boiling, 1 K under it rewets", up === 1 && dn === 0 ? 1 : 0, 1, 0, SRC,
    {abs:true, note:"T_min " + tm.toFixed(1) + " K; held " + up + ", under " + dn});
  const b2 = swap(G, "eCoreStep", "eTminWA(); E_AXTM[j] = E_TM[2];", "eTminWA(); E_AXTM[j] = E_AXS[j] + E_DT_LEID;");
  const f = held(1); b2();
  check("fault injected, the fixed 150 K rewet: the node 1 K over T_min at 15.5 MPa rewets, and the check above fails", f === 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"held " + f});
}
