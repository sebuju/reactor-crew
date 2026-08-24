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
/* A bargraph with the limits marked ON the track. seg() and segSigned() say how
   far along you are; this says how far along you are ALLOWED to be, which is the
   thing a glance is actually asking. The scale deliberately does NOT end at the
   limit - it is only marked there, and the track runs on past it, the same rule
   pipeDial() follows and for the same reason: this plant lets you push past a
   rating and then shows you what it cost. LIM_AT is where on the track the mark
   lands, so every bar in a row puts its limit in the same place and the row can
   be read as one shape instead of six scales.
   `marks` are track fractions: 0..1 unsigned, -1..1 signed. */
const LIM_AT=0.75;
function segMark(x,y,w,h,frac,marks,col,signed){
  if(signed) segSigned(x,y,w,h,clamp(frac,-1,1),col);
  else       seg(x,y,w,h,clamp(frac,0,1),col,16);
  for(const m of marks){
    const mx=Math.round(x+w*(signed?(m+1)/2:m));
    fillRect(mx-.5,y-2,1,h+4,C.rail);
  }
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

/* ══ A NUMBER IS ONLY GOOD OR BAD AGAINST SOMETHING ══
   A readout carries its own SCALE: the range it can sit in, which stretches of
   that are healthy, and where the protection system is watching from. ONE
   object, because the colour the number is printed in and the strip drawn under
   its tooltip are both read off it - state a threshold in two places and the
   day one of them moves, the other goes on quoting the old number at you.

   zones run low to high, each [upTo, colour, label]; a value past the last
   boundary takes the last zone. A LIMIT is a mark ON the scale and never the
   end of it, exactly the way pipeDial() marks a rating - this plant is built to
   let you push past a setpoint and then show you what it cost.

   o.col is the one escape hatch and there is one row using it: reactor POWER
   goes red on low DNBR, because 89% with a steam film on the pins is not a
   green number. Everything else lets the band decide, which is what keeps the
   strip and the figure above it agreeing. */
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

/* The strip. Drawn from y-6 (the value's cap) to y+25 (the numbers under it),
   so a caller reserving BAND_H gets the bar top at y and nothing spills. */
const BAND_H=30;
function bandBar(x,y,w,g){
  const span=(g.hi-g.lo)||1, at=v=>x+clamp((v-g.lo)/span,0,1)*w;
  const num=v=>v.toFixed(g.dp);
  const cells=Math.max(10,Math.round(w/5)), cw=w/cells, act=bandZone(g);
  /* segments, never a solid fill. The zone you are in burns at full strength
     and the rest of the scale sits at a quarter, so the strip reads as context
     rather than as three alarms lit at once. */
  for(let i=0;i<cells;i++){
    const z=bandZone(g,g.lo+span*(i+.5)/cells);
    if(z!==act) ctx.globalAlpha=.26;
    fillRect(x+i*cw,y,cw-1.3,7,z[1]);
    ctx.globalAlpha=1;
  }
  if(g.lim) for(const L of g.lim) fillRect(at(L[0])-.5,y-4,1,15,C.red);
  /* the value stands ON its own scale: thicker and brighter than any setpoint
     mark, and drawn last so it is never the thing hidden underneath */
  const px=at(g.v);
  fillRect(px-1,y-4,3,15,C.bright);
  fillRect(px-3,y-6,7,2,C.bright);
  /* A scale is drawn for the range the plant is STEERED in, so a scrammed core
     runs DNBR clean off the end of it and net rho well past the bottom. That is
     the gauge working - widen it to swallow a scram and the 50 pcm the reading
     is actually for becomes a tenth of a segment. The needle pegs, and a
     detached pip past the end says it pegged rather than arrived. */
  if(g.v<g.lo||g.v>g.hi) fillRect(g.v>g.hi?px+4:px-7,y+2,3,3,C.bright);
  /* The ends give the scale its meaning; the boundaries between zones are the
     numbers the player is actually steering by. A boundary crowding an end is
     dropped rather than overprinted - the end is the one that cannot be
     guessed from the colour it separates. */
  txt(num(g.lo),x,y+17,{size:6,sp:.5,color:C.ink2});
  txt(num(g.hi),x+w,y+17,{size:6,sp:.5,align:"right",color:C.ink2});
  g.zones.slice(0,-1).forEach((z,i)=>{
    const bx=at(z[0]);
    if(bx-x<18 || x+w-bx<18) return;
    txt(num(z[0]),bx,y+17,{size:6,sp:.5,align:"center",color:g.zones[i+1][1]});
  });
}
