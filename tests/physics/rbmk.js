"use strict";
// chunks: rest off step stepoff stepdeep low boil coef scram axial chan void
/* the RBMK-1000 preset flown against its own regulator: rods hold neutron power, the turbine holds the drum. rest = 60 s at the setpoint, off = the same with the rod sink off (the check seen to fail), step = a -10 % demand step, stepoff = the same with the governor off, stepdeep = a -20 % step with the governor off (the check seen to fail), low = the flight to 20 % and a disturbance with the rods frozen there and at 100 % */
const fs = require("fs"), os = require("os"), path = require("path");
const {check, commissionPreset, coreInflow, modProp, stackUA} = require("./lib.js");
const mode = process.argv[2], resume = process.argv.includes("--resume");
const PRE = 5, WALL = 7000, t0 = Date.now();
if(mode === "axial") return axial();
if(mode === "chan") return channels();
if(mode === "void") return voidSlope();
if(mode === "boil" || mode === "coef") return statics();
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
/* kW the pumps put into the same circuit: an adiabatic pump leaves all its shaft work in the water */
const pumpW = () => { let q = 0;
  for(let p=0;p<PT.n.pump;p++){ const e = PT.pumpEdge[p], su = PT.pumpSuc[p];
    if(e < 0 || su < 0 || !PT.pumpPrimary[p]) continue;
    const fwd = PT.edU[e] === su, di = fwd ? PT.edV[e] : PT.edU[e], f = fwd ? ST.edW[e] : -ST.edW[e];
    if(!(f > 0)) continue;
    q += f*(ST.pBy[di] - ST.pBy[su])*1000/(G.eNodeRho(su)*G.PUMP_ETA); }
  return q; };
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
  check(name + ": core heat and pump work against steam out less feed in, at 60 s", (heat + pumpW())/removal(), 1, 1e-2,
    "first law on the drum-and-core circuit at steady state", {note:"core " + (heat/1000).toFixed(0) + " MW, coolant pumps " + (pumpW()/1000).toFixed(1) + " MW"});
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

/* the core's own rest pass off the commissioned plant: flow and drum held, the inlet subcooling h_in = h_f - (h_f - h_in,0) P, as it settles at constant flow and pressure. A FAST coefficient holds that inlet at the operating point's own value, because the drum and the feed cannot follow inside a circuit transit. */
function statics(){
  const {TofH} = require("./lib.js");
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, SX = G.SX, name = G.PLANTPRE[PRE][0], c = 0;
  const snap = G.engSnap(G.engSnapNew()), sat = G.eNodeSat(PT.coreNode[c]), pc = ST.csPCore[c], hfC = G.satH(sat, pc);
  /* inP is the power the core inlet is set for: a fast coefficient is read about an operating point the drum and the feed cannot follow away from */
  const rest = (heat, noVoid, inP) => { G.engRestore(snap); const h0 = ST.coreInH[c], aV = PT.coreAV[c];
    ST.csHeat[c] = heat; ST.coreInH[c] = hfC - (hfC - h0)*(inP === undefined ? heat : inP); if(noVoid) PT.coreAV[c] = 0;
    for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
      for(let k=0;k<G.XNN;k++){ ST.csNV[c*G.XNN+k] = ST.csNVt[c*G.XNN+k]; ST.csNTc[c*G.XNN+k] = ST.csNTct[c*G.XNN+k]; } }
    PT.coreAV[c] = aV;
    const o = SX.coreO;
    return {vd:o[G.E_CO_VD], dop:o[G.E_CO_DOP], mod:o[G.E_CO_MOD] + o[G.E_CO_EXP], gr:o[G.E_CO_GR], v:ST.csVNode[c], hin:ST.coreInH[c]}; };
  if(mode === "boil"){
    const {if97, tsat} = require("./lib.js");
    const pd = G.eBoilerP(0), hf = G.satH(sat, pd), hfg = G.satHg(sat, pd) - hf;
    const Q = G.eCoreQWater(c), {w, hIn, pIn, hOut} = coreInflow(G, c);
    G.eCoreAxialA(c, PT.coreFlowK[c]*G.SX.coreFN[c]);
    const pEx = G.E_AXP[G.XNZ-1], hfE = G.satH(sat, pEx);
    const xLaw = (Q/w - (hf - hIn))/hfg, xOut = h => (h - hf)/hfg;
    const hFeed = if97(pd, G.feedTOf()).h, hMix = h => hf - xLaw*(hf - h);
    check(name + ": core inlet subcooling below the drum's own saturation", tsat(pd) - TofH(pd, hIn), 14, 3,
      "RBMK-1000: feed at 438 K into a 6.9 MPa drum (T_sat 284.9 C) at exit quality 0.145 leaves the channels ~14 K subcooled, INSAG-7 annex I; IAPWS-IF97 (test side, lib.js)",
      {abs:true, unit:"K", note:"drum " + pd.toFixed(2) + " MPa, x " + xLaw.toFixed(4) + ", feed " + G.feedTOf() + " K"});
    /* the pumping is the only other term between the drum and the core inlet, and an adiabatic pump leaves all of it in the water */
    const hPump = h => hMix(h) + if97(pd, TofH(pd, hMix(h))).v*(pIn - pd)*1000/G.PUMP_ETA;
    check(name + ": core inlet enthalpy against the drum mixing statement and the pumping", hIn, hPump(hFeed), 1e-3,
      "first law from the drum to the core inlet: h_in = h_f - x (h_f - h_feed) + v (p_in - p_drum)/eta, the last term the shaft work a pump of hydraulic efficiency " +
        G.PUMP_ETA + " raising " + (pIn - pd).toFixed(2) + " MPa leaves in the water; feed at " + G.feedTOf() + " K; IAPWS-IF97 (test side, lib.js)",
      {unit:"kJ/kg", note:"mixing alone " + hMix(hFeed).toFixed(2) + " kJ/kg, measured rise over it " +
        (hIn - hMix(hFeed)).toFixed(2) + " kJ/kg against " + (hPump(hFeed) - hMix(hFeed)).toFixed(2) +
        " kJ/kg; the isentropic minimum is " + (if97(pd, TofH(pd, hMix(hFeed))).v*(pIn - pd)*1000).toFixed(2) + " kJ/kg"});
    check(name + ": fault injected, feed enthalpy 5 % high: the inlet check fails",
      Math.abs(hIn/hPump(hFeed*1.05) - 1) > 1e-3 ? 1 : 0, 1, 0, "the inlet check above must be able to fail", {abs:true});
    /* the same first law asked of the machines themselves, one pump at a time */
    { let q = 0, rise = 0, work = 0;
      for(let p=0;p<PT.n.pump;p++){ const e = PT.pumpEdge[p], su = PT.pumpSuc[p]; if(e < 0 || su < 0) continue;
        const fwd = PT.edU[e] === su, di = fwd ? PT.edV[e] : PT.edU[e], f = fwd ? ST.edW[e] : -ST.edW[e];
        if(!(f > 0) || PT.nodeCirc[di] !== PT.coreCirc[c]) continue;
        q += f; rise += f*(ST.hBy[di] - ST.hBy[su]);
        work += f*(ST.pBy[di] - ST.pBy[su])*1000/G.eNodeRho(su); }
      check(name + ": the coolant pumps leave their whole shaft work in the water", rise/q, work/q/G.PUMP_ETA, 1e-3,
        "first law on an adiabatic pump: w (h_out - h_in) = P_shaft, the isentropic minimum v (p_out - p_in) over the hydraulic efficiency " + G.PUMP_ETA,
        {unit:"kJ/kg", note:"isentropic minimum " + (work/q).toFixed(3) + " kJ/kg over " + q.toFixed(0) + " kg/s"}); }
    check(name + ": channel exit quality against the first law", xOut(hOut), xLaw, 1e-3,
      "first law on the channels: x_exit = (Q/w - (h_f - h_in))/h_fg at drum pressure, which is what INSAG-7's 0.145 is: the steam the drum separates over the circulation flow", {abs:true,
        note:"x " + xLaw.toFixed(4) + " (RBMK-1000 ~0.145, INSAG-7); at the top plane's own " + pEx.toFixed(3) + " MPa it is " +
          ((hOut - hfE)/(G.satHg(sat, pEx) - hfE)).toFixed(4) + ", and the rest flashes on the way down; core-average void " + ST.csVNode[c].toFixed(3) +
          " (the core's own drift-flux, C0 " + G.XC0 + ", at 14.5 K and x 0.145 with uniform heating gives 0.328)"});
    check(name + ": fault injected, exit enthalpy 1 % high: the exit quality check fails", Math.abs(xOut(hOut*1.01) - xLaw) > 1e-3 ? 1 : 0, 1, 0,
      "the exit quality check above must be able to fail", {abs:true});
    const r = rest(0.2), sub = G.satT(sat, pc) - TofH(pc, r.hin), x20 = (0.2*Q/w - (hfC - r.hin))/(G.satHg(sat, pc) - hfC);
    check(name + ": at 20 % power the channels still boil", r.v > 0 ? 1 : 0, 1, 0,
      "INSAG-7: at 200 MW the core boils, and the power coefficient is set by the void", {abs:true,
        note:"core void " + r.v.toFixed(3) + ", inlet subcooling " + sub.toFixed(1) + " K, exit quality " + x20.toFixed(3)});
    return; }
  /* the Doppler term's own driver: the pellet's volume-mean rise, solved on Fink's k(T) instead of the model's flat k */
  { const cD = G.priD(), Rp = G.rodDP(cD)/2, Ro = G.rodD(cD)/2, r = G.pinRes(cD);
    const L = G.latRods(cD)*cD.lat.len, qp = G.heatShares(cD).pin0*cD.power*1e6/L, A = qp/(4*Math.PI);
    const kF = T => { const t = T/1000; return 100/(7.5408 + 17.692*t + 3.6142*t*t) + 6400/Math.pow(t, 2.5)*Math.exp(-16.35/t); };
    const Rout = 1/(2*Math.PI*Rp*G.H_GAP) + Math.log(Ro/Rp)/(2*Math.PI*G.cladOf(cD).k) + r.film;
    const Ts = PT.coreTref[c] + qp*Rout;
    /* Theta(T) - Theta(Ts) = A(1 - r^2/R^2) at uniform heating, so the volume mean is the mean of T over that argument */
    let T = Ts, mean = 0; const N = 4000;
    for(let i=0;i<N;i++){ const Tm = T + A/kF(T)*(0.5/N); mean += Tm/N; T += A/kF(Tm)/N; }
    const pel = mean - Ts, dtf = qp*Rout + pel;
    check(name + ": average linear power against the real machine's channel", qp/1000, 14.2, 0.15,
      "RBMK-1000: 1661 channels of 18 rods at 7 m heated is 209 286 m of rod; 3200 MWt less the heat deposited outside the pin is about 14.2 kW/m",
      {unit:"kW/m", note:G.latRods(cD) + " rods at " + cD.lat.len.toFixed(2) + " m on " + cD.power.toFixed(0) + " MWt, pin share " + G.heatShares(cD).pin0.toFixed(3)});
    check(name + ": the pellet's volume-mean rise against the conduction solution", G.pinDTf(cD), dtf, 0.10,
      "steady conduction on the drawing's own pin with UO2 conductivity from Fink, J. Nucl. Mater. 279 (2000) eq. 20 at 95 % TD: int k dT = q'(1 - r^2/R^2)/(4 pi) through the pellet, then the gap at H_GAP, the clad and the film",
      {unit:"K",
        note:"pellet " + pel.toFixed(1) + " K over a surface at " + Ts.toFixed(0) + " K and a centre at " + T.toFixed(0) +
          " K (effective k " + (A/2/pel).toFixed(2) + " W/m/K), plus " + (qp*Rout).toFixed(1) +
          " K of gap, clad and film; the row's flat k " + G.fuelBlend(cD).k + " would give " + (qp*(Rout + 1/(8*Math.PI*G.fuelBlend(cD).k))).toFixed(1) + " K"});
    check(name + ": fault injected, the pellet on one flat conductivity: the pellet check fails",
      Math.abs(qp*(Rout + 1/(8*Math.PI*G.fuelBlend(cD).k))/dtf - 1) > 0.10 ? 1 : 0, 1, 0,
      "the pellet check above must be able to tell the conductivity integral from one flat k", {abs:true}); }
  const coef = (P, noVoid, fast) => { const i = fast ? P : undefined, lo = rest(P - 0.005, noVoid, i), hi = rest(P + 0.005, noVoid, i), d = k => hi[k] - lo[k];
    return {tot:d("vd") + d("dop") + d("mod"), vd:d("vd"), dop:d("dop"), mod:d("mod"), gr:d("gr")}; };
  const tau = PT.coreGraphKg[c]*modProp(G, c, PT.coreTgRef[c]).cp/Math.max(stackUA(G, c, PT.coreTgRef[c]), 1e-9);
  /* the stack is not in the fast figure: settled it is gr, and in the first 2 s it has moved 1 - exp(-2/tau) of that */
  const parts = k => "void " + k.vd.toFixed(2) + ", Doppler " + k.dop.toFixed(2) + ", moderator " + k.mod.toFixed(2) + " pcm/%; graphite settled " + k.gr.toFixed(2) +
    ", after 2 s " + (k.gr*(1 - Math.exp(-2/tau))).toFixed(3) + " pcm/% (tau " + tau.toFixed(0) + " s)" +
    "; d(void)/d(power) " + (k.vd/PT.coreAV[c]).toFixed(6) + " per % flux-weighted";
  const k100 = coef(1, false, true), k20 = coef(0.2, false, true), k20v = coef(0.2, true, true), s100 = coef(1);
  const SRC = "INSAG-7 annex I, verbatim: \"Measurements of the FAST power coefficient of reactivity, characterizing the change in reactor reactivity in response to a change in power, showed that when a_w increased from -(0.2-0.4) beta_eff to +5 beta_eff, a_N changed from -4 x 10^-4 beta_eff/MW(th) to +0.6 x 10^-4 beta_eff/MW(th). However, these data were valid only for power levels of more than 50% N_nom\". It is a MAPPING from the void coefficient to the power coefficient, not a band of scatter, so a drawing near +5 beta_eff is judged against the positive end and not against the whole width";
  /* The published band is dollars per MW MEASURED ON THE REAL MACHINE, so it is converted on the REAL machine's
     beta_eff and rating, never on this drawing's. Absolute pcm per % of rated is intensive for the same cell:
     a smaller core of the same design reads the same pcm per % of ITS own rating. */
  const BETA_R = 0.005, MW_R = 3200, k = BETA_R*1e5*MW_R/100, bLo = -4e-4*k, bHi = 0.6e-4*k;
  let bet = 0; for(let g=0;g<6;g++) bet += PT.coreBet[c*6+g];
  /* INSAG's two points read as a line in a_w, which is an ASSUMPTION and labelled one: the mapping crosses zero at +4.31 beta_eff */
  const aw = PT.coreAV[c]/1e5/BETA_R, aw0 = -0.3, sl = (0.6e-4 - -4e-4)/(5 - aw0), bAt = (-4e-4 + sl*(aw - aw0))*k, xz = aw0 + 4e-4/sl;
  check(name + ": fast power coefficient at 100 %, flow, drum and core inlet held", k100.tot, 0, 0, SRC,
    {unit:"pcm/%", pass:k100.tot < 0, gap:"RBMK stability",
     note:parts(k100) + "; INSAG 2.1, verbatim: \"the fast power coefficient remained negative under normal operating conditions. At the time of the accident, the void and power coefficients of reactivity were both positive\" - so the pass condition is the SIGN the source states, not a decimal. The mapping's own band is " +
       bLo.toFixed(2) + " to " + bHi.toFixed(2) + " pcm/% absolute, off the REAL machine's beta_eff " +
       BETA_R + " and " + MW_R + " MWt (this drawing carries beta " + (bet*1e5).toFixed(0) + " pcm at " + G.P.rated.toFixed(0) +
       " MWt). This drawing's void worth " + PT.coreAV[c].toFixed(0) + " pcm is +" + aw.toFixed(2) +
       " beta_eff on that same machine; taking INSAG's two points as a LINE in a_w (an assumption, not a published curve) puts a_N at " +
       bAt.toFixed(2) + " pcm/% here and the mapping's zero crossing at +" + xz.toFixed(2) +
       " beta_eff, so this drawing sits on the crossing and its honest magnitude target is 0, not the +5 beta_eff edge " + bHi.toFixed(2) +
       ". Letting the inlet subcooling follow the power, which takes a circuit transit: " +
       s100.tot.toFixed(2) + " pcm/% (" + parts(s100) + "), so the published value sits INSIDE the model's own two boundary conditions and the source states neither"});
  check(name + ": fast power coefficient at 20 %, flow, drum and core inlet held", k20.tot, 0, 0, SRC,
    {unit:"pcm/%", pass:k20.tot > 0, note:parts(k20)});
  check(name + ": fault injected, void coefficient zeroed: the 20 % sign check fails", k20v.tot > 0 ? 0 : 1, 1, 0,
    "the sign check above must be able to fail", {abs:true, note:parts(k20v)});
  /* where the coefficient crosses zero is the behaviour statement: the real machine ran away below about 20 % and was stable at full power */
  { const P = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2], y = P.map(p => coef(p, false, true).tot);
    let x = 0; for(let i=1;i<P.length;i++) if(y[i-1] > 0 !== y[i] > 0) x = P[i-1] + (P[i] - P[i-1])*y[i-1]/(y[i-1] - y[i]);
    check(name + ": the fast coefficient crosses zero between 20 % and 100 % of rated", x*100, 60, 0,
      "INSAG-7 2.1: the RBMK-1000's fast power coefficient \"remained negative under normal operating conditions\" and the machine was unstable at low power, so the sign changes somewhere between the two",
      {unit:"% of rated", pass:x >= 0.2 && x <= 1.0, gap:"RBMK stability",
       note:(x ? "crossing " + (x*100).toFixed(0) + " %" : "no crossing in 20-120 %") + "; " +
         P.map((p, i) => (p*100).toFixed(0) + " % " + y[i].toFixed(2)).join(", ") + " pcm/%"}); }
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
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, sc = ST.sc, name = G.PLANTPRE[PRE][0], c = 0, aV = PT.coreAV[c], kxe = PT.coreKXE[c];
  /* Xenon is stood down for the GROWTH phases only: on the compressed poison clock (row "xenon poisoning") its
     burnout is a feedback on a 20 s window, which measures the clock, not the reactor's own fast feedback. */
  const mech = ph => { PT.coreAV[c] = ph === "b0" || ph === "k0" ? aV*2 : aV;
    PT.coreKXE[c] = ph === "fly" || ph === "hold" ? kxe : 0; };
  const fx = s => path.join(os.tmpdir(), "rc-phys-rbmk-low-" + s), fBin = fx("run.bin"), fJs = fx("run.json");
  const RUN = 20, T1 = 5, KICK = 1e-4, LOW = 0.2, HOLD = 60, STUCK = 300, ROW = "RBMK stability";
  const demBlk = () => { const id = Object.keys(G.D.blocks).find(id => { const b = G.D.blocks[id]; if(b.mode !== "math") return false;
    const a = G.D.blocks[b.in[0]], d = G.D.blocks[b.in[1]]; return a && a.sig === "nfr" && d && d.mode === "const"; });
    return G.IX.block.get(G.D.blocks[id].in[1]); };
  const save = f => fs.writeFileSync(f, Buffer.from(G.engSnap(G.engSnapNew())));
  const load = f => G.engRestore(new Uint8Array(fs.readFileSync(f)));
  let A;
  const enter = ph => { A.ph = ph; A.ph0 = sc[G.SC_T]; A.tr[ph] = [];
    mech(ph);
    if(ph[0] === "b") load(fx(ph === "b20" ? "f20.bin" : "f100.bin"));
    if(ph[0] === "k"){ load(fx(ph === "k20" ? "f20.bin" : "f100.bin")); ST.csN[c] *= 1 + KICK; for(let g=0;g<6;g++) ST.csC[c*6+g] *= 1 + KICK; }
    A.ph0 = sc[G.SC_T]; };
  const freeze = f => { G.uiBlkSinkOff("rodStep"); save(fx(f)); };
  if(resume && fs.existsSync(fBin)){ load(fBin); A = JSON.parse(fs.readFileSync(fJs, "utf8")); mech(A.ph); }
  else { sc[G.SC_DICEOFF] = 1; G.uiBlkSinkOff("scram"); save(fx("c.bin")); freeze("f100.bin");
    A = {ph:null, ph0:0, tr:{}, dem:1, t1:0, steps:[], fail:null, xe0:null, vd0:null}; enter("b100"); }
  const NEXT = {b100:"k100", k100:"b0", b0:"k0", k0:"fly", b20:"k20", k20:"end"};
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
      if(nx === "fly"){ load(fx("c.bin")); A.ph = "fly"; mech("fly"); A.ph0 = A.t1 = sc[G.SC_T]; A.dem = Math.round(A.dem*10 - 1)/10;
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
  check(name + ": fault injected, void coefficient doubled at 100 %: the disturbance grows", g0.s > 0 ? 1 : 0, 1, 0,
    "the decay check above must be able to fail, and the mechanism it stands on is the void", {abs:true, note:txt(g0)});
  if(A.fail) return;
  check(name + ": rods frozen at 20 %, a 1e-4 disturbance grows", g20.s, 0, 0, SRC, {unit:"1/s", pass:g20.s > 0, gap:ROW, note:txt(g20)});
  check(name + ": rods frozen at 100 %, a 1e-4 disturbance grows more slowly than at 20 % or decays", g100.s, g20.s, 0, SRC,
    {unit:"1/s", pass:g100.s < g20.s, gap:ROW, note:txt(g100)});
}

/* the channel's axial pressure profile: the anchor, the hydrostatic limit, the friction term by hand, and the flashing it puts into the quality */
function axial(){
  const {if97, if97r2, tsat} = require("./lib.js");
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, name = G.PLANTPRE[PRE][0], c = 0;
  const XNZ = G.XNZ, XNN = G.XNN, nb = c*XNN, GRAV = 9.80665;
  const mflux = PT.coreFlowK[c]*G.SX.coreFN[c], Gm = PT.coreG0[c]*mflux;
  const pc = ST.csPCore[c], dz = Math.max(PT.coreCoreHgt[c], 0.05)/XNZ, L = dz*(XNZ - 1), dh = PT.coreDh[c], cp = PT.coreCp[c];
  const hf = p => if97(p, tsat(p)).h, hfgOf = p => if97r2(p, tsat(p)).h - hf(p);
  const flash = () => { G.eCoreAxialA(c, mflux);
    return cp*(G.E_AXS[0] - G.E_AXS[XNZ-1])/G.E_AXFG[XNZ-1]; };

  G.eCoreAxialA(c, mflux);
  let m = 0; for(let j=0;j<XNZ;j++) m += G.E_AXP[j]; m /= XNZ;
  check(name + ": the ten plane pressures average the core node's own solved pressure", m, pc, 1e-12,
    "conservation: an axial profile redistributes pressure inside the core and adds none", {unit:"MPa",
      note:"bottom " + G.E_AXP[0].toFixed(4) + " to top " + G.E_AXP[XNZ-1].toFixed(4) + " MPa, drop " +
        G.E_AX[0].toFixed(4) + " MPa over " + L.toFixed(2) + " m, of which friction " + G.E_AX[2].toFixed(4) +
        " MPa; the drawing states " + G.COOLANT[G.coreD(G.IX.coreId[c]).cool].dpCore + " MPa across the core"});

  const v0 = Float64Array.from(ST.csNV.subarray(nb, nb + XNN)), t0 = Float64Array.from(ST.csNTc.subarray(nb, nb + XNN));
  let Tu = 0; for(let k=0;k<XNN;k++) Tu += G.nodeW[k]*t0[k];
  for(let k=0;k<XNN;k++){ ST.csNV[nb+k] = 0; ST.csNTc[nb+k] = Tu; }
  const rf = 1/if97(pc, Math.min(tsat(pc), Tu)).v;

  G.eCoreAxialA(c, 0);
  check(name + ": flow stopped and the void flattened, the profile is the column's own weight", (G.E_AXP[0] - G.E_AXP[XNZ-1])*1e6, rf*GRAV*L, 3e-3,
    "hydrostatics: dp = rho g H over the nine plane spacings; rho_f at the core's own pressure and temperature from IAPWS-IF97 (test side, lib.js)",
    {unit:"Pa", note:"rho_f " + rf.toFixed(1) + " kg/m3, H " + L.toFixed(2) + " m"});

  G.eCoreAxialA(c, mflux);
  const re = G.E_AX[1], fD = Math.pow(1.82*Math.log10(re) - 1.64, -2);
  check(name + ": the friction share of the drop against the Darcy correlation by hand", G.E_AX[2]*1e6, fD*(L/dh)*Gm*Gm/(2*rf), 1e-2,
    "Filonenko/Petukhov f = (1.82 log10(Re) - 1.64)^-2 (smooth tube, Re above 1e5, the band Blasius is not stated for), dp = f (L/d_h) G^2 / (2 rho)",
    {unit:"Pa", note:"Re " + re.toExponential(3) + ", f " + fD.toFixed(5) + ", G " + Gm.toFixed(1) + " kg/m2/s, d_h " +
      (dh*1000).toFixed(2) + " mm; mu by Vogel's law, within 2.5 % of IAPWS 2008 over 273-640 K"});

  for(let k=0;k<XNN;k++){ ST.csNV[nb+k] = v0[k]; ST.csNTc[nb+k] = t0[k]; }
  const dx = flash(), pLo = G.E_AXP[0], pHi = G.E_AXP[XNZ-1];
  const dxT = (hf(pLo) - hf(pHi))/hfgOf(pHi);
  check(name + ": water saturated at the bottom plane is this much steam at the top with no heat added", dx, dxT, 0.08,
    "flashing: x = (h_f(p_in) - h_f(p_out))/h_fg(p_out), both ends on IAPWS-IF97 (test side, lib.js)",
    {note:"dp " + ((pLo - pHi)*1000).toFixed(1) + " kPa, model " + dx.toFixed(5) + " against " + dxT.toFixed(5) +
      " (" + (100*(dx/dxT - 1)).toFixed(1) + " %: the march carries h as c_p T, so its dh_f/dp is the row's secant c_p " +
      cp.toFixed(2) + " kJ/kg/K times dT_sat/dp); the channel's own exit quality is about 0.14, so flashing is " +
      (100*dx/0.14).toFixed(1) + " % of it"});

  const gas = PT.coreGas[c]; PT.coreGas[c] = 1;
  const dxFlat = flash(); PT.coreGas[c] = gas;
  check(name + ": fault injected, the profile stood down: the flashing check fails", Math.abs(dxFlat - dxT) > 0.08*dxT ? 1 : 0, 1, 0,
    "the flashing check above must be able to fail", {abs:true, note:"flat profile gives " + dxFlat.toFixed(6)});
}

/* the core's rest pass run to its own fixed point at the given heat, the inlet and the flow held */
function restPass(G, c, heat){
  const ST = G.ST, XNN = G.XNN, nb = c*XNN;
  ST.csHeat[c] = heat;
  for(let r=0;r<400;r++){ G.eCoreRestStep(c, ST.csFlowNet[c]);
    for(let k=0;k<XNN;k++){ ST.csNV[nb+k] = ST.csNVt[nb+k]; ST.csNTc[nb+k] = ST.csNTct[nb+k]; } }
}

/* the channel flow split: parallel channels hang between the same two plena, so every one of them takes the
   same drop. The drawing states that drop; only the heated length's friction inside it carries the two-phase
   multiplier, and the rest of it is the inlet throttle, which is single-phase. */
function channels(){
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, name = G.PLANTPRE[PRE][0], c = 0;
  const XNR = G.XNR, XNZ = G.XNZ, XNN = G.XNN, nb = c*XNN, rb = c*XNR, XC0 = G.XC0, ringW = G.ringW;
  const snap = G.engSnap(G.engSnapNew());
  const mflux = () => PT.coreFlowK[c]*ST.csFlowNet[c];
  /* the homogeneous two-phase multiplier of ring i, the quality read off its own void the way the law does */
  const phi2 = i => { const g = Math.max(mflux()*ST.csChW[rb+i], 1e-3);
    let x = 0;
    for(let j=0;j<XNZ;j++){ const rvl = G.E_AXRV[j], d = G.E_AXD[j]/g, a = Math.max(0, Math.min(1, ST.csNV[nb+i*XNZ+j]));
      const den = 1 - a*XC0*(1 - rvl), q = den > 1e-6 ? Math.max(0, Math.min(1, a*(XC0*rvl + d)/den)) : 1;
      x += q*(1/Math.max(rvl, 1e-6) - 1); }
    return 1 + x/XNZ; };
  /* what each channel's drop comes to on the momentum relation, over the drawing's own stated core drop */
  const drops = () => { const p = [], dpF = G.E_AX[2], dpT = Math.max(PT.coreDp[c] - dpF, 0);
    let b = 0; for(let i=0;i<XNR;i++){ p.push(phi2(i)); b += ringW[i]*p[i]; }
    const d = []; for(let i=0;i<XNR;i++) d.push((dpT + dpF*p[i]/b)*ST.csChW[rb+i]*ST.csChW[rb+i]);
    return {d, dpF, dpT}; };

  restPass(G, c, 1);
  let tot = 0, sw = 0;
  for(let i=0;i<XNR;i++){ tot += ringW[i]*ST.csChW[rb+i]; sw += ringW[i]; }
  check(name + ": the channel weights carry the whole core flow and no more", tot/sw, 1, 1e-12,
    "conservation: a split divides a flow, it does not create one", {abs:true});

  const D = drops(), dLo = Math.min(...D.d), dHi = Math.max(...D.d);
  const wLo = Math.min(...ST.csChW.subarray(rb, rb + XNR)), wHi = Math.max(...ST.csChW.subarray(rb, rb + XNR));
  check(name + ": every channel takes the same drop", dHi/dLo - 1, 0, 1e-12,
    "parallel channels hang between the same two plena: w = C sqrt(2 rho dp) on a single-phase throttle in series with a heated length whose friction carries the homogeneous multiplier phi^2 = 1 + x (rho_f/rho_g - 1)",
    {abs:true, unit:"of the drop", note:"stated core drop " + PT.coreDp[c].toFixed(3) + " MPa, of which the heated length's friction " +
      D.dpF.toFixed(4) + " and the throttle " + D.dpT.toFixed(4) + "; channel flow spread " + wLo.toFixed(3) + " .. " + wHi.toFixed(3) +
      " of the mean, ratio " + (wHi/wLo).toFixed(3)});

  ST.csChW[rb] *= 1.05;
  const F = drops(), fLo = Math.min(...F.d), fHi = Math.max(...F.d);
  check(name + ": fault injected, one channel's weight 5 % out: the equal-drop check fails", fHi/fLo - 1 > 1e-12 ? 1 : 0, 1, 0,
    "the equal-drop check above must be able to fail", {abs:true, note:"spread " + (fHi/fLo - 1).toExponential(2)});

  /* the void flattened: with nothing to tell the channels apart the split is flat, whatever the throttle is */
  G.engRestore(snap);
  for(let i=0;i<XNR;i++) ST.csChW[rb+i] = 1;
  for(let k=0;k<XNN;k++) ST.csNV[nb+k] = 0.3;
  G.eCoreRestStep(c, ST.csFlowNet[c]);
  let off = 0; for(let i=0;i<XNR;i++) off = Math.max(off, Math.abs(ST.csChW[rb+i]*sw - 1));
  check(name + ": at uniform void every channel carries the same flow", off, 0, 1e-12,
    "a weighting law that does not reduce to the flat case is wrong before anything else is measured", {abs:true});

  /* the throttle stood down: the whole channel resistance is the heated length again, and the spread comes back */
  G.engRestore(snap); PT.coreDp[c] = 0;
  restPass(G, c, 1);
  const bLo = Math.min(...ST.csChW.subarray(rb, rb + XNR)), bHi = Math.max(...ST.csChW.subarray(rb, rb + XNR));
  check(name + ": fault injected, the stated throttle zeroed: the channels spread on their own friction alone", bHi/bLo, 2, 0,
    "with no throttle the whole channel resistance is the heated length and w goes as 1/phi; the check is that the drawing's throttle is what holds the split together",
    {pass:bHi/bLo > 2, note:"spread " + bLo.toFixed(3) + " .. " + bHi.toFixed(3) + ", ratio " + (bHi/bLo).toFixed(3) +
      " against " + (wHi/wLo).toFixed(3) + " with the throttle in"});
}

/* d(void)/d(power) at a held core inlet against the published correlations worked test side on the same channel:
   Saha-Zuber departure, Levy's profile fit, Zuber-Findlay drift flux, properties from IAPWS-IF97 */
function voidSlope(){
  const {if97, if97r2, tsat} = require("./lib.js");
  const G = commissionPreset(PRE), PT = G.PT, ST = G.ST, name = G.PLANTPRE[PRE][0], c = 0;
  const XNR = G.XNR, XNZ = G.XNZ, XNN = G.XNN, nb = c*XNN, W = G.nodeW, XC0 = G.XC0, GRAV = 9.80665;
  const snap = G.engSnap(G.engSnapNew());
  const {w, hIn} = coreInflow(G, c);
  const Qw = G.eCoreQWater(c), pc = ST.csPCore[c], Gm = PT.coreG0[c], Ah = PT.coreAHeat[c];
  const pf = []; for(let j=0;j<XNZ;j++){ let a = 0; for(let i=0;i<XNR;i++){ const q = i*XNZ + j; a += W[q]*ST.csPhi[nb+q]; } pf.push(a); }
  const s1 = pf.reduce((a, b) => a + b, 0); for(let j=0;j<XNZ;j++) pf[j] /= s1;
  /* IAPWS-IF97 on the saturation line plus the IAPWS R1-76 surface tension */
  const sat = p => { const T = tsat(p), l = if97(p, T), v = if97r2(p, T), t = 1 - T/647.096;
    return {T, hf:l.h, hfg:v.h - l.h, rf:1/l.v, rg:1/v.v, cpf:l.cp, sig:0.2358*Math.pow(t, 1.256)*(1 - 0.625*t)}; };
  const anl = P => { const S = sat(pc); let cum = 0, s = 0;
    for(let j=0;j<XNZ;j++){
      const hm = hIn + (Qw*P/w)*(cum + pf[j]/2); cum += pf[j];
      const qpp = Qw*1000*P*pf[j]*XNZ/Ah;
      const xd = -154*qpp/(Gm*S.hfg*1000), xe = (hm - S.hf)/S.hfg;
      let x = 0; if(xe > xd){ const E = Math.exp(xe/xd - 1); x = (xe - xd*E)/(1 - xd*E); }
      x = Math.max(0, Math.min(1, x));
      const vgj = 1.53*Math.pow(S.sig*GRAV*(S.rf - S.rg)/(S.rf*S.rf), 0.25);
      s += (x <= 0 ? 0 : x/(XC0*(x + (1 - x)*S.rg/S.rf) + S.rg*vgj/Gm))/XNZ; }
    return s; };
  const eng = heat => { G.engRestore(snap); restPass(G, c, heat);
    let a = 0, fw = 0, f = 0;
    for(let k=0;k<XNN;k++){ const p2 = W[k]*ST.csPhi[nb+k]*ST.csPhi[nb+k];
      a += W[k]*ST.csNV[nb+k]; fw += p2*ST.csNV[nb+k]; f += p2; }
    return {a, fw:fw/f}; };
  const SRC = "Saha-Zuber departure (St 0.0065, the branch above Pe 7e4; Pe here is over 3e5 for any liquid conductivity between 0.5 and 0.7 W/m/K), Levy's profile fit, Zuber-Findlay drift flux with C0 " +
    XC0 + " and the churn-turbulent V_gj, IAPWS-IF97 saturation properties and IAPWS R1-76 surface tension, all test side";
  const e1 = eng(1), a1 = anl(1);
  check(name + ": core-average void at 100 %, the inlet and the flow held", e1.a, a1, 0.10, SRC,
    {note:"the drawing's own channel: " + Gm.toFixed(0) + " kg/m2/s at " + pc.toFixed(2) + " MPa, inlet " + hIn.toFixed(1) +
      " kJ/kg, " + (Qw/w).toFixed(1) + " kJ/kg over the heated length; flux-weighted the model reads " + e1.fw.toFixed(4) +
      "; a real RBMK-1000 runs at about 0.28"});
  const eLo = eng(0.995), eHi = eng(1.005);
  const sE = (eHi.a - eLo.a)/0.01/100, sA = (anl(1.005) - anl(0.995))/0.01/100;
  const sF = (eHi.fw - eLo.fw)/0.01/100;
  check(name + ": d(void)/d(power) at 100 % with the core inlet held", sE, sA, 0.15, SRC,
    {unit:"of void per % of rated", gap:"RBMK stability",
     note:"flux-weighted the model reads " + sF.toFixed(6) + " per %; a fast power coefficient inside the INSAG-7 band would need about " +
       "0.0025 per % at this drawing's void worth " + PT.coreAV[c].toFixed(0) + " pcm, so the published correlations on this channel are already steeper than the band allows"});
  G.engRestore(snap);
  ST.coreInH[c] = G.satH(G.eNodeSat(PT.coreNode[c]), pc);
  restPass(G, c, 1);
  let a0 = 0; for(let k=0;k<XNN;k++) a0 += W[k]*ST.csNV[nb+k];
  check(name + ": fault injected, the inlet subcooling removed: the void check fails", Math.abs(a0/a1 - 1) > 0.10 ? 1 : 0, 1, 0,
    "the core-average void check above must be able to fail", {abs:true, note:"saturated inlet gives " + a0.toFixed(4)});
}
