"use strict";
/* each FUEL row's excess against a published hot, fresh, unpoisoned k-inf at its reference preset's own lattice */
const {check, load} = require("./lib.js");
const G = load();
const rho = k => 1e5*(1 - 1/k);
const UAM = "OECD UAM exercise I-1 (Mercatali, Ivanov & Sanchez, Sci. Tech. Nucl. Install. 2013, Table 7, Serpent ENDF/B-VII)";
const at = (pre, fuel) => { G.plantPreset(pre); G.buildLayout(); const c = G.priD();
  if(fuel) c.fuel = G.FUEL.findIndex(f => f.name === fuel);
  const mr = G.modRatio(c);
  return {c, rinf:G.fuelBlend(c).excess*G.modK(mr, G.modTherm(mr)) - G.cladAbsOf(c, G.modTherm(mr))*G.modClad(c)}; };
const REF = [
  [0, "UO2 4.9 %", () => rho(1.41401), UAM + ": TMI-1 4.85 % pin cell at HFP, k-inf 1.41401"],
  [2, "UO2 3.2 %", c => rho(1.34691) + G.COOLANT[c.cool].aF*G.pinDTf(c), UAM + ": Peach Bottom-2 2.93 % pin cell at HZP, 0 % void, k-inf 1.34691, carried to full power on the row's aF over its pellet rise"],
  [7, "U METAL NATURAL", () => 6218, "Calder Hall zone k-inf, volume mean at 425 C fuel (Nuclear Engineering, Dec. 1956)"],
  [6, "MSRE FUEL SALT", () => 23696, "ORNL-TM-730 Tables 3.5/3.6: clean critical at 1200 F, rods out, 23696 of 1e5 neutrons leak"],
  [3, "UO2 19.7 %", () => rho(1.31856), "Lukyan et al., AtomFuture-2017, KnE Engineering, Table 2: a fresh BN-600 26 % UO2 assembly, k-inf 1.31856, temperature unstated"],
  [3, "U-ZR METALLIC", () => rho(1.35878), "Bostelmann et al., SCALE/AMPX SFR libraries, Table 4: UAM-SFR MET1000 pin cell at end of equilibrium cycle, k-inf 1.35878", "U-ZR METALLIC"],
  [0, "MOX PLUTONIUM", () => rho(1.2430), "NEA/NSC/DOC(2002)10 Table C.2: VVER-1000 MOXGD assembly, state S4 (575 K, 0 ppm, no Xe), MCNP4B 1.2430 of 1.2334-1.2483", "MOX PLUTONIUM"]];
for(const [pre, row, truth, src, swap] of REF){
  const {c, rinf} = at(pre, swap), name = G.PLANTPRE[pre][0] + (swap ? " lattice" : "");
  check(name + ": " + row + " row, the lattice's hot rho-inf", rinf, truth(c), 1, src + "; tolerance the row's 1 pcm rounding", {abs:true, unit:"pcm"});
  if(pre === 0 && !swap){ const f = G.FUEL[c.fuel], e0 = f.excess; f.excess = e0*1.2; const bad = at(0).rinf; f.excess = e0;
    check(name + ": fault injected, the row's excess 20 % high: the rho-inf check fails", Math.abs(bad - truth(c)) > 1 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"rho-inf moved to " + bad.toFixed(0) + " pcm"}); }
}
{ const {rinf} = at(5), k = 1e5/(1e5 - rinf);
  check("RBMK-1000: its lattice k-inf on the UO2 3.2 % row, hot, against published fresh RBMK cells", k, 1.30, 0,
    "Parisi & D'Auria, NENE 2007, Tables 1 and 4: single RBMK channel cells at 2.0-2.4 %, cold (300 K), 1.2286 (2.0 % wet, MCNP5/ENDL) to 1.3699 (2.4 % voided, MCNP4C/ENDF-B)",
    {pass:k >= 1.2286 && k <= 1.3699, gap:"moderation curve level", note:"the row is 3.2 % and hot; the band is cold at 2.0-2.4 %"}); }
/* the lattice's hot rho-inf at burnup b, through the rest book with no leak */
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
  const r1 = rinfAt(c, b1), mk = G.modK(G.modRatio(c), G.modTherm(G.modRatio(c)));
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
  check("RBMK-1000: rho-inf lost from 2 to 20 MWd/kgHM on the UO2 3.2 % row against a published RBMK channel cell", drop, rho(1.2392) - rho(0.9347), 0,
    "Maucec, Ravnik & Glumac, Nuclear Energy in Central Europe 1997, Table 2: WIMS/D-5 RBMK cell, water 0.7 g/cm3; band the same cell at 0.5 to 1.0 g/cm3; enrichment unstated (Chernobyl-4 2.0 %, INSAG-7)",
    {pass:drop >= lo && drop <= hi, unit:"pcm", gap:"the fuel excess", note:"band " + lo.toFixed(0) + " to " + hi.toFixed(0)}); }
for(const pre of [0, 2, 5]){
  const {c} = at(pre), d = G.derived(), a = G.COOLANT[c.cool], f0 = G.restBook(c, d.leak, 0), need = f0.excess - f0.xeW - f0.smW;
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
