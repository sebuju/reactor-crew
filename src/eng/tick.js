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
  const steam = () => { const o = new Float64Array(n); for(let g=0;g<n;g++) o[g] = SX.netSgSteam[bOf(g)]; return o; };
  const solve = () => {
    E_TK[E_TK_HEAT] = sc[SC_HEAT]; E_TK[E_TK_FLOW] = sc[SC_FLOWNET]; eSgHeatStep();
    let was = null;
    for(let k=0;k<30;k++){
      eSettleSolve();
      const now = steam();
      if(was){ let ok = true;
        for(let g=0;g<n;g++) if(Math.abs(now[g] - was[g]) > 1e-6*Math.max(Math.abs(now[g]), 1)){ ok = false; break; }
        if(ok) break; }
      was = now; }
    const r = new Float64Array(n);
    for(let g=0;g<n;g++) r[g] = SX.netSgSteam[bOf(g)] - s.hbSgQ[bOf(g)]/rise(g, eSecP(g));
    return r; };
  eNetHold(1);
  let A = null, pPrev = null, rPrev = null, errPrev = E_INF;
  for(let it=0;it<40;it++){
    const p = pOf(), r0 = solve();
    let err = 0;
    for(let g=0;g<n;g++){ const w = s.hbSgQ[bOf(g)]/rise(g, p[g]); if(w > 0) err = Math.max(err, Math.abs(r0[g])/w); }
    if(err < 1e-6) break;
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
  solve();
  eNetHold(0);
  const S = SX.netSc;
  sc[SC_TURBP] = S[E_NS_TURBWKA] > 0 ? S[E_NS_TURBWKP]/S[E_NS_TURBWKA] : eCondP();
  for(let g=0;g<n;g++){ const b = bOf(g);
    s.sgFedBy[b] = SX.netFeed[b];
    s.steamBy[b] = s.hbSgQ[b]/rise(g, eSecP(g)); }
  sc[SC_TURBWK] = Math.max(0, S[E_NS_TURBWK] - eBleedPlant());
}

/* each feed valve is left where its own shell edge carries what the shell raises; the shells share a header, so the round repeats */
function eSettleFeed(){
  const s = ST, nb = PT.n.boiler;
  if(!nb) return;
  eNetHold(0);
  const feedAt = () => { let was = null;
    for(let k=0;k<30;k++){ eSettleSolve();
      const now = Float64Array.from(SX.netFeed);
      if(was){ let ok = true;
        for(let b=0;b<nb;b++) if(Math.abs(now[b] - was[b]) > 1e-4*Math.max(Math.abs(now[b]), 1)){ ok = false; break; }
        if(ok) break; }
      was = now; } };
  const seed = P.fregSeed || {};
  const want = b => s.steamBy[b] || 0;
  const jb = []; for(let b=0;b<nb;b++) if(want(b) > 0) jb.push(b);
  if(jb.length > 1){
    const n = jb.length, x = new Float64Array(n);
    for(let j=0;j<n;j++){ const g = seed[IX.boilerId[jb[j]]]; x[j] = clamp(g === undefined ? s.fregBy[jb[j]] : g, 0, 1); }
    const setX = () => { for(let j=0;j<n;j++) s.fregBy[jb[j]] = x[j]; };
    const resid = out => { setX(); feedAt();
      let err = 0;
      for(let j=0;j<n;j++){ const w = want(jb[j]); out[j] = (SX.netFeed[jb[j]] - w)/w;
        const a = Math.abs(out[j]); if(a > err) err = a; }
      return err; };
    const r0 = new Float64Array(n), r1 = new Float64Array(n), dx = new Float64Array(n);
    let err = resid(r0), J = null;
    for(let it=0; it<12 && err > 1e-5; it++){
      if(!J){ J = []; for(let i=0;i<n;i++) J.push(new Float64Array(n));
        for(let j=0;j<n;j++){ const x0 = x[j], h = (x0 > 0.5 ? -1 : 1)*1e-3;
          x[j] = clamp(x0 + h, 0, 1);
          const hh = x[j] - x0;
          if(hh === 0){ J = null; break; }
          resid(r1);
          for(let i=0;i<n;i++) J[i][j] = (r1[i] - r0[i])/hh;
          x[j] = x0; }
        if(!J) break;
        resid(r0); }
      if(!denseSolve(J, Float64Array.from(r0), dx, n)) break;
      let step = 1, ok = false;
      for(let t=0;t<6;t++){
        for(let j=0;j<n;j++) x[j] = clamp(x[j] - step*dx[j], 0, 1);
        const e2 = resid(r1);
        if(e2 < err){ err = e2; r0.set(r1); ok = true; break; }
        for(let j=0;j<n;j++) x[j] = clamp(x[j] + step*dx[j], 0, 1);
        step /= 2; }
      if(!ok) break;
      J = null; }
    setX();
    for(let j=0;j<n;j++) seed[IX.boilerId[jb[j]]] = x[j];
  }
  for(let r=0;r<12;r++){
    let moved = 0;
    for(let b=0;b<nb;b++){ const w = want(b); if(!(w > 0)) continue;
      const was = s.fregBy[b], tol = 1e-6*w;
      const f = v => { s.fregBy[b] = v; feedAt(); return SX.netFeed[b] - w; };
      const land = v => { s.fregBy[b] = v; moved = Math.max(moved, Math.abs(v - was)); };
      let a = 0, fa, hi = 1, fb, side = 0;
      const g = r ? was : seed[IX.boilerId[b]];
      if(g !== undefined){
        const f0 = f(g); if(Math.abs(f0) < tol){ land(g); continue; }
        let d = 0.05;
        if(f0 > 0){ a = g; fa = f0; hi = Math.min(g + d, 1); fb = f(hi);
          while(fb > 0 && hi < 1){ d *= 2; hi = Math.min(hi + d, 1); fb = f(hi); } }
        else { hi = g; fb = f0; a = Math.max(g - d, 0); fa = f(a);
          while(fa < 0 && a > 0){ d *= 2; a = Math.max(a - d, 0); fa = f(a); } } }
      else { fa = f(a); fb = f(hi); }
      if(fa <= 0){ land(a); continue; }
      if(fb >= 0){ land(hi); continue; }
      for(let k=0;k<30;k++){
        const c = (a*fb - hi*fa)/(fb - fa), fc = f(c);
        if(Math.abs(fc) < tol){ a = hi = c; break; }
        if(fc > 0){ a = c; fa = fc; if(side === 1) fb /= 2; side = 1; }
        else { hi = c; fb = fc; if(side === -1) fa /= 2; side = -1; } }
      land((a + hi)/2); }
    if(moved < 1e-5) break; }
  const keep = {};
  for(let b=0;b<nb;b++){ keep[IX.boilerId[b]] = s.fregBy[b]; s.fregDemBy[b] = s.fregBy[b]; }
  P.fregSeed = keep;
  eSettleSolve();
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
  eSettleFeed();
  eSettleCond();
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

/* the commissioned plant put back exactly: the settle is a fixed-point walk that limit-cycles, so re-running it lands a different plant */
function engReset(){
  ePkSync();
  if(P.snap0 && P.dsig === designSig()) engRestore(P.snap0); else engSettle();
  eCtlSeedOuts();
}
