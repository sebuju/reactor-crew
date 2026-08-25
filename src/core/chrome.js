"use strict";

/* one first-order approach, so every damped display figure closes the same way */
const approach=(cur,target,dt,k)=>cur+(target-cur)*Math.min(1,dt*k);

function fillRect(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }
function line(x1,y1,x2,y2,c,w){ ctx.strokeStyle=c; ctx.lineWidth=w||1;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
// no colour, or C.edge/C.edge2 (structural boxes), draws no outline; any other
// colour is a state (selected/damaged/fitted/plotted) and is the only thing
// left saying so, so it stays.
function frame(x,y,w,h,c){
  if(!c || c===C.edge || c===C.edge2) return;
  ctx.strokeStyle=c; ctx.lineWidth=1;
  ctx.strokeRect(Math.round(x)+.5,Math.round(y)+.5,Math.round(w)-1,Math.round(h)-1); }
function rr(x,y,w,h,r){                 // rounded-rect path (no roundRect in older engines)
  r=Math.min(r||0,w/2,h/2);
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);     ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
const lerpC=(a,b,t)=>{ t=clamp(t,0,1);
  const h=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
  const A=h(a),B=h(b);
  return `rgb(${A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(",")})`; };
function chip(x,y,col){ fillRect(x,y,6,6,col); }
// same signature as chip(): top-left x/y + size, so a caller picks the shape
// without touching where anything sits
function dot(x,y,d,col){ ctx.beginPath(); ctx.arc(x+d/2,y+d/2,d/2,0,Math.PI*2);
  ctx.fillStyle=col; ctx.fill(); }
// o.size/o.sp shrink the heading for a narrow column; the 8px/2px default was
// measured against a 736-wide panel, where the same string reads louder than
// the data under it in a narrower one.
function well(x,y,w,h,title,titleCol,o){
  fillRect(x,y,w,h,C.panel); frame(x,y,w,h,C.edge);
  if(title) rule(title,x+10,y+15,w-20,titleCol,o);
}
function rule(label,x,y,w,col,o){
  o=o||{}; const f={size:o.size||8, sp:o.sp===undefined?2:o.sp, caps:1};
  txt(label,x,y,{...f,color:col||C.ink2});
  const lw=tw(label,f)+7;
  if(w-lw>4) fillRect(x+lw,y-3,w-lw,1,C.edge2);
}
function seg(x,y,w,h,frac,col,cells){
  cells=cells||24; const cw=w/cells;
  for(let i=0;i<cells;i++){
    const on=(i+1)/cells<=frac+1e-9;
    fillRect(x+i*cw, y, cw-1.3, h, on?col:"#152125");
  }
}
function segSigned(x,y,w,h,f,col){
  const cells=28, cw=w/cells, mid=cells/2;
  for(let i=0;i<cells;i++){
    let on = f>=0 ? (i>=mid && (i-mid+1)/mid<=f)
                  : (i< mid && (mid-i)/mid<=-f);
    fillRect(x+i*cw, y, cw-1.3, h, on?col:"#152125");
  }
  fillRect(x+w/2-.5, y-2, 1, h+4, C.rail);
}
// limit is marked on the track, never the end of it — same convention as
// pipeDial(), so pushing past a rating still reads on the bar.
// marks: track fractions, 0..1 unsigned / -1..1 signed.
const LIM_AT=0.75;
function segMark(x,y,w,h,frac,marks,col,signed){
  if(signed) segSigned(x,y,w,h,clamp(frac,-1,1),col);
  else       seg(x,y,w,h,clamp(frac,0,1),col,16);
  for(const m of marks){
    const mx=Math.round(x+w*(signed?(m+1)/2:m));
    fillRect(mx-.5,y-2,1,h+4,C.rail);
  }
}
function hatch(x,y,w,h,col,a){
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  ctx.globalAlpha=a||.55; ctx.strokeStyle=col; ctx.lineWidth=1.4;
  for(let i=-h;i<w;i+=7){ ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.stroke(); }
  ctx.restore();
}
// blinks on the same 900ms rhythm as the annunciator tile, so both read as one signal
function lamp(x,y,col){
  ctx.beginPath(); ctx.arc(x,y,4,0,7);
  ctx.fillStyle = (col===C.red && performance.now()%900<450) ? "#5a1109" : col;
  ctx.fill();
}
function badge(x,y,col){
  ctx.beginPath(); ctx.moveTo(x,y-8); ctx.lineTo(x+8,y+5); ctx.lineTo(x-8,y+5);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
  ctx.strokeStyle="#0a0f0e"; ctx.lineWidth=1; ctx.stroke();
  txt("!",x,y+4,{size:8,weight:700,align:"center",color:"#180404"});
}
// baked once into a pattern rather than drawn every frame
let gridPat=null;
(function(){ const g=document.createElement("canvas"); g.width=g.height=8;
  const c=g.getContext("2d"); c.fillStyle="rgba(120,180,190,.075)"; c.fillRect(0,0,1,1);
  gridPat=ctx.createPattern(g,"repeat"); })();

// o.col is the one escape hatch: reactor POWER is coloured off DNBR rather
// than its own value, since 89% power with a steam film on the pins isn't a
// green number. Everything else lets the band decide.
function band(v,lo,hi,zones,o){
  o=o||{};
  return {v,lo,hi,zones,dp:o.dp||0,lim:o.lim||null,col:o.col||null};
}
function bandZone(g,v){
  v=(v===undefined)?g.v:v;
  for(const z of g.zones) if(v<z[0]) return z;
  return g.zones[g.zones.length-1];
}
const bandCol=g=>g.col||bandZone(g)[1];

// drawn from y-6 to y+25, so a caller reserving BAND_H gets the bar top at y
// with nothing spilling
const BAND_H=30;
function bandBar(x,y,w,g){
  const span=(g.hi-g.lo)||1, at=v=>x+clamp((v-g.lo)/span,0,1)*w;
  const num=v=>v.toFixed(g.dp);
  const cells=Math.max(10,Math.round(w/5)), cw=w/cells, act=bandZone(g);
  for(let i=0;i<cells;i++){
    const z=bandZone(g,g.lo+span*(i+.5)/cells);
    if(z!==act) ctx.globalAlpha=.26;
    fillRect(x+i*cw,y,cw-1.3,7,z[1]);
    ctx.globalAlpha=1;
  }
  if(g.lim) for(const L of g.lim) fillRect(at(L[0])-.5,y-4,1,15,C.red);
  // drawn last, thicker than any limit mark, so the value is never hidden under one
  const px=at(g.v);
  fillRect(px-1,y-4,3,15,C.bright);
  fillRect(px-3,y-6,7,2,C.bright);
  // the scale covers the STEERED range; a scram runs DNBR/rho off the end on
  // purpose — pegged and shown as a detached pip, not swallowed into a wider scale
  if(g.v<g.lo||g.v>g.hi) fillRect(g.v>g.hi?px+4:px-7,y+2,3,3,C.bright);
  // boundary labels within 18px of an end are dropped — the end label is the
  // one that can't be inferred from the colour it separates
  txt(num(g.lo),x,y+17,{size:6,sp:.5,color:C.ink2});
  txt(num(g.hi),x+w,y+17,{size:6,sp:.5,align:"right",color:C.ink2});
  g.zones.slice(0,-1).forEach((z,i)=>{
    const bx=at(z[0]);
    if(bx-x<18 || x+w-bx<18) return;
    txt(num(z[0]),bx,y+17,{size:6,sp:.5,align:"center",color:g.zones[i+1][1]});
  });
}
