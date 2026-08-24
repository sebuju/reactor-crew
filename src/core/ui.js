"use strict";
/* immediate-mode widget list, hit testing, tooltips */

/* ═══════════════ immediate-mode UI ═══════════════ */
const ui={widgets:[],prev:[],tips:[],drag:null,ptr:{x:-9,y:-9}};

/* ═══════════════ THE PLANT VIEW TRANSFORM ═══════════════
   The plant is drawn into a viewport you can pan and zoom, so a widget pushed
   while that view is up lives in PLANT coordinates while the pointer arriving
   from the DOM lives in PAGE coordinates. Exactly one of those two is allowed
   to move, and it is the POINTER: the hit test converts it on the way in and a
   widget's own numbers are never touched. Storing page coordinates in the
   widget instead puts two spaces inside one object, and the slider strips
   mounted on the components would then draw their thumb in one and hit-test it
   in the other.

   The pan is an OFFSET into the viewport, not an absolute plant point, because
   the plant sits at a different y on the two screens and an absolute point
   would mean something different the moment you commissioned.

   At s=1 the whole thing is the identity, which is why every geometry audit
   still measures the plant exactly where it always was. It cannot be
   initialised from GX and CELL up here: layout.js loads after this file. */
/* Zoom is a MULTIPLE OF FIT, never an absolute scale. The page is the window
   now, so the room the plant gets depends on the window and changes under you;
   an absolute scale would mean "twice life size" on one monitor and "the whole
   plant" on another, and a resize would silently change how much you could see.
   VIEW.z is what the player sets, 1 = everything visible, and VIEW.s is what
   the frame works out from it. */
const VMAX=3;
const VIEW={z:1,s:1,fit:1,ox:0,oy:0,x:12,y:0,w:736,h:0,cx:12,cy:0,cw:736,ch:0};
let viewOn=false;                       // are widgets being pushed through it?
const vPt=p=>({x:VIEW.cx+VIEW.ox+(p.x-VIEW.x)/VIEW.s,
               y:VIEW.cy+VIEW.oy+(p.y-VIEW.y)/VIEW.s});
const vScr=p=>({x:VIEW.x+(p.x-VIEW.cx-VIEW.ox)*VIEW.s,
                y:VIEW.y+(p.y-VIEW.cy-VIEW.oy)*VIEW.s});
const vIn=p=>p.x>=VIEW.x&&p.x<=VIEW.x+VIEW.w&&p.y>=VIEW.y&&p.y<=VIEW.y+VIEW.h;
/* The viewport, and the plant that has to go in it. Called once a frame before
   anything is drawn through the view. Anything smaller than its viewport is
   CENTRED rather than pinned to a corner - a small plant on a big screen sat in
   the top left with the room stacked to one side of it. */
/* The CONTENT is the whole drawing - the grid and every plate standing beside
   it - and it starts wherever that drawing starts, which is left of the grid. */
function vFit(x,y,w,h,cx,cy,cw,ch){
  VIEW.x=x; VIEW.y=y; VIEW.w=w; VIEW.h=h;
  VIEW.cx=cx; VIEW.cy=cy; VIEW.cw=cw; VIEW.ch=ch;
  VIEW.fit=Math.min(w/Math.max(cw,1), h/Math.max(ch,1));
  VIEW.z=clamp(VIEW.z,1,VMAX);
  VIEW.s=VIEW.fit*VIEW.z;
  vClamp();
}
/* You can drag the plant PAST its own edges. The first version pinned it so
   the grid could never leave the viewport, which meant that at fit scale - the
   scale you are at most of the time - the plant simply would not move at all.
   The limit now is half a screen of overscan in each direction: far enough to
   put any corner of the plant wherever you want it, near enough that you cannot
   throw the whole thing off and lose it. */
function vClamp(){
  const ww=VIEW.w/VIEW.s, hh=VIEW.h/VIEW.s, mx=ww*0.5, my=hh*0.5;
  VIEW.ox=clamp(VIEW.ox,-mx,Math.max(-mx,VIEW.cw-ww+mx));
  VIEW.oy=clamp(VIEW.oy,-my,Math.max(-my,VIEW.ch-hh+my));
}
/* zoom about a plant point - the wheel holds the point under the pointer, the
   key centres on the component you have selected */
function vZoom(z,cx,cy){
  VIEW.z=clamp(z,1,VMAX); VIEW.s=VIEW.fit*VIEW.z;
  VIEW.ox=(cx-VIEW.cx)-VIEW.w/2/VIEW.s;
  VIEW.oy=(cy-VIEW.cy)-VIEW.h/2/VIEW.s;
  vClamp();
}
/* ═══════════════ OVERLAYS ═══════════════
   The page is exactly the window now, so everything that used to be stacked
   below the plant has nowhere left to be. It is drawn OVER the plant instead,
   out of one registry: a key in the bar along the bottom opens it, the same key
   closes it, and only one is ever up.

   The panels themselves did not have to change. The overlay is the same
   736-wide content column they were already drawing into, so each one is still
   the function it always was, handed a y.

   Sparing with edges, like the rest of this UI: the plant behind is dimmed
   rather than hidden - you are still operating the thing you are reading about
   - and the panel is a tone step with a single accent along its top. No frame,
   no drop shadow, nothing drawn twice. */
const OVL=[];
let ovlOpen=null;
const ovlAdd=o=>{ OVL.push(o); return o; };
const ovlList=()=>OVL.filter(o=>!o.sc||o.sc===screen);
const ovlFor=k=>ovlList().find(o=>o.k===k);
function ovlToggle(k){ ovlOpen = ovlOpen===k ? null : k; }
function drawOverlay(){
  if(!ovlOpen) return;
  const o=ovlFor(ovlOpen); if(!o) return;
  const h=Math.min(typeof o.h==="function"?o.h():o.h, VIEW.h-10), y=VIEW.y+VIEW.h-h;
  fillRect(VIEW.x,VIEW.y,VIEW.w,VIEW.h,"rgba(6,10,11,.62)");
  fillRect(12,y,736,h,C.panel);
  accent(12,y,736,C.amber);
  /* a catcher, pushed BEFORE the panel's own widgets so they still win inside
     it: a click on bare overlay must not reach the component behind it */
  push({x:12,y,w:736,h,type:"btn"});
  o.draw(y);
}
/* the bar along the very bottom: what just happened on the left, the keys that
   open the panels on the right */
function ovlBar(y,h,note){
  fillRect(0,y,W,h,C.panel); fillRect(0,y,W,1,C.edge);
  let x=W-12;
  const L=ovlList();
  for(let i=L.length-1;i>=0;i--){ const o=L[i];
    const kw=tw(o.label,{size:7,sp:1,caps:1})+14;
    x-=kw;
    button(x,y+3,kw,h-6,o.label,
      {sunk:1,on:ovlOpen===o.k,size:7,sp:1,fn:()=>ovlToggle(o.k)});
    TIP(x,y+3,kw,h-6,o.label,o.tip);
    x-=4;
  }
  if(note) fitTxt(note,12,midBase(y,h,8),x-20,{size:8,color:C.ink2});
}

/* The pointer in the space this widget was pushed in - or nothing at all when
   it is a plant widget and the pointer is outside the viewport, because a
   component panned under the panel below must stop being clickable. */
const ptIn=(w,p)=>w.v ? (vIn(p)? vPt(p) : null) : p;

const push=w=>{ if(viewOn) w.v=1; ui.widgets.push(w); return w; };
const inside=(w,p)=>!!p&&p.x>=w.x&&p.x<=w.x+w.w&&p.y>=w.y&&p.y<=w.y+w.h;
const hov=w=>inside(w,ptIn(w,ui.ptr))&&!ui.drag;

/* ─────────────── tooltips ─────────────── */
let touchTip=null, isTouch=false;
/* g is an optional band(): the scale the value in this region lives on. A
   tooltip that only says a number is fine is asking to be believed; one that
   draws where the number sits between its limits can be checked at a glance. */
function TIP(x,y,w,h,title,body,g){ ui.tips.push({x,y,w,h,title,body,g,v:viewOn?1:0}); }
function findTip(p){
  for(let i=ui.tips.length-1;i>=0;i--){ const t=ui.tips[i];
    const q=ptIn(t,p); if(!q) continue;
    if(q.x>=t.x&&q.x<=t.x+t.w&&q.y>=t.y&&q.y<=t.y+t.h) return t; }
  return null;
}
function drawTip(){
  if(ui.drag) return;
  let t=null;
  if(isTouch){ if(touchTip && performance.now()<touchTip.until) t=touchTip; }
  else t=findTip(ui.ptr);
  if(!t) return;
  const maxw=248, ob={size:8.5,color:C.ink};
  const n=wrapCount(t.body,maxw,ob), bw=maxw+20, bh=23+n*11+(t.g?BAND_H:0);
  /* a touch anchors the box on the thing it describes, so a plant tip has to
     come back out of plant space to say where that is */
  const an = t.v ? vScr({x:t.x+t.w/2,y:t.y+t.h}) : {x:t.x+t.w/2,y:t.y+t.h};
  const ax = isTouch ? an.x : ui.ptr.x, ay = isTouch ? an.y : ui.ptr.y;
  let bx=clamp(ax+16,6,W-bw-6), by=ay+18;
  if(by+bh>H-6) by=Math.max(46,ay-bh-14);
  fillRect(bx+3,by+3,bw,bh,"rgba(0,0,0,.6)");
  fillRect(bx,by,bw,bh,"#0b1215"); frame(bx,by,bw,bh,C.amber);
  accent(bx,by,bw,C.amber); ticks(bx+.5,by+.5,bw-1,bh-1,C.amber,5);
  txt(t.title,bx+11,by+13,{size:8,weight:700,sp:1.3,caps:1,color:C.amber});
  wrap(t.body,bx+11,by+26,maxw,11,ob);
  if(t.g){
    /* The verdict and the setpoint ride on the TITLE row rather than under the
       strip. They are two more short strings and the strip already carries
       three; put them below it and the tooltip grows a line to say what its own
       colours were saying. */
    const z=bandZone(t.g); let rx=bx+bw-11;
    if(t.g.lim) for(const L of t.g.lim){
      const s_=L[1]+" "+L[0].toFixed(t.g.dp);
      txt(s_,rx,by+13,{size:6.5,sp:.7,align:"right",color:C.red});
      rx-=tw(s_,{size:6.5,sp:.7})+7;
    }
    txt(z[2],rx,by+13,{size:6.5,sp:.9,align:"right",color:z[1]});
    bandBar(bx+11,by+bh-BAND_H+8,maxw,t.g);
  }
}

function button(x,y,w,h,label,o){
  o=o||{}; const wd=push({x,y,w,h,type:"btn",fn:o.fn});
  const h_=hov(wd);
  const col = o.danger ? C.red : o.on ? C.amber : (h_?C.edge2:C.edge);
  /* o.sunk is a key set INTO a lighter base, so it needs no border: it is already
     a darker block against a lighter plinth, and the shape reads from the tone
     step alone. Boxing it as well put a line round every one of a dozen keys in
     a 46px component - the plant view read as a cage. Tone does the job, so the
     frame and the corner ticks come off, and hover lifts the whole key instead
     of brightening a hairline nobody was looking at. */
  const base = o.sunk?C.well:C.panel, lift = o.sunk?C.panel:C.panelHi;
  /* Danger is the one state drawn SOLID, dark text on full red, the way a lit
     annunciator tile is. It used to be red text on a near-black block, which was
     the quietest thing on a panel once the borders came off - and SCRAM is the
     one key that must never be found by reading it. There are exactly two:
     SCRAM and the one-shot boron dump. Both should stop your hand. */
  fillRect(x,y,w,h, o.danger?(h_?"#ff7d6c":C.red):(o.on?"#2a1f08":(h_?lift:base)));
  if(!o.sunk){
    frame(x,y,w,h,col);
    if(o.on) ticks(x+.5,y+.5,w-1,h-1,col,4);
  }
  txt(label,x+w/2,midBase(y,h,o.size||9),{size:o.size||9,weight:o.danger?700:o.weight,
      sp:o.sp===undefined?1.6:o.sp,caps:1,align:"center",
      color:o.danger?"#160404":o.on?C.amber:(h_?C.bright:C.ink)});
  return wd;
}
/* One rule for every readout attached to a slider: while the pointer is over the
   track it shows what a click WOULD set, in amber; otherwise the value the plant
   actually has, in cyan. Three callers share it - the strip readout below, the
   bench and the controller tunables - so the preview cannot exist on one and not
   the others. */
function sldRead(wd,fmt){
  return wd.pv!=null ? {s:fmt(wd.pv),col:C.amber} : {s:fmt(wd.val),col:C.cyan};
}

/* o.th sizes the widget; o.tw is the GRAB zone, not a drawn width - the indicator
   is a hairline either way, so the thing you aim at stays wider than the thing you
   see. o.fmt makes the slider draw its own readout, OUTSIDE the track.

   The track is a bargraph, because every other bar on this plant is one. seg()
   cannot draw it: a rate-limited control has THREE things to say, not two -
   where the plant IS, where it is on its WAY to, and where it is not. */
function slider(x,y,w,val,min,max,o){
  o=o||{}; const th=o.th||22, tw_=o.tw||10;
  /* Every edge of the indicator is rounded to whole layout units before it is
     drawn. At th=13 the top of the strip lands on a half unit, and a 1-unit
     serif drawn across a half unit is a 2-unit smear - which is what made the
     indicator read as blunt and slightly lopsided. */
  const t0=Math.round(y-th/2), t1=Math.round(y+th/2), hh=t1-t0;
  /* The readout stands OUTSIDE the track. It used to be an opaque plate ON it,
     and on an 84px strip it covered most of the bar it was labelling. The track
     gives up the room instead. Width is measured at both ends of the range as
     well as at the value, or the track would jiggle as digits come and go. */
  const ro={size:6.5};
  let rw = o.fmt ? Math.max(tw(o.fmt(min),ro),tw(o.fmt(max),ro),tw(o.fmt(val),ro))+5 : 0;
  if(w-rw<24) rw=0;                  // no room for both: the bar wins
  const tW=w-rw;
  /* the widget is the TRACK, not the row - otherwise clicking the number would
     slam the value to whatever the number's own x means */
  const wd=push({x,y:y-th/2-2,w:tW,h:th+4,type:"sld",min,max,fn:o.fn,
                 cy:y,val,tw_});     // cy/val/tw_ are what the drag handler needs
  /* clamp t, or a value outside the range draws the indicator off its own track.
     o.dem is what you asked for: with a rate limit the plant is not there yet.
     o.mark is a setpoint the slider is ALLOWED to cross - crossing it costs
     something, and it is drawn so it is never a surprise. */
  const t=clamp((val-min)/(max-min),0,1);
  wd.tx=x+t*tW;
  const dem = o.dem==null ? t : clamp((o.dem-min)/(max-min),0,1);
  /* Which SIDE of the mark costs you is the caller's business. A ceiling is red
     above it; the pumps' design floor is red BELOW it, and drawing every mark as
     a ceiling painted the whole safe half of an RCP bar red. Out-of-range
     defaults sit off the end of the track on the harmless side. */
  const lo_ = !!o.markLo;
  const mk  = o.mark==null ? (lo_?-1:2) : clamp((o.mark-min)/(max-min),0,1);
  const lo=Math.min(t,dem), hi=Math.max(t,dem), rising=dem>t;
  /* has the plant crossed the mark, and has the order crossed it */
  const viol = o.mark==null ? false : (lo_? t<mk   : t>mk);
  const violD= o.mark==null ? false : (lo_? dem<mk : dem>mk);
  /* What a click here would set. Only on the bare track: pressing the indicator
     itself grabs it and changes nothing, and a DRAG is geared, so the pointer is
     not the value once you are dragging - hov() already stands down for that. */
  /* The pointer arrives in PAGE units and this widget's geometry may be in
     PLANT units, so it is converted the same way the hit test converts it -
     ptIn() is null when the pointer is outside the viewport entirely. Reading
     ui.ptr raw put the readout's number and the click-preview hairline
     wherever the PAGE said, which at fit scale is a long way from the track:
     hov() said the pointer was on the slider and valFrom() then clamped the
     page x to the far end of it. */
  const pp = ptIn(wd,ui.ptr);
  wd.pv = (pp && hov(wd) && Math.abs(pp.x-wd.tx)>tw_/2+3) ? valFrom(wd,pp.x) : null;
  /* one cell per ~5px: an 84px strip gets 17, a 240px bench gets 30 */
  const n=clamp(Math.round(tW/5),6,30), cw=tW/n;
  const bh=Math.min(10,th-3), by=Math.round(y-bh/2);
  for(let i=0;i<n;i++){
    /* A scale does not END at its limit, it is only MARKED there - the same rule
       pipeDial() follows - so the wrong side of the mark is drawn as a zone you
       can see before you are in it.
       Being IN it is a separate question from a cell merely lying in it, and a
       floor is where the two come apart: a bar at 100% fills straight through the
       low end, so "lit and below the floor" is every running pump, not a fault.
       The violation is the VALUE crossing the mark, so that is what lights it. */
    const c=(i+.5)/n, past=lo_? c<mk : c>mk;
    /* An unlit cell is a dark slot, not a grey one. It used to be #152125, which
       is within a shade of the plinth a control strip sits on, so the bar washed
       out into its own base. C.well is what everything recessed on this panel is
       cut back to - the sunk keys beside it use the same tone. */
    let col = past?"#240b08":C.well;                                          // not there
    if(c<=lo)      col = (past&&viol)?C.red:"#2f7d8c";                        // there
    else if(c<=hi) col = (past&&(viol||violD))?"#5c2a1c"
                                              :(rising?"#5a4415":"#1d3a41");  // on its way
    fillRect(x+i*cw,by,cw-1.3,bh,col);
  }
  if(o.mark!=null) fillRect(Math.round(x+mk*tW),t0,1,hh,C.red);
  if(wd.pv!=null) fillRect(Math.round(pp.x),t0,1,hh,"#7a5a18");  // where a click lands
  /* A hairline in a cut, not a plate. The old 10px thumb covered an eighth of an
     84px track and the readout had to dodge it; the cut is what keeps 1px of
     amber readable against a lit cell. */
  const cx=Math.round(clamp(x+t*tW,x+1,x+tW-1));
  fillRect(cx-1,t0,3,hh,C.bg);       // the cut, so 1 unit of amber survives a lit cell
  fillRect(cx,t0,1,hh,C.amber);      // the indicator itself
  fillRect(cx-2,t0,5,1,C.amber);     // serifs, 1 unit tall - they mark the ends, not the value
  fillRect(cx-2,t1-1,5,1,C.amber);
  /* demand is an ORDER, not a position, so it rides above the track as a caret.
     Its serif is 3 units against the indicator's 5, or the two read the same. */
  if(o.dem!=null && Math.abs(dem-t)>.002){
    const dx=Math.round(clamp(x+dem*tW,x+1,x+tW-1));
    fillRect(dx,t0,1,4,C.amber); fillRect(dx-1,t0,3,1,C.amber);
  }
  if(rw){ const r=sldRead(wd,o.fmt);
    txt(r.s,x+w,midBase(t0,hh,6.5),Object.assign({},ro,{align:"right",color:r.col})); }
  /* A one-cell component - an RCP - has no room for a track AND a number, so
     there it is hover-only: nothing covers the bar until you are pointing at it,
     and then the number you want is the one under the pointer anyway. It stands
     in the half of the track the pointer is not in, so it never hides its own
     click target. */
  else if(o.fmt && wd.pv!=null){
    const ps=o.fmt(wd.pv), lw=tw(ps,ro)+4, far=(pp.x-x)/tW>.5;
    const px=far ? x+1 : x+tW-lw-1;
    fillRect(px,t0,lw,hh,C.bg);
    txt(ps,px+lw/2,midBase(t0,hh,6.5),Object.assign({},ro,{align:"center",color:C.amber}));
  }
  return wd;
}
function local(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(H/r.height)}; }
const valFrom=(w,x)=>w.min+clamp((x-w.x)/w.w,0,1)*(w.max-w.min);
/* A control mounted inside a component is only as wide as the component, and the
   rod bank gets 84px for a full 0..100% stroke. So the drag is relative and
   geared: pull away from the track and the same hand movement buys less travel,
   the way a fader does. Grabbing the thumb never jumps the value; pressing the
   bare track still does, because that is how you get somewhere fast. */
const sldGain = dy => 1/(1+Math.max(0,Math.abs(dy)-24)/16);

/* The plant is dragged with the RIGHT button and worked with the left, so
   there is no bare deck to find and no gesture that means two things. The
   browser menu on that button would land on top of the plant, so it goes -
   EXCEPT on shift, which is the escape hatch every browser gives you for
   exactly this. Hold shift and the real menu comes back, with inspect and
   save-image on it. */
cv.addEventListener("contextmenu",e=>{ if(!e.shiftKey) e.preventDefault(); });
cv.addEventListener("pointerdown",e=>{
  cv.setPointerCapture(e.pointerId); const p=local(e); ui.ptr=p;
  /* shift+right is the browser's menu, not a pan - taking the drag as well
     would leave the plant sliding about under an open menu */
  if(e.button===2){ if(!e.shiftKey) ui.drag={type:"pan",lx:p.x,ly:p.y};   /* at any zoom, from anywhere */
    return; }
  isTouch = e.pointerType==="touch" || e.pointerType==="pen";
  if(isTouch){ const t=findTip(p);
    touchTip = t ? Object.assign({},t,{until:performance.now()+4000}) : null; }
  for(let i=ui.prev.length-1;i>=0;i--){ const w=ui.prev[i];
    const q=ptIn(w,p); if(!inside(w,q)) continue;
    if(w.type==="part"){ sel=w.part.id;
      /* a commissioned plant is welded down - you may select a component, not move it,
         and a pinned part rides its parent, so it is selectable but never draggable */
      /* rows carry control bands on both screens now, so a row is not CELL tall
         and the grab offset has to be measured against rowTop(), not against
         y*CELL - columns are still uniform */
      if(screen==="design" && !w.part.pin) ui.drag={type:"part",part:w.part,
        ox:q.x-(GX+w.part.x*CELL), oy:q.y-rowTop(w.part.y),
        sx:w.part.x, sy:w.part.y, v:w.v}; }
    else if(w.type==="sld"){ ui.drag=w;
      const onThumb=Math.abs(q.x-w.tx)<=w.tw_/2+3;
      w.gv = onThumb ? w.val : valFrom(w,q.x);    // gv is the running command value
      w.gx = q.x;
      if(!onThumb) w.fn(w.gv); }
    else if(w.type==="btn"){ w.fn&&w.fn(); }
    else if(w.type==="scroll"){ ui.drag=w; w.last=q.y; }
    /* A drawing surface. Painting wants press-drag-release, which nothing else
       here does: a btn fires on press and a sld owns the drag outright. So a
       lat widget gets the pointer for as long as it is held and is handed the
       raw point, and it works out for itself which cell that is. */
    else if(w.type==="lat"){ ui.drag=w; w.last=null; w.fn(q,e); }
    return; }
});
cv.addEventListener("pointermove",e=>{
  const p=local(e); ui.ptr=p;
  if(e.pointerType==="mouse") isTouch=false;
  if(ui.drag){ const d=ui.drag, q=d.v?vPt(p):p;
    if(d.type==="part"){
      const nx=Math.round((q.x-d.ox-GX)/CELL);
      /* rowAt() is the inverse of rowTop(); half a cell of lead makes it round to
         the nearest row rather than the row it is merely touching */
      const ny=rowAt(q.y-d.oy+CELL/2);
      if(nx!==d.part.x||ny!==d.part.y) moveTo(d.part,nx,ny); }
    else if(d.type==="lat"){ d.fn(q,e); }
    else if(d.type==="sld"){
      /* integrate rather than re-derive, so moving away from the track changes
         the gearing from here on instead of jumping the value */
      d.gv=clamp(d.gv+(q.x-d.gx)/d.w*(d.max-d.min)*sldGain(q.y-d.cy),d.min,d.max);
      d.gx=q.x; d.fn(d.gv); }
    /* the pan is measured in PAGE pixels and spent in plant units, so the deck
       keeps up with the hand at any zoom */
    else if(d.type==="pan"){
      VIEW.ox-=(p.x-d.lx)/VIEW.s; VIEW.oy-=(p.y-d.ly)/VIEW.s;
      d.lx=p.x; d.ly=p.y; vClamp(); }
    else { helpScroll=clamp(helpScroll-(q.y-d.last),0,helpMax); d.last=q.y; } }
  cv.style.cursor = ui.drag&&ui.drag.type==="pan" ? "grabbing"
    : ui.prev.some(w=>inside(w,ptIn(w,p))) ? "pointer" : "default";
});
["pointerup","pointercancel","pointerleave"].forEach(ev=>
  cv.addEventListener(ev,()=>{ui.drag=null;}));
cv.addEventListener("wheel",e=>{
  if(screen==="help"){ e.preventDefault();
    helpScroll=clamp(helpScroll+e.deltaY,0,helpMax); return; }
  const p=local(e);
  e.preventDefault();
  /* Anywhere on the canvas, not just over the plant. The page does not scroll
     any more, so there is nothing else for the wheel to do - and gating it to
     the plant meant that from anywhere else the wheel did nothing, so there was
     never anything to pan either.
     The zoom holds the plant point under the pointer still, which is what makes
     it feel like moving a lens rather than changing a number. With the pointer
     off the plant there is no such point, so it holds the middle instead. */
  const a=vIn(p)? vPt(p) : {x:VIEW.cx+VIEW.ox+VIEW.w/2/VIEW.s,
                            y:VIEW.cy+VIEW.oy+VIEW.h/2/VIEW.s};
  const px=vIn(p)? p.x : VIEW.x+VIEW.w/2, py=vIn(p)? p.y : VIEW.y+VIEW.h/2;
  VIEW.z=clamp(VIEW.z*Math.exp(-e.deltaY*0.0015),1,VMAX);
  VIEW.s=VIEW.fit*VIEW.z;
  VIEW.ox=(a.x-VIEW.cx)-(px-VIEW.x)/VIEW.s;
  VIEW.oy=(a.y-VIEW.cy)-(py-VIEW.y)/VIEW.s;
  vClamp();
},{passive:false});
