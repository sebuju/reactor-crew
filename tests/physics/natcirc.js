"use strict";
const {load, check, commissionPreset, march, colebrook} = require("./lib.js");
const G = commissionPreset(0);
const PT = G.PT, ST = G.ST, SX = G.SX;
G.act("scram"); G.act("flowDem", 0);
for(let p=0;p<PT.n.pump;p++) if(PT.pumpPrimary[p]) ST.flowBy[p] = 0;
march(45);

/* the core loop, walked downstream from the core node along the edges carrying its flow */
const core = PT.coreNode[0], wc = SX.netCoreKg[0], loop = [];
let at = core, guard = 0;
do {
  let best = -1, bw = 0;
  for(let e=0;e<PT.n.edge;e++){ const w = ST.edW[e], u = PT.edU[e], v = PT.edV[e];
    const from = w >= 0 ? u : v; if(from !== at || PT.nodeCirc[u] !== PT.nodeCirc[core]) continue;
    if(Math.abs(w) > bw){ bw = Math.abs(w); best = e; } }
  if(best < 0) break;
  loop.push(best); at = ST.edW[best] >= 0 ? PT.edV[best] : PT.edU[best];
} while(at !== core && ++guard < 200);
const closed = at === core;
const g = 9.80665, rhoT = T => G.wpRhof(T), muT = T => 2.414e-5*Math.pow(10, 247.8/(T - 140));
let B = 0, R = 0;
for(const e of loop){ const w = ST.edW[e], u = PT.edU[e], v = PT.edV[e], from = w >= 0 ? u : v, to = w >= 0 ? v : u;
  const T = G.eNodeT(from), rho = rhoT(T);
  B += rho*g*(PT.nodeZ[from] - PT.nodeZ[to]);
  let K, A;
  if(PT.edCk[e] === 0){ const C = PT.edC0[e]; A = 1; K = 1/(C*C); }
  else { const D = G.boreM(PT.edBore[e]); A = Math.PI/4*D*D;
    K = colebrook(4*Math.abs(w)/(Math.PI*D*muT(T)), 4.5e-5/D)*Math.max(PT.edLen[e], 0.1)/D + PT.edK0[e]; }
  R += K/(2*rho*A*A); }
const wTruth = B > 0 ? Math.sqrt(B/R) : 0;
check("natural circulation, core loop flow 45 s after pump stop", Math.abs(wc), wTruth, 0.10,
  "loop momentum balance: buoyancy sum(rho g dz) round the engine's own node temperatures = sum of Darcy-Colebrook and stated losses; rho, mu of water from IAPWS (saturated-liquid density)",
  {unit:"kg/s", pass:closed ? undefined : false, note:(closed ? "" : "loop walk did not close; ") + loop.length + " edges, buoyancy " + (B/1e3).toFixed(2) + " kPa"});
