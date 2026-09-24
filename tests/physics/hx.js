"use strict";
// chunks: base tp
const {load, check, commissionPreset, march, if97, TofH, inBundle} = require("./lib.js");
const G = load(), mode = process.argv[2];
if(mode === "base"){
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
const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02);
const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1);
G.E_SQ[0] = fl; G.eSgQ(0);
const Q = G.E_SQ[2], io = new Float64Array(G.MX_N);
const Tmodel = h => { io[G.MX_P] = p; io[G.MX_H] = h; G.tOfHA(c, io); return io[G.MX_T]; };
const hin = ST.hBy[at], qOwn = w*(hin - hOut(hin, G.hOfTP(c, Ts, p), Ts, Tmodel, UA/w));
const Tin = Tmodel(hin), hin97 = if97(p, Tin).h, q97 = w*(hin97 - hOut(hin97, if97(p, Ts).h, Ts, h => TofH(p, h), UA/w));
check("steam generator heat against the variable-cp law on its own h(T) (boiling shell)", Q, qOwn, 1e-3, EXACT,
  {gap:"Steam generator effectiveness", note:"UA " + UA.toFixed(0) + " kW/K, w " + w.toFixed(0) + " kg/s; on IF97 region 1 the law gives " + (q97/1000).toFixed(1) + " MW"});
const outI = PT.sgPrimB[0];
let hOutRun = NaN;
for(let e=0;e<PT.n.edge;e++){ const ww = ST.edW[e], from = ww >= 0 ? PT.edU[e] : PT.edV[e], to = ww >= 0 ? PT.edV[e] : PT.edU[e];
  if(from === outI && PT.nodeRun[to] >= 0) hOutRun = ST.hBy[to]; }
check("steam generator: the outlet water carries the stage's heat", w*(hin - hOutRun), Q, 1e-2, "first law across the tube side at quasi-steady state", {note:"what the transport and the tube metal hold back"});
}

/* a two-phase stream's film against its liquid-only film at the same mass flux */
if(mode === "tp"){
  const SHAH = "Shah (1979), as Shah's own restatement (HVAC&R 15:5, 2009): h_TP/h_LT = (1 - x)^0.8 + 3.8 x^0.76 (1 - x)^0.04 / p_r^0.38";
  const CHEN = "Chen (1966) convective part, Thome Engineering Data Book III ch. 10 eqs 10.3.4-10.3.8: (1 - x)^0.8 F, F = 2.35 (1/X_tt + 0.213)^0.736, 1 when 1/X_tt <= 0.1";
  const W = G.SAT_WATER, PCW = 22.064, io = new Float64Array(8);
  /* saturated properties off the engine's own doors, IF97 and IAPWS R12-08/R15-11, graded in props.js */
  const sat = p => { io[0] = p; G.satTA(W, io, 0, 1); const T = io[1]; G.curveA(W, G.CV_RF, io, 1, 2); G.curveA(W, G.CV_RG, io, 1, 3);
    const S = G.STR; S[0] = T; S[1] = io[2]; G.steamTrA(); const mf = S[2], kf = S[3]; S[1] = io[3]; G.steamTrA(); const mg = S[2], kg = S[3];
    io[4] = T; io[5] = p; G.wCptpA(io, 4, 5, 6); const cg = new Float64Array(3); G.if97Steam(T, p, cg);
    return {rf:io[2], rg:io[3], mf, mg, kf, kg, cf:io[6], cg:cg[2]}; };
  const floor = s => (s.kg/s.kf)*Math.pow(s.mf/s.mg, 0.8)*Math.pow((s.cg*s.mg/s.kg)/(s.cf*s.mf/s.kf), 0.4);
  const shah = (x, p) => Math.pow(1 - x, 0.8) + 3.8*Math.pow(x, 0.76)*Math.pow(1 - x, 0.04)/Math.pow(p/PCW, 0.38);
  const chen = (x, s) => { const ix = Math.pow(x/(1 - x), 0.9)*Math.sqrt(s.rf/s.rg)*Math.pow(s.mg/s.mf, 0.1);
    return Math.pow(1 - x, 0.8)*(ix > 0.1 ? 2.35*Math.pow(ix + 0.213, 0.736) : 1); };
  const eng = (x, p, take) => { const F = G.E_FLM; F[0] = x; F[1] = p; F[2] = take; G.eFilmA(W); return F[3]; };
  let es = 0, ec = 0;
  for(const p of [7, 15]){ const s = sat(p), fl = floor(s);
    for(const x of [0.1, 0.5, 0.9]){ es = Math.max(es, Math.abs(eng(x, p, 0)/Math.max(shah(x, p), fl) - 1)); ec = Math.max(ec, Math.abs(eng(x, p, 1)/Math.max(chen(x, s), fl) - 1)); } }
  check("condensing film ratio against Shah typed here, x 0.1/0.5/0.9 at 7 and 15 MPa, floored at the vapour-only film, worst", es, 0, 1e-12, SHAH, {abs:true});
  check("evaporating film ratio against Chen typed here, the same points, worst", ec, 0, 1e-12, CHEN, {abs:true});
  const lo = () => { let m = Infinity; for(let x=0.1;x<0.95;x+=0.1) m = Math.min(m, eng(x, 7, 0)); return m; };
  const m = lo();
  check("a condensing stream at 7 MPa, x 0.1-0.9, transfers at least as well as liquid", m, 1, 0, SHAH + ": condensing films run over the liquid-only film", {pass:m >= 1, note:"least " + m.toFixed(3)});
  const keep = G.eFilmA.toString();
  inBundle("eFilmA = function(c){ E_FLM[3] = 1 - 0.85*E_FLM[0]; }"); const mf = lo();
  inBundle("eFilmA = " + keep.replace(/^function eFilmA/, "function"));
  check("fault injected, the old 1 - 0.85 x derating: the check above fails", mf < 1 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"least " + mf.toFixed(3)});
  /* a generator's liquid primary reads no film change, whatever any core's void */
  commissionPreset(0); march(1);
  const ST = G.ST, sc = ST.sc, fl = Math.max(sc[G.SC_FLOWNET]*ST.sgShare[0], 0.02);
  const q = vf => { sc[G.SC_VF] = vf; G.E_SQ[0] = fl; G.eSgQ(0); return G.E_SQ[2]; };
  const q0 = q(0), q5 = q(0.5);
  check("STOCK PWR's generator with its primary liquid: the same heat at a core void of 0 and 0.5", q5/q0 - 1, 0, 0, "a film is read off the stream it wets, not off the core", {abs:true, note:"film ratio " + G.E_FLM[3]});
  const ks = G.eSgQ.toString();
  inBundle("eSgQ = " + ks.replace("*fill/(", "*fill*(1 - 0.85*Math.min(ST.sc[SC_VF], 1))/(").replace(/^function eSgQ/, "function"));
  const f5 = q(0.5)/q(0) - 1; inBundle("eSgQ = " + ks.replace(/^function eSgQ/, "function"));
  check("fault injected, the film read off the core's void: the check above fails", f5 !== 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"moves " + f5.toFixed(3)});
}
