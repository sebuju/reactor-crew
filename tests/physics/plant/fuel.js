"use strict";
/* the fuel pin's own figures, shared with fuel.js, and its capacity, time constant and pellet rise against the drawing on each commissioned preset */
const {check, coreShareHand} = require("../lib.js");
const ROW = "core heat reaches the water through the fuel pin", CAP = "fuel heat capacity";

/* Fink, J. Nucl. Mater. 279 (2000) 1-18, solid UO2 per mol; k1 scales C1 for the fault */
const FM = 0.27003, FC1 = 81.613, FTH = 548.68, FC2 = 2.285e-3, FC3 = 2.360e7, FEA = 18531.7, T0 = 298.15;
const finkCp = (T, k1 = 1) => { const x = Math.exp(FTH/T);
  return (k1*FC1*FTH*FTH*x/(T*T*(x - 1)*(x - 1)) + 2*FC2*T + FC3*FEA*Math.exp(-FEA/T)/(T*T))/FM/1000; };
const finkH = (T, k1 = 1) => (k1*FC1*FTH*(1/(Math.exp(FTH/T) - 1) - 1/(Math.exp(FTH/T0) - 1)) + FC2*(T*T - T0*T0)
  + FC3*(Math.exp(-FEA/T) - Math.exp(-FEA/T0)))/FM/1000;
/* Fink & Petri, ANL/RE-97/2 (1997) Table 1.1.2: K, h - h(298.15) kJ/kg, cp J/kg/K; stated uncertainty h 1 % to 3120 K, cp 2 % to 2000 K */
const TAB = [[298.15, 0, 235.55], [400, 25.61, 264.07], [500, 52.85, 279.58], [600, 81.34, 289.63], [800, 140.68, 302.72], [1000, 202.18, 311.94],
  [1200, 265.35, 319.60], [1500, 362.84, 330.40], [1800, 464.01, 345.68], [2000, 534.92, 365.47], [2200, 611.30, 401.98], [2500, 746.30, 511.58],
  [2600, 800.22, 568.72], [2700, 861.73, 618.67], [3000, 1047.33, 618.67], [3120, 1121.57, 618.67]];

/* natural U metal, Kim & Hofman, ANL AAA Fuels Handbook (2003) sec. 2.6: cp J/mol/K per phase, transitions and latent heats Table 2-13 */
const UMM = 0.23803, UPH = [[942, 24.959, 2.132e-3, 2.370e-5, 2791], [1049, 42.928, 0, 0, 4757], [1408, 38.284, 0, 0, 0], [Infinity, 48.660, 0, 0, 0]];
const uCp = T => { const p = UPH.find(r => T <= r[0]); return (p[1] + p[2]*T + p[3]*T*T)/UMM/1000; };
const uH = T => { let h = 0, lo = T0;
  for(const [hi, a, b, cc, L] of UPH){ const t = Math.min(T, hi), F = x => a*x + b*x*x/2 + cc*x*x*x/3;
    h += F(t) - F(lo); if(T <= hi) break; h += L; lo = hi; }
  return h/UMM/1000; };
/* each fuel's own figures: kg/m3, cp and h(T) kJ/kg, k W/m/K at the mean pellet */
const IFR_K = [[293, 27], [373, 29.1], [473, 31.1], [573, 33.4], [673, 35.8], [773, 38.2], [873, 40.6], [973, 43.2], [1073, 45.7], [1173, 48.3]];
const kU = T => { const i = Math.max(0, IFR_K.findIndex(r => r[0] >= T) - 1), [a, ka] = IFR_K[i], [b, kb] = IFR_K[i + 1]; return ka + (T - a)*(kb - ka)/(b - a); };
const FUEL_OWN = {
  "U METAL NATURAL": {rho:18700, cp:uCp, h:uH, k:kU, src:"Calder Hall bar 18.7 g/cm3 (Nuclear Engineering Dec. 1956), ANL handbook cp, IFR handbook k (SAS4A Table 10.3.4)"}};
/* Fink 2000 eq. 20, k(T) for 95 % dense UO2, W/m/K */
const finkK = T => { const t = T/1000;
  return 100/(7.5408 + 17.692*t + 3.6142*t*t) + 6400/Math.pow(t, 2.5)*Math.exp(-16.35/t); };
const UO2_OWN = {rho:10400, cp:T => finkCp(T), h:T => finkH(T), k:finkK, src:"UO2 10400 kg/m3, Fink cp and k (J. Nucl. Mater. 279 (2000) eq. 1 and eq. 20, 95 % TD)"};
const pin = G => { const PT = G.PT, ST = G.ST, XNN = G.XNN, W = G.nodeW, c = 0, nb = 0;
  const rk = PT.coreRated[c]*1000;
  /* share of rated per unit node weight into the water (w), the blocks (b) and the control channels (c) at flux p, void a and rod coverage cov, on the core's own decay heat carried by decay weight pd (p when absent) */
  const outside = (p, heat, a, cov, pd = p) => { const s = coreShareHand(G, c, a, cov), hd = ST.csDecay[c], hp = heat - hd;
    return {w:p*hp*s.wp + pd*hd*s.wd, b:p*hp*s.bp + pd*hd*s.bd, c:p*hp*s.cp + pd*hd*s.cd}; };
  /* the drawn moderator's own cp, kJ/kg/K */
  const modCp = T => { const io = new Float64Array(2); io[0] = T; G.MODER[PT.coreModRow[c]].cpA(io, 0, 1); return io[1]; };
  const filmMean = () => { let f = 0; for(let k=0;k<XNN;k++) f += W[k]*ST.csNFilm[nb+k]; return f; };
  const fuelOwn = () => FUEL_OWN[G.FUEL[G.coreD(G.IX.coreId[c]).fuel].name] || UO2_OWN;
  /* the drawing counted by hand: fuel slots x 4 quadrants x rods per bundle x pellet area x height */
  const drawnKg = () => {
    const cd = G.coreD(G.IX.coreId[c]); let n = 0;
    for(let q=0;q<G.LQ*G.LQ;q++) if(G.latFuel(cd, q)) n++;
    const rods = 4*n*(G.LAT_P0/G.rodPOf(cd))**2, R = G.rodD(cd)/2 - G.cladOf(cd).thick;
    return {rods, R, len:cd.lat.len, kg:rods*Math.PI*R*R*cd.lat.len*fuelOwn().rho};
  };
  const tfMean = () => { let t = 0; for(let k=0;k<XNN;k++) t += W[k]*ST.csNTf[nb+k]; return t; };
  const tcMean = () => { let t = 0; for(let k=0;k<XNN;k++) t += W[k]*ST.csNTc[nb+k]; return t; };
  return {rk, outside, modCp, filmMean, fuelOwn, drawnKg, tfMean, tcMean}; };

module.exports = (G, pre) => { const PT = G.PT, ST = G.ST, XNN = G.XNN, W = G.nodeW, c = 0, nb = 0, name = G.PLANTPRE[pre][0];
  const {fuelOwn, drawnKg, filmMean, tfMean, tcMean} = pin(G);
if(G.fuelDissolved(G.coreD(G.IX.coreId[c]))){
  let rise = 0; for(let k=0;k<XNN;k++) rise = Math.max(rise, Math.abs(ST.csNTf[nb+k] - ST.csNTc[nb+k]));
  check(name + ": fuel heat capacity outside the salt", PT.coreFuelKg[c], 0, 0, "a fuel dissolved in its coolant has no pellet: its heat capacity is the salt's own", {abs:true, unit:"kg"});
  check(name + ": fuel over its salt at rest, worst node", rise, 0, 0, "the fission heat is born in the salt, so there is no rise to carry it across", {abs:true, unit:"K"});
}
else {
  const COOL = G.COOLANT[G.coreD(G.IX.coreId[c]).cool].id;
  /* gap conductance and water film typical of an LWR (Todreas & Kazimi, Nuclear Systems I, ch. 8); Zircaloy k MATPRO; Magnox k on a line between pure Mg 156 and Mg-1.5Al 100 W/m/K (J. Magnes. Alloys 8, 2020) */
  const cd = G.coreD(G.IX.coreId[c]), own = fuelOwn(), Tm = tfMean();
  /* CO2 by Dittus-Boelter on Calder Hall's zone B annulus: 3.95 in channel, 54 mm element, 1964/1696 lb/s; NIST at 0.7 MPa, 500 K: mu 24.004 uPa.s, k 0.033109 W/m/K, cp 1.0233 kJ/kg/K */
  const co2Film = () => { const D = 3.95*0.0254, d = 0.054, G0 = 890.9/1696/(Math.PI/4*(D*D - d*d)), Re = G0*(D - d)/24.004e-6, Pr = 1023.3*24.004e-6/0.033109;
    return 0.023*Re**0.8*Pr**0.4*0.033109/(D - d); };
  const RHO = own.rho, K = own.k(Tm), HGAP = 5700, KCLAD = {"ZIRCALOY":16, "MAGNOX AL80":156 - 56*0.8/1.5}[G.cladOf(cd).name];
  const HFILM = {"CO2":co2Film()}[G.COOLANT[cd.cool].id] ?? 34000;
  const dr = drawnKg(), cp = own.cp(Tm), f = filmMean(), ua = PT.corePinUA[c]*f;
  const Ro = PT.coreRodD[c]/2, R = Ro - G.cladOf(cd).thick, fin = G.finOf(cd);
  const qlin = ST.csFQ[c]*1000/(dr.rods*dr.len);
  const rOut = [1/(2*Math.PI*R*HGAP), Math.log(Ro/R)/(2*Math.PI*KCLAD), 1/(2*Math.PI*Ro*HFILM*fin*f)];
  /* the pellet's volume mean over its surface on the fuel's OWN k(T): int k dT = q'(1 - r2/R2)/(4 pi).
     A flat k reduces this to 1/(8 pi k) exactly, so one form covers UO2 and the metals. */
  const pelRes = (kOf, rSum = rOut[0] + rOut[1] + rOut[2]) => { if(!(qlin > 0)) return 0;
    const A = qlin/(4*Math.PI), N = 4000, Ts = tcMean() + qlin*rSum;
    let T = Ts, mean = 0;
    for(let i=0;i<N;i++){ const Tx = T + A/kOf(T)*(0.5/N); mean += Tx/N; T += A/kOf(Tx)/N; }
    return (mean - Ts)/qlin; };
  const res = (kOf, rSum) => [pelRes(kOf, rSum), rOut[0], rOut[1], rOut[2]];
  const parts = res(own.k).map(x => RHO*cp*1000*Math.PI*R*R*x);
  const real = parts.reduce((a, b) => a + b, 0), C = PT.coreFuelKg[c]*cp, tau = C/ua;
  const note = "model " + tau.toFixed(2) + " s at film " + f.toFixed(3) + "; lumped " + real.toFixed(2) + " s = pellet " + parts[0].toFixed(2) +
    " + gap " + parts[1].toFixed(2) + " + clad " + parts[2].toFixed(2) + " + film " + parts[3].toFixed(2) + " (pellet R " + (R*1000).toFixed(2) + " mm, cp " + cp.toFixed(3) + " at " + Tm.toFixed(0) + " K, coolant " + COOL + ")";
  const SRC = "lumped pin: tau = rho cp pi R^2 [1/(8 pi k) + 1/(2 pi R h_gap) + ln(Ro/R)/(2 pi k_clad) + 1/(2 pi Ro h_film fin)], " + own.src;
  /* sodium's film is thinner than water's, so the water figure bounds it; a gas film is thicker and is not estimated */
  const est = COOL !== "HTGR";
  const kind = G.FUEL[cd.fuel].name;
  if(!est) check(name + ": fuel time constant at rest, " + COOL + " film not estimated: the lumped figure is a floor", tau, real, 0, SRC, {unit:"s", pass:false, gap:ROW, note});
  else check(name + ": fuel time constant at rest against a lumped conduction estimate", tau, real, 0.3, SRC, {unit:"s", gap:ROW, note});
  const Cr = dr.kg*cp;
  check(name + ": fuel heat capacity against the drawn fuel mass x its cp", C, Cr, 0.01,
    "rods counted off the drawing (fuel slots x 4 x bundle rods) x pellet area x height x the fuel's own density and cp at the mean pellet: " + own.src, {unit:"kJ/K", gap:CAP,
      note:kind + " " + (dr.kg/1000).toFixed(1) + " t, " + dr.rods.toFixed(0) + " rods, pin UA x film " + ua.toFixed(0) + " kW/K"});
  check(name + ": fault injected, the quadrant factor dropped: the capacity check fails", Math.abs(C/4/Cr - 1) > 0.01 ? 1 : 0, 1, 0,
    "the capacity check above must be able to fail", {abs:true});
  let rise = 0; for(let k=0;k<XNN;k++) rise += W[k]*(ST.csNTf[nb+k] - ST.csNTc[nb+k]);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const want = qlin*sum(res(own.k)), wantBad = qlin*sum(res(T => own.k(T)/2));
  const SRC2 = "conduction through pellet, gap, clad and film at the rest heat flux (Todreas & Kazimi ch. 8), q' off the drawn rods, the pellet on the conductivity integral of " + own.src + ", h_gap 5.7, k_clad " + KCLAD.toFixed(0) + ", h_film " + (HFILM/1000).toFixed(3) + " kW/m2K x fin " + fin + " x the film share";
  const note2 = "q' " + (qlin/1000).toFixed(2) + " kW/m, R' " + (sum(res(own.k))*1000).toFixed(2) + " mK.m/W, effective pellet k " +
    (qlin/(4*Math.PI)/2/Math.max(pelRes(own.k)*qlin, 1e-9)).toFixed(2) + " W/m/K against " + K.toFixed(2) + " at the mean pellet";
  if(!est) check(name + ": mean pellet over its water at rest, " + COOL + " film not estimated", rise, want, 0, SRC2, {unit:"K", pass:false, gap:ROW, note:note2});
  else {
    check(name + ": mean pellet over its water at rest against conduction", rise, want, 0.3, SRC2, {unit:"K", gap:ROW, note:note2});
    check(name + ": fault injected, the pellet conductivity halved: the rise check fails", Math.abs(rise/wantBad - 1) > 0.3 ? 1 : 0, 1, 0,
      "the rise check above must be able to fail", {abs:true, note:"off by " + ((rise/wantBad - 1)*100).toFixed(0) + " %"});
  }
}
};
Object.assign(module.exports, {pin, CAP, FM, finkCp, finkH, TAB});
