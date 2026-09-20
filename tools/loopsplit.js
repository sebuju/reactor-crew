#!/usr/bin/env node
// node tools/loopsplit.js [msre|bwr|rbmk] -- A: MSRE leg-by-leg vs the guess. B: BWR/4, RBMK-1000 driven to rated flow.
const M=require('./bundle').headless(
 '{plantPreset,buildLayout,commission,step,ST:()=>ST,PT:()=>PT,IX:()=>IX,'+
 'PLANTPRE:()=>PLANTPRE,loopMap,loopHeadOf,pumpIds,pumpFlow,pumpDisNode,pumpSucNode,uiNodeP,coreFold,act}');

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

// walks loopHeadOf()'s own leg set from discharge to suction, folding each key's raw endpoints to a real node
function walkLegs(byRun, dis, suc){
  const keys=Object.keys(byRun), rawEnds={};
  for(const k of keys){ if(k.indexOf("part:")===0) continue;
    const body=k.slice(k.indexOf(":")+1); rawEnds[k]=body.split("-"); }
  const order=[]; let cur=dis, guard=0;
  while(guard++<20 && cur!==suc){
    let hit=null;
    for(const k of keys){
      if(order.some(l=>l.key===k)) continue;
      if(k.indexOf("part:")===0){
        const pid=k.slice(5);
        const faces=[].concat(...keys.filter(k2=>rawEnds[k2]).map(k2=>rawEnds[k2].filter(e=>e.indexOf(pid)===0)));
        if(faces.some(fc=>M.coreFold(fc)===cur)){
          const other=faces.find(fc=>M.coreFold(fc)!==cur)||faces[0];
          hit={key:k, from:cur, to:M.coreFold(other)}; break; }
      } else {
        const [a,b]=rawEnds[k], fa=M.coreFold(a), fb=M.coreFold(b);
        if(fa===cur){ hit={key:k, from:cur, to:fb}; break; }
        if(fb===cur){ hit={key:k, from:cur, to:fa}; break; }
      }
    }
    if(!hit) break;
    order.push(hit); cur=hit.to;
  }
  return order;
}

function msre(){
  build("MSRE"); run(5);
  const L=M.loopMap(), pump=M.pumpIds().find(id=>L.partLoop[id]!==undefined);
  const p=IX().pump.get(pump), q=ST().pumpQBy[p], rated=M.pumpFlow(pump);
  const dis=M.pumpDisNode(pump), suc=M.pumpSucNode(pump);
  const o={}, guess=M.loopHeadOf(pump,o);
  const legs=walkLegs(o.byRun, dis, suc);

  console.log("\n== A: MSRE, leg by leg against the solved field ==");
  console.log("  pump "+pump+"  solved "+f(q,1)+" kg/s, rated "+f(rated,1)+" kg/s (q/rated "+f(q/rated,3)+")");
  row("leg","guess MPa","solved MPa","solved-guess");
  let sumG=0, sumS=0;
  for(const l of legs){
    const g=o.byRun[l.key].dp, s=M.uiNodeP(l.from)-M.uiNodeP(l.to);
    sumG+=g; sumS+=s;
    row(l.key, f(g), f(s), (s-g>=0?"+":"")+f(s-g));
  }
  row("TOTAL(legs)", f(sumG), f(sumS), (sumS-sumG>=0?"+":"")+f(sumS-sumG));
  const solvedTotal=M.uiNodeP(dis)-M.uiNodeP(suc);
  console.log("  pump dis-suc solved "+f(solvedTotal)+" MPa (scaled to rated x"+f((rated/q)*(rated/q),3)+" = "+
    f(solvedTotal*(rated/q)*(rated/q))+" MPa), loopHeadOf() guess "+f(guess)+" MPa");
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
