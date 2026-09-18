#!/usr/bin/env node
// node tools/sandbox/sandbox.js [profile ...] --list --secs=N --every=N --seed=N --dice=off --trace --shut=T:portId --hit=T:partId --burst=T:x,y --blackout=T --scram=T --blkoff=T:sink
const {headless} = require('../bundle');
const M = headless(
 '{commission,resetPlant,step,derived,ST:()=>ST,SX:()=>SX,PT:()=>PT,IX:()=>IX,SCHEMA:()=>SCHEMA,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,mintTank,addPortAt,seedPort,seedRun,'+
 'buildLayout,buildStockPlumbing,plantPreset,pipeMap,pipeNetwork,nodeGraph,runIdOf,'+
 'tankCircuit,tankPrimary,tankIds,tankKg,partOf,partName,'+
 'holdTankIds,holdOnCirc,holdCircs,holdSetP,holdPlumbed,sgIds,circName,ROLE:()=>ROLE,'+
 'radIds,tankMass,layoutMetrics,designIssues,act,actId,'+
 'eMWe,eLoopP,eHoldLive,eNodeT,uiIx,uiTankLvl,uiTankP,uiNodeT,uiNodeX,uiNodeP,uiSecP,uiBlkSinkOff}');

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

// [path, value] written onto the state before every tick: a plant scalar by name (and every core's own copy, where it has one), or "field.id"
let CLAMPS = [];
const clampSet = (path, val) => {
  const ST = M.ST(), IX = M.IX();
  const v = typeof val === "function" ? val() : val;
  if(v === undefined) return;
  const i = path.indexOf(".");
  if(i < 0){
    const k = globalThis["SC_" + path.toUpperCase()];
    if(k !== undefined) ST.sc[k] = v;
    const cs = ST["cs" + path[0].toUpperCase() + path.slice(1)];
    if(cs && cs.length === M.PT().n.core) cs.fill(v);
    return; }
  const field = path.slice(0, i), id = path.slice(i + 1), row = M.SCHEMA().find(r => r[0] === field);
  if(!row || !ST[field]) return;
  const m = IX[row[2]], j = m && m.has(id) ? m.get(id) : -1;
  if(j >= 0) ST[field][j] = v;
};
const clamp_ = (path, v) => CLAMPS.push([path, v]);
const sc = () => M.ST().sc;

const COL = {
  t:      {dp:1, f:t=>t},
  P:      {dp:3, f:()=>sc()[SC_P]},
  lvl:    {dp:1, f:()=>sc()[SC_LVL]},
  inv:    {dp:2, f:()=>sc()[SC_INV]},
  Tavg:   {dp:1, f:()=>sc()[SC_TAVG]},
  sc:     {dp:1, f:()=>sc()[SC_SC]},
  mwe:    {dp:1, f:()=>M.eMWe()},
  n:      {dp:3, f:()=>sc()[SC_N]},
  vf:     {dp:3, f:()=>sc()[SC_VF]},
  rel:    {dp:4, f:()=>sc()[SC_RELEASE]},
  brk:    {dp:0, f:()=>sc()[SC_BREACH]?1:0},
};
const colP    = ci => ({dp:3, f:()=>M.eLoopP(ci)});
const colTank = id => ({dp:1, f:()=>M.uiTankLvl(id)});
const colTankP= id => ({dp:3, f:()=>M.uiTankP(id)});
const colRate = id => ({dp:4, f:()=>{ const t=M.uiIx("tank",id); return t<0?0:M.ST().tankRate[t]; }});
const colNodeT= n  => ({dp:1, f:()=>M.uiNodeT(n)});
const colNodeX= n  => ({dp:3, f:()=>M.uiNodeX(n)});
const colNodeP= n  => ({dp:4, f:()=>{ const v=M.uiNodeP(n); return v===undefined?null:v; }});
const colSgT  = id => ({dp:1, f:()=>{ const b=M.uiIx("boiler",id); return b<0?null:M.ST().sgTBy[b]; }});
const colSecP = id => ({dp:3, f:()=>M.uiSecP(id)});
const colHold = ci => ({dp:0, f:()=>M.eHoldLive(ci)?1:0});
// kg/s out of the tank, off the solve's own tank edge
const colTankQ = id => ({dp:4, f:()=>{ const t=M.uiIx("tank",id); return t<0?null:M.SX().netTankQ[t]; }});
const colNet = {
  nodes: {dp:0, f:()=>M.PT().n.node},
  edges: {dp:0, f:()=>M.PT().n.edge},
  comps: {dp:0, f:()=>M.PT().compCirc.length},
  live:  {dp:0, f:()=>{ const g=M.SX().gLive; let c=0; for(let e=0;e<g.length;e++) if(g[e]) c++; return c; }},
  flowK: {dp:4, f:()=>sc()[SC_FLOWNET]},
  nat:   {dp:4, f:()=>sc()[SC_NAT]},
  maxQ:  {dp:6, f:()=>{ const k=M.ST().edgeKg; let m=0; for(let e=0;e<k.length;e++) if(Math.abs(k[e])>m) m=Math.abs(k[e]); return m/0.02; }},
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
  else if(e.kind === "blkoff") M.uiBlkSinkOff(e.arg);
  else if(e.kind === "shut") M.actId("portShut", e.arg);
  else if(e.kind === "hit")  M.actId("hit", e.arg);
  else if(e.kind === "burst")M.actId("hit", "pipe:"+e.arg);
};

// the reseed is after commission() because that is where resetPlant() rolls its own
function setup(spec, v, opt){
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  CLAMPS = [];
  const note = spec.build(RIG, v) || {};
  M.buildLayout(); M.commission();
  const S = sc();
  S[SC_SEED] = S[SC_RNG] = opt.seed;
  S[SC_DICEOFF] = opt.dice === false ? 1 : 0;
  return {note};
}

// a profile with a `sweep` prints one settled row per value; everything else a time series
function flyOne(key, opt){
  const spec = PROFILES[key]();
  const evs = opt.events;
  if(spec.sweep){
    console.log("# "+spec.name);
    let names = null;
    for(const v of spec.sweep){
      setup(spec, v, opt);
      const C = spec.cols(), n = Math.round(opt.secs*50);
      if(!names){ names = Object.keys(C); console.log(names.join(",")); }
      let ei = 0;
      for(let i=0;i<n;i++){
        for(const [p,val] of CLAMPS) clampSet(p,val);
        while(ei < evs.length && evs[ei].t <= i/50) fireEvent(evs[ei++]);
        if(spec.at && spec.at[i/50]) spec.at[i/50]();
        M.step(0.02); if(sc()[SC_BREACH]) break;
      }
      console.log(names.map(k=>fmt(C[k].f(opt.secs), C[k].dp)).join(","));
    }
    return;
  }
  const {note} = setup(spec, undefined, opt);
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
    for(const [p,v] of CLAMPS) clampSet(p,v);
    while(ei < evs.length && evs[ei].t <= i/50) fireEvent(evs[ei++]);
    if(spec.at && spec.at[i/50]) spec.at[i/50]();
    if(i%step===0){
      if(TR) TR.sample(i/50);
      else console.log(names.map(k=>{ const c=C[k];
        let v; try{ v=c.f(i/50); }catch(e){ v=NaN; }
        return fmt(typeof v==="boolean"?(v?1:0):v, c.dp); }).join(","));
    }
    if(i<n) M.step(0.02);
    if(sc()[SC_BREACH]){ if(!TR) console.log("# breach at t="+(i/50).toFixed(1)); break; }
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
