"use strict";
// chunks: 0 1 2 3 4 5 6 7 8 9 vera poison family stuck exact mono:pwr mono:calder rise:0 rise:1 rise:2 rise:4 rise:6 rise:7
/* the control bank's worth off the drawn absorber and the spectrum (chunk 0), and each preset's bank on it (chunk 1 + preset);
   the cell worth against a published rodded lattice (vera), the poison a batch core carries (poison), the drawn cluster count
   against the family's (family), one cluster's worth (stuck), the worth as the eigenvalue's own change (exact), and the bank
   against its absorber's strength (mono:) and along its travel (rise:) */
const {check, load, commissionPreset} = require("./lib.js");
const arg = process.argv[2], chunk = +arg;
const RINGS = "the lattice's own rod patches recounted: a ring's absorber over its area is its drawn rod area over its area, the same constant for every ring, and nothing where nothing is drawn (identity)";
/* S[b][i] against the drawn N[b][i]: the spread of S*(2i+1)/N over the rodded rings, and the largest S in a ring with no rod */
const ringLaw = (G, S, N) => { let lo = Infinity, hi = -Infinity, stray = 0;
  for(let i=0;i<G.XNR;i++){ let s = 0, n = 0; for(let b=0;b<N.length;b++){ s += S[b][i]; n += N[b][i]; }
    if(n > 0){ const r = s*(2*i + 1)/n; lo = Math.min(lo, r); hi = Math.max(hi, r); } else stray = Math.max(stray, Math.abs(s)); }
  return {spread:(hi - lo)/hi, stray}; };
/* the kernel this law replaced, typed again as the fault */
const oldShares = (G, N, rinf) => { const w = N.map(n => { const o = new Float64Array(G.XNR);
    for(let i=0;i<G.XNR;i++) for(let r=0;r<G.XNR;r++) o[i] += n[r]*Math.max(0, 1 - Math.abs(i - r)/rinf); return o; });
  const t = new Float64Array(G.XNR); for(const o of w) for(let i=0;i<G.XNR;i++) t[i] += o[i];
  for(const o of w) for(let i=0;i<G.XNR;i++) o[i] = t[i] > 0 ? o[i]/t[i] : 0; return w; };

if(arg === "vera"){
  const G = load();
  G.plantPreset(0); G.buildLayout();
  const c = G.priD(), L = c.lat, nb = G.latBundle(c).nRod;
  c.zoneEnr = {0:0.031, 1:0.031, 2:0.031};
  for(let q=0;q<G.LQ*G.LQ;q++){ if(L.slot[q] === G.L_POIS) L.slot[q] = G.L_FUEL; L.rod[q] = G.latFuel(c, q) ? 0 : -1; }
  c.absN = 24*nb/264; G.latRevolve(c);
  const kA = 1.182175, st = {Tn:565, Tf:565, bor:G.borN(G.COOLANT[c.cool], 1300)};
  const worth = (abs, r, dens) => { const ab = G.ABSORB[abs], d0 = ab.dens; L.abs = abs; c.absD = 2*r/100; ab.dens = dens;
    try { return -G.bankRho(c, st).rho*1e5; } finally { ab.dens = d0; } };
  const VERA = "VERA problem 2 (CASL-U-2012-0131-004 Rev. 4, Tables P2-1/P2-2 and the KENO-VI results, read): a 3.1 % 17x17 at 565 K and 1300 ppm, 2A 1.182175 unrodded against 24 rodlets in every guide tube; the loss as k_unrodded/k_rodded - 1, the loss bankRho() states, the law at 565 K and 1300 ppm";
  const note = "every fuel slot rodded at VERA's 24 rodlets per 264 fuel rods (" + c.absN.toFixed(2) + " a slot), 3.1 %";
  for(const [abs, nm, r, dens, kR] of [[1, "Ag-In-Cd (2G)", 0.382, G.ABSORB[1].dens, 0.847695], [0, "B4C at 1.76 g/cc (2H)", 0.373, 1.76, 0.788221]]){
    const want = (kA/kR - 1)*1e5, got = worth(abs, r, dens), thin = (worth(abs, r, dens*1e-6) - worth(abs, r, 0))*1e6;
    check("VERA lattice fully rodded, " + nm + ": the cell's loss", got, want, 0.2, VERA, {unit:"pcm", gap:"control bank worth", note});
    check("fault injected, " + nm + " priced in its thin limit: the check fails", Math.abs(thin/want - 1) > 0.2 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"thin limit " + thin.toFixed(0) + " pcm"}); }
  G.plantPreset(2); G.buildLayout();
  check("BWR/4: the cell's loss against a published controlled BWR lattice", -G.bankRho(G.priD()).rho*1e5, NaN, 0,
    "no controlled/uncontrolled BWR lattice k-inf read at source (GE BWR/4 Technology Manual and the NEA BWR benchmarks not found with one); decided off the PWR lattice above",
    {unit:"pcm", gap:"control bank worth"});
} else if(arg === "poison"){
  const G = load();
  G.plantPreset(2); G.buildLayout();
  const c = G.priD(), d = G.derived(), n = G.COOLANT[c.cool].batch, fresh = G.poisonAt(c, 0).mean, rest = G.poisonRest(c, d.bu).mean, mean = G.poisonAt(c, d.bu).mean;
  const GE = "NRC HRTD GE BWR/4 Technology Manual sec. 2.2.2 (Rev 09/11, read): burnable poisons 'are depleted by neutron absorption and they are effectively depleted early in the core lifetime', and 'up to twelve of the ninety-two fuel rods in a GE-14 fuel bundle are loaded with poisoned fuel pellets', so every fresh batch carries gadolinia through its first cycle";
  const note = n + " batches at " + Array.from({length:n}, (_, k) => ((k + .5)*2*d.bu/n).toFixed(1)).join(", ") + " MWd/kgHM; fresh " + fresh.toFixed(0) + " pcm";
  check("BWR/4: the poison the core carries mid-cycle, over its fresh worth", rest/fresh, 0.05, 0, GE, {pass:rest > 0.05*fresh, unit:"of fresh", note});
  check("BWR/4: the poison left in the batch about to leave, over its fresh worth", G.poisonAt(c, (n - .5)*2*d.bu/n).mean/fresh, 0.05, 0, GE, {pass:G.poisonAt(c, (n - .5)*2*d.bu/n).mean < 0.05*fresh, unit:"of fresh"});
  check("fault injected, every batch at the core's mean burnup: the mid-cycle check fails", mean > 0.05*fresh ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:"mean-burnup reading " + mean.toFixed(0) + " pcm"});
} else if(arg === "family"){
  const G = load(), A17 = 0.215*0.215, AGE = (6*0.0254)**2;
  const WBN = "Watts Bar 1: 57 RCCAs (VERA CASL-U-2012-0131-004 Fig. 10, counted) over 193 assemblies at 21.50 cm (Table 2); AP1000: 53 RCCAs and 16 gray clusters over 157 assemblies (DCD Rev. 19 Table 4.3-1, read), taken at the same 21.50 cm pitch";
  const GEF = "GE BWR/4: 137 control rods over 560 assemblies, a 12 in rod pitch, each rod in a cell of four assemblies (NRC HRTD R-304B secs. 2.1-2.2, read)";
  const tol = 2, row = [[0, A17, 57/193, 69/157, WBN], [1, A17, 57/193, 69/157, WBN], [4, A17, 57/193, 69/157, WBN], [2, AGE, 137/560, 1/4, GEF]];
  let stock = null;
  for(const [pre, a, lo, hi, src] of row){
    G.plantPreset(pre); G.buildLayout();
    const c = G.priD(), asm = G.LAT_QUAD*G.latCounts(c).nF*c.lat.pitch**2/a, n = G.LAT_QUAD*G.latRodded(c);
    if(pre === 0) stock = {asm, n, lo, hi};
    check(G.PLANTPRE[pre][0] + ": drawn clusters against its family's per assembly", n, asm*(lo + hi)/2, 0, src + "; within half a drawn slot's four clusters of the family's range",
      {pass:n >= asm*lo - tol && n <= asm*hi + tol, unit:"clusters", note:"family " + (asm*lo).toFixed(1) + "-" + (asm*hi).toFixed(1) + " over " + asm.toFixed(1) + " assembly areas, " + (100*n/asm).toFixed(1) + " % drawn"}); }
  const h = stock.n/2;
  check("fault injected, STOCK PWR's count halved: the check fails", h >= stock.asm*stock.lo - tol && h <= stock.asm*stock.hi + tol ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:h + " clusters"});
} else if(arg === "stuck"){
  const G = load();
  G.plantPreset(0); G.buildLayout();
  const c = G.priD(), T = G.derived().core;
  let t = 0; for(const n of G.latM(c).bankN) for(let i=0;i<G.XNR;i++) t += n[i];
  const at =(i, phi) => { const h = new Float64Array(G.XNR); h[i] = 1; return G.rodSlotWorth(Object.assign({}, T, {phi}), 0, h, t); };
  const flat = new Float64Array(G.XNN).fill(1), a = 1, b = G.XNR - 2;
  const PERT = "a thin absorber is worth its loss weighted by the flux squared where it sits (first-order perturbation theory, Stacey, Nuclear Reactor Physics ch. 5): the centre outworths the edge";
  check("STOCK PWR: one cluster in ring " + a + " over the same cluster in ring " + b, at(a, T.phi)/at(b, T.phi), 1, 0, PERT, {pass:at(a, T.phi) > at(b, T.phi), unit:"x"});
  check("fault injected, a flat flux: the centre no longer outworths the edge", at(a, flat) > at(b, flat)*(1 + 1e-9) ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:(at(a, flat)/at(b, flat)).toFixed(6) + " x"});
} else if(arg === "exact"){
  const G = load(), XNN = G.XNN;
  const EIG = "W*K is symmetric, so for K_b phi_b = l_b phi_b and K phi = l phi, l - l_b = -1e-5 <phi_b, (rho - rho_b) phi>_W / <phi_b, phi>_W exactly (eigenvalue perturbation, analytic)";
  const PT1 = "first-order perturbation theory: a thin absorber's eigenvalue change is its loss weighted by the base flux squared (Stacey, Nuclear Reactor Physics ch. 5)";
  const MM = "min-max: an absorber added to a W-symmetric core only raises its fundamental eigenvalue, so a subset of the absorber takes no more than the whole (Courant-Fischer); held here on the whole change of the hot rest";
  const EIGH = "a bank's worth is the change of the fundamental eigenvalue between the two rests it separates, 1e5 (l_x - l_0), xenon and feedback solved on each (definition of reactivity worth; analytic)";
  const cold = (T, x) => { const phi = new Float64Array(XNN).fill(1); G.coreSolve(T, phi, G.coreBase(T, x, new Float64Array(XNN))); return {phi, l:G.FX[0]}; };
  const slope = (T, x) => { const st = G.rodSt(T, x), cov = new Float64Array(XNN), fol = new Float64Array(XNN), was = T.phi;
    G.coreHot(T, st); G.rodCov(T, st, cov, fol); const r = T.rodA*G.impW(cov, T.phi); T.phi = was; return r; };
  for(const pre of [0, 7]){
    G.plantPreset(pre); G.buildLayout();
    const c = G.priD(), d = G.derived(), T = d.core, name = G.PLANTPRE[pre][0];
    { const cov = new Float64Array(XNN), fol = new Float64Array(XNN), r = new Float64Array(XNN), s = cold(T, 1);
      G.rodShape(T, {rodZ:new Float64Array(T.NB).fill(1)}, cov, fol);
      for(let k=0;k<XNN;k++) r[k] = -T.rodA*cov[k] + T.tipRho*fol[k];
      const want = -1e5*(s.l - T.lamB), got = G.mixW(r, T.phiB, s.phi), bad = G.impW(r, s.phi);
      check(name + ": cold, all banks in: bank and follower parts on the mixed weight against the eigenvalue's change", got, want, 1e-9, EIG, {unit:"pcm"});
      check(name + ": fault injected, the flux-squared weight: the check fails", Math.abs(bad/want - 1) > 1e-9 ? 1 : 0, 1, 0,
        "the check above must be able to fail", {abs:true, note:bad.toFixed(1) + " against " + want.toFixed(1) + " pcm"}); }
    { const S = G.latRodSlots(c); let t = 0; for(const n of G.latM(c).bankN) for(let i=0;i<G.XNR;i++) t += n[i];
      for(const s of S) for(let i=0;i<G.XNR;i++) s.h[i] /= G.LAT_QUAD;
      const top = S.map(s => ({s, w:G.rodSlotWorth(T, s.b, s.h, t)})).sort((p, q) => q.w - p.w)[0].s;
      const Tc = Object.assign(G.clusterT(T, top.b, G.ringShareA(top.h, t, new Float64Array(G.XNR))), {rodA:T.rodA*1e-4, tipRho:0});
      const cov = new Float64Array(XNN), fol = new Float64Array(XNN); G.rodShape(Tc, {rodZ:[1]}, cov, fol);
      const exact = 1e5*(cold(Tc, 1).l - T.lamB), first = Tc.rodA*G.impW(cov, T.phiB), bad = Tc.rodA*G.impW(cov, cold(T, 1).phi);
      check(name + ": the most worthy cluster at 1e-4 of its absorber, cold: exact worth over first order on the base flux", exact/first, 1, 1e-3, PT1, {unit:"x", note:exact.toExponential(4) + " pcm"});
      check(name + ": fault injected, first order on the flux of all banks in: the check fails", Math.abs(bad/exact - 1) > 1e-3 ? 1 : 0, 1, 0,
        "the check above must be able to fail", {abs:true, note:(exact/bad).toFixed(4) + " x"}); }
    { const was = T.phi, cov = new Float64Array(XNN), fol = new Float64Array(XNN);
      G.coreHot(T, 1); const l1 = T.lamH; G.rodCov(T, G.rodSt(T, 1), cov, fol); const part = T.rodA*G.mixW(cov, T.phiB, T.phi);
      G.coreHot(T, 0); const l0 = T.lamH; T.phi = was;
      const want = 1e5*(l1 - l0), got = G.rodCurve(T)[10];
      check(name + ": the bank fully in on its curve against the two hot rests' own eigenvalues", got, want, 1e-9, EIGH,
        {unit:"pcm", note:"as commissioned, on the rest before the last boron: " + T.rodSx[10].toFixed(1) + " pcm"});
      check(name + ": fault injected, the bank's rod part alone: the check fails", Math.abs(part/want - 1) > 1e-9 ? 1 : 0, 1, 0,
        "the check above must be able to fail", {abs:true, note:part.toFixed(1) + " against " + want.toFixed(1) + " pcm"}); }
    { const all = G.rodWholeAt(T, 1, G.restAt(T, 0)), bW = d.bankW;
      check(name + ": every bank alone against all banks in, hot rest", Math.max(...bW), all, 0, MM, {pass:bW.every(w => w >= 0 && w <= all), unit:"pcm", note:bW.map(w => w.toFixed(0)).join(" / ") + " against " + all.toFixed(0)});
      check(name + ": the most worthy cluster stuck out against all banks in, hot rest", d.rodW, all, 0, MM, {pass:d.rodW >= 0 && d.rodW <= all, unit:"pcm"});
      const bB = Array.from({length:T.NB}, (_, b) => { const z = new Float64Array(T.NB); z[b] = 1; const cov = new Float64Array(XNN), fol = new Float64Array(XNN);
        G.rodShape(T, {rodZ:z}, cov, fol); return T.rodA*G.impW(cov, T.phi); }), bAll = slope(T, 1);
      check(name + ": fault injected, each bank first order on the rest flux against all in on its own flux (the old bench): the bank check fails", bB.every(w => w >= 0 && w <= bAll) ? 0 : 1, 1, 0,
        "the check above must be able to fail", {abs:true, note:bB.map(w => w.toFixed(0)).join(" / ") + " against " + bAll.toFixed(0)}); }
  }
} else if(arg === "mono:pwr" || arg === "mono:calder"){
  const G = load(), pre = arg === "mono:pwr" ? 0 : 7, XNN = G.XNN;
  G.plantPreset(pre); G.buildLayout();
  const c = G.priD(), ab = G.ABSORB[c.lat.abs], d0 = ab.dens, F = [0.03, 0.1, 0.3, 1, 3], tot = [], rw = [], sl = [], name = G.PLANTPRE[pre][0];
  try { for(const f of F){ ab.dens = d0*f; G.coreCachePut(c, null); const T = G.derived().core;
      tot.push(G.coreRestRho(T, 1, 0)); rw.push(c.rodw);
      const cov = new Float64Array(XNN), fol = new Float64Array(XNN); G.coreHot(T, 1); G.rodShape(T, {rodZ:new Float64Array(T.NB).fill(1)}, cov, fol);
      sl.push(T.rodA*G.impW(cov, T.phi)); } }
  finally { ab.dens = d0; G.coreCachePut(c, null); }
  const down = a => a.every((v, i) => i === 0 || v < a[i-1]), up = a => a.every((v, i) => i === 0 || v > a[i-1]);
  const MM = "min-max: more absorber in a W-symmetric core only raises its fundamental eigenvalue (Courant-Fischer); the bank's absorber density at x" + F.join(", x");
  check(name + ": all banks in at hot rest, pcm off the base, as the absorber thickens", tot[tot.length-1], tot[0], 0, MM, {pass:down(tot), unit:"pcm", note:tot.map(v => v.toFixed(0)).join(", ")});
  check(name + ": the bank's worth fully in, the whole change of the hot rest, as the absorber thickens", rw[rw.length-1], rw[0], 0, MM, {pass:up(rw), unit:"pcm", note:rw.map(v => v.toFixed(0)).join(", ")});
  check(name + ": fault injected, the slope measure on the rodded flux: the worth check fails", up(sl) ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:sl.map(v => v.toFixed(0)).join(", ")});
} else if(arg.startsWith("rise:")){
  const G = load(), pre = +arg.slice(5), name = G.PLANTPRE[pre][0];
  G.plantPreset(pre); G.buildLayout();
  const T = G.derived().core, up = a => a.every((v, i) => i === 0 || v > a[i-1]), txt = a => Array.from(a, v => v.toFixed(0)).join(", ");
  if(T.tipRho !== 0) throw new Error(name + " draws followers: its curve may dip, not a min-max case");
  const INS = "min-max: more of the core covered by the same absorber only raises the fundamental eigenvalue (Courant-Fischer), so a bank with no followers is worth more at each step of its travel";
  check(name + ": the bank's integral worth over its travel, hot rest", T.rodSx[10], T.rodSx[0], 0, INS, {pass:up(T.rodSx), unit:"pcm", note:txt(T.rodSx)});
  const bad = G.rodCurve(Object.assign({}, T, {rodA:-T.rodA}));
  check(name + ": fault injected, an absorber that adds: the rise check fails", up(bad) ? 0 : 1, 1, 0,
    "the check above must be able to fail", {abs:true, note:txt(bad)});
} else if(chunk === 0){
  const G = load();
  const WIG = "Wigner's rational approximation, P = sig*l/(1 + sig*l) with l = 4V/S (Stacey, Nuclear Reactor Physics, as commonly quoted, not read at source)";
  { const S = 2, V = 0.5, l = 4*V/S, x = 1e-4, sig = x/l;
    check("rational self-shielding, thin limit: absorption over sig*V at sig*l = 1e-4", G.absEff(S, x)/(sig*V), 1, 1e-4, WIG + ": thin, every atom sees the flux", {unit:"of sig*V"}); }
  { const S = 2, x = 1e4;
    check("rational self-shielding, black limit: absorption over S/4 at sig*l = 1e4", G.absEff(S, x)/(S/4), 1, 1e-4, WIG + ": black, every neutron reaching the surface is taken", {unit:"of S/4"}); }
  { const Tn = 565, MX = "a 1/v absorber in a Maxwellian: thin, the rate is n v0 sig0 V at any temperature; black, a surface takes the current n v-bar/4, v-bar = (2/sqrt(pi)) sqrt(2kT/m) (kinetic theory)";
    check("Maxwellian rational self-shielding, thin limit at 565 K: absorption over n v0 sig0 V at sig0*l = 1e-6", G.mxShield(1e-6, Tn), 1, 1e-5, MX, {unit:"of thin"});
    check("Maxwellian rational self-shielding, black limit at 565 K: absorption over n v-bar S/4 at sig0*l = 1e4", 1e4*G.mxShield(1e4, Tn)/G.vBarOf(Tn), 1, 1e-3, MX, {unit:"of n v-bar S/4"});
    check("fault injected, the black limit at 2200 m/s: the check fails", Math.abs(1e4/(1 + 1e4)/G.vBarOf(Tn) - 1) > 1e-3 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:(1e4/(1 + 1e4)/G.vBarOf(Tn)).toFixed(3) + " of n v-bar S/4"}); }
  check("natural boron's 2200 m/s absorption, derived from B-10 and B-11 at the natural atom fraction", G.NUC.B.sa, 767, 0.007*3837,
    "Mughabghab, natural B 767 b; the tolerance is the natural B-10 abundance's own spread, IUPAC 0.199(7), times B-10's 3837 b",
    {abs:true, unit:"b"});

  G.plantPreset(0); G.buildLayout();
  const cP = G.priD(), abs0 = cP.lat.abs, enr0 = cP.absEnr;
  const at = (c, abs, enr) => { c.lat.abs = abs; if(enr == null) delete c.absEnr; else c.absEnr = enr; return G.bankRho(c); };
  { const b = at(cP, 0, null);
    check("STOCK PWR: a natural B4C rodlet at the stock bore, thermal sig*l", b.xTh, 10, 0, "B4C is black to thermal neutrons (textbook behaviour)",
      {pass:b.xTh > 10, unit:"", note:"bore " + (G.absD(cP)*1000).toFixed(2) + " mm"});
    check("STOCK PWR: the same rodlet, fast sig*l", b.xF, 0.3, 0, "every absorber is grey to fast neutrons (textbook behaviour)",
      {pass:b.xF < 0.3, unit:""}); }
  { const Tn = G.latLaw(cP).Tn, th = b => b.xTh*G.mxShield(b.xTh, Tn), n = at(cP, 0, 0.199), e = at(cP, 0, 0.9), r = th(e)/th(n);
    check("STOCK PWR: a B4C rodlet's thermal absorption, 90 % over natural B-10", r, 1.15, 0,
      "a black rod is limited by its surface, so enrichment buys little (rational approximation averaged over the Maxwellian, in its black limit)",
      {pass:r < 1.15, unit:"x", note:"sig*l natural " + n.xTh.toFixed(1) + ", enriched " + e.xTh.toFixed(1)}); }
  { const b = at(cP, 0, null), a = at(cP, 1, null);
    check("STOCK PWR: B4C bank worth against Ag-In-Cd, same drawing", -b.rho*1e5, -a.rho*1e5, 0,
      "B4C outworths Ag-In-Cd in a water lattice, as commonly quoted", {pass:-b.rho >= -a.rho, unit:"pcm",
        note:"B4C " + (-b.rho*1e5).toFixed(0) + ", Ag-In-Cd " + (-a.rho*1e5).toFixed(0) + " pcm"}); }
  cP.lat.abs = abs0; if(enr0 == null) delete cP.absEnr; else cP.absEnr = enr0;
  { const T = G.corePredict(cP, G.derived()), cov = new Float64Array(G.XNN), fol = new Float64Array(G.XNN);
    G.rodShape(T, {rodZ:new Float64Array(T.NB).fill(1)}, cov, fol);
    check("STOCK PWR: the node absorber over the bank's reach is the cell's loss as a volume average", T.rodA*G.wMean(cov), -T.bank.rho*1e5, 1e-9,
      "a volume average of a loss spread uniformly over the nodes the bank reaches returns that loss", {unit:"pcm"}); }

  { const worth = (T, b) => { const cov = new Float64Array(G.XNN), fol = new Float64Array(G.XNN), z = new Float64Array(T.NB);
      z[b] = 1; G.rodShape(T, {rodZ:z}, cov, fol); return T.rodA*G.impW(cov, T.phi); };
    const THIN = "thin-absorber limit: a bank's worth is linear in its absorber, so two banks in the same flux read the ratio of their absorber (first-order perturbation theory, Stacey, Nuclear Reactor Physics ch. 5)";
    const T0 = G.corePredict(cP, G.derived()), g = G.latM(cP).bankN[0];
    const T2 = Object.assign({}, T0, {NB:2, bankS:G.bankShares([g.map(x => 3*x), g])});
    check("two banks in the same rings, 3 clusters to 1: worth ratio", worth(T2, 0)/worth(T2, 1), 3, 1e-6, THIN, {unit:"x"});
    const L = cP.lat, rod0 = Int8Array.from(L.rod), u = 3, v = 5;
    L.rod.fill(-1); L.rod[G.LIX(u, v)] = 0; L.rod[G.LIX(v, u)] = 1; G.latRevolve(cP);
    const T1 = G.corePredict(cP, G.derived());
    check("a bank tied in every ring it touches is still drawn: banks counted", T1.NB, 2, 0, "the drawing holds two banks", {abs:true});
    check("mirror clusters, one per bank: worth ratio", T1.NB === 2 ? worth(T1, 0)/worth(T1, 1) : 0, 1, 1e-6, THIN, {unit:"x"});
    const nbF = G["(() => { const keep = latBanks; latBanks = rodN => keep(rodN.map(o => { const ks = Object.keys(o).sort((a, b) => o[b] - o[a]); " +
      "return ks.length ? {[ks[0]]:o[ks[0]]} : {}; })); try { latRevolve(priD()); return latM(priD()).NB; } finally { latBanks = keep; } })()"];
    check("fault injected, the first-bank-only ring rule: the bank count check fails", nbF !== 2 ? 1 : 0, 1, 0,
      "the bank count check above must be able to fail", {abs:true, note:"banks " + nbF});
    L.rod.set(rod0); G.latRevolve(cP); }

  { const M = G.latM(cP), r = ringLaw(G, G.bankShares(M.bankN), M.bankN), o = ringLaw(G, oldShares(G, M.bankN, Math.max(2.2, G.XNR/M.NB)), M.bankN);
    check("STOCK PWR: every rodded ring's absorber over its drawn rod area", r.spread, 0, 1e-12, RINGS, {abs:true, unit:"relative spread"});
    check("STOCK PWR: absorber in a ring with no rod drawn", r.stray, 0, 0, RINGS, {abs:true, unit:"of core mean"});
    check("fault injected, the spreading kernel: the unrodded-ring check fails", o.stray > 0 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"largest stray coverage " + o.stray.toFixed(3)}); }

  { const T = G.corePredict(cP, G.derived()), N = G.XNR, Z = G.XNZ, eps = 1e-4, ra = 2, rb = 11;
    const lam = rho => { const phi = new Float64Array(G.XNN).fill(1); G.coreSolve(T, phi, rho); return {l:G.FX[0], phi}; };
    const base = lam(new Float64Array(G.XNN)), phi0 = base.phi;
    const one = i => { const n = new Float64Array(N); n[i] = 1; return [n]; };
    const dl = S => { const rho = new Float64Array(G.XNN); for(let i=0;i<N;i++) for(let j=0;j<Z;j++) rho[i*Z + j] = -eps*T.rodA*S[0][i]; return lam(rho).l - base.l; };
    const pt = S => { let m = 0; for(let k=0;k<G.XNN;k++) m += G.nodeW[k]*phi0[k]*phi0[k]*S[0][(k/Z)|0]; return m; };
    const Sa = G.bankShares(one(ra)), Sb = G.bankShares(one(rb)), want = pt(Sa)/pt(Sb), got = dl(Sa)/dl(Sb);
    const PERT = "first-order perturbation theory: in one group the adjoint is the flux, so a thin absorber is worth its loss weighted by phi^2 over the ring it sits in (Stacey, Nuclear Reactor Physics ch. 5)";
    check("STOCK PWR: the same thin absorber in ring " + ra + " over ring " + rb + ": worth ratio", got, want, 0.01, PERT,
      {unit:"x", note:"a bank near the centre of the core outworths the same absorber at its edge"});
    const bad = dl(oldShares(G, one(ra), N))/dl(oldShares(G, one(rb), N));
    check("fault injected, the spreading kernel: the ratio check fails", Math.abs(bad/want - 1) > 0.01 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true, note:"kernel ratio " + bad.toFixed(3) + " against " + want.toFixed(3)}); }

  G.plantPreset(3); G.buildLayout();
  const cB = G.priD(), enrB = cB.absEnr;
  { const fa = b => b.xF/(1 + b.xF), n = at(cB, cB.lat.abs, 0.199), e = at(cB, cB.lat.abs, 0.9), r = fa(e)/fa(n);
    check("BN-600: a B4C rodlet's fast absorption, 90 % over natural B-10", r, 4.5, 0,
      "grey absorption scales with N(B-10), 0.9/0.199 = 4.5 when thin, less as the rod darkens (rational approximation)",
      {pass:r >= 3 && r <= 4.6, unit:"x", note:"sig*l natural " + n.xF.toFixed(3) + ", enriched " + e.xF.toFixed(3)}); }
  if(enrB == null) delete cB.absEnr; else cB.absEnr = enrB;
} else {
  const pre = chunk - 1, G = commissionPreset(pre), PT = G.PT, ST = G.ST, name = G.PLANTPRE[pre][0];
  for(let c=0;c<PT.n.core;c++){
    const d = G.derived(G.coreIds()[c]), cD = G.coreD(G.coreIds()[c]), x = ST.csRodPos[c], held = !PT.coreNoBor[c];
    { const N = G.latM(cD).bankN, S = N.map((_, b) => PT.coreBankS.subarray((c*PT.nbMax + b)*G.XNR, (c*PT.nbMax + b + 1)*G.XNR)), r = ringLaw(G, S, N);
      check(name + ": core " + c + " the engine's absorber per rodded ring over its drawn rod area", r.spread, 0, 1e-12, RINGS, {abs:true, unit:"relative spread"});
      check(name + ": core " + c + " the engine's absorber in a ring with no rod drawn", r.stray, 0, 0, RINGS, {abs:true, unit:"of core mean"}); }
    const snap = G.engSnap(G.engSnapNew());
    G.eCoreRodSet(c, 1); const inRho = G.eCoreRestResid(c);
    { const o = G.SX.coreO, nb = c*G.XNN, rb = c*G.XNR;
      let parts = 0; for(let q=0;q<=G.E_CO_SM;q++) parts += o[q];
      let m = 0, W = 0;
      for(let i=0;i<G.XNR;i++) for(let j=0;j<G.XNZ;j++){ const q = i*G.XNZ + j, k = nb + q, w = G.nodeW[q]*ST.csPhi[k]*ST.csPhi[k];
        m += w*(ST.csNRho[k] + PT.corePoison[c]*(PT.corePoiG[rb+i] - 1) - PT.coreRingRho[rb+i] - PT.coreNBuRho[k] - PT.coreAxRho[k]); W += w; }
      G.eCoreSolve(c, 0); const want = -1e5*(G.FX[0] - PT.coreLamB[c]);
      check(name + ": core " + c + " all banks in at hot rest: the engine's reactivity parts against the eigenvalue's change off the base", parts, want, 1e-6,
        "W*K is symmetric, so for K_b phi_b = l_b phi_b and K phi = l phi, l - l_b = -1e-5 <phi_b, (rho - rho_b) phi>_W / <phi_b, phi>_W exactly (eigenvalue perturbation, analytic)", {unit:"pcm"});
      check(name + ": core " + c + " fault injected, the parts on the flux-squared weight: the check fails", Math.abs(m/W/want - 1) > 1e-6 ? 1 : 0, 1, 0,
        "the check above must be able to fail", {abs:true, note:(m/W).toFixed(1) + " against " + want.toFixed(1) + " pcm"}); }
    G.engRestore(snap); G.eNetInvalidate();
    const beta = PT.coreBETA[c]*1e5;
    const note = "bank " + cD.rodw.toFixed(0) + " pcm, sdm " + d.sdm.toFixed(0) + " pcm, fast share " + d.fast.toFixed(3) +
      ", rest position " + x.toFixed(3) + (held ? " (boron holds it)" : " (rod search)") + ", bank fully in " + inRho.toFixed(0) + " pcm, beta " + beta.toFixed(0) + " pcm";
    check(name + ": core " + c + " rest bank position off both end stops", x, 0.5, 0,
      "a critical core holds its excess on a bank that still has travel both ways (family behaviour)", {pass:x > 0.01 && x < 0.99, unit:"of travel", note});
    check(name + ": core " + c + " bank fully in, subcritical by more than beta", inRho, -beta, 0,
      held ? "a PWR trips from full power on its rods alone, its boron where it stood (family behaviour)" : "a plant that holds its excess with rods must shut down on them (family behaviour)",
      {pass:inRho < -beta, unit:"pcm", note, gap:held ? "control bank worth" : ""});
    check(name + ": core " + c + " stuck-rod margin at hot rest, the most worthy cluster left out", -inRho - d.rodW, 0, 0,
      "all rods in less the most worthy single cluster still shuts the core down (NUREG-1431/1433 LCO 3.1.1, taken at hot rest)",
      {pass:-inRho - d.rodW > 0, unit:"pcm", gap:"control bank worth", note:"cluster " + d.rodW.toFixed(0) + " pcm; bench STUCK-ROD MARGIN, xenon- and samarium-free, " + d.sdmStuck.toFixed(0) + " pcm"});
    const bor = ST.bBy[PT.coreNode[c]];
    if(held){
      check(name + ": core " + c + " soluble boron at rest only absorbs", bor, 0, 0,
        "a dissolved absorber has no positive worth (chemistry)", {pass:bor <= 0, unit:"pcm"});
      check(name + ": core " + c + " lead bank at rest where a PWR's sits at full power", x, 15/230, 0,
        "Watts Bar 1 cycle 1 ran bank D at 208-220 of 230 steps at full power (VERA benchmark CASL-U-2012-0131-004, Table P9-4)",
        {pass:x >= 10/230 && x <= 22/230, unit:"of travel"});
      G.eCoreRodSet(c, 0); G.eCoreRestResid(c); const aoOut = ST.csAo[c];
      G.engRestore(snap); G.eNetInvalidate();
      const ao = ST.csAo[c];
      check(name + ": core " + c + " axial offset at the bite against banks out", ao - aoOut, 0, 0.05,
        "constant axial offset control holds the flux difference within +/-5 % of its full-power target (NRC HRTD Westinghouse sec. 2.2.3.9)",
        {abs:true, gap:"the rest bank and the boron", note:"AO " + (ao*100).toFixed(2) + " %, banks out " + (aoOut*100).toFixed(2) + " %"});
      check(name + ": core " + c + " soluble boron at rest against a PWR's at full power, mid-cycle", bor, -4284, 0,
        "420-540 ppm mid-cycle at full power: a reload cycle's ~40 ppm/(GWd/MTU) letdown to 0-10 ppm over ~21 000 MWd/MTU, from mid-cycle (AP1000 DCD Rev. 19 Table 4.3-2 note f, sec. 4.3); BEAVRS cycle 2 (first reload) 538 ppm at 129 of 257 EFPD (MIT-CRPG BEAVRS, boron letdown data); Watts Bar 1 cycle 1 540 ppm at 217.4 of 441 EFPD (VERA CASL-U-2012-0131-004 Table P9-4); at -6.9 to -10.5 pcm/ppm (AP1000 Table 4.3-2): -2898 to -5670 pcm",
        {pass:bor <= -420*6.9 && bor >= -540*10.5, unit:"pcm", gap:"the rest bank and the boron"});
    } else {
      check(name + ": core " + c + " carries no soluble boron", bor, 0, 0,
        "a rod-held core carries no dissolved absorber at power (BWR, RBMK, MSRE, gas and sodium practice)", {abs:true, unit:"pcm"});
      if(d.rodX0 > 0 && d.rodX0 < 1){
        const b = G.restBook(cD, d.leak, d.bu), need = b.excess - b.xeW - b.smW, tol = G.E_ROD_CRIT_TOL, rho0 = b.excess - b.smW;
        const at = x => G.coreRestRho(d.core, x, rho0), r0 = at(d.rodX0), r5 = at(Math.min(1, d.rodX0 + 0.05)); G.coreHot(d.core, d.rodX0);
        check(name + ": core " + c + " rest position is critical on its own hot rest", r0, 0, tol,
          "the rest excess plus every node term weighted by the base flux times the rest flux (the eigenvalue's change off the base) is zero at rest, the engine's own reckoning (eCoreRestResid()); the tolerance is its criticality tolerance", {abs:true, unit:"pcm",
            note:"x0 " + d.rodX0.toFixed(4) + "; the linear book (bank worth = excess less uniform xenon and samarium) misses it by " + (G.rodS(d.core, d.rodX0) - need).toFixed(1) + " pcm, the flux shape's own weighting"});
        check(name + ": core " + c + " fault injected, rest position 5 % of travel off: the identity fails", Math.abs(r5) > tol ? 1 : 0, 1, 0,
          "the check above must be able to fail", {abs:true, note:(r5).toFixed(1) + " pcm"});
      }
    }
  }
}
