"use strict";
/* the rodded bank on each commissioned core: the engine's absorber per ring, its worth as the eigenvalue's change, and where the family runs its bank and boron */
const {check} = require("../lib.js");
const RINGS = "the lattice's own rod patches recounted: a ring's absorber over its area is its drawn rod area over its area, the same constant for every ring, and nothing where nothing is drawn (identity)";
/* S[b][i] against the drawn N[b][i]: the spread of S*(2i+1)/N over the rodded rings, and the largest S in a ring with no rod */
const ringLaw = (G, S, N) => { let lo = Infinity, hi = -Infinity, stray = 0;
  for(let i=0;i<G.XNR;i++){ let s = 0, n = 0; for(let b=0;b<N.length;b++){ s += S[b][i]; n += N[b][i]; }
    if(n > 0){ const r = s*(2*i + 1)/n; lo = Math.min(lo, r); hi = Math.max(hi, r); } else stray = Math.max(stray, Math.abs(s)); }
  return {spread:(hi - lo)/hi, stray}; };
module.exports = (G, pre) => {
  const PT = G.PT, ST = G.ST, name = G.PLANTPRE[pre][0];
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
};
Object.assign(module.exports, {RINGS, ringLaw});
