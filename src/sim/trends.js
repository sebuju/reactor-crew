"use strict";
/* fixed: read off the drawing, never the plant. Key order is the signal code eSigRead() switches on (E_SIG_KEYS) */
const SIGNAL={
 pwr :{scope:"core", lab:"POWER",        u:"%",  col:"#57d38c"},
 dnbr:{scope:"core", lab:"DNBR",         u:"",   col:"#f0a830"},
 tf  :{scope:"core", lab:"FUEL TEMP",    u:"K",  col:"#ff5a45"},
 tavg:{scope:"core", lab:"T-AVG",        u:"K",  col:"#5fd2e2"},
 th  :{scope:"core", lab:"T-HOT",        u:"K",  col:"#ffa07a"},
 tc  :{scope:"core", lab:"T-COLD",       u:"K",  col:"#5aa9d6"},
 prs :{scope:"core", lab:"PRESSURE",     u:"MPa",col:"#a98cf0"},
 sub :{scope:"core", lab:"SUBCOOLING",   u:"K",  col:"#5fd2e2"},
 lvl :{scope:"core", lab:"PZR LEVEL",    u:"%",  col:"#c8d8dc"},
 sgl :{scope:"plant",lab:"SG LEVEL",     u:"%",  col:"#8fa9ae"},
 hot :{scope:"plant",lab:"HOTWELL",      u:"%",  col:"#6f97a8"},
 inv :{scope:"core", lab:"INVENTORY",    u:"%",  col:"#5aa9d6"},
 /* flowNet, not flow: what reaches the core, never what the pumps were told */
 flow:{scope:"core", lab:"CORE FLOW",    u:"%",  col:"#57d38c"},
 load:{scope:"plant",lab:"LOAD DEMAND",  u:"%",  col:"#f0a830"},
 rod :{scope:"core", lab:"ROD BANK",     u:"%",  col:"#c8d8dc"},
 bor :{scope:"plant",lab:"BORON",        u:"pcm",col:"#5fd2e2"},
 xe  :{scope:"core", lab:"XENON",        u:"pcm",col:"#5aa9d6"},
 exp :{scope:"core", lab:"EXPANSION",    u:"pcm",col:"#8fa9ae"},
 dis :{scope:"core", lab:"DISASSEMBLY",  u:"pcm",col:"#a48ad6"},
 fq  :{scope:"core", lab:"PEAKING Fq",  u:"",   col:"#f0a830"},
 ao  :{scope:"core", lab:"AXIAL OFFSET",u:"%",  col:"#a98cf0"},
 ro  :{scope:"core", lab:"RADIAL TILT", u:"%",  col:"#5fd2e2"},
 rho :{scope:"core", lab:"NET RHO",      u:"pcm",col:"#ff5a45"},
 vd  :{scope:"core", lab:"VOID FRACTION",u:"",   col:"#a98cf0"},
 dmg :{scope:"core", lab:"FUEL DAMAGE",  u:"%",  col:"#ff5a45"},
 fat :{scope:"core", lab:"VESSEL FATIGUE",u:"%", col:"#f0a830"},
 cav :{scope:"plant",lab:"CAVITATION",   u:"",   col:"#f0a830"},
 nat :{scope:"plant",lab:"NAT CIRC",     u:"%",  col:"#57d38c"},
 rel :{scope:"plant",lab:"RELEASE",      u:"%",  col:"#ff5a45"},
 dec :{scope:"core", lab:"DECAY HEAT",   u:"%",  col:"#ff9a5a"},
 rad :{scope:"plant",lab:"AREA DOSE",  u:"x", col:"#c8d8dc"},
 cdos:{scope:"plant",lab:"WATCH DOSE", u:"%", col:"#8fa9ae"},
 /* appended, never reordered or renamed: a scenario limit names a key by string */
 mlt :{scope:"core", lab:"FUEL MOLTEN",u:"%", col:"#ff9a5a"},
 h2  :{scope:"plant",lab:"HYDROGEN",   u:"kg",col:"#a98cf0"},
 rp  :{scope:"plant",lab:"ROOM PRESSURE",u:"kPa",col:"#ff6a6a"},
 dnbm:{scope:"core", lab:"MIN NODE DNBR",u:"",col:"#f0a830"},
 radt:{scope:"plant",lab:"PANEL TEMP",  u:"K", col:"#b8c4cf"},
 /* no `col`, so CH below skips these: a block reads them, the chart does not */
 nfr  :{scope:"core", lab:"POWER FRAC", u:""},
 tprog:{scope:"core", lab:"T-PROG",     u:"K"},
 dtavg:{scope:"core", lab:"T-AVG RATE", u:"K/s"},
 tfrac:{scope:"core", lab:"TURB SHARE", u:""},
 rodd :{scope:"core", lab:"ROD DEMAND", u:"%"},
 trip :{scope:"core", lab:"TRIPPED",    u:""},
 /* not `sub`: the solved field's hottest liquid node */
 scc  :{scope:"core", lab:"SUBCOOL MARGIN",u:"K"},
 heat :{scope:"core", lab:"HEAT FRAC",  u:""},
 rpsset :{scope:"rpsch", lab:"TRIP SET", u:"",   fixed:true},
 rpsnear:{scope:"rpsch", lab:"NEAR SET", u:"",   fixed:true},
 sglv :{scope:"sg",   lab:"SG LEVEL",   u:"%"},
 sgp  :{scope:"sg",   lab:"SHELL P",    u:"MPa"},
 sgst :{scope:"sg",   lab:"STEAM OUT",  u:"kg/s"},
 sgfed:{scope:"sg",   lab:"FEED IN",    u:"kg/s"},
 sgwant:{scope:"sg",  lab:"FEED WANT",  u:"kg/s"},
 /* Infinity with no shell, so an absent generator cannot make a low-level channel */
 sglo :{scope:"plant",lab:"LOWEST SG LEVEL",u:"%"},
 pumpq:{scope:"pump", lab:"PUMP SPEED", u:"%"},
 pumpd:{scope:"pump", lab:"PUMP DEMAND",u:"%"},
 fitp :{scope:"fit",  lab:"VALVE P",    u:"MPa"},
 fitopen:{scope:"fit",lab:"VALVE OPEN", u:""},
 fitlift:{scope:"fit",lab:"LIFT SET",   u:"MPa", fixed:true},
 fitreseat:{scope:"fit",lab:"RESEAT SET",u:"MPa", fixed:true},
 valve:{scope:"fit",  lab:"VALVE POS",  u:"%"},
 tankl:{scope:"tank", lab:"TANK LEVEL", u:"%"},
 loopp:{scope:"loop", lab:"LOOP P",     u:"MPa"},
 /* read off the DRAWING, so the governor below states no number of its own */
 loopset:{scope:"loop", lab:"LOOP P SET", u:"MPa", fixed:true},
 supply:{scope:"plant",lab:"SUPPLY",    u:""},
 dark :{scope:"plant",lab:"BLACKOUT",   u:""},
 turbtr:{scope:"plant",lab:"TURBINE TRIPPED",u:""},
 time :{scope:"plant",lab:"TIME",       u:"s"},
};
const CH=Object.fromEntries(Object.entries(SIGNAL).filter(([,r])=>r.col));
/* the UI's door: a key and an id, resolved once here and read by code */
const sigRead=(k,arg)=>{ const c=eSigCode(k); if(c<0 || !ST) return 0;
  const r=SIGNAL[k]; return eSigRead(c, r.scope==="plant" ? -1 : eBlkArgIndex(r.scope, arg)); };
/* no row here = self-scaling */
const CHVIEW={
 pwr :{rng:()=>[0,125],                     warn:()=>[rpsSetOf("flux",0)]},
 dnbr:{rng:()=>[0,Math.max(3,P.dnbr0*1.3)], warn:()=>[1.30, rpsSetOf("dnbr",0)]},
 tf  :{rng:()=>[300,Math.max(2000,P.tdmg+700)], warn:()=>[P.tdmg, rpsSetOf("tf",0)]},
 tavg:{rng:()=>[P.Tref-60,P.Tref+60]},
 th  :{rng:()=>[P.Tref-40,P.Tref+80]},
 tc  :{rng:()=>[P.Tref-80,P.Tref+40]},
 prs :{rng:()=>[P.P0*0.70,P.P0*1.25],       warn:()=>[rpsSetOf("plp",0), rpsSetOf("php",0)]},
 sub :{rng:()=>[0,Math.max(40,P.sc0*1.4)],  warn:()=>[8,3]},
 lvl :{rng:()=>[0,100],                     warn:()=>[78]},
 sgl :{rng:()=>[0,100],                     warn:()=>[SG_LOW]},
 hot :{rng:()=>[0,100]},
 inv :{rng:()=>[60,102],                    warn:()=>[95]},
 flow:{rng:()=>[0,120],                     warn:()=>[P.flowMin*100]},
 load:{rng:()=>[0,110]},
 rod :{rng:()=>[0,100]},
 bor :{rng:()=>[-6000,0]},
 xe  :{rng:()=>[-4000,0],                   warn:()=>[-3200]},
 fq  :{rng:()=>[1,3.5]},
 ao  :{rng:()=>[-40,40]},
 ro  :{rng:()=>[-40,40]},
 exp :{rng:()=>[-1000,200]},
 rho :{rng:()=>[-3000,1000],                warn:()=>[0]},
 vd  :{rng:()=>[0,0.5],                     warn:()=>[0.15,0.30]},
 dmg :{rng:()=>[0,100],                     warn:()=>[10]},
 fat :{rng:()=>[0,100]},
 cav :{rng:()=>[0,1],                       warn:()=>[0.15]},
 nat :{rng:()=>[0,25]},
 rel :{rng:()=>[0,100]},
 dec :{rng:()=>[0,8]},
 rad :{rng:()=>[0,2]},
 cdos:{rng:()=>[0,100]},
 mlt :{rng:()=>[0,100],                     warn:()=>[MELT_LATCH*100]},
 h2  :{rng:()=>[0,Math.max(50,P.cladKg*ZR_H2)], warn:()=>[H2_EV]},
 rp  :{rng:()=>[0,900], warn:()=>[15, 200]},
 dnbm:{rng:()=>[0,Math.max(2.6,P.dnbr0*1.3)],   warn:()=>[1]},
 radt:{rng:()=>[200,tsatSec(COND_ATM)-COND_DT0],
       warn:()=>[RAD_TDES, tsatSec(TURB_TRIP_P)-COND_DT0]},
};

/* latches a limit may name: CH-shaped, archived, deliberately out of the strip chart's own list; `c` is the code chRead() switches on */
const CHB={
 trip  :{lab:"RPS TRIP",      u:"", col:"#ff5a45", c:-1},
 melt  :{lab:"CORE MELT",     u:"", col:"#ff5a45", c:-2},
 breach:{lab:"VESSEL BREACH", u:"", col:"#ff5a45", c:-3},
 dmgd  :{lab:"PARTS DOWN",    u:"", col:"#f0a830", c:-4},
};
/* the one lookup a limit goes through; never CH or CHB by name */
const limCh = k => CH[k] || CHB[k];
const HN=1800, SAMP_TICKS=5; let hist={},hi=0,hlen=0,plot=["pwr","dnbr"];
/* per-vessel ring under "pwr:core1"; the plain key stays the plant's, which is what a limit names */
const UNIT_CH=new Set(Object.keys(CH).filter(k=>CH[k].scope==="core"));
const TREND={unit:null};
const trendUnits=()=>{ const ids=IX?IX.coreId:[]; return ids.length>1?ids:[]; };
/* the channel set, built once per plant: key, code, instance, and the ring each one writes */
const CHN={keys:[], code:null, arg:null, ring:[], tkeys:[], tcode:null, targ:null};
function chBuild(){
  const keys=Object.keys(CH), code=[], arg=[];
  for(const k of keys){ code.push(eSigCode(k)); arg.push(-1); }
  for(const id of trendUnits()) for(const k of UNIT_CH){ keys.push(k+":"+id); code.push(eSigCode(k)); arg.push(IX.core.get(id)); }
  CHN.keys=keys; CHN.code=Int32Array.from(code); CHN.arg=Int32Array.from(arg);
  const bk=Object.keys(CHB);
  CHN.tkeys=keys.concat(bk);
  CHN.tcode=Int32Array.from(code.concat(bk.map(k=>CHB[k].c)));
  CHN.targ=Int32Array.from(arg.concat(bk.map(()=>-1)));
}
const CHKEYS=()=>CHN.keys;
function chbRead(c){
  const sc=ST.sc;
  switch(c){
    case -1: return sc[SC_SCRAMMED]?1:0;
    case -2: return sc[SC_MELT]?1:0;
    case -3: return sc[SC_BREACH]?1:0;
    case -4: { const d=ST.dmgBy; let n=0; for(let a=0;a<d.length;a++) if(d[a]) n++; return n; }
  }
  return 0;
}
const chRead=(c,a)=>c>=0 ? eSigRead(c,a) : chbRead(c);
const chKey=k=>(TREND.unit && UNIT_CH.has(k) && hist[k+":"+TREND.unit]) ? k+":"+TREND.unit : k;
/* differentiator state lives on the state so a scrub restores it */
const period=()=>ST?ST.sc[SC_PERV]:Infinity;
/* the ring is one buffer the worker writes and the page reads in place: an Int32 header, then K x HN float64 in CHN.keys order.
   Not sim state: a seek rebuilds it from the take's archive (histFill()) */
const HIST_HEAD=4, HH_HI=0, HH_LEN=1, HH_K=2, HH_TOT=3;
/* samples the page leaves unread at the old end, so a writer one packet ahead cannot reach a slot being painted */
const HIST_GUARD=64;
let histBuf=null, histH=null, histShared=null;
function histBind(buf){
  histBuf=buf; histH=new Int32Array(buf,0,HIST_HEAD);
  hist={}; CHN.ring=[];
  for(let k=0;k<histH[HH_K];k++){ const r=new Float64Array(buf,HIST_HEAD*4+k*HN*8,HN); hist[CHN.keys[k]]=r; CHN.ring.push(r); }
}
function histAlloc(){
  const K=CHN.keys.length, B=HIST_HEAD*4+K*HN*8;
  const buf=SHM_ON?new SharedArrayBuffer(B):new ArrayBuffer(B);
  new Int32Array(buf,0,HIST_HEAD)[HH_K]=K;
  histBind(buf); hi=0; hlen=0;
}
function histCheck(buf){
  const K=new Int32Array(buf,0,HIST_HEAD)[HH_K];
  if(K!==CHN.keys.length) throw new Error("trend ring: the viewer's plant is not the worker's ("+CHN.keys.length+" vs "+K+" channels)");
}
/* values first, header after: a reader that loads the header sees only samples already written */
function histPub(n){ Atomics.store(histH,HH_HI,hi); Atomics.store(histH,HH_LEN,hlen); Atomics.add(histH,HH_TOT,n); }
const histTotal=()=>Atomics.load(histH,HH_TOT);
function histAttach(sab){ histCheck(sab); histShared=sab; histBind(sab); }
function histDetach(){ if(!histShared) return; histShared=null; histAlloc(); }
/* once per packet, so one paint reads one window; a local initHist() since the attach is undone here */
function histSync(){
  if(!histShared) return;
  if(histBuf!==histShared) histAttach(histShared);
  hi=Atomics.load(histH,HH_HI); hlen=Math.min(Atomics.load(histH,HH_LEN),HN-HIST_GUARD);
}
/* the clone path: the newest n samples packed sample-major, and the page's own ring written from them */
function histBlock(n){
  const R=CHN.ring, K=R.length, b=new Float64Array(n*K);
  for(let s=0;s<n;s++){ const j=((hi-n+s)%HN+HN)%HN; for(let k=0;k<K;k++) b[s*K+k]=R[k][j]; }
  return b;
}
function histPushBlock(b){
  const R=CHN.ring, K=R.length, n=K?b.length/K:0;
  for(let s=0;s<n;s++){ for(let k=0;k<K;k++) R[k][hi]=b[s*K+k]; hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN); }
  histPub(n);
}
function histLoad(buf){
  histCheck(buf);
  new Uint8Array(histBuf).set(new Uint8Array(buf));
  hi=histH[HH_HI]; hlen=histH[HH_LEN];
}
function initHist(){
  if(IX) chBuild();
  histAlloc();
  if(ST){ const sc=ST.sc; sc[SC_PERV]=Infinity; sc[SC_PERN]=sc[SC_N]; sc[SC_PERT]=sc[SC_T]; } }
function sample(){
  const R=CHN.ring, C=CHN.code, A=CHN.arg;
  for(let i=0;i<R.length;i++){ const v=chRead(C[i],A[i]); R[i][hi]=isFinite(v)?v:0; }
  hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN); histPub(1);
  const sc=ST.sc, dt=sc[SC_T]-sc[SC_PERT];
  if(dt>1e-9){ const dn=(sc[SC_N]-sc[SC_PERN])/dt;
    sc[SC_PERV] = Math.abs(dn)<1e-5 ? Infinity : sc[SC_N]/dn;
    sc[SC_PERN]=sc[SC_N]; sc[SC_PERT]=sc[SC_T]; }
  recSample(); }
function chAt(k,i){ const r=hist[chKey(k)]; return r ? r[((hi-hlen+i)%HN+HN)%HN] : 0; }
function togglePlot(k){ const i=plot.indexOf(k);
  if(i>=0) plot.splice(i,1); else { plot.push(k); if(plot.length>4) plot.shift(); } }

/* chunked so appending never reallocates */
const TR_CHUNK=4096;
const TRKEYS=()=>CHN.tkeys;

/* live only: a replay would double-write the archive and disorder the tick index */
function recSample(){
  if(REC.mode!=="live") return;
  const t=recBoot(); if(!t) return;
  const K=CHN.tkeys, C=CHN.tcode, A=CHN.targ;
  if(!t.trA || t.trA.length!==K.length){ t.trA=[]; for(const k of K) t.trA.push(t.tr[k]||(t.tr[k]=[])); }
  const n=t.trN, c=(n/TR_CHUNK)|0, o=n%TR_CHUNK;
  for(let i=0;i<K.length;i++){
    const a=t.trA[i];
    if(!a[c]) a[c]=new Float64Array(TR_CHUNK);
    const v=chRead(C[i],A[i]); a[c][o]=isFinite(v)?v:0;
  }
  /* the tick is stored, never inferred, so the archive does not depend on the sample cadence */
  if(!t.trT[c]) t.trT[c]=new Int32Array(TR_CHUNK);
  t.trT[c][o]=ST.sc[SC_TICK];
  t.trN=n+1;
  REC.trBytes += TR_BYTES_PER();
  if(REC.trBytes > REC_MAX_TR_BYTES) trEvict();
}

/* the live take's last HN samples are never thinned */
const TR_BYTES_PER = () => 8*TRKEYS().length + 4;
const trBytesOf = t => (t.trN||0) * TR_BYTES_PER();
const trCut = t => t.id===REC.cur ? Math.max(0,t.trN-HN) : t.trN;

function trThin(take){
  const cut=trCut(take); if(cut<2) return false;
  const idx=[];
  for(let i=0;i<cut;i+=2) idx.push(i);
  for(let i=cut;i<take.trN;i++) idx.push(i);
  const n=idx.length, nc=Math.max(1,Math.ceil(n/TR_CHUNK));
  const move=(src,make)=>{ const dst=[]; for(let c=0;c<nc;c++) dst[c]=make();
    for(let j=0;j<n;j++){ const i=idx[j];
      dst[(j/TR_CHUNK)|0][j%TR_CHUNK]=src[(i/TR_CHUNK)|0][i%TR_CHUNK]; }
    return dst; };
  for(const k of TRKEYS()) if(take.tr[k]) take.tr[k]=move(take.tr[k],()=>new Float64Array(TR_CHUNK));
  take.trA=null;
  take.trT=move(take.trT,()=>new Int32Array(TR_CHUNK));
  REC.trBytes -= (take.trN-n)*TR_BYTES_PER();
  take.trN=n; take.trThin=(take.trThin||1)*2;
  return true;
}
function trEvict(){
  while(REC.trBytes > REC_MAX_TR_BYTES){
    let o=null;
    for(const t of REC.takes) if(t && trCut(t)>=2 && (!o || t.id<o.id)) o=t;
    if(!o || !trThin(o)) return;
  }
}
const trAt  =(take,k,i)=>take.tr[k][(i/TR_CHUNK)|0][i%TR_CHUNK];
const trTick=(take,i)  =>take.trT[(i/TR_CHUNK)|0][i%TR_CHUNK];
function trBefore(take,tick){
  let lo=0, hi2=take.trN-1, r=-1;
  while(lo<=hi2){ const m=(lo+hi2)>>1;
    if(trTick(take,m)<=tick){ r=m; lo=m+1; } else hi2=m-1; }
  return r;
}

/* a run is a lineage: each ancestor contributes up to the next take's start, as `[take, from, to)` in time order */
function trSegs(take,tick){
  /* an evicted take is out of the forest, so walk it alone - lineage() would hand back nothing */
  const line=REC.takes[take.id]===take?lineage(take.id):[take], segs=[];
  for(let n=0;n<line.length;n++){
    const t=line[n], cut=n+1<line.length?line[n+1].tick0-1:tick;
    const end=trBefore(t,Math.min(cut,tick));
    if(end>=0) segs.push([t,0,end+1]);
  }
  return segs;
}

function histFill(take,tick){
  const segs=trSegs(take,tick);
  let total=0; for(const s of segs) total+=s[2]-s[1];
  let skip=Math.max(0,total-HN);
  for(const s of segs){ const d=Math.min(skip,s[2]-s[1]); s[1]+=d; skip-=d; }
  const KS=Object.keys(hist).filter(k=>take.tr[k]);
  hi=0; hlen=0;
  for(const s of segs) for(let i=s[1];i<s[2];i++){
    for(const k of KS) hist[k][hi]=trAt(s[0],k,i);
    hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
  }
  histPub(hlen);
}
