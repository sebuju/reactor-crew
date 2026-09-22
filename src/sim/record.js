"use strict";
/* a snapshot is a byte copy of the state buffer; nothing else carries plant state */
const snapS = () => engSnap(engSnapNew());
function restoreS(snap){
  engRestore(snap); logResync();
  if(typeof pipeReset==="function") pipeReset();
  if(typeof fxReset==="function") fxReset();
  return ST; }

/* the field and element of the first difference between two snapshots, or null */
function eqWhere(a, b){
  if(a.length !== b.length) return "length: " + a.length + " vs " + b.length;
  let i = 0; while(i < a.length && a[i] === b[i]) i++;
  if(i === a.length) return null;
  for(const [name, type, len, off] of ST.layout.rows){
    const sz = ENG_SIZE[type];
    if(i >= off && i < off + len*sz){ const j = ((i - off)/sz)|0;
      const va = new ENG_CTOR[type](a.buffer, a.byteOffset + off, len)[j], vb = new ENG_CTOR[type](b.buffer, b.byteOffset + off, len)[j];
      return name + "[" + j + "]: " + va + " vs " + vb; } }
  return "byte " + i;
}
const eqS = (a, b) => eqWhere(a, b) === null;

/* labels for the log, off the index an act carries */
const ixId = (kind, i) => (IX && IX[kind+"Id"] && i >= 0) ? IX[kind+"Id"][i] : undefined;
const ixPart = (kind, i) => { const id = ixId(kind, i); return id === undefined ? -1 : (IX.part.has(id) ? IX.part.get(id) : -1); };
const ixLab = (kind, i) => { const id = ixId(kind, i); if(id === undefined) return "?"; const p = partOf(id); return p ? p.name : String(id).toUpperCase(); };
const tankLab = t => { const id = ixId("tank", t); return id !== undefined && D.tanks[id] ? D.tanks[id].name : "?"; };
const roleIx = role => { const id = roleId(role); return id && IX.part.has(id) ? IX.part.get(id) : -1; };
const rodsIx = c => { const id = ixId("core", c); const r = id === undefined ? null : rodsOf(id); return r && IX.part.has(r) ? IX.part.get(r) : -1; };
const inRange = (i, n) => i >= 0 && i < n;
const coreEachIx = fn => { for(let c=0;c<PT.n.core;c++) fn(c); };
const INJ_KIND = {heat:E_INJ_HEAT, gas:E_INJ_GAS, fluid:E_INJ_FLUID, h2:E_INJ_H2, o2:E_INJ_O2, steam:E_INJ_STEAM};
const INJ_NAME = ["NONE","HEAT","GAS","FLUID","H2","O2","STEAM"];
/* the first instance a scope names, as blkKnob re-points a block at a new signal or sink */
const scopeArg0 = scope => { switch(scope){
  case "core": return PT.n.core ? 0 : -1; case "sg": return PT.n.boiler ? 0 : -1; case "pump": return PT.n.pump ? 0 : -1;
  case "fit": return PT.n.fit ? 0 : -1; case "tank": return PT.n.tank ? 0 : -1; case "rpsch": case "loop": return 0; }
  return -1; };
const sigScope = code => { const k = E_SIG_KEYS[code]; return k && SIGNAL[k] ? SIGNAL[k].scope : "plant"; };
const sinkScope = code => { const k = E_SINK_KEYS[code]; return k && SINK[k] ? SINK[k].scope : "plant"; };
const blkLab = k => { const id = ixId("block", k); return id === undefined ? "NOTHING" : id.toUpperCase(); };

/* `apply` is the one performer, in SIM units and INDICES: `sched:false` bars a scenario, `cont:true` marks a coalescable last argument, `part` names the machine by part index, `rec:false` keeps it off every tape, `ix` names the IX kind of each id argument for actId() */
const ACT = {
  /* `log` formats the VALUE; `nolog:true` marks a row that writes its own entry */
  flowDem  : {lab:"PUMP DEMAND",  cont:true, log:v=>(v*100).toFixed(0)+" %",
              apply:(s,v)=>{ for(let p=0;p<PT.n.pump;p++) if(PT.pumpPrimary[p]) s.flowDemBy[p]=v; }},
  pumpDem  : {lab:"PUMP DEMAND",  cont:true, ix:["pump",null], part:p=>ixPart("pump",p),
              log:(p,v)=>ixLab("pump",p)+" TO "+(v*100).toFixed(0)+" %",
              apply:(s,p,v)=>{ if(inRange(p,PT.n.pump)) s.flowDemBy[p]=v; }},
  rodCommon: {lab:"ROD DEMAND",   cont:true, part:()=>roleIx("rods"), log:v=>(v*100).toFixed(1)+" %",
              apply:(s,v)=>{ coreEachIx(c=>eRodCommon(c,v)); }},
  rodBank  : {lab:"BANK DEMAND",  cont:true, part:()=>roleIx("rods"), log:(b,v)=>"BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,b,v)=>{ coreEachIx(c=>{ if(b<PT.coreNB[c]) s.csRodZDem[c*PT.nbMax+b]=v; }); }},
  bankAuto : {lab:"BANK AUT/MAN", part:()=>roleIx("rods"), log:b=>"BANK "+(b+1)+" NOW "+(PT.n.core && ST.csBankAuto[b]?"MANUAL":"AUTO"),
              apply:(s,b)=>{ coreEachIx(c=>{ if(b<PT.coreNB[c]){ const i=c*PT.nbMax+b; s.csBankAuto[i]=s.csBankAuto[i]?0:1; } }); }},
  split    : {lab:"ROD MODE",     part:()=>roleIx("rods"), log:on=>on?"SPLIT":"GANG",
              apply:(s,on)=>{ let ev=EV_NONE; coreEachIx(c=>{ const e=eSetSplit(c,on); if(ev===EV_NONE) ev=e; });
                if(ev!==EV_NONE) eEvent(ev,-1,0); }},
  tiltDem  : {lab:"TILT TRIM",    cont:true, part:()=>roleIx("rods"), log:v=>v.toFixed(2), apply:(s,v)=>{ coreEachIx(c=>{ s.csTiltDem[c]=v; }); }},
  boronDem : {lab:"BORON DEMAND", cont:true, log:v=>v.toFixed(0)+" pcm", apply:(s,v)=>{ s.sc[SC_BORONDEM]=v; }},
  /* the addressed half of each rod row above: `part` is that vessel's own drives, so a wrecked unit refuses only its own */
  coreRodDem : {lab:"ROD DEMAND",   cont:true, ix:["core",null], part:c=>rodsIx(c), log:(c,v)=>ixLab("core",c)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,c,v)=>{ if(inRange(c,PT.n.core)) eRodCommon(c,v); }},
  coreRodBank: {lab:"BANK DEMAND",  cont:true, ix:["core",null,null], part:c=>rodsIx(c), log:(c,b,v)=>ixLab("core",c)+" BANK "+(b+1)+" TO "+(v*100).toFixed(1)+" %",
              apply:(s,c,b,v)=>{ if(inRange(c,PT.n.core) && b<PT.coreNB[c]) s.csRodZDem[c*PT.nbMax+b]=v; }},
  coreBankAuto:{lab:"BANK AUT/MAN", ix:["core",null], part:c=>rodsIx(c), log:(c,b)=>ixLab("core",c)+" BANK "+(b+1)+" NOW "+(ST.csBankAuto[c*PT.nbMax+b]?"MANUAL":"AUTO"),
              apply:(s,c,b)=>{ if(inRange(c,PT.n.core) && b<PT.coreNB[c]){ const i=c*PT.nbMax+b; s.csBankAuto[i]=s.csBankAuto[i]?0:1; } }},
  coreSplit  : {lab:"ROD MODE",     ix:["core",null], part:c=>rodsIx(c), log:(c,on)=>ixLab("core",c)+" "+(on?"SPLIT":"GANG"),
              apply:(s,c,on)=>{ if(!inRange(c,PT.n.core)) return; const ev=eSetSplit(c,on); if(ev!==EV_NONE) eEvent(ev,c,0); }},
  coreTiltDem: {lab:"TILT TRIM",    cont:true, ix:["core",null], part:c=>rodsIx(c), log:(c,v)=>ixLab("core",c)+" "+v.toFixed(2),
              apply:(s,c,v)=>{ if(inRange(c,PT.n.core)) s.csTiltDem[c]=v; }},
  coreScram  : {lab:"MANUAL SCRAM", ix:["core"], part:c=>ixPart("core",c), log:c=>ixLab("core",c),
              apply:(s,c)=>{ if(inRange(c,PT.n.core)) eScram(c,E_TRIP_MANUAL,-1); }},
  coreRodJam : {lab:"ROD JAM",      ix:["core"], log:c=>ixLab("core",c)+" "+(ST.csRodJam[c]?"CLEARED":"JAMMED"),
              apply:(s,c)=>{ if(inRange(c,PT.n.core)) s.csRodJam[c]=s.csRodJam[c]?0:1; }},
  /* logCoal, not cont: collapsing the LOG must not change what a recorded scenario replays */
  loadDem  : {lab:"LOAD DEMAND",  logCoal:true, log:v=>(v*100).toFixed(0)+" %", apply:(s,v)=>{ s.sc[SC_LOADDEM]=v; }},
  porvBlock: {lab:"PORV BLOCK",   part:()=>ixPart("relief",PT.rPrimaryRelief), log:()=>{ const v=PT.rPrimaryRelief;
                return (v>=0 && ST.reliefBlocked[v])?"OPENED":"SHUT"; },
              apply:(s)=>{ const v=PT.rPrimaryRelief; if(v>=0) s.reliefBlocked[v]=s.reliefBlocked[v]?0:1; }},
  tankOpen : {lab:"TANK VALVE",   ix:["tank"], part:t=>ixPart("tank",t),   log:t=>tankLab(t)+" "+(ST.tankOpen[t]?"SHUT":"OPEN"),
              apply:(s,t)=>{ if(inRange(t,PT.n.tank)) s.tankOpen[t]=s.tankOpen[t]?0:1; }},
  tankByp  : {lab:"TANK AUTO",    ix:["tank"], part:t=>ixPart("tank",t),    log:t=>tankLab(t)+" "+(ST.tankByp[t]?"ARMED":"BYPASSED"),
              apply:(s,t)=>{ if(inRange(t,PT.n.tank)) s.tankByp[t]=s.tankByp[t]?0:1; }},
  portShut : {lab:"PORT VALVE",   ix:["port"], part:o=>{ const id=ixId("port",o); return id===undefined ? -1 : (IX.part.get("port:"+id) ?? -1); },
              log:o=>portLabel(ixId("port",o))+" "+(ST.portShut[o]?"OPENED":"SHUT"),
              apply:(s,o)=>{ if(!inRange(o,PT.n.port)) return; s.portShut[o]=s.portShut[o]?0:1; s.sc[SC_PORTSHUTGEN]++; }},
  tankDump : {lab:"TANK DUMP",    ix:["tank"], part:t=>ixPart("tank",t),    log:t=>tankLab(t)+" DUMP "+(ST.tankDump[t]?"SHUT":"OPEN"),
              apply:(s,t)=>{ if(inRange(t,PT.n.tank)) s.tankDump[t]=s.tankDump[t]?0:1; }},
  scram    : {lab:"MANUAL SCRAM", apply:(s)=>{ coreEachIx(c=>eScram(c,E_TRIP_MANUAL,-1)); }},
  resetTrip: {lab:"TRIP RESET",   apply:(s)=>{ actResetTrip(); }},
  porvBlockOf:{lab:"BLOCK VALVE", ix:["relief"], part:v=>ixPart("relief",v), log:v=>String(ixId("relief",v)).toUpperCase()+" "+(ST.reliefBlocked[v]?"OPENED":"SHUT"),
              apply:(s,v)=>{ if(inRange(v,PT.n.relief)) s.reliefBlocked[v]=s.reliefBlocked[v]?0:1; }},
  /* blkWire re-seeds a position-holding block onto the sink it now feeds: a wire landing must not be a step */
  blkWire  : {lab:"WIRE",         ix:["block",null,"block"], part:()=>roleIx("ctrl"), log:(k,slot,src)=>blkLab(k)+" IN "+(slot+1)+" FROM "+blkLab(src),
              apply:(s,k,slot,src)=>{ if(!inRange(k,PT.n.block)) return;
                const m=BLK[E_BLK_MODES[PT.blkMode[k]]]; if(!m || slot<0 || slot>=m.ins.length) return;
                s.blkIn[k*3+slot]=inRange(src,PT.n.block)?src:-1; eCtlSeedOut(k); eCtlInvalidate(); }},
  /* `q` is the knob's E_KN_ code and `v` a number: a signal, sink or op arrives as its code (actId() turns names into them) */
  blkKnob  : {lab:"TUNE",         cont:true, part:()=>roleIx("ctrl"), log:(k,q,v)=>blkLab(k)+" "+E_KN_NAMES[q].toUpperCase()+" "+
                (q===E_KN_SIG ? E_SIG_KEYS[v] : q===E_KN_SINK ? E_SINK_KEYS[v] : +(+v).toPrecision(4)),
              apply:(s,k,q,v)=>{ if(!inRange(k,PT.n.block) || !(q>=0 && q<E_KN_N)) return;
                const mode=E_BLK_MODES[PT.blkMode[k]], m=BLK[mode]; if(!m || !(E_KN_NAMES[q] in m.knobs)) return;
                const o=k*E_KN_N; s.blkKn[o+q]=v;
                if(q===E_KN_SIG && !(s.blkKn[o+E_KN_ARG]>=0)) s.blkKn[o+E_KN_ARG]=scopeArg0(sigScope(v));
                if(q===E_KN_SINK) s.blkKn[o+E_KN_ARG]=scopeArg0(sinkScope(v)); },
              ixf:(id,name,v)=>{ const k=IX.block.has(id)?IX.block.get(id):-1, q=E_KN_NAMES.indexOf(name), b=D.blocks[id];
                const scope=b&&b.mode==="source" ? (SIGNAL[b.sig]||{}).scope : b&&b.mode==="sink" ? (SINK[b.sink]||{}).scope : "plant";
                const c = name==="sig" ? eSigCode(v) : name==="sink" ? eSinkCode(v) : name==="op" ? eBlkOpCode(b?b.mode:"",v)
                        : name==="arg" ? eBlkArgIndex(scope||"plant",v) : (v==null ? NaN : +v);
                return [k,q,c]; }},
  blkOn    : {lab:"BLOCK",        ix:["block"], part:()=>roleIx("ctrl"), log:k=>blkLab(k)+" "+(ST.blkOn[k]?"OFF":"ON"),
              apply:(s,k)=>{ if(inRange(k,PT.n.block)) s.blkOn[k]=s.blkOn[k]?0:1; }},
  valveDem : {lab:"VALVE DEMAND", cont:true, ix:["throttle",null], part:w=>ixPart("throttle",w), log:(w,v)=>String(ixId("throttle",w)).toUpperCase()+" TO "+(v*100).toFixed(0)+" %",
              apply:(s,w,v)=>{ if(inRange(w,PT.n.throttle)) s.valveDem[w]=v; }},
  repair   : {lab:"REPAIR PARTY", nolog:true, ix:["part"], apply:(s,a)=>{ actRepair(a); }},
  hit      : {lab:"COMBAT HIT",   nolog:true, ix:["part"], apply:(s,a)=>{ actHit(a); }},
  blast    : {lab:"BLAST",        log:(i,kPa)=>kPa.toFixed(0)+" kPa AT CELL "+(i%GW)+","+((i/GW)|0),
              apply:(s,i,kPa)=>{ eRoomBlastCharge(i, kPa);
                s.sc[SC_BLASTN]++; s.sc[SC_BLASTAT] = i; }},
  /* two acts, never one a tick: a held button recorded per tick would flood the take forest and make
     the replay depend on frame timing. The press writes the demand and the tick walks the actual. */
  injectOn : {lab:"INJECT",       cont:true, log:(kind,rate,cell,node)=>INJ_NAME[kind]+" "+rate+" AT "+
                (node>=0 ? String(ixId("node",node)).toUpperCase() : (cell%GW)+","+((cell/GW)|0)),
              apply:(s,kind,rate,cell,node)=>{ const sc=s.sc; sc[SC_INJKIND]=kind; sc[SC_INJDEM]=rate; sc[SC_INJCELL]=cell; sc[SC_INJNODE]=node; },
              ixf:(kind,rate,tgt)=>[INJ_KIND[kind]||0, rate, typeof tgt==="number" ? tgt : -1,
                                    typeof tgt==="number" ? -1 : (IX.node.has(tgt) ? IX.node.get(tgt) : -1)]},
  injectOff: {lab:"INJECT OFF",   apply:(s)=>{ s.sc[SC_INJKIND]=0; s.sc[SC_INJDEM]=0; }},
  blackout : {lab:"BLACKOUT",     log:on=>(on===undefined?!ST.sc[SC_BLACKOUT]:!!on)?"ON":"RESTORED",
              apply:(s,on)=>{ s.sc[SC_BLACKOUT] = (on===undefined ? !s.sc[SC_BLACKOUT] : !!on) ? 1 : 0; }},
  /* an input with no panel: written straight onto the state it lands on a viewer's mirror and the next packet erases it */
  diceOff  : {lab:"DICE",         log:on=>(!!on)?"STOOD DOWN":"LIVE",
              apply:(s,on)=>{ s.sc[SC_DICEOFF] = on ? 1 : 0; }},
  porvArm  : {lab:"PORV STICKS",  log:()=>"ARMED FOR NEXT LIFT",
              apply:(s)=>{ const v=PT.rPrimaryRelief; if(v>=0) s.reliefArm[v]=1; }},
  rodJam   : {lab:"ROD JAM",      log:()=>ST.sc[SC_RODJAM]?"CLEARED":"JAMMED", apply:(s)=>{ const on=s.sc[SC_RODJAM]?0:1; coreEachIx(c=>{ s.csRodJam[c]=on; }); }},
  /* all four flags, matching the tank hit's own relief row: the stuck test reads the last one */
  porvStick: {lab:"STUCK PORV",   apply:(s)=>{ const v=PT.rPrimaryRelief;
                if(v>=0){ s.reliefOpen[v]=1; s.reliefBlocked[v]=0; s.reliefAuto[v]=1; s.reliefStuck[v]=1; } }},
  /* recRoot() too: a reset is where one recording ends and the next begins, and rec:false keeps the event off both sides of the join */
  reset    : {lab:"RESET PLANT",  sched:false, rec:false,
              apply:(s)=>{ resetPlant(); recRoot(); }},
};
const ACTKEYS = Object.keys(ACT);

/* the UI's door when it holds ids: each id argument resolved through IX; none is -1, one this plant has not got is -2 */
function actIx(k, a){
  const r = ACT[k];
  if(r.ixf) return r.ixf(...a);
  if(!r.ix) return a;
  return a.map((v,i) => { const kind = r.ix[i];
    if(!kind || typeof v === "number") return v;
    if(v == null) return -1;
    const m = IX[kind]; return m && m.has(v) ? m.get(v) : -2; });
}
const actId = (k, ...a) => act(k, ...actIx(k, a));

/* combat damage: aimed, it refuses silently rather than hitting the nearest thing; unaimed, it picks off the plant's own dice so a replay takes the same hits */
function actHit(a){
  const s = ST, nP = PT.n.part;
  if(a >= 0){
    if(a >= nP || s.dmgBy[a] || !(PT.partHitW[a] > 0)) return;
  } else if(a === -1){
    let W = 0;
    for(let i=0;i<nP;i++) if(!s.dmgBy[i]) W += PT.partHitW[i];
    if(!(W > 0)) return;
    let r = eRand()*W; a = -1;
    for(let i=0;i<nP;i++){ const w = s.dmgBy[i] ? 0 : PT.partHitW[i]; if(!(w > 0)) continue; a = i; if(r <= w) break; r -= w; }
    if(a < 0) return;
  } else return;
  eDamage(a, E_WHY_HIT);
  const fx = dmgFx(IX.partId[a]);
  logE("alarm","COMBAT DAMAGE / "+fx.msg, fx.why+
    (PT.partAccess[a]?" A repair party can reach it.":" IT IS WALLED IN - no repair is possible with this layout."));
}
/* every refusal is a silent no-op: not there, walled in, already out, spent */
function actRepair(a){
  const sc = ST.sc;
  if(!(a >= 0 && a < PT.n.part) || !PT.partAccess[a] || sc[SC_REPA] >= 0 || sc[SC_PARTYSPENT]) return;
  const need = 14 + PT.partBox[a*4+2]*PT.partBox[a*4+3]*4;
  sc[SC_REPA] = a; sc[SC_REPT] = 0; sc[SC_REPNEED] = need;
  sc[SC_REPRATE] = eRepairRadRate();
  const rr = sc[SC_REPRATE], eta = need/eRadWorkK(rr), p = dmgPart(IX.partId[a]);
  logE("info","REPAIR PARTY DISPATCHED / "+(p ? p.name : IX.partId[a]),
    "Estimated "+eta.toFixed(0)+" seconds at "+rr.toFixed(2)+
    "x area dose - "+(rr>RAD_SLOW
      ? "hot enough that the party works in short shifts, which is why this is longer than the "+need+" s the job itself takes."
      : "cool enough to work straight through, so this is the job's own "+need+" s.")+
    " It takes dose the whole time, at the rate of the cell it is standing in.");
}
function actResetTrip(){
  if(!ST.sc[SC_SCRAMMED]) return false;
  const v = eResetVeto();
  if(v !== -1){
    logE("warn","TRIP RESET REFUSED",
      (v >= 0 ? nameFor(IX.blockId[v], IX.blockId[v].toUpperCase()) : "PROTECTION")+" is still present. The latch will not clear until the condition does.");
    return false; }
  eTripReset();
  const st = eRpsState();
  logE("info","TRIP RESET",
    "Protection latch cleared by hand. The control bank answers demand again."+
    (st===E_RPS_ARMED?"":" Nothing checked the plant first - protection is "+(st===E_RPS_NONE?"not fitted":"bypassed")+"."));
  return true;
}

/* recorded before it is performed: a fork's base is a snapshot taken here, so applying first would have the branch do the act twice */
function act(k, ...a){
  if(!ACT[k]) throw new Error("act: no such act "+k);
  /* a bound feed owns the plant, so this is transport and not a second dispatch - except a RESET,
     which is a new plant, and a new plant is a new worker */
  if(typeof simLiveFeed === "function" && simLiveFeed()){
    if(k !== "reset"){ simTell({t:"act", k, a}); return true; }
    simKillAll();
    recAct(k, a); actDo(k, a);
    simRestart({seed:ST.sc[SC_SEED]>>>0});
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
const actDead = (k, a) => { const r = ACT[k], f = r.part;
  if(r.ix && typeof a[0] === "number" && a[0] < 0 && !(k === "hit" && a[0] === -1)) return true;
  if(!f) return false;
  const i = f(...a);
  return i >= 0 && ST.dmgBy[i] !== 0; };
function actDo(k, a){ if(actDead(k, a)) return; actLog(k, a); ACT[k].apply(ST, ...a); }

/* a recording is a forest of takes: the acts are the recording, the keyframes and trend archive a cache eviction may always throw away */
const REC_MAX_ROOTS = 8;      // whole runs kept; the 9th evicts the oldest lineage
const REC_MAX_KEY_BYTES = 24*1048576;
const REC_MAX_TR_BYTES  = 32*1048576;
const KF_TICKS      = 250;    // 5 sim-seconds between keyframes, before thinning
/* KF_TICKS is a sim-time gap, so the spacing is stretched to hold the cost per wall second roughly flat */
const KF_PER_SEC = 2, KF_MAX_STRETCH = 4;
const kfSpan = t => KF_TICKS * t.thin *
  clamp(Math.round(TR.sps/KF_PER_SEC/KF_TICKS), 1, KF_MAX_STRETCH);

/* keyframes are pooled records, each with its own state buffer and log array, so laying one down allocates nothing once the pool is warm */
const KFPOOL = {bytes:0, cap:0, made:0, free:[]};
function kfGet(){
  const n = engSnapLen();
  if(KFPOOL.bytes !== n){ KFPOOL.bytes = n; KFPOOL.made = 0; KFPOOL.free = [];
    KFPOOL.cap = Math.max(4, Math.floor(REC_MAX_KEY_BYTES/Math.max(n, 1))); }
  if(KFPOOL.free.length) return KFPOOL.free.pop();
  if(KFPOOL.made >= KFPOOL.cap) return null;
  KFPOOL.made++;
  return {tick:0, st:new Uint8Array(n), lg:[], ei:0, bytes:0};
}
const kfPut = k => { if(k.st && k.st.length === KFPOOL.bytes && KFPOOL.free.length < KFPOOL.cap) KFPOOL.free.push(k); };

const REC = { roots:[], takes:[], cur:0, mode:"live", keyCount:0, keyBytes:0, trBytes:0 };

/* the design a recording is about, captured once per ROOT, JSON-round-trippable and frozen all the way down */
function recFreeze(o){
  if(ArrayBuffer.isView(o)) return o;    // a typed array with elements refuses to freeze
  if(o && typeof o === "object"){ for(const k in o) recFreeze(o[k]); Object.freeze(o); }
  return o;
}
/* throws rather than copying a reference, so a head stays plain data */
function recClone(v){
  if(v === null || typeof v !== "object") return v;
  if(ArrayBuffer.isView(v)) return v.slice();
  if(Array.isArray(v)) return v.map(recClone);
  if(Object.getPrototypeOf(v) === Object.prototype){
    const o = {}; for(const k in v) o[k] = recClone(v[k]); return o; }
  throw new Error("recHead: the design carries a " + Object.prototype.toString.call(v));
}
function recHead(){
  return recFreeze({
    D        : recClone(D),
    /* not in D, and both change what the plant IS: pipe run, thermosiphon head, exposure */
    parts    : LAY ? LAY.parts.map(p => ({id:p.id, x:p.x, y:p.y})) : [],
    dsig     : designSig(),
    nsig     : NODE_SIG,
    seed     : ST ? ST.sc[SC_SEED] : 0,
  });
}
/* bumped whenever the state's layout changes meaning: a recording carries indices and a buffer, and designSig() cannot see a schema change */
const NODE_SIG = "flat-state/2";

/* returns whether the head rebuilt into the same reactor, and the caller must ask */
function recApplyHead(h){
  Object.assign(D, recClone(h.D));
  buildLayout();
  for(const id of coreIds()) latRevolve(D.cores[id]);
  for(const q of h.parts){ const p=partOf(q.id); if(p){ p.x=q.x; p.y=q.y; } }
  layoutMetrics();
  return designSig() === h.dsig && h.nsig === NODE_SIG;
}
/* id/parent/kids are the tree, base+baseLog the plant at tick0, keys the cache, evs the recording, tr/trT/trN the trend archive */
function recNew(parent, head){
  const sc = ST.sc;
  const t = {
    id:REC.takes.length, parent, head,
    t0:sc[SC_T], tick0:sc[SC_TICK],
    base:snapS(), baseLog:LOG.slice(),
    keys:[], evs:[],
    tr:{}, trA:null, trT:[], trN:0, trThin:1,   // trThin: samples dropped per sample kept, 1 = full rate
    tickEnd:sc[SC_TICK], nextKey:sc[SC_TICK] + KF_TICKS,
    kids:[], label:null, verdict:null,
    /* not flown straight through: any take with a parent was scrubbed back into */
    assisted:parent !== null,
    thin:1,                       // keyframe spacing multiplier; doubles on eviction
  };
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

/* the test is the clock and not a notification, so the sim stays ignorant of the recorder; only ever asked in live mode, since a seek moves the tick back on purpose */
function recBoot(){
  const t = recCur(), tick = ST.sc[SC_TICK];
  if(!t || tick < t.tick0 || tick < t.tickEnd) return recRoot();
  return t;
}

const recSameTrack = (x, y) => {
  if(x.length !== y.length) return false;
  for(let i = 0; i < x.length-1; i++) if(x[i] !== y[i]) return false;   // all but the value
  return true;
};
function recAct(k, a){
  if(!ST || ACT[k].rec === false) return;
  const tick = ST.sc[SC_TICK];
  /* watching does not fork; touching does, which is the first moment the two futures can differ */
  if(REC.mode !== "live") recBranch(REC.cur, tick);
  const t  = recBoot();
  const ev = {tick, seq:t.evs.length, k, a:a.slice()};
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
  const t = recBoot(), tick = ST.sc[SC_TICK];
  t.tickEnd = tick;
  if(tick >= t.nextKey){
    let k = kfGet();
    if(!k){ recEvict(true); k = kfGet(); }
    if(k){
      k.tick = tick; engSnap(k.st); k.ei = t.evs.length;
      k.lg.length = 0; for(let i=0;i<LOG.length;i++) k.lg.push(LOG[i]);
      recKeyAdd(t, k); }
    t.nextKey = tick + kfSpan(t);
    if(REC.keyBytes > REC_MAX_KEY_BYTES) recEvict(false);
  }
}
// the one door onto t.keys, so the byte book cannot drift from the list
function recKeyAdd(t, k){
  k.bytes = k.st.byteLength + 32 + 8*k.lg.length;
  t.keys.push(k); REC.keyCount++; REC.keyBytes += k.bytes;
}
function recKeysTake(keys){ let n=0; for(const k of keys) n += k.bytes; return n; }
// a take built in the worker arrives with keys and no book: price them here
function recKeysAdopt(t){ const ks=t.keys; t.keys=[]; for(const k of ks) recKeyAdd(t,k); }

/* halves the oldest take's keyframe density rather than truncating; `base` and `evs` are never candidates. `force` frees at least one key for the pool */
function recEvict(force){
  while(force || REC.keyBytes > REC_MAX_KEY_BYTES){
    let o = null;
    for(const t of REC.takes) if(t && t.keys.length > 1 && (!o || t.id < o.id)) o = t;
    if(!o) return;
    o.thin *= 2;
    const keep = [];
    for(let i=0;i<o.keys.length;i++){ const k = o.keys[i]; if(i % 2 === 0) keep.push(k); else kfPut(k); }
    REC.keyCount -= o.keys.length - keep.length;
    REC.keyBytes -= recKeysTake(o.keys) - recKeysTake(keep);
    o.keys = keep;
    force = false;
  }
}
/* a root and its whole subtree go together: a child's base is a state only its parent's history explains */
function recDrop(id){
  const t = REC.takes[id]; if(!t) return;
  for(const k of t.kids) recDrop(k);
  for(const k of t.keys) kfPut(k);
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
  let src = {tick:own.tick0, st:own.base, lg:own.baseLog, ei:0};
  for(const k of own.keys) if(k.tick <= tick && k.tick >= src.tick) src = k;
  restoreS(src.st); LOG = src.lg.slice(); logResync();

  let i = src.ei;
  while(ST.sc[SC_TICK] < tick){
    i = applyDue(own, ST.sc[SC_TICK], i);
    step(0.02);
    if(ST.sc[SC_TICK] % SAMP_TICKS === 0) sample();
  }
  REC.cur = own.id;
  histFill(own, tick);
  return ST;
}

/* `base` is a snapshot and never a reference to the parent's keyframe, so a child cannot rewrite its parent's past */
function recBranch(takeId, tick){
  if(tick !== undefined && (REC.cur !== takeId || ST.sc[SC_TICK] !== tick)) seek(takeId, tick);
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
  if(!t || ST.sc[SC_TICK] >= t.tickEnd) return false;
  applyDue(t, ST.sc[SC_TICK]);
  return true;
}
/* the rate scales the accumulator and never dt, which is why 16x lands on the same plant as 1x; TR is not state */
const TR = {rate:1, paused:false, step1:0, sps:0, tickX:[0,0,0], vldSeen:null, vldHit:-1, vldRev:0,
            tickMs:null, tps:0, rateMax:Infinity};
/* MAX with a stop condition: only a tile that was not lit when the run started halts it */
const TR_VLD = "vld";
/* only on the ticks the board moved: annStep() counts the transitions, so a standing board costs one integer compare */
const trVldCheck = () => {
  if(ST.sc[SC_ANNREV]===TR.vldRev) return;
  TR.vldRev=ST.sc[SC_ANNREV];
  const on=ST.annOn;
  for(let r=0;r<on.length;r++) if(on[r] && !TR.vldSeen[r]){ TR.vldHit=r; return; }
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
  scnDue(ST.sc[SC_TICK]);
  step(0.02);
  if(ST.sc[SC_TICK] % SAMP_TICKS === 0) sample();
  if(TR.vldSeen && TR.vldHit<0){ laySettle(); trVldCheck(); layRelease(); }
  spsN++;
}
/* the part tick at each end of the window is counted, or the reading beats against the tick grid */
let spsN=0, spsT=0, spsAcc0=0;
function spsFrame(dt){
  spsT += dt; tkWall += dt;
  if(spsT>=0.5){ TR.sps=(spsN+(simAcc-spsAcc0)/0.02)/spsT; spsN=0; spsT=0; spsAcc0=simAcc; }
  tickPct();
}
/* achieved speed per tick, off the wall time each tick fell due on the accumulator: frames batch ticks, the due times do not */
const TK_RING=1500, TK_PCT=[5,50,95];
const tkRing=new Float64Array(TK_RING), tkSort=new Float64Array(TK_RING);
let tkHead=0, tkFill=0, tkDirty=false, tkWall=0, tkPrev=NaN;
function tickDue(due){
  if(due>tkPrev){
    tkRing[tkHead]=0.02/(due-tkPrev); tkHead=(tkHead+1)%TK_RING;
    if(tkFill<TK_RING) tkFill++;
    tkDirty=true;
  }
  tkPrev=due;
}
/* no accumulator to read: the frame's ticks are spread evenly over its wall time */
function tickSpread(m, dt){
  for(let k=1;k<=m;k++) tickDue(tkWall-dt+dt*k/m);
}
function tickReset(){
  tkHead=0; tkFill=0; tkDirty=false; tkPrev=NaN;
  TR.tickX[0]=TR.tickX[1]=TR.tickX[2]=0;
}
function tickPct(){
  if(!tkDirty) return;
  tkDirty=false;
  const s=tkSort.subarray(0,tkFill);
  s.set(tkRing.subarray(0,tkFill)); s.sort();
  for(let i=0;i<TK_PCT.length;i++)
    TR.tickX[i]=s[Math.min(tkFill-1, Math.max(0, Math.ceil(TK_PCT[i]/100*tkFill)-1))];
}
/* measured on a snapshot and put back; a cold tick is not what a run costs */
const TRB_WARM=6;
const TRB_ROUNDS=5, TRB_PER=8;
/* the share of a second the ticks may have, refresh-independent */
const TRB_SHARE = TR_MAX_MS/(1000/60);
function trBench(){
  if(!P||!ST){ TR.tickMs=null; TR.tps=0; TR.rateMax=Infinity; return; }
  const snap=snapS(), lg=LOG.slice();
  const tick=()=>{ step(0.02); };
  let ms=Infinity;
  try {
    for(let i=0;i<TRB_WARM;i++) tick();
    for(let r=0;r<TRB_ROUNDS;r++){
      const t0=trNow();
      for(let i=0;i<TRB_PER;i++) tick();
      const m=(trNow()-t0)/TRB_PER;
      if(m<ms) ms=m;
    }
  } finally { restoreS(snap); LOG=lg; logResync(); }
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
  if(!P || !SIMSCREEN[screen]){ simAcc=spsAcc0=0; tkPrev=NaN; return false; }
  /* a bound feed owns the plant: this thread asks for a picture and never steps one */
  if(simLiveFeed()){ simAcc=spsAcc0=0; tkPrev=NaN; return simAsk(); }
  /* once a frame whether or not one is painted: the ticks read cached design signatures, this pass proves them */
  layFresh();
  /* a scenario draining takes the whole frame, or the run would be stepped at two speeds at once */
  if(scnBusy()){
    simAcc=spsAcc0=0;
    const k0=ST.sc[SC_TICK]; scnDrain(); tickSpread(ST.sc[SC_TICK]-k0, dt);
    return true;
  }
  if(TR.paused){
    /* paused still keyframes, or a plant nudged forward a tick at a time would never lay one down */
    simAcc=spsAcc0=0; tkPrev=NaN;
    let k=0;
    while(TR.step1>0){ TR.step1--; if(!recPlay()) break; simTick(); k++; }
    recTick(); return k>0;
  }
  if(TR.rate===Infinity||TR.rate===TR_VLD){
    /* no accumulator: an unbounded rate owes an unbounded number of ticks */
    simAcc=spsAcc0=0;
    const vld=TR.rate===TR_VLD;
    // armed here, so the stash is the plant one tick before the run
    if(vld && !TR.vldSeen){ TR.vldSeen=Uint8Array.from(ST.annOn); TR.vldRev=ST.sc[SC_ANNREV]; }
    const t0=trNow(), budget=vld?TR_VLD_MS:TR_MAX_MS; let m=0;
    while(trNow()-t0 < budget){
      if(!recPlay()){ TR.paused=true; break; }
      simTick(); m++;
      if(TR.vldHit>=0){
        logE("warn","VALIDATION RUN HALTED / "+ANN[TR.vldHit][0],
          "A tile that was not lit when the validation run started has come up, so the run has dropped back to 1x with the plant still going.");
        trRate(1); break;
      }
    }
    if(TR.rate===Infinity||TR.rate===TR_VLD) tickSpread(m, dt);
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
    tickDue(tkWall-(simAcc-0.02)/TR.rate);
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
                     diceOff:!!(opt&&opt.diceOff), rate:TR.rate, paused:TR.paused,
                     snap:opt&&opt.snap, log:opt&&opt.log}); }
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
  if(SIMBOUND === id){ SIMBOUND = null; SHMV = null; histDetach(); }
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
  /* NOT benched here: benching the worker's plant would move its next tick off this thread's */
  o.onLive = id => { simBind(id); };
  return simSpawn(o, why => logE("info","PLANT ON THIS THREAD",
    "A background thread was not available ("+why+"), so the plant is being stepped on the page's "+
    "own thread instead. It is the same plant and the same answer, just sharing the frame with the drawing."));
}

/* the viewer's own map onto the worker's published slots; null until a worker sends the buffer */
let SHMV = null;
/* the state arrives as bytes into this thread's own buffer: shared slots when there are any, a cloned copy when not */
function simApply(m){
  if(m.shm) SHMV = shmAttach(m.shm);
  if(SHMV && m.seq) shmPull(SHMV, m.seq);
  else if(m.st) engRestore(m.st);
  if(m.jump){ if(typeof pipeReset==="function") pipeReset(); if(typeof fxReset==="function") fxReset(); }
  if(m.log) LOG = m.log;
  if(m.hshm) histAttach(m.hshm);
  else if(m.hfull) histLoad(m.hfull);
  else if(m.hb) histPushBlock(m.hb);
  histSync();
  if(m.rec){ REC.cur = m.rec.cur; REC.mode = m.rec.mode;
             REC.roots = m.rec.roots; REC.takes = m.rec.takes; }
  else if(m.tickEnd !== undefined){ const t = REC.takes[REC.cur]; if(t) t.tickEnd = m.tickEnd; }
  if(m.sps !== undefined) TR.sps = m.sps;
  if(m.tickX) TR.tickX = m.tickX;
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
  if(r!==TR.rate) tickReset();
  TR.rate=r; TR.paused=false; TR.vldSeen=null; TR.vldHit=-1; TR.vldRev=0;
  simTell({t:"rate", rate:r, paused:false}); };
const trPause=()=>{ TR.paused=!TR.paused; simTell({t:"rate", paused:TR.paused}); };
const TR_STEP_BIG=10;
const trStepN = e => e&&e.shiftKey ? TR_STEP_BIG : 1;
const trStep=e=>{ const n=trStepN(e); TR.paused=true; TR.step1+=n;
  simTell({t:"rate", paused:true, step1:n}); };
/* backwards is a seek: step() is not invertible, so one tick back is a scrub off the nearest keyframe */
const trStepBack=e=>{ TR.paused=true; TR.step1=0; simTell({t:"rate", paused:true});
  if(ST) trSeek(REC.cur, ST.sc[SC_TICK]-trStepN(e)); };
