"use strict";
/* the design screen */

/* ─────────────── DESIGN BENCH (spatial) ─────────────── */
function massWith(key,i){ const o=D[key]; D[key]=i; const m=derived().mass; D[key]=o; return m; }

/* ══ EVERY BENCH WIDGET DECLARES ITS OWN HEIGHT ══
   A parameter plate has to be LAID OUT before anything is drawn into it - how
   many columns it needs is a question about how tall the stack is - so the
   height of each widget has to be knowable without drawing it. Each helper
   returns through the same constant the plate measures with, so the two cannot
   drift: change the widget and the packer changes with it. */
const optListH=arr=>16+arr.length*25;
const SEGSEL_H=39, SLDF_H=52, READF_H=34, TOGGLE_H=28;

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
  return y+optListH(arr);
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
  return y+SEGSEL_H;
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
  return y+SLDF_H;
}
/* a bench readout with no control under it: a number the other sliders caused.
   Same rule/value geometry as sliderF so a column of the two lines up. */
function readF(x,y,w,title,val,tip){
  rule(title,x,y+9,w);
  txt(val,x+w,y+30,{size:10,align:"right",color:C.cyan});
  TIP(x,y-4,w,36,title,tip);
  return y+READF_H;
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
  return y+TOGGLE_H;
}

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
/* The lattice is part of the design, and most of what a pen changes on it is
   not a D field - a reflector face, a cluster's slot, the active length. So
   latSig() joins the key, or moving any of them would leave the commissioned
   plant quietly out of date with the bench and nothing would say so. */
function designSig(){ return JSON.stringify(D)+"|"+latSig()+"|"
  +LAY.parts.map(p=>p.id+":"+p.x+","+p.y).join(";"); }

/* ─────────────── THE FUEL LATTICE, IN PLAN ───────────────
   The one drawing surface on the bench. A quarter of the core seen from above,
   with the reactor axis down the LEFT edge and along the BOTTOM, so the corner
   is the centreline of the machine and the panel reads as the quarter of a
   section it is. The mirrored three quarters are not drawn: they are the same
   assemblies, and one place to click per assembly is the point.

   It carries three things at once, on channels that do not compete:
     the SQUARE     is an assembly, and what it is made of
     the DOT SIZE   is local flux - the same channel coreField() uses, so the
                    plan and the section say "power" with the same ink
     the ARCS       are the mesh rings the revolve sorts it into, which is the
                    only way to see why an assembly you moved two slots landed
                    somewhere else entirely

   Everything is drawn inside a clip of the grid: the rim is a circle centred
   on a corner and three quarters of it belong to nobody. */
const LATPEN={tool:"fuel",bank:0,hover:null,last:null};

/* Flux per mesh ring, from the shape this lattice is predicted to settle into
   rather than from whatever happens to be commissioned - while you are laying
   assemblies out you want the flux of the thing on the table. */
function latRingPhi(){
  const T=corePredict(derived()), phi=T.phiCold, r=new Float64Array(XNR);
  let mx=1e-9;
  for(let i=0;i<XNR;i++){
    let s=0; for(let j=0;j<XNZ;j++) s+=phi[XIX(i,j)];
    r[i]=s/XNZ; if(r[i]>mx) mx=r[i];
  }
  for(let i=0;i<XNR;i++) r[i]/=mx;
  return r;
}
/* No latPeakRing() here, and that is a finding rather than an omission. Marking
   the peak ring on the plan was drawn, measured and taken out again: the radial
   flux peaks on the CENTRELINE for every core the bench can lay out - stock,
   compact, flat, and even one with a nine-slot hole punched through the middle
   of it, where ring 0 has no fuel in it at all and still reads 1.00. A thermal
   flux does peak in a water hole, so that is right rather than broken, but it
   makes "peak ring" a readout that says 0 forever. What actually moves with the
   drawing is the SHAPE, and the plan already draws that: the dot in each
   assembly is the flux at its own radius. */
const latRingOf=(u,v)=>Math.min(XNR-1,
  Math.floor(Math.hypot(u+.5,v+.5)*LAT.pitch/LM.dr));
/* Flux at an assembly rather than at its ring: interpolated between ring
   CENTRES, so an assembly reads its own radius instead of stepping with the
   whole annulus it sits in. It stops there on purpose - the solve is
   axisymmetric, so two assemblies at the same radius have the same flux, and
   drawing them differently would invent structure the plant has not got. */
function latSlotPhi(u,v,ph){
  const t=Math.hypot(u+.5,v+.5)*LAT.pitch/LM.dr-0.5;
  const i0=Math.floor(t), f=clamp(t-i0,0,1);
  const a=ph[clamp(i0,0,XNR-1)], b=ph[clamp(i0+1,0,XNR-1)];
  return a+(b-a)*f;
}
/* what share of the CORE this one assembly makes. The x4 is load-bearing: the
   axis runs along the corner of slot 0,0, so this quarter mirrors into four
   DISTINCT assemblies and a quarter sum reads four times high. */
function latShare(u,v,ph){
  let tot=0;
  for(let a=0;a<LQ;a++) for(let b=0;b<LQ;b++)
    if(LAT.slot[LIX(a,b)]) tot+=latSlotPhi(a,b,ph);
  return tot>1e-9? latSlotPhi(u,v,ph)/(4*tot) : 0;
}

function latAct(u,v,shift){
  const q=LIX(u,v);
  if(LATPEN.tool==="fuel"){
    const nv=shift?L_EMPTY:(LAT.slot[q]?L_EMPTY:L_FUEL);
    if(LAT.slot[q]===nv) return;
    LAT.slot[q]=nv; if(!nv) LAT.rod[q]=-1;
  } else if(LATPEN.tool==="pois"){
    if(!LAT.slot[q]) return;
    LAT.slot[q]=LAT.slot[q]===L_POIS?L_FUEL:L_POIS;
  } else {
    if(!LAT.slot[q]) return;
    const nv=LAT.rod[q]===LATPEN.bank?-1:LATPEN.bank;
    if(LAT.rod[q]===nv) return;
    LAT.rod[q]=nv;
  }
  latRevolve();
}

/* The plan is square-ish: the grid is w-15 wide with 6 taken off the height so
   its gutter line clears whatever sits under it, then a caption line. */
const latPlanH=w=>w-5;
function latPlan(x,y,w,tool){
  if(tool) LATPEN.tool=tool;
  const AX=15;                                  // gutter the centrelines live in
  /* the grid is a few pixels shy of square so its gutter line clears the
     MEASURED band that runs along the foot of the inspector */
  const gx=x+AX, gy=y, gw=w-AX, gh=w-AX-6;
  /* Headroom past the last slot, because the rim passes through the far CORNER
     of the outermost assembly and that corner is further from the axis than
     the lattice is wide. Size to LQ exactly and the rim is clipped off at the
     two places it matters most. */
  const cs=gh/(LQ+0.6), p=LAT.pitch, ph=latRingPhi();
  const hv=LATPEN.hover, hRing=hv? latRingOf(hv.u,hv.v) : -1;
  let rMax=0;
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++)
    if(LAT.slot[LIX(u,v)]) rMax=Math.max(rMax,Math.hypot(u+1,v+1)*p);

  fillRect(gx,gy,gw,gh,C.well);
  const CX=gx, CY=gy+gh;                        // the machine axis, in pixels
  ctx.save(); ctx.beginPath(); ctx.rect(gx,gy,gw,gh); ctx.clip();
  if(hRing>=0){
    const r0=hRing*LM.dr/p*cs, r1=(hRing+1)*LM.dr/p*cs;
    ctx.beginPath(); ctx.arc(CX,CY,r1,-Math.PI/2,0);
    ctx.arc(CX,CY,r0,0,-Math.PI/2,true); ctx.closePath();
    ctx.fillStyle="rgba(240,168,48,.10)"; ctx.fill();
  }
  ctx.strokeStyle="rgba(95,210,226,.16)"; ctx.lineWidth=1;
  for(let i=1;i<XNR;i++){                       // XNR would land on the rim
    ctx.beginPath(); ctx.arc(CX,CY,i*LM.dr/p*cs,-Math.PI/2,0); ctx.stroke();
  }
  if(rMax>0){
    ctx.save(); ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.arc(CX,CY,rMax/p*cs,-Math.PI/2,0);
    ctx.strokeStyle=C.cyan; ctx.lineWidth=1.2; ctx.stroke(); ctx.restore();
  }
  for(let u=0;u<LQ;u++) for(let v=0;v<LQ;v++){
    const X=gx+u*cs, Y=gy+gh-(v+1)*cs, q=LIX(u,v);
    const s=LAT.slot[q], rod=LAT.rod[q];
    if(!s){ fillRect(X+cs/2-1,Y+cs/2-1,2,2,"#1b2c33"); continue; }
    const col=s===L_POIS?"#12303c":"#4a3208", ink=s===L_POIS?C.blue:C.amber;
    fillRect(X+1,Y+1,cs-2,cs-2,col);
    frame(X+1,Y+1,cs-2,cs-2,lerpC(col,ink,.42));
    const r=cs*.30*Math.sqrt(clamp(latSlotPhi(u,v,ph),.04,1));
    ctx.beginPath(); ctx.arc(X+cs/2,Y+cs/2,r,0,7);
    ctx.fillStyle=ink; ctx.globalAlpha=s===L_POIS?.9:.55; ctx.fill(); ctx.globalAlpha=1;
    if(rod>=0){
      /* SOLID, not a hairline box. A slot is 14px on this panel and the cell is
         already framed, so a second frame inside the first read as a slightly
         thicker edge rather than as a cluster - the banks were all but
         invisible. A cluster is a lump of absorber dropped into the lattice, so
         it is drawn as a block of metal with dark type on it. The 3px inset
         leaves the fuel/poison colour showing as a ring, so the assembly under
         it can still be read.
         Amber only while you are holding that bank: amber is the interactive
         colour, and a board of permanently amber clusters spends it on nothing */
      const on=LATPEN.tool==="rod"&&LATPEN.bank===rod;
      fillRect(X+3,Y+3,cs-6,cs-6,on?C.amber:C.metal);
      txt(String(rod+1),X+cs/2,Y+cs/2+3,
        {size:7.5,weight:700,align:"center",color:C.well});
    }
    if(hv&&hv.u===u&&hv.v===v) ticks(X,Y,cs,cs,C.amber,4);
  }
  ctx.restore();
  frame(gx,gy,gw,gh,C.edge);
  /* centrelines last and running past the grid, the way a drawing marks an
     axis - drawn before the frame they are simply painted over by it */
  /* The overhang is what makes them read as axes rather than as a border, but
     it is measured against the COLUMN, not against the grid: the plan column is
     x..x+w and anything past that is the next column's. Eight pixels to the
     left ran into the rotated axis label and three to the right sat on the
     column edge; the vertical tail ran down into the caption line below. */
  ctx.save(); ctx.setLineDash([9,3,2,3]);
  line(CX,gy-3,CX,CY+5,C.rail,1); line(gx-AX+9,CY,gx+gw,CY,C.rail,1);
  ctx.restore();
  ctx.save(); ctx.translate(x+6,gy+gh/2); ctx.rotate(-Math.PI/2);
  txt("REACTOR AXIS",0,0,{size:6,sp:1.2,align:"center",color:C.rail});
  ctx.restore();

  const wd=push({x:gx,y:gy,w:gw,h:gh,type:"lat",fn:(pt,e)=>{
    const u=Math.floor((pt.x-gx)/cs), v=LQ-1-Math.floor((pt.y-gy)/cs);
    if(u<0||u>=LQ||v<0||v>=LQ) return;
    const id=u+","+v; if(id===LATPEN.last) return;   // one act per slot per drag
    LATPEN.last=id; latAct(u,v,e&&e.shiftKey);
  }});
  LATPEN.hover=null;
  if(hov(wd)){
    const u=Math.floor((ui.ptr.x-gx)/cs), v=LQ-1-Math.floor((ui.ptr.y-gy)/cs);
    if(u>=0&&u<LQ&&v>=0&&v<LQ) LATPEN.hover={u,v};
  }
  if(!ui.drag) LATPEN.last=null;

  /* One caption line, and it must fit the 157px the grid is wide - the two
     strings that used to be here ran 180px and 220px, straight across the
     gutter and into the pen column beside them. Measured, not eyeballed: a
     6.5px monospace glyph is 4.4px wide here, so this line gets about 35
     characters and no more. fitTxt() is the guard rather than the fix - the
     strings themselves are short now, and what came off them (arcs are mesh
     rings, the dot is flux) is already said by the tooltip, at length. */
  if(hv) fitTxt("S "+hv.u+","+hv.v+"  RING "+hRing+
      "  r"+(Math.hypot(hv.u+.5,hv.v+.5)*p).toFixed(2)+"m"+
      (LAT.slot[LIX(hv.u,hv.v)]
        ? "  "+(latShare(hv.u,hv.v,ph)*100).toFixed(2)+"%"
        : "  EMPTY"),
      gx,gy+gh+11,gw,{size:6.5,sp:.3,color:C.amber});
  else fitTxt(latCount()+" ASSEMBLIES / DOT IS FLUX",
      gx,gy+gh+11,gw,{size:6.5,sp:.5,color:C.ink2});
  TIP(gx,gy,gw,gh,"FUEL LATTICE / QUARTER PLAN",
    "The core, laid out looking down at it. Click or drag to place assemblies, poison pins or rod clusters; hold SHIFT to clear. Rated power, core H/D, lattice pitch, burnable poison, bank count and control bank worth are all MEASUREMENTS of what you lay out here - not one of them is a number you can set. The faint arcs are the fourteen mesh rings the solver sorts your assemblies into, and the dot in each assembly is the flux at its own radius. A ring you leave part empty fades in the control room's flux view too, so a hole you draw here is a hole you can still see while you are operating it.");
  return y+latPlanH(w);
}

/* The pen, carrying only the tools that belong to the component it is mounted
   on: the core inspector lays fuel and poison, the rod drives place clusters.
   That is the same rule the control room uses for its strips - a control lives
   on the machine it drives - and it is also why the tool cannot be left in a
   state the panel you are looking at has no use for. */
/* The pen is a row of tools, and the cluster pen carries a second row of banks
   under it - so its height depends on which tool is in your hand. latTools()
   normalises the tool the same way before it draws, so the two agree. */
const latPenTool=tools=>tools.some(t=>t[1]===LATPEN.tool)?LATPEN.tool:tools[0][1];
const latToolsH=tools=>39+(latPenTool(tools)==="rod"?23:0);
function latTools(x,y,w,tools){
  rule("PEN",x,y+9,w,C.amber); TIP(x,y-4,w,14,"PEN",
    "What clicking on the plan does. Every tool is a toggle: click a slot to lay the thing down, click it again to take it away, and hold SHIFT while you drag to clear whatever you cross.");
  let ty=y+16;
  if(!tools.some(t=>t[1]===LATPEN.tool)) LATPEN.tool=tools[0][1];
  const bw=(w-(tools.length-1)*4)/tools.length;
  tools.forEach((t,i)=>{
    button(x+i*(bw+4),ty,bw,19,t[0],
      {on:LATPEN.tool===t[1],size:7,sp:.3,fn:()=>{LATPEN.tool=t[1];}});
    TIP(x+i*(bw+4),ty,bw,19,t[0]+" PEN",t[2]);
  });
  ty+=23;
  if(LATPEN.tool==="rod"){
    const cw=(w-12)/4;
    for(let b=0;b<4;b++){
      button(x+b*(cw+4),ty,cw,19,"BANK "+(b+1),
        {on:LATPEN.bank===b,size:6.5,sp:.2,fn:()=>{LATPEN.bank=b;}});
      TIP(x+b*(cw+4),ty,cw,19,"BANK "+(b+1),
        "Which bank the clusters you draw belong to. A bank is a group of clusters that move together, so it is the unit the panel gives a slider to and the unit SPLIT mode drives one at a time. Draw clusters at different radii into different banks and you can lean the flux; put them all in one and there is nothing to lean against. Worth is decided by where the clusters sit, not by how many you fit.");
    }
    ty+=23;
  }
  return y+latToolsH(tools);
}
const LATPEN_CORE=[
  ["FUEL","fuel",
   "Lay an assembly, or lift one out. Every square is four assemblies in the finished core, because the axis runs along the corner of the first slot. Rated power, core diameter and H/D are all counted off this, so an outer square is worth far more than an inner one - it carries a bigger annulus."],
  ["POISON","pois",
   "Swap an assembly between plain fuel and one carrying burnable poison pins. Poison holds down fresh excess reactivity that would otherwise be held by boron, and unlike boron it is graded: put it where the flux peaks and it flattens the core. It only works on a slot that already has fuel in it."],
];
const LATPEN_RODS=[
  ["CLUSTER","rod",
   "Drop a control cluster into an assembly, in whichever bank is selected below. The cluster is drawn as a block with its bank number on it. Count buys no worth - a fully inserted bank covers the core once however many you fit - so what you are choosing here is how near the flux each bank sits, and how many things can jam."],
];

/* ── the pen, working in bulk ──
   A preset is the pen doing in one click what you would otherwise draw slot by
   slot, so it is drawn as a row of pen-sized keys. It sits at the FOOT OF THE
   LAST COLUMN in both inspectors, which is where it fits: the plan takes a
   whole column, the pen and the section dimensions take another and the two
   option lists take the last two, and a 232px box has one spare row in it and
   only in column four. Same place on both panels, so it is learnt once.

   One row, two callers - the lattice presets on the core and the bank spreads
   on the drives. Each key is an ACT, not a mode, so none of them is ever drawn
   lit: nothing here is a state you are in. */
const LATROW_H=19;
function latBulkRow(x,y,w,label,items){
  const lo={size:6.5,sp:.7,caps:1,color:C.ink2}, lw=tw(label,lo)+6;
  txt(label,x,midBase(y,19,6.5),lo);
  const n=items.length, bw=(w-lw-(n-1)*4)/n;
  items.forEach((it,i)=>{
    const bx=x+lw+i*(bw+4);
    button(bx,y,bw,19,it[0],{size:6.5,sp:.2,fn:it[2]});
    TIP(bx,y,bw,19,it[0],it[1]);
  });
  return y+LATROW_H;
}
const latPreRow=(x,y,w)=>latBulkRow(x,y,w,"LATTICE",
  LATPRE.map((p,i)=>[p[0],p[2],()=>latPreset(i)]));
/* Spreading the banks re-lays every cluster, so it is the one act on this
   panel that throws away a plan you drew by hand. It says so, and there are
   four of it rather than one, because how many banks you want is the whole
   question - fewer banks sit nearer the flux and are worth more; more banks
   are what tilt trim and SPLIT mode need to have something to lean against. */
const latBankRow=(x,y,w)=>latBulkRow(x,y,w,"SPREAD",[1,2,3,4].map(n=>[String(n),
  "Clear every cluster and lay "+n+" bank"+(n>1?"s":"")+" again, spread by area over the core the way the stock lattice does - so each bank covers about the same share of the fuel."+
  (n<2?" One bank has nothing to lean a flux tilt against, so tilt trim and SPLIT mode have no work to do."
      :" Fewer banks sit nearer the flux and so measure a little more worth; watch CONTROL BANK WORTH below say by how much."),
  ()=>{ latLayBanks(n); latRevolve(); }]));

/* The four things the section still gets to say. Dimension bars, not sliders:
   the bar is the extent of the thing and the figure beside it is what that
   extent measures, so there is no track and no thumb to mistake for one. */
const LATDIMS=[
  ["ACTIVE LENGTH","len",0.6,5.0,v=>v.toFixed(2)+" m",
   "How tall the fuel column is. Against the diameter the lattice revolves to, this is the core's H/D - which used to be a slider that a diameter was then computed backwards out of."],
  ["RIM REFLECTOR","reflR",0,3,v=>v.toFixed(1)+" cells",
   "Reflector thickness around the side of the core. One cell is worth most of what a reflector has to give and the two after it are diminishing returns - but every one of them is weighed, so a thick band of steel is real tonnage."],
  ["LID REFLECTOR","reflT",0,3,v=>v.toFixed(1)+" cells",
   "Reflector over the top. Its own face with its own albedo, so a bare lid leaks whatever the rim happens to be doing."],
  ["FLOOR REFLECTOR","reflB",0,3,v=>v.toFixed(1)+" cells",
   "Reflector under the core. Leave it bare and the flux is pushed upward - a real way to shape a core, and a real way to ruin one."],
];
const LATREFL=["NONE","STEEL","BERYL","GRAPH"];
const latDimRackH=()=>38+LATDIMS.length*20;
function latDimRack(x,y,w){
  rule("SECTION",x,y+9,w,C.cyan); let ty=y+15;
  /* the reflector MATERIAL sits with the three thicknesses that dimension it,
     because between them they are one decision: what the band is and how much
     of it there is */
  { const cw=(w-12)/4;
    LATREFL.forEach((L,i)=>button(x+i*(cw+4),ty,cw,19,L,
      {on:D.refl===i,size:6.5,sp:.2,fn:()=>{D.refl=i;}}));
    TIP(x,ty,w,19,"REFLECTOR MATERIAL",
      "What the band around the core is made of; the three thicknesses below decide how much of it there is. Beryllium and graphite reflect better per tonne and nudge the void coefficient positive; steel is dense, so a thick steel band is real tonnage on the budget.");
    ty+=23; }
  LATDIMS.forEach(d=>{
    const v=LAT[d[1]], t=clamp((v-d[2])/(d[3]-d[2]),0,1);
    const wd=push({x,y:ty,w,h:20,type:"sld",min:d[2],max:d[3],cy:ty+10,val:v,tw_:8,
      fn:nv=>{ LAT[d[1]]=clamp(nv,d[2],d[3]); latRevolve(); }});
    wd.tx=x+t*w;
    txt(d[0],x,ty+7,{size:6.5,sp:.7,caps:1,color:C.ink2});
    fillRect(x,ty+11,w,1,C.edge2);
    fillRect(x,ty+9,Math.max(2,t*w),5,hov(wd)?C.amber:C.cyan);
    txt(d[4](v),x+w,ty+7,{size:7.5,align:"right",color:C.cyan});
    TIP(x,ty,w,20,d[0],d[5]);
    ty+=20;
  });
  return y+latDimRackH();
}

/* ── the numbers that used to be sliders ──
   A band across the FOOT of the inspector rather than a column, because there
   is no column to spare: the plan takes one, the pen and the section
   dimensions take another, and the reactor and fuel families take the last
   two. Across the bottom they also read as what they are - the answer the
   whole panel above came to, rather than one more thing to set. */
const LATREAD=[
  ["RATED POWER",()=>D.power.toFixed(0)+" MWt",
   "Not chosen. Fuel volume times the power density your family and pitch buy. Lay one more assembly and this rises by that annulus - and an outer one is worth far more than an inner one."],
  ["CORE H / D",()=>D.hd.toFixed(2),
   "The shape the lattice revolves to, against the active length you dimensioned. It used to be a slider that a diameter was computed backwards out of."],
  ["LATTICE PITCH",()=>(LAT.pitch*100).toFixed(1)+" cm",
   "Assembly spacing, in centimetres - a real dimension now rather than a ratio. Tighter under-moderates: stronger, safer moderator feedback but less thermal margin."],
  ["BURNABLE POISON",()=>D.poison.toFixed(0)+" pcm",
   "The volume mean of the pins you placed. The bench used to sell you the mean and invent the shape; now you place the shape and the mean is counted."],
  ["CORE DIAMETER",()=>LM.dia.toFixed(2)+" m",
   "The equal-area diameter of the fuel you laid out - the smooth cylinder holding the same assemblies. The ragged corner past it is what the reflector and the albedo boundary are for."],
  ["ASSEMBLIES",()=>String(latCount()),
   "How many fuel assemblies the core has. The plan shows a quarter of them: the axis runs along the corner of the first slot, so every square you place is four assemblies in the finished core."],
];
/* These used to run in a BAND along the foot of a 736-wide inspector, six of
   them abreast at 118px each. A plate column is 158px, so a band would give
   each figure 26px to say a four-digit number with a unit in - they are a
   label-and-value LIST now, which is exactly what a plate row already is, so
   they are drawn by plateRows() and not by a second copy of it. */
const latReadH=rows=>15+(rows||LATREAD).length*PLROW;
function latReadRows(x,y,w,rows){
  rows=rows||LATREAD;
  rule("MEASURED",x,y+9,w,C.cyan);
  plateRows(x,y+15,w,rows.map(r=>[r[0],r[1](),r[3]?r[3]():C.cyan]));
  rows.forEach((r,i)=>TIP(x,y+15+i*PLROW,w,PLROW,r[0]+"  [ MEASURED ]",r[2]));
  return y+latReadH(rows);
}
/* the rod drives ask for different numbers, and every one of them is a
   consequence of where the clusters went */
const LATREAD_RODS=[
  ["CONTROL BANK WORTH",()=>D.rodw.toFixed(0)+" pcm",
   "Measured, not bought: the bank is driven fully in and the flux-weighted worth is read straight off the solve. Move a cluster inward and this rises, because that is where the flux is. Note that the NUMBER of clusters does not change it - full insertion covers the core once however many you fit - so the handles are the absorber material and how near the flux you put them."],
  ["ROD BANKS",()=>String(D.nbank),
   "How many distinct banks your clusters are grouped into. One bank cannot tilt anything, because a tilt needs something to lean against.",
   ()=>D.nbank<2?C.amber:C.cyan],
  ["CLUSTER RINGS",()=>String(LM.chan.length),
   "How many of the fourteen mesh rings have a cluster somewhere in them. This is what the solver actually sees of your plan: two clusters in the same ring are one channel to it."],
  ["SHUTDOWN MARGIN",()=>derived().sdm.toFixed(0)+" pcm",
   "How firmly the BANK ALONE holds the core down once it cools and the xenon decays. Usually negative, and that is not a fault - rods do not win that argument on a real plant either, which is what boron is for. The bench only blocks a design when full boration cannot hold it either.",
   ()=>derived().sdm<200?C.red:C.green],
];
