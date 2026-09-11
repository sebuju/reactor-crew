#!/usr/bin/env node
// node tools/probe.js [caseName ...] | --list | --secs=N
const {portOnFace,spliceFitting,tieFitting}=require('./bundle');
const M=require('./bundle').headless(
 '{commission,resetPlant,step,derived,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,mintMachine,MACHINE:()=>MACHINE,removePart,addFitting,addTank,addPortAt,seedPort,seedRun,'+
 'buildLayout,buildStockPlumbing,buildStockAutomation,pipeMap,pipeNetwork,nodeGraph,'+
 'crossTies,selfRuns,designIssues,loopMap,tankCircuit,tankPrimary,tankIds,tankKg,'+
 'netBuild,netFlowK,ROLE:()=>ROLE,partOf,partName,mwE,loopKg,hotMass,radIds,radArea,'+
 'netKgs,sgIds,sgLvl,secP,turbCount,condCount,circName,netTempAt,netQualAt,advectClampCount,'+
 'manualScram,turbKgs,condUA,pumpHead,pumpFlow,sgUAOf,partVol,runVol,coreSeen,'+
 'plantPreset,latPreset,act,coreD,latRevolve,archPreset,PLANTPRE:()=>PLANTPRE,sgDesignP,sgLiftP,sgBurstP,steamRise,tsatSec,mwT:()=>mwT,'+
 'LAT_P0:()=>LAT_P0,ARCHPRE:()=>ARCHPRE,fuelStages,FAIL:()=>FAIL,ledgerKg,ledgerOut,'+
 'netReading,netSolve,blkSinkOff,netBooked,netBookOf,bookedKg,advectLanded,advectEdgeKgOf:()=>advectEdgeKg,tankLvl,roomPGauge,sumpKg,netWorkAt,annStep,ANN:()=>ANN,'+
 'drumIds,boilerIds,boilerLvl,boilerP,boilerDesignP,holdSetP,loopMap,coreMint,designForget,pumpIds,secGensOf,'+
 'coreStep,coreInH,satT,coreDTMax,snapS,restoreS,GW:()=>GW,'+
 'loopHeadOf,pumpSucNode,pumpDisNode,netPressures,netRhoAt,netSatOf,runNodeOf,runBoreMm,runDutyKgs}');

const D=M.D();
const BASE=JSON.parse(JSON.stringify(D));

function withPlant(build, opts){
  Object.assign(D,JSON.parse(JSON.stringify(BASE)));
  
  M.buildStockPlumbing({loops:(opts&&opts.loops)||1});
  if(build) build(M);
  M.buildLayout();
  /* the cabinet is part of the plant: a preset always wires one, and without it s.fregBy has no live driver at all, so the feed valve is frozen wherever commissioning left it */
  M.buildStockAutomation();
  M.commission();
  return M.S();
}
const run=(s,secs)=>{ for(let i=0;i<secs*50;i++){ M.step(0.02); if(s.breach) break; } return s; };

const f=(v,d)=>(v===null||v===undefined||Number.isNaN(v))?"-":(+v).toFixed(d===undefined?3:d);
const row=(...c)=>console.log("  "+c.map((x,i)=>String(x).padEnd(i?14:22)).join(""));

function dump(s,label){
  console.log("\n── "+label+" --");
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
  { let m=0; for(const k in s.mBy) m+=s.mBy[k]; row("node mass kg",f(m,1)); }
  row("core MW",f(s.fq*(s.P0mw||0),2)||"-"); row("electric MW",f(M.mwE(s),2));
  row("cond T K",f(s.condT,2)); row("cw in K",f(s.cwInT,2));
  row("release",f(s.release,5)); row("breach",!!s.breach);
  if(s.coreBy && Object.keys(s.coreBy).length>1){
    console.log(" VESSELS");
    for(const id in s.coreBy){ const c=M.coreSeen(s,id);
      row(id, "n "+f(c.n,3)+"  Tavg "+f(c.Tavg,2)+"  P "+f(c.P,4)+"  lvl "+f(c.lvl,1)+"  inv "+f(c.inv,1)+"  sc "+f(c.sc,1)+"  flow "+f(c.flowNet,3)+"  rods "+f(c.rodPos,3)+(c.scrammed?"  SCRAMMED "+c.trip:"")); } }

  console.log(" POTS");
  for(const id in (s.condTBy||{})) row("cond "+id+" K",f(s.condTBy[id],2)+"  cw in "+f(s.cwInTBy[id],2)+" K");
  for(const id in (s.ihxQBy||{})) row("ihx "+id, "crosses "+f((s.ihxQBy[id]||0)/1000,1)+" MW");
  for(const id in (s.radTBy||{}))
    row("rad "+id, "T "+f(s.radTBy[id],2)+"  takes "+f((s.radQBy[id]||0)/1000,1)+" MW");
  for(const id of M.boilerIds()) row("boiler "+id, "T "+f(s.sgTBy&&s.sgTBy[id],2)+"  lvl "+f(M.boilerLvl(s,id),1)+"  P "+f(M.boilerP(s,id),4));

  console.log(" TANKS");
  for(const id of M.tankIds())
    row(id, "circ "+M.circName(M.tankCircuit(id))+"  "+f(s.tank[id],1)+" %  "+f(M.tankKg(id),0)+" kg");

  console.log(" NODES   T K / quality / holdup m3");
  { const net=M.netBuild(s);
    const names=[]; for(const nm in net.index) names.push(nm);
    for(const nm of names){
      if(nm.indexOf("cont:")===0) continue;   // room boundaries, not plant
      row(nm, f(M.netTempAt(s,nm),1)+" K   x="+f(M.netQualAt(s,nm),2)+"   "+f(net.vol[net.index[nm]],2)+" m3");
    }
    row("courant clamps", M.advectClampCount()+" node(s) last tick"); }

  console.log(" RUNS");
  const flow={};
  M.netFlowK(s, flow);
  for(const r of M.pipeNetwork())
    row(r.k+" "+r.key.slice(0,40), flow[r.key]===undefined ? "-"
        : f(Math.sign(flow[r.key])*M.netKgs(flow[r.key]),2)+" kg/s");
  console.log(" NODE BALANCE   kg/s, free nodes only");
  { M.netReading(true);
    const net=M.P().net, sol=M.netSolve(net,s), ek=M.advectEdgeKgOf(), st=sol.store;
    M.netReading(false);
    const din=new Float64Array(net.n), tin=new Float64Array(net.n);
    for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], q=sol.q[e];
      din[ed.u]-=q; din[ed.v]+=q;
      const m=ek?ek[e]/0.02:0; tin[ed.u]-=m; tin[ed.v]+=m; }
    let wi=-1,wr=0,wj=-1,wd=0;
    for(let i=0;i<net.n;i++){ if(sol.fixed[i]!==undefined) continue;
      const acc = st && st.cap[i]>0 ? st.cap[i]*sol.b[i]-st.src[i] : 0;
      const r=din[i]-acc, d=din[i]-tin[i];
      if(Math.abs(r)>Math.abs(wr)){ wr=r; wi=i; }
      if(Math.abs(d)>Math.abs(wd)){ wd=d; wj=i; } }
    row("worst store residual", wi<0?"-":net.name[wi]+"  "+f(wr,3));
    row("worst solve vs landed", wj<0?"-":net.name[wj]+"  "+f(wd,3)); }

  console.log(" STEAM   MPa");
  for(const id of M.boilerIds()) row(id+" boiler", f(M.boilerP(s,id),4));
  row("turbine", f(s.turbWk,2)+" kg/s at "+f(s.turbP,4)+" MPa");

  console.log(" DESIGN");
  const issues=M.designIssues?M.designIssues():[];
  for(const w of issues) row(w[0], String(w[1]).slice(0,90));
  if(M.crossTies().length) row("cross-ties", JSON.stringify(M.crossTies()));
  if(M.selfRuns().length) row("self runs", M.selfRuns().join(" "));
}

const CASES={
  stock(){ const s=withPlant(null); run(s,PSEC); dump(s,"stock plant, 1 loop"); },
  // three equal charges 1 s apart beside the first pump: the scar sum after each, the sets they left, a hit's set, the snapshot
  blast(){
    const s=withPlant(null); run(s,2);
    const GW=M.GW(), pump=M.LAY().parts.find(p=>p.role==="pump");
    const cx=pump.x-3, cy=pump.y+(pump.h>>1), ci=cy*GW+cx;
    const kPa=+((process.argv.find(a=>/^--kpa=/.test(a))||"").split("=")[1])||500;
    const sum=a=>{ let t=0; for(let i=0;i<a.length;i++) t+=a[i]; return t; };
    console.log(" BLAST  "+kPa+" kPa at cell "+cx+","+cy+", beside "+pump.id);
    const reads=[];
    for(let k=0;k<3;k++){ M.act("blast",ci,kPa); run(s,1); reads.push(sum(s.roomScar));
      row("scar sum "+(k+1), f(reads[k],0)+" kPa", "ratio "+f(reads[k]/reads[0],3)); }
    for(const id of s.dmgParts) row(id, s.dmgWhy[id]);
    run(s,3);
    const tgt=M.LAY().parts.find(p=>p.role!=="fitting" && !s.dmgParts.includes(p.id));
    if(tgt){ M.act("hit",tgt.id); run(s,0.1);
      row("hit "+tgt.id, s.dmgParts.includes(tgt.id) ? "wrecked" : "NOT wrecked"); }
    else row("hit", "no part left standing");
    const scar=s.roomScar.slice(), snap=M.snapS(s); M.restoreS(snap);
    const r=M.S().roomScar; let same=r.length===scar.length;
    for(let i=0;same && i<r.length;i++) if(r[i]!==scar[i]) same=false;
    row("snapshot roomScar", same ? "bit-exact" : "DIFFERS");
  },
  dual(){
    const i=M.PLANTPRE().findIndex(p=>p[0]==="DUAL");
    M.plantPreset(i); M.buildLayout(); M.commission();
    const s=M.S(); run(s,PSEC); dump(s,"DUAL - 2 units, 1 set");
    console.log(" COUNTS  parts "+M.LAY().parts.length+"  turb "+M.turbCount()+
      "  cond "+M.condCount()+"  rad "+M.radIds().length+
      "  grid "+M.D().gw+"x"+M.D().gh);
  },
  blank(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.buildLayout(); M.commission();
    const s=M.S(); run(s,PSEC); dump(s,"blank grid");
    console.log(" COUNTS  parts "+M.LAY().parts.length+
      "  turb "+M.turbCount()+"  cond "+M.condCount()+"  rad "+M.radIds().length);
  },
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
  rides(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.buildLayout();
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
  xeosc(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.buildStockPlumbing({loops:1}); M.latPreset(M.coreD("core"),1);
    // H/D 2.0: the COMPACT preset alone reads cz 0.70, nowhere near the warning
    { const c=M.coreD("core"); c.lat.len=2*c.lat.len/1.4; M.latRevolve(c); }
    M.buildLayout(); M.buildStockAutomation(); M.commission();
    const s=M.S(), P=M.P(); s.diceOff=true;
    M.act("split",true);
    M.act("rodBank",P.NB-1,Math.min(1,s.rodZ[P.NB-1]+0.10));
    console.log("\n── axial xenon, COMPACT lattice ──");
    console.log(" cz "+f(P.cz,3)+"  H/D "+f(M.coreD("core").hd,2)+"  banks "+P.NB);
    console.log("    t      ao%      n      fq");
    for(let k=0;k<=PSEC*50;k++){
      if(k%(10*50)===0)
        console.log("  "+String(Math.round(k/50)).padStart(5)+
          "  "+f(s.ao*100,2).padStart(7)+"  "+f(s.n,3).padStart(6)+"  "+f(s.fq,3));
      M.step(0.02);
    }
  },
  presets(){
    const PRE=M.PLANTPRE();
    const only=(process.argv.find(a=>/^--pre=/.test(a))||"").split("=")[1];
    const pick=only?only.split(",").map(Number):PRE.map((_,i)=>i);
    console.log("\nname        MWe    Tavg    shell P / design  lift  burst   sgLvl  dmg   died");
    for(const i of pick){
      M.plantPreset(i); M.buildLayout(); M.commission();
      const s=M.S(); s.diceOff=true;
      let died="-", t=0;
      const reds=M.ANN().filter(a=>a[1]==="red").map(a=>a[0]);
      for(let k=0;k<PSEC*50;k++){ M.step(0.02); t=k*0.02;
        const id=M.sgIds()[0];
        M.annStep(s);
        const red=reds.find(n=>s.annOn[n]);
        if(red)                           { died=red+" "+t.toFixed(0)+"s"; break; }
        if(s.breach)                      { died="BREACH "+t.toFixed(0)+"s"; break; }
        if(id&&s.sgBurst&&s.sgBurst[id])  { died="SG BURST "+t.toFixed(0)+"s"; break; }
        if(s.turbTrip)                    { died="TURB TRIP "+t.toFixed(0)+"s"; break; }
        if(s.condLost)                    { died="VACUUM "+t.toFixed(0)+"s"; break; }
        if(s.scrammed)                    { died="SCRAM "+t.toFixed(0)+"s"; break; }
        if(s.dmg>1)                       { died="DAMAGE "+t.toFixed(0)+"s"; break; } }
      const id=M.boilerIds()[0], dp=M.boilerDesignP();
      const sp=id?M.boilerP(s,id):0;
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
          "  swallow "+f(P.swallow,1)+
          "  load "+f(s.load,3));
      }
      console.log(PRE[i][0].padEnd(12)+f(M.mwE(s),0).padStart(6)+f(s.Tavg,1).padStart(8)+
        (f(sp,3)+" /"+f(dp,2)).padStart(15)+f(sp/Math.max(dp,1e-9),3).padStart(7)+
        f(M.sgLiftP(),2).padStart(6)+f(M.sgBurstP(id),2).padStart(7)+
        (id?f(M.boilerLvl(s,id),0):"-").padStart(7)+f(s.dmg,1).padStart(6)+"   "+died);
    }
  },
  excursion(){
    const pks=((process.argv.find(a=>/^--pk=/.test(a))||"").split("=")[1]||"").split(",").filter(Boolean).map(Number);
    const at=+((process.argv.find(a=>/^--blackout=/.test(a))||"").split("=")[1]||20);
    const every=+((process.argv.find(a=>/^--every=/.test(a))||"").split("=")[1]||5);
    const hit=+((process.argv.find(a=>/^--hit=/.test(a))||"").split("=")[1]||0);
    const vessel=+((process.argv.find(a=>/^--vessel=/.test(a))||"").split("=")[1]||1);
    const i=M.PLANTPRE().findIndex(p=>p[0]==="RBMK-1000");
    for(const pk of (pks.length?pks:[null])){
      M.plantPreset(i);
      const c=M.coreD("core");
      if(pk!==null){ c.lat.pitch=pk*M.LAT_P0(); M.latRevolve(c); }
      M.buildLayout(); M.commission();
      const s=M.S(), P=M.P(), d=M.derived(), cs=s.coreBy.core;
      s.diceOff=true; P.cores.core.burstK*=vessel;
      console.log("\n── excursion  pk "+(pk===null?"preset":pk)+"  aV "+f(d.aV,0)+" pcm  aM "+f(d.aM,1)+"  beta "+f(P.BETA*1e5,0)+"  rated "+f(P.rated,0)+" MWt  burst "+f(P.P0*P.burstK,2)+" MPa ──");
      M.blkSinkOff(s,"scram");
      const rods=(process.argv.find(a=>/^--rods=/.test(a))||"").split("=")[1];
      const load=+((process.argv.find(a=>/^--load=/.test(a))||"").split("=")[1]||0);
      if(rods!=="keep"){
        for(const id in D.blocks) if(D.blocks[id].mode==="sink" && D.blocks[id].sink==="rodStep") M.act("blkOn",id);
        M.act("rodCommon",+(rods||0)); }
      if(load>0) M.act("loadDem",load);
      if(process.argv.some(a=>/^--band=/.test(a))) s.arLo=+((process.argv.find(a=>/^--band=/.test(a))).split("=")[1]);
      const scram=process.argv.includes("--scram");
      const starve=+((process.argv.find(a=>/^--starve=/.test(a))||"").split("=")[1]||0);
      let pkN=0,pkRho=-1e9,tN=0,tRho=0,pkP=0,pkTf=0,tEnd=null;
      console.log("    t      n     rho   rods    vf     P MPa  fci MW   TfHot   dmg%  melt%  disp%    xe    vd   tip   sc K  ledger+out   h2 kg  rmH2  rmP kPa  rmT K  sump t  tube%  cav kPa  trip");
      const cavNode=P.net.index["cav:core"];
      const line=(t)=>{ const st=M.fuelStages(cs), FL=M.FAIL(), q=FL.findIndex(r=>r.k==="disp");
        let rmH2=0; for(let i=0;i<s.roomH2.length;i++) rmH2+=s.roomH2[i];
        const rmP=M.roomPGauge(s).reduce((a,v)=>Math.max(a,v),0);
        const cav=cavNode===undefined?"-":f((s.pBy["cav:core"]-P.Pcont)*1000,0);
        console.log("  "+f(t,1).padStart(5)+"  "+f(s.n,3).padStart(6)+"  "+f(s.rho,0).padStart(5)+"  "+f(s.rodPos,2).padStart(5)+"  "+f(s.vf,3).padStart(5)+"  "+f(s.pCore,3).padStart(7)+"  "+f(cs.fci/1000,1).padStart(6)+"  "+f(s.TfHot,0).padStart(6)+"  "+f(s.dmg,1).padStart(5)+"  "+f(s.meltFrac*100,1).padStart(5)+"  "+(q>=0?f(st[q]*100,1):"-").padStart(5)+"  "+f(s.parts.xe,0).padStart(5)+"  "+f(s.parts.vd,0).padStart(5)+"  "+f(cs.tipRho,0).padStart(4)+"  "+f(s.sc,1).padStart(5)+"  "+f(M.ledgerKg(s)+M.ledgerOut(s),0).padStart(9)+"  "+f(s.h2,1).padStart(6)+"  "+f(rmH2,1).padStart(4)+"  "+f(rmP,1).padStart(7)+"  "+f(s.roomMax,0).padStart(5)+"  "+f(M.sumpKg(s)/1000,1).padStart(6)+"  "+f((cs.tubesOpen||0)*100,0).padStart(5)+"  "+cav.padStart(7)+"  "+(s.trip||"")); };
      let pkFci=0, fciKJ=0, pkW=0, pkWfci=0, pkWt=0, w0=null; const wrecked=[];
      for(let k=0;k<=PSEC*50;k++){ const t=k*0.02;
        while(wrecked.length<s.dmgParts.length){ const id=s.dmgParts[wrecked.length]; wrecked.push(id+" "+s.dmgWhy[id]+"@"+f(t,1)); }
        if(starve>0 && k===starve*50){ M.blkSinkOff(s,"freg"); for(const id of M.sgIds()) s.fregBy[id]=1; }
        if(k===at*50){ w0=M.netWorkAt(s,"core"); if(scram) M.act("scram"); else M.act("blackout",true); if(hit>0) cs.nTf.fill(hit); }
        if(cs.fci>pkFci) pkFci=cs.fci;
        if(k>=at*50){ fciKJ+=cs.fci*0.02; const w=M.netWorkAt(s,"core"); if(w>pkW){ pkW=w; pkWfci=fciKJ; pkWt=t; } }
        if(k%(every*50)===0) line(t);
        M.step(0.02);
        if(s.n>pkN){ pkN=s.n; tN=t; } if(s.rho>pkRho){ pkRho=s.rho; tRho=t; }
        if(s.pCore>pkP) pkP=s.pCore; if(s.TfHot>pkTf) pkTf=s.TfHot;
        if(s.breach && tEnd===null){ tEnd=t; line(t); if(!process.argv.includes("--on")) break; } }
      const st=M.fuelStages(cs), FL=M.FAIL();
      console.log("  peak n "+f(pkN,3)+" @ "+f(tN,1)+" s   peak rho "+f(pkRho,0)+" pcm @ "+f(tRho,1)+" s   peak P "+f(pkP,3)+" MPa   peak Tf "+f(pkTf,0)+" K   peak fci "+f(pkFci/1000,1)+" MW");
      { const dW=w0===null?0:pkW-w0;
        console.log("  work  fci "+f(pkWfci/1e6,2)+" GJ to the work peak ("+f(fciKJ/1e6,2)+" GJ in all)   node work "+f((w0||0)/1e6,2)+" to "+f(pkW/1e6,2)+" GJ at "+f(pkWt,2)+" s   rise "+f(dW/1e6,3)+" GJ   conversion "+(pkWfci>0?f(100*dW/pkWfci,2)+" %":"-")); }
      console.log("  fuel  "+FL.map((r,q)=>r.k+" "+f(st[q]*100,1)+"%").join("  ")+"   h2 "+f(s.h2,1)+" kg");
      console.log("  end   "+(tEnd===null?"no event in "+PSEC+" s":s.trip+" at "+f(tEnd,1)+" s")+"   ledger "+f(M.ledgerKg(s),0)+" kg  out "+f(M.ledgerOut(s),0)+" kg");
      console.log("  wrecked "+(wrecked.join("  ")||"nothing"));
      console.log("  books "+Object.entries(s.massOut).filter(e=>Math.abs(e[1])>1).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6).map(e=>e[0]+" "+f(e[1],0)).join("  "));
    }
  },
  drum(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.designForget();
    const core=M.coreMint(); M.archPreset(core,1);       // a boiling core: a drum on a subcooled loop separates nothing
    M.buildStockPlumbing({loops:1, drum:true, core});
    M.buildLayout(); M.buildStockAutomation(); M.commission();
    const s=M.S(); s.diceOff=true;
    /* the same footing a preset commissions on: what is being measured is the drum, not the protection system */
    M.blkSinkOff(s,"scram");
    const ids=M.drumIds();
    console.log("\n── one drum on the stock loop, boiling core ──");
    console.log(" drums "+ids.join(" ")+"   boilers "+M.boilerIds().join(" ")+
      "   loops "+M.loopMap().n+"   setpoint "+f(M.holdSetP(M.nodeGraph().coreCirc),3)+" MPa");
    for(const id of M.pumpIds()) if(M.secGensOf(id).length)
      console.log(" "+id+" feeds "+M.secGensOf(id).join(" ")+"   head "+f(M.pumpHead(id),2)+" MPa");
    console.log("    t     n   flowNet    vf"+ids.map(id=>"   "+id+" lvl      P    steam     fed   freg").join(""));
    const line=t=>console.log("  "+f(t,1).padStart(5)+" "+f(s.n,3).padStart(5)+"  "+f(s.flowNet,3).padStart(6)+
      " "+f(s.vf,3).padStart(6)+ids.map(id=>"  "+f(M.boilerLvl(s,id),1).padStart(6)+" "+f(M.boilerP(s,id),3).padStart(6)+
      " "+f(s.steamBy[id],1).padStart(7)+" "+f(s.sgFedBy[id],1).padStart(7)+" "+f(s.fregBy[id],3).padStart(6)).join("")+
      (s.trip?"  "+s.trip:"")+(s.breach?"  BREACH":""));
    line(0);
    for(let k=0;k<PSEC*50;k++){ M.step(0.02); if((k+1)%(5*50)===0) line((k+1)*0.02); if(s.breach) break; }
    console.log(" ledger "+f(M.ledgerKg(s),0)+" kg  out "+f(M.ledgerOut(s),0)+" kg  residual "+f(s.massRes,3)+" kg");
    console.log(" wrecked "+((s.dmgParts||[]).map(id=>id+" "+s.dmgWhy[id]).join("  ")||"nothing"));
  },
  selfrun(){ const s=withPlant(M=>{
      const a=M.seedPort("turb",1,-1), b=M.seedPort("turb",3,-1);
      M.seedRun(a,b); });
      run(s,120); dump(s,"a run from a machine back to itself"); },
  rbmk(){
    const A=(k,d)=>{const a=process.argv.find(x=>new RegExp("^--"+k+"=").test(x)); return a===undefined?d:a.split("=")[1];};
    const loads=String(A("load","1")).split(",").map(Number);
    const settle=+A("settle",20), after=+A("after",20), every=+A("every",5), stepRod=+A("step",0.01);
    const i=M.PLANTPRE().findIndex(p=>p[0]==="RBMK-1000");
    for(const L of loads){
      M.plantPreset(i); M.buildLayout(); M.commission();
      const s=M.S(), P=M.P(), d=M.derived(); s.diceOff=true;
      M.blkSinkOff(s,"scram");
      const cid=Object.keys(s.coreBy)[0], K=P.cores[cid], cp=K.sat.cp, hfg=K.sat.hfg;
      const b=M.boilerIds()[0];
      const sub=()=>{ const cs=s.coreBy[cid]; return M.satT(K.sat,cs.pCore) - M.coreInH(s,cid)/cp; };
      const xOut=()=>{ const cs=s.coreBy[cid], hf=cp*M.satT(K.sat,cs.pCore);
        return (M.coreInH(s,cid) + cp*cs.coreDT - hf)/hfg; };
      const vHot=()=>{ const v=s.coreBy[cid].nV; let m=0; for(let k=0;k<v.length;k++) if(v[k]>m) m=v[k]; return m; };
      const fast=()=>s.parts.vd+s.parts.dop+s.parts.mod;
      console.log("\n── rbmk  load "+f(L,2)+"  aV "+f(d.aV,0)+" pcm  aM "+f(d.aM,1)+"  rated "+f(P.rated,0)+
        " MWt  dT0 "+K.dT0+"  aF "+K.aF+"  netRef "+f(P.netRef,0)+" kg/s ──");
      console.log("    t      n    rho     vd    dop    mod     xe   vNode   vHot    sub    xOut   flow    drumP  lvl    MWe   trip");
      const line=t=>{ const cs=s.coreBy[cid];
        console.log("  "+f(t,1).padStart(5)+" "+f(s.n,3).padStart(6)+" "+f(s.rho,0).padStart(6)+" "+
          f(s.parts.vd,0).padStart(6)+" "+f(s.parts.dop,0).padStart(6)+" "+f(s.parts.mod,0).padStart(6)+" "+
          f(s.parts.xe,0).padStart(6)+" "+f(cs.vNode,3).padStart(6)+" "+f(vHot(),3).padStart(6)+" "+
          f(sub(),1).padStart(6)+" "+f(xOut(),3).padStart(7)+" "+f(s.flowNet,2).padStart(6)+" "+
          f(b?M.boilerP(s,b):0,2).padStart(7)+" "+f(b?M.boilerLvl(s,b):0,0).padStart(4)+" "+
          f(M.mwE(s),0).padStart(6)+"  "+(s.trip||"")+(s.breach?" BREACH":"")); };
      if(L!==1) M.act("loadDem",L);
      let dead=null;
      const march=(secs,t0)=>{ for(let k=1;k<=secs*50;k++){ const t=t0+k*0.02;
          M.step(0.02); if(k%(every*50)===0) line(t);
          if(s.breach){ dead="BREACH "+f(t,1); line(t); return t; } } return t0+secs; };
      line(0);
      let t=march(settle,0);
      if(!dead){
        /* the static coefficient: the same algebra plantSettle() seeds on, at heat and heat x 1.01 */
        const cs=s.coreBy[cid];
        const cl=o=>{ const c={}; for(const k in o){ const v=o[k]; c[k]=ArrayBuffer.isView(v)?v.slice():v; } return c; };
        const at=q=>{ const c=cl(cs); let o=null;
          for(let p=0;p<5;p++){ o=M.coreStep(K,c,0,q,M.satT(K.sat,c.pCore),0,K.flowK*c.flowNet,
                Math.max(c.flowNet,0.004),M.coreInH(s,cid));
            for(let k=0;k<c.nV.length;k++){ c.nV[k]=c.nVt[k]; c.nTc[k]=c.nTct[k]; } }
          return o; };
        const a=at(cs.heat), c2=at(cs.heat*1.01);
        const dStat=(c2.vd+c2.dop+c2.mod)-(a.vd+a.dop+a.mod);
        console.log("  STATIC  d(vd+dop+mod) "+f(dStat,1)+" pcm per 1 % power   vd "+f(c2.vd-a.vd,1)+
          "  dop "+f(c2.dop-a.dop,1)+"  mod "+f(c2.mod-a.mod,1)+"   "+(dStat>0?"POSITIVE":"negative"));
        const n0=s.n, f0=fast();
        for(const id in D.blocks) if(D.blocks[id].mode==="sink" && D.blocks[id].sink==="rodStep") M.act("blkOn",id);
        M.act("rodCommon",s.rodPos+stepRod);
        console.log("  ── rods frozen at "+f(s.rodDem,3)+", step "+f(stepRod,3)+" ──");
        t=march(after,t);
        const dn=s.n-n0, dF=fast()-f0;
        console.log("  MEASURED  dn "+f(dn*100,2)+" % power   d(vd+dop+mod) "+f(dF,1)+" pcm   coefficient "+
          (Math.abs(dn)>1e-4?f(dF/(dn*100),1)+" pcm/%":"-")+"   "+
          (Math.abs(dn)>1e-4?(dF/dn>0?"POSITIVE":"negative"):"-")+
          "   n "+f(n0,3)+" -> "+f(s.n,3)+"  "+(Math.abs(s.n-n0)<Math.abs(dn)?"returned":"walked"));
      }
      console.log("  end   "+(dead||"no event")+"   n "+f(s.n,3)+"  trip "+(s.trip||"-"));
    }
  },
  loophead(){
    const A=(k,d)=>{const a=process.argv.find(x=>new RegExp("^--"+k+"=").test(x)); return a===undefined?d:a.split("=")[1];};
    const i=+A("pre",0), at=+A("at",5);
    M.plantPreset(i); M.buildLayout(); M.commission();
    const s=M.S(); s.diceOff=true;
    const P=M.P();
    run(s,at);
    const sol=M.netSolve(P.net,s), b=sol.b, edges=sol.net.edges;
    const drop={}; for(let e=0;e<edges.length;e++){ const ed=edges[e];
      if(ed.key) drop[ed.key]=(drop[ed.key]||0)+Math.abs(b[ed.u]-b[ed.v]); }
    const pp=M.netPressures(s);
    console.log("");
    console.log("-- loophead  "+M.PLANTPRE()[i][0]+"  t "+f(at,1)+" s  netRef "+f(P.netRef,1)+
      "  flowK "+f(P.flowK,4)+"  n0 "+f(P.n0,4)+"  flowNet "+f(s.flowNet,4)+
      "  RED "+(M.designIssues().filter(q=>q[0]==="RED"||q[0]==="HARD").map(q=>q[0]).join("/")||"0")+" --");
    const L=M.loopMap();
    for(const id of M.pumpIds()){
      if(L.partLoop[id]===undefined) continue;
      const o={}, guess=M.loopHeadOf(id,o);
      const q=(s.pumpQBy&&s.pumpQBy[id])||0, rated=M.pumpFlow(id);
      const solved=(pp[M.pumpDisNode(id)]||0)-(pp[M.pumpSucNode(id)]||0);
      console.log("  "+id+"  bought "+f(M.pumpHead(id),4)+"  guess "+f(guess,4)+"  solved dp "+f(solved,4)+
        "  q/rated "+f(q/Math.max(rated,1e-9),3)+"  rated "+f(rated,1)+"  w(design) "+f(o.w,1)+
        "  rhoHot "+f(o.rhoHot,1)+"  rhoCold "+f(o.rhoCold,1)+"  boils "+(!!o.boils));
      console.log("    run                                 guessMPa   rho_g  hot   solvMPa   rho_s     x");
      const by=o.byRun||{}, keys=Object.keys(by).sort((a,c)=>by[c].dp-by[a].dp);
      for(const k of keys){ const g=by[k];
        const isPart=k.indexOf("part:")===0;
        const nd=isPart?null:M.runNodeOf(k);
        const sd=isPart?null:drop[k];
        const rs=nd&&pp[nd]!==undefined?M.netRhoAt(s,nd):null;
        const x =nd&&pp[nd]!==undefined?M.netQualAt(s,nd):null;
        console.log("    "+k.padEnd(34)+f(g.dp,4).padStart(9)+f(g.rho,1).padStart(8)+
          (g.hot?"  HOT":"     ")+f(sd,4).padStart(10)+f(rs,1).padStart(8)+f(x,3).padStart(7)); }
    }
  },
  ledger(){
    const pre=(process.argv.find(a=>/^--pre=/.test(a))||"").split("=")[1];
    const node=(process.argv.find(a=>/^--node=/.test(a))||"").split("=")[1];
    const ticks=+((process.argv.find(a=>/^--ticks=/.test(a))||"").split("=")[1])||8;
    const tol=+((process.argv.find(a=>/^--kg=/.test(a))||"").split("=")[1])||0.5;
    const from=+((process.argv.find(a=>/^--from=/.test(a))||"").split("=")[1])||0;
    let s;
    if(pre!==undefined&&pre!==""){ M.plantPreset(+pre); M.buildLayout(); M.commission(); s=M.S(); s.diceOff=true; }
    else s=withPlant(null);
    const net=M.P().net, bk=M.netBooked(net), bookOf=M.netBookOf(net);
    const group=i=>bk[i]===2?null:(bookOf[i]||net.name[i]);
    // every condenser face reads the one pool (bookedKg), so the hotwell is taken once
    const snap=()=>{ const g={}; let pool=false;
      for(let i=0;i<net.n;i++){ const k=group(i); if(!k) continue;
        if(k==="C"){ if(pool) continue; pool=true; }
        const v=bk[i]?M.bookedKg(net,s,i):s.mBy[net.name[i]];
        if(v!==undefined) g[k]=(g[k]||0)+v; }
      return g; };
    const cum={}, ni=node?net.index[node]:undefined;
    const tankOf=k=>k.indexOf("T:")===0?k.slice(2):null;
    const lift=(process.argv.find(a=>/^--lift=/.test(a))||"").split("=")[1];
    const bo=(process.argv.find(a=>/^--blackout=/.test(a))||"").split("=")[1];
    const every=+((process.argv.find(a=>/^--every=/.test(a))||"").split("=")[1])||0;
    const at=+((process.argv.find(a=>/^--at=/.test(a))||"").split("=")[1])||0;
    let drift0=null, drift0Vent=0; const seen={};
    console.log("\n── ledger closure, "+(pre!==undefined&&pre!==""?M.PLANTPRE()[+pre][0]:"stock plant")+" ──");
    for(let k=0;k<PSEC*50;k++){
      const t=k*0.02;
      if(lift&&k===250){ s.reliefOpen[lift]=true; s.reliefAuto[lift]=false; drift0=M.ledgerKg(s)+M.ledgerOut(s); drift0Vent=s.massOut.sgVent||0; }
      if(bo!==undefined&&bo!==""&&k===Math.round(+bo*50)){ M.act("blackout",true); drift0=M.ledgerKg(s)+M.ledgerOut(s); }
      const before=snap();
      M.step(0.02);
      for(const [key,on] of [["blackout",s.blackout],["turbTrip",s.turbTrip],["condLost",s.condLost],["scram",s.scrammed],["breach",s.breach],
                             ["sgBurst",s.sgBurst&&Object.keys(s.sgBurst).some(id=>s.sgBurst[id])]])
        if(on&&!seen[key]){ seen[key]=true; console.log("  "+key+" at "+f(t,2)+" s"); }
      const after=snap(), moved={}, ek=M.advectEdgeKgOf();
      if(ek) for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e], m=ek[e]; if(!m) continue;
        const gu=group(ed.u), gv=group(ed.v); if(gu===gv) continue;
        if(gu) moved[gu]=(moved[gu]||0)-m; if(gv) moved[gv]=(moved[gv]||0)+m; }
      const bad=[];
      for(const g in after){ const r=(after[g]-(before[g]||0))-(moved[g]||0);
        if(k>=from*50) cum[g]=(cum[g]||0)+r; if(Math.abs(r)>tol) bad.push(g+" "+f(r,1)); }
      const win=k>=at*50&&k<at*50+ticks; if(win||bad.length){
        let line="tick "+(k+1)+": res "+f(s.massRes,3)+" kg";
        if(bad.length) line+="  | "+bad.join(", ");
        if(ni!==undefined){ const F=net.F;
          line+="\n    "+node+": m "+f(s.mBy[node],2)+" h "+f(s.hBy[node],1)+" p "+f(s.pBy&&s.pBy[node],3)+
            " F.p "+f(F.p[ni],3)+" rho "+f(F.rho[ni],1)+" x "+f(F.x[ni],3)+" wet "+F.wet[ni];
          if(ek) for(let e=0;e<net.edges.length;e++){ const ed=net.edges[e]; if(ed.u!==ni&&ed.v!==ni) continue;
            const h=typeof ed.h==="function"?ed.h(s):(ed.h||0);
            line+="\n      "+(ed.key||ed.kind)+" "+net.name[ed.u]+"("+f(F.p[ed.u],4)+",w"+F.wet[ed.u]+",m"+f(s.mBy[net.name[ed.u]],2)+")->"+
              net.name[ed.v]+"("+f(F.p[ed.v],4)+",w"+F.wet[ed.v]+",m"+f(s.mBy[net.name[ed.v]],2)+") h "+f(h,4)+" moved "+f(ek[e],3)+" kg"; } }
        for(const g in after){ const t=tankOf(g); if(!t) continue;
          line+="\n    "+t+": lvl "+f(M.tankLvl(s,t),3)+" % rate "+f(s.tankRate[t],2)+" landed "+f(M.advectLanded(net.tankNode[t]),3)+" kg"; }
        if(win) console.log(line); else console.log(line.split("\n")[0]); }
      if(process.argv.some(a=>a==="--tanks")) for(const g in after){ const t=tankOf(g); if(!t) continue;
        const l=M.advectLanded(net.tankNode[t]); if(Math.abs(l)>0.01||Math.abs(s.tankRate[t])>0.01)
          console.log("    "+(k+1)+" "+t+": lvl "+f(M.tankLvl(s,t),3)+" % rate "+f(s.tankRate[t],3)+" landed "+f(l,3)+" kg  clampPri "+f(s.massOut.tankClampPri,2)); }
      if(every&&(k+1)%(every*50)===0) console.log("  "+f(t+0.02,1)+" s: condT "+f(s.condT,2)+" condP "+f(s.condP,4)+" turbP "+f(s.turbP,4)+
        " load "+f(s.load,3)+" MWe "+f(M.mwE(s),1)+" sgP "+f(M.secP(s,M.sgIds()[0]),3)+" P "+f(s.P,3)+" lvl "+f(s.lvl,2)+
        " tanks "+M.tankIds().map(t=>t+" "+f(M.tankLvl(s,t),3)).join(" ")+
        " open "+Object.keys(s.reliefOpen).filter(k=>s.reliefOpen[k]).join(","));
    }
    console.log(" cumulative residual by book from "+from+" s to "+PSEC+" s (|r| > "+tol+" kg):");
    const keys=Object.keys(cum).filter(g=>Math.abs(cum[g])>tol).sort((a,b)=>Math.abs(cum[b])-Math.abs(cum[a]));
    if(!keys.length) console.log("  none");
    for(const g of keys) row(g,f(cum[g],2));
    row("ledgerKg",f(M.ledgerKg(s),1)); row("ledgerOut",f(M.ledgerOut(s),1));
    if(drift0!==null){ row("drift since order",f(M.ledgerKg(s)+M.ledgerOut(s)-drift0,2)+" kg");
      if(lift) row("sgVent since lift",f((s.massOut.sgVent||0)-drift0Vent,1)+" kg"); }
    for(const n in s.massOut) if(Math.abs(s.massOut[n])>tol) row("  massOut."+n,f(s.massOut[n],2));
  },
};

const args=process.argv.slice(2).filter(a=>!/^--(?!list$)/.test(a));
const PSEC=+((process.argv.find(a=>/^--secs=/.test(a))||"").split("=")[1])||600;
if(args[0]==="--list"){ console.log(Object.keys(CASES).join("\n")); process.exit(0); }
const pick=args.length?args:["stock"];
for(const k of pick){
  if(!CASES[k]){ console.log("no case named "+k+" (--list)"); continue; }
  CASES[k]();
}
