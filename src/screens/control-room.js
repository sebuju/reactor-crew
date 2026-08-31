"use strict";
/* the live control screen - the plant view (canvas) plus an HTML rail */

/* ══ VITALS: SIX BARS THAT FILL TOWARD TROUBLE ══
   `v.u` is the value in LIMIT UNITS: 1.0 means "at the line". LIM_AT (chrome.js)
   places that line on the track at a fixed fraction, so every bar reads the
   same shape regardless of what its own units are. */
function crVitalsData(){
  const s=S, m=P.rpsm, sc=s.sc;
  const nTrip=1.10+0.22*m, dTrip=1.18-0.16*m,
        pLo=P.P0*0.86, pHi=P.P0*(1.06+0.07*m);
  const toward=(now,rest,lim)=> rest===lim ? 0 : (rest-now)/(rest-lim);
  return [
   {lab:"REACTOR POWER",val:(s.n*100).toFixed(1),unit:"%",ch:"pwr",
    // coloured by POWER, not by margin - DNBR is the row directly below and
    // says it for itself; see the POWER row in readoutsFor()
    u:s.n/nTrip, col:s.n>1.1?"var(--c-red)":"var(--c-green)",
    tip:"Heat the core is making as a share of rated output. The bar fills toward the high-flux trip at "+(nTrip*100).toFixed(0)+"%; past that mark you are running on a bypassed protection system."},
   {lab:"DNBR",val:s.dnbr.toFixed(2),unit:"",ch:"dnbr",
    u:toward(s.dnbr,P.dnbr0,dTrip), col:s.dnbr<1?"var(--c-red)":s.dnbr<1.3?"var(--c-amber)":"var(--c-cyan)",
    tip:"Departure from Nucleate Boiling Ratio. The bar is the thermal margin you were commissioned with being spent: empty is the "+P.dnbr0.toFixed(2)+" you were built with, the mark is the trip at "+dTrip.toFixed(2)+"."},
   {lab:"PRESSURE",val:s.P.toFixed(2),unit:"MPa",ch:"prs",sgn:1,
    u:s.P>=P.P0 ? (s.P-P.P0)/(pHi-P.P0) : (s.P-P.P0)/(P.P0-pLo),
    col:cssCol(pColor(s.P)),
    tip:"Primary loop pressure. The one vital where both directions are a trip - centred on "+P.P0.toFixed(2)+" MPa, marked at "+pLo.toFixed(2)+" low and "+pHi.toFixed(2)+" high."},
   {lab:"SUBCOOLING",val:sc.toFixed(1),unit:"K",ch:"sub",
    u:toward(sc,P.sc0,3), col:sc<8?"var(--c-red)":"var(--c-cyan)",
    tip:"Degrees below boiling in the hot leg - the honest leak indicator. Commissioned "+P.sc0.toFixed(0)+" K subcooled, marked at the 3 K trip."},
   {lab:"INVENTORY",val:s.inv.toFixed(1),unit:"%",ch:"inv",
    u:(100-s.inv)/30, col:s.inv<95?"var(--c-red)":"var(--c-blue)",
    tip:"How much water is actually in the loop. Nothing trips on it, but under 95% the missing water starts taking heat removal with it."},
   {lab:"XENON",val:s.parts.xe.toFixed(0),unit:"pcm",ch:"xe",
    u:-s.parts.xe/3200, col:-s.parts.xe>3200?"var(--c-blue)":"var(--c-cyan)",
    tip:"Xenon-135 poison. The mark is 3200 pcm, about where the pit costs you more reactivity than the rods have left to give."}];
}
/* the balances the vitals panel draws under its six bars, in draw order */
const CR_VIZ=[
 {k:"rho", title:"REACTIVITY BALANCE", tip:RHOVIZ_TIP,  draw:rhoViz},
 {k:"heat",title:"HEAT BALANCE",       tip:HEATVIZ_TIP, draw:heatViz},
];
function crVitalsBuild(container){
  const rows=[];
  for(let i=0;i<6;i++){
    const row=KIT.el("div","cr-vital");
    /* A SQUARE DOT, not a lit row. Tinting the whole row said "plotted" in the
       same language the bars use for "in trouble", so a plotted channel read as
       an alarming one. The dot carries the channel's own trend colour, which is
       also the one thing that ties a row to its curve in the chart below. */
    const plotDot=KIT.el("span","cr-vital-plot");
    const lab=KIT.el("span","cr-vital-lab");
    /* The strip lives in its own box because WHICH strip it is depends on the
       row's data, and the data needs a commissioned plant to exist. The box
       holds the place in the grid; crVitalsSync() puts the right instrument
       in it. */
    const barBox=KIT.el("span","cr-vital-bar");
    const bar=KIT.segMark({cells:24}); barBox.appendChild(bar.el);
    const val=KIT.el("span","cr-vital-val");
    row.append(plotDot,lab,barBox,val);
    container.appendChild(row);
    row.addEventListener("click",()=>{ const d=crVitalsData()[i]; if(d.ch) togglePlot(d.ch); });
    rows.push({row,plotDot,lab,barBox,bar,val,signed:false});
  }
  return rows;
}
function crVitalsSync(rows){
  const data=crVitalsData();
  data.forEach((v,i)=>{
    const h=rows[i];
    /* A TWO-SIDED ROW NEEDS A TWO-SIDED STRIP. PRESSURE is the one vital where
       both directions are a trip, so it carries marks at -LIM_AT as well as
       +LIM_AT - and on an UNSIGNED strip a negative mark is drawn at a negative
       percentage, i.e. off the left end of the bar and straight over the label
       beside it. The row's own data says which it is, so the widget is built
       from that rather than from the position it happens to sit in. */
    const wantSigned=!!v.sgn;
    if(h.signed!==wantSigned){
      h.barBox.innerHTML="";
      h.bar=KIT.segMark({cells:24,signed:wantSigned});
      h.barBox.appendChild(h.bar.el); h.signed=wantSigned;
    }
    if(h.lab.textContent!==v.lab) h.lab.textContent=v.lab;
    const s2=v.val+(v.unit?" "+v.unit:"");
    if(h.val.textContent!==s2) h.val.textContent=s2;
    h.val.style.color=v.col;
    h.bar.set(v.u*LIM_AT, v.sgn?[-LIM_AT,LIM_AT]:[LIM_AT], v.col);
    KIT.tip(h.row,v.lab,v.tip);
    const on = !!(v.ch&&plot.includes(v.ch));
    h.row.classList.toggle("on", on);
    const dc = on ? CH[v.ch].col : "";
    if(h.plotDot.style.background!==dc) h.plotDot.style.background=dc;
  });
}

/* ══ THE ALARM STACK: NOTHING WHEN NOTHING IS LIT ══ */
function crAlarmsBuild(container){
  const rows=ANN.map(a=>{
    const row=KIT.el("div","cr-alarm-row");
    const dot=KIT.el("span","cr-alarm-dot"); row.appendChild(dot);
    const lab=KIT.el("span"); lab.textContent=a[0]; row.appendChild(lab);
    KIT.tip(row,a[0],a[3]);
    container.appendChild(row);
    return {row,a};
  });
  return rows;
}
/* the count element is held, not searched for, and written only when the count
   moves - it was a querySelector plus a textContent write every frame to say the
   same number. */
function crAlarmsSync(al){
  let lit=0;
  for(const h of al.rows){
    const on=h.a[2](S);
    if(on) lit++;
    h.row.classList.toggle("lit",on);
    h.row.classList.toggle("red",on&&h.a[1]==="red");
    h.row.classList.toggle("amber",on&&h.a[1]==="amber");
    KIT.show(h.row,on);
  }
  KIT.show(al.wrap,lit);
  if(lit!==al.lit){ al.lit=lit; al.count.textContent=String(lit); }
}

/* ══ TRENDS: chart() STAYS CANVAS, IN ITS OWN CANVAS UNDER THE VITALS ══
   Not on #cv: the plate it sits on is opaque and paints over it. hostPaint()
   swaps ctx and gives it its own box - see render/plant.js.

   It lives with the vitals because clicking a vital is the only way to put a
   channel on it, and the two were a screen apart: you plotted something in one
   corner and went looking for it in the other. Nothing plotted, nothing drawn -
   an empty chart taking 130 px to say "NO CHANNELS SELECTED" is worse than the
   space back.

   ── IT IS SIZED OFF THE HTML AROUND IT, NOT OFF ITSELF ──
   At HOST_K one layout unit is one and a half CSS pixels, so every number here
   is a CSS measurement divided by that, and the panel is what states them:

     k    0.87 puts the legend NAME on TSCALE's 6.5 - the step HOST_K was
          picked to land on the 10 px floor src/style.css gives HTML type, so
          it matches the vital labels stacked directly above - and the READING
          one step up at 8, because a reading that is the same size as its own
          caption stops looking like the number the panel is for. At 0.7 both
          collapsed onto the bottom of the ladder and the chart read as a
          footnote to the panel rather than part of it.
     pad  CR_TREND_PAD is .cr-vital's 8 px side padding, so the plot frame
          stands in the same column as the six labels instead of 7 px inside them.
     ph   the plot takes everything the legend does not: CR_TREND_LEG is the
          legend band, and chart()'s `top` of 6 is the breathing room under the
          border-top that separates this from the vitals. */
const CR_TREND_PAD=8/HOST_K, CR_TREND_LEG=13;
/* ── ONE CHART PER CHANNEL, NOT ONE CHART PER PANEL ──
   Four channels sharing one plot meant four invisible scales stacked on top of
   each other, so a curve's HEIGHT said nothing and two curves crossing said
   nothing either. Each channel gets its own small plot instead, pinned to its
   own range (CHVIEW, trends.js) with its own warning lines on it - so the
   picture is "where is this against its limit", which is the only question the
   panel is ever asked. A one-series legend is one line (chartLegend), which is
   what pays for the extra frames. */
function crTrendSync(host){
  const want=plot;
  KIT.show(host.box, want.length>0);
  for(const k in host.cvs)
    if(!want.includes(k)){ host.box.removeChild(host.cvs[k]); delete host.cvs[k]; }
  want.forEach((k,i)=>{
    let cv2=host.cvs[k];
    if(!cv2){
      cv2=KIT.el("canvas","cr-trend-canvas");
      KIT.tip(cv2,"TREND / "+CH[k].lab,
        "Rolling history of this channel. The scale is fixed to the range the plant is steered in, so a flat trace reads flat; the dashed lines are the trip and alarm limits it is being read against. Click the vital above to take it off.");
      host.cvs[k]=cv2;
    }
    // DOM order follows plot order, so reordering the picks reorders the stack
    if(host.box.children[i]!==cv2) host.box.insertBefore(cv2, host.box.children[i]||null);
  });
  if(!want.length) return;
  for(const k of want) hostPaint(host.cvs[k],(x,y,w,h)=>{
    const V=CHVIEW[k]||{}, R=V.rng?V.rng():null;
    const ser=[{lab:CH[k].lab,u:CH[k].u,col:CH[k].col,n:hlen,at:i=>chAt(k,i),
                lo:R?R[0]:undefined, hi:R?R[1]:undefined}];
    const box=chart(x,y,w,h,{
      series:ser, n:hlen, k:0.87, pad:CR_TREND_PAD,
      ph:Math.max(20,h-4-CR_TREND_LEG),
      hline:V.warn?V.warn():null,
      empty:"COLLECTING DATA",
      xlab:["-"+(hlen/10).toFixed(0)+"s","NOW"]});
    chartLegend(box,box.py+box.ph+3,ser);
  });
}

/* drawTrend()/drawLog() draw full-width on #cv - not for this screen, which
   has its own hosted chart (crTrendSync) and an HTML log (crLogSync), but
   because scenario.js reuses these two by reference for its own overlays, so
   a scenario run's history reads exactly like a free-play run's. */
function drawTrend(yy){
  const x=12,y=yy,w=736,h=176;
  const ser=plot.map(k=>({lab:CH[k].lab,u:CH[k].u,col:CH[k].col,n:hlen,at:i=>chAt(k,i)}));
  const box=chart(x,y,w,h,{
    title:"TREND / CLICK ANY GAUGE TO PLOT IT",
    series:ser, n:hlen,
    empty:hlen<2?"COLLECTING DATA":"NO CHANNELS SELECTED",
    xlab:["-"+(hlen/10).toFixed(0)+"s","NOW"]});
  chartLegend(box,y+145,ser);
  TIP(x,y,w,20,"TREND CHART","Rolling three-minute history of any plotted channel.");
  return y+h+12;
}
function drawLog(yy){
  const x=12,y=yy,w=736;
  const shown=LOG.slice(-4).reverse(), body={size:9,color:C.ink2};
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
      const sv=logSev(e), col=sv.col(), tag=sv.tag;
      chip(22,ly-8,col);
      txt("T+"+pad(e.t.toFixed(1),7),30,ly,{size:9,color:C.ink2});
      txt(tag,96,ly,{size:9,color:col});
      txt(e.msg,152,ly,{size:9.5,weight:700,sp:.7,color:col});
      ly=wrap(e.why,30,ly+13,700,12,{size:9,color:C.ink2})+9;
    }
  }
  TIP(x,y,w,20,"EVENT LOG","Everything that has gone wrong this run, newest first.");
  return y+h+12;
}

/* ══ TWO POOLED LISTS ══
   Both used to throw their DOM away and build it again whenever their contents
   changed - the log on every single new event, which is once a second in a
   transient and is exactly when the panel is being read. A row is a row: keep
   as many as are wanted, hide the rest, and write only the text that differs.
   crPool() is the one place that grows and trims, so neither list carries its
   own copy of the same three lines. */
function crPool(list,n,mk){
  const pool=list._pool||(list._pool=[]);
  while(pool.length<n){ const h=mk(); list.appendChild(h.el); pool.push(h); }
  pool.forEach((h,i)=>{ const on=i<n; if(h.el.hidden!==!on) h.el.hidden=!on; });
  return pool;
}
function crEmpty(list,text,empty){
  let p=list._empty;
  if(!p){ p=list._empty=KIT.el("p","cr-empty"); p.textContent=text; list.appendChild(p); }
  if(p.hidden!==!empty) p.hidden=!empty;
}

const CR_LOG_N=8;
function crLogSync(list){
  const shown=LOG.slice(-CR_LOG_N).reverse();
  crEmpty(list,"NO EVENTS - PLANT NOMINAL",!shown.length);
  const pool=crPool(list,shown.length,()=>{
    const el=KIT.el("div","cr-log-row");
    const t=KIT.el("span","cr-log-t");
    const m=KIT.el("span","cr-log-m");
    const w=KIT.el("p","cr-log-w");
    el.append(t,m,w);
    return {el,t,m,w};
  });
  shown.forEach((e,i)=>{
    const h=pool[i], cls="cr-log-row "+e.sev, ts="T+"+e.t.toFixed(1);
    if(h.el.className!==cls) h.el.className=cls;
    if(h.t.textContent!==ts) h.t.textContent=ts;
    if(h.m.textContent!==e.msg) h.m.textContent=e.msg;
    if(h.w.textContent!==e.why) h.w.textContent=e.why;
  });
}

function crDamageSync(list){
  const ids=S.dmgParts;
  crEmpty(list,"ALL EQUIPMENT IN SERVICE",!ids.length);
  const pool=crPool(list,ids.length,()=>{
    const el=KIT.el("div","cr-dmg-card");
    const name=KIT.el("div","cr-dmg-name");
    const state=KIT.el("div","cr-dmg-state");
    const dose=KIT.el("div","cr-dmg-dose");
    el.append(name,state,dose);
    /* the card is reused by whatever part is at this slot next, so the handler
       reads its CURRENT part rather than closing over one */
    const h={el,name,state,dose,id:null};
    el.addEventListener("click",()=>{ if(h.id) act("repair",h.id); });
    return h;
  });
  /* the field is SOLVED ONCE for the whole card list, not once per card - the
     same field every card below reads radParty() against, per the "one
     accessor" rule rad.js documents for radSrc()/radSolve() itself. */
  const f = ids.length ? radSolve(P.radK, radSrc(S)) : null;
  const g = ids.length ? occupied(null) : null;
  ids.forEach((k,i)=>{
    const h=pool[i], part=dmgPart(k);
    h.id=k;
    const nm=part?partName(part):k.toUpperCase(), blocked=!(part&&part.access);
    const busy=S.repair&&S.repair.id===k;
    if(h.name.textContent!==nm) h.name.textContent=nm;
    h.el.classList.toggle("blocked",blocked);
    h.el.classList.toggle("busy",!!busy);

    let st, tip;
    if(S.partySpent){
      st="PARTY EXPENDED";
      tip="The repair party has taken all the dose it is going to take this run. Nobody is left to send out - whatever is still fitted and working is what you finish the run with.";
    } else if(blocked){
      st="NO ACCESS";
      tip="Your layout walls this component in on every side, so no repair party can reach it.";
    } else if(busy){
      st=Math.round(S.repair.t/S.repair.need*100)+"%";
      tip="Repair under way. The party is taking dose the whole time, at the rate shown below.";
    } else {
      st="CLICK TO DISPATCH";
      tip="Click to send a repair party. It works from the coldest free cell beside this component, and the dose it takes is scaled by THAT cell - not by how close your control space sits to the reactor.";
    }
    if(h.state.textContent!==st) h.state.textContent=st;

    /* the estimate the card PROMISES has to be the dose the sim will actually
       charge: rate*RAD_DOSE_K*dt integrated over the real time the job takes
       (need/radWorkK(rate), since work only advances at that fraction of a
       second per second) is exactly rate*RAD_DOSE_K*need/radWorkK(rate). */
    const showDose = part && !blocked && !S.partySpent;
    const rate = showDose ? radParty(f,part,g) : 0;
    const doseTxt = showDose
      ? rate.toFixed(2)+"x FIELD  ·  "+(rate*RAD_DOSE_K*repairNeed(part)/radWorkK(rate)).toFixed(2)+"% JOB"
      : "";
    if(h.dose.textContent!==doseTxt) h.dose.textContent=doseTxt;
    const doseCol = showDose ? ZONE[zoneOf(rate)].col : "";
    if(h.dose.style.color!==doseCol) h.dose.style.color=doseCol;

    KIT.tip(h.el,nm+(blocked?"  [ UNREACHABLE ]":S.partySpent?"  [ PARTY EXPENDED ]":""), tip);
  });
}

// ESC PUTS THE TOOL BACK, the same key and the same one way out of a mode the
// bench has
keyAdd({k:"Escape", sc:"operate", lab:"SELECT", fn:()=>{ TOOL.active="select"; }});

function crFaultsBuild(container){
  const scram=(l,o)=>KIT.button(l,o);
  const porv=scram("STUCK PORV",{onClick:()=>act("porvStick")});
  KIT.tip(porv.el,"STUCK PORV","The relief valve lifts and fails to reseat, quietly draining the loop.");
  const jam=scram("ROD BANK JAM",{onClick:()=>act("rodJam")});
  KIT.tip(jam.el,"ROD BANK JAM","The control rods stop answering commands, including a scram.");
  const load=scram("LOAD STEP",{onClick:()=>act("loadDem",P.loadMax)});
  KIT.tip(load.el,"LOAD STEP","Slams turbine demand to the turbine's own ceiling instantly.");
  const reset=scram("RESET PLANT",{onClick:()=>act("reset")});
  KIT.tip(reset.el,"RESET PLANT","Returns the reactor to steady 100% power with all faults cleared. Keeps your current design.");
  const hit=scram("RANDOM COMBAT HIT",{onClick:()=>act("hit")});
  KIT.tip(hit.el,"RANDOM COMBAT HIT","Takes a hit somewhere in the engineering space, weighted toward the hull.");
  /* The aimed hit is a TOOL, not a button that damages on the press: the target
     is a machine on the plant, so it is picked on the plant. */
  const aim=scram("AIMED COMBAT HIT",{onClick:()=>{ TOOL.active = TOOL.active==="hit"?"select":"hit"; }});
  KIT.tip(aim.el,"AIMED COMBAT HIT",TOOLS.find(t=>t.id==="hit").tip);
  const black=scram("STATION BLACKOUT",{onClick:()=>act("blackout")});
  KIT.tip(black.el,"STATION BLACKOUT","Cuts main power to the coolant pumps.");
  /* Opens EVERY tank that could poison the loop, off what is in them. It is a
     shortcut for the tanks' own valves and nothing more - there is no one-shot
     latch behind it any more, because a tank that is empty is empty. */
  const boron=scram("EMERGENCY BORON",{danger:true,
    onClick:()=>{ for(const id of boronTankIds()) if(!S.tankOpen[id]) act("tankOpen",id); }});
  container.append(porv.el,jam.el,load.el,reset.el,hit.el,aim.el,black.el,boron.el);
  return {porv,jam,load,reset,hit,aim,black,boron};
}
function crFaultsSync(h){
  if(!P) return;
  h.porv.set({on:reliefAnyStuck(S)});
  h.jam.set({on:S.rodJam});
  h.aim.set({on:TOOL.active==="hit"});
  h.load.set({label:"LOAD STEP "+(P.loadMax*100).toFixed(0)+"%"});
  h.black.set({on:S.blackout});
  const bt=boronTankIds(), spent=bt.length>0 && bt.every(id=>S.tank[id]<=0);
  KIT.show(h.boron.el,bt.length>0);
  h.boron.set({label:spent?"BORON EXPENDED":"EMERGENCY BORON",disabled:spent});
}

/* ══ THE COMPONENT RAIL: EVERY FITTED COMPONENT'S readoutsFor() TABLE ══ */
/* ══ WHICH SIDE OF THE PLANT A MACHINE IS ON, ASKED OF THE DRAWING ══
   loopOf() answers for the five LOOP_ROLEs and null for everything else, which
   is why a relief tank hanging off the primary read as plant-wide. The node
   graph knows better and it is the same graph the solve walks: a part's nodes
   are primary or they are not (nodeGraph().primary), so the side is MEASURED,
   never declared. A generator has nodes on both and is caught by loopOf()
   first, which is correct - it belongs to its loop.
   A part with no node at all is either bolted to one that has (the rod drives
   ride the reactor) or carries nothing at all (protection, containment). */
/* ONE COLLAPSIBLE, used by the rail's groups and by the LOG/REPAIR/FAULTS/
   PIPING stack above them. They were two <details> with two looks in
   one scroller, which read as two different kinds of thing; they are the same
   kind of thing. EVERY ONE STARTS SHUT: the rail is then a list of the plant's
   sides, one line each, and picking a machine on the drawing opens the group it
   is in (crRailSync()) - so the way in is the plant, not the scroller. */
function crCollapse(label){
  const d=KIT.el("details","cr-group"); d.open=false;   // written, not assumed
  const s=KIT.el("summary");
  const n=KIT.el("span","cr-group-name"); n.textContent=label;
  /* WHAT IS RED UNDER A SHUT LID. A group that hides its panels hides its bad
     news with them, so the summary carries it: crRailAlert() fills this. Held
     as its own span so the NAME is written once and never rewritten. */
  const a=KIT.el("span","cr-group-alert");
  s.append(n,a); d.appendChild(s); d._alert=a;
  return d;
}
function crRailGroup(p){
  const li=loopOf(p.id); if(li!=null) return "loop"+li;
  const G=nodeGraph(), ns=G.nodesOf[p.id]||[];
  if(!ns.length) return p.pin&&p.pin.to ? crRailGroup(partOf(p.pin.to)||p) : "support";
  return "circ"+G.circuit[ns[0]];
}
/* MACHINES THAT SHARE A SIDE STAND TOGETHER, in the order the coolant meets
   them: the primary that every loop shares, then the loops, then the secondary,
   then what belongs to no circuit at all. Grouping is the BUILD's business
   alone - a well is the same well wherever it stands, so no sync path knows. */
function crRailBuild(rail,watch){
  rail.innerHTML="";
  const panels=[], byGroup=new Map();
  for(const p of LAY.parts){
    const k=crRailGroup(p);
    if(!byGroup.has(k)) byGroup.set(k,[]);
    byGroup.get(k).push(p);
  }
  const loops=Array.from(byGroup.keys()).filter(k=>k.startsWith("loop"))
    .sort((a,b)=>+a.slice(4) - +b.slice(4));
  /* CIRCUITS ARE INDEXED, so the rail lists them in index order rather than in
     a two-name bucket. The core's own circuit leads, because that is where the
     heat comes from; support is last, because it carries none. */
  const G0=nodeGraph();
  const circs=Array.from(byGroup.keys()).filter(k=>k.startsWith("circ"))
    .sort((a,b)=>{ const x=+a.slice(4), y=+b.slice(4);
      return (x===G0.coreCirc?-1:0)-(y===G0.coreCirc?-1:0) || x-y; });
  const order=circs.slice(0,1).concat(loops, circs.slice(1), ["support"]).filter(k=>byGroup.has(k));
  /* a loop is a PRIMARY loop - it is seeded off a generator and walked over
     primary nodes only - and on a one-loop plant its number says nothing.
     SUPPORT is the last group: what is left carries no coolant at all. The
     control room, the containment, the backup set and the shielding do not
     move heat, they hold the reactor up, so the heading names the JOB rather
     than the building it happens to be in. */
  const label=k=>k==="support"?"SUPPORT"
    :k.startsWith("circ")?circName(+k.slice(4))
    :loops.length>1?"PRIMARY LOOP "+(+k.slice(4)+1):"PRIMARY LOOP";
  /* A GROUP IS A crCollapse() - shut, like every other one. A shut group leaves
     its panels in the DOM but out of view, which the rail already handles:
     railSeen() reads the observer and the sync skips what nobody can see. One
     group and nothing to tell it apart from needs no box at all. */
  for(const k of order){
    const parts=byGroup.get(k), one=order.length===1;
    let head=null, box=rail;
    if(!one){ head=crCollapse(label(k)); rail.appendChild(head); box=head; }
    for(const p of parts){
      const well=KIT.well({title:partName(p)});
      railPick(well,[p.id],partName(p));
      const body=KIT.el("div","cr-panel-body"); well.body.appendChild(body);
      box.appendChild(well.el);
      watch.add(well.el);
      panels.push({p,well,body,head,on:null,empty:null,base:null});
    }
  }
  /* THE RAIL OPENS NOTHING ON ARRIVAL. crRailSync() opens the group of a
     machine the selection MOVES to, and on the first sync after a rebuild every
     selection looks like a move - so entering the control room sprang open
     whichever group the standing selection sat in. Adopting it here makes the
     first frame a no-move; a real pick after that still opens its group. */
  crLastSel=sel;
  // a rebuild is a NEW PLANT (the rail is rebuilt when P moves), and a caution
  // raised by the last one is about machines that may not even be fitted here
  CAUT.clear();
  crHeadsDone=false;
  return panels;
}
/* A HEADING WITH NOTHING UNDER IT IS A LIE. Whether a panel has anything to
   report is settled on the first sync (h.empty), not here, so the headings are
   judged once, on the frame the last of them resolves. */
let crHeadsDone=false;
function crRailHeads(panels){
  if(crHeadsDone || panels.some(h=>h.empty===null)) return;
  crHeadsDone=true;
  const live=new Set();
  for(const h of panels) if(h.head && !h.empty) live.add(h.head);
  for(const h of panels) if(h.head) KIT.show(h.head,live.has(h.head));
}
/* ══ THE MASTER CAUTION STORE ══
   ONE MAP, two readers: the group headings say what is wrong RIGHT NOW under a
   shut lid, and the master caution panel keeps a copy until the crew clicks it
   away. Both ask the same question of the same rows, so a heading and the panel
   can never disagree about what the plant is doing.

   A READING HAS TO MEAN IT. A row that flicks amber for a frame while a pump
   spins up is not a caution, so nothing is raised until the reading has been
   off-nominal for CAUT_TICKS simulation steps without a break - the count is
   the tick it started on, and it goes back to nothing the moment the value
   comes back inside its limit. Ticks, not frames: the plant runs at 1x, 4x and
   16x and a caution must mean the same thing at all three.

   LATCHED IS NOT LIVE. `live` is "off-nominal this tick" and drives the group
   heading; `latch` is "it has been raised" and drives the panel, which holds it
   even after the plant recovers - a caution nobody saw is a caution nobody
   answered. Dismissing deletes the entry outright, so the same reading going
   bad again later is a NEW caution rather than a resurrected one. */
const CAUT_TICKS=10;
const CAUT=new Map();                 // partId|label -> {name,label,text,col,since,live,latch,tip}
const cautCol=c=>c===C.red?"red":c===C.amber?"amber":null;
/* One row, one tick. Returns the entry while it is raised, and null while it is
   nominal or still counting - so a caller can print it without asking twice. */
/* THE COPY IS THE ROW, not a sentence about it - same six fields the rail
   panel is built from (readoutsFor()), so the caution carries the value, the
   colour and the band exactly as the machine's own panel draws them. Only the
   LABEL differs: it is given the machine's name, because out of its panel a
   bare "STEAM OUT" belongs to nothing. */
const cautRow=(r,text)=>[text,r[1],r[2],r[3],r[4],r[5]];
function cautStep(id,r,name,base){
  const key=id+"|"+r[0], col=cautCol(r[2]), e=CAUT.get(key);
  const text=name+": "+r[0];
  /* A BYPASS IS NOT A CAUTION. autoState() reads BYPASSED and every row that
     prints it is amber, which is right on the machine's own panel - it is a
     protection you have stood down and the panel should say so for as long as
     it is stood down. It is not news, though: the crew did it on purpose, it
     will not clear itself, and a caution list it can never leave is a list that
     stops being read. The VALUE is the test, so a new bypassable system needs
     nothing here. */
  const byp = r[1]==="bypassed";
  // the baseline is this plant's own resting colours - see the caller
  if(!col || byp || base.has(r[0])){
    /* A LATCHED CAUTION KEEPS UPDATING. The reading has recovered, so the row
       is no longer red - and showing it frozen at its worst would be a lie
       about the plant right now. It goes dim instead, and reads live. */
    if(e){ e.live=false; e.since=-1; e.col=null; if(e.latch) e.row=cautRow(r,text); else CAUT.delete(key); }
    return null;
  }
  const t=S.tick;
  if(!e){ CAUT.set(key,{id,name,label:r[0],text,col,since:t,live:false,latch:false,row:cautRow(r,text)}); return null; }
  if(e.since<0 || e.since>t) e.since=t;      // fresh, or a snapshot scrubbed us backwards
  e.col=col; e.name=name; e.text=text; e.row=cautRow(r,text);
  if(t-e.since>CAUT_TICKS){ e.latch=true; e.live=true; return e; }
  return null;
}
/* ══ THE MASTER CAUTION PANEL ══
   Every caution the plant has raised this run, still there after the reading
   itself recovered, until somebody clicks it away. That is the whole point of a
   master caution and the reason it is not the annunciator stack: the stack says
   what is wrong NOW and goes dark on its own, this says what has HAPPENED and
   waits to be answered.

   It stands UNDER the two balances rather than over them, so a caution arriving
   never moves a picture somebody is reading. */
function crCautBuild(container){
  const wrap=KIT.el("div","cr-caut");
  const head=KIT.el("div","cr-caut-head");
  const h1=KIT.el("span","cr-caut-title"); h1.textContent="MASTER CAUTION";
  /* CLEARS THE ANSWERED ONES, and only those - a caution whose reading is still
     off-nominal is not the crew's to sweep away. It keeps its place in the head
     whether or not it is offered (visibility, not display), because a button
     that shoves the count sideways as the plant recovers is a button nobody can
     aim at. */
  const clr=KIT.button("CLEAR",{size:7,flat:true,tip:"Removes every caution whose reading has come back inside its limit. Anything still off-nominal stays.",
    onClick:()=>{ for(const [k,e] of CAUT) if(e.latch&&!e.live) CAUT.delete(k); }});
  clr.el.classList.add("cr-caut-clear");
  const h2=KIT.el("span","cr-caut-count"); head.append(h1,clr.el,h2);
  const body=KIT.el("div","cr-caut-body");
  wrap.append(head,body); container.appendChild(wrap);
  KIT.tip(wrap,"MASTER CAUTION",
    "Every reading that has gone amber or red for longer than a moment, copied here whole - value, colour and limits - and named by the machine it belongs to. A line stays after the reading recovers; click it to answer it and clear it away.");
  /* ONE listener on the body, not one per row: fieldRowsSync() owns these
     elements and rebuilds them whenever the list changes, so a handler bound to
     a row would be thrown away with it. The keys are held in build order. */
  const h={wrap,head,body,count:h2,clr:clr.el,offer:null,keys:[],state:null};
  body.addEventListener("click",e=>{
    const el=e.target.closest && e.target.closest(".insp-row"); if(!el) return;
    const k=h.keys[Array.prototype.indexOf.call(body.children,el)], c=k&&CAUT.get(k);
    if(!c) return;
    /* A LIVE CAUTION IS NOT DISMISSIBLE, so its click does the other useful
       thing: it takes you to the machine. The rail lights that panel, opens the
       group it is in and scrolls to it - the same as clicking it on the plant,
       which is what a caution list is for. Answered ones clear, as before. */
    if(c.live) sel=c.id; else CAUT.delete(k);
  });
  return h;
}
function crCautSync(h){
  const keys=[], rows=[], on=[];
  for(const [k,e] of CAUT) if(e.latch){ keys.push(k); rows.push(e.row); on.push(e.live); }
  h.keys=keys;
  KIT.show(h.wrap,rows.length>0);
  const n=String(rows.length);
  if(h.count.textContent!==n) h.count.textContent=n;
  const offer=on.some(v=>!v);
  if(h.offer!==offer){ h.clr.classList.toggle("off",!offer); h.offer=offer; }
  if(!rows.length){ h.body.innerHTML=""; h.body._h=null; return; }
  /* THE WASH IS NOT THIS PANEL'S BUSINESS. fieldRowsSync() paints a row off its
     own colour, so a caution and the rail panel it was copied from are washed by
     one rule off one fact - and it TRACKS: red that eases to amber washes amber,
     and a reading back inside its limit washes nothing. No wash IS answered, so
     a recovered caution needs no styling of its own; it stays on the list, fully
     legible, waiting to be cleared. */
  fieldRowsSync(h.body,rows);
}
/* ══ A SHUT GROUP STILL REPORTS ══
   The heading carries what is red underneath it, so collapsing a group hides
   the detail and never the trouble. Each reads MACHINE: READING, because four
   generators all reading SG LEVEL is four different machines in trouble and a
   bare label could not say which. One or two of them print; past that they stop
   fitting on a heading's single line and the COUNT is the honest thing. */
function crRailAlert(panels,red){
  const seen=new Set();
  for(const h of panels){
    const d=h.head; if(!d || seen.has(d)) continue; seen.add(d);
    const list=red.get(d)||[];
    const labs=Array.from(new Set(list.map(e=>e.text)));
    const txt = !labs.length ? "" : labs.length>2 ? labs.length+" CAUTIONS" : labs.join(", ");
    if(d._alert.textContent!==txt) d._alert.textContent=txt;
    // one red anywhere under the lid makes the heading red: the worse colour
    // wins, or a burst shell would read as amber behind a lagging valve
    const st = !labs.length ? "" : list.some(e=>e.col==="red") ? "alarm" : "caution";
    if(d._st!==st){
      d.classList.toggle("alarm",st==="alarm");
      d.classList.toggle("caution",st==="caution"); d._st=st;
    }
  }
}
/* see dbRailSync() - reveal on the frame sel changes, never every frame */
let crLastSel=null;
function crRailSync(panels){
  // a pick made IN the rail already has the panel under the pointer, so the
  // scroll it used to trigger threw the thing just clicked off the screen
  const moved = sel!==crLastSel && !railSelfPick(); crLastSel=sel;
  const red=new Map();                      // head -> the labels reading red
  for(const h of panels){
    /* whether a panel has anything to report is a question about the DESIGN -
       readoutsFor() answers [] on fitted(p), p.grp and P, all frozen for the
       run - so it is asked once per rail and the rail is rebuilt when P moves.
       Asking it every frame meant building the table just to throw it away. */
    if(h.empty) continue;
    const on = h.p.id===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    const first = h.empty===null;
    /* THE TABLE IS BUILT EVEN FOR A PANEL NOBODY CAN SEE, because a shut group
       has to be able to say what is wrong inside it. Only the DOM work below is
       still gated on being on screen - that is where the cost was. */
    const rows = readoutsFor(h.p,S);
    if(first){ h.empty=!rows.length; KIT.show(h.well.el,rows.length>0); }
    if(!rows.length) continue;
    /* RED IS NOT ALWAYS TROUBLE, so the baseline is MEASURED. Some rows are red
       on a perfectly healthy plant: TOTAL MADE is red because the heat balance
       paints fuel red, and SHUTDOWN MARGIN is red at rest on most designs
       because it is usually negative - that is what boron is for. Whatever is
       red on the first frame after commissioning is this plant's normal, and
       only a row that goes red AFTER that is an alarm. The rail is rebuilt when
       P moves, so the baseline is always taken at a rest point. */
    if(first) h.base=new Set(rows.filter(r=>Array.isArray(r)&&cautCol(r[2])).map(r=>r[0]));
    {
      const nm=partName(h.p);
      let hit=null;
      for(const r of rows){
        if(!Array.isArray(r)) continue;
        const e=cautStep(h.p.id, r, nm, h.base);
        if(e && e.live && h.head) (hit||(hit=[])).push(e);
      }
      if(hit && h.head){ const a=red.get(h.head); if(a) a.push.apply(a,hit); else red.set(h.head,hit); }
    }
    if(!railSeen(h.well.el) && !(on&&moved)) continue;
    // a rename does not touch P, so this rail's build trigger (Pfit) never
    // fires for it - re-read the name every sync, guarded no-ops either way
    { const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm); }
    // a machine picked on the DRAWING may sit in a group somebody shut: open
    // it, or the click lands on nothing and the plant looks unresponsive
    if(on && moved){ if(h.head) h.head.open=true; KIT.reveal(h.well.el,"start"); }
    fieldRowsSync(h.body,rows);
    /* the damage map is genuinely graphical and keeps its own canvas, the way
       the lattice plan does on the bench - see hostPaint() and dmgViz().
       fieldRowsBuild() hands the canvas back on the container, so this never
       searches the screen for it. */
    const v=h.body._viz;
    if(v&&v.dmg) hostPaint(v.dmg,dmgViz);
  }
  crRailAlert(panels,red);
}

let CR=null;
function crBuild(){
  const mount=document.getElementById("scr-operate");
  if(!mount) return null;
  const root=KIT.el("div","cr-root");
  const vitals=KIT.el("div","cr-vitals"); root.appendChild(vitals);
  /* THE SIX BAR ROWS ARE OFF THE PANEL, AND THE TRENDS GO WITH THEM: a row
     click was the only thing that ever put a channel on the chart, so charts
     with no way to pick them are a picture nobody can steer.
     crVitalsBuild()/crVitalsSync() and crTrendSync() stand ready for whichever
     of them comes back. */
  const vitalRows=null, trendBox=null;
  /* THE TWO BALANCES ARE VITALS, NOT COMPONENT READOUTS. They are the whole
     plant's account of itself, so they belong in this panel rather than behind
     a click on the reactor. Same canvas arrangement a rail widget uses - the
     panel is opaque, so each draws into its own <canvas> (hostPaint()). */
  const viz={};
  for(const b of CR_VIZ){
    const c=KIT.el("canvas","insp-viz insp-viz-"+b.k+" cr-viz");
    KIT.tip(c,b.title,b.tip); vitals.appendChild(c); viz[b.k]=c;
  }
  const caut=crCautBuild(vitals);

  const alarmsWrap=KIT.el("div","cr-alarms");
  const alarmsHead=KIT.el("div","cr-alarms-head");
  const ah1=KIT.el("span"); ah1.textContent="ALARMS";
  const ah2=KIT.el("span","cr-alarms-count");
  alarmsHead.append(ah1,ah2); alarmsWrap.appendChild(alarmsHead);
  const alarmsBody=KIT.el("div","cr-alarms-body"); alarmsWrap.appendChild(alarmsBody);
  const alarms={wrap:alarmsWrap,body:alarmsBody,count:ah2,rows:crAlarmsBuild(alarmsBody),lit:-1};
  KIT.tip(alarmsWrap,"ALARM STACK","Every annunciator that is currently lit, and nothing that is not. The full board, including what is dark, is on the HELP screen.");
  root.appendChild(alarmsWrap);

  const banner=KIT.el("div","cr-banner"); root.appendChild(banner);

  const rail=KIT.el("div","cr-rail"); root.appendChild(rail);
  railBlank(rail);

  /* THE MACHINES COME FIRST. The ops drawers are filled here, in the order they
     read best, but the rail is not given them until the component groups are
     in: what the rail is FOR is the plant, and the log, the repair list and the
     layer switches are what you go and get. */
  const ops=KIT.el("div","cr-ops");

  const logD=crCollapse("LOG");
  const logList=KIT.el("div","cr-log"); logD.appendChild(logList); ops.appendChild(logD);

  const dmgD=crCollapse("REPAIR");
  const dmgList=KIT.el("div","cr-dmg"); dmgD.appendChild(dmgList); ops.appendChild(dmgD);

  const fltD=crCollapse("FAULTS");
  const fltBody=KIT.el("div","cr-flt"); fltD.appendChild(fltBody); ops.appendChild(fltD);
  const faults=crFaultsBuild(fltBody);

  const compRail=KIT.el("div","cr-comp-rail"); rail.appendChild(compRail);

  /* EVERY CONNECTION THE PLANT WAS COMMISSIONED WITH, and whether it is still
     carrying anything. Off P.net.byKey - the FROZEN commissioning snapshot, not
     a live re-trace - so this lists the plant that is running rather than the
     drawing on the bench. It closes the component half - the runs BETWEEN the
     machines listed above it - so it stands under them and over the drawers. */
  const cnxD=crCollapse("PIPING");
  const cnxBody=KIT.el("div","cr-cnx"); cnxD.appendChild(cnxBody); rail.appendChild(cnxD);

  rail.appendChild(ops);

  mount.appendChild(root);
  return {root,vitals,vitalRows,viz,alarms,banner,rail,
    trend:{box:trendBox,cvs:{}},logList,dmgList,faults,cnx:cnxBody,caut,compRail,panels:null,Pfit:null,
    watch:null,bMelt:null,bBreach:null,bTrip:null};
}
/* ONE ROW PER COMMISSIONED CONNECTION: what it joins, what it is carrying, and
   whether a hit anywhere along it has cut it. BROKEN is asked of the CELLS, so
   the panel and the solve can never disagree about what broken means -
   pipeExtraLen() (pipenet.js) reads exactly the same list. */
function crCnxSync(body){
  if(!P||!P.net||!S) return;
  const keys=Object.keys(P.net.byKey);
  /* STATUS ONLY. A run's length is a DESIGN number - it prices the run and it
     is what the bench is for. In the control room the only question a piping
     list can answer is whether the run is still carrying, so the metres are
     not shown and r.L is not read. */
  const rows=keys.map(k=>{ const r=P.net.byKey[k];
    return {k, name:pipeName(r), cut:pipeExtraLen(S,r.cells)===Infinity};
  });
  /* AND EVERY NOZZLE'S OWN VALVE, under the same heading. A port valve is
     piping, not a component: it is what cuts a run out, so it belongs beside
     the list of runs and nowhere else. Every port is listed, open ones
     included - the question the list answers is "what is lined up", and a
     list of only the shut ones cannot be read as an answer to that. */
  const PS=S.portShut||{};
  const ports=Object.keys(PS).map(pid=>({pid, name:portLabel(pid), shut:!!PS[pid]}))
    .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const sig=rows.map(r=>r.k+(r.cut?"!":"")).join("|")
    +"//"+ports.map(p=>p.pid+(p.shut?"!":"")).join("|");
  if(body._sig===sig) return;
  body._sig=sig; body.innerHTML="";
  for(const r of rows){
    const row=KIT.el("div","cr-cnx-row"+(r.cut?" cut":""));
    const n=KIT.el("span","cr-cnx-name"); n.textContent=r.name;
    const s=KIT.el("span","cr-cnx-state"); s.textContent=r.cut?"SEVERED":"intact";
    row.append(n,s); body.appendChild(row);
  }
  if(!ports.length) return;
  const head=KIT.el("div","cr-cnx-sub"); head.textContent="PORT VALVES";
  body.appendChild(head);
  for(const pv of ports){
    const row=KIT.el("div","cr-cnx-row"+(pv.shut?" shut":""));
    const n=KIT.el("span","cr-cnx-name"); n.textContent=pv.name;
    const s=KIT.el("span","cr-cnx-state"); s.textContent=pv.shut?"SHUT":"open";
    row.append(n,s); body.appendChild(row);
  }
}
function crSync(){
  if(!CR) return;
  if(CR.vitalRows) crVitalsSync(CR.vitalRows);
  for(const b of CR_VIZ) hostPaint(CR.viz[b.k],b.draw);
  crAlarmsSync(CR.alarms);
  if(CR.trend.box) crTrendSync(CR.trend);
  crLogSync(CR.logList);
  crDamageSync(CR.dmgList);
  crFaultsSync(CR.faults);
  crCnxSync(CR.cnx);
  if(CR.Pfit!==P){
    if(CR.watch) CR.watch.free();
    CR.watch=railWatch(CR.rail);
    CR.panels=crRailBuild(CR.compRail,CR.watch); CR.Pfit=P;
  }
  if(CR.panels){ crRailSync(CR.panels); crRailHeads(CR.panels); }
  crCautSync(CR.caut);

  /* the banner is a view of three fields, so it is written when one of them
     moves and not otherwise - the trip line alone built a string every frame.
     Nothing to clear on a scrub: it compares against the live S each frame, so
     a restored snapshot writes it on the next one. */
  const s=S;
  if(s.melt!==CR.bMelt||s.breach!==CR.bBreach||s.trip!==CR.bTrip){
    CR.bMelt=s.melt; CR.bBreach=s.breach; CR.bTrip=s.trip;
    if(s.melt||s.breach){
      CR.banner.className="cr-banner melt"; KIT.show(CR.banner,true);
      CR.banner.textContent=s.melt?"CORE MELT - UNRECOVERABLE":"VESSEL RUPTURE - UNRECOVERABLE";
    } else if(s.trip){
      CR.banner.className="cr-banner trip"; KIT.show(CR.banner,true);
      CR.banner.textContent="LAST TRIP / "+s.trip;
    } else KIT.show(CR.banner,false);
  }
}
if(typeof document!=="undefined" && document.documentElement) CR=crBuild();

function drawOperate(){
  crSync();
  /* MEASURED, not reserved. The strip is a fixed CSS height floating over the
     canvas while the plant view is in layout units, so any constant band is
     right at exactly one window width and leaves a growing gap at every other -
     which is what put a strip of dead canvas above the plant. Same measurement
     the design bench already makes off its head row.
     The box runs to the edges from there: the rail is opaque and the strip is
     opaque, so there is nothing for a margin to protect the plant from. */
  const stripBox = trStrip("operate") ? hostRect(trStrip("operate").root) : null;
  const railBox=CR? hostRect(CR.rail) : null;
  const vy = stripBox ? stripBox.y+stripBox.h : TOPBAR_H;
  const vh=Math.max(120,H-vy);
  /* THE VITALS PANEL IS OPAQUE, SO THE PLANT MAY NOT BE DRAWN UNDER IT. It was
     measured on the right (the component rail) and not on the left, which was
     survivable only while nothing tall stood in the top-left corner - the rod
     drives are twelve cells tall now, so the whole rod strip sat behind the
     panel, invisible AND unclickable. Measured, never reserved, the same rule
     the strip above already follows. */
  const vitBox = CR? hostRect(CR.vitals) : null;
  const vx = vitBox ? vitBox.x+vitBox.w : 0;
  const vw = (railBox ? Math.max(200, railBox.x) : W) - vx;
  drawPlant(vy,S,vh,vx,vw);
  zoomKeySync(CR&&CR.root);
  { const h=CR&&CR.panels&&CR.panels.find(o=>(o.fid||o.p.id)===sel);
    if(h) leaderLine(h.well.el,CR.rail); }
}
