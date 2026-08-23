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
  txt(label,x+w/2,midBase(y,h,o.size||9),{size:o.size||9,sp:o.sp===undefined?1.6:o.sp,caps:1,align:"center",
      color:o.danger?C.red:o.on?C.amber:(h_?C.bright:C.ink)});
  return wd;
}
/* o.th / o.tw shrink the thumb so the same slider fits inside a component;
   left out, they give the bench sizes exactly as before */
function slider(x,y,w,val,min,max,o){
  o=o||{}; const th=o.th||22, tw_=o.tw||10;
  const wd=push({x,y:y-th/2-2,w,h:th+4,type:"sld",min,max,fn:o.fn,
                 cy:y,val,tw_});     // cy/val/tw_ are what the drag handler needs
  fillRect(x,y-3,w,6,C.well); frame(x,y-3,w,6,C.edge);
  if(o.ticks!==false) for(let i=0;i<=8;i++) fillRect(x+i*(w/8), y+6, 1, 3, C.edge2);
  /* clamp t, or a value outside the range draws the thumb off the end of its track */
  const t=clamp((val-min)/(max-min),0,1), tx=x+t*w;
  wd.tx=tx;
  fillRect(x,y-3,t*w,6,"#1d3a41");
  /* two 1px markers ride the same track, so they share one closure.
     o.mark is a fixed setpoint the slider is ALLOWED to cross - crossing it
     costs something, and the line is drawn so it is never a surprise.
     o.dem is where you dragged to: with a rate limit the thumb shows where
     the plant IS, not what you asked for. */
  const tick=(v,col)=>fillRect(x+clamp((v-min)/(max-min),0,1)*w-0.5,y-th/2,1,th,col);
  if(o.mark!=null) tick(o.mark,C.red);
  if(o.dem!=null)  tick(o.dem,C.amber);
  const thx=clamp(tx-tw_/2,x,x+w-tw_);            // the thumb stays on its own track
  fillRect(thx,y-th/2,tw_,th,C.amber);
  fillRect(thx+tw_/2-1,y-th/2+4,2,th-8,"#2a1f08");
  return wd;
}
function local(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(H/r.height)}; }
const valFrom=(w,x)=>w.min+clamp((x-w.x)/w.w,0,1)*(w.max-w.min);
/* A control mounted inside a component is only as wide as the component, and the
   rod bank gets 84px for a full 0..100% stroke. So the drag is relative and
   geared: pull away from the track and the same hand movement buys less travel,
   the way a fader does. Grabbing the thumb never jumps the value; pressing the
   bare track still does, because that is how you get somewhere fast. */
const sldGain = dy => 1/(1+Math.max(0,Math.abs(dy)-24)/16);

cv.addEventListener("pointerdown",e=>{
  cv.setPointerCapture(e.pointerId); const p=local(e); ui.ptr=p;
  isTouch = e.pointerType==="touch" || e.pointerType==="pen";
  if(isTouch){ const t=findTip(p);
    touchTip = t ? Object.assign({},t,{until:performance.now()+4000}) : null; }
  for(let i=ui.prev.length-1;i>=0;i--){ const w=ui.prev[i];
    if(!inside(w,p)) continue;
    if(w.type==="part"){ sel=w.part.id;
      /* a commissioned plant is welded down - you may select a component, not move it */
      if(screen==="design") ui.drag={type:"part",part:w.part,
        ox:p.x-(GX+w.part.x*CELL), oy:p.y-(GY+w.part.y*CELL),
        sx:w.part.x, sy:w.part.y}; }
    else if(w.type==="sld"){ ui.drag=w;
      const onThumb=Math.abs(p.x-w.tx)<=w.tw_/2+3;
      w.gv = onThumb ? w.val : valFrom(w,p.x);    // gv is the running command value
      w.gx = p.x;
      if(!onThumb) w.fn(w.gv); }
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
    else if(ui.drag.type==="sld"){ const d=ui.drag;
      /* integrate rather than re-derive, so moving away from the track changes
         the gearing from here on instead of jumping the value */
      d.gv=clamp(d.gv+(p.x-d.gx)/d.w*(d.max-d.min)*sldGain(p.y-d.cy),d.min,d.max);
      d.gx=p.x; d.fn(d.gv); }
    else { helpScroll=clamp(helpScroll-(p.y-ui.drag.last),0,helpMax); ui.drag.last=p.y; } }
  cv.style.cursor=ui.prev.some(w=>inside(w,p))?"pointer":"default";
});
["pointerup","pointercancel","pointerleave"].forEach(ev=>
  cv.addEventListener(ev,()=>{ui.drag=null;}));
cv.addEventListener("wheel",e=>{ if(screen==="help"){ e.preventDefault();
  helpScroll=clamp(helpScroll+e.deltaY,0,helpMax); }},{passive:false});
