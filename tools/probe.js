#!/usr/bin/env node
// node tools/probe.js [caseName ...] | --list | --secs=N
const M=require('./bundle').headless(
 '{commission,resetPlant,step,derived,ST:()=>ST,PT:()=>PT,IX:()=>IX,P:()=>P,D:()=>D,LAY:()=>LAY,'+
 'addMachine,removePart,seedPort,seedRun,buildLayout,buildStockPlumbing,buildStockAutomation,pipeNetwork,nodeGraph,'+
 'crossTies,selfRuns,designIssues,loopMap,tankIds,tankKg,partName,turbCount,condCount,circName,radIds,'+
 'plantPreset,latPreset,act,actId,coreD,latRevolve,archPreset,PLANTPRE:()=>PLANTPRE,tsatSec,'+
 'ANN:()=>ANN,designForget,coreMint,pumpIds,secGensOf,pumpHead,pumpFlow,loopHeadOf,pumpSucNode,pumpDisNode,'+
 'runNodeOf,holdSetP,drumIds,boilerIds,sgIds,boilerDesignP,sgBurstP,'+
 'eNodeT,eNodeX,eNodeRho,eNodeP,eMwE,eMWe,eBoilerP,eBoilerLvl,eSecP,eTankLvl,eLedgerKg,eLedgerOut,eSgLiftP,eFuelStage,eAnnStep,'+
 'uiRunKgs,uiNodeP,uiBlkSinkOff,uiTripText,uiDmgWhy,E_BK_NAMES:()=>E_BK_NAMES,E_FAIL_N:()=>E_FAIL_N,E_TXT_WHY:()=>E_TXT_WHY,nodeW:()=>nodeW,'+
 'XNN:()=>XNN,XE_CLOCK:()=>XE_CLOCK,RP_N:()=>RP_N,RP_XE:()=>RP_XE,RP_VD:()=>RP_VD,RP_DOP:()=>RP_DOP,RP_MOD:()=>RP_MOD,GW:()=>GW,snapS,restoreS}');

const D=M.D();
const BASE=JSON.parse(JSON.stringify(D));
const ST=()=>M.ST(), PT=()=>M.PT(), IX=()=>M.IX(), sc=()=>M.ST().sc;

/* the ship the bench's preset buttons build, through the same door: an open-coded build is a second plant that drifts from the one the game flies */
function withPlant(build, opts){
  Object.assign(D,JSON.parse(JSON.stringify(BASE)));
  M.plantPreset((opts&&opts.pre)||0);
  if(build) build(M);
  M.buildLayout();
  M.commission();
}
/* NOT a preset ship: no PLANTPRE row states a stock plant with four loops */
function withStockLoops(loops){
  Object.assign(D,JSON.parse(JSON.stringify(BASE)));
  M.buildStockPlumbing({loops});
  M.buildLayout();
  M.buildStockAutomation();
  M.commission();
}
const run=secs=>{ for(let i=0;i<secs*50;i++){ M.step(0.02); if(sc()[SC_BREACH]) break; } };
const diceOff=()=>{ sc()[SC_DICEOFF]=1; };

const f=(v,d)=>(v===null||v===undefined||Number.isNaN(v))?"-":(+v).toFixed(d===undefined?3:d);
const row=(...c)=>console.log("  "+c.map((x,i)=>String(x).padEnd(i?14:22)).join(""));
const wreckedList=()=>{ const s=ST(), out=[]; for(let a=0;a<s.dmgBy.length;a++) if(s.dmgBy[a]) out.push(IX().partId[a]+" "+M.E_TXT_WHY()[s.dmgWhy[a]]); return out; };
const fuelShare=c=>{ const out=new Float64Array(M.E_FAIL_N()), w=M.nodeW(); let t=0;
  for(let k=0;k<M.XNN();k++){ out[M.eFuelStage(c,k)]+=w[k]; t+=w[k]; }
  for(let q=0;q<out.length;q++) out[q]/=t||1; return out; };

function dump(label){
  const s=ST(), S=sc(), pt=PT(), ix=IX();
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
  row("Tavg K",f(S[SC_TAVG],2)); row("P MPa",f(S[SC_P],4));
  row("inventory %",f(S[SC_INV],2)); row("pzr level %",f(S[SC_LVL],2));
  { let m=0; for(let i=0;i<s.mBy.length;i++) if(s.mBy[i]===s.mBy[i]) m+=s.mBy[i]; row("node mass kg",f(m,1)); }
  row("shaft MW",f(M.eMwE(),2)); row("electric MW",f(M.eMWe(),2));
  row("cond T K",f(S[SC_CONDT],2)); row("cw in K",f(S[SC_CWINT],2));
  row("release",f(S[SC_RELEASE],5)); row("breach",!!S[SC_BREACH]);
  if(pt.n.core>1){
    console.log(" VESSELS");
    for(let c=0;c<pt.n.core;c++){ const ci=pt.coreCirc[c];
      row(ix.coreId[c], "n "+f(s.csN[c],3)+"  Tavg "+f(s.TavgBy[ci],2)+"  P "+f(s.PBy[ci],4)+"  inv "+f(s.invBy[ci],1)+
        "  sc "+f(s.scBy[ci],1)+"  flow "+f(s.csFlowNet[c],3)+"  rods "+f(s.csRodPos[c],3)+(s.csScrammed[c]?"  SCRAMMED "+M.uiTripText(ix.coreId[c]):"")); } }

  console.log(" POTS");
  for(let q=0;q<pt.n.cond;q++) row("cond "+ix.condId[q]+" K",f(s.condTBy[q],2)+"  cw in "+f(s.cwInTBy[q],2)+" K");
  for(let x=0;x<pt.n.ihx;x++) row("ihx "+ix.ihxId[x], "crosses "+f(s.ihxQBy[x]/1000,1)+" MW");
  for(let r=0;r<pt.n.rad;r++) row("rad "+ix.radId[r], "T "+f(s.radTBy[r],2)+"  takes "+f(s.radQBy[r]/1000,1)+" MW");
  for(let b=0;b<pt.n.boiler;b++) row("boiler "+ix.boilerId[b], "T "+f(s.sgTBy[b],2)+"  lvl "+f(M.eBoilerLvl(b),1)+"  P "+f(M.eBoilerP(b),4));

  console.log(" TANKS");
  for(let t=0;t<pt.n.tank;t++){ const id=ix.tankId[t];
    row(id, "circ "+M.circName(pt.tankCirc[t])+"  "+f(M.eTankLvl(t),1)+" %  "+f(M.tankKg(id),0)+" kg"); }

  console.log(" NODES   T K / quality / holdup m3");
  for(let i=0;i<pt.n.node;i++){ const nm=ix.nodeId[i];
    if(nm.indexOf("cont:")===0) continue;
    const has=s.hBy[i]===s.hBy[i];
    row(nm, (has?f(M.eNodeT(i),1):"-")+" K   x="+(has?f(M.eNodeX(i),2):"-")+"   "+f(pt.nodeVol[i],2)+" m3"); }

  console.log(" RUNS");
  for(const r of M.pipeNetwork()){ const w=M.uiRunKgs(r.key);
    row(r.k+" "+r.key.slice(0,40), w===undefined ? "-" : f(w,2)+" kg/s"); }

  console.log(" STEAM   MPa");
  for(let b=0;b<pt.n.boiler;b++) row(ix.boilerId[b]+" boiler", f(M.eBoilerP(b),4));
  row("turbine", f(S[SC_TURBWK],2)+" kg/s at "+f(S[SC_TURBP],4)+" MPa");
  row("ledger residual", f(S[SC_MASSRES],4)+" kg last tick");
  row("energy residual", f(S[SC_ENRES],2)+" kJ last tick");

  console.log(" DESIGN");
  const issues=M.designIssues?M.designIssues():[];
  for(const w of issues) row(w[0], String(w[1]).slice(0,90));
  if(M.crossTies().length) row("cross-ties", JSON.stringify(M.crossTies()));
  if(M.selfRuns().length) row("self runs", M.selfRuns().join(" "));
}

const CASES={
  stock(){ withPlant(null); run(PSEC); dump("STOCK PWR preset"); },
  // three equal charges 1 s apart beside the first pump: the scar sum after each, the sets they left, a hit's set, the snapshot
  blast(){
    withPlant(null); run(2);
    const s=ST(), GW=M.GW(), pump=M.LAY().parts.find(p=>p.role==="pump");
    const cx=pump.x-3, cy=pump.y+(pump.h>>1), ci=cy*GW+cx;
    const kPa=+((process.argv.find(a=>/^--kpa=/.test(a))||"").split("=")[1])||500;
    const sum=a=>{ let t=0; for(let i=0;i<a.length;i++) t+=a[i]; return t; };
    console.log(" BLAST  "+kPa+" kPa at cell "+cx+","+cy+", beside "+pump.id);
    const reads=[];
    for(let k=0;k<3;k++){ M.act("blast",ci,kPa); run(1); reads.push(sum(s.roomScar));
      row("scar sum "+(k+1), f(reads[k],0)+" kPa", "ratio "+f(reads[k]/reads[0],3)); }
    for(const w of wreckedList()) row(w);
    run(3);
    const tgt=M.LAY().parts.find(p=>p.role!=="fitting" && !s.dmgBy[IX().part.get(p.id)]);
    if(tgt){ M.actId("hit",tgt.id); run(0.1);
      row("hit "+tgt.id, s.dmgBy[IX().part.get(tgt.id)] ? "wrecked" : "NOT wrecked"); }
    else row("hit", "no part left standing");
    const scar=ST().roomScar.slice(), snap=M.snapS(); M.restoreS(snap);
    const r=ST().roomScar; let same=r.length===scar.length;
    for(let i=0;same && i<r.length;i++) if(r[i]!==scar[i]) same=false;
    row("snapshot roomScar", same ? "bit-exact" : "DIFFERS");
  },
  dual(){
    const i=M.PLANTPRE().findIndex(p=>p[0]==="DUAL");
    M.plantPreset(i); M.buildLayout(); M.commission();
    run(PSEC); dump("DUAL - 2 units, 1 set");
    console.log(" COUNTS  parts "+M.LAY().parts.length+"  turb "+M.turbCount()+
      "  cond "+M.condCount()+"  rad "+M.radIds().length+"  grid "+M.D().gw+"x"+M.D().gh);
  },
  blank(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.buildLayout(); M.commission();
    run(PSEC); dump("blank grid");
    console.log(" COUNTS  parts "+M.LAY().parts.length+"  turb "+M.turbCount()+"  cond "+M.condCount()+"  rad "+M.radIds().length);
  },
  counts(){
    withPlant(M=>{
      M.addMachine("cond",2,2); M.addMachine("radiator",2,8);
      M.addMachine("radiator",2,12); M.addMachine("turb",40,2);
    });
    run(1);
    console.log("\n── counts ──");
    console.log(" turb "+M.turbCount()+"  cond "+M.condCount()+"  rad "+M.radIds().length);
    for(const p of M.LAY().parts) if(["turb","cond","radiator","pump","sg"].includes(p.role))
      console.log("  "+p.id.padEnd(10)+M.partName(p));
  },
  rides(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.buildLayout();
    const say=t=>console.log("  "+t.padEnd(30)+(M.LAY().parts.map(p=>p.id).join(" ") || "(nothing)"));
    console.log("\n── a rider rides ──");
    say("blank grid");
    M.addMachine("core",6,13);  say("ADD REACTOR");
    M.addMachine("core",30,13); say("ADD REACTOR again");
    M.removePart("rods2");      say("REMOVE on the 2nd's drives");
    M.removePart("core1");      say("REMOVE on the 1st reactor");
  },
  loops4(){ withStockLoops(4); run(PSEC); dump("stock plant, 4 loops"); },
  /* the axial xenon wave in the plant: rod control stood down, boron and load held, dice off; one bank driven in by --kick
     of travel for --hold real hours and back. --core=stock is STOCK PWR, --core=tall its COMPACT lattice at H/D 2.0.
     Every AO turning point is kept; the period and the stability index ln(A2/A1)/T between like turning points are read
     in real hours (x XE_CLOCK). A march past the 10 s budget carries in slices: rerun with --resume until no @@MORE. */
  xeosc(){
    const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith("--"+k+"=")); return a ? a.split("=")[1] : d; };
    const which=arg("core","stock"), kick=+arg("kick",0.10), hold=+arg("hold",1), every=+arg("every",60);
    const fs=require("fs"), path=require("path"), os=require("os"), t0=Date.now();
    const fBin=path.join(os.tmpdir(),"rc-probe-xeosc-"+which+".bin"), fJs=fBin.replace(/bin$/,"json");
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.plantPreset(0);
    if(which==="tall"){ const c=M.coreD("core"); M.latPreset(c,1); c.lat.len=2*c.lat.len/1.4; M.latRevolve(c); }
    M.buildLayout(); M.commission();
    const s=ST(), P=M.P(), nb=PT().coreNB[0], K=M.XE_CLOCK(), hrs=t=>t*K/3600;
    let A;
    if(process.argv.includes("--resume") && fs.existsSync(fBin)){ M.restoreS(new Uint8Array(fs.readFileSync(fBin))); A=JSON.parse(fs.readFileSync(fJs,"utf8")); }
    else {
      diceOff();
      for(const id in D.blocks) if(D.blocks[id].mode==="sink" && D.blocks[id].sink==="rodStep") M.actId("blkOn",id);
      const c=M.coreD("core"), H=c.lat.len, Lm=Math.sqrt(P.cores.core.m2)/100;
      console.log("\n── axial xenon, "+which+" ──  H/D "+f(c.hd,2)+"  H/M "+f(H/Lm,1)+"  burnout "+f(M.derived().sigK,2)+"  banks "+nb+"  kick "+kick+" for "+hold+" h");
      console.log("    t s   t h     ao%      n      fq");
      A={b:nb-1, z0:s.csRodZ[nb-1], on:false, off:false, last:[], turn:[]}; }
    const tOn=1, tOff=tOn+hold*3600/K, SEC=PSEC;
    for(let k=Math.round(sc()[SC_T]*50);k<=SEC*50;k++){ const t=k*0.02;
      if(!A.on && t>=tOn){ M.act("split",true); M.act("rodBank",A.b,Math.min(1,A.z0+kick)); A.on=true; }
      if(A.on && !A.off && t>=tOff){ M.act("rodBank",A.b,A.z0); A.off=true; }
      if(k%50===0){ const ao=sc()[SC_AO], L=A.last; L.push(ao); if(L.length>3) L.shift();
        const q=A.turn[A.turn.length-1];
        if(A.off && L.length===3 && (L[1]-L[0])*(L[2]-L[1])<0 && (!q || Math.abs(L[1]-q[1])>1e-4)) A.turn.push([t-1,L[1]]); }
      if(k%(every*50)===0)
        console.log("  "+String(Math.round(t)).padStart(5)+"  "+f(hrs(t),1).padStart(5)+"  "+f(sc()[SC_AO]*100,2).padStart(7)+"  "+f(sc()[SC_N],3).padStart(6)+"  "+f(sc()[SC_FQ],3));
      if(Date.now()-t0>7000){ fs.writeFileSync(fBin,Buffer.from(M.snapS())); fs.writeFileSync(fJs,JSON.stringify(A)); console.log("@@MORE"); return; }
      M.step(0.02); }
    for(const g of [fBin,fJs]) if(fs.existsSync(g)) fs.unlinkSync(g);
    console.log("  turning points (h, ao%): "+A.turn.map(q=>f(hrs(q[0]),1)+" "+f(q[1]*100,2)).join("   "));
    const T=A.turn, sgn=T.slice(1).some((q,i)=>q[1]*T[i][1]<0);
    for(let i=2;i<T.length;i++){ const per=hrs(T[i][0]-T[i-2][0]), a1=T[i-2][1]-T[i-1][1], a2=T[i][1]-T[i-1][1];
      console.log("  period "+f(per,1)+" h   stability index "+f(Math.log(Math.abs(a2/a1))/per,4)+" /h"); }
    console.log("  AO changes sign past the kick: "+(sgn?"yes":"no"));
  },
  presets(){
    const PRE=M.PLANTPRE();
    const only=(process.argv.find(a=>/^--pre=/.test(a))||"").split("=")[1];
    const pick=only?only.split(",").map(Number):PRE.map((_,i)=>i);
    console.log("\nname        MWe    Tavg    shell P / design  lift  burst   sgLvl  dmg   residual kg   died");
    for(const i of pick){
      M.plantPreset(i); M.buildLayout(); M.commission();
      const s=ST(), S=sc(); diceOff();
      let died="-", t=0, worst=0;
      const reds=[]; M.ANN().forEach((a,r)=>{ if(a[1]==="red") reds.push(r); });
      for(let k=0;k<PSEC*50;k++){ M.step(0.02); t=k*0.02;
        if(Math.abs(S[SC_MASSRES])>Math.abs(worst)) worst=S[SC_MASSRES];
        M.eAnnStep();
        const red=reds.find(r=>s.annOn[r]);
        if(red!==undefined)               { died=M.ANN()[red][0]+" "+t.toFixed(0)+"s"; break; }
        if(S[SC_BREACH])                  { died="BREACH "+t.toFixed(0)+"s"; break; }
        if(PT().n.sg && s.sgBurst[0])     { died="SG BURST "+t.toFixed(0)+"s"; break; }
        if(S[SC_TURBTRIP])                { died="TURB TRIP "+t.toFixed(0)+"s"; break; }
        if(S[SC_CONDLOST])                { died="VACUUM "+t.toFixed(0)+"s"; break; }
        if(S[SC_SCRAMMED])                { died="SCRAM "+t.toFixed(0)+"s"; break; }
        if(S[SC_DMG]>1)                   { died="DAMAGE "+t.toFixed(0)+"s"; break; } }
      const id=M.boilerIds()[0], dp=M.boilerDesignP(), sp=PT().n.boiler?M.eBoilerP(0):0;
      console.log(PRE[i][0].padEnd(12)+f(M.eMWe(),0).padStart(6)+f(S[SC_TAVG],1).padStart(8)+
        (f(sp,3)+" /"+f(dp,2)).padStart(15)+f(sp/Math.max(dp,1e-9),3).padStart(7)+
        f(M.eSgLiftP(),2).padStart(6)+f(id?M.sgBurstP(id):NaN,2).padStart(7)+
        (PT().n.boiler?f(M.eBoilerLvl(0),0):"-").padStart(7)+f(S[SC_DMG],1).padStart(6)+f(worst,4).padStart(14)+"   "+died);
    }
  },
  excursion(){
    const pks=((process.argv.find(a=>/^--pk=/.test(a))||"").split("=")[1]||"").split(",").filter(Boolean).map(Number);
    const at=+((process.argv.find(a=>/^--blackout=/.test(a))||"").split("=")[1]||20);
    const every=+((process.argv.find(a=>/^--every=/.test(a))||"").split("=")[1]||5);
    const i=M.PLANTPRE().findIndex(p=>p[0]==="RBMK-1000");
    for(const pk of (pks.length?pks:[null])){
      M.plantPreset(i);
      const c=M.coreD("core");
      if(pk!==null){ c.lat.pitch=pk*M.coreD("core").lat.pitch; M.latRevolve(c); }
      M.buildLayout(); M.commission();
      const s=ST(), S=sc(), P=M.P(), d=M.derived();
      diceOff();
      console.log("\n── excursion  pk "+(pk===null?"preset":pk)+"  aV "+f(d.aV,0)+" pcm  aM "+f(d.aM,1)+"  beta "+f(P.BETA*1e5,0)+"  rated "+f(P.rated,0)+" MWt ──");
      M.uiBlkSinkOff("scram");
      const rods=(process.argv.find(a=>/^--rods=/.test(a))||"").split("=")[1];
      if(rods!=="keep"){
        for(const id in D.blocks) if(D.blocks[id].mode==="sink" && D.blocks[id].sink==="rodStep") M.actId("blkOn",id);
        M.act("rodCommon",+(rods||0)); }
      const scram=process.argv.includes("--scram");
      let pkN=0,pkP=0,pkTf=0,tEnd=null;
      console.log("    t      n     rho   rods    vf     P MPa   TfHot   dmg%  melt%    xe    vd   sc K    ledger+out   h2 kg  rmP kPa  rmT K  tube%  trip");
      const line=t=>{ let rmP=0; for(let j=0;j<s.roomP.length;j++) if(s.roomP[j]>rmP) rmP=s.roomP[j];
        console.log("  "+f(t,1).padStart(5)+"  "+f(S[SC_N],3).padStart(6)+"  "+f(S[SC_RHO],0).padStart(5)+"  "+f(S[SC_RODPOS],2).padStart(5)+"  "+f(S[SC_VF],3).padStart(5)+"  "+f(S[SC_PCORE],3).padStart(7)+"  "+f(S[SC_TFHOT],0).padStart(6)+"  "+f(S[SC_DMG],1).padStart(5)+"  "+f(S[SC_MELTFRAC]*100,1).padStart(5)+"  "+f(s.parts[M.RP_XE()],0).padStart(5)+"  "+f(s.parts[M.RP_VD()],0).padStart(5)+"  "+f(S[SC_SC],1).padStart(5)+"  "+f(M.eLedgerKg()+M.eLedgerOut(),0).padStart(12)+"  "+f(S[SC_H2],1).padStart(6)+"  "+f(rmP,1).padStart(7)+"  "+f(S[SC_ROOMMAX],0).padStart(5)+"  "+f(s.csTubesOpen[0]*100,0).padStart(5)+"  "+M.uiTripText()); };
      for(let k=0;k<=PSEC*50;k++){ const t=k*0.02;
        if(k===at*50){ if(scram) M.act("scram"); else M.act("blackout",true); }
        if(k%(every*50)===0) line(t);
        M.step(0.02);
        if(S[SC_N]>pkN) pkN=S[SC_N]; if(S[SC_PCORE]>pkP) pkP=S[SC_PCORE]; if(S[SC_TFHOT]>pkTf) pkTf=S[SC_TFHOT];
        if(S[SC_BREACH] && tEnd===null){ tEnd=t; line(t); if(!process.argv.includes("--on")) break; } }
      const st=fuelShare(0);
      console.log("  peak n "+f(pkN,3)+"   peak P "+f(pkP,3)+" MPa   peak Tf "+f(pkTf,0)+" K");
      console.log("  fuel  "+Array.from(st).map((v,q)=>q+" "+f(v*100,1)+"%").join("  ")+"   h2 "+f(S[SC_H2],1)+" kg");
      console.log("  end   "+(tEnd===null?"no event in "+PSEC+" s":M.uiTripText()+" at "+f(tEnd,1)+" s")+"   ledger "+f(M.eLedgerKg(),0)+" kg  out "+f(M.eLedgerOut(),0)+" kg");
      console.log("  wrecked "+(wreckedList().join("  ")||"nothing"));
      console.log("  books "+M.E_BK_NAMES().map((n,q)=>[n,s.massOut[q]]).filter(e=>Math.abs(e[1])>1).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6).map(e=>e[0]+" "+f(e[1],0)).join("  "));
    }
  },
  /* NOT a preset ship: no PLANTPRE row states a one-loop drum plant */
  drum(){
    Object.assign(D,JSON.parse(JSON.stringify(BASE)));
    M.designForget();
    const core=M.coreMint(); M.archPreset(core,1);       // a boiling core: a drum on a subcooled loop separates nothing
    M.buildStockPlumbing({loops:1, drum:true, core});
    M.buildLayout(); M.buildStockAutomation(); M.commission();
    const s=ST(), S=sc(); diceOff();
    M.uiBlkSinkOff("scram");
    const ids=M.drumIds(), bs=ids.map(id=>IX().boiler.get(id));
    console.log("\n── one drum on the stock loop, boiling core ──");
    console.log(" drums "+ids.join(" ")+"   boilers "+M.boilerIds().join(" ")+
      "   loops "+M.loopMap().n+"   setpoint "+f(M.holdSetP(M.nodeGraph().coreCirc),3)+" MPa");
    for(const id of M.pumpIds()) if(M.secGensOf(id).length)
      console.log(" "+id+" feeds "+M.secGensOf(id).join(" ")+"   head "+f(M.pumpHead(id),2)+" MPa");
    const line=t=>console.log("  "+f(t,1).padStart(5)+" "+f(S[SC_N],3).padStart(5)+"  "+f(S[SC_FLOWNET],3).padStart(6)+
      " "+f(S[SC_VF],3).padStart(6)+bs.map(b=>"  "+f(M.eBoilerLvl(b),1).padStart(6)+" "+f(M.eBoilerP(b),3).padStart(6)+
      " "+f(s.steamBy[b],1).padStart(7)+" "+f(s.sgFedBy[b],1).padStart(7)+" "+f(s.fregBy[b],3).padStart(6)).join("")+
      (S[SC_SCRAMMED]?"  "+M.uiTripText():"")+(S[SC_BREACH]?"  BREACH":""));
    line(0);
    for(let k=0;k<PSEC*50;k++){ M.step(0.02); if((k+1)%(5*50)===0) line((k+1)*0.02); if(S[SC_BREACH]) break; }
    console.log(" ledger "+f(M.eLedgerKg(),0)+" kg  out "+f(M.eLedgerOut(),0)+" kg  residual "+f(S[SC_MASSRES],3)+" kg");
    console.log(" wrecked "+(wreckedList().join("  ")||"nothing"));
  },
  selfrun(){ withPlant(M=>{
      const a=M.seedPort("turb",1,-1), b=M.seedPort("turb",3,-1);
      M.seedRun(a,b); });
      run(120); dump("a run from a machine back to itself"); },
  rbmk(){
    const A=(k,d)=>{const a=process.argv.find(x=>new RegExp("^--"+k+"=").test(x)); return a===undefined?d:a.split("=")[1];};
    const loads=String(A("load","1")).split(",").map(Number);
    const settle=+A("settle",20), after=+A("after",20), every=+A("every",5), stepRod=+A("step",0.01);
    const i=M.PLANTPRE().findIndex(p=>p[0]==="RBMK-1000");
    for(const L of loads){
      M.plantPreset(i); M.buildLayout(); M.commission();
      const s=ST(), S=sc(), P=M.P(), d=M.derived(); diceOff();
      M.uiBlkSinkOff("scram");
      const RN=M.RP_N(), fast=()=>s.parts[M.RP_VD()]+s.parts[M.RP_DOP()]+s.parts[M.RP_MOD()];
      console.log("\n── rbmk  load "+f(L,2)+"  aV "+f(d.aV,0)+" pcm  aM "+f(d.aM,1)+"  rated "+f(P.rated,0)+" MWt ──");
      console.log("    t      n    rho     vd    dop    mod     xe   vNode   flow    drumP  lvl    MWe   trip");
      const line=t=>console.log("  "+f(t,1).padStart(5)+" "+f(S[SC_N],3).padStart(6)+" "+f(S[SC_RHO],0).padStart(6)+" "+
          f(s.parts[M.RP_VD()],0).padStart(6)+" "+f(s.parts[M.RP_DOP()],0).padStart(6)+" "+f(s.parts[M.RP_MOD()],0).padStart(6)+" "+
          f(s.parts[M.RP_XE()],0).padStart(6)+" "+f(s.csVNode[0],3).padStart(6)+" "+f(S[SC_FLOWNET],2).padStart(6)+" "+
          f(PT().n.boiler?M.eBoilerP(0):0,2).padStart(7)+" "+f(PT().n.boiler?M.eBoilerLvl(0):0,0).padStart(4)+" "+
          f(M.eMWe(),0).padStart(6)+"  "+M.uiTripText()+(S[SC_BREACH]?" BREACH":""));
      if(L!==1) M.act("loadDem",L);
      let dead=null;
      const march=(secs,t0)=>{ for(let k=1;k<=secs*50;k++){ const t=t0+k*0.02;
          M.step(0.02); if(k%(every*50)===0) line(t);
          if(S[SC_BREACH]){ dead="BREACH "+f(t,1); line(t); return t; } } return t0+secs; };
      line(0);
      let t=march(settle,0);
      if(!dead){
        const n0=S[SC_N], f0=fast();
        for(const id in D.blocks) if(D.blocks[id].mode==="sink" && D.blocks[id].sink==="rodStep") M.actId("blkOn",id);
        M.act("rodCommon",S[SC_RODPOS]+stepRod);
        console.log("  ── rods frozen at "+f(S[SC_RODDEM],3)+", step "+f(stepRod,3)+" ──");
        t=march(after,t);
        const dn=S[SC_N]-n0, dF=fast()-f0;
        console.log("  MEASURED  dn "+f(dn*100,2)+" % power   d(vd+dop+mod) "+f(dF,1)+" pcm   coefficient "+
          (Math.abs(dn)>1e-4?f(dF/(dn*100),1)+" pcm/%":"-")+"   "+(Math.abs(dn)>1e-4?(dF/dn>0?"POSITIVE":"negative"):"-"));
      }
      console.log("  end   "+(dead||"no event")+"   n "+f(S[SC_N],3)+"  trip "+(M.uiTripText()||"-"));
    }
  },
  loophead(){
    const A=(k,d)=>{const a=process.argv.find(x=>new RegExp("^--"+k+"=").test(x)); return a===undefined?d:a.split("=")[1];};
    const i=+A("pre",0), at=+A("at",5);
    M.plantPreset(i); M.buildLayout(); M.commission();
    const s=ST(), S=sc(), P=M.P(); diceOff();
    run(at);
    console.log("\n-- loophead  "+M.PLANTPRE()[i][0]+"  t "+f(at,1)+" s  netRef "+f(P.netRef,1)+
      "  flowK "+f(P.flowK,4)+"  n0 "+f(P.n0,4)+"  flowNet "+f(S[SC_FLOWNET],4)+" --");
    const L=M.loopMap();
    for(const id of M.pumpIds()){
      if(L.partLoop[id]===undefined) continue;
      const o={}, guess=M.loopHeadOf(id,o), p=IX().pump.get(id);
      const q=s.pumpQBy[p]||0, rated=M.pumpFlow(id);
      const solved=(M.uiNodeP(M.pumpDisNode(id))||0)-(M.uiNodeP(M.pumpSucNode(id))||0);
      console.log("  "+id+"  bought "+f(M.pumpHead(id),4)+"  guess "+f(guess,4)+"  solved dp "+f(solved,4)+
        "  q/rated "+f(q/Math.max(rated,1e-9),3)+"  rated "+f(rated,1)+"  w(design) "+f(o.w,1)+
        "  rhoHot "+f(o.rhoHot,1)+"  rhoCold "+f(o.rhoCold,1)+"  boils "+(!!o.boils));
      console.log("    run                                 guessMPa   rho_g  hot   rho_s     x");
      const by=o.byRun||{}, keys=Object.keys(by).sort((a,c)=>by[c].dp-by[a].dp);
      for(const k of keys){ const g=by[k];
        const nd=k.indexOf("part:")===0?-1:IX().node.get(M.runNodeOf(k));
        const ok=nd!==undefined && nd>=0 && s.hBy[nd]===s.hBy[nd];
        console.log("    "+k.padEnd(34)+f(g.dp,4).padStart(9)+f(g.rho,1).padStart(8)+
          (g.hot?"  HOT":"     ")+f(ok?M.eNodeRho(nd):null,1).padStart(8)+f(ok?M.eNodeX(nd):null,3).padStart(7)); }
    }
  },
  /* mass: every tick's residual against the books; the per-node closure is the transport's own (SC_MASSRES) */
  ledger(){
    const pre=(process.argv.find(a=>/^--pre=/.test(a))||"").split("=")[1];
    const tol=+((process.argv.find(a=>/^--kg=/.test(a))||"").split("=")[1])||1e-6;
    const bo=(process.argv.find(a=>/^--blackout=/.test(a))||"").split("=")[1];
    if(pre!==undefined&&pre!==""){ M.plantPreset(+pre); M.buildLayout(); M.commission(); } else withPlant(null);
    const s=ST(), S=sc(); diceOff();
    console.log("\n── ledger closure, "+(pre!==undefined&&pre!==""?M.PLANTPRE()[+pre][0]:"stock plant")+" ──");
    const names=M.E_BK_NAMES();
    const m0=M.eLedgerKg()+M.eLedgerOut();
    let worst=0, wt=0, cum=0, eWorst=0;
    for(let k=0;k<PSEC*50;k++){
      if(k===0){
        const invBefore=M.eLedgerKg(), outBefore=M.eLedgerOut();
        const bkBefore=s.massOut.slice();
        M.step(0.02);
        const invAfter=M.eLedgerKg(), outAfter=M.eLedgerOut();
        console.log("  tick 1 (per book): inventory "+invBefore.toExponential(15)+" -> "+invAfter.toExponential(15)
          +"  out "+outBefore.toExponential(15)+" -> "+outAfter.toExponential(15));
        console.log("  tick 1: SC_MASSRES="+S[SC_MASSRES].toExponential(15)+" kg  ((inv0-inv1)-(out1-out0)="
          +((invBefore-invAfter)-(outAfter-outBefore)).toExponential(15)+")");
        for(let q=0;q<bkBefore.length;q++){ const d=s.massOut[q]-bkBefore[q]; if(d) console.log("    tick1 massOut."+names[q]+" "+d.toExponential(15)); }
        const r=S[SC_MASSRES]; cum+=r;
        if(Math.abs(r)>Math.abs(worst)){ worst=r; wt=k*0.02; }
        if(Math.abs(S[SC_ENRES])>Math.abs(eWorst)) eWorst=S[SC_ENRES];
        if(Math.abs(r)>tol*Math.max(m0,1)) console.log("  tick "+(k+1)+": res "+f(r,6)+" kg");
        continue;
      }
      if(bo!==undefined&&bo!==""&&k===Math.round(+bo*50)) M.act("blackout",true);
      M.step(0.02);
      const r=S[SC_MASSRES]; cum+=r;
      if(Math.abs(r)>Math.abs(worst)){ worst=r; wt=k*0.02; }
      if(Math.abs(S[SC_ENRES])>Math.abs(eWorst)) eWorst=S[SC_ENRES];
      if(Math.abs(r)>tol*Math.max(m0,1)) console.log("  tick "+(k+1)+": res "+f(r,6)+" kg"); }
    row("inventory kg",f(M.eLedgerKg(),1)); row("out kg",f(M.eLedgerOut(),1));
    row("drift kg",f(M.eLedgerKg()+M.eLedgerOut()-m0,6)); row("cumulative residual",f(cum,6));
    row("worst tick residual",f(worst,6)+" at "+f(wt,2)+" s"); row("worst energy residual",f(eWorst,3)+" kJ");
    M.E_BK_NAMES().forEach((n,q)=>{ if(Math.abs(s.massOut[q])>0) row("  massOut."+n,f(s.massOut[q],3)); });
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
