"use strict";
/* ══ THE SAME PANEL, IN SCREEN SPACE, AS A WINDOW ══
   A margin panel is IN PLANT SPACE (ui/margin.js): it pans, zooms and is placed
   by the board's own free ground, which is what makes it read as belonging to
   its machine and also what makes it move out from under the reader. An
   inspector window is the other answer to the same question - one machine's
   panel, parked where the reader put it, at its own size, staying there while
   the plant is driven around underneath.

   IT IS NOT A SECOND PANEL. panPartSync() (ui/margin.js) is the one fill and
   marginPan() the one handle shape, so a row that appears on the drawing's
   panel appears here on the same frame.

   ONE UNPINNED WINDOW, AND AS MANY PINNED AS ARE OPENED. The unpinned one is
   the selection's - it re-points at whatever was picked last and closes when
   the pick is not a machine. Pinning it (its own key, or shift-clicking a
   machine) takes it out of that and bolts it to the machine it is showing,
   which frees the selection to open a fresh one. */

const INSPW_GAP=14, INSPW_STEP=26, INSPW_MIN_VIS=80;

function inspHost(root){
  const el=KIT.el("div","insp-host");
  el._wins=[];
  root.appendChild(el);
  return el;
}

/* Windows are screen furniture, so the newest one is the one on top and a
   press anywhere on a window raises it. DOM order is the whole of the z-order
   here - the host is a stacking context and nothing inside it states one. */
function inspRaise(h){
  const host=h.well.el.parentNode;
  if(host && host.lastChild!==h.well.el) host.appendChild(h.well.el);
}

/* A WINDOW IS DRAGGED BY ITS TITLE BAR, and by nothing else: the bar carries
   its own keys, and a press on one of those is a press on the key. */
function inspDrag(h){
  const bar=h.well.head; if(!bar) return;
  let g=null;
  const drop=()=>{ g=null; };
  MOUSE.on(bar,{
    down(e){
      if(e.button!==0 || (e.target.closest && e.target.closest(".kit-btn"))) return;
      MOUSE.grab(bar);
      g={x:e.clientX-h.wx, y:e.clientY-h.wy};
      e.preventDefault();
    },
    move(e){
      if(!g) return;
      h.wx=e.clientX-g.x; h.wy=e.clientY-g.y; inspMove(h);
    },
    up:drop, cancel:drop});
}

function inspPinSet(h,on){
  h.pinned=!!on;
  h.well.el.classList.toggle("pinned",h.pinned);
  h.keyPin.set({label:h.pinned?"UNPIN":"PIN", on:h.pinned});
}
function inspCollapse(h,on){
  h.folded=!!on;
  h.well.el.classList.toggle("folded",h.folded);
  h.keyFold.set({label:h.folded?"+":"−"});
}
function inspClose(h){
  const host=h.well.el.parentNode;
  if(host){ host.removeChild(h.well.el); const i=host._wins.indexOf(h); if(i>=0) host._wins.splice(i,1); }
}

/* ══ THE GROUND A WINDOW MAY STAND ON ══
   The CANVAS box, not the window: a plant screen letterboxes its canvas and
   wears furniture over the top of it, and a window seated against the raw
   viewport edge sat under the topbar or out on the bare page beside the
   drawing. The screen's own head row is measured rather than reserved as a
   number, because the bench's row carries tools and the control room's does
   not, so the two are not the same height. */
function inspFrame(host){
  const rc = typeof marginCv==="function" ? marginCv() : null;
  const vw=typeof innerWidth==="number"?innerWidth:1920;
  const vh=typeof innerHeight==="number"?innerHeight:1080;
  let x0=0, y0=TOPBAR_H, x1=vw, y1=vh;
  if(rc && rc.width>0){ x0=Math.max(x0,rc.left); x1=Math.min(x1,rc.right);
                        y0=Math.max(y0,rc.top);  y1=Math.min(y1,rc.bottom); }
  const head = host.parentNode && host.parentNode.querySelector
             ? host.parentNode.querySelector(".scr-head") : null;
  if(head && head.getBoundingClientRect){ const hr=head.getBoundingClientRect();
    if(hr.height>0) y0=Math.max(y0, hr.bottom); }
  return {x0:x0+INSPW_GAP, y0:y0+INSPW_GAP, x1:x1-INSPW_GAP, y1:y1-INSPW_GAP};
}
/* ══ WHERE A NEW WINDOW OPENS: THE TOP RIGHT ══
   It used to open beside the machine it describes, which is where the margin
   panel already stands - so the window landed on top of its own twin, and on a
   zoomed-in plant it landed off screen with the machine. One corner instead:
   the reader always knows where a new window will be, and the corner is the
   one part of a plant screen nothing else is drawn in.
   DOWN AND LEFT for the next one, because the stack grows away from the corner
   it starts in, and the title bar of the one underneath stays readable.
   THE RUNG IS THE SEAT, NOT THE PIXEL. Two panels of different widths both
   hang off the same right edge, so their left edges differ and a comparison on
   x said they were not on top of each other while they overlapped almost
   entirely. A rung is taken or it is not. */
function inspSeat(h){
  const host=h.well.el.parentNode;
  const f=inspFrame(host);
  const w=h.well.el.offsetWidth||h.w;
  const rungs=Math.max(1,Math.floor((f.y1-f.y0)/INSPW_STEP));
  let n=0;
  while(n<rungs && host._wins.some(o=>o!==h && o._seat && o._seat.n===n
                                    && o.wx===o._seat.x && o.wy===o._seat.y)) n++;
  if(n>=rungs) n=0;                    // full: back to the corner rather than off the ground
  h.wx=Math.max(f.x0, f.x1-w-n*INSPW_STEP);
  h.wy=f.y0+n*INSPW_STEP;
  inspMove(h);
  /* WHAT IT WAS SEATED AS, so a re-seat can tell an untouched window from one
     the reader has put somewhere. A panel that states its own columns
     (the reactor's two, the controller's three) is measured at ONE column here
     and widens on its first sync, which hung it off the right edge - it is
     re-seated at its real width, and only while nobody has moved it. */
  h._seat={x:h.wx, y:h.wy, w, n};
}
// the seat is stale when the panel grew and the window is still standing on it
function inspReseat(h){
  const s=h._seat; if(!s) return;
  if(h.wx!==s.x || h.wy!==s.y) return;
  if((h.well.el.offsetWidth||h.w)===s.w) return;
  inspSeat(h);
}
/* CLAMPED SO A TITLE BAR IS ALWAYS REACHABLE, never so the whole window fits:
   a window grows to its content and its content may be taller than the screen,
   and a clamp on the bottom edge would then drag the bar off the top. */
function inspMove(h){
  const vw=typeof innerWidth==="number"?innerWidth:1920;
  const vh=typeof innerHeight==="number"?innerHeight:1080;
  const w=h.well.el.offsetWidth||h.w;
  // sideways it may hang off, so a wide window can be read at either edge; the
  // TOP is the frame's, because a bar dragged under the tools row is a window
  // that cannot be moved back
  const top = inspFrame(h.well.el.parentNode).y0;
  h.wx=Math.max(INSPW_MIN_VIS-w, Math.min(vw-INSPW_MIN_VIS, h.wx));
  h.wy=Math.max(top, Math.min(vh-24, h.wy));
  const tf="translate3d("+Math.round(h.wx)+"px,"+Math.round(h.wy)+"px,0)";
  if(h.wtf!==tf){ h.well.el.style.transform=tf; h.wtf=tf; }
}

function inspOpen(host,id,pinned){
  const p=partOf(id);
  if(!p||!fitted(p)) return null;
  const h=marginPan(host,partName(p),()=>null,p);
  /* the margin panel's own class comes with it, because the LOOK is the same
     panel's look; .insp-win only takes the plant-space placement back off it */
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.pinned=false; h.folded=false;
  ctxSuppress(h.well.el);
  MOUSE.on(h.well.el,{down(){ inspRaise(h); }});
  const keys=KIT.el("div","insp-keys");
  h.keyFold=KIT.button("−",{flat:true,size:7,tip:"Fold this window down to its title bar.",
    onClick:()=>inspCollapse(h,!h.folded)});
  h.keyPin=KIT.button("PIN",{flat:true,size:7,
    tip:"Keep this window on this machine. An unpinned window follows the selection instead; shift-clicking a machine on the plant opens a pinned one straight away.",
    onClick:()=>inspPinSet(h,!h.pinned)});
  h.keyShut=KIT.button("×",{flat:true,size:7,tip:"Close this window.",onClick:()=>inspClose(h)});
  keys.append(h.keyFold.el,h.keyPin.el,h.keyShut.el);
  h.well.head.insertBefore(keys,h.well.sfx);
  inspDrag(h);
  inspPinSet(h,pinned);
  inspCollapse(h,false);
  host._wins.push(h);
  inspSeat(h);
  return h;
}

/* A window is re-pointed rather than rebuilt, so the one the reader is looking
   at stays where they put it. Both body syncs key off handles they hung on the
   container, so the container is wiped: a new machine's block list is a
   different shape and the shape test is what would otherwise have to catch it. */
function inspAim(h,id){
  const p=partOf(id); if(!p) return;
  h.p=p; h.id=id;
  h.body.innerHTML=""; h.body._sig=null; h.body._h=null; h.body._viz=null; h.body._cols=0;
  h.ctl=null; h.cells=null; h.nRows=0; h.ctlG=null;
  if(h.head){ h.head.remove(); h.head=null; }
  h._ctlSeq=null; h._force=true;
  h.well.setSfx("");
  marginCols(h,1);
}

// the screen whose windows a plant-side gesture is talking to - set by inspSync
let INSPW_HOST=null;
/* THE SHIFT-CLICK DOOR (uiDown, core/ui.js). Pinning what is already up beats
   opening a second window on the same machine: the reader shift-clicked the
   panel they can see. */
function inspPin(id){
  const host=INSPW_HOST; if(!host) return;
  const had=host._wins.find(h=>h.p.id===id);
  if(had){ inspPinSet(had,true); inspRaise(had); return; }
  const h=inspOpen(host,id,true);
  if(h) inspRaise(h);
}

function inspSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  INSPW_HOST=host;
  /* THE SELECTION OWNS ONE WINDOW. A run or a wall key is not a machine, so
     there is nothing for the unpinned window to show and it goes. */
  const pick = partOf(sel) ? sel : null;
  const free = host._wins.find(h=>!h.pinned);
  if(!pick){ if(free) inspClose(free); }
  else if(free){ if(free.p.id!==pick) inspAim(free,pick); }
  /* ...AND NEVER A SECOND WINDOW ON A MACHINE THAT ALREADY HAS ONE. Pinning
     the selection's own window leaves the pick standing, so the next frame
     would otherwise open its twin beside it. */
  else if(!host._wins.some(h=>h.p.id===pick)) inspOpen(host,pick,false);

  /* ══ PICKING A MACHINE BRINGS ITS WINDOW TO THE FRONT, AND LEAVES IT THERE ══
     The raise is spent on the CHANGE, not held while the pick stands: a window
     that dropped back on deselect would put the reader's own last move away,
     and re-raising every frame would move a DOM node sixty times a second.
     So the order is a stack of what was picked, oldest at the back, and the
     next pick simply goes on top of this one. */
  if(host._pickAt!==pick){
    host._pickAt=pick;
    const on = pick && host._wins.find(h=>h.p.id===pick);
    if(on) inspRaise(on);
  }

  const t=panTick(live);
  for(const h of host._wins.slice()){
    // the drawing was edited out from under it: LAY.parts is the authority
    const p=partOf(h.p.id);
    if(!p||!fitted(p)){ inspClose(h); continue; }
    h.p=p;
    panPartSync(h,live,t.deep,t.fresh||h._force);
    h._force=false;
    marginColumns(h);
    inspReseat(h);
    inspMove(h);
  }
}
