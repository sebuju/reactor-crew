"use strict";
const {check, commissionPreset, march} = require("./lib.js");
const G = commissionPreset(0);
const ST = G.ST, N = G.GW*G.GH, RU = 8.314462618, V0 = G.ROOM_VCELL;
const SRC = "ideal gas p V = (m_air/M_air + m_H2O/M_H2O + m_H2/M_H2) R T; M 28.96, 18.015, 2.016 g/mol, R 8.314462618 J/mol/K (CODATA)";
function worst(){
  let w = -1, at = -1, pm = 0, pi = 0, n = 0;
  for(let i=0;i<N;i++){ const V = V0 - ST.roomWater[i]/1000 - (ST.roomPool[i] > 0 ? ST.roomPool[i]/G.PT.rFireRho[i] : 0);
    if(!(V > 0.02*V0) || !(ST.roomM[i] > 0)) continue;
    const air = ST.roomM[i] - ST.roomH2[i] - ST.roomVap[i];
    const p = (air/0.02896 + ST.roomVap[i]/0.018015 + ST.roomH2[i]/0.002016)*RU*ST.roomT[i]/V/1000;
    const e = Math.abs(ST.roomP[i] + G.ROOM_P0 - p)/p; n++;
    if(e > w){ w = e; at = i; pm = ST.roomP[i] + G.ROOM_P0; pi = p; } }
  return {w, at, pm, pi, n};
}
march(2);
{ const r = worst(); check("compartment gas, every open cell, at rest", r.pm, r.pi, 1e-3, SRC, {unit:"kPa", pass:r.n > 0 && r.w <= 1e-3, note:"worst of " + r.n + " cells, cell " + r.at}); }
for(let i=0;i<N;i++) ST.roomT[i] += 60;
march(0.02);
{ const r = worst(); check("compartment gas after a 60 K step in every cell", r.pm, r.pi, 1e-3, SRC, {unit:"kPa", pass:r.n > 0 && r.w <= 1e-3, note:"worst of " + r.n + " cells, cell " + r.at}); }
