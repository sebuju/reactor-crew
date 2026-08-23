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
const SOR_SWEEPS=6, SOR_OM=1.5;

/* The three numbers here are fitted rather than derived. XCOUP sets how
   tightly a node talks to its neighbours, and so how far a local disturbance
   travels before the rest of the core notices. XPG is how hard burnable
   poison grades toward the centre. XRINF is how many rings one bank reaches. */
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
const XDRY=0.015;    // the least cooling the fuel-temperature correlation will assume

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
  const Lm=0.21*Math.sqrt(D.pitch);
  T.cz=XCOUP*Math.pow(Lm/(Math.max(T.coreHgt,.05)/XNZ),2);
  T.cr=XCOUP*Math.pow(Lm/(Math.max(T.coreDia,.05)/2/XNR),2);

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
  return T;
}

/* peaking of a cold, xenon-free, unvoided core with the bank at x. The bench
   readout and the calibration use it; the live sim never does. */
function coreFq(T,x){
  const phi=new Float64Array(XNN).fill(1), rho=new Float64Array(XNN);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN);
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    rho[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-T.poison*(T.poiG[i]-1)-T.nPen[i]; }
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
  const sig=[D.arch,D.fuel,D.refl,D.poison,D.pitch,D.hd,D.power,
             D.rodw,D.nbank,D.foll,latRev].join(",");
  if(sig!==fqSig){ fqSig=sig; fqVal=coreConst({},d); }
  return fqVal;
}

/* Everything the renderer needs, from the live core if there is one and from
   the predicted one if the plant has not been built yet. One accessor, so the
   bench and the panel cannot drift apart. */
function coreView(L){
  if(L && L.phi) return {phi:L.phi,nV:L.nV,xX:L.xX,nTf:L.nTf,rodZ:L.rodZ,
    bankR:P.bankR,NB:P.NB,tipLen:P.tipLen,tipRho:P.tipRho,TfRef:P.TfRef,X0:P.X0,
    dia:P.coreDia,hgt:P.coreHgt,frac:P.frac,peak:{i:L.hotRing,j:L.hotLev},
    reflR:P.reflR,reflT:P.reflT,reflB:P.reflB,reflMat:P.reflMat};
  const T=corePredict(derived());
  return {phi:T.phiCold,nV:null,xX:null,nTf:null,rodZ:null,
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
  s.chW =new Float64Array(XNR).fill(1);
  /* Every P.NB-sized allocation lives here, because a bench change to nbank
     re-runs coreConst() and then resetPlant() -> coreReset(), so sizes can
     never go stale. Demand starts equal to actual, per bank, or the plant
     walks off its own commissioning point on tick one. */
  s.rodZ   =new Float64Array(P.NB).fill(s.rodPos);
  s.rodZDem=new Float64Array(P.NB).fill(s.rodPos);
  s.bankAuto=new Array(P.NB).fill(true);
  s.tilt=0; s.tiltDem=0; s.ao=0; s.ro=0; s.hotRing=0; s.hotLev=0; s.vNode=0;
  s.hotFlow=1; s.tipRho=0;
  for(let k=0;k<XNN;k++){
    s.xI[k]=P.gI*P.n0/P.lamI; s.xX[k]=P.X0;
    s.nTc[k]=P.Tref; s.nTf[k]=P.TfRef;
  }
  /* settle the shape once, properly, so the first tick does not start from a
     flat core and kick a transient nobody asked for */
  rodShape(P,s,s.nCov,s.nFol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    s.nRho[k]=-P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]-P.poison*(P.poiG[i]-1)
             -P.nPen[i]; }
  coreSolve(P,s.phi,s.nRho,60);
  s.fq=nodePeak(s.phi).v;
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
function coreStep(s,dt,feff,heat,sat,vLeak,mflux){
  /* Where the banks stand is settled by the rod drives in step(), through
     rodBanks(). This function only reads it. */

  /* ── parallel channels: steam costs pressure drop, so a voiding channel
        loses the very flow it needed to stop voiding. That runaway is what
        the Chernobyl test walked into, and a one-number core cannot host it. */
  { let tot=0;
    for(let i=0;i<XNR;i++){
      let v=0; for(let j=0;j<XNZ;j++) v+=s.nV[XIX(i,j)];
      s.chW[i]=1/Math.sqrt(1+8*(v/XNZ));
      tot+=s.chW[i]*ringW[i];
    }
    for(let i=0;i<XNR;i++) s.chW[i]/=Math.max(tot,1e-6);
  }

  const Tcold=s.Tavg-15*heat;
  rodShape(P,s,s.nCov,s.nFol);
  /* Fuel temperature rises with LOCAL power, so the hot node genuinely runs
     hotter - that is the whole point, and DNBR and damage need it. But
     Doppler is felt flux-weighted, and weighting a power-proportional rise by
     power again would double-count the peak and make every core far more
     self-limiting than the plant it was calibrated against. Normalising by
     the mean square keeps the flux-weighted effective fuel temperature equal
     to the lumped one, and keeps the spread around it. */
  let pk2=0; for(let k=0;k<XNN;k++) pk2+=nodeW[k]*s.phi[k]*s.phi[k];
  pk2=Math.max(pk2,1e-6);

  /* ── node by node: heat it, boil it, poison it ── */
  for(let i=0;i<XNR;i++){
    /* XDRY is the smallest cooling the correlation will pretend exists. It used
       to be 0.10 in the fuel-temperature line below, which quietly capped an
       uncovered core at a few tens of kelvin above its coolant and made a dry
       core impossible to damage. It never binds on a plant that has water. */
    const fRing=Math.max(feff*s.chW[i],XDRY);
    let ringP=0; for(let j=0;j<XNZ;j++) ringP+=s.phi[XIX(i,j)];
    ringP=Math.max(ringP,1e-6);
    /* Rise across THIS channel. The core-average rise is already paid for by
       feff in the heat balance, so what matters here is only how this channel
       compares to its neighbours - divide by absolute flow too and every
       channel runs hot at part load. */
    const dTch=30*heat/Math.max(s.chW[i],0.05);
    let below=0, vCh=0;
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), pw=s.phi[k];
      /* how much of this channel's heat is already in the water by level j -
         the top of a channel is always its hot end */
      const frac=(below+pw/2)/ringP; below+=pw;
      s.nTc[k]=Tcold+dTch*frac;

      /* Steam quality only ever increases going up a heated channel: water
         that boiled at level 3 is still steam at level 7. Carrying the
         running value up the channel is what makes a boiling channel void
         along its whole top half instead of in one node. */
      const boil=clamp((s.nTc[k]-(sat-3))/14,0,1);
      vCh=Math.max(vCh,clamp(boil*clamp(s.n*pw/fRing,0,2.5)*0.5,0,1));
      s.nVt[k]=vCh;

      /* UO2 melts at about 3120 K. Past that the pellet is a puddle and its
         "temperature" stops being a number the plant can act on, so the
         correlation is capped there rather than being allowed to report the
         six thousand kelvin that dividing by a dry channel produces. */
      const TfT=Math.min(3200, s.nTc[k]+320*P.condK*((s.n*0.935+s.decay)*pw/pk2)/fRing
                *(1+4.0*s.nV[k]));
      s.nTf[k]+=(TfT-s.nTf[k])*dt/4;

      /* local xenon on local flux. A node running hard burns its own poison
         away while a quiet one keeps making more, and the difference is a
         reactivity gradient that moves the flux - which is the oscillation. */
      const fl=s.n*pw;
      s.xI[k]=Math.max(0,s.xI[k]+(P.gI*fl-P.lamI*s.xI[k])*dt);
      s.xX[k]=Math.max(0,s.xX[k]+(P.gX*fl+P.lamI*s.xI[k]-P.lamX*s.xX[k]
              -P.sig*fl*s.xX[k])*dt);

      s.nRho[k]=clamp(P.aF*(s.nTf[k]-P.TfRef),-6000,3000)
               +clamp(P.aM*(s.nTc[k]-P.Tref),-6000,2500)
               +P.aV*s.nV[k]-P.KXE*s.xX[k]
               -P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]
               -P.poison*(P.poiG[i]-1)
               -P.nPen[i];
    }
  }

  /* The field decides WHERE steam is; the 0-D correlation still decides HOW
     MUCH, because that is the number every trip, alarm and coefficient in
     this plant was calibrated against. A lumped core treats the whole volume
     as sitting at hot-leg temperature, which a real one never does, so the
     raw field always averages lower - scale it back onto the calibrated mean
     and the shape survives with the magnitude intact. The pin is by volume,
     because s.vf is a volume average and every threshold reads that. */
  { const Th=s.Tavg+15*heat;
    const vLump=clamp(clamp((Th-(sat-3))/14,0,1)
                *clamp(heat/Math.max(feff,.10),0,2.5)*0.5,0,1);
    let raw=0; for(let k=0;k<XNN;k++) raw+=nodeW[k]*s.nVt[k];
    const sc=raw>1e-4 ? clamp(vLump/raw,0,6) : (vLump>1e-4?6:0);
    for(let k=0;k<XNN;k++){
      /* A void fraction is a fraction: a node can be all steam and no more.
         vLeak runs past 1 on purpose - s.vf uses the overshoot to say HOW far
         past empty the loop is - but the node field is a real fraction, and
         letting 3.8 through here multiplied fuel temperature by seventeen. */
      const vT=clamp(Math.max(Math.min(s.nVt[k]*sc,1),vLeak),0,1);
      s.nV[k]+=(vT-s.nV[k])*dt/1.5;
    }
  }

  coreSolve(P,s.phi,s.nRho);

  /* ── what the rest of the sim gets back ── */
  const o={dop:0,mod:0,vd:0,xe:0,rod:0,tip:0};
  let X=0,I=0,V=0,Tf=0,top=0,bot=0,inn=0,out=0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const k=XIX(i,j), v=nodeW[k], w=v*s.phi[k];
    /* flux weighted: a poisoned corner of a dead core does not get a vote */
    o.dop+=w*clamp(P.aF*(s.nTf[k]-P.TfRef),-6000,3000);
    o.mod+=w*clamp(P.aM*(s.nTc[k]-P.Tref),-6000,2500);
    o.vd +=w*P.aV*s.nV[k];
    o.xe +=w*-P.KXE*s.xX[k];
    o.rod+=w*-P.rodA*s.nCov[k];
    o.tip+=w*P.tipRho*s.nFol[k];
    X+=v*s.xX[k]; I+=v*s.xI[k]; V+=v*s.nV[k]; Tf+=w*s.nTf[k];
    if(j>=XNZ/2) top+=w; else bot+=w;
    if(i< XNR/2)  inn+=w; else out+=w;
  }
  const hot=nodePeak(s.phi);
  s.fq=hot.v; s.hotRing=hot.i; s.hotLev=hot.j;
  s.ao=(top-bot)/Math.max(top+bot,1e-6);
  s.ro=(inn-out)/Math.max(inn+out,1e-6);
  s.X=X; s.I=I; s.Tf=Tf; s.vNode=V; s.tipRho=o.tip;
  /* The hot channel is what burns out, not the core average - and burnout is a
     question of how fast the water is moving past the pin, not of how much heat
     left the loop. Those two are the same number while the pumps are running and
     nothing like it once they stop, so this reads mass flux, never feff. */
  s.hotFlow=Math.max(mflux*s.chW[s.hotRing],0.02);
  return o;
}
