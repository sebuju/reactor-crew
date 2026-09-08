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
function txt(s,x,y,o){
  o=o||{}; s=o.caps?String(s).toUpperCase():String(s);
  ctx.font=fnt(o); ctx.fillStyle=o.color||C.ink;
  ctx.textAlign=o.align||"left"; ctx.textBaseline="alphabetic";
  try{ctx.letterSpacing=spPx(o.sp||0);}catch(e){}
  ctx.fillText(s,x,y);
  try{ctx.letterSpacing="0px";}catch(e){}
}
/* a width is a pure function of (font, letter-spacing, string); the canvas transform does not enter the key */
const TW_BY_SIZE=new Map();
function twSlot(size,bold,sp){
  const k=bold?-size:size;
  let bySp=TW_BY_SIZE.get(k); if(!bySp){ bySp=new Map(); TW_BY_SIZE.set(k,bySp); }
  let m=bySp.get(sp);         if(!m){ m=new Map(); bySp.set(sp,m); }
  return m;
}
function tw(s,o){
  o=o||{}; s=o.caps?String(s).toUpperCase():String(s);
  const sp=o.sp||0, m=twSlot(o.size||10, o.weight===700, sp);
  const hit=m.get(s); if(hit!==undefined) return hit;
  ctx.font=fnt(o);
  try{ctx.letterSpacing=spPx(sp);}catch(e){}
  const w=ctx.measureText(s).width;
  try{ctx.letterSpacing="0px";}catch(e){}
  if(m.size>8192) m.clear();
  m.set(s,w);
  return w;
}
/* the type scale, largest first: fitTxt() walks it, so a shrunk label lands on a real step */
const TSCALE=[15,13,12,10,9.5,9,8.5,8,7.5,7,6.5,6];
function fitTxt(s,x,y,maxw,o){
  o=o||{};
  const size=fitStep(s,maxw,o);
  txt(s,x,y,Object.assign({},o,{size}));
  return size;
}
/* names only: this one cuts, and a clipped number is a different number */
function clipTxt(s,x,y,maxw,o){
  o=o||{};
  /* o.step:false cuts without walking the ladder: a set of labels must all read as one class */
  const size = o.step===false ? (o.size||10) : fitStep(s,maxw,o);
  const q=Object.assign({},o,{size});
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
  const q=Object.assign({},o,{size:fitStep(s,maxw,o),align:"center"});
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
  const q=Object.assign({},o);
  for(const t of TSCALE){ q.size=t; if(t<=want && tw(s,q)<=maxw) return t; }
  return TSCALE[TSCALE.length-1];
}
function wrapLines(s,maxw,o){
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
const pad=(v,n)=>String(v).padStart(n," ");

const CAP=0.72;                                     // cap height / em
const capH    = size       => size*CAP;
const midBase = (y,h,size) => y+h/2+size*CAP/2;
