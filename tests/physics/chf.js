"use strict";
// chunks: pool blend flood void covered covered,--fault
// preset: 0
/* the boiling crisis at almost no core flow: pool = the zero-flow CHF against Zuber, the void factor and Ivey-Morris by hand, blend = the span up to W-3's floor,
   flood = the Wallis flooding limit per plane, void = the pool void under the level where the march cannot carry its heat, covered = a covered core at decay heat stays in nucleate boiling */
const {check, commissionPreset, inBundle, tsat, if97, if97r2, watch, watchNote} = require("./lib.js");
const mode = process.argv[2], fault = process.argv.includes("--fault");
const G = commissionPreset(0), PT = G.PT, ST = G.ST, W = G.nodeW, XNZ = G.XNZ, XNR = G.XNR, XNN = G.XNN, c = 0;
const S0 = PT.coreSat[c], gFloor = G.E_W3_GLO*1e6/G.E_W3_G, qMean = PT.coreRated[c]*1e6/PT.coreAHeat[c];
const H = PT.coreCoreHgt[c], dz = H/XNZ, aF = PT.coreAFlow[c], dhy = PT.coreDh[c], dhe = 4*aF*H/PT.coreAHeat[c], g = 9.80665;
/* IAPWS R1-76, typed here a second time */
const sigma = T => { const t = 1 - T/647.096; return 0.2358*Math.pow(t, 1.256)*(1 - 0.625*t); };
const sat = p => { const Ts = tsat(p), f = if97(p, Ts), v = if97r2(p, Ts); return {Ts, rf:1/f.v, rg:1/v.v, hfg:v.h - f.h, hf:f.h}; };
const zuber = s => 0.131*s.hfg*1000*Math.sqrt(s.rg)*Math.pow(sigma(s.Ts)*g*(s.rf - s.rg), 0.25);
const voidF = a => 1 - Math.min(a, 0.8);
const ivey = (s, dh) => 1 + 0.1*Math.pow(s.rf/s.rg, 0.75)*dh/s.hfg;
const eng = new Float64Array(6);
const engSat = T => { eng[0] = T; G.curveA(S0, G.CV_RG, eng, 0, 1); G.curveA(S0, G.CV_RF, eng, 0, 2); G.sigmaA(S0, eng, 0, 3); return {rg:eng[1], rf:eng[2], sg:eng[3]}; };
const margin = (p, gShare, x, a) => { const M = G.E_MN;
  M[0] = 1; M[1] = 1; M[2] = 500; M[3] = 500; M[4] = gShare; M[5] = x; M[6] = 0; M[8] = p; M[9] = a; M[10] = Infinity;
  G.eMarginNode(c); return M[7]; };
PT.coreDnbLaw[c] = G.E_DNB_W3;
const keepM = G.eMarginNode.toString(), NEW = "E_MN[7] = Math.min(((1 - gr)*zP + gr*w)/Q, E_MN[10]);";
const swapM = s => inBundle("eMarginNode = " + keepM.replace(NEW, s).replace(/^function eMarginNode/, "function"));

if(mode === "pool"){
  const SRC = "Zuber (1959) 0.131 h_fg rho_g^0.5 [sigma g (rho_f - rho_g)]^0.25 x Griffith et al. (1977) (1 - alpha), held at alpha 0.8 past which IAEA-TECDOC-1203 3.4.2 does not recommend it, x Ivey & Morris (1962) 1 + 0.1 (rho_f/rho_g)^0.75 c_p dT_sub/h_fg, IF97 and IAPWS R1-76 by hand";
  const run = () => { let e = 0, at = "", lo = Infinity;
    for(const p of [1, 7, 15]){ const s = sat(p), dh = s.hf - if97(p, s.Ts - 20).h;
      for(const a of [0, 0.3, 0.6, 0.9]) for(const [x, sub] of [[0, 0], [-dh/s.hfg, dh], [10, 0]]){
        const chf = margin(p, 0, x, a)*qMean, hand = zuber(s)*voidF(a)*ivey(s, sub), r = Math.abs(chf/hand - 1);
        lo = Math.min(lo, chf/hand);
        if(r > e){ e = r; at = p + " MPa, void " + a + ", x " + x.toFixed(3); } } }
    return {e, at, lo}; };
  const r = run();
  check("zero-flow CHF against the pool law by hand, 1/7/15 MPa, void 0/0.3/0.6/0.9, saturated, 20 K subcooled and x 10: worst", r.e, 0, 0.01, SRC,
    {abs:true, note:"worst at " + r.at + "; the engine reads its saturation tables"});
  swapM("E_MN[7] = Math.min(w, zP + (w - zP)*gr)/Q;");
  const f = run(); swapM(NEW);
  check("fault injected, the old min(w, ...) blend: the pool check fails", f.e > 0.01 ? 1 : 0, 1, 0, "the check above must be able to fail",
    {abs:true, note:"worst " + (f.e*100).toFixed(0) + " % at " + f.at + ", lowest ratio " + f.lo.toFixed(3)});
}

if(mode === "blend"){
  const SRC = "below W-3's floor G_f = 1356 kg/m2s: CHF = (1 - G/G_f) q_pool + (G/G_f) q_W3/Biasi; the pool law off the engine's own Zuber reads";
  const run = () => { let e = 0;
    for(const [p, x, a] of [[7, 0, 0.3], [7, 0.5, 0.3], [15, 0.05, 0]]){
      const w = margin(p, gFloor/PT.coreG0[c], x, a)*qMean;
      G.E_CHF[0] = p; G.eChfZuberA(); const zP = G.E_CHF[4]*voidF(a);
      const hand = (0.7*zP + 0.3*w)/qMean;
      e = Math.max(e, Math.abs(margin(p, 0.3*gFloor/PT.coreG0[c], x, a)/hand - 1)); }
    return e; };
  const e = run();
  check("margin at three tenths of W-3's floor against the blend by hand, worst of 7 MPa x 0 and 0.5, 15 MPa x 0.05", e, 0, 1e-9, SRC, {abs:true});
  swapM("E_MN[7] = Math.min((gr*zP + (1 - gr)*w)/Q, E_MN[10]);");
  const f = run(); swapM(NEW);
  check("fault injected, the two weights swapped: the blend check fails", f > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (f*100).toFixed(1) + " %"});
}

if(mode === "flood"){
  const SRC = "Wallis (1969) sqrt(j_g*) + sqrt(j_l*) = C_w with j_l carrying S - W_in; C_w^2 = 1.22 (L_B/D_he)^0.12 (rho_g/rho_f)^-0.032 (1 + 0.055 Bo - 4.08e-3 Bo^2), Chun, Moon & Yang (KNS 2000) eq. 17, Bo held to 4.25-10.0 (their Table 1)";
  const p = 7, cs = G.E_CS, cp = PT.coreCp[c]; ST.csPCore[c] = p; G.eCoreAxialA(c, 0.01);
  let sw = 0; for(let q=0;q<XNN;q++) sw += W[q]*ST.csPhi[q];
  const level = (Q, wIn) => { for(let q=0;q<XNN;q++) ST.csNQl[q] = Q*W[q]*ST.csPhi[q]/sw;
    cs[2] = G.E_AXS[0]; cs[6] = cp*cs[2]; cs[4] = wIn/(PT.coreG0[c]*aF); G.eCoreLevelA(c, 1);
    return {S:Array.from(G.E_LVS), F:Array.from(G.E_LVF)}; };
  const cwOf = (j, e) => { const bo = Math.max(4.25, Math.min(10, dhy*Math.sqrt(g*(e.rf - e.rg)/e.sg)));
    return Math.sqrt(1.22*Math.pow((j + 1)*dz/dhe, 0.12)*Math.pow(e.rg/e.rf, -0.032)*(1 + 0.055*bo - 4.08e-3*bo*bo)); };
  const sMax = (j, wIn) => { const e = engSat(G.E_AXS[j]), gd = Math.sqrt(g*dhy*(e.rf - e.rg)), cw = cwOf(j, e);
    const f = S => Math.sqrt(S/(aF*Math.sqrt(e.rg)*gd)) + Math.sqrt(Math.max(S - wIn, 0)/(aF*Math.sqrt(e.rf)*gd)) - cw;
    if(f(wIn) >= 0) return wIn;
    let lo = wIn, hi = Math.max(2*wIn, 1); while(f(hi) < 0) hi *= 2;
    for(let k=0;k<200;k++){ const m = (lo + hi)/2; if(f(m) < 0) lo = m; else hi = m; }
    return (lo + hi)/2; };
  const run = () => { let e = 0, e9 = 0, inf = true;
    const Q = 300e3, a = level(Q, 0);
    for(let j=0;j<XNZ;j++){ e = Math.max(e, Math.abs(a.F[j]/(sMax(j, 0)/a.S[j]) - 1));
      const s = engSat(G.E_AXS[j]), s9 = cwOf(j, s)**2*aF*Math.sqrt(s.rg*g*dhy*(s.rf - s.rg))/(1 + Math.pow(s.rg/s.rf, 0.25))**2;
      e9 = Math.max(e9, Math.abs(a.F[j]*a.S[j]/s9 - 1)); }
    const wIn = 0.3*a.S[XNZ-1], b = level(Q, wIn);
    for(let j=0;j<XNZ;j++){ if(b.S[j] <= wIn){ if(b.F[j] !== Infinity) inf = false; continue; }
      e = Math.max(e, Math.abs(b.F[j]/(sMax(j, wIn)/b.S[j]) - 1)); }
    const c2 = level(Q, 2*a.S[XNZ-1]); for(let j=0;j<XNZ;j++) if(c2.F[j] !== Infinity) inf = false;
    return {e, e9, inf, top:a.F[XNZ-1], S:a.S[XNZ-1]}; };
  const r = run();
  check("flooding margin S_max/S per plane against the Wallis relation solved by bisection, no inflow and 30 % of the top plane's steam fed, worst", r.e, 0, 1e-9, SRC,
    {abs:true, note:"300 MW into the liquid at 7 MPa: top plane " + r.S.toFixed(1) + " kg/s, margin " + r.top.toFixed(3)});
  check("at no inflow the limit is their eq. 9, q A_B/h_fg = C_w^2 A_f (rho_g g D drho)^0.5 [1 + (rho_g/rho_f)^0.25]^-2, worst plane", r.e9, 0, 1e-9,
    "Chun, Moon & Yang (KNS 2000) eq. 9", {abs:true});
  check("a plane whose steam the inflow carries has no flooding limit", r.inf ? 1 : 0, 1, 0, "no liquid has to come down against the steam", {abs:true});
  const keep = G.eCoreLevelA.toString();
  inBundle("eCoreLevelA = " + keep.replace("Math.sqrt(cw*cw - d2*wIn)", "cw").replace(/^function eCoreLevelA/, "function"));
  const f = run(); inBundle("eCoreLevelA = " + keep.replace(/^function eCoreLevelA/, "function"));
  check("fault injected, j_l* on the whole S: the Wallis check fails", f.e > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (f.e*100).toFixed(1) + " %"});
  const s = sat(p), bo = Math.max(4.25, Math.min(10, dhy*Math.sqrt(g*(s.rf - s.rg)/sigma(s.Ts))));
  const cw2 = 1.22*Math.pow(H/dhe, 0.12)*Math.pow(s.rg/s.rf, -0.032)*(1 + 0.055*bo - 4.08e-3*bo*bo);
  const q9 = cw2/4*dhe/H*s.hfg*Math.sqrt(s.rg*g*dhy*(s.rf - s.rg))/(1 + Math.pow(s.rg/s.rf, 0.25))**2;
  check("report: eq. 9's flooding heat flux over STOCK PWR's heated length at 7 MPa, closed bottom", q9, q9, 0, "Chun, Moon & Yang (KNS 2000) eqs. 9 and 17 on IF97",
    {pass:true, unit:"kW/m2", note:"Bo " + bo.toFixed(2) + ", D_he " + (dhe*1000).toFixed(1) + " mm, L_B/D_he " + (H/dhe).toFixed(0) + ", C_w^2 " + cw2.toFixed(3) + "; the core at " + (q9*PT.coreAHeat[c]/1000).toFixed(0) + " MW"});
}

if(mode === "void"){
  const SRC = "Zuber & Findlay (1965): alpha = j_g/(C0 j_g + V_gj), C0 1.13, V_gj = K (sigma g drho/rho_f^2)^0.25 with the rod bundle's K 2.9 (a FIT, props.js), j_g = (heat into the liquid below the plane's middle)/(rho_g h_fg A_flow)";
  const p = 7, cs = G.E_CS, cp = PT.coreCp[c]; let dec = 0; for(let k=0;k<G.E_DEC_N;k++) dec += G.E_DEC_A[k]*Math.exp(-G.E_DEC_L[k]*6000);
  ST.csPCore[c] = p; ST.csDecay[c] = dec;
  const S1 = G.engSnap(G.engSnapNew());
  /* an inflow two latent heats past saturation: every node's equilibrium quality is over 1 by construction */
  const run = () => { const tick = () => { cs[0] = 0.02; cs[1] = dec; cs[2] = tsat(p); cs[3] = 1; cs[4] = 0.002; cs[5] = 0.002;
      cs[6] = cp*cs[2] + 2*sat(p).hfg; G.eCoreStep(c); };
    watch(G, {cap:20*0.02, step:tick});
    const Ql = Float64Array.from(ST.csNQl); tick();
    let e = 0, lo = 1, hi = 0, below = 0;
    for(let j=0;j<XNZ;j++){ let pj = 0; for(let i=0;i<XNR;i++) pj += Ql[i*XNZ + j];
      const s = engSat(G.E_AXS[j]), jg = (below + pj/2)/(s.rg*G.E_AXFG[j]*aF), vgj = 2.9*Math.pow(s.sg*g*(s.rf - s.rg)/(s.rf*s.rf), 0.25), a = jg/(G.XC0*jg + vgj);
      below += pj;
      for(let i=0;i<XNR;i++){ const v = ST.csNVt[i*XNZ + j]; e = Math.max(e, Math.abs(v - a)); lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    G.engRestore(S1); return {e, lo, hi}; };
  const r = run();
  check("covered node past x = 1: void target against Zuber-Findlay on the steam made below, every node, worst", r.e, 0, 1e-9, SRC,
    {abs:true, note:"void targets " + r.lo.toFixed(3) + "-" + r.hi.toFixed(3)});
  const keep = G.eCoreStep.toString();
  inBundle("eCoreStep = " + keep.replace("const aw = wet > 0 && xe >= 1 ? E_LVA[j] : E_VQ[2];", "const aw = E_VQ[2];").replace(/^function eCoreStep/, "function"));
  const f = run(); inBundle("eCoreStep = " + keep.replace(/^function eCoreStep/, "function"));
  check("fault injected, the march's own void past x = 1: the check fails", f.e > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail",
    {abs:true, note:"void targets " + f.lo.toFixed(3) + "-" + f.hi.toFixed(3)});
}

if(mode === "covered"){
  /* 20 s with the pumps on, which takes the pellets' stored heat without a crisis, then THTF-style steady boil-off: fed saturated at the rate the core boils it */
  const p = 7, s = sat(p), cs = G.E_CS, rk = PT.coreRated[c]*1000;
  let dec = 0; for(let k=0;k<G.E_DEC_N;k++) dec += G.E_DEC_A[k]*Math.exp(-G.E_DEC_L[k]*6000);
  if(fault) swapM("E_MN[7] = Math.min(w, E_CHF[4] + (w - E_CHF[4])*gr)/Q;");
  ST.csPCore[c] = p; ST.csDecay[c] = dec;
  let want = 0; for(let q=0;q<XNN;q++){ G.eHeatSplitA(c, q); want += ST.csNDw[q]*dec*rk*(1 - G.E_HSP[G.E_HS_CD]); }
  const qlOf = () => { let v = 0; for(let k=0;k<XNN;k++) v += ST.csNQl[k]; return v; }, hist = [];
  let dnbAll = 0;
  const tick = pumped => {
    let q = 0; for(let k=0;k<XNN;k++) q += ST.csNDw[k];
    const mf = pumped ? 1 : q*dec*rk/s.hfg/(PT.coreG0[c]*aF);
    cs[0] = 0.02; cs[1] = dec; cs[2] = s.Ts; cs[3] = 1; cs[4] = mf; cs[5] = mf; cs[6] = PT.coreCp[c]*s.Ts; G.eCoreStep(c);
    let n = 0; for(let k=0;k<XNN;k++) n += ST.csNDnb[k];
    dnbAll = Math.max(dnbAll, n); if(!pumped) hist.push([n, qlOf()]); };
  watch(G, {cap:20, step:() => tick(true)});
  // cap at the question's 40 s of boil-off; the window is the check's own last 10 s
  const w = watch(G, {cap:40, horizon:40, window:10, step:() => tick(false),
    sig:fault ? [] : [{name:"heat into the liquid", read:qlOf, ref:want, tol:0.05*want}],
    event:() => fault && hist[hist.length - 1][0] > 0 ? "a node departed" : ""});
  const last = Math.min(500, hist.length); let ql = 0, dnb = 0;
  for(const [n, v] of hist.slice(-last)){ dnb = Math.max(dnb, n); ql += v/last; }
  if(fault) check("fault injected, the old min() blend: the no-DNB check fails", dnb > 0 ? 1 : 0, 1, 0, "the check covered runs must be able to fail",
    {abs:true, note:watchNote(w) + "; " + dnb + " nodes in DNB over the last 10 s, " + dnbAll + " at most; heat into the liquid " + (ql/1000).toFixed(2) + " MW against " + (want/1000).toFixed(2)});
  else {
    check("covered core, 7 MPa, decay heat " + (dec*100).toFixed(2) + " %, 20 s pumped then at boil-off feed until its heat to the liquid is still: nodes in DNB over the last 10 s", dnb, 0, 0,
      "pool CHF at 7 MPa ~3.9 MW/m2 x (1 - alpha) against a mean decay flux of ~" + (dec*qMean/1000).toFixed(0) + " kW/m2: no node departs",
      {abs:true, note:"most nodes in DNB at any tick " + dnbAll + "; boil-off " + watchNote(w)});
    check("heat into the liquid over the last 10 s against the decay heat in the pins and water", ql, want, 0.05,
      "first law at steady state: stored heat has left the pellets (tau ~3 s)", {unit:"kW"}); }
}
