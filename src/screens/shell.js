"use strict";
/* screen state, canvas sizing, HTML top bar */

let screen="design";

/* HELP is HTML now, so every screen sizes to the window the same way; the
   canvas/HTML split is one dataset write, read by style.css. */
function layout(){
  if(typeof document!=="undefined" && document.body) document.body.dataset.screen=screen;
  resize();
}

/* screens still draw into 0..H, but the canvas only covers TOPBAR_H..H - the
   HTML topbar owns the rest. resize() offsets the transform, local() undoes it.
   Both figures are declared in constants.js; this file only WRITES H. */
const winPx=()=>(typeof innerHeight==="number"&&innerHeight>200)?innerHeight:900;

function resize(){
  const cssW=Math.max(740,(stage&&stage.clientWidth)||0), sc=cssW/W, dpr=devicePixelRatio||1;
  const stagePx=(stage&&stage.clientHeight)||(winPx()-TOPBAR_H*sc);   // pre-layout estimate
  H=Math.max(420,stagePx/sc+TOPBAR_H);
  const bodyH=H-TOPBAR_H;
  cv.style.width=cssW+"px"; cv.style.height=(bodyH*sc)+"px";
  cv.width=Math.round(W*sc*dpr); cv.height=Math.round(bodyH*sc*dpr);
  ctx.setTransform(sc*dpr,0,0,sc*dpr,0,-TOPBAR_H*sc*dpr);
  uiDirty();                       // resizing the backing store clears it
}
addEventListener("resize",resize);

let shellEls=null;

function shellInit(){
  if(typeof document==="undefined" || !document.documentElement) return;
  const tabs=[...document.querySelectorAll("#tabs .tab")];
  shellEls={
    tabs,
    plantLine:document.getElementById("plant-line"),
    clock:document.getElementById("clock"),
    clockRow:document.getElementById("clock-row"),
    dot:document.getElementById("clock-dot"),
  };
  for(const btn of tabs){
    const k=btn.dataset.screen;
    btn.addEventListener("click",()=>{
      const dis=(k==="operate"||k==="scenario")&&designBlocked();
      if(dis) return;
      /* ANOTHER TAB IS THE CANCEL. A prewarm holds no screen of its own, so
         the tab that started it is the one gesture that must not restart it. */
      if(prewarmBusy()){ if(k==="operate") return; prewarmCancel(); }
      /* an unchanged design keeps the plant that is already running */
      if(k==="operate"&&(!P||P.dsig!==designSig())){ prewarmStart(); return; }
      if(k==="scenario"&&!P){ commission(); trBench(); trRateFit(); }
      /* ══ LEAVING THE CONTROL ROOM RESETS THE PLANT ══
         The one-way rule the bench controls depend on: a control-room session
         writes S through act(), the bench writes D.start directly, and nothing
         crosses. So going back to the bench must put the plant back where it
         was commissioned, or the bench would be sitting beside a plant that
         has drifted away from every starting position it shows.
         resetPlant(), not commission(): the network, P.netRef and the
         reference solve are properties of the DESIGN, and re-deriving them on
         a screen change would be work with no answer attached. If the design
         then changes, the P.dsig test above recommissions on the way back.
         Two things must survive it - a flying scenario run or replay, and a
         recording head that has put its own plant on the board. */
      if(k==="design" && P && S && !scnArmed() && REC.mode==="live") resetPlant();
      /* pause on the way in, unless a run or a replay is already flying */
      if(k==="scenario"&&!scnArmed()) TR.paused=true;
      // a menu about a bench part must not outlive the bench, and neither does
      // a tool: every one of them addresses one screen's plant
      ctxClose();
      TOOL.active="select";
      screen=k; layout();
    });
  }
  shellInitTooltip();
  shellInitCtxMenu();
}

/* THE RIGHT-CLICK MENU, IN HTML. Built on OPEN and torn down on close, not
   rebuilt every frame the way the painted one was - items(hit) is a pure
   function of a hit that cannot change while the box is up, so once is right
   and once a frame was only ever what an immediate-mode canvas costs.
   No frame on the box: an amber outline is the plant's SELECTED tone, and a
   menu wearing it read as one more selected thing on a deck that already has
   one. That, and the ground darker than any panel, live in style.css now. */
function shellInitCtxMenu(){
  const box=document.getElementById("ctxmenu");
  if(!box) return;
  ctxSuppress(box);
  ctxHide=()=>{ box.textContent=""; KIT.show(box,false); };
  ctxShow=hit=>{
    const R=hit&&ctxFor(), items=R?R.items(hit):[];
    // an empty menu is NO menu: the painted one opened and blinked shut on the
    // next draw, which read as a click that had not registered
    if(!items.length){ ctxClose(); return; }
    box.textContent="";
    /* the header names the thing the menu is ABOUT (a part, a run, or the plant
       itself for a bare cell) - see the registries' optional title(). It is
       never a row: not a button, so it cannot be clicked or focused. */
    const title=R.title?R.title(hit):"";
    if(title){ const h=KIT.el("div","ctx-title"); h.textContent=title; box.appendChild(h); }
    for(const it of items)
      box.appendChild(KIT.button(it.label,{flat:true,
        onClick:()=>{ it.fn(); ctxClose(); uiDirty(); }}).el);
    KIT.show(box,true);
    // clamped at BOTH ends: the painted menu clamped right and bottom only, so
    // a tall menu near the foot of the window ran off the top instead
    const r=box.getBoundingClientRect();
    box.style.left=Math.max(4,Math.min(hit.cx, innerWidth -r.width -4))+"px";
    box.style.top =Math.max(4,Math.min(hit.cy, innerHeight-r.height-4))+"px";
  };
  // a press anywhere else shuts it; uiDown() covers the canvas, this covers the
  // rails and the topbar, which the canvas never hears about
  document.addEventListener("pointerdown",e=>{
    if(!e.target.closest("#ctxmenu")) ctxClose();
  },true);
}

const SCNTIP_ON="Say what the reactor is FOR. Lay out a timeline of what will happen to it - load changes, battle damage, a blackout - and the limits it has to hold while they do. RUN flies it with nobody at the panel and says PASS or FAIL and which limit broke. Unlike CONTROL, opening this never rebuilds a plant that is already running.";
const OPTIP_ON="The live control room. Opening it commissions the current design. Run the plant, push it past its limits, and repair it when it bites back. Visiting the bench puts the plant back where it was commissioned, and changing anything there rebuilds the unit from scratch the next time you come back here.";
const LOCKTIP="Locked while a machine is standing where it does not fit. Drag it clear on the design bench.";

/* ONE string, so the sim time and the rate it is advancing at cannot be
   written out of step with each other - they are two readings of one moment. */
function shellClock(){
  /* THE CLOCK IS THE RUNNING PLANT'S, so it is not on a screen where nothing
     runs: the bench steps no ticks, so the reading is 0 TPS and 0.0x, and the
     amber that says "behind the rate you asked for" was firing about a plant
     nobody is watching. SIMSCREEN (record.js) is the same predicate simFrame()
     already uses to decide whether to step at all. */
  /* BLANK, not hidden: the row keeps its box, so the topbar beside it does not
     shift every time you leave the control room. The string is still written
     while it is blank, for the same reason - a stale one is a different width
     and the bar would jump on the way back in. */
  const live = !!SIMSCREEN[screen];
  shellEls.clockRow.classList.toggle("blank", !live);
  /* ACHIEVED, NEVER ASKED FOR. Printing TR.rate here would be the button
     reading itself back, which is the very thing the strip was already saying
     and the very thing a plant too big to keep up cannot honour. 50 ticks a
     second is one second of plant time, so the ticks the loop is ACTUALLY
     getting are the timescale it is ACTUALLY running at - MAX and VLD have a
     figure here for the first time, and 1X on a heavy plant reads 0.6x.
     One decimal always, so the field does not change width as it moves. */
  const ts = (TR.sps/50).toFixed(1)+"x";
  const t=S?S.t:0, clk="T+"+pad(t.toFixed(1),7)+" / "+pad(Math.round(TR.sps),4)+" TPS / "+ts;
  if(shellEls.clock.textContent!==clk) shellEls.clock.textContent=clk;
  /* THE RATE IS A PROMISE AND THIS IS THE MEASUREMENT OF IT. Only a finite
     rate promises anything - MAX and VLD run at whatever they get - and only
     a running plant can be behind, so a pause is not slow. */
  const owed = live && typeof TR.rate==="number" && isFinite(TR.rate) && !TR.paused && S;
  shellEls.clock.classList.toggle("slow", !!owed && TR.sps < 50*TR.rate*0.9);
}
function shellSync(){
  helpSync();
  if(!shellEls) return;
  /* a validation run keeps this one reading and nothing else - see trQuiet()
     (record.js). designBlocked() below walks the whole plant, and that walk is
     the frame the run is trying to spend on the sim. */
  if(trQuiet()){ shellClock(); return; }
  /* THE SAME WINDOW A FRAME TAKES - see laySettle() (layout.js). This runs on
     its own 10 Hz interval rather than inside a frame, so it had no settled
     graph of its own: designBlocked() walks the whole plant, and every reader
     it passed through rebuilt four signature strings to prove a cache nothing
     had touched. Measured in Chrome as the single largest allocator on the
     bench. Nothing below writes D or LAY. */
  laySettle();
  const blocked=designBlocked();
  for(const btn of shellEls.tabs){
    const k=btn.dataset.screen, on=screen===k,
          dis=(k==="operate"||k==="scenario")&&blocked;
    btn.classList.toggle("on",on);
    btn.classList.toggle("dis",dis);
    if(k==="operate") btn.dataset.tipBody = dis?LOCKTIP:OPTIP_ON;
    else if(k==="scenario") btn.dataset.tipBody = dis?LOCKTIP:SCNTIP_ON;
  }
  /* ══ THE PLANT ON THE BOARD, NOT THE ONE THAT WAS COMMISSIONED ══
     P is the commissioned plant and does not move when the DESIGN does, so
     loading a whole-plant preset - a different reactor, a different rating -
     left the topbar printing the machine before it. The same signature gate
     the OPERATE tab uses (P.dsig against designSig()) decides which one is
     being looked at, and an uncommissioned design reads off derived() rather
     than saying NO CORE about a core that is drawn. */
  const fresh = P && P.dsig===designSig();
  let line;
  /* ══ AND THE RATING IS THE VESSEL'S, NOT THE LATTICE'S ══
     D.power is measured off the fuel DRAWING (latMeasure(), lattice.js), which
     exists whether or not a reactor stands on the arrangement grid - so a blank
     ship advertised 1198 MWt and 395 MWe it had no machine to make. There is no
     rating without the machine, and the bar says so rather than printing the
     last plant's figures over an empty board. */
  if(!roleOf("core")) line="NO REACTOR";
  else if(fresh) line=`${P.id}  ${pad(P.rated.toFixed(0),4)} MWt  ${pad((P.rated*P.eff).toFixed(0),4)} MWe`;
  else { const d=derived();
    line=`${d.a.id}  ${pad(D.power.toFixed(0),4)} MWt  ${pad((D.power*d.eff).toFixed(0),4)} MWe`; }
  if(shellEls.plantLine.textContent!==line){ shellEls.plantLine.textContent=line;
    shellEls.plantLine.classList.toggle("idle",!fresh); }
  shellClock();
  // the blink is written inline, so it must answer the blank row itself - an
  // inline `visible` on the dot shows straight through a hidden parent
  shellEls.dot.style.visibility=SIMSCREEN[screen]&&Math.floor(performance.now()/500)%2?"visible":"hidden";
  layRelease();
}

/* ══ COMMISSIONING, IN FRONT OF THE PLAYER ══
   commission() is a second of network solves, and a tab that freezes is the one
   thing a click that big must not look like. commissionGen() (sim/step.js) is
   the same work with stage boundaries in it, driven here on a frame budget.
   NOTHING IS PAINTED WHILE IT RUNS: a half-built P is not a plant and no
   renderer may read one, so the last frame of the screen you left stays up
   behind the bar - and the topbar is above it, because picking another tab is
   the cancel. */
const PREWARM_MS=24;
let pwGen=null, pwEls=null, pwFrac=0, pwStage="";
const prewarmBusy=()=>!!pwGen;
function prewarmStart(){
  tipHide(); ctxClose();
  pwGen=commissionGen(); pwFrac=0; pwStage="";
  prewarmSync(true);
}
/* A CANCELLED PREWARM LEAVES NO PLANT. commission() overwrites P on its first
   statement, so the plant that was running is already gone by the first yield
   and there is nothing to put back: the board is uncommissioned, and the tab
   test above rebuilds it on the way back in. */
function prewarmCancel(){
  if(!pwGen) return;
  pwGen=null; P=null; S=null;
  prewarmSync(false); uiDirty();
}
function prewarmStep(){
  if(!pwGen) return false;
  const t0=performance.now();
  do{
    let r;
    try{ r=pwGen.next(); }catch(e){ pwGen=null; prewarmSync(false); throw e; }
    /* THE BENCHMARK IS PART OF COMMISSIONING, not of the sim: a rate is a
       promise about this machine, so the plant that was just built is what it
       has to be measured on. It runs on a snapshot and puts the plant back. */
    if(r.done){ pwGen=null; trBench(); trRateFit(); prewarmSync(false); uiDirty(); return false; }
    pwFrac=r.value.frac; pwStage=r.value.stage;
  }while(performance.now()-t0<PREWARM_MS);
  prewarmSync(true);
  return true;
}
function prewarmSync(on){
  if(!pwEls){
    const box=typeof document!=="undefined" && document.getElementById("prewarm");
    if(!box) return;
    pwEls={box, stage:box.querySelector(".pw-stage"), pct:box.querySelector(".pw-pct"),
           fill:box.querySelector(".pw-fill")};
  }
  KIT.show(pwEls.box,on);
  if(!on) return;
  pwEls.stage.textContent=pwStage;
  pwEls.pct.textContent=Math.round(pwFrac*100)+"%";
  pwEls.fill.style.width=(pwFrac*100).toFixed(1)+"%";
}

/* ONE TOOLTIP, TWO SOURCES. A rail control is a DOM node and carries its own
   data-tip-title; a canvas widget is not one and cannot, so the canvas keeps the
   hit test (tipHover(), core/ui.js) and hands the answer here. Everything after
   that - the box, the wrap, the band, the placement - is the same code either
   way, which is the whole point: there used to be two tooltips, and only one of
   them could be styled by the stylesheet. */
let tipSync=()=>{}, tipHide=()=>{};
function shellInitTooltip(){
  const tip=document.getElementById("tip");
  if(!tip) return;
  let cur=null, curRail=null, curGroup=null, owner=null, cvKey=null, bar=null;
  // nothing is hoverable while a prewarm is up: the box would stand on the bar
  const show=el=>{ if(prewarmBusy()) return; cur=el; curRail=railOf(el); curGroup=el.closest(".cr-group"); owner="html";
    tip.innerHTML=`<b>${el.dataset.tipTitle||""}</b><p>${el.dataset.tipBody||""}</p>`;
    bar=null;
    KIT.show(tip,true);
    const b=el.getBoundingClientRect();
    const a=curRail?null:vitalsAnchor();
    if(a) placeAnchor(a);
    else if(curRail) place(curGroup?curGroup.getBoundingClientRect().top:b.top+b.height/2, !!curGroup);
    else placeBy(b); };
  const hide=()=>{ cur=null; curRail=null; curGroup=null; owner=null; cvKey=null; bar=null; KIT.show(tip,false); };
  tipHide=hide;
  document.addEventListener("pointerover",e=>{
    const el=e.target.closest("[data-tip-title]");
    if(el && el!==cur) show(el);
  });
  document.addEventListener("pointerout",e=>{
    const el=e.target.closest("[data-tip-title]");
    if(el && el===cur && !(e.relatedTarget && el.contains(e.relatedTarget))) hide();
  });
  /* PARKED CLEAR OF THE RAIL, not carried on the pointer. A panel in a rail is
     read control by control, so a box that follows the hand is a box sitting on
     top of the next control you were going to read - and the rails are where
     the hand spends the whole session. It stands just OUTSIDE whichever rail is
     on screen and only tracks the pointer vertically - the same decision
     placeView() below makes for a tip that came off the plant.
     Measured, not a constant: the rail is a fixed CSS width today, but a
     hard-coded 340 here would be a second copy of that number in a second
     file. */
  const railOf=el=>{ const r=el.closest(".db-rail,.cr-rail,.scn-rail"); return r&&r.offsetParent?r:null; };
  /* ONE PARK SPOT WHENEVER THE VITALS PANEL IS UP - off its right edge, top on
     its top. A RAIL CONTROL IS NOT ON IT: a rail keeps its own seat beside
     itself, or reading the rail throws the box across the window. */
  const vitalsAnchor=()=>{ const v=document.querySelector(".cr-vitals");
    return v&&v.offsetParent?v.getBoundingClientRect():null; };
  const placeAnchor=b=>{
    const gap=8, r=tip.getBoundingClientRect();
    tip.style.left=Math.max(4,Math.min(b.right+gap, innerWidth-r.width-4))+"px";
    tip.style.top=Math.max(4,Math.min(b.top, innerHeight-r.height-4))+"px";
  };
  /* atTop = the y IS the top of the box: a control inside a group is read as
     part of that group, so its tip sits level with the group and holds still
     while the hand walks down the rows. */
  const place=(clientY,atTop)=>{
    const gap=12, r=tip.getBoundingClientRect();
    const x=Math.max(4, curRail.getBoundingClientRect().left-gap-r.width);
    const y=Math.max(4, Math.min(atTop?clientY:clientY-r.height/2, innerHeight-r.height-4));
    tip.style.left=x+"px"; tip.style.top=y+"px";
  };
  /* A control outside any rail gets its tooltip on its OWN box - parking that one
     beside a rail it does not live in put it half a screen from what it names. */
  const placeBy=b=>{
    const gap=8, r=tip.getBoundingClientRect();
    const below=b.bottom+gap, y=below+r.height<=innerHeight-4?below:Math.max(4,b.top-gap-r.height);
    tip.style.left=Math.max(4, Math.min(b.left, innerWidth-r.width-4))+"px";
    tip.style.top=y+"px";
  };
  document.addEventListener("pointermove",e=>{ if(cur&&curRail&&!curGroup) place(e.clientY); });

  /* PARKED bottom-right OF THE PLANT VIEW, not carried on the pointer. A box
     that follows the hand is a box between the hand and whatever it is reaching
     for, and on the plant that is the component it just described. Parked, it
     never covers the thing being read, it never flips sides mid-sentence, and
     touch and mouse get the same answer.
     The VIEW box and not the canvas: the rails are opaque and sit ON the canvas,
     so the canvas corner is underneath one of them and a box parked there is a
     box nobody can read. viewRectCss() is exactly the room the rails leave. */
  let viewAt="";
  const placeView=()=>{
    const a=vitalsAnchor();
    if(a){ const at="v"+a.right+","+a.top+","+tip.offsetHeight;
      if(at===viewAt) return; viewAt=at; placeAnchor(a); return; }
    const v=viewRectCss(), r=tip.getBoundingClientRect();
    const x=Math.max(4,Math.min(v.right-r.width-6, innerWidth-r.width-4));
    const y=Math.max(4,Math.min(v.bottom-r.height-6,innerHeight-r.height-4));
    const at=x+","+y; if(at===viewAt) return; viewAt=at;
    tip.style.left=x+"px"; tip.style.top=y+"px";
  };
  // the shape of the scale, not its value: a live needle goes through set()
  const barSig=g=>!g?"":[g.lo,g.hi,g.dp,g.zones.map(z=>z[0]).join(","),
                         (g.lim||[]).map(L=>L[0]+L[1]).join(",")].join("|");
  const buildCanvas=t=>{
    const g=t.g;
    viewAt="";                       // a new box is a new size, so re-park it
    tip.textContent="";
    const head=KIT.el("div","tip-head");
    const b=KIT.el("b"); b.textContent=t.title||""; head.appendChild(b);
    if(g){
      /* the verdict and setpoint ride on the title row rather than under the
         strip - the strip already carries three, and below it costs a line */
      const z=bandZone(g);
      const zs=KIT.el("span","tip-verdict"); zs.textContent=z[2]; zs.style.color=z[1];
      head.appendChild(zs);
      for(const L of (g.lim||[])){
        const ls=KIT.el("span","tip-lim"); ls.textContent=L[1]+" "+L[0].toFixed(g.dp);
        head.appendChild(ls);
      }
    }
    tip.appendChild(head);
    const p=KIT.el("p"); p.textContent=t.body||""; tip.appendChild(p);
    // the same mapping inspector.js makes off a band(): one scale widget, one CSS
    bar = g ? KIT.band({lo:g.lo,hi:g.hi,zones:g.zones,dp:g.dp,lim:g.lim,v:g.v}) : null;
    if(bar) tip.appendChild(bar.el);
  };
  /* Called once a frame. The HTML source WINS when it has one: a rail sits on
     top of the canvas, so a pointer inside a rail control is not over the plant
     however the canvas hit test reads. */
  tipSync=()=>{
    if(owner==="html") return;
    const t=tipHover();
    if(!t){ if(owner==="canvas") hide(); return; }
    const key=[t.title||"",t.body||"",barSig(t.g)].join("␟");
    if(key!==cvKey || owner!=="canvas"){
      cvKey=key; owner="canvas"; buildCanvas(t); KIT.show(tip,true);
    }
    if(bar) bar.set(t.g.v);
    placeView();
  };
}

/* ══ NAMES ARE A VIEW, NEVER A FACT ══
   The physics has no vocabulary left: a circuit is a connected component with
   an index and nothing else. The player still needs words, so this turns an
   index into a name out of WHAT IS ON IT. A circuit may match several - a
   direct cycle is primary and secondary at once - and this picks one, in a
   fixed order, so it can never return two. Nothing in src/sim/ or src/data/
   may read it: the same standing a layer has. */
function circNames(){
  const G=nodeGraph();
  const partsOn=[]; for(let i=0;i<G.nCirc;i++) partsOn.push([]);
  for(const p of LAY.parts){
    const ns=G.nodesOf[p.id]||[]; const seen={};
    for(const n of ns){ const c=G.circuit[n];
      if(c===undefined || seen[c]) continue; seen[c]=1; partsOn[c].push(p); }
  }
  /* A CIRCUIT NOBODY DREW A PIPE TO is one machine standing on its own - a
     spare panel, a generator waiting to be plumbed. It gets a name of its own
     rather than the name of whatever it would be if it were connected, or the
     rail lists two COOLING groups and one of them is a box in a corner. */
  const piped={};
  for(const c of pipeTrace().conns){
    const a=partOf(c.a), b=partOf(c.b); if(!a||!b) continue;
    piped[G.circuit[a.id+c.sa]]=1; piped[G.circuit[b.id+c.sb]]=1;
  }
  const raw=[];
  for(let i=0;i<G.nCirc;i++){
    const has=r=>partsOn[i].some(p=>p.role===r);
    raw.push(!piped[i] ? "UNPIPED"
      : i===G.coreCirc ? "PRIMARY"
      : has("radiator") ? "COOLING"
      : has("turb") ? "SECONDARY"
      : "INTERMEDIATE");
  }
  // a name earned twice is numbered, in index order, so it is still one name
  const seen={}, total={};
  for(const n of raw) total[n]=(total[n]||0)+1;
  return raw.map(n=>{ seen[n]=(seen[n]||0)+1;
    return total[n]>1 ? n+" "+seen[n] : n; });
}
function circName(ci){
  if(ci===null || ci===undefined || ci<0) return "UNCONNECTED";
  return circNames()[ci] || "UNCONNECTED";
}
