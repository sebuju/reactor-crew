"use strict";
/* the core as a lattice you lay out, not as seven numbers you buy */

/* ═══════════════ THE FUEL LATTICE ═══════════════
   A core is not designed in section. It is laid out in PLAN, on a square
   lattice, one assembly at a time: which assemblies are there, which carry a
   rod cluster, which carry burnable poison. The section only ever says how
   tall it is and what is wrapped round it.

   So this file is the design surface, and seven things that used to be sliders
   on the bench are now MEASUREMENTS of it:

     D.power    fuel volume x power density. Counted, never chosen.
     D.hd       the envelope the lattice revolves to, against its length.
     D.pitch    the assembly spacing, against the reference spacing.
     D.poison   the volume mean of the poison pins you placed.
     D.nbank    how many banks your clusters are grouped into.
     D.rodw     measured off the solve by core2d, not bought.
     coreDia    the lattice's own outer envelope.

   coreConst() used to manufacture all of that out of the numbers. It now reads
   what latRevolve() measured, and everything downstream is unchanged.

   LOAD ORDER. This is a data file that loads after a sim file, which is
   unusual and deliberate: it sizes its arrays from XNR/XNZ in core2d.js, and
   core2d.js only needs the lattice at call time. index.html is the one place
   that order lives. */

const LQ=10;                     // quarter-plan slots per side
/* L_MOD is a slot holding a moderator BLOCK instead of an assembly. It is core
   material - it is walked through, it is inside the envelope the mesh spans,
   and it is weighed - but it is NOT fuel, so every count that means "there is
   fuel here" has to ask latFuel() rather than test the slot for non-zero. */
const L_EMPTY=0, L_FUEL=1, L_POIS=2, L_MOD=3;
const LIX=(u,v)=>u*LQ+v;
const latFuel=q=>LAT.slot[q]===L_FUEL||LAT.slot[q]===L_POIS;

/* The design point the stock lattice is sized to. Everything else about the
   reactor is drawn; these two only fix what "pitch 1.0x" means, so that a
   default lattice lands on the plant the bench used to sell. */
const LAT_MW0=1200, LAT_HD0=1.0;
/* Stock fuel radius, in slots. Sized so the round core reaches BOTH axes of
   the quarter: shorter than this and the outer row and column are permanently
   empty, which reads as a cropped drawing rather than as a round core in a
   square lattice. The CORNERS staying empty is correct and is the point. */
const LAT_R0=9.6;
/* How much reactivity a ring that is not full of fuel loses. A one-group
   stand-in for "no source here", big enough that a gap is genuinely a gap and
   small enough that a solve through it still converges. The one fitted number
   this file adds. */
const LAT_NF=22000;
const LAT_REFLMAX=3;             // reflector past this buys nothing
const LAT_POIPIN=1200;           // a fully poisoned ring, pcm
/* How hard the stock lattice grades its poison from centreline to rim. Tuned
   against the old bench default of 400 pcm mean - see latDefault(). */
const LAT_POIG=0.90;

/* Absorber is a MATERIAL, not a calibration. coreConst() used to solve for a
   strength that made the fully-inserted bank come to whatever the slider said;
   now you buy a material, put the clusters where you want them, and the worth
   is what the solve measures. LAT_A0 below is the one calibration left, and it
   exists only so a stock lattice is worth what a stock bank always was. */
const ABSORB=[
  {name:"BORON CARBIDE",k:1.00,dens:2.5,
   note:"The baseline, and what the control bank used to be calibrated against. Cheap, light, and it swells and cracks as it burns, so a long campaign costs you worth you cannot see going."},
  {name:"SILVER-INDIUM-CADMIUM",k:0.62,dens:10.2,
   note:"Weaker per cluster and four times as dense, but it does not swell, so it is the one that still moves at the end of a campaign. Buy it and you need more clusters, or clusters nearer the flux."},
  {name:"HAFNIUM",k:1.34,dens:13.3,
   note:"A third more worth per cluster, and it takes decades of irradiation without complaint. Heavy - and margin bought from fewer, stronger clusters is margin concentrated in fewer things that can jam."},
];

const LAT={
  slot:new Uint8Array(LQ*LQ),
  rod:new Int8Array(LQ*LQ),      // -1 none, else bank 0..3
  pitch:0,                       // assembly pitch, metres
  len:0,                         // active fuel length, metres
  reflR:1, reflT:1, reflB:1,     // reflector thickness per face, cells
  abs:0,                         // index into ABSORB
};
let LM=null;                     // the revolve: what the solver is handed
let latRev=0;                    // bumped whenever the lattice changes

/* ── THE EQUIVALENT RADIUS ──
   How far out the mesh reaches, and the single most consequential line in this
   file. A round core of square assemblies has a RAGGED edge: the fuel reaches
   the disc, but the corner of the outermost assembly sticks out past it. Span
   the mesh to that corner and the outermost of fourteen rings comes back only
   31% full of fuel, which is a 15,000 pcm hole sitting exactly where the
   peripheral control bank lives. The measured consequence: a zero-sum lean in
   rod TRAVEL became a 1,900 pcm net-negative lean in rod WORTH, power
   collapsed and the plant tripped itself on LOW PRESSURE.

   So the mesh spans the EQUAL-AREA radius instead - the radius of the smooth
   cylinder holding the same fuel. The raggedness beyond it folds into the
   outer ring, which is what the albedo boundary is there to smear anyway, and
   every ring comes back essentially full. Do not "simplify" this back to the
   corner radius; audit-physics.js will trip on the split-lean block if you do,
   and that is the failure telling you about it.

   It spans every OCCUPIED slot, fuel or moderator, because the envelope the
   mesh has to cover is the core - a graphite block between two assemblies is
   inside the reactor, not outside it. What is fuel and what is not is a
   separate question, asked per ring by latRevolve(). */
const latEqR=()=>{
  let n=0; for(let q=0;q<LQ*LQ;q++) if(LAT.slot[q]) n++;
  return Math.sqrt(4*n/Math.PI)*LAT.pitch;
};

/* ── WHAT IS IN THE LATTICE, BY VOLUME ──
   The one measurement Stage 2's whole moderation model reads. A fuel BUNDLE
   is a fixed object - LAT_FUELFRAC of the REFERENCE cell, not of the cell it
   sits in - so opening the pitch adds coolant around the same fuel and
   tightening it takes coolant away. That is how pitch moves the spectrum with
   no correction term written anywhere; the old aM*(2-D.pitch) was this,
   guessed. A moderator slot is a solid block: no fuel and no coolant in it. */
const LAT_FUELFRAC=0.33;
function latVols(){
  let nF=0,nM=0;
  for(let q=0;q<LQ*LQ;q++){ const s=LAT.slot[q]; if(s===L_MOD) nM++; else if(s) nF++; }
  const cell=LAT.pitch*LAT.pitch, bundle=LAT_FUELFRAC*LAT_P0*LAT_P0;
  return {nF,nM,fuel:nF*bundle,cool:nF*Math.max(0,cell-bundle),mod:nM*cell};
}
/* Moderating volume over fuel volume, the two contributors scaled by their own
   materials. `voided` stands the coolant down, which is the whole of what a
   void coefficient asks. */
const modRatio=voided=>{ const v=latVols(); if(v.fuel<=0) return 0;
  return ((voided?0:v.cool*COOLANT[D.cool].modK)+v.mod*MODER[D.mod].modK)/v.fuel; };
/* How much of the moderation the COOLANT provides. 1 in a PWR, near 0 in a
   graphite core - and it is what decides whether voiding is a loss or a gain. */
const modCoolShare=()=>{ const v=latVols();
  const c=v.cool*COOLANT[D.cool].modK, m=v.mod*MODER[D.mod].modK;
  return (c+m)>1e-12? c/(c+m) : 0; };
/* Coolant absorption per unit fuel: what voiding gives BACK. */
const modAbs=()=>{ const v=latVols();
  return v.fuel>0? v.cool*COOLANT[D.cool].absK/v.fuel : 0; };

/* ── the reference pitch ──
   Solved against VOLUME, so a stock lattice lands on the stock reactor:

     fuel area = 4*n*p^2                n filled slots in the quarter
     radius    = sqrt(4n/pi)*p          the equal-area radius above
     length    = 2*Req*hd
     volume    = 8*n*sqrt(4n/pi)*hd*p^3 -> one cube root                   */
const LAT_P0=(function(){
  let n=0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(Math.hypot(u+.5,v+.5)<=LAT_R0) n++;
  const dens=COOLANT[0].dens*FUEL[1].densK*(1.15-0.15*1.0);
  return Math.cbrt((LAT_MW0/dens)/(8*n*Math.sqrt(4*n/Math.PI)*LAT_HD0));
})();

/* ── laying the lattice in bulk ──
   Every stock core is the same two acts: fill a disc with fuel and grade
   poison into it, then spread the clusters over what you filled. They are two
   functions rather than a block written once per preset, because a preset IS
   latDefault() with different numbers in it - and a copy of this loop is the
   copy that would quietly stop agreeing with the core audit-physics measures.

   Neither of them revolves. The caller does, once, when it has finished
   changing things. */
function latLayFuel(r0,poig){
  LAT.slot.fill(L_EMPTY); LAT.rod.fill(-1);
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(Math.hypot(u+.5,v+.5)<=r0) LAT.slot[LIX(u,v)]=L_FUEL;
  /* Poison graded toward the centre, because that is where the flux peaks -
     the same job the old XPG constant did, except that you can see every pin
     and move it.

     It is a RAMP, not a disc. A checkerboard inside 0.58 of the radius was the
     first attempt and it loaded only 181 pcm against the 400 the old default
     carried, because ring weight goes as the radius and a disc that stops
     halfway misses most of the core's volume. Hold-down that burnable poison
     does not do falls to uniform boron instead, and boron is flat where poison
     is graded - which moved the flux shape enough to trip a split lean that
     used to ride out. The dither is a fixed pattern rather than random, so the
     stock lattice is the same reactor every time it is laid out. */
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    if(!LAT.slot[LIX(u,v)]) continue;
    const f=poig*(1-Math.hypot(u+.5,v+.5)/r0);
    if(((u*3+v*5)%7)/7 < f) LAT.slot[LIX(u,v)]=L_POIS;
  }
}
  /* Clusters spread by AREA, so the outer banks cover the rings that hold most
     of the core - the same rule the bench used, and aimed at the same rings it
     used to land on: 5, 8, 10 and 12 of fourteen.

     Aiming at rings rather than at a fraction of the fuel radius is
     load-bearing, and the outermost bank is why. Placed by radius fraction it
     lands on ring 13, the LAST ring, which is the lowest flux in the core - so
     it gives back far less on withdrawal than the inner bank takes on
     insertion. A lean that is zero-sum in rod TRAVEL then comes out 30% more
     negative in rod WORTH, the loop drops a further 0.3 MPa, and a trim-sized
     split lean trips the plant on LOW PRESSURE. Measured, not guessed: the
     baseline dips to 13.53 MPa against a 13.33 MPa trip and this put it at
     13.23. Two per bank, either side of the quarter, and each landing is
     CHECKED rather than assumed - a hand-written list did this first and one
     entry sat outside the fuel, so that bank quietly shipped with half its
     clusters and nothing said so. */
function latLayBanks(nb){
  for(let q=0;q<LQ*LQ;q++) LAT.rod[q]=-1;
  const rEqSlots=latEqR()/LAT.pitch;
  for(let b=0;b<nb;b++){
    /* nb in the denominator, so four banks land on the same rings 5/8/10/12
       the hand-written list used to and audit-physics still measures */
    const ring=Math.round(Math.sqrt((b+.5)/nb)*(XNR-1));
    const rr=(ring+0.5)/XNR*rEqSlots;
    for(const th of [Math.PI/9, Math.PI*7/18]){
      let u=clamp(Math.round(rr*Math.cos(th)-.5),0,LQ-1);
      let v=clamp(Math.round(rr*Math.sin(th)-.5),0,LQ-1);
      for(let g=0;g<LQ && !latFuel(LIX(u,v));g++){ u=Math.max(0,u-1); v=Math.max(0,v-1); }
      if(latFuel(LIX(u,v))) LAT.rod[LIX(u,v)]=b;
    }
  }
}

/* ── the stock lattice ── */
function latDefault(){
  LAT.pitch=LAT_P0;
  latLayFuel(LAT_R0,LAT_POIG);
  latLayBanks(4);
  LAT.len=2*latEqR()*LAT_HD0;
  LAT.reflR=LAT.reflT=LAT.reflB=1;
  LAT.abs=0;
  latRevolve();
}
/* ── whole cores you can start from ──
   Three lattices laid out with the same two helpers the stock core uses, so a
   preset cannot describe a reactor the pens could not have drawn. What a
   preset does NOT touch is what you bought rather than drew: the reflector
   material, the absorber material, the reactor family and the fuel all stay
   where you left them. It rewrites the drawing, not the shopping.

   Every figure in the notes below is measured off the lattice by latMeasure(),
   not asserted here. */
const LATPRE=[
  ["STOCK",{r:LAT_R0,pk:1.00,hd:LAT_HD0,poi:LAT_POIG,refl:1,nb:4},
   "The reference core, and what the bench boots with: a full disc of fuel at the reference pitch, poison graded toward the centre, four banks on rings 5, 8, 10 and 12. About 1200 MWt in a 2.5 m core. Start here and edit."],
  ["COMPACT",{r:7.2,pk:0.90,hd:1.40,poi:0.80,refl:2,nb:4},
   "A small, tall, tightly pitched core: about 545 MWt in 1.7 m, some 140 tonnes lighter than stock, and half again the grace time, because there is less power in each litre of it. A narrow core leaks harder, and the doubled reflector is what pays for that. You get mass back to spend elsewhere and you give up half your power to do it."],
  ["FLAT",{r:9.6,pk:1.10,hd:0.70,poi:1.60,refl:2,nb:4},
   "A wide, squat core: full diameter, seven tenths of that in height, opened-out pitch and heavy central poison. Peaking falls and DNBR rises, so it takes more overpower before the hot channel is the thing that stops you. It weighs about what stock does, and the looser lattice weakens the moderator feedback that makes the plant follow load by itself."],
];
function latPreset(i){
  const q=LATPRE[i][1];
  LAT.pitch=q.pk*LAT_P0;
  latLayFuel(q.r,q.poi);
  latLayMod(q.every||0);
  latLayBanks(q.nb);
  LAT.len=2*latEqR()*q.hd;
  LAT.reflR=LAT.reflT=LAT.reflB=q.refl;
  latRevolve();
}
/* ── packing moderator between the assemblies ──
   `every` is how many slots out of every N become a block: 0 lays none, 2 is
   a checkerboard, 3 is one in three. Run AFTER latLayFuel(), which has just
   filled the disc, so the blocks displace fuel rather than sit outside it.
   Fixed dither, not random, for the same reason latLayFuel()'s poison is: a
   preset has to be the same reactor every time it is laid. */
function latLayMod(every){
  if(!every) return;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const q=LIX(u,v);
    if(!LAT.slot[q]) continue;
    if((u+v)%every===0){ LAT.slot[q]=L_MOD; LAT.rod[q]=-1; }
  }
}
/* ── WHOLE REACTORS YOU CAN START FROM ──
   REACTOR TYPE used to be a list you picked from, and picking it set thirteen
   numbers. It is these six rows now, and every one of them is a DRAWING: pick
   the coolant, pick the block material, set the pitch, lay the fuel, pack the
   moderator, spread the banks. What made an RBMK an RBMK - a positive void
   coefficient - is not in this table at all; it comes out of the graphite the
   preset lays and the water it leaves between it.

   Same contract LATPRE carries, with one difference stated in as many words:
   this one DOES buy, because the coolant and the moderator are what it is
   choosing. It does not touch the fuel, the reflector or the absorber. */
const ARCHPRE=[
 ["PWR",{cool:0,mod:0,pk:1.00,r:LAT_R0,hd:1.00,poi:LAT_POIG,refl:1,nb:4,every:0},
  "A tight water lattice at 15.5 MPa, no solid moderator: the water between the assemblies is the moderator, so voiding it takes the moderation away and the core shuts itself down. The reference plant, and what every figure in this game was calibrated against."],
 ["BWR",{cool:1,mod:0,pk:0.92,r:LAT_R0,hd:1.05,poi:LAT_POIG,refl:1,nb:4,every:0},
  "The same water at 7 MPa in an opened-out lattice, so there is more water per assembly and the void coefficient is markedly more negative. It boils in the core by design: power follows flow, and margin to dryout is thin."],
 ["RBMK",{cool:2,mod:0,pk:1.10,r:LAT_R0,hd:0.85,poi:LAT_POIG,refl:1,nb:4,every:3},
  "Graphite blocks on a checkerboard with the fuel, water only in the channels. The graphite does the moderating, so the water is a net ABSORBER - and boiling it off ADDS reactivity. This is the Chernobyl core, and nothing in the code says so: it falls out of what is drawn."],
 ["SFR",{cool:3,mod:0,pk:0.78,r:8.4,hd:1.10,poi:LAT_POIG,refl:1,nb:4,every:0},
  "Sodium in a tight lattice and no moderator anywhere: a FAST core. Enormous power density and boiling margin, a prompt lifetime forty times shorter, and low-enriched fuel will not hold it critical - a fast spectrum needs the enrichment."],
 ["MSR",{cool:4,mod:0,pk:1.05,r:9.0,hd:1.00,poi:LAT_POIG,refl:1,nb:4,every:4},
  "Molten salt through a graphite matrix. The salt moderates a little and the graphite does the rest, so the spectrum is thermal and the void coefficient is mildly negative. No pressure anywhere and almost no xenon pit."],
 ["HTGR",{cool:5,mod:0,pk:1.10,r:LAT_R0,hd:1.15,poi:LAT_POIG,refl:1,nb:4,every:2},
  "Helium through a graphite matrix. The gas moderates NOTHING, so every neutron this core thermalises is thermalised by the blocks - and voiding it is worth nothing either way. Six kilowatts a litre, and it cannot melt."],
];
function archPreset(i){
  const q=ARCHPRE[i][1];
  D.cool=q.cool; D.mod=q.mod;
  LAT.pitch=q.pk*LAT_P0;
  latLayFuel(q.r,q.poi);
  latLayMod(q.every);
  latLayBanks(q.nb);
  LAT.len=2*latEqR()*q.hd;
  LAT.reflR=LAT.reflT=LAT.reflB=q.refl;
  latRevolve();
}

const latCount=()=>{               // FUEL assemblies in the WHOLE core, not the quarter
  let n=0; for(let q=0;q<LQ*LQ;q++) if(latFuel(q)) n++;
  return 4*n;
};
const latModCount=()=>{
  let n=0; for(let q=0;q<LQ*LQ;q++) if(LAT.slot[q]===L_MOD) n++;
  return 4*n;
};

/* ── the revolve ──
   Sample each assembly LAT_SSxLAT_SS times. Every sample is an equal patch of
   area that lands in whichever ring its radius falls in; ring coverage is that
   area over the annulus area, times four because the plan is a quarter.

   LAT_SS is a convergence knob and nothing else. A patch straddling a ring
   boundary is booked entirely to one side, so the revolve loses a little
   volume and the loss falls as the patches shrink. On the stock lattice, which
   is a 1200 MWt reactor by construction:

       SS=4  1192 MWt      SS=8  1195 MWt      SS=16  1198 MWt

   Sixteen is nothing next to the diffusion solve that follows, and it holds
   the error under two tenths of a per cent. audit-physics.js asserts the
   revolved volume against the volume laid out, so it cannot quietly drift. */
const LAT_SS=16;
function latRevolve(){
  const p=LAT.pitch, rEq=latEqR();
  latRev++;
  if(rEq<=0 || p<=0){
    LM={dr:.1,dz:.1,frac:new Float64Array(XNR),occ:new Float64Array(XNR),poi:new Float64Array(XNR),
        nPen:new Float64Array(XNR).fill(LAT_NF),chan:[],bankR:[(XNR-1)/2],NB:1,
        dia:0,hgt:0,vol:0,nAsm:0,laid:0};
    return LM;
  }
  const dr=rEq/XNR, patch=(p/LAT_SS)*(p/LAT_SS);
  const fuelA=new Float64Array(XNR), poisA=new Float64Array(XNR), modA=new Float64Array(XNR);
  const rodN=[]; for(let i=0;i<XNR;i++) rodN.push({});
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const s=LAT.slot[LIX(u,v)]; if(!s) continue;
    const rod=LAT.rod[LIX(u,v)];
    for(let a=0;a<LAT_SS;a++) for(let b=0;b<LAT_SS;b++){
      const r=Math.hypot((u+(a+.5)/LAT_SS)*p,(v+(b+.5)/LAT_SS)*p);
      const i=Math.min(XNR-1,Math.floor(r/dr));
      if(s===L_MOD){ modA[i]+=patch; continue; }
      fuelA[i]+=patch;
      if(s===L_POIS) poisA[i]+=patch;
      if(rod>=0) rodN[i][rod]=(rodN[i][rod]||0)+1;
    }
  }
  const frac=new Float64Array(XNR), poi=new Float64Array(XNR), occ=new Float64Array(XNR);
  const nPen=new Float64Array(XNR);
  let vol=0;
  for(let i=0;i<XNR;i++){
    /* ringW is the annulus weight core2d already keeps; the area itself is
       pi*((i+1)^2 - i^2)*dr^2 and a quarter plan is a quarter of it */
    const ring=Math.PI*((i+1)*(i+1)-i*i)*dr*dr;
    frac[i]=clamp(4*fuelA[i]/ring,0,1);
    poi[i]=LAT_POIPIN*(fuelA[i]>1e-9? poisA[i]/fuelA[i] : 0);
    /* A ring half full of fuel is half a hole, and the deficit is linear - but
       a MODERATOR block is not a hole. nPen stands for "no source here", and
       a graphite block has no source and excellent moderation, so it is core
       material the ring is made of rather than a gap in it. Book it against
       occupancy; book power against fuel alone. */
    occ[i]=clamp(4*(fuelA[i]+modA[i])/ring,0,1);
    nPen[i]=LAT_NF*(1-occ[i]);
    vol+=ring*LAT.len*frac[i];
  }
  /* one channel per ring that has a cluster in it, on that ring's own bank */
  const chan=[];
  for(let i=0;i<XNR;i++){
    const ks=Object.keys(rodN[i]); if(!ks.length) continue;
    ks.sort((a,b)=>rodN[i][b]-rodN[i][a]);
    chan.push({i,b:+ks[0]});
  }
  const bank=[];
  for(const c of chan) (bank[c.b]=bank[c.b]||[]).push(c.i);
  const bankR=bank.filter(a=>a&&a.length).map(a=>a.reduce((s,v)=>s+v,0)/a.length);
  if(!bankR.length) bankR.push((XNR-1)/2);

  let laid=0;                       // the FUEL area actually laid out, for the audit
  for(let q=0;q<LQ*LQ;q++) if(latFuel(q)) laid++;
  LM={dr, dz:LAT.len/XNZ, frac, occ, poi, nPen, chan, bankR, NB:bankR.length,
      dia:2*rEq, hgt:LAT.len, vol, nAsm:4*laid, laid:4*laid*p*p*LAT.len};
  latMeasure();
  return LM;
}

/* ── the lattice, turned into the numbers the bench already reads ──
   THE one place the drawing becomes D. derived() is untouched and every figure
   it produces is the real one. */
function latMeasure(){
  const M=LM;
  D.pitch=LAT.pitch/LAT_P0;
  const dens=COOLANT[D.cool].dens*FUEL[D.fuel].densK*(1.15-0.15*D.pitch);
  D.power=M.vol*dens;              // MW over kW/L is m3 exactly
  D.hd=M.dia>1e-6? M.hgt/M.dia : 1;
  D.nbank=M.NB;
  let pm=0; for(let i=0;i<XNR;i++) pm+=M.poi[i]*ringW[i];
  D.poison=pm;
  /* poiG keeps its old contract: graded shape, volume mean exactly one, so
     poison still buys flatness rather than reactivity */
  const g=new Float64Array(XNR);
  for(let i=0;i<XNR;i++) g[i]= pm>1e-9? M.poi[i]/pm : 1;
  M.poiG=g;
}

/* ── what the drawing weighs ──
   The reflector used to be a flat catalogue figure. This weighs the real one,
   cell by cell, and a single ring of steel round a real core comes to rather
   more than the 28 t the option list sold - which is a finding, not a rounding
   error. Fuel mass is NOT here: derived() already gets it from the volume. */
function latMass(){
  if(!LM) latRevolve();
  const rf=REFL[D.refl], dr=LM.dr, dz=LM.dz;
  const ringA=i=>Math.PI*((i+1)*(i+1)-i*i)*dr*dr;
  let m=0;
  /* rim: the band outside the mesh, at the thickness that face was given */
  for(let q=0;q<Math.ceil(LAT.reflR);q++)
    m+=ringA(XNR+q)*LAT.len*Math.min(1,LAT.reflR-q)*rf.dens;
  /* lid and floor: a disc over the whole core, one cell of height each */
  const disc=Math.PI*Math.pow((XNR+LAT.reflR)*dr,2);
  m+=disc*dz*(LAT.reflT+LAT.reflB)*rf.dens;
  /* the clusters themselves - a channel is about 6% of its ring by volume */
  for(const c of LM.chan) m+=ringA(c.i)*LAT.len*0.06*ABSORB[LAT.abs].dens;
  /* the moderator blocks you drew, weighed the same way the reflector is:
     whole cells, at the density of what you packed them with */
  m+=latVols().mod*4*LAT.len*MODER[D.mod].dens;
  return m;
}

/* ── can this lattice be built ──
   Same [SEV, sentence] shape derived().warn uses, so the two concatenate. */
function latWarn(){
  const w=[], M=LM||latRevolve();
  let n=0, nf=0;
  for(let q=0;q<LQ*LQ;q++){ if(LAT.slot[q]) n++; if(latFuel(q)) nf++; }
  if(!nf){ w.push(["HARD","There is no fuel in this core at all."]); return w; }
  /* The core has to be one piece: an island across a water gap is a second
     reactor with one set of rods between them. The walk crosses MODERATOR
     slots, because a graphite block between two assemblies couples them - it
     is the gap with nothing in it that splits a core. */
  const seen=new Uint8Array(LQ*LQ), q=[];
  for(let i=0;i<LQ*LQ&&!q.length;i++) if(LAT.slot[i]){ q.push(i); seen[i]=1; }
  let head=0, reach=1;
  while(head<q.length){
    const k=q[head++], u=(k/LQ)|0, v=k%LQ;
    for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
      const a=u+d[0], b=v+d[1];
      if(a<0||a>=LQ||b<0||b>=LQ) continue;
      const j=LIX(a,b);
      if(seen[j]||!LAT.slot[j]) continue;
      seen[j]=1; reach++; q.push(j);
    }
  }
  if(reach<n) w.push(["HARD","There are "+((n-reach)*4)+" slots that nothing else in the core touches. A core split by a water gap is two reactors with one set of rods between them."]);
  if(!M.chan.length) w.push(["HARD","No rod clusters at all. Nothing can control this core, shut it down, or hold it down once it is."]);
  if(M.NB<2) w.push(["SOFT","Only one rod bank. Tilt trim needs at least two, so there is nothing to lean against a flux tilt with."]);
  if(D.power<400||D.power>2400) w.push(["SOFT","This lattice rates "+D.power.toFixed(0)+" MWt, outside the 400 to 2400 MWt the hull was drawn for."]);
  if(D.hd<.5||D.hd>2.5) w.push(["SOFT","H/D of "+D.hd.toFixed(2)+" is outside the 0.5 to 2.5 the vessel forge can make."]);
  if(D.pitch<.6||D.pitch>1.8) w.push(["SOFT","Assembly pitch "+(LAT.pitch*100).toFixed(1)+" cm is outside what the fuel vendor will assemble."]);
  const bare=[[LAT.reflR,"rim"],[LAT.reflT,"lid"],[LAT.reflB,"floor"]].filter(z=>z[0]<0.5);
  if(bare.length) w.push(["SOFT","Bare "+bare.map(z=>z[1]).join(" and ")+
    ". Neutrons that leave that face are gone. A single ring of reflector is worth most of what a reflector has to give."]);
  return w;
}

/* Reflector thickness is not a D field, so JSON.stringify(D) cannot see it
   change. designSig() asks this as well, or moving a face would leave the
   commissioned plant quietly out of date with the bench. */
const latSig=()=>LAT.slot.join("")+"|"+LAT.rod.join("")+"|"+
  [LAT.pitch,LAT.len,LAT.reflR,LAT.reflT,LAT.reflB,LAT.abs].join(",");

/* ── thickness to albedo ──
   The ramp is pinned so that ONE cell of a material gives exactly the flat
   albedo the old formula gave it, and the two cells after that are diminishing
   returns on top. Zero cells is a bare face at 0.53. */
function latAlb(t,rf){
  if(t<=0) return 0.53;
  return Math.min(0.90, 0.53+0.40*Math.min(1,rf.dRho/750)*(1+0.6*(1-Math.pow(0.55,t-1))));
}

/* optList() writes D[key], and the absorber is not a D field - it belongs to
   the lattice. One accessor rather than a second option-list widget, so the
   rows, the live mass deltas and the tooltips all still come from the real
   bench widget instead of a copy of it. Non-enumerable, so designSig()'s
   JSON.stringify(D) does not see it twice - latSig() already carries it. */
Object.defineProperty(D,"__abs",{
  get:()=>LAT.abs,
  set:v=>{ if(v!==LAT.abs){ LAT.abs=v; latRevolve(); } }});

latDefault();
