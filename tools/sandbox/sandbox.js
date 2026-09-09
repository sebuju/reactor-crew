#!/usr/bin/env node
// node tools/sandbox/sandbox.js [profile ...] --list --secs=N --every=N --seed=N --dice=off --trace --shut=T:portId --hit=T:partId --burst=T:x,y --blackout=T --scram=T --blkoff=T:sink
const {headless} = require('../bundle');
const M = headless(
 '{commission,resetPlant,step,derived,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,mintTank,addPortAt,seedPort,seedRun,'+
 'buildLayout,buildStockPlumbing,pipeMap,pipeNetwork,nodeGraph,runIdOf,blkSinkOff,'+
 'tankCircuit,tankPrimary,tankIds,tankKg,tankLvl,tankP,tankLive,partOf,partName,'+
 'holdTankIds,holdOnCirc,holdCircs,holdSetP,holdLive,holdPlumbed,loopP,setLoopP,'+
 'netTempAt,netQualAt,mwE,loopKg,secP,sgIds,sgLvl,circName,ROLE:()=>ROLE,'+
 'netKgs,radIds,invRate,tankMass,layoutMetrics,designIssues,'+
 'act,seedRng,netSolve,netPressures,netField,netFlowK,netReading,partWrecked,portWrecked}');

const D = M.D();
const BASE = JSON.parse(JSON.stringify(D));

const RIG = {
  tank(id, x, y, p, cfg){
    M.mintTank(id, x, y);
    Object.assign(D.tanks[id], {name:id.toUpperCase(), col:"#8fd18a", vol:100, level:50,
      inf:true, check:false, auto:"always", burst:null, hold:null,
      gas:{p0:p, frac:0.35}}, cfg||{});
    M.buildLayout();
    return id;
  },
  source(id, x, y, p, cfg){ return RIG.tank(id, x, y, p, Object.assign({col:"#5fd2e2"}, cfg)); },
  // a VOID sits at COMPARTMENT pressure, not a vacuum - the floor every vented vessel sits at
  void_ (id, x, y, cfg){ return RIG.tank(id, x, y, 0.15, Object.assign({col:"#7a6f9a"}, cfg)); },
  port(id, dx, dy){ return M.seedPort(id, dx, dy); },
  run(a, b, vias){ return M.seedRun(a, b, vias); },
  fit(x, y, mode, name){
    const id = M.addFitting(x, y);
    if(id == null){ console.log("# rig: no fitting at "+x+","+y); return null; }
    D.fittings[id].mode = mode || "tee";
    if(name) D.fittings[id].name = name;
    M.buildLayout();
    return id;
  },
  // a rig pipe is rated for what the rig pushes: a suggested wall is thin with no reactor on the board
  wall(mm){ M.buildLayout(); D.wall = D.wall || {};
    const m = M.pipeMap().byKey;
    for(const k in m) D.wall[M.runIdOf(m[k])] = mm; },
  machine(kind, x, y){ const id = M.addMachine(kind, x, y);
    if(id == null) console.log("# rig: no "+kind+" at "+x+","+y);
    M.buildLayout(); return id; },
};

// [path, value] written onto S before every tick; dotted paths, one level only
let CLAMPS = [];
const clampSet = (s, path, val) => {
  const v = typeof val === "function" ? val(s) : val;
  if(v === undefined) return;
  const i = path.indexOf(".");
  if(i < 0){ s[path] = v; return; }
  const o = s[path.slice(0,i)];
  if(o) o[path.slice(i+1)] = v;
};
const clamp_ = (path, v) => CLAMPS.push([path, v]);

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
// kg/s out of the tank: s.tankRate is a percentage of loop inventory, which is 0 on a rig with no loop
const colTankQ = id => ({dp:4, f:s=>{ const net = M.P().net;
  const i = net && net.tankNode && net.tankNode[id];
  if(i === undefined || i === null) return null;
  const sol = M.netSolve(net, s);
  let q = 0;
  for(let e=0;e<net.edges.length;e++){ const ed = net.edges[e];
    if(ed.u === i) q += sol.q[e]; else if(ed.v === i) q -= sol.q[e]; }
  return q; }});
const colNet = {
  nodes: {dp:0, f:()=>{ const n=M.P().net; return n?n.n:0; }},
  edges: {dp:0, f:()=>{ const n=M.P().net; return n?n.edges.length:0; }},
  comps: {dp:0, f:()=>{ const n=M.P().net; return n?n.nComp:0; }},
  live:  {dp:0, f:s=>{ const n=M.P().net; if(!n) return 0; let c=0;
    for(const ed of n.edges){ const g = typeof ed.g==="function"?ed.g(s):ed.g; if(g>0) c++; }
    return c; }},
  flowK: {dp:4, f:s=>M.netFlowK(s, null, null, {noNat:true})},
  nat:   {dp:4, f:s=>s.nat},
  maxQ:  {dp:6, f:s=>{ const n=M.P().net; if(!n) return 0;
    const sol = M.netSolve(n, s); let m = 0;
    for(let e=0;e<sol.q.length;e++) if(Math.abs(sol.q[e]) > m) m = Math.abs(sol.q[e]);
    return m; }},
};

const fmt = (v,dp) => (v===null||v===undefined||Number.isNaN(v)) ? ""
                    : (Math.round(v*Math.pow(10,dp))/Math.pow(10,dp)).toFixed(dp);

const CTX = {M, D, RIG, COL, colP, colTank, colTankP, colRate, colTankQ, colNodeT, colNodeX,
             colNodeP, colSgT, colSecP, colHold, colNet, clamp_};

const PROFILES = Object.assign({}, require('./plant')(CTX), require('./net')(CTX));

function parseEvents(args){
  const out = [];
  const add = (t, kind, arg) => out.push({t:+t, kind, arg});
  for(const a of args){
    const m = /^--(shut|hit|burst|blackout|scram|blkoff)=(.*)$/.exec(a);
    if(!m) continue;
    const kind = m[1], v = m[2];
    if(kind === "blackout" || kind === "scram"){ add(v, kind, true); continue; }
    const i = v.indexOf(":");
    if(i < 0){ console.log("# event needs T:arg - "+a); continue; }
    add(v.slice(0,i), kind, v.slice(i+1));
  }
  return out.sort((a,b)=>a.t-b.t);
}
const fireEvent = e => {
  // said out loud: act() declines an order for a machine this plant has not got, quietly
  console.log("# t="+e.t.toFixed(1)+" "+e.kind+" "+e.arg);
  if(e.kind === "blackout") M.act("blackout", true);
  else if(e.kind === "scram") M.act("scram");
  else if(e.kind === "blkoff") M.blkSinkOff(M.S(), e.arg);
  else if(e.kind === "shut") M.act("portShut", e.arg);
  else if(e.kind === "hit")  M.act("hit", e.arg);
  else if(e.kind === "burst")M.act("hit", "pipe:"+e.arg);
};

// the reseed is after commission() because that is where resetPlant() rolls its own
function setup(spec, v, opt){
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  CLAMPS = [];
  const note = spec.build(RIG, v) || {};
  M.buildLayout(); M.commission();
  const s = M.S();
  M.seedRng(s, opt.seed);
  s.diceOff = opt.dice === false;
  return {s, note};
}

// a profile with a `sweep` prints one settled row per value; everything else a time series
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
      M.netReading(true);
      try { console.log(names.map(k=>fmt(C[k].f(s, opt.secs), C[k].dp)).join(",")); }
      finally { M.netReading(false); }
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
      M.netReading(true);
      try {
        if(TR) TR.sample(s, i/50);
        else console.log(names.map(k=>{ const c=C[k];
          let v; try{ v=c.f(s,i/50); }catch(e){ v=NaN; }
          return fmt(typeof v==="boolean"?(v?1:0):v, c.dp); }).join(","));
      } finally { M.netReading(false); }
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
