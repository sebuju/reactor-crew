"use strict";
// chunks: data law mc cells table
/* fission heat that never enters the pin: the photon data against NIST and ENDF, the Compton law against Evans, the cell solve against exact integrals, conservation and an independent photon walk, and the drawn cells against published shares */
const {check, load, FIS, inBundle} = require("./lib.js");
const mode = process.argv[2];
const G = load();
const ROW = "heat deposited outside the fuel", ROW2 = "the gamma cell's slot scale";
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
const at = pre => { G.plantPreset(pre); G.buildLayout(); const c = G.priD(); return {c, h:G.heatShares(c), name:G.PLANTPRE[pre][0]}; };
/* the old law, typed again as the fault: Wigner's rational collision in each HS region on 4V/S, and a photon that does not collide entering a neighbour by shared area */
inBundle("globalThis.HS_OLDLAW=function(c,K,R,al,cov,s,dep){ const v=latVols(c), a=COOLANT[c.cool], n=HS_N, NG=GAM_NG, p=c.lat.pitch, nRod=v.nF*latBundle(c).nRod, area=new Float64Array(n*n);" +
  " const touch=(r,q,A)=>{ if(A>0){ area[r*n+q]+=A; area[q*n+r]+=A; } };" +
  " touch(HS_FUEL,HS_CLAD,nRod*Math.PI*rodDP(c)); touch(HS_CLAD,HS_COOL,nRod*Math.PI*rodD(c));" +
  " if(c.tube){ const b=tubeBoreMm(c)/1000, t=tubeWallMm(a.P0,a,c)/1000; touch(HS_COOL,HS_TUBE,v.nF*Math.PI*b); touch(HS_TUBE,HS_BLK,v.nF*Math.PI*(b+2*t)); }" +
  " else touch(HS_COOL,HS_BLK,latModFaces(c)*p);" +
  " touch(HS_ABS,HS_COOL,latRodded(c)*absN(c)*Math.PI*absD(c)*cov);" +
  " const pc=new Float64Array(n*NG), share=new Float64Array(n*n), N=n*NG, A=new Float64Array(N*N), x=Float64Array.from(s);" +
  " for(let r=0;r<n;r++){ let S=0; for(let q=0;q<n;q++) if(q!==r&&R.vol[q]>0) S+=area[r*n+q]; const l= R.vol[r]>0&&S>0 ? 400*R.vol[r]/S : Infinity;" +
  "  for(let q=0;q<n;q++) if(q!==r&&R.vol[q]>0&&S>0) share[r*n+q]=area[r*n+q]/S;" +
  "  for(let g=0;g<NG;g++){ const sl=R.sig[r*NG+g]*l; pc[r*NG+g]= S>0 ? sl/(1+sl) : 1; } }" +
  " for(let i=0;i<N;i++) A[i*N+i]=1;" +
  " for(let r=0;r<n;r++) for(let g=0;g<NG;g++){ const i=r*NG+g, m=pc[i]*(1-R.f[i]), t=1-pc[i];" +
  "  for(let h=0;h<=g;h++) A[(r*NG+h)*N+i]-=m*GAM_TR[g*NG+h]; for(let q=0;q<n;q++) A[(q*NG+g)*N+i]-=t*share[r*n+q]; }" +
  " for(let k=0;k<N;k++){ let p=k, big=Math.abs(A[k*N+k]); for(let i=k+1;i<N;i++) if(Math.abs(A[i*N+k])>big){ big=Math.abs(A[i*N+k]); p=i; }" +
  "  if(p!==k){ for(let j=0;j<N;j++){ const y=A[k*N+j]; A[k*N+j]=A[p*N+j]; A[p*N+j]=y; } const y=x[k]; x[k]=x[p]; x[p]=y; }" +
  "  const d=A[k*N+k]; if(!(Math.abs(d)>0)) continue; for(let i=k+1;i<N;i++){ const l=A[i*N+k]/d; if(!l) continue; for(let j=k;j<N;j++) A[i*N+j]-=l*A[k*N+j]; x[i]-=l*x[k]; } }" +
  " for(let k=N-1;k>=0;k--){ let q=x[k]; for(let j=k+1;j<N;j++) q-=A[k*N+j]*x[j]; x[k]= A[k*N+k] ? q/A[k*N+k] : 0; }" +
  " dep.fill(0); for(let i=0;i<N;i++) dep[(i/NG)|0]+=x[i]*pc[i]*R.f[i]; return dep; };");
/* energy deposited per HS region, as shares, from a unit source src[r*NG+g] in the drawn lattice with no core escape */
const depose = (c, src, law, al = 0, cov = 0) => { const R = G.heatCellOf(c, al, cov), d = new Float64Array(G.HS_N);
  (law || G.gamDepose)(c, G.gamKit(c), R, al, cov, src, d); let t = 0; for(const x of d) t += x; return {d, t, s:d.map(x => x/t)}; };
const fisSrc = r => { const s = new Float64Array(G.HS_N*NG); for(let g=0;g<NG;g++) s[r*NG+g] = G.GAM_FISS[g]; return s; };

if(mode === "data"){
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
    let s = 0; for(let g=0;g<NG;g++){ s += G.GAM_FISS[g]; }
    const mean = e/n;
    let mc = 0; const edge = G.GAM_EDGE; for(let g=0;g<NG;g++){ let eg = 0;
      for(let i=0;i<N;i++){ const E = 0.1 + 10.4*(i + 0.5)/N; let h = 0; while(h < NG-1 && E >= edge[h+1]) h++; if(h === g) eg += E*nE(E)*10.4/N; }
      mc = Math.max(mc, Math.abs(G.GAM_FISS[g] - eg/e)); }
    check("prompt fission photons: the group energies sum to the ENDF total", G.FIS_EGP*s, 7.2813, 1e-6, ENDF, {unit:"MeV"});
    check("prompt fission photons: each group's share of the energy against the spectrum integrated again, worst", mc, 0, 1e-4,
      "the U-235 prompt photon spectrum, Lamarsh (as commonly quoted, not read at source)", {abs:true, note:"mean photon " + mean.toFixed(3) + " MeV, " + n.toFixed(2) + " photons per fission"});
    const one = new Float64Array(NG); one[2] = 1; let b1 = 0; for(let g=0;g<NG;g++) b1 = Math.max(b1, Math.abs(one[g] - G.GAM_FISS[g]));
    check("fault injected, every photon at 1 MeV: the group check fails", b1 > 1e-4 ? 1 : 0, 1, 0, "the group check above must be able to fail", {abs:true}); }
}

if(mode === "law"){
  /* Ki3 by an independent quadrature: the midpoint rule on its defining integral over the angle */
  const ki3 = x => { const N = 200000; let s = 0; for(let i=0;i<N;i++){ const u = Math.PI/2*(i + 0.5)/N, c = Math.cos(u); s += c*c*Math.exp(-x/c); } return s*Math.PI/2/N; };
  let wk = 0, nk = [];
  for(const x of [0, 0.5, 2, 8]){ const a = G.gamKi3(x), b = ki3(x); wk = Math.max(wk, Math.abs(a/b - 1)); nk.push(x + ": " + a.toPrecision(8)); }
  check("Bickley Ki3 at 0, 0.5, 2 and 8 against its integral taken again, worst", wk, 0, 1e-6,
    "Ki3(x) = int_0^pi/2 cos^2 u e^(-x/cos u) du, midpoint rule at 200 000 points; Ki3(0) = pi/4", {abs:true, unit:"of the value", note:nk.join(", ")});

  /* first-flight escape from a uniform isotropic source in an infinite cylinder: the direct integral over the section, the azimuth and the polar angle */
  const escExact = x => { const N = 260; let s = 0;
    for(let i=0;i<N;i++){ const r = (i + 0.5)/N; let t = 0;
      for(let j=0;j<N;j++){ const ps = Math.PI*(j + 0.5)/N, d = -r*Math.cos(ps) + Math.sqrt(1 - r*r*Math.sin(ps)**2); let k = 0;
        for(let q=0;q<N;q++){ const u = Math.PI/2*(q + 0.5)/N, cu = Math.cos(u); k += cu*Math.exp(-x*d/cu); }
        t += k*Math.PI/2/N; }
      s += 2*r*t/N/N; }
    return s; };
  const cyl = {s:2, circ:[0, 0, 1], n:2, sub:(x, y) => x*x + y*y < 1 ? 0 : 1}, T = G.gamTrack(cyl, 32, 0.004);
  const escLaw = x => { const sig = new Float64Array(2*NG); for(let g=0;g<NG;g++) sig[g] = x; return G.gamCP(T, sig).PS[0][0]; };
  const cylCheck = (tag, fault) => { let w = 0; const nt = [];
    for(const x of [0.1, 0.5, 2]){ const a = escLaw(x), b = escExact(x); w = Math.max(w, Math.abs(a/b - 1)); nt.push("SR " + x + ": " + a.toFixed(5) + " against " + b.toFixed(5)); }
    return {w, nt}; };
  const cy = cylCheck();
  check("a cylinder's first-flight escape against the exact integral, SR 0.1, 0.5 and 2, worst", cy.w, 0, 0.005,
    "exact: P_esc = (1/V) int dA (1/2pi) int dpsi Ki2(S d), Ki2 by its angle integral, all taken by quadrature in the test; the law tracked at 32 angles, 0.04 mm lines", {abs:true, unit:"of the value", note:cy.nt.join("; ")});
  const ki3Src = G.gamKi3.toString();
  inBundle("gamKi3=function(x){ if(!GAM_KI2) gamKiBuild(); if(!(x<GAM_KX)) return 0; const u=x/GAM_KH, i=u|0, t=u-i; return GAM_KI2[i]*(1-t)+GAM_KI2[i+1]*t; };");
  const bad = cylCheck();
  inBundle("gamKi3=" + ki3Src + ";");
  check("fault injected, Ki2 in place of Ki3: the cylinder check fails", bad.w > 0.005 ? 1 : 0, 1, 0, "the cylinder check above must be able to fail", {abs:true, note:"worst " + (bad.w*100).toFixed(1) + " %"});

  /* the drawn RBMK cell */
  const {c} = at(5), K = G.gamKit(c), R = G.heatCellOf(c, 0, 0), n = K.cell.n;
  const sig = new Float64Array(n*NG);
  for(let k=0;k<n;k++) for(const [r, x] of K.cell.comp[k]) for(let g=0;g<NG;g++) sig[k*NG+g] += x*R.sig[r*NG+g];
  const cp = G.gamCP(K.T, sig);
  let rec = 0, big = 0;
  for(let g=0;g<NG;g++) for(let i=0;i<n;i++) for(let j=0;j<n;j++) big = Math.max(big, cp.p[g][i*n+j]);
  for(let g=0;g<NG;g++) for(let i=0;i<n;i++) for(let j=0;j<i;j++){ const a = cp.p[g][i*n+j], b = cp.p[g][j*n+i];
    if(Math.max(a, b) > 1e-9*big) rec = Math.max(rec, Math.abs(a - b)/Math.max(a, b)); }
  check(G.PLANTPRE[5][0] + ": reciprocity V_i S_i P_ij = V_j S_j P_ji before renormalisation, worst", rec, 0, 0.01,
    "reciprocity of first-flight collision probabilities (Hebert, Applied Reactor Physics, 2009, ch. 3)", {abs:true, unit:"of the value"});
  /* the tracked volumes against the drawing's own, per HS region */
  { const V = new Float64Array(G.HS_N);
    for(const [C, T] of [[K.cell, K.T], [K.ch, K.TC]]) if(C) for(let k=0;k<C.n;k++) for(const [r, x] of C.comp[k]) V[r] += T.V[k]*x*1e-4*C.nCell;
    let w = 0; const nt = []; for(const r of [G.HS_FUEL, G.HS_CLAD, G.HS_COOL, G.HS_BLK, G.HS_TUBE, G.HS_CW, G.HS_CT]) if(R.vol[r] > 0){ w = Math.max(w, Math.abs(V[r]/R.vol[r] - 1)); nt.push(r + ": " + (V[r]/R.vol[r]).toFixed(5)); }
    check(G.PLANTPRE[5][0] + ": the tracked volumes against the drawn ones, fuel, clad, water, block, tube and the control channels', worst", w, 0, 0.005,
      "geometry: the tracks' lengths times their spacing are the areas they cross", {abs:true, unit:"of the value", note:nt.join(", ")}); }

  /* conservation after the chain, with blocks and an absorber between the cells */
  { let w = 0; const nt = [];
    for(const [pre, cov] of [[5, 0], [7, 1], [0, 1]]){ const {c} = at(pre), s = fisSrc(G.HS_FUEL), cs = new Float64Array(G.HS_N*NG), V = G.heatCellOf(c, 0.4, cov).vol;
      for(let r=0;r<G.HS_N;r++) if(V[r] > 0) for(let g=0;g<NG;g++) cs[r*NG+g] = (0.1 + 0.05*r)*G.GAM_FISS[g];
      for(const src of [s, cs]){ let t = 0; for(const x of src) t += x; const d = depose(c, src, null, 0.4, cov); w = Math.max(w, Math.abs(d.t - t)); }
      nt.push(G.PLANTPRE[pre][0] + " at coverage " + cov); }
    check("the chain conserves: deposited equals born, worst", w, 0, 1e-12, "conservation: every state's exits (deposit, re-emission down-group, transit) sum to one", {abs:true, note:nt.join(", ")}); }
  { const one = {s:1, circ:[], n:1, sub:() => 0}, T1 = G.gamTrack(one, 4, 0.05), sg = new Float64Array(4*NG).fill(0.3), f = new Float64Array(4*NG).fill(0.4);
    const src = new Float64Array(4*NG); src[4] = 1; const d = new Float64Array(4*NG);
    G.gamChain(G.gamCP(T1, sg), 1, {fM:0, fA:0, lM:Infinity, lA:Infinity}, sg, f, src, d);
    let dep = 0; for(let g=0;g<NG;g++) dep += d[g];
    check("an infinite homogeneous medium (one region, white edge) stops everything in itself", dep, 1, 1e-12, "conservation: nowhere to go", {abs:true}); }

  /* the thin limit: every S scaled by 1e-6 is a uniform fluence, where a collision falls in each state by S V whatever it was born in; cascaded by hand down the groups */
  { const {c, name} = at(7), cov = 1, R = G.heatCellOf(c, 0, cov), k = 1e-6, K = G.gamKit(c), cell = K.cell, n = cell.n, p = c.lat.pitch;
    const Rt = Object.assign({}, R, {sig:R.sig.map(x => x*k)}), d = new Float64Array(G.HS_N);
    G.gamDepose(c, K, Rt, 0, cov, fisSrc(G.HS_FUEL), d);
    const st = [];
    for(let q=0;q<n;q++){ const V = K.T.V[q]*1e-4*cell.nCell; for(const [r, x] of cell.comp[q]) st.push({r, V:V*x}); }
    st.push({r:G.HS_BLK, V:G.latVols(c).nM*p*p}, {r:G.HS_ABS, V:G.latAbsA(c)*cov});
    const want = new Float64Array(G.HS_N), E = Array.from(G.GAM_FISS), T = G.GAM_TR;
    for(let g=NG-1;g>=0;g--){ let sv = 0; for(const s of st) sv += Rt.sig[s.r*NG+g]*s.V;
      const w = s => Rt.sig[s.r*NG+g]*s.V/sv; let re = 0; for(const s of st) re += w(s)*(1 - Rt.f[s.r*NG+g]);
      const tot = E[g]/(1 - re*T[g*NG+g]);
      for(const s of st) want[s.r] += tot*w(s)*Rt.f[s.r*NG+g];
      for(let h=0;h<g;h++) E[h] += tot*re*T[g*NG+h]; }
    let e = 0; for(let r=0;r<G.HS_N;r++) e = Math.max(e, Math.abs(d[r] - want[r]));
    check(name + ", bank in: every S scaled by 1e-6, against the uniform-fluence cascade by hand, worst region", e, 0, 1e-5,
      "analytic: with no self-shielding a collision lands by S V wherever the photon was born; the cells, the blocks and the absorber all see one fluence", {abs:true,
        note:"absorber " + (want[G.HS_ABS]*100).toFixed(3) + " %, blocks " + (want[G.HS_BLK]*100).toFixed(2) + " %"}); }

  /* a slab between black cells: what the slab stops is its first-flight collision probability, the level-2 Wigner law's own case */
  { const E3 = x => { let e1; if(x < 1){ e1 = -0.5772156649 - Math.log(x); let t = 1; for(let k=1;k<40;k++){ t *= -x/k; e1 -= t/k; } }
      else { let f = 0; for(let k=60;k>=1;k--) f = k/(1 + k/(x + f)); e1 = Math.exp(-x)/(x + f); }
      return (Math.exp(-x)*(1 - x) + x*x*e1)/2; };
    const one = {s:1, circ:[], n:1, sub:() => 0}, T1 = G.gamTrack(one, 4, 0.05);
    let worstS = 0; const note = [];
    for(const tau of [0.5, 1, 2]){ const sg = new Float64Array(4*NG), f = new Float64Array(4*NG).fill(1), src = new Float64Array(4*NG), d = new Float64Array(4*NG);
      for(let g=0;g<NG;g++){ sg[g] = 1e9; sg[2*NG+g] = tau; } src[2*NG] = 1;
      G.gamChain(G.gamCP(T1, sg), 1, {fM:1, fA:0, lM:2, lA:1}, sg, f, src, d);
      const got = d[2*NG], want = 1 - (1 - 2*E3(tau))/(2*tau);
      worstS = Math.max(worstS, Math.abs(got/want - 1)); note.push("tau " + tau + ": " + got.toFixed(4) + " against " + want.toFixed(4)); }
    check("a slab block's first-flight collision probability against the exact E3 escape, tau 0.5-2, worst", worstS, 0, 0.01,
      "Case, de Hoffmann & Placzek (1953): P_esc = (1 - 2 E3(tau))/(2 tau) for a uniform isotropic source in a slab; the blocks between cells use Wigner's rational Sl/(1 + Sl), l = 4V/S",
      {abs:true, unit:"of the value", gap:ROW2, note:note.join("; ")}); }
}

if(mode === "mc"){
  /* an analog photon walk through the drawn RBMK cell, its own geometry: rods laid again by the ring rule, a mirror square edge, isotropic re-emission */
  /* one fuel cell against its mirror images, so the drawing's control channels go back to fuel for this walk */
  const {c, name} = at(5); for(let q=0;q<G.LQ*G.LQ;q++) if(c.lat.slot[q] === G.L_CPS) c.lat.slot[q] = G.L_FUEL;
  G.latRevolve(c); const R = G.heatCellOf(c, 0, 0), T = G.GAM_TR, a = G.COOLANT[c.cool];
  const FU = G.HS_FUEL, CL = G.HS_CLAD, CO = G.HS_COOL, BL = G.HS_BLK, TU = G.HS_TUBE;
  const h = 50*c.lat.pitch, rb = c.tube.bore/20, rt = rb + G.tubeWallMm(a.P0, a, c)/10, rc = 50*c.rodD, rp = rc - 100*G.cladOf(c).thick;
  const nR = Math.round(Math.pow(G.LAT_P0/c.rodP, 2)), rings = [];
  { let left = nR; if(nR % 6 === 1){ rings.push(1); left--; } for(let k=1;left>0;k++){ rings.push(Math.min(6*k, left)); left -= Math.min(6*k, left); } }
  const rods = []; { let cum = 0, R0 = 0;
    rings.forEach((m, i) => { const k = nR % 6 === 1 ? i : i + 1, R1 = rb*Math.sqrt((cum += m)/nR);
      const rr = k === 0 ? 0 : Math.min(2/3*(R1**3 - R0**3)/(R1**2 - R0**2), rb - rc), ph = k % 2 ? 0 : Math.PI/m;
      for(let j=0;j<m;j++) rods.push([rr*Math.cos(ph + 2*Math.PI*j/m), rr*Math.sin(ph + 2*Math.PI*j/m)]); R0 = R1; }); }
  const circ = [[0, 0, rb], [0, 0, rt]]; for(const [x, y] of rods) circ.push([x, y, rp], [x, y, rc]);
  const where = (x, y) => { const d = Math.hypot(x, y); if(d >= rt) return BL; if(d >= rb) return TU;
    for(const [u, v] of rods){ const e = (x - u)**2 + (y - v)**2; if(e < rc*rc) return e < rp*rp ? FU : CL; } return CO; };
  let seed = 12345; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; };
  const iso = o => { const mu = 2*rnd() - 1, ph = 2*Math.PI*rnd(), s = Math.sqrt(1 - mu*mu); o[0] = s*Math.cos(ph); o[1] = s*Math.sin(ph); o[2] = mu; };
  /* Klein-Nishina polar angle at E MeV (Kahn's rejection as in Butcher & Messel 1960), the direction turned by it */
  const kn = (o, E) => { const k = E/0.51099895, e0 = 1/(1 + 2*k), a1 = Math.log(1/e0), a2 = (1 - e0*e0)/2; let ct;
    for(;;){ let e; if(rnd()*(a1 + a2) < a1) e = Math.exp(-a1*rnd()); else e = Math.sqrt(e0*e0 + (1 - e0*e0)*rnd());
      const t = (1 - e)/(k*e), s2 = t*(2 - t); if(rnd() < 1 - e*s2/(1 + e*e)){ ct = 1 - t; break; } }
    const st = Math.sqrt(Math.max(0, 1 - ct*ct)), ph = 2*Math.PI*rnd(), [u, v, w] = o;
    if(Math.abs(w) > 0.99999){ o[0] = st*Math.cos(ph); o[1] = st*Math.sin(ph); o[2] = w*ct; return; }
    const q = Math.sqrt(1 - w*w);
    o[0] = st*(u*w*Math.cos(ph) - v*Math.sin(ph))/q + u*ct; o[1] = st*(v*w*Math.cos(ph) + u*Math.sin(ph))/q + v*ct; o[2] = -st*Math.cos(ph)*q + w*ct; };
  const walk = (N, born, knA) => { const tal = new Float64Array(8), sq = new Float64Array(8), one = new Float64Array(8), o = [0, 0, 0];
    for(let n=0;n<N;n++){ one.fill(0); let [x, y, g] = born(), w = 1; iso(o);
      for(;;){ const r = where(x, y), S = R.sig[r*NG+g], sp = Math.hypot(o[0], o[1]);
        const dc = (S > 0 ? -Math.log(1 - rnd())/S : Infinity)*sp;
        let db = Infinity, hit = 0;
        if(sp > 1e-12){ const ux = o[0]/sp, uy = o[1]/sp;
          for(const [cx, cy, cr] of circ){ const dx = x - cx, dy = y - cy, b = dx*ux + dy*uy, e = b*b - (dx*dx + dy*dy - cr*cr);
            if(e > 0){ const z = Math.sqrt(e), t1 = -b - z, t2 = -b + z; if(t1 > 1e-10 && t1 < db){ db = t1; hit = 0; } else if(t2 > 1e-10 && t2 < db){ db = t2; hit = 0; } } }
          if(ux > 0 && (h - x)/ux < db){ db = (h - x)/ux; hit = 1; } if(ux < 0 && (-h - x)/ux < db){ db = (-h - x)/ux; hit = 1; }
          if(uy > 0 && (h - y)/uy < db){ db = (h - y)/uy; hit = 2; } if(uy < 0 && (-h - y)/uy < db){ db = (-h - y)/uy; hit = 2; }
          if(dc >= db){ x += ux*db; y += uy*db;
            if(hit === 1){ o[0] = -o[0]; x = Math.sign(x)*h; } else if(hit === 2){ o[1] = -o[1]; y = Math.sign(y)*h; }
            x += o[0]/sp*1e-9; y += o[1]/sp*1e-9; continue; }
          x += ux*dc; y += uy*dc; }
        const f = R.f[r*NG+g]; one[r] += w*f; w *= 1 - f;
        let u = rnd(), hh = g; for(let q=0;q<=g;q++){ u -= T[g*NG+q]; if(u < 0){ hh = q; break; } }
        if(knA) kn(o, G.GAM_E[g]); else iso(o);
        g = hh;
        if(w < 1e-3){ if(rnd() < w/1e-3) w = 1e-3; else break; } }
      for(let r=0;r<8;r++){ tal[r] += one[r]; sq[r] += one[r]*one[r]; } }
    return {m:r => tal[r]/N, sd:r => Math.sqrt(Math.max(0, sq[r]/N - (tal[r]/N)**2)/N)}; };
  const inFuel = () => { const [u, v] = rods[Math.floor(rnd()*rods.length)], r = rp*Math.sqrt(rnd()), t = 2*Math.PI*rnd();
    return [u + r*Math.cos(t), v + r*Math.sin(t), (() => { let e = rnd(); for(let g=0;g<NG;g++){ e -= G.GAM_FISS[g]; if(e < 0) return g; } return NG - 1; })()]; };
  const gC = G.gamLine(G.NUC.C.Ec).indexOf(1);
  const inBlock = () => { for(;;){ const x = (2*rnd() - 1)*h, y = (2*rnd() - 1)*h; if(Math.hypot(x, y) >= rt) return [x, y, gC]; } };
  const N = 20000, wF = walk(N, inFuel), wC = walk(N, inBlock);
  const lawF = depose(c, fisSrc(FU)), cs = new Float64Array(G.HS_N*NG); cs[BL*NG+gC] = 1; const lawC = depose(c, cs);
  const oldF = depose(c, fisSrc(FU), G.HS_OLDLAW);
  const SRC = "an analog photon walk written in the test: its own geometry of the drawn cell (rods by the ring rule, laid again), a mirror square edge, the code's sig, mu_en/mu and GAM_TR, isotropic re-emission, " + N + " histories, seed fixed";
  const tol = x => Math.max(0.03*x, 0.005);
  for(const [tag, law, wk] of [["fission photons born in the fuel", lawF, wF], ["carbon's 4.95 MeV capture line born in the graphite", lawC, wC]])
    for(const [rn, r] of [["graphite", BL], ["fuel", FU]])
      check(name + ", " + tag + ": share stopped in the " + rn + ", the law against the walk", law.s[r], wk.m(r), tol(wk.m(r)), SRC,
        {abs:true, note:"walk sigma " + wk.sd(r).toFixed(4) + "; tolerance max(3 %, 0.005)"});
  check(name + ": fault injected, the old by-area network: the graphite check fails", Math.abs(oldF.s[BL] - wF.m(BL)) > tol(wF.m(BL)) ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"by-area " + oldF.s[BL].toFixed(3) + " against the walk's " + wF.m(BL).toFixed(3)});
  const wK = walk(N, inFuel, true);
  check(name + ", fission photons in the fuel: the walk's graphite share with Klein-Nishina angles (the isotropy cut, a reading)", wK.m(BL), wF.m(BL), 0, SRC + "; Klein-Nishina polar angles at each group's energy",
    {pass:true, note:"forward-peaked " + wK.m(BL).toFixed(4) + " against isotropic " + wF.m(BL).toFixed(4) + ", sigma " + wK.sd(BL).toFixed(4)});
}

if(mode === "cells"){
  { const {h, name} = at(0), out = h.water0 + h.struct0 + h.abs0;
    check(name + ": heat outside the fuel rod at rating", out, 1 - 0.974, 0.3,
      "AP1000 DCD Rev. 19, Table 4.4-1 (NRC ML11171A446): heat generated in fuel 97.4 %; the drawn cell is the Westinghouse 17x17 rod", {unit:"of core heat",
        note:"water " + (h.water0*100).toFixed(2) + " %, structures " + (h.struct0*100).toFixed(2) + " %; capture gamma " + h.cap.EC.toFixed(2) + " MeV per fission"}); }
  { const {c, h, name} = at(5);
    const INSAG = "INSAG-7: ~5.5 % of an RBMK-1000's heat is stopped in the graphite; the drawn cell is the RBMK-1000's own (250 mm column, 80 mm bore, 18 rods of 13.6 mm)";
    check(name + ": heat in the graphite at rating", h.block0, 0.055, 0.3, INSAG + "; behaviour: several per cent, most of the heat outside the fuel", {unit:"of core heat",
      note:"water " + (h.water0*100).toFixed(2) + " %, tube and escape " + (h.struct0*100).toFixed(2) + " %, capture gamma " + h.cap.EC.toFixed(2) + " MeV per fission"});
    const src = G.gamDepose.toString();
    inBundle("gamDepose=HS_OLDLAW;");
    G.HSS.delete(c);
    const old = G.heatShares(c).block0;
    inBundle("gamDepose=" + src + ";");
    G.HSS.delete(c);
    check(name + ": fault injected, the old by-area network: the graphite check fails", Math.abs(old/0.055 - 1) > 0.3 ? 1 : 0, 1, 0,
      "the graphite check above reads the cell law", {abs:true, note:"by-area " + (old*100).toFixed(2) + " % against " + (h.block0*100).toFixed(2) + " %"}); }
  { const {h, name} = at(6);
    check(name + ": heat in the graphite at rating", h.block0, 0.06, 0.3,
      "MSRE: 94 % of the energy into the salt and 6 % into the graphite (ANL/NSE-23/8, Updated SAM Model for the MSRE, 2023, off the ORNL design reports)", {unit:"of core heat", gap:ROW,
        note:"BUILD: the drawing lays graphite in one slot in four, where the MSRE core is ~78 % graphite by volume; the salt takes the pin share " + (h.pin0*100).toFixed(2) + " % and the neutrons slowed in it " + (h.water0*100).toFixed(2) + " %"}); }
  { const {c, name} = at(6);
    const can = () => { const R = G.heatCellOf(c, 0, 0); let z = 0, n = 0;
      for(let r=0;r<G.HS_N;r++) if(r !== G.HS_FUEL) z += R.vol[r]*(R.nd[r].Zr || 0);
      for(const cm of G.gamKit(c).cell.comp) for(const [r] of cm) if(r === G.HS_CLAD) n++;
      return {z, n}; };
    const k = can(), SRC = "a dissolved fuel has no can: the MSRE's fuel salt flowed through channels machined in the graphite, no cladding (ORNL, as ANL/NSE-23/8)";
    check(name + ": Zr beyond the salt's own ZrF4 in the thermal book and can regions in the gamma cell", k.z + k.n, 0, 0, SRC, {abs:true,
      note:"Zr atoms outside the salt " + k.z.toExponential(2) + ", can sub-regions " + k.n});
    const src = G.heatCellOf.toString();
    inBundle("heatCellOf=" + src.replace("if(fuelDissolved(c)){", "if(false){") + ";");
    const bad = can();
    inBundle("heatCellOf=" + src + ";");
    check(name + ": fault injected, the can put back in the thermal book: the check fails", bad.z > 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true}); }
  check("CALDER HALL: heat in the graphite", 0, 0, 0,
    "no Calder Hall or Magnox graphite-heating figure found (searched 20/09/26 and 22/09/26): no check", {pass:false, gap:ROW, note:"the law reads " + (at(7).h.block0*100).toFixed(2) + " %"});
}

if(mode === "table"){
  /* the drawn table: nothing where the drawing has nothing, and the 5 x 5 grid against the point it interpolates */
  for(const pre of [0, 5, 7]){
    const {c, name} = at(pre), hs = G.heatShares(c), tab = hs.tab, HG = G.HS_GRID, HO = G.HS_OUT;
    let z = 0; for(let i=0;i<HG;i++) z = Math.max(z, Math.abs(tab[(i*HG)*HO + 3]), Math.abs(tab[(i*HG)*HO + 8]));
    check(name + ": the absorber's share at rod coverage 0", z, 0, 0, "nothing there absorbs nothing", {abs:true});
    let zw = 0; for(let j=0;j<HG;j++) zw = Math.max(zw, Math.abs(tab[((HG - 1)*HG + j)*HO]), Math.abs(tab[((HG - 1)*HG + j)*HO + 5]));
    check(name + ": the water's share at full void", zw, 0, 0, "no water stops nothing", {abs:true});
    const cm = hs.covMax, o = new Float64Array(HO), node = t => { let e = 0;
      for(let i=0;i<HG;i++) for(let j=0;j<HG;j++){ G.heatPointA(c, i/(HG - 1), cm*j/(HG - 1), hs.Q0, o, 0);
        for(let q=0;q<HO;q++) e = Math.max(e, Math.abs(t[(i*HG + j)*HO + q] - o[q])); } return e; };
    check(name + ": the table at its own nodes against the law solved there, rod axis to " + cm.toFixed(3), node(tab), 0, 1e-12,
      "identity: a table node is the law at that node's void and coverage", {abs:true});
    { const bad = new Float64Array(tab.length); for(let i=0;i<HG;i++) for(let j=0;j<HG;j++) G.heatPointA(c, i/(HG - 1), j/(HG - 1), hs.Q0, bad, (i*HG + j)*HO);
      check(name + ": fault injected, the rod axis capped at coverage 1: the node check fails", node(bad) > 1e-12 ? 1 : 0, 1, 0,
        "the check above must be able to fail", {abs:true, pass:cm > 1 ? undefined : false, note:cm > 1 ? "" : "covMax 1: the fault cannot show on this drawing"}); }
    let worst = 0, big = 0;
    for(let i=0;i<HG - 1;i++) for(let j=0;j<HG - 1;j++){
      G.heatPointA(c, (i + 0.5)/(HG - 1), cm*(j + 0.5)/(HG - 1), hs.Q0, o, 0);
      const a0 = (i*HG + j)*HO, a1 = ((i + 1)*HG + j)*HO;
      for(let q=0;q<HO;q++){ const got = (tab[a0+q] + tab[a0+HO+q] + tab[a1+q] + tab[a1+HO+q])/4;
        worst = Math.max(worst, Math.abs(got - o[q])); big = Math.max(big, o[q]); } }
    check(name + ": the table interpolated against the law at every cell centre", worst, 0, 0.01*big,
      "bilinear interpolation error of the law against its own table, 16 cell centres over void 0-1 and coverage 0-" + cm.toFixed(3),
      {abs:true, note:"1 % of the largest share solved there, " + (big*100).toFixed(3) + " %"});
  }
}
