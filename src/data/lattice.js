"use strict";
/* Loads AFTER core2d.js: it sizes its arrays from XNR/XNZ, and core2d only needs the lattice at call time. */

const LQ=10;                     // quarter-plan slots per side
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

const ABSORB=[
  {name:"BORON CARBIDE",k:1.00,dens:2.5,
   note:"The baseline, and what the control bank used to be calibrated against. Cheap, light, and it swells and cracks as it burns, so a long campaign costs you worth you cannot see going."},
  {name:"SILVER-INDIUM-CADMIUM",k:0.62,dens:10.2,
   note:"Weaker per cluster and four times as dense, but it does not swell, so it is the one that still moves at the end of a campaign. Buy it and you need more clusters, or clusters nearer the flux."},
  {name:"HAFNIUM",k:1.34,dens:13.3,
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
// the Westinghouse 17x17 rod, m: clad OD, clad thickness, square rod pitch
const ROD_D0=0.0095, ROD_CLAD=0.00057, ROD_P=0.0126;
const rodDSuggest=()=>ROD_D0;
const rodD=c=>c.rodD??ROD_D0;
const rodSpdOf=c=>c.rodSpd??ROD_SPD0;
// zircaloy: density kg/m3, Pilling-Bedworth ratio, reaction enthalpy J/kg Zr, kg H2 per kg Zr (Zr + 2 H2O -> ZrO2 + 2 H2), pcm per unit clad-over-fuel volume
const ZR_RHO=6560, ZR_PBR=1.56, ZR_QOX=6.45e6, ZR_H2=0.0442, ZR_ABS=1000;
const rodDP=c=>rodD(c)-2*ROD_CLAD;
const latFuelFrac=c=>Math.PI/4*(rodDP(c)/ROD_P)*(rodDP(c)/ROD_P);
const latRodFrac =c=>Math.PI/4*(rodD(c) /ROD_P)*(rodD(c) /ROD_P);
// clad per unit fuel: zirconium is a parasitic absorber
const modClad=c=>{ const f=latFuelFrac(c); return f>1e-12 ? (latRodFrac(c)-f)/f : 0; };
// one bundle's hydraulics at the pitch drawn; aHeat is per METRE of height
function latBundle(c){
  const nRod=(LAT_P0/ROD_P)*(LAT_P0/ROD_P), p=c.lat.pitch;
  const aFlow=Math.max(0, p*p - latRodFrac(c)*LAT_P0*LAT_P0);
  const aHeat=nRod*Math.PI*rodD(c);
  return {nRod, aFlow, aHeat, dh:aHeat>0 ? 4*aFlow/aHeat : 0};
}
function latVols(c){
  let nF=0,nM=0;
  for(let q=0;q<LQ*LQ;q++){ const s=c.lat.slot[q]; if(s===L_MOD) nM++; else if(s) nF++; }
  const cell=c.lat.pitch*c.lat.pitch, p0=LAT_P0*LAT_P0;
  return {nF,nM,fuel:nF*latFuelFrac(c)*p0,
          cool:nF*Math.max(0,cell-latRodFrac(c)*p0),mod:nM*cell};
}
const modRatio=(c,voided)=>{ const v=latVols(c); if(v.fuel<=0) return 0;
  return ((voided?0:v.cool*COOLANT[c.cool].modK)+v.mod*MODER[c.mod].modK)/v.fuel; };
const modShares=c=>{ const v=latVols(c);
  const cc=v.cool*COOLANT[c.cool].modK, m=v.mod*MODER[c.mod].modK, t=cc+m;
  return t>1e-12? {cool:cc/t,block:m/t} : {cool:0,block:0}; };
const modCoolShare=c=>modShares(c).cool;
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
 /* A rectangular stack, so r spans the whole plan rather than a disc inside it. */
 ["RBMK",{fuel:0,rmat:3,abs:0,scram:0,foll:1,cool:2,mod:0,pk:1.06,r:13.5,hd:1.10,poi:LAT_POIG,refl:1,nb:4,every:3,tube:true},
  "Graphite blocks on a checkerboard with the fuel, water only in the channels. The graphite does the moderating, so the water is a net ABSORBER - and boiling it off ADDS reactivity. This is the Chernobyl core, and nothing in the code says so: it falls out of what is drawn. A wide flat pile, pitched so the void coefficient lands on the +2500 pcm the real machine carried before 1986: open it further and the core hunts itself into a trip."],
 ["SFR",{fuel:2,rmat:1,abs:0,scram:0,foll:2,cool:3,mod:0,pk:0.78,r:8.4,hd:1.10,poi:LAT_POIG,refl:1,nb:4,every:0},
  "Sodium in a tight lattice and no moderator anywhere: a FAST core. Enormous power density and boiling margin, a prompt lifetime forty times shorter, and low-enriched fuel will not hold it critical - a fast spectrum needs the enrichment."],
 ["MSR",{fuel:1,rmat:3,abs:0,scram:0,foll:0,cool:4,mod:0,pk:1.05,r:9.0,hd:1.00,poi:LAT_POIG,refl:1,nb:4,every:4},
  "Molten salt through a graphite matrix. The salt moderates a little and the graphite does the rest, so the spectrum is thermal and the blocks own most of the moderation. Voiding the salt reads mildly NEGATIVE: the little moderation the salt does is worth more than the absorption it takes with it. No pressure anywhere and almost no xenon pit."],
 ["HTGR",{fuel:0,rmat:3,abs:0,scram:0,foll:1,cool:5,mod:0,pk:1.10,r:LAT_R0,hd:1.15,poi:LAT_POIG,refl:1,nb:4,every:2},
  "Helium through a graphite matrix. The gas moderates NOTHING, so every neutron this core thermalises is thermalised by the blocks - and voiding it is worth nothing either way. Six kilowatts a litre, and it cannot melt."],
];
function archPreset(c,i){
  const q=ARCHPRE[i][1], L=c.lat;
  c.cool=q.cool; c.mod=q.mod; c.fuel=q.fuel; c.refl=q.rmat;
  c.scram=q.scram; c.foll=q.foll; L.abs=q.abs;
  // a pressure-tube core is a knob bag on the reactor; absent = a vessel
  if(q.tube) c.tube=c.tube||{}; else delete c.tube;
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
const FUEL_BLEND=["beta","excess","densK","condK","alpha","mass"];
const FUEL_MIN=["tdmg","tmelt"];
function fuelBlend(c){
  const zt=latM(c).zTot; let tot=0;
  for(let z=0;z<LAT_NZ;z++) tot+=zt[z];
  const f0=FUEL[zoneFuelOf(c,0)];
  if(!(tot>1e-9)) return f0;
  const o={name:f0.name,note:f0.note};
  for(const k of FUEL_BLEND){
    let a=0; for(let z=0;z<LAT_NZ;z++) a+=zt[z]/tot*FUEL[zoneFuelOf(c,z)][k];
    o[k]=a;
  }
  for(const k of FUEL_MIN){
    o[k]=Infinity;
    for(let z=0;z<LAT_NZ;z++) if(zt[z]>1e-9) o[k]=Math.min(o[k],FUEL[zoneFuelOf(c,z)][k]);
    if(!isFinite(o[k])) o[k]=f0[k];
  }
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

// kW/m, UO2's published conductivity integral to melt; PEAK_M is the design margin, fitted so the stock PWR rates 1200 MWt
const KINT_UO2=6.3, PEAK_M=1.283;
function latQLim(c){
  const f=fuelBlend(c), a=COOLANT[c.cool];
  const melt=4*Math.PI*KINT_UO2*f.condK, dnb=a.qpp*Math.PI*rodD(c)*1000;
  return {melt,dnb,q:Math.min(melt,dnb)/PEAK_M,
          bind:melt<dnb?"MELT":"DNB", clear:Math.max(melt,dnb)/Math.max(Math.min(melt,dnb),1e-9)};
}
function latRating(c){
  const M=latM(c);
  const Fq=Math.max(corePredict(c,{rf:REFL[c.refl]}).FqCold,1e-6);
  const nRods=M.nAsm*latBundle(c).nRod;
  return latQLim(c).q*nRods*c.lat.len/Fq/1000;
}

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
  /* A channel is about 6% of its ring by volume: balance, not measured, and nothing physical reads it. */
  for(const ch of M.chan) m+=ringA(ch.i)*L.len*0.06*ABSORB[L.abs].dens;
  m+=latVols(c).mod*4*L.len*MODER[c.mod].dens;
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
  { const gap=(ROD_P-rodD(c))*1000;
    if(gap<2) w.push(["RED","Pin diameter "+(rodD(c)*1000).toFixed(1)+" mm leaves only "+gap.toFixed(1)+" mm between pins on a "+(ROD_P*1000).toFixed(1)+" mm rod pitch. Under 2 mm nothing can be assembled there - no grid, no channel, no water.","core"]); }
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
