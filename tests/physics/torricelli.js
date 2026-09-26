"use strict";
const {load, check, rig, watch, colebrook} = require("./lib.js");
const G = load();
const SRC = "Torricelli/Bernoulli drain with Darcy-Weisbach-Colebrook line loss, with the line's own inertia L/A, integrated (RK4) from the commissioned flow; the line discharges at the receiver's top nozzle, above its surface; water 310 K rho 993.3, mu 6.92e-4 (IAPWS)";
const RHO = 993.3, MU = 6.92e-4, g = 9.80665, SECS = 20;
rig(R => { R.tank("tk", 10, 4, 0, {vol:5, level:95, gas:null, inf:false}); R.tank("sinkA", 10, 20, 0.1, {vol:2});
  R.joinV("tk", "sinkA"); R.wall(60); R.bore(150); });
const PT = G.PT, ST = G.ST, t = G.IX.tank.get("tk"), k = G.IX.tank.get("sinkA");
const e0 = (() => { for(let e=0;e<PT.n.edge;e++) if(PT.edCk[e] === 1) return e; return -1; })();
let e1 = -1; for(let e=e0+1;e<PT.n.edge;e++) if(PT.edCk[e] === 1){ e1 = e; break; }
const Dm = G.boreM(PT.edBore[e0]), Ap = Math.PI/4*Dm*Dm, Lp = PT.edLen[e0] + PT.edLen[e1], K0 = PT.edK0[e0] + PT.edK0[e1];
const At = PT.tankVol[t]/PT.tankHgt[t], zs2 = Math.max(PT.tankZb[k] + PT.tankHgt[k]*ST.tank[k]/100, PT.edZn[e0]);
const fK = w => { const Re = Math.max(4*Math.abs(w)/(Math.PI*Dm*MU), 1); return colebrook(Re, 4.5e-5/Dm)*Lp/Dm + K0; };
const der = (lvl, w) => { const dz = PT.tankZb[t] + PT.tankHgt[t]*Math.max(lvl, 0)/100 - zs2;
  return [-w/(RHO*At*PT.tankHgt[t]/100), Ap/Lp*(RHO*g*dz - fK(w)*w*Math.abs(w)/(2*RHO*Ap*Ap))]; };
let L = ST.tank[t], W = Math.abs(ST.edW[e0]);
const l0 = L;
let WS = 0;
for(let i=0, h=0.01;i<SECS/h;i++){ if(i === 500) WS = W;
  const a = der(L, W), b = der(L + h*a[0]/2, W + h*a[1]/2), c = der(L + h*b[0]/2, W + h*b[1]/2), d = der(L + h*c[0], W + h*c[1]);
  L += h*(a[0] + 2*b[0] + 2*c[0] + d[0])/6; W += h*(a[1] + 2*b[1] + 2*c[1] + d[1])/6; }
const wS = []; watch(G, {cap:SECS, each:k => { if(k === 250) wS.push(Math.abs(ST.edW[e0])); }});
check("drain flow at 5 s", wS[0], WS, 0.03, SRC, {unit:"kg/s"});
check("tank level after " + SECS + " s", ST.tank[t], L, 0.03, SRC, {unit:"%", note:"from " + l0.toFixed(1) + " %"});
check("drain flow after " + SECS + " s", Math.abs(ST.edW[e0]), W, 0.03, SRC, {unit:"kg/s"});
