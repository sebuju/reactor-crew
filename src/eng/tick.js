"use strict";
// exports: engStep engSettle engReset
const E_SETTLE_DT = 0.02, E_SETTLE_PASSES = 300, E_SG_NTU_MAX = 4;

function engStep(dt){
  const was = eNetMarching(1);
  eStepMarch(dt);
  eNetMarching(was);
}

function eStepMarch(dt){
  const sc = ST.sc;
  sc[SC_T] += dt; sc[SC_TICK]++;
  eLedgerA(0, 0);
  eCtlPass(dt);
  eActFollow(dt);
  eCoreRodStep(dt);
  eBoronFollow(dt);
  eCoreDecayStep(dt);
  eCoreAgg();
  E_TK[E_TK_HEAT] = sc[SC_N]*PROMPT_F + sc[SC_DECAY];

  eMachPreSolve();
  eNetFlowKA(0);
  eCoreFlowRead();
  eCwFlowStep();
  eSpillStep();
  eTankRateStep();
  eNetCommitP();
  eCorePRead();
  ePressRead(dt);
  eBurstDice();

  eAdvectStep(dt);
  eInvStep();
  eSumpStep(dt);
  eCavStep(dt);
  ePumpQStep();
  ePumpCoastStep(dt);

  eSgHeatStep();
  eHoldReliefStep(dt);
  eDiscTankStep(dt);
  eBookTailStep();
  if(sc[SC_INJRATE] > 0) eCoreFatigueStep(dt);
  eSgtrStep(dt);
  eCoreBurstStep();
  eCoreVesselStep(dt);
  eCoreAgg();

  eMarginStep();
  eCondTurbStep();
  eSecVentStep(dt);
  eShellStep(dt);
  eCondVentStep(dt);
  eTurbStep(dt);
  eRadPanelStep(dt);
  eSecTankStep(dt);

  eCoreKineticsStep(dt);
  eCoreMeltStep(dt);
  eCoreAgg();

  eRadDose(dt);
  if(sc[SC_INJKIND] === E_INJ_FLUID) eInjectFluid(dt);
  eRoomStep(dt);
  eBlastStep(dt);
  eOverpressureStep();
  eBurnFireStep();
  eCookStep(dt);
  eCoreAgg();
  eEvLatchStep();
  if(sc[SC_REPA] >= 0) eRepairStep(dt);
  eFlowSpinStep(dt);
  eLedgerA(1, dt);
}

/* commissioning's solve: pressures committed, flow over rated returned */
function eSettleSolve(){
  eMachPreSolve();
  const k = eNetFlowK(1);
  eNetCommitP();
  return k;
}
const E_STEADY_MAX = 60, E_STEADY_TOL = 1e-6, E_SHELL_STALL = 8;
/* the held field solved until no edge flow moves more than E_STEADY_TOL of the largest, and no pressure of a node that passes flow more than E_STEADY_TOL of its own (an imposed flow pins a line's flows before its pressures); passes returned, E_STEADY_MAX = never settled */
function eSettleSteady(){
  const held = eNetHold(1), st = eNetSteady(1), E = PT.n.edge, n = PT.n.node;
  const prev = new Float64Array(E), prevP = new Float64Array(n), thru = new Float64Array(n);
  try {
    for(let pass=0;pass<E_STEADY_MAX;pass++){
      eSettleSolve();
      const q = SX.edQ, p = ST.pBy; let scale = 0, move = 0, pMove = 0;
      thru.fill(0);
      for(let e=0;e<E;e++){ const a = Math.abs(q[e]); if(a > scale) scale = a;
        thru[PT.edU[e]] += a; thru[PT.edV[e]] += a;
        const d = Math.abs(q[e] - prev[e]); if(d > move) move = d; }
      for(let i=0;i<n;i++){ if(!(p[i] === p[i]) || !(thru[i] > E_STEADY_TOL*scale)) continue;
        const d = Math.abs(p[i] - prevP[i])/Math.max(Math.abs(p[i]), COND_P0); if(d > pMove) pMove = d; }
      if(pass && move <= E_STEADY_TOL*Math.max(scale, 1e-9) && pMove <= E_STEADY_TOL) return pass + 1;
      prev.set(q); prevP.set(p); }
    return E_STEADY_MAX;
  } finally { eNetHold(held); eNetSteady(st); }
}

/* what drum b raises at rest: with its feed landing on it and passing its steam, the loop's net enthalpy into it over hg less the feed's; with the feed landing off it, the loop's own balance over h_f */
function eDrumSteam(b){
  const i = PT.boilerNode[b];
  let r = 0, rm = 0, fm = 0, fe = 0;
  for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed];
    if(!(w0 === w0) || w0 === 0) continue;
    const f = w0 > 0 ? PT.edU[ed] : PT.edV[ed], w = PT.edV[ed] === i ? w0 : -w0, x = SX.fX[f];
    E_ADH[4] = ST.hBy[f]; E_ADH[5] = PT.edGasAt[ed] === f && x > 0 ? 1 : 0; E_ADH[6] = PT.edLiqAt[ed] === f && x > 0 ? 1 : 0;
    eDonHA(f);
    if(PT.nodeInLoop[PT.adjOther[k]]){ r += w*E_ADH[4]; rm += w; }
    else if(w > 0 && PT.edGasAt[ed] !== i){ fm += w; fe += w*E_ADH[4]; } }
  const c = eNodeSat(i), p = eNodeP(i), hg = satHg(c, p);
  if(fm > 0) return r > 0 && hg > fe/fm ? r/(hg - fe/fm) : 0;
  const hf = satH(c, p), v = (r - rm*hf)/(hg - hf);
  return v > 0 ? v : 0;
}

function eSettleRest(keep){
  const s = ST, sc = s.sc, nb = PT.n.boiler, ng = PT.n.sg, n0 = PK[PK_N0];
  const hotWas = new Float64Array(ng).fill(E_NAN), feedW = new Float64Array(nb).fill(E_NAN);
  eNetHold(1); eNetImpose(feedW);
  if(!keep){ E_SUA[0] = E_SUA[1] = 0; E_SUAG = new Uint8Array(Math.max(1, ng)); }
  for(let i=0;i<E_SETTLE_PASSES;i++){
    for(let b=0;b<nb;b++) if(PT.boilerDrum[b]) feedW[b] = s.steamBy[b];
    const k = eSettleSolve(), was = sc[SC_FLOWNET];
    if(k > 0) sc[SC_FLOWNET] = k;
    E_TK[E_TK_HEAT] = sc[SC_HEAT]; E_TK[E_TK_FLOW] = sc[SC_FLOWNET]; eSgHeatStep();
    eCoreFlowRead();
    for(let c=0;c<PT.n.core;c++) eCoreRestStep(c, SX.coreFN[c]);
    eCoreAgg();
    eAdvectStep(E_SETTLE_DT);
    for(let b=0;b<nb;b++){ const node = PT.boilerNode[b];
      if(node < 0 || !(s.hBy[node] === s.hBy[node])) continue;
      const dr = PT.boilerDrum[b], ci = PT.boilerCirc[b], g = PT.boilerSg[b];
      const t = PT.boilerTank[b], p = !dr ? eSecP(g) : eHeldPin(t) ? PT.circSetP[ci] : s.pBy[node];
      s.hBy[node] = holdSeedH(ci, p, dr ? PT.tankLevel0[t] : E_SGL_SET/E_SG_DOME);
      s.mBy[node] = PT.nodeVol[node]*rhoMixOf(eCircSat(ci), p, s.hBy[node]); }
    let ds = 0;
    for(let b=0;b<nb;b++){ if(!PT.boilerDrum[b]) continue;
      const v = eDrumSteam(b); ds = Math.max(ds, Math.abs(v - s.steamBy[b])/Math.max(v, 1e-9)); s.steamBy[b] = v; }
    for(let q=0;q<PT.n.cond;q++){ const node = PT.condVes[q];
      if(!PT.condVac[q] || node < 0 || !(s.hBy[node] === s.hBy[node])) continue;
      eCondSeed(node, satT(eNodeSat(node), eCondP())); }
    if(E_SUA[0]) eSettleCapT();
    else for(let h=0;h<PT.trHoldCircs.length;h++){ const ci = PT.trHoldCircs[h]; if(!PT.circCore[ci] || PT.circDrumP[ci]) continue;
      if(isFinite(eTavgOf(ci))) eSettleLoopT(ci, eCircSat(ci).Tref); }
    eSettleUA(0.5, 2);
    let moved = 0;
    for(let g=0;g<ng;g++){ eStageStream(g, 0); const t = SX.stgT[2*g];
      if(hotWas[g] === hotWas[g]) moved = Math.max(moved, Math.abs(t - hotWas[g]));
      hotWas[g] = t; }
    if(i > 20 && Math.abs(sc[SC_FLOWNET] - was) < 1e-5 && moved < 1e-6 && ds < E_STEADY_TOL) break;
  }
  eNetImpose(null); eNetHold(0);
  eTavgRead(0);
  eSettleStubs();
}
/* circuit ci's circulating water moved to T-avg Tt at its own set pressure */
function eSettleLoopT(ci, Tt){
  const s = ST, c = eCircSat(ci), T = eTavgOf(ci), pc = PT.circSetP[ci] > 0 ? PT.circSetP[ci] : c.p0;
  const dh = hOfTP(c, Tt, pc) - hOfTP(c, T, pc);
  if(!(Math.abs(dh) > 1e-9)) return;
  for(let j=0;j<PT.n.node;j++)
    if(s.hBy[j] === s.hBy[j] && PT.nodeCirc[j] === ci && PT.nodeInLoop[j] && PT.nodeTank[j] < 0 && !PT.nodeHoldSet[j] && SX.tInM[j] > 1e-9) s.hBy[j] += dh;
}
/* tubes at their NTU ceiling cannot take the rated heat at Tref, so the loop stands wherever they can: one Newton step on the hot stream's approach, relative miss returned */
function eSettleCapT(){
  const s = ST, sc = s.sc, ng = PT.n.sg, nn = Math.max(1, ng);
  let pw = 0;
  for(let p=0;p<PT.n.pump;p++){ if(!PT.pumpPrimary[p]) continue; ePumpWorkA(p); pw += E_PWK[0]; }
  let miss = 0;
  for(let g=0;g<ng;g++){
    E_SQ[0] = Math.max(sc[SC_FLOWNET]*s.sgShare[g]*nn, .02); eSgQ(g);
    const now = E_SQ[2], want = (PK[PK_N0]*PK[PK_RATED]*1000 + pw)/nn, dTh = SX.stgT[2*g] - E_STK[1];
    if(!E_SUAG[g] || !(now > 0) || !(want > 0) || !(dTh > 0)) continue;
    const ci = PT.nodeCirc[PT.stgA0[g]];
    if(!(ci >= 0 && PT.circCore[ci] && !PT.circDrumP[ci])) continue;
    /* a ceiling only binds above Tref: below it the tubes were big enough after all */
    const Tt = eTavgOf(ci) + (want/now - 1)*dTh/nn, Tr = eCircSat(ci).Tref;
    if(Tt < Tr){ E_SUAG[g] = 0; eSettleLoopT(ci, Tr); continue; }
    eSettleLoopT(ci, Tt);
    miss = Math.max(miss, Math.abs(want/now - 1)); }
  E_SUA[0] = 0; for(let g=0;g<ng;g++) if(E_SUAG[g]) E_SUA[0] = 1;
  return miss;
}
/* the suggested tubes sized for this point: one ratio step, largest relative miss returned. Once E_SUA[1] arms it, tubes that reach their ceiling stay on it (E_SUAG[g]) and E_SUA[0] says any did */
const E_SUA = new Float64Array(2);
let E_SUAG = new Uint8Array(1);
function eSettleUA(lo, hi){
  const s = ST, sc = s.sc, ng = PT.n.sg, nn = Math.max(1, ng);
  let any = false, miss = 0;
  /* the tubes have to take away what the primary pumps leave in the coolant as well as what the core makes */
  let pw = 0;
  for(let p=0;p<PT.n.pump;p++){ if(!PT.pumpPrimary[p]) continue; ePumpWorkA(p); pw += E_PWK[0]; }
  for(let g=0;g<ng;g++){ const id = IX.sgId[g]; if(D.sgUA[id] != null) continue;
    const fl = Math.max(sc[SC_FLOWNET]*s.sgShare[g]*nn, .02);
    E_SQ[0] = fl; eSgQ(g);
    const now = E_SQ[2], want = (PK[PK_N0]*PK[PK_RATED]*1000 + pw)/nn;
    if(now > 0 && want > 0){ E_SQ[3] = E_STK[1]; eStageSecant(2*g); const wcp = SX.stgC[2*g];
      const cap = isFinite(wcp) ? E_SG_NTU_MAX*wcp/Math.pow(fl, E_UA_FLOW) : E_INF;
      const was = PT.stageUA[g];
      PT.stageUA[g] = E_SUAG[g] ? cap : Math.min(was*Math.max(lo, Math.min(hi, want/now)), cap);
      if(E_SUA[1] && PT.stageUA[g] === cap && want > now){ E_SUAG[g] = 1; E_SUA[0] = 1; }
      if(PT.stageUA[g] !== was) miss = Math.max(miss, Math.abs(want/now - 1));
      P.sgUABy[id] = PT.stageUA[g]; any = true; } }
  if(any){ let t = 0; for(let g=0;g<ng;g++) t += PT.stageUA[g]; P.sgUA = t/nn; }
  return miss;
}
/* a dead leg holds the water of the line it hangs off, not a seed nothing ever flowed through, and its wall stands at that water's temperature */
function eSettleStubs(){
  const n = PT.n.node, s = ST, inM = SX.tInM, st = SX.tSeedT, q = SX.tSeedQ, as = PT.adjStart, ao = PT.adjOther, nc = PT.nodeCirc;
  const still = i => !(inM[i] > 1e-9) && PT.nodeTank[i] < 0 && PT.nodeSg[i] < 0 && PT.nodeCondV[i] < 0
    && !PT.nodeBooked[i] && !PT.nodeHoldSet[i] && !PT.nodeCont[i] && !PT.nodeVapour[i];
  st.fill(E_NAN);
  let qn = 0;
  for(let i=0;i<n;i++) if(!still(i) && s.hBy[i] === s.hBy[i]){ st[i] = s.hBy[i]; q[qn++] = i; }
  for(let h=0;h<qn;h++){ const u = q[h];
    for(let k=as[u];k<as[u+1];k++){ const v = ao[k];
      if(st[v] === st[v] || nc[v] !== nc[u] || !still(v)) continue;
      st[v] = st[u]; q[qn++] = v;
      s.hBy[v] = st[u]; s.mBy[v] = PT.nodeVol[v]*rhoMixOf(eNodeSat(v), eNodeP(v), st[u]); s.metalT[v] = eNodeT(v); } }
}

/* each shell's pressure walked until what it raises leaves through the header it sees: Broyden on one differenced Jacobian */
function eSettleShells(){
  const s = ST, sc = s.sc, n = PT.n.sg;
  if(!n) return;
  const bOf = g => PT.sgBoiler[g];
  const rise = (g, p) => Math.max(1, hRise(eBoilerSatOf(bOf(g)), p));
  const pOf = () => { const p = new Float64Array(n); for(let g=0;g<n;g++) p[g] = eSecP(g); return p; };
  const setP = p => { for(let g=0;g<n;g++){ const b = bOf(g);
    s.sgPBy[b] = p[g]; s.sgTBy[b] = satT(eBoilerSatOf(b), p[g]); } };
  const solve = () => {
    E_TK[E_TK_HEAT] = sc[SC_HEAT]; E_TK[E_TK_FLOW] = sc[SC_FLOWNET]; eSgHeatStep();
    eSettleSteady();
    const r = new Float64Array(n);
    for(let g=0;g<n;g++) r[g] = SX.netSgSteam[bOf(g)] - s.hbSgQ[bOf(g)]/rise(g, eSecP(g));
    return r; };
  eNetHold(1);
  let A = null, pPrev = null, rPrev = null, errPrev = E_INF, best = null, errBest = E_INF, itBest = 0;
  for(let it=0;it<40;it++){
    const p = pOf(), r0 = solve();
    let err = 0;
    for(let g=0;g<n;g++){ const w = s.hbSgQ[bOf(g)]/rise(g, p[g]); if(w > 0) err = Math.max(err, Math.abs(r0[g])/w); }
    if(err < errBest){ errBest = err; best = p; itBest = it; }
    if(err < 1e-6 || it - itBest >= E_SHELL_STALL) break;
    if(!A || err > errPrev){
      A = []; for(let i=0;i<n;i++) A.push(new Float64Array(n));
      for(let j=0;j<n;j++){ const dp = 1e-3*p[j], q = Float64Array.from(p); q[j] += dp; setP(q);
        const r1 = solve(); for(let i=0;i<n;i++) A[i][j] = (r1[i] - r0[i])/dp; } }
    else { let dd = 0; const dp = new Float64Array(n);
      for(let j=0;j<n;j++){ dp[j] = p[j] - pPrev[j]; dd += dp[j]*dp[j]; }
      if(dd > 0) for(let i=0;i<n;i++){ let Adp = 0;
        for(let j=0;j<n;j++) Adp += A[i][j]*dp[j];
        const v = (r0[i] - rPrev[i]) - Adp;
        for(let j=0;j<n;j++) A[i][j] += v*dp[j]/dd; } }
    pPrev = p; rPrev = r0; errPrev = err;
    const d = new Float64Array(n), rhs = new Float64Array(n);
    for(let g=0;g<n;g++) rhs[g] = -r0[g];
    denseSolve(A.map(row => Array.from(row)), rhs, d, n);
    const q = new Float64Array(n);
    for(let g=0;g<n;g++) q[g] = Math.max(eRegionPart(PT.sgPart[g]), Math.min(PT.sgDesignP[g]*PIPE_BURST_K,
                                      p[g] + Math.max(-0.2*p[g], Math.min(0.2*p[g], d[g]))));
    setP(q); }
  if(best) setP(best);
  solve();
  eNetHold(0);
  for(let g=0;g<n;g++){ const b = bOf(g);
    s.sgFedBy[b] = SX.netFeed[b];
    s.steamBy[b] = s.hbSgQ[b]/rise(g, eSecP(g)); }
  eTurbRead();
}
/* the turbine's inlet pressure and what it passes less the bleed, off the last solve */
function eTurbRead(){
  const S = SX.netSc, sc = ST.sc;
  sc[SC_TURBP] = S[E_NS_TURBWKA] > 0 ? S[E_NS_TURBWKP]/S[E_NS_TURBWKA] : eCondP();
  sc[SC_TURBH] = S[E_NS_TURBWKA] > 0 ? S[E_NS_TURBWKH]/S[E_NS_TURBWKA] : 0;
  sc[SC_TURBWK] = Math.max(0, S[E_NS_TURBWK] - eBleedPlant());
}

/* each feed valve passes w[b] (NaN = left as it is): that flow imposed on its edge, the opening read off the drop the network puts across it through the edge's own law; a valve that would need more than wide open stays wide open */
function eFeedFit(w){
  const s = ST, E = PT.n.edge, F = SX;
  eNetImpose(w);
  try { eSettleSteady(); } finally { eNetImpose(null); }
  for(let e=0;e<E;e++){ if(PT.edCk[e] !== 4) continue;
    const b = PT.edFreg[e]; if(b < 0 || !(w[b] === w[b])) continue;
    eStaticHA(e); const h = E_EC[2]*PK[PK_HEADK], d = F.fP[PT.edU[e]] - F.fP[PT.edV[e]] + h;
    E_FG[FG_C] = 1; E_FG[FG_H] = h; E_FG[FG_HSRC] = 0; eFlowGA(e);
    const w1 = d*(PT.edShellSign[e] === -1 ? -1 : 1) > 0 ? E_FG[FG_G]*Math.abs(d) : 0;
    s.fregBy[b] = w1 > 0 ? Math.max(0, Math.min(1, 1 - w[b]/w1/PK[PK_FEEDC])) : 0; }
  return eSettleSteady();
}
/* at rest each feed valve passes what its shell raises */
function eSettleFeed(){
  const s = ST, nb = PT.n.boiler;
  if(!nb) return;
  const w = new Float64Array(nb);
  for(let b=0;b<nb;b++) w[b] = s.steamBy[b] > 0 ? s.steamBy[b] : E_NAN;
  eFeedFit(w);
  for(let b=0;b<nb;b++){ s.fregDemBy[b] = s.fregBy[b]; s.sgFedBy[b] = SX.netFeed[b]; }
}

/* kW the tubes must take for the steam space to hold: the enthalpy the solved field lands on it less its other sinks */
function eCondDuty(q){
  const i = PT.condVes[q];
  if(i < 0) return 0;
  eNetField(ST.pBy); eNodeInA(i); eCondSinkA(q);
  return E_NIN[1] - (E_CSK[0] - E_CSK[1]);
}
/* the condenser on the water that actually arrives, at the heat the field actually lands on it */
function eSettleCond(){
  const s = ST, sc = s.sc, nq = PT.n.cond;
  eCwFlowStep();
  for(let q=0;q<nq;q++){ let t = 0, n = 0;
    for(let k=PT.condCw0[q];k<PT.condCw0[q+1];k++){ const ref = PT.cwRef[k];
      const fwd = (ref > 1e-9 ? eKeyW(PT.cwKey[k])/ref : 0) >= 0, i = fwd ? PT.cwNodeA[k] : PT.cwNodeB[k];
      if(i >= 0){ t += eNodeT(i); n++; } }
    if(n) s.cwInTBy[q] = t/n; }
  const w = PT.sats[PT.satWater];
  let ti = 0, tc = 0, nv = 0, move = 0;
  for(let q=0;q<nq;q++){
    const c = eCwC(q), k = eWrecked(PT.condPart[q]) ? 0 : eCondFrac();
    const eps = c > 0 ? 1 - Math.exp(-PT.condUA[q]*k/c) : 0;
    const cs = PT.condCirc[q] >= 0 ? eCircSat(PT.condCirc[q]) : w, vn = PT.condVes[q];
    const was = s.condTBy[q];
    if(c > 0 && eps > 0) for(let it=0;it<E_STEADY_MAX;it++){
      const T0 = s.condTBy[q], T = eCwInAt(q) + Math.max(0, eCondDuty(q))/(c*eps);
      s.condTBy[q] = T; s.condPBy[q] = Math.max(COND_P0, satP(cs, T));
      if(Math.abs(T - T0) <= E_STEADY_TOL*T) break; }
    const t = eCondTRead(q);
    if(isFinite(t) && !PT.condVac[q]) s.condTBy[q] = Math.max(s.condTBy[q], t);
    s.condPBy[q] = Math.max(COND_P0, satP(cs, s.condTBy[q]));
    if(PT.condVac[q] && vn >= 0 && !PT.nodeBooked[vn]) eCondSeed(vn, satT(eNodeSat(vn), s.condPBy[q]));
    if(PT.condVac[q]){ ti += s.cwInTBy[q]; tc += s.condTBy[q]; nv++; }
    move = Math.max(move, was > 0 ? Math.abs(s.condTBy[q] - was)/was : 1); }
  if(nv){ sc[SC_CWINT] = ti/nv; sc[SC_CONDT] = tc/nv; }
  return move;
}

function engSettle(){
  ePkSync(); STBYTES.fill(0); engInit(); eNetInvalidate(); eRegionUpdate();
  const s = ST, sc = s.sc;
  eMachSeed();
  const seed = (Math.random()*4294967296)>>>0;
  sc[SC_SEED] = seed; sc[SC_RNG] = seed;
  for(let c=0;c<PT.n.core;c++) eCoreSeed(c, startOf("rodCommon", PT.coreRodX0[c]), PK[PK_N0]);
  eCoreAgg();
  sc[SC_SC] = satT(P.sat, sc[SC_P]) - (sc[SC_TAVG] + coreDT0()*sc[SC_HEAT]/2);
  for(let b=0;b<PT.n.boiler;b++) s.sgTBy[b] = satT(eBoilerSatOf(b), eBoilerP(b));
  eMachRestSeed();
  for(let c=0;c<PT.n.core;c++) eCoreReset(c, s.csFlowNet[c]);
  eCoreAgg();
  sc[SC_HBHEAT] = sc[SC_HEAT];

  for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b]) s.steamBy[b] = PK[PK_STEAMREF]/Math.max(1, PT.n.boiler);
  eSettleRest();
  for(let c=0;c<PT.n.core;c++) eCoreReset(c, s.csFlowNet[c]);
  eCoreAgg();
  for(let c=0;c<PT.n.core;c++) eCoreBanksSeed(c, startOf("rodCommon", PT.coreRodX0[c]));
  eCoreDialBoron();
  eSettleShells();
  E_SUA[1] = 1;
  for(let k=0;k<8 && eSettleUA(0.25, 4) > 1e-4;k++) eSettleShells();
  if(E_SUA[0]){ eSettleRest(1); eSettleShells(); for(let k=0;k<8 && eSettleUA(0.25, 4) > 1e-4;k++) eSettleShells(); }
  if(!PT.n.sg){ eNetHold(1); eSettleSolve(); eNetHold(0); eTurbRead(); }
  for(let k=0;k<E_STEADY_MAX;k++){ const d = eSettleCond(); eSettleFeed(); eInHSeed(); eTurbRead(); if(d <= E_STEADY_TOL) break; }
  eCoreFlowRead(); eCoreFlowSet();
  eCoreDialBoron();
  eAnnStep();
  eMassSeed();
  eInvSeal();
  eCoreSeal();
  eFpSeed();
  P.coreKg0 = PT.n.core ? PT.coreKg0[0] : 0;
  eMachPumpRho0();
  eRoomSeed();
  eCtlSeedOuts();
}

/* the commissioned plant put back exactly: a re-run settle lands it only to its own tolerances */
function engReset(){
  ePkSync();
  if(P.snap0 && P.dsig === designSig()) engRestore(P.snap0); else engSettle();
  eCtlSeedOuts();
}
