"use strict";

/* ══ THE ARROW THE BOARD IS WALKED WITH ══
   W A S D step from the selected machine to its neighbour in that direction.
   While the keys are HELD one live endpoint tracks the candidate; each landed
   hop APPENDS to a single Catmull-Rom curve threading every machine the walk
   touched, tipped by one arrowhead at the leading end. Ported from the `oc`
   node view (navarrow.js + keynav.js) and redrawn for canvas.

   Endpoints are PLANT coords, re-projected through vScr() every frame, so the
   curve is glued to the panels and pans and zooms with them; the stroke and the
   head are plant sizes too, so the whole arrow scales with the drawing.

   Nothing here is on `S` - a walk is a view of the board, not a fact about the
   plant - and the curve dies on a DEADLINE checked per frame rather than on a
   setTimeout, because the frame loop idles (main.js) and a timer would fire
   into a frame nobody drew. */

const NAV_TTL=900;                 // ms the whole curve survives after the last hop
const NAV_FADE=260;                // ms of that spent fading out
/* A FRACTION OF A CELL, like every other size on the drawing - scaled by VIEW.s
   where it is drawn. Held in layout units the arrow kept ONE size on the glass,
   so zoomed out to the whole ship it was a slab lying across half the board: it
   is part of the picture, not furniture standing beside it. */
const NAV_HEAD=0.8*CELL, NAV_HALF=0.4*CELL;    // arrowhead length and half-width
const NAV_LW=0.2*CELL;                         // shaft width
/* ONE COLOUR, THE WHOLE WAY. It was a gradient of the machines' own tints, which
   is what oc does because there a node's colour is the only thing naming it -
   here the panel it lands on is already labelled, so the blend said nothing and
   only made the arrow harder to pick out. Amber is what a selection is. */
const NAV_COL=C.amber;
/* Catmull-Rom handle scale: smaller is shorter handles is sharper turns. 1/6
   is the round one, and round on a four-hop walk reads as a loop of string. */
const NAV_SMOOTH=0.09;

const navChain=[];                 // landed points {x,y} in PLANT coords
let navLive=null;                  // the held preview endpoint, or null
let navTarget=null;                // what the held keys point at, landed on release
let navDeadline=0;                 // navNow() the curve dies at; 0 = nothing pending

const navNow=()=>(typeof performance!=="undefined"&&performance.now)?performance.now():Date.now();
function navReset(){ navChain.length=0; navLive=null; navDeadline=0; }
function navExpire(){ if(navDeadline && navNow()>navDeadline) navReset(); }
function navClear(){ navReset(); navTarget=null; }
function navActive(){ navExpire(); return navChain.length>1 || !!(navChain.length&&navLive); }
function navAlpha(){
  if(!navDeadline) return 1;
  const left=navDeadline-navNow();
  return left>=NAV_FADE ? 1 : Math.max(0,left/NAV_FADE);
}

/* ══ THE WALK IS BETWEEN PANELS, NOT BETWEEN MACHINES ══
   A panel is what is READ - the machine is a box with a name on it - so the
   panels are what the keys step through and what the camera frames. They stand
   on the deck around the plant at their own solved slots (marginSlot(),
   ui/margin.js), which is a different arrangement from the machinery's: two
   machines side by side can have panels at opposite edges, and W from one is
   then a genuinely different answer from W between their boxes.
   THE RECT IS `_pan`, which marginPlace()'s one write pass gives EVERY panel in
   plant units - the ones seated on the board, the ones cascaded to an edge and
   the corner-anchored boards alike. `_slot` is only the seated ones, so PIPES
   had no rect at all and could not be walked to.
   AND NOT `vis`, WHICH MEANS "ON SCREEN THIS FRAME" (margin.js): gated on it the
   walk could only reach what you were already looking at, which is the opposite
   of what it is for - containment, the turbine and the radiators were all
   unreachable the moment they scrolled off.
   THE WALL PANEL IS IN, THE RUN PANEL IS NOT. They look like one pair (both are
   `h.key`, both keyed on `sel`) and they are not: a run panel only exists while
   a run is picked, but the wall panel falls back to matDefaultKey() and so
   stands as long as anything is painted - and a CONTAINMENT is painted material
   (design.js), not a machine, so that panel is the only way to reach one.
   Its id is its own SELECTION KEY, not "mat", because landing on it selects the
   cell the same way a click on the wall does - and the next hop then finds its
   anchor in the ordinary way. */
function navCentres(){
  const out=[];
  for(const h of (typeof MARGIN!=="undefined" && MARGIN || [])){
    if(!h || !h._pan) continue;
    const id = h.key==="mat" ? h.selKey : (h.p||h.board) ? h.id : null;
    if(!id) continue;
    const r=h._pan;
    out.push({id, x:r.x+r.w/2, y:r.y+r.h/2, rect:{x:r.x, y:r.y, w:r.w, h:r.h}});
  }
  /* ══ AND WITH NO PANELS ON THE BOARD, IT IS BETWEEN MACHINES ══
     The panels are hidden (MARGIN_HIDE, ui/margin.js) and a machine is read
     through a peek beside the machine that is picked, so there is no second
     arrangement standing on the deck to walk through - and gated on MARGIN
     alone the keys simply did nothing. The boxes are what is left, and they
     are what the panels were naming. */
  if(!out.length && typeof LAY!=="undefined" && LAY)
    for(const p of LAY.parts){
      if(!fitted(p)) continue;
      const r=prect(p);
      out.push({id:p.id, x:r.x+r.w/2, y:r.y+r.h/2, rect:{x:r.x, y:r.y, w:r.w, h:r.h}});
    }
  return out;
}
const navFind=(centres,id)=>centres.find(c=>c.id===id)||null;

// the machine closest to a plant point - what seeds a walk with nothing selected
function navCentreMost(centres,tx,ty){
  let best=null, bd=Infinity;
  for(const c of centres){ const d=(c.x-tx)**2+(c.y-ty)**2;
    if(d<bd){ bd=d; best=c.id; } }
  return best;
}
/* THE NEAREST MACHINE IN A DIRECTION. It only qualifies if it lies AHEAD along
   the direction and inside a 45 degree cone of it, so D picks something to
   starboard and not something mostly above that happens to be marginally
   rightward. A DIAGONAL additionally demands that exact quadrant - a positive
   offset on BOTH axes - so it can only ever land on a genuinely off-axis
   machine and never on the one a straight W or D would have picked; with
   nothing there it returns null rather than inventing a target. */
function navNearestInDir(centres,from,dx,dy){
  const diag=dx!==0&&dy!==0;
  const sx=Math.sign(dx), sy=Math.sign(dy);      // quadrant signs, taken before the normalise
  const len=Math.hypot(dx,dy)||1; dx/=len; dy/=len;
  let best=null, bs=Infinity;
  for(const c of centres){
    if(c.id===from.id) continue;
    const vx=c.x-from.x, vy=c.y-from.y;
    if(diag && (Math.sign(vx)!==sx || Math.sign(vy)!==sy)) continue;
    const along=vx*dx+vy*dy;
    if(along<=1e-3) continue;                    // behind or square on: not ahead
    const lateral=Math.abs(vx*-dy+vy*dx);
    if(lateral>along) continue;                  // outside the cone
    const score=along+lateral*2;                 // close and on-axis wins
    if(score<bs){ bs=score; best=c.id; }
  }
  return best;
}

/* THE WALK'S CURSOR IS THE SELECTION. oc carries a second one because an arrow
   hop there pans WITHOUT selecting; here a hop lands on a machine and lights
   it, so a separate cursor would be a second answer to the same question. */
function navAnchorOf(centres){
  const c=sel&&navFind(centres,sel);
  if(c) return c;
  const mid=vPt({x:VIEW.x+VIEW.w/2, y:VIEW.y+VIEW.h/2});
  return navFind(centres, navCentreMost(centres,mid.x,mid.y));
}

/* Set the live endpoint, seeding the chain's first point off the anchor. A
   chain whose end is no longer the anchor belongs to a walk the player has
   left - clicked elsewhere, or a machine removed under it - so it is dropped
   rather than joined to, which would draw a curve through a hop nobody made. */
function navDrawLive(from,to){
  navExpire();
  const tail=navChain[navChain.length-1];
  if(from && tail && (Math.abs(tail.x-from.x)>0.5 || Math.abs(tail.y-from.y)>0.5)) navReset();
  if(from && !navChain.length) navChain.push({x:from.x, y:from.y});
  navLive = to ? {x:to.x, y:to.y} : null;
}

// the candidate for the currently held direction, previewed
function navPreview(dx,dy){
  const centres=navCentres();
  const from=(dx||dy)&&centres.length ? navAnchorOf(centres) : null;
  const to=from&&navFind(centres, navNearestInDir(centres,from,dx,dy));
  navTarget=to?to.id:null;
  navDrawLive(from||null, to||null);
}

/* Every key released: land on the candidate, select it, and pan there. The
   live endpoint FREEZES into the chain and restarts the one shared deadline,
   so a run of hops keeps the whole curve up until TTL after the LAST of them.
   With no candidate the walk simply ends where it stood. */
function navCommit(){
  const id=navTarget; navTarget=null;
  if(!id){ navReset(); return; }
  if(navLive){ navChain.push(navLive); navLive=null; }
  navDeadline=navNow()+NAV_TTL;
  /* the SELECTION is still the machine - a panel is a view of one, and every
     reader downstream (the highlight, the rail, paramsFor()) addresses the
     machine - but the camera frames the PANEL, which is what was walked to. */
  const to=navFind(navCentres(),id);
  sel=id;
  if(to) vPanTo(to.rect);
}

/* ══ 1:1 ON THE PANEL YOU ARE STANDING ON ══
   marginZoomMaxS() (ui/margin.js) is already the VIEW.s at which a panel is
   drawn at exactly its own pixels - it is where vScale() stops the zoom - so
   this is that figure and not a second definition of "1:1". Centres on the
   panel through the same eased pan a hop uses. */
function navZoom1(){
  const c=navFind(navCentres(), sel);
  if(!c || typeof marginZoomMaxS!=="function") return;
  // the scale rides the pan's own tween - set here it snapped, and the drawing
  // arrived from off to one side before sliding onto the panel
  vPanTo(c.rect, marginZoomMaxS()/Math.max(1e-9,VIEW.fit));
}
/* One row per plant screen, beside the walk they belong to rather than split
   across the two screen files. Not the space bar: that is PAUSE in the control
   room (screens/transport.js) and a live plant may not lose it. */
keyAdd({k:"Enter", sc:"design",  lab:"1:1", fn:navZoom1});
keyAdd({k:"Enter", sc:"operate", lab:"1:1", fn:navZoom1});
// ...and the ladder either side of it, on the same two screens
for(const sc of ["design","operate"]){
  keyAdd({k:"PageUp",   sc, lab:"ZOOM -", fn:()=>vZoomStep(-1)});
  keyAdd({k:"PageDown", sc, lab:"ZOOM +", fn:()=>vZoomStep(1)});
}

/* THE PAN AND THE FADE BOTH OWE FRAMES THE LOOP WOULD NOT OTHERWISE DRAW. An
   input buys UI_TRAIL frames (ui.js) and this outlasts them, so the walk asks
   for its own the way a live drag does. */
function navStep(dt){
  const panning=vPanStep(dt);
  if(panning||navActive()) uiDirty();
}

/* Catmull-Rom to cubic bezier - the curve passes THROUGH every point. Emits
   the path onto ctx when asked, and returns the unit tangent it arrives at the
   last point by, which is what the head is squared to. */
function navCurve(pts,emit){
  const n=pts.length;
  if(emit){ ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); }
  let c2x=pts[0].x, c2y=pts[0].y;
  for(let i=0;i<n-1;i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||pts[i+1];
    const c1x=p1.x+(p2.x-p0.x)*NAV_SMOOTH, c1y=p1.y+(p2.y-p0.y)*NAV_SMOOTH;
    c2x=p2.x-(p3.x-p1.x)*NAV_SMOOTH; c2y=p2.y-(p3.y-p1.y)*NAV_SMOOTH;
    if(emit) ctx.bezierCurveTo(c1x,c1y,c2x,c2y,p2.x,p2.y);
  }
  const end=pts[n-1];
  let tx=end.x-c2x, ty=end.y-c2y, tl=Math.hypot(tx,ty);
  if(tl<1e-3){ tx=end.x-pts[n-2].x; ty=end.y-pts[n-2].y; tl=Math.hypot(tx,ty)||1; }
  return {x:tx/tl, y:ty/tl};
}
/* ══ ITS OWN CANVAS, STANDING OVER THE PANELS ══
   A panel is HTML anchored in plant space (ui/margin.js) and the margin host is
   a POSITIONED element, so it paints over #cv whatever order the plant is drawn
   in - and the panels are what the walk now aims at, so the head landed behind
   the one thing it was pointing at. This is a second canvas, not an SVG layer:
   the arrow is drawn in canvas space with the canvas's own primitives, and the
   only thing that changes is which surface it lands on. It is a LATER SIBLING
   of BOTH margin hosts at the same z-index, so it clears the panels and still
   sits under the topbar and the screen head, which are z-index 1.
   ONE layer on the page, not one per screen: a walk is a single thing, and a
   layer per screen put the live arrow on whichever screen was built LAST - the
   control room's, whose root is display:none while the bench is up, so it
   measured 0 x 0 and painted nothing.
   The transform is resize()'s (screens/shell.js) - layout units, offset by the
   topbar - so vScr() and every size in here mean the same as they always did. */
let navCv=null;
function navLayerEl(){
  if(navCv && navCv.isConnected) return navCv;
  if(typeof document==="undefined" || !document.body || typeof KIT==="undefined") return null;
  navCv=KIT.el("canvas","nav-layer");
  document.body.appendChild(navCv);
  return navCv;
}
function navLayerPaint(){
  const el=navLayerEl();
  if(!el) return;
  const on=navActive();
  // the layer is hidden rather than left holding a stale curve; KIT.show is the
  // one hide (core rule), and a hidden canvas costs nothing to keep sized
  if(el._on!==on){ KIT.show(el,on); el._on=on; }
  if(!on) return;
  const rc=cv.getBoundingClientRect();
  if(rc.width<4||rc.height<4) return;
  const dpr=devicePixelRatio||1, sc=rc.width/W;
  const bw=Math.max(1,Math.round(rc.width*dpr)), bh=Math.max(1,Math.round(rc.height*dpr));
  if(el.width!==bw||el.height!==bh){ el.width=bw; el.height=bh; }
  // written only when it moves: a style write on a fixed element flushes layout
  const geo=rc.left+","+rc.top+","+rc.width+","+rc.height;
  if(el._geo!==geo){
    el.style.left=rc.left+"px"; el.style.top=rc.top+"px";
    el.style.width=rc.width+"px"; el.style.height=rc.height+"px";
    el._geo=geo;
  }
  const c=el.getContext("2d");
  c.setTransform(sc*dpr,0,0,sc*dpr,0,-TOPBAR_H*sc*dpr);
  c.clearRect(0,TOPBAR_H,W,H-TOPBAR_H);
  const prev=ctx; ctx=c;
  try{
    ctx.save(); ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
    navArrowDraw();
    ctx.restore();
  } finally { ctx=prev; }
}

function navArrowDraw(){
  if(!navActive()) return;
  const src=navLive? navChain.concat([navLive]) : navChain;
  const pts=src.map(p=>vScr(p));
  const cum=[0];
  for(let i=1;i<pts.length;i++) cum.push(cum[i-1]+Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y));
  const tot=cum[cum.length-1];
  if(!(tot>0.5)) return;                         // two machines on one spot: no direction to draw
  const end=pts[pts.length-1];
  const tan=navCurve(pts,false);
  // the endpoints came through vScr(), so the sizes take the same scale
  const k=VIEW.s, headL=NAV_HEAD*k;
  // a hop shorter than the head would put the head's BASE behind the start and
  // draw the arrow backwards, so the head is capped at a share of the walk
  const hl=Math.min(headL, tot*0.6), hw=NAV_HALF*k*(hl/Math.max(1e-6,headL));
  const bx=end.x-tan.x*hl, by=end.y-tan.y*hl;
  const px=-tan.y, py=tan.x;
  const a=navAlpha();
  ctx.save();
  // it crosses machines it is not about, so it is not quite opaque - and the
  // head is the least transparent thing in it, because the head is the answer
  ctx.globalAlpha=a*0.9;
  // the shaft stops at the head's BASE, or it pokes out through the point
  navCurve(pts.slice(0,-1).concat([{x:bx, y:by}]), true);
  ctx.strokeStyle=NAV_COL; ctx.lineWidth=NAV_LW*k; ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.stroke();
  ctx.globalAlpha=a*0.95;
  ctx.beginPath();
  ctx.moveTo(end.x,end.y);
  ctx.lineTo(bx+px*hw, by+py*hw);
  ctx.lineTo(bx-px*hw, by-py*hw);
  ctx.closePath();
  ctx.fillStyle=NAV_COL; ctx.fill();
  ctx.restore();
}
