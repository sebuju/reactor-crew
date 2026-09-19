"use strict";
// imports: eNetCoreKg eNetCoreInH eNodeInCorePiece eNetCavGauge eRoomBang eContRel eBookMelt eRodDriven eTavgOf eTProg eRepairRadRate
// exports: eCoreQWater eCoreQWaterA eCoreSeed eCoreReset eCoreBanksSeed eCoreRestStep eCoreDialBoron eCoreSeal eCoreDnbrFit eCoreAgg eCoreRodStep eBoronFollow eCoreDecayStep eCoreFlowRead eCorePRead eCoreFatigueStep eCoreBurstStep eCoreVesselStep eCoreFlowSet eCoreKineticsStep eCoreMeltStep eRadDose eRadCellA eRodApply eRodCommon eSetSplit eScram eScramSink eNearTrip eTripReset eBankAutoLive eEcr eFuelStage eCoreStep

/* Way-Wigner decay heat (3 yr irradiation) as a log-spaced exponential sum; the fastest group holds the total at 1-PROMPT_F */
const E_DEC_N = 11, E_DEC_L = new Float64Array(E_DEC_N), E_DEC_A = new Float64Array(E_DEC_N);
(function(){ const T = 9.46e7, r = Math.pow(10, 0.8), G = 4.590843712; let sum = 0;
  for(let k=0;k<E_DEC_N;k++){ const l = 0.8/Math.pow(r, k);
    E_DEC_L[k] = l; E_DEC_A[k] = 0.0622*Math.pow(l, 0.2)*Math.log(r)*(1 - Math.exp(-l*T))/G;
    if(k) sum += E_DEC_A[k]; }
  E_DEC_A[0] = (1 - PROMPT_F) - sum; })();

const E_DNB_W3 = 0, E_DNB_BOIL = 1, E_DNB_TEMP = 2;
const E_CO_DOP=0, E_CO_MOD=1, E_CO_EXP=2, E_CO_VD=3, E_CO_XE=4, E_CO_ROD=5, E_CO_TIP=6, E_CO_DIS=7, E_CO_GR=8, E_CO_H2=9, E_CO_FCI=10, E_CO_N=11;

const E_TRIP_NONE=0, E_TRIP_MANUAL=1, E_TRIP_AUTO=2, E_TRIP_RPS=3, E_TRIP_VESSEL=4, E_TRIP_CHANNEL=5, E_TRIP_SHIELD=6, E_TRIP_MELT=7;
const E_TXT_TRIP = ["", "MANUAL SCRAM", "AUTOMATIC SCRAM", "RPS TRIP / ", "VESSEL RUPTURE", "CHANNEL RUPTURE", "SHIELD LIFTED", "CORE MELT"];

const E_FAIL_INTACT=0, E_FAIL_TUBE=1, E_FAIL_BURST=2, E_FAIL_OXID=3, E_FAIL_DISP=4, E_FAIL_MOLTEN=5, E_FAIL_N=6;
/* NUREG-1465 release ratios above the fitted gap anchor */
const E_RELK = new Float64Array([0, 0, 0.40, 0.80, 1.60, 2.40]);

const E_W3_P=145.038, E_W3_G=737.338, E_W3_D=39.3701, E_W3_Q=3.15459, E_W3_H=2.326;
const E_W3_PLO=1000, E_W3_PHI=2300, E_W3_GLO=1.0, E_W3_GHI=5.0, E_W3_DLO=0.2, E_W3_DHI=0.7, E_W3_XLO=-0.15, E_W3_XHI=0.15;
const E_DNB_FILM=0.10, E_DT_LEID=150;
const E_P_FILL=2.2, E_T_FILL=300;
const E_BURST_LO_SIG=20, E_BURST_LO_T=1477, E_BURST_HI_SIG=140, E_BURST_HI_T=1030;
const E_BURST_TAU=8, E_BURST_SPAN=50;
const E_OX_CP_A=2.252e-6, E_OX_CP_B=18063, E_OX_BJ_A=1.867e-4, E_OX_BJ_B=22899, E_OX_TSW=1850;
const E_OX_VMIN=0.02, E_OX_T0=1073, E_OX_ECR_FAIL=0.17;
const E_FUSE_KJ=277, E_FUEL_CP=0.33, E_FUSE_DT=E_FUSE_KJ/E_FUEL_CP, E_T_STP=298;
const E_DISP_H=280*4.184, E_DISP_SPAN=40;
const E_FCI_TAU=0.01, E_FCI_ETA=0.2;
const E_MELT_LATCH=0.25, E_MELT_INV=0.35, E_MELT_FAT=1.6;
const E_CORE_DT_QMIN=0.004;
const E_BOR_IN=60, E_BOR_OUT=35;
const E_ZR_LO_T=573, E_ZR_LO_K=1.0, E_ZR_HI_T=1073, E_ZR_HI_K=0.2;
const E_RAD_CREW_K=0.33;
const E_FATIGUE_BURST_K=0.0028;

/* E_VQ: [0] void, quality or equilibrium quality in, [1] rho_g/rho_f or departure quality in, [2] out */
const E_VQ = new Float64Array(3);
function eDriftFluxA(){ const q = clamp(E_VQ[0], 0, 1), rvl = E_VQ[1];
  E_VQ[2] = q <= 0 ? 0 : clamp(q/(XC0*(q + (1 - q)*rvl)), 0, 1); }
function eVoidQualA(){ const q = clamp(E_VQ[0], 0, 1), rvl = E_VQ[1], den = 1 - q*XC0*(1 - rvl);
  E_VQ[2] = den > 1e-6 ? clamp(q*XC0*rvl/den, 0, 1) : 1; }
/* Levy's profile fit, defined only above departure - below it the expression goes to 1 and then NaN */
function eSubQualA(){ const xe = E_VQ[0], xd = E_VQ[1];
  if(xe <= xd){ E_VQ[2] = 0; return; }
  const E = Math.exp(xe/xd - 1); E_VQ[2] = (xe - xd*E)/(1 - xd*E); }

/* E_CR: [0] a node's ECR out, [1] pressure across the clad in, [2] its burst temperature out */
const E_CR = new Float64Array(3);
function eBurstTA(c){
  const rd = PT.coreRodD[c], sig = (rd/2 - ROD_CLAD)/ROD_CLAD*Math.max(E_CR[1], 0);
  if(sig <= E_BURST_LO_SIG){ E_CR[2] = E_BURST_LO_T; return; }
  const f = Math.log(sig/E_BURST_LO_SIG)/Math.log(E_BURST_HI_SIG/E_BURST_LO_SIG);
  E_CR[2] = Math.max(E_BURST_HI_T, E_BURST_LO_T - (E_BURST_LO_T - E_BURST_HI_T)*f);
}
/* E_OXR: [0] clad K in, [1] parabolic rate constant out */
const E_OXR = new Float64Array(2);
function eOxRateA(){ const T = E_OXR[0];
  E_OXR[1] = T < E_OX_TSW ? E_OX_CP_A*Math.exp(-E_OX_CP_B/Math.max(T, 300))
                          : E_OX_BJ_A*Math.exp(-E_OX_BJ_B/Math.max(T, 300)); }
function eEcrA(i){ E_CR[0] = (ST.csNOx[i] + ST.csNDmg[i]*ST.csNOxI[i])/ZR_PBR/ROD_CLAD; }
const eEcr = (c, k) => { eEcrA(c*XNN + k); return E_CR[0]; };
/* E_BUR: [0] the vessel's burst MPa, [1] clad K in, [2] Zircaloy strength factor out */
const E_BUR = new Float64Array(3);
function eZrKA(){ E_BUR[2] = E_ZR_LO_K + (E_ZR_HI_K - E_ZR_LO_K)*clamp((E_BUR[1] - E_ZR_LO_T)/(E_ZR_HI_T - E_ZR_LO_T), -0.3, 1); }
function eBurstPA(c){ E_BUR[0] = PT.coreP0[c]*(PT.coreBurstK[c] - E_FATIGUE_BURST_K*ST.csFatigue[c]); }
const eXTauF = c => XTAU_F*PT.coreRodD[c]/ROD_D0;
const eIoEq = (c, fl) => PT.coreGI[c]*fl/PT.coreLamI[c];
const eXeEq = (c, fl) => (PT.coreGI[c] + PT.coreGX[c])*fl/(PT.coreLamX[c] + PT.coreSig[c]*fl);
const eBankAutoLive = (c, b) => !ST.csScrammed[c] && !ST.csRodJam[c] && (!ST.csSplit[c] || ST.csBankAuto[c*PT.nbMax + b] === 1);

function eFuelStage(c, k){
  const i = c*XNN + k;
  if(ST.csNMelt[i] > 0) return E_FAIL_MOLTEN;
  if(ST.csNDisp[i] > 0) return E_FAIL_DISP;
  eEcrA(i); if(E_CR[0] >= E_OX_ECR_FAIL) return E_FAIL_OXID;
  if(ST.csNDmg[i] > 0) return E_FAIL_BURST;
  if(ST.csNTube[i] > 0) return E_FAIL_TUBE;
  return E_FAIL_INTACT;
}

function eRodShape(c){
  const nb = c*XNN, rb = c*XNR, bb = c*PT.nbMax, NB = PT.coreNB[c], rinf = PT.coreRinf[c], tipLen = PT.coreTipLen[c], tipGap = PT.coreTipGap[c];
  const cov = ST.csNCov, fol = ST.csNFol;
  for(let k=0;k<XNN;k++){ cov[nb+k] = 0; fol[nb+k] = 0; }
  for(let b=0;b<NB;b++){
    const ins = clamp(ST.csRodZ[bb+b], 0, 1), tip = XNZ*(1 - ins), fHi = follHi(tip, tipGap), fLo = fHi - tipLen, br = PT.coreBankR[bb+b];
    for(let i=0;i<XNR;i++){
      const w = Math.max(0, 1 - Math.abs(i - br)/rinf)/Math.max(PT.coreRinfW[rb+i], 1e-6);
      if(w <= 0) continue;
      for(let j=0;j<XNZ;j++){ const k = nb + i*XNZ + j;
        cov[k] += w*clamp(j + 1 - tip, 0, 1);
        fol[k] += w*clamp(Math.min(j + 1, fHi) - Math.max(j, fLo), 0, 1); } } }
}

function eCoreSolve(c, sweeps){
  const phi = ST.csPhi, rho = ST.csNRho, nb = c*XNN, cr = PT.coreCr[c], cz = PT.coreCz[c];
  const aR = PT.coreAlbR[c], aT = PT.coreAlbT[c], aB = PT.coreAlbB[c];
  for(let s=0;s<sweeps;s++){
    for(let i=0;i<XNR;i++){
      const b = nb + i*XNZ, fi = faceI[i], fo = faceO[i], den = cr*(fi + fo) + 2*cz + 1;
      for(let j=0;j<XNZ;j++){ const k = b + j;
        const In = i > 0 ? phi[k-XNZ] : 0;
        const Ou = i < XNR-1 ? phi[k+XNZ] : aR*phi[k];
        const Dn = j > 0 ? phi[k-1] : aB*phi[k];
        const Up = j < XNZ-1 ? phi[k+1] : aT*phi[k];
        const num = cr*(fi*In + fo*Ou) + cz*(Dn + Up) + (1 + rho[k]*1e-5)*phi[k];
        const v = phi[k] + SOR_OM*(num/den - phi[k]);
        phi[k] = (isFinite(v) && v > 1e-6) ? v : 1e-6; } }
    let m = 0; for(let k=0;k<XNN;k++) m += phi[nb+k]*nodeW[k];
    if(m > 1e-9) for(let k=0;k<XNN;k++) phi[nb+k] /= m;
    else for(let k=0;k<XNN;k++) phi[nb+k] = 1;
  }
}

function eNodePeak(c){
  const phi = ST.csPhi, nb = c*XNN, o = SX.corePeak;
  let v = -1e30, k = 0;
  for(let q=0;q<XNN;q++) if(phi[nb+q] > v){ v = phi[nb+q]; k = q; }
  o[0] = v; o[1] = k; o[2] = (k/XNZ)|0; o[3] = k%XNZ;
}

function eRodBanks(c){
  const bb = c*PT.nbMax, NB = PT.coreNB[c];
  for(let b=0;b<NB;b++)
    ST.csRodZ[bb+b] = clamp(ST.csSplit[c] ? ST.csRodZ[bb+b] : ST.csRodPos[c] + PT.coreBankW[bb+b]*XTILTZ*ST.csTilt[c], 0, 1);
}

function eCoreSeed(c, x0, n0){
  const s = ST, pb = c*RP_N, db = c*E_DEC_N, gb = c*6;
  s.csN[c] = n0; s.csI[c] = eIoEq(c, n0); s.csX[c] = PT.coreX0[c]; s.csTf[c] = PT.coreTfRef[c];
  s.csRodPos[c] = x0; s.csRodDem[c] = x0; s.csRodJam[c] = 0; s.csRodBand[c] = 0; s.csScrammed[c] = 0;
  s.csRpsNear[c] = 0; s.csRpsHot[c] = 0; s.csTrip[c] = E_TRIP_NONE; s.csTripArg[c] = -1; s.csSplit[c] = 0; s.csReGang[c] = 0;
  s.csTilt[c] = 0; s.csTiltDem[c] = 0; s.csBreach[c] = 0; s.csMelt[c] = 0; s.csFatigue[c] = 0; s.csDmg[c] = 0;
  s.csMeltFrac[c] = 0; s.csOxMax[c] = 0; s.csQOx[c] = 0; s.csFci[c] = 0; s.csFq[c] = 1; s.csDnbr[c] = PT.coreDnbr0[c];
  s.csVf[c] = 0; s.csVoidTh[c] = 0; s.csRho[c] = 0; s.csPCore[c] = PT.coreP0[c];
  s.csCoreDT[c] = PT.coreDT0[c]*PT.coreN0[c]; s.csFlowNet[c] = 1;
  s.csTubesOpen[c] = 0; s.csCavRelief[c] = 0; s.csGQ[c] = 0;
  for(let q=0;q<RP_N;q++) s.csParts[pb+q] = 0;
  for(let g=0;g<6;g++) s.csC[gb+g] = PT.coreBet[gb+g]*n0/(PT.coreLAM[c]*PT.coreLam[gb+g]);
  let d = 0;
  for(let g=0;g<E_DEC_N;g++){ s.csDec[db+g] = E_DEC_A[g]*n0; d += s.csDec[db+g]; }
  s.csDecay[c] = d; s.csHeat[c] = n0*PROMPT_F + d; s.csFQ[c] = s.csHeat[c]*PT.coreRated[c]*1000*(1 - PT.coreGraphQ[c]);
}

/* critical flux shape at the seeded rods, xenon on the node's own flux, and the pin conductances fitted at the rest point */
function eCoreReset(c, flowNet){
  const s = ST, nb = c*XNN, rb = c*XNR, bb = c*PT.nbMax, NB = PT.coreNB[c];
  for(let k=0;k<XNN;k++){ const i = nb + k;
    s.csPhi[i] = 1; s.csXI[i] = eIoEq(c, PT.coreN0[c]); s.csXX[i] = PT.coreX0[c];
    s.csNTc[i] = PT.coreTref[c]; s.csNTct[i] = PT.coreTref[c]; s.csNTf[i] = PT.coreTfRef[c];
    s.csNV[i] = 0; s.csNVt[i] = 0; s.csNRho[i] = 0; s.csNTube[i] = 0; s.csNCov[i] = 0; s.csNFol[i] = 0;
    s.csNDmg[i] = 0; s.csNOx[i] = 0; s.csNOxI[i] = 0; s.csNMelt[i] = 0; s.csNDisp[i] = 0; s.csNDnb[i] = 0; s.csNTg[i] = PT.coreTref[c]; }
  for(let i=0;i<XNR;i++) s.csChW[rb+i] = 1;
  for(let b=0;b<NB;b++){ s.csRodZ[bb+b] = s.csRodPos[c]; s.csRodZDem[bb+b] = s.csRodPos[c]; s.csBankAuto[bb+b] = 1; }
  s.csTubesOpen[c] = 0; s.csCavRelief[c] = 0; s.csGQ[c] = 0;
  s.csTilt[c] = 0; s.csTiltDem[c] = 0; s.csAo[c] = 0; s.csRo[c] = 0; s.csHotRing[c] = 0; s.csHotLev[c] = 0; s.csVNode[c] = 0;
  s.csHotFlow[c] = 1; s.csTipRho[c] = 0; s.csTfHot[c] = PT.coreTfRef[c];
  s.csMeltFrac[c] = 0; s.csOxMax[c] = 0; s.csQOx[c] = 0; s.csFci[c] = 0; s.csTcladHot[c] = PT.coreTref[c];
  s.csDnbrMin[c] = PT.coreDnbr0[c]; s.csDnbrRing[c] = 0; s.csDnbrLev[c] = 0;
  eRodShape(c);
  eCoreStaticRho(c);
  eCoreSolve(c, 60);
  eNodePeak(c); s.csFq[c] = SX.corePeak[0];
  const n0 = PT.coreN0[c];
  for(let k=0;k<XNN;k++){ const fl = n0*s.csPhi[nb+k]; s.csXI[nb+k] = eIoEq(c, fl); s.csXX[nb+k] = eXeEq(c, fl); }
  const film0 = eCorePinFit(c, flowNet); eCoreGraphFit(c);
  const qhat = s.csHeat[c]*PT.coreRated[c]*1000*(1 - PT.coreGraphQ[c])/PT.corePinUA[c];
  for(let k=0;k<XNN;k++){ s.csNTf[nb+k] = s.csNTc[nb+k] + qhat*s.csPhi[nb+k]/film0; s.csNFilm[nb+k] = film0; }
  s.csFQ[c] = qhat*PT.corePinUA[c];
}

/* the pin conductances fitted on the shape the core has; film0 returned */
function eCorePinFit(c, flowNet){
  const nb = c*XNN, phi = ST.csPhi;
  let pk2 = 0; for(let k=0;k<XNN;k++) pk2 += nodeW[k]*phi[nb+k]*phi[nb+k];
  const film0 = Math.pow(Math.max(PT.coreFlowK[c]*(flowNet || 1), .02), 0.8);
  const dTf = Math.max(PT.coreTfRef[c] - PT.coreTref[c], 1);
  PT.corePinUA[c] = PT.coreN0[c]*PT.coreRated[c]*1000*(1 - PT.coreGraphQ[c])*Math.max(pk2, 1e-6)/(film0*dTf*PT.coreCondK[c]);
  const r = clamp(CLAD_DT0/dTf, .01, .6);
  PT.coreGSolid[c] = film0/(1 - r); PT.coreCladR[c] = r;
  return film0;
}
/* kW/K from the blocks to their water, fitted so the hottest block sits graphDT over its own water at the rest point */
function eCoreGraphFit(c){
  const nb = c*XNN, q = PT.coreGraphQ[c];
  let pk = 0; for(let k=0;k<XNN;k++) if(ST.csPhi[nb+k] > pk) pk = ST.csPhi[nb+k];
  PT.coreGUA[c] = q > 0 ? q*PT.coreN0[c]*PT.coreRated[c]*1000*pk/PT.coreGraphDT[c] : 0;
}

function eCoreStaticRho(c){
  const nb = c*XNN, rb = c*XNR, rodA = PT.coreRodA[c], tip = PT.coreTipRho[c], poi = PT.corePoison[c];
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k = nb + i*XNZ + j;
    ST.csNRho[k] = -rodA*ST.csNCov[k] + tip*ST.csNFol[k] - poi*(PT.corePoiG[rb+i] - 1)
                 - PT.coreNPen[rb+i] + PT.coreEnrRho[rb+i]; }
}

function eCoreBanksSeed(c, x0){
  const bb = c*PT.nbMax, NB = PT.coreNB[c];
  let m = 0;
  for(let b=0;b<NB;b++){
    const z = startOf("rodBank:"+b, x0);
    ST.csRodZ[bb+b] = z; ST.csRodZDem[bb+b] = z; ST.csBankAuto[bb+b] = startOf("bankAuto:"+b, false) ? 0 : 1;
    m += z; }
  ST.csRodPos[c] = ST.csRodDem[c] = m/NB;
  ST.csTilt[c] = ST.csTiltDem[c] = startOf("tiltDem", 0);
}

/* E_MN = [clad heat flux as a share of the rated mean, rise, Tin, Tf, gShare, x, dhSub] in, margin out at [7]: per node, so no double crosses as an argument */
const E_MN = new Float64Array(8);
function eMarginNode(c){
  const qs = E_MN[0], rise = E_MN[1], Tin = E_MN[2], Tf = E_MN[3], gShare = E_MN[4], x = E_MN[5], dhSub = E_MN[6];
  const law = PT.coreDnbLaw[c], K = PT.coreDnbrK[c];
  const q = qs*PT.coreRated[c]*1e6/Math.max(PT.coreAHeat[c], 1e-6);
  if(law === E_DNB_BOIL){ E_MN[7] = K*(dhSub/PT.coreCp[c])/Math.max(rise, 1e-3); return; }
  if(law === E_DNB_TEMP){ E_MN[7] = K*Math.max(PT.coreTdmg[c] - Tin, 0)/Math.max(Tf - Tin, 1e-3); return; }
  const pMPa = ST.csPCore[c], g0 = PT.coreG0[c]*gShare, gSI0 = g0 > 1e-3 ? g0 : 1e-3;
  const gFloor = E_W3_GLO*1e6/E_W3_G, gSI = gSI0 > gFloor ? gSI0 : gFloor;
  const p = clamp(pMPa*E_W3_P, E_W3_PLO, E_W3_PHI), g = clamp(gSI*E_W3_G/1e6, E_W3_GLO, E_W3_GHI);
  const de = clamp(PT.coreDh[c]*E_W3_D, E_W3_DLO, E_W3_DHI), xq = clamp(x, E_W3_XLO, E_W3_XHI);
  const hs = Math.max(dhSub, 0)/E_W3_H;
  const w3 = 1e6*E_W3_Q
    *((2.022 - 4.302e-4*p) + (0.1722 - 9.84e-5*p)*Math.exp((18.177 - 4.129e-3*p)*xq))
    *((0.1484 - 1.596*xq + 0.1729*xq*Math.abs(xq))*g + 1.037)
    *(1.157 - 0.869*xq)
    *(0.2664 + 0.8357*Math.exp(-3.151*de))
    *(0.8258 + 7.94e-4*hs);
  let w = w3;
  if(x > E_W3_XHI){ const io = E_CHF; io[0] = pMPa; io[1] = gSI; io[2] = x; io[3] = PT.coreDh[c]; eChfBiasiA(); w = Math.min(w3, io[4]); }
  const Q = q > 1 ? q : 1;
  if(gSI0 >= gFloor){ E_MN[7] = K*w/Q; return; }
  E_CHF[0] = pMPa; eChfZuberA(); const z = E_CHF[4];
  E_MN[7] = K*Math.min(w, z + (w - z)*gSI0/gFloor)/Q;
}
/* E_CHF: [0] MPa, [1] G kg/m2/s, [2] quality, [3] hydraulic diameter m in; [4] CHF W/m2 out; [5..9] scratch */
const E_CHF = new Float64Array(10);
function eChfZuberA(){ const c = SAT_WATER, io = E_CHF;
  io[5] = io[0]; satTA(c, io, 5, 6); const T = io[6];
  curveA(c, CV_RF, io, 6, 7); curveA(c, CV_RG, io, 6, 8); curveA(c, CV_HFG, io, 6, 9);
  const rf = io[7], rg = io[8], t = clamp(1 - T/647.096, 0, 1), sig = 0.2358*Math.pow(t, 1.256)*(1 - 0.625*t);
  io[4] = 0.131*io[9]*1000*Math.sqrt(rg)*Math.pow(sig*9.81*Math.max(rf - rg, 1e-3), 0.25); }
function eChfBiasiA(){ const io = E_CHF, pMPa = io[0], gSI = io[1], x = io[2], dhM = io[3];
  const Dc = dhM*100, G = Math.max(gSI, 1)/10, Pb = pMPa*10;
  const Dn = Math.pow(Dc, Dc >= 1 ? 0.4 : 0.6), g6 = Math.pow(G, 1/6);
  const F = 0.7249 + 0.099*Pb*Math.exp(-0.032*Pb);
  const H = -1.159 + 0.149*Pb*Math.exp(-0.019*Pb) + 8.99*Pb/(10 + Pb*Pb);
  const q1 = 1.883e3/(Dn*g6)*(F/g6 - x), q2 = 3.78e3*H*(1 - x)/(Dn*Math.pow(G, 0.6));
  io[4] = Math.max(q1, q2, 0)*1e4; }

/* one nodal pass: channel split, pin balance, clad, oxidation, melt, burst, xenon, feedback; writes SX.coreO */
/* E_CS in: [0] dt, [1] heat, [2] T sat, [3] vessel void, [4] mass flux, [5] flow fraction, [6] inlet h */
const E_CS = new Float64Array(7), E_RV = new Float64Array(5), E_CMX = new Float64Array(MX_N), E_GCP = new Float64Array(2);
/* E_CQW[0]: kW core c hands its water: what leaves the pins, what the blocks give up, less the skin, plus what a melt quenched */
const E_CQW = new Float64Array(1);
function eCoreQWaterA(c){ const a = PT.corePart[c];
  E_CQW[0] = ST.csFQ[c] + ST.csGQ[c] - (a >= 0 ? ST.skinQ[a] : 0) + ST.csFci[c]; }
const eCoreQWater = c => { eCoreQWaterA(c); return E_CQW[0]; };
/* E_CW: core c's water over every node it heats: [0] kg (NaN if any is unset), [1] m3, [2] mean MPa (NaN if none has one) */
const E_CW = new Float64Array(3);
function eCoreWaterA(c){
  let m = 0, v = 0, p = 0, np = 0;
  for(let j=PT.coreLoop0[c];j<PT.coreLoop0[c+1];j++){ const i = PT.coreLoopNode[j], pi = ST.pBy[i];
    m += ST.mBy[i]; v += PT.nodeVol[i];
    if(pi === pi){ p += pi; np++; } }
  E_CW[0] = PT.coreLoop0[c+1] > PT.coreLoop0[c] ? m : E_NAN; E_CW[1] = v; E_CW[2] = np ? p/np : E_NAN;
}
function eCoreStep(c){
  const dt = E_CS[0], heat = E_CS[1], sat = E_CS[2], vLeak = E_CS[3], mflux = E_CS[4], flowFrac = E_CS[5], hIn = E_CS[6];
  const s = ST, T = PT, nb = c*XNN, rb = c*XNR, S0 = T.coreSat[c], pCore = s.csPCore[c];
  E_RV[0] = pCore; satRvlA(S0, E_RV, 0, 1);
  const rvl = E_RV[1];
  { const rq = 1/Math.max(rvl, 1e-6) - 1; let tot = 0;
    for(let i=0;i<XNR;i++){
      let x = 0; for(let j=0;j<XNZ;j++){ E_VQ[0] = s.csNV[nb+i*XNZ+j]; E_VQ[1] = rvl; eVoidQualA(); x += E_VQ[2]; }
      s.csChW[rb+i] = 1/Math.sqrt(1 + rq*(x/XNZ));
      tot += s.csChW[rb+i]*ringW[i]; }
    for(let i=0;i<XNR;i++) s.csChW[rb+i] /= Math.max(tot, 1e-6); }
  eRodShape(c);
  const mixK = SX.coreMixK, mix = T.coreMix[c], dT0 = T.coreDT0[c], riseH = T.coreRiseH[c];
  { let raw = 0;
    for(let i=0;i<XNR;i++){
      let ringP = 0; for(let j=0;j<XNZ;j++) ringP += s.csPhi[nb+i*XNZ+j];
      ringP = Math.max(ringP/XNZ, 1e-6);
      mixK[i] = (1 + (ringP - 1)*(1 - mix))/ringP;
      raw += ringW[i]*heat*dT0*ringP*mixK[i]/Math.max(flowFrac, 1e-3); }
    s.csCoreDT[c] = Math.max(0, Math.min(T.coreDTMax[c], raw)); }
  const cp = T.coreCp[c], Tcold = hIn/cp, rated = T.coreRated[c], pinUA = Math.max(T.corePinUA[c], 1e-9);
  const aHeat = T.coreAHeat[c], qhat = heat*rated*1000/pinUA, qpp0 = rated*1e6/Math.max(aHeat, 1e-6);
  const ff = Math.max(flowFrac, 1e-3), hSat = cp*sat, hfg = T.coreHfg[c], dhSub = cp*(sat - Tcold);
  const gSolid = T.coreGSolid[c], cladR = T.coreCladR[c], filmPool = T.coreFilmPool[c], tauF = eXTauF(c);
  const xSub = T.coreXSub[c], xSubLo = T.coreXSubLo[c], tmelt = T.coreTmelt[c], oxid = T.coreOxid[c];
  const gI = T.coreGI[c], gX = T.coreGX[c], lamI = T.coreLamI[c], lamX = T.coreLamX[c], sig = T.coreSig[c];
  const aF = T.coreAF[c], aM = T.coreAM[c], aX = T.coreAX[c], aS = T.coreAS[c], aV = T.coreAV[c], KXE = T.coreKXE[c];
  const TfRef = T.coreTfRef[c], Tref = T.coreTref[c], rodA = T.coreRodA[c], tipRho = T.coreTipRho[c], poison = T.corePoison[c];
  const n = s.csN[c], bare = 1 - Math.max(0, Math.min(1, vLeak)), dryout = T.coreDryout[c];
  const gq = T.coreGraphQ[c], gUA = T.coreGUA[c], gKg = T.coreGraphKg[c], aG = T.coreAG[c], TgRef = T.coreTgRef[c], rk = rated*1000;
  let gOut = 0, fOut = 0;
  let dnbLo = 1e30, dnbK = 0, TclH = 0, ecrH = 0, h2 = 0, oxP = 0, fciE = 0;
  const disK = SX.coreDisK;
  for(let k=0;k<XNN;k++) disK[k] = 0;
  for(let i=0;i<XNR;i++){
    const chan = Math.max(s.csChW[rb+i], 1e-3);
    const dhu = riseH*mixK[i]/(XNZ*ff*chan);
    const film0 = Math.max(Math.pow(Math.max(mflux*chan, 0), 0.8), filmPool);
    const gCh = Math.max(mflux*chan, 1e-3);
    let h = hIn;
    for(let j=0;j<XNZ;j++){
      const q = i*XNZ + j, k = nb + q, pw = s.csPhi[k];
      /* the blocks stop gq of the node's fission heat and hand it to the water through their own conductance */
      const gw = gUA*nodeW[q], gin = gq*heat*pw*rk*nodeW[q];
      if(gw > 0 && !(dt > 0)) s.csNTg[k] = s.csNTc[k] + gin/gw;
      const gx = gw > 0 ? gw*(s.csNTg[k] - s.csNTc[k]) : gin;
      if(gw > 0 && dt > 0){ E_GCP[0] = s.csNTg[k]; graphCpA(E_GCP, 0, 1); s.csNTg[k] += (gin - gx)*dt/(gKg*nodeW[q]*E_GCP[1]); }
      gOut += gx;
      const qPin = qhat*pw*(1 - gq)*(1 - s.csNDisp[k]);
      const out = dt > 0 ? s.csNFilm[k]*(s.csNTf[k] - s.csNTc[k]) : qPin, qw = out*pinUA/rk;
      fOut += out*nodeW[q];
      const dh = dhu*(qw + gx/(rk*nodeW[q])), hMid = h + dh/2; h += dh;
      s.csNTct[k] = hMid <= hSat ? hMid/cp : sat;
      const q2 = Math.max(qw, 0);
      const xd = -Math.max(Math.min(xSub*q2/gCh, xSubLo*q2), 1e-6);
      const xe = (hMid - hSat)/hfg;
      E_VQ[0] = xe; E_VQ[1] = xd; eSubQualA(); E_VQ[0] = E_VQ[2]; E_VQ[1] = rvl; eDriftFluxA();
      s.csNVt[k] = E_VQ[2];
      E_MN[0] = q2; E_MN[1] = hMid/cp - Tcold; E_MN[2] = Tcold; E_MN[3] = s.csNTf[k];
      E_MN[4] = mflux*chan; E_MN[5] = xe; E_MN[6] = dhSub; eMarginNode(c);
      const dnb = E_MN[7];
      if(dnb < dnbLo){ dnbLo = dnb; dnbK = q; }
      const hCsp = film0*bare/cladR;
      const hCnb = Math.max(out, 0)*bare/Math.max(sat + JL_K*Math.pow(Math.max(qpp0*q2, 1)/1e6, 0.25)*Math.exp(-pCore/JL_P) - s.csNTc[k], 1e-3);
      const hCw = Math.max(hCsp, hCnb);
      const TclNB = s.csNTc[k] + (s.csNTf[k] - s.csNTc[k])*gSolid/(gSolid + hCw);
      s.csNDnb[k] = !dryout ? 0 : dnb < 1 ? 1 : (s.csNDnb[k] && TclNB - sat > E_DT_LEID) ? 1 : 0;
      const hC = s.csNDnb[k] ? hCsp*E_DNB_FILM : hCw;
      const film = gSolid*hC/Math.max(gSolid + hC, 1e-12);
      const Tcl = s.csNTc[k] + (s.csNTf[k] - s.csNTc[k])*gSolid/(gSolid + hC);
      if(Tcl > TclH) TclH = Tcl;
      let qOx = 0;
      const burst = s.csNDmg[k];
      if(dt > 0 && oxid && Tcl > E_OX_T0 && s.csNV[k] > E_OX_VMIN){
        const o0 = s.csNOx[k], i0 = s.csNOxI[k], f0 = (o0 + burst*i0)/(ZR_PBR*ROD_CLAD);
        if(f0 < 1){
          E_OXR[0] = Tcl; eOxRateA(); const r = E_OXR[1]*dt;
          let dO = Math.sqrt(o0*o0 + r) - o0, dI = burst > 0 ? Math.sqrt(i0*i0 + r) - i0 : 0;
          const f1 = f0 + (dO + burst*dI)/(ZR_PBR*ROD_CLAD);
          if(f1 > 1){ const w = (1 - f0)/(f1 - f0); dO *= w; dI *= w; }
          s.csNOx[k] = o0 + dO; s.csNOxI[k] = i0 + dI;
          const dm = ZR_RHO*(dO + burst*dI)/ZR_PBR*aHeat*nodeW[q];
          h2 += ZR_H2*dm;
          qOx = ZR_QOX*dm/(1000*dt*nodeW[q]*pinUA); } }
      eEcrA(k); if(E_CR[0] > ecrH) ecrH = E_CR[0];
      oxP += qOx*nodeW[q];
      let Tn = dt > 0 ? s.csNTf[k] + (qPin + qOx - out)*dt/tauF
                      : s.csNTc[k] + qPin/Math.max(film, 1e-9);
      s.csNFilm[k] = film;
      if(Tn > tmelt && s.csNDmg[k] >= 1 && s.csNMelt[k] + s.csNDisp[k] < 1){
        const room = (1 - s.csNMelt[k] - s.csNDisp[k])*E_FUSE_DT, paid = Math.min(Tn - tmelt, room);
        s.csNMelt[k] = Math.min(1, s.csNMelt[k] + paid/E_FUSE_DT);
        Tn = tmelt + (Tn - tmelt - paid); }
      if(dt > 0){
        const hF = E_FUEL_CP*(Tn - E_T_STP) + s.csNMelt[k]*E_FUSE_KJ;
        if(hF > E_DISP_H){ s.csNDisp[k] = Math.max(s.csNDisp[k], Math.max(0, Math.min(1, (hF - E_DISP_H)/E_DISP_SPAN)));
          s.csNDmg[k] = Math.max(s.csNDmg[k], s.csNDisp[k]); }
        const fr = Math.max(s.csNDisp[k], s.csNMelt[k])*(1 - Math.max(0, Math.min(1, s.csNV[k])));
        if(fr > 0 && Tn > s.csNTc[k]){
          const dT = (Tn - s.csNTc[k])*Math.min(1, fr*E_FCI_ETA*(1 - Math.exp(-dt/E_FCI_TAU)));
          Tn -= dT; fciE += dT*nodeW[q]; } }
      s.csNTf[k] = Math.max(0, Math.min(6000, Tn));
      eEcrA(k);
      if(E_CR[0] >= 1) s.csNDmg[k] = 1;
      else {
        E_CR[1] = E_P_FILL*Tcl/E_T_FILL - pCore; eBurstTA(c); const tb = E_CR[2];
        if(Tcl > tb) s.csNDmg[k] = Math.min(1, s.csNDmg[k] + Math.max(0, Math.min(1, (Tcl - tb)/E_BURST_SPAN))*dt/E_BURST_TAU); }
      const fl = n*pw;
      s.csXI[k] = Math.max(0, s.csXI[k] + (gI*fl - lamI*s.csXI[k])*dt);
      s.csXX[k] = Math.max(0, s.csXX[k] + (gX*fl + lamI*s.csXI[k] - lamX*s.csXX[k] - sig*fl*s.csXX[k])*dt);
      const rI = Math.max(-6000, Math.min(3000, aF*(s.csNTf[k] - TfRef)))
               + Math.max(-6000, Math.min(2500, aM*(s.csNTc[k] - Tref)))
               + Math.max(-6000, Math.min(2500, aX*(s.csNTf[k] - TfRef) + aS*(s.csNTc[k] - Tref)))
               + Math.max(-6000, Math.min(2500, aG*(s.csNTg[k] - TgRef)))
               + aV*s.csNV[k] - KXE*s.csXX[k]
               - rodA*s.csNCov[k] + tipRho*s.csNFol[k]
               - poison*(T.corePoiG[rb+i] - 1)
               - T.coreNPen[rb+i] + T.coreEnrRho[rb+i];
      disK[q] = -s.csNDisp[k]*(1e5 + rI);
      s.csNRho[k] = rI + disK[q];
    }
  }
  { eCoreWaterA(c); const m = E_CW[0], V = E_CW[1];
    let rhoIn;
    if(m === m && V > 0 && m > 0) rhoIn = m/V;
    else { const io = E_CMX; io[MX_T] = Tcold; io[MX_P] = pCore; hOfTPA(S0, io, MX_T, MX_P, MX_H); mixA(S0, io); rhoIn = io[MX_RHO]; }
    const v = Math.max(mflux, 1e-3)*T.coreG0[c]/Math.max(rhoIn, 1);
    const tau = Math.max(0.1, Math.min(60, Math.max(T.coreCoreHgt[c], .05)/Math.max(v, 1e-3)));
    for(let q=0;q<XNN;q++){ const k = nb + q;
      const vT = Math.max(0, Math.min(1, Math.max(s.csNVt[k], vLeak)));
      s.csNV[k] += (vT - s.csNV[k])*dt/tau;
      s.csNTc[k] += (s.csNTct[k] - s.csNTc[k])*dt/tau; } }
  s.csGQ[c] = gOut; s.csFQ[c] = fOut*pinUA;
  eCoreSolve(c, SOR_SWEEPS);
  const o = SX.coreO;
  for(let q=0;q<E_CO_N;q++) o[q] = 0;
  let X = 0, I = 0, V = 0, Tf = 0, TfH = 0, top = 0, bot = 0, inn = 0, out = 0, W2 = 0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const q = i*XNZ + j, k = nb + q, v = nodeW[q], w = v*s.csPhi[k], w2 = w*s.csPhi[k];
    o[E_CO_DOP] += w2*Math.max(-6000, Math.min(3000, aF*(s.csNTf[k] - TfRef)));
    o[E_CO_MOD] += w2*Math.max(-6000, Math.min(2500, aM*(s.csNTc[k] - Tref)));
    o[E_CO_EXP] += w2*Math.max(-6000, Math.min(2500, aX*(s.csNTf[k] - TfRef) + aS*(s.csNTc[k] - Tref)));
    o[E_CO_VD] += w2*aV*s.csNV[k];
    o[E_CO_GR] += w2*Math.max(-6000, Math.min(2500, aG*(s.csNTg[k] - TgRef)));
    o[E_CO_XE] += w2*-KXE*s.csXX[k];
    o[E_CO_ROD] += w2*-rodA*s.csNCov[k];
    o[E_CO_TIP] += w2*tipRho*s.csNFol[k];
    o[E_CO_DIS] += w2*disK[q];
    W2 += w2;
    X += v*s.csXX[k]; I += v*s.csXI[k]; V += v*s.csNV[k]; Tf += w*s.csNTf[k];
    if(s.csNTf[k] > TfH) TfH = s.csNTf[k];
    if(j >= XNZ/2) top += w; else bot += w;
    if(i < XNR/2) inn += w; else out += w; }
  if(W2 > 0) for(let q=0;q<=E_CO_GR;q++) o[q] /= W2;
  eNodePeak(c);
  const pk = SX.corePeak;
  s.csFq[c] = pk[0]; s.csHotRing[c] = pk[2]; s.csHotLev[c] = pk[3];
  s.csAo[c] = (top - bot)/Math.max(top + bot, 1e-6);
  s.csRo[c] = (inn - out)/Math.max(inn + out, 1e-6);
  s.csX[c] = X; s.csI[c] = I; s.csTf[c] = Tf; s.csTfHot[c] = TfH; s.csVNode[c] = V; s.csTipRho[c] = o[E_CO_TIP];
  s.csHotFlow[c] = Math.max(mflux*s.csChW[rb + pk[2]], 0.02);
  let dm = 0, mf = 0;
  for(let q=0;q<XNN;q++){ dm += nodeW[q]*s.csNDmg[nb+q]; mf += nodeW[q]*s.csNMelt[nb+q]; }
  s.csDmg[c] = Math.min(100, 100*dm); s.csMeltFrac[c] = mf;
  o[E_CO_H2] = h2; s.csOxMax[c] = ecrH; s.csTcladHot[c] = TclH;
  o[E_CO_FCI] = dt > 0 ? fciE*tauF*pinUA/dt : 0;
  s.csQOx[c] = oxP*pinUA/Math.max(rated*1000, 1e-9);
  s.csDnbrMin[c] = dnbLo; s.csDnbrRing[c] = (dnbK/XNZ)|0; s.csDnbrLev[c] = dnbK%XNZ;
}

function eCoreAgg(){
  const s = ST, sc = s.sc, n = PT.n.core, ND = E_DEC_N;
  let R = 0; for(let c=0;c<n;c++) R += PT.coreRated[c];
  for(let g=0;g<ND;g++) s.dec[g] = 0;
  let N = 0, dec = 0, dmg = 0, mf = 0, Tf = -E_INF, dnbr = E_INF, vf = 0, ox = 0, qOx = 0, fat = 0;
  let scr = 0, brk = 0, melt = 0, trip = E_TRIP_NONE, tripArg = -1;
  for(let c=0;c<n;c++){
    const w = R > 0 ? PT.coreRated[c]/R : 0;
    N += w*s.csN[c]; dec += w*s.csDecay[c]; dmg += w*s.csDmg[c]; mf += w*s.csMeltFrac[c];
    for(let g=0;g<ND;g++) s.dec[g] += w*s.csDec[c*ND+g];
    if(s.csTf[c] > Tf) Tf = s.csTf[c];
    if(s.csDnbr[c] < dnbr) dnbr = s.csDnbr[c];
    if(s.csVf[c] > vf) vf = s.csVf[c];
    if(s.csOxMax[c] > ox) ox = s.csOxMax[c];
    if(s.csQOx[c] > qOx) qOx = s.csQOx[c];
    if(s.csFatigue[c] > fat) fat = s.csFatigue[c];
    if(s.csScrammed[c]) scr = 1;
    if(s.csBreach[c]) brk = 1;
    if(s.csMelt[c]) melt = 1;
    if(trip === E_TRIP_NONE && s.csTrip[c] !== E_TRIP_NONE){ trip = s.csTrip[c]; tripArg = s.csTripArg[c]; } }
  const any = n > 0;
  sc[SC_N] = any ? N : 1e-9; sc[SC_DECAY] = dec; sc[SC_HEAT] = sc[SC_N]*PROMPT_F + dec;
  sc[SC_DMG] = dmg; sc[SC_MELTFRAC] = mf;
  sc[SC_TF] = any ? Tf : PK[PK_TFREF]; sc[SC_DNBR] = any ? dnbr : PK[PK_DNBR0]; sc[SC_VF] = vf;
  sc[SC_OXMAX] = ox; sc[SC_QOX] = qOx; sc[SC_FATIGUE] = fat;
  sc[SC_SCRAMMED] = scr; sc[SC_BREACH] = brk; sc[SC_MELT] = melt; sc[SC_TRIP] = trip; sc[SC_TRIPARG] = tripArg;
  if(!any) return;
  sc[SC_RODPOS] = s.csRodPos[0]; sc[SC_RODDEM] = s.csRodDem[0]; sc[SC_RODJAM] = s.csRodJam[0]; sc[SC_RODBAND] = s.csRodBand[0];
  sc[SC_SPLIT] = s.csSplit[0]; sc[SC_REGANG] = s.csReGang[0]; sc[SC_TILT] = s.csTilt[0]; sc[SC_TILTDEM] = s.csTiltDem[0];
  sc[SC_RHO] = s.csRho[0]; sc[SC_FQ] = s.csFq[0]; sc[SC_AO] = s.csAo[0]; sc[SC_RO] = s.csRo[0];
  sc[SC_X] = s.csX[0]; sc[SC_I] = s.csI[0]; sc[SC_PCORE] = s.csPCore[0]; sc[SC_COREDT] = s.csCoreDT[0];
  sc[SC_VOIDTH] = s.csVoidTh[0]; sc[SC_TFHOT] = s.csTfHot[0];
  for(let q=0;q<RP_N;q++) s.parts[q] = s.csParts[q];
}

/* a clamp that bit, with T-avg off programme, is a controller out of authority */
function eRodPinned(c){ eTavgA(PT.coreCirc[c]); const t = E_TA[0]; eTProgA(c); if(Math.abs(t - E_CT[2]) > 0.5) ST.csRodBand[c] = 1; }
/* the built-in law and a wired ROD DRIVE share this door; the step is capped at what the drive does in a tick */
/* E_SV[0]: the value a sink is driven with */
const E_SV = new Float64Array(1);
function eRodApply(c, dt){
  const s = ST, r = PT.coreRodRate[c], rodErr = clamp(E_SV[0], -r*dt, r*dt);
  const lo = clamp(s.sc[SC_ARLO], 0, 1), hi = clamp(Math.max(s.sc[SC_ARHI], s.sc[SC_ARLO]), 0, 1);
  s.csRodBand[c] = 0;
  if(!s.csSplit[c] && eBankAutoLive(c, 0)){
    const want = s.csRodDem[c] + rodErr;
    s.csRodDem[c] = clamp(want, lo, hi);
    if(Math.abs(want - s.csRodDem[c]) > 1e-9) eRodPinned(c);
  } else if(s.csSplit[c] && !s.csReGang[c]){
    const bb = c*PT.nbMax, NB = PT.coreNB[c];
    for(let b=0;b<NB;b++) if(eBankAutoLive(c, b)){
      const want = s.csRodZDem[bb+b] + rodErr;
      s.csRodZDem[bb+b] = clamp(want, lo, hi);
      if(Math.abs(want - s.csRodZDem[bb+b]) > 1e-9) eRodPinned(c); }
  }
}

function eRodCommon(c, v){
  const s = ST, bb = c*PT.nbMax, NB = PT.coreNB[c];
  if(s.csSplit[c] && !s.csReGang[c]){
    const d = v - s.csRodDem[c]; let m = 0;
    for(let b=0;b<NB;b++){ s.csRodZDem[bb+b] = clamp(s.csRodZDem[bb+b] + d, 0, 1); m += s.csRodZDem[bb+b]; }
    s.csRodDem[c] = m/NB;
  } else s.csRodDem[c] = clamp(v, 0, 1);
}

/* returns the event raised, EV_NONE if the order changed nothing */
function eSetSplit(c, on){
  const s = ST, bb = c*PT.nbMax, NB = PT.coreNB[c];
  if(on && !s.csSplit[c]){
    for(let b=0;b<NB;b++) s.csRodZDem[bb+b] = s.csRodZ[bb+b];
    s.csSplit[c] = 1; s.csReGang[c] = 0;
    return EV_BANKS_SPLIT; }
  if(!on && s.csSplit[c] && !s.csReGang[c]){
    let m = 0; for(let b=0;b<NB;b++) m += s.csRodZ[bb+b];
    s.csRodPos[c] = s.csRodDem[c] = m/NB;
    s.csReGang[c] = 1;
    return EV_BANKS_GANGING; }
  return EV_NONE;
}

function eScram(c, code, arg){
  const s = ST;
  s.csScrammed[c] = 1; s.csRodDem[c] = 1; s.csTrip[c] = code; s.csTripArg[c] = arg;
  const a = PT.coreRodsPart[c];
  if(a < 0 || !s.dmgBy[a]) s.csRodJam[c] = 0;
}
/* the SCRAM sink: a delay of PK[PK_RPSLAG] on continuous demand, reset the instant the channel clears */
function eScramSink(c, dt, blameBlock){
  const s = ST, hot = E_SV[0] > 0.5;
  s.csRpsHot[c] = hot ? s.csRpsHot[c] + dt : 0;
  if(hot && !s.csScrammed[c] && s.csRpsHot[c] >= PK[PK_RPSLAG] - dt*0.5)
    eScram(c, blameBlock >= 0 ? E_TRIP_RPS : E_TRIP_AUTO, blameBlock);
}
const eNearTrip = c => { ST.csRpsNear[c] = E_SV[0] > 0.5 ? 1 : 0; };
function eTripReset(){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){ s.csScrammed[c] = 0; s.csTrip[c] = E_TRIP_NONE; s.csTripArg[c] = -1; }
  s.sc[SC_SCRAMMED] = 0; s.sc[SC_TRIP] = E_TRIP_NONE; s.sc[SC_TRIPARG] = -1;
}

function eCoreRodStep(dt){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){
    const bb = c*PT.nbMax, NB = PT.coreNB[c];
    if(!eRodDriven(c)) s.csRodBand[c] = 0;
    if(s.csReGang[c]){
      let done = true;
      for(let b=0;b<NB;b++){
        s.csRodZDem[bb+b] = clamp(s.csRodDem[c] + PT.coreBankW[bb+b]*XTILTZ*s.csTilt[c], 0, 1);
        if(Math.abs(s.csRodZ[bb+b] - s.csRodZDem[bb+b]) > 1e-6) done = false; }
      if(done){ s.csSplit[c] = 0; s.csReGang[c] = 0; } }
    if(s.csScrammed[c]){ s.csRodDem[c] = 1; for(let b=0;b<NB;b++) s.csRodZDem[bb+b] = 1; }
    if(!s.csRodJam[c]){
      const r = s.csScrammed[c] ? PT.coreScram[c] : PT.coreRodRate[c];
      if(s.csSplit[c]) for(let b=0;b<NB;b++){ const d = s.csRodZDem[bb+b] - s.csRodZ[bb+b];
        s.csRodZ[bb+b] += Math.sign(d)*Math.min(Math.abs(d), r*dt); }
      else { const d = s.csRodDem[c] - s.csRodPos[c];
        s.csRodPos[c] += Math.sign(d)*Math.min(Math.abs(d), r*dt); }
      if(!s.csSplit[c]){ const d = s.csTiltDem[c] - s.csTilt[c], tr = PT.coreRodRate[c]/XTILTZ;
        s.csTilt[c] += Math.sign(d)*Math.min(Math.abs(d), tr*dt); } }
    eRodBanks(c);
    if(s.csSplit[c]){
      let m = 0; for(let b=0;b<NB;b++) m += s.csRodZ[bb+b];
      s.csRodPos[c] = m/NB;
      if(!s.csReGang[c]){ let d = 0; for(let b=0;b<NB;b++) d += s.csRodZDem[bb+b]; s.csRodDem[c] = d/NB; } }
  }
}

/* the charging system reaches what the core reaches: every node in a live piece holding a core takes the same step */
function eBoronFollow(dt){
  const sc = ST.sc, db = sc[SC_BORONDEM] - sc[SC_BORON], rb = (db < 0 ? E_BOR_IN : E_BOR_OUT)*dt;
  const d = Math.sign(db)*Math.min(Math.abs(db), rb);
  sc[SC_BORON] += d;
  if(d === 0) return;
  const nn = PT.n.node;
  for(let i=0;i<nn;i++) if(eNodeInCorePiece(i)) ST.bBy[i] += d;
}

function eCoreDecayStep(dt){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){
    const db = c*E_DEC_N; let d = 0;
    for(let g=0;g<E_DEC_N;g++){
      const l = E_DEC_L[g], x = l*dt;
      /* exact over the tick: the fast group's l*dt is not small against 1 */
      const e = Math.exp(-x);
      s.csDec[db+g] = E_DEC_A[g]*s.csN[c] + (s.csDec[db+g] - E_DEC_A[g]*s.csN[c])*e;
      d += s.csDec[db+g]; }
    s.csDecay[c] = d; s.csHeat[c] = s.csN[c]*PROMPT_F + d; }
}

function eCoreFlowRead(){
  const n = PT.n.core;
  for(let c=0;c<n;c++){ const ref = PT.coreNetRef[c];
    SX.coreFN[c] = ref > 0 ? eNetCoreKg(c)/ref : E_TK[E_TK_FLOW]; }
}
const eCoreFlowSet = () => { const n = PT.n.core; for(let c=0;c<n;c++) ST.csFlowNet[c] = SX.coreFN[c]; };

function eCorePRead(){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){ eCoreWaterA(c); const p = E_CW[2];
    s.csPCore[c] = p === p ? p : s.sc[SC_P]; }
  s.sc[SC_PCORE] = n > 0 ? s.csPCore[0] : s.sc[SC_P];
}

/* the primary injection rate is ST.sc[SC_INJRATE] */
const eCoreFatigueStep = dt => { const n = PT.n.core, inj = ST.sc[SC_INJRATE];
  for(let c=0;c<n;c++) ST.csFatigue[c] += 0.35*dt*clamp(inj/1.6, 0, 2); };

function eCoreBurstStep(){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){
    eBurstPA(c); const burst = E_BUR[0];
    if(PT.coreTube[c]){ eTubeStep(c); continue; }
    if(!s.csBreach[c] && s.csPCore[c] > burst){ s.csBreach[c] = 1; s.csTrip[c] = E_TRIP_VESSEL; s.csTripArg[c] = -1;
      eEvent(EV_VESSEL_RUPTURE, c, s.csPCore[c]); } }
}

/* the burst pressure in E_BUR[0] */
function eTubeStep(c){
  const burst = E_BUR[0];
  const s = ST, nb = c*XNN;
  let opened = 0;
  for(let i=0;i<XNR;i++){ if(s.csNTube[nb+i*XNZ] > 0) continue;
    let go = false;
    for(let j=0;j<XNZ;j++){ E_BUR[1] = s.csNTc[nb+i*XNZ+j]; eZrKA(); if(s.csPCore[c] > burst*E_BUR[2]){ go = true; break; } }
    if(!go) continue;
    for(let j=0;j<XNZ;j++) s.csNTube[nb+i*XNZ+j] = 1;
    opened++; }
  if(opened){ let f = 0; for(let k=0;k<XNN;k++) f += nodeW[k]*s.csNTube[nb+k];
    s.csTubesOpen[c] = f;
    if(s.csTrip[c] === E_TRIP_NONE){ s.csTrip[c] = E_TRIP_CHANNEL; s.csTripArg[c] = -1; }
    eEvent(EV_TUBE_RUPTURE, c, f); }
  eNetCavGaugeA(c); const gauge = E_CGG[0], lift = PT.coreShieldLift[c];
  if(gauge !== gauge) return;
  if(gauge > lift*CAV_LIFT_K) s.csCavRelief[c] = 1;
  else if(gauge < lift*CAV_LIFT_K*CAV_RESEAT_K) s.csCavRelief[c] = 0;
  if(s.csBreach[c] || !(gauge > lift)) return;
  s.csBreach[c] = 1; s.csTrip[c] = E_TRIP_SHIELD; s.csTripArg[c] = -1;
  eEvent(EV_SHIELD_LIFTED, c, gauge);
  if(PT.corePart[c] < 0) return;
  const kPa = lift*1000, x = PT.coreBox[c*4], y = PT.coreBox[c*4+1], w = PT.coreBox[c*4+2], h = PT.coreBox[c*4+3];
  for(let X=x-1;X<=x+w;X++) for(let Y=y-1;Y<=y+h;Y++)
    if(X >= 0 && X < GW && Y >= 0 && Y < GH){ E_RR[RR_BANG] = kPa*T_HULL*ROOM_CVAIR/ROOM_P0; eRoomBang(Y*GW + X); }
  s.sc[SC_ROOMBANG] = Math.max(s.sc[SC_ROOMBANG], kPa);
}

/* the core boils at its own pressure; vLeak is the vessel's shortfall of water, never the node's own quality */
function eCoreVesselStep(dt){
  const s = ST, n = PT.n.core;
  for(let c=0;c<n;c++){
    const S0 = PT.coreSat[c], pc = s.csPCore[c], rv = E_RV;
    rv[0] = pc; satTA(S0, rv, 0, 1);
    const sat = rv[1];
    eCoreWaterA(c); const m = E_CW[0], kg0 = PT.coreKg0[c];
    let vLeak = 0;
    if(kg0 > 0 && m === m && !PT.coreGas[c]){ satRvlA(S0, rv, 0, 2); vLeak = Math.max(0, (1 - m/kg0)/Math.max(1 - rv[2], 1e-3)); }
    const cs = E_CS;
    cs[0] = dt; cs[1] = s.csHeat[c]; cs[2] = sat; cs[3] = vLeak; cs[4] = PT.coreFlowK[c]*SX.coreFN[c];
    cs[5] = Math.max(s.csFlowNet[c], E_CORE_DT_QMIN); eNetCoreInHA(c); cs[6] = E_CIH[0];
    eCoreStep(c);
    const o = SX.coreO;
    s.csFci[c] = o[E_CO_FCI];
    if(o[E_CO_H2] > 0 && m > DRY_MIN_KG){ const j0 = PT.coreLoop0[c], j1 = PT.coreLoop0[c+1];
      for(let j=j0;j<j1;j++){ const i = PT.coreLoopNode[j], mi = s.mBy[i];
        if(mi > DRY_MIN_KG/(j1 - j0)) s.h2By[i] += o[E_CO_H2]/(j1 - j0)/mi; } }
    s.csVoidTh[c] = s.csVNode[c];
    s.csVf[c] = Math.max(0, Math.min(1.6, Math.max(vLeak, s.csVoidTh[c])));
    const pb = c*RP_N;
    s.csParts[pb+RP_ROD] = o[E_CO_ROD]; s.csParts[pb+RP_DOP] = o[E_CO_DOP]; s.csParts[pb+RP_MOD] = o[E_CO_MOD];
    s.csParts[pb+RP_EXP] = o[E_CO_EXP]; s.csParts[pb+RP_XE] = o[E_CO_XE]; s.csParts[pb+RP_VD] = o[E_CO_VD];
    s.csParts[pb+RP_TIP] = o[E_CO_TIP]; s.csParts[pb+RP_GR] = o[E_CO_GR]; s.csParts[pb+RP_DIS] = o[E_CO_DIS]; s.csParts[pb+RP_BOR] = PT.coreNode[c] >= 0 && s.bBy[PT.coreNode[c]] === s.bBy[PT.coreNode[c]] ? s.bBy[PT.coreNode[c]] : s.sc[SC_BORON];
    let r = PT.coreExcess[c];
    for(let q=0;q<RP_N;q++) r += s.csParts[pb+q];
    s.csRho[c] = r; }
}

/* implicit in n and the precursors, four substeps a tick */
function eCoreKineticsStep(dt){
  const s = ST, nc = PT.n.core, h = dt/4;
  for(let c=0;c<nc;c++){
    const gb = c*6, rk = s.csRho[c]*1e-5, B = PT.coreBETA[c], L = PT.coreLAM[c];
    for(let q=0;q<4;q++){
      let num = 0, den = 0;
      for(let g=0;g<6;g++){ const l = PT.coreLam[gb+g], dd = 1 + h*l;
        num += l*s.csC[gb+g]/dd; den += l*h*PT.coreBet[gb+g]/L/dd; }
      const a = 1 - h*(rk - B)/L - h*den;
      let n = a > 1e-6 ? (s.csN[c] + h*num + h*2e-9)/a : s.csN[c]*12;
      if(!isFinite(n) || n < 0) n = s.csN[c]*12;
      s.csN[c] = Math.min(n, 60);
      for(let g=0;g<6;g++) s.csC[gb+g] = (s.csC[gb+g] + h*PT.coreBet[gb+g]/L*s.csN[c])/(1 + h*PT.coreLam[gb+g]); }
    s.csN[c] = Math.max(s.csN[c], 1e-9);
    s.csDnbr[c] = s.csDnbrMin[c]; }
}

function eCoreMeltStep(dt){
  const s = ST, nc = PT.n.core, st = SX.coreStage;
  for(let c=0;c<nc;c++){
    if(!s.csMelt[c] && s.csMeltFrac[c] >= E_MELT_LATCH){ s.csMelt[c] = 1; s.csTrip[c] = E_TRIP_MELT; s.csTripArg[c] = -1;
      eEvent(EV_CORE_MELT, c, s.csMeltFrac[c]); }
    if(s.csMeltFrac[c] > 0 && !P.catcher){
      const want = E_MELT_INV*s.csMeltFrac[c]*dt/100*PK[PK_INVKG0], j0 = PT.coreLoop0[c], j1 = PT.coreLoop0[c+1];
      for(let j=j0;j<j1;j++){ const node = PT.coreLoopNode[j], have = s.mBy[node];
        const kg = have === have ? Math.min(want/(j1 - j0), Math.max(have, 0)) : 0;
        if(kg > 0){ s.mBy[node] = have - kg; eBookMelt(kg, node); } }
      s.csFatigue[c] = Math.min(100, s.csFatigue[c] + E_MELT_FAT*s.csMeltFrac[c]*dt); }
    for(let q=0;q<E_FAIL_N;q++) st[q] = 0;
    for(let k=0;k<XNN;k++) st[eFuelStage(c, k)] += nodeW[k];
    let rel = 0;
    for(let q=0;q<E_FAIL_N;q++) rel += st[q]*E_RELK[q];
    if(rel > 0){ eContRelA(PT.corePart[c]); s.sc[SC_RELEASE] = Math.min(100, s.sc[SC_RELEASE] + rel*E_RR[RR_CR]*PK[PK_DOSE]*dt); } }
}

const E_RDC = new Float64Array(1);
function eRadCellA(i){
  const cells = GW*GH, m = SX.radMisc, nc = PT.n.core, nt = PT.n.tank;
  let f = m[1];
  for(let c=0;c<nc;c++){ const w = SX.radCoreW[c]; if(w) f += w*PT.radCoreK[c*cells + i]; }
  if(m[0]) f += m[0]*PT.radSgK[i];
  for(let t=0;t<nt;t++){ const w = SX.radTankW[t]; if(w) f += w*PT.radTankK[t*cells + i]; }
  if(m[2]) f += m[2]*PT.radPipeK[i];
  E_RDC[0] = f;
}

function eRadDose(dt){
  const s = ST, sc = s.sc, nc = PT.n.core, nt = PT.n.tank, m = SX.radMisc;
  for(let c=0;c<nc;c++){ eContRelA(PT.corePart[c]);
    SX.radCoreW[c] = (s.csN[c]*PROMPT_F + s.csDecay[c])*(s.csBreach[c] ? RAD_BREACH : 1)
      + RAD_DMG*s.csDmg[c]*E_RR[RR_CR] + (!P.catcher ? RAD_MELT*s.csMeltFrac[c] : 0); }
  for(let t=0;t<nt;t++) SX.radTankW[t] = PT.radTankHas[t] ? RAD_TANK*s.tank[t]*PT.radTankAct[t] : 0;
  m[0] = sc[SC_SGTR] ? RAD_SGTR : 0; m[1] = RAD_AIR*sc[SC_RELEASE]; m[2] = PT.radPipeOn ? RAD_PIPE*sc[SC_N] : 0;
  const cr = PT.radCrewCells;
  let v = 0;
  for(let q=0;q<cr.length;q++){ eRadCellA(cr[q]); const f = E_RDC[0]; if(f > v) v = f; }
  sc[SC_DOSERATE] = cr.length ? clamp(v, RAD_FLOOR, RAD_CEIL) : RAD_FLOOR;
  sc[SC_CREWDOSE] = Math.min(100, sc[SC_CREWDOSE] + sc[SC_DOSERATE]*E_RAD_CREW_K*dt);
  sc[SC_REPRATE] = eRepairRadRate();
}

/* commissioning: one rest pass at dt 0 on the settle's own flow */
function eCoreRestStep(c, flowNet){
  const s = ST;
  s.csFlowNet[c] = flowNet;
  const cs = E_CS;
  cs[0] = 0; cs[1] = s.csHeat[c]; cs[2] = satT(PT.coreSat[c], s.csPCore[c]); cs[3] = 0;
  cs[4] = PT.coreFlowK[c]*flowNet; cs[5] = Math.max(flowNet, E_CORE_DT_QMIN); cs[6] = eNetCoreInH(c);
  eCoreStep(c);
}

const E_REST_MAX = 4000, E_REST_TOL = 1e-9;
/* dt-0 passes to the coupled fixed point: void, coolant, xenon and the pin fit all on the pass's own shape; a pass that moves none of them ends it; passes returned, E_REST_MAX = never converged */
function eCoreRestConverge(c){
  const s = ST, nb = c*XNN, phi = s.csPhi, was = new Float64Array(XNN), n = s.csN[c];
  for(let r=0;r<E_REST_MAX;r++){
    for(let k=0;k<XNN;k++) was[k] = phi[nb+k];
    eCorePinFit(c, s.csFlowNet[c]); eCoreGraphFit(c);
    eCoreRestStep(c, s.csFlowNet[c]);
    let tg = 0; for(let k=0;k<XNN;k++) tg += nodeW[k]*s.csNTg[nb+k];
    let d = Math.abs(tg - PT.coreTgRef[c])/tg; PT.coreTgRef[c] = tg;
    for(let k=0;k<XNN;k++){ const i = nb + k, fl = n*phi[i], xx = eXeEq(c, fl);
      d = Math.max(d, Math.abs(phi[i] - was[k])/was[k], Math.abs(s.csNVt[i] - s.csNV[i]),
        Math.abs(s.csNTct[i] - s.csNTc[i])/s.csNTc[i], Math.abs(xx - s.csXX[i])/xx);
      s.csNV[i] = s.csNVt[i]; s.csNTc[i] = s.csNTct[i]; s.csXI[i] = eIoEq(c, fl); s.csXX[i] = xx; }
    if(d <= E_REST_TOL) return r + 1; }
  return E_REST_MAX;
}

/* critical at the settled point on the ledger the first tick reads: each circuit's water dialled for the first core it cools */
function eCoreDialBoron(){
  const s = ST, nc = PT.n.core, nn = PT.n.node;
  let bor0 = 0;
  for(let c=0;c<nc;c++){
    eCoreWaterA(c); const p = E_CW[2], ci = PT.coreCirc[c];
    if(p === p && p > 0) s.csPCore[c] = p;
    eCoreRestConverge(c);
    s.csVoidTh[c] = s.csVf[c] = s.csVNode[c];
    if(ci >= 0 && PT.circCore1[ci] >= 0 && PT.circCore1[ci] !== c) continue;
    const o = SX.coreO;
    const bor = -(PT.coreExcess[c] + o[E_CO_ROD] + o[E_CO_TIP] + o[E_CO_DOP] + o[E_CO_MOD] + o[E_CO_EXP] + o[E_CO_XE] + o[E_CO_VD] + o[E_CO_GR]);
    for(let k=0;k<nn;k++) if(PT.nodeInCore[k] && (ci < 0 || PT.nodeCirc[k] === ci)) s.bBy[k] = bor;
    if(c === 0) bor0 = bor; }
  s.sc[SC_BORON] = s.sc[SC_BORON0] = s.sc[SC_BORONDEM] = bor0;
  eCoreAgg();
  return bor0;
}

/* the vessel's commissioned charge, what a leak is measured against */
function eCoreSeal(){
  const n = PT.n.core;
  for(let c=0;c<n;c++){ eCoreWaterA(c); const m = E_CW[0];
    PT.coreKg0[c] = m === m ? m : 0; }
}
const eCoreDnbrFit = () => { const n = PT.n.core;
  for(let c=0;c<n;c++) PT.coreDnbrK[c] = PT.coreDnbr0[c]/Math.max(ST.csDnbr[c], 1e-9); };
