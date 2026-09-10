"use strict";
/* the design is D.blocks[id], the live block s.blkBy[id], evaluated once per tick on the previous tick's solved values */

/* ins names the slots, knobs their defaults, st the state a block carries beside its output; a knob meaning "none" is null */
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
  compare:{lab:"COMPARE", ins:["IN","ON","OFF"], knobs:{op:"above", on:1, off:0},
    tip:"ABOVE: 1 once IN rises above on, 0 once it falls below off. BELOW turns both round, which is what a low trip is. The gap between on and off is the hysteresis that stops it chattering; equal points is a bare threshold. Wire ON or OFF and the setpoint is read live from there instead of from the knob - a relief valve's own lift point, or a protection channel's own trip set.",
    ktip:{on:"The value IN must pass for the output to go to 1. Ignored while the ON slot is wired.",
      off:"The value IN must come back past for the output to go to 0. Leave it equal to the on point for a bare threshold. Ignored while the OFF slot is wired."}},
  latch:  {lab:"LATCH",   ins:["SET","RESET"], knobs:{},
    tip:"Seal-in. SET makes it 1 and it stays 1 until RESET. RESET wins if both are up. What a trip is."},
  sel:    {lab:"SELECT",  ins:["A","B","C"],   knobs:{op:"max"},
    tip:"max, min or median of what is wired. Three transmitters into a median is how a plant votes a liar out."},
  sink:   {lab:"SINK",    ins:["IN"],          knobs:{sink:"loadDem", arg:null},
    tip:"An actuator. What arrives at IN is written to the plant, in the sink's own unit. While it is wired and on, the block owns that demand and the strip says so."},
};
const BLK_MODES=Object.keys(BLK);
const MATH_OPS=["add","sub","mul","div","min","max"], SEL_OPS=["max","min","median"], CMP_OPS=["above","below"];
const OPS_OF={math:MATH_OPS, sel:SEL_OPS, compare:CMP_OPS};

/* every demand a block may drive, in the unit the matching SIGNAL row reads; `step` marks a sink that integrates the increment itself */
const SINK={
  rodStep:{lab:"ROD DRIVE", u:"/tick", scope:"core", step:true, part:id=>rodsOf(id),
    read:(s,id)=>coreSeen(s,id).rodDem,
    apply:(s,id,v,dt)=>{ coreOn(s,id,(cs,K)=>rodApply(s,cs,K,v,dt)); }},
  freg:   {lab:"FEED VALVE", u:"", scope:"sg", part:id=>id,
    read:(s,id)=>s.fregBy[id]||0,
    apply:(s,id,v)=>{ if(s.fregDemBy[id]!==undefined) s.fregDemBy[id]=clamp(v,0,1); }},
  relief: {lab:"RELIEF VALVE", u:"", scope:"fit", part:fid=>fid,
    read:(s,fid)=>s.reliefOpen[fid]?1:0,
    apply:(s,fid,v)=>{ if(s.reliefOpen[fid]!==undefined && !fitSpring(fid)) reliefCmd(s,fid,v>0.5); }},   // a spring safety takes no orders; an absent valve is a no-op, not a phantom key on S
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
  /* the order waits out P.rpsLag of continuous demand and the timer resets the instant the channel clears: a delay, not an integrator */
  scram:  {lab:"SCRAM", u:"", scope:"core", part:id=>id,
    read:(s,id)=>coreSeen(s,id).scrammed?1:0,
    apply:(s,id,v,dt)=>{ const hot=v>0.5;
      coreOn(s,id,c=>{ c.rpsHot = hot ? c.rpsHot+dt : 0; });
      const cs=coreSeen(s,id);
      /* to the nearest tick: ten additions of 0.02 come to 0.19999999999999998, so a 200 ms setting would ask for an eleventh */
      if(hot && !cs.scrammed && cs.rpsHot>=P.rpsLag-dt*0.5) rpsScram(id,blkBlame(s,sinkDriver(s,"scram",id))); }},
  /* the warning is an actuator too, never a read out of the middle of a graph the player may rewire */
  nearTrip:{lab:"NEAR TRIP LAMP", u:"", scope:"core", part:id=>id,
    read:(s,id)=>coreSeen(s,id).rpsNear?1:0,
    apply:(s,id,v)=>{ coreOn(s,id,cs=>{ cs.rpsNear=v>0.5; }); }},
  /* a one-shot on the rising edge: held, the operator could never raise load again while the latch was in */
  runback:{lab:"TURBINE RUNBACK", u:"", scope:"plant", part:()=>roleId("turb"),
    read:s=>s.rbHot?1:0,
    apply:(s,_,v)=>{ const hot=v>0.5; if(hot && !s.rbHot) runbackNow(s); s.rbHot=hot; }},
};
const SINK_KEYS=Object.keys(SINK);

/* which instances a scope may name; `plant` names none */
function sigArgs(scope){
  switch(scope){
    case "core": return coreIds();
    case "sg":   return boilerIds();
    case "pump": return pumpIds();
    case "fit":  return Object.keys(D.fittings);   // D, not P: on the bench P is the LAST plant commissioned
    case "rpsch":return RPS_CH.map(r=>r[0]);
    case "tank": return tankIds();
    case "loop": { const n=nodeGraph().nCirc; const a=[]; for(let i=0;i<n;i++) a.push(String(i)); return a; }
    default: return [];
  }
}
const sigArg0=scope=>{ const a=sigArgs(scope); return a.length?a[0]:null; };

/* a section is a named set of blocks: it picks the tab a block is drawn under and is design only, nothing on S has an opinion about it */
const SEG_LAB="SECTION";
function segIds(){ if(!Array.isArray(D.segs)||!D.segs.length) D.segs=["g1"]; return D.segs; }
const segName = sid => nameFor(sid, SEG_LAB+" "+(segIds().indexOf(sid)+1));
/* there is no such thing as a block in no section */
const segOf = id => { const b=D.blocks[id], a=segIds();
  return (b && a.includes(b.seg)) ? b.seg : a[0]; };
function segMint(name){
  let n=1; while(segIds().includes("g"+n)) n++;
  const sid="g"+n; D.segs.push(sid); if(name) setPartName(sid,name);
  dTouch(); return sid;
}
/* a tab is a view, so closing one must not delete automation: the blocks come home to the first section */
function segRemove(sid){
  const a=segIds(); if(a.length<2) return false;
  const i=a.indexOf(sid); if(i<0) return false;
  a.splice(i,1);
  for(const k in D.blocks) if(D.blocks[k].seg===sid) D.blocks[k].seg=a[0];
  if(D.name) delete D.name[sid];
  if(D.note) delete D.note[sid];
  dTouch(); return true;
}
/* bench gestures, never through act() */
function mintBlock(mode,seg){
  let n=1; while(D.blocks["b"+n]) n++;
  const id="b"+n, m=BLK[mode]||BLK.const;
  D.blocks[id]=Object.assign({mode, in:m.ins.map(()=>null), on:true, seg:seg||segIds()[0]}, m.knobs);
  if(mode==="source") D.blocks[id].arg=sigArg0(SIGNAL[D.blocks[id].sig].scope);
  if(mode==="sink")   D.blocks[id].arg=sigArg0(SINK[D.blocks[id].sink].scope);
  dTouch(); return id;
}
function removeBlock(id){
  delete D.blocks[id];
  if(D.name) delete D.name[id];   // mintBlock() reuses b<n>, so a dead block's name must not be inherited by the next one
  if(D.note) delete D.note[id];

  for(const k in D.blocks){ const b=D.blocks[k]; for(let i=0;i<b.in.length;i++) if(b.in[i]===id) b.in[i]=null; }
  dTouch();
}
/* a mode change keeps the id, the section and the wiring slots that still exist */
function setBlockMode(id,mode){
  const b=D.blocks[id]; if(!b||!BLK[mode]) return;
  const m=BLK[mode], nb=Object.assign({mode, in:m.ins.map((_,i)=>b.in[i]||null), on:b.on!==false, seg:segOf(id)}, m.knobs);
  if(mode==="source") nb.arg=sigArg0(SIGNAL[nb.sig].scope);
  if(mode==="sink")   nb.arg=sigArg0(SINK[nb.sink].scope);
  D.blocks[id]=nb; dTouch();
}

function blkSeed(){
  const out={};
  for(const id in D.blocks){ const b=D.blocks[id], m=BLK[b.mode]; if(!m) continue;
    const L=Object.assign({mode:b.mode, in:m.ins.map((_,i)=>b.in[i]||null), on:b.on!==false, out:0}, m.knobs, m.st||{});
    for(const k in m.knobs) if(b[k]!==undefined) L[k]=b[k];
    if(m.sug) for(const k in m.sug) if(L[k]==null) L[k]=m.sug[k]();
    out[id]=L; }
  return out;
}
/* bumpless: a position-holding block starts where its sink already stands, so a wire landing is not a step */
function blkSeedOut(s,id){
  const b=s.blkBy[id]; if(!b || b.mode!=="sink") return;
  const src=b.in[0], u=src&&s.blkBy[src], row=SINK[b.sink];
  if(!u || !row || row.step) return;
  if(u.mode==="integ"||u.mode==="limit"||u.mode==="lag"){ const v=row.read(s,b.arg); if(isFinite(v)) u.out=v; }
}
const blkSeedOuts=s=>{ for(const id in s.blkBy) blkSeedOut(s,id); };

/* Kahn over the live links, cached on their signature; a block left on a cycle reads last tick's outputs */
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

/* is the cabinet computing: a controller placed, whole, and fed */
const ctlHost = () => roleId("ctrl");
const ctlLive = s => { const id=ctlHost(); return !!id && !partWrecked(s,id) && supplyK(s)>0; };
const blkDead = (s,b) => { const row=SINK[b.sink]; if(!row) return true;
  const part=row.part(b.arg); return !!part && partWrecked(s,part); };

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
      return b.op==="below" ? (b.out ? (I[0] > off ? 0 : 1) : (I[0] < on ? 1 : 0))
                            : (b.out ? (I[0] < off ? 0 : 1) : (I[0] > on ? 1 : 0)); }
    case "latch":  return I[1]>0.5 ? 0 : I[0]>0.5 ? 1 : b.out;
    case "sel": { const w=[]; b.in.forEach((src,i)=>{ if(src) w.push(I[i]); }); if(!w.length) return 0;
      if(b.op==="min") return Math.min(...w); if(b.op==="max") return Math.max(...w);
      w.sort((p,q)=>p-q); return w[(w.length-1)>>1]; }
    case "sink": { const row=SINK[b.sink]; if(row && !blkDead(s,b)) row.apply(s,b.arg,I[0],dt); return I[0]; }
  }
  return b.out;
}

/* at the head of the tick; off, wrecked or dark, every output holds and no sink is written */
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

/* a block switched off is still the block wired to this demand, so `on` is the caller's question; a live block wins over a switched-off peer */
function sinkWired(s,sink,arg,onOnly){
  if(!s||!s.blkBy||!ctlLive(s)) return null;
  let off=null;
  for(const id in s.blkBy){ const b=s.blkBy[id];
    if(b.mode!=="sink" || b.sink!==sink || !(b.arg==null||b.arg===arg) || !b.in[0] || !s.blkBy[b.in[0]]) continue;
    if(b.on) return id;
    if(!off) off=id; }
  return onOnly ? null : off;
}
const sinkDriver = (s,sink,arg) => sinkWired(s,sink,arg,true);
/* the deepest hot input the player has named, so a trip's word comes out of the drawn graph and not a table */
function blkBlame(s,id,seen){
  if(!id||!s||!s.blkBy) return "";
  seen=seen||new Set(); if(seen.has(id)) return ""; seen.add(id);
  const b=s.blkBy[id]; if(!b) return "";
  /* any source reads "hot" against a zero-or-one test, so the walk would blame the transmitter */
  if(b.mode==="source"||b.mode==="const") return "";
  for(const src of b.in){ const u=src&&s.blkBy[src];
    if(!u || !(u.out>0.5)) continue;
    const deep=blkBlame(s,src,seen); if(deep) return deep; }
  return nameFor(id,"");
}
/* the label on a wire: the signal's own name and unit where one forces it, the block's kind otherwise */
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

/* built out of the same blocks the player has, so a preset cannot wire a controller the player could not; blkMk() drops into whichever section is open */
let SEG_CUR=null;
function inSeg(name,fn,note){ const was=SEG_CUR, sid=segMint(name); SEG_CUR=sid; if(note) setNote(sid,note);
  // a controller that declined to build (no turbine, say) leaves no empty tab behind
  try{ fn(); } finally { SEG_CUR=was; if(!segHas(sid)) segRemove(sid); } }
const segHas = sid => Object.keys(D.blocks).some(k=>D.blocks[k].seg===sid);
function blkMk(mode,knobs,ins,note){
  const id=mintBlock(mode,SEG_CUR); Object.assign(D.blocks[id],knobs||{});
  if(ins) ins.forEach((src,i)=>{ if(src) D.blocks[id].in[i]=src; });
  if(note) setNote(id,note);
  return id;
}
/* expression for expression the law step() carried, so a plant wired this way is bit-identical to one running it built in */
function buildRodAuto(cid){
  const tavg=blkMk("source",{sig:"tavg",arg:cid},null,"The coolant temperature this loop steers: the average of hot and cold leg, measured."),
        tprog=blkMk("source",{sig:"tprog",arg:cid},null,"Where that average is meant to sit at the load being asked for. A programme, not a fixed setpoint.");
  const e0=blkMk("math",{op:"sub"},[tavg,tprog],"The temperature error itself: measured minus programmed. Positive means the core is running hot.");
  const n=blkMk("source",{sig:"nfr",arg:cid},null,"What the core is making, as a fraction of its rating."),
        tf=blkMk("source",{sig:"tfrac",arg:cid},null,"What the turbine is taking, as a fraction of the same rating.");
  const m0=blkMk("math",{op:"sub"},[n,tf],"Nuclear against turbine. Positive means the core is making more heat than the turbine is taking away.");
  const m1=blkMk("limit",{lo:0},[m0],"Only the positive half of that mismatch. A turbine taking more than the core makes is answered by temperature alone.");
  const m2=blkMk("math",{op:"add",k:TPROG_SPAN},[m1],"The mismatch turned into kelvin, through the programme's own slope, so it can be added to a temperature error.");
  const e1=blkMk("math",{op:"add"},[e0,m2],"The whole error the rods answer: temperature error plus the mismatch the plant has not shown as temperature yet.");
  const e=blkMk("limit",{lo:-6,hi:6},[e1],"Clamped to six kelvin either way, so one transient cannot ask for full rod speed.");
  const rate=blkMk("source",{sig:"dtavg",arg:cid},null,"How fast that temperature is moving, measured. It is what stops the loop hunting.");
  const pid=blkMk("pid",{db:AUTOROD_DB,n:AUTOROD_N},[e,rate],"Velocity form: it puts out rod steps, not a rod position. Blank gains take the plant's own rod tune.");
  blkMk("sink",{sink:"rodStep",arg:cid},[pid],"Drives this core's rod drive. Switch it off and the rods hold wherever they are.");
}
/* reads the previous tick's steam and level where the built-in law read this tick's, so it follows one tick behind it */
function buildFeedAuto(sgId){
  const fed=blkMk("source",{sig:"sgfed",arg:sgId},null,"Feedwater going into this generator right now."),
        want=blkMk("source",{sig:"sgwant",arg:sgId},null,"What its level programme asks for: roughly what it is boiling off.");
  const a=blkMk("math",{op:"sub"},[fed,want],"Feeding too much or too little, in kilograms a second.");
  const span=blkMk("const",{v:FREG_SPAN},null,"A floor under the divisor below, so a generator boiling almost nothing cannot make the error enormous.");
  const b=blkMk("math",{op:"max"},[want,span],"What the error is measured against: the demand, or the floor, whichever is bigger.");
  const e=blkMk("math",{op:"div"},[a,b],"The error made relative, so the same valve tune works at any power.");
  const el=blkMk("limit",{lo:-1,hi:1},[e],"Clamped to plus or minus one: a bigger error than that is still just fully shut or fully open.");
  const pid=blkMk("pid",{kp:1,ti:FREG_STROKE,td:0,db:0},[el],"Integral time is the valve's own stroke, so it never asks for a move faster than the valve can make.");
  const pos=blkMk("integ",{lo:0,hi:1},[pid],"The valve position those increments add up to, shut to wide open.");
  blkMk("sink",{sink:"freg",arg:sgId},[pos],"Drives this generator's feed regulating valve.");
}
/* A DIRECT CYCLE has no shell between the core and the machine, so the turbine governor is what holds the loop's pressure: power is set by the rods and the pumps, and the load follows. */
function buildPressAuto(ci){
  const p=blkMk("source",{sig:"loopp",arg:String(ci)},null,"The pressure in the loop the turbine is taking its steam off."),
        set=blkMk("source",{sig:"loopset",arg:String(ci)},null,"What that loop is designed to sit at, read off the drawing. Nothing here states a number.");
  const a=blkMk("math",{op:"sub"},[p,set],"Over or under pressure, in megapascals. Positive means the boiler is raising more than the machine is taking.");
  const e=blkMk("math",{op:"div"},[a,set],"The error made relative, so the same tune works whatever the loop is designed at.");
  const el=blkMk("limit",{lo:-1,hi:1},[e],"Clamped: a bigger error than the setpoint itself is still just wide open or shut.");
  const pid=blkMk("pid",{kp:PRESS_KP,ti:PRESS_TI,td:0,db:0},[el],"Velocity form: it puts out load steps. Integral time is the governor's own stroke.");
  const pos=blkMk("integ",{lo:0,hi:100},[pid],"The load demand those steps add up to, in per cent.");
  blkMk("sink",{sink:"loadDem"},[pos],"Drives the turbine governor. Switch it off and the loop rides its own pressure, which on a direct cycle is the reactor's.");
}
/* the setpoints are read off the valve, never copied: its own panel stays the one place they are stated */
const reliefFitIdsD = () => reliefFitsD().filter(f=>!D.fittings[f].spring);
function buildReliefAuto(fid){
  const p=blkMk("source",{sig:"fitp",arg:fid},null,"The pressure at this valve.");
  const lift=blkMk("source",{sig:"fitlift",arg:fid},null,"The valve's own lift point, read off the valve. It is never copied here, so the valve's panel stays the one place it is set."),
        reseat=blkMk("source",{sig:"fitreseat",arg:fid},null,"The valve's own reseat point. The gap up to the lift point is what stops it chattering.");
  const c=blkMk("compare",{},[p,lift,reseat],"Open above the lift point, shut again below the reseat point.");
  blkMk("sink",{sink:"relief",arg:fid},[c],"Drives the valve. This is a power-operated valve, so with the cabinet dark it holds and only a spring safety is left.");
}
/* nothing here states a number: both setpoints are read off RPS_CH through SIGNAL.rpsset/rpsnear */
function blkOr(ids,note){                  // sel takes three, so an OR of many is a tree of them
  while(ids.length>1){ const next=[];
    for(let i=0;i<ids.length;i+=3) next.push(blkMk("sel",{op:"max"},ids.slice(i,i+3),note));
    ids=next; }
  return ids[0];
}
function buildRpsAuto(cid,lab){
  const trip=[], near=[];
  for(const fam of [...new Set(RPS_CH.map(r=>r[7]))]) inSeg(lab+" "+fam, ()=>{
    for(const [key,name,,dir,sig,,gate,f] of RPS_CH){
      if(f!==fam) continue;
      const op=dir>0?"above":"below";
      const v=blkMk("source",{sig,arg:cid},null,"What the "+name.toLowerCase()+" channel watches.");
      for(const [set,out] of [["rpsset",trip],["rpsnear",near]]){
        const t=blkMk("source",{sig:set,arg:key},null,set==="rpsset"
          ? "Where this channel trips. Read off the protection system, so the margin slider moves it and nothing here states a number."
          : "The near-trip point of the same channel: the lamp lights here, well before the scram.");
        let c=blkMk("compare",{op},[v,t,t],"Made when the plant passes the "+name.toLowerCase()+" point. On and off are the same value: a protection channel has no hysteresis, the latch beyond the scram is what stops it chattering.");
        setPartName(c,name);          // the CHANNEL carries the name, so the trip's word is the channel's
        /* the permissive is a compare like any other, ANDed in by multiplying two zero-or-ones */
        if(gate){ const h=blkMk("source",{sig:"heat",arg:cid},null,"How hard this core is making heat. The permissive below reads it.");
          const g=blkMk("compare",{op:"above",on:.3,off:.3},[h],"Above 30% heat this channel is armed; below it the channel is stood down. Low flow does not protect a core that is making nothing.");
          setPartName(g,"HEAT PERMISSIVE");
          c=blkMk("math",{op:"mul"},[c,g],"The channel ANDed with its permissive: two zero-or-ones multiplied, so both must be made."); }
        out.push(c);
      }
    }
  }, "One column per channel of this family: the reading, the channel's own trip point, and a compare that is made when the plant passes it. Nothing here states a number. The compares land on the OR in the logic section.");
  inSeg(lab+" LOGIC", ()=>{
    // the sinks are named too, so the key on the vessel's own strip reads as the system and not as b79
    setPartName(blkMk("sink",{sink:"scram",arg:cid},[blkOr(trip,"Any channel that is made trips the plant: max over the channels is the OR.")],
      "Drops the rods on this core. Switching it off is defeating the protection system, and the plant says so."),"PROTECTION SYSTEM");
    setPartName(blkMk("sink",{sink:"nearTrip",arg:cid},[blkOr(near,"The same OR, on the near points: any channel approaching its trip lights the lamp.")],
      "Lights the near-trip lamp. It only warns; nothing on the plant moves because of it."),"NEAR TRIP");
  }, "The OR over every channel: any one of them trips the plant. A second OR on the near points lights the warning lamp and does nothing else. The wires arrive from the channel sections.");
}
function buildStockAutomation(){
  /* emptied in place; one bare section stays, because a cabinet with none has nowhere to put a block */
  for(const k in D.blocks){ delete D.blocks[k]; if(D.name) delete D.name[k]; if(D.note) delete D.note[k]; }
  for(const sid of segIds()){ if(D.name) delete D.name[sid]; if(D.note) delete D.note[sid]; }
  D.segs=["g1"];
  /* numbered only where there is more than one to tell apart */
  const nm=(lab,i,n)=> n>1 ? lab+" "+(i+1) : lab;
  const cores=coreIds(), feeds=boilerIds().filter(id=>pumpIds().some(p=>secGensOf(p).includes(id))),
        reliefs=reliefFitIdsD();
  /* on a direct cycle the LOAD is the governor's output, so a load-following flow controller would close a loop with nothing at the head of it */
  const direct=drumIds().length>0;
  cores.forEach((id,i)=>inSeg(nm(coreBoils(id)&&!direct?"FLOW CTL":"ROD CTL",i,cores.length),
    ()=>(coreBoils(id)&&!direct?buildFlowAuto:buildRodAuto)(id),
    coreBoils(id)&&!direct
      ? "Follows load with the coolant pumps. Recirculation sweeps void out of a boiling core and the void is the reactivity, so this plant steers on flow and leaves the rods alone."
      : "Holds average coolant temperature on its load programme by moving the rods, with the nuclear-to-turbine mismatch fed forward so the rods start moving before the temperature has."));
  feeds.forEach((id,i)=>inSeg(nm("FEED",i,feeds.length), ()=>buildFeedAuto(id),
    "Keeps this steam generator fed with what it is boiling off, through its own regulating valve. The error is made relative to the demand, so one tune works at any power."));
  if(direct) inSeg("PRESS CTL", ()=>buildPressAuto(nodeGraph().coreCirc),
    "Holds the loop's pressure with the turbine governor. On a direct cycle the machine is the only thing standing between the core and the condenser, so the load follows the steam and power is set by the rods and the pumps.");
  reliefs.forEach((fid,i)=>inSeg(nm("RELIEF",i,reliefs.length), ()=>buildReliefAuto(fid),
    "Opens this power-operated relief valve above its lift point and shuts it below its reseat point. Both are read off the valve itself. It runs on electricity: with the cabinet dark only a spring safety is left."));
  cores.forEach((id,i)=>buildRpsAuto(id,nm("RPS",i,cores.length)));   // makes its own two tabs
  inSeg("RUNBACK", buildRunbackAuto,
    "Sheds turbine load when a reactor trips, so the turbine is not left drawing hard on a dead core.");
  if(!segHas("g1")) segRemove("g1");   // the seed section, if every controller made its own
}
/* the one door presets and headless tools use, so "commissioned with protection off" is stated once */
function scramBlocksOn(on){
  for(const id in D.blocks){ const b=D.blocks[id];
    if(b.mode==="sink" && b.sink==="scram") b.on=!!on; }
  dTouch();
}
/* a protection system is a scram somebody wired, asked of the design the way rpsState() asks it of a running plant */
const scramWiredD = () => Object.keys(D.blocks).some(id=>{
  const b=D.blocks[id]; return b.mode==="sink" && b.sink==="scram"; });
const scramArmedD = () => Object.keys(D.blocks).some(id=>{
  const b=D.blocks[id]; return b.mode==="sink" && b.sink==="scram" && b.on && b.in[0]; });
/* the same order to a plant already running, through act() like every other live change */
function blkSinkOff(s,sink){
  for(const id in s.blkBy){ const b=s.blkBy[id];
    if(b.mode==="sink" && b.sink===sink && b.on) act("blkOn",id); }
}
function buildRunbackAuto(){
  const ids=coreIds(); if(!ids.length || !roleId("turb")) return;
  const t=blkOr(ids.map(id=>blkMk("source",{sig:"trip",arg:id},null,"Whether this reactor has tripped.")),
    "Any reactor tripping is enough: max over the vessels is the OR.");
  const c=blkMk("compare",{op:"above",on:.5,off:.5},[t],"Turns that into the one-shot the runback takes.");
  setPartName(c,"REACTOR TRIPPED");
  setPartName(blkMk("sink",{sink:"runback"},[c],
    "Sheds turbine load the moment a reactor trips. Switch it off and a scram leaves the turbine drawing hard on a dead core, chilling the loop."),"TURBINE RUNBACK");
}
const coreBoils = id => COOLANT[coreD(id).cool].id==="BWR";
function buildFlowAuto(cid){
  const load=blkMk("source",{sig:"load"},null,"What the turbine is being asked for."),
        pwr=blkMk("source",{sig:"pwr",arg:cid},null,"What this core is actually making.");
  const e=blkMk("math",{op:"sub"},[load,pwr],"The gap between the two. A boiling core answers it with flow, because sweeping void out of the core is what adds reactivity.");
  const pid=blkMk("pid",{kp:1,ti:15,td:0,db:0},[e],"Velocity form: it puts out changes of pump demand, not a demand.");
  const dem=blkMk("integ",{lo:35,hi:100},[pid],"The demand those changes add up to. The 35% floor keeps it above the low flow trip, so the controller cannot trip the plant it is steering.");
  for(const p of pumpIds()) if(primaryPump(p)) blkMk("sink",{sink:"flowDem",arg:p},[dem],"Drives this coolant pump. Every primary pump shares the one demand.");
}
