"use strict";
/* trend history ring buffers */

/* ═══════════════ TREND HISTORY ═══════════════ */
const HT = s => s.Tavg + 15*(s.n*PROMPT_F + s.decay);
const CH={
 pwr :{lab:"POWER",        u:"%",  col:"#57d38c", f:s=>s.n*100},
 dnbr:{lab:"DNBR",         u:"",   col:"#f0a830", f:s=>s.dnbr},
 tf  :{lab:"FUEL TEMP",    u:"K",  col:"#ff5a45", f:s=>s.Tf},
 tavg:{lab:"T-AVG",        u:"K",  col:"#5fd2e2", f:s=>s.Tavg},
 th  :{lab:"T-HOT",        u:"K",  col:"#ffa07a", f:s=>HT(s)},
 tc  :{lab:"T-COLD",       u:"K",  col:"#5aa9d6", f:s=>s.Tavg-15*(s.n*PROMPT_F+s.decay)},
 prs :{lab:"PRESSURE",     u:"MPa",col:"#a98cf0", f:s=>s.P},
 sub :{lab:"SUBCOOLING",   u:"K",  col:"#5fd2e2", f:s=>tsat(s.P)-HT(s)},
 lvl :{lab:"PZR LEVEL",    u:"%",  col:"#c8d8dc", f:s=>s.lvl},
 sgl :{lab:"SG LEVEL",     u:"%",  col:"#8fa9ae", f:s=>sglMin(s)},   // the driest generator - an average would hide one boiling dry behind three healthy ones
 hot :{lab:"HOTWELL",      u:"%",  col:"#6f97a8", f:s=>tankPoolPct(s,hostedTankIds())},
 inv :{lab:"INVENTORY",    u:"%",  col:"#5aa9d6", f:s=>s.inv},
 /* flowNet, not flow: the label says CORE FLOW, so it has to be the flow that
    reaches the core - what the pumps were TOLD to do is flowDemPri()'s business.
    The two are equal on an undamaged, unthrottled plant, so no archived trend
    changes shape; they part company exactly when a valve shuts or a run is
    severed, which is the moment this trace has something to say. */
 flow:{lab:"CORE FLOW",    u:"%",  col:"#57d38c", f:s=>s.flowNet*100},
 load:{lab:"LOAD DEMAND",  u:"%",  col:"#f0a830", f:s=>s.load*100},
 rod :{lab:"ROD BANK",     u:"%",  col:"#c8d8dc", f:s=>s.rodPos*100},
 bor :{lab:"BORON",        u:"pcm",col:"#5fd2e2", f:s=>s.boron},
 xe  :{lab:"XENON",        u:"pcm",col:"#5aa9d6", f:s=>s.parts.xe},
 exp :{lab:"EXPANSION",    u:"pcm",col:"#8fa9ae", f:s=>s.parts.exp},
 fq  :{lab:"PEAKING Fq",  u:"",   col:"#f0a830", f:s=>s.fq},
 ao  :{lab:"AXIAL OFFSET",u:"%",  col:"#a98cf0", f:s=>s.ao*100},
 ro  :{lab:"RADIAL TILT", u:"%",  col:"#5fd2e2", f:s=>s.ro*100},
 rho :{lab:"NET RHO",      u:"pcm",col:"#ff5a45", f:s=>s.rho},
 vd  :{lab:"VOID FRACTION",u:"",   col:"#a98cf0", f:s=>s.vf},
 dmg :{lab:"FUEL DAMAGE",  u:"%",  col:"#ff5a45", f:s=>s.dmg},
 fat :{lab:"VESSEL FATIGUE",u:"%", col:"#f0a830", f:s=>s.fatigue},
 cav :{lab:"CAVITATION",   u:"",   col:"#f0a830", f:s=>s.cav},
 nat :{lab:"NAT CIRC",     u:"%",  col:"#57d38c", f:s=>s.nat*100},
 rel :{lab:"RELEASE",      u:"%",  col:"#ff5a45", f:s=>s.release},
 /* Decay heat is simulated and was printed nowhere. It is the heat that does
    not go away with the chain reaction, so it needs its own trace beside POWER. */
 dec :{lab:"DECAY HEAT",   u:"%",  col:"#ff9a5a", f:s=>s.decay*100},
 /* Both cost the tape nothing: a trend ring is rebuilt from S every time,
    never recorded (see the header comment above), so these two are free the
    same way every other channel here is - they read s.doseRate/s.crewDose,
    which are themselves derived fresh every tick and never stored either. */
 rad :{lab:"AREA DOSE",  u:"x", col:"#c8d8dc", f:s=>s.doseRate},
 cdos:{lab:"WATCH DOSE", u:"%", col:"#8fa9ae", f:s=>s.crewDose},
 /* APPENDED, and dmg above is neither renamed nor repurposed: a scenario limit
    names a trend key by STRING, so moving one silently changes what a saved
    scenario asserts. These three are what the staged damage field can say and
    the old scalar could not. */
 mlt :{lab:"FUEL MOLTEN",u:"%", col:"#ff9a5a", f:s=>s.meltFrac*100},
 h2  :{lab:"HYDROGEN",   u:"kg",col:"#a98cf0", f:s=>s.h2},
 // what the gas did when it lit, rather than how much of it there is
 rp  :{lab:"ROOM PRESSURE",u:"kPa",col:"#ff6a6a", f:s=>s.roomPMax},
 dnbm:{lab:"MIN NODE DNBR",u:"",col:"#f0a830", f:s=>s.dnbrMin},
 /* the sink the ship actually has. Everything else on this list is about
    making heat or moving it; this is the one channel about getting rid of it,
    and it is the slowest pot on the plant. */
 radt:{lab:"PANEL TEMP",  u:"K", col:"#b8c4cf", f:s=>radTMax(s)},
};
/* ══ HOW A CHANNEL IS DRAWN, NOT WHAT IT IS ══
   A trend used to scale itself to whatever it happened to contain, and that is
   the wrong picture twice over: a channel resting on its setpoint got its own
   fourth decimal stretched over the full height of the plot, so a plant doing
   nothing drew as a plant thrashing; and the scale moved every time the ring
   filled, so the SAME data redrew at a different height a second later. A
   vital has a range it is STEERED in, and that range is a property of the
   plant, so the chart is pinned to it and a flat trace draws flat.

   `rng` is that range and `warn` is the line you are not meant to cross - the
   same figure tripCause() and ANN already use, read from the same place rather
   than copied, so retuning a trip moves the line on the chart with it. Both
   are functions because nearly every one of them is a fraction of a
   COMMISSIONED figure: 15.5 MPa is nominal on a PWR and nothing like it on an
   HTGR, and a fixed scale would peg half the architectures.

   A channel with no row here keeps the old self-scaling behaviour. */
const CHVIEW={
 pwr :{rng:()=>[0,125],                     warn:()=>[(1.10+0.22*P.rpsm)*100]},
 dnbr:{rng:()=>[0,Math.max(3,P.dnbr0*1.3)], warn:()=>[1.30, 1.18-0.16*P.rpsm]},
 tf  :{rng:()=>[300,Math.max(2000,P.tdmg+700)], warn:()=>[P.tdmg, P.tdmg+100+280*P.rpsm]},
 tavg:{rng:()=>[P.Tref-60,P.Tref+60]},
 th  :{rng:()=>[P.Tref-40,P.Tref+80]},
 tc  :{rng:()=>[P.Tref-80,P.Tref+40]},
 prs :{rng:()=>[P.P0*0.70,P.P0*1.25],       warn:()=>[P.P0*0.86, P.P0*(1.06+0.07*P.rpsm)]},
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
 /* full scale is the whole clad inventory burnt, so the trace says what
    fraction of the core's zirconium has gone rather than a picked ceiling */
 h2  :{rng:()=>[0,Math.max(50,P.cladKg*ZR_H2)], warn:()=>[H2_EV]},
 /* the two limits that are machines rather than round numbers: the weakest
    thing on the plant and the strongest, so the trace says which of them the
    blast has already passed. */
 rp  :{rng:()=>[0,900], warn:()=>[15, 200]},
 dnbm:{rng:()=>[0,Math.max(2.6,P.dnbr0*1.3)],   warn:()=>[1]},
 /* pinned to the two real ceilings rather than a picked span: the design
    sink, then the panel temperature at which the condenser reaches the
    turbine's trip pressure. */
 radt:{rng:()=>[200,tsatSec(COND_ATM)-COND_DT0],
       warn:()=>[RAD_TDES, tsatSec(TURB_TRIP_P)-COND_DT0]},
};

/* ══ THE LATCHES LIVE BESIDE THE CHANNELS, NOT IN THEM ══
   A scenario limit is asked of a channel, and "did it trip" is exactly the sort
   of thing somebody wants to write a limit about - so these have to be in the
   archive and readable by key, the same as POWER or DNBR. They are NOT in CH,
   and that is the whole of the decision: CH is the strip chart's own list, so
   joining it would put four latches in the TRENDS legend, four more keys in
   togglePlot(), and four more 1800-slot rings in initHist() - three costs paid
   so a plot of "RPS TRIP" can draw a step from 0 to 1 that the annunciator
   already says better. A trip latch is a fact about the run, not a trend.

   Same shape as a CH row so limCh() can hand either one back without the caller
   asking which list it came from. `u` is empty and `col` is alarm red because
   every one of these is a latch that only ever means something bad. */
const CHB={
 trip  :{lab:"RPS TRIP",      u:"", col:"#ff5a45", f:s=>s.scrammed?1:0},
 melt  :{lab:"CORE MELT",     u:"", col:"#ff5a45", f:s=>s.melt?1:0},
 breach:{lab:"VESSEL BREACH", u:"", col:"#ff5a45", f:s=>s.breach?1:0},
 dmgd  :{lab:"PARTS DOWN",    u:"", col:"#f0a830", f:s=>s.dmgParts.length},
};
/* The one lookup a limit goes through. Ask this, never CH or CHB by name. */
const limCh = k => CH[k] || CHB[k];
const HN=1800, SAMP_TICKS=5; let hist={},hi=0,hlen=0,plot=["pwr","dnbr"];
/* ══ THE REACTOR PERIOD LIVES ON THE CLOCK, NOT IN A DRAW ══
   Period is seconds for power to multiply by e, so it is a DIFFERENTIATOR, and
   a differentiator cannot live in a draw function any more. `readoutsFor()` is
   called TWICE a frame - once to measure the drawing and once to fill it - so
   the old `lastN` in drawLedger() would now be stepped twice per tick and
   report half the period it should. This is the clock that ticks once.

   Differentiated against `S.t` and never the wall clock, for the reason the
   pipe meters already document: one frame runs one tick, sometimes two,
   sometimes none, while the wall clock advances smoothly.

   AND IT LIVES ON S, not here. A snapshot of the plant is a clone of S and
   nothing else, so a differentiator parked in a module global would be the one
   thing a scrub could not put back - period would read whatever the run you
   scrubbed AWAY from left behind. s.perN/s.perT/s.perV move with the state.

   sampT is gone with them. It accumulated WALL seconds, so the moment the sim
   could be run at 4x or 16x the strip chart stopped being 180 seconds of plant
   and started being 180 seconds of watching. The sampler counts ticks now. */
const period=()=>S?S.perV:Infinity;
function initHist(){ hist={}; for(const k in CH) hist[k]=new Float64Array(HN); hi=0;hlen=0;
  if(S){ S.perV=Infinity; S.perN=S.n; S.perT=S.t; } }
function sample(){ for(const k in CH){ const v=CH[k].f(S); hist[k][hi]=isFinite(v)?v:0; }
  hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
  const dt=S.t-S.perT;
  if(dt>1e-9){ const dn=(S.n-S.perN)/dt;
    S.perV = Math.abs(dn)<1e-5 ? Infinity : S.n/dn;
    S.perN=S.n; S.perT=S.t; }
  recSample(); }
function chAt(k,i){ return hist[k][((hi-hlen+i)%HN+HN)%HN]; }
function togglePlot(k){ const i=plot.indexOf(k);
  if(i>=0) plot.splice(i,1); else { plot.push(k); if(plot.length>4) plot.shift(); } }

/* ═══════════════ THE TREND ARCHIVE ═══════════════
   `hist` above is three minutes of ring buffer, which is what a strip chart
   needs and nothing like what a debrief needs. The archive is the whole take,
   kept on the take itself, so scrubbing to second 600 of a twelve-minute run
   puts the chart back INSTANTLY and EXACTLY instead of blanking it or
   re-simulating ten minutes to redraw a picture the run already drew once.

   ── CHUNKED, so appending never reallocates ──
   A growing Float64Array means a copy of everything every time it doubles, on the
   sample tick, in the middle of the frame. TR_CHUNK samples per channel per
   chunk instead: appending only ever writes one slot, and the chunk before it
   is never touched again.

   ── ONE LIST, AND IT IS TRKEYS() ──
   The archive walks TRKEYS(), never CH directly, and TRKEYS() is CH plus CHB -
   the boolean latches, which are not strip-chart channels and must still be
   answerable by a scenario limit. This is the list that extending the archive
   means extending; anything that reaches into CH by name is a second list that
   would have been forgotten on the day CHB landed.

   THE RING IS NOT THE ARCHIVE. `hist` above is the strip chart and carries CH
   alone, because CHB has nothing to plot - so histFill() fills the ring off
   CH's keys while reading an archive that holds more than it.

   ── perN/perT/perV need nothing here ──
   The reactor period is a differentiator and its state is on S, so it comes
   back with the snapshot a seek restores and re-derives itself from there. It
   is the one trend number that is NOT rebuilt from the archive, and that is
   correct: it is plant state, not history. */
const TR_CHUNK=4096;
const TRKEYS=()=>Object.keys(CH).concat(Object.keys(CHB));

/* Live only. A replay is re-deriving samples the archive already holds, so
   letting it append would write the same seconds twice and put the tick index
   out of order - and the index is the only thing histFill() can search. */
function recSample(){
  if(REC.mode!=="live") return;
  const t=recBoot(); if(!t) return;
  const n=t.trN, c=(n/TR_CHUNK)|0, o=n%TR_CHUNK;
  for(const k of TRKEYS()){
    const a=t.tr[k]||(t.tr[k]=[]);
    if(!a[c]) a[c]=new Float64Array(TR_CHUNK);
    const v=limCh(k).f(S); a[c][o]=isFinite(v)?v:0;
  }
  /* The tick each sample was taken on, alongside. It could be inferred from a
     start tick and SAMP_TICKS, but that would make the cadence an invariant the
     archive silently depends on, and the archive is the last thing that should
     be guessing. An Int32Array is 4 bytes a sample against 26 channels at 8. */
  if(!t.trT[c]) t.trT[c]=new Int32Array(TR_CHUNK);
  t.trT[c][o]=S.tick;
  t.trN=n+1;
}
const trAt  =(take,k,i)=>take.tr[k][(i/TR_CHUNK)|0][i%TR_CHUNK];
const trTick=(take,i)  =>take.trT[(i/TR_CHUNK)|0][i%TR_CHUNK];
/* Index of the last sample at or before `tick`, or -1. Ticks ascend, so binary. */
function trBefore(take,tick){
  let lo=0, hi2=take.trN-1, r=-1;
  while(lo<=hi2){ const m=(lo+hi2)>>1;
    if(trTick(take,m)<=tick){ r=m; lo=m+1; } else hi2=m-1; }
  return r;
}

/* ── THE ONE WALK OVER A RUN'S HISTORY ──
   A run is a LINEAGE, not one take: a branch made at 10 s holds no samples from
   before it exists, so the first ten seconds are on its parent. Each ancestor
   contributes the samples it took before the next take started and the owner
   contributes up to `tick`. Returned as `[take, from, to)` triples in time
   order, so a caller walks them back to back and never has to know that the
   run changed hands part-way through.

   Two callers and therefore one function: the strip chart below, which trims
   the result to the last HN samples, and scnJudge() in scenario.js, which walks
   the lot to decide whether a limit was ever broken. Written twice, the day
   somebody fixes a boundary in one of them is the day the chart and the verdict
   start describing different runs. */
function trSegs(take,tick){
  /* A take somebody still holds may no longer be IN the forest: eviction drops
     a root and its whole subtree and tombstones the slots, so lineage() would
     hand back nothing and a verdict judged off nothing is a silent PASS. When
     the slot no longer holds this take, walk the take alone - which is exactly
     what is left, because recDrop() takes a lineage together or not at all. */
  const line=REC.takes[take.id]===take?lineage(take.id):[take], segs=[];
  for(let n=0;n<line.length;n++){
    const t=line[n], cut=n+1<line.length?line[n+1].tick0-1:tick;
    const end=trBefore(t,Math.min(cut,tick));
    if(end>=0) segs.push([t,0,end+1]);
  }
  return segs;
}

/* ── put the strip chart back ──
   The last HN samples of the lineage, in the ring the chart reads. Handles an
   archive shorter than HN by simply copying what there is.
   The ring carries CH alone - see THE RING IS NOT THE ARCHIVE above - so this
   fills off CH's keys while reading an archive that also holds CHB. */
function histFill(take,tick){
  for(const k in CH) if(!hist[k]) hist[k]=new Float64Array(HN);
  const segs=trSegs(take,tick);
  let total=0; for(const s of segs) total+=s[2]-s[1];
  let skip=Math.max(0,total-HN);
  for(const s of segs){ const d=Math.min(skip,s[2]-s[1]); s[1]+=d; skip-=d; }
  const KS=Object.keys(CH);
  hi=0; hlen=0;
  for(const s of segs) for(let i=s[1];i<s[2];i++){
    for(const k of KS) hist[k][hi]=trAt(s[0],k,i);
    hi=(hi+1)%HN; hlen=Math.min(hlen+1,HN);
  }
}
