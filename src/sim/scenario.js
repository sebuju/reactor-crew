"use strict";
/* limits are judged after the fact off the trend archive; nothing here is on S */

/* dt is 0.02 everywhere, so a sim second is exactly 50 ticks; gestures are authored in seconds */
const SCN_TPS     = 50;
const scnTicks    = t => Math.max(0, Math.round(t*SCN_TPS));
/* one act per half second: far coarser than the tick, far finer than the plant's own lags */
const SCN_RAMP_DT = 0.5;

/* an event type is an `ACT` key; a row exists here only where the authoring shape differs from the act's */
const GEST = {
  loadStep :{lab:"LOAD STEP",  act:"loadDem", lane:"load", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:100, def:80}],
    emit:(a,ctx,put)=>{ ctx.load=a[0]/100; put(0,[ctx.load]); }},

  /* a compiled track is static, so the ramp starts from the last load the script commanded, never from the plant */
  loadRamp :{lab:"LOAD RAMP",  act:"loadDem", lane:"load", span:"ramp",
    args:[{lab:"TO", u:"%", min:0, max:100, def:60}, {lab:"OVER", u:"s", def:60}],
    emit:(a,ctx,put)=>{
      const to=a[0]/100, secs=Math.max(0,a[1]||0), from=ctx.load;
      const n=Math.max(1,Math.round(secs/SCN_RAMP_DT));
      for(let i=1;i<=n;i++) put(secs*i/n, [from+(to-from)*i/n]);
      ctx.load=to; }},

  flowStep :{lab:"PUMP STEP",  act:"flowDem", lane:"pump", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:110, def:100}],
    emit:(a,ctx,put)=>put(0,[a[0]/100])},
  rodStep  :{lab:"ROD STEP",   act:"rodCommon", lane:"rod", span:"point",
    args:[{lab:"TO", u:"%", min:0, max:100, def:50}],
    emit:(a,ctx,put)=>put(0,[a[0]/100])},
  boronStep:{lab:"BORON STEP", act:"boronDem", lane:"boron", span:"point",
    args:[{lab:"TO", u:"pcm", def:-500}],
    emit:(a,ctx,put)=>put(0,[a[0]])},

  scram    :{lab:"SCRAM",      act:"scram", lane:"rod", span:"point",    args:[], emit:(a,ctx,put)=>put(0,[])},
  resetTrip:{lab:"TRIP RESET", act:"resetTrip", lane:"rod", span:"point", args:[], emit:(a,ctx,put)=>put(0,[])},
  hit      :{lab:"COMBAT HIT", act:"hit", lane:"dmg", span:"point",
    args:[{lab:"PART", u:"id", def:"turb"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  repair   :{lab:"REPAIR",     act:"repair", lane:"dmg", span:"point",
    args:[{lab:"PART", u:"id", def:"turb"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  blackout :{lab:"BLACKOUT",   act:"blackout", lane:"sys", span:"latch", pair:0,
    args:[{lab:"ON", u:"on", def:true}],
    emit:(a,ctx,put)=>put(0,[!!a[0]])},
  /* commands DICE.porvStick instead of rolling it: a scripted run stands every die down */
  porvArm  :{lab:"PORV STICKS",act:"porvArm", lane:"sys", span:"point", args:[], emit:(a,ctx,put)=>put(0,[])},
  blkOn    :{lab:"BLOCK ON/OFF",act:"blkOn", lane:"sys", span:"latch",
    args:[{lab:"BLOCK", u:"blk", def:"b1"}],
    emit:(a,ctx,put)=>put(0,[a[0]])},
  valve    :{lab:"VALVE",      act:"valveDem", lane:"sys", span:"latch",
    args:[{lab:"ID", u:"id", def:""},{lab:"TO", u:"%", min:0, max:100, def:0}],
    emit:(a,ctx,put)=>put(0,[a[0], a[1]/100])},

  /* `act:null` rather than a no-op ACT row, which would still land on the tape */
  note     :{lab:"NOTE",       act:null, lane:"note", span:"point",
    args:[{lab:"TEXT", u:"text", def:""}]},
};
const GESTKEYS = Object.keys(GEST);

/* asserted at load: a palette row naming a sched:false act is a coding error in this file */
for(const k of GESTKEYS){
  const a = GEST[k].act; if(!a) continue;
  if(!ACT[a]) throw new Error("GEST."+k+" compiles to "+a+", which is not an act");
  if(ACT[a].sched === false)
    throw new Error("GEST."+k+" schedules "+a+", which is marked sched:false");
}

/* lane and span are GEST fields so the timeline needs no table of its own; a lane never reaches the sim */
const SCNLANE = ["load","pump","rod","boron","sys","dmg","note"];
const SPANKIND = {ramp:1, latch:1, point:1};
for(const k of GESTKEYS){
  const G=GEST[k];
  if(!SCNLANE.includes(G.lane))
    throw new Error("GEST."+k+" names lane "+G.lane+", which is not in SCNLANE");
  if(!SPANKIND[G.span])
    throw new Error("GEST."+k+" has span "+G.span+", which is not one of "+Object.keys(SPANKIND));
}
/* the arg the renderer drags: a second draggable edge needs a row here saying what it writes */
const RAMPARG = {loadRamp:1};

function scnNormalize(scn){
  if(!scn.lanes) scn.lanes = SCNLANE.map(id=>({id}));
  for(const e of scn.gest) if(!e.lane) e.lane = (GEST[e.k]&&GEST[e.k].lane) || scn.lanes[0].id;
  return scn;
}
const scnNew   = (id,name) => scnNormalize({id, name, seed:1, secs:120, gest:[], limits:[]});
const scnGest  = (scn,t,k,...a) => { scn.gest.push({t, k, a, lane:GEST[k].lane}); return scn; };
const scnLimit = (scn,id,ch,cmp,v,grace) => {
  scn.limits.push({id, ch, cmp, v, grace:grace||0}); return scn; };
/* deep to the argument arrays, or two runs of one preset would share objects */
const scnClone = pre => scnNormalize({
  id:pre.id, name:pre.name, seed:pre.seed, secs:pre.secs,
  gest  : pre.gest.map(g => ({t:g.t, k:g.k, a:g.a.slice(), lane:g.lane})),
  limits: pre.limits.map(L => Object.assign({}, L)),
  lanes : pre.lanes && pre.lanes.map(L => Object.assign({}, L)),
});

/* authored time order because `ctx` carries the load a ramp starts from; the emission index breaks ties */
function scnCompile(scn){
  const raw = [];
  const gs = scn.gest.map((g,i)=>({g,i}))
                     .sort((x,y)=> (x.g.t - y.g.t) || (x.i - y.i));
  const ctx = {load:1};                 // resetPlant() commissions at loadDem 1
  for(const {g} of gs){
    const R = GEST[g.k];
    if(!R) throw new Error("scnCompile: no such gesture "+g.k);
    if(!R.act) continue;
    R.emit(g.a||[], ctx, (dt,a)=>raw.push({t:g.t+dt, seq:raw.length, k:R.act, a}));
  }
  raw.sort((x,y)=> (x.t - y.t) || (x.seq - y.seq));
  return raw.map(e => ({tick:scnTicks(e.t), k:e.k, a:e.a}));
}

/* fired through act(), live only, on tick equality rather than a cursor, which is what makes a branch re-fire from the seek point */
let SCNRUN = null;
/* `o` is PLAY's: RUN drives its own loop to scn.secs and judges the take itself, so it passes none */
function scnArm(scn,o){
  const track = scnCompile(scn), by = new Map();
  for(const e of track){
    const l = by.get(e.tick);
    if(l) l.push(e); else by.set(e.tick, [e]);
  }
  SCNRUN = {scn, track, by, end:o&&o.end, take:o&&o.take, onEnd:o&&o.onEnd};
  return SCNRUN;
}
const scnDisarm = () => { SCNRUN = null; };
const scnArmed  = () => SCNRUN ? SCNRUN.scn : null;

function scnDue(tick){
  if(!SCNRUN || REC.mode !== "live") return;
  const R=SCNRUN;
  const due = R.by.get(tick);
  if(due) for(const e of due) act(e.k, ...e.a);
  /* here because both runners already call this every tick; anywhere else is a second clock */
  if(R.end!=null && (tick>=R.end || S.breach)){
    scnDisarm();
    const verdict = scnJudge(R.take, R.scn.limits);
    R.take.verdict = verdict;
    if(R.onEnd) R.onEnd({take:R.take, verdict});
  }
}

/* a limit states the requirement and `grace` is in ticks; a violation shorter than one sample interval can fall between two samples unseen */
const scnVerdLab = v => !v ? ""
  : (v.pass ? (v.assisted ? "PASS (ASSISTED)" : "PASS") : "FAIL")
    + (v.thin > 1 ? " / COARSE 1:"+v.thin : "");
const scnVerdCol = v => !v ? C.ink2 : v.pass ? (v.assisted ? C.amber : C.green) : C.red;

function scnJudge(take, limits){
  const segs = trSegs(take, take.tickEnd);
  /* grace widened per segment by trThin: a thinned archive cannot resolve the authored window */
  let thin = 1;
  const rows = (limits||[]).map(L => {
    if(!limCh(L.ch)) throw new Error("scnJudge: no such channel "+L.ch);
    const g0 = scnTicks(L.grace||0), up = L.cmp === ">";
    let start=null, brokeAt=null, worst=null, worstAt=null;
    for(const sg of segs){
      const t = sg[0];
      if(!t.tr[L.ch]) continue;         // a take from before this channel existed
      const g = g0*(t.trThin||1);
      if(t.trThin > thin) thin = t.trThin;
      for(let i=sg[1]; i<sg[2]; i++){
        const tk = trTick(t,i), x = trAt(t,L.ch,i);
        if(up ? x > L.v : x < L.v) start = null;
        else {
          if(start === null) start = tk;
          if(brokeAt === null && tk - start >= g) brokeAt = tk;
        }
        if(worst === null || (up ? x < worst : x > worst)){ worst = x; worstAt = tk; }
      }
    }
    return {L, broke:brokeAt !== null, tick:brokeAt, worst, worstAt};
  });
  return {
    pass  : rows.every(r => !r.broke),
    rows,
    /* carried, not computed: a take with a parent was scrubbed into, so a PASS on it is a PASS with help */
    assisted : !!take.assisted,
    thin,
  };
}

/* seed and dice go on S before recRoot() snapshots it as the take's base; a breach ends the run, a melt deliberately does not */
function scnRun(scn, onProgress){
  const was = SCNRUN;
  resetPlant();
  seedRng(S, scn.seed >>> 0);
  S.diceOff = true;
  recRoot();
  const take = recCur();
  take.label = scn.name;

  scnArm(scn);
  const end = scnTicks(scn.secs);
  /* coarse on purpose: a callback every tick would cost more than the tick */
  const every = Math.max(1, Math.round(end/50));
  while(S.tick < end){
    simTick();                          // scnDue() fires from inside it
    recTick();
    if(onProgress && S.tick % every === 0) onProgress(S.tick/end);
    if(S.breach) break;
  }
  SCNRUN = was;

  const verdict = scnJudge(take, scn.limits);
  take.verdict = verdict;
  return {take, verdict};
}

/* the same loop as scnRun(), sliced out of the frame loop; a budget rather than a tick count */
const SCN_BUDGET = 8;
let SCNJOB = null;
const scnBusy = () => !!SCNJOB;
const scnFrac = () => SCNJOB ? Math.min(1, S.tick / Math.max(1, SCNJOB.end)) : 0;

/* a worker refuses to load into a file:// null origin, so the slice is a real path; the deadline catches one that loads and never answers */
const SCN_HANDSHAKE = 4000;
let SCNW = null;
function scnWorkerGo(scn, onProgress, onDone, onFail){
  if(typeof Worker !== "function" || typeof location === "undefined") return false;
  const base = location.href.replace(/[^/]*$/, "");
  let w;
  try{ w = new Worker("src/sim/runworker.js"); }catch(e){ return false; }
  SCNW = w;
  let done = false;
  const give = why => { if(done) return; done = true;
    try{ w.terminate(); }catch(e){} if(SCNW===w) SCNW=null; onFail(why); };
  const timer = setTimeout(()=>give("the worker did not answer"), SCN_HANDSHAKE);
  w.onerror = () => give("the worker could not load");
  w.onmessage = ev => {
    const m = ev.data || {};
    if(m.t === "ready"){ clearTimeout(timer); w.postMessage({t:"run", scn, head:recHead()}); }
    else if(m.t === "prog"){ if(onProgress) onProgress(m.f); }
    else if(m.t === "err"){ clearTimeout(timer); give(m.msg); }
    else if(m.t === "done"){
      clearTimeout(timer); done = true;
      try{ w.terminate(); }catch(e){} if(SCNW===w) SCNW=null;
      const take = scnGraft(m.take, m.endS);
      if(onProgress) onProgress(1);
      onDone({take, verdict:m.verdict});
    }
  };
  w.postMessage({t:"init", base});
  return true;
}

/* the worker's own ids mean nothing here: adopted as a root, with the plant left where the run ended */
function scnGraft(take, endS){
  take.id = REC.takes.length; take.parent = null; take.kids = [];
  REC.takes.push(take); REC.roots.push(take.id); REC.cur = take.id;
  recKeysAdopt(take); REC.trBytes += trBytesOf(take);
  restoreS(endS);
  REC.mode = "live";
  recTrimRoots();
  return take;
}

function scnRunAsync(scn, onProgress, onDone){
  scnCancel();                          // one run at a time; a second RUN replaces the first
  const slice = () => scnSliceGo(scn, onProgress, onDone);
  /* the slice also catches a worker that falls over mid-run, which must not take the run with it */
  if(scnWorkerGo(scn, onProgress, onDone, why => {
        logE("info","SCENARIO RUN ON THIS THREAD",
          "A background thread was not available ("+why+"), so the run is being "+
          "sliced across frames instead. It is the same run and the same answer, "+
          "just slower and sharing the page with the drawing.");
        slice(); })) return scnCancel;
  return slice();
}

function scnSliceGo(scn, onProgress, onDone){
  resetPlant();
  seedRng(S, scn.seed >>> 0);
  S.diceOff = true;
  /* order is load-bearing: recRoot() takes base:snapS(S), so the seed and the stood-down dice must already be on S */
  recRoot();
  const take = recCur();
  take.label = scn.name;
  scnArm(scn);
  SCNJOB = {scn, take, end:scnTicks(scn.secs), onProgress, onDone, was:SCNRUN};
  TR.paused = true;                     // the live driver stands off while a run drains
  return scnCancel;
}

function scnCancel(){
  if(SCNW){ try{ SCNW.terminate(); }catch(e){} SCNW=null; }
  if(!SCNJOB) return false;
  SCNJOB = null;
  scnDisarm();
  return true;
}

/* simFrame() hands the whole frame over: nothing else may step the plant while a run is in flight */
function scnDrain(){
  if(!SCNJOB) return false;
  const j = SCNJOB, t0 = performance.now();
  while(S.tick < j.end && performance.now() - t0 < SCN_BUDGET){
    simTick(); recTick();
    if(S.breach) break;
  }
  if(j.onProgress) j.onProgress(scnFrac());
  if(S.tick >= j.end || S.breach){
    const verdict = scnJudge(j.take, j.scn.limits);
    j.take.verdict = verdict;
    SCNJOB = null; scnDisarm();
    if(j.onDone) j.onDone({take:j.take, verdict});
    return false;
  }
  return true;
}

/* every die is stood down in a scripted run, so the fixed seed decides nothing today */
const SCN_SEED = 20260824;
const SCNPRE = [
  (()=>{ const s = scnNew("loadfollow","LOAD FOLLOW");
    s.seed = SCN_SEED; s.secs = 180;
    scnGest(s, 10, "note", "TAKE THE SET DOWN TO 60% OVER A MINUTE");
    scnGest(s, 10, "loadRamp", 60, 60);
    scnGest(s, 90, "note", "HOLD, THEN BACK UP");
    scnGest(s,110, "loadRamp",100, 60);
    scnLimit(s,"no trip",  "trip", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr", ">", 1.30, 0.5);
    scnLimit(s,"t-avg",    "tavg", "<", 590,  0.5);
    return s; })(),

  (()=>{ const s = scnNew("blackout","STATION BLACKOUT");
    s.seed = SCN_SEED; s.secs = 150;
    scnGest(s, 20, "note", "OFFSITE POWER LOST");
    scnGest(s, 20, "blackout", true);
    scnGest(s,100, "note", "SUPPLY RESTORED - WATCH THE OVERSHOOT");
    scnGest(s,100, "blackout", false);
    scnLimit(s,"no melt",  "melt",   "<", 1,    0);
    scnLimit(s,"no breach","breach", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr",   ">", 1.10, 0.5);
    return s; })(),

  (()=>{ const s = scnNew("action","ACTION DAMAGE");
    s.seed = SCN_SEED; s.secs = 180;
    scnGest(s, 20, "note", "ROD DRIVE HIT - THE BANK IS STUCK WHERE IT STANDS");
    scnGest(s, 20, "hit", "rods");
    scnGest(s, 30, "loadRamp", 70, 30);
    scnGest(s, 45, "repair", "rods");
    scnGest(s,120, "note", "DRIVES BACK - TAKE THE SET UP AGAIN");
    scnGest(s,120, "loadRamp", 100, 30);
    scnLimit(s,"no trip",  "trip", "<", 1,    0);
    scnLimit(s,"dnbr",     "dnbr", ">", 1.35, 0.5);
    scnLimit(s,"t-avg",    "tavg", "<", 590,  0.5);
    return s; })(),

  (()=>{ const s = scnNew("scramret","SCRAM AND RETURN");
    s.seed = SCN_SEED; s.secs = 180;
    scnGest(s, 10, "note", "SCRAM - BACK TO 50 % BEFORE 150 S");
    scnGest(s, 10, "scram");
    scnGest(s, 30, "note", "CLEAR THE LATCH AND WALK THE BANK BACK OUT");
    scnGest(s, 30, "resetTrip");
    scnGest(s, 40, "rodStep", 30);
    scnGest(s, 70, "rodStep", 15);
    scnGest(s,100, "rodStep", 5);
    scnGest(s,120, "rodStep", 0);
    /* the grace is the deadline: below half power for longer than 150 s is the failure */
    scnLimit(s,"back to 50 %","pwr",  ">", 50,   150);
    scnLimit(s,"dnbr",       "dnbr",  ">", 1.30, 0.5);
    return s; })(),
];

let SCN = scnClone(SCNPRE[0]);
