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
let pipeT=null, pipeDt=0;
function pipeRate(s){
  const now=s.t, dt=pipeT===null?0:now-pipeT;
  if(now<pipeT){                     // resetPlant() rewound the clock: start clean
    for(const k in pipeLast) delete pipeLast[k];
    for(const k in pipeShown) delete pipeShown[k];
  }
  pipeT=now; pipeDt=(dt>0&&dt<=0.25)?dt:0;
  if(!pipeDt) return;
  for(const k in s.flowPos){
    const v=s.flowPos[k];
    if(pipeLast[k]!==undefined)
      pipeSpd[k]=(pipeSpd[k]||0)+(((v-pipeLast[k])/dt)-(pipeSpd[k]||0))*Math.min(1,dt*8);
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
  const err=fr-cur;
  if(Math.abs(err)<0.0008) return cur;
  pipeShown[k]=cur+err*Math.min(1,pipeDt*4);
  return pipeShown[k];
}
/* three significant figures, which is what an instrument face gives you. The fourth
   digit of a four-figure flow is worth a hundredth of a per cent and is pure noise -
   printing it makes a steady meter look like it is hunting. */
function pipeFmt(v){
  if(v>=1000) return String(Math.round(v/10)*10);
  if(v>=100)  return v.toFixed(0);
  return v.toFixed(1);
}

/* ── what 100% means, per line ──
   A needle needs a full scale, and it has to be a property of the PLANT. Each line's
   is the rate step() gives it at design conditions.

   The primary cannot be pushed past its own pumps - driven flow is s.flow times
   P.flowK - so a hot leg's design figure is this plant's own full-flow heat-removal
   fraction, not a flat 1.0. The secondary is the side with headroom: turbine demand
   runs to P.loadMax, so main steam, exhaust and feedwater are what drive a needle
   past the mark. HP injection is fixed, which is why it reads 100% whenever it is
   open: a head tank is either flowing or it is not.

   These mirror the rates in the pipe-animation block of step(). If those change,
   change these with them. */
function pipeFullScale(k){
  if(k==="hpi") return 120*Math.sqrt(P.hpiRate/1.6);
  if(k==="hot"||k==="cold") return 84*Math.max(0.05,P.feff0);
  return {steam:96,exh:96,feed:96,surge:72}[k]||84;
}
const pipeFrac=(k,sp)=>sp/Math.max(1e-6,pipeFullScale(k));

/* ── what a line actually carries, in a unit that exists ──
   The gauge reads a real quantity; per cent of design is on the tooltip. Both come
   from ONE fraction times a nominal, so they cannot disagree.

   The nominals are a heat balance on the rated power, the only sizing input the plant
   has. Primary: Q = m*cp*dT, water at these conditions is about 5.5 kJ/kg/K and the
   loop is drawn with a 30 K rise, shared between the loops that were built.
   Secondary: Q = m*dh, feedwater to saturated steam is about 1800 kJ/kg. A 3000 MWt
   three-loop plant therefore gets about 6100 kg/s in each hot leg and 555 kg/s of
   steam from each generator, which is what real ones run.
   The surge line is sized at 2% of a hot leg. HP injection is the odd one out: the
   sim models it as INVENTORY per second, not mass, so it reads per cent per minute
   and its label says so. */
function pipeUnit(k){
  const per=Math.max(1,D.loops);
  const loop=P.rated*1000/(5.5*30)/per;        // kg/s through one primary loop
  const stm =P.rated*1000/1800/per;            // kg/s of steam from one generator
  switch(k){
    case "hot": case "cold":               return {nom:loop,        u:"kg/s"};
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
  if(k==="cold") return clamp((L.vf-0.25)*1.6,0,1);
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
  if(label){
    /* the reading carries the same alarm state as the needle, so a number read
       without looking at the face still says you are over the limit */
    const o2={size:6.5,sp:.4,align:"center"}, lw=tw(label,o2)+6;
    fillRect(x-lw/2,y+r+1,lw,10,C.bg);
    txt(label,x,y+r+9,Object.assign({},o2,
        {color:dead?C.ink2:over?C.red:back?C.amber:C.cyan}));
  }
}

/* One anchor per KIND: the middle of the longest STRAIGHT run that kind owns, so a
   meter never lands on a bend and a four-loop plant grows four meters, not one each. */
function pipeAnchors(runs){
  const best={};
  for(const r of runs){
    const g=pipeGeom(r.pts);
    for(const q of g.segs)
      if(!best[r.k] || q.L>best[r.k].L)
        best[r.k]={L:q.L, x:q.x+q.dx*q.L/2, y:q.y+q.dy*q.L/2};
  }
  return best;
}
const PIPE_DIAL_R=10;
function pipeMeters(runs,L){
  const best=pipeAnchors(runs), PC=pipeColours(L), r=PIPE_DIAL_R;
  for(const k in best){
    const a=best[k];
    if(a.L<2*r+6) continue;                  // too short a run to fit a meter in it
    const fr=pipeDisplay(k,pipeFrac(k,pipeSpd[k]||0)), un=pipeUnit(k);
    pipeDial(a.x,a.y,r,fr,PC[k],pipeFmt(Math.abs(fr)*un.nom)+" "+un.u);
    TIP(a.x-r,a.y-r,2*r,2*r+11,PIPE_NAME[k]+"  FLOW METER",
      Math.abs(Math.round(fr*100))+" % of the flow this line carries at design conditions"+
      (fr>1.001?" - the needle is in the over-range band, so this line is being pushed past what it was built for."
       :fr<-0.008?", and the needle is back past the zero stop - it is running backwards."
       :Math.abs(fr)<0.008?". The line is stagnant."
       :"."));
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
  /* far enough down to clear the relief bowtie on the very top of the shell, and high
     enough to sit in the steam space rather than over the water */
  const cx=Math.round(R.x+R.w/2), cy=Math.round(R.y+r+16);
  pipeDial(cx,cy,r,fr,C.cyan,null,{lim:1.06,max:1.35});
  TIP(cx-r,cy-r,2*r,2*r,"PRESSURIZER  PRESSURE",
    L.P.toFixed(2)+" MPa, "+Math.round(fr*100)+" % of the "+P.P0.toFixed(1)+
    " MPa design point. Level "+L.lvl.toFixed(0)+" %."+
    (fr>1.06?"  It is past the relief valve setpoint."
            :L.porvOpen?"  The relief valve is passing.":""));
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
    pipeSlugs(pipePad(g,PIPE_RUNWAY), L.flowPos[r.k]||0,
              pipeSpd[r.k]||0, PC[r.k], w, pipeSteam(r.k,L));
    ctx.restore();
  }
}
function pipeGauges(L){
  pipeMeters(pipeRuns(L),L);      // outside every clip, and over every component
  pipeVessel(L);
}
