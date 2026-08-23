"use strict";
/* monospace text measuring and drawing */

/* ─────────────── text ─────────────── */
function fnt(o){ return `${o.weight===700?"bold ":""}${o.size||10}px ${MONO}`; }
function txt(s,x,y,o){
  o=o||{}; s=o.caps?String(s).toUpperCase():String(s);
  ctx.font=fnt(o); ctx.fillStyle=o.color||C.ink;
  ctx.textAlign=o.align||"left"; ctx.textBaseline="alphabetic";
  try{ctx.letterSpacing=(o.sp||0)+"px";}catch(e){}
  ctx.fillText(s,x,y);
  try{ctx.letterSpacing="0px";}catch(e){}
}
function tw(s,o){
  o=o||{}; s=o.caps?String(s).toUpperCase():String(s);
  ctx.font=fnt(o);
  try{ctx.letterSpacing=(o.sp||0)+"px";}catch(e){}
  const w=ctx.measureText(s).width;
  try{ctx.letterSpacing="0px";}catch(e){}
  return w;
}
/* The documented type scale, largest first. fitTxt() walks it, so a shrunk label
   still lands on a real step of the scale instead of an arbitrary size. */
const TSCALE=[15,13,12,10,9.5,9,8.5,8,7.5,7,6.5,6];
/* Draw a string that must not run into whatever sits beside it: step down the
   scale until it fits maxw, then draw. Returns the size actually used.
   A label overrunning its own row is the commonest way this UI breaks - two
   panels were doing it silently before this existed, and neither was noticed by
   eye. Give it the width the neighbour leaves free, not the width of the box. */
function fitTxt(s,x,y,maxw,o){
  o=o||{}; const want=o.size||10; let size=6;
  for(const t of TSCALE) if(t<=want && tw(s,Object.assign({},o,{size:t}))<=maxw){ size=t; break; }
  txt(s,x,y,Object.assign({},o,{size}));
  return size;
}
function wrap(s,x,y,maxw,lh,o){
  const words=String(s).split(" "); let line="";
  for(const wd of words){
    const t=line?line+" "+wd:wd;
    if(tw(t,o)>maxw && line){ txt(line,x,y,o); y+=lh; line=wd; } else line=t;
  }
  if(line){ txt(line,x,y,o); y+=lh; }
  return y;
}
function wrapCount(s,maxw,o){
  const words=String(s).split(" "); let line="",n=1;
  for(const wd of words){
    const t=line?line+" "+wd:wd;
    if(tw(t,o)>maxw && line){ n++; line=wd; } else line=t;
  }
  return n;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pad=(v,n)=>String(v).padStart(n," ");

/* ─────────────── label placement ───────────────
   Every small label used to be positioned by a hand-tuned magic number, and each
   number had been tuned against a different font size, so a 6.5px label in a 10px
   box sat a pixel low while an 8px one in an 8px box poked out of the top. Cap
   height is a fixed share of the em in this mono stack, so one helper places them
   all: midBase() returns the baseline that optically centres CAPS in a box. */
const CAP=0.72;                                     // cap height / em
const capH    = size       => size*CAP;
const midBase = (y,h,size) => y+h/2+size*CAP/2;
