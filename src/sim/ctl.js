"use strict";
/* ═══════════════ AUTOMATION THE PLAYER BUILDS ═══════════════
   Every block lives inside the CONTROL room (ROLE.ctrl): it is a row in
   D.blocks, not a machine on the grid. The design is D.blocks[id] =
   {mode, in:[…], on, …knobs}; the live block is s.blkBy[id], seeded from it by
   resetPlant() and moved only by ACT.blkWire/blkKnob/blkOn and by ctlPass().
   A block reads SIGNAL rows, feeds other blocks, and lands on a SINK row.
   Evaluated once per tick at the head of step(), on the previous tick's solved
   values - the lag the built-in rod controller was tuned with.
   Automation is electrical: with no supply (supplyK 0) or the controller
   wrecked, nothing is evaluated and every output HOLDS. */

/* ══ THE MODES ══ ins names the slots, knobs their defaults, st the state a
   block carries beside its output. A knob that means "none" is null. */
const BLK={
  source: {lab:"SOURCE",  ins:[],              knobs:{sig:"tavg", arg:null},
    tip:"A transmitter. Reads one plant quantity, of one machine where the quantity has one."},
  const:  {lab:"CONST",   ins:[],              knobs:{v:0},
    tip:"A setpoint. One number, in whatever unit the block it feeds expects.",
    ktip:{v:"The number this block puts out, every tick, for ever."}},
  math:   {lab:"MATH",    ins:["A","B"],       knobs:{op:"sub", k:1},
    tip:"k times A op B. sub is the error a controller runs on; div makes an error relative; max and min are a select.",
    ktip:{k:"Gain on the answer: the whole result is multiplied by it. 1 leaves it alone; -1 turns the sign of an error round."}},
  pid:    {lab:"PID",     ins:["ERR","RATE"],  knobs:{kp:null, ti:null, td:null, db:0, n:8}, st:{f:0},
    sug:{kp:()=>autorodTune().arKp, ti:()=>autorodTune().arTi, td:()=>autorodTune().arTd},
    tip:"Velocity form: puts out an INCREMENT per tick, kp x (filtered rate + error/ti + td x change of rate). Feed the rate the plant already measures to RATE, or leave it and the rate term is nothing. db is a dead band on the error; n filters the rate at td/n. Lands on an INTEG or on a stepping sink such as the rod drive. kp, ti and td left blank take the plant's own rod tune; 0 switches a term off.",
    ktip:{kp:"Proportional gain: how hard it pushes for a given error. Too small and it never catches up; too big and it hunts. Blank takes the plant's own rod tune.",
      ti:"Integral time, seconds: how long it takes the standing-error term to add up to one proportional push. Smaller is more eager and less stable. Blank takes the plant's own tune; 0 switches the term off.",
      td:"Derivative time, seconds: how far ahead it leans on the rate of change. It damps overshoot and it amplifies noise. Blank takes the plant's own tune; 0 switches the term off.",
      db:"Dead band on the error, in the error's own unit. Inside it the block puts out nothing, so a valve or a rod drive stops nibbling at noise.",
      n:"Derivative filter divisor: the rate term is filtered at td/n seconds. Higher n is a sharper derivative and a noisier one. 8 is the usual."}},
  integ:  {lab:"INTEG",   ins:["STEP"],        knobs:{lo:0, hi:1},
    tip:"Adds what arrives to what it holds, between lo and hi. The position a PID's increments add up to.",
    ktip:{lo:"The lowest the held position may go. For a valve, shut.",
      hi:"The highest the held position may go. For a valve, wide open."}},
  limit:  {lab:"LIMIT",   ins:["IN"],          knobs:{lo:null, hi:null, rate:null},
    tip:"Clamps between lo and hi and, with a rate, will not move faster than it per second.",
    ktip:{lo:"Floor. Anything below it leaves as this. Blank means no floor.",
      hi:"Ceiling. Anything above it leaves as this. Blank means no ceiling.",
      rate:"Fastest the output may move, per second. It turns a step into a ramp. Blank means no limit."}},
  lag:    {lab:"LAG",     ins:["IN"],          knobs:{tau:1},
    tip:"First-order filter, tau seconds. What a real transmitter does to a step.",
    ktip:{tau:"Time constant, seconds: after a step the output covers about two thirds of the gap in this long. Bigger is smoother and later."}},
  compare:{lab:"COMPARE", ins:["IN","ON","OFF"], knobs:{on:1, off:0},
    tip:"1 once IN rises above on, 0 once it falls below off. The gap is the hysteresis that stops it chattering. Wire ON or OFF and the setpoint is read live from there instead of from the knob - a relief valve's own lift point, say.",
    ktip:{on:"The value IN must rise above for the output to go to 1. Ignored while the ON slot is wired.",
      off:"The value IN must fall below for the output to go back to 0. Keep it under the on point: the gap is what stops the chatter. Ignored while the OFF slot is wired."}},
  latch:  {lab:"LATCH",   ins:["SET","RESET"], knobs:{},
    tip:"Seal-in. SET makes it 1 and it stays 1 until RESET. RESET wins if both are up. What a trip is."},
  sel:    {lab:"SELECT",  ins:["A","B","C"],   knobs:{op:"max"},
    tip:"max, min or median of what is wired. Three transmitters into a median is how a plant votes a liar out."},
  sink:   {lab:"SINK",    ins:["IN"],          knobs:{sink:"loadDem", arg:null},
    tip:"An actuator. What arrives at IN is written to the plant, in the sink's own unit. While it is wired and on, the block owns that demand and the strip says so."},
};
const BLK_MODES=Object.keys(BLK);
const MATH_OPS=["add","sub","mul","div","min","max"], SEL_OPS=["max","min","median"];

/* ══ THE SINKS ══ every demand a block may drive, in the unit the matching
   SIGNAL row reads. `part` is the machine the order is for, and the refusal
   is the same partWrecked() actDead() (record.js) asks - a wrecked machine
   takes no orders down either path. `step` marks a sink that takes an
   increment and integrates it itself: the rod drive is the integrator. */
const SINK={
  rodStep:{lab:"ROD DRIVE", u:"/tick", scope:"core", step:true, part:id=>rodsOf(id),
    read:(s,id)=>coreSeen(s,id).rodDem,
    apply:(s,id,v,dt)=>{ coreOn(s,id,(cs,K)=>rodApply(s,cs,K,v,dt)); }},
  freg:   {lab:"FEED VALVE", u:"", scope:"sg", part:id=>id,
    read:(s,id)=>s.fregBy[id]||0,
    apply:(s,id,v)=>{ if(s.fregBy[id]!==undefined) s.fregBy[id]=clamp(v,0,1); }},
  relief: {lab:"RELIEF VALVE", u:"", scope:"fit", part:fid=>fid,
    read:(s,fid)=>s.reliefOpen[fid]?1:0,
    apply:(s,fid,v)=>{ if(s.reliefOpen[fid]!==undefined && !fitSpring(fid)) reliefCmd(s,fid,v>0.5); }},   // a spring safety takes no orders; a valve this plant never had is a no-op, not a phantom key on S
  flowDem:{lab:"PUMP DEMAND", u:"%", scope:"pump", part:id=>id,
    read:(s,id)=>(s.flowDemBy[id]||0)*100,
    apply:(s,id,v)=>{ if(s.flowDemBy[id]!==undefined) s.flowDemBy[id]=clamp(v/100,0,1.5); }},
  loadDem:{lab:"LOAD DEMAND", u:"%", scope:"plant", part:()=>roleId("turb"),
    read:s=>s.loadDem*100,
    apply:(s,_,v)=>{ s.loadDem=clamp(v/100,0,P.loadMax); }},
  boronDem:{lab:"BORON DEMAND", u:"pcm", scope:"plant", part:()=>null,
    read:s=>s.boronDem,
    apply:(s,_,v)=>{ s.boronDem=v; }},
  valveDem:{lab:"THROTTLE", u:"%", scope:"fit", part:fid=>fid,
    read:(s,fid)=>(s.valveDem[fid]||0)*100,
    apply:(s,fid,v)=>{ if(s.valveDem[fid]!==undefined) s.valveDem[fid]=clamp(v/100,0,1); }},
  tankOpen:{lab:"TANK VALVE", u:"", scope:"tank", part:id=>id,
    read:(s,id)=>s.tankOpen[id]?1:0,
    apply:(s,id,v)=>{ if(s.tankOpen[id]!==undefined) s.tankOpen[id]=v>0.5; }},
  scram:  {lab:"SCRAM", u:"", scope:"core", part:id=>id,
    read:(s,id)=>coreSeen(s,id).scrammed?1:0,
    apply:(s,id,v)=>{ if(v>0.5 && !coreSeen(s,id).scrammed) manualScram(id); }},
};
const SINK_KEYS=Object.keys(SINK);

/* WHICH INSTANCES A SCOPE MAY NAME. `plant` names none. */
function sigArgs(scope){
  switch(scope){
    case "core": return coreIds();
    case "sg":   return sgIds();
    case "pump": return pumpIds();
    case "fit":  return Object.keys(D.fittings);   // D, not P: on the bench P is the LAST plant commissioned
    case "tank": return tankIds();
    case "loop": { const n=nodeGraph().nCirc; const a=[]; for(let i=0;i<n;i++) a.push(String(i)); return a; }
    default: return [];
  }
}
/* the argument a freshly placed block gets: the first instance there is */
const sigArg0=scope=>{ const a=sigArgs(scope); return a.length?a[0]:null; };

/* ══ THE DESIGN SIDE: D.blocks ══ bench gestures, never through act(). */
function mintBlock(mode){
  let n=1; while(D.blocks["b"+n]) n++;
  const id="b"+n, m=BLK[mode]||BLK.const;
  D.blocks[id]=Object.assign({mode, in:m.ins.map(()=>null), on:true}, m.knobs);
  if(mode==="source") D.blocks[id].arg=sigArg0(SIGNAL[D.blocks[id].sig].scope);
  if(mode==="sink")   D.blocks[id].arg=sigArg0(SINK[D.blocks[id].sink].scope);
  dTouch(); return id;
}
function removeBlock(id){
  delete D.blocks[id];
  for(const k in D.blocks){ const b=D.blocks[k]; for(let i=0;i<b.in.length;i++) if(b.in[i]===id) b.in[i]=null; }
  dTouch();
}
/* a mode change keeps the id and the wiring slots that still exist */
function setBlockMode(id,mode){
  const b=D.blocks[id]; if(!b||!BLK[mode]) return;
  const m=BLK[mode], nb=Object.assign({mode, in:m.ins.map((_,i)=>b.in[i]||null), on:b.on!==false}, m.knobs);
  if(mode==="source") nb.arg=sigArg0(SIGNAL[nb.sig].scope);
  if(mode==="sink")   nb.arg=sigArg0(SINK[nb.sink].scope);
  D.blocks[id]=nb; dTouch();
}

/* ══ THE LIVE SIDE: s.blkBy ══ */
function blkSeed(){
  const out={};
  for(const id in D.blocks){ const b=D.blocks[id], m=BLK[b.mode]; if(!m) continue;
    const L=Object.assign({mode:b.mode, in:m.ins.map((_,i)=>b.in[i]||null), on:b.on!==false, out:0}, m.knobs, m.st||{});
    for(const k in m.knobs) if(b[k]!==undefined) L[k]=b[k];
    if(m.sug) for(const k in m.sug) if(L[k]==null) L[k]=m.sug[k]();
    out[id]=L; }
  return out;
}
/* BUMPLESS: a block that remembers a position (integ, limit, lag) and feeds a
   sink starts where that sink already stands, so a wire landing is not a step. */
function blkSeedOut(s,id){
  const b=s.blkBy[id]; if(!b || b.mode!=="sink") return;
  const src=b.in[0], u=src&&s.blkBy[src], row=SINK[b.sink];
  if(!u || !row || row.step) return;
  if(u.mode==="integ"||u.mode==="limit"||u.mode==="lag"){ const v=row.read(s,b.arg); if(isFinite(v)) u.out=v; }
}
const blkSeedOuts=s=>{ for(const id in s.blkBy) blkSeedOut(s,id); };

/* ══ ORDER ══ Kahn over the live links, cached on their signature. A block
   left on a cycle is evaluated after the rest and reads last tick's outputs,
   which is the one-tick lag a feedback loop has anyway. */
const CTL_ORD={sig:null, order:[]};
function ctlOrder(s){
  const ids=Object.keys(s.blkBy), sig=ids.map(id=>id+":"+s.blkBy[id].in.join(",")).join(";");
  if(sig===CTL_ORD.sig) return CTL_ORD.order;
  const deg={}, kids={};
  for(const id of ids){ deg[id]=0; kids[id]=[]; }
  for(const id of ids) for(const src of s.blkBy[id].in) if(src && deg[src]!==undefined){ deg[id]++; kids[src].push(id); }
  const q=ids.filter(id=>deg[id]===0), order=[];
  while(q.length){ const id=q.shift(); order.push(id); for(const k of kids[id]) if(--deg[k]===0) q.push(k); }
  for(const id of ids) if(deg[id]>0) order.push(id);
  CTL_ORD.sig=sig; CTL_ORD.order=order;
  return order;
}

/* ══ IS THE CABINET COMPUTING ══ a controller placed, whole, and fed. */
const ctlHost = () => roleId("ctrl");
const ctlLive = s => { const id=ctlHost(); return !!id && !partWrecked(s,id) && supplyK(s)>0; };
const blkDead = (s,b) => { const row=SINK[b.sink]; if(!row) return true;
  const part=row.part(b.arg); return !!part && partWrecked(s,part); };

/* ══ ONE BLOCK ══ */
function blkEval(s,b,I,dt){
  switch(b.mode){
    case "source": return sigRead(s,b.sig,b.arg);
    case "const":  return b.v;
    case "math": { const a=I[0], c=I[1]; let r;
      switch(b.op){ case "add": r=a+c; break; case "sub": r=a-c; break; case "mul": r=a*c; break;
        case "div": r=c!==0?a/c:0; break; case "min": r=Math.min(a,c); break; default: r=Math.max(a,c); }
      return b.k===1 ? r : b.k*r; }
    case "pid": { const e=I[0], rate=I[1], td=b.td||0;
      const f = b.f + Math.min(dt/Math.max(td/b.n, dt), 1)*(rate - b.f);
      const u = Math.abs(e) < b.db ? 0
        : b.kp*(f + (b.ti>0 ? e/b.ti : 0) + td*(f - b.f)/Math.max(dt,1e-9))*dt;
      b.f=f; return u; }
    case "integ":  return clamp(b.out+I[0], b.lo==null?-Infinity:b.lo, b.hi==null?Infinity:b.hi);
    case "limit": { let v=clamp(I[0], b.lo==null?-Infinity:b.lo, b.hi==null?Infinity:b.hi);
      if(b.rate!=null){ const d=v-b.out; v=b.out+Math.sign(d)*Math.min(Math.abs(d),b.rate*dt); }
      return v; }
    case "lag":    return b.out + Math.min(dt/Math.max(b.tau,dt),1)*(I[0]-b.out);
    case "compare":{ const on=(b.in[1]&&s.blkBy[b.in[1]])?I[1]:b.on, off=(b.in[2]&&s.blkBy[b.in[2]])?I[2]:b.off;
      return b.out ? (I[0] < off ? 0 : 1) : (I[0] > on ? 1 : 0); }
    case "latch":  return I[1]>0.5 ? 0 : I[0]>0.5 ? 1 : b.out;
    case "sel": { const w=[]; b.in.forEach((src,i)=>{ if(src) w.push(I[i]); }); if(!w.length) return 0;
      if(b.op==="min") return Math.min(...w); if(b.op==="max") return Math.max(...w);
      w.sort((p,q)=>p-q); return w[(w.length-1)>>1]; }
    case "sink": { const row=SINK[b.sink]; if(row && !blkDead(s,b)) row.apply(s,b.arg,I[0],dt); return I[0]; }
  }
  return b.out;
}

/* ══ THE PASS ══ at the head of the tick. Off, wrecked or dark: every output
   holds and no sink is written - the plant runs on the last demand it was
   given, which is exactly what a dead cabinet leaves behind. */
function ctlPass(s,dt){
  if(!s.blkBy) return;
  if(!ctlLive(s)) return;
  for(const id of ctlOrder(s)){ const b=s.blkBy[id];
    if(!b.on) continue;
    const I=b.in.map(src=>(src&&s.blkBy[src])?s.blkBy[src].out:0);
    const v=blkEval(s,b,I,dt);
    b.out=isFinite(v)?v:b.out;
  }
}

/* ══ WHO IS DRIVING THIS DEMAND ══ the strip asks, the rod drive asks. Null
   when no live, wired, powered block lands on it. */
function sinkDriver(s,sink,arg){
  if(!s||!s.blkBy||!ctlLive(s)) return null;
  for(const id in s.blkBy){ const b=s.blkBy[id];
    if(b.mode==="sink" && b.on && b.sink===sink && (b.arg==null||b.arg===arg) && b.in[0] && s.blkBy[b.in[0]]) return id; }
  return null;
}
/* the label on a wire: the signal's own name and unit where one forces it,
   the block's kind otherwise */
function blkLabel(s,id){
  const b=(s&&s.blkBy&&s.blkBy[id])||D.blocks[id]; if(!b) return {lab:id,u:""};
  if(b.mode==="source"){ const r=SIGNAL[b.sig]; return {lab:r?r.lab:b.sig, u:r?r.u:""}; }
  if(b.mode==="sink"){ const r=SINK[b.sink]; return {lab:r?r.lab:b.sink, u:r?r.u:""}; }
  // a chain keeps its unit until something changes what the number means
  const up=b.in.find(x=>x), m=BLK[b.mode];
  const keeps = b.mode==="limit"||b.mode==="lag"||b.mode==="sel"||b.mode==="latch"
    ||(b.mode==="math"&&(b.op==="add"||b.op==="sub"||b.op==="min"||b.op==="max")&&b.k===1);
  if(up && keeps) return {lab:m.lab, u:blkLabel(s,up).u};
  return {lab:m?m.lab:b.mode, u:""};
}

/* ══ THE STOCK AUTOMATION, AS GESTURES ══ what AUTOSYS used to ship built in,
   rebuilt out of the same blocks the player has - so a preset cannot wire a
   controller the player could not have wired. Called by the preset builder
   after the plumbing, once the machines it addresses exist. */
function blkMk(mode,knobs,ins){
  const id=mintBlock(mode); Object.assign(D.blocks[id],knobs||{});
  if(ins) ins.forEach((src,i)=>{ if(src) D.blocks[id].in[i]=src; });
  return id;
}
/* The Westinghouse-shaped rod controller: T-avg against programme, plus the
   one-sided nuclear-to-turbine mismatch in kelvin through the programme's own
   slope, into a velocity PID on the plant's measured T-avg rate, onto the rod
   drive. Expression for expression the law step() carried, so a plant wired
   this way is bit-identical to one that ran it built in. */
function buildRodAuto(cid){
  const tavg=blkMk("source",{sig:"tavg",arg:cid}), tprog=blkMk("source",{sig:"tprog",arg:cid});
  const e0=blkMk("math",{op:"sub"},[tavg,tprog]);
  const n=blkMk("source",{sig:"nfr",arg:cid}), tf=blkMk("source",{sig:"tfrac",arg:cid});
  const m0=blkMk("math",{op:"sub"},[n,tf]);
  const m1=blkMk("limit",{lo:0},[m0]);
  const m2=blkMk("math",{op:"add",k:TPROG_SPAN},[m1]);
  const e1=blkMk("math",{op:"add"},[e0,m2]);
  const e=blkMk("limit",{lo:-6,hi:6},[e1]);
  const rate=blkMk("source",{sig:"dtavg",arg:cid});
  const pid=blkMk("pid",{db:AUTOROD_DB,n:AUTOROD_N},[e,rate]);
  blkMk("sink",{sink:"rodStep",arg:cid},[pid]);
}
/* The feed regulating valve: the shell's feed against what its level programme
   asks, made relative to what it is boiling (FREG_SPAN floors the divisor),
   clamped, integrated at the valve's own stroke. The graph reads the previous
   tick's steam and level where the built-in law read this tick's, so it
   follows one tick behind it - measured, see the plan. */
function buildFeedAuto(sgId){
  const fed=blkMk("source",{sig:"sgfed",arg:sgId}), want=blkMk("source",{sig:"sgwant",arg:sgId});
  const a=blkMk("math",{op:"sub"},[fed,want]);
  const span=blkMk("const",{v:FREG_SPAN});
  const b=blkMk("math",{op:"max"},[want,span]);
  const e=blkMk("math",{op:"div"},[a,b]);
  const el=blkMk("limit",{lo:-1,hi:1},[e]);
  const pid=blkMk("pid",{kp:1,ti:FREG_STROKE,td:0,db:0},[el]);
  const pos=blkMk("integ",{lo:0,hi:1},[pid]);
  blkMk("sink",{sink:"freg",arg:sgId},[pos]);
}
/* A relief valve's pressure controller: lift above one setpoint, reseat below
   the other. The setpoints are READ off the valve (SIGNAL.fitlift/fitreseat),
   never copied: the valve's own panel stays the one place they are stated. */
const reliefFitIdsD = () => Object.keys(D.fittings).filter(f=>D.fittings[f].mode==="relief" && !D.fittings[f].spring);
function buildReliefAuto(fid){
  const p=blkMk("source",{sig:"fitp",arg:fid});
  const lift=blkMk("source",{sig:"fitlift",arg:fid}), reseat=blkMk("source",{sig:"fitreseat",arg:fid});
  const c=blkMk("compare",{},[p,lift,reseat]);
  blkMk("sink",{sink:"relief",arg:fid},[c]);
}
function buildStockAutomation(){
  for(const k in D.blocks) delete D.blocks[k];      // a preset states the whole cabinet; emptied in place, never rebuilt
  for(const id of coreIds()) (coreBoils(id) ? buildFlowAuto : buildRodAuto)(id);
  for(const id of sgIds()) if(pumpIds().some(p=>secGensOf(p).includes(id))) buildFeedAuto(id);
  for(const fid of reliefFitIdsD()) buildReliefAuto(fid);
}
/* ══ THE BOILING PLANT STEERS ON FLOW ══ recirculation sweeps void out of the
   core and void is the reactivity, so a BWR follows load with its pumps and
   leaves the rods where they are: turbine load against reactor power, a PI in
   velocity form, integrated into a pump demand every coolant pump shares.
   35 % floors the demand above the LOW FLOW trip (P.flowMin, 0.30 at one pump
   per generator) so the controller cannot trip the plant it is steering. */
const coreBoils = id => COOLANT[coreD(id).cool].id==="BWR";
function buildFlowAuto(cid){
  const load=blkMk("source",{sig:"load"}), pwr=blkMk("source",{sig:"pwr",arg:cid});
  const e=blkMk("math",{op:"sub"},[load,pwr]);
  const pid=blkMk("pid",{kp:1,ti:15,td:0,db:0},[e]);
  const dem=blkMk("integ",{lo:35,hi:100},[pid]);
  for(const p of pumpIds()) if(primaryPump(p)) blkMk("sink",{sink:"flowDem",arg:p},[dem]);
}
