"use strict";
// chunks: ox fg fp fb
/* the clad and what it lets go of: ox = the steam-zirconium rate law, its ranges and its hydrogen; fg = the pellet past tdmg, its gas, its gap and its growth; fp = what a failed pin lets go of and what it reads as dose, fb = where it goes through a pipe break */
const {check, commissionPreset, inBundle} = require("./lib.js");
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
  let zr = 0, h2 = 0, Tmax = 0;
  for(let t=0;t<300;t++){
    const o0 = Array.from(ST.csNOx.subarray(nb, nb + XNN)), i0 = Array.from(ST.csNOxI.subarray(nb, nb + XNN)), d0 = Array.from(ST.csNDmg.subarray(nb, nb + XNN));
    cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 1; cs[4] = 0.01; cs[5] = 0.01; cs[6] = 1200;
    G.eCoreStep(c);
    for(let k=0;k<XNN;k++){ Tmax = Math.max(Tmax, ST.csNTf[nb+k]);
      zr += G.ZR_RHO*((ST.csNOx[nb+k] - o0[k]) + d0[k]*(ST.csNOxI[nb+k] - i0[k]))/G.ZR_PBR*aH*W[k]; }
    h2 += o[G.E_CO_H2]; }
  check("H2 made over Zr consumed, bared core at full power in steam for 6 s (clad to " + Tmax.toFixed(0) + " K)", h2/zr, 2*2.01588/91.224, 1e-9,
    "Zr + 2 H2O -> ZrO2 + 2 H2: 2 x 2.01588 / 91.224 (IUPAC atomic masses)", {note:(zr).toFixed(1) + " kg Zr"});
}

if(mode === "fg"){
  const XNZ = G.XNZ, SX = G.SX, H = G.H_GAP, tdmg = PT.coreTdmg[c], fill = PT.coreFgFill[c], S0 = G.engSnap(G.engSnapNew());
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
  let pRod = 0; for(let k=0;k<XNN;k++) pRod = Math.max(pRod, G.ROD_P_FILL*SX.coreGapT[nb+k]/G.ROD_T_FILL);
  check("fresh rod's hot internal pressure at rest under system pressure", pRod, ST.csPCore[c], 0, "design rule: a rod stays under coolant pressure (Westinghouse 17x17, fill 2.1-3.4 MPa cold)",
    {abs:true, unit:"MPa", pass:pRod < ST.csPCore[c] && G.ROD_P_FILL >= 2.1 && G.ROD_P_FILL <= 3.4, note:"fill " + G.ROD_P_FILL + " MPa at " + G.ROD_T_FILL + " K"});
  check("mixture conductivity, He with 30 % fission gas at 700 K", (G.E_GKIO[0] = 700, G.E_GKIO[1] = 0.3, G.eGasKA(), G.E_GKIO[2]), kMix(700, fgMix(0.3)), 1e-12, SRCG,
    {unit:"W/m/K", note:"against its own eq. only; no measured He-Xe-Kr point was read"});

  /* nodes held under, over and further over tdmg in a bared core: only the hot ones let go, on Booth's curve */
  const hold = (Ts, secs, prep) => { back(); if(prep) prep(); const cs = G.E_CS, n = Math.round(secs/0.02);
    for(let t=0;t<n;t++){ Ts.forEach((T, q) => { for(const k of ring(q)) ST.csNTf[k] = T; });
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 1; cs[4] = 0.01; cs[5] = 0.01; cs[6] = 1200;
      G.eCoreStep(c); }
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
    let tfIn = null, thIn = null;
    for(let t=0;t<3000;t++){ ST.csPhi.set(ph, nb); hold0(); if(t === 2999){ tfIn = ring(0).map(k => ST.csNTf[k]); thIn = ring(0).map(k => ST.csNFg[k]); }
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = Ts; cs[3] = 0; cs[4] = PT.coreFlowK[c]*fn; cs[5] = Math.max(fn, G.E_CORE_DT_QMIN); cs[6] = inH; G.eCoreStep(c); }
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
  const pc = ST.csPCore[c], tbG = tbOf(G.ROD_P_FILL*1200/G.ROD_T_FILL*(1 + relB/fill) - pc), tbN = tbOf(G.ROD_P_FILL*1200/G.ROD_T_FILL - pc);
  const want = Math.min(1, 50*Math.min(1, (1200 - tbG)/50)*0.02/8);
  check("burst damage after 1 s at 1200 K clad, the ring holding its released gas", dm[0], want, 1e-9,
    "NUREG-0630 burst temperature against hoop stress (20 MPa -> 1477 K, 140 MPa -> 1030 K) on fill plus released gas, ideal gas", {note:"burst at " + tbG.toFixed(0) + " K with gas, " + tbN.toFixed(0) + " K without"});
  check("burst damage after 1 s at 1200 K clad, the ring with its gas still in the pellet", dm[1], 0, 0, "NUREG-0630: " + tbN.toFixed(0) + " K burst temperature on the fill alone", {abs:true});

  /* a pellet driven far over its rest outgrows the clad: the gap closes onto the surfaces' roughness, not to zero */
  const thC = []; back(); { const cs = G.E_CS, T0 = ring(0).map(k => ST.csNTf[k]);
    for(let t=0;t<5;t++){ ring(0).forEach((k, q) => { ST.csNTf[k] = T0[q] + 1500; thC[q] = ST.csNFg[k]; });
      cs[0] = 0.02; cs[1] = ST.csHeat[c]; cs[2] = 560; cs[3] = 0; cs[4] = PT.coreFlowK[c]*ST.csFlowNet[c]; cs[5] = ST.csFlowNet[c]; cs[6] = 1200; G.eCoreStep(c); } }
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
  const A = G.engSnap(G.engSnapNew()); for(let t=0;t<50;t++) G.step(0.02); const B1 = G.engSnap(G.engSnapNew());
  G.engRestore(A); for(let t=0;t<50;t++) G.step(0.02); const B2 = G.engSnap(G.engSnapNew());
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
  for(let t=0;t<300;t++){
    G.step(0.02);
    if(t === 0){ nN = 0; for(let i=0;i<ST.fpNBy.length;i++){ const m = ST.mBy[i]; ST.h2By[i] = ST.fpNBy[i]; if(m === m) nN += ST.fpNBy[i]*m; } h2In = nN; }
    for(let q=0;q<2;q++) drift[q] = Math.max(drift[q], Math.abs(books(q) - (q === 0 ? ST.csFpRelN[c] : ST.csFpRelV[c]))/inv[q]);
    if(G.SX.coreO[G.E_CO_H2] > 0) made = true;
    if(t > 0 && !made){ tk++; for(let k=0;k<ST.outH2.length;k++){ h2a += ST.outH2[k]; fpa += ST.outFpN[k]; } } }
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
  for(let t=0;t<100;t++) G.step(0.02);
  const badR = sum(ST.roomFpN)/Math.max(sum(ST.roomFpV), 1e-300);
  check("fault injected, the release fractions zeroed: the building ordering check fails", badR > 1e2 ? 0 : 1, 1, 0, "the ordering check above must be able to fail", {abs:true, note:"reads " + badR});
}
