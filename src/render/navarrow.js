"use strict";

const NAV_TTL=900;                 // ms the whole curve survives after the last hop
const NAV_FADE=260;                // ms of that spent fading out
const NAV_HEAD=0.8*CELL, NAV_HALF=0.4*CELL;    // arrowhead length and half-width
const NAV_LW=0.2*CELL;                         // shaft width
const NAV_COL=C.amber;
// Catmull-Rom handle scale; smaller is sharper turns
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

// the walk is between PANELS: `_pan` covers every panel, and `vis` is not asked or only what is on screen is reachable
function navCentres(){
  const out=[];
  for(const h of (typeof MARGIN!=="undefined" && MARGIN || [])){
    if(!h || !h._pan) continue;
    const id = h.key==="mat" ? h.selKey : (h.p||h.board) ? h.id : null;
    if(!id) continue;
    const r=h._pan;
    out.push({id, x:r.x+r.w/2, y:r.y+r.h/2, rect:{x:r.x, y:r.y, w:r.w, h:r.h}});
  }
  // with the panels hidden (MARGIN_HIDE) the boxes are what is left to walk
  if(!out.length && typeof LAY!=="undefined" && LAY)
    for(const p of LAY.parts){
      if(!fitted(p)) continue;
      const r=prect(p);
      out.push({id:p.id, x:r.x+r.w/2, y:r.y+r.h/2, rect:{x:r.x, y:r.y, w:r.w, h:r.h}});
    }
  return out;
}
const navFind=(centres,id)=>centres.find(c=>c.id===id)||null;

function navCentreMost(centres,tx,ty){
  let best=null, bd=Infinity;
  for(const c of centres){ const d=(c.x-tx)**2+(c.y-ty)**2;
    if(d<bd){ bd=d; best=c.id; } }
  return best;
}
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
    if(along<=1e-3) continue;
    const lateral=Math.abs(vx*-dy+vy*dx);
    if(lateral>along) continue;
    const score=along+lateral*2;
    if(score<bs){ bs=score; best=c.id; }
  }
  return best;
}

function navAnchorOf(centres){
  const c=sel&&navFind(centres,sel);
  if(c) return c;
  const mid=vPt({x:VIEW.x+VIEW.w/2, y:VIEW.y+VIEW.h/2});
  return navFind(centres, navCentreMost(centres,mid.x,mid.y));
}

// a chain whose end is no longer the anchor belongs to a walk the player has left, so it is dropped
function navDrawLive(from,to){
  navExpire();
  const tail=navChain[navChain.length-1];
  if(from && tail && (Math.abs(tail.x-from.x)>0.5 || Math.abs(tail.y-from.y)>0.5)) navReset();
  if(from && !navChain.length) navChain.push({x:from.x, y:from.y});
  navLive = to ? {x:to.x, y:to.y} : null;
}

function navPreview(dx,dy){
  const centres=navCentres();
  const from=(dx||dy)&&centres.length ? navAnchorOf(centres) : null;
  const to=from&&navFind(centres, navNearestInDir(centres,from,dx,dy));
  navTarget=to?to.id:null;
  navDrawLive(from||null, to||null);
}

function navCommit(){
  const id=navTarget; navTarget=null;
  if(!id){ navReset(); return; }
  if(navLive){ navChain.push(navLive); navLive=null; }
  navDeadline=navNow()+NAV_TTL;
  // selection stays the machine; the camera frames the panel, which is what was walked to
  const to=navFind(navCentres(),id);
  sel=id;
  if(to) vPanTo(to.rect);
}

function navZoom1(){
  const c=navFind(navCentres(), sel);
  if(!c || typeof marginZoomMaxS!=="function") return;
  // the scale rides the pan's own tween; set directly it snaps
  vPanTo(c.rect, marginZoomMaxS()/Math.max(1e-9,VIEW.fit));
}
// not the space bar: that is PAUSE in the control room and a live plant may not lose it
keyAdd({k:"Enter", sc:"design",  lab:"1:1", fn:navZoom1});
keyAdd({k:"Enter", sc:"operate", lab:"1:1", fn:navZoom1});
for(const sc of ["design","operate"]){
  keyAdd({k:"PageUp",   sc, lab:"ZOOM -", fn:()=>vZoomStep(-1)});
  keyAdd({k:"PageDown", sc, lab:"ZOOM +", fn:()=>vZoomStep(1)});
}

// the pan and the fade outlast the UI_TRAIL frames an input buys, so the walk asks for its own
function navStep(dt){
  const panning=vPanStep(dt);
  if(panning||navActive()) uiDirty();
}

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
// a second canvas, one per page not per screen, sibling of both margin hosts so the arrow clears the HTML panels
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
  const k=VIEW.s, headL=NAV_HEAD*k;
  // capped at a share of the walk, or a short hop puts the head's base behind the start
  const hl=Math.min(headL, tot*0.6), hw=NAV_HALF*k*(hl/Math.max(1e-6,headL));
  const bx=end.x-tan.x*hl, by=end.y-tan.y*hl;
  const px=-tan.y, py=tan.x;
  const a=navAlpha();
  ctx.save();
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
