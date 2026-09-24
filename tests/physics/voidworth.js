"use strict";
/* each family's void worth off the moderation law (lawVoidOf()), the slope at its rest point, against what is published for its family */
const {check, load} = require("./lib.js");
const G = load();

const at = pre => { G.plantPreset(pre); G.buildLayout(); const c = G.priD(), d = G.derived(); return {c, d, aV:d.aV}; };
const arch = ai => { G.plantPreset(0); const c = G.priD(); G.archPreset(c, ai); G.buildLayout(); return {c, aV:G.derived().aV}; };
const pre = nm => G.PLANTPRE.findIndex(r => r[0] === nm);
const ROW = "the void worth off the moderation law";

const pwr = at(pre("STOCK PWR"));
check("STOCK PWR: void worth, pcm per unit void", pwr.aV, -10000, 0, "a PWR's void coefficient is of the order of -100 pcm per % void (nuclear-power.com, secondary, read 24/09/26); 'of the order' taken as a factor of 2",
  {pass:pwr.aV < -5000 && pwr.aV > -20000, unit:"pcm", gap:ROW, note:"at " + pwr.d.ppm.toFixed(0) + " ppm"});
{ const H = G.NUC.H.ss; G.NUC.H.ss = H*4; const f = G.lawVoidOf(pwr.c, pwr.d.ppm); G.NUC.H.ss = H;
  check("fault injected, hydrogen scattering x4 (an over-moderated water lattice): the PWR check fails", f < -5000 && f > -20000 ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:"void worth moved to " + f.toFixed(0) + " pcm"}); }

const bwr = at(pre("BWR/4")), GE = "USNRC HRTD, GE BWR/4 Technology Manual ch. 1.7 (Rev 09/11), sec. 1.7.3.1.2 and 1.7.3.2 (read 24/09/26)";
check("BWR/4: void worth, pcm per unit void", bwr.aV, -10000, 0,
  GE + ": 'a typical value of V = -1 x 10-3 K/K per 1% increase in void volume'; 'typical' taken as a factor of 2",
  {pass:bwr.aV < -5000 && bwr.aV > -20000, unit:"pcm", gap:"void coefficient, BWR"});
{ const slope = al => 1e5*Math.log(G.latLawCalc(bwr.c, {al:al + 0.05}).k/G.latLawCalc(bwr.c, {al:al - 0.05}).k)/0.1, lo = slope(0.1), hi = slope(0.4);
  check("BWR/4: the void coefficient grows more negative with void", hi - lo, 0, 0,
    GE + ", Figure 1.7-5: 'the negative reactivity contribution at higher voids is greater than at lower void fractions'",
    {pass:hi < lo, unit:"pcm", note:"slope at 10 % " + lo.toFixed(0) + ", at 40 % " + hi.toFixed(0)}); }

const rbmk = at(pre("RBMK-1000"));
check("RBMK-1000: void worth, pcm per unit void", rbmk.aV, 2150, 0,
  "pre-1986 RBMK-1000: +4.5 beta_eff of full-core void (INSAG-7 annex I) at beta_eff 0.0048-0.0051 is +2160 to +2300 pcm; INSAG-7 table II-I +2.0e-4 per % void is +2000: the band 2000-2300",
  {pass:rbmk.aV >= 2000 && rbmk.aV <= 2300, unit:"pcm", gap:ROW});

const bn = at(pre("BN-600"));
check("BN-600: sodium void worth, pcm per unit void", bn.aV, 700, 0,
  "a sodium fast lattice gains on voiding through its spectrum: BN-600 about +700 pcm (IAEA-TECDOC-1531 BN-600 benchmark, as the row carries it); taken as positive and within a factor of 2",
  {pass:bn.aV > 350 && bn.aV < 1400, unit:"pcm", gap:ROW});

const msre = at(pre("MSRE"));
{ const MS = "a void in a dissolved fuel takes the fuel out with the salt: 'during MSRE operations, a 1% change in density would cause a 0.18% ... change in reactivity for 235U' (Taylor, Salko, Graham, Collins & Maldonado, VERA two-phase gas transport for MSR analysis, OSTI 1831699, read; secondary)";
  const law = G.lawVoidOf(msre.c, 0, msre.d.bu);
  check("MSRE: the law's fuel-salt void worth, sign", law, -18000, 0, MS, {pass:law < 0, unit:"pcm", gap:ROW});
  check("MSRE: the term the core runs on, stood down to the published worth", msre.aV - G.REFL[msre.c.refl].dV, -18000, 1e-9,
    MS + "; the stop rule: a family whose sign the law gets wrong keeps a stated figure", {unit:"pcm"}); }

const cal = at(pre("CALDER HALL"));
check("CALDER HALL: CO2 void worth off its lattice, magnitude", G.lawVoidOf(cal.c, 0), 0, 100,
  "CO2 at 0.8 MPa is under 1 % of water's density: it moderates and absorbs almost nothing, so voiding it is worth next to nothing",
  {abs:true, unit:"pcm", gap:ROW, note:"the reflector's typed shift on top: " + G.REFL[cal.c.refl].dV + " pcm"});
{ const cf = G.coolFig(G.COOLANT[cal.c.cool]), r = cf.rho; cf.rho = r*100; const f = G.lawVoidOf(cal.c, 0); cf.rho = r;
  check("fault injected, CO2 a hundred times denser: the CALDER HALL check fails", Math.abs(f) > 100 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"void worth moved to " + f.toFixed(0) + " pcm"}); }

const htgr = arch(G.ARCHPRE.findIndex(r => r[0] === "HTGR")), hV = G.lawVoidOf(htgr.c, 0);
check("HTGR drawing: helium void worth off its lattice, magnitude", hV, 0, 100,
  "helium moderates and absorbs nothing, so voiding it is worth nothing either way", {abs:true, unit:"pcm", note:"the reflector's typed shift on top: " + G.REFL[htgr.c.refl].dV + " pcm"});
