"use strict";
/* the plant line states what the generator makes at the commissioned rest, and that is a real plant's share of its heat */
const {check} = require("../lib.js");
module.exports = (G, pre) => {
  const P = G.P, name = G.PLANTPRE[pre][0];
  const lineMWe = () => { const m = / (\d+) MWe$/.exec(G.plantLineText(true)); return m ? +m[1] : NaN; };

  G.resetPlant();
  const mwe = G.eMWe();
  check(name + ": the plant line's MWe against the generator's own at the commissioned rest", lineMWe(), mwe, 0.5,
    "the line and the control room read one quantity, eMWe() on the restored rest state; equal to the line's rounding", {abs:true, unit:"MWe", note:G.plantLineText(true)});
  { const was = P.mwe0; P.mwe0 = was*1.1; const bad = lineMWe(); P.mwe0 = was;
    check(name + ": fault injected, the stored figure 10 % high: the line check fails", Math.abs(bad - mwe) > 0.5 ? 1 : 0, 1, 0,
      "the check above must be able to fail", {abs:true}); }
  check(name + ": a drawing edited since commissioning shows no MWe", / MWe$/.test(G.plantLineText(false)) ? 1 : 0, 0, 0,
    "no generator has run on that drawing", {abs:true, note:G.plantLineText(false)});

  if(name === "STOCK PWR"){
    const heat = G.ST.csHeat[0]*P.cores[G.IX.coreId[0]].rated;
    check(name + ": gross electrical over the core's heat at the rest", mwe/heat, 0.325, 0.005,
      "a PWR turns 32-33 % of its heat into electricity overall (Lamarsh 3rd ed. sec. 4.5, p. 140)", {abs:true, gap:"the feedwater heating", note:mwe.toFixed(1) + " MWe of " + heat.toFixed(1) + " MWt"});
  }
};
