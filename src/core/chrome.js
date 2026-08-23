"use strict";
/* panel chrome: wells, rules, bars, ticks, grid pattern */

/* ─────────────── chrome primitives ─────────────── */
function fillRect(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }
function line(x1,y1,x2,y2,c,w){ ctx.strokeStyle=c; ctx.lineWidth=w||1;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
function frame(x,y,w,h,c){ ctx.strokeStyle=c||C.edge; ctx.lineWidth=1;
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
function accent(x,y,w,col){ fillRect(x,y,w,2,col); }   // top-edge accent, replaces the old left spine
function chip(x,y,col){ fillRect(x,y,6,6,col); }       // inline row marker
function ticks(x,y,w,h,c,L){                    // corner registration marks
  L=L||5; ctx.strokeStyle=c||C.edge2; ctx.lineWidth=1; ctx.beginPath();
  ctx.moveTo(x,y+L); ctx.lineTo(x,y); ctx.lineTo(x+L,y);
  ctx.moveTo(x+w-L,y); ctx.lineTo(x+w,y); ctx.lineTo(x+w,y+L);
  ctx.moveTo(x+w,y+h-L); ctx.lineTo(x+w,y+h); ctx.lineTo(x+w-L,y+h);
  ctx.moveTo(x+L,y+h); ctx.lineTo(x,y+h); ctx.lineTo(x,y+h-L);
  ctx.stroke();
}
function well(x,y,w,h,title,titleCol){
  fillRect(x,y,w,h,C.panel); frame(x,y,w,h,C.edge);
  ticks(x+.5,y+.5,w-1,h-1,C.edge2,5);
  if(title) rule(title,x+10,y+15,w-20,titleCol);
}
function rule(label,x,y,w,col){                 // LABEL ─────────────
  txt(label,x,y,{size:8,sp:2,caps:1,color:col||C.ink2});
  const lw=tw(label,{size:8,sp:2,caps:1})+7;
  if(w-lw>4) fillRect(x+lw,y-3,w-lw,1,C.edge2);
}
function seg(x,y,w,h,frac,col,cells){           // LED bargraph
  cells=cells||24; const cw=w/cells;
  for(let i=0;i<cells;i++){
    const on=(i+1)/cells<=frac+1e-9;
    fillRect(x+i*cw, y, cw-1.3, h, on?col:"#152125");
  }
}
function segSigned(x,y,w,h,f,col){              // centre-zero bargraph
  const cells=28, cw=w/cells, mid=cells/2;
  for(let i=0;i<cells;i++){
    let on = f>=0 ? (i>=mid && (i-mid+1)/mid<=f)
                  : (i< mid && (mid-i)/mid<=-f);
    fillRect(x+i*cw, y, cw-1.3, h, on?col:"#152125");
  }
  fillRect(x+w/2-.5, y-2, 1, h+4, C.rail);
}
function hatch(x,y,w,h,col,a){          // damage overlay
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  ctx.globalAlpha=a||.55; ctx.strokeStyle=col; ctx.lineWidth=1.4;
  for(let i=-h;i<w;i+=7){ ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.stroke(); }
  ctx.restore();
}
/* An alarm lamp on a component: a solid pip and nothing round it. The board
   says WHICH alarm; this only says HERE. Red blinks on the annunciator's own
   rhythm, so the tile and the lamp read as one thing seen in two places. */
function lamp(x,y,col){
  ctx.beginPath(); ctx.arc(x,y,4,0,7);
  ctx.fillStyle = (col===C.red && performance.now()%900<450) ? "#5a1109" : col;
  ctx.fill();
}
function badge(x,y,col){                 // "!" fault marker
  ctx.beginPath(); ctx.moveTo(x,y-8); ctx.lineTo(x+8,y+5); ctx.lineTo(x-8,y+5);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
  ctx.strokeStyle="#0a0f0e"; ctx.lineWidth=1; ctx.stroke();
  txt("!",x,y+4,{size:8,weight:700,align:"center",color:"#180404"});
}
function crack(pts,col){
  ctx.beginPath(); ctx.moveTo(pts[0],pts[1]);
  for(let i=2;i<pts.length;i+=2) ctx.lineTo(pts[i],pts[i+1]);
  ctx.strokeStyle=col; ctx.lineWidth=2.4; ctx.stroke();
  ctx.strokeStyle="#0a0f0e"; ctx.lineWidth=.8; ctx.stroke();
}
/* dotted background grid, baked once into a pattern */
let gridPat=null;
(function(){ const g=document.createElement("canvas"); g.width=g.height=8;
  const c=g.getContext("2d"); c.fillStyle="rgba(120,180,190,.075)"; c.fillRect(0,0,1,1);
  gridPat=ctx.createPattern(g,"repeat"); })();
