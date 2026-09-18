"use strict";
const {check, commissionPreset, march} = require("./lib.js");
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, c = 0;
const lI = PT.coreLamI[c], lX = PT.coreLamX[c];
const zero = () => { ST.csN[c] = 0; for(let g=0;g<6;g++) ST.csC[c*6+g] = 0; };
G.act("scram"); zero();
const I0 = ST.csI[c], X0 = ST.csX[c];
const X = t => X0*Math.exp(-lX*t) + lI*I0/(lX - lI)*(Math.exp(-lI*t) - Math.exp(-lX*t));
let t = 0;
for(const at of [20, 50, 100]){
  march(at - t, zero); t = at;
  check("xenon " + at + " s after shutdown (" + (at*400/3600).toFixed(1) + " h at the 400x clock)", ST.csX[c]/X0, X(at)/X0, 0.02,
    "Bateman I-135 -> Xe-135 with no flux: half-lives 6.57 h and 9.14 h (ENDF/B), both clocks x400 as stated", {unit:"of equilibrium"}); }
check("iodine / xenon half-lives", Math.LN2/lX*400/3600, 9.14, 0.01, "Xe-135 half-life 9.14 h (ENDF/B-VIII)", {unit:"h"});
