"use strict";
const {load, check, rig, march, colebrook} = require("./lib.js");
const G = load();
const SRC = "Darcy-Weisbach with Colebrook-White friction (Colebrook 1939); water at 310 K: rho 993.3 kg/m3 (IAPWS-IF97), mu 6.92e-4 Pa s (IAPWS 2008 viscosity)";
const RHO = 993.3, MU = 6.92e-4, EPS = 4.5e-5;

for(const [pSrc, secs] of [[0.6, 4], [0.153, 16]]){
  rig(R => { R.tank("srcA", 6, 10, pSrc, {vol:2}); R.tank("sinkA", 26, 10, 0.15, {vol:2}); R.joinH("srcA", "sinkA"); R.wall(60); });
  march(secs);
  const PT = G.PT, ST = G.ST, n = G.IX.node;
  const iS = n.get("srcA"), iK = n.get("sinkA");
  let e0 = -1, e1 = -1;
  for(let e=0;e<PT.n.edge;e++) if(PT.edCk[e] === 1){ if(e0 < 0) e0 = e; else e1 = e; }
  const Dm = G.boreM(PT.edBore[e0]), A = Math.PI/4*Dm*Dm, L = PT.edLen[e0] + PT.edLen[e1], K = PT.edK0[e0] + PT.edK0[e1];
  const dp = (ST.pBy[iS] - ST.pBy[iK])*1e6;
  let w = 1;
  for(let i=0;i<200;i++){ const Re = 4*w/(Math.PI*Dm*MU); w = A*Math.sqrt(2*RHO*dp/(colebrook(Re, EPS/Dm)*L/Dm + K)); }
  check("pipe flow at dp " + (dp/1e6).toFixed(3) + " MPa, D " + (Dm*1000).toFixed(0) + " mm, L " + L.toFixed(1) + " m",
    Math.abs(ST.edW[e0]), w, 0.02, SRC, {unit:"kg/s", note:"Re " + (4*w/(Math.PI*Dm*MU)).toExponential(2)});
}
