#!/usr/bin/env node
// node tools/loopsplit.js [msre|bwr|rbmk] -- A: MSRE leg-by-leg vs the guess. B: BWR/4, RBMK-1000 driven to rated flow.
const M=require('./bundle').headless(
 '{plantPreset,buildLayout,commission,step,ST:()=>ST,PT:()=>PT,IX:()=>IX,'+
 'PLANTPRE:()=>PLANTPRE,loopMap,loopHeadOf,pumpIds,pumpFlow,pumpDisNode,pumpSucNode,uiNodeP,nodeZ,G_MPA,act}');

const ST=()=>M.ST(), IX=()=>M.IX(), sc=()=>M.ST().sc;
const f=(v,d)=>(v===null||v===undefined||Number.isNaN(v))?"-":(+v).toFixed(d===undefined?4:d);
const run=secs=>{ for(let i=0;i<secs*50;i++) M.step(0.02); };
const diceOff=()=>{ sc()[SC_DICEOFF]=1; };
const row=(...c)=>console.log("  "+c.map((x,i)=>String(x).padEnd(i?12:24)).join(""));

function build(name){
  const i=M.PLANTPRE().findIndex(p=>p[0]===name);
  M.plantPreset(i); M.buildLayout(); M.commission(); diceOff();
  return i;
}

function msre(){
  build("MSRE"); run(5);
  const L=M.loopMap(), pump=M.pumpIds().find(id=>L.partLoop[id]!==undefined);
  const p=IX().pump.get(pump), q=ST().pumpQBy[p], rated=M.pumpFlow(pump);
  const dis=M.pumpDisNode(pump), suc=M.pumpSucNode(pump);
  const o={}, guess=M.loopHeadOf(pump,o);
  const legs=o.legs;

  console.log("\n== A: MSRE, leg by leg against the solved field ==");
  console.log("  pump "+pump+"  solved "+f(q,1)+" kg/s, rated "+f(rated,1)+" kg/s (q/rated "+f(q/rated,3)+")");
  row("leg","guess MPa","solved MPa","solved-guess");
  let sumG=0, sumS=0;
  for(const l of legs){
    const g=(o.byRun[l.key]?o.byRun[l.key].dp:0)+l.dpz, s=M.uiNodeP(l.from)-M.uiNodeP(l.to);
    sumG+=g; sumS+=s;
    row(l.key, f(g), f(s), (s-g>=0?"+":"")+f(s-g));
  }
  row("TOTAL(legs)", f(sumG), f(sumS), (sumS-sumG>=0?"+":"")+f(sumS-sumG));
  const solvedTotal=M.uiNodeP(dis)-M.uiNodeP(suc), k=(rated/q)*(rated/q);
  // the pump's head is its pressure rise plus the lift of its own casing; only the friction scales with flow
  const head=solvedTotal+o.rhoCold*M.G_MPA*(M.nodeZ(dis)-M.nodeZ(suc)), headRated=(head-o.dpZ)*k+o.dpZ;
  console.log("  pump dis-suc solved "+f(solvedTotal)+" MPa, casing lift "+f(head-solvedTotal)+" MPa, head "+f(head)+
    " MPa (friction scaled to rated x"+f(k,3)+" = "+f(headRated)+" MPa), loopHeadOf() guess "+f(guess)+" MPa (height "+f(o.dpZ)+
    "), guess off solved "+f(100*(guess-headRated)/headRated,2)+" %");
}

// bisects pumpDem (real settle each trial, rotor inertia) until solved flow == rated, reads loop dp there unscaled
function driveToRated(name){
  build(name); run(5);
  const L=M.loopMap(), pump=M.pumpIds().find(id=>L.partLoop[id]!==undefined);
  const p=IX().pump.get(pump), rated=M.pumpFlow(pump);
  const dis=M.pumpDisNode(pump), suc=M.pumpSucNode(pump);
  const q0=ST().pumpQBy[p];
  let lo=0, hi=5, bestQ=q0, bestDem=1, everHit=false;
  for(let it=0; it<10; it++){
    const mid=(lo+hi)/2;
    M.act("pumpDem", p, mid); run(2.5);
    const q=ST().pumpQBy[p];
    if(q > bestQ){ bestQ=q; bestDem=mid; }
    if(q < rated) lo=mid; else { hi=mid; everHit=true; }
  }
  M.act("pumpDem", p, everHit ? hi : bestDem); run(8);
  const q=ST().pumpQBy[p], dp=M.uiNodeP(dis)-M.uiNodeP(suc);
  console.log("\n== B: "+name+", driven toward rated flow ==");
  console.log("  rest q "+f(q0,1)+" kg/s (rated "+f(rated,1)+")  ->  pumpDem "+f(everHit?hi:bestDem,3)+"  q "+f(q,1)+
    " kg/s (q/rated "+f(q/rated,4)+")"+(everHit?"":"  CEILING - never reached rated up to pumpDem=5")+
    "  loop dp there "+f(dp,4)+" MPa");
  return dp;
}

const which=process.argv[2];
if(!which || which==="msre") msre();
if(which==="bwr") driveToRated("BWR/4");
if(which==="rbmk") driveToRated("RBMK-1000");
