"use strict";
const {load, check, rig} = require("./lib.js");
const G = load();
rig(R => { R.tank("srcA", 6, 10, 1, {vol:2}); R.tank("sinkA", 26, 10, 0.15, {vol:2}); R.joinH("srcA", "sinkA"); R.wall(60); });
const PT = G.PT, SX = G.SX;
let e = -1; for(let k=0;k<PT.n.edge;k++) if(PT.edCk[k] === 1 && e < 0) e = k;
const u = PT.edU[e], v = PT.edV[e], up = PT.edChoke[e] >= 0 ? PT.edChoke[e] : v, dn = up === u ? v : u;

/* the engine's own edge law on a stated donor: mass flux per unit C (= Cd*A), kg/s/m2 */
function flux(p0, pd, rho, x, b, T){
  const c = G.SAT_WATER;
  for(const i of [up, dn]){ SX.fWet[i] = 1; SX.fVoid[i] = 0; SX.fX[i] = x; SX.fB[i] = b;
    SX.fLh[i] = c.cp*((T || G.satT(c, p0)) - 273.15) + (b === 2 ? 1e4 : 0);
    SX.fRho[i] = SX.fRhoD[i] = SX.fRhoG[i] = SX.fRhoL[i] = rho; }
  SX.fP[up] = p0; SX.fP[dn] = pd;
  return G.eFlowG(1, e, 0, 0)*(p0 - pd);
}
const ideal = (p0, rho, gam, r) => { const rc = Math.pow(2/(gam+1), gam/(gam-1)), q = Math.max(r, rc);
  return Math.sqrt(2*p0*1e6*rho*gam/(gam-1)*(Math.pow(q, 2/gam) - Math.pow(q, (gam+1)/gam))); };

check("dry saturated steam, 7 MPa to atmosphere", flux(7, 0.1, 36.525, 1, 2), 1.4568e-3*7e6, 0.05,
  "Napier's rule w = p*A/70 (lb/s, psia, in2), dry saturated steam; rho_g(7 MPa) 36.525 kg/m3 IAPWS-IF97", {unit:"kg/s/m2"});
check("dry saturated steam, 1 MPa to atmosphere", flux(1, 0.1, 5.145, 1, 2), 1.4568e-3*1e6, 0.05,
  "Napier's rule, dry saturated steam; rho_g(1 MPa) 5.145 kg/m3 IAPWS-IF97", {unit:"kg/s/m2"});
check("superheated steam 7 MPa, critical", flux(7, 0.1, 22.0, 1, 2), ideal(7, 22.0, 1.3, 0), 0.02,
  "isentropic ideal-gas critical flow, gamma 1.3 (superheated steam)", {unit:"kg/s/m2"});
check("superheated steam 7 MPa, subcritical r = 0.8", flux(7, 5.6, 22.0, 1, 2), ideal(7, 22.0, 1.3, 0.8), 0.02,
  "isentropic ideal-gas nozzle flow, gamma 1.3, pressure ratio 0.8", {unit:"kg/s/m2"});

/* saturation, IAPWS-IF97: p MPa, T K, hf and hfg kJ/kg, sf kJ/kg/K, vf and vg m3/kg */
const TAB = [
  [3,  507.00, 1008.4, 1795.0, 2.6457, 0.0012165, 0.066664],
  [4,  523.50, 1087.4, 1713.5, 2.7966, 0.0012522, 0.049776],
  [5,  537.09, 1154.5, 1639.7, 2.9207, 0.0012862, 0.039446],
  [6,  548.73, 1213.9, 1570.9, 3.0275, 0.0013190, 0.032448],
  [7,  558.98, 1267.4, 1505.1, 3.1220, 0.0013516, 0.027378],
  [8,  568.16, 1317.1, 1441.3, 3.2077, 0.0013842, 0.023525],
  [10, 584.15, 1408.1, 1317.4, 3.3606, 0.0014526, 0.018030],
  [12, 597.83, 1491.3, 1193.6, 3.4967, 0.0015267, 0.014264],
  [15, 615.31, 1610.5, 1000.5, 3.6848, 0.0016572, 0.010340],
];
const sat = p => { const l = Math.log(p);
  let k = 0; while(k < TAB.length - 3 && TAB[k+1][0] < p) k++;
  const L = [0, 1, 2].map(j => Math.log(TAB[k+j][0]));
  const wt = [0, 1, 2].map(j => { let w = 1; for(let m=0;m<3;m++) if(m !== j) w *= (l - L[m])/(L[j] - L[m]); return w; });
  const q = (j, f) => { let s = 0; for(let m=0;m<3;m++) s += wt[m]*f(TAB[k+m][j]); return s; };
  return {T:q(1, y => y), hf:q(2, y => y), hfg:q(3, y => y), sf:q(4, y => y), vf:q(5, y => y), vg:Math.exp(q(6, Math.log))}; };
function hem(p0, x0){
  const s = sat(p0), h0 = s.hf + x0*s.hfg, s0 = s.sf + x0*s.hfg/s.T;
  let best = 0, at = p0;
  for(let k=1;k<4000;k++){ const p = p0 - k*(p0 - 3)/4000, t = sat(p);
    const x = (s0 - t.sf)*t.T/t.hfg, h = t.hf + x*t.hfg, vm = t.vf + x*(t.vg - t.vf);
    const Gm = Math.sqrt(Math.max(0, 2*(h0 - h)*1000))/vm;
    if(Gm > best){ best = Gm; at = p; } }
  return {G:best, rho0:1/(s.vf + x0*(s.vg - s.vf)), at};
}
for(const [p0, x0] of [[7, 0], [7, 0.2], [15, 0.05]]){
  const H = hem(p0, x0);
  check("steam-water x " + x0 + " at " + p0 + " MPa, critical", flux(p0, 0.1, H.rho0, x0, x0 > 0 ? 1 : 0), H.G, 0.10,
    "homogeneous equilibrium model: isentropic flash on IAPWS-IF97 saturation data, maximum mass flux", {unit:"kg/s/m2",
    note:"HEM throat " + H.at.toFixed(2) + " MPa"});
}
