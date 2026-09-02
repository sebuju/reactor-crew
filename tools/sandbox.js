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
   worth. Rows are cheap to read and cheap to diff.

   Usage:  node tools/sandbox.js [profile ...] [--secs=N] [--every=N] [--list]
*/
const {headless} = require('./bundle');
const M = headless(
 '{commission,resetPlant,step,derived,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,mintTank,addPortAt,seedPort,seedRun,pipeLay,'+
 'buildLayout,buildStockPlumbing,latDefault,pipeMap,pipeNetwork,nodeGraph,'+
 'tankCircuit,tankPrimary,tankIds,tankKg,tankLvl,tankP,tankLive,partOf,partName,'+
 'holdTankIds,holdOnCirc,holdCircs,holdSetP,holdLive,holdPlumbed,loopP,setLoopP,'+
 'netTempAt,netQualAt,mwE,loopKg,secP,sgIds,sgLvl,circName,ROLE:()=>ROLE,'+
 'netKgs,radIds,invRate,tankMass,layoutMetrics,designIssues}');

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
  run(a, b, vFirst){ return M.seedRun(a, b, vFirst); },
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
const colSgT  = id => ({dp:1, f:s=>s.sgTBy&&s.sgTBy[id]});
const colSecP = id => ({dp:3, f:s=>M.secP(s,id)});
const colHold = ci => ({dp:0, f:s=>M.holdLive(M.P().net,s,ci)?1:0});

const fmt = (v,dp) => (v===null||v===undefined||Number.isNaN(v)) ? ""
                    : (Math.round(v*Math.pow(10,dp))/Math.pow(10,dp)).toFixed(dp);


/* ══ PROFILES ══ disposable, exactly like probe.js's cases. Each one isolates
   ONE question. Add one, read it, delete it. */
const PROFILES = {

/* ── 1. A PRESSURIZER ON ITS OWN ──
   Nothing but the vessel, a source standing in for the loop it hangs off, and
   the surge line between them. If the setpoint is held here it is held by the
   vessel and by nothing else on the plant. */
  pzrAlone(){
    return {name:"pressurizer alone: vessel, surge line, one boundary",
      build(R){
        M.buildStockPlumbing({loops:1});
        // every relief path shut, so the only thing moving water is the surge
        for(const fid in D.fittings) if(D.fittings[fid].mode==="relief") D.fittings[fid].bore=0.1;
        return {note:"stock primary, relief throttled shut"};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), set:{dp:3,f:()=>M.holdSetP(ci)}, lvl:COL.lvl,
                live:colHold(ci), pzrT:colNodeT("pzr"), pzrX:colNodeX("pzr"),
                Tavg:COL.Tavg, sc:COL.sc}; }};
  },

/* ── 2. THE SURGE LINE CUT ──
   The check that has never been seen to fail. Isolate the vessel at 20 s and
   the circuit must relax toward containment - and ONLY that circuit. */
  pzrIsolate(){
    return {name:"pressurizer isolated at t=20: the circuit must relax to containment",
      build(R){ M.buildStockPlumbing({loops:1}); return {}; },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {P:colP(ci), live:colHold(ci), lvl:COL.lvl, inv:COL.inv,
                Tavg:COL.Tavg, sc:COL.sc, mwe:COL.mwe}; },
      at:{20:s=>{ s.tankByp = s.tankByp||{}; for(const id of M.holdTankIds()) s.tankByp[id]=true; }}};
  },

/* ── 3. TWO CIRCUITS, TWO PRESSURES ──
   A second hold tank on the secondary. Neither may drag the other, and both
   PBy entries must stand where their own vessels put them. */
  twoHolds(){
    return {name:"a second hold tank on the secondary circuit",
      build(R){
        M.buildStockPlumbing({loops:1});
        /* on the FEEDWATER line, which is secondary - placed and piped with
           the same two gestures the bench's own click and drag make */
        const p = M.partOf("feed");
        R.tank("pzr2", p.x, Math.max(0,p.y-6), 0, {name:"SEC PRESSURIZER", col:"#a98cf0",
          vol:40, level:50, inf:false, gas:null, hold:{p:7.5}});
        const a = R.port("pzr2", 1, M.partOf("pzr2").h);
        const b = R.port("feed", 1, -1);
        R.run(a, b, true);
        return {note:"pzr2 holds 7.5 MPa on the secondary"};
      },
      cols(){ const G=M.nodeGraph();
        const cs=M.holdCircs();
        const o={};
        for(const ci of cs){ o["P"+ci]=colP(ci); o["live"+ci]=colHold(ci); }
        o.sgT=colSgT("sg0"); o.secP=colSecP("sg0"); o.mwe=COL.mwe; o.Tavg=COL.Tavg;
        return o; }};
  },

/* ── 4. A SOURCE AND A VOID, AND NOTHING ELSE ──
   The pressure network on its own: one boundary pushing, one swallowing, and
   the pipe between them. Nothing thermal, nothing nuclear. This is the cheap
   rig for a conductance question. */
  flowOnly(){
    return {name:"one source, one void, one pipe - the solve with nothing else in it",
      build(R){
        M.buildStockPlumbing({loops:1});
        R.source("srcA", 0, 0, 16.0, {name:"SOURCE", vol:30});
        R.void_ ("sinkA", 0, 9, {name:"VOID", vol:30});
        /* A TEE BETWEEN THEM, and it is not decoration: both tanks are FIXED
           nodes, and netAssemble writes no row for an edge whose two ends are
           both known - so a source wired straight into a void carries exactly
           nothing. The junction is the free node the solve needs. */
        const t = M.addFitting(1, 6);
        D.fittings[t].mode = "tee"; D.fittings[t].name = "RIG TEE";
        M.buildLayout();
        R.run(R.port("srcA", 1, M.partOf("srcA").h), R.port(t, 0, -1), false);
        R.run(R.port(t, 0, 1), R.port("sinkA", 1, -1), false);
        clamp_("n", 0); clamp_("Tavg", 560);
        return {note:"reactor power and Tavg clamped: hydraulics only"};
      },
      cols(){ return {srcP:colTankP("srcA"), sinkP:colTankP("sinkA"),
                      srcQ:colRate("srcA"), sinkQ:colRate("sinkA"),
                      srcL:colTank("srcA"), sinkL:colTank("sinkA"), inv:COL.inv}; }};
  },

/* ── 5. THE SETPOINT SWEEP ──
   Same plant, one knob. What the vessel is asked to hold, against what the
   plant actually settles at and what it cost in steel. */
  setpoint(){
    return {name:"one row per setpoint: what it holds, and what it weighs",
      sweep:[10,12,14,15.5,17,19,21],
      build(R,v){
        M.buildStockPlumbing({loops:1});
        for(const id of M.holdTankIds()) D.tanks[id].hold.p = v;
        return {};
      },
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {set:{dp:2,f:()=>M.holdSetP(ci)}, P:colP(ci), Tavg:COL.Tavg,
                sc:COL.sc, mwe:COL.mwe, tsat:{dp:1,f:s=>M.P().tsat0},
                mass:{dp:0,f:()=>M.derived().mass}, tankT:{dp:1,f:()=>M.tankMass()}}; }};
  },

/* ── 6. THE VESSEL'S OWN SIZE ──
   Damping is the steam bubble. Sweep the volume and read how far pressure
   swings when the plant is disturbed. */
  bubble(){
    return {name:"one row per vessel volume: pressure swing after a load step",
      sweep:[20,35,50,70,100],
      build(R,v){
        M.buildStockPlumbing({loops:1});
        for(const id of M.holdTankIds()) D.tanks[id].vol = v;
        return {};
      },
      at:{10:s=>{ s.loadDem=0.5; }},
      cols(){ const ci=M.nodeGraph().coreCirc;
        return {vol:{dp:0,f:()=>D.tanks[M.holdTankIds()[0]].vol},
                pzrK:{dp:3,f:()=>M.P().pzrK}, P:colP(ci), lvl:COL.lvl,
                Tavg:COL.Tavg, mwe:COL.mwe}; }};
  },
};

/* ══ SWEEPS ══ a profile with a `sweep` runs once per value and prints ONE
   settled row each, which is the tightest honest shape for "what does this
   knob do". Everything else prints a time series. */
function flyOne(key, secs, every){
  const spec = PROFILES[key]();
  if(spec.sweep){
    console.log("# "+spec.name);
    let names = null;
    for(const v of spec.sweep){
      Object.assign(D, JSON.parse(JSON.stringify(BASE)));
      CLAMPS = []; M.latDefault();
      spec.build(RIG, v); M.buildLayout(); M.commission();
      const s = M.S(), C = spec.cols(), n = Math.round(secs*50);
      if(!names){ names = Object.keys(C); console.log(names.join(",")); }
      for(let i=0;i<n;i++){
        for(const [p,val] of CLAMPS) clampSet(s,p,val);
        if(spec.at && spec.at[i/50]) spec.at[i/50](s);
        M.step(0.02); if(s.breach) break;
      }
      console.log(names.map(k=>fmt(C[k].f(s, secs), C[k].dp)).join(","));
    }
    return;
  }
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  CLAMPS = []; M.latDefault();
  const opt = spec.build(RIG) || {};
  M.buildLayout(); M.commission();
  const s = M.S(), C = Object.assign({t:COL.t}, spec.cols());
  const names = Object.keys(C);
  console.log("# "+spec.name+(opt.note?"  ("+opt.note+")":""));
  console.log(names.join(","));
  const n = Math.round(secs*50), step = Math.max(1, Math.round(every*50));
  for(let i=0;i<=n;i++){
    for(const [p,v] of CLAMPS) clampSet(s,p,v);
    if(spec.at && spec.at[i/50]) spec.at[i/50](s);
    if(i%step===0) console.log(names.map(k=>{ const c=C[k];
      let v; try{ v=c.f(s,i/50); }catch(e){ v=NaN; }
      return fmt(typeof v==="boolean"?(v?1:0):v, c.dp); }).join(","));
    if(i<n) M.step(0.02);
    if(s.breach){ console.log("# breach at t="+(i/50).toFixed(1)); break; }
  }
}

const args  = process.argv.slice(2);
const num   = (f,d) => { const a=args.find(x=>x.indexOf(f)===0);
                         return a ? +a.split("=")[1] : d; };
if(args.indexOf("--list") >= 0){ console.log(Object.keys(PROFILES).join("\n")); process.exit(0); }
const secs  = num("--secs=", 60), every = num("--every=", 5);
const pick  = args.filter(a => a[0] !== "-");
for(const k of (pick.length ? pick : Object.keys(PROFILES))){
  if(!PROFILES[k]){ console.log("# no profile named "+k+" (--list)"); continue; }
  flyOne(k, secs, every);
  console.log("");
}
