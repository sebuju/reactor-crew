"use strict";
/* the design screen */

/* ─────────────── DESIGN BENCH (spatial) ─────────────── */
function massWith(key,i){ const o=D[key]; D[key]=i; const m=derived().mass; D[key]=o; return m; }
function optList(x,y,w,title,arr,key,tip){
  rule(title,x,y+9,w); TIP(x,y-4,w,14,title,tip);
  const tot=arr.map((o,i)=>massWith(key,i)), lo=Math.min(...tot);
  arr.forEach((o,i)=>{
    const by=y+16+i*25, on=D[key]===i;
    const wd=push({x,y:by,w,h:23,type:"btn",fn:()=>D[key]=i});
    fillRect(x,by,w,23,on?"#2a1f08":(hov(wd)?C.panelHi:C.panel));
    frame(x,by,w,23,on?C.amber:C.edge);
    fillRect(x+8,by+8,7,7,on?C.amber:"#22343a");
    txt(o.name,x+22,by+15,{size:8.5,sp:.3,color:on?C.amber:C.ink});
    const dm=tot[i]-lo;
    txt("+"+dm.toFixed(0)+"t",x+w-7,by+15,
      {size:8,align:"right",color:dm<1?C.green:(on?C.amber:C.ink2)});
    TIP(x,by,w,23,o.name,(o.note||"")+
      "  Total plant mass with this option: "+tot[i].toFixed(0)+" t"+
      (dm<1?" - the lightest choice in this group."
           :", which is "+dm.toFixed(0)+" t more than the lightest choice."));
  });
  return y+16+arr.length*25;
}
function segSel(x,y,w,title,labels,key,tip,base){
  rule(title,x,y+9,w); TIP(x,y-4,w,14,title,tip);
  const n=labels.length, cw=(w-(n-1)*4)/n;
  const tot=labels.map((L,i)=>massWith(key,(base||0)+i)), lo=Math.min(...tot);
  labels.forEach((L,i)=>{
    const bx=x+i*(cw+4), v=(base||0)+i, on=D[key]===v;
    const wd=push({x:bx,y:y+16,w:cw,h:23,type:"btn",fn:()=>D[key]=v});
    fillRect(bx,y+16,cw,23,on?"#2a1f08":(hov(wd)?C.panelHi:C.panel));
    frame(bx,y+16,cw,23,on?C.amber:C.edge);
    txt(L,bx+cw/2,y+28,{size:9,sp:.5,align:"center",color:on?C.amber:C.ink});
    txt("+"+(tot[i]-lo).toFixed(0)+"t",bx+cw/2,y+37,
      {size:6.5,align:"center",color:tot[i]-lo<1?C.green:C.ink2});
  });
  return y+39;
}
function sliderF(x,y,w,title,key,min,max,fmt,tip,step,massFn){
  rule(title,x,y+9,w);
  const wd=slider(x,y+28,w,D[key],min,max,{fn:v=>D[key]=step?Math.round(v/step)*step:v});
  /* this number is the slider's readout, it just lives in the panel rather than in
     the row, so it answers a hover the same way a strip readout does */
  const r=sldRead(wd,fmt);
  txt(r.s,x+w,y+48,{size:10,align:"right",color:r.col});
  if(massFn){ const dm=massFn(D[key])-massFn(min);
    txt("+"+dm.toFixed(0)+"t",x,y+48,{size:9,color:dm<1?C.green:C.ink2}); }
  TIP(x,y-4,w,54,title,tip);
  return y+52;
}
/* a bench readout with no control under it: a number the other sliders caused.
   Same rule/value geometry as sliderF so a column of the two lines up. */
function readF(x,y,w,title,val,tip){
  rule(title,x,y+9,w);
  txt(val,x+w,y+30,{size:10,align:"right",color:C.cyan});
  TIP(x,y-4,w,36,title,tip);
  return y+34;
}
function toggleF(x,y,w,label,key,mass,tip){
  const on=D[key];
  const wd=push({x,y,w,h:28,type:"btn",fn:()=>D[key]=!D[key]});
  fillRect(x,y,w,28,on?"#0f2018":(hov(wd)?C.panelHi:C.panel));
  frame(x,y,w,28,on?C.green:C.edge);
  fillRect(x+9,y+10,9,9,on?C.green:"#22343a"); frame(x+9,y+10,9,9,on?C.green:C.edge2);
  const mo={size:8,align:"right",color:C.ink2}, mt="+"+mass+"t";
  fitTxt(label,x+24,y+18,w-31-tw(mt,mo)-6,{size:8,sp:.3,color:on?C.green:C.ink});
  txt(mt,x+w-7,y+18,mo);
  TIP(x,y,w,28,label+(on?"  [ FITTED ]":"  [ not fitted ]"),tip+"  Costs "+mass+" tonnes.");
  return y+28;
}
function section(title,y){ rule(title,12,y,736,C.amber); return y+14; }

function planStats(d){ return [
  ["POWER DENSITY",d.dens.toFixed(0)+" kW/L",clamp(d.dens/320,0,1),C.cyan,
   "Power per litre of core. Higher means a smaller, lighter reactor, and less material to soak up heat when cooling fails."],
  ["GRACE TIME",d.grace.toFixed(0)+" s",clamp(d.grace/900,0,1),C.green,
   "How long the core survives a total loss of cooling before fuel fails. The number that decides whether a repair under fire is possible at all."],
  ["DELAYED NEUTRONS",d.beta+" pcm",clamp(d.beta/700,0,1),d.beta<400?C.red:C.green,
   "Beta: the share of neutrons arriving seconds late instead of instantly. It is the entire margin a human has to react in."],
  ["SHUTDOWN MARGIN",d.sdm.toFixed(0)+" pcm",clamp(d.sdm/2000,0,1),d.sdm<200?C.red:C.green,
   "How firmly the BANK ALONE holds the core down once it cools and the xenon decays. It is usually negative, and that is not a fault: the plant is commissioned critical with equilibrium xenon in it, so when that xenon decays after a trip its whole worth comes back as positive reactivity, and the fuel cooling hands back Doppler on top. Rods do not win that argument on a real plant either - boron does. Borate after every scram. The bench blocks a design only when full boration cannot hold it either."],
  ["THERMAL MARGIN",d.dnbr.toFixed(2)+" DNBR",clamp((d.dnbr-1)/2.5,0,1),d.dnbr<1.4?C.amber:C.green,
   "DNBR, the Departure from Nucleate Boiling Ratio: how far the fuel is from the point where cooling bubbles join into one insulating steam film. Sets your real overload ceiling, not the power rating."],
  ["VOID COEFFICIENT",(d.aV>0?"+":"")+d.aV.toFixed(0)+" pcm",clamp(Math.abs(d.aV)/1600,0,1),d.aV>0?C.red:C.blue,
   "What happens when steam forms in the core. Negative shuts the reactor down as it boils. Positive means boiling adds power, which adds boiling."],
  ["MODERATOR COEFF",d.aM.toFixed(0)+" pcm/K",clamp(Math.abs(d.aM)/70,0,1),d.aM>0?C.red:C.blue,
   "Feedback from coolant temperature, set by your lattice pitch. Strongly negative makes the plant follow turbine load by itself."],
  ["PEAKING FACTOR",d.Fq.toFixed(2)+" Fq",1-clamp((d.Fq-1.8)/1.2,0,1),d.Fq>2.6?C.amber:C.green,
   "How lopsided power is across the core. The hottest pin sets the limit for the whole reactor, so a flat core can run harder."],
  ["XENON PIT DEPTH",d.xeW.toFixed(0)+" pcm",clamp(d.xeW/2700,0,1),d.xeW<800?C.green:C.amber,
   "How badly xenon locks you out after a shutdown. At 2700 pcm a scram costs roughly three minutes dead in the water."],
  ["NATURAL CIRCULATION",(d.natCirc*100).toFixed(0)+" %",clamp(d.natCirc/.8,0,1),d.natCirc<.2?C.amber:C.green,
   "Flow the core generates by buoyancy alone with every pump stopped. This is your entire cooling capability in a blackout."],
  ["SCRAM TRAVEL",(1/d.scram).toFixed(1)+" s",clamp(d.scram/2.5,0,1),C.green,
   "How long a full emergency rod insertion takes. In a fast transient, two seconds versus half a second is the whole game."],
  ["OPERATING PRESS",d.P0.toFixed(1)+" MPa",clamp(d.P0/18,0,1),d.P0>12?C.amber:C.green,
   "Loop pressure. Buys thermal margin and demands a heavy vessel that fails violently."],
  ["EXCESS REACTIVITY",d.excess.toFixed(0)+" pcm",clamp(d.excess/8000,0,1),C.cyan,
   "Reactivity built into the fresh core that must be held down at all times by rods, boron and burnable poison."],
  ["NEUTRON LEAKAGE",d.leak.toFixed(0)+" pcm",clamp(d.leak/900,0,1),d.leak>500?C.amber:C.cyan,
   "Reactivity thrown away through the core surface, driven by how far your height-to-diameter ratio is from a squat cylinder."],
  ["CONTAINMENT",((1-CONT[D.cont].rel)*100).toFixed(0)+" % held",1-CONT[D.cont].rel,
   CONT[D.cont].rel>.5?C.red:C.green,
   "Fraction of a radiological release that stays inside the plant instead of reaching your crew."],
  ["INSTRUMENT TRUST",((1-CHAN[D.chan].noise)*100).toFixed(0)+" %",1-CHAN[D.chan].noise,
   CHAN[D.chan].noise>.6?C.amber:C.green,
   "How much you can believe your own gauges. Single-channel readings visibly jitter and a failed sensor is undetectable."],
];}
function layoutStats(M){ return [
  ["THERMOSIPHON HEAD",M.head.toFixed(1)+" cells",clamp((M.head+1)/4,0,1),M.head<0.5?C.amber:C.green,
   "How far the steam generators sit above the reactor. Hot water rises into them and cold water falls back with no pumps at all. Raise the generators and a blackout stops being fatal."],
  ["PRIMARY PIPE RUN",M.pipe.toFixed(1)+" m",clamp(M.pipe/60,0,1),M.pipe>40?C.amber:C.green,
   "Total hot and cold leg length. Long runs add friction so your pumps deliver less flow, and give more pipe for a hit to find. They also add coolant mass, which is thermal inertia in your favour."],
  ["FLOW PENALTY",((1-M.flowK)*100).toFixed(0)+" %",1-M.flowK,(1-M.flowK)>.2?C.amber:C.green,
   "Pumping loss from pipe friction. A short straight run from reactor to steam generator costs nothing; a sprawling layout quietly caps the flow you can ever achieve."],
  ["COOLANT INERTIA",((M.inertiaK-1)*100).toFixed(0)+" % grace",clamp((M.inertiaK-1)*3,0,1),C.cyan,
   "Extra water in long pipe runs takes longer to heat, so transients develop more slowly and you get more time to react. The one genuine reward for a spread-out layout."],
  ["HULL EXPOSURE",(M.exposure*100).toFixed(0)+" %",M.exposure,M.exposure>.2?C.red:C.green,
   "Share of equipment sitting in the outer ring, where incoming fire lands. Anything out there is a candidate the next time you take a hit."],
  ["REPAIR ACCESS",(M.access*100).toFixed(0)+" %",M.access,M.access<1?C.red:C.green,
   "Fraction of equipment with at least one free adjacent cell. A component walled in on all four sides cannot be repaired at all, however badly you need it."],
  ["CREW DOSE RATE",M.dose.toFixed(2)+" x",clamp(M.dose/2,0,1),M.dose>1?C.amber:C.green,
   "Radiation reaching the control room during an accident. Falls with distance from the reactor and drops sharply for every shield block you put between the two."],
  ["PRESSURIZER HEAD",M.pzrOK?"at loop top":"BELOW LOOP TOP",M.pzrOK?1:0.2,
   M.pzrOK?C.green:C.red,
   "The pressurizer works by holding a steam bubble at the highest point of the primary loop. Mount it below the reactor or the steam generators and the bubble cannot sit where it needs to: pressure control loses more than half its damping and every load change whips the loop pressure around."],
  ["ACCUMULATOR HEAD",(M.hpiHead*100).toFixed(0)+" %",clamp(M.hpiHead/1.35,0,1),
   M.hpiHead<.7?C.amber:C.green,
   "Emergency injection is gravity fed. Mounted high above the reactor it drains in fast with no power at all; mounted level with or below the core it barely trickles."],
  ["LOOP SEPARATION",D.loops>1?M.sep.toFixed(0)+" cells":"n/a",D.loops>1?clamp(M.sep/8,0,1):1,
   D.loops>1&&M.sep<4?C.amber:C.green,
   "Distance between redundant loops. Park two steam generators next to each other and a single hit takes out both, making the redundancy you paid for worthless."],
];}
function layoutWarnings(M){ const w=[];
  if(!M.pzrOK) w.push(["SOFT","The pressurizer is not the highest point of the primary loop. Its steam bubble cannot form properly, so pressure damping drops to 45%."]);
  if(M.head<0) w.push(["SOFT","Steam generators sit BELOW the reactor. Natural circulation runs backwards - there is no passive cooling at all."]);
  if(M.access<1) w.push(["HARD","Some equipment is walled in with no adjacent free cell. It could never be repaired once damaged."]);
  if(M.exposure>0.3) w.push(["SOFT","Over 30% of the plant sits in hull cells. Expect to lose something every time you are hit."]);
  if(D.loops>1&&M.sep<3) w.push(["SOFT","Redundant loops are adjacent. One hit will take out both."]);
  return w;
}

/* one source of truth for "may this design be built" and "has it changed since it was" */
function designIssues(d,M){ return (d||derived()).warn.concat(layoutWarnings(M||layoutMetrics())); }
function designBlocked(d,M){ return designIssues(d,M).some(w=>w[0]==="HARD"); }
function designSig(){ return JSON.stringify(D)+"|"+LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }
