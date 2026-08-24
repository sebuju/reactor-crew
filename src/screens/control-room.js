"use strict";
/* the live control screen */

/* ─────────────── CONTROL ROOM: same plant, same inspector, live ─────────────── */
/* A vital is a BAR, and the number under it is the detail. Six numbers in a row
   cannot be read at a glance, because reading one means remembering the limit it
   is judged against - six different limits, three of which move with the
   architecture. A bar carries its own limit on the track, so the row is one
   shape: everything short and left is a plant with margin.

   Every bar FILLS TOWARD TROUBLE. Empty is comfortable, the tick is the line the
   plant trips or alarms on, and the track runs on past it into the quarter you
   are not supposed to be in. That is one mental model for six quantities, which
   is the whole reason this stopped being six numbers.

   `v.u` is the value in LIMIT UNITS: 1.0 means "at the line", whatever the line
   is. LIM_AT places it on the track. Pressure is the one two-sided vital - both
   ends are a trip - so it is the one signed bar, centred on P0. */
function vital(x,y,w,v){
  const ch=v.ch, on=ch&&plot.includes(ch);
  let hv=false;
  if(ch){ const wd=push({x,y,w,h:44,type:"btn",fn:()=>togglePlot(ch)}); hv=hov(wd); }
  fillRect(x,y,w,44,C.panel); frame(x,y,w,44,on?CH[ch].col:(hv?C.edge2:C.edge));
  txt(v.lab,x+7,y+13,{size:6,sp:1.1,caps:1,color:C.ink2});
  segMark(x+7,y+19,w-14,6,v.u*LIM_AT,v.sgn?[-LIM_AT,LIM_AT]:[LIM_AT],v.col,v.sgn);
  txt(v.val,x+7,y+38,{size:8,color:v.col||C.cyan});
  if(v.unit) txt(v.unit,x+w-6,y+38,{size:6.5,align:"right",color:C.ink2});
  if(v.tip) TIP(x,y,w,44,v.lab,v.tip);
}

/* ══ A COMPONENT IS ITS OWN PANEL ══
   These readouts used to be a 736-wide box parked under the plant. They are
   drawn INSIDE the component that owns them now, so the number and the machine
   it came off are the same object on the screen.

   The four columns became four BLOCKS, and how many of them stand side by side
   depends on how wide the component is: a 4-cell reactor takes two abreast, a
   1-cell pump takes one and stacks them. Nothing else in the two hundred lines
   below changed shape - every X[k] became CX(k) and every Y0 became CY(k), so
   each block still knows only which block it is. */
/* ══ THE CONTROL ROOM IS ONE SCREEN ══
   Top bar, the six numbers you never want to have to hunt for, then the plant
   filling everything left - and the plant carries every component's readouts
   itself, on plates in its own margins. Nothing is stacked below anything,
   because there is no below: the page is exactly the window. */
function drawOperate(){
  const s=S;
  vitalRow(44);
  const bh=20, vy=96, vh=Math.max(120,H-vy-bh-4);
  drawPlant(vy,s,vh);
  /* a trip is news, so it is drawn ACROSS the plant rather than stacked above it */
  if(s.melt||s.breach){
    const bl=performance.now()%1000<500;
    fillRect(12,vy+8,736,30,bl?"#3a0d08":"#1a0605");
    txt(s.melt?"CORE MELT - UNRECOVERABLE":"VESSEL RUPTURE - UNRECOVERABLE",380,vy+28,
      {size:12,weight:700,sp:3,align:"center",color:C.red});
  } else if(s.trip){
    fillRect(12,vy+8,736,22,"#1a1206");
    txt("LAST TRIP / "+s.trip,380,vy+23,{size:9,weight:700,sp:1.6,align:"center",color:C.amber});
  }
  /* clear of the trip banner above it, and on the left because the ZOOM key
     already owns the top right corner of the viewport */
  alarmStack(VIEW.x+4, VIEW.y+44);
  drawOverlay();
  const e=LOG[LOG.length-1];
  ovlBar(H-bh,bh, e? "T+"+e.t.toFixed(1)+"  "+e.msg : "PLANT NOMINAL - NO EVENTS");
}
/* The six limits, and where each vital stands against its own. Every one of
   these is the number the plant actually judges itself by - tripCause() for the
   five that trip, and the vLeak span for inventory - so the tick on the track
   and the thing that bites are the same number, read from one place.

   Two of the six are scaled against the COMMISSIONED plant rather than an
   absolute figure, because at rest they are nowhere near each other across the
   architectures: DNBR is 1.54 on a BWR and 3.42 on an SFR, and subcooling is
   22 K on a PWR against 1400 K on an HTGR. Measured, not guessed. For those the
   bar reads "how much of the margin you were built with has gone", so an empty
   bar is a plant standing where it was commissioned.

   Inventory has no trip. Its line is 95%, where vLeak in step() starts eating
   heat removal, and the bar is spanned onto 70%, where it has eaten all of it. */
function vitalRow(y){
  /* s.sc is the subcooling step() already worked out and tripCause() already
     judges. Recomputing tsat(s.P)-Th here made a second copy of it that could
     drift from the one that trips the plant. */
  const s=S, m=P.rpsm, sc=s.sc;
  const nTrip=1.10+0.22*m, dTrip=1.18-0.16*m,
        pLo=P.P0*0.86, pHi=P.P0*(1.06+0.07*m);
  /* toward: 0 where the plant sits at commissioning, 1 at the line */
  const toward=(now,rest,lim)=> rest===lim ? 0 : (rest-now)/(rest-lim);
  const V=[
   {lab:"REACTOR POWER",val:(s.n*100).toFixed(1),unit:"%",ch:"pwr",
    u:s.n/nTrip, col:(s.n>1.1||s.dnbr<1.3)?C.red:C.green,
    tip:"Heat the core is making as a share of rated output. The bar fills toward the high-flux trip at "+(nTrip*100).toFixed(0)+"%, marked on the track; past that mark you are running on a bypassed protection system."},
   {lab:"DNBR",val:s.dnbr.toFixed(2),unit:"",ch:"dnbr",
    u:toward(s.dnbr,P.dnbr0,dTrip), col:s.dnbr<1?C.red:s.dnbr<1.3?C.amber:C.cyan,
    tip:"Departure from Nucleate Boiling Ratio. Nucleate boiling is bubbles forming and collapsing on the fuel pins, which cools them very well. Departure is those bubbles joining into one continuous steam film, which does not. This, not the rating, limits how hard you can push. The bar is the thermal margin you were commissioned with being spent: empty is the "+P.dnbr0.toFixed(2)+" you were built with, the mark is the trip at "+dTrip.toFixed(2)+"."},
   {lab:"PRESSURE",val:s.P.toFixed(2),unit:"MPa",ch:"prs",sgn:1,
    u:s.P>=P.P0 ? (s.P-P.P0)/(pHi-P.P0) : (s.P-P.P0)/(P.P0-pLo),
    col:pColor(s.P),
    tip:"Primary loop pressure. Raises the boiling point, so it directly buys thermal margin. The only vital where both directions are a trip, so the bar is centred on the design pressure of "+P.P0.toFixed(2)+" MPa and marked at both trips: "+pLo.toFixed(2)+" low, "+pHi.toFixed(2)+" high."},
   {lab:"SUBCOOLING",val:sc.toFixed(1),unit:"K",ch:"sub",
    u:toward(sc,P.sc0,3), col:sc<8?C.red:C.cyan,
    tip:"Degrees below boiling in the hot leg. The honest leak indicator - it collapses before anything else admits the loop is voiding. This plant was commissioned "+P.sc0.toFixed(0)+" K subcooled, so the bar is that cushion being spent, marked at the 3 K trip."},
   {lab:"INVENTORY",val:s.inv.toFixed(1),unit:"%",ch:"inv",
    u:(100-s.inv)/30, col:s.inv<95?C.red:C.blue,
    tip:"How much water is actually in the loop. A real plant has no such gauge. Nothing trips on it, but below the 95% mark the missing water starts taking heat removal with it, and by 70% - the end of this bar - it has taken all of it."},
   {lab:"XENON",val:s.parts.xe.toFixed(0),unit:"pcm",ch:"xe",
    u:-s.parts.xe/3200, col:-s.parts.xe>3200?C.blue:C.cyan,
    tip:"Xenon-135 poison. Slow, remembers your power history, and can lock you out of restarting. The mark is 3200 pcm, about where the pit costs you more reactivity than the rods have left to give."}];
  V.forEach((v,i)=>vital(12+i*124,y,116,v));
}

/* ══ everything else, over the plant ══
   One entry per panel, in the order the keys read along the bottom bar. The
   draw functions are the ones that were already there - an overlay is the same
   736-wide column they were drawing into, so not one of them had to be re-laid.
   Heights are RESERVED rather than measured: a panel that changes height would
   move its own keys under the pointer. */
/* TWO of the six are gone, and each for its own reason.

   ALARMS was the whole 26-tile board opened over the plant. Twenty-six tiles do
   not belong on top of a plant view, and twenty of them are dark: what you need
   while operating is what is LIT, which is now a stack that floats on the edge
   of the plant and is never shut. The board itself was still worth keeping, but
   as REFERENCE and not as state, so it moved to the help screen beside
   everything else that explains rather than reports.

   LEDGER was every reactivity term. Every one of them is a property of the
   reactor, so they are rows on the reactor's own plate now, under a REACTIVITY
   head, each still carrying its bar. Its right-hand column was already said
   somewhere better: fuel damage and vessel fatigue on the core, release on
   containment, natural circulation on the pumps, instrument trust on the
   cabinet, T-avg deviation on the turbine. Only PERIOD had no home, and it has
   one now - on the core, computed in sample() where the clock ticks once.

   The four that stay, stay on purpose. TRENDS is the one that MUST be a panel:
   a strip chart is 716 units wide and a plate column is 144, and three minutes
   of history in 144 units at fit scale is a texture, not a chart. LOG is
   history rather than state. REPAIR is the "how many" view; the act itself is
   already a key on the broken component. FAULTS is a workbench, not a plant
   control. */
ovlAdd({k:"trend",label:"TRENDS",h:200,sc:"operate",draw:drawTrend,
  tip:"Strip charts. Click a vital along the top of the screen to add or drop its trace."});
ovlAdd({k:"log",label:"LOG",h:180,sc:"operate",draw:drawLog,
  tip:"The last few events and why each one happened. The newest is always on the bar behind this key."});
ovlAdd({k:"dmg",label:"REPAIR",h:92,sc:"operate",draw:drawDamage,
  tip:"Damaged equipment and the repair parties you can send. A damaged component also carries its own repair key on the plant."});
ovlAdd({k:"flt",label:"FAULTS",h:88,sc:"operate",draw:drawFaults,
  tip:"Developer buttons for causing emergencies on demand. In the finished game these come from combat damage, not from you."});

/* ══ THE ALARM STACK ══
   Ported from .trash/mockups/z1-liveplant.js, which put it this way and gave
   the reason: twenty-six tiles do not belong on top of a plant view, so only
   what is LIT is on screen and the header keeps the count honest when nothing
   is. It floats on the edge of the plant rather than living in the view
   transform, so it keeps its size at every zoom - the same rule the ZOOM key
   follows, and for the same reason: it is a thing you read, not a thing you
   are looking at the plant through.

   It sits BELOW the trip banner, which is drawn across the top of the viewport
   and is 30 units tall. Overlapping it would put the two loudest things on the
   screen in the same place. */
/* ALW was 138 for no reason anything inside it needed - every alarm name is
   fixed (ANN never changes at runtime) and already drawn through fitTxt(),
   which shrinks a label that does not fit. Measured instead: the real tw()
   over every label at the row's own type, plus the row's own 10-unit margin
   each side, so a longer name added to ANN widens the stack instead of
   clipping. Computed once and cached, since ANN is a constant table. */
let ALW_CACHE=null;
function alwWidth(){
  if(ALW_CACHE) return ALW_CACHE;
  let m=0;
  for(const a of ANN) m=Math.max(m,tw(a[0],{size:7.5,weight:700,sp:.8}));
  return ALW_CACHE=Math.ceil(m)+20;
}
function alarmStack(x,y){
  const ALW=alwWidth();
  const lit=ANN.filter(a=>a[2](S));
  /* NOTHING when nothing is lit, and that is not the mockup's answer - it drew
     a box reading PLANT NOMINAL. The mockup had a fixed 660px page with room
     going spare; this page is exactly the window, and the stack floats OVER the
     plant rather than beside it, so an empty box is 37 units of a component's
     readouts hidden to say that there is nothing to say. The bottom bar already
     reads PLANT NOMINAL - NO EVENTS when it is quiet. An annunciator with no
     alarm on it should be invisible. */
  if(!lit.length) return 0;
  const rows=Math.min(lit.length,9), h=18+rows*15+4;
  const top=lit.some(a=>a[1]==="red")?C.red:C.amber;
  /* a catcher first: a click on the stack must not reach the plant behind it */
  push({x,y,w:ALW,h,type:"btn"});
  /* flat: the header text and the count are already in the alarm colour, and
     every lit row inside is filled solid in its own - the outline was a third
     cue on a panel that is already opaque and needs no edge to separate it
     from what is behind it. */
  fillRect(x,y,ALW,h,"rgba(7,12,13,.92)");
  txt("ALARMS",x+7,y+13,{size:7,sp:1.4,color:top});
  txt(String(lit.length),x+ALW-7,y+13,{size:7,sp:1,align:"right",color:top});
  TIP(x,y,ALW,18,"ALARM STACK",
    "Every annunciator that is currently lit, and nothing that is not - it is not drawn at all when the plant is quiet. The full board of all "+ANN.length+", including the ones that are dark, is on the HELP screen: what they MEAN is reference, what is LIT is state. A component on the plant also carries one lamp when any of its own alarms is up.");
  lit.slice(0,rows).forEach((a,i)=>{
    const ry=y+18+i*15, col=a[1]==="red"?C.red:a[1]==="amber"?C.amber:C.blue;
    /* red blinks on the annunciator's own rhythm, so a tile here and the lamp
       on the component it belongs to read as one thing seen in two places */
    const on=!(a[1]==="red"&&performance.now()%900<450);
    fillRect(x+5,ry+3,ALW-10,13,on?col:"rgba(0,0,0,0)");
    fitTxt(a[0],x+10,ry+13,ALW-20,{size:7.5,weight:700,sp:.8,color:on?"#120404":col});
    TIP(x+5,ry+3,ALW-10,13,a[0]+"  [ LIT ]",a[3]);
  });
  if(lit.length>rows)
    txt("+"+(lit.length-rows)+" MORE",x+7,y+h-6,{size:6.5,sp:1,color:C.amber});
  return h;
}

function drawTrend(yy){
  const x=12,y=yy,w=736,h=176;
  well(x,y,w,h,"TREND / CLICK ANY GAUGE, BENCH OR READOUT TO PLOT IT",C.amber);
  const px=22,py=y+24,pw=716,ph=112;
  fillRect(px,py,pw,ph,C.well); frame(px,py,pw,ph,C.edge);
  for(let g=1;g<4;g++) fillRect(px,py+ph*g/4,pw,1,"rgba(120,180,190,.06)");
  for(let g=1;g<6;g++) fillRect(px+pw*g/6,py,1,ph,"rgba(120,180,190,.05)");

  if(!plot.length||hlen<2){
    txt(hlen<2?"COLLECTING DATA":"NO CHANNELS SELECTED",px+pw/2,py+ph/2+4,
        {size:10,sp:2,align:"center",color:C.ink2});
  } else {
    const stepN=Math.max(1,Math.ceil(hlen/pw));
    plot.forEach(k=>{
      let lo=Infinity,hiV=-Infinity;
      for(let i=0;i<hlen;i+=stepN){ const v=chAt(k,i); if(v<lo)lo=v; if(v>hiV)hiV=v; }
      let span=hiV-lo; if(span<1e-6){ span=Math.max(Math.abs(hiV)*.2,1); lo-=span/2; }
      else { lo-=span*.08; span*=1.16; }
      CH[k]._lo=lo; CH[k]._hi=lo+span;
      ctx.beginPath(); ctx.strokeStyle=CH[k].col; ctx.lineWidth=1.6;
      let first=true;
      for(let i=0;i<hlen;i+=stepN){
        const X=px+(i/(hlen-1))*pw, Y=py+ph-((chAt(k,i)-lo)/span)*ph;
        first?(ctx.moveTo(X,Y),first=false):ctx.lineTo(X,Y);
      }
      ctx.stroke();
    });
  }
  txt("-"+(hlen/10).toFixed(0)+"s",px+3,py+ph-4,{size:7,color:C.ink2});
  txt("NOW",px+pw-3,py+ph-4,{size:7,align:"right",color:C.ink2});

  plot.forEach((k,i)=>{
    const lx=22+i*179, c=CH[k];
    fillRect(lx,y+145,7,7,c.col);
    txt(c.lab,lx+12,y+152,{size:7.5,sp:.9,color:C.ink});
    const cur=hlen?chAt(k,hlen-1):0;
    txt(cur.toFixed(Math.abs(cur)>=100?0:2)+" "+c.u,lx+12,y+166,{size:10,color:c.col});
    if(c._lo!==undefined)
      txt(c._lo.toFixed(0)+" .. "+c._hi.toFixed(0),lx+172,y+166,{size:7.5,align:"right",color:C.ink2});
  });
  if(!plot.length) txt("click a gauge to add a channel  /  four maximum",22,y+160,
      {size:8.5,sp:.8,color:C.ink2});
  TIP(x,y,w,20,"TREND CHART",
    "Rolling three-minute history of any value on the panel. Click any gauge, control bench or readout to add it; click again to remove. Up to four at once, each auto-scaled to its own range shown in the legend.");
  return y+h+12;
}

function drawLog(yy){
  const x=12,y=yy,w=736;
  const shown=LOG.slice(-4).reverse(), body={size:9,color:C.ink2};
  /* the panel is as tall as the entries it holds - four long ones used to spill out */
  let need=0;
  for(const e of shown) need += 13 + wrapCount(e.why,700,body)*12 + 9;
  const h = LOG.length ? 36+need-9+12 : 56;
  well(x,y,w,h,"EVENT LOG / WHAT WENT WRONG AND WHY",C.amber);
  txt(LOG.length+" EVENTS",738,y+15,{size:8,sp:1.2,align:"right",color:C.ink2});
  if(!LOG.length){
    txt("NO EVENTS - PLANT NOMINAL",x+w/2,y+42,{size:10,sp:2,align:"center",color:C.ink2});
  } else {
    let ly=y+36;
    for(const e of shown){
      const col = e.sev==="alarm"?C.red : e.sev==="warn"?C.amber : C.ink2;
      const tag = e.sev==="alarm"?"[ALARM]" : e.sev==="warn"?"[WARN ]" : "[INFO ]";
      chip(22,ly-8,col);
      txt("T+"+pad(e.t.toFixed(1),7),30,ly,{size:9,color:C.ink2});
      txt(tag,96,ly,{size:9,color:col});
      txt(e.msg,152,ly,{size:9.5,weight:700,sp:.7,color:col});
      ly=wrap(e.why,30,ly+13,700,12,{size:9,color:C.ink2})+9;
    }
  }
  TIP(x,y,w,20,"EVENT LOG",
    "Everything that has gone wrong this run, newest first, each with the reason it happened and what it means. Cleared by Reset Plant.");
  return y+h+12;
}

function combatHit(){
  const parts=LAY.parts.filter(q=>q.grp!=="shield"&&fitted(q)&&!S.dmgParts.includes(q.id));
  if(!parts.length) return;
  const wgt=parts.map(q=>{ let e=0;
    for(let X=q.x;X<q.x+q.w;X++) for(let Y=q.y;Y<q.y+q.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) e++;
    return 0.15 + e*1.6; });
  let r=Math.random()*wgt.reduce((a,b)=>a+b,0), k=0;
  while(r>wgt[k] && k<wgt.length-1){ r-=wgt[k]; k++; }
  const p=parts[k];
  S.dmgParts.push(p.id);
  const eff = p.id.startsWith("pump")
    ? ["COOLANT PUMP HIT","That pump is dead. Loop flow drops by its share and thermal margin goes with it."]
    : p.id.startsWith("sg")
    ? ["STEAM GENERATOR TUBE RUPTURE","Primary coolant is leaking into the secondary side and venting past containment. Inventory falls and activity escapes."]
    : ({core:["REACTOR VESSEL HIT","A penetration in the vessel wall. Coolant is leaking and the metal is permanently damaged."],
        rods:["ROD DRIVE HIT","The drive mechanisms are wrecked. The bank is stuck where it stands and a scram will not move it. Boron is the only shutdown you have left."],
        pzr :["PRESSURIZER HIT","The relief valve has been knocked open and will not reseat. Close the block valve on the mimic."],
        turb:["TURBINE HIT","Load rejected. The turbine is offline, so the reactor has nowhere to send its heat."],
        cond:["CONDENSER HIT","Heat rejection lost. Steam has nowhere to condense."],
        feed:["FEED PUMP HIT","Feedwater down to a quarter. The steam generator will boil dry if this is not fixed."],
        ctrl:["INSTRUMENT CABINET HIT","Sensor channels lost. Every reading on the panel is now far less trustworthy."],
        bkp :["BACKUP POWER HIT","Your emergency supply is gone. A blackout now means natural circulation only."],
        hpi :["HPI TANK HIT","Emergency injection is unavailable. You cannot refill a leaking loop."]}[p.id]
       || ["EQUIPMENT HIT","A component has been knocked out."]);
  if(p.id==="core"){ S.inv-=6; S.fatigue=Math.min(100,S.fatigue+12); }
  if(p.id==="rods") S.rodJam=true;
  if(p.id==="pzr"){ S.porvOpen=true; S.porvStuck=true; S.porvAuto=true; }
  if(p.id==="turb"||p.id==="cond") S.load=S.loadDem=0.05;   // a stop valve slams, it does not stroke
  if(p.id==="ctrl") S.noiseMul=3.5;
  if(p.id==="bkp") S.bkpLost=true;
  if(p.id.startsWith("sg")) S.sgtr=true;
  logE("alarm","COMBAT DAMAGE / "+eff[0], eff[1]+
    (p.access?"  A repair party can reach it.":"  IT IS WALLED IN - no repair is possible with this layout."));
}

/* Sending a repair party is ONE act with two ways to ask for it - the card in
   the damage panel and the key on the damaged component itself - so it is one
   function, and it refuses the same way from both. */
const repairNeed=p=>14+p.w*p.h*4;
function repairSend(p){
  if(!p.access||S.repair) return;
  const need=repairNeed(p);
  S.repair={id:p.id,t:0,need};
  logE("info","REPAIR PARTY DISPATCHED / "+p.name,
    "Estimated "+need+" seconds. The party takes dose the whole time, at the rate your layout allows.");
}
function drawDamage(yy){
  const x=12,y=yy,w=736,h=S.dmgParts.length?110:56;
  well(x,y,w,h,"DAMAGE CONTROL",S.dmgParts.length?C.red:C.amber);
  txt("PARTY DOSE "+S.dose.toFixed(1)+" %",738,y+15,
      {size:8,sp:1.2,align:"right",color:S.dose>50?C.red:C.ink2});
  if(!S.dmgParts.length){
    txt("ALL EQUIPMENT IN SERVICE",x+w/2,y+42,{size:10,sp:2,align:"center",color:C.ink2});
  } else {
    let bx=22;
    for(const k of S.dmgParts){
      const part=LAY.parts.find(q=>q.id===k); if(!part) continue;
      const busy=S.repair&&S.repair.id===k, blocked=!part.access, bw=172;
      const need=repairNeed(part);
      const wd=push({x:bx,y:y+30,w:bw,h:56,type:"btn",fn:()=>repairSend(part)});
      fillRect(bx,y+30,bw,56, busy?"#2a1f08":(blocked?"#1a0d0b":(hov(wd)?C.panelHi:C.panel)));
      frame(bx,y+30,bw,56, busy?C.amber:(blocked?C.red:C.edge2));
      txt(part.name,bx+11,y+48,{size:8.5,sp:.5,color:C.bright});
      if(blocked) txt("NO ACCESS / UNREPAIRABLE",bx+11,y+64,{size:7.5,sp:.8,color:C.red});
      else if(busy){ txt("REPAIR IN PROGRESS",bx+11,y+64,{size:7.5,sp:.8,color:C.amber});
        seg(bx+11,y+70,bw-22,8,S.repair.t/S.repair.need,C.amber,18); }
      else txt("CLICK TO DISPATCH PARTY",bx+11,y+64,{size:7.5,sp:.8,color:C.ink2});
      TIP(bx,y+30,bw,56,part.name+(blocked?"  [ UNREACHABLE ]":""),
        blocked?"Your layout walls this component in on every side, so no repair party can reach it. It stays broken for the rest of the run."
        :"Click to send a repair party. Roughly "+need+" seconds, and the party accumulates dose throughout, scaled by how close your control space sits to the reactor.");
      bx+=bw+8; if(bx>x+w-172) break;
    }
  }
  TIP(x,y,w,20,"DAMAGE CONTROL",
    "Equipment knocked out by combat damage. What gets hit is decided by where you put it: hull cells are roughly ten times likelier to be struck, and anything with no free adjacent cell can never be repaired.");
  return y+h+12;
}

function drawFaults(y0){
  const y=y0+16;
  rule("FAULT INJECTION / TEST HARNESS",12,y0+8,736);
  TIP(12,y0,736,14,"FAULT INJECTION",
    "Developer buttons for triggering emergencies on demand. In the real game these would be caused by combat damage, not by you.");
  button(12,y,178,26,"STUCK PORV",{fn:()=>{S.porvOpen=true;S.porvBlocked=false;}});
  TIP(12,y,178,26,"STUCK PORV",
    "The relief valve lifts and fails to reseat, quietly draining the loop. Watch pressure fall while pressurizer level RISES, which is the trap that wrecked Three Mile Island. Close the block valve on the diagram, then start HPI.");
  button(198,y,178,26,"ROD BANK JAM",{on:S.rodJam,fn:()=>S.rodJam=!S.rodJam});
  TIP(198,y,178,26,"ROD BANK JAM",
    "The control rods stop answering commands, including a scram. You are left steering the reactor with boron, coolant flow and turbine load only.");
  const step=(P.loadMax*100).toFixed(0)+"%";
  button(384,y,178,26,"LOAD STEP "+step,{fn:()=>S.loadDem=P.loadMax});
  TIP(384,y,178,26,"LOAD STEP "+step,
    "Slams turbine demand to "+step+" instantly, like a full weapons volley. The primary loop cools, the reactor raises its own power to follow, and thermal margin gets squeezed. The ceiling is the turbine you bought at the bench, not a fixed number.");
  button(570,y,178,26,"RESET PLANT",{fn:resetPlant});

  button(384,y+34,178,26,"COMBAT HIT",{fn:combatHit});
  TIP(384,y+34,178,26,"COMBAT HIT",
    "Takes a hit somewhere in the engineering space. What it destroys is decided by your layout: components sitting in hull cells are roughly ten times more likely to be struck.");
  button(12,y+34,178,26,"STATION BLACKOUT",{on:S.blackout,fn:()=>S.blackout=!S.blackout});
  TIP(12,y+34,178,26,"STATION BLACKOUT",
    "Cuts main power to the coolant pumps. Flow collapses to whatever your backup power and natural circulation can provide - both chosen at the design bench. This is the test that tells you whether the chimney was worth its mass.");
  if(P.boroninj){
    const used=S.borInjUsed;
    button(198,y+34,178,26,used?"BORON EXPENDED":"EMERGENCY BORON",
      {danger:!used,fn:()=>{ if(!S.borInjUsed){ S.borInjUsed=true; S.boron-=4000; S.boronDem-=4000;
        logE("alarm","EMERGENCY BORON INJECTED",
          "4000 pcm of poison dumped into the loop. The reactor is shut down hard and cannot be restarted this run."); } }});
    TIP(198,y+34,178,26,"EMERGENCY BORON INJECTION",
      "One-shot poison dump worth 4000 pcm. Shuts the reactor down when the rods will not, and it cannot be undone for the rest of the run.");
  }
  TIP(570,y,178,26,"RESET PLANT",
    "Returns the reactor to steady 100% power with all faults cleared and damage counters zeroed. Keeps your current design.");
  return y0+88;
}
