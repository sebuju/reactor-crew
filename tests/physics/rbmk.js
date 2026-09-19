"use strict";
// chunks: rest off step stepoff stepdeep low boil coef graph scram
/* the RBMK-1000 preset flown against its own regulator: rods hold neutron power, the turbine holds the drum. rest = 60 s at the setpoint, off = the same with the rod sink off (the check seen to fail), step = a -10 % demand step, stepoff = the same with the governor off, stepdeep = a -20 % step with the governor off (the check seen to fail), low = the flight to 20 % and a disturbance with the rods frozen there and at 100 % */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset, coreInflow, coreShareHand} = require("./lib.js");
const mode = process.argv[2], resume = process.argv.includes("--resume");
const PRE = 5, WALL = 7000, t0 = Date.now();
if(mode === "boil" || mode === "coef") return statics();
if(mode === "graph") return graphite();
if(mode === "scram") return scram();
if(mode === "low") return flight();
const SECS = {rest:60, off:60, step:90, stepoff:300, stepdeep:300}[mode], STEPS = mode === "step" || mode === "stepoff" || mode === "stepdeep", STEP_AT = 10, STEP = mode === "stepdeep" ? 0.8 : 0.9;
const fBin = path.join(os.tmpdir(), "rc-phys-rbmk-" + mode + ".bin"), fJs = path.join(os.tmpdir(), "rc-phys-rbmk-" + mode + ".json");
const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[PRE][0];
const GAP = "RBMK-1000 power regulator";
const LIFT = Math.min(...Object.keys(G.D.fittings).filter(G.fitSpringD).map(f => G.reliefSetD(f).lift)), TRIP = G.rpsSetOf("plp", 0);
/* the regulator's setpoint: the CONST its power error is taken against */
const demId = () => Object.keys(G.D.blocks).find(id => { const b = G.D.blocks[id]; if(b.mode !== "math") return false;
  const a = G.D.blocks[b.in[0]], d = G.D.blocks[b.in[1]]; return a && a.sig === "nfr" && d && d.mode === "const"; });
/* the turbine governor's PID: the block the load demand sink integrates */
const gov = () => { const s = Object.keys(G.D.blocks).find(id => G.D.blocks[id].mode === "sink" && G.D.blocks[id].sink === "loadDem");
  return G.D.blocks[G.D.blocks[s].in[0]].in[0]; };
const drums = []; for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b]) drums.push(b);
/* kW the drums give up: steam out less the feed back past the heaters */
const removal = () => { let q = 0;
  for(const b of drums){ const i = PT.boilerNode[b], c = G.eNodeSat(i);
    q += ST.steamBy[b]*G.satHg(c, G.eBoilerP(b)) - ST.sgFedBy[b]*ST.hBy[PT.boilerFeed[b]]; }
  return q; };
let A;
if(resume && fs.existsSync(fBin)){ G.engRestore(new Uint8Array(fs.readFileSync(fBin))); A = JSON.parse(fs.readFileSync(fJs, "utf8")); }
else { sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); if(mode === "off") G.uiBlkSinkOff("rodStep");
  A = {dn:0, dp:0, p0:drums.map(b => G.eBoilerP(b)), stepped:false, settle:null, last:0, over:0, tail:0, lo:1e9, hi:-1e9, pLo:1e9, pHi:-1e9, pt:[]}; }
while(sc[G.SC_T] < SECS - 1e-9 && Date.now() - t0 < WALL && !A.out){
  if(STEPS && !A.stepped && sc[G.SC_T] >= STEP_AT - 1e-9){
    const d = G.D.blocks[demId()].in[1];
    G.act("blkKnob", G.IX.block.get(d), G.E_KN_NAMES.indexOf("v"), STEP); A.stepped = true;
    if(mode === "stepoff" || mode === "stepdeep") G.uiBlkSinkOff("loadDem"); }
  G.step(0.02);
  const dem = STEPS && A.stepped ? STEP : 1, e = Math.abs(sc[G.SC_N] - dem);
  if(!STEPS || !A.stepped) A.dn = Math.max(A.dn, e);
  else { if(e > 0.01*dem) A.last = sc[G.SC_T]; A.over = Math.max(A.over, dem - sc[G.SC_N]);
    if(sc[G.SC_T] > SECS - 20){ A.tail = Math.max(A.tail, e); A.lo = Math.min(A.lo, sc[G.SC_N]); A.hi = Math.max(A.hi, sc[G.SC_N]); } }
  drums.forEach((b, k) => { const p = G.eBoilerP(b); A.dp = Math.max(A.dp, Math.abs(p/A.p0[k] - 1)); A.pLo = Math.min(A.pLo, p); A.pHi = Math.max(A.pHi, p); });
  if(Math.abs(sc[G.SC_T]/10 - Math.round(sc[G.SC_T]/10)) < 1e-6) A.pt.push(G.eBoilerP(drums[0]));
  if(mode === "stepdeep" && !(A.pHi < LIFT && A.pLo > TRIP)) A.out = sc[G.SC_T]; }
if(sc[G.SC_T] < SECS - 1e-9 && !A.out){
  fs.writeFileSync(fBin, Buffer.from(G.engSnap(G.engSnapNew()))); fs.writeFileSync(fJs, JSON.stringify(A));
  process.stdout.write("@@MORE\n"); process.exit(0); }
for(const f of [fBin, fJs]) if(fs.existsSync(f)) fs.unlinkSync(f);

const heat = sc[G.SC_HEAT]*G.P.rated*1000;
if(mode === "rest"){
  check(name + ": regulator holds neutron power on its setpoint over 60 s, worst", A.dn, 0, 1e-3,
    "a rod regulator on the chambers holds the power it is set to (INSAG-7 annex II: the RCPS automatically maintains the preset power level)", {abs:true, unit:"of rated", gap:GAP});
  check(name + ": drum pressure over 60 s, worst off commissioned", A.dp, 0, 1e-2,
    "the turbine governor holds the drum at its setpoint", {abs:true, unit:"of commissioned"});
  check(name + ": core heat against steam out less feed in, at 60 s", heat/removal(), 1, 1e-2,
    "first law on the drum-and-core circuit at steady state", {note:"core " + (heat/1000).toFixed(0) + " MW"});
}
if(mode === "off")
  check(name + ": fault injected, rod sink off: the power hold fails", A.dn > 1e-3 ? 1 : 0, 1, 0,
    "the regulator check above must be able to fail", {abs:true, note:"worst " + A.dn.toExponential(2) + " of rated"});
if(mode === "step"){
  check(name + ": -10 % demand step, power within 1 % of the new setpoint over the last 20 s", A.tail, 0, 0.01*STEP,
    "a regulator settles on its new setpoint; the real AR holds power, no published step response exists to pin, so the check is that it settles", {abs:true, unit:"of rated", gap:GAP,
      note:"last outside 1 %: " + A.last.toFixed(1) + " s, worst undershoot " + A.over.toFixed(3)});
  check(name + ": -10 % demand step, power swing over the last 20 s, peak to peak", A.hi - A.lo, 0, 0.01,
    "a settled regulator holds still: no sustained oscillation", {abs:true, unit:"of rated", gap:GAP,
      note:A.lo.toFixed(4) + " .. " + A.hi.toFixed(4)});
}
if(STEPS){
  const PSRC = "no published RBMK-1000 drum pressure band found; the drawing's own protection: above the safety valve lift the drum dumps steam, below the low-pressure trip the plant stops";
  const drift = "drum at 10 s steps " + A.pt.map(p => p.toFixed(3)).join(" ") + " MPa";
  const held = A.pHi < LIFT && A.pLo > TRIP;
  if(mode === "step"){
    check(name + ": -10 % demand step, worst drum pressure under the safety valve lift", A.pHi, LIFT, 0, PSRC, {unit:"MPa", pass:A.pHi < LIFT, note:drift});
    check(name + ": -10 % demand step, worst drum pressure over the low-pressure trip", A.pLo, TRIP, 0, PSRC, {unit:"MPa", pass:A.pLo > TRIP});
  }
  const band = A.pLo.toFixed(3) + " .. " + A.pHi.toFixed(3) + " MPa against " + TRIP.toFixed(3) + " .. " + LIFT.toFixed(3) + "; " + drift;
  if(mode === "stepdeep") check(name + ": fault injected, governor off and a -20 % step: the drum leaves its limits", held ? 0 : 1, 1, 0,
    "the drum pressure checks above must be able to fail; a fixed turbine valve passes steam in proportion to pressure, so the drum falls about as far as the power", {abs:true, note:(A.out ? "out at " + A.out.toFixed(1) + " s, " : "") + band});
  if(mode === "stepoff"){
    /* three points 100 s apart after the rods have settled: p(t) = p_inf + a exp(-t/tau) gives tau = 100/ln(d1/d2) */
    const d1 = A.pt[3] - A.pt[13], d2 = A.pt[13] - A.pt[23], tau = 100/Math.log(d1/d2), ti = G.D.blocks[gov()].ti;
    check(name + ": governor off after the step, the drum's own drift is slower than the governor's integral time", tau, ti, 0,
      "a governor holds a drift only if it integrates faster than the drift runs; tau fitted exp on 30, 130, 230 s", {unit:"s", pass:tau > ti,
        note:"governor Ti " + ti + " s, drift heads for " + (A.pt[23] - d2*d2/(d1 - d2)).toFixed(2) + " MPa; " + band});
  }
}

/* the core's own rest pass off the commissioned plant: flow and drum held, the inlet subcooling following the feed, h_in = h_f - (h_f - h_in,0) P, as it does at constant flow and pressure */
function statics(){
  const {TofH} = require("./lib.js");
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, SX = G.SX, name = G.PLANTPRE[PRE][0], c = 0;
  const snap = G.engSnap(G.engSnapNew()), sat = G.eNodeSat(PT.coreNode[c]), pc = ST.csPCore[c], hfC = G.satH(sat, pc);
  const rest = (heat, noVoid) => { G.engRestore(snap); const h0 = ST.coreInH[c], aV = PT.coreAV[c];
    ST.csHeat[c] = heat; ST.coreInH[c] = hfC - (hfC - h0)*heat; if(noVoid) PT.coreAV[c] = 0;
    for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
      for(let k=0;k<G.XNN;k++){ ST.csNV[c*G.XNN+k] = ST.csNVt[c*G.XNN+k]; ST.csNTc[c*G.XNN+k] = ST.csNTct[c*G.XNN+k]; } }
    PT.coreAV[c] = aV;
    const o = SX.coreO;
    return {vd:o[G.E_CO_VD], dop:o[G.E_CO_DOP], mod:o[G.E_CO_MOD] + o[G.E_CO_EXP], gr:o[G.E_CO_GR], v:ST.csVNode[c], hin:ST.coreInH[c]}; };
  if(mode === "boil"){
    const pd = G.eBoilerP(0), hf = G.satH(sat, pd), hfg = G.satHg(sat, pd) - hf;
    const Q = G.eCoreQWater(c), {w, hIn, hOut} = coreInflow(G, c);
    const xLaw = (Q/w - (hf - hIn))/hfg, xOut = h => (h - hf)/hfg;
    check(name + ": channel exit quality against the first law", xOut(hOut), xLaw, 1e-3,
      "first law on the channels: x_exit = (Q/w - (h_f - h_in))/h_fg at drum pressure", {abs:true,
        note:"x " + xLaw.toFixed(4) + " (RBMK-1000 ~0.145, INSAG-7); core-average void " + ST.csVNode[c].toFixed(3) +
          " (the core's own drift-flux, C0 " + G.XC0 + ", at 14.5 K and x 0.145 with uniform heating gives 0.328)"});
    check(name + ": fault injected, exit enthalpy 1 % high: the exit quality check fails", Math.abs(xOut(hOut*1.01) - xLaw) > 1e-3 ? 1 : 0, 1, 0,
      "the exit quality check above must be able to fail", {abs:true});
    const r = rest(0.2), sub = G.satT(sat, pc) - TofH(pc, r.hin), x20 = (0.2*Q/w - (hfC - r.hin))/(G.satHg(sat, pc) - hfC);
    check(name + ": at 20 % power the channels still boil", r.v > 0 ? 1 : 0, 1, 0,
      "INSAG-7: at 200 MW the core boils, and the power coefficient is set by the void", {abs:true,
        note:"core void " + r.v.toFixed(3) + ", inlet subcooling " + sub.toFixed(1) + " K, exit quality " + x20.toFixed(3)});
    return; }
  const coef = (P, noVoid) => { const lo = rest(P - 0.005, noVoid), hi = rest(P + 0.005, noVoid), d = k => hi[k] - lo[k];
    return {tot:d("vd") + d("dop") + d("mod"), vd:d("vd"), dop:d("dop"), mod:d("mod"), gr:d("gr")}; };
  const tau = PT.coreGraphKg[c]*G.graphCp(PT.coreTgRef[c])/Math.max(PT.coreGUA[c], 1e-9);
  /* the stack is not in the fast figure: settled it is gr, and in the first 2 s it has moved 1 - exp(-2/tau) of that */
  const parts = k => "void " + k.vd.toFixed(2) + ", Doppler " + k.dop.toFixed(2) + ", moderator " + k.mod.toFixed(2) + " pcm/%; graphite settled " + k.gr.toFixed(2) +
    ", after 2 s " + (k.gr*(1 - Math.exp(-2/tau))).toFixed(3) + " pcm/% (tau " + tau.toFixed(0) + " s)";
  const k100 = coef(1), k20 = coef(0.2), k20v = coef(0.2, true);
  const SRC = "INSAG-7 annex I-3: measured above 50 % power from -4e-4 to +0.6e-4 beta_eff/MW (the latter only at a void coefficient of +5 beta_eff); negative at the design working point, positive at low power";
  check(name + ": static fast power coefficient at 100 %, flow and drum held", k100.tot, 0, 0, SRC,
    {unit:"pcm/%", pass:k100.tot < 0, gap:"RBMK stability", note:parts(k100)});
  check(name + ": static fast power coefficient at 20 %, flow and drum held", k20.tot, 0, 0, SRC,
    {unit:"pcm/%", pass:k20.tot > 0, note:parts(k20)});
  check(name + ": fault injected, void coefficient zeroed: the 20 % sign check fails", k20v.tot > 0 ? 0 : 1, 1, 0,
    "the sign check above must be able to fail", {abs:true, note:parts(k20v)});
}

/* the stack pushed 5 K under its own rest and let go: its energy against what crossed it, and its relaxation against 1 - exp(-t/tau) at tau/10 */
function graphite(){
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[PRE][0], c = 0, XNN = G.XNN, W = G.nodeW, nb = c*XNN;
  const H = T => 4.184*(0.54212*T - 1.213335e-6*T*T - 90.2725*Math.log(T) + 43449.3/T - 7.96545e6/(T*T) + 4.7896e8/(T*T*T));
  const kg = PT.coreGraphKg[c], ua = PT.coreGUA[c], rk = PT.coreRated[c]*1000;
  /* share of rated per unit node weight the blocks stop at node k */
  const qB = k => { const s = coreShareHand(G, c, ST.csNV[nb+k], ST.csNCov[nb+k]), hd = ST.csDecay[c]; return ST.csPhi[nb+k]*((ST.csHeat[c] - hd)*s.bp + hd*s.bd); };
  sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram");
  const eq = [], T0 = [];
  let Tm = 0; for(let k=0;k<XNN;k++){ eq.push(ST.csNTg[nb+k]); ST.csNTg[nb+k] -= 5; T0.push(ST.csNTg[nb+k]); Tm += W[k]*T0[k]; }
  /* its reactivity reference moves with it, so the push is not also a step in the core's power */
  PT.coreTgRef[c] -= 5;
  const tau = kg*G.graphCp(Tm)/ua, secs = tau/10;
  let flow = 0, t = 0;
  const inOf = () => { let p = 0; for(let k=0;k<XNN;k++) p += W[k]*qB(k); return p*rk; };
  /* the lag solved exactly, step by step, on the drivers the blocks saw: the power and water the plant moved on the way are the law's own inputs */
  const law = T0.slice();
  while(t < secs - 1e-9){
    const h0 = inOf();
    for(let k=0;k<XNN;k++){ const teq = ST.csNTc[nb+k] + qB(k)*rk/ua;
      law[k] = teq + (law[k] - teq)*Math.exp(-0.02*ua/(kg*G.graphCp(law[k]))); }
    G.step(0.02); t += 0.02;
    const h1 = inOf();
    flow += ((h0 + h1)/2 - ST.csGQ[c])*0.02; }
  let dU = 0, got = 0, want = 0;
  for(let k=0;k<XNN;k++){ const T = ST.csNTg[nb+k];
    dU += kg*W[k]*(H(T) - H(T0[k])); got += W[k]*(T - T0[k]); want += W[k]*(law[k] - T0[k]); }
  const worst = got/want - 1;
  const P = sc[G.SC_HEAT]*G.P.rated*1000;
  check(name + ": the stack's energy against what crossed it, over tau/10", (dU - flow)/(P*secs), 0, 1e-6,
    "first law on the graphite: m int cp dT = int (in - out) dt, cp(T) Butland & Maddison", {abs:true, unit:"of the core's heat",
      note:"dU " + (dU/1000).toFixed(1) + " MJ over " + secs.toFixed(1) + " s"});
  check(name + ": the stack relaxes 1 - exp(-t/tau) at t = tau/10", worst, 0, 0.01,
    "a first-order lag m cp dT/dt = in - UA (T - T_water): tau = m cp(T)/UA per node", {abs:true, unit:"of the law", note:"tau " + tau.toFixed(0) + " s = " + (tau/3600).toFixed(3) +
      " h, m " + (kg/1000).toFixed(1) + " t, UA " + ua.toFixed(1) + " kW/K (RBMK-1000: 1700 t, ~1.7 kJ/kg/K, 176 MW over ~444 K: ~2 h)"});
}

/* the bank dropped from fully withdrawn at the scram's own rate, quasi-static on the core's rest pass: what the rods and their followers are worth each moment on the flux they leave */
function scram(){
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, SX = G.SX, name = G.PLANTPRE[PRE][0], c = 0, XNZ = G.XNZ, XNN = G.XNN, nb = c*XNN;
  const d = G.derived(), rate = d.scram, bb = c*PT.nbMax, NB = PT.coreNB[c], dt = 0.1;
  const snap = G.engSnap(G.engSnapNew());
  /* a xenon tilt is the model's own way to lean the flux: more at the top pushes the power down, more at the bottom pushes it up */
  const run = (tilt, tipRho) => { G.engRestore(snap); const tr = PT.coreTipRho[c]; PT.coreTipRho[c] = tipRho;
    for(let k=0;k<XNN;k++) ST.csXX[nb+k] *= 1 + tilt*((k % XNZ) - (XNZ - 1)/2)/((XNZ - 1)/2);
    const at = ins => { for(let b=0;b<NB;b++) ST.csRodZ[bb+b] = ins;
      for(let r=0;r<30;r++) G.eCoreRestStep(c, ST.csFlowNet[c]);
      return SX.coreO[G.E_CO_ROD] + SX.coreO[G.E_CO_TIP]; };
    const r0 = at(0), ao = ST.csAo[c], out = [];
    for(let t=dt;t<=6 + 1e-9;t+=dt) out.push(at(rate*t) - r0);
    PT.coreTipRho[c] = tr;
    return {ao, max:Math.max(...out.slice(0, Math.round(3.125/dt))), out}; };
  const tip = PT.coreTipRho[c], lo = run(0.95, tip), hi = run(-0.95, tip), wat = run(0.95, 0);
  /* the follower's bottom leaves the core bottom's water when it has travelled the gap: the first moment the bank's bottom node is wholly graphite */
  let tFill = null;
  { G.engRestore(snap); const ring = Math.round(PT.coreBankR[bb]), k0 = nb + ring*XNZ;
    for(let t=0;t<=6 + 1e-9 && tFill === null;t+=0.01){ for(let b=0;b<NB;b++) ST.csRodZ[bb+b] = rate*t; G.eRodShape(c);
      const f = ST.csNFol[k0], fNext = (() => { for(let b=0;b<NB;b++) ST.csRodZ[bb+b] = rate*(t + 0.01); G.eRodShape(c); return ST.csNFol[k0]; })();
      if(f > 0 && Math.abs(fNext - f) < 1e-12 && f === Math.max(f, fNext)) tFill = t; } }
  check(name + ": scram stroke, full insertion at the drive's own rate", 1/rate, 7/0.4, 1e-9,
    "0.4 m/s over a 7 m core (INSAG-7 annex I: 'inserted into the core at a speed of 0.4 m/s'; 18-21 s stated for the full stroke)", {unit:"s"});
  check(name + ": rod drive stroke in normal operation, full travel at the regulator's own rate", 1/PT.coreRodRate[c], 7/0.4, 1e-9,
    "INSAG-7 annex I: every RCPS rod runs at 0.4 m/s in normal operation, the same servo as the scram", {unit:"s"});
  check(name + ": scram rate against the normal drive rate, one servo", rate, PT.coreRodRate[c], 1e-9,
    "INSAG-7 annex I: the scram drives the same rods by the same servos at the same 0.4 m/s", {unit:"of travel/s"});
  check(name + ": the follower fills the bottom water column after 1.25 m of travel", tFill, 1.25/0.4, 0.02,
    "INSAG-7: 1.25 m of water under the displacer at full withdrawal, driven at 0.4 m/s", {abs:true, unit:"s"});
  check(name + ": scram from full withdrawal on a bottom-peaked flux: rods and followers add reactivity first", lo.max, 0, 0,
    "INSAG-7: the displacers drive the water out of the bottom of the channels first, a local insertion of positive reactivity in the lower core; its size depends on the power shape",
    {unit:"pcm", pass:lo.max > 0, note:"axial offset " + lo.ao.toFixed(2) + ", peak +" + lo.max.toFixed(1) + " pcm (" + (lo.max/(PT.coreBETA[c]*1e5)).toFixed(3) + " beta) in the first 3.1 s; no published magnitude found in INSAG-7"});
  check(name + ": the same scram on a top-peaked flux adds less", hi.max, lo.max, 0,
    "the same: the effect lives in the lower core, so a flux leaning up weights it less", {unit:"pcm", pass:hi.max < lo.max, note:"axial offset " + hi.ao.toFixed(2) + ", peak " + hi.max.toFixed(1) + " pcm"});
  check(name + ": fault injected, a water follower: the bottom-peaked scram adds nothing", wat.max > 0 ? 0 : 1, 1, 0,
    "the positive-scram check above must be able to fail", {abs:true, note:"peak " + wat.max.toFixed(1) + " pcm"});
}

/* 100 % and 20 % with the rods frozen: a 1e-4 kick to n and its precursors, flown beside the same state unkicked; the growth is ln(d(20 s)/d(5 s))/15 s on their difference */
function flight(){
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[PRE][0], c = 0, aV = PT.coreAV[c];
  const fx = s => path.join(os.tmpdir(), "rc-phys-rbmk-low-" + s), fBin = fx("run.bin"), fJs = fx("run.json");
  const RUN = 20, T1 = 5, KICK = 1e-4, LOW = 0.2, HOLD = 60, STUCK = 300, ROW = "RBMK stability";
  const demBlk = () => { const id = Object.keys(G.D.blocks).find(id => { const b = G.D.blocks[id]; if(b.mode !== "math") return false;
    const a = G.D.blocks[b.in[0]], d = G.D.blocks[b.in[1]]; return a && a.sig === "nfr" && d && d.mode === "const"; });
    return G.IX.block.get(G.D.blocks[id].in[1]); };
  const save = f => fs.writeFileSync(f, Buffer.from(G.engSnap(G.engSnapNew())));
  const load = f => G.engRestore(new Uint8Array(fs.readFileSync(f)));
  let A;
  const enter = ph => { A.ph = ph; A.ph0 = sc[G.SC_T]; A.tr[ph] = [];
    PT.coreAV[c] = ph === "b0" || ph === "k0" ? 0 : aV;
    if(ph[0] === "b") load(fx(ph === "b100" ? "f100.bin" : "f20.bin"));
    if(ph[0] === "k"){ load(fx(ph === "k100" ? "f100.bin" : "f20.bin")); ST.csN[c] *= 1 + KICK; for(let g=0;g<6;g++) ST.csC[c*6+g] *= 1 + KICK; }
    A.ph0 = sc[G.SC_T]; };
  const freeze = f => { G.uiBlkSinkOff("rodStep"); save(fx(f)); };
  if(resume && fs.existsSync(fBin)){ load(fBin); A = JSON.parse(fs.readFileSync(fJs, "utf8")); PT.coreAV[c] = A.ph === "b0" || A.ph === "k0" ? 0 : aV; }
  else { sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); save(fx("c.bin")); freeze("f100.bin");
    A = {ph:null, ph0:0, tr:{}, dem:1, t1:0, steps:[], fail:null, xe0:null, vd0:null}; enter("b100"); }
  const NEXT = {b100:"k100", k100:"fly", b20:"k20", k20:"b0", b0:"k0", k0:"end"};
  while(A.ph !== "end" && Date.now() - t0 < WALL){
    G.step(0.02);
    const t = sc[G.SC_T] - A.ph0, n = sc[G.SC_N];
    if(A.ph === "fly" || A.ph === "hold"){ if(A.xe0 === null){ A.xe0 = ST.csParts[c*G.RP_N+G.RP_XE]; A.vd0 = ST.csParts[c*G.RP_N+G.RP_VD]; }
      if(ST.csTrip[c] !== 0){ A.fail = "tripped at demand " + A.dem.toFixed(1) + ", code " + ST.csTrip[c]; A.ph = "end"; break; }
      if(A.ph === "hold"){ if(t < HOLD) continue;
        if(Math.abs(n - LOW) > 0.01*LOW){ const pb = c*G.RP_N;
          A.fail = "held " + HOLD + " s at demand " + LOW + ": n " + n.toFixed(4) + ", rods at " + ST.csRodPos[c].toFixed(3) + " (regulator floor " + sc[G.SC_ARLO].toFixed(2) +
            "), xenon " + ST.csParts[pb+G.RP_XE].toFixed(0) + " pcm (" + A.xe0.toFixed(0) + " at 100 %), void " + ST.csParts[pb+G.RP_VD].toFixed(0) + " pcm (" + A.vd0.toFixed(0) + ")";
          A.ph = "end"; break; }
        freeze("f20.bin"); enter("b20"); continue; }
      if(Math.abs(n - A.dem) <= 0.01*A.dem){ A.steps.push([+A.dem.toFixed(1), +(sc[G.SC_T] - A.t1).toFixed(1)]);
        if(A.dem <= LOW + 1e-9){ A.ph = "hold"; A.ph0 = sc[G.SC_T]; continue; }
        A.dem = Math.round(A.dem*10 - 1)/10; G.act("blkKnob", demBlk(), G.E_KN_NAMES.indexOf("v"), A.dem); A.t1 = sc[G.SC_T]; }
      else if(sc[G.SC_T] - A.t1 > STUCK){ A.fail = "demand " + A.dem.toFixed(1) + " not reached in " + STUCK + " s, n " + n.toFixed(3); A.ph = "end"; break; }
      continue; }
    if(Math.abs(t*2 - Math.round(t*2)) < 1e-6) A.tr[A.ph].push(n);
    if(t >= RUN - 1e-9){ const nx = NEXT[A.ph];
      if(nx === "fly"){ load(fx("c.bin")); A.ph = "fly"; A.ph0 = A.t1 = sc[G.SC_T]; A.dem = Math.round(A.dem*10 - 1)/10;
        G.act("blkKnob", demBlk(), G.E_KN_NAMES.indexOf("v"), A.dem); }
      else if(nx === "end") A.ph = "end";
      else enter(nx); } }
  if(A.ph !== "end"){ save(fBin); fs.writeFileSync(fJs, JSON.stringify(A)); process.stdout.write("@@MORE\n"); process.exit(0); }
  for(const s of ["run.bin", "run.json", "c.bin", "f100.bin", "f20.bin"]) if(fs.existsSync(fx(s))) fs.unlinkSync(fx(s));
  const grow = k => { const b = A.tr["b" + k], q = A.tr["k" + k]; if(!b || !q) return null;
    const i1 = T1*2, i2 = b.length - 1, d1 = q[i1] - b[i1], d2 = q[i2] - b[i2];
    return {s:Math.log(Math.abs(d2/d1))/((i2 - i1)/2), flip:d1*d2 < 0}; };
  const txt = g => g ? (g.s > 0 ? "grows, e-folding " : "decays, e-folding ") + Math.abs(1/g.s).toFixed(2) + " s" + (g.flip ? ", sign flipped" : "") : "not measured";
  const g100 = grow(100), g20 = grow(20), g0 = grow(0);
  const route = A.steps.map(s => s[0] + "@" + s[1] + "s").join(" ");
  const SRC = "INSAG-7: with its protection defeated the RBMK-1000 is unstable at 20 % power (positive fast power coefficient) and stable at full power";
  check(name + ": the flight 100 % -> 20 % in -10 % steps on the regulator", A.fail ? 0 : 1, 1, 0,
    "INSAG-7: the unit was brought to 200 MW on its automatic regulator", {abs:true, gap:ROW, note:A.fail || route});
  check(name + ": rods frozen at 100 %, a 1e-4 disturbance decays", g100.s, 0, 0, SRC, {unit:"1/s", pass:g100.s < 0, gap:ROW, note:txt(g100)});
  if(A.fail) return;
  check(name + ": rods frozen at 20 %, a 1e-4 disturbance grows", g20.s, 0, 0, SRC, {unit:"1/s", pass:g20.s > 0, gap:ROW, note:txt(g20)});
  check(name + ": rods frozen at 100 %, a 1e-4 disturbance grows more slowly than at 20 % or decays", g100.s, g20.s, 0, SRC,
    {unit:"1/s", pass:g100.s < g20.s, gap:ROW, note:txt(g100)});
  check(name + ": fault injected, void coefficient zeroed at 20 %: the disturbance no longer grows", g0.s > 0 ? 0 : 1, 1, 0,
    "the growth check above must be able to fail", {abs:true, note:txt(g0)});
}
