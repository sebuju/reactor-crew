"use strict";
// chunks: rig
/* one pump between two boundary tanks against its own curve crossed with the system's; each preset's pumps are plant.js */
const {load, check, rig, watch, watchNote, colebrook} = require("./lib.js");
const G = load();

const RHO = 993.3, MU = 6.92e-4;
let p;
rig(R => { R.tank("srcA", 4, 10, 0.3, {vol:5}); p = R.machine("pump", 14, 10); R.tank("sinkA", 26, 10, 0.3, {vol:5});
  R.run(R.port("srcA", G.partOf("srcA").w, 0), R.port(p, -1, 0)); R.run(R.port(p, G.partOf(p).w, 0), R.port("sinkA", -1, 0)); R.wall(60); });
const PT = G.PT, ST = G.ST, e = PT.pumpEdge[0];
ST.flowDemBy[0] = 1; ST.flowBy[0] = 1;
const H0 = G.ePumpHead(0)*1e6, Cc = PT.edC0[e];
const runs = []; for(let k=0;k<PT.n.edge;k++) if(PT.edCk[k] === 1) runs.push(k);
const sys = w => { let dp = w*w/(2*RHO*Cc*Cc);
  for(const k of runs){ const D = G.boreM(PT.edBore[k]), A = Math.PI/4*D*D, Re = 4*w/(Math.PI*D*MU);
    dp += (colebrook(Re, 4.5e-5/D)*PT.edLen[k]/D + PT.edK0[k])*w*w/(2*RHO*A*A); }
  return dp; };
let lo = 0, hi = 1e4;
for(let i=0;i<200;i++){ const m = (lo + hi)/2; if(sys(m) < H0) lo = m; else hi = m; }
// cap at the horizon: the column starts from rest and accelerates on its own inertia, which no transit measures
const w = watch(G, {cap:30, horizon:30, sig:[{name:"flow", read:() => Math.abs(ST.edW[e]), ref:lo, tol:0.02*lo}]});
check("pump against a fixed resistance, operating point", Math.abs(ST.edW[e]), lo, 0.02,
  "crossing of the stated pump curve (shutoff head, casing loss) with the Darcy-Colebrook system curve; water 310 K (IAPWS)",
  {unit:"kg/s", note:"shutoff " + (H0/1e6).toFixed(4) + " MPa, " + watchNote(w)});
