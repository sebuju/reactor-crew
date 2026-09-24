"use strict";
// exports: eBook eInvRate eSpillStep eTankRateStep ePressRead eAdvectStep eH2Total eInvNodesKg eInvStep eInvSeal eBookTailStep eLedgerA eLedgerKg eLedgerOut eMassSeed eFeedInH eFeedInM eFeedHeatKW eNetCoreKg eNetCoreInH eNodeInCorePiece eOutKg eOutH eOutH2 eLanded eInHSeed
// imports: eCondSinkA eCondSeed ePzrQ eBoilerP eBoilerLvl eNodeInA eCoreQWaterA

const E_TR_COURANT_PASSES = 8, E_TR_H2_RISE = 0.25, E_TR_TAVG_TAU = 0.5;
const E_TR_LEDGER_EPS = 1e-7, E_TR_LEDGER_QUIET = 30;
const E_TR_MIX = new Float64Array(MX_N);
const eClampIn = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

const eBook = (code, kg) => { if(kg) ST.massOut[code] += kg; };
/* % of loop inventory per second: arr[k] kg/s into E_IR[0] */
const E_IR = new Float64Array(2);
function eInvRateA(arr, k){ const kg = eLoopKg(); E_IR[0] = kg > 0 ? 100*arr[k]/kg : 0; }
const eInvRate = q => { E_IR[1] = q; eInvRateA(E_IR, 1); return E_IR[0]; };
const eNetCoreKg = c => SX.netCoreKg[c];
const eOutKg = o => ST.outKg[o];
const eOutH = o => ST.outKg[o] > 0 ? ST.outE[o]/ST.outKg[o] : E_NAN;
const eOutH2 = o => ST.outH2[o];
const eLanded = i => i >= 0 ? ST.landed[i] : 0;
const eFeedInM = b => ST.feedInM[b];

function eNodeInCorePiece(i){
  const of = SX.pcOf, pc = of[i], nc = PT.n.core;
  if(nc === 0) return PT.coreNode0 >= 0 && of[PT.coreNode0] === pc;
  for(let j=0;j<PT.coreLoop0[nc];j++) if(of[PT.coreLoopNode[j]] === pc) return true;
  return false;
}

const E_CIH = new Float64Array(MX_N);
function eNetCoreInHA(c){
  const v = ST.coreInH[c], cp = PT.coreCp[c], io = E_CIH;
  if(v === v){ io[MX_P] = ST.csPCore[c]; io[MX_H] = v; tLiqA(eCircSat(PT.coreCirc[c]), io); io[0] = cp*io[MX_TL]; return; }
  eTavgA(PT.coreCirc[c]); io[0] = cp*(E_TA[0] - PT.coreDT0[c]*ST.csHeat[c]/2);
}
const eNetCoreInH = c => { eNetCoreInHA(c); return E_CIH[0]; };

const eBoilerSat = b => eCircSat(PT.nodeCirc[PT.boilerNode[b]]);
/* E_FH: [0] feed heater kW, [1] bleed kg/s, [2] feed inlet h, [3..9] scratch */
const E_FH = new Float64Array(10);
function eFeedInHA(b){
  const v = ST.feedInH[b]; if(v === v){ E_FH[2] = v; return; }
  const T = ST.sc[SC_CONDT];
  E_FH[8] = T > 0 ? T : PT.feedT; eBoilerPA(b); E_FH[9] = E_BP[0]; hOfTPA(eBoilerSat(b), E_FH, 8, 9, 2);
}
const eFeedInH = b => { eFeedInHA(b); return E_FH[2]; };
/* an open heater cannot drive the nozzle past its own bleed steam's saturation, so a feed line with nothing arriving takes no duty */
function eFeedHeatA(b){
  const io = E_FH, c = eBoilerSat(b), i = PT.boilerFeed[b];
  eFeedInHA(b); const hIn = io[2];
  io[3] = PT.feedT; eBoilerPA(b); io[9] = E_BP[0]; hOfTPA(c, io, 3, 9, 4);
  const duty = Math.max(0, ST.steamBy[b])*Math.max(0, io[4] - hIn);
  eBoilerPA(b); io[3] = E_BP[0]; satTA(c, io, 3, 5); hOfTA(c, io, 5, 6);
  const hs = io[6];
  const m0 = i >= 0 ? ST.mBy[i] : 0, m = m0 === m0 ? m0 : 0;
  let hN = 0; if(i >= 0){ eNodeHOfA(ST.pBy, i); hN = E_NH[0]; }
  const room = Math.max(0, ST.feedInM[b])*Math.max(0, hs - hIn) + (i >= 0 ? m*Math.max(0, hs - hN)/NET_DT : 0);
  io[0] = Math.min(duty, room);
}
const eFeedHeatKW = b => { eFeedHeatA(b); return E_FH[0]; };

function eSpillStep(){
  const nb = PT.n.brk;
  for(let k=0;k<nb;k++){ eInvRateA(SX.netBrk, k); ST.spillBy[k] = E_IR[0]; }
  eInvRateA(SX.netSc, E_NS_SPILL); ST.sc[SC_SPILLRATE] = E_IR[0];
}
function eTankRateStep(){
  let inj = 0;
  const nt = PT.n.tank, fl = SX.tInj;
  for(let t=0;t<nt;t++){
    eInvRateA(SX.netTankQ, t); const q = E_IR[0];
    ST.tankRate[t] = q; fl[t] = 0;
    if(PT.tankPrimary[t] && q > 1e-6*TANK_RATE_REF){ inj += q; fl[t] = 1; }
  }
  ST.sc[SC_INJRATE] = inj;
}

/* a circuit's pressure is read off its own vessel: the hold tank, else a drum, else a gas store, else the core's node, else the room */
function ePressRead(dt){
  const hc = PT.trHoldCircs, sc = ST.sc;
  for(let k=0;k<hc.length;k++){ const ci = hc[k]; if(ci < 0) continue; const nid = PT.circPNode[ci];
    if(nid < 0){ eSetLoopP(ci, eRegionPart(PT.circPPart[ci])); continue; }
    eSetLoopP(ci, eNodeP(nid));
    const t = PT.circPHold[ci]; if(t < 0) continue;
    const was = ST.lvlBy[t];
    let lvl = eHoldLvlOf(nid); lvl = lvl < 0 ? 0 : lvl > 100 ? 100 : lvl;
    const d = dt > 0 ? (lvl - was)/dt : 0;
    ST.lvlBy[t] = lvl; ST.dLvlBy[t] = d;
    if(ci === PT.coreCirc0){ sc[SC_LVL] = lvl; sc[SC_DLVL] = d; }
  }
}

/* E_SRC: [0] kW offered in, [1] surface K in (NaN: none), [2] kW accepted out, [3] the tick's dt (0 while held), [4] cap kW out */
const E_SRC = new Float64Array(5), E_TAKE_MIX = new Float64Array(MX_N);
/* the most node i can take in one tick toward a surface at [1]: what it holds and what arrives on the solved flows, each carried at most to the surface's own temperature */
function eTakeCapA(i){
  const io = E_TAKE_MIX, dt = E_SRC[3], Ts = E_SRC[1];
  if(i < 0 || !(dt > 0) || !(Ts === Ts)){ E_SRC[4] = E_INF; return; }
  const m0 = ST.mBy[i], m = m0 === m0 ? m0 : 0;
  eNodeHOfA(ST.pBy, i); const h = E_NH[0];
  eNodePOfA(ST.pBy, i); io[MX_P] = E_NP[0]; io[MX_TC] = Ts; hOfTPA(eNodeSat(i), io, MX_TC, MX_P, MX_KAP);
  const hs = io[MX_KAP]; eNodeInA(i);
  E_SRC[4] = m*Math.abs(hs - h)/dt + Math.abs(E_NIN[2]*hs - E_NIN[3]);
}
function eSrcAdd(i){ const q = E_SRC[0]; if(i >= 0 && q) SX.tSrc[i] += q; }
/* eSrcAdd toward the surface at [1]: what the node will not take is [0] - [2] */
function eSrcTake(i){ const q = E_SRC[0]; E_SRC[2] = 0; if(i < 0 || !q) return;
  eTakeCapA(i); const cap = E_SRC[4], a = q > 0 ? Math.min(q, cap) : Math.max(q, -cap);
  SX.tSrc[i] += a; E_SRC[2] = a; }
const eSkinQ = a => a >= 0 ? ST.skinQ[a] : 0;

/* E_CWN: cooling-water path w's [0] node it heats, [1] node it arrives from */
const E_CWN = new Int32Array(2);
function eCondCwNodeA(w){ const kk = PT.cwKey[w], ref = PT.cwRef[w];
  const fwd = (ref > 1e-9 ? (kk >= 0 ? SX.netRunW[kk] : 0)/ref : 0) >= 0;
  E_CWN[0] = fwd ? PT.cwNodeB[w] : PT.cwNodeA[w]; E_CWN[1] = fwd ? PT.cwNodeA[w] : PT.cwNodeB[w]; }

/* kW into each node: machines hand their heat to the water that is there */
function eAdvectSrcMach(){
  const Q = E_SRC;
  eCoreSrc();
  for(let k=0;k<PT.nStg;k++){
    const g = PT.stgSg[k], x = PT.stgIhx[k], b = g >= 0 ? PT.sgBoiler[g] : -1;
    const qs = b >= 0 ? ST.hbSgQ[b] : 0, q = qs ? qs : (x >= 0 ? ST.ihxQBy[x] : 0);
    Q[0] = -q/2; eSrcAdd(PT.stgA0[k]); eSrcAdd(PT.stgB0[k]);
    if(PT.stgSgtr[k]){ const a = PT.stgPart[k]; Q[0] = q + (g >= 0 ? ST.sgSwQBy[g] : 0) - (a >= 0 ? ST.skinQ[a] : 0); eSrcAdd(PT.stgShell[k]); }
    else { Q[0] = q/2; eSrcAdd(PT.stgA1[k]); eSrcAdd(PT.stgB1[k]); } }
  for(let b=0;b<PT.n.boiler;b++){ eFeedHeatA(b); Q[0] = E_FH[0]; eSrcAdd(PT.boilerFeed[b]); }
  eCondSrc();
  for(let g=0;g<PT.n.sg;g++){ const q = ST.sgPwQBy[g]; if(!q) continue;
    Q[0] = q/2; eSrcAdd(PT.sgPrimA[g]); eSrcAdd(PT.sgPrimB[g]); }
  for(let r=0;r<PT.n.rad;r++){ const q = ST.radQBy[r];
    Q[0] = -q/2; eSrcAdd(PT.radNa[r]); eSrcAdd(PT.radNb[r]); }
  { const h = PT.holdTanks; for(let k=0;k<h.length;k++){ ePzrQA(h[k]); Q[0] = E_PZ[0]; eSrcAdd(PT.tankNode[h[k]]); } }
  for(let p=0;p<PT.n.pump;p++){ ePumpWorkA(p); if(!E_PWK[0]) continue;
    const e = PT.pumpEdge[p], su = PT.pumpSuc[p];
    Q[0] = E_PWK[0]; eSrcAdd(PT.edU[e] === su ? PT.edV[e] : PT.edU[e]); }
}
/* what the water will not take stays in the surface that offered it: the core's cans, the channels' columns */
function eCoreSrc(){
  const Q = E_SRC;
  for(let c=0;c<PT.n.core;c++){
    const j0 = PT.coreLoop0[c], j1 = PT.coreLoop0[c+1];
    eCoreQWaterA(c); eCoreSurfTA(c); Q[0] = E_CQW[0]/Math.max(1, j1 - j0); Q[1] = E_CQW[1];
    for(let j=j0;j<j1;j++){ eSrcTake(PT.coreLoopNode[j]); ST.csQRef[c] += Q[0] - Q[2]; }
    if(PT.coreCpsWet[c]){ Q[0] = ST.csCQ[c]/2; Q[1] = E_CQW[2];
      for(let f=0;f<2;f++){ const i = f ? PT.coreCpsB[c] : PT.coreCpsA[c]; if(i < 0) continue; eSrcTake(i); ST.csQRefC[c] += Q[0] - Q[2]; } } }
}
/* the tubes pass what the steam space gives toward its cooling water; the shaft and feed duty is a book on the steam, not a surface */
function eCondSrc(){
  const Q = E_SRC;
  for(let q=0;q<PT.n.cond;q++){ eCondSinkA(q);
    const v = PT.condVes[q]; let qt = E_CSK[1];
    if(qt > 0 && v >= 0) for(let w=PT.condCw0[q];w<PT.condCw0[q+1];w++){ eCondCwNodeA(w); if(E_CWN[1] < 0) continue;
      eNodeTA(E_CWN[1]); Q[1] = E_NT[MX_T]; eTakeCapA(v); qt = Math.min(qt, Q[4]); }
    Q[0] = qt - E_CSK[1] - E_CSK[0]; if(v >= 0) eSrcAdd(v);
    Q[0] = qt;
    for(let w=PT.condCw0[q];w<PT.condCw0[q+1];w++){ eCondCwNodeA(w); eSrcAdd(E_CWN[0]); } }
}
/* kW pump p leaves in the water: an adiabatic pump gives up all its shaft work, the isentropic v (p_out - p_in)
   it buys as pressure and the casing's own loss as heat on top. A gas is COMPRESSED, and v dp is not its work. */
const E_PWK = new Float64Array(1), E_PUMP_INCOMP = 1.02;
function ePumpWorkA(p){
  E_PWK[0] = 0;
  const e = PT.pumpEdge[p], su = PT.pumpSuc[p];
  if(e < 0 || su < 0) return;
  const fwd = PT.edU[e] === su, di = fwd ? PT.edV[e] : PT.edU[e], w = fwd ? ST.edW[e] : -ST.edW[e];
  const ps = ST.pBy[su], pd = ST.pBy[di];
  if(!(w > 0) || !(pd > ps)) return;
  const rs = eNodeRho(su), rd = eNodeRho(di);
  if(!(rs > 0) || !(rd > 0) || rd > rs*E_PUMP_INCOMP) return;
  E_PWK[0] = w*(pd - ps)*1000/(rs*PUMP_ETA);
}
/* and the wall exchange, capped at what the water can take */
function eAdvectSrc(dt){
  const src = SX.tSrc, n = PT.n.node;
  src.fill(0); SX.tMetQ.fill(0);
  const held = eNetHeldOn, mq = SX.tMetQ, io = E_TR_MIX;
  E_SRC[3] = held ? 0 : dt;
  eAdvectSrcMach();
  for(let i=0;i<n;i++){ const mk = PT.nodeMetalKg[i]; if(!(mk > 0)) continue;
    const c = eNodeSat(i);
    eNodeHOfA(ST.pBy, i); const h = E_NH[0];
    eNodePOfA(ST.pBy, i); io[MX_P] = E_NP[0]; io[MX_H] = h; tOfHA(c, io);
    const T = io[MX_T];
    let Tw = ST.metalT[i];
    if(!(Tw > 0) || !isFinite(Tw) || held){ Tw = T; ST.metalT[i] = T; }
    const ua = PT.nodeMetalUA[i];
    const q0 = mk*E_CP_STEEL*(Tw - T)/(PT.nodeMetalTau[i] + (ua > 0 ? mk*E_CP_STEEL/ua : 0));
    E_SRC[1] = Tw; eTakeCapA(i); const cap = E_SRC[4];
    const q = q0 > 0 ? Math.min(q0, cap) : Math.max(q0, -cap);
    mq[i] = q; src[i] += q; }
}

/* E_ADVP[0]: the pressure node i's contents stand at; short of what the solved pressure holds, m of eos kg fill only m/eos of it */
const E_ADVP = new Float64Array(1);
function ePAdvA(i, m, eos){ const p = ST.pBy[i]; E_ADVP[0] = (!PT.nodeBooked[i] && p === p && eos > 0) ? p*Math.min(1, m/eos) : p; }

const E_AH = new Float64Array(3);
function eAnchorH(i, T){ if(i < 0) return; const io = E_AH; io[0] = T; eNodePOfA(ST.pBy, i); io[1] = E_NP[0]; hOfTPA(eNodeSat(i), io, 0, 1, 2); ST.hBy[i] = io[2]; }
function eAnchorsHold(){
  for(let g=0;g<PT.n.sg;g++) eAnchorH(PT.sgFeedFace[g], PT.feedT);
  for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b]) eAnchorH(PT.boilerFeed[b], PT.feedT);
}
const eAnchored = i => { if(!eNetHeldOn) return false;
  for(let g=0;g<PT.n.sg;g++) if(PT.sgFeedFace[g] === i) return true;
  for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b] && PT.boilerFeed[b] === i) return true;
  return false; };

/* a seed stated as a temperature is liquid: past its own saturation it is saturated liquid */
const eLiqSeedH = (c, T, p) => hOfTP(c, p < c.pc ? Math.min(T, satT(c, p)) : T, p);
function eSeedMark(i, T, qn){
  const st = SX.tSeedT, q = SX.tSeedQ;
  if(i < 0 || st[i] === st[i] || !(T === T)) return qn;
  st[i] = T; q[qn] = i; return qn + 1;
}
/* a node with no enthalpy seeds at the nearest anchoring machine's temperature, walked over the drawing */
function eAdvectSeed(){
  const n = PT.n.node, st = SX.tSeedT, q = SX.tSeedQ, sc = ST.sc;
  st.fill(E_NAN);
  let qn = 0;
  for(let g=0;g<PT.n.sg;g++){ const b = PT.sgBoiler[g], T = b >= 0 ? ST.sgTBy[b] : E_NAN;
    qn = eSeedMark(PT.sgFeedFace[g], T, qn); qn = eSeedMark(PT.sgFeedFace2[g], T, qn); }
  for(let k=0;k<4*PT.n.cond;k++) qn = eSeedMark(PT.condFaces[k], ST.condTBy[(k/4)|0], qn);
  for(let k=0;k<4*PT.n.rad;k++) qn = eSeedMark(PT.radFaces[k], ST.radTBy[(k/4)|0], qn);
  for(let k=0;k<4*PT.n.tank;k++){ const t = (k/4)|0; if(PT.tankHold[t]) continue;
    qn = eSeedMark(PT.tankFaces[k], PT.tankFluidT[t], qn); }
  const as = PT.adjStart, ao = PT.adjOther, ae = PT.adjEdge, di = PT.edDiode, eu = PT.edU, nc = PT.nodeCirc;
  for(let h=0;h<qn;h++){ const u = q[h];
    for(let k=as[u];k<as[u+1];k++){ const v = ao[k], e = ae[k], dio = di[e];
      /* the flow law's own test (eFlowGA): water does not arrive where it cannot flow to */
      if(dio !== 0 && dio*(eu[e] === u ? 1 : -1) < 0) continue;
      if(!(st[v] === st[v]) && nc[v] === nc[u]){ st[v] = st[u]; q[qn++] = v; } } }
  for(let i=0;i<n;i++){
    if(ST.hBy[i] === ST.hBy[i]) continue;
    const ci = PT.nodeCirc[i], c = eCircSat(ci), t = PT.nodeTank[i], g = PT.nodeSg[i];
    let h;
    if(t >= 0 && PT.tankHold[t]) h = holdSeedH(PT.tankCirc[t], PT.tankCirc[t] >= 0 ? PT.circSetP[PT.tankCirc[t]] : PK[PK_P0], eTankLvl(t));
    else if(g >= 0 && PT.sgShellNode[g] === i) h = holdSeedH(ci, eSecP(g), E_SGL_SET/E_SG_DOME);
    else if(t >= 0 && PT.tankDrum[t]) h = holdSeedH(PT.tankCirc[t], PT.tankCirc[t] >= 0 ? PT.circSetP[PT.tankCirc[t]] : PK[PK_P0], PT.tankLevel0[t]);
    else if(t >= 0) h = eLiqSeedH(c, PT.tankFluidT[t], eNodeP(i));
    else if(PT.nodeVapour[i]) h = satHg(c, eNodeP(i));
    else h = eLiqSeedH(c, (ci !== PT.coreCirc0 && st[i] === st[i]) ? st[i] : sc[SC_TAVG], eNodeP(i));
    ST.hBy[i] = h; }
}

/* a node may not give more than it has plus what arrives in the same tick; swept, because an inflow is somebody else's throttled outflow */
function eAdvCourant(dt){
  const n = PT.n.node, E = PT.n.edge, fr = SX.tFrom, M = SX.tM, mO = SX.tMOut, mI = SX.tMIn, kO = SX.tKOut, m = ST.mBy;
  for(let pass=0;pass<E_TR_COURANT_PASSES;pass++){
    mO.fill(0); mI.fill(0); kO.fill(1);
    for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
      mO[f] += M[e]; mI[f === PT.edU[e] ? PT.edV[e] : PT.edU[e]] += M[e]; }
    let bit = false;
    for(let i=0;i<n;i++){ const o = mO[i]*dt;
      if(!(o > 0) || PT.nodeBooked[i] === 2) continue;
      const mi = m[i]; if(!(mi === mi)) continue;
      const cap = mi + mI[i]*dt;
      if(o > cap){ kO[i] = Math.max(cap, 0)/o; bit = true; } }
    if(!bit) break;
    for(let e=0;e<E;e++){ const f = fr[e]; if(f >= 0 && kO[f] !== 1) M[e] *= kO[f]; }
  }
}
/* and it may not take more than its own state weighs at the highest pressure next to it; the excess stays in the donor */
function eAdvCap(dt){
  const n = PT.n.node, E = PT.n.edge, fr = SX.tFrom, M = SX.tM, m = ST.mBy;
  const pMax = SX.tPMax, pNow = SX.tPNow, inR = SX.tMIn, out = SX.tMOut, kI = SX.tKIn;
  kI.fill(1); inR.fill(0); out.fill(0);
  for(let i=0;i<n;i++){ eNodePOfA(ST.pBy, i); pMax[i] = pNow[i] = E_NP[0]; }
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
    const to = f === PT.edU[e] ? PT.edV[e] : PT.edU[e];
    if(pNow[f] > pMax[to]) pMax[to] = pNow[f];
    out[f] += M[e]; inR[to] += M[e]; }
  for(let i=0;i<n;i++){ const ir = inR[i]*dt;
    if(!(ir > 0) || PT.nodeBooked[i]) continue;
    const mi = m[i], V = PT.nodeVol[i];
    if(!(mi === mi) || !(V > 0)) continue;
    const c = eNodeSat(i), io = E_TR_MIX;
    io[MX_P] = pMax[i];
    if(SX.fVoid[i]){ satTA(c, io, MX_P, MX_TS); curveA(c, CV_RF, io, MX_TS, MX_RHO); }
    else { eNodeHOfA(ST.pBy, i); io[MX_H] = E_NH[0]; mixA(c, io); }
    const cap = V*io[MX_RHO];
    const room = cap - mi + out[i]*dt;
    if(ir > room) kI[i] = Math.max(room, 0)/ir; }
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
    const k = kI[f === PT.edU[e] ? PT.edV[e] : PT.edU[e]]; if(k !== 1) M[e] *= k; }
}
/* a separator passes what it has: a gas nozzle its node's own vapour plus what arrives, a water outlet likewise its liquid */
function eAdvSep(dt){
  const n = PT.n.node, E = PT.n.edge, fr = SX.tFrom, M = SX.tM, m = ST.mBy, x = SX.fX;
  const gK = SX.tGasK, lK = SX.tLiqK, vIn = SX.tVIn, gO = SX.tGOut, lIn = SX.tLIn, lO = SX.tLOut;
  gK.fill(0); lK.fill(0); vIn.fill(0); gO.fill(0); lIn.fill(0); lO.fill(0);
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
    const to = f === PT.edU[e] ? PT.edV[e] : PT.edU[e], xf = x[f];
    if(PT.edGasAt[e] === f && xf > 0){ gK[e] = 1; gO[f] += M[e]; vIn[to] += M[e]; }
    else vIn[to] += M[e]*Math.max(0, xf);
    if(PT.edLiqAt[e] === f && xf > 0){ lK[e] = 1; lO[f] += M[e]; lIn[to] += M[e]; }
    else lIn[to] += M[e]*Math.max(0, 1 - xf); }
  for(let i=0;i<n;i++){ const mi = m[i];
    const og = gO[i];
    if(og > 0){ const bud = (!(mi === mi) ? og*dt : x[i]*mi)/dt + vIn[i];
      if(og > bud){ const k = Math.max(bud, 0)/og; for(let e=0;e<E;e++) if(gK[e] === 1 && fr[e] === i) gK[e] = k; } }
    const ol = lO[i];
    if(ol > 0){ const bud = (!(mi === mi) ? ol*dt : (1 - x[i])*mi)/dt + lIn[i];
      if(ol > bud){ const k = Math.max(bud, 0)/ol; for(let e=0;e<E;e++) if(lK[e] === 1 && fr[e] === i) lK[e] = k; } } }
}
/* the donated state of every edge; a node overdrawn within the tick passes on what arrived after its own contents */
/* E_ADH: [4] donor h in, the edge's h out; [5] vapour share, [6] liquid share of it drawn saturated */
const E_ADH = new Float64Array(7);
function eDonHA(f){
  const io = E_ADH, fg = io[5], fl = io[6];
  if(fg > 0){ io[0] = SX.fP[f]; satHgA(eNodeSat(f), io, 0, 1); io[4] = fg*io[1] + (1 - fg)*io[4]; }
  else if(fl > 0){ io[0] = SX.fP[f]; satHA(eNodeSat(f), io, 0, 1); io[4] = fl*io[1] + (1 - fl)*io[4]; }
}
function eAdvDonate(dt, hDon){
  const n = PT.n.node, E = PT.n.edge, fr = SX.tFrom, M = SX.tM, gK = SX.tGasK, lK = SX.tLiqK;
  const inH = SX.tInH, inM = SX.tInM, inB = SX.tInB, outH = SX.tOutH, outB = SX.tOutB, mO = SX.tMOut, eH = SX.tEH;
  inH.fill(0); inM.fill(0); inB.fill(0); outH.fill(0); outB.fill(0); mO.fill(0);
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
    const to = f === PT.edU[e] ? PT.edV[e] : PT.edU[e], m = M[e];
    E_ADH[4] = hDon[f]; E_ADH[5] = gK[e]; E_ADH[6] = lK[e]; eDonHA(f);
    const hd = E_ADH[4];
    eH[e] = hd;
    inH[to] += m*hd; inM[to] += m; outH[f] += m*hd; mO[f] += m;
    const bf = ST.bBy[f]; inB[to] += m*bf; outB[f] += m*bf; }
}
/* a species on the donor edges, capped at what the node holds: a gas (liq 0) rides the vapour, a dissolved one the water, its steam at 1/FP_PC */
function eAdvSp(dt, c, eC, inC, outC, liq){
  const n = PT.n.node, E = PT.n.edge, fr = SX.tFrom, M = SX.tM, gK = SX.tGasK, lK = SX.tLiqK, x = SX.fX, m = ST.mBy, kH = SX.tKH;
  inC.fill(0); outC.fill(0); kH.fill(1);
  for(let e=0;e<E;e++){ const f = fr[e]; eC[e] = 0; if(f < 0) continue;
    const cf = c[f]; if(!(cf > 0)) continue;
    const fg = gK[e], fl = lK[e];
    let conc;
    if(!liq) conc = fg > 0 ? cf*(fg/Math.max(x[f], 1e-9) + (1 - fg)) : cf*(1 - fl);
    else { const xf = x[f] > 0 ? (x[f] < 1 ? x[f] : 1) : 0, cl = cf/((1 - xf) + xf/FP_PC);
      conc = fg > 0 ? fg*cl/FP_PC + (1 - fg)*cf : fl > 0 ? fl*cl + (1 - fl)*cf : cf; }
    eC[e] = M[e]*conc; outC[f] += eC[e]; inC[f === PT.edU[e] ? PT.edV[e] : PT.edU[e]] += eC[e]; }
  for(let i=0;i<n;i++){ const o = outC[i]; if(!(o > 0)) continue;
    const mi = m[i], have = (mi === mi ? c[i]*mi : 0)/Math.max(dt, 1e-12) + inC[i];
    if(o > have) kH[i] = Math.max(have, 0)/o; }
  inC.fill(0); outC.fill(0);
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0 || !(eC[e] > 0)) continue;
    const v = eC[e]*kH[f]; eC[e] = v; outC[f] += v; inC[f === PT.edU[e] ? PT.edV[e] : PT.edU[e]] += v; }
}

/* the mixed inflow each feed nozzle and core reads, off inflow kg/s and kW per node */
function eInHSet(inM, inH){
  const s = ST, fi = PT.boilerFeed;
  for(let b=0;b<PT.n.boiler;b++){ const i = fi[b];
    if(i >= 0 && inM[i] > 0){ s.feedInH[b] = inH[i]/inM[i]; s.feedInM[b] = inM[i]; } }
  for(let c=0;c<PT.n.core;c++){ let m = 0, e = 0, ref = 0, hn = 0;
    for(let j=PT.coreLoop0[c];j<PT.coreLoop0[c+1];j++){ const i = PT.coreLoopNode[j];
      if(!(inM[i] > 0)) continue;
      m += inM[i]; e += inH[i]; ref += PT.nodeRefThru[i]; hn += inM[i]*s.hBy[i]; }
    if(!(m > 0)) continue;
    let w = ref > 0 ? m/(ref*E_CORE_DT_QMIN) : 0; w = w < 0 ? 0 : w > 1 ? 1 : w;
    s.coreInH[c] = w*(e/m) + (1 - w)*(hn/m); }
}
/* commissioning: the inflow read off the settled field, not off the last settle pass's transport */
function eInHSeed(){
  const n = PT.n.node, inM = SX.tInM, inH = SX.tInH;
  eNetField(ST.pBy);
  for(let i=0;i<n;i++){ eNodeInA(i); inM[i] = E_NIN[2]; inH[i] = E_NIN[3]; }
  eInHSet(inM, inH);
}

/* one donor pass books mass, enthalpy, boron and hydrogen; every clamp is booked and the node energy U = m*h - p*V is carried exactly */
function eAdvectStep(dt){
  const n = PT.n.node, E = PT.n.edge, s = ST, sc = s.sc, X = SX, held = eNetHeldOn;
  eAdvectSrc(dt);
  let need = false;
  for(let i=0;i<n;i++) if(!(s.hBy[i] === s.hBy[i])){ need = true; break; }
  if(need) eAdvectSeed();
  if(held) eAnchorsHold();
  for(let t=0;t<PT.n.tank;t++){ const i = PT.tankNode[t];
    if(i >= 0 && !PT.tankHold[t]) s.bBy[i] = sc[SC_BORON0] - 100*PT.tankFluidB[t]; }

  const fr = X.tFrom, M = X.tM, q = X.edQ;
  fr.fill(-1); M.fill(0);
  for(let e=0;e<E;e++){ const w = q[e], m = Math.abs(w);
    if(!(m > 1e-9)) continue;
    const f = w > 0 ? PT.edU[e] : PT.edV[e];
    if(PT.nodeBooked[f] === 2) continue;
    fr[e] = f; M[e] = m; }
  if(!held){ eAdvCourant(dt); eAdvCap(dt); }
  eAdvSep(dt);

  const hDon = X.tHIn0;
  hDon.set(s.hBy);
  eAdvDonate(dt, hDon);
  if(!held){ let over = false;
    for(let i=0;i<n;i++){ const o = X.tMOut[i]*dt, mi = s.mBy[i];
      if(!(o > 0) || !(mi === mi) || o <= mi || !(X.tInM[i] > 0)) continue;
      hDon[i] = (mi*s.hBy[i] + (o - mi)*X.tInH[i]/X.tInM[i])/o; over = true; }
    if(over) eAdvDonate(dt, hDon); }
  eAdvSp(dt, s.h2By, X.tEC, X.tInC, X.tOutC, 0);
  eAdvSp(dt, s.fpNBy, X.tECn, X.tInCn, X.tOutCn, 0);
  eAdvSp(dt, s.fpVBy, X.tECv, X.tInCv, X.tOutCv, 1);

  const inH = X.tInH, inM = X.tInM, inB = X.tInB, inC = X.tInC, outH = X.tOutH, outB = X.tOutB, outC = X.tOutC, mO = X.tMOut;
  eInHSet(inM, inH);

  s.edgeKg.fill(0); s.landed.fill(0); s.outKg.fill(0); s.outE.fill(0); s.outH2.fill(0); s.outFpN.fill(0); s.outFpV.fill(0);
  let oPri = 0, oSec = 0;
  for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
    const u = PT.edU[e], v = PT.edV[e], to = f === u ? v : u, m = M[e]*dt;
    s.edgeKg[e] = f === u ? m : -m;
    const bt = PT.nodeBookT[to], bf = PT.nodeBookT[f];
    if(bt !== bf){ if(bt >= 0) s.landed[to] += m; if(bf >= 0) s.landed[f] -= m; }
    if(f !== u) continue;
    const o = PT.edOut[e];
    if(o >= 0){ s.outKg[o] += m; s.outE[o] += m*X.tEH[e]; s.outH2[o] += X.tEC[e]*dt; s.outFpN[o] += X.tECn[e]*dt; s.outFpV[o] += X.tECv[e]*dt; }
    if(PT.edBreak[e]){ if(PT.edSec[e]) oSec += m; else oPri += m; } }
  sc[SC_OUTPRI] = oPri; sc[SC_OUTSEC] = oSec;

  let U0 = 0, U1 = 0, enSrc = 0, enX = 0, clampE = 0, clamped = 0;
  const src = X.tSrc, mq = X.tMetQ;
  if(!held){
    for(let i=0;i<n;i++){ if(PT.nodeBooked[i]) continue;
      const m = s.mBy[i], h = s.hBy[i], pa = s.pAdv[i];
      if(m === m) U0 += m*h - ((pa === pa && s.pBy[i] === s.pBy[i]) ? pa : (s.pBy[i] === s.pBy[i] ? s.pBy[i] : eNodeP(i)))*PT.nodeVol[i]*1000;
      if(mq[i]) U0 += PT.nodeMetalKg[i]*E_CP_STEEL*s.metalT[i];
      enSrc += (src[i] - mq[i])*dt; }
    for(let e=0;e<E;e++){ const f = fr[e]; if(f < 0) continue;
      const to = f === PT.edU[e] ? PT.edV[e] : PT.edU[e], bf = PT.nodeBooked[f] !== 0, bt = PT.nodeBooked[to] !== 0;
      if(bf === bt) continue;
      const kj = M[e]*dt*X.tEH[e];
      enX += bf ? -kj : kj; } }

  let bLo = E_INF, bHi = -E_INF, fpN2 = 0, fpV2 = 0, h22 = 0;
  const inCn = X.tInCn, outCn = X.tOutCn, inCv = X.tInCv, outCv = X.tOutCv;
  for(let i=0;i<n;i++){ const b = s.bBy[i];
    if(b < bLo) bLo = b; if(b > bHi) bHi = b; }
  for(let i=0;i<n;i++){
    const bk = PT.nodeBooked[i];
    if(bk === 2){ if(inM[i] > 0) s.hBy[i] = inH[i]/inM[i]; fpN2 += inCn[i]*dt; fpV2 += inCv[i]*dt; h22 += inC[i]*dt; s.pAdv[i] = s.pBy[i]; continue; }
    const V = PT.nodeVol[i], t = PT.nodeBookT[i];
    if(held){
      s.pAdv[i] = s.pBy[i];
      if(!eAnchored(i) && !PT.nodeHoldSet[i] && inM[i] > 1e-9){
        const f = E_SETTLE_RELAX;
        s.hBy[i] += f*((inH[i] + src[i])/inM[i] - s.hBy[i]);
        s.bBy[i] += f*(inB[i]/inM[i] - s.bBy[i]);
        s.h2By[i] += f*(inC[i]/inM[i] - s.h2By[i]); }
      if(bk === 1){ eTankLvlA(t); s.mBy[i] = PT.tankKg[t]*E_TL[0]/100; } else { eSeedKgA(i); s.mBy[i] = E_SK[0]; }
      continue; }
    let book = 0;
    if(bk === 1){ eTankLvlA(t); book = PT.tankKg[t]*E_TL[0]/100; }
    const m00 = s.mBy[i];
    const m0 = bk === 1 ? book : (m00 === m00 ? m00 : V*eNodeRho(i));
    const p = s.pBy[i], pa = s.pAdv[i];
    const qi = src[i], want = m0 + dt*(inM[i] - mO[i]);
    let mNew, eos = E_NAN;
    if(bk === 1) mNew = want;
    else {
      eNodeMixA(i); eos = V*E_MIX2[MX_RHO];
      if(!(m00 === m00)) mNew = eos;
      else if(eos <= DRY_MIN_KG){ eBook(E_BK_ADVECT, want - eos); mNew = eos; }
      else { mNew = Math.max(want, 0); if(want !== mNew) eBook(E_BK_ADVECT, want - mNew); }
      s.mBy[i] = mNew; }
    ePAdvA(i, mNew, eos); const pc = E_ADVP[0];
    const dpv = (!bk && p === p && pa === pa) ? V*(pc - pa)*1000 : 0;
    s.pAdv[i] = pc;
    if(!(inM[i] > 0) && !(mO[i] > 0) && !qi && !dpv) continue;
    const H = m0*s.hBy[i] + dt*(inH[i] - outH[i] + qi) + dpv;
    const B = m0*s.bBy[i] + dt*(inB[i] - outB[i]);
    if(mNew > DRY_MIN_KG){
      /* an explicit donor drains a node at its start h; past u = 0 (the 273.15 K datum) there is no state left to land on */
      const hLo = !bk && pc === pc ? pc*V*1000/mNew : -E_INF;
      let h = H/mNew; if(h < hLo){ clampE += H - mNew*hLo; h = hLo; clamped++; }
      s.hBy[i] = h; s.bBy[i] = eClampIn(B/mNew, bLo, bHi); }
    else { const h = inM[i] > 0 ? inH[i]/inM[i] : s.hBy[i]; if(!bk) clampE += H - mNew*h; s.hBy[i] = h; clamped++;
      if(inM[i] > 0) s.bBy[i] = inB[i]/inM[i]; }
    { const mS = m00 === m00 ? m00 : m0, mE = bk === 1 ? book : mNew;
      const Nn = mS*s.fpNBy[i] + dt*(inCn[i] - outCn[i]), Nv = mS*s.fpVBy[i] + dt*(inCv[i] - outCv[i]);
      if(mE > DRY_MIN_KG && Nn >= 0) s.fpNBy[i] = Nn/mE; else { sc[SC_FPBOOKN] += Nn; s.fpNBy[i] = 0; }
      const Nc = mS*s.h2By[i] + dt*(inC[i] - outC[i]);
      if(mE > DRY_MIN_KG && Nc >= 0) s.h2By[i] = Nc/mE; else { sc[SC_H2BOOK] += Nc; s.h2By[i] = 0; }
      if(mE > DRY_MIN_KG && Nv >= 0) s.fpVBy[i] = Nv/mE; else { sc[SC_FPBOOKV] += Nv; s.fpVBy[i] = 0; } }
    if(bk === 1) s.mBy[i] = book;
  }
  sc[SC_ADVCLAMPED] = clamped;
  for(let o=0;o<s.outFpN.length;o++){ fpN2 -= s.outFpN[o]; fpV2 -= s.outFpV[o]; h22 -= s.outH2[o]; }
  sc[SC_FPBOOKN] += fpN2; sc[SC_FPBOOKV] += fpV2; sc[SC_H2BOOK] += h22;

  for(let i=0;i<n;i++){ if(!mq[i]) continue;
    s.metalT[i] -= mq[i]*dt/(PT.nodeMetalKg[i]*E_CP_STEEL); }

  if(!held){
    for(let i=0;i<n;i++){ if(PT.nodeBooked[i]) continue;
      const m = s.mBy[i], p = s.pAdv[i];
      if(m === m) U1 += m*s.hBy[i] - (p === p ? p : eNodeP(i))*PT.nodeVol[i]*1000;
      if(mq[i]) U1 += PT.nodeMetalKg[i]*E_CP_STEEL*s.metalT[i]; }
    sc[SC_ENRES] = (U1 - U0) - (enSrc - enX) + clampE;
    sc[SC_ENSRC] += enSrc; sc[SC_ENOUT] += enX; sc[SC_ENCLAMP] += clampE; }

  eGasRise(dt, s.h2By); eGasRise(dt, s.fpNBy);
  eTavgRead(dt);
  { const i = PT.coreNode0;
    if(i >= 0){ const bv = s.bBy[i], d = bv - sc[SC_BORON]; sc[SC_BORON] = bv; sc[SC_BORONDEM] += d; }
    eH2TotalA(); sc[SC_H2] = E_H2T[0]; }
}

/* a bubble climbs at its drift velocity through the path's own flow area; hydrogen and the noble gases alike */
function eGasRise(dt, c){
  const rs = PT.riseE, nr = rs.length, m = ST.mBy, out = SX.tRiseOut, kk = SX.tRiseK, kg = SX.tRiseKg;
  out.fill(0); kk.fill(1);
  for(let k=0;k<nr;k++){ const e = rs[k]; kg[k] = 0;
    const C = eEdgeC(e); if(!(C > 0)) continue;
    const A = PT.edBore[e] > 0 ? areaOf(PT.edBore[e]) : C;
    const u = PT.edU[e], v = PT.edV[e], up = PT.nodeZ[v] > PT.nodeZ[u], lo = up ? u : v, hi = up ? v : u;
    const ml = m[lo], mh = m[hi], V = PT.nodeVol[lo];
    if(!(ml > DRY_MIN_KG) || !(mh > DRY_MIN_KG) || !(c[lo] > 0) || !(V > 0)) continue;
    const x = c[lo]*ml/V*E_TR_H2_RISE*A*dt;
    if(!(x > 0)) continue;
    kg[k] = x; out[lo] += x; }
  for(let i=0;i<out.length;i++){ if(!(out[i] > 0)) continue;
    const have = c[i]*m[i]; kk[i] = out[i] > have ? have/out[i] : 1; }
  for(let k=0;k<nr;k++){ if(!(kg[k] > 0)) continue;
    const e = rs[k], u = PT.edU[e], v = PT.edV[e], up = PT.nodeZ[v] > PT.nodeZ[u], lo = up ? u : v, hi = up ? v : u;
    const x = kg[k]*kk[lo];
    c[lo] -= x/m[lo]; c[hi] += x/m[hi]; }
}
const E_H2T = new Float64Array(1);
function eH2TotalA(){
  const n = PT.n.node, c = ST.h2By;
  let t = 0;
  for(let i=0;i<n;i++){ const ci = c[i]; if(!(ci > 0) || !PT.nodeInCore[i]) continue;
    const m = ST.mBy[i]; let mm = m;
    if(m !== m){ eNodeMixA(i); mm = PT.nodeVol[i]*E_MIX2[MX_RHO]; }
    t += ci*mm; }
  E_H2T[0] = t;
}
const eH2Total = () => { eH2TotalA(); return E_H2T[0]; };

/* T-avg is read off the core circuit, mass-weighted over what is circulating; the vessel node counts at the midpoint of its own rise */
function eTavgRead(dt){
  const hc = PT.trHoldCircs, n = PT.n.node, inH = SX.tInH, inM = SX.tInM, mO = SX.tMOut, sc = ST.sc;
  for(let k=0;k<hc.length;k++){ const ci = hc[k]; if(!PT.circCore[ci]) continue;
    let m = 0, hm = 0, pm = 0;
    for(let i=0;i<n;i++){
      if(PT.nodeCirc[i] !== ci || !PT.nodeInLoop[i] || eAnchored(i)) continue;
      const cx = PT.nodeCore[i], core = cx >= 0 && PT.coreCirc[cx] === ci;
      const ref = PT.nodeRefThru[i];
      let w = core ? 1 : ref > 0 ? Math.min(inM[i], mO[i])/ref : 0;
      w = w > 1 ? 1 : w;
      if(!(w > 0)) continue;
      const m0 = ST.mBy[i];
      let mi = m0;
      if(!(m0 === m0)){ eNodeMixA(i); mi = PT.nodeVol[i]*E_MIX2[MX_RHO]; }
      mi = w*mi;
      const hi = core && inM[i] > 1e-9 ? 0.5*(inH[i]/inM[i] + ST.hBy[i]) : ST.hBy[i];
      eNodePOfA(ST.pBy, i); m += mi; hm += mi*hi; pm += mi*E_NP[0]; }
    if(!(m > 0)) continue;
    const c = eCircSat(ci); eTavgA(ci); const was = E_TA[0], io = E_TR_MIX;
    io[MX_P] = pm/m; io[MX_H] = hm/m; tOfHA(c, io);
    let T = io[MX_T];
    T = T < PT.circTmin[ci] ? PT.circTmin[ci] : T > PT.circTmax[ci] ? PT.circTmax[ci] : T;
    const raw = dt > 0 ? (T - was)/dt : 0, dW = ST.dTavgBy[ci];
    const d = isFinite(dW) ? dW + (raw - dW)*Math.min(1, dt/E_TR_TAVG_TAU) : raw;
    ST.TavgBy[ci] = T; ST.dTavgBy[ci] = d;
    if(ci === PT.coreCirc0){ sc[SC_TAVG] = T; sc[SC_DTAVG] = d; } }
}

/* the core's piece, less every node another book owns; c < 0 is the first vessel */
function eInvNodesKg(c){
  const node = c >= 0 ? PT.coreNode[c] : PT.coreNode0;
  if(node < 0) return 0;
  const of = SX.pcOf, pc = of[node], n = PT.n.node;
  let m = 0;
  for(let i=0;i<n;i++){ if(PT.nodeBooked[i] || of[i] !== pc || !PT.nodeInLoop[i]) continue;
    const v = ST.mBy[i]; if(v === v) m += v; }
  return m;
}
function eInvStep(){
  if(PK[PK_INVKG0] > 0) ST.sc[SC_INV] = 100*eInvNodesKg(-1)/PK[PK_INVKG0];
  for(let c=0;c<PT.n.core;c++){ const k0 = PT.coreInvKg0[c];
    if(k0 > 0) ST.invBy[PT.coreCirc[c]] = 100*eInvNodesKg(c)/k0; }
}
function eInvSeal(){
  P.invKg0 = eInvNodesKg(-1); ePkSync();
  for(let c=0;c<PT.n.core;c++) PT.coreInvKg0[c] = eInvNodesKg(c);
  eInvStep();
}

function eTankRuleLive(t){
  switch(PT.tankRule[t]){
    case E_RULE_ALWAYS: return true;
    case E_RULE_SGLOW: { let lo = 100;
      for(let b=0;b<PT.n.boiler;b++){ eBoilerLvlA(b); const v = E_BL[0]; if(v < lo) lo = v; }
      return lo < (ST.tankAuto[t] ? E_SG_EFW_OFF : E_SG_DRY); }
    case E_RULE_PLOW: { const ci = PT.tankCirc[t]; eLoopPA(ci); return E_LP[0] < (ci >= 0 ? PT.circSetP[ci] : PK[PK_PCONT])*0.55; }
  }
  return false;
}
function eBookTailStep(){
  eBook(E_BK_SPILLPRI, ST.sc[SC_OUTPRI]);
  const nt = PT.n.tank;
  for(let t=0;t<nt;t++) if(PT.tankInf[t] && PT.tankPrimary[t]) eBook(E_BK_BOUNDARYTANK, eLanded(PT.tankNode[t]));
  for(let t=0;t<nt;t++) ST.tankAuto[t] = eTankRuleLive(t) ? 1 : 0;
}

/* E_LG: [0] kg on the books, [1] kg booked out; the tick's head marks them (fin 0), its tail closes against them (fin 1) */
const E_LG = new Float64Array(2);
function eLedgerA(fin, dt){
  const n = PT.n.node;
  let m = 0;
  for(let i=0;i<n;i++){ if(PT.nodeBooked[i]) continue; const v = ST.mBy[i]; if(v === v) m += v; }
  for(let t=0;t<PT.n.tank;t++)
    if(!PT.tankInf[t] && !PT.tankHold[t] && PT.tankHasCell[t] && !PT.tankInField[t]) m += ST.tank[t]/100*PT.tankKg[t];
  const W = ST.roomWater;
  for(let i=0;i<W.length;i++) m += W[i];
  const b = ST.massOut; let k = 0; for(let i=0;i<b.length;i++) k += b[i];
  if(!fin){ E_LG[0] = m; E_LG[1] = k; return; }
  const sc = ST.sc, m0 = E_LG[0], res = (m0 - m) - (k - E_LG[1]);
  sc[SC_MASSRES] = res;
  if(!(Math.abs(res) > E_TR_LEDGER_EPS*Math.max(m0, 1))) return;
  /* rate-limited, re-armed when the residual changes sign or an order of magnitude */
  const was = sc[SC_MASSWARN], t = sc[SC_TICK];
  const fresh = !was || res*was < 0 || Math.abs(res) > 10*Math.abs(was) || Math.abs(res) < 0.1*Math.abs(was);
  if(fresh || t - sc[SC_MASSWARNT] >= E_TR_LEDGER_QUIET/dt){
    sc[SC_MASSWARN] = res; sc[SC_MASSWARNT] = t;
    eEvent(EV_LEDGER, res, m0); }
}
const eLedgerKg = () => { eLedgerA(0, 0); return E_LG[0]; };
const eLedgerOut = () => { eLedgerA(0, 0); return E_LG[1]; };

const E_SK = new Float64Array(1);
function eSeedKgA(i){ const t = PT.nodeTank[i];
  E_SK[0] = PT.nodeFillStores[i]*(t >= 0 && PT.tankStores[t] ? PT.tankKg[t] : PT.nodeVol[i]*eNodeRho(i)); }

/* every unbooked node's mass off the settled field; a stub behind a shut gate seeds at its boundary's state */
function eMassSeed(){
  const n = PT.n.node;
  eSettleSteady();
  for(let i=0;i<n;i++) if(!PT.nodeBooked[i]){ eSeedKgA(i); ST.mBy[i] = E_SK[0]; }
  for(let q=0;q<PT.n.cond;q++){ const i = PT.condVes[q];
    if(i < 0 || !PT.condVac[q] || PT.nodeBooked[i]) continue;
    eCondSeed(i, satT(eNodeSat(i), eNodeP(i))); }
  const seen = SX.tSeen, qq = SX.tSeedQ, as = PT.adjStart, ae = PT.adjEdge, ao = PT.adjOther, pc = PK[PK_PCONT];
  seen.fill(0);
  const nS = PT.contCav.length + PT.n.tank;
  for(let k=0;k<nS;k++){
    let s0 = -1, tT = E_NAN;
    if(k < PT.contCav.length) s0 = PT.contCav[k];
    else { const t = k - PT.contCav.length;
      if(!PT.tankField[t] && PT.tankNode[t] >= 0 && eTankP(t) <= pc*1.001){ s0 = PT.tankNode[t]; tT = PT.tankFluidT[t]; } }
    if(s0 < 0 || seen[s0]) continue;
    let top = 0, rn = 0, plant = false;
    seen[s0] = 1; qq[top++] = s0;
    while(rn < top){ const i = qq[rn++];
      const cx = PT.nodeCore[i];
      if(cx >= 0 || PT.nodeHoldSet[i]) plant = true;
      for(let a=as[i];a<as[i+1];a++){ const v = ao[a];
        if(seen[v] || !(eEdgeC(ae[a]) > 0)) continue;
        seen[v] = 1; qq[top++] = v; } }
    if(plant) continue;
    const seed = p => { for(let r=0;r<top;r++){ const i = qq[r]; if(PT.nodeBooked[i]) continue;
      const pi = p ? p[i] : pc, c = eNodeSat(i), Tw = tT === tT ? Math.min(tT, satT(c, pi)) : satT(c, pi), h = tT === tT ? hOfTP(c, Tw, pi) : satHg(c, pi);
      /* a standing line has stood long enough for its wall to take its water's temperature */
      ST.hBy[i] = h; ST.mBy[i] = PT.nodeVol[i]*mixState(c, pi, h, E_TR_MIX)[MX_RHO]; ST.pBy[i] = pi; ST.metalT[i] = Tw; } };
    seed(null);
    /* at rest each node stands on the column below it: p_v = p_u + static head of the edge */
    eNetField(ST.pBy);
    const p = new Float64Array(PT.n.node), done = new Uint8Array(PT.n.node);
    p[s0] = pc; done[s0] = 1;
    for(let r=1;r<top;r++){ const i = qq[r]; p[i] = pc;
      for(let a=as[i];a<as[i+1];a++){ const v = ao[a], e = ae[a];
        if(!done[v] || !(eEdgeC(e) > 0)) continue;
        eStaticHA(e); p[i] = PT.edU[e] === v ? p[v] + E_EC[2] : p[v] - E_EC[2]; break; }
      done[i] = 1; }
    seed(p); }
  for(let i=0;i<PT.n.node;i++){ const m = ST.mBy[i];
    if(PT.nodeBooked[i] || !(m === m)){ ST.pAdv[i] = ST.pBy[i]; continue; }
    eNodeMixA(i); ePAdvA(i, m, PT.nodeVol[i]*E_MIX2[MX_RHO]); ST.pAdv[i] = E_ADVP[0]; }
}
