"use strict";
// imports: eOpenKg(o) eOpenH2(o) eH2Total() eBook(code,kg) E_BK_SUMP E_BK_INJECT eCondP() eSecP(g) eNodeT eNodeX eRegionUpdate eRadCellA E_TRIP_VESSEL eSgLiftP() eBoilerLvl(b) eCondFrac() eTProgA(c) eTripNear() eRpsState() eRunbackWired() eRunbackLive() eNetDryAny() eFlowDemPri() eInjAny()
// exports: eRoomSeed eSumpStep eInjectFluid eRoomStep eBlastStep eOverpressureStep eBurnFireStep eCookStep eEvLatchStep eAnnStep eAnnEval eAnnCore eRepairStep eRepairRadRate eDamage eDmgHit eDmgFix eRoomBang eRoomBlastCharge eContRel eRoomVgas eRoomVgasA eRoomH2Frac eRoomO2Frac eRoomPoolT eRoomWaterT ePartSkin ePartTemp eRoomOverAny eRoomH2PeakA eRadWorkK eLqShut eEventText E_TXT_WHY E_TXT_EV

const E_RU = 8.314462618;
const E_ROOM_DMG_SPAN = 60, E_ROOM_DMG_TAU = 25, E_CRUSH_K = 10, E_CRUSH_SPAN = 0.5, E_CRUSH_TAU = 60;
const E_ANN_TICKS = 5, E_H2_EV = 20, E_RAD_DOSE_K = 0.25, E_RAD_SLOW = 0.5;
const E_INJ_HEAT = 1, E_INJ_GAS = 2, E_INJ_FLUID = 3, E_INJ_H2 = 4, E_INJ_O2 = 5, E_INJ_STEAM = 6;
const E_WHY_WRECKED = 0, E_WHY_HIT = 1, E_WHY_FLOODED = 2, E_WHY_BLAST = 3, E_WHY_CRUSHED = 4, E_WHY_OVERPRESSURE = 5, E_WHY_COOKED = 6, E_WHY_BURST = 7;
const E_TXT_WHY = ["WRECKED", "HIT", "FLOODED", "BLAST", "CRUSHED", "OVERPRESSURE", "COOKED", "BURST"];
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
const E_GEN_PLUME = 0, E_GEN_RING = 1, E_GEN_LIVE = 2, E_GEN_RINGN = 3;

const eClamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/* the two liquids' views onto ST, rebound when ST or PT is replaced */
const E_LQ = [
  {M:null, E:null, rho:WATER_RHO, bulk:WATER_BULK, vu:null, vv:null, P:null, O:null, oRho:1000, U:null, tag:0, st:null, pt:null},
  {M:null, E:null, rho:1000, bulk:WATER_BULK, vu:null, vv:null, P:null, O:null, oRho:WATER_RHO, U:null, tag:1, st:null, pt:null}];
function eLqBind(){
  const w = E_LQ[0], m = E_LQ[1];
  if(w.st === ST && w.pt === PT && w.M === ST.roomWater) return;
  w.M = ST.roomWater; w.E = ST.roomWaterE; w.vu = ST.roomWU; w.vv = ST.roomWV; w.P = ST.roomWP; w.O = ST.roomPool;
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
  const occ = T.rOcc, tight = T.rTight, g0 = ROOM_MIX*ROOM_C/(MPC*MPC);
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
function eJetLiqQ(src, m, c){
  const kgps = E_RR[RR_B], h = E_RR[RR_D];
  if(!(kgps > 0)) return;
  const Q = SX.rPlQ, W = SX.rPlW, Tr = ST.roomT;
  for(let k=0;k<m;k++){ const i = Q[k]; E_RP[5] = Tr[i]; hOfTA(c, E_RP, 5, 6); src[i] += kgps*W[k]*(h - E_RP[6]); }
}

/* per-cell readers answer in E_RR: a double returned across a call V8 did not inline is a heap allocation */
const E_RR = new Float64Array(39);
const RR_VG = 0, RR_MX = 1, RR_H2F = 2, RR_O2F = 3, RR_PTMP = 4, RR_T = 5, RR_SK = 6, RR_W = 7, RR_CAP = 8, RR_SIDE = 9,
  RR_DRV = 10, RR_FALL = 11, RR_FILL = 12, RR_SURF = 13, RR_PT = 14, RR_X = 15, RR_A = 16, RR_B = 17, RR_C = 18, RR_D = 19,
  RR_RG = 20, RR_HM = 21, RR_WI = 22, RR_WJ = 23, RR_FV2 = 24, RR_PF = 25, RR_SWM = 26, RR_SWF = 27, RR_RHO = 28, RR_LKG = 29, RR_LKJ = 30, RR_LV0 = 31, RR_H2PK = 32, RR_GF = 33, RR_GW = 34, RR_GM = 35, RR_BANG = 36, RR_PMAX = 37, RR_CR = 38;
function eRoomVgasA(i){ E_RR[RR_VG] = Math.max(ROOM_VG_MIN*ROOM_VCELL,
  ROOM_VCELL - ST.roomWater[i]/WATER_RHO - ST.roomPool[i]/PK[PK_RFIRERHO]); }
const eRoomVgas = i => { eRoomVgasA(i); return E_RR[RR_VG]; };
const eGasCell = vg => vg > ROOM_VG_MIN*ROOM_VCELL*1.0001;
function eRoomMolXA(i){ E_RR[RR_MX] = Math.max(0, ST.roomM[i] - ST.roomH2[i] - ST.roomVap[i])/AIR_MMOL + ST.roomVap[i]/H2O_MMOL; }
/* every species at its own molar mass: hydrogen is 14x air's gas constant per kilogram */
function eRoomMolFill(mol){ const N = GW*GH; for(let i=0;i<N;i++){ eRoomMolXA(i); mol[i] = E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL; } }
function eRoomH2FracA(i){ const n = ST.roomH2[i]/H2_MMOL;
  if(n > 0){ eRoomMolXA(i); E_RR[RR_H2F] = n/(E_RR[RR_MX] + n); } else E_RR[RR_H2F] = 0; }
function eRoomO2FracA(i){ eRoomMolXA(i); E_RR[RR_O2F] = ST.roomO2[i]/O2_MMOL/Math.max(1e-9, E_RR[RR_MX] + ST.roomH2[i]/H2_MMOL); }
const eRoomH2Frac = i => { eRoomH2FracA(i); return E_RR[RR_H2F]; };
const eRoomO2Frac = i => { eRoomO2FracA(i); return E_RR[RR_O2F]; };

/* E_RR[RR_BANG] kJ into cell i at constant volume */
function eRoomBang(i){
  const kJ = E_RR[RR_BANG];
  if(!(kJ > 0) || i < 0 || i >= GW*GH) return;
  ST.roomT[i] = Math.min(ROOM_TMAX, ST.roomT[i] + kJ/ROOM_CVAIR);
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
/* the BLAST tool's charge: a Gaussian BLAST_SIG cells wide into the air on its own side of every intact wall */
function eRoomBlastCharge(i, kPa){
  if(!(kPa > 0) || i < 0 || i >= GW*GH) return;
  eRoomLive();
  const mark = eRoomReach(i), seen = SX.rPlSeen, occ = PT.rOcc, tight = PT.rTight;
  const X0 = i%GW, Y0 = (i/GW)|0, R = Math.ceil(3*BLAST_SIG), k = 1/(2*BLAST_SIG*BLAST_SIG);
  for(let Y=Math.max(0,Y0-R);Y<=Math.min(GH-1,Y0+R);Y++) for(let X=Math.max(0,X0-R);X<=Math.min(GW-1,X0+R);X++){
    const j = Y*GW + X;
    if(occ[j] || tight[j] || seen[j] !== mark) continue;
    E_RR[RR_BANG] = kPa*Math.exp(-((X-X0)*(X-X0) + (Y-Y0)*(Y-Y0))*k)*ROOM_CVAIR*T_HULL/ROOM_P0; eRoomBang(j);
  }
}

function eCgApply(x, y, dI, ax, ay){
  const N = GW*GH;
  for(let i=0;i<N;i++) y[i] = dI[i]*x[i];
  for(let i=0;i<N-1;i++){ const a = ax[i]; if(a === 0) continue;
    const q = a*(x[i] - x[i+1]); y[i] += q; y[i+1] -= q; }
  for(let i=0;i<N-GW;i++){ const a = ay[i]; if(a === 0) continue;
    const q = a*(x[i] - x[i+GW]); y[i] += q; y[i+GW] -= q; }
}
function eCgPrecond(z, r, J, ax, ay){
  const N = GW*GH;
  for(let i=0;i<N;i++){ let v = r[i]; const X = i%GW;
    if(X > 0) v += ax[i-1]*z[i-1];
    if(i >= GW) v += ay[i-GW]*z[i-GW];
    z[i] = v/J[i]; }
  for(let i=N-1;i>=0;i--){ let v = z[i]*J[i]; const X = i%GW;
    if(X < GW-1) v += ax[i]*z[i+1];
    if(i < N-GW) v += ay[i]*z[i+GW];
    z[i] = v/J[i]; }
}
function eCgSolve(b, x, dI, ax, ay, tol, max){
  const N = GW*GH, r = SX.gsR, z = SX.gsZ, d = SX.gsD, Ap = SX.gsAp, J = SX.gsJ;
  for(let i=0;i<N;i++) J[i] = dI[i];
  for(let i=0;i<N-1;i++){ J[i] += ax[i]; J[i+1] += ax[i]; }
  for(let i=0;i<N-GW;i++){ J[i] += ay[i]; J[i+GW] += ay[i]; }
  eCgApply(x, Ap, dI, ax, ay);
  let bn = 0, rz = 0;
  for(let i=0;i<N;i++){ r[i] = b[i] - Ap[i]; bn += b[i]*b[i]; }
  eCgPrecond(z, r, J, ax, ay);
  for(let i=0;i<N;i++){ d[i] = z[i]; rz += r[i]*z[i]; }
  bn = Math.sqrt(bn);
  if(!(bn > 0)){ x.fill(0); return 0; }
  let it = 0;
  for(;it<max;it++){
    let rn = 0; for(let i=0;i<N;i++) rn += r[i]*r[i];
    if(Math.sqrt(rn) <= tol*bn) break;
    eCgApply(d, Ap, dI, ax, ay);
    let dAd = 0; for(let i=0;i<N;i++) dAd += d[i]*Ap[i];
    const a = rz/dAd;
    let rz1 = 0;
    for(let i=0;i<N;i++){ x[i] += a*d[i]; r[i] -= a*Ap[i]; }
    eCgPrecond(z, r, J, ax, ay);
    for(let i=0;i<N;i++) rz1 += r[i]*z[i];
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
/* a cell's net outflow is cut to what it holds plus what it is given; with `cap`, its inflow to the room it has plus what it passes on */
function eFaceLimit(Mm, fx, fy, n, cap){
  const N = GW*GH, out = SX.gsOut, inn = SX.gsJ, k = SX.gsK.fill(1), ki = SX.gsKi.fill(1);
  for(let it=0;it<n;it++){ let moved = false;
    out.fill(0); inn.fill(0);
    for(let i=0;i<N;i++){
      if(fx[i] > 0){ out[i] += fx[i]*ki[i+1]; inn[i+1] += fx[i]*k[i]; } else if(fx[i] < 0){ out[i+1] -= fx[i]*ki[i]; inn[i] -= fx[i]*k[i+1]; }
      if(fy[i] > 0){ out[i] += fy[i]*ki[i+GW]; inn[i+GW] += fy[i]*k[i]; } else if(fy[i] < 0){ out[i+GW] -= fy[i]*ki[i]; inn[i] -= fy[i]*k[i+GW]; }
    }
    for(let i=0;i<N;i++){ const have = Mm[i] + inn[i]*ki[i], v = out[i] > have ? have/out[i] : 1; if(v !== k[i]) moved = true; k[i] = v; }
    if(cap) for(let i=0;i<N;i++){ const room = Math.max(0, cap[i] - Mm[i]) + out[i]*k[i], v = inn[i] > room ? room/inn[i] : 1; if(v !== ki[i]) moved = true; ki[i] = v; }
    if(!moved) break;
  }
  for(let i=0;i<N;i++){
    if(fx[i] > 0) fx[i] *= k[i]*ki[i+1]; else if(fx[i] < 0) fx[i] *= k[i+1]*ki[i];
    if(fy[i] > 0) fy[i] *= k[i]*ki[i+GW]; else if(fy[i] < 0) fy[i] *= k[i+GW]*ki[i];
  }
  for(let it=0;it<=FACE_TAIL;it++){
    out.fill(0);
    eFaceInflow(inn, fx, fy);
    for(let i=0;i<N-1;i++){ const m = fx[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+1] -= m; }
    for(let i=0;i<N-GW;i++){ const m = fy[i]; if(m > 0) out[i] += m; else if(m < 0) out[i+GW] -= m; }
    let cut = 0;
    for(let i=0;i<N;i++){ const have = Mm[i] + inn[i], ex = out[i] - have;
      const v = ex > have*1e-9 + 1e-9 ? (have > 0 ? have/out[i] : 0) : 1;
      k[i] = v; if(v !== 1 && ex > cut) cut = ex; }
    if(!cut || it === FACE_TAIL) break;
    for(let i=0;i<N-1;i++){ if(fx[i] > 0) fx[i] *= k[i]; else if(fx[i] < 0) fx[i] *= k[i+1]; }
    for(let i=0;i<N-GW;i++){ if(fy[i] > 0) fy[i] *= k[i]; else if(fy[i] < 0) fy[i] *= k[i+GW]; }
  }
}
function eFaceMove(Mm, fx, fy){
  const N = GW*GH, d = SX.gsF.fill(0);
  for(let i=0;i<N-1;i++) if(fx[i] !== 0){ d[i] -= fx[i]; d[i+1] += fx[i]; }
  for(let i=0;i<N-GW;i++) if(fy[i] !== 0){ d[i] -= fy[i]; d[i+GW] += fy[i]; }
  for(let i=0;i<N;i++) if(d[i] !== 0) Mm[i] = Math.max(0, Mm[i] + d[i]);
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
function eRoomAdvect(F, M0, M1, fx, fy, inn, lim){
  const N = GW*GH, y0 = SX.gsY0, y = SX.gsY;
  for(let i=0;i<N;i++){ y0[i] = M0[i] > 0 ? Math.min(lim, F[i]/M0[i]) : 0; y[i] = y0[i]; }
  for(let it=0;it<ADV_SWEEPS;it++){
    for(let i=0;i<N;i++) eAdvUpd(i, y, y0, M0, fx, fy, inn, N);
    for(let i=N-1;i>=0;i--) eAdvUpd(i, y, y0, M0, fx, fy, inn, N); }
  for(let i=0;i<N;i++) F[i] = y[i]*M1[i];
}
function eGsFxOpen(bx, vg, i){ return bx[i] !== 0 && eGasCell(vg[i]) && eGasCell(vg[i+1]); }
function eGsFyOpen(by, vg, i){ return by[i] !== 0 && eGasCell(vg[i]) && eGasCell(vg[i+GW]); }
/* face F[k]'s mixing conductance into E_RR[RR_GM] */
function eGsMixA(dt, F, k){ const g = Math.abs(F[k])*ROOM_CP; E_RR[RR_GM] = g*ROOM_C/(ROOM_C + 8*g)/dt; }

/* the compartment means and each cell's static pressure off them */
function eRoomRegMean(){
  eRegionUpdate();
  const N = GW*GH, of = PT.cellRegion, m = SX.regPMean, st = SX.rPStat;
  for(let i=0;i<N;i++){ const r = of[i]; st[i] = r < 0 ? 0 : m[r]; }
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
function eGasDisplace(i, dV){
  if(!(dV > 0)) return;
  eGasRing(i); const w = E_RR[RR_GW], n = SX.rGen[E_GEN_RINGN], I = SX.rGdI, Wt = SX.rGdW;
  if(!(w > 0)) return;
  eRoomVgasA(i); E_RR[RR_GF] = Math.min(1, dV/E_RR[RR_VG]);
  eGasShift(ST.roomM, i, n, I, Wt); eGasShift(ST.roomH2, i, n, I, Wt);
  eGasShift(ST.roomO2, i, n, I, Wt); eGasShift(ST.roomVap, i, n, I, Wt);
}
/* E_RR[RR_GF] of cell i shared over the ring by weight, E_RR[RR_GW] the weight total */
function eGasShift(F, i, n, I, Wt){
  const f = E_RR[RR_GF], w = E_RR[RR_GW];
  const g = F[i]*f;
  F[i] -= g;
  for(let k=0;k<n;k++) F[I[k]] += g*Wt[k]/w;
}

/* one tick of the gas: implicit face velocities, mass on them, species and enthalpy with it, then the pressure read */
function eGasStep(dt, src){
  const N = GW*GH, s = ST, Mm = s.roomM, Tr = s.roomT, U = s.roomPU, V = s.roomPV, bx = SX.rBx, by = SX.rBy;
  const p = SX.gsP, vg = SX.gsVg, disp = s.gsDisp, sc = s.sc, mol = SX.gsMol;
  let anyDisp = false;
  eRoomMolFill(mol);
  const fr = PK[PK_RFIRERHO], VGMIN = ROOM_VG_MIN*ROOM_VCELL, VGCELL = VGMIN*1.0001;
  for(let i=0;i<N;i++){
    const vv = Math.max(VGMIN, ROOM_VCELL - s.roomWater[i]/WATER_RHO - s.roomPool[i]/fr);
    vg[i] = vv;
    if(disp[i] !== 0) anyDisp = true;
    p[i] = mol[i]*E_RU*Tr[i]/Math.max(vv > VGCELL ? vv + disp[i] : vv, 1e-6); }
  let live = anyDisp;
  const pLo = WAVE_P_LO*1000, uLo = WAVE_U_LO*ROOM_RHO;
  for(let i=0;i<N && !live;i++)
    if(Math.abs(U[i]) > uLo || Math.abs(V[i]) > uLo
       || (eGsFxOpen(bx, vg, i) && Math.abs(p[i] - p[i+1]) > pLo)
       || (eGsFyOpen(by, vg, i) && Math.abs(p[i] - p[i+GW]) > pLo)) live = true;
  const x = s.gsX;
  if(!live){ U.fill(0); V.fill(0); sc[SC_ROOMCGIT] = 0; x.fill(0); disp.fill(0); }
  else {
    const kp = SX.gsDI, gx = SX.gsAx, gy = SX.gsAy, b = SX.gsB, A = MPC*ROOM_DEPTH, gA = dt*dt*A/MPC;
    for(let i=0;i<N;i++){
      const M = Mm[i], R = M > 0 ? mol[i]*E_RU/M : R_SI;
      kp[i] = vg[i]/(R*Math.max(Tr[i], 1));
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
    for(let i=0;i<N;i++) if(disp[i] !== 0 && eGasCell(vg[i])) b[i] += Mm[i]*disp[i]/(vg[i] + disp[i]);
    disp.fill(0);
    for(let i=0;i<N-1;i++){ const q = gx[i]*(p[i] - p[i+1]); b[i] -= q; b[i+1] += q; }
    for(let i=0;i<N-GW;i++){ const q = gy[i]*(p[i] - p[i+GW]); b[i] -= q; b[i+GW] += q; }
    if(sc[SC_ROOMCGIT] === 0) x.fill(0);
    sc[SC_ROOMCGIT] = eCgSolve(b, x, kp, gx, gy, CG_TOL, CG_MAX);
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) fx[i] -= gx[i]*((p[i+1] + x[i+1]) - (p[i] + x[i]));
      if(gy[i] !== 0) fy[i] -= gy[i]*((p[i+GW] + x[i+GW]) - (p[i] + x[i]));
    }
    eFaceLimit(Mm, fx, fy, 4, null);
    for(let i=0;i<N;i++){
      if(gx[i] !== 0) U[i] = fx[i]/(A*dt); else fx[i] = 0;
      if(gy[i] !== 0) V[i] = fy[i]/(A*dt); else fy[i] = 0;
    }
    const M0 = SX.gsM0; M0.set(Mm);
    eFaceInflow(SX.gsIn, fx, fy);
    eFaceMove(Mm, fx, fy);
    eRoomAdvect(s.roomH2, M0, Mm, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomO2, M0, Mm, fx, fy, SX.gsIn, 1);
    eRoomAdvect(s.roomVap, M0, Mm, fx, fy, SX.gsIn, 1);
    /* the receiver's gain comes off the donor, or a stencil-driven circulation makes energy */
    for(let i=0;i<N;i++){
      if(fx[i] !== 0){ const a = fx[i] > 0 ? i : i+1, c = a === i ? i+1 : i;
        eGsMixA(dt, fx, i); const q = E_RR[RR_GM]*(Tr[a] - Tr[c]); src[c] += q; src[a] -= q; }
      if(fy[i] !== 0){ const a = fy[i] > 0 ? i : i+GW, c = a === i ? i+GW : i;
        eGsMixA(dt, fy, i); const q = E_RR[RR_GM]*(Tr[a] - Tr[c]); src[c] += q; src[a] -= q; }
    }
  }
  const Pr = s.roomP, Pk = s.roomPPk;
  eRoomMolFill(mol);
  for(let i=0;i<N;i++) if(vg[i] > VGCELL) Pr[i] = mol[i]*E_RU*Tr[i]/Math.max(vg[i], 1e-6)/1000 - ROOM_P0;
  /* a flooded cell reads the gas it would rise to */
  for(let i=0;i<N;i++){
    if(!(vg[i] > VGCELL)){ eGasRing(i); const w = E_RR[RR_GW], n = SX.rGen[E_GEN_RINGN];
      let q = 0;
      for(let k=0;k<n;k++) q += Pr[SX.rGdI[k]]*SX.rGdW[k];
      Pr[i] = w > 0 ? q/w : (i >= GW ? Pr[i-GW] : 0); }
    if(Pr[i] > Pk[i]) Pk[i] = Pr[i]; }
  eRoomRegMean();
  const st = SX.rPStat;
  let pmax = 0;
  for(let i=0;i<N;i++){ const e = Pr[i] - st[i]; if(e > pmax) pmax = e; }
  E_RR[RR_PMAX] = pmax;
}

/* liquids: a pressure at every cell's floor and a speed on every face, one implicit solve of the gas step's shape */
const eLqShut = j => !SX.rHole[j] && (PT.rTight[j] === 1 || (PT.rOcc[j] === 1 && PT.rOwn[j] < 0));
const eLqRuns = (i, j) => !eLqShut(j) && !(PT.rPan[i] && !PT.rPan[j]);
function eLqCapA(q, j){ E_RR[RR_CAP] = Math.max(0, q.rho*(ROOM_VCELL - q.O[j]/q.oRho)); }
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
function eLqSurfA(q, i){ const t = eLqTop(q, i); zFloorA(t, E_RR, RR_SURF); E_RR[RR_SURF] += q.M[t]/(q.rho*MPC*ROOM_DEPTH); }
const eLqSurf = (q, i) => { eLqSurfA(q, i); return E_RR[RR_SURF]; };
function eLqStandWalk(N, full, stand){
  for(let i=N-1;i>=0;i--){ const j = i + GW;
    stand[i] = (j >= N || !eLqRuns(i, j)) ? 1 : (full[j] && stand[j]) ? 1 : 0; }
}
/* free-surface pressure at a cell's floor, E_RR[RR_RG] = rho g */
function eLqPFreeA(gas, h, i){ E_RR[RR_PF] = gas[i] + E_RR[RR_RG]*h[i]; }
/* one side's face force at head E_RR[RR_HM], its own wetted height E_RR[kw] */
function eLqSideA(q, stand, p, gas, i, kw){
  const rg = E_RR[RR_RG], hm = E_RR[RR_HM], w = Math.min(E_RR[kw], hm);
  E_RR[RR_SIDE] = stand[i] ? (p[i] + rg*(q.U ? q.U[i]/(q.oRho*MPC*ROOM_DEPTH) : 0))*w - rg*w*w/2 + gas[i]*(hm - w) : gas[i]*hm;
}
function eLqDriveXA(q, h, hc, stand, p, gas, i, j){
  E_RR[RR_WI] = Math.min(h[i], hc[i]); E_RR[RR_WJ] = Math.min(h[j], hc[j]);
  const hm = Math.max(E_RR[RR_WI], E_RR[RR_WJ]);
  if(!(hm > 0)){ E_RR[RR_DRV] = 0; return; }
  E_RR[RR_HM] = hm;
  eLqSideA(q, stand, p, gas, i, RR_WI); const si = E_RR[RR_SIDE];
  eLqSideA(q, stand, p, gas, j, RR_WJ);
  E_RR[RR_DRV] = (si - E_RR[RR_SIDE])/hm;
}
const eLqRunsX = (cap, i) => cap[i] > 0 && cap[i+1] > 0 && eLqRuns(i, i+1) && eLqRuns(i+1, i);
const eLqRunsY = (cap, i) => cap[i] > 0 && cap[i+GW] > 0 && eLqRuns(i, i+GW);
function eLqWriteP(N, LP, M, stand, p, gas, P0){
  for(let i=0;i<N;i++) LP[i] = M[i] > 0 ? ((stand[i] ? p[i] : gas[i]) - P0)/1000 : 0;
}
function eLqFallVA(N, vv, k, o){ E_RR[o] = Math.max(k < N-GW ? Math.abs(vv[k]) : 0, k >= GW ? Math.abs(vv[k-GW]) : 0); }
/* the volume E_RR[RR_SWM] kg of density E_RR[RR_RHO] crossing a face pushes the same volume of the receiver's gas back over it */
function eLqSwap(a, c){
  eRoomVgasA(c); const dV = E_RR[RR_SWM]/E_RR[RR_RHO];
  E_RR[RR_SWF] = Math.min(1, dV/(E_RR[RR_VG] + dV));
  eLqSwap1(ST.roomM, a, c); eLqSwap1(ST.roomH2, a, c); eLqSwap1(ST.roomO2, a, c); eLqSwap1(ST.roomVap, a, c);
}
function eLqSwap1(F, a, c){ const g = F[c]*E_RR[RR_SWF]; F[c] -= g; F[a] += g; }

function eLiqStep(dt, q){
  const N = GW*GH, M = q.M, E = q.E, rho = q.rho, K = q.bulk, vu = q.vu, vv = q.vv, LP = q.P, sc = ST.sc;
  const A = MPC*ROOM_DEPTH, rg = rho*G_SI, p = SX.lqP, h = SX.lqH, hc = SX.lqHc, cap = SX.lqCap, comp = SX.lqComp;
  const full = SX.lqFull, stand = SX.lqStand, gas = SX.lqGas, stiff = SX.lqStiff, hole = SX.rHole;
  const cd2 = 2*LIQ_CD*LIQ_CD, n2g = G_SI*LIQ_MANNING*LIQ_MANNING, P0 = ROOM_P0*1000, disp = ST.gsDisp;
  E_RR[RR_RG] = rg; E_RR[RR_RHO] = rho;
  let any = false;
  for(let i=0;i<N && !any;i++) if(M[i] > 0) any = true;
  if(!any){ vu.fill(0); vv.fill(0); return; }
  for(let i=0;i<N;i++){
    if(eLqShut(i)) cap[i] = 0; else { eLqCapA(q, i); cap[i] = E_RR[RR_CAP]; }
    hc[i] = cap[i]/(rho*A);
    h[i] = M[i]/(rho*A);
    gas[i] = (ROOM_P0 + ST.roomP[i])*1000;
    full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0;
  }
  eLqStandWalk(N, full, stand);
  for(let i=N-1;i>=GW;i--){
    if(!(cap[i] > 0 && M[i] > cap[i] && stand[i] && eLqRuns(i, i-GW) && !eLqShut(i-GW))) continue;
    const ex = M[i] - cap[i], eE = E ? E[i]*ex/M[i] : 0;
    M[i] -= ex; M[i-GW] += ex; if(E){ E[i] -= eE; E[i-GW] += eE; }
    disp[i-GW] += ex/rho;
    h[i] = M[i]/(rho*A); h[i-GW] = M[i-GW]/(rho*A);
    full[i-GW] = cap[i-GW] > 0 && M[i-GW] >= cap[i-GW]*LIQ_FULL_K ? 1 : 0;
  }
  eLqStandWalk(N, full, stand);
  for(let i=0;i<N;i++) stiff[i] = full[i] && stand[i] && (i < GW || !eLqRuns(i, i-GW) || h[i-GW] > LIQ_H_LO) ? 1 : 0;
  for(let i=0;i<N;i++){ if(stiff[i]) p[i] = P0 + LP[i]*1000; else { eLqPFreeA(gas, h, i); p[i] = E_RR[RR_PF]; } }
  let live = false;
  const dLo = rg*LIQ_H_LO;
  for(let i=0;i<N && !live;i++){ const X = i%GW;
    if(X < GW-1 && eLqRunsX(cap, i) && (h[i] > 0 || h[i+1] > 0)){
      if(Math.abs(vu[i]) > LIQ_REST) live = true;
      else { eLqDriveXA(q, h, hc, stand, p, gas, i, i+1); if(Math.abs(E_RR[RR_DRV]) > dLo) live = true; } }
    if(i < N-GW && eLqRunsY(cap, i) && (h[i] > 0 || h[i+GW] > 0)){ const j = i + GW;
      const d = p[i] - (full[j] ? p[j] - rg*Math.min(h[j], hc[j]) : gas[j]);
      if(Math.abs(vv[i]) > LIQ_REST || Math.abs(d) > dLo) live = true; } }
  if(!live){ vu.fill(0); vv.fill(0); sc[SC_LIQCGIT] = 0; eLqWriteP(N, LP, M, stand, p, gas, P0); return; }

  const ax = SX.lqAx, ay = SX.lqAy, ayD = SX.lqAyD, b = SX.lqB, x = SX.lqX, fx = SX.lqFx, fy = SX.lqFy;
  const dI = SX.lqDI, awx = SX.lqAwx, awy = SX.lqAwy, lat = SX.lqLat;
  for(let pass=0;pass<2;pass++){
    for(let i=0;i<N;i++) comp[i] = cap[i] > 0 ? (stiff[i] ? Math.max(cap[i]/K, 1e-9) : A/G_SI) : 1;
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
          const vup = v > 0 ? (X > 0 && awx[i-1] > 0 ? vu[i-1] : 0) : v < 0 ? (X < GW-2 && eLqRunsX(cap, j) ? vu[j] : 0) : 0;
          const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
          awx[i] = Aw; ax[i] = g; fx[i] = rho*Aw*dt*(v + dt*adv*vup)/den + g*d0;
          fx[i] += (lat[i] - lat[j])*dt*dt/L; } }
      if(i < N-GW && eLqRunsY(cap, i)){ const j = i + GW, v = vv[i];
        const d0 = p[i] - (full[j] ? p[j] - rg*Math.min(h[j], hc[j]) : gas[j]);
        let up = v > 0 ? i : v < 0 ? j : (d0 > 0 ? i : d0 < 0 ? j : (M[i] >= M[j] ? i : j));
        if(!(M[up] > 0)) up = up === i ? j : i;
        const dn = up === i ? j : i;
        const f = cap[up] > 0 ? Math.min(1, M[up]/cap[up]) : 0;
        if(f > 0){ const Aw = A*f, L = Math.max(Math.min(h[i], hc[i]), Math.min(h[j], hc[j]), LIQ_L_MIN), hf = Math.max(f*MPC, 1e-3);
          if(!stand[i] && stand[j] && v > 0) lat[j] += 0.5*rho*Aw*v*v;
          let c = n2g*Math.abs(v)/Math.pow(hf, 4/3);
          if(full[up] && !(full[dn] && stand[dn]) && (hole[i] || hole[j])) c += Math.abs(v)/(cd2*L);
          const vup = v > 0 ? (i >= GW && awy[i-GW] > 0 ? vv[i-GW] : 0) : v < 0 ? (j < N-GW && eLqRunsY(cap, j) ? vv[j] : 0) : 0;
          const adv = Math.abs(v)/MPC, den = 1 + dt*(c + adv), g = Aw*dt*dt/(L*den);
          awy[i] = Aw; fy[i] = rho*Aw*dt*(v + dt*adv*vup)/den + g*d0;
          if(full[j]) ay[i] = g; else ayD[i] = g; } } }
    for(let i=0;i<N;i++){ const X = i%GW;
      dI[i] = comp[i] + ayD[i];
      b[i] = -(fx[i] - (X > 0 ? fx[i-1] : 0) + fy[i] - (i >= GW ? fy[i-GW] : 0)); }
    x.fill(0);
    sc[SC_LIQCGIT] = eCgSolve(b, x, dI, ax, ay, LIQ_CG_TOL, LIQ_CG_MAX);
    for(let i=0;i<N;i++){
      if(ax[i] !== 0) fx[i] += ax[i]*(x[i] - x[i+1]);
      if(ay[i] !== 0) fy[i] += ay[i]*(x[i] - x[i+GW]);
      else if(ayD[i] !== 0) fy[i] += ayD[i]*x[i];
    }
    /* a lid the pass fills from the side goes stiff and the pass is taken again */
    if(pass === 0){ let lid = false;
      for(let i=0;i<N;i++){ const X = i%GW;
        if(!full[i] || stiff[i] || !stand[i]) continue;
        const net = -fx[i] + (X > 0 ? fx[i-1] : 0) - fy[i] + (i >= GW ? fy[i-GW] : 0);
        if(net > 1e-3){ stiff[i] = 1; lid = true; } }
      if(lid) continue; }
    break;
  }
  for(let i=0;i<N;i++){
    if(awx[i] > 0){ const v = eClamp(fx[i]/(rho*awx[i]*dt), -LIQ_V_MAX, LIQ_V_MAX); fx[i] = rho*awx[i]*dt*v; } else fx[i] = 0;
    if(awy[i] > 0){ let v = eClamp(fy[i]/(rho*awy[i]*dt), -LIQ_V_MAX, LIQ_V_MAX);
      if(v < 0 && !eLqRuns(i+GW, i) && !full[i+GW]) v = 0;
      fy[i] = rho*awy[i]*dt*v; } else fy[i] = 0;
  }
  const lcap = SX.lqLcap;
  for(let i=0;i<N;i++) lcap[i] = stand[i] ? cap[i] : E_INF;
  eFaceLimit(M, fx, fy, 128, lcap);
  for(let i=0;i<N;i++){
    vu[i] = awx[i] > 0 ? fx[i]/(rho*awx[i]*dt) : 0;
    vv[i] = awy[i] > 0 ? fy[i]/(rho*awy[i]*dt) : 0;
  }
  const M0 = SX.lqM0; M0.set(M);
  eFaceInflow(SX.gsIn, fx, fy);
  eFaceMove(M, fx, fy);
  if(E) eRoomAdvect(E, M0, M, fx, fy, SX.gsIn, E_INF);
  for(let i=0;i<N;i++) if(M[i] <= 0){ M[i] = 0; if(E) E[i] = 0; }
  for(let i=0;i<N;i++){
    if(fx[i] > 0){ E_RR[RR_SWM] = fx[i]; eLqSwap(i, i+1); } else if(fx[i] < 0){ E_RR[RR_SWM] = -fx[i]; eLqSwap(i+1, i); }
    if(fy[i] > 0){ E_RR[RR_SWM] = fy[i]; eLqSwap(i, i+GW); } else if(fy[i] < 0){ E_RR[RR_SWM] = -fy[i]; eLqSwap(i+GW, i); }
  }
  for(let i=0;i<N;i++){ h[i] = M[i]/(rho*A); full[i] = cap[i] > 0 && M[i] >= cap[i]*LIQ_FULL_K ? 1 : 0;
    if(stiff[i]) p[i] = p[i] + x[i]; else { eLqPFreeA(gas, h, i); p[i] = E_RR[RR_PF]; } }
  eLqStandWalk(N, full, stand);
  eLqWriteP(N, LP, M, stand, p, gas, P0);
}
/* a source (E_RR[RR_LKG] kg, RR_LKJ kJ, RR_LV0 m/s) climbs a full column to the first cell with room, arriving at the speed it left its opening at */
const eLiqLandAt = (q, i, kg, kJ, v0) => { E_RR[RR_LKG] = kg; E_RR[RR_LKJ] = kJ; E_RR[RR_LV0] = v0; eLiqLand(q, i); };
function eLiqLand(q, i){
  const kg = E_RR[RR_LKG];
  if(!(kg > 0)) return;
  while(i >= GW && eLqFull(q, i) && eLqRuns(i, i-GW) && !eLqShut(i-GW)) i -= GW;
  ST.gsDisp[i] += kg/q.rho;
  q.M[i] += kg;
  if(q.E) q.E[i] += E_RR[RR_LKJ];
  const v0 = E_RR[RR_LV0];
  if(v0 > 0 && i < GW*GH-GW && eLqRuns(i, i+GW) && !eLqFull(q, i+GW)) q.vv[i] = Math.max(q.vv[i], Math.min(v0, LIQ_V_MAX));
}

const E_RIO = new Float64Array(MX_N), E_RP = new Float64Array(8);
function ePoolTA(i){ const m = ST.roomPool[i], E = ST.roomPoolE[i];
  if(!(m > 0)){ E_RR[RR_PT] = T_HULL; return; }
  const f = PT.rFire, cp = PK[PK_RFIRECP], eF = -m*f.lf;
  E_RR[RR_PT] = E >= 0 ? f.melt + E/(m*cp) : E > eF ? f.melt : f.melt + (E - eF)/(m*cp); }
const eRoomPoolT = i => { ePoolTA(i); return E_RR[RR_PT]; };
function eRoomWaterTA(i){
  if(ST.roomWater[i] > 0){ const io = E_RIO; io[MX_H] = ST.roomWaterE[i]/ST.roomWater[i]; tLiqA(SAT_WATER, io); E_RR[RR_T] = io[MX_TL]; }
  else E_RR[RR_T] = T_HULL; }
const eRoomWaterT = i => { eRoomWaterTA(i); return E_RR[RR_T]; };

/* floor water boils off past saturation at the gas over it, and trades with its own air over a free surface */
function eWaterHeat(dt, src){
  const N = GW*GH, s = ST, W = s.roomWater, E = s.roomWaterE, Tr = s.roomT, A = MPC*ROOM_DEPTH, hk = ROOM_H*A/1000, q = E_LQ[0], r = E_RP;
  for(let i=0;i<N;i++){
    const m = W[i];
    if(!(m > 0)) continue;
    r[0] = (ROOM_P0 + Math.max(0, s.roomP[i]))/1000; satTA(SAT_WATER, r, 0, 1); satHA(SAT_WATER, r, 0, 2);
    const hf = r[2];
    if(E[i] > m*hf){
      curveA(SAT_WATER, CV_HFG, r, 1, 4);
      const hfg = r[4], dm = Math.min(m, (E[i] - m*hf)/hfg);
      W[i] = m - dm; E[i] -= dm*(hf + hfg);
      s.roomVap[i] += dm; s.roomM[i] += dm; eBook(E_BK_SUMP, dm);
      r[5] = Tr[i]; hOfTA(SAT_WATER, r, 5, 6);
      src[i] += dm*(hf + hfg - r[6])/dt;
      if(W[i] <= 0){ W[i] = 0; src[i] += E[i]/dt; E[i] = 0; continue; }
    }
    if(eLqFull(q, i) && i >= GW && W[i-GW] > 0 && !eLqShut(i-GW)) continue;
    eRoomWaterTA(i); const Tw = E_RR[RR_T];
    let qk = hk*(Tw - Tr[i]);
    r[5] = Tw; cpOfA(SAT_WATER, r, 5, 6);
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
    M[i] -= take; want -= take;
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
        O[i] -= mm*f.o2;
        fq[i] += mm*(f.lhv + cp*(Tin - f.melt));
        burnt += mm; on++; } }
    sc[SC_FIREKG] += burnt; sc[SC_FIREQ] += burnt*f.lhv;
    const np = eOpenPour(o, cells, nc), per = (kg - burnt)/np;
    if(per > 0){ E_RR[RR_LKG] = per; E_RR[RR_LKJ] = per*cp*(Tin - f.melt); E_RR[RR_LV0] = v;
      for(let k=0;k<np;k++) eLiqLand(E_LQ[1], pour[k]); }
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
        O[i] -= mb*f.o2;
        E[i] += mb*f.lhv - mb*cp*(Tp - f.melt);
        sc[SC_FIREKG] += mb; sc[SC_FIREQ] += mb*f.lhv;
        on++;
      }
    }
    if(!(m > 0)){ M[i] = 0; E[i] = 0; continue; }
    ePoolTA(i); Tp = E_RR[RR_PT];
    let q = (f.hConv*(Tp - Tr[i]) + f.emis*SIGMA*(Math.pow(Tp,4) - Math.pow(Tr[i],4))/1000)*A;
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
    const i = Y*GW + X, q = gx[i]*Math.min(M[i], M[i+1])*(y[i] - y[i+1])/ROOM_C;
    d[i] -= q; d[i+1] += q; }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW + X, j = i + GW, q = gDn[i]*Math.min(M[i], M[j])*(up*y[j] - y[i])/ROOM_C;
    d[i] += q; d[j] -= q; }
  for(let i=0;i<N;i++) F[i] = Math.max(0, F[i] + d[i]*dt);
}

/* RR_H2F and RR_O2F at the unburnt side of the front */
function eFrontA(i){ const u = Math.max(ROOM_FR_MIN, 1 - ST.roomFlame[i]), n = ST.roomH2[i]/H2_MMOL;
  eRoomMolXA(i); const mx = E_RR[RR_MX];
  E_RR[RR_H2F] = n > 0 ? n/(mx*u + n) : 0;
  E_RR[RR_O2F] = ST.roomO2[i]/O2_MMOL/Math.max(1e-9, mx*u + ST.roomH2[i]/H2_MMOL); }
/* laminar burning velocity at RR_H2F into RR_A */
function eH2SlA(){ const f = E_RR[RR_H2F];
  E_RR[RR_A] = 0;
  if(f <= H2_SL[0][0] || f >= H2_SL[H2_SL.length-1][0]) return;
  for(let k=1;k<H2_SL.length;k++){ const x1 = H2_SL[k][0], y1 = H2_SL[k][1],
                                   x0 = H2_SL[k-1][0], y0 = H2_SL[k-1][1];
    if(f <= x1){ E_RR[RR_A] = y0 + (y1-y0)*(f-x0)/(x1-x0); return; } } }
const eFlamRR = () => E_RR[RR_H2F] >= H2_LFL && E_RR[RR_H2F] <= H2_UFL && E_RR[RR_O2F] >= O2_LOC;
function eFlam(i){ eRoomH2FracA(i); eRoomO2FracA(i); return eFlamRR(); }
function eIgnites(i){
  if(ST.roomT[i] >= H2_IGN) return true;
  const a = PT.rOwn[i];
  if(a < 0) return false;
  ePartSkinA(a); return E_RR[RR_SK] >= H2_IGN || ST.dmgBy[a] === 1;
}

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
      H[i] -= H[i]*f; s.roomVap[i] -= s.roomVap[i]*f;
      eRoomVgasA(i); const m0 = ROOM_P0/1000*E_RR[RR_VG]/(R_AIR*Math.max(Tr[i], 1));
      O[i] += (ROOM_O2_0/ROOM_M0*m0 - O[i])*f;
      s.roomM[i] += (m0 - s.roomM[i])*f; } }
  for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 2 || s.dmgBy[a]) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1]; if(k1 === k0) continue;
    const f = Math.min(1, INERT_KGS/(k1 - k0)/ROOM_MAIR*dt);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k]; H[i] -= H[i]*f; O[i] -= O[i]*f; } }
  eDiffuse(H, dt, H2_UP);
  eDiffuse(O, dt, 1);

  for(let i=0;i<N;i++)
    if(Fl[i] <= 0 && H[i] > 0 && eFlam(i) && eIgnites(i)) Fl[i] = 1e-6;
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
        /* the advance consumes the deficient reactant */
        const m = Math.min(H[i], O[i]/O2_PER_H2)*adv;
        if(m > 0){ H[i] -= m; O[i] -= m*O2_PER_H2; burned += m; q = m*H2_LHV; }
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
  const N = GW*GH, Pr = ST.roomP, scar = ST.roomScar, cur = ST.roomScarCur, st = SX.rPStat, occ = PT.rOcc, tight = PT.rTight;
  for(let i=0;i<N;i++){
    if(occ[i] || tight[i]) continue;
    const a = Math.abs(Pr[i] - st[i]);
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
    E_RP[2] = Tr[i]; hOfTA(SAT_WATER, E_RP, 2, 3);
    Vp[i] = v - drop; s.roomM[i] -= drop;
    E_RR[RR_LKG] = drop; E_RR[RR_LKJ] = drop*E_RP[3]; E_RR[RR_LV0] = 0; eLiqLand(q, i);
    eBook(E_BK_SUMP, -drop);
  }
}

function eInjectRoom(dt, src){
  const s = ST, sc = s.sc, kind = sc[SC_INJKIND], rate = sc[SC_INJDEM], i = sc[SC_INJCELL];
  if(!kind || !rate || i < 0 || i >= GW*GH) return;
  if(kind === E_INJ_HEAT){ src[i] += rate; return; }
  if(kind === E_INJ_GAS){
    if(!(rate < 0)) return;
    const f = Math.min(1, -rate*dt/Math.max(s.roomM[i], 1e-9));
    s.roomM[i] -= s.roomM[i]*f; s.roomH2[i] -= s.roomH2[i]*f; s.roomO2[i] -= s.roomO2[i]*f; s.roomVap[i] -= s.roomVap[i]*f;
    return; }
  if(kind === E_INJ_FLUID){
    const W = s.roomWater, dm = rate > 0 ? rate*dt : -Math.min(-rate*dt, W[i]);
    if(!dm) return;
    if(dm > 0){ E_RP[2] = T_HULL; hOfTA(SAT_WATER, E_RP, 2, 3);
      E_RR[RR_LKG] = dm; E_RR[RR_LKJ] = dm*E_RP[3]; E_RR[RR_LV0] = rate/(WATER_RHO*MPC*ROOM_DEPTH);
      eLiqLand(E_LQ[0], i); eBook(E_BK_INJECT, -dm); return; }
    s.roomWaterE[i] += s.roomWaterE[i]*dm/W[i]; s.gsDisp[i] += dm/WATER_RHO;
    W[i] += dm;
    eBook(E_BK_INJECT, -dm);
    return; }
  if(!(rate > 0)) return;
  const dm = rate*dt;
  if(kind === E_INJ_H2) s.roomH2[i] += dm;
  else if(kind === E_INJ_O2) s.roomO2[i] += dm;
  else if(kind === E_INJ_STEAM) s.roomVap[i] += dm;
  else return;
  s.roomM[i] += dm;
}
/* the INJECT tool aimed at a node: a boundary the player holds open, booked against `inject` */
function eInjectFluid(dt){
  const sc = ST.sc, n = sc[SC_INJNODE], rate = sc[SC_INJDEM];
  if(sc[SC_INJKIND] !== E_INJ_FLUID || !rate || n < 0) return;
  const have = ST.mBy[n];
  if(!isFinite(have)) return;
  const kg = rate > 0 ? rate*dt : -Math.min(-rate*dt, have);
  if(!kg) return;
  ST.mBy[n] = have + kg;
  eBook(E_BK_INJECT, -kg);
}

/* contents to skin to air, both ways; what the room takes is booked against the pot it left (ST.skinQ) */
function eRoomStep(dt){
  eLqBind(); eRoomLive();
  const N = GW*GH, s = ST, sc = s.sc, Tr = s.roomT, src = SX.rSrc, d = SX.rD, cells = SX.rCells;
  src.fill(0);
  eGasStep(dt, src);
  const nP = PT.n.part;
  for(let a=0;a<nP;a++){
    if(PT.partKind[a] !== 0) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1], n = k1 - k0;
    if(!n) continue;
    ePartTempA(a); const Tp = E_RR[RR_PTMP], proc = isFinite(Tp);
    if(s.partT[a] < 0) s.partT[a] = proc ? Tp : T_HULL;
    const Ts = s.partT[a];
    let air = 0;
    for(let k=k0;k<k1;k++) air += Tr[PT.partCellIx[k]];
    const qProc = proc ? n*ROOM_HK*SKIN_PROC_K*(Tp - Ts) : 0;
    s.skinQ[a] = qProc;
    s.partT[a] = eClamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt, T_SPACE, ROOM_TMAX);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k]; src[i] += ROOM_HK*(Ts - Tr[i]); }
  }
  for(let g=0;g<PT.nRseg;g++){
    const k0 = PT.rsegCell0[g], k1 = PT.rsegCell0[g+1], n = k1 - k0, nd = PT.rsegNode[g];
    let Tf0 = E_NAN; if(nd >= 0){ eNodeTA(nd); Tf0 = E_NT[MX_T]; } const has = isFinite(Tf0);
    if(s.runT[g] < 0) s.runT[g] = has ? Tf0 : T_HULL;
    const Ts = s.runT[g];
    let air = 0;
    for(let k=k0;k<k1;k++) air += Tr[PT.rsegCellIx[k]];
    const qProc = has ? n*ROOM_HK*SKIN_PROC_K*(Tf0 - Ts) : 0;
    s.runT[g] = eClamp(Ts + (qProc + ROOM_HK*(air - n*Ts))/skinCap(n)*dt, T_SPACE, ROOM_TMAX);
    for(let k=k0;k<k1;k++){ const i = PT.rsegCellIx[k]; src[i] += ROOM_HK*(Ts - Tr[i]); }
  }
  const sh = PK[PK_RSTEAMH], jr = PT.rJetRelief;
  for(let k=0;k<jr.length;k++){ const v = jr[k], rate = s.reliefSteam[v];
    if(!(rate > 0)) continue;
    const nc = ePartCells(PT.fitPart[PT.reliefFit[v]], cells); if(!nc) continue;
    E_RR[RR_B] = rate; const m = ePlume(cells, nc);
    E_RR[RR_C] = rate*sh; eSpreadQ(src, m); E_RR[RR_C] = rate*dt; eAddGasQ(m); }
  for(let b=0;b<PT.n.boiler;b++){
    let byValve = 0;
    for(let k=PT.boilerValve0[b];k<PT.boilerValve0[b+1];k++) byValve += s.reliefSteam[PT.boilerValveIx[k]];
    const hole = Math.max(0, s.sgVentBy[b] - byValve);
    if(!(hole > 0)) continue;
    const nc = ePartCells(PT.boilerPart[b], cells); if(!nc) continue;
    E_RR[RR_B] = hole; const m = ePlume(cells, nc);
    E_RR[RR_C] = hole*sh; eSpreadQ(src, m); E_RR[RR_C] = hole*dt; eAddGasQ(m); }
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
    const kgps = kg/dt*E_RR[RR_X];
    E_RR[RR_B] = kgps; E_RR[RR_D] = s.hBy[nd];
    const m = ePlume(cells, nc);
    eJetLiqQ(src, m, c); E_RR[RR_C] = kgps*dt; eAddGasQ(m); }
  if(ST.sc[SC_INJKIND]) eInjectRoom(dt, src);
  eFireStep(dt, src);
  if(!sc[SC_BLACKOUT]) for(let a=0;a<nP;a++){
    if(PT.partRoomRole[a] !== 1 || s.dmgBy[a]) continue;
    const k0 = PT.partCell0[a], k1 = PT.partCell0[a+1]; if(k1 === k0) continue;
    const ua = ROOM_VENT_KGS*ROOM_CP/(k1 - k0);
    for(let k=k0;k<k1;k++){ const i = PT.partCellIx[k]; src[i] -= ua*(Tr[i] - T_HULL); } }

  const gx = SX.rGx, gUp = SX.rGUp, gDn = SX.rGDn, face = PT.rFace;
  for(let i=0;i<N;i++) d[i] = src[i];
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW-1;X++){
    const i = Y*GW + X, q = gx[i]*(Tr[i] - Tr[i+1]);
    d[i] -= q; d[i+1] += q; }
  for(let Y=0;Y<GH-1;Y++) for(let X=0;X<GW;X++){
    const i = Y*GW + X, j = i + GW, dT = Tr[j] - Tr[i];
    const q = (dT > 0 ? gUp[i] : gDn[i])*dT;
    d[i] += q; d[j] -= q; }
  { const k = HULL_EMIS*SIGMA*HULL_FACE_A/1000, t4 = Math.pow(T_SPACE, 4);
    for(let i=0;i<N;i++) if(face[i]) d[i] -= k*face[i]*(Math.pow(Tr[i], 4) - t4); }
  for(let i=0;i<N;i++) Tr[i] = eClamp(Tr[i] + d[i]/ROOM_C*dt, T_SPACE, ROOM_TMAX);
  eH2Step(dt);
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
    for(let k=0;k<np;k++) eLiqLand(q, pour[k]);
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
  const s = ST, sc = s.sc, nP = PT.n.part, Pr = s.roomP, gauge = SX.rPStat, box = PT.partBox;
  if(!sc[SC_BURNBLAST] && sc[SC_ROOMPMAX] >= PK[PK_MINPBURST]){
    sc[SC_BURNBLAST] = 1; eEvent(EV_EXPLOSION, sc[SC_ROOMPMAX], PK[PK_MINPBURST]); }
  const burn = sc[SC_ROOMBURNON] || sc[SC_ROOMFIREON] || sc[SC_ROOMBANG];
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
        if(burn && Pr[i] - gauge[i] > bang) bang = Pr[i] - gauge[i]; } }
    else { const i = PT.partCell[a]; if(i < 0) continue;
      pk = Pr[i]; bang = burn ? pk - gauge[i] : 0; }
    const blast = bang >= lim, clim = lim*E_CRUSH_K;
    if(blast) s.roomCrush[a] = 0;
    else { E_RR[RR_A] = (pk - clim)/(clim*E_CRUSH_SPAN); if(!eHurt(s.roomCrush, a, E_CRUSH_TAU)) continue; }
    eDamage(a, blast ? E_WHY_BLAST : E_WHY_CRUSHED);
    if(blast) s.burnEvBy[a] = 1;
    eEvent(blast ? EV_BLAST_DMG : EV_CRUSH_DMG, a, blast ? bang : pk);
  }
  sc[SC_ROOMBANG] = 0;
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
    case 1: return sc[SC_DNBR] < 1.30;
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
    case 26: return sc[SC_QOX] > sc[SC_N]*PROMPT_F;
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
    case 1: return s.csDnbr[c] < 1.30;
    case 2: return s.csDmg[c] > 0.1;
    case 6: if(!P.vessel) return false; eTProgA(c); return Math.abs(s.TavgBy[PT.coreCirc[c]] - E_CT[2]) > 4;
    case 7: return -s.csParts[c*RP_N + RP_XE] > 3200;
    case 8: return s.csScrammed[c] === 1 && s.csRho[c] > -200;
    case 9: return s.csRodJam[c] === 1;
    case 11: return s.csVf[c] > 0.15;
    case 12: return s.csScrammed[c] === 1;
    case 17: return s.csBreach[c] === 1;
    case 19: return s.csMelt[c] === 1;
    case 27: return s.csRodBand[c] === 1;
    case 28: return eTripNear() > 0;
    case 30: return s.csQOx[c] > 0 && s.csQOx[c] > s.csN[c]*PROMPT_F;
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
    case 5: return sc[SC_SC] < 8 ? 1 : 0;
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
  eRoomRegMean();
}

/* UI only: one ring row as [severity, headline, text] */
const E_TXT_EV = [];
{ const nm = a => a >= 0 && IX && IX.partId[a] ? nameOf(IX.partId[a]) : "A MACHINE";
  const f0 = v => (+v).toFixed(0), f1 = v => (+v).toFixed(1);
  const T = E_TXT_EV;
  T[EV_HIPOW] = () => ["warn", "POWER ABOVE 110%", "Running past rated output. Thermal margin is what pays for it, and DNBR is falling."];
  T[EV_DNBR13] = () => ["warn", "DNBR BELOW 1.30", "Coolant is approaching film boiling on the fuel pins. Raise pump flow or pressure, or cut power."];
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
  T[EV_TUBE_RUPTURE] = (c, f) => ["alarm", "FUEL CHANNEL RUPTURE / "+cn(c), f0(f*100)+" % of the channels are torn. They are discharging into the reactor cavity, which has its own relief sized for one of them."];
  T[EV_SHIELD_LIFTED] = (c, g) => ["alarm", "UPPER SHIELD LIFTED / "+cn(c), "The reactor cavity reached "+f0(g*1000)+" kPa against the "+f0(PT.coreShieldLift[c]*1000)+" its shield weighs. The shield is off, every channel is torn at its top weld and the whole core is open to the room."];
  T[EV_CORE_MELT] = c => ["alarm", "CORE MELT / "+cn(c), "A quarter of the fuel is molten. Unrecoverable."];
  T[EV_BANKS_SPLIT] = () => ["warn", "BANKS SPLIT", "The banks are now driven one at a time and the tilt trim is stood down - per-bank demand is the tilt handle from here. Each bank keeps its own AUTO or MANUAL setting, and the T-avg controller drives only the ones left on AUTO. Fewer banks on AUTO means less worth answering the same temperature error, so the loop gets slower, not just smaller."];
  T[EV_BANKS_GANGING] = () => ["info", "BANKS GANGING", "The banks are being driven back together. They are still split until they arrive, and a scram overrides this at any point."];
  T[EV_DISC_BURST] = (t, p) => ["alarm", (id("tankId", t) && D.tanks[id("tankId", t)] ? D.tanks[id("tankId", t)].name : "A TANK")+" DISC BURST", "The tank reached "+f1(p)+" MPa and its rupture disc let go. What was in it is on the containment floor and its activity is in the air, not behind a wall. This is the TMI-2 sequence."];
  T[EV_VACUUM_LOST] = () => ["alarm", "CONDENSER VACUUM LOST", "The condenser has reached atmospheric pressure and relieved. It is open to the room, it will not hold vacuum again, and it has stopped being a heat sink. What the bypass still passes into it goes overboard, and the rest backs up onto the generators' safety valves."];
  T[EV_TURB_TRIP] = () => ["alarm", "TURBINE TRIP", "Exhaust pressure past what the machine will run against. The stop valve is shut. The reactor is still making heat and the turbine is no longer taking any of it."];
  T[EV_TURB_RESET] = () => ["info", "TURBINE RELATCHED", "Exhaust pressure is back under the trip point and the machine is whole. The stop valve is open and the turbine is taking steam again."];
  T[EV_COND_VENTING] = () => ["warn", "STEAM GOING OVERBOARD", "The turbine bypass is passing steam into a machine that is open to atmosphere, and the water going with it does not come back. The hotwell is draining and no valve on the plant is open."];
  T[EV_SG_RELIEF_LIFT] = v => ["warn", (id("reliefId", v) ? nameOf(id("reliefId", v)) : "A SAFETY VALVE")+" LIFTED", "Shell pressure reached this valve's set point and it is passing steam to atmosphere. The water going with it does not come back."];
  T[EV_SG_BURST] = (g, p) => ["alarm", (id("sgId", g) ? nameOf(id("sgId", g)) : "A GENERATOR")+" SHELL BURST", "The secondary shell has ruptured at "+f1(p)+" MPa. It was raising steam faster than anything fitted could get rid of. What is in it is going to atmosphere, it will not hold pressure again, and it stops cooling its loop the moment it is empty."];
  T[EV_PIPE_BURST] = (u, p) => ["alarm", "PIPE RUPTURE", (id("runId", u) || "A run")+" has split at "+f1(p)+" MPa against a wall rated for "+f1(PT.runBurstP[u]/PIPE_BURST_K)+" MPa. Both cut ends are open to the compartment."];
  T[EV_WALL_BURST] = (m, dp) => ["alarm", "CONTAINMENT FAILURE", "A wall cell has let go - "+f0(dp*1000)+" kPa across it against a cell that bursts at "+f0(PT.paintBurstP[m]*1000)+" kPa. The compartment behind it is now the ship's compartment."];
  T[EV_LEDGER] = (r, m) => ["warn", "MASS BOOKS NOT CLOSING", f1(r)+" kg unattributed of "+f0(m)+" kg this tick. Something moved water without an edge carrying it."];
  }
function eEventText(k){
  const code = ST.evCode[k], fn = E_TXT_EV[code];
  return fn ? fn(ST.evA[k], ST.evB[k]) : ["info", EV_NAMES[code] || "EVENT", ""];
}
