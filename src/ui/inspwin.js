"use strict";
/* the margin panel (ui/margin.js) parked in screen space: same fill, same handle shape */

const INSPW_GAP=14, INSPW_MIN_VIS=80;

function inspHost(root){
  const el=KIT.el("div","insp-host");
  el._wins=[];
  root.appendChild(el);
  return el;
}

/* minted rather than kept, and never in host._wins: that list is walked against LAY.parts */
function inspWin(host,title){
  const h=marginPan(host,title,()=>null,null);
  h.well.el.classList.add("insp-win");
  h.wx=0; h.wy=0; h.wtf=null; h.folded=false; h.plant=false;
  inspDrag(h); inspHand(h); inspKeys(h);
  return h;
}
function inspWinSeat(h,host){
  if(h.wtf!==null) return;
  const f=inspFrame(host);
  h.wx=f.x0; h.wy=f.y0;
}

/* DOM order is the whole of the z-order here: nothing inside the host states one */
function inspRaise(h){
  const host=h.well.el.parentNode;
  if(host && host.lastChild!==h.well.el) host.appendChild(h.well.el);
}

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
      /* spent on the first move, not the press, so a press that goes nowhere leaves the peek a peek */
      if(h.onDrag){ const f=h.onDrag; h.onDrag=null; f(h); }
      h.wx=e.clientX-g.x; h.wy=e.clientY-g.y;
      // in plant space the hand's px place is an anchor on the board, so the drag writes that
      if(h.plant) inspAnchor(h);
      inspMove(h);
    },
    up:drop, cancel:drop});
}

/* the same gesture on either ground: bolted, it moves the deck; cut loose, the window */
function inspHand(h){
  panWheelPass(h.well.el,(m,el)=>{
    if(h.plant){ panDeck(m,el); return; }
    const d=panRoom(m,el); if(!d.x&&!d.y) return;
    h.wx+=d.x; h.wy+=d.y; inspMove(h); uiDirty();
  },()=>inspRaise(h));
}

/* the anchor is a PLANT point, not a screen one, so a pan cannot make it stale */
function inspAnchor(h){
  const q=vPt(marginUnits(h.wx,h.wy));
  h.px=q.x; h.py=q.y;
}
function inspPin(h,on){
  h.plant=!!on;
  // handed over where it stands, so the window does not jump under the hand
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
  // shutting the window is letting the thing go; still picked, the peek opens it again next frame
  if(h.id && h.id===sel){ sel=null; uiDirty(); }
}

/* the CANVAS box, and the head row is measured rather than assumed: the screens differ */
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
/* clamped so the title bar is always reachable, never so the whole window fits */
function inspMove(h){
  let tf;
  if(h.plant){
    /* neither clamped nor rounded: the margin panel's ground, and its rules */
    const s=vScr({x:h.px,y:h.py}), g=marginPage(s.x,s.y);
    h.wx=g.x; h.wy=g.y;
    // not scaled: a panel shrunk with the zoom stops being readable
    tf="translate3d("+h.wx.toFixed(3)+"px,"+h.wy.toFixed(3)+"px,0)";
  }else{
    const vw=typeof innerWidth==="number"?innerWidth:1920;
    const vh=typeof innerHeight==="number"?innerHeight:1080;
    const w=h.well.el.offsetWidth||h.w;
    // sideways it may hang off; the top is the frame's, or the bar cannot be reached again
    const top = inspFrame(h.well.el.parentNode).y0;
    h.wx=Math.max(INSPW_MIN_VIS-w, Math.min(vw-INSPW_MIN_VIS, h.wx));
    h.wy=Math.max(top, Math.min(vh-24, h.wy));
    tf="translate3d("+Math.round(h.wx)+"px,"+Math.round(h.wy)+"px,0)";
  }
  if(h.wtf!==tf){ h.well.el.style.transform=tf; h.wtf=tf; }
}

/* the chevron is not redrawn folded: the class on the window turns it */
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
  h.keyShut=KIT.button("CLOSE",{flat:true,icon:INSPW_ICON.shut,
    tip:"Close this window.",onClick:()=>h.onShut?h.onShut(h):inspClose(h)});
  keys.append(h.keyFold.el,h.keyShut.el);
  h.well.head.appendChild(keys);
}
/* which side of the window the leader leaves by: the target's own bearing, weighed against the box's
   aspect so a wide panel does not take a top face for a target barely above it */
function inspLeadFace(q,a){
  const dx=a.x-(q.x+q.w/2), dy=a.y-(q.y+q.h/2);
  return Math.abs(dx)*q.h >= Math.abs(dy)*q.w ? (dx>=0?"r":"l") : (dy>=0?"b":"t");
}
// the middle of that face, wherever the target stands: a leader that slides along the edge reads as a moving part
function inspLeadPort(q,f){
  if(f==="l"||f==="r") return {x: f==="r"? q.x+q.w : q.x, y: q.y+q.h/2};
  return {x: q.x+q.w/2, y: f==="b"? q.y+q.h : q.y};
}

/* re-read off the live DOM box every frame, so pan, zoom and drag need no listeners */
function inspLeaders(host){
  if(!host||typeof LAY==="undefined"||!LAY||!host._wins.length) return;
  const pad=3, vx0=VIEW.x+pad, vx1=VIEW.x+VIEW.w-pad, vy0=VIEW.y+pad, vy1=VIEW.y+VIEW.h-pad;
  if(vx1<=vx0||vy1<=vy0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  for(const h of host._wins){
    if(!h.key){ const p=partOf(h.p.id); if(!p) continue; h.p=p; }
    const q=hostRect(h.well.el); if(q.h<1) continue;
    const box=panRectOf(h); if(!box) continue;
    const mid=panMidOf(h) || {x:box.x+box.w/2, y:box.y+box.h/2};
    const c=vScr(mid);
    const pf=inspLeadFace(q,c);
    // the machine's own face is the one that looks back at the window
    const s0 = h.key ? c : vScr(leaderAnchor(box,OPP[pf]));
    // clamped, not culled: the leader still says which way the machine went
    const a={x:clamp(s0.x,vx0,vx1), y:clamp(s0.y,vy0,vy1)};
    const b=inspLeadPort(q,pf);
    // standing ON the window: every route to the edge crosses the panel, so there is no leader to draw
    if(a.x>q.x-2 && a.x<q.x+q.w+2 && a.y>q.y-2 && a.y<q.y+q.h+2) continue;
    const flat = pf==="l"||pf==="r";
    if(Math.abs(flat ? b.x-a.x : b.y-a.y)<8) continue;   // sitting on its own machine: no room to turn
    // the turn is made in the axis the face points along, or the line would run back across the window
    const g = flat ? (a.x+b.x)/2 : (a.y+b.y)/2;
    const pts = flat
      ? (Math.abs(a.y-b.y)<1 ? [a,b] : [a,{x:g,y:a.y},{x:g,y:b.y},b])
      : (Math.abs(a.x-b.x)<1 ? [a,b] : [a,{x:a.x,y:g},{x:b.x,y:g},b]);
    leaderStroke(pts, h.id===sel?C.amber:C.lead, [a,b], cvPx(), LEADER_RAD);
  }
  ctx.restore();
}

/* re-pointed, not rebuilt; the container is wiped because both body syncs key off handles hung on it */
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

// the run was cut or the wall scrubbed out from under a pinned window
const inspKeyAlive = h => h.key==="run" ? isRunKey(h.id) : isMatKey(h.id);

// the screen whose windows a peek is handed to
let INSPW_HOST=null;

function inspSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  INSPW_HOST=host;
  const pick = sel || null;
  /* spent on the change: re-raising every frame would move a DOM node sixty times a second */
  if(host._pickAt!==pick){
    host._pickAt=pick;
    const on = pick && host._wins.find(h=>h.id===pick);
    if(on) inspRaise(on);
  }

  const t=panTick(live);
  for(const h of host._wins.slice()){
    // a pinned window is read on the key it was pinned on, never on what the hand has picked since
    if(h.key){
      if(!inspKeyAlive(h)){ inspClose(h); continue; }
      marginKeyFill(h,h.id,t.fresh||h._force,live);
      h._force=false;
      marginColumns(h);
      inspMove(h);
      continue;
    }
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
