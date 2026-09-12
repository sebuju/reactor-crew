"use strict";
const HT = s => s.Tavg + 15*(s.n*PROMPT_F + s.decay);
const SIGNAL={
 pwr :{scope:"core", lab:"POWER",        u:"%",  col:"#57d38c", f:s=>s.n*100},
 dnbr:{scope:"core", lab:"DNBR",         u:"",   col:"#f0a830", f:s=>s.dnbr},
 tf  :{scope:"core", lab:"FUEL TEMP",    u:"K",  col:"#ff5a45", f:s=>s.Tf},
 tavg:{scope:"core", lab:"T-AVG",        u:"K",  col:"#5fd2e2", f:s=>s.Tavg},
 th  :{scope:"core", lab:"T-HOT",        u:"K",  col:"#ffa07a", f:s=>HT(s)},
 tc  :{scope:"core", lab:"T-COLD",       u:"K",  col:"#5aa9d6", f:s=>s.Tavg-15*(s.n*PROMPT_F+s.decay)},
 prs :{scope:"core", lab:"PRESSURE",     u:"MPa",col:"#a98cf0", f:s=>s.P},
 sub :{scope:"core", lab:"SUBCOOLING",   u:"K",  col:"#5fd2e2", f:s=>tsat(s.P)-HT(s)},
 lvl :{scope:"core", lab:"PZR LEVEL",    u:"%",  col:"#c8d8dc", f:s=>s.lvl},
 sgl :{scope:"plant",lab:"SG LEVEL",     u:"%",  col:"#8fa9ae", f:s=>sglMin(s)},
 hot :{scope:"plant",lab:"HOTWELL",      u:"%",  col:"#6f97a8", f:s=>tankPoolPct(s,hostedTankIds())},
 inv :{scope:"core", lab:"INVENTORY",    u:"%",  col:"#5aa9d6", f:s=>s.inv},
 /* flowNet, not flow: what reaches the core, never what the pumps were told */
 flow:{scope:"core", lab:"CORE FLOW",    u:"%",  col:"#57d38c", f:s=>s.flowNet*100},
 load:{scope:"plant",lab:"LOAD DEMAND",  u:"%",  col:"#f0a830", f:s=>s.load*100},
 rod :{scope:"core", lab:"ROD BANK",     u:"%",  col:"#c8d8dc", f:s=>s.rodPos*100},
 bor :{scope:"plant",lab:"BORON",        u:"pcm",col:"#5fd2e2", f:s=>s.boron},
 xe  :{scope:"core", lab:"XENON",        u:"pcm",col:"#5aa9d6", f:s=>s.parts.xe},
 exp :{scope:"core", lab:"EXPANSION",    u:"pcm",col:"#8fa9ae", f:s=>s.parts.exp},
 dis :{scope:"core", lab:"DISASSEMBLY",  u:"pcm",col:"#a48ad6", f:s=>s.parts.dis},
 fq  :{scope:"core", lab:"PEAKING Fq",  u:"",   col:"#f0a830", f:s=>s.fq},
 ao  :{scope:"core", lab:"AXIAL OFFSET",u:"%",  col:"#a98cf0", f:s=>s.ao*100},
 ro  :{scope:"core", lab:"RADIAL TILT", u:"%",  col:"#5fd2e2", f:s=>s.ro*100},
 rho :{scope:"core", lab:"NET RHO",      u:"pcm",col:"#ff5a45", f:s=>s.rho},
 vd  :{scope:"core", lab:"VOID FRACTION",u:"",   col:"#a98cf0", f:s=>s.vf},
 dmg :{scope:"core", lab:"FUEL DAMAGE",  u:"%",  col:"#ff5a45", f:s=>s.dmg},
 fat :{scope:"core", lab:"VESSEL FATIGUE",u:"%", col:"#f0a830", f:s=>s.fatigue},
 cav :{scope:"plant",lab:"CAVITATION",   u:"",   col:"#f0a830", f:s=>s.cav},
 nat :{scope:"plant",lab:"NAT CIRC",     u:"%",  col:"#57d38c", f:s=>s.nat*100},
 rel :{scope:"plant",lab:"RELEASE",      u:"%",  col:"#ff5a45", f:s=>s.release},
 dec :{scope:"core", lab:"DECAY HEAT",   u:"%",  col:"#ff9a5a", f:s=>s.decay*100},
 rad :{scope:"plant",lab:"AREA DOSE",  u:"x", col:"#c8d8dc", f:s=>s.doseRate},
 cdos:{scope:"plant",lab:"WATCH DOSE", u:"%", col:"#8fa9ae", f:s=>s.crewDose},
 /* appended, never reordered or renamed: a scenario limit names a key by string */
 mlt :{scope:"core", lab:"FUEL MOLTEN",u:"%", col:"#ff9a5a", f:s=>s.meltFrac*100},
 h2  :{scope:"plant",lab:"HYDROGEN",   u:"kg",col:"#a98cf0", f:s=>s.h2},
 rp  :{scope:"plant",lab:"ROOM PRESSURE",u:"kPa",col:"#ff6a6a", f:s=>s.roomPMax},
 dnbm:{scope:"core", lab:"MIN NODE DNBR",u:"",col:"#f0a830", f:s=>s.dnbrMin},
 radt:{scope:"plant",lab:"PANEL TEMP",  u:"K", col:"#b8c4cf", f:s=>radTMax(s)},
 /* no `col`, so CH below skips these: a block reads them, the chart does not */
 nfr  :{scope:"core", lab:"POWER FRAC", u:"",    f:v=>v.n},
 tprog:{scope:"core", lab:"T-PROG",     u:"K",   f:v=>tProg(v,v.K,v)},
 dtavg:{scope:"core", lab:"T-AVG RATE", u:"K/s", f:v=>v.dTavg},
 tfrac:{scope:"core", lab:"TURB SHARE", u:"",    f:v=>unitFrac(v,turbShare(v))},
 rodd :{scope:"core", lab:"ROD DEMAND", u:"%",   f:v=>v.rodDem*100},
 trip :{scope:"core", lab:"TRIPPED",    u:"",    f:v=>v.scrammed?1:0},
 /* not `sub`: the solved field's hottest liquid node (s.sc, step.js) */
 scc  :{scope:"core", lab:"SUBCOOL MARGIN",u:"K", f:v=>v.sc},
 heat :{scope:"core", lab:"HEAT FRAC",  u:"",    f:v=>v.heat},
 rpsset :{scope:"rpsch", lab:"TRIP SET", u:"",   f:(s,ch)=>rpsSetOf(ch,0)},
 rpsnear:{scope:"rpsch", lab:"NEAR SET", u:"",   f:(s,ch)=>rpsSetOf(ch,RPS_NEAR)},
 sglv :{scope:"sg",   lab:"SG LEVEL",   u:"%",   f:(s,id)=>boilerLvl(s,id)},
 sgp  :{scope:"sg",   lab:"SHELL P",    u:"MPa", f:(s,id)=>boilerP(s,id)},
 sgst :{scope:"sg",   lab:"STEAM OUT",  u:"kg/s",f:(s,id)=>(s.steamBy&&s.steamBy[id])||0},
 sgfed:{scope:"sg",   lab:"FEED IN",    u:"kg/s",f:(s,id)=>(s.sgFedBy&&s.sgFedBy[id])||0},
 sgwant:{scope:"sg",  lab:"FEED WANT",  u:"kg/s",f:(s,id)=>feedWant(s,id)},
 /* Infinity with no shell, so an absent generator cannot make a low-level channel */
 sglo :{scope:"plant",lab:"LOWEST SG LEVEL",u:"%",
        f:s=>boilerIds().reduce((m,id)=>Math.min(m,boilerLvl(s,id)),Infinity)},
 pumpq:{scope:"pump", lab:"PUMP SPEED", u:"%",   f:(s,id)=>(s.flowBy[id]||0)*100},
 pumpd:{scope:"pump", lab:"PUMP DEMAND",u:"%",   f:(s,id)=>(s.flowDemBy[id]||0)*100},
 fitp :{scope:"fit",  lab:"VALVE P",    u:"MPa", f:(s,fid)=>reliefP(s,fid)},
 fitopen:{scope:"fit",lab:"VALVE OPEN", u:"",    f:(s,fid)=>s.reliefOpen[fid]?1:0},
 fitlift:{scope:"fit",lab:"LIFT SET",   u:"MPa", f:(s,fid)=>reliefSet(fid).lift},
 fitreseat:{scope:"fit",lab:"RESEAT SET",u:"MPa", f:(s,fid)=>reliefSet(fid).reseat},
 valve:{scope:"fit",  lab:"VALVE POS",  u:"%",   f:(s,fid)=>(s.valve[fid]||0)*100},
 tankl:{scope:"tank", lab:"TANK LEVEL", u:"%",   f:(s,id)=>tankPoolPct(s,[id])},
 loopp:{scope:"loop", lab:"LOOP P",     u:"MPa", f:(s,ci)=>loopP(s,+ci)},
 /* read off the DRAWING, so the governor below states no number of its own */
 loopset:{scope:"loop", lab:"LOOP P SET", u:"MPa", f:(s,ci)=>holdSetP(+ci)},
 supply:{scope:"plant",lab:"SUPPLY",    u:"",    f:s=>supplyK(s)},
 dark :{scope:"plant",lab:"BLACKOUT",   u:"",    f:s=>s.blackout?1:0},
 turbtr:{scope:"plant",lab:"TURBINE TRIPPED",u:"", f:s=>s.turbTrip?1:0},
 time :{scope:"plant",lab:"TIME",       u:"s",   f:s=>s.t},
};
const CH=Object.fromEntries(Object.entries(SIGNAL).filter(([,r])=>r.col));
const sigRead=(s,k,arg)=>{ const r=SIGNAL[k]; if(!r) return 0;
  if(r.scope==="core") return r.f(arg ? coreSeen(s,arg) : s);
  return r.scope==="plant" ? r.f(s) : r.f(s,arg); };
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

/* latches a limit may name: CH-shaped, archived, deliberately out of the strip chart's own list */
const CHB={
 trip  :{lab:"RPS TRIP",      u:"", col:"#ff5a45", f:s=>s.scrammed?1:0},
 melt  :{lab:"CORE MELT",     u:"", col:"#ff5a45", f:s=>s.melt?1:0},
 breach:{lab:"VESSEL BREACH", u:"", col:"#ff5a45", f:s=>s.breach?1:0},
 dmgd  :{lab:"PARTS DOWN",    u:"", col:"#f0a830", f:s=>s.dmgParts.length},
};
/* the one lookup a limit goes through; never CH or CHB by name */
const limCh = k => CH[k] || CHB[k];
const HN=1800, SAMP_TICKS=5; let hist={},hi=0,hlen=0,plot=["pwr","dnbr"];
/* per-vessel ring under "pwr:core1"; the plain key stays the plant's, which is what a limit names */
const UNIT_CH=new Set(Object.keys(CH).filter(k=>CH[k].scope==="core"));
const TREND={unit:null};
const trendUnits=()=>{ const ids=typeof coreIds==="function"?coreIds():[]; return ids.length>1?ids:[]; };
const CHKEYS=()=>{ const ks=Object.keys(CH); for(const id of trendUnits()) for(const k of UNIT_CH) if(CH[k]) ks.push(k+":"+id); return ks; };
const chSplit=k=>{ const i=k.indexOf(":"); return i<0?[k,null]:[k.slice(0,i),k.slice(i+1)]; };
const chSample=k=>{ const [b,id]=chSplit(k); const row=limCh(b); return id?row.f(coreSeen(S,id)):row.f(S); };
const chKey=k=>(TREND.unit && UNIT_CH.has(k) && hist[k+":"+TREND.unit]) ? k+":"+TREND.unit : k;
/* differentiator state lives on S so a scrub restores it */
const period=()=>S?S.perV:Infinity;
function initHist(){ hist={}; for(const k of CHKEYS()) hist[k]=new Float64Array(HN); hi=0;hlen=0;
  if(S){ S.perV=Infinity; S.perN=S.n; S.perT=S.t; } }
function sample(){ for(const k in hist){ const v=chSample(k); hist[k][hi]=isFinite(v)?v:0; }
  hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
  const dt=S.t-S.perT;
  if(dt>1e-9){ const dn=(S.n-S.perN)/dt;
    S.perV = Math.abs(dn)<1e-5 ? Infinity : S.n/dn;
    S.perN=S.n; S.perT=S.t; }
  recSample(); }
function chAt(k,i){ const r=hist[chKey(k)]; return r ? r[((hi-hlen+i)%HN+HN)%HN] : 0; }
/* a viewer fills its ring off the packet: chSample() cannot answer here, the plant is on the other thread */
function histPush(v){
  if(!hlen && !hi) for(const k of CHKEYS()) if(!hist[k]) hist[k]=new Float64Array(HN);
  for(const k in hist){ const x=v[k]; hist[k][hi]=isFinite(x)?x:0; }
  hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
}
function togglePlot(k){ const i=plot.indexOf(k);
  if(i>=0) plot.splice(i,1); else { plot.push(k); if(plot.length>4) plot.shift(); } }

/* chunked so appending never reallocates */
const TR_CHUNK=4096;
const TRKEYS=()=>CHKEYS().concat(Object.keys(CHB));

/* live only: a replay would double-write the archive and disorder the tick index */
function recSample(){
  if(REC.mode!=="live") return;
  const t=recBoot(); if(!t) return;
  const n=t.trN, c=(n/TR_CHUNK)|0, o=n%TR_CHUNK;
  for(const k of TRKEYS()){
    const a=t.tr[k]||(t.tr[k]=[]);
    if(!a[c]) a[c]=new Float64Array(TR_CHUNK);
    const v=chSample(k); a[c][o]=isFinite(v)?v:0;
  }
  /* the tick is stored, never inferred, so the archive does not depend on the sample cadence */
  if(!t.trT[c]) t.trT[c]=new Int32Array(TR_CHUNK);
  t.trT[c][o]=S.tick;
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
  for(const k of CHKEYS()) if(!hist[k]) hist[k]=new Float64Array(HN);
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
}
