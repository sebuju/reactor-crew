"use strict";
// chunks: ox fg fp fb h2 h2,--fault cl ss zm zc zd
/* the clad and what it lets go of: ox = the steam-zirconium rate law, its ranges and its hydrogen; fg = the pellet past tdmg, its gas, its gap and its growth; fp = what a failed pin lets go of and what it reads as dose, fb = where it goes through a pipe break; cl = the can's own heat; ss = a steel can on BN-600; zm = the can melting, zc = the ceramic's loss of geometry, zd = the fuel molten Zr dissolves */
const {check, commissionPreset, inBundle, CLAD_OWN, watch} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0), PT = G.PT, ST = G.ST, XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;

if(mode === "ox"){
  const ROW = "and the correlation's own ceiling";
  const rate = T => { G.E_OXR[0] = T; G.eOxRateA(); return G.E_OXR[1]; };
  /* ZrO2-equivalent thickness^2 back to the published oxygen weight gain^2, (g/cm2)^2 */
  const toWo = k => k/100/Math.pow(91.224/31.998*G.ZR_PBR/G.ZR_RHO, 2);
  const cpWo = T => 0.3622*Math.exp(-39940/(1.987*T));
  const uhZr = T => T <= 1850 ? 29.6*Math.exp(-16820/T) : 87.9*Math.exp(-16610/T);
  const CP = "Cathcart et al., ORNL/NUREG-17 (1977): (w_O)^2 = 0.3622 t exp(-39940/RT) (g/cm2)^2, as restated in NRC ML021680052 eq. 1";
  const UH = "Urbanic & Heidrick, J. Nucl. Mater. 75 (1978) 251: K = 29.6 exp(-16820/T) to 1850 K, 87.9 exp(-16610/T) above, (kg Zr/m2)^2/s, restated by KNS 2006 (CATHENA)";
  const w100 = Math.sqrt(toWo(rate(1473))*100);
  check("oxygen weight gain after 100 s at 1473 K", w100, Math.sqrt(cpWo(1473)*100), 1e-3, CP, {unit:"g/cm2"});
  const uhZrEq = T => rate(T)/Math.pow(G.ZR_PBR/G.ZR_RHO, 2);
  check("Urbanic-Heidrick branch at 1900 K, as Zr consumed", uhZrEq(1900), uhZr(1900), 1e-9, UH, {unit:"(kg/m2)^2/s"});
  check("Urbanic-Heidrick against Cathcart-Pawel at 1473 K, both as total oxygen", uhZr(1473)/(cpWo(1473)*100*Math.pow(91.224/31.998, 2)), 0.97, 0.05,
    "NRC ML021680052 sec. 2: at 1200 C the Urbanic rate constant is 3 % under Cathcart-Pawel (read off its Fig. 1)", {abs:true, note:"tolerance is the figure read and the restatement"});
  /* which published law answered each temperature, and is that temperature inside its data */
  const RANGE = [[T => toWo(rate(T))/cpWo(T), 1273, 1773, "CP"], [T => uhZrEq(T)/uhZr(T), 1323, 2123, "UH"]];
  const sweep = () => { let out = 0, lo = 0, first = "";
    for(let T=1073;T<=2100;T+=1){ const r = RANGE.find(b => Math.abs(b[0](T) - 1) < 1e-9);
      if(!r){ out++; if(!first) first = T + " K answered by no published law"; continue; }
      if(T > r[2]){ out++; if(!first) first = T + " K on " + r[3] + " past its " + r[2] + " K ceiling"; }
      if(T < r[1]) lo++; }
    return {out, lo, first}; };
  const s = sweep();
  check("rate law asked above its branch's data, 1073-2100 K sweep", s.out, 0, 0, CP + "; " + UH, {abs:true, unit:"K steps", note:s.first});
  check("rate law asked below Cathcart-Pawel's 1273 K floor (the law starts at E_OX_T0 " + G.E_OX_T0 + " K)", s.lo, 0, 0, CP,
    {abs:true, unit:"K steps", gap:ROW, pass:s.lo === 0});
  const keep = G.eOxRateA;
  inBundle("eOxRateA = function(){ const T = E_OXR[0]; E_OXR[1] = T < 1850 ? E_OX_CP_A*Math.exp(-E_OX_CP_B/T) : E_OX_UH_A2*Math.exp(-E_OX_UH_B2/T); }");
  const bad = sweep();
  inBundle("eOxRateA = " + keep.toString().replace(/^function eOxRateA/, "function"));
  check("fault injected, the switch back at 1850 K: the extrapolation check fails", bad.out > 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:bad.first});
  const a = uhZrEq(1773), b = toWo(rate(1772.999))*100*Math.pow(91.224/31.998, 2);
  check("step in the rate constant at the 1773 K handover, UH over CP", a/b, uhZr(1773)/(cpWo(1772.999)*100*Math.pow(91.224/31.998, 2)), 1e-6,
    "both published laws at 1773 K; a step here is the two measurements disagreeing, not the code", {note:"the H2 rate steps by the square root, " + Math.sqrt(a/b).toFixed(3)});

  /* a bared core held hot in steam: every kg of Zr the oxide took against the H2 the tick made */
  const cs = G.E_CS, o = G.SX.coreO, aH = PT.coreAHeat[c];
  for(let k=0;k<XNN;k++){ ST.csNV[nb+k] = 1; ST.csNTf[nb+k] = 1500 + 60*(k % G.XNZ); ST.csNTc[nb+k] = 600; }
  let zr = 0, h2 = 0, Tmax = 0, o0 = null, i0 = null, d0 = null;
  watch(G, {cap:6, step:() => {
    o0 = Array.from(ST.csNOx.subarray(nb, nb + XNN)); i0 = Array.from(ST.csNOxI.subarray(nb, nb + XNN)); d0 = Array.from(ST.csNDmg.subarray(nb, nb + XNN));
    cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 0; cs[4] = 0.01; cs[5] = 0.01; cs[6] = 1200;
    G.eCoreStep(c); },
  each:() => {
    for(let k=0;k<XNN;k++){ Tmax = Math.max(Tmax, ST.csNTf[nb+k]);
      zr += G.ZR_RHO*((ST.csNOx[nb+k] - o0[k]) + d0[k]*(ST.csNOxI[nb+k] - i0[k]))/G.ZR_PBR*aH*W[k]; }
    h2 += o[G.E_CO_H2]; }});
  check("H2 made over Zr consumed, bared core at full power in steam for 6 s (clad to " + Tmax.toFixed(0) + " K)", h2/zr, 2*2.01588/91.224, 1e-9,
    "Zr + 2 H2O -> ZrO2 + 2 H2: 2 x 2.01588 / 91.224 (IUPAC atomic masses)", {note:(zr).toFixed(1) + " kg Zr"});
}

if(mode === "fg"){
  const XNZ = G.XNZ, SX = G.SX, H = G.H_GAP, tdmg = PT.coreTdmg[c], fill = PT.coreFgFill[c], S0 = G.engSnap(G.engSnapNew()), FILL = G.cladOf(G.coreD(G.IX.coreId[c])).pFill;
  const back = () => G.engRestore(S0), rest = () => G.eCoreRestStep(c, ST.csFlowNet[c]);
  const ring = i => Array.from({length:XNZ}, (_, j) => nb + i*XNZ + j);
  /* NUREG/CR-7024 Table 4.1-2 and eq. 4.1-4 to 4.1-6, typed a second time */
  const GAS = [[2.531e-3, 0.7146, 4.0026], [9.825e-5, 0.7334, 131.293], [1.966e-4, 0.7006, 83.798]];
  const kMix = (T, xs) => { const k = GAS.map(([A, B]) => A*Math.pow(T, B)); let s = 0;
    for(let i=0;i<3;i++){ if(!xs[i]) continue; let d = 0;
      for(let j=0;j<3;j++){ const mi = GAS[i][2], mj = GAS[j][2], phi = (1 + Math.sqrt(k[i]/k[j])*Math.pow(mi/mj, 0.25))**2/Math.sqrt(8*(1 + mi/mj));
        d += phi*(1 + 2.41*(mi - mj)*(mi - 0.142*mj)/(mi + mj)**2)*xs[j]; }
      s += k[i]*xs[i]/d; }
    return s; };
  const fgMix = x => [1 - x, x*G.FG_XE, x*(1 - G.FG_XE)];
  const booth = th => th <= 0.1 ? 6*Math.sqrt(th/Math.PI) - 3*th : 1 - 6/Math.PI**2*Math.exp(-(Math.PI**2)*th);
  const dRed = T => 7.6e-10*Math.exp(-35000/T)/(5e-6)**2;
  const SRCG = "NUREG/CR-7024 (PNNL-19417) Table 4.1-2 and eq. 4.1-4..6 (FRAPCON-3.4/FRAPTRAN-1.4)";
  const SRCB = "Booth sphere on Turnbull's intrinsic D = 7.6e-10 exp(-35000/T) m2/s, 5 um grains (as commonly quoted, not read at source)";

  rest();
  const hRest = ring(0).concat(ring(XNZ > 0 ? 3 : 0)).reduce((m, k) => Math.max(m, Math.abs(SX.coreGapH[k] - H)), 0);
  check("gap conductance at rest, all helium, every node", hRest, 0, 0, "H_GAP 5700 W/m2K is the rest gap by construction (Todreas & Kazimi ch. 8)", {abs:true, unit:"W/m2K"});
  let pRod = 0; for(let k=0;k<XNN;k++) pRod = Math.max(pRod, FILL*SX.coreGapT[nb+k]/G.ROD_T_FILL);
  check("fresh rod's hot internal pressure at rest under system pressure", pRod, ST.csPCore[c], 0, "design rule: a rod stays under coolant pressure (Westinghouse 17x17, fill 2.1-3.4 MPa cold)",
    {abs:true, unit:"MPa", pass:pRod < ST.csPCore[c] && FILL >= 2.1 && FILL <= 3.4, note:"fill " + FILL + " MPa at " + G.ROD_T_FILL + " K"});
  check("mixture conductivity, He with 30 % fission gas at 700 K", (G.E_GKIO[0] = 700, G.E_GKIO[1] = 0.3, G.eGasKA(), G.E_GKIO[2]), kMix(700, fgMix(0.3)), 1e-12, SRCG,
    {unit:"W/m/K", note:"against its own eq. only; no measured He-Xe-Kr point was read"});

  /* nodes held under, over and further over tdmg in a bared core: only the hot ones let go, on Booth's curve */
  const hold = (Ts, secs, prep) => { back(); if(prep) prep(); const cs = G.E_CS;
    watch(G, {cap:secs, step:() => { Ts.forEach((T, q) => { for(const k of ring(q)){ ST.csNTf[k] = T; ST.csNTcl[k] = T; } });
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 0; cs[4] = 0.01; cs[5] = 0.01; cs[6] = 1200;
      G.eCoreStep(c); }});
    return Ts.map((T, q) => { G.E_FGR[1] = ST.csNFg[ring(q)[0]]; G.eFgFracA(); return G.E_FGR[0]; }); };
  const Ts = [tdmg - 50, tdmg + 300, tdmg + 400], f = hold(Ts, 2);
  check("released fraction held 50 K under tdmg for 2 s", f[0], 0, 0, "a threshold: nothing below the fuel's own tdmg " + tdmg + " K", {abs:true});
  check("released fraction held 300 K over tdmg for 2 s", f[1], booth(dRed(Ts[1])*2), 1e-9, SRCB);
  check("released fraction held 400 K over tdmg for 2 s, and above the 300 K one", f[2], booth(dRed(Ts[2])*2), 1e-9, SRCB,
    {pass:f[2] > f[1] && Math.abs(f[2]/booth(dRed(Ts[2])*2) - 1) <= 1e-9, note:"300 K: " + f[1].toExponential(3) + ", 400 K: " + f[2].toExponential(3)});
  G.E_FGR[1] = 1e3; G.eFgFracA();
  check("released fraction of a node's gas after a long hot hold", G.E_FGR[0], 1, 1e-12, "a node cannot let go of more than it holds", {abs:true});

  /* gas let go into ring 0 after the rest point and held there, the core driven 60 s to its new steady state on held inputs and a held flux */
  const drive = poison => { back(); const ph = Float64Array.from(ST.csPhi.subarray(nb, nb + XNN)), cs = G.E_CS;
    const hold0 = () => { if(poison) for(const k of ring(0)) ST.csNFg[k] = 1e-4; };
    const fn = ST.csFlowNet[c], inH = G.eNetCoreInH(c), Ts = G.satT(PT.coreSat[c], ST.csPCore[c]);
    let tfIn = null, thIn = null, t = 0;
    watch(G, {cap:60, step:() => { ST.csPhi.set(ph, nb); hold0(); if(t++ === 2999){ tfIn = ring(0).map(k => ST.csNTf[k]); thIn = ring(0).map(k => ST.csNFg[k]); }
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = Ts; cs[3] = 1; cs[4] = PT.coreFlowK[c]*fn; cs[5] = Math.max(fn, G.E_CORE_DT_QMIN); cs[6] = inH; G.eCoreStep(c); }});
    return ring(0).map((k, q) => ({rise:ST.csNTf[k] - ST.csNTc[k], film:ST.csNFilm[k], h:SX.coreGapH[k], Tg:SX.coreGapT[k], Tf:tfIn[q], th:thIn[q], dTf:ST.csNTf[k] - tfIn[q]})); };
  const A = drive(false), Bp = drive(true);
  let rel = 0, w = 0; ring(0).forEach((k, q) => { rel += W[k - nb]*booth(Bp[q].th)*PT.coreNFg[k]; w += W[k - nb]; });
  rel /= w; const x = rel/(fill + rel);
  /* FRAP's UO2 strain, NUREG/CR-7024 eq. 2.5-1 with Table 2.5-1, typed a second time */
  const epsU = T => 9.8e-6*T - 2.61e-3 + 0.316*Math.exp(-1.32e-19/(1.380649e-23*T)), rp = PT.coreRp[c], al = PT.coreCladAl[c];
  let eH = 0, eT = 0, hMin = 1e9, dMax = 0;
  ring(0).forEach((k, q) => { const b = Bp[q], Tg0 = PT.coreNTg0[k];
    const grow = rp*(epsU(b.Tf) - epsU(PT.coreNTf0[k])) - rp*al*(b.Tg - Tg0);
    const hW = kMix(b.Tg, fgMix(x))/Math.max(kMix(Tg0, [1, 0, 0])/H - grow, G.GAP_ROUGH);
    eH = Math.max(eH, Math.abs(b.h/hW - 1)); hMin = Math.min(hMin, b.h); dMax = Math.max(dMax, Math.abs(b.dTf));
    const want = A[q].rise*A[q].film*(1/A[q].film + (H/b.h - H/A[q].h)/PT.coreGGap[c]);
    eT = Math.max(eT, Math.abs(b.rise/want - 1)); });
  check("poisoned gap against k_mix over the rest gap less the growth, ring 0 (" + (x*100).toFixed(1) + " % fission gas)", eH, 0, 1e-12, SRCG,
    {abs:true, note:"gap " + hMin.toFixed(0) + " W/m2K; the pellet still moving " + dMax.toExponential(1) + " K a tick"});
  check("steady pellet rise after poisoning against the series resistance, ring 0", eT, 0, 1e-6, "steady conduction in series: dT = q' dR, R = pellet + gap + clad + film per metre", {abs:true, unit:"of the rise"});

  /* the same hot clad in two rings, one with its gas out: only that one balloons */
  const burstRun = () => { const Tb = 1200;
    hold([Tb, Tb], 1, () => { for(const k of ring(0)) ST.csNFg[k] = 1e3; }); return [ring(0), ring(1)].map(r => r.reduce((m, k) => Math.max(m, ST.csNDmg[k]), 0)); };
  const dm = burstRun();
  let relB = 0; w = 0; for(const k of ring(0)){ relB += W[k - nb]*PT.coreNFg[k]; w += W[k - nb]; } relB /= w;
  const tbOf = p => { const th = PT.coreCladThick[c], sig = (PT.coreRodD[c]/2 - th)/th*Math.max(p, 0);
    return sig <= 20 ? 1477 : Math.max(1030, 1477 - 447*Math.log(sig/20)/Math.log(7)); };
  const pc = ST.csPCore[c], tbG = tbOf(FILL*1200/G.ROD_T_FILL*(1 + relB/fill) - pc), tbN = tbOf(FILL*1200/G.ROD_T_FILL - pc);
  const want = Math.min(1, 50*Math.min(1, (1200 - tbG)/50)*0.02/8);
  check("burst damage after 1 s at 1200 K clad, the ring holding its released gas", dm[0], want, 1e-9,
    "NUREG-0630 burst temperature against hoop stress (20 MPa -> 1477 K, 140 MPa -> 1030 K) on fill plus released gas, ideal gas", {note:"burst at " + tbG.toFixed(0) + " K with gas, " + tbN.toFixed(0) + " K without"});
  check("burst damage after 1 s at 1200 K clad, the ring with its gas still in the pellet", dm[1], 0, 0, "NUREG-0630: " + tbN.toFixed(0) + " K burst temperature on the fill alone", {abs:true});

  /* a pellet driven far over its rest outgrows the clad: the gap closes onto the surfaces' roughness, not to zero */
  const thC = []; back(); { const cs = G.E_CS, T0 = ring(0).map(k => ST.csNTf[k]);
    watch(G, {cap:5*0.02, step:() => { ring(0).forEach((k, q) => { ST.csNTf[k] = T0[q] + 1500; thC[q] = ST.csNFg[k]; });
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 1; cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = ST.csFlowNet[c]; cs[6] = 1200; G.eCoreStep(c); }}); }
  let relC = 0; w = 0; ring(0).forEach((k, q) => { relC += W[k - nb]*booth(thC[q])*PT.coreNFg[k]; w += W[k - nb]; });
  relC /= w; const xC = relC/(fill + relC);
  const k0 = ring(0)[XNZ/2 | 0], hc = SX.coreGapH[k0], hcW = kMix(SX.coreGapT[k0], fgMix(xC))/G.GAP_ROUGH;
  check("closed gap, pellet 1500 K over its rest", hc, hcW, 1e-9, "Ross-Stoute gas path over 1.5 (2.0 + 0.5) um roughness (as commonly quoted, not read at source); a closed gap runs tens of kW/m2K",
    {pass:Math.abs(hc/hcW - 1) <= 1e-9 && hc > 1e4 && hc < 1e5, note:(hc/1000).toFixed(1) + " kW/m2K"});

  /* natural U metal across its alpha-beta change */
  const um = G.FUEL.findIndex(r => r.name === "U METAL NATURAL"), v = new Float64Array(G.FUEL.length); v[um] = 1; G.engBuildFuelMix(PT, c, v);
  const eps = T => { G.E_FS[0] = T; G.eFuelStrainA(c); return G.E_FS[1]; };
  check("U metal linear strain step at the 942 K alpha-beta change", eps(942) - eps(941.999) - G.FUEL[um].alpha*0.001, 0.0106/3, 1e-9,
    "alpha-beta volume change about 1.06 % (as commonly quoted, not read at source), a third of it linear", {unit:"m/m"});
  G.engBuildFuelMix(PT, c, G.fuelVolW(G.coreD(G.IX.coreId[c])));

  const keep = G.eFgFracA;
  inBundle("eFgFracA = function(){ E_FGR[0] = 0; }");
  const fBad = hold(Ts, 2), dBad = burstRun();
  inBundle("eFgFracA = " + keep.toString().replace(/^function eFgFracA/, "function"));
  check("fault injected, the release law stood down: the threshold and burst checks fail", fBad[1] === 0 && dBad[0] === 0 ? 1 : 0, 1, 0, "the checks above must be able to fail", {abs:true});
}

if(mode === "fp"){
  const SX = G.SX, sc = ST.sc, o = c*G.FP_N, inv = [0, 1, 2].map(q => PT.coreFpInv[o+q]), S0 = G.engSnap(G.engSnapNew());
  const N1465 = "NUREG-1465 PWR: gap 0.05 noble, 0.05 halogen, 0 Ba-Sr; early in-vessel 0.95, 0.35, 0.02 (as commonly quoted, not read at source)";
  const rel = () => [ST.csFpRelN[c], ST.csFpRelV[c], ST.csFpRelR[c]].map((r, q) => r/inv[q]);
  check("nothing released at rest", rel().reduce((a, b) => a + b, 0), 0, 0, "an intact core holds its inventory", {abs:true});
  const allNodes = f => { for(let k=0;k<XNN;k++) f(nb + k); };
  allNodes(i => { ST.csNDmg[i] = 1; }); G.eFpRelease(c); const g1 = rel(); G.eFpRelease(c); const g2 = rel();
  check("every clad burst: noble gas out of the fuel over inventory", g1[0], 0.05, 1e-12, N1465, {abs:true});
  check("every clad burst: volatiles out of the fuel over inventory", g1[1], 0.05, 1e-12, N1465, {abs:true});
  check("every clad burst: refractories out of the fuel over inventory", g1[2], 0, 1e-12, N1465, {abs:true});
  check("the gap release stops once vented", Math.max(...g2.map((v, q) => Math.abs(v - g1[q]))), 0, 0, "the gap holds a fixed share; once vented there is no more of it", {abs:true});
  allNodes(i => { ST.csNMelt[i] = 1; }); G.eFpRelease(c); const m1 = rel();
  check("every node molten: noble gas out, gap plus in-vessel", m1[0], 1.00, 1e-12, N1465, {abs:true});
  check("every node molten: volatiles out, gap plus in-vessel", m1[1], 0.40, 1e-12, N1465, {abs:true});
  check("every node molten: refractories out", m1[2], 0.02, 1e-12, N1465, {abs:true});
  allNodes(i => { ST.csNMelt[i] = 0; ST.csNDmg[i] = 0; }); G.eFpRelease(c);
  check("nothing goes back into the fuel when the stage reads lower", Math.max(...rel().map((v, q) => Math.abs(v - m1[q]))), 0, 0, "release is one-way", {abs:true});

  /* the dose reads where the activity is */
  const Kc = PT.radAirK; let near = 0, far = 0;
  for(let i=0;i<Kc.length;i++){ if(Kc[i] > Kc[near]) near = i; if(Kc[i] > 0 && Kc[i] < Kc[far] || Kc[far] === 0) far = i; }
  const doseAt = i => { ST.roomFpN.fill(0); ST.roomFpV.fill(0); ST.roomFpW.fill(0); ST.roomFpN[i] = 1; G.eRadDose(0); return sc[G.SC_FPDOSE]; };
  const dn = doseAt(near), df = doseAt(far);
  check("crew dose, 1 kg noble gas in the nearest cell over the farthest", dn/df, Kc[near]/Kc[far], 1e-12,
    "r^-2 with the ray's own attenuation through what the board has built between them", {note:"near " + dn.toExponential(3) + ", far " + df.toExponential(3)});

  /* the release is state: a replay from its snapshot lands byte for byte */
  const A = G.engSnap(G.engSnapNew()); watch(G, {cap:1}); const B1 = G.engSnap(G.engSnapNew());
  G.engRestore(A); watch(G, {cap:1}); const B2 = G.engSnap(G.engSnapNew());
  check("a snapshot taken during a release replays byte for byte", G.eqWhere(B1, B2) === null ? 0 : 1, 0, 0, "the snapshot is a byte copy", {abs:true, note:G.eqWhere(B1, B2) || ""});

  G.engRestore(S0); PT.coreFpGap.fill(0); PT.coreFpMelt.fill(0);
  allNodes(i => { ST.csNDmg[i] = 1; }); G.eFpRelease(c);
  check("fault injected, the release fractions zeroed: the gap check fails", Math.abs(rel()[0] - 0.05) > 1e-12 ? 1 : 0, 1, 0, "the gap check above must be able to fail", {abs:true});
}

if(mode === "fb"){
  /* every clad burst and a pipe on the core's loop shot: the books close, the gas leaves and the iodine stays in the water */
  const sc = ST.sc, o = c*G.FP_N, inv = [0, 1].map(q => PT.coreFpInv[o+q]);
  const S0 = G.engSnap(G.engSnapNew());
  sc[G.SC_DICEOFF] = 1;
  const ids = G.IX.partId; let a = -1;
  for(let p=0;p<ids.length;p++){ const id = ids[p]; if(id.indexOf("pipe:") !== 0 || !(PT.partHitW[p] > 0)) continue;
    const [x, y] = id.slice(5).split(",").map(Number);
    if((G.pipeMap().cellOwner[x + "," + y] || []).some(k => /^(hot|cold|loop|pri|core)/.test(k))){ a = p; break; } }
  G.act("hit", a);
  for(let k=0;k<XNN;k++) ST.csNDmg[nb+k] = 1;
  /* the hydrogen set to the noble gas's own spread once the gap has vented, to follow side by side */
  let h2In = 0, h2a = 0, fpa = 0, nN = 0, made = false, tk = 0;
  const drift = [0, 0];
  const sum = (A, M) => { let t = 0; for(let i=0;i<A.length;i++){ const m = M ? M[i] : 1; if(m === m) t += A[i]*m; } return t; };
  const room = q => q === 0 ? sum(ST.roomFpN) : sum(ST.roomFpV) + sum(ST.roomFpW);
  const books = q => sum(q === 0 ? ST.fpNBy : ST.fpVBy, ST.mBy) + room(q) + (q === 0 ? sc[G.SC_FPBOOKN] : sc[G.SC_FPBOOKV]);
  watch(G, {cap:6, each:n => { const t = n - 1;
    if(t === 0){ nN = 0; for(let i=0;i<ST.fpNBy.length;i++){ const m = ST.mBy[i]; ST.h2By[i] = ST.fpNBy[i]; if(m === m) nN += ST.fpNBy[i]*m; } h2In = nN; }
    for(let q=0;q<2;q++) drift[q] = Math.max(drift[q], Math.abs(books(q) - (q === 0 ? ST.csFpRelN[c] : ST.csFpRelV[c]))/inv[q]);
    if(G.SX.coreO[G.E_CO_H2] > 0) made = true;
    if(t > 0 && !made){ tk++; for(let k=0;k<ST.outH2.length;k++){ h2a += ST.outH2[k]; fpa += ST.outFpN[k]; } } }});
  check("noble gas books close over 6 s with a pipe shot: fuel + water + room + booked", drift[0], 0, 1e-9, "conservation of mass, per species", {abs:true, unit:"of inventory"});
  check("volatile books close over 6 s with a pipe shot", drift[1], 0, 1e-9, "conservation of mass, per species", {abs:true, unit:"of inventory"});
  const airN = sum(ST.roomFpN)/ST.csFpRelN[c], airV = sum(ST.roomFpV)/ST.csFpRelV[c], wetV = (sum(ST.fpVBy, ST.mBy) + sum(ST.roomFpW))/ST.csFpRelV[c];
  check("airborne in the building, noble gas over volatile, of what each let go", airN/Math.max(airV, 1e-300), 1e2, 0,
    "TMI-2: essentially all the noble gas reached the building air, about 1e-5 of the core iodine did; the iodine stayed in the water",
    {pass:airN/Math.max(airV, 1e-300) > 1e2 && wetV > 0.99, note:"noble " + airN.toExponential(2) + ", volatile " + airV.toExponential(2) + " airborne, " + (wetV*100).toFixed(3) + " % of the volatiles in water"});
  check("noble gas and hydrogen leave through the same openings in the same share, until the clad makes hydrogen of its own", fpa/Math.max(nN, 1e-300), h2a/h2In, 1e-9,
    "one law carries both gases: what leaves over what was put in must agree", {pass:tk > 0 && Math.abs(fpa/nN/(h2a/h2In) - 1) <= 1e-9, note:tk + " ticks, noble " + (fpa/nN).toExponential(4) + ", H2 " + (h2a/h2In).toExponential(4)});
  G.engRestore(S0); PT.coreFpGap.fill(0); PT.coreFpMelt.fill(0); G.act("hit", a);
  for(let k=0;k<XNN;k++) ST.csNDmg[nb+k] = 1;
  watch(G, {cap:2});
  const badR = sum(ST.roomFpN)/Math.max(sum(ST.roomFpV), 1e-300);
  check("fault injected, the release fractions zeroed: the building ordering check fails", badR > 1e2 ? 0 : 1, 1, 0, "the ordering check above must be able to fail", {abs:true, note:"reads " + badR});
}

if(mode === "h2"){
  /* hydrogen put in as the noble gas's own spread, a pipe on the core's loop shot: the transport's books close, water + booked + what left by the openings */
  const sc = ST.sc, S0 = G.engSnap(G.engSnapNew()), ids = G.IX.partId, N = 300, fault = process.argv.includes("--fault");
  sc[G.SC_DICEOFF] = 1;
  let a = -1;
  for(let p=0;p<ids.length;p++){ const id = ids[p]; if(id.indexOf("pipe:") !== 0 || !(PT.partHitW[p] > 0)) continue;
    const [x, y] = id.slice(5).split(",").map(Number);
    if((G.pipeMap().cellOwner[x + "," + y] || []).some(k => /^(hot|cold|loop|pri|core)/.test(k))){ a = p; break; } }
  const held = () => { let t = sc[G.SC_H2BOOK]; for(let i=0;i<ST.h2By.length;i++){ const m = ST.mBy[i]; if(m === m) t += ST.h2By[i]*m; } return t; };
  const run = () => { G.engRestore(S0); sc[G.SC_DICEOFF] = 1; G.act("hit", a); for(let k=0;k<XNN;k++) ST.csNDmg[nb+k] = 1;
    let b0 = 0, out = 0, put = 0, d = 0, made = false;
    watch(G, {cap:N*0.02, each:n => {
      if(n === 1){ for(let i=0;i<ST.fpNBy.length;i++) ST.h2By[i] = ST.fpNBy[i]; b0 = held(); put = b0 - sc[G.SC_H2BOOK]; return; }
      if(G.SX.coreO[G.E_CO_H2] > 0) made = true;
      for(let k=0;k<ST.outH2.length;k++) out += ST.outH2[k];
      if(!made) d = Math.max(d, Math.abs(held() + out - b0)/put); },
      event:() => fault && d > 1e-9 ? "the books missed" : ""});
    return d; };
  if(!fault){ const d = run();
    check("hydrogen books close over 6 s with a pipe shot, until the clad makes its own: water + booked + what left by the openings", d, 0, 1e-9,
      "conservation of mass, per species: hydrogen lands by the noble gas's own law", {abs:true, unit:"of what was put in"}); }
  else { const keep = G.eAdvectStep.toString(), subs = [["let bLo = E_INF,", "let cHF = 0, bLo = E_INF,"], ["if(b > bHi) bHi = b; }", "if(b > bHi) bHi = b; if(s.h2By[i] > cHF) cHF = s.h2By[i]; }"],
      ["if(mE > DRY_MIN_KG && Nc >= 0) s.h2By[i] = Nc/mE; else { sc[SC_H2BOOK] += Nc; s.h2By[i] = 0; }", "s.h2By[i] = mE > DRY_MIN_KG ? Math.min(Math.max(0, Nc/mE), cHF) : 0;"]];
    let bad = keep; for(const [x, y] of subs){ if(!bad.includes(x)) throw new Error("eAdvectStep: no " + x); bad = bad.replace(x, y); }
    inBundle("eAdvectStep = " + bad.replace(/^function eAdvectStep/, "function"));
    const f = run();
    check("fault injected, the old clamp to the tick's highest concentration, unbooked: the check above fails", f > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + f.toExponential(2)}); }
}

if(mode === "cl"){
  const cd = G.coreD(G.IX.coreId[c]), can = G.cladOf(cd), own = CLAD_OWN[can.name], ua = PT.corePinUA[c], S0 = G.engSnap(G.engSnapNew());
  let n = 0; for(let q=0;q<G.LQ*G.LQ;q++) if(G.latFuel(cd, q)) n++;
  const mk = 4*n*(G.LAT_P0/G.rodPOf(cd))**2*Math.PI*G.rodD(cd)*cd.lat.len*can.thick*can.rho;
  const tick = (heat, wet) => { const cs = G.E_CS; cs[0] = 0.02; cs[1] = heat; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = wet;
    cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = Math.max(ST.csFlowNet[c], G.E_CORE_DT_QMIN); cs[6] = G.eNetCoreInH(c); G.eCoreStep(c); };

  /* the pellet put back each tick, the water held, the film dropped to film boiling: the can alone between two fixed temperatures */
  const relax = capK => { G.engRestore(S0);
    const Tc = Float64Array.from(ST.csNTc.subarray(nb, nb + XNN)), V = Float64Array.from(ST.csNV.subarray(nb, nb + XNN)), Tk0 = Float64Array.from(ST.csNTcl.subarray(nb, nb + XNN)), law = Tk0.slice();
    const keepM = G.eMarginNode.toString(), Tf0 = Float64Array.from(ST.csNTf.subarray(nb, nb + XNN));
    for(let k=0;k<XNN;k++) ST.csNCl[nb+k] *= capK; inBundle("eMarginNode = function(){ E_MN[7] = 1e-9; }");
    let tau = 0;
    watch(G, {cap:400*0.02, event:t => tau && t >= tau - 1e-9 ? "t = tau" : "", step:() => { ST.csNTf.set(Tf0, nb); const Tf = Tf0;
      tick(ST.csHeat[c], 1);
      let g = 0, w = 0;
      for(let k=0;k<XNN;k++){ const f = ST.csNFilm[nb+k], hc = ST.csNHc[nb+k], gs = f*hc/(hc - f), teq = (gs*Tf[k] + hc*Tc[k])/(gs + hc);
        law[k] = teq + (law[k] - teq)*Math.exp(-0.02*(gs + hc)*ua/(mk*own.cp(law[k])/1000)); g += W[k]*(gs + hc); w += W[k];
        ST.csNTc[nb+k] = Tc[k]; ST.csNV[nb+k] = V[k]; }
      if(!tau){ const k = XNZ >> 1; tau = mk*own.cp(Tk0[k])/1000/(ua*g/w); } }});
    inBundle("eMarginNode = " + keepM.replace(/^function eMarginNode/, "function"));
    let got = 0, want = 0, dnb = 1;
    for(let k=0;k<XNN;k++){ got += W[k]*(ST.csNTcl[nb+k] - Tk0[k]); want += W[k]*(law[k] - Tk0[k]); dnb = Math.min(dnb, ST.csNDnb[nb+k]); }
    return {err:got/want - 1, tau, rise:want, dnb}; };
  const XNZ = G.XNZ, a = relax(1), b = relax(2);
  const SRC = "one lump between two held temperatures: m cp(T) dT/dt = g (T_f - T) - h (T - T_water), the drawn can on " + own.src;
  check("can's rise after the film drops to film boiling, pellet and water held, against one lump at t = tau", a.err, 0, 0.01, SRC,
    {abs:true, unit:"of the law", pass:Math.abs(a.err) <= 0.01 && a.dnb === 1, note:"tau " + a.tau.toFixed(3) + " s, mean rise " + a.rise.toFixed(1) + " K, every node in film boiling: " + (a.dnb === 1)});
  check("fault injected, the can's capacity doubled: the relaxation check fails", Math.abs(b.err) > 0.01 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (b.err*100).toFixed(1) + " %"});

  /* the engine's h(T) against the typed cp integrated by Simpson */
  const simpson = (f, a0, b0, N = 20000) => { const h = (b0 - a0)/N; let s = f(a0) + f(b0); for(let i=1;i<N;i++) s += f(a0 + i*h)*(i % 2 ? 4 : 2); return s*h/3; };
  const engH = (r, T) => { PT.coreCladRow[c] = r; G.E_CL[0] = T; G.E_CL[4] = T; G.eCladHA(c); return G.E_CL[1]; };
  const hErr = (r, lo, hi, cp) => { let e = 0; for(let T=lo;T<=hi;T+=50) e = Math.max(e, Math.abs(engH(r, T)/(simpson(cp, 298.15, T)/1000) - 1)); return e; };
  const row0 = PT.coreCladRow[c], zr = G.CLAD.findIndex(r => r.name === "ZIRCALOY"), mg = G.CLAD.findIndex(r => r.name === "MAGNOX AL80");
  const zrOwn = CLAD_OWN.ZIRCALOY, eZ = hErr(zr, 350, 1400, zrOwn.cp), eM = hErr(mg, 350, 900, CLAD_OWN["MAGNOX AL80"].cp);
  const eZbad = hErr(zr, 350, 1400, T => zrOwn.cp(T) - (T > 1100 && T < 1320 ? 1058.4*Math.exp(-((T - 1213.8)**2)/719.61) : 0));
  PT.coreCladRow[c] = row0;
  check("Zircaloy h(T) - h(298.15), engine against TECDOC-1496 eqs. 1-3 integrated, 350-1400 K, worst", eZ, 0, 0.005, zrOwn.src + ", the alpha-beta peak included", {abs:true, unit:"of h"});
  check("fault injected, the alpha-beta Gaussian dropped from the typed cp: the Zircaloy enthalpy check fails", eZbad > 0.005 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + (eZbad*100).toFixed(1) + " %"});
  check("Magnox (Mg) h(T) - h(298.15), engine against the NIST Shomate cp integrated, 350-900 K, worst", eM, 0, 0.005, CLAD_OWN["MAGNOX AL80"].src, {abs:true, unit:"of h"});

  /* the inversion the pair leans on: h(T) is S-shaped round the alpha-beta peak, so a start across it must still land on the target */
  const invErr = () => { let e = 0; PT.coreCladRow[c] = zr;
    const inv = (T, S) => { const h = engH(zr, T); G.E_CL[3] = h; G.E_CL[0] = S; G.eCladTA(c); e = Math.max(e, Math.abs(engH(zr, G.E_CL[0]) - h)); };
    for(let T=350;T<=2000;T+=5) for(let d=-200;d<=200;d+=10) inv(T, T + d);
    for(let T=1150;T<=1300;T+=0.25) for(let S=1100;S<=1400;S+=2) inv(T, S);
    PT.coreCladRow[c] = row0; return e; };
  const eInv = invErr(), keepT = G.eCladTA.toString();
  check("Zircaloy T(h) then h again, 350-2000 K from starts up to 200 K either side and densely across the alpha-beta peak, worst", eInv, 0, 1e-6,
    "an inversion returns the temperature its enthalpy was set at: energy the can holds is not lost in the read-back", {abs:true, unit:"kJ/kg"});
  inBundle("eCladTA = " + keepT.replace(" || Math.abs(2*d) > Math.abs(step*E_CL[2])", "").replace(/^function eCladTA/, "function"));
  const eInvBad = invErr(); inBundle("eCladTA = " + keepT.replace(/^function eCladTA/, "function"));
  check("fault injected, plain Newton inside the bracket: the inversion check fails", eInvBad > 1e-6 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + eInvBad.toFixed(2) + " kJ/kg"});

  /* a bared pin with no fission, the pellet and can level at 1500 K in steam: the oxidation heat is born in the can */
  const oxOnce = () => { G.engRestore(S0);
    for(let k=0;k<XNN;k++){ ST.csNTf[nb+k] = 1500; ST.csNTcl[nb+k] = 1500; ST.csNV[nb+k] = 1; }
    ST.csDecay[c] = 0;
    const hF = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; }, ox0 = Float64Array.from(ST.csNOx.subarray(nb, nb + XNN));
    tick(0, 0);
    let lead = 0, dU = 0, zrKg = 0;
    for(let k=0;k<XNN;k++){ const i = nb + k;
      lead = Math.min(lead === 0 ? Infinity : lead, ST.csNTcl[i] - ST.csNTf[i]);
      dU += W[k]*(PT.coreFuelKg[c]*(hF(ST.csNTf[i]) - hF(1500)) + mk*(own.h(ST.csNTcl[i]) - own.h(1500)));
      zrKg += W[k]*G.ZR_RHO*(ST.csNOx[i] - ox0[k])/G.ZR_PBR*PT.coreAHeat[c]; }
    return {lead, dU:dU + ST.csFQ[c]*0.02, q:G.ZR_QOX*zrKg/1000}; };
  const ox = oxOnce();
  check("bared pin, no fission, pellet and can at 1500 K in steam: fuel U + can U + heat to water after one tick against the Zr-steam heat", ox.dU, ox.q, 1e-9,
    "first law on the pin: the only source is Zr + 2 H2O at " + (G.ZR_QOX/1e6).toFixed(2) + " MJ/kg Zr", {unit:"kJ", note:"worst node's can over its pellet " + ox.lead.toExponential(3) + " K"});
  check("the oxidation heat is born in the can: every node's can ends the tick above its pellet", ox.lead > 0 ? 1 : 0, 1, 0, "the reaction is at the can's outer face",
    {abs:true, note:"least lead " + ox.lead.toExponential(3) + " K"});
  const keep = G.eCoreStep.toString();
  const bad = keep.replace("v0 = (qPin - gS*(Tf0 - Tcl0))/cF, v1 = (gS*(Tf0 - Tcl0) + qK - ", "v0 = (qPin + qOx - gS*(Tf0 - Tcl0))/cF, v1 = (gS*(Tf0 - Tcl0) + qR - ")
    .replace("qFK = qPin - cF*dTf/dt", "qFK = qPin + qOx - cF*dTf/dt").replace("out = qFK + qK - cK*dTk/dt", "out = qFK + qR - cK*dTk/dt");
  inBundle("eCoreStep = " + bad.replace(/^function eCoreStep/, "function"));
  const oxBad = oxOnce();
  inBundle("eCoreStep = " + keep.replace(/^function eCoreStep/, "function"));
  check("fault injected, the oxidation heat put in the pellet: the can no longer leads", bad !== keep && !(oxBad.lead > 0) ? 1 : 0, 1, 0, "the lead check above must be able to fail",
    {abs:true, note:"least lead " + oxBad.lead.toExponential(3) + " K"});
}

if(mode === "ss"){
  const ANL = "Kim, ANL-75-55 (1975), 316L: rho eq. 18 g/cm3, cp eq. 7 cal/g/K, k eq. 30 W/cm/K, typed a second time";
  const rhoA = T => (8.0842 - 4.2086e-4*T - 3.8942e-8*T*T)*1000, cpA = T => (0.1097 + 3.174e-5*T)*4184, kA = T => (0.09248 + 1.571e-4*T)*100;
  const r = G.CLAD.findIndex(x => x.name === "STEEL 316"), row = G.CLAD[r];
  commissionPreset(3); const K = G, P3 = G.PT, S3 = G.ST, cd = K.coreD(K.IX.coreId[c]);
  const engCp = T => { K.E_CL[0] = T; K.E_CL[4] = T; K.eCladHA(c); return K.E_CL[2]*1000; };
  let eCp = 0, eK = 0; for(const T of [300, 1000, 1600]){ eCp = Math.max(eCp, Math.abs(engCp(T)/cpA(T) - 1)); eK = Math.max(eK, Math.abs(row.k(T)/kA(T) - 1)); }
  check("BN-600's can is the steel row", P3.coreCladRow[c], r, 0, "the SFR archetype draws a steel-clad pin", {abs:true});
  check("316 cp, engine against ANL-75-55 eq. 7 at 300, 1000, 1600 K, worst", eCp, 0, 0.005, ANL, {abs:true, unit:"of cp"});
  check("316 k, row law against ANL-75-55 eq. 30 at 300, 1000, 1600 K, worst", eK, 0, 0.005, ANL, {abs:true, unit:"of k"});
  check("316 density, the row's mass basis against ANL-75-55 eq. 18 at 300 K", row.rho, rhoA(300), 0.005, ANL, {unit:"kg/m3"});

  /* the pin at rest: ideal gas over the free volume at the can's own temperature, the fill and the gas let go */
  const R = K.R_GAS, Ri = cd.rodD/2 - row.thick, vFree = 653/1030 + (1.8/(2*Ri*1000))**2 + ((2*Ri*1000)**2 - 36)/(2*Ri*1000)**2;
  const nFill = row.pFill*1e6*vFree/(R*K.ROD_T_FILL);
  const XNZ = K.XNZ; let worst = 0, over = -Infinity, pMax = 0, pOld = 0;
  const booth = th => th <= 0.1 ? 6*Math.sqrt(th/Math.PI) - 3*th : 1 - 6/Math.PI**2*Math.exp(-(Math.PI**2)*th);
  for(let i=0;i<K.XNR;i++){ let rel = 0, w = 0;
    for(let j=0;j<XNZ;j++){ const q = i*XNZ + j; rel += W[q]*booth(S3.csNFg[q])*P3.coreNFg[q]; w += W[q]; }
    rel /= w;
    for(let j=0;j<XNZ;j++){ const q = i*XNZ + j, T = S3.csNTcl[q];
      const pHand = (nFill + rel)*R*T/vFree/1e6, pEng = P3.coreRodPFill[c]*T/K.ROD_T_FILL*(1 + rel/P3.coreFgFill[c]);
      worst = Math.max(worst, Math.abs(pEng/pHand - 1)); pMax = Math.max(pMax, pHand);
      pOld = Math.max(pOld, 2.2*T/300*(1 + rel/(2.2e6*0.06/(R*300))));
      K.E_CR[1] = pEng - S3.csPCore[c]; K.eBurstTA(c); over = Math.max(over, T - K.E_CR[2]); } }
  check("BN-600 at rest: the rod's pressure against the ideal gas over its free volume at the can's temperature, worst node", worst, 0, 1e-9,
    "p = (n_fill + n_released) R T_can / V_free; V_free the 653 mm plenum over the 1030 mm fissile column plus the 1.8 mm hole and the 6.0 mm pellet's gap (IAEA-TECDOC-1569 Table 3)",
    {abs:true, note:"R = the engine's R_GAS " + R + " (CODATA 8.314462618); hottest rod " + pMax.toFixed(2) + " MPa; on Zircaloy's 2.2 MPa and 6 % it would read " + pOld.toFixed(0) + " MPa"});
  check("BN-600 at rest: every can under its burst temperature", over < 0 ? 1 : 0, 1, 0, "a fresh pin at rest does not balloon", {abs:true, note:"closest " + over.toFixed(0) + " K"});

  /* a can ramped at 5.6 K/s with no heat of its own, the rod pressurised to hold the published hoop stress */
  const S0 = K.engSnap(K.engSnapNew()), th = row.thick, dt = 0.02, rate = 10/1.8;
  const ramp = sig => { K.engRestore(S0); const f0 = P3.coreRodPFill[c], d0 = S3.csDecay[c];
    let T = 1300, fail = 0;
    watch(K, {dt, cap:3000*dt, event:() => fail ? "burst" : "", step:() => {
      for(let k=0;k<XNN;k++){ S3.csNTf[k] = T; S3.csNTcl[k] = T; S3.csNFg[k] = 0; }
      S3.csDecay[c] = 0;
      P3.coreRodPFill[c] = (sig*th/Ri + S3.csPCore[c])*K.ROD_T_FILL/T;
      const cs = K.E_CS; cs[0] = dt; cs[1] = 0; cs[2] = K.satT(P3.coreSat[c], S3.csPCore[c]); cs[3] = 0; cs[4] = 0.01; cs[5] = 0.01; cs[6] = K.eNetCoreInH(c);
      K.eCoreStep(c);
      if(S3.csNDmg[XNZ >> 1] >= 1) fail = S3.csNTcl[XNZ >> 1];
      T += rate*dt; }});
    P3.coreRodPFill[c] = f0; S3.csDecay[c] = d0; return fail; };
  const HF = "Hunter & Fish, HEDL-SA-645, unirradiated 20 % CW 316 at 10 F/s: 1300 psi fails near 2400 F, 6480 psi at 2100-2200 F";
  const lo = ramp(8.96), hi = ramp(44.7);
  check("steel can at 8.96 MPa hoop on a 5.6 K/s ramp: failure temperature", lo, 1589, 30, HF, {abs:true, unit:"K"});
  check("steel can at 44.7 MPa hoop on a 5.6 K/s ramp: failure temperature", hi, 1450, 30, HF + " (1422-1477 K)", {abs:true, unit:"K", pass:hi >= 1422 - 30 && hi <= 1477 + 30});
  const b = P3.cladBurst, o = r*4, keep = Array.from(b.subarray(o, o + 4)); b.set(P3.cladBurst.subarray(0, 4), o);
  const zLo = ramp(8.96), zHi = ramp(44.7); b.set(keep, o);
  check("fault injected, Zircaloy's burst curve on the steel can: the ramp checks fail", Math.abs(zLo - 1589) > 30 || zHi < 1392 || zHi > 1507 ? 1 : 0, 1, 0,
    "the checks above must be able to fail", {abs:true, note:"fails at " + zLo.toFixed(0) + " and " + zHi.toFixed(0) + " K"});
}

if(mode === "zm" || mode === "zc" || mode === "zd"){
  const TEC = "IAEA-TECDOC-1496 (2006) secs. 6.2.1.3 and 6.5.3: Zircaloy solidus 2025 K bare, 2318 K O-saturated, fusion 153 kJ/kg";
  const S0 = G.engSnap(G.engSnapNew()), XNZ = G.XNZ, cd = G.coreD(G.IX.coreId[c]), mk = PT.coreCladM[c], mF = PT.coreFuelKg[c], fuse = PT.coreFuseKJ[c];
  const hF = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; }, zr = CLAD_OWN.ZIRCALOY;
  /* no fission, no decay, the core dry and the Zr-steam reaction off: fuel, can and the little the steam film takes are the whole book */
  const tick = () => { const cs = G.E_CS; ST.csDecay[c] = 0; for(let k=0;k<XNN;k++) ST.csNV[nb+k] = 1; cs[0] = 0.02; cs[1] = 0; cs[2] = G.satT(PT.coreSat[c], ST.csPCore[c]); cs[3] = 0;
    cs[4] = 0.01; cs[5] = 0.01; cs[6] = PT.coreCp[c]*cs[2]; G.eCoreStep(c); };
  const oxid0 = PT.coreOxid[c]; PT.coreOxid[c] = 0;
  const setOx = f => { for(let k=0;k<XNN;k++){ ST.csNOx[nb+k] = f*G.ZR_PBR*PT.coreCladThick[c]; ST.csNZr[nb+k] = (1 - f)*mk*W[k]; } };
  const burst0 = PT.cladBurstOn[0]; PT.cladBurstOn[0] = 0;

  if(mode === "zm"){
  /* a hot pellet melting its can: fuel U + can U, fusion included, + what reached the water is conserved */
  /* each lump on its own mass, the free melt and the pool below the core on the enthalpy they carry */
  const book = lat => { let u = ST.csPlE[c]; for(let k=0;k<XNN;k++) u += ST.csNFu[nb+k]*hF(ST.csNTf[nb+k]) + ST.csNCl[nb+k]*(zr.h(ST.csNTcl[nb+k]) + ST.csNClMl[nb+k]*lat) + ST.csNMlE[nb+k] - (lat ? 0 : ST.csNMlL[nb+k]) + (lat ? ST.csNDis[nb+k]*fuse : 0); return u; };
  const melt = ecr => { G.engRestore(S0); setOx(ecr);
    for(let k=0;k<XNN;k++){ ST.csNTf[nb+k] = 3000; ST.csNTcl[nb+k] = 1900; ST.csNDmg[nb+k] = 0; }
    const u0 = book(153), u0b = book(0); let out = 0, plat = NaN, fM = 0;
    watch(G, {cap:3, step:tick, each:() => { out += (ST.csFQ[c] + G.SX.coreO[G.E_CO_FCI] + G.E_LH[3])*0.02; const k = XNZ >> 1;
      if(ST.csNClMl[nb+k] > 0.2 && ST.csNClMl[nb+k] < 0.8) plat = ST.csNTcl[nb+k]; fM = Math.max(fM, ST.csNClMl[nb+k]); }});
    return {res:(book(153) + out - u0)/u0, bad:(book(0) + out - u0b)/u0b, plat, fM}; };
  const a = melt(0), b = melt(0.999);
  check("Zircaloy melting plateau, bare metal", a.plat, 2025, 1, TEC, {abs:true, unit:"K", note:"most molten share reached " + a.fM.toFixed(2)});
  check("Zircaloy melting plateau, 99.9 % oxidised", b.plat, 2318, 1, TEC + "; the line between is a FIT on the two ends", {abs:true, unit:"K"});
  check("a 3000 K pellet melting its can, no source: fuel U + can U (fusion at 153 kJ/kg) + heat to water and into the head, conserved", a.res, 0, 1e-9,
    "first law on the pin; " + TEC, {abs:true, unit:"of the pin's U", note:"can " + (a.fM*100).toFixed(0) + " % molten"});
  check("fault injected, the can's fusion left out of the book: the energy check fails", Math.abs(a.bad) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"residual " + a.bad.toExponential(2)});
  }

  if(mode === "zc"){
  /* a burst Zr-clad UO2 node ramped at 1 K/s: the ceramic loses its geometry at VERCORS' temperature, not at UO2's 3120 K */
  const ramp = () => { G.engRestore(S0); setOx(0);
    let T = 2440, at = NaN;
    watch(G, {cap:8060*0.02, event:() => at === at ? "the ceramic lost its geometry" : "", step:() => {
      for(let k=0;k<XNN;k++){ ST.csNTf[nb+k] = T; ST.csNTcl[nb+k] = T; ST.csNClMl[nb+k] = 1; ST.csNDmg[nb+k] = 1; }
      tick(); const k = nb + (XNZ >> 1);
      if(ST.csNMelt[k] - ST.csNDis[k]/(mF*W[k - nb]) > 1e-9) at = T;
      T += 0.02; }});
    return at; };
  const VC = "VERCORS six tests 2479 +- 83 K and MELCOR SC1132(1); NEA/CSNI/R(2000)21: the ceramic relocates between 2200 and 2600 K";
  const g = ramp();
  check("a burst Zr-clad UO2 node on a 1 K/s ramp: the ceramic loses its geometry", g, 2479, 0, VC, {abs:true, unit:"K", pass:g >= 2200 && g <= 2600});
  const keep = G.eCoreStep.toString(), bad = keep.replace("ceramic ? CORIUM.ceramicT : tmelt", "tmelt");
  inBundle("eCoreStep = " + bad.replace(/^function eCoreStep/, "function")); const gBad = ramp();
  inBundle("eCoreStep = " + keep.replace(/^function eCoreStep/, "function"));
  check("fault injected, the gate put back on UO2's own melting point: the ceramic check fails", bad !== keep && !(gBad >= 2200 && gBad <= 2600) ? 1 : 0, 1, 0, "the check above must be able to fail",
    {abs:true, note:gBad === gBad ? "lost at " + gBad.toFixed(0) + " K" : "not lost by 2601 K"});
  }

  if(mode === "zd"){
  /* molten Zr held in a shell over 60 % oxide at 2600 K: it takes UO2 into solution to Hofmann's saturation and the shell holds */
  const hold = (shOx, n) => { G.engRestore(S0); setOx(0.7); const s0 = PT.cladShOx[0]; PT.cladShOx[0] = shOx;
    watch(G, {cap:n*0.02, step:() => { for(let k=0;k<XNN;k++){ ST.csNTf[nb+k] = 2450; ST.csNTcl[nb+k] = 2600; ST.csNClMl[nb+k] = 1; ST.csNDmg[nb+k] = 0; } tick(); }});
    const k = nb + (XNZ >> 1), r = {ratio:ST.csNDis[k]/(ST.csNClMl[k]*ST.csNZr[k]), out:ST.csNClOut[k]};
    PT.cladShOx[0] = s0; return r; };
  const HOF = "Hofmann, KfK-4485, via Zhan, STNI 2020 eq. 17: the first stage saturates at 35.8 wt% UO2 in the melt, 0.558 kg per kg of Zr";
  const h = hold(0.6, 10500), hb = hold(1, 25);
  check("UO2 dissolved over the molten Zr holding it, 210 s at 2600 K", h.ratio, 0.558, 1e-9, HOF + "; its time a FIT, 10 s past 2523 K", {unit:"kg/kg"});
  check("a can 70 % oxide past the 2400 K breakout keeps its shell", h.out, 0, 0, "Stuckert et al., NENE 2002 sec. 8: over 60 % oxidised the clad oxidises through and never breaks", {abs:true});
  check("fault injected, the 60 % rule off: the shell breaks", hb.out, 1, 0, "the check above must be able to fail", {abs:true});
  }
  PT.coreOxid[c] = oxid0; PT.cladBurstOn[0] = burst0;

  if(mode === "zm"){
  /* Magnox on Calder Hall: the can melts at 923 K paying 349 kJ/kg and makes no hydrogen */
  commissionPreset(7); const P7 = G.PT, S7 = G.ST, mg = CLAD_OWN["MAGNOX AL80"], m7 = P7.coreCladM[c], f7 = P7.coreFuelKg[c], u7 = P7.coreFuseKJ[c];
  const hF7 = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; };
  const bk = lat => { let u = S7.csPlE[c]; for(let k=0;k<XNN;k++) u += S7.csNFu[k]*hF7(S7.csNTf[k]) + S7.csNCl[k]*(mg.h(Math.min(S7.csNTcl[k], 923)) + (S7.csNTcl[k] > 923 ? 34.30901/0.024305*(S7.csNTcl[k] - 923)/1000 : 0) + S7.csNClMl[k]*lat) + S7.csNMlE[k] - (lat ? 0 : S7.csNMlL[k]); return u; };
  /* the gas film off, the bar at 940 K under its own 942 K phase change heating a 900 K can past its solidus */
  const fp7 = P7.coreFilmPool[c]; P7.coreFilmPool[c] = 0;
  for(let k=0;k<XNN;k++){ S7.csNTf[k] = 940; S7.csNTcl[k] = 900; S7.csNClMl[k] = 0; S7.csNHc[k] = 0; }
  const w0 = bk(349); let o7 = 0, pl = NaN, h2 = 0;
  watch(G, {cap:3, step:() => { const cs = G.E_CS; S7.csDecay[c] = 0; cs[0] = 0.02; cs[1] = 0; cs[2] = G.satT(P7.coreSat[c], S7.csPCore[c]); cs[3] = 1; cs[4] = 0; cs[5] = 1e-3; cs[6] = P7.coreCp[c]*cs[2];
    G.eCoreStep(c); o7 += S7.csFQ[c]*0.02; h2 += G.SX.coreO[G.E_CO_H2]; const k = XNZ >> 1; if(S7.csNMlK[k] > 0 && S7.csNCl[k] > 0) pl = S7.csNTcl[k]; }});
  const NIST = "Mg: melts 923 K, fusion 8.48 kJ/mol = 349 kJ/kg, liquid cp 1412 J/kg/K (NIST WebBook Shomate)";
  check("Magnox can melting plateau", pl, 923, 1, NIST, {abs:true, unit:"K"});
  P7.coreFilmPool[c] = fp7;
  check("a 940 K bar melting its Magnox can, no film: bar U + can U (fusion at 349 kJ/kg) + heat to the gas, conserved", (bk(349) + o7 - w0)/w0, 0, 1e-9, "first law on the pin; " + NIST, {abs:true, unit:"of the pin's U"});
  check("the Magnox can makes no hydrogen as it melts", h2, 0, 0, "no Zr: no metal-steam reaction", {abs:true, unit:"kg"});
  }
}
