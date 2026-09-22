"use strict";
/* Loads AFTER core2d.js: it sizes its arrays from XNR/XNZ, and core2d only needs the lattice at call time. */

const LQ=10;                     // quarter-plan slots per side
const LAT_QUAD=4;                // the drawn quarter repeats four times round the axis
/* L_MOD is core material but NOT fuel, so a count meaning "there is fuel here" asks latFuel(), never a non-zero slot. */
const L_EMPTY=0, L_FUEL=1, L_POIS=2, L_MOD=3;
const LIX=(u,v)=>u*LQ+v;
const latFuel=(c,q)=>c.lat.slot[q]===L_FUEL||c.lat.slot[q]===L_POIS;

// the design point "pitch 1.0x" is defined against, and nothing else
const LAT_MW0=1200, LAT_HD0=1.0;
const LAT_DENS0=100;             // kW/L, sizes the reference pitch only
const LAT_R0=9.6;                // stock fuel radius in slots, reaching both axes of the quarter
// pcm a ring that is not full of fuel loses; the one fitted number this file adds
const LAT_NF=22000;
const LAT_REFLMAX=3;             // reflector past this buys nothing
const LAT_POIPIN=1200;           // a fully poisoned ring, pcm
const LAT_POIG=0.90;             // how hard the stock lattice grades poison from centreline to rim

/* dens t/m3; comp (or compW) the absorber alone, the rodlet's own stainless clad left out */
const ABSORB=[
  {name:"BORON CARBIDE",k:1.00,dens:2.5,comp:{B:4,C:1},
   note:"The baseline, and what the control bank used to be calibrated against. Cheap, light, and it swells and cracks as it burns, so a long campaign costs you worth you cannot see going."},
  {name:"SILVER-INDIUM-CADMIUM",k:0.62,dens:10.2,compW:{Ag:.80,In:.15,Cd:.05},
   note:"Weaker per cluster and four times as dense, but it does not swell, so it is the one that still moves at the end of a campaign. Buy it and you need more clusters, or clusters nearer the flux."},
  {name:"HAFNIUM",k:1.34,dens:13.3,comp:{Hf:1},
   note:"A third more worth per cluster, and it takes decades of irradiation without complaint. Heavy - and margin bought from fewer, stronger clusters is margin concentrated in fewer things that can jam."},
];

/* A slot's zone is an index, never an enrichment: the fuel row it means is menued, one row per zone. */
const LAT_NZ=3;
const latNew=()=>({
  slot:new Uint8Array(LQ*LQ),
  rod:new Int8Array(LQ*LQ),      // -1 none, else bank 0..3
  zone:new Uint8Array(LQ*LQ),    // loading zone 0..LAT_NZ-1, 0 everywhere by default
  pitch:0, len:0,
  reflR:1, reflT:1, reflB:1,
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
// rodded slots in the drawn quarter
const latRodded=c=>{ let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.rod[q]>=0) n++; return n; };
// m2 per unit core height over the drawn quarter, the bank fully in
const latAbsA=c=>latRodded(c)*absN(c)*Math.PI/4*absD(c)*absD(c);
// zircaloy: density kg/m3, Pilling-Bedworth ratio, reaction enthalpy J/kg Zr, kg H2 per kg Zr (Zr + 2 H2O -> ZrO2 + 2 H2), pcm per unit clad-over-fuel volume
const ZR_RHO=6560, ZR_PBR=1.56, ZR_QOX=6.45e6, ZR_H2=2*2.01588/91.224, ZR_ABS=1000;
/* rho kg/m3, comp (Zircaloy on Zr, Magnox on Mg with its 0.8 % Al left out), k W/m/K, thick m of can wall, tfail K the can is lost at (null = the Zircaloy burst law), zr 1 = the Zr-steam reaction applies, abs pcm per unit can-over-fuel volume */
const CLAD=[
 /* alpha: diametral 6.721e-6 per K, alpha phase to 1073 K (NUREG/CR-7024 eq. 3.5-9, FRAPCON-3.4/FRAPTRAN-1.4) */
 {name:"ZIRCALOY",rho:ZR_RHO,comp:{Zr:1},k:16,thick:0.00057,tfail:null,zr:1,abs:ZR_ABS,alpha:6.721e-6,
  note:"Zirconium alloy: nearly transparent to neutrons and strong when hot, but above about 1100 K it burns in steam and makes hydrogen."},
 /* Magnox AL80 (Mg 0.8 Al): rho pure Mg 1738; k on a line between pure Mg 156 and as-cast Mg-1.5Al 100 (review of Mg thermal conductivity, J. Magnes. Alloys 8, 2020); Calder Hall's 0.072 in wall (Nuclear Engineering, Dec. 1956); melts at ~650 C (Frost); abs ZR_ABS times Mg/Zr macroscopic absorption 2.54/7.65 (INL 2004, Table 4) */
 /* alpha: pure Mg near 26e-6 per K, as commonly quoted, not read at source */
 {name:"MAGNOX AL80",rho:1738,comp:{Mg:1},k:126,thick:0.0018288,tfail:923,zr:0,abs:ZR_ABS*2.54/7.65,alpha:26e-6,
  note:"Magnesium with a little aluminium: absorbs almost no neutrons and does not react with uranium or CO2, but it is weak and it melts at 650 C, so the fuel inside must stay cool."},
];
const cladOf=c=>CLAD[c.clad??0];
const fuelDissolved=c=>!!COOLANT[c.cool].fuelInCoolant;
const cladZrKg=(c,aHeat)=>cladOf(c).zr && !fuelDissolved(c) ? ZR_RHO*aHeat*cladOf(c).thick : 0;
const rodDP=c=>rodD(c)-2*cladOf(c).thick;
const latFuelFrac=c=>Math.PI/4*(rodDP(c)/rodPOf(c))*(rodDP(c)/rodPOf(c));
const latRodFrac =c=>Math.PI/4*(rodD(c) /rodPOf(c))*(rodD(c) /rodPOf(c));
// clad per unit fuel: the can is a parasitic absorber
const modClad=c=>{ const f=latFuelFrac(c); return f>1e-12 ? (latRodFrac(c)-f)/f : 0; };
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
function latVols(c){
  let nF=0,nM=0;
  for(let q=0;q<LQ*LQ;q++){ const s=c.lat.slot[q]; if(s===L_MOD) nM++; else if(s) nF++; }
  const cell=c.lat.pitch*c.lat.pitch, p0=LAT_P0*LAT_P0;
  return {nF,nM,fuel:nF*latFuelFrac(c)*p0,
          cool:nF*Math.max(0,latChanA(c)-latRodFrac(c)*p0),
          mod:nM*cell+nF*latBlockA(c)};
}
const modRatio=(c,voided)=>{ const v=latVols(c); if(v.fuel<=0) return 0;
  return ((voided?0:v.cool*COOLANT[c.cool].modK)+v.mod*MODER[c.mod].modK)/v.fuel; };
const modShares=c=>{ const v=latVols(c);
  const cc=v.cool*COOLANT[c.cool].modK, m=v.mod*MODER[c.mod].modK, t=cc+m;
  return t>1e-12? {cool:cc/t,block:m/t} : {cool:0,block:0}; };
const modCoolShare=c=>modShares(c).cool;
const HS_FUEL=0, HS_CLAD=1, HS_COOL=2, HS_BLK=3, HS_TUBE=4, HS_ABS=5, HS_N=6;
/* the (void x rod coverage) grid the engine interpolates: the four GAMMA (and capture) shares of prompt
   heat, then of decay heat. The neutrons' own share is a ratio of moderation weights that steps where the
   last of the water goes, and a grid would ramp that step over a whole interval. */
const HS_GRID=5, HS_OUT=8, HS_GW=0, HS_GB=1, HS_GS=2, HS_GA=3;
/* Zr-Nb pressure tube on pure Zr, as tubeMass() weighs it */
const TUBE_MAT={comp:{Zr:1}};
/* atoms per barn-cm of each nuclide of a material at rho kg/m3, times k, added into o; U splits into U-235
   and U-238 by enr (weight) and gives pu of its atoms to Pu-239 */
const N_AV_BCM=6.02214076e23*1e-30;
function numDensAdd(comp,rho,enr,pu,k,o){ let m=0; for(const e in comp) m+=comp[e]*AWT[e];
  const n=k*rho/(m/1000)*N_AV_BCM;
  for(const e in comp){ const x=comp[e]*n;
    if(e==="U"){ const a5=(enr/235.044)/(enr/235.044+(1-enr)/238.051);
      o.U235=(o.U235||0)+x*(1-pu)*a5; o.U238=(o.U238||0)+x*(1-pu)*(1-a5); o.Pu239=(o.Pu239||0)+x*pu; }
    else o[e]=(o[e]||0)+x; }
  return o; }
/* the fuel's own enrichment, blended by fuel volume: the uranium anywhere in the core is the fuel's */
function fuelIsoOf(c){ const w=fuelVolW(c); let e=0, p=0;
  for(let i=0;i<w.length;i++) if(w[i]>0){ e+=w[i]*FUEL[i].enr; p+=w[i]*(FUEL[i].pu||0); }
  return {enr:e, pu:p}; }
const NUC_HEAVY=["U235","U238","Pu239"];
/* One material's thermal book at 2200 m/s: sa, sf, nsf 1/cm; shm the heavy metal's absorption, sfis[nuc]
   each fissile nuclide's own; str the transport cross section (free atom, mu-bar 2/3A); ec, loc MeV per
   capture, the capture-weighted gamma and charged-particle energies; cap[g] its capture photons by group,
   per MeV of capture energy. */
function bookOf(nd){
  const o={sa:0,sf:0,nsf:0,shm:0,str:0,ec:0,loc:0,sfis:{},cap:new Float64Array(GAM_NG)};
  let sc=0;
  for(const e in nd){ const N=nd[e], d=NUC[e]; if(!(N>0)) continue;
    const sa=N*d.sa, sf=N*(d.sf||0), c=sa-sf, A=AWT[e]||(e==="U235"?235.044:e==="U238"?238.051:239.052);
    o.sa+=sa; o.sf+=sf; o.nsf+=sf*(d.nu||0); o.str+=N*d.ss*(1-2/(3*A));
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
for(const e of ["H","Li","Li7","B","C"]) NUC[e].line=true;
/* one lattice cell per unit core height over the drawn quarter, the coolant at void al and the drawn
   absorber at coverage cov: each region's volume m2, its surface against every other region m, the book of
   what it is made of, and per group its sig 1/cm and mu_en/mu. The outer boundary faces another identical
   cell, so it is no one's surface. A region the drawing does not have has no volume and no surface. */
function heatCellOf(c,al=0,cov=1){
  const v=latVols(c), a=COOLANT[c.cool], m=MODER[c.mod], cl=cladOf(c), L=c.lat, w=fuelVolW(c), iso=fuelIsoOf(c);
  const G=GAM_NG, n=HS_N, vol=new Float64Array(n), area=new Float64Array(n*n), rho=new Float64Array(n), mat=[], nd=[];
  const touch=(r,s,A)=>{ if(A>0){ area[r*n+s]+=A; area[s*n+r]+=A; } };
  const nRod=v.nF*latBundle(c).nRod, p=L.pitch;
  const fd={}; let fr=0;
  for(let i=0;i<w.length;i++) if(w[i]>0){ const F=FUEL[i]; fr+=w[i]*F.rho; numDensAdd(F.comp,F.rho,F.enr,F.pu||0,w[i],fd); }
  vol[HS_FUEL]=v.fuel; rho[HS_FUEL]=fr; mat[HS_FUEL]=FUEL[zoneFuelOf(c,0)]; nd[HS_FUEL]=fd;
  vol[HS_CLAD]=v.nF*(latRodFrac(c)-latFuelFrac(c))*LAT_P0*LAT_P0; rho[HS_CLAD]=cl.rho; mat[HS_CLAD]=cl;
  vol[HS_COOL]=v.cool; rho[HS_COOL]=(isWater(a) ? waterFig(a.P0,a.Tref,0).rho : coolFig(a).rho)*(1-al); mat[HS_COOL]=a;
  vol[HS_BLK]=v.mod; rho[HS_BLK]=m.dens*1000; mat[HS_BLK]=m;
  touch(HS_FUEL,HS_CLAD,nRod*Math.PI*rodDP(c));
  touch(HS_CLAD,HS_COOL,nRod*Math.PI*rodD(c));
  if(c.tube){ const b=tubeBoreMm(c)/1000, t=tubeWallMm(a.P0,a,c)/1000;
    vol[HS_TUBE]=v.nF*Math.PI*(b+t)*t; rho[HS_TUBE]=ZR_RHO; mat[HS_TUBE]=TUBE_MAT;
    touch(HS_COOL,HS_TUBE,v.nF*Math.PI*b); touch(HS_TUBE,HS_BLK,v.nF*Math.PI*(b+2*t)); }
  else touch(HS_COOL,HS_BLK,latModFaces(c)*p);
  const ab=ABSORB[L.abs];
  vol[HS_ABS]=latAbsA(c)*cov; rho[HS_ABS]=ab.dens*1000; mat[HS_ABS]=ab;
  touch(HS_ABS,HS_COOL,latRodded(c)*absN(c)*Math.PI*absD(c)*cov);
  const sig=new Float64Array(n*G), f=new Float64Array(n*G), chord=new Float64Array(n), share=new Float64Array(n*n), book=[];
  for(let r=0;r<n;r++){
    if(!nd[r]) nd[r]= mat[r] ? numDensAdd(mat[r].comp||atomsOfW(mat[r].compW),rho[r],iso.enr,iso.pu,1,{}) : {};
    book[r]=bookOf(nd[r]);
    if(!(vol[r]>0)){ vol[r]=0; continue; }
    const gm=gamOf(mat[r]);
    for(let g=0;g<G;g++){ sig[r*G+g]=rho[r]/1000*gm.mu[g]; f[r*G+g]=gm.mu[g]>0 ? gm.en[g]/gm.mu[g] : 1; }
    let S=0; for(let s=0;s<n;s++) if(s!==r && vol[s]>0) S+=area[r*n+s];
    chord[r]= S>0 ? 400*vol[r]/S : Infinity;
    for(let s=0;s<n;s++) if(s!==r && vol[s]>0 && S>0) share[r*n+s]=area[r*n+s]/S; }
  return {n,vol,area,sig,f,chord,share,book,nd,rho}; }
/* weight fractions back to atom counts per unit mass, for a row that states compW */
const atomsOfW=w=>{ const o={}; for(const e in w) o[e]=w[e]/AWT[e]; return o; };
/* faces an L_MOD slot shares with a fuel slot that has no bore of its own, over the drawn quarter; a face
   across a symmetry axis meets its own mirror */
function latModFaces(c){ const L=c.lat; let n=0;
  if(latBoreM(c)>0) return 0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){ if(L.slot[LIX(u,v)]!==L_MOD) continue;
    for(const [du,dv] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=u+du, y=v+dv;
      if(x<0||y<0||x>=LQ||y>=LQ) continue;
      if(latFuel(c,LIX(x,y))) n++; } }
  return n; }
/* the thermal-neutron book of the whole cell at void al, rest bank out: region volumes times their own
   cross sections. f the thermal utilisation (heavy metal over everything but the control absorber), nu
   the fissile mix's own, fis[r] each region's share of fission, cap[r] of non-fission absorption. */
function latBook(c,al=0){
  const R=heatCellOf(c,al,0), B=R.book, n=R.n;
  let sa=0, hm=0, sf=0, nsf=0, sc=0, str=0, vt=0;
  const fis=new Float64Array(n), cap=new Float64Array(n), sfis={};
  for(let r=0;r<n;r++){ if(r===HS_ABS || !(R.vol[r]>0)) continue; const V=R.vol[r], b=B[r];
    sa+=V*b.sa; hm+=V*b.shm; sf+=V*b.sf; nsf+=V*b.nsf; str+=V*b.str; vt+=V;
    fis[r]=V*b.sf; cap[r]=V*(b.sa-b.sf); sc+=cap[r];
    for(const k in b.sfis) sfis[k]=(sfis[k]||0)+V*b.sfis[k]; }
  for(let r=0;r<n;r++){ fis[r]= sf>0 ? fis[r]/sf : 0; cap[r]= sc>0 ? cap[r]/sc : 0; }
  return {R, f:sa>0?hm/sa:0, nu:sf>0?nsf/sf:0, sa:vt>0?sa/vt:0, str:vt>0?str/vt:0, hm, sfis, fis, cap}; }
/* The (void x rod coverage) table the tick reads, and the rest-point shares the bench and the rating read.
   Per fission: the prompt gammas are born where fission is, the capture gammas where the captures are.
   nu - 1 neutrons are captured per fission, leakage left out; the drawn bank takes nu x its worth at the
   coverage (a black absorber takes the neutrons that reach it, which is its worth), the rest by the cell's
   thermal book. Void thins the coolant; coverage is how much of the drawn absorber is in the node. Gamma
   energy that leaves the CORE is booked to the structures whole: the reflector, vessel or shield round it
   stops it, so the chain's own absorption is 1 and is not priced. */
/* one point of that table, at void al and coverage cov, into o at b as shares of Q0 MeV of prompt heat per
   fission (Q0 0: its own); returns the point's own prompt MeV and its capture gamma and charged MeV */
function heatPointA(c,al,cov,Q0,o,b){
  const M=latM(c), G=GAM_NG, n=HS_N, bk=latBook(c,al), R=heatCellOf(c,al,cov), B=R.book;
  const Lc=100*M.dia*M.hgt/Math.max(M.hgt+M.dia/2,1e-9);
  const dF=new Float64Array(n), dC=new Float64Array(n), s=new Float64Array(n*G);
  /* energy deposited per region from source s, and the part that leaves the core on its first flight */
  const solve=(s,dep)=>{ let vt=0; for(let r=0;r<n;r++) vt+=R.vol[r];
    let esc=0; const s2=new Float64Array(n*G);
    for(let g=0;g<G;g++){ let sv=0; for(let r=0;r<n;r++) sv+=R.sig[r*G+g]*R.vol[r];
      const e= vt>0 ? 1/(1+sv/vt*Lc) : 0;
      for(let r=0;r<n;r++){ esc+=s[r*G+g]*e; s2[r*G+g]=s[r*G+g]*(1-e); } }
    heatCP(n,R.sig,R.chord,R.f,R.share,s2,dep); return esc; };
  const rA=Math.min(1, (c.rodw||0)*1e-5*cov), nCap=Math.max(0, bk.nu*(1-rA)-1), nAbs=bk.nu*rA;
  const eC=new Float64Array(n), eL=new Float64Array(n);
  for(let r=0;r<n;r++){ const k= r===HS_ABS ? nAbs : nCap*bk.cap[r]; eC[r]=k*B[r].ec; eL[r]=k*B[r].loc; }
  let EC=0, EL=0; for(let r=0;r<n;r++){ EC+=eC[r]; EL+=eL[r]; }
  const Q=FIS_EF+FIS_EN+FIS_EGP+EC+EL, q0=Q0>0 ? Q0 : Q;
  for(let r=0;r<n;r++) for(let g=0;g<G;g++) s[r*G+g]=bk.fis[r]*GAM_FISS[g];
  const escF=solve(s,dF);
  s.fill(0); for(let r=0;r<n;r++) for(let g=0;g<G;g++) s[r*G+g]= EC>0 ? eC[r]/EC*B[r].cap[g] : 0;
  const escC=solve(s,dC);
  const P=(r,e)=>(FIS_EGP*dF[r]+EC*dC[r]+eL[r]+e)/q0, D=(r,e)=>FIS_FGD*(dF[r]+e);
  o[b]=P(HS_COOL,0); o[b+1]=P(HS_BLK,0); o[b+2]=P(HS_TUBE,FIS_EGP*escF+EC*escC); o[b+3]=P(HS_ABS,0);
  o[b+4]=D(HS_COOL,0); o[b+5]=D(HS_BLK,0); o[b+6]=D(HS_TUBE,escF); o[b+7]=D(HS_ABS,0);
  return {Q, EC, EL}; }
function heatSharesCalc(c){
  const v=latVols(c), a=COOLANT[c.cool], m=MODER[c.mod];
  const cc=v.cool*a.modK, mb=v.mod*m.modK, tab=new Float64Array(HS_GRID*HS_GRID*HS_OUT);
  const cap=heatPointA(c,0,0,0,tab,0), Q0=cap.Q, fn=FIS_EN/Q0;
  for(let i=0;i<HS_GRID;i++) for(let j=0;j<HS_GRID;j++)
    heatPointA(c,i/(HS_GRID-1),j/(HS_GRID-1),Q0,tab,(i*HS_GRID+j)*HS_OUT);
  const o=new Float64Array(8);
  heatSplitA(tab,fn,cc,mb,0,o,0);
  const q=1-PROMPT_F, at=r=>PROMPT_F*o[r*2]+q*o[r*2+1];
  const water0=at(0), block0=at(1), struct0=at(2), abs0=at(3);
  return {tab, cc, mb, fn, Q0, cap, water0, block0, struct0, abs0, pin0:1-water0-block0-struct0-abs0};
}
/* coreFig() calls this every painted frame and it is 25 fixed points, so it is cached. A menu does not
   always revolve, so the key carries every figure heatSharesCalc() reads that latM()'s own rev does not. */
const HSS=new WeakMap(), HS_SCR=[];
function hsKey(o,c){ const a=COOLANT[c.cool];
  o.length=0;
  o.push(latM(c).rev, c.cool, c.mod, c.clad??0, c.lat.abs, absD(c), absN(c), c.rodw,
         c.tube?tubeBoreMm(c):0, c.tube?tubeWallMm(a.P0,a,c):0);
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
/* The blocks' heat path, whole core. Two populations in parallel: blocks round a bore, cooled on the bore
   face through the gas gap, the tube wall and the film inside it; L_MOD slot blocks, a rod of their own
   area cooled on its faces against bare channels by the coolant's own film. q''' is uniform over the
   blocks, so one lumped temperature carries them as R = sum w^2 R_i by volume share w. Rk 1/m (over k is
   K/W), Ri K/W, Rf K/W at the rated film; the gap's gas and radiation are priced at the rest-point
   temperatures, the block's k is live in the tick. */
function graphCellOf(c){
  const v=latVols(c), a=COOLANT[c.cool], m=MODER[c.mod], L=c.lat, H=L.len, Q=LAT_QUAD, p=L.pitch;
  const io=new Float64Array(2), pops=[], bore=latBoreM(c), Ab=latBlockA(c), nMF=latModFaces(c);
  const qBlk=heatShares(c).block0*c.power*1e6, Tc=Math.min(a.Tref, coolTsat(a, a.P0));
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
  let Rk=0, Ri=0, Rf=0;
  for(const q of pops){ const w=q.V/V, qq=qBlk*w;
    q.Rg=0;
    if(q.tube){ const xHe=tubeHeOf(c), A=2*Math.PI*(q.rt+q.gap/2)*q.nCh*H;
      for(let it=0;it<40;it++){ const Tt=Tc+qq*(q.Rf+q.Rw), Tb=Tt+qq*q.Rg, Tm=(Tt+Tb)/2;
        const hr=SIGMA_SB*(Tt*Tt+Tb*Tb)*(Tt+Tb)/(1/EPS_ZR+1/EPS_GRAPH-1);
        q.Rg=1/((gasMixK(xHe,Tm)/q.gap+hr)*A); } }
    q.Ri=q.Rw+q.Rg;
    Rk+=w*w*q.mean/q.V; Ri+=w*w*q.Ri; Rf+=w*w*q.Rf; }
  return {V, kg:V*m.dens*1000, Rk, Ri, Rf, pops, qBlk, Tc}; }
/* The blocks' own temperature coefficient, pcm/K, off the thermal book. The neutron temperature follows the
   blocks by their share of the moderation; the fissile nuclides' absorption and fission go as Westcott g(T),
   every other absorber as 1/v. Spectral: d ln(eta f)/dT = d ln Sf - d ln Sa_F + (1 - f) d ln Sa_F on the
   non-1/v parts. Leakage: L2 = D/Sa over the cell, D off free-atom transport, B2 the drawn core's bare
   cylinder, d ln P/dT = -L2B2/(1 + L2B2) d ln L2/dT with d ln L2 = 1/2T - f d ln Sa_F. Times the thermal
   chain weight. The coolant's own share is returned beside it and wired nowhere. */
const WG_IO=new Float64Array(2);
function modCoefOf(c){
  const bk=latBook(c,0), sh=modShares(c), mth=modTherm(modRatio(c)), M=latM(c), a=COOLANT[c.cool];
  const Tn=Math.min(a.Tref, coolTsat(a, a.P0));
  let dA=0, dF=0, wf=0;
  for(const k in bk.sfis){ const w=bk.sfis[k]/Math.max(bk.hm,1e-300), d=NUC[k], u=w*d.sf/d.sa;
    westcottA(k,"ga",Tn,WG_IO); dA+=w*WG_IO[1]/WG_IO[0];
    westcottA(k,"gf",Tn,WG_IO); dF+=u*WG_IO[1]/WG_IO[0]; wf+=u; }
  if(wf>0) dF/=wf;
  const f=bk.f, eta=dF-dA, util=(1-f)*dA, spec=eta+util;
  const D=bk.str>0 ? 1/(3*bk.str) : 0, L2=bk.sa>0 ? D/bk.sa : 0;
  const R=Math.max(M.dia/2,1e-6)*100, Hc=Math.max(M.hgt,1e-6)*100, B2=Math.pow(2.405/R,2)+Math.pow(Math.PI/Hc,2), x=L2*B2;
  const dL2=1/(2*Tn)-f*dA, leak=-x/(1+x)*dL2;
  const k=mth*1e5;
  return {aG:k*sh.block*(spec+leak), cool:k*sh.cool*(spec+leak), eta:k*sh.block*eta, util:k*sh.block*util, leak:k*sh.block*leak,
    f, L2, B2, D, Tn, share:sh.block, mth}; }
// coolant absorption per unit fuel: what voiding gives BACK
const modAbs=c=>{ const v=latVols(c);
  return v.fuel>0? v.cool*COOLANT[c.cool].absK/v.fuel : 0; };

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
      for(let g=0;g<LQ && !latFuel(c,LIX(u,v));g++){ u=Math.max(0,u-1); v=Math.max(0,v-1); }
      if(latFuel(c,LIX(u,v))) L.rod[LIX(u,v)]=b;
    }
  }
}

function latDefault(c){
  const L=c.lat;
  L.pitch=LAT_P0;
  latLayFuel(c,LAT_R0,LAT_POIG);
  latLayBanks(c,4);
  L.len=2*latEqR(c)*LAT_HD0;
  L.reflR=L.reflT=L.reflB=1;
  L.abs=0;
  latRevolve(c);
}
/* Rewrites the drawing, not the shopping: materials, family and fuel stay where they were left. */
const LATPRE=[
  ["STOCK",{r:LAT_R0,pk:1.00,hd:LAT_HD0,poi:LAT_POIG,refl:1,nb:4},
   "The reference core, and what the bench boots with: a full disc of fuel at the reference pitch, poison graded toward the centre, four banks on rings 5, 8, 10 and 12. About 1200 MWt in a 2.5 m core. Start here and edit."],
  ["COMPACT",{r:7.2,pk:0.90,hd:1.40,poi:0.80,refl:2,nb:4},
   "A small, tall, tightly pitched core: about 545 MWt in 1.7 m, some 140 tonnes lighter than stock, and half again the grace time, because there is less power in each litre of it. A narrow core leaks harder, and the doubled reflector is what pays for that. You get mass back to spend elsewhere and you give up half your power to do it."],
  ["FLAT",{r:9.6,pk:1.10,hd:0.70,poi:1.60,refl:2,nb:4},
   "A wide, squat core: full diameter, seven tenths of that in height, opened-out pitch and heavy central poison. Peaking falls and DNBR rises, so it takes more overpower before the hot channel is the thing that stops you. It weighs about what stock does, and the looser lattice weakens the moderator feedback that makes the plant follow load by itself."],
];
function latPreset(c,i){
  const q=LATPRE[i][1], L=c.lat;
  L.pitch=q.pk*LAT_P0;
  latLayFuel(c,q.r,q.poi);
  latLayMod(c,q.every||0);
  latLayBanks(c,q.nb);
  L.len=2*latEqR(c)*q.hd;
  L.reflR=L.reflT=L.reflB=q.refl;
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
 ["PWR",{fuel:1,rmat:1,abs:1,scram:1,foll:0,cool:0,mod:0,pk:1.00,r:LAT_R0,hd:1.00,poi:LAT_POIG,refl:1,nb:4,every:0},
  "A tight water lattice at 15.5 MPa, no solid moderator: the water between the assemblies is the moderator, so voiding it takes the moderation away and the core shuts itself down. The reference plant, and what every figure in this game was calibrated against."],
 ["BWR",{fuel:0,rmat:1,abs:2,scram:1,foll:0,cool:1,mod:0,pk:0.92,r:LAT_R0,hd:1.05,poi:LAT_POIG,refl:1,nb:4,every:0},
  "The same water at 7 MPa in an opened-out lattice, so there is more water per assembly and the void coefficient is markedly more negative. It boils in the core by design: power follows flow, and margin to dryout is thin."],
 /* A rectangular stack, so r spans the whole plan rather than a disc inside it. The cell is the RBMK-1000's own
    (INSAG-7 annex I): a 250 mm graphite block with an 88 mm pressure tube bored through it, 18 fuel rods at
    13.6 mm inside, 7 m active height. rodP is the drawing figure that packs 18 rods into a channel. */
 ["RBMK",{fuel:0,rmat:3,abs:0,scram:3,foll:1,cool:2,mod:0,pk:0.25/LAT_P0,r:13.5,hd:1.2407,poi:LAT_POIG,refl:1,nb:4,every:0,
          tube:{bore:80},rodD:0.0136,rodP:LAT_P0/Math.sqrt(18),rodSpd:0.4/7},
  "Every cell is a graphite block with a pressure tube bored through it, and water only inside the tube. The graphite does the moderating, so the water is a net ABSORBER - and boiling it off ADDS reactivity. This is the Chernobyl core, and nothing in the code says so: it falls out of what is drawn. A wide flat pile on a quarter-metre pitch, and it runs itself up if you let the channels void."],
 ["SFR",{fuel:2,rmat:1,abs:0,scram:0,foll:2,cool:3,mod:0,pk:0.78,r:8.4,hd:1.10,poi:LAT_POIG,refl:1,nb:4,every:0},
  "Sodium in a tight lattice and no moderator anywhere: a FAST core. Enormous power density and boiling margin, a prompt lifetime forty times shorter, and low-enriched fuel will not hold it critical - a fast spectrum needs the enrichment."],
 ["MSR",{fuel:6,rmat:3,abs:0,scram:0,foll:0,cool:4,mod:0,pk:1.05,r:9.0,hd:1.00,poi:LAT_POIG,refl:1,nb:4,every:4},
  "Molten salt through a graphite matrix. The salt moderates a little and the graphite does the rest, so the spectrum is thermal and the blocks own most of the moderation. Voiding the salt reads mildly NEGATIVE: the little moderation the salt does is worth more than the absorption it takes with it. No pressure anywhere and almost no xenon pit."],
 ["HTGR",{fuel:0,rmat:3,abs:0,scram:0,foll:1,cool:5,mod:0,pk:1.10,r:LAT_R0,hd:1.15,poi:LAT_POIG,refl:1,nb:4,every:2},
  "Helium through a graphite matrix. The gas moderates NOTHING, so every neutron this core thermalises is thermalised by the blocks - and voiding it is worth nothing either way. Six kilowatts a litre, and it cannot melt."],
 /* Calder Hall (Nuclear Engineering, Dec. 1956): 9.45 m x 6.40 m, 1696 channels, 1.30 in Magnox can, helical fin 0.125 in pitch to 2.125 in (area ratio off that geometry, fin efficiency 1); rodP is a drawing figure that packs 1696 bars into the fuel slots, not the 8 in channel pitch */
 ["MAGNOX",{fuel:5,rmat:3,abs:0,scram:0,foll:0,cool:6,mod:0,pk:3.6,r:10,hd:0.679,poi:0,refl:2,nb:4,every:2,clad:1,rodD:0.03302,rodP:0.04008,fin:9.88},
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
  L.len=2*latEqR(c)*q.hd;
  L.reflR=L.reflT=L.reflB=q.refl;
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
const latModCount=c=>{
  let n=0; for(let q=0;q<LQ*LQ;q++) if(c.lat.slot[q]===L_MOD) n++;
  return 4*n;
};

/* Samples per assembly side. A patch straddling a ring boundary books entirely to one side, so the revolve loses volume as this falls. */
const LAT_SS=16;
const latZeroZones=()=>{ const a=[]; for(let z=0;z<LAT_NZ;z++) a.push(new Float64Array(XNR)); return a; };

/* Blended by fuel VOLUME, except tdmg/tmelt which are MINIMA: failure is local, so one ring cannot hide behind four. */
const FUEL_BLEND=["beta","excess","rho","k","kint","alpha","mass","hm","bu"];
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

function latRevolve(c){
  const L=c.lat, p=L.pitch, rEq=latEqR(c);
  latRev++;
  let M;
  if(rEq<=0 || p<=0){
    M={dr:.1,dz:.1,frac:new Float64Array(XNR),occ:new Float64Array(XNR),poi:new Float64Array(XNR),
        nPen:new Float64Array(XNR).fill(LAT_NF),chan:[],bankR:[(XNR-1)/2],NB:1,
        zfrac:latZeroZones(),zTot:new Float64Array(LAT_NZ),
        dia:0,hgt:0,vol:0,nAsm:0,laid:0,rev:latRev};
    // an empty core still has to be MEASURED: poiG is built nowhere else
    LMS.set(c,M);
    latMeasure(c);
    return M;
  }
  const dr=rEq/XNR, patch=(p/LAT_SS)*(p/LAT_SS);
  const fuelA=new Float64Array(XNR), poisA=new Float64Array(XNR), modA=new Float64Array(XNR);
  const zoneA=latZeroZones();
  const rodN=[]; for(let i=0;i<XNR;i++) rodN.push({});
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const s=L.slot[LIX(u,v)]; if(!s) continue;
    const rod=L.rod[LIX(u,v)], zn=Math.min(LAT_NZ-1,L.zone[LIX(u,v)]);
    for(let a=0;a<LAT_SS;a++) for(let b=0;b<LAT_SS;b++){
      const r=Math.hypot((u+(a+.5)/LAT_SS)*p,(v+(b+.5)/LAT_SS)*p);
      const i=Math.min(XNR-1,Math.floor(r/dr));
      if(s===L_MOD){ modA[i]+=patch; continue; }
      fuelA[i]+=patch;
      zoneA[zn][i]+=patch;
      if(s===L_POIS) poisA[i]+=patch;
      if(rod>=0) rodN[i][rod]=(rodN[i][rod]||0)+1;
    }
  }
  const frac=new Float64Array(XNR), poi=new Float64Array(XNR), occ=new Float64Array(XNR);
  const nPen=new Float64Array(XNR);
  let vol=0;
  for(let i=0;i<XNR;i++){
    const ring=Math.PI*((i+1)*(i+1)-i*i)*dr*dr;
    frac[i]=clamp(4*fuelA[i]/ring,0,1);
    poi[i]=LAT_POIPIN*(fuelA[i]>1e-9? poisA[i]/fuelA[i] : 0);
    /* nPen is "no source here", and a moderator block is not a hole: book it against occupancy, book power against fuel alone. */
    occ[i]=clamp(4*(fuelA[i]+modA[i])/ring,0,1);
    nPen[i]=LAT_NF*(1-occ[i]);
    vol+=ring*L.len*frac[i];
  }
  const zfrac=latZeroZones(), zTot=new Float64Array(LAT_NZ);
  for(let z=0;z<LAT_NZ;z++) for(let i=0;i<XNR;i++){
    zfrac[z][i]= fuelA[i]>1e-9? zoneA[z][i]/fuelA[i] : 0;
    zTot[z]+=zoneA[z][i];
  }
  const chan=[];
  for(let i=0;i<XNR;i++){
    const ks=Object.keys(rodN[i]); if(!ks.length) continue;
    ks.sort((a,b)=>rodN[i][b]-rodN[i][a]);
    chan.push({i,b:+ks[0]});
  }
  const bank=[];
  for(const ch of chan) (bank[ch.b]=bank[ch.b]||[]).push(ch.i);
  const bankR=bank.filter(a=>a&&a.length).map(a=>a.reduce((s,v)=>s+v,0)/a.length);
  if(!bankR.length) bankR.push((XNR-1)/2);

  let laid=0;
  for(let q=0;q<LQ*LQ;q++) if(latFuel(c,q)) laid++;
  M={dr, dz:L.len/XNZ, frac, occ, poi, nPen, chan, bankR, NB:bankR.length, zfrac, zTot,
      dia:2*rEq, hgt:L.len, vol, nAsm:4*laid, laid:4*laid*p*p*L.len, rev:latRev};
  LMS.set(c,M);
  latMeasure(c);
  return M;
}

// PEAK_M is the design margin, a fitted figure
const PEAK_M=1.283;
function latQLim(c){
  const f=fuelBlend(c), a=COOLANT[c.cool];
  const melt=fuelDissolved(c) ? Infinity : 4*Math.PI*f.kint, dnb=a.qpp*Math.PI*rodD(c)*finOf(c)*1000;
  return {melt,dnb,q:Math.min(melt,dnb)/PEAK_M,
          bind:melt<dnb?"MELT":"DNB", clear:Math.max(melt,dnb)/Math.max(Math.min(melt,dnb),1e-9)};
}
function latRating(c){
  const M=latM(c);
  const Fq=Math.max(corePredict(c,{rf:REFL[c.refl]}).FqCold,1e-6);
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
  const gap=1/(2*Math.PI*R*H_GAP), wall=Math.log(Ro/R)/(2*Math.PI*cladOf(c).k),
        film=1/(2*Math.PI*Ro*COOLANT[c.cool].hFilm*finOf(c));
  if(fuelDissolved(c)) return {solid:0, gap:0, film};
  const L=latRods(c)*c.lat.len, qp=L>0? heatShares(c).pin0*c.power*1e6/L : 0;
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
/* as commonly quoted, not read at source: Ross-Stoute 1.5 (2.0 + 0.5 um) roughness, 0.30 Xe+Kr per fission (0.85 Xe), 200 MeV per fission, free volume 6 % of pellet */
const GAP_ROUGH=1.5*(2.0e-6+0.5e-6), FG_YIELD=0.30, FG_XE=0.85, FIS_J=200e6*1.602176634e-19, ROD_VFREE=0.06;
const N_AV=6.02214076e23, ROD_P_FILL=2.2, ROD_T_FILL=300;
// MWd/kgHM: the batch spread from fresh to discharge averages half of it
const burnupSuggest=c=>fuelBlend(c).bu/2;
const coreBurnupOf=c=>c.burnup ?? burnupSuggest(c);
// mol of stable fission gas per m3 of pellet at the core's own burnup
const fgInvOf=c=>{ const f=fuelBlend(c); return coreBurnupOf(c)*86400e6/FIS_J*f.rho*f.hm*FG_YIELD/N_AV; };
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
const fgFillOf=()=>ROD_P_FILL*1e6*ROD_VFREE/(R_GAS*ROD_T_FILL);

function latMeasure(c){
  const M=latM(c), L=c.lat;
  c.pitch=L.pitch/LAT_P0;
  const fb=fuelBlend(c);
  c.hd=M.dia>1e-6? M.hgt/M.dia : 1;
  c.nbank=M.NB;
  let pm=0; for(let i=0;i<XNR;i++) pm+=M.poi[i]*ringW[i];
  c.poison=pm;
  /* Graded shape at volume mean exactly one, so poison buys flatness rather than reactivity. */
  const g=new Float64Array(XNR);
  for(let i=0;i<XNR;i++) g[i]= pm>1e-9? M.poi[i]/pm : 1;
  M.poiG=g;
  /* Ring excess MINUS the core mean, so it is zero-mean by construction; the raw ring excess would count reactivity twice. */
  const er=new Float64Array(XNR);
  for(let i=0;i<XNR;i++){
    let e=0,w=0;
    for(let z=0;z<LAT_NZ;z++){ e+=M.zfrac[z][i]*FUEL[zoneFuelOf(c,z)].excess; w+=M.zfrac[z][i]; }
    er[i]= w>1e-9? e/w-fb.excess : 0;
  }
  M.enrRho=er;
  /* LAST: the rating solves on the flux, and the solve reads the grading this function has just written. */
  c.power=latRating(c);
}

/* t of moderator blocks: the drawn quadrant four times over the core's height */
const latModT=c=>latVols(c).mod*LAT_QUAD*c.lat.len*MODER[c.mod].dens;
/* Fuel mass is NOT here: derived() gets it from the volume. */
function latMass(c){
  const M=latM(c), L=c.lat;
  const rf=REFL[c.refl], dr=M.dr, dz=M.dz;
  const ringA=i=>Math.PI*((i+1)*(i+1)-i*i)*dr*dr;
  let m=0;
  for(let q=0;q<Math.ceil(L.reflR);q++)
    m+=ringA(XNR+q)*L.len*Math.min(1,L.reflR-q)*rf.dens;
  const disc=Math.PI*Math.pow((XNR+L.reflR)*dr,2);
  m+=disc*dz*(L.reflT+L.reflB)*rf.dens;
  m+=latAbsA(c)*LAT_QUAD*L.len*ABSORB[L.abs].dens;
  m+=latModT(c);
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
  if(M.NB<2) w.push(["SOFT","Only one rod bank. Tilt trim needs at least two, so there is nothing to lean against a flux tilt with.","rods"]);
  if(c.power<400||c.power>2400) w.push(["SOFT","This lattice rates "+c.power.toFixed(0)+" MWt, outside the 400 to 2400 MWt the hull was drawn for.","core"]);
  { const gap=(rodPOf(c)-rodD(c))*1000;
    if(gap<2) w.push(["RED","Pin diameter "+(rodD(c)*1000).toFixed(1)+" mm leaves only "+gap.toFixed(1)+" mm between pins on a "+(rodPOf(c)*1000).toFixed(1)+" mm rod pitch. Under 2 mm nothing can be assembled there - no grid, no channel, no water.","core"]); }
  if(c.hd<.5||c.hd>2.5) w.push(["SOFT","H/D of "+c.hd.toFixed(2)+" is outside the 0.5 to 2.5 the vessel forge can make.","core"]);
  if(c.pitch<.6||c.pitch>1.8) w.push(["SOFT","Assembly pitch "+(L.pitch*100).toFixed(1)+" cm is outside what the fuel vendor will assemble.","core"]);
  const bare=[[L.reflR,"rim"],[L.reflT,"lid"],[L.reflB,"floor"]].filter(z=>z[0]<0.5);
  if(bare.length) w.push(["SOFT","Bare "+bare.map(z=>z[1]).join(" and ")+
    ". Neutrons that leave that face are gone. A single ring of reflector is worth most of what a reflector has to give.","core"]);
  return w;
}

/* One core's whole design as a string; designSig() joins one per vessel. */
const latSig=c=>{ const L=c.lat;
  return L.slot.join("")+"|"+L.rod.join("")+"|"+L.zone.join("")+"|"+
  [L.pitch,L.len,L.reflR,L.reflT,L.reflB,L.abs].join(",")+"|"+
  CORE_KEYS.map(k=>k==="zoneFuel"?JSON.stringify(c.zoneFuel):c[k]).join(","); };

/* Pinned so one cell of a material gives its flat albedo and the cells after it are diminishing returns. */
function latAlb(t,rf){
  if(t<=0) return 0.53;
  return Math.min(0.90, 0.53+0.40*Math.min(1,rf.dRho/750)*(1+0.6*(1-Math.pow(0.55,t-1))));
}

/* Minted with its vessel (mintMachine(), layout.js) and removed with it. */
function coreMint(from){
  if(from) return coreClone(from);
  const c=Object.assign({zoneFuel:{},lat:latNew()},CORE_DEFAULT); latDefault(c); return c; }
function coreClone(src){
  const L=src.lat, c=Object.assign({},src,{zoneFuel:Object.assign({},src.zoneFuel),
    lat:Object.assign({},L,{slot:new Uint8Array(L.slot),rod:new Int8Array(L.rod),zone:new Uint8Array(L.zone)})});
  if(src.tube) c.tube=Object.assign({},src.tube);
  latRevolve(c); return c; }
/* The stand-in for a ship with no vessel: a blank grid still has to answer every design question. */
let CORE_NONE=null;
const coreNone=()=>{ if(CORE_NONE) return CORE_NONE;
  // published before latDefault(): the lay asks the plant, and the plant asks this
  CORE_NONE=Object.assign({zoneFuel:{},lat:latNew()},CORE_DEFAULT); latDefault(CORE_NONE);
  return CORE_NONE; };
