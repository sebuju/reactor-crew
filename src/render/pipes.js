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
/* `relief` and `user` are named here too. The stock plant ships a relief
   header and it drew grey and nameless for as long as it has existed - a
   pipe the palette did not know about, on the reference layout. `user` keeps
   the grey deliberately (see pipeCol below) but stops being anonymous: grey
   means "belongs to no system", and a player who drew it is owed that
   sentence rather than a blank tooltip. */
const PIPE_NAME={hot:"HOT LEG",cold:"COLD LEG",steam:"MAIN STEAM",feed:"FEEDWATER",
                 hpi:"HP INJECTION",surge:"SURGE LINE",exh:"EXHAUST",
                 relief:"RELIEF HEADER",cw:"CIRCULATING WATER",user:"UNCLASSIFIED PIPE"};
/* EVERY RUN'S OWN NAME AND COLOUR, off its kind and nothing else. There used
   to be a prefix case here for "xtie:"+id - a fitting's own branch run, one
   generated kind per fitting, which no table could enumerate. A fitting is a
   BOX now: its own edge is inside it, it has no polyline, and the runs either
   side of it are ordinary runs wearing ordinary kinds. */
/* named pipeLabel, not pipeName: src/data/pipenet.js declares its own
   pipeName() for a placed-pipe part's own id, a different concept (and a
   global collision if this file used the same name). */
/* A RUN'S NAME IS ITS KIND'S, UNLESS IT DEAD-ENDS AT A MACHINE THAT HAS ONE.
   A branch off the steam header to a safety valve IS a steam line and is
   priced as one, but calling it MAIN STEAM claims it is the header. Named
   after what it goes to instead, through partName() - so a renamed valve
   renames its own pipe, the same rule the event log already keeps. */
const pipeLabel=(k,key)=>{
  const c = key && pipeMap().byKey[key], t = c && runDeadEnd(c.a, c.b);
  return t ? partName(t) : PIPE_NAME[k];
};
const pipeCol=(PC,k)=>PC[k]||C.ink2;

/* Line width follows the run's own BORE, never its kind - a 0.25-bore
   injection line and a 0.30-bore surge line are not the same pipe as a
   1.0-bore hot leg, and once bore is a player choice (Stage 3a) the drawn
   line has to track what was actually built. Linear through the two widths
   this file always drew: the narrowest stock default (relief, 0.20) at 3px,
   a full 1.0 bore (hot/cold, and the fallback runBore() itself uses for any
   kind PIPE_BORE_MM has no row for) at 4px. Every bore between them - a
   0.55-bore cross-tie, a 0.25-bore HPI line - draws a width between them
   instead of being lumped into whichever side of a boolean it used to fall
   on. Casing half-width and fluid line width were always the same number
   drawn two ways (thin?6:8)/2 === thin?3:4 - kept that way here too, one
   value instead of two that happened to agree. */
const pipeWidth = bore => clamp(2.75+1.25*bore, 2, 5);

/* The one pipe colour table. drawPlant() strokes the run with it and the packets are
   drawn in it, so a packet can never be a different colour from its own pipe. */
function pipeColours(L){
  const heat = L? L.n*PROMPT_F+L.decay : 0;
  const Th = L? L.Tavg+15*heat : 598, Tc = L? L.Tavg-15*heat : 568;
  return { hot: L?lerpC("#5aa9d6","#ff5a45",(Th-520)/110):"#c8735e",
           cold:L?lerpC("#5aa9d6","#ff5a45",(Tc-520)/110):"#5aa9d6",
           surge:"#a98cf0", steam:"#c8d8dc", exh:"#7f9098", feed:"#5aa9d6", hpi:"#5fd2e2", cw:"#5aa9d6",
           /* a relief header stands shut and carries nothing until something
              lifts, so it is drawn cold and quiet - but drawn as ITSELF, not
              through pipeCol()'s unknown-kind grey. `user` is the only kind
              left with no row, and that is the point: grey IS the reading. */
           relief:"#7a6f9a" };
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
/* THE PRESSURE FIELD FOR THIS FRAME, in MPa, keyed by node id. Same standing
   as pipeDrop beside it: a view cache, never state, refilled once a frame off
   one solve and read by everything that draws a pressure.

   THIS is why it lives here and not in a layer's own data function.
   netFactored() caches its factorisation onto net.Af, and net is P.net - so a
   draw callback that solved would be a LAYER WRITING TO P, which is exactly
   what the layer contract forbids, and audit-geometry only scans the view
   files for `S.` writes, so it would not catch it. One refresh, from
   drawPlant(), and the layers read the answer. */
const pipeP={};
function pipeFieldRefresh(L){
  for(const k in pipeDrop) delete pipeDrop[k];
  for(const k in pipeP) delete pipeP[k];
  /* AND THE READING PLACES, once, before anything draws. The allocator has to
     run first because the UNDER seam draws before the gauges do, and one of
     the things drawn there prints a number in every cell it believes is empty
     - which it can only know if the stacks have already chosen. This is the
     seam contract in layers.js made true rather than merely written down:
     `under` "never lands on a value tag". */
  pipeAnchorTick();
  pipeAnchors(pipeRuns(L));
  if(!L) return;
  netField(L, pipeDrop, pipeP);
}
/* Pressure on a RUN rather than at a node: the mean of its two ends, which is
   what a gauge tapped into the middle of it would read. null for a TAP-ENDED
   run - one whose key names no second node, i.e. the surge line - so a caller
   draws nothing rather than a zero. Every run with two ends has an edge and
   two nodes, steam and feed included; runEnds() is the whole test. */
function pipeRunP(r){
  const ends=runEnds(r.key,r.k);
  if(!ends) return null;
  const a=pipeP[coreFold(ends[0])], b=pipeP[coreFold(ends[1])];
  if(a===undefined||b===undefined) return null;
  /* NOT FLOORED AT ZERO, and that was a mistake worth naming: clamping it
     printed a suction line whose water column has broken as a tidy 0 kPa,
     which reads as a perfect vacuum - a confident wrong number in place of a
     fault. A negative absolute pressure is the field saying the liquid there
     cannot hold itself up and would flash, and that is exactly what a
     condensate pump mounted above its own hotwell gets. Let it say so. */
  return (a+b)/2;
}
/* Subcooling on a run: how far the water in it is below its own local boiling
   point. The same two questions asked at the same place - tsat() of the
   pressure HERE against the temperature HERE - which is the whole argument
   for a field instead of a number. */
/* A run is a steam line because BOTH ITS ENDS ARE STEAM SPACES - net.vapour,
   built from the runs and component paths touching each node - never because
   its kind is spelt "steam". Splice a fitting into the steam line and the runs
   either side of it answer yes with nothing named. */
const runVapour = ends =>
  !!ends && netVapourAt(coreFold(ends[0])) && netVapourAt(coreFold(ends[1]));
function pipeRunSc(r,L){
  const pr=pipeRunP(r);
  if(pr===null) return null;
  const ends=runEnds(r.key,r.k);
  /* THE SECONDARY BOILS ON THE WATER CURVE, and it is the same mistake secP()
     used to make: tsat() is the PRIMARY coolant's curve, anchored on whatever
     that architecture boils at, and asking it about a steam line read -12 K of
     subcooling on a healthy plant. A VAPOUR run is saturated by definition -
     that is what makes it vapour - so it reads exactly 0 rather than a
     difference between two numbers that are the same one. */
  const a=coreFold(ends[0]), b=coreFold(ends[1]);
  if(runVapour(ends)) return 0;
  /* THE CIRCUIT'S OWN CURVE, and the run's own MEASURED temperature. This used
     to pick between two curves off which side of the tubes the run was on and
     then subtract a two-state tag; both halves are real now - the fluid is a
     property of the circuit and the temperature is what the enthalpy at those
     two nodes says. */
  const sat = satT(satOfCirc(circOfNode(a)), pr);
  return sat - (netTempAt(L,a) + netTempAt(L,b))/2;
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

   Every run's dial now scales off ITS OWN reference the same way - not just
   hot/cold/a fitting branch - because Stage 1 makes every run an edge and
   P.netRefByRun is filled for every one of them. Two runs never get a real
   one, and say so STRUCTURALLY rather than by name: HPI lands on a TANK's
   own node (tid, mirroring netBuild()'s own test - see pipenet.js) and is
   metered in inventory, not mass; the surge line has no second port of its
   own to solve a reference for at all (runEnds() returns null - it drops
   onto another run's pipe, see pipenet.js's own comment on that). Everything
   else - a hot/cold run before commission() has given it a reference - keeps
   the flat design rate this file always gave that KIND; that fallback is a
   DEFAULT-PICKER, not a permission. */
/* NO FLAT FULL-SCALE TABLE. It read {steam:96, exh:96, feed:96} - three
   invented numbers that looked exactly like measurements, on the three kinds
   nothing was forcing. All three have a real one now: feedwater off its own
   solved reference, steam and exhaust off steamScale() (step.js), which is the
   same figure the tick normalises the packet integral on. */
/* Which TANK's own node this run lands on, or null - mirroring netBuild()'s
   own test, off the node NAMES it wrote back (P.net.tankNid) rather than off
   a face string or a tank id anything here could recognise. */
function runTankId(key,k){
  const ends=runEnds(key,k), N=P.net && P.net.tankNid;
  if(!ends || !N) return null;
  for(const id in N) if(N[id]===ends[0] || N[id]===ends[1]) return id;
  return null;
}
function pipeFullScale(key,k){
  const ends=runEnds(key,k);
  /* A steam run's integral is already normalised on rated steam in step(), so
     100 % is the same 84 every other run's reference lands on. */
  if(runVapour(ends)) return 84;
  if(runTankId(key,k)) return 120;
  /* a FULL SCALE has no direction - P.netRefByRun is signed now */
  const ref=Math.abs(P.netRefByRun[key]);
  if(ref) return 84*Math.max(0.05,P.feff0)*ref/Math.max(1e-6,P.netRefRun);
  /* A run with no reference of its own. Every run is port to port now, so
     runEnds() answers for all of them and this is only reached before
     commission() has run - or on a run the reference sweep found carrying
     nothing at all. */
  if(!ends) return 0.02*84*Math.max(0.05,P.feff0);
  return 84*Math.max(0.05,P.feff0);   // DEFAULT
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
   Any run WITH a solved reference (P.netRefByRun[key], the same figure
   pipeFullScale() now reads for everyone) is weighted by ref/P.netRefRun, so
   a short loop's bigger nominal times its own (now correctly ~1.0) fraction
   lands on its own real kg/s, not the plant's average pretending to be every
   loop's - that covers hot, cold and a fitting branch today, and whatever
   else earns a real reference later with no change here. Two runs are never
   mass flow at all and are picked out STRUCTURALLY, not by kind: a run
   landing on a TANK's own node (tid, mirroring netBuild()'s own test) is
   metered the way that tank is - HPI is INVENTORY per second, not mass, so
   it reads per cent per minute; the surge line has no second port of its
   own (runEnds() returns null) to hang a reference off at all, and is sized
   at 2% of a flat hot leg exactly as it always was, because its real driver
   (thermal expansion) is not in the solve yet - see Stage 6c. What is left
   - main steam and the exhaust - reads step()'s own solved kg/s instead, and
   a hot/cold/xtie run before commission() has given it a reference keeps the
   flat design figure this file always gave it. */
function pipeUnit(key,k){
  const per=Math.max(1,P.loops);
  const loop=P.rated*1000/(5.5*30)/per;        // kg/s through an average primary loop
  const ends=runEnds(key,k);
  /* A run landing on a tank's own node is metered the way that tank is -
     INVENTORY per second, not mass - and off THAT TANK'S own solved flow
     (S.tankRate), never a plant-wide injection total that would print one
     tank's delivery on another tank's line. */
  const tid=runTankId(key,k);
  if(tid) return {nom:Math.abs((S.tankRate&&S.tankRate[tid])||0)*60, u:"%/min"};
  /* WHICH WAY THIS RUN IS MEANT TO CARRY: the sign of its own REFERENCE flow -
     the plant as commissioned, undamaged, valves wide. A key's canonical order
     is two part ids sorted and says nothing about it, so without this three of
     the four stock primary runs read as running backwards while doing exactly
     what they were built to do. */
  const sref=P.netRefByRun[key], ref=Math.abs(sref);
  if(ref) return {nom:loop*(ref/Math.max(1e-6,P.netRefRun)), u:"kg/s",
                  dir:sref<0?-1:1};
  if(!ends) return {nom:loop*0.02, u:"kg/s"};   // a tap-ended run - see pipeFullScale
  /* ── THE STEAM LINES GET THEIR NUMBER BACK ──
     They read null for as long as nothing solved a steam rate. step() solves
     one per generator now, so the honest answer is no longer "nothing": a
     steam run carries what its OWN generator is raising, and the exhaust
     carries the whole of what actually got away. A generator raising steam it
     cannot send reads a moving needle on the shell and 0 kg/s on the line,
     which is the two fields being separate. */
  /* `dir` is the run's own DESIGN direction along the key's canonical order.
     The needle judges "backwards" against that, not against the order two part
     ids happened to sort in - see steamDir() (step.js). */
  if(runVapour(ends))
    return {nom:steamScale(k), u:"kg/s", dir:steamDir(key,k)};
  return null;
}
/* how two-phase a line is, 0..1 - off the FLUID AT THE RUN'S OWN ENDS, not
   its name. net.tag (pipenet.js) already answers hot-side/cold-side/neither
   for every node the primary reaches, built from the runs that touch it -
   the same array buoyH() trusts for density - so this reads that instead of
   re-deciding a run's own thermal side. Read off the run's OWN graph edge
   (net.edges, matched by key), never runEnds()+coreFold(): the edge already
   holds the two node indices the build resolved, so nothing here has to
   re-derive them from a key.

   Three runs read a node this array also tags but carry no CORE CARRYOVER
   of their own, and are excluded by name - the one kind read this function
   keeps, because nothing solved distinguishes "cold" from "fresh, never
   went through the core" yet: HPI and the surge line are cold/hot by
   BUOYANCY (KIND_TEMP tags them so on purpose, for density) but are a
   tank's or a pressurizer's own water, not recirculating core water; feed
   SHARES its discharge node with a cold leg (sg0b - see pipenet.js's own
   note on that collision) and would misread the leg's own tag as its own.
   Steam and exhaust are genuinely past the turbine - no primary tag reaches
   them at all yet (Stage 6) - and read RUN_VAPOUR instead. */
const PIPE_NO_CARRYOVER={hpi:1,surge:1,feed:1};                   // DEFAULT: liquid regardless of what node they land on
function pipeSteam(r,L){
  if(PIPE_NO_CARRYOVER[r.k]) return RUN_VAPOUR[r.k]?1:0;    // DEFAULT: no core-carryover signal for these yet - see the comment above
  const net=P.net;
  let tag=0;
  if(net) for(const ed of net.edges) if(ed.key===r.key) tag = tag||net.tag[ed.u]||net.tag[ed.v];
  if(tag===NT_HOT)  return clamp(L.vf*1.6,0,1);
  if(tag===NT_COLD) return clamp((L.vf-0.25)*1.6,0,1);
  return RUN_VAPOUR[r.k]?1:0;                                    // DEFAULT: no tag reaches this run yet
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

/* ══════════ ONE STACK OF READINGS PER RUN ══════════
   Flow, pressure and subcooling are all on the plant at once by default, and
   each of them used to carry a picture of itself - a dial, then a bar and a
   column, then a deviation strip and a colour swatch. Three faces of three
   shapes, at three points along one run, and none of them could be read at the
   size a pipe run leaves for an instrument: what they added up to was clutter.

   So there is no face any more. A run gets ONE PLACE and the readings stack
   there, one line per quantity, each in its own colour:

     slot 0   FLOW         kg/s, coloured by the run and by its alarm state
     slot 1   PRESSURE     MPa
     slot 2   SUBCOOLING   K of margin

   The three are INDEPENDENT: each is still its own layer with its own switch,
   each colours itself off its own value, and a slot whose layer is off simply
   leaves a gap rather than shuffling the others - a reading that moves line
   when a neighbour is switched off is a reading you have to find again.
   Slot 1 sits exactly where the pressure reading has always sat, so the line
   the whole plant's text was laid out around does not move.

   The one round face left on the plant is the pressurizer's (pipeVessel), and
   that is bolted to a vessel rather than to a pipe. */
const STACK_H=10;                         // one line of 6.5px ink and its plate
const stackY = (y,slot) => y-20+slot*STACK_H;
/* NOT pipeTag(): a tag's plate is as wide as its own string, so three of them
   stacked gave three different widths and a ragged block with the pipe showing
   through at each step. Every line of a stack takes the SAME width, and the
   plate is one pixel taller than the line so the next plate starts under it
   rather than beside it - butting two plates edge to edge leaves a hairline of
   pipe between them wherever the view transform lands them on a half pixel. */
const STACK_W=48;
function pipeStackLine(x,y,slot,label,col){
  const yT=stackY(y,slot);
  fillRect(x-STACK_W/2,yT,STACK_W,STACK_H+1,C.bg);
  txt(label,x,yT+8,{size:6.5,sp:.4,align:"center",color:col});
}

/* Where a run's readings go: the middle of a STRAIGHT stretch of it, so a
   stack never lands on a bend, and ONE point per run that all three layers
   ask for - the whole reason the readings can stack at all.

   THE LONGEST STRETCH IS NOT ALWAYS THE RIGHT ONE. A pipe runs BEHIND the plant, so
   the middle of the longest segment can be inside a vessel - where a meter is a face
   bolted to nothing and its reading lands across whatever that component is drawing.
   At four loops the main steam meter sat inside the fourth generator, and audit-text
   found it as the reading colliding with that generator's own REPAIR key. So a
   stretch that is long enough to hold a meter AND clear of every component wins;
   length only decides between equals. A kind with nowhere better keeps the anchor it
   always had rather than losing its meter.
   Clear of the WHOLE STACK, all three lines together - a point that is itself in
   open air can still drop the line below it inside a component, which is how the
   hot-leg reading ended up under a damage badge. */
const PIPE_DIAL_R=10;
/* WHERE THE PRESSURIZER'S OWN DIAL SITS, off the top of its BOX. One helper
   because valueBase() (plant.js) hangs the pressure figure under the dial: two
   copies of the offset and the number lands on the glass. */
const PZR_DIAL_CY=boxY=>boxY+PIPE_DIAL_R+26;
/* Is this rectangle clear of every component box? The one test a widget that
   floats in the pipe margin - a meter, a fitting's control strip - uses to
   decide where it may sit, so two of them cannot disagree about what "in the
   way" means. */
function boxClear(x,y,w,h){
  return !LAY.parts.some(p=>{ const r=prect(p);
    return x+w>r.x && x<r.x+r.w && y+h>r.y && y<r.y+r.h; });
}
/* The straight stretch a stack would LIKE to sit on. Not a permission any
   more: a run shorter than this still gets its readings, it just has fewer
   places to put them. */
const STACK_MIN_L=2*PIPE_DIAL_R+6;
const stackBox=(x,y)=>({x:x-STACK_W/2, y:stackY(y,0), w:STACK_W, h:3*STACK_H});
const hit=(a,b)=>a.x+a.w>b.x && a.x<b.x+b.w && a.y+a.h>b.y && a.y<b.y+b.h;
/* ══ EVERY RUN SHOWS EVERY VALUE IT HAS, AND NONE IT DOES NOT ══
   This used to hand out ONE anchor per KIND, so four hot legs shared one flow
   meter and three of them read nothing at all - and the two pressure layers
   each ran their own private clash test and simply DROPPED the loser. Three
   separate ways of hiding a number that the solve had already worked out.

   The reason all three existed is real and does not go away: stacks collide.
   boxClear() only ever asked about COMPONENT boxes, and nothing asked whether
   one run's stack overlapped another's - which is the normal case the moment
   every run has one. So this is a per-frame ALLOCATOR instead: every run is
   offered several places along its own polyline, takes the first that is
   clear of the machines and of every stack already placed, and if none is
   clear it takes its best one ANYWAY and says so by being there. A reading
   nudged along its own pipe is still that pipe's reading; a reading that was
   never drawn is a number the operator had no way to ask for.

   ONE MAP, computed once a frame and shared: the flow meter and both pressure
   layers must agree about where a run's three lines go, or the same pipe
   sprouts three plates in three places. */
/* How far beside its own pipe a reading may stand. One stack height: far
   enough to get out of a neighbour's way on a crowded plant, near enough that
   it is plainly THAT pipe's reading and not the next one's. */
const STACK_OFF=STACK_H+2;
const STACK_STEPS=[0,1,-1,2,-2,3,-3];
function pipeRunSpots(r){
  const out=[];
  for(const q of pipeGeom(r.pts).segs){
    /* midpoint first, then in from each end - a long leg gets more chances
       than a stub, which is what makes the crowded corner resolve at all. */
    const n = q.L>=STACK_MIN_L*2 ? 7 : 3;
    /* ...and each of those may also stand BESIDE the pipe rather than on it.
       Four parallel legs a cell apart cannot all fit their plates on the
       centreline, and the answer to that is a step sideways, not a dropped
       reading. Perpendicular to the segment, so it steps off a vertical run
       horizontally and off a horizontal run vertically - which is the
       direction that has room in each case. */
    const px=-q.dy, py=q.dx;
    for(let i=0;i<n;i++){
      const t = n===1 ? 0.5 : 0.5 + (i%2?1:-1)*Math.ceil(i/2)/(n+1);
      const x=q.x+q.dx*q.L*t, y=q.y+q.dy*q.L*t;
      for(const o of STACK_STEPS)
        out.push({L:q.L, x:x+px*STACK_OFF*o, y:y+py*STACK_OFF*o, key:r.key,
                  fits:q.L>=STACK_MIN_L, off:Math.abs(o)});
    }
  }
  /* on the pipe first, then one step off, then two - so a plant with room
     never gets an offset reading, and only a crowded one pays for it. */
  return out.sort((a,b)=>a.off-b.off);
}
let anchorCache=null, anchorBoxes=[];
function pipeAnchorTick(){ anchorCache=null; anchorBoxes=[]; }
/* WHERE THE READINGS ARE THIS FRAME, for a layer that has to keep off them.
   One list, filled by the allocator below and by nothing else. */
function pipeStackBoxes(){ return anchorBoxes; }
function pipeAnchors(runs){
  if(anchorCache) return anchorCache;
  const out={}, taken=[];
  /* longest run first: a main leg has the most to say and the fewest places
     to say it, and letting a stub take the good spot first is what produced
     the smears this replaces. */
  /* Every run's spots are priced ONCE. The comparator used to build both
     sides' lists on each comparison and throw them away, so an n-run plant
     built that list O(n log n) times over and then a final time per run. */
  const spotsBy=new Map(), longest=new Map();
  for(const r of runs){ const sp=pipeRunSpots(r); spotsBy.set(r,sp);
    let m=0; for(const s of sp) if(s.L>m) m=s.L; longest.set(r,m); }
  const order=runs.slice().sort((a,b)=>longest.get(b)-longest.get(a));
  for(const r of order){
    const spots=spotsBy.get(r);
    if(!spots.length) continue;
    /* SCORED, not first-past-the-post. A ranked search that took the first
       clear candidate and otherwise fell back to spots[0] left three
       overlapping pairs on a four-loop plant - the fallback was picking
       blindly. Every candidate is priced instead: how much of another
       reading it would smear (the thing this whole allocator exists to
       stop), then how much of a machine it would sit on, then how far it has
       had to step off its own pipe, then whether the stretch was long enough
       to hold it. The best one wins, and on a plant with room the best one is
       always the plain midpoint at zero cost. */
    let pick=null, bestCost=Infinity;
    for(const sp of spots){
      const bx=stackBox(sp.x,sp.y);
      let over=0;
      for(const t of taken){
        const ox=Math.min(bx.x+bx.w,t.x+t.w)-Math.max(bx.x,t.x);
        const oy=Math.min(bx.y+bx.h,t.y+t.h)-Math.max(bx.y,t.y);
        if(ox>0&&oy>0) over+=ox*oy;
      }
      const cost = over*1000
                 + (boxClear(bx.x,bx.y,bx.w,bx.h)?0:400)
                 + sp.off*40
                 + (sp.fits?0:120);
      if(cost<bestCost){ bestCost=cost; pick=sp; if(!cost) break; }
    }
    out[r.key]=pick;
    { const bx=stackBox(pick.x,pick.y); bx.key=r.key; taken.push(bx); }
  }
  anchorCache=out; anchorBoxes=taken;
  return out;
}
/* One run's own point, for a caller that has a run rather than the list. The
   allocator above has already decided it for this frame. */
function pipeRunAnchor(r){ return (anchorCache && anchorCache[r.key]) || pipeRunSpots(r)[0] || null; }

/* ══ ONE RUN IN FOCUS ══
   With every run carrying a stack, a busy plant is a wall of numbers and there
   is no way to ask which figure belongs to which pipe. Hovering answers it by
   standing the others down for as long as the pointer is there - the readings
   are all still one keystroke away, which is the difference between this and
   the silent declutters pipeAnchors() replaced.
   AND IT ANSWERS THE QUESTION THE OTHER WAY TOO: with the layers off, hovering
   a pipe puts that one run's readings up (layerPass(), layers.js). Asking a
   single pipe what it is carrying is not the same request as surveying the
   whole plant, and it should not cost switching the survey on.
   Resolved fresh each frame and spent the same one, so it lives beside the
   allocator rather than on S - the standing portRing (plant.js) has. */
let pipeHov=null;
const pipeHovOn = () => LAYERS.press.on||LAYERS.subc.on||LAYERS.flow.on;
/* The one predicate both label paths ask: layerRunLine() places slots 1 and 2,
   pipeMeters() slot 0, and they must not disagree about which run is showing. */
const pipeHovShow = key => !pipeHov || pipeHov===key;
function pipeHovResolve(){
  pipeHov=null;
  if(ui.drag || !vIn(ui.ptr)) return;
  const p=vPt(ui.ptr);
  /* THE LABEL FIRST, because a label draws over the pipes: under a stack the
     answer is that stack, even where a foreign run passes beneath it. Only
     while a layer is on - the allocator hands out a box for every run whatever
     is switched on, and a box with no ink in it is not something to hover. */
  if(pipeHovOn()){ const boxes=pipeStackBoxes();
    for(let i=boxes.length-1;i>=0;i--){ const b=boxes[i];
      if(p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h){ pipeHov=b.key; return; } } }
  const c=cellAt(p), keys=pipeCellRuns(c[0],c[1]);
  if(keys.length) pipeHov=keys[keys.length-1];   // a crossing cell owns two: last wins, as hitAt() does
}

function pipeMeters(runs,L){
  const best=pipeAnchors(runs), PC=pipeColours(L);
  /* ONE METER PER RUN, and every run that has a number gets one. It used to be
     one per KIND, so a four-loop plant drew a single hot-leg reading and the
     other three legs - each with its own length, its own valve and its own
     solved flow - showed nothing. And a relief path used to stay blank until
     it passed (meterQuiet), on the argument that a reading which can only be
     zero is furniture. It cannot only be zero: a relief header reads zero
     because the valve upstream is SHUT, and "shut" is exactly what an
     operator is trying to confirm. Both are deleted. What is NOT deleted is
     the honesty rule going the other way - a run pipeUnit() has no scale for
     gets no number at all, below. */
  for(const r of runs){
    if(!pipeHovShow(r.key)) continue;        // a hidden reading keeps no TIP either - see pipeHovResolve()
    const a=best[r.key]; if(!a) continue;
    const k=r.k, key=r.key;
    const un=pipeUnit(key,k);
    if(!un) continue;                        // nothing forces this run - see pipeUnit()
    const sp=pipeSpd[key]||0, fr=pipeDisplay(key,pipeFrac(key,k,sp));
    const mag=pipeFmt(Math.abs(fr)*un.nom);
    /* the same three states the needle used to carry, in the ink instead:
       stagnant, backwards, over its rating. Judged against the run's own
       DESIGN direction (un.dir), because a key's canonical order is two part
       ids sorted and says nothing about which way the fluid is meant to go. */
    const fd=fr*(un.dir||1);
    const dead=Math.abs(fd)<0.008, over=fd>1.001, back=fd<-0.008;
    pipeStackLine(a.x,a.y,0,(back?"-":"")+mag+" "+un.u,
                  dead?C.ink2:over?C.red:back?C.amber:pipeCol(PC,k));
    /* three things the solve can actually say, kept as three sentences rather than
       one number doing all three jobs: how much, which way, and against what. No
       pressure/dP reading here - a fitting's node potentials never left pipenet.js. */
    TIP(a.x-STACK_W/2,stackY(a.y,0),STACK_W,STACK_H,pipeLabel(k,key)+"  FLOW METER",
      mag+" "+un.u+" - "+Math.abs(Math.round(fd*100))+
      " % of what this run carries as commissioned, undamaged, valves wide."+
      (over?" It is being pushed past what it was built for."
       :back?" It is running backwards."
       :dead?" The line is stagnant."
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
  const p=partOf("pzr");
  if(!p || !fitted(p) || L.dmgParts.includes("pzr")) return;
  const R=prect(p), r=PIPE_DIAL_R;
  const fr=pipeDisplay("pzrP", L.P/Math.max(0.1,P.P0));
  /* low enough to sit in the steam space rather than over the water, and clear
     of the shell's own crown: the box carries a name row before drawSym() even
     starts, so the old offset put the top of the dial outside the vessel it is
     bolted to. It used to be dodging a relief bowtie on the very top of the
     shell too; that valve is a fitting now and is drawn at its own tap
     (pipeFitMarks()). */
  const cx=Math.round(R.x+R.w/2), cy=Math.round(PZR_DIAL_CY(R.y));
  /* The vessel gauge shows ONE plant pressure, so it can only mark one valve;
     the primary is the honest choice, and it follows that valve's own dialled
     setpoint rather than a constant every relief valve used to share. */
  const lift=reliefSet(primaryRelief()).lift;
  pipeDial(cx,cy,r,fr,C.cyan,null,{lim:lift,max:1.35});
  TIP(cx-r,cy-r,2*r,2*r,"PRESSURIZER  PRESSURE",
    L.P.toFixed(2)+" MPa, "+Math.round(fr*100)+" % of the "+P.P0.toFixed(1)+
    " MPa design point. Level "+L.lvl.toFixed(0)+" %."+
    (fr>lift?"  It is past the relief valve setpoint."
            :reliefAnyOpen(L)?"  The relief valve is passing.":""));
}

/* ══════════ the two entry points ══════════
   Both are called by drawPlant() and only with live state - the design bench has no
   flow to show and no instrument to read.

   THE SPLIT IS THE POINT. Fluid is inside a pipe, and a pipe runs BEHIND the plant, so
   pipeFlow() goes down before the components and a packet disappears under a vessel
   the way it should. An instrument is bolted to the outside of the thing it measures,
   so pipeMeters() and pipeVessel() go down after them - drawn first, the pressurizer
   gauge was simply painted over by the pressurizer. */
/* NOTHING IS HIDDEN. This used to drop an injection run whose tank was not
   live - a VIEW declutter on the argument that an idle line nobody has
   commanded on is not worth drawing. It is worth drawing: a line that is
   there and shut is the answer to "is my injection lined up", and a pipe
   that vanishes when a valve closes teaches an operator that a shut valve
   has no pipe behind it. The run was always real, solved and hittable
   underneath; only the picture lied. */
const pipeRuns = L => pipeNetwork();

function pipeFlow(L){
  pipeRate(L);
  const PC=pipeColours(L);
  for(const r of pipeRuns(L)){
    const g=pipeGeom(r.pts);
    if(!g.len) continue;
    const w=pipeWidth(runBore(r));
    ctx.save(); pipeClip(g,w,w/2);
    /* L.flowPos and pipeSpd are keyed by the RUN (r.key), never the kind (r.k) - a
       kind has no entry of its own, so reading r.k here silently fed every packet
       phase 0 and every speed 0, whatever loop it was on. */
    pipeSlugs(pipePad(g,PIPE_RUNWAY), L.flowPos[r.key]||0,
              pipeSpd[r.key]||0, pipeCol(PC,r.k), w, pipeSteam(r,L));
    ctx.restore();
  }
}
/* A CUT PIPE SPILLS FROM BOTH ENDS, AND THAT IS WHERE THE STEAM IS.
   One plume per open end, at the end's own plant point, at that opening's own
   solved rate - so severing a hot leg away from the reactor puts steam at the
   cut and not at the vessel, and the plume dies away as the loop empties
   because the flow driving it does. The two ends share one key and one rate:
   they are one hole in one run, seen from both sides. */
function pipeBreaks(L){
  if(!L || !L.spillBy || !L.dmgParts) return;
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const k=id.slice(5), i=k.indexOf(","); if(i<0) continue;
    const x=+k.slice(0,i), y=+k.slice(i+1);
    /* The rate is the CONNECTION's, because that is what the solve prices, but
       the plume is drawn AT THE CELL - which is the whole of what the break
       nodes bought. A crossing belongs to two runs; take the worse of them. */
    let q=0;
    for(const key of pipeCellRuns(x,y)) q=Math.max(q, L.spillBy["break:"+key]||0);
    if(!(q>0)) continue;
    const [px,py]=cellPos(x,y);
    fxSteam(px, py, 22, fxEase("brk:"+k, clamp(q/SPILL_FULL,0,1)), "#ffd0c4", 29);
  }
}
/* A BROKEN CELL IS A GAP IN THE PIPE, cut over the stroke that runs through
   it. Per CELL, because that is what a hit takes out now - the run either side
   of it is still there, and drawing the whole connection red would say the
   opposite. */
function pipeDamage(L){
  if(!L || !L.dmgParts) return;
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const k=id.slice(5), i=k.indexOf(","); if(i<0) continue;
    const r=grect(+k.slice(0,i), +k.slice(i+1), 1, 1);
    const cx=r.x+r.w/2, cy=r.y+r.h/2;
    /* THE STROKE IS TAKEN OUT, not painted over. A flat red square read as a
       marker dropped ON the pipe - a label, and one an alpha layer washed out -
       while the thing being said is that the pipe is NOT THERE any more. So the
       cell is cut back to the deck, hatched, framed, and the tear is drawn
       across it; and it sparks, the same decoration a wrecked machine wears. */
    fillRect(r.x+1,r.y+1,r.w-2,r.h-2,C.well);
    hatch(r.x+1,r.y+1,r.w-2,r.h-2,C.red,.5);
    frame(r.x+1,r.y+1,r.w-2,r.h-2,C.red);
    ctx.save();
    ctx.strokeStyle=C.red; ctx.lineWidth=2; ctx.lineCap="round"; ctx.lineJoin="miter";
    ctx.beginPath();
    ctx.moveTo(r.x+2,cy-6); ctx.lineTo(cx+3,cy-2);
    ctx.lineTo(cx-3,cy+2);  ctx.lineTo(r.x+r.w-2,cy+6);
    ctx.stroke();
    ctx.restore();
    fxSparks(r.x+2,r.y+2,r.w-4,r.h-4,0.5,C.red);
  }
}
/* EVERY PIPE CELL NO CONNECTION CLAIMS, AND WHICH WAY IT OPENS. Dead-coloured,
   because it is pipe that is really there and really carries nothing - a cell
   laid into thin air, or a run whose two ends butt rather than join. The box
   alone said only THAT it carries nothing, so the one question the player then
   has - which way is this thing pointing, and is that why it will not join -
   had no answer on screen and the wheel looked inert. The path is drawn from
   the same PIPE_SHAPE rows the trace walks, so the picture cannot disagree
   with what pipeExit() thinks the cell is. */
function pipeLoose(L){
  const own=pipeMap().cellOwner;
  ctx.save(); ctx.strokeStyle=C.ink2; ctx.lineCap="butt"; ctx.lineJoin="round";
  for(const k in D.pipes){
    if(own[k]) continue;
    const i=k.indexOf(","), x=+k.slice(0,i), y=+k.slice(i+1);
    const cell=D.pipes[k], sh=PIPE_SHAPE[cell.s];
    const r=grect(x,y,1,1), cx=r.x+r.w/2, cy=r.y+r.h/2, h=r.w/2;
    if(sh){ ctx.lineWidth=3;
      for(const pr of sh.paths){
        const a=rotFace(pr[0],cell.r), b=rotFace(pr[1],cell.r);
        ctx.beginPath();
        ctx.moveTo(cx+DIRV[a][0]*h, cy+DIRV[a][1]*h);
        ctx.lineTo(cx,cy);
        ctx.lineTo(cx+DIRV[b][0]*h, cy+DIRV[b][1]*h);
        ctx.stroke();
      } }
    ctx.save(); ctx.setLineDash([3,3]); ctx.lineWidth=1.5;
    ctx.strokeRect(r.x+3,r.y+3,r.w-6,r.h-6); ctx.restore();
  }
  ctx.restore();
}

