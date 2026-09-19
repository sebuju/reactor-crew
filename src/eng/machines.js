"use strict";
// exports: eMachSeed eMachRestSeed eMachPumpRho0 eMachPreSolve eActFollow eCwFlowStep eCavStep ePumpQStep ePumpCoastStep eSgHeatStep eHoldReliefStep eDiscTankStep eSgtrStep eMarginStep eCondTurbStep eSecVentStep eShellStep eCondVentStep eTurbStep eRadPanelStep eSecTankStep eBurstDice eFlowSpinStep eBoilerP eBoilerLvl eSglMin eFeedWant eBleedPlant eTankOpen eTankPoolPctHosted eCondFrac eCondRej eCondTRead eMwE eMWe eTurbDh ePzrQ eRadTMax eRadRej eSgLiftP eFlowDemPri eInjAny eNetCavGaugeA eRand eSpringStep
// imports: eTankRuleLive eFeedInH eFeedHeatKW eOutKg eLanded eBook eInvRate eContRel eDamage eNodeInCorePiece eCoreFlowSet eDonHA

const E_VALVE_RATE = 1/17, E_LOAD_TAU = 2, E_FLOW_TAU = 5, E_PUMP_FRIC_S = 60, E_CAV_SPAN = 12, E_CAV_TAU = 1.5;
const E_DUMP_K = 0.02, E_DUMP_COND_K = 0.75, E_TURB_TRIP_P = 0.02, E_TURB_RESET_K = 0.75;
const E_HOT_FLOOD = 90, E_COND_CAP_DP = 0.001;
const E_FEED_LVL_K = 2.3, E_HOT_DUMP = 1.6, E_UA_FLOW = 0.8;
const E_PZR_KW_M3 = 30, E_PZR_SPRAY_K = 10, E_PZR_BAND = 0.1, E_PZR_PROG_K = 0.17/15.5, E_SGTR_REL = 0.30;
/* large steam turbines run 0.85-0.90 isentropic across the wet LP stages; generator and bearings ~0.985 */
const E_TURB_ETA = 0.85, E_GEN_ETA = 0.985;
const E_MS_BLEED = 0, E_MS_BOILED = 1, E_MS_BOILQ = 2, E_MS_QTOT = 3, E_MS_N = 4;
const E_HBD = new Float64Array(4);

const E_RND = new Float64Array(1);
function eRandA(){
  const sc = ST.sc, r = (sc[SC_RNG] + 0x6D2B79F5) | 0;
  sc[SC_RNG] = r;
  let t = r;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  E_RND[0] = ((t ^ (t >>> 14)) >>> 0)/4294967296;
}
const eRand = () => { eRandA(); return E_RND[0]; };

const eBoilerSatOf = b => eCircSat(PT.boilerCirc[b]);
const E_BP = new Float64Array(1);
function eBoilerPA(b){
  const g = PT.boilerSg[b]; if(g >= 0){ eSecPA(g); E_BP[0] = E_SP[0]; return; }
  const i = PT.boilerNode[b], p = i >= 0 ? ST.pBy[i] : E_NAN;
  if(p === p){ E_BP[0] = Math.max(COND_P0, p); return; }
  const ci = PT.boilerCirc[b]; E_BP[0] = ci >= 0 ? PT.circSetP[ci] : PK[PK_PCONT];
}
const eBoilerP = b => { eBoilerPA(b); return E_BP[0]; };
const E_BL = new Float64Array(1);
function eBoilerLvlA(b){
  const i = PT.boilerNode[b];
  if(i < 0 || !(ST.hBy[i] === ST.hBy[i])){ E_BL[0] = E_SGL_SET; return; }
  eHoldLvlA(i);
  const v = E_HL[MX_T]*(PT.boilerDrum[b] ? 1 : E_SG_DOME);
  E_BL[0] = isFinite(v) ? (v < 0 ? 0 : v > 100 ? 100 : v) : E_SGL_SET;
}
const eBoilerLvl = b => { eBoilerLvlA(b); return E_BL[0]; };
const E_MR = new Float64Array(3);
function eSglMinA(){ let m = 100; for(let b=0;b<PT.n.boiler;b++){ eBoilerLvlA(b); const v = E_BL[0]; if(v < m) m = v; } E_MR[0] = m; }
const eSglMin = () => { eSglMinA(); return E_MR[0]; };
function eFeedWantA(b){ eBoilerLvlA(b); E_MR[1] = Math.max(0, ST.steamBy[b] + (E_SGL_SET - E_BL[0])/100*E_FEED_LVL_K*PK[PK_RATEDSTEAM]/Math.max(1, PT.n.boiler)); }
const eFeedWant = b => { eFeedWantA(b); return E_MR[1]; };
/* E_RC: [0] shell pressure in, [1] kJ/kg a kilogram of feed takes to leave as steam out */
const E_RC = new Float64Array(5);
function eRiseCondA(b){
  const io = E_RC, c = eBoilerSatOf(b);
  satTA(c, io, 0, 2); hOfTA(c, io, 2, 3); curveA(c, CV_HFG, io, 2, 4);
  eFeedInHA(b);
  io[1] = Math.max(1, io[3] + io[4] - E_FH[2]);
}
/* E_FH[1]: kg/s of steam the feed heaters bleed off boiler b */
function eBleedA(b){
  eFeedHeatA(b);
  const io = E_FH, cB = eBoilerSatOf(b);
  eBoilerPA(b); io[3] = E_BP[0]; satTA(cB, io, 3, 5); hOfTA(cB, io, 5, 6); curveA(cB, CV_HFG, io, 5, 7);
  eFeedInHA(b);
  const kg = io[0]/Math.max(io[6] + io[7] - io[2], 1);
  io[1] = Math.min(kg, Math.max(0, ST.steamBy[b]));
}
const E_BLD = new Float64Array(1);
function eBleedPlantA(){ let k = 0; for(let b=0;b<PT.n.boiler;b++){ eBleedA(b); k += E_FH[1]; } E_BLD[0] = k; }
const eBleedPlant = () => { eBleedPlantA(); return E_BLD[0]; };

const eTankOpen = t => ST.tankOpen[t] !== 0 || (!ST.tankByp[t] && eTankRuleLive(t));
/* E_CF: [0] the condensing share the hotwell leaves the tubes, [1] the hosted pool's fill % */
const E_CF = new Float64Array(2);
function eTankPoolPctHostedA(){
  const h = PT.hostedTanks; let c = 0, m = 0;
  for(let k=0;k<h.length;k++){ const t = h[k], kg = PT.tankKg[t];
    eTankLvlA(t); const l = E_TL[0];
    c += kg; m += (l < 0 ? 0 : l > 100 ? 100 : l)/100*kg; }
  E_CF[1] = c > 0 ? 100*m/c : 0;
}
const eTankPoolPctHosted = () => { eTankPoolPctHostedA(); return E_CF[1]; };
function eCondFracA(){
  if(!PT.hostedTanks.length){ E_CF[0] = 1; return; }
  eTankPoolPctHostedA();
  const v = (100 - E_CF[1])/(100 - E_HOT_FLOOD); E_CF[0] = v < 0 ? 0 : v > 1 ? 1 : v;
}
const eCondFrac = () => { eCondFracA(); return E_CF[0]; };
const eSgLiftP = () => PK[PK_SGLIFTP0];
const E_FD = new Float64Array(1);
function eFlowDemPriA(){ let t = 0, n = 0;
  for(let p=0;p<PT.n.pump;p++) if(PT.pumpPrimary[p]){ t += ST.flowDemBy[p]; n++; }
  E_FD[0] = n ? t/n : 1; }
const eFlowDemPri = () => { eFlowDemPriA(); return E_FD[0]; };
function eInjAny(){ let n = 0; for(let t=0;t<PT.n.tank;t++) n += SX.tInj[t]; return n; }
const E_CGG = new Float64Array(1);
function eNetCavGaugeA(c){ const i = PT.coreCavNode[c];
  if(i < 0){ E_CGG[0] = E_NAN; return; }
  eNodePOfA(ST.pBy, i); E_CGG[0] = E_NP[0] - eRegionP(PT.coreCavCell[c]); }

/* isentropic expansion of saturated vapour across the circuit's own liquid and latent heat, then the stage efficiency; E_TD: [0] ps, [1] pc in, [2] kJ/kg out */
const E_TD = new Float64Array(12);
function eTurbDhA(){
  const io = E_TD, c = eCircSat(PT.n.boiler ? PT.boilerCirc[0] : PT.coreCirc0);
  satTA(c, io, 0, 3); satTA(c, io, 1, 4);
  const Ts = io[3], Tc = io[4];
  if(!(Ts > Tc)){ io[2] = 0; return; }
  curveA(c, CV_HFG, io, 3, 5); curveA(c, CV_HFG, io, 4, 6);
  const hs = io[5], hc = io[6];
  sLiqA(c, io, 3, 4, 7);
  let x = (io[7] + hs/Ts)/Math.max(hc/Tc, 1e-9);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  hOfTA(c, io, 3, 9); hOfTA(c, io, 4, 10);
  io[2] = E_TURB_ETA*(io[9] - io[10] + hs - x*hc);
}
const eTurbDh = (ps, pc) => { E_TD[0] = ps; E_TD[1] = pc; eTurbDhA(); return E_TD[2]; };
/* E_TD[11]: MW the wheels turn */
function eMwEA(){ const io = E_TD; io[0] = ST.sc[SC_TURBP]; eCondPA(); io[1] = E_CP[1]; eTurbDhA(); io[11] = ST.sc[SC_TURBWK]*io[2]/1000; }
const eMwE = () => { eMwEA(); return E_TD[11]; };
const eMWe = () => eMwE()*E_GEN_ETA;

const eCwInAt = q => ST.cwInTBy[q] > 0 ? ST.cwInTBy[q] : RAD_TDES;
const eCondTAt = q => ST.condTBy[q] > 0 ? ST.condTBy[q] : eCwInAt(q);
function eCwC(q){ const ref = PT.condCwRef[q]; if(!(ref > 0)) return 0;
  return PT.condUA[q]/PK[PK_CWCK]*clamp(ST.cwFlowBy[q]/ref, 0, 2); }
/* kW the tubes condense: effectiveness against an isothermal steam space; E_CRJ[0] out */
const E_CRJ = new Float64Array(1);
function eCondRejA(q){
  const ref = PT.condCwRef[q];
  if(!(ref > 0)){ E_CRJ[0] = 0; return; }
  let f = ST.cwFlowBy[q]/ref; f = Math.max(0, Math.min(2, f));
  const c = PT.condUA[q]/PK[PK_CWCK]*f;
  if(!(c > 0)){ E_CRJ[0] = 0; return; }
  let k = 0; if(!eWrecked(PT.condPart[q])){ eCondFracA(); k = E_CF[0]; }
  const cold = ST.cwInTBy[q] > 0 ? ST.cwInTBy[q] : RAD_TDES, hot = ST.condTBy[q] > 0 ? ST.condTBy[q] : cold;
  E_CRJ[0] = Math.max(0, c*(1 - Math.exp(-PT.condUA[q]*k/c))*(hot - cold));
}
const eCondRej = q => { eCondRejA(q); return E_CRJ[0]; };
/* E_NIN: [0] kg/s, [1] kW net into node i on the last solve's flows, each edge at its donor's state; [2], [3] the inflow alone */
const E_NIN = new Float64Array(4);
function eNodeInA(i){
  let m = 0, e = 0, mi = 0, ei = 0;
  for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed];
    if(!(w0 === w0) || w0 === 0) continue;
    const f = w0 > 0 ? PT.edU[ed] : PT.edV[ed], w = PT.edV[ed] === i ? w0 : -w0, x = SX.fX[f];
    E_ADH[4] = ST.hBy[f]; E_ADH[5] = PT.edGasAt[ed] === f && x > 0 ? 1 : 0; E_ADH[6] = PT.edLiqAt[ed] === f && x > 0 ? 1 : 0;
    eDonHA(f);
    m += w; e += w*E_ADH[4];
    if(w > 0){ mi += w; ei += w*E_ADH[4]; } }
  E_NIN[0] = m; E_NIN[1] = e; E_NIN[2] = mi; E_NIN[3] = ei;
}
/* kW the steam space loses, [0]: the tubes [1], its skin, and the shaft and feed-heater duty its steam still carries */
const E_CSK = new Float64Array(2);
function eCondSinkA(q){
  eMwEA(); let f = 0;
  for(let b=0;b<PT.n.boiler;b++){ eFeedHeatA(b); f += E_FH[0]; }
  eCondRejA(q); const a = PT.condPart[q];
  E_CSK[1] = E_CRJ[0];
  E_CSK[0] = E_CRJ[0] + (a >= 0 ? ST.skinQ[a] : 0) + (E_TD[11]*1000 + f)/Math.max(1, PT.n.cond);
}
const E_RJ = new Float64Array(1);
function eRadRejA(r){ E_RJ[0] = eWrecked(PT.radPart[r]) ? 0 : Math.max(0, PT.radEmA[r]*(Math.pow(ST.radTBy[r], 4) - Math.pow(T_SPACE, 4))); }
const eRadRej = r => { eRadRejA(r); return E_RJ[0]; };
function eRadTMaxA(){ let t = -E_INF; for(let r=0;r<PT.n.rad;r++) if(ST.radTBy[r] > t) t = ST.radTBy[r];
  E_MR[2] = isFinite(t) ? t : RAD_TDES; }
const eRadTMax = () => { eRadTMaxA(); return E_MR[2]; };

const E_PZ = new Float64Array(1);
function ePzrQA(t){
  const ci = PT.tankCirc[t], i = PT.tankNode[t];
  if(ci < 0 || i < 0){ E_PZ[0] = 0; return; }
  const pg = PT.circPzrProg[ci];
  let prog = 0;
  if(pg > 0 && PT.circTref[ci] === PT.circTref[ci]){ eTavgA(ci); prog = (E_TA[0] - PT.circTref[ci])*pg; }
  eNodePOfA(ST.pBy, i);
  const q = PT.tankHoldKW[t]*clamp((PT.circSetP[ci] + prog - E_NP[0])/E_PZR_BAND, -E_PZR_SPRAY_K, 1);
  if(eWrecked(PT.tankPart[t])){ E_PZ[0] = Math.min(q, 0); return; }
  eHoldLvlA(i);
  E_PZ[0] = E_HL[MX_T] <= 0.5 ? Math.min(q, 0) : q;
}
const ePzrQ = t => { ePzrQA(t); return E_PZ[0]; };

/* the steam space's pool temperature: saturated at T with the vapour the volume forces over it */
/* E_CQ: [0] T in, [1] x out, [2] h out; [8] the read's answer; [9] kg, [10] m3 in */
const E_CQ = new Float64Array(11);
function eCondCurveA(c){
  const io = E_CQ;
  curveA(c, CV_RF, io, 0, 3); curveA(c, CV_RG, io, 0, 4); hOfTA(c, io, 0, 5); curveA(c, CV_HFG, io, 0, 6);
}
function eCondHA(c){ eCondCurveA(c); eCondHX(); }
function eCondHX(){
  const io = E_CQ, rf = io[3], rg = io[4], m = io[9], V = io[10];
  let x = rg*(V - m/rf)/Math.max(1e-12, m*(1 - rg/rf)); x = x < 0 ? 0 : x > 1 ? 1 : x;
  io[1] = x; io[2] = io[5] + x*io[6];
}
function eCondPoolTA(q){
  const io = E_CQ, i = PT.condVNode[q]; if(i < 0){ io[8] = E_NAN; return; }
  eNodeHOfA(ST.pBy, i);
  const c = eNodeSat(i), m = ST.mBy[i], h = E_NH[0], V = PT.nodeVol[i];
  if(!(m > 0) || !isFinite(h) || !(V > 0)){ eNodeTA(i); io[8] = E_NT[MX_T]; return; }
  const hi = c.tc ? (c.tc > CURVE_LO + 10 ? c.tc - (c.tc - CURVE_LO)/(CURVE_N - 1) : c.tc - 1) : (c.Tref || c.T0 || 1)*1.5, lo = CURVE_LO + 1;
  if(!(hi > lo)){ eNodeTA(i); io[8] = E_NT[MX_T]; return; }
  io[0] = hi;
  const ch = PT.condHi, q5 = q*5;
  if(ch[q5] !== hi){ eCondCurveA(c); ch[q5] = hi; ch[q5+1] = io[3]; ch[q5+2] = io[4]; ch[q5+3] = io[5]; ch[q5+4] = io[6]; }
  else { io[3] = ch[q5+1]; io[4] = ch[q5+2]; io[5] = ch[q5+3]; io[6] = ch[q5+4]; }
  io[9] = m; io[10] = V; eCondHX();
  if(io[1] >= 1 || h >= io[2]){ eNodeTA(i); io[8] = E_NT[MX_T]; return; }
  io[0] = lo; eCondHA(c);
  if(h <= io[2]){ io[8] = lo; return; }
  let a = lo, b = hi;
  for(let k=0;k<40;k++){ const T = 0.5*(a + b); io[0] = T; eCondHA(c); if(io[2] < h) a = T; else b = T; }
  io[8] = 0.5*(a + b);
}
/* the steam space at rest at T: its pool at the commissioning fill, its h what eCondPoolTA() reads back as T */
function eCondSeed(i, T){
  const io = E_CQ, c = eNodeSat(i), V = PT.nodeVol[i], m = PK[PK_CONDFILL0]/100*V*rhofOf(c, T);
  io[0] = T; io[9] = m; io[10] = V; eCondHA(c);
  ST.mBy[i] = m; ST.hBy[i] = io[2];
}
function eCondTReadA(q){
  if(PT.condVac[q]){ eCondPoolTA(q); return; }
  if(PT.condVNode[q] >= 0){ eNodeTA(PT.condVNode[q]); E_CQ[8] = E_NT[MX_T]; } else E_CQ[8] = E_NAN;
}
const eCondTRead = q => { eCondTReadA(q); return E_CQ[8]; };

/* the machine-state conductances and stores the solve reads: tank valves, the governor and the vacuum's compliance */
const E_MP = new Float64Array(10);
function eMachPreSolve(){
  const s = ST, sc = s.sc;
  for(let t=0;t<PT.n.tank;t++) s.tankLive[t] = !eWrecked(PT.tankPart[t]) && eTankOpen(t) ? 1 : 0;
  eCondPA();
  const pc = E_CP[1];
  let dump = 0;
  if(pc < E_TURB_TRIP_P*E_DUMP_COND_K){
    let over = 0;
    for(let b=0;b<PT.n.boiler;b++){ eBoilerPA(b); const k = E_BP[0]/PT.boilerDesP[b] - 1; if(k > over) over = k; }
    eTProgA(-1);
    const bp = PK[PK_BYPASS], ob = over/PK[PK_SGBYPBAND];
    /* a loop a drum holds at saturation reads its T-avg off its pressure, so its bypass answers pressure alone */
    const hot = PT.coreCirc0 >= 0 && PT.circDrumP[PT.coreCirc0] ? 0 : Math.max(0, Math.min(bp, (sc[SC_TAVG] - E_CT[2])*E_DUMP_K));
    dump = Math.max(hot, Math.max(0, Math.min(1, ob))*bp); }
  if(sc[SC_SCRAMMED]) for(let t=0;t<PT.n.tank;t++) if(PT.tankRuleSecOn[t] && !s.tankByp[t]){ dump += 0.08; break; }
  const lim = Math.min(sc[SC_LOAD], PK[PK_SWALLOW]/Math.max(PK[PK_STEAMREF], 1e-9));
  for(let b=0;b<PT.n.turb;b++){
    const w = PT.turbPiped[b] && !sc[SC_TURBTRIP] ? lim : 0, t = w + dump;
    s.turbGate[b] = Math.max(0, t); s.turbWorkFr[b] = t > 0 ? Math.max(0, w)/t : 0; }
  const io = E_MP;
  for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q]; if(i < 0 || !PT.condVac[q]) continue;
    const c = eCircSat(PT.condCirc[q]);
    io[0] = ST.condTBy[q] > 0 ? ST.condTBy[q] : (ST.cwInTBy[q] > 0 ? ST.cwInTBy[q] : RAD_TDES);
    curveA(c, CV_SP, io, 0, 1);
    const p = Math.max(COND_P0, io[1]);
    io[2] = p; satTA(c, io, 2, 3); curveA(c, CV_HFG, io, 3, 4);
    io[5] = p + E_COND_CAP_DP; satTA(c, io, 5, 6);
    const hfg = Math.max(1, io[4]), T0 = io[3], T1 = io[6];
    const dTdp = Math.max(1e-6, (T1 - T0)/E_COND_CAP_DP);
    eNodePOfA(s.pBy, i); E_PL[MX_P] = E_NP[0];
    ePoolLvlA(i);
    const l0 = E_PL[MX_X], lvl = l0 === l0 ? l0 : PK[PK_CONDFILL0];
    const vs = Math.max(0.1, PT.nodeVol[i]*(1 - Math.max(0, Math.min(100, lvl))/100));
    curveA(c, CV_RG, io, 6, 7); curveA(c, CV_RG, io, 3, 8);
    const cap = Math.max(1e-9, vs*(io[7] - io[8])/E_COND_CAP_DP);
    const mW0 = s.mBy[i], mW = mW0 === mW0 ? mW0 : 0;
    cpOfA(c, io, 3, 9);
    s.condStC[q] = cap + (mW*io[9] + PT.condPartKg[q]*E_CP_STEEL)*dTdp/hfg;
    hOfTA(c, io, 3, 5);
    const hf = io[5];
    eNodeInA(i); const dm = E_NIN[0], de = E_NIN[1] - hf*dm;
    eCondSinkA(q);
    s.condStW[q] = (de - E_CSK[0])/hfg - dm;
    s.condStP[q] = p; }
}

function eActFollow(dt){
  const s = ST, sc = s.sc, r = E_VALVE_RATE*dt;
  for(let b=0;b<PT.n.boiler;b++){ const d = s.fregDemBy[b] - s.fregBy[b];
    if(d) s.fregBy[b] += Math.sign(d)*Math.min(Math.abs(d), r); }
  for(let w=0;w<PT.n.throttle;w++){ const d = s.valveDem[w] - s.valve[w];
    s.valve[w] += Math.sign(d)*Math.min(Math.abs(d), r); }
  sc[SC_LOAD] += (sc[SC_LOADDEM] - sc[SC_LOAD])*Math.min(dt/E_LOAD_TAU, 1);
}

function eCwFlowStep(){
  for(let q=0;q<PT.n.cond;q++){ let f = 0;
    for(let k=PT.condCw0[q];k<PT.condCw0[q+1];k++) f += Math.abs(eKeyW(PT.cwKey[k]));
    ST.cwFlowBy[q] = f; }
}

/* vapour fills the inlet where subcooling reaches zero, over CAV_TAU, read at each pump's own suction */
function eCavStep(dt){
  const s = ST, kc = Math.min(dt/E_CAV_TAU, 1);
  let worst = 0;
  for(let p=0;p<PT.n.pump;p++){ const i = PT.pumpSuc[p];
    let sub = E_INF;
    if(i >= 0){ eNodeTA(i); sub = E_NT[MX_TS] - E_NT[MX_T]; }
    const want = clamp(-sub/E_CAV_SPAN, 0, 1);
    s.cavP[p] += (want - s.cavP[p])*kc;
    if(s.cavP[p] > worst) worst = s.cavP[p]; }
  s.sc[SC_CAV] = worst;
}
function ePumpQStep(){
  for(let p=0;p<PT.n.pump;p++){ const q = eKeyW(PT.pumpKey[p]); ST.pumpQBy[p] = q > 0 ? q : 0; }
}
/* up on the motor; down on the rotor, whose hydraulic torque goes as N^2, never below what the motor still holds */
function ePumpCoastStep(dt){
  const s = ST, k = Math.min(dt/E_FLOW_TAU, 1), sup = eSupplyK();
  for(let p=0;p<PT.n.pump;p++){
    const r0 = PT.pumpRes0[p], r1 = PT.pumpRes0[p+1];
    if(r1 > r0){ let open = false;
      for(let j=r0;j<r1;j++) if(eTankOpen(PT.pumpResIx[j])){ open = true; break; }
      s.flowDemBy[p] = open ? 1 : 0; }
    const N = s.flowBy[p], want = sup*s.flowDemBy[p];
    s.flowBy[p] = want >= N ? N + (want - N)*k : Math.max(want, N - (N*N/(2*PT.pumpRotor[p]) + N/E_PUMP_FRIC_S)*dt); }
}

/* one stream of one exchanger off the solve: the hot inlet is the hottest neighbour, the cold the coldest; two-phase is an infinite heat capacity rate */
function eStageStream(st, k){
  const j = 2*st + k, X = SX, hot = k === 0, nt = E_NT;
  let at = -1, T = hot ? -E_INF : E_INF;
  for(let q=PT.stageNbr0[j];q<PT.stageNbr0[j+1];q++){ const i = PT.stageNbrIx[q];
    eNodeTA(i); const t = nt[MX_T];
    if(hot ? t > T : t < T){ T = t; at = i; } }
  const ref = PT.stageRef[j], w = Math.max(Math.abs(eKeyW(PT.stageKey[j])), 0.02*ref);
  let x = 0;
  if(at >= 0){ eNodeTA(at); xOfHA(eNodeSat(at), nt); x = clamp(nt[MX_X], 0, 1); X.stgT[j] = nt[MX_T]; }
  else X.stgT[j] = ST.sc[SC_TAVG];
  X.stgX[j] = x;
  X.stgFl[j] = ref > 1e-9 ? w/ref : 0.02;
  X.stgW[j] = w; X.stgN[j] = at;
  if(x > 0) X.stgC[j] = E_INF;
  else { const io = E_SQ; eStagePA(j); io[7] = X.stgT[j]; cpOfTPA(at >= 0 ? eNodeSat(at) : eCircSat(PT.coreCirc0), io, 7, 9, 8); X.stgC[j] = w*io[8]; }
}
/* E_SQ[9]: the pressure stream j stands at */
function eStagePA(j){ const at = SX.stgN[j]; if(at >= 0){ eNodePOfA(ST.pBy, at); E_SQ[9] = E_NP[0]; } else E_SQ[9] = ST.sc[SC_P]; }
/* the stream's heat capacity rate as the secant of its own h(T) over the span it can cross, so an exchange priced in T lands in h; E_SQ[3] is the far end */
function eStageSecant(j){
  const X = SX, io = E_SQ, T = X.stgT[j], To = io[3], d = T - To;
  if(!isFinite(X.stgC[j]) || !(Math.abs(d) > 0.5)) return;
  const at = X.stgN[j], c = at >= 0 ? eNodeSat(at) : eCircSat(PT.coreCirc0);
  eStagePA(j); io[4] = T; hOfTPA(c, io, 4, 9, 5); hOfTPA(c, io, 3, 9, 6);
  X.stgC[j] = X.stgW[j]*(io[5] - io[6])/d;
}
/* something still brings heat to the hot side: a core's piece, or the cold side of another stage */
function eStageFed(st){
  const of = SX.pcOf, fa = PT.stageFaceA[2*st], fb = PT.stageFaceB[2*st];
  const a0 = fa >= 0 ? of[fa] : -1, a1 = fb >= 0 ? of[fb] : -1;
  if(a0 < 0 && a1 < 0) return false;
  for(let j=0;j<PT.coreLoop0[PT.n.core];j++){ const p = of[PT.coreLoopNode[j]];
    if(p >= 0 && (p === a0 || p === a1)) return true; }
  for(let q=0;q<PT.nStage;q++){ if(q === st) continue;
    const ca = PT.stageFaceA[2*q+1], cb = PT.stageFaceB[2*q+1];
    const pa = ca >= 0 ? of[ca] : -1, pb = cb >= 0 ? of[cb] : -1;
    if((pa >= 0 && (pa === a0 || pa === a1)) || (pb >= 0 && (pb === a0 || pb === a1))) return true; }
  return false;
}
/* counterflow effectiveness, E_NTU: [0] NTU in, [1] Cr in, [2] epsilon out */
const E_NTU = new Float64Array(3);
function eNtuCounterA(){ const io = E_NTU, ntu = io[0], cr = io[1];
  if(!(ntu > 0)){ io[2] = 0; return; }
  if(!(cr < 0.999)){ io[2] = ntu/(1 + ntu); return; }
  const e = Math.exp(-ntu*(1 - cr)); io[2] = (1 - e)/(1 - cr*e); }
const eNtuCounter = (ntu, cr) => { E_NTU[0] = ntu; E_NTU[1] = cr; eNtuCounterA(); return E_NTU[2]; };
/* E_SQ: [0] flow fraction in, [1] film factor in, [2] kW out, [3..8] secant and cp scratch */
const E_SQ = new Float64Array(10), E_SG2 = new Float64Array(2);
function eSgQ(g){
  const io = E_SQ, fl = io[0], filmK = io[1], b = PT.sgBoiler[g];
  eBoilerLvlA(b);
  const fill = clamp(E_BL[0]/E_SG_DRY, 0, 1);
  const UA = PT.stageUA[g]*Math.pow(fl, E_UA_FLOW)*fill*filmK;
  eStageStream(g, 0);
  let Ts = ST.sgTBy[b];
  if(!(Ts > 0)){ eSecPA(g); E_SG2[0] = E_SP[0]; satTA(eBoilerSatOf(b), E_SG2, 0, 1); Ts = E_SG2[1]; }
  io[3] = Ts; eStageSecant(2*g);
  const dT = Math.max(0, SX.stgT[2*g] - Ts), wcp = SX.stgC[2*g];
  if(!isFinite(wcp)){ io[2] = UA*dT; return; }
  io[2] = wcp > 0 ? wcp*(1 - Math.exp(-UA/wcp))*dT : 0;
}
function eIhxQ(st){
  const io = E_SQ;
  if(eWrecked(PT.stagePart[st])){ io[2] = 0; return; }
  eStageStream(st, 0); eStageStream(st, 1);
  const X = SX, a = 2*st, b = a + 1, dT = X.stgT[a] - X.stgT[b];
  io[3] = X.stgT[b]; eStageSecant(a); io[3] = X.stgT[a]; eStageSecant(b);
  if(!(dT > 0)){ io[2] = 0; return; }
  const UA = PT.stageUA[st]*Math.pow(Math.min(X.stgFl[a], X.stgFl[b]), E_UA_FLOW)*(1 - 0.85*Math.max(X.stgX[a], X.stgX[b]));
  const cmin = Math.min(X.stgC[a], X.stgC[b]), cmax = Math.max(X.stgC[a], X.stgC[b]);
  if(!isFinite(cmin)){ io[2] = UA*dT; return; }
  if(!(cmin > 0)){ io[2] = 0; return; }
  const nx = E_NTU; nx[0] = UA/cmin; nx[1] = isFinite(cmax) ? cmin/cmax : 0; eNtuCounterA();
  io[2] = nx[2]*cmin*dT;
}
/* heat across every stage and panel off this tick's solve; the heat balance's removal is what the core's own water reaches */
function eSgHeatStep(){
  const s = ST, sc = s.sc, ng = PT.n.sg, heat = E_TK[E_TK_HEAT], pumpK = E_TK[E_TK_FLOW];
  sc[SC_NAT] = SX.netSc[E_NS_NAT];
  let tot = 0;
  for(let g=0;g<ng;g++){ const l = PT.stageLoop[g], q = (l >= 0 && SX.netLoop[l] > 0) ? SX.netLoop[l] : 0;
    s.sgShare[g] = q; tot += q; }
  for(let g=0;g<ng;g++) s.sgShare[g] = tot > 0 ? s.sgShare[g]/tot : 1/ng;
  const filmK = 1 - 0.85*Math.min(clamp(sc[SC_VF], 0, 1.5), 1), nSG = Math.max(1, ng);
  let qTot = 0;
  for(let b=0;b<PT.n.boiler;b++) s.hbSgQ[b] = 0;
  for(let g=0;g<ng;g++){
    let q = 0;
    if(eStageFed(g)){ E_SQ[0] = Math.max(pumpK*s.sgShare[g]*nSG, 0.02); E_SQ[1] = filmK; eSgQ(g); q = E_SQ[2]; }
    s.hbSgQ[PT.sgBoiler[g]] = q;
    if(PT.stageActive[g]) qTot += q; }
  for(let x=0;x<PT.n.ihx;x++){ const st = ng + x;
    let q = 0; if(eStageFed(st)){ eIhxQ(st); q = E_SQ[2]; }
    s.ihxQBy[x] = q; if(PT.stageActive[st]) qTot += q; }
  for(let r=0;r<PT.n.rad;r++){
    const ref = PT.radRef[r], u = eKeyW(PT.radKey[r]), ratio = ref > 1e-9 ? u/ref : 0;
    const nIn = ratio >= 0 ? PT.radNodeA[r] : PT.radNodeB[r], fl = Math.max(Math.abs(ratio), 0.02);
    let q = 0;
    if(!(eWrecked(PT.radPart[r]) || !PT.radLive[r] || !(ref > 1e-9) || nIn < 0)){
      eNodeTA(nIn); xOfHA(eNodeSat(nIn), E_NT);
      q = PT.radUA[r]*Math.pow(fl, E_UA_FLOW)*(1 - 0.85*clamp(E_NT[MX_X], 0, 1))*Math.max(0, E_NT[MX_T] - s.radTBy[r]); }
    s.radQBy[r] = q;
    if(nIn >= 0 && eNodeInCorePiece(nIn)) qTot += q; }
  /* a drum's circuit gives its heat up as steam, less the feed it takes back past the heaters */
  for(let b=0;b<PT.n.boiler;b++){ if(!PT.boilerDrum[b]) continue;
    const io = E_HBD, f = PT.boilerFeed[b];
    eBoilerPA(b); io[0] = E_BP[0]; satHgA(eBoilerSatOf(b), io, 0, 1);
    qTot += s.steamBy[b]*io[1] - s.sgFedBy[b]*(f >= 0 ? s.hBy[f] : 0); }
  sc[SC_HBPROMPT] = sc[SC_N]*PROMPT_F; sc[SC_HBDECAY] = sc[SC_DECAY]; sc[SC_HBHEAT] = heat;
  sc[SC_HBREMOVAL] = qTot/(PK[PK_RATED]*1000); sc[SC_HBDTAVG] = sc[SC_DTAVG];
  SX.machSc[E_MS_QTOT] = qTot;
}

/* the inlet pressure in E_NP[0] */
function eSpringStep(v){
  const p = E_NP[0];
  if(p > PT.reliefLift[v]) eReliefCmd(v, true);
  else if(p < PT.reliefReseat[v]) eReliefCmd(v, false);
}
/* the pressurizer holds its circuit's number while it is live; a primary relief lifts on the pressure at its own inlet */
function eHoldReliefStep(dt){
  const s = ST, sc = s.sc, h = PT.holdTanks;
  for(let k=0;k<h.length;k++){ const t = h[k], ci = PT.tankCirc[t];
    if(ci >= 0 && eHoldLive(ci)){ eLoopPA(ci); s.holdPBy[t] = E_LP[0]; } }
  for(let v=0;v<PT.n.relief;v++){ if(PT.reliefSec[v]) continue;
    s.reliefVent[v] = 0;
    if(PT.reliefSpring[v] && PT.reliefNode[v] >= 0){ eNodePOfA(ST.pBy, PT.reliefNode[v]); eSpringStep(v); }
    if(!s.reliefOpen[v] || s.reliefBlocked[v]) continue;
    const w = Math.max(0, SX.netRelief[v]);
    E_IR[1] = w; eInvRateA(E_IR, 1); const rate = E_IR[0];
    s.reliefVent[v] = rate;
    if(PT.reliefHasTarget[v]) continue;
    eContRelA(PT.reliefPart[v]); sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE] + (rate/E_SGTR_REL)*0.02*E_RR[RR_CR]*PK[PK_DOSE]*dt);
    const o = PT.reliefOut[v]; eBook(E_BK_RELIEFROOM, o >= 0 ? eOutKg(o) : w*dt); }
}

/* a disc past its own setpoint is an opening to containment, latched; a release is charged per share of the tank lost */
function eDiscTankStep(dt){
  const s = ST, sc = s.sc;
  for(let t=0;t<PT.n.tank;t++){
    const a = PT.tankPart[t], kg = PT.tankKg[t], act = PT.tankAct[t];
    if(PT.tankInField[t]){
      const o = PT.tankOut[t], out = o >= 0 && kg > 0 ? 100*eOutKg(o)/kg : 0;
      const rel = eWrecked(a) ? 1 : (s.burstBy[t] && PT.tankHasBurst[t]) ? PT.tankBurstRel[t] : 0;
      if(out > 0 && rel > 0){ eContRelA(a); sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE] + out*rel*act*E_RR[RR_CR]*PK[PK_DOSE]); } }
    else if(!PT.tankHold[t] && eWrecked(a) && s.tank[t] > 0){
      const out = Math.min(s.tank[t], E_HOT_DUMP*Math.min(s.tank[t], 100)/100*dt);
      s.tank[t] -= out; eBook(E_BK_TANKWRECK, out/100*kg);
      eContRelA(a); sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE] + out*act*E_RR[RR_CR]*PK[PK_DOSE]); }
    if(!PT.tankHasBurst[t]) continue;
    if(!s.burstBy[t]){ eTankPA(t); if(E_TP[0] >= PT.tankBurstAt[t]){ s.burstBy[t] = 1; eEvent(EV_DISC_BURST, t, E_TP[0]); } }
    if(!PT.tankInField[t] && s.burstBy[t] && s.tank[t] > 0){
      const out = Math.min(s.tank[t], PT.tankBurstDrain[t]*dt);
      s.tank[t] -= out; eBook(E_BK_BURSTDISC, out/100*kg);
      eContRelA(a); sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE] + out*PT.tankBurstRel[t]*act*E_RR[RR_CR]*PK[PK_DOSE]); }
  }
}

/* a tube leak at whatever the differential says; on a sodium plant the sign is the accident */
function eSgtrStep(dt){
  const s = ST, sc = s.sc;
  eInvRateA(SX.netSc, E_NS_QSGT); sc[SC_SGTRRATE] = Math.max(0, E_IR[0]);
  let hot = 0;
  for(let g=0;g<PT.n.sg;g++){ eInvRateA(SX.netSgtr, g); s.sgtrBy[g] = Math.max(0, E_IR[0]);
    if(PT.stageActive[g]){ eContRelA(PT.sgPart[g]); hot += s.sgtrBy[g]*E_RR[RR_CR]; } }
  if(hot > 0) sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE] + (hot/E_SGTR_REL)*0.02*PK[PK_DOSE]*dt);
  for(let g=0;g<PT.n.sg;g++){
    if(!(s.sgWastBy[g] > 0)) s.sgWastBy[g] = 1;
    s.sgSwQBy[g] = 0; s.sgPwQBy[g] = 0;
    if(!PT.stageFire[g] || PT.stageShellBurn[g]) continue;
    const q = SX.netSgtr[g]; if(!q) continue;
    const na = q > 0 ? q*dt : -q*dt/PT.stageWh2o[g];
    const rq = na*PT.stageWlhv[g], rh = na*PT.stageWh2[g];
    if(q > 0){ s.sgSwQBy[g] = rq/dt; s.sgH2By[g] += rh; }
    else { s.sgPwQBy[g] = rq/dt;
      for(let f=0;f<2;f++){ const i = f ? PT.stageFaceB[2*g] : PT.stageFaceA[2*g]; if(i < 0) continue;
        const m = s.mBy[i]; if(m > DRY_MIN_KG) s.h2By[i] += rh/2/m; } }
    s.sgWastBy[g] = Math.min(PT.stageWastMax[g], s.sgWastBy[g]*(1 + PT.stageWast[g]*dt)); }
}

/* margin to boiling where the water is hottest, per circuit; a pressurizer's own saturated water is not a margin */
const E_MG = new Float64Array(MX_N);
function eMarginStep(){
  const s = ST, sc = s.sc, hc = PT.trHoldCircs, n = PT.n.node, io = E_MG, nt = E_NT;
  for(let k=0;k<hc.length;k++){ const ci = hc[k], cC = eCircSat(ci);
    let worst = -1, hot = -E_INF;
    for(let i=0;i<n;i++){
      if(PT.nodeCirc[i] !== ci || PT.nodeBooked[i] || PT.nodeHoldLine[i]) continue;
      const p0 = s.pBy[i], h = s.hBy[i];
      let T;
      if(p0 === p0 && h === h){
        io[MX_P] = p0 > COND_P0 ? p0 : COND_P0; io[MX_H] = h;
        xOfHA(cC, io);
        if(io[MX_X] > 0) continue;
        tOfHA(cC, io); T = io[MX_T]; }
      else { eNodeTA(i); xOfHA(eNodeSat(i), nt); if(nt[MX_X] > 0) continue; T = nt[MX_T]; }
      if(T > hot){ hot = T; worst = i; } }
    if(worst < 0) worst = PT.circScFb[ci];
    if(worst >= 0){ eNodeTA(worst); s.scBy[ci] = nt[MX_TS] - nt[MX_T]; } else s.scBy[ci] = 0; }
  sc[SC_HEAT] = E_TK[E_TK_HEAT]; sc[SC_SC] = s.scBy[PT.coreCirc0 >= 0 ? PT.coreCirc0 : 0];
  sc[SC_FLOWNET] = E_TK[E_TK_FLOW];
  eCoreFlowSet();
}

/* both latched ahead of the stop valve: the vacuum never comes back, the trip re-arms on a whole, clear machine */
function eCondTurbStep(){
  eCondPA(); const sc = ST.sc, pc = E_CP[1];
  if(!sc[SC_CONDLOST] && pc >= COND_ATM){ sc[SC_CONDLOST] = 1; eEvent(EV_VACUUM_LOST, pc, 0); }
  if(!sc[SC_TURBTRIP] && pc > E_TURB_TRIP_P){ sc[SC_TURBTRIP] = 1; eEvent(EV_TURB_TRIP, pc, 0); }
  else if(sc[SC_TURBTRIP] && !sc[SC_CONDLOST] && !eExhOpen() && pc < E_TURB_TRIP_P*E_TURB_RESET_K){
    let alive = false; const tp = PT.turbRoleParts;
    for(let k=0;k<tp.length;k++) if(!ST.dmgBy[tp[k]]){ alive = true; break; }
    if(alive){ sc[SC_TURBTRIP] = 0; eEvent(EV_TURB_RESET, pc, 0); } }
}
/* a safety valve lifts on the pressure at its own inlet; what its vent carried is split over the shells it reaches by their overpressure */
function eSecVentStep(dt){
  const s = ST, sv = SX.secVent, of = SX.pcOf;
  sv.fill(0);
  for(let v=0;v<PT.n.relief;v++){ if(!PT.reliefSec[v]) continue;
    s.reliefSteam[v] = 0;
    const rn = PT.reliefNode[v];
    if(PT.reliefSpring[v] && rn >= 0){ eNodePOfA(ST.pBy, rn); eSpringStep(v); }
    s.reliefSteam[v] = (!s.reliefOpen[v] || s.reliefBlocked[v]) ? 0 : Math.max(0, SX.netRelief[v]);
    const o = PT.reliefOut[v], q = o >= 0 ? eOutKg(o)/Math.max(dt, 1e-9) : 0;
    if(!(q > 0)) continue;
    const back = eRegionPart(PT.reliefPart[v]), pv = rn >= 0 ? of[rn] : -1;
    let tot = 0, nl = 0;
    for(let j=PT.reliefSh0[v];j<PT.reliefSh0[v+1];j++){ const b = PT.reliefShIx[j], bn = PT.boilerNode[b];
      if(bn < 0 || of[bn] !== pv) continue; eBoilerPA(b); tot += Math.max(0, E_BP[0] - back); nl++; }
    if(!nl){ eBook(E_BK_RELIEFROOM, q*dt); continue; }
    for(let j=PT.reliefSh0[v];j<PT.reliefSh0[v+1];j++){ const b = PT.reliefShIx[j], bn = PT.boilerNode[b];
      if(bn < 0 || of[bn] !== pv) continue;
      eBoilerPA(b); sv[b] += q*(tot > 0 ? Math.max(0, E_BP[0] - back)/tot : 1/nl); } }
}
function eShellStep(dt){
  const s = ST, sc = s.sc, M = SX.machSc;
  let boiled = 0, boilQ = 0, bleedAll = 0;
  for(let b=0;b<PT.n.boiler;b++){ s.steamBy[b] = 0; s.sgVentBy[b] = 0; }
  for(let g=0;g<PT.n.sg;g++){ const b = PT.sgBoiler[g];
    if(b < 0 || !(PT.boilerSgKg[b] > 0)) continue;
    eSecPA(g); const shellP = E_SP[0], c = eBoilerSatOf(b);
    E_SG2[0] = shellP; satTA(c, E_SG2, 0, 1); s.sgTBy[b] = E_SG2[1];
    s.sgFedBy[b] = SX.netFeed[b];
    if(!s.sgBurst[g] && shellP > PT.sgDesignP[g]*PIPE_BURST_K){
      s.sgBurst[g] = 1; sc[SC_SGBURSTGEN]++; eEvent(EV_SG_BURST, g, shellP); }
    const open = eSgOpen(g), steamTo = open ? 0 : SX.netSgSteam[b], vent = SX.secVent[b];
    const nd = PT.sgShellNode[g], pn = nd >= 0 ? s.pBy[nd] : E_NAN;
    s.sgPBy[b] = open ? eRegionPart(PT.sgPart[g]) : Math.max(COND_P0, pn === pn ? pn : shellP);
    const cut = Math.min(vent, Math.max(steamTo, 0));
    eBook(E_BK_SGVENT, vent*dt);
    s.steamBy[b] = steamTo; s.sgVentBy[b] = vent;
    eBleedA(b); const avail = Math.max(0, steamTo - cut), bleed = Math.min(E_FH[1], avail);
    E_RC[0] = shellP; eRiseCondA(b);
    bleedAll += bleed; boiled += avail - bleed; boilQ += (avail - bleed)*E_RC[1];
    if(vent > 0 && eWrecked(PT.sgPart[g]) && PT.stageActive[g]){
      const shr = vent/Math.max(steamTo + vent, 1e-9); eContRelA(PT.sgPart[g]);
      sc[SC_RELEASE] = Math.min(100, sc[SC_RELEASE]
        + shr*(Math.max(0, sc[SC_SGTRRATE])/E_SGTR_REL)*0.02*E_RR[RR_CR]*PK[PK_DOSE]*dt); } }
  for(let b=0;b<PT.n.boiler;b++){ if(!PT.boilerDrum[b]) continue;
    eBoilerPA(b); const p = E_BP[0], bn = PT.boilerNode[b];
    E_SG2[0] = p; satTA(eBoilerSatOf(b), E_SG2, 0, 1); s.sgTBy[b] = E_SG2[1];
    s.sgFedBy[b] = SX.netFeed[b];
    let m = 0;
    if(!eWrecked(PT.boilerPart[b])) for(let j=PT.boilerGas0[b];j<PT.boilerGas0[b+1];j++){ const e = PT.boilerGasIx[j];
      m += PT.edU[e] === bn ? s.edgeKg[e] : -s.edgeKg[e]; }
    const steamTo = Math.max(0, m/Math.max(dt, 1e-9));
    s.steamBy[b] = steamTo;
    eBleedA(b); const bleed = Math.min(E_FH[1], steamTo);
    E_RC[0] = p; eRiseCondA(b);
    bleedAll += bleed; boiled += steamTo - bleed; boilQ += (steamTo - bleed)*E_RC[1]; }
  M[E_MS_BLEED] = bleedAll; M[E_MS_BOILED] = boiled; M[E_MS_BOILQ] = boilQ;
}
function eCondVentStep(dt){
  const sc = ST.sc;
  let cv = 0;
  if(sc[SC_CONDLOST]) for(let q=0;q<PT.n.cond;q++) if(PT.condVac[q] && PT.condOut[q] >= 0) cv += eOutKg(PT.condOut[q]);
  sc[SC_CONDVENT] = sc[SC_CONDLOST] ? cv/Math.max(dt, 1e-9) : 0;
  if(sc[SC_CONDVENT] > 0 && !sc[SC_CONDVENTSEEN]){ sc[SC_CONDVENTSEEN] = 1; eEvent(EV_COND_VENTING, sc[SC_CONDVENT], 0); }
}
/* one number for the plant: bypass steam did no work, and what crossed the wheels did it at the pressure the stop valve saw */
function eTurbStep(){
  const s = ST, sc = s.sc, S = SX.netSc;
  sc[SC_TURBWK] = Math.max(0, S[E_NS_TURBWK] - SX.machSc[E_MS_BLEED]);
  if(S[E_NS_TURBWKA] > 0) sc[SC_TURBP] = S[E_NS_TURBWKP]/S[E_NS_TURBWKA]; else { eCondPA(); sc[SC_TURBP] = E_CP[1]; }
  let tt = 0, nt = 0;
  for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q], p = i >= 0 ? s.pBy[i] : E_NAN;
    if(p === p && isFinite(p)) s.condPBy[q] = eWrecked(PT.condPart[q]) ? eRegionPart(PT.condPart[q]) : Math.max(COND_P0, p);
    eCondTReadA(q); const t = E_CQ[8];
    if(t === t && isFinite(t)) s.condTBy[q] = t;
    if(PT.condVac[q] && s.condTBy[q] > 0){ tt += s.condTBy[q]; nt++; } }
  if(nt) sc[SC_CONDT] = tt/nt;
}
/* the panel climbs until its duty falls to nothing on (Tin - Tpanel); nothing radiates below the sky */
function eRadPanelStep(dt){
  const s = ST, sc = s.sc;
  for(let r=0;r<PT.n.rad;r++){ const a = PT.radPart[r], skin = a >= 0 ? s.skinQ[a] : 0;
    eRadRejA(r); const T = s.radTBy[r] + (s.radQBy[r] - E_RJ[0] - skin)/Math.max(1, PT.radCap[r])*dt;
    s.radTBy[r] = T < T_SPACE ? T_SPACE : T; }
  let tt = 0, nt = 0;
  for(let q=0;q<PT.n.cond;q++){ let t = 0, n = 0;
    for(let k=PT.condCw0[q];k<PT.condCw0[q+1];k++){
      const ref = PT.cwRef[k], fwd = (ref > 1e-9 ? eKeyW(PT.cwKey[k])/ref : 0) >= 0;
      const i = fwd ? PT.cwNodeA[k] : PT.cwNodeB[k]; if(i < 0) continue;
      eNodeTA(i); t += E_NT[MX_T]; n++; }
    if(n) s.cwInTBy[q] = t/n;
    if(PT.condVac[q] && s.cwInTBy[q] > 0){ tt += s.cwInTBy[q]; nt++; } }
  if(nt) sc[SC_CWINT] = tt/nt;
}
/* a reserve on the board is metered against its own edge; past full the overflow is gone and booked, never swallowed */
function eSecTankStep(dt){
  const s = ST; let any = PT.n.cond > 0;
  for(let t=0;t<PT.n.tank;t++){ if(!PT.tankSec[t]) continue; any = true;
    s.tankOver[t] = 0;
    if(!PT.tankHasCell[t]) continue;
    const cap = Math.max(1, PT.tankKg[t]), rk = eLanded(PT.tankNode[t])/Math.max(dt, 1e-9);
    const raw = s.tank[t] + 100*rk/cap*dt;
    if(raw > 100) s.tankOver[t] = (raw - 100)/100*cap/Math.max(dt, 1e-9);
    if(!PT.tankInf[t]){ s.tank[t] = clamp(raw, 0, 100); eBook(E_BK_TANKCLAMPSEC, (raw - s.tank[t])/100*cap); }
    else eBook(E_BK_BOUNDARYTANK, rk*dt); }
  if(any) eBook(E_BK_SPILLSEC, s.sc[SC_OUTSEC]);
}

/* the fluid touching a wall cell: the liquid standing there, else the gas */
/* E_MD[0]: MPa across a wall cell, the highest neighbour against the lowest (against nothing when it has one side) */
const E_MD = new Float64Array(1);
function eMatCellDPA(i){
  const s = ST, x = i%GW, y = (i/GW)|0, of = PT.cellRegion;
  let hi = 0, lo = 0, n = 0;
  for(let d=0;d<4;d++){ const X = d === 0 ? x-1 : d === 1 ? x+1 : x, Y = d === 2 ? y-1 : d === 3 ? y+1 : y;
    if(X < 0 || X >= GW || Y < 0 || Y >= GH) continue;
    const j = Y*GW + X; if(of[j] < 0) continue;
    const w = s.roomWater[j] > 0, l = s.roomPool[j] > 0;
    let p = s.roomP[j];
    if(w || l){ p = w ? s.roomWP[j] : s.roomPoolP[j]; if(w && l && s.roomPoolP[j] > p) p = s.roomPoolP[j]; }
    if(n === 0 || p > hi) hi = p; if(n === 0 || p < lo) lo = p; n++; }
  E_MD[0] = !n ? 0 : (n === 1 ? Math.max(0, hi) : hi - lo)/1000;
}
const eMatCellDP = i => { eMatCellDPA(i); return E_MD[0]; };
/* a run lets go at its own wall, one cell; a wall at the weakest cell of its span, and may break again */
function eBurstDice(){
  const s = ST, sc = s.sc, off = sc[SC_DICEOFF];
  for(let u=0;u<PT.n.run;u++){
    const c0 = PT.runCell0[u], c1 = PT.runCell0[u+1]; if(c1 <= c0) continue;
    const i = PT.runNode[u]; if(i < 0) continue;
    const pa = s.pBy[i];
    if(!(pa === pa) || pa <= PT.runBurstP[u]) continue;
    let open = false;
    for(let j=c0;j<c1;j++) if(s.dmgBy[PT.runCellIx[j]]){ open = true; break; }
    if(open) continue;
    const n = c1 - c0;
    let pick = 0; if(!off){ eRandA(); pick = Math.min(n-1, Math.floor(E_RND[0]*n)); }
    const a = PT.runCellIx[c0 + pick];
    if(s.dmgBy[a]) continue;
    eDamage(a, E_WHY_BURST); eEvent(EV_PIPE_BURST, u, pa); }
  const tie = SX.wallTie; let nt = 0, lo = 0;
  for(let m=0;m<PT.nPaint;m++){
    if(!PT.paintTightM[m]) continue;
    const a = PT.paintPart[m]; if(a >= 0 && s.dmgBy[a]) continue;
    eMatCellDPA(PT.paintCell[m]);
    const mg = PT.paintBurstP[m] - E_MD[0];
    if(mg === mg && (!nt || mg < lo - 1e-9)){ lo = mg; nt = 0; tie[nt++] = m; }
    else if(mg < lo + 1e-9) tie[nt++] = m; }
  if(nt && lo <= 0){
    let pick = 0; if(!off){ eRandA(); pick = Math.min(nt-1, Math.floor(E_RND[0]*nt)); }
    const m = tie[pick], a = PT.paintPart[m];
    if(a >= 0){ eDamage(a, E_WHY_BURST); eEvent(EV_WALL_BURST, m, eMatCellDP(PT.paintCell[m])); } }
}

/* how far the fluid in each run has travelled, in diagram pixels: the renderer's packets ride it */
function eFlowSpinStep(dt){
  const s = ST, sc = s.sc, sp = 60*DRAW_K*dt;
  for(let u=0;u<PT.n.run;u++){ const k = PT.runKind[u]; if(k === 0 || k === 3) continue;
    const a = PT.runPa[u], b = PT.runPb[u];
    if((a >= 0 && s.portShut[a]) || (b >= 0 && s.portShut[b])) continue;
    if(k === 1){ let q;
      if(PT.runSteamVent[u]){ q = 0; for(let j=PT.runTap0[u];j<PT.runTap0[u+1];j++) q += s.reliefSteam[PT.runTapIx[j]]; q *= PT.runSteamDir[u]; }
      else q = eRunW(u);
      s.flowPos[u] += sp*1.4*q/PT.runScale[u]; continue; }
    const ref = Math.abs(PT.runRef[u] || 0);
    s.flowPos[u] += sp*(ref > 1e-9 ? eRunW(u)/ref : 0)*1.4; }
  sc[SC_SPINV] = 360*PK[PK_FLOWK]*sc[SC_FLOWNET];
  sc[SC_SPINTV] = 360*Math.min(sc[SC_LOAD], 1.5);
}

/* commissioning's starting point for every machine: demand equal to actual, the designer's start positions */
function eMachSeed(){
  const s = ST, sc = s.sc;
  sc[SC_P] = PK[PK_P0]; sc[SC_TAVG] = PK[PK_TREF]; sc[SC_LVL] = 54; sc[SC_INV] = 100;
  sc[SC_LOAD] = sc[SC_LOADDEM] = Math.min(startOf("loadDem", 1), PK[PK_LOADMAX]);
  sc[SC_ARLO] = PK[PK_ARLO]; sc[SC_ARHI] = PK[PK_ARHI]; sc[SC_DOSERATE] = PK[PK_DOSE]; sc[SC_CWINT] = RAD_TDES;
  for(let ci=0;ci<PT.n.circ;ci++){
    if(PT.circKeyed[ci] && PT.circHold[ci] >= 0) s.PBy[ci] = PT.circSetP[ci];
    if(PT.circCore[ci]) s.TavgBy[ci] = eCircSat(ci).Tref; }
  for(let p=0;p<PT.n.pump;p++){ s.flowBy[p] = s.flowDemBy[p] = PT.pumpStart[p]; s.cavP[p] = 0; s.pumpQBy[p] = PT.pumpRef0[p]; }
  for(let b=0;b<PT.n.boiler;b++){ s.fregBy[b] = s.fregDemBy[b] = 0; }
  for(let g=0;g<PT.n.sg;g++){ s.sgShare[g] = 1/Math.max(1, PT.n.sg); s.sgWastBy[g] = 1; s.sgBurst[g] = 0; }
  for(let v=0;v<PT.n.relief;v++){ s.reliefOpen[v] = s.reliefAuto[v] = s.reliefStuck[v] = s.reliefArm[v] = 0;
    s.reliefBlocked[v] = PT.reliefStart[v]; }
  for(let w=0;w<PT.n.throttle;w++) s.valve[w] = s.valveDem[w] = PT.throttleStart[w];
  for(let t=0;t<PT.n.tank;t++){
    s.tank[t] = PT.tankHasCell[t] ? PT.tankLevel0[t] : 0;
    s.tankOpen[t] = PT.tankStartOpen[t]; s.tankDump[t] = PT.tankStartDump[t]; s.tankByp[t] = PT.tankStartByp[t];
    s.burstBy[t] = 0; s.tankAuto[t] = 0; s.lvlBy[t] = 54; s.holdPBy[t] = PT.tankHoldP[t]; }
  for(let q=0;q<PT.n.cond;q++) s.cwFlowBy[q] = PT.condCwRef[q];
  for(let r=0;r<PT.n.rad;r++) s.radTBy[r] = RAD_TDES;
  eCtlSeed();
}
/* the condenser and panels at rest for the heat this plant rejects at its commissioning power, before the settle walks them */
function eMachRestSeed(){
  const s = ST, sc = s.sc;
  const nb = PT.n.boiler, pc = nb ? satP(eBoilerSatOf(0), RAD_TDES + COND_DT0) : 0;
  let wk = 0;
  for(let b=0;b<nb;b++) wk += eTurbDh(PT.boilerDesP[b], pc);
  const dh = nb ? wk/nb : 0, share = nb ? (1 - bleedFrac())*dh/Math.max(steamRise(), 1) : 0;
  const q = PK[PK_RATED]*PK[PK_N0]*(1 - share)*1000, r = condRest(q);
  for(let k=0;k<PT.n.rad;k++) s.radTBy[k] = r.radT;
  for(let k=0;k<PT.n.rad;k++) s.radQBy[k] = eRadRej(k);
  sc[SC_CWINT] = r.cwIn; sc[SC_CONDT] = r.condT;
  for(let k=0;k<PT.n.cond;k++){ s.cwInTBy[k] = r.cwIn; s.condTBy[k] = r.condT;
    s.condPBy[k] = Math.max(COND_P0, satP(eCircSat(PT.condCirc[k]), r.condT)); }
}
/* what each pump lifts at its commissioned suction, taken off the settled field so the rating point reads 1 */
function eMachPumpRho0(){
  for(let p=0;p<PT.n.pump;p++){ const i = PT.pumpSuc[p]; PT.pumpRho0[p] = i >= 0 ? eNodeRho(i) : 0; }
}
