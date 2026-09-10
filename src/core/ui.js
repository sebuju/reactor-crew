"use strict";

// ptrHost is the canvas ui.ptr was measured in (null = page canvas); hosts overlap numerically
const ui={widgets:[],prev:[],tips:[],drag:null,ptr:{x:-9,y:-9},ptrHost:null,host:null};
function hostScope(el){ ui.host=el; }

const VIEW={z:1,s:1,fit:1,ox:0,oy:0,x:12,y:0,w:736,h:0,cx:12,cy:0,cw:736,ch:0};
function cvK(){ const r=cv.getBoundingClientRect(); return r.width? r.width/W : 1; }
const cvPx=()=>1/cvK();
function viewRectCss(){
  const rc=cv.getBoundingClientRect(), k=cvK();
  return {left:rc.left+VIEW.x*k, top:rc.top+(VIEW.y-TOPBAR_H)*k,
          right:rc.left+(VIEW.x+VIEW.w)*k, bottom:rc.top+(VIEW.y+VIEW.h-TOPBAR_H)*k};
}
let viewOn=false;
const vPad=()=>({x:Math.max(0,(VIEW.w-VIEW.cw*VIEW.s)/2),
                 y:Math.max(0,(VIEW.h-VIEW.ch*VIEW.s)/2)});
const vOrigin=()=>{ const d=vPad(), m=vXf();
  const x=VIEW.x+d.x-(VIEW.cx+VIEW.ox)*VIEW.s, y=VIEW.y+d.y-(VIEW.cy+VIEW.oy)*VIEW.s;
  // snapped on the GRID's own corner, not plant zero: GX/GY are not whole cells
  const fix=(o,a,e)=>{ const dv=m.k*(o+a*VIEW.s)+e; return o+(Math.round(dv)-dv)/m.k; };
  return {x:fix(x,GX,m.ex), y:fix(y,GY,m.ey)}; };
const vPt=p=>{ const o=vOrigin();
  return {x:(p.x-o.x)/VIEW.s, y:(p.y-o.y)/VIEW.s}; };
const vScr=p=>{ const o=vOrigin();
  return {x:o.x+p.x*VIEW.s, y:o.y+p.y*VIEW.s}; };
const vIn=p=>p.x>=VIEW.x&&p.x<=VIEW.x+VIEW.w&&p.y>=VIEW.y&&p.y<=VIEW.y+VIEW.h;
// a point measured on a hosted canvas passes vIn() too, so it is excluded here
const vHit=p=>!ui.ptrHost&&vIn(p);
function vBox(x,y,w,h){ VIEW.x=x; VIEW.y=y; VIEW.w=w; VIEW.h=h; }
function vXf(){ const m=ctx.getTransform&&ctx.getTransform();
  return m&&m.a ? {k:m.a, ex:m.e, ey:m.f} : {k:1, ex:0, ey:0}; }
const vDevK=()=>vXf().k;
function vSnapS(s){ const k=vDevK(); return Math.max(1,Math.floor(CELL*s*k))/(CELL*k); }
const ZOOM_IN_RUNGS=2;
const vSMax=()=>(typeof marginZoomMaxS==="function") ? marginZoomMaxS()*Math.pow(ZOOM_STEP,ZOOM_IN_RUNGS) : Infinity;
const ZOOM_OUT_RUNGS=3;
const vZMin=()=>vFitAll()/Math.pow(ZOOM_STEP,ZOOM_OUT_RUNGS);
function vScale(z){
  const f=Math.max(1e-9,VIEW.fit);
  VIEW.z=clamp(z, vZMin(), vSMax()/f);
  VIEW.s=vSnapS(VIEW.fit*VIEW.z);
}
function vFit(x,y,w,h,cx,cy,cw,ch,padX,padY,winW,winH){
  vBox(x,y,w,h);
  VIEW.cx=cx; VIEW.cy=cy; VIEW.cw=cw; VIEW.ch=ch;
  const fw=Math.max(40,w-(padX||0)), fh=Math.max(40,h-(padY||0));
  VIEW.fit=Math.min(fw/Math.max(winW||cw,1), fh/Math.max(winH||ch,1));
  vScale(VIEW.z);
}
// 1 before the first draw: no box yet means nobody has measured, not "fits at nothing"
const vFitAll=()=>(VIEW.w<=0||VIEW.h<=0) ? 1 :
  Math.min(VIEW.w/Math.max(VIEW.cw,1), VIEW.h/Math.max(VIEW.ch,1))/Math.max(1e-9,VIEW.fit);
function vAnchor(a,sx,sy){
  const d=vPad();
  VIEW.ox=(a.x-VIEW.cx)-(sx-VIEW.x-d.x)/VIEW.s;
  VIEW.oy=(a.y-VIEW.cy)-(sy-VIEW.y-d.y)/VIEW.s;
}
function vZoom(z,cx,cy){
  vScale(z);
  vAnchor({x:cx,y:cy}, VIEW.x+VIEW.w/2, VIEW.y+VIEW.h/2);
}
const ZOOM_STEP=1.5;
function vZoomStep(dir){
  const ZOOM_EPS=1e-6;
  const base=panZ!=null ? panZ : VIEW.z;
  const n=Math.log(Math.max(1e-9,base))/Math.log(ZOOM_STEP);
  const rung=dir>0 ? Math.floor(n+ZOOM_EPS)+1 : Math.ceil(n-ZOOM_EPS)-1;
  vPanPt(panTo || vPt({x:VIEW.x+VIEW.w/2, y:VIEW.y+VIEW.h/2}), Math.pow(ZOOM_STEP,rung));
}

// the plant POINT, not a solved VIEW.ox/oy: the view may zoom or resize mid-ease
let panTo=null, panZ=null;
const PAN_K=16;
const PAN_EPS=0.5;
function vCenterOn(r){ vAnchor({x:r.x+r.w/2, y:r.y+r.h/2}, VIEW.x+VIEW.w/2, VIEW.y+VIEW.h/2); }
function vPanPt(p,z){
  panTo={x:p.x, y:p.y};
  panZ = z==null ? null : clamp(z, vZMin(), vSMax()/Math.max(1e-9,VIEW.fit));
}
function vPanTo(r,z){ vPanPt({x:r.x+r.w/2, y:r.y+r.h/2}, z); }
function vPanStep(dt){
  if(!panTo) return false;
  const cx=VIEW.x+VIEW.w/2, cy=VIEW.y+VIEW.h/2;
  const s0=vScr(panTo);
  if(panZ!=null){
    vScale(approach(VIEW.z,panZ,dt,PAN_K));
    // landed ON the figure: an approach stops short, and vZoomStep() counts its rung off VIEW.z
    if(Math.abs(panZ-VIEW.z)<panZ*1e-3){ vScale(panZ); panZ=null; }
  }
  const sx=approach(s0.x,cx,dt,PAN_K), sy=approach(s0.y,cy,dt,PAN_K);
  vAnchor(panTo,sx,sy);
  if(panZ==null && Math.abs(sx-cx)<PAN_EPS && Math.abs(sy-cy)<PAN_EPS){
    vAnchor(panTo,cx,cy); panTo=null; }
  return true;
}

const KEYS=[];
const keyAdd=o=>{ KEYS.push(o); return o; };
const keyList=()=>KEYS.filter(k=>!k.sc||k.sc===screen);
addEventListener("keydown",e=>{
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  // menu then prewarm eat Escape ahead of the registry, which takes the first match for good
  if(e.key==="Escape" && ctxMenu){ e.preventDefault(); ctxClose(); return; }
  if(e.key==="Escape" && prewarmBusy()){ e.preventDefault(); prewarmCancel(); return; }
  // a focused field owns the keyboard: every registry key is a character somebody is typing
  if(uiTyping()) return;
  const nk=navKey(e);
  if(nk && navLive_()){
    e.preventDefault();
    if(!e.repeat && !navHeld.has(nk)){ navHeld.add(nk); const d=navHeldDir(); navPreview(d[0],d[1]); }
    return;
  }
  if(typeof panKeyNav==="function" && panKeyNav(e)) return;
  const K=keyList().find(k=>k.k===e.key && !!k.shift===e.shiftKey);
  if(K){ e.preventDefault(); K.fn(); }
});
// not a KEYS row: a HOLD that lands on the release, and two keys held aim diagonally
const NAV={w:[0,-1], a:[-1,0], s:[0,1], d:[1,0]};
const navHeld=new Set();
const navKey=e=>{ const k=e.key&&e.key.length===1 ? e.key.toLowerCase() : ""; return NAV[k]?k:""; };
const uiTyping=()=>{ const el=typeof document!=="undefined" && document.activeElement;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName||"")); };
const navLive_=()=>plantScreen();
function navHeldDir(){ let dx=0, dy=0;
  for(const k of navHeld){ const v=NAV[k]; dx+=v[0]; dy+=v[1]; }
  return [dx,dy]; }
// the first release commits and drops the rest, or a diagonal re-previews as its survivor
addEventListener("keyup",e=>{
  const nk=navKey(e);
  if(!nk || !navHeld.has(nk)) return;
  navHeld.clear(); navCommit();
});
addEventListener("blur",()=>{ if(navHeld.size){ navHeld.clear(); navClear(); } });

const OVL=[];
let ovlOpen=null;
const ovlAdd=o=>{ OVL.push(o); return o; };
const ovlList=()=>OVL.filter(o=>(!o.sc||o.sc===screen)&&(!o.when||o.when()));
const ovlFor=k=>ovlList().find(o=>o.k===k);
function ovlToggle(k){ ovlOpen = ovlOpen===k ? null : k; }
function drawOverlay(){
  if(!ovlOpen) return;
  const o=ovlFor(ovlOpen); if(!o){ ovlOpen=null; return; }
  const h=Math.min(typeof o.h==="function"?o.h():o.h, VIEW.h-10), y=VIEW.y+VIEW.h-h;
  fillRect(VIEW.x,VIEW.y,VIEW.w,VIEW.h,"rgba(6,10,11,.62)");
  fillRect(12,y,736,h,C.panel);
  // catcher, before the panel's own widgets: a click on bare overlay must not reach behind
  push({x:12,y,w:736,h,type:"btn"});
  o.draw(y);
}
function ovlBar(y,h,note){
  fillRect(0,y,W,h,C.panel); fillRect(0,y,W,1,C.edge);
  let x=W-12;
  const L=ovlList();
  for(let i=L.length-1;i>=0;i--){ const o=L[i];
    const kw=tw(o.label,{size:6.5,sp:1,caps:1})+14;
    x-=kw;
    const ky=y+(h-BTN_H)/2;
    button(x,ky,kw,BTN_H,o.label,
      {sunk:1,on:ovlOpen===o.k,size:6.5,sp:1,fn:()=>ovlToggle(o.k)});
    TIP(x,ky,kw,BTN_H,o.label,o.tip);
    x-=4;
  }
  if(note) fitTxt(note,12,midBase(y,h,7),x-20,{size:7,color:C.ink2});
}

const CTX=[];
const ctxAdd=o=>{ CTX.push(o); return o; };
const ctxFor=()=>CTX.find(o=>!o.sc||o.sc===screen);

let ctxMenu=null;
// resolve(p) reads a LAYOUT point; cx/cy carry client pixels, the space the box is placed in
function openCtxMenu(p,e){
  const R=ctxFor();
  ctxMenu = R ? R.resolve(p) : null;
  if(ctxMenu){ ctxMenu.cx=e.clientX; ctxMenu.cy=e.clientY; }
  ctxShow(ctxMenu);
}
let ctxShow=()=>{}, ctxHide=()=>{};
function ctxClose(){ ctxMenu=null; ctxHide(); }

const ptIn=(w,p)=>w.v ? (vIn(p)? vPt(p) : null) : p;

const push=w=>{ if(viewOn) w.v=1; w.host=ui.host; ui.widgets.push(w); return w; };
const inside=(w,p)=>!!p&&p.x>=w.x&&p.x<=w.x+w.w&&p.y>=w.y&&p.y<=w.y+w.h;
const hov=w=>w.host===ui.ptrHost&&inside(w,ptIn(w,ui.ptr))&&!ui.drag;
// hov() without the drag gate, for a region that decides whether a control is drawn at all
const hovHold=w=>w.host===ui.ptrHost&&inside(w,ptIn(w,ui.ptr));
// asked of the slider's own RECT, not the pointer: a geared drag is carried off the track
const sldIn=r=>{ const d=ui.drag;
  return !!(d&&d.type==="sld"&&d.x>=r.x-2&&d.x<=r.x+r.w+2&&d.y>=r.y-2&&d.y<=r.y+r.h+2); };
const hitAt=p=>{
  for(let i=ui.prev.length-1;i>=0;i--){ const w=ui.prev[i];
    if(w.host===ui.ptrHost&&inside(w,ptIn(w,p))) return w; }
  return null;
};
/* One string makes the tools exclusive by construction. TOOL.set() is the one door onto it, so
   arming a tool and disarming the last one cannot be two decisions in two files. */
const TOOL={active:"select"};
const TOOLS=[
  {id:"select", sc:"design", label:"SELECT",
   tip:"Pick a machine to configure it, and drag it to move it. Click a cell beside a machine to start a pipe there, then drag the pipe's other end to the machine you want it to reach. Drag the pipe itself to pull a waypoint out of it; right click a waypoint to drop it."},
  {id:"paint", sc:"design", label:"PAINT", stick:true,
   tip:"Drag to paint structure into cells: shielding, or a gas-tight containment wall. A closed shape painted in a gas-tight material IS a containment - gas, heat and a release stop at it - and the seal drawn round it says the fill came back bounded. Hold the right button and sweep to take cells out. Paint blocks a machine and passes a pipe: a run crossing a wall is a penetration."},
  {id:"hit", sc:"operate", label:"AIMED COMBAT HIT", stick:true,
   tip:"Click a machine, a port or a pipe cell to take the hit THERE. The tool stays armed until you pick it again or press Escape; a click on bare deck does nothing."},
  {id:"blast", sc:"operate", label:"BLAST", stick:true, fault:true,
   tip:"Click a room cell to set a blast off there, at the overpressure in the box beside this key. It arrives in that cell and spreads out from it as a wave, so what it wrecks depends on how far away it is."},
  {id:"inject", sc:"operate", label:"INJECT", stick:true, fault:true,
   tip:"Hold the left button on a cell and it adds at the rate in the box beside this key, every tick, until you let go. The right button takes away instead. What it adds is the kind chosen beside it: heat and gas land in a room cell, fluid lands in the machine or pipe under the pointer."},
];
const toolRow = id => TOOLS.filter(t=>t.id===id)[0] || null;
const toolArmed = () => { const t=toolRow(TOOL.active); return !!(t && t.stick); };
// the sticking faults, for the drawer that houses them
const toolFaults = () => TOOLS.filter(t=>t.fault);
/* Picking the armed tool again returns to SELECT, which is the toggle every caller wants. */
TOOL.set = id => {
  const next = (id === TOOL.active && id !== "select") ? "select" : id;
  if(next === TOOL.active) return next;
  if(TOOL.active === "paint") matPen = null;
  if(TOOL.active === "inject") injectStop();
  ui.drag = null;
  ctxClose();
  TOOL.active = next;
  return next;
};
const cellAt=pt=>[Math.floor((pt.x-GX)/CELL), rowAt(pt.y)];
const cellSame=(a,b)=>!!a&&!!b&&a[0]===b[0]&&a[1]===b[1];
const matPaintCell = (x,y) => matPaint(x,y, matPen);
const matLiftCell = (x,y) => matLift(x,y);
function matPaintAt(pt){ const c=cellAt(pt);
  if(matPaintCell(c[0],c[1])) buildLayout(); }
function matLiftAt(pt){ const c=cellAt(pt);
  if(matLiftCell(c[0],c[1])) buildLayout(); }
// tool state, not a D field: nothing comparing a design signature may see it move
let matPen = null;
/* The two fault tools' own dials. Tool state like matPen, never on D and never on S - what reaches S
   is the act, and only when a button goes down. */
const FAULT={blastMPa:5, injectKind:"heat"};
const INJECT_KIND=[
  {id:"heat",  label:"HEAT",  unit:"kW",   rate:1000, tip:"Kilowatts into the cell's own air, on the same source term a fire uses."},
  {id:"gas",   label:"GAS",   unit:"kg/s", rate:0.5, tip:"Hydrogen into the cell. Removing takes the cell's whole gas inventory out in proportion, the way a vent set does."},
  {id:"fluid", label:"FLUID", unit:"kg/s", rate:10,  tip:"Kilograms onto the node under the pointer - a machine or a pipe run. It is booked against `inject`, so the ledger still closes."},
];
const injectRow = () => INJECT_KIND.filter(k=>k.id===FAULT.injectKind)[0] || INJECT_KIND[0];
/* Heat and gas are room-cell fields, so the aim is the bare cell; fluid is plant inventory and lands
   on a node, so it goes through the same hitAimAt() the combat hit does. The difference is here only. */
const injectAim = pt => { const c=cellAt(pt);
  if(c[0]<0||c[0]>=GW||c[1]<0||c[1]>=GH) return null;
  if(FAULT.injectKind !== "fluid") return c[1]*GW+c[0];
  const a=hitAimAt(pt);
  // a run or a machine carries a node; a nozzle and a painted wall do not
  return (a && a.indexOf("port:") !== 0 && a.indexOf("mat:") !== 0) ? a : null; };
let injectAt=null;
function injectGo(pt, sign){
  const a=injectAim(pt);
  if(a===null || (a===injectAt && S && S.inject && S.inject.rate*sign>0)) return;
  injectAt=a;
  act("injectOn", FAULT.injectKind, injectRow().rate*sign, a);
}
function injectStop(){ if(injectAt===null) return; injectAt=null;
  if(typeof S!=="undefined" && S && S.inject) act("injectOff"); }
function hitAimAt(pt){
  const p=partAt([pt.x,pt.y]);
  if(p) return p.id;
  const c=cellAt(pt);
  const pid=portAtCell(c[0],c[1]);
  if(pid) return "port:"+pid;
  // before the pipe: a run crossing a wall is a penetration, so both are in the cell
  if(matCell(c[0],c[1])) return "mat:"+c[0]+","+c[1];
  const k=pipeKey(c[0],c[1]);
  return D.pipes[k] ? "pipe:"+k : null;
}

let touchTip=null, isTouch=false;
function TIP(x,y,w,h,title,body,g){ ui.tips.push({x,y,w,h,title,body,g,v:viewOn?1:0,host:ui.host}); }
function findTip(p){
  for(let i=ui.tips.length-1;i>=0;i--){ const t=ui.tips[i];
    if(t.host!==ui.ptrHost) continue;
    const q=ptIn(t,p); if(!q) continue;
    if(q.x>=t.x&&q.x<=t.x+t.w&&q.y>=t.y&&q.y<=t.y+t.h) return t; }
  return null;
}
function tipHover(){
  // a drag covers what it moves, except INJECT, whose whole point is watching the cell answer
  if(ui.drag && ui.drag.type !== "inject") return null;
  if(isTouch) return (touchTip && performance.now()<touchTip.until) ? touchTip : null;
  return findTip(ui.ptr);
}

const BTN_H=14, BTN_H_MIN=10, BTN_TXT_PAD=5;
function btnFill(o,hovered){
  if(o.danger) return hovered?"#ff7d6c":C.red;
  if(o.on) return "#2a1f08";
  const base = o.sunk?C.edge:(o.base!==undefined?o.base:C.panel);
  return hovered ? (o.sunk?C.edge2:C.panelHi) : base;
}
function button(x,y,w,h,label,o){
  o=o||{}; const wd=o.inert?{x,y,w,h}:push({x,y,w,h,type:"btn",fn:o.fn});
  const h_=!o.inert && hov(wd);
  const col = o.inert ? "#3c4c47" : o.danger ? C.red : o.on ? C.amber : (h_?C.edge2:C.edge);
  fillRect(x,y,w,h, o.inert?C.panel:btnFill(o,h_));
  if(!o.sunk && !o.flat) frame(x,y,w,h,col);
  const q={size:o.size||9,weight:(!o.inert&&o.danger)?700:o.weight,
           sp:o.sp===undefined?1.6:o.sp,caps:1,align:"center",
           color:o.inert?"#3c4c47":o.danger?"#160404":o.on?C.amber:(h_?C.bright:C.ink)};
  let inner=Math.max(2,w-BTN_TXT_PAD);
  if(tw(label,q)>inner && q.sp>0) q.sp=0;
  if(tw(label,Object.assign({},q,{size:TSCALE[TSCALE.length-1]}))>inner)
    inner=Math.max(2,w-2);
  clipTxt(label,x+w/2,midBase(y,h,fitStep(label,inner,q)),inner,q);
  return wd;
}
function sldRead(wd,fmt){
  return wd.pv!=null ? {s:fmt(wd.pv),col:C.amber} : {s:fmt(wd.val),col:C.cyan};
}

// o.th sizes the widget; o.tw is the GRAB zone, not a drawn width
function slider(x,y,w,val,min,max,o){
  o=o||{}; const th=o.th||22, tw_=o.tw||10;
  // rounded to whole layout units first, or a 1-unit serif across a half unit smears to 2
  const t0=Math.round(y-th/2), t1=Math.round(y+th/2), hh=t1-t0;
  // width measured at both range ends AND the value, or the track jiggles as digits come and go
  const ro={size:6.5};
  let rw = o.fmt ? Math.max(tw(o.fmt(min),ro),tw(o.fmt(max),ro),tw(o.fmt(val),ro))+5 : 0;
  if(w-rw<24) rw=0;
  const tW=w-rw;
  // the widget is the TRACK, not the row, or clicking the number would slam the value
  const wd = o.inert ? {x,w:tW,val,pv:null}
    : push({x,y:y-th/2-2,w:tW,h:th+4,type:"sld",min,max,fn:o.fn,
                 cy:y,val,tw_});
  const t=clamp((val-min)/(max-min),0,1);
  wd.tx=x+t*tW;
  const dem = o.dem==null ? t : clamp((o.dem-min)/(max-min),0,1);
  const lo_ = !!o.markLo;
  const mk  = o.mark==null ? (lo_?-1:2) : clamp((o.mark-min)/(max-min),0,1);
  const lo=Math.min(t,dem), hi=Math.max(t,dem), rising=dem>t;
  const viol = o.mark==null ? false : (lo_? t<mk   : t>mk);
  const violD= o.mark==null ? false : (lo_? dem<mk : dem>mk);
  // through ptIn() like any plant widget, or the preview hairline lands on the PAGE pointer
  const pp = o.inert ? null : ptIn(wd,ui.ptr);
  wd.pv = (pp && hov(wd)) ? valFrom(wd,pp.x) : null;
  const n=clamp(Math.round(tW/5),6,30), cw=tW/n;
  const bh=Math.min(10,th-3), by=Math.round(y-bh/2);
  for(let i=0;i<n;i++){
    // a cell lies past the mark, but it is the VALUE crossing it that lights the cell red
    const c=(i+.5)/n, past=lo_? c<mk : c>mk;
    let col = past?"#240b08":C.well;
    if(c<=lo)      col = o.inert?"#2b3338":(past&&viol)?C.red:"#2f7d8c";
    else if(c<=hi) col = (past&&(viol||violD))?"#5c2a1c"
                                              :(rising?"#5a4415":"#1d3a41");
    fillRect(x+i*cw,by,cw-1.3,bh,col);
  }
  if(o.mark!=null) fillRect(Math.round(x+mk*tW),t0,1,hh,C.red);
  if(o.marks) for(const mv of o.marks){
    const f=clamp((mv-min)/(max-min),0,1);
    ctx.globalAlpha=.5; fillRect(Math.round(x+f*tW),t0,1,hh,C.amber); ctx.globalAlpha=1;
  }
  if(wd.pv!=null) fillRect(Math.round(pp.x),t0,1,hh,"#7a5a18");
  const cx=Math.round(clamp(x+t*tW,x+1,x+tW-1)), ind=o.inert?C.ink2:C.amber;
  fillRect(cx-1,t0,3,hh,C.bg);
  fillRect(cx,t0,1,hh,ind);
  fillRect(cx-2,t0,5,1,ind);
  fillRect(cx-2,t1-1,5,1,ind);
  if(o.dem!=null && Math.abs(dem-t)>.002){
    const dx=Math.round(clamp(x+dem*tW,x+1,x+tW-1));
    fillRect(dx,t0,1,4,C.amber); fillRect(dx-1,t0,3,1,C.amber);
  }
  if(rw){ const r=sldRead(wd,o.fmt);
    txt(r.s,x+w,midBase(t0,hh,6.5),Object.assign({},ro,{align:"right",color:o.inert?C.ink2:r.col})); }
  else if(o.fmt && wd.pv!=null){
    const ps=o.fmt(wd.pv), lw=tw(ps,ro)+4, far=(pp.x-x)/tW>.5;
    const px=far ? x+1 : x+tW-lw-1;
    fillRect(px,t0,lw,hh,C.bg);
    txt(ps,px+lw/2,midBase(t0,hh,6.5),Object.assign({},ro,{align:"center",color:C.amber}));
  }
  return wd;
}
// the canvas covers layout y = TOPBAR_H..H, not 0..H: the HTML topbar owns the rest
function local(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(W/r.width),
          y:(e.clientY-r.top)*((H-TOPBAR_H)/r.height)+TOPBAR_H}; }
const valFrom=(w,x)=>w.min+clamp((x-w.x)/w.w,0,1)*(w.max-w.min);
// geared like a fader: pulling away from the track buys less travel per pixel
const sldGain = dy => 1/(1+Math.max(0,Math.abs(dy)-24)/16);

const DBL_MS=400, DBL_PX=6;
let lastDown=null;
// MouseEvent.detail is not promised on a PointerEvent, so the count is derived here
function dblCheck(p,e){
  const now=performance.now();
  const dbl = !!lastDown && e.button===lastDown.button
    && now-lastDown.t<DBL_MS && Math.hypot(p.x-lastDown.x,p.y-lastDown.y)<DBL_PX;
  lastDown={t:now,x:p.x,y:p.y,button:e.button};
  return dbl;
}
// anything that covers the plant has to suppress the browser menu too, not just #cv
const ctxSuppress=el=>el&&MOUSE.noCtx(el);
ctxSuppress(cv);
// a drag is stamped with the surface it started on: hosts measure in overlapping spaces
/* a drag may PLACE something - a pipe that finds a machine, a painted wall - and what it places states its figures on release */
const dragOn=d=>{ d.host=ui.ptrHost; d.figWas=figSubs(); ui.drag=d; return d; };
function uiDown(e,el){
  const tgt=el||cv;
  MOUSE.grab(tgt);
  const p=uiPt(tgt,e); ui.ptr=p; ui.ptrHost=tgt._uiHost||null;
  e.dbl=dblCheck(p,e);
  ctxClose();
  if(e.button===2){
    const w=hitAt(p);
    if(screen==="design" && TOOL.active==="paint" && vHit(p)){
      dragOn({type:"materase", v:1, last:cellAt(vPt(p))});
      matLiftAt(vPt(p));
      return;
    }
    if(screen==="operate" && TOOL.active==="inject" && vHit(p)){
      dragOn({type:"inject", v:1, sign:-1});
      injectGo(vPt(p), -1);
      return;
    }
    if(w&&w.type==="runend"){
      if(sel===w.rid) sel=null;
      removeRun(w.rid);
      return; }
    if(w&&w.type==="runpin"){
      D.runs[w.rid].pins.splice(w.i,1); runLay(w.rid);
      return; }
    if(w&&w.type==="port"){
      dragOn({type:"portr"});
      return; }
    // measured on #cv: hostLocal() is relative to a panel the pan itself moves
    if(!e.shiftKey && !ui.ptrHost){ const lp=local(e);
      dragOn({type:"pan",lx:lp.x,ly:lp.y,sx:lp.x,sy:lp.y,moved:false}); }
    return; }
  isTouch = e.pointerType==="touch" || e.pointerType==="pen";
  if(isTouch){ const t=findTip(p);
    touchTip = t ? Object.assign({},t,{until:performance.now()+4000}) : null; }
  const w=hitAt(p);
  // a tool pre-empts the per-widget dispatch below: the press is about the tool
  if(screen==="operate" && TOOL.active==="hit" && vHit(p)){
    const aim=hitAimAt(vPt(p));
    if(!aim && w) return;
    if(aim) act("hit",aim);
    return;
  }
  if(screen==="operate" && TOOL.active==="blast" && vHit(p)){
    const c=cellAt(vPt(p));
    if(c[0]>=0&&c[0]<GW&&c[1]>=0&&c[1]<GH) act("blast", c[1]*GW+c[0], FAULT.blastMPa*1000);
    return;
  }
  if(screen==="operate" && TOOL.active==="inject" && vHit(p)){
    dragOn({type:"inject", v:1, sign:1});
    injectGo(vPt(p), 1);
    return;
  }
  if(screen==="design" && TOOL.active==="paint" && vHit(p)){
    const c=cellAt(vPt(p));
    dragOn({type:"matdraw", v:1, last:c});
    matPaintAt(vPt(p));
    sel="mat:"+c[0]+","+c[1];
    return;
  }
  // a run has no widget in the hit list, so it is resolved off the CELL under the pointer
  if(!w && vHit(p) && typeof runsAtCell==="function"){
    const c=cellAt(vPt(p));
    if(matCell(c[0],c[1])){ sel="mat:"+c[0]+","+c[1]; return; }
    if(screen==="design"){
      const keys=runsAtCell(c[0],c[1]);
      if(keys.length){
        const key=keys[keys.length-1];
        const rid = key, r = sel===key && D.runs[rid];
        if(r && r.cells){
          const at=r.cells.findIndex(q=>cellSame(q,c));
          if(at>=0){
            let j=0;
            for(const pin of r.pins){ const pj=r.cells.findIndex(q=>cellSame(q,pin));
              if(pj>=0&&pj<at) j++; }
            r.pins.splice(j,0,c);
            dragOn({type:"pipewp", rid, i:j, v:1});
            runLay(rid);
          }
        }
        sel=key; return;
      }
    }
  }
  if(!w){ sel=null; return; }
  const q=ptIn(w,p);
    if(w.type==="part"){ sel=w.part.id;
      // a commissioned plant is welded down, and a pinned part rides its parent
      if(screen==="design" && !w.part.pin){ const g=gridPt([q.x,q.y]);
        dragOn({type:"part",part:w.part,
          // the grab is in CELLS: a pixel offset is not a fixed share of a banded row
          ox:g.x-w.part.x, oy:g.y-w.part.y,
          sx:w.part.x, sy:w.part.y, gx:w.part.x, gy:w.part.y, v:w.v}); } }
    else if(w.type==="sld"){ dragOn(w);
      const onThumb=Math.abs(q.x-w.tx)<=w.tw_/2+3;
      w.gv = onThumb ? w.val : valFrom(w,q.x);
      w.gx = q.x; w.gx0 = q.x; w.moved = false;
      if(!onThumb) w.fn(w.gv); }
    else if(w.type==="btn"){ w.fn&&w.fn(); }
    else if(w.type==="port"){ const r=D.ports[w.pid].run;
      if(r!==undefined && D.runs[r]) sel=r; else removePort(w.pid); }
    else if(w.type==="portv"){ act("portShut",w.pid); }
    else if(w.type==="ghostport"){
      const p=partOf(w.p), a=p&&[p.x+w.dx, p.y+w.dy];
      const f=p&&faceOfOffset(p,w.dx,w.dy);
      const b=f&&runSpotNear(a[0]+DIRV[f][0], a[1]+DIRV[f][1]);
      if(b){ sel=mintRun(a,b); runLay(sel);
        dragOn({type:"pipewp", rid:sel, which:"b", v:w.v}); }
    }
    else if(w.type==="runend"){ sel=w.rid; dragOn({type:"pipewp", rid:w.rid, which:w.which, v:w.v}); }
    else if(w.type==="runpin"){ sel=w.rid; dragOn({type:"pipewp", rid:w.rid, i:w.i, v:w.v}); }
    // nothing commits until the release: gridDrag() re-lays the whole board
    else if(w.type==="hull") dragOn({type:"hull",edge:w.edge,v:w.v,gw:D.gw,gh:D.gh});
  else if(w.type==="paint"){ dragOn(w); w.last=null; w.fn(q,e); }
}
function partDragTo(d,q){
  const g=gridPt([q.x,q.y]);
  d.gx=Math.round(g.x-d.ox); d.gy=Math.round(g.y-d.oy);
}
function uiMove(e,el){
  const tgt=el||cv;
  const host=tgt._uiHost||null;
  // ui.ptr must stay in the space the drag's own handler reads
  if(ui.drag && ui.drag.host!==host) return;
  const p=uiPt(tgt,e); ui.ptr=p; ui.ptrHost=host;
  if(e.pointerType==="mouse") isTouch=false;
  if(ui.drag){ const d=ui.drag, q=d.v?vPt(p):p;
    if(d.type==="part") partDragTo(d,q);
    else if(d.type==="pipewp"){ const c=cellAt(q), r=D.runs[d.rid];
      if(r && c[0]>=0 && c[1]>=0 && c[0]<GW && c[1]<GH){
        const was = d.which ? r[d.which] : r.pins[d.i];
        if(was && !cellSame(c,was)){
          if(d.which) r[d.which]=c; else r.pins[d.i]=c;
          runLay(d.rid);
        } } }
    else if(d.type==="hull"){ const c=cellAt(q);
      if(c){ d.c=c; [d.gw,d.gh]=gridClamp(d.edge==="r"?c[0]+1:D.gw, d.edge==="b"?c[1]+1:D.gh); } }
    // walked cell by cell: a pointer sample is not a cell, and a gap is a wall that never closes
    else if(d.type==="matdraw" || d.type==="materase"){
      const c=cellAt(q), fn = d.type==="matdraw" ? matPaintCell : matLiftCell;
      if(!cellSame(c,d.last) && c[0]>=0 && c[1]>=0 && c[0]<GW && c[1]<GH){
        let [x,y]=d.last||c;
        while(x!==c[0]){ x+=Math.sign(c[0]-x); fn(x,y); }
        while(y!==c[1]){ y+=Math.sign(c[1]-y); fn(x,y); }
        d.last=c; buildLayout();
      } }
    else if(d.type==="inject") injectGo(q, d.sign);
    else if(d.type==="paint"){ d.fn(q,e); }
    else if(d.type==="sld"){
      // ORDERED bounds: a scale may run backwards, and clamp(min>max) pins everything low
      const lo=Math.min(d.min,d.max), hi=Math.max(d.min,d.max);
      d.gv=clamp(d.gv+(q.x-d.gx)/d.w*(d.max-d.min)*sldGain(q.y-d.cy),lo,hi);
      if(q.x!==d.gx0) d.moved=true;
      d.gx=q.x; d.fn(d.gv); }
    else if(d.type==="pan"){
      const lp=local(e);
      panTo=panZ=null;
      VIEW.ox-=(lp.x-d.lx)/VIEW.s; VIEW.oy-=(lp.y-d.ly)/VIEW.s;
      d.lx=lp.x; d.ly=lp.y;
      if(Math.hypot(lp.x-d.sx,lp.y-d.sy)>4) d.moved=true; }
  }
  tgt.style.cursor = ui.drag&&(ui.drag.type==="pan"||ui.drag.type==="pipewp"||ui.drag.type==="tap"||ui.drag.type==="part") ? "grabbing"
    : ui.prev.some(w=>inside(w,ptIn(w,p))) ? "pointer" : "default";
}
function uiUp(e,el){
  const d=ui.drag;
  // a press that never moved is a click, even on the thumb the grab swallowed
  if(d&&d.type==="sld"&&!d.moved) d.fn(valFrom(d,d.gx0));
  if(d&&d.type==="pan"&&!d.moved&&e.button===2) openCtxMenu(local(e),e);
  if(d&&d.type==="portr"&&e.button===2) openCtxMenu(local(e),e);
  if(d&&d.type==="part"){
    const p=uiPt(el||cv,e);
    // only off a point the plant covers: the grab still delivers over a rail, and vPt() extrapolates
    if(!d.v || vIn(p)) partDragTo(d, d.v?vPt(p):p);
    if(d.gx!==d.sx||d.gy!==d.sy) moveTo(d.part,d.gx,d.gy);
  }
  // asked on the RELEASE: merging mid-drag takes the grip out from under the hand
  if(d&&d.type==="pipewp"&&D.runs[d.rid]){
    if(d.which) for(const w of ["a","b"]){ const j=runJoinAt(d.rid,w);
      if(j) sel=mergeRuns(d.rid,w,j.rid,j.which); }
    else runPinCollapse(d.rid,d.i);
  }
  if(d&&d.type==="inject") injectStop();
  if(d&&d.type==="hull"&&d.c) gridDrag(d.edge,d.c);
  if(d&&d.figWas) designBakeSince(d.figWas);
  ui.drag=null;
}
function uiPt(el,e){ return el._uiLocal? el._uiLocal(e) : local(e); }
// an input keeps the loop awake for UI_TRAIL frames, or the interval between paints is as ragged as the event stream
const UI_TRAIL=12;
let uiWants=true, uiTrail=0;
const uiDirty=()=>{ uiWants=true; uiTrail=UI_TRAIL; };
const uiTakeDirty=()=>{
  const w=uiWants||uiTrail>0||!!ui.drag;
  uiWants=false; if(uiTrail>0) uiTrail--;
  return w;
};
if(typeof MOUSE!=="undefined") MOUSE.doc({down:uiDirty, move:uiDirty, up:uiDirty,
  cancel:uiDirty, wheel:uiDirty, click:uiDirty});
if(typeof document!=="undefined" && document.addEventListener)
  for(const ev of ["keydown","keyup","focusin","scroll"])
    document.addEventListener(ev,uiDirty,{capture:true,passive:true});

function uiBind(el){
  MOUSE.on(el,{down:uiDown, move:uiMove, up:uiUp,
    cancel(){ injectStop(); ui.drag=null; ui.ptr={x:-1e4,y:-1e4}; ui.ptrHost=null; uiDirty(); },
    // a leave is not a cancel while a hand is down: the grab keeps delivering
    leave(){ if(ui.drag) return;
      ui.ptr={x:-1e4,y:-1e4}; ui.ptrHost=null; uiDirty(); }});
}
uiBind(cv);
function uiForward(el,toLocal){
  el._uiHost=el; el._uiLocal=toLocal;
  ctxSuppress(el);
  uiBind(el);
}
MOUSE.on(cv,{wheel(e){
  if(screen==="scenario"){ e.preventDefault(); scnWheel(local(e),e.deltaY); return; }
  const p=local(e);
  e.preventDefault();
  // the box is anchored where the pointer WAS, so an open menu is stale once the view moves
  ctxClose();
  vWheel(p,e.deltaY);
}});
function vWheel(p,dy){
  const on=vIn(p);
  const px=on? p.x : VIEW.x+VIEW.w/2, py=on? p.y : VIEW.y+VIEW.h/2;
  const a=vPt({x:px,y:py});          // the point to hold still, at the OLD scale
  panTo=panZ=null;
  vScale(VIEW.z*Math.exp(-dy*0.0015));
  vAnchor(a,px,py);
}
