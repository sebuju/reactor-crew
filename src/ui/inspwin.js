"use strict";
/* ══ THE SAME PANEL, IN SCREEN SPACE, AS A WINDOW ══
   A margin panel is IN PLANT SPACE (ui/margin.js): it pans, zooms and is placed
   by the board's own free ground, which is what makes it read as belonging to
   its machine and also what makes it move out from under the reader. An
   inspector window is the other answer to the same question - one machine's
   panel, parked where the reader put it, at its own size, staying there while
   the plant is driven around underneath - or bolted back onto the deck by its
   own key, which is the one choice the two grounds are (inspPin).

   IT IS NOT A SECOND PANEL. panPartSync() (ui/margin.js) is the one fill and
   marginPan() the one handle shape, so a row that appears on the drawing's
   panel appears here on the same frame.

   A WINDOW IS NOT OPENED, IT IS KEPT. There is no key and no corner: the
   reader drags the peek they are already reading (selwPin,
   ui/selwin.js) and it stays where the drag ended. So there is no unpinned
   window, no selection to follow and no seat to compute - a window is where it
   was put, and it closes on its own key. */

const INSPW_GAP=14, INSPW_MIN_VIS=80;

function inspHost(root){
  const el=KIT.el("div","insp-host");
  el._wins=[];
  root.appendChild(el);
  return el;
}

/* ══ A WINDOW ABOUT NO MACHINE ══
   The same window, minted rather than kept: there is no peek of the whole ship
   to drag, so a reading about the DESIGN gets its key elsewhere and the window
   is opened by it. Not in host._wins - that list is walked against LAY.parts
   and a window with no part in it would be closed on the next frame - so the
   opener owns the placement call. */
function inspWin(host,title){
  const h=marginPan(host,title,()=>null,null);
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h.plant=false;
  inspDrag(h); inspHand(h); inspKeys(h);
  return h;
}
/* Where a minted window stands before anyone has moved it: the frame's own top
   left, which is under the head row and clear of the rail. */
function inspWinSeat(h,host){
  if(h.wtf!==null) return;
  const f=inspFrame(host);
  h.wx=f.x0; h.wy=f.y0;
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
      /* MOVING A PEEK IS WHAT PINS IT (ui/selwin.js). Spent on the
         first move rather than on the press, so a press that goes nowhere
         leaves the peek a peek - and the grab is on the BAR, which the promote
         keeps, so the same gesture carries straight on into the drag. */
      if(h.onDrag){ const f=h.onDrag; h.onDrag=null; f(h); }
      h.wx=e.clientX-g.x; h.wy=e.clientY-g.y;
      // the hand always states a place in px; in plant space that place is an
      // anchor on the board, so the drag writes the anchor and never wx/wy
      if(h.plant) inspAnchor(h);
      inspMove(h);
    },
    up:drop, cancel:drop});
}

/* ══ AND THE HAND IS ANSWERED ON WHICHEVER GROUND THE WINDOW IS STANDING ON ══
   Bolted to the deck the window travels with the drawing, so moving the deck is
   what carries it (panDeck, ui/margin.js). Cut loose there is nothing
   underneath to move, and the window itself is what the hand is pushing. The
   wheel and the right drag are the same gesture to both grounds - see
   panWheelPass(), which states the travel and asks this for the spending. */
function inspHand(h){
  panWheelPass(h.well.el,(m,el)=>{
    if(h.plant){ panDeck(m,el); return; }
    const d=panRoom(m,el); if(!d.x&&!d.y) return;
    h.wx+=d.x; h.wy+=d.y; inspMove(h); uiDirty();
  },()=>inspRaise(h));
}

/* ══ THE OTHER GROUND A WINDOW MAY STAND ON ══
   Screen space is where a window is parked so the plant may be driven around
   underneath it. Plant space is the margin panel's ground (ui/margin.js): the
   window is bolted to the deck at the point the reader left it, and it then
   pans with the drawing, at its own size. Same window,
   same fill, one key between the two - which is the choice the reader actually
   has, "stay with the machine" or "stay where I put you".
   The anchor is a PLANT point, not a screen one, so a pan cannot make it stale. */
function inspAnchor(h){
  const q=vPt(marginUnits(h.wx,h.wy));
  h.px=q.x; h.py=q.y;
}
function inspPin(h,on){
  h.plant=!!on;
  // handed over at the place it is standing, either way: the window does not
  // jump under the hand that pressed the key
  if(h.plant) inspAnchor(h);
  h.wtf=null;
  h.well.el.classList.toggle("insp-plant",h.plant);
  if(h.keyPin) h.keyPin.set({on:!h.plant});
  inspMove(h);
}

function inspCollapse(h,on){
  h.folded=!!on;
  h.well.el.classList.toggle("folded",h.folded);
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
/* CLAMPED SO A TITLE BAR IS ALWAYS REACHABLE, never so the whole window fits:
   a window grows to its content and its content may be taller than the screen,
   and a clamp on the bottom edge would then drag the bar off the top. */
function inspMove(h){
  let tf;
  if(h.plant){
    /* NOT CLAMPED AND NOT ROUNDED: a window bolted to the deck goes off screen
       with the deck it is bolted to, and a quantised place pops it a pixel each
       way as the zoom moves - both are the margin panel's rules, and this is
       the margin panel's ground. */
    const s=vScr({x:h.px,y:h.py}), g=marginPage(s.x,s.y);
    h.wx=g.x; h.wy=g.y;
    // NOT SCALED: a window is read, and a panel shrunk with the zoom stops being readable
    tf="translate3d("+h.wx.toFixed(3)+"px,"+h.wy.toFixed(3)+"px,0)";
  }else{
    const vw=typeof innerWidth==="number"?innerWidth:1920;
    const vh=typeof innerHeight==="number"?innerHeight:1080;
    const w=h.well.el.offsetWidth||h.w;
    // sideways it may hang off, so a wide window can be read at either edge; the
    // TOP is the frame's, because a bar dragged under the tools row is a window
    // that cannot be moved back. The frame already carries INSPW_GAP, so "up to
    // the bar" is up to the bar with its own margin kept.
    const top = inspFrame(h.well.el.parentNode).y0;
    h.wx=Math.max(INSPW_MIN_VIS-w, Math.min(vw-INSPW_MIN_VIS, h.wx));
    h.wy=Math.max(top, Math.min(vh-24, h.wy));
    tf="translate3d("+Math.round(h.wx)+"px,"+Math.round(h.wy)+"px,0)";
  }
  if(h.wtf!==tf){ h.well.el.style.transform=tf; h.wtf=tf; }
}

/* THE TITLE BAR'S OWN KEYS, at the right hand end of the bar where a window's
   keys stand. A peek has none while it is a peek - it goes when the pointer
   does, so there is nothing to fold or close - and it grows them the moment a
   drag keeps it (selwPin, ui/selwin.js).
   The chevron is not redrawn folded: the class on the window turns it. */
const INSPW_ICON={fold:"M4 6.5 L8 10.5 L12 6.5", shut:"M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5",
  pin:["M8 2.8 a2.4 2.4 0 1 1 0 4.8 a2.4 2.4 0 1 1 0-4.8","M8 7.6 L8 13.2"]};
function inspKeys(h){
  const keys=KIT.el("div","insp-keys");
  h.keyPin=KIT.button("UNPIN FROM PLANT",{flat:true,icon:INSPW_ICON.pin,on:!h.plant,
    tip:"Cut this window loose from the drawing, so it stays where it is on screen while the plant moves under it. Off, it is bolted to the deck and moves with the plant at its own size.",
    onClick:()=>inspPin(h,!h.plant)});
  keys.appendChild(h.keyPin.el);
  h.keyFold=KIT.button("FOLD",{flat:true,icon:INSPW_ICON.fold,
    tip:"Fold this window down to its title bar.",
    onClick:()=>inspCollapse(h,!h.folded)});
  h.keyFold.el.classList.add("insp-key-fold");
  // a window with a key that opens it again is put away, not thrown away
  h.keyShut=KIT.button("CLOSE",{flat:true,icon:INSPW_ICON.shut,
    tip:"Close this window.",onClick:()=>h.onShut?h.onShut(h):inspClose(h)});
  keys.append(h.keyFold.el,h.keyShut.el);
  h.well.head.appendChild(keys);
}
/* ══ WHICH MACHINE THIS WINDOW IS ABOUT ══
   A peek stands against its own box, so touching it IS the association. A
   window has been carried off somewhere the reader wanted it, and then nothing
   on screen says which machine it came from - so it keeps a dashed leader, the
   same ink and the same elbow the margin panels use (leaderStroke,
   render/plant.js). Drawn in LAYOUT space over the canvas and re-read off the
   live DOM box every frame, so a pan, a zoom and a drag all come out right
   with no listeners. Amber while its machine is the pick, like every other
   leader on the board. */
function inspLeaders(host){
  if(!host||typeof LAY==="undefined"||!LAY||!host._wins.length) return;
  const pad=3, vx0=VIEW.x+pad, vx1=VIEW.x+VIEW.w-pad, vy0=VIEW.y+pad, vy1=VIEW.y+VIEW.h-pad;
  if(vx1<=vx0||vy1<=vy0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  for(const h of host._wins){
    const p=partOf(h.p.id); if(!p) continue;
    const q=hostRect(h.well.el); if(q.h<1) continue;
    const box=prect(p), c=vScr({x:box.x+box.w/2, y:box.y+box.h/2});
    // the window's own near edge, and the face of the machine that looks at it
    const face = q.x+q.w/2 >= c.x ? "r" : "l";
    const s0=vScr(leaderAnchor(box,face));
    // clamped, not culled: panned off the plant, the leader pins to the view's
    // edge and still says which way the machine went
    const a={x:clamp(s0.x,vx0,vx1), y:clamp(s0.y,vy0,vy1)};
    const b={x: face==="r"? q.x : q.x+q.w, y:q.y+q.h/2};
    if(Math.abs(b.x-a.x)<8) continue;             // sitting on its own machine: no room to turn
    const gx=(a.x+b.x)/2;                         // turn halfway across, not against the window
    const pts = Math.abs(a.y-b.y)<1 ? [a,b] : [a,{x:gx,y:a.y},{x:gx,y:b.y},b];
    leaderStroke(pts, h.p.id===sel?C.amber:C.lead, [a,b], cvPx(), LEADER_RAD);
  }
  ctx.restore();
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

// the screen whose windows a peek is handed to - set by inspSync
let INSPW_HOST=null;

function inspSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  INSPW_HOST=host;
  const pick = partOf(sel) ? sel : null;
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
    inspMove(h);
  }
}
