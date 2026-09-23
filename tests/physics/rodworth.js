"use strict";
// chunks: 0 1 2 3 4 5 6 7 8 9
/* the control bank's worth off the drawn absorber and the spectrum (chunk 0), and each preset's bank on it (chunk 1 + preset) */
const {check, load, commissionPreset} = require("./lib.js");
const chunk = +process.argv[2];

if(chunk === 0){
  const G = load();
  const WIG = "Wigner's rational approximation, P = sig*l/(1 + sig*l) with l = 4V/S (Stacey, Nuclear Reactor Physics, as commonly quoted, not read at source)";
  { const S = 2, V = 0.5, l = 4*V/S, x = 1e-4, sig = x/l;
    check("rational self-shielding, thin limit: absorption over sig*V at sig*l = 1e-4", G.absEff(S, x)/(sig*V), 1, 1e-4, WIG + ": thin, every atom sees the flux", {unit:"of sig*V"}); }
  { const S = 2, x = 1e4;
    check("rational self-shielding, black limit: absorption over S/4 at sig*l = 1e4", G.absEff(S, x)/(S/4), 1, 1e-4, WIG + ": black, every neutron reaching the surface is taken", {unit:"of S/4"}); }
  check("natural boron's 2200 m/s absorption, derived from B-10 and B-11 at the natural atom fraction", G.NUC.B.sa, 767, 0.007*3837,
    "Mughabghab, natural B 767 b; the tolerance is the natural B-10 abundance's own spread, IUPAC 0.199(7), times B-10's 3837 b",
    {abs:true, unit:"b"});

  G.plantPreset(0); G.buildLayout();
  const cP = G.priD(), fP = G.derived().fast, abs0 = cP.lat.abs, enr0 = cP.absEnr;
  const at = (c, fast, abs, enr) => { c.lat.abs = abs; if(enr == null) delete c.absEnr; else c.absEnr = enr; return G.bankRho(c, fast); };
  { const b = at(cP, fP, 0, null);
    check("STOCK PWR: a natural B4C rodlet at the stock bore, thermal sig*l", b.xTh, 10, 0, "B4C is black to thermal neutrons (textbook behaviour)",
      {pass:b.xTh > 10, unit:"", note:"bore " + (G.absD(cP)*1000).toFixed(2) + " mm"});
    check("STOCK PWR: the same rodlet, fast sig*l", b.xF, 0.3, 0, "every absorber is grey to fast neutrons (textbook behaviour)",
      {pass:b.xF < 0.3, unit:""}); }
  { const n = at(cP, fP, 0, 0.199), e = at(cP, fP, 0, 0.9), r = e.th/n.th;
    check("STOCK PWR: B4C thermal worth, 90 % over natural B-10", r, 1.15, 0,
      "a black rod is limited by its surface, so enrichment buys little (rational approximation in its black limit)",
      {pass:r < 1.15, unit:"x", note:"sig*l natural " + n.xTh.toFixed(1) + ", enriched " + e.xTh.toFixed(1)}); }
  { const b = at(cP, fP, 0, null), a = at(cP, fP, 1, null);
    check("STOCK PWR: B4C bank worth against Ag-In-Cd, same drawing", -b.rho*1e5, -a.rho*1e5, 0,
      "B4C outworths Ag-In-Cd in a water lattice, as commonly quoted", {pass:-b.rho >= -a.rho, unit:"pcm",
        note:"B4C " + (-b.rho*1e5).toFixed(0) + ", Ag-In-Cd " + (-a.rho*1e5).toFixed(0) + " pcm"}); }
  cP.lat.abs = abs0; if(enr0 == null) delete cP.absEnr; else cP.absEnr = enr0;
  { const T = G.corePredict(cP, G.derived()), cov = new Float64Array(G.XNN), fol = new Float64Array(G.XNN);
    G.rodShape(T, {rodZ:new Float64Array(T.NB).fill(1)}, cov, fol);
    check("STOCK PWR: the node absorber over the bank's reach is the cell's loss as a volume average", T.rodA*G.wMean(cov), -T.bank.rho*1e5, 1e-9,
      "a volume average of a loss spread uniformly over the nodes the bank reaches returns that loss", {unit:"pcm"}); }

  G.plantPreset(3); G.buildLayout();
  const cB = G.priD(), fB = G.derived().fast, enrB = cB.absEnr;
  { const n = at(cB, fB, cB.lat.abs, 0.199), e = at(cB, fB, cB.lat.abs, 0.9), r = e.fa/n.fa;
    check("BN-600: fast bank worth, 90 % over natural B-10", r, 4.5, 0,
      "grey absorption scales with N(B-10), 0.9/0.199 = 4.5 when thin, less as the rod darkens (rational approximation)",
      {pass:r >= 3 && r <= 4.6, unit:"x", note:"sig*l natural " + n.xF.toFixed(3) + ", enriched " + e.xF.toFixed(3)}); }
  if(enrB == null) delete cB.absEnr; else cB.absEnr = enrB;
} else {
  const pre = chunk - 1, G = commissionPreset(pre), PT = G.PT, ST = G.ST, name = G.PLANTPRE[pre][0];
  for(let c=0;c<PT.n.core;c++){
    const d = G.derived(G.coreIds()[c]), cD = G.coreD(G.coreIds()[c]), x = ST.csRodPos[c], held = !PT.coreNoBor[c];
    const snap = G.engSnap(G.engSnapNew());
    G.eCoreRodSet(c, 1); const inRho = G.eCoreRestResid(c);
    G.engRestore(snap); G.eNetInvalidate();
    const beta = PT.coreBETA[c]*1e5;
    const note = "bank " + cD.rodw.toFixed(0) + " pcm, sdm " + d.sdm.toFixed(0) + " pcm, fast share " + d.fast.toFixed(3) +
      ", rest position " + x.toFixed(3) + (held ? " (boron holds it)" : " (rod search)") + ", bank fully in " + inRho.toFixed(0) + " pcm, beta " + beta.toFixed(0) + " pcm";
    check(name + ": core " + c + " rest bank position off both end stops", x, 0.5, 0,
      "a critical core holds its excess on a bank that still has travel both ways (family behaviour)", {pass:x > 0.01 && x < 0.99, unit:"of travel", note});
    if(!held)
      check(name + ": core " + c + " bank fully in, subcritical by more than beta", inRho, -beta, 0,
        "a plant that holds its excess with rods must shut down on them (family behaviour)", {pass:inRho < -beta, unit:"pcm", note});
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
        const b = G.restBook(cD, d.leak, d.bu), need = b.excess - b.xeW - b.smW, tol = 1e-9*cD.rodw;
        check(name + ": core " + c + " rest position is the S-curve's own critical point", G.rodS(cD, d.rodX0) - need, 0, tol,
          "analytic identity: the bank worth at rest equals the rest excess less equilibrium xenon and samarium", {abs:true, unit:"pcm", note:"x0 " + d.rodX0.toFixed(4)});
        check(name + ": core " + c + " fault injected, rest position 5 % of travel off: the identity fails", Math.abs(G.rodS(cD, d.rodX0 + 0.05) - need) > tol ? 1 : 0, 1, 0,
          "the check above must be able to fail", {abs:true});
      }
    }
  }
}
