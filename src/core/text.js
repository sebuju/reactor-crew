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
  o=o||{};
  const size=fitStep(s,maxw,o);
  txt(s,x,y,Object.assign({},o,{size}));
  return size;
}
/* fitTxt shrinks; this one shrinks AND THEN CUTS. The ladder has a floor, so a
   long string in a narrow column overflows at 6px however far it was stepped
   down - which is how the trend legend came to draw past the edge of its own
   chart. The HTML side has had this all along as text-overflow:ellipsis; this
   is the canvas half of the same behaviour.

   ONLY EVER FOR A NAME. A clipped number is a DIFFERENT number and reads as one
   - "-5437" cut to "-54" is not a shortened value, it is a wrong one. A caller
   with a figure to place must drop the unit, drop a neighbour, or take a wider
   box; there is no honest way to trim it. */
function clipTxt(s,x,y,maxw,o){
  o=o||{};
  /* o.step:false cuts WITHOUT walking the ladder first. For a set of labels
     that must all read as one class - every machine's name on the plant - a
     stepped-down one is a different kind of label, not a narrower one. */
  const size = o.step===false ? (o.size||10) : fitStep(s,maxw,o);
  let t=String(s);
  if(tw(t,Object.assign({},o,{size}))>maxw){
    const per=Math.max(1e-6,tw("M",Object.assign({},o,{size})));
    t=t.slice(0,Math.max(1,Math.floor(maxw/per)));
  }
  txt(t,x,y,Object.assign({},o,{size}));
  return size;
}
/* the step fitTxt would use, without drawing - so clipTxt can ask the same
   question and there is still one walk of the ladder */
function fitStep(s,maxw,o){
  const want=(o&&o.size)||10;
  for(const t of TSCALE) if(t<=want && tw(s,Object.assign({},o,{size:t}))<=maxw) return t;
  return TSCALE[TSCALE.length-1];
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
