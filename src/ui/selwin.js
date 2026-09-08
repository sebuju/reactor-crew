"use strict";
/* the peek beside the picked machine; a drag keeps it as a window (selwPin, ui/inspwin.js) */

/* selwPlace() re-seats it every frame, so the hand is spent on the peek's own offset */
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

// a pick with a kept window is already being read there
const selwKept=id=>!!(INSPW_HOST&&INSPW_HOST._wins.some(o=>o.id===id));
/* a machine, a pipe run or a painted wall: three things the drawing lets the hand pick, one peek */
function selwPickAt(){
  if(!sel||selwKept(sel)) return null;
  const q=partOf(sel);
  if(q) return fitted(q) ? {p:q, id:q.id} : null;
  if(isRunKey(sel)) return {key:"run", id:sel};
  if(isMatKey(sel)) return {key:"mat", id:sel};
  return null;
}

function selwOpen(host,pick){
  const title = pick.p ? partName(pick.p) : pick.key==="run" ? "PIPE RUN" : "WALL";
  const h=marginPan(host,title,()=>null,pick.p||null);
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h.plant=false; h._force=true; h.peek=true;
  if(pick.key){ h.key=pick.key; h.id=pick.id; h.selAt=null; }
  h.off={x:0,y:0};
  ctxSuppress(h.well.el);
  h.onDrag=selwPin;
  inspDrag(h);
  host._win=h;
  return h;
}
/* nothing is rebuilt: the same handle moves to the inspector host, so the drag carries on */
function selwPin(h){
  const dst=INSPW_HOST; if(!dst) return;
  const src=h.well.el.parentNode;
  if(src&&src._win===h) src._win=null;
  h.peek=false;
  dst.appendChild(h.well.el);
  dst._wins.push(h);
  // MOUSE.on() merges by event name, so a second `down` here would take the hand off again
  inspHand(h);
  inspKeys(h);
  inspCollapse(h,false);
  inspPin(h,true);
}
function selwClose(host){
  const h=host._win; if(!h) return;
  if(h.well.el.parentNode) h.well.el.parentNode.removeChild(h.well.el);
  host._win=null;
}

/* right of the machine, left when there is no room; re-asked every frame */
function selwPlace(h){
  const host=h.well.el.parentNode; if(!host) return;
  const f=inspFrame(host);
  const w=h.well.el.offsetWidth||h.w, eh=h.well.el.offsetHeight||0;
  const r=panRectOf(h); if(!r) return;
  const s0=vScr({x:r.x,y:r.y}), s1=vScr({x:r.x+r.w,y:r.y+r.h});
  const a=marginPage(s0.x,s0.y), b=marginPage(s1.x,s1.y);
  let x=b.x+INSPW_GAP;
  if(x+w>f.x1) x=a.x-INSPW_GAP-w;
  // the seat first, then wherever the reader has pushed it from that seat
  h.wx=Math.max(f.x0,Math.min(Math.max(f.x0,f.x1-w),x))+h.off.x;
  h.wy=Math.max(f.y0,Math.min(Math.max(f.y0,f.y1-eh),a.y))+h.off.y;
  inspMove(h);
}

// the screen whose peek the keys are talking to
let SELW_HOST=null;

function selwSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  SELW_HOST=host;
  const pick=selwPickAt();
  let h=host._win;
  if(!pick){ if(h) selwClose(host); return; }
  // a machine's body and a key's are filled by different hands, so the kind changing is a new peek
  if(h && !!h.key!==!!pick.key){ selwClose(host); h=null; }
  if(!h) h=selwOpen(host,pick);
  // a new pick opens at its own seat, not where the last one was pushed to
  else if(h.id!==pick.id){ h.off.x=h.off.y=0;
    if(pick.key) h.id=pick.id; else inspAim(h,pick.id); }
  const t=panTick(live);
  if(pick.key) marginKeyFill(h,pick.id,t.fresh||h._force,live);
  else { h.p=pick.p; panPartSync(h,live,t.deep,t.fresh||h._force); }
  h._force=false;
  marginColumns(h);
  selwPlace(h);
}

/* a kept window or a peek, never both for the same machine: the one door the keys address */
function panOfSel(){
  if(!sel) return null;
  const w=INSPW_HOST&&INSPW_HOST._wins.find(o=>o.id===sel);
  if(w) return w.well.el;
  const h=SELW_HOST&&SELW_HOST._win;
  return h&&h.id===sel ? h.well.el : null;
}
/* not the next key in the DOM: the test is what the boxes face across the travel, and 1e4 is a rank */
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
  if(!dir){
    if(at<0) return false;
    e.preventDefault(); keys[at].click(); uiDirty(); return true;
  }
  e.preventDefault();
  if(at<0){ keys[0].focus(); uiDirty(); return true; }
  const rects=keys.map(b=>b.getBoundingClientRect());
  const to=panKeyPick(rects,rects[at],dir[0],dir[1]);
  // nothing that way: the focus stays put rather than wrapping round
  if(to>=0){ keys[to].focus(); uiDirty(); }
  return true;
}
