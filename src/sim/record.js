"use strict";
/* the cloner, the comparator and the byte count must all agree about this list; store.js packs the same five (TARR) */
const SNAP_TARR = [Float64Array, Float32Array, Int32Array, Uint8Array, Int8Array];
const snapTyped = v => { for(let i=0;i<SNAP_TARR.length;i++) if(v instanceof SNAP_TARR[i]) return SNAP_TARR[i];
  return null; };
/* throws rather than copying a reference into the snapshot, which is what keeps the all-state-on-S rule checkable */
function snapVal(v){
  if(v === null || typeof v !== "object") return v;
  const T = snapTyped(v);
  if(T) return new T(v);
  if(Array.isArray(v)) return v.map(snapVal);
  if(Object.getPrototypeOf(v) === Object.prototype){
    const o = {}; for(const k in v) o[k] = snapVal(v[k]); return o; }
  throw new Error("snapS: S carries a " + Object.prototype.toString.call(v) +
                  ", which cannot be snapshotted - sim state must be plain");
}
const snapS = s => snapVal(s);

/* clones on the way out too, or the next tick mutates the keyframe and a second seek to it lands somewhere else */
function restoreS(snap){ S = snapVal(snap);
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  return S; }

/* the PATH of the first difference, not a boolean; Object.is so a NaN matches a NaN */
function eqWhere(a, b, path){
  path = path || "s";
  if(a === null || typeof a !== "object" || b === null || typeof b !== "object")
    return Object.is(a, b) ? null : path + ": " + a + " vs " + b;
  const Ta = snapTyped(a), Tb = snapTyped(b);
  if(Ta !== Tb) return path + ": typed " + (Ta && Ta.name) + " vs " + (Tb && Tb.name);
  const ta = !!Ta;
  if(ta || Array.isArray(a)){
    if(a.length !== b.length) return path + ".length: " + a.length + " vs " + b.length;
    for(let i = 0; i < a.length; i++){
      const w = eqWhere(a[i], b[i], path + "[" + i + "]"); if(w) return w; }
    return null;
  }
  for(const k in a){ const w = eqWhere(a[k], b[k], path + "." + k); if(w) return w; }
  for(const k in b) if(!(k in a)) return path + "." + k + ": missing vs " + b[k];
  return null;
}
const eqS = (a, b) => eqWhere(a, b) === null;

/* `apply` is the one performer, in SIM units: `sched:false` bars a scenario, `cont:true` marks a coalescable last argument, `part` names the machine, `rec:false` keeps it off every tape */
const coreLab = id => { const p=partOf(id); return p ? p.name : id; };
const ACT = {
  /* `log` formats the VALUE; `nolog:true` marks a row that writes its own entry */
  flowDem  : {lab:"PUMP DEMAND",  cont:true, log:v=>(v*100).toFixed(0)+" %",
              apply:(s,v)=>{ for(const id of pumpIds()) if(primaryPump(id)) s.flowDemBy[id]=v; }},
  /* p.name, not partName(): core/ui.js is outside the subset the scenario worker loads */
  pumpDem  : {lab:"PUMP DEMAND",  cont:true, part:id=>id,
              log:(id,v)=>{ const p=partOf(id);
                return (p?p.name:id)+" TO "+(v*100).toFixed(0)+" %"; },
              apply:(s,id,v)=>{ if(s.flowDemBy[id]!==undefined) s.flowDemBy[id]=v; }},
  rodCommon: {lab:"ROD DEMAND",   cont:true, part:()=>roleId("rods"), log:v=>(v*100).toFixed(1)+" %", apply:(s,v)=>{ setCommon(v); }},
  rodBank  : {lab:"BANK DEMAND",  cont:true, part:()=>roleId("rods"), log:(b,v)=>"BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,b,v)=>{ coreEach(s,cs=>{ cs.rodZDem[b]=v; }); }},
  bankAuto : {lab:"BANK AUT/MAN", part:()=>roleId("rods"), log:b=>"BANK "+(b+1)+" NOW "+(S.bankAuto[b]?"MANUAL":"AUTO"),
              apply:(s,b)=>{ coreEach(s,cs=>{ cs.bankAuto[b]=!cs.bankAuto[b]; }); }},
  split    : {lab:"ROD MODE",     part:()=>roleId("rods"),     log:on=>on?"SPLIT":"GANG", apply:(s,on)=>{ setSplit(on); }},
  tiltDem  : {lab:"TILT TRIM",    cont:true, part:()=>roleId("rods"), log:v=>v.toFixed(2), apply:(s,v)=>{ coreEach(s,cs=>{ cs.tiltDem=v; }); }},
  boronDem : {lab:"BORON DEMAND", cont:true, log:v=>v.toFixed(0)+" pcm", apply:(s,v)=>{ s.boronDem=v; }},
  /* the addressed half of each rod row above: `part` is that vessel's own drives, so a wrecked unit refuses only its own */
  coreRodDem : {lab:"ROD DEMAND",   cont:true, part:id=>rodsOf(id), log:(id,v)=>coreLab(id)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,id,v)=>{ setCommon(v,id); }},
  coreRodBank: {lab:"BANK DEMAND",  cont:true, part:id=>rodsOf(id), log:(id,b,v)=>coreLab(id)+" BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,id,b,v)=>{ coreOn(s,id,cs=>{ cs.rodZDem[b]=v; }); }},
  coreBankAuto:{lab:"BANK AUT/MAN", part:id=>rodsOf(id), log:(id,b)=>coreLab(id)+" BANK "+(b+1)+" NOW "+(coreSeen(S,id).bankAuto[b]?"MANUAL":"AUTO"),
              apply:(s,id,b)=>{ coreOn(s,id,cs=>{ cs.bankAuto[b]=!cs.bankAuto[b]; }); }},
  coreSplit  : {lab:"ROD MODE",     part:id=>rodsOf(id), log:(id,on)=>coreLab(id)+" "+(on?"SPLIT":"GANG"), apply:(s,id,on)=>{ setSplit(on,id); }},
  coreTiltDem: {lab:"TILT TRIM",    cont:true, part:id=>rodsOf(id), log:(id,v)=>coreLab(id)+" "+v.toFixed(2),
              apply:(s,id,v)=>{ coreOn(s,id,cs=>{ cs.tiltDem=v; }); }},
  coreScram  : {lab:"MANUAL SCRAM", part:id=>id, log:id=>coreLab(id), apply:(s,id)=>{ manualScram(id); }},
  coreRodJam : {lab:"ROD JAM",      log:id=>coreLab(id)+" "+(coreSeen(S,id).rodJam?"CLEARED":"JAMMED"),
              apply:(s,id)=>{ coreOn(s,id,cs=>{ cs.rodJam=!cs.rodJam; }); }},
  /* logCoal, not cont: collapsing the LOG must not change what a recorded scenario replays */
  loadDem  : {lab:"LOAD DEMAND",  logCoal:true, log:v=>(v*100).toFixed(0)+" %", apply:(s,v)=>{ s.loadDem=v; }},
  /* primaryRelief() only, so the no-argument signature keeps its meaning; a plant with none must not gain a phantom key on S */
  porvBlock: {lab:"PORV BLOCK",   part:()=>primaryRelief(),   log:()=>{ const fid=primaryRelief();
                return (fid && S.reliefBlocked[fid])?"OPENED":"SHUT"; },
              apply:(s)=>{ const fid=primaryRelief(); if(fid) s.reliefBlocked[fid]=!s.reliefBlocked[fid]; }},
  /* a tape naming a tank this design never had is a no-op, not a phantom key on S */
  tankOpen : {lab:"TANK VALVE",   part:id=>id,   log:id=>(D.tanks[id]?D.tanks[id].name:id)+" "+(S.tankOpen[id]?"SHUT":"OPEN"),
              apply:(s,id)=>{ if(s.tankOpen[id]!==undefined) s.tankOpen[id]=!s.tankOpen[id]; }},
  tankByp  : {lab:"TANK AUTO",    part:id=>id,    log:id=>(D.tanks[id]?D.tanks[id].name:id)+" "+(S.tankByp[id]?"ARMED":"BYPASSED"),
              apply:(s,id)=>{ if(s.tankByp[id]!==undefined) s.tankByp[id]=!s.tankByp[id]; }},
  portShut : {lab:"PORT VALVE",   part:pid=>"port:"+pid,   log:pid=>portLabel(pid)+" "+(S.portShut[pid]?"OPENED":"SHUT"),
              apply:(s,pid)=>{ if(s.portShut[pid]===undefined) return;
                s.portShut[pid]=!s.portShut[pid]; }},
  tankDump : {lab:"TANK DUMP",    part:id=>id,    log:id=>(D.tanks[id]?D.tanks[id].name:id)+" DUMP "+(S.tankDump[id]?"SHUT":"OPEN"),
              apply:(s,id)=>{ if(s.tankDump[id]!==undefined) s.tankDump[id]=!s.tankDump[id]; }},
  scram    : {lab:"MANUAL SCRAM", apply:(s)=>{ manualScram(); }},
  resetTrip: {lab:"TRIP RESET",   apply:(s)=>{ resetTrip(); }},
  porvBlockOf:{lab:"BLOCK VALVE", part:fid=>fid, log:fid=>fid.toUpperCase()+" "+(S.reliefBlocked[fid]?"OPENED":"SHUT"),
              apply:(s,fid)=>{ if(P.fittings[fid] && P.fittings[fid].mode==="relief")
                s.reliefBlocked[fid]=!s.reliefBlocked[fid]; }},
  /* blkWire re-seeds a position-holding block onto the sink it now feeds: a wire landing must not be a step */
  blkWire  : {lab:"WIRE",         part:()=>roleId("ctrl"), log:(id,slot,src)=>id.toUpperCase()+" IN "+(slot+1)+" FROM "+(src?src.toUpperCase():"NOTHING"),
              apply:(s,id,slot,src)=>{ const b=s.blkBy&&s.blkBy[id]; if(!b||slot<0||slot>=b.in.length) return;
                b.in[slot]=(src&&s.blkBy[src])?src:null; blkSeedOut(s,id); }},
  blkKnob  : {lab:"TUNE",         cont:true, part:()=>roleId("ctrl"), log:(id,k,v)=>id.toUpperCase()+" "+k.toUpperCase()+" "+(typeof v==="number"?+v.toPrecision(4):String(v).toUpperCase()),
              apply:(s,id,k,v)=>{ const b=s.blkBy&&s.blkBy[id]; if(!b||!BLK[b.mode]||!(k in BLK[b.mode].knobs)) return;
                b[k]=v; if(k==="sig"&&b.arg==null) b.arg=sigArg0(SIGNAL[v]?SIGNAL[v].scope:"plant");
                if(k==="sink") b.arg=sigArg0(SINK[v]?SINK[v].scope:"plant"); }},
  blkOn    : {lab:"BLOCK",        part:()=>roleId("ctrl"), log:id=>id.toUpperCase()+" "+(S.blkBy[id]&&S.blkBy[id].on?"OFF":"ON"),
              apply:(s,id)=>{ const b=s.blkBy&&s.blkBy[id]; if(b) b.on=!b.on; }},
  valveDem : {lab:"VALVE DEMAND", cont:true, part:id=>id, log:(id,v)=>id.toUpperCase()+" TO "+(v*100).toFixed(0)+" %",
              apply:(s,id,v)=>{ if(P.fittings[id] && P.fittings[id].mode==="throttle") s.valveDem[id]=v; }},
  repair   : {lab:"REPAIR PARTY", nolog:true, apply:(s,id)=>{ repairStart(id); }},
  hit      : {lab:"COMBAT HIT",   nolog:true, apply:(s,id)=>{ combatHit(id); }},
  blast    : {lab:"BLAST",        log:(i,kPa)=>kPa.toFixed(0)+" kPa AT CELL "+(i%GW)+","+((i/GW)|0),
              apply:(s,i,kPa)=>{ roomBlastCharge(s, i, kPa);
                s.roomBang = Math.max(s.roomBang||0, kPa);
                s.blastEv.n++; s.blastEv.at = i; }},
  /* two acts, never one a tick: a held button recorded per tick would flood the take forest and make
     the replay depend on frame timing. The press writes the demand and the tick walks the actual. */
  injectOn : {lab:"INJECT",       cont:true, log:(kind,rate,tgt)=>kind.toUpperCase()+" "+rate+" AT "+
                (typeof tgt==="number" ? (tgt%GW)+","+((tgt/GW)|0) : String(tgt).toUpperCase()),
              apply:(s,kind,rate,target)=>{ s.inject={kind,rate,target}; }},
  injectOff: {lab:"INJECT OFF",   apply:(s)=>{ s.inject=null; }},
  blackout : {lab:"BLACKOUT",     log:on=>(on===undefined?!S.blackout:!!on)?"ON":"RESTORED",
              apply:(s,on)=>{ s.blackout = on===undefined ? !s.blackout : !!on; }},
  /* an input with no panel: written straight onto S it lands on a viewer's mirror and the next packet erases it */
  diceOff  : {lab:"DICE",         log:on=>(!!on)?"STOOD DOWN":"LIVE",
              apply:(s,on)=>{ s.diceOff = !!on; }},
  porvArm  : {lab:"PORV STICKS",  log:()=>"ARMED FOR NEXT LIFT",
              apply:(s)=>{ const fid=primaryRelief(); if(fid) s.reliefArm[fid]=true; }},
  rodJam   : {lab:"ROD JAM",      log:()=>S.rodJam?"CLEARED":"JAMMED", apply:(s)=>{ const on=!s.rodJam; coreEach(s,cs=>{ cs.rodJam=on; }); }},
  /* all four flags, matching DMGFX.pzr (step.js): reliefAnyStuck() reads the last one */
  porvStick: {lab:"STUCK PORV",   apply:(s)=>{ const fid=primaryRelief();
                if(fid){ s.reliefOpen[fid]=true; s.reliefBlocked[fid]=false;
                         s.reliefAuto[fid]=true; s.reliefStuck[fid]=true; } }},
  /* recRoot() too: a reset is where one recording ends and the next begins, and rec:false keeps the event off both sides of the join */
  reset    : {lab:"RESET PLANT",  sched:false, rec:false,
              apply:(s)=>{ resetPlant(); recRoot(); }},
};
const ACTKEYS = Object.keys(ACT);

/* recorded before it is performed: a fork's base is a snapshot taken here, so applying first would have the branch do the act twice */
function act(k, ...a){
  if(!ACT[k]) throw new Error("act: no such act "+k);
  /* a bound feed owns the plant, so this is transport and not a second dispatch - except a RESET,
     which is a new plant, and a new plant is a new worker */
  if(typeof simLiveFeed === "function" && simLiveFeed()){
    if(k !== "reset"){ simTell({t:"act", k, a}); return true; }
    simKillAll();
    recAct(k, a); actDo(k, a);
    simRestart({seed:(S&&S.seed)>>>0});
    return true;
  }
  recAct(k, a);
  actDo(k, a);
  return true;
}

/* called from actDo() and never from act(), or a replay's log would differ from the live run's; the key carries the TRACK so one bank's drag cannot swallow another's entry */
function actLog(k, a){
  const r = ACT[k];
  if(r.nolog || r.rec === false) return;
  const det = r.log ? r.log(...a) : "";
  const coal = r.cont || r.logCoal;
  logE("act", r.lab + (det ? " / " + det : ""),
    "Ordered from the panel" + (det ? ": " + det + "." : "."),
    coal ? "act:" + k + ":" + a.slice(0, -1).join(",") : null);
}
/* the refusal is in actDo() so a replay meets it too; the act is still recorded, because the recording is the input */
const actDead = (k, a) => { const f = ACT[k].part;
  if(!f) return false;
  const id = f(...a);
  return partWrecked(S,id); };
function actDo(k, a){ if(actDead(k, a)) return; actLog(k, a); ACT[k].apply(S, ...a); }

/* a recording is a forest of takes: the acts are the recording, the keyframes and trend archive a cache eviction may always throw away */
const REC_MAX_ROOTS = 8;      // whole runs kept; the 9th evicts the oldest lineage
const REC_MAX_KEY_BYTES = 24*1048576;
const REC_MAX_TR_BYTES  = 32*1048576;
const KF_TICKS      = 250;    // 5 sim-seconds between keyframes, before thinning
// what a snapshot weighs, walked the way snapVal() walks it
function snapBytes(v){
  if(v === null || typeof v !== "object") return typeof v === "string" ? 16 + 2*v.length : 8;
  if(snapTyped(v)) return 32 + v.byteLength;
  let n = 32;
  if(Array.isArray(v)){ for(let i=0;i<v.length;i++) n += 8 + snapBytes(v[i]); return n; }
  for(const k in v) n += 24 + snapBytes(v[k]);
  return n;
}
/* KF_TICKS is a sim-time gap, so the spacing is stretched to hold the cost per wall second roughly flat */
const KF_PER_SEC = 2, KF_MAX_STRETCH = 4;
const kfSpan = t => KF_TICKS * t.thin *
  clamp(Math.round(TR.sps/KF_PER_SEC/KF_TICKS), 1, KF_MAX_STRETCH);

const REC = { roots:[], takes:[], cur:0, mode:"live", keyCount:0, keyBytes:0, trBytes:0 };

/* the design a recording is about, captured once per ROOT, JSON-round-trippable and frozen all the way down */
function recFreeze(o){
  if(ArrayBuffer.isView(o)) return o;    // a typed array with elements refuses to freeze
  if(o && typeof o === "object"){ for(const k in o) recFreeze(o[k]); Object.freeze(o); }
  return o;
}
function recHead(){
  return recFreeze({
    D        : snapVal(D),
    /* not in D, and both change what the plant IS: pipe run, thermosiphon head, exposure */
    parts    : LAY ? LAY.parts.map(p => ({id:p.id, x:p.x, y:p.y})) : [],
    dsig     : designSig(),
    nsig     : NODE_SIG,
    seed     : S ? S.seed : 0,
  });
}
/* bumped whenever a node name or the set of them changes: s.mBy/s.hBy are keyed by name and designSig() cannot see a graph change */
const NODE_SIG = "shell-node/1";

/* returns whether the head rebuilt into the same reactor, and the caller must ask */
function recApplyHead(h){
  Object.assign(D, snapVal(h.D));
  buildLayout();
  for(const id of coreIds()) latRevolve(D.cores[id]);
  for(const q of h.parts){ const p=partOf(q.id); if(p){ p.x=q.x; p.y=q.y; } }
  layoutMetrics();
  return designSig() === h.dsig && h.nsig === NODE_SIG;
}
/* id/parent/kids are the tree, base+baseLog+baseNet the plant at tick0, keys the cache, evs the recording, tr/trT/trN the trend archive */
function recNew(parent, head){
  const t = {
    id:REC.takes.length, parent, head,
    t0:S.t, tick0:S.tick,
    base:snapS(S), baseLog:LOG.slice(), baseNet:plantStateSave(),
    keys:[], evs:[],
    tr:{}, trT:[], trN:0, trThin:1,   // trThin: samples dropped per sample kept, 1 = full rate
    tickEnd:S.tick, nextKey:S.tick + KF_TICKS,
    kids:[], label:null, verdict:null,
    /* not flown straight through: any take with a parent was scrubbed back into */
    assisted:parent !== null,
    thin:1,                       // keyframe spacing multiplier; doubles on eviction
  };
  /* the shape a packed key is poured back into; a run gains keys on S in its first seconds, so it is
     re-taken whenever the walk says the shape moved rather than pinned to the take's own base */
  t.tmpl = t.base; t.tmplSig = shmSig(S);
  REC.takes.push(t);
  return t;
}
/* takes are TOMBSTONED, never spliced out: `id` is the index every parent and kid list holds */
const recCur = () => REC.takes[REC.cur] || null;

/* what a viewer on the other thread needs to draw the tree: keyframes and the trend archive are megabytes and stay here */
const recSummary = () => ({
  cur:REC.cur, mode:REC.mode, roots:REC.roots.slice(),
  takes:REC.takes.map(t => t && ({
    id:t.id, parent:t.parent, kids:t.kids.slice(), label:t.label,
    tick0:t.tick0, tickEnd:t.tickEnd, verdict:t.verdict, assisted:t.assisted,
    evN:t.evs.length, head:{dsig:t.head.dsig, seed:t.head.seed}})),
});
// a take is either the real thing or a summary of one, and only this differs
const recEvN = t => t.evN !== undefined ? t.evN : t.evs.length;

function recRoot(){
  const t = recNew(null, recHead());
  REC.roots.push(t.id);
  REC.cur = t.id; REC.mode = "live";
  recTrimRoots();
  return t;
}

/* the test is the clock and not a notification, so the sim stays ignorant of the recorder; only ever asked in live mode, since a seek moves S.tick back on purpose */
function recBoot(){
  const t = recCur();
  if(!t || S.tick < t.tick0 || S.tick < t.tickEnd) return recRoot();
  return t;
}

const recSameTrack = (x, y) => {
  if(x.length !== y.length) return false;
  for(let i = 0; i < x.length-1; i++) if(x[i] !== y[i]) return false;   // all but the value
  return true;
};
function recAct(k, a){
  if(!S || ACT[k].rec === false) return;
  /* watching does not fork; touching does, which is the first moment the two futures can differ */
  if(REC.mode !== "live") recBranch(REC.cur, S.tick);
  const t  = recBoot();
  const ev = {tick:S.tick, seq:t.evs.length, k, a:a.slice()};
  /* same act, track and TICK is the only coalescing that is provably free: nothing stepped between the two writes */
  const last = t.evs[t.evs.length-1];
  if(last && ACT[k].cont && last.k === k && last.tick === ev.tick && recSameTrack(last.a, a)){
    ev.seq = last.seq; t.evs[t.evs.length-1] = ev; return;
  }
  t.evs.push(ev);
}

/* a next-due tick and not a modulo, because a frame is sometimes two ticks and sometimes none; `ei` is how far down the track the key already is, so an act sharing its tick is not applied twice */
function recTick(){
  if(REC.mode !== "live") return;
  const t = recBoot();
  t.tickEnd = S.tick;
  if(S.tick >= t.nextKey){
    const pk = shmKeySave(S);
    const k = {tick:S.tick, net:plantStateSave(), lg:LOG.slice(), ei:t.evs.length};
    if(pk.sig === t.tmplSig){ k.pk = pk; k.tmpl = t.tmpl; }
    else { k.S = snapS(S); t.tmpl = k.S; t.tmplSig = pk.sig; }
    recKeyAdd(t, k);
    t.nextKey = S.tick + kfSpan(t);
    if(REC.keyBytes > REC_MAX_KEY_BYTES) recEvict();
  }
}
// the one door onto t.keys, so the byte book cannot drift from the list
function recKeyAdd(t, k){
  k.bytes = k.bytes || (k.pk ? k.pk.bytes : snapBytes(k.S)) + snapBytes(k.net) + 32 + 8*k.lg.length;
  t.keys.push(k); REC.keyCount++; REC.keyBytes += k.bytes;
}
function recKeysTake(keys){ let n=0; for(const k of keys) n += k.bytes; return n; }
/* the one door onto a key's state: a packed one is values only, poured into a copy of its own template */
function keyState(k){
  if(k.S) return k.S;
  const o = snapVal(k.tmpl); shmKeyLoad(k.pk, o); return o;
}
// a take built in the worker arrives with keys and no book: price them here
function recKeysAdopt(t){ const ks=t.keys; t.keys=[]; for(const k of ks) recKeyAdd(t,k); }

/* halves the oldest take's keyframe density rather than truncating; `base` and `evs` are never candidates */
function recEvict(){
  while(REC.keyBytes > REC_MAX_KEY_BYTES){
    let o = null;
    for(const t of REC.takes) if(t && t.keys.length > 1 && (!o || t.id < o.id)) o = t;
    if(!o) return;
    o.thin *= 2;
    const keep = o.keys.filter((_, i) => i % 2 === 0);
    REC.keyCount -= o.keys.length - keep.length;
    REC.keyBytes -= recKeysTake(o.keys) - recKeysTake(keep);
    o.keys = keep;
  }
}
/* a root and its whole subtree go together: a child's base is a state only its parent's history explains */
function recDrop(id){
  const t = REC.takes[id]; if(!t) return;
  for(const k of t.kids) recDrop(k);
  REC.keyCount -= t.keys.length; REC.keyBytes -= recKeysTake(t.keys);
  REC.trBytes -= trBytesOf(t);
  REC.takes[id] = null;
}
function recTrimRoots(){
  while(REC.roots.length > REC_MAX_ROOTS){
    const i = REC.roots.findIndex(r => !lineage(REC.cur).some(t => t.id === r));
    if(i < 0) return;
    recDrop(REC.roots[i]); REC.roots.splice(i, 1);
  }
}

function lineage(takeId){
  const out = [];
  for(let t = REC.takes[takeId]; t; t = t.parent === null ? null : REC.takes[t.parent])
    out.unshift(t);
  return out;
}
/* `from` is an index hint a forward walk hands back to itself; evs are tick-sorted by construction */
function applyDue(take, tick, from){
  let i = from | 0;
  while(i < take.evs.length && take.evs[i].tick <  tick) i++;
  while(i < take.evs.length && take.evs[i].tick === tick){
    const ev = take.evs[i++]; actDo(ev.k, ev.a);
  }
  return i;
}

/* the take that owns a tick is the deepest ancestor that had started by then; sample() is in the loop because the reactor period differentiates itself there */
function seek(takeId, tick){
  const line = lineage(takeId);
  if(!line.length) return null;
  let own = line[0];
  for(const t of line) if(t.tick0 <= tick) own = t;
  tick = Math.max(own.tick0, Math.min(tick, own.tickEnd));

  REC.mode = "replay";
  let src = {tick:own.tick0, S:own.base, net:own.baseNet, lg:own.baseLog, ei:0};
  for(const k of own.keys) if(k.tick <= tick && k.tick >= src.tick) src = k;
  restoreS(keyState(src)); plantStateLoad(src.net); LOG = src.lg.slice();

  let i = src.ei;
  while(S.tick < tick){
    i = applyDue(own, S.tick, i);
    step(0.02);
    if(S.tick % SAMP_TICKS === 0) sample();
  }
  REC.cur = own.id;
  histFill(own, tick);
  return S;
}

/* `base` is a snapshot and never a reference to the parent's keyframe, so a child cannot rewrite its parent's past */
function recBranch(takeId, tick){
  if(tick !== undefined && (REC.cur !== takeId || S.tick !== tick)) seek(takeId, tick);
  const p = REC.takes[takeId] || null;
  const t = recNew(p ? p.id : null, p ? p.head : recHead());
  if(p) p.kids.push(t.id); else { REC.roots.push(t.id); }
  REC.cur = t.id; REC.mode = "live";
  if(!p) recTrimRoots();
  return t;
}

/* stops dead at tickEnd, and nothing here goes through act(), which is what keeps watching from forking */
function recPlay(){
  if(REC.mode === "live") return true;
  const t = recCur();
  if(!t || S.tick >= t.tickEnd) return false;
  applyDue(t, S.tick);
  return true;
}
/* the rate scales the accumulator and never dt, which is why 16x lands on the same plant as 1x; TR is not on S */
const TR = {rate:1, paused:false, step1:0, sps:0, vldSeen:null, vldHit:null, vldRev:0,
            tickMs:null, tps:0, rateMax:Infinity};
/* MAX with a stop condition: only a tile that was not lit when the run started halts it */
const TR_VLD = "vld";
const trAnnSet = () => { const o=Object.create(null); for(const k in S.annOn) if(S.annOn[k]) o[k]=1; return o; };
/* only on the ticks the board moved: annStep() counts the transitions, so a standing board costs one integer compare */
const trVldCheck = () => {
  if(S.annRev===TR.vldRev) return;
  TR.vldRev=S.annRev;
  for(const k in S.annOn) if(S.annOn[k] && !TR.vldSeen[k]){ TR.vldHit=k; return; }
};
const trQuiet = () => TR.rate===TR_VLD && !TR.paused && !!P && !!SIMSCREEN[screen];
const TICK_CAP  = 48;
const TR_DEBT_MAX = 0.5;              // s of plant time a backlog may grow to
/* MAX is a time budget, not a multiplier: nothing owes it ticks */
const TR_MAX_MS = 12;
const TR_VLD_MS = 16;                 // VLD paints nothing, so it may spend MAX's paint share
const trNow = () => (typeof performance!=="undefined" ? performance.now() : Date.now());
const SIMSCREEN = {operate:1, scenario:1};
let simAcc = 0;

function simTick(){
  /* fired before the step it precedes, the ordering recPlay() uses, so a live run and a replay of it agree */
  scnDue(S.tick);
  /* the window covers sample() too: the trend channels ask the drawing the same questions the tick does */
  laySettle();
  step(0.02);
  if(S.tick % SAMP_TICKS === 0) sample();
  if(TR.vldSeen && !TR.vldHit) trVldCheck();
  layRelease();
  spsN++;
}
/* the part tick at each end of the window is counted, or the reading beats against the tick grid */
let spsN=0, spsT=0, spsAcc0=0;
function spsFrame(dt){
  spsT += dt;
  if(spsT>=0.5){ TR.sps=(spsN+(simAcc-spsAcc0)/0.02)/spsT; spsN=0; spsT=0; spsAcc0=simAcc; }
}
/* measured on a snapshot and put back; a cold tick is not what a run costs */
const TRB_WARM=6;
const TRB_ROUNDS=5, TRB_PER=8;
/* the share of a second the ticks may have, refresh-independent */
const TRB_SHARE = TR_MAX_MS/(1000/60);
function trBench(){
  if(!P||!S){ TR.tickMs=null; TR.tps=0; TR.rateMax=Infinity; return; }
  const snap=snapS(S), lg=LOG.length, nst=plantStateSave();
  const tick=()=>{ laySettle(); step(0.02); layRelease(); };
  let ms=Infinity;
  try {
    for(let i=0;i<TRB_WARM;i++) tick();
    for(let r=0;r<TRB_ROUNDS;r++){
      const t0=trNow();
      for(let i=0;i<TRB_PER;i++) tick();
      const m=(trNow()-t0)/TRB_PER;
      if(m<ms) ms=m;
    }
  } finally { restoreS(snap); LOG.length=lg; plantStateLoad(nst); }
  // a clock with no resolution (a stubbed one, a hardened browser) measured nothing
  if(!(ms>0)){ TR.tickMs=null; TR.tps=0; TR.rateMax=Infinity; return; }
  TR.tickMs=ms;
  TR.tps=TRB_SHARE*1000/ms;
  TR.rateMax=TR.tps/50;
  console.log("BENCH  "+ms.toFixed(2)+" ms/tick, best of "+TRB_ROUNDS+" rounds of "+TRB_PER+" -> "+
    TR.tps.toFixed(0)+" TPS sustainable, so "+TR.rateMax.toFixed(2)+"x is the fastest honest rate");
}
/* whether the picture is moving, which is not whether a tick landed */
const simLive = () => !!P && !!SIMSCREEN[screen] && !TR.paused;
/* plant seconds per wall second, as a setting; null on an unbounded rate */
const trClockRate = () => TR.paused ? 0
  : (scnBusy() || TR.rate===Infinity || TR.rate===TR_VLD) ? null : TR.rate;
/* returns whether the plant moved this frame */
function simFrame(dt){
  spsFrame(dt);
  if(!P || !SIMSCREEN[screen]){ simAcc=spsAcc0=0; return false; }
  /* a bound feed owns the plant: this thread asks for a picture and never steps one */
  if(simLiveFeed()){ simAcc=spsAcc0=0; return simAsk(); }
  /* once a frame whether or not one is painted: the ticks read cached design signatures, this pass proves them */
  layFresh();
  /* a scenario draining takes the whole frame, or the run would be stepped at two speeds at once */
  if(scnBusy()){ simAcc=spsAcc0=0; scnDrain(); return true; }
  if(TR.paused){
    /* paused still keyframes, or a plant nudged forward a tick at a time would never lay one down */
    simAcc=spsAcc0=0;
    let k=0;
    while(TR.step1>0){ TR.step1--; if(!recPlay()) break; simTick(); k++; }
    recTick(); return k>0;
  }
  if(TR.rate===Infinity||TR.rate===TR_VLD){
    /* no accumulator: an unbounded rate owes an unbounded number of ticks */
    simAcc=spsAcc0=0;
    const vld=TR.rate===TR_VLD;
    // armed here, so the stash is the plant one tick before the run
    if(vld && !TR.vldSeen){ TR.vldSeen=trAnnSet(); TR.vldRev=S.annRev; }
    const t0=trNow(), budget=vld?TR_VLD_MS:TR_MAX_MS; let m=0;
    while(trNow()-t0 < budget){
      if(!recPlay()){ TR.paused=true; break; }
      simTick(); m++;
      if(TR.vldHit){
        logE("warn","VALIDATION RUN HALTED / "+TR.vldHit,
          "A tile that was not lit when the validation run started has come up, so the run has dropped back to 1x with the plant still going.");
        trRate(1); break;
      }
    }
    recTick();
    return m>0;
  }
  /* a rate is a promise about the wall, never a fixed tick count per frame */
  simAcc += dt * TR.rate;
  let n=0;
  while(simAcc>=0.02 && n<TICK_CAP){
    /* recPlay() before the step, every tick: it refuses once the tape runs out */
    if(!recPlay()){ simAcc=spsAcc0=0; TR.paused=true; break; }
    simTick();
    simAcc-=0.02; n++;
  }
  /* carried so a rate holds across a stutter, bounded so a machine that cannot hold it does not owe an hour of plant nobody watched */
  if(simAcc > TR_DEBT_MAX) simAcc = TR_DEBT_MAX;
  recTick();
  return n>0;
}
/* THE FEED: a worker owns the plant and this thread is a viewer of it. A LIST from the first commit,
   so a second plant is another entry and never a rewrite of this. */
const SIMS = {};
let SIMBOUND = null, simSeq = 0;
const SIM_HANDSHAKE = 4000;
const simLiveFeed = () => { const s = SIMBOUND !== null ? SIMS[SIMBOUND] : null;
  return s && s.live ? s : null; };

/* a worker's whole life is one commissioned plant, so anything that would have reset one spawns another */
function simSpawn(opt, onFail){
  if(typeof Worker !== "function" || typeof location === "undefined") return null;
  if(urlOff("worker")){ if(onFail) onFail("the url asked for no worker"); return null; }
  let w;
  /* the query rides along, or the worker cannot see a switch the page was opened with */
  try{ w = new Worker("src/sim/runworker.js" + location.search); }catch(e){ return null; }
  const id = ++simSeq, sim = {id, w, live:false, dead:false, pending:false};
  SIMS[id] = sim;
  const give = why => { if(sim.dead) return; simKill(id); if(onFail) onFail(why); };
  const timer = setTimeout(() => give("the worker did not answer"), SIM_HANDSHAKE);
  w.onerror = () => give("the worker could not load");
  w.onmessage = ev => {
    const m = ev.data || {};
    if(m.t === "ready"){ clearTimeout(timer);
      w.postMessage({t:"live", head:recHead(), seed:((opt&&opt.seed)||0)>>>0,
                     diceOff:!!(opt&&opt.diceOff), rate:TR.rate, paused:TR.paused}); }
    else if(m.t === "liveok"){ sim.live = true; if(opt && opt.onLive) opt.onLive(id); }
    else if(m.t === "packet"){ sim.pending = false; if(m.jump) simSeekDone(sim);
      if(SIMBOUND === id) simApply(m); }
    else if(m.t === "bench"){ TR.tickMs = m.tickMs; TR.rateMax = m.rateMax; trRateFit(); }
    else if(m.t === "err"){ clearTimeout(timer); give(m.msg); }
  };
  w.postMessage({t:"init", base: location.href.replace(/[^/]*$/, "").split("?")[0]});
  return id;
}
function simKill(id){
  const sim = SIMS[id]; if(!sim) return;
  sim.dead = true; sim.live = false;
  try{ sim.w.terminate(); }catch(e){}
  delete SIMS[id];
  /* the buffer belongs to that worker: a new plant is a new one, and the old map would read a dead layout */
  if(SIMBOUND === id){ SIMBOUND = null; SHMV = null; }
}
const simKillAll = () => { for(const k in SIMS) simKill(+k); };
/* bound AFTER it answers, or the first frame paints a plant that has only just been reset */
const simBind = id => { SIMBOUND = SIMS[id] ? id : null; };
const simSend = (id, msg) => { const s = SIMS[id]; if(s && !s.dead) s.w.postMessage(msg); };
const simTell = msg => { if(SIMBOUND !== null) simSend(SIMBOUND, msg); };
/* the strip's two doors onto the plant: a seek and a fork both step it, so a bound feed does them */
/* a drag asks for a seek per pointer move and the worker replays from a keyframe for each one, so only the
   newest is ever in flight: the rest would be plants nobody sees, drawn one queued frame late */
function trSeek(take, tick){
  const sim = simLiveFeed();
  if(!sim){ seek(take, tick); return; }
  if(sim.seekOut){ sim.seekWant = {take, tick}; return; }
  sim.seekOut = true; sim.seekWant = null;
  simSend(sim.id, {t:"seek", take, tick});
}
function simSeekDone(sim){
  if(!sim.seekOut) return;
  sim.seekOut = false;
  const w = sim.seekWant; sim.seekWant = null;
  if(w) trSeek(w.take, w.tick);
}
const trBranchAt = (take, tick) => { if(simLiveFeed()) simTell({t:"branch", take, tick}); else recBranch(take, tick); };

/* the one door onto a new plant: a reset is a NEW plant and a new plant is a NEW worker, so P is written
   once per worker and the two copies of it cannot drift. A null id is no worker, which is the single-thread path. */
function simRestart(opt){
  simKillAll();
  const o = Object.assign({}, opt);
  /* NOT benched here: trBench() puts S back but not the network solver state it advances, which lives
     on P, so benching the worker's plant would move its next tick off this thread's */
  o.onLive = id => { simBind(id); };
  return simSpawn(o, why => logE("info","PLANT ON THIS THREAD",
    "A background thread was not available ("+why+"), so the plant is being stepped on the page's "+
    "own thread instead. It is the same plant and the same answer, just sharing the frame with the drawing."));
}

/* the viewer's own map onto the worker's shared state; null until a worker sends the buffer */
let SHMV = null;
/* `S` is a `let`, so this is the assignment restoreS() already makes; the packet came through structured
   clone, so it is already this thread's own state and cloning it again is pure garbage. A jump is the one
   packet whose picture does not follow the last one, so it alone clears the animation the drawing carries. */
function simApply(m){
  if(m.S){ S = m.S; SHMV = m.shm ? shmAttach(m.shm, S) : null; }
  if(m.strs && SHMV) SHMV.strs = m.strs;
  if(!m.S && SHMV) shmPull(SHMV, S, m.seq);
  if(m.jump){ if(typeof pipeReset==="function") pipeReset(); if(typeof fxReset==="function") fxReset(); }
  if(m.log) LOG = m.log;
  for(const v of m.samp) histPush(v);
  if(m.rec){ REC.cur = m.rec.cur; REC.mode = m.rec.mode;
             REC.roots = m.rec.roots; REC.takes = m.rec.takes; }
  else if(m.tickEnd !== undefined){ const t = REC.takes[REC.cur]; if(t) t.tickEnd = m.tickEnd; }
  if(m.sps !== undefined) TR.sps = m.sps;
}
/* one packet per PAINT, never per tick: a frame nobody asked for is never cloned */
function simAsk(){
  const sim = simLiveFeed();
  if(!sim || sim.pending) return false;
  sim.pending = true;
  sim.w.postMessage({t:"frame"});
  return true;
}

/* 0X is TR.paused and keeps the rate it was running at, so leaving 0X is a rate the strip already had */
const trRate=r=>{ if(r===0){ TR.paused=true; simTell({t:"rate", paused:true}); return; }
  TR.rate=r; TR.paused=false; TR.vldSeen=null; TR.vldHit=null; TR.vldRev=0;
  simTell({t:"rate", rate:r, paused:false}); };
const trPause=()=>{ TR.paused=!TR.paused; simTell({t:"rate", paused:TR.paused}); };
const TR_STEP_BIG=10;
const trStepN = e => e&&e.shiftKey ? TR_STEP_BIG : 1;
const trStep=e=>{ const n=trStepN(e); TR.paused=true; TR.step1+=n;
  simTell({t:"rate", paused:true, step1:n}); };
/* backwards is a seek: step() is not invertible, so one tick back is a scrub off the nearest keyframe */
const trStepBack=e=>{ TR.paused=true; TR.step1=0; simTell({t:"rate", paused:true});
  if(S) trSeek(REC.cur, S.tick-trStepN(e)); };
