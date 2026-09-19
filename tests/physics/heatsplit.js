"use strict";
/* fission heat that never enters the pin: the law on published cells typed here, not on the drawn presets; its data against NIST and the fission table */
const {check, load, if97, FIS} = require("./lib.js");
const G = load();
const ROW = "heat deposited outside the fuel";
const NIST = "Hubbell & Seltzer, NISTIR 5632, mu/rho and mu_en/rho at 1 MeV";

/* NIST mu/rho and mu_en/rho cm2/g at 1 MeV and IUPAC g/mol, typed a second time */
const MU = {H:0.1263, He:0.06362, Li:0.05503, Be:0.05652, B:0.05890, C:0.06361, O:0.06372, F:0.06037, Na:0.06100,
  Mg:0.06296, Zr:0.05810, Ag:0.05921, Cd:0.05826, In:0.05849, Hf:0.06502, U:0.07896};
const EN = {H:0.05556, He:0.02797, Li:0.02419, Be:0.02483, B:0.02586, C:0.02792, O:0.02794, F:0.02645, Na:0.02669,
  Mg:0.02753, Zr:0.02547, Ag:0.02632, Cd:0.02597, In:0.02615, Hf:0.03188, U:0.04241};
const AM = {H:1.008, He:4.0026, Li:6.94, Be:9.0122, B:10.81, C:12.011, O:15.999, F:18.998, Na:22.990, Mg:24.305,
  Zr:91.224, Ag:107.87, Cd:112.41, In:114.82, Hf:178.49, U:238.03};
const wOf = f => { let m = 0; const w = {}; for(const e in f) m += f[e]*AM[e]; for(const e in f) w[e] = f[e]*AM[e]/m; return w; };
const sum = (t, w) => { let s = 0; for(const e in w) s += w[e]*t[e]; return s; };
const mix = f => sum(EN, wOf(f)), mixA = f => sum(MU, wOf(f));
const uzZr = 0.1/91.224/(0.1/91.224 + 0.9/238.03);
const AIC = {Ag:0.80, In:0.15, Cd:0.05};
const WANT = [
  ["COOLANT", "PWR", {H:2, O:1}], ["COOLANT", "BWR", {H:2, O:1}], ["COOLANT", "LWGR", {H:2, O:1}], ["COOLANT", "SFR", {Na:1}],
  ["COOLANT", "MSR", {Li:2, Be:1, F:4}], ["COOLANT", "HTGR", {He:1}], ["COOLANT", "CO2", {C:1, O:2}],
  ["MODER", "GRAPHITE", {C:1}], ["MODER", "BERYLLIUM OXIDE", {Be:1, O:1}], ["MODER", "ZIRCONIUM HYDRIDE", {Zr:1, H:1.6}],
  ["FUEL", "UO2  3.2% LEU", {U:1, O:2}], ["FUEL", "UO2  4.9% LEU", {U:1, O:2}], ["FUEL", "UO2 19.7% HEU", {U:1, O:2}], ["FUEL", "MOX PLUTONIUM", {U:1, O:2}],
  ["FUEL", "U-ZR METALLIC", {U:1 - uzZr, Zr:uzZr}], ["FUEL", "U METAL NATURAL", {U:1}],
  ["CLAD", "ZIRCALOY", {Zr:1}], ["CLAD", "MAGNOX AL80", {Mg:1}],
  ["ABSORB", "BORON CARBIDE", {B:4, C:1}], ["ABSORB", "HAFNIUM", {Hf:1}]];
let worstBad = 0;
for(const [t, id, f] of WANT){
  const row = G[t].find(r => (r.id || r.name) === id);
  check(t + " " + id + ": mu_en/rho at 1 MeV", row.muen, mix(f), 0.01, NIST + ", mass-weighted over " + JSON.stringify(f), {unit:"cm2/g"});
  check(t + " " + id + ": mu/rho at 1 MeV", row.muAt, mixA(f), 0.01, NIST + ", mass-weighted over " + JSON.stringify(f), {unit:"cm2/g"});
  worstBad = Math.max(worstBad, Math.abs(row.muAt*(id === "GRAPHITE" ? 1.1 : 1)/mixA(f) - 1)); }
{ const row = G.ABSORB.find(r => r.name === "SILVER-INDIUM-CADMIUM"), src = NIST + ", mass-weighted over Ag 80 / In 15 / Cd 5 by weight";
  check("ABSORB SILVER-INDIUM-CADMIUM: mu_en/rho at 1 MeV", row.muen, sum(EN, AIC), 0.01, src, {unit:"cm2/g"});
  check("ABSORB SILVER-INDIUM-CADMIUM: mu/rho at 1 MeV", row.muAt, sum(MU, AIC), 0.01, src, {unit:"cm2/g"}); }
check("fault injected, graphite's mu/rho x 1.1: the mu checks fail", worstBad > 0.01 ? 1 : 0, 1, 0, "the mu checks above must be able to fail", {abs:true, note:"worst " + (worstBad*100).toFixed(1) + " %"});

const ENDF = "ENDF/B-VIII.0 n-092_U_235.endf MF=1 MT=458 at thermal: fragments 169.130, prompt neutrons 4.8276, delayed neutrons 0.008074, prompt gamma 7.2813, delayed gamma 6.330 +- 0.050, delayed beta 6.500 +- 0.050 MeV, plus the capture gamma MT=458 does not carry (Lamarsh's 3-12, 7.5 taken)";
check("FIS_FN: neutron kinetic energy over the prompt recoverable energy", G.FIS_FN, FIS.fn, 0, ENDF, {abs:true});
check("FIS_FGP: prompt and capture gamma over the prompt recoverable energy", G.FIS_FGP, FIS.fgp, 0, ENDF, {abs:true});
check("FIS_FGD: delayed gamma over delayed beta and gamma", G.FIS_FGD, FIS.fgd, 0, ENDF, {abs:true});

/* one cell per unit height: regions [rho g/cm3, mu/rho, mu_en/rho, area mm2, mean chord 4V/S mm], the gamma
   source all in region 0; sig -> 0 is the uniform-fluence law the model used to be */
function cell(regs, thin){
  const n = regs.length, sig = new Float64Array(n), vol = new Float64Array(n), ch = new Float64Array(n);
  const f = new Float64Array(n), dep = new Float64Array(n), src = new Float64Array(n);
  for(let i=0;i<n;i++){ const r = regs[i];
    sig[i] = r.rho*r.mu*(thin ? 1e-12 : 1); vol[i] = r.A; ch[i] = r.c/10; f[i] = r.mu > 0 ? r.muen/r.mu : 0; }
  src[0] = 1; G.heatCP(sig, vol, ch, f, src, dep); return dep; }
/* the same cell by mass x mu_en/rho alone */
function flat(regs){ const w = regs.map(r => r.rho*r.muen*r.A); const t = w.reduce((a, b) => a + b, 0); return w.map(x => x/t); }
/* shares of core heat: neutrons by moderation weight over the media that moderate, gammas where they stopped */
function heat(regs, dep){
  let n = 0; for(let i=0;i<regs.length;i++) n += regs[i].modK*regs[i].A;
  const p = G.PROMPT_F;
  return regs.map((r, i) => p*(FIS.fn*(n > 0 ? r.modK*r.A/n : 0) + FIS.fgp*dep[i]) + (1 - p)*FIS.fgd*dep[i]); }
const disc = d => Math.PI/4*d*d;
const rhoW = (p, T) => 1/if97(p, T).v/1000;
const UO2 = {mu:mixA({U:1, O:2}), muen:mix({U:1, O:2}), rho:10.4, modK:0};
const ZRC = {mu:mixA({Zr:1}), muen:mix({Zr:1}), rho:6.56, modK:0};
const WAT = {mu:mixA({H:2, O:1}), muen:mix({H:2, O:1}), modK:1.00};
const GRA = {mu:mixA({C:1}), muen:mix({C:1}), rho:1.70, modK:0.95};

/* the fixed point itself: every pass must move energy, never make or lose it */
{ const regs = [{...UO2, A:100, c:10}, {...WAT, rho:0.7, A:200, c:12}, {...GRA, A:400, c:150}];
  const n = regs.length, sig = new Float64Array(n), vol = new Float64Array(n), ch = new Float64Array(n), f = new Float64Array(n);
  for(let i=0;i<n;i++){ sig[i] = regs[i].rho*regs[i].mu; vol[i] = regs[i].A; ch[i] = regs[i].c/10; f[i] = regs[i].muen/regs[i].mu; }
  let cur = [1, 0, 0], dep = [0, 0, 0], worst = 0, wt = 0;
  const prr = [], w = [];
  for(let i=0;i<n;i++){ const sl = sig[i]*ch[i]; prr.push(sl/(1 + sl)); w.push(sig[i]*vol[i]*(1 - Math.exp(-sl))/sl); wt += w[i]; }
  for(let p=0;p<64;p++){ const src = cur.reduce((a, b) => a + b, 0);
    let esc = 0; const hit = cur.map((x, i) => { esc += x*(1 - prr[i]); return x*prr[i]; });
    const got = hit.map((x, i) => x + esc*w[i]/wt);
    let d = 0, left = 0;
    cur = got.map((x, i) => { d += x*f[i]; left += x*(1 - f[i]); return x*(1 - f[i]); });
    dep = dep.map((x, i) => x + got[i]*f[i]);
    worst = Math.max(worst, Math.abs(d + left - src)); }
  check("every pass of the fixed point: deposited plus travelling equals the source", worst, 0, 1e-12,
    "conservation: a collision deposits mu_en/mu and re-emits the rest, nothing else happens", {abs:true});
  const got = cell(regs, false);
  check("the law's own deposition closes over the cell", got.reduce((a, b) => a + b, 0), 1, 1e-12,
    "conservation: an infinite lattice has no leak, so every photon is stopped somewhere in it", {abs:true,
      note:"three regions, by hand " + dep.map(x => x.toFixed(6)).join(" / ")}); }

/* Westinghouse 17x17: pitch 12.6, rod 9.50, clad 0.572, pellet 8.19 mm (the figures the stock rod carries; the DCD sheet not re-read here), UO2 10.4 g/cm3, water IF97 at 15.5 MPa, 580 K */
const pwA = 12.6*12.6 - disc(9.50);
const pwr = [{...UO2, A:disc(8.19), c:8.19},
  {...ZRC, A:disc(9.50) - disc(9.50 - 2*0.572), c:2*0.572},
  {...WAT, rho:rhoW(15.5, 580), A:pwA, c:4*pwA/(Math.PI*9.50)}];
const PWR_REAL = 1 - 0.974, AP = "AP1000 DCD Rev. 19, Table 4.4-1 (NRC ML11171A446): heat generated in fuel 97.4 %";
{ const h = heat(pwr, cell(pwr, false)), hf = heat(pwr, flat(pwr));
  check("PWR 17x17 cell at zero void: heat outside the fuel rod", h[2], PWR_REAL, 0.3, AP, {unit:"of core heat", gap:ROW,
    note:"in the pellet " + (h[0]*100).toFixed(2) + " %, in the can " + (h[1]*100).toFixed(2) + " %, water " + (h[2]*100).toFixed(2) +
      " %; by mass x mu_en alone the water reads " + (hf[2]*100).toFixed(2) + " %"}); }

/* RBMK-1000 cell: 250 mm graphite column with its 114 mm bore (rings and the Zr-Nb tube left out), 18 rods of 13.6 mm, clad 0.9, pellet 11.5 mm, in an 80 mm channel (the commonly quoted figures, no sheet re-read here); water at 7 MPa, 557 K */
const rbW = disc(80) - 18*disc(13.6), rbB = 250*250 - disc(114);
const rbmk = [{...UO2, A:18*disc(11.5), c:11.5},
  {...ZRC, A:18*(disc(13.6) - disc(13.6 - 2*0.9)), c:1.8},
  {...WAT, rho:rhoW(7.0, 557), A:rbW, c:4*rbW/(18*Math.PI*13.6)},
  {...GRA, A:rbB, c:4*rbB/(4*250 + Math.PI*114)}];
const INSAG = "INSAG-7: ~5.5 % of an RBMK-1000's heat is stopped in the graphite";
{ const h = heat(rbmk, cell(rbmk, false)), hf = heat(rbmk, flat(rbmk));
  check("RBMK-1000 cell at zero void: heat in the graphite", h[3], 0.055, 0.3, INSAG, {unit:"of core heat", gap:ROW,
    note:"in the pellet " + (h[0]*100).toFixed(2) + " %, water " + (h[2]*100).toFixed(2) + " %"});
  check("RBMK fault injected, self-shielding off: the graphite check fails", Math.abs(hf[3]/0.055 - 1) > 0.3 ? 1 : 0, 1, 0,
    "the graphite check above must be able to fail", {abs:true,
      note:"by mass x mu_en alone, the law before this job, the graphite reads " + (hf[3]*100).toFixed(2) + " %"}); }

/* Calder Hall zone B: 8 in square graphite lattice with a 3.95 in channel, 1.15 in natural U bar in a 0.072 in
   Magnox can (Nuclear Engineering, Dec. 1956); CO2 ideal gas at 0.79 MPa, 511 K */
const inch = 25.4, chB = 3.95*inch, chA = 8*inch*8*inch - disc(chB);
const MGX = {mu:mixA({Mg:1}), muen:mix({Mg:1}), rho:1.738, modK:0};
const cal = [{mu:mixA({U:1}), muen:mix({U:1}), rho:18.7, modK:0, A:disc(1.15*inch), c:1.15*inch},
  {...MGX, A:disc(1.15*inch + 2*0.072*inch) - disc(1.15*inch), c:2*0.072*inch},
  {mu:mixA({C:1, O:2}), muen:mix({C:1, O:2}), rho:1.1699e-3, modK:0, A:disc(chB) - disc(1.15*inch + 2*0.072*inch), c:chB - 1.15*inch},
  {...GRA, A:chA, c:4*chA/(4*8*inch + Math.PI*chB)}];
{ const h = heat(cal, cell(cal, false)), hf = heat(cal, flat(cal));
  check("a Magnox cell: heat in the graphite", h[3], h[3], 0.3,
    "no Calder Hall or Magnox graphite-heating figure found (20/09/26): searched the Dec. 1956 Nuclear Engineering sheet already cited here, IAEA and NEA Magnox literature", {unit:"of core heat", pass:false, gap:ROW,
      note:"source unconfirmed. The law reads " + (h[3]*100).toFixed(2) + " %, by mass x mu_en alone " + (hf[3]*100).toFixed(2) + " %"}); }

/* the thin-cell limit IS the uniform-fluence law: scale every Sl to nothing and the two must agree */
{ let worst = 0, worstF = 0;
  for(const regs of [pwr, rbmk, cal]){ const t = cell(regs, true), f = flat(regs);
    for(let i=0;i<regs.length;i++) worst = Math.max(worst, Math.abs(t[i] - f[i]));
    /* the fault: one generation only, the energy a collision does not absorb dropped instead of travelling on */
    let wt = 0; const w = regs.map(r => r.rho*r.mu*r.A);
    for(const x of w) wt += x;
    for(let i=0;i<regs.length;i++) worstF = Math.max(worstF, Math.abs(w[i]/wt*regs[i].muen/regs[i].mu - f[i])); }
  check("thin-cell limit: every Sl scaled to nothing, against mass x mu_en/rho", worst, 0, 1e-9,
    "analytic: P_rr -> 0 and g -> 1 leave deposition proportional to f*S*V = rho*mu_en*V", {abs:true});
  check("fault injected, the re-emitted 1-f dropped: the thin-limit check fails", worstF > 1e-9 ? 1 : 0, 1, 0,
    "the thin-limit check above must be able to fail", {abs:true, note:"worst " + worstF.toExponential(2)}); }

/* the drawn plant: the absorber's volume, its share, and the table the engine interpolates */
const LQ = G.LQ, HS = {G:G.HS_GRID, N:G.HS_OUT, abs:G.HS_ABS, cool:G.HS_COOL};
for(const pre of [0, 5]){
  G.plantPreset(pre); G.buildLayout();
  const nm = G.PLANTPRE[pre][0], c = G.priD(), L = c.lat, ab = G.ABSORB[L.abs];
  let nr = 0; for(let q=0;q<LQ*LQ;q++) if(L.rod[q] >= 0) nr++;
  const want = nr*G.absN(c)*Math.PI/4*G.absD(c)*G.absD(c);
  check(nm + ": drawn absorber area per unit height", G.latAbsA(c), want, 1e-12,
    "the drawing: " + nr + " rodded slots in the quarter x " + G.absN(c) + " rodlets of " + (G.absD(c)*1000).toFixed(2) + " mm", {abs:true, unit:"m2"});
  /* the old balance figure: a control channel weighed as 6 % of its ring */
  const M = G.latM(c), ringA = i => Math.PI*((i + 1)*(i + 1) - i*i)*M.dr*M.dr;
  let old6 = 0; for(const ch of M.chan) old6 += ringA(ch.i)*L.len*0.06*ab.dens;
  const drawn = G.latAbsA(c)*G.LAT_QUAD*L.len*ab.dens;
  check(nm + " fault injected, the old 6 %-of-a-ring figure: the absorber mass check fails", Math.abs(old6 - drawn) > 1e-12 ? 1 : 0, 1, 0,
    "the drawn absorber must not agree with the balance figure it replaced", {abs:true,
      note:"drawn " + drawn.toFixed(3) + " t against the old " + old6.toFixed(3) + " t"});

  const hs = G.heatShares(c), tab = hs.tab;
  /* nothing there absorbs nothing */
  let z = 0;
  for(let i=0;i<HS.G;i++) z = Math.max(z, Math.abs(tab[(i*HS.G)*HS.N + G.HS_GA]));
  check(nm + ": the absorber's share at rod coverage 0", z, 0, 0, "nothing there absorbs nothing", {abs:true});
  /* and so does no water */
  let zw = 0;
  for(let j=0;j<HS.G;j++) zw = Math.max(zw, Math.abs(tab[((HS.G - 1)*HS.G + j)*HS.N + G.HS_GW]));
  check(nm + ": the water's share of the gamma energy at full void", zw, 0, 0, "no water stops no gamma", {abs:true});

  /* the bank fully in, every Sl scaled away: the absorber takes its own mass x mu_en share of the cell */
  { const R = G.heatCellOf(c), n = R.sig.length, dep = new Float64Array(n), src = new Float64Array(n);
    const sig = Float64Array.from(R.sig, x => x*1e-9);
    src[0] = 1; G.heatCP(sig, R.vol, R.chord, R.f, src, dep);
    let t = 0; for(let i=0;i<n;i++) t += sig[i]*R.vol[i]*R.f[i];
    check(nm + ": the fully inserted absorber's gamma share in the thin limit", dep[HS.abs], t > 0 ? sig[HS.abs]*R.vol[HS.abs]*R.f[HS.abs]/t : 0, 1e-9,
      "analytic: the uniform-fluence law is mass x mu_en/rho", {abs:true}); }

  /* the 5 x 5 table against the fixed point solved where it is not tabulated */
  { let worst = 0, big = 0;
    for(const [al, cov] of [[0.1, 0.1], [0.3, 0.6], [0.6, 0.3], [0.9, 0.9]]){
      const R = G.heatCellOf(c), n = R.sig.length, dep = new Float64Array(n), src = new Float64Array(n), want = new Float64Array(HS.N);
      R.sig[HS.cool] *= 1 - al; R.vol[HS.abs] *= cov;
      src[0] = 1; G.heatCP(R.sig, R.vol, R.chord, R.f, src, dep);
      let sv = 0, vt = 0; for(let i=0;i<n;i++){ sv += R.sig[i]*R.vol[i]; vt += R.vol[i]; }
      const M2 = G.latM(c), Lc = 100*M2.dia*M2.hgt/Math.max(M2.hgt + M2.dia/2, 1e-9);
      const esc = vt > 0 ? 1/(1 + sv/vt*Lc) : 0, k = 1 - esc;
      want[G.HS_GW] = dep[HS.cool]*k; want[G.HS_GB] = dep[G.HS_BLK]*k;
      want[G.HS_GS] = dep[G.HS_TUBE]*k + esc; want[G.HS_GA] = dep[HS.abs]*k;
      const x = al*(HS.G - 1), y = cov*(HS.G - 1);
      const i0 = Math.min(HS.G - 2, Math.floor(x)), j0 = Math.min(HS.G - 2, Math.floor(y)), fx = x - i0, fy = y - j0;
      const o0 = (i0*HS.G + j0)*HS.N, o1 = ((i0 + 1)*HS.G + j0)*HS.N;
      for(let q=0;q<HS.N;q++){
        const got = (tab[o0+q]*(1 - fy) + tab[o0+HS.N+q]*fy)*(1 - fx) + (tab[o1+q]*(1 - fy) + tab[o1+HS.N+q]*fy)*fx;
        worst = Math.max(worst, Math.abs(got - want[q])); big = Math.max(big, want[q]); } }
    check(nm + ": the 5 x 5 table interpolated against the fixed point", worst, 0, 0.01*big,
      "the law against its own table, at (0.1, 0.1), (0.3, 0.6), (0.6, 0.3) and (0.9, 0.9)", {abs:true,
        note:"1 % of the largest gamma share solved there, " + (big*100).toFixed(3) + " %"}); }
}
