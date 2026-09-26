"use strict";
// imports: eOpenKg(o) eOpenH2(o) eH2Total() eBook(code,kg) E_BK_SUMP E_BK_INJECT eCondP() eSecP(g) eNodeT eNodeX eRegionUpdate eRadCellA E_TRIP_VESSEL eSgLiftP() eBoilerLvl(b) eCondFrac() eTProgA(c) eTripNear() eRpsState() eRunbackWired() eRunbackLive() eNetDryAny() eFlowDemPri() eInjAny()
// exports: eRoomSeed eSumpStep eInjectFluid eRoomStep eBlastStep eOverpressureStep eBurnFireStep eCookStep eEvLatchStep eAnnStep eAnnEval eAnnCore eRepairStep eRepairRadRate eDamage eDmgHit eDmgFix eRoomBang eRoomBlastCharge eContRel eRoomVgas eRoomVgasA eRoomH2Frac eRoomO2Frac eRoomCOFrac eRoomCO2Frac eRoomCorFill eRoomCorMolten eRoomCorT eRoomPoolT eRoomWaterT ePartSkin ePartTemp eRoomOverAny eRoomH2PeakA eRadWorkK eLqShut eEventText eEventTextOf E_TXT_WHY E_TXT_EV

const E_RU = 8.314462618;
const E_ROOM_DMG_SPAN = 60, E_ROOM_DMG_TAU = 25, E_CRUSH_K = 10, E_CRUSH_SPAN = 0.5, E_CRUSH_TAU = 60;
const E_ANN_TICKS = 5, E_H2_EV = 20, E_RAD_DOSE_K = 0.25, E_RAD_SLOW = 0.5;
const E_INJ_HEAT = 1, E_INJ_GAS = 2, E_INJ_FLUID = 3, E_INJ_H2 = 4, E_INJ_O2 = 5, E_INJ_STEAM = 6;
const E_WHY_WRECKED = 0, E_WHY_HIT = 1, E_WHY_FLOODED = 2, E_WHY_BLAST = 3, E_WHY_CRUSHED = 4, E_WHY_OVERPRESSURE = 5, E_WHY_COOKED = 6, E_WHY_BURST = 7, E_WHY_WATER = 8;
const E_TXT_WHY = ["WRECKED", "HIT", "FLOODED", "BLAST", "CRUSHED", "OVERPRESSURE", "COOKED", "BURST", "WATER"];
const eOpenKg = o => PT.openOut[o] >= 0 ? eOutKg(PT.openOut[o]) : 0;
const eOpenH2 = o => PT.openOut[o] >= 0 ? eOutH2(PT.openOut[o]) : 0;
const E_ANN_NAME = ["HI FLUX","LO DNBR","FUEL DMG","LO PRESS","HI PZR LVL","LO SUBCOOL","TAVG DEV","XENON PIT","RECRITICAL",
  "ROD JAM","PORV OPEN","CORE VOID","RX TRIP","HI PRESS","CAVITATION","LO FLOW","NO RPS","RX BREACH","BLACKOUT","CORE MELT",
  "SG HI PRES","SG BURST","LO SG LVL","SG DRY","HOTWELL HI","TURB TRIP","NO VACUUM","ROD LIMIT","NEAR TRIP","AREA RAD",
  "CLAD OXID","FUEL MELT","HI ROOM T","H2 FIRE","H2 LFL","NO SINK","PANEL HI T","NA FIRE","RPS OFF","NO RUNBACK"];
const E_LATCH_EV = [EV_HIPOW, EV_DNBR13, EV_DNBR10, EV_REACTOR_TRIP, EV_RECRIT, EV_CAVITATION, EV_LINE_DRY, EV_FLOW_FLOOR,
  EV_PRI_OVERP, EV_RELIEF_PASSING, EV_PORV_STUCK, EV_CORE_VOID, EV_HIRAD, EV_ROOM_HOT, EV_H2_ROOM, EV_XENON_PIT, EV_ROD_JAM,
  EV_RPS_OFF, EV_RUNBACK_OFF, EV_NO_RPS, EV_INJECTING, EV_FUEL_DMG1, EV_FUEL_DMG25, EV_WATCH_DOSE, EV_VESSEL_FATIGUE,
  EV_VESSEL_BREACH, EV_CLAD_OX, EV_H2_PRIMARY, EV_CORE_MELTED];
const E_LATCH_N = E_LATCH_EV.length;
const E_LATCH_STICKY = new Uint8Array(E_LATCH_N);
for(let k=19;k<E_LATCH_N;k++) if(k !== 20) E_LATCH_STICKY[k] = 1;
const E_GEN_PLUME = 0, E_GEN_RING = 1, E_GEN_LIVE = 2, E_GEN_RINGN = 3, E_GEN_OPEN = 5, E_GEN_LAND = 6;

const eClamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
/* s per cell of board, the time sound takes to cross it: derived, so no fitted number enters the blast baseline */
const E_PQS_K = MPC/Math.sqrt(GAM_AIR*R_SI*T_HULL);
/* Brown & Solvason (1962), Int. J. Heat Mass Transfer 5, 859-868, carried into the SFPE Handbook's Vent
   Flows chapter: two spaces joined by a vertical opening of height H and width W exchange air two ways,
   V = (1/3) Cd W H^1.5 sqrt(g dT/Tc) each way, so Q = rho cp V dT = K dT^1.5. Cd 0.65, the middle of the
   measured 0.6-0.7. E_VENT_K is everything in K that is geometry. */
const E_VENT_CD = 0.65;
const E_VENT_K = E_VENT_CD/3*ROOM_DEPTH*Math.sqrt(G_MPA*1e6);

/* the two liquids' views onto ST, rebound when ST or PT is replaced */
const E_LQ = [
  {M:null, E:null, rho:WATER_RHO, bulk:WATER_BULK, vu:null, vv:null, P:null, O:null, oRho:1000, U:null, L:null, tag:0, st:null, pt:null},
  {M:null, E:null, rho:1000, bulk:WATER_BULK, vu:null, vv:null, P:null, O:null, oRho:WATER_RHO, U:null, L:null, tag:1, st:null, pt:null}];
function eLqBind(){
  const w = E_LQ[0], m = E_LQ[1];
  if(w.st === ST && w.pt === PT && w.M === ST.roomWater) return;
  w.M = ST.roomWater; w.E = ST.roomWaterE; w.vu = ST.roomWU; w.vv = ST.roomWV; w.P = ST.roomWP; w.O = ST.roomPool; w.L = ST.roomPool;
  w.oRho = PK[PK_RFIRERHO]; w.st = ST; w.pt = PT;
  m.M = ST.roomPool; m.E = ST.roomPoolE; m.vu = ST.roomPoolU; m.vv = ST.roomPoolV; m.P = ST.roomPoolP; m.O = ST.roomWater;
  m.rho = PK[PK_RFIRERHO]; m.bulk = PK[PK_RFIREBULK]; m.U = ST.roomWater; m.st = ST; m.pt = PT;
}

/* the face mask with every shot gas-tight cell opened; rebuilt only when a paint cell's wreck flag moves */
function eRoomLive(){
  const T = PT, n = T.nPaint, W = SX.rHoleWas, D0 = ST.dmgBy;
  let moved = SX.rGen[E_GEN_LIVE] === 0;
  for(let k=0;k<n;k++){ const a = T.paintPart[k];
    const h = (a >= 0 && T.paintTight[k] && D0[a]) ? 1 : 0;
    if(h !== W[k]){ W[k] = h; moved = true; } }
  if(!moved) return;
  SX.rGen[E_GEN_LIVE] = 1;
  const N = GW*GH, hole = SX.rHole, bx = SX.rBx, by = SX.rBy, gx = SX.rGx, gUp = SX.rGUp, gDn = SX.rGDn;
  const occ = T.rOcc, tight = T.rTight, g0 = ROOM_MIX/(MPC*MPC);
  hole.fill(0);
  for(let k=0;k<n;k++) if(W[k]) hole[T.paintCell[k]] = 1;
  for(let i=0;i<N;i++){ bx[i] = 0; by[i] = 0; gx[i] = 0; gUp[i] = 0; gDn[i] = 0; }
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW + X, bi = hole[i] ? 1 : tight[i] ? 0 : (occ[i] ? ROOM_BLOCK : 1);
    if(X < GW-1){ const j = i+1, bj = hole[j] ? 1 : tight[j] ? 0 : (occ[j] ? ROOM_BLOCK : 1);
      bx[i] = bi*bj; gx[i] = g0*bx[i]; }
    if(Y < GH-1){ const j = i+GW, bj = hole[j] ? 1 : tight[j] ? 0 : (occ[j] ? ROOM_BLOCK : 1);
      by[i] = bi*bj; const b = g0*by[i]; gUp[i] = b*ROOM_UP; gDn[i] = b; }
  }
  /* A vertical opening exchanges air two ways on the stack effect, and H^1.5 belongs to the OPENING, not
     to a face: six holes stacked pass 6^1.5 times one, never 6 times. So the live holes are walked into
     contiguous vertical runs here, and the ordinary eddy conduction across the wall line is stood down -
     the buoyant term replaces it, it does not add to it. A hole in a DECK is a different correlation and
     keeps the ordinary term. */
  const opX = SX.rOpX, opY = SX.rOpY, opN = SX.rOpN;
  let no = 0;
  for(let Y=0;Y<GH;Y++) for(let X=1;X<GW-1;X++){
    const i = Y*GW + X;
    if(!hole[i] || tight[i-1] || tight[i+1]) continue;
    gx[i-1] = 0; gx[i] = 0;
    if(Y > 0 && hole[i-GW] && !tight[i-GW-1] && !tight[i-GW+1]) continue;
    let k = 1;
    while(Y + k < GH && hole[i + k*GW] && !tight[i + k*GW - 1] && !tight[i + k*GW + 1]) k++;
    opX[no] = X; opY[no] = Y; opN[no] = k; no++;
  }
  SX.rGen[E_GEN_OPEN] = no;
}

function ePartTempA(a){
  const T = PT, k = T.partThermIx[a];
  let v = E_NAN;
  switch(T.partTherm[a]){
    case 1: v = ST.sgTBy[k]; break;
    case 2: { const k0 = T.partTNode0[a], k1 = T.partTNode0[a+1];
      if(k1 === k0){ v = ST.sc[SC_TAVG]; break; }
      let t = 0; for(let q=k0;q<k1;q++){ eNodeTA(T.partTNodeIx[q]); t += E_NT[MX_T]; }
      v = t/(k1 - k0); break; }
    case 3: v = ST.condTBy[k]; break;
    case 4: v = ST.radTBy[k]; break;
    case 5: v = ST.sc[SC_TAVG]; break;
  }
  E_RR[RR_PTMP] = v;
}
const ePartTemp = a => { ePartTempA(a); return E_RR[RR_PTMP]; };
function ePartSkinA(a){
  const v = ST.partT[a];
  if(v >= 0){ E_RR[RR_SK] = v; return; }
  ePartTempA(a); const t = E_RR[RR_PTMP];
  E_RR[RR_SK] = isFinite(t) ? t : T_HULL;
}
const ePartSkin = a => { ePartSkinA(a); return E_RR[RR_SK]; };

function ePartCells(a, buf){
  if(a < 0) return 0;
  const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1];
  for(let k=k0;k<k1;k++) buf[k-k0] = PT.partCellIx[k];
  return k1 - k0;
}
/* the donor node's water: highest pressure face with a readable state; a run or a cavity is its own node */
function eOpenFl(o){
  const T = PT, s = ST, k0 = T.openNode0[o], k1 = T.openNode0[o+1], kind = T.openKind[o];
  if(kind === 1 || kind === 2){ if(k1 === k0) return -1;
    const i = T.openNodeIx[k0]; return isFinite(s.hBy[i]) ? i : -1; }
  let best = -1, bp = -E_INF;
  for(let k=k0;k<k1;k++){ const i = T.openNodeIx[k], p = s.pBy[i];
    if(!(p > bp)) continue;
    eNodeTA(i); if(!isFinite(E_NT[MX_T])) continue;
    bp = p; best = i; }
  return best >= 0 && isFinite(s.hBy[best]) ? best : -1;
}
/* a run opens only at its shot cells and wrecked nozzles; anything else at its own box */
function eOpenCells(o, buf){
  const T = PT, D0 = ST.dmgBy;
  if(T.openKind[o] !== 2) return ePartCells(T.openPart[o], buf);
  let n = 0;
  for(let k=T.openCell0[o];k<T.openCell0[o+1];k++){ const a = T.openCellPart[k];
    if(a >= 0 && D0[a]) buf[n++] = T.openCellIx[k]; }
  for(let j=0;j<2;j++){ const a = T.openPortPart[2*o+j], c = T.openPortCell[2*o+j];
    if(a >= 0 && c >= 0 && D0[a]) buf[n++] = c; }
  return n;
}
/* a torn machine drains from the middle of its bottom row as one stream */
function eOpenPour(o, cells, nc){
  const b = SX.rCells2, pour = PT.openPour[o];
  if(pour >= 0 && nc > 0){ b[0] = pour; return 1; }
  for(let k=0;k<nc;k++) b[k] = cells[k];
  return nc;
}
/* an opening's fission products: noble gas on its plume, volatiles in its poured water save the flash's 1/FP_PC; no cell, booked */
function eFpRoomStep(dt){
  const s = ST, sc = s.sc, cells = SX.rCells, pour = SX.rCells2;
  for(let o=0;o<PT.nOpen;o++){ const q = PT.openOut[o]; if(q < 0) continue;
    const n = s.outFpN[q], v = s.outFpV[q]; if(!(n > 0) && !(v > 0)) continue;
    const nc = eOpenCells(o, cells);
    if(!nc){ sc[SC_FPBOOKN] += n; sc[SC_FPBOOKV] += v; continue; }
    E_RR[RR_B] = Math.max(0, eOpenKg(o))/dt; const m = ePlume(cells, nc);
    E_RR[RR_C] = n; eSpreadQ(s.roomFpN, m);
    const nd = eOpenFl(o);
    let air = 0;
    if(nd >= 0 && !PT.satBurn[PT.nodeSat[nd]]){ eFlashXA(PT.sats[PT.nodeSat[nd]], nd, cells[0]); air = v*E_RR[RR_X]/FP_PC; }
    E_RR[RR_C] = air; eSpreadQ(s.roomFpV, m);
    const np = eOpenPour(o, cells, nc), w = (v - air)/np;
    for(let k=0;k<np;k++) s.roomFpW[pour[k]] += w; }
}
/* the flashed share of node nd's water let go at cell i, into E_RR[RR_X] */
function eFlashXA(c, nd, i){
  const h = ST.hBy[nd], io = E_RP;
  io[0] = (ROOM_P0 + (i >= 0 ? Math.max(0, ST.roomP[i]) : 0))/1000;
  satTA(c, io, 0, 1); curveA(c, CV_HFG, io, 1, 2); satHA(c, io, 0, 3);
  const hfg = io[2];
  E_RR[RR_X] = hfg > 0 ? eClamp((h - io[3])/hfg, 0, 1) : 1;
}

/* breadth-first out of the opening at E_RR[RR_B] kg/s; weight 1/(1+ring), normalised into SX.rPlW; returns the count in SX.rPlQ */
function ePlume(cells, nc){
  const kgps = E_RR[RR_B];
  const N = GW*GH, seen = SX.rPlSeen, Q = SX.rPlQ, ring = SX.rPlRing, W = SX.rPlW, tight = PT.rTight, g = SX.rGen;
  const want = eClamp(Math.round(kgps*ROOM_ENTRAIN*ROOM_JET_TAU/ROOM_MAIR), nc, N);
  if(g[E_GEN_PLUME] >= 2147483600){ seen.fill(0); g[E_GEN_PLUME] = 0; }
  const mark = ++g[E_GEN_PLUME];
  let head = 0, tail = 0;
  for(let k=0;k<nc;k++){ const i = cells[k]; if(seen[i] !== mark){ seen[i] = mark; ring[i] = 0; Q[tail++] = i; } }
  while(head < tail && tail < want){
    const i = Q[head++], X = i%GW, Y = (i/GW)|0, r = ring[i] + 1;
    if(Y > 0){ const j = i-GW; if(seen[j] !== mark && !tight[j] && tail < want){ seen[j] = mark; ring[j] = r; Q[tail++] = j; } }
    if(X > 0){ const j = i-1; if(seen[j] !== mark && !tight[j] && tail < want){ seen[j] = mark; ring[j] = r; Q[tail++] = j; } }
    if(X < GW-1){ const j = i+1; if(seen[j] !== mark && !tight[j] && tail < want){ seen[j] = mark; ring[j] = r; Q[tail++] = j; } }
    if(Y < GH-1){ const j = i+GW; if(seen[j] !== mark && !tight[j] && tail < want){ seen[j] = mark; ring[j] = r; Q[tail++] = j; } }
  }
  let w = 0;
  for(let k=0;k<tail;k++) w += 1/(1 + ring[Q[k]]);
  for(let k=0;k<tail;k++) W[k] = 1/(1 + ring[Q[k]])/w;
  return tail;
}
/* the three plume spreaders take their amount in E_RR[RR_C] */
function eSpreadQ(F, m){
  const amount = E_RR[RR_C];
  if(!(amount > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW;
  for(let k=0;k<m;k++) F[Q[k]] += amount*W[k];
}
function eAddH2Q(m){
  const kg = E_RR[RR_C];
  if(!(kg > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW, H = ST.roomH2, M = ST.roomM;
  for(let k=0;k<m;k++){ const i = Q[k], d = kg*W[k]; H[i] += d; M[i] += d; }
}
/* steam goes in as mass on the plume weights times each cell's gas room, so a flooded cell takes none */
function eAddGasQ(m){
  const kg = E_RR[RR_C];
  if(!(kg > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW;
  let w = 0;
  for(let k=0;k<m;k++){ eRoomVgasA(Q[k]); w += W[k]*E_RR[RR_VG]; }
  if(!(w > 0)) return;
  const M = ST.roomM, V = ST.roomVap;
  for(let k=0;k<m;k++){ const i = Q[k]; eRoomVgasA(i); const dm = kg*W[k]*E_RR[RR_VG]/w; M[i] += dm; V[i] += dm; }
}
/* kg/s in E_RR[RR_B], its enthalpy in E_RR[RR_D] */
/* A stream may not drive the air past its OWN temperature - the same cap eFireStep takes on a burning
   pool. E_RR[RR_T] is the donor's temperature: for a flashing break it is the saturation temperature the
   mixture is pinned at, for a relief or a shell vent the steam's own. Without it the deposit is sensible
   heat with nothing behind it, and on a REAL air capacity a plume cell runs to thousands of kelvin no
   source in the plant can reach. */
function eJetQCapA(i){
  const q = E_RR[RR_QC], Td = E_RR[RR_T];
  if(!(q > 0) || !(Td > 0)){ if(!(q > 0)) E_RR[RR_QC] = 0; return; }
  eRoomGasA(i);
  const cap = E_RR[RR_CVC]*(Td - ST.roomT[i])/E_RR[RR_QDT];
  E_RR[RR_QC] = q < cap ? q : cap > 0 ? cap : 0;
}
function eJetLiqQ(src, m, c){
  const kgps = E_RR[RR_B], h = E_RR[RR_D];
  if(!(kgps > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW, Tr = ST.roomT;
  for(let k=0;k<m;k++){ const i = Q[k]; E_RP[5] = Tr[i]; hOfTA(c, E_RP, 5, 6);
    E_RR[RR_QC] = kgps*W[k]*(h - E_RP[6]); eJetQCapA(i); src[i] += E_RR[RR_QC]; }
}
/* the plume spreader with the same cap on it */
function eSpreadQCap(src, m){
  const amount = E_RR[RR_C];
  if(!(amount > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW;
  for(let k=0;k<m;k++){ E_RR[RR_QC] = amount*W[k]; eJetQCapA(Q[k]); src[Q[k]] += E_RR[RR_QC]; }
}

/* per-cell readers answer in E_RR: a double returned across a call V8 did not inline is a heap allocation */
const E_RR = new Float64Array(54);
const RR_VG = 0, RR_MX = 1, RR_H2F = 2, RR_O2F = 3, RR_PTMP = 4, RR_T = 5, RR_SK = 6, RR_W = 7, RR_CAP = 8, RR_SIDE = 9,
  RR_DRV = 10, RR_FALL = 11, RR_FILL = 12, RR_SURF = 13, RR_PT = 14, RR_X = 15, RR_A = 16, RR_B = 17, RR_C = 18, RR_D = 19,
  RR_HM = 21, RR_WI = 22, RR_WJ = 23, RR_FV2 = 24, RR_PF = 25, RR_LDSP = 26, RR_SWV = 27, RR_LKG = 29, RR_LKJ = 30, RR_LV0 = 31, RR_H2PK = 32, RR_GW = 34, RR_BANG = 36, RR_PMAX = 37, RR_CR = 38,
  RR_CVC = 39, RR_CPC = 40, RR_UC = 41, RR_MR = 42, RR_QC = 43, RR_QDT = 44, RR_WRHO = 45, RR_VO = 46, RR_WKAP = 47, RR_EXC = 48, RR_LOAD = 49, RR_DAD = 50, RR_RZ = 51, RR_COF = 52, RR_IGN = 53;

/* The one gas-property law in the compartment: mass fractions in, c_p / u / R of the mixture out, each
   species off its own NIST c_p(T). Everything that needs a heat capacity in here comes through it. */
const E_GS = new Float64Array(3), E_GMX = new Float64Array(10);
const GX_YA = 0, GX_YV = 1, GX_YH = 2, GX_CP = 3, GX_U = 4, GX_RG = 5, GX_T = 6, GX_YO = 7, GX_YC = 8, GX_YD = 9;
const E_GX_Y = new Int32Array([GX_YA, GX_YV, GX_YH, GX_YO, GX_YC, GX_YD]);
function eMixA(){
  E_GS[2] = E_GMX[GX_T];
  let cp = 0, u = 0, rg = 0;
  for(let s=0;s<ROOM_SP_N;s++){ const y = E_GMX[E_GX_Y[s]];
    if(y === 0) continue;
    roomSpA(s, E_GS, 2, 0); cp += y*E_GS[0]; u += y*E_GS[1]; rg += y*ROOM_SP_R[s]; }
  E_GMX[GX_CP] = cp; E_GMX[GX_U] = u; E_GMX[GX_RG] = rg;
}
/* E_GS[1] = h kJ/kg of species s at T, u + R*T on the same datum */
function eSpHA(s, T){ E_GS[2] = T; roomSpA(s, E_GS, 2, 0); E_GS[1] += ROOM_SP_R[s]*T; }
function eMixOf(i){
  const s = ST, m = s.roomM[i];
  let yv = m > 0 ? s.roomVap[i]/m : 0, yh = m > 0 ? s.roomH2[i]/m : 0, yc = m > 0 ? s.roomCO[i]/m : 0, yd = m > 0 ? s.roomCO2[i]/m : 0;
  if(!(yv > 0)) yv = 0; if(!(yh > 0)) yh = 0; if(!(yc > 0)) yc = 0; if(!(yd > 0)) yd = 0;
  const t = yv + yh + yc + yd;
  if(t > 1){ yv /= t; yh /= t; yc /= t; yd /= t; }
  const x = 1 - yv - yh - yc - yd, yo = m > 0 ? (s.roomO2[i]/m - ROOM_Y_O2*x)/(1 - ROOM_Y_O2) : 0;
  E_GMX[GX_YV] = yv; E_GMX[GX_YH] = yh; E_GMX[GX_YC] = yc; E_GMX[GX_YD] = yd; E_GMX[GX_YO] = yo; E_GMX[GX_YA] = x - yo;
}
/* The cell's own gas: RR_CPC = m*c_p kJ/K, RR_CVC = m*c_v, RR_MR = m*R, RR_UC = its internal energy kJ
   (datum u(T_SPACE) = 0), so the enthalpy it carries is (U + T*m*R)/m. */
function eRoomGasA(i){
  const m = ST.roomM[i] > 0 ? ST.roomM[i] : 0;
  eMixOf(i); E_GMX[GX_T] = ST.roomT[i]; eMixA();
  E_RR[RR_CPC] = m*E_GMX[GX_CP]; E_RR[RR_MR] = m*E_GMX[GX_RG];
  E_RR[RR_CVC] = E_RR[RR_CPC] - E_RR[RR_MR]; E_RR[RR_UC] = m*E_GMX[GX_U];
}
/* kJ/K under which a cell holds no gas worth a temperature: a milligram of air */
const E_CV_MIN = 7e-7;
/* T of cell i at internal energy E_RR[RR_UC], Newton on u(T) whose own slope is c_v(T) */
function eRoomTofUA(i){
  const m = ST.roomM[i] > 0 ? ST.roomM[i] : 0, U = E_RR[RR_UC];
  if(!(m > 0)) return;
  eMixOf(i);
  let T = ST.roomT[i];
  for(let k=0;k<5;k++){
    E_GMX[GX_T] = T; eMixA();
    const c = m*(E_GMX[GX_CP] - E_GMX[GX_RG]);
    if(!(c > E_CV_MIN)) break;
    const d = (U - m*E_GMX[GX_U])/c;
    T += d;
    if(T < T_SPACE) T = T_SPACE; else if(T > ROOM_TMAX) T = ROOM_TMAX;
    if(d < 1e-9 && d > -1e-9) break;
  }
  ST.roomT[i] = T;
}
const E_WIO = new Float64Array(MX_N);
/* room water at its own IF97 liquid density; past its bubble point it is liquid at its own temperature until eWaterHeat boils it */
function eRoomWRhoA(i){
  const m = ST.roomWater[i];
  if(!(m > 0)){ E_RR[RR_WRHO] = WATER_RHO; return; }
  // a rounding residue carries no meaningful energy
  const h = ST.roomWaterE[i]/m; eWRhoA(i, h > WL_H[0] ? h : WL_H[0]);
}
function eWRhoA(i, h){ const io = E_WIO; io[MX_P] = (ROOM_P0 + Math.max(0, ST.roomWater[i] > 0 ? ST.roomWP[i] : ST.roomP[i]))/1000; io[MX_H] = h; eWRhoIoA(); }
/* density at E_WIO's (p, h) into E_RR[RR_WRHO] */
function eWRhoIoA(){
  const io = E_WIO;
  wtEndsA(io, MX_P);
  if(io[MX_P] < WATER_PC && io[MX_H] >= WQ[Q_HL]){
    wTfA(io, MX_H, MX_TL); wRfA(io, MX_TL, MX_RHO); }
  else wtAtHA(io, MX_H, MX_RHO, 1, 0);
  E_RR[RR_WRHO] = io[MX_RHO];
}
/* room water's isentropic compressibility, 1/Pa, at its own state: its compression books v dp, so kappa_s = kappa_h - (dv/dh)_p; liquid past its bubble point is read just above its own saturation pressure */
function eRoomWKapA(i){
  const m = ST.roomWater[i];
  if(!(m > 0)){ E_RR[RR_WKAP] = 1/WATER_BULK; return; }
  const io = E_WIO, h0 = ST.roomWaterE[i]/m, h = h0 > WL_H[0] ? h0 : WL_H[0];
  io[MX_P] = (ROOM_P0 + Math.max(0, ST.roomWP[i]))/1000; io[MX_H] = h;
  wtEndsA(io, MX_P);
  if(io[MX_P] < WATER_PC && h >= WQ[Q_HL]){ wTfA(io, MX_H, MX_TL); if97PsatA(io, MX_TL, MX_P); io[MX_P] *= 1.001; }
  wKapA(io, MX_P, MX_H, MX_KAP);
  const kh = io[MX_KAP], p = io[MX_P];
  io[MX_H] = h; eWRhoIoA(); const r0 = E_RR[RR_WRHO];
  io[MX_P] = p; io[MX_H] = h + 1; eWRhoIoA(); const ks = kh*1e-6 - (1/E_RR[RR_WRHO] - 1/r0)*1e-3;
  E_RR[RR_WKAP] = kh > 0 && ks > 0 ? ks : 1/WATER_BULK;
}
function eRoomVgasA(i){ const w = ST.roomWater[i];
  let v = 0; if(w > 0){ eRoomWRhoA(i); v = w/E_RR[RR_WRHO]; }
  const cv = (ST.roomCorF[i] + ST.roomCorK[i])/CORIUM.rhoDebris + ST.roomCorS[i]/CORIUM.slagRho;
  E_RR[RR_VG] = Math.max(ROOM_VG_MIN*ROOM_VCELL, ROOM_VCELL - v - ST.roomPool[i]/PK[PK_RFIRERHO] - cv); }
const eRoomVgas = i => { eRoomVgasA(i); return E_RR[RR_VG]; };
const eGasCell = vg => vg > ROOM_VG_MIN*ROOM_VCELL*1.0001;
/* moles of everything in cell i but its hydrogen: dry air, the oxygen over or under air's share, steam, CO and CO2 */
function eRoomMolXA(i){ const s = ST, x = Math.max(0, s.roomM[i] - s.roomH2[i] - s.roomVap[i] - s.roomCO[i] - s.roomCO2[i]), ex = (s.roomO2[i] - ROOM_Y_O2*x)/(1 - ROOM_Y_O2);
  E_RR[RR_MX] = (x - ex)/AIR_MMOL + ex/O2_MMOL + s.roomVap[i]/H2O_MMOL + s.roomCO[i]/CO_MMOL + s.roomCO2[i]/CO2_MMOL; }
/* every species at its own molar mass: hydrogen is 14x air's gas constant per kilogram */
function eRoomMolFill(mol){ const N = GW*GH; for(let i=0;i<N;i++){ eRoomMolXA(i); mol[i] = E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL; } }
function eRoomH2FracA(i){ const n = ST.roomH2[i]/H2_MMOL;
  if(n > 0){ eRoomMolXA(i); E_RR[RR_H2F] = n/(E_RR[RR_MX] + n); } else E_RR[RR_H2F] = 0; }
function eRoomO2FracA(i){ eRoomMolXA(i); E_RR[RR_O2F] = ST.roomO2[i]/O2_MMOL/Math.max(1e-9, E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL); }
const eRoomH2Frac = i => { eRoomH2FracA(i); return E_RR[RR_H2F]; };
const eRoomO2Frac = i => { eRoomO2FracA(i); return E_RR[RR_O2F]; };
const eRoomCOFrac = i => { eRoomCOFracA(i); return E_RR[RR_COF]; };
const eRoomCorFill = i => { eCorTA(i); return E_XV[3]/(MPC*ROOM_DEPTH)/MPC; };
const eRoomCorMolten = i => { eCorTA(i); return E_XV[0] > E_XV[1]; };
const eRoomCorT = i => { eCorTA(i); return E_XV[0]; };
const eRoomCO2Frac = i => { const n = ST.roomCO2[i]/CO2_MMOL; if(!(n > 0)) return 0; eRoomMolXA(i); return n/(E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL); };

/* E_RR[RR_BANG] kJ into cell i at constant volume */
function eRoomBang(i){
  const kJ = E_RR[RR_BANG];
  if(!(kJ > 0) || i < 0 || i >= GW*GH) return;
  eRoomGasA(i);
  if(!(E_RR[RR_CVC] > E_CV_MIN)) return;
  E_RR[RR_UC] += kJ; eRoomTofUA(i);
}
/* the one door a PRESSURE rise becomes a heat: dU = dp*V/(gamma-1) = dp*V*c_v/R, at the cell's own mixture. E_RR[RR_BANG] kPa in, kJ out */
function eRoomBangP(i){
  const kPa = E_RR[RR_BANG];
  eRoomVgasA(i); const V = E_RR[RR_VG];
  eRoomGasA(i);
  E_RR[RR_BANG] = E_RR[RR_MR] > 0 ? kPa*V*E_RR[RR_CVC]/E_RR[RR_MR] : 0;
}
/* E_RR[RR_BANG] = the kPa cell i's own air takes at constant volume before ROOM_TMAX, the inverse of eRoomBangP */
function eRoomBangCapA(i){
  eRoomVgasA(i); const V = E_RR[RR_VG];
  eRoomGasA(i);
  if(!(E_RR[RR_MR] > 0) || !(E_RR[RR_CVC] > E_CV_MIN)){ E_RR[RR_BANG] = 0; return; }
  const U0 = E_RR[RR_UC];
  E_GMX[GX_T] = ROOM_TMAX; eMixA();
  E_RR[RR_BANG] = (ST.roomM[i]*E_GMX[GX_U] - U0)*E_RR[RR_MR]/(V*E_RR[RR_CVC]);
}
function eRoomReach(i0){
  const N = GW*GH, seen = SX.rPlSeen, Q = SX.rPlQ, bx = SX.rBx, by = SX.rBy, g = SX.rGen;
  if(g[E_GEN_PLUME] >= 2147483600){ seen.fill(0); g[E_GEN_PLUME] = 0; }
  const mark = ++g[E_GEN_PLUME];
  let head = 0, tail = 0;
  seen[i0] = mark; Q[tail++] = i0;
  while(head < tail){ const i = Q[head++], X = i%GW;
    if(X < GW-1 && bx[i] && seen[i+1] !== mark){ seen[i+1] = mark; Q[tail++] = i+1; }
    if(X > 0 && bx[i-1] && seen[i-1] !== mark){ seen[i-1] = mark; Q[tail++] = i-1; }
    if(i+GW < N && by[i] && seen[i+GW] !== mark){ seen[i+GW] = mark; Q[tail++] = i+GW; }
    if(i >= GW && by[i-GW] && seen[i-GW] !== mark){ seen[i-GW] = mark; Q[tail++] = i-GW; } }
  return mark;
}
/* kJ a Gaussian of this peak and width puts into the reach eRoomReach marked, cut at 3 sigma; laid only if lay */
function eRoomBlastLay(i, mark, sig, peak, lay){
  const seen = SX.rPlSeen, occ = PT.rOcc, tight = PT.rTight;
  const X0 = i%GW, Y0 = (i/GW)|0, R = Math.ceil(3*sig), k = 1/(2*sig*sig);
  let kJ = 0;
  for(let Y=Math.max(0,Y0-R);Y<=Math.min(GH-1,Y0+R);Y++) for(let X=Math.max(0,X0-R);X<=Math.min(GW-1,X0+R);X++){
    const j = Y*GW + X;
    if(occ[j] || tight[j] || seen[j] !== mark) continue;
    E_RR[RR_BANG] = peak*Math.exp(-((X-X0)*(X-X0) + (Y-Y0)*(Y-Y0))*k); eRoomBangP(j); kJ += E_RR[RR_BANG];
    if(lay) eRoomBang(j);
  }
  return kJ;
}
/* the BLAST tool's charge: a Gaussian BLAST_SIG cells wide into the air on its own side of every intact wall;
   past what the source cell's air holds at ROOM_TMAX the peak stays there and the width grows until the dial's energy lands in the reach */
function eRoomBlastCharge(i, kPa){
  if(!(kPa > 0) || i < 0 || i >= GW*GH) return;
  eRoomLive();
  eRoomBangCapA(i); const cap = E_RR[RR_BANG];
  const mark = eRoomReach(i);
  if(!(cap > 0 && kPa > cap)){ eRoomBlastLay(i, mark, BLAST_SIG, kPa, 1); return; }
  const want = eRoomBlastLay(i, mark, BLAST_SIG, kPa, 0);
  let lo = BLAST_SIG, hi = Math.max(GW, GH);
  if(eRoomBlastLay(i, mark, hi, cap, 0) > want)
    for(let n=0;n<30;n++){ const m = 0.5*(lo + hi); if(eRoomBlastLay(i, mark, m, cap, 0) >= want) hi = m; else lo = m; }
  const got = eRoomBlastLay(i, mark, hi, cap, 0);
  eRoomBlastLay(i, mark, hi, got > want ? cap*want/got : cap, 1);
}

// gas component r answers the liquid it takes at y_r = s_r/Dt_r, the Schur complement of its compliance, so the solve stays SPD
const E_GC = {n:0, lab:null, vg:null, D:null, V:null, G:null, Dt:null, s:null, w:null, wf:null};
function eGcY(x){
  const g = E_GC, n = g.n, lab = g.lab, w = g.w, wf = g.wf, Dt = g.Dt, s = g.s, N = GW*GH;
  for(let r=0;r<n;r++) s[r] = 0;
  for(let i=0;i<N;i++){ const r = lab[i];
    if(r >= 0 && w[i] > 0) s[r] += w[i]*x[i];
    if(i < N-GW && wf[i] > 0){ const f = lab[i+GW]; if(f >= 0) s[f] += wf[i]*x[i]; } }
  for(let r=0;r<n;r++) s[r] /= Dt[r];
}
function eGcApply(x, y){
  const g = E_GC, lab = g.lab, w = g.w, wf = g.wf, s = g.s, N = GW*GH;
  eGcY(x);
  for(let i=0;i<N;i++){ const r = lab[i];
    if(r >= 0 && w[i] > 0) y[i] -= w[i]*s[r];
    if(i < N-GW && wf[i] > 0){ const f = lab[i+GW]; if(f >= 0) y[i] -= wf[i]*s[f]; } }
}
function eGcDiag(J){
  const g = E_GC, lab = g.lab, w = g.w, wf = g.wf, Dt = g.Dt, N = GW*GH;
  for(let i=0;i<N;i++){
    const r = lab[i], f = i < N-GW && wf[i] > 0 ? lab[i+GW] : -1;
    const co = r >= 0 ? w[i] + (f === r ? wf[i] : 0) : 0, cf = f >= 0 && f !== r ? wf[i] : 0;
    let q = 0;
    if(co > 0) q += co*co/Dt[r];
    if(cf > 0) q += cf*cf/Dt[f];
    if(q > 0) J[i] = Math.max(J[i] - q, 1e-12*J[i]); }
}
// each cell's gas volume, gamma and Vg/(gamma p) once per liquid step, E_INF where it holds no gas to push back; the stencil rewrites these later
function eGcCells(){
  const N = GW*GH, vn0 = SX.rH1, gm0 = SX.rU0, cc0 = SX.rCv;
  for(let i=0;i<N;i++){ eRoomVgasA(i); const vn = E_RR[RR_VG]; eRoomGasA(i);
    const pa = (ROOM_P0 + ST.roomP[i])*1000, cv = E_RR[RR_CVC], gm = cv > E_CV_MIN ? E_RR[RR_CPC]/cv : GAM_AIR;
    vn0[i] = vn; gm0[i] = gm; cc0[i] = ST.roomM[i] > 0 && cv > E_CV_MIN && pa > 0 ? SX.lqRho[i]*vn/(gm*pa) : E_INF; }
}
// D[r] = sum rho Vg/(gamma p) at each cell's own liquid density, E_INF if a cell holds no gas; joined over E_GC.vg, the volumes the cells keep through the solve
function eGcBuild(){
  const N = GW*GH, g = E_GC, lab = g.lab, vg = g.vg, D = g.D, Vr = g.V, Gr = g.G, Q = SX.rPlQ, bx = SX.rBx, by = SX.rBy;
  const vn0 = SX.rH1, gm0 = SX.rU0, cc0 = SX.rCv;
  for(let i=0;i<N;i++) lab[i] = -1;
  let n = 0;
  for(let i0=0;i0<N;i0++){
    if(lab[i0] >= 0 || !eGasCell(vg[i0])) continue;
    let head = 0, tail = 0, c = 0, vs = 0, gs = 0;
    lab[i0] = n; Q[tail++] = i0;
    while(head < tail){ const i = Q[head++], X = i%GW;
      const vn = vn0[i], gm = gm0[i], ci = cc0[i];
      vs += vn; gs += vn*gm;
      if(c < E_INF) c = ci < E_INF ? c + ci : E_INF;
      if(X < GW-1 && lab[i+1] < 0 && eGsFxOpen(bx, vg, i)){ lab[i+1] = n; Q[tail++] = i+1; }
      if(X > 0 && lab[i-1] < 0 && eGsFxOpen(bx, vg, i-1)){ lab[i-1] = n; Q[tail++] = i-1; }
      if(i+GW < N && lab[i+GW] < 0 && eGsFyOpen(by, vg, i)){ lab[i+GW] = n; Q[tail++] = i+GW; }
      if(i >= GW && lab[i-GW] < 0 && eGsFyOpen(by, vg, i-GW)){ lab[i-GW] = n; Q[tail++] = i-GW; } }
    D[n] = c; Vr[n] = vs; Gr[n] = gs/vs; n++; }
  g.n = n;
}
// y = A x in one pass, x.y into E_RR[RR_DAD]
function eCgApply(x, y, dI, ax, ay){
  const N = GW*GH;
  let dot = 0;
  for(let i=0;i<N;i++){ const xi = x[i];
    let v = dI[i]*xi;
    if(i > 0){ const a = ax[i-1]; if(a !== 0) v -= a*(x[i-1] - xi); }
    if(i < N-1){ const a = ax[i]; if(a !== 0) v += a*(xi - x[i+1]); }
    if(i >= GW){ const a = ay[i-GW]; if(a !== 0) v -= a*(x[i-GW] - xi); }
    if(i < N-GW){ const a = ay[i]; if(a !== 0) v += a*(xi - x[i+GW]); }
    y[i] = v; dot += xi*v; }
  if(E_GC.n){ eGcApply(x, y); dot = 0; for(let i=0;i<N;i++) dot += x[i]*y[i]; }
  E_RR[RR_DAD] = dot;
}
// the 2x2-aggregate Galerkin operator, band-Cholesky in place: L[c*(B+1) + k] = entry (c, c-k), diagonal 1/pivot, 0 where there is no pivot
function eCgCoarse(dI, ax, ay){
  const CW = (GW + 1) >> 1, NC = CW*((GH + 1) >> 1), B = CW, W1 = B + 1, L = SX.cgL;
  L.fill(0);
  for(let Y=0,i=0;Y<GH;Y++){ const c0 = (Y >> 1)*CW;
    for(let X=0;X<GW;X++,i++){ const c = c0 + (X >> 1);
      L[c*W1] += dI[i];
      if((X & 1) && X < GW-1){ const a = ax[i]; L[c*W1] += a; L[(c+1)*W1] += a; L[(c+1)*W1 + 1] -= a; }
      if((Y & 1) && Y < GH-1){ const a = ay[i]; L[c*W1] += a; L[(c+CW)*W1] += a; L[(c+CW)*W1 + B] -= a; } } }
  for(let i=0;i<NC;i++){ const j0 = i > B ? i - B : 0;
    for(let j=j0;j<=i;j++){ let s = L[i*W1 + i - j];
      for(let p=j0;p<j;p++) s -= L[i*W1 + i - p]*L[j*W1 + j - p];
      if(j < i) L[i*W1 + i - j] = s*L[j*W1];
      else L[i*W1] = s > 0 ? 1/Math.sqrt(s) : 0; } }
}
// z = M^-1 r: forward Gauss-Seidel, the exact coarse correction when lv, backward Gauss-Seidel; the mirrored sweeps keep M symmetric, as CG needs. r.z into E_RR[RR_RZ]
function eCgPrecond(z, r, iJ, ax, ay, lv){
  const N = GW*GH;
  for(let Y=0,i=0;Y<GH;Y++) for(let X=0;X<GW;X++,i++){ let v = r[i];
    if(X > 0) v += ax[i-1]*z[i-1];
    if(Y > 0) v += ay[i-GW]*z[i-GW];
    z[i] = v*iJ[i]; }
  if(lv) eCgCorrect(z, ax, ay);
  let rz = 0;
  for(let Y=GH-1,i=N-1;Y>=0;Y--) for(let X=GW-1;X>=0;X--,i--){ let v = r[i];
    if(X > 0) v += ax[i-1]*z[i-1];
    if(Y > 0) v += ay[i-GW]*z[i-GW];
    if(X < GW-1) v += ax[i]*z[i+1];
    if(Y < GH-1) v += ay[i]*z[i+GW];
    const zi = v*iJ[i]; z[i] = zi; rz += r[i]*zi; }
  E_RR[RR_RZ] = rz;
}
// from a zero start the forward sweep leaves exactly the upper neighbours' pull as residual
function eCgCorrect(z, ax, ay){
  const CW = (GW + 1) >> 1, NC = CW*((GH + 1) >> 1), B = CW, W1 = B + 1, L = SX.cgL, cr = SX.cgCr, cz = SX.cgCz;
  cr.fill(0);
  for(let Y=0,i=0;Y<GH;Y++){ const c0 = (Y >> 1)*CW;
    for(let X=0;X<GW;X++,i++){ let v = 0;
      if(X < GW-1) v += ax[i]*z[i+1];
      if(Y < GH-1) v += ay[i]*z[i+GW];
      cr[c0 + (X >> 1)] += v; } }
  for(let i=0;i<NC;i++){ let s = cr[i]; const k1 = i < B ? i : B;
    for(let k=1;k<=k1;k++) s -= L[i*W1 + k]*cz[i-k];
    cz[i] = s*L[i*W1]; }
  for(let i=NC-1;i>=0;i--){ let s = cz[i]; const k1 = NC-1-i < B ? NC-1-i : B;
    for(let k=1;k<=k1;k++) s -= L[(i+k)*W1 + k]*cz[i+k];
    cz[i] = s*L[i*W1]; }
  for(let Y=0,i=0;Y<GH;Y++){ const c0 = (Y >> 1)*CW;
    for(let X=0;X<GW;X++,i++) z[i] += cz[c0 + (X >> 1)]; }
}
// lv: take the coarse correction, which the gas field's long waves need and the liquid's pocket-coupled solve does not
function eCgSolve(b, x, dI, ax, ay, tol, max, lv){
  const N = GW*GH, r = SX.gsR, z = SX.gsZ, d = SX.gsD, Ap = SX.gsAp, J = SX.gsJ;
  for(let i=0;i<N;i++) J[i] = dI[i];
  for(let i=0;i<N-1;i++){ J[i] += ax[i]; J[i+1] += ax[i]; }
  for(let i=0;i<N-GW;i++){ J[i] += ay[i]; J[i+GW] += ay[i]; }
  if(E_GC.n) eGcDiag(J);
  for(let i=0;i<N;i++) J[i] = 1/J[i];
  if(lv) eCgCoarse(dI, ax, ay);
  eCgApply(x, Ap, dI, ax, ay);
  let bn = 0, rn = 0;
  for(let i=0;i<N;i++){ const ri = b[i] - Ap[i]; r[i] = ri; bn += b[i]*b[i]; rn += ri*ri; }
  eCgPrecond(z, r, J, ax, ay, lv);
  let rz = E_RR[RR_RZ];
  for(let i=0;i<N;i++) d[i] = z[i];
  bn = Math.sqrt(bn);
  if(!(bn > 0)){ x.fill(0); return 0; }
  let it = 0;
  for(;it<max;it++){
    if(Math.sqrt(rn) <= tol*bn) break;
    eCgApply(d, Ap, dI, ax, ay);
    const a = rz/E_RR[RR_DAD];
    rn = 0;
    for(let i=0;i<N;i++){ x[i] += a*d[i]; const ri = r[i] - a*Ap[i]; r[i] = ri; rn += ri*ri; }
    eCgPrecond(z, r, J, ax, ay, lv);
    const rz1 = E_RR[RR_RZ];
    const bt = rz1/rz; rz = rz1;
    for(let i=0;i<N;i++) d[i] = z[i] + bt*d[i];
  }
  return it;
}
function eFaceInflow(inn, fx, fy){
  const N = GW*GH;
  inn.fill(0);
  for(let i=0;i<N-1;i++){ const m = fx[i]; if(m > 0) inn[i+1] += m; else if(m < 0) inn[i] -= m; }
  for(let i=0;i<N-GW;i++){ const m = fy[i]; if(m > 0) inn[i+GW] += m; else if(m < 0) inn[i] -= m; }
}
function eFaceKUpd(i, k, Mm, fx, fy, out, N){
  const X = i%GW;
  let inn = 0;
  if(X > 0 && fx[i-1] > 0) inn += fx[i-1]*k[i-1];
  if(X < GW-1 && fx[i] < 0) inn -= fx[i]*k[i+1];
  if(i >= GW && fy[i-GW] > 0) inn += fy[i-GW]*k[i-GW];
  if(i < N-GW && fy[i] < 0) inn -= fy[i]*k[i+GW];
  const h = Mm[i] + inn;
  k[i] = h >= out[i] ? 1 : (h > 0 ? h/out[i] : 0);
}
/* k[i] scales every face donating from i, grown from the always-safe start, so every iterate is feasible and any stopping point is exactly conservative */
function eFaceTail(Mm, fx, fy, out, k, N){
  out.fill(0);
  for(let i=0;i<N-1;i++){ const m = fx[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+1] -= m; }
  for(let i=0;i<N-GW;i++){ const m = fy[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+GW] -= m; }
  let any = false;
  for(let i=0;i<N;i++){
    if(!(out[i] > 0)){ k[i] = 1; continue; }
    const v = Mm[i] >= out[i] ? 1 : (Mm[i] > 0 ? Mm[i]/out[i] : 0);
    k[i] = v; if(v !== 1) any = true; }
  if(!any) return;
  for(let it=0;it<FACE_TAIL;it++){ let moved = false;
    for(let i=0;i<N;i++) if(out[i] > 0 && k[i] !== 1){ const p = k[i]; eFaceKUpd(i, k, Mm, fx, fy, out, N); if(k[i] !== p) moved = true; }
    for(let i=N-1;i>=0;i--) if(out[i] > 0 && k[i] !== 1){ const p = k[i]; eFaceKUpd(i, k, Mm, fx, fy, out, N); if(k[i] !== p) moved = true; }
    if(!moved) break; }
  for(let i=0;i<N-1;i++){ if(fx[i] > 0) fx[i] *= k[i]; else if(fx[i] < 0) fx[i] *= k[i+1]; }
  for(let i=0;i<N-GW;i++){ if(fy[i] > 0) fy[i] *= k[i]; else if(fy[i] < 0) fy[i] *= k[i+GW]; }
}
/* a cell's net outflow is cut to what it holds plus what it is given; with `cap`, its inflow to the room it has plus what it passes on, each arrival at its donor's own density */
function eFaceLimit(Mm, fx, fy, n, cap, nP){
  const N = GW*GH, out = SX.gsOut, inn = SX.gsJ, inV = SX.lqInV, k = SX.gsK.fill(1), ki = SX.gsKi.fill(1);
  const lab = SX.gsMol, pA = SX.lqPa, kp = SX.lqPk, pin = SX.lqPin, pout = SX.lqPout, pR = SX.lqRho;
  for(let r=0;r<nP;r++) kp[r] = 1;
  /* a face carrying no finite number carries no kilograms: every comparison
     below is false for NaN, so without this a NaN face sails through the
     limiter and the tail untouched and poisons the masses (h2+2428: one NaN
     face -> 912 NaN water cells -> ledger NaN forever). An infinite face is
     the same failure one tick earlier (no face moves infinite kilograms);
     zeroing it keeps the books balanced by moving nothing. No-op on finite
     flows. */
  for(let i=0;i<N-1;i++) if(!(Math.abs(fx[i]) < E_INF)) fx[i] = 0;
  for(let i=0;i<N-GW;i++) if(!(Math.abs(fy[i]) < E_INF)) fy[i] = 0;
  for(let it=0;it<n;it++){ let moved = false;
    out.fill(0); inn.fill(0); if(cap) inV.fill(0);
    for(let r=0;r<nP;r++){ pin[r] = 0; pout[r] = 0; }
    for(let i=0;i<N;i++){
      const li = nP ? lab[i] : -1;
      if(fx[i] !== 0){ const j = i+1, lj = nP ? lab[j] : -1, fwd = fx[i] > 0;
        const d = fwd ? i : j, e = fwd ? j : i, ld = fwd ? li : lj, le = fwd ? lj : li;
        const m = fwd ? fx[i] : -fx[i], cross = le >= 0 && le !== ld, q = cross ? kp[le] : 1;
        out[d] += m*ki[e]*q; inn[e] += m*k[d]*q;
        if(cap) inV[e] += m*k[d]*q*pR[e]/pR[d];
        const s = m*k[d]*ki[e];
        if(cross) pin[le] += s/pR[d];
        if(ld >= 0 && ld !== le) pout[ld] += s*q/pR[d]; }
      if(fy[i] !== 0){ const j = i+GW, lj = nP ? lab[j] : -1, fwd = fy[i] > 0;
        const d = fwd ? i : j, e = fwd ? j : i, ld = fwd ? li : lj, le = fwd ? lj : li;
        const m = fwd ? fy[i] : -fy[i], cross = le >= 0 && le !== ld, q = cross ? kp[le] : 1;
        out[d] += m*ki[e]*q; inn[e] += m*k[d]*q;
        if(cap) inV[e] += m*k[d]*q*pR[e]/pR[d];
        const s = m*k[d]*ki[e];
        if(cross) pin[le] += s/pR[d];
        if(ld >= 0 && ld !== le) pout[ld] += s*q/pR[d]; }
    }
    // with a cap the scales only fall: a free one can swing between two cuts forever and stop on neither
    for(let i=0;i<N;i++){ const have = Mm[i] + inn[i]*ki[i]; let v = out[i] > have ? have/out[i] : 1; if(cap && v > k[i]) v = k[i]; if(v !== k[i]) moved = true; k[i] = v; }
    // inV is the arrivals' volume in kilograms of the cell's own water
    if(cap) for(let i=0;i<N;i++){ const room = Math.max(0, cap[i] - Mm[i]) + out[i]*k[i]; let v = inV[i] > room ? room/inV[i] : 1; if(v > ki[i]) v = ki[i]; if(v !== ki[i]) moved = true; ki[i] = v; }
    /* a sealed pocket's gas volume moves only by what the solve that priced its pressure delivered, so cutting its outflows cuts its inflows with them */
    for(let r=0;r<nP;r++){ const a = pA[r]; if(!(a < E_INF) || !(pin[r] > 0)) continue;
      const lim = a + pout[r]; if(!(pin[r] > lim)) continue;
      const v = lim > 0 ? lim/pin[r] : 0; if(v < kp[r]){ kp[r] = v; moved = true; } }
    if(!moved) break;
  }
  for(let i=0;i<N;i++){
    const li = nP ? lab[i] : -1;
    if(fx[i] !== 0){ const j = i+1, lj = nP ? lab[j] : -1, fwd = fx[i] > 0;
      const d = fwd ? i : j, e = fwd ? j : i, ld = fwd ? li : lj, le = fwd ? lj : li;
      fx[i] *= k[d]*ki[e]*(le >= 0 && le !== ld ? kp[le] : 1); }
    if(fy[i] !== 0){ const j = i+GW, lj = nP ? lab[j] : -1, fwd = fy[i] > 0;
      const d = fwd ? i : j, e = fwd ? j : i, ld = fwd ? li : lj, le = fwd ? lj : li;
      fy[i] *= k[d]*ki[e]*(le >= 0 && le !== ld ? kp[le] : 1); }
  }
  /* born inside or in the tail below (have = Inf - Inf, Inf * 0): k is
     limiter-local, so only the faces can carry it out. Same rule. */
  for(let i=0;i<N-1;i++) if(!(Math.abs(fx[i]) < E_INF)) fx[i] = 0;
  for(let i=0;i<N-GW;i++) if(!(Math.abs(fy[i]) < E_INF)) fy[i] = 0;
  eFaceTail(Mm, fx, fy, out, k, N);
  for(let i=0;i<N-1;i++) if(!(Math.abs(fx[i]) < E_INF)) fx[i] = 0;
  for(let i=0;i<N-GW;i++) if(!(Math.abs(fy[i]) < E_INF)) fy[i] = 0;
}
function eFaceMove(Mm, fx, fy){
  const N = GW*GH, d = SX.gsF.fill(0);
  for(let i=0;i<N-1;i++) if(fx[i] !== 0){ d[i] -= fx[i]; d[i+1] += fx[i]; }
  for(let i=0;i<N-GW;i++) if(fy[i] !== 0){ d[i] -= fy[i]; d[i+GW] += fy[i]; }
  for(let i=0;i<N;i++) if(d[i] !== 0){ const v = Mm[i] + d[i];
    if(v < 0){ ST.sc[SC_FACERES] -= v; Mm[i] = 0; } else Mm[i] = v; }
}
function eAdvUpd(i, y, y0, M0, fx, fy, inn, N){
  const X = i%GW;
  let n = M0[i]*y0[i];
  if(X > 0 && fx[i-1] > 0) n += fx[i-1]*y[i-1];
  if(X < GW-1 && fx[i] < 0) n -= fx[i]*y[i+1];
  if(i >= GW && fy[i-GW] > 0) n += fy[i-GW]*y[i-GW];
  if(i < N-GW && fy[i] < 0) n -= fy[i]*y[i+GW];
  const w = M0[i] + inn[i];
  y[i] = w > 0 ? n/w : y0[i];
}
/* species ride the face kilograms as an implicit upwind mass fraction; every update a convex blend */
function eRoomAdvect(F, M0, fx, fy, inn, lim){
  const N = GW*GH, y0 = SX.gsY0, y = SX.gsY;
  let any = false;
  for(let i=0;i<N && !any;i++) any = F[i] !== 0;
  if(!any) return;
  for(let i=0;i<N;i++){ y0[i] = M0[i] > 0 ? Math.min(lim, F[i]/M0[i]) : 0; y[i] = y0[i]; }
  for(let it=0;it<ADV_SWEEPS;it++){
    for(let i=0;i<N;i++) eAdvUpd(i, y, y0, M0, fx, fy, inn, N);
    for(let i=N-1;i>=0;i--) eAdvUpd(i, y, y0, M0, fx, fy, inn, N); }
  // the settled fractions ride the faces in one pass, so what a cell loses its neighbour gains
  for(let i=0;i<N-1;i++){ const f = fx[i]; if(f === 0) continue;
    const e = f*(f > 0 ? y[i] : y[i+1]); F[i] -= e; F[i+1] += e; }
  for(let i=0;i<N-GW;i++){ const f = fy[i]; if(f === 0) continue;
    const e = f*(f > 0 ? y[i] : y[i+GW]); F[i] -= e; F[i+GW] += e; }
}
function eGsFxOpen(bx, vg, i){ return bx[i] !== 0 && eGasCell(vg[i]) && eGasCell(vg[i+1]); }
function eGsFyOpen(by, vg, i){ return by[i] !== 0 && eGasCell(vg[i]) && eGasCell(vg[i+GW]); }
/* SX.gsVoid: gas-free room in the water sealed from any gas, beside a gas it outflashes, beside a gas at or over its p_sat */
const E_VD_SEALED = 1, E_VD_FLASH = 2, E_VD_GAS = 3;
function eGasAt(j){ if(!(ST.roomM[j] > 0)) return false; eRoomVgasA(j); return eGasCell(E_RR[RR_VG]); }
/* the gas cell above or beside i across an open face, -1 for none: the space over i's water is that gas's own */
function eGasNear(i){ const bx = SX.rBx, by = SX.rBy, X = i%GW;
  if(i >= GW && by[i-GW] !== 0 && eGasAt(i-GW)) return i - GW;
  if(X > 0 && bx[i-1] !== 0 && eGasAt(i-1)) return i - 1;
  if(X < GW-1 && bx[i] !== 0 && eGasAt(i+1)) return i + 1;
  return -1; }

/* Energy rides the mass: what crosses a face carries h of its DONOR, and the flow work is exactly that
   enthalpy landing in a U at fixed volume, so a compressed cell really heats with no separate
   p dV term for the gas's own flows. Implicit upwind, the same walk eRoomAdvect() runs on the species: a donor exports at its
   own NEW h, so every update is a convex blend and the step is bounded however much a cell passes.
   h = gamma*u + const for an ideal gas, with gamma held over the tick, and the temperature at the end
   comes off the full u(T) inversion. The sweeps settle what each donor leaves at; one pass with those
   values is what actually moves the energy, and that pass is conservative face by face. */
// the liquid's p dV sits inside the same update, so gas squeezed out at its own pressure leaves the rest as it was
function eGasEnUpd(i, N, U, U0, M1, fx, fy, out, H, Gm, Hb, Wn, Dx){
  const X = i%GW, m = M1[i];
  if(!(m > 0)){ U[i] = 0; H[i] = 0; return; }
  let n = U0[i] - out[i]*Hb[i] + Wn[i];
  if(X > 0 && fx[i-1] > 0) n += fx[i-1]*H[i-1];
  if(X < GW-1 && fx[i] < 0) n -= fx[i]*H[i+1];
  if(i >= GW && fy[i-GW] > 0) n += fy[i-GW]*H[i-GW];
  if(i < N-GW && fy[i] < 0) n -= fy[i]*H[i+GW];
  const u = n/(1 + Gm[i]*out[i]/m + Dx[i]);
  U[i] = u;
  H[i] = Gm[i]*u/m + Hb[i];
}
function eGasEnergyMove(M0, M1, fx, fy, Wn, Dx){
  const N = GW*GH, U = SX.rU, U0 = SX.rU0, H = SX.rH1, Gm = SX.rGm, Hb = SX.rHb, out = SX.gsOut;
  U0.set(U);
  out.fill(0);
  for(let i=0;i<N-1;i++){ const f = fx[i]; if(f > 0) out[i] += f; else if(f < 0) out[i+1] -= f; }
  for(let i=0;i<N-GW;i++){ const f = fy[i]; if(f > 0) out[i] += f; else if(f < 0) out[i+GW] -= f; }
  for(let it=0;it<ADV_SWEEPS;it++){
    for(let i=0;i<N;i++) eGasEnUpd(i, N, U, U0, M1, fx, fy, out, H, Gm, Hb, Wn, Dx);
    for(let i=N-1;i>=0;i--) eGasEnUpd(i, N, U, U0, M1, fx, fy, out, H, Gm, Hb, Wn, Dx); }
  for(let i=0;i<N;i++) Wn[i] -= Dx[i]*U[i];
  U.set(U0);
  for(let i=0;i<N-1;i++){ const f = fx[i]; if(f === 0) continue;
    const e = f*(f > 0 ? H[i] : H[i+1]); U[i] -= e; U[i+1] += e; }
  for(let i=0;i<N-GW;i++){ const f = fy[i]; if(f === 0) continue;
    const e = f*(f > 0 ? H[i] : H[i+GW]); U[i] -= e; U[i+GW] += e; }
  for(let i=0;i<N;i++) U[i] += Wn[i];
}

/* the nearest ring of gas cells a bubble leaving i reaches; pairs in SX.rGdI/rGdW, count in rGen, weight returned */
function eGdPut(j, face, k){
  const b = face[k];
  const g = SX.rGen, seen = SX.rGdSeen;
  if(!(b > 0) || seen[j] === g[E_GEN_RING]) return;
  seen[j] = g[E_GEN_RING];
  eRoomVgasA(j); const vg = E_RR[RR_VG];
  if(eGasCell(vg)){ const n = g[E_GEN_RINGN]; SX.rGdI[n] = j; SX.rGdW[n] = b*vg; g[E_GEN_RINGN] = n + 1; SX.rAcc[0] += b*vg; }
  else { SX.rGdQ[SX.rGen[4]] = j; SX.rGen[4]++; }
}
function eGasRing(i){
  const g = SX.rGen, q = SX.rGdQ, bx = SX.rBx, by = SX.rBy;
  if(g[E_GEN_RING] >= 2147483600){ SX.rGdSeen.fill(0); g[E_GEN_RING] = 0; }
  g[E_GEN_RING]++;
  g[E_GEN_RINGN] = 0; g[4] = 0; SX.rAcc[0] = 0;
  SX.rGdSeen[i] = g[E_GEN_RING]; q[g[4]++] = i;
  let h = 0;
  while(h < g[4] && g[E_GEN_RINGN] === 0){
    const end = g[4];
    for(; h<end; h++){ const a = q[h], X = a%GW;
      if(a >= GW) eGdPut(a-GW, by, a-GW);
      if(X < GW-1) eGdPut(a+1, bx, a);
      if(X > 0) eGdPut(a-1, bx, a-1); } }
  E_RR[RR_GW] = SX.rAcc[0];
}
/* E_GSP: gas, H2, O2, steam, noble and volatile fission products, CO, CO2, the fraction eGasTake() took out of a cell */
const E_GSP = new Float64Array(8);
function eGasTake(i, f){ const s = ST;
  E_GSP[0] = s.roomM[i]*f; E_GSP[1] = s.roomH2[i]*f; E_GSP[2] = s.roomO2[i]*f; E_GSP[3] = s.roomVap[i]*f; E_GSP[4] = s.roomFpN[i]*f; E_GSP[5] = s.roomFpV[i]*f;
  E_GSP[6] = s.roomCO[i]*f; E_GSP[7] = s.roomCO2[i]*f;
  s.roomM[i] -= E_GSP[0]; s.roomH2[i] -= E_GSP[1]; s.roomO2[i] -= E_GSP[2]; s.roomVap[i] -= E_GSP[3]; s.roomFpN[i] -= E_GSP[4]; s.roomFpV[i] -= E_GSP[5];
  s.roomCO[i] -= E_GSP[6]; s.roomCO2[i] -= E_GSP[7]; }
function eGasGive(j, q){ const s = ST;
  s.roomM[j] += E_GSP[0]*q; s.roomH2[j] += E_GSP[1]*q; s.roomO2[j] += E_GSP[2]*q; s.roomVap[j] += E_GSP[3]*q; s.roomFpN[j] += E_GSP[4]*q; s.roomFpV[j] += E_GSP[5]*q;
  s.roomCO[j] += E_GSP[6]*q; s.roomCO2[j] += E_GSP[7]*q; }
function eGasDisplace(i, dV){
  if(!(dV > 0)) return;
  eGasRing(i); const w = E_RR[RR_GW], n = SX.rGen[E_GEN_RINGN], I = SX.rGdI, Wt = SX.rGdW;
  if(!(w > 0)) return;
  eRoomVgasA(i); const f = Math.min(1, dV/E_RR[RR_VG]), s = ST, disp = s.gsDisp;
  // it brings the volume it had as a squeeze owed on its new cell, so the liquid, not the gas, pays the work
  eRoomGasA(i);
  const m = s.roomM[i], u = m > 0 ? E_RR[RR_UC]/m : 0;
  eRoomMolXA(i);
  // the floor volume holds no gas; only what the gas fills is owed
  const nV = (E_RR[RR_MX] + s.roomH2[i]/H2_MMOL)*E_RU*s.roomT[i]/((ROOM_P0 + s.roomP[i])*1000);
  const v = m > 0 ? Math.min(Math.max(E_RR[RR_VG] + disp[i], 0), nV)/m : 0;
  eGasTake(i, f); const gM = E_GSP[0]; disp[i] -= disp[i]*f;
  for(let k=0;k<n;k++){ const j = I[k], q = Wt[k]/w;
    eRoomGasA(j); const U = E_RR[RR_UC];
    eGasGive(j, q); disp[j] += gM*q*v;
    E_RR[RR_UC] = U + gM*q*u; eRoomTofUA(j); }
}

/* one tick of the gas: implicit face velocities, mass on them, species and enthalpy with it, then the pressure read */
function eGasStep(dt, src){
  const N = GW*GH, s = ST, Mm = s.roomM, Tr = s.roomT, U = s.roomPU, V = s.roomPV, bx = SX.rBx, by = SX.rBy;
  const p = SX.gsP, vg = SX.gsVg, disp = s.gsDisp, sc = s.sc, mol = SX.gsMol;
  let anyDisp = false;
  eRoomMolFill(mol);
  const VGMIN = ROOM_VG_MIN*ROOM_VCELL, VGCELL = VGMIN*1.0001;
  for(let i=0;i<N;i++){
    eRoomVgasA(i); const vv = E_RR[RR_VG];
    vg[i] = vv;
    if(disp[i] !== 0) anyDisp = true;
    p[i] = mol[i]*E_RU*Tr[i]/Math.max(vv > VGCELL && vv + disp[i] > 0 ? vv + disp[i] : vv, 1e-6); }
  let live = anyDisp;
  const pLo = WAVE_P_LO*1000, uLo = WAVE_U_LO*ROOM_RHO;
  for(let i=0;i<N && !live;i++)
    if(Math.abs(U[i]) > uLo || Math.abs(V[i]) > uLo
       || (eGsFxOpen(bx, vg, i) && Math.abs(p[i] - p[i+1]) > pLo)
       || (eGsFyOpen(by, vg, i) && Math.abs(p[i] - p[i+GW]) > pLo)) live = true;
  const x = s.gsX;
  if(!live){ U.fill(0); V.fill(0); sc[SC_ROOMCGIT] = 0; x.fill(0); }
  else {
    const kp = SX.gsDI, gx = SX.gsAx, gy = SX.gsAy, b = SX.gsB, A = MPC*ROOM_DEPTH, gA = dt*dt*A/MPC;
    /* the gas properties this tick, read once: the compliance takes the gamma and the transport the h */
    const Ue = SX.rU, He = SX.rH1, Gm = SX.rGm, Hb = SX.rHb;
    for(let i=0;i<N;i++){
      const M = Mm[i], R = M > 0 ? mol[i]*E_RU/M : R_SI;
      eRoomGasA(i);
      const u = E_RR[RR_UC], cv = E_RR[RR_CVC];
      Ue[i] = u;
      if(M > 0 && cv > E_CV_MIN){ const h = (u + Tr[i]*E_RR[RR_MR])/M;
        He[i] = h; Gm[i] = E_RR[RR_CPC]/cv; Hb[i] = h - Gm[i]*u/M; }
      else { He[i] = 0; Gm[i] = GAM_AIR; Hb[i] = 0; }
      kp[i] = vg[i]/(Gm[i]*R*Math.max(Tr[i], 1));
      if(!eGsFxOpen(bx, vg, i)){ gx[i] = 0; U[i] = 0; } else gx[i] = gA*bx[i];
      if(!eGsFyOpen(by, vg, i)){ gy[i] = 0; V[i] = 0; } else gy[i] = gA*by[i];
    }
    const fx = SX.gsFx, fy = SX.gsFy;
    for(let i=0;i<N;i++){
      fx[i] = gx[i] !== 0 ? U[i]*A*dt : 0;
      fy[i] = gy[i] !== 0 ? V[i]*A*dt : 0;
    }
    for(let i=0;i<N;i++){ const X = i%GW;
      b[i] = -(fx[i] - (X > 0 ? fx[i-1] : 0) + fy[i] - (i >= GW ? fy[i-GW] : 0)); }
    // an expansion as the secant to its isentrope: the tangent of a large one runs below vacuum
    for(let i=0;i<N;i++){ const d = disp[i], vo = vg[i] + d;
      if(d === 0 || !eGasCell(vg[i]) || !(vo > 0)) continue;
      b[i] += d > 0 ? Mm[i]*d/vo : kp[i]*p[i]*(Math.pow(vo/vg[i], Gm[i]) - 1); }
    for(let i=0;i<N-1;i++){ const q = gx[i]*(p[i] - p[i+1]); b[i] -= q; b[i+1] += q; }
    for(let i=0;i<N-GW;i++){ const q = gy[i]*(p[i] - p[i+GW]); b[i] -= q; b[i+GW] += q; }
    if(sc[SC_ROOMCGIT] === 0) x.fill(0);
    sc[SC_ROOMCGIT] = eCgSolve(b, x, kp, gx, gy, CG_TOL, CG_MAX, 1);
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) fx[i] -= gx[i]*((p[i+1] + x[i+1]) - (p[i] + x[i]));
      if(gy[i] !== 0) fy[i] -= gy[i]*((p[i+GW] + x[i+GW]) - (p[i] + x[i]));
    }
    eFaceLimit(Mm, fx, fy, 4, null, 0);
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) U[i] = fx[i]/(A*dt); else fx[i] = 0;
      if(gy[i] !== 0) V[i] = fy[i]/(A*dt); else fy[i] = 0;
    }
    const M0 = SX.gsM0; M0.set(Mm);
    eFaceInflow(SX.gsIn, fx, fy);
    eFaceMove(Mm, fx, fy);
    const Wn = SX.gsB, Dx = SX.gsY0;
    for(let i=0;i<N;i++){ const d = disp[i]; Wn[i] = 0; Dx[i] = 0;
      if(d === 0 || !eGasCell(vg[i]) || !(vg[i] + d > 0) || !(Mm[i] > 0)) continue;
      // p1*V1 = (Gm-1)*U1 + Hb*m on the transport's own linearisation
      if(d > 0) Wn[i] = p[i]*d/1000; else { Dx[i] = -(Gm[i] - 1)*d/vg[i]; Wn[i] = Hb[i]*Mm[i]*d/vg[i]; } }
    eGasEnergyMove(M0, Mm, fx, fy, Wn, Dx);
    eRoomAdvect(s.roomH2, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomO2, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomVap, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomCO, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomCO2, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomFpN, M0, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomFpV, M0, fx, fy, SX.gsIn, 1);
    for(let i=0;i<N;i++){ E_RR[RR_UC] = Ue[i]; eRoomTofUA(i); }
  }
  for(let i=0;i<N;i++) if(eGasCell(vg[i]) || !(Mm[i] > 0)) disp[i] = 0;
  const Pr = s.roomP, Pk = s.roomPPk;
  if(live) eRoomMolFill(mol);
  const W = s.roomWater, lq = E_LQ[0], vd = SX.gsVoid;
  // gas-free room in the water holds its own vapour; beside a gas it is that gas's space, flashing where the gas is below p_sat
  for(let i=0;i<N;i++){ vd[i] = W[i] > 0 && !(Mm[i] > 0) && !eLqFull(lq, i) ? (eGasNear(i) < 0 ? E_VD_SEALED : E_VD_FLASH) : 0;
    if(vd[i]){ eWaterPsatA(i); Pr[i] = E_RP[3]*1000 - ROOM_P0; }
    else if(vg[i] > VGCELL) Pr[i] = mol[i]*E_RU*Tr[i]/Math.max(vg[i], 1e-6)/1000 - ROOM_P0; }
  /* a flooded cell reads the gas it would rise to */
  for(let i=0;i<N;i++){
    if(vd[i] === E_VD_FLASH || (!vd[i] && !(vg[i] > VGCELL))){ eGasRing(i); const w = E_RR[RR_GW], n = SX.rGen[E_GEN_RINGN];
      let q = 0;
      for(let k=0;k<n;k++) q += Pr[SX.rGdI[k]]*SX.rGdW[k];
      q = w > 0 ? q/w : (i >= GW ? Pr[i-GW] : 0);
      if(!vd[i]) Pr[i] = q; else if(q >= Pr[i]){ Pr[i] = q; vd[i] = E_VD_GAS; } }
    if(Pr[i] > Pk[i]) Pk[i] = Pr[i]; }
  /* the quasi-static baseline a wave is judged against: one pole, slower than the board's own acoustic
     traverse and faster than anything a plant does, so a steady jet becomes baseline and a front does not */
  const Qs = s.roomPQs, tau = (GW > GH ? GW : GH)*E_PQS_K, k = dt/(tau + dt);
  for(let i=0;i<N;i++) Qs[i] = Qs[i] + (Pr[i] - Qs[i])*k;
  eRegExcess(vg);
  let pmax = 0;
  for(let i=0;i<N;i++){ eBangA(i); const e = E_RR[RR_EXC]; if(e > pmax) pmax = e; }
  E_RR[RR_PMAX] = pmax;
}
/* a front is the part of a cell's jump its compartment has not shared; a uniform rise loads by its difference, the crush path */
function eRegExcess(vg){
  const m = SX.regExc, w = SX.regVg, of = PT.cellRegion, Pr = ST.roomP, Qs = ST.roomPQs, N = GW*GH;
  m.fill(0); w.fill(0);
  for(let i=0;i<N;i++){ const r = of[i];
    if(r < 0 || !eGasCell(vg[i])) continue;
    m[r] += (Pr[i] - Qs[i])*vg[i]; w[r] += vg[i]; }
  for(let r=0;r<m.length;r++) if(w[r] > 0) m[r] /= w[r];
}
function eBangA(i){ const r = PT.cellRegion[i]; E_RR[RR_EXC] = ST.roomP[i] - ST.roomPQs[i] - (r >= 0 ? SX.regExc[r] : 0); }
const eBang = i => { eBangA(i); return E_RR[RR_EXC]; };

/* liquids: a pressure at every cell's floor and a speed on every face, one implicit solve of the gas step's shape */
const eLqShut = j => !SX.rHole[j] && (PT.rTight[j] === 1 || (PT.rOcc[j] === 1 && PT.rOwn[j] < 0));
const eLqRuns = (i, j) => !eLqShut(j) && !(PT.rPan[i] && !PT.rPan[j]);
/* a liquid's density in cell j into E_RR[RR_WRHO]; a dry cell takes the lightest water beside it, the water that can arrive */
function eLqRhoA(q, j){
  if(q.tag){ E_RR[RR_WRHO] = q.rho; return; }
  const W = ST.roomWater;
  if(W[j] > 0){ eRoomWRhoA(j); return; }
  const X = j%GW, N = GW*GH;
  let r = WATER_RHO;
  if(X > 0 && W[j-1] > 0){ eRoomWRhoA(j-1); if(E_RR[RR_WRHO] < r) r = E_RR[RR_WRHO]; }
  if(X < GW-1 && W[j+1] > 0){ eRoomWRhoA(j+1); if(E_RR[RR_WRHO] < r) r = E_RR[RR_WRHO]; }
  if(j >= GW && W[j-GW] > 0){ eRoomWRhoA(j-GW); if(E_RR[RR_WRHO] < r) r = E_RR[RR_WRHO]; }
  if(j < N-GW && W[j+GW] > 0){ eRoomWRhoA(j+GW); if(E_RR[RR_WRHO] < r) r = E_RR[RR_WRHO]; }
  E_RR[RR_WRHO] = r;
}
function eLqOtherVA(q, j){
  if(q.tag){ eRoomWRhoA(j); E_RR[RR_VO] = q.O[j]/E_RR[RR_WRHO]; } else E_RR[RR_VO] = q.O[j]/q.oRho;
  E_RR[RR_VO] += (ST.roomCorF[j] + ST.roomCorK[j])/CORIUM.rhoDebris + ST.roomCorS[j]/CORIUM.slagRho; }
/* leaves the liquid's own density in E_RR[RR_WRHO] */
function eLqCapA(q, j){
  eLqOtherVA(q, j); const vo = E_RR[RR_VO];
  eLqRhoA(q, j); E_RR[RR_CAP] = Math.max(0, E_RR[RR_WRHO]*(ROOM_VCELL - vo)); }
const eLqCap = (q, j) => { eLqCapA(q, j); return E_RR[RR_CAP]; };
const eLqFull = (q, j) => { eLqCapA(q, j); return q.M[j] >= E_RR[RR_CAP]*LIQ_FULL_K; };
function eLqStands(q, i){
  for(;;){ const j = i + GW;
    if(j >= GW*GH || !eLqRuns(i, j)) return true;
    if(!eLqFull(q, j)) return false;
    i = j; }
}
function eLqTop(q, i){
  const M = q.M;
  if(!(M[i] > 0) || eLqShut(i)) return i;
  while(i >= GW && M[i-GW] > 0 && eLqRuns(i-GW, i) && eLqFull(q, i)) i -= GW;
  return i;
}
function eLqSurfA(q, i){ const t = eLqTop(q, i); eLqRhoA(q, t); const r = E_RR[RR_WRHO]; zFloorA(t, E_RR, RR_SURF); E_RR[RR_SURF] += q.M[t]/(r*MPC*ROOM_DEPTH); }
const eLqSurf = (q, i) => { eLqSurfA(q, i); return E_RR[RR_SURF]; };
function eLqStandWalk(N, full, stand){
  for(let i=N-1;i>=0;i--){ const j = i + GW;
    stand[i] = (j >= N || !eLqRuns(i, j)) ? 1 : (full[j] && stand[j]) ? 1 : 0; }
}
/* free-surface pressure at a cell's floor, at the cell's own density */
function eLqPFreeA(gas, h, i){ E_RR[RR_PF] = gas[i] + SX.lqRho[i]*G_SI*h[i]; }
/* the weight per floor area of the other liquid resting on i: its own share and the column over it, into E_RR[RR_LOAD] */
function eLqLoadA(q, i){
  const L = q.L; let m = 0;
  if(L){ let k = L[i] > 0 ? i : i - GW; for(;k >= 0 && L[k] > 0;k -= GW) m += L[k]; }
  E_RR[RR_LOAD] = m*G_SI/(MPC*ROOM_DEPTH);
}
/* one side's face force at head E_RR[RR_HM], its own wetted height E_RR[kw] */
function eLqSideA(q, stand, p, gas, i, kw){
  const rg = SX.lqRho[i]*G_SI, hm = E_RR[RR_HM], w = Math.min(E_RR[kw], hm);
  let hu = 0; if(q.U && q.U[i] > 0){ eRoomWRhoA(i); hu = q.U[i]/(E_RR[RR_WRHO]*MPC*ROOM_DEPTH); }
  E_RR[RR_SIDE] = stand[i] ? (p[i] + rg*hu)*w - rg*w*w/2 + gas[i]*(hm - w) : gas[i]*hm;
}
function eLqDriveXA(q, h, hc, stand, p, gas, i, j){
  E_RR[RR_WI] = Math.min(h[i], hc[i]); E_RR[RR_WJ] = Math.min(h[j], hc[j]);
  const hm = Math.max(E_RR[RR_WI], E_RR[RR_WJ]);
  if(!(hm > 0)){ E_RR[RR_DRV] = 0; return; }
  E_RR[RR_HM] = hm;
  eLqSideA(q, stand, p, gas, i, RR_WI); const si = E_RR[RR_SIDE] - gas[i]*hm;
  eLqSideA(q, stand, p, gas, j, RR_WJ); const sj = E_RR[RR_SIDE] - gas[j]*hm;
  // over the mean depth of the water between the centres: the deeper side's depth halves g dh/dx at a front
  const hb = 0.5*(Math.min(E_RR[RR_WI], hm) + Math.min(E_RR[RR_WJ], hm));
  E_RR[RR_DRV] = (hb > 0 ? (si - sj)/hb : 0) + gas[i] - gas[j];
}
const eLqRunsX = (cap, i) => cap[i] > 0 && cap[i+1] > 0 && eLqRuns(i, i+1) && eLqRuns(i+1, i);
const eLqRunsY = (cap, i) => cap[i] > 0 && cap[i+GW] > 0 && eLqRuns(i, i+GW);
/* a dry cell reads the gas a liquid would land at; water held in a cell gains V dp as its own pressure moves, (dh/dp)_s = v */
function eLqWriteP(q, N, LP, M, stand, p, gas, P0){
  const E = q.tag ? null : q.E;
  for(let i=0;i<N;i++){ const w = ((M[i] > 0 && stand[i] ? p[i] : gas[i]) - P0)/1000;
    if(E && M[i] > 0){ eRoomWRhoA(i); E[i] += M[i]/E_RR[RR_WRHO]*(w - LP[i]); }
    LP[i] = w; }
}
/* the swell since the gas last saw a cell's water, at fixed mass, is a squeeze on that gas; under the gas's rest threshold it waits and adds up, so a pool cooling at rest does not wake the gas solve every tick */
function eLqSwell(N){
  const W = ST.roomWater, vs = ST.roomWVs, disp = ST.gsDisp, Pr = ST.roomP;
  for(let i=0;i<N;i++){ const m = W[i];
    if(!(m > 0)){ vs[i] = 0; continue; }
    eRoomWRhoA(i); const v = 1/E_RR[RR_WRHO];
    if(!(vs[i] > 0)){ vs[i] = v; continue; }
    const d = m*(v - vs[i]); eRoomVgasA(i);
    if(!(GAM_AIR*(ROOM_P0 + Pr[i])*(d < 0 ? -d : d) > WAVE_P_LO*E_RR[RR_VG])) continue;
    disp[i] += d; vs[i] = v; }
}
/* m3 of swell a cell holds unbooked, into out[k]; an event that books its own volume keeps it pending (eLqSeenA), and a cell left dry books it */
function eLqPendA(i, out, k){ const m = ST.roomWater[i], vs = ST.roomWVs[i];
  if(!(m > 0) || !(vs > 0)){ out[k] = 0; return; }
  eRoomWRhoA(i); out[k] = m*(1/E_RR[RR_WRHO] - vs); }
function eLqSeenA(i, pend, k){ const m = ST.roomWater[i], pd = pend[k];
  if(m > 0){ eRoomWRhoA(i); ST.roomWVs[i] = 1/E_RR[RR_WRHO] - pd/m; }
  else { ST.roomWVs[i] = 0; ST.gsDisp[i] += pd; } }
const E_LQPD = new Float64Array(1);
function eLqFallVA(N, vv, k, o){ E_RR[o] = Math.max(k < N-GW ? Math.abs(vv[k]) : 0, k >= GW ? Math.abs(vv[k-GW]) : 0); }

/* E_RR[RR_SWV] m3 of liquid crossed from a into c: c's gas that stood in it moves to a, with its energy, and neither is squeezed by it */
function eLqSwap(a, c){
  const s = ST, M = s.roomM, disp = s.gsDisp, dV = E_RR[RR_SWV];
  eRoomVgasA(c); const f = Math.min(1, dV/(E_RR[RR_VG] + dV)), g = M[c]*f;
  if(!(g > 0)) return;
  eRoomGasA(c); const u = E_RR[RR_UC]/M[c];
  eRoomGasA(a); const Ua = E_RR[RR_UC];
  eGasTake(c, f); eGasGive(a, 1);
  disp[c] -= dV; disp[a] += dV;
  E_RR[RR_UC] = Ua + g*u; eRoomTofUA(a);
}
function eLiqStep(dt, q){
  const N = GW*GH, M = q.M, E = q.E, K = q.bulk, vu = q.vu, vv = q.vv, LP = q.P, sc = ST.sc;
  const A = MPC*ROOM_DEPTH, p = SX.lqP, h = SX.lqH, hc = SX.lqHc, cap = SX.lqCap, comp = SX.lqComp, R = SX.lqRho, kap = SX.lqKap;
  const full = SX.lqFull, stand = SX.lqStand, gas = SX.lqGas, stiff = SX.lqStiff, hole = SX.rHole;
  const cd2 = 2*LIQ_CD*LIQ_CD, n2g = G_SI*LIQ_MANNING*LIQ_MANNING, P0 = ROOM_P0*1000, disp = ST.gsDisp;
  if(!q.tag) eLqSwell(N);
  let any = false;
  for(let i=0;i<N && !any;i++) if(M[i] > 0) any = true;
  if(!any){ vu.fill(0); vv.fill(0); return; }
  for(let i=0;i<N;i++){
    if(eLqShut(i)){ cap[i] = 0; eLqRhoA(q, i); } else { eLqCapA(q, i); cap[i] = E_RR[RR_CAP]; }
    R[i] = E_RR[RR_WRHO];
    if(q.tag || !(M[i] > 0)) kap[i] = 1/K; else { eRoomWKapA(i); kap[i] = E_RR[RR_WKAP]; }
    hc[i] = cap[i]/(R[i]*A);
    h[i] = M[i]/(R[i]*A);
    eLqLoadA(q, i); gas[i] = (ROOM_P0 + ST.roomP[i])*1000 + E_RR[RR_LOAD];
    full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0;
  }
  eLqStandWalk(N, full, stand);
  for(let i=0;i<N;i++) stiff[i] = full[i] && stand[i] && (i < GW || !eLqRuns(i, i-GW) || h[i-GW] > LIQ_H_LO) ? 1 : 0;
  for(let i=0;i<N;i++){ if(stiff[i]) p[i] = P0 + LP[i]*1000; else { eLqPFreeA(gas, h, i); p[i] = E_RR[RR_PF]; } }
  let live = false;
  const dLo = q.rho*G_SI*LIQ_H_LO;
  for(let i=0;i<N && !live;i++){ const X = i%GW;
    if(stiff[i] && M[i] - cap[i] > (1 - LIQ_FULL_K)*cap[i]) live = true;
    if(X < GW-1 && eLqRunsX(cap, i) && (h[i] > 0 || h[i+1] > 0)){
      if(Math.abs(vu[i]) > LIQ_REST) live = true;
      else { eLqDriveXA(q, h, hc, stand, p, gas, i, i+1); if(Math.abs(E_RR[RR_DRV]) > dLo) live = true; } }
    if(i < N-GW && eLqRunsY(cap, i) && (h[i] > 0 || h[i+GW] > 0)){ const j = i + GW;
      const d = p[i] - (full[j] ? p[j] - R[j]*G_SI*Math.min(h[j], hc[j]) : gas[j]);
      if(Math.abs(vv[i]) > LIQ_REST || Math.abs(d) > dLo) live = true; } }
  if(!live){ vu.fill(0); vv.fill(0); sc[SC_LIQCGIT] = 0; eLqWriteP(q, N, LP, M, stand, p, gas, P0); return; }

  const ax = SX.lqAx, ay = SX.lqAy, ayD = SX.lqAyD, b = SX.lqB, x = SX.lqX, fx = SX.lqFx, fy = SX.lqFy;
  const dI = SX.lqDI, awx = SX.lqAwx, awy = SX.lqAwy, lat = SX.lqLat;
  /* the gas step's own scratch, free until it next runs */
  const gc = E_GC, lab = SX.gsMol, gw = SX.gsFx, gf = SX.gsY;
  gc.lab = lab; gc.vg = SX.gsVg; gc.D = SX.gsDI; gc.V = SX.gsB; gc.G = SX.gsP; gc.Dt = SX.gsAy; gc.s = SX.gsAx; gc.w = gw; gc.wf = gf;
  eGcCells();
  for(let i=0;i<N;i++) gc.vg[i] = SX.rH1[i];
  eGcBuild();
  let nC = gc.n, lidDone = false, gasIt = 0;
  gc.n = 0;
  // a surface feels its own gas space, which evens out within a tick: one cell's lagging fill is not a suction
  { const pm = SX.rY, vs = gc.V;
    for(let r=0;r<nC;r++) pm[r] = 0;
    for(let i=0;i<N;i++){ const r = lab[i]; if(r >= 0){ eRoomVgasA(i); pm[r] += (ROOM_P0 + ST.roomP[i])*1000*E_RR[RR_VG]; } }
    for(let i=0;i<N;i++){ const r = lab[i]; if(r < 0) continue; eLqLoadA(q, i); gas[i] = pm[r]/vs[r] + E_RR[RR_LOAD]; if(!stiff[i]){ eLqPFreeA(gas, h, i); p[i] = E_RR[RR_PF]; } } }
  for(let pass=0;pass<2 + LIQ_GAS_IT;pass++){
    for(let i=0;i<N;i++) comp[i] = cap[i] > 0 ? (stiff[i] ? Math.max(cap[i]*kap[i], 1e-9) : A/G_SI) : 1;
    ax.fill(0); ay.fill(0); ayD.fill(0); fx.fill(0); fy.fill(0); awx.fill(0); awy.fill(0); lat.fill(0);
    for(let i=0;i<N;i++){ const X = i%GW;
      if(X < GW-1 && eLqRunsX(cap, i)){ const j = i + 1, hf = Math.max(Math.min(h[i], hc[i]), Math.min(h[j], hc[j]));
        let lz = false;
        if(!stand[i] && !stand[j]){ eLqFallVA(N, vv, i, RR_FALL); eLqFallVA(N, vv, j, RR_FV2);
          lz = Math.max(Math.abs(vu[i]), X > 0 ? Math.abs(vu[i-1]) : 0, X < GW-2 ? Math.abs(vu[i+1]) : 0)
            <= Math.max(E_RR[RR_FALL], E_RR[RR_FV2], LIQ_REST); }
        if(!lz) eLqDriveXA(q, h, hc, stand, p, gas, i, j);
        const d0 = lz ? 0 : E_RR[RR_DRV];
        if(hf > 0 && !lz){ const v = vu[i], up = v > 0 ? i : v < 0 ? j : (d0 >= 0 ? i : j), dn = up === i ? j : i;
          const Aw = ROOM_DEPTH*hf, L = MPC;
          let c = n2g*Math.abs(v)/Math.pow(Math.max(hf, 1e-3), 4/3);
          if(full[up] && !(full[dn] && stand[dn]) && (hole[i] || hole[j])) c += Math.abs(v)/(cd2*L);
          const vl = X > 0 && awx[i-1] > 0 ? vu[i-1] : 0, vr = X < GW-2 && eLqRunsX(cap, j) ? vu[j] : 0;
          const ain = (vl > 0 ? vl*vl : 0) - (vr < 0 ? vr*vr : 0) + 2*(lat[i] - lat[j]);
          const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
          awx[i] = Aw; ax[i] = g; fx[i] = 0.5*(R[i] + R[j])*Aw*dt*(v + dt*ain/MPC)/den + g*d0; } }
      if(i < N-GW && eLqRunsY(cap, i)){ const j = i + GW, v = vv[i];
        const d0 = p[i] - (full[j] ? p[j] - R[j]*G_SI*Math.min(h[j], hc[j]) : gas[j]);
        let up = v > 0 ? i : v < 0 ? j : (d0 > 0 ? i : d0 < 0 ? j : (M[i] >= M[j] ? i : j));
        if(!(M[up] > 0)) up = up === i ? j : i;
        const dn = up === i ? j : i;
        const f = cap[up] > 0 ? Math.min(1, M[up]/cap[up]) : 0;
        if(f > 0){ const Aw = A*f, L = Math.max(Math.min(h[i], hc[i]), Math.min(h[j], hc[j]), LIQ_L_MIN), hf = Math.max(f*MPC, 1e-3);
          if(!stand[i] && stand[j] && v > 0 && 0.5*v*v > lat[j]) lat[j] = 0.5*v*v;
          let c = n2g*Math.abs(v)/Math.pow(hf, 4/3);
          if(full[up] && !(full[dn] && stand[dn]) && (hole[i] || hole[j])) c += Math.abs(v)/(cd2*L);
          const va = i >= GW && awy[i-GW] > 0 ? vv[i-GW] : 0, vb = j < N-GW && eLqRunsY(cap, j) ? vv[j] : 0;
          const ain = (va > 0 ? va*va : 0) - (vb < 0 ? vb*vb : 0);
          const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
          awy[i] = Aw; fy[i] = 0.5*(R[i] + R[j])*Aw*dt*(v + dt*ain/MPC)/den + g*d0;
          if(full[j]) ay[i] = g; else ayD[i] = g; } } }
    for(let i=0;i<N;i++){ const X = i%GW;
      dI[i] = comp[i] + ayD[i];
      // water a stiff cell holds past its cap is compression it must shed this tick
      b[i] = (stiff[i] && M[i] > cap[i] ? M[i] - cap[i] : 0) - (fx[i] - (X > 0 ? fx[i-1] : 0) + fy[i] - (i >= GW ? fy[i-GW] : 0)); }
    if(nC){ const Dt = gc.Dt, D0 = gc.D;
      for(let r=0;r<nC;r++) Dt[r] = D0[r];
      for(let i=0;i<N;i++){ const r = lab[i];
        gw[i] = r >= 0 && cap[i] > 0 && !stiff[i] ? comp[i] : 0;
        if(gw[i] > 0) Dt[r] += gw[i];
        gf[i] = i < N-GW && ayD[i] > 0 && r >= 0 ? ayD[i] : 0;
        if(gf[i] > 0){ const f = lab[i+GW]; if(f >= 0) Dt[f] += gf[i]; } } }
    x.fill(0);
    gc.n = nC;
    sc[SC_LIQCGIT] = eCgSolve(b, x, dI, ax, ay, LIQ_CG_TOL, LIQ_CG_MAX, 0);
    if(nC) eGcY(x);
    gc.n = 0;
    const ys = gc.s;
    for(let i=0;i<N;i++){
      if(ax[i] !== 0) fx[i] += ax[i]*(x[i] - x[i+1]);
      if(ay[i] !== 0) fy[i] += ay[i]*(x[i] - x[i+GW]);
      else if(ayD[i] !== 0){ const f = nC && gf[i] > 0 ? lab[i+GW] : -1; fy[i] += ayD[i]*(x[i] - (f >= 0 ? ys[f] : 0)); }
    }
    /* a lid the pass fills from the side goes stiff and the pass is taken again */
    if(!lidDone){ let lid = false; lidDone = true;
      for(let i=0;i<N;i++){ const X = i%GW;
        if(!full[i] || stiff[i] || !stand[i]) continue;
        const net = -fx[i] + (X > 0 ? fx[i-1] : 0) - fy[i] + (i >= GW ? fy[i-GW] : 0);
        if(net > 1e-3){ stiff[i] = 1; lid = true; } }
      if(lid) continue; }
    // gas the pass sealed is rejoined, and a pocket's compliance steps halfway (in the log) toward its isentrope's secant
    if(gasIt < LIQ_GAS_IT && nC){ gasIt++;
      const was = SX.gsM0, vc = gc.vg, vT = SX.lqLcap, Dp = SX.gsY0, dv = SX.gsFy, D = gc.D, Vr = gc.V, Gr = gc.G;
      for(let r=0;r<nC;r++) Dp[r] = D[r];
      for(let i=0;i<N;i++){ const X = i%GW; was[i] = lab[i];
        const net = -fx[i] + (X > 0 ? fx[i-1] : 0) - fy[i] + (i >= GW ? fy[i-GW] : 0);
        eLqOtherVA(q, i); const v = Math.max(ROOM_VG_MIN*ROOM_VCELL, ROOM_VCELL - (M[i] + net)/R[i] - E_RR[RR_VO]);
        vT[i] = v; if(v < vc[i]) vc[i] = v; }
      eGcBuild();
      const n = gc.n;
      let moved = n !== nC;
      for(let i=0;i<N && !moved;i++) if(lab[i] !== was[i]) moved = true;
      const joined = moved;
      for(let r=0;r<n;r++) dv[r] = 0;
      for(let i=0;i<N;i++){ const r = lab[i]; if(r >= 0){ eRoomVgasA(i); dv[r] += E_RR[RR_VG] - vT[i]; } }
      for(let r=0;r<n;r++){ const V = Vr[r], g = Gr[r], d = dv[r];
        if(!(D[r] < E_INF)) continue;
        if(d > 1e-3*V) D[r] = d >= V ? 1e-6*D[r] : D[r]*g*d/V/(Math.pow(V/(V - d), g) - 1);
        if(joined) continue;
        D[r] = Math.sqrt(D[r]*Dp[r]);
        if(!(Math.abs(D[r] - Dp[r]) <= 0.02*Dp[r])) moved = true; }
      nC = n; gc.n = 0;
      if(moved) continue; }
    break;
  }
  for(let i=0;i<N;i++){
    if(awx[i] > 0){ const rf = 0.5*(R[i] + R[i+1]), v = eClamp(fx[i]/(rf*awx[i]*dt), -LIQ_V_MAX, LIQ_V_MAX); fx[i] = rf*awx[i]*dt*v; } else fx[i] = 0;
    if(awy[i] > 0){ const rf = 0.5*(R[i] + R[i+GW]); let v = eClamp(fy[i]/(rf*awy[i]*dt), -LIQ_V_MAX, LIQ_V_MAX);
      if(v < 0 && !eLqRuns(i+GW, i) && !full[i+GW]) v = 0;
      fy[i] = rf*awy[i]*dt*v; } else fy[i] = 0;
  }
  const lcap = SX.lqLcap, pA = SX.lqPa;
  for(let r=0;r<nC;r++) pA[r] = gc.D[r] < E_INF ? 0 : E_INF;
  /* a pocket takes no more than the solve that priced its gas gave it, whatever the limiter does to its neighbours */
  for(let i=0;i<N;i++){ const X = i%GW, r = nC ? lab[i] : -1;
    lcap[i] = Math.max(M[i], cap[i]);
    if(r >= 0 && gc.D[r] < E_INF){ const net = -fx[i] + (X > 0 ? fx[i-1] : 0) - fy[i] + (i >= GW ? fy[i-GW] : 0);
      lcap[i] = Math.min(lcap[i], M[i] + Math.max(0, net)); pA[r] += net/R[i]; } }
  for(let r=0;r<nC;r++) if(pA[r] < 0) pA[r] = 0;
  eFaceLimit(M, fx, fy, 128, lcap, nC);
  for(let i=0;i<N;i++){
    vu[i] = awx[i] > 0 ? fx[i]/(0.5*(R[i] + R[i+1])*awx[i]*dt) : 0;
    vv[i] = awy[i] > 0 ? fy[i]/(0.5*(R[i] + R[i+GW])*awy[i]*dt) : 0;
  }
  const M0 = SX.lqM0, vg0 = SX.gsFy, pend = SX.lqPend; M0.set(M);
  for(let i=0;i<N;i++){ if(q.tag) pend[i] = 0; else eLqPendA(i, pend, i); eRoomVgasA(i); vg0[i] = E_RR[RR_VG]; }
  eFaceInflow(SX.gsIn, fx, fy);
  eFaceMove(M, fx, fy);
  if(E) eRoomAdvect(E, M0, fx, fy, SX.gsIn, E_INF);
  for(let i=0;i<N;i++) if(M[i] <= 0){ M[i] = 0; if(E) E[i] = 0; }
  for(let i=0;i<N;i++){ eRoomVgasA(i); const d = vg0[i] - E_RR[RR_VG]; if(d !== 0) disp[i] += d;
    if(!q.tag) eLqSeenA(i, pend, i);
    if(nC && lab[i] >= 0) gas[i] += gc.s[lab[i]]; }
  // water falling out of a cell that held no gas trades places with the gas it falls into: the pocket rises as it fills
  for(let i=0;i<N-GW;i++) if(fy[i] > 0 && nC && lab[i] < 0 && lab[i+GW] >= 0){ E_RR[RR_SWV] = fy[i]/R[i]; eLqSwap(i, i+GW); }
  // ...and the room water leaves behind in a cell that held no gas is taken by the gas above or beside it
  for(let i=0;i<N;i++){ if(ST.roomM[i] > 0) continue;
    eRoomVgasA(i); const dv = E_RR[RR_VG] - vg0[i];
    if(!(dv > 0)) continue;
    const g = eGasNear(i);
    if(g >= 0){ E_RR[RR_SWV] = dv; eLqSwap(i, g); } }
  for(let i=0;i<N;i++){ h[i] = M[i]/(R[i]*A); full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0;
    if(stiff[i]) p[i] = p[i] + x[i]; else { eLqPFreeA(gas, h, i); p[i] = E_RR[RR_PF]; } }
  eLqStandWalk(N, full, stand);
  eLqWriteP(q, N, LP, M, stand, p, gas, P0);
  if(!q.tag) eLqAirDrain(dt, q, M, E, stand, cap, disp, N);
}
/* airborne water drains straight down past the pool rest gate, which would otherwise strand a jet's
   thin tail mid-air; standing pools are left to the solve above. Fraction per tick is free fall over
   one cell, mass and energy move together and the displaced gas is booked as disp. */
function eLqAirDrain(dt, q, M, E, stand, cap, disp, N){
  const k = Math.min(0.5, dt*Math.sqrt(G_SI/(2*MPC)));
  if(!(k > 0)) return;
  for(let Y=GH-2;Y>=0;Y--) for(let X=0;X<GW;X++){
    const i=Y*GW+X, j=i+GW, m=M[i];
    if(!(m > 0) || stand[i] || !eLqRuns(i, j)) continue;
    const room=cap[j]-M[j];
    if(!(room > 0)) continue;
    const dm=Math.min(m*k, room);
    if(!(dm > 0)) continue;
    eRoomVgasA(i); const g0a=E_RR[RR_VG]; eRoomVgasA(j); const g0b=E_RR[RR_VG];
    const f=dm/m;
    M[i]=m-dm; M[j]+=dm;
    if(E){ const de=E[i]*f; E[i]-=de; E[j]+=de; }
    eRoomVgasA(i); disp[i]+=g0a-E_RR[RR_VG];
    eRoomVgasA(j); disp[j]+=g0b-E_RR[RR_VG];
  }
}
/* a source (E_RR[RR_LKG] kg, RR_LKJ kJ, RR_LV0 m/s) climbs a full column to the first cell with room, arriving at the speed it left its opening at */
// RR_LDSP clear for a condensate: it came out of the gas and did no work on it
const eLiqLandAt = (q, i, kg, kJ, v0) => { E_RR[RR_LKG] = kg; E_RR[RR_LKJ] = kJ; E_RR[RR_LV0] = v0; E_RR[RR_LDSP] = 1; eLiqLand(q, i); };
/* the nearest cell with room that the liquid in full cells reaches from i0; downhill first, then the
   sides with the lead alternating call to call so a symmetric source spreads symmetric, then up; -1 for a body with none */
let E_LAND_FLIP = 0;
function eLqRoomNear(q, i0){
  if(!eLqFull(q, i0)) return i0;
  const N = GW*GH, seen = SX.lqSeen, Q = SX.lqQ, g = SX.rGen;
  if(g[E_GEN_LAND] >= 2147483600){ seen.fill(0); g[E_GEN_LAND] = 0; }
  const mark = ++g[E_GEN_LAND];
  const lfFirst = (E_LAND_FLIP++ & 1) === 0;
  let head = 0, tail = 0;
  seen[i0] = mark; Q[tail++] = i0;
  while(head < tail){ const i = Q[head++], X = i%GW;
    const dn = i < N-GW ? i + GW : -1, up = i >= GW ? i - GW : -1;
    const lf = X > 0 ? i - 1 : -1, rt = X < GW-1 ? i + 1 : -1;
    for(let d=0;d<4;d++){
      const j = d === 0 ? dn : d === 3 ? up : (d === 1) === lfFirst ? lf : rt;
      if(j < 0 || seen[j] === mark || eLqShut(j) || !eLqRuns(i, j)) continue;
      seen[j] = mark;
      if(!eLqFull(q, j)) return j;
      Q[tail++] = j; } }
  return -1;
}
/* what does not fit at the arriving liquid's own density goes to the nearest room; a body with none keeps it, the mass is never lost */
function eLiqLand(q, i){
  const kg = E_RR[RR_LKG], kJ = E_RR[RR_LKJ], v0 = E_RR[RR_LV0];
  if(!(kg > 0)) return;
  let left = kg;
  for(let n=0;n<GW*GH && left > 0;n++){
    const j = eLqRoomNear(q, i);
    let take = left;
    if(j >= 0){ i = j;
      eLqOtherVA(q, i); const vo = E_RR[RR_VO];
      eLqRhoA(q, i); const vw = q.M[i] > 0 ? q.M[i]/E_RR[RR_WRHO] : 0;
      if(q.tag) E_RR[RR_WRHO] = q.rho; else eWRhoA(i, kJ/kg);
      take = Math.min(left, Math.max(0, ROOM_VCELL - vo - vw)*E_RR[RR_WRHO]);
      if(n === GW*GH - 1) take = left; }
    if(q.tag) E_LQPD[0] = 0; else eLqPendA(i, E_LQPD, 0);
    eRoomVgasA(i); const v0g = E_RR[RR_VG];
    q.M[i] += take;
    if(q.E) q.E[i] += kJ*take/kg;
    if(E_RR[RR_LDSP]){ eRoomVgasA(i); ST.gsDisp[i] += v0g - E_RR[RR_VG]; if(!q.tag) eLqSeenA(i, E_LQPD, 0); }
    if(v0 > 0 && i < GW*GH-GW && eLqRuns(i, i+GW) && !eLqFull(q, i+GW)) q.vv[i] = Math.max(q.vv[i], Math.min(v0, LIQ_V_MAX));
    left -= take;
  }
}

const E_RIO = new Float64Array(MX_N), E_RP = new Float64Array(8);
function ePoolTA(i){ const m = ST.roomPool[i], E = ST.roomPoolE[i];
  if(!(m > 0)){ E_RR[RR_PT] = T_HULL; return; }
  const f = PT.rFire, cp = PK[PK_RFIRECP], eF = -m*f.lf;
  E_RR[RR_PT] = E >= 0 ? f.melt + E/(m*cp) : E > eF ? f.melt : f.melt + (E - eF)/(m*cp); }
const eRoomPoolT = i => { ePoolTA(i); return E_RR[RR_PT]; };
function eRoomWaterTA(i){
  if(ST.roomWater[i] > 0){ const io = E_RIO; io[MX_P] = (ROOM_P0 + Math.max(0, ST.roomWP[i]))/1000; io[MX_H] = ST.roomWaterE[i]/ST.roomWater[i];
    tLiqA(SAT_WATER, io); E_RR[RR_T] = io[MX_TL]; }
  else E_RR[RR_T] = T_HULL; }
const eRoomWaterT = i => { eRoomWaterTA(i); return E_RR[RR_T]; };
/* cell i's water at its own temperature: E_RP[7] K and its saturation pressure E_RP[3] MPa */
function eWaterPsatA(i){ const io = E_RIO; io[MX_H] = ST.roomWaterE[i]/ST.roomWater[i]; wTfA(io, MX_H, MX_TL);
  E_RP[7] = io[MX_TL]; curveA(SAT_WATER, CV_SP, E_RP, 7, 3); }

/* floor water boils off past saturation at the gas over it, and trades with its own air over a free surface */
function eWaterHeat(dt, src){
  const N = GW*GH, s = ST, W = s.roomWater, E = s.roomWaterE, Tr = s.roomT, A = MPC*ROOM_DEPTH, hk = ROOM_H*A/1000, q = E_LQ[0], r = E_RP;
  for(let i=0;i<N;i++){
    const m = W[i];
    if(!(m > 0)) continue;
    if(SX.gsVoid[i] && SX.gsVoid[i] !== E_VD_GAS && !(s.roomM[i] > 0) && !eLqFull(q, i)){
      // a cavity fills with its own vapour until the water its latent heat cooled holds it at p_sat
      eRoomVgasA(i); const Vg = E_RR[RR_VG], rho = E_RR[RR_WRHO];
      eWaterPsatA(i); r[0] = E_RP[3]; r[1] = E_RP[7]; satHA(SAT_WATER, r, 0, 2); curveA(SAT_WATER, CV_HFG, r, 1, 4);
      const hg = r[2] + r[4];
      r[5] = ROOM_P0/1000; satHA(SAT_WATER, r, 5, 6);
      const top = Math.max(0, E[i] - m*r[6])/r[4];
      let dm = 0;
      for(let k=0;k<3;k++){ const io = E_RIO; io[MX_H] = (E[i] - dm*hg)/(m - dm); wTfA(io, MX_H, MX_TL);
        E_RP[7] = io[MX_TL]; curveA(SAT_WATER, CV_SP, E_RP, 7, 3); dm = Math.min(top, E_RP[3]*(Vg + dm/rho)/(R_VAP*E_RP[7])); }
      if(dm > 0){ W[i] = m - dm; E[i] -= dm*hg; Tr[i] = E_RP[7]; s.roomVap[i] += dm; s.roomM[i] += dm; eBook(E_BK_SUMP, dm); }
      continue; }
    r[0] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; satTA(SAT_WATER, r, 0, 1); satHA(SAT_WATER, r, 0, 2);
    const hf = r[2];
    if(E[i] > m*hf){
      curveA(SAT_WATER, CV_HFG, r, 1, 4);
      /* it flashes only until the steam it makes brings the gas over it to the water's own saturation pressure */
      eWaterPsatA(i);
      eRoomVgasA(i); const room = Math.max(0, E_RP[3] - r[0])*E_RR[RR_VG]/(R_VAP*Math.max(Tr[i], r[1]));
      const hfg = r[4], dm = Math.min(m, (E[i] - m*hf)/hfg, room);
      W[i] = m - dm; E[i] -= dm*(hf + hfg);
      s.roomVap[i] += dm; s.roomM[i] += dm; eBook(E_BK_SUMP, dm);
      r[5] = Tr[i]; hOfTA(SAT_WATER, r, 5, 6);
      /* steam leaves a boiling pool at its saturation temperature and cannot drive the air past it */
      E_RR[RR_T] = r[1]; E_RR[RR_QDT] = dt;
      E_RR[RR_QC] = dm*(hf + hfg - r[6])/dt; eJetQCapA(i); src[i] += E_RR[RR_QC];
      if(W[i] <= 0){ W[i] = 0; E_RR[RR_QC] = E[i]/dt; eJetQCapA(i); src[i] += E_RR[RR_QC]; E[i] = 0; continue; }
    }
    if(eLqFull(q, i) && i >= GW && W[i-GW] > 0 && !eLqShut(i-GW)) continue;
    eRoomWaterTA(i); const Tw = E_RR[RR_T];
    let qk = hk*SX.rD2[i]*(Tw - Tr[i]);
    r[5] = Tw; r[7] = (ROOM_P0 + Math.max(0, s.roomWP[i]))/1000; cpOfTPA(SAT_WATER, r, 5, 7, 6);
    const cp = W[i]*r[6]*(Tw - Tr[i])/dt;
    qk = qk > 0 ? Math.min(qk, Math.max(0, cp)) : Math.max(qk, Math.min(0, cp));
    E[i] -= qk*dt; src[i] += qk;
  }
}
function ePanField(a, M, E, want, water){
  const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1];
  for(let k=k0;k<k1;k++){
    if(!(want > 0)) break;
    const i = PT.partCellIx[k], take = Math.min(want, M[i]);
    if(!(take > 0)) continue;
    E[i] -= E[i]*take/M[i];
    if(water) eBook(E_BK_SUMP, take);
    eRoomVgasA(i); ST.gsDisp[i] += E_RR[RR_VG];
    M[i] -= take; want -= take;
    eRoomVgasA(i); ST.gsDisp[i] -= E_RR[RR_VG];
    ST.panBy[a] += take;
    if(M[i] <= 0){ M[i] = 0; E[i] = 0; }
  }
  return want;
}
function ePanDrain(dt){
  const nP = PT.n.part, s = ST;
  for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 3 || s.dmgBy[a]) continue;
    const want = ePanField(a, s.roomWater, s.roomWaterE, PAN_DRAIN_KGS*dt, true);
    ePanField(a, s.roomPool, s.roomPoolE, want, false);
  }
}

/* a metal fire is a surface: sprays burn in flight on the gas Weber number, pools burn at their free surface */
function eFireStep(dt, src){
  const N = GW*GH, s = ST, sc = s.sc, f = PT.rFire, cp = PK[PK_RFIRECP];
  const M = s.roomPool, E = s.roomPoolE, O = s.roomO2, Tr = s.roomT, fq = SX.rFireQ, cells = SX.rCells, pour = SX.rCells2;
  fq.fill(0);
  sc[SC_ROOMFIREON] = 0;
  const cool = PT.rFireOn;
  let on = 0;
  if(cool) for(let o=0;o<PT.nOpen;o++){
    const kg = eOpenKg(o); if(!(kg > 0)) continue;
    const nd = eOpenFl(o); if(nd < 0) continue;
    const ks = PT.nodeSat[nd]; if(!PT.satBurn[ks]) continue;
    const nc = eOpenCells(o, cells); if(!nc) continue;
    const c = PT.sats[ks], pN = s.pBy[nd]*1e6, pR = (ROOM_P0 + s.roomP[cells[0]])*1000;
    const v = Math.sqrt(2*Math.max(0, pN - pR)/PK[PK_RFIRERHO]), d = PT.openBore[o];
    const we = ROOM_RHO*v*v*d/f.sigma;
    const frac = d > 0 ? eClamp((we - SPRAY_WE0)/(SPRAY_WE1 - SPRAY_WE0), 0, 1) : 0;
    E_RIO[MX_P] = s.pBy[nd]; E_RIO[MX_H] = s.hBy[nd]; tOfHA(c, E_RIO); const Tin = E_RIO[MX_T];
    const want = Tin >= f.ign ? kg*frac*f.eta : 0;
    let burnt = 0;
    if(want > 0){ E_RR[RR_B] = kg/dt; const m = ePlume(cells, nc), Q = SX.rPlQ, Wt = SX.rPlW;
      for(let k=0;k<m;k++){ const i = Q[k], mm = Math.min(want*Wt[k], O[i]/f.o2);
        if(!(mm > 0)) continue;
        O[i] -= mm*f.o2; s.roomM[i] -= mm*f.o2;
        fq[i] += mm*(f.lhv + cp*(Tin - f.melt));
        burnt += mm; on++; } }
    sc[SC_FIREKG] += burnt; sc[SC_FIREQ] += burnt*f.lhv;
    const np = eOpenPour(o, cells, nc), per = (kg - burnt)/np;
    if(per > 0){ E_RR[RR_LKG] = per; E_RR[RR_LKJ] = per*cp*(Tin - f.melt); E_RR[RR_LV0] = v;
      E_RR[RR_LDSP] = 1; for(let k=0;k<np;k++) eLiqLand(E_LQ[1], pour[k]); }
  }
  const W = s.roomWater;
  if(cool) eLiqStep(dt, E_LQ[1]);
  eLiqStep(dt, E_LQ[0]);
  ePanDrain(dt);
  eWaterHeat(dt, src);
  for(let i=0;i<N;i++)
    if(s.roomM[i] > 0){ eRoomVgasA(i); if(!eGasCell(E_RR[RR_VG])) eGasDisplace(i, ROOM_VCELL); }
  if(!cool) return;
  const A0 = MPC*MPC;
  for(let i=0;i<N;i++){
    let m = M[i];
    if(!(m > 0)) continue;
    const A = Math.min(A0, (m + (i+GW < N ? M[i+GW] : 0))/(PK[PK_RFIRERHO]*POOL_DMIN));
    ePoolTA(i); let Tp = E_RR[RR_PT];
    eRoomO2FracA(i); const fo2 = E_RR[RR_O2F];
    const open = i < GW || !(M[i-GW] > 0);
    /* water needs neither air nor a spark */
    if(open && f.wlhv){
      const sump = W[i], vap = s.roomVap[i];
      const mw = Math.min(f.wrate*A*dt, m, (sump + vap)/f.wh2o);
      if(mw > 0){
        const rq = mw*f.wlhv, rh2 = mw*f.wh2;
        let need = mw*f.wh2o;
        if(sump > 0){ const take = Math.min(need, sump);
          s.roomWaterE[i] -= s.roomWaterE[i]*take/sump; W[i] = sump - take; eBook(E_BK_SUMP, take); need -= take; }
        if(need > 0){ const t = Math.min(need, vap); s.roomM[i] -= t; s.roomVap[i] -= t; }
        M[i] = m = m - mw;
        E[i] += rq - mw*cp*(Tp - f.melt);
        s.roomH2[i] += rh2; s.roomM[i] += rh2;
        sc[SC_FIREKG] += mw; sc[SC_FIREQ] += rq;
        on++;
        ePoolTA(i); Tp = E_RR[RR_PT];
      }
    }
    if(open && Tp >= f.ign && fo2 >= f.loc){
      const mb = Math.min(f.rate*(fo2/O2_FRAC0)*A*dt, m, O[i]/f.o2);
      if(mb > 0){
        M[i] = m = m - mb;
        O[i] -= mb*f.o2; s.roomM[i] -= mb*f.o2;
        E[i] += mb*f.lhv - mb*cp*(Tp - f.melt);
        sc[SC_FIREKG] += mb; sc[SC_FIREQ] += mb*f.lhv;
        on++;
      }
    }
    if(!(m > 0)){ M[i] = 0; E[i] = 0; continue; }
    ePoolTA(i); Tp = E_RR[RR_PT];
    let q = (f.hConv*(Tp - Tr[i]) + f.emis*SIGMA*(Math.pow(Tp,4) - Math.pow(Tr[i],4))/1000)*A*SX.rD2[i];
    const qCap = m*cp*(Tp - Tr[i])/dt;
    q = q > 0 ? Math.min(q, Math.max(0, qCap)) : Math.max(q, Math.min(0, qCap));
    E[i] -= q*dt; src[i] += q;
    const eMax = m*cp*(f.boil - f.melt);
    if(E[i] > eMax){ src[i] += (E[i] - eMax)/dt; E[i] = eMax; }
  }
  sc[SC_ROOMFIREON] = on;
}

/* Fick on the mass fraction; `up` is a drift, so hydrogen collects at the deckhead */
function eDiffuse(F, dt, up){
  const N = GW*GH, d = SX.rD2, y = SX.rY, M = ST.roomM, gx = SX.rGx, gDn = SX.rGDn;
  for(let i=0;i<N;i++) y[i] = M[i] > 0 ? F[i]/M[i] : 0;
  { const y0 = y[0]; let flat = true;
    for(let i=1;i<N;i++) if(y[i] !== y0){ flat = false; break; }
    if(flat && (up === 1 || y0 === 0)) return; }
  d.fill(0);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW + X, q = gx[i]*Math.min(M[i], M[i+1])*(y[i] - y[i+1]);
    d[i] -= q; d[i+1] += q; }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW + X, j = i + GW, q = gDn[i]*Math.min(M[i], M[j])*(up*y[j] - y[i]);
    d[i] += q; d[j] -= q; }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
}

/* RR_H2F, RR_COF and RR_O2F at the unburnt side of the front */
function eFrontA(i){ const u = Math.max(ROOM_FR_MIN, 1 - ST.roomFlame[i]), n = ST.roomH2[i]/H2_MMOL, nc = ST.roomCO[i]/CO_MMOL;
  eRoomMolXA(i); const mx = E_RR[RR_MX] - nc, d = mx*u + n + nc;
  E_RR[RR_H2F] = n > 0 ? n/d : 0; E_RR[RR_COF] = nc > 0 ? nc/d : 0;
  E_RR[RR_O2F] = ST.roomO2[i]/O2_MMOL/Math.max(1e-9, d); }
/* laminar burning velocity into RR_A: hydrogen's at the fuel's whole fraction, CO's share of the fuel at CO_SL_K of it */
function eH2SlA(){ const fh = E_RR[RR_H2F], fc = E_RR[RR_COF], f = fh + fc;
  E_RR[RR_A] = 0;
  if(f <= H2_SL[0][0] || f >= H2_SL[H2_SL.length-1][0]) return;
  for(let k=1;k<H2_SL.length;k++){ const x1 = H2_SL[k][0], y1 = H2_SL[k][1],
                                   x0 = H2_SL[k-1][0], y0 = H2_SL[k-1][1];
    if(f <= x1){ E_RR[RR_A] = y0 + (y1-y0)*(f-x0)/(x1-x0); break; } }
  if(fc > 0) E_RR[RR_A] *= (fh + CO_SL_K*fc)/f; }
/* Le Chatelier over the two fuels: the mixture burns between the fraction-weighted harmonic limits; RR_IGN its bulk autoignition */
function eFlamRR(){ const fh = E_RR[RR_H2F], fc = E_RR[RR_COF];
  if(!(fc > 0)){ E_RR[RR_IGN] = H2_IGN; return fh >= H2_LFL && fh <= H2_UFL && E_RR[RR_O2F] >= O2_LOC; }
  const f = fh + fc;
  E_RR[RR_IGN] = (fh*H2_IGN + fc*CO_IGN)/f;
  return f >= f/(fh/H2_LFL + fc/CO_LFL) && f <= f/(fh/H2_UFL + fc/CO_UFL) && E_RR[RR_O2F] >= O2_LOC; }
function eRoomCOFracA(i){ const n = ST.roomCO[i]/CO_MMOL;
  if(n > 0){ eRoomMolXA(i); E_RR[RR_COF] = n/(E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL); } else E_RR[RR_COF] = 0; }
function eFlam(i){ eRoomH2FracA(i); eRoomCOFracA(i); eRoomO2FracA(i); return eFlamRR(); }
function eIgnites(i){
  if(ST.roomT[i] >= E_RR[RR_IGN]) return true;
  const a = PT.rOwn[i];
  if(a < 0) return false;
  ePartSkinA(a); return E_RR[RR_SK] >= H2_IGN_SURF || ST.dmgBy[a] === 1;
}

/* kJ per kg of fuel burnt at constant volume, onto the room's own species energies (datum u(T_SPACE) = 0): the lower heating value
   less the work of the moles lost, and the products' and reactants' energies at 298.15 K where the heating value is stated */
function eQvOf(lhv, mm, prod, fuel, o2){ const io = ROOM_SPIO; io[2] = 298.15; const u = s => { roomSpA(s, io, 2, 0); return io[1]; };
  return lhv - 0.5*RGAS_U*298.15/mm/1000 + (1 + o2)*u(prod) - u(fuel) - o2*u(ROOM_SP_O2); }
const E_H2_QV = eQvOf(H2_LHV, H2_MMOL, ROOM_SP_VAP, ROOM_SP_H2, O2_PER_H2), E_CO_QV = eQvOf(CO_LHV, CO_MMOL, ROOM_SP_CO2, ROOM_SP_CO, O2_PER_CO);
/* the gas step's peak overpressure in E_RR[RR_PMAX] */
function eH2Step(dt){
  const pmax = E_RR[RR_PMAX];
  const N = GW*GH, s = ST, sc = s.sc, H = s.roomH2, O = s.roomO2, Fl = s.roomFlame, Tr = s.roomT, cells = SX.rCells;
  sc[SC_ROOMBURNON] = 0;
  for(let o=0;o<PT.nOpen;o++){
    const m = eOpenH2(o); if(!(m > 0)) continue;
    if(eOpenFl(o) < 0) continue;
    const nc = eOpenCells(o, cells); if(!nc) continue;
    E_RR[RR_B] = Math.max(0, eOpenKg(o))/dt; const np = ePlume(cells, nc); E_RR[RR_C] = m; eAddH2Q(np);
  }
  const nP = PT.n.part;
  if(!sc[SC_BLACKOUT]) for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 1 || s.dmgBy[a]) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1]; if(k1 === k0) continue;
    const f = Math.min(1, ROOM_VENT_KGS/(k1 - k0)/ROOM_MAIR*dt);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k];
      H[i] -= H[i]*f; s.roomVap[i] -= s.roomVap[i]*f; s.roomCO[i] -= s.roomCO[i]*f; s.roomCO2[i] -= s.roomCO2[i]*f;
      eRoomVgasA(i); const m0 = ROOM_P0/1000*E_RR[RR_VG]/(R_AIR*Math.max(Tr[i], 1));
      O[i] += (ROOM_O2_0/ROOM_M0*m0 - O[i])*f;
      s.roomM[i] += (m0 - s.roomM[i])*f; } }
  for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 2 || s.dmgBy[a]) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1]; if(k1 === k0) continue;
    const f = Math.min(1, INERT_KGS/(k1 - k0)/ROOM_MAIR*dt);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k]; H[i] -= H[i]*f; O[i] -= O[i]*f; s.roomCO[i] -= s.roomCO[i]*f; } }
  eDiffuse(H, dt, H2_UP);
  eDiffuse(O, dt, 1);
  eDiffuse(s.roomCO, dt, CO_UP);
  eDiffuse(s.roomCO2, dt, CO2_UP);

  for(let i=0;i<N;i++)
    if(Fl[i] <= 0 && (H[i] > 0 || s.roomCO[i] > 0) && eFlam(i) && eIgnites(i)) Fl[i] = 1e-6;
  let burned = 0, on = 0;
  const fq = SX.rFireQ, turb = PT.rTurb;
  for(let i=0;i<N;i++){
    let q = 0;
    if(Fl[i] > 0){
      eFrontA(i);
      if(!eFlamRR()) Fl[i] = 0;
      else {
        eH2SlA();
        const adv = Math.min(1, E_RR[RR_A]*turb[i]*dt/MPC);
        /* the advance consumes the deficient reactant; the products stay in the cell and the gas keeps its energy plus the reaction's */
        let mh = H[i]*adv, mc = s.roomCO[i]*adv;
        const need = mh*O2_PER_H2 + mc*O2_PER_CO;
        if(need > O[i]){ const k = O[i]/need; mh *= k; mc *= k; }
        if(mh > 0 || mc > 0){ eRoomGasA(i); const u0 = E_RR[RR_UC];
          H[i] -= mh; s.roomCO[i] -= mc; O[i] -= mh*O2_PER_H2 + mc*O2_PER_CO;
          s.roomVap[i] += mh*(1 + O2_PER_H2); s.roomCO2[i] += mc*(1 + O2_PER_CO);
          eRoomGasA(i); q = u0 - E_RR[RR_UC] + mh*E_H2_QV + mc*E_CO_QV; burned += mh; }
        const nf = Math.min(1, Fl[i] + adv);
        if(nf >= 1 && Fl[i] < 1){
          const X = i%GW, Y = (i/GW)|0;
          if(X > 0 && Fl[i-1] <= 0 && eFlam(i-1)) Fl[i-1] = 1e-6;
          if(X < GW-1 && Fl[i+1] <= 0 && eFlam(i+1)) Fl[i+1] = 1e-6;
          if(Y > 0 && Fl[i-GW] <= 0 && eFlam(i-GW)) Fl[i-GW] = 1e-6;
          if(Y < GH-1 && Fl[i+GW] <= 0 && eFlam(i+GW)) Fl[i+GW] = 1e-6;
        }
        Fl[i] = nf;
        on++;
      }
    }
    if(fq[i] > 0) q += fq[i];
    if(q > 0){ E_RR[RR_BANG] = q; eRoomBang(i); }
  }
  eScarStep();
  sc[SC_ROOMBURNON] = on; sc[SC_ROOMPMAX] = pmax;
  if(sc[SC_ROOMFIREON] && pmax > sc[SC_FIREP]) sc[SC_FIREP] = pmax;
  if(burned > 0 || on){
    if(sc[SC_BURNKG] === 0 && sc[SC_BURNP] === 0) ST.burnEvBy.fill(0);
    sc[SC_BURNKG] += burned;
    if(pmax > sc[SC_BURNP]) sc[SC_BURNP] = pmax; }
}

function eScarStep(){
  const N = GW*GH, scar = ST.roomScar, cur = ST.roomScarCur, occ = PT.rOcc, tight = PT.rTight;
  for(let i=0;i<N;i++){
    if(occ[i] || tight[i]) continue;
    eBangA(i); const a = Math.abs(E_RR[RR_EXC]);
    if(a > cur[i]) cur[i] = a;
    else if(a < cur[i]*0.5){ if(cur[i] > HIT_LO) scar[i] += cur[i] - HIT_LO; cur[i] = a; }
  }
}
/* steam above its saturation pressure at the cell's own temperature lands on that cell's floor */
function eCondense(){
  const N = GW*GH, s = ST, Vp = s.roomVap, Tr = s.roomT, q = E_LQ[0];
  for(let i=0;i<N;i++){
    const v = Vp[i];
    if(!(v > 0)) continue;
    const Tk = Math.max(Tr[i], 1);
    E_RP[0] = Tk; curveA(SAT_WATER, CV_SP, E_RP, 0, 1); eRoomVgasA(i);
    const drop = Math.min(v, s.roomM[i]) - E_RP[1]*E_RR[RR_VG]/(R_VAP*Tk);
    if(!(drop > 0)) continue;
    E_RP[2] = Tr[i]; E_RP[4] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; hOfTPA(SAT_WATER, E_RP, 2, 4, 3);
    Vp[i] = v - drop; s.roomM[i] -= drop;
    E_RR[RR_LKG] = drop; E_RR[RR_LKJ] = drop*E_RP[3]; E_RR[RR_LV0] = 0; E_RR[RR_LDSP] = 0; eLiqLand(q, i);
    eBook(E_BK_SUMP, -drop);
  }
}

function eInjectRoom(dt, src){
  const s = ST, sc = s.sc, kind = sc[SC_INJKIND], rate = sc[SC_INJDEM], i = sc[SC_INJCELL];
  if(!kind || !rate || i < 0 || i >= GW*GH) return;
  if(kind === E_INJ_HEAT){ src[i] += rate; return; }
  if(kind === E_INJ_GAS){
    if(!(rate < 0) || !(s.roomM[i] > 0)) return;
    const f = Math.min(1, -rate*dt/s.roomM[i]);
    // the gas left behind pushed the rest out: it rides its isentrope, T ~ rho^(gamma-1), exact over any fraction taken
    eRoomGasA(i); const cv = E_RR[RR_CVC], g = cv > E_CV_MIN ? E_RR[RR_CPC]/cv : GAM_AIR;
    eGasTake(i, f); sc[SC_FPBOOKN] += E_GSP[4]; sc[SC_FPBOOKV] += E_GSP[5];
    if(s.roomM[i] > 0) s.roomT[i] = Math.max(T_SPACE, s.roomT[i]*Math.pow(1 - f, g - 1));
    return; }
  if(kind === E_INJ_FLUID){
    const W = s.roomWater, dm = rate > 0 ? rate*dt : -Math.min(-rate*dt, W[i]);
    if(!dm) return;
    if(dm > 0){ E_RP[2] = T_HULL; E_RP[4] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; hOfTPA(SAT_WATER, E_RP, 2, 4, 3);
      E_RR[RR_LKG] = dm; E_RR[RR_LKJ] = dm*E_RP[3]; E_RR[RR_LV0] = rate/(WATER_RHO*MPC*ROOM_DEPTH);
      E_RR[RR_LDSP] = 1; eLiqLand(E_LQ[0], i); eBook(E_BK_INJECT, -dm); return; }
    s.roomWaterE[i] += s.roomWaterE[i]*dm/W[i]; eRoomVgasA(i); s.gsDisp[i] += E_RR[RR_VG];
    W[i] += dm; eRoomVgasA(i); s.gsDisp[i] -= E_RR[RR_VG];
    eBook(E_BK_INJECT, -dm);
    return; }
  if(!(rate > 0)) return;
  const dm = rate*dt;
  // a bottle gas arrives at the hull's temperature, steam dry saturated at the cell's pressure; each brings its h, and the flow work heats the cell it fills
  let sp = -1, T = T_HULL;
  if(kind === E_INJ_H2) sp = ROOM_SP_H2;
  else if(kind === E_INJ_O2) sp = ROOM_SP_O2;
  else if(kind === E_INJ_STEAM){ sp = ROOM_SP_VAP; E_RP[0] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; satTA(SAT_WATER, E_RP, 0, 1); T = E_RP[1]; }
  else return;
  eRoomGasA(i); const U = E_RR[RR_UC];
  if(sp === ROOM_SP_H2) s.roomH2[i] += dm; else if(sp === ROOM_SP_O2) s.roomO2[i] += dm; else s.roomVap[i] += dm;
  s.roomM[i] += dm;
  eSpHA(sp, T); E_RR[RR_UC] = U + dm*E_GS[1]; eRoomTofUA(i);
}
/* the INJECT tool aimed at a node: a boundary the player holds open, booked against `inject` */
function eInjectFluid(dt){
  const sc = ST.sc, n = sc[SC_INJNODE], rate = sc[SC_INJDEM];
  if(sc[SC_INJKIND] !== E_INJ_FLUID || !rate || n < 0) return;
  const have = ST.mBy[n];
  if(!isFinite(have)) return;
  const kg = rate > 0 ? rate*dt : -Math.min(-rate*dt, have);
  if(!kg) return;
  if(kg > 0){ const k = have/(have + kg); ST.fpNBy[n] *= k; ST.fpVBy[n] *= k; }
  else { ST.sc[SC_FPBOOKN] -= ST.fpNBy[n]*kg; ST.sc[SC_FPBOOKV] -= ST.fpVBy[n]*kg; }
  ST.mBy[n] = have + kg;
  eBook(E_BK_INJECT, -kg);
}

// phi = C_v/(C_v + dt*G) over the cell's whole outside conductance: backward Euler in the gas temperature, and no gas exchanges nothing
function ePhiFill(dt, phi){
  const N = GW*GH, s = ST, W = s.roomWater, hkW = ROOM_H*ROOM_A_FACE/1000;
  for(let i=0;i<N;i++) phi[i] = ROOM_H*PT.rStrA[i]/1000 + (W[i] > 0 ? hkW : 0);
  for(let a=0;a<PT.n.part;a++){ const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1];
    if(PT.partKind[a] === 0) for(let k=k0;k<k1;k++) phi[PT.partCellIx[k]] += ROOM_HK;
    if(!s.sc[SC_BLACKOUT] && PT.partRoomRole[a] === 1 && !s.dmgBy[a] && k1 > k0){ const ua = ROOM_VENT_KGS/(k1 - k0);
      for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k]; eRoomGasA(i); phi[i] += ua*E_GMX[GX_CP]; } } }
  for(let g=0;g<PT.nRseg;g++) for(let k=PT.rsegCell0[g];k<PT.rsegCell0[g+1];k++) phi[PT.rsegCellIx[k]] += ROOM_HK;
  if(PT.rFireOn){ const f = PT.rFire, A0 = MPC*MPC;
    for(let i=0;i<N;i++) if(s.roomPool[i] > 0){ ePoolTA(i); const Tp = E_RR[RR_PT];
      phi[i] += (f.hConv + 4*f.emis*SIGMA*Tp*Tp*Tp/1000)*A0; } }
  for(let i=0;i<N;i++){ eRoomGasA(i); const c = E_RR[RR_CVC]; phi[i] = c > E_CV_MIN ? c/(c + dt*phi[i]) : 0; }
}
/* contents to skin to air, both ways; what the room takes is booked against the pot it left (ST.skinQ) */
function eRoomStep(dt){
  eLqBind(); eRoomLive();
  const N = GW*GH, s = ST, sc = s.sc, Tr = s.roomT, src = SX.rSrc, d = SX.rD, cells = SX.rCells;
  src.fill(0);
  sc[SC_FACERES] = 0;
  eGasStep(dt, src);
  const nP = PT.n.part, phi = SX.rD2;
  ePhiFill(dt, phi);
  for(let a=0;a<nP;a++){
    if(PT.partKind[a] !== 0) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1], n = k1 - k0;
    if(!n) continue;
    ePartTempA(a); const Tp = E_RR[RR_PTMP], proc = isFinite(Tp);
    if(s.partT[a] < 0) s.partT[a] = proc ? Tp : T_HULL;
    const Ts = s.partT[a];
    let air = 0;
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k], q = ROOM_HK*phi[i]*(Tr[i] - Ts); air += q; src[i] -= q; }
    const qProc = proc ? n*ROOM_HK*SKIN_PROC_K*(Tp - Ts) : 0;
    s.skinQ[a] = qProc;
    s.partT[a] = eClamp(Ts + (qProc + air)/skinCap(n)*dt, T_SPACE, ROOM_TMAX);
  }
  for(let g=0;g<PT.nRseg;g++){
    const k0 = PT.rsegCell0[g], k1 = PT.rsegCell0[g+1], n = k1 - k0, nd = PT.rsegNode[g];
    let Tf0 = E_NAN; if(nd >= 0){ eNodeTA(nd); Tf0 = E_NT[MX_T]; } const has = isFinite(Tf0);
    if(s.runT[g] < 0) s.runT[g] = has ? Tf0 : T_HULL;
    const Ts = s.runT[g];
    let air = 0;
    for(let k=k0;k<k1;k++){ const i = PT.rsegCellIx[k], q = ROOM_HK*phi[i]*(Tr[i] - Ts); air += q; src[i] -= q; }
    const qProc = has ? n*ROOM_HK*SKIN_PROC_K*(Tf0 - Ts) : 0;
    s.runT[g] = eClamp(Ts + (qProc + air)/skinCap(n)*dt, T_SPACE, ROOM_TMAX);
  }
  const sh = PK[PK_RSTEAMH], jr = PT.rJetRelief;
  /* the hottest shell on the board is what a relief or a vent is passing */
  let st = T_HULL;
  for(let b=0;b<PT.n.boiler;b++) if(s.sgTBy[b] > st) st = s.sgTBy[b];
  for(let k=0;k<jr.length;k++){ const v = jr[k], rate = s.reliefSteam[v];
    if(!(rate > 0)) continue;
    const nc = ePartCells(PT.fitPart[PT.reliefFit[v]], cells); if(!nc) continue;
    E_RR[RR_B] = rate; const m = ePlume(cells, nc);
    E_RR[RR_C] = rate*sh; E_RR[RR_T] = st; E_RR[RR_QDT] = dt; eSpreadQCap(src, m); E_RR[RR_C] = rate*dt; eAddGasQ(m); }
  for(let b=0;b<PT.n.boiler;b++){
    let byValve = 0;
    for(let k=PT.boilerValve0[b];k<PT.boilerValve0[b+1];k++) byValve += s.reliefSteam[PT.boilerValveIx[k]];
    const hole = Math.max(0, s.sgVentBy[b] - byValve);
    if(!(hole > 0)) continue;
    const nc = ePartCells(PT.boilerPart[b], cells); if(!nc) continue;
    E_RR[RR_B] = hole; const m = ePlume(cells, nc);
    E_RR[RR_C] = hole*sh; E_RR[RR_T] = s.sgTBy[b] > 0 ? s.sgTBy[b] : st;
    E_RR[RR_QDT] = dt; eSpreadQCap(src, m); E_RR[RR_C] = hole*dt; eAddGasQ(m); }
  for(let g=0;g<PT.n.sg;g++){
    const m = s.sgH2By[g], b = PT.sgBoiler[g], rate = b >= 0 ? s.sgVentBy[b] : 0;
    if(!(m > 0) || !(rate > 0)) continue;
    const nd = PT.sgShellNode[g], mk = nd >= 0 ? s.mBy[nd] : 0;
    let ms = 0;
    if(isFinite(mk) && nd >= 0){ eNodeTA(nd); xOfHA(eNodeSat(nd), E_NT); ms = mk*eClamp(E_NT[MX_X], 0, 1); }
    const f = Math.min(1, rate*dt/Math.max(ms, 1e-6));
    s.sgH2By[g] = m - m*f;
    const nc = ePartCells(PT.sgPart[g], cells); if(!nc) continue;
    E_RR[RR_B] = rate; const np = ePlume(cells, nc); E_RR[RR_C] = m*f; eAddH2Q(np); }
  /* what an opening passes, in the state it passes it: the flashed share is gas, the rest is sumpStep's */
  for(let o=0;o<PT.nOpen;o++){
    const kg = eOpenKg(o); if(!(kg > 0)) continue;
    const nd = eOpenFl(o); if(nd < 0) continue;
    const ks = PT.nodeSat[nd]; if(PT.satBurn[ks]) continue;
    const nc = eOpenCells(o, cells); if(!nc) continue;
    const c = PT.sats[ks];
    eFlashXA(c, nd, cells[0]);
    const kgps = kg/dt*E_RR[RR_X], Tsat = E_RP[1];
    E_RR[RR_B] = kgps; E_RR[RR_D] = s.hBy[nd];
    const m = ePlume(cells, nc);
    E_RR[RR_T] = Tsat; E_RR[RR_QDT] = dt; eJetLiqQ(src, m, c); E_RR[RR_C] = kgps*dt; eAddGasQ(m); }
  if(ST.sc[SC_INJKIND]) eInjectRoom(dt, src);
  eCorStep(dt, src);
  eFireStep(dt, src);
  if(!sc[SC_BLACKOUT]) for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 1 || s.dmgBy[a]) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1]; if(k1 === k0) continue;
    const ua = ROOM_VENT_KGS/(k1 - k0);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k];
      eRoomGasA(i); src[i] -= ua*E_GMX[GX_CP]*phi[i]*(Tr[i] - T_HULL); } }

  /* the gas the stencil works on: its own capacity and the enthalpy a face carries away with the mass */
  const gx = SX.rGx, gUp = SX.rGUp, gDn = SX.rGDn, M = s.roomM;
  const Cv = SX.rCv, H1 = SX.rH1, U0 = SX.rU;
  for(let i=0;i<N;i++){ eRoomGasA(i);
    Cv[i] = E_RR[RR_CVC]; U0[i] = E_RR[RR_UC];
    H1[i] = M[i] > 0 ? (E_RR[RR_UC] + Tr[i]*E_RR[RR_MR])/M[i] : 0;
    d[i] = src[i]; }
  /* an eddy face exchanges ROOM_MIX*min(m_i,m_j)/MPC^2 kg/s each way and what that carries is h, not c_p*dT */
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW + X, j = i + 1, q = gx[i]*Math.min(M[i], M[j])*(H1[i] - H1[j]);
    d[i] -= q; d[j] += q; }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW + X, j = i + GW, dT = Tr[j] - Tr[i];
    const q = (dT > 0 ? gUp[i] : gDn[i])*Math.min(M[i], M[j])*(H1[j] - H1[i]);
    d[i] += q; d[j] -= q; }
  /* Every live opening's own buoyant exchange flow, Q = K dT^1.5, spread over the cells it joins. Capped
     at the rate that brings the two sides level in one tick: an opening may not drive one side past the other. */
  { const opX = SX.rOpX, opY = SX.rOpY, opN = SX.rOpN, no = SX.rGen[E_GEN_OPEN];
    for(let o=0;o<no;o++){
      const X = opX[o], Y0 = opY[o], n = opN[o], i0 = Y0*GW + X;
      let Ta = 0, Tb = 0, Ca = 0, Cb = 0, ma = 0, mb = 0;
      for(let k=0;k<n;k++){ const i = i0 + k*GW;
        Ta += Tr[i-1]; Tb += Tr[i+1]; Ca += Cv[i-1]; Cb += Cv[i+1]; ma += M[i-1]; mb += M[i+1]; }
      Ta /= n; Tb /= n;
      const hot = Ta > Tb, Th = hot ? Ta : Tb, Tc = hot ? Tb : Ta, dT = Th - Tc;
      if(!(dT > 0) || !(Ca > E_CV_MIN) || !(Cb > E_CV_MIN)) continue;
      /* the COLD side's own density and c_p: that is the air the correlation draws in */
      const ic = hot ? i0 + 1 : i0 - 1, mc = hot ? mb : ma;
      const rho = mc/(n*ROOM_VCELL);
      eRoomGasA(ic);
      const cp = M[ic] > 0 ? E_RR[RR_CPC]/M[ic] : 1;
      const H = n*MPC;
      let q = rho*cp*E_VENT_K*H*Math.sqrt(H)/Math.sqrt(Tc)*dT*Math.sqrt(dT);
      const qMax = dT/(1/Ca + 1/Cb)/dt;
      if(q > qMax) q = qMax;
      const w = q/n;
      for(let k=0;k<n;k++){ const i = i0 + k*GW;
        d[hot ? i-1 : i+1] -= w; d[hot ? i+1 : i-1] += w; } } }
  /* The structure the cell stands in, both ways, and it is the HULL PLATE that radiates: the air reaches
     space by convecting to the plate, never past it. Taken backward about the plate's own temperature -
     exact at equilibrium, so it is a scheme and not a clamp, and at ROOM_TMAX the explicit form is not. */
  const kR = HULL_EMIS*SIGMA*ROOM_A_FACE/1000, t4 = Math.pow(T_SPACE, 4);
  { const TS = s.roomTS, W = s.roomWater, WE = s.roomWaterE, lq = E_LQ[0], r = E_RP;
    const hull = PT.rHull, fl = PT.rFloor, dk = PT.rDeck, sd = PT.rSide;
    for(let i=0;i<N;i++){
      const A = PT.rStrA[i], g = ROOM_H*A/1000, C = ROOM_PLATE_C*A;
      const q = g*phi[i]*(Tr[i] - TS[i]);
      d[i] -= q;
      let T = TS[i] + q/C*dt;
      if(W[i] > 0){
        eRoomWaterTA(i); const Tw = E_RR[RR_T], dT = Tw - TS[i];
        const full = eLqFull(lq, i), cap = E_RR[RR_CAP], f = W[i] < cap ? W[i]/cap : 1;
        // water hotter than the plate is stable over the floor and unstable under the deckhead
        const hw = ((dT > 0 ? ROOM_HW : ROOM_HW_UN)*fl[i] + (full ? (dT > 0 ? ROOM_HW_UN : ROOM_HW)*dk[i] : 0))*ROOM_A_FACE + ROOM_HW_V*(ROOM_A_FB + sd[i]*ROOM_A_FACE)*f;
        r[5] = Tw; r[7] = (ROOM_P0 + Math.max(0, s.roomWP[i]))/1000; cpOfTPA(SAT_WATER, r, 5, 7, 6);
        const lim = Math.abs(dT)*Math.min(W[i]*r[6], C)/dt, qw = eClamp(hw/1000*dT, -lim, lim);
        WE[i] -= qw*dt; T += qw/C*dt; }
      if(hull[i]){ const k = kR*hull[i], t3 = T*T*T;
        T -= dt*k*(t3*T - t4)/(C + 4*dt*k*t3); }
      TS[i] = eClamp(T, T_SPACE, ROOM_TMAX); } }
  /* the energy is what the pass moved; the temperature is the read off it, or a rising c_v loses the difference */
  for(let i=0;i<N;i++)
    if(Cv[i] > E_CV_MIN){ E_RR[RR_UC] = U0[i] + d[i]*dt; eRoomTofUA(i); }
  eH2Step(dt);
  eFpRoomStep(dt);
  eCondense();
  let mx = 0, at = -1;
  for(let i=0;i<N;i++) if(Tr[i] > mx){ mx = Tr[i]; at = i; }
  sc[SC_ROOMMAX] = mx; sc[SC_ROOMMAXAT] = at;
}

/* water let go anywhere lands on the opening's own cells and comes back onto the held side of the book */
function eSumpStep(dt){
  eLqBind(); eRoomLive();
  const s = ST, cells = SX.rCells, pour = SX.rCells2, q = E_LQ[0];
  for(let o=0;o<PT.nOpen;o++){
    const kg0 = eOpenKg(o); if(!(kg0 > 0)) continue;
    const nd = eOpenFl(o); if(nd < 0) continue;
    const ks = PT.nodeSat[nd]; if(PT.satBurn[ks]) continue;
    const nc = eOpenCells(o, cells); if(!nc) continue;
    eFlashXA(PT.sats[ks], nd, cells[0]);
    const kg = kg0*(1 - E_RR[RR_X]);
    if(!(kg > 0)) continue;
    const np = eOpenPour(o, cells, nc), i0 = pour[0];
    E_RP[0] = (ROOM_P0 + Math.max(0, s.roomP[i0]))/1000; satHA(SAT_WATER, E_RP, 0, 1);
    const hl = E_RP[1];
    const pN = s.pBy[nd]*1e6, pR = (ROOM_P0 + s.roomP[i0])*1000, v0 = Math.sqrt(2*Math.max(0, pN - pR)/WATER_RHO);
    E_RR[RR_LKG] = kg/np; E_RR[RR_LKJ] = kg/np*hl; E_RR[RR_LV0] = v0;
    E_RR[RR_LDSP] = 1; for(let k=0;k<np;k++) eLiqLand(q, pour[k]);
    eBook(E_BK_SUMP, -kg);
  }
  const nP = PT.n.part;
  for(let a=0;a<nP;a++){
    if(!PT.partDrown[a] || s.dmgBy[a]) continue;
    ePartFloodLineA(a); const line = E_RR[RR_FILL];
    if(!(line === line)) continue;
    const y = PT.partBox[a*4+1], h = PT.partBox[a*4+3];
    if(!(line <= y + h*(1 - FLOOD_DROWN))) continue;
    eDamage(a, E_WHY_FLOODED);
    eEvent(EV_FLOODED, a, (y + h - line)*MPC);
  }
}
/* the water surface in and beside a machine in rows from the top into E_RR[RR_FILL], NaN when it does not reach the box */
function ePartFloodLineA(a){
  const q = E_LQ[0], W = ST.roomWater, x = PT.partBox[a*4], y = PT.partBox[a*4+1], w = PT.partBox[a*4+2], h = PT.partBox[a*4+3];
  let surf = -E_INF;
  for(let X=Math.max(0,x-1);X<=Math.min(GW-1,x+w);X++)
    for(let Y=Math.max(0,y);Y<Math.min(GH,y+h);Y++){ const i = Y*GW + X;
      if(!(W[i] > 0) || eLqShut(i) || !eLqStands(q, i)) continue;
      eLqSurfA(q, i); const v = E_RR[RR_SURF];
      if(v > surf) surf = v; }
  E_RR[RR_FILL] = E_NAN;
  if(!(surf > -E_INF)) return;
  const line = GH - surf/MPC;
  if(y + h > line) E_RR[RR_FILL] = line;
}
const ePartFloodLine = a => { ePartFloodLineA(a); return E_RR[RR_FILL]; };

/* over in E_RR[RR_A], dt in E_RR[RR_W] */
function eHurt(bag, a, tau){
  const over = E_RR[RR_A], dt = E_RR[RR_W];
  if(!(over > 0)) return false;
  const h = bag[a] + Math.min(over, 1)*dt/tau;
  bag[a] = h;
  if(h < 1) return false;
  bag[a] = 0;
  return true;
}
function eDamage(a, why){
  ST.dmgBy[a] = 1; ST.dmgWhy[a] = why; ST.sc[SC_DMGGEN]++;
  eDmgHit(a);
}
/* what a hit does to the plant; eDmgFix is the same row reversed */
function eDmgHit(a){
  const s = ST, sc = s.sc, c = PT.partCoreIx[a];
  switch(PT.partDmgFx[a]){
    case 1: if(c < 0) return;
      s.csBreach[c] = 1; if(!s.csTrip[c]) s.csTrip[c] = E_TRIP_VESSEL;
      s.csFatigue[c] = Math.min(100, s.csFatigue[c] + 12); return;
    case 2: { if(c < 0) return;
      s.csRodJam[c] = 1; s.csRodDem[c] = s.csRodPos[c]; s.csTiltDem[c] = s.csTilt[c];
      const nb = PT.coreNB[c], o = c*PT.nbMax;
      for(let b=0;b<nb;b++) s.csRodZDem[o+b] = s.csRodZ[o+b];
      return; }
    case 3: sc[SC_LOAD] = 0.05; sc[SC_LOADDEM] = 0.05; return;
    case 4: sc[SC_BKPLOST] = 1; return;
    case 5: { if(!PT.partTankHold[a]) return; const v = PT.rPrimaryRelief; if(v < 0) return;
      s.reliefOpen[v] = 1; s.reliefStuck[v] = 1; s.reliefAuto[v] = 1; return; }
    case 6: sc[SC_SGTR] = 1; return;
  }
}
function eDmgFix(a){
  const s = ST, sc = s.sc, c = PT.partCoreIx[a];
  switch(PT.partDmgFx[a]){
    case 2: if(c >= 0) s.csRodJam[c] = 0; return;
    case 4: sc[SC_BKPLOST] = 0; return;
    case 5: { if(!PT.partTankHold[a]) return; const v = PT.rPrimaryRelief; if(v < 0) return;
      s.reliefStuck[v] = 0; s.reliefOpen[v] = 0; s.reliefAuto[v] = 0; return; }
    case 6: sc[SC_SGTR] = 0; return;
  }
}

/* judged on what a source put ON TOP of the compartment's static pressure, instantaneous; a sustained squeeze ramps */
function eBlastStep(dt){
  E_RR[RR_W] = dt;
  const s = ST, sc = s.sc, nP = PT.n.part, Pr = s.roomP, box = PT.partBox;
  if(!sc[SC_BURNBLAST] && sc[SC_ROOMPMAX] >= PK[PK_MINPBURST]){
    sc[SC_BURNBLAST] = 1; eEvent(EV_EXPLOSION, sc[SC_ROOMPMAX], PK[PK_MINPBURST]); }
  for(let a=0;a<nP;a++){
    const lim = PT.partBlast[a];
    if(!lim) continue;
    if(s.dmgBy[a]){ s.roomCrush[a] = 0; continue; }
    let pk = 0, bang = 0;
    if(PT.partKind[a] === 0){
      const x = box[a*4], y = box[a*4+1], w = box[a*4+2], h = box[a*4+3];
      for(let X=Math.max(0,x);X<Math.min(GW,x+w);X++) for(let Y=Math.max(0,y);Y<Math.min(GH,y+h);Y++){
        const i = Y*GW + X;
        if(Pr[i] > pk) pk = Pr[i];
        eBangA(i); const b = E_RR[RR_EXC]; if(b > bang) bang = b; } }
    else { const i = PT.partCell[a]; if(i < 0) continue;
      pk = Pr[i]; eBangA(i); bang = E_RR[RR_EXC]; }
    const blast = bang >= lim, clim = lim*E_CRUSH_K;
    if(blast) s.roomCrush[a] = 0;
    else { E_RR[RR_A] = (pk - clim)/(clim*E_CRUSH_SPAN); if(!eHurt(s.roomCrush, a, E_CRUSH_TAU)) continue; }
    eDamage(a, blast ? E_WHY_BLAST : E_WHY_CRUSHED);
    if(blast) s.burnEvBy[a] = 1;
    eEvent(blast ? EV_BLAST_DMG : EV_CRUSH_DMG, a, blast ? bang : pk);
  }
}
/* the plant pushing out, on the circuit's own pressure, never the piezometric field */
function eOverpressureStep(){
  const s = ST, sc = s.sc, nP = PT.n.part;
  let cP = E_NAN;
  for(let a=0;a<nP;a++){
    const lim = PT.partPdes[a], mode = PT.partPdesMode[a];
    if(!lim || !mode || s.dmgBy[a]) continue;
    let pk = 0;
    if(mode & 1) pk = Math.max(pk, sc[SC_P]);
    if(mode & 2){ if(!(cP === cP)){ eCondPA(); cP = E_CP[1]; } pk = Math.max(pk, cP); }
    if(pk < lim) continue;
    eDamage(a, E_WHY_OVERPRESSURE);
    eEvent(EV_SHELL_FAIL, a, pk);
  }
}
function eBurnFireStep(){
  const sc = ST.sc;
  if(!sc[SC_ROOMBURNON] && sc[SC_BURNKG] > 0){
    if(sc[SC_BURNKG] > H2_BURN_EV) eEvent(EV_DEFLAGRATION, sc[SC_BURNKG], sc[SC_BURNP]);
    sc[SC_BURNKG] = 0; sc[SC_BURNP] = 0; sc[SC_BURNBLAST] = 0; }
  if(!sc[SC_ROOMFIREON] && sc[SC_FIREKG] > 0){
    if(sc[SC_FIREKG] > FIRE_EV_KG){
      eEvent(EV_NA_FIRE, sc[SC_FIREKG], sc[SC_FIREQ]);
      if(sc[SC_FIREP] >= 1) eEvent(EV_NA_FIRE_PEAK, sc[SC_FIREP], 0); }
    sc[SC_FIREKG] = 0; sc[SC_FIREP] = 0; sc[SC_FIREQ] = 0; }
}
/* standing in a hot room ramps over seconds; a machine on its own skin, a pipe cell or nozzle on the air */
function eCookStep(dt){
  E_RR[RR_W] = dt;
  const s = ST, nP = PT.n.part;
  for(let a=0;a<nP;a++){
    const lim = PT.partCook[a];
    if(!lim) continue;
    if(s.dmgBy[a]){ s.roomHurt[a] = 0; continue; }
    let v;
    if(PT.partKind[a] === 0){ ePartSkinA(a); v = E_RR[RR_SK]; }
    else { const i = PT.partCell[a]; if(i < 0) continue; v = s.roomT[i]; }
    E_RR[RR_A] = (v - lim)/E_ROOM_DMG_SPAN; if(!eHurt(s.roomHurt, a, E_ROOM_DMG_TAU)) continue;
    eDamage(a, E_WHY_COOKED);
    eEvent(PT.partKind[a] === 0 ? EV_COOKED : EV_COOKED_CELL, a, v);
  }
}

function eRoomOverAny(){
  const nP = PT.n.part;
  for(let a=0;a<nP;a++) if(PT.partKind[a] === 0 && PT.partCook[a] > 0){ ePartSkinA(a); if(E_RR[RR_SK] > PT.partCook[a]) return 1; }
  return 0;
}
function eRoomH2PeakA(){
  const N = GW*GH; let v = 0;
  for(let i=0;i<N;i++){ eRoomH2FracA(i); const f = E_RR[RR_H2F]; if(f > v) v = f; }
  E_RR[RR_H2PK] = v;
}
function eReliefAny(stuck){
  const s = ST, n = PT.n.relief;
  for(let v=0;v<n;v++){
    if(!s.reliefOpen[v] || s.reliefBlocked[v]) continue;
    if(!stuck || (s.reliefAuto[v] && s.reliefStuck[v])) return 1; }
  return 0;
}
function eLatchCond(k){
  const sc = ST.sc;
  switch(k){
    case 0: return sc[SC_N] > 1.10;
    case 1: for(let c=0;c<PT.n.core;c++) if(ST.csDnbr[c] < PT.coreDnbLim[c]) return true; return false;
    case 2: return sc[SC_DNBR] < 1.00;
    case 3: return sc[SC_SCRAMMED] > 0;
    case 4: return sc[SC_SCRAMMED] > 0 && sc[SC_RODPOS] > .98 && sc[SC_RHO] > -200;
    case 5: return sc[SC_CAV] > 0.15;
    case 6: return eNetDryAny() > 0;
    case 7: eFlowDemPriA(); return E_FD[0] < PK[PK_FLOWMIN];
    case 8: return sc[SC_P] > PK[PK_P0]*1.05;
    case 9: return eReliefAny(false) > 0;
    case 10: return eReliefAny(true) > 0;
    case 11: return sc[SC_VF] > 0.15;
    case 12: return sc[SC_DOSERATE] > RAD_HI;
    case 13: return eRoomOverAny() > 0;
    case 14: eRoomH2PeakA(); return E_RR[RR_H2PK] >= H2_LFL;
    case 15: return -ST.parts[RP_XE] > 3200;
    case 16: return sc[SC_RODJAM] > 0;
    case 17: return eRpsState() === 1;
    case 18: return eRunbackWired() > 0 && !eRunbackLive();
    case 19: return eRpsState() === 2;
    case 20: return eInjAny() > 0;
    case 21: return sc[SC_DMG] > 1;
    case 22: return sc[SC_DMG] > 25;
    case 23: return sc[SC_CREWDOSE] > 50;
    case 24: return sc[SC_FATIGUE] > 50;
    case 25: return sc[SC_BREACH] > 0;
    case 26: return sc[SC_QOX] > sc[SC_PROMPT];
    case 27: eH2TotalA(); return E_H2T[0] > E_H2_EV;
    case 28: return sc[SC_MELT] > 0;
  }
  return false;
}
/* one event per edge; the sticky rows latch for the run */
function eEvLatchStep(){
  const L = ST.evLatch;
  for(let k=0;k<E_LATCH_N;k++){
    if(eLatchCond(k)){ if(!L[k]){ L[k] = 1; eEvent(E_LATCH_EV[k], k, 0); } }
    else if(!E_LATCH_STICKY[k]) L[k] = 0; }
  if(ST.sc[SC_TICK] % E_ANN_TICKS === 0) eAnnStep();
}

function eAnnCore(row, c){
  const s = ST;
  switch(row){
    case 0: return s.csN[c] > 1.12;
    case 1: return s.csDnbr[c] < PT.coreDnbLim[c];
    case 2: return s.csDmg[c] > 0.1;
    case 6: if(!P.vessel) return false; eTProgA(c); return Math.abs(s.TavgBy[PT.coreCirc[c]] - E_CT[2]) > 4;
    case 7: return -s.csParts[c*RP_N + RP_XE] > 3200;
    case 8: return s.csScrammed[c] === 1 && s.csRho[c] > -200;
    case 9: return s.csRodJam[c] === 1;
    case 11: return s.csVf[c] > PT.coreVf0[c] + 0.15;
    case 12: return s.csScrammed[c] === 1;
    case 17: return s.csBreach[c] === 1;
    case 19: return s.csMelt[c] === 1;
    case 27: return s.csRodBand[c] === 1;
    case 28: return eTripNear() > 0;
    case 30: return s.csQOx[c] > 0 && s.csQOx[c] > s.csN[c]*PT.corePrompt[c];
    case 31: return s.csMeltFrac[c] > 0;
  }
  return false;
}
function eAnnEval(row){
  const s = ST, sc = s.sc;
  if(PT.annCore[row]){ const n = PT.n.core;
    for(let c=0;c<n;c++) if(eAnnCore(row, c)) return 1;
    return 0; }
  switch(row){
    case 3: return sc[SC_P] < PK[PK_P0]*.935 ? 1 : 0;
    case 4: return sc[SC_LVL] > 78 ? 1 : 0;
    case 5: return PT.n.core && !PT.coreSteam[0] && sc[SC_SC] < 8 ? 1 : 0;
    case 10: return eReliefAny(false);
    case 13: return sc[SC_P] > PK[PK_P0]*1.05 ? 1 : 0;
    case 14: return sc[SC_CAV] > 0.15 ? 1 : 0;
    case 15: return sc[SC_FLOWNET] < PK[PK_FLOWMIN] ? 1 : 0;
    case 16: return eRpsState() === 2 ? 1 : 0;
    case 18: return sc[SC_BLACKOUT] ? 1 : 0;
    case 20: { const lift = PK[PK_SGLIFTP0];
      for(let g=0;g<PT.n.sg;g++){ eSecPA(g); if(E_SP[0] > lift) return 1; }
      return 0; }
    case 21: for(let g=0;g<PT.n.sg;g++) if(s.sgBurst[g]) return 1; return 0;
    case 22: for(let b=0;b<PT.n.boiler;b++){ eBoilerLvlA(b); if(E_BL[0] < E_SG_LOW) return 1; } return 0;
    case 23: for(let b=0;b<PT.n.boiler;b++){ eBoilerLvlA(b); if(E_BL[0] < E_SG_DRY_LO) return 1; } return 0;
    case 24: eCondFracA(); return E_CF[0] < 1 ? 1 : 0;
    case 25: return sc[SC_TURBTRIP] ? 1 : 0;
    case 26: return sc[SC_CONDLOST] ? 1 : 0;
    case 29: return sc[SC_DOSERATE] > RAD_HI ? 1 : 0;
    case 32: return eRoomOverAny();
    case 33: return sc[SC_ROOMBURNON] > 0 ? 1 : 0;
    case 34: eRoomH2PeakA(); return E_RR[RR_H2PK] >= H2_LFL ? 1 : 0;
    case 35: for(let r=0;r<PT.n.rad;r++){ const a = PT.radPart[r];
        if(PT.radLive[r] && !(a >= 0 && s.dmgBy[a])) return 0; }
      return 1;
    case 36: { let t = -E_INF;
      for(let r=0;r<PT.n.rad;r++) if(s.radTBy[r] > t) t = s.radTBy[r];
      if(!isFinite(t)) t = RAD_TDES;
      return t > PK[PK_RPANELHIT] ? 1 : 0; }
    case 37: return sc[SC_ROOMFIREON] > 0 ? 1 : 0;
    case 38: return eRpsState() === 1 ? 1 : 0;
    case 39: return eRunbackWired() > 0 && !eRunbackLive() ? 1 : 0;
  }
  return 0;
}
function eAnnStep(){
  const on = ST.annOn, n = PT.n.ann;
  for(let r=0;r<n;r++){ const v = eAnnEval(r); if(on[r] !== v){ on[r] = v; ST.sc[SC_ANNREV]++; } }
}

const eRadWorkK = r => 1/(1 + Math.max(0, r - E_RAD_SLOW)/E_RAD_SLOW);
/* the coldest free cell beside the job: a party approaches from behind whatever shielding is there */
function eRepairRadRate(){
  const a = ST.sc[SC_REPA];
  if(a < 0) return 0;
  const k0 = PT.partStand0[a], k1 = PT.partStand0[a+1];
  if(k1 === k0) return RAD_CEIL;
  let v = E_INF;
  for(let k=k0;k<k1;k++){ eRadCellA(PT.partStandIx[k]); const f = E_RDC[0]; if(f < v) v = f; }
  return eClamp(v, RAD_FLOOR, RAD_CEIL);
}
function eRepairStep(dt){
  const s = ST, sc = s.sc, a = sc[SC_REPA];
  if(a < 0) return;
  sc[SC_REPT] += dt*eRadWorkK(sc[SC_REPRATE]);
  sc[SC_DOSE] = Math.min(100, sc[SC_DOSE] + sc[SC_REPRATE]*E_RAD_DOSE_K*dt);
  if(sc[SC_DOSE] >= 100 && !sc[SC_PARTYSPENT]){
    sc[SC_PARTYSPENT] = 1; sc[SC_REPA] = -1;
    eEvent(EV_PARTY_OUT, a, 0); }
  else if(sc[SC_REPT] >= sc[SC_REPNEED]){
    s.dmgBy[a] = 0; s.dmgWhy[a] = 0; sc[SC_DMGGEN]++;
    eDmgFix(a);
    eEvent(EV_REPAIRED, a, sc[SC_REPNEED]);
    sc[SC_REPA] = -1; }
}

/* release past a bounded compartment's wall at part a into E_RR[RR_CR], 1 where it is not sealed */
function eContRelA(a){
  E_RR[RR_CR] = 1;
  if(a < 0) return;
  const i = PT.partCell[a];
  if(i < 0) return;
  const r = PT.cellRegion[i];
  if(r < 0 || !PT.regionBounded[r]) return;
  const k0 = PT.regWall0[r], k1 = PT.regWall0[r+1];
  if(k1 === k0) return;
  for(let k=k0;k<k1;k++){ const j = PT.regWallIx[k], m = PT.cellPaint[j];
    if(m < 0) continue;
    const b = PT.paintPart[m];
    if(b >= 0 && ST.dmgBy[b] && PT.paintTight[m] && PT.cellAdjReg[j] >= 2) return; }
  E_RR[RR_CR] = PT.regionRel[r];
}
const eContRel = a => { eContRelA(a); return E_RR[RR_CR]; };

/* commissioning: skins at their contents, run walls at their water, the region means off the seeded field */
function eRoomSeed(){
  eLqBind();
  E_LAND_FLIP = 0;
  SX.rGen[E_GEN_LIVE] = 0;
  eRoomLive();
  const s = ST, nP = PT.n.part;
  for(let a=0;a<nP;a++){
    s.skinQ[a] = 0;
    if(PT.partKind[a] !== 0 || PT.partCell0[a+1] === PT.partCell0[a]){ s.partT[a] = -1; continue; }
    const t = ePartTemp(a);
    s.partT[a] = isFinite(t) ? t : T_HULL; }
  for(let g=0;g<PT.nRseg;g++){ const nd = PT.rsegNode[g], t = nd >= 0 ? eNodeT(nd) : E_NAN;
    s.runT[g] = isFinite(t) ? t : T_HULL; }
}

/* E_XV: cell i's corium [0] K, [1] solidus K, [2] fusion held kJ, [3] m3, [4] kg; E_XF: the floor under it [0] code (0 basemat, 1 a painted
   concrete cell, 2 a catcher, 3 anything else that holds it, 4 open), [1] the paint or part index; E_XA: what eCorAddA() lands, kg fuel,
   can, Zr, slag, kJ, fusion kJ, kW of decay heat per unit decay share, its core */
const E_XV = new Float64Array(5), E_XF = new Float64Array(2), E_XA = new Float64Array(8), E_XQ = new Float64Array(4), E_ZR_M = 0.091224, E_COR_DMIN = 1e-3;
function eCorTA(i){ const s = ST, F = s.roomCorF[i], K = s.roomCorK[i], X = s.roomCorS[i];
  E_MLP[0] = F; E_MLP[1] = K; E_MLP[2] = X; E_MLP[3] = s.roomCorE[i]; E_MLP[4] = s.roomCorL[i]; E_MLP[5] = PT.rConc[3]; eMeltPoolTA(s.roomCorSrc[i]);
  E_XV[0] = E_MLP[6]; E_XV[1] = E_MLP[7]; E_XV[2] = E_MLP[8]; E_XV[3] = (F + K)/CORIUM.rhoDebris + X/CORIUM.slagRho; E_XV[4] = F + K + X; }
/* a cell a melt cannot enter: a machine, or paint that has not been wrecked */
function eCorShut(j){ if(PT.rOcc[j]) return true; const m = PT.cellPaint[j]; return m >= 0 && PT.paintCell[m] === j && !ST.dmgBy[PT.paintPart[m]]; }
function eCorFloorA(i){ const b = i + GW;
  if(b >= GW*GH){ E_XF[0] = 0; return; }
  if(PT.rCatch[b] >= 0){ E_XF[0] = 2; E_XF[1] = PT.rCatch[b]; return; }
  if(!eCorShut(b)){ E_XF[0] = 4; return; }
  const m = PT.cellPaint[b];
  if(m >= 0 && PT.paintCell[m] === b && PT.paintConc[m]){ E_XF[0] = 1; E_XF[1] = m; return; }
  E_XF[0] = 3; }
/* the first cell down column i that stands on something */
function eCorLandI(i){ for(let n=0;n<GH;n++){ eCorFloorA(i); if(E_XF[0] !== 4) return i; i += GW; } return i; }
/* a share E_XQ[3] of cell i's corium into cell j */
function eCorMoveA(i, j){ const s = ST, f = E_XQ[3];
  if(!(s.roomCorF[j] + s.roomCorK[j] + s.roomCorS[j] > 0)){ s.roomCorSrc[j] = s.roomCorSrc[i]; s.roomCorCr[j] = 0; }
  let v = s.roomCorF[i]*f; s.roomCorF[i] -= v; s.roomCorF[j] += v;
  v = s.roomCorK[i]*f; s.roomCorK[i] -= v; s.roomCorK[j] += v;
  v = s.roomCorZ[i]*f; s.roomCorZ[i] -= v; s.roomCorZ[j] += v;
  v = s.roomCorS[i]*f; s.roomCorS[i] -= v; s.roomCorS[j] += v;
  v = s.roomCorE[i]*f; s.roomCorE[i] -= v; s.roomCorE[j] += v;
  v = s.roomCorL[i]*f; s.roomCorL[i] -= v; s.roomCorL[j] += v;
  v = s.roomCorDw[i]*f; s.roomCorDw[i] -= v; s.roomCorDw[j] += v; }
/* E_XA landed on cell i: into water it throws a share of its heat over saturation as a blast, onto a dry catcher it floods it */
function eCorAddA(i){ const s = ST, c = E_XA[7] | 0, F = E_XA[0], K = E_XA[1], X = E_XA[3];
  if(!(F + K + X > 0)) return;
  let E = E_XA[4];
  if(s.roomWater[i] > 0){ E_RP[0] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; satTA(SAT_WATER, E_RP, 0, 1); const Ts = E_RP[1];
    E_FU[0] = Ts; eFuelHA(c); E_CL[0] = Ts; E_CL[4] = Ts; eCladHA(c);
    const k = K > (F + K + X)/2 ? CORIUM.fciMet : CORIUM.fciOx, q = k*Math.max(0, E - F*E_FU[1] - K*E_CL[1] - X*CORIUM.slagCp*(Ts - E_T_STP));
    if(q > 0){ E -= q; s.sc[SC_CORFCIQ] += q; eRoomVgasA(i); const V = E_RR[RR_VG]; eRoomGasA(i);
      if(E_RR[RR_CVC] > E_CV_MIN) eRoomBlastCharge(i, q*E_RR[RR_MR]/(V*E_RR[RR_CVC])); } }
  if(!(s.roomCorF[i] + s.roomCorK[i] + s.roomCorS[i] > 0)){ s.roomCorSrc[i] = c; s.roomCorCr[i] = 0; }
  s.roomCorF[i] += F; s.roomCorK[i] += K; s.roomCorZ[i] += E_XA[2]; s.roomCorS[i] += X; s.roomCorE[i] += E; s.roomCorL[i] += E_XA[5]; s.roomCorDw[i] += E_XA[6];
  eCorFloorA(i);
  const a = E_XF[1] | 0;
  if(E_XF[0] === 2 && !s.partCatWet[a]){ s.partCatWet[a] = 1; const kg = PT.partCatW[a];
    E_RP[2] = T_HULL; E_RP[4] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; hOfTPA(SAT_WATER, E_RP, 2, 4, 3);
    E_RR[RR_LKG] = kg; E_RR[RR_LKJ] = kg*E_RP[3]; E_RR[RR_LV0] = 0; E_RR[RR_LDSP] = 1; eLiqLand(E_LQ[0], i); eBook(E_BK_INJECT, -kg);
    eEvent(EV_CATCH_FLOOD, a, kg); } }
/* E_XA filled from core c's pool below the core, the pool emptied */
function eCorTakePool(c){ const s = ST;
  E_XA[0] = s.csPlF[c]; E_XA[1] = s.csPlK[c]; E_XA[2] = s.csPlZ[c]; E_XA[3] = 0; E_XA[4] = s.csPlE[c]; E_XA[5] = s.csPlL[c];
  E_XA[6] = s.csPlDw[c]*PT.coreRated[c]*1000; E_XA[7] = c;
  s.csPlF[c] = 0; s.csPlK[c] = 0; s.csPlZ[c] = 0; s.csPlE[c] = 0; s.csPlL[c] = 0; s.csPlDw[c] = 0; }
/* the gas cells of the compartment core c stands in (its region), into SX.rCells; their gas volume in E_RR[RR_A] */
function eCorRoom(c){ const x = PT.coreBox[c*4], y = PT.coreBox[c*4+1], w = PT.coreBox[c*4+2], h = PT.coreBox[c*4+3], cells = SX.rCells;
  let reg = -1;
  for(let X=x-1;X<=x+w && reg < 0;X++) for(let Y=y-1;Y<=y+h && reg < 0;Y++)
    if(X >= 0 && X < GW && Y >= 0 && Y < GH && !(X >= x && X < x+w && Y >= y && Y < y+h)) reg = PT.cellRegion[Y*GW + X];
  let n = 0, V = 0;
  for(let j=0;j<GW*GH;j++){ if(PT.cellRegion[j] !== reg) continue;
    eRoomVgasA(j); if(!eGasCell(E_RR[RR_VG]) || !(ST.roomM[j] > 0)) continue;
    cells[n++] = j; V += E_RR[RR_VG]; }
  E_RR[RR_A] = V; return n; }
/* direct containment heating at head failure: over dchP0 a share of the pool, to dchMax at dchP1, gives its heat over the gas's own
   temperature to the gas of the vessel's compartment and burns its Zr in the steam there, all of it (the TCE limit, eta 1, psi 0) */
function eCorDch(c){ const s = ST, p = s.csPCore[c], f = Math.min(CORIUM.dchMax, CORIUM.dchMax*(p - CORIUM.dchP0)/(CORIUM.dchP1 - CORIUM.dchP0));
  if(!(f > 0)) return;
  const n = eCorRoom(c), V = E_RR[RR_A], cells = SX.rCells;
  if(!n || !(V > 0)) return;
  let Tg = 0, vap = 0;
  for(let k=0;k<n;k++){ const j = cells[k]; eRoomVgasA(j); Tg += s.roomT[j]*E_RR[RR_VG]; vap += s.roomVap[j]; }
  Tg /= V;
  E_FU[0] = Tg; eFuelHA(c); E_CL[0] = Tg; E_CL[4] = Tg; eCladHA(c);
  const dE = Math.max(0, f*s.csPlE[c] - f*(s.csPlF[c]*E_FU[1] + s.csPlK[c]*E_CL[1]));
  const wv = 2*H2O_MMOL/E_ZR_M, dZ = Math.min(f*s.csPlZ[c], vap/wv), q = dE + dZ*CORIUM.qZrH2o;
  s.csPlE[c] -= dE; s.csPlZ[c] -= dZ; s.csPlK[c] += dZ*CORIUM.zro2PerZrO; s.sc[SC_CORCHEMQ] += dZ*CORIUM.qZrH2o;
  for(let k=0;k<n;k++){ const j = cells[k]; eRoomVgasA(j); const w = E_RR[RR_VG]/V, fv = vap > 0 ? s.roomVap[j]/vap : 0;
    eRoomGasA(j); const U = E_RR[RR_UC], mv = dZ*wv*fv, mh = dZ*2*H2_MMOL/E_ZR_M*fv;
    s.roomVap[j] -= mv; s.roomH2[j] += mh; s.roomM[j] += mh - mv;
    E_RR[RR_UC] = U + q*w; eRoomTofUA(j); }
  eEvent(EV_DCH, c, f); }
/* kJ E_XQ[0] into the concrete under or beside cell i's melt over E_XQ[1] m2, E_XQ[2] its Fe2O3 share: it ablates Q/dhAbl, its water and CO2 bubble through the melt, where the Zr
   takes the oxygen of the water (H2), then of the CO2 (CO), or in a catcher only its Fe2O3's; the gas leaves at the melt's temperature.
   The ablated depth, m over the floor area A, into E_RR[RR_D] */
function eCorAblateA(i){ const s = ST, r = PT.rConc, T = E_XV[0], Q = E_XQ[0], A = E_XQ[1], fe = E_XQ[2], mc = Q/r[4];
  E_RR[RR_D] = mc/(r[2]*A);
  if(!(mc > 0)) return;
  let Z = s.roomCorZ[i], slag = mc*(1 - r[0] - r[1]), chem = 0, ox = 0;
  if(fe > 0){ const dz = Math.min(Z, fe*mc/(2*0.159687/(3*E_ZR_M))); Z -= dz; ox += dz*CORIUM.zro2PerZrO; chem += dz*CORIUM.qZrFe; slag -= dz*CORIUM.zro2PerZrO; }
  const nw = mc*r[0]/H2O_MMOL, nc = mc*r[1]/CO2_MMOL, nz = fe > 0 ? 0 : Z/E_ZR_M, z1 = Math.min(nz, nw/2), z2 = Math.min(nz - z1, nc/2);
  Z -= (z1 + z2)*E_ZR_M; ox += (z1 + z2)*E_ZR_M*CORIUM.zro2PerZrO; chem += (z1*CORIUM.qZrH2o + z2*CORIUM.qZrCo2)*E_ZR_M;
  const mv = (nw - 2*z1)*H2O_MMOL, mh = 2*z1*H2_MMOL, md = (nc - 2*z2)*CO2_MMOL, mo = 2*z2*CO_MMOL;
  let hg = 0;
  eSpHA(ROOM_SP_VAP, T); hg += mv*E_GS[1];
  eSpHA(ROOM_SP_H2, T); hg += mh*E_GS[1];
  eSpHA(ROOM_SP_CO2, T); hg += md*E_GS[1];
  eSpHA(ROOM_SP_CO, T); hg += mo*E_GS[1];
  eRoomGasA(i); const U = E_RR[RR_UC];
  s.roomVap[i] += mv; s.roomH2[i] += mh; s.roomCO2[i] += md; s.roomCO[i] += mo; s.roomM[i] += mv + mh + md + mo;
  E_RR[RR_UC] = U + hg; eRoomTofUA(i);
  const hs = slag*CORIUM.slagCp*(r[3] - E_T_STP);
  s.roomCorZ[i] = Z; s.roomCorK[i] += ox; s.roomCorS[i] += slag; s.roomCorE[i] += hs + chem - Q;
  s.sc[SC_CORABLQ] += Q - hs - hg; s.sc[SC_CORCHEMQ] += chem; s.sc[SC_CORQOUT] += Q - hs; }
/* the vessels pour; each cell's melt falls, heats, ablates, is cooled from above, spreads; a basemat eaten through takes it out */
function eCorStep(dt, src){
  const s = ST, N = GW*GH, A = MPC*ROOM_DEPTH, r = PT.rConc;
  for(let c=0;c<PT.n.core;c++){
    if(!(PT.coreTube[c] || s.csHdFail[c]) || PT.corePart[c] < 0 || !(s.csPlF[c] + s.csPlK[c] > 0)) continue;
    if(!s.csExv[c]){ s.csExv[c] = 1; if(!PT.coreTube[c]) eCorDch(c); eEvent(EV_CORIUM_POUR, c, s.csPlF[c] + s.csPlK[c]); }
    const x = PT.coreBox[c*4], y = PT.coreBox[c*4+1], w = PT.coreBox[c*4+2], h = PT.coreBox[c*4+3];
    eCorTakePool(c); eCorAddA(eCorLandI(Math.min(GH - 1, y + h)*GW + x + (w >> 1))); }
  const FL = SX.corFL, FR = SX.corFR, F = s.roomCorF, K = s.roomCorK, X = s.roomCorS;
  for(let i=0;i<N;i++){ FL[i] = 0; FR[i] = 0;
    if(!(F[i] + K[i] + X[i] > 0)) continue;
    eCorFloorA(i);
    if(E_XF[0] === 4){ E_XQ[3] = 1; eCorMoveA(i, i + GW); continue; }
    const code = E_XF[0], fx = E_XF[1] | 0;
    s.roomCorE[i] += s.csDecay[s.roomCorSrc[i]]*s.roomCorDw[i]*dt;
    eCorTA(i);
    const T = E_XV[0], ts = E_XV[1], hL = E_XV[3]/A, cold = code === 3 || (code === 2 && s.roomCorAbl[i] >= CORIUM.catchSac);
    const qd = CORIUM.hMcci*Math.max(0, T - (cold ? ts : r[3])), Qd = qd*A*dt/1000;
    let out = 0;
    if(code === 0 || code === 1 || (code === 2 && !cold)){ E_XQ[0] = Qd; E_XQ[1] = A; E_XQ[2] = code === 2 ? CORIUM.catchFe : 0; eCorAblateA(i); s.roomCorAbl[i] += E_RR[RR_D];
      const lim = code === 0 ? CORIUM.basemat : code === 1 ? PT.paintThk[fx] : CORIUM.catchSac;
      if(code === 0 && s.roomCorAbl[i] >= lim){ const m = F[i] + K[i] + X[i];
        s.sc[SC_COROUTKG] += m; s.sc[SC_COROUTQ] += s.roomCorE[i]; eEvent(EV_MELTTHROUGH, i, m);
        F[i] = 0; K[i] = 0; X[i] = 0; s.roomCorZ[i] = 0; s.roomCorE[i] = 0; s.roomCorL[i] = 0; s.roomCorDw[i] = 0; s.roomCorAbl[i] = 0; continue; }
      if(code === 1 && s.roomCorAbl[i] >= lim){ eDamage(PT.paintPart[fx], E_WHY_COOKED); s.roomCorAbl[i] = 0; } }
    else { out += Qd; if(code === 2 && s.roomWater[i] > 0) s.roomWaterE[i] += Qd; else src[i] += Qd/dt; s.roomCorE[i] -= Qd; }
    for(let d=-1;d<=1;d+=2){ const X0 = i%GW + d, j = i + d;
      if(X0 < 0 || X0 >= GW) continue;
      const m = PT.cellPaint[j];
      if(!(m >= 0 && PT.paintCell[m] === j && PT.paintConc[m] && !s.dmgBy[PT.paintPart[m]])) continue;
      const As = Math.min(hL, MPC)*ROOM_DEPTH;
      E_XQ[0] = r[5]*CORIUM.hMcci*Math.max(0, T - r[3])*As*dt/1000; E_XQ[1] = As; E_XQ[2] = 0; eCorAblateA(i); s.roomCorAbl[j] += E_RR[RR_D];
      if(s.roomCorAbl[j] >= PT.paintThk[m]){ eDamage(PT.paintPart[m], E_WHY_COOKED); s.roomCorAbl[j] = 0; } }
    let qu = 0;
    if(s.roomWater[i] > 0){ eRoomWaterTA(i); const Tw = E_RR[RR_T];
      E_CHF[0] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; eChfZuberA();
      const d0 = Math.max(s.roomCorCr[i], E_COR_DMIN), Tt = T < ts ? T : ts;
      qu = Math.max(0, Math.min(E_CHF[4], CORIUM.kMelt*(Tt - Tw)/d0));
      const M = E_XV[4], lat = M > 0 ? s.roomCorL[i]/M : 0;
      if(lat > 0) s.roomCorCr[i] = Math.max(E_COR_DMIN, Math.min(hL, d0 + (qu - CORIUM.hMcci*Math.max(0, T - ts))/(CORIUM.rhoDebris*lat*1000)*dt));
      const Q = qu*A*dt/1000; s.roomWaterE[i] += Q; s.roomCorE[i] -= Q; out += Q; }
    else { const Tt = T < ts ? T : ts, Tg = s.roomT[i];
      qu = Math.max(0, CORIUM.emis*SIGMA*(Tt*Tt*Tt*Tt - Tg*Tg*Tg*Tg));
      const Q = qu*A*dt/1000; src[i] += Q/dt; s.roomCorE[i] -= Q; out += Q; }
    s.sc[SC_CORQOUT] += out;
    if(T > ts){ let lim = CORIUM.layer;
      if(s.roomWater[i] > 0){ eRoomWRhoA(i); const dw = s.roomWater[i]/(E_RR[RR_WRHO]*A); if(dw > lim) lim = dw; }
      if(hL > lim){ const X1 = i%GW, l = X1 > 0 && !eCorShut(i - 1), rr = X1 < GW - 1 && !eCorShut(i + 1), n = (l ? 1 : 0) + (rr ? 1 : 0);
        if(n){ const f = Math.min(0.5, CORIUM.vSpread*dt/MPC)*(hL - lim)/hL/n; if(l) FL[i] = f; if(rr) FR[i] = f; } } } }
  for(let i=0;i<N;i++){ if(FL[i] > 0){ E_XQ[3] = FL[i]; eCorMoveA(i, i - 1); } if(FR[i] > 0){ E_XQ[3] = FR[i]/(1 - FL[i]); eCorMoveA(i, i + 1); } }
}

/* UI only: one ring row as [severity, headline, text] */
const E_TXT_EV = [];
{ const nm = a => a >= 0 && IX && IX.partId[a] ? nameOf(IX.partId[a]) : "A MACHINE";
  const f0 = v => (+v).toFixed(0), f1 = v => (+v).toFixed(1);
  const T = E_TXT_EV;
  T[EV_HIPOW] = () => ["warn", "POWER ABOVE 110%", "Running past rated output. Thermal margin is what pays for it, and DNBR is falling."];
  T[EV_DNBR13] = () => ["warn", "CRISIS MARGIN BELOW ITS LIMIT", "Coolant is approaching film boiling on the fuel pins. Raise pump flow or pressure, or cut power."];
  T[EV_DNBR10] = () => ["alarm", "DNBR BELOW 1.00 / CLADDING FAILING", "The fuel is now wrapped in insulating steam. Heat is not reaching the water and damage is accumulating this second."];
  T[EV_REACTOR_TRIP] = () => ["alarm", "REACTOR TRIP", "Rods fully inserted and the turbine tripped with them. Xenon now builds and will hold the reactor down for minutes."];
  T[EV_RECRIT] = () => ["alarm", "TRIPPED CORE GOING CRITICAL", "The bank is in and the reactor is climbing back to critical anyway. The xenon it was shut down by has decayed. Borate now."];
  T[EV_CAVITATION] = () => ["warn", "COOLANT PUMP CAVITATION", "Water arriving at the pumps is close to boiling, so they are churning vapour. Real flow is far below the bench setting."];
  T[EV_LINE_DRY] = () => ["alarm", "LINE RUN DRY", "A line is empty. There is nothing in it to pump and nothing will leave it until something fills it again - check what is shut upstream."];
  T[EV_FLOW_FLOOR] = () => ["warn", "PUMPS ORDERED BELOW DESIGN FLOOR", "Flow demand is under the "+f0(PK[PK_FLOWMIN]*100)+"% floor the pumps were built for. The protection system trips on LOW FLOW here."];
  T[EV_PRI_OVERP] = () => ["warn", "PRIMARY OVERPRESSURE", "Loop pressure above 105% of nominal. The relief valve lifts at 106%."];
  T[EV_RELIEF_PASSING] = () => ["warn", "RELIEF VALVE PASSING", "A relief valve is open and venting. If nobody commanded it, primary coolant is leaving the loop."];
  T[EV_PORV_STUCK] = () => ["alarm", "PORV FAILED TO RESEAT", "A relief valve lifted on overpressure and did not shut again. Pressurizer level will read HIGH while the loop empties. Close its block valve."];
  T[EV_CORE_VOID] = () => ["alarm", "STEAM VOID IN CORE", "Steam is forming where liquid should be. It carries almost no heat, so fuel temperature climbs even while reactor power falls."];
  T[EV_HIRAD] = () => ["warn", "HIGH RADIATION IN THE SPACE", "The crew's own seat is reading above background. A party out on the plant is taking dose at the job it is standing next to."];
  T[EV_ROOM_HOT] = () => ["alarm", "EQUIPMENT OVER TEMPERATURE", "A machine is standing in air hotter than it was built for. Nothing in there survives it indefinitely - find what is putting heat into the room."];
  T[EV_H2_ROOM] = () => ["alarm", "HYDROGEN IN THE COMPARTMENT", "Hydrogen off the cladding has left the primary and is above its flammability limit somewhere in the room. It needs no spark, only something hot enough."];
  T[EV_XENON_PIT] = () => ["info", "XENON PIT", "Xenon-135 past 3200 pcm. Raising power may be physically impossible until it decays, whatever you do with the rods."];
  T[EV_ROD_JAM] = () => ["alarm", "CONTROL RODS NOT RESPONDING", "The bank is ignoring demand, a scram included. You are left with boron, flow and load."];
  T[EV_RPS_OFF] = () => ["warn", "PROTECTION SYSTEM SWITCHED OFF", "Automatic trips are defeated. Nothing will shut this reactor down for you."];
  T[EV_RUNBACK_OFF] = () => ["warn", "TURBINE RUNBACK SWITCHED OFF", "A trip no longer sheds load. The turbine will keep drawing steam from a dead core and chill the loop."];
  T[EV_NO_RPS] = () => ["warn", "NO PROTECTION SYSTEM FITTED", "This plant was commissioned without one. There are no automatic trips to defeat, and none to fall back on."];
  T[EV_INJECTING] = () => ["info", "INJECTING", "A tank is pushing water into the loop, and cold shock is ageing the vessel while it runs."];
  T[EV_FUEL_DMG1] = () => ["alarm", "FUEL DAMAGE 1%", "Cladding has started to fail and fission products are entering the coolant. Permanent."];
  T[EV_FUEL_DMG25] = () => ["alarm", "FUEL DAMAGE 25%", "A quarter of the fuel cladding has failed."];
  T[EV_WATCH_DOSE] = () => ["alarm", "WATCH DOSE PAST 50%", "The control-room watch has taken more than half its dose limit for this run. Nobody relieves them."];
  T[EV_VESSEL_FATIGUE] = () => ["warn", "VESSEL FATIGUE PAST 50%", "Thermal shock has embrittled the vessel, and its burst pressure has fallen with it."];
  T[EV_VESSEL_BREACH] = () => ["alarm", "VESSEL RUPTURE", "The pressure vessel failed. Coolant is leaving faster than anything can replace it. Unrecoverable."];
  T[EV_CLAD_OX] = () => ["alarm", "CLAD OXIDATION SELF-SUSTAINING", "Steam is burning the cladding faster than the reactor is making heat. It stops when the metal is gone."];
  T[EV_H2_PRIMARY] = () => ["alarm", "HYDROGEN IN THE PRIMARY", "Over "+E_H2_EV+" kg of hydrogen has come off the cladding. The moment any of it leaves the loop it is a flammable gas in the compartment."];
  T[EV_CORE_MELTED] = () => ["alarm", "CORE MELT", "A quarter of the fuel is molten. Unrecoverable."];
  T[EV_FLOODED] = (a, b) => ["alarm", "FLOODING", nm(a)+" is under water - it stands "+f1(b)+" m deep against the machine, two thirds of the way up it."];
  T[EV_EXPLOSION] = (a, b) => ["alarm", "EXPLOSION IN THE COMPARTMENT", "A charge has gone off - "+f0(a)+" kPa above ambient, against the "+f0(b)+" kPa the weakest machine on this plant is built for."];
  T[EV_BLAST_DMG] = (a, b) => ["alarm", "BLAST DAMAGE", nm(a)+" has been wrecked by a blast in the compartment - "+f0(b)+" kPa against the "+f0(PT.partBlast[a])+" kPa it was built for."];
  T[EV_CRUSH_DMG] = (a, b) => ["alarm", "OVERPRESSURE DAMAGE", nm(a)+" has been crushed by the compartment it is standing in - "+f0(b)+" kPa against the "+f0(PT.partBlast[a]*E_CRUSH_K)+" kPa it was built for."];
  T[EV_SHELL_FAIL] = (a, b) => ["alarm", "SHELL FAILURE", nm(a)+" has burst. It is holding "+f1(b)+" MPa against the "+f1(PT.partPdes[a])+" MPa its own shell is built for."];
  T[EV_COOKED] = (a, b) => ["alarm", "HEAT DAMAGE", nm(a)+" has been cooked by the compartment it is standing in - its own metal is at "+f0(b)+" K against the "+f0(PT.partCook[a])+" K it was built for."];
  T[EV_COOKED_CELL] = (a, b) => ["alarm", "HEAT DAMAGE", "The compartment has cooked "+nm(a)+" - air at "+f0(b)+" K against the "+f0(PT.partCook[a])+" K it is good for."];
  T[EV_DEFLAGRATION] = (a, b) => ["alarm", "HYDROGEN DEFLAGRATION", f1(a)+" kg of hydrogen has burned in the compartment, "+f0(a*H2_LHV/1000)+" MJ of it into the air, peaking at "+f0(b)+" kPa."];
  T[EV_NA_FIRE] = (a, b) => ["alarm", "SODIUM FIRE", f1(a)+" kg of sodium has reacted in the compartment, "+f0(b/1000)+" MJ of it."];
  T[EV_NA_FIRE_PEAK] = a => ["alarm", "SODIUM FIRE", "The sodium fire peaked at "+f0(a)+" kPa."];
  T[EV_PARTY_OUT] = () => ["alarm", "REPAIR PARTY WITHDRAWN", "The repair party has taken its full dose allowance for this run and is being pulled off the plant. There is no second party."];
  T[EV_REPAIRED] = (a, b) => ["info", "REPAIR COMPLETE", nm(a)+" is back in service. It took "+f0(b)+" seconds and cost the repair party dose."];
  const cn = c => c >= 0 && IX && IX.coreId[c] ? nameOf(IX.coreId[c]) : "THE REACTOR";
  const id = (L, i) => IX && IX[L] && IX[L][i] !== undefined ? IX[L][i] : null;
  T[EV_SCRAM] = c => ["alarm", "REACTOR TRIP / "+cn(c), "Rods fully inserted. Xenon now builds and will hold the reactor down for minutes."];
  T[EV_VESSEL_RUPTURE] = (c, p) => ["alarm", "VESSEL RUPTURE / "+cn(c), "The pressure vessel failed at "+f1(p)+" MPa. Coolant is leaving faster than anything can replace it. Unrecoverable."];
  T[EV_HEAD_FAIL] = (c, w) => ["alarm", "LOWER HEAD FAILED / "+cn(c), (w === 2 ? "A penetration in the lower head let go under the molten pool." : "The lower head crept to rupture under the molten pool.")+" The vessel is open at its bottom. Unrecoverable."];
  T[EV_CORIUM_POUR] = (c, m) => ["alarm", "CORE ON THE FLOOR / "+cn(c), f1(m/1000)+" t of molten core has left the vessel and is pouring onto the floor under it."];
  T[EV_DCH] = (c, f) => ["alarm", "DIRECT CONTAINMENT HEATING / "+cn(c), "The vessel failed under pressure and blew "+f0(f*100)+" % of its melt into the air round it, burning its zirconium in the steam there."];
  T[EV_MELTTHROUGH] = (i, m) => ["alarm", "BASEMAT MELT-THROUGH", f1(m/1000)+" t of core has eaten through the concrete under the plant and is gone into the ground."];
  T[EV_CATCH_FLOOD] = (a, kg) => ["warn", "CORE CATCHER FLOODED", nm(a)+" has taken the melt and flooded it with "+f0(kg/1000)+" t of its own water."];
  T[EV_TUBE_RUPTURE] = (c, f) => ["alarm", "FUEL CHANNEL RUPTURE / "+cn(c), f0(f*100)+" % of the channels are torn. They are discharging into the reactor cavity, which has its own relief sized for one of them."];
  T[EV_SHIELD_LIFTED] = (c, g) => ["alarm", "UPPER SHIELD LIFTED / "+cn(c), "The reactor cavity reached "+f0(g*1000)+" kPa against the "+f0(PT.coreShieldLift[c]*1000)+" its shield weighs. The shield is off, every channel is torn at its top weld and the whole core is open to the room."];
  T[EV_CORE_MELT] = c => ["alarm", "CORE MELT / "+cn(c), "A quarter of the fuel is molten. Unrecoverable."];
  T[EV_BANKS_SPLIT] = () => ["warn", "BANKS SPLIT", "The banks are now driven one at a time and the tilt trim is stood down - per-bank demand is the tilt handle from here. Each bank keeps its own AUTO or MANUAL setting, and the T-avg controller drives only the ones left on AUTO. Fewer banks on AUTO means less worth answering the same temperature error, so the loop gets slower, not just smaller."];
  T[EV_BANKS_GANGING] = () => ["info", "BANKS GANGING", "The banks are being driven back together. They are still split until they arrive, and a scram overrides this at any point."];
  T[EV_DISC_BURST] = (t, p) => ["alarm", (id("tankId", t) && D.tanks[id("tankId", t)] ? D.tanks[id("tankId", t)].name : "A TANK")+" DISC BURST", "The tank reached "+f1(p)+" MPa and its rupture disc let go. What was in it is on the containment floor and its activity is in the air, not behind a wall. This is the TMI-2 sequence."];
  T[EV_VACUUM_LOST] = () => ["alarm", "CONDENSER VACUUM LOST", "The condenser has reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. What the bypass still passes into it goes overboard, and the rest backs up onto the generators' safety valves."];
  T[EV_TURB_TRIP] = () => ["alarm", "TURBINE TRIP", "Exhaust pressure past what the machine will run against. The stop valve is shut. The reactor is still making heat and the turbine is no longer taking any of it."];
  T[EV_TURB_RESET] = () => ["info", "TURBINE RELATCHED", "Exhaust pressure is back under the trip point and the machine is whole. The stop valve is open and the turbine is taking steam again."];
  T[EV_TURB_WATER] = b => ["alarm", "TURBINE WATER INDUCTION", (id("turbId", b) ? nameOf(id("turbId", b)) : "A TURBINE") + " swallowed liquid water and has wrecked its own blading."];
  T[EV_COND_VENTING] = () => ["warn", "STEAM GOING OVERBOARD", "The turbine bypass is passing steam into a machine that is open to atmosphere, and the water going with it does not come back. The hotwell is draining and no valve on the plant is open."];
  T[EV_SG_RELIEF_LIFT] = v => ["warn", (id("reliefId", v) ? nameOf(id("reliefId", v)) : "A SAFETY VALVE")+" LIFTED", "Shell pressure reached this valve's set point and it is passing steam to atmosphere. The water going with it does not come back."];
  T[EV_SG_BURST] = (g, p) => ["alarm", (id("sgId", g) ? nameOf(id("sgId", g)) : "A GENERATOR")+" SHELL BURST", "The secondary shell has ruptured at "+f1(p)+" MPa. It was raising steam faster than anything fitted could get rid of. What is in it is going to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty."];
  T[EV_PIPE_BURST] = (u, p) => ["alarm", "PIPE RUPTURE", (id("runId", u) || "A run")+" has split at "+f1(p)+" MPa against a wall rated for "+f1(PT.runBurstP[u]/PIPE_BURST_K)+" MPa. Both cut ends are open to the compartment."];
  T[EV_WALL_BURST] = (m, dp) => ["alarm", "CONTAINMENT FAILURE", "A wall cell has let go - "+f0(dp*1000)+" kPa across it against a cell that bursts at "+f0(PT.paintBurstP[m]*1000)+" kPa. The compartment behind it is now the ship's compartment."];
  T[EV_LEDGER] = (r, m) => ["warn", "MASS BOOKS NOT CLOSING", f1(r)+" kg unattributed of "+f0(m)+" kg this tick. Something moved water without an edge carrying it."];
  }
function eEventText(k){
  return eEventTextOf(ST.evCode[k], ST.evA[k], ST.evB[k]);
}
function eEventTextOf(code, a, b){
  const fn = E_TXT_EV[code];
  return fn ? fn(a, b) : ["info", EV_NAMES[code] || "EVENT", ""];
}
