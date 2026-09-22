"use strict";
/* fission heat that never enters the pin: the photon data against NIST and ENDF, the Compton law against Evans, the cell solve against conservation and analytic limits, and the drawn cells against published shares */
const {check, load, FIS, inBundle} = require("./lib.js");
const G = load();
const ROW = "heat deposited outside the fuel";
const NIST = "Hubbell & Seltzer, NISTIR 5632 (NIST X-ray mass attenuation tables, read 22/09/26), mu/rho and mu_en/rho at 0.2, 0.6, 1.5, 3 and 6 MeV";

/* NIST mu/rho and mu_en/rho cm2/g at 0.2, 0.6, 1.5, 3, 6 MeV and IUPAC g/mol, typed a second time */
const MU = {H:[.2429,.1599,.1027,.06921,.04498], He:[.1224,.08054,.05173,.03503,.02307], Li:[.1060,.06968,.04476,.03043,.02030],
  Be:[.1089,.07155,.04597,.03138,.02121], B:[.1136,.07460,.04791,.03284,.02248], C:[.1229,.08058,.05179,.03562,.02469],
  O:[.1237,.08070,.05185,.03597,.02552], F:[.1176,.07649,.04915,.03422,.02457], Na:[.1199,.07736,.04968,.03487,.02559],
  Mg:[.1245,.07988,.05129,.03613,.02681], Zr:[.2237,.07756,.04700,.03644,.03374], Ag:[.2972,.08153,.04754,.03754,.03601],
  Cd:[.3038,.08064,.04673,.03698,.03563], In:[.3167,.08138,.04684,.03715,.03596], Hf:[.7339,.1058,.04944,.04030,.04155],
  U:[1.298,.1490,.05587,.04447,.04583]};
const EN = {H:[.05254,.05875,.05075,.03992,.02905], He:[.02647,.02959,.02555,.02019,.01493], Li:[.02290,.02559,.02210,.01753,.01316],
  Be:[.02353,.02627,.02268,.01806,.01377], B:[.02453,.02737,.02362,.01889,.01461], C:[.02655,.02956,.02551,.02048,.01607],
  O:[.02679,.02957,.02551,.02066,.01668], F:[.02554,.02801,.02416,.01964,.01607], Na:[.02635,.02830,.02437,.01997,.01675],
  Mg:[.02761,.02921,.02514,.02067,.01756], Zr:[.1164,.03025,.02257,.02033,.02193], Ag:[.1751,.03347,.02284,.02082,.02324],
  Cd:[.1813,.03339,.02247,.02051,.02300], In:[.1913,.03398,.02254,.02060,.02321], Hf:[.4645,.05409,.02447,.02212,.02620],
  U:[.6746,.08494,.02891,.02434,.02829]};
const AM = {H:1.008, He:4.0026, Li:6.94, Li7:7.016, Be:9.0122, B:10.81, C:12.011, O:15.999, F:18.998, Na:22.990, Mg:24.305,
  Zr:91.224, Ag:107.87, Cd:112.41, In:114.82, Hf:178.49, U:238.03};
const NG = 5;
/* Li-7 on lithium's figures per electron */
const el = (t, e) => e === "Li7" ? t.Li.map(x => x*AM.Li/AM.Li7) : t[e];
const wOf = f => { let m = 0; const w = {}; for(const e in f) m += f[e]*AM[e]; for(const e in f) w[e] = f[e]*AM[e]/m; return w; };
const mix = (t, w) => { const o = new Array(NG).fill(0); for(const e in w) for(let g=0;g<NG;g++) o[g] += w[e]*el(t, e)[g]; return o; };
const uzZr = 0.1/91.224/(0.1/91.224 + 0.9/238.03);
const WANT = [
  ["COOLANT", "PWR", {H:2, O:1}], ["COOLANT", "SFR", {Na:1}], ["COOLANT", "MSR", {Li7:.65, Be:.291, Zr:.05, U:.009, F:1.468}],
  ["COOLANT", "HTGR", {He:1}], ["COOLANT", "CO2", {C:1, O:2}],
  ["MODER", "GRAPHITE", {C:1}], ["MODER", "BERYLLIUM OXIDE", {Be:1, O:1}], ["MODER", "ZIRCONIUM HYDRIDE", {Zr:1, H:1.6}],
  ["FUEL", "UO2  4.9% LEU", {U:1, O:2}], ["FUEL", "U-ZR METALLIC", {U:1 - uzZr, Zr:uzZr}], ["FUEL", "U METAL NATURAL", {U:1}],
  ["CLAD", "ZIRCALOY", {Zr:1}], ["CLAD", "MAGNOX AL80", {Mg:1}], ["ABSORB", "BORON CARBIDE", {B:4, C:1}], ["ABSORB", "HAFNIUM", {Hf:1}]];
let worst = 0, worstBad = 0;
for(const [t, id, f] of WANT){
  const row = G[t].find(r => (r.id || r.name) === id), gm = G.gamOf(row), w = wOf(f), mu = mix(MU, w), en = mix(EN, w);
  for(let g=0;g<NG;g++){ worst = Math.max(worst, Math.abs(gm.mu[g]/mu[g] - 1), Math.abs(gm.en[g]/en[g] - 1));
    worstBad = Math.max(worstBad, Math.abs(gm.mu[g]*(id === "GRAPHITE" ? 1.1 : 1)/mu[g] - 1)); } }
{ const row = G.ABSORB.find(r => r.name === "SILVER-INDIUM-CADMIUM"), gm = G.gamOf(row), w = {Ag:.80, In:.15, Cd:.05}, mu = mix(MU, w), en = mix(EN, w);
  for(let g=0;g<NG;g++) worst = Math.max(worst, Math.abs(gm.mu[g]/mu[g] - 1), Math.abs(gm.en[g]/en[g] - 1)); }
check("every material row's mu/rho and mu_en/rho, five groups, worst", worst, 0, 0.005, NIST + ", mass-weighted over each row's composition typed again", {abs:true, unit:"of the value"});
check("fault injected, graphite's mu/rho x 1.1: the group check fails", worstBad > 0.005 ? 1 : 0, 1, 0, "the group check above must be able to fail", {abs:true});

const ENDF = "ENDF/B-VIII.0 n-092_U_235.endf MF=1 MT=458 at thermal: fragments 169.130, prompt neutrons 4.8276, delayed neutrons 0.008074, prompt gamma 7.2813, delayed gamma 6.330 +- 0.050, delayed beta 6.500 +- 0.050 MeV";
check("fission energy partition against MT=458", Math.abs(G.FIS_EF - FIS.ef) + Math.abs(G.FIS_EN - FIS.en) + Math.abs(G.FIS_EGP - FIS.egp) + Math.abs(G.FIS_EGD - FIS.egd) + Math.abs(G.FIS_EB - FIS.eb), 0, 1e-12, ENDF, {abs:true, unit:"MeV"});

/* Klein-Nishina: the energy a Compton collision takes, by Evans' closed forms against the code's own integrand */
{ const tot = a => 2*((1 + a)/(a*a)*(2*(1 + a)/(1 + 2*a) - Math.log(1 + 2*a)/a) + Math.log(1 + 2*a)/(2*a) - (1 + 3*a)/Math.pow(1 + 2*a, 2));
  const scat = a => Math.log(1 + 2*a)/(a*a*a) + 2*(1 + a)*(2*a*a - 2*a - 1)/(a*a*Math.pow(1 + 2*a, 2)) + 8*a*a/(3*Math.pow(1 + 2*a, 3));
  const num = a => { const lo = 1/(1 + 2*a), N = 200000; let s = 0, e = 0;
    for(let i=0;i<N;i++){ const x = lo + (1 - lo)*(i + 0.5)/N, d = G.knDs(a, x)*(1 - lo)/N; s += d; e += x*d; }
    return 1 - e/s; };
  let e = 0;
  for(const E of [0.1, 1]){ const a = E/0.51099895; e = Math.max(e, Math.abs(num(a) - (1 - scat(a)/tot(a)))); }
  check("Compton: mean fraction of the photon's energy given to the electron at 0.1 and 1 MeV, worst", e, 0, 1e-6,
    "Evans, The Atomic Nucleus (1955) ch. 23: sigma_tr/sigma = 1 - sigma_s/sigma from the Klein-Nishina closed forms, against the code's own dsigma/deps integrated", {abs:true});
  const a1 = 1/0.51099895, a01 = 0.1/0.51099895;
  check("Compton: that fraction at 1 MeV and 0.1 MeV", num(a1) + num(a01), 0.440 + 0.138, 0.002,
    "Attix, Introduction to Radiological Physics and Radiation Dosimetry (1986): T_avg/hv 0.440 at 1 MeV and 0.138 at 0.1 MeV", {note:"1 MeV " + num(a1).toFixed(4) + ", 0.1 MeV " + num(a01).toFixed(4)});
  let rs = 0; for(let g=0;g<NG;g++){ let s = 0; for(let h=0;h<NG;h++) s += G.GAM_TR[g*NG+h]; rs = Math.max(rs, Math.abs(s - 1)); }
  check("down-scatter matrix: every row lands all it re-emits", rs, 0, 1e-12, "conservation: a scattered photon lands in some group", {abs:true});
  let up = 0; for(let g=0;g<NG;g++) for(let h=g+1;h<NG;h++) up = Math.max(up, G.GAM_TR[g*NG+h]);
  check("down-scatter matrix: nothing scatters up", up, 0, 0, "Compton scattering only ever takes energy", {abs:true}); }

/* the prompt spectrum: N(E) = 6.6, 20.2 e^-1.78E, 7.2 e^-1.09E photons/MeV/fission (Lamarsh, as commonly quoted), integrated again */
{ const nE = E => E < 0.6 ? 6.6 : E < 1.5 ? 20.2*Math.exp(-1.78*E) : 7.2*Math.exp(-1.09*E), N = 400000;
  let n = 0, e = 0; for(let i=0;i<N;i++){ const E = 0.1 + 10.4*(i + 0.5)/N; n += nE(E)*10.4/N; e += E*nE(E)*10.4/N; }
  let s = 0, m = 0; for(let g=0;g<NG;g++){ s += G.GAM_FISS[g]; }
  const mean = e/n;
  let mc = 0; const edge = G.GAM_EDGE; for(let g=0;g<NG;g++){ let eg = 0, ng = 0;
    for(let i=0;i<N;i++){ const E = 0.1 + 10.4*(i + 0.5)/N; let h = 0; while(h < NG-1 && E >= edge[h+1]) h++; if(h === g){ eg += E*nE(E)*10.4/N; ng += nE(E)*10.4/N; } }
    mc = Math.max(mc, Math.abs(G.GAM_FISS[g] - eg/e)); }
  check("prompt fission photons: the group energies sum to the ENDF total", G.FIS_EGP*s, 7.2813, 1e-6, ENDF, {unit:"MeV"});
  check("prompt fission photons: each group's share of the energy against the spectrum integrated again, worst", mc, 0, 1e-4,
    "the U-235 prompt photon spectrum, Lamarsh (as commonly quoted, not read at source)", {abs:true, note:"mean photon " + mean.toFixed(3) + " MeV, " + n.toFixed(2) + " photons per fission"});
  const one = new Float64Array(NG); one[2] = 1; let b1 = 0; for(let g=0;g<NG;g++) b1 = Math.max(b1, Math.abs(one[g] - G.GAM_FISS[g]));
  check("fault injected, every photon at 1 MeV: the group check fails", b1 > 1e-4 ? 1 : 0, 1, 0, "the group check above must be able to fail", {abs:true}); }

/* the cell solve itself */
const solve = (n, sig, chord, f, share, src) => { const dep = new Float64Array(n); G.heatCP(n, sig, chord, f, share, src, dep); return dep; };
const flat = (n, v) => { const a = new Float64Array(n*NG); for(let i=0;i<n*NG;i++) a[i] = typeof v === "function" ? v(i) : v; return a; };
{ const n = 3, sig = flat(n, i => [0.8, 0.1, 0.05][(i/NG)|0]*(1 + (i%NG)/3)), f = flat(n, i => 0.2 + 0.1*(i%NG)), chord = Float64Array.from([1, 2, 30]);
  const share = Float64Array.from([0, 1, 0,  0.3, 0, 0.7,  0, 1, 0]), src = flat(n, i => i < NG ? 0.2 : 0);
  const d = solve(n, sig, chord, f, share, src);
  check("the cell solve conserves: deposited equals born, three regions, five groups", d[0] + d[1] + d[2], 1, 1e-12,
    "conservation: every state's exits (deposit, re-emission down-group, transit to a neighbour) sum to one", {abs:true}); }
{ const sig = flat(1, 0.3), f = flat(1, 0.4), src = flat(1, i => i === 4 ? 1 : 0);
  check("an infinite homogeneous medium (one region fills the cell) stops everything", solve(1, sig, Float64Array.from([Infinity]), f, new Float64Array(1), src)[0], 1, 1e-12,
    "conservation: nowhere to go", {abs:true}); }
/* the thin limit: every Sl -> 0 is a uniform fluence, where a collision falls in region r by S_r V_r whatever it was born in; cascaded by hand down the groups */
{ const n = 3, V = [1, 2, 5], S = [[0, 3, 0], [3, 0, 4], [0, 4, 0]], k = 1e-6;
  const sig = flat(n, i => [0.8, 0.1, 0.3][(i/NG)|0]*(1 + (i%NG)/4)*k), f = flat(n, i => 0.15 + 0.12*(i%NG) + 0.02*((i/NG)|0));
  const share = new Float64Array(n*n), chord = new Float64Array(n);
  for(let r=0;r<n;r++){ const A = S[r].reduce((a, b) => a + b, 0); chord[r] = 4*V[r]/A; for(let s=0;s<n;s++) share[r*n+s] = S[r][s]/A; }
  const src = flat(n, i => (i/NG|0) === 0 ? 0.2 : 0), d = solve(n, sig, chord, f, share, src);
  const E = new Array(NG).fill(0.2), want = [0, 0, 0], T = G.GAM_TR;
  for(let g=NG-1;g>=0;g--){ let sv = 0; for(let r=0;r<n;r++) sv += sig[r*NG+g]*V[r];
    const w = r => sig[r*NG+g]*V[r]/sv; let re = 0; for(let r=0;r<n;r++) re += w(r)*(1 - f[r*NG+g]);
    const tot = E[g]/(1 - re*T[g*NG+g]);
    for(let r=0;r<n;r++) want[r] += tot*w(r)*f[r*NG+g];
    for(let h=0;h<g;h++) E[h] += tot*re*T[g*NG+h]; }
  let e = 0; for(let r=0;r<n;r++) e = Math.max(e, Math.abs(d[r] - want[r]));
  check("thin-cell limit: every Sl scaled to 1e-6, against the uniform-fluence cascade by hand", e, 0, 1e-5,
    "analytic: with no self-shielding a collision lands by S V wherever the photon was born, a random walk over shared areas has its stationary weight on each region's surface, and 4V/S per crossing makes it S V", {abs:true}); }
/* a slab in an infinite lattice, the neighbour black: what the slab stops is its first-flight collision probability */
{ const E3 = x => { let e1; if(x < 1){ e1 = -0.5772156649 - Math.log(x); let t = 1; for(let k=1;k<40;k++){ t *= -x/k; e1 -= t/k; } }
    else { let f = 0; for(let k=60;k>=1;k--) f = k/(1 + k/(x + f)); e1 = Math.exp(-x)/(x + f); }
    return (Math.exp(-x)*(1 - x) + x*x*e1)/2; };
  let worstS = 0, note = [];
  for(const tau of [0.5, 1, 2]){ const sig = flat(2, i => i < NG ? tau : 1e9), f = flat(2, 1), share = Float64Array.from([0, 1, 1, 0]);
    const got = solve(2, sig, Float64Array.from([2, 1]), f, share, flat(2, i => i < NG ? 0.2 : 0))[0], want = 1 - (1 - 2*E3(tau))/(2*tau);
    worstS = Math.max(worstS, Math.abs(got/want - 1)); note.push("tau " + tau + ": " + got.toFixed(4) + " against " + want.toFixed(4)); }
  check("a slab's first-flight collision probability against the exact E3 escape, tau 0.5-2, worst", worstS, 0, 0.01,
    "Case, de Hoffmann & Placzek (1953): P_esc = (1 - 2 E3(tau))/(2 tau) for a uniform isotropic source in a slab; the law uses Wigner's rational approximation Sl/(1 + Sl), l = 4V/S",
    {abs:true, unit:"of the value", gap:ROW, note:note.join("; ")}); }

/* the drawn cells */
const at = pre => { G.plantPreset(pre); G.buildLayout(); const c = G.priD(); return {c, h:G.heatShares(c), name:G.PLANTPRE[pre][0]}; };
{ const {h, name} = at(0), out = h.water0 + h.struct0 + h.abs0;
  check(name + ": heat outside the fuel rod at rating", out, 1 - 0.974, 0.3,
    "AP1000 DCD Rev. 19, Table 4.4-1 (NRC ML11171A446): heat generated in fuel 97.4 %; the drawn cell is the Westinghouse 17x17 rod", {unit:"of core heat", gap:ROW,
      note:"water " + (h.water0*100).toFixed(2) + " %, structures " + (h.struct0*100).toFixed(2) + " %; capture gamma " + h.cap.EC.toFixed(2) + " MeV per fission"}); }
{ const {c, h, name} = at(5);
  check(name + ": heat in the graphite at rating", h.block0, 0.055, 0.3,
    "INSAG-7: ~5.5 % of an RBMK-1000's heat is stopped in the graphite; the drawn cell is the RBMK-1000's own (250 mm column, 80 mm tube, 18 rods of 13.6 mm)", {unit:"of core heat", gap:ROW,
      note:"water " + (h.water0*100).toFixed(2) + " %, tube and escape " + (h.struct0*100).toFixed(2) + " %, capture gamma " + h.cap.EC.toFixed(2) + " MeV per fission"});
  /* the fault: the old open boundary, a photon that does not collide in its own region landing anywhere in the cell by weight */
  const src = G.heatCP.toString();
  inBundle("heatCP = function(n,sig,chord,f,share,src,dep){ const NG=GAM_NG; const w=new Float64Array(n*NG); let cur=Float64Array.from(src);" +
    " for(let r=0;r<n;r++) dep[r]=0; for(let p=0;p<400;p++){ const nx=new Float64Array(n*NG); for(let g=0;g<NG;g++){ let wt=0, esc=0;" +
    " for(let r=0;r<n;r++){ const sl=sig[r*NG+g]*chord[r]; w[r*NG+g]= sl>1e-9 && isFinite(sl) ? sig[r*NG+g]*(1-Math.exp(-sl))/sl : sig[r*NG+g]; wt+=w[r*NG+g]; }" +
    " for(let r=0;r<n;r++){ const i=r*NG+g, sl=sig[i]*chord[r], pc=isFinite(sl)? sl/(1+sl):1, e=cur[i]; const hit=e*pc; esc+=e-hit; const d=hit*f[i]; dep[r]+=d; for(let h=0;h<=g;h++) nx[r*NG+h]+=(hit-d)*GAM_TR[g*NG+h]; }" +
    " for(let r=0;r<n;r++) nx[r*NG+g]+= wt>0 ? esc*w[r*NG+g]/wt : 0; } cur=nx; } return dep; };");
  c.rodw += 1e-9;
  const old = G.heatShares(c).block0;
  inBundle("heatCP = " + src + ";");
  c.rodw -= 1e-9;
  check(name + ": fault injected, the old open boundary: the graphite share moves", Math.abs(old/h.block0 - 1) > 0.1 ? 1 : 0, 1, 0,
    "the graphite check above reads the boundary law", {abs:true, note:"open boundary " + (old*100).toFixed(2) + " % against " + (h.block0*100).toFixed(2) + " %"}); }
{ const {h, name} = at(6);
  check(name + ": heat in the graphite at rating", h.block0, 0.06, 0.3,
    "MSRE: 94 % of the energy into the salt and 6 % into the graphite (ANL/NSE-23/8, Updated SAM Model for the MSRE, 2023, off the ORNL design reports)", {unit:"of core heat", gap:ROW,
      note:"salt (coolant) " + (h.water0*100).toFixed(2) + " %; the drawing lays graphite in one slot in four, where the MSRE core is ~78 % graphite by volume"}); }
check("CALDER HALL: heat in the graphite", 0, 0, 0,
  "no Calder Hall or Magnox graphite-heating figure found (searched 20/09/26 and 22/09/26): no check", {pass:false, gap:ROW, note:"the law reads " + (at(7).h.block0*100).toFixed(2) + " %"});

/* the drawn table: nothing where the drawing has nothing, and the 5 x 5 grid against the point it interpolates */
for(const pre of [0, 5]){
  const {c, name} = at(pre), hs = G.heatShares(c), tab = hs.tab, HG = G.HS_GRID, HO = G.HS_OUT;
  let z = 0; for(let i=0;i<HG;i++) z = Math.max(z, Math.abs(tab[(i*HG)*HO + 3]), Math.abs(tab[(i*HG)*HO + 7]));
  check(name + ": the absorber's share at rod coverage 0", z, 0, 0, "nothing there absorbs nothing", {abs:true});
  let zw = 0; for(let j=0;j<HG;j++) zw = Math.max(zw, Math.abs(tab[((HG - 1)*HG + j)*HO]), Math.abs(tab[((HG - 1)*HG + j)*HO + 4]));
  check(name + ": the water's share at full void", zw, 0, 0, "no water stops nothing", {abs:true});
  let worst = 0, big = 0; const o = new Float64Array(HO);
  for(const [al, cov] of [[0.1, 0.1], [0.3, 0.6], [0.6, 0.3], [0.9, 0.9]]){
    G.heatPointA(c, al, cov, hs.Q0, o, 0);
    const x = al*(HG - 1), y = cov*(HG - 1), i0 = Math.min(HG - 2, Math.floor(x)), j0 = Math.min(HG - 2, Math.floor(y)), fx = x - i0, fy = y - j0;
    const a0 = (i0*HG + j0)*HO, a1 = ((i0 + 1)*HG + j0)*HO;
    for(let q=0;q<HO;q++){ const got = (tab[a0+q]*(1 - fy) + tab[a0+HO+q]*fy)*(1 - fx) + (tab[a1+q]*(1 - fy) + tab[a1+HO+q]*fy)*fx;
      worst = Math.max(worst, Math.abs(got - o[q])); big = Math.max(big, o[q]); } }
  check(name + ": the 5 x 5 table interpolated against the solve at the point", worst, 0, 0.01*big,
    "the law against its own table at (0.1, 0.1), (0.3, 0.6), (0.6, 0.3) and (0.9, 0.9)", {abs:true, note:"1 % of the largest share solved there, " + (big*100).toFixed(3) + " %"});
}
