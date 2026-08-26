"use strict";
/* ═══════════════ what is in the pipes, and what it is doing ═══════════════

   drawPlant() strokes the pipe itself - a dark casing and a coloured fluid line.
   Everything in here goes on top of that: the fluid moving inside the run, and the
   instruments that say how much of it is moving.

   The pipes used to carry a marching dash. A dash reads as a dotted line rather than
   as fluid, its gaps break a thin run into pieces, and at low flow it crawls in a way
   that looks like a dropped frame. What moves now is a PACKET - a bolus of water
   sliding down the bore with a bright leading face, so a parcel visibly leaves the
   core and arrives at the boiler.

   Nothing here invents a flow. S.flowPos[k] is how far the fluid in that line has
   travelled, integrated by the sim at the real rate, so a packet stops exactly when
   its fluid does and the meters differentiate that same number rather than restating
   a formula from step().

   Two rules that the whole file exists to keep:

   A PACKET IS OCCLUDED AT A NOZZLE, NEVER RESIZED. Clamping a packet to the pipe's
   own length made the arriving one grow from a dot and the leaving one shrink back to
   one. So the geometry is extended past both nozzles (pipePad) and the drawing is
   clipped to the pipe's real corridor (pipeClip): a packet is born whole out on the
   runway and is simply cut off where the pipe ends.

   ANYTHING SHORT FADES ACROSS THE BOUNDARY. A long packet crossing a nozzle grows out
   over its own length, which reads as sliding. A 2px bright cap does not - it went
   from nothing to full white in about three frames, and a near-white mark switching on
   and off at a fixed spot, twice per packet, at both ends of every run, was the most
   distracting thing on the diagram. pipeEdge() ramps it instead.                   */

/* s.flowPos is keyed by the same strings pipeNetwork() uses for its runs, so there is
   no kind -> key table to keep in step with anything. */
const PIPE_NAME={hot:"HOT LEG",cold:"COLD LEG",steam:"MAIN STEAM",feed:"FEEDWATER",
                 hpi:"HP INJECTION",surge:"SURGE LINE",exh:"EXHAUST"};
const PIPE_VAPOUR={steam:1,exh:1};              // kinds that carry vapour, not liquid
/* ── EVERY JUNCTION IS ONE LINE, NOT ONE TABLE ROW EACH ──
   The kind carries the junction's own generated id ("xtie:"+id), because any
   number of them can open and shut independently and each therefore needs
   its own flow integral. Nothing else in this file wants to know WHICH one:
   one name, one colour, one full scale, one unit between all of them.
   Written as a prefix test rather than a table keyed by id, so placing or
   removing a junction never touches this file - there is no fixed count to
   run a loop over any more. The "xtie" spelling is kept from the fixed-slot
   cross-ties this replaced, on purpose: it is the one string every lookup
   below already knew how to fall back on. */
/* named pipeLabel, not pipeName: src/data/pipenet.js declares its own
   pipeName() for a placed-pipe part's own id, a different concept (and a
   global collision if this file used the same name). */
const pipeLabel=k=>k.startsWith("xtie")?"CROSS-TIE":PIPE_NAME[k];
/* a junction joins two cold legs and carries what they carry - PC[k] is
   undefined for any "xtie:"+id kind, since pipeColours() cannot enumerate
   every id that exists, so every reader of the colour table falls back
   through this rather than through a pre-populated key for each one. */
const pipeCol=(PC,k)=>PC[k]||(k.startsWith("xtie")?PC.cold:C.ink2);

/* The one pipe colour table. drawPlant() strokes the run with it and the packets are
   drawn in it, so a packet can never be a different colour from its own pipe. */
function pipeColours(L){
  const heat = L? L.n*.935+L.decay : 0;
  const Th = L? L.Tavg+15*heat : 598, Tc = L? L.Tavg-15*heat : 568;
  return { hot: L?lerpC("#5aa9d6","#ff5a45",(Th-520)/110):"#c8735e",
           cold:L?lerpC("#5aa9d6","#ff5a45",(Tc-520)/110):"#5aa9d6",
           surge:"#a98cf0", steam:"#c8d8dc", exh:"#7f9098", feed:"#5aa9d6", hpi:"#5fd2e2" };
}

/* ══════════ polyline geometry ══════════
   pipeNetwork() hands back a plain list of points. Everything below needs the same
   two things from it: a point at a given distance along the run, and a stroked slice
   between two distances. Written once here. */
function pipeGeom(pts){
  const segs=[]; let tot=0;
  for(let i=1;i<pts.length;i++){
    const dx=pts[i][0]-pts[i-1][0], dy=pts[i][1]-pts[i-1][1], L=Math.hypot(dx,dy);
    if(L<0.01) continue;
    segs.push({x:pts[i-1][0],y:pts[i-1][1],dx:dx/L,dy:dy/L,L,s0:tot}); tot+=L;
  }
  return {segs,len:tot};
}
/* a runway of `pad` px straight on past each nozzle, so a packet is full size before
   it is ever visible. Arc length shifts by pad; the real pipe is pad..pad+core. */
function pipePad(g,pad){
  if(!pad || !g.segs.length) return g;
  const segs=g.segs.map(q=>Object.assign({},q,{s0:q.s0+pad}));
  const f=segs[0], l=segs[segs.length-1];
  segs.unshift({x:f.x-f.dx*pad, y:f.y-f.dy*pad, dx:f.dx, dy:f.dy, L:pad, s0:0});
  segs.push({x:l.x+l.dx*l.L, y:l.y+l.dy*l.L, dx:l.dx, dy:l.dy, L:pad, s0:l.s0+l.L});
  return {segs, len:g.len+2*pad, pad, core:g.len};
}
/* Clip to the pipe corridor. Built from the UNPADDED geometry - that is the point.
   TWO half-widths, and the difference is not cosmetic:
     hw  ACROSS the run: the CASING half-width, so a mark sitting off the centreline
         still reads as being inside the bore.
     ext ALONG the run: the FLUID line's half-width. The casing is 8px and the fluid
         line 4px, both square-capped, so the coloured pipe stops 2px past its
         endpoint while the casing runs on to 4px. Clipping to the casing let a packet
         paint on that 2px collar of bare casing, past the visible end of the run -
         and since main steam and exhaust are grey, that showed up as a grey blob
         blinking at both ends of those lines. Stopping at the fluid line puts the cut
         exactly where the pipe's own paint stops.
   ext is also >= the round join radius, so bends stay covered. */
function pipeClip(g,hw,ext){
  ctx.beginPath();
  for(const q of g.segs){
    const ex=q.dx*ext, ey=q.dy*ext, nx=-q.dy*hw, ny=q.dx*hw;
    const ax=q.x-ex, ay=q.y-ey, bx=q.x+q.dx*q.L+ex, by=q.y+q.dy*q.L+ey;
    ctx.moveTo(ax+nx,ay+ny); ctx.lineTo(bx+nx,by+ny);
    ctx.lineTo(bx-nx,by-ny); ctx.lineTo(ax-nx,ay-ny); ctx.closePath();
  }
  ctx.clip();
}
function pipeAt(g,s){
  s=clamp(s,0,g.len);
  for(const q of g.segs) if(s<=q.s0+q.L){
    const t=Math.max(0,s-q.s0);
    return {x:q.x+q.dx*t,y:q.y+q.dy*t,dx:q.dx,dy:q.dy};
  }
  const q=g.segs[g.segs.length-1];
  return {x:q.x+q.dx*q.L,y:q.y+q.dy*q.L,dx:q.dx,dy:q.dy};
}
/* build a path covering arc length a..b; false if nothing of it lands */
function pipeSub(g,a,b){
  a=Math.max(0,a); b=Math.min(g.len,b);
  if(b<=a) return false;
  ctx.beginPath(); let first=true;
  for(const q of g.segs){
    const lo=Math.max(a,q.s0), hi=Math.min(b,q.s0+q.L);
    if(hi<=lo) continue;
    const ax=q.x+q.dx*(lo-q.s0), ay=q.y+q.dy*(lo-q.s0);
    const bx=q.x+q.dx*(hi-q.s0), by=q.y+q.dy*(hi-q.s0);
    if(first){ ctx.moveTo(ax,ay); first=false; } else ctx.lineTo(ax,ay);
    ctx.lineTo(bx,by);
  }
  return !first;
}
/* how far inside the pipe a point is: 0 at the nozzle, 1 once it is clear */
const PIPE_FADE=14;
function pipeEdge(g,s){
  const a=g.pad||0, b=a+(g.core==null?g.len:g.core);
  return clamp(Math.min(s-a, b-s)/PIPE_FADE, 0, 1);
}

/* ══════════ how fast each line is running ══════════
   s.flowPos[k] counts up as fluid moves forward, so d/dt is that line's rate.
   Differentiating what the sim already integrates means no flow formula is written
   twice and a meter cannot disagree with the packets beside it.

   DIFFERENTIATE AGAINST S.t, NOT THE WALL CLOCK. main.js runs the sim on a fixed step
   out of an accumulator, so one browser frame runs one tick, sometimes two, sometimes
   none, while the wall clock advances smoothly. Dividing a quantised numerator by a
   smooth denominator swung the reading by tens of per cent every frame. S.t advances
   by exactly the step that moved the fluid, so the division is exact. */
const pipeLast={}, pipeSpd={}, pipeShown={};
/* This frame's head loss per run, off netDrops() (pipenet.js). Refilled once a
   frame and never stored on S, for the same reason the solve is not: it is a
   pure function of S, so a snapshot that carried it could only ever disagree
   with the plant it was a snapshot of. Refilled, not rebuilt, so no reader
   ever holds a stale object. */
const pipeDrop={};
function pipeDropRefresh(L){
  for(const k in pipeDrop) delete pipeDrop[k];
  if(!L) return;
  const d=netDrops(L);
  for(const k in d) pipeDrop[k]=d[k];
}
let pipeT=null, pipeDt=0;
/* a browser frame at 16x carries ~0.27 s of plant time - PIPE_DTMAX is what a frame
   can legitimately carry (TICK_CAP ticks), not a per-frame smoothing constant. The
   filter below is stepped one PIPE_DT tick at a time so a figure damps by plant time
   elapsed, never by how often the browser happened to draw it. */
const PIPE_DT=0.02, PIPE_DTMAX=1.0;
/* ══ SMOOTHING IS DISPLAY STATE, SO IT IS NOT ON S AND IS CLEARED BY HAND ══
   Every damped figure in here is a picture of the last few frames, not a fact
   about the plant - which is exactly why it does not live on S and is not in a
   snapshot. The cost of that is that whoever moves the clock has to say so. A
   scrub landing on a DIFFERENT take at a similar s.t would otherwise smear one
   frame of the run you just left across the run you just arrived in, and s.t
   alone cannot tell those two apart - it is the same number in both takes.
   restoreS() and resetPlant() both call this. */
function pipeReset(){
  for(const k in pipeLast)  delete pipeLast[k];
  for(const k in pipeSpd)   delete pipeSpd[k];
  for(const k in pipeShown) delete pipeShown[k];
  pipeT=null; pipeDt=0;
}
function pipeRate(s){
  const now=s.t, dt=pipeT===null?0:now-pipeT;
  pipeT=now; pipeDt=(dt>0&&dt<=PIPE_DTMAX)?dt:0;
  if(!pipeDt) return;
  const n=Math.max(1,Math.round(pipeDt/PIPE_DT));
  for(const k in s.flowPos){
    const v=s.flowPos[k];
    if(pipeLast[k]!==undefined){
      const tgt=(v-pipeLast[k])/pipeDt;
      for(let i=0;i<n;i++) pipeSpd[k]=approach(pipeSpd[k]||0,tgt,PIPE_DT,8);
    }
    pipeLast[k]=v;
  }
}

/* ── one damped display state per instrument ──
   The needle AND the digits read this, so they cannot disagree, and a transient eases
   across the face instead of stepping. Two failures pull against each other: a figure
   that twitches on a steady plant is unreadable, and a figure quantised hard enough to
   stop twitching then JUMPS the moment the plant moves, which is worse. So this is a
   first-order approach, not a quantiser - it follows closely when far from the true
   value and parks dead still within a hair of it. */
function pipeDisplay(k,fr){
  const cur=pipeShown[k];
  if(cur===undefined){ pipeShown[k]=fr; return fr; }
  if(!pipeDt) return cur;                    // a paused plant must still freeze
  if(Math.abs(fr-cur)<0.0008) return cur;
  const n=Math.max(1,Math.round(pipeDt/PIPE_DT));
  let v=cur;
  for(let i=0;i<n;i++) v=approach(v,fr,PIPE_DT,4);
  pipeShown[k]=v;
  return v;
}
/* three significant figures, which is what an instrument face gives you. The fourth
   digit of a four-figure flow is worth a hundredth of a per cent and is pure noise -
   printing it makes a steady meter look like it is hunting. */
function pipeFmt(v){
  if(v>=1000) return String(Math.round(v/10)*10);
  if(v>=100)  return v.toFixed(0);
  return v.toFixed(1);
}

/* ── what 100% means, per run ──
   A needle needs a full scale, and now that S.flowPos is kept per RUN rather than
   per kind, the honest full scale is per run too: P.netRefByRun[key], what THAT run
   carries as commissioned, undamaged, valves wide. A short loop and a long loop are
   not the same pipe wearing two labels, so they no longer share one guessed number -
   each is judged against its own build.

   P.netRefByRun is in the network solver's own units, not the diagram's px/s, so it
   still has to be carried across into pipeSpd's units before it means anything to a
   needle - that's what 84*feff0 is doing below. It is not a hand-tuned guess re-fitted
   per kind any more (the old table had to be kept in sync with step()'s pipe-animation
   rates by hand); it is the ONE calibration point where a run's own reference equals
   the shared mean (P.netRefRun) and the two unit systems can be read off against each
   other. Every run is then scaled off that single point by its own share,
   ref/P.netRefRun, so nothing here has to change if step()'s per-run weighting ever does.

   Only hot, cold and a fitting branch (xtie:*) are on the solved network. Everything
   past the turbine has none - the secondary side PRICES the heat, it is not a physics
   path - so main steam, exhaust, feedwater, HP injection and the surge line keep the
   flat, plant-wide design rate they always had. That fallback is also what a hot/cold/
   xtie run falls back to if it has no reference yet (a design mid-edit, before
   commission() has run) - the old flat guess, so a gauge never divides by zero. */
function pipeFullScale(key,k){
  if(k==="hot"||k==="cold"||k.startsWith("xtie")){
    const ref=P.netRefByRun[key];
    if(!ref) return k.startsWith("xtie")?60:84*Math.max(0.05,P.feff0);
    return 84*Math.max(0.05,P.feff0)*ref/Math.max(1e-6,P.netRefRun);
  }
  if(k==="hpi") return 120*Math.sqrt(P.hpiRate/1.6);
  return {steam:96,exh:96,feed:96,surge:72}[k]||84;
}
const pipeFrac=(key,k,sp)=>sp/Math.max(1e-6,pipeFullScale(key,k));

/* ── what a run actually carries, in a unit that exists ──
   The gauge reads a real quantity; per cent of that run's own rating is on the
   tooltip. Both come from ONE fraction (pipeFrac, off pipeSpd - the same integral the
   packets move on) times a nominal, so a digit can never disagree with the needle
   beside it, or with a packet's own speed.

   The nominal is a heat balance on the rated power, the plant's only sizing input -
   this file does not run a second one per run. Primary: Q = m*cp*dT, water at these
   conditions is about 5.5 kJ/kg/K and the loop is drawn with a 30 K rise, shared
   between the loops that were built. Secondary: Q = m*dh, feedwater to saturated
   steam is about 1800 kJ/kg. Both are DESIGN figures, fixed at commissioning, never
   read off S - they only exist to give a dimensionless rate a unit.
   For hot, cold and a fitting branch, that flat per-loop figure is then weighted by
   the same ref/P.netRefRun share pipeFullScale() uses, so a short loop's bigger
   nominal times its own (now correctly ~1.0) fraction lands on its own real kg/s,
   not the plant's average pretending to be every loop's. The surge line is sized at
   2% of a (still flat) hot leg. HP injection is the odd one out: the sim models it as
   INVENTORY per second, not mass, so it reads per cent per minute and its label
   says so. */
function pipeUnit(key,k){
  const per=Math.max(1,D.loops);
  const loop=P.rated*1000/(5.5*30)/per;        // kg/s through an average primary loop
  const stm =P.rated*1000/1800/per;            // kg/s of steam from one generator
  if(k==="hot"||k==="cold"||k.startsWith("xtie")){
    const ref=P.netRefByRun[key], w=ref?ref/Math.max(1e-6,P.netRefRun):1;
    return {nom:loop*w, u:"kg/s"};
  }
  switch(k){
    case "steam": case "exh": case "feed":  return {nom:stm,         u:"kg/s"};
    case "surge":                          return {nom:loop*0.02,   u:"kg/s"};
    case "hpi":                            return {nom:P.hpiRate*60,u:"%/min"};
  }
  return {nom:loop,u:"kg/s"};
}
/* how two-phase a line is, 0..1. There is no per-segment phase anywhere in the sim,
   so it comes from the kind plus the globals the sim does publish. */
function pipeSteam(k,L){
  if(PIPE_VAPOUR[k]) return 1;
  if(k==="hot")  return clamp(L.vf*1.6,0,1);
  if(k==="cold"||k.startsWith("xtie")) return clamp((L.vf-0.25)*1.6,0,1);
  return 0;
}

/* ══════════ the packets ══════════ */
const PIPE_RUNWAY=60;
function pipeSlugs(g,ph,sp,col,w,st){
  const gap=26+st*10, len=13-st*5, moving=Math.min(1,Math.abs(sp)/8);
  /* the bore is always there, so a stalled line is still a line */
  ctx.save(); ctx.globalAlpha=0.22; ctx.lineCap="square"; ctx.lineJoin="round";
  ctx.lineWidth=w; ctx.strokeStyle=col;
  if(pipeSub(g,0,g.len)) ctx.stroke();
  ctx.restore();

  ctx.save(); ctx.lineCap="round"; ctx.lineJoin="round";
  const body=w-(st>0.5?1:0);
  let s=((ph%gap)+gap)%gap-gap;
  for(; s<g.len; s+=gap){
    ctx.lineWidth=body;
    ctx.globalAlpha=(0.35+0.65*moving)*(1-st*0.45);
    ctx.strokeStyle=col;
    if(pipeSub(g,s,s+len)) ctx.stroke();
    /* the leading face: which way it points is the whole message. It fades across a
       nozzle rather than popping on at it - see pipeEdge(). */
    ctx.lineWidth=w-1.6;
    ctx.globalAlpha=0.62*moving*(1-st*0.4)*pipeEdge(g,s+len);
    ctx.strokeStyle=C.bright;
    if(pipeSub(g,s+len-2.2,s+len)) ctx.stroke();
  }
  ctx.restore();
}

/* ══════════ the instruments ══════════
   A needle tapped into the run it measures: the opaque face occludes the pipe, so it
   reads as a meter fitted IN the line rather than a label floating over it. 200
   degrees of sweep over the TOP, so the reading sits under the face, with the zero
   stop at the left and headroom below it so reverse flow drives the needle back past
   zero instead of pinning.

   The scale does not END at design, it is only MARKED there. A meter that pins at the
   limit tells you that you are at it and then tells you nothing else, which is useless
   on a plant whose whole point is that you may push past the limit and pay for it.
   Where the band starts is per instrument: on a flow meter it opens at design flow, on
   the pressurizer at the relief valve setpoint - a plant whose pressure needle rested
   against the red all day would be crying wolf. */
const PIPE_A0=Math.PI*170/180, PIPE_SW=Math.PI*200/180, PIPE_OVER=1.25;
function pipeDial(x,y,r,fr,col,label,o){
  o=o||{};
  const lim=o.lim==null?1:o.lim, max=o.max==null?PIPE_OVER:o.max, lo=-0.2;
  const U=v=>(clamp(v,lo,max)-lo)/(max-lo);
  const dead=Math.abs(fr)<0.008, over=fr>lim+0.001, back=fr<-0.008;
  const ink=dead?C.ink2:over?C.red:back?C.amber:col;
  ctx.save();
  ctx.beginPath(); ctx.arc(x,y,r,0,6.2832);
  ctx.fillStyle=C.panel; ctx.fill();
  ctx.lineWidth=1; ctx.strokeStyle=over?C.red:(dead?C.edge:C.edge2); ctx.stroke();
  /* the band is always on the face, lit only when the needle is in it - you should be
     able to see where the limit is before you cross it */
  ctx.beginPath(); ctx.arc(x,y,r-2.6, PIPE_A0+PIPE_SW*U(lim), PIPE_A0+PIPE_SW);
  ctx.strokeStyle=over?C.red:"#4a1712"; ctx.lineWidth=1.8; ctx.stroke();
  const mark=(t,len,c)=>{
    const a=PIPE_A0+PIPE_SW*t, cs=Math.cos(a), sn=Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x+cs*(r-1.5), y+sn*(r-1.5));
    ctx.lineTo(x+cs*(r-1.5-len), y+sn*(r-1.5-len));
    ctx.strokeStyle=c; ctx.lineWidth=1; ctx.stroke();
  };
  for(let i=0;i<=4;i++) mark(U(i/4),2.4,C.edge2);      // 0 25 50 75 100 per cent
  mark(U(0),3.2,C.amber);                              // the zero stop
  const a=PIPE_A0+PIPE_SW*U(fr);
  ctx.beginPath(); ctx.moveTo(x-Math.cos(a)*2,y-Math.sin(a)*2);
  ctx.lineTo(x+Math.cos(a)*(r-3), y+Math.sin(a)*(r-3));
  ctx.strokeStyle=ink; ctx.lineWidth=1.6; ctx.lineCap="round"; ctx.stroke();
  ctx.beginPath(); ctx.arc(x,y,1.5,0,6.2832); ctx.fillStyle=ink; ctx.fill();
  ctx.restore();
  if(label)
    /* the reading carries the same alarm state as the needle, so a number read
       without looking at the face still says you are over the limit */
    pipeTag(x,y+r+1,label,dead?C.ink2:over?C.red:back?C.amber:C.cyan);
}

/* A reading set on the plant itself, on its own backing plate so a pipe or a
   grid line cannot run through the digits. Every number that sits ON the
   diagram rather than in a rail goes through here, or the second one drifts a
   half pixel and a size away from the first. */
function pipeTag(x,yTop,label,col){
  const o={size:6.5,sp:.4,align:"center"}, lw=tw(label,o)+6;
  fillRect(x-lw/2,yTop,lw,10,C.bg);
  txt(label,x,yTop+8,Object.assign({},o,{color:col}));
}

/* One anchor per KIND: the middle of a STRAIGHT run that kind owns, so a meter never
   lands on a bend and a four-loop plant grows four meters, not one each.

   THE LONGEST STRETCH IS NOT ALWAYS THE RIGHT ONE. A pipe runs BEHIND the plant, so
   the middle of the longest segment can be inside a vessel - where a meter is a face
   bolted to nothing and its reading lands across whatever that component is drawing.
   At four loops the main steam meter sat inside the fourth generator, and audit-text
   found it as the reading colliding with that generator's own REPAIR key. So a
   stretch that is long enough to hold a meter AND clear of every component wins;
   length only decides between equals. A kind with nowhere better keeps the anchor it
   always had rather than losing its meter.
   Clear of the WHOLE instrument, face and reading together - the same box the meter
   puts its own tooltip on. The reading hangs a dial's radius below the face, so an
   anchor that is itself in open air can still drop its digits inside a component,
   which is how the hot-leg reading ended up under a damage badge. */
const PIPE_DIAL_R=10;
function pipeAnchors(runs){
  const best={}, need=2*PIPE_DIAL_R+6, r0=PIPE_DIAL_R;
  const clear=(x,y)=>!LAY.parts.some(p=>{ const r=prect(p);
    return x+r0>r.x && x-r0<r.x+r.w && y+r0+11>r.y && y-r0<r.y+r.h; });
  for(const r of runs){
    const g=pipeGeom(r.pts);
    for(const q of g.segs){
      const x=q.x+q.dx*q.L/2, y=q.y+q.dy*q.L/2;
      /* the winning segment's own run key travels with it, so the one meter this
         KIND gets still reads THAT run's real numbers (pipeFullScale/pipeUnit are
         keyed by run, not kind) rather than a kind-wide placeholder. */
      const a={L:q.L,x,y,key:r.key,rank:(q.L>=need?2:0)+(clear(x,y)?1:0)}, b=best[r.k];
      if(!b || a.rank>b.rank || (a.rank===b.rank && a.L>b.L)) best[r.k]=a;
    }
  }
  return best;
}
/* A relief path is dead by design: it passes only while the valve is lifted,
   which is a fault, not an operating state. Its kind is "relief" (the header)
   or "xtie:<fid>" for one valve's own branch - and a cross-tie between loops
   wears the same "xtie:" prefix, so the mode is what has to be asked, never
   the prefix. */
const reliefRun = k => k==="relief" ||
  (k.indexOf("xtie:")===0 && P.fit && P.fit[k.slice(5)] && P.fit[k.slice(5)].mode==="relief");

function pipeMeters(runs,L){
  const best=pipeAnchors(runs), PC=pipeColours(L), r=PIPE_DIAL_R;
  for(const k in best){
    const a=best[k], key=a.key;
    if(a.L<2*r+6) continue;                  // too short a run to fit a meter in it
    const sp=pipeSpd[key]||0, fr=pipeDisplay(key,pipeFrac(key,k,sp)), un=pipeUnit(key,k);
    /* Two of the seven dials a default plant draws were the relief header and
       the stock valve's own branch, both pinned on 0.0 kg/s, both stacked in
       the one corner that already carries the tank, its label, the bowtie, the
       pressurizer and the vitals panel. A gauge that can only ever read zero
       is not an instrument, it is furniture - so a relief path earns its dial
       by passing, and the dial APPEARING is then the signal. Every other run
       keeps its meter at zero, because zero on a main leg is real news. */
    if(reliefRun(k) && Math.abs(fr)<0.008) continue;
    const mag=pipeFmt(Math.abs(fr)*un.nom);
    pipeDial(a.x,a.y,r,fr,pipeCol(PC,k),mag+" "+un.u);
    /* three things the solve can actually say, kept as three sentences rather than
       one number doing all three jobs: how much, which way, and against what. No
       pressure/dP reading here - a fitting's node potentials never left pipenet.js. */
    TIP(a.x-r,a.y-r,2*r,2*r+11,pipeLabel(k)+"  FLOW METER",
      mag+" "+un.u+" - "+Math.abs(Math.round(fr*100))+
      " % of what this run carries as commissioned, undamaged, valves wide."+
      (fr>1.001?" The needle is in the over-range band, so this run is being pushed past what it was built for."
       :fr<-0.008?" The needle is back past the zero stop - it is running backwards."
       :Math.abs(fr)<0.008?" The line is stagnant."
       :"")+
      (pipeDrop[key]!=null
        ? "  It spends "+(pipeDrop[key]*100).toFixed(0)+
          " % of the loop's whole pump head getting the water along it - that is the price of this run's length, its bore, and anything throttling it."
        : ""));
  }
}

/* ── the pressurizer ──
   Every line has a meter, and the one component that sets the conditions inside all of
   them had none. The pressurizer is not on a pipe, so its gauge goes on the vessel and
   it reads PRESSURE, because that is what a pressurizer is for.

   100% is the design point P0 and the band opens at P0*1.06, the same number step()
   lifts the PORV at, so the needle enters the red exactly when the valve is about to
   talk. The stop is 135%, past the high pressure trip, so a plant on its way to
   bursting still has needle left to move.

   It carries no label of its own: the component already prints its pressure under the
   symbol, and printing it twice is how two readings start disagreeing. It sits clear
   of the relief bowtie at the very top of the shell, and it does cover a band of the
   level column - the same trade the flow meters make against their own pipes. */
function pipeVessel(L){
  const p=LAY.parts.find(q=>q.id==="pzr");
  if(!p || !fitted(p) || L.dmgParts.includes("pzr")) return;
  const R=prect(p), r=PIPE_DIAL_R;
  const fr=pipeDisplay("pzrP", L.P/Math.max(0.1,P.P0));
  /* low enough to sit in the steam space rather than over the water. It used to
     be dodging a relief bowtie on the very top of the shell too; that valve is a
     fitting now and is drawn at its own tap (pipeFitMarks()). */
  const cx=Math.round(R.x+R.w/2), cy=Math.round(R.y+r+16);
  pipeDial(cx,cy,r,fr,C.cyan,null,{lim:PORV_LIFT,max:1.35});
  TIP(cx-r,cy-r,2*r,2*r,"PRESSURIZER  PRESSURE",
    L.P.toFixed(2)+" MPa, "+Math.round(fr*100)+" % of the "+P.P0.toFixed(1)+
    " MPa design point. Level "+L.lvl.toFixed(0)+" %."+
    (fr>PORV_LIFT?"  It is past the relief valve setpoint."
            :reliefAnyOpen(L)?"  The relief valve is passing.":""));
}

/* ══════════ the two entry points ══════════
   Both are called by drawPlant() and only with live state - the design bench has no
   flow to show and no instrument to read.

   THE SPLIT IS THE POINT. Fluid is inside a pipe, and a pipe runs BEHIND the plant, so
   pipeFlow() goes down before the components and a packet disappears under a vessel
   the way it should. An instrument is bolted to the outside of the thing it measures,
   so pipeGauges() goes down after them - drawn first, the pressurizer gauge was simply
   painted over by the pressurizer. */
const pipeRuns = L => pipeNetwork().filter(r=>!(r.k==="hpi"&&!L.hpi));  // drawPlant's rule

function pipeFlow(L){
  pipeRate(L);
  const PC=pipeColours(L);
  for(const r of pipeRuns(L)){
    const g=pipeGeom(r.pts);
    if(!g.len) continue;
    const thin=(r.k==="hpi"||r.k==="surge"), w=thin?3:4, hw=(thin?6:8)/2;
    ctx.save(); pipeClip(g,hw,w/2);
    /* L.flowPos and pipeSpd are keyed by the RUN (r.key), never the kind (r.k) - a
       kind has no entry of its own, so reading r.k here silently fed every packet
       phase 0 and every speed 0, whatever loop it was on. */
    pipeSlugs(pipePad(g,PIPE_RUNWAY), L.flowPos[r.key]||0,
              pipeSpd[r.key]||0, pipeCol(PC,r.k), w, pipeSteam(r.k,L));
    ctx.restore();
  }
}
function pipeGauges(L){
  pipeMeters(pipeRuns(L),L);      // outside every clip, and over every component
  pipeVessel(L);
}
