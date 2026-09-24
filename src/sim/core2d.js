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
function coreConst(T,c,d,prev){
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
    T.rp=rodDP(c)/2; T.cladAl=cladOf(c).alpha; T.fgFill=fgFillOf(c); T.rodPFill=cladOf(c).pFill;
    T.pinLen=latRods(c)*hgt; T.fuelKg=latFuelKg(c); T.cladM=cladKgOf(c,T.aHeat);
    T.vesA=Math.PI/4*vesselDiaM(c)**2; T.rodAr=latRods(c)*Math.PI/4*rodD(c)**2; T.vesClr=VESSEL_CLR;
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
  T.bankS=bankShares(M.bankN,Math.max(XRINF,XNR/T.NB));
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
  T.buN=null;
  T.bank=bankRho(c,fastShareOf(c));
  T.rodA=-T.bank.rho*1e5/Math.max(wMean(cov),1e-9);
  for(let k=0;k<XNN;k++) rho[k]=-T.rodA*cov[k];
  coreSolve(T,phi,rho);
  c.rodw=Math.max(0,T.rodA*impW(cov,phi));   // what the burnup loop reads; rodCurve() below replaces it
  /* banks out: rodS() already books the rods' own absorption; the burnup moves the ring loading, the leak the burnup, and
     both the xenon and feedback the rest flux leaks by (restFeed()) */
  T.bu=c.burnup ?? (prev ? prev.bu : fuelBlend(c).bu/2); T.hot=prev ? prev.hot : null; T.leak=null;
  for(let it=0;it<12;it++){
    T.enrRho=ringRho(M,T.bu);
    coreHot(T,0);
    const leak=coreLeak(T,T.phi), b=c.burnup!=null ? T.bu : burnupSuggest(c,leak,T.bu);
    const done=T.leak!==null && Math.abs(leak-T.leak)<=1e-10*(1+Math.abs(leak)) && Math.abs(b-T.bu)<=1e-10*(1+b);
    T.leak=leak; T.bu=b; T.hot=restFeed(c,T);
    if(done) break;
  }
  T.fgInv=fgInvOf(c,T.bu);
  T.fgTres=c.power>0 ? T.bu*T.fuelKg*fuelBlend(c).hm/c.power*86400 : 0;
  /* the burnup shape the core burns in with its bank withdrawn, then the bank on it; a fuel that circulates burns evenly */
  T.buA=fuelDissolved(c) ? 0 : Math.max(0,latRhoInf(c,0)-latRhoInf(c,T.bu));
  if(T.buA>0) T.buN=coreBuShape(T,0);
  T.rodSx=rodCurve(T); c.rodw=T.rodSx[10];
  T.rodX0=rodX0Of(c,T);
  /* the boron the bank's rest leaves, so the moderator's coefficient, now read off the bank's own curve */
  T.hot=restFeed(c,T);
  T.Fq=coreHot(T,T.rodX0);
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

/* each node's burnup over its column's mean as reactivity, pcm, into out at oo: fuel never moves along its channel, so each
   height has burnt as its own power, taken as the flux at phi+po (linear reactivity, A pcm at the core's mean burnup) */
function buShapeA(phi,po,A,out,oo){
  for(let i=0;i<XNR;i++){ let m=0; for(let j=0;j<XNZ;j++) m+=phi[po+i*XNZ+j];
    m/=XNZ; for(let j=0;j<XNZ;j++){ const q=i*XNZ+j; out[oo+q]= m>0 ? -A*(phi[po+q]/m-1) : 0; } } }
/* the bank's integral worth at each tenth of its travel, pcm: the rest flux solved with the bank at that depth (coreHot()),
   its absorber weighted by that flux, the measure the engine reads its bank by */
function rodCurve(T){ const o=new Float64Array(11), cov=new Float64Array(XNN), fol=new Float64Array(XNN);
  for(let q=1;q<=10;q++){ coreHot(T,q/10); rodShape(T,{rodZ:new Float64Array(T.NB).fill(q/10)},cov,fol); o[q]=Math.max(0,T.rodA*impW(cov,T.phi)); }
  return o; }
/* the hot rest at the coupling in FXK: the fundamental at node reactivity base plus its own burnup shape (buShapeA(), H.A pcm),
   its own xenon (burnout H.s, H.KXE pcm per unit xenon) and power feedback (H.F pcm at node k per unit relative power at node
   q, xeWaveFeedback()), by Newton on flux and eigenvalue together: the shape outweighs the coupling many times over, so a
   pass-by-pass iteration crawls. phi in (a start) and out; bu and rho, the burnup and the whole node reactivity, out if given. */
function restSolve(phi,base,H,bu,rho){
  const n=XNN, N=n+1, lamX=XE.lamX, g=XE.gI+XE.gX, sig=(H.s||0)*lamX, F0=H.F||null;
  let A=0, KXE=0;
  const L=new Float64Array(n*n), e=new Float64Array(n), y=new Float64Array(n), z=new Float64Array(n), m=new Float64Array(XNR);
  for(let j=0;j<n;j++){ e.fill(0); e[j]=1; fluxApply(e,0,z,0,y); for(let i=0;i<n;i++) L[i*n+j]=y[i]; }
  const J=new Float64Array(N*N), R=new Float64Array(N), D=new Float64Array(N), r=new Float64Array(n), b=new Float64Array(n), p0=new Float64Array(n);
  const F=F0 ? new Float64Array(n*n) : null;
  const resid=mu=>{
    for(let i=0;i<XNR;i++){ let s=0; for(let j=0;j<XNZ;j++) s+=phi[i*XNZ+j]; m[i]=s/XNZ; }
    let v2=0, sw=0;
    for(let k=0;k<n;k++){ const bk=A>0 ? -A*(phi[k]/m[(k/XNZ)|0]-1) : 0; b[k]=bk;
      let q=base[k]+bk-KXE*g*phi[k]/(lamX+sig*phi[k]);
      if(F) for(let j=0;j<n;j++) q+=F[k*n+j]*phi[j];
      r[k]=q; }
    for(let k=0;k<n;k++){ let v=-1e-5*r[k]*phi[k]-mu*phi[k]; for(let j=0;j<n;j++) v+=L[k*n+j]*phi[j];
      R[k]=-v; v2=Math.max(v2,Math.abs(v)); sw+=nodeW[k]*phi[k]; }
    R[n]=-(sw-1);
    return Math.max(v2,Math.abs(sw-1)); };
  let mu=0;
  /* xenon, feedback and burnup shape at share t of their own: Newton from the flux in phi, false if it finds no fundamental */
  const newton=t=>{ A=t*(H.A||0); KXE=t*(H.KXE||0); if(F) for(let i=0;i<n*n;i++) F[i]=t*F0[i];
    { resid(0); let num=0, den=0; for(let k=0;k<n;k++){ const w=nodeW[k]*phi[k]; num-=w*R[k]; den+=w*phi[k]; } mu=num/den; }
    /* one factor serves while the residual still falls tenfold a step; a halved or a slow step refactors */
    let res=resid(mu), ok=false, solve=null, fresh=false;
    for(let it=0;it<60;it++){
      if(res<1e-11){ ok=true; for(let k=0;k<n;k++) if(!(phi[k]>0)) ok=false; break; }
      if(!solve){ J.fill(0);
        for(let k=0;k<n;k++){ const col=(k/XNZ)|0, mc=m[col], c0=col*XNZ, pk=phi[k], d=lamX+sig*pk;
          for(let j=0;j<n;j++) J[k*N+j]=L[k*n+j]-(F ? 1e-5*pk*F[k*n+j] : 0);
          J[k*N+k]+=-1e-5*r[k]-mu+1e-5*pk*KXE*g*lamX/(d*d);
          if(A>0){ J[k*N+k]+=1e-5*pk*A/mc; for(let q=0;q<XNZ;q++) J[k*N+c0+q]-=1e-5*pk*A*pk/(mc*mc*XNZ); }
          J[k*N+n]=-pk; J[n*N+k]=nodeW[k]; }
        solve=luFactor(J,N); fresh=true; }
      solve(R); D.set(R); p0.set(phi);
      /* a step that raises the residual or turns a flux negative is halved: far from the rest the xenon and the feedback bend the problem */
      let st=1, nr=Infinity, mu1=mu, took=false;
      for(let h=0;h<30;h++){ let pos=true; for(let k=0;k<n;k++){ phi[k]=p0[k]+st*D[k]; if(!(phi[k]>0)) pos=false; } mu1=mu+st*D[n];
        if(pos){ nr=resid(mu1); if(nr<res){ took=true; break; } }
        st/=2; }
      if(!took){ phi.set(p0); if(fresh) return false; solve=null; res=resid(mu); continue; }
      if(st<1 || nr>0.1*res){ solve=null; }
      fresh=false; mu=mu1; res=nr; }
    return ok; };
  const start=Float64Array.from(phi);
  /* where Newton will not reach it at once, the rest is walked to from the bare core, the terms growing a share at a time */
  if(!newton(1)){ phi.set(start); let t=0, dt=0.125; const was=new Float64Array(n);
    while(t<1){ const t1=Math.min(1,t+dt); was.set(phi);
      if(newton(t1)) t=t1; else { phi.set(was); dt/=2; if(dt<1e-4) throw new Error("restSolve: no fundamental"); } } }
  resid(mu);
  if(bu) bu.set(b);
  if(rho) rho.set(r);
  return mu; }
const coreK=T=>{ FXK[FK_CR]=T.cr; FXK[FK_CZ]=T.cz; FXK[FK_GR]=T.gR; FXK[FK_GT]=T.gT; FXK[FK_GB]=T.gB; };
/* the static node reactivity with the bank at x: bank, followers, poison grading, ring loading and the burnup shape held */
function coreBase(T,x,out){
  const cov=new Float64Array(XNN), fol=new Float64Array(XNN), bu=T.buN;
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=XIX(i,j);
    out[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-T.poison*(T.poiG[i]-1)-T.nPen[i]+T.enrRho[i]+(bu ? bu[k] : 0); }
  return out; }
/* the core at rest with the bank at x, into T.phi: hot, on its own xenon and feedback (T.hot), once they are known; A pcm
   of burnup shape solved with it into bu when given. Returns the peak. */
function coreHot(T,x,A,bu){
  const phi=new Float64Array(XNN).fill(1), base=coreBase(T,x,new Float64Array(XNN));
  coreSolve(T,phi,base);
  if(T.hot || A>0){ coreK(T);
    const H={A,s:T.hot?T.hot.s:0,KXE:T.hot?T.hot.KXE:0,F:T.hot?T.hot.F:null}, key=Math.round(x*20)+(A>0?"b":""), last=REST_LAST.get(key), cold=Float64Array.from(phi);
    let done=false;
    if(last){ phi.set(last); try { restSolve(phi,base,H,bu,null); done=true; } catch(e){ phi.set(cold); } }
    if(!done) restSolve(phi,base,H,bu,null);
    if(REST_LAST.size>64) REST_LAST.clear(); REST_LAST.set(key,Float64Array.from(phi)); }
  T.phi=phi;
  return nodePeak(phi)[0];
}
/* the last rest found near each bank depth (a twentieth of travel) starts the next: a design is re-predicted many times over a step that barely moves it */
const REST_LAST=new Map();
/* pcm the hot rest with the bank at x sits off critical, on book pcm rho0: bank, followers, xenon and feedback, each weighted
   by the rest flux squared */
function coreRestRho(T,x,rho0){
  coreHot(T,x);
  const H=T.hot, phi=T.phi, cov=new Float64Array(XNN), fol=new Float64Array(XNN), g=XE.gI+XE.gX, sig=H.s*XE.lamX, off=H.pwrDef+H.aM*(T.dT0||0)/2;
  rodShape(T,{rodZ:new Float64Array(T.NB).fill(x)},cov,fol);
  const r=new Float64Array(XNN);
  for(let k=0;k<XNN;k++){ let f=-off; if(H.F) for(let q=0;q<XNN;q++) f+=H.F[k*XNN+q]*phi[q];
    r[k]=-T.rodA*cov[k]+T.tipRho*fol[k]-H.KXE*g*phi[k]/(XE.lamX+sig*phi[k])+f; }
  return rho0+impW(r,phi); }
/* the burnup shape the hot core with the bank at x makes of itself, held from then on */
function coreBuShape(T,x){ const bu=new Float64Array(XNN);
  T.buN=null; if(T.buA>0) coreHot(T,x,T.buA,bu); return bu; }

const FQ=new WeakMap();
function corePredict(c,d){
  /* latRev and zoneFuel are in the key because the drawing is an input that D cannot see. */
  const sig=[c.cool,c.mod,c.fuel,c.refl,c.poison,c.pitch,c.hd,c.power,c.clad??0,rodD(c),rodPOf(c),
             c.rodw,c.nbank,c.foll,c.burnup??"",latM(c).rev,JSON.stringify(c.zoneFuel)].join(",");
  const h=FQ.get(c);
  if(h && h.sig===sig) return h.val;
  const val=coreConst({},c,d,h ? h.val : null); FQ.set(c,{sig,val});
  return val;
}


/* each bank's share of each ring's absorber: its own clusters spread over the rings within rinf, a ring's shares summing
   to one wherever any bank reaches */
function bankShares(bankN,rinf){
  const w=bankN.map(n=>{ const o=new Float64Array(XNR);
    for(let i=0;i<XNR;i++) for(let r=0;r<XNR;r++) o[i]+=n[r]*Math.max(0,1-Math.abs(i-r)/rinf);
    return o; });
  const t=new Float64Array(XNR);
  for(const o of w) for(let i=0;i<XNR;i++) t[i]+=o[i];
  for(const o of w) for(let i=0;i<XNR;i++) o[i]= t[i]>0 ? o[i]/t[i] : 0;
  return w; }
/* node units: the follower's top hangs gap under the absorber's tip */
const follHi=(tip,gap)=>tip-gap;
function rodShape(T,st,cov,fol){
  cov.fill(0); fol.fill(0);
  for(let b=0;b<T.NB;b++){
    const ins=clamp(st.rodZ[b],0,1), tip=XNZ*(1-ins);   // node units
    const fHi=follHi(tip,T.tipGap), fLo=fHi-T.tipLen;
    for(let i=0;i<XNR;i++){
      const w=T.bankS[b][i];
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

/* The xenon wave, linearised about its rest (Randall & St. John, Nucleonics 16(3), 1958, as commonly quoted, not read), exact
   on the solver's own operator at the coupling and ghosts in FXK. The rest (restSolve()): node xenon and flux at burnout s
   (sigma phi/lamX at unit flux), worth KXE pcm per unit xenon, power feedback F pcm at node k per unit relative power at node
   q (XNN x XNN, null none), on node reactivity base (null none). */
function xeWaveRest(s,KXE,F,base){
  const lamX=XE.lamX, g=XE.gI+XE.gX, sig=s*lamX, b=base||new Float64Array(XNN), phi=new Float64Array(XNN).fill(1), X=new Float64Array(XNN), rho=new Float64Array(XNN);
  fluxSolve(phi,0,b,0,FLUX_TOL,FLUX_CAP);
  restSolve(phi,b,{s,KXE,F},null,rho);
  for(let k=0;k<XNN;k++) X[k]=g*phi[k]/(lamX+sig*phi[k]);
  return {sig,phi,X,rho,KXE}; }
/* the Jacobian of node iodine and xenon at rest R, the flux following through the operator's own eigenproblem, power held;
   J.S the flux's response to each node's xenon */
function xeWaveJ(R,F){
  const n=XNN, lamI=XE.lamI, lamX=XE.lamX, gI=XE.gI, gX=XE.gX, phi=R.phi, psi=new Float64Array(n), K=new Float64Array(n*n), e=new Float64Array(n), y=new Float64Array(n);
  for(let j=0;j<n;j++){ e.fill(0); e[j]=1; fluxApply(e,0,R.rho,0,y); for(let i=0;i<n;i++) K[i*n+j]=y[i]; }
  let mu=0, pp=0, wn=0;
  fluxApply(phi,0,R.rho,0,y);
  for(let i=0;i<n;i++){ psi[i]=nodeW[i]*phi[i]; mu+=psi[i]*y[i]; pp+=psi[i]*phi[i]; wn+=nodeW[i]*phi[i]; }
  mu/=pp;
  const B=new Float64Array(n*n);
  for(let i=0;i<n;i++) for(let j=0;j<n;j++) B[i*n+j]=K[i*n+j]-(i===j ? mu : 0)+phi[i]*psi[j]/pp-(F ? 1e-5*phi[i]*F[i*n+j] : 0);
  const solve=luFactor(B,n), S=new Float64Array(n*n), k5=R.KXE*1e-5, b=new Float64Array(n);
  for(let j=0;j<n;j++){ const dmu=psi[j]*k5*phi[j]/pp;
    for(let i=0;i<n;i++) b[i]=dmu*phi[i]; b[j]-=k5*phi[j];
    solve(b); let c=0; for(let i=0;i<n;i++) c+=nodeW[i]*b[i]; c/=wn;
    for(let i=0;i<n;i++) S[i*n+j]=b[i]-c*phi[i]; }
  const N=2*n, J=new Float64Array(N*N);
  for(let i=0;i<n;i++){ J[i*N+i]=-lamI; J[(n+i)*N+i]=lamI; J[(n+i)*N+n+i]=-(lamX+R.sig*phi[i]);
    for(let j=0;j<n;j++){ const sj=S[i*n+j]; J[i*N+n+j]+=gI*sj; J[(n+i)*N+n+j]+=(gX-R.sig*R.X[i])*sj; } }
  J.S=S; return J; }
/* each node's pellet aP pcm per unit relative power, and its coolant, which carries its own column's power up from the inlet:
   aM pcm/K on a core rise dTc K, the flow held */
function xeWaveFeedback(aP,aM,dTc){ const F=new Float64Array(XNN*XNN), c=aM*dTc/XNZ;
  for(let i=0;i<XNR;i++) for(let j=0;j<XNZ;j++){ const k=i*XNZ+j; F[k*XNN+k]=aP+c/2; for(let q=0;q<j;q++) F[k*XNN+i*XNZ+q]=c; }
  return F; }
/* the least-damped oscillating mode of a core with T's coupling and ghosts, one that turns within ten of its own e-folds, growth
   and period per real hour; the least-damped of the rest when it grows faster or nothing oscillates */
const XEW=new Map();
function xeWaveMode(T,s,KXE,aP,aM,dTc){
  /* no xenon to drive it: iodine and xenon only decay */
  if(!(s>1e-6) || !(KXE>1e-6)) return {g:-Math.min(XE.lamI,XE.lamX)*3600, T:Infinity};
  const key=[T.cr,T.cz,T.gR,T.gT,T.gB,s,KXE,aP,aM,dTc].join(","), hit=XEW.get(key); if(hit) return hit;
  const was=Float64Array.from(FXK); FXK[FK_CR]=T.cr; FXK[FK_CZ]=T.cz; FXK[FK_GR]=T.gR; FXK[FK_GT]=T.gT; FXK[FK_GB]=T.gB;
  const F=aP||aM ? xeWaveFeedback(aP,aM,dTc) : null, J=xeWaveJ(xeWaveRest(s,KXE,F),F); FXK.set(was);
  let re=-Infinity, im=0, rr=-Infinity;
  for(const [a,b] of eigReal(J,2*XNN)){ if(Math.abs(b)>Math.abs(a)/10){ if(a>re){ re=a; im=Math.abs(b); } } else if(a>rr) rr=a; }
  const o= re===-Infinity || (rr>0 && rr>re) ? {g:rr*3600, T:Infinity} : {g:re*3600, T:2*Math.PI/im/3600};
  if(XEW.size>64) XEW.clear(); XEW.set(key,o); return o; }






