"use strict";
/* the three ARCHPRE drawings AV_MOD, AV_ABS and AV_FAST are solved against: each reads its own machine's published full-void worth */
const {check, load} = require("./lib.js");
const G = load();

const aVof = ai => { G.plantPreset(0); const c = G.priD(); G.archPreset(c, ai); G.buildLayout(); return G.derived().aV; };

const PUB = [
  [0, "PWR", -10000, "a Westinghouse 4-loop lattice loses its moderator when it voids: full-void worth about -10 000 pcm (Lamarsh & Baratta ch. 8; the moderator coefficient's own limit)"],
  [2, "RBMK", 2150, "the pre-1986 RBMK-1000 carried +4.5 beta_eff of full-core void (INSAG-7 annex I), which at an equilibrium-burnup beta_eff of 0.0048-0.0051 is +2160 to +2300 pcm, and INSAG-7 table II-I states +2.0e-4 per % void = +2000 pcm: the band is 2000-2300 and 2150 is its midpoint"],
  [3, "SFR", 700, "a sodium fast lattice gains on voiding through the spectrum: BN-600 sodium void worth about +700 pcm (IAEA-TECDOC-1531 BN-600 benchmark)"],
];
for(const [ai, nm, want, src] of PUB)
  check(nm + ": full-void worth", aVof(ai), want, 0.01, src, {unit:"pcm per unit void"});

check("fault injected, the RBMK target perturbed 20 %: its own check fails",
  Math.abs(aVof(2)/(2150*1.2) - 1) > 0.01 ? 1 : 0, 1, 0, "the RBMK check above must be able to fail", {abs:true});

/* the drawings the three constants are NOT solved against: they read whatever the geometry gives */
for(const [ai, nm, src] of [
  [1, "BWR", "a BWR/4's opened-out lattice voids more negatively than a PWR's; the expression itself is a deliberate cut, docs/fidelity.md"],
  [4, "MSR", "the salt moderates a little, so voiding it reads mildly negative"],
  [5, "HTGR", "helium moderates nothing and absorbs nothing, so voiding it is worth nothing either way"],
  [6, "MAGNOX", "CO2 moderates nothing and absorbs nothing"]])
  check(nm + ": full-void worth, sign only", aVof(ai), 0, 0, src,
    {unit:"pcm per unit void", pass: nm === "BWR" || nm === "MSR" ? aVof(ai) < 0 : Math.abs(aVof(ai)) < 100,
     note:"read off the drawing, not fitted"});
