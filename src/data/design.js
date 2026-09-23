"use strict";
/* Prompt fission energy fraction; E_DEC_A sums to the 6.5 % remainder. The partition below puts the decay
   group at 6.36 % of the recoverable total; ANS-5.1-1979's own fit reads 6.59 % on 200 MeV. 0.935 sits
   between them. */
const PROMPT_F=0.935;
/* recoverable MeV per U-235 fission, ENDF/B-VIII.0 n-092_U_235.endf MF=1 MT=458 at thermal: fragments
   169.130, prompt neutrons 4.8276, delayed neutrons 0.008074, prompt gamma 7.2813, delayed fission-product
   gamma 6.330 +- 0.050, delayed beta 6.500 +- 0.050. Capture gamma is not in MT=458: it is the drawing's
   own, priced where the captures are (heatSharesCalc(), lattice.js). */
const FIS_EF=169.130, FIS_EN=4.8276+0.008074, FIS_EGP=7.2813, FIS_EGD=6.330, FIS_EB=6.500;
const FIS_FGD=FIS_EGD/(FIS_EGD+FIS_EB);
/* photon groups, MeV edges, each priced at the tabulated energy inside it */
const GAM_EDGE=[0.1,0.4,1,2,4,10], GAM_E=[0.2,0.6,1.5,3,6], GAM_NG=5;
/* mu/rho and mu_en/rho cm2/g at GAM_E, Hubbell & Seltzer (NISTIR 5632, NIST X-ray mass attenuation tables, read 22/09/26), and g/mol */
const MUG={H:[.2429,.1599,.1027,.06921,.04498],He:[.1224,.08054,.05173,.03503,.02307],Li:[.1060,.06968,.04476,.03043,.02030],
  Be:[.1089,.07155,.04597,.03138,.02121],B:[.1136,.07460,.04791,.03284,.02248],C:[.1229,.08058,.05179,.03562,.02469],
  O:[.1237,.08070,.05185,.03597,.02552],F:[.1176,.07649,.04915,.03422,.02457],Na:[.1199,.07736,.04968,.03487,.02559],
  Mg:[.1245,.07988,.05129,.03613,.02681],Zr:[.2237,.07756,.04700,.03644,.03374],Ag:[.2972,.08153,.04754,.03754,.03601],
  Cd:[.3038,.08064,.04673,.03698,.03563],In:[.3167,.08138,.04684,.03715,.03596],Hf:[.7339,.1058,.04944,.04030,.04155],
  U:[1.298,.1490,.05587,.04447,.04583]};
const MUENG={H:[.05254,.05875,.05075,.03992,.02905],He:[.02647,.02959,.02555,.02019,.01493],Li:[.02290,.02559,.02210,.01753,.01316],
  Be:[.02353,.02627,.02268,.01806,.01377],B:[.02453,.02737,.02362,.01889,.01461],C:[.02655,.02956,.02551,.02048,.01607],
  O:[.02679,.02957,.02551,.02066,.01668],F:[.02554,.02801,.02416,.01964,.01607],Na:[.02635,.02830,.02437,.01997,.01675],
  Mg:[.02761,.02921,.02514,.02067,.01756],Zr:[.1164,.03025,.02257,.02033,.02193],Ag:[.1751,.03347,.02284,.02082,.02324],
  Cd:[.1813,.03339,.02247,.02051,.02300],In:[.1913,.03398,.02254,.02060,.02321],Hf:[.4645,.05409,.02447,.02212,.02620],
  U:[.6746,.08494,.02891,.02434,.02829]};
/* B-10 atom fraction of natural boron, IUPAC 0.199(7), as commonly quoted */
const B10_NAT=0.199;
const AWT={H:1.008,He:4.0026,Li:6.94,Li7:7.016,Be:9.0122,B10:10.0129,B11:11.0093,C:12.011,O:15.999,F:18.998,Na:22.990,Mg:24.305,Zr:91.224,Ag:107.87,Cd:112.41,In:114.82,Hf:178.49,U:238.03};
const bAwt=b=>b*AWT.B10+(1-b)*AWT.B11;
AWT.B=bAwt(B10_NAT);
/* Li-7 carries lithium's per-electron figures: per gram they scale as Z/A */
MUG.Li7=MUG.Li.map(x=>x*AWT.Li/AWT.Li7); MUENG.Li7=MUENG.Li.map(x=>x*AWT.Li/AWT.Li7);
const atomW=f=>{ let m=0; const w={}; for(const e in f) m+=f[e]*AWT[e]; for(const e in f) w[e]=f[e]*AWT[e]/m; return w; };
/* a material row states comp (atoms) or compW (weight fractions); its per-group mu/rho and mu_en/rho are the mass-weighted sum */
const compWOf=r=>r.compW||atomW(r.comp);
function gamOf(r){ if(r.gamG) return r.gamG;
  const w=compWOf(r), mu=new Float64Array(GAM_NG), en=new Float64Array(GAM_NG);
  for(const e in w) for(let g=0;g<GAM_NG;g++){ mu[g]+=w[e]*MUG[e][g]; en[g]+=w[e]*MUENG[e][g]; }
  return (r.gamG={mu,en}); }
/* Klein-Nishina per electron, units of pi r_e^2 (Evans, The Atomic Nucleus, ch. 23): total, and the share
   of a scattered photon's energy per unit eps = E'/E */
const KN_MC2=0.51099895;
const knTot=a=>2*((1+a)/(a*a)*(2*(1+a)/(1+2*a)-Math.log(1+2*a)/a)+Math.log(1+2*a)/(2*a)-(1+3*a)/((1+2*a)*(1+2*a)));
const knDs=(a,x)=>{ const c=1-(1/x-1)/a; return (x+1/x-(1-c*c))/a; };
/* where the energy a collision re-emits lands: row g of an NG x NG matrix, the Compton photon's energy by
   group off Klein-Nishina at GAM_E[g]; below the lowest edge it stays in group 0 */
const KN_N=4000;
const GAM_TR=(function(){ const T=new Float64Array(GAM_NG*GAM_NG);
  for(let g=0;g<GAM_NG;g++){ const a=GAM_E[g]/KN_MC2, lo=1/(1+2*a); let s=0;
    for(let i=0;i<KN_N;i++){ const x=lo+(1-lo)*(i+.5)/KN_N, e=x*knDs(a,x), E=x*GAM_E[g];
      let h=0; while(h<g && E>=GAM_EDGE[h+1]) h++;
      T[g*GAM_NG+h]+=e; s+=e; }
    for(let h=0;h<GAM_NG;h++) T[g*GAM_NG+h]/=s; }
  return T; })();
/* Bickley-Naylor Ki_n(x) = int_0^inf e^(-x cosh w)/cosh^n w dw for n 2 and 3 on [0, GAM_KX], by the trapezoid
   rule, exponentially convergent for an even analytic integrand; Ki3 is read by cubic Hermite, Ki3' = -Ki2 */
const GAM_KH=0.0025, GAM_KX=60, GAM_KN=Math.round(GAM_KX/GAM_KH)+1;
let GAM_KI2=null, GAM_KI3=null;
function gamKiBuild(){ const h=0.125, M=Math.ceil(19/h), ch=new Float64Array(M+1);
  for(let k=0;k<=M;k++) ch[k]=Math.cosh(k*h);
  const k2=new Float64Array(GAM_KN), k3=new Float64Array(GAM_KN);
  for(let i=0;i<GAM_KN;i++){ const x=i*GAM_KH; let s2=0, s3=0;
    for(let k=0;k<=M;k++){ const e=(k ? h : h/2)*Math.exp(-x*ch[k])/(ch[k]*ch[k]);
      s2+=e; s3+=e/ch[k]; if(e<1e-18*s2) break; }
    k2[i]=s2; k3[i]=s3; }
  GAM_KI2=k2; GAM_KI3=k3; }
function gamKi3(x){ if(!GAM_KI3) gamKiBuild(); if(!(x<GAM_KX)) return 0;
  const u=x/GAM_KH, i=u|0, t=u-i, t2=t*t, t3=t2*t;
  return GAM_KI3[i]*(2*t3-3*t2+1)+GAM_KI3[i+1]*(3*t2-2*t3)-GAM_KH*(GAM_KI2[i]*(t3-2*t2+t)+GAM_KI2[i+1]*(t3-t2)); }
/* Tracks across a square cell of side s cm centred on the origin: K angles on [0, pi), parallel lines at most d
   apart across each angle's projection. cell = {s, circ:[x,y,r,...], sub(x,y), n}; a segment's sub-region is
   read at its midpoint; cell.vol, when stated, the exact cm2 per sub-region the lengths are scaled to. Per track
   its weight d/2K and its (sub-region, cm) run; V the cm2 per sub-region, S the tracked perimeter cm. */
function gamTrack(cell,K,d){
  const h=cell.s/2, C=cell.circ, nc=C.length/3, off=[0], reg=[], len=[], wt=[], cut=[], V=new Float64Array(cell.n);
  let S=0;
  for(let k=0;k<K;k++){ const th=(k+.5)*Math.PI/K, ux=Math.cos(th), uy=Math.sin(th), W=h*(Math.abs(ux)+Math.abs(uy));
    const nL=Math.max(1,Math.ceil(2*W/d)), dl=2*W/nL, w=dl/(2*K);
    for(let l=0;l<nL;l++){ const t=-W+dl*(l+.5), x0=-uy*t, y0=ux*t;
      let a=-Infinity, b=Infinity;
      if(Math.abs(ux)>1e-12){ const p=(-h-x0)/ux, q=(h-x0)/ux; a=Math.max(a,Math.min(p,q)); b=Math.min(b,Math.max(p,q)); }
      if(Math.abs(uy)>1e-12){ const p=(-h-y0)/uy, q=(h-y0)/uy; a=Math.max(a,Math.min(p,q)); b=Math.min(b,Math.max(p,q)); }
      if(!(b>a)) continue;
      cut.length=0; cut.push(a,b);
      for(let q=0;q<nc;q++){ const cx=C[3*q]-x0, cy=C[3*q+1]-y0, r=C[3*q+2], m=cx*ux+cy*uy, e=m*m-(cx*cx+cy*cy-r*r);
        if(e>0){ const z=Math.sqrt(e); if(m-z>a && m-z<b) cut.push(m-z); if(m+z>a && m+z<b) cut.push(m+z); } }
      cut.sort((p,q)=>p-q);
      let last=-1;
      for(let i=0;i+1<cut.length;i++){ const L=cut[i+1]-cut[i]; if(!(L>0)) continue;
        const sm=(cut[i]+cut[i+1])/2, r=cell.sub(x0+ux*sm,y0+uy*sm);
        if(r===last) len[len.length-1]+=L; else { reg.push(r); len.push(L); last=r; }
        V[r]+=2*w*L; }
      off.push(reg.length); wt.push(w); S+=2*Math.PI*w; } }
  if(cell.vol) for(let i=0;i<len.length;i++){ const r=reg[i]; if(V[r]>0 && cell.vol[r]>0) len[i]*=cell.vol[r]/V[r]; }
  if(cell.vol) for(let r=0;r<cell.n;r++) if(V[r]>0 && cell.vol[r]>0) V[r]=cell.vol[r];
  let mx=0; for(let t=0;t+1<off.length;t++) mx=Math.max(mx,off[t+1]-off[t]);
  return {n:cell.n, off:Int32Array.from(off), reg:Int32Array.from(reg), len:Float64Array.from(len), wt:Float64Array.from(wt), V, S, mx}; }
/* First-flight collision probabilities of a tracked cell with a white edge, per photon group, off the Ki3
   integrals along each track (Hebert, Applied Reactor Physics, 2009, ch. 3). sig[i*GAM_NG+g] 1/cm. Per group:
   p and pS the reduced V sig P into each sub-region and out through the edge as tracked; P, PS the rows
   renormalised; PI[j] from the edge into j by reciprocity, 4 V sig P_jS / S; PSS across. */
function gamCP(T,sig){
  const n=T.n, NG=GAM_NG, o={p:[],pS:[],P:[],PS:[],PI:[],PSS:new Float64Array(NG)};
  const c=new Float64Array(T.mx+1), tau=new Float64Array(T.mx+1);
  for(let g=0;g<NG;g++){ const p=new Float64Array(n*n), pS=new Float64Array(n);
    for(let t=0;t+1<T.off.length;t++){ const a0=T.off[t], m=T.off[t+1]-a0, w=T.wt[t];
      c[0]=0; for(let a=0;a<m;a++){ tau[a]=sig[T.reg[a0+a]*NG+g]*T.len[a0+a]; c[a+1]=c[a]+tau[a]; }
      const Tt=c[m];
      for(let a=0;a<m;a++){ const ra=T.reg[a0+a], ta=tau[a], ca=c[a], cb=c[a+1];
        p[ra*n+ra]+=2*w*(ta-Math.PI/4+gamKi3(ta));
        pS[ra]+=w*(gamKi3(ca)-gamKi3(cb)+gamKi3(Tt-cb)-gamKi3(Tt-ca));
        for(let b=a+1;b<m;b++){ const gp=c[b]-cb; if(gp>=GAM_KX) break;
          const rb=T.reg[a0+b], v=w*(gamKi3(gp)-gamKi3(c[b]-ca)-gamKi3(c[b+1]-cb)+gamKi3(c[b+1]-ca));
          p[ra*n+rb]+=v; p[rb*n+ra]+=v; } } }
    const P=new Float64Array(n*n), PS=new Float64Array(n), PI=new Float64Array(n);
    let si=0;
    for(let i=0;i<n;i++) for(let j=0;j<n;j++) if(!(T.V[j]*sig[j*NG+g]>0)) p[i*n+j]=0;
    for(let i=0;i<n;i++){ const vs=T.V[i]*sig[i*NG+g]; let s=pS[i]; for(let j=0;j<n;j++) s+=p[i*n+j];
      if(!(vs>0 && s>0)){ PS[i]=1; continue; }
      for(let j=0;j<n;j++) P[i*n+j]=p[i*n+j]/s;
      PS[i]=pS[i]/s; PI[i]=4*vs*PS[i]/T.S; si+=PI[i]; }
    if(si>1) for(let j=0;j<n;j++) PI[j]/=si;
    o.p.push(p); o.pS.push(pS); o.P.push(P); o.PS.push(PS); o.PI.push(PI); o.PSS[g]=Math.max(0,1-si); }
  return o; }
/* The photon chain over a lattice of tracked fuel cells, with blocks (L_MOD), an absorber and tracked control
   channel cells between them. A photon leaving a fuel cell's edge enters a block with L.fM, the absorber with
   L.fA, a channel cell with L.fC, else another fuel cell; one leaving a channel cell enters a fuel cell with
   L.gF, a block with L.gM, else another channel cell; one leaving a block enters a channel cell with L.mC,
   else a fuel cell; one leaving the absorber enters a fuel cell. Blocks and absorber collide by Wigner's
   Sl/(1+Sl) on chords L.lM, L.lA cm. A collision leaves f = mu_en/mu behind and re-emits the rest down-group by
   GAM_TR. States: the fuel cell's n sub-regions, its edge, the blocks, the absorber, then the channel cell's
   L.nC sub-regions and its edge (L.cpC its probabilities, null for none); sig, f, src and dep are
   [state*GAM_NG+g]. Solved directly, x = src + Px; every state's exits sum to one, so the solve conserves to
   round-off. */
function gamChain(cp,n,L,sig,f,src,dep){
  const NG=GAM_NG, cq=L.cpC, m=cq ? L.nC : 0, iJ=n, iM=n+1, iA=n+2, c0=n+3, iK=c0+m, NS=cq ? iK+1 : c0, N=NS*NG;
  const A=new Float64Array(N*N), x=Float64Array.from(src.subarray(0,N));
  const fC=cq ? L.fC : 0, fJ=1-L.fM-L.fA-fC, gK=cq ? 1-L.gF-L.gM : 0, mC=cq ? L.mC : 0;
  const pcW=(st,g)=>{ const sl=sig[st*NG+g]*(st===iM ? L.lM : L.lA); return isFinite(sl) ? sl/(1+sl) : 1; };
  const coll=(j,g,col,q)=>{ const mm=q*(1-f[j*NG+g]); if(mm) for(let h=0;h<=g;h++) A[(j*NG+h)*N+col]-=mm*GAM_TR[g*NG+h]; };
  const go=(st,g,col,v)=>{ if(v) A[(st*NG+g)*N+col]-=v; };
  for(let i=0;i<N;i++) A[i*N+i]=1;
  for(let g=0;g<NG;g++){
    for(let i=0;i<=n;i++){ const col=(i<n ? i : iJ)*NG+g, e= i<n ? cp.PS[g][i] : cp.PSS[g];
      for(let j=0;j<n;j++) coll(j,g,col, i<n ? cp.P[g][i*n+j] : cp.PI[g][j]);
      go(iJ,g,col,e*fJ); go(iM,g,col,e*L.fM); go(iA,g,col,e*L.fA); if(cq) go(iK,g,col,e*fC); }
    if(cq) for(let i=0;i<=m;i++){ const col=(i<m ? c0+i : iK)*NG+g, e= i<m ? cq.PS[g][i] : cq.PSS[g];
      for(let j=0;j<m;j++) coll(c0+j,g,col, i<m ? cq.P[g][i*m+j] : cq.PI[g][j]);
      go(iJ,g,col,e*L.gF); go(iM,g,col,e*L.gM); go(iK,g,col,e*gK); }
    for(const st of [iM,iA]){ const col=st*NG+g, pc=pcW(st,g), k= st===iM ? mC : 0;
      coll(st,g,col,pc); go(iJ,g,col,(1-pc)*(1-k)); if(cq) go(iK,g,col,(1-pc)*k); } }
  for(let k=0;k<N;k++){ let p=k, big=Math.abs(A[k*N+k]);
    for(let i=k+1;i<N;i++) if(Math.abs(A[i*N+k])>big){ big=Math.abs(A[i*N+k]); p=i; }
    if(p!==k){ for(let j=0;j<N;j++){ const y=A[k*N+j]; A[k*N+j]=A[p*N+j]; A[p*N+j]=y; } const y=x[k]; x[k]=x[p]; x[p]=y; }
    const d=A[k*N+k]; if(!(Math.abs(d)>0)) continue;
    for(let i=k+1;i<N;i++){ const l=A[i*N+k]/d; if(!l) continue;
      for(let j=k;j<N;j++) A[i*N+j]-=l*A[k*N+j]; x[i]-=l*x[k]; } }
  for(let k=N-1;k>=0;k--){ let s=x[k]; for(let j=k+1;j<N;j++) s-=A[k*N+j]*x[j]; x[k]= A[k*N+k] ? s/A[k*N+k] : 0; }
  dep.fill(0);
  const cells=[[cp,n,0,iJ]]; if(cq) cells.push([cq,m,c0,iK]);
  for(let g=0;g<NG;g++){
    for(const [C,nn,o,e] of cells) for(let j=0;j<nn;j++){ let cl=x[e*NG+g]*C.PI[g][j];
      for(let i=0;i<nn;i++) cl+=x[(o+i)*NG+g]*C.P[g][i*nn+j];
      dep[(o+j)*NG+g]=cl*f[(o+j)*NG+g]; }
    for(const st of [iM,iA]) dep[st*NG+g]=x[st*NG+g]*pcW(st,g)*f[st*NG+g]; }
  return dep; }
/* The fission partition meeting the deposition: g[0..4] the gammas' (and captures') share of PROMPT heat in
   the water, the blocks, the structures, the absorber and the control channels, g[5..9] the same of DECAY
   heat; fn the neutrons' share of prompt heat, cc, mb and cx the moderation weights of water, blocks and
   channel water, a the void. Writes each of the five its share of prompt heat then of decay heat, into o at b. */
function heatSplitA(g,fn,cc,mb,cx,a,o,b){
  const cw=cc*(1-a), n=cw+mb+cx, nw=n>0?cw/n:0, nb=n>0?mb/n:0, nx=n>0?cx/n:0;
  o[b  ]=fn*nw+g[0]; o[b+1]=g[5];
  o[b+2]=fn*nb+g[1]; o[b+3]=g[6];
  o[b+4]=g[2];       o[b+5]=g[7];
  o[b+6]=g[3];       o[b+7]=g[8];
  o[b+8]=fn*nx+g[4]; o[b+9]=g[9]; }
/* 2200 m/s absorption sa and scattering ss (free atom: Sears 1992 bound x (A/(A+1))^2), barns; Ec the capture
   gamma MeV (the neutron separation energy of the product, AME2020, weighted by each isotope's share of
   capture where the element has several), loc MeV a capture leaves as charged particles. sa: Mughabghab 2006
   as commonly quoted, not read at source; the heavy nuclides ENDF/B-VII.1 at 293.6 K (Pritychenko &
   Mughabghab 2012, arXiv:1208.2879, read 22/09/26). Li7 is MSRE lithium, 99.99 % Li-7. B-10: (n,alpha) 3837 b
   (Mughabghab, as commonly quoted) plus (n,gamma) 0.4999 b (Pritychenko & Mughabghab 2012 Table IV, read), a 0.478
   MeV gamma 94 % of the time and 2.3 MeV to the alpha and Li-7 ion; B-11 (n,gamma) 0.0055 b (same Table IV); their
   bound scattering 3.1 and 5.77 b (Sears 1992, as commonly quoted). Natural B is the two at B10_NAT. */
const NUC={H:{sa:.3326,ss:20.49,Ec:2.2246},He:{sa:0,ss:.86,Ec:0},Li:{sa:70.5,ss:1.05,Ec:2.03},Li7:{sa:.111,ss:.74,Ec:2.03},
  Be:{sa:.0076,ss:6.15,Ec:6.812},B10:{sa:3837.5,ss:2.563,Ec:.449,loc:2.34},B11:{sa:.0055,ss:4.849,Ec:3.370},C:{sa:.0035,ss:4.73,Ec:4.946},O:{sa:.00019,ss:3.75,Ec:4.143},
  F:{sa:.0096,ss:3.64,Ec:6.601},Na:{sa:.530,ss:3.0,Ec:6.960},Mg:{sa:.063,ss:3.42,Ec:8.4},Zr:{sa:.185,ss:6.32,Ec:8.1},
  Ag:{sa:63.3,ss:4.9,Ec:6.95},Cd:{sa:2520,ss:6.4,Ec:9.043},In:{sa:193.8,ss:2.6,Ec:6.784},Hf:{sa:104,ss:10.2,Ec:7.2},
  U235:{sa:683.7,sf:585.0,nu:2.4367,ss:15.1,Ec:6.545},U238:{sa:2.683,ss:9.28,Ec:4.806},Pu239:{sa:1018.6,sf:747.9,nu:2.8836,ss:7.98,Ec:6.534}};
/* The one-group fast book saF/sfF: the kT = 30 keV Maxwellian average of ENDF/B-VII.1 (Pritychenko & Mughabghab
   2012, Tables XI capture and XII fission, read 22/09/26), an element its isotopes at IUPAC natural abundance (as
   commonly quoted), O as O-16. Those tables are (n,gamma) and fission only, so a charged-particle channel (B-10
   n,alpha; Li-6 n,t) is its 2200 m/s figure on 1/v, whose Maxwellian average at kT is sigma(kT). nu stays the
   thermal one: it rises about 0.13 per MeV. A 30 keV Maxwellian is softer than a sodium core's spectrum and carries
   no neutrons over U-238's fission threshold. */
const MACS_KT=30000, E_2200=0.0253;
const mixIso=a=>{ let s=0,w=0; for(const [x,v] of a){ s+=x*v; w+=x; } return s/w; };
const FAST_G={H:1.525e-4,He:0,Li:mixIso([[.0759,3.276e-5],[.9241,4.645e-5]]),Li7:4.645e-5,Be:9.298e-6,B10:4.299e-4,B11:6.575e-5,
  C:1.623e-5,O:3.154e-5,F:4.362e-3,Na:1.829e-3,Mg:mixIso([[.7899,3.793e-3],[.1000,5.279e-3],[.1101,8.645e-5]]),
  Zr:mixIso([[.5145,1.891e-2],[.1122,7.361e-2],[.1715,4.543e-2],[.1738,2.900e-2],[.0280,1.025e-2]]),
  Ag:mixIso([[.51839,.8292],[.48161,.9100]]),
  Cd:mixIso([[.0125,.4964],[.0089,.3998],[.1249,.2349],[.1280,.9238],[.2413,.2179],[.1222,.6822],[.2873,.1497],[.0749,.09078]]),
  In:mixIso([[.0429,.9221],[.9571,.7715]]),
  Hf:mixIso([[.0016,.9496],[.0526,.4531],[.1860,1.387],[.2728,.2960],[.1362,.9788],[.3508,.2320]]),
  U235:.6926,U238:.4004,Pu239:.5278};
const FAST_F={U235:2.204,U238:7.988e-5,Pu239:1.822};
/* the thermal (n,gamma) of Li-6 0.0385 b and Li-7 0.0454 b (Table IV) taken out, the rest is Li-6 (n,t) */
const FAST_PA={B10:3837, Li:NUC.Li.sa-mixIso([[.0759,.0385],[.9241,.0454]]), Li7:NUC.Li7.sa-mixIso([[.0001,.0385],[.9999,.0454]])};
for(const e in NUC){ const f=FAST_F[e]||0;
  NUC[e].saF=FAST_G[e]+(FAST_PA[e]||0)*Math.sqrt(E_2200/MACS_KT)+f; NUC[e].sfF=f; }
/* a mix of nuclides at atom fractions x: sums per atom, capture energies weighted by capture */
function nucMix(x){ const o={sa:0,ss:0,saF:0,sfF:0,Ec:0,loc:0}; let c=0;
  for(const e in x){ const d=NUC[e], w=x[e], ce=w*(d.sa-(d.sf||0));
    o.sa+=w*d.sa; o.ss+=w*d.ss; o.saF+=w*d.saF; o.sfF+=w*d.sfF; o.Ec+=ce*d.Ec; o.loc+=ce*(d.loc||0); c+=ce; }
  if(c>0){ o.Ec/=c; o.loc/=c; }
  return o; }
NUC.B=nucMix({B10:B10_NAT,B11:1-B10_NAT});
/* Westcott g(T) for the fissile nuclides, absorption and fission, at 20..1000 C (Westcott, AECL-1101, 1960,
   as reproduced in Lamarsh, Introduction to Nuclear Reactor Theory, Table 3.3; typed from that reproduction,
   not read at AECL source). Every other absorber is 1/v, g = 1. */
const WESTCOTT={T:[293.15,373.15,473.15,673.15,873.15,1073.15,1273.15],
  U235:{ga:[.9780,.9653,.9537,.9380,.9312,.9294,.9309],gf:[.9759,.9616,.9481,.9297,.9221,.9197,.9208]},
  Pu239:{ga:[1.0723,1.1310,1.2146,1.4436,1.6624,1.8134,1.8946],gf:[1.0487,1.0932,1.1685,1.3930,1.6200,1.7868,1.8889]}};
/* g and dg/dT by the piecewise line through the table, flat past its ends */
function westcottA(nuc,key,T,o){ const W=WESTCOTT, t=W.T, y=W[nuc][key], n=t.length;
  if(T<=t[0]){ o[0]=y[0]; o[1]=(y[1]-y[0])/(t[1]-t[0]); return; }
  if(T>=t[n-1]){ o[0]=y[n-1]; o[1]=0; return; }
  let i=0; while(T>t[i+1]) i++;
  const s=(y[i+1]-y[i])/(t[i+1]-t[i]); o[0]=y[i]+s*(T-t[i]); o[1]=s; }

/* boron:false a coolant that carries no dissolved boron, so its core is held by the bank; qpp MW/m2; modK/absK per unit volume against light water; dens at own Tref on RHO_K's scale, tsat, hfg and cp: stated by any fluid but water, whose figures are IAPWS-IF97 at its own P0 and Tref (coolFig()); tc/pc/rhoc K/MPa/kg/m3; Tref the PROGRAMMED coolant temperature; pipeK spent per metre drawn; dnbLaw picks the limit (dnbrOf(), step.js); xOut, a boiling row's core exit quality, stands in for dT0 (coolFig()). */
const COOLANT=[
 {id:"PWR", name:"PRESSURISED WATER", tie:"WESTINGHOUSE / VVER", mass:340,comp:{H:2,O:1},
  P0:15.5,pipeK:1.00,col:"#5aa9d6",dT0:30,dpCore:0.30,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:583,aF:-2.8,modK:1.00,absK:1.00,qpp:1.80,grace:1.0,dnbr:1.85,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.504,solidK:1.4,dump:.40,
  good:"Dense, well understood, strongly self-limiting",
  bad:"15.5 MPa vessel is heavy; a breach depressurises violently"},
 {id:"BWR", name:"BOILING WATER", tie:"GE MARK I", mass:265,comp:{H:2,O:1},
  P0:7.0,pipeK:1.00,col:"#5aa9d6",xOut:0.146,dpCore:0.15,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:559,aF:-2.8,modK:1.00,absK:1.00,qpp:1.71,grace:0.9,dnbr:1.55,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.496,solidK:1.5,dump:.25,
  good:"Direct cycle, lighter, power follows flow instantly",
  bad:"Turbine hall is radioactive; margin to dryout is thin"},
 /* aF is a BEHAVIOUR FIT, not the published figure: INSAG-7 table II-I measured -1.2 pcm/K on Chernobyl Unit 4, and
    at -1.2 this drawing's fast power coefficient is positive at every power it can run. -4.0 puts the zero crossing at
    52 %, which is the behaviour INSAG states - unstable low, stable above 50 %. See fidelity "RBMK stability". */
 {id:"LWGR",name:"PRESSURE TUBE WATER", tie:"RBMK-1000", mass:250,comp:{H:2,O:1},
  P0:6.9,pipeK:1.00,col:"#5aa9d6",xOut:0.145,dpCore:1.00,mu:8.6e-5,muV:2.0e-5,vLeg:15,hFilm:30000,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:550,aF:-4.0,modK:1.00,absK:1.00,qpp:0.99,grace:1.2,dnbr:1.60,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.466,solidK:1.5,dump:.25,
  good:"Cheap fuel, refuels online, boils in the channel itself",
  bad:"Lay graphite around it and the water is a poison, not a moderator"},
 {id:"SFR", name:"LIQUID SODIUM", tie:"EBR-II / BN-800", mass:210,comp:{Na:1},
  P0:0.2,pipeK:2.00,col:"#c8b8a0",tsat:1150,hfg:4260,cp:1.25,dT0:170,dpCore:0.50,mu:2.5e-4,muV:2.0e-5,vLeg:8,hFilm:60000,mmol:.02299,tc:2573,pc:25.6,rhoc:219,Tref:723,aF:-1.2,modK:.05,absK:.15,dens:121,qpp:5.04,grace:6.0,dnbr:3.20,dnbLaw:"boil",burn:"NA",bulk:5.8e9,xe:1.0,flowMin:.20,eff:.633,solidK:1.4,dump:.40,boron:false,
  good:"Atmospheric pressure, very light, huge boiling margin",
  bad:"Barely slows a neutron, so a core cooled by it is a FAST core"},
 /* the fuel is dissolved in this salt, so it is the MSRE FUEL salt: cp 0.47 Btu/lb/F and 141 lb/ft3 at 1200 F over RHO_K, as commonly quoted from ORNL-4541, not read at source */
 {id:"MSR", name:"MOLTEN SALT", tie:"MSRE", mass:230,comp:{Li7:.65,Be:.291,Zr:.05,U:.009,F:1.468},
  P0:0.2,pipeK:2.40,col:"#8fd18a",fuelInCoolant:true,tsat:1700,hfg:4500,cp:0.47*4.1868,dT0:140,dpCore:0.04,mu:6.0e-3,muV:3.0e-5,vLeg:5,hFilm:6000,mmol:.0433,tc:4500,pc:160,rhoc:460,Tref:922,aF:-3.5,modK:.35,absK:.18,dens:141*16.0185/7,qpp:1.44,grace:9.0,dnbr:3.00,dnbLaw:"boil",xe:0.15,flowMin:.20,eff:.697,solidK:0.5,dump:.40,
  good:"No pressure; gases stripped online, almost no xenon pit",
  bad:"Corrodes continuously; freezes solid if it gets cold"},
 {id:"HTGR",name:"HELIUM GAS", tie:"HTR-PM", mass:260,comp:{He:1},
  P0:7.0,pipeK:2.60,col:"#c8a8d8",tsat:2000,hfg:20.9,cp:5.19,dT0:250,dpCore:0.06,mu:4.5e-5,muV:4.5e-5,vLeg:60,hFilm:1500,mmol:.004,satN:.10,tc:5.195,pc:.227,rhoc:69.6,Tref:773,aF:-4.5,modK:0,absK:0,dens:0.62,gam:1.667,qpp:0.108,grace:40,dnbr:2.60,dnbLaw:"temp",xe:1.0,flowMin:.15,eff:.623,solidK:0.009,dump:.40,boron:false,
  good:"Cannot melt. Grace time in hours, not seconds. Voids into nothing",
  bad:"Moderates nothing at all - draw the moderator or draw a fast core"},
 /* Calder Hall as designed (Nuclear Engineering, Dec. 1956, "The World's Reactors No. 6", off the BNEC Calder Works symposium): 100 psig, 140 C in, 336 C out, 1964 lb/s, circuit drop 5.53 psi, can surface design maximum 408 C; NIST WebBook: Shomate 298-1200-6000 K, M, Tc/Pc/rhoc (Suehiro 1996), hfg at 258 K (never reached), mu at 500 K / 0.7 MPa; dens and gam ideal gas at P0/Tref; hFilm Dittus-Boelter on the zone B channel annulus (3.95 in bore, 54 mm element) at 891/1696 kg/s; qpp that film from the mean gas, where the peak node sits at mid-height, to the 408 C can; aF -1.7e-5/C (JAERI-1006-A); dpCore the whole circuit's drop; modK/absK 0 at 1/100 of water's density; eff FIT so the design efficiency is the sheet's 42 MWe of 182 MWt; grace, dnbr, xe, flowMin, pipeK, vLeg, mass are game figures */
 {id:"CO2", name:"CARBON DIOXIDE GAS", tie:"CALDER HALL", mass:260,comp:{C:1,O:2},
  P0:0.7908,pipeK:2.60,col:"#b8c890",tsat:5000,hfg:372.6,cp:1.0212,dT0:196,dpCore:0.0381,mu:2.40e-5,muV:2.40e-5,vLeg:60,hFilm:234,mmol:.0440095,satN:.10,tc:304.18,pc:7.380,rhoc:466.5,Tref:511.15,aF:-1.7,modK:0,absK:0,dens:1.1699,gam:1.227,qpp:0.03978,grace:40,dnbr:2.60,dnbLaw:"temp",xe:1.0,flowMin:.15,eff:.324,solidK:0.001547,dump:.40,boron:false,
  sho:[1200,24.99735,55.18696,-33.69137,7.948387,-0.136638,-403.6075,228.2431,-393.5224, 6000,58.16639,2.720074,-0.492289,0.038844,-6.447293,-425.9186,263.6125,-393.5224],
  good:"Cheap, inert with graphite, and it cannot boil",
  bad:"A thin gas at low pressure: it needs a huge core, finned cans and big blowers to carry the heat away"},
];
/* Clausius-Clapeyron about the fluid's own boiling point, anchored on SAT_WATER; satN overrides it (helium is supercritical throughout). */
const R_GAS=8.314, SATN_MMOL=.018;
const ccSlope = (f, mmol) => R_GAS*f.tsat/(f.hfg*1000*mmol);
const coolSatN = a => a.satN!=null
  ? a.satN : SAT_WATER.n*ccSlope(coolFig(a), a.mmol)/ccSlope({tsat:SAT_WATER.T0, hfg:SAT_WATER.hfg}, SATN_MMOL);
/* kJ/kg/K of nuclear graphite, Butland & Maddison (J. Nucl. Mater. 49, 1973), their fit in cal/g/K */
function graphCpA(io, k, o){ const T = io[k], i = 1/T;
  io[o] = 4.184*(0.54212 - 2.42667e-6*T - i*(90.2725 + i*(43449.3 - i*(1.59309e7 - i*1.43688e9)))); }
const GCP_IO = new Float64Array(2);
const graphCp = T => { GCP_IO[0] = T; graphCpA(GCP_IO, 0, 1); return GCP_IO[1]; };
/* Irradiated graphite, one curve for every grade: saturated damage fixes the phonon mean free path, so k
   follows cp (Kelly, Physics of Graphite, ch. 4). K_G25 W/m/K at 25 C, the middle of IG-110 irradiated at
   450-750 C and measured at 25 C, 10-26 W/m/K (ORNL/TM-2018/1040, App. B.5.1, read 22/09/26). */
const K_G25=15, GCP_25=graphCp(298.15);
function graphKA(io, k, o){ graphCpA(io, k, o); io[o] *= K_G25/GCP_25; }
/* BeO alpha phase, NIST WebBook Shomate (Chase 1998, read 22/09/26), J/mol/K over 25.0116 g/mol */
function beoCpA(io, k, o){ const t = io[k]/1000, lo = t < 0.8;
  const A = lo ? 3.358974 : 47.06205, B = lo ? 131.5922 : 5.598359, C = lo ? -140.4937 : -0.495570, D = lo ? 56.20953 : 0.054527, E = lo ? -0.536669 : -2.947373;
  io[o] = (A + t*(B + t*(C + t*D)) + E/(t*t))/25.0116; }
/* BeO W/m/K, unirradiated sintered, Incropera & DeWitt Table A.2 (TPRC), as commonly quoted, not read at source; a line between points, flat past the ends */
const BEO_KT=[300,400,600,800,1000,1200,1500], BEO_K=[272,196,111,70,47,33,21.5];
function beoKA(io, k, o){ const T = io[k], t = BEO_KT, n = t.length;
  if(T <= t[0]){ io[o] = BEO_K[0]; return; }
  if(T >= t[n-1]){ io[o] = BEO_K[n-1]; return; }
  let i = 0; while(T > t[i+1]) i++;
  io[o] = BEO_K[i] + (BEO_K[i+1] - BEO_K[i])*(T - t[i])/(t[i+1] - t[i]); }
/* ZrH1.6: flat 0.40 kJ/kg/K and 17.6 W/m/K, as commonly quoted from the TRIGA literature (Simnad, Nucl. Eng. Des. 64, 1981), not read at source */
function zrhCpA(io, k, o){ io[o] = 0.40; }
function zrhKA(io, k, o){ io[o] = 17.6; }
/* modK against light water, dens for latMass(), comp for the gamma cell and the absorption book, alpha linear expansion 1/K, cpA
   kJ/kg/K and kA W/m/K at io[k] into io[o], allocation-free for the tick. Every drawn block has a
   temperature of its own (modOwnT()). */
const MODER=[
 /* alpha 4.5e-6 per K at 350-450 C, Toyo Tanso property data for IG-11, read 23/09/26; IG-110 is its nuclear grade, as commonly quoted */
 {name:"GRAPHITE",modK:.95,dens:1.70,comp:{C:1},cpA:graphCpA,kA:graphKA,alpha:4.5e-6,
  note:"The classic solid moderator. Slows neutrons well over many collisions, so a graphite core is large and dilute - and the water in it becomes a net absorber, which is what makes a channel-water graphite plant void POSITIVE."},
 /* alpha 8e-6 per K, as commonly quoted, not read at source */
 {name:"BERYLLIUM OXIDE",modK:1.35,dens:3.00,comp:{Be:1,O:1},cpA:beoCpA,kA:beoKA,alpha:8e-6,
  note:"Better than graphite per litre and it multiplies neutrons on top, so a smaller core reaches the same spectrum. Heavy for what it is, and it pushes the void coefficient positive the same way the reflector does."},
 /* alpha 9e-6 per K, as commonly quoted, not read at source (Simnad 1981 searched 23/09/26, not reached) */
 {name:"ZIRCONIUM HYDRIDE",modK:1.80,dens:5.60,comp:{Zr:1,H:1.6},cpA:zrhCpA,kA:zrhKA,alpha:9e-6,
  note:"Hydrogen locked into a solid: the densest moderation you can lay, so a very compact thermal core is possible. It is also the heaviest, and hydrogen leaves it if it gets hot enough."},
];
const modOwnT = c => latVols(c).mod > 0;
/* tdmg K where damage starts and the RPS trips 100 K above it; tmelt the fuel's melting point (solidus); alpha linear expansion 1/K; rho kg/m3, k W/m/K the pellet rise reads, kint kW/m the conductivity integral to melt the rating reads, M kg/mol, hfus kJ/mol; ph the phase law [Thi K, cp = a + bT + cT^2 + dT^3 + e/T^2 J/mol/K, latent J/mol at Thi], absent = UO2 on Fink. UO2 figures: rho 95 % TD, k near 900-1200 K (MATPRO), kint to melt (published), fusion Fink 2000. MOX is carried on UO2's figures. enr the U-235 weight fraction of the uranium, pu the Pu-239 atom fraction of the heavy metal, both fresh: the names' own figures, natural uranium's 0.711 %, MSRE's 33 % (Haubenreich & Engel 1970, as commonly quoted); U-ZR carries the HEU row's and MOX a typical LWR loading on tails, neither a published core. */
/* kg/mol of U-10Zr off the handbook's Zr atom fraction (SAS4A eq. 10.3-111) and U's 0.23803 */
const UZR_AZ=1.627*0.1/(0.6272+0.1), UZR_M=(1-UZR_AZ)*0.23803/0.9;
/* hm the heavy-metal mass share; bu the discharge burnup MWd/kgHM and dl the linear strain at each ph transition, both as commonly quoted, not read at source */
const UO2_HM=0.23803/0.27003;
const FUEL=[
 {name:"UO2  3.2% LEU",enr:.032,beta:680,excess:6200,rho:10400,k:3.0,kint:6.3,M:.27003,comp:{U:1,O:2},hfus:70,disp:280*4.184,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:0,hm:UO2_HM,bu:33,
  note:"Low enrichment. The most forgiving kinetics you can buy at 680 pcm of delayed neutrons, but a short campaign and modest power density."},
 {name:"UO2  4.9% LEU",enr:.049,beta:650,excess:7200,rho:10400,k:3.0,kint:6.3,M:.27003,comp:{U:1,O:2},hfus:70,disp:280*4.184,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:8,hm:UO2_HM,bu:50,
  note:"Standard commercial fuel. Balanced across every axis and the baseline everything else is measured against."},
 {name:"UO2 19.7% HEU",enr:.197,beta:640,excess:10200,rho:10400,k:3.0,kint:6.3,M:.27003,comp:{U:1,O:2},hfus:70,disp:280*4.184,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:-18,hm:UO2_HM,bu:100,
  note:"Naval-grade enrichment. Far more excess reactivity and power density, so the core is smaller, but you need a lot of rod worth and boron to hold it down."},
 {name:"MOX PLUTONIUM",enr:.0025,pu:.05,beta:300,excess:8500,rho:10400,k:3.0,kint:6.3,M:.27003,comp:{U:1,O:2},hfus:70,disp:280*4.184,dng:"PU239",alpha:1.1e-5,tdmg:1450,tmelt:3050,mass:-12,hm:UO2_HM,bu:45,
  note:"Dense and hot. Beta collapses to 300 pcm, which halves the distance to prompt criticality. Every reactivity mistake is twice as fast."},
 /* U-10Zr, IFR Metallic Fuels Handbook via SAS4A/SASSYS-1 5.7 ch. 10.3: rho 293 K Table 10.3.2, cp Billone eq. 10.3-108 (J/kg/K times M) with its 1506-1669 K melting-range excess over the liquid taken as fusion at the solidus, k eq. 9.8-36 at 800 K and integrated 773-1506 K */
 {name:"U-ZR METALLIC",enr:.197,beta:640,excess:8000,rho:16020,k:28.39,kint:28.97,M:UZR_M,comp:{U:1-UZR_AZ,Zr:UZR_AZ},hfus:(580.7-221.9)*(1669-1506)*UZR_M/1000,disp:280*4.184,
  ph:[[1000,6.625*UZR_M,0.3066*UZR_M,0,0,4.58e6*UZR_M,0],[1506,180.1*UZR_M,0,0,0,0,0],[Infinity,221.9*UZR_M,0,0,0,0,0]],
  alpha:1.7e-5,tdmg:1150,tmelt:1506,mass:-25,hm:0.9,bu:100,
  note:"Metal fuel conducts heat roughly twice as well as ceramic, so fuel runs far cooler for the same power. Melts at a lower temperature though."},
 /* natural U metal: phases, cp and latent heats Kim & Hofman, ANL AAA Fuels Handbook (2003) sec. 2.6, Tables 2-13/2-14 (Oetting 1976); rho the Calder bar's (Nuclear Engineering, Dec. 1956); k IFR handbook via SAS4A Table 10.3.4 at 698 K and integrated from the 408 C can to 942 K; alpha off Imhoff LA-UR-21-21810 alpha-phase density; beta U-235 thermal only; excess the volume mean of Calder Hall's zone k-inf (Dec. 1956) at 425 C fuel; tdmg the alpha-beta change */
 {name:"U METAL NATURAL",enr:.00711,beta:650,excess:6218,rho:18700,k:36.4,kint:10.21,M:.23803,comp:{U:1},hfus:9.142,disp:280*4.184,
  ph:[[942,24.959,2.132e-3,2.370e-5,0,0,2791],[1049,42.928,0,0,0,0,4757],[1408,38.284,0,0,0,0,0],[Infinity,48.660,0,0,0,0,0]],
  alpha:7.97e-6,tdmg:942,tmelt:1408,mass:0,hm:1,bu:4,dl:[0.0106/3,0.0070/3,0,0],
  note:"Natural uranium metal, the first power fuel. Needs no enrichment and conducts heat very well, but it changes crystal form at 669 C and grows under irradiation, so it must be kept cool - which is why the reactors that burned it were huge."},
 /* MSRE fuel salt 65-29.1-5-0.9 LiF-BeF2-ZrF4-UF4, ORNL-4541 as commonly quoted, not read at source; tdmg the salt row's boiling, excess the UO2 4.9 % row's */
 {name:"MSRE FUEL SALT",enr:.33,beta:666,excess:7200,rho:2259,k:1.4,kint:0,M:.04173,comp:{Li7:.65,Be:.291,Zr:.05,U:.009,F:1.468},
  hfus:0,disp:280*4.184,alpha:0,tdmg:1700,tmelt:707.15,mass:0,hm:.009*.23803/.04173,bu:0,
  note:"The fuel is dissolved in the coolant: no pellet, no clad, no gap. Fission heats the salt itself, and the delayed neutrons' parents ride the loop out of the core, so it answers faster than its beta says."},
];
/* Keepin (1965) six-group delayed-neutron shapes per fissioning nuclide, abundances summing to 1; a FUEL row names its `dng`, absent = U-235 thermal */
const DNG={U235:{bet:[.033,.219,.196,.395,.115,.042],lam:[.0124,.0305,.111,.301,1.14,3.01]},
 PU239:{bet:[.038,.280,.216,.328,.103,.035],lam:[.0129,.0311,.134,.331,1.26,3.21]}};
const dngOf = r => DNG[(r && r.dng) || "U235"] || DNG.U235;
/* dens is what latMass() weighs the drawn band with: a reflector is a thickness on a face, not a flat tonnage. */
const REFL=[
 {name:"NONE",dRho:0,dV:0,dens:0,note:"Neutrons that leak out are lost. Simplest and lightest option, because there is nothing there."},
 {name:"STEEL",dRho:250,dV:0,dens:7.9,note:"Reflects some leakage back into the core, worth about 250 pcm at one ring of thickness. Dense, so a thick band is expensive."},
 {name:"BERYLLIUM",dRho:750,dV:120,dens:1.85,note:"The best reflector available, worth 750 pcm, and light enough to use thickly. Its (n,2n) reaction also pushes the void coefficient in the positive direction."},
 {name:"GRAPHITE",dRho:520,dV:60,dens:1.7,note:"Good reflector, cheap and light, with a mild positive shift to the void coefficient."},
];
const SCRAM=[
 {name:"GRAVITY DROP",rate:.45,mass:20,note:"Fail-safe on loss of power, but slow, and it slows further under hull acceleration."},
 {name:"SPRING ASSISTED",rate:.90,mass:45,note:"Twice as fast. Its accumulators must be kept charged to work."},
 {name:"BORON INJECTION",rate:2.5,mass:30,note:"Near instant. Irreversible: the loop stays poisoned for the rest of the mission."},
 {name:"MOTOR DRIVEN",rate:0.4/7,mass:20,note:"Every rod driven in by its own servo at 0.4 m/s, the RBMK-1000's 18-21 s over a 7 m core (INSAG-7). No faster than normal operation, so a scram is a slow push, not a drop."},
];
/* tipLen and tipGap are fractions of the core's height: the follower hangs tipGap under the absorber's tip, tipLen long; the displacer's are the RBMK-1000's 4.5 m and 1.25 m on a 7 m core (INSAG-7) */
const FOLL=[
 {name:"WATER",tipRho:0,tipLen:0,tipGap:0,mass:0,
  note:"Nothing below the absorber but coolant. Inserting the bank only ever removes reactivity, all the way in. The dull, safe, correct answer."},
 {name:"GRAPHITE DISPLACER",tipRho:1200,tipLen:4.5/7,tipGap:1.25/7,mass:-14,
  note:"A graphite follower keeps water out of the channel below the absorber, so the core wastes fewer neutrons on coolant and the bank is lighter and quicker. It also means the first thing a scram does is drive graphite through the BOTTOM of the core, adding reactivity down there before any absorber arrives. This is the Chernobyl scram."},
 {name:"BORATED STEEL",tipRho:-420,tipLen:0.4,tipGap:0,mass:34,
  note:"A poisoned follower. The bank bites early and there is no positive excursion anywhere in its travel, at the price of carrying that poison all campaign - and of the mass."},
];
/* `water` m³ of secondary water ONE generator holds at 100 % level, the whole of the boil-dry mechanic; a holdup is a VOLUME here as it is everywhere else, and `sgMassOf()` weighs it at the shell's own state - 74.3 m³ is the ~55 t a Westinghouse U-tube unit carries. `tubeV` m³ of PRIMARY water inside the tubes and heads, which is a different inventory on the other side of the wall: a Model F's 5626 tubes of 15.3 mm bore over 20 m hold 21 m³ and the channel head the rest, while a once-through unit is the other way round - little in the shell, a long bundle full of it. `tube` t of BUNDLE STEEL, the shell priced separately (sgSteelT(), layout.js). */
const SGT=[
 {name:"U-TUBE",water:74.3,tubeV:30,tube:63.3,note:"Large secondary water inventory acts as a heat sink for minutes after feedwater is lost. Heavy and slow to respond."},
 {name:"ONCE-THROUGH",water:9.5,tubeV:45,tube:41.1,note:"Very little water in it, so it responds instantly to load changes and boils dry almost as fast. Light."},
];
/* The MEAN over the generators drawn, never the sum - both readers are plant-wide flywheel terms - normalised so a stock plant reads exactly 1.0. */
const SG_MASS_REF = 72.25;   // t, re-measured 09/09/26 when the shell's stated volume became 74.3 m3
const sgInertiaK = () => { let n=0,m=0;
  for(const p of LAY.parts) if(p.role==="sg"){ m+=sgSteelT(p.id); n++; }
  return (n?m/n:SG_MASS_REF) / SG_MASS_REF; };
const BKP=[
 {name:"NONE",bk:0,mass:0,note:"Lose main power and the coolant pumps stop dead. Only natural circulation remains."},
 {name:"BATTERY BANK",bk:.5,mass:22,note:"Keeps one pump turning at half speed through a blackout."},
 {name:"DIESEL GENERATORS",bk:1.0,mass:58,note:"Full pump power independent of the plant. Heavy, and one more thing to maintain."},
];
COOLANT.forEach(a=>a.note=a.tie+". "+a.good+", but "+a.bad.replace(/^[A-Z]/,c=>c.toLowerCase())+".");
const BUDGET=3000;
/* Where the control bank stands at commissioning: boronated critical here, shutdown margin measured from here, resetPlant() starts here. */
const RODX0=.35;
/* `??`, never `||`, or a legitimate zone 0 falls through to the fallback. */
const zoneFuelOf = (c,z) => c.zoneFuel[z] ?? c.fuel;
const CORE_KEYS=["cool","fuel","zoneFuel","mod","refl","poison","pitch","hd","power","chim","scram","rodw","foll","nbank","rodD","rodP","clad","fin","rodSpd","absD","absN","absEnr","colGap"];
const CORE_DEFAULT={cool:0,fuel:1,mod:0,refl:1,poison:400,pitch:1.0,hd:1.0,power:1200,chim:.3,scram:0,rodw:2600,foll:0,nbank:4};
const coreD = id => D.cores[id];
const priD = () => D.cores[primaryCore()] || coreNone();
const coreBag = id => (id!=null && D.cores[id]) || priD();
const ratedMWt = () => { let p=0; for(const id of coreIds()) p+=D.cores[id].power; return p; };
/* `raw` answers undefined for an absent key and set() deletes on it, so merely drawing a rail cannot mint a default and read as a design edit. */
const bagAcc = (bag,key,read,after) => ({
  get:read, raw:()=>bag[key],
  set:v=>{ if(v===undefined) delete bag[key]; else bag[key]=v; if(after) after(); }});
/* Layout caches key off DGEN: anything writing D.pipes, D.ports, D.fittings, D.tanks or a part's x,y must call dTouch(). */
// fraction of travel a second, and tonnes of drive gear per bank
const ROD_SPD0=1/190, ROD_BANK_T=9;
let DGEN=0;
const dTouch=()=>{ DGEN++; };
// a bench input landed: it may have written D by any path, and layFresh() spends it as a dTouch() before the next paint
let dEditPend=false;
const dEditMark=()=>{ dEditPend=true; };
const D={sg:0,
         rpsm:.35,rpsLag:.06,
         /* Fractions inserted the temperature controller may walk the bank between; not a safety limit, but it keeps the bank near where the shutdown margin was measured. */
         arLo:0.10, arHi:0.70,
         gw:60, gh:34,            // the hull, in grid cells
         bkp:1,fittings:{},
         feedT:undefined,         // K the feedwater reaches the shells at; unset = feedTSuggest()
         mat:{},
         /* Per-instance quantities in real units, keyed by part id. EMPTY means "whatever this design suggests"; nothing here clamps or ranges. */
         turbKgs:{},          // kg/s of steam a turbine swallows wide open
         condUA:{}, condDump:{},   // kW/K of condensing duty; kg/s of bypass
         sgUA:{}, ihxUA:{},   // kW/K per transfer stage
         pumpHead:{}, pumpFlow:{}, pumpRotor:{}, // MPa developed, at kg/s; seconds of rated shaft power stored
         sgType:{},radCoat:{},radArea:{},radUA:{},   // m2 of panel, and kW/K of its coolant side
         sgDesP:{},           // MPa each generator's own shell is built to hold
         bore:{},             // mm, per run key
         wall:{},             // mm, per run key
         /* NO STOCK PLUMBING DECLARED HERE: buildStockPlumbing() (pipenet.js) lays it through the same calls the bench hands the player. */
         runs:{},
         machines:{}, cores:{}, name:{}, blocks:{}, segs:["g1"],
         tanks:{}, pipes:{}, ports:{}, start:{}};

/* Where an actuator stands at commissioning; absent means "whatever resetPlant() hard-codes", so an untouched design commissions bit-identically. */
const startOf=(k,fallback)=>(D.start && D.start[k]!==undefined) ? D.start[k] : fallback;

/* designBake() states a figure per machine, so one left behind prices the next plant off the last one's core. Emptied in place: a reassignment strands a holder. */
const DBAGS=["turbKgs","condUA","condDump","sgUA","sgDesP","ihxUA","pumpHead","pumpFlow","pumpRotor",
             "sgType","radCoat","radArea","radUA","bore","wall","start"];
/* The scalars, taken before anything can edit them. */
const DSCAL=Object.fromEntries(Object.entries(D).filter(([,v])=>typeof v!=="object"));
/* For a caller that has just written the scalars it wants and cannot have designForget() put them back. */
const designForgetBags=()=>{ for(const b of DBAGS) for(const k in D[b]) delete D[b][k]; };
const designForget=()=>{ designForgetBags(); Object.assign(D,DSCAL); };
/* Everything that is not a DSCAL scalar is a table D ships empty, so no list has to be kept up to date. */
const designClear=()=>{
  for(const k in D) if(typeof D[k]==="object") for(const j in D[k]) delete D[k][j];
  Object.assign(D,DSCAL);
};

/* One row per figure that carries an AUTO key. The panel, designBake() and designAuto() read THIS list; nobody keeps a second one. */
let FIG_BATCH=false;
const figSide=fn=>{ if(fn && !FIG_BATCH) fn(); };
const figBag=(bag,key,get,after)=>({get, raw:()=>{ const v=bag[key]; return v==null?undefined:v; },
  set:v=>{ bag[key]=v; figSide(after); }, clr:()=>{ delete bag[key]; figSide(after); }});
const figCore=(id,bag,key,get,after)=>figBag(bag(coreD(id)),key,()=>get(coreD(id),id),after);
// the cores that draw control channels; their knob bag is minted with the first channel
const cpsCoreIds=()=>coreIds().filter(id=>latVols(coreD(id)).nC>0);
const FIG={
  /* commission() walks an UNSTATED UA onto rated power (step.js) and takes a stated one as the player's word: baking it stands that trim down */
  sgUA:     {subs:()=>roleAll("sg"), keep:true, acc:id=>figBag(D.sgUA,id,()=>sgUAOf(id))},
  sgDesP:   {subs:()=>roleAll("sg"),    acc:id=>figBag(D.sgDesP,id,()=>sgDesPOf(id))},
  ihxUA:    {subs:()=>ihxIds(),         acc:id=>figBag(D.ihxUA,id,()=>ihxUAOf(id))},
  pumpHead: {subs:()=>pumpIds(),        acc:id=>figBag(D.pumpHead,id,()=>pumpHead(id))},
  /* pumpBoxCap() reads the STORED flow, so stating this one grows the box a preset's pipework was routed round */
  pumpFlow: {subs:()=>pumpIds(), keep:true, acc:id=>figBag(D.pumpFlow,id,()=>pumpFlow(id))},
  pumpRotor:{subs:()=>pumpIds(),        acc:id=>figBag(D.pumpRotor,id,()=>pumpRotor(id))},
  turbKgs:  {subs:()=>roleAll("turb"),  acc:id=>figBag(D.turbKgs,id,()=>turbKgs(id))},
  condUA:   {subs:()=>roleAll("cond"),  acc:id=>figBag(D.condUA,id,()=>condUA(id))},
  condDump: {subs:()=>roleAll("cond"),  acc:id=>figBag(D.condDump,id,()=>condDump(id))},
  radArea:  {subs:()=>radIds(),         acc:id=>figBag(D.radArea,id,()=>radAreaOf(id))},
  radUA:    {subs:()=>radIds(),         acc:id=>figBag(D.radUA,id,()=>radUAOf(id))},
  /* the run's own name, never the derived key: runIdOf() is the one door D.bore and D.wall are written under */
  bore:     {subs:()=>pipeNetwork(),    acc:r=>figBag(D.bore,runIdOf(r),()=>runBoreMm(r),dTouch)},
  wall:     {subs:()=>pipeNetwork(),    acc:r=>figBag(D.wall,runIdOf(r),()=>runWallMm(r),dTouch)},
  rodD:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodD",cD=>rodD(cD),()=>latRevolve(coreD(id)))},
  rodP:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodP",cD=>rodPOf(cD),()=>latRevolve(coreD(id)))},
  fin:      {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"fin",cD=>finOf(cD),()=>latRevolve(coreD(id)))},
  rodSpd:   {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"rodSpd",cD=>rodSpdOf(cD),dTouch)},
  absD:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"absD",cD=>absD(cD),()=>latRevolve(coreD(id)))},
  absN:     {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"absN",cD=>absN(cD),()=>latRevolve(coreD(id)))},
  absEnr:   {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"absEnr",cD=>absEnr(cD),()=>latRevolve(coreD(id)))},
  feedT:    {subs:()=>roleAll("turb"),  acc:()=>figBag(D,"feedT",()=>feedTOf(),dTouch)},
  vesselWall:{subs:()=>coreIds().filter(id=>!coreD(id).tube),
    acc:id=>figCore(id,cD=>cD,"wall",(cD,i)=>vesselWallMm(derived(i).P0,COOLANT[cD.cool],cD),dTouch)},
  coreDp:   {subs:()=>coreIds(),        acc:id=>figCore(id,cD=>cD,"dp0",(cD,i)=>coreDpOf(i),dTouch)},
  tubeBore: {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"bore",cD=>tubeBoreMm(cD),dTouch)},
  tubeWall: {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"wall",(cD,i)=>tubeWallMm(derived(i).P0,COOLANT[cD.cool],cD),dTouch)},
  tubeGap:  {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"gap",cD=>tubeGapMm(cD),dTouch)},
  tubeHe:   {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"he",cD=>tubeHeOf(cD),dTouch)},
  cpsBore:  {subs:()=>cpsCoreIds(), acc:id=>figCore(id,cD=>cD.cps,"bore",cD=>cpsBoreMm(cD),dTouch)},
  cpsWall:  {subs:()=>cpsCoreIds(), acc:id=>figCore(id,cD=>cD.cps,"wall",cD=>cpsWallMm(cD),dTouch)},
  cpsGap:   {subs:()=>cpsCoreIds(), acc:id=>figCore(id,cD=>cD.cps,"gap",cD=>cpsGapMm(cD),dTouch)},
  colGap:   {subs:()=>cpsCoreIds(), acc:id=>figCore(id,cD=>cD,"colGap",cD=>colGapMm(cD),dTouch)},
  cavVol:   {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"cavVol",cD=>cavVolM3(cD),dTouch)},
  shieldT:  {subs:()=>coreIds().filter(id=>coreD(id).tube),
    acc:id=>figCore(id,cD=>cD.tube,"shieldT",cD=>shieldT(cD),dTouch)},
  holdP:    {subs:()=>tankIds().filter(id=>D.tanks[id].hold),
    acc:id=>figBag(D.tanks[id].hold,"p",()=>holdSetP(tankCircuit(id)))},
  /* off the drawing, so a valve is not baked against the last plant commissioned */
  fitLift:  {subs:()=>reliefFitsD(),    acc:fid=>figBag(D.fittings[fid],"lift",()=>reliefSetD(fid).lift)},
  fitReseat:{subs:()=>reliefFitsD(),    acc:fid=>figBag(D.fittings[fid],"reseat",()=>reliefSetD(fid).reseat)},
  matT:     {subs:()=>Object.keys(D.mat),
    acc:k=>figBag(D.mat[k],"t",()=>matThick(+k.split(",")[0],+k.split(",")[1]),buildLayout)},
};
const reliefFitsD=()=>Object.keys(D.fittings).filter(f=>D.fittings[f].mode==="relief");
const figBatch=fn=>{ FIG_BATCH=true; try{ return fn(); } finally { FIG_BATCH=false; } };
/* a run is its own object; everything else names itself, so one string is the subject either way */
const figKey=sub=>(sub && typeof sub==="object") ? runIdOf(sub) : sub;
const figWalk=(fn,all)=>{ for(const k in FIG){ const r=FIG[k]; if(r.keep && !all) continue;
  for(const sub of r.subs()) fn(r.acc(sub), figKey(sub)); } };
const figSettle=()=>{ for(const id of coreIds()) latRevolve(coreD(id)); buildLayout(); dTouch(); };
/* every value is READ before any is written: a figure resolved off one just baked would otherwise price itself off the write */
const designBake=only=>figBatch(()=>{
  const want=(a,k)=>(!only || only(k)) && a.raw()===undefined;
  /* asked before anything is settled, so a gesture that placed nothing costs a walk and touches neither the layout nor the lattice */
  let any=false; figWalk((a,k)=>{ if(want(a,k)) any=true; });
  if(!any) return;
  figSettle();                       // the bags were just emptied: every cache keyed on DGEN still holds the last plant's answers
  const w=[];
  figWalk((a,k)=>{ if(want(a,k)) w.push([a,a.get()]); });
  for(const [a,v] of w) a.set(v);
  figSettle();
});
const designAuto=()=>figBatch(()=>{ figWalk(a=>a.clr(),true); figSettle(); });
/* what a gesture PLACED states its own figures; anything already on the board keeps what it was left on, AUTO included */
const figSubs=()=>{ const s=new Set(); figWalk((a,k)=>s.add(k),true); return s; };
const designBakeSince=was=>designBake(k=>!was.has(k));
function designBakeNew(fn){
  const was=figSubs();
  const out=fn();
  designBakeSince(was);
  return out;
}

/* Swallow-weighted: efficiency is a property of the STEAM, and the steam splits by what each machine can take. */
const grossEff  = () => { let w=0,e=0;
  for(const p of LAY.parts) if(p.role==="turb"){
    const k=turbKgs(p.id); w+=k; e+=k*turbEffOf(p.id); }
  return COOLANT[priD().cool].eff * (w>0 ? e/w : 1); };
/* Both a share of what this plant actually MAKES, never of the core's rating, so condShort_() compares like with like. */
const loadCeil  = () => totalTurbKgs()/Math.max(1e-9, plantSteam());
const condCeil  = () => totalCondUA()/Math.max(1e-9, condUASuggest());
/* A brief overload is bought with backpressure, so only a gap wide enough to cost real output counts. */
const condShort_ = () => loadCeil() - condCeil() > 0.26;

const MOD_HALF=1.0, LAM_FAST=4.0e-7, LAM_TH=8.0e-5;
/* Fitted together so the three ARCHPRE drawings read published full-void worths as the slope at the operating point:
   PWR -10000, SFR +700, and RBMK +2150 - the midpoint of the pre-1986 machine's published band, which INSAG-7 annex I
   brackets by +4.5 beta_eff (2160-2300 at beta_eff 0.0048-0.0051) and table II-I by +2.0e-4 per % void (2000). */
const AV_MOD=12820.7, AV_ABS=1740.6, AV_FAST=619.3, AM_K=432;
/* Reactivity per unit core strain at a bare fast spectrum, pcm; fitted so BN-600's isothermal aM+aS lands near -3 pcm/K. */
const EXP_RHO=42000;
/* lam per second; sigK the burnout rate at rated flux in units of the xenon decay constant; XE_EQ0 pcm, the one fitted figure. */
const XE={lamI:Math.LN2/(6.57*3600), lamX:Math.LN2/(9.14*3600),
          gI:.0639, gX:.00237, sigK:3.0};
const XE_EQ0=2700;
/* the poison clock: I, Xe, Pm and Sm run this many times faster than real time */
const XE_CLOCK=100;
/* Pm-149 cumulative yield (U-235 thermal, JEFF-3.3), half-life 53.08 h (NUBASE2020); sigma_a 2200 m/s Sm-149 40140 b, Xe-135 2.65e6 b (Mughabghab 2006) */
const SM={gP:.0108, lamP:Math.LN2/(53.08*3600), sigR:40140/2.65e6};
// xenon after a trip, as a MULTIPLE of the equilibrium it started from
function xeAfter(hours){
  const li=XE.lamI, lx=XE.lamX, sig=XE.sigK*lx, t=hours*3600;
  const I0=(XE.gI+XE.gX)/li, X0=(XE.gI+XE.gX)/(lx+sig);
  const X=X0*Math.exp(-lx*t)+li*I0*(Math.exp(-li*t)-Math.exp(-lx*t))/(lx-li);
  return X/X0;
}
const XE_PEAK=(function(){ let x=1,h=0;
  for(let i=0;i<=48*4;i++){ const v=xeAfter(i/4); if(v>x){ x=v; h=i/4; } }
  return {x,h}; })();
/* Hours after a trip in which `avail` pcm still covers the xenon standing at that hour; null when the pit never closes, 0 when it is shut from the start. */
function xeWindow(avail,xeW){
  if(avail>=xeW*XE_PEAK.x) return null;
  for(let h=0;h<=48;h+=0.25) if(avail<xeW*xeAfter(h)) return h;
  return null;
}
const MR_PEAK=3.2, MR_STOCK=1.6, ETA_STOCK=0.95, FAST_RHO=0.773;
const MOD_A=0.337502, MOD_B=0.036845;
const modTherm = mr => mr/(mr+MOD_HALF);
/* Resonance escape times thermal utilisation, so it HAS A PEAK and a lattice can be over-moderated; MOD_A/MOD_B fit MR_PEAK and ETA_STOCK. */
const modEta = mr => mr>1e-9 ? Math.exp(-MOD_A/mr)/(1+MOD_B*mr) : 0;
const ETA_S=modEta(MR_STOCK);
const modEtaN = mr => modEta(mr)/ETA_S;
/* NOT divided by eta(mr): unnormalised it vanishes with the thermal chain, so a fast core reads no moderator coefficient rather than an enormous one. */
const modEtaSlope = mr => { const h=1e-6*Math.max(mr,1e-3);
  return mr*(modEta(mr+h)-modEta(mr-h))/(2*h)/ETA_S; };
/* The thermal chain PLUS a fast route, or a core with no moderator would read zero excess rather than living on fast fission. */
/* the lattice's fast share, a proxy on the fitted MOD_HALF */
const fastOf = mth => Math.pow(1-mth,3);
const modK = (mr,mth) => modEtaN(mr)+FAST_RHO*fastOf(mth);

const coreIdOf = c => { for(const id in D.cores) if(D.cores[id]===c) return id; return null; };
/* Warnings here are tagged by ROLE; coreWarns() retags them by id. */
function coreFig(c){
  const a=COOLANT[c.cool],f=fuelBlend(c),rf=REFL[c.refl],M=latM(c);
  const cid=coreIdOf(c), ci=cid ? coreCircOf(cid) : nodeGraph().coreCirc;
  const P0=holdSetP(ci);   // MPa
  const dens=M.vol>1e-9? c.power/M.vol : 0;   // kW/L
  const coreMass=M.vol*22*(0.8+0.2*c.hd);
  /* A tube core's boundary is the channel, so its rating is the tube's and its mass every tube plus the shield over the cavity. */
  const vesselMass=c.tube ? tubeMass(P0,a,c)+shieldT(c) : vesselShellMass(P0,a,c),
        vesselRated=c.tube ? tubeRating(P0,a,c) : vesselRating(P0,a,c),
        vesselBurst=vesselRated*PIPE_BURST_K;
  const mass =
      a.mass + f.mass + SCRAM[c.scram].mass
    + coreMass + vesselMass + c.chim*38 + latMass(c)
    + FOLL[c.foll].mass + (c.nbank-4)*ROD_BANK_T
    + c.nbank*ROD_BANK_T*(rodSpdOf(c)/ROD_SPD0-1);
  const mr=modRatio(c), mth=modTherm(mr), Lam=LAM_FAST*Math.pow(LAM_TH/LAM_FAST,mth);
  const sh=modShares(c), fast=fastOf(mth);
  /* the blocks run on their own temperature, on a coefficient off the thermal book (modCoefOf()) */
  const own=modOwnT(c), coef=own ? modCoefOf(c) : null;
  const aM=mth*(-AM_K*modEtaSlope(mr)*sh.cool), aG=own ? coef.aG : 0;
  const hs=heatShares(c);
  const aV=AV_MOD*(modEtaN(modRatio(c,true))-modEtaN(mr))+AV_ABS*modAbs(c)
          +AV_FAST*fast+rf.dV;
  /* aX runs on the pellet's own temperature, aS on the coolant's. */
  const driveline=-STEEL_A*c.rodw*(1-Math.cos(2*Math.PI*RODX0));
  const aX=-EXP_RHO*fast*f.alpha;
  const aS=-EXP_RHO*fast*STEEL_A*2+driveline;
  /* rf.dRho is already in the albedo corePredict() reads, so leak carries it. */
  const core=corePredict(c,{dens,rf});
  const leak=core.leak;
  const excess=f.excess*modK(mr,mth)-cladOf(c).abs*modClad(c)-c.poison-leak;
  const Fq=core.FqCold;
  /* The margin at rated is PEAK_M by construction, so dnbr0 is the coolant's own level. */
  const bind=latQLim(c), dnbr0=a.dnbr;
  const graceK=a.grace*sgInertiaK();
  /* a poison that eats thermal neutrons is worth only the fission those neutrons make: 1-fast is the lattice's thermal share */
  const xeW=XE_EQ0*a.xe*(1-fast);
  /* equilibrium samarium on the xenon worth scale: gamma_Pm/(gamma_I+gamma_Xe) x (lamX+sig)/sig */
  const smW=xeW*SM.gP/(XE.gI+XE.gX)*(1+XE.sigK)/XE.sigK;
  const rodS=x=>c.rodw*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
  const boronOp=-(excess-rodS(RODX0)-xeW-smW);
  /* What locks a restart out is the PEAK hours after the trip, not the equilibrium the plant was commissioned with. */
  const xePit=xeW*XE_PEAK.x;
  const xeWin=xeWindow(excess-rodS(RODX0)-smW,xeW);
  // pcm the core gives back from zero to full power: every coefficient on the pellet, over its own rise
  const pwrDef=(a.aF+aX)*pinDTf(c);
  const dopBack=-pwrDef;                         // released as the fuel cools to the coolant
  const sdm=rodS(1)-rodS(RODX0)-xeW-smW-dopBack;     // bank only
  const sdmB=sdm+(6000+boronOp);                 // bank plus everything the boron system has left
  return {a,f,rf,dens,mass,aM,aG,coef,hs,aV,aX,aS,pwrDef,Lam,mr,mth,fast,excess,dnbr0,bind,Fq,xeW,smW,core,
    boronOp,sdm,sdmB,leak,xePit,xeWin,power:c.power,
    grace:graceK*25/Math.sqrt(c.power/1200)*(1+.4*c.chim),
    beta:f.beta,scram:SCRAM[c.scram].rate,P0,vesselMass,vesselRated,vesselBurst,
    warn:(()=>{const w=[];
      if(sdmB<200) w.push(["RED","Even full boration holds this core down by only "+sdmB.toFixed(0)+" pcm after a trip. Nothing on the plant can shut it down and keep it down - add control bank worth or burnable poison.","rods"]);
      else if(sdm<200) w.push(["SOFT","The bank alone holds this core down by only "+sdm.toFixed(0)+" pcm. Once the xenon decays after a trip the core goes critical again with the bank fully inserted. You must borate after every scram; full boron is worth "+sdmB.toFixed(0)+" pcm of margin.","rods"]);
      if(boronOp<-6000) w.push(["RED","Boron demand "+boronOp.toFixed(0)+" pcm exceeds the 6000 pcm chemical system. Add burnable poison or drop enrichment.","core"]);
      /* Positive boronOp means the chemical system would have to hold the core UP, and nothing can. */
      else if(boronOp>0) w.push(["RED","This core is "+boronOp.toFixed(0)+" pcm short of critical with the bank at its commissioning position. There is nothing to take out - buy higher enrichment, remove burnable poison, or moderate it.","core"]);
      if(aV>0) w.push(["SOFT","Positive void coefficient ("+aV.toFixed(0)+" pcm). Steam in the core ADDS power. This is the Chernobyl feedback loop.","core"]);
      if(aM+aG>0) w.push(["SOFT","Positive moderator coefficient. Heating the moderator raises power instead of lowering it - an over-moderated lattice, or a graphite stack in one.","core"]);
      if(pwrDef>-100) w.push(["SOFT","Power coefficient only "+pwrDef.toFixed(0)+" pcm from zero to full power. Almost nothing in the fuel pushes back when power rises; the rods and the coolant are all that hold it.","core"]);
      if(f.beta<400) w.push(["SOFT","Beta "+f.beta+" pcm. Prompt criticality is half as far away as with uranium fuel.","core"]);
      if(FOLL[c.foll].tipRho>0 && aV>0) w.push(["SOFT","Graphite followers on a positive-void core. Inserting the bank pushes graphite through the bottom of the core, which ADDS reactivity there before the absorber removes any. A scram from a withdrawn bank is an excursion, not a shutdown.","rods"]);
      if(core.cz<0.35) w.push(["SOFT","Loosely coupled core (axial coupling "+core.cz.toFixed(2)+"). It is tall enough that one end can drift without the other noticing, so xenon can oscillate top to bottom on its own.","core"]);
      if(Fq>3.0) w.push(["SOFT","Peaking factor "+Fq.toFixed(2)+". The hottest spot runs at "+Fq.toFixed(1)+"x the core average, and DNBR is set by that spot, not by the average.","core"]);
      return w;})()};
}
function coreWarns(id){
  const c=coreD(id), rods=rodsOf(id);
  return coreFig(c).warn.concat(latWarn(c))
    .map(w=>[w[0],w[1], w[2]==="core" ? id : w[2]==="rods" ? rods : w[2]]);
}
/* No id: the plant, with the FIRST vessel's own figures spread over it. */
function derived(id){
  if(id!=null) return coreFig(coreBag(id));
  const d=coreFig(priD());
  const cores=coreIds();
  /* A containment is a closed shape in the paint, so "is there one" is "did a fill come back bounded". */
  const conts=matRegionsBounded();
  const contRel=conts.length ? Math.min.apply(null, conts.map(g=>contRelAt(null, g.cells[0]%GW, (g.cells[0]/GW)|0))) : 1;
  /* No paint term: layMass (layoutMetrics(), layout.js) already carries it. */
  let mass=0; for(const cid of cores) mass+=coreFig(coreD(cid)).mass;
  mass+=totalPumpMass()+totalSgMass()
    +(roleOf("bkp")?BKP[D.bkp].mass:0)
    + partMass("catcher") + partMass("vent") + partMass("inert") + partMass("pan")
    + tankMass() + fittingMass()
    + (roleOf("ctrl")?55:0)
    + totalTurbMass() + totalCondMass()
    + totalIhxMass() + totalRadMass()
    + layMass;
  const eff=grossEff(), loadMax=loadCeil(), condCap=condCeil(), condShort=condShort_();
  // under 1 the turbine trips at rest; under 1/DUMP_COND_K the dump is blocked
  const condMargin=TURB_TRIP_P/Math.max(COND_P0, psatSec(condRest(plantDuty()).condT));
  const w=[];
  if(mass>BUDGET) w.push(["RED","Over the "+BUDGET+" t mass budget by "+(mass-BUDGET).toFixed(0)+" t.",null]);
  for(const cid of cores) for(const x of coreWarns(cid)) w.push(x);
  const tightPainted=matCells().some(k=>{ const i=k.indexOf(",");
    return matWall(+k.slice(0,i),+k.slice(i+1)); });
  if(!conts.length) w.push(["SOFT", tightPainted
    ? "The gas-tight structure on this ship encloses nothing - every fill round it reaches the hull, so there is no containment. Close the shape, or accept that a release goes straight to the crew."
    : "No containment. Nothing painted on this ship is gas-tight, so any fuel damage releases straight to the crew - paint a closed shape in a gas-tight material to hold it in.",null]);
  else { const weak=conts.map(g=>{ let lo=Infinity, at=null;
           for(const i of g.wall){ const x=i%GW, y=(i/GW)|0, r=matRating(x,y);
             if(r<lo){ lo=r; at=[x,y]; } }
           return {g,lo,at}; }).sort((a,b)=>a.lo-b.lo)[0];
         if(weak.at && weak.lo < MAT_PDES)
           w.push(["SOFT","The containment is walled for only "+weak.lo.toFixed(2)+" MPa at "+weak.at[0]+","+weak.at[1]+" - the middle of its longest flat side, against a "+MAT_PDES+" MPa design. Thicken the wall there, or draw the enclosure rounder so no cell is in the middle of a long span.",null]); }
  if(D.bkp===0) w.push(["SOFT","No backup power. A blackout stops the pumps entirely.","bkp"]);
  if(roleAll("sg").length && feedTOf() >= if97Tsat(sgDesignP())) w.push(["RED","Feedwater arrives at "+fmtT(feedTOf(),0)+", at or above the "+fmtT(if97Tsat(sgDesignP()),0)+" the shells boil at. It would flash before it reached them - lower the feed temperature on the turbine or raise the shell pressure.","turb"]);
  if(!roleAll("turb").length) w.push(["SOFT","No turbine on the plant. This design generates no electricity at all.","turb"]);
  else if(!roleAll("cond").length) w.push(["SOFT","No condenser on the plant. The turbine has nowhere to exhaust steam to, so it does no work either - no electricity.","cond"]);
  if(roleAll("turb").length && loadMax<1.10) w.push(["SOFT","The turbine takes "+(loadMax*100).toFixed(0)+"% of the steam this plant raises at full power, so there is almost no overload left in it. In combat the reactor can be pushed past full power and this machine cannot take the extra steam. A bigger swallow buys the reach, and costs mass.","turb"]);
  if(condMargin<1/DUMP_COND_K) w.push([condMargin<1?"RED":"SOFT","The sink rests at "+(TURB_TRIP_P/condMargin).toFixed(4)+" MPa of backpressure against a "+TURB_TRIP_P+" MPa turbine trip"+(condMargin<1?", so the turbine trips before anything has happened":", so the steam dump is blocked at rest: a load drop goes to the shell safeties and the water does not come back")+". Bigger panels or a bigger condenser buy the margin.","cond"]);
  if(condShort) w.push(["SOFT","The condenser handles "+(condCap*100).toFixed(0)+"% of full-load duty but the turbine can draw "+(loadMax*100).toFixed(0)+"%. Past its duty it sits hotter, the exhaust pressure climbs and the turbine gives back part of what it made - continuously, not just in a transient. The reactor goes on making the heat either way.","cond"]);
  if(!scramWiredD()) w.push(["SOFT","No reactor protection system. Nothing in the control cabinet lands on a scram, so nothing will shut this core down for you - not high flux, not low DNBR, not a dry loop. Every trip is yours to call by hand.","ctrl"]);
  if(Object.keys(D.blocks).length && !roleOf("ctrl")) w.push(["SOFT","Automation is wired but there is no control room to house it. Every block in the cabinet computes nowhere: the demands they drive stay by hand until a CONTROL is placed.","ctrl"]);
  /* Topological only: hasHeatSink() reads the wiring, not the loop. */
  if(!hasHeatSink()) w.push(["SOFT","This design has no heat sink. Nothing wired to the primary loop removes heat from it.",null]);
  if(!radIds().length) w.push(["RED","No radiator on this ship. Nothing rejects the waste heat, so the condenser will climb until it loses vacuum and the turbine trips.","cond"]);
  else {
    const blind=radIds().filter(id=>!radLive(id));
    for(const id of blind) w.push(["SOFT",partOf(id).name+" cannot see space. A panel with no face on the skin radiates nothing at all - move it against the hull, or it is dead weight and the plant loses the sink it was bought for.",id]);
    const tr=radTRated(eff);
    if(tr>RAD_TDES+1) w.push(["SOFT","The panels are short of rated rejection: at full power they sit at "+fmtT(tr,0)+" against a design "+fmtT(RAD_TDES,0)+", which puts the condenser near "+psatSec(Math.min(tr+COND_DT0,500)).toFixed(4)+" MPa of backpressure and the turbine gives part of its work back.","cond"]);
  }
  return Object.assign(d,{mass,over:mass>BUDGET,rated:ratedMWt(),contRel,nCont:conts.length,
    eff,loadMax,condCap,condShort,condMargin,warn:w});
}

/* HARD is the only severity that refuses to commission; RED is a fault the bench draws in red and still builds. */
const warnHard=w=>w[0]==="HARD";
const warnRed=w=>w[0]==="HARD"||w[0]==="RED";
