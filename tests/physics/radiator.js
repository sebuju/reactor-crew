"use strict";
const {check, commissionPreset, march} = require("./lib.js");
const G = commissionPreset(0);
march(20);
const PT = G.PT, ST = G.ST, SIG = 5.670374419e-8;
for(let r=0;r<PT.n.rad;r++){ const id = G.IX.radId[r], T = ST.radTBy[r], em = G.radCoatOf(id).emis, A = G.radArea(id);
  check("panel " + id + " radiates at " + T.toFixed(1) + " K", G.eRadRej(r), em*SIG*A*(Math.pow(T, 4) - Math.pow(3, 4))/1000, 1e-6,
    "Stefan-Boltzmann q = eps sigma A (T^4 - T_sky^4), sigma 5.670374419e-8 W/m2/K4 (CODATA 2018), eps " + em + ", A " + A.toFixed(0) + " m2", {unit:"kW"});
  const a = PT.radPart[r], skin = a >= 0 ? ST.skinQ[a] : 0;
  check("panel " + id + " heat balance at steady state", ST.radQBy[r], G.eRadRej(r) + skin, 0.02,
    "energy conservation: heat taken from the water = radiated + lost to the room, once the panel's temperature stands still", {unit:"kW"});
}
