"use strict";
/* the core as a place, not a number: rings x levels, 1-group diffusion, SOR */

/* ═══════════════ 2-D NODAL CORE ═══════════════
   Point kinetics still owns total power. This file owns the SHAPE, and the
   flux-weighted feedback that shape implies. Everything the 0-D core could
   only fake - rod worth by depth, a hot channel, local boiling, spatial
   xenon, the graphite-tip scram spike - falls out of the shape for free.

   Geometry is r-z. Ring 0 is the centreline, level 0 is the bottom. Rods
   enter from the top, so an inserted absorber sits at the high levels.

   Two entry points. commission() calls coreConst() to bake the constants
   into P; derived() calls corePredict() to show the bench what shape it
   is about to build, before anything is commissioned. */
const XNR=14, XNZ=10, XNN=XNR*XNZ;
const XIX=(i,j)=>i*XNZ+j;

/* Six sweeps warm-started from last tick lands well inside a percent, because
   the shape barely moves in 20 ms. Cold starts sweep properly instead. */
/* SOR_OM is the conventional over-relaxation factor for a mesh this shape. */
const SOR_SWEEPS=6, SOR_OM=1.5;

/* The three numbers here are fitted rather than derived, AND THEY WERE FITTED
   AGAINST NO STATED TARGET - that is the honest label, not a derivation.
   XCOUP sets how tightly a node talks to its neighbours, and so how far a
   local disturbance travels before the rest of the core notices. XPG is how
   hard burnable poison grades toward the centre. XRINF is how many rings one
   bank reaches. Each wants an anchor of its own; none has one yet. */
const XCOUP=1.0, XPG=0.9, XRINF=2.2;
/* How far apart the tilt trim can stand the innermost and outermost banks, as a
   share of core height. Measured, not picked: the radial offset a load transient
   swings on its own is ~3.5 points, and the trim has to be able to answer a real
   part of that or it is decoration. 0.15 bought 0.8 points, 0.30 buys 1.5. Past
   0.35 the outer bank hits full withdrawal, the trim saturates and the response
   stops being monotonic, so this is the knee and not a free dial. */
const XTILTZ=0.30;
/* The absorber strength that makes a stock bank in a stock lattice worth what
   it has always been worth. Solved once, on the first coreConst(), and then
   held: rod worth is a measurement now, and this is the only thing left in the
   file that is fitted to the old bench rather than read off the drawing. */
const XRODW0=2600;
let XABS0=null;
/* ── THE PIN AS A HEAT BALANCE ──
   XTAU_F is the fuel pin's own time constant, seconds: heat capacity over film
   conductance at rated flow. It is the same 4 s the correlation this replaces
   lagged by, so a pin that IS being cooled answers exactly as it always did -
   what changes is that a pin that is NOT being cooled now has nowhere for the
   heat to go and climbs on its own heat capacity until it melts. XDRY, the 320
   scale, the 1+4*void fudge, the 3200 cap and the pk2 normalisation are all
   gone with it: a balance does not need any of them.
   The latent heat that turns enthalpy above saturation into quality is the
   COOLANT row's own hfg now (P.hfg, T.hfg), not water's 1500 applied to every
   family - the quality term divided sodium by water's latent heat and the
   whole of Stage D's channel weight reads that quality. */
const XTAU_F=4;
/* and it FOLLOWS THE PIN, because a pin's heat capacity goes as its volume and
   its film conductance as its surface: the ratio is a diameter. 4 s is the
   reference rod, so a thin pin answers faster and forgives a scram with no
   flow, and a fat one carries its own stored heat into the melt. */
const xTauF=()=>XTAU_F*rodD()/ROD_D0;
/* The reference clad rise above coolant at rated power, kelvin - what P.gSolid
   is fitted against in coreReset(). Real: a PWR rod's outer surface runs about
   30 K above the water going past it. */
const CLAD_DT0=30;
/* Drift flux: quality to void fraction. C0 is the concentration parameter (the
   steam runs up the middle of the channel faster than the mean) and rvl is
   the density ratio of steam to water, which is satRvl(pressure) now rather
   than a typed number - the two densities close on each other as the loop
   approaches critical, and a plant that depressurises makes far more void per
   unit of quality than one that does not. Standard correlation between two
   REAL quantities, which is what separates it from the lump rescale it
   replaces. */
const XC0=1.13;
/* ── CROSS-FLOW ──
   A core is not fourteen sealed pipes. An open lattice mixes hard between
   assemblies, so a hot channel's ENTHALPY RISE is far flatter than its power:
   a real PWR runs Fq near 2.5 with an enthalpy-rise hot channel factor near
   1.55, and this one number is the whole of the difference between those two.
   Without it the centre ring of the stock core - flux 2.14 against a core mean
   of 1 - takes twice the average rise, boils at 83 % power and locks into its
   own voiding runaway at rest, which is not what the plant it is modelling
   does. The PELLET is not mixed: it really does make its own local power.

   It is MEASURED now, in coreConst(), off the same drawing modRatio() reads.
   XMIX0 is what a reference bundle cell mixes, which is the 0.55 that used to
   be the whole of this constant; open area per bundle scales it, and a
   moderator BLOCK is a wall, which is exactly the thing that stops cross-flow.
   The ceiling is 0.85 and not 1: at 1 the expression below collapses to
   1/ringP, every channel takes the identical rise whatever its power, and the
   voiding-channel runaway - the point of the whole field - stops existing. A
   wide lattice must not be able to buy its way out of that. */
const XMIX0=0.55, XMIX_MAX=0.85;
/* ── SUBCOOLED BOILING ──
   Void used to be exactly zero until the BULK reached saturation, which is a
   dead band the plant does not have: nucleate boiling departs the wall while
   the bulk is still subcooled, and a PWR hot channel carries a few percent
   void at the top with the bulk below saturation the whole way.

   Saha-Zuber says where it departs, and it has TWO branches. The high-Peclet
   one is 154*q"/(G*cp), and it is the only one carrying 1/G - alone it sends a
   coasting pump's channel to full void in a single tick. Below Pe 70000 the
   correlation switches to 0.0022*q"*D/k, which has no G in it at all, so the
   smaller of the two magnitudes is the published answer and not a clamp bolted
   over a blow-up.

   Neither can be applied literally: this file carries shares of the rated
   point, never W/m2 or kg/m2s. But the ratio collapses - q"/(G*cp) is the core
   rise times the flow area over the heated area - so both anchor on ONE
   geometric ratio of a fuel bundle, which is the P.pinUA idiom, and CORE_DT0
   inside them makes both scale per plant. Both ratios are MEASURED off the
   drawn bundle now (latBundle(), lattice.js): the flow-to-heated area ratio
   was one real PWR written down as XSUB_AR, and the low branch's 28.3 K was
   that same bundle's 0.0022*q"*D/k evaluated once. Neither carried the pitch,
   the core height or the power density of the plant being commissioned, and
   all three belong in it. SZ_LO is Saha-Zuber's own coefficient; K_COOL is the
   coolant's conductivity in W/m/K at the film. A plant at rated is on the high
   branch as it should be and the two still cross at low flow. */
const SZ_LO=0.0022, K_COOL=0.54;
/* Levy's profile fit: thermodynamic quality in, TRUE quality out. It is
   defined only ABOVE departure - below it the expression does not decay to
   zero, it goes to 1 and then to NaN, which is a sodium core at rest reading
   full void and taking s.nRho with it. The guard is the correlation's own
   domain, and it also bounds the exponent: past it xe/xd can never be large
   and positive, so the exp cannot overflow. */
const subQual = (xe,xd) => {
  if(xe<=xd) return 0;
  const E=Math.exp(xe/xd-1);
  return (xe-xd*E)/(1-xd*E);
};
const driftFlux = (x,rvl) => { const q=clamp(x,0,1);
  return q<=0 ? 0 : clamp(q/(XC0*(q+(1-q)*rvl)), 0, 1); };
/* driftFlux run backwards, algebraically exact. The parallel-channel weight
   wants QUALITY and the field carries void, and recovering it here costs one
   divide and no second array on S. */
const voidQual = (v,rvl) => { const q=clamp(v,0,1);
  const den=1-q*XC0*(1-rvl);
  return den>1e-6 ? clamp(q*XC0*rvl/den, 0, 1) : 1; };

/* volume weights: ring i is an annulus, so it is worth 2i+1 unit cells */
const ringW=new Float64Array(XNR), nodeW=new Float64Array(XNN);
const faceI=new Float64Array(XNR), faceO=new Float64Array(XNR);
(function(){
  let t=0; for(let i=0;i<XNR;i++) t+=2*i+1;
  for(let i=0;i<XNR;i++){
    ringW[i]=(2*i+1)/t;
    faceI[i]=i/(i+0.5); faceO[i]=(i+1)/(i+0.5);      // annulus face areas
    for(let j=0;j<XNZ;j++) nodeW[XIX(i,j)]=ringW[i]/XNZ;
  }
})();
const wMean=a=>{ let m=0; for(let k=0;k<XNN;k++) m+=a[k]*nodeW[k]; return m; };
function nodePeak(a){ let v=-1e30,k=0;
  for(let q=0;q<XNN;q++) if(a[q]>v){ v=a[q]; k=q; }
  return {v,k,i:(k/XNZ)|0,j:k%XNZ}; }

/* ── what the bench decides about the core as a place ──
   T is the object the constants land on: P when commissioning, a scratch
   object when the bench is only asking what a design would look like. */
function coreConst(T,d){
  /* Every dimension below is MEASURED off the lattice in src/data/lattice.js.
     It used to be manufactured here out of D.power, D.hd, D.pitch, D.poison
     and D.nbank - a volume, a diameter, a coupling length, an albedo, a poison
     grading and a bank spread, all invented from numbers on tracks. Those five
     are now readouts of the thing that was laid out, and this function reads
     the same measurement they do. */
  const M=LM||latRevolve();
  T.coreDia=M.dia; T.coreHgt=M.hgt;

  /* migration length against node size gives the coupling. A tight lattice
     under-moderates, which lengthens it and binds the core together; an open
     lattice lets one corner of the core drift on its own. */
  /* The migration length. 0.21 is chosen so a stock water lattice reads 7.6 cm,
     against light water's real ~6 cm, and the square root is how M scales with
     lattice spacing. FITTED SHAPE, real magnitude - it is not read off the
     drawing the way modRatio() is, and it could be. */
  const Lm=0.21*Math.sqrt(D.pitch);
  T.cz=XCOUP*Math.pow(Lm/(Math.max(T.coreHgt,.05)/XNZ),2);
  T.cr=XCOUP*Math.pow(Lm/(Math.max(T.coreDia,.05)/2/XNR),2);

  /* CROSS-FLOW, off the same measurement. Open area around ONE bundle against
     the same area at the reference pitch, so a stock lattice reads 1 by
     construction and needs no snapshot of a stock core to compare against. */
  { const v=latVols();
    /* the denominator is latVols()'s own cool term with the reference pitch put
       back in, so at pitch 1.0x the two are the same expression on the same
       operands and the ratio is exactly 1 - not 1 to within a rounding */
    const open0=v.nF*(LAT_P0*LAT_P0 - latRodFrac()*LAT_P0*LAT_P0);
    const solid=(v.nF+v.nM)>0 ? v.nM/(v.nF+v.nM) : 0;
    T.mix=open0>0 ? clamp(XMIX0*(v.cool/open0)*(1-solid), 0, XMIX_MAX) : 0; }

  /* departure quality at the RATED point, one branch each - see SZ_LO. Both
     are magnitudes; the sign goes on where they are used. */
  { const B=latBundle(), hgt=Math.max(T.coreHgt,.05), hfg=COOLANT[D.cool].hfg;
    T.hfg = hfg;
    T.dh = B.dh;                                   // Stages D and F both read it
    const nF=latVols().nF;
    T.aHeat=4*nF*B.aHeat*hgt;                      // whole core rod surface, m2
    T.aFlow=4*nF*B.aFlow;                          // whole core flow area, m2
    /* rated mass flux, kg/m2/s: what the core carries when it is taking
       CORE_DT0 of rise at rated power. W-3 wants a real G, not a share. */
    T.G0=(T.rated||D.power)*1000/(CP_W*CORE_DT0)/Math.max(T.aFlow,1e-9);
    const qpp=(T.rated||D.power)*1e6/Math.max(T.aHeat,1e-6);
    T.xSub  = 154*CP_W*CORE_DT0*(B.aFlow/(B.aHeat*hgt))/hfg;
    T.xSubLo= CP_W*(SZ_LO*qpp*T.dh/K_COOL)/hfg; }

  /* the reflector stops being a flat pcm bonus and starts reflecting: the
     share of what leaks out of an edge node that finds its way back in, per
     face, at the thickness that face was given */
  T.albR=latAlb(LAT.reflR,d.rf);
  T.albT=latAlb(LAT.reflT,d.rf);
  T.albB=latAlb(LAT.reflB,d.rf);
  T.alb=(T.albR+T.albT+T.albB)/3;      // for anything reading the scalar
  /* the band itself, kept so the plant view can DRAW the reflector you
     dimensioned rather than only the albedo it bought. A commissioned plant
     carries its own, because the bench lattice may have been redrawn since. */
  T.reflR=LAT.reflR; T.reflT=LAT.reflT; T.reflB=LAT.reflB; T.reflMat=D.refl;

  /* burnable poison is where you put the pins, normalised so the core-average
     worth is still exactly D.poison - it buys flatness, not reactivity */
  T.poiG=M.poiG; T.poison=D.poison;
  /* and a ring the lattice did not fill is a ring with no source in it */
  T.nPen=M.nPen;
  /* the loading pattern, as a zero-mean per-ring reactivity: FUEL[].excess is
     already stated in pcm of core-average excess, so the coefficient is 1 and
     there is no constant to fit */
  T.enrRho=M.enrRho;
  /* how full of fuel each ring actually is. The solver only needs the penalty
     above; the RENDERER needs the fraction, because a hole you drew should be
     a hole you can still see while you are operating the thing. */
  T.frac=M.frac;

  /* banks are wherever you put their clusters */
  T.NB=M.NB; T.bankR=M.bankR.slice();
  T.rinf=Math.max(XRINF,XNR/T.NB);
  /* How much bank reach overlaps on each ring. A pure function of bankR and
     rinf, both fixed here, so rodShape() no longer rebuilds it every tick. */
  T.rinfW=new Float64Array(XNR);
  for(let b=0;b<T.NB;b++) for(let i=0;i<XNR;i++)
    T.rinfW[i]+=Math.max(0,1-Math.abs(i-T.bankR[b])/T.rinf);
  /* Tilt weight per bank: +1 on the centreline falling to -1 at the outer bank,
     centred so the weights sum to zero. That last part is what makes it a tilt
     rather than a bank move - an off-centre set would insert net reactivity, the
     T-avg controller would walk the bank back to cancel it, and the trim would
     end up shifting the flux almost nowhere. Banks spread by AREA, so a plain
     inner/outer flip put three of four banks on the same side. */
  { const rm=T.bankR.reduce((a,r)=>a+r,0)/T.NB;
    const sp=Math.max(...T.bankR.map(r=>Math.abs(r-rm)));
    T.bankW=T.bankR.map(r=> sp>1e-9 ? -(r-rm)/sp : 0); }   // one bank cannot tilt anything

  const fo=FOLL[D.foll];
  T.tipRho=fo.tipRho; T.tipLen=fo.tipLen; T.follName=fo.name;

  /* ── what the bank is worth ──
     This used to solve for an absorber strength that made the fully-inserted
     bank come to whatever D.rodw was set to. Now the strength is the MATERIAL
     you bought and the worth is what the solve says: drive the bank fully in
     and read the flux-weighted answer off it. Worth stopped being a purchase
     and became a consequence of where you put the clusters.

     Three passes over ONE warm-started flux, because the flux moves when the
     absorber does. Do not cut it to a single cold solve - the answer lands a
     quarter of a per cent low, which looks exactly like a lattice measuring
     the wrong reactor.

     XABS0 is the one calibration left in the file. It is solved once, on the
     stock lattice, so that a stock core with a stock absorber is worth the
     2600 pcm a stock bank always was. */
  const st={rodZ:new Float64Array(T.NB).fill(1)};
  const phi=new Float64Array(XNN).fill(1);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN), rho=new Float64Array(XNN);
  const worth=a=>{
    let w=0;
    for(let pass=0;pass<3;pass++){
      rodShape(T,st,cov,fol);
      for(let k=0;k<XNN;k++) rho[k]=-a*cov[k];
      coreSolve(T,phi,rho,25);
      w=0; for(let k=0;k<XNN;k++) w+=cov[k]*phi[k]*nodeW[k];
    }
    return w;
  };
  if(XABS0==null){
    /* the old fixed point, verbatim and once: unit strength is worth w in the
       flux it makes, so scale to the target, then re-solve and repeat. Running
       it at a fixed a=1 instead would calibrate against an almost unrodded
       core and come out several per cent adrift. */
    let a=1;
    const p0=new Float64Array(XNN).fill(1);
    for(let pass=0;pass<3;pass++){
      rodShape(T,st,cov,fol);
      for(let k=0;k<XNN;k++) rho[k]=-a*cov[k];
      coreSolve(T,p0,rho,25);
      let w=0; for(let k=0;k<XNN;k++) w+=cov[k]*p0[k]*nodeW[k];
      a=XRODW0/Math.max(w,1e-3);
    }
    XABS0=a;
  }
  T.rodA=XABS0*ABSORB[LAT.abs].k;
  D.rodw=Math.max(0,T.rodA*worth(T.rodA));
  T.FqCold=coreFq(T,RODX0);
  T.leak=coreLeak(T,T.phiCold);
  return T;
}

/* ── what this shape LEAKS, pcm ──
   500*(hd-1)^2 was a curve in one aspect ratio, and it could not see a rod
   pattern, a zone loading or a hole in the drawing. This is the boundary term
   the solve already carries, summed over the faces that have one: what a face
   loses is the coupling out of it, less the share the reflector sends back.
   Read on the SAME converged flux coreFq() made, so rods, poison, nPen and
   enrRho have all shaped it first - which is what makes fresh fuel on the rim
   cost something. Full albedo on every face reads exactly 0.

   LEAK_K is the one fit in it, and it is a MESH calibration: fourteen rings by
   ten levels is coarse and the term is the whole face coupling, so it reads
   13.9 % on the stock lattice - far more than a real core loses.
   lattice against the ~3 % a large PWR really leaks. Solved once so the stock
   core reads 3000 pcm; every other shape is then measured against it on the
   same mesh, which is the XABS0 idiom. */
const LEAK_K=0.13;
function coreLeak(T,phi){
  let out=0, tot=0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const k=XIX(i,j), w=nodeW[k];
    tot+=phi[k]*w;
    let g=0;
    if(i===XNR-1) g+=(1-T.albR)*T.cr*faceO[i];
    if(j===XNZ-1) g+=(1-T.albT)*T.cz;
    if(j===0)     g+=(1-T.albB)*T.cz;
    out+=g*phi[k]*w;
  }
  return tot>1e-9 ? LEAK_K*1e5*out/tot : 0;
}

/* peaking of a cold, xenon-free, unvoided core with the bank at x. The bench
   readout and the calibration use it; the live sim never does. */
function coreFq(T,x){
  const phi=new Float64Array(XNN).fill(1), rho=new Float64Array(XNN);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN);
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    rho[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-T.poison*(T.poiG[i]-1)-T.nPen[i]
          +T.enrRho[i]; }
  coreSolve(T,phi,rho,60);
  T.phiCold=phi;
  return nodePeak(phi).v;
}

/* The bench asks this every frame while a slider is moving, and massWith()
   asks it once per option row on top of that, so it is cached on the design
   signature and only actually solved when the design changes.

   latRev is in the signature because the DRAWING is an input and D is not
   enough to see it: move a cluster from one ring to another and D.nbank does
   not change, so the key did not either. What saved it was an accident - the
   solve writes D.rodw, which is itself in the key, so the next call disagreed
   with the previous one and re-solved. That means the readout was one edit
   behind, and which answer you got depended on how many times the frame had
   asked. Measured: laying four banks over the stock lattice read 2485 pcm for
   a bank the solve puts at 2600. latRev is bumped by latRevolve(), so it moves
   exactly when the lattice does. */
let fqSig=null, fqVal=null;
function corePredict(d){
  /* D.zoneFuel is here for the same reason latRev is: picking a zone's fuel
     off the menu is not a lattice edit, so latRev does not move, and a row
     that happens not to move D.power would leave the readout one edit behind. */
  const sig=[D.cool,D.mod,D.fuel,D.refl,D.poison,D.pitch,D.hd,D.power,
             D.rodw,D.nbank,D.foll,latRev,JSON.stringify(D.zoneFuel)].join(",");
  if(sig!==fqSig){ fqSig=sig; fqVal=coreConst({},d); }
  return fqVal;
}

/* Everything the renderer needs, from the live core if there is one and from
   the predicted one if the plant has not been built yet. One accessor, so the
   bench and the panel cannot drift apart. */
function coreView(L){
  if(L && L.phi) return {phi:L.phi,nV:L.nV,xX:L.xX,nTf:L.nTf,rodZ:L.rodZ,
    nDmg:L.nDmg,nOx:L.nOx,nMelt:L.nMelt,
    bankR:P.bankR,NB:P.NB,tipLen:P.tipLen,tipRho:P.tipRho,TfRef:P.TfRef,X0:P.X0,
    dia:P.coreDia,hgt:P.coreHgt,frac:P.frac,peak:{i:L.hotRing,j:L.hotLev},
    reflR:P.reflR,reflT:P.reflT,reflB:P.reflB,reflMat:P.reflMat};
  const T=corePredict(derived());
  return {phi:T.phiCold,nV:null,xX:null,nTf:null,rodZ:null,
    nDmg:null,nOx:null,nMelt:null,
    bankR:T.bankR,NB:T.NB,tipLen:T.tipLen,tipRho:T.tipRho,TfRef:0,X0:1,
    dia:T.coreDia,hgt:T.coreHgt,frac:T.frac,peak:nodePeak(T.phiCold),
    reflR:T.reflR,reflT:T.reflT,reflB:T.reflB,reflMat:T.reflMat};
}

/* ── where the absorber is, and what is hanging below it ── */
function rodShape(T,st,cov,fol){
  cov.fill(0); fol.fill(0);
  const rw=T.rinfW;
  for(let b=0;b<T.NB;b++){
    const ins=clamp(st.rodZ[b],0,1), tip=XNZ*(1-ins);   // tip, in node units
    const fLo=tip-T.tipLen, fHi=tip;
    for(let i=0;i<XNR;i++){
      const w=Math.max(0,1-Math.abs(i-T.bankR[b])/T.rinf)/Math.max(rw[i],1e-6);
      if(w<=0) continue;
      for(let j=0;j<XNZ;j++){
        const k=XIX(i,j);
        cov[k]+=w*clamp(j+1-tip,0,1);                             // absorber
        fol[k]+=w*clamp(Math.min(j+1,fHi)-Math.max(j,fLo),0,1);   // follower
      }
    }
  }
}

/* ── the diffusion solve ── */
function coreSolve(T,phi,rho,sweeps){
  const n=sweeps||SOR_SWEEPS;
  /* One albedo per face. The rim, the lid and the floor used to share a single
     number, so a reflector drawn on top and one drawn round the side were the
     same reactor - and then the thickness you gave a face did not matter. */
  const aR=T.albR, aT=T.albT, aB=T.albB;
  for(let s=0;s<n;s++){
    for(let i=0;i<XNR;i++){
      const b=i*XNZ, fi=faceI[i], fo=faceO[i];
      const den=T.cr*(fi+fo)+2*T.cz+1;
      for(let j=0;j<XNZ;j++){
        const k=b+j;
        const In = i>0       ? phi[k-XNZ] : 0;          // centreline: mirror
        const Ou = i<XNR-1   ? phi[k+XNZ] : aR*phi[k];  // rim, floor and lid
        const Dn = j>0       ? phi[k-1]   : aB*phi[k];  // leak out, minus
        const Up = j<XNZ-1   ? phi[k+1]   : aT*phi[k];  // the reflected part
        const num=T.cr*(fi*In+fo*Ou)+T.cz*(Dn+Up)+(1+rho[k]*1e-5)*phi[k];
        const v=phi[k]+SOR_OM*(num/den-phi[k]);
        phi[k]= (isFinite(v)&&v>1e-6) ? v : 1e-6;
      }
    }
    const m=wMean(phi);
    if(m>1e-9){ for(let k=0;k<XNN;k++) phi[k]/=m; } else phi.fill(1);
  }
}

/* ── fresh core, at the settling point commission() derived ── */
/* ── where each bank stands: the ONE place that says so ──
   GANG: every bank follows the master position, biased by the tilt trim, which
   moves inner and outer banks opposite ways. SPLIT: each bank is its own actual
   and there is nothing to derive - but the 0..1 clamp still happens here, once,
   so no caller has to remember it. coreStep() only reads what this left behind.
   Declared as a function, not a const: top-level const is shared across these
   plain scripts with a TDZ, and core2d loads before its callers do. */
function rodBanks(s){
  for(let b=0;b<P.NB;b++)
    s.rodZ[b]=clamp(s.split ? s.rodZ[b] : s.rodPos+P.bankW[b]*XTILTZ*s.tilt, 0, 1);
}

function coreReset(s){
  s.phi =new Float64Array(XNN).fill(1);
  s.xI  =new Float64Array(XNN); s.xX=new Float64Array(XNN);
  s.nTf =new Float64Array(XNN); s.nTc=new Float64Array(XNN);
  s.nV  =new Float64Array(XNN); s.nRho=new Float64Array(XNN);
  s.nVt =new Float64Array(XNN);
  s.nCov=new Float64Array(XNN); s.nFol=new Float64Array(XNN);
  /* ── HOW THE FUEL IS HURT, NODE BY NODE ──
     Three MONOTONIC integrals, and a stage is derived off them rather than
     stored (fuelStage(), below). Monotonic buys three things at once:
     "permanent" is a property of the integrator instead of a Math.min bolted
     onto a scalar, a restore lands exactly where the snapshot was, and the
     ordering - no melt before burst - is enforceable at the integrator.
     Float64Array specifically, because snapVal() (record.js) accepts scalar,
     Float64Array, Array or plain object and THROWS on anything else.
       nDmg   fraction of the pins at this node that have burst, 0..1
       nOx    oxide grown on an average pin here, metres. A NODE MEAN, so it
              cannot tell a uniformly thin node from a half-consumed one - as
              coarse as the mesh, the same limit s.TfHot has.
       nMelt  fraction of the pellet melted, 0..1 */
  s.nDmg=new Float64Array(XNN); s.nOx=new Float64Array(XNN);
  s.nMelt=new Float64Array(XNN);
  s.chW =new Float64Array(XNR).fill(1);
  /* Every P.NB-sized allocation lives here, because a bench change to nbank
     re-runs coreConst() and then resetPlant() -> coreReset(), so sizes can
     never go stale. Demand starts equal to actual, per bank, or the plant
     walks off its own commissioning point on tick one. */
  s.rodZ   =new Float64Array(P.NB).fill(s.rodPos);
  s.rodZDem=new Float64Array(P.NB).fill(s.rodPos);
  s.bankAuto=new Array(P.NB).fill(true);
  s.tilt=0; s.tiltDem=0; s.ao=0; s.ro=0; s.hotRing=0; s.hotLev=0; s.vNode=0;
  s.hotFlow=1; s.tipRho=0; s.TfHot=P.TfRef;
  /* the aggregates the field hands back, and the readouts that go with them.
     s.h2 is the only integral here; the rest are re-measured every tick. */
  s.h2=0; s.meltFrac=0; s.oxMax=0; s.qOx=0; s.TcladHot=P.Tref;
  s.dnbrMin=P.dnbr0; s.dnbrRing=0; s.dnbrLev=0;
  for(let k=0;k<XNN;k++){
    s.xI[k]=ioEq(P.n0); s.xX[k]=P.X0;
    s.nTc[k]=P.Tref; s.nTf[k]=P.TfRef;
  }
  /* settle the shape once, properly, so the first tick does not start from a
     flat core and kick a transient nobody asked for */
  rodShape(P,s,s.nCov,s.nFol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    s.nRho[k]=-P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]-P.poison*(P.poiG[i]-1)
             -P.nPen[i]+P.enrRho[i]; }
  coreSolve(P,s.phi,s.nRho,60);
  s.fq=nodePeak(s.phi).v;
  /* ══ AND THE POISON IS THE NODE'S OWN, NOT THE CORE MEAN ══
     P.X0 is the equilibrium of the AVERAGE node, and the flux is peaked - so a
     flat field is over-poisoned exactly where the flux is highest, and the
     reactivity is flux-weighted. The difference burns out on its own: measured
     on WINDSCALE, +106 pcm in ten seconds at the 400x xenon clock, which the
     rod controller answered and rode into the flux trip with nobody touching a
     control. Seeded HERE rather than above because it needs the settled shape,
     which the solve on the line before is what produces. */
  for(let k=0;k<XNN;k++){ const fl=P.n0*s.phi[k];
    s.xI[k]=ioEq(fl); s.xX[k]=xeEq(fl); }
  /* ── THE ONE CONSTANT THE PIN BALANCE IS FITTED WITH ──
     P.pinUA is the film conductance of the whole core at rated flow, and it is
     read off the settled shape at ONE anchor: the flux-weighted mean fuel
     temperature of a plant at rest is P.TfRef, which is the figure Doppler,
     the HIGH FUEL TEMP trip and the damage threshold were every one of them
     calibrated against. That is where pk2 went - absorbed once, here, into a
     commissioning constant, instead of being applied every tick to stop a
     power-proportional guess double-counting its own peak. A balance has no
     such problem; a flux-weighted mean is just a flux-weighted mean.
     P.condK is inside it, which is what its name always claimed: a
     conductivity, not a scale on a guess. */
  { let pk2=0; for(let k=0;k<XNN;k++) pk2+=nodeW[k]*s.phi[k]*s.phi[k];
    /* AT THE FILM THIS PLANT ACTUALLY HAS. P.flowK alone is the film at
       s.flowNet exactly 1 - the ISOTHERMAL reference, with no buoyancy in it -
       and what coreStep() prices the pellet against every tick is
       mflux = P.flowK * s.flowNet. On a pressurised plant those agree to a
       percent. On one whose buoyancy is a real fraction of its drive they do
       not: WINDSCALE circulates at 1.46 times reference, so its pellets
       commissioned 200 K above the balance the tick then held them to, and the
       1400 pcm of Doppler that unwound as they cooled ran it onto its flux
       trip in under a second. Anchoring HERE keeps every calibrated figure
       intact - the mean pellet of a plant at rest is still exactly P.TfRef, so
       Doppler, the fuel trip and the damage threshold all still read against
       the number they were fitted against, and S.boron's balance still lands
       on critical. */
    const film0=Math.pow(Math.max(P.flowK*(s.flowNet||1),.02),0.8);
    /* ON THE DESIGN'S OWN REST POINT, never on the seeded state. This is a fit
       for the PIN - a property of the machine, not of the power it happens to
       be at - and a plant commissioned shut down (no vessel on the drawing, so
       seedPower() seeds it cold) made pinUA zero, qhat 0/0, and put a NaN in
       every pellet temperature and every Doppler term. Identical to
       s.n/s.decay for any plant seeded at P.n0, which is every plant that has
       a reactor on it. */
    const heat0=P.n0*(PROMPT_F+DEC_A.reduce((t,a)=>t+a,0));
    P.pinUA=heat0*P.rated*1000*Math.max(pk2,1e-6)
           /(film0*Math.max(P.TfRef-P.Tref,1)*P.condK);
    /* ── AND WHERE THE CLAD SITS INSIDE THAT DROP ──
       There is no clad node in this model: `film` above is the WHOLE pellet-
       to-coolant conductance, so nothing here knows the clad's temperature -
       and every failure criterion worth having is about the clad, not the
       pellet. A stock HTGR rests at 1373 K of pellet against UO2's tdmg of
       1500, so hanging a criterion on the pellet would put the helium core one
       step from failing at commissioning.

       So the drop is split in series: a FIXED solid conductance (pellet, gap
       and clad wall) and the LIVE film. P.gSolid is fitted ONCE here, in the
       P.pinUA idiom, against a stated reference clad rise - and CLAD_DT0 is
       real, 30 K is what a PWR rod's outside sits above its coolant at power.
       The whole point is what happens away from that anchor: as the film
       collapses on a dry node the split goes to 1 and the clad rides at the
       pellet's own temperature, which is the only reason a clad criterion can
       fire at all. IT IS A FIT AND IT SAYS SO; if a single linear split ever
       reads wrong, the replacement is a real two-node pellet/clad balance,
       not a second coefficient here. */
    const r=clamp(CLAD_DT0/Math.max(P.TfRef-P.Tref,1),.01,.6);
    P.gSolid=r*film0/(1-r);
    /* and start every pellet where that balance puts it, or tick one is a
       transient nobody caused */
    /* THE FIT IS AT THE REST POINT; THE PELLETS START AT THE POWER THIS PLANT
       IS ACTUALLY SEEDED AT. Two different quantities that were sharing one
       name: a plant seeded shut down still had every pellet placed at full
       power, 340 K above its own coolant. Identical for any plant seeded at
       P.n0, which is every plant that has a reactor on it. */
    const qhat=(s.n*PROMPT_F+s.decay)*P.rated*1000/P.pinUA;
    for(let k=0;k<XNN;k++) s.nTf[k]=s.nTc[k]+qhat*s.phi[k]/film0; }
}

/* ── A STAGE IS DERIVED, NEVER STORED ──
   One predicate over the three integrals, ordered worst first, and it is the
   ONLY place a node is named. FAIL (step.js) is the table it indexes; adding a
   stage is adding a row there and a branch here, and nothing else in the game
   branches on a stage id at all. */
function fuelStage(s,k){
  if(s.nMelt[k]>0) return 3;
  if(ecrOf(s.nOx[k])>=OX_ECR_FAIL) return 2;
  if(s.nDmg[k]>0) return 1;
  return 0;
}
/* How much of the core is in each stage, by volume. The release term and the
   panel both read this, so a picture and a consequence cannot disagree. */
function fuelStages(s){
  const o=new Float64Array(FAIL.length);
  for(let k=0;k<XNN;k++) o[fuelStage(s,k)]+=nodeW[k];
  return o;
}

/* Flux-weighted worth of the bank exactly where it is standing. resetPlant()
   uses it to set the boron that makes this core critical: with rod worth now
   emergent, guessing it from a formula would leave the plant off-critical at
   commissioning and walk it into a trip nobody caused. */
function coreRodWorth(s){
  let w=0;
  for(let k=0;k<XNN;k++)
    w+=nodeW[k]*s.phi[k]*(-P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]);
  return w;
}

/* ── one tick of the core as a place ──
   step() has already worked out the loop conditions; this spends them node by
   node and hands back the flux-weighted reactivity that point kinetics needs.
   The field it leaves behind is what the renderer draws. */
function coreStep(s,dt,heat,sat,vLeak,mflux,flowFrac){
  /* Where the banks stand is settled by the rod drives in step(), through
     rodBanks(). This function only reads it. */

  /* ── parallel channels: steam costs pressure drop, so a voiding channel
        loses the very flow it needed to stop voiding. That runaway is what
        the Chernobyl test walked into, and a one-number core cannot host it.

        The STRENGTH of it used to be a typed 8 against void. It is the
        homogeneous two-phase friction multiplier now, phi2 = 1 + x*(1/rvl-1),
        and channels at equal pressure drop carry w proportional to
        1/sqrt(phi2) - the same shape, with the gain published rather than
        picked. Two things the 8 could not say fall out: it reads QUALITY,
        which is what the multiplier is defined on, and it reads rvl, so a
        depressurising core loses channel flow harder because the two
        densities have closed on each other. */
  { const rvl=satRvl(P.sat, s.pCore), rq=1/Math.max(rvl,1e-6)-1;
    let tot=0;
    for(let i=0;i<XNR;i++){
      let x=0; for(let j=0;j<XNZ;j++) x+=voidQual(s.nV[XIX(i,j)],rvl);
      s.chW[i]=1/Math.sqrt(1+rq*(x/XNZ));
      tot+=s.chW[i]*ringW[i];
    }
    for(let i=0;i<XNR;i++) s.chW[i]/=Math.max(tot,1e-6);
  }

  rodShape(P,s,s.nCov,s.nFol);
  /* ── THE RISE FIRST, THEN WHERE IT SITS ──
     T-AVG IS THE AVERAGE, and that has to hold every tick or the model eats
     itself: the rise responds to power inside one tick, so hanging the channel
     inlet off LAST tick's rise leaves the flux-weighted mean coolant
     temperature moving with power at -45 pcm/K, prompt. Measured: the plant
     oscillated tick to tick and diverged in a quarter of a second. Computing
     the rise first and centring the channel on s.Tavg makes the mean exactly
     s.Tavg whatever the rise is, which is what the split it replaces asserted
     by construction and what the word AVERAGE means.
     Capped, because past this the channel is boiling rather than getting
     hotter and the number stops being a temperature rise - it is buoyancy's
     one input and a floored flow would otherwise hand it thousands of kelvin. */
  const mixK=new Float64Array(XNR);
  { let raw=0;
    for(let i=0;i<XNR;i++){
      let ringP=0; for(let j=0;j<XNZ;j++) ringP+=s.phi[XIX(i,j)];
      ringP=Math.max(ringP/XNZ,1e-6);
      mixK[i]=(1+(ringP-1)*(1-P.mix))/ringP;      // cross-flow, and it conserves
      raw += ringW[i]*heat*CORE_DT0*ringP*mixK[i]/Math.max(flowFrac,1e-3);
    }
    s.coreDT=clamp(raw,0,CORE_DT_MAX); }
  const Tcold=s.Tavg-s.coreDT/2;
  /* ── ENTHALPY UP A CHANNEL, AND THE PELLET AS A BALANCE ──
     Both of these used to be correlations wearing a field's clothes. Node
     coolant temperature was Tcold + 30*heat*frac, an imposed axial shape with
     no flow in it; fuel temperature was a 320 K scale over a made-up cooling
     fraction. They are two halves of one sentence now: the power in a node
     goes into the water going past it, and what is left over is in the pellet.

     qhat is the core's power in the units the pin balance wants - kelvin of
     film difference per unit of flux - so P.pinUA never appears again below.
     dTn is the rise one node of a channel carrying its own share of RATED flow
     takes at rated power, so an undamaged core at rest lands exactly where the
     correlation left it. */
  const qhat  = heat*P.rated*1000/Math.max(P.pinUA,1e-9);
  const ff    = Math.max(flowFrac, 1e-3);
  const hSat  = CP_W*sat;                    // enthalpy at saturation, kJ/kg
  const rvl   = satRvl(P.sat, s.pCore);             // the core boils at ITS OWN pressure
  /* what the damage pass hands back: the worst node margin and where, the
     hottest clad, the deepest oxide, and the hydrogen this tick made. None of
     the margins are STORED - a node margin field is a pure function of this
     tick, so it is resolved fresh and thrown away, exactly as the radiation
     field is. Only the integrals go on S. */
  let dnbLo=1e30, dnbK=0, TclH=0, ecrH=0, h2=0, oxP=0;
  const dhSub=CP_W*(sat-Tcold);
  /* ── node by node: heat it, boil it, poison it ── */
  for(let i=0;i<XNR;i++){
    const chan=Math.max(s.chW[i],1e-3);
    /* This channel's own flow, as a share of what it would carry at rated: the
       heat has to go into the water actually in THIS channel, which is the
       whole of the voiding-channel runaway. */
    const dTn=heat*CORE_DT0*mixK[i]/(XNZ*ff*chan);   // K of rise per node at phi = 1
    /* and the flux past the pin in this channel, which is a different question
       from how much water is passing - see s.hotFlow */
    const film0=Math.pow(Math.max(mflux*chan,0),0.8);
    /* the same water as a MASS FLUX rather than a film - Saha-Zuber's G, and
       the one branch of it that divides by it */
    const gCh=Math.max(mflux*chan,1e-3);
    let h=CP_W*Tcold;
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), pw=s.phi[k];
      const dh=CP_W*dTn*pw;                  // this node's own enthalpy rise
      const hMid=h+dh/2; h+=dh;              // the node sits at its own midpoint
      /* Subcooled water gets hotter; saturated water gets steamier. Quality
         only ever increases going up a heated channel, which falls out of
         carrying the enthalpy rather than being asserted. */
      if(hMid<=hSat) s.nTc[k]=hMid/CP_W;
      else         { s.nTc[k]=sat; }
      /* VOID STARTS BEFORE THE BULK DOES. xe is the thermodynamic quality and
         is negative while subcooled; xd is where vapour first detaches, off
         whichever Saha-Zuber branch this channel is actually on. Floored so a
         core making no heat at all cannot divide by zero. */
      const q2=Math.max(heat*pw,0);
      const xd=-Math.max(Math.min(P.xSub*q2/gCh, P.xSubLo*q2), 1e-6);
      const xe=(hMid-hSat)/P.hfg;
      s.nVt[k]=driftFlux(subQual(xe, xd), rvl);

      /* ── HOW THIS NODE IS FAILING ──
         Everything below runs on locals the loop already had. The margin is
         MEASURED here rather than peaked: the rise is the enthalpy actually
         carried to this node, which closes the stated gap where the boil law
         was reading a flux peaking factor in place of an enthalpy-rise one.
         The minimum this pass finds IS s.dnbr (step.js): the plant has no
         second margin arithmetic left to disagree with. */
      const dnb=marginNode(s,heat,pw,hMid/CP_W-Tcold,Tcold,s.nTf[k],
                           mflux*chan,xe,dhSub);
      if(dnb<dnbLo){ dnbLo=dnb; dnbK=k; }

      /* THE PELLET IS A HEAT BALANCE. Power in, film out, and the film
         collapses when the node goes dry - so a dry node has nowhere to put
         its heat and climbs on its own heat capacity until it melts, which is
         the real accident and was not reachable at all while a cap and a floor
         stood between the two. The clamp is numerical headroom well past melt,
         not a modelling choice. Void is not the only way to lose the film:
         dnbFilmK() (step.js) is departure itself, which is why the margin is
         measured first. */
      const film=film0*(1-clamp(s.nV[k],0,1))*dnbFilmK(dnb);

      const Tcl=s.nTc[k]+(s.nTf[k]-s.nTc[k])*P.gSolid/(P.gSolid+film);
      if(Tcl>TclH) TclH=Tcl;

      /* ── OXIDATION, AND THE HEAT IT MAKES ──
         Squared thickness, closed form, so the step is exact and needs no
         floor at zero. A BURST pin has steam on both faces, so the growth
         doubles - one multiply, and it is what makes the runaway accelerate
         rather than merely continue. */
      /* dt>0: a commissioning pass steps nothing, so the oxide grows by
         exactly 0 and the power that freed it is 0/0 - a NaN in the pellet,
         and through nRho in every reactivity term the plant has. */
      let qOx=0;
      if(dt>0 && P.oxid && Tcl>OX_T0 && s.nV[k]>OX_VMIN && ecrOf(s.nOx[k])<1){
        const o0=s.nOx[k];
        /* clamped at the wall it is eating, or one step of a runaway steps
           straight past it and ECR - which the readout states as a percentage
           of the drawn thickness - reads over 100 % */
        s.nOx[k]=Math.min(ZR_PBR*ROD_CLAD,
          Math.sqrt(o0*o0+oxRate(Tcl)*(1+s.nDmg[k])*dt));
        /* the metal that oxide ate, as a mass and as the power that freed it.
           nodeW cancels: a node's own power in the balance's currency is
           W/(nodeW[k]*P.pinUA), and this node's share of the rod surface is
           P.aHeat*nodeW[k]. Getting that cancellation wrong one way makes the
           term invisible and the other way melts every water core in a tick. */
        const dm=ZR_RHO*(s.nOx[k]-o0)/ZR_PBR*P.aHeat*nodeW[k];
        h2 += ZR_H2*dm;
        qOx = ZR_QOX*dm/(1000*dt*nodeW[k]*Math.max(P.pinUA,1e-9));
      }
      { const e=ecrOf(s.nOx[k]); if(e>ecrH) ecrH=e; }
      oxP+=qOx*nodeW[k];

      // at dt 0 the pellet's algebra is its own balance, so a commissioning pass seeds it at the film it will actually see
      let Tn=dt>0 ? s.nTf[k]+(qhat*pw+qOx-film*(s.nTf[k]-s.nTc[k]))*dt/xTauF()
                  : s.nTc[k]+(qhat*pw+qOx)/Math.max(film,1e-9);
      /* ── MELT IS PAID FOR IN LATENT HEAT ──
         A node at tmelt absorbs power WITHOUT rising until its heat of fusion
         is bought, and then rises again, so the melt plateau falls out instead
         of being a rate. It cannot start before the clad has failed, which is
         physically true and is what makes s.meltFrac <= s.dmg/100 a theorem
         rather than a coincidence the melt latch relies on. */
      if(Tn>P.tmelt && s.nDmg[k]>=1 && s.nMelt[k]<1){
        const room=(1-s.nMelt[k])*FUSE_DT, paid=Math.min(Tn-P.tmelt,room);
        s.nMelt[k]=Math.min(1,s.nMelt[k]+paid/FUSE_DT);
        Tn=P.tmelt+(Tn-P.tmelt-paid);
      }
      s.nTf[k]=clamp(Tn,0,6000);

      /* ── AND WHETHER IT HAS BURST ──
         Two ways in, and both are measured: the clad balloons out against its
         own fill gas past burstT()'s stress curve, or the oxide has eaten the
         whole wall and there is no clad left to hold anything. Clamped at 1 at
         the integrator, because the aggregate is a PERCENTAGE and six readers
         lie at once if it ever runs past. */
      if(ecrOf(s.nOx[k])>=1) s.nDmg[k]=1;
      else {
        const dP=P_FILL*Tcl/T_FILL-s.pCore, tb=burstT(dP);
        if(Tcl>tb) s.nDmg[k]=Math.min(1,
          s.nDmg[k]+clamp((Tcl-tb)/BURST_SPAN,0,1)*dt/BURST_TAU);
      }

      /* local xenon on local flux. A node running hard burns its own poison
         away while a quiet one keeps making more, and the difference is a
         reactivity gradient that moves the flux - which is the oscillation. */
      const fl=s.n*pw;
      s.xI[k]=Math.max(0,s.xI[k]+(P.gI*fl-P.lamI*s.xI[k])*dt);
      s.xX[k]=Math.max(0,s.xX[k]+(P.gX*fl+P.lamI*s.xI[k]-P.lamX*s.xX[k]
              -P.sig*fl*s.xX[k])*dt);

      s.nRho[k]=clamp(P.aF*(s.nTf[k]-P.TfRef),-6000,3000)
               +clamp(P.aM*(s.nTc[k]-P.Tref),-6000,2500)
               +clamp(P.aX*(s.nTf[k]-P.TfRef)+P.aS*(s.nTc[k]-P.Tref),-6000,2500)
               +P.aV*s.nV[k]-P.KXE*s.xX[k]
               -P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]
               -P.poison*(P.poiG[i]-1)
               -P.nPen[i]+P.enrRho[i];
    }
  }

  /* THE RESCALE IS GONE. s.vf was a 0-D correlation with the field's shape
     painted on it (sc = vLump/raw); it is the volume-weighted mean of a real
     field now, and so is nothing else. A void fraction is still a fraction -
     vLeak runs past 1 on purpose, so s.vf can say HOW far past empty the loop
     is, but a node cannot be more than all steam.

     The lag is TRANSPORT, and it is now measured as transport: the time a
     parcel takes to cross the core, core height over the coolant's own
     velocity, G/rho. It used to be a typed 1.5 s with no length and no
     velocity behind it, and it could not say the one thing that matters -
     a coasting pump moves water slower, so the void it makes arrives slower.
     Bounded well either side of anything a plant reaches; a stopped pump
     would otherwise divide by zero. */
  { const v=Math.max(mflux,1e-3)*P.G0/Math.max(rhoAt(s.Tavg),1);
    const tau=clamp(Math.max(P.coreHgt,.05)/Math.max(v,1e-3),0.1,60);
    for(let k=0;k<XNN;k++){
      const vT=clamp(Math.max(s.nVt[k],vLeak),0,1);
      s.nV[k]+=(vT-s.nV[k])*dt/tau;
    } }

  coreSolve(P,s.phi,s.nRho);

  /* ── what the rest of the sim gets back ── */
  const o={dop:0,mod:0,exp:0,vd:0,xe:0,rod:0,tip:0};
  let X=0,I=0,V=0,Tf=0,TfH=0,top=0,bot=0,inn=0,out=0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const k=XIX(i,j), v=nodeW[k], w=v*s.phi[k];
    /* flux weighted: a poisoned corner of a dead core does not get a vote */
    o.dop+=w*clamp(P.aF*(s.nTf[k]-P.TfRef),-6000,3000);
    o.mod+=w*clamp(P.aM*(s.nTc[k]-P.Tref),-6000,2500);
    o.exp+=w*clamp(P.aX*(s.nTf[k]-P.TfRef)+P.aS*(s.nTc[k]-P.Tref),-6000,2500);
    o.vd +=w*P.aV*s.nV[k];
    o.xe +=w*-P.KXE*s.xX[k];
    o.rod+=w*-P.rodA*s.nCov[k];
    o.tip+=w*P.tipRho*s.nFol[k];
    X+=v*s.xX[k]; I+=v*s.xI[k]; V+=v*s.nV[k]; Tf+=w*s.nTf[k];
    if(s.nTf[k]>TfH) TfH=s.nTf[k];
    if(j>=XNZ/2) top+=w; else bot+=w;
    if(i< XNR/2)  inn+=w; else out+=w;
  }
  const hot=nodePeak(s.phi);
  s.fq=hot.v; s.hotRing=hot.i; s.hotLev=hot.j;
  s.ao=(top-bot)/Math.max(top+bot,1e-6);
  s.ro=(inn-out)/Math.max(inn+out,1e-6);
  s.X=X; s.I=I; s.Tf=Tf; s.TfHot=TfH; s.vNode=V; s.tipRho=o.tip;
  /* The hot channel is what burns out, not the core average - and burnout is a
     question of how fast the water is moving past the pin, not of how much heat
     left the loop. Those two are the same number while the pumps are running and
     nothing like it once they stop, so this reads mass flux, never the
     enthalpy rise. */
  s.hotFlow=Math.max(mflux*s.chW[s.hotRing],0.02);
  /* ── WHAT THE DAMAGE PASS LEFT BEHIND ──
     nodeW already sums to 1, so the two aggregates are plain volume means and
     s.dmg keeps its old meaning and its old range exactly. s.oxMax is stated
     as ECR rather than metres because that is the number the licensing limit
     is written in and the only one a reader can judge. */
  let dm=0, mf=0;
  for(let k=0;k<XNN;k++){ dm+=nodeW[k]*s.nDmg[k]; mf+=nodeW[k]*s.nMelt[k]; }
  s.dmg=Math.min(100,100*dm); s.meltFrac=mf;
  s.h2+=h2; s.oxMax=ecrH; s.TcladHot=TclH;
  /* what the metal is making, as a share of rated - the one number that says
     whether this is corrosion or a runaway, and the comparison the event log
     puts it against is the chain reaction's own output */
  s.qOx=oxP*P.pinUA/Math.max(P.rated*1000,1e-9);
  s.dnbrMin=dnbLo; s.dnbrRing=(dnbK/XNZ)|0; s.dnbrLev=dnbK%XNZ;
  return o;
}
