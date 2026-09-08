"use strict";

/* `v.u` is in LIMIT UNITS: 1.0 is at the line, which LIM_AT places on the track */
function crVitalsData(){
  const s=S, sc=s.sc;
  const nTrip=rpsSetOf("flux",0)/100, dTrip=rpsSetOf("dnbr",0),
        pLo=rpsSetOf("plp",0), pHi=rpsSetOf("php",0);
  const toward=(now,rest,lim)=> rest===lim ? 0 : (rest-now)/(rest-lim);
  return [
   {lab:"REACTOR POWER",val:(s.n*P.rated).toFixed(0),unit:"MWt",ch:"pwr",
    u:s.n/nTrip, col:s.n>1.1?"var(--c-red)":s.n>1.05?"var(--c-amber)":"var(--c-green)",
    tip:"Heat the chain reaction is making, out of the "+P.rated.toFixed(0)+" MWt this core is rated for - "+(s.n*100).toFixed(1)+"% of rating. The bar fills toward the high-flux trip at "+(nTrip*P.rated).toFixed(0)+" MWt; past that mark you are running on a bypassed protection system."},
   {lab:"DNBR",val:s.dnbr.toFixed(2),unit:"",ch:"dnbr",
    u:toward(s.dnbr,P.dnbr0,dTrip), col:s.dnbr<1?"var(--c-red)":s.dnbr<1.3?"var(--c-amber)":"var(--c-cyan)",
    tip:"Departure from Nucleate Boiling Ratio. The bar is the thermal margin you were commissioned with being spent: empty is the "+P.dnbr0.toFixed(2)+" you were built with, the mark is the trip at "+dTrip.toFixed(2)+"."},
   {lab:"PRESSURE",val:s.P.toFixed(2),unit:"MPa",ch:"prs",sgn:1,
    u:s.P>=P.P0 ? (s.P-P.P0)/(pHi-P.P0) : (s.P-P.P0)/(P.P0-pLo),
    col:cssCol(pColor(s.P)),
    tip:"Primary loop pressure. The one vital where both directions are a trip - centred on "+P.P0.toFixed(2)+" MPa, marked at "+pLo.toFixed(2)+" low and "+pHi.toFixed(2)+" high."},
   {lab:"SUBCOOLING",val:sc.toFixed(1),unit:"K",ch:"sub",
    u:toward(sc,P.sc0,3),
    col:sc<8?"var(--c-red)":sc<Math.max(10,P.sc0*.6)?"var(--c-amber)":"var(--c-cyan)",
    tip:"Degrees below boiling in the hot leg - the honest leak indicator. Commissioned "+P.sc0.toFixed(0)+" K subcooled, marked at the 3 K trip."},
   {lab:"INVENTORY",val:(invNodesKg(s)/1000).toFixed(1),unit:"t",ch:"inv",
    u:(100-s.inv)/30, col:s.inv<95?"var(--c-red)":s.inv<98.5?"var(--c-amber)":"var(--c-blue)",
    tip:"How much water is actually in the loop, in tonnes. Commissioned with "+(P.invKg0/1000).toFixed(1)+" t, so this is "+s.inv.toFixed(1)+"% of the charge. Nothing trips on it, but under 95% the missing water starts taking heat removal with it."},
   {lab:"XENON",val:s.parts.xe.toFixed(0),unit:"pcm",ch:"xe",
    u:-s.parts.xe/3200, col:-s.parts.xe>3200?"var(--c-blue)":"var(--c-cyan)",
    tip:"Xenon-135 poison. The mark is 3200 pcm, about where the pit costs you more reactivity than the rods have left to give."}];
}
const CR_VIZ=[
 {k:"rho", title:"REACTIVITY BALANCE", tip:RHOVIZ_TIP,  draw:rhoViz},
 {k:"heat",title:"HEAT BALANCE",       tip:HEATVIZ_TIP, draw:heatViz},
];
function crUnitsBuild(container){
  const root=KIT.el("div","cr-units"); container.appendChild(root);
  return {root,keys:null,sig:""};
}
function crUnitsSync(h){
  const units=crUnits();
  const sig=units.join("|")+"/"+units.map(id=>{ const p=partOf(id); return p?partName(p):id; }).join("|");
  KIT.show(h.root, units.length>0);
  if(h.sig!==sig){
    h.sig=sig; h.root.innerHTML=""; h.keys=[];
    if(units.length){
      const rows=[{id:null,lab:"PLANT"}].concat(units.map(id=>{
        const p=partOf(id); return {id,lab:p?partName(p):id}; }));
      for(const r of rows){
        const b=KIT.el("button","tab",{type:"button"}); b.textContent=r.lab;
        KIT.tip(b,r.lab, r.id
          ? "Read both balances off this reactor alone - its own reactivity terms, its own heat, and the generators standing on its loop, against its own rating."
          : "Read the heat balance across the whole plant. Reactivity has no plant-wide meaning, so it stays on the first reactor.");
        MOUSE.on(b,{click(){ CRUNIT.id=r.id; }});
        h.root.appendChild(b); h.keys.push({b,id:r.id});
      }
    }
  }
  if(h.keys) for(const k of h.keys) k.b.classList.toggle("on", CRUNIT.id===k.id);
}
function crVitalsBuild(container){
  const rows=[];
  for(let i=0;i<6;i++){
    const row=KIT.el("div","cr-vital");
    const plotDot=KIT.el("span","cr-vital-plot");
    const lab=KIT.el("span","cr-vital-lab");
    const barBox=KIT.el("span","cr-vital-bar");
    const bar=KIT.segMark({cells:24}); barBox.appendChild(bar.el);
    const val=KIT.el("span","cr-vital-val");
    row.append(plotDot,lab,barBox,val);
    container.appendChild(row);
    MOUSE.on(row,{click(){ const d=crVitalsData()[i]; if(d.ch) togglePlot(d.ch); }});
    rows.push({row,plotDot,lab,barBox,bar,val,signed:false});
  }
  return rows;
}
function crVitalsSync(rows){
  const data=crVitalsData();
  data.forEach((v,i)=>{
    const h=rows[i];
    /* an unsigned strip draws a -LIM_AT mark off the left end, over the label */
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
function crAlarmsSync(rows){
  for(const h of rows){
    const on=annLit(h.a[0]);
    h.row.classList.toggle("lit",on);
    h.row.classList.toggle("red",on&&h.a[1]==="red");
    h.row.classList.toggle("amber",on&&h.a[1]==="amber");
  }
}

const CR_TREND_PAD=8/HOST_K, CR_TREND_LEG=13;
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

/* drawTrend()/drawLog() are not for this screen: scenario.js reuses them by reference */
const TREND_TAB_H=BTN_H+6;
function trendTabs(x,y){
  const units=trendUnits();
  if(!units.length) return 0;
  const rows=[{id:null,lab:"PLANT"}].concat(units.map(id=>{
    const p=partOf(id); return {id,lab:p?partName(p):id}; }));
  let tx=x;
  for(const r of rows){
    const kw=tw(r.lab,{size:6.5,sp:1,caps:1})+14;
    button(tx,y,kw,BTN_H,r.lab,{sunk:1,on:TREND.unit===r.id,size:6.5,sp:1,
      fn:()=>{ TREND.unit=r.id; }});
    TIP(tx,y,kw,BTN_H,r.lab, r.id
      ? "Read every vessel-shaped channel off this reactor's own view of the plant. A channel that is not vessel-shaped keeps the plant's figure."
      : "Read every channel off the plant, which is what a single-unit station reads.");
    tx+=kw+4;
  }
  return TREND_TAB_H;
}
function drawTrend(yy){
  const x=12,y=yy,w=736,h=176;
  const tb=trendTabs(x,y+3);
  const ser=plot.map(k=>({lab:CH[k].lab,u:CH[k].u,col:CH[k].col,n:hlen,at:i=>chAt(k,i)}));
  const box=chart(x,y+tb,w,h,{
    title:"TREND / CLICK ANY GAUGE TO PLOT IT",
    series:ser, n:hlen,
    empty:hlen<2?"COLLECTING DATA":"NO CHANNELS SELECTED",
    xlab:["-"+(hlen/10).toFixed(0)+"s","NOW"]});
  chartLegend(box,y+tb+145,ser);
  TIP(x,y+tb,w,20,"TREND CHART","Rolling three-minute history of any plotted channel.");
  return y+tb+h+12;
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
    /* the card is reused by the next part at this slot, so never close over one */
    const h={el,name,state,dose,id:null};
    MOUSE.on(el,{click(){ if(h.id) act("repair",h.id); }});
    return h;
  });
  const f = ids.length ? radSolve(P.radK, radSrc(S)) : null;
  const g = ids.length ? occupied(null) : null;
  ids.forEach((k,i)=>{
    const h=pool[i], part=dmgPart(k);
    h.id=k;
    const nm=part?partName(part):k.toUpperCase(), blocked=!(part&&partAccess(part));
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

    /* the promise must equal what the sim charges: work advances at radWorkK(rate) */
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
  const aim=scram("AIMED COMBAT HIT",{onClick:()=>{ TOOL.active = TOOL.active==="hit"?"select":"hit"; }});
  KIT.tip(aim.el,"AIMED COMBAT HIT",TOOLS.find(t=>t.id==="hit").tip);
  const black=scram("STATION BLACKOUT",{onClick:()=>act("blackout")});
  KIT.tip(black.el,"STATION BLACKOUT","Cuts main power to the coolant pumps.");
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

function crCollapse(label){
  const d=KIT.el("details","cr-group"); d.open=false;
  const s=KIT.el("summary");
  const n=KIT.el("span","cr-group-name"); n.textContent=label;
  /* its own span so the NAME is written once: crRailAlert() fills this one */
  const a=KIT.el("span","cr-group-alert");
  s.append(n,a); d.appendChild(s); d._alert=a;
  return d;
}
function crRailBuild(rail,watch){
  rail.innerHTML="";
  const panels=[], byGroup=new Map();
  for(const p of LAY.parts){
    const k=panelGroup(p);
    if(!byGroup.has(k)) byGroup.set(k,[]);
    byGroup.get(k).push(p);
  }
  const loops=Array.from(byGroup.keys()).filter(k=>k.startsWith("loop"));
  const order=Array.from(byGroup.keys())
    .sort((a,b)=>panelGroupRank(a)-panelGroupRank(b));
  const label=k=>k==="support"?"SUPPORT"
    :k.startsWith("circ")?circName(+k.slice(4))
    :loops.length>1?"PRIMARY LOOP "+(+k.slice(4)+1):"PRIMARY LOOP";
  for(const k of order){
    const parts=byGroup.get(k), one=order.length===1;
    let head=null, box=rail;
    if(!one && !MARGIN_ONLY){ head=crCollapse(label(k)); rail.appendChild(head); box=head; }
    for(const p of parts){
      const well=KIT.well({title:partName(p)});
      railPick(well,[p.id],partName(p));
      const body=KIT.el("div","cr-panel-body"); well.body.appendChild(body);
      if(!MARGIN_ONLY) box.appendChild(well.el);
      watch.add(well.el);
      panels.push({p,well,body,head,on:null,empty:null,base:null});
    }
  }
  /* adopt the standing selection, or the first sync reads as a move and opens its group */
  crLastSel=sel;
  crHeadsDone=false;
  return panels;
}
let crHeadsDone=false;
function crRailHeads(panels){
  if(crHeadsDone || panels.some(h=>h.empty===null)) return;
  crHeadsDone=true;
  const live=new Set();
  for(const h of panels) if(h.head && !h.empty) live.add(h.head);
  for(const h of panels) if(h.head) KIT.show(h.head,live.has(h.head));
}
/* `live` = off-nominal this tick, drives the headings; `latch` = raised, drives the panel */
const CAUT_TICKS=10;
const CAUT=new Map();                 // partId|label -> {name,label,text,col,since,live,latch,tip}
const cautCol=c=>c===C.red?"red":c===C.amber?"amber":null;
const cautRow=(r,text)=>[text,r[1],r[2],r[3],r[4],r[5]];
/* `r` null = no row left to copy, so the frozen one stands */
function cautCalm(key,e,r,text){
  if(e.calm==null) e.calm=performance.now();
  const held = e.latch && performance.now()-e.calm < CAUT_CALM_MS;
  e.since=-1;
  if(held) return e;
  e.live=false; e.col=null;
  if(!e.latch) CAUT.delete(key);
  else if(r) e.row=cautRow(r,text);
  return null;
}
/* a row nobody stepped is not a row still reading bad, so it is cooled here */
function cautSweep(seen){
  for(const [k,e] of CAUT) if(!seen.has(k)) cautCalm(k,e,null,null);
}
let cautGen=-1;
function cautRun(){ if(cautGen!==plantGen){ cautGen=plantGen; CAUT.clear(); } }
function cautStep(id,r,name,base,seen){
  const key=id+"|"+r[0], col=cautCol(r[2]), e=CAUT.get(key);
  if(seen) seen.add(key);
  const text=name+": "+r[0];
  /* a bypass is deliberate and a centre-zero bar's colour is a key, not a verdict */
  const byp = r[1]==="bypassed";
  const bal = !!r[5], mov = MOVING.has(r[0]);
  if(!col || byp || bal || mov || base.has(r[0])){
    return e ? cautCalm(key,e,r,text) : null;
  }
  const t=S.tick;
  if(!e){ CAUT.set(key,{id,name,label:r[0],text,col,since:t,live:false,latch:false,row:cautRow(r,text)}); return null; }
  if(e.since<0 || e.since>t) e.since=t;      // fresh, or a snapshot scrubbed us backwards
  e.col=col; e.name=name; e.text=text; e.row=cautRow(r,text);
  e.calm=null;
  if(t-e.since>CAUT_TICKS){ e.latch=true; e.live=true; return e; }
  return null;
}
/* wall clock, not ticks: how long a line must sit still to be read is about the reader */
const CAUT_CALM_MS=5000;
let cautAuto=true;
function cautClear(hold){
  for(const [k,e] of CAUT){
    if(!e.latch||e.live) continue;
    if(hold && e.calm!=null && performance.now()-e.calm<CAUT_CALM_MS) continue;
    CAUT.delete(k);
  }
}
function crCautBuild(container){
  const wrap=KIT.el("div","cr-caut");
  const head=KIT.el("div","cr-caut-head");
  const h1=KIT.el("span","cr-caut-title"); h1.textContent="MASTER CAUTION";
  const clr=KIT.button("CLEAR",{size:7,flat:true,tip:"Removes every caution whose reading has come back inside its limit. Anything still off-nominal stays.",
    onClick:()=>cautClear()});
  clr.el.classList.add("cr-caut-clear");
  const auto=KIT.button("AUTO",{size:7,flat:true,on:cautAuto,tip:"Clears each caution by itself once its reading has been back inside its limit for five seconds. Anything still off-nominal stays on the list.",
    onClick:()=>{ cautAuto=!cautAuto; auto.set({on:cautAuto}); if(cautAuto) cautClear(true); }});
  auto.el.classList.add("cr-caut-auto");
  head.append(h1,clr.el,auto.el);
  const ann=KIT.el("div","cr-caut-ann");
  const body=KIT.el("div","cr-caut-body");
  wrap.append(head,ann,body); container.appendChild(wrap);
  KIT.tip(wrap,"MASTER CAUTION",
    "At the top, every annunciator that is currently lit - the full board, including what is dark, is on the HELP screen. Under it, every reading that has gone amber or red for longer than a moment, copied whole - value, colour and limits - and named by the machine it belongs to. A copied line stays after the reading recovers; click it to answer it and clear it away.");
  /* one listener on the body: fieldRowsSync() owns the rows and rebuilds them */
  const h={head,body,ann:crAlarmsBuild(ann),clr:clr.el,offer:null,keys:[],state:null};
  MOUSE.on(body,{click(e){
    const el=e.target.closest && e.target.closest(".insp-row"); if(!el) return;
    const k=h.keys[Array.prototype.indexOf.call(body.children,el)], c=k&&CAUT.get(k);
    if(!c) return;
    if(c.live) sel=c.id; else CAUT.delete(k);
  }});
  return h;
}
function crCautSync(h){
  if(cautAuto) cautClear(true);
  crAlarmsSync(h.ann);
  const keys=[], rows=[], on=[];
  for(const [k,e] of CAUT) if(e.latch){ keys.push(k); rows.push(e.row); on.push(e.live); }
  h.keys=keys;
  const offer=on.some(v=>!v);
  if(h.offer!==offer){ h.clr.classList.toggle("off",!offer); h.offer=offer; }
  if(!rows.length){ h.body.innerHTML=""; h.body._h=null; return; }
  fieldRowsSync(h.body,rows);
}
function crRailAlert(panels,red){
  const seen=new Set();
  for(const h of panels){
    const d=h.head; if(!d || seen.has(d)) continue; seen.add(d);
    const list=red.get(d)||[];
    const labs=Array.from(new Set(list.map(e=>e.text)));
    const txt = !labs.length ? "" : labs.length>2 ? labs.length+" CAUTIONS" : labs.join(", ");
    if(d._alert.textContent!==txt) d._alert.textContent=txt;
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
  // a pick made in the rail is already under the pointer; scrolling throws it off screen
  const moved = sel!==crLastSel && !railSelfPick(); crLastSel=sel;
  cautRun();
  const red=new Map();                      // head -> the labels reading red
  const seen=new Set();                     // every caution key stepped this pass
  for(const h of panels){
    if(h.empty) continue;
    const on = h.p.id===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    const first = h.empty===null;
    /* built even for a panel nobody can see: a shut group still has to report */
    const rows = readoutsFor(h.p,S);
    if(first){ h.empty=!rows.length; KIT.show(h.well.el,rows.length>0); }
    if(!rows.length) continue;
    /* some rows are red on a healthy plant, so this plant's first frame is the baseline */
    if(first) h.base=new Set(rows.filter(r=>Array.isArray(r)&&cautCol(r[2])).map(r=>r[0]));
    {
      const nm=partName(h.p);
      let hit=null;
      for(const r of rows){
        if(!Array.isArray(r)) continue;
        const e=cautStep(h.p.id, r, nm, h.base, seen);
        if(e && e.live && h.head) (hit||(hit=[])).push(e);
      }
      if(hit && h.head){ const a=red.get(h.head); if(a) a.push.apply(a,hit); else red.set(h.head,hit); }
    }
    if(!railSeen(h.well.el) && !(on&&moved)) continue;
    // a rename does not touch P, so the Pfit rebuild never fires: re-read every sync
    { const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm); }
    // a machine picked on the drawing may sit in a group somebody shut
    if(on && moved){ if(h.head) h.head.open=true; KIT.reveal(h.well.el,"start"); }
    fieldRowsSync(h.body,rows);
    const v=h.body._viz;
    if(v&&v.dmg) hostPaint(v.dmg,dmgViz,coreOf(h.p.id));
  }
  cautSweep(seen);
  crRailAlert(panels,red);
}

let CR=null;
function crBuild(){
  const mount=document.getElementById("scr-operate");
  if(!mount) return null;
  const root=KIT.el("div","cr-root");
  const vitals=KIT.el("div","cr-vitals"); root.appendChild(vitals);
  /* the bar rows and their trends are off the panel; their build/sync stand ready */
  const vitalRows=null, trendBox=null;
  const units=crUnitsBuild(vitals);
  const viz={};
  for(const b of CR_VIZ){
    const c=KIT.el("canvas","insp-viz insp-viz-"+b.k+" cr-viz");
    KIT.tip(c,b.title,b.tip); vitals.appendChild(c); viz[b.k]=c;
  }
  const caut=crCautBuild(vitals);

  const banner=KIT.el("div","cr-banner"); root.appendChild(banner);

  const rail=KIT.el("div","cr-rail"); root.appendChild(rail);
  railBlank(rail);

  const head=KIT.el("div","scr-head cr-head"); root.appendChild(head);
  const drawer=(label,tip,cls)=>{ const m=KIT.menuKey({label,tip,cls:"cr-drawer"});
    const body=KIT.el("div",cls); m.menu.appendChild(body); head.appendChild(m.el); return body; };

  const logList=drawer("LOG","Everything the plant has done to itself and everything the crew has ordered, newest first.","cr-log");
  const dmgList=drawer("REPAIR","Every damaged machine, what state its repair is in, and what reaching it would cost a repair party in dose.","cr-dmg");
  const faults=crFaultsBuild(drawer("FAULTS","The fault injectors: what can be made to go wrong, on demand.","cr-flt"));

  const compRail=KIT.el("div","cr-comp-rail");
  if(!MARGIN_ONLY) rail.appendChild(compRail);

  const mhost=marginHost(root);
  // before the parked windows: same z, so DOM order is what keeps a peek under one
  const phost=selwHost(root);
  const ihost=inspHost(root);
  mount.appendChild(root);
  return {root,head,vitalRows,units,viz,banner,rail,mhost,phost,ihost,
    trend:{box:trendBox,cvs:{}},logList,dmgList,faults,caut,compRail,panels:null,Pfit:null,
    watch:null,bMelt:null,bBreach:null,bTrip:null};
}
function crCnxSync(body){
  if(!P||!P.net||!S) return;
  const keys=Object.keys(P.net.byKey);
  const rows=keys.map(k=>{ const r=P.net.byKey[k];
    return {k, name:pipeName(r), cut:runHoled(S,r)};
  });
  const sig=rows.map(r=>r.k+(r.cut?"!":"")).join("|");
  if(body._sig===sig) return;
  body._sig=sig; body.innerHTML="";
  for(const r of rows){
    const row=KIT.el("div","cr-cnx-row"+(r.cut?" cut":""));
    const n=KIT.el("span","cr-cnx-name"); n.textContent=r.name;
    const s=KIT.el("span","cr-cnx-state"); s.textContent=r.cut?"SEVERED":"intact";
    row.append(n,s); body.appendChild(row);
  }
}
function crPortsSync(body){
  if(!S) return;
  const PS=S.portShut||{};
  const ports=Object.keys(PS).map(pid=>({pid, name:portLabel(pid), shut:!!PS[pid],
                                         dead:portWrecked(S,pid)}))
    .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const sig=ports.map(p=>p.pid+(p.shut?"!":"")+(p.dead?"x":"")).join("|");
  if(body._sig===sig) return;
  body._sig=sig; body.innerHTML="";
  for(const pv of ports){
    const row=KIT.el("div","cr-cnx-row"+(pv.dead?" cut":pv.shut?" shut":""));
    const n=KIT.el("span","cr-cnx-name"); n.textContent=pv.name;
    const s=KIT.el("span","cr-cnx-state");
    s.textContent=pv.dead?("JAMMED "+(pv.shut?"SHUT":"OPEN")):pv.shut?"SHUT":"open";
    row.append(n,s); body.appendChild(row);
  }
}
function crSync(){
  if(!CR) return;
  if(CR.vitalRows) crVitalsSync(CR.vitalRows);
  crUnitsSync(CR.units);
  for(const b of CR_VIZ) hostPaint(CR.viz[b.k],b.draw);
  if(CR.trend.box) crTrendSync(CR.trend);
  crLogSync(CR.logList);
  crDamageSync(CR.dmgList);
  crFaultsSync(CR.faults);
  if(CR.Pfit!==P){
    if(CR.watch) CR.watch.free();
    CR.watch=railWatch(CR.rail);
    CR.panels=crRailBuild(CR.compRail,CR.watch); CR.Pfit=P;
  }
  if(CR.panels){ crRailSync(CR.panels); crRailHeads(CR.panels); }
  crCautSync(CR.caut);

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
  const stripBox = trStrip("operate") ? hostRect(trStrip("operate").root) : null;
  // an empty rail is display:none, and a hidden box measures zero
  const railBox = CR && CR.rail.offsetParent ? hostRect(CR.rail) : null;
  const vy = stripBox ? stripBox.y+stripBox.h : TOPBAR_H;
  const vh=Math.max(120,H-vy);
  /* the head row is transparent, so the view runs under it - measured off the FIT */
  const headBox = CR? hostRect(CR.head) : null;
  const headU = headBox? Math.max(0, headBox.y+headBox.h-vy) : 0;
  const vw = (railBox ? Math.max(200, railBox.x) : W);
  const mi=marginInsetU();
  drawPlant(vy,S,vh,0,vw,mi.l+mi.r,mi.t+mi.b+headU);
  zoomKeySync(CR&&CR.head);
  // AFTER drawPlant, because a panel is anchored against the view it just set
  marginSync(CR&&CR.mhost, true);
  // AFTER the margin: both read panTick(), and the margin's call is what advances it
  inspSync(CR&&CR.ihost, true);
  selwSync(CR&&CR.phost, true);
  // AFTER both syncs: the leader is drawn to where the window actually stands
  inspLeaders(CR&&CR.ihost);
  { const h=CR&&CR.panels&&CR.panels.find(o=>(o.fid||o.p.id)===sel);
    if(h) leaderLine(h.well.el,CR.rail); }
}
