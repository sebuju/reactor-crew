#!/usr/bin/env node
/* reactor-crew SANDBOX.

   A rig for isolating one piece of the plant and driving it on its own, so a
   question about the pressure network does not cost a ten minute whole-plant
   run. It carries no assertions, exactly like tools/probe.js: it PRINTS what
   the plant did and a human reads it.

   Three instruments, and every one of them is an ordinary machine with an
   ordinary knob - there are no sandbox-only physics anywhere in src/:

     SOURCE   a tank with `inf` and a gas charge, so it pushes at a stated MPa
              and never runs down - its level cannot move, so the gas law is
              exactly p0 and there is no drift in it at all.
     VOID     the same tank at compartment pressure, so whatever reaches it
              leaves and it never fills.
     CLAMP    a field of S written back every tick. This is the only thing
              here that is not a machine, and it is deliberately a DEBUG
              instrument rather than a component: pinning s.Tavg is not
              something a plant can do, it is something an experimenter does
              to one.

   Output is CSV on stdout, one row per sample, rounded to what the reading is
   worth. Rows are cheap to read and cheap to diff. `--trace` instead writes
   the whole network - topology and per-sample field - to tools/sandbox/out/,
   for tools/sandbox/netview.html to paint two of side by side.

   THE SEED IS FIXED, ALWAYS. resetPlant() picks a seed off Math.random(), so
   two runs of one profile were not comparable and a trace diff meant nothing.
   Every run reseeds with --seed (default 1) the moment commission() returns,
   and --dice=off stands the whole table down.

   Usage:  node tools/sandbox/sandbox.js [profile ...] [options]
     --list            print every profile name
     --secs=N          how long to fly (default 60)
     --every=N         seconds between printed rows (default 5)
     --seed=N          the run's own seed (default 1)
     --dice=off|on     stand the dice table down (default on)
     --trace           write tools/sandbox/out/<profile>.js instead of CSV
     --shut=T:portId   act("portShut", portId) at T seconds
     --hit=T:partId    act("hit", partId)
     --burst=T:x,y     act("hit", "pipe:x,y") - open one pipe cell
     --blackout=T      act("blackout", true)
*/
const {headless} = require('../bundle');
const M = headless(
 '{commission,resetPlant,step,derived,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,mintTank,addPortAt,seedPort,seedRun,pipeLay,'+
 'buildLayout,buildStockPlumbing,latDefault,pipeMap,pipeNetwork,nodeGraph,'+
 'tankCircuit,tankPrimary,tankIds,tankKg,tankLvl,tankP,tankLive,partOf,partName,'+
 'holdTankIds,holdOnCirc,holdCircs,holdSetP,holdLive,holdPlumbed,loopP,setLoopP,'+
 'netTempAt,netQualAt,mwE,loopKg,secP,sgIds,sgLvl,circName,ROLE:()=>ROLE,'+
 'netKgs,radIds,invRate,tankMass,layoutMetrics,designIssues,'+
 /* THE HARNESS GIVES ORDERS THE WAY A PLAYER DOES. act() is the one dispatch
    (record.js) and a replay sees exactly what the sandbox did; poking S would
    be an order no tape carries. seedRng is what makes two runs comparable at
    all, and netSolve/netPressures/netField are the network readings a trace
    is made of. */
 'act,seedRng,netSolve,netPressures,netField,netFlowK,partWrecked,portWrecked}');

const D = M.D();
const BASE = JSON.parse(JSON.stringify(D));

/* ══ THE RIG ══ every helper here builds through the same calls the bench's
   own gestures make: mintTank(), seedPort(), seedRun(). Nothing is baked. */
const RIG = {
  /* An inexhaustible tank. `p` is what is behind it in MPa - high makes it a
     SOURCE and near-zero makes it a VOID, which is the same machine answering
     the same solve from the two ends. */
  tank(id, x, y, p, cfg){
    M.mintTank(id, x, y);
    Object.assign(D.tanks[id], {name:id.toUpperCase(), col:"#8fd18a", vol:100, level:50,
      inf:true, check:false, auto:"always", burst:null, hold:null,
      gas:{p0:p, frac:0.35}}, cfg||{});
    M.buildLayout();
    return id;
  },
  source(id, x, y, p, cfg){ return RIG.tank(id, x, y, p, Object.assign({col:"#5fd2e2"}, cfg)); },
  // a VOID is a place at COMPARTMENT pressure, not a vacuum - the same floor
  // every vented vessel on the plant sits at
  void_ (id, x, y, cfg){ return RIG.tank(id, x, y, 0.15, Object.assign({col:"#7a6f9a"}, cfg)); },
  // one nozzle on a face, and one run to another port - the two bench gestures
  port(id, dx, dy){ return M.seedPort(id, dx, dy); },
  run(a, b, vFirst, vias){ return M.seedRun(a, b, vFirst, vias); },
  // a fitting in a stated mode, which is the only thing that tells a tee from
  // a valve - there is no fitting KIND to pick
  fit(x, y, mode, name){
    const id = M.addFitting(x, y);
    if(id == null){ console.log("# rig: no fitting at "+x+","+y); return null; }
    D.fittings[id].mode = mode || "tee";
    if(name) D.fittings[id].name = name;
    M.buildLayout();
    return id;
  },
  /* A RIG PIPE IS RATED FOR WHAT THE RIG PUSHES. runBurstP() asks every run
     every tick, and a wall is SUGGESTED off the plant's own setpoint - so on a
     rig with no reactor on the board the suggestion is thin, and a boundary at
     16 MPa split the line on the second tick and took the whole topology with
     it. D.wall is the knob the PIPES panel writes; this is the same knob. */
  wall(mm){ M.buildLayout(); D.wall = D.wall || {};
    for(const k in M.pipeMap().byKey) D.wall[k] = mm; },
  machine(kind, x, y){ const id = M.addMachine(kind, x, y);
    if(id == null) console.log("# rig: no "+kind+" at "+x+","+y);
    M.buildLayout(); return id; },
};

/* ══ CLAMPS ══ a list of [path, value]; written onto S before every tick, so
   whatever the sim does to that field is undone and the rest of the plant is
   solved against a held boundary. Dotted paths and one level of index only -
   "Tavg", "sgTBy.sg0". */
let CLAMPS = [];
const clampSet = (s, path, v) => {
  const i = path.indexOf(".");
  if(i < 0){ s[path] = v; return; }
  const o = s[path.slice(0,i)];
  if(o) o[path.slice(i+1)] = v;
};
const clamp_ = (path, v) => CLAMPS.push([path, v]);

/* ══ WHAT A ROW SAYS ══ a column is a name and a reader, so a profile states
   exactly the readings its own question needs and pays for nothing else.
   `dp` is what the reading is worth: a pressure to 3 dp is 1 Pa, a level to
   1 dp is a millimetre in a tall vessel, and a temperature to 1 dp is past
   anything the model claims. */
const COL = {
  t:      {dp:1, f:(s,t)=>t},
  P:      {dp:3, f:s=>s.P},
  lvl:    {dp:1, f:s=>s.lvl},
  inv:    {dp:2, f:s=>s.inv},
  Tavg:   {dp:1, f:s=>s.Tavg},
  sc:     {dp:1, f:s=>s.sc},
  mwe:    {dp:1, f:s=>M.mwE(s)},
  n:      {dp:3, f:s=>s.n},
  vf:     {dp:3, f:s=>s.vf},
  rel:    {dp:4, f:s=>s.release},
  brk:    {dp:0, f:s=>s.breach?1:0},
};
// one column per named thing, built on demand so a profile names its own
const colP    = ci => ({dp:3, f:s=>M.loopP(s,ci)});
const colTank = id => ({dp:1, f:s=>M.tankLvl(s,id)});
const colTankP= id => ({dp:3, f:s=>M.tankP(s,id)});
const colRate = id => ({dp:4, f:s=>(s.tankRate&&s.tankRate[id])||0});
const colNodeT= n  => ({dp:1, f:s=>M.netTempAt(s,n)});
const colNodeX= n  => ({dp:3, f:s=>M.netQualAt(s,n)});
const colNodeP= n  => ({dp:4, f:s=>{ const o=M.netPressures(s); return o[n]===undefined?null:o[n]; }});
const colSgT  = id => ({dp:1, f:s=>s.sgTBy&&s.sgTBy[id]});
const colSecP = id => ({dp:3, f:s=>M.secP(s,id)});
const colHold = ci => ({dp:0, f:s=>M.holdLive(M.P().net,s,ci)?1:0});
/* WHAT THIS TANK'S OWN EDGES CARRY, in the solve's own current and positive
   out of the tank. s.tankRate is that same figure as a PERCENTAGE OF LOOP
   INVENTORY, so on a rig with no reactor loop P.netRef is 0 and invRate()
   answers 0 - honestly, and uselessly for a hydraulics question. */
const colTankQ = id => ({dp:4, f:s=>{ const net = M.P().net;
  const i = net && net.tankNode && net.tankNode[id];
  if(i === undefined || i === null) return null;
  const sol = M.netSolve(net, s);
  let q = 0;
  for(let e=0;e<net.edges.length;e++){ const ed = net.edges[e];
    if(ed.u === i) q += sol.q[e]; else if(ed.v === i) q -= sol.q[e]; }
  return q; }});
// how many nodes, edges and structural components this plant actually built -
// the three figures every nonsense profile is really asking about
const colNet = {
  nodes: {dp:0, f:()=>{ const n=M.P().net; return n?n.n:0; }},
  edges: {dp:0, f:()=>{ const n=M.P().net; return n?n.edges.length:0; }},
  comps: {dp:0, f:()=>{ const n=M.P().net; return n?n.nComp:0; }},
  live:  {dp:0, f:s=>{ const n=M.P().net; if(!n) return 0; let c=0;
    for(const ed of n.edges){ const g = typeof ed.g==="function"?ed.g(s):ed.g; if(g>0) c++; }
    return c; }},
  flowK: {dp:4, f:s=>M.netFlowK(s, null, null, {noNat:true})},
};

const fmt = (v,dp) => (v===null||v===undefined||Number.isNaN(v)) ? ""
                    : (Math.round(v*Math.pow(10,dp))/Math.pow(10,dp)).toFixed(dp);

const CTX = {M, D, RIG, COL, colP, colTank, colTankP, colRate, colTankQ, colNodeT, colNodeX,
             colNodeP, colSgT, colSecP, colHold, colNet, clamp_};

/* ══ PROFILES ══ disposable, exactly like probe.js's cases. Each one isolates
   ONE question. Add one, read it, delete it. */
const PROFILES = Object.assign({}, require('./plant')(CTX), require('./net')(CTX));

/* ══ EVENTS ══ the same overlay any profile can be flown with, so one topology
   is seen clean and hurt without a second profile that differs in two ways at
   once. EVERY ONE GOES THROUGH act(): an order the harness gives by hand is an
   order a replay never sees, and this rig exists to be believed. */
function parseEvents(args){
  const out = [];
  const add = (t, kind, arg) => out.push({t:+t, kind, arg});
  for(const a of args){
    const m = /^--(shut|hit|burst|blackout)=(.*)$/.exec(a);
    if(!m) continue;
    const kind = m[1], v = m[2];
    if(kind === "blackout"){ add(v, "blackout", true); continue; }
    const i = v.indexOf(":");
    if(i < 0){ console.log("# event needs T:arg - "+a); continue; }
    add(v.slice(0,i), kind, v.slice(i+1));
  }
  return out.sort((a,b)=>a.t-b.t);
}
const fireEvent = e => {
  /* SAID OUT LOUD. act() declines an order for a machine this plant has not
     got, quietly and correctly - so an event that named a cell with no pipe in
     it used to look exactly like an event that did nothing. */
  console.log("# t="+e.t.toFixed(1)+" "+e.kind+" "+e.arg);
  if(e.kind === "blackout") M.act("blackout", true);
  else if(e.kind === "shut") M.act("portShut", e.arg);
  else if(e.kind === "hit")  M.act("hit", e.arg);
  else if(e.kind === "burst")M.act("hit", "pipe:"+e.arg);
};

/* ══ ONE RUN ══ reset D to what it shipped as, build, commission, RESEED, fly.
   The reseed is after commission() because that is where resetPlant() rolls
   its own, and a profile that is not reseeded is not comparable to itself. */
function setup(spec, v, opt){
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  CLAMPS = []; M.latDefault();
  const note = spec.build(RIG, v) || {};
  M.buildLayout(); M.commission();
  const s = M.S();
  M.seedRng(s, opt.seed);
  s.diceOff = opt.dice === false;
  return {s, note};
}

/* ══ SWEEPS ══ a profile with a `sweep` runs once per value and prints ONE
   settled row each, which is the tightest honest shape for "what does this
   knob do". Everything else prints a time series. */
function flyOne(key, opt){
  const spec = PROFILES[key]();
  const evs = opt.events;
  if(spec.sweep){
    console.log("# "+spec.name);
    let names = null;
    for(const v of spec.sweep){
      const {s} = setup(spec, v, opt);
      const C = spec.cols(), n = Math.round(opt.secs*50);
      if(!names){ names = Object.keys(C); console.log(names.join(",")); }
      let ei = 0;
      for(let i=0;i<n;i++){
        for(const [p,val] of CLAMPS) clampSet(s,p,val);
        while(ei < evs.length && evs[ei].t <= i/50) fireEvent(evs[ei++]);
        if(spec.at && spec.at[i/50]) spec.at[i/50](s);
        M.step(0.02); if(s.breach) break;
      }
      console.log(names.map(k=>fmt(C[k].f(s, opt.secs), C[k].dp)).join(","));
    }
    return;
  }
  const {s, note} = setup(spec, undefined, opt);
  const C = Object.assign({t:COL.t}, spec.cols());
  const names = Object.keys(C);
  const TR = opt.trace ? require('./trace').open(M, key, spec, opt) : null;
  if(!TR){
    console.log("# "+spec.name+(note.note?"  ("+note.note+")":""));
    console.log(names.join(","));
  }
  const n = Math.round(opt.secs*50), step = Math.max(1, Math.round(opt.every*50));
  let ei = 0;
  for(let i=0;i<=n;i++){
    for(const [p,v] of CLAMPS) clampSet(s,p,v);
    while(ei < evs.length && evs[ei].t <= i/50) fireEvent(evs[ei++]);
    if(spec.at && spec.at[i/50]) spec.at[i/50](s);
    if(i%step===0){
      if(TR) TR.sample(s, i/50);
      else console.log(names.map(k=>{ const c=C[k];
        let v; try{ v=c.f(s,i/50); }catch(e){ v=NaN; }
        return fmt(typeof v==="boolean"?(v?1:0):v, c.dp); }).join(","));
    }
    if(i<n) M.step(0.02);
    if(s.breach){ if(!TR) console.log("# breach at t="+(i/50).toFixed(1)); break; }
  }
  if(TR) console.log("# wrote "+TR.close());
}

const args  = process.argv.slice(2);
const str   = (f,d) => { const a=args.find(x=>x.indexOf(f)===0);
                         return a ? a.split("=")[1] : d; };
const num   = (f,d) => { const v = str(f,null); return v===null ? d : +v; };
if(args.indexOf("--list") >= 0){ console.log(Object.keys(PROFILES).join("\n")); process.exit(0); }
const opt = {secs:num("--secs=",60), every:num("--every=",5), seed:num("--seed=",1),
             dice:str("--dice=","on")!=="off", trace:args.indexOf("--trace")>=0,
             events:parseEvents(args)};
const pick  = args.filter(a => a[0] !== "-");
for(const k of (pick.length ? pick : Object.keys(PROFILES))){
  if(!PROFILES[k]){ console.log("# no profile named "+k+" (--list)"); continue; }
  flyOne(k, opt);
  console.log("");
}
