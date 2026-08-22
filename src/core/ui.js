"use strict";
/* immediate-mode widget list, hit testing, tooltips */

/* ═══════════════ immediate-mode UI ═══════════════ */
const ui={widgets:[],prev:[],tips:[],drag:null,ptr:{x:-9,y:-9}};
const push=w=>{ui.widgets.push(w);return w;};
const inside=(w,p)=>p.x>=w.x&&p.x<=w.x+w.w&&p.y>=w.y&&p.y<=w.y+w.h;
const hov=w=>inside(w,ui.ptr)&&!ui.drag;

/* ─────────────── tooltips ─────────────── */
let touchTip=null, isTouch=false;
function TIP(x,y,w,h,title,body){ ui.tips.push({x,y,w,h,title,body}); }
function findTip(p){
  for(let i=ui.tips.length-1;i>=0;i--){ const t=ui.tips[i];
    if(p.x>=t.x&&p.x<=t.x+t.w&&p.y>=t.y&&p.y<=t.y+t.h) return t; }
  return null;
}
function drawTip(){
  if(ui.drag) return;
  let t=null;
  if(isTouch){ if(touchTip && performance.now()<touchTip.until) t=touchTip; }
  else t=findTip(ui.ptr);
  if(!t) return;
  ctx.setLineDash([2,2]); frame(t.x-1,t.y-1,t.w+2,t.h+2,C.amber); ctx.setLineDash([]);
  const maxw=248, ob={size:10,color:C.ink};
  const n=wrapCount(t.body,maxw,ob), bw=maxw+20, bh=26+n*13;
  const ax = isTouch ? t.x+t.w/2 : ui.ptr.x, ay = isTouch ? t.y+t.h : ui.ptr.y;
  let bx=clamp(ax+16,6,W-bw-6), by=ay+18;
  if(by+bh>H-6) by=Math.max(46,ay-bh-14);
  fillRect(bx+3,by+3,bw,bh,"rgba(0,0,0,.6)");
  fillRect(bx,by,bw,bh,"#0b1215"); frame(bx,by,bw,bh,C.amber);
  accent(bx,by,bw,C.amber); ticks(bx+.5,by+.5,bw-1,bh-1,C.amber,5);
  txt(t.title,bx+11,by+14,{size:9,weight:700,sp:1.3,caps:1,color:C.amber});
  wrap(t.body,bx+11,by+29,maxw,13,ob);
}

function button(x,y,w,h,label,o){
  o=o||{}; const wd=push({x,y,w,h,type:"btn",fn:o.fn});
  const h_=hov(wd);
  const col = o.danger ? C.red : o.on ? C.amber : (h_?C.edge2:C.edge);
  fillRect(x,y,w,h, o.on?"#2a1f08":(o.danger?"#2a0f0b":(h_?C.panelHi:C.panel)));
  frame(x,y,w,h,col);
  if(o.on||o.danger) ticks(x+.5,y+.5,w-1,h-1,col,4);
  txt(label,x+w/2,y+h/2+3.5,{size:o.size||9,sp:1.6,caps:1,align:"center",
      color:o.danger?C.red:o.on?C.amber:(h_?C.bright:C.ink)});
  return wd;
}
function slider(x,y,w,val,min,max,o){
  o=o||{}; const wd=push({x,y:y-13,w,h:26,type:"sld",min,max,fn:o.fn});
  fillRect(x,y-3,w,6,C.well); frame(x,y-3,w,6,C.edge);
  for(let i=0;i<=8;i++) fillRect(x+i*(w/8), y+6, 1, 3, C.edge2);
  const t=(val-min)/(max-min), tx=x+t*w;
  fillRect(x,y-3,t*w,6,"#1d3a41");
  fillRect(tx-5,y-11,10,22,C.amber);
  fillRect(tx-1,y-7,2,14,"#2a1f08");
  return wd;
}
function local(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(H/r.height)}; }
const valFrom=(w,x)=>w.min+clamp((x-w.x)/w.w,0,1)*(w.max-w.min);

cv.addEventListener("pointerdown",e=>{
  cv.setPointerCapture(e.pointerId); const p=local(e); ui.ptr=p;
  isTouch = e.pointerType==="touch" || e.pointerType==="pen";
  if(isTouch){ const t=findTip(p);
    touchTip = t ? Object.assign({},t,{until:performance.now()+4000}) : null; }
  for(let i=ui.prev.length-1;i>=0;i--){ const w=ui.prev[i];
    if(!inside(w,p)) continue;
    if(w.type==="part"){ sel=w.part.id; ui.drag={type:"part",part:w.part,
      ox:p.x-(GX+w.part.x*CELL), oy:p.y-(GY+w.part.y*CELL),
      sx:w.part.x, sy:w.part.y}; }
    else if(w.type==="sld"){ ui.drag=w; w.fn(valFrom(w,p.x)); }
    else if(w.type==="btn"){ w.fn&&w.fn(); }
    else if(w.type==="scroll"){ ui.drag=w; w.last=p.y; }
    return; }
});
cv.addEventListener("pointermove",e=>{
  const p=local(e); ui.ptr=p;
  if(e.pointerType==="mouse") isTouch=false;
  if(ui.drag){ if(ui.drag.type==="part"){ const d=ui.drag;
      const nx=Math.round((p.x-d.ox-GX)/CELL), ny=Math.round((p.y-d.oy-GY)/CELL);
      if((nx!==d.part.x||ny!==d.part.y)&&fits(d.part,nx,ny)){ d.part.x=nx; d.part.y=ny; } }
    else if(ui.drag.type==="sld") ui.drag.fn(valFrom(ui.drag,p.x));
    else { helpScroll=clamp(helpScroll-(p.y-ui.drag.last),0,helpMax); ui.drag.last=p.y; } }
  cv.style.cursor=ui.prev.some(w=>inside(w,p))?"pointer":"default";
});
["pointerup","pointercancel","pointerleave"].forEach(ev=>
  cv.addEventListener(ev,()=>{ui.drag=null;}));
cv.addEventListener("wheel",e=>{ if(screen==="help"){ e.preventDefault();
  helpScroll=clamp(helpScroll+e.deltaY,0,helpMax); }},{passive:false});
