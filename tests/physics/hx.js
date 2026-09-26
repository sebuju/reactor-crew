"use strict";
// chunks: base law sg,1,10 sg,4,1 rev chain chain,fault sh tp
const {load, check, commissionPreset, watch, if97, TofH, inBundle} = require("./lib.js");
const G = load(), mode = process.argv[2];
const KL = "counterflow effectiveness, Kays & London: eps = (1-exp(-NTU(1-Cr)))/(1-Cr exp(-NTU(1-Cr))); Cr=1: NTU/(1+NTU)";
const EXACT = "Cr = 0 with variable cp: integral of dh/(T(h) - Ts) over the stream = UA/w";
const TWO = "counterflow with both c_p variable: UA = integral of dq/(T_a(q) - T_b(q)) along the exchanger";

/* a tools/sandbox/net.js profile built by its own builder on the test's rig; returns the clamps it asked for */
const sandboxRig = key => { const {rig} = require("./lib.js"), clamps = [], stub = () => ({dp:0, f:() => 0});
  const PTK = ["ST","SX","PT","IX","SCHEMA","P","D","LAY","MACHINE","ROLE"], M = new Proxy({}, {get:(t, k) => PTK.includes(k) ? () => G[k] : G[k]});
  const prof = require(require("path").join(__dirname, "..", "..", "tools", "sandbox", "net.js"))({M, D:G.D, COL:{mwe:stub()}, colNodeT:stub, colNodeP:stub,
    colNodeX:stub, colNet:{}, colTankP:stub, colTankQ:stub, clamp_:(p, v) => clamps.push([p, v])})[key]();
  rig(R => { R.source = (id, x, y, p, cfg) => R.tank(id, x, y, p, cfg); R.void_ = (id, x, y, cfg) => R.tank(id, x, y, 0.15, cfg);
    const fit = R.fit; R.fit = (x, y, m) => fit(x, y, m); prof.build(R); });
  return clamps; };

/* a stream against a boiling (isothermal) shell, whatever its cp does: the integral of dh/|T(h) - Ts| from h_in to h_out is UA/w, cooling or heating; h_out found by midpoint steps */
const hOut = (hin, hs, Ts, T, ntuW, dh = 0.01) => { const s = T(hin) > Ts ? 1 : -1; let h = hin, I = 0;
  while(s*(h - hs) > dh){ const d = dh/(s*(T(h - s*dh/2) - Ts));
    if(I + d >= ntuW) return h - s*dh*(ntuW - I)/d;
    I += d; h -= s*dh; }
  return h; };

/* generator 0 of preset pre at secs s: the stage's heat against the law on the model's own h(T) */
const sgCase = (pre, secs) => {
  commissionPreset(pre);
  watch(G, {cap:secs});
  const PT = G.PT, ST = G.ST, SX = G.SX, b = PT.sgBoiler[0];
  G.eStageStream(0, 0);
  const at = SX.stgN[0], w = SX.stgW[0], Ts = ST.sgTBy[b], p = G.eNodeP(at), c = G.eNodeSat(at);
  const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02);
  const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1);
  G.E_SQ[0] = fl; G.eSgQ(0);
  const Q = G.E_SQ[2], io = new Float64Array(G.MX_N);
  const Tmodel = h => { io[G.MX_P] = p; io[G.MX_H] = h; G.tOfHA(c, io); return io[G.MX_T]; };
  const hin = ST.hBy[at], qOwn = w*(hin - hOut(hin, G.hOfTP(c, Ts, p), Ts, Tmodel, UA/w));
  const Tin = Tmodel(hin), hin97 = if97(p, Tin).h, q97 = w*(hin97 - hOut(hin97, if97(p, Ts).h, Ts, h => TofH(p, h), UA/w, 0.1));
  check(G.PLANTPRE[pre][0] + " generator heat against the variable-cp law on its own h(T) (boiling shell)", Q, qOwn, 1e-4, EXACT,
    {note:"UA " + UA.toFixed(0) + " kW/K, w " + w.toFixed(0) + " kg/s; on IF97 region 1 the law gives " + (q97/1000).toFixed(1) + " MW against " + (Q/1000).toFixed(1)});
  return {Q, w, hin, at}; };

if(mode === "base"){
{ const cp = 5, Ts = 550, Tin = 600, UAw = 0.2, hin = cp*Tin, hs = cp*Ts;
  check("the integral against its constant-cp limit, 1 - exp(-NTU)", (hin - hOut(hin, hs, Ts, h => h/cp, UAw))/(hin - hs), 1 - Math.exp(-UAw/cp), 1e-4, EXACT); }
const {Q, w, hin} = sgCase(0, 10), PT = G.PT, ST = G.ST;
const outI = PT.sgPrimB[0];
let hOutRun = NaN;
for(let e=0;e<PT.n.edge;e++){ const ww = ST.edW[e], from = ww >= 0 ? PT.edU[e] : PT.edV[e], to = ww >= 0 ? PT.edV[e] : PT.edU[e];
  if(from === outI && PT.nodeRun[to] >= 0) hOutRun = ST.hBy[to]; }
check("steam generator: the outlet water carries the stage's heat", w*(hin - hOutRun), Q, 1e-2, "first law across the tube side at quasi-steady state", {note:"what the transport and the tube metal hold back"});
}

if(mode === "sg") sgCase(+process.argv[3], +process.argv[4]);

if(mode === "law"){
  const H = G.HX, S = G.HX_S, W = G.SAT_WATER;
  const put = (k, c, p, w, h) => { H[k] = p; G.hxLineA(c, k); H[k+9] = w; H[k+10] = h; };
  const law = (c0, c1, UA) => { H[G.HX_UA] = UA; G.hxLawA(c0, c1); return H[G.HX_Q]; };
  const Na = G.satCurveFor(G.COOLANT.find(r => r.id === "SFR"), 0.2), cp = Na.cp, hNa = T => cp*(T - 273.15);
  for(const [ntu, cr] of [[0.5, 0], [2, 0], [1, 0.5], [3, 0.8], [2, 1]]){
    const e = Math.exp(-ntu*(1 - cr)), eps = cr >= 1 ? ntu/(1 + ntu) : (1 - e)/(1 - cr*e);
    put(0, Na, 0.2, 100/cp, hNa(800));
    if(cr > 0) put(S, Na, 0.2, 100/(cr*cp), hNa(600)); else { H[S+9] = Infinity; H[G.HX_TISO] = 600; }
    check("the law on constant c_p, NTU " + ntu + ", Cr " + cr, law(Na, Na, ntu*100), eps*100*200, 1e-9, KL); }

  /* the test's own quadrature: q' marched from the cold end in N midpoint steps, q found by bisection */
  const fineReq = (ca, pa, wa, ha, cb, pb, wb, hb, q) => { const N = 4000, dq = q/N; let ua = 0;
    for(let i=0;i<N;i++){ const m = (i + 0.5)*dq, d = G.tOfH(ca, pa, ha - (q - m)/wa) - G.tOfH(cb, pb, hb + m/wb);
      if(!(d > 0)) return Infinity; ua += dq/d; }
    return ua; };
  const fineQ = (ca, pa, wa, ha, cb, pb, wb, hb, UA) => { let lo = 0, hi = 1;
    while(fineReq(ca, pa, wa, ha, cb, pb, wb, hb, hi) < UA) hi *= 2;
    for(let k=0;k<60;k++){ const m = (lo + hi)/2; if(fineReq(ca, pa, wa, ha, cb, pb, wb, hb, m) < UA) lo = m; else hi = m; }
    return (lo + hi)/2; };
  const two = (name, ca, pa, wa, ha, cb, pb, wb, hb, UA) => {
    put(0, ca, pa, wa, ha); put(S, cb, pb, wb, hb);
    const q = law(ca, cb, UA), qf = fineQ(ca, pa, wa, ha, cb, pb, wb, hb, UA);
    return [check(name, q, qf, 1e-3, TWO, {note:"UA " + UA + " kW/K; " + (q/1000).toFixed(3) + " MW"}), qf]; };
  two("water 15.5 MPa, 590 K, 100 kg/s against water 7 MPa, 500 K, 120 kg/s", W, 15.5, 100, G.hOfTP(W, 590, 15.5), W, 7, 120, G.hOfTP(W, 500, 7), 800);
  const CO2 = G.COOLANT.find(r => r.id === "CO2"), cg = G.satCurveFor(CO2, CO2.P0), ps = 1.448, hg = G.satHg(W, ps);
  const steam = () => two("CO2 at 609 K, 100 kg/s against saturated steam at 1.448 MPa, 20 kg/s (superheating)", cg, CO2.P0, 100, G.hOfTP(cg, 609.15, CO2.P0), W, ps, 20, hg, 100);
  const [, qs] = steam();
  const keep = G.hxLawA.toString();
  inBundle("hxLawA = function(c0, c1){ const io = HX, k1 = HX_S;" +
    " io[6] = io[10]; hxTA(c0, 0, 0); const Ta = io[7]; io[k1+6] = io[k1+10]; hxTA(c1, k1, 0); const Tb = io[k1+7];" +
    " const C = (c, k, T, To) => io[k+10] > io[k+1] ? Infinity : io[k+9]*(hOfTP(c, T, io[k]) - hOfTP(c, To, io[k]))/(T - To);" +
    " const ca = C(c0, 0, Ta, Tb), cb = C(c1, k1, Tb, Ta), cmin = Math.min(ca, cb), cmax = Math.max(ca, cb), cr = cmax < Infinity ? cmin/cmax : 0, ntu = io[HX_UA]/cmin, e = Math.exp(-ntu*(1 - cr));" +
    " io[HX_Q] = (cr < 0.999 ? (1 - e)/(1 - cr*e) : ntu/(1 + ntu))*cmin*(Ta - Tb); }");
  put(0, cg, CO2.P0, 100, G.hOfTP(cg, 609.15, CO2.P0)); put(S, W, ps, 20, hg);
  const qOld = law(cg, W, 100);
  inBundle("hxLawA = " + keep.replace(/^function hxLawA/, "function"));
  check("fault injected, the old secant law with the steam as an infinite capacity rate: the steam check fails", Math.abs(qOld/qs - 1) > 1e-3 ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:"off by " + (qOld/qs - 1).toFixed(4)});

  const p7 = 7, hf = G.satH(W, p7), hfg = G.satHg(W, p7) - hf, Ts7 = G.tOfH(W, p7, hf + 0.5*hfg);
  put(0, W, p7, 100, hf + 0.5*hfg); H[S+9] = Infinity; H[G.HX_TISO] = 500;
  check("a condensing stream in its dome against a boiling shell: q = UA (T_sat - T_shell)", law(W, null, 50), 50*(Ts7 - 500), 1e-9,
    "both sides at one temperature each: q = UA dT", {note:"the stream leaves at x " + ((H[G.HX_HO] - hf)/hfg).toFixed(4)});
}

/* heat from whichever side is hotter, and a shell at its own temperature */
if(mode === "rev"){
  const REV = "a stream colder than the shell it runs through takes heat from it: the integral of dh/(Ts - T(h)) over the stream = UA/w";
  commissionPreset(0);
  const PT = G.PT, ST = G.ST, SX = G.SX, b = PT.sgBoiler[0], sh = PT.stgShell[0], A = PT.stgA0[0], Bn = PT.stgB0[0], bn = PT.boilerNode[b], DT = 0.02;
  watch(G, {cap:5*DT});
  const snap = G.engSnap(G.engSnapNew());
  const fl = Math.max(ST.sc[G.SC_FLOWNET]*ST.sgShare[0]*Math.max(1, PT.n.sg), 0.02);
  const heat = () => { const E = G.E_TK; E[G.E_TK_HEAT] = ST.sc[G.SC_HEAT]; E[G.E_TK_FLOW] = ST.sc[G.SC_FLOWNET]; G.eSgHeatStep(); };
  const sides = () => { G.eAdvectSrc(DT); const s = SX.tSrc, mq = SX.tMetQ;
    return {give:-(s[A] - mq[A]) - (s[Bn] - mq[Bn]), take:s[sh] - mq[sh] - ST.sgSwQBy[0] + ST.skinQ[PT.stgPart[0]]}; };
  const law = () => { G.E_SQ[0] = fl; G.eSgQ(0); return G.E_SQ[2]; };
  /* every node of the primary below the shell's saturation by 20 K */
  const Ts = G.tOfH(G.eNodeSat(bn), G.eSecP(0), ST.hBy[bn]);
  for(let i=0;i<PT.n.node;i++) if(PT.nodeCirc[i] === PT.coreCirc0 && ST.hBy[i] === ST.hBy[i]) ST.hBy[i] = G.hOfTP(G.eNodeSat(i), Ts - 20, G.eNodeP(i));
  G.eStageStream(0, 0);
  const at = SX.stgN[0], w = SX.stgW[0], p = G.eNodeP(at), c = G.eNodeSat(at);
  const UA = PT.stageUA[0]*Math.pow(fl, G.E_UA_FLOW)*Math.min(Math.max(G.eBoilerLvl(b)/G.E_SG_DRY, 0), 1);
  const io = new Float64Array(G.MX_N), Tm = h => { io[G.MX_P] = p; io[G.MX_H] = h; G.tOfHA(c, io); return io[G.MX_T]; };
  const hin = ST.hBy[at], qx = w*(hin - hOut(hin, G.hOfTP(c, Ts, p), Ts, Tm, UA/w, 0.002)), q = law();
  check("STOCK PWR's primary 20 K under its shell: the generator gives heat back, against the law heating the stream", q, qx, 1e-9, REV, {note:(q/1000).toFixed(1) + " MW"});
  heat(); const d = sides();
  check("the same: the primary gains what the shell loses", d.give - d.take, 0, 1e-12*Math.abs(q), "first law across the tubes", {abs:true, unit:"kW", note:"shell gives " + (-d.take/1000).toFixed(1) + " MW"});
  const ks = G.eSgQ.toString(), from = "io[2] = HX[HX_Q];";
  if(!ks.includes(from)) throw new Error("eSgQ: no " + from);
  inBundle("eSgQ = " + ks.replace(from, "io[2] = Math.max(0, HX[HX_Q]);").replace(/^function eSgQ/, "function"));
  const qf = law(); inBundle("eSgQ = " + ks.replace(/^function eSgQ/, "function"));
  check("fault injected, the old max(0, T_in - Ts): the reverse check fails", Math.abs(qf/qx - 1) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"passes " + qf.toFixed(1) + " kW"});

  /* the shell 15 K subcooled under its own saturation, the primary as it was */
  G.engRestore(snap); G.eNetInvalidate();
  const ps = G.eSecP(0); ST.hBy[bn] = G.hOfTP(G.eNodeSat(bn), ST.sgTBy[b] - 15, ps);
  const Tb = G.tOfH(G.eNodeSat(bn), ps, ST.hBy[bn]), qs = law();
  G.eStageStream(0, 0);
  const H = G.HX; H[0] = G.eNodeP(SX.stgN[0]); G.hxLineA(G.eNodeSat(SX.stgN[0]), 0); H[9] = SX.stgW[0]; H[10] = ST.hBy[SX.stgN[0]];
  H[G.HX_S+9] = Infinity; H[G.HX_TISO] = Tb; H[G.HX_UA] = UA; G.hxLawA(G.eNodeSat(SX.stgN[0]), null);
  const qe = H[G.HX_Q];
  check("a shell 15 K subcooled takes heat at its own temperature", qs, qe, 1e-9, "heat flows on the difference between the two fluids' own temperatures",
    {note:"shell " + Tb.toFixed(2) + " K against saturation " + ST.sgTBy[b].toFixed(2) + " K"});
  const ks2 = G.eSgQ.toString(), from2 = "tOfHA(eNodeSat(bn), nt); Ts = nt[MX_T];";
  if(!ks2.includes(from2)) throw new Error("eSgQ: no " + from2);
  inBundle("eSgQ = " + ks2.replace(from2, "Ts = ST.sgTBy[b];").replace(/^function eSgQ/, "function"));
  const qt = law(); inBundle("eSgQ = " + ks2.replace(/^function eSgQ/, "function"));
  check("fault injected, the shell read at its saturation: the check above fails", Math.abs(qt/qe - 1) > 1e-9 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (qt/qe - 1).toFixed(4)});
}

/* three exchangers in series, the sandbox's netIhx3 built by its own builder, marched 25 s; "fault" runs it on the old unsigned take-up cap */
if(mode === "chain"){
  const fault = process.argv[3] === "fault", SECS = 25, DT = 0.02;
  if(fault){ const k = G.eTakeCapA.toString(), from = "E_SRC[4] = E_SRC[0] < 0 ? (v < 0 ? -v : 0) : (v > 0 ? v : 0);";
    if(!k.includes(from)) throw new Error("eTakeCapA: no " + from);
    inBundle("eTakeCapA = " + k.replace(from, "E_SRC[4] = m*Math.abs(hs - h)/dt + Math.abs(E_NIN[2]*hs - E_NIN[3]);").replace(/^function eTakeCapA/, "function")); }
  const clamps = sandboxRig("netIhx3");
  const ST = G.ST, SX = G.SX, PT = G.PT, sc = ST.sc, ng = PT.n.sg, bk = PT.nodeBooked, nc = PT.nodeCirc;
  const clampAll = () => { for(const [p, v] of clamps){ const i = p.indexOf(".");
    if(i < 0){ sc[G["SC_" + p.toUpperCase()]] = v; if(ST.csN) ST.csN.fill(v); continue; }
    ST[p.slice(0, i)][G.IX.node.get(p.slice(i + 1))] = v; } };
  const A = {ex:[-1e9, -1e9, -1e9], exT:[0, 0, 0], res:[0, 0, 0], enres:0, eff:0, n:0, clamped:0};
  const cOf = (k, s) => nc[s ? PT.stgA1[ng + k] : PT.stgA0[ng + k]], CS = [cOf(0, 1), cOf(1, 1), cOf(2, 1)];
  if(cOf(1, 0) !== CS[0] || cOf(2, 0) !== CS[1]) throw new Error("netIhx3: the relays are not the circuits between the stages");
  const U = c => { let u = 0; for(let i=0;i<PT.n.node;i++){ if(bk[i] || nc[i] !== c) continue;
      const m = ST.mBy[i], pa = ST.pAdv[i], p = pa === pa ? pa : G.eNodeP(i);
      if(m === m) u += m*ST.hBy[i] - p*PT.nodeVol[i]*1000;
      if(PT.nodeMetalKg[i] > 0) u += PT.nodeMetalKg[i]*G.E_CP_STEEL*ST.metalT[i]; } return u; };
  const bnd = c => { let x = 0; const fr = SX.tFrom;
    for(let e=0;e<PT.n.edge;e++){ const f = fr[e]; if(f < 0) continue; const to = f === PT.edU[e] ? PT.edV[e] : PT.edU[e], bf = bk[f] !== 0;
      if(bf === (bk[to] !== 0) || nc[bf ? to : f] !== c) continue;
      const kj = SX.tM[e]*DT*SX.tEH[e]; x += bf ? kj : -kj; } return x; };
  const outN = (j, w) => w >= 0 ? PT.stageFaceB[j] : PT.stageFaceA[j];
  /* the counterflow law re-derived here on the model's own T(h): midpoint steps from the cold end, q by bisection */
  const exact = k => { const st = ng + k, a = 2*st, b = a + 1, na = SX.stgN[a], nb = SX.stgN[b];
    const ca = G.eNodeSat(na), cb = G.eNodeSat(nb), pa = G.eNodeP(na), pb = G.eNodeP(nb), wa = SX.stgW[a], wb = SX.stgW[b], ha = ST.hBy[na], hb = ST.hBy[nb];
    const UA = PT.stageUA[st]*Math.pow(Math.min(SX.stgFl[a], SX.stgFl[b]), G.E_UA_FLOW);
    const req = q => { const N = 1000, dq = q/N; let u = 0;
      for(let i=0;i<N;i++){ const m = (i + 0.5)*dq, d = G.tOfH(ca, pa, ha - (q - m)/wa) - G.tOfH(cb, pb, hb + m/wb); if(!(d > 0)) return Infinity; u += dq/d; }
      return u; };
    let lo = 0, hi = 1; while(req(hi) < UA) hi *= 2;
    for(let i=0;i<50;i++){ const m = (lo + hi)/2; if(req(m) < UA) lo = m; else hi = m; }
    return (lo + hi)/2; };
  let u0 = null, q0 = null;
  watch(G, {cap:SECS, dt:DT, step:() => { clampAll(); u0 = CS.map(U); q0 = Array.from(ST.ihxQBy); G.step(DT); },
    event:() => fault && Math.max(...A.ex) > 0.01 ? "an outlet past the far inlet" : "", each:() => {
    if(sc[G.SC_ADVCLAMPED]) A.clamped++;
    A.enres = Math.max(A.enres, Math.abs(sc[G.SC_ENRES]));
    for(let c=0;c<3;c++){ const q = DT*(q0[c] - (c < 2 ? q0[c + 1] : 0));
      A.res[c] = Math.max(A.res[c], Math.abs(U(CS[c]) - u0[c] - bnd(CS[c]) - q)); }
    for(let k=0;k<3;k++){ if(!(Math.abs(ST.ihxQBy[k]) > 1)) continue;
      const st = ng + k, a = 2*st, b = a + 1, Ta = G.eNodeT(SX.stgN[a]), Tb = G.eNodeT(SX.stgN[b]), hot = Ta >= Tb;
      const oa = G.eNodeT(outN(a, G.eKeyW(PT.stageKey[a]))), ob = G.eNodeT(outN(b, G.eKeyW(PT.stageKey[b])));
      const e = hot ? Math.max(ob - Ta, Tb - oa) : Math.max(oa - Tb, Ta - ob);
      if(e > A.ex[k]){ A.ex[k] = e; A.exT[k] = sc[G.SC_T]; } }
    if(!fault && Math.round(sc[G.SC_T]*50) % 50 === 0) for(let k=0;k<3;k++){ G.eIhxQ(ng + k); const q = G.E_SQ[2], a = 2*(ng + k);
      if(!(q > 1) || SX.stgX[a] > 0 || SX.stgX[a + 1] > 0) continue;
      A.eff = Math.max(A.eff, Math.abs(q/exact(k) - 1)); A.n++; } }});
  const SL = "second law: a stream leaves an exchanger no hotter than the other stream's inlet, no colder than its own cold partner's";
  if(fault){
    check("fault injected, the old unsigned take-up cap: an outlet goes past the far inlet", Math.max(...A.ex) > 0.01 ? 1 : 0, 1, 0, "the second-law checks of chunk chain must be able to fail",
      {abs:true, note:"worst " + A.ex.map((e, k) => e.toFixed(3) + " K at " + A.exT[k].toFixed(2) + " s").join(", ")}); }
  else {
    for(let k=0;k<3;k++) check("stage " + (k + 1) + " of three in series, 25 s, every tick it passes heat: its outlets inside its two inlets", A.ex[k], 0, 0.01, SL,
      {abs:true, unit:"K", pass:A.ex[k] <= 0.01, note:"worst at " + A.exT[k].toFixed(2) + " s"});
    check("each stage's law against the counterflow integral typed here, every second, worst", A.eff, 0, 1e-4, TWO, {abs:true, note:A.n + " samples"});
    for(let c=0;c<3;c++) check("circuit " + ["L1", "L2", "tertiary"][c] + ": held energy moves by what crosses its boundaries and its stages, every tick, worst", A.res[c], 0, A.enres,
      "conservation of energy per circuit: dU = h flow in - out + q in - q out", {abs:true, unit:"kJ", note:"the engine's own worst |SC_ENRES| " + A.enres.toExponential(2) + " kJ; ticks with a clamp " + A.clamped}); }
}

/* superheated steam: the stock plant with a superheater drawn ahead of its generator (tools/sandbox/net.js netSh), 8 s */
if(mode === "sh"){
  const {R1, R2_0, R2_R, RW, tsat, if97r2} = require("./lib.js");
  const IFS = "IAPWS-IF97: s/R = tau g_tau - g (region 1), tau (g0_tau + gr_tau) - (g0 + gr) (region 2), typed here off the coefficients in lib.js";
  const s1 = (p, T) => { const pi = p/16.53, tau = 1386/T; let g = 0, gt = 0;
    for(const [I, J, n] of R1){ g += n*Math.pow(7.1 - pi, I)*Math.pow(tau - 1.222, J); gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1); }
    return RW*(tau*gt - g); };
  const s2 = (p, T) => { const tau = 540/T; let g0 = Math.log(p), g0t = 0, gr = 0, grt = 0;
    for(const [J, n] of R2_0){ g0 += n*Math.pow(tau, J); g0t += n*J*Math.pow(tau, J - 1); }
    for(const [I, J, n] of R2_R){ gr += n*Math.pow(p, I)*Math.pow(tau - 0.5, J); grt += n*Math.pow(p, I)*J*Math.pow(tau - 0.5, J - 1); }
    return RW*(tau*(g0t + grt) - g0 - gr); };
  check("region 1 and 2 entropy typed here against IF97's verification tables 5 and 15", Math.max(Math.abs(s1(3, 300)/0.392294792 - 1), Math.abs(s2(0.0035, 700)/10.1749996 - 1)), 0, 1e-8,
    "IAPWS R7-97(2012) tables 5 and 15", {abs:true});
  const T2 = (p, h) => { let lo = tsat(p), hi = 1073.15; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(if97r2(p, m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };
  const drop = (p, h, pc) => { const s = s2(p, T2(p, h)), Tc = tsat(pc), sf = s1(pc, Tc), hf = if97(pc, Tc).h;
    return 0.85*(h - hf - (s - sf)/(s2(pc, Tc) - sf)*(if97r2(pc, Tc).h - hf)); };

  sandboxRig("netSh"); watch(G, {cap:8});
  const ST = G.ST, SX = G.SX, PT = G.PT, sc = ST.sc, st = PT.n.sg, a = 2*st, b = a + 1, W = G.SAT_WATER, ex = G.IX.ihxId[0];
  const p = sc[G.SC_TURBP], h = sc[G.SC_TURBH], Tt = G.tOfH(W, p, h), Ts = G.satT(W, p);
  G.eIhxQ(st); const Thot = G.eNodeT(SX.stgN[a]);
  check("the steam at the turbine inlet is superheated, and colder than the superheater's hot inlet", Tt, Ts, 0, "second law bounds on a superheater: Ts(p) < T < T_hot,in",
    {unit:"K", pass:Tt > Ts && Tt < Thot, note:"Ts " + Ts.toFixed(2) + ", T " + Tt.toFixed(2) + ", hot inlet " + Thot.toFixed(2) + " K"});
  const wb = G.eKeyW(PT.stageKey[b]), ob = wb >= 0 ? PT.stageFaceB[b] : PT.stageFaceA[b], q = ST.ihxQBy[0];
  check("the superheater passes what its steam gains, w (h_out - h_in), at 8 s", Math.abs(wb)*(ST.hBy[ob] - ST.hBy[SX.stgN[b]]), q, 1e-3, "first law on the steam stream at quasi-steady state",
    {unit:"kW", note:"q " + (q/1000).toFixed(2) + " MW"});
  G.step(0.02);
  { const s = SX.tSrc, mq = SX.tMetQ, side = (i, j) => (s[i] - mq[i]) + (s[j] - mq[j]);
    const give = -side(PT.stgA0[st], PT.stgB0[st]), take = side(PT.stgA1[st], PT.stgB1[st]);
    check("the same tick: the primary loses what the steam gains", give - take, 0, 1e-12*Math.abs(give), "first law across the superheater", {abs:true, unit:"kW"}); }
  G.eCondPA(); const pc = G.E_CP[1], dEng = G.eTurbDh(p, pc, h), dIF = drop(p, h, pc);
  check("the turbine's drop per kg from its superheated inlet against IF97 by hand", dEng, dIF, 1e-3, "isentropic drop to the condenser x 0.85: " + IFS,
    {unit:"kJ/kg", note:"inlet " + p.toFixed(3) + " MPa, " + h.toFixed(1) + " kJ/kg, exhaust " + (pc*1000).toFixed(2) + " kPa"});
  const kt = G.eTurbDhA.toString(), from = "h = io[12] > 0 ? io[12] : hg;";
  if(!kt.includes(from)) throw new Error("eTurbDhA: no " + from);
  inBundle("eTurbDhA = " + kt.replace(from, "h = hg;").replace(/^function eTurbDhA/, "function"));
  const dSat = G.eTurbDh(p, pc, h); inBundle("eTurbDhA = " + kt.replace(/^function eTurbDhA/, "function"));
  check("fault injected, the turbine reading saturated vapour whatever its inlet: the check above fails", Math.abs(dSat/dIF - 1) > 1e-3 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"off by " + (dSat/dIF - 1).toFixed(4)});
  { const io = new Float64Array(8); io[0] = G.satT(W, p); io[1] = G.satT(W, pc); G.sLiqA(W, io, 0, 1, 2);
    const hs = G.hfgOf(W, io[0]), hc = G.hfgOf(W, io[1]), x = (io[2] + hs/io[0])/(hc/io[1]);
    check("a saturated inlet: the drop is the saturated-vapour expansion typed here", G.eTurbDh(p, pc, G.satHg(W, p)), 0.85*(G.hOfT(W, io[0]) - G.hOfT(W, io[1]) + hs - x*hc), 1e-9,
      "isentropic expansion of saturated vapour across the model's own liquid and latent heat", {unit:"kJ/kg"}); }
  const kindAt = () => { const M = G.pipeMap(); for(const k in M.byKey){ const c = M.byKey[k]; if((c.a === ex && c.sa === "b") || (c.b === ex && c.sb === "b")) return c.k; } return null; };
  const k0 = kindAt(), vap = PT.nodeVapour[G.IX.node.get(ex + "t")] && PT.nodeVapour[G.IX.node.get(ex + "b")];
  check("the run from the superheater's steam outlet to the turbine is a steam run, and the stream's own nodes are vapour", k0 === "steam" && vap ? 1 : 0, 1, 0,
    "a line is named by what flows in it: steam walked from the shell's steam nozzle through the exchanger", {abs:true, note:"kind " + k0 + ", vapour faces " + vap});
  const kr = G.runKindFor.toString(), rule = 'if((A.role==="ihx" && ihxSteamFace(A.id,af,seen)) || (B.role==="ihx" && ihxSteamFace(B.id,bf,seen))) return "steam";';
  if(!kr.includes(rule)) throw new Error("runKindFor: no ihx rule");
  inBundle("runKindFor = " + kr.replace(rule, "").replace(/^function runKindFor/, "function")); inBundle("pipeMapCache = null");
  const kf = kindAt(); inBundle("runKindFor = " + kr.replace(/^function runKindFor/, "function")); inBundle("pipeMapCache = null");
  check("fault injected, the old naming with no walk through an exchanger: the check above fails", kf !== "steam" ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"kind " + kf});
  /* Calder Hall's gas against its H.P. steam, on the law alone: CO2 at 336 C and saturated steam at 210 psia */
  const CO2 = G.COOLANT.find(r => r.id === "CO2"), cg = G.satCurveFor(CO2, CO2.P0), H = G.HX, S = G.HX_S, ps = 1.448;
  H[0] = CO2.P0; G.hxLineA(cg, 0); H[9] = 100; H[10] = G.hOfTP(cg, 609.15, CO2.P0);
  H[S] = ps; G.hxLineA(W, S); H[S+9] = 20; H[S+10] = G.satHg(W, ps); H[G.HX_UA] = 100; G.hxLawA(cg, W);
  const Tso = G.tOfH(W, ps, H[G.HX_HO+1]), Tsp = G.satT(W, ps);
  check("CO2 at 336 C against Calder Hall's 1.448 MPa steam: the superheater lifts the steam over saturation, under the gas inlet", Tso, Tsp, 0,
    "second law bounds; the sheet's 313 C, 116 K over saturation, is a record beside it (Nuclear Engineering, Dec. 1956)",
    {unit:"K", pass:Tso > Tsp && Tso < 609.15, note:"steam out " + (Tso - Tsp).toFixed(1) + " K over saturation at UA 100 kW/K, gas 100 kg/s, steam 20 kg/s"});
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
  commissionPreset(0); watch(G, {cap:1});
  const ST = G.ST, sc = ST.sc, fl = Math.max(sc[G.SC_FLOWNET]*ST.sgShare[0], 0.02);
  const q = vf => { sc[G.SC_VF] = vf; G.E_SQ[0] = fl; G.eSgQ(0); return G.E_SQ[2]; };
  const q0 = q(0), q5 = q(0.5);
  check("STOCK PWR's generator with its primary liquid: the same heat at a core void of 0 and 0.5", q5/q0 - 1, 0, 0, "a film is read off the stream it wets, not off the core", {abs:true, note:"film ratio " + G.E_FLM[3]});
  const ks = G.eSgQ.toString();
  inBundle("eSgQ = " + ks.replace("*fill/(", "*fill*(1 - 0.85*Math.min(ST.sc[SC_VF], 1))/(").replace(/^function eSgQ/, "function"));
  const f5 = q(0.5)/q(0) - 1; inBundle("eSgQ = " + ks.replace(/^function eSgQ/, "function"));
  check("fault injected, the film read off the core's void: the check above fails", f5 !== 0 ? 1 : 0, 1, 0, "the check above must be able to fail", {abs:true, note:"moves " + f5.toFixed(3)});
}
