"use strict";
/* Loads AFTER core2d.js: it sizes its arrays from XNR/XNZ, and core2d only needs the lattice at call time. */

const LQ=10;                     // quarter-plan slots per side
const LAT_QUAD=4;                // the drawn quarter repeats four times round the axis
/* L_MOD is core material but NOT fuel, so a count meaning "there is fuel here" asks latFuel(), never a non-zero slot. L_CPS is a
   graphite column bored for a control rod and cooled by its own circuit: no fuel either. */
const L_EMPTY=0, L_FUEL=1, L_POIS=2, L_MOD=3, L_CPS=4;
const LIX=(u,v)=>u*LQ+v;
const latFuel=(c,q)=>c.lat.slot[q]===L_FUEL||c.lat.slot[q]===L_POIS;
// a rod cluster goes in a fuel slot's guide tubes or down a control channel
const latRodOK=(c,q)=>latFuel(c,q)||c.lat.slot[q]===L_CPS;

// the design point "pitch 1.0x" is defined against, and nothing else
const LAT_MW0=1200, LAT_HD0=1.0;
const LAT_DENS0=100;             // kW/L, sizes the reference pitch only
const LAT_R0=9.6;                // stock fuel radius in slots, reaching both axes of the quarter
const LAT_REFLMAX=3;             // cells the reflector pen packs out to
/* cm of reflector on the rim, lid and floor; a row's refl the same. BUILD: each the cells its row drew before 24/09/26, at that row's own mesh */
const LAT_REFL0=[8.9,24.8,24.8];
const LAT_POIG=0.90;             // how hard the stock lattice grades poison from centreline to rim

/* dens t/m3; comp (or compW) the absorber alone, the rodlet's own stainless clad left out */
const ABSORB=[
  {name:"BORON CARBIDE",dens:2.5,comp:{B:4,C:1},
   note:"Cheap and light, and its boron can be enriched in B-10, which is how a fast core gets worth out of a rod. It swells and cracks as it burns, so a long campaign costs you worth you cannot see going."},
  {name:"SILVER-INDIUM-CADMIUM",dens:10.2,compW:{Ag:.80,In:.15,Cd:.05},
   note:"Four times as dense as boron carbide, but it does not swell, so it is the one that still moves at the end of a campaign."},
  {name:"HAFNIUM",dens:13.3,comp:{Hf:1},
   note:"It takes decades of irradiation without complaint. Heavy - and margin bought from fewer, stronger clusters is margin concentrated in fewer things that can jam."},
];

/* A slot's zone is an index, never an enrichment: the fuel row it means is menued, one row per zone. */
const LAT_NZ=3;
const latNew=()=>({
  slot:new Uint8Array(LQ*LQ),
  rod:new Int8Array(LQ*LQ),      // -1 none, else bank 0..3
  zone:new Uint8Array(LQ*LQ),    // loading zone 0..LAT_NZ-1, 0 everywhere by default
  pitch:0, len:0,
  reflR:LAT_REFL0[0], reflT:LAT_REFL0[1], reflB:LAT_REFL0[2],
  abs:0,
});
/* Keyed on the bag itself, so a bag a snapshot replaced takes its stale measurement with it. `rev` is unique across cores. */
const LMS=new WeakMap();
let latRev=0;
const latM=c=>LMS.get(c)||latRevolve(c);

/* The EQUAL-AREA radius over every occupied slot, never the corner radius: spanning to the corner leaves the outer ring a hole. */
const latEqR=c=>{
  let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.slot[q]) n++;
  return Math.sqrt(4*n/Math.PI)*c.lat.pitch;
};

/* A bundle is a fixed object, so the fractions below are shares of the REFERENCE cell: opening the pitch adds coolant around the same fuel. */
// the Westinghouse 17x17 rod, m: clad OD, square rod pitch
const ROD_D0=0.0095, ROD_P0=0.0126;
const rodDSuggest=()=>ROD_D0;
const rodD=c=>c.rodD??ROD_D0;
const rodPSuggest=()=>ROD_P0;
const rodPOf=c=>c.rodP??rodPSuggest();
const finOf=c=>c.fin??1;
const rodSpdOf=c=>c.rodSpd??ROD_SPD0;
/* The Westinghouse RCCA (AP1000 DCD Rev. 19 Table 4.3-1, NRC ML11171A445): 24 rodlets per cluster, the
   Ag-In-Cd slug 0.341 in across inside a 0.0185 in 304 SS tube. The slug is what absorbs, so it is what is
   drawn; the tube is left out here as it is in the ABSORB row's own figures. */
const ABS_D0=0.341*0.0254, ABS_N0=24;
const absDSuggest=()=>ABS_D0;
const absD=c=>c.absD??absDSuggest();
const absNSuggest=()=>ABS_N0;
const absN=c=>c.absN??absNSuggest();
// B-10 atom fraction of the absorber's boron
const absEnrSuggest=()=>B10_NAT;
const absEnr=c=>c.absEnr??absEnrSuggest();
const absHasB=c=>{ const a=ABSORB[c.lat.abs]; return !!(a.comp||a.compW).B; };
// rodded slots in the drawn quarter
const latRodded=c=>{ let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.rod[q]>=0) n++; return n; };
// m2 per unit core height over the drawn quarter, the bank fully in
const latAbsA=c=>latRodded(c)*absN(c)*Math.PI/4*absD(c)*absD(c);
// zircaloy: density kg/m3, Pilling-Bedworth ratio, reaction enthalpy J/kg Zr, kg H2 per kg Zr (Zr + 2 H2O -> ZrO2 + 2 H2), pcm per unit clad-over-fuel volume
const ZR_RHO=6560, ZR_PBR=1.56, ZR_QOX=6.45e6, ZR_H2=2*2.01588/91.224;
/* rho kg/m3, comp atoms or compW weight (Zircaloy on Zr, Magnox on Mg with its 0.8 % Al left out), k W/m/K or a law in T, thick m of can wall, zr 1 = the Zr-steam reaction applies;
   cp: ph rows [T_hi, a, b, c, d, e] of cp = a + bT + cT^2 + dT^3 + e/T^2 J/mol/K over M kg/mol, gauss [A, T_peak, w, T_lo, T_hi] adds A exp(-(T - T_peak)^2/w) J/kg/K inside T_lo..T_hi;
   pFill MPa of He at ROD_T_FILL and vFree the rod's free volume over its pellet; burst [hoop MPa, K, hoop MPa, K, K/s]: failure on a ramp at that rate, log-linear in hoop stress between the two points (rate 0: the curve is the onset itself), null: no burst, the can fails when it melts;
   tsol K the metal's solidus (tsolO: when fully oxidised, linear in the oxidised share between), hfus kJ/kg its fusion, shell [K, share]: the oxide skin holding molten metal breaks at K unless over that share of the wall is oxide (absent: no skin) */
const CLAD=[
 /* alpha: diametral 6.721e-6 per K, alpha phase to 1073 K (NUREG/CR-7024 eq. 3.5-9, FRAPCON-3.4/FRAPTRAN-1.4) */
 /* cp: Zircaloy-2, IAEA-TECDOC-1496 (2006) sec. 6.2.1.1 eqs. 1-3, alpha to the 1213.8 K peak, beta above it, the transition's latent heat in the Gaussian */
 /* fill 2.2 MPa and free volume 6 % as commonly quoted, not read at source; burst NUREG-0630 (20 MPa -> 1477 K, 140 MPa -> 1030 K), its heating rate not carried */
 {name:"ZIRCALOY",rho:ZR_RHO,comp:{Zr:1},k:16,thick:0.00057,zr:1,alpha:6.721e-6,
  cp:{M:1, ph:[[1213.8, 255.66, 0.1024, 0, 0, 0], [Infinity, 597.1, -0.4088, 1.565e-4, 0, 0]], gauss:[1058.4, 1213.8, 719.61, 1100, 1320]},
  pFill:2.2, vFree:0.06, burst:[20, 1477, 140, 1030, 0],
  /* solidus 2025 K bare (Hayward & George) to 2318 K O-saturated alpha-Zr(O), fusion 153 kJ/kg: IAEA-TECDOC-1496 secs. 6.2.1.3, 6.5.3; the line between is FIT on the two ends.
     shell: MELCOR SC1131(2) median breakout 2400 K (range 2250-2550, FIT inside it, Choi et al. STNI 2018 Table 1); over 60 % oxide it oxidises through and never breaks (Stuckert et al., NENE 2002 sec. 8) */
  tsol:2025, tsolO:2318, hfus:153, shell:[2400, 0.6],
  note:"Zirconium alloy: nearly transparent to neutrons and strong when hot, but above about 1100 K it burns in steam and makes hydrogen."},
 /* Magnox AL80 (Mg 0.8 Al): rho pure Mg 1738; k on a line between pure Mg 156 and as-cast Mg-1.5Al 100 (review of Mg thermal conductivity, J. Magnes. Alloys 8, 2020); Calder Hall's 0.072 in wall (Nuclear Engineering, Dec. 1956); melts at ~650 C (Frost) */
 /* alpha: pure Mg near 26e-6 per K, as commonly quoted, not read at source; cp: solid Mg, NIST WebBook Shomate 298-923 K, t = T/1000 carried into T; fill and free volume Zircaloy's, not read: a metal bar lets no gas go here */
 {name:"MAGNOX AL80",rho:1738,comp:{Mg:1},k:126,thick:0.0018288,zr:0,alpha:26e-6,
  /* liquid: its Shomate A alone (the rest under 1e-9); fusion 8.48 kJ/mol, the liquid's H over the solid's at 923 K with its formation H (NIST WebBook) */
  cp:{M:0.024305, ph:[[923, 26.54083, -1.533048e-3, 8.062443e-6, 0.572170e-9, -0.174221e6], [Infinity, 34.30901, 0, 0, 0, 0]]},
  pFill:2.2, vFree:0.06, burst:null, tsol:923, hfus:349,
  note:"Magnesium with a little aluminium: absorbs almost no neutrons and does not react with uranium or CO2, but it is weak and it melts at 650 C, so the fuel inside must stay cool."},
 /* 316 standing for BN-600's ChS-68, which has no open property set: Kim, ANL-75-55 (1975), 316L: cp eq. 7, rho eq. 18 at 300 K,
    k eq. 30, alpha its Table 7 secant at 800 K, compW its own 69 Fe 17 Cr 12 Ni 2 Mo; BN-600's 0.4 mm wall (IAEA-TECDOC-1569 Table 3).
    vFree: the 653 mm plenum over the 1030 mm fissile column (TECDOC-1569) plus the 1.8 mm central hole and the 6.0 mm pellet's
    gap in a 6.1 mm bore, over the bore (0.754). pFill FIT 0.1 MPa He: fresh pin well under its burst at rest,
    a few MPa at end of life. burst: Hunter & Fish, HEDL-SA-645, 20 % CW 316 at 10 F/s: 1300 psi ~2400 F, 6480 psi 2100-2200 F. */
 {name:"STEEL 316",rho:7954,compW:{Fe:.69,Cr:.17,Ni:.12,Mo:.02},k:T=>9.248+0.01571*T,thick:0.0004,zr:0,alpha:2.031e-5,
  /* solidus 1670 K, the bottom of its 1670-1730 K melting range; fusion 64.0 cal/g and liquid cp 0.184 cal/g/K (ANL-75-55 eq. 11) */
  cp:{M:1, ph:[[1670, 0.1097*4184, 3.174e-5*4184, 0, 0, 0], [Infinity, 0.184*4184, 0, 0, 0, 0]]},
  tsol:1670, hfus:64.0*4.184,
  pFill:0.1, vFree:653/1030 + (1.8/6.1)**2 + (6.1**2 - 6.0**2)/6.1**2, burst:[8.96, 1589, 44.7, 1450, 5.56],
  note:"Stainless steel: strong and tough at a fast reactor's temperatures and indifferent to sodium, but it eats thermal neutrons, so it only clads a core with no moderator."},
];
/* dissSat kg UO2 a kg of molten Zr takes at Hofmann's first-stage saturation (KfK-4485 via Zhan, STNI 2020 eq. 17, secondary);
   dissTau s to it, FIT 60 s and 10 s past dissHot K (target: minutes, very rapid above 2523 K); ceramicT K a Zr-clad oxide pin's
   ceramic loses its geometry (VERCORS six tests 2479 +- 83 K, MELCOR SC1132(1), Choi et al. STNI 2018); zro2Fus kJ/kg (Hong et al.,
   Sci. Rep. 8 (2018) 14962; JANAF gives 706) and ZrO2's kg per kg of Zr it came from; vCandle m/s a free melt runs down its pins
   (FIT on the film/rivulet ~0.5 m/s of CORA-W1/W2, Veshchunov via Zhan 2020, secondary); hFrzOx and hFrzMet W/m2K a melt freezes
   on a colder pin at, oxide and metal (MELCOR, SAND2017-12028C); rhoDebris kg/m3 of relocated material (TMI-2 lower-head debris,
   8.4 g/cm3 at 18 % porosity, NUREG/CR-6197).
   The pool on the lower head: kMelt W/m/K, rhoMelt [kg/m3 at T0, kg/m3/K, T0] and muMelt [Pa s, K] liquid UO2's (IAEA-TECDOC-1496
   6.1.1.8 and 6.1.1.13, Woodley; FIT: the oxide pool on UO2's laws at its own temperature); acopoUp/acopoDn Nu = a Ra'^b (ACOPO, via
   JAERI-Conf 99-005 p. 83); peakWet/peakDry the downward peak over the mean, top cooled and dry (Bonnet, JAERI-Conf 99-005).
   The head: SA533B1 taken as carbon steel, hdRho kg/m3, k = hdK[0] - hdK[1] theta to 800 C then hdK[2] W/m/K, hdCp J/kg/K
   piecewise in theta C (EN 1993-1-2 3.4.1.2-3); creep life on the TMI-2 VIP Larson-Miller fits (NUREG/CR-6197 4.2.2 eqs. 1-4,
   sigma ksi, T degR, t h): lmpLo under creepT1 K, lmpHi above, no creep under creepT0 K; penetrations fail under penP MPa past
   penPwr K, penBwr K for a boiling core (NUREG/CR-5642) */
const CORIUM={dissSat:0.558, dissTau:60, dissTauHot:10, dissHot:2523, ceramicT:2479, zro2Fus:440, zro2PerZr:123.218/91.224,
  vCandle:0.5, hFrzOx:7500, hFrzMet:2500, rhoDebris:8400,
  kMelt:2.5, rhoMelt:[8860, 0.9285, 3120], muMelt:[0.988e-3, 4620], acopoUp:[1.95, 0.18], acopoDn:[0.3, 0.22], peakWet:1.75, peakDry:3.6,
  hdRho:7850, hdK:[54, 3.33e-2, 27.3], hdCp:[425, 0.773, -1.69e-3, 2.22e-6, 666, 13002, 738, 545, 17820, 731, 650],
  lmpLo:[55.847, -11.492, 25], lmpHi:[30.014, -12.127, 5.1831, -1.8394, 11], creepT0:723.15, creepT1:850.15, penP:2, penPwr:1600, penBwr:1200,
  dchP0:0.2, dchP1:1.5, dchMax:0.8, layer:0.10, vSpread:0.1, basemat:1.5, hMcci:450, emis:0.8, slagCp:1.1, slagRho:2500,
  qZrH2o:6760, qZrCo2:5860, qZrFe:6040, zro2PerZrO:0.031998/0.091224, catchSac:0.5, catchFe:0.5, catchWater:1, fciOx:0.003, fciMet:0.001};
/* Outside the vessel, CORIUM carries: dchP0/dchP1 MPa and dchMax, the share dispersed at head failure rising linearly to dchMax (FIT to
   KAERI's 1:20 entrainment, NEA/CSNI/R(96)25); layer m a spread melt stops at, FIT (ECOKATS-2, 3200 kg to ~0.2 m in 4 m2), and vSpread
   m/s its front, FIT; basemat m, FIT (Fessenheim; target melt-through in one to several days, IRSN 2007-83 5.1.1); hMcci W/m2K melt to
   its concrete, FIT (target: CCI melts some 400 K over their concrete's ablation temperature at 150-200 kW/m2, Farmer, not read); emis
   the dry crust's; slagCp kJ/kg/K and slagRho kg/m3 of the molten concrete oxides, FIT (silica and lime melts 1.0-1.4, 2200-2700);
   qZrH2o, qZrCo2, qZrFe kJ per kg of Zr to ZrO2 by H2O, CO2 and Fe2O3 (formation enthalpies: ZrO2 -1100.6, H2O -241.8, CO2 -393.5,
   CO -110.5, Fe2O3 -824.2 kJ/mol); zro2PerZrO kg of O a kg of Zr takes; catchSac m of sacrificial concrete over a catcher's cooled iron
   floor and catchFe its Fe2O3 share, FIT (IRSN 2007-83 6.4); catchWater m of water a catcher floods its floor with, FIT (target: the
   EPR's passive flooding covers the spread melt); fciOx and fciMet the share of a pour's heat over saturation a flooded floor turns into
   a blast, oxide and over half metal (FIT inside SERENA-2's 0.1-0.6 %, NEA/CSNI/R(2017)15) */
/* Concrete under a melt, Farmer (OSTI 1350637) Table II: h2o kg/kg free and bound water, co2 kg/kg, gas mol/kg the sum; rho kg/m3
   (LCS: Kang 2016 citing Farmer; SIL FIT, normal-weight concrete 2240-2400); tAbl K and dhAbl kJ/kg its ablation (IRSN 2007-83, Kang
   2016); aniso the lateral over the downward flux (Farmer's CCI: LCS about 1, siliceous about 4) */
const CONCRETE = {
  LCS:   {name:"LIMESTONE-COMMON SAND", h2o:0.0326 + 0.0111, co2:0.2971, rho:2373, tAbl:1500, dhAbl:2300, aniso:1},
  SILUS: {name:"SILICEOUS (US)", h2o:0.0181 + 0.0192, co2:0.0090, rho:2300, tAbl:1600, dhAbl:1600, aniso:4},
  SILEU: {name:"SILICEOUS (EU)", h2o:0.0229 + 0.0140, co2:0.0980, rho:2300, tAbl:1600, dhAbl:1700, aniso:4}};
const CONCRETE_KEYS = Object.keys(CONCRETE);
const concreteSuggest = () => "LCS";
const concreteOf = () => CONCRETE[D.concrete ?? concreteSuggest()] || CONCRETE[concreteSuggest()];
const cladK=(c,T)=>{ const k=cladOf(c).k; return typeof k==="function" ? k(T) : k; };
const cladOf=c=>CLAD[c.clad??0];
const fuelDissolved=c=>!!COOLANT[c.cool].fuelInCoolant;
// kg of can over the core: rod surface times drawn wall
const cladKgOf=(c,aHeat)=>fuelDissolved(c) ? 0 : cladOf(c).rho*aHeat*cladOf(c).thick;
const cladZrKg=(c,aHeat)=>cladOf(c).zr ? cladKgOf(c,aHeat) : 0;
const rodDP=c=>rodD(c)-2*cladOf(c).thick;
const latFuelFrac=c=>Math.PI/4*(rodDP(c)/rodPOf(c))*(rodDP(c)/rodPOf(c));
const latRodFrac =c=>Math.PI/4*(rodD(c) /rodPOf(c))*(rodD(c) /rodPOf(c));
// clad per unit fuel: the can is a parasitic absorber; a dissolved fuel has none
/* m2 a fuel slot gives its coolant before the rods: a stated bore is a channel through a solid block, so the
   water is inside the tube and the rest of the cell is moderator. No bore = the whole cell, a water lattice. */
const latBoreM=c=>(c.tube&&c.tube.bore||0)/1000;
const latChanA=c=>{ const b=latBoreM(c); return b>0 ? Math.PI/4*b*b : c.lat.pitch*c.lat.pitch; };
/* m2 of block a fuel slot holds: the cell less the tube's OUTSIDE. Without a bore a fuel slot holds none. */
const latBlockA=c=>{ const b=latBoreM(c); if(!(b>0)) return 0;
  const a=COOLANT[c.cool], d=b+2*tubeWallMm(a.P0,a,c)/1000;
  return Math.max(0, c.lat.pitch*c.lat.pitch - Math.PI/4*d*d); };
// one bundle's hydraulics at the pitch drawn; aHeat is per METRE of height
function latBundle(c){
  const nRod=(LAT_P0/rodPOf(c))*(LAT_P0/rodPOf(c));
  const aFlow=Math.max(0, latChanA(c) - latRodFrac(c)*LAT_P0*LAT_P0);
  const aHeat=nRod*Math.PI*rodD(c);
  return {nRod, aFlow, aHeat, dh:aHeat>0 ? 4*aFlow/aHeat : 0};
}
/* A cooled control channel's bore, tube wall and gas gap, mm: the fuel channel's own tube where the fuel
   slots are bored (the same column design; stated, not read at source), else the bored slot's suggestion
   and Barlow at the channel circuit's design pressure. Its water: light water at CPS_P and CPS_T, near
   atmospheric (Kaliatka et al., STNI 2008, read) and cold (a fitted 40 C; no published figure found). */
const CPS_P=0.2, CPS_T=313.15;
const cpsRow=()=>COOLANT.find(isWater);
const cpsBoreSuggest=c=>latBoreM(c)>0 ? tubeBoreMm(c) : TUBE_BORE_PITCH*c.lat.pitch*1000;
const cpsBoreMm=c=>(c.cps&&c.cps.bore)??cpsBoreSuggest(c);
const cpsWallSuggest=c=>{ const a=COOLANT[c.cool]; return latBoreM(c)>0 ? tubeWallMm(a.P0,a,c) : wallSuggestMm(cpsBoreMm(c),CPS_P,cpsRow()); };
const cpsWallMm=c=>(c.cps&&c.cps.wall)??cpsWallSuggest(c);
const cpsGapSuggest=c=>tubeGapMm(c);
const cpsGapMm=c=>(c.cps&&c.cps.gap)??cpsGapSuggest(c);
/* the gap between graphite columns, mm, and its fill's helium mole fraction: 1.2 mm and 40 % He in N2 (Kaliatka
   et al., STNI 2008, read: the gap their conductance is worked on, fill after the Ignalina source book) */
const colGapSuggest=()=>1.2, COL_HE=0.4;
const colGapMm=c=>c.colGap??colGapSuggest(c);
/* fuel, block and control channel slots in the drawn quarter */
function latCounts(c){ let nF=0,nM=0,nC=0;
  for(let q=0;q<LQ*LQ;q++){ const s=c.lat.slot[q]; if(s===L_MOD) nM++; else if(s===L_CPS) nC++; else if(s) nF++; }
  return {nF,nM,nC}; }
/* m2 per unit core height over the drawn quarter, or over counts n (nW: slots of bare coolant); chan is the control channels' water, there only when their circuit is piped */
function latVols(c,n=latCounts(c)){
  const {nF,nM,nC}=n, nW=n.nW||0;
  const cell=c.lat.pitch*c.lat.pitch, p0=LAT_P0*LAT_P0;
  const b=nC ? cpsBoreMm(c)/1000 : 0, t=nC ? cpsWallMm(c)/1000 : 0, d=b+2*t, wet=nC>0 && cpsWet(c);
  return {nF,nM,nC,fuel:nF*latFuelFrac(c)*p0,
          cool:nF*Math.max(0,latChanA(c)-latRodFrac(c)*p0)+nW*cell,
          mod:nM*cell+nF*latBlockA(c)+nC*Math.max(0,cell-Math.PI/4*d*d),
          chanV:nC*Math.PI/4*b*b, chan:wet ? nC*Math.PI/4*b*b : 0, chanTube:nC*Math.PI*(b+t)*t};
}
const cpsRho=()=>waterFig(CPS_P,CPS_T,0).rho;
const modRatio=(c,voided)=>{ const v=latVols(c); if(v.fuel<=0) return 0;
  return ((voided?0:v.cool*COOLANT[c.cool].modK)+v.mod*MODER[c.mod].modK+v.chan*cpsRow().modK)/v.fuel; };
const modShares=c=>{ const v=latVols(c);
  const cc=v.cool*COOLANT[c.cool].modK, m=v.mod*MODER[c.mod].modK, ch=v.chan*cpsRow().modK, t=cc+m+ch;
  return t>1e-12? {cool:cc/t,block:m/t,chan:ch/t} : {cool:0,block:0,chan:0}; };
const modCoolShare=c=>modShares(c).cool;
/* H atoms per heavy-metal atom off the drawing (plan-reactor-ui 8.1): the water's H plus a hydride block's,
   over the fuel's own heavy metal. Molar masses IUPAC; the hydride molar mass is ZrH1.6's 92.837 g/mol, the only
   H-bearing block row in the table. */
const hmRatioOf=c=>{ const v=latVols(c), w=fuelVolW(c);
  let HM=0; for(let f=0;f<w.length;f++) if(w[f]>0) HM+=w[f]*FUEL[f].rho*FUEL[f].hm/FUEL[f].M;
  HM*=v.fuel;
  if(!(HM>0)) return 0;
  let H=0;
  if(isWater(COOLANT[c.cool])) H+=v.cool*coolFig(COOLANT[c.cool]).rho/0.018015*2;
  if(MODER[c.mod].comp.H) H+=v.mod*MODER[c.mod].dens*1000/0.092837*MODER[c.mod].comp.H;
  return H/HM; };
/* migration area cm2 and one-group D cm: each moderator's published figure at its own density (M2 ~ 1/N^2, D ~ 1/N),
   over the lattice's moderation shares, run out to the fast lattice's as the lattice's fast share leaves the stock water lattice's for the
   fast end; the published lattice figures already carry their own fast fission */
const migRow=a=>isWater(a) ? MIG_WATER : a.mig;
function latMig(c){
  const sh=modShares(c), a=COOLANT[c.cool], md=MODER[c.mod];
  let m2=0, dc=0;
  const add=(s,r,rho)=>{ if(!(s>0)) return; const k=r.rho ? r.rho/rho : 1; m2+=s*r.m2*k*k; dc+=s*r.dc*k; };
  add(sh.cool,migRow(a),coolFig(a).rho); add(sh.block,md.mig,md.dens*1000); add(sh.chan,MIG_WATER,cpsRho());
  const w=LAW_REF_BUSY ? 0 : (f0=>clamp((fastShareOf(c)-f0)/(1-f0),0,1))(lawRef(ARCHPRE[0][1].fuel).fast);
  return {m2:(1-w)*m2+w*MIG_FAST.m2, dc:(1-w)*dc+w*MIG_FAST.dc};
}
const HS_FUEL=0, HS_CLAD=1, HS_COOL=2, HS_BLK=3, HS_TUBE=4, HS_ABS=5, HS_CW=6, HS_CT=7, HS_N=8;
/* the (void x rod coverage) grid the engine interpolates: the five GAMMA (and capture) shares of prompt heat,
   water, blocks, structures, absorber and control channels, then of decay heat. The neutrons' own share is a
   ratio of moderation weights that steps where the last of the water goes, and a grid would ramp that step
   over a whole interval. */
const HS_GRID=5, HS_OUT=10;
/* Zr-Nb pressure tube on pure Zr, as tubeMass() weighs it */
const TUBE_MAT={comp:{Zr:1}};
/* atoms per barn-cm of each nuclide of a material at rho kg/m3, times k, added into o; U splits into U-235
   and U-238 by enr (weight) and gives pu of its atoms to Pu-239; B splits into B-10 and B-11 by b10 (atoms) */
const N_AV_BCM=6.02214076e23*1e-30;
function numDensAdd(comp,rho,enr,pu,k,o,b10=B10_NAT){ let m=0; for(const e in comp) m+=comp[e]*(e==="B" ? bAwt(b10) : AWT[e]);
  const n=k*rho/(m/1000)*N_AV_BCM;
  for(const e in comp){ const x=comp[e]*n;
    if(e==="U"){ const a5=(enr/235.044)/(enr/235.044+(1-enr)/238.051);
      o.U235=(o.U235||0)+x*(1-pu)*a5; o.U238=(o.U238||0)+x*(1-pu)*(1-a5); o.Pu239=(o.Pu239||0)+x*pu; }
    else if(e==="B"){ o.B10=(o.B10||0)+x*b10; o.B11=(o.B11||0)+x*(1-b10); }
    else o[e]=(o[e]||0)+x; }
  return o; }
/* the fuel's own enrichment, blended by fuel volume: the uranium anywhere in the core is the fuel's */
/* effective enrichment per fuel row off the per-zone knob (plan-reactor-ui 8.3): the zones carrying a row
   share its volume. Live, never cached: a FUEL-row edit reads through with no revolve. Design-time only. */
function fuelEnrW(c){ const zt=latM(c).zTot, e=new Float64Array(FUEL.length), wsum=new Float64Array(FUEL.length);
  let tot=0; for(let z=0;z<LAT_NZ;z++) tot+=zt[z];
  for(let z=0;z<LAT_NZ;z++){ const f=zoneFuelOf(c,z), v=tot>1e-9?zt[z]/tot:(z===0?1:0);
    e[f]+=v*zoneEnrOf(c,z); wsum[f]+=v; }
  for(let f=0;f<e.length;f++) e[f]=wsum[f]>0?e[f]/wsum[f]:FUEL[f].enr;
  return e; }
function fuelIsoOf(c,w=fuelVolW(c)){ let e=0, p=0; const enrW=fuelEnrW(c);
  for(let i=0;i<w.length;i++) if(w[i]>0){ e+=w[i]*enrW[i]; p+=w[i]*(FUEL[i].pu||0); }
  return {enr:e, pu:p}; }
const NUC_HEAVY=["U235","U238","Pu239"];
/* One material's thermal book at 2200 m/s: sa, sf, nsf 1/cm; shm the heavy metal's absorption, sfis[nuc]
   each fissile nuclide's own; str the transport cross section (free atom, mu-bar 2/3A); ec, loc MeV per
   capture, the capture-weighted gamma and charged-particle energies; cap[g] its capture photons by group,
   per MeV of capture energy. saF, sfF, nsfF the same three on the one-group fast book. */
function bookOf(nd){
  const o={sa:0,sf:0,nsf:0,saF:0,sfF:0,nsfF:0,shm:0,str:0,ec:0,loc:0,sfis:{},cap:new Float64Array(GAM_NG)};
  let sc=0;
  for(const e in nd){ const N=nd[e], d=NUC[e]; if(!(N>0)) continue;
    const sa=N*d.sa, sf=N*(d.sf||0), c=sa-sf, A=AWT[e]||(e==="U235"?235.044:e==="U238"?238.051:239.052);
    o.sa+=sa; o.sf+=sf; o.nsf+=sf*(d.nu||0); o.str+=N*d.ss*(1-2/(3*A));
    o.saF+=N*d.saF; o.sfF+=N*d.sfF; o.nsfF+=N*d.sfF*(d.nu||0);
    if(NUC_HEAVY.includes(e)){ o.shm+=sa; if(d.sf) o.sfis[e]=sa; }
    sc+=c; o.ec+=c*d.Ec; o.loc+=c*(d.loc||0);
    const sh=d.line ? gamLine(d.Ec) : GAM_FISS;
    for(let g=0;g<GAM_NG;g++) o.cap[g]+=c*d.Ec*sh[g]; }
  if(sc>0){ o.ec/=sc; o.loc/=sc; }
  let t=0; for(let g=0;g<GAM_NG;g++) t+=o.cap[g];
  for(let g=0;g<GAM_NG;g++) o.cap[g]= t>0 ? o.cap[g]/t : 0;
  return o; }
/* U-235 prompt fission photons, N(E) = 6.6 (0.1-0.6 MeV), 20.2 e^-1.78E (0.6-1.5), 7.2 e^-1.09E (1.5-10.5)
   per MeV per fission (Lamarsh, as commonly quoted, not read at source): its energy by group, summing to 1.
   The delayed and cascade capture photons are priced on the same shape; the line captures (H, Li, B, C)
   on their own line. */
const GAM_FISS=(function(){ const o=new Float64Array(GAM_NG), N=20000, lo=0.1, hi=10.5;
  const nE=E=>E<0.6 ? 6.6 : E<1.5 ? 20.2*Math.exp(-1.78*E) : 7.2*Math.exp(-1.09*E);
  let t=0;
  for(let i=0;i<N;i++){ const E=lo+(hi-lo)*(i+.5)/N, e=E*nE(E)*(hi-lo)/N;
    let g=0; while(g<GAM_NG-1 && E>=GAM_EDGE[g+1]) g++;
    o[g]+=e; t+=e; }
  for(let g=0;g<GAM_NG;g++) o[g]/=t;
  return o; })();
const gamLine=E=>{ const o=new Float64Array(GAM_NG); let g=0;
  while(g<GAM_NG-1 && E>=GAM_EDGE[g+1]) g++; o[g]=1; return o; };
for(const e of ["H","Li","Li7","B","B10","C"]) NUC[e].line=true;
/* one lattice cell per unit core height over the drawn quarter, the coolant at void al and the drawn absorber at coverage
   cov: each region's volume m2, density, material and atoms per barn-cm. A region the drawing does not have has no volume.
   cnt: counts in place of the drawing's, cnt.w the fuel mix. */
function cellMatOf(c,al=0,cov=1,cnt){
  const v=latVols(c,cnt), a=COOLANT[c.cool], m=MODER[c.mod], cl=cladOf(c), L=c.lat, w=cnt&&cnt.w||fuelVolW(c), iso=fuelIsoOf(c,w);
  const n=HS_N, vol=new Float64Array(n), rho=new Float64Array(n), mat=[], nd=[];
  const fd={}; let fr=0; const enrW=fuelEnrW(c);
  for(let i=0;i<w.length;i++) if(w[i]>0){ const F=FUEL[i]; fr+=w[i]*F.rho; numDensAdd(F.comp,F.rho,enrW[i],F.pu||0,w[i],fd); }
  vol[HS_FUEL]=v.fuel; rho[HS_FUEL]=fr; mat[HS_FUEL]=FUEL[zoneFuelOf(c,0)]; nd[HS_FUEL]=fd;
  vol[HS_CLAD]=v.nF*(latRodFrac(c)-latFuelFrac(c))*LAT_P0*LAT_P0; rho[HS_CLAD]=cl.rho; mat[HS_CLAD]=cl;
  vol[HS_COOL]=v.cool; rho[HS_COOL]=(isWater(a) ? waterFig(a.P0,a.Tref,0).rho : coolFig(a).rho)*(1-al); mat[HS_COOL]=a;
  vol[HS_BLK]=v.mod; rho[HS_BLK]=m.dens*1000; mat[HS_BLK]=m;
  if(fuelDissolved(c)){ vol[HS_FUEL]+=vol[HS_CLAD]+vol[HS_COOL]; vol[HS_CLAD]=vol[HS_COOL]=0; rho[HS_FUEL]*=1-al;
    for(const e in fd) fd[e]*=1-al; }
  if(latBoreM(c)>0){ const b=latBoreM(c), t=tubeWallMm(a.P0,a,c)/1000;
    vol[HS_TUBE]=v.nF*Math.PI*(b+t)*t; rho[HS_TUBE]=ZR_RHO; mat[HS_TUBE]=TUBE_MAT; }
  const ab=ABSORB[L.abs];
  vol[HS_ABS]=latAbsA(c)*cov; rho[HS_ABS]=ab.dens*1000; mat[HS_ABS]=ab;
  vol[HS_CW]=v.chan; rho[HS_CW]=cpsRho(); mat[HS_CW]=cpsRow();
  vol[HS_CT]=v.chanTube; rho[HS_CT]=ZR_RHO; mat[HS_CT]=TUBE_MAT;
  for(let r=0;r<n;r++){
    if(!nd[r]) nd[r]= mat[r] ? numDensAdd(mat[r].comp||atomsOfW(mat[r].compW),rho[r],iso.enr,iso.pu,1,{},r===HS_ABS ? absEnr(c) : B10_NAT) : {};
    if(!(vol[r]>0)) vol[r]=0; }
  return {n,vol,rho,mat,nd}; }
/* the same cell with the book of what each region is made of, and per group its sig 1/cm and mu_en/mu */
function heatCellOf(c,al=0,cov=1,cnt){
  const R=cellMatOf(c,al,cov,cnt), G=GAM_NG, n=R.n, sig=new Float64Array(n*G), f=new Float64Array(n*G), book=[];
  for(let r=0;r<n;r++){ book[r]=bookOf(R.nd[r]);
    if(!(R.vol[r]>0)) continue;
    const gm=gamOf(R.mat[r]);
    for(let g=0;g<G;g++){ sig[r*G+g]=R.rho[r]/1000*gm.mu[g]; f[r*G+g]=gm.mu[g]>0 ? gm.en[g]/gm.mu[g] : 1; } }
  return {n,vol:R.vol,sig,f,book,nd:R.nd,rho:R.rho}; }
/* The level-1 photon cell of a fuel slot, cm, centred on the origin. Bare: a pin cell of side p/sqrt(nRod)
   round one rod. Bored: the whole slot; max(1, round(nRod)) rods in the bore, a centre rod when that is 1
   mod 6, ring k 6k rods and the last ring the rest, each ring on the area centroid of its share of the bore,
   odd rings from angle 0 and even rings half their step round; the block is cut half way out and at the
   inscribed circle. Rods that overlap smear the bore into one mixture; a dissolved fuel fills a bare slot or a
   bore with salt alone. comp[k] lists sub-region k's HS regions and their shares of its volume, vol[k] its
   exact cm2 where the cell is not clipped; nCell such cells over the drawn quarter. */
function gamCellOf(c){
  const v=latVols(c), a=COOLANT[c.cool], p=100*c.lat.pitch, nRod=latBundle(c).nRod, rc=50*rodD(c), rp=50*rodDP(c), bore=latBoreM(c);
  if(fuelDissolved(c) && !(bore>0)) return {s:p, circ:[], n:1, nCell:v.nF, pin:false, comp:[[[HS_FUEL,1]]], vol:[p*p], sub:()=>0};
  if(!(bore>0)){ const s=p/Math.sqrt(nRod);
    return {s, circ:[0,0,rp,0,0,rc], n:3, nCell:v.nF*nRod, pin:true, comp:[[[HS_FUEL,1]],[[HS_CLAD,1]],[[HS_COOL,1]]],
      vol: rc<=s/2 ? [Math.PI*rp*rp, Math.PI*(rc*rc-rp*rp), s*s-Math.PI*rc*rc] : null,
      sub:(x,y)=>{ const d=x*x+y*y; return d<rp*rp ? 0 : d<rc*rc ? 1 : 2; }}; }
  const rb=50*bore, rt=rb+tubeWallMm(a.P0,a,c)/10, [r1,r2]=gamRings(rt,p), nR=Math.max(1,Math.round(nRod));
  const cnt=[]; let left=nR;
  if(nR%6===1){ cnt.push(1); left--; }
  for(let k=1;left>0;k++){ const m=Math.min(6*k,left); cnt.push(m); left-=m; }
  const rods=[]; let cum=0, R0=0;
  for(let i=0;i<cnt.length;i++){ const k= nR%6===1 ? i : i+1, R=rb*Math.sqrt((cum+=cnt[i])/nR);
    const rho= k===0 ? 0 : Math.min(2/3*(R*R*R-R0*R0*R0)/(R*R-R0*R0), rb-rc), ph= k%2 ? 0 : Math.PI/cnt[i];
    for(let j=0;j<cnt[i];j++){ const t=ph+2*Math.PI*j/cnt[i]; rods.push(rho*Math.cos(t), rho*Math.sin(t), i); }
    R0=R; }
  let fit=rb>=rc && !fuelDissolved(c);
  for(let i=0;fit&&i<rods.length;i+=3) for(let j=i+3;j<rods.length;j+=3)
    if(Math.hypot(rods[i]-rods[j],rods[i+1]-rods[j+1])<2*rc*(1-1e-9)){ fit=false; break; }
  const nG=fit ? cnt.length : 0, iC=fit ? 2*nG : 0, circ=[0,0,rb,0,0,rt,0,0,r1,0,0,r2], comp=[], vol=[], PI=Math.PI;
  const out=(d)=> d<rt ? iC+1 : d<r1 ? iC+2 : d<r2 ? iC+3 : iC+4;
  if(fit){ for(let i=0;i<nG;i++){ comp.push([[HS_FUEL,1]],[[HS_CLAD,1]]); vol.push(cnt[i]*PI*rp*rp, cnt[i]*PI*(rc*rc-rp*rp)); }
    comp.push([[HS_COOL,1]]); vol.push(PI*(rb*rb-nR*rc*rc));
    for(let i=0;i<rods.length;i+=3) circ.push(rods[i],rods[i+1],rp,rods[i],rods[i+1],rc); }
  else { const A=PI*rb*rb, vf=nR*PI*rp*rp, vc=nR*PI*(rc*rc-rp*rp), vw=Math.max(0,A-nR*PI*rc*rc), t=vf+vc+vw;
    comp.push(fuelDissolved(c) ? [[HS_FUEL,1]] : [[HS_FUEL,vf/t],[HS_CLAD,vc/t],[HS_COOL,vw/t]]); vol.push(A); }
  comp.push([[HS_TUBE,1]],[[HS_BLK,1]],[[HS_BLK,1]],[[HS_BLK,1]]);
  vol.push(PI*(rt*rt-rb*rb), PI*(r1*r1-rt*rt), PI*(r2*r2-r1*r1), p*p-PI*r2*r2);
  const rp2=rp*rp, rc2=rc*rc;
  return {s:p, circ, n:comp.length, nCell:v.nF, pin:false, comp, vol: rt<r2 ? vol : null,
    sub:(x,y)=>{ const d=Math.hypot(x,y); if(d>=rb) return out(d); if(!fit) return 0;
      for(let i=0;i<rods.length;i+=3){ const dx=x-rods[i], dy=y-rods[i+1], e=dx*dx+dy*dy;
        if(e<rc2) return 2*rods[i+2]+(e<rp2 ? 0 : 1); }
      return iC; }}; }
/* the block round a bored column is cut half way out and at the inscribed circle */
const gamRings=(rt,p)=>[(rt+p/2)/2,p/2];
/* The level-1 photon cell of a control channel column, cm: its water, its tube and its block */
function gamChanCell(c){
  const v=latVols(c), p=100*c.lat.pitch, rb=cpsBoreMm(c)/20, rt=rb+cpsWallMm(c)/10, [r1,r2]=gamRings(rt,p), PI=Math.PI;
  return {s:p, circ:[0,0,rb,0,0,rt,0,0,r1,0,0,r2], n:5, nCell:v.nC, pin:false,
    comp:[[[HS_CW,1]],[[HS_CT,1]],[[HS_BLK,1]],[[HS_BLK,1]],[[HS_BLK,1]]],
    vol: rt<r2 ? [PI*rb*rb, PI*(rt*rt-rb*rb), PI*(r1*r1-rt*rt), PI*(r2*r2-r1*r1), p*p-PI*r2*r2] : null,
    sub:(x,y)=>{ const d=Math.hypot(x,y); return d<rb ? 0 : d<rt ? 1 : d<r1 ? 2 : d<r2 ? 3 : 4; }}; }
/* tracking density: GAM_K angles, lines at most GAM_DL cm apart and no more than an eighth of a pin's radius */
const GAM_K=4, GAM_DL=0.2;
function gamKit(c){ const cell=gamCellOf(c), d=cell.pin ? Math.min(GAM_DL,50*rodD(c)/8) : GAM_DL, ch=latVols(c).nC>0 ? gamChanCell(c) : null;
  return {cell, T:gamTrack(cell,GAM_K,d), cp:new Map(), ch, TC:ch ? gamTrack(ch,GAM_K,GAM_DL) : null, cpC:null}; }
/* The HS regions' deposition dep[r] from sources s[r*GAM_NG+g] in the drawn lattice at void al and coverage cov:
   each HS region's source spread over its sub-regions, blocks and absorber by volume, the chain solved, and a
   mixture's deposition split by each part's sig f. Fuel cells, channel cells and blocks meet by the faces
   their slots share, the absorber by its surface. K is gamKit(c)'s; the fuel cell's probabilities are kept
   per void, the channel cell's once. */
function gamDepose(c,K,R,al,cov,s,dep){
  const G=GAM_NG, cell=K.cell, T=K.T, n=cell.n, ch=K.ch, m=ch ? ch.n : 0, c0=n+3, NS=n+3+(ch ? m+1 : 0), p=c.lat.pitch, L=c.lat;
  const sig=new Float64Array(NS*G), f=new Float64Array(NS*G), src=new Float64Array(NS*G), wk=new Float64Array(NS*G), VH=new Float64Array(HS_N);
  const isF=q=>latFuel(c,q), isM=q=>L.slot[q]===L_MOD, isC=q=>L.slot[q]===L_CPS;
  const FM=latFaces(c,isF,isM), FC=ch ? latFaces(c,isF,isC) : 0, CM=ch ? latFaces(c,isC,isM) : 0;
  const VM=latVols(c).nM*p*p, VA=latAbsA(c)*cov, SA=latRodded(c)*absN(c)*Math.PI*absD(c)*cov;
  const cells=[[cell,T,0]]; if(ch) cells.push([ch,K.TC,c0]);
  const vk=(C,TT,k)=>TT.V[k]*1e-4*C.nCell;
  for(const [C,TT,o] of cells) for(let k=0;k<C.n;k++) for(const [r,x] of C.comp[k]){ VH[r]+=vk(C,TT,k)*x;
    for(let g=0;g<G;g++){ const q=x*R.sig[r*G+g], i=(o+k)*G+g; sig[i]+=q; f[i]+=q*R.f[r*G+g]; } }
  for(let i=0;i<NS*G;i++) f[i]= sig[i]>0 ? f[i]/sig[i] : 1;
  VH[HS_BLK]+=VM; VH[HS_ABS]+=VA;
  for(let g=0;g<G;g++){ sig[(n+1)*G+g]=R.sig[HS_BLK*G+g]; f[(n+1)*G+g]=R.f[HS_BLK*G+g];
    sig[(n+2)*G+g]=R.sig[HS_ABS*G+g]; f[(n+2)*G+g]=R.f[HS_ABS*G+g]; }
  const sh=(r,V)=> VH[r]>0 ? V/VH[r] : 0;
  for(const [C,TT,o] of cells) for(let k=0;k<C.n;k++) for(const [r,x] of C.comp[k]){ const w=sh(r,vk(C,TT,k)*x);
    for(let g=0;g<G;g++) src[(o+k)*G+g]+=s[r*G+g]*w; }
  for(let g=0;g<G;g++){ src[(n+1)*G+g]=s[HS_BLK*G+g]*sh(HS_BLK,VM); src[(n+2)*G+g]=s[HS_ABS*G+g]*sh(HS_ABS,VA); }
  let cp=K.cp.get(al); if(!cp){ cp=gamCP(T,sig); K.cp.set(al,cp); }
  if(ch && !K.cpC) K.cpC=gamCP(K.TC,sig.subarray(c0*G,(c0+m)*G));
  const P1=cell.nCell*T.S, P2=ch ? ch.nCell*K.TC.S : 0, SMt=(FM+CM)*p;
  const q1=P1>0 ? 100/P1 : 0, e1=Math.max(1,q1*(FM*p+SA+FC*p)), q2=P2>0 ? 100/P2 : 0, e2=Math.max(1,q2*(FC+CM)*p);
  gamChain(cp,n,{fM:q1*FM*p/e1, fA:q1*SA/e1, fC:q1*FC*p/e1, lM:SMt>0 ? 400*VM/SMt : Infinity, lA:100*absD(c),
    cpC:ch ? K.cpC : null, nC:m, gF:q2*FC*p/e2, gM:q2*CM*p/e2, mC:SMt>0 ? CM*p/SMt : 0},sig,f,src,wk);
  dep.fill(0);
  for(const [C,,o] of cells) for(let k=0;k<C.n;k++) for(let g=0;g<G;g++){ const d=wk[(o+k)*G+g]; if(!d) continue;
    let t=0; for(const [r,x] of C.comp[k]) t+=x*R.sig[r*G+g]*R.f[r*G+g];
    for(const [r,x] of C.comp[k]) dep[r]+=d*x*R.sig[r*G+g]*R.f[r*G+g]/t; }
  for(let g=0;g<G;g++){ dep[HS_BLK]+=wk[(n+1)*G+g]; dep[HS_ABS]+=wk[(n+2)*G+g]; }
  return dep; }
/* weight fractions back to atom counts per unit mass, for a row that states compW */
const atomsOfW=w=>{ const o={}; for(const e in w) o[e]=w[e]/(e==="B" ? bAwt(B10_NAT) : AWT[e]); return o; };
/* faces a slot passing a shares with one passing b over the drawn quarter; a face across a symmetry axis meets
   its own mirror */
function latFaces(c,a,b){ let n=0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){ if(!a(LIX(u,v))) continue;
    for(const [du,dv] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=u+du, y=v+dv;
      if(x<0||y<0||x>=LQ||y>=LQ) continue;
      if(b(LIX(x,y))) n++; } }
  return n; }
/* faces an L_MOD slot shares with a fuel slot; none when the fuel slots are bored unless bored is asked */
const latModFaces=(c,bored=false)=> !bored && latBoreM(c)>0 ? 0 : latFaces(c,q=>c.lat.slot[q]===L_MOD,q=>latFuel(c,q));
/* the thermal-neutron book of the whole cell at void al, rest bank out: region volumes times their own
   cross sections. f the thermal utilisation (heavy metal over everything but the control absorber), nu
   the fissile mix's own, fis[r] each region's share of fission, cap[r] of non-fission absorption. */
function latBook(c,al=0,bu=0){
  const R=heatCellOf(c,al,0), n=R.n;
  if(bu>0){ R.nd[HS_FUEL]=lawFuelNd(R.nd[HS_FUEL],{bu},c); R.book[HS_FUEL]=bookOf(R.nd[HS_FUEL]); }
  const B=R.book;
  let sa=0, hm=0, sf=0, nsf=0, sc=0, str=0, vt=0;
  const fis=new Float64Array(n), cap=new Float64Array(n), sfis={};
  for(let r=0;r<n;r++){ if(r===HS_ABS || !(R.vol[r]>0)) continue; const V=R.vol[r], b=B[r];
    sa+=V*b.sa; hm+=V*b.shm; sf+=V*b.sf; nsf+=V*b.nsf; str+=V*b.str; vt+=V;
    fis[r]=V*b.sf; cap[r]=V*(b.sa-b.sf); sc+=cap[r];
    for(const k in b.sfis) sfis[k]=(sfis[k]||0)+V*b.sfis[k]; }
  for(let r=0;r<n;r++){ fis[r]= sf>0 ? fis[r]/sf : 0; cap[r]= sc>0 ? cap[r]/sc : 0; }
  let nsfF=0; for(let r=0;r<n;r++) if(r!==HS_ABS && R.vol[r]>0) nsfF+=R.vol[r]*B[r].nsfF;
  return {R, f:sa>0?hm/sa:0, nu:sf>0?nsf/sf:0, sa:vt>0?sa/vt:0, str:vt>0?str/vt:0, hm, sfis, fis, cap, saV:sa, sfV:sf, nsfFV:nsfF}; }
/* U-238's effective resonance integral in a rod, b, at 300 K against the rod's surface over its mass S/M cm2/g: metal
   2.95 + 25.8 sqrt(S/M), oxide 4.15 + 26.6 sqrt(S/M), +-4 % (Hellstrand & Lundgren, AE-77, 1962, read). Its rise with
   the fuel's own temperature, I(T) = I(300)(1 + b (sqrt T - sqrt 300)): b per sqrt(K) measured on 8, 12.5 and 28 mm rods
   (Blomberg, Hellstrand & Horner, AB Atomenergi, April 1960, Table I, read), a line in S/M through the three by least squares at the
   rows' own densities, the rods' own not stated; the 1/v capture above the cut, which the report prices apart, added back.
   Isolated rods: a tight lattice's shadowing is not carried. */
const RI_ROD={metal:{a:2.95, b:25.8, beta:[[8,.63e-2],[12.5,.65e-2],[28,.40e-2]], rho:18.7},
              oxide:{a:4.15, b:26.6, beta:[[8,.69e-2],[12.5,.66e-2],[28,.45e-2]], rho:10.4}};
for(const k in RI_ROD){ const r=RI_ROD[k], x=r.beta.map(([d])=>4/(r.rho*d/10)), y=r.beta.map(q=>q[1]), n=x.length;
  const mx=x.reduce((s,v)=>s+v,0)/n, my=y.reduce((s,v)=>s+v,0)/n;
  let sxy=0, sxx=0; for(let i=0;i<n;i++){ sxy+=(x[i]-mx)*(y[i]-my); sxx+=(x[i]-mx)*(x[i]-mx); }
  r.b1=sxy/sxx; r.b0=my-r.b1*mx; }
const riRod=(form,sm,T)=>{ const r=RI_ROD[form]; return (r.a+r.b*Math.sqrt(sm))*(1+(r.b0+r.b1*sm)*(Math.sqrt(T)-Math.sqrt(300)))+NUC.U238.sa*RI_1V; };
/* the Dancoff factor of a rod among its neighbours, the share of resonance neutrons its surface does not see because the
   next rod shadows it: Sauer's rational form for a square lattice, C = exp(-tau l)/(1 + (1 - tau) l), l the mean chord of
   the clad and coolant per rod over their potential scattering, tau = (sqrt(pi/4 (1 + Vm/Vf)) - 1) Vf/Vm - 0.08 (Sauer,
   Nucl. Sci. Eng. 16, 1963, as commonly quoted, not read at source). The rod's surface over mass goes as (1 - C). A bore's
   rods see each other through its own coolant, the block round it taken as black; an open lattice smears its blocks and
   control channels in among the rods. */
function latDancoff(c,R,cnt){
  const v=latVols(c,cnt), nb=latBundle(c).nRod, n=v.nF*nb, bored=latBoreM(c)>0; if(!(n>0) || (bored && nb<1.5)) return 0;
  const rp=50*rodDP(c), Vf=Math.PI*rp*rp;
  let Vm=0, sv=0;
  for(const r of bored ? [HS_CLAD,HS_COOL] : [HS_CLAD,HS_COOL,HS_BLK,HS_CW,HS_CT]){ const V=R.vol[r]*1e4/n; if(!(V>0)) continue;
    let s=0; for(const e in R.nd[r]) s+=R.nd[r][e]*NUC[e].ss; Vm+=V; sv+=s*V; }
  if(!(Vm>0)) return 0;
  const l=sv*4/(2*Math.PI*rp), tau=(Math.sqrt(Math.PI/4*(1+Vm/Vf))-1)*Vf/Vm-0.08;
  return Math.exp(-tau*l)/(1+(1-tau)*l); }
/* U-238 dissolved among its scatterers, b per U-238 atom of potential scattering sp: 3.9 sp^0.415 (Lamarsh, Introduction to
   Nuclear Reactor Theory, as commonly quoted, not read at source), no higher than the infinitely dilute integral; its
   broadening the oxide rods' measured one run to a vanishing surface, the thinnest lump there is */
const riHom=(sp,T)=>Math.min(3.9*Math.pow(Math.max(sp,0),0.415), NUC.U238.ric)*(1+RI_ROD.oxide.b0*(Math.sqrt(T)-Math.sqrt(300)));
/* the energy bounds: fission neutrons above U-238's fission threshold LAW_ET, the fast region down to LAW_EFAST on the kT =
   30 keV book, the 1/E region down to LAW_ECUT on the resonance integrals, thermal below on the 2200 m/s book at its own
   neutron temperature */
const LAW_ET=1e6, LAW_EFAST=1e4, LAW_ECUT=0.5, U_FAST=Math.log(LAW_ET/LAW_EFAST), U_EPI=Math.log(LAW_EFAST/LAW_ECUT);
const xiOf=A=>{ if(A<1.01) return 1; const a=((A-1)/(A+1))**2; return 1+a*Math.log(a)/(1-a); };
const massOf=e=>AWT[e]||(e==="U235"?235.044:e==="U238"?238.051:239.052);
/* the share of fission neutrons born above LAW_ET: U-235's Watt spectrum, a 0.988 MeV, b 2.249 /MeV (as commonly quoted, not read) */
const LAW_CHI=(()=>{ const w=E=>Math.exp(-E/0.988)*Math.sinh(Math.sqrt(2.249*E)); let t=0, h=0;
  for(let i=0;i<40000;i++){ const E=(i+.5)*1e-3, v=w(E); t+=v; if(E>=LAW_ET/1e6) h+=v; } return h/t; })();
/* above the threshold, about LAW_TE MeV: fission and capture the kT = 1.42 MeV Maxwellian averages of ENDF/B-VII.1 (Pritychenko
   & Mughabghab 2012, Tables XVIII and XIX, read 24/09/26); scattering a black nucleus, total 2 pi (R + lambda)^2 half of it
   shape elastic, R = 1.25 A^1/3 fm (Blatt & Weisskopf, as commonly quoted, not read), the rest inelastic where the nucleus has
   levels under the band and elastic where it has none (A under 20); hydrogen the n-p cross section at 2 MeV, 2.9 b (as
   commonly quoted, not read). A neutron leaves the band on any inelastic collision and on an elastic one by xi over the
   band's lethargy, at most once. nu rises 0.13 a MeV over the thermal (as commonly quoted); U-238's its own. */
const LAW_TE=2, LAW_TU=Math.log(LAW_TE*1e6/LAW_ET);
const T_FC={U235:[1.382,.06740], U238:[.4740,.05360], Pu239:[2.070,.02192]};
const NUC_T={};
function nucT(e){ let t=NUC_T[e]; if(t) return t;
  const d=NUC[e], A=massOf(e), fc=T_FC[e]||[0,0], m=Math.min(1,xiOf(A)/LAW_TU), nu=e==="U238" ? d.nuF : (d.nu||0)+0.13*LAW_TE;
  if(A<1.5) t={f:0, c:0, nu, r:2.9*m};
  else { const lam=197.327/Math.sqrt(2*939.565*LAW_TE)*(A+1)/A, R=1.25*Math.cbrt(A), s=Math.PI*(R+lam)*(R+lam)/100, non=Math.max(0,s-fc[0]-fc[1]);
    t={f:fc[0], c:fc[1], nu, r: A<20 ? (s+non)*m : non+s*m}; }
  return NUC_T[e]=t; }
/* The lattice's own multiplication, homogenised over the cell at void al: four energy regions in series. Threshold: LAW_CHI of
   the fission neutrons are born over U-238's threshold, where it fissions against leaving the band (nucT()). Fast: the
   30 keV book, leaving by slowing, xi sig_s(30 keV)/u. Epithermal: Wigner's narrow-resonance escape p = exp(-sum N I/xi sig_s),
   the absorbed share fissioning as the integrals do. Thermal: eta f on the book at the neutron temperature Tn, the fissile
   nuclides on Westcott's g. o.Tf the fuel's resonance temperature, o.Tn the neutron temperature, o.bor B-10 atoms per barn-cm
   in the coolant, o.bu the burnup (latDeplete()), o.x a composition, o.cnt counts (latVols()), o.fol [region, m2, atoms per
   barn-cm, chord cm] a follower taking that much of a region's volume (folRhoOf()); o.gd a burnable poison's thermal
   absorption (gdAbs()), o.gdf the share of the fuel inside its black pellets, which sees no thermal flux. */
/* modified Bessel functions, Abramowitz & Stegun 9.8.1-9.8.8 (polynomial fits, |error| under 2e-7 relative) */
function besI0(x){ const t=x/3.75; if(x<=3.75){ const y=t*t; return 1+y*(3.5156229+y*(3.0899424+y*(1.2067492+y*(0.2659732+y*(0.0360768+y*0.0045813))))); }
  const y=1/t; return Math.exp(x)/Math.sqrt(x)*(0.39894228+y*(0.01328592+y*(0.00225319+y*(-0.00157565+y*(0.00916281+y*(-0.02057706+y*(0.02635537+y*(-0.01647633+y*0.00392377))))))));}
function besI1(x){ const t=x/3.75; if(x<=3.75){ const y=t*t; return x*(0.5+y*(0.87890594+y*(0.51498869+y*(0.15084934+y*(0.02658733+y*(0.00301532+y*0.00032411)))))); }
  const y=1/t; return Math.exp(x)/Math.sqrt(x)*(0.39894228+y*(-0.03988024+y*(-0.00362018+y*(0.00163801+y*(-0.01031555+y*(0.02282967+y*(-0.02895312+y*(0.01787654-y*0.00420059))))))));}
function besK0(x){ if(x<=2){ const y=x*x/4; return -Math.log(x/2)*besI0(x)+(-0.57721566+y*(0.42278420+y*(0.23069756+y*(0.03488590+y*(0.00262698+y*(0.00010750+y*0.0000074)))))); }
  const y=2/x; return Math.exp(-x)/Math.sqrt(x)*(1.25331414+y*(-0.07832358+y*(0.02189568+y*(-0.01062446+y*(0.00587872+y*(-0.00251540+y*0.00053208)))))); }
function besK1(x){ if(x<=2){ const y=x*x/4; return Math.log(x/2)*besI1(x)+(1/x)*(1+y*(0.15443144+y*(-0.67278579+y*(-0.18156897+y*(-0.01919402+y*(-0.00110404-y*0.00004686)))))); }
  const y=2/x; return Math.exp(-x)/Math.sqrt(x)*(1.25331414+y*(0.23498619+y*(-0.03655620+y*(0.01504268+y*(-0.00780353+y*(0.00325614-y*0.00068245)))))); }
/* the thermal utilisation of a cylindrical unit cell in diffusion theory: fuel radius a, cell radius b cm, each region's
   inverse diffusion length kF, kM 1/cm and absorption SaF, SaM over volumes VF, VM (Lamarsh, Introduction to Nuclear
   Reactor Theory, sec. 6.6, as commonly quoted, not read at source): 1/f - 1 = (SaM VM/SaF VF) F + E - 1 */
function cellUtil(a,b,kF,kM,SaF,SaM,VF,VM){
  const xF=kF*a, F=xF>1e-6 ? xF*besI0(xF)/(2*besI1(xF)) : 1;
  const ma=kM*a, mb=kM*b;
  const E= ma>1e-6 ? kM*kM*(b*b-a*a)/(2*a)/kM*(besI0(ma)*besK1(mb)+besK0(ma)*besI1(mb))/(besI1(mb)*besK1(ma)-besK1(mb)*besI1(ma)) : 1;
  return 1/((SaM*VM)/(SaF*VF)*F+E); }
const LAWS=new WeakMap();
const lawKey=(c,n)=>hsKey([],c).join(",")+"|"+JSON.stringify(fuelIsoOf(c))+"|"+c.power+
  (n ? "|"+[n.nF,n.nM,n.nC,n.nW||0].join(",")+"|"+Array.from(n.w||[]).join(",") : "");
function latLaw(c,o={}){
  const key=lawKey(c,o.cnt)+"|"+(o.gd||0)+","+(o.gdf||0)+"|"+(o.al||0)+"|"+(o.Tf??"")+"|"+(o.Tn??"")+"|"+(o.bor||0)+"|"+(o.bu||0);
  let m=LAWS.get(c); if(!m){ m=new Map(); LAWS.set(c,m); }
  let v=m.get(key); if(!v){ v=latLawCalc(c,o); if(m.size>64) m.clear(); m.set(key,v); }
  return v; }
/* the fuel's heavy metal and fission products at composition o.x per initial heavy atom, or burnt to o.bu MWd/kgHM */
function lawFuelNd(fd,o,c){ const x=o.x || (o.bu>0 ? latDeplete(c,o.bu) : null); if(!x) return fd;
  const hm=(fd.U235||0)+(fd.U238||0)+(fd.Pu239||0), r=Object.assign({},fd);
  r.U235=hm*x.U235; r.U238=hm*x.U238; r.Pu239=hm*x.Pu239; r.FP=hm*x.FP; return r; }
/* K: the pellet at rated power, the law's own rest */
const lawTf=c=>COOLANT[c.cool].Tref+pinDTf(c);
function latLawCalc(c,o){
  const al=o.al||0, n=o.cnt, R=cellMatOf(c,al,0,n), a=COOLANT[c.cool];
  const Tn=o.Tn ?? Math.min(a.Tref, coolTsat(a, a.P0)), Tf=o.Tf ?? lawTf(c);
  R.nd[HS_FUEL]=lawFuelNd(R.nd[HS_FUEL],o,c);
  /* a follower's absorption self-shielded as the bank's is, Wigner's rational 1/(1 + S l) on its own chord l cm, S its own
     cross section: 2200 m/s, 30 keV, the resonance integral over the epithermal lethargy; its 1/v part S0 sqrt(E0/E) taken
     through the band exactly, (2/l) ln(1 + S0 l sqrt(E0/E_cut)) against S0 RI_1V. dF, dE the fast and epithermal absorption
     that shields away, per unit volume once over vt */
  const ndTh=[], sig=(nd,f)=>{ let s=0; for(const e in nd) s+=nd[e]*f(e); return s; }, v1=e=>FAST_PA[e]||0, res=e=>NUC[e].ric-v1(e)*RI_1V;
  let dF=0, dE=0;
  if(o.fol) for(const [r,V,nd,l] of o.fol){ const v0=R.vol[r]-Math.min(V,R.vol[r]), m={}, mt={};
    const s=1/(1+sig(nd,e=>NUC[e].sa)*l), sF=1/(1+sig(nd,e=>NUC[e].saF)*l), SR=sig(nd,res), sR=1/(1+SR/U_EPI*l), S0=sig(nd,v1);
    dF+=V*(1-sF)*sig(nd,e=>NUC[e].saF);
    dE+=V*((1-sR)*SR+S0*RI_1V-(S0>0 ? 2/l*Math.log(1+S0*l*Math.sqrt(E_2200/LAW_ECUT)) : 0));
    for(const e in R.nd[r]){ m[e]=R.nd[r][e]*v0; mt[e]=m[e]; }
    for(const e in nd){ m[e]=(m[e]||0)+nd[e]*V; mt[e]=(mt[e]||0)+nd[e]*V*s; }
    R.vol[r]=v0+V; for(const e in m){ m[e]/=R.vol[r]; mt[e]/=R.vol[r]; } R.nd[r]=m; ndTh[r]=mt; }
  const N={}; let vt=0;
  for(let r=0;r<HS_N;r++){ if(r===HS_ABS || !(R.vol[r]>0)) continue; vt+=R.vol[r];
    for(const e in R.nd[r]) N[e]=(N[e]||0)+R.vol[r]*R.nd[r][e]; }
  if(o.bor && R.vol[HS_COOL]>0){ N.B10=(N.B10||0)+R.vol[HS_COOL]*o.bor*(1-al); }
  for(const e in N) N[e]/=vt;
  const form=FUEL[zoneFuelOf(c,0)].comp.O ? "oxide" : "metal";
  let sp=0; for(const e in N) sp+=N[e]*NUC[e].ss;
  const I28= fuelDissolved(c) || !(N.U238>0) ? riHom(N.U238>0 ? sp/N.U238 : Infinity, Tf)
          : riRod(form, 2/(R.rho[HS_FUEL]/1000*50*rodDP(c))*(1-latDancoff(c,R,n)), Tf);
  let aT=0, fT=0, rT=0, aF=0, fF=0, rF=0, xs=0, ni=0, nf=0;
  for(const e in N){ const n=N[e], d=NUC[e], nu=d.nu||0, xi=xiOf(massOf(e)), t=nucT(e);
    aT+=n*(t.f+t.c); fT+=n*t.f*t.nu; rT+=n*t.r;
    aF+=n*d.saF; fF+=n*d.sfF*nu; rF+=n*xi*d.el30/U_FAST; xs+=n*xi*d.ss;
    const ic= e==="U238" ? I28 : d.ric;
    ni+=n*(ic+d.rif); nf+=n*nu*d.rif; }
  aF-=dF/vt; ni-=dE/vt;
  /* thermal: each region's own absorption, fission and transport at Tn, the fissile nuclides on Westcott's g; the fuel
     region the pellet, or a bored channel's whole contents, the rest the moderator, met across the cell by cellUtil() */
  const io=new Float64Array(2), bored=latBoreM(c)>0, T={F:{sa:0,nsf:0,st:0,V:0},M:{sa:0,nsf:0,st:0,V:0}}, thN={};
  for(let r=0;r<HS_N;r++){ if(r===HS_ABS || !(R.vol[r]>0)) continue;
    const g= r===HS_FUEL || (bored && (r===HS_CLAD || r===HS_COOL)) ? T.F : T.M, nd=Object.assign({},ndTh[r]||R.nd[r]), V=R.vol[r]*(r===HS_FUEL ? 1-(o.gdf||0) : 1);
    if(o.bor && r===HS_COOL) nd.B10=(nd.B10||0)+o.bor*(1-al);
    g.V+=V;
    for(const e in nd){ const n=nd[e]*V, d=NUC[e], nu=d.nu||0; let ga=1, gf=1;
      if(WESTCOTT[e]){ westcottA(e,"ga",Tn,io); ga=io[0]; westcottA(e,"gf",Tn,io); gf=io[0]; }
      g.sa+=n*d.sa*ga; g.nsf+=n*nu*(d.sf||0)*gf; g.st+=n*(d.sa*ga+d.ss*(1-2/(3*massOf(e))));
      if(g===T.F && LAW_BURN.includes(e)){ const t=thN[e]||(thN[e]=[0,0]); t[0]+=n*d.sa*ga; t[1]+=n*(d.sf||0)*gf; } } }
  const aTh=T.F.sa+T.M.sa, fTh=T.F.nsf+T.M.nsf;
  let ef=aTh>0 ? fTh/aTh : 0, fHet=null;
  if(!fuelDissolved(c) && T.F.sa>0 && T.M.V>0 && T.F.nsf>0){
    const nRod=latVols(c,n).nF*(bored ? 1 : latBundle(c).nRod), a0=bored ? 50*latBoreM(c) : 50*rodDP(c), b0=Math.sqrt(vt*1e4/(Math.PI*nRod));
    const kap=g=>{ const sa=g.sa/g.V, D=g.V/(3*g.st); return Math.sqrt(sa/D); };
    fHet=cellUtil(a0,b0,kap(T.F),kap(T.M),T.F.sa/T.F.V,T.M.sa/T.M.V,T.F.V,T.M.V);
    ef=T.F.nsf/T.F.sa*fHet; }
  if(o.gd>0) ef*=aTh/(aTh+o.gd*vBarOf(Tn));
  const L=lawKOf(LAW_CHI,aT,fT,rT,aF,fF,rF,ni,nf,xs,ef), fuelSh=fHet ?? (aTh>0 ? T.F.sa/aTh : 0);
  /* each burning nuclide's absorptions and fissions per neutron born, region by region */
  const rate={}, hT=aT+rT>0 ? LAW_CHI/(aT+rT) : 0, hF=L.eF/(aF+rF), hE=ni>0 ? L.eF*L.pF*(1-L.pE)/ni : 0, hTh=T.F.sa>0 ? L.eF*L.pF*L.pE*fuelSh/T.F.sa : 0;
  for(const e of LAW_BURN){ const n=N[e]||0, d=NUC[e], t=nucT(e), ic= e==="U238" ? I28 : d.ric, th=thN[e]||[0,0];
    rate[e]={a:hT*n*(t.f+t.c)+hF*n*d.saF+hE*n*(ic+d.rif)+hTh*th[0], f:hT*n*t.f+hF*n*d.sfF+hE*n*d.rif+hTh*th[1]}; }
  return Object.assign(L, {ef, fHet, fHom:aTh>0 ? T.F.sa/aTh : 0, I28, sp, Tn, Tf, N, rate}); }
const LAW_BURN=["U235","U238","Pu239","FP"];
/* per initial heavy atom at burnup bu MWd/kgHM: U-235 and Pu-239 burn and U-238 breeds Pu-239 on the law's own rates, each
   fission leaving one pair of fission products (FP), marched at DEP_DB steps by the midpoint rule. Pu-239's captures and
   U-235's leave the book: what U-236 and Pu-240 up absorb is in FP's fitted cross section. */
const DEP_DB=1, DEPS=new WeakMap();
/* x moved h MWd/kgHM on the rates at z; fissions per heavy atom per MWd/kgHM at FIS_J a fission and 0.238 kg/mol */
function depMove(c,x,z,h){ const r=latLawCalc(c,{x:z}).rate; let F=0; for(const e of LAW_BURN) F+=r[e].f;
  const df=h*86400e6/FIS_J*0.238/N_AV, s=df/F;
  return {U235:x.U235-s*r.U235.a, U238:x.U238-s*r.U238.a, Pu239:x.Pu239+s*(r.U238.a-r.U238.f-r.Pu239.a), FP:x.FP+df}; }
const depMid=(c,x,h)=>depMove(c,x,depMove(c,x,x,h/2),h);
function latDeplete(c,bu){
  const key=lawKey(c); let m=DEPS.get(c);
  if(!m || m.key!==key){ const fd=heatCellOf(c,0,0).nd[HS_FUEL], hm=(fd.U235||0)+(fd.U238||0)+(fd.Pu239||0);
    m={key, x:[{U235:(fd.U235||0)/hm, U238:(fd.U238||0)/hm, Pu239:(fd.Pu239||0)/hm, FP:0}]}; DEPS.set(c,m); }
  const n=Math.floor(bu/DEP_DB+1e-9);
  while(m.x.length<=n) m.x.push(depMid(c,m.x[m.x.length-1],DEP_DB));
  const r=bu-n*DEP_DB; return r>1e-9 ? depMid(c,m.x[n],r) : m.x[n]; }
/* the four regions in series off their own rates per unit volume, chi of the source born in the first: over the threshold
   absorption aT, production fT and removal rT; fast absorption aF, production fF and slowing rF; epithermal absorption ni,
   production nf and moderation xs; thermal production per absorption ef. eF of the source reaches the fast region. */
function lawKOf(chi,aT,fT,rT,aF,fF,rF,ni,nf,xs,ef){
  const kT=aT+rT>0 ? fT/(aT+rT) : 0, pT=aT+rT>0 ? rT/(aT+rT) : 1, eF=chi*pT+1-chi;
  const kF=fF/(aF+rF), pF=rF/(aF+rF), pE=Math.exp(-ni/xs), kE=ni>0 ? (1-pE)*nf/ni : 0, k=chi*kT+eF*(kF+pF*(kE+pE*ef));
  return {k, kT, pT, eF, kF, pF, kE, pE, th:k>0 ? eF*pF*pE*ef/k : 0, fast:k>0 ? (chi*kT+eF*kF)/k : 0}; }
/* pcm per K of the pellet's own temperature about its rest: the law's resonance escape, its U-238 integral broadening as
   sqrt(T) */
const lawDopplerOf=(c,bu=0)=>{ const T=latLaw(c,{bu}).Tf; return 1e5*Math.log(latLaw(c,{Tf:T+10,bu}).k/latLaw(c,{Tf:T-10,bu}).k)/20; };
/* the coolant's own density at T on its circuit's curve, kg/m3 */
const LAW_SAT=new Map(), LAW_MX=new Float64Array(MX_N);
const coolRhoAt=(a,T)=>{ let s=LAW_SAT.get(a); if(!s){ s=satCurveFor(a,a.P0); LAW_SAT.set(a,s); }
  return mixState(s,a.P0,hOfTP(s,T,a.P0),LAW_MX)[MX_RHO]; };
/* B-10 atoms per barn-cm of coolant water at ppm of natural boron by mass */
const borN=(a,ppm)=>ppm*1e-6*coolRhoAt(a,Math.min(a.Tref, coolTsat(a, a.P0)))/1000*6.02214076e-1/AWT.B*B10_NAT;
/* the soluble boron that takes pcm (a negative figure) off the law's k-inf, ppm, by bisection to 1e-6 ppm */
function lawBoronPpm(c,pcm,bu=0){ if(!(pcm<0)) return 0;
  const a=COOLANT[c.cool], r0=rhoOfK(latLawCalc(c,{bu}).k), f=p=>rhoOfK(latLawCalc(c,{bor:borN(a,p),bu}).k)-r0-pcm;
  let lo=0, hi=1000; while(f(hi)>0 && hi<1e5) hi*=2;
  for(let i=0;i<60 && hi-lo>1e-6;i++){ const m=(lo+hi)/2; if(f(m)>0) lo=m; else hi=m; }
  return (lo+hi)/2; }
/* pcm per K of the coolant about T0 (its rest), below it where it is saturated: its density on its own curve, and the neutron
   temperature following it by its share of the moderation (the blocks carry theirs on their own temperature, modCoefOf()),
   at ppm of soluble boron */
function lawMtcOf(c,ppm=0,T0=Math.min(COOLANT[c.cool].Tref, coolTsat(COOLANT[c.cool], COOLANT[c.cool].P0)),bu=0){
  const a=COOLANT[c.cool], Tr=Math.min(a.Tref, coolTsat(a, a.P0)), sh=modShares(c).cool, r0=coolRhoAt(a,Tr), bor=borN(a,ppm), h=2;
  const k=dT=>latLawCalc(c,{al:1-coolRhoAt(a,T0+dT)/r0, Tn:Tr+sh*(T0+dT-Tr), bor, bu}).k;
  const up=T0<coolTsat(a, a.P0)-h ? h : 0;
  return 1e5*Math.log(k(up)/k(up-2*h))/(2*h); }
/* pcm per unit void, the slope at the rest point the tick's linear void term is: the lattice's k-inf with a tenth of its
   coolant, and of the soluble boron in it at ppm, voided, over that tenth */
function lawVoidOf(c,ppm=0,bu=0){ const bor=borN(COOLANT[c.cool],ppm);
  return 1e5*Math.log(latLawCalc(c,{al:0.1,bor,bu}).k/latLawCalc(c,{bor,bu}).k)/0.1; }
/* Wigner's rational self-shielding, a rod's absorption per unit flux: sig*V when thin, S/4 when black; x = sig*l */
const absEff=(S,x)=>S/4*x/(1+x);
/* The drawn bank fully in, as a reactivity. Thermal: the utilisation it takes, A over the cell's own absorption.
   Fast, one group at critical: A over the cell's nu*sig_f. Blended by the lattice's fast share. Per unit height
   over the drawn quarter, A in m against 100 x (sig 1/cm) x (V m2). */
function bankRho(c,fast){
  const bk=latBook(c,0), R=heatCellOf(c,0,1), b=R.book[HS_ABS], V=R.vol[HS_ABS];
  const S=latRodded(c)*absN(c)*Math.PI*absD(c), l=S>0 ? 400*V/S : 0, xTh=b.sa*l, xF=b.saF*l;
  const th= bk.saV>0 ? -absEff(S,xTh)/(100*bk.saV) : 0;
  const fa= bk.nsfFV>0 ? -absEff(S,xF)/(100*bk.nsfFV) : 0;
  return {th, fa, rho:(1-fast)*th+fast*fa, xTh, xF, S, V}; }
/* The (void x rod coverage) table the tick reads, and the rest-point shares the bench and the rating read.
   Per fission: the prompt gammas are born where fission is, the capture gammas where the captures are.
   nu - 1 neutrons are captured per fission, leakage left out; the drawn bank takes nu x its worth at the
   coverage (a black absorber takes the neutrons that reach it, which is its worth), the rest by the cell's
   thermal book. Void thins the coolant; coverage is how much of the drawn absorber is in the node. Gamma
   energy that leaves the CORE is booked to the structures whole: the reflector, vessel or shield round it
   stops it, so the chain's own absorption is 1 and is not priced. */
/* one point of that table, at void al and coverage cov, into o at b as shares of Q0 MeV of prompt heat per
   fission (Q0 0: its own); returns the point's own prompt MeV and its capture gamma and charged MeV */
function heatPointA(c,al,cov,Q0,o,b,K=gamKit(c)){
  const M=latM(c), G=GAM_NG, n=HS_N, bk=latBook(c,al), R=heatCellOf(c,al,cov), B=R.book;
  const Lc=100*M.dia*M.hgt/Math.max(M.hgt+M.dia/2,1e-9);
  const dF=new Float64Array(n), dC=new Float64Array(n), s=new Float64Array(n*G);
  /* energy deposited per region from source s, and the part that leaves the core on its first flight */
  const solve=(s,dep)=>{ let vt=0; for(let r=0;r<n;r++) vt+=R.vol[r];
    let esc=0; const s2=new Float64Array(n*G);
    for(let g=0;g<G;g++){ let sv=0; for(let r=0;r<n;r++) sv+=R.sig[r*G+g]*R.vol[r];
      const e= vt>0 ? 1/(1+sv/vt*Lc) : 0;
      for(let r=0;r<n;r++){ esc+=s[r*G+g]*e; s2[r*G+g]=s[r*G+g]*(1-e); } }
    gamDepose(c,K,R,al,cov,s2,dep); return esc; };
  const rA=Math.min(1, -bankRho(c,0).rho*cov), nCap=Math.max(0, bk.nu*(1-rA)-1), nAbs=bk.nu*rA;
  const eC=new Float64Array(n), eL=new Float64Array(n);
  for(let r=0;r<n;r++){ const k= r===HS_ABS ? nAbs : nCap*bk.cap[r]; eC[r]=k*B[r].ec; eL[r]=k*B[r].loc; }
  let EC=0, EL=0; for(let r=0;r<n;r++){ EC+=eC[r]; EL+=eL[r]; }
  const Q=FIS_EF+FIS_EN+FIS_EGP+EC+EL, q0=Q0>0 ? Q0 : Q;
  for(let r=0;r<n;r++) for(let g=0;g<G;g++) s[r*G+g]=bk.fis[r]*GAM_FISS[g];
  const escF=solve(s,dF);
  s.fill(0); for(let r=0;r<n;r++) for(let g=0;g<G;g++) s[r*G+g]= EC>0 ? eC[r]/EC*B[r].cap[g] : 0;
  const escC=solve(s,dC);
  const P=(r,e)=>(FIS_EGP*dF[r]+EC*dC[r]+eL[r]+e)/q0, D=(r,e)=>FIS_FGD*(dF[r]+e), fc=latCpsRodFrac(c);
  o[b]=P(HS_COOL,0); o[b+1]=P(HS_BLK,0); o[b+2]=P(HS_TUBE,FIS_EGP*escF+EC*escC); o[b+3]=(1-fc)*P(HS_ABS,0);
  o[b+4]=P(HS_CW,0)+P(HS_CT,0)+fc*P(HS_ABS,0);
  o[b+5]=D(HS_COOL,0); o[b+6]=D(HS_BLK,0); o[b+7]=D(HS_TUBE,escF); o[b+8]=(1-fc)*D(HS_ABS,0);
  o[b+9]=D(HS_CW,0)+D(HS_CT,0)+fc*D(HS_ABS,0);
  return {Q, EC, EL}; }
/* the share of the rodded slots that are control channels: the absorber's heat there goes to their water */
const latCpsRodFrac=c=>{ let n=0, k=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.rod[q]>=0){ n++; if(c.lat.slot[q]===L_CPS) k++; } return n ? k/n : 0; };
function heatSharesCalc(c){
  const v=latVols(c), a=COOLANT[c.cool], m=MODER[c.mod];
  const cc=v.cool*a.modK, mb=v.mod*m.modK, cx=v.chan*cpsRow().modK, tab=new Float64Array(HS_GRID*HS_GRID*HS_OUT);
  const K=gamKit(c), cap=heatPointA(c,0,0,0,tab,0,K), Q0=cap.Q, fn=FIS_EN/Q0;
  for(let i=0;i<HS_GRID;i++) for(let j=0;j<HS_GRID;j++)
    heatPointA(c,i/(HS_GRID-1),j/(HS_GRID-1),Q0,tab,(i*HS_GRID+j)*HS_OUT,K);
  const o=new Float64Array(HS_OUT);
  heatSplitA(tab,fn,cc,mb,cx,0,o,0);
  const q=1-PROMPT_F, at=r=>PROMPT_F*o[r*2]+q*o[r*2+1];
  const water0=at(0), block0=at(1), struct0=at(2), abs0=at(3), chan0=at(4);
  return {tab, cc, mb, cx, fn, Q0, cap, water0, block0, struct0, abs0, chan0, pin0:1-water0-block0-struct0-abs0-chan0};
}
/* coreFig() calls this every painted frame and it is 25 fixed points, so it is cached. A menu does not
   always revolve, so the key carries every figure heatSharesCalc() reads that latM()'s own rev does not. */
const HSS=new WeakMap(), HS_SCR=[];
function hsKey(o,c){ const a=COOLANT[c.cool];
  o.length=0;
  o.push(latM(c).rev, c.cool, c.mod, c.clad??0, c.lat.abs, absD(c), absN(c), absEnr(c), rodD(c), rodPOf(c),
         c.tube?tubeBoreMm(c):0, c.tube?tubeWallMm(a.P0,a,c):0);
  if(latVols(c).nC>0) o.push(cpsBoreMm(c), cpsWallMm(c), cpsWet(c)?1:0);
  for(let z=0;z<LAT_NZ;z++) o.push(zoneFuelOf(c,z));
  return o; }
function heatShares(c){ const k=hsKey(HS_SCR,c), h=HSS.get(c);
  if(h){ let same=h.k.length===k.length;
    for(let i=0;same&&i<k.length;i++) same=h.k[i]===k[i];
    if(same) return h.val; }
  const val=heatSharesCalc(c); HSS.set(c,{k:hsKey([],c),val}); return val; }
/* Uniform q''' in an annulus ri..ro cooled on one face, adiabatic on the other: o[0] the volume-mean and o[1]
   the peak rise over the cooled face, per unit q'''/k, m2. inner cools ri; ri 0 with inner false is the
   solid rod, R2/8 and R2/4. */
function blockRiseA(ri,ro,inner,o){
  const a2=ri*ri, b2=ro*ro, A=b2-a2;
  if(inner){ const L=Math.log(ro/ri);
    o[1]=(a2-b2+2*b2*L)/4;
    o[0]=(a2*A/2-(b2*b2-a2*a2)/4+2*b2*(b2*L/2-A/4))/(2*A); }
  else { const L= ri>0 ? Math.log(ro/ri) : 0;
    o[1]=(A-2*a2*L)/4;
    o[0]=(b2*A/2-(b2*b2-a2*a2)/4-2*a2*(A/4-a2*L/2))/(2*A); } }
/* Pure-gas k W/m/K as power laws through Incropera & DeWitt Table A.4 at 300 and 800 K, and their 300 K
   viscosities (as commonly quoted, not read at source); a mixture by Wassiljewa with Mason-Saxena's Phi */
const GAS_K={He:{k3:0.152,n:0.707,mu:199e-7,M:4.0026},N2:{k3:0.0259,n:0.764,mu:178.2e-7,M:28.013}};
const gasK=(g,T)=>g.k3*Math.pow(T/300,g.n);
const masonPhi=(i,j)=>Math.pow(1+Math.sqrt(i.mu/j.mu)*Math.pow(j.M/i.M,.25),2)/Math.sqrt(8*(1+i.M/j.M));
function gasMixK(xHe,T){ const a=GAS_K.He, b=GAS_K.N2, x=Math.max(0,Math.min(1,xHe)), y=1-x;
  return (x>0 ? x*gasK(a,T)/(x+y*masonPhi(a,b)) : 0)+(y>0 ? y*gasK(b,T)/(y+x*masonPhi(b,a)) : 0); }
/* emissivities of graphite and oxidised zirconium, and Zr-2.5Nb k W/m/K near 600 K, as commonly quoted, not read at source */
const SIGMA_SB=5.670374419e-8, EPS_GRAPH=0.8, EPS_ZR=0.8, K_ZRNB=20;
/* water k W/m/K near 50 C (IAPWS 2011, as commonly quoted, not read at source) */
const WATER_K=0.64;
/* The blocks' heat path, whole core. The fuel columns, two populations in parallel: blocks round a bore,
   cooled on the bore face through the gas gap, the tube wall and the film inside it; L_MOD slot blocks, a
   rod of their own area cooled on its faces against bare channels by the coolant's own film. q''' is uniform
   over the blocks, so one lumped temperature carries them as R = sum w^2 R_i by volume share w. The control
   channel columns are a lump of their own, cooled the same way by their channel water on Dittus-Boelter at
   the channel circuit's design flow down the bore (the rod's own displacement left out), and joined to the
   fuel columns sideways through the gap between columns (gas and radiation) over the faces the two kinds
   share, with half a column of conduction on each side. Rk 1/m (over k is K/W), Ri K/W, Rf K/W at the rated
   film; the gaps' gas and radiation are priced at the rest point, the block's k is live in the tick. A bored
   stack also conducts between neighbouring nodes (spread): the bores smeared by the graphite fraction phi,
   radially through a pitch of block and one column gap in series, axially through the blocks alone; rim and
   ends adiabatic. R and Z are per ring, m, before k; Rg the column gap, m2K/W. */
function graphCellOf(c){
  const v=latVols(c), a=COOLANT[c.cool], m=MODER[c.mod], L=c.lat, H=L.len, Q=LAT_QUAD, p=L.pitch;
  const io=new Float64Array(3), pops=[], bore=latBoreM(c), Ab=latBlockA(c), nMF=latModFaces(c);
  const qBlk=heatShares(c).block0*c.power*1e6, Tc=Math.min(a.Tref, coolTsat(a, a.P0)), Tw=CPS_T+CPS_DT/2;
  let Vm=v.nM*p*p;
  if(bore>0 && v.nF>0 && Ab>0){
    const t=tubeWallMm(a.P0,a,c)/1000, rt=bore/2+t, gap=tubeGapMm(c)/1000, ri=rt+gap, A=Ab+Vm/v.nF;
    const ro=Math.sqrt(A/Math.PI+ri*ri), nCh=v.nF*Q; blockRiseA(ri,ro,true,io);
    Vm=0;
    pops.push({V:A*nCh*H, mean:io[0], max:io[1], ri, ro, rt, gap, nCh, tube:true,
      Rf:1/(a.hFilm*Math.PI*bore*nCh*H), Rw:Math.log(rt/(bore/2))/(2*Math.PI*K_ZRNB*nCh*H)}); }
  if(Vm>0 && nMF>0){ const R=p/Math.sqrt(Math.PI); blockRiseA(0,R,false,io);
    pops.push({V:Vm*Q*H, mean:io[0], max:io[1], ri:0, ro:R, tube:false, Rf:1/(a.hFilm*nMF*p*Q*H), Rw:0}); }
  let V=0; for(const q of pops) V+=q.V;
  let ch=null, side=null;
  if(v.nC>0){ const b=cpsBoreMm(c)/1000, t=cpsWallMm(c)/1000, rt=b/2+t, gap=cpsGapMm(c)/1000, ri=rt+gap, nCh=v.nC*Q;
    const A=Math.max(0,p*p-Math.PI/4*(b+2*t)*(b+2*t)), ro=Math.sqrt(A/Math.PI+ri*ri); blockRiseA(ri,ro,true,io);
    const w=cpsWet(c) ? cpsFlowOf(c)/nCh : 0, mu=vogelMu(Tw), cp=waterFig(CPS_P,Tw,0).cp*1000;
    const Re=4*w/(Math.PI*b*mu), Pr=mu*cp/WATER_K, h=w>0 ? 0.023*Math.pow(Re,0.8)*Math.pow(Pr,0.4)*WATER_K/b : 0;
    ch={V:A*nCh*H, mean:io[0], max:io[1], ri, ro, rt, gap, nCh, Rw:Math.log(rt/(b/2))/(2*Math.PI*K_ZRNB*nCh*H),
      Rf:h>0 ? 1/(h*Math.PI*b*nCh*H) : Infinity, h, Re, w};
    const nS=latFaces(c,q=>latFuel(c,q)||L.slot[q]===L_MOD,q=>L.slot[q]===L_CPS)*Q;
    if(nS>0) side={A:nS*p*H, Rk:p/(nS*p*H), gap:colGapMm(c)/1000, Rg:0}; }
  const kOf=T=>{ io[0]=T; m.kA(io,0,2); return io[2]; };
  const gapR=(Tt,Tb,gap,xHe,A,eps)=>1/((gasMixK(xHe,(Tt+Tb)/2)/gap+SIGMA_SB*(Tt*Tt+Tb*Tb)*(Tt+Tb)/eps)*A);
  const eTube=1/EPS_ZR+1/EPS_GRAPH-1, eCol=2/EPS_GRAPH-1;
  const wC=ch ? ch.V/(V+ch.V) : 0, qF=qBlk*(1-wC), qC=qBlk*wC;
  let Rk=0, Ri=0, Rf=0, TF=Tc+300, TC=Tw+300, qS=0;
  for(const q of pops) q.Rg=0;
  if(ch) ch.Rg=0;
  for(let it=0;it<60;it++){
    Rk=0; Ri=0; Rf=0;
    for(const q of pops){ const w=q.V/V, qq=(qF-qS)*w;
      if(q.tube){ const Tt=Tc+qq*(q.Rf+q.Rw), Tb=Tt+qq*q.Rg; q.Rg=gapR(Tt,Tb,q.gap,tubeHeOf(c),2*Math.PI*(q.rt+q.gap/2)*q.nCh*H,eTube); }
      q.Ri=q.Rw+q.Rg;
      Rk+=w*w*q.mean/q.V; Ri+=w*w*q.Ri; Rf+=w*w*q.Rf; }
    if(!ch) break;
    const qq=qC+qS, Tt=Tw+(isFinite(ch.Rf) ? qq*(ch.Rf+ch.Rw) : 0), Tb=Tt+qq*ch.Rg;
    ch.Rg=gapR(Tt,Tb,ch.gap,tubeHeOf(c),2*Math.PI*(ch.rt+ch.gap/2)*ch.nCh*H,eTube); ch.Ri=ch.Rw+ch.Rg; ch.Rk=ch.mean/ch.V;
    if(side) side.Rg=gapR(TF,TC,side.gap,COL_HE,side.A,eCol);
    const gF=V>0 ? 1/(Rk/kOf(TF)+Ri+Rf) : 0, gC=1/(ch.Rk/kOf(TC)+ch.Ri+ch.Rf), gS=side ? 1/(side.Rk/kOf((TF+TC)/2)+side.Rg) : 0;
    const a11=gF+gS, a22=gC+gS, det=a11*a22-gS*gS, b1=qF+gF*Tc, b2=qC+gC*Tw; if(!(det>0)) break;
    TF=(b1*a22+gS*b2)/det; TC=(a11*b2+gS*b1)/det; qS=gS*(TF-TC); }
  let spread=null;
  if(bore>0 && V>0){ const R=latM(c).dia/2, dr=R/XNR, dz=H/XNZ, phi=v.mod/((v.nF+v.nM+v.nC)*p*p), SR=new Float64Array(XNR), SZ=new Float64Array(XNR);
    let Ts=TF; if(!ch) for(let it=0;it<30;it++) Ts=Tc+qF*(Rk/kOf(Ts)+Ri+Rf);
    for(let i=0;i<XNR;i++){ const r0=i*dr, r1=r0+dr; if(i<XNR-1) SR[i]=phi*2*Math.PI*r1*dz/dr; SZ[i]=phi*Math.PI*(r1*r1-r0*r0)/dz; }
    spread={phi, R:SR, Z:SZ, p, Rg:gapR(Ts,Ts,colGapMm(c)/1000,COL_HE,1,eCol), T:Ts}; }
  return {V, kg:V*m.dens*1000, Rk, Ri, Rf, pops, qBlk, Tc, ch:ch && Object.assign(ch,{kg:ch.V*m.dens*1000}), side, spread, TF, TC, qS}; }
/* The blocks' own temperature coefficient, pcm/K, off the thermal book. The neutron temperature follows the
   blocks by their share of the moderation; the fissile nuclides' absorption and fission go as Westcott g(T),
   every other absorber as 1/v. Spectral: d ln(eta f)/dT = d ln Sf - d ln Sa_F + (1 - f) d ln Sa_F on the
   non-1/v parts. Leakage: L2 = D/Sa over the cell, D off free-atom transport, B2 the drawn core's bare
   cylinder, d ln P/dT = -L2B2/(1 + L2B2) d ln L2/dT with d ln L2 = 1/2T - f d ln Sa_F; D stays constant with
   T, as Lloyd, Clayton & Richey measured for graphite (22-600 C). Expansion, on the blocks' own temperature:
   their atoms go as (1 + aT)^-3, so d ln L2 gains 3a times their shares of Str and Sa, and the pile they build
   grows, d ln B2 = -2a times their volume fraction. Times the thermal chain weight. The coolant's own share
   is returned beside it and wired nowhere. */
function lnL2dT(T,f,dA){ return 1/(2*T)-f*dA; }
const WG_IO=new Float64Array(2);
function modCoefOf(c,bu=0){
  const bk=latBook(c,0,bu), sh=modShares(c), mth=thermShareOf(c,bu), M=latM(c), a=COOLANT[c.cool];
  const RC=bk.R, v=latVols(c), al=MODER[c.mod].alpha||0, VB=RC.vol[HS_BLK], BB=RC.book[HS_BLK];
  let vt=0; for(let r=0;r<HS_N;r++) if(r!==HS_ABS) vt+=RC.vol[r];
  const wtr=bk.str>0 ? VB*BB.str/(bk.str*vt) : 0, wa=bk.sa>0 ? VB*BB.sa/(bk.sa*vt) : 0;
  const vfB=(v.nF+v.nM)>0 ? v.mod/((v.nF+v.nM)*c.lat.pitch*c.lat.pitch) : 0;
  const Tn=Math.min(a.Tref, coolTsat(a, a.P0));
  let dA=0, dF=0, wf=0;
  for(const k in bk.sfis){ const w=bk.sfis[k]/Math.max(bk.hm,1e-300), d=NUC[k], u=w*d.sf/d.sa;
    westcottA(k,"ga",Tn,WG_IO); dA+=w*WG_IO[1]/WG_IO[0];
    westcottA(k,"gf",Tn,WG_IO); dF+=u*WG_IO[1]/WG_IO[0]; wf+=u; }
  if(wf>0) dF/=wf;
  const f=bk.f, eta=dF-dA, util=(1-f)*dA, spec=eta+util;
  const D=bk.str>0 ? 1/(3*bk.str) : 0, L2=bk.sa>0 ? D/bk.sa : 0;
  const R=Math.max(M.dia/2,1e-6)*100, Hc=Math.max(M.hgt,1e-6)*100, B2=Math.pow(2.405/R,2)+Math.pow(Math.PI/Hc,2), x=L2*B2;
  const leak=-x/(1+x)*lnL2dT(Tn,f,dA), grow=-x/(1+x)*(3*al*(wtr+wa)-2*al*vfB);
  const k=mth*1e5;
  return {aG:k*(sh.block*(spec+leak)+grow), cool:k*sh.cool*(spec+leak), eta:k*sh.block*eta, util:k*sh.block*util, leak:k*sh.block*leak,
    grow:k*grow, f, L2, B2, D, Tn, share:sh.block, mth, wtr, wa, vfB}; }

/* The reference pitch, solved against VOLUME so a stock lattice lands on the stock reactor: V = 8n*sqrt(4n/pi)*hd*p^3. */
const LAT_P0=(function(){
  let n=0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(Math.hypot(u+.5,v+.5)<=LAT_R0) n++;
  return Math.cbrt((LAT_MW0/LAT_DENS0)/(8*n*Math.sqrt(4*n/Math.PI)*LAT_HD0));
})();

/* Neither this nor latLayBanks() revolves; the caller does, once, when it has finished changing things. */
function latLayFuel(c,r0,poig){
  const L=c.lat;
  L.slot.fill(L_EMPTY); L.rod.fill(-1); L.zone.fill(0); c.zoneFuel={};
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(Math.hypot(u+.5,v+.5)<=r0) L.slot[LIX(u,v)]=L_FUEL;
  /* A RAMP, not a disc - ring weight goes as the radius - and a fixed dither, so the stock lattice lays the same every time. */
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    if(!L.slot[LIX(u,v)]) continue;
    const f=poig*(1-Math.hypot(u+.5,v+.5)/r0);
    if(((u*3+v*5)%7)/7 < f) L.slot[LIX(u,v)]=L_POIS;
  }
}
/* Spread by AREA onto RINGS: by radius the outer bank lands on the lowest-flux ring and a split lean goes net-negative in worth. */
function latLayBanks(c,nb){
  const L=c.lat;
  for(let q=0;q<LQ*LQ;q++) L.rod[q]=-1;
  const rEqSlots=latEqR(c)/L.pitch;
  for(let b=0;b<nb;b++){
    const ring=Math.round(Math.sqrt((b+.5)/nb)*(XNR-1));
    const rr=(ring+0.5)/XNR*rEqSlots;
    for(const th of [Math.PI/9, Math.PI*7/18]){
      let u=clamp(Math.round(rr*Math.cos(th)-.5),0,LQ-1);
      let v=clamp(Math.round(rr*Math.sin(th)-.5),0,LQ-1);
      for(let g=0;g<LQ && !latRodOK(c,LIX(u,v));g++){ u=Math.max(0,u-1); v=Math.max(0,v-1); }
      if(latRodOK(c,LIX(u,v))) L.rod[LIX(u,v)]=b;
    }
  }
}

function latDefault(c){
  const L=c.lat;
  L.pitch=LAT_P0;
  latLayFuel(c,LAT_R0,LAT_POIG);
  latLayBanks(c,4);
  L.len=2*latEqR(c)*LAT_HD0;
  [L.reflR,L.reflT,L.reflB]=LAT_REFL0;
  L.abs=0;
  latRevolve(c);
}
/* Rewrites the drawing, not the shopping: materials, family and fuel stay where they were left. */
const LATPRE=[
  ["STOCK",{r:LAT_R0,pk:1.00,hd:LAT_HD0,poi:LAT_POIG,refl:LAT_REFL0,nb:4},
   "The reference core, and what the bench boots with: a full disc of fuel at the reference pitch, poison graded toward the centre, four banks on rings 5, 8, 10 and 12. About 1200 MWt in a 2.5 m core. Start here and edit."],
  ["COMPACT",{r:7.2,pk:0.90,hd:1.40,poi:0.80,refl:[12.1,47.5,47.5],nb:4},
   "A small, tall, tightly pitched core: about 545 MWt in 1.7 m, some 140 tonnes lighter than stock, and half again the grace time, because there is less power in each litre of it. A narrow core leaks harder, and the doubled reflector is what pays for that. You get mass back to spend elsewhere and you give up half your power to do it."],
  ["FLAT",{r:9.6,pk:1.10,hd:0.70,poi:1.60,refl:[19.5,38.2,38.2],nb:4},
   "A wide, squat core: full diameter, seven tenths of that in height, opened-out pitch and heavy central poison. Peaking falls and DNBR rises, so it takes more overpower before the hot channel is the thing that stops you. It weighs about what stock does, and the looser lattice weakens the moderator feedback that makes the plant follow load by itself."],
];
function latPreset(c,i){
  const q=LATPRE[i][1], L=c.lat;
  L.pitch=q.pk*LAT_P0;
  latLayFuel(c,q.r,q.poi);
  latLayMod(c,q.every||0);
  latLayBanks(c,q.nb);
  L.len=2*latEqR(c)*q.hd;
  [L.reflR,L.reflT,L.reflB]=q.refl;
  latRevolve(c);
}
/* `every` is one slot in N: 0 lays none, 2 a checkerboard. Runs AFTER latLayFuel(), so the blocks displace fuel. */
function latLayMod(c,every){
  if(!every) return;
  const L=c.lat;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const q=LIX(u,v);
    if(!L.slot[q]) continue;
    if((u+v)%every===0){ L.slot[q]=L_MOD; L.rod[q]=-1; }
  }
}
/* Buys everything on the panel as well as redrawing. */
const ARCHPRE=[
 ["PWR",{fuel:1,rmat:1,abs:1,scram:1,foll:0,cool:0,mod:0,pk:1.00,r:LAT_R0,hd:1.00,poi:LAT_POIG,refl:LAT_REFL0,nb:4,every:0},
  "A tight water lattice at 15.5 MPa, no solid moderator: the water between the assemblies is the moderator, so voiding it takes the moderation away and the core shuts itself down. The reference plant, and what every figure in this game was calibrated against."],
 ["BWR",{fuel:0,rmat:1,abs:2,scram:1,foll:0,cool:1,mod:0,pk:0.92,r:LAT_R0,hd:1.05,poi:LAT_POIG,refl:[8.2,24.0,24.0],nb:4,every:0},
  "The same water at 7 MPa in an opened-out lattice, so there is more water per assembly and the void coefficient is markedly more negative. It boils in the core by design: power follows flow, and margin to dryout is thin."],
 /* A rectangular stack, so r spans the whole plan rather than a disc inside it. The cell is the RBMK-1000's own
    (INSAG-7 annex I): a 250 mm graphite block with an 88 mm pressure tube bored through it, 18 fuel rods at
    13.6 mm inside, 7 m active height. rodP is the drawing figure that packs 18 rods into a channel. */
 ["RBMK",{fuel:7,rmat:3,abs:0,scram:3,foll:1,cool:2,mod:0,pk:0.25/LAT_P0,r:13.5,hd:1.2407,poi:LAT_POIG,refl:[20.1,70.0,70.0],nb:4,every:0,
          tube:{bore:80},rodD:0.0136,rodP:LAT_P0/Math.sqrt(18),rodSpd:0.4/7,cps:true},
  "Every cell is a graphite block with a pressure tube bored through it, and water only inside the tube. The graphite does the moderating, so the water is a net ABSORBER - and boiling it off ADDS reactivity. This is the Chernobyl core, and nothing in the code says so: it falls out of what is drawn. A wide flat pile on a quarter-metre pitch, and it runs itself up if you let the channels void."],
 /* BN-600's 6.9 mm steel-clad pin (IAEA-TECDOC-1569 Table 3); rodP scaled with it so the drawn fuel and sodium shares stay the lattice's */
 ["SFR",{fuel:2,rmat:1,abs:0,scram:0,foll:2,cool:3,mod:0,pk:0.78,r:8.4,hd:1.10,poi:LAT_POIG,refl:[6.0,18.6,18.6],nb:4,every:0,clad:2,rodD:0.0069,rodP:ROD_P0*0.0069/ROD_D0},
  "Sodium in a tight lattice and no moderator anywhere: a FAST core. Enormous power density and boiling margin, a prompt lifetime forty times shorter, and low-enriched fuel will not hold it critical - a fast spectrum needs the enrichment."],
 ["MSR",{fuel:6,rmat:3,abs:0,scram:0,foll:0,cool:4,mod:0,pk:1.05,r:9.0,hd:1.00,poi:LAT_POIG,refl:[8.8,24.7,24.7],nb:4,every:4},
  "Molten salt through a graphite matrix. The salt moderates a little and the graphite does the rest, so the spectrum is thermal and the blocks own most of the moderation. Voiding the salt reads mildly NEGATIVE: the little moderation the salt does is worth more than the absorption it takes with it. No pressure anywhere and almost no xenon pit."],
 ["HTGR",{fuel:0,rmat:3,abs:0,scram:0,foll:1,cool:5,mod:0,pk:1.10,r:LAT_R0,hd:1.15,poi:LAT_POIG,refl:[9.7,31.4,31.4],nb:4,every:2},
  "Helium through a graphite matrix. The gas moderates NOTHING, so every neutron this core thermalises is thermalised by the blocks - and voiding it is worth nothing either way. Six kilowatts a litre, and it cannot melt."],
 /* Calder Hall (Nuclear Engineering, Dec. 1956): 9.45 m x 6.40 m, 1696 channels, 1.30 in Magnox can, helical fin 0.125 in pitch to 2.125 in (area ratio off that geometry, fin efficiency 1); rodP is a drawing figure that packs 1696 bars into the fuel slots, not the 8 in channel pitch */
 ["MAGNOX",{fuel:5,rmat:3,abs:0,scram:0,foll:0,cool:6,mod:0,pk:3.6,r:10,hd:0.679,poi:0,refl:[67.3,128.0,128.0],nb:4,every:2,clad:1,rodD:0.03302,rodP:0.04008,fin:9.88},
  "Natural uranium metal bars in finned magnesium cans, CO2 gas at 0.8 MPa, and a huge graphite pile to do the moderating. Nothing is enriched, so the core has to be enormous to go critical at all - nine and a half metres across for 182 MWt."],
];
function archPreset(c,i){
  const q=ARCHPRE[i][1], L=c.lat;
  c.cool=q.cool; c.mod=q.mod; c.fuel=q.fuel; c.refl=q.rmat;
  c.scram=q.scram; c.foll=q.foll; L.abs=q.abs;
  // a pressure-tube core is a knob bag on the reactor; absent = a vessel
  if(q.tube) Object.assign(c.tube=c.tube||{}, q.tube); else delete c.tube;
  if(q.rodSpd) c.rodSpd=q.rodSpd; else delete c.rodSpd;
  for(const k of ["clad","rodD","rodP","fin"]) if(q[k]!=null) c[k]=q[k]; else delete c[k];
  L.pitch=q.pk*LAT_P0;
  latLayFuel(c,q.r,q.poi);
  latLayMod(c,q.every);
  latLayBanks(c,q.nb);
  // a cps row seats its banks in cooled control channels of their own
  if(q.cps){ for(let s=0;s<LQ*LQ;s++) if(L.rod[s]>=0) L.slot[s]=L_CPS; c.cps=c.cps||{}; } else delete c.cps;
  L.len=2*latEqR(c)*q.hd;
  [L.reflR,L.reflT,L.reflB]=q.refl;
  latRevolve(c);
}

const latCount=c=>{               // FUEL assemblies in the WHOLE core, not the quarter
  let n=0; for(let q=0;q<LQ*LQ;q++) if(latFuel(c,q)) n++;
  return 4*n;
};
const latZonesUsed=c=>{
  const seen=[];
  for(let z=0;z<LAT_NZ;z++)
    for(let q=0;q<LQ*LQ;q++) if(latFuel(c,q)&&c.lat.zone[q]===z){ seen.push(z); break; }
  return seen.length? seen : [0];
};
const latCpsCount=c=>{ let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.slot[q]===L_CPS) n++; return 4*n; };
const latModCount=c=>{
  let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.slot[q]===L_MOD) n++;
  return 4*n;
};

/* Samples per assembly side. A patch straddling a ring boundary books entirely to one side, so the revolve loses volume as this falls. */
const LAT_SS=16;
const latZeroZones=()=>{ const a=[]; for(let z=0;z<LAT_NZ;z++) a.push(new Float64Array(XNR)); return a; };

/* Blended by fuel VOLUME, except tdmg/tmelt which are MINIMA: failure is local, so one ring cannot hide behind four. */
const FUEL_BLEND=["burnK","rho","k","kint","alpha","mass","hm","bu"];
const FUEL_MIN=["tdmg","tmelt"];
/* each FUEL row's share of the core's fuel volume */
function fuelVolW(c){
  const zt=latM(c).zTot, w=new Float64Array(FUEL.length); let tot=0;
  for(let z=0;z<LAT_NZ;z++) tot+=zt[z];
  if(!(tot>1e-9)){ w[zoneFuelOf(c,0)]=1; return w; }
  for(let z=0;z<LAT_NZ;z++) w[zoneFuelOf(c,z)]+=zt[z]/tot;
  return w;
}
function fuelBlend(c){
  const w=fuelVolW(c), f0=FUEL[zoneFuelOf(c,0)];
  const o={name:f0.name,note:f0.note};
  for(const k of FUEL_BLEND){ let a=0; for(let f=0;f<w.length;f++) if(w[f]>0) a+=w[f]*FUEL[f][k]; o[k]=a; }
  for(const k of FUEL_MIN){ o[k]=Infinity; for(let f=0;f<w.length;f++) if(w[f]>0) o[k]=Math.min(o[k],FUEL[f][k]); }
  return o;
}
/* each FUEL row's share of the core's fissions: its fuel volume times its own fission density in one flux, on the
   thermal and fast books in the lattice's own shares */
function fuelFisW(c){
  const w=fuelVolW(c), fast=fastShareOf(c), o=new Float64Array(FUEL.length); let t=0;
  const enrW=fuelEnrW(c);
  for(let i=0;i<w.length;i++) if(w[i]>0){ const F=FUEL[i], b=bookOf(numDensAdd(F.comp,F.rho,enrW[i],F.pu||0,1,{}));
    o[i]=w[i]*((1-fast)*b.sf+fast*b.sfF); t+=o[i]; }
  if(!(t>0)) return w;
  for(let i=0;i<o.length;i++) o[i]/=t;
  return o; }
/* the core's delayed neutrons: beta pcm and six groups off the fission-weighted fuels, each group keeping its summed
   yield and its summed mean life beta_i/lambda_i */
function dngBlend(c,bu=0){
  const w=fuelFisW(c), a=new Float64Array(6), d=new Float64Array(6); let beta=0;
  const add=(B,g)=>{ beta+=B; for(let k=0;k<6;k++){ a[k]+=B*g.bet[k]; d[k]+=B*g.bet[k]/g.lam[k]; } };
  for(let i=0;i<w.length;i++) if(w[i]>0) add(w[i]*FUEL[i].beta,dngOf(FUEL[i]));
  /* burnt, each nuclide's change of fission share carries its own delayed neutrons; U-238's on U-235's groups */
  if(bu>0){ const s0=lawFisShares(latLaw(c).rate), s1=lawFisShares(latLaw(c,{bu}).rate);
    for(const e in BETA_NUC) add((s1[e]-s0[e])*BETA_NUC[e],DNG[e==="Pu239" ? "PU239" : "U235"]); }
  return {beta, bet:Array.from(a,x=>x/beta), lam:Array.from(a,(x,k)=>x/d[k])}; }
const lawFisShares=r=>{ let F=0; for(const e of LAW_BURN) F+=r[e].f; const o={}; for(const e of LAW_BURN) o[e]=F>0 ? r[e].f/F : 0; return o; };
const rhoOfK=k=>1e5*(1-1/k);
/* each FUEL row's law on its own reference drawing: the published kInf is taken there. The drawing's own rating reads
   the law unscaled while it is being built. */
/* the state a row's published k-inf was taken at: its fuel at rest, at the coolant's own temperature ("cool", zero
   power) or at a stated K; a stated neutron temperature and coolant density where the source was cold */
function lawRefState(c,ref){ const a=COOLANT[c.cool], o={};
  if(ref.Tf==="cool") o.Tf=Math.min(a.Tref, coolTsat(a, a.P0)); else if(ref.Tf) o.Tf=ref.Tf;
  if(ref.Tn) o.Tn=ref.Tn;
  if(ref.rho) o.al=1-ref.rho/(isWater(a) ? waterFig(a.P0,a.Tref,0).rho : coolFig(a).rho);
  return o; }
const LAW_REF=new Map(); let LAW_REF_BUSY=false;
function lawRef(fi){ let r=LAW_REF.get(fi); if(r) return r;
  const F=FUEL[fi], c=Object.assign({zoneFuel:{},lat:latNew()},CORE_DEFAULT); LAW_REF_BUSY=true;
  try{ archPreset(c,F.ref.arch); c.fuel=fi; latRevolve(c);
    const L=latLaw(c, lawRefState(c,F.ref));
    r={k:L.k, th:L.th, fast:L.fast}; }
  finally{ LAW_REF_BUSY=false; }
  LAW_REF.set(fi,r); return r; }
/* the lattice's hot, fresh, unpoisoned k-inf: its own law, scaled by each fuel's published kInf over the law on that
   fuel's reference drawing, fuel volume weighted */
function kInfOf(c,o){ return latLaw(c,o).k*kScaleOf(fuelVolW(c)); }
function kScaleOf(w){ if(LAW_REF_BUSY) return 1;
  let s=0; for(let i=0;i<w.length;i++) if(w[i]>0) s+=w[i]*FUEL[i].kInf/lawRef(i).k;
  return s; }
/* the lattice's k-inf over its fuels' published ones, what a burnup slope taken on the reference lattice scales by */
function modKOf(c){ const w=fuelVolW(c); let s=0; for(let i=0;i<w.length;i++) if(w[i]>0) s+=w[i]*FUEL[i].kInf;
  return kInfOf(c)/s; }
/* the share of fission neutrons born in the fast regions, above the resonances; and born in the thermal group */
const fastShareOf=(c,bu=0)=>latLaw(c,{bu}).fast;
const thermShareOf=(c,bu=0)=>latLaw(c,{bu}).th;
/* pcm of hot, unpoisoned rho-inf burnt to b MWd/kgHM: the fuel's published curve where it has one (burnK), else the law's own
   depletion (latDeplete()) */
const latRhoInf=(c,b)=>{ const f=fuelBlend(c);
  return f.burnK>0 || !(b>0) ? rhoOfK(kInfOf(c))-f.burnK*b*modKOf(c) : rhoOfK(kInfOf(c,{bu:b})); };
/* each ring's slots over the drawn quarter, in slots: fuel (nP of it poisoned), blocks, control channels, and the empty rest */
const latRingNew=()=>({nF:new Float64Array(XNR),nM:new Float64Array(XNR),nC:new Float64Array(XNR),nP:new Float64Array(XNR),nE:new Float64Array(XNR)});
/* ring i as counts for the law. A ring is narrower than a slot, so its own blocks and channels alias the drawn pattern: its
   occupied slots take the core's own shares of fuel, blocks and channels. Its zone mix is its own, its empty part the core's
   own moderator, the blocks where the drawing has any and the coolant where it has none. */
function ringCnt(c,i){ const M=latM(c), R=M.ring, v=latCounts(c), t=v.nF+v.nM+v.nC, blk=latVols(c).mod>0;
  const o=t>0 ? (R.nF[i]+R.nM[i]+R.nC[i])/t : 0;
  let w=new Float64Array(FUEL.length);
  if(R.nF[i]>0) for(let z=0;z<LAT_NZ;z++) w[zoneFuelOf(c,z)]+=M.zfrac[z][i]; else w=fuelVolW(c);
  return {nF:o*v.nF, nM:o*v.nM+(blk ? R.nE[i] : 0), nC:o*v.nC, nW:blk ? 0 : R.nE[i], w}; }
/* per-node axial excess off axial fuel zones (plan-reactor-ui 8.3): infinite-medium k-inf worth per level,
   no tick state. Same fuel reads exactly zero. A level's k-inf runs on its own fuel over the drawn lattice,
   sharing the revolve (no re-rate); cached on the drawing. */
const AXKINF=new Map();
function axKInf(c,fj){ const key=latSig(c)+"|"+fj; let k=AXKINF.get(key);
  if(k===undefined){ const t=Object.assign({},c,{fuel:fj,zoneFuel:{},zoneEnr:{}});
    LMS.set(t,latM(c)); k=kInfOf(t);
    if(AXKINF.size>64) AXKINF.clear(); AXKINF.set(key,k); }
  return k; }
function buildAxRho(c){ const o=new Float64Array(XNN), base=c.fuel;
  let any=false; for(let j=0;j<XNZ;j++){ const fj=(c.axFuel&&c.axFuel[j]!=null)?c.axFuel[j]:base; if(fj!==base) any=true; }
  if(!any) return o;
  const k0=axKInf(c,base);
  for(let j=0;j<XNZ;j++){ const fj=(c.axFuel&&c.axFuel[j]!=null)?c.axFuel[j]:base;
    const e=fj===base?0:1e5*(axKInf(c,fj)-k0);
    for(let i=0;i<XNR;i++) o[i*XNZ+j]=e; }
  return o; }
/* pcm: each ring's k-inf off the law on its own composition over the core's, 1e5 (k_ring - k_core); a ring with no fuel has k-inf 0 */
function ringRhoOf(c){ const o=new Float64Array(XNR), k0=kInfOf(c), Tf=lawTf(c);
  for(let i=0;i<XNR;i++){ const n=ringCnt(c,i); o[i]=1e5*(latLawCalc(c,{cnt:n,Tf}).k*kScaleOf(n.w)-k0); }
  return o; }
/* The burnable poison a poisoned fuel slot carries: VERA problem 2O (CASL-U-2012-0131-004, Tables 15 and P2-2, Figure 8, read
   24/09/26), 12 of a 17x17's 264 rods at 5 wt% Gd2O3 in a 10.111 g/cc pellet; those rods' own 1.8 % uranium is not carried. Gd
   157.25 g/mol (IUPAC, as commonly quoted); 2200 m/s absorption 49700 b, of it Gd-155 (14.8 %, 61100 b) and Gd-157 (15.7 %,
   259000 b), whose captures leave isotopes that absorb almost nothing (NIST neutron scattering lengths table, read 24/09/26). */
const GD_ROD={share:12/264, wt:0.05, rho:10111, sa:49700, odd:0.148+0.157, M:157.25};
/* Gd atoms per barn-cm in the pellet */
const gdN=()=>GD_ROD.rho/1000*GD_ROD.wt*(2*GD_ROD.M/(2*GD_ROD.M+3*AWT.O))/GD_ROD.M*0.602214076;
/* a black surface takes the current n v/4, v the mean speed of a Maxwellian at Tn: this, (2/sqrt(pi)) sqrt(Tn/T0), of 2200 m/s */
const vBarOf=Tn=>2/Math.sqrt(Math.PI)*Math.sqrt(Tn/293.6);
/* thermal absorption per unit homogeneous flux of nPin Gd pellets burnt to radius r m, in the law's units (m2 x 1/cm): Wigner's
   rational self-shielding, the pellet's chord 2r */
const gdAbs=(nPin,r)=> r>0 ? absEff(nPin*2*Math.PI*r, gdN()*GD_ROD.sa*200*r)/100 : 0;
/* m: a black pellet burns from its surface in, an isotropic flux phi taking phi/4 a unit area, so the strong isotopes' front
   moves in at phi/(4 n), phi the current's flux (vBarOf()); the fluence to burnup bu is the core's thermal flux at bu/2 over the time
   bu takes */
function gdRadius(c,bu){ const r0=rodDP(c)/2; if(!(bu>0)) return r0;
  const a=COOLANT[c.cool], n=gdN()*GD_ROD.odd*1e24, F=thPhiOf(c,bu/2)*fuelSecs(c,bu)*vBarOf(Math.min(a.Tref, coolTsat(a, a.P0)));
  return Math.max(0, r0-F/(4*n)/100); }
/* pcm each ring's poisoned slots take off its k-inf at burnup bu, and their volume mean */
const POI=new WeakMap();
function poisonAt(c,bu){ const key=lawKey(c)+"|"+bu, h=POI.get(c); if(h && h.key===key) return h.val;
  const M=latM(c), R=M.ring, o=new Float64Array(XNR), r=gdRadius(c,bu), r0=rodDP(c)/2, nb=latBundle(c).nRod, Tf=lawTf(c); let m=0;
  if(!fuelDissolved(c)) for(let i=0;i<XNR;i++){ if(!(R.nP[i]>0)) continue;
    const n=ringCnt(c,i), q=R.nP[i]/R.nF[i]*GD_ROD.share, a=gdAbs(q*n.nF*nb,r), gdf=q*(r/r0)*(r/r0);
    o[i]=1e5*kScaleOf(n.w)*(latLawCalc(c,{cnt:n,Tf}).k-latLawCalc(c,{cnt:n,gd:a,gdf,Tf}).k); m+=o[i]*ringW[i]; }
  const val={poi:o, mean:m}; POI.set(c,{key,val}); return val; }
/* pcm every rodded bore's follower is worth over what it displaces, the whole core's k-inf off the law: a control channel's bore
   (its water if piped, else nothing), a fuel slot's absorber rodlets' own bores in its coolant */
function folRhoOf(c){ const f=FOLL[c.foll].mat, L=c.lat; if(!f) return 0;
  let nC=0, nF=0; for(let q=0;q<LQ*LQ;q++) if(L.rod[q]>=0){ if(L.slot[q]===L_CPS) nC++; else nF++; }
  const b=cpsBoreMm(c)/1000, nd=numDensAdd(f.comp||atomsOfW(f.compW),f.dens*1000,0,0,1,{}), fol=[];
  if(nC) fol.push([HS_CW,nC*Math.PI/4*b*b,nd,100*b]);
  if(nF) fol.push([HS_COOL,nF*absN(c)*Math.PI/4*absD(c)*absD(c),nd,100*absD(c)]);
  return 1e5*kScaleOf(fuelVolW(c))*(latLawCalc(c,{fol}).k-latLawCalc(c,{}).k); }
/* the ring terms r0 burnt to b on each ring's own fuel slope */
const ringRho=(r0,M,b)=>{ const o=new Float64Array(XNR); for(let i=0;i<XNR;i++) o[i]=r0[i]-M.enrBurn[i]*b; return o; };

/* rodN[i][b] a bank's cluster area in ring i: every bank drawn keeps its own, however outnumbered. bankN[b][i] per
   bank in drawn order, bankR its cluster-weighted mean ring, chan the rings holding any cluster. No cluster at all: one
   bank on the mid ring. */
function latBanks(rodN){
  const bk=[], chan=[];
  for(let i=0;i<rodN.length;i++){ let any=false;
    for(const b in rodN[i]){ (bk[b]=bk[b]||new Float64Array(XNR))[i]+=rodN[i][b]; any=true; }
    if(any) chan.push(i); }
  const bankN=bk.filter(Boolean);
  if(!bankN.length){ const n=new Float64Array(XNR); n[(XNR>>1)-1]=n[XNR>>1]=1; bankN.push(n); }
  const bankR=bankN.map(n=>{ let s=0,w=0; for(let i=0;i<XNR;i++){ s+=i*n[i]; w+=n[i]; } return s/w; });
  return {chan,bankN,bankR}; }
/* `skipMeasure` rebuilds the geometry only: a bench pen drag defers the rating solve to the worker on release */
function latRevolve(c,skipMeasure){
  const L=c.lat, p=L.pitch, rEq=latEqR(c), oldM=LMS.get(c);
  latRev++;
  let M;
  if(rEq<=0 || p<=0){
    const nb=latBanks([]);
    M={dr:.1,dz:.1,frac:new Float64Array(XNR),occ:new Float64Array(XNR),
        ring:latRingNew(),chan:nb.chan,bankN:nb.bankN,bankR:nb.bankR,NB:1,
        zfrac:latZeroZones(),zTot:new Float64Array(LAT_NZ),
        dia:0,hgt:0,vol:0,nAsm:0,laid:0,rev:latRev};
    // an empty core still has to be MEASURED: the rating is set nowhere else
    LMS.set(c,M);
    if(!skipMeasure) latMeasure(c);
    else M.enrBurn = (oldM && oldM.enrBurn) || new Float64Array(XNR);
    return M;
  }
  const dr=rEq/XNR, patch=(p/LAT_SS)*(p/LAT_SS);
  const fuelA=new Float64Array(XNR), poisA=new Float64Array(XNR), modA=new Float64Array(XNR), cpsA=new Float64Array(XNR);
  const zoneA=latZeroZones();
  const rodN=[]; for(let i=0;i<XNR;i++) rodN.push({});
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const s=L.slot[LIX(u,v)]; if(!s) continue;
    const rod=L.rod[LIX(u,v)], zn=Math.min(LAT_NZ-1,L.zone[LIX(u,v)]);
    for(let a=0;a<LAT_SS;a++) for(let b=0;b<LAT_SS;b++){
      const r=Math.hypot((u+(a+.5)/LAT_SS)*p,(v+(b+.5)/LAT_SS)*p);
      const i=Math.min(XNR-1,Math.floor(r/dr));
      if(s===L_MOD||s===L_CPS){ (s===L_MOD ? modA : cpsA)[i]+=patch; if(rod>=0) rodN[i][rod]=(rodN[i][rod]||0)+1; continue; }
      fuelA[i]+=patch;
      zoneA[zn][i]+=patch;
      if(s===L_POIS) poisA[i]+=patch;
      if(rod>=0) rodN[i][rod]=(rodN[i][rod]||0)+1;
    }
  }
  const frac=new Float64Array(XNR), occ=new Float64Array(XNR);
  const ring=latRingNew(), a2=p*p;
  let vol=0;
  for(let i=0;i<XNR;i++){
    const rA=Math.PI*((i+1)*(i+1)-i*i)*dr*dr;
    frac[i]=clamp(4*fuelA[i]/rA,0,1);
    occ[i]=clamp(4*(fuelA[i]+modA[i]+cpsA[i])/rA,0,1);
    ring.nF[i]=fuelA[i]/a2; ring.nM[i]=modA[i]/a2; ring.nC[i]=cpsA[i]/a2; ring.nP[i]=poisA[i]/a2;
    ring.nE[i]=Math.max(0,rA/4-fuelA[i]-modA[i]-cpsA[i])/a2;
    vol+=rA*L.len*frac[i];
  }
  const zfrac=latZeroZones(), zTot=new Float64Array(LAT_NZ);
  for(let z=0;z<LAT_NZ;z++) for(let i=0;i<XNR;i++){
    zfrac[z][i]= fuelA[i]>1e-9? zoneA[z][i]/fuelA[i] : 0;
    zTot[z]+=zoneA[z][i];
  }
  const {chan,bankN,bankR}=latBanks(rodN);

  let laid=0;
  for(let q=0;q<LQ*LQ;q++) if(latFuel(c,q)) laid++;
  M={dr, dz:L.len/XNZ, frac, occ, ring, chan, bankN, bankR, NB:bankR.length, zfrac, zTot,
      dia:2*rEq, hgt:L.len, vol, nAsm:4*laid, laid:4*laid*p*p*L.len, rev:latRev};
  LMS.set(c,M);
  if(!skipMeasure) latMeasure(c);
  else M.enrBurn = (oldM && oldM.enrBurn) || new Float64Array(XNR);
  return M;
}

/* each ceiling over its own design margin: the melt limit over the licensed peak linear heat, the bought surface flux over W-3's design limit, qpp being a W-3-style figure whatever the core's own crisis law */
function latQLim(c){
  const f=fuelBlend(c), a=COOLANT[c.cool];
  const melt=fuelDissolved(c) ? Infinity : 4*Math.PI*f.kint, dnb=a.qpp*Math.PI*rodD(c)*finOf(c)*1000;
  const qm=melt/MELT_M, qd=dnb/DNB_LIM.w3;
  return {melt,dnb,q:Math.min(qm,qd),
          bind:qm<qd?"MELT":"DNB", clear:Math.max(qm,qd)/Math.max(Math.min(qm,qd),1e-9)};
}
function latRating(c){
  const M=latM(c);
  const Fq=Math.max(corePredict(c,{rf:REFL[c.refl]}).Fq,1e-6);
  const nRods=M.nAsm*latBundle(c).nRod;
  return latQLim(c).q*nRods*c.lat.len/Fq/1000/heatShares(c).pin0;
}

// gap W/m2/K (Todreas & Kazimi, Nuclear Systems I, ch. 8)
const H_GAP=5700;
const latFuelKg=c=>fuelDissolved(c) ? 0 : latVols(c).fuel*LAT_QUAD*c.lat.len*fuelBlend(c).rho;
const latRods=c=>latM(c).nAsm*latBundle(c).nRod;
// UO2 conductivity, Fink J. Nucl. Mater. 279 (2000) eq. 20 at 95 % TD, W/m/K
const kUO2=T=>{ const t=T/1000;
  return 100/(7.5408+17.692*t+3.6142*t*t)+6400/Math.pow(t,2.5)*Math.exp(-16.35/t); };
/* The flat conductivity that reproduces int k dT over a uniformly heated pellet: Theta(T) - Theta(Ts) =
   q'(1 - r2/R2)/(4 pi), so the volume mean is the mean of T over that argument. A row stating its own
   phase law is not UO2 and keeps its flat k; the metals' conductivity is flat enough for it. */
function fuelKEff(f,Ts,qp){
  if(f.ph||!(qp>0)) return f.k;
  const A=qp/(4*Math.PI), N=64; let T=Ts, mean=0;
  for(let i=0;i<N;i++){ const Tm=T+A/kUO2(T)*(0.5/N); mean+=Tm/N; T+=A/kUO2(Tm)/N; }
  return A/2/Math.max(mean-Ts,1e-9);
}
// K.m/W per metre of rod; solid is the pellet's volume mean plus the clad wall, gap the all-helium gap at H_GAP
function pinRes(c){
  const R=rodDP(c)/2, Ro=rodD(c)/2;
  const gap=1/(2*Math.PI*R*H_GAP), film=1/(2*Math.PI*Ro*COOLANT[c.cool].hFilm*finOf(c));
  if(fuelDissolved(c)) return {solid:0, gap:0, film};
  const L=latRods(c)*c.lat.len, qp=L>0? heatShares(c).pin0*c.power*1e6/L : 0;
  // the wall's conductivity at its own outer face
  const wall=Math.log(Ro/R)/(2*Math.PI*cladK(c,COOLANT[c.cool].Tref+qp*film));
  const Ts=COOLANT[c.cool].Tref+qp*(gap+wall+film), w=fuelVolW(c);
  let k=0; for(let f=0;f<w.length;f++) if(w[f]>0) k+=w[f]*fuelKEff(FUEL[f],Ts,qp);
  return {solid:1/(8*Math.PI*Math.max(k,1e-9))+wall, gap, film};
}
// K, flat mean pellet over its water at rated power, the film at `film` times its rated conductance
function pinDTf(c,film=1){
  const L=latRods(c)*c.lat.len; if(!(L>0) || fuelDissolved(c)) return 0;
  const r=pinRes(c);
  return heatShares(c).pin0*c.power*1e6/L*(r.solid+r.gap+r.film/film);
}
/* as commonly quoted, not read at source: Ross-Stoute 1.5 (2.0 + 0.5 um) roughness, 0.30 Xe+Kr per fission (0.85 Xe), 200 MeV per fission */
const GAP_ROUGH=1.5*(2.0e-6+0.5e-6), FG_YIELD=0.30, FG_XE=0.85, FIS_J=200e6*1.602176634e-19;
const N_AV=6.02214076e23, ROD_T_FILL=300;
const coreBurnupOf=c=>c.burnup ?? corePredict(c,{rf:REFL[c.refl]}).bu;
// mol of stable fission gas per m3 of pellet at b MWd/kgHM
const fgInvOf=(c,b)=>{ const f=fuelBlend(c); return b*86400e6/FIS_J*f.rho*f.hm*FG_YIELD/N_AV; };
/* noble, volatile, refractory, carried as Xe-133, I-131, Ba-140 at equilibrium: yield, half-life d, kg/mol, gamma MeV; NUREG-1465 fractions; all as commonly quoted, not read at source */
const FP_N=3, FP_NG=0, FP_VO=1, FP_RF=2;
const FP_Y=[0.0670,0.0289,0.0621], FP_HALF_D=[5.243,8.0252,12.7527], FP_M=[0.1329,0.1309,0.1399], FP_EG=[0.045,0.38,0.18];
const FP_GAP=[0.05,0.05,0], FP_INV_PWR=[0.95,0.35,0.02], FP_INV_BWR=[0.95,0.25,0.02], FP_PC=1e4;
const fpLam=s=>Math.LN2/(FP_HALF_D[s]*86400);
// kg of group s a core at MW holds: yield x fission rate over the decay constant
const fpInvKg=(MW,s)=>FP_Y[s]*MW*1e6/FIS_J/fpLam(s)*FP_M[s]/N_AV;
// its gamma power per kg, W
const fpGammaW=s=>fpLam(s)*N_AV/FP_M[s]*FP_EG[s]*1.602176634e-13;
// mol of fill helium per m3 of pellet
const fgFillOf=c=>cladOf(c).pFill*1e6*cladOf(c).vFree/(R_GAS*ROD_T_FILL);

function latMeasure(c){
  const M=latM(c), L=c.lat;
  c.pitch=L.pitch/LAT_P0;
  const fb=fuelBlend(c);
  c.hd=M.dia>1e-6? M.hgt/M.dia : 1;
  c.nbank=M.NB;
  /* each ring's burn slope over the core's */
  const ek=new Float64Array(XNR);
  for(let i=0;i<XNR;i++){
    let k=0,w=0;
    for(let z=0;z<LAT_NZ;z++){ k+=M.zfrac[z][i]*FUEL[zoneFuelOf(c,z)].burnK; w+=M.zfrac[z][i]; }
    if(w>1e-9) ek[i]=k/w-fb.burnK;
  }
  M.enrBurn=ek;
  /* LAST: the rating solves on the flux, and the solve reads the grading this function has just written. The rating's
     flux sets the xenon, the xenon the mid-cycle burnup and that the peaking, so it is iterated to its own fixed point, by
     secant on the rating's own miss: the map contracts, but slowly on a big core */
  let p0=c.power, f0=latRating(c)-p0;
  c.power=p0+f0;
  for(let i=0;i<20 && Math.abs(f0)>1e-7*c.power;i++){ const p1=c.power, f1=latRating(c)-p1, d=f1-f0;
    c.power= Math.abs(f1)<=1e-7*p1 || !(Math.abs(d)>0) ? p1+f1 : p1-f1*(p1-p0)/d;
    p0=p1; f0=f1; }
  c.poison=corePredict(c,{rf:REFL[c.refl]}).poison;
}

/* t of moderator blocks: the drawn quadrant four times over the core's height */
const latModT=c=>latVols(c).mod*LAT_QUAD*c.lat.len*MODER[c.mod].dens;
/* Fuel mass is NOT here: derived() gets it from the volume. */
function latMass(c){
  const M=latM(c), L=c.lat;
  const rf=REFL[c.refl], R=M.dia/2, tR=L.reflR/100, tZ=(L.reflT+L.reflB)/100;
  let m=Math.PI*((R+tR)*(R+tR)-R*R)*L.len*rf.dens;
  m+=Math.PI*(R+tR)*(R+tR)*tZ*rf.dens;
  m+=latAbsA(c)*LAT_QUAD*L.len*ABSORB[L.abs].dens;
  m+=latModT(c);
  { const v=latVols(c); m+=(v.chanTube*ZR_RHO+v.chan*cpsRho())/1000*LAT_QUAD*L.len; }
  return m;
}

/* [SEV, sentence, role]; coreWarns() retags the role with a vessel id. */
function latWarn(c){
  const w=[], M=latM(c), L=c.lat;
  let n=0, nf=0;
  for(let q=0;q<LQ*LQ;q++){ if(L.slot[q]) n++; if(latFuel(c,q)) nf++; }
  if(!nf){ w.push(["RED","There is no fuel in this core at all.","core"]); return w; }
  /* The walk crosses MODERATOR slots - a block between two assemblies couples them; only an empty gap splits a core. */
  const seen=new Uint8Array(LQ*LQ), q=[];
  for(let i=0;i<LQ*LQ&&!q.length;i++) if(L.slot[i]){ q.push(i); seen[i]=1; }
  let head=0, reach=1;
  while(head<q.length){
    const k=q[head++], u=(k/LQ)|0, v=k%LQ;
    for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
      const a=u+d[0], b=v+d[1];
      if(a<0||a>=LQ||b<0||b>=LQ) continue;
      const j=LIX(a,b);
      if(seen[j]||!L.slot[j]) continue;
      seen[j]=1; reach++; q.push(j);
    }
  }
  if(reach<n) w.push(["RED","There are "+((n-reach)*4)+" slots that nothing else in the core touches. A core split by a water gap is two reactors with one set of rods between them.","core"]);
  if(!M.chan.length) w.push(["RED","No rod clusters at all. Nothing can control this core, shut it down, or hold it down once it is.","rods"]);
  if(latVols(c).nC>0 && !cpsWet(c)) w.push(["SOFT","Control channels are drawn but nothing is piped to the rod drives. The channels stand empty: no water to cool them, and their graphite sheds its heat only sideways into the fuel columns.","rods"]);
  if(M.NB<2) w.push(["SOFT","Only one rod bank. Tilt trim needs at least two, so there is nothing to lean against a flux tilt with.","rods"]);
  if(c.power<400||c.power>2400) w.push(["SOFT","This lattice rates "+c.power.toFixed(0)+" MWt, outside the 400 to 2400 MWt the hull was drawn for.","core"]);
  { const gap=(rodPOf(c)-rodD(c))*1000;
    if(gap<2) w.push(["RED","Pin diameter "+(rodD(c)*1000).toFixed(1)+" mm leaves only "+gap.toFixed(1)+" mm between pins on a "+(rodPOf(c)*1000).toFixed(1)+" mm rod pitch. Under 2 mm nothing can be assembled there - no grid, no channel, no water.","core"]); }
  if(c.hd<.5||c.hd>2.5) w.push(["SOFT","H/D of "+c.hd.toFixed(2)+" is outside the 0.5 to 2.5 the vessel forge can make.","core"]);
  if(c.pitch<.6||c.pitch>1.8) w.push(["SOFT","Assembly pitch "+(L.pitch*100).toFixed(1)+" cm is outside what the fuel vendor will assemble.","core"]);
  const bare=[[L.reflR,"rim"],[L.reflT,"lid"],[L.reflB,"floor"]].filter(z=>!(z[0]>0));
  if(bare.length) w.push(["SOFT","Bare "+bare.map(z=>z[1]).join(" and ")+
    ". Neutrons that leave that face are gone. A single ring of reflector is worth most of what a reflector has to give.","core"]);
  return w;
}

/* One core's whole design as a string; designSig() joins one per vessel. */
const latSig=c=>{ const L=c.lat;
  return L.slot.join("")+"|"+L.rod.join("")+"|"+L.zone.join("")+"|"+
  [L.pitch,L.len,L.reflR,L.reflT,L.reflB,L.abs].join(",")+"|"+
  CORE_KEYS.map(k=>k==="zoneFuel"?JSON.stringify(c.zoneFuel):(k==="zoneEnr"||k==="bankLen"||k==="axFuel")?JSON.stringify(c[k]||{}):c[k]).join(",")+"|"+JSON.stringify(c.cps||null); };

/* Minted with its vessel (mintMachine(), layout.js) and removed with it. */
function coreMint(from){
  if(from) return coreClone(from);
  const c=Object.assign({zoneFuel:{},zoneEnr:{},bankLen:{},axFuel:{},lat:latNew()},CORE_DEFAULT); latDefault(c); return c; }
function coreClone(src){
  const L=src.lat, c=Object.assign({},src,{zoneFuel:Object.assign({},src.zoneFuel),zoneEnr:Object.assign({},src.zoneEnr),
    bankLen:Object.assign({},src.bankLen),axFuel:Object.assign({},src.axFuel),
    lat:Object.assign({},L,{slot:new Uint8Array(L.slot),rod:new Int8Array(L.rod),zone:new Uint8Array(L.zone)})});
  if(src.tube) c.tube=Object.assign({},src.tube);
  if(src.cps) c.cps=Object.assign({},src.cps);
  latRevolve(c); return c; }
/* The stand-in for a ship with no vessel: a blank grid still has to answer every design question. */
let CORE_NONE=null;
const coreNone=()=>{ if(CORE_NONE) return CORE_NONE;
  // published before latDefault(): the lay asks the plant, and the plant asks this
  CORE_NONE=Object.assign({zoneFuel:{},zoneEnr:{},bankLen:{},axFuel:{},lat:latNew()},CORE_DEFAULT); latDefault(CORE_NONE);
  return CORE_NONE; };
