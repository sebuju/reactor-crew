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
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,addPortAt,seedPort,seedRun,pipeLay,'+
 'buildLayout,buildStockPlumbing,latDefault,pipeMap,pipeNetwork,nodeGraph,'+
 'crossTies,selfRuns,designIssues,loopMap,tankCircuit,tankPrimary,tankIds,tankKg,'+
 'netBuild,netFlowK,ROLE:()=>ROLE,partOf,partName,mwE,loopKg,hotMass,radIds,radArea,'+
 'netKgs,sgIds,sgLvl,secP,turbCount,condCount,circName,netTempAt,netQualAt,advectClampCount,'+
 'manualScram,turbKgs,condUA,pumpHead,pumpFlow,sgUAOf,partVol,runVol,'+
 'plantPreset,PLANTPRE:()=>PLANTPRE,sgDesignP,sgLiftP,sgBurstP,steamRise,tsatSec,mwT:()=>mwT}');

const D=M.D();
const BASE=JSON.parse(JSON.stringify(D));

/* THE STOCK SHIP, THEN WHATEVER THE CASE ADDS. D goes back to the blank grid
   first, so no case can contaminate the next one. */
function withPlant(build, opts){
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
  row("cond T K",f(s.condT,2)); row("cw in K",f(s.cwInT,2));
  row("release",f(s.release,5)); row("breach",!!s.breach);

  console.log(" POTS");
  for(const id in (s.ihxTBy||{})) row("ihx "+id+" K",f(s.ihxTBy[id],2));
  for(const id in (s.radTBy||{}))
    row("rad "+id, "T "+f(s.radTBy[id],2)+"  takes "+f((s.radQBy[id]||0)/1000,1)+" MW");
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
    row(r.k+" "+r.key.slice(0,40), (s.vapQ && s.vapQ[r.key]!==undefined)
      ? f(s.vapQ[r.key],2)+" kg/s"
      : (flow[r.key]===undefined ? "-"
         : f(Math.sign(flow[r.key])*M.netKgs(flow[r.key]),2)+" kg/s"));
  console.log(" STEAM   MPa");
  for(const nm in (s.vapP||{})) row(nm, f(s.vapP[nm],4));
  row("turbine", f(s.turbWk,2)+" kg/s at "+f(s.turbP,4)+" MPa");

  console.log(" DESIGN");
  const issues=M.designIssues?M.designIssues():[];
  for(const w of issues) row(w[0], String(w[1]).slice(0,90));
  if(M.crossTies().length) row("cross-ties", JSON.stringify(M.crossTies()));
  if(M.selfRuns().length) row("self runs", M.selfRuns().join(" "));
}

/* ══ CASES ══ disposable. Add one, read it, delete it. */
const CASES={
  stock(){ const s=withPlant(null); run(s,PSEC); dump(s,"stock plant, 1 loop"); },
  quad(){
    const i=M.PLANTPRE().findIndex(p=>p[0]==="QUAD");
    M.plantPreset(i); M.buildLayout(); M.commission();
    const s=M.S(); run(s,PSEC); dump(s,"QUAD - 4 units, 2 sets");
    console.log(" COUNTS  parts "+M.LAY().parts.length+"  turb "+M.turbCount()+
      "  cond "+M.condCount()+"  rad "+M.radIds().length+
      "  grid "+M.D().gw+"x"+M.D().gh);
  },
  /* A BLANK GRID. Nothing is placed at all: no core, no turbine, no panels.
     It must commission, run and read as nothing rather than throw. */
  blank(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.latDefault(); M.buildLayout(); M.commission();
    const s=M.S(); run(s,PSEC); dump(s,"blank grid");
    console.log(" COUNTS  parts "+M.LAY().parts.length+
      "  turb "+M.turbCount()+"  cond "+M.condCount()+"  rad "+M.radIds().length);
  },
  /* NO COUNT ANYWHERE SAYS HOW MANY TO ADD. Two condensers and three panels
     on an otherwise stock ship, and the counts are read off the drawing. */
  counts(){
    const s=withPlant(M=>{
      M.addMachine("cond",2,2); M.addMachine("radiator",2,8);
      M.addMachine("radiator",2,12); M.addMachine("turb",40,2);
    });
    run(s,1);
    console.log("\n── counts ──");
    console.log(" turb "+M.turbCount()+"  cond "+M.condCount()+"  rad "+M.radIds().length);
    for(const p of M.LAY().parts) if(["turb","cond","radiator","pump","sg"].includes(p.role))
      console.log("  "+p.id.padEnd(10)+M.partName(p));
  },
  /* A REACTOR COMES WITH ITS ROD DRIVES AND GOES WITH THEM. Place one, place
     a second, take each away by a different end of the pair. */
  rides(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.latDefault(); M.buildLayout();
    const say=t=>console.log("  "+t.padEnd(30)+
      (M.LAY().parts.map(p=>p.id).join(" ") || "(nothing)"));
    console.log("\n── a rider rides ──");
    say("blank grid");
    M.addMachine("core",6,13);  say("ADD REACTOR");
    M.addMachine("core",30,13); say("ADD REACTOR again");
    M.removePart("rods2");      say("REMOVE on the 2nd's drives");
    M.removePart("core1");      say("REMOVE on the 1st reactor");
  },
  loops4(){ const s=withPlant(null,{loops:4}); run(s,PSEC); dump(s,"stock plant, 4 loops"); },
  /* Every whole-plant preset, flown, printing what it does and what stopped
     it. Disposable and assertion-free like every case here. */
  presets(){
    const PRE=M.PLANTPRE();
    const only=(process.argv.find(a=>/^--pre=/.test(a))||"").split("=")[1];
    const pick=only?only.split(",").map(Number):PRE.map((_,i)=>i);
    console.log("\nname        MWe    Tavg    shell P / design  lift  burst   sgLvl  dmg   died");
    for(const i of pick){
      M.plantPreset(i); M.buildLayout(); M.commission();
      const s=M.S(); s.diceOff=true;
      let died="-", t=0;
      for(let k=0;k<PSEC*50;k++){ M.step(0.02); t=k*0.02;
        const id=M.sgIds()[0];
        if(s.breach)                      { died="BREACH "+t.toFixed(0)+"s"; break; }
        if(id&&s.sgBurst&&s.sgBurst[id])  { died="SG BURST "+t.toFixed(0)+"s"; break; }
        if(s.turbTrip)                    { died="TURB TRIP "+t.toFixed(0)+"s"; break; }
        if(s.condLost)                    { died="VACUUM "+t.toFixed(0)+"s"; break; }
        if(s.scrammed)                    { died="SCRAM "+t.toFixed(0)+"s"; break; }
        if(s.dmg>1)                       { died="DAMAGE "+t.toFixed(0)+"s"; break; } }
      const id=M.sgIds()[0], dp=M.sgDesignP();
      const sp=id?M.secP(s,id):0;
      if(process.argv.some(a=>a==="--why")){
        const P=M.P(), n=M.sgIds().length;
        const dT0=P.Tref-M.tsatSec(dp), dTnow=s.Tavg-M.tsatSec(sp);
        console.log("  "+PRE[i][0]+"  Tref "+f(P.Tref,1)+"  tsat(des) "+f(M.tsatSec(dp),1)+
          "  dT0 "+f(dT0,1)+"  dTnow "+f(dTnow,1)+
          "\n    sgUA "+f(P.sgUA,1)+"  flowK "+f(P.flowK,4)+"  n0 "+f(P.n0,4)+
          "  n "+f(s.n,4)+"  rise "+f(M.steamRise(),0)+
          "\n    qIn(fit) "+f(n*P.sgUA*Math.pow(P.flowK,0.8)*dT0/1000,1)+" MW"+
          "  qIn(now) "+f(n*P.sgUA*Math.pow(P.flowK,0.8)*dTnow/1000,1)+" MW"+
          "  rated*n0 "+f(P.n0*P.rated,1)+" MW"+
          "\n    steamRef "+f(P.steamRef,1)+"  raised "+f(s.steamBy&&s.steamBy[id],1)+
          "  left "+f(s.steamTo&&s.steamTo[id],1)+"  swallow "+f(P.swallow,1)+
          "  load "+f(s.load,3));
      }
      console.log(PRE[i][0].padEnd(12)+f(M.mwE(s),0).padStart(6)+f(s.Tavg,1).padStart(8)+
        (f(sp,3)+" /"+f(dp,2)).padStart(15)+f(sp/Math.max(dp,1e-9),3).padStart(7)+
        f(M.sgLiftP(),2).padStart(6)+f(M.sgBurstP(id),2).padStart(7)+
        (id?f(M.sgLvl(s,id),0):"-").padStart(7)+f(s.dmg,1).padStart(6)+"   "+died);
    }
  },
  selfrun(){ const s=withPlant(M=>{
      const a=M.seedPort("turb",1,-1), b=M.seedPort("turb",3,-1);
      M.seedRun(a,b); });
      run(s,120); dump(s,"a run from a machine back to itself"); },
};

const args=process.argv.slice(2).filter(a=>!/^--secs=/.test(a));
const PSEC=+((process.argv.find(a=>/^--secs=/.test(a))||"").split("=")[1])||600;
if(args[0]==="--list"){ console.log(Object.keys(CASES).join("\n")); process.exit(0); }
const pick=args.length?args:["stock"];
for(const k of pick){
  if(!CASES[k]){ console.log("no case named "+k+" (--list)"); continue; }
  CASES[k]();
}
