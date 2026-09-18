"use strict";
const {load, check, commissionPreset, march} = require("./lib.js");
const G = load();
const KL = "counterflow effectiveness, Kays & London: eps = (1-exp(-NTU(1-Cr)))/(1-Cr exp(-NTU(1-Cr))); Cr=1: NTU/(1+NTU)";
const eps = (ntu, cr) => cr >= 1 ? ntu/(1 + ntu) : (1 - Math.exp(-ntu*(1 - cr)))/(1 - cr*Math.exp(-ntu*(1 - cr)));
for(const [ntu, cr] of [[0.5, 0], [2, 0], [1, 0.5], [3, 0.8], [2, 1]])
  check("counterflow eps(NTU " + ntu + ", Cr " + cr + ")", G.eNtuCounter(ntu, cr), eps(ntu, cr), 1e-9, KL);

/* a boiling shell is Cr = 0: what the primary water gives up across the generator against what its stated UA says it can */
commissionPreset(0);
march(10);
const PT = G.PT, ST = G.ST, SX = G.SX, b = PT.sgBoiler[0];
G.eStageStream(0, 0);
G.E_SQ[3] = ST.sgTBy[b]; G.eStageSecant(0);
const Tin = SX.stgT[0], wcp = SX.stgC[0], Ts = ST.sgTBy[b];
const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02);
const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1)*(1 - 0.85*Math.min(Math.max(ST.sc[G.SC_VF], 0), 1));
const inI = PT.sgPrimA[0], outI = PT.sgPrimB[0];
let tOut = NaN;
for(let e=0;e<PT.n.edge;e++){ const w = ST.edW[e], from = w >= 0 ? PT.edU[e] : PT.edV[e], to = w >= 0 ? PT.edV[e] : PT.edU[e];
  if(from === outI && PT.nodeRun[to] >= 0) tOut = G.eNodeT(to); }
check("steam generator effectiveness (boiling shell, Cr = 0)", (Tin - tOut)/(Tin - Ts), 1 - Math.exp(-UA/wcp), 0.03,
  "eps = 1 - exp(-UA/(w cp)) for a counterflow exchanger against a boiling (isothermal) stream", {note:"UA " + (UA).toFixed(0) + " kW/K, wcp " + wcp.toFixed(0) + " kW/K"});
