"use strict";
// imports: eNetCoreKg eNetCoreInH eNodeInCorePiece eNetCavGauge eRoomBang eContRel eRodDriven eTavgOf eTProg eRepairRadRate
// exports: eCoreQWater eCoreQWaterA eCoreSeed eCoreReset eCoreBanksSeed eCoreRestStep eCoreDialBoron eCoreSeal eCoreDnbrFit eCoreAgg eCoreRodStep eBoronFollow eCoreDecayStep eCoreFlowRead eCorePRead eCoreFatigueStep eCoreBurstStep eCoreVesselStep eCoreFlowSet eCoreKineticsStep eCoreMeltStep eRadDose eRadCellA eRodApply eRodCommon eSetSplit eScram eScramSink eNearTrip eTripReset eBankAutoLive eEcr eFuelStage eCoreStep eCoreAxialA eFpSeed

/* Fission-product decay heat: ANSI/ANS-5.1-1979 Table 7, thermal fission of U-235, alpha MeV/(fission s)
   then lambda 1/s. A group's share after infinite irradiation is alpha/lambda over their sum; the sum is
   scaled to 1-PROMPT_F so the rest point closes, which is 1.4 % under the standard's own 13.183/200. */
const E_DEC_ANS = [
  6.5057e-01, 2.2138e+01,  5.1264e-01, 5.1587e-01,  2.4384e-01, 1.9594e-01,  1.3850e-01, 1.0314e-01,
  5.5440e-02, 3.3656e-02,  2.2225e-02, 1.1681e-02,  3.3088e-03, 3.5870e-03,  9.3015e-04, 1.3930e-03,
  8.0943e-04, 6.2630e-04,  1.9567e-04, 1.8906e-04,  3.2535e-05, 5.4988e-05,  7.5595e-06, 2.0958e-05,
  2.5232e-06, 1.0010e-05,  4.9948e-07, 2.5438e-06,  1.8531e-07, 6.6361e-07,  2.6608e-08, 1.2290e-07,
  2.2398e-09, 2.7213e-08,  8.1641e-12, 4.3714e-09,  8.7797e-11, 7.5780e-10,  2.5131e-14, 2.4786e-10,
  3.2176e-16, 2.2384e-13,  4.5038e-17, 2.4600e-14,  7.4791e-17, 1.5699e-14];
const E_DEC_N = E_DEC_ANS.length/2, E_DEC_L = new Float64Array(E_DEC_N), E_DEC_A = new Float64Array(E_DEC_N);
(function(){ let q = 0;
  for(let k=0;k<E_DEC_N;k++){ E_DEC_L[k] = E_DEC_ANS[2*k+1]; q += E_DEC_ANS[2*k]/E_DEC_L[k]; }
  for(let k=0;k<E_DEC_N;k++) E_DEC_A[k] = (1 - PROMPT_F)*E_DEC_ANS[2*k]/E_DEC_L[k]/q; })();

const E_DNB_W3 = 0, E_DNB_BOIL = 1, E_DNB_TEMP = 2;
const E_CO_DOP=0, E_CO_MOD=1, E_CO_EXP=2, E_CO_VD=3, E_CO_XE=4, E_CO_ROD=5, E_CO_TIP=6, E_CO_DIS=7, E_CO_GR=8, E_CO_SM=9, E_CO_H2=10, E_CO_FCI=11, E_CO_N=12;

const E_TRIP_NONE=0, E_TRIP_MANUAL=1, E_TRIP_AUTO=2, E_TRIP_RPS=3, E_TRIP_VESSEL=4, E_TRIP_CHANNEL=5, E_TRIP_SHIELD=6, E_TRIP_MELT=7;
const E_TXT_TRIP = ["", "MANUAL SCRAM", "AUTOMATIC SCRAM", "RPS TRIP / ", "VESSEL RUPTURE", "CHANNEL RUPTURE", "SHIELD LIFTED", "CORE MELT"];

const E_FAIL_INTACT=0, E_FAIL_TUBE=1, E_FAIL_BURST=2, E_FAIL_OXID=3, E_FAIL_DISP=4, E_FAIL_MOLTEN=5, E_FAIL_N=6;

const E_W3_P=145.038, E_W3_G=737.338, E_W3_D=39.3701, E_W3_Q=3.15459, E_W3_H=2.326;
const E_W3_PLO=1000, E_W3_PHI=2300, E_W3_GLO=1.0, E_W3_GHI=5.0, E_W3_DLO=0.2, E_W3_DHI=0.7, E_W3_XLO=-0.15, E_W3_XHI=0.15;
const E_DNB_FILM=0.10, E_DT_LEID=150;
/* gas k = A T^B W/m/K for He, Xe, Kr, NUREG/CR-7024 Table 4.1-2 (FRAP); M g/mol */
const E_GK_A = new Float64Array([2.531e-3, 9.825e-5, 1.966e-4]), E_GK_B = new Float64Array([0.7146, 0.7334, 0.7006]);
const E_GK_M = new Float64Array([4.0026, 131.293, 83.798]), E_GK_K = new Float64Array(3), E_GK_X = new Float64Array(3);
/* Booth sphere of radius E_FG_A on Turnbull's intrinsic D = 7.6e-10 exp(-35000/T) m2/s, as commonly quoted, not read at source */
const E_FG_D0=7.6e-10, E_FG_Q=35000, E_FG_A=5e-6;
const E_BURST_TAU=8, E_BURST_SPAN=50;
/* total O pickup as ZrO2-equivalent d^2/s, which the H2 and heat follow: Cathcart-Pawel ORNL/NUREG-17 to 1773 K, Urbanic-Heidrick J. Nucl. Mater. 75 (1978) above */
const E_OX_CP_A=0.3622*100*(91.224/31.998*ZR_PBR/ZR_RHO)**2, E_OX_CP_B=39940/1.987, E_OX_TSW=1773;
const E_OX_UH_A1=29.6*(ZR_PBR/ZR_RHO)**2, E_OX_UH_B1=16820, E_OX_UH_A2=87.9*(ZR_PBR/ZR_RHO)**2, E_OX_UH_B2=16610, E_OX_UH_T=1850;
const E_OX_VMIN=0.02, E_OX_T0=1073, E_OX_ECR_FAIL=0.17;
/* UO2 per mol, Fink, J. Nucl. Mater. 279 (2000): solid eq. 1/2, liquid eq. 5/6 (3120-4500 K) */
const E_UO2_M=0.27003, E_UO2_C1=81.613, E_UO2_TH=548.68, E_UO2_C2=2.285e-3, E_UO2_C3=2.360e7, E_UO2_EA=18531.7;
const E_UO2_L1=0.25136, E_UO2_L2=1.3288e9;
const E_T_STP=298.15;
const E_LAW_UO2=0, E_LAW_PH=1, E_PH_W=7, E_FUEL_NPH=6, E_BRK_N=8;
const E_UO2_E0=1/(Math.exp(E_UO2_TH/E_T_STP) - 1), E_UO2_A0=Math.exp(-E_UO2_EA/E_T_STP);
const E_FUEL_NEWT=8, E_FUEL_DT=1e-6, E_FUEL_TLO=100, E_FUEL_THI=6000;
const E_ROD_CRIT_N=20, E_ROD_CRIT_TOL=0.01;
const E_DISP_SPAN=40;
const E_FCI_TAU=0.01, E_FCI_ETA=0.2;
const E_MELT_LATCH=0.25;
const E_CORE_DT_QMIN=0.004;
const E_BOR_IN=60, E_BOR_OUT=35;
const E_ZR_LO_T=573, E_ZR_LO_K=1.0, E_ZR_HI_T=1073, E_ZR_HI_K=0.2;
const E_RAD_CREW_K=0.33;
const E_FATIGUE_BURST_K=0.0028;

/* E_VQ: [0] void, quality or equilibrium quality in, [1] rho_g/rho_f or departure quality in, [2] out, [3] rho_g Vgj / G in */
const E_VQ = new Float64Array(4);
/* Zuber-Findlay: alpha = x / (C0 (x + (1-x) rho_g/rho_f) + rho_g Vgj / G). [3] is the drift the bubbles make
   against the mixture; with it zero a channel reads the same void at every mass flux, which is why it is in. */
function eDriftFluxA(){ const q = Math.max(0, Math.min(1, E_VQ[0])), rvl = E_VQ[1], d = E_VQ[3];
  E_VQ[2] = q <= 0 ? 0 : Math.max(0, Math.min(1, q/(XC0*(q + (1 - q)*rvl) + d))); }
function eVoidQualA(){ const q = Math.max(0, Math.min(1, E_VQ[0])), rvl = E_VQ[1], den = 1 - q*XC0*(1 - rvl);
  E_VQ[2] = den > 1e-6 ? Math.max(0, Math.min(1, q*(XC0*rvl + E_VQ[3])/den)) : 1; }
/* Zuber-Findlay churn-turbulent drift velocity, m/s: E_RV[4] Tsat in and Vgj out, [2] rho_g, [3] rho_f */
const E_VGJ_K = 1.53, E_G_MS2 = 9.80665;
function eVgjA(S0){ const rg = E_RV[2], rf = E_RV[3];
  sigmaA(S0, E_RV, 4, 4);
  E_RV[4] = E_VGJ_K*Math.pow(Math.max(E_RV[4]*E_G_MS2*(rf - rg), 0)/(rf*rf), 0.25); }
/* Levy's profile fit, defined only above departure - below it the expression goes to 1 and then NaN */
function eSubQualA(){ const xe = E_VQ[0], xd = E_VQ[1];
  if(xe <= xd){ E_VQ[2] = 0; return; }
  const E = Math.exp(xe/xd - 1); E_VQ[2] = (xe - xd*E)/(1 - xd*E); }

/* E_CR: [0] a node's ECR out, [1] pressure across the clad in, [2] its burst temperature out */
const E_CR = new Float64Array(3);
function eBurstTA(c){
  const th = PT.coreCladThick[c], sig = (PT.coreRodD[c]/2 - th)/th*Math.max(E_CR[1], 0), B = PT.cladBurst, o = PT.coreCladRow[c]*4;
  const sLo = B[o], tLo = B[o+1], sHi = B[o+2], tHi = B[o+3];
  if(sig <= sLo){ E_CR[2] = tLo; return; }
  E_CR[2] = Math.max(tHi, tLo - (tLo - tHi)*Math.log(sig/sLo)/Math.log(sHi/sLo));
}
/* E_GKIO: [0] K and [1] the fission gas mole fraction in, [2] the mixture's W/m/K out; NUREG/CR-7024 eq. 4.1-4 to 4.1-6 */
const E_GKIO = new Float64Array(3);
function eGasKA(){ const T = E_GKIO[0], x = E_GKIO[1];
  for(let i=0;i<3;i++) E_GK_K[i] = E_GK_A[i]*Math.pow(T, E_GK_B[i]);
  if(!(x > 0)){ E_GKIO[2] = E_GK_K[0]; return; }
  E_GK_X[0] = 1 - x; E_GK_X[1] = x*FG_XE; E_GK_X[2] = x*(1 - FG_XE);
  let k = 0;
  for(let i=0;i<3;i++){ let d = 0;
    for(let j=0;j<3;j++){ const mi = E_GK_M[i], mj = E_GK_M[j], r = mi/mj, a = 1 + Math.sqrt(E_GK_K[i]/E_GK_K[j])*Math.pow(r, 0.25);
      d += a*a/(2*Math.SQRT2*Math.sqrt(1 + r))*(1 + 2.41*(mi - mj)*(mi - 0.142*mj)/((mi + mj)*(mi + mj)))*E_GK_X[j]; }
    k += E_GK_K[i]*E_GK_X[i]/d; }
  E_GKIO[2] = k; }
/* E_FGR: [0] Booth's released fraction of a node's gas at the reduced time D t / a^2 in [1] */
const E_FGR = new Float64Array(2);
function eFgFracA(){ const th = E_FGR[1];
  E_FGR[0] = th <= 0.1 ? 6*Math.sqrt(th/Math.PI) - 3*th : 1 - 6/(Math.PI*Math.PI)*Math.exp(-Math.PI*Math.PI*th); }
/* E_FS: [0] K in, [1] the core's fuel linear strain out: UO2 on FRAP's law (NUREG/CR-7024 eq. 2.5-1, Table 2.5-1), a phase row on alpha plus its transition steps */
const E_FS = new Float64Array(2);
function eFuelStrainA(c){ const T = E_FS[0], nf = PT.n.fuel, o = c*nf; let e = 0;
  for(let f=0;f<nf;f++){ const w = PT.coreFuelW[o+f]; if(!(w > 0)) continue;
    if(PT.fuelLaw[f] === E_LAW_UO2){ e += w*(9.8e-6*T - 2.61e-3 + 0.316*Math.exp(-1.32e-19/(1.380649e-23*T))); continue; }
    let s = PT.fuelAl[f]*T;
    for(let p=0;p<PT.fuelNPh[f]-1;p++) if(T >= PT.fuelPh[(f*E_FUEL_NPH + p)*E_PH_W]) s += PT.fuelDl[f*E_FUEL_NPH + p];
    e += w*s; }
  E_FS[1] = e; }
/* E_OXR: [0] clad K in, [1] parabolic rate constant out */
const E_OXR = new Float64Array(2);
function eOxRateA(){ const T = E_OXR[0];
  E_OXR[1] = T < E_OX_TSW ? E_OX_CP_A*Math.exp(-E_OX_CP_B/Math.max(T, 300))
           : T <= E_OX_UH_T ? E_OX_UH_A1*Math.exp(-E_OX_UH_B1/T) : E_OX_UH_A2*Math.exp(-E_OX_UH_B2/T); }
function eEcrA(c, i){ E_CR[0] = (ST.csNOx[i] + ST.csNDmg[i]*ST.csNOxI[i])/ZR_PBR/PT.coreCladThick[c]; }
const eEcr = (c, k) => { eEcrA(c, c*XNN + k); return E_CR[0]; };
/* E_BUR: [0] the vessel's burst MPa, [1] clad K in, [2] Zircaloy strength factor out */
const E_BUR = new Float64Array(3);
function eZrKA(){ E_BUR[2] = E_ZR_LO_K + (E_ZR_HI_K - E_ZR_LO_K)*Math.max(-0.3, Math.min(1, (E_BUR[1] - E_ZR_LO_T)/(E_ZR_HI_T - E_ZR_LO_T))); }
function eBurstPA(c){ E_BUR[0] = PT.coreP0[c]*(PT.coreBurstK[c] - E_FATIGUE_BURST_K*ST.csFatigue[c]); }
/* E_FU: [0] K, [1] kJ/kg over 298.15 K, [2] kJ/kg/K, [3] kJ/kg eFuelTA() inverts, [4] K that picks each row's phase, [5] [6] one row's h and cp */
const E_FU = new Float64Array(7);
function eUo2SolidA(){ const T = E_FU[0], x = Math.exp(E_UO2_TH/T), a = Math.exp(-E_UO2_EA/T);
  E_FU[5] = (E_UO2_C1*E_UO2_TH*(1/(x - 1) - E_UO2_E0) + E_UO2_C2*(T*T - E_T_STP*E_T_STP) + E_UO2_C3*(a - E_UO2_A0))/(1000*E_UO2_M);
  E_FU[6] = (E_UO2_C1*E_UO2_TH*E_UO2_TH*x/(T*T*(x - 1)*(x - 1)) + 2*E_UO2_C2*T + E_UO2_C3*E_UO2_EA*a/(T*T))/(1000*E_UO2_M); }
/* one FUEL row at E_FU[0], its phase picked by E_FU[4]: UO2 on Fink's solid to tmelt and his liquid past it; a phase row on cp = a + bT + cT^2 + dT^3 + e/T^2 per phase, its latent heats in the phase constants */
function eFuelRowA(f){ const T = E_FU[0], S = E_FU[4];
  if(PT.fuelLaw[f] === E_LAW_UO2){ const tm = PT.fuelTm[f];
    if(S <= tm){ eUo2SolidA(); return; }
    E_FU[0] = tm; eUo2SolidA(); E_FU[0] = T;
    E_FU[5] += (E_UO2_L1*(T - tm) - E_UO2_L2*(1/T - 1/tm))/(1000*E_UO2_M);
    E_FU[6] = (E_UO2_L1 + E_UO2_L2/(T*T))/(1000*E_UO2_M); return; }
  ePhLawA(PT.fuelPh, f*E_FUEL_NPH*E_PH_W, PT.fuelNPh[f], PT.fuelM, f, E_FU, 5); }
/* phase rows from ph[o] at io[0], the row picked by io[4]: h kJ/kg to io[j], cp kJ/kg/K to io[j+1], M[f] kg/mol */
function ePhLawA(ph, o, np, M, f, io, j){
  const T = io[0], S = io[4], m = 1000*M[f];
  let p = 0;
  while(p < np - 1 && S > ph[o]){ p++; o += E_PH_W; }
  io[j] = (T*(ph[o+1] + T*(ph[o+2]/2 + T*(ph[o+3]/3 + T*ph[o+4]/4))) - ph[o+5]/T)/m + ph[o+6];
  io[j+1] = (ph[o+1] + T*(ph[o+2] + T*(ph[o+3] + T*ph[o+4])) + ph[o+5]/(T*T))/m; }
/* E_PAIR: [0..3] a 2x2 M row by row in, [4..7] phi1(M) = (e^M - I)/M out, on M's two real eigenvalues (Sylvester) */
const E_PAIR = new Float64Array(8);
function ePhi1A(){ const P = E_PAIR, a = P[0], b = P[1], c = P[2], d = P[3], m = (a + d)/2, q = Math.sqrt(Math.max(0, (a - d)*(a - d)/4 + b*c));
  const pm = m === 0 ? 1 : Math.expm1(m)/m;
  let f0, f1;
  if(q > 1e-5*(1 + Math.abs(m))){ const l1 = m + q, l2 = m - q, p1 = l1 === 0 ? 1 : Math.expm1(l1)/l1, p2 = l2 === 0 ? 1 : Math.expm1(l2)/l2;
    f1 = (p1 - p2)/(l1 - l2); f0 = p1 - f1*l1; }
  else { f1 = m > -1e-3 && m < 1e-3 ? 0.5 + m*(1/3 + m*(1/8 + m/30)) : (m*(Math.expm1(m) + 1) - Math.expm1(m))/(m*m); f0 = pm - f1*m; }
  P[4] = f0 + f1*a; P[5] = f1*b; P[6] = f1*c; P[7] = f0 + f1*d; }
/* E_CL: [0] clad K, [1] kJ/kg over 298.15 K, [2] kJ/kg/K, [3] kJ/kg eCladTA() inverts, [4] K that picks the phase */
const E_CL = new Float64Array(5), E_CLAD_NPH = 2;
/* Abramowitz & Stegun 7.1.26, |error| under 1.5e-7: E_ERF[0] in, erf out */
const E_ERF = new Float64Array(1);
function eErfA(){ const x = E_ERF[0], a = x < 0 ? -x : x, t = 1/(1 + 0.3275911*a);
  const y = 1 - t*(0.254829592 + t*(-0.284496736 + t*(1.421413741 + t*(-1.453152027 + t*1.061405429))))*Math.exp(-a*a);
  E_ERF[0] = x < 0 ? -y : y; }
function eCladHA(c){ const r = PT.coreCladRow[c], T = E_CL[0];
  ePhLawA(PT.cladPh, r*E_CLAD_NPH*E_PH_W, PT.cladNPh[r], PT.cladMol, r, E_CL, 1);
  const g = r*5, A = PT.cladG[g], lo = PT.cladG[g+3];
  if(!(A > 0) || !(T > lo)) return;
  const tp = PT.cladG[g+1], w = PT.cladG[g+2], hi = PT.cladG[g+4], s = Math.sqrt(w), k = A*s*Math.sqrt(Math.PI)/2000;
  E_ERF[0] = (Math.min(T, hi) - tp)/s; eErfA(); let e = E_ERF[0];
  E_ERF[0] = (lo - tp)/s; eErfA(); e -= E_ERF[0];
  E_CL[1] += k*e;
  if(T < hi) E_CL[2] += A*Math.exp(-(T - tp)*(T - tp)/w)/1000; }
/* Newton on h, halving the bracket it has proved whenever a step would leave it or would not halve the last one: h(T) is S-shaped round the c_p peak and plain Newton cycles there */
const E_CLAD_NEWT = 60;
function eCladTA(c){ const hT = E_CL[3];
  let T = E_CL[0], lo = E_FUEL_TLO, hi = E_FUEL_THI, step = hi - lo;
  for(let i=0;i<E_CLAD_NEWT;i++){ E_CL[0] = T; E_CL[4] = T; eCladHA(c);
    const d = E_CL[1] - hT; if(d === 0) break;
    if(d > 0) hi = T; else lo = T;
    let T1 = T - d/E_CL[2]; if(!(T1 > lo && T1 < hi) || Math.abs(2*d) > Math.abs(step*E_CL[2])) T1 = (lo + hi)/2;
    const dT = T1 - T; step = dT; T = T1; if(dT < E_FUEL_DT && dT > -E_FUEL_DT) break; }
  E_CL[0] = T; }
function eFuelSumA(c){ const nf = PT.n.fuel, o = c*nf; let h = 0, cp = 0;
  for(let f=0;f<nf;f++){ const w = PT.coreFuelW[o+f]; if(w > 0){ eFuelRowA(f); h += w*E_FU[5]; cp += w*E_FU[6]; } }
  E_FU[1] = h; E_FU[2] = cp; }
/* sensible enthalpy over the core's mass-weighted rows; fusion is csNMelt's */
function eFuelHA(c){ E_FU[4] = E_FU[0]; eFuelSumA(c); }
/* a target inside a latent jump is the transition itself; otherwise Newton inside the bracket it falls in */
function eFuelTA(c, n, tol){ const hT = E_FU[3], T0 = E_FU[0], o = c*E_BRK_N;
  let lo = E_FUEL_TLO, hi = E_FUEL_THI;
  for(let i=0;i<E_BRK_N;i++){ const Tb = PT.coreBrkT[o+i]; if(!(Tb > 0)) break;
    if(hT <= PT.coreBrkH[o+i]){ hi = Tb; break; }
    if(hT <= PT.coreBrkH[o+i] + PT.coreBrkL[o+i]){ E_FU[0] = Tb; return; }
    lo = Tb; }
  E_FU[4] = (lo + hi)/2;
  let T = Math.max(lo, Math.min(hi, T0));
  for(let i=0;i<n;i++){ E_FU[0] = T; eFuelSumA(c); const T1 = Math.max(lo, Math.min(hi, T - (E_FU[1] - hT)/E_FU[2]));
    const dT = T1 - T; T = T1; if(dT < tol && dT > -tol) break; }
  E_FU[0] = T; }
const eIoEq = (c, fl) => PT.coreGI[c]*fl/PT.coreLamI[c];
const eXeEq = (c, fl) => (PT.coreGI[c] + PT.coreGX[c])*fl/(PT.coreLamX[c] + PT.coreSig[c]*fl);
const ePmEq = (c, fl) => PT.coreGP[c]*fl/PT.coreLamP[c];
const eSmEq = c => PT.coreGP[c]/PT.coreSigS[c];
const eBankAutoLive = (c, b) => !ST.csScrammed[c] && !ST.csRodJam[c] && (!ST.csSplit[c] || ST.csBankAuto[c*PT.nbMax + b] === 1);

function eFuelStage(c, k){
  const i = c*XNN + k;
  if(ST.csNMelt[i] > 0) return E_FAIL_MOLTEN;
  if(ST.csNDisp[i] > 0) return E_FAIL_DISP;
  eEcrA(c, i); if(E_CR[0] >= E_OX_ECR_FAIL) return E_FAIL_OXID;
  if(ST.csNDmg[i] > 0) return E_FAIL_BURST;
  if(ST.csNTube[i] > 0) return E_FAIL_TUBE;
  return E_FAIL_INTACT;
}

function eRodShape(c){
  const nb = c*XNN, rb = c*XNR, bb = c*PT.nbMax, NB = PT.coreNB[c], rinf = PT.coreRinf[c], tipLen = PT.coreTipLen[c], tipGap = PT.coreTipGap[c];
  const cov = ST.csNCov, fol = ST.csNFol;
  for(let k=0;k<XNN;k++){ cov[nb+k] = 0; fol[nb+k] = 0; }
  for(let b=0;b<NB;b++){
    const ins = Math.max(0, Math.min(1, ST.csRodZ[bb+b])), tip = XNZ*(1 - ins), fHi = follHi(tip, tipGap), fLo = fHi - tipLen, br = PT.coreBankR[bb+b];
    for(let i=0;i<XNR;i++){
      const w = Math.max(0, 1 - Math.abs(i - br)/rinf)/Math.max(PT.coreRinfW[rb+i], 1e-6);
      if(w <= 0) continue;
      for(let j=0;j<XNZ;j++){ const k = nb + i*XNZ + j;
        cov[k] += w*Math.max(0, Math.min(1, j + 1 - tip));
        fol[k] += w*Math.max(0, Math.min(1, Math.min(j + 1, fHi) - Math.max(j, fLo))); } } }
}

function eCoreSolve(c, tick){
  FXK[FK_CR] = PT.coreCr[c]; FXK[FK_CZ] = PT.coreCz[c]; FXK[FK_GR] = PT.coreGR[c]; FXK[FK_GT] = PT.coreGT[c]; FXK[FK_GB] = PT.coreGB[c];
  if(tick) fluxSolve(ST.csPhi, c*XNN, ST.csNRho, c*XNN, FLUX_TICK_TOL, FLUX_TICK_CAP);
  else fluxSolve(ST.csPhi, c*XNN, ST.csNRho, c*XNN, FLUX_TOL, FLUX_CAP);
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
    ST.csRodZ[bb+b] = Math.max(0, Math.min(1, ST.csSplit[c] ? ST.csRodZ[bb+b] : ST.csRodPos[c] + PT.coreBankW[bb+b]*XTILTZ*ST.csTilt[c]));
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
  s.csTubesOpen[c] = 0; s.csCavRelief[c] = 0; s.csGQ[c] = 0; s.csCQ[c] = 0;
  for(let q=0;q<RP_N;q++) s.csParts[pb+q] = 0;
  for(let g=0;g<6;g++) s.csC[gb+g] = PT.coreBet[gb+g]*n0/(PT.coreLAM[c]*PT.coreLam[gb+g]);
  let d = 0;
  for(let g=0;g<E_DEC_N;g++){ s.csDec[db+g] = E_DEC_A[g]*n0; d += s.csDec[db+g]; }
  s.csDecay[c] = d; s.csHeat[c] = n0*PROMPT_F + d; eCoreRestQ(c);
}

/* critical flux shape at the seeded rods, xenon on the node's own flux, and the pin conductances at the rest flow */
function eCoreReset(c, flowNet){
  const s = ST, nb = c*XNN, rb = c*XNR, bb = c*PT.nbMax, NB = PT.coreNB[c];
  for(let k=0;k<XNN;k++){ const i = nb + k;
    s.csPhi[i] = 1; s.csXI[i] = eIoEq(c, PT.coreN0[c]); s.csXX[i] = PT.coreX0[c]; s.csPm[i] = ePmEq(c, PT.coreN0[c]); s.csSm[i] = eSmEq(c);
    s.csNTc[i] = PT.coreTref[c]; s.csNTct[i] = PT.coreTref[c]; s.csNTf[i] = PT.coreTfRef[c];
    s.csNV[i] = 0; s.csNVt[i] = 0; s.csNRho[i] = 0; s.csNTube[i] = 0; s.csNCov[i] = 0; s.csNFol[i] = 0;
    s.csNDmg[i] = 0; s.csNClMl[i] = 0; s.csNClOut[i] = 0; s.csNDis[i] = 0; s.csNFu[i] = PT.coreFuelKg[c]*nodeW[k]; s.csNCl[i] = PT.coreCladM[c]*nodeW[k]; s.csNDw[i] = nodeW[k];
    s.csNMlF[i] = 0; s.csNMlK[i] = 0; s.csNMlZ[i] = 0; s.csNMlE[i] = 0; s.csNMlL[i] = 0; s.csNMlDw[i] = 0; s.csNZr[i] = PT.cladZr[PT.coreCladRow[c]] ? PT.coreCladM[c]*nodeW[k] : 0; s.csNOx[i] = 0; s.csNOxI[i] = 0; s.csNMelt[i] = 0; s.csNDisp[i] = 0; s.csNDnb[i] = 0; s.csNTg[i] = PT.coreTref[c]; s.csNTgC[i] = PT.coreTref[c]; s.csNFg[i] = 0; }
  for(let i=0;i<XNR;i++) s.csChW[rb+i] = 1;
  for(let b=0;b<NB;b++){ s.csRodZ[bb+b] = s.csRodPos[c]; s.csRodZDem[bb+b] = s.csRodPos[c]; s.csBankAuto[bb+b] = 1; }
  s.csTubesOpen[c] = 0; s.csCavRelief[c] = 0; s.csGQ[c] = 0; s.csCQ[c] = 0;
  s.csPlF[c] = 0; s.csPlK[c] = 0; s.csPlZ[c] = 0; s.csPlE[c] = 0; s.csPlL[c] = 0; s.csPlDw[c] = 0;
  s.csHdTi[c] = PT.coreTref[c]; s.csHdTo[c] = PT.coreTref[c]; s.csHdLife[c] = 0; s.csHdFail[c] = 0; s.csHdWhy[c] = 0;
  s.csTilt[c] = 0; s.csTiltDem[c] = 0; s.csAo[c] = 0; s.csRo[c] = 0; s.csHotRing[c] = 0; s.csHotLev[c] = 0; s.csVNode[c] = 0;
  s.csHotFlow[c] = 1; s.csTipRho[c] = 0; s.csTfHot[c] = PT.coreTfRef[c];
  s.csMeltFrac[c] = 0; s.csOxMax[c] = 0; s.csQOx[c] = 0; s.csFci[c] = 0; s.csTcladHot[c] = PT.coreTref[c];
  s.csDnbrMin[c] = PT.coreDnbr0[c]; s.csDnbrRing[c] = 0; s.csDnbrLev[c] = 0;
  eRodShape(c);
  eCoreStaticRho(c);
  eCoreSolve(c, 0);
  eNodePeak(c); s.csFq[c] = SX.corePeak[0];
  const n0 = PT.coreN0[c];
  for(let k=0;k<XNN;k++){ const fl = n0*s.csPhi[nb+k]; s.csXI[nb+k] = eIoEq(c, fl); s.csXX[nb+k] = eXeEq(c, fl); s.csPm[nb+k] = ePmEq(c, fl); s.csSm[nb+k] = eSmEq(c); }
  const film0 = eCorePinFit(c, flowNet);
  eCoreRestQ(c); const qhat = s.csFQ[c]/PT.corePinUA[c];
  const cr = PT.coreSalt[c] ? 0 : PT.coreCladR[c];
  for(let k=0;k<XNN;k++){ const i = nb + k;
    s.csNTf[i] = PT.coreSalt[c] ? s.csNTc[i] : s.csNTc[i] + qhat*s.csPhi[i]/film0; s.csNFilm[i] = film0;
    s.csNTcl[i] = s.csNTc[i] + (s.csNTf[i] - s.csNTc[i])*cr; s.csNHc[i] = cr > 0 ? film0/cr : film0; }
}

/* the pin conductances off the drawing at the film the flow gives; film0 returned */
function eCorePinFit(c, flowNet){
  const film0 = pinFilm(PT.coreFlowK[c]*(flowNet || 1));
  const rf = PT.corePinRf[c]/film0, rs = PT.corePinRs[c], rg = PT.corePinRg[c], R = rs + rg + rf, r = rf/R;
  PT.corePinUA[c] = PT.corePinLen[c]/(1000*R*film0);
  PT.coreGSolid[c] = film0*R/rs; PT.coreGGap[c] = film0*R/rg; PT.coreCladR[c] = r;
  return film0;
}
/* core c's water, block, structure, absorber and control-channel shares of prompt and of decay heat, bilinear off the design's
   own (void x rod coverage) table at node k's state; k < 0 is a flat core at zero void with the bank out */
const E_HS_WP=0, E_HS_WD=1, E_HS_BP=2, E_HS_BD=3, E_HS_SP=4, E_HS_SD=5, E_HS_AP=6, E_HS_AD=7, E_HS_CP=8, E_HS_CD=9;
const E_HSP = new Float64Array(HS_OUT), E_HSG = new Float64Array(HS_OUT);
function eHeatSplitA(c, k){
  const a = k < 0 ? 0 : Math.max(0, Math.min(1, ST.csNV[k]));
  const x = a*(HS_GRID - 1), y = (k < 0 ? 0 : Math.max(0, Math.min(1, ST.csNCov[k])))*(HS_GRID - 1);
  let i = Math.floor(x), j = Math.floor(y);
  if(i > HS_GRID - 2) i = HS_GRID - 2; if(i < 0) i = 0;
  if(j > HS_GRID - 2) j = HS_GRID - 2; if(j < 0) j = 0;
  const fx = x - i, fy = y - j, T = PT.coreHsTab, b = c*HS_GRID*HS_GRID*HS_OUT;
  const a0 = b + (i*HS_GRID + j)*HS_OUT, a1 = b + ((i + 1)*HS_GRID + j)*HS_OUT;
  for(let q=0;q<HS_OUT;q++)
    E_HSG[q] = (T[a0+q]*(1 - fy) + T[a0+HS_OUT+q]*fy)*(1 - fx) + (T[a1+q]*(1 - fy) + T[a1+HS_OUT+q]*fy)*fx;
  heatSplitA(E_HSG, PT.coreHsFN[c], PT.coreHsC[c], PT.coreHsM[c], PT.coreHsX[c], a, E_HSP, 0); }
/* a flat core at zero void: csFQ the pin's kW, csDQ the water's; the blocks' reaches the water through their
   own temperature in the tick, the structures' and the absorber's go to the water, the control channels' to theirs */
function eCoreRestQ(c){ const s = ST, rk = PT.coreRated[c]*1000, hd = s.csDecay[c], hp = s.csHeat[c] - hd;
  eHeatSplitA(c, -1);
  const w = hp*E_HSP[E_HS_WP] + hd*E_HSP[E_HS_WD], b = hp*E_HSP[E_HS_BP] + hd*E_HSP[E_HS_BD];
  const x = hp*(E_HSP[E_HS_SP] + E_HSP[E_HS_AP]) + hd*(E_HSP[E_HS_SD] + E_HSP[E_HS_AD]);
  const ch = hp*E_HSP[E_HS_CP] + hd*E_HSP[E_HS_CD];
  s.csFQ[c] = (s.csHeat[c] - w - b - x - ch)*rk; s.csDQ[c] = (w + x)*rk; s.csGQ[c] = 0; s.csCQ[c] = PT.coreCpsWet[c] ? ch*rk : 0; }

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

/* E_MN = [clad heat flux as a share of the rated mean, rise, Tin, Tf, gShare, x, dhSub] in, margin out at [7], the plane's own pressure [8], pool void [9] and flooding margin [10] in: per node, so no double crosses as an argument */
const E_MN = new Float64Array(11);
/* pool CHF factors: Ivey & Morris (1962) 1 + E_IM_K (rho_f/rho_g)^E_IM_R cp dTsub/h_fg; Griffith et al. (1977) (1 - alpha), not recommended past alpha E_GR_AMAX (IAEA-TECDOC-1203 3.4.2), held there as a FIT */
const E_IM_K = 0.1, E_IM_R = 0.75, E_GR_AMAX = 0.8;
function eMarginNode(c){
  const qs = E_MN[0], rise = E_MN[1], Tin = E_MN[2], Tf = E_MN[3], gShare = E_MN[4], x = E_MN[5], dhSub = E_MN[6];
  const law = PT.coreDnbLaw[c], K = PT.coreDnbrK[c];
  const q = qs*PT.coreRated[c]*1e6/Math.max(PT.coreAHeat[c], 1e-6);
  if(law === E_DNB_BOIL){ E_MN[7] = K*(dhSub/PT.coreCp[c])/Math.max(rise, 1e-3); return; }
  if(law === E_DNB_TEMP){ E_MN[7] = K*Math.max(PT.coreTdmg[c] - Tin, 0)/Math.max(Tf - Tin, 1e-3); return; }
  const pMPa = E_MN[8], g0 = PT.coreG0[c]*gShare, gSI0 = g0 > 1e-3 ? g0 : 1e-3;
  const gFloor = E_W3_GLO*1e6/E_W3_G, gSI = gSI0 > gFloor ? gSI0 : gFloor;
  const p = Math.max(E_W3_PLO, Math.min(E_W3_PHI, pMPa*E_W3_P)), g = Math.max(E_W3_GLO, Math.min(E_W3_GHI, gSI*E_W3_G/1e6));
  const de = Math.max(E_W3_DLO, Math.min(E_W3_DHI, PT.coreDh[c]*E_W3_D)), xq = Math.max(E_W3_XLO, Math.min(E_W3_XHI, x));
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
  if(gSI0 >= gFloor){ E_MN[7] = Math.min(K*w/Q, E_MN[10]); return; }
  /* the linear span from the pool to W-3's floor is a FIT */
  E_CHF[0] = pMPa; eChfZuberA(); const gr = gSI0/gFloor;
  const zP = E_CHF[4]*(1 - Math.min(E_MN[9], E_GR_AMAX))*(1 + E_IM_K*Math.pow(E_CHF[7]/E_CHF[8], E_IM_R)*Math.max(0, -x));
  E_MN[7] = Math.min(((1 - gr)*zP + gr*K*w)/Q, E_MN[10]);
}
/* E_CHF: [0] MPa, [1] G kg/m2/s, [2] quality, [3] hydraulic diameter m in; [4] CHF W/m2 out; [5..9] scratch, Zuber leaves rho_f, rho_g at [7], [8] */
const E_CHF = new Float64Array(10);
function eChfZuberA(){ const c = SAT_WATER, io = E_CHF;
  io[5] = io[0]; satTA(c, io, 5, 6);
  curveA(c, CV_RF, io, 6, 7); curveA(c, CV_RG, io, 6, 8); curveA(c, CV_HFG, io, 6, 9); sigmaA(c, io, 6, 5);
  const rf = io[7], rg = io[8];
  io[4] = 0.131*io[9]*1000*Math.sqrt(rg)*Math.pow(io[5]*E_G_MS2*Math.max(rf - rg, 1e-3), 0.25); }
function eChfBiasiA(){ const io = E_CHF, pMPa = io[0], gSI = io[1], x = io[2], dhM = io[3];
  const Dc = dhM*100, G = Math.max(gSI, 1)/10, Pb = pMPa*10;
  const Dn = Math.pow(Dc, Dc >= 1 ? 0.4 : 0.6), g6 = Math.pow(G, 1/6);
  const F = 0.7249 + 0.099*Pb*Math.exp(-0.032*Pb);
  const H = -1.159 + 0.149*Pb*Math.exp(-0.019*Pb) + 8.99*Pb/(10 + Pb*Pb);
  const q1 = 1.883e3/(Dn*g6)*(F/g6 - x), q2 = 3.78e3*H*(1 - x)/(Dn*Math.pow(G, 0.6));
  io[4] = Math.max(q1, q2, 0)*1e4; }

/* one nodal pass: channel split, pin balance, clad, oxidation, melt, burst, xenon, feedback; writes SX.coreO */
/* E_CS in: [0] dt, [1] heat, [2] T sat, [3] vessel void, [4] mass flux, [5] flow fraction, [6] inlet h */
const E_CS = new Float64Array(7), E_RV = new Float64Array(5), E_CMX = new Float64Array(MX_N), E_GCP = new Float64Array(3);
/* E_CQW[0]: kW core c hands its water: what leaves the pins, what the blocks give up, what fission deposits in it directly, less the skin, plus what a melt quenched */
const E_CQW = new Float64Array(1);
function eCoreQWaterA(c){ const a = PT.corePart[c];
  E_CQW[0] = ST.csFQ[c] + ST.csGQ[c] + ST.csDQ[c] - (a >= 0 ? ST.skinQ[a] : 0) + ST.csFci[c]; }
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
/* one axial pressure profile per core: parallel channels hang between the same two plena, so they share
   their ends and it is the flow that splits. Gravity, wall friction and acceleration over the heated
   length, anchored so the ten planes still average the core node's own solved pressure - the profile
   redistributes pressure inside the core and adds none. */
const E_AXP = new Float64Array(XNZ), E_AXS = new Float64Array(XNZ), E_AXFG = new Float64Array(XNZ);
const E_AXRV = new Float64Array(XNZ), E_AXD = new Float64Array(XNZ), E_AXJL = new Float64Array(XNZ);
const E_AXA = new Float64Array(XNZ), E_AXT = new Float64Array(XNZ), E_AXR = new Float64Array(XNZ);
const E_AXFR = new Float64Array(XNZ), E_AXDP = new Float64Array(XNZ);
/* [0] bottom-to-top drop over the nine plane spacings, MPa, [1] Re, [2] the friction share of [0] */
const E_AX = new Float64Array(3), E_AXMU = new Float64Array(MX_N);
const E_AX_ITER = 2, E_AX_PMIN = 1e-3, E_AX_RE_BL = 1e5;
/* Blasius is stated for smooth tubes to Re 1e5; above it the Filonenko form, both Darcy */
const eAxFricA = re => re < E_AX_RE_BL ? 0.316*Math.pow(re, -0.25) : Math.pow(1.82*Math.log10(re) - 1.64, -2);
function eCoreAxialA(c, mflux){
  const s = ST, T = PT, nb = c*XNN, S0 = T.coreSat[c], pCore = s.csPCore[c];
  for(let j=0;j<XNZ;j++){ let a = 0, t = 0, w = 0;
    for(let i=0;i<XNR;i++){ const q = i*XNZ + j; a += nodeW[q]*s.csNV[nb+q]; t += nodeW[q]*s.csNTc[nb+q]; w += nodeW[q]; }
    const iw = w > 0 ? 1/w : 0;
    E_AXA[j] = Math.max(0, Math.min(1, a*iw)); E_AXT[j] = t*iw; E_AXP[j] = pCore; E_AXDP[j] = 0; }
  E_AX[0] = 0; E_AX[1] = 0; E_AX[2] = 0;
  if(!T.coreGas[c]){
    const dz = Math.max(T.coreCoreHgt[c], 0.05)/XNZ, dh = Math.max(T.coreDh[c], 1e-4);
    const G = Math.max(T.coreG0[c]*mflux, 0), G2 = G*G;
    for(let it=0;it<E_AX_ITER;it++){
      for(let j=0;j<XNZ;j++){
        E_RV[0] = E_AXP[j]; satTA(S0, E_RV, 0, 1);
        curveA(S0, CV_RG, E_RV, 1, 2);
        E_RV[3] = Math.min(E_AXT[j], E_RV[1]); curveA(S0, CV_RF, E_RV, 3, 4);
        const rg = E_RV[2], rl = Math.max(E_RV[4], 1e-6), a = E_AXA[j];
        /* the homogeneous multiplier is exactly rho_liquid/rho_mix, so it cancels into the mixture density */
        E_AXR[j] = Math.max(rl*(1 - a) + rg*a, 1e-6);
        E_AXMU[MX_TL] = E_AXT[j]; muLiqA(S0, E_AXMU);
        const re = Math.max(G*dh/Math.max(E_AXMU[MX_MU], 1e-9), 1e3);
        if(j === 0) E_AX[1] = re;
        E_AXFR[j] = eAxFricA(re)*(dz/dh)*G2/(2*E_AXR[j]); }
      let d = 0, f = 0;
      for(let j=1;j<XNZ;j++){
        const fr = (E_AXFR[j] + E_AXFR[j-1])/2;
        d += (E_G_MS2*dz*(E_AXR[j] + E_AXR[j-1])/2 + fr + G2*(1/E_AXR[j] - 1/E_AXR[j-1]))/1e6;
        f += fr/1e6; E_AXDP[j] = d; }
      E_AX[0] = d; E_AX[2] = f;
      let m = 0; for(let j=0;j<XNZ;j++) m += E_AXDP[j];
      m /= XNZ;
      for(let j=0;j<XNZ;j++) E_AXP[j] = Math.max(pCore + m - E_AXDP[j], E_AX_PMIN); } }
  for(let j=0;j<XNZ;j++){
    const p = E_AXP[j];
    E_RV[0] = p; satRvlA(S0, E_RV, 0, 1); E_AXRV[j] = E_RV[1];
    /* satRvlA() spends E_RV[1] on Tsat before it becomes the ratio, so the drift asks for it again */
    E_RV[4] = p; satTA(S0, E_RV, 4, 4); const Ts = E_RV[4];
    E_AXS[j] = Ts; eVgjA(S0);
    /* mflux is a fraction of rated, so the drift is divided by the rated mass flux here and by that fraction per ring */
    E_AXD[j] = E_RV[2]*E_RV[4]/Math.max(T.coreG0[c], 1e-9);
    /* a permanent gas has no saturation curve to read h_fg off, so it keeps the row's stated figure */
    if(T.coreGas[c]) E_AXFG[j] = T.coreHfg[c];
    else { E_RV[0] = Ts; curveA(S0, CV_HFG, E_RV, 0, 1); E_AXFG[j] = E_RV[1]; }
    E_AXJL[j] = Math.exp(-p/JL_P); }
}
/* each lump's heat in from its neighbours, kW, and its conductance sum, kW/K, off the pass's starting temperatures */
function eCoreSpread(c){
  const s = ST, T = PT, nb = c*XNN, rb = c*XNR, gF = SX.coreSpG, qF = SX.coreSpQ, gC = SX.coreSpGC, qC = SX.coreSpQC;
  for(let k=nb;k<nb+XNN;k++){ gF[k] = 0; qF[k] = 0; gC[k] = 0; qC[k] = 0; }
  const p = T.coreSpP[c]; if(!(p > 0)) return;
  const rgp = T.coreSpRg[c]/p, mRow = MODER[T.coreModRow[c]], kgC = T.coreGraphKgC[c], wC = kgC > 0 ? kgC/(T.coreGraphKg[c] + kgC) : 0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k = nb + i*XNZ + j;
    for(let d=0;d<2;d++){
      if(d ? j === XNZ-1 : i === XNR-1) continue;
      const m = d ? k + 1 : k + XNZ, geo = d ? T.coreSpZ[rb+i] : T.coreSpR[rb+i];
      for(let L=0;L<2;L++){ const w = L ? wC : 1 - wC; if(!(w > 0)) continue;
        const Ta = L ? s.csNTgC[k] : s.csNTg[k], Tb = L ? s.csNTgC[m] : s.csNTg[m];
        E_GCP[0] = (Ta + Tb)/2; mRow.kA(E_GCP, 0, 2);
        const g = w*geo/(1000*(1/E_GCP[2] + (d ? 0 : rgp))), q = g*(Tb - Ta);
        if(L){ gC[k] += g; gC[m] += g; qC[k] += q; qC[m] -= q; } else { gF[k] += g; gF[m] += g; qF[k] += q; qF[m] -= q; } } } }
}
/* E_CNP: [0] the can's kJ/kg with its fusion, [1] its solidus, [2] a start for T in; the can's T to E_CL[0] and its molten share to csNClMl */
const E_CNP = new Float64Array(3);
function eCanPartA(c, k){ const H = E_CNP[0], ts = E_CNP[1], lat = PT.cladHfus[PT.coreCladRow[c]];
  E_CL[0] = ts; E_CL[4] = ts; eCladHA(c); const hs = E_CL[1];
  if(H <= hs){ ST.csNClMl[k] = 0; E_CL[3] = H; E_CL[0] = E_CNP[2]; eCladTA(c); }
  else if(H <= hs + lat){ ST.csNClMl[k] = (H - hs)/lat; E_CL[0] = ts; }
  else { ST.csNClMl[k] = 1; E_CL[3] = H - lat; E_CL[0] = E_CNP[2]; eCladTA(c); } }
/* E_MA: kg of fuel, can and Zr metal, kJ, kJ of it latent, decay weight: added to node k's free melt */
/* a lump under this share of its node's own nominal mass is a remnant: it takes no heat and a can remnant joins the melt */
const E_MA = new Float64Array(6), E_BLK_MAX = 0.99, E_LUMP_MIN = 1e-3;
function eMeltAddA(k){ const s = ST;
  s.csNMlF[k] += E_MA[0]; s.csNMlK[k] += E_MA[1]; s.csNMlZ[k] += E_MA[2]; s.csNMlE[k] += E_MA[3]; s.csNMlL[k] += E_MA[4]; s.csNMlDw[k] += E_MA[5]; }
/* E_ML: [0] K out (a start in), [1] kg fuel, [2] kg can, [3] kJ sensible in, [4] kJ/K out, [5] kg of concrete slag in (cleared):
   a melt's temperature on its materials' own laws */
const E_ML = new Float64Array(6);
function eMeltTA(c){ const F = E_ML[1], K = E_ML[2], S = E_ML[3], X = E_ML[5], cx = X*CORIUM.slagCp;
  let T = E_ML[0] > 300 ? E_ML[0] : 2500;
  for(let i=0;i<E_CLAD_NEWT;i++){
    E_FU[0] = T; eFuelHA(c); E_CL[0] = T; E_CL[4] = T; eCladHA(c);
    const f = F*E_FU[1] + K*E_CL[1] + cx*(T - E_T_STP) - S, d = F*E_FU[2] + K*E_CL[2] + cx;
    if(!(d > 0)) break;
    const T1 = Math.max(E_FUEL_TLO, Math.min(E_FUEL_THI, T - f/d)), dT = T1 - T; T = T1;
    if(dT < E_FUEL_DT && dT > -E_FUEL_DT) break; }
  E_ML[0] = T; E_ML[4] = F*E_FU[2] + K*E_CL[2] + cx; E_ML[5] = 0; }
/* the share of node k's flow volume its relocated material fills: solids over the node's own pins at debris density */
function eBlock(c, k){ const T = PT, q = k - c*XNN, dz = Math.max(T.coreCoreHgt[c], 0.05)/XNZ;
  const n0 = (T.coreFuelKg[c] + T.coreCladM[c])*nodeW[q], x = ST.csNFu[k] + ST.csNCl[k] - n0;
  return x > 1e-9*n0 ? Math.min(1, x/CORIUM.rhoDebris/(T.coreAFlow[c]*nodeW[q]*XNZ*dz)) : 0; }
/* a share f of node k's free melt moved to node m, or to the core's pool below it when m < 0 */
function eMeltMove(c, k, m, f){ const s = ST;
  const F = s.csNMlF[k]*f, K = s.csNMlK[k]*f, Z = s.csNMlZ[k]*f, E = s.csNMlE[k]*f, L = s.csNMlL[k]*f, D = s.csNMlDw[k]*f;
  s.csNMlF[k] -= F; s.csNMlK[k] -= K; s.csNMlZ[k] -= Z; s.csNMlE[k] -= E; s.csNMlL[k] -= L; s.csNMlDw[k] -= D;
  if(m >= 0){ s.csNMlF[m] += F; s.csNMlK[m] += K; s.csNMlZ[m] += Z; s.csNMlE[m] += E; s.csNMlL[m] += L; s.csNMlDw[m] += D; }
  else { s.csPlF[c] += F; s.csPlK[c] += K; s.csPlZ[c] += Z; s.csPlE[c] += E; s.csPlL[c] += L; s.csPlDw[c] += D; } }
/* kJ Q into node k's can lump, or its fuel lump when it has no can left */
function eLumpHeat(c, k, Q){ const s = ST, T = PT, cR = T.coreCladRow[c], mK = s.csNCl[k], mF = s.csNFu[k];
  const w = nodeW[k - c*XNN];
  if(mK > E_LUMP_MIN*T.coreCladM[c]*w){ E_CL[0] = s.csNTcl[k]; E_CL[4] = s.csNTcl[k]; eCladHA(c); eEcrA(c, k);
    E_CNP[0] = E_CL[1] + s.csNClMl[k]*T.cladHfus[cR] + Q/mK; E_CNP[1] = T.cladTsol[cR] + (T.cladTsolO[cR] - T.cladTsol[cR])*Math.max(0, Math.min(1, E_CR[0]));
    E_CNP[2] = s.csNTcl[k]; eCanPartA(c, k); s.csNTcl[k] = E_CL[0]; }
  else if(mF > E_LUMP_MIN*T.coreFuelKg[c]*w){ E_FU[0] = s.csNTf[k]; eFuelHA(c); E_FU[3] = E_FU[1] + Q/mF; eFuelTA(c, E_FUEL_NEWT, E_FUEL_DT); s.csNTf[k] = E_FU[0]; }
  else if(Q > 0){ E_MA[0] = 0; E_MA[1] = 0; E_MA[2] = 0; E_MA[3] = Q; E_MA[4] = 0; E_MA[5] = 0; eMeltAddA(k); } }
/* free melt: decay heat in it, down its own ring at the film speed, stopped by a node its debris has filled, frozen on pins under its
   solidus at MELCOR's per-material film, conducting into the pins it pools on and the crust below, spilling outward when its node is full.
   A tube core's melt waits at its bottom plane until it is past the pressure tube's own solidus */
function eCoreRelocA(c, dt){
  const s = ST, T = PT, nb = c*XNN, H = Math.max(T.coreCoreHgt[c], 0.05), dz = H/XNZ;
  const cR = T.coreCladRow[c], ceramic = T.cladZr[cR] && T.coreUo2W[c] > 0, tgF = ceramic ? CORIUM.ceramicT : T.coreTmelt[c], tsK = T.cladTsol[cR];
  const sh = Math.min(1, CORIUM.vCandle*dt/dz), aF = T.coreAFlow[c], aH = T.coreAHeat[c], tube = T.coreTube[c];
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k = nb + i*XNZ + j, M = s.csNMlF[k] + s.csNMlK[k];
    if(!(M > 0)) continue;
    if(j > 0){ if(eBlock(c, k - 1) < 1) eMeltMove(c, k, k - 1, sh); continue; }
    if(!tube){ eMeltMove(c, k, -1, sh); continue; }
    E_ML[0] = tsK; E_ML[1] = s.csNMlF[k]; E_ML[2] = s.csNMlK[k]; E_ML[3] = s.csNMlE[k] - s.csNMlL[k]; eMeltTA(c);
    if(E_ML[0] >= tsK) eMeltMove(c, k, -1, 1); }
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const q = i*XNZ + j, k = nb + q, F = s.csNMlF[k], K = s.csNMlK[k], M = F + K;
    if(!(M > 0)) continue;
    E_ML[0] = 2500; E_ML[1] = F; E_ML[2] = K; E_ML[3] = s.csNMlE[k] - s.csNMlL[k]; eMeltTA(c);
    const Tm = E_ML[0], cm = E_ML[4], tsm = (F*tgF + K*tsK)/M, hf = F >= K ? CORIUM.hFrzOx : CORIUM.hFrzMet, A = aH*nodeW[q];
    const Tp = s.csNCl[k] > E_LUMP_MIN*T.coreCladM[c]*nodeW[q] ? s.csNTcl[k] : s.csNFu[k] > E_LUMP_MIN*T.coreFuelKg[c]*nodeW[q] ? s.csNTf[k] : s.csNTc[k];
    if(Tp < tsm){
      E_FU[0] = tgF; eFuelHA(c); E_CL[0] = tsK; E_CL[4] = tsK; eCladHA(c);
      const up = Math.max(0, E_ML[3] - F*E_FU[1] - K*E_CL[1]);
      const dm = Math.min(M, hf*A*(tsm - Tp)*dt/1000/((s.csNMlL[k] + up)/M)), f = dm/M;
      const Ff = F*f, Kf = K*f, Ef = s.csNMlE[k]*f;
      s.csNDw[k] += s.csNMlDw[k]*f; s.csNZr[k] += s.csNMlZ[k]*f;
      s.csNMlF[k] -= Ff; s.csNMlK[k] -= Kf; s.csNMlZ[k] *= 1 - f; s.csNMlE[k] -= Ef; s.csNMlL[k] *= 1 - f; s.csNMlDw[k] *= 1 - f;
      let Ek = Ef;
      if(Ff > 0){ const m0 = s.csNFu[k]; E_FU[0] = tgF; eFuelHA(c); const hs = E_FU[1]; Ek -= Ff*hs;
        if(m0 > 0){ E_FU[0] = s.csNTf[k]; eFuelHA(c); E_FU[3] = (m0*E_FU[1] + Ff*hs)/(m0 + Ff); E_FU[0] = s.csNTf[k]; eFuelTA(c, E_FUEL_NEWT, E_FUEL_DT); s.csNTf[k] = E_FU[0]; }
        else s.csNTf[k] = tgF;
        s.csNFu[k] = m0 + Ff; }
      if(Kf > 0){ const m0 = s.csNCl[k];
        if(m0 > 0){ E_CL[0] = s.csNTcl[k]; E_CL[4] = s.csNTcl[k]; eCladHA(c); Ek += m0*(E_CL[1] + s.csNClMl[k]*T.cladHfus[cR]); }
        s.csNCl[k] = m0 + Kf; s.csNClMl[k] = 0; if(!(m0 > 0)) s.csNTcl[k] = tsK;
        E_CL[0] = s.csNTcl[k]; E_CL[4] = s.csNTcl[k]; eCladHA(c); eLumpHeat(c, k, Ek - s.csNCl[k]*E_CL[1]); }
      else eLumpHeat(c, k, Ek);
      continue; }
    /* a pool gives its heat to the pins standing in it and to the crust under it, never below its own solidus */
    const room = Math.max(0, cm*(Tm - Math.max(tsm, Tp)));
    let Q = Math.min(hf*A*Math.max(0, Tm - Tp)*dt/1000, room/2);
    if(Q > 0){ s.csNMlE[k] -= Q; eLumpHeat(c, k, Q); }
    if(j > 0 && eBlock(c, k - 1) >= 1){ const kb = k - 1, Tb = s.csNCl[kb] > E_LUMP_MIN*T.coreCladM[c]*nodeW[q - 1] ? s.csNTcl[kb] : s.csNTf[kb];
      Q = Math.min(CORIUM.hFrzOx*aF*ringW[i]*Math.max(0, Tm - Tb)*dt/1000, Math.max(0, room/2 - Q));
      if(Q > 0){ s.csNMlE[k] -= Q; eLumpHeat(c, kb, Q); } }
    if(i < XNR - 1){ const cap = aF*nodeW[q]*XNZ*dz*(1 - eBlock(c, k))*CORIUM.rhoDebris;
      if(M > cap) eMeltMove(c, k, k + XNZ, (M - cap)/M); } }
}
/* E_SH: [0] K, [1] J/kg over 0 C, [2] cp J/kg/K: the head's steel, EN 1993-1-2's carbon steel cp integrated piece by piece */
const E_SH = new Float64Array(3);
function eSteelPoly(t){ const q = CORIUM.hdCp; return (((q[3]/4*t + q[2]/3)*t + q[1]/2)*t + q[0])*t; }
const E_SH_600 = eSteelPoly(600), E_SH_735 = E_SH_600 + CORIUM.hdCp[4]*135 - CORIUM.hdCp[5]*Math.log((CORIUM.hdCp[6] - 735)/(CORIUM.hdCp[6] - 600)),
  E_SH_900 = E_SH_735 + CORIUM.hdCp[7]*165 + CORIUM.hdCp[8]*Math.log((900 - CORIUM.hdCp[9])/(735 - CORIUM.hdCp[9]));
function eSteelHA(){ const q = CORIUM.hdCp, t = E_SH[0] - 273.15;
  if(t < 600){ E_SH[1] = eSteelPoly(t); E_SH[2] = ((q[3]*t + q[2])*t + q[1])*t + q[0]; }
  else if(t < 735){ E_SH[1] = E_SH_600 + q[4]*(t - 600) - q[5]*Math.log((q[6] - t)/(q[6] - 600)); E_SH[2] = q[4] + q[5]/(q[6] - t); }
  else if(t < 900){ E_SH[1] = E_SH_735 + q[7]*(t - 735) + q[8]*Math.log((t - q[9])/(735 - q[9])); E_SH[2] = q[7] + q[8]/(t - q[9]); }
  else { E_SH[1] = E_SH_900 + q[10]*(t - 900); E_SH[2] = q[10]; } }
/* E_SH[1] in, E_SH[0] a start: the steel's K out, Newton kept inside a bracket across the Curie peak */
function eSteelTA(){ const h = E_SH[1], tol = 1e-13*(h > 0 ? h : -h) + 1e-9; let T = E_SH[0], lo = 200, hi = 3000;
  for(let i=0;i<E_CLAD_NEWT;i++){ E_SH[0] = T; eSteelHA(); const f = E_SH[1] - h;
    if(f < tol && f > -tol) break;
    if(f > 0) hi = T; else lo = T;
    let T1 = T - f/E_SH[2]; if(!(T1 > lo && T1 < hi)) T1 = (lo + hi)/2;
    T = T1; }
  E_SH[0] = T; E_SH[1] = h; }
/* E_CRP: [0] MPa, [1] K in, [2] hours to rupture out (E_INF under the creep range) */
const E_CRP = new Float64Array(3), E_KSI = 6.894757;
function eCreepA(){ const s = E_CRP[0]/E_KSI, T = E_CRP[1], R = T*1.8;
  if(!(s > 0) || T < CORIUM.creepT0){ E_CRP[2] = E_INF; return; }
  const l = Math.log10(s);
  if(T < CORIUM.creepT1){ const a = CORIUM.lmpLo; E_CRP[2] = Math.pow(10, (a[0] + a[1]*l)*1000/R - a[2]); }
  else { const a = CORIUM.lmpHi; E_CRP[2] = Math.pow(10, (((a[3]*l + a[2])*l + a[1])*l + a[0])*1000/R - a[4]); } }
/* E_LH: [0] the pool's K, [1] its solidus, [2] kW to the core's water, [3] kW down into the head, [4] kW up to the lowest plane,
   [5] the pool's height m, [6] Ra', [7] the downward flux's peak W/m2. E_LHA: the pool's F, K, E before this tick's relocation, then Tcold */
const E_LH = new Float64Array(8), E_LHA = new Float64Array(4);
/* E_MLP in: [0] kg fuel, [1] kg can, [2] kg concrete slag, [3] kJ, [4] kJ of fusion it can hold, [5] slag solidus K;
   out: [6] K, [7] mixed solidus K, [8] kJ of fusion held. A pool's temperature off its enthalpy, pinned at its solidus while it freezes */
const E_MLP = new Float64Array(9);
function eMeltPoolTA(c){ const T = PT, F = E_MLP[0], K = E_MLP[1], X = E_MLP[2], E = E_MLP[3], Lc = E_MLP[4], cR = T.coreCladRow[c];
  const tgF = T.cladZr[cR] && T.coreUo2W[c] > 0 ? CORIUM.ceramicT : T.coreTmelt[c], tsK = T.cladTsol[cR], ts = (F*tgF + K*tsK + X*E_MLP[5])/(F + K + X);
  E_FU[0] = ts; eFuelHA(c); E_CL[0] = ts; E_CL[4] = ts; eCladHA(c);
  const Hs = F*E_FU[1] + K*E_CL[1] + X*CORIUM.slagCp*(ts - E_T_STP);
  E_MLP[7] = ts;
  if(E >= Hs && E <= Hs + Lc){ E_MLP[6] = ts; E_MLP[8] = E - Hs; return; }
  E_ML[0] = ts; E_ML[1] = F; E_ML[2] = K; E_ML[5] = X; E_ML[3] = E < Hs ? E : E - Lc; eMeltTA(c); E_MLP[6] = E_ML[0]; E_MLP[8] = E < Hs ? 0 : Lc; }
function eLhPoolTA(c){ const s = ST;
  E_MLP[0] = s.csPlF[c]; E_MLP[1] = s.csPlK[c]; E_MLP[2] = 0; E_MLP[3] = s.csPlE[c]; E_MLP[4] = s.csPlL[c]; E_MLP[5] = 0; eMeltPoolTA(c);
  E_LH[0] = E_MLP[6]; E_LH[1] = E_MLP[7]; }
/* the pool below the core in a hemispherical head: arrivals quenched through the lower plenum's water; ACOPO's up and down
   Nusselt numbers on its own Ra' off its crust at the solidus, or conduction out of a solid bed; the downward peak into a
   two-lump wall, creep life on the VIP fit, penetrations at low pressure. No head for a tube core */
function eLhStep(c, dt){
  const s = ST, T = PT, R = T.coreVesR[c], tw = T.coreVesWall[c];
  E_LH[2] = 0; E_LH[3] = 0; E_LH[4] = 0; E_LH[5] = 0; E_LH[6] = 0; E_LH[7] = 0;
  const F = s.csPlF[c], K = s.csPlK[c], M = F + K, Tw = E_CS[2], wet = T.coreWater[c] && s.csLvl[c] > -T.coreVesClr[c];
  if(!(M > 0) || !(R > 0) || !(tw > 0)){ if(!s.csHdFail[c]){ s.csHdTi[c] = E_LHA[3]; s.csHdTo[c] = E_LHA[3]; } return; }
  const aF = F - E_LHA[0], aK = K - E_LHA[1], aE = s.csPlE[c] - E_LHA[2];
  if(wet && aF + aK > 0){ E_FU[0] = Tw; eFuelHA(c); E_CL[0] = Tw; E_CL[4] = Tw; eCladHA(c);
    const q = Math.min(1, E_FCI_ETA*(1 - Math.exp(-dt/E_FCI_TAU)))*Math.max(0, aE - aF*E_FU[1] - aK*E_CL[1]);
    s.csPlE[c] -= q; E_LH[2] += q/dt; }
  const V = M/CORIUM.rhoDebris, Vh = 2/3*Math.PI*R*R*R;
  let H, aDn, aUp;
  if(V < Vh){ H = Math.sqrt(V/(Math.PI*R));
    for(let i=0;i<E_CLAD_NEWT;i++){ const f = Math.PI*H*H*(R - H/3) - V, d = f/(Math.PI*H*(2*R - H)); H -= d; if(d < 1e-12*R && d > -1e-12*R) break; }
    aDn = 2*Math.PI*R*H; aUp = Math.PI*H*(2*R - H); }
  else { H = R + (V - Vh)/(Math.PI*R*R); aDn = 2*Math.PI*R*H; aUp = Math.PI*R*R; }
  E_LH[5] = H;
  eLhPoolTA(c); const Tp = E_LH[0], ts = E_LH[1];
  E_FU[0] = Tp; eFuelHA(c); E_CL[0] = Tp; E_CL[4] = Tp; eCladHA(c);
  const cp = (F*E_FU[2] + K*E_CL[2])/M*1000, rm = CORIUM.rhoMelt, mu = CORIUM.muMelt, kM = CORIUM.kMelt;
  const Tq = Math.max(Tp, ts), rho = rm[0] - rm[1]*(Tq - rm[2]), nu = mu[0]*Math.exp(mu[1]/Tq)/rho, al = kM/(rho*cp);
  const qv = s.csDecay[c]*T.coreRated[c]*1e6*s.csPlDw[c]/V;
  const ra = Math.max(E_G_MS2*rm[1]/rho*qv*Math.pow(H, 5)/(al*nu*kM), 0), up = CORIUM.acopoUp, dn = CORIUM.acopoDn;
  E_LH[6] = ra;
  const dTc = Math.max(0, Tp - ts), Ti = s.csHdTi[c], gc = 2*kM/H;
  const Tsk = wet ? Tw : s.csNTcl[c*XNN];
  let qD = Math.max(dn[0]*Math.pow(ra, dn[1])*kM/H*dTc, gc*(Tp - Ti)), qU = Math.max(up[0]*Math.pow(ra, up[1])*kM/H*dTc, gc*(Tp - Tsk));
  qD = Math.max(qD, 0); qU = Math.max(qU, 0);
  E_FU[0] = Ti; eFuelHA(c); E_CL[0] = Ti; E_CL[4] = Ti; eCladHA(c);
  const room = Math.max(0, s.csPlE[c] - F*E_FU[1] - K*E_CL[1])/2, want = (qD*aDn + qU*aUp)*dt/1000, cut = want > room ? room/want : 1;
  const QD = qD*aDn*dt/1000*cut, QU = qU*aUp*dt/1000*cut;
  s.csPlE[c] -= QD + QU;
  E_LH[3] = QD/dt;
  if(wet) E_LH[2] += QU/dt;
  else { E_LH[4] = QU/dt; for(let i=0;i<XNR;i++) eLumpHeat(c, c*XNN + i*XNZ, QU*ringW[i]); }
  const qPk = (wet ? CORIUM.peakWet : CORIUM.peakDry)*QD*1000/dt/aDn, mw = CORIUM.hdRho*tw/2, To = s.csHdTo[c];
  E_LH[7] = qPk;
  const th = (Ti + To)/2 - 273.15, kS = th < 800 ? CORIUM.hdK[0] - CORIUM.hdK[1]*th : CORIUM.hdK[2], qx = 2*kS/tw*(Ti - To);
  E_SH[0] = Ti; eSteelHA(); E_SH[1] += (qPk - qx)*dt/mw; eSteelTA(); s.csHdTi[c] = E_SH[0];
  E_SH[0] = To; eSteelHA(); E_SH[1] += qx*dt/mw; eSteelTA(); s.csHdTo[c] = E_SH[0];
  if(s.csHdFail[c]) return;
  E_CRP[0] = (s.csPCore[c] - ROOM_P0/1000 + M*E_G_MS2/(Math.PI*R*R)/1e6)*R/(2*tw); E_CRP[1] = (s.csHdTi[c] + s.csHdTo[c])/2; eCreepA();
  s.csHdLife[c] += dt/3600/E_CRP[2];
  const why = s.csHdLife[c] >= 1 ? 1 : s.csPCore[c] < CORIUM.penP && s.csHdTi[c] > (T.coreBoils[c] ? CORIUM.penBwr : CORIUM.penPwr) ? 2 : 0;
  if(!why) return;
  s.csHdFail[c] = 1; s.csHdWhy[c] = why;
  if(!s.csBreach[c]){ s.csBreach[c] = 1; if(s.csTrip[c] === E_TRIP_NONE){ s.csTrip[c] = E_TRIP_VESSEL; s.csTripArg[c] = -1; } }
  eEvent(EV_HEAD_FAIL, c, why);
}
/* per plane off last tick's heat into the liquid less the inflow's subcooling: wetted share, steam off its top kg/s, pool void, flooding margin S_max/S; E_LVW [0] steam kg/s, [1] top wet plane */
const E_WET = new Float64Array(XNZ), E_LVS = new Float64Array(XNZ), E_LVA = new Float64Array(XNZ), E_LVF = new Float64Array(XNZ);
const E_LVW = new Float64Array(2), E_LVL = new Float64Array(1);
const E_NU_LAM = 4.36;
/* Wallis flooding, C_w^2 = 1.22 (L_B/D_he)^0.12 (rho_g/rho_f)^-0.032 (1 + 0.055 Bo - 4.08e-3 Bo^2): Park et al. (1997) as Chun, Moon & Yang (KNS 2000) eq. 17 rewrote it, Bo held to their data (Table 1) */
const E_CW_A = 1.22, E_CW_L = 0.12, E_CW_R = -0.032, E_CW_B1 = 0.055, E_CW_B2 = -4.08e-3, E_CW_BLO = 4.25, E_CW_BHI = 10.0;
function eCoreLevelA(c, cl){
  const s = ST, T = PT, nb = c*XNN, H = Math.max(T.coreCoreHgt[c], 0.05), dz = H/XNZ, cov = cl >= 1;
  E_LVW[0] = 0; E_LVW[1] = XNZ - 1;
  for(let j=0;j<XNZ;j++){ E_LVS[j] = 0; E_LVA[j] = 0; E_LVF[j] = E_INF; if(cov) E_WET[j] = 1; }
  if(cov) s.csLvlMix[c] = Math.max(s.csLvl[c], H);
  if(cov && T.coreGas[c]) return;
  const S0 = T.coreSat[c], aF = Math.max(T.coreAFlow[c], 1e-9), dhy = Math.max(T.coreDh[c], 1e-4), dhe = 4*aF*H/Math.max(T.coreAHeat[c], 1e-9);
  const wIn = Math.max(E_CS[4], 0)*T.coreG0[c]*aF, qSub = wIn*Math.max(0, T.coreCp[c]*E_CS[2] - E_CS[6]);
  let L = Math.max(cl, 0)*H, z = 0, jl = 0, below = 0, j0 = -1;
  for(let j=0;j<XNZ;j++){ let p = 0;
    for(let i=0;i<XNR;i++) p += s.csNQl[nb + i*XNZ + j];
    /* the pool's own drift flux on the steam its wetted length below makes; the liquid feeding the boil above is a few per cent of j_g and left out */
    E_RV[0] = E_AXS[j]; curveA(S0, CV_RG, E_RV, 0, 2); curveA(S0, CV_RF, E_RV, 0, 3); E_RV[4] = E_AXS[j]; eVgjA(S0);
    const rg = E_RV[2], rf = E_RV[3], top = below + p;
    const jg = Math.max(below + p/2 - qSub, 0)/(rg*E_AXFG[j]*aF), a = jg > 0 ? jg/(XC0*jg + E_RV[4]) : 0;
    E_LVA[j] = a; E_LVS[j] = Math.max(top - qSub, 0)/E_AXFG[j];
    if(j0 < 0 && top > qSub) j0 = j;
    /* liquid has to come down against the steam only where the inflow does not carry it; L_B from the bottom of the first steaming plane is a FIT */
    if(E_LVS[j] > wIn){
      E_RV[1] = E_AXS[j]; sigmaA(S0, E_RV, 1, 1);
      const dr = Math.max(rf - rg, 1e-3), gd = Math.sqrt(E_G_MS2*dhy*dr), sg = E_RV[1];
      const bo = sg > 0 ? Math.max(E_CW_BLO, Math.min(E_CW_BHI, dhy*Math.sqrt(E_G_MS2*dr/sg))) : E_CW_BHI;
      const cw = Math.sqrt(E_CW_A*Math.pow((j - j0 + 1)*dz/dhe, E_CW_L)*Math.pow(rg/rf, E_CW_R)*(1 + E_CW_B1*bo + E_CW_B2*bo*bo));
      const ka = 1/Math.sqrt(aF*Math.sqrt(rg)*gd), kb = 1/Math.sqrt(aF*Math.sqrt(rf)*gd), d2 = ka*ka - kb*kb;
      const sMax = ka*Math.sqrt(wIn) >= cw ? wIn : Math.pow((ka*cw - kb*Math.sqrt(cw*cw - d2*wIn))/d2, 2);
      E_LVF[j] = sMax/E_LVS[j]; }
    below = top;
    if(cov) continue;
    const need = (1 - a)*dz, w = Math.max(0, Math.min(1, L/need));
    E_WET[j] = w; L -= w*need; z += w*dz; if(w > 0) jl = j; }
  if(cov) return;
  s.csLvlMix[c] = z;
  E_LVW[0] = Math.max(below - qSub, 0)/E_AXFG[jl]; E_LVW[1] = jl;
}
/* E_STV: [0] kJ/kg, [1] MPa, [2] K start in, K out; E_STM the steam's v, h, c_p there */
const E_STV = new Float64Array(3), E_STM = new Float64Array(3);
function eSteamTA(){ const h = E_STV[0], p = E_STV[1], tol = 1e-13*h; let T = E_STV[2], lo = 273.16, hi = 1e4;
  for(let i=0;i<E_CLAD_NEWT;i++){ if97Steam(T, p, E_STM); const f = E_STM[1] - h;
    if(f < tol && f > -tol) break;
    if(f > 0) hi = T; else lo = T;
    let T1 = T - f/E_STM[2]; if(!(T1 > lo && T1 < hi)) T1 = (lo + hi)/2;
    T = T1; }
  if97Steam(T, p, E_STM); E_STV[2] = T; }
/* over a dry node, what it gave the steam, kW; each ring's steam temperature leaving the core */
const E_STQ = new Float64Array(XNN), E_STX = new Float64Array(XNR);
function eCoreStep(c){
  const dt = E_CS[0], heat = E_CS[1], sat = E_CS[2], cl = E_CS[3], mflux = E_CS[4], flowFrac = E_CS[5], hIn = E_CS[6];
  const s = ST, T = PT, nb = c*XNN, rb = c*XNR, S0 = T.coreSat[c], pCore = s.csPCore[c];
  eCoreAxialA(c, mflux);
  /* parallel channels hang between the same two plena and take the same drop, so the split is the momentum
     relation over the stated core drop: the inlet throttle is single-phase and only the heated length's
     friction carries the two-phase multiplier. Gravity's own counter-term is not in the split. */
  { let tot = 0, phiB = 0;
    for(let i=0;i<XNR;i++){
      const g = Math.max(mflux*s.csChW[rb+i], 1e-3);
      let x = 0;
      for(let j=0;j<XNZ;j++){ E_VQ[0] = s.csNV[nb+i*XNZ+j]; E_VQ[1] = E_AXRV[j]; E_VQ[3] = E_AXD[j]/g; eVoidQualA();
        x += E_VQ[2]*(1/Math.max(E_AXRV[j], 1e-6) - 1); }
      s.csChW[rb+i] = 1 + x/XNZ;
      phiB += ringW[i]*s.csChW[rb+i]; }
    const dpF = E_AX[2], dpT = Math.max(T.coreDp[c] - dpF, 0), iB = phiB > 1e-9 ? 1/phiB : 0;
    for(let i=0;i<XNR;i++){
      /* debris in a ring's channels: its planes' resistances in series, each over the open share squared */
      let rb2 = 0; for(let j=0;j<XNZ;j++){ const b = Math.min(eBlock(c, nb + i*XNZ + j), E_BLK_MAX); rb2 += 1/((1 - b)*(1 - b)); }
      rb2 /= XNZ;
      s.csChW[rb+i] = 1/Math.sqrt(Math.max((dpT + dpF*s.csChW[rb+i]*iB)*rb2, 1e-12));
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
  const ff = Math.max(flowFrac, 1e-3), dhSub = cp*(sat - Tcold);
  const gSolid = T.coreGSolid[c], cladR = T.coreCladR[c], filmPool = T.coreFilmPool[c], fuelKg = Math.max(T.coreFuelKg[c], 1e-9);
  const gGap = T.coreGGap[c], rp = T.coreRp[c], cAl = T.coreCladAl[c], fgFill = T.coreFgFill[c], fgInv = T.coreFgInv[c], uo2 = T.coreUo2W[c], tdmg = T.coreTdmg[c], salt = T.coreSalt[c], tRes = T.coreFgTres[c];
  const xSub = T.coreXSub[c], xSubLo = T.coreXSubLo[c], tmelt = T.coreTmelt[c], oxid = T.coreOxid[c];
  const cladKg = T.coreCladM[c], rodPF = T.coreRodPFill[c], fuse = T.coreFuseKJ[c], disp = T.coreDispKJ[c], cR = T.coreCladRow[c];
  const cTs = T.cladTsol[cR], cTsO = T.cladTsolO[cR], cLat = T.cladHfus[cR], cShT = T.cladShT[cR], cShOx = T.cladShOx[cR], cBurst = T.cladBurstOn[cR], ceramic = T.cladZr[cR] && uo2 > 0;
  const gI = T.coreGI[c], gX = T.coreGX[c], lamI = T.coreLamI[c], lamX = T.coreLamX[c], sig = T.coreSig[c];
  const gP = T.coreGP[c], lamP = T.coreLamP[c], sigS = T.coreSigS[c], KSM = T.coreKSM[c];
  const aF = T.coreAF[c], aM = T.coreAM[c], aX = T.coreAX[c], aS = T.coreAS[c], aV = T.coreAV[c], KXE = T.coreKXE[c];
  const TfRef = T.coreTfRef[c], Tref = T.coreTref[c], rodA = T.coreRodA[c], tipRho = T.coreTipRho[c], poison = T.corePoison[c];
  const n = s.csN[c], dryout = T.coreDryout[c];
  const hDec = s.csDecay[c], hPr = heat - hDec, gKg = T.coreGraphKg[c], gRk = T.coreGRk[c], gRi = T.coreGRi[c], gRf = T.coreGRf[c], mRow = MODER[T.coreModRow[c]], aG = T.coreAG[c], TgRef = T.coreTgRef[c], rk = rated*1000;
  const gKgC = T.coreGraphKgC[c], gRkC = T.coreGRkC[c], gRiC = T.coreGRiC[c], gRfC = T.coreGRfC[c], gRkS = T.coreGRkS[c], gRgS = T.coreGRgS[c];
  const wC = gKgC > 0 ? gKgC/(gKg + gKgC) : 0, cpsA = T.coreCpsA[c], cpsB = T.coreCpsB[c], cpsK = T.coreCpsKey[c], cpsW0 = T.coreCpsW0[c], cWet = T.coreCpsWet[c];
  let Tw = CPS_T;
  if(cpsA >= 0 && cpsB >= 0){ eNodeTA(cpsA); Tw = E_NT[MX_T]; eNodeTA(cpsB); Tw = (Tw + E_NT[MX_T])/2; }
  const filmC = cpsW0 > 0 && cpsK >= 0 ? Math.max(Math.pow(Math.abs(SX.netRunW[cpsK])/cpsW0, 0.8), T.coreFilmPool[c]) : T.coreFilmPool[c];
  let gOut = 0, fOut = 0, dOut = 0, cOut = 0;
  let dnbLo = 1e30, dnbK = 0, TclH = 0, ecrH = 0, h2 = 0, oxP = 0, fciE = 0;
  const disK = SX.coreDisK, spG = SX.coreSpG, spQ = SX.coreSpQ, spGC = SX.coreSpGC, spQC = SX.coreSpQC;
  for(let k=0;k<XNN;k++) disK[k] = 0;
  eCoreSpread(c);
  eCoreLevelA(c, cl);
  const water = T.coreWater[c], wst = E_LVW[0], jl = E_LVW[1], aFl = Math.max(T.coreAFlow[c], 1e-9), dhy = Math.max(T.coreDh[c], 1e-4);
  let h0 = 0;
  if(water){ if97Steam(E_AXS[jl], E_AXP[jl], E_STM); h0 = E_STM[1]; }
  /* what already left its pins takes its decay heat before anything moves this tick */
  if(dt > 0 && !salt){ const pk = s.csDecay[c]*T.coreRated[c]*1000;
    for(let k=nb;k<nb+XNN;k++) if(s.csNMlDw[k] > 0) s.csNMlE[k] += pk*s.csNMlDw[k]*dt;
    s.csPlE[c] += pk*s.csPlDw[c]*dt; }
  for(let i=0;i<XNR;i++){
    const chan = Math.max(s.csChW[rb+i], 1e-3);
    const dhu = riseH*mixK[i]/(XNZ*ff*chan);
    const film0 = Math.max(Math.pow(Math.max(mflux*chan, 0), 0.8), filmPool);
    const gCh = Math.max(mflux*chan, 1e-3);
    let h = hIn, fgRel = 0;
    { let w = 0; for(let j=0;j<XNZ;j++){ const q = i*XNZ + j; E_FGR[1] = s.csNFg[nb+q]; eFgFracA(); fgRel += nodeW[q]*E_FGR[0]*T.coreNFg[nb+q]; w += nodeW[q]; }
      fgRel = w > 0 ? fgRel/w : 0; }
    const fgX = fgRel/(fgFill + fgRel), wi = wst*ringW[i];
    let hs = h0, Tst = E_AXS[jl];
    for(let j=0;j<XNZ;j++){
      const q = i*XNZ + j, k = nb + q, pw = s.csPhi[k], wet = E_WET[j];
      /* dry node: steam T off its carried h, film Dittus-Boelter (Nu floor 4.36) at that state, capped by effectiveness-NTU */
      let hst = 0, fqN = 0;
      if(wet === 0){
        if(water){ E_STV[0] = hs; E_STV[1] = E_AXP[j]; E_STV[2] = Tst; eSteamTA(); Tst = E_STV[2];
          if(wi > 0){ STR[0] = Tst; STR[1] = 1/E_STM[0]; steamTrA();
            const re = wst/aFl*dhy/STR[2], pr = E_STM[2]*1000*STR[2]/STR[3], hf = Math.max(0.023*Math.pow(re, 0.8)*Math.pow(pr, 0.4), E_NU_LAM)*STR[3]/dhy;
            const gW = wi*E_STM[2]*1000; hst = gW*(1 - Math.exp(-hf*aHeat*nodeW[q]/gW))/(1000*pinUA*nodeW[q]); } }
        else Tst = E_AXS[j];
        if(dt > 0) s.csNTc[k] = Tst; }
      if(!(dt > 0)){ T.coreNPhi0[k] = pw; s.csNDw[k] = nodeW[q]*pw; }
      /* fission follows the fuel the node holds, decay heat the decay weight it holds */
      const nomF = fuelKg*nodeW[q], mFu = s.csNFu[k], mK = s.csNCl[k], fu = salt ? 1 : mFu/nomF;
      const pwP = pw*fu, pwD = salt || !(dt > 0) ? pw : s.csNDw[k]/nodeW[q], one = pwP === pwD;
      eHeatSplitA(c, k);
      const eW = E_HSP[E_HS_WP] + E_HSP[E_HS_SP] + E_HSP[E_HS_AP], eWD = E_HSP[E_HS_WD] + E_HSP[E_HS_SD] + E_HSP[E_HS_AD];
      const qWs = one ? pw*(hPr*eW + hDec*eWD) : pwP*hPr*eW + pwD*hDec*eWD;
      const qBs = one ? pw*(hPr*E_HSP[E_HS_BP] + hDec*E_HSP[E_HS_BD]) : pwP*hPr*E_HSP[E_HS_BP] + pwD*hDec*E_HSP[E_HS_BD];
      const qCs = one ? pw*(hPr*E_HSP[E_HS_CP] + hDec*E_HSP[E_HS_CD]) : pwP*hPr*E_HSP[E_HS_CP] + pwD*hDec*E_HSP[E_HS_CD];
      const gin = qBs*rk*nodeW[q], ginF = gin*(1 - wC), qCw = qCs*rk*nodeW[q], ginC = gin*wC + (cWet ? 0 : qCw);
      let gw = 0, gwC = 0, gs = 0;
      if(gKg > 0 && gRk > 0){ E_GCP[0] = s.csNTg[k]; mRow.kA(E_GCP, 0, 2); gw = nodeW[q]/(1000*(gRk/E_GCP[2] + gRi + gRf/film0)); }
      if(gKgC > 0){ E_GCP[0] = s.csNTgC[k]; mRow.kA(E_GCP, 0, 2); gwC = nodeW[q]/(1000*(gRkC/E_GCP[2] + gRiC + gRfC/filmC));
        if(gRkS > 0){ E_GCP[0] = (s.csNTg[k] + s.csNTgC[k])/2; mRow.kA(E_GCP, 0, 2); gs = nodeW[q]/(1000*(gRkS/E_GCP[2] + gRgS)); } }
      const sF = spQ[k], sC = spQC[k];
      if(!(dt > 0)){
        const eF = spG[k], eC = spGC[k];
        if(gKgC > 0){ const a11 = gw + gs + eF, a22 = gwC + gs + eC, det = a11*a22 - gs*gs, b1 = ginF + gw*s.csNTc[k] + sF + eF*s.csNTg[k], b2 = ginC + gwC*Tw + sC + eC*s.csNTgC[k];
          if(det > 0){ s.csNTg[k] = (b1*a22 + gs*b2)/det; s.csNTgC[k] = (a11*b2 + gs*b1)/det; } }
        else if(gw > 0) s.csNTg[k] = s.csNTc[k] + (gin + sF + eF*(s.csNTg[k] - s.csNTc[k]))/(gw + eF); }
      const gx = gw > 0 ? gw*(s.csNTg[k] - s.csNTc[k]) : ginF, gcx = gwC*(s.csNTgC[k] - Tw), qs = gs*(s.csNTg[k] - s.csNTgC[k]);
      if(gw > 0 && dt > 0){ E_GCP[0] = s.csNTg[k]; mRow.cpA(E_GCP, 0, 1); s.csNTg[k] += (ginF - gx - qs + sF)*dt/(gKg*nodeW[q]*E_GCP[1]); }
      if(gKgC > 0 && dt > 0){ E_GCP[0] = s.csNTgC[k]; mRow.cpA(E_GCP, 0, 1); s.csNTgC[k] += (ginC - gcx + qs + sC)*dt/(gKgC*nodeW[q]*E_GCP[1]); }
      gOut += gx; cOut += gcx + (cWet ? qCw : 0);
      const qPin = ((one ? qhat*pw : (hPr*pwP + hDec*pwD)*rk/pinUA) - (qWs + qBs + qCs)*rk/pinUA)*(1 - s.csNDisp[k]);
      dOut += qWs*nodeW[q];
      /* the water's own march needs the flux before the film it sets is known, so it runs on the last tick's film */
      let out = dt > 0 && !salt ? s.csNHc[k]*(s.csNTcl[k] - s.csNTc[k]) : qPin;
      const qw = out*pinUA/rk;
      const satz = E_AXS[j], hSatz = cp*satz;
      const dh = dhu*(qw + gx/(rk*nodeW[q]) + qWs), hMid = h + dh/2; h += dh;
      s.csNTct[k] = wet === 0 ? Tst : hMid <= hSatz ? hMid/cp : satz;
      const q2 = Math.max(qw, 0);
      const xd = -Math.max(Math.min(xSub*q2/gCh, xSubLo*q2), 1e-6);
      const xe = (hMid - hSatz)/E_AXFG[j];
      E_VQ[0] = xe; E_VQ[1] = xd; eSubQualA(); E_VQ[0] = E_VQ[2]; E_VQ[1] = E_AXRV[j]; E_VQ[3] = E_AXD[j]/gCh; eDriftFluxA();
      /* a march past x = 1 under the level cannot carry its heat: the pool's own drift flux holds the void there */
      const aw = wet > 0 && xe >= 1 ? E_LVA[j] : E_VQ[2];
      s.csNVt[k] = aw + (1 - wet)*(1 - aw);
      E_MN[0] = q2; E_MN[1] = hMid/cp - Tcold; E_MN[2] = Tcold; E_MN[3] = s.csNTf[k];
      E_MN[4] = mflux*chan; E_MN[5] = xe; E_MN[6] = dhSub; E_MN[8] = E_AXP[j]; E_MN[9] = E_LVA[j]; E_MN[10] = E_LVF[j]; eMarginNode(c);
      const dnb = E_MN[7];
      if(dnb < dnbLo){ dnbLo = dnb; dnbK = q; }
      const hCsp = film0*wet/cladR;
      const hCnb = Math.max(out, 0)*wet/Math.max(satz + JL_K*Math.pow(Math.max(qpp0*q2, 1)/1e6, 0.25)*E_AXJL[j] - Math.min(s.csNTc[k], satz), 1e-3);
      const hCw = Math.max(hCsp, hCnb);
      /* a dissolved fuel has no pin: the fission heat is born in the salt and the fuel temperature is the salt's */
      if(salt){ s.csNDnb[k] = 0; s.csNFilm[k] = film0; s.csNHc[k] = film0; s.csNTf[k] = s.csNTc[k]; s.csNTcl[k] = s.csNTc[k]; SX.coreGapH[k] = 0; SX.coreGapT[k] = s.csNTc[k];
        if(s.csNTc[k] > TclH) TclH = s.csNTc[k]; }
      else {
        /* the rest gap is H_GAP at its own rest gas; the pellet outgrowing the clad narrows it to the roughness, gas let go since poisons it */
        const gRef = gSolid*gGap/(gSolid + gGap), Tg = s.csNTc[k] + (s.csNTf[k] - s.csNTc[k])*gRef/(gRef + hCw);
        if(!(dt > 0)){ T.coreNTg0[k] = Tg; T.coreNTf0[k] = s.csNTf[k]; T.coreNFg[k] = fgInv*uo2*pw; T.coreNX0[k] = fgX; }
        E_FS[0] = s.csNTf[k]; eFuelStrainA(c); const e1 = E_FS[1];
        E_FS[0] = T.coreNTf0[k]; eFuelStrainA(c);
        const grow = rp*(e1 - E_FS[1]) - rp*cAl*(Tg - T.coreNTg0[k]);
        E_GKIO[0] = T.coreNTg0[k]; E_GKIO[1] = T.coreNX0[k]; eGasKA(); const k0 = E_GKIO[2];
        E_GKIO[0] = Tg; E_GKIO[1] = fgX; eGasKA();
        const gapM = Math.max(k0 - H_GAP*grow, H_GAP*GAP_ROUGH)/E_GKIO[2];
        const gS = 1/(1/gSolid + gapM/gGap);
        SX.coreGapH[k] = H_GAP/gapM; SX.coreGapT[k] = Tg;
        s.csNDnb[k] = !dryout ? 0 : dnb < 1 ? 1 : (s.csNDnb[k] && s.csNTcl[k] - satz > E_DT_LEID) ? 1 : 0;
        const hC = (s.csNDnb[k] ? hCsp*E_DNB_FILM : hCw) + hst;
        const film = gS*hC/Math.max(gS + hC, 1e-12);
        const Tcl0 = s.csNTcl[k];
        /* at rest a rod has let go of what its time in the core at this temperature gives */
        { const dr = uo2 > 0 && s.csNTf[k] > tdmg ? E_FG_D0*Math.exp(-E_FG_Q/s.csNTf[k])/(E_FG_A*E_FG_A) : 0;
          s.csNFg[k] = dt > 0 ? s.csNFg[k] + dr*dt : dr*tRes; }
        let qOx = 0;
        const burst = s.csNDmg[k];
        /* the reaction runs on the Zr metal the node still holds, wherever it came from */
        if(dt > 0 && oxid && Tcl0 > E_OX_T0 && s.csNV[k] > E_OX_VMIN && s.csNZr[k] > 0){
          const o0 = s.csNOx[k], i0 = s.csNOxI[k];
          E_OXR[0] = Tcl0; eOxRateA(); const r = E_OXR[1]*dt;
          let dO = Math.sqrt(o0*o0 + r) - o0, dI = burst > 0 ? Math.sqrt(i0*i0 + r) - i0 : 0;
          let dm = ZR_RHO*(dO + burst*dI)/ZR_PBR*aHeat*nodeW[q];
          if(dm > s.csNZr[k]){ const w = s.csNZr[k]/dm; dO *= w; dI *= w; dm = s.csNZr[k]; }
          s.csNOx[k] = o0 + dO; s.csNOxI[k] = i0 + dI; s.csNZr[k] -= dm;
          h2 += ZR_H2*dm;
          qOx = ZR_QOX*dm/(1000*dt*nodeW[q]*pinUA); }
        eEcrA(c, k); if(E_CR[0] > ecrH) ecrH = E_CR[0];
        const ecr = E_CR[0];
        oxP += qOx*nodeW[q];
        let Tn, Tcl;
        /* the pellet across its gap and wall to the clad, the clad across its film to the water: the linear pair solved exactly over the tick, each lump's h then moved by what crossed */
        if(dt > 0){ const Tf0 = s.csNTf[k], Tc0 = s.csNTc[k], mFw = fuelKg*Math.max(fu, 1e-9), mKw = cladKg*Math.max(mK/(cladKg*nodeW[q]), 1e-9);
          E_FU[0] = Tf0; eFuelHA(c); const hF = E_FU[1], cF = mFw*E_FU[2]/pinUA;
          E_CL[0] = Tcl0; E_CL[4] = Tcl0; eCladHA(c); const hK = E_CL[1], cK = mKw*E_CL[2]/pinUA;
          const P = E_PAIR; P[0] = -gS/cF*dt; P[1] = gS/cF*dt; P[2] = gS/cK*dt; P[3] = -(gS + hC)/cK*dt; ePhi1A();
          const v0 = (qPin - gS*(Tf0 - Tcl0))/cF, v1 = (gS*(Tf0 - Tcl0) + qOx - hC*(Tcl0 - Tc0))/cK;
          const dTf = dt*(P[4]*v0 + P[5]*v1), dTk = dt*(P[6]*v0 + P[7]*v1), qFK = qPin - cF*dTf/dt;
          out = qFK + qOx - cK*dTk/dt;
          E_FU[3] = hF + cF*dTf*pinUA/mFw; eFuelTA(c, E_FUEL_NEWT, E_FUEL_DT); Tn = E_FU[0];
          /* the can's metal melts at its solidus, which climbs with the oxygen it has taken up, paying its own fusion */
          /* the pair is linear on c_p at the tick's start: a can may not be cooled past the coldest thing it touches, which a c_p peak would otherwise price */
          let dHk = cK*dTk*pinUA/mKw;
          if(dTk < 0){ const tLo = Math.min(Tc0, Tf0, Tcl0); E_CL[0] = tLo; E_CL[4] = tLo; eCladHA(c); const floor = E_CL[1] - hK - s.csNClMl[k]*cLat;
            if(dHk < floor){ dHk = floor; out = qFK + qOx - dHk*mKw/(pinUA*dt); } }
          E_CNP[0] = hK + s.csNClMl[k]*cLat + dHk; E_CNP[1] = cTs + (cTsO - cTs)*Math.max(0, Math.min(1, ecr)); E_CNP[2] = Tcl0 + dTk;
          eCanPartA(c, k); Tcl = E_CL[0];
          if(s.csNClMl[k] > 0 && !(s.csNClOut[k] > 0) && Tcl >= cShT && ecr <= cShOx) s.csNClOut[k] = 1;
          /* molten Zr held in its shell takes the fuel into solution toward Hofmann's first-stage saturation; what it takes is molten fuel */
          if(ceramic && s.csNClMl[k] > 0 && !(s.csNClOut[k] > 0) && mFu > s.csNDis[k]){
            const want = CORIUM.dissSat*s.csNClMl[k]*s.csNZr[k], tau = Tcl > CORIUM.dissHot ? CORIUM.dissTauHot : CORIUM.dissTau;
            const dKg = Math.min(Math.max(0, (want - s.csNDis[k])*(1 - Math.exp(-dt/tau))), mFu - s.csNDis[k]);
            if(dKg > 0){ s.csNDis[k] += dKg; s.csNMelt[k] = Math.min(1, s.csNMelt[k] + dKg/nomF);
              E_FU[0] = Tn; eFuelHA(c); E_FU[3] = E_FU[1] - dKg*fuse/mFu; eFuelTA(c, E_FUEL_NEWT, E_FUEL_DT); Tn = E_FU[0]; } }
          /* out of its shell, the molten can and the fuel it holds in solution are free melt */
          if(s.csNClOut[k] > 0 && s.csNClMl[k] > 0 && mK > 0){
            const f = s.csNClMl[k], dK = f*mK, dZ = f*s.csNZr[k];
            E_CL[0] = Tcl; E_CL[4] = Tcl; eCladHA(c);
            E_MA[0] = 0; E_MA[1] = dK; E_MA[2] = dZ; E_MA[3] = dK*(E_CL[1] + cLat); E_MA[4] = dK*cLat; E_MA[5] = 0; eMeltAddA(k);
            s.csNCl[k] = mK - dK; s.csNZr[k] -= dZ; s.csNClMl[k] = 0;
            const dF = Math.min(s.csNDis[k], s.csNFu[k]);
            if(dF > 0){ const dw = s.csNDw[k]*dF/s.csNFu[k]; E_FU[0] = Tn; eFuelHA(c);
              E_MA[0] = dF; E_MA[1] = 0; E_MA[2] = 0; E_MA[3] = dF*(E_FU[1] + fuse); E_MA[4] = dF*fuse; E_MA[5] = dw; eMeltAddA(k);
              s.csNFu[k] -= dF; s.csNDw[k] -= dw; }
            s.csNDis[k] = 0; } }
        else { Tn = s.csNTc[k] + qPin/Math.max(film, 1e-9); Tcl = s.csNTc[k] + (Tn - s.csNTc[k])*gS/Math.max(gS + hC, 1e-12); }
        s.csNTcl[k] = Tcl; s.csNHc[k] = hC; s.csNFilm[k] = film;
        if(Tcl > TclH) TclH = Tcl;
        /* a Zr-clad oxide pin's ceramic loses its geometry with the ZrO2 of its own can, far under UO2's melting point; what melts is free melt */
        const mF1 = s.csNFu[k], tGate = ceramic ? CORIUM.ceramicT : tmelt;
        const fuseB = fuse + (ceramic && mF1 > 0 ? ecr*s.csNCl[k]*CORIUM.zro2PerZr/mF1*CORIUM.zro2Fus : 0);
        if(Tn > tGate && s.csNDmg[k] >= 1 && mF1 > 1e-9*nomF){
          E_FU[0] = tGate; eFuelHA(c); const hm = E_FU[1]; E_FU[0] = Tn; eFuelHA(c); const hN = E_FU[1];
          const paid = Math.min(hN - hm, fuseB), ph = paid/fuseB, dF = ph*mF1, dw = ph*s.csNDw[k];
          s.csNMelt[k] = Math.min(1, s.csNMelt[k] + dF/nomF);
          E_MA[0] = dF; E_MA[1] = 0; E_MA[2] = 0; E_MA[3] = dF*(paid < fuseB ? hm + fuseB : hN); E_MA[4] = dF*fuseB; E_MA[5] = dw; eMeltAddA(k);
          s.csNFu[k] = mF1 - dF; s.csNDw[k] -= dw;
          if(ceramic && ecr > 0){ const dKo = ph*ecr*s.csNCl[k];
            E_CL[0] = Tcl; E_CL[4] = Tcl; eCladHA(c);
            E_MA[0] = 0; E_MA[1] = dKo; E_MA[2] = 0; E_MA[3] = dKo*(E_CL[1] + s.csNClMl[k]*cLat); E_MA[4] = dKo*s.csNClMl[k]*cLat; E_MA[5] = 0; eMeltAddA(k);
            s.csNCl[k] -= dKo; }
          Tn = tGate; }
        if(s.csNCl[k] > 0 && s.csNCl[k] < E_LUMP_MIN*cladKg*nodeW[q]){ const dK = s.csNCl[k];
          E_CL[0] = Tcl; E_CL[4] = Tcl; eCladHA(c);
          E_MA[0] = 0; E_MA[1] = dK; E_MA[2] = s.csNZr[k]; E_MA[3] = dK*(E_CL[1] + s.csNClMl[k]*cLat); E_MA[4] = dK*s.csNClMl[k]*cLat; E_MA[5] = 0; eMeltAddA(k);
          s.csNCl[k] = 0; s.csNZr[k] = 0; s.csNClMl[k] = 0; }
        if(dt > 0){
          E_FU[0] = Tn; eFuelHA(c);
          const hS = E_FU[1], hF = hS + s.csNMelt[k]*fuse;
          if(hF > disp){ s.csNDisp[k] = Math.max(s.csNDisp[k], Math.max(0, Math.min(1, (hF - disp)/E_DISP_SPAN)));
            s.csNDmg[k] = Math.max(s.csNDmg[k], s.csNDisp[k]); }
          const fr = Math.max(s.csNDisp[k], s.csNMelt[k])*(1 - Math.max(0, Math.min(1, s.csNV[k])));
          if(fr > 0 && Tn > s.csNTc[k]){
            Tn -= (Tn - s.csNTc[k])*Math.min(1, fr*E_FCI_ETA*(1 - Math.exp(-dt/E_FCI_TAU)));
            E_FU[0] = Tn; eFuelHA(c); fqN = (hS - E_FU[1])*s.csNFu[k]; fciE += fqN; } }
        s.csNTf[k] = Math.max(0, Math.min(6000, Tn));
        eEcrA(c, k);
        if(E_CR[0] >= 1 || s.csNClOut[k] > 0) s.csNDmg[k] = 1;
        else if(cBurst){
          E_CR[1] = rodPF*Tcl/ROD_T_FILL*(1 + fgRel/fgFill) - pCore; eBurstTA(c); const tb = E_CR[2];
          if(Tcl > tb) s.csNDmg[k] = Math.min(1, s.csNDmg[k] + Math.max(0, Math.min(1, (Tcl - tb)/E_BURST_SPAN))*dt/E_BURST_TAU); }
      }
      fOut += out*nodeW[q];
      const qN = out*pinUA*nodeW[q];
      E_STQ[q] = 0;
      if(wet === 0 && wi > 0){ E_STQ[q] = qN; hs += qN/wi; }
      s.csNQl[k] = (wet > 0 ? qN : 0) + wet*(qWs*rk*nodeW[q] + gx) + (dt > 0 ? fqN/dt : 0);
      const fl = n*pw;
      s.csXI[k] = Math.max(0, s.csXI[k] + (gI*fl - lamI*s.csXI[k])*dt);
      s.csXX[k] = Math.max(0, s.csXX[k] + (gX*fl + lamI*s.csXI[k] - lamX*s.csXX[k] - sig*fl*s.csXX[k])*dt);
      const pm = s.csPm[k];
      s.csPm[k] = Math.max(0, pm + (gP*fl - lamP*pm)*dt);
      s.csSm[k] = Math.max(0, s.csSm[k] + (lamP*pm - sigS*fl*s.csSm[k])*dt);
      const rI = Math.max(-6000, Math.min(3000, aF*(s.csNTf[k] - TfRef)))
               + Math.max(-6000, Math.min(2500, aM*(s.csNTc[k] - Tref)))
               + Math.max(-6000, Math.min(2500, aX*(s.csNTf[k] - TfRef) + aS*(s.csNTc[k] - Tref)))
               + Math.max(-6000, Math.min(2500, aG*(s.csNTg[k]*(1 - wC) + s.csNTgC[k]*wC - TgRef)))
               + aV*s.csNV[k] - KXE*s.csXX[k] - KSM*s.csSm[k]
               - rodA*s.csNCov[k] + tipRho*s.csNFol[k]
               - poison*(T.corePoiG[rb+i] - 1)
               - T.coreNPen[rb+i] + T.coreEnrRho[rb+i];
      disK[q] = -(1 - (1 - s.csNDisp[k])*Math.min(1, salt ? 1 : s.csNFu[k]/nomF))*(1e5 + rI);
      s.csNRho[k] = rI + disK[q];
    }
    if(water && wi > 0){ E_STV[0] = hs; E_STV[1] = E_AXP[XNZ-1]; E_STV[2] = Tst; eSteamTA(); Tst = E_STV[2]; }
    E_STX[i] = Tst;
  }
  if(dt > 0 && !salt){ E_LHA[0] = s.csPlF[c]; E_LHA[1] = s.csPlK[c]; E_LHA[2] = s.csPlE[c]; E_LHA[3] = Tcold;
    eCoreRelocA(c, dt);
    if(!T.coreTube[c]){ eLhStep(c, dt); fOut += E_LH[2]/pinUA; for(let i=0;i<XNR;i++) s.csNQl[nb + i*XNZ] += E_LH[2]*ringW[i]; } }
  { eCoreWaterA(c); const m = E_CW[0], V = E_CW[1];
    let rhoIn;
    if(m === m && V > 0 && m > 0) rhoIn = m/V;
    else { const io = E_CMX; io[MX_T] = Tcold; io[MX_P] = pCore; hOfTPA(S0, io, MX_T, MX_P, MX_H); mixA(S0, io); rhoIn = io[MX_RHO]; }
    const v = Math.max(mflux, 1e-3)*T.coreG0[c]/Math.max(rhoIn, 1);
    const tau = Math.max(0.1, Math.min(60, Math.max(T.coreCoreHgt[c], .05)/Math.max(v, 1e-3)));
    for(let q=0;q<XNN;q++){ const k = nb + q;
      const vT = Math.max(0, Math.min(1, s.csNVt[k]));
      s.csNV[k] += (vT - s.csNV[k])*dt/tau;
      /* steam crosses a dry node in a tick; water takes the core transit */
      if(E_WET[q % XNZ] === 0 && dt > 0) s.csNTc[k] = s.csNTct[k]; else s.csNTc[k] += (s.csNTct[k] - s.csNTc[k])*dt/tau;
      if(salt) s.csNTf[k] = s.csNTc[k]; } }
  s.csGQ[c] = gOut; s.csFQ[c] = fOut*pinUA; s.csDQ[c] = dOut*rk; s.csCQ[c] = cOut;
  eCoreSolve(c, 1);
  const o = SX.coreO;
  for(let q=0;q<E_CO_N;q++) o[q] = 0;
  let X = 0, I = 0, V = 0, Tf = 0, TfH = 0, top = 0, bot = 0, inn = 0, out = 0, W2 = 0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const q = i*XNZ + j, k = nb + q, v = nodeW[q], w = v*s.csPhi[k], w2 = w*s.csPhi[k];
    o[E_CO_DOP] += w2*Math.max(-6000, Math.min(3000, aF*(s.csNTf[k] - TfRef)));
    o[E_CO_MOD] += w2*Math.max(-6000, Math.min(2500, aM*(s.csNTc[k] - Tref)));
    o[E_CO_EXP] += w2*Math.max(-6000, Math.min(2500, aX*(s.csNTf[k] - TfRef) + aS*(s.csNTc[k] - Tref)));
    o[E_CO_VD] += w2*aV*s.csNV[k];
    o[E_CO_GR] += w2*Math.max(-6000, Math.min(2500, aG*(s.csNTg[k]*(1 - wC) + s.csNTgC[k]*wC - TgRef)));
    o[E_CO_XE] += w2*-KXE*s.csXX[k];
    o[E_CO_SM] += w2*-KSM*s.csSm[k];
    o[E_CO_ROD] += w2*-rodA*s.csNCov[k];
    o[E_CO_TIP] += w2*tipRho*s.csNFol[k];
    o[E_CO_DIS] += w2*disK[q];
    W2 += w2;
    X += v*s.csXX[k]; I += v*s.csXI[k]; V += v*s.csNV[k]; Tf += w*s.csNTf[k];
    if(s.csNTf[k] > TfH) TfH = s.csNTf[k];
    if(j >= XNZ/2) top += w; else bot += w;
    if(i < XNR/2) inn += w; else out += w; }
  if(W2 > 0) for(let q=0;q<=E_CO_SM;q++) o[q] /= W2;
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
  o[E_CO_FCI] = dt > 0 ? fciE/dt : 0;
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
  const s = ST, r = PT.coreRodRate[c], rodErr = Math.max(-r*dt, Math.min(r*dt, E_SV[0]));
  const lo = Math.max(0, Math.min(1, s.sc[SC_ARLO])), hi = Math.max(0, Math.min(1, Math.max(s.sc[SC_ARHI], s.sc[SC_ARLO])));
  s.csRodBand[c] = 0;
  if(!s.csSplit[c] && eBankAutoLive(c, 0)){
    const want = s.csRodDem[c] + rodErr;
    s.csRodDem[c] = Math.max(lo, Math.min(hi, want));
    if(Math.abs(want - s.csRodDem[c]) > 1e-9) eRodPinned(c);
  } else if(s.csSplit[c] && !s.csReGang[c]){ E_RD[0] = rodErr; E_RD[1] = lo; E_RD[2] = hi; eRodSplitStep(c); }
}
/* E_RD: the drive's step, low and high limit, handed to the split banks */
const E_RD = new Float64Array(3);
function eRodSplitStep(c){
  const s = ST, bb = c*PT.nbMax, NB = PT.coreNB[c], rodErr = E_RD[0], lo = E_RD[1], hi = E_RD[2];
  for(let b=0;b<NB;b++) if(eBankAutoLive(c, b)){
    const want = s.csRodZDem[bb+b] + rodErr;
    s.csRodZDem[bb+b] = Math.max(lo, Math.min(hi, want));
    if(Math.abs(want - s.csRodZDem[bb+b]) > 1e-9) eRodPinned(c); }
}

function eRodCommon(c, v){
  const s = ST, bb = c*PT.nbMax, NB = PT.coreNB[c];
  if(s.csSplit[c] && !s.csReGang[c]){
    const d = v - s.csRodDem[c]; let m = 0;
    for(let b=0;b<NB;b++){ s.csRodZDem[bb+b] = Math.max(0, Math.min(1, s.csRodZDem[bb+b] + d)); m += s.csRodZDem[bb+b]; }
    s.csRodDem[c] = m/NB;
  } else s.csRodDem[c] = Math.max(0, Math.min(1, v));
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
        s.csRodZDem[bb+b] = Math.max(0, Math.min(1, s.csRodDem[c] + PT.coreBankW[bb+b]*XTILTZ*s.csTilt[c]));
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
  if(PT.n.core && PT.coreNoBor[0]) return;
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
  for(let c=0;c<n;c++) ST.csFatigue[c] += 0.35*dt*Math.max(0, Math.min(2, inj/1.6)); };

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
    if(X >= 0 && X < GW && Y >= 0 && Y < GH){ const j = Y*GW + X; E_RR[RR_BANG] = kPa; eRoomBangP(j); eRoomBang(j); }
}

/* the water the vessel has lost since commissioning (vLeak, its void by volume) taken off the top of its own geometry:
   lower plenum, core less its rods, upper plenum. A tube core's channels drain along their length; a gas or a salt keeps
   its core full. E_LVL[0] the core's collapsed liquid over its height, csLvl the collapsed level over the core bottom, m */
function eCoreCollapsedA(c, vLeak){
  const T = PT, H = Math.max(T.coreCoreHgt[c], 0.05), f = Math.max(0, Math.min(1, 1 - vLeak));
  if(T.coreGas[c] || T.coreSalt[c]){ E_LVL[0] = 1; ST.csLvl[c] = H + T.coreVesClr[c]; return; }
  if(T.coreTube[c]){ E_LVL[0] = f; ST.csLvl[c] = f*H; return; }
  const A = T.coreVesA[c], Ac = Math.max(A - T.coreRodAr[c], 1e-9), C = T.coreVesClr[c], V = f*(2*A*C + Ac*H);
  const z = V <= A*C ? V/A - C : V <= A*C + Ac*H ? (V - A*C)/Ac : H + (V - A*C - Ac*H)/A;
  ST.csLvl[c] = z; E_LVL[0] = Math.max(0, Math.min(1, z/H));
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
    eCoreCollapsedA(c, vLeak);
    const cs = E_CS;
    cs[0] = dt; cs[1] = s.csHeat[c]; cs[2] = sat; cs[3] = E_LVL[0]; cs[4] = PT.coreFlowK[c]*SX.coreFN[c];
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
    s.csParts[pb+RP_TIP] = o[E_CO_TIP]; s.csParts[pb+RP_GR] = o[E_CO_GR]; s.csParts[pb+RP_SM] = o[E_CO_SM]; s.csParts[pb+RP_DIS] = o[E_CO_DIS]; s.csParts[pb+RP_BOR] = PT.coreNode[c] >= 0 && s.bBy[PT.coreNode[c]] === s.bBy[PT.coreNode[c]] ? s.bBy[PT.coreNode[c]] : s.sc[SC_BORON];
    let r = PT.coreExcess[c];
    for(let q=0;q<RP_N;q++) r += s.csParts[pb+q];
    s.csRho[c] = r; }
}

/* E_CMU: [0..5] each group's loss to the loop 1/s, (1 - exp(-lambda tau_loop))/tau_core on a well-mixed core; [6] [7] core and loop transit s */
const E_CMU = new Float64Array(8);
function eCircMuA(c){
  const vr = PT.coreLoopVr[c], w = SX.coreFN[c]*PT.coreNetRef[c];
  let tc = E_INF;
  if(vr > 0 && w > 0){ eCoreWaterA(c); const m = E_CW[0]; if(m > 0) tc = m/w; }
  E_CMU[6] = tc; E_CMU[7] = tc < E_INF ? tc*vr : E_INF;
  for(let g=0;g<6;g++) E_CMU[g] = tc < E_INF ? (1 - Math.exp(-PT.coreLam[c*6+g]*E_CMU[7]))/tc : 0; }
/* pcm a circulating core needs over a standing one to hold its power */
function eCircLoss(c){ eCircMuA(c); let r = 0;
  for(let g=0;g<6;g++){ const m = E_CMU[g]; r += PT.coreBet[c*6+g]*m/(PT.coreLam[c*6+g] + m); }
  return r*1e5; }

/* implicit in n and the precursors, four substeps a tick */
function eCoreKineticsStep(dt){
  const s = ST, nc = PT.n.core, h = dt/4;
  for(let c=0;c<nc;c++){
    const gb = c*6, rk = s.csRho[c]*1e-5, B = PT.coreBETA[c], L = PT.coreLAM[c];
    eCircMuA(c);
    for(let q=0;q<4;q++){
      let num = 0, den = 0;
      for(let g=0;g<6;g++){ const l = PT.coreLam[gb+g], dd = 1 + h*(l + E_CMU[g]);
        num += l*s.csC[gb+g]/dd; den += l*h*PT.coreBet[gb+g]/L/dd; }
      const a = 1 - h*(rk - B)/L - h*den;
      let n = a > 1e-6 ? (s.csN[c] + h*num + h*2e-9)/a : s.csN[c]*12;
      if(!isFinite(n) || n < 0) n = s.csN[c]*12;
      s.csN[c] = Math.min(n, 60);
      for(let g=0;g<6;g++) s.csC[gb+g] = (s.csC[gb+g] + h*PT.coreBet[gb+g]/L*s.csN[c])/(1 + h*(PT.coreLam[gb+g] + E_CMU[g])); }
    s.csN[c] = Math.max(s.csN[c], 1e-9);
    s.csDnbr[c] = s.csDnbrMin[c]; }
}

function eCoreMeltStep(dt){
  const s = ST, nc = PT.n.core;
  for(let c=0;c<nc;c++){
    if(!s.csMelt[c] && s.csMeltFrac[c] >= E_MELT_LATCH){ s.csMelt[c] = 1; s.csTrip[c] = E_TRIP_MELT; s.csTripArg[c] = -1;
      eEvent(EV_CORE_MELT, c, s.csMeltFrac[c]); }
    if(!PT.coreSalt[c]) eFpRelease(c); }
}
/* E_FPR: kg of each group out of core c's fuel: NUREG-1465's gap share on a failed clad, its in-vessel share with the melt, never returned */
const E_FPR = new Float64Array(FP_N);
function eFpRelease(c){
  const s = ST, nb = c*XNN, o = c*FP_N;
  for(let q=0;q<FP_N;q++) E_FPR[q] = 0;
  for(let k=0;k<XNN;k++){ const i = nb + k, st = eFuelStage(c, k), w = nodeW[k]*PT.coreNPhi0[i];
    const fail = st >= E_FAIL_OXID ? 1 : st === E_FAIL_BURST ? s.csNDmg[i] : 0, melt = Math.max(s.csNMelt[i], s.csNDisp[i]);
    if(!(fail > 0) && !(melt > 0)) continue;
    for(let q=0;q<FP_N;q++) E_FPR[q] += w*Math.min(1, PT.coreFpGap[o+q]*fail + PT.coreFpMelt[o+q]*melt); }
  for(let q=0;q<FP_N;q++) E_FPR[q] *= PT.coreFpInv[o+q];
  let d = E_FPR[FP_NG] - s.csFpRelN[c];
  if(d > 0){ s.csFpRelN[c] += d; s.sc[SC_FPBOOKN] += eFpDeposit(c, d, s.fpNBy); }
  d = E_FPR[FP_VO] - s.csFpRelV[c];
  if(d > 0){ s.csFpRelV[c] += d; s.sc[SC_FPBOOKV] += eFpDeposit(c, d, s.fpVBy); }
  d = E_FPR[FP_RF] - s.csFpRelR[c];
  if(d > 0) s.csFpRelR[c] += d;
}
/* a dissolved fuel holds its gases and volatiles in its salt from the first fission */
function eFpSeed(){
  const s = ST, nc = PT.n.core, nn = PT.n.node;
  for(let c=0;c<nc;c++){ if(!PT.coreSalt[c]) continue;
    const o = c*FP_N, ci = PT.coreCirc[c];
    let m = 0; for(let i=0;i<nn;i++) if(PT.nodeCirc[i] === ci && !PT.nodeBooked[i] && s.mBy[i] > DRY_MIN_KG) m += s.mBy[i];
    if(!(m > 0)) continue;
    s.csFpRelN[c] = PT.coreFpInv[o+FP_NG]; s.csFpRelV[c] = PT.coreFpInv[o+FP_VO]; s.csFpRelR[c] = PT.coreFpInv[o+FP_RF];
    for(let i=0;i<nn;i++) if(PT.nodeCirc[i] === ci && !PT.nodeBooked[i] && s.mBy[i] > DRY_MIN_KG){
      s.fpNBy[i] += s.csFpRelN[c]/m; s.fpVBy[i] += s.csFpRelV[c]/m; } }
}
/* kg shared equally over the water nodes core c heats, as its hydrogen is; returns what found no water to land in */
function eFpDeposit(c, kg, C){
  const j0 = PT.coreLoop0[c], j1 = PT.coreLoop0[c+1], n = j1 - j0;
  if(!(n > 0)) return kg;
  let lost = 0;
  for(let j=j0;j<j1;j++){ const i = PT.coreLoopNode[j], m = ST.mBy[i];
    if(m > DRY_MIN_KG) C[i] += kg/n/m; else lost += kg/n; }
  return lost;
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
  /* the room's airborne and pooled fission products, as gamma power over rated, on the crew's own kernel */
  const K = PT.radAirK, N = GW*GH, wN = PT.fpDoseW[FP_NG], wV = PT.fpDoseW[FP_VO];
  let a = 0; for(let i=0;i<N;i++){ const k = K[i]; if(k) a += k*(s.roomFpN[i]*wN + (s.roomFpV[i] + s.roomFpW[i])*wV); }
  sc[SC_FPDOSE] = a;
  m[0] = sc[SC_SGTR] ? RAD_SGTR : 0; m[1] = RAD_AIR*sc[SC_RELEASE] + a; m[2] = PT.radPipeOn ? RAD_PIPE*sc[SC_N] : 0;
  const cr = PT.radCrewCells;
  let v = 0;
  for(let q=0;q<cr.length;q++){ eRadCellA(cr[q]); const f = E_RDC[0]; if(f > v) v = f; }
  sc[SC_DOSERATE] = cr.length ? Math.max(RAD_FLOOR, Math.min(RAD_CEIL, v)) : RAD_FLOOR;
  sc[SC_CREWDOSE] = Math.min(100, sc[SC_CREWDOSE] + sc[SC_DOSERATE]*E_RAD_CREW_K*dt);
  sc[SC_REPRATE] = eRepairRadRate();
}

/* commissioning: one rest pass at dt 0 on the settle's own flow */
function eCoreRestStep(c, flowNet){
  const s = ST;
  s.csFlowNet[c] = flowNet;
  const cs = E_CS;
  eCoreCollapsedA(c, 0);
  cs[0] = 0; cs[1] = s.csHeat[c]; cs[2] = satT(PT.coreSat[c], s.csPCore[c]); cs[3] = E_LVL[0];
  cs[4] = PT.coreFlowK[c]*flowNet; cs[5] = Math.max(flowNet, E_CORE_DT_QMIN); cs[6] = eNetCoreInH(c);
  eCoreStep(c);
}

const E_REST_MAX = 4000, E_REST_TOL = 1e-9;
/* dt-0 passes to the coupled fixed point: void, coolant, xenon and the pin fit all on the pass's own shape; a pass that moves none of them ends it; passes returned, E_REST_MAX = never converged */
function eCoreRestConverge(c){
  const s = ST, nb = c*XNN, phi = s.csPhi, was = new Float64Array(XNN), wg = new Float64Array(2*XNN), n = s.csN[c];
  for(let r=0;r<E_REST_MAX;r++){
    for(let k=0;k<XNN;k++){ was[k] = phi[nb+k]; wg[k] = s.csNTg[nb+k]; wg[XNN+k] = s.csNTgC[nb+k]; }
    eCorePinFit(c, s.csFlowNet[c]);
    eCoreRestStep(c, s.csFlowNet[c]);
    const wC = PT.coreGraphKgC[c] > 0 ? PT.coreGraphKgC[c]/(PT.coreGraphKg[c] + PT.coreGraphKgC[c]) : 0;
    let tg = 0; for(let k=0;k<XNN;k++) tg += nodeW[k]*(s.csNTg[nb+k]*(1 - wC) + s.csNTgC[nb+k]*wC);
    let d = Math.abs(tg - PT.coreTgRef[c])/tg; PT.coreTgRef[c] = tg;
    if(PT.coreSpP[c] > 0) for(let k=0;k<XNN;k++) d = Math.max(d, Math.abs(s.csNTg[nb+k] - wg[k])/s.csNTg[nb+k], wC > 0 ? Math.abs(s.csNTgC[nb+k] - wg[XNN+k])/s.csNTgC[nb+k] : 0);
    for(let k=0;k<XNN;k++){ const i = nb + k, fl = n*phi[i], xx = eXeEq(c, fl);
      d = Math.max(d, Math.abs(phi[i] - was[k])/was[k], Math.abs(s.csNVt[i] - s.csNV[i]),
        Math.abs(s.csNTct[i] - s.csNTc[i])/s.csNTc[i], Math.abs(xx - s.csXX[i])/xx);
      s.csNV[i] = s.csNVt[i]; s.csNTc[i] = s.csNTct[i]; s.csXI[i] = eIoEq(c, fl); s.csXX[i] = xx; s.csPm[i] = ePmEq(c, fl); s.csSm[i] = eSmEq(c);
      if(PT.coreSalt[c]) s.csNTf[i] = s.csNTc[i]; }
    if(d <= E_REST_TOL) return r + 1; }
  return E_REST_MAX;
}

/* what a critical core still lacks at its settled point, pcm: the boron it would need, or 0 */
function eCoreRestResid(c){ eCoreRestConverge(c); const o = SX.coreO;
  return PT.coreExcess[c] + o[E_CO_ROD] + o[E_CO_TIP] + o[E_CO_DOP] + o[E_CO_MOD] + o[E_CO_EXP] + o[E_CO_XE] + o[E_CO_SM] + o[E_CO_VD] + o[E_CO_GR] - eCircLoss(c); }
function eCoreRodSet(c, x){ const s = ST, bb = c*PT.nbMax;
  s.csRodPos[c] = x; s.csRodDem[c] = x;
  for(let b=0;b<PT.coreNB[c];b++){ s.csRodZ[bb+b] = x; s.csRodZDem[bb+b] = x; }
  eRodShape(c); eCoreStaticRho(c); }
/* a coolant that carries no boron is held critical by the bank itself: a secant on the bank's position, bracketed by its travel */
function eCoreRodCrit(c){
  let x0 = ST.csRodPos[c], r0 = eCoreRestResid(c), x1 = Math.min(1, x0 + 0.05);
  for(let i=0;i<E_ROD_CRIT_N && Math.abs(r0) > E_ROD_CRIT_TOL;i++){
    eCoreRodSet(c, x1); const r1 = eCoreRestResid(c);
    const x2 = r1 !== r0 ? Math.max(0, Math.min(1, x1 - r1*(x1 - x0)/(r1 - r0))) : x1;
    x0 = x1; r0 = r1; x1 = x2; }
  eCoreRodSet(c, x0);
}
/* critical at the settled point on the ledger the first tick reads: each circuit's water dialled for the first core it cools */
function eCoreDialBoron(){
  const s = ST, nc = PT.n.core, nn = PT.n.node;
  let bor0 = 0;
  for(let c=0;c<nc;c++){
    eCoreWaterA(c); const p = E_CW[2], ci = PT.coreCirc[c];
    if(p === p && p > 0) s.csPCore[c] = p;
    if(PT.coreNoBor[c]) eCoreRodCrit(c);
    eCoreRestConverge(c);
    s.csVoidTh[c] = s.csVf[c] = s.csVNode[c];
    eCircMuA(c);
    for(let g=0;g<6;g++) s.csC[c*6+g] = PT.coreBet[c*6+g]*s.csN[c]/(PT.coreLAM[c]*(PT.coreLam[c*6+g] + E_CMU[g]));
    if(ci >= 0 && PT.circCore1[ci] >= 0 && PT.circCore1[ci] !== c) continue;
    const o = SX.coreO;
    /* a dissolved absorber only absorbs: a core short at 0 stays short */
    const bor = PT.coreNoBor[c] ? 0 : Math.min(0, eCircLoss(c) - (PT.coreExcess[c] + o[E_CO_ROD] + o[E_CO_TIP] + o[E_CO_DOP] + o[E_CO_MOD] + o[E_CO_EXP] + o[E_CO_XE] + o[E_CO_SM] + o[E_CO_VD] + o[E_CO_GR]));
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
