#!/usr/bin/env node
/* reactor-crew configuration probe.
   Spins up an arbitrary plant, runs it, and PRINTS what it does.

   There are no assertions here and there never will be. A committed suite of
   configurations would become a specification - two dozen things that must
   stay true forever - and the model has to keep moving. The auditors keep
   doing what they already do; this answers the questions they were never
   written to ask, and a human reads the answer.

   Usage:  node tools/probe.js [caseName ...]
           node tools/probe.js --list
*/
const {portOnFace,spliceFitting,tieFitting}=require('./bundle');
const M=require('./bundle').headless(
 '{commission,resetPlant,step,derived,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'placePart,removePart,addFitting,addTank,addPortAt,seedPort,seedRun,pipeLay,'+
 'buildLayout,buildStockPlumbing,latDefault,pipeMap,pipeNetwork,nodeGraph,'+
 'crossTies,selfRuns,designIssues,loopMap,tankCircuit,tankPrimary,tankIds,tankKg,'+
 'netBuild,netFlowK,ROLE:()=>ROLE,partOf,partName,mwE,loopKg,hotMass,radIds,radArea,'+
 'sgIds,sgLvl,secP,turbCount,condCount,circName,netTempAt,netQualAt,advectClampCount,'+
 'manualScram,turbKgs,condUA,pumpHead,pumpFlow,sgUAOf,partVol,runVol}');

const D=M.D();
const BASE=JSON.parse(JSON.stringify(D));

/* WHAT A CASE PLACED, TAKEN BACK DOWN AFTERWARDS. placedParts is module state
   and buildStockPlumbing() only re-syncs the generators and pumps it owns, so
   without this every case contaminates the next one. */
function withPlant(build, opts){
  const before=M.LAY().parts.map(p=>p.id);
  Object.assign(D,JSON.parse(JSON.stringify(BASE)));
  M.latDefault();
  M.buildStockPlumbing({loops:(opts&&opts.loops)||1});
  if(build) build(M);
  M.buildLayout();
  M.commission();
  return M.S();
}
const run=(s,secs)=>{ for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

const f=(v,d)=>(v===null||v===undefined||Number.isNaN(v))?"-":(+v).toFixed(d===undefined?3:d);
const row=(...c)=>console.log("  "+c.map((x,i)=>String(x).padEnd(i?14:22)).join(""));

/* ══ THE DUMP ══ every reading that matters, and none it does not have. */
function dump(s,label){
  console.log("\n── "+label+" ──");
  const G=M.nodeGraph();
  console.log(" CIRCUITS  ("+G.nCirc+", core is "+G.coreCirc+")");
  const byCirc={};
  for(const p of M.LAY().parts)
    for(const n of (G.nodesOf[p.id]||[])){
      const c=G.circuit[n]; (byCirc[c]||(byCirc[c]=new Set())).add(p.id); }
  for(const c of Object.keys(byCirc).sort((a,b)=>a-b))
    row("#"+c+" "+M.circName(+c), Array.from(byCirc[c]).join(" "));

  console.log(" PLANT");
  row("Tavg K",f(s.Tavg,2)); row("P MPa",f(s.P,4));
  row("inventory %",f(s.inv,2)); row("pzr level %",f(s.lvl,2));
  row("core MW",f(s.fq*(s.P0mw||0),2)||"-"); row("electric MW",f(M.mwE(s),2));
  row("cond T K",f(s.condT,2)); row("rad T K",f(s.radT,2));
  row("release",f(s.release,5)); row("breach",!!s.breach);

  console.log(" POTS");
  for(const id in (s.ihxTBy||{})) row("ihx "+id+" K",f(s.ihxTBy[id],2));
  for(const id of M.sgIds()) row("sg "+id, "T "+f(s.sgTBy&&s.sgTBy[id],2)+"  lvl "+f(M.sgLvl(s,id),1)+"  P "+f(M.secP(s,id),4));

  console.log(" TANKS");
  for(const id of M.tankIds())
    row(id, "circ "+M.circName(M.tankCircuit(id))+"  "+f(s.tank[id],1)+" %  "+f(M.tankKg(id),0)+" kg");

  console.log(" NODES   T K / quality / holdup m3");
  { const net=M.netBuild(s);
    const names=[]; for(const nm in net.index) names.push(nm);
    for(const nm of names){
      if(nm.indexOf("cont:")===0 || nm.indexOf("sec:")===0) continue;   // room boundaries, not plant
      row(nm, f(M.netTempAt(s,nm),1)+" K   x="+f(M.netQualAt(s,nm),2)+"   "+f(net.vol[net.index[nm]],2)+" m3");
    }
    row("courant clamps", M.advectClampCount()+" node(s) last tick"); }

  console.log(" RUNS");
  const flow={};
  M.netFlowK(s, flow);
  for(const r of M.pipeNetwork())
    row(r.k+" "+r.key.slice(0,40), flow[r.key]===undefined?"-":f(flow[r.key],4));

  console.log(" DESIGN");
  const issues=M.designIssues?M.designIssues():[];
  for(const w of issues) row(w[0], String(w[1]).slice(0,90));
  if(M.crossTies().length) row("cross-ties", JSON.stringify(M.crossTies()));
  if(M.selfRuns().length) row("self runs", M.selfRuns().join(" "));
}

/* ══ CASES ══ disposable. Add one, read it, delete it. */
const CASES={
  stock(){ const s=withPlant(null); run(s,600); dump(s,"stock plant, 1 loop"); },
  loops4(){ const s=withPlant(null,{loops:4}); run(s,600); dump(s,"stock plant, 4 loops"); },
  selfrun(){ const s=withPlant(M=>{
      const a=M.seedPort("turb",1,-1), b=M.seedPort("turb",3,-1);
      M.seedRun(a,b); });
      run(s,120); dump(s,"a run from a machine back to itself"); },
};

const args=process.argv.slice(2);
if(args[0]==="--list"){ console.log(Object.keys(CASES).join("\n")); process.exit(0); }
const pick=args.length?args:["stock"];
for(const k of pick){
  if(!CASES[k]){ console.log("no case named "+k+" (--list)"); continue; }
  CASES[k]();
}
