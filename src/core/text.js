"use strict";
const FNT_CACHE=new Map(), SP_CACHE=new Map();
function fnt(o){
  const size=(o&&o.size)||10, bold=!!(o&&o.weight===700), key=bold?-size:size;
  let f=FNT_CACHE.get(key);
  if(f===undefined){ if(FNT_CACHE.size>256) FNT_CACHE.clear();
    f=(bold?"bold ":"")+size+"px "+MONO; FNT_CACHE.set(key,f); }
  return f;
}
function spPx(sp){
  let s=SP_CACHE.get(sp);
  if(s===undefined){ if(SP_CACHE.size>256) SP_CACHE.clear();
    s=sp+"px"; SP_CACHE.set(sp,s); }
  return s;
}
const TXT_NONE=Object.freeze({});
function txt(s,x,y,o){
  o=o||TXT_NONE; s=o.caps?String(s).toUpperCase():String(s);
  ctx.font=fnt(o); ctx.fillStyle=o.color||C.ink;
  ctx.textAlign=o.align||"left"; ctx.textBaseline="alphabetic";
  try{ctx.letterSpacing=spPx(o.sp||0);}catch(e){}
  ctx.fillText(s,x,y);
  try{ctx.letterSpacing="0px";}catch(e){}
}
/* a width is a pure function of (font, letter-spacing, string); the canvas transform does not enter the key */
// keyed on the string as asked, caps a slot of its own, so a hit spells no upper-case copy
const TW_BY_SIZE=new Map(), TW_BY_SIZE_CAPS=new Map();
const twSlot=(size,bold,sp,caps)=>fontSlot(caps?TW_BY_SIZE_CAPS:TW_BY_SIZE,size,bold,sp);
function fontSlot(top,size,bold,sp){
  const k=bold?-size:size;
  let bySp=top.get(k); if(!bySp){ bySp=new Map(); top.set(k,bySp); }
  let m=bySp.get(sp);  if(!m){ m=new Map(); bySp.set(sp,m); }
  return m;
}
function tw(s,o){
  o=o||TXT_NONE;
  const sp=o.sp||0, m=twSlot(o.size||10, o.weight===700, sp, !!o.caps);
  const hit=m.get(s); if(hit!==undefined) return hit;
  const t=o.caps?String(s).toUpperCase():String(s);
  ctx.font=fnt(o);
  try{ctx.letterSpacing=spPx(sp);}catch(e){}
  const w=ctx.measureText(t).width;
  try{ctx.letterSpacing="0px";}catch(e){}
  if(m.size>8192) m.clear();
  m.set(s,w);
  return w;
}
// scratch bags carrying every key txt(), tw() and fnt() read, refilled per call: the helpers below run per label per frame
const TXT_Q={size:10, weight:undefined, sp:0, caps:0, align:undefined, color:undefined},
      TXT_FIT={size:10, weight:undefined, sp:0, caps:0, align:undefined, color:undefined};
const txtAs=(q,o,size)=>{ q.size=size; q.weight=o.weight; q.sp=o.sp; q.caps=o.caps; q.align=o.align; q.color=o.color; return q; };
/* the type scale, largest first: fitTxt() walks it, so a shrunk label lands on a real step */
const TSCALE=[15,13,12,10,9.5,9,8.5,8,7.5,7,6.5,6];
function fitTxt(s,x,y,maxw,o){
  o=o||TXT_NONE;
  const size=fitStep(s,maxw,o);
  txt(s,x,y,txtAs(TXT_Q,o,size));
  return size;
}
/* names only: this one cuts, and a clipped number is a different number */
function clipTxt(s,x,y,maxw,o){
  o=o||TXT_NONE;
  /* o.step:false cuts without walking the ladder: a set of labels must all read as one class */
  const size = o.step===false ? (o.size||10) : fitStep(s,maxw,o);
  const q=txtAs(TXT_Q,o,size);
  let t=String(s);
  if(tw(t,q)>maxw){
    const per=Math.max(1e-6,tw("M",q));
    t=t.slice(0,Math.max(1,Math.floor(maxw/per)));
  }
  txt(t,x,y,q);
  return size;
}
/* for a figure narrower than the ladder's floor: steps down, then scales uniformly past it */
function squeezeTxt(s,cx,yBase,maxw,o){
  const q=txtAs(TXT_Q,o,fitStep(s,maxw,o)); q.align="center";
  const w=tw(s,q);
  // o.maxh is the cap height the caller has room for
  const kh = o.maxh ? o.maxh/(q.size*CAP) : 1;
  if(w<=maxw && kh>=1){ txt(s,cx,yBase,q); return; }
  const k=Math.min(maxw/w,kh);
  ctx.save(); ctx.translate(cx,yBase); ctx.scale(k,k);
  txt(s,0,0,q); ctx.restore();
}
function fitStep(s,maxw,o){
  const want=(o&&o.size)||10;
  const q=txtAs(TXT_FIT,o||TXT_NONE,want);
  for(let i=0;i<TSCALE.length;i++){ const t=TSCALE[i]; q.size=t; if(t<=want && tw(s,q)<=maxw) return t; }
  return TSCALE[TSCALE.length-1];
}
// a label slot: the text it last printed and the figure that text rounds from
const txtSlot=()=>({k:NaN, neg:false, dp:-1, pre:"", unit:"", s:"", a:"", b:""});
const FIX_POW=[1,10,100,1000];
// pre+v.toFixed(dp)+unit, respelt only when the rounded figure moves; within 1e-6 of a half the key and toFixed() may disagree, so that case is asked afresh
function fixTxt(o,v,dp,unit,pre){
  pre=pre||"";
  const a=Math.abs(v)*FIX_POW[dp], k=Math.round(a), neg=v<0, clean=a<1e9 && Math.abs(a-Math.floor(a)-0.5)>1e-6;
  if(clean && k===o.k && neg===o.neg && dp===o.dp && unit===o.unit && pre===o.pre) return o.s;
  o.s=pre+v.toFixed(dp)+unit; o.k=clean?k:NaN; o.neg=neg; o.dp=dp; o.unit=unit; o.pre=pre;
  return o.s;
}
// a+b, rejoined only when either part is a new string
function catTxt(o,a,b){ if(o.a!==a || o.b!==b){ o.a=a; o.b=b; o.s=a+b; } return o.s; }
// the lines are shared between callers, never to be written; a pure function of (font, width, string), like tw()
const WRAP_BY_SIZE=new Map(), WRAP_BY_SIZE_CAPS=new Map();
function wrapLines(s,maxw,o){
  o=o||TXT_NONE;
  const f=fontSlot(o.caps?WRAP_BY_SIZE_CAPS:WRAP_BY_SIZE, o.size||10, o.weight===700, o.sp||0);
  let m=f.get(maxw); if(!m){ m=new Map(); f.set(maxw,m); }
  let out=m.get(s);
  if(out===undefined){ if(m.size>8192) m.clear(); out=wrapLinesRaw(s,maxw,o); m.set(s,out); }
  return out;
}
function wrapLinesRaw(s,maxw,o){
  const words=String(s).split(" "), out=[]; let line="";
  for(const wd of words){
    const t=line?line+" "+wd:wd;
    if(tw(t,o)>maxw && line){ out.push(line); line=wd; } else line=t;
  }
  if(line) out.push(line);
  return out;
}
function wrap(s,x,y,maxw,lh,o){
  for(const l of wrapLines(s,maxw,o)){ txt(l,x,y,o); y+=lh; }
  return y;
}
const wrapCount=(s,maxw,o)=>Math.max(1,wrapLines(s,maxw,o).length);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/* a switch both threads ask: the worker is spawned with the page's own query on its script url */
const urlOff=k=>typeof location!=="undefined" && new URLSearchParams(location.search).get(k)==="off";
const pad=(v,n)=>String(v).padStart(n," ");

const CAP=0.72;                                     // cap height / em
const capH    = size       => size*CAP;
const midBase = (y,h,size) => y+h/2+size*CAP/2;
