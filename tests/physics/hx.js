"use strict";
const {load, check, commissionPreset, march, if97, TofH} = require("./lib.js");
const G = load();
const KL = "counterflow effectiveness, Kays & London: eps = (1-exp(-NTU(1-Cr)))/(1-Cr exp(-NTU(1-Cr))); Cr=1: NTU/(1+NTU)";
const eps = (ntu, cr) => cr >= 1 ? ntu/(1 + ntu) : (1 - Math.exp(-ntu*(1 - cr)))/(1 - cr*Math.exp(-ntu*(1 - cr)));
for(const [ntu, cr] of [[0.5, 0], [2, 0], [1, 0.5], [3, 0.8], [2, 1]])
  check("counterflow eps(NTU " + ntu + ", Cr " + cr + ")", G.eNtuCounter(ntu, cr), eps(ntu, cr), 1e-9, KL);

/* a stream against a boiling (isothermal) shell, whatever its cp does: the integral of dh/(T(h) - Ts) from h_out to h_in is UA/w; h_out found by midpoint steps */
const EXACT = "Cr = 0 with variable cp: integral of dh/(T(h) - Ts) over the stream = UA/w";
const hOut = (hin, hs, Ts, T, ntuW) => { const dh = 0.01; let h = hin, I = 0;
  while(h > hs + dh){ const d = dh/(T(h - dh/2) - Ts);
    if(I + d >= ntuW) return h - dh*(ntuW - I)/d;
    I += d; h -= dh; }
  return h; };
{ const cp = 5, Ts = 550, Tin = 600, UAw = 0.2, hin = cp*Tin, hs = cp*Ts;
  check("the integral against its constant-cp limit, 1 - exp(-NTU)", (hin - hOut(hin, hs, Ts, h => h/cp, UAw))/(hin - hs), 1 - Math.exp(-UAw/cp), 1e-4, EXACT); }

/* the stage's own heat against that law, on the model's own h(T) and on IF97 region 1, and the outlet water against the stage */
commissionPreset(0);
march(10);
const PT = G.PT, ST = G.ST, SX = G.SX, b = PT.sgBoiler[0];
G.eStageStream(0, 0);
const at = SX.stgN[0], w = SX.stgW[0], Ts = ST.sgTBy[b], p = G.eNodeP(at), c = G.eNodeSat(at);
const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02), filmK = 1 - 0.85*Math.min(Math.max(ST.sc[G.SC_VF], 0), 1);
const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1)*filmK;
G.E_SQ[0] = fl; G.E_SQ[1] = filmK; G.eSgQ(0);
const Q = G.E_SQ[2], io = new Float64Array(G.MX_N);
const Tmodel = h => { io[G.MX_P] = p; io[G.MX_H] = h; G.tOfHA(c, io); return io[G.MX_T]; };
const hin = ST.hBy[at], qOwn = w*(hin - hOut(hin, G.hOfT(c, Ts), Ts, Tmodel, UA/w));
const Tin = Tmodel(hin), hin97 = if97(p, Tin).h, q97 = w*(hin97 - hOut(hin97, if97(p, Ts).h, Ts, h => TofH(p, h), UA/w));
check("steam generator heat against the variable-cp law on its own h(T) (boiling shell)", Q, qOwn, 1e-3, EXACT,
  {gap:"Steam generator effectiveness", note:"UA " + UA.toFixed(0) + " kW/K, w " + w.toFixed(0) + " kg/s; on IF97 region 1 the law gives " + (q97/1000).toFixed(1) + " MW"});
const outI = PT.sgPrimB[0];
let hOutRun = NaN;
for(let e=0;e<PT.n.edge;e++){ const ww = ST.edW[e], from = ww >= 0 ? PT.edU[e] : PT.edV[e], to = ww >= 0 ? PT.edV[e] : PT.edU[e];
  if(from === outI && PT.nodeRun[to] >= 0) hOutRun = ST.hBy[to]; }
check("steam generator: the outlet water carries the stage's heat", w*(hin - hOutRun), Q, 1e-2, "first law across the tube side at quasi-steady state", {note:"what the transport and the tube metal hold back"});
