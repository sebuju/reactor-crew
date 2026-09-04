"use strict";

/* ptrHost names the canvas ui.ptr is measured in: null for the page canvas, or
   the element a hosted widget owns (see hostPaint in render/plant.js). Each
   host has its OWN coordinate space, so a point from one must never be tested
   against a widget pushed by another - they overlap numerically.
   ui.host is the one being painted right now: a draw function shared by two
   hosts needs it to tell its own per-host state apart. */
const ui={widgets:[],prev:[],tips:[],drag:null,ptr:{x:-9,y:-9},ptrHost:null,host:null};
function hostScope(el){ ui.host=el; }

const VIEW={z:1,s:1,fit:1,ox:0,oy:0,x:12,y:0,w:736,h:0,cx:12,cy:0,cw:736,ch:0};
/* ══ CSS PIXELS, ON A CANVAS MEASURED IN LAYOUT UNITS ══
   #cv stretches W layout units across the stage, so everything drawn on it
   grows with the window. That is right for the PLANT and wrong for anything
   that is furniture - a menu, a key, a leader to an HTML rail - because those
   sit among HTML type that is plain px. cvK() is CSS px per layout unit; its
   reciprocal is what one screen pixel is worth here. */
function cvK(){ const r=cv.getBoundingClientRect(); return r.width? r.width/W : 1; }
const cvPx=()=>1/cvK();
/* THE PLANT VIEW'S BOX, IN CLIENT PIXELS - the one door from VIEW into the space
   an absolutely positioned HTML element lives in. Two callers park furniture on
   the edge of the plant view (the ZOOM key and the tooltip) and a second copy of
   this arithmetic would drift the moment the letterbox changed. */
function viewRectCss(){
  const rc=cv.getBoundingClientRect(), k=cvK();
  return {left:rc.left+VIEW.x*k, top:rc.top+(VIEW.y-TOPBAR_H)*k,
          right:rc.left+(VIEW.x+VIEW.w)*k, bottom:rc.top+(VIEW.y+VIEW.h-TOPBAR_H)*k};
}
let viewOn=false;                       // are widgets being pushed through it?
/* ══ THE LETTERBOX, HALVED ══
   vFit() scales the plant to FIT its box, so unless the box happens to share the
   plant's aspect ratio there is slack on one axis - and the transform lands the
   plant's top-left on the box's top-left, so every pixel of that slack used to
   pile up on the bottom and the right. It read as a plant sitting wrong in its
   frame rather than as a margin. Split it.
   Measured against the CURRENT scale, not the fit, so it is exactly zero the
   moment you zoom in - which is when there is no slack to split.
   Recomputed per call rather than stored on VIEW: it is a pure function of four
   fields already there, and a stored copy is one more thing a pan could leave
   stale. The three places that map plant space to screen space add it; the clip
   rect and vIn() do not, so a pan can still carry the plant across the whole box. */
const vPad=()=>({x:Math.max(0,(VIEW.w-VIEW.cw*VIEW.s)/2),
                 y:Math.max(0,(VIEW.h-VIEW.ch*VIEW.s)/2)});
const vPt=p=>{ const d=vPad();
  return {x:VIEW.cx+VIEW.ox+(p.x-VIEW.x-d.x)/VIEW.s,
          y:VIEW.cy+VIEW.oy+(p.y-VIEW.y-d.y)/VIEW.s}; };
const vScr=p=>{ const d=vPad();
  return {x:VIEW.x+d.x+(p.x-VIEW.cx-VIEW.ox)*VIEW.s,
          y:VIEW.y+d.y+(p.y-VIEW.cy-VIEW.oy)*VIEW.s}; };
const vIn=p=>p.x>=VIEW.x&&p.x<=VIEW.x+VIEW.w&&p.y>=VIEW.y&&p.y<=VIEW.y+VIEW.h;
function vBox(x,y,w,h){ VIEW.x=x; VIEW.y=y; VIEW.w=w; VIEW.h=h; }
function vFit(x,y,w,h,cx,cy,cw,ch){
  vBox(x,y,w,h);
  VIEW.cx=cx; VIEW.cy=cy; VIEW.cw=cw; VIEW.ch=ch;
  VIEW.fit=Math.min(w/Math.max(cw,1), h/Math.max(ch,1));
  VIEW.s=VIEW.fit*VIEW.z;
}
/* ══ PUT PLANT POINT `a` UNDER SCREEN POINT (sx,sy) ══
   This is the inverse of vScr() and it must stay the inverse of vScr(). Three
   call sites - the zoom key, the wheel, and the wheel's off-plant fallback -
   each inverted the mapping by hand, which was survivable while the mapping was
   two terms and stopped being survivable the moment vPad() added a third: two of
   the three would have silently missed it and the plant would jump under the
   pointer on every wheel notch. One function, so it cannot be missed twice. */
function vAnchor(a,sx,sy){
  const d=vPad();
  VIEW.ox=(a.x-VIEW.cx)-(sx-VIEW.x-d.x)/VIEW.s;
  VIEW.oy=(a.y-VIEW.cy)-(sy-VIEW.y-d.y)/VIEW.s;
}
// zoom about a plant point - the wheel holds the point under the pointer, the
// key centres on the component you have selected
function vZoom(z,cx,cy){
  VIEW.z=z; VIEW.s=VIEW.fit*VIEW.z;
  vAnchor({x:cx,y:cy}, VIEW.x+VIEW.w/2, VIEW.y+VIEW.h/2);
}

// a keystroke is a registry too: a row carries BOTH the keystroke and the
// function, so the on-screen key and the shortcut can never drift apart.
// Modified keys are left alone on purpose - ctrl-R must still reload the
// page and cmd-1 must still change browser tab.
const KEYS=[];
const keyAdd=o=>{ KEYS.push(o); return o; };
const keyList=()=>KEYS.filter(k=>!k.sc||k.sc===screen);
addEventListener("keydown",e=>{
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  /* AN OPEN MENU EATS THE FIRST ESCAPE. Not a KEYS row: the registry takes the
     first match, so a row here would beat the bench's own Escape for good and
     the tool could never be put down again. Menu first, then everything else. */
  if(e.key==="Escape" && ctxMenu){ e.preventDefault(); ctxClose(); return; }
  /* AND A PREWARM EATS IT AHEAD OF EITHER. Same reason: the screen underneath
     is still the bench or the scenario board, so its own Escape row would put
     a tool down instead of stopping the commissioning nobody wants to wait
     for. See prewarmCancel() (screens/shell.js). */
  if(e.key==="Escape" && prewarmBusy()){ e.preventDefault(); prewarmCancel(); return; }
  const K=keyList().find(k=>k.k===e.key);
  if(K){ e.preventDefault(); K.fn(); }
});

const OVL=[];
let ovlOpen=null;
const ovlAdd=o=>{ OVL.push(o); return o; };
const ovlList=()=>OVL.filter(o=>(!o.sc||o.sc===screen)&&(!o.when||o.when()));
const ovlFor=k=>ovlList().find(o=>o.k===k);
function ovlToggle(k){ ovlOpen = ovlOpen===k ? null : k; }
function drawOverlay(){
  if(!ovlOpen) return;
  const o=ovlFor(ovlOpen); if(!o){ ovlOpen=null; return; }
  const h=Math.min(typeof o.h==="function"?o.h():o.h, VIEW.h-10), y=VIEW.y+VIEW.h-h;
  fillRect(VIEW.x,VIEW.y,VIEW.w,VIEW.h,"rgba(6,10,11,.62)");
  fillRect(12,y,736,h,C.panel);
  // catcher, pushed BEFORE the panel's own widgets so a click on bare overlay
  // does not reach the component behind it
  push({x:12,y,w:736,h,type:"btn"});
  o.draw(y);
}
function ovlBar(y,h,note){
  fillRect(0,y,W,h,C.panel); fillRect(0,y,W,1,C.edge);
  let x=W-12;
  const L=ovlList();
  for(let i=L.length-1;i>=0;i--){ const o=L[i];
    const kw=tw(o.label,{size:6.5,sp:1,caps:1})+14;
    x-=kw;
    const ky=y+(h-BTN_H)/2;
    button(x,ky,kw,BTN_H,o.label,
      {sunk:1,on:ovlOpen===o.k,size:6.5,sp:1,fn:()=>ovlToggle(o.k)});
    TIP(x,ky,kw,BTN_H,o.label,o.tip);
    x-=4;
  }
  if(note) fitTxt(note,12,midBase(y,h,7),x-20,{size:7,color:C.ink2});
}

// a right-click menu is a registry for the same reason an overlay is: the
// bench's ADD/REMOVE menu and the scenario timeline's own menu are the same
// gesture answering two different questions, sharing one engine instead of
// each carrying a copy. resolve(p) reads the raw release point and returns
// what the click landed on (or null); items(hit) turns that into menu rows.
const CTX=[];
const ctxAdd=o=>{ CTX.push(o); return o; };
const ctxFor=()=>CTX.find(o=>!o.sc||o.sc===screen);

let ctxMenu=null;
/* THE MENU IS HTML - #ctxmenu, built by shell.js. What is left here is the
   registry, the hit, and the gesture: resolve(p) still reads a LAYOUT point,
   because that is the space the plant is drawn in, while cx/cy carry the
   pointer's own client pixels, which is the space the box is placed in. No
   conversion either way, and the cvPx() scaling the painted menu needed on
   every single measurement is simply what a CSS pixel already means. */
function openCtxMenu(p,e){
  const R=ctxFor();
  ctxMenu = R ? R.resolve(p) : null;
  if(ctxMenu){ ctxMenu.cx=e.clientX; ctxMenu.cy=e.clientY; }
  ctxShow(ctxMenu);
}
// set by shell.js; the default is what the headless bundle and the sim worker get
let ctxShow=()=>{}, ctxHide=()=>{};
// hides UNCONDITIONALLY: the box and the hit are two things, and a close that
// only fires when the hit happens to be set is a close that can leave the box up
function ctxClose(){ ctxMenu=null; ctxHide(); }

/* ══ STAGE 8: A COMPONENT CARRIES THE NAME THE PLAYER GAVE IT ══
   D.name is not declared in design.js (which this file does not own) - it is
   created lazily, here, by the one writer. Keyed by part id, so a rename
   rides designSig() (JSON.stringify(D)+...), the recording head and the save
   format for free - the same trick D.fittings and D.tanks already use - and the
   stock plant's signature does not move until a rename actually happens:
   nothing here writes D.name until setPartName() is handed a real string.
   partName() is the ONE reader: a raw p.name read anywhere in the UI is a bug. */
/* partName()/setPartName() live in layout.js. They read and write D.name and
   touch nothing on the page, and the SIM names its own machines now - an event
   log line calls partName(), so a copy here left the worker (which loads no UI
   file at all) throwing on the first log line that named a part. */

const ptIn=(w,p)=>w.v ? (vIn(p)? vPt(p) : null) : p;

const push=w=>{ if(viewOn) w.v=1; w.host=ui.host; ui.widgets.push(w); return w; };
const inside=(w,p)=>!!p&&p.x>=w.x&&p.x<=w.x+w.w&&p.y>=w.y&&p.y<=w.y+w.h;
const hov=w=>w.host===ui.ptrHost&&inside(w,ptIn(w,ui.ptr))&&!ui.drag;
/* THE SAME TEST WITHOUT THE DRAG GATE. hov() goes false on any press, which is
   right for a highlight and wrong for a region that decides whether a control
   is DRAWN AT ALL - a strip that vanished the moment its own slider was
   grabbed would take the slider with it. */
const hovHold=w=>w.host===ui.ptrHost&&inside(w,ptIn(w,ui.ptr));
/* IS THE SLIDER NOW BEING DRAGGED ONE OF THIS REGION'S OWN? ui.drag IS the
   slider's widget, so the question is asked of its RECT and not of the pointer,
   which a geared drag deliberately carries far away from the track. */
const sldIn=r=>{ const d=ui.drag;
  return !!(d&&d.type==="sld"&&d.x>=r.x-2&&d.x<=r.x+r.w+2&&d.y>=r.y-2&&d.y<=r.y+r.h+2); };
// the ONE hit test: last widget pushed wins, and it answers for either button
const hitAt=p=>{
  for(let i=ui.prev.length-1;i>=0;i--){ const w=ui.prev[i];
    if(w.host===ui.ptrHost&&inside(w,ptIn(w,p))) return w; }
  return null;
};
/* ══ THE TOOL TABLE ══
   One module-level object, modelled on LATPEN (design-bench.js), and the one
   thing a bench gesture asks before it does anything else. Only one tool is
   ever active; more will follow, so the table is the extension point rather
   than a boolean somebody has to remember to clear. */
const TOOL={active:"select"};
const TOOLS=[
  {id:"select", sc:"design", label:"SELECT",
   tip:"Pick a machine to configure it, and drag it to move it. Click a cell beside a machine to put a port there, and click the port again to take it away."},
  {id:"pipe", sc:"design", label:"PIPE",
   tip:"Drag to lay a run of pipe cells. It follows the drag, turning where the drag turns. Click a bare cell to fill it and click a laid one to turn it a quarter, which the wheel also does. Hold the right button and sweep to take cells out. A cell drawn dashed and grey is pipe that joins nothing yet."},
  /* The FAULTS panel carries this one rather than a tool bar, so it is on the
     table for the pre-emption branch and the aim mark, not for a switch. */
  {id:"hit", sc:"operate", label:"AIMED COMBAT HIT",
   tip:"Click a machine, a port or a pipe cell to take the hit THERE. One click, then the tool puts itself back; a click on bare deck cancels it."},
];
// which cell a plant-space point lands on, in grid units - what every tool
// gesture is addressed at, since a tool paints CELLS and never pixels
const cellAt=pt=>[Math.floor((pt.x-GX)/CELL), rowAt(pt.y)];
const cellSame=(a,b)=>!!a&&!!b&&a[0]===b[0]&&a[1]===b[1];
// take the pipe cell under a plant point out, if there is one. One helper,
// because the press and the drag that follows it must lift the same thing.
function pipeLift(pt){ const c=cellAt(pt), k=c[0]+","+c[1];
  if(D.pipes[k]){ delete D.pipes[k]; buildLayout(); } }
/* WHAT THE AIMED HIT IS ON, resolved once: the press and the mark that
   previews it read the same answer, or the picture and the damage would name
   different machines. A machine's whole footprint is the target, a port and a
   pipe cell are each a target of their own (combatHit() prices them that way
   too), and null is bare deck. */
function hitAimAt(pt){
  const p=partAt([pt.x,pt.y]);
  if(p) return p.id;
  const c=cellAt(pt);
  const pid=portAtCell(c[0],c[1]);
  if(pid) return "port:"+pid;
  const k=pipeKey(c[0],c[1]);
  return D.pipes[k] ? "pipe:"+k : null;
}

let touchTip=null, isTouch=false;
// g is an optional band(): the scale the value in this region lives on, so
// the tooltip can be checked at a glance instead of just believed
function TIP(x,y,w,h,title,body,g){ ui.tips.push({x,y,w,h,title,body,g,v:viewOn?1:0,host:ui.host}); }
function findTip(p){
  for(let i=ui.tips.length-1;i>=0;i--){ const t=ui.tips[i];
    if(t.host!==ui.ptrHost) continue;
    const q=ptIn(t,p); if(!q) continue;
    if(q.x>=t.x&&q.x<=t.x+t.w&&q.y>=t.y&&q.y<=t.y+t.h) return t; }
  return null;
}
/* WHICH TIP THE POINTER IS ON, and nothing else. The BOX is HTML - one #tip
   element, styled by the stylesheet, presented by shell.js - so all that is
   left here is the part a canvas widget cannot delegate: it is not a DOM node,
   so it cannot carry the data-tip-title a rail control carries, and the hover
   has to be resolved against the rects TIP() pushed. */
function tipHover(){
  if(ui.drag) return null;
  if(isTouch) return (touchTip && performance.now()<touchTip.until) ? touchTip : null;
  return findTip(ui.ptr);
}

/* ONE HEIGHT FOR EVERY KEY DRAWN ON THE CANVAS. A control strip cell, a bypass
   row, a relief valve's arm, the REPAIR key and the ZOOM key were 10, 10, 13, 14
   and 14 px tall - five numbers for one kind of object, so any two of them next
   to each other read as different kinds of control. The height is still passed
   in, because a caller sometimes has to fill a rect it does not own; what it
   passes is this. */
/* A KEY'S ORDINARY HEIGHT and the smallest it may compact to before a strip
   gives up and drops a name row instead - rungs 4 and 5 of the degradation
   ladder (ctlStrip(), plant.js). BTN_TXT_PAD is the air either side of a
   label inside its own key, and it is what fitStep() measures against, so a
   label never sits hard against the edge of the box it names. */
const BTN_H=14, BTN_H_MIN=10, BTN_TXT_PAD=5;
/* THE FILL UNDER A KEY, BY STATE, IN ONE PLACE. An arming switch draws its own
   two-part label so it cannot go through button() whole - and while it also
   picked its own fill, it sat at the PLINTH tone while every key beside it sat
   a shade above, so the switch read as a hole punched in the strip rather than
   a key mounted on it. Danger is drawn SOLID (dark text on full red), the way a
   lit annunciator tile is - SCRAM and the one-shot boron dump are the two keys
   that must never be found by reading them, only by their colour. */
function btnFill(o,hovered){
  if(o.danger) return hovered?"#ff7d6c":C.red;
  if(o.on) return "#2a1f08";
  // o.sunk is a borderless key: it sits a shade ABOVE the plinth it stands on -
  // filled with C.well it read as a hole punched in the component rather than
  // as a key mounted on it. o.base overrides the RESTING fill for a key whose
  // row is otherwise the same colour as the plate under it.
  const base = o.sunk?C.edge:(o.base!==undefined?o.base:C.panel);
  return hovered ? (o.sunk?C.edge2:C.panelHi) : base;
}
function button(x,y,w,h,label,o){
  o=o||{}; const wd=o.inert?{x,y,w,h}:push({x,y,w,h,type:"btn",fn:o.fn});
  const h_=!o.inert && hov(wd);
  // o.sunk is a borderless key: tone alone reads the shape, so it draws no
  // frame (boxing every key in a 46px component read as a cage)
  const col = o.inert ? "#3c4c47" : o.danger ? C.red : o.on ? C.amber : (h_?C.edge2:C.edge);
  fillRect(x,y,w,h, o.inert?C.panel:btnFill(o,h_));
  // o.flat is o.sunk's sibling for a SELECTED key that must also lose its
  // outline (the bench's pen/preset keys, whose amber fill+type already say it)
  if(!o.sunk && !o.flat) frame(x,y,w,h,col);
  /* ══ A KEY'S LABEL STEPS DOWN BEFORE IT IS CUT ══
     This was a bare txt(), so a label too wide for its key simply overflowed
     it - and that overflow is the whole reason a machine's box carried a
     width floor. clipTxt() walks TSCALE (core/text.js) exactly as every other
     fitted label on the plant does, and only cuts once the smallest rung
     still will not fit. `sp` is dropped with the size, because letter
     spacing is the first thing worth losing. */
  const q={size:o.size||9,weight:(!o.inert&&o.danger)?700:o.weight,
           sp:o.sp===undefined?1.6:o.sp,caps:1,align:"center",
           color:o.inert?"#3c4c47":o.danger?"#160404":o.on?C.amber:(h_?C.bright:C.ink)};
  let inner=Math.max(2,w-BTN_TXT_PAD);
  if(tw(label,q)>inner && q.sp>0) q.sp=0;
  /* A NARROW KEY GIVES UP ITS AIR BEFORE IT GIVES UP A LETTER. BTN_TXT_PAD is
     a third of an 18px fitting key, which is what cut its OPEN to OPE. */
  if(tw(label,Object.assign({},q,{size:TSCALE[TSCALE.length-1]}))>inner)
    inner=Math.max(2,w-2);
  clipTxt(label,x+w/2,midBase(y,h,fitStep(label,inner,q)),inner,q);
  return wd;
}
// while the pointer is over the track, the readout shows what a click WOULD
// set (amber); otherwise the value the plant actually has (cyan) - shared by
// the strip readout, the bench and the controller tunables so the preview
// behaviour can't exist on one and not the others
function sldRead(wd,fmt){
  return wd.pv!=null ? {s:fmt(wd.pv),col:C.amber} : {s:fmt(wd.val),col:C.cyan};
}

// o.th sizes the widget; o.tw is the GRAB zone, not a drawn width. o.fmt
// makes the slider draw its own readout, outside the track. The track is a
// bargraph (not seg()) because a rate-limited control has three things to
// say - where the plant IS, where it's headed, and where it is not.
function slider(x,y,w,val,min,max,o){
  o=o||{}; const th=o.th||22, tw_=o.tw||10;
  // every edge is rounded to whole layout units first: at th=13 the strip top
  // lands on a half unit, and a 1-unit serif across a half unit smears to 2
  const t0=Math.round(y-th/2), t1=Math.round(y+th/2), hh=t1-t0;
  // the readout stands OUTSIDE the track (an opaque plate ON an 84px strip
  // used to cover most of the bar); width is measured at both range ends and
  // the value, or the track would jiggle as digits come and go
  const ro={size:6.5};
  let rw = o.fmt ? Math.max(tw(o.fmt(min),ro),tw(o.fmt(max),ro),tw(o.fmt(val),ro))+5 : 0;
  if(w-rw<24) rw=0;                  // no room for both: the bar wins
  const tW=w-rw;
  // the widget is the TRACK, not the row - otherwise clicking the number
  // would slam the value to whatever the number's own x means
  // o.inert: a READING, not a control - it registers no widget at all, so it
  // cannot be hovered, previewed or dragged, and it wears C.ink2 throughout
  const wd = o.inert ? {x,w:tW,val,pv:null}
    : push({x,y:y-th/2-2,w:tW,h:th+4,type:"sld",min,max,fn:o.fn,
                 cy:y,val,tw_});     // cy/val/tw_ are what the drag handler needs
  // clamp t, or a value outside the range draws the indicator off its own
  // track. o.dem is what you asked for (may lag behind with a rate limit);
  // o.mark is a setpoint the slider is ALLOWED to cross.
  const t=clamp((val-min)/(max-min),0,1);
  wd.tx=x+t*tW;
  const dem = o.dem==null ? t : clamp((o.dem-min)/(max-min),0,1);
  // which side of the mark costs you is the caller's business: a ceiling is
  // red above it, a design floor is red below it - drawing every mark as a
  // ceiling would paint the whole safe half of an RCP bar red
  const lo_ = !!o.markLo;
  const mk  = o.mark==null ? (lo_?-1:2) : clamp((o.mark-min)/(max-min),0,1);
  const lo=Math.min(t,dem), hi=Math.max(t,dem), rising=dem>t;
  const viol = o.mark==null ? false : (lo_? t<mk   : t>mk);
  const violD= o.mark==null ? false : (lo_? dem<mk : dem>mk);
  // what a click here would set - only on the bare track, since pressing the
  // indicator itself grabs it, and a drag is geared so the pointer is not the
  // value once dragging (hov() already stands down for that). Converted
  // through ptIn() like any plant widget, or the preview hairline would land
  // wherever the raw PAGE pointer is, far from the track at fit scale.
  const pp = o.inert ? null : ptIn(wd,ui.ptr);
  /* THE PREVIEW HAS NO DEAD ZONE. It used to stand down within a thumb-width
     of the indicator, because pressing there GRABS instead of jumping - but
     that is exactly the neighbourhood a fine adjustment lives in, so the one
     place the bar refused to say what a click would set was the one place you
     were aiming at. Pressing the thumb still grabs; releasing without moving
     now lands the click (see uiUp), so the preview is honest again. */
  wd.pv = (pp && hov(wd)) ? valFrom(wd,pp.x) : null;
  const n=clamp(Math.round(tW/5),6,30), cw=tW/n;   // one cell per ~5px
  const bh=Math.min(10,th-3), by=Math.round(y-bh/2);
  for(let i=0;i<n;i++){
    // the mark is a limit, never an end of the scale - the wrong side draws
    // as a zone you can see before you're in it. Being IN it is separate from
    // a cell merely lying in it: a floor is where those two come apart (a bar
    // at 100% fills through the low end, which is every running pump, not a
    // fault) - so it's the VALUE crossing the mark that lights a cell.
    const c=(i+.5)/n, past=lo_? c<mk : c>mk;
    // an unlit cell is a dark slot (C.well), not the old #152125 grey, which
    // was close enough to the plinth a control strip sits on to wash out
    let col = past?"#240b08":C.well;                                          // not there
    if(c<=lo)      col = o.inert?"#2b3338":(past&&viol)?C.red:"#2f7d8c";      // there
    else if(c<=hi) col = (past&&(viol||violD))?"#5c2a1c"
                                              :(rising?"#5a4415":"#1d3a41");  // on its way
    fillRect(x+i*cw,by,cw-1.3,bh,col);
  }
  if(o.mark!=null) fillRect(Math.round(x+mk*tW),t0,1,hh,C.red);
  /* `marks` is a BAND the caller is telling you about, not a limit it will be
     scored against - the automatic rod controller's own travel band, drawn on
     the bank's own bar so "where may it go" is answered where the question is
     asked. Amber and half-lit: it is a fact about another hand on the same
     control, never a fault of yours, so it must not wear the red a violated
     mark does. */
  if(o.marks) for(const mv of o.marks){
    const f=clamp((mv-min)/(max-min),0,1);
    ctx.globalAlpha=.5; fillRect(Math.round(x+f*tW),t0,1,hh,C.amber); ctx.globalAlpha=1;
  }
  if(wd.pv!=null) fillRect(Math.round(pp.x),t0,1,hh,"#7a5a18");  // where a click lands
  // a hairline in a cut, not a plate - the old 10px thumb covered an eighth
  // of an 84px track; the cut keeps 1px of amber readable against a lit cell
  const cx=Math.round(clamp(x+t*tW,x+1,x+tW-1)), ind=o.inert?C.ink2:C.amber;
  fillRect(cx-1,t0,3,hh,C.bg);       // the cut, so 1 unit of amber survives a lit cell
  fillRect(cx,t0,1,hh,ind);          // the indicator itself
  fillRect(cx-2,t0,5,1,ind);         // serifs, 1 unit tall - they mark the ends, not the value
  fillRect(cx-2,t1-1,5,1,ind);
  // demand is an ORDER, not a position, so it rides above the track as a
  // caret with a 3-unit serif against the indicator's 5
  if(o.dem!=null && Math.abs(dem-t)>.002){
    const dx=Math.round(clamp(x+dem*tW,x+1,x+tW-1));
    fillRect(dx,t0,1,4,C.amber); fillRect(dx-1,t0,3,1,C.amber);
  }
  if(rw){ const r=sldRead(wd,o.fmt);
    txt(r.s,x+w,midBase(t0,hh,6.5),Object.assign({},ro,{align:"right",color:o.inert?C.ink2:r.col})); }
  // a one-cell component has no room for a track AND a number, so there it's
  // hover-only, standing in the half of the track the pointer isn't in
  else if(o.fmt && wd.pv!=null){
    const ps=o.fmt(wd.pv), lw=tw(ps,ro)+4, far=(pp.x-x)/tW>.5;
    const px=far ? x+1 : x+tW-lw-1;
    fillRect(px,t0,lw,hh,C.bg);
    txt(ps,px+lw/2,midBase(t0,hh,6.5),Object.assign({},ro,{align:"center",color:C.amber}));
  }
  return wd;
}
// the canvas covers layout y = TOPBAR_H..H, not 0..H: the HTML topbar owns the rest
function local(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(W/r.width),
          y:(e.clientY-r.top)*((H-TOPBAR_H)/r.height)+TOPBAR_H}; }
const valFrom=(w,x)=>w.min+clamp((x-w.x)/w.w,0,1)*(w.max-w.min);
// a control mounted inside a component is only as wide as the component (the
// rod bank gets 84px for a full 0..100% stroke), so the drag is relative and
// geared like a fader: pulling away from the track buys less travel per
// pixel. Grabbing the thumb never jumps the value; pressing bare track does.
const sldGain = dy => 1/(1+Math.max(0,Math.abs(dy)-24)/16);

const DBL_MS=400, DBL_PX=6;
let lastDown=null;
// MouseEvent.detail (click count) is never promised on a PointerEvent -
// Chromium happens to set it, nothing requires it to - so a double-click is
// detected here instead, off one clock/pointer, and stamped onto the event
// as `.dbl` so every call site reads one boolean instead of re-deriving it
function dblCheck(p,e){
  const now=performance.now();
  const dbl = !!lastDown && e.button===lastDown.button
    && now-lastDown.t<DBL_MS && Math.hypot(p.x-lastDown.x,p.y-lastDown.y)<DBL_PX;
  lastDown={t:now,x:p.x,y:p.y,button:e.button};
  return dbl;
}
/* SHIFT+RIGHT IS THE BROWSER'S MENU; a bare right click is ours. Bound to a
   NODE, not to #cv, because the plant is no longer the only thing standing
   over the plant: an open #ctxmenu is a real element, so a second right click
   landing on it never reached the canvas and the browser's own menu came up on
   top of ours. Anything that covers the plant has to say this. */
const ctxSuppress=el=>el&&el.addEventListener("contextmenu",e=>{ if(!e.shiftKey) e.preventDefault(); });
ctxSuppress(cv);
/* The three pointer handlers are named so uiForward() can bind them to a
   SECOND element. A widget hosted inside an opaque rail (the fuel lattice
   plan) sits over #cv but eats its events, so it has to feed the same
   hit-test loop itself - local() is measured off #cv either way, so the
   coordinates match the boxes hostPaint() let it push. */
function uiDown(e){
  const tgt=e.currentTarget||cv;
  tgt.setPointerCapture(e.pointerId);
  const p=uiPt(tgt,e); ui.ptr=p; ui.ptrHost=tgt._uiHost||null;
  e.dbl=dblCheck(p,e);
  ctxClose();
  // shift+right is the browser's own menu, not a pan; right held-and-dragged
  // pans, right pressed-and-released without moving opens the ADD/REMOVE menu
  // instead (see pointerup)
  if(e.button===2){
    const w=hitAt(p);
    /* RIGHT CLICK WITH THE PIPE TOOL LIFTS A CELL, where it lives rather than
       through the deck menu - the menu is addressed at a cell and this already
       is. HELD, it lifts every cell it is dragged over, the mirror of the left
       button laying them: taking a wrong run out one careful click at a time
       was the slowest gesture on the bench. A cell nothing owns is simply
       nothing to lift, and the drag stands whether or not the first one was. */
    if(screen==="design" && TOOL.active==="pipe" && vIn(p)){
      ui.drag={type:"pipeerase", v:1};
      pipeLift(vPt(p));
      return;
    }
    /* A PORT'S RIGHT CLICK ALWAYS OPENS THE MENU (REMOVE PORT,
       resolved by design-bench.js's own ctx registry) - there is no quick-tap
       toggle any more, so a right click never silently flips the mode. */
    if(w&&w.type==="port"){
      ui.drag={type:"portr"};
      return; }
    if(!e.shiftKey) ui.drag={type:"pan",lx:p.x,ly:p.y,sx:p.x,sy:p.y,moved:false};
    return; }
  isTouch = e.pointerType==="touch" || e.pointerType==="pen";
  if(isTouch){ const t=findTip(p);
    touchTip = t ? Object.assign({},t,{until:performance.now()+4000}) : null; }
  const w=hitAt(p);
  /* ══ A TOOL PRE-EMPTS EVERY CLICK ══
     With the pipe tool up, a press on the plant is about the pipe, never
     about whatever box it happens to land on - so this is asked before the
     ordinary per-widget dispatch below. Nothing is committed until the
     release, the same convention the part drag already keeps. */
  /* AN AIMED HIT PRE-EMPTS THE SAME WAY, and it goes through act() like every
     other input, so a tape and a scenario carry it. A control strip standing
     over the plant is not a target: the press is not spent on it, and the tool
     stays up for the machine the hand was aiming at. */
  if(screen==="operate" && TOOL.active==="hit" && vIn(p)){
    const aim=hitAimAt(vPt(p));
    if(!aim && w) return;
    TOOL.active="select";
    if(aim) act("hit",aim);
    return;
  }
  if(screen==="design" && TOOL.active==="pipe" && vIn(p)){
    const c=cellAt(vPt(p));
    // `had` is what turns a click on a cell that is ALREADY pipe into a
    // rotate rather than a lay - decided at the press, because the drag may
    // yet lay across it and the answer must not change under the hand.
    ui.drag={type:"pipedraw", cells:[c], v:1, had:!!D.pipes[pipeKey(c[0],c[1])]};
    return;
  }
  /* ══ A PIPE IS PICKED THE WAY A MACHINE IS ══
     A run has no widget in the hit list - it is a polyline, not a box - so it
     is resolved off the CELL under the pointer, the same answer pipeHovResolve()
     already gives the hover. It is tried only where nothing else was hit, so a
     machine or a port standing on the same cell still wins. The run KEY goes
     into `sel`: a key always contains a colon and a part id never does, so
     every partOf(sel) reader already answers null for one. */
  if(!w && screen==="design" && vIn(p) && typeof pipeCellRuns==="function"){
    const c=cellAt(vPt(p)), keys=pipeCellRuns(c[0],c[1]);
    if(keys.length){ sel=keys[keys.length-1]; return; }   // a crossing cell owns two: last wins, as hitAt() does
  }
  // nothing under the pointer: a click on bare deck deselects, rather than
  // leaving whatever was picked last lit with nothing on screen to justify it
  if(!w){ sel=null; return; }
  const q=ptIn(w,p);
    if(w.type==="part"){ sel=w.part.id;
      // a commissioned plant is welded down: selectable, not movable; a
      // pinned part rides its parent, so it's selectable but never draggable
      if(screen==="design" && !w.part.pin){ const g=gridPt([q.x,q.y]);
        ui.drag={type:"part",part:w.part,
          // WHERE IN THE PART THE HAND TOOK HOLD, in CELLS. It was a pixel
          // offset, and a pixel is not a fixed share of a row: a 1-row pump is
          // DRAWN 84 px tall in a banded row, so a grab near its plinth stored
          // ~80 px and, carried into the 46 px row above, put the part's top
          // nearly two rows clear of the hand. In cells the grab is bounded by
          // the part's own size and the same spot stays under the pointer.
          ox:g.x-w.part.x, oy:g.y-w.part.y,
          sx:w.part.x, sy:w.part.y, gx:w.part.x, gy:w.part.y, v:w.v}; } }
    else if(w.type==="sld"){ ui.drag=w;
      const onThumb=Math.abs(q.x-w.tx)<=w.tw_/2+3;
      w.gv = onThumb ? w.val : valFrom(w,q.x);    // gv is the running command value
      w.gx = q.x; w.gx0 = q.x; w.moved = false;
      if(!onThumb) w.fn(w.gv); }
    else if(w.type==="btn"){ w.fn&&w.fn(); }
    // A PORT IS A TOGGLE: click the mark to take it away again. Its mark is
    // pushed after its own box, so it takes the press before a part drag can.
    else if(w.type==="port"){ removePort(w.pid); }
    // ...and on a COMMISSIONED plant the same cell is the valve inside that
    // nozzle. Nothing is placed or taken away in the control room: the plant is
    // welded down, so all a port has left to offer is its own handle.
    else if(w.type==="portv"){ act("portShut",w.pid); }
    // ...and the ghost places one. There is nothing to follow it with: a pipe
    // is laid with the pipe tool, cell by cell.
    else if(w.type==="ghostport"){ addPortAt(w.p,w.dx,w.dy); buildLayout(); }
    /* the hull's own wall. NOTHING COMMITS UNTIL THE RELEASE: gridDrag() calls
       buildLayout(), which at pointer rate re-laid the whole board for every
       cell crossed. The wall wears a ghost outline while it moves (drawPlant). */
    else if(w.type==="hull") ui.drag={type:"hull",edge:w.edge,v:w.v,gw:D.gw,gh:D.gh};
  else if(w.type==="paint"){ ui.drag=w; w.last=null; w.fn(q,e); }
}
/* WHERE THE GESTURE IS, ASKED ONCE. A part drag is a MOVE now and only a
   move - GEOMETRY IS DRAGGED, TYPE IS MENUED means the box-to-box pipe gone,
   the same box drag is unambiguous whatever it lands on. The release used to
   inherit whatever the last pointermove had decided; a release carries no
   move of its own, so the drop is measured here rather than trusted to have
   been measured already. */
function partDragTo(d,q){
  const g=gridPt([q.x,q.y]);
  // THE PART'S TOP-LEFT UNDER THE HAND, SNAPPED, AND ALL OF IT IN CELLS - so
  // the same spot stays under the pointer whatever the part's size
  d.gx=Math.round(g.x-d.ox); d.gy=Math.round(g.y-d.oy);
}
function uiMove(e){
  const tgt=e.currentTarget||cv;
  const p=uiPt(tgt,e); ui.ptr=p; ui.ptrHost=tgt._uiHost||null;
  if(e.pointerType==="mouse") isTouch=false;
  if(ui.drag){ const d=ui.drag, q=d.v?vPt(p):p;
    /* NOTHING IS COMMITTED UNTIL THE RELEASE. moveTo() used to be called on
       every pointermove, which re-measured layoutMetrics() at pointer rate
       and - now that the same drag can end as a pipe - would have walked the
       part across the board on the way to the machine you were aiming at. */
    if(d.type==="part") partDragTo(d,q);
    /* THE RUN FOLLOWS THE DRAG, cell by cell: every cell between the last one
       committed and the pointer joins the list, walking one axis at a time, so
       the pipe turns where the drag turns. Only the list is built here -
       pipeLay() runs on release, because nothing is committed until then. */
    else if(d.type==="pipedraw"){
      const c=cellAt(q), last=d.cells[d.cells.length-1];
      if(!cellSame(c,last) && c[0]>=0 && c[1]>=0 && c[0]<GW && c[1]<GH){
        let [x,y]=last;
        while(x!==c[0]){ x+=Math.sign(c[0]-x); d.cells.push([x,y]); }
        while(y!==c[1]){ y+=Math.sign(c[1]-y); d.cells.push([x,y]); }
      } }
    else if(d.type==="hull"){ const c=cellAt(q);
      if(c){ d.c=c; [d.gw,d.gh]=gridClamp(d.edge==="r"?c[0]+1:D.gw, d.edge==="b"?c[1]+1:D.gh); } }
    else if(d.type==="pipeerase") pipeLift(q);
    else if(d.type==="paint"){ d.fn(q,e); }
    else if(d.type==="sld"){
      // integrate rather than re-derive, so moving away from the track
      // changes the gearing from here on instead of jumping the value.
      // ORDERED bounds: a scale is allowed to run backwards (boron is 0 at the
      // left and -6000 at the right), and clamp() is max(a,min(b,v)), so
      // handing it min>max pins every value to the low end. Everything else in
      // slider() is (v-min)/(max-min) and reverses on its own.
      const lo=Math.min(d.min,d.max), hi=Math.max(d.min,d.max);
      d.gv=clamp(d.gv+(q.x-d.gx)/d.w*(d.max-d.min)*sldGain(q.y-d.cy),lo,hi);
      if(q.x!==d.gx0) d.moved=true;
      d.gx=q.x; d.fn(d.gv); }
    // the pan is measured in PAGE pixels and spent in plant units, so the
    // deck keeps up with the hand at any zoom
    else if(d.type==="pan"){
      VIEW.ox-=(p.x-d.lx)/VIEW.s; VIEW.oy-=(p.y-d.ly)/VIEW.s;
      d.lx=p.x; d.ly=p.y;
      // a page-pixel threshold (not plant), so it feels the same at any zoom
      if(Math.hypot(p.x-d.sx,p.y-d.sy)>4) d.moved=true; }
  }
  (e.currentTarget||cv).style.cursor = ui.drag&&(ui.drag.type==="pan"||ui.drag.type==="pipewp"||ui.drag.type==="tap"||ui.drag.type==="part") ? "grabbing"
    : ui.prev.some(w=>inside(w,ptIn(w,p))) ? "pointer" : "default";
}
function uiUp(e){
  const d=ui.drag;
  /* A PRESS THAT NEVER MOVED IS A CLICK, even on the indicator. Pressing the
     thumb grabs it so a drag can be geared, and that grab used to swallow the
     press outright - so on a 48-unit bar carrying 0..100% there was a whole
     neighbourhood around the current value that could not be typed at all:
     standing at 40%, the click that means 41% landed on the thumb and did
     nothing. Releasing without moving now lands where it was pressed. */
  if(d&&d.type==="sld"&&!d.moved) d.fn(valFrom(d,d.gx0));
  // right button held and released without dragging the plant is a click,
  // which on the design bench opens the ADD/REMOVE menu
  if(d&&d.type==="pan"&&!d.moved&&e.button===2) openCtxMenu(local(e),e);
  // A PORT'S RIGHT CLICK ALWAYS OPENS THE MENU, dragged or not - see uiDown().
  if(d&&d.type==="portr"&&e.button===2) openCtxMenu(local(e),e);
  /* WHERE THE MOVE COMMITS. moveTo() is still the only way a part changes
     position - it is just called once, here, instead of at pointer rate. A
     drop that resolves to nothing (off the grid, on top of another machine)
     is a cancel, not an error, so there is no refusal to report. */
  /* THE RUN COMMITS ON RELEASE. `from` and `to` are the cells either side of
     the drag, so the first and last cell open toward where the hand started
     and stopped rather than being left as a stub with one end. */
  if(d&&d.type==="pipedraw"){
    const c=d.cells;
    // A CLICK ON A CELL THAT IS ALREADY PIPE TURNS IT. The wheel does the same
    // thing, and a wheel is not a gesture every hand reaches for - a cell
    // pointing the wrong way is the commonest reason a run does not join, so
    // the fix is on the button the player is already holding.
    if(c.length===1 && d.had) pipeTurn(c[0][0],c[0][1],1);
    else if(c.length===1) pipeLay(c, [c[0][0]-1,c[0][1]], [c[0][0]+1,c[0][1]]);
    else pipeLay(c, [2*c[0][0]-c[1][0], 2*c[0][1]-c[1][1]],
                    [2*c[c.length-1][0]-c[c.length-2][0], 2*c[c.length-1][1]-c[c.length-2][1]]);
    buildLayout();
  }
  if(d&&d.type==="part"){
    const p=uiPt(e.currentTarget||cv,e);
    // ...but only off a point the plant actually covers. The press took the
    // pointer capture, so a release over a docked rail is still delivered here
    // and vPt() extrapolates it happily - the part landed somewhere nobody had
    // aimed at. Out of view, the last in-view sample stands, which is the cell
    // the ghost was last drawn on.
    if(!d.v || vIn(p)) partDragTo(d, d.v?vPt(p):p);
    if(d.gx!==d.sx||d.gy!==d.sy) moveTo(d.part,d.gx,d.gy);
  }
  // THE WALL COMMITS ON RELEASE - one buildLayout() for the whole gesture
  if(d&&d.type==="hull"&&d.c) gridDrag(d.edge,d.c);
  ui.drag=null;
}
/* the page canvas measures in layout units off local(); a hosted widget hands
   uiForward() its own converter, because its box is its own space */
function uiPt(el,e){ return el._uiLocal? el._uiLocal(e) : local(e); }
/* Leaving the surface stands the POINTER down as well as the drag. It only
   stood the drag down, so the page canvas kept the last point the pointer was
   measured at forever - and findTip() is a pure function of that point, so the
   canvas tooltip went on describing whatever the hand had last passed over
   while the hand was somewhere else entirely. */
/* ══ THE FRAME LOOP IS EVENT-DRIVEN, AND THE EVENT IS "A HAND MOVED" ══
   Nothing on the bench animates itself: every fx rate resolves to 0 without a
   live plant, and no dashed line offsets. So a still hand means an identical
   picture, sixty times a second, and the loop can simply not paint it.
   What may NOT be done is enumerate the paths that change the drawing - a
   rail slider, the lattice pen, a layer switch and a context menu all write
   outside act(), and a list of them is a list that rots. Any raw input
   anywhere marks the canvas instead, in the CAPTURE phase so a handler that
   stops propagation cannot also stop the repaint. main.js owns the floor that
   covers whatever this still misses. */
/* A HAND IS A CONTINUUM, NOT A SET OF INSTANTS, so an input does not buy one
   frame - it keeps the loop awake for UI_TRAIL of them. Painting only the
   frames an event landed in makes the interval between paints as ragged as
   the event stream is, and a hover ink that changes on a ragged interval
   shimmers even though every frame drawn is correct. A trail is also the
   honest reading of the gate: the loop idles when the PLAYER is idle, not
   between one twitch of a mouse and the next.
   A live drag never idles either. uiDown() takes a pointer CAPTURE, so a
   moving hand is not a page-wide event the listener below can be trusted to
   see. Asked here because whether a gesture is in flight is ui's own business. */
const UI_TRAIL=12;                 // frames, ~200 ms
let uiWants=true, uiTrail=0;
const uiDirty=()=>{ uiWants=true; uiTrail=UI_TRAIL; };
const uiTakeDirty=()=>{
  const w=uiWants||uiTrail>0||!!ui.drag;
  uiWants=false; if(uiTrail>0) uiTrail--;
  return w;
};
if(typeof document!=="undefined" && document.addEventListener)
  for(const ev of ["pointerdown","pointermove","pointerup","pointercancel","wheel","keydown","focusin","scroll"])
    document.addEventListener(ev,uiDirty,{capture:true,passive:true});

function uiBind(el){
  /* MARKED AT THE HANDLER THAT MOVES THE PICTURE, not only at the document.
     These three write ui.ptr and ui.drag, which is what the canvas draws from,
     so a repaint owed to a hand cannot be lost to a retargeted event. */
  el.addEventListener("pointerdown",uiDirty);
  el.addEventListener("pointermove",uiDirty);
  el.addEventListener("pointerup",uiDirty);
  el.addEventListener("pointerdown",uiDown);
  el.addEventListener("pointermove",uiMove);
  el.addEventListener("pointerup",uiUp);
  // A LEAVE IS NOT A CANCEL WHILE A HAND IS DOWN: the capture keeps delivering,
  // but Chrome fires pointerleave on the boundary, killing any drag that crossed
  // its own box - the lattice pens and the section's LENGTH drag, every time
  el.addEventListener("pointercancel",()=>{ui.drag=null; ui.ptr={x:-1e4,y:-1e4}; ui.ptrHost=null; uiDirty();});
  el.addEventListener("pointerleave",()=>{ if(ui.drag) return;
    ui.ptr={x:-1e4,y:-1e4}; ui.ptrHost=null; uiDirty(); });
}
uiBind(cv);
function uiForward(el,toLocal){
  el._uiHost=el; el._uiLocal=toLocal;
  uiBind(el);
}
cv.addEventListener("wheel",e=>{
  // the scenario bench draws no plant, so there's no VIEW to zoom here -
  // the wheel zooms the TIMELINE instead, about the second under the pointer
  if(screen==="scenario"){ e.preventDefault(); scnWheel(local(e),e.deltaY); return; }
  const p=local(e);
  e.preventDefault();
  // the box is anchored to where the pointer WAS; the plant moves under it, so
  // an open menu is stale the moment the view does anything
  ctxClose();
  /* THE WHEEL ROTATES A PIPE CELL, and only there: with the pipe tool up and a
     cell actually under the pointer. Everywhere else it still zooms, which is
     what it does on every other screen and in every other tool. */
  if(screen==="design" && TOOL.active==="pipe" && vIn(p)){
    const c=cellAt(vPt(p));
    if(pipeTurn(c[0],c[1],e.deltaY>0?1:-1)){ buildLayout(); return; }
  }
  // anywhere on the canvas, not just over the plant - the page doesn't
  // scroll any more, so there's nothing else for the wheel to do. Holds the
  // plant point under the pointer still (or the middle, off-plant).
  const on=vIn(p);
  const px=on? p.x : VIEW.x+VIEW.w/2, py=on? p.y : VIEW.y+VIEW.h/2;
  const a=vPt({x:px,y:py});          // the plant point to hold still, at the OLD scale
  VIEW.z=VIEW.z*Math.exp(-e.deltaY*0.0015);
  VIEW.s=VIEW.fit*VIEW.z;
  vAnchor(a,px,py);
},{passive:false});
