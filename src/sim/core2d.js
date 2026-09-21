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
/* what a covered rod sheds into still water, W/m2/K */
const H_POOL=2000;
/* forced film against its rated conductance, Dittus-Boelter in the flow share */
const pinFilm=w=>Math.pow(Math.max(w,.02),0.8);
/* Jens-Lottes wall superheat; water only, so coreStep()'s max() drops it far from boiling.
   Fused at its sole caller (coreStep film block): a boundary per node per tick. */
const JL_K=25, JL_P=6.2;
/* drift-flux concentration parameter */
const XC0=1.13;
/* cross-flow; at a ceiling of 1 every channel takes the identical rise and the voiding runaway stops existing */
const XMIX0=0.55, XMIX_MAX=0.85;
/* Saha-Zuber low-Peclet coefficient; K_COOL is the coolant conductivity at the film, W/m/K */
const SZ_LO=0.0022, K_COOL=0.54;
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
function nodePeak(a, o){ let v=-1e30,k=0;
  for(let q=0;q<XNN;q++) if(a[q]>v){ v=a[q]; k=q; }
  o = o || nodePeakScr;
  o[0]=v; o[1]=k; o[2]=(k/XNZ)|0; o[3]=k%XNZ; return o; }
const nodePeakScr = new Float64Array(4);

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

  { const B=latBundle(c), hgt=Math.max(T.coreHgt,.05), a=COOLANT[c.cool], f=coolFig(a), hfg=f.hfg, cp=f.cp;
    T.hfg = hfg; T.dT0 = f.dT0; T.riseH = f.rise;
    T.dh = B.dh;
    const nF=latVols(c).nF;
    T.aHeat=4*nF*B.aHeat*hgt;                      // whole core rod surface, m2
    T.aFlow=4*nF*B.aFlow;                          // whole core flow area, m2
    /* rated mass flux, kg/m2/s - W-3 wants a real G, not a share */
    T.G0=coreRatedKgs(a, c.power*1000)/Math.max(T.aFlow,1e-9);
    const qpp=c.power*1e6/Math.max(T.aHeat,1e-6);
    T.filmPool=H_POOL/a.hFilm;
    { const r=pinRes(c); T.pinRs=r.solid; T.pinRg=r.gap; T.pinRf=r.film; }
    T.rp=rodDP(c)/2; T.cladAl=cladOf(c).alpha; T.fgInv=fgInvOf(c); T.fgFill=fgFillOf();
    T.pinLen=latRods(c)*hgt; T.fuelKg=latFuelKg(c);
    T.fgTres=c.power>0 ? coreBurnupOf(c)*T.fuelKg*fuelBlend(c).hm/c.power*86400 : 0;
    T.xSub  = 154*cp*f.dT0*(B.aFlow/(B.aHeat*hgt))/hfg;
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
  T.tipRho=fo.tipRho; T.tipLen=fo.tipLen*XNZ; T.tipGap=fo.tipGap*XNZ; T.follName=fo.name;

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
  return nodePeak(phi)[0];
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


/* node units: the follower's top hangs gap under the absorber's tip */
const follHi=(tip,gap)=>tip-gap;
function rodShape(T,st,cov,fol){
  cov.fill(0); fol.fill(0);
  const rw=T.rinfW;
  for(let b=0;b<T.NB;b++){
    const ins=clamp(st.rodZ[b],0,1), tip=XNZ*(1-ins);   // node units
    const fHi=follHi(tip,T.tipGap), fLo=fHi-T.tipLen;
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





