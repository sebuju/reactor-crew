"use strict";
/* the moderation law (latLaw()): its formula, its resonance integral, its cell utilisation, and the coefficients it gives
   each family against what is published for that family */
// chunks: law coef burn
const {check, load} = require("./lib.js");
const mode = process.argv[2];
const G = load();

const pre = nm => { G.plantPreset(G.PLANTPRE.findIndex(r => r[0] === nm)); G.buildLayout(); const c = G.priD(); return {c, d:G.derived()}; };
const W = "Westinghouse Technology Systems Manual sec. 2.1, Reactor Physics Review (USNRC HRTD, Rev 1208, read 24/09/26)";
const GE = "GE BWR/4 Technology Manual ch. 1.7, Reactor Physics (USNRC HRTD, Rev 09/11, read 24/09/26)";
const AP = "AP1000 Design Control Document Rev. 16, Table 4.3-2, first cycle, design limits (NRC ML071580897, read 24/09/26)";
const ROW = "the moderation law";
/* a Westinghouse 17x17 assembly (pitch 21.5 cm, 264 rods of 0.95 cm on 0.819 cm pellets, 25 guide tubes 1.224/1.143 cm, as
   commonly quoted): water over fuel volume, the guide tubes' insides counted as water */
const W17 = (21.5*21.5 - 264*Math.PI/4*0.95*0.95 - 25*Math.PI/4*(1.224*1.224 - 1.143*1.143))/(264*Math.PI/4*0.819*0.819);
/* STOCK PWR's lattice at that water share, the published PWR figures belonging to that assembly */
const w17 = () => { const {c} = pre("STOCK PWR"), wv = () => { const v = G.latVols(c); return v.cool/v.fuel; };
  let lo = 0.5*c.lat.pitch, hi = 2*c.lat.pitch;
  for(let i = 0; i < 50; i++){ const m = (lo + hi)/2; c.lat.pitch = m; G.latRevolve(c); if(wv() < W17) lo = m; else hi = m; }
  G.buildLayout(); return {c, d:G.derived(), wv:wv()}; };

if(mode === "law"){
/* the formula: the IAEA 2D PWR benchmark's region 1 is a two-group lattice with no fast fission and no resonance region */
{ const IAEA = "IAEA 2D PWR benchmark, region 1 (ANL-7416 Suppl. 2, as reprinted in arXiv 2407.10988 Table 2): Sa1 0.01, S12 0.02, Sa2 0.08, nuSf2 0.135 /cm; k-inf = nuSf2 S12/(Sa2 (Sa1 + S12))";
  const k = G.lawKOf(0, 0, 0, 0, 0.01, 0, 0.02, 0, 0, 1, 0.135/0.08).k;
  check("the law's three regions on the benchmark's two groups: k-inf", k, 0.135*0.02/(0.08*0.03), 1e-9, IAEA, {unit:""});
  check("the benchmark's k-inf is 1.125", k, 1.125, 1e-9, IAEA, {unit:""}); }

/* U-238's resonance integral in an isolated UO2 rod against an independent transport calculation */
{ const TM = "ORNL/TM-6376 (1978) Table 4.1, UO2 isolated rods, ANISN on ENDF/B-IV (read 24/09/26); Hellstrand's own measurement error 2 %";
  const rows = [[0.2021, 300, 17.12], [0.7029, 300, 27.84], [0.2021, 1089, 18.75], [0.3514, 1089, 23.39], [0.4974, 1089, 27.09], [0.7029, 1089, 31.61]];
  for(const [sm, T, ri] of rows)
    check("U-238 resonance integral, UO2 rod S/M " + sm + " cm2/g at " + T + " K", G.riRod("oxide", sm, T), ri, 0.02, TM, {unit:"b"});
  const hot = rows.filter(r => r[1] > 300), off = hot.filter(([sm, , ri]) => Math.abs(G.riRod("oxide", sm, 300)/ri - 1) > 0.02).length;
  check("fault injected, no Doppler broadening: the 1089 K checks fail", off, hot.length, 0, "the hot checks above must be able to fail", {abs:true}); }

/* the cell's thermal utilisation: diffusion theory in a cylinder goes to the homogeneous ratio as both regions thin out */
{ const a = 0.4, b = 0.8, VF = Math.PI*a*a, VM = Math.PI*(b*b - a*a), SF = 0.3, SM = 0.01;
  check("cell utilisation, thin regions, against the homogeneous ratio", G.cellUtil(a, b, 1e-6, 1e-6, SF, SM, VF, VM), SF*VF/(SF*VF + SM*VM), 1e-9,
    "Lamarsh, Introduction to Nuclear Reactor Theory, sec. 6.6: F and E go to 1 as kappa r goes to 0", {unit:""});
  const f = G.cellUtil(a, b, 1.2, 0.35, SF, SM, VF, VM), fh = SF*VF/(SF*VF + SM*VM);
  check("cell utilisation, a black pellet: the thermal flux dips in the fuel, so the heterogeneous f is below the homogeneous", f - fh, 0, 0,
    "a thermal disadvantage factor above 1 (Lamarsh sec. 6.6)", {pass:f < fh, unit:"", note:"f " + f.toFixed(4) + " against " + fh.toFixed(4)}); }

/* water lattices are built under-moderated; graphite moderates far less per volume, so its lattice peaks much further out */
{ const peak = c => { const p0 = c.lat.pitch; let best = 0, at = 0;
    for(let s = 0.6; s <= 12; s *= 1.04){ c.lat.pitch = p0*s; G.latRevolve(c); const k = G.latLawCalc(c, {}).k, v = G.latVols(c);
      if(k > best){ best = k; at = (v.cool + v.mod)/v.fuel; } }
    c.lat.pitch = p0; G.latRevolve(c); return at; };
  const vr = c => { const v = G.latVols(c); return (v.cool + v.mod)/v.fuel; };
  for(const nm of ["STOCK PWR", "BWR/4", "EPR", "NUSCALE"]){ const {c} = pre(nm), wet = G.latLawCalc(c, {al:-0.01}).k, dry = G.latLawCalc(c, {al:0.01}).k;
    check(nm + ": more water raises k-inf (under-moderated)", wet - dry, 0, 0,
      W + " sec. 2.1.6.2: 'designed with a water volume to fuel volume ratio such that the value of the MTC is negative'; " + GE + " sec. 1.7.3.1.1",
      {pass:wet > dry, unit:""}); }
  const {c:pw} = pre("STOCK PWR"), wp = peak(pw), wd = vr(pw);
  check("STOCK PWR: its k-inf peaks at a wetter lattice than it is drawn", wp - wd, 0, 0, W + " sec. 2.1.6.2",
    {pass:wp > wd, unit:"", note:"moderator to fuel " + wd.toFixed(2) + " drawn, peak " + wp.toFixed(2)});
  const {c:gr} = pre("CALDER HALL"), gp = peak(gr);
  check("a graphite lattice peaks at a far larger moderator to fuel ratio than a water one", gp/wp, 5, 0,
    "graphite's moderating power per volume is a small fraction of water's (xi Sigma_s), so it needs far more of it per fuel",
    {pass:gp/wp > 5, unit:"x", note:"water peak " + wp.toFixed(2) + ", graphite peak " + gp.toFixed(1)}); }
}

if(mode === "coef"){
/* Doppler off the resonance integral's broadening */
{ const {c, d, wv} = w17(), nm = "17x17 water share (" + wv.toFixed(2) + ")";
  check(nm + ": Doppler temperature coefficient", d.aF, -2.7, 0, W + ", Figure 2.1-5: -1.2 to -1.9 pcm/F over the fuel's range, -2.16 to -3.42 pcm/K",
    {pass:d.aF <= -2.16 && d.aF >= -3.42, unit:"pcm/K", gap:ROW});
  check(nm + ": Doppler inside the AP1000 design limits", d.aF, -4, 0, AP + ": -3.5 to -1.0 pcm/F, -6.3 to -1.8 pcm/K",
    {pass:d.aF <= -1.8 && d.aF >= -6.3, unit:"pcm/K"});
  const o = G.RI_ROD.oxide, b0 = o.b0, b1 = o.b1; o.b0 = 0; o.b1 = 0;
  const T = G.latLaw(c).Tf, f = 1e5*Math.log(G.latLawCalc(c, {Tf:T + 10}).k/G.latLawCalc(c, {Tf:T - 10}).k)/20; o.b0 = b0; o.b1 = b1;
  check("fault injected, no broadening: the AP1000 Doppler check fails", f <= -1.8 && f >= -6.3 ? 0 : 1, 1, 0, "the check above must be able to fail",
    {abs:true, note:"Doppler moved to " + f.toFixed(3) + " pcm/K"});
  const b = pre("BWR/4").d;
  check("BWR/4: Doppler temperature coefficient", b.aF, -1.8, 0, GE + " sec. 1.7.3.2: 'D = -1 x 10-5 K/K per 1 F', -1.8 pcm/K; 'typical' taken as a factor of 2",
    {pass:b.aF <= -0.9 && b.aF >= -3.6, unit:"pcm/K"});
  const bn = pre("BN-600").d;
  check("BN-600: a fast core's Doppler is smaller than a water core's", Math.abs(bn.aF) - Math.abs(d.aF), 0, 0,
    "a fast spectrum puts few neutrons into the resonances Doppler broadens", {pass:Math.abs(bn.aF) < Math.abs(d.aF), unit:"pcm/K"});
  const cal = pre("CALDER HALL").d;
  check("CALDER HALL: natural uranium metal's Doppler is negative", cal.aF, 0, 0, "U-238 resonance broadening in any thermal lattice",
    {pass:cal.aF < 0, unit:"pcm/K"}); }

/* the moderator coefficient and soluble boron */
{ const {c, d, wv} = w17(), nm = "17x17 water share (" + wv.toFixed(2) + ")", T5 = (500 - 32)/1.8 + 273.15;
  const m0 = G.lawMtcOf(c, 0, T5), m5 = G.lawMtcOf(c, 500, T5);
  check(nm + ", fresh: MTC at 500 F, no boron", m0, -17*1.8, 0.5, W + " sec. 2.1.6.2, Figure 2.1-8: -17 pcm/F at 500 F on the 0 ppm curve", {unit:"pcm/K", gap:ROW});
  check(nm + ", fresh: 500 ppm of boron makes the MTC less negative by about 9 pcm/F", m5 - m0, 9*1.8, 0.5,
    W + " sec. 2.1.6.2: -17 pcm/F at 0 ppm, -8 pcm/F at 500 ppm, both at 500 F", {unit:"pcm/K", gap:ROW});
  let z = null; for(let p = 0; p <= 4000; p += 50) if(G.lawMtcOf(c, p, T5) > 0){ z = p; break; }
  check(nm + ", fresh: the MTC turns positive at high boron", z ?? 1e9, 1400, 0.5, W + " sec. 2.1.6.2: 'at boric acid concentrations greater than approximately 1400 ppm, the MTC is positive'",
    {unit:"ppm", gap:ROW, note:z == null ? "never positive up to 4000 ppm" : ""});
  check(nm + ": MTC at its own boron, hot full power", d.aM, -36, 0, AP + ": 0 to -40 pcm/F, 0 to -72 pcm/K",
    {pass:d.aM <= 0 && d.aM >= -72, unit:"pcm/K", note:"at " + d.ppm.toFixed(0) + " ppm"});
  const worth = (c, d) => { const a = G.COOLANT[c.cool];
    return (G.rhoOfK(G.latLawCalc(c, {bor:G.borN(a, d.ppm + 10), bu:d.bu}).k) - G.rhoOfK(G.latLawCalc(c, {bor:G.borN(a, d.ppm - 10), bu:d.bu}).k))/20; };
  const w = worth(c, d);
  check(nm + ": differential boron worth at its own boron and burnup", w, -9, 0, AP + ": boron coefficient -13.5 to -5.0 pcm/ppm",
    {pass:w <= -5 && w >= -13.5, unit:"pcm/ppm", gap:ROW});
  const s = pre("STOCK PWR"), ws = worth(s.c, s.d), v = G.latVols(s.c);
  check("STOCK PWR as drawn: differential boron worth", ws, -9, 0, AP + ": boron coefficient -13.5 to -5.0 pcm/ppm",
    {pass:ws <= -5 && ws >= -13.5, unit:"pcm/ppm", gap:"the moderation law", note:"BUILD: water over fuel " + (v.cool/v.fuel).toFixed(2) + " against a 17x17's " + W17.toFixed(2)});
  const bw = pre("BWR/4").d;
  check("BWR/4: moderator temperature coefficient negative", bw.aM, -18, 0, GE + " sec. 1.7.3.2: 'T = -1 x 10-4 K/K per 1 F'; the sign is the check",
    {pass:bw.aM < 0, unit:"pcm/K"}); }

/* samarium: its equilibrium worth does not depend on the flux */
{ const {d} = pre("STOCK PWR");
  check("STOCK PWR: equilibrium samarium", -d.smW, -650, 0.3, W + " sec. 2.1.7.1: 'about -0.65% K/K or -650 pcm ... independent of the neutron flux'", {unit:"pcm", gap:ROW}); }
}

if(mode === "burn"){
/* the burnt book (latDeplete()): fission products are the fissions, the march converges, and a PWR's plutonium carries the
   share of fission a running PWR's does */
{ const {c, d} = pre("STOCK PWR"), fima = 86400e6/G.FIS_J*0.238/G.N_AV, x = G.latDeplete(c, 40);
  check("STOCK PWR fuel at 40 MWd/kgHM: fission-product pairs equal the fissions", x.FP, 40*fima, 1e-12,
    "one pair per fission, 200 MeV a fission (conservation)", {unit:"per heavy atom"});
  let y = G.latDeplete(c, 0); for(let i = 0; i < 80; i++) y = G.depMid(c, y, 0.5);
  check("STOCK PWR fuel at 40 MWd/kgHM: U-235 at half the step", y.U235, x.U235, 1e-3, "the midpoint march converged: its step halved moves nothing that matters", {unit:"per heavy atom"});
  const DB = "Daya Bay, An et al., PRL 118, 251801 (2017), arXiv 1704.01082 (abstract read 24/09/26): effective Pu-239 fission fractions 0.25 to 0.35 over the cycles, Pu-241 0.056 on average (seen quoted)";
  const s = G.lawFisShares(G.latLaw(c, {bu:d.bu}).rate);
  check("STOCK PWR at its rest burnup: plutonium's share of fission (Pu-241 is carried as Pu-239)", s.Pu239, 0.36, 0, DB + ": 0.30 to 0.41",
    {pass:s.Pu239 >= 0.30 && s.Pu239 <= 0.41, unit:"", note:"at " + d.bu.toFixed(1) + " MWd/kgHM; U-238 " + s.U238.toFixed(3) + " against 0.076"});
  const r = G.latLawCalc(c, {x:{U235:x.U235, U238:x.U238, Pu239:0, FP:x.FP}}).rate; let F = 0; for(const e in r) F += r[e].f;
  check("fault injected, no plutonium bred: the share check fails", r.Pu239.f/F >= 0.30 ? 0 : 1, 1, 0, "the check above must be able to fail", {abs:true});
  const b0 = G.dngBlend(c, 0).beta, b1 = G.dngBlend(c, d.bu).beta;
  check("STOCK PWR: the delayed-neutron fraction falls as plutonium takes over fission", b1 - b0, 0, 0,
    "Pu-239 yields 0.0021 delayed neutrons a fission against U-235's 0.0065 (Keepin 1965, as commonly quoted)",
    {pass:b1 < b0, unit:"pcm", note:"fresh " + b0.toFixed(0) + ", at " + d.bu.toFixed(1) + " MWd/kgHM " + b1.toFixed(0)});
  const rb = pre("RBMK-1000").c; let lo = 0, hi = 30;
  for(let i = 0; i < 30; i++){ const m = (lo + hi)/2; if(G.lawFisShares(G.latLaw(rb, {bu:m}).rate).Pu239 < 1/3) lo = m; else hi = m; }
  const bt = G.dngBlend(rb, (lo + hi)/2).beta;
  check("RBMK-1000: beta where plutonium carries a third of the fissions", bt, 495, 0,
    "INSAG-7: beta_eff 0.0048-0.0051 at equilibrium burnup, where plutonium carries about a third of the fissions (docs/fidelity.md, delayed-neutron fraction)",
    {pass:bt >= 480 && bt <= 510, unit:"pcm", gap:"delayed-neutron fraction against a real beta_eff", note:"at " + ((lo + hi)/2).toFixed(1) + " MWd/kgHM"}); }
}
