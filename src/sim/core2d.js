"use strict";
/* r-z: ring 0 is the centreline, level 0 the bottom, and rods enter from the top. */
const XNR=14, XNZ=10, XNN=XNR*XNZ;
const XIX=(i,j)=>i*XNZ+j;

const SOR_SWEEPS=6, SOR_OM=1.5;

/* coupling length, poison grading, bank reach */
const XCOUP=1.0, XPG=0.9, XRINF=2.2;
/* tilt spread as a share of core height; past ~0.35 the outer bank saturates */
const XTILTZ=0.30;
/* rod bank worth target, pcm; XABS0 is solved to it once */
const XRODW0=2600;
let XABS0=null;
/* fuel pin time constant, s */
const XTAU_F=4;
/* capacity goes as volume and film as surface, so the ratio is a diameter */
const xTauF=K=>XTAU_F*K.rodD/ROD_D0;
/* reference clad rise above coolant at rated power, K */
const CLAD_DT0=30;
/* what a covered rod sheds into still water, W/m2/K */
const H_POOL=2000;
/* Jens-Lottes wall superheat; water only, so coreStep()'s max() drops it far from boiling */
const JL_K=25, JL_P=6.2;
const jensLottes=(qpp,p)=>JL_K*Math.pow(Math.max(qpp,1)/1e6,0.25)*Math.exp(-p/JL_P);
/* drift-flux concentration parameter */
const XC0=1.13;
/* cross-flow; at a ceiling of 1 every channel takes the identical rise and the voiding runaway stops existing */
const XMIX0=0.55, XMIX_MAX=0.85;
/* Saha-Zuber low-Peclet coefficient; K_COOL is the coolant conductivity at the film, W/m/K */
const SZ_LO=0.0022, K_COOL=0.54;
/* Levy's profile fit, defined only above departure - below it the expression goes to 1 and then NaN */
const subQual = (xe,xd) => {
  if(xe<=xd) return 0;
  const E=Math.exp(xe/xd-1);
  return (xe-xd*E)/(1-xd*E);
};
const driftFlux = (x,rvl) => { const q=clamp(x,0,1);
  return q<=0 ? 0 : clamp(q/(XC0*(q+(1-q)*rvl)), 0, 1); };
/* driftFlux run backwards */
const voidQual = (v,rvl) => { const q=clamp(v,0,1);
  const den=1-q*XC0*(1-rvl);
  return den>1e-6 ? clamp(q*XC0*rvl/den, 0, 1) : 1; };

/* ring i is an annulus, so it is worth 2i+1 unit cells */
const ringW=new Float64Array(XNR), nodeW=new Float64Array(XNN);
const faceI=new Float64Array(XNR), faceO=new Float64Array(XNR);
(function(){
  let t=0; for(let i=0;i<XNR;i++) t+=2*i+1;
  for(let i=0;i<XNR;i++){
    ringW[i]=(2*i+1)/t;
    faceI[i]=i/(i+0.5); faceO[i]=(i+1)/(i+0.5);
    for(let j=0;j<XNZ;j++) nodeW[XIX(i,j)]=ringW[i]/XNZ;
  }
})();
const wMean=a=>{ let m=0; for(let k=0;k<XNN;k++) m+=a[k]*nodeW[k]; return m; };
/* one group: the adjoint is the flux, so a local reactivity is worth phi^2 */
const impW=(a,phi)=>{ let m=0,W=0;
  for(let k=0;k<XNN;k++){ const q=nodeW[k]*phi[k]*phi[k]; m+=a[k]*q; W+=q; }
  return W>0 ? m/W : 0; };
function nodePeak(a){ let v=-1e30,k=0;
  for(let q=0;q<XNN;q++) if(a[q]>v){ v=a[q]; k=q; }
  return {v,k,i:(k/XNZ)|0,j:k%XNZ}; }

/* T is P when commissioning, a scratch object when the bench is only predicting */
function coreConst(T,c,d){
  const M=latM(c); T.rodD=rodD(c);
  T.coreDia=M.dia; T.coreHgt=M.hgt;

  /* migration length: fitted shape, real magnitude - a stock water lattice reads 7.6 cm */
  const Lm=0.21*Math.sqrt(c.pitch);
  T.cz=XCOUP*Math.pow(Lm/(Math.max(T.coreHgt,.05)/XNZ),2);
  T.cr=XCOUP*Math.pow(Lm/(Math.max(T.coreDia,.05)/2/XNR),2);

  { const v=latVols(c);
    /* latVols()'s own cool term with the reference pitch put back, so at 1.0x the ratio is exactly 1 */
    const open0=v.nF*(LAT_P0*LAT_P0 - latRodFrac(c)*LAT_P0*LAT_P0);
    const solid=(v.nF+v.nM)>0 ? v.nM/(v.nF+v.nM) : 0;
    T.mix=open0>0 ? clamp(XMIX0*(v.cool/open0)*(1-solid), 0, XMIX_MAX) : 0; }

  { const B=latBundle(c), hgt=Math.max(T.coreHgt,.05), a=COOLANT[c.cool], hfg=a.hfg, cp=a.cp;
    T.hfg = hfg; T.dT0 = a.dT0;
    T.dh = B.dh;
    const nF=latVols(c).nF;
    T.aHeat=4*nF*B.aHeat*hgt;                      // whole core rod surface, m2
    T.aFlow=4*nF*B.aFlow;                          // whole core flow area, m2
    /* rated mass flux, kg/m2/s - W-3 wants a real G, not a share */
    T.G0=c.power*1000/(cp*a.dT0)/Math.max(T.aFlow,1e-9);
    const qpp=c.power*1e6/Math.max(T.aHeat,1e-6);
    /* the pool film as a share of the rated forced film, which drops CLAD_DT0 at qpp */
    T.filmPool=H_POOL*CLAD_DT0/Math.max(qpp,1);
    T.xSub  = 154*cp*a.dT0*(B.aFlow/(B.aHeat*hgt))/hfg;
    T.xSubLo= cp*(SZ_LO*qpp*T.dh/K_COOL)/hfg; }

  T.albR=latAlb(c.lat.reflR,d.rf);
  T.albT=latAlb(c.lat.reflT,d.rf);
  T.albB=latAlb(c.lat.reflB,d.rf);
  T.alb=(T.albR+T.albT+T.albB)/3;
  T.reflR=c.lat.reflR; T.reflT=c.lat.reflT; T.reflB=c.lat.reflB; T.reflMat=c.refl;

  /* normalised so the core-average worth is still exactly D.poison */
  T.poiG=M.poiG; T.poison=c.poison;
  T.nPen=M.nPen;
  /* FUEL[].excess is already pcm of core-average excess, so there is no coefficient to fit */
  T.enrRho=M.enrRho;
  T.frac=M.frac;

  T.NB=M.NB; T.bankR=M.bankR.slice();
  T.rinf=Math.max(XRINF,XNR/T.NB);
  T.rinfW=new Float64Array(XNR);
  for(let b=0;b<T.NB;b++) for(let i=0;i<XNR;i++)
    T.rinfW[i]+=Math.max(0,1-Math.abs(i-T.bankR[b])/T.rinf);
  /* centred so the weights sum to zero: an off-centre set would insert net reactivity */
  { const rm=T.bankR.reduce((a,r)=>a+r,0)/T.NB;
    const sp=Math.max(...T.bankR.map(r=>Math.abs(r-rm)));
    T.bankW=T.bankR.map(r=> sp>1e-9 ? -(r-rm)/sp : 0); }

  const fo=FOLL[c.foll];
  T.tipRho=fo.tipRho; T.tipLen=fo.tipLen; T.follName=fo.name;

  /* three passes over one warm-started flux: the flux moves when the absorber does */
  const st={rodZ:new Float64Array(T.NB).fill(1)};
  const phi=new Float64Array(XNN).fill(1);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN), rho=new Float64Array(XNN);
  const worth=a=>{
    let w=0;
    for(let pass=0;pass<3;pass++){
      rodShape(T,st,cov,fol);
      for(let k=0;k<XNN;k++) rho[k]=-a*cov[k];
      coreSolve(T,phi,rho,25);
      w=impW(cov,phi);
    }
    return w;
  };
  if(XABS0==null){
    /* iterated, not solved at a fixed a=1: that would calibrate against an almost unrodded core */
    let a=1;
    const p0=new Float64Array(XNN).fill(1);
    for(let pass=0;pass<3;pass++){
      rodShape(T,st,cov,fol);
      for(let k=0;k<XNN;k++) rho[k]=-a*cov[k];
      coreSolve(T,p0,rho,25);
      a=XRODW0/Math.max(impW(cov,p0),1e-3);
    }
    XABS0=a;
  }
  T.rodA=XABS0*ABSORB[c.lat.abs].k;
  c.rodw=Math.max(0,T.rodA*worth(T.rodA));
  T.FqCold=coreFq(T,RODX0);
  T.leak=coreLeak(T,T.phiCold);
  return T;
}

/* a mesh calibration, not a physical share */
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

/* peaking of a cold, xenon-free, unvoided core with the bank at x */
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

const FQ=new WeakMap();
function corePredict(c,d){
  /* latRev and zoneFuel are in the key because the drawing is an input that D cannot see. */
  const sig=[c.cool,c.mod,c.fuel,c.refl,c.poison,c.pitch,c.hd,c.power,
             c.rodw,c.nbank,c.foll,latM(c).rev,JSON.stringify(c.zoneFuel)].join(",");
  const h=FQ.get(c);
  if(h && h.sig===sig) return h.val;
  const val=coreConst({},c,d); FQ.set(c,{sig,val});
  return val;
}

function coreView(L,id){
  const cs=L && L.coreBy && L.coreBy[id], K=P && P.cores && P.cores[id];
  if(cs && K) return {phi:cs.phi,nV:cs.nV,xX:cs.xX,nTf:cs.nTf,rodZ:cs.rodZ,
    nDmg:cs.nDmg,nOx:cs.nOx,nMelt:cs.nMelt,nDisp:cs.nDisp,
    bankR:K.bankR,NB:K.NB,tipLen:K.tipLen,tipRho:K.tipRho,TfRef:K.TfRef,X0:K.X0,
    dia:K.coreDia,hgt:K.coreHgt,frac:K.frac,peak:{i:cs.hotRing,j:cs.hotLev},
    reflR:K.reflR,reflT:K.reflT,reflB:K.reflB,reflMat:K.reflMat};
  const T=corePredict(coreBag(id),derived(id));
  return {phi:T.phiCold,nV:null,xX:null,nTf:null,rodZ:null,
    nDmg:null,nOx:null,nMelt:null,nDisp:null,
    bankR:T.bankR,NB:T.NB,tipLen:T.tipLen,tipRho:T.tipRho,TfRef:0,X0:1,
    dia:T.coreDia,hgt:T.coreHgt,frac:T.frac,peak:nodePeak(T.phiCold),
    reflR:T.reflR,reflT:T.reflT,reflB:T.reflB,reflMat:T.reflMat};
}

function rodShape(T,st,cov,fol){
  cov.fill(0); fol.fill(0);
  const rw=T.rinfW;
  for(let b=0;b<T.NB;b++){
    const ins=clamp(st.rodZ[b],0,1), tip=XNZ*(1-ins);   // node units
    const fLo=tip-T.tipLen, fHi=tip;
    for(let i=0;i<XNR;i++){
      const w=Math.max(0,1-Math.abs(i-T.bankR[b])/T.rinf)/Math.max(rw[i],1e-6);
      if(w<=0) continue;
      for(let j=0;j<XNZ;j++){
        const k=XIX(i,j);
        cov[k]+=w*clamp(j+1-tip,0,1);
        fol[k]+=w*clamp(Math.min(j+1,fHi)-Math.max(j,fLo),0,1);
      }
    }
  }
}

function coreSolve(T,phi,rho,sweeps){
  const n=sweeps||SOR_SWEEPS;
  const aR=T.albR, aT=T.albT, aB=T.albB;
  for(let s=0;s<n;s++){
    for(let i=0;i<XNR;i++){
      const b=i*XNZ, fi=faceI[i], fo=faceO[i];
      const den=T.cr*(fi+fo)+2*T.cz+1;
      for(let j=0;j<XNZ;j++){
        const k=b+j;
        const In = i>0       ? phi[k-XNZ] : 0;          // centreline: mirror
        const Ou = i<XNR-1   ? phi[k+XNZ] : aR*phi[k];
        const Dn = j>0       ? phi[k-1]   : aB*phi[k];
        const Up = j<XNZ-1   ? phi[k+1]   : aT*phi[k];
        const num=T.cr*(fi*In+fo*Ou)+T.cz*(Dn+Up)+(1+rho[k]*1e-5)*phi[k];
        const v=phi[k]+SOR_OM*(num/den-phi[k]);
        phi[k]= (isFinite(v)&&v>1e-6) ? v : 1e-6;
      }
    }
    const m=wMean(phi);
    if(m>1e-9){ for(let k=0;k<XNN;k++) phi[k]/=m; } else phi.fill(1);
  }
}

/* a function, not a const: top-level const has a TDZ across these plain scripts and core2d loads first */
function rodBanks(K,cs){
  for(let b=0;b<K.NB;b++)
    cs.rodZ[b]=clamp(cs.split ? cs.rodZ[b] : cs.rodPos+K.bankW[b]*XTILTZ*cs.tilt, 0, 1);
}

function coreReset(K,cs,flowNet){
  cs.phi =new Float64Array(XNN).fill(1);
  cs.xI  =new Float64Array(XNN); cs.xX=new Float64Array(XNN);
  cs.nTf =new Float64Array(XNN); cs.nTc=new Float64Array(XNN);
  cs.nV  =new Float64Array(XNN); cs.nRho=new Float64Array(XNN);
  cs.nVt =new Float64Array(XNN);
  // pressure-tube core: torn channels (latched, whole ring), their share, the cavity relief
  cs.nTube=new Float64Array(XNN); cs.tubesOpen=0; cs.cavRelief=0;
  cs.nCov=new Float64Array(XNN); cs.nFol=new Float64Array(XNN);
  /* monotonic integrals: nDmg burst share, nOx oxide metres, nMelt/nDisp pellet share, nDnb the film-boiling latch */
  cs.nDmg=new Float64Array(XNN); cs.nOx=new Float64Array(XNN);
  cs.nMelt=new Float64Array(XNN); cs.nDisp=new Float64Array(XNN); cs.nDnb=new Float64Array(XNN);
  cs.chW =new Float64Array(XNR).fill(1);
  /* demand starts equal to actual, or the plant walks off its commissioning point on tick one */
  cs.rodZ   =new Float64Array(K.NB).fill(cs.rodPos);
  cs.rodZDem=new Float64Array(K.NB).fill(cs.rodPos);
  cs.bankAuto=new Array(K.NB).fill(true);
  cs.tilt=0; cs.tiltDem=0; cs.ao=0; cs.ro=0; cs.hotRing=0; cs.hotLev=0; cs.vNode=0;
  cs.hotFlow=1; cs.tipRho=0; cs.TfHot=K.TfRef;
  cs.meltFrac=0; cs.oxMax=0; cs.qOx=0; cs.fci=0; cs.TcladHot=K.Tref;
  cs.dnbrMin=K.dnbr0; cs.dnbrRing=0; cs.dnbrLev=0;
  for(let k=0;k<XNN;k++){
    cs.xI[k]=ioEq(K,K.n0); cs.xX[k]=K.X0;
    cs.nTc[k]=K.Tref; cs.nTf[k]=K.TfRef;
  }
  /* settle the shape once, or tick one kicks a transient nobody asked for */
  rodShape(K,cs,cs.nCov,cs.nFol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    cs.nRho[k]=-K.rodA*cs.nCov[k]+K.tipRho*cs.nFol[k]-K.poison*(K.poiG[i]-1)
             -K.nPen[i]+K.enrRho[i]; }
  coreSolve(K,cs.phi,cs.nRho,60);
  cs.fq=nodePeak(cs.phi).v;
  /* poison on the node's own flux, not the core mean; needs the settled shape, hence here */
  for(let k=0;k<XNN;k++){ const fl=K.n0*cs.phi[k];
    cs.xI[k]=ioEq(K,fl); cs.xX[k]=xeEq(K,fl); }
  /* K.pinUA is fitted at one anchor: the flux-weighted mean pellet of a plant at rest is K.TfRef */
  { let pk2=0; for(let k=0;k<XNN;k++) pk2+=nodeW[k]*cs.phi[k]*cs.phi[k];
    /* at the film this plant actually has, not the isothermal reference */
    const film0=Math.pow(Math.max(K.flowK*(flowNet||1),.02),0.8);
    /* the design's own rest point, never the seeded state: a plant seeded cold would fit pinUA at zero */
    const heat0=K.n0*(PROMPT_F+DEC_A.reduce((t,a)=>t+a,0));
    K.pinUA=heat0*K.rated*1000*Math.max(pk2,1e-6)
           /(film0*Math.max(K.TfRef-K.Tref,1)*K.condK);
    /* no clad node: a fixed solid leg and the live film in series, split so the film carries CLAD_DT0 at the rest point */
    const r=clamp(CLAD_DT0/Math.max(K.TfRef-K.Tref,1),.01,.6);
    K.gSolid=film0/(1-r); K.cladR=r;
    /* the fit is at the rest point; the pellets start at the power this plant is seeded at */
    const qhat=(cs.n*PROMPT_F+cs.decay)*K.rated*1000/K.pinUA;
    for(let k=0;k<XNN;k++) cs.nTf[k]=cs.nTc[k]+qhat*cs.phi[k]/film0; }
}

/* worst first; indexes FAIL (step.js) */
function fuelStage(cs,k){
  if(cs.nMelt[k]>0) return 5;
  if(cs.nDisp[k]>0) return 4;
  if(ecrOf(cs.nOx[k])>=OX_ECR_FAIL) return 3;
  if(cs.nDmg[k]>0) return 2;
  if(cs.nTube && cs.nTube[k]>0) return 1;
  return 0;
}
function fuelStages(cs){
  const o=new Float64Array(FAIL.length);
  for(let k=0;k<XNN;k++) o[fuelStage(cs,k)]+=nodeW[k];
  return o;
}

function coreRodWorth(K,cs){
  let w=0, W=0;
  for(let k=0;k<XNN;k++){ const q=nodeW[k]*cs.phi[k]*cs.phi[k];
    w+=q*(-K.rodA*cs.nCov[k]+K.tipRho*cs.nFol[k]); W+=q; }
  return W>0 ? w/W : 0;
}

function coreStep(K,cs,dt,heat,sat,vLeak,mflux,flowFrac,Tavg){
  /* parallel channels at equal dp, so a voiding channel loses the flow it needed to stop voiding */
  { const rvl=satRvl(K.sat, cs.pCore), rq=1/Math.max(rvl,1e-6)-1;
    let tot=0;
    for(let i=0;i<XNR;i++){
      let x=0; for(let j=0;j<XNZ;j++) x+=voidQual(cs.nV[XIX(i,j)],rvl);
      cs.chW[i]=1/Math.sqrt(1+rq*(x/XNZ));
      tot+=cs.chW[i]*ringW[i];
    }
    for(let i=0;i<XNR;i++) cs.chW[i]/=Math.max(tot,1e-6);
  }

  rodShape(K,cs,cs.nCov,cs.nFol);
  /* the rise first, then the channel centred on Tavg: hanging the inlet off last tick's rise oscillates the plant apart */
  const mixK=new Float64Array(XNR);
  { let raw=0;
    for(let i=0;i<XNR;i++){
      let ringP=0; for(let j=0;j<XNZ;j++) ringP+=cs.phi[XIX(i,j)];
      ringP=Math.max(ringP/XNZ,1e-6);
      mixK[i]=(1+(ringP-1)*(1-K.mix))/ringP;      // cross-flow; it conserves
      raw += ringW[i]*heat*K.dT0*ringP*mixK[i]/Math.max(flowFrac,1e-3);
    }
    cs.coreDT=clamp(raw,0,coreDTMax()); }
  const Tcold=Tavg-cs.coreDT/2;
  /* qhat is the core's power in the pin balance's units: kelvin of film difference per unit of flux */
  const qhat  = heat*K.rated*1000/Math.max(K.pinUA,1e-9);
  const qpp0  = K.rated*1e6/Math.max(K.aHeat,1e-6);   // rated flux past the pin, W/m2
  const ff    = Math.max(flowFrac, 1e-3);
  const cp    = K.sat.cp, dT0 = K.dT0;
  const hSat  = cp*sat;                      // kJ/kg
  const rvl   = satRvl(K.sat, cs.pCore);             // the core boils at its own pressure
  let dnbLo=1e30, dnbK=0, TclH=0, ecrH=0, h2=0, oxP=0, fciE=0;
  const disK=new Float64Array(XNN);
  const dhSub=cp*(sat-Tcold);
  for(let i=0;i<XNR;i++){
    const chan=Math.max(cs.chW[i],1e-3);
    const dTn=heat*dT0*mixK[i]/(XNZ*ff*chan);        // K of rise per node at phi = 1
    /* floored at the pool film; (1-vLeak) below takes the floor away when the node is bare */
    const film0=Math.max(Math.pow(Math.max(mflux*chan,0),0.8), K.filmPool||0);
    /* the same water as Saha-Zuber's mass flux G */
    const gCh=Math.max(mflux*chan,1e-3);
    let h=cp*Tcold;
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), pw=cs.phi[k];
      const dh=cp*dTn*pw;
      const hMid=h+dh/2; h+=dh;              // the node sits at its own midpoint
      if(hMid<=hSat) cs.nTc[k]=hMid/cp;
      else         { cs.nTc[k]=sat; }
      /* xe is negative while subcooled; xd is where vapour detaches, off whichever Saha-Zuber branch this channel is on */
      const q2=Math.max(heat*pw,0);
      const xd=-Math.max(Math.min(K.xSub*q2/gCh, K.xSubLo*q2), 1e-6);
      const xe=(hMid-hSat)/K.hfg;
      cs.nVt[k]=driftFlux(subQual(xe, xd), rvl);

      /* the minimum this pass finds IS cs.dnbr (step.js); no second margin arithmetic */
      const dnb=marginNode(K,cs,heat,pw,hMid/cp-Tcold,Tcold,cs.nTf[k],
                           mflux*chan,xe,dhSub);
      if(dnb<dnbLo){ dnbLo=dnb; dnbK=k; }

      /* bareness is vLeak, the vessel's shortfall of water, never the node's void */
      const bare=1-clamp(vLeak,0,1);
      const hCsp=film0*bare/K.cladR;
      const hCnb=qhat*pw*bare/Math.max(sat+jensLottes(qpp0*q2,cs.pCore)-cs.nTc[k],1e-3);
      const hCw=Math.max(hCsp,hCnb);
      const TclNB=cs.nTc[k]+(cs.nTf[k]-cs.nTc[k])*K.gSolid/(K.gSolid+hCw);
      cs.nDnb[k]=dnbLatch(K,dnb, TclNB-sat, cs.nDnb[k]);
      const hC=cs.nDnb[k] ? hCsp*DNB_FILM : hCw;
      const film=K.gSolid*hC/Math.max(K.gSolid+hC,1e-12);

      const Tcl=cs.nTc[k]+(cs.nTf[k]-cs.nTc[k])*K.gSolid/(K.gSolid+hC);
      if(Tcl>TclH) TclH=Tcl;

      /* squared thickness, closed form; a burst pin has steam on both faces, so growth doubles */
      let qOx=0;
      if(dt>0 && K.oxid && Tcl>OX_T0 && cs.nV[k]>OX_VMIN && ecrOf(cs.nOx[k])<1){
        const o0=cs.nOx[k];
        /* clamped at the wall it is eating, or a runaway step puts ECR over 100 % */
        cs.nOx[k]=Math.min(ZR_PBR*ROD_CLAD,
          Math.sqrt(o0*o0+oxRate(Tcl)*(1+cs.nDmg[k])*dt));
        /* nodeW cancels: the node's power is W/(nodeW*pinUA) and its share of rod surface is aHeat*nodeW */
        const dm=ZR_RHO*(cs.nOx[k]-o0)/ZR_PBR*K.aHeat*nodeW[k];
        h2 += ZR_H2*dm;
        qOx = ZR_QOX*dm/(1000*dt*nodeW[k]*Math.max(K.pinUA,1e-9));
      }
      { const e=ecrOf(cs.nOx[k]); if(e>ecrH) ecrH=e; }
      oxP+=qOx*nodeW[k];

      // fuel that has left the pin heats the water directly, where coreHeatKW already puts it
      const qPin=qhat*pw*(1-cs.nDisp[k]);
      // at dt 0 solve the balance instead of stepping it, so a commissioning pass seeds the film it will see
      let Tn=dt>0 ? cs.nTf[k]+(qPin+qOx-film*(cs.nTf[k]-cs.nTc[k]))*dt/xTauF(K)
                  : cs.nTc[k]+(qPin+qOx)/Math.max(film,1e-9);
      /* melt is paid for in latent heat and cannot start before the clad has failed, which is what makes cs.meltFrac <= cs.dmg/100 a theorem */
      if(Tn>K.tmelt && cs.nDmg[k]>=1 && cs.nMelt[k]+cs.nDisp[k]<1){
        const room=(1-cs.nMelt[k]-cs.nDisp[k])*FUSE_DT, paid=Math.min(Tn-K.tmelt,room);
        cs.nMelt[k]=Math.min(1,cs.nMelt[k]+paid/FUSE_DT);
        Tn=K.tmelt+(Tn-K.tmelt-paid);
      }
      /* a fast pulse fails the pin on energy, not temperature, so no clad gate here */
      if(dt>0){
        const hF=FUEL_CP*(Tn-T_STP)+cs.nMelt[k]*FUSE_KJ;
        if(hF>DISP_H){ cs.nDisp[k]=Math.max(cs.nDisp[k],clamp((hF-DISP_H)/DISP_SPAN,0,1));
          cs.nDmg[k]=Math.max(cs.nDmg[k],cs.nDisp[k]); }
        /* fragments and melt in liquid quench through no film and no gap; what they shed lands in the vessel node as o.fci */
        const fr=Math.max(cs.nDisp[k],cs.nMelt[k])*(1-clamp(cs.nV[k],0,1));
        if(fr>0 && Tn>cs.nTc[k]){
          const dT=(Tn-cs.nTc[k])*Math.min(1,fr*FCI_ETA*(1-Math.exp(-dt/FCI_TAU)));
          Tn-=dT; fciE+=dT*nodeW[k]; }
      }
      cs.nTf[k]=clamp(Tn,0,6000);

      if(ecrOf(cs.nOx[k])>=1) cs.nDmg[k]=1;
      else {
        const dP=P_FILL*Tcl/T_FILL-cs.pCore, tb=burstT(dP);
        if(Tcl>tb) cs.nDmg[k]=Math.min(1,
          cs.nDmg[k]+clamp((Tcl-tb)/BURST_SPAN,0,1)*dt/BURST_TAU);
      }

      /* local xenon on local flux: the gradient between nodes is the oscillation */
      const fl=cs.n*pw;
      cs.xI[k]=Math.max(0,cs.xI[k]+(K.gI*fl-K.lamI*cs.xI[k])*dt);
      cs.xX[k]=Math.max(0,cs.xX[k]+(K.gX*fl+K.lamI*cs.xI[k]-K.lamX*cs.xX[k]
              -K.sig*fl*cs.xX[k])*dt);

      const rI=clamp(K.aF*(cs.nTf[k]-K.TfRef),-6000,3000)
              +clamp(K.aM*(cs.nTc[k]-K.Tref),-6000,2500)
              +clamp(K.aX*(cs.nTf[k]-K.TfRef)+K.aS*(cs.nTc[k]-K.Tref),-6000,2500)
              +K.aV*cs.nV[k]-K.KXE*cs.xX[k]
              -K.rodA*cs.nCov[k]+K.tipRho*cs.nFol[k]
              -K.poison*(K.poiG[i]-1)
              -K.nPen[i]+K.enrRho[i];
      /* fuel that has left the node multiplies nothing, so its share reads k = 0 */
      disK[k]=-cs.nDisp[k]*(1e5+rI);
      cs.nRho[k]=rI+disK[k];
    }
  }

  /* the lag is transport: core height over the coolant's own velocity, bounded so a stopped pump cannot divide by zero */
  { const v=Math.max(mflux,1e-3)*K.G0/Math.max(rhoAt(Tavg),1);
    const tau=clamp(Math.max(K.coreHgt,.05)/Math.max(v,1e-3),0.1,60);
    for(let k=0;k<XNN;k++){
      const vT=clamp(Math.max(cs.nVt[k],vLeak),0,1);
      cs.nV[k]+=(vT-cs.nV[k])*dt/tau;
    } }

  coreSolve(K,cs.phi,cs.nRho);

  const o={dop:0,mod:0,exp:0,vd:0,xe:0,rod:0,tip:0,dis:0};
  let X=0,I=0,V=0,Tf=0,TfH=0,top=0,bot=0,inn=0,out=0,W2=0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const k=XIX(i,j), v=nodeW[k], w=v*cs.phi[k], w2=w*cs.phi[k];
    o.dop+=w2*clamp(K.aF*(cs.nTf[k]-K.TfRef),-6000,3000);
    o.mod+=w2*clamp(K.aM*(cs.nTc[k]-K.Tref),-6000,2500);
    o.exp+=w2*clamp(K.aX*(cs.nTf[k]-K.TfRef)+K.aS*(cs.nTc[k]-K.Tref),-6000,2500);
    o.vd +=w2*K.aV*cs.nV[k];
    o.xe +=w2*-K.KXE*cs.xX[k];
    o.rod+=w2*-K.rodA*cs.nCov[k];
    o.tip+=w2*K.tipRho*cs.nFol[k];
    o.dis+=w2*disK[k];
    W2+=w2;
    X+=v*cs.xX[k]; I+=v*cs.xI[k]; V+=v*cs.nV[k]; Tf+=w*cs.nTf[k];
    if(cs.nTf[k]>TfH) TfH=cs.nTf[k];
    if(j>=XNZ/2) top+=w; else bot+=w;
    if(i< XNR/2)  inn+=w; else out+=w;
  }
  if(W2>0) for(const q in o) o[q]/=W2;
  const hot=nodePeak(cs.phi);
  cs.fq=hot.v; cs.hotRing=hot.i; cs.hotLev=hot.j;
  cs.ao=(top-bot)/Math.max(top+bot,1e-6);
  cs.ro=(inn-out)/Math.max(inn+out,1e-6);
  cs.X=X; cs.I=I; cs.Tf=Tf; cs.TfHot=TfH; cs.vNode=V; cs.tipRho=o.tip;
  /* mass flux, never the enthalpy rise: the two part company the moment the pumps stop */
  cs.hotFlow=Math.max(mflux*cs.chW[cs.hotRing],0.02);
  let dm=0, mf=0;
  for(let k=0;k<XNN;k++){ dm+=nodeW[k]*cs.nDmg[k]; mf+=nodeW[k]*cs.nMelt[k]; }
  cs.dmg=Math.min(100,100*dm); cs.meltFrac=mf;
  o.h2=h2; cs.oxMax=ecrH; cs.TcladHot=TclH;
  // node-mean kelvin times the pin's heat capacity (pinUA*tauF, kJ/K): kW the water took
  o.fci=dt>0 ? fciE*xTauF(K)*K.pinUA/dt : 0;
  // what the metal is making, as a share of rated
  cs.qOx=oxP*K.pinUA/Math.max(K.rated*1000,1e-9);
  cs.dnbrMin=dnbLo; cs.dnbrRing=(dnbK/XNZ)|0; cs.dnbrLev=dnbK%XNZ;
  return o;
}
