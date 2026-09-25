"use strict";
/* the moderation law (latLaw()): its formula, its resonance integral, its cell utilisation, and the coefficients it gives
   each family against what is published for that family */
// chunks: law coef burn enr enr2 ring ringk ringg gd gdv fol refl
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
  for(let i = 0; i < 30; i++){ const m = (lo + hi)/2; c.lat.pitch = m; G.latRevolve(c); if(wv() < W17) lo = m; else hi = m; }
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

if(mode === "enr"){
/* the enrichment knob flows into the densities (plan-reactor-ui 8.3): at a row's own enrichment it is a no-op to
   1e-9 at pinned fuel temperature, and k-inf rises with it. Against the published row it reads to the reference
   rating's own precision: rows at a stated fuel temperature exactly, rows rated hot to the BUSY-rating effect. */
{ const NZ = G.LAT_NZ;
  for(let fi = 0; fi < G.FUEL.length; fi++){ const F = G.FUEL[fi];
    const c = G.coreMint(); G.archPreset(c, F.ref.arch); c.fuel = fi;
    c.zoneEnr = {}; for(let z = 0; z < NZ; z++) c.zoneEnr[z] = F.enr;
    G.latRevolve(c);
    const o = G.lawRefState(c, F.ref), pinned = Object.assign({}, o, {Tf:G.COOLANT[c.cool].Tref});
    const kKnob = G.kInfOf(c, pinned);
    delete c.zoneEnr; G.latRevolve(c);
    const kPlain = G.kInfOf(c, pinned);
    check("FUEL " + F.name + ": the enrichment knob at the row's own enrichment changes nothing", kKnob, kPlain, 1e-9,
      "the knob on the row is the row: same densities, same k-inf, at one pinned fuel temperature",
      {unit:""});
    /* rows at a stated fuel temperature reproduce their published k-inf exactly; rows rated hot read to 1e-4, the
       reference rating running with unscaled rings under LAW_REF_BUSY (fidelity: the moderation law) */
    const hot = F.ref.Tf === undefined;
    check("FUEL " + F.name + ": k-inf at its own enrichment against the published row", G.kInfOf(c, o), F.kInf, hot ? 1e-4 : 1e-9,
      "the row's reference drawing (" + G.ARCHPRE[F.ref.arch][0] + ") at " + (F.enr*100).toFixed(2) + " %" + (hot ? "; rated-hot rows carry the reference rating's precision" : ""),
      {unit:""}); } }
}

if(mode === "enr2"){
/* k-inf rises with the enrichment knob on one lattice (plan-reactor-ui 8.3): split from enr for the 10 s budget */
{ const NZ = G.LAT_NZ;
  const {c} = pre("STOCK PWR");
  let prev = -Infinity, mono = true; const vals = [];
  for(const e of [0.005, 0.01, 0.02, 0.032, 0.049, 0.06]){
    c.zoneEnr = {}; for(let z = 0; z < NZ; z++) c.zoneEnr[z] = e; G.latRevolve(c);
    const k = G.kInfOf(c); vals.push(k.toFixed(5)); if(!(k > prev)) mono = false; prev = k; }
  check("k-inf monotone in the enrichment knob", mono ? 1 : 0, 1, 0,
    "more U-235 per unit of fuel is more fission per absorption, at one lattice",
    {abs:true, note:vals.join(" ")}); } }

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

if(mode === "ring"){
/* counts through the law: the drawing's own counts and fuel mix, handed in, are the drawing */
{ const HOM = "the law is one function of the composition: the same composition in is the same k-inf out";
  for(const nm of ["STOCK PWR", "RBMK-1000", "MSRE", "CALDER HALL", "BN-600"]){ const {c} = pre(nm), n = Object.assign(G.latCounts(c), {w:G.fuelVolW(c)});
    check(nm + ": the drawing's counts through the override reproduce the law", G.latLawCalc(c, {cnt:n}).k, G.latLaw(c).k, 1e-12, HOM, {unit:""}); }
  const {c} = pre("STOCK PWR"), n = Object.assign(G.latCounts(c), {w:G.fuelVolW(c)}); n.nW = 1;
  check("fault injected, one slot of water added: the override check fails", Math.abs(G.latLawCalc(c, {cnt:n}).k/G.latLaw(c).k - 1) > 1e-12 ? 1 : 0, 1, 0,
    "the checks above must be able to fail", {abs:true}); }
}

if(mode === "ringk" || mode === "ringg"){
/* ring k-inf: the rings hold the drawing's slots, each ring's term is the law on its own composition, and a ring of the
   lattice itself reads the lattice */
{ const CONS = "every sampled patch of a slot lands in exactly one ring (conservation of the drawing)";
  const LAW = "1e5 (k_ring - k_core), each k-inf the law on its own composition times its fuels' published k-inf over the law's (kInfOf())";
  const NF = 22000;
  for(const nm of mode === "ringk" ? ["STOCK PWR", "RBMK-1000"] : ["MSRE", "CALDER HALL"]){ const {c} = pre(nm), M = G.latM(c), R = M.ring, v = G.latCounts(c);
    const T = G.corePredict(c, {rf:G.REFL[c.refl]}), sum = a => a.reduce((s, x) => s + x, 0);
    check(nm + ": the rings hold the drawing's fuel slots", sum(R.nF), v.nF, 1e-12, CONS, {unit:"slots"});
    check(nm + ": the rings hold the drawing's block and channel slots", sum(R.nM) + sum(R.nC), v.nM + v.nC, 1e-12, CONS, {unit:"slots"});
    const t = v.nF + v.nM + v.nC, blk = G.latVols(c).mod > 0, k0 = G.kInfOf(c);
    let worst = 0, full = 0, part = 0, fullF = 0, partF = 0;
    for(let i = 0; i < G.XNR; i++){ const o = (R.nF[i] + R.nM[i] + R.nC[i])/t, w = new Float64Array(G.FUEL.length);
      if(R.nF[i] > 0) for(let z = 0; z < G.LAT_NZ; z++) w[G.zoneFuelOf(c, z)] += M.zfrac[z][i]; else w.set(G.fuelVolW(c));
      let s = 0; for(let f = 0; f < w.length; f++) if(w[f] > 0) s += w[f]*G.FUEL[f].kInf/G.lawRef(f).k;
      const k = G.latLawCalc(c, {cnt:{nF:o*v.nF, nM:o*v.nM + (blk ? R.nE[i] : 0), nC:o*v.nC, nW:blk ? 0 : R.nE[i], w}}).k*s;
      const hand = 1e5*(k - k0), bad = T.ring0[i] - NF*R.nE[i]/(R.nF[i] + R.nM[i] + R.nC[i] + R.nE[i]), e = Math.abs(T.ring0[i] - hand), eF = Math.abs(bad - hand);
      worst = Math.max(worst, e); if(R.nE[i] > 1e-9){ part++; if(eF > 1e-9*Math.max(1, Math.abs(hand))) partF++; }
      else { full++; if(eF > 1e-9*Math.max(1, Math.abs(hand))) fullF++; } }
    check(nm + ": every ring's term against the law by hand", worst, 0, 1e-9*1e5, LAW, {abs:true, unit:"pcm"});
    check("fault injected on " + nm + ", LAT_NF back: rings with an empty part fail, full rings do not", (part ? (partF === part ? 1 : 0) : 1) + (fullF === 0 ? 1 : 0), 2, 0,
      "the check above must be able to fail where it should and only there", {abs:true, note:part + " part rings, " + full + " full"}); }
  if(mode === "ringk"){ const {c} = pre("STOCK PWR"), T = G.corePredict(c, {rf:G.REFL[c.refl]}), MR = G.latM(c).ring;
  let n = 0, e = 0; for(let i = 0; i < G.XNR; i++) if(!(MR.nE[i] > 0)){ n++; e = Math.max(e, Math.abs(T.ring0[i])); }
  check("STOCK PWR: a ring of the lattice itself reads the lattice (" + n + " full rings, one fuel)", e, 0, 1e-6, "the same composition is the same k-inf", {abs:true, unit:"pcm"}); } }
}

/* burnable poison as a material: gadolinia pellets, black to thermal neutrons, burning from the surface in */
const VERA = "VERA problem 2 (CASL-U-2012-0131-004, Tables P2-1, P2-2 and 15, KENO-VI k-inf, read 24/09/26): 2A 1.182175, 2O (12 gadolinia rods) 1.047729, 2P (24) 0.927410, 565 K, 1300 ppm";
const INL = "Evans, Keiser, DeHart & Weaver, Burnable Absorbers in Nuclear Reactors - A Review, INL/JOU-21-61443 (2022) sec. 2.2, read 24/09/26: onion-skin burnout, 'the gadolinium burns out well in advance of the fuel'";

if(mode === "gd"){
{ const {c} = pre("STOCK PWR"), M = G.latM(c), R = M.ring, v = G.latCounts(c), t = v.nF + v.nM + v.nC, nb = G.latBundle(c).nRod, r0 = G.rodDP(c)/2, bu = 5, r = G.gdRadius(c, bu);
  let worst = 0, bad = 0, nr = 0;
  const p = G.poisonAt(c, bu);
  for(let i = 0; i < G.XNR; i++){ if(!(R.nP[i] > 0)) continue; nr++;
    const o = (R.nF[i] + R.nM[i] + R.nC[i])/t, w = new Float64Array(G.FUEL.length);
    for(let z = 0; z < G.LAT_NZ; z++) w[G.zoneFuelOf(c, z)] += M.zfrac[z][i];
    let s = 0; for(let f = 0; f < w.length; f++) if(w[f] > 0) s += w[f]*G.FUEL[f].kInf/G.lawRef(f).k;
    const n = {nF:o*v.nF, nM:o*v.nM, nC:o*v.nC, nW:R.nE[i], w}, q = R.nP[i]/R.nF[i]*12/264;
    const hand = 1e5*s*(G.latLawCalc(c, {cnt:n}).k - G.latLawCalc(c, {cnt:n, gd:G.gdAbs(q*n.nF*nb, r), gdf:q*(r/r0)*(r/r0)}).k);
    worst = Math.max(worst, Math.abs(p.poi[i] - hand)/Math.max(1, Math.abs(hand)));
    if(Math.abs(1200*R.nP[i]/R.nF[i] - hand) > 1e-9*Math.max(1, Math.abs(hand))) bad++; }
  check("STOCK PWR at " + bu + " MWd/kgHM: each poisoned ring's worth against the law by hand (" + nr + " rings)", worst, 0, 1e-9, "the law with the rings' own gadolinia", {abs:true, unit:"rel"});
  check("fault injected, LAT_POIPIN back: the by-hand check fails on every poisoned ring", bad, nr, 0, "the check above must be able to fail", {abs:true});

  const disc = G.fuelBlend(c).bu; let lo = 0, hi = disc;
  for(let i = 0; i < 40; i++){ const m = (lo + hi)/2; if(G.gdRadius(c, m) > 0) lo = m; else hi = m; }
  const out = rad => rad === 0 && lo < disc;
  check("STOCK PWR: its gadolinia burns out before its fuel is discharged", lo/disc, 0.5, 0, INL,
    {pass:out(G.gdRadius(c, disc)), unit:"of discharge", note:"burnt out at " + lo.toFixed(1) + " of " + disc + " MWd/kgHM"});
  check("fault injected, the pellet never burns (radius held at r0): the burnout check fails", out(r0) ? 0 : 1, 1, 0, "the check above must be able to fail", {abs:true});
  let mono = true, last = Infinity; for(let b = 0; b <= lo + 1; b += 1){ const m = G.poisonAt(c, b).mean; if(!(m <= last)) mono = false; last = m; }
  check("STOCK PWR: the poison's worth only falls as it burns", mono ? 1 : 0, 1, 0, INL, {abs:true}); }
}

if(mode === "gdv"){
{ const lat = w17().c; lat.fuel = 0; lat.zoneFuel = {}; G.latRevolve(lat);
  const a = G.COOLANT[lat.cool], st = {Tf:565, Tn:565, bor:G.borN(a, 1300)}, n = G.latCounts(lat), nb = G.latBundle(lat).nRod, rp = G.rodDP(lat)/2, k0 = G.latLawCalc(lat, st).k;
  const worth = (nG, f) => 1e5*(1/G.latLawCalc(lat, Object.assign({gd:G.gdAbs(n.nF*nb*nG/264, rp)*f, gdf:nG/264}, st)).k - 1/k0);
  const v12 = 1e5*(1/1.047729 - 1/1.182175), v24 = 1e5*(1/0.927410 - 1/1.182175), w12 = worth(12, 1), w24 = worth(24, 1);
  const nm = "3.2 % UO2 at a 17x17's water share, 1300 ppm, 565 K";
  check(nm + ": the lattice without poison", k0, 1.182175, 0.02, VERA + " (2A, 3.1 %)", {unit:""});
  check(nm + ": 12 fresh gadolinia rods' worth", w12, v12, 0.25, VERA, {unit:"pcm", gap:"burnable poison", note:"the rods' own 1.8 % uranium and gadolinium's epithermal capture not carried"});
  check(nm + ": 24 rods take twice what 12 do", w24/w12, v24/v12, 0.15, VERA, {unit:"x"});
  const f12 = worth(12, 1/G.vBarOf(565));
  check("fault injected, the black surface's current at 2200 m/s: the 12-rod check fails", Math.abs(f12/v12 - 1) > 0.25 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"worth " + f12.toFixed(0) + " pcm"}); }
}

if(mode === "fol"){
/* a rod's follower is a material in its own bore: its worth is the law with the bore's contents replaced */
{ const INSAG = "INSAG-7 (IAEA Safety Series 75, 1992): in the RBMK the water is a net absorber and the graphite displacers push it out of the channels below the rods";
  const {c} = pre("RBMK-1000"), L = c.lat, b = G.cpsBoreMm(c)/1000, f0 = c.foll;
  let nC = 0; for(let q = 0; q < G.LQ*G.LQ; q++) if(L.rod[q] >= 0 && L.slot[q] === G.L_CPS) nC++;
  const hand = k => { const m = G.FOLL[k].mat; if(!m) return 0;
    const nd = G.numDensAdd(m.comp || G.atomsOfW(m.compW), m.dens*1000, 0, 0, 1, {});
    return 1e5*G.kScaleOf(G.fuelVolW(c))*(G.latLawCalc(c, {fol:[[G.HS_CW, nC*Math.PI/4*b*b, nd, 100*b]]}).k - G.latLawCalc(c, {}).k); };
  const got = G.FOLL.map((r, k) => { c.foll = k; return G.folRhoOf(c); }); c.foll = f0;
  let e = 0; G.FOLL.forEach((r, k) => { e = Math.max(e, Math.abs(got[k] - hand(k))/Math.max(1, Math.abs(hand(k)))); });
  check("RBMK-1000: every follower's worth against the law by hand (" + nC + " rodded channels a quarter)", e, 0, 1e-9, "the law with the bore's water replaced", {abs:true, unit:"rel"});
  check("RBMK-1000: a water follower is worth nothing", got[0], 0, 0, "water replaced by water", {abs:true, unit:"pcm"});
  const gi = G.FOLL.findIndex(r => r.name === "GRAPHITE DISPLACER");
  check("RBMK-1000: graphite displacing the channels' water adds reactivity", got[gi], 0, 0, INSAG, {pass:got[gi] > 0, unit:"pcm", note:"all followers in, core-wide"});
  c.foll = gi; const wet = G.cpsWet(c); c.cps.bore = 1e-6; const dry = G.folRhoOf(c); delete c.cps.bore; c.foll = f0;
  check("fault injected, no bore to fill: the displacer's worth vanishes", Math.abs(dry) < 1e-3*Math.abs(got[gi]) ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"piped " + wet + ", " + dry.toExponential(2) + " pcm"}); }
}

if(mode === "refl"){
/* a reflector is a thickness in cm: its savings are the slab's own, whatever the size of the core behind it */
{ const SLAB = "one-group reflector savings of a slab, (D_c/D_r) L_r tanh((T + 0.7104 x 3 D_r)/L_r) (Lamarsh, Introduction to Nuclear Reactor Theory, as commonly quoted)";
  const mk = r => { const c = Object.assign({zoneFuel:{}, lat:G.latNew()}, G.CORE_DEFAULT); G.archPreset(c, G.ARCHPRE.findIndex(q => q[0] === "MAGNOX"));
    G.latLayFuel(c, r, 0); G.latLayMod(c, 2); G.latLayBanks(c, 4); c.lat.len = 2*G.latEqR(c)*0.679; c.lat.reflR = c.lat.reflT = c.lat.reflB = 20; G.latRevolve(c); return c; };
  const a = mk(3.2), b = mk(8.5), Ta = G.corePredict(a, {rf:G.REFL[a.refl]}), Tb = G.corePredict(b, {rf:G.REFL[b.refl]}), rf = G.REFL[a.refl];
  const nm = "MAGNOX lattice, 20 cm of " + rf.name + ": " + G.latM(a).dia.toFixed(2) + " m and " + G.latM(b).dia.toFixed(2) + " m cores";
  check(nm + ": the same savings on the rim", Tb.dR, Ta.dR, 1e-6, SLAB, {unit:"m"});
  check(nm + ": the same savings on the lid", Tb.dT, Ta.dT, 1e-6, SLAB, {unit:"m"});
  const hand = Ta.dc/rf.dr*rf.lr*Math.tanh((20 + 0.7104*3*rf.dr)/rf.lr)/100;
  check(nm + ": the savings against the slab by hand", Ta.dR, hand, 1e-12, SLAB, {unit:"m"});
  const cells = c => G.edgeDist(G.latMig(c).dc, 20/100/0.2*G.latM(c).dr, rf);
  check("fault injected, the thickness read in mesh cells: the two cores' savings part", Math.abs(cells(b)/cells(a) - 1) > 1e-6 ? 1 : 0, 1, 0,
    "the checks above must be able to fail", {abs:true}); }
}
