"use strict";
// chunks: ref burn rest
/* each FUEL row's published hot, fresh, unpoisoned k-inf, taken on its reference drawing by the lattice law */
const {check, load} = require("./lib.js");
const G = load();
const mode = process.argv[2];
const rho = k => 1e5*(1 - 1/k);
const UAM = "OECD UAM exercise I-1 (Mercatali, Ivanov & Sanchez, Sci. Tech. Nucl. Install. 2013, Table 7, Serpent ENDF/B-VII)";
const at = (pre, fuel) => { G.plantPreset(pre); G.buildLayout(); const c = G.priD();
  if(fuel){ c.fuel = G.FUEL.findIndex(f => f.name === fuel); c.zoneFuel = {}; G.latRevolve(c); }
  return {c, rinf:G.latRhoInf(c, 0)}; };
const REF = [
  [0, "UO2 4.9 %", () => rho(1.41401), UAM + ": TMI-1 4.85 % pin cell at HFP, k-inf 1.41401"],
  [7, "U METAL NATURAL", () => 6218, "Calder Hall zone k-inf, volume mean at 425 C fuel (Nuclear Engineering, Dec. 1956)"],
  [6, "MSRE FUEL SALT", () => 23696, "ORNL-TM-730 Tables 3.5/3.6: clean critical at 1200 F, rods out, 23696 of 1e5 neutrons leak"],
  [3, "UO2 19.7 %", () => rho(1.31856), "Lukyan et al., AtomFuture-2017, KnE Engineering, Table 2: a fresh BN-600 26 % UO2 assembly, k-inf 1.31856, temperature unstated"],
  [3, "U-ZR METALLIC", () => rho(1.35878), "Bostelmann et al., SCALE/AMPX SFR libraries, Table 4: UAM-SFR MET1000 pin cell at end of equilibrium cycle, k-inf 1.35878", "U-ZR METALLIC"]];
if(mode === "ref"){
for(const [pre, row, truth, src, swap] of REF){
  const {c, rinf} = at(pre, swap), name = G.PLANTPRE[pre][0] + (swap ? " lattice" : "");
  const rT = pre === 7 ? G.rhoOfK(G.kInfOf(c, {Tf:698.15})) : rinf;
  check(name + ": " + row + " row, the lattice's hot rho-inf at the anchor's fuel temperature", rT, truth(c), 5, src + "; tolerance the rest fuel temperature, which follows the drawing's own rating", {abs:true, unit:"pcm"});
  if(pre === 0 && !swap){ const f = G.FUEL[c.fuel], k0 = f.kInf; f.kInf = k0*1.02; const bad = at(0).rinf; f.kInf = k0;
    check(name + ": fault injected, the row's k-inf 2 % high: the rho-inf check fails", Math.abs(bad - truth(c)) > 5 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"rho-inf moved to " + bad.toFixed(0) + " pcm"}); }
}
/* the two rows anchored at zero power: the law's own Doppler carries them to their drawing's rest */
{ const {c, rinf} = at(2), a = G.COOLANT[c.cool], cold = G.kInfOf(c, {Tf:Math.min(a.Tref, G.coolTsat(a, a.P0))});
  check("BWR/4: UO2 3.2 % row at zero power, the law against its anchor", rho(cold), rho(1.34691), 1e-6, UAM + ": Peach Bottom-2 2.93 % pin cell at HZP, 0 % void, k-inf 1.34691", {abs:true, unit:"pcm",
    note:"at its own rest " + rinf.toFixed(0) + " pcm"}); }
{ const {c} = at(0, "MOX PLUTONIUM"), a = G.COOLANT[c.cool], cold = G.kInfOf(c, {Tf:Math.min(a.Tref, G.coolTsat(a, a.P0))});
  check("STOCK PWR lattice: MOX row at zero power, the law against its anchor", rho(cold), rho(1.2430), 1e-6,
    "NEA/NSC/DOC(2002)10 Table C.2: VVER-1000 MOXGD assembly, state S4 (575 K, 0 ppm, no Xe), MCNP4B 1.2430 of 1.2334-1.2483", {abs:true, unit:"pcm"}); }
{ G.plantPreset(0); G.buildLayout(); const c = G.priD(); G.archPreset(c, 2);
  const F = G.FUEL[c.fuel], P = "Parisi & D'Auria, NENE 2007, Tables 1 and 4: single RBMK channel cells, cold (300 K)";
  const st = G.lawRefState(c, F.ref), k0 = G.kInfOf(c, st);
  check("RBMK drawing: its row's anchor, a 2.0 % channel cell cold and wet", k0, 1.2286, 1e-9, P + ", MCNP5/ENDL 1.2286", {unit:"k-inf"});
  const e0 = F.enr; F.enr = 0.024; const k1 = G.kInfOf(c, Object.assign({}, st, {al:1})); F.enr = e0;
  check("RBMK drawing: the same cell at 2.4 %, its channel voided, predicted", k1, 1.3699, 0.03, P + ", MCNP4C/ENDF-B 1.3699; not fitted: enrichment and void both carried by the law; tolerance the codes' own spread at 2.0 % wet, 1.2286-1.26 (as quoted)",
    {unit:"k-inf", note:"voiding alone at 2.0 % " + ((G.kInfOf(c, Object.assign({}, st, {al:1}))/k0 - 1)*1e5).toFixed(0) + " pcm"}); }
}
if(mode === "burn"){
const rinfAt = (c, b) => G.restBook(c, 0, b).excess + c.poison;
const PARK = "Park, Shim & Kim, UAM I-1b TMI-1 4.85 % pin cell, McCARD, 0 ppm, HFP (STNI 2012, 616253, Table 2)";
const PARKPTS = [[2,1.34292],[4,1.31499],[6,1.28805],[8,1.26320],[10,1.23924],[12,1.21683],[14,1.19584],[16,1.17646],[18,1.15745],[20,1.13972],[30,1.05605],[40,0.98051]];
const chordDev = (pts, b1, b2) => { const p = new Map(pts), s = (rho(p.get(b1)) - rho(p.get(b2)))/(b2 - b1);
  return Math.max(...pts.filter(([b]) => b >= b1 && b <= b2).map(([b, k]) => Math.abs(rho(k) - (rho(p.get(b1)) - s*(b - b1))))); };
const BURN = [
  [0, "UO2 4.9 %", null, PARKPTS, 2, 40, [10, 20, 30], () => chordDev(PARKPTS, 2, 40), PARK + "; tolerance the curve's own largest departure from its chord between the fit points"],
  [2, "UO2 3.2 %", null, [[20,1.116],[30,1.024],[40,0.939]], 20, 40, [30], k => 1e5*0.02/(k*k),
    "NEA Phase IIIB BWR 8x8 lattice, 40 % void, participants' mean, 3.8 % mean enrichment, Gd burnt out past ~12 (NEA/NSC/DOC(2002)2, Table 4.14); tolerance the participants' stated +/-2 %k spread"],
  [0, "MOX PLUTONIUM", "MOX PLUTONIUM", [[20,1.10424],[40,0.98622]], 20, 40, [], null,
    "VVER-1000 MOXGD assembly, state S4 (575 K, 0 ppm, no Xe), five codes' mean (NEA/NSC/DOC(2002)10, Table C.2)"]];
for(const [pre, row, swap, pts, b1, b2, third, tol, src] of BURN){
  const {c} = at(pre, swap), name = G.PLANTPRE[pre][0] + (swap ? " lattice" : ""), p = new Map(pts), f = G.FUEL[c.fuel];
  const r1 = rinfAt(c, b1), mk = G.modKOf(c);
  check(name + ": " + row + " row, rho-inf lost from " + b1 + " to " + b2 + " MWd/kgHM (the fit points)", r1 - rinfAt(c, b2), rho(p.get(b1)) - rho(p.get(b2)),
    0.05*(b2 - b1)*mk, src + "; identity, tolerance the row's 0.1 pcm rounding of burnK", {abs:true, unit:"pcm"});
  for(const b of third)
    check(name + ": " + row + " row, rho-inf lost from " + b1 + " to " + b + " MWd/kgHM (not fitted)", r1 - rinfAt(c, b), rho(p.get(b1)) - rho(p.get(b)),
      tol(p.get(b)), src, {abs:true, unit:"pcm"});
  { const k0 = f.burnK, b = third.length ? third[0] : b2; f.burnK = k0*1.2; const bad = r1 - rinfAt(c, b); f.burnK = k0;
    const truth = rho(p.get(b1)) - rho(p.get(b)), t = third.length ? tol(p.get(b)) : 0.05*(b2 - b1)*mk;
    check(name + ": fault injected, burnK 20 % high: the burnt check fails", Math.abs(bad - truth) > t ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"drop moved to " + bad.toFixed(0) + " pcm against " + truth.toFixed(0)}); }
}
for(const [pre, swap] of [[0], [2], [0, "MOX PLUTONIUM"]]){
  const {c} = at(pre, swap), f = G.FUEL[c.fuel], r0 = rinfAt(c, 0), rb = rinfAt(c, f.bu);
  check(G.PLANTPRE[pre][0] + ": " + f.name.trim() + " row, rho-inf at its discharge burnup below fresh", rb - r0, 0, 0,
    "a thermal lattice with conversion ratio below 1 loses reactivity as it burns (every source above)", {pass:rb < r0, unit:"pcm"});
}
{ const {c} = at(5), drop = rinfAt(c, 2) - rinfAt(c, 20), lo = rho(1.2433) - rho(0.9476), hi = rho(1.2299) - rho(0.9135);
  check("RBMK-1000: rho-inf lost from 2 to 20 MWd/kgHM on its UO2 2.0 % row against a published RBMK channel cell", drop, rho(1.2392) - rho(0.9347), 0,
    "Maucec, Ravnik & Glumac, Nuclear Energy in Central Europe 1997, Table 2: WIMS/D-5 RBMK cell, water 0.7 g/cm3; band the same cell at 0.5 to 1.0 g/cm3; enrichment unstated (Chernobyl-4 2.0 %, INSAG-7)",
    {pass:drop >= lo && drop <= hi, unit:"pcm", note:"the row's burnK is fitted on the 0.7 g/cm3 cell; band " + lo.toFixed(0) + " to " + hi.toFixed(0)}); }
}
if(mode === "rest"){
for(const pre of [0, 2, 5]){
  const {c} = at(pre), d = G.derived(), a = G.COOLANT[c.cool], xb = G.xeBook(c, d.leak, d.bu), need = G.latRhoInf(c, 0) - c.poison - d.leak - xb.xeW - xb.smW;
  const rest = d.excess - d.xeW - d.smW, law = a.batch ? "1/(n+1) of the fresh rest excess, n = " + a.batch : "the operating margin, " + a.orm + " pcm";
  check(G.PLANTPRE[pre][0] + ": rest excess at its default burnup (" + d.bu.toFixed(2) + " MWd/kgHM) is " + law, rest, G.restCarry(c, need), 0.1,
    "linear reactivity model (Driscoll, Downar & Pilat 1990, as commonly quoted, not read at source): mid-cycle, n batches carry 1/(n+1) of what a fresh core carries; tolerance the fixed point's convergence",
    {abs:true, unit:"pcm"});
  if(a.batch){ a.batch += 1; const bad = G.restCarry(c, need); a.batch -= 1;
    check(G.PLANTPRE[pre][0] + ": fault injected, one batch more: the check above fails", Math.abs(rest - bad) > 0.1 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true}); }
}
check("the chemical system's reach, pcm", G.BORON_MAX, 2700*6.9, 0,
  "AP1000 DCD Rev. 16 Table 4.3-2: 2700 ppm refuelling boron at -6.9 to -10.5 pcm/ppm best estimate",
  {pass:G.BORON_MAX >= 2700*6.9 && G.BORON_MAX <= 2700*10.5, unit:"pcm"});
}
