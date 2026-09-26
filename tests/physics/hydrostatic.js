"use strict";
const {load, check, rig, watch} = require("./lib.js");
const G = load();
let f;
rig(R => { R.tank("srcA", 10, 2, 0.3, {vol:2}); f = R.fit(10, 28, "tee");
  R.run(R.port("srcA", 0, G.partOf("srcA").h), R.port(f, 0, -1)); R.wall(60); });
watch(G, {cap:3});
const PT = G.PT, ST = G.ST, n = G.IX.node, iF = n.get(f), iS = n.get("srcA");
let iR = -1; for(let i=0;i<PT.n.node;i++) if(PT.nodeRun[i] >= 0) iR = i;
const rho = 993.4, g = 9.80665;
check("dead-leg column, run node to bottom", (ST.pBy[iF] - ST.pBy[iR])*1e6, rho*g*(PT.nodeZ[iR] - PT.nodeZ[iF]), 0.01,
  "rho*g*dz; water 310 K, 0.4 MPa rho 993.4 kg/m3 (IAPWS-IF97), g 9.80665 m/s2", {unit:"Pa"});
check("dead-leg column, tank to bottom", (ST.pBy[iF] - ST.pBy[iS])*1e6, rho*g*(PT.nodeZ[iS] - PT.nodeZ[iF]), 0.01,
  "rho*g*dz, tank node pressure taken at its own elevation", {unit:"Pa"});
