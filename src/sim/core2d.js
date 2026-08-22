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
  /* real dimensions, so H/D stops being a fitted peaking term and becomes a
     shape. Volume is rated power over power density. */
  const vol=D.power/d.dens;                 // MW over kW/L is m3 exactly
  const dia=Math.cbrt(4*vol/(Math.PI*Math.max(D.hd,.05)));
  T.coreDia=dia; T.coreHgt=D.hd*dia;

  /* migration length against node size gives the coupling. A tight lattice
     under-moderates, which lengthens it and binds the core together; an open
     lattice lets one corner of the core drift on its own. */
  const Lm=0.21*Math.sqrt(D.pitch);
  T.cz=XCOUP*Math.pow(Lm/(T.coreHgt/XNZ),2);
  T.cr=XCOUP*Math.pow(Lm/((dia/2)/XNR),2);

  /* the reflector stops being a flat pcm bonus and starts reflecting: the
     share of what leaks out of an edge node that finds its way back in */
  T.alb=Math.min(0.90,0.53+0.40*Math.min(1,d.rf.dRho/750));

  /* burnable poison graded toward the centre, normalised so the core-average
     worth is still exactly D.poison - it buys flatness, not reactivity */
  T.poiG=new Float64Array(XNR);
  { let s=0;
    for(let i=0;i<XNR;i++){ T.poiG[i]=1+XPG*(1-2*i/(XNR-1)); s+=T.poiG[i]*ringW[i]; }
    for(let i=0;i<XNR;i++) T.poiG[i]/=s; }
  T.poison=D.poison;

  /* banks spread by area, not radius, so the outer ones cover the rings that
     hold most of the core */
  T.NB=D.nbank; T.bankR=[];
  for(let b=0;b<T.NB;b++) T.bankR.push(Math.round(Math.sqrt((b+.5)/T.NB)*(XNR-1)));
  T.rinf=Math.max(XRINF,XNR/T.NB);

  const fo=FOLL[D.foll];
  T.tipRho=fo.tipRho; T.tipLen=fo.tipLen; T.follName=fo.name;

  /* Absorber strength is calibrated, not guessed. Drive the bank fully in,
     see what the flux-weighted worth comes to, and scale it so that equals
     the bank worth the bench sold you. Shutdown margin stays honest, and the
     S-curve on the way there stops being a formula and starts being a
     consequence of where the flux is. */
  T.rodA=1;
  const st={rodZ:new Float64Array(T.NB).fill(1)};
  const phi=new Float64Array(XNN).fill(1);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN), rho=new Float64Array(XNN);
  for(let pass=0;pass<3;pass++){
    rodShape(T,st,cov,fol);
    for(let k=0;k<XNN;k++) rho[k]=-T.rodA*cov[k];
    coreSolve(T,phi,rho,25);
    let w=0; for(let k=0;k<XNN;k++) w+=cov[k]*phi[k]*nodeW[k];
    T.rodA=D.rodw/Math.max(w,1e-3);
  }
  T.FqCold=coreFq(T,0.35);
  return T;
}

/* peaking of a cold, xenon-free, unvoided core with the bank at x. The bench
   readout and the calibration use it; the live sim never does. */
function coreFq(T,x){
  const phi=new Float64Array(XNN).fill(1), rho=new Float64Array(XNN);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN);
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    rho[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-T.poison*(T.poiG[i]-1); }
  coreSolve(T,phi,rho,60);
  T.phiCold=phi;
  return nodePeak(phi).v;
}

/* The bench asks this every frame while a slider is moving, and massWith()
   asks it once per option row on top of that, so it is cached on the design
   signature and only actually solved when the design changes. */
let fqSig=null, fqVal=null;
function corePredict(d){
  const sig=[D.arch,D.fuel,D.refl,D.poison,D.pitch,D.hd,D.power,
             D.rodw,D.nbank,D.foll].join(",");
  if(sig!==fqSig){ fqSig=sig; fqVal=coreConst({},d); }
  return fqVal;
}

/* Everything the renderer needs, from the live core if there is one and from
   the predicted one if the plant has not been built yet. One accessor, so the
   bench and the panel cannot drift apart. */
function coreView(L){
  if(L && L.phi) return {phi:L.phi,nV:L.nV,xX:L.xX,nTf:L.nTf,rodZ:L.rodZ,
    bankR:P.bankR,NB:P.NB,tipLen:P.tipLen,tipRho:P.tipRho,TfRef:P.TfRef,X0:P.X0};
  const T=corePredict(derived());
  return {phi:T.phiCold,nV:null,xX:null,nTf:null,rodZ:null,
    bankR:T.bankR,NB:T.NB,tipLen:T.tipLen,tipRho:T.tipRho,TfRef:0,X0:1};
}

/* ── where the absorber is, and what is hanging below it ── */
function rodShape(T,st,cov,fol){
  cov.fill(0); fol.fill(0);
  const rw=new Float64Array(XNR);
  for(let b=0;b<T.NB;b++) for(let i=0;i<XNR;i++)
    rw[i]+=Math.max(0,1-Math.abs(i-T.bankR[b])/T.rinf);
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
  for(let s=0;s<n;s++){
    for(let i=0;i<XNR;i++){
      const b=i*XNZ, fi=faceI[i], fo=faceO[i];
      const den=T.cr*(fi+fo)+2*T.cz+1;
      for(let j=0;j<XNZ;j++){
        const k=b+j;
        const In = i>0       ? phi[k-XNZ] : 0;             // centreline: mirror
        const Ou = i<XNR-1   ? phi[k+XNZ] : T.alb*phi[k];  // rim, floor and lid
        const Dn = j>0       ? phi[k-1]   : T.alb*phi[k];  // leak out, minus
        const Up = j<XNZ-1   ? phi[k+1]   : T.alb*phi[k];  // the reflected part
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
function coreReset(s){
  s.phi =new Float64Array(XNN).fill(1);
  s.xI  =new Float64Array(XNN); s.xX=new Float64Array(XNN);
  s.nTf =new Float64Array(XNN); s.nTc=new Float64Array(XNN);
  s.nV  =new Float64Array(XNN); s.nRho=new Float64Array(XNN);
  s.nVt =new Float64Array(XNN);
  s.nCov=new Float64Array(XNN); s.nFol=new Float64Array(XNN);
  s.chW =new Float64Array(XNR).fill(1);
  s.rodZ=new Float64Array(P.NB).fill(s.rodPos);
  s.tilt=0; s.ao=0; s.ro=0; s.hotRing=0; s.hotLev=0; s.vNode=0;
  s.hotFlow=1; s.tipRho=0;
  for(let k=0;k<XNN;k++){
    s.xI[k]=P.gI*P.n0/P.lamI; s.xX[k]=P.X0;
    s.nTc[k]=P.Tref; s.nTf[k]=P.TfRef;
  }
  /* settle the shape once, properly, so the first tick does not start from a
     flat core and kick a transient nobody asked for */
  rodShape(P,s,s.nCov,s.nFol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    s.nRho[k]=-P.rodA*s.nCov[k]+P.tipRho*s.nFol[k]-P.poison*(P.poiG[i]-1); }
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
function coreStep(s,dt,feff,heat,sat,vLeak){
  /* banks follow the master demand, biased by the tilt trim. Trim moves inner
     and outer banks opposite ways, and it is the only handle the operator has
     on a radial xenon tilt. */
  for(let b=0;b<P.NB;b++){
    const inner=P.bankR[b]<(XNR-1)/2 ? 1 : -1;
    s.rodZ[b]=clamp(s.rodPos+inner*0.15*s.tilt,0,1);
  }

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
    const fRing=Math.max(feff*s.chW[i],0.02);
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

      const TfT=s.nTc[k]+320*P.condK*((s.n*0.935+s.decay)*pw/pk2)/Math.max(fRing,.10)
                *(1+4.0*s.nV[k]);
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
               -P.poison*(P.poiG[i]-1);
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
      const vT=Math.max(Math.min(s.nVt[k]*sc,1),vLeak);
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
  /* the hot channel is what burns out, not the core average */
  s.hotFlow=Math.max(feff*s.chW[s.hotRing],0.02);
  return o;
}
