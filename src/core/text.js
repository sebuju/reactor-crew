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
