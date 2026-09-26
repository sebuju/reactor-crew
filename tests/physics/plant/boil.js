"use strict";
/* a boiling core's rated flow off its exit quality: x w of steam leaves, the same mass of feed mixes back with the separated water, so w = Q/(x (h_g - h_feed));
   the exit quality is read on the preset's own watched rest (presets.js), its signal held still with the rest's */
const {check, coreInflow, tsat, if97, if97r2, TofH} = require("../lib.js");
const IF97 = "IAPWS-IF97 (test side, lib.js)";
const hf = p => if97(p, tsat(p)).h, hg = p => if97r2(p, tsat(p)).h;
const perKg = (p, x, Tfeed) => 1/(x*(hg(p) - if97(p, Tfeed).h));
const GAPS = {"BWR/4":"BWR/4 cycle", "RBMK-1000":""};
// null for a preset whose rest does not judge its exit quality
module.exports = (G, pre) => {
  const name = G.PLANTPRE[pre][0];
  if(!(name in GAPS)) return null;
  const ST = G.ST, P = G.P, a = G.COOLANT[G.priD().cool], c = 0, gap = GAPS[name];
  check(name + ": rated flow per MWt against Q/(x (h_g - h_feed))", P.wRated/P.rated, 1000*perKg(a.P0, a.xOut, G.feedTOf()), 0.005,
    "first law on the separator, x " + a.xOut + " at " + a.P0 + " MPa, feed " + G.feedTOf() + " K; " + IF97, {unit:"kg/s/MW"});
  if(name === "RBMK-1000")
    check(name + ": rated flow per MWt against the published machine", P.wRated/P.rated, 10400/3200, 0.10,
      "INSAG-7 annex I: ~37 500 t/h circulation at 3200 MWt", {unit:"kg/s/MW"});
  const exitX = () => { const Q = G.eCoreQWater(c), {w, hIn, pOut} = coreInflow(G, c), hfo = hf(pOut); return (Q/w - (hfo - hIn))/(hg(pOut) - hfo); };
  return {sig:{name:"exit quality", read:exitX, ref:a.xOut, tol:0.15*a.xOut},
    end(run){
      const pc = ST.csPCore[c], Q = G.eCoreQWater(c), {w, hIn, pOut} = coreInflow(G, c);
      check(name + ": core exit quality at the end of the watched rest, off its own heat and flow", exitX(), a.xOut, 0.15,
        "first law on the core: x = (Q/w - (h_f - h_in))/h_fg at the pressure the core leaves into; " + IF97, {gap,
          note:"Q " + (Q/1000).toFixed(0) + " MW, w " + w.toFixed(0) + " kg/s (" + (w/P.wRated).toFixed(3) + " of rated), exit " + pOut.toFixed(2) + " MPa, inlet subcooling " +
            (tsat(pc) - TofH(pc, Math.min(hIn, hf(pc)))).toFixed(1) + " K at " + pc.toFixed(2) + " MPa; " + run}); }};
};
