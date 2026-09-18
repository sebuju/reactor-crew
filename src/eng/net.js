"use strict";
// exports: eNetSolve eNetReadP eNetReadEdges eNetCoreLoop eNetFlowK eNetNat eNetCommitP eNetHold eNetSteady eNetImpose eNetMarching eNetReadOnly eNetScale eNetInvalidate eRegionUpdate eRegionP eRegionPart eNodeP eNodePOf eNodeH eNodeHOf eNodeT eNodeX eNodeRho eNodeSat eCircSat eLoopP eSetLoopP eTavgOf eHoldPOfA eHoldLive eHoldLvlOf ePoolLvl eCondPoolLvl eTankLvl eTankP eTankCap eSecP eCondP eCondPRead eExhOpen eCondDumpOpen eSgtrC eLoopKg ePumpHead eEdgeC eRunCommon eKeyW eRunW eWrecked eNetDryAny ePortLive eSgOpen

const E_NS_TURBWK=0, E_NS_TURBWKP=1, E_NS_TURBWKA=2, E_NS_QSGT=3, E_NS_SPILL=4, E_NS_SPILLSEC=5, E_NS_NAT=6,
      E_NS_CORE=7, E_NS_NPIECE=8, E_NS_NF=9, E_NS_BW=10, E_NS_REFINE=11, E_NS_FACTORS=12, E_NS_N=13;
const E_NAT_PASSES=8, E_NAT_TOL=1e-3, E_NAT_EVERY=25, E_REFINE_MAX=10, E_REFINE_TOL=1e-10;
const E_MIX = new Float64Array(MX_N), E_MIX2 = new Float64Array(MX_N);
let eNetHeldOn = 0, eNetMarchOn = 0, eNetRO = 0, eNetFlowScale = 1, eNetSteadyOn = 0, eNetImp = null;
let eFacBuilt = -1, eOrderOK = 0, ePcGen = 0, eHlGen = 0, eHlKey = -1, eHlPc = -1, eHlWalk = 0, eChokeBit = 0;

const eNetHold = on => { const w = eNetHeldOn; eNetHeldOn = on ? 1 : 0; return w; };
/* commissioning's steady solve: direct factorisation, Newton on the flow law. Never set by the tick */
const eNetSteady = on => { const w = eNetSteadyOn; eNetSteadyOn = on ? 1 : 0;
  if(on && !w) eSteadyP = Float64Array.from(ST.pBy);
  return w; };
/* a gas-charged vessel in the field states its content by its pressure: held, that is the one it entered the solve with */
let eSteadyP = null;
const eFieldTankP = i => eNetSteadyOn ? eSteadyP[i] : ST.pBy[i];
/* kg/s per boiler forced through its feed valve edge (NaN = the valve conducts); commissioning only */
const eNetImpose = w => { eNetImp = w; };
const eImpW = e => { if(PT.edCk[e] !== 4) return E_NAN; const b = PT.edFreg[e];
  return b < 0 ? E_NAN : eNetImp[b]*(PT.edShellSign[e] === -1 ? -1 : 1); };
const eNetMarching = on => { const w = eNetMarchOn; eNetMarchOn = on ? 1 : 0; return w; };
const eNetReadOnly = on => { const w = eNetRO; eNetRO = on ? 1 : 0; return w; };
const eNetScale = v => { const w = eNetFlowScale; eNetFlowScale = v; return w; };
function eNetInvalidate(){ eFacBuilt = -1; eOrderOK = 0; ePcGen = 0; eHlPc = -1; }

const eWrecked = a => a >= 0 && ST.dmgBy[a] !== 0;
const eNetDryAny = () => { let k = 0;
  for(let i=0;i<PT.n.node;i++) if(PT.nodeDryWatch[i] && !SX.fWet[i] && !PT.nodeBooked[i] && !PT.nodeVapour[i]) k++;
  return k; };
const ePortLive = o => o < 0 || !ST.portShut[o] || eWrecked(PT.portPart[o]);
const eSgOpen = g => ST.sgBurst[g] !== 0 || eWrecked(PT.sgPart[g]);
const eNodeSat = i => PT.sats[PT.nodeSat[i]];
const eCircSat = ci => PT.sats[ci >= 0 ? PT.circSat[ci] : PT.satWater];
const eLoopKg = () => PK[PK_INVKG0] > 0 ? PK[PK_INVKG0] : PK[PK_LOOPKGFB];
const eSgtrC = () => (SGTR_RATE/100)*eLoopKg()/PK[PK_SGTRDEN];

function eRegionUpdate(){
  const m = SX.regPMean, c = SX.regCnt, of = PT.cellRegion, rp = ST.roomP, cp = SX.cellP, P0 = PK[PK_PCONT];
  m.fill(0); c.fill(0);
  for(let i=0;i<of.length;i++){ const r = of[i]; if(r < 0) continue; m[r] += rp[i]; c[r]++; }
  for(let r=0;r<m.length;r++) if(c[r] > 0) m[r] /= c[r];
  for(let i=0;i<of.length;i++){ const r = of[i]; cp[i] = r < 0 ? P0 : P0 + m[r]/1000; }
}
const eRegionP = cell => cell < 0 ? PK[PK_PCONT] : SX.cellP[cell];
const eRegionPart = a => eRegionP(a >= 0 ? PT.partCell[a] : -1);

/* a double crossing a call that is not inlined is a heap allocation: every reader writes its answer into its own register (E_*[0]) and a one-line wrapper returns it */
const E_LP = new Float64Array(1);
function eLoopPA(ci){
  if(ci >= 0 && PT.circKeyed[ci] && ST.PBy[ci] > 0){ E_LP[0] = ST.PBy[ci]; return; }
  if(ci === PT.coreCirc0){ E_LP[0] = ST.sc[SC_P] > 0 ? ST.sc[SC_P] : PK[PK_P0]; return; }
  E_LP[0] = (ci >= 0 && PT.circCore[ci]) ? eCircSat(ci).p0 : PK[PK_PCONT];
}
const eLoopP = ci => { eLoopPA(ci); return E_LP[0]; };
function eSetLoopP(ci, v){
  if(ci >= 0 && PT.circKeyed[ci]) ST.PBy[ci] = v;
  if(ci === PT.coreCirc0) ST.sc[SC_P] = v;
}
const E_TA = new Float64Array(1);
function eTavgA(ci){
  if(ci >= 0 && PT.circKeyed[ci] && ST.TavgBy[ci] > 0){ E_TA[0] = ST.TavgBy[ci]; return; }
  if(ci === PT.coreCirc0 && ST.sc[SC_TAVG] > 0){ E_TA[0] = ST.sc[SC_TAVG]; return; }
  const c = eCircSat(ci); E_TA[0] = c.Tref !== undefined ? c.Tref : PK[PK_TREF];
}
const eTavgOf = ci => { eTavgA(ci); return E_TA[0]; };
function eNodePStruct(i){
  const ci = PT.nodeCirc[i], sp = ci >= 0 ? PT.circSetP[ci] : PK[PK_PCONT];
  SX.pStr[i] = Math.max(COND_P0, sp > 0 ? sp : (ST.sc[SC_P] > 0 ? ST.sc[SC_P] : PK[PK_P0]));
}
/* E_NP[0]: a node's pressure off field pA, structural where the field has none */
const E_NP = new Float64Array(1);
function eNodePOfA(pA, i){ const v = pA[i]; if(v === v){ E_NP[0] = Math.max(COND_P0, v); return; } eNodePStruct(i); E_NP[0] = SX.pStr[i]; }
const eNodePOf = (pA, i) => { eNodePOfA(pA, i); return E_NP[0]; };
const eNodeP = i => { eNodePOfA(ST.pBy, i); return E_NP[0]; };
const E_NH = new Float64Array(1);
function eNodeHOfA(pA, i){ const h = ST.hBy[i]; if(h === h){ E_NH[0] = h; return; } eNodeHStruct(pA, i); E_NH[0] = SX.hStr[i]; }
const eNodeHOf = (pA, i) => { eNodeHOfA(pA, i); return E_NH[0]; };
const E_HS = new Float64Array(4);
function eNodeHStruct(pA, i){
  const c = eNodeSat(i), ci = PT.nodeCirc[i], io = E_HS;
  if(ci >= 0 && PT.circAuth[ci]){ eTavgA(ci); io[0] = E_TA[0]; hOfTA(c, io, 0, 1); SX.hStr[i] = io[1]; return; }
  eNodePOfA(pA, i); io[0] = E_NP[0];
  if(PT.nodeVapour[i]) satHgA(c, io, 0, 1); else { satTA(c, io, 0, 2); hOfTA(c, io, 2, 1); }
  SX.hStr[i] = io[1];
}
const eNodeH = i => { eNodeHOfA(ST.pBy, i); return E_NH[0]; };
/* E_NT out: [MX_T] the node's temperature, [MX_TS] its saturation; [MX_P], [MX_H] its state */
const E_NT = new Float64Array(MX_N);
function eNodeTA(i){ const io = E_NT; eNodePOfA(ST.pBy, i); io[MX_P] = E_NP[0]; eNodeHOfA(ST.pBy, i); io[MX_H] = E_NH[0]; tOfHA(eNodeSat(i), io); }
const eNodeT = i => { eNodeTA(i); return E_NT[MX_T]; };
const eNodeX = i => { eNodeTA(i); xOfHA(eNodeSat(i), E_NT); return E_NT[MX_X]; };
function eNodeMixA(i){ const io = E_MIX2; eNodePOfA(ST.pBy, i); io[MX_P] = E_NP[0]; eNodeHOfA(ST.pBy, i); io[MX_H] = E_NH[0]; mixA(eNodeSat(i), io); }
const eNodeRho = i => { eNodeMixA(i); return E_MIX2[MX_RHO]; };

/* E_PL: [MX_P] pressure in, [MX_X] level % out (NaN = no mass carried), [MX_RFS] the saturated liquid density used */
const E_PL = new Float64Array(MX_N);
function ePoolLvlA(i){
  const io = E_PL, m = ST.mBy[i];
  if(!(m === m)){ io[MX_X] = E_NAN; return; }
  const c = eNodeSat(i); satTA(c, io, MX_P, MX_TS); curveA(c, CV_RF, io, MX_TS, MX_RFS);
  const l = 100*m/Math.max(PT.nodeVol[i]*io[MX_RFS], 1e-9);
  io[MX_X] = l < 0 ? 0 : l > 100 ? 100 : l;
}
const ePoolLvlAt = (i, p) => { E_PL[MX_P] = p; ePoolLvlA(i); return E_PL[MX_X]; };
const ePoolLvl = i => ePoolLvlAt(i, eNodeP(i));
const E_CPL = new Float64Array(1);
function eCondPoolLvlA(){
  let v = 0, f = 0;
  for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q]; if(i < 0) continue;
    eNodePOfA(ST.pBy, i); E_PL[MX_P] = E_NP[0]; ePoolLvlA(i); const l = E_PL[MX_X]; if(!(l === l)) continue;
    v += PT.nodeVol[i]; f += PT.nodeVol[i]*l; }
  E_CPL[0] = v > 0 ? f/v : E_NAN;
}
const eCondPoolLvl = () => { eCondPoolLvlA(); return E_CPL[0]; };
function ePoolHA(i){
  E_EC[4] = 0;
  const q = PT.nodeCondV[i]; if(q < 0) return;
  E_PL[MX_P] = SX.fP[i]; ePoolLvlA(i);
  const l = E_PL[MX_X]; if(!(l === l)) return;
  const f = Math.min(1, Math.max(0, l/Math.max(PK[PK_CONDFILL0], 1)));
  E_EC[4] = E_PL[MX_RFS]*G_MPA*PT.condPoolH[q]*f;
}
/* E_HL out: [MX_T] the level %, the liquid's share of the node's volume */
const E_HL = new Float64Array(MX_N);
function eHoldLvlA(i){
  const io = E_HL, c = eNodeSat(i);
  eNodePOfA(ST.pBy, i); io[MX_P] = E_NP[0]; eNodeHOfA(ST.pBy, i); io[MX_H] = E_NH[0]; xOfHA(c, io);
  curveA(c, CV_RG, io, MX_TS, MX_RGS); curveA(c, CV_RF, io, MX_TS, MX_RFS);
  let x = io[MX_X]; x = x < 0 ? 0 : x > 1 ? 1 : x;
  const vg = x/Math.max(io[MX_RGS], 1e-9), vf = (1-x)/Math.max(io[MX_RFS], 1e-9);
  io[MX_T] = 100*vf/Math.max(vf+vg, 1e-12);
}
const eHoldLvlOf = i => { eHoldLvlA(i); return E_HL[MX_T]; };

const E_TL = new Float64Array(1);
function eTankLvlA(t){
  if(PT.tankHold[t]){ E_TL[0] = ST.lvlBy[t]; return; }
  if(PT.tankInField[t]){
    const i = PT.tankNode[t], V = PT.tankVol[t], V0 = V*PT.tankVoid[t];
    if(!(V0 > 0) || !PT.tankGas[t]){ if(i >= 0){ eHoldLvlA(i); E_TL[0] = E_HL[MX_T]; } else E_TL[0] = PT.tankLevel0[t]; return; }
    const pv = i >= 0 ? eFieldTankP(i) : E_NAN;
    if(!(pv === pv)){ const l = PT.tankLevel0[t]; E_TL[0] = l < 0 ? 0 : l > 100 ? 100 : l; return; }
    E_TL[0] = 100*(1 - Math.min(V, V0*PT.tankGasP0[t]/Math.max(COND_P0, pv))/Math.max(V, 1e-9));
    return;
  }
  if(!PT.tankHasCell[t]){ eCondPoolLvlA(); const v = E_CPL[0]; if(v === v){ E_TL[0] = v; return; } }
  E_TL[0] = ST.tank[t];
}
const eTankLvl = t => { eTankLvlA(t); return E_TL[0]; };
const E_HP = new Float64Array(1);
function eHoldPOfA(t){ if(ST.holdPBy[t] > 0) E_HP[0] = ST.holdPBy[t]; else { eLoopPA(PT.tankCirc[t]); E_HP[0] = E_LP[0]; } }
const E_TP = new Float64Array(1);
function eTankPA(t){
  const ci = PT.tankCirc[t];
  if(PT.tankHold[t] && eHoldLive(ci)){ eLoopPA(ci); E_TP[0] = E_LP[0]; return; }
  if(PT.tankInField[t]){ const i = PT.tankNode[t];
    if(i >= 0){ const v = eFieldTankP(i); if(v === v){ E_TP[0] = Math.max(COND_P0, v); return; } } }
  const vf = PT.tankVoid[t];
  const frac = PT.tankGas[t] ? vf : PT.tankHold[t] ? Math.max(0.01, vf) : 0;
  const p0 = PT.tankGas[t] ? PT.tankGasP0[t] : PT.tankHold[t] ? (ci >= 0 ? PT.circSetP[ci] : PK[PK_PCONT]) : 0;
  const a = PT.tankPart[t], ca = a >= 0 ? PT.partCell[a] : -1, reg = ca < 0 ? PK[PK_PCONT] : SX.cellP[ca];
  if(!(frac > 0)){ E_TP[0] = Math.max(reg, p0); return; }
  eTankLvlA(t); let l = E_TL[0]; l = l < 0 ? 0 : l > 100 ? 100 : l;
  E_TP[0] = Math.max(reg, p0*frac/Math.max(0.01, frac + (PT.tankLevel0[t] - l)/100));
}
const eTankP = t => { eTankPA(t); return E_TP[0]; };
const E_TC = new Float64Array(1);
function eTankCapA(t){
  if(!PT.tankStores[t]){ E_TC[0] = 0; return; }
  eTankPA(t);
  const a = PT.tankPart[t], ca = a >= 0 ? PT.partCell[a] : -1, p = Math.max(E_TP[0], ca < 0 ? PK[PK_PCONT] : SX.cellP[ca]);
  E_TC[0] = PT.tankKg[t]*PT.tankVoid[t]*PT.tankGasP0[t]/(p*p);
}
const eTankCap = t => { eTankCapA(t); return E_TC[0]; };

const E_SP = new Float64Array(1);
function eSecPA(g){
  if(eSgOpen(g)){ const a = PT.sgPart[g], ca = a >= 0 ? PT.partCell[a] : -1; E_SP[0] = ca < 0 ? PK[PK_PCONT] : SX.cellP[ca]; return; }
  const b = PT.sgBoiler[g], v = b >= 0 ? ST.sgPBy[b] : 0;
  if(v > 0){ E_SP[0] = Math.max(COND_P0, v); return; }
  const l = ST.sc[SC_LOAD], n = PT.n.sg, ld = n > 0 ? l*n*ST.sgShare[g] : l;
  E_SP[0] = PT.sgDesignP[g]*Math.pow(Math.max(ld, 0.05), 0.25);
}
const eSecP = g => { eSecPA(g); return E_SP[0]; };
function eExhOpen(){
  const a = PT.exhParts;
  for(let k=0;k<a.length;k++) if(ST.dmgBy[a[k]]) return true;
  return false;
}
function eCondDumpOpen(){
  const h = PT.hostedTanks;
  for(let k=0;k<h.length;k++) if(ST.tankDump[h[k]]) return true;
  return false;
}
const E_CP = new Float64Array(2);
function eCondPReadA(){
  let p = 0, n = 0;
  for(let q=0;q<PT.n.cond;q++){ if(!PT.condVac[q]) continue;
    const v = ST.condPBy[q]; if(v > 0 && isFinite(v)){ p += v; n++; } }
  if(n){ E_CP[1] = Math.max(COND_P0, p/n); return; }
  const T = ST.sc[SC_CONDT], w = PT.sats[PT.satWater], io = E_CP;
  io[0] = T > 0 ? T : RAD_TDES + COND_DT0; curveA(w, CV_SP, io, 0, 1);
  if(T > 0) io[1] = Math.max(COND_P0, io[1]);
}
const eCondPRead = () => { eCondPReadA(); return E_CP[1]; };
function eCondPA(){
  eCondPReadA();
  E_CP[1] = Math.max(eExhOpen() ? (PT.condRoleCell < 0 ? PK[PK_PCONT] : SX.cellP[PT.condRoleCell]) : 0, ST.sc[SC_CONDLOST] ? COND_ATM : 0, E_CP[1]);
}
const eCondP = () => { eCondPA(); return E_CP[1]; };

/* register E_EC: [0] conductance, [1] pump head, [2] static head, [3] an end's elevation, [4] a hotwell's pool head */
const E_EC = new Float64Array(7), E_PC = new Float64Array(PC_N);
function ePumpHeadA(p){
  E_EC[1] = 0;
  if(eWrecked(PT.pumpPart[p])) return;
  const N = ST.flowBy[p]*eNetFlowScale;
  let rk = 1;
  if(!eNetHeldOn){ const r0 = PT.pumpRho0[p], si = PT.pumpSuc[p];
    if(r0 > 0 && si >= 0){ const r = SX.fRho[si]; rk = (isFinite(r) && r > 0) ? r/r0 : 0; } }
  E_EC[1] = PT.pumpHead0[p]*N*N*(1 + PUMP_DROOP)*(1 - CAV_DERATE*ST.cavP[p])*rk;
}
const ePumpHead = p => { ePumpHeadA(p); return E_EC[1]; };

/* the one momentum law: an edge states C = A/sqrt(K), linearised as g = w/|dp| about last solve's field */
function ePipeCA(e){
  const io = E_PC, w = ST.edW[e], mu = SX.fMu[w >= 0 ? PT.edU[e] : PT.edV[e]];
  io[PC_BORE] = PT.edBore[e]; io[PC_L] = PT.edLen[e]; io[PC_K0] = PT.edK0[e] || 0;
  if(ST.edWHas[e] && mu > 0){ io[PC_W] = w; io[PC_MU] = mu; fricA(io); } else io[PC_F] = PIPE_FRIC;
  pipeCA(io); E_EC[0] = io[PC_C];
}
function eEdgeCA(e){
  E_EC[0] = 0;
  const dead = PT.edDead[e];
  if(dead >= 0 && ST.dmgBy[dead]) return;
  switch(PT.edCk[e]){
    case 0: E_EC[0] = PT.edC0[e]; return;
    case 1: if(ST.tankLive[PT.edTank[e]] && ePortLive(PT.edEndPort[e])) ePipeCA(e); return;
    case 2: if(ePortLive(PT.edEndPort[e])) ePipeCA(e); return;
    case 3: { const w = PT.edThrottle[e];
      if(w >= 0){ const x = ST.valve[w];
        if(x > 0){ const io = E_PC; io[PC_BORE] = PT.edBore[e]; io[PC_L] = NET_COMP_LEN + valveLeq(x); io[PC_K0] = 0; io[PC_F] = PIPE_FRIC;
          pipeCA(io); E_EC[0] = io[PC_C]; }
        return; }
      const v = PT.edRelief[e];
      if(v >= 0 && ST.reliefOpen[v] && !ST.reliefBlocked[v]) E_EC[0] = holeC(PT.edBore[e]);
      return; }
    case 4: { const b = PT.edFreg[e], f = b >= 0 ? ST.fregBy[b] : 0;
      E_EC[0] = PK[PK_FEEDC]*(1 - (f < 0 ? 0 : f > 1 ? 1 : f)); return; }
    case 5: { const b = PT.edTurb[e];
      if(b < 0 || eWrecked(PT.turbPart[b])) return;
      const x = ST.turbGate[b]; E_EC[0] = PK[PK_TURBC]*(x > 0 ? x : 0); return; }
    case 6: { if(!eWrecked(PT.edPart[e])) return;
      const g = PT.edSg[e], w = g >= 0 ? ST.sgWastBy[g] : 0;
      E_EC[0] = eSgtrC()*(w > 0 ? w : 1); return; }
    case 7: case 8: if(eWrecked(PT.edPart[e])) E_EC[0] = PT.edHC[e]; return;
    case 9: { const g = PT.edSg[e];
      if((g >= 0 && ST.sgBurst[g]) || eWrecked(PT.edPart[e])) E_EC[0] = PK[PK_HOLEBREACH]; return; }
    case 10: { const q = PT.edCond[e];
      if(eWrecked(PT.edPart[e])){ E_EC[0] = PK[PK_HOLEBREACH]; return; }
      if(ST.sc[SC_CONDLOST] && q >= 0 && PT.condVac[q]){ E_EC[0] = PT.condVentHC[q]; return; }
      if(eCondDumpOpen()) E_EC[0] = PK[PK_CONDDUMPC]; return; }
    case 11: { const c = PT.edCore[e];
      if(c >= 0 ? ST.csBreach[c] : ST.sc[SC_BREACH]) E_EC[0] = PK[PK_HOLEBREACH]; return; }
    case 12: if(eWrecked(PT.edPart[e])) E_EC[0] = PK[PK_HOLEBREACH]; return;
    case 13: { const c = PT.edCore[e], o = c >= 0 ? ST.csTubesOpen[c] : 0;
      if(o > 0) E_EC[0] = o*PT.edCavN[e]*PT.edCavOne[e]; return; }
    case 14: { const c = PT.edCore[e]; if(c < 0) return;
      E_EC[0] = ST.csBreach[c] ? PK[PK_HOLEBREACH] : ST.csCavRelief[c] ? PT.edCavRelief[e] : 0; return; }
    case 15: { const t = PT.edTank[e];
      E_EC[0] = eWrecked(PT.edPart[e]) ? PK[PK_HOLEBREACH] : (t >= 0 && ST.burstBy[t]) ? PT.tankDiscC[t] : 0; return; }
  }
}
const eEdgeC = e => { eEdgeCA(e); return E_EC[0]; };
function eRhoEndA(e, i, k){
  const F = SX;
  E_EC[k] = PT.edGasAt[e] === i && (F.fX[i] > 0 || F.fVoid[i]) ? F.fRhoG[i]
    : PT.edLiqAt[e] === i && F.fX[i] > 0 ? F.fRhoL[i] : F.fRho[i];
}
/* a drawn vessel's pressure is its gas's, so its water stands from the free surface, or from the nozzle when the nozzle is above it */
function eEndZA(e, i){
  const t = PT.nodeTank[i];
  if(t < 0 || !PT.tankSurf[t]){ E_EC[3] = PT.nodeZ[i]; return; }
  eTankLvlA(t); let l = E_TL[0]; l = l < 0 ? 0 : l > 100 ? 100 : l;
  const zs = PT.tankZb[t] + PT.tankHgt[t]*l/100, zn = PT.edZn[e];
  E_EC[3] = zn === zn && zn > zs ? zn : zs;
}
function eStaticHA(e){
  const u = PT.edU[e], v = PT.edV[e];
  eEndZA(e, u); const zu = E_EC[3]; eEndZA(e, v);
  const dz = zu - E_EC[3];
  let h = 0;
  if(dz !== 0){ eRhoEndA(e, u, 5); eRhoEndA(e, v, 6); h = (E_EC[5] + E_EC[6])/2*G_MPA*dz; }
  const pa = PT.edPoolAt[e];
  if(pa >= 0){ ePoolHA(pa); h += (pa === u ? 1 : -1)*E_EC[4]; }
  E_EC[2] = h;
}
/* register FG_: C, head and pump head in, g out; the discharge law's p0, pd, |dp| in and drop out; the donor density out */
const FG_C=0, FG_H=1, FG_HSRC=2, FG_G=3, FG_P0=4, FG_PD=5, FG_A=6, FG_Q=7, FG_RHO=8, FG_N=9;
const E_FG = new Float64Array(FG_N);
const E_CD = new Float64Array(MX_N);
function eFlowGA(e){
  const C = E_FG[FG_C], h = E_FG[FG_H], hSrc = E_FG[FG_HSRC];
  eChokeBit = 0; E_FG[FG_G] = 0;
  if(!(C > 0)) return;
  const F = SX, u = PT.edU[e], v = PT.edV[e];
  const d = F.fP[u] - F.fP[v] + h, a = Math.abs(d), up = d >= 0 ? u : v;
  const pHi = Math.max(F.fP[u], F.fP[v], 1e-4), floor = DPFRAC*pHi, act = Math.max(a, floor);
  if(!F.fWet[up]) return;
  const dio = PT.edDiode[e];
  if(dio !== 0 && d*dio < 0) return;
  const gasEnd = PT.edGasAt[e] === up && (F.fX[up] > 0 || F.fVoid[up]);
  const liqEnd = !gasEnd && PT.edLiqAt[e] === up && F.fX[up] > 0;
  const rho = gasEnd ? F.fRhoG[up] : liqEnd ? F.fRhoL[up] : F.fRhoD[up];
  const ca = PT.edChoke[e];
  let eff = a;
  if(!hSrc && (ca < 0 || up === ca)){ E_FG[FG_P0] = F.fP[up] + (up === u ? h : -h); E_FG[FG_PD] = E_FG[FG_P0] - a; E_FG[FG_A] = a;
    eCritDpA(up, gasEnd, liqEnd); eff = E_FG[FG_Q]; }
  eff = Math.max(eff, floor);
  const r = Math.max(rho, 1e-3);
  E_FG[FG_RHO] = r;
  E_FG[FG_G] = C*Math.sqrt(2*r*eff*1e6)/act;
}
const eFlowG = (C, e, h, hSrc) => { E_FG[FG_C] = C; E_FG[FG_H] = h; E_FG[FG_HSRC] = hSrc; eFlowGA(e); return E_FG[FG_G]; };
/* compressible and flashing discharge as a Bernoulli-equivalent drop: ideal gas for vapour, Leung's omega for a saturated mixture, liquid to its own saturation pressure then omega */
function eCritDpA(up, gasEnd, liqEnd){
  const F = SX, c = eNodeSat(up), p0 = E_FG[FG_P0], a = E_FG[FG_A], D = DQ;
  E_FG[FG_Q] = a;
  if(!(p0 > 0)) return;
  const pd = E_FG[FG_PD] > 0 ? E_FG[FG_PD] : 0;
  const io = E_CD; io[MX_H] = F.fLh[up]; tLiqA(c, io);
  if(gasEnd || F.fB[up] === 2 || io[MX_TL] >= c.tc){
    D[DQ_W] = c.gam || GAM_VAP; D[DQ_P0] = p0; D[DQ_PD] = pd; gasDpA(D);
    E_FG[FG_Q] = D[DQ_OUT]; eChokeBit = D[DQ_OUT] < a*(1 - 1e-9) ? 1 : 0; return; }
  const x = liqEnd ? 0 : F.fX[up];
  if(x > 0){ D[DQ_P0] = p0; D[DQ_X] = x; omegaA(c, D); D[DQ_PD] = pd; omegaDpA(D);
    E_FG[FG_Q] = D[DQ_OUT]; eChokeBit = D[DQ_OUT] < a*(1 - 1e-9) ? 1 : 0; return; }
  curveA(c, CV_SP, io, MX_TL, MX_DH);
  const ps = io[MX_DH];
  if(!(pd < ps)) return;
  const pf = ps < p0 ? ps : p0;
  D[DQ_P0] = pf; D[DQ_X] = 0; omegaA(c, D); D[DQ_PD] = pd; omegaDpA(D);
  const q = (p0 - pf) + D[DQ_OUT];
  E_FG[FG_Q] = q; eChokeBit = q < a*(1 - 1e-9) ? 1 : 0;
}
/* g and the driving head of one edge; inertance only inside a march, as I/dt about last solve's flow */
function eEdgeGH(e){
  if(eNetImp && eImpW(e) === eImpW(e)){ SX.edChoke[e] = 0; SX.gG[e] = 0; SX.gH[e] = 0; return; }
  eEdgeCA(e);
  const C = E_EC[0];
  let g = 0, H = 0;
  eChokeBit = 0;
  if(C > 0){
    const p = PT.edPump[e];
    if(p >= 0) ePumpHeadA(p); else E_EC[1] = 0;
    const hp = E_EC[1];
    eStaticHA(e);
    const h = (hp + E_EC[2])*PK[PK_HEADK];
    E_FG[FG_C] = C; E_FG[FG_H] = h; E_FG[FG_HSRC] = hp*PK[PK_HEADK]; eFlowGA(e); g = E_FG[FG_G];
    /* with inertia the drop across an edge is not its friction drop, so friction is linearised on the flow */
    if(eNetMarchOn && g > 0 && !eChokeBit && ST.edWHas[e]){ const w0 = Math.abs(ST.edW[e]); if(w0 > 0) g = 2*E_FG[FG_RHO]*C*C*1e6/w0; }
    const In = eNetMarchOn ? PT.edI[e]/NET_DT/1e6 : 0;
    if(g > 0) g = g/(1 + g*In);
    H = h + In*(ST.edWHas[e] ? ST.edW[e] : 0);
    /* w ~ sqrt(dp): the tangent is half the secant, and half the last solve's flow rides as a head, so a leg the topology holds still keeps its column */
    if(eNetSteadyOn && g > 0 && p < 0 && ST.edWHas[e]){ H = h + ST.edW[e]/g; g /= 2; }
  }
  SX.edChoke[e] = (g > 0 && eChokeBit) ? 1 : 0;
  SX.gG[e] = g; SX.gH[e] = H;
}
function eNetField(pA){
  const n = PT.n.node, E = PT.n.edge, F = SX, fed = F.fedIn;
  fed.fill(0);
  for(let e=0;e<E;e++){ const w = ST.edW[e];
    if(w > 0) fed[PT.edV[e]] += w; else if(w < 0) fed[PT.edU[e]] -= w; }
  for(let i=0;i<n;i++){
    eNodePOfA(pA, i); const p = E_NP[0]; eNodeHOfA(pA, i); const h = E_NH[0], c = eNodeSat(i);
    const m = ST.mBy[i], mk = m === m ? m : -1, V = PT.nodeVol[i];
    if(!(p === F.fLp[i] && h === F.fLh[i] && mk === F.fLm[i])){
      F.fLp[i] = p; F.fLh[i] = h; F.fLm[i] = mk;
      const io = E_MIX;
      io[MX_P] = p; io[MX_H] = h; mixA(c, io); muLiqA(c, io); satRhoA(c, io);
      F.fP[i] = p; F.fRho[i] = io[MX_RHO]; F.fX[i] = io[MX_X]; F.fB[i] = io[MX_B];
      F.fTs[i] = io[MX_TS]; F.fRfs[i] = io[MX_RFS]; F.fRgs[i] = io[MX_RGS];
      const xv = io[MX_X], mf = io[MX_MU], mg = c.muV || c.mu;
      F.fMu[i] = xv <= 0 ? mf : xv >= 1 ? mg : 1/(xv/mg + (1-xv)/mf);
    }
    F.fRhoD[i] = (!eNetSteadyOn && m === m && V > 0 && PT.nodeRun[i] >= 0) ? m/V : F.fRho[i];
    const eos = V*F.fRho[i];
    const dry = m === m && eos > DRY_MIN_KG && m <= DRY_FRAC*eos;
    F.fWet[i] = (dry && fed[i]*NET_DT <= DRY_FRAC*eos) ? 0 : 1;
    if(PT.nodeGas[i]) F.fRhoG[i] = F.fRgs[i];
    if(PT.nodeLiq[i]) F.fRhoL[i] = F.fRfs[i];
    F.fVoid[i] = 0;
    const q = PT.nodeCondV[i];
    if(q >= 0){ E_PL[MX_P] = F.fP[i]; ePoolLvlA(i); const l = E_PL[MX_X];
      if(l === l && l < 100) F.fVoid[i] = 1;
      if(l === l && l > 0) F.fRhoD[i] = F.fRfs[i]; }
    if(PT.nodeCont[i]) F.fWet[i] = 0;
  }
}

/* E_DD = [p, h, rho, branch] in, drho/dp out at [4]; doubles cross the call in the array, never as arguments */
const E_DD = new Float64Array(5);
/* differenced on the node's own branch: across the shelf edge the two slopes are orders apart */
function eDrhoDp(c){
  const p = E_DD[0], h = E_DD[1], r0 = E_DD[2], b0 = E_DD[3], dp = Math.max(1e-4, p*1e-3);
  let p1 = p + dp;
  E_MIX2[MX_P] = p1; E_MIX2[MX_H] = h; mixA(c, E_MIX2); let r1 = E_MIX2[MX_RHO];
  if(E_MIX2[MX_B] !== b0){ const p2 = p - dp;
    if(p2 > 0){ E_MIX2[MX_P] = p2; E_MIX2[MX_H] = h; mixA(c, E_MIX2);
      if(E_MIX2[MX_B] === b0){ p1 = p2; r1 = E_MIX2[MX_RHO]; }
      else { E_MIX2[MX_P] = p1; E_MIX2[MX_H] = h; mixA(c, E_MIX2); r1 = E_MIX2[MX_RHO]; } } }
  E_DD[4] = (r1 - r0)/(p1 - p);
}
/* node i's state point p* (Newton onto rho(p,h) = m/V) and its compliance, off the field and SX.stKm[i] */
function eStoreFit(i){
  const F = SX, V = PT.nodeVol[i], rF = F.fRho[i], h = F.fLh[i], pF = F.fP[i], m = F.stKm[i];
  const mEos = Math.max(V*rF, DRY_MIN_KG), c = eNodeSat(i), rhoT = m/V;
  E_MIX[MX_P] = pF; E_MIX[MX_H] = h; mixA(c, E_MIX);
  const bF = E_MIX[MX_B];
  let p = pF;
  if(V > 0){
    if(!isFinite(rhoT) || rhoT <= 0) p = COND_P0;
    else { p = pF < COND_P0 ? COND_P0 : pF > NET_PMAX ? NET_PMAX : pF;
      let lo = COND_P0, hi = NET_PMAX;
      for(let k=0;k<40;k++){
        let r, b;
        if(k === 0 && p === pF){ r = rF; b = bF; }
        else { E_MIX[MX_P] = p; E_MIX[MX_H] = h; mixA(c, E_MIX); r = E_MIX[MX_RHO]; b = E_MIX[MX_B]; }
        if(Math.abs(r - rhoT) <= 1e-6*rhoT) break;
        if(r < rhoT) lo = p; else hi = p;
        E_DD[0] = p; E_DD[1] = h; E_DD[2] = r; E_DD[3] = b; eDrhoDp(c);
        const d = E_DD[4], nxt = d > 0 ? p - (r - rhoT)/d : (lo + hi)/2;
        p = (nxt > lo && nxt < hi) ? nxt : (lo + hi)/2;
      } } }
  E_DD[0] = p; E_DD[1] = h;
  if(p === pF){ E_DD[2] = rF; E_DD[3] = bF; }
  else { E_MIX[MX_P] = p; E_MIX[MX_H] = h; mixA(c, E_MIX); E_DD[2] = E_MIX[MX_RHO]; E_DD[3] = E_MIX[MX_B]; }
  eDrhoDp(c);
  const xr = F.fX[i], xq = xr < 0 ? 0 : xr > 1 ? 1 : xr, gk = 1/Math.max(p, COND_P0);
  E_MIX[MX_H] = h; tLiqA(c, E_MIX); kapA(c, E_MIX); const kf = E_MIX[MX_KAP];
  F.stP0[i] = p; F.stC[i] = Math.max(V*E_DD[4], mEos*(xq*gk + (1-xq)*Math.min(gk, kf)));
}
/* the residual is the equation of state: one Newton step onto rho(p,h) = m/V taken through the matrix */
function eNetStore(){
  const n = PT.n.node, F = SX, cap = F.stCap, src = F.stSrc, pin = F.stPin;
  cap.fill(0); src.fill(0); pin.fill(0);
  if(!eNetHeldOn) for(let i=0;i<n;i++){
    const V = PT.nodeVol[i], rF = F.fRho[i], mEos = Math.max(V*rF, DRY_MIN_KG);
    const m0 = ST.mBy[i], m = m0 === m0 ? m0 : mEos, hN = F.fLh[i], pF = F.fP[i];
    if(!(pF === F.stKp[i] && hN === F.stKh[i] && m === F.stKm[i])){
      F.stKp[i] = pF; F.stKh[i] = hN; F.stKm[i] = m; eStoreFit(i); }
    const p0 = F.stP0[i], C = F.stC[i];
    if(!(C > 0) || !isFinite(C) || !isFinite(p0) || !isFinite(m)) continue;
    cap[i] = C/NET_DT; src[i] = cap[i]*p0;
  }
  const nt = PT.n.tank;
  if(!eNetHeldOn) for(let t=0;t<nt;t++){ const i = PT.tankNode[t];
    if(i >= 0 && (PT.tankHold[t] || PT.tankDrum[t]) && cap[i] > 0) pin[i] = 1; }
  for(let t=0;t<nt;t++){ const i = PT.tankNode[t]; if(i < 0) continue;
    eTankCapA(t); const C = E_TC[0]; if(!(C > 0) || !isFinite(C)) continue;
    eTankPA(t); const p0 = E_TP[0]; if(!isFinite(p0)) continue;
    cap[i] = C/NET_DT; src[i] = cap[i]*p0; pin[i] = 1; }
  if(!eNetHeldOn) for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q];
    if(i < 0 || eWrecked(PT.condPart[q]) || !PT.condVac[q]) continue;
    const C = ST.condStC[q], w = ST.condStW[q], p0 = ST.condStP[q];
    if(!(C > 0) || !isFinite(C) || !isFinite(w) || !isFinite(p0)) continue;
    cap[i] = C/NET_DT; src[i] = cap[i]*p0 + w; pin[i] = 1; }
}

/* somewhere the water can go, asked structurally: containment, a vessel keeping its own book, and while held every pinned vessel */
function eBound(i){
  if(PT.nodeCont[i]) return true;
  const t = PT.nodeTank[i];
  if(t >= 0 && !PT.tankHold[t] && !PT.tankInField[t]) return true;
  if(!eNetHeldOn) return false;
  if(t >= 0 && (PT.tankHold[t] || PT.tankDrum[t])) return true;
  if(PT.nodeSg[i] >= 0) return true;
  const q = PT.nodeCondV[i];
  return q >= 0 && PT.condVac[q] === 1;
}
function eNetPieces(){
  const n = PT.n.node, of = SX.pcOf, st = SX.pcStack, lv = SX.gLive, as = PT.adjStart, ae = PT.adjEdge, ao = PT.adjOther;
  of.fill(-1);
  let c = 0;
  for(let i=0;i<n;i++){
    if(of[i] >= 0) continue;
    let top = 0; st[top++] = i; of[i] = c;
    while(top > 0){ const u = st[--top];
      for(let k=as[u];k<as[u+1];k++){ if(!lv[ae[k]]) continue;
        const v = ao[k]; if(of[v] < 0){ of[v] = c; st[top++] = v; } } }
    c++;
  }
  SX.netSc[E_NS_NPIECE] = c;
  SX.pcMask.set(lv);
  ePcGen++;
}
/* live when the piece the tank stands in has a cycle: a tree hanging off the vessel is a stub it only pressurises */
function eHoldLive(ci){
  if(ci < 0) return true;
  const t = PT.circHold[ci]; if(t < 0) return true;
  const s0 = PT.tankNode[t]; if(s0 < 0) return false;
  const key = ST.sc[SC_SGBURSTGEN]*2 + eNetHeldOn;
  if(eHlPc !== ePcGen || eHlKey !== key){ eHlPc = ePcGen; eHlKey = key; eHlGen++; }
  if(SX.hlStamp[ci] === eHlGen) return SX.hlVal[ci] === 1;
  const n = PT.n.node, seen = SX.hlSeen, st = SX.pcStack, lv = SX.pcMask, as = PT.adjStart, ae = PT.adjEdge, ao = PT.adjOther;
  seen.fill(0);
  let top = 0, nodes = 1; st[top++] = s0; seen[s0] = 1;
  while(top > 0){ const u = st[--top];
    for(let k=as[u];k<as[u+1];k++){ if(!lv[ae[k]]) continue;
      const v = ao[k]; if(seen[v] || eBound(v)) continue;
      seen[v] = 1; nodes++; st[top++] = v; } }
  eHlWalk++;
  let pairs = 0;
  const E = PT.n.edge, pm = SX.pairMark;
  for(let e=0;e<E;e++){ const u = PT.edU[e], v = PT.edV[e];
    if(!lv[e] || !seen[u] || !seen[v] || u === v) continue;
    const pid = PT.edPairId[e]; if(pm[pid] !== eHlWalk){ pm[pid] = eHlWalk; pairs++; } }
  const ans = pairs >= nodes;
  SX.hlVal[ci] = ans ? 1 : 0; SX.hlStamp[ci] = eHlGen;
  return ans;
}

function eNetFixed(){
  const n = PT.n.node, fv = SX.fixV, fh = SX.fixHas, nt = PT.n.tank;
  fh.fill(0);
  for(let i=0;i<n;i++) if(PT.nodeCont[i]){ fv[i] = eRegionP(PT.nodePcCell[i]); fh[i] = 1; }
  if(eNetHeldOn){
    for(let t=0;t<nt;t++){ const i = PT.tankNode[t]; if(i < 0) continue;
      if(PT.tankHold[t]){ eHoldPOfA(t); fv[i] = E_HP[0]; fh[i] = 1; } }
    for(let t=0;t<nt;t++){ const i = PT.tankNode[t]; if(i < 0) continue;
      if(PT.tankDrum[t]){ const ci = PT.tankCirc[t]; fv[i] = ci >= 0 ? PT.circSetP[ci] : PK[PK_PCONT]; fh[i] = 1; } } }
  for(let t=0;t<nt;t++){ const i = PT.tankNode[t];
    if(i < 0 || PT.tankHold[t] || PT.tankInField[t] || PT.tankStores[t]) continue;
    eTankPA(t); fv[i] = E_TP[0]; fh[i] = 1; }
  if(eNetHeldOn){
    for(let g=0;g<PT.n.sg;g++){ const i = PT.sgShellNode[g];
      if(i >= 0 && PT.nodeSg[i] === g){ eSecPA(g); fv[i] = E_SP[0]; fh[i] = 1; } }
    eCondPA(); const pc = E_CP[1];
    for(let q=0;q<PT.n.cond;q++){ const i = PT.condVNode[q];
      if(i >= 0 && PT.condVac[q]){ fv[i] = pc; fh[i] = 1; } } }
}

/* reverse Cuthill-McKee over the structural edges: the band is a property of the drawing and the fixed set */
function eNetOrder(fix){
  const n = PT.n.node, pos = SX.nRow, free = SX.rcmFree, deg = SX.rcmDeg, seen = SX.rcmSeen, q = SX.rcmQ, nb = SX.rcmNb;
  const as = PT.adjStart, ao = PT.adjOther;
  let nf = 0;
  for(let i=0;i<n;i++){ if(fix[i]){ pos[i] = -1; continue; } pos[i] = nf; free[nf++] = i; }
  for(let a=0;a<nf;a++){ const u = free[a]; let d = 0;
    for(let k=as[u];k<as[u+1];k++){ const b = pos[ao[k]]; if(b >= 0 && b !== a) d++; }
    deg[a] = d; }
  seen.fill(0, 0, nf);
  let qn = 0;
  for(;;){
    let s = -1;
    for(let a=0;a<nf;a++) if(!seen[a] && (s < 0 || deg[a] < deg[s])) s = a;
    if(s < 0) break;
    seen[s] = 1; let head = qn; q[qn++] = s;
    for(; head<qn; head++){
      const x = q[head], u = free[x];
      let m = 0;
      for(let k=as[u];k<as[u+1];k++){ const y = pos[ao[k]];
        if(y < 0 || y === x || seen[y]) continue;
        seen[y] = 1;
        let j = m++;
        while(j > 0 && (deg[nb[j-1]] > deg[y] || (deg[nb[j-1]] === deg[y] && nb[j-1] > y))){ nb[j] = nb[j-1]; j--; }
        nb[j] = y; }
      for(let j=0;j<m;j++) q[qn++] = nb[j];
    }
  }
  const out = SX.nFree;
  for(let k=0;k<nf;k++) out[k] = free[q[nf-1-k]];
  pos.fill(-1);
  for(let k=0;k<nf;k++) pos[out[k]] = k;
  let bw = 0;
  for(let e=0;e<PT.n.edge;e++){ const a = pos[PT.edU[e]], b = pos[PT.edV[e]];
    if(a < 0 || b < 0) continue; const d = a > b ? a - b : b - a; if(d > bw) bw = d; }
  SX.netSc[E_NS_NF] = nf; SX.netSc[E_NS_BW] = bw;
  SX.orderMask.set(fix); eOrderOK = 1;
}
function eMaskDiff(a, b, n){ for(let i=0;i<n;i++) if(a[i] !== b[i]) return true; return false; }

/* banded LDL^T in place; a pivot that vanishes against its own row is a node with no path to ground */
function eFactor(A, n, deg, B, d0){
  for(let k=0;k<n;k++) d0[k] = A[k*n+k];
  for(let k=0;k<n;k++){
    const d = A[k*n+k], lim = Math.min(n, k+B+1);
    if(!(d > 1e-9) || !(d > 1e-12*d0[k])){
      A[k*n+k] = 1;
      for(let j=k+1;j<lim;j++){ A[k*n+j] = 0; A[j*n+k] = 0; }
      deg[k] = 1; continue; }
    for(let i=k+1;i<lim;i++){
      const lik = A[i*n+k]/d; if(lik === 0) continue;
      for(let j=k+1;j<lim;j++) A[i*n+j] -= lik*A[k*n+j];
      A[i*n+k] = lik; }
  }
}
function eSubst(A, x, n, B){
  for(let k=0;k<n;k++){ let s = x[k];
    for(let j=Math.max(0,k-B);j<k;j++) s -= A[k*n+j]*x[j];
    x[k] = s; }
  for(let k=0;k<n;k++) x[k] /= A[k*n+k];
  for(let i=n-1;i>=0;i--){ let s = x[i]; const lim = Math.min(n, i+B+1);
    for(let j=i+1;j<lim;j++) s -= A[j*n+i]*x[j];
    x[i] = s; }
}
function eNetFactorOf(gA, capA, fix){
  if(!eOrderOK || eMaskDiff(SX.orderMask, fix, PT.n.node)) eNetOrder(fix);
  const nf = SX.netSc[E_NS_NF], bw = SX.netSc[E_NS_BW], row = SX.nRow, A = SX.mA, E = PT.n.edge;
  A.fill(0, 0, nf*nf);
  for(let e=0;e<E;e++){ const g = gA[e]; if(!(g > 0)) continue;
    const u = PT.edU[e], v = PT.edV[e], ru = row[u], rv = row[v];
    if(ru >= 0) A[ru*nf+ru] += g;
    if(rv >= 0) A[rv*nf+rv] += g;
    if(ru >= 0 && rv >= 0){ A[ru*nf+rv] -= g; A[rv*nf+ru] -= g; } }
  for(let a=0;a<nf;a++){ const i = SX.nFree[a], c = capA[i]; if(c > 0) A[a*nf+a] += c; }
  const dg = SX.mDeg; dg.fill(0, 0, nf);
  eFactor(A, nf, dg, bw, SX.mD0);
  SX.nDeg.fill(0);
  for(let a=0;a<nf;a++) if(dg[a]) SX.nDeg[SX.nFree[a]] = 1;
  SX.netSc[E_NS_FACTORS]++;
}
function eNetB(){
  const n = PT.n.node, E = PT.n.edge, b = SX.nb, tc = SX.nTouch, fh = SX.fixHas, fv = SX.fixV, src = SX.stSrc;
  b.fill(0); tc.fill(0);
  for(let e=0;e<E;e++){ const g = SX.gG[e]; if(!(g > 0)) continue;
    const h = SX.gH[e], u = PT.edU[e], v = PT.edV[e];
    tc[u] = 1; tc[v] = 1;
    const gu = !fh[u], gv = !fh[v];
    if(gu) b[u] -= g*h;
    if(gv) b[v] += g*h;
    if(gu && !gv) b[u] += g*fv[v];
    if(gv && !gu) b[v] += g*fv[u]; }
  if(eNetImp) for(let e=0;e<E;e++){ const w = eImpW(e); if(w !== w) continue;
    const u = PT.edU[e], v = PT.edV[e];
    tc[u] = 1; tc[v] = 1;
    if(!fh[u]) b[u] -= w;
    if(!fh[v]) b[v] += w; }
  for(let i=0;i<n;i++) if(!fh[i] && src[i]) b[i] += src[i];
}
/* r = b - A(g now) x over the free rows, into the compact vector */
function eNetResid(){
  const n = PT.n.node, E = PT.n.edge, r = SX.mR, x = SX.nx, fh = SX.fixHas, cap = SX.stCap;
  for(let i=0;i<n;i++) r[i] = fh[i] ? 0 : SX.nb[i] - (cap[i] > 0 ? cap[i]*x[i] : 0);
  for(let e=0;e<E;e++){ const g = SX.gG[e]; if(!(g > 0)) continue;
    const u = PT.edU[e], v = PT.edV[e], gu = !fh[u], gv = !fh[v];
    if(gu){ r[u] -= g*x[u]; if(gv) r[u] += g*x[v]; }
    if(gv){ r[v] -= g*x[v]; if(gu) r[v] += g*x[u]; } }
}
const E_NSB = new Float64Array(1);
function eNetSubstInto(rhs, add){
  const nf = SX.netSc[E_NS_NF], c = SX.mC, fr = SX.nFree, x = SX.nx;
  for(let a=0;a<nf;a++){ const i = fr[a]; c[a] = SX.nDeg[i] && add ? 0 : rhs[i]; }
  eSubst(SX.mA, c, nf, SX.netSc[E_NS_BW]);
  let dm = 0, xm = 0;
  for(let a=0;a<nf;a++){ const i = fr[a];
    if(add){ if(!SX.nDeg[i]){ x[i] += c[a]; const d = Math.abs(c[a]); if(d > dm) dm = d; } }
    else x[i] = c[a];
    const ax = Math.abs(x[i]); if(ax > xm) xm = ax; }
  E_NSB[0] = dm/Math.max(1, xm);
}
function eNetRefsTake(){
  ST.edGRef.set(SX.gG); ST.capRef.set(SX.stCap); ST.fixRef.set(SX.fixHas);
  ST.sc[SC_NETFACID]++;
  eNetFactorOf(ST.edGRef, ST.capRef, ST.fixRef);
  eFacBuilt = ST.sc[SC_NETFACID];
}
function eNetPatternSame(){
  const E = PT.n.edge, n = PT.n.node;
  for(let e=0;e<E;e++) if((SX.gG[e] > 0) !== (ST.edGRef[e] > 0)) return false;
  for(let i=0;i<n;i++){ if(SX.fixHas[i] !== ST.fixRef[i]) return false;
    if(!SX.fixHas[i] && (SX.stCap[i] > 0) !== (ST.capRef[i] > 0)) return false; }
  return true;
}

/* one solve against one state of the plant: field, conductances, pieces, stores, fixed set, then the linear system.
   The factor is held while the pattern holds and refined against this solve's own conductances; direct=1 factors this solve's matrix and leaves the held one alone. */
function eNetSolve(pA, direct){
  const n = PT.n.node, E = PT.n.edge;
  eRegionUpdate();
  eNetField(pA);
  for(let e=0;e<E;e++){ eEdgeGH(e); SX.gLive[e] = SX.gG[e] > 0 || (eNetImp && eImpW(e) === eImpW(e)) ? 1 : 0; }
  if(ePcGen === 0 || eMaskDiff(SX.gLive, SX.pcMask, E)) eNetPieces();
  eNetStore();
  eNetFixed();
  eNetB();
  const x = SX.nx;
  x.fill(0);
  if(direct || eNetRO){
    eNetFactorOf(SX.gG, SX.stCap, SX.fixHas);
    eFacBuilt = -1;
    eNetSubstInto(SX.nb, 0);
    SX.netSc[E_NS_REFINE] = 0;
  } else if(!eNetPatternSame()){
    eNetRefsTake();
    eNetSubstInto(SX.nb, 0);
    SX.netSc[E_NS_REFINE] = 0;
  } else {
    if(eFacBuilt !== ST.sc[SC_NETFACID]){
      eNetFactorOf(ST.edGRef, ST.capRef, ST.fixRef); eFacBuilt = ST.sc[SC_NETFACID]; }
    eNetSubstInto(SX.nb, 0);
    let it = 0, ok = false, last = E_INF;
    for(; it<E_REFINE_MAX; it++){
      eNetResid();
      eNetSubstInto(SX.mR, 1); const d = E_NSB[0];
      if(d <= E_REFINE_TOL){ ok = true; break; }
      if(d > 0.5*last) break;
      last = d; }
    SX.netSc[E_NS_REFINE] = it;
    if(!ok){ eNetRefsTake(); x.fill(0); eNetSubstInto(SX.nb, 0); }
  }
  const fh = SX.fixHas, fv = SX.fixV, q = SX.edQ;
  for(let i=0;i<n;i++) if(fh[i]) x[i] = fv[i];
  for(let e=0;e<E;e++){ const g = SX.gG[e];
    q[e] = g > 0 ? g*(x[PT.edU[e]] - x[PT.edV[e]] + SX.gH[e]) : 0; }
  if(eNetImp) for(let e=0;e<E;e++){ const w = eImpW(e); if(w === w) q[e] = w; }
  if(!eNetRO){ ST.edW.set(q); ST.edWHas.fill(1); }
}

/* a node with no path to ground has no pressure; a piece nothing states an absolute pressure for floats onto its compartment */
function eNetReadP(dst){
  const n = PT.n.node, of = SX.pcOf, np = SX.netSc[E_NS_NPIECE], lo = SX.pcLo, fr = SX.pcFree, wet = SX.pcWet;
  const x = SX.nx, fh = SX.fixHas, tc = SX.nTouch, dg = SX.nDeg;
  lo.fill(E_INF, 0, np); fr.fill(1, 0, np); wet.fill(0, 0, np);
  for(let i=0;i<n;i++){ const c = of[i];
    if(fh[i]){ if(tc[i]) fr[c] = 0; continue; }
    if(dg[i] && !tc[i]) continue;
    if(SX.fWet[i]) wet[c] = 1;
    if(SX.stPin[i] || SX.stCap[i] > 0) fr[c] = 0;
    if(x[i] < lo[c]) lo[c] = x[i]; }
  for(let i=0;i<n;i++){
    if(dg[i] && !tc[i] && !fh[i]){ dst[i] = E_NAN; continue; }
    const c = of[i];
    const off = (fr[c] && wet[c] && !fh[i] && isFinite(lo[c])) ? eRegionP(PT.nodePcCell[i]) - lo[c] : 0;
    dst[i] = x[i] + off; }
}
function eRunCommon(e){
  const q = SX.edQ; let v = q[e];
  const pr = PT.edPair[e];
  if(pr >= 0){ const w = q[pr]; v = (v >= 0) === (w >= 0) ? (Math.abs(w) < Math.abs(v) ? w : v) : 0; }
  return v;
}
const eKeyW = k => k >= 0 ? SX.netRunW[k] : 0;
const eRunW = u => eKeyW(PT.runKey[u]);
const eTankEdgeT = i => { const t = PT.nodeTank[i]; return (t >= 0 && !PT.tankHold[t]) ? t : -1; };
/* what the solve found crossing every book: runs, tanks, shells, feed, tube leaks, reliefs, openings, the core's own inflow */
function eNetReadEdges(){
  const E = PT.n.edge, x = SX.nx, q = SX.edQ, nl = PT.n.loop;
  SX.netRunW.fill(0); SX.netLoop.fill(0); SX.netCoreKg.fill(0); SX.netTankQ.fill(0); SX.netSgSteam.fill(0);
  SX.netFeed.fill(0); SX.netSgtr.fill(0); SX.netRelief.fill(0); SX.netBrk.fill(0);
  let core = 0, spill = 0, spillSec = 0, wk = 0, wkp = 0, wka = 0, qs = 0;
  for(let e=0;e<E;e++){
    const u = PT.edU[e], v = PT.edV[e], qe = q[e], syn = PT.edSyn[e];
    const k = PT.edKey[e];
    if(k >= 0 && PT.edMeter[e]) SX.netRunW[k] += eRunCommon(e);
    const tu = eTankEdgeT(u), tv = eTankEdgeT(v);
    if(tu >= 0 || tv >= 0){ const t = tu >= 0 ? tu : tv, tn = tu >= 0 ? u : v, out = tu >= 0 ? qe : -qe;
      SX.netTankQ[t] += (out > 0 && !SX.fWet[tn]) ? 0 : out; }
    if(PT.edShellSign[e] === 0 && syn !== E_SYN_SGTR){
      const su = PT.nodeSg[u], sv = PT.nodeSg[v];
      if(su >= 0 || sv >= 0){ const g = su >= 0 ? su : sv, b = PT.sgBoiler[g];
        if(b >= 0) SX.netSgSteam[b] += su >= 0 ? qe : -qe; } }
    if(PT.edWork[e]){ const b = PT.edTurb[e], fr = b >= 0 ? ST.turbWorkFr[b] : 0;
      if(fr > 0){ const w = qe*fr, aw = Math.abs(w); wk += w; wkp += x[u]*aw; wka += aw; } }
    if(syn === E_SYN_BREAK){ const mq = qe > 0 ? qe : 0;
      if(!PT.edSteam[e]){ if(PT.edSec[e]) spillSec += mq; else spill += mq; }
      const bi = PT.edBrk[e]; if(bi >= 0) SX.netBrk[bi] += mq; }
    if(PT.edShellSign[e] !== 0){ const b = PT.edShell[e];
      if(b >= 0) SX.netFeed[b] += PT.edShellSign[e] === -1 ? -qe : qe; }
    if(syn === E_SYN_SGTR){ qs += qe; const g = PT.edSg[e]; if(g >= 0) SX.netSgtr[g] += qe; }
    { const r = PT.edRelief[e]; if(r >= 0) SX.netRelief[r] += Math.abs(qe); }
    if(tu < 0 && tv < 0){ const cu = PT.nodeCore[u], cv = PT.nodeCore[v];
      if(cu >= 0 || cv >= 0){ const qin = cv >= 0 ? qe : -qe;
        if(qin > 0){ core += qin; SX.netCoreKg[cv >= 0 ? cv : cu] += qin;
          const l = PT.edLoop[e]; if(l >= 0 && l < nl) SX.netLoop[l] += qin; } } }
  }
  const S = SX.netSc;
  S[E_NS_TURBWK] = wk; S[E_NS_TURBWKP] = wkp; S[E_NS_TURBWKA] = wka; S[E_NS_QSGT] = qs;
  S[E_NS_SPILL] = spill; S[E_NS_SPILLSEC] = spillSec; S[E_NS_CORE] = core;
}
/* the core's own circulation alone, optionally by loop, for a solve whose other answers must not overwrite the tick's */
/* E_NL: [0] kg/s into the core's water off the last solve, [1] the pass before; returns 1 once two passes agree */
const E_NL = new Float64Array(2);
function eNetCoreLoop(dst){
  const E = PT.n.edge, q = SX.edQ;
  if(dst) dst.fill(0);
  let core = 0;
  for(let e=0;e<E;e++){ const u = PT.edU[e], v = PT.edV[e];
    if(eTankEdgeT(u) >= 0 || eTankEdgeT(v) >= 0) continue;
    const cu = PT.nodeCore[u], cv = PT.nodeCore[v]; if(cu < 0 && cv < 0) continue;
    const qin = cv >= 0 ? q[e] : -q[e]; if(!(qin > 0)) continue;
    core += qin;
    const l = PT.edLoop[e]; if(dst && l >= 0 && l < dst.length) dst[l] += qin; }
  E_NL[0] = core;
  const p = E_NL[1];
  if(p === p && Math.abs(core - p) <= E_NAT_TOL*Math.max(Math.abs(core), 1e-9)) return 1;
  E_NL[1] = core; return 0;
}
/* the thermosiphon, measured on its own solve with every pump stopped and every store held; the tick asks every E_NAT_EVERY ticks */
function eNetNat(){
  const sc = ST.sc;
  SX.wSave.set(ST.edW); SX.wSaveHas.set(ST.edWHas);
  const held = eNetHold(1), scale = eNetScale(0);
  let pA = sc[SC_NATHAS] ? ST.natPBy : ST.pBy;
  E_NL[1] = E_NAN;
  for(let pass=0;pass<E_NAT_PASSES;pass++){
    eNetSolve(pA, 1);
    eNetReadP(SX.pSolve); pA = SX.pSolve;
    if(eNetCoreLoop(null)) break; }
  eNetCoreLoop(ST.natLoop);
  ST.natPBy.set(SX.pSolve); sc[SC_NATHAS] = 1;
  eNetHold(held); eNetScale(scale);
  ST.edW.set(SX.wSave); ST.edWHas.set(SX.wSaveHas);
}
/* the tick's two plant figures every step reads: the core's heat and the core circuit's flow over rated */
const E_TK_HEAT = 0, E_TK_FLOW = 1, E_TK = new Float64Array(2);
/* the tick's solve: pressures land in SX.pSolve until eNetCommitP(); E_TK[E_TK_FLOW] out */
function eNetFlowKA(noNat){
  if(!noNat){ const sc = ST.sc; sc[SC_NATTICK]++;
    if(!sc[SC_NATHAS] || (!eNetRO && !(sc[SC_NATTICK] % E_NAT_EVERY))) eNetNat(); }
  eNetSolve(ST.pBy, eNetSteadyOn);
  eNetReadP(SX.pSolve);
  eNetReadEdges();
  let total = 0, natTot = 0;
  for(let l=0;l<PT.n.loop;l++){ total += SX.netLoop[l]; natTot += ST.natLoop[l]; }
  const nk = natTot/PK[PK_NETREF];
  SX.netSc[E_NS_NAT] = isFinite(nk) && nk >= 0 ? nk : 0;
  const k = total/PK[PK_NETREF];
  E_TK[E_TK_FLOW] = isFinite(k) && k >= 0 ? k : 0;
}
const eNetFlowK = noNat => { eNetFlowKA(noNat); return E_TK[E_TK_FLOW]; };
const eNetCommitP = () => { ST.pBy.set(SX.pSolve); };
