"use strict";
/* ══ THE SAME PANEL AGAIN, AS A PEEK ══
   An inspector window (ui/inspwin.js) is PARKED: the reader opened it and it
   stays until they close it. A hover window is the other half of that - it
   costs no click, it stands beside the machine the pointer is over, and it
   goes when the pointer does. One at a time.

   AND IT IS WHERE A PARKED WINDOW COMES FROM: drag the peek and it stays
   (hovwPin). That is the whole door - a window is not opened, it is kept.

   IT IS NOT A THIRD PANEL. panPartSync() (ui/margin.js) is still the one fill
   and marginPan() the one handle shape; inspAim(), inspDrag(), inspKeys() and
   inspMove() are shared with the parked window, so this file is life only.

   ── THE HAND MUST BE ABLE TO REACH IT ──
   The pointer leaving the machine is not the window closing: it has to be able
   to walk off the box, across the gap, and onto the panel to touch a control.
   Two things keep it alive - the pointer being INSIDE it (MOUSE enter/leave,
   which is the crossing the plant canvas cannot report, because the window is
   HTML standing over it), and a grace window either side of the gap. */

const HOVW_GRACE=280;

function hovwHost(root){
  const el=KIT.el("div","hovw-host");
  // the peek stands over the deck, so its wheel is the deck's (ui/margin.js)
  panWheelPass(el);
  el._win=null; el._at=0;
  root.appendChild(el);
  return el;
}

const hovwNow=()=>(typeof performance!=="undefined"&&performance.now?performance.now():Date.now());

/* WHICH MACHINE THE POINTER IS OVER, or null. Read off ui.ptr rather than a
   listener of its own: the canvas already has the one move handler (uiBind),
   and MOUSE.on merges by name, so a second `move` on it would replace it. */
function hovwPartAt(){
  if(!ui.drag&&ui.ptrHost===null&&vIn(ui.ptr)){
    const pt=vPt(ui.ptr);
    const p=partAt([pt.x,pt.y]);
    if(p&&fitted(p)) return p;
  }
  /* ══ AND THE BOARD IS WALKED WITH KEYS TOO ══
     W A S D lands on a machine and selects it (navCommit, render/navarrow.js),
     and that is the same act as pointing at one - so it opens the same peek.
     It stands until the walk moves off it or a pick is made elsewhere, which
     is what the id comparison says; the pointer, when there is one, still wins. */
  const q = navLandId===sel ? partOf(sel) : null;
  return q&&fitted(q) ? q : null;
}

function hovwOpen(host,p){
  const h=marginPan(host,partName(p),()=>null,p);
  // the parked window's look, which is the margin panel's look
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h._force=true; h.over=false; h.peek=true;
  ctxSuppress(h.well.el);
  MOUSE.on(h.well.el,{enter(){ h.over=true; }, leave(){ h.over=false; }});
  h.onDrag=hovwPin;
  inspDrag(h);
  host._win=h;
  return h;
}
/* ══ MOVING A PEEK IS WHAT KEEPS IT ══
   There is no key to press and no corner to open in: the reader drags the panel
   they are already reading, and the panel they dragged is the window they now
   have. Nothing is rebuilt - the same handle is handed to the inspector host,
   which is what lets the drag that kept it carry straight on into the move.
   The keys arrive with it, because they are what a window that STAYS needs and
   a peek has no use for. */
function hovwPin(h){
  const dst=INSPW_HOST; if(!dst) return;
  const src=h.well.el.parentNode;
  if(src&&src._win===h) src._win=null;
  // it stays now, so it lights with the selection like every other panel
  h.peek=false;
  dst.appendChild(h.well.el);
  dst._wins.push(h);
  MOUSE.on(h.well.el,{down(){ inspRaise(h); }});
  inspKeys(h);
  inspCollapse(h,false);
}
function hovwClose(host){
  const h=host._win; if(!h) return;
  if(h.well.el.parentNode) h.well.el.parentNode.removeChild(h.well.el);
  host._win=null;
}

/* ══ BESIDE THE BOX IT DESCRIBES ══
   To the RIGHT of the machine, and to the left when the right hand edge has not
   the room. Re-asked every frame, because the plant pans and zooms under it -
   and only until a drag keeps it, after which the reader owns the place.
   The gap is the frame's own (INSPW_GAP, ui/inspwin.js), and it is deck the
   hand has to cross to reach the panel - see the grace above. */
function hovwPlace(h){
  const host=h.well.el.parentNode; if(!host) return;
  const f=inspFrame(host);
  const w=h.well.el.offsetWidth||h.w, eh=h.well.el.offsetHeight||0;
  const r=prect(h.p);
  const s0=vScr({x:r.x,y:r.y}), s1=vScr({x:r.x+r.w,y:r.y+r.h});
  const a=marginPage(s0.x,s0.y), b=marginPage(s1.x,s1.y);
  let x=b.x+INSPW_GAP;
  if(x+w>f.x1) x=a.x-INSPW_GAP-w;
  h.wx=Math.max(f.x0,Math.min(Math.max(f.x0,f.x1-w),x));
  h.wy=Math.max(f.y0,Math.min(Math.max(f.y0,f.y1-eh),a.y));
  inspMove(h);
}

function hovwSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  const p=hovwPartAt(), now=hovwNow();
  let h=host._win;
  if(p){
    host._at=now;
    if(!h) h=hovwOpen(host,p);
    else if(h.p.id!==p.id) inspAim(h,p.id);
  }else if(h){
    // the hand is on the panel, or on its way to it
    if(h.over||ui.drag) host._at=now;
    else if(now-host._at>HOVW_GRACE){ hovwClose(host); return; }
    // the grace runs on the clock, and a still hand posts no event to end it
    else uiDirty();
  }
  if(!h) return;
  // the drawing was edited out from under it: LAY.parts is the authority
  const q=partOf(h.p.id);
  if(!q||!fitted(q)){ hovwClose(host); return; }
  h.p=q;
  const t=panTick(live);
  panPartSync(h,live,t.deep,t.fresh||h._force);
  h._force=false;
  marginColumns(h);
  hovwPlace(h);
}
