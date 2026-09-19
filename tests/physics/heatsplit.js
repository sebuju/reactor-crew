"use strict";
/* fission heat that never enters the pin: the law on published cells typed here, not on the drawn presets; its data against NIST and the fission table */
const {check, load, if97, FIS} = require("./lib.js");
const G = load();
const ROW = "heat deposited outside the fuel";
const NIST = "Hubbell & Seltzer, NISTIR 5632, mu_en/rho at 1 MeV";

/* NIST mu_en/rho cm2/g at 1 MeV and IUPAC g/mol, typed a second time */
const MU = {H:0.05556, He:0.02797, Li:0.02419, Be:0.02483, C:0.02792, O:0.02794, F:0.02645, Na:0.02669, Mg:0.02753, Zr:0.02547, U:0.04241};
const AM = {H:1.008, He:4.0026, Li:6.94, Be:9.0122, C:12.011, O:15.999, F:18.998, Na:22.990, Mg:24.305, Zr:91.224, U:238.03};
const mix = f => { let m = 0, s = 0; for(const e in f){ m += f[e]*AM[e]; s += f[e]*AM[e]*MU[e]; } return s/m; };
const uzZr = 0.1/91.224/(0.1/91.224 + 0.9/238.03);
const WANT = [
  ["COOLANT", "PWR", {H:2, O:1}], ["COOLANT", "BWR", {H:2, O:1}], ["COOLANT", "LWGR", {H:2, O:1}], ["COOLANT", "SFR", {Na:1}],
  ["COOLANT", "MSR", {Li:2, Be:1, F:4}], ["COOLANT", "HTGR", {He:1}], ["COOLANT", "CO2", {C:1, O:2}],
  ["MODER", "GRAPHITE", {C:1}], ["MODER", "BERYLLIUM OXIDE", {Be:1, O:1}], ["MODER", "ZIRCONIUM HYDRIDE", {Zr:1, H:1.6}],
  ["FUEL", "UO2  3.2% LEU", {U:1, O:2}], ["FUEL", "UO2  4.9% LEU", {U:1, O:2}], ["FUEL", "UO2 19.7% HEU", {U:1, O:2}], ["FUEL", "MOX PLUTONIUM", {U:1, O:2}],
  ["FUEL", "U-ZR METALLIC", {U:1 - uzZr, Zr:uzZr}], ["FUEL", "U METAL NATURAL", {U:1}],
  ["CLAD", "ZIRCALOY", {Zr:1}], ["CLAD", "MAGNOX AL80", {Mg:1}]];
let worstBad = 0;
for(const [t, id, f] of WANT){
  const row = G[t].find(r => (r.id || r.name) === id), want = mix(f);
  check(t + " " + id + ": mu_en/rho at 1 MeV", row.muen, want, 0.01, NIST + ", mass-weighted over " + JSON.stringify(f), {unit:"cm2/g"});
  worstBad = Math.max(worstBad, Math.abs(row.muen*(id === "GRAPHITE" ? 1.1 : 1)/want - 1)); }
check("fault injected, graphite's mu_en x 1.1: the mu_en checks fail", worstBad > 0.01 ? 1 : 0, 1, 0, "the mu_en checks above must be able to fail", {abs:true, note:"worst " + (worstBad*100).toFixed(1) + " %"});

const LAM = "Lamarsh (1975), Introduction to Nuclear Engineering, via INL/EXT-13-29256 Table 1: fragments 168, neutrons 5, prompt gamma 7, capture gamma 3-12 (7.5), delayed beta 8, delayed gamma 7 MeV";
check("FIS_FN: neutron kinetic energy over the prompt recoverable energy", G.FIS_FN, FIS.fn, 0, LAM, {abs:true});
check("FIS_FGP: prompt and capture gamma over the prompt recoverable energy", G.FIS_FGP, FIS.fgp, 0, LAM, {abs:true});
check("FIS_FGD: delayed gamma over delayed beta and gamma", G.FIS_FGD, FIS.fgd, 0, LAM, {abs:true});

/* one cell per unit height, areas mm2 and densities g/cm3: the law's own weights */
const law = (cell, a, faultW, faultB, faultN) => { const io = new Float64Array(10);
  io[0] = cell.fuel*cell.rhoF*mix({U:1, O:2}) + cell.clad*6.56*MU.Zr;
  io[1] = faultW ? 0 : cell.water*cell.rhoW*mix({H:2, O:1});
  io[2] = faultB ? 0 : cell.block*1.70*MU.C;
  io[3] = faultN ? 0 : cell.water*1.00; io[4] = faultN ? 0 : cell.block*0.95; io[5] = a;
  G.heatSplitA(io);
  const p = G.PROMPT_F;
  return {water:p*io[6] + (1 - p)*io[8], block:p*io[7] + (1 - p)*io[9]}; };
const disc = d => Math.PI/4*d*d;

/* Westinghouse 17x17: pitch 12.6, rod 9.50, clad 0.572, pellet 8.19 mm (the figures the stock rod carries; the DCD sheet not re-read here), UO2 10.4 g/cm3, water IF97 at 15.5 MPa, 580 K */
const pwr = {fuel:disc(8.19), clad:disc(9.50) - disc(9.50 - 2*0.572), water:12.6*12.6 - disc(9.50), block:0, rhoF:10.4, rhoW:1/if97(15.5, 580).v/1000};
const PWR_REAL = 1 - 0.974, pw = law(pwr, 0), pwBad = law(pwr, 0, false, false, true), pwNoG = law(pwr, 0, true);
const AP = "AP1000 DCD Rev. 19, Table 4.4-1 (NRC ML11171A446): heat generated in fuel 97.4 %";
check("PWR 17x17 cell at zero void: heat outside the fuel", pw.water + pw.block, PWR_REAL, 0.3, AP, {unit:"of core heat", gap:ROW,
  note:"in fuel " + ((1 - pw.water - pw.block)*100).toFixed(2) + " %, water " + (pwr.rhoW*1000).toFixed(0) + " kg/m3"});
check("PWR fault injected, the neutrons' energy left in the pin: the cell check fails", Math.abs((pwBad.water + pwBad.block)/PWR_REAL - 1) > 0.3 ? 1 : 0, 1, 0,
  "the cell check above must be able to fail", {abs:true, note:"outside " + ((pwBad.water + pwBad.block)*100).toFixed(2) + " %; with no gamma to the water instead it reads " + ((pwNoG.water + pwNoG.block)*100).toFixed(2) + " %, inside the 30 %: the cell figure cannot see the gamma term"});

/* a GE 8x8 cell: pitch 16.26, rod 12.27, clad 0.813, pellet 10.57 mm, at 40 % core-average void; geometry and void from memory, not a read source */
const bwr = {fuel:disc(10.57), clad:disc(12.27) - disc(12.27 - 2*0.813), water:16.26*16.26 - disc(12.27), block:0, rhoF:10.4, rhoW:1/if97(7.0, 550).v/1000};
const bw = law(bwr, 0.4);
check("BWR 8x8 cell at 40 % void: heat outside the fuel", bw.water + bw.block, 0.04, 0.3,
  "~96 % in fuel for a BWR: no FSAR Table 4.4-1 or GESTAR figure found (20/09/26), source unconfirmed", {unit:"of core heat", pass:false, gap:ROW,
    note:"in fuel " + ((1 - bw.water - bw.block)*100).toFixed(2) + " %"});

/* RBMK-1000 cell: 250 mm graphite column with its 114 mm bore (rings and the Zr-Nb tube left out), 18 rods of 13.6 mm, clad 0.9, pellet 11.5 mm, in an 80 mm channel (the commonly quoted figures, no sheet re-read here); water at 7 MPa, 557 K */
const rbmk = {fuel:18*disc(11.5), clad:18*(disc(13.6) - disc(13.6 - 2*0.9)), water:disc(80) - 18*disc(13.6), block:250*250 - disc(114), rhoF:10.4, rhoW:1/if97(7.0, 557).v/1000};
const INSAG = "INSAG-7: ~5.5 % of an RBMK-1000's heat is stopped in the graphite";
for(const a of [0, 0.5]){
  const rb = law(rbmk, a);
  check("RBMK-1000 cell at " + a*100 + " % void: heat in the graphite", rb.block, 0.055, 0.3, INSAG, {unit:"of core heat", gap:ROW,
    note:"in fuel " + ((1 - rb.water - rb.block)*100).toFixed(2) + " %, water " + (rb.water*100).toFixed(2) + " %"}); }
const rbBad = law(rbmk, 0, false, true);
check("RBMK fault injected, the graphite's mu_en zero: the graphite check fails", Math.abs(rbBad.block/0.055 - 1) > 0.3 ? 1 : 0, 1, 0,
  "the graphite check above must be able to fail", {abs:true, note:"graphite " + (rbBad.block*100).toFixed(2) + " %"});
