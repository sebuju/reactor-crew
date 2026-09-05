"use strict";
/* A panel per machine, anchored in plant space beside the box it describes.
   One mechanism for both screens; a second reader of readoutsFor()/ctlFor(),
   never a second table. */

const MARGIN_W=268, MARGIN_GAP=6, MARGIN_PAD=30;
/* A PANEL TOO TALL TO READ GETS MORE COLUMNS RATHER THAN A SECOND SCREEN OF
   HEIGHT - so its own MEASURED HEIGHT decides how many, and nothing here names
   a role. It was the BLOCK COUNT, which is not the same question: every tank
   has 16 blocks and stands 882px, which fits in one, and all four went two-wide
   beside a reactor that has 24 and stands 2870 and wants three. */
/* THE COLUMNS BUTT, so a panel is a WHOLE NUMBER OF CELLS wide however many it
   has. MARGIN_W is 268 and CELL is 134, so one column is exactly 2 cells - and a
   gap of 8 between columns made two of them 4.06, which is 3 cells of deck
   reserved to draw 2.06 of panel. n*268 over 134 is 2n with the gap gone. */
const MARGIN_COL_GAP=0, MARGIN_TALL=1200, MARGIN_COLS_MAX=3;
const marginColW=n=>n*MARGIN_W+(n-1)*MARGIN_COL_GAP;
/* AND PANELS ALONG ONE EDGE STAND IN GROUPS. The cascade sorted on board
   position alone, so the primary's own panels were broken up by a loop and by
   the secondary - measured on the stock plant, the top edge ran circ0, loop0,
   circ1, circ0, circ0, loop0... The group is a SORT KEY here, not a move: a
   panel still goes to the edge its own machine is nearest, because a short
   leader is what makes the association readable at all, and the group only
   decides the order along that edge and where the wider gaps fall. */
const MARGIN_GRP_GAP=26;
// false puts the rail's own column of machine panels back
const MARGIN_ONLY=true;
// what the plant view gives up so there is deck to stand a panel on
const MARGIN_IN={l:MARGIN_W+MARGIN_PAD, r:MARGIN_W+MARGIN_PAD, t:92, b:92};

// getBoundingClientRect() flushes layout, so it is read once a frame and never
// inside the placement loop, which writes styles
let marginRc=null, marginRcAt=-1;
function marginCv(){
  if(marginRcAt!==marginFrame){ marginRc=cv.getBoundingClientRect(); marginRcAt=marginFrame; }
  return marginRc;
}
// layout units -> viewport px; the inverse of hostRect(), and the host is fixed
function marginPage(x,y,rc){
  rc=rc||marginCv();
  return {x:rc.left + x*rc.width/W,
          y:rc.top  + (y-TOPBAR_H)*rc.height/Math.max(1,H-TOPBAR_H)};
}
// MARGIN_IN is CSS px because a panel is; the view is layout units
function marginInsetU(){
  const rc=marginCv();
  const sx=W/Math.max(1,rc.width), sy=(H-TOPBAR_H)/Math.max(1,rc.height);
  return {l:MARGIN_IN.l*sx, r:MARGIN_IN.r*sx, t:MARGIN_IN.t*sy, b:MARGIN_IN.b*sy};
}

function marginHost(root){
  const el=KIT.el("div","margin-host");
  // the panels cover #cv, so the canvas never sees a wheel that starts on one
  el.addEventListener("wheel",e=>{
    e.preventDefault();
    ctxClose();
    vWheel(local(e), e.deltaY);
  },{passive:false});
  /* a panel covers the deck, so a right drag on one pans like the deck. Its own
     state rather than ui.drag: uiMove() belongs to a surface that hit-tests. */
  ctxSuppress(el);
  let pan=null;
  el.addEventListener("pointerdown",e=>{
    if(e.button!==2 || e.shiftKey) return;
    el.setPointerCapture(e.pointerId);
    ctxClose();
    const lp=local(e); pan={x:lp.x,y:lp.y};
  });
  el.addEventListener("pointermove",e=>{
    if(!pan) return;
    const lp=local(e);
    VIEW.ox-=(lp.x-pan.x)/VIEW.s; VIEW.oy-=(lp.y-pan.y)/VIEW.s;
    pan.x=lp.x; pan.y=lp.y; uiDirty();
  });
  const drop=()=>{ pan=null; };
  el.addEventListener("pointerup",drop);
  el.addEventListener("pointercancel",drop);
  root.appendChild(el);
  return el;
}

/* One handle shape for every panel. `rect` answers the LAYOUT-space box the
   panel is anchored beside - a machine's own box, a run's cells, a painted
   cell - so marginPlace() never asks what kind of thing it is placing. */
function marginPan(host,title,rect,p){
  const well=KIT.well({title});
  well.el.classList.add("margin-pan");
  // placed at the origin once; every frame after this moves it by transform
  well.el.style.left="0px"; well.el.style.top="0px";
  well.el.style.width=MARGIN_W+"px";
  /* THE RAIL'S OWN BODY CLASS, because dbPanelSync() fills this with the rail's
     own blocks - so the block spacing and the column rules (plant-screens.css)
     are written once and apply wherever a panel stands. It was `margin-body`,
     which nothing styled: the reactor's panel took the two-column WIDTH and
     kept one column of content, and the width alone made it look right. */
  const body=KIT.el("div","db-panel-body"); well.body.appendChild(body);
  host.appendChild(well.el);
  // the router addresses a connector by key, so every panel carries one name -
  // its machine's id, or "run"/"mat" for the two the selection addresses
  return {p,rect,well,body,id:p?p.id:title,on:null,ctl:null,cells:null,nRows:0,
          w:MARGIN_W,cols:1,vis:true,hid:false,tf:null,needH:true,_hpx:null};
}
function marginCols(h,n){
  if(h.cols===n) return;
  h.cols=n; h.w=marginColW(n);
  h.well.el.classList.toggle("cols",n>1);
  h.well.el.style.setProperty("--margin-cols",n);
  h.well.el.style.width=h.w+"px";
  h.needH=true;
}
/* Asked of the height just measured, so the answer is about the panel actually
   standing there. Its SINGLE-column height is what decides, and that is the
   measurement times the columns it is already in - near enough, since columns
   balance. Growing is immediate; shrinking wants a tenth of slack, or a panel
   sitting on a threshold flaps between two counts every frame. A change costs
   one extra measure, and only when it changes. */
function marginColumns(h){
  if(h.fixW) return;
  // a stated count beats the height rule, which knows nothing of where to cut
  const want0=h.body&&h.body._cols;
  if(want0){ if(h.cols===want0) return;
    marginCols(h,want0); h._hpx=h.well.el.offsetHeight||60; h.needH=false; return; }
  const est=h._hpx*h.cols;
  const want=Math.max(1,Math.min(MARGIN_COLS_MAX,Math.ceil(est/MARGIN_TALL)));
  if(want===h.cols) return;
  if(want<h.cols && est > MARGIN_TALL*want*0.9) return;
  marginCols(h,want);
  h._hpx=h.well.el.offsetHeight||60; h.needH=false;
}
function marginBuild(host,live){
  host.innerHTML="";
  const out=[];
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    const h=marginPan(host,partName(p),()=>prect(h.p),p);
    railPick(h.well,[p.id],partName(p));
    out.push(h);
  }
  /* ══ AND A RUN AND A WALL CELL STAND ON THE PLANT TOO ══
     Neither is a part, so neither is in the loop above - and both were only
     reachable down a rail, which is the one place the thing they describe is
     not drawn. One panel each, anchored on the drawing they were picked off,
     shown only while that pick stands. Bench only: a run's bore and a wall's
     thickness are DESIGN, and the control room sets neither. */
  if(!live) out.push(marginPanKey(host,"run"));
  out.push(marginPanKey(host,"mat"));
  // a list of every run names no machine, so there is no leader to draw
  out.push(marginPanBoard(host, live?"cnx":"pipes", "PIPES", "tr"));
  /* AND THE NOZZLE VALVES ARE THEIR OWN LIST. A port valve is what cuts a run
     out, so it was a second list under the runs - but the two answer different
     questions ("is it still there" and "is it lined up") and one panel made
     each of them a scroll away from the other. */
  if(live) out.push(marginPanBoard(host,"ports","PORT VALVES","tr"));
  return out;
}
function marginPanBoard(host,key,title,corner){
  const h=marginPan(host,title,()=>null,null);
  h.board=key; h.corner=corner; h.id=key;
  h.well.el.classList.add("margin-board");
  if(key==="pipes"){ h.fixW=marginColW(2); h.w=h.fixW; h.well.el.style.width=h.w+"px"; }
  return h;
}
// the two selection-addressed panels: no part, so the anchor follows `sel`
function marginPanKey(host,key){
  const h=marginPan(host,key==="run"?"PIPE RUN":"WALL",()=>marginKeyRect(h));
  h.key=key; h.id=key; h.selAt=null;
  return h;
}
/* ══ THE BOUNDARY'S OWN PANEL STANDS ON THE BOUNDARY ══
   It was pinned to a corner because a hundred painted cells give no single
   anchor to run a leader to - true, and it put the wall's panel at the far end
   of the board from the wall. ANY cell of it is an anchor: the picked one while
   one is picked, otherwise the ring's own top-left, which is stable for a given
   drawing and is a piece of the thing the panel is about. */
// matCells() (paint.js) is the KEY list; this is the same set as x,y pairs
function matCellsXY(){
  return matCells().map(k=>{ const i=k.indexOf(",");
    return [+k.slice(0,i), +k.slice(i+1)]; });
}
// the leader still needs ONE cell to point at, and the ring's top-left is stable
function matAnchorCell(){
  let best=null;
  for(const c of matCellsXY())
    if(!best || c[1]<best[1] || (c[1]===best[1] && c[0]<best[0])) best=c;
  return best;
}
function marginKeyRect(h){
  const k=h.selKey;
  if(h.key==="mat"){
    const c = k ? matKeyXY(k) : matAnchorCell();
    if(!c) return null;                       // nothing painted: no anchor, no seat
    return {x:PXc(c[0]), y:PYc(c[1]), w:CELL, h:CELL}; }
  if(!k) return null;
  const r=runOfKey(k); if(!r||!r.pts.length) return null;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of r.pts){ x0=Math.min(x0,q[0]); x1=Math.max(x1,q[0]);
                         y0=Math.min(y0,q[1]); y1=Math.max(y1,q[1]); }
  return {x:x0, y:y0, w:Math.max(CELL,x1-x0), h:Math.max(CELL,y1-y0)};
}

/* ctlFor() hands back fresh closures every frame, so a handler closes over the
   SLOT and the sync re-points it. `deep` asks a slider whether its range still
   holds - two closure calls per slider, so only when something could have
   moved it. */
function marginCtlMatch(h,rows,deep){
  if(!h.cells || h.nRows!==rows.length) return false;
  let i=0;
  for(const row of rows) for(const c of row){
    const s=h.cells[i++]; if(!s) return false;
    if(s.kind!==(c.kind||"btn")) return false;
    if(deep && c.kind==="sld" && (s.min!==c.min() || s.max!==c.max())) return false;
  }
  return i===h.cells.length;
}
const marginCtlLabel=c=> c.kind==="arm" ? c.label()+"  "+(c.on&&c.on()?"BYP":"AUTO")
                                        : c.text();
/* A NUDGE KEY MOVES THE CONTROL, NEVER THE WIDGET: it goes through the same
   slot.c.set() the drag does, so a step is an ordinary act. The step is the
   control's own where it states one, and a twentieth of its span otherwise. */
function marginSldStep(slot,dir){
  const c=slot.c; if(c.inert) return;
  const lo=c.min(), hi=c.max(), st=c.step||(hi-lo)/20;
  const v=Math.max(lo,Math.min(hi,c.val()+dir*st));
  c.set(c.step?Math.round(v/c.step)*c.step:v);
}
function marginCtlBuild(h,rows){
  h.ctl.innerHTML=""; h.cells=[]; h.nRows=rows.length; h.needH=true;
  for(const row of rows){
    const ports = row[0] && row[0].kind==="port";
    const r=KIT.el("div", ports?"margin-ports":"margin-ctl-row"); h.ctl.appendChild(r);
    for(const c of row){
      const slot={c:c, w:null, kind:c.kind||"btn",
                  min:c.kind==="sld"?c.min():0, max:c.kind==="sld"?c.max():0};
      let w, el;
      if(c.kind==="sld"){
        w=KIT.slider({min:c.min(), max:c.max(), step:c.step||undefined, fmt:c.fmt,
          mark:c.mark?c.mark():null, val:c.val(), dem:c.dem?c.dem():null, tip:c.tip,
          onChange:v=>{ const k=slot.c;
            if(!k.inert) k.set(k.step?Math.round(v/k.step)*k.step:v); }});
        el=KIT.el("div","margin-sld");
        const minus=KIT.button("−",{flat:true,size:7,onClick:()=>marginSldStep(slot,-1)});
        const plus =KIT.button("+",     {flat:true,size:7,onClick:()=>marginSldStep(slot, 1)});
        minus.el.classList.add("margin-sld-step"); plus.el.classList.add("margin-sld-step");
        el.append(minus.el,w.el,plus.el);
      }else{
        w=KIT.button(marginCtlLabel(c),{flat:true,size:7,tip:c.tip,
          onClick:()=>{ const k=slot.c; if(!k.inert&&k.fn) k.fn(); }});
        if(ports) w.el.classList.add("margin-port");
        el=w.el;
      }
      slot.w=w;
      // a port list is a COLUMN, so a flex basis there shares out height
      if(!ports) el.style.flex=(c.flex||1)+" 1 0";
      r.appendChild(el);
      h.cells.push(slot);
    }
  }
}
function marginCtlSync(h,live,deep){
  let rows=ctlFor(h.p,live,live&&S.split);
  // a wrecked machine takes no orders, and the refusal is the sim's - these
  // keys only have to stop LOOKING as though they would be answered
  if(rows&&live&&partWrecked(S,h.p.id)) rows=ctlDead(rows);
  if(rows&&!live) rows=ctlBench(rows);
  if(!rows||!rows.length){ if(h.ctl) KIT.show(h.ctl,false); return; }
  if(!h.ctl) h.ctl=KIT.el("div","margin-ctl");
  // in the body so it rides the panel's columns; re-seated because both body
  // syncs wipe innerHTML on a rebuild
  const first = live ? h.body.firstChild : null;
  if(h.ctl.parentNode!==h.body || (live ? first!==h.ctl : h.body.lastChild!==h.ctl))
    live ? h.body.insertBefore(h.ctl,first) : h.body.appendChild(h.ctl);
  /* the bench seats the block at the BOTTOM of the body, so it bleeds the
     other way - but only where something stands above it. Alone in the panel
     it is the whole body and the top gap would be a band of nothing. */
  h.ctl.classList.toggle("at-end", !live && h.body.childElementCount>1);
  KIT.show(h.ctl,true);
  if(!marginCtlMatch(h,rows,deep)) marginCtlBuild(h,rows);
  let i=0;
  for(const row of rows) for(const c of row){
    const slot=h.cells[i++]; if(!slot) break;
    slot.c=c;
    if(c.kind==="sld") slot.w.set(c.val(), c.dem?c.dem():null);
    else{
      slot.w.set({label:marginCtlLabel(c), on:!!(c.on&&c.on()), disabled:!!c.inert});
      slot.w.el.classList.toggle("kit-btn-danger", !!(c.danger&&c.danger()));
    }
  }
}

/* WHAT THIS BOX'S OWN METAL IS AT, on the title bar rather than in a row: it
   is one figure with a limit, and it is wanted on every panel at a glance.
   Degrees Celsius here alone - the panel is read by a human, the sim is in K,
   and the conversion is the readout's, never the model's. */
function marginSkinSync(h){
  if(!h.well.sfx) return;
  const lim=partTsurv(h.p);
  const t=lim?partSkin(S,h.p):null;
  h.well.setSfx(t===null?"":(t-273.15).toFixed(0)+"°C");
  if(lim){ const col = t>=lim ? C.red : t>=lim*0.85 ? C.amber : "";
    if(h._skinCol!==col){ h._skinCol=col; h.well.sfx.style.color=col; } }
}

// the plant edge the machine is nearest
function marginSide(r,box){
  const cx=r.x+r.w/2, cy=r.y+r.h/2;
  let best="l", bd=cx-box.x;
  const bid=(d,s)=>{ if(d<bd){ bd=d; best=s; } };
  bid(box.x+box.w-cx,"r"); bid(cy-box.y,"t"); bid(box.y+box.h-cy,"b");
  return best;
}
/* scales with the plant, continuously. A stepped k drifts against the drawing:
   the footprint it reserves moves in steps while VIEW.s moves smoothly, and the
   panel walks a few px per step. `zoom` re-lays out crisply at any value, so
   there is nothing left for the steps to buy. */
const marginUPerPx=()=>(W/Math.max(1,marginCv().width))/Math.max(1e-6,VIEW.s);
/* ══ A PANEL IS 268 PLANT UNITS WIDE, FULL STOP ══
   It was VIEW.s/VIEW.fit, which pegs a panel to its CSS size at whatever the FIT
   happens to be - so MARGIN_W meant "268 px when the whole ship is on screen" and
   the panel's size against the machinery moved every time the fit did. It is the
   exact inverse of marginUPerPx() now, so MARGIN_W, MARGIN_PAD and MARGIN_GAP are
   plant units like every other size on the board, and CELL (layout.js) is then the
   one figure deciding how big a machine is against its own readout. */
const marginZoomK=()=>1/Math.max(1e-6,marginUPerPx());
// the VIEW.s at which marginZoomK() is exactly 1 - past it a panel is magnified
// past its own pixels, which is where vScale() stops the zoom (core/ui.js)
const marginZoomMaxS=()=>W/Math.max(1,marginCv().width);

/* ══ A PANEL STANDS ON THE BOARD, IN CELLS, ON GROUND NOTHING ELSE IS USING ══
   The cascade this replaces put every panel out in a margin and drew a routed
   leader back to its machine, because at CELL 16 a panel was wider than the
   reactor and there was nowhere on the board to put one. There is now.

   THE BOARD IS THE ONLY PLACE IT MAY STAND: cell-snapped, inside the grid, on
   cells occupied() calls free - so it covers no machine, no tank, no fitting,
   no nozzle, no pipe cell and no painted structure. Grid lines it may cover;
   they are the one thing drawn under everything else.

   AND IT MAY STAND HARD AGAINST THE BOX. There was a clear cell demanded on
   every side; bolted straight onto its machine the panel needs no leader at all
   (marginLeaders), which takes a line off the drawing rather than reserving a
   ring of deck to keep one readable.

   NEAREST WINS, and the BIGGEST PANEL CHOOSES FIRST: a small panel can find
   somewhere almost anywhere, a ten-cell one cannot, and letting the small ones
   settle first walled the big ones off the board entirely. */
// a rect of free cells, in O(1), off a summed-area table of the free map
/* ══ THE BOARD IS NOT THE EDGE OF THE WORLD ══
   A panel may stand OFF the hull: there is nothing drawn out there, so nothing to
   cover, and the machinery along the hull plating had nowhere on the inside to
   put its readout. The search therefore runs over a padded frame - the grid with
   SLOT_PAD cells of open deck round it - and every cell outside the grid is free
   by construction. Cell coordinates stay the drawing's own and go NEGATIVE off
   the bow; only the array index is shifted. */
const SLOT_PAD=14;
const eW=()=>GW+2*SLOT_PAD, eH=()=>GH+2*SLOT_PAD;
function marginFreeSum(free){
  const W=eW(), H=eH(), S=new Int32Array((W+1)*(H+1));
  for(let y=0;y<H;y++) for(let x=0;x<W;x++)
    S[(y+1)*(W+1)+x+1] = free[y][x] + S[y*(W+1)+x+1] + S[(y+1)*(W+1)+x] - S[y*(W+1)+x];
  return S;
}
// x,y are CELL coordinates and may be negative; the +SLOT_PAD is the index shift
const marginSumAt=(S,x,y,w,h)=>{
  const W=eW(), x0=x+SLOT_PAD, y0=y+SLOT_PAD;
  return S[(y0+h)*(W+1)+x0+w] - S[y0*(W+1)+x0+w]
       - S[(y0+h)*(W+1)+x0] + S[y0*(W+1)+x0];
};
const marginFreeAt=(S,x,y,w,h)=>marginSumAt(S,x,y,w,h)===w*h;
// how much of rect A a rect B covers, in cells
const marginOverlap=(ax,ay,aw,ah,b)=>
  Math.max(0, Math.min(ax+aw,b.x+b.w)-Math.max(ax,b.x)) *
  Math.max(0, Math.min(ay+ah,b.y+b.h)-Math.max(ay,b.y));

const marginCellsOf=r=>({x:Math.round((r.x-GX)/CELL), y:Math.round((r.y-GY)/CELL),
                         w:Math.max(1,Math.round(r.w/CELL)), h:Math.max(1,Math.round(r.h/CELL))});

/* ONCE PER CHANGE, NOT ONCE PER FRAME. The search is O(GW*GH) per panel with an
   O(1) rect test, which is 51k tests on the stock board - nothing as a one-off
   and a real frame cost sixty times a second. LAY is rebuilt by buildLayout()
   whenever the drawing changes, so its identity plus the panel sizes is the
   whole of what a placement depends on. */
let slotSig=null;
function marginSlot(panels){
  let sig=GW+"x"+GH;
  for(const h of panels) sig += "|"+h.id+":"+h.w+","+h._hpx;
  /* the PANEL LIST itself is part of the key: marginBuild() hands back a fresh
     set of objects with no _slot on them, and a rebuild that happens to produce
     the same ids and sizes would otherwise return early and drop every panel
     back to the margin. */
  if(slotSig && slotSig.lay===LAY && slotSig.sig===sig && slotSig.panels===panels) return;
  slotSig={lay:LAY, sig, panels};
  /* ══ ONE RULE: COVER NOTHING. TOUCHING IS FINE, AND IT IS THE POINT ══
     There was a clear-cell ring as well, so a panel could not sit against the
     machine it describes. Bolted straight onto the box the association needs no
     leader at all, which is a line off the drawing rather than a gap on it. */
  /* TWO MAPS AGAIN, AND THIS TIME THEY ARE ABOUT TWO DIFFERENT NEIGHBOURS.
     COVER is what is DRAWN - machines, pipework, nozzles, painted structure - and
     a panel may stand hard against any of it. FREEP is what other PANELS may use,
     and a seated panel blocks its own cells PLUS a ring: two panels touching, even
     at one corner, read as a single wider panel and the board loses the seam. */
  const occ=occupied(null,{pipes:true,ports:true,mat:true});
  const W=eW(), H=eH();
  const cover=new Array(H), coverX=new Array(H), freep=new Array(H), mach=new Array(H);
  for(let iy=0;iy<H;iy++){
    cover[iy]=new Uint8Array(W); coverX[iy]=new Uint8Array(W);
    freep[iy]=new Uint8Array(W).fill(1);
    mach[iy]=new Uint8Array(W);
    const y=iy-SLOT_PAD;
    for(let ix=0;ix<W;ix++){
      const x=ix-SLOT_PAD;
      const inGrid = x>=0&&x<GW&&y>=0&&y<GH;
      const o = inGrid ? occ[y][x] : null;             // off the hull nothing is drawn
      cover[iy][ix] = o ? 0 : 1;
      /* THE WALL'S OWN PANEL MAY STAND ON THE WALL. It is the only panel that is
         ABOUT the paint, so covering a stretch of it is not hiding something the
         reader needs from somewhere else - and the corner of the ring, which is
         where it belongs, is made of the stuff. */
      coverX[iy][ix] = (o && !o.mat) ? 0 : 1;
    }
  }
  /* ══ A CELL CLEAR OF EVERY MACHINE BUT ITS OWN ══
     Touching the box it describes is the association; touching somebody else's is
     a panel that reads as belonging to the wrong machine. Asked in O(1): the
     machine cells inside the candidate's GROWN rect must be exactly what its own
     box contributes there, so any other machine in the ring fails it. */
  for(const p of LAY.parts)
    for(let y=p.y;y<p.y+p.h;y++) for(let x=p.x;x<p.x+p.w;x++){
      const iy=y+SLOT_PAD, ix=x+SLOT_PAD;
      if(iy>=0&&iy<H&&ix>=0&&ix<W) mach[iy][ix]=1;
    }
  /* AND THE ROW A SHORT MACHINE WEARS ITS NAME IN. A box too short for a name
     row prints it ABOVE itself (drawSym's caller, plant.js), on cells occupied()
     knows nothing about - so a fitting's or a small pump's label was the one
     thing a panel could still bury. COVER only: standing beside a name is fine. */
  for(const p of LAY.parts){
    if(nameRowH(p)) continue;
    const y=p.y-1;
    for(let x=p.x;x<p.x+p.w;x++) cover[y+SLOT_PAD][x+SLOT_PAD]=0;
  }

  const want=[];
  for(const h of panels){
    if(h.corner || !h._mr) continue;
    h._slot=null; h._att=false;
    /* A BOUNDARY IS NEAR THE PIECE OF IT THAT IS NEAREST. Anchored on one cell of
       the ring it was measured against a corner of a hundred-cell wall and landed
       seven cells off a wall it is touching elsewhere. `near` is the whole set,
       and the cost below takes the closest. */
    want.push({h, m:marginCellsOf(h._mr),
               near: h.key==="mat" ? matCellsXY() : null,
               w:Math.max(1,Math.ceil(h.w/CELL)),
               ht:Math.max(1,Math.ceil(h._hpx/CELL))});
  }
  /* BIGGEST FIRST, and the BOUNDARY LAST WHATEVER ITS SIZE. Every other panel is
     about one box and has one right place; the wall is the length of the board,
     so anywhere along it will do - and letting it choose early took ground a
     machine's panel had only one candidate for. It takes what is left. */
  want.sort((a,b)=> (!!a.near - !!b.near) || (b.w*b.ht)-(a.w*a.ht));

  /* ATTACHED IS A FACT ABOUT THE GEOMETRY, NOT ABOUT WHICH PASS PLACED IT.
     Taken from the pass, a panel that met its machine at a CORNER in the loose
     pass was recorded as unattached and drew a leader across the one cell it was
     already touching. Corner counts: the two boxes meet, and that is the whole of
     what the line was there to say. */
  const touchesOwn=(q,x,y)=>{
    const m=q.m;
    return !q.near && x-1 < m.x+m.w && x+q.w+1 > m.x
                   && y-1 < m.y+m.h && y+q.ht+1 > m.y;
  };
  const place=(q,x,y)=>{
    q.h._slot={x, y, w:q.w, h:q.ht};
    q.h._att=touchesOwn(q,x,y);
    // a seated panel is drawn ground to the next one, in BOTH cover maps...
    for(let py=y;py<y+q.ht;py++) for(let px=x;px<x+q.w;px++){
      cover[py+SLOT_PAD][px+SLOT_PAD]=0; coverX[py+SLOT_PAD][px+SLOT_PAD]=0; }
    // ...and it takes a ring with it, so no two panels ever share even a corner
    for(let py=y-1;py<=y+q.ht;py++) for(let px=x-1;px<=x+q.w;px++){
      const iy=py+SLOT_PAD, ix=px+SLOT_PAD;
      if(iy>=0&&iy<H&&ix>=0&&ix<W) freep[iy][ix]=0;
    }
  };
  /* ══ ATTACHED IS A DIFFERENT ANSWER, SO IT IS A DIFFERENT PASS ══
     Ranking every candidate by centre-to-centre distance never actually prefers
     sharing an edge - a spot a cell off the corner scores better than one along
     the face, so panels that had a face free sat loose beside it. And it cannot
     be a weight either: a panel that CAN attach must, before a panel that cannot
     takes the ground. So every panel is offered its own machine's faces first,
     and only what is left over goes looking anywhere. */
  /* A SIDE, AND TOPS LEVEL. A panel is a tall column of rows, so it reads beside
     a machine and sits awkwardly over or under one; and a row of panels whose top
     edges line up reads as a rack, while the same panels staggered read as
     scattered. So the rungs are: LEFT or RIGHT face with the tops flush, then a
     side at any height, then top or bottom - and distance only separates ties
     inside a rung. */
  const attachRung=(q,x,y)=>{
    const m=q.m;
    const hOv = x < m.x+m.w && x+q.w > m.x;
    const vOv = y < m.y+m.h && y+q.ht > m.y;
    const side = vOv && (x+q.w===m.x || m.x+m.w===x);
    if(side) return y===m.y ? 0 : 1;
    if(hOv && (y+q.ht===m.y || m.y+m.h===y)) return 2;
    return -1;                                   // not touching its own box
  };
  /* THE BOUNDARY'S PANEL GOES TO THE BOUNDARY'S OWN CORNER. Measured against the
     BOARD's four corners it went to the bow, which is a corner of the ship and
     nothing to do with the wall it describes. The ring's bounding box is the
     thing that has corners worth naming. */
  const matBox=(()=>{
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const c of matCellsXY()){
      x0=Math.min(x0,c[0]); x1=Math.max(x1,c[0]+1);
      y0=Math.min(y0,c[1]); y1=Math.max(y1,c[1]+1); }
    return x1>x0 ? {x0,y0,x1,y1} : null;
  })();
  const cornerCost=(x,y,w,h)=>{
    const b=matBox; if(!b) return 0;
    const cx=x+w/2, cy=y+h/2;
    let best=Infinity;
    for(const [gx,gy] of [[b.x0,b.y0],[b.x1,b.y0],[b.x0,b.y1],[b.x1,b.y1]]){
      const dx=cx-gx, dy=cy-gy, d=dx*dx+dy*dy; if(d<best) best=d; }
    return best;
  };
  const insideContainment=(x,y,w,h)=>{
    for(let py=y;py<y+h;py++) for(let px=x;px<x+w;px++)
      if(matRegionAt(px,py)) return true;
    return false;
  };
  const search=(q,mustAttach)=>{
    // the wall's panel is scored against the map that lets it stand on the wall
    const SC=marginFreeSum(q.near?coverX:cover), SP=marginFreeSum(freep), SM=marginFreeSum(mach);
    const mcx=q.m.x+q.m.w/2, mcy=q.m.y+q.m.h/2;
    // the boundary panel names no box, so EVERY machine is somebody else's
    const own=q.near ? {x:0,y:0,w:0,h:0} : q.m;
    let best=null, bestC=Infinity;
    for(let y=-SLOT_PAD;y+q.ht<=GH+SLOT_PAD;y++)
    for(let x=-SLOT_PAD;x+q.w<=GW+SLOT_PAD;x++){
      let rung=0;
      if(mustAttach){ rung=attachRung(q,x,y); if(rung<0) continue; }
      if(!marginFreeAt(SC,x,y,q.w,q.ht)) continue;      // covers nothing drawn
      if(!marginFreeAt(SP,x,y,q.w,q.ht)) continue;      // touches no other panel
      { // ...and no machine but its own is within a cell of it
        const gx=Math.max(-SLOT_PAD,x-1), gy=Math.max(-SLOT_PAD,y-1);
        const gw=Math.min(GW+SLOT_PAD,x+q.w+1)-gx, gh=Math.min(GH+SLOT_PAD,y+q.ht+1)-gy;
        if(marginSumAt(SM,gx,gy,gw,gh) !== marginOverlap(gx,gy,gw,gh,own)) continue;
      }
      const px=x+q.w/2, py=y+q.ht/2;
      let c;
      if(q.near){
        if(insideContainment(x,y,q.w,q.ht)) continue;   // the wall's panel stands OUTSIDE it
        /* ══ AND ITS EDGES LINE UP WITH THE WALL'S ══
           A panel sitting near a corner but a cell off both of its lines reads as
           dropped there. Flush with the ring's own edges it continues them, which
           is the thing the eye is actually following. Two lines beat one, one
           beats none, and the distance to the corner only separates ties. */
        /* EITHER EDGE ON EITHER LINE, which includes standing flush OUTSIDE the
           ring - right edge on its left line, top edge on its bottom line. Only
           the inner two were tested, and the one corner that satisfied both is
           inside the enclosure, which the panel may not enter: so it aligned on a
           single line and hung off the side of the other. */
        const b=matBox;
        const on=(a,z)=>a===b[z+"0"] || a===b[z+"1"];
        const ax = b && (on(x,"x") || on(x+q.w,"x")) ? 1 : 0;
        const ay = b && (on(y,"y") || on(y+q.ht,"y")) ? 1 : 0;
        rung = 2-(ax+ay);
        c=cornerCost(x,y,q.w,q.ht);
      }
      else { const dx=px-mcx, dy=py-mcy; c=dx*dx+dy*dy; }
      const cost = rung*1e6 + c;
      if(cost<bestC){ bestC=cost; best=[x,y]; }
    }
    return best;
  };

  const loose=[];
  for(const q of want){
    // the boundary names no box, so there is no face for it to be bolted to
    const b = q.near ? null : search(q,true);
    if(b) place(q,b[0],b[1]); else loose.push(q);
  }
  for(const q of loose){
    const b=search(q,false);
    if(b) place(q,b[0],b[1]);                 // may still meet its machine at a corner
    // else: no room anywhere, and it keeps the cascade
  }
}

/* ══ WHERE THE PANELS ARE STANDING, FOR WHOEVER ELSE WANTS THE GROUND ══
   A panel covers no CELL anything is drawn in, but a run's reading is placed off
   the pipe (pipeAnchors(), pipes.js) and lands on cells nothing owns. That
   allocator already prices how much of another reading a spot would smear, so a
   panel only has to join the list it is already scoring against. In PLANT UNITS,
   because that is what the allocator works in. */
function marginBoxes(){
  const out=[];
  for(const h of (MARGIN||[])){
    if(!h._slot || !h.vis) continue;
    out.push(grect(h._slot.x, h._slot.y, h._slot.w, h._slot.h));
  }
  return out;
}

/* ══ A PANEL IS A WHOLE NUMBER OF CELLS TALL, NOT JUST WIDE ══
   MARGIN_W over CELL is exactly 2, so a panel's WIDTH snaps by construction; its
   height is whatever its content measures and snapped to nothing - 24 of 24
   landing on a fraction of a cell, one wasting 0.98 of one. The reservation
   rounded up either way, so the deck was already spent; all this does is let the
   panel FILL what it was standing on.
   MEASURED WITH THE FLOOR TAKEN OFF FIRST, or the second pass reads back its own
   padding and a panel could only ever grow. min-height, not height, so content
   that outgrows the box still shows and is re-measured on the next change. */
function marginMeasure(h){
  h.well.el.style.minHeight="";
  h.well.el.offsetHeight;                     // natural height, pre-columns
  marginColumns(h);                           // may change the column count, so re-read
  const nat=h.well.el.offsetHeight||60;
  const pad=Math.max(CELL, Math.ceil(nat/CELL)*CELL);
  h.well.el.style.minHeight=pad+"px";
  return pad;
}

/* Read pass then write pass: a box measured after a style write forces a fresh
   layout, and there is one panel per machine. The write is a transform only -
   left/top would re-lay-out the page for a move the compositor can do. */
function marginPlace(panels,host){
  if(VIEW.w<60||VIEW.h<60) return;
  const k=marginZoomK(), u=marginUPerPx()*k, rc=marginCv();
  /* clipped to the CANVAS BOX, not just below the topbar: a panel is part of
     the drawing, so it may not paint on the letterbox #stage leaves around a
     canvas that does not fill the window. */
  const vpw=(typeof innerWidth==="number"?innerWidth:rc.right);
  const vph=(typeof innerHeight==="number"?innerHeight:rc.bottom);
  const clip="inset("+Math.max(0,Math.round(rc.top))+"px "
                     +Math.max(0,Math.round(vpw-rc.right))+"px "
                     +Math.max(0,Math.round(vph-rc.bottom))+"px "
                     +Math.max(0,Math.round(rc.left))+"px)";
  if(host && host._clip!==clip){ host.style.clipPath=clip; host._clip=clip; }
  // u is grid units per CSS px OF THE DRAWN PANEL, so a slot reserves what the
  // panel actually covers and two cannot land on each other at any zoom
  const padU=MARGIN_PAD*u, gapU=MARGIN_GAP*u, grpU=MARGIN_GRP_GAP*u;
  const B={x:VIEW.cx, y:VIEW.cy, w:VIEW.cw, h:VIEW.ch};
  const side={l:[],r:[],t:[],b:[]};
  /* A PANEL IS SCALED, NOT ZOOMED. `zoom` re-lays the panel out at each step,
     and a re-layout at a new font size is not proportional: line breaks move
     and rounding differs, so the panel's own HEIGHT walked as the plant was
     zoomed and the thing the reader was looking at slid. A transform scales the
     one layout the panel already has, so its height in layout px is a constant
     and its picture is the same picture at every step - see hostScale()
     (render/plant.js), which is what keeps the hosted canvases in step. */
  /* ONE WRITE PASS, wherever the place came from - the cascade and the corner
     both land here, so a panel is scaled, clipped and hidden by one rule. */
  const put=(h,ax,ay,wU)=>{
    h._pan={x:ax,y:ay,w:wU,h:h._hU};
    const s=vScr({x:ax,y:ay}), g=marginPage(s.x,s.y,rc);
    // NOT rounded: a quantised place pops the panel a pixel each way as k moves
    const x=g.x, y=g.y, eh=h._hpx*k;
    h.vis = x<vpw && y<vph && x+h.w*k>0 && y+eh>rc.top;
    if(h.hid!==!h.vis){ h.well.el.style.visibility=h.vis?"":"hidden"; h.hid=!h.vis; }
    /* A HIDDEN PANEL IS STILL MOVED, or it pops from a stale place the frame
       it comes back. Only the content sync is skipped (marginSync); a
       transform is a string compare and one write. */
    const tf="translate3d("+x.toFixed(3)+"px,"+y.toFixed(3)+"px,0) scale("+k.toFixed(4)+")";
    if(h.tf!==tf){ h.well.el.style.transform=tf; h.tf=tf; }
  };
  const board=[], seat=[];
  for(const h of panels){
    h._mr=h.rect&&h.rect();
    if(h.corner){
      if(h.needH || h._hpx==null){ h._hpx=marginMeasure(h); h.needH=false; }
      h._hU=h._hpx*u; board.push(h); continue;
    }
    if(!h._mr) continue;
    // LAYOUT height, transform-free, so it is measured once per content change
    if(h.needH || h._hpx==null){
      h._hpx=marginMeasure(h);
      h.needH=false;
    }
    h._hU=h._hpx*u;
    h._grp = h.p ? panelGroup(h.p) : "support";
    h._rank = panelGroupRank(h._grp);
    h._side=marginSide(h._mr,B);
    seat.push(h);
  }
  /* THE BOARD FIRST, THE MARGIN ONLY FOR WHAT WOULD NOT FIT. A panel that found
     free cells beside its own machine is placed there and drops out of the
     cascade entirely; one that did not still goes to an edge, which is the
     honest answer on a board with no room left rather than a panel dropped. */
  marginSlot(seat);
  for(const h of seat){
    if(!h._slot){ side[h._side].push(h); continue; }
    const r=grect(h._slot.x, h._slot.y, h._slot.w, h._slot.h);
    put(h, r.x, r.y, h.w*u);
  }
  /* it names no machine, so it heads its own edge band rather than standing
     beside a box; the machine cascade below then starts under it */
  const stack={l:B.y,r:B.y};
  for(const h of board){
    const sd=h.corner[1], wU=h.w*u;
    put(h, sd==="l" ? B.x-padU-wU : B.x+B.w+padU, stack[sd], wU);
    stack[sd]+=h._hU+gapU;
  }
  for(const sd of ["l","r","t","b"]){
    const list=side[sd], flat=(sd==="t"||sd==="b");
    // GROUP FIRST, then board order inside the group - see MARGIN_GRP_GAP
    list.sort((a,b)=> (a._rank-b._rank) ||
      (flat ? a._mr.x-b._mr.x : a._mr.y-b._mr.y));
    let run=flat?-Infinity:stack[sd]-gapU, was=null;   // the cascade that stops two overlapping
    for(const h of list){
      const wU=h.w*u, sep = (was!==null && h._grp!==was) ? grpU : gapU;
      was=h._grp;
      let ax,ay;
      if(flat){
        ax=Math.max(run+sep-gapU, h._mr.x+h._mr.w/2-wU/2); run=ax+wU+gapU;
        ay=(sd==="t") ? B.y-padU-h._hU : B.y+B.h+padU;
      }else{
        ay=Math.max(run+sep-gapU, h._mr.y+h._mr.h/2-h._hU/2); run=ay+h._hU+gapU;
        ax=(sd==="l") ? B.x-padU-wU : B.x+B.w+padU;
      }
      put(h,ax,ay,wU);
    }
  }
  marginLeaders(panels);
}

/* ══ AND A LINE SAYS WHICH MACHINE THE PANEL IS FOR ══
   The PATH is the router's (ROUTE.routeGraph, render/route.js); the INK is the
   rail leader's own (leaderStroke, render/plant.js), so the two leaders on this
   board are dashed, capped and coloured alike. Amber for the picked machine,
   rail grey for the rest, so the selection is answered on the drawing as well
   as on the panel's title bar. */
/* ITS INK IS A PLANT QUANTITY, like a pipe's. Both ends are in plant space, so
   pinned to a CSS pixel the line stayed the same weight while everything it
   joins shrank - over a plant three cells wide it read as a rope. One plant
   unit, against pipeWidth()'s own 2.2 floor, so it never reads as plumbing. */
const MARGIN_LEAD_W=1;
/* ══ THE WHOLE SET IS ROUTED AT ONCE, BY THE BUS ROUTER, NOT BY A RULE HERE ══
   The halfway elbow this used to draw knew about two boxes and nothing else, so
   a leader ran straight through whatever machines stood between its own two
   ends - and twenty of them crossed each other. ROUTE.busRouteGraph (render/
   route.js) carves shared CORRIDORS through the free deck, and every leader
   then approaches the nearest one, rides it, turns ninety degrees at a junction
   onto the next, and exits onto its panel - reserving a lane centre-out. Twenty
   leaders fanning out to the margin is exactly the case corridors are for: they
   gang into a few trunks instead of taking twenty separate paths.

   AND `routeGraph` IS ITS FALLBACK, which is how `oc` wires the pair. The bus
   router may legitimately leave a line unplaced - no corridor reaches an
   endpoint, or every lane is full - and a per-line A* pass then places just
   those. deCollide runs ONLY on that path: a bus line already holds a lane it
   reserved, so a shift could only move it off one, but a fallback line is
   routed blind to those lanes and can land on top.

   Every machine AND every panel is an obstacle, so a leader also refuses to
   cross a panel it does not belong to.

   ROUTED ONCE PER GEOMETRY, NOT PER FRAME. A panel's box in PLANT units is
   invariant under pan and zoom - marginUPerPx() cancels VIEW.s out, which is
   the same fact that makes a panel scale with the drawing - so the only things
   that move these boxes are a design edit and a panel's own content height.
   That is the signature. */
// bus knobs, in PLANT units - `oc`'s own defaults are pixels on a node canvas
// and a grid cell here is 16, so a 280-unit minimum trunk would carve nothing
const MARGIN_BUS_C={margin:6, laneGap:5, minLen:60, hopCost:2000,
                    facePad:4, minSep:4, tightGap:4, trunkCap:4};
const MARGIN_ROUTE_C={clearance:10, bendCost:40, laneGap:5, nodeHalo:8, haloCost:60};
let marginRt=null, marginRtSig=null, marginRtSides=null;
function marginRoutes(panels){
  const P=panels.filter(h=>h._pan&&h._mr);
  // designSig() carries the ports (and everything else drawn), the boxes carry
  // the panels - between them nothing an obstacle is made of can move unseen
  const sig=designSig()+"#"+P.map(h=>{ const m=h._mr, q=h._pan;
    return h.id+":"+m.x+","+m.y+","+m.w+","+m.h+"|"+
      q.x.toFixed(1)+","+q.y.toFixed(1)+","+q.w.toFixed(1)+","+q.h.toFixed(1); }).join(";");
  if(sig===marginRtSig) return marginRt;
  marginRtSig=sig;
  const nodes=[], edges=[], walls=[];
  for(const h of P){
    const m=h._mr, q=h._pan;
    nodes.push({id:"m/"+h.id, x:m.x, y:m.y, w:m.w, h:m.h});
    nodes.push({id:"p/"+h.id, x:q.x, y:q.y, w:q.w, h:q.h});
    walls.push({x:m.x,y:m.y,w:m.w,h:m.h},{x:q.x,y:q.y,w:q.w,h:q.h});
    edges.push({from:"m/"+h.id, to:"p/"+h.id, key:h.id});
  }
  /* A PORT IS AN OBSTACLE, and it is one for BOTH routers. It is a real cell of
     the drawing - a nozzle stands in it and a pipe leaves by it - so a leader
     crossing one reads as plumbing. Added as an ordinary node rather than
     through busRouteGraph's blockRects: the fallback A* takes its hard
     obstacles off the node list alone, so a port in blockRects would be dodged
     by the bus and driven straight through by whatever fell back. Never an
     endpoint, so no walk is ever exempted from it. */
  for(const pid in D.ports){
    const c=portCell(pid); if(!c) continue;
    const r=grect(c[0],c[1],1,1);
    nodes.push({id:"port/"+pid, x:r.x, y:r.y, w:r.w, h:r.h});
    walls.push({x:r.x,y:r.y,w:r.w,h:r.h});
  }
  // prevSides keeps a fallback connector on last pass's faces unless another is
  // genuinely cheaper, so an edit cannot flip every route it has to place
  const sides=new Map();
  marginRt=ROUTE.busRouteGraph(nodes,edges,{
    bus:MARGIN_BUS_C,
    fallback:miss=>ROUTE.routeGraph(nodes,[],miss,
      {config:MARGIN_ROUTE_C, prevSides:marginRtSides}),
    deconflict:r=>ROUTE.deCollide(r,walls,{laneGap:MARGIN_BUS_C.laneGap,containers:[]})});
  for(const [k,r] of marginRt) sides.set(k,{d1:r.d1,d2:r.d2});
  marginRtSides=sides;
  return marginRt;
}
/* EVERY PLACED PANEL GETS ITS LINE, EVERY FRAME - CLIPPED, NEVER CULLED.
   Two gates have been tried here and both were wrong for the same reason: a
   visibility test makes the leader a function of the ZOOM, so lines blinked in
   and out as the view moved and the picture read as broken rather than as
   panned. First the panel had to be on screen (it is anchored on the edge of
   the WHOLE plant, so zooming in throws it off - measured at 2.1x the reactor's
   panel sits at x -2894, and the line died while the machine it names was still
   on the board); then either end had to be near the view, which merely moved
   the flicker to a different zoom. The clip is the only thing that decides what
   lands: a leader with nothing on screen paints nothing and costs one path.
   The only test left is whether the panel has been PLACED at all - a run or
   wall panel with no pick has no box to leave from. */
function marginLeaders(panels){
  if(typeof ctx==="undefined"||!ctx||VIEW.w<2||VIEW.h<2) return;
  const rt=marginRoutes(panels);
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  for(const h of panels){
    if(!h._pan||!h._mr) continue;
    /* A PANEL BOLTED TO ITS OWN MACHINE NEEDS NO LINE TO SAY WHICH ONE IT IS -
       touching the box IS the association, and a dashed line over one shared
       edge is noise. ONLY THEN, though: the gate was "is it seated at all",
       which took the leader off ten panels sitting several cells clear of the
       machine they name and left them attached to nothing. */
    /* AND THE BOUNDARY NEVER GETS ONE. It names a hundred cells, so a line to any
       one of them says less than the panel standing on the ring's own corner
       already does. */
    if(h._att || h.key==="mat") continue;
    const r=rt&&rt.get(h.id); if(!r||!r.pts||r.pts.length<2) continue;
    const pts=r.pts.map(q=>vScr({x:q[0],y:q[1]}));
    // a fraction of the cell, like every other drawn size; VIEW.s because the
    // leader is stroked in SCREEN space over the canvas, not under its transform
    leaderStroke(pts, h.on?C.amber:C.lead, [pts[0],pts[pts.length-1]],
                 MARGIN_LEAD_W*DRAW_K*VIEW.s, LEADER_RAD*DRAW_K*VIEW.s);
  }
  ctx.restore();
}

/* The run and wall panels exist only while their own pick stands. `sel` is the
   whole of their state, so the rebuild gate is the key changing - designSig()
   already carries `sel`, which is what `fresh` is taken off. */
function marginKeySync(h,fresh,live){
  const k = h.key==="run" ? (isRunKey(sel)?sel:null)
                          : (isMatKey(sel)?sel:matDefaultKey());
  h.selKey=k;
  KIT.show(h.well.el, !!k);
  if(!k){ h.vis=false; h.selAt=null; return; }
  // live has no design signature, so the measure is gated on the pick moving
  const moved = h.selAt!==k;
  if(!fresh && !moved) return;
  h.selAt=k;
  if(moved){
    const title = h.key==="run"
      ? (pipeLabel(pipeMap().byKey[k].k, k)||"PIPE RUN")
      : matPanelTitle(k);
    h.well.setTitle(title); KIT.tip(h.well.head,title);
  }
  const blocks = h.key==="run" ? paramsForRun(k)
               : live ? paramsForMatLive(k) : paramsForMat(k);
  dbPanelSync(h.body, blocks);
  if(moved) h.needH=true;
  // a default cell is not a selection
  const on = sel===k;
  if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
}

function marginBoardSync(h,live,fresh){
  const n0=h.body.childElementCount, s0=h.body._sig;
  if(h.board==="pipes"){ if(fresh) pipeRailSync(h.body,h.well.el); }
  else if(h.board==="ports") crPortsSync(h.body);
  else crCnxSync(h.body);
  if(h.body._sig!==s0 || h.body.childElementCount!==n0) h.needH=true;
}

// once a frame from either screen, after drawPlant() set the view
let MARGIN=null, marginFit=null, marginAt=null, marginFrame=0, marginPSig=null, marginDeep=null;
function marginSync(host,live){
  if(!host||typeof LAY==="undefined"||!LAY) return;
  marginFrame++;
  // the host is in the trigger: one panel set, and a screen each owns one
  if(marginFit!==LAY || marginAt!==host){
    MARGIN=marginBuild(host,live); marginFit=LAY; marginAt=host; marginPSig=null;
  }
  // PREV.seq: a hover is not a design change, and the MEASURED lists price it
  const psig = live ? null : designSig()+"|"+sel+"|"+PREV.seq;
  const fresh = live || psig!==marginPSig; marginPSig=psig;
  // what could have moved a control's range
  const dtok = live ? (coreIds().map(id=>coreSeen(S,id).split?1:0).join("")+"|"+(S.dmgParts?S.dmgParts.length:0)) : psig;
  const deepNow = dtok!==marginDeep; marginDeep=dtok;
  for(const h of MARGIN){
    if(h.key){ marginKeySync(h,fresh,live); continue; }
    if(h.board){ marginBoardSync(h,live,fresh); continue; }
    const on=h.p.id===sel;
    if(h.on!==on){ h.well.el.classList.toggle("on",on); h.on=on; }
    /* A PAN MAY NOT REBUILD ANYTHING. Gated on being visible, a panel panned
       off and back rebuilt its whole block list and re-measured a panel that
       can be two thousand pixels tall - one forced layout, mid-gesture, which
       is the hitch. The bench's content follows designSig() and nothing else,
       so it is synced on that alone, off screen or not. */
    if(live){
      if(!h.vis && h.tf!==null) continue;
      const nm=partName(h.p); h.well.setTitle(nm); KIT.tip(h.well.head,nm);
      marginSkinSync(h);
      fieldRowsSync(h.body, readoutsFor(h.p,S));
      /* AND A GRAPHICAL ROW IS PAINTED HERE TOO - the panel is opaque, so its
         canvas rows are hostPaint()ed off the map fieldRowsBuild() hands back,
         exactly as the rail does it (crRailSync). */
      const vz=h.body._viz;
      if(vz&&vz.dmg) hostPaint(vz.dmg,dmgViz);
    }else{
      if(!fresh) continue;
      const nm=partName(h.p), B=paramsFor(partOf(h.p.id)||h.p);
      h.well.setTitle(nm);
      // the panel's own help, asked for rather than stood open - see help() (inspector.js)
      KIT.tip(h.well.head,nm,B.tip||"");
      /* WHAT THIS BOX COSTS, on its own title bar - the sum of every tonnage
         the knobs below quote, off the same door the mass budget reads
         (partMassOf(), layout.js). The live screen puts the skin temperature
         here instead; a bench panel has no skin. */
      const t=partMassOf(h.p.id);
      h.well.setSfx(t>=0.05 ? t.toFixed(t<10?1:0)+" t" : "");
      /* AND WHAT IS NOT A KNOB HANGS OFF THE TITLE BAR - see the "menu" block
         (design-bench.js). Seated before the suffix, so the tonnage keeps the
         right-hand end of the bar. */
      if(B.head && !h.head && h.well.head){
        h.head=KIT.el("div","db-panel-head");
        h.well.head.insertBefore(h.head, h.well.sfx);
      }
      if(h.head) dbPanelSync(h.head, B.head||[]);
      /* RE-MEASURE ONLY WHEN THE BLOCK LIST ACTUALLY CHANGED - the same test
         marginKeySync() above makes. It used to re-measure on every sync, which
         was harmless while only a design edit could cause one; a hover causes
         one now (PREV.seq), and a panel's height is quantised to whole cells,
         so the first hover snapped the whole panel up a cell. */
      const n0=h.body.childElementCount, s0=h.body._sig;
      dbPanelSync(h.body, B);
      if(h.body._sig!==s0 || h.body.childElementCount!==n0) h.needH=true;
    }
    marginCtlSync(h,live,deepNow);
  }
  marginPlace(MARGIN,host);
}
