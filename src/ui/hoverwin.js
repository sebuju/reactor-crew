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
   The pointer leaving the machine is not the panel closing: it has to be able
   to walk off the box, across the gap, and onto the panel to touch a control.
   So the ground that keeps it up is the machine, the panel, and the box the two
   of them span (hovwNear); the grace timer only covers leaving all three. */

const HOVW_GRACE=280;

function hovwHost(root){
  const el=KIT.el("div","hovw-host");
  // the peek stands over the deck, so its wheel and right drag are the deck's (ui/margin.js)
  panWheelPass(el);
  el._win=null; el._at=0;
  root.appendChild(el);
  return el;
}

const hovwNow=()=>(typeof performance!=="undefined"&&performance.now?performance.now():Date.now());

/* ══ ONE READING OF WHERE THE HAND IS, AND EVERYTHING ASKS IT ══
   This was three answers and they disagreed. `ui.ptr` is parked off screen the
   moment the pointer crosses onto the panel (uiBind's leave, core/ui.js), and
   `ui.ptrHost` changes again on a canvas hosted INSIDE the panel; the panel's
   own enter/leave then had to undo both - and a panel that is re-placed by a
   transform every frame can slide under a still hand without any crossing
   event firing at all. That is the flake: three sources, one of them silent.
   So: the document's own move, in the same LAYOUT units local() gives every
   other reader, plus the node it landed on. Both are facts, neither is state
   to keep in step, and a frame can ask them as often as it likes. */
let hovwPt={x:-1e4,y:-1e4}, hovwTgt=null;
MOUSE.doc({move(e){
  const p=local(e);
  /* AND A HAND THAT MOVES TAKES THE PEEK BACK OFF THE KEYS. It has to be the
     MOVE and not where the pointer is standing: the hand is on bare deck most
     of the time, so a test asked per frame cleared the walk's landing the frame
     after it happened and the keys never opened anything at all. */
  if(Math.abs(p.x-hovwPt.x)>0.5 || Math.abs(p.y-hovwPt.y)>0.5) navLandId=null;
  hovwPt=p; hovwTgt=e.target;
}});
// the drawing itself, not the furniture standing over it
const hovwOnPlant=()=>hovwTgt===cv;
const hovwOnEl=el=>!!(el&&hovwTgt&&el.contains(hovwTgt));

/* WHICH MACHINE IS BEING READ, or null.
   ══ THE WALK FIRST, AND A STILL HAND IS NOT A HOVER ══
   W A S D lands on a machine and selects it (navCommit, render/navarrow.js),
   which is the same act as pointing at one, so it opens the same peek. While
   that landing stands the mouse has NOT moved since it happened - any move
   clears it, in the handler above - so a pointer parked on some other machine
   is a stale reading and not a hand on it. The moment the hand moves, the
   landing is gone and the pointer is the only answer left. */
function hovwPartAt(){
  const q = navLandId===sel ? partOf(sel) : null;
  if(q&&fitted(q)) return q;
  if(!ui.drag&&hovwOnPlant()&&vIn(hovwPt)){
    const pt=vPt(hovwPt);
    const p=partAt([pt.x,pt.y]);
    if(p&&fitted(p)) return p;
  }
  return null;
}

function hovwOpen(host,p){
  const h=marginPan(host,partName(p),()=>null,p);
  // the parked window's look, which is the margin panel's look
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h.plant=false; h._force=true; h.peek=true;
  ctxSuppress(h.well.el);
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
/* ══ THE GROUND BETWEEN THE MACHINE AND ITS PANEL IS STILL THE PANEL'S ══
   The grace alone was a race the reader kept losing: a hand that sets off
   towards the panel and hesitates, or takes the long way round a pipe, spends
   longer than any timer on the deck between the two - and the panel went while
   they were reaching for it. So the box the two of them span keeps it up, and
   the timer only has to cover leaving that. In LAYOUT units, which is what
   ui.ptr is measured in while the pointer is over the canvas. */
function hovwNear(h){
  if(!h||!h.well.el.parentNode||hovwPt.x<-1e3) return false;
  const q=hostRect(h.well.el); if(q.h<1) return false;
  const r=prect(h.p);
  const s0=vScr({x:r.x,y:r.y}), s1=vScr({x:r.x+r.w,y:r.y+r.h});
  const pad=INSPW_GAP;
  return hovwPt.x>=Math.min(s0.x,q.x)-pad && hovwPt.x<=Math.max(s1.x,q.x+q.w)+pad
      && hovwPt.y>=Math.min(s0.y,q.y)-pad && hovwPt.y<=Math.max(s1.y,q.y+q.h)+pad;
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

// the screen whose peek the keys are talking to - set by hovwSync
let HOVW_HOST=null;

function hovwSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  HOVW_HOST=host;
  const p=hovwPartAt(), now=hovwNow();
  let h=host._win;
  if(p){
    host._at=now;
    if(!h) h=hovwOpen(host,p);
    else if(h.p.id!==p.id) inspAim(h,p.id);
  }else if(h){
    // the hand is on the panel, or in the deck between it and its machine
    if(ui.drag||hovwOnEl(h.well.el)||hovwNear(h)) host._at=now;
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

/* ══ THE PANEL A MACHINE IS SHOWING IN ══
   One machine may be on screen as a kept window and as a peek at the same
   time; the window wins, because it is the one that stays still. This is the
   one door the keys address, so nothing downstream has to know which of the
   two it got. */
function panOfSel(){
  if(!sel) return null;
  const w=INSPW_HOST&&INSPW_HOST._wins.find(o=>o.p.id===sel);
  if(w) return w.well.el;
  const h=HOVW_HOST&&HOVW_HOST._win;
  return h&&h.p.id===sel ? h.well.el : null;
}
/* ══ AND THE ARROWS WALK ITS KEYS ══
   W A S D walks the BOARD, so the arrows are free to walk what is inside the
   panel the walk landed on - the reader never has to reach for the mouse to
   press a key they can see. Only in the control room: the bench's panels are
   design knobs, and a machine there is dragged, not driven.
   ENTER IS THE ZOOM UNTIL SOMETHING IS FOCUSED (navarrow.js). With a key under
   the focus it presses that key instead, which is what Enter means everywhere
   else on a page - and .click() goes through the mouse hub exactly as a real
   press does. */
/* ══ AND IT IS DIRECTIONAL, LIKE THE BOARD WALK ══
   Not the next key in the DOM: the keys are laid out in rows of whatever width
   the row needed, so DOWN off either of two half-width keys has to land on the
   one wide key under BOTH of them. So the test is what the boxes FACE across
   the direction of travel - any overlap at all on the perpendicular axis - and
   the nearest of those wins. A key that faces nothing is still reachable, but
   only once nothing faces: the 1e4 is a rank, not a distance.
   The board's own cone (navNearestInDir, render/navarrow.js) is the wrong test
   here - it is written for boxes scattered on a deck, and it throws away a wide
   neighbour whose centre is further sideways than it is down. */
function panKeyPick(rects,from,dx,dy){
  let best=-1, bs=Infinity;
  for(let i=0;i<rects.length;i++){
    const r=rects[i]; if(r===from) continue;
    const along = dx ? (dx>0 ? r.left-from.right : from.left-r.right)
                     : (dy>0 ? r.top-from.bottom : from.top-r.bottom);
    if(along<-1) continue;                        // behind, or the row we are standing in
    const face = dx ? Math.min(from.bottom,r.bottom)-Math.max(from.top,r.top)
                    : Math.min(from.right,r.right)-Math.max(from.left,r.left);
    const off = dx ? Math.abs((r.top+r.bottom)/2-(from.top+from.bottom)/2)
                   : Math.abs((r.left+r.right)/2-(from.left+from.right)/2);
    const score = Math.max(0,along) + off*0.1 + (face>0 ? 0 : 1e4);
    if(score<bs){ bs=score; best=i; }
  }
  return best;
}
const PANKEY_DIR={ArrowRight:[1,0], ArrowLeft:[-1,0], ArrowDown:[0,1], ArrowUp:[0,-1]};
function panKeyNav(e){
  if(screen!=="operate") return false;
  const dir=PANKEY_DIR[e.key];
  if(!dir && e.key!=="Enter") return false;
  const el=panOfSel(); if(!el) return false;
  const keys=[].slice.call(el.querySelectorAll(".kit-btn"))
                .filter(b=>!b.disabled && b.offsetParent!==null);
  if(!keys.length) return false;
  const at=keys.indexOf(document.activeElement);
  if(!dir){                                  // Enter
    if(at<0) return false;
    e.preventDefault(); keys[at].click(); uiDirty(); return true;
  }
  e.preventDefault();
  if(at<0){ keys[0].focus(); uiDirty(); return true; }
  const rects=keys.map(b=>b.getBoundingClientRect());
  const to=panKeyPick(rects,rects[at],dir[0],dir[1]);
  // nothing that way: the focus stays where it is rather than wrapping round
  if(to>=0){ keys[to].focus(); uiDirty(); }
  return true;
}
