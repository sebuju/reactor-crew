"use strict";
// preset: 0
/* each panel radiates Stefan-Boltzmann and the panel heat balances at rest (preset 0); the analytic Jensen check that decides the SINK_MARGIN row, plus the rated-rest check that the fleet sits at RAD_TDES within its own series spread */
const {check, commissionPreset, watch, watchNote, transit} = require("./lib.js");
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, SIG = 5.670374419e-8;
const bal = r => { const a = PT.radPart[r]; return ST.radQBy[r]/(G.eRadRej(r) + (a >= 0 ? ST.skinQ[a] : 0)); };
const ci = PT.n.rad ? PT.nodeCirc[PT.radNa[0]] : -1;
let wc = 0;
for(let p=0;p<PT.n.pump;p++) if(PT.pumpSuc[p] >= 0 && PT.nodeCirc[PT.pumpSuc[p]] === ci) wc += Math.abs(ST.edW[PT.pumpEdge[p]]);
const win = wc > 0 ? transit(G, ci, wc) : 1;
const w = watch(G, {cap:3*win, horizon:20, window:win, sig:Array.from({length:PT.n.rad}, (_, r) => ({name:"panel " + r, read:() => bal(r), ref:1, tol:0.02}))});
const run = watchNote(w) + ", window " + win.toFixed(2) + " s = one transit of the panels' circuit";
for(let r=0;r<PT.n.rad;r++){ const id = G.IX.radId[r], T = ST.radTBy[r], em = G.radCoatOf(id).emis, A = G.radArea(id);
  check("panel " + id + " radiates at " + T.toFixed(1) + " K", G.eRadRej(r), em*SIG*A*(Math.pow(T, 4) - Math.pow(3, 4))/1000, 1e-6,
    "Stefan-Boltzmann q = eps sigma A (T^4 - T_sky^4), sigma 5.670374419e-8 W/m2/K4 (CODATA 2018), eps " + em + ", A " + A.toFixed(0) + " m2", {unit:"kW"});
  const a = PT.radPart[r], skin = a >= 0 ? ST.skinQ[a] : 0;
  check("panel " + id + " heat balance at steady state", ST.radQBy[r], G.eRadRej(r) + skin, 0.02,
    "energy conservation: heat taken from the water = radiated + lost to the room, once the panel's temperature stands still", {unit:"kW", note:run});
}
{ const Tm = G.RAD_TDES, d = 12.7, T1 = Tm + d, T2 = Tm - d, em = 0.85, A = 1000;
  const q = em*SIG*A*(Math.pow(T1, 4) + Math.pow(T2, 4)), qm = 2*em*SIG*A*Math.pow((T1 + T2)/2, 4);
  const analytic = 1 + 6*Math.pow(d/Tm, 2) + Math.pow(d/Tm, 4);
  check("series pair sheds more than the same area at the mean", q/qm, analytic, 1e-12,
    "Jensen on the convex T^4: sum(T_i^4) > N*T_mean^4 for any spread, so equal-share sizing runs cool, never hot; the SINK_MARGIN reason had its sign backwards", {});
  let mean = 0, n = 0, lo = Infinity, hi = -Infinity;
  for(let r=0;r<PT.n.rad;r++){ const T = ST.radTBy[r]; mean += T; n++; if(T < lo) lo = T; if(T > hi) hi = T; }
  mean /= Math.max(1, n);
  const spread = Math.max(hi - mean, mean - lo, 1e-9);
  check("fleet rests at RAD_TDES within its own series spread", mean, Tm, spread,
    "the sink the condenser was priced against: equal duty on the sized area rests at design, up to the series spread between the panels; measured 20/09/26 the fleet rests ~7 K hot because the sized duty undershoots actual rejection ~12 %, MODEL", {abs:true, unit:"K", gap:"the radiator panels against the duty"});
}
