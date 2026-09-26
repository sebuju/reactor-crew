"use strict";
// chunks: split creep tmi dry
// preset: 0
/* the vessel's lower head under a melt: split = the pool's up and down heat against BALI; creep = the rupture law against the
   published fit and SA533B1 tests; tmi = TMI-2's 19 t on a wet head at 15 MPa fails by creep; dry = the same on a dry head at
   0.2 MPa fails at a penetration; both close their energy */
const {check, commissionPreset, inBundle, tsat, watch} = require("./lib.js");
const mode = process.argv[2];
const G = commissionPreset(0), PT = G.PT, ST = G.ST, c = 0, CO = G.CORIUM;
const S0 = G.engSnap(G.engSnapNew()), R = PT.coreVesR[c], tw = PT.coreVesWall[c], rk = PT.coreRated[c]*1000, dec = 0.011;
const hF = T => { G.E_FU[0] = T; G.eFuelHA(c); return G.E_FU[1]; }, hK = T => { G.E_CL[0] = T; G.E_CL[4] = T; G.eCladHA(c); return G.E_CL[1]; };
const hS = T => { G.E_SH[0] = T; G.eSteelHA(); return G.E_SH[1]; };
const fuse = PT.coreFuseKJ[c], lat = PT.cladHfus[PT.coreCladRow[c]];
/* F kg of oxide and K kg of can at T0, a W/g of decay heat, the lower plenum wet or dry, at p MPa */
const lay = (F, K, T0, wpg, wet, p) => { G.engRestore(S0);
  ST.csPlF[c] = F; ST.csPlK[c] = K; ST.csPlE[c] = F*(hF(T0) + fuse) + K*(hK(T0) + lat); ST.csPlL[c] = F*fuse + K*lat;
  ST.csDecay[c] = dec; ST.csPlDw[c] = wpg*(F + K)/(dec*rk);
  ST.csPCore[c] = p; ST.csLvl[c] = wet ? 0 : -2*PT.coreVesClr[c]; G.E_CS[2] = tsat(Math.min(p, 22));
  ST.csHdTi[c] = G.E_CS[2]; ST.csHdTo[c] = G.E_CS[2]; ST.csHdLife[c] = 0; ST.csHdFail[c] = 0; ST.csHdWhy[c] = 0; };
/* one tick of the head as eCoreStep runs it: the pool's decay heat first, nothing arriving */
const step = dt => { ST.csPlE[c] += dec*rk*ST.csPlDw[c]*dt; G.E_LHA[0] = ST.csPlF[c]; G.E_LHA[1] = ST.csPlK[c]; G.E_LHA[2] = ST.csPlE[c]; G.E_LHA[3] = 560; G.eLhStep(c, dt); };
const capV = x => Math.PI*x*x*R*R*(R - x*R/3);

if(mode === "split"){
  /* a molten oxide pool at 0.13 W/g (TMI-2's) filling the head to H/R, wet above: what goes up over all that leaves */
  const bali = [[0.25, 0.64], [0.5, 0.56], [0.75, 0.51], [1.0, 0.44]];
  const run = () => bali.map(([x]) => { lay(capV(x)*CO.rhoDebris, 0, 3000, 0.13, true, 15); step(0.02);
    return {up:G.E_LH[2]/(G.E_LH[2] + G.E_LH[3]), hr:G.E_LH[5]/R, ra:G.E_LH[6]}; });
  const a = run();
  bali.forEach(([x, b], i) => check("the pool's upward share at H/R " + x + ": ACOPO's up and down Nusselt numbers on its own Ra'", a[i].up, b, 0.03,
    "BALI 3D correlations, JAERI-Conf 99-005 p. 85; the two facilities' splits agree to about 1 % at H/R 1 (ACOPO 43 %, BALI 44 %), a tolerance of 3 % holds both",
    {abs:true, note:"H/R from the pool's mass " + a[i].hr.toFixed(4) + ", Ra' " + a[i].ra.toExponential(2) + ", R " + R.toFixed(2) + " m"}));
  const src = G.eLhStep.toString();
  inBundle("eLhStep = " + src.replace("dn[0]*Math.pow(ra, dn[1])", "2*dn[0]*Math.pow(ra, dn[1])").replace(/^function eLhStep/, "function"));
  const f = run(); inBundle("eLhStep = " + src.replace(/^function eLhStep/, "function"));
  const worst = Math.max(...f.map((r, i) => Math.abs(r.up - bali[i][1])));
  check("fault injected, the ACOPO down flux doubled: the split check fails", worst > 0.03 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + worst.toFixed(3)});
  check("the upward share falls as the pool deepens, H/R 0.25 to 1", a.every((r, i) => !i || r.up < a[i - 1].up) ? 1 : 0, 1, 0, "BALI and ACOPO: a deeper pool sends more of its heat down its larger wetted wall", {abs:true, note:a.map(r => r.up.toFixed(3)).join(" ")});
}

if(mode === "creep"){
  const tr = (MPa, K) => { G.E_CRP[0] = MPa; G.E_CRP[1] = K; G.eCreepA(); return G.E_CRP[2]; };
  const vip = (MPa, K) => { const l = Math.log10(MPa/6.894757), R_ = K*1.8;
    return K < 850.15 ? 10**((55.847 - 11.492*l)*1000/R_ - 25) : 10**((30.014 - 12.127*l + 5.1831*l*l - 1.8394*l**3)*1000/R_ - 11); };
  let w = 0; for(const [p, T] of [[80, 800], [55.6, 900], [26.5, 1050], [12.6, 1150], [7, 1250], [3.5, 1400]]) w = Math.max(w, Math.abs(tr(p, T)/vip(p, T) - 1));
  check("the rupture law is the TMI-2 VIP Larson-Miller fit, 800-1400 K, 3.5-80 MPa: worst relative distance", w, 0, 1e-12,
    "NUREG/CR-6197 4.2.2 eqs. 1-4 (sigma ksi, T degR, t h), typed a second time", {abs:true});
  for(const [p, T, h] of [[26.5, 1050, 4.1], [12.5, 1050, 54.7], [26.5, 1150, 0.05], [12.6, 1150, 2.2]]){
    const t = tr(p, T);
    check("SA533B1 rupture at " + p + " MPa and " + T + " K: VIP fit over the INEL test, within a factor 5", Math.abs(Math.log(t/h)), 0, Math.log(5),
      "NUREG/CR-5642 Table B-1 (INEL tests of SA533B1)", {abs:true, gap:"the vessel's lower head under a melt", note:"fit " + t.toPrecision(3) + " h, test " + h + " h"}); }
  check("no creep under the fit's range (723 K)", tr(100, 700), Infinity, 0, "NUREG/CR-6197: the fits start at 450 C", {pass:tr(100, 700) === Infinity});
}

if(mode === "tmi" || mode === "dry"){
  /* 19 t of 78/17 UO2/ZrO2 at 2800 K and 0.13 W/g: under water at 15 MPa (TMI-2), or dry at 0.2 MPa; each run ends when the head fails */
  const wet = mode === "tmi", p = wet ? 15 : 0.2, dt = 0.5, H = 6*3600;
  const run = cap => { lay(19000*0.78/0.95, 19000*0.17/0.95, 2800, 0.13, wet, p);
    const e0 = ST.csPlE[c], w0 = hS(ST.csHdTi[c]) + hS(ST.csHdTo[c]), mw = CO.hdRho*tw/2;
    let heat = 0, out = 0, pk = 0, TiF = 0;
    const w = watch(G, {dt, cap, step:() => { heat += dec*rk*ST.csPlDw[c]*dt; step(dt); },
      each:() => { out += (G.E_LH[2] + G.E_LH[3] + G.E_LH[4])*dt; pk += G.E_LH[7]*dt; TiF = ST.csHdTi[c]; },
      event:() => ST.csHdFail[c] ? "head failed" : ""});
    return {t:w.t, why:ST.csHdWhy[c], Ti:TiF, life:ST.csHdLife[c], e:(ST.csPlE[c] - e0 + out - heat)/heat,
      w:(mw*(hS(ST.csHdTi[c]) + hS(ST.csHdTo[c]) - w0) - pk)/pk, Tp:(G.eLhPoolTA(c), G.E_LH[0]), H:G.E_LH[5]}; };
  const a = run(H), note = "failed " + (a.why === 1 ? "by creep" : a.why === 2 ? "at a penetration" : "not") + " at " + (a.t/3600).toFixed(2) + " h, inner wall " +
    a.Ti.toFixed(0) + " K, pool " + a.Tp.toFixed(0) + " K and " + a.H.toFixed(2) + " m deep, creep life " + (a.life*100).toFixed(1) + " %, wall " + (tw*1000).toFixed(0) + " mm";
  check((wet ? "TMI-2" : "dry head") + ": pool energy + heat out = decay heat x time", a.e, 0, 1e-9, "first law", {abs:true, unit:"of the heat", note});
  check((wet ? "TMI-2" : "dry head") + ": the hot spot's two lumps take what the peak flux brought", a.w, 0, 1e-9, "first law, per m2 of wall", {abs:true, unit:"of the heat"});
  if(wet){
    check("TMI-2 debris on a wet head at 15 MPa, no gap cooling: the head fails by creep, not at once and within 4 h", a.why === 1 && a.t > 300 && a.t < 4*3600 ? 1 : 0, 1, 0,
      "NUREG/CR-6197 7.4: global creep rupture within about 2 h of relocation without gap cooling", {abs:true, note});
    const src = G.eLhStep.toString();
    inBundle("eLhStep = " + src.replace("s.csHdLife[c] += dt/3600/E_CRP[2];", "").replace(/^function eLhStep/, "function"));
    // its check above asks for creep within 4 h, so the fault is answered at 4 h
    const f = run(4*3600); inBundle("eLhStep = " + src.replace(/^function eLhStep/, "function"));
    check("fault injected, creep off: the head never fails and the check fails", f.why === 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"failed " + f.why + " at " + (f.t/3600).toFixed(2) + " h"}); }
  else check("the same pool on a dry head at 0.2 MPa fails at a penetration as its inner wall passes 1600 K, not by creep", a.why === 2 && a.Ti >= CO.penPwr && a.Ti < CO.penPwr + 5 ? 1 : 0, 1, 0,
    "NUREG/CR-5642 executive summary: PWR penetrations at 1600 K below 2 MPa; creep at 0.2 MPa needs ~1e5 h", {abs:true, note});
}
