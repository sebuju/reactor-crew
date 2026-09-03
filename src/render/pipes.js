"use strict";
/* ═══════════════ what is in the pipes, and what it is doing ═══════════════

   drawPlant() strokes the pipe itself - a dark casing and a coloured fluid line.
   Everything in here goes on top of that: the fluid moving inside the run, and the
   instruments that say how much of it is moving.

   Nothing here invents a flow. S.flowPos[k] is what the sim integrated at the real
   rate; the texture and the meters both read that one number.                    */

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

/* ══ AND IT IS LINEAR IN REAL DIAMETER NOW ══
   2.75+1.25*bore put the whole 150-750 mm range inside ONE pixel, so the
   number a player sets was invisible on the board. Linear off the bore, with
   a visibility floor and a ceiling that still clears a 16 px cell once the
   casing is round it. Deliberately NOT quantised into classes: the plant is
   drawn in grid units and then ctx.scale(VIEW.s), so a half-pixel difference
   at fit zoom resolves exactly when the player zooms in. 187.5 and 225 mm are
   not tellable apart at fit zoom - that is the limit, stated rather than
   papered over. */
/* THE CEILING IS THE JOINT, WHICH IS THE CELL. A run ends in a nozzle and a
   nozzle is a FLANGE: it has to stand proud of the pipe it caps, or the joint
   is a stripe across a pipe of the same width and reads as nothing at all. So
   the budget across a 16 px cell is spent once, outwards:
       12  the joint, 2 clear pixels each side of the cell (NOZZLE_HALF_MAX,
           plant.js - two, not one, because the deck's grid dot stands in one)
       10  the casing at its widest: PIPE_W_MAX + 2*WALL_PX's own ceiling,
           leaving the flange a pixel proud on each side
        6  the bore
   PIPE_PX follows the ceiling: at 11 px per unit bore a 750 mm leg already
   pinned it, so every ordinary run drew at max and the number the player set
   could only be read downward. At 3.75 a full-bore leg is mid-scale and it
   takes about 1200 mm to reach the top. */
const PIPE_W_MAX = 6;
const PIPE_PX = 3.75;
const pipeWidth = bore => clamp(PIPE_PX*bore, 2.2, PIPE_W_MAX);
/* ══ AND THE CASING IS THE WALL ══
   The casing was hardcoded at 2*w, so every pipe's wall read as half its own
   bore. It is the real millimetres now (runWallMm(), pipenet.js). WALL_PX is
   a STATED display exaggeration - the RAD_AREA_CELL idiom, a lie the ship's
   scale already tells, named out loud: a real 70 mm wall on a 750 mm bore is
   one pixel at true scale, and one pixel cannot be read. */
const WALL_PX = 0.09;
const pipeWallPx = r => clamp(runWallMm(r)*WALL_PX, 0.6, 2);   // 2, so bore+2 walls stays inside the joint that caps it

/* The one pipe colour table. drawPlant() strokes the run with it and the packets are
   drawn in it, so a packet can never be a different colour from its own pipe. */
function pipeColours(L){
  const heat = L? L.n*PROMPT_F+L.decay : 0;
  const Th = L? L.Tavg+15*heat : 598, Tc = L? L.Tavg-15*heat : 568;
  /* ══ AND THE PRIMARY IS THE COLOUR OF WHAT IS IN IT ══
     The cold end of the lerp was a hardcoded water blue, so a sodium plant's
     primary drew water. It is the coolant family's own hue now; the
     temperature lerp stays and simply lerps about that hue instead. */
  const cc = (COOLANT[D.cool] && COOLANT[D.cool].col) || "#5aa9d6";
  return { hot: L?lerpC(cc,"#ff5a45",(Th-520)/110):"#c8735e",
           cold:L?lerpC(cc,"#ff5a45",(Tc-520)/110):cc,
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
function pipeAt(g,s){
  s=clamp(s,0,g.len);
  for(const q of g.segs) if(s<=q.s0+q.L){
    const t=Math.max(0,s-q.s0);
    return {x:q.x+q.dx*t,y:q.y+q.dy*t,dx:q.dx,dy:q.dy};
  }
  const q=g.segs[g.segs.length-1];
  return {x:q.x+q.dx*q.L,y:q.y+q.dy*q.L,dx:q.dx,dy:q.dy};
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
/* ══ NYQUIST, NOT A SPEED LIMIT ══
   Parcels are a repeating texture of period `per`, and so is a rotor with six
   blades. The eye matches this frame's marks to the nearest ones in the last,
   so an advance of more than HALF a period a frame is read as motion the other
   way - the wagon wheel. The stock plant's feed lines space their parcels
   7.6 px apart and reversed from 4x; the turbine rotor is 60 degrees of
   symmetry against ~94 degrees a frame at 16x, and read -26. So the DISPLAY
   phase advances by what the texture can carry, and `over` says by how much it
   could not keep up.

   IT TAKES AN ADVANCE, NEVER TWO SAMPLES OF AN ANGLE. A value kept %360 that
   moves more than half a turn in a frame carries no direction at all - the
   difference between two samples is then a coin toss, and clamping a coin toss
   is a shaft jittering in place, which is what the pump did at MAX. So a shaft
   hands over its RATE (s.spinV, deg/s) and the pipes hand over the distance
   their own monotonic integral moved. Neither can be ambiguous.

   ANSWERED ONCE A PASS, because this ADVANCES something. s.spin is one angle
   for every pump on the plant, so a key asked once per box would step four
   times in a four-pump frame and run the impellers at four times the rate.
   Keyed on layPass() (layout.js), which is the same door everything else that
   is a pure function of one pass uses, and which answers 0 - never cacheable -
   outside a window.
   Display state, so it is not on S and pipeReset() clears it. */
const pipePh={}, pipeRaw={}, pipeOver={}, pipePass={}, pipeAdv={};
function aliasStep(key,adv,per){
  const pass=typeof layPass==="function"?layPass():0;
  if(pass && pipePass[key]===pass) return {ph:pipePh[key], over:pipeOver[key], adv:pipeAdv[key]||0};
  pipePass[key]=pass; pipeAdv[key]=adv;
  pipePh[key]=(pipePh[key]||0)+clamp(adv,-per*0.4,per*0.4);
  pipeOver[key]=clamp(Math.abs(adv)/(per/2)-1,0,1);
  return {ph:pipePh[key], over:pipeOver[key], adv};
}
/* what a monotonic integral moved since the last pass, asked BEFORE the period
   is chosen: a caller that can widen its own texture buys the speed back at
   full brightness instead of losing it. */
function aliasAdv(key,v){
  const pass=typeof layPass==="function"?layPass():0;
  if(pass && pipePass[key]===pass) return pipeAdv[key]||0;
  const prev=pipeRaw[key]; pipeRaw[key]=v;
  return prev===undefined ? 0 : v-prev;
}
const aliasRate=(key,rate,per)=>aliasStep(key,rate*pipeDt,per);
/* PLANT seconds this frame - what a rate has to be multiplied by to become a
   frame's travel. A caller that shapes its own advance needs it before it can
   hand one over. */
const frameDt=()=>pipeDt;
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
  pipeStackTick();
  pipeAnchors(pipeRuns(L));
  if(!L) return;
  netField(L, pipeDrop, pipeP);
}
/* Pressure on a RUN rather than at a node: the mean of its two ends, which is
   what a gauge tapped into the middle of it would read. null for a TAP-ENDED
   run - one whose key names no second node, i.e. the surge line - so a caller
   draws nothing rather than a zero. Every run with two ends has an edge and
   two nodes, steam and feed included; runEnds() is the whole test. */
function pipeRunP(r,L){
  /* A CUT RUN HOLDS NOTHING. Its two ends are still nodes on a live circuit,
     so the mean of them printed the reactor's own pressure on a length of pipe
     lying open in the compartment. What is in it is at containment, which is
     where every other opening on this plant sits. */
  if(runCut(r,L)) return P.Pcont;
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
  const pr=pipeRunP(r,L);
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
  for(const k in pipePh)    delete pipePh[k];
  for(const k in pipeRaw)   delete pipeRaw[k];
  for(const k in pipeOver)  delete pipeOver[k];
  for(const k in pipePass)  delete pipePass[k];
  for(const k in pipeAdv)   delete pipeAdv[k];
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

   EVERY RUN IS NORMALISED ON ITSELF, so the full scale is the same 84 for all
   of them and the unit conversion is gone: step() drives each run's integral at
   its own share of its own reference, and P.netRefKg says what that reference
   is worth in kilograms. Weighting by ref/P.netRefRun instead measured a
   condensate line against the PRIMARY's mean leg - see pipeFullScale().

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
/* Which TANK this run ends on, or null. Off the run's own END PARTS, never off
   P.net.tankNid: a tank's node carries no face and a run end does ("efw" against
   "efwt"), so the string compare that used to stand here matched nothing on any
   plant and every caller silently read null. A tank folds its faces onto one
   node, so ending on the part IS ending on the node. */
function runTankId(key){
  const r = P.net && P.net.byKey[key];
  if(!r) return null;
  return D.tanks[r.a] ? r.a : D.tanks[r.b] ? r.b : null;
}
function pipeFullScale(key,k){
  const ends=runEnds(key,k);
  /* A steam run's integral is already normalised on rated steam in step(), so
     100 % is the same 84 every other run's reference lands on. */
  if(runVapour(ends)) return 84;
  /* A RUN IS NORMALISED ON ITSELF, so 100 % is the same 84 for every run on
     the plant - liquid, steam or exhaust. It used to be weighted by
     ref/P.netRefRun, which measured a condensate line against the PRIMARY's
     mean leg: the same kilograms drew packets nine times slower the moment
     they were water, and the digit beside them read 20 % high. */
  if(P.netRefByRun[key]) return 84;
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
   Any run WITH a solved reference reads P.netRefKg[key] - what THAT run
   carries as commissioned, in kilograms - so its own fraction times its own
   reference lands on its own real kg/s and no run is measured against
   another's. Two runs are never
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
  /* THE FALLBACK ONLY, for a run with no solved reference of its own - the
     surge line, and anything asked about before commission() has run. A heat
     balance on the rated power: water at these conditions is about 5.5 kJ/kg/K
     and the loop is drawn with a 30 K rise, shared between the loops built. */
  const per=Math.max(1,P.loops);
  const loop=P.rated*1000/(5.5*30)/per;
  const ends=runEnds(key,k);
  /* WHICH WAY THIS RUN IS MEANT TO CARRY: the sign of its own REFERENCE flow -
     the plant as commissioned, undamaged, valves wide. A key's canonical order
     is two part ids sorted and says nothing about it, so without this three of
     the four stock primary runs read as running backwards while doing exactly
     what they were built to do.
     AND THE NOMINAL IS THAT SAME REFERENCE, IN KILOGRAMS (P.netRefKg, fitted
     in commission()). It was a heat balance on the rated power - 5.5 kJ/kg/K
     over a 30 K rise, shared between the loops - which is a design figure for
     a PRIMARY leg and was being applied to the condensate line as well. */
  const sref=P.netRefByRun[key];
  if(sref) return {nom:(P.netRefKg&&P.netRefKg[key])||0, u:"kg/s",
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
    return {nom:steamScale(key,k), u:"kg/s", dir:steamDir(key,k)};
  return null;
}
/* ══ HOW TWO-PHASE A LINE IS, 0..1 - OFF WHAT IS ACTUALLY IN IT ══
   This read net.tag, a DIRECTION label, plus a PIPE_NO_CARRYOVER name table
   whose own comment said nothing solved distinguished the cases. Something
   does: netQualAt() is the quality the enthalpy field carries at a node, and
   it answers exactly this question at the run's own ends. The name table is
   gone with it - a surge line reads liquid because its water IS liquid, not
   because it was listed.
   Read off the run's OWN graph edge (net.edges, matched by key), never
   runEnds()+coreFold(): the edge already holds the two node indices the build
   resolved. */
function pipeSteam(r,L){
  const net=P.net;
  if(!net) return RUN_VAPOUR[r.k]?1:0;
  let x=0, seen=false;
  for(const ed of net.edges) if(ed.key===r.key){
    x = Math.max(x, netQualAt(L,net.name[ed.u]), netQualAt(L,net.name[ed.v])); seen=true; }
  return seen ? clamp(x,0,1) : (RUN_VAPOUR[r.k]?1:0);
}

/* ══════════ the bubbles ══════════ */
const PIPE_RUNWAY=60;
const PIPE_BUB_WALL=0.35;       // px of bore left clear: a parcel touching the wall reads as a burr
const pipeHash = k => Math.imul(k^0x9e3779b1,2654435761)>>>0;
const pipeRnd = (k,sh,m) => ((pipeHash(k)>>>sh)&m)/m;
const pipeSeed = key => { let a=0; for(let i=0;i<key.length;i++) a=Math.imul(a^key.charCodeAt(i),16777619); return a>>>0; };
/* A PARCEL IS A FIXED STEP IN BRIGHTNESS, NOT A FIXED TINT. One 0.55 toward
   bright was measured on the feed line's blue and is nearly nothing on a hot
   leg; the tint is solved for the STEP instead, so every run parts from its own
   colour by the same amount. Lighter is the reading everywhere except a pipe
   already too pale to lighten - steam - which goes dark, and by HALF the step:
   a dark mark on a pale line reads far louder than a pale one on a dark line,
   so the same number down is a hole in the pipe rather than a parcel in it. */
const PIPE_BUB_DL=0.20;   // the step the feed line already had, which reads right
const PIPE_BUB_DARK=0.5;
const PIPE_BUB_COL={};
const pipeLum = col => { const p=hexPack(col);
  return (0.299*(p>>16&255)+0.587*(p>>8&255)+0.114*(p&255))/255; };
function pipeBubCol(col){
  let v=PIPE_BUB_COL[col];
  if(v===undefined){
    const lum=pipeLum(col);
    v=lum>0.75 ? lerpC(col,C.bg,    clamp(PIPE_BUB_DL*PIPE_BUB_DARK/(lum-pipeLum(C.bg)),0.08,0.85))
               : lerpC(col,C.bright,clamp(PIPE_BUB_DL/(pipeLum(C.bright)-lum),0.35,0.9));
    PIPE_BUB_COL[col]=v;
  }
  return v;
}
function pipeStream(g,key,ph0,sp,col,w,st,seed){
  const moving=Math.min(1,Math.abs(sp)/8);
  /* a wide bore carries more of them, not bigger ones */
  const gap0=Math.max(6,20-w*2.2)*(1+st*0.3), lim=w/2-PIPE_BUB_WALL;
  /* A FAST RUN SPREADS ITS PARCELS OUT RATHER THAN DIMMING THEM. The period is
     what sets the speed the texture can carry, so widening it is how the
     picture buys the speed back - fewer marks, further apart, all of them at
     full brightness and all of them still going the right way. Capped, or a
     16x run empties into two dots. Dimming was tried first and it read as no
     flow at all past 4x. */
  const adv=aliasAdv(key,ph0);
  const gap=gap0*clamp(Math.abs(adv)/(gap0*0.4),1,2.5);
  /* THE PHASE IS THE ONE THE TEXTURE CAN CARRY - see aliasStep(). Everything
     below reads it, including the parcel's identity and its wobble, or a mark
     would be drawn somewhere its own number did not put it. */
  const a=aliasStep(key,adv,gap), ph=a.ph;
  /* and what it still could not carry is spent on the line: a run moving too
     fast to resolve into parcels is a streak, which is what a fast flow looks
     like on any real camera. */
  ctx.save(); ctx.globalAlpha=0.22+0.18*a.over; ctx.lineCap="square"; ctx.lineJoin="round";
  ctx.lineWidth=w; ctx.strokeStyle=col;
  const any=pipeSub(g,0,g.len);
  if(any) ctx.stroke();
  ctx.restore();
  if(!any) return;
  /* a stopped line carries no parcels: they fade out with the flow that drove them */
  if(moving<0.01) return;

  ctx.save(); ctx.fillStyle=pipeBubCol(col);
  for(let s=((ph%gap)+gap)%gap-gap;s<g.len;s+=gap){
    const id=Math.round((ph-s)/gap)+(seed|0);
    const r=clamp((0.45+0.55*pipeRnd(id,9,255))*w*0.42, 0.55, Math.max(0.55,lim));
    /* THE PARCEL STAYS INSIDE THE BORE. The offset is priced off what the
       radius leaves, never off the bore, or half of a fat one sits on the wall. */
    const off=(pipeRnd(id,19,255)-0.5)*2*Math.max(0,lim-r);
    /* and it surges: a parcel is in the fluid, not bolted to it. The wobble is
       driven by ph, so it stops dead when the flow does. */
    const d=s+Math.sin(ph*(0.05+0.03*pipeRnd(id,3,255))+id)*gap*0.12;
    const at=pipeAt(g,clamp(d,0,g.len));
    ctx.globalAlpha=0.9*moving*(0.55+0.45*pipeRnd(id,2,255))*(1-st*0.3);
    ctx.beginPath(); ctx.arc(at.x-at.dy*off, at.y+at.dx*off, r, 0, 6.2832); ctx.fill();
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

   The three are INDEPENDENT: each is still its own layer with its own switch
   and each colours itself off its own value. A SLOT IS AN ORDER, NOT A ROW -
   the block holds only the readings that are on, packed and centred on the
   pipe, so switching a layer off shortens the label rather than punching a
   band of empty plate through the middle of it.

   The one round face left on the plant is the pressurizer's (pipeVessel), and
   that is bolted to a vessel rather than to a pipe. */
const STACK_H=10;                         // one line of 6.5px ink and its plate
/* THE BLOCK IS CENTRED ON THE ANCHOR, so it reads as that pipe's label
   whatever it ends up holding. Slot 0 used to be pinned 20px above the point
   and the rest hung off it, which centred a four-line stack and left a
   one-line one floating clear of the pipe it belonged to. */
const stackTop = (y,n) => Math.round(y-(n*STACK_H)/2);
/* ══ ONE PLATE PER STACK, LINE-BROKEN ══
   NOT pipeTag(), and not a plate per line either. Every reading on a run is a
   line of the SAME rectangle: the readings are collected as they are produced
   - each layer still draws at its own seam - and the rectangle goes down once,
   under all of them, in one final pass. Four plates butted edge to edge left a
   hairline of pipe between them wherever the view transform landed one on a
   half pixel, and a slot whose layer was off punched a hole clean through the
   block. Collected by ANCHOR POINT, which is what a stack is: every line of
   one run is handed the same x,y. */
const STACK_W=48;
let stackInk=new Map();
function pipeStackTick(){ stackInk=new Map(); }
function pipeStackLine(x,y,slot,label,col){
  const k=x+","+y;
  let e=stackInk.get(k);
  if(!e) stackInk.set(k, e={x,y,lines:[]});
  e.lines.push({slot,label,col});
}
/* The last thing the plant draws. A stack that has stood down for a hovered
   neighbour collected nothing and so has no plate either - an empty rectangle
   is a reading you then have to go and look for. */
function pipeStackFlush(){
  for(const e of stackInk.values()){
    const ls=e.lines.slice().sort((a,b)=>a.slot-b.slot);
    if(!ls.length) continue;
    /* SLOT IS AN ORDER, NOT A ROW. The lines are PACKED: a switched-off layer
       takes its line out of the block rather than leaving a band of empty
       plate where its reading would have been. */
    const n=ls.length, top=stackTop(e.y,n);
    /* no spare pixel on the plate and no hand-picked baseline: the plate is
       exactly its lines and each line is centred in its own band by cap
       height (midBase()), which is where every other centred string on the
       board is put. The +1 and the +8 were for butted plates and are what
       left the block reading half a pixel low. */
    fillRect(e.x-STACK_W/2, top, STACK_W, n*STACK_H, C.bg);
    ls.forEach((l,i)=>txt(l.label, e.x, midBase(top+i*STACK_H,STACK_H,6.5),
      {size:6.5,sp:.4,align:"center",color:l.col}));
  }
  stackInk.clear();
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
const PZR_DIAL_CY=boxY=>boxY+PIPE_DIAL_R+18;
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
const stackBox=(x,y,n)=>({x:x-STACK_W/2, y:stackTop(y,n||STACK_N), w:STACK_W, h:(n||STACK_N)*STACK_H});
/* ══ A FITTING'S READING IS A LINE OF ITS PIPE'S STACK ══
   A relief valve's margin and a throttle's share of the head used to be
   pipeTag()s parked over the valve's own box, which is where its NAME already
   is: two plates of different widths in one cell, and neither the allocator
   nor boxClear() knew either was there. They are plumbing readings like the
   other three, so they go in the same rectangle at slot 3 and the allocator
   keeps that line clear like the rest.
   ONE ANSWER, asked here by the allocator (which must reserve the fourth
   line) and by pipeFitMarks() (which draws into it) - two answers and the
   reading lands in a box nobody kept clear. Lowest key, so it does not depend
   on the placement it is an input to. */
const STACK_N=3;                          // lines every run carries
const fitPidPart=pid=>{ const q=D.ports[pid]; return q?q.p:null; };
const fitReads=p=>p.role==="fitting" &&
  (fitModeOf(p.id)==="relief"||fitModeOf(p.id)==="throttle");
function fitRunKey(fid,runs){
  let best=null;
  for(const r of runs){
    if(fitPidPart(r.pa)!==fid && fitPidPart(r.pb)!==fid) continue;
    if(best===null||r.key<best) best=r.key;
  }
  return best;
}
function fitStackKeys(runs){
  const set=new Set();
  for(const p of LAY.parts){ if(!fitReads(p)) continue;
    const k=fitRunKey(p.id,runs); if(k!==null) set.add(k); }
  return set;
}
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
  const fitKeys=fitStackKeys(runs);
  const slots=r=>fitKeys.has(r.key)?STACK_N+1:STACK_N;
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
      const bx=stackBox(sp.x,sp.y,slots(r));
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
    { const bx=stackBox(pick.x,pick.y,slots(r)); bx.key=r.key; taken.push(bx); }
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
    TIP(a.x-STACK_W/2,stackTop(a.y,STACK_N),STACK_W,STACK_N*STACK_H,pipeLabel(k,key)+"  FLOW METER",
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
/* ONE GAUGE PER HOLD TANK, on the vessel it is bolted to and reading the
   pressure THAT vessel holds - never the id "pzr" and never s.P, so a second
   pressurizer on a second circuit gets its own dial saying its own number. */
function pipeVessel(L){ for(const id of holdTankIds()) pipeHoldDial(L, id); }
function pipeHoldDial(L, id){
  const p=partOf(id);
  if(!p || !fitted(p) || partWrecked(L,id)) return;
  const ci=tankCircuit(id), pv=loopP(L,ci), set=holdSetP(ci);
  const R=prect(p), r=PIPE_DIAL_R;
  const fr=pipeDisplay(id+":P", pv/Math.max(0.1,set));
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
  // the dial is a FRACTION of this vessel's own setpoint, and the valve now
  // states an absolute MPa, so it is divided into the same scale the needle is on
  const fid=primaryRelief(), lift=fid ? reliefSet(fid).lift/Math.max(set,1e-6) : Infinity;
  pipeDial(cx,cy,r,fr,C.cyan,null,{lim:lift,max:1.35});
  TIP(cx-r,cy-r,2*r,2*r,partName(p).toUpperCase()+"  PRESSURE",
    pv.toFixed(2)+" MPa, "+Math.round(fr*100)+" % of the "+set.toFixed(1)+
    " MPa setpoint. Level "+tankLvl(L,id).toFixed(0)+" %."+
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

/* ══ A RUN STATES ITS SIZE AND WHAT IT HOLDS, ON ITSELF ══
   Bore and pressure were only ever on the PIPE RUN panel, so they could be
   read for one run at a time and never compared. The second word is what the
   run CARRIES (runDesignP), not its wall: the wall is already the picture -
   it is the casing drawn round the bore - while the pressure behind it is
   drawn nowhere and is what decides whether that wall is enough. TWO
   words, because they are two quantities: joined into one string they could
   only be placed where a single straight leg was long enough for both, so a
   run that bends printed nothing. Split, they take a leg each.
   INSIDE the tube, sized to the BORE and laid along the pipe - a vertical leg
   reads turned a quarter turn, the same rule portWordDraw() keeps for a joint
   on a side face. Sizing to the bore is what keeps the ink off the casing,
   which is the wall and is a reading of its own.
   Dark ink, because the tube is a bright fill - C.inkOnLit is the palette's
   own ink for that ground, the same one a port's word already uses.
   Scaled, never clipped: a short leg gets a small word rather than half of a
   big one, and the size is in plant units, so zoom resolves it. */
const PIPE_LAB_PAD=1.1;         // clear pixels between the word and the casing
/* WHERE THE TWO WORDS GO - one per straight leg where the run has two worth
   using, both on the one leg where it has not, each carrying the room it may
   spend along the pipe so neither is sized off length it has not got. */
function pipeLabSpots(g){
  const at=(q,t)=>({x:q.x+q.dx*t, y:q.y+q.dy*t, dx:q.dx, dy:q.dy});
  const segs=g.segs.slice().sort((a,b)=>b.L-a.L);
  if(!segs.length) return [];
  const q=segs[0];
  if(segs.length<2 || segs[1].L < q.L*0.45)
    return [{p:at(q,q.L/3), room:q.L/3}, {p:at(q,q.L*2/3), room:q.L/3}];
  return [{p:at(q,q.L/2), room:q.L*0.9},
          {p:at(segs[1],segs[1].L/2), room:segs[1].L*0.9}];
}
/* A CUT RUN STATES NO PRESSURE. The MPa word is what this run is HELD AT, and
   a run with a hole in it holds nothing - it stood there reading 15.5 MPa over
   a pipe drawn as torn open two cells away. Its bore is still a fact, so that
   word stays. runHoled() (pipenet.js) is the SOLVE's own predicate, so a torn
   cell and a wrecked nozzle valve read the same here as they do there. */
const runCut = (r,L) => !!(L && r.cells && runHoled(L,r));
function pipeSizeLabels(NET,L){
  const REF=10, o0={size:REF,sp:0};
  for(const r of NET){
    const g=pipeGeom(r.pts); if(!g.len) continue;
    const w=pipeWidth(runBore(r));
    const p=runDesignP(r);
    const words=[Math.round(runBoreMm(r))+" mm"];
    if(!runCut(r,L)) words.push((p>=10?p.toFixed(1):p.toFixed(2))+" MPa");
    const spots=pipeLabSpots(g);
    const n=Math.min(spots.length, words.length);
    /* ONE SCALE FOR BOTH WORDS: sized apart, the shorter word rode a whole
       step bigger than its pair and the two read as separate labels. */
    let sz=w-PIPE_LAB_PAD;
    for(let i=0;i<n;i++)
      sz=Math.min(sz, REF*spots[i].room/Math.max(tw(words[i],o0),1e-6));
    if(!(sz>0.8)) continue;
    for(let i=0;i<n;i++){
      const word=words[i], sp=spots[i];
      const vert=Math.abs(sp.p.dx)<Math.abs(sp.p.dy);
      ctx.save(); ctx.translate(sp.p.x, sp.p.y);
      if(vert) ctx.rotate(-Math.PI/2);
      txt(word,0,sz*0.36,{size:sz,sp:0,align:"center",color:C.inkOnLit});
      ctx.restore();
    }
  }
}

function pipeFlow(L){
  pipeRate(L);
  const PC=pipeColours(L);
  for(const r of pipeRuns(L)){
    const g=pipeGeom(r.pts);
    if(!g.len) continue;
    if(runCut(r,L)) continue;   // a severed run carries nothing: no packets over an empty bore
    const w=pipeWidth(runBore(r));
    ctx.save(); pipeClip(g,w,w/2);
    /* L.flowPos and pipeSpd are keyed by the RUN (r.key), never the kind (r.k) - a
       kind has no entry of its own, so reading r.k here silently fed every packet
       phase 0 and every speed 0, whatever loop it was on. */
    pipeStream(pipePad(g,PIPE_RUNWAY), r.key, L.flowPos[r.key]||0,
              pipeSpd[r.key]||0, pipeCol(PC,r.k), w, pipeSteam(r,L), pipeSeed(r.key));
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
  /* A WRECKED NOZZLE VALVE IS AN OPENING TOO (runHoled(), pipenet.js), and it
     discharges at the JOINT rather than at a pipe cell - the one place on this
     run where the picture and the solve's own node agree. */
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("port:")!==0) continue;
    const pid=id.slice(5);
    let q=0;
    for(const r of pipeNetwork()) if(r.pa===pid||r.pb===pid)
      q=Math.max(q, L.spillBy["break:"+r.key]||0);
    if(!(q>0)) continue;
    const [px,py]=portPos(pid);
    fxSteam(px, py, 22, fxEase("brk:"+id, clamp(q/SPILL_FULL,0,1)), "#ffd0c4", 29);
  }
}
/* A BROKEN CELL IS THE SAME LENGTH OF PIPE WITH ITS WALL GONE RED AND NOTHING
   LEFT IN IT. One mark, and it is the pipe's own two parts said plainly: the
   casing is what failed, so the casing is what turns red, and the bore is
   painted back to the deck because a severed run carries nothing through here.
   Per CELL, because that is what a hit takes out - the run either side of it
   is still there, and reddening the whole connection would say the opposite.
   The run's OWN polyline, clipped to the cell, so a bend breaks as a bend and
   the picture cannot drift from the stroke it replaces. */
function pipeDamage(L){
  if(!L || !L.dmgParts) return;
  const NET=pipeNetwork();
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const k=id.slice(5), i=k.indexOf(","); if(i<0) continue;
    const x=+k.slice(0,i), y=+k.slice(i+1), r=grect(x,y,1,1);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
    ctx.lineCap="square"; ctx.lineJoin="round";
    let drew=false;
    for(const key of pipeCellRuns(x,y)){
      const run=NET.find(q=>q.key===key); if(!run) continue;
      const w=pipeWidth(runBore(run)), cw=w+2*pipeWallPx(run);
      ctx.beginPath(); ctx.moveTo(run.pts[0][0],run.pts[0][1]);
      for(let j=1;j<run.pts.length;j++) ctx.lineTo(run.pts[j][0],run.pts[j][1]);
      ctx.lineWidth=cw; ctx.strokeStyle=C.red; ctx.stroke();
      ctx.lineWidth=w;  ctx.strokeStyle=C.well; ctx.stroke();
      drew=true;
    }
    /* A cell no connection claims has no polyline to borrow, so it takes the
       one pipeLoose() draws it with - in red, because it is broken pipe. */
    if(!drew){
      const cell=D.pipes[k], sh=cell&&PIPE_SHAPE[cell.s];
      const cx=r.x+r.w/2, cy=r.y+r.h/2, h=r.w/2;
      if(sh){ ctx.strokeStyle=C.red; ctx.lineWidth=3;
        for(const pr of sh.paths){
          const a=rotFace(pr[0],cell.r), b=rotFace(pr[1],cell.r);
          ctx.beginPath();
          ctx.moveTo(cx+DIRV[a][0]*h, cy+DIRV[a][1]*h);
          ctx.lineTo(cx,cy);
          ctx.lineTo(cx+DIRV[b][0]*h, cy+DIRV[b][1]*h);
          ctx.stroke();
        } }
    }
    ctx.restore();
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

