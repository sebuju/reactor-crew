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
  eTurbStep();
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
/* the held field solved until no edge flow, and no pressure of a node that passes flow, moves more than E_STEADY_TOL of the largest (an imposed flow pins a line's flows before its pressures); passes returned, E_STEADY_MAX = never settled */
function eSettleSteady(){
  const held = eNetHold(1), st = eNetSteady(1), E = PT.n.edge, n = PT.n.node;
  const prev = new Float64Array(E), prevP = new Float64Array(n), thru = new Float64Array(n);
  try {
    for(let pass=0;pass<E_STEADY_MAX;pass++){
      eSettleSolve();
      const q = SX.edQ, p = ST.pBy; let scale = 0, move = 0, pScale = 0, pMove = 0;
      thru.fill(0);
      for(let e=0;e<E;e++){ const a = Math.abs(q[e]); if(a > scale) scale = a;
        thru[PT.edU[e]] += a; thru[PT.edV[e]] += a;
        const d = Math.abs(q[e] - prev[e]); if(d > move) move = d; }
      for(let i=0;i<n;i++){ if(!(p[i] === p[i]) || !(thru[i] > E_STEADY_TOL*scale)) continue; const a = Math.abs(p[i]); if(a > pScale) pScale = a;
        const d = Math.abs(p[i] - prevP[i]); if(d > pMove) pMove = d; }
      if(pass && move <= E_STEADY_TOL*Math.max(scale, 1e-9) && pMove <= E_STEADY_TOL*Math.max(pScale, 1e-9)) return pass + 1;
      prev.set(q); prevP.set(p); }
    return E_STEADY_MAX;
  } finally { eNetHold(held); eNetSteady(st); }
}

function eSettleRest(){
  const s = ST, sc = s.sc, nb = PT.n.boiler, ng = PT.n.sg, n0 = PK[PK_N0];
  const hotWas = new Float64Array(ng).fill(E_NAN);
  eNetHold(1);
  for(let i=0;i<E_SETTLE_PASSES;i++){
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
      const p = dr ? PT.circSetP[ci] : eSecP(g), t = PT.boilerTank[b];
      s.hBy[node] = holdSeedH(ci, p, dr ? PT.tankLevel0[t] : E_SGL_SET/E_SG_DOME);
      s.mBy[node] = PT.nodeVol[node]*rhoMixOf(eCircSat(ci), p, s.hBy[node]); }
    for(let q=0;q<PT.n.cond;q++){ const node = PT.condVes[q];
      if(!PT.condVac[q] || node < 0 || !(s.hBy[node] === s.hBy[node])) continue;
      const c = eNodeSat(node), T = satT(c, eCondP());
      s.hBy[node] = hOfT(c, T);
      s.mBy[node] = PK[PK_CONDFILL0]/100*PT.nodeVol[node]*rhofOf(c, T); }
    for(let h=0;h<PT.trHoldCircs.length;h++){ const ci = PT.trHoldCircs[h]; if(!PT.circCore[ci]) continue;
      const c = eCircSat(ci), T = eTavgOf(ci);
      if(!isFinite(T)) continue;
      const dh = hOfT(c, c.Tref) - hOfT(c, T);
      if(Math.abs(dh) > 1e-9){
        for(let j=0;j<PT.n.node;j++)
          if(s.hBy[j] === s.hBy[j] && PT.nodeCirc[j] === ci && PT.nodeInLoop[j] && PT.nodeTank[j] < 0 && !PT.nodeHoldSet[j] && SX.tInM[j] > 1e-9) s.hBy[j] += dh;
      } }
    eSettleUA(0.5, 2);
    let moved = 0;
    for(let g=0;g<ng;g++){ eStageStream(g, 0); const t = SX.stgT[2*g];
      if(hotWas[g] === hotWas[g]) moved = Math.max(moved, Math.abs(t - hotWas[g]));
      hotWas[g] = t; }
    if(i > 20 && Math.abs(sc[SC_FLOWNET] - was) < 1e-5 && moved < 1e-3) break;
  }
  eNetHold(0);
  eTavgRead(0);
  eSettleStubs();
}
/* the suggested tubes sized for this point: one ratio step, largest relative miss returned */
function eSettleUA(lo, hi){
  const s = ST, sc = s.sc, ng = PT.n.sg, nn = Math.max(1, ng);
  const filmK = 1 - 0.85*Math.min(clamp(sc[SC_VF], 0, 1.5), 1);
  let any = false, miss = 0;
  for(let g=0;g<ng;g++){ const id = IX.sgId[g]; if(D.sgUA[id] != null) continue;
    const fl = Math.max(sc[SC_FLOWNET]*s.sgShare[g]*nn, .02);
    E_SQ[0] = fl; E_SQ[1] = filmK; eSgQ(g);
    const now = E_SQ[2], want = PK[PK_N0]*PK[PK_RATED]*1000/nn;
    if(now > 0 && want > 0){ const wcp = SX.stgC[2*g];
      const cap = isFinite(wcp) ? E_SG_NTU_MAX*wcp/Math.pow(fl, E_UA_FLOW) : E_INF;
      const was = PT.stageUA[g];
      PT.stageUA[g] = Math.min(was*clamp(want/now, lo, hi), cap);
      if(PT.stageUA[g] !== was) miss = Math.max(miss, Math.abs(want/now - 1));
      P.sgUABy[id] = PT.stageUA[g]; any = true; } }
  if(any){ let t = 0; for(let g=0;g<ng;g++) t += PT.stageUA[g]; P.sgUA = t/nn; }
  return miss;
}
/* a dead leg holds the water of the line it hangs off, not a seed nothing ever flowed through */
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
      s.hBy[v] = st[u]; s.mBy[v] = PT.nodeVol[v]*rhoMixOf(eNodeSat(v), eNodeP(v), st[u]); } }
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
    for(let g=0;g<n;g++) q[g] = clamp(p[g] + clamp(d[g], -0.2*p[g], 0.2*p[g]),
                                      eRegionPart(PT.sgPart[g]), PT.sgDesignP[g]*PIPE_BURST_K);
    setP(q); }
  if(best) setP(best);
  solve();
  eNetHold(0);
  const S = SX.netSc;
  sc[SC_TURBP] = S[E_NS_TURBWKA] > 0 ? S[E_NS_TURBWKP]/S[E_NS_TURBWKA] : eCondP();
  for(let g=0;g<n;g++){ const b = bOf(g);
    s.sgFedBy[b] = SX.netFeed[b];
    s.steamBy[b] = s.hbSgQ[b]/rise(g, eSecP(g)); }
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
    s.fregBy[b] = w1 > 0 ? clamp(1 - w[b]/w1/PK[PK_FEEDC], 0, 1) : 0; }
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

/* the condenser on the water that actually arrives, at the heat the shells actually send it */
function eSettleCond(){
  const s = ST, sc = s.sc, nq = PT.n.cond;
  for(let q=0;q<nq;q++){ let t = 0, n = 0;
    for(let k=PT.condCw0[q];k<PT.condCw0[q+1];k++){ const ref = PT.cwRef[k];
      const fwd = (ref > 1e-9 ? eKeyW(PT.cwKey[k])/ref : 0) >= 0, i = fwd ? PT.cwNodeA[k] : PT.cwNodeB[k];
      if(i >= 0){ t += eNodeT(i); n++; } }
    if(n) s.cwInTBy[q] = t/n; }
  let boilQ = 0;
  for(let b=0;b<PT.n.boiler;b++) boilQ += Math.max(0, s.steamBy[b] - eBleedOf(b))*eRiseCond(b, eBoilerP(b));
  const qAll = Math.max(0, boilQ - sc[SC_TURBWK]*eTurbDh(sc[SC_TURBP], eCondP()));
  const w = PT.sats[PT.satWater];
  let ti = 0, tc = 0, nv = 0;
  for(let q=0;q<nq;q++){
    const c = eCwC(q), k = eWrecked(PT.condPart[q]) ? 0 : eCondFrac();
    const eps = c > 0 ? 1 - Math.exp(-PT.condUA[q]*k/c) : 0;
    if(c > 0 && eps > 0) s.condTBy[q] = eCwInAt(q) + qAll/nq/(c*eps);
    const t = eCondTRead(q);
    if(isFinite(t) && !PT.condVac[q]) s.condTBy[q] = Math.max(s.condTBy[q], t);
    const cs = PT.condCirc[q] >= 0 ? eCircSat(PT.condCirc[q]) : w;
    s.condPBy[q] = Math.max(COND_P0, satP(cs, s.condTBy[q]));
    const vn = PT.condVes[q];
    if(PT.condVac[q] && vn >= 0 && !PT.nodeBooked[vn]){ const c = eNodeSat(vn), T = satT(c, s.condPBy[q]);
      s.hBy[vn] = hOfT(c, T); s.mBy[vn] = PK[PK_CONDFILL0]/100*PT.nodeVol[vn]*rhofOf(c, T); }
    if(PT.condVac[q]){ ti += s.cwInTBy[q]; tc += s.condTBy[q]; nv++; } }
  if(nv){ sc[SC_CWINT] = ti/nv; sc[SC_CONDT] = tc/nv; }
}

function engSettle(){
  ePkSync(); STBYTES.fill(0); engInit(); eNetInvalidate(); eRegionUpdate();
  const s = ST, sc = s.sc, x0 = startOf("rodCommon", RODX0);
  eMachSeed();
  const seed = (Math.random()*4294967296)>>>0;
  sc[SC_SEED] = seed; sc[SC_RNG] = seed;
  for(let c=0;c<PT.n.core;c++) eCoreSeed(c, x0, PK[PK_N0]);
  eCoreAgg();
  sc[SC_SC] = satT(P.sat, sc[SC_P]) - (sc[SC_TAVG] + coreDT0()*sc[SC_HEAT]/2);
  for(let b=0;b<PT.n.boiler;b++) s.sgTBy[b] = satT(eBoilerSatOf(b), eBoilerP(b));
  eMachRestSeed();
  for(let c=0;c<PT.n.core;c++) eCoreReset(c, s.csFlowNet[c]);
  eCoreAgg();
  sc[SC_HBHEAT] = sc[SC_HEAT];
  for(let c=0;c<PT.n.core;c++) s.hbHeatBy[c] = s.csHeat[c];

  eSettleRest();
  for(let c=0;c<PT.n.core;c++) eCoreReset(c, s.csFlowNet[c]);
  eCoreAgg();
  for(let c=0;c<PT.n.core;c++) eCoreBanksSeed(c, x0);
  eCoreDialBoron();
  eSettleShells();
  for(let k=0;k<8 && eSettleUA(0.25, 4) > 1e-4;k++) eSettleShells();
  for(let b=0;b<PT.n.boiler;b++) if(PT.boilerDrum[b] && !(s.steamBy[b] > 0))
    s.steamBy[b] = PK[PK_STEAMREF]/Math.max(1, PT.n.boiler);
  if(!PT.n.sg){ eNetHold(1); eSettleSolve(); eNetHold(0);
    const S = SX.netSc;
    sc[SC_TURBP] = S[E_NS_TURBWKA] > 0 ? S[E_NS_TURBWKP]/S[E_NS_TURBWKA] : eCondP();
    sc[SC_TURBWK] = Math.max(0, S[E_NS_TURBWK] - eBleedPlant()); }
  eSettleCond();
  eSettleFeed();
  eCoreDialBoron();
  eAnnStep();
  eMassSeed();
  eInvSeal();
  eCoreSeal();
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
