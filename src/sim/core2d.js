"use strict";
/* r-z: ring 0 is the centreline, level 0 the bottom, and rods enter from the top. */
const XNR=14, XNZ=10, XNN=XNR*XNZ;
const XIX=(i,j)=>i*XNZ+j;

/* poison grading, bank reach */
const XPG=0.9, XRINF=2.2;
/* tilt spread as a share of core height; past ~0.35 the outer bank saturates */
const XTILTZ=0.30;
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

  const mg=latMig(c), Lm=Math.sqrt(mg.m2)/100, dr=Math.max(M.dr,.005), dz=Math.max(M.dz,.005);
  T.m2=mg.m2; T.dc=mg.dc;
  T.cz=Math.pow(Lm/dz,2);
  T.cr=Math.pow(Lm/dr,2);

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
    T.rp=rodDP(c)/2; T.cladAl=cladOf(c).alpha; T.fgFill=fgFillOf();
    T.pinLen=latRods(c)*hgt; T.fuelKg=latFuelKg(c);
    T.xSub  = 154*cp*f.dT0*(B.aFlow/(B.aHeat*hgt))/hfg;
    T.xSubLo= cp*(SZ_LO*qpp*T.dh/K_COOL)/hfg; }

  T.dR=edgeDist(mg.dc,c.lat.reflR*dr,d.rf); T.dT=edgeDist(mg.dc,c.lat.reflT*dz,d.rf); T.dB=edgeDist(mg.dc,c.lat.reflB*dz,d.rf);
  T.gR=edgeGhostR(T.dR,dr,XNR*dr); T.gT=edgeGhostZ(T.dT,dz,XNZ*dz,T.dB); T.gB=edgeGhostZ(T.dB,dz,XNZ*dz,T.dT);
  T.reflR=c.lat.reflR; T.reflT=c.lat.reflT; T.reflB=c.lat.reflB; T.reflMat=c.refl;

  /* normalised so the core-average worth is still exactly D.poison */
  T.poiG=M.poiG; T.poison=c.poison;
  T.nPen=M.nPen;
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

  const st={rodZ:new Float64Array(T.NB).fill(1)};
  const phi=new Float64Array(XNN).fill(1);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN), rho=new Float64Array(XNN);
  /* the cell's loss spread over the volume the bank reaches, as a volume average */
  rodShape(T,st,cov,fol);
  T.bank=bankRho(c,fastOf(modTherm(modRatio(c))));
  T.rodA=-T.bank.rho*1e5/Math.max(wMean(cov),1e-9);
  for(let k=0;k<XNN;k++) rho[k]=-T.rodA*cov[k];
  coreSolve(T,phi,rho);
  c.rodw=Math.max(0,T.rodA*impW(cov,phi));
  /* banks out: rodS() already books the rods' own absorption; the burnup moves the ring loading, and the leak the burnup */
  T.bu=c.burnup ?? fuelBlend(c).bu/2;
  for(let it=0;it<8;it++){
    T.enrRho=ringRho(M,T.bu);
    coreFq(T,0);
    T.leak=coreLeak(T,T.phiCold);
    if(c.burnup!=null) break;
    const b=burnupSuggest(c,T.leak), done=Math.abs(b-T.bu)<=1e-6*(1+b);
    T.bu=b; if(done) break;
  }
  T.fgInv=fgInvOf(c,T.bu);
  T.fgTres=c.power>0 ? T.bu*T.fuelKg*fuelBlend(c).hm/c.power*86400 : 0;
  T.rodX0=rodX0Of(c,T);
  T.FqCold=coreFq(T,T.rodX0);
  return T;
}

/* Milne: a vacuum face's flux extrapolates to zero 0.7104 transport mean free paths out, 0.7104*3 D */
const EXTRAP_D=0.7104*3;
/* m past the core face where the flux extrapolates to zero, off the core's one-group D cm: bare, the Milne distance;
   reflected, the one-group slab savings (D_c/D_r) L_r tanh(T/L_r), T carrying the reflector's own extrapolation
   distance so a vanishing band is the bare face */
function edgeDist(dc,t,rf){
  if(!rf.lr || !(t>0)) return EXTRAP_D*dc/100;
  return dc/rf.dr*rf.lr*Math.tanh((t*100+EXTRAP_D*rf.dr)/rf.lr)/100;
}
/* the ghost node's ratio to the face node on the uniform core's own fundamental, zero d past the face: sin axially,
   J0 radially, so the extrapolated dimension is exact whatever the mesh; R and H the core's, dz and dr its nodes */
const J0=x=>{ let s=0, t=1; for(let m=0;m<30;m++){ s+=t; t*=-(x*x/4)/((m+1)*(m+1)); } return s; };
const edgeGhostZ=(d,dz,H,d2)=>{ const B=Math.PI/(H+d+d2); return Math.sin(B*(d-dz/2))/Math.sin(B*(d+dz/2)); };
const edgeGhostR=(d,dr,R)=>{ const B=2.405/(R+d); return J0(B*(R+dr/2))/J0(B*(R-dr/2)); };

/* the boundary current over the flux, pcm: M^2 B^2 on a uniform core */
function coreLeak(T,phi){
  let out=0, tot=0;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){
    const k=XIX(i,j), w=nodeW[k];
    tot+=phi[k]*w;
    let g=0;
    if(i===XNR-1) g+=(1-T.gR)*T.cr*faceO[i];
    if(j===XNZ-1) g+=(1-T.gT)*T.cz;
    if(j===0)     g+=(1-T.gB)*T.cz;
    out+=g*phi[k]*w;
  }
  return tot>1e-9 ? 1e5*out/tot : 0;
}

/* peaking of a cold, xenon-free, unvoided core with the bank at x */
function coreFq(T,x){
  const phi=new Float64Array(XNN).fill(1), rho=new Float64Array(XNN);
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN);
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    rho[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-T.poison*(T.poiG[i]-1)-T.nPen[i]
          +T.enrRho[i]; }
  coreSolve(T,phi,rho);
  T.phiCold=phi;
  return nodePeak(phi)[0];
}

const FQ=new WeakMap();
function corePredict(c,d){
  /* latRev and zoneFuel are in the key because the drawing is an input that D cannot see. */
  const sig=[c.cool,c.mod,c.fuel,c.refl,c.poison,c.pitch,c.hd,c.power,c.clad??0,rodD(c),rodPOf(c),
             c.rodw,c.nbank,c.foll,c.burnup??"",latM(c).rev,JSON.stringify(c.zoneFuel)].join(",");
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

function coreSolve(T,phi,rho){
  FXK[FK_CR]=T.cr; FXK[FK_CZ]=T.cz; FXK[FK_GR]=T.gR; FXK[FK_GT]=T.gT; FXK[FK_GB]=T.gB;
  fluxSolve(phi,0,rho,0,FLUX_TOL,FLUX_CAP);
}

/* The fundamental of K = -L - diag(rho'), L the coupling with its edge ghosts. W*K is symmetric (ring weights),
   so W*(K - s) factors by banded Cholesky exactly when s sits under the lowest eigenvalue. s = RQ - d with d at
   least the eigen-residual, which bounds RQ - lambda0 once phi is near the fundamental; a failed factor widens d. */
const FLUX_TOL=1e-12, FLUX_CAP=60, FLUX_TICK_TOL=1e-10, FLUX_TICK_CAP=4, FLUX_TRIES=12;
const FB=XNZ+1, fxL=new Float64Array(XNN*FB), fxY=new Float64Array(XNN), fxP=new Float64Array(XNN);
/* the caller's constants in, so no double crosses a call */
const FK_CR=0, FK_CZ=1, FK_GR=2, FK_GT=3, FK_GB=4, FK_S=5, FXK=new Float64Array(6);
/* [0] the Rayleigh quotient lambda0 = -mu, [1] iterations, [2] the last max|dphi|, [3] eigen-residual */
const FX=new Float64Array(4);
function fluxApply(phi,po,rho,ro,y){
  const cr=FXK[FK_CR], cz=FXK[FK_CZ], gR=FXK[FK_GR], gT=FXK[FK_GT], gB=FXK[FK_GB];
  for(let i=0;i<XNR;i++){ const fi=faceI[i], fo=faceO[i];
    for(let j=0;j<XNZ;j++){ const q=i*XNZ+j, k=po+q, f=phi[k];
      let v=(2*cr+2*cz-rho[ro+q]*1e-5)*f;
      if(i>0) v-=cr*fi*phi[k-XNZ];
      v-= i<XNR-1 ? cr*fo*phi[k+XNZ] : cr*fo*gR*f;
      v-= j>0 ? cz*phi[k-1] : cz*gB*f;
      v-= j<XNZ-1 ? cz*phi[k+1] : cz*gT*f;
      y[q]=v; } }
}
function fluxFactor(rho,ro){
  const cr=FXK[FK_CR], cz=FXK[FK_CZ], gR=FXK[FK_GR], gT=FXK[FK_GT], gB=FXK[FK_GB], s=FXK[FK_S];
  for(let i=0;i<XNR;i++){ const w=ringW[i], fi=faceI[i], fo=faceO[i];
    for(let j=0;j<XNZ;j++){ const q=i*XNZ+j, b=q*FB;
      for(let d=0;d<FB;d++) fxL[b+d]=0;
      let a=2*cr+2*cz-rho[ro+q]*1e-5-s;
      if(i===XNR-1) a-=cr*fo*gR;
      if(j===0) a-=cz*gB;
      if(j===XNZ-1) a-=cz*gT;
      fxL[b]=w*a;
      if(j>0) fxL[b+1]=-w*cz;
      if(i>0) fxL[b+XNZ]=-w*cr*fi; } }
  for(let k=0;k<XNN;k++){ const j0=k>XNZ ? k-XNZ : 0;
    for(let j=j0;j<=k;j++){ let v=fxL[k*FB+k-j];
      const m0=j0>j-XNZ ? j0 : j-XNZ;
      for(let m=m0;m<j;m++) v-=fxL[k*FB+k-m]*fxL[j*FB+j-m];
      if(j<k) fxL[k*FB+k-j]=v/fxL[j*FB];
      else { if(!(v>0)) return false; fxL[k*FB]=Math.sqrt(v); } } }
  return true;
}
function fluxSolve(phi,po,rho,ro,tol,cap){
  const cr=FXK[FK_CR], cz=FXK[FK_CZ];
  const g=Math.min(cz*3*Math.PI*Math.PI/(XNZ*XNZ), cr*(5.520*5.520-2.405*2.405)/(XNR*XNR));
  const dMin=1e-10*(2*cr+2*cz+1);
  FX[1]=0; FX[2]=Infinity;
  for(let it=0;it<cap;it++){
    fluxApply(phi,po,rho,ro,fxY);
    let num=0, den=0;
    for(let q=0;q<XNN;q++){ const w=nodeW[q]*phi[po+q]; num+=w*fxY[q]; den+=w*phi[po+q]; }
    const lam=num/den;
    let r2=0, n2=0;
    for(let q=0;q<XNN;q++){ const f=phi[po+q], e=fxY[q]-lam*f; r2+=nodeW[q]*e*e; n2+=nodeW[q]*f*f; }
    const res=Math.sqrt(r2/n2);
    FX[0]=lam; FX[3]=res;
    let d=Math.min(g/2, Math.max(2*res, dMin)), ok=false;
    for(let t=0;t<FLUX_TRIES && !ok;t++){ FXK[FK_S]=lam-d; ok=fluxFactor(rho,ro); if(!ok) d=2*d+g; }
    if(!ok) return;
    for(let k=0;k<XNN;k++){ let v=ringW[(k/XNZ)|0]*phi[po+k];
      const j0=k>XNZ ? k-XNZ : 0;
      for(let m=j0;m<k;m++) v-=fxL[k*FB+k-m]*fxP[m];
      fxP[k]=v/fxL[k*FB]; }
    for(let k=XNN-1;k>=0;k--){ let v=fxP[k];
      const m1=k+XNZ<XNN-1 ? k+XNZ : XNN-1;
      for(let m=k+1;m<=m1;m++) v-=fxL[m*FB+m-k]*fxP[m];
      fxP[k]=v/fxL[k*FB]; }
    let m=0; for(let q=0;q<XNN;q++) m+=fxP[q]*nodeW[q];
    if(!(m>0) || m===Infinity) return;
    let dx=0;
    for(let q=0;q<XNN;q++){ const v=fxP[q]/m, e=v-phi[po+q]; phi[po+q]=v; if(e>dx) dx=e; else if(-e>dx) dx=-e; }
    FX[1]=it+1; FX[2]=dx;
    if(dx<tol) return;
  }
}





