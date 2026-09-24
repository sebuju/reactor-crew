"use strict";
const {load, inBundle, check, psat, tsat, if97, TofH, if97r2, if97r3, if97r5, pB23, tB23, if97pT} = require("./lib.js");
const G = load();
const IF97 = "IAPWS-IF97 (2007 revision) verification tables and saturation table";

const SAT = [
  [0.1,   372.756, 958.35, 0.5903, 2257.4],
  [1,     453.036, 887.13, 5.1450, 2014.6],
  [5,     537.09,  777.37, 25.351, 1639.7],
  [7,     558.98,  739.72, 36.525, 1504.9],
  [10,    584.149, 688.42, 55.463, 1317.4],
  [15,    615.31,  603.52, 96.71,  1000.7],
  [20,    638.90,  490.19, 170.50, 584.3],
];
/* the secondary's own curve, and a PWR primary's (one fluid, so one line) */
const curves = [["", G.SAT_WATER], ["PWR circuit ", G.satCurveFor(G.COOLANT[0], 15.5)]];
for(const [tag, W] of curves) for(const [p, T, rf, rg, hfg] of SAT){
  const Ts = G.satT(W, p);
  check(tag + "Tsat(" + p + " MPa)", Ts, T, 0.1, IF97, {abs:true, unit:"K"});
  check(tag + "rho_f sat(" + p + " MPa)", G.rhofOf(W, Ts), rf, 0.005, IF97, {unit:"kg/m3"});
  check(tag + "rho_g sat(" + p + " MPa)", G.rhogOf(W, Ts), rg, 0.01, IF97, {unit:"kg/m3"});
  check(tag + "h_fg(" + p + " MPa)", G.hfgOf(W, Ts), hfg, 0.005, IF97, {unit:"kJ/kg"});
}
const W = G.SAT_WATER;
for(const [T, p] of [[300, 0.00353658941], [500, 2.63889776], [600, 12.3443146]])
  check("p_sat(" + T + " K)", G.satP(W, T), p, 1e-3, IF97 + " region 4", {unit:"MPa"});

/* the test's own IF97 against the release's verification tables, before anything leans on it */
const VT = 1e-8, SRC_VT = "IAPWS R7-97(2012) tables 5, 15, 33 and section 4";
for(const [p, T, v, h, cp] of [[3, 300, 1.00215168e-3, 115.331273, 4.17301218], [80, 300, 9.71180894e-4, 184.142828, 4.01008987],
    [3, 500, 1.20241800e-3, 975.542239, 4.65580682]]){ const r = if97(p, T);
  check("test IF97 region 1 v(" + T + " K, " + p + " MPa)", r.v, v, VT, SRC_VT, {unit:"m3/kg"});
  check("test IF97 region 1 h(" + T + " K, " + p + " MPa)", r.h, h, VT, SRC_VT, {unit:"kJ/kg"});
  check("test IF97 region 1 cp(" + T + " K, " + p + " MPa)", r.cp, cp, VT, SRC_VT, {unit:"kJ/kg/K"}); }
for(const [p, T, v, h, cp] of [[0.0035, 300, 39.4913866, 2549.91145, 1.91300162], [0.0035, 700, 92.3015898, 3335.68375, 2.08141274],
    [30, 700, 5.42946619e-3, 2631.49474, 10.3505092]]){ const r = if97r2(p, T);
  check("test IF97 region 2 v(" + T + " K, " + p + " MPa)", r.v, v, VT, SRC_VT, {unit:"m3/kg"});
  check("test IF97 region 2 h(" + T + " K, " + p + " MPa)", r.h, h, VT, SRC_VT, {unit:"kJ/kg"});
  check("test IF97 region 2 cp(" + T + " K, " + p + " MPa)", r.cp, cp, VT, SRC_VT, {unit:"kJ/kg/K"}); }
for(const [rho, T, p, h, cp] of [[500, 650, 25.5837018, 1863.43019, 13.8935717], [200, 650, 22.2930643, 2375.12401, 44.6579342],
    [500, 750, 78.3095639, 2258.68845, 6.34165359]]){ const r = if97r3(rho, T);
  check("test IF97 region 3 p(" + T + " K, " + rho + " kg/m3)", r.p, p, VT, SRC_VT, {unit:"MPa"});
  check("test IF97 region 3 h(" + T + " K, " + rho + " kg/m3)", r.h, h, VT, SRC_VT, {unit:"kJ/kg"});
  check("test IF97 region 3 cp(" + T + " K, " + rho + " kg/m3)", r.cp, cp, VT, SRC_VT, {unit:"kJ/kg/K"});
  check("test IF97 region 3 rho(p, " + T + " K) root", if97pT(p, T).rho, rho, 1e-6, SRC_VT, {unit:"kg/m3"}); }
{ const T42 = [[0.5, 1500, 1.38455090, 5219.76855, 2.61609445], [30, 1500, 2.30761299e-2, 5167.23514, 2.72724317], [30, 2000, 3.11385219e-2, 6571.22604, 2.88569882]];
  const SRC5 = "IAPWS R7-97(2012) table 42, region 5", o = new Float64Array(3);
  const worst = () => { let e = 0; for(const [p, T, v, h, cp] of T42){ G.if97Steam(T, p, o); e = Math.max(e, Math.abs(o[0]/v - 1), Math.abs(o[1]/h - 1), Math.abs(o[2]/cp - 1)); } return e; };
  for(const [p, T, v, h, cp] of T42){ const r = if97r5(p, T);
    check("test IF97 region 5 v(" + T + " K, " + p + " MPa)", r.v, v, VT, SRC5, {unit:"m3/kg"});
    check("test IF97 region 5 h(" + T + " K, " + p + " MPa)", r.h, h, VT, SRC5, {unit:"kJ/kg"});
    check("test IF97 region 5 cp(" + T + " K, " + p + " MPa)", r.cp, cp, VT, SRC5, {unit:"kJ/kg/K"}); }
  check("the engine's steam (if97Steam) at table 42's three states, v, h and c_p, worst", worst(), 0, VT, SRC5, {abs:true, unit:"of the value"});
  inBundle("IF97_N5[2] = -IF97_N5[2]"); const eb = worst(); inBundle("IF97_N5[2] = -IF97_N5[2]");
  check("fault injected, region 5's third residual coefficient's sign flipped: the engine check fails", eb > VT ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"worst " + eb.toExponential(2)}); }
check("test IF97 B23 p(623.15 K)", pB23(623.15), 16.5291643, VT, SRC_VT, {unit:"MPa"});
check("test IF97 B23 T(16.5291643 MPa)", tB23(16.5291643), 623.15, VT, SRC_VT, {unit:"K"});

/* the model's h rides its own datum; the offset is read once at the triple point on the saturated line */
const door = n => { try { const f = G[n]; return typeof f === "function" ? f : null; } catch(e){ return null; } };
const hOfTP = door("hOfTP"), cpOfTP = door("cpOfTP"), wHpc = door("wHpc"), coolFig = door("coolFig");
const hOff = G.hOfT(W, 273.16) - if97(psat(273.16), 273.16).h;
const mix = new Float64Array(3);
const rhoPH = (p, h) => G.mixState(W, p, h + hOff, mix)[1];
const tPH = (p, h) => G.tOfH(W, p, h + hOff);
const hTP = (T, p) => hOfTP ? hOfTP(W, T, p) - hOff : NaN;
const cpTP = (T, p) => cpOfTP ? cpOfTP(W, T, p) : NaN;

const SRC_SW = "IAPWS-IF97 regions 1, 2, 3 at (p, T), the test's own implementation";
for(const p of [0.1, 1, 7, 15.5, 21, 22.064, 23, 25, 30, 50, 80]){
  const Ts = p < 22.064 ? tsat(p) : NaN;
  let wT = {e:0}, wR = {e:0}, wTb = {e:0}, wRb = {e:0};
  for(let T = 280; T <= 1000; T += 10){
    if(Math.abs(T - Ts) < 0.5) continue;
    const s = if97pT(p, T), band = Math.abs(p - 22.064) < 1 && Math.abs(T - 647.1) < 10;
    const eT = Math.abs(tPH(p, s.h) - T), eR = Math.abs(rhoPH(p, s.h)/s.rho - 1);
    const a = band ? wTb : wT, b = band ? wRb : wR;
    if(!(eT <= a.e)) Object.assign(a, {e:eT, T}); if(!(eR <= b.e)) Object.assign(b, {e:eR, T}); }
  const at = w => w.T !== undefined ? " worst at " + w.T + " K" : "";
  check("T(p, h) sweep at " + p + " MPa" + at(wT), wT.e, 0, 0.05, SRC_SW, {abs:true, unit:"K"});
  check("rho(p, h) sweep at " + p + " MPa" + at(wR), wR.e, 0, 0.002, SRC_SW, {abs:true, unit:"of rho"});
  if(wTb.T !== undefined){
    check("T(p, h) near critical at " + p + " MPa" + at(wTb), wTb.e, 0, 0.5, SRC_SW, {abs:true, unit:"K"});
    check("rho(p, h) near critical at " + p + " MPa" + at(wRb), wRb.e, 0, 0.03, SRC_SW, {abs:true, unit:"of rho"}); }
}

/* the store prices a node's compliance on this slope, so it is checked on its own: (1/rho)(drho/dp) at fixed h, liquid */
{ const io = new Float64Array(G.MX_N);
  for(const [p, T] of [[0.3, 310], [7, 550], [15.5, 583], [15.5, 610], [80, 300]]){
    const h = if97(p, T).h, d = p*1e-3, rho = q => 1/if97(q, TofH(q, h)).v;
    const kap = (rho(p + d) - rho(p - d))/(2*d*rho(p));
    io[G.MX_P] = p; io[G.MX_H] = h + hOff; G.kapA(W, io);
    check("liquid (1/rho) drho/dp at fixed h (" + T + " K, " + p + " MPa)", io[G.MX_KAP], kap, 0.05,
      "IAPWS-IF97 region 1, differenced along its own isenthalp", {unit:"1/MPa"}); } }
for(const [p, T, h] of [[3, 300, 115.331273], [80, 300, 184.142828], [3, 500, 975.542239]])
  check("h(" + T + " K, " + p + " MPa) liquid", hTP(T, p), h, 0.001, SRC_VT, {unit:"kJ/kg"});
for(const [p, T, cp] of [[3, 300, 4.17301218], [80, 300, 4.01008987], [3, 500, 4.65580682],
    [0.0035, 300, 1.91300162], [0.0035, 700, 2.08141274], [30, 700, 10.3505092]])
  check("cp(" + T + " K, " + p + " MPa)", cpTP(T, p), cp, 0.01, SRC_VT, {unit:"kJ/kg/K"});

/* a step in density where the table meets the dome is a step in the store */
for(const p of [0.1, 1, 7, 15.5, 20]){
  const Ts = G.satT(W, p), hf = G.satH(W, p), hg = G.satHg(W, p);
  check("rho just below h_f(" + p + " MPa) against rho_f", G.mixState(W, p, hf - 0.01, mix)[1], G.rhofOf(W, Ts), 0.005,
    "the dome's own saturated liquid density (IF97 at psat)", {unit:"kg/m3"});
  check("rho just above h_g(" + p + " MPa) against rho_g", G.mixState(W, p, hg + 0.01, mix)[1], G.rhogOf(W, Ts), 0.005,
    "the dome's own saturated vapour density (IF97 at psat)", {unit:"kg/m3"});
}

{ const p = 25, hpc = wHpc ? wHpc(p) : NaN;
  check("pseudo-critical T at 25 MPa (the table's c_p peak)", G.tOfH(W, p, hpc), 658, 1,
    "SCWR literature: c_p peak of IF97/IAPWS-95 at 25 MPa, 384.9 C; confidence medium", {abs:true, unit:"K"});
  const b0 = G.mixState(W, p, hpc - 1, mix)[2], b1 = G.mixState(W, p, hpc + 1, mix)[2];
  check("branch label 1 kJ/kg below the pseudo-critical enthalpy at 25 MPa", b0, 0, 0, "decision 3: liquid below h_pc", {abs:true, pass:b0 === 0 && hpc === hpc});
  check("branch label 1 kJ/kg above the pseudo-critical enthalpy at 25 MPa", b1, 2, 0, "decision 3: steam above h_pc", {abs:true, pass:b1 === 2 && hpc === hpc}); }

{ const T = 700, p = 0.0035, s = if97pT(p, T);
  check("rho(700 K, 0.0035 MPa) vapour", rhoPH(p, s.h), s.rho, 0.002, IF97 + " region 2", {unit:"kg/m3"});
  check("T(0.0035 MPa, h(700 K)) vapour", tPH(p, s.h), T, 0.05, IF97 + " region 2", {abs:true, unit:"K"}); }
check("rho(700 K, 30 MPa) supercritical", rhoPH(30, 2631.49474), 1/5.42946619e-3, 0.002, IF97 + " region 2", {unit:"kg/m3"});
for(const [T, rho, p, h] of [[650, 500, 25.5837018, 1863.43019], [650, 200, 22.2930643, 2375.12401]])
  check("rho(" + T + " K, " + p + " MPa) near critical", rhoPH(p, h), rho, 0.03, IF97 + " region 3", {unit:"kg/m3"});

/* every water coolant row's figures are IF97 at its own P0 and Tref, a boiling row's at its core inlet: nothing pinned */
for(const a of G.COOLANT.filter(a => a.tc === 647.096)){
  const Ts = tsat(a.P0), hf = if97(a.P0, Ts).h, f = coolFig ? coolFig(a) : {rho:NaN, tsat:NaN};
  const T = a.xOut == null ? Math.min(a.Tref, Ts) : TofH(a.P0, hf - a.xOut*(hf - if97(a.P0, G.feedTOf()).h));
  check(a.id + " coolant density at " + a.P0 + " MPa, " + T.toFixed(1) + " K", f.rho, 1/if97(a.P0, T).v, 0.005,
    SRC_VT + ", region 1 (saturated liquid past Ts; a boiling row at its inlet, feed mixed into the separated water)", {unit:"kg/m3"});
  check(a.id + " coolant saturation temperature at " + a.P0 + " MPa", f.tsat, Ts, 0.01, IF97 + " region 4", {abs:true, unit:"K"});
}

/* CO2 on its Shomate curve against NIST's own tabulated JANAF values, and density against NIST's fluid isobar */
{ const a = G.COOLANT.find(r => r.id === "CO2"), M = 0.0440095, C = G.satCurveFor(a, a.P0);
  const JANAF = "NIST WebBook CO2 (C124389), gas-phase JANAF table (Chase 1998)";
  const TAB = [[300, 37.22, 0.07], [400, 41.34, 4.00], [500, 44.61, 8.31], [600, 47.32, 12.91], [700, 49.57, 17.75], [800, 51.44, 22.81], [900, 53.00, 28.03], [1000, 54.30, 33.40]];
  const worst = c => { let e = 0; for(const [T, cp, H] of TAB){
    e = Math.max(e, Math.abs(G.cpOf(c, T)/(cp/M/1000) - 1));
    if(T > 300) e = Math.max(e, Math.abs((G.hOfT(c, T) - G.hOfT(c, 300))/((H - 0.07)/M) - 1)); } return e; };
  check("CO2 cp and h(T) - h(300 K) against NIST's table at 300-1000 K, worst", worst(C), 0, 0.005, JANAF, {abs:true, unit:"of the value"});
  const bad = Object.assign({}, C, {sho:C.sho.slice()}); bad.sho[2] *= 1.1; bad.shoH0 = 0; bad.shoH0 = G.hOfT(bad, 273.15);
  const eb = worst(bad);
  check("fault injected, Shomate B x 1.1: the CO2 check fails", eb > 0.005 ? 1 : 0, 1, 0, "the CO2 check above must be able to fail", {abs:true, note:"worst " + (eb*100).toFixed(1) + " %"});
  const ISO = "NIST WebBook fluid data, CO2 isobar at 0.7 MPa";
  for(const [T, rho] of [[400, 9.3821], [500, 7.4486], [600, 6.1867]])
    check("CO2 density at 0.7 MPa, " + T + " K", G.rhoMixOf(C, 0.7, G.hOfTP(C, T, 0.7)), rho, 0.01, ISO, {unit:"kg/m3", gap:"CO2 on Shomate and an ideal gas"});
  let e = 0; for(let T=300;T<=1000;T+=10) e = Math.max(e, Math.abs(G.tOfH(C, 0.7, G.hOfTP(C, T, 0.7)) - T));
  check("CO2 T(h(T)) round trip, 300-1000 K", e, 0, 1e-9, "identity: T -> h -> T", {abs:true, unit:"K"});
  const He = G.satCurveFor(G.COOLANT.find(r => r.id === "HTGR"), 7), HE = "NIST WebBook fluid data, helium isobar at 7 MPa: cp 5.1955, 5.1893, 5.1895 kJ/kg/K at 300, 600, 900 K";
  const heErr = c => [[300, 5.1955], [600, 5.1893], [900, 5.1895]].reduce((m, [T, cp]) => Math.max(m, Math.abs(G.cpOf(c, T)/cp - 1)), 0);
  check("helium cp against NIST at 300-900 K, worst", heErr(He), 0, 0.005, HE, {abs:true, unit:"of cp"});
  const heBad = heErr(Object.assign({}, He, {sho:C.sho, mmol:C.mmol, shoH0:C.shoH0}));
  check("fault injected, helium routed through the CO2 Shomate row: the helium check fails", heBad > 0.005 ? 1 : 0, 1, 0, "the helium check above must be able to fail", {abs:true});
  const hg = G.COOLANT.find(r => r.id === "HTGR"), HEG = "ideal-gas isentropic nozzle relation, NIST WebBook helium c_p 5.19 and c_v 3.12 kJ/kg/K at 7 MPa";
  const crit = g => Math.pow(2/(g + 1), g/(g - 1));
  check("helium gam on the HTGR row", hg.gam, 5/3, 0.01, HEG, {unit:"-"});
  check("helium critical pressure ratio on its own gam", crit(G.satCurveFor(hg, hg.P0).gam), 0.4867, 0.01, HEG, {unit:"p/p0"});
  const hgBad = crit(G.GAM_VAP);
  check("fault injected, helium choked on GAM_VAP: the ratio check fails", Math.abs(hgBad/0.4867 - 1) > 0.01 ? 1 : 0, 1, 0, "the helium gam checks above must be able to fail", {abs:true, note:"reads " + hgBad.toFixed(4)}); }

/* IAPWS R1-76 surface tension, and the drift velocity the void correlation reads off it */
{ const W = G.SAT_WATER, io = new Float64Array(2);
  const sig = T => { io[0] = T; G.sigmaA(W, io, 0, 1); return io[1]; };
  const R176 = "IAPWS R1-76 (2014 revision) surface tension of ordinary water, table 1";
  for(const [T, s] of [[298.15, 71.97], [373.15, 58.91], [473.15, 37.67], [573.15, 14.36]])
    check("surface tension of water at " + T + " K", sig(T)*1000, s, 0.01, R176, {unit:"mN/m"});
  check("surface tension is zero at the critical point", sig(G.WATER_TC), 0, 1e-12,
    "a surface tension vanishes where the two phases become one", {abs:true, unit:"N/m"});
  check("fault injected, the IAPWS exponent 10 % off: the 473 K check fails",
    Math.abs(0.2358*Math.pow(1 - 473.15/G.WATER_TC, 1.256*1.1)*(1 - 0.625*(1 - 473.15/G.WATER_TC))*1000/37.67 - 1) > 0.01 ? 1 : 0, 1, 0,
    "the surface tension checks above must be able to fail", {abs:true});
  /* the rod bundle's drift velocity: Zuber-Findlay's form, its coefficient a FIT to the THTF bundle's swell (level.js swell grades that behaviour) */
  const Ts = tsat(7), rf = 1/if97(7, Ts).v, rg = 1/if97r2(7, Ts).v, rv = G.E_RV, churn = 1.53*Math.pow(sig(Ts)*9.80665*(rf - rg)/(rf*rf), 0.25);
  rv[2] = rg; rv[3] = rf; rv[4] = Ts; G.eVgjA(G.SAT_WATER);
  check("rod-bundle drift velocity of steam in water at 7 MPa, engine against the form by hand",
    rv[4], 2.9*Math.pow(sig(Ts)*9.80665*(rf - rg)/(rf*rf), 0.25), 1e-3,
    "Zuber & Findlay (1965) J. Heat Transfer 87:453: V_gj = K (sigma g (rho_f - rho_g)/rho_f^2)^0.25, K 1.53 churn-turbulent in pipes (~0.18 m/s near 7 MPa); K 2.9 a FIT to Anklam & White's bundle swell, CONF-810806-8 eq. 6",
    {unit:"m/s", note:"churn-turbulent " + churn.toFixed(3) + " m/s; sigma " + (sig(Ts)*1000).toFixed(2) + " mN/m, rho_f " + rf.toFixed(1) + ", rho_g " + rg.toFixed(2)}); }
