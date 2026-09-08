"use strict";
/* ══ THE SAME PANEL AGAIN, AS A PEEK ══
   An inspector window (ui/inspwin.js) is PARKED: the reader opened it and it
   stays until they close it. A peek is the other half of that - it stands
   beside the MACHINE THAT IS PICKED and goes when the pick does. One at a time,
   because there is one selection.

   AND IT IS WHERE A PARKED WINDOW COMES FROM: drag the peek and it stays
   (selwPin). That is the whole door - a window is not opened, it is kept.

   IT IS NOT A THIRD PANEL. panPartSync() (ui/margin.js) is still the one fill
   and marginPan() the one handle shape; inspAim(), inspDrag(), inspKeys() and
   inspMove() are shared with the parked window, so this file is life only. */

/* ══ A PEEK IS SEATED, NOT BOLTED, SO THE HAND MOVES THE PEEK ══
   selwPlace() re-seats it beside its machine every frame and clamps it into the
   frame, so panning the deck under it does nothing until the machine has
   travelled most of a screen - which reads as a dead wheel on the one panel the
   reader is holding. The gesture is spent on the peek's own offset instead:
   same promise as everywhere else, the box under the hand travels, and
   panRoom() stops it where a panel runs out. */
function selwHost(root){
  const el=KIT.el("div","selw-host");
  panWheelPass(el,(m,q)=>{
    const h=el._win; if(!h||h.well.el!==q) return;
    const d=panRoom(m,q); if(!d.x&&!d.y) return;
    h.off.x+=d.x; h.off.y+=d.y;
    selwPlace(h); uiDirty();
  });
  el._win=null;
  root.appendChild(el);
  return el;
}

/* WHICH MACHINE IS BEING READ, or null: the SELECTION, whichever gesture made
   it - a click on the box, the W A S D walk's landing (navCommit,
   render/navarrow.js), a rail row. A pointer resting on a machine is not a
   pick, so it opens nothing. */
// a machine the reader already kept a window for is being read in that window;
// a second panel of the same rows is noise standing over the drawing
const selwKept=id=>!!(INSPW_HOST&&INSPW_HOST._wins.some(o=>o.p.id===id));
function selwPartAt(){
  const q=partOf(sel);
  return q&&fitted(q)&&!selwKept(q.id) ? q : null;
}

function selwOpen(host,p){
  const h=marginPan(host,partName(p),()=>null,p);
  // the parked window's look, which is the margin panel's look
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h.plant=false; h._force=true; h.peek=true;
  h.off={x:0,y:0};
  ctxSuppress(h.well.el);
  h.onDrag=selwPin;
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
function selwPin(h){
  const dst=INSPW_HOST; if(!dst) return;
  const src=h.well.el.parentNode;
  if(src&&src._win===h) src._win=null;
  // it stays now, so it lights with the selection like every other panel
  h.peek=false;
  dst.appendChild(h.well.el);
  dst._wins.push(h);
  // the raise rides inspHand's own press: MOUSE.on() merges by event name, so a
  // second `down` registered here would simply take the window's hand off again
  inspHand(h);
  inspKeys(h);
  inspCollapse(h,false);
  // a window opens bolted to the deck; the key cuts it loose
  inspPin(h,true);
}
function selwClose(host){
  const h=host._win; if(!h) return;
  if(h.well.el.parentNode) h.well.el.parentNode.removeChild(h.well.el);
  host._win=null;
}

/* ══ BESIDE THE BOX IT DESCRIBES ══
   To the RIGHT of the machine, and to the left when the right hand edge has not
   the room. Re-asked every frame, because the plant pans and zooms under it -
   and only until a drag keeps it, after which the reader owns the place.
   The gap is the frame's own (INSPW_GAP, ui/inspwin.js). */
function selwPlace(h){
  const host=h.well.el.parentNode; if(!host) return;
  const f=inspFrame(host);
  const w=h.well.el.offsetWidth||h.w, eh=h.well.el.offsetHeight||0;
  const r=prect(h.p);
  const s0=vScr({x:r.x,y:r.y}), s1=vScr({x:r.x+r.w,y:r.y+r.h});
  const a=marginPage(s0.x,s0.y), b=marginPage(s1.x,s1.y);
  let x=b.x+INSPW_GAP;
  if(x+w>f.x1) x=a.x-INSPW_GAP-w;
  // the seat first, then wherever the reader has pushed it from that seat
  h.wx=Math.max(f.x0,Math.min(Math.max(f.x0,f.x1-w),x))+h.off.x;
  h.wy=Math.max(f.y0,Math.min(Math.max(f.y0,f.y1-eh),a.y))+h.off.y;
  inspMove(h);
}

// the screen whose peek the keys are talking to - set by selwSync
let SELW_HOST=null;

function selwSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  SELW_HOST=host;
  const p=selwPartAt();
  let h=host._win;
  if(!p){ if(h) selwClose(host); return; }
  if(!h) h=selwOpen(host,p);
  // a new machine is a new panel, so it opens at its own seat and not at
  // wherever the last one had been pushed to
  else if(h.p.id!==p.id){ h.off.x=h.off.y=0; inspAim(h,p.id); }
  h.p=p;
  const t=panTick(live);
  panPartSync(h,live,t.deep,t.fresh||h._force);
  h._force=false;
  marginColumns(h);
  selwPlace(h);
}

/* ══ THE PANEL A MACHINE IS SHOWING IN ══
   A kept window or a peek, never both for the same machine (selwKept). This is
   the one door the keys address, so nothing downstream has to know which of the
   two it got. */
function panOfSel(){
  if(!sel) return null;
  const w=INSPW_HOST&&INSPW_HOST._wins.find(o=>o.p.id===sel);
  if(w) return w.well.el;
  const h=SELW_HOST&&SELW_HOST._win;
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
