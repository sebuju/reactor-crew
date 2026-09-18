"use strict";
const {load, check} = require("./lib.js");
const G = load();
const IF97 = "IAPWS-IF97 (2007 revision) verification tables and saturation table";
const GAP_H = "Compressed-liquid water enthalpy", GAP_K = "Liquid water compressibility",
      GAP_SC = "Water above the critical point", GAP_V = "Superheated steam heat capacity";

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

const mix = new Float64Array(3);
const rhoPT = (p, T) => G.mixState(W, p, G.hOfT(W, T), mix)[1];
const h0 = G.hOfT(W, 273.16);
for(const [T, p, rho, h] of [[300, 3, 997.85, 115.331], [300, 80, 1029.67, 184.143], [500, 3, 831.66, 975.542]]){
  check("rho(" + T + " K, " + p + " MPa) liquid", rhoPT(p, T), rho, 0.02, IF97 + " region 1", {unit:"kg/m3", gap:GAP_K});
  check("h-h(273.16 K)(" + T + " K, " + p + " MPa) liquid", G.hOfT(W, T) - h0, h, 0.03, IF97 + " region 1", {unit:"kJ/kg", gap:GAP_H});
}
{ const T = 700, p = 0.0035, v = 92.3015898, h = 3335.68375, Ts = G.satT(W, p), hg = G.hOfT(W, Ts) + G.hfgOf(W, Ts);
  let lo = hg, hi = hg + 5000; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(G.tOfH(W, p, m) < T) lo = m; else hi = m; }
  const hv = (lo + hi)/2;
  check("rho(700 K, 0.0035 MPa) vapour", G.mixState(W, p, hv, mix)[1], 1/v, 0.05, IF97 + " region 2", {unit:"kg/m3", gap:GAP_V});
  check("h-h(273.16 K)(700 K, 0.0035 MPa) vapour", hv - h0, h, 0.03, IF97 + " region 2", {unit:"kJ/kg", gap:GAP_V}); }
{ const T = 700, p = 30, v = 0.00542946619, h = 2631.49474;
  check("rho(700 K, 30 MPa) supercritical", G.mixState(W, p, h + h0, mix)[1], 1/v, 0.05, IF97 + " region 2", {unit:"kg/m3", gap:GAP_SC}); }
for(const [T, rho, p, h] of [[650, 500, 25.5837018, 1863.43019], [650, 200, 22.2930643, 2375.12401]])
  check("rho(" + T + " K, " + p + " MPa) near critical", G.mixState(W, p, h + h0, mix)[1], rho, 0.10, IF97 + " region 3", {unit:"kg/m3", gap:GAP_SC});
