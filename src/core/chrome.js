"use strict";

/* one first-order approach, so every damped display figure closes the same way */
const approach=(cur,target,dt,k)=>cur+(target-cur)*Math.min(1,dt*k);

function fillRect(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }
function line(x1,y1,x2,y2,c,w){ ctx.strokeStyle=c; ctx.lineWidth=w||1;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
// no colour, or C.edge/C.edge2 (structural boxes), draws no outline; any other
// colour is a state (selected/damaged/fitted/plotted) and is the only thing
// left saying so, so it stays.
/* ══ A BORDER IS ONE SCREEN PIXEL, ON THE EDGE IT IS ABOUT ══
   Rounding in LAYOUT units and offsetting half of one was right while the
   canvas drew a layout unit as a screen pixel, and the plant has not for a
   long time: at the bench's own scale half a unit is 0.59 of a pixel, so a
   selection outline landed between two pixels and read a pixel wide on one
   side of the box and two on the other. Snapped in DEVICE pixels off the
   canvas' own transform instead, one device pixel thick, drawn inside the
   rectangle it is given - so a frame is exactly the box, never a pixel over
   it. devK() answers 1 headless, where there is no bitmap to be off by. */
function devK(){ const m=ctx.getTransform&&ctx.getTransform(); return m&&m.a ? m : {a:1,d:1,e:0,f:0}; }
function frame(x,y,w,h,c){
  if(!c || c===C.edge || c===C.edge2) return;
  const m=devK(), sx=v=>(Math.round(m.a*v+m.e)-m.e)/m.a, sy=v=>(Math.round(m.d*v+m.f)-m.f)/m.d;
  const x0=sx(x), y0=sy(y), x1=sx(x+w), y1=sy(y+h), hx=.5/m.a, hy=.5/m.d;
  ctx.strokeStyle=c; ctx.lineWidth=1/m.a;
  ctx.strokeRect(x0+hx, y0+hy, Math.max(0,x1-x0-2*hx), Math.max(0,y1-y0-2*hy)); }
function rr(x,y,w,h,r){                 // rounded-rect path (no roundRect in older engines)
  // FLOORED AT 0: a box that has been squeezed to a negative size hands
  // Math.min a negative half-side, and arcTo THROWS on a negative radius -
  // which takes the whole frame down from wherever it was in the draw. A
  // radius is never meaningfully negative, so this is the primitive's job.
  r=Math.max(0,Math.min(r||0,w/2,h/2));
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);     ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
/* PACKED, AND THE ANSWER IS SHARED. This is asked once per core node per
   frame, and the obvious spelling - two parsed arrays, a map and a join -
   allocated five objects to hand back a string the previous node had usually
   already produced. Same arithmetic, same output; both tables are caches of
   pure functions and are cleared rather than grown without bound. */
const LERP_HEX=new Map(), LERP_RGB=new Map();
/* lerpC's own output is an rgb() string, so a colour lerped twice - which is
   every temperature-tinted pipe - parsed as NaN and packed as black. */
const hexPack=c=>{ let v=LERP_HEX.get(c);
  if(v===undefined){
    if(c.charCodeAt(0)===35) v=parseInt(c.slice(1,7),16);
    else { const n=c.match(/\d+/g)||[0,0,0]; v=(+n[0]<<16)|(+n[1]<<8)|(+n[2]); }
    LERP_HEX.set(c,v);
  }
  return v; };
const lerpC=(a,b,t)=>{ t=clamp(t,0,1);
  const A=hexPack(a), B=hexPack(b);
  const r=Math.round((A>>16&255)+((B>>16&255)-(A>>16&255))*t),
        g=Math.round((A>>8 &255)+((B>>8 &255)-(A>>8 &255))*t),
        u=Math.round((A    &255)+((B    &255)-(A    &255))*t);
  const key=(r<<16)|(g<<8)|u;
  let s=LERP_RGB.get(key);
  if(s===undefined){ if(LERP_RGB.size>4096) LERP_RGB.clear();
    s="rgb("+r+","+g+","+u+")"; LERP_RGB.set(key,s); }
  return s; };
/* the same colour, carrying an alpha. A gradient stop takes ONE string, so a
   caller cannot set globalAlpha and hand over a palette entry - it has to hand
   over the alpha inside the colour. */
const alphaC=(c,a)=>{ const v=hexPack(c);
  return "rgba("+(v>>16&255)+","+(v>>8&255)+","+(v&255)+","+clamp(a,0,1).toFixed(3)+")"; };
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
/* ONE FILL, NOT A LOOP OF STROKES. Three hundred of these a frame during an
   accident, each clipping and stroking its own lines. The family drawn is
   X+Y = 0 (mod 7) - which is what the phase term below spelled out: a line
   through (x+i, y+h) at 45 degrees has X+Y = x+y+h+i, and i was stepped off
   -((x+y+h) mod 7). That is a fact about the CANVAS and not about the rect,
   which is why two hatched cells side by side read as one pattern, so it bakes
   into a 7x7 tile pinned at the origin and every call is a fillRect.
   Baked at device scale, so the diagonal is as crisp as the stroke it
   replaces; one tile per colour, and per scale. */
const HATCH_P=7, HATCH_W=1.4;
const ctxScale=()=>{ const m=ctx.getTransform&&ctx.getTransform();
  return (m&&m.a) ? Math.max(0.05,Math.hypot(m.a,m.b)) : 0; };
const hatchOK=()=>typeof DOMMatrix!=="undefined" && ctxScale()>0;
function hatchPat(col,P,lw){
  const sc=ctxScale();
  const key=col+"@"+sc.toFixed(3)+"@"+P+"@"+lw;
  // per CONTEXT: hostPaint() swaps ctx for a rail's own bitmap, and a pattern
  // belongs to the context that made it
  const pats = ctx.__hatchPats || (ctx.__hatchPats=new Map());
  let pat=pats.get(key);
  if(!pat){ const n=Math.max(1,Math.round(P*sc));
    const g=document.createElement("canvas"); g.width=g.height=n;
    const c=g.getContext("2d");
    c.setTransform(n/P,0,0,n/P,0,0);
    c.strokeStyle=col; c.lineWidth=lw; c.lineCap="butt";
    // the tile's own line plus its two neighbours, so the corners wrap
    for(const k of [0,P,2*P]){
      c.beginPath(); c.moveTo(k-P,P); c.lineTo(k+P,-P); c.stroke(); }
    pat=ctx.createPattern(g,"repeat");
    if(pat.setTransform && typeof DOMMatrix!=="undefined")
      pat.setTransform(new DOMMatrix().scaleSelf(P/n));
    pats.set(key,pat); }
  return pat;
}
function hatch(x,y,w,h,col,a,pitch,lw){
  const P=pitch||HATCH_P, LW=lw||HATCH_W;
  ctx.save();
  ctx.globalAlpha=a||.55;
  if(hatchOK()){ ctx.fillStyle=hatchPat(col,P,LW); ctx.fillRect(x,y,w,h); }
  else {
    // no real 2-D context to bake into (the headless DOM): stroke it
    ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
    ctx.strokeStyle=col; ctx.lineWidth=LW;
    const ph=(((x+y+h)%P)+P)%P;
    for(let i=P*Math.floor((ph-h)/P)-ph;i<w;i+=P){
      ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.stroke(); }
  }
  ctx.restore();
}
/* blinks on the same 900ms rhythm as the annunciator tile, so both read as one
   signal - off the PLANT's clock (fxClock(), fx.js), not the wall's, so a
   paused board stops flashing along with everything else it draws. */
function lamp(x,y,col){
  ctx.beginPath(); ctx.arc(x,y,4,0,7);
  ctx.fillStyle = (col===C.red && (fxClock()*1000)%900<450) ? "#5a1109" : col;
  ctx.fill();
}
/* THE ATTENTION MARK IS A FOLDED CORNER, not an icon. A triangle with a "!" in
   it was a second visual language on a board that otherwise says everything
   with colour and a plate; at 16 px the glyph was mush and the outline fought
   the box's own frame. This is flush to the corner it marks, so it reads as
   the BOX being flagged rather than as a sticker dropped on it. (x, y) is the
   box's top-right corner. */
function cornerTab(x,y,s,col){
  ctx.beginPath(); ctx.moveTo(x-s,y); ctx.lineTo(x,y); ctx.lineTo(x,y+s);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
}
/* baked once into a pattern rather than drawn every frame. The pitch is the
   PLANT grid's and the pattern is anchored on the grid's own corner, so a dot
   lands on every cell corner at any zoom instead of forming a second, finer
   grid that drifts against the one it is behind. Built lazily: CELL loads
   after this file. */
let gridPat=null;
function gridDots(x,y,w,h){
  if(!gridPat){ const g=document.createElement("canvas"); g.width=g.height=CELL;
    const c=g.getContext("2d"); c.fillStyle="rgba(120,180,190,.075)"; c.fillRect(0,0,1,1);
    gridPat=ctx.createPattern(g,"repeat"); }
  const s=VIEW.s||1, o=vScr({x:GX,y:GY});
  if(gridPat.setTransform && typeof DOMMatrix!=="undefined")
    gridPat.setTransform(new DOMMatrix().translateSelf(o.x,o.y).scaleSelf(s));
  ctx.fillStyle=gridPat; ctx.fillRect(x,y,w,h);
}

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

// the SCALE a band draws is KIT.band() (ui/kit.js) - one widget, in HTML, for
// the inspector row and the tooltip alike. band()/bandZone()/bandCol above are
// the model it reads, and they stay.
