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
    u:s.n/nTrip, col:(s.n>1.1||s.dnbr<1.3)?"var(--c-red)":"var(--c-green)",
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
  const hit=scram("COMBAT HIT",{onClick:()=>act("hit")});
  KIT.tip(hit.el,"COMBAT HIT","Takes a hit somewhere in the engineering space, weighted toward the hull.");
  const black=scram("STATION BLACKOUT",{onClick:()=>act("blackout")});
  KIT.tip(black.el,"STATION BLACKOUT","Cuts main power to the coolant pumps.");
  /* Opens EVERY tank that could poison the loop, off what is in them. It is a
     shortcut for the tanks' own valves and nothing more - there is no one-shot
     latch behind it any more, because a tank that is empty is empty. */
  const boron=scram("EMERGENCY BORON",{danger:true,
    onClick:()=>{ for(const id of boronTankIds()) if(!S.tankOpen[id]) act("tankOpen",id); }});
  container.append(porv.el,jam.el,load.el,reset.el,hit.el,black.el,boron.el);
  return {porv,jam,load,reset,hit,black,boron};
}
function crFaultsSync(h){
  if(!P) return;
  h.porv.set({on:reliefAnyStuck(S)});
  h.jam.set({on:S.rodJam});
  h.load.set({label:"LOAD STEP "+(P.loadMax*100).toFixed(0)+"%"});
  h.black.set({on:S.blackout});
  const bt=boronTankIds(), spent=bt.length>0 && bt.every(id=>S.tank[id]<=0);
  KIT.show(h.boron.el,bt.length>0);
  h.boron.set({label:spent?"BORON EXPENDED":"EMERGENCY BORON",disabled:spent});
}

/* ══ THE COMPONENT RAIL: EVERY FITTED COMPONENT'S readoutsFor() TABLE ══ */
function crRailBuild(rail,watch){
  rail.innerHTML="";
  const panels=[];
  for(const p of LAY.parts){
    const well=KIT.well({title:partName(p)});
    railPick(well,[p.id],partName(p));
    const body=KIT.el("div","cr-panel-body"); well.body.appendChild(body);
    rail.appendChild(well.el);
    watch.add(well.el);
    panels.push({p,well,body,on:null,empty:null});
  }
  return panels;
}
/* see dbRailSync() - reveal on the frame sel changes, never every frame */
let crLastSel=null;
function crRailSync(panels){
  const moved = sel!==crLastSel; crLastSel=sel;
  for(const h of panels){
    /* whether a panel has anything to report is a question about the DESIGN -
       readoutsFor() answers [] on fitted(p), p.grp and P, all frozen for the
       run - so it is asked once per rail and the rail is rebuilt when P moves.
       Asking it every frame meant building the table just to throw it away. */
    if(h.empty) continue;
    const on = h.p.id===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    const first = h.empty===null;
    if(!first && !railSeen(h.well.el) && !(on&&moved)) continue;
    // a rename does not touch P, so this rail's build trigger (Pfit) never
    // fires for it - re-read the name every sync, guarded no-ops either way
    { const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm); }
    const rows = readoutsFor(h.p,S);
    if(first){ h.empty=!rows.length; KIT.show(h.well.el,rows.length>0); }
    if(!rows.length) continue;
    if(on && moved) KIT.reveal(h.well.el,"start");
    fieldRowsSync(h.body,rows);
    /* the reactivity balance is genuinely graphical and keeps its own canvas,
       the way the lattice plan does on the bench - see hostPaint() and
       rhoViz(). fieldRowsBuild() hands the canvas back on the container, so
       this never searches the screen for it. */
    const v=h.body._viz; if(v&&v.rho) hostPaint(v.rho,rhoViz);
  }
}

let CR=null;
function crBuild(){
  const mount=document.getElementById("scr-operate");
  if(!mount) return null;
  const root=KIT.el("div","cr-root");
  const vitals=KIT.el("div","cr-vitals"); root.appendChild(vitals);
  const vitalRows=crVitalsBuild(vitals);
  const trendBox=KIT.el("div","cr-trends");   // one canvas per plotted channel
  vitals.appendChild(trendBox);

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

  const ops=KIT.el("div","cr-ops"); rail.appendChild(ops);

  const logD=KIT.el("details","cr-op"); const logS=KIT.el("summary"); logS.textContent="LOG";
  const logList=KIT.el("div","cr-log"); logD.append(logS,logList); ops.appendChild(logD);

  const dmgD=KIT.el("details","cr-op"); const dmgS=KIT.el("summary"); dmgS.textContent="REPAIR";
  const dmgList=KIT.el("div","cr-dmg"); dmgD.append(dmgS,dmgList); ops.appendChild(dmgD);

  const fltD=KIT.el("details","cr-op"); const fltS=KIT.el("summary"); fltS.textContent="FAULTS";
  const fltBody=KIT.el("div","cr-flt"); fltD.append(fltS,fltBody); ops.appendChild(fltD);
  const faults=crFaultsBuild(fltBody);

  // one switch per LAYERS entry, built once - see layerSwitches() in
  // render/layers.js. A layer manages its own "on" state on click, so there
  // is nothing here for crSync() to keep in step with every frame.
  /* EVERY CONNECTION THE PLANT WAS COMMISSIONED WITH, and whether it is still
     carrying anything. Off P.net.byKey - the FROZEN commissioning snapshot, not
     a live re-trace - so this lists the plant that is running rather than the
     drawing on the bench. */
  const cnxD=KIT.el("details","cr-op"); const cnxS=KIT.el("summary"); cnxS.textContent="PIPING";
  const cnxBody=KIT.el("div","cr-cnx"); cnxD.append(cnxS,cnxBody); ops.appendChild(cnxD);

  const lyrD=KIT.el("details","cr-op"); const lyrS=KIT.el("summary"); lyrS.textContent="LAYERS";
  const lyrBody=KIT.el("div","cr-lyr"); lyrD.append(lyrS,lyrBody); ops.appendChild(lyrD);
  layerSwitches(lyrBody);

  const compRail=KIT.el("div","cr-comp-rail"); rail.appendChild(compRail);

  mount.appendChild(root);
  return {root,vitals,vitalRows,alarms,banner,rail,
    trend:{box:trendBox,cvs:{}},logList,dmgList,faults,cnx:cnxBody,compRail,panels:null,Pfit:null,
    watch:null,bMelt:null,bBreach:null,bTrip:null};
}
/* ONE ROW PER COMMISSIONED CONNECTION: what it joins, what it is carrying, and
   whether a hit anywhere along it has cut it. BROKEN is asked of the CELLS, so
   the panel and the solve can never disagree about what broken means -
   pipeExtraLen() (pipenet.js) reads exactly the same list. */
function crCnxSync(body){
  if(!P||!P.net||!S) return;
  const keys=Object.keys(P.net.byKey);
  const rows=keys.map(k=>{ const r=P.net.byKey[k];
    return {k, name:pipeName(r), len:r.L, cut:pipeExtraLen(S,r.cells)===Infinity};
  });
  const sig=rows.map(r=>r.k+(r.cut?"!":"")).join("|");
  if(body._sig===sig) return;
  body._sig=sig; body.innerHTML="";
  for(const r of rows){
    const row=KIT.el("div","cr-cnx-row"+(r.cut?" cut":""));
    const n=KIT.el("span","cr-cnx-name"); n.textContent=r.name;
    const s=KIT.el("span","cr-cnx-state"); s.textContent=r.cut?"SEVERED":r.len.toFixed(1)+" m";
    row.append(n,s); body.appendChild(row);
  }
}
function crSync(){
  if(!CR) return;
  crVitalsSync(CR.vitalRows);
  crAlarmsSync(CR.alarms);
  crTrendSync(CR.trend);
  crLogSync(CR.logList);
  crDamageSync(CR.dmgList);
  crFaultsSync(CR.faults);
  crCnxSync(CR.cnx);
  if(CR.Pfit!==P){
    if(CR.watch) CR.watch.free();
    CR.watch=railWatch(CR.rail);
    CR.panels=crRailBuild(CR.compRail,CR.watch); CR.Pfit=P;
  }
  if(CR.panels) crRailSync(CR.panels);

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
