"use strict";

// the one valve symbol (two triangles nose to nose): the pressurizer relief
// valve and a junction tie share this drawing so they cannot drift apart
function bowtie(cx,cy,w,h,col){
  ctx.beginPath();
  ctx.moveTo(cx-w/2,cy-h/2); ctx.lineTo(cx+w/2,cy+h/2);
  ctx.lineTo(cx+w/2,cy-h/2); ctx.lineTo(cx-w/2,cy+h/2);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
}
/* A relief valve has THREE states, not two: shut and holding, passing, and
   GIVEN UP - a blocked valve is dead metal with a bar through it, because
   shutting the block valve buys the leak back at the price of the relief path
   for the rest of the run. One drawing, once, at the fitting's own tap
   (pipeFitMarks()) - however many relief valves a design carries. */
/* THREE fittings, three symbols, one drawing. A bowtie alone says "valve" and
   stops there, so a tee, a throttle and a relief valve were the same mark in
   three places - and on the bench they were not even that, just a dot. What
   tells them apart is what sits on the stem, the way a P&ID does it:

     tee       bare        it is a gate, opened and shut, nothing drives it
     throttle  crossbar    a handwheel - a position you set and it holds
     relief    coil        a spring - it lifts itself, and no one asked it to

   The bench draws the identical symbol in a dead colour, because the shape is
   what the design is; only the state belongs to a running plant. */
function fitGlyph(cx,cy,w,h,mode,col){
  bowtie(cx,cy,w,h,col);
  if(mode==="tee") return;
  const t=cy-h/2;
  line(cx,t,cx,t-3,col,1.3);                       // the stem a driven valve has
  if(mode==="throttle") line(cx-4,t-3,cx+4,t-3,col,1.4);
  else { line(cx-3,t-3,cx+3,t-6,col,1.2);          // a coil seen from the side
         line(cx-3,t-6,cx+3,t-3,col,1.2); }
}
function reliefBowtie(cx,cy,w,h,L,fid){
  const open = !!(L && fid && L.reliefOpen[fid] && !L.reliefBlocked[fid]);
  const blkd = !!(L && fid && L.reliefBlocked[fid]);
  fitGlyph(cx,cy,w,h,"relief", open?C.red : blkd?C.dis : C.green);
  if(blkd) line(cx-w/1.5,cy,cx+w/1.5,cy,C.red,1.6);
}
/* The casing colour, named once: the nozzle below has to be the same dark as
   the pipe it caps, or the joint reads as a different object bolted on. */
const PIPE_CASE="#22383e";

/* A run ends ON a component's shell, and the component loop draws straight
   over that last pixel - so a pipe arrived at a box and simply STOPPED, with
   nothing to say it was connected rather than parked against it. A nozzle is
   that joint made visible: a short flange straddling the shell line, wider
   than the bore it carries, drawn AFTER the machines so it reads as bolted on
   instead of buried under them.

   Only a real port gets one (r.nz, layout.js). A branch ends on another
   PIPE, not on a shell, and it already carries the fitting's own glyph -
   a flange there would be a second mark on the same joint.

   Runs arrive square to a face (route(), layout.js), so the last leg is
   axis-aligned and the flange only ever needs the two orientations. */
/* WHERE a run's nozzles go, and which way each one faces - pure, so the
   auditor can sweep it without a canvas. A flange needs a DIRECTION, and a run
   can have none: park the relief tank straight above the pressurizer and the
   header's two ports land on the same point, dedupe() collapses it to a single
   point, and there is no second point to face away from. That crashed the
   whole frame. An end with no direction simply has no nozzle - the run is
   zero-length, so there is no joint to draw anyway. */
function nozzleEnds(r){
  const out=[], n=r.pts.length;
  if(!r.nz || n<2) return out;
  // `end` names WHOSE nozzle this is, so a caller can ask what side of the
  // machine it lands on without re-deriving which end of pts it was
  const add=(p,q,end)=>{
    const dx=q[0]-p[0], dy=q[1]-p[1];
    if(Math.abs(dx)<0.5 && Math.abs(dy)<0.5) return;   // coincident: no facing
    out.push({p, flat:Math.abs(dx)>Math.abs(dy), end});
  };
  if(r.nz[0]) add(r.pts[0],r.pts[1],"a");
  if(r.nz[1]) add(r.pts[n-1],r.pts[n-2],"b");
  return out;
}
/* Across the bore, wider than the casing so the joint reads as sitting IN
   the pipe rather than being the pipe's own outline - the same ratio the old
   two-value table (4 or 5.5, against a casing half of 3 or 4) always kept,
   generalised off pipeWidth() (pipes.js) so a nozzle tracks the run's own
   bore exactly as the pipe it joins does. */
const pipeNozzleHalf = bore => pipeWidth(bore)*1.4;
/* WHICH SIDE OF A MACHINE A NOZZLE IS ON, IN COLOUR. The joint was flat
   C.metal, which is the truth for a vessel that is one node and a lie for a
   pump: its suction and its discharge are different water, and a plant with
   both its loop pipes on one of them drives nothing. So a machine that HAS
   two sides gets two colours and a machine that does not keeps the metal -
   the same rule portPath() states once for the click. Nothing is added to
   the picture; the joint already drawn is the port. */
/* NOT amber: amber IS the selection, and a nozzle wearing it reads as picked
   rather than as a side. Not red either - a side is not an alarm. Cyan and
   green are the two live inks left, and neither is the cold leg's own blue,
   so a port never disappears into the pipe on it. */
const portCol=(p,f)=>{ const IN=portPath(p,f);
  return !IN ? C.metal : IN.a===f ? C.cyan : C.green; };
// THE JOINT ITSELF - a small flanged rectangle standing proud of the shell,
// its long axis across the bore and its short axis the direction it faces.
// Shared by a piped run's own end (pipeNozzles()) and a bare port with
// nothing piped to it yet (drawPortMarks()) - a port IS this mark, piped or
// not, so a fresh one reads as placed the instant it exists.
function drawNozzle(px,py,flat,bore,col){
  const half=pipeNozzleHalf(bore), deep=2.5;   // how far it stands proud of the shell
  const bx=flat?deep:half, by=flat?half:deep;
  fillRect(px-bx-1,py-by-1,2*bx+2,2*by+2,PIPE_CASE);
  fillRect(px-bx,py-by,2*bx,2*by,col);
}
function pipeNozzles(NET){
  for(const r of NET){
    for(const e of nozzleEnds(r)){
      drawNozzle(e.p[0],e.p[1],e.flat,runBore(r),
        portCol(e.end==="a"?r.a:r.b, e.end==="a"?r.sa:r.sb));
    }
  }
}
// ART EXEMPT: the id if/else chain below draws each part's own glyph - what
// a component LOOKS like, never a network decision - so it is exempt from
// the no-unlabelled-kind-read scan (tools/audit-geometry.js) by name, not
// because the scanner's regex happens not to reach `p.id`.
function drawSym(p,x,y,w,h,ink,L){
  const cx=x+w/2, X=x+5, Y=y+5, W=w-10, Hh=h-10;
  const shell=fn=>{ ctx.beginPath(); fn(); ctx.fillStyle=C.panel; ctx.fill();
    ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke(); };
  const lvl=(fx,fy,fw,fh,frac,col)=>{ const t=clamp(frac,0,1);
    ctx.save(); ctx.globalAlpha=.45; fillRect(fx,fy+fh*(1-t),fw,fh*t,col); ctx.restore(); };
  /* ══ A TANK IS A SHELL WITH WATER IN IT, AND THERE IS ONE OF THEM ══
     EVERY tank draws through this, however many there are: shell, water CLIPPED to
     that shell, a waterline, and the gas space above it left empty. Written
     once because the two were drifting apart in opposite directions - the HPI
     tank drew a square fill inside a rounded shell, so the water leaked past
     its own border at the corners AND was pinned at a hard-coded full whatever
     the tank had left, and the relief tank had no branch at all and came out
     of the fallback as a hatched box with no level in it. */
  const tank=(bx,by,bw,bh,rad,frac,col)=>{
    const path=()=>{ ctx.beginPath(); rr(bx,by,bw,bh,rad); };
    path(); ctx.fillStyle=C.panel; ctx.fill();
    const t=clamp(frac,0,1);
    if(t>0.001){
      const wy=by+bh*(1-t);
      ctx.save(); path(); ctx.clip();
      ctx.globalAlpha=.45; fillRect(bx,wy,bw,bh*t,col); ctx.globalAlpha=1;
      fillRect(bx,wy-0.6,bw,1.2,col);                    // the surface itself
      ctx.restore();
    }
    path(); ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
  };
  const id=p.id;
  if(id==="core"){
    shell(()=>{ ctx.moveTo(X,Y+10); ctx.quadraticCurveTo(cx,Y-6,X+W,Y+10);
      ctx.lineTo(X+W,Y+Hh-10); ctx.quadraticCurveTo(cx,Y+Hh+6,X,Y+Hh-10); ctx.closePath(); });
    const bx=X+7,by=Y+22,bw=W-14,bh=Hh-42;
    fillRect(bx,by,bw,bh,C.well);
    if(L) lvl(bx,by,bw,bh,clamp((L.inv-88)/12,0,1),L.dnbr<1.3?C.red:C.blue);
    else  lvl(bx,by,bw,bh,1,C.blue);
    if(L&&L.melt){ ctx.globalAlpha=.55+.4*Math.abs(Math.sin(fxClock()/0.3));
      fillRect(bx,by+bh*.62,bw,bh*.38,"#ff5a45"); ctx.globalAlpha=1; }
    if(L&&L.dmg>0.1) hatch(bx,by,bw,bh,C.red,clamp(.2+L.dmg/140,.2,.85));
    frame(bx,by,bw,bh,ink);
    coreDraw(bx+2,by+2,bw-4,bh-4,coreView(L));
    /* steam the core is actually making, normalised on the SAME 0..0.6 the VOID
       readout's band uses - so "the vessel is full of bubbles" and "the strip
       says BOILING" can never be two different statements. "chan": it rises in
       the channel lattice, not a kettle */
    if(L) fxBubbles(bx+1,by+1,bw-2,bh-2,fxEase(id+":boil",clamp(L.vf/.6,0,1)),C.bright,"chan");
    // DNBR under 1.00 is fuel being damaged right now, not a warning about
    // later. The melt flicker already owns the end state, so this stands down
    // once that takes over rather than beating against it.
    if(L) fxPulse(bx,by,bw,bh,C.red,fxEase(id+":dnb",L.dnbr<1&&!L.melt?1:0),1.6);
    /* A burst vessel blows its inventory into the compartment. Deliberately
       unclipped and wider than the valve's plume: this one is not a relief
       path working, it is the boundary gone.
       Driven by THIS opening's own solved outflow, not by the s.breach flag -
       a pinhole and a guillotine used to look identical, and both went on
       blowing at full rate long after the loop had equalised with
       containment. It now starts, scales and STOPS with the thing it depicts,
       because it is reading the thing it depicts. */
    if(L) fxSteam(cx,Y+6,W*.6,
      fxEase(id+":breach",clamp((L.spillBy["break:core"]||0)/SPILL_FULL,0,1)),"#ffd0c4",31);
    /* THE LATCHED TRIP, SAID ON THE COMPONENT IT IS ABOUT. The rod drives shout
       it too, but the eye goes to the reactor, and a scrammed core used to look
       exactly like a running one apart from four stems sitting low. */
    // BREACHED beats SCRAM: once the boundary is open the trip is no longer the
    // news, and the run is over whatever the rods are doing
    if(L&&(L.breach||L.scrammed))
      banner(L.breach?"BREACHED":"SCRAM",cx,bx-2,by-2,bw+4,bh+4,C.red);
  } else if(id==="rods"){
    shell(()=>ctx.rect(X+8,Y+2,W-16,Hh-10));
    /* the DRIVE MECHANISMS, not the rods. Where each bank stands is already
       drawn - to scale, on the flux - in the core field on the reactor, and a
       second set of stems here said the same thing again in a box that has no
       core in it. What this component owns is whether the drives ANSWER. */
    const nb = L&&L.rodZ? P.NB : 5;
    /* CENTRED, and packed no wider than a drive needs. The group used to start
       at X+12 and step by (W-24)/nb, which leaves a whole slot of empty plinth
       on the right - the row read as sitting off to one side of its own box. */
    const DW=5, step=Math.min((W-24)/nb, DW*3), x0=cx-nb*step/2+(step-DW)/2;
    const jam = L&&L.rodJam, scram = L&&L.scrammed;
    const hcol = jam?"#8a7a4a" : scram?C.red : "#b9cdd2";
    const ht=Math.max(4,Hh-16), hy=Y+6;
    // where the nut sits for an insertion 0..1: the top of the screw is a bank
    // fully OUT, the foot of it a bank fully IN, which is the way the drawing
    // already runs and the way the core field beside it already reads
    const at=v=>hy+3+clamp(v,0,1)*Math.max(0,ht-8);
    for(let i=0;i<nb;i++){ const sx=Math.round(x0+i*step);
      fillRect(sx,hy,DW,ht,C.well);                // the housing the lead screw runs in
      fillRect(sx,hy,DW,3,hcol);                   // the motor on top of it
      fillRect(sx+1,hy+ht-2,3,2,hcol);             // the gearbox at its foot
      const z = L? (L.rodZ?L.rodZ[i]:L.rodPos) : 0.2;
      const d = L? (L.rodZDem?L.rodZDem[i]:L.rodDem) : 0.2;
      /* the stretch of screw still to run, so a walking drive says HOW FAR it
         has to go and not merely that it is moving */
      if(L&&!jam&&!scram&&Math.abs(d-z)>.002){
        const a=Math.min(at(z),at(d)), b=Math.max(at(z),at(d));
        fillRect(sx+1,a,3,Math.max(1,b-a),"rgba(240,168,48,.5)");
      }
      /* THE NUT ON THE LEAD SCREW - how far this drive has run its own bank in.
         The core field says where the absorber is; this says where the MACHINE
         that put it there has got to, which is the reading that survives a jam,
         and it is what makes a row of stems mean anything at a glance. */
      fillRect(sx-1,Math.round(at(z)),DW+2,2,hcol);
    }
    fxSparks(X+8,Y+2,W-16,Math.max(4,Hh-10),fxEase(id+":jam",jam?1:0),C.red);
    /* JAMMED wins over SCRAM: a jammed bank while a trip is latched is a scram
       that did not happen, which is worse news than the trip itself. Pinned
       near the TOP of the frame rather than its default vertical centre: a
       jammed bank came from a hit on the drives, and the generic REPAIR key
       every damaged component draws (below, in this same loop) is centred
       in this same box - two labels sharing one centre is a guaranteed
       overlap the moment both are true at once. */
    if(jam||scram)
      banner(jam?"JAMMED":"SCRAM",cx,X+7,Y+1,W-14,Math.max(8,Hh-8),C.red,Y+9);
  } else if(id==="pzr"){
    shell(()=>rr(X,Y+8,W,Hh-8,W/2.6));
    ctx.save(); ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.clip();
    lvl(X,Y+8,W,Hh-8, L? L.lvl/100 : .54, C.blue); ctx.restore();
    ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
    /* No bowtie here, and no plume either. A relief valve is a FITTING now,
       with a tap of its own and a glyph drawn at it (pipeFitMarks()) - the
       stock one sits on the hot leg, not on this shell. Drawing a second copy
       on the mimic put the same valve on screen twice, in the corner that
       already carries the tank, its label, its level and this vessel's own
       pressure dial. It also lied on a plant with no relief path left at all.
       The plume went with it for the same reason it was drawn in the first
       place: it is the RELIEF FLOW readout drawn instead of typed, and a
       readout belongs on the instrument it is about. On this shell it said a
       valve somewhere was passing something, while the valve itself sat
       elsewhere on the drawing doing nothing visible - and with two relief
       valves fitted it could only ever depict one of them. It is drawn at each
       valve's own tap now, off that valve's own rate (pipeFitMarks()). */
  } else if(id.startsWith("sg")){
    shell(()=>{ ctx.moveTo(X,Y+12); ctx.quadraticCurveTo(cx,Y-4,X+W,Y+12);
      ctx.lineTo(X+W,Y+Hh); ctx.lineTo(X,Y+Hh); ctx.closePath(); });
    ctx.save(); ctx.beginPath(); ctx.rect(X,Y+12,W,Hh-12); ctx.clip();
    lvl(X,Y+12,W,Hh-12, L? sgLvl(L,id)/100 : .5, C.blue); ctx.restore();
    ctx.beginPath(); ctx.moveTo(X+7,Y+Hh-4); ctx.lineTo(X+7,Y+Hh*.4);
    ctx.quadraticCurveTo(cx,Y+Hh*.18,X+W-7,Y+Hh*.4); ctx.lineTo(X+W-7,Y+Hh-4);
    ctx.strokeStyle=ink; ctx.lineWidth=1.6; ctx.stroke();
    if(L){
      // it is a kettle: how hard it boils is the heat actually crossing into it,
      // which is the lower of what the core makes and what the turbine will
      // take - and a kettle only boils while there is water left in it
      const wet=clamp(sgLvl(L,id)/25,0,1);
      fxBubbles(X+2,Y+14,W-4,Hh-16,fxEase(id+":boil",clamp(Math.min(L.n,L.load),0,1)*wet),C.bright,"pool");
      /* boiling dry, on the same 25% the SG LEVEL band calls LOW. This is the
         core losing its heat sink, and it had no picture at all - the level
         fill alone drops quietly and says nothing about what that costs. */
      fxPulse(X+2,Y+14,W-4,Hh-16,C.amber,fxEase(id+":dry",sgLvl(L,id)<25?1-wet*.7:0),1.5);
      /* ruptured tubes: primary water crossing into the secondary side, which
         is activity going straight past containment. Drawn rising off the
         bundle itself, where the leak is - and on THIS generator's own solved
         leak, so the fault stays on the machine that was hit and slows as the
         primary comes down to the secondary, stopping at equalisation. It was
         a latch drawn on every generator in the row at one rate forever. */
      const sgtrQ = (L.sgtrBy && L.sgtrBy["sgtr:"+id]) || 0;
      fxJet(cx,Y+Hh*.42,W*.45,fxEase(id+":sgtr",clamp(sgtrQ/SGTR_RATE,0,1)),C.red,0,-1,53);
      /* RUPTURED wins over DRYING: a dry generator is a heat sink you can feed
         back, a ruptured one is primary water leaving past containment. */
      // sat high, in the steam space: the middle of a generator is where the
      // flow gauge on its own steam line lands
      const ruptured = sgtrLive(L, id);
      if(ruptured||sgLvl(L,id)<25)
        banner(ruptured?"RUPTURED":"DRYING",cx,X+1,Y+11,W-2,Hh-12,
               ruptured?C.red:C.amber, midBase(Y+13,(Hh-12)*.36,9));
    }
  } else if(roleHead(p.role)){
    const r=Math.min(W,Hh)/2-1, cy=y+h/2;
    shell(()=>ctx.arc(cx,cy,r,0,7));
    ctx.save(); ctx.translate(cx,cy); if(L) ctx.rotate(L.spin*Math.PI/180);
    ctx.beginPath(); ctx.moveTo(-r*.45,-r*.55); ctx.lineTo(r*.7,0); ctx.lineTo(-r*.45,r*.55);
    ctx.closePath(); ctx.fillStyle=ink; ctx.fill(); ctx.restore();
    if(L&&L.cav>.15){ ctx.beginPath(); ctx.arc(cx,cy,r+3,0,7); ctx.strokeStyle=C.amber;
      ctx.lineWidth=1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); }
    // vapour flashing at the inlet, small and violent, not a kettle - on the same
    // 0..0.6 the CAVITATION readout's band uses
    if(L) fxBubbles(cx-r,cy-r,r*2,r*2,fxEase(id+":cav",clamp(L.cav/.6,0,1)),C.amber,"chan");
  } else if(p.role==="turb"){
    shell(()=>{ ctx.moveTo(X,Y+3); ctx.lineTo(X+W,Y-2); ctx.lineTo(X+W,Y+Hh+2);
      ctx.lineTo(X,Y+Hh-3); ctx.closePath(); });
    /* Drawn FROM THE FRONT, like the pump - a ring of fixed stator vanes with
       the rotor turning inside it. The rest of the diagram is a longitudinal
       section, but a turbine seen edge-on is a box with lines in it, and the
       one thing worth seeing on this machine is that it turns. The vanes lean
       one way and the rotor blades the other, which is what stops a ring of
       spokes reading as a bicycle wheel.
       The angle is s.spinT, integrated in the tick off LOAD - so it stops dead
       with a paused sim, slows as the turbine sheds load, and a recording
       replays the same shaft. */
    const cyT=y+h/2, rT=Math.max(6,Math.min(W,Hh)/2-1);
    fillRect(X,cyT-1,W,2,"rgba(140,170,178,.45)");            // the shaft, through
    shell(()=>ctx.arc(cx,cyT,rT,0,7));
    // the stator is a short ring of vanes tucked against the casing; the rotor
    // is the long, heavy part, and it should own the middle of the machine
    const r0=rT*.70, r1=rT*.94;
    ctx.save(); ctx.strokeStyle="rgba(140,170,178,.55)"; ctx.lineWidth=1;
    for(let i=0;i<10;i++){ const a=i*.6283;                    // STATOR - fixed
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*r0,cyT+Math.sin(a)*r0);
      ctx.lineTo(cx+Math.cos(a+.26)*r1,cyT+Math.sin(a+.26)*r1);
      ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.translate(cx,cyT); ctx.rotate((L?L.spinT:0)*Math.PI/180);
    ctx.strokeStyle=ink; ctx.lineWidth=2.2; ctx.lineCap="round"; // ROTOR - turns
    for(let i=0;i<6;i++){ const a=i*1.0472;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*rT*.14,Math.sin(a)*rT*.14);
      ctx.lineTo(Math.cos(a-.5)*rT*.64,Math.sin(a-.5)*rT*.64);
      ctx.stroke(); }
    ctx.restore();
    dot(cx-2,cyT-2,4,ink);                                     // the hub
  } else if(p.role==="cond"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    for(let i=1;i<7;i++) fillRect(X+i*(W/7),Y+5,1,Hh-10,"rgba(140,170,178,.45)");
    /* it CONDENSES: steam meets cold tubes and falls off them as water, into
       the hotwell at the bottom. So the effect runs DOWNWARD - drawing it as a
       rising plume said the opposite of what this machine is for. Rate is the
       heat it is actually rejecting, and it is clipped inside the shell,
       because a condenser that vented to the compartment would be a leak. */
    /* THE HOTWELL: condensate in from the tubes above, feed suction out to
       the generators. It is a TANK like any other now - it simply has no cell
       of its own, so the machine it lives inside draws it (hostedTankIds(),
       pipenet.js). Two hosted tanks pool and draw as one. Full is half the
       shell, so a rupture filling it is visible without swallowing the tube
       bank the jet is drawn against. */
    const hosted=hostedTankIds();
    const hwPct = L ? tankPoolPct(L,hosted)
                    : (hosted.length ? D.tanks[hosted[0]].level : 0);
    const hw=Math.max(3,Hh*.5*clamp(hwPct/100,0,1));
    ctx.save(); ctx.globalAlpha=.45;
    fillRect(X+1,Y+Hh-2-hw,W-2,hw,C.blue); ctx.restore();
    if(L){ ctx.save(); ctx.beginPath(); ctx.rect(X,Y+2,W,Hh-4-hw); ctx.clip();
      fxJet(cx,Y+6,W*.62,fxEase(id+":cond",clamp(Math.min(L.n,L.load),0,1)*.8),"rgba(150,195,225,.95)",0,1,23);
      ctx.restore(); }
  } else if(id==="ctrl"){
    shell(()=>{ ctx.moveTo(X,Y+Hh); ctx.lineTo(X,Y+6); ctx.lineTo(X+W,Y+2);
      ctx.lineTo(X+W,Y+Hh); ctx.closePath(); });
    /* main power gone drops this room to emergency lighting. It is the one
       component whose whole job is that somebody is still in there watching,
       so a blackout should be visible HERE and not only on the supply. */
    const dark = L && L.blackout;
    for(let i=0;i<3;i++) fillRect(X+6+i*((W-12)/3),Y+9,(W-18)/3,4,
      dark?"rgba(255,90,69,.40)":"rgba(95,210,226,.45)");
    fxPulse(X+2,Y+4,W-4,Hh-8,C.red,fxEase(id+":dark",dark?1:0),0.7);
  } else if(id==="cont"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4)); hatch(X+1,Y+3,W-2,Hh-6,ink,.35);
    /* activity already past the barrier, on the 0..10% the RELEASE band uses.
       It leaves the box on purpose: a release is the one thing on this plant
       that does not stay inside the component it came from. */
    if(L) fxSteam(cx,Y+2,W*.7,fxEase(id+":rel",clamp(L.release/10,0,1)),C.amber,91);
  } else if(p.role==="fitting"){
    /* ONE BRANCH FOR EVERY FITTING, and the symbol is the whole of it. The
       glyph used to be drawn on the pipe at the fitting's own tap, because a
       fitting had no box; it has one now, so it draws where every other
       machine draws and "a fitting's glyph survives commissioning" holds BY
       CONSTRUCTION rather than by a per-mode branch remembering to.
       reliefBowtie() is the live state (shut / passing / blocked) and
       fitGlyph() the bare shape the bench shows - one drawing either way. */
    const mode=fitModeOf(id);
    if(mode==="relief" && L) reliefBowtie(cx,y+h/2,16,11,L,id);
    else fitGlyph(cx,y+h/2,16,11,mode,ink);
    /* WHAT THIS VALVE IS PASSING, drawn instead of typed, at the valve, and
       judged against this fitting's OWN fully-open rate (reliefFullRate(),
       pipenet.js) so the plume can never show a rate the sim is not
       performing. Per fitting, so two relief valves are two plumes.
       IT IS DRAWN WHETHER OR NOT THE VALVE IS PIPED, deliberately: this
       depicts what the VALVE is passing, not what reaches the room. Where the
       discharge goes is a separate question the tick asks separately
       (net.fitTarget, step.js). Gating the plume on that was tried and is
       wrong - audit-text.js pins the plume against the tick's own vent term
       AND pins that it shrinks as the receiving tank fills on back pressure,
       both of which are claims about a valve that IS piped. */
    if(L && mode==="relief")
      fxSteam(cx,y+4,W*.7,fxEase(id+":porv",
        clamp(reliefRate(L,id)/Math.max(1e-9,reliefFullRate(L,id)),0,1)),"#cfe6ea");
  } else if(p.role==="tank"){
    /* ONE BRANCH FOR EVERY TANK. What is LEFT in it, not a full tank forever -
       a tank that has finished injecting is empty, and drawing it brimming is
       the one picture that says the mechanic is over.
       A SOURCE IS ALARMING WHEN IT IS EMPTY AND A SINK WHEN IT IS FULL, and
       which of the two this is is STRUCTURAL, never a name: the only thing
       that can fill against its own will is a PRIMARY tank with no
       non-return valve on its edge - that is what a vent header discharges
       into. Everything else is something you draw on, and full is good news.
       Get it backwards and a healthy full accumulator is painted in the same
       red as a relief tank about to burst. */
    const lv = L ? tankLvl(L,id) : D.tanks[id].level;
    const rate = L ? ((L.tankRate&&L.tankRate[id])||0) : 0;
    const src = !(tankSide(id)==="primary" && !D.tanks[id].check);
    tank(X,Y+2,W,Hh-4,6, lv/100,
      rate>0 ? C.cyan
      : src ? (lv<=15 ? C.red : lv<50 ? C.amber : C.blue)
            : (lv>=90 ? C.red : lv>0  ? C.amber : C.blue));
    /* Cold water going down the line. The safe act with the long bill, and
       worth seeing that it is still running - every second of it ages the
       vessel whether or not anybody is looking at FATIGUE. On what the tank is
       ACTUALLY pushing against its own rating, never on the operator's switch:
       injection is a solved flow, and a tank at 4.5 MPa against a loop at 15.5
       delivers exactly nothing. */
    if(L) fxJet(cx,Y+Hh-3,W*.35,
      fxEase(id+":inj",clamp(rate/tankRateRef(id),0,1)),C.cyan,0,1,71);
    /* the rupture disc, which is what the gas space above the water is FOR.
       Burst, the tank is an opening to containment and its contents are on the
       floor - so it stops being a tank and says so. */
    if(L&&L.burstBy&&L.burstBy[id]) hatch(X+1,Y+3,W-2,Hh-6,C.red,.55);
  } else if(id==="bkp"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    fillRect(X+4,Y+6,W-8,3,ink);
    /* how much pump flow this set can turn, as cells - the CAPACITY readout was
       the only place it was stated, and a supply that can carry half the pumps
       looked identical on the mimic to one that can carry all of them */
    const cap = L? P.backup : BKP[D.bkp].bk;
    const dead = L && (L.bkpLost || !autoLive("bkp"));
    const bx2=X+4, by2=Y+Hh-13, bw2=W-8, n=6, cw2=bw2/n;
    for(let i=0;i<n;i++){
      const lit=(i+.5)/n<=clamp(cap,0,1);
      fillRect(bx2+i*cw2,by2,cw2-1.4,5, !lit?C.well : dead?"#3a1a14" : C.green);
    }
    // carrying the pumps right now, not merely able to
    if(L) fxPulse(bx2,by2,bw2,5,C.green,fxEase(id+":bkp",L.blackout&&!dead&&cap>0?1:0),1.4);
  } else {
    shell(()=>ctx.rect(X,Y+2,W,Hh-4)); hatch(X+1,Y+3,W-2,Hh-6,"#6d8f98",.5);
  }
}

const CORE_DIA_REF=2.9, CORE_HGT_REF=3.1, CORE_MIN=0.3;
// NONE draws nothing; the other three borrow tones already meaning the right
// thing elsewhere - steel is the rod-stem grey, graphite the follower brown,
// beryllium the pale one left
const REFLC=[null,C.metal,C.ink,C.graph];
function coreDraw(x,y,w,h,V){
  if(w<=0||h<=0) return;
  const fw=w*clamp(V.dia/CORE_DIA_REF,CORE_MIN,1);
  const fh=h*clamp(V.hgt/CORE_HGT_REF,CORE_MIN,1);
  const fx=x+(w-fw)/2, fy=y+(h-fh)/2, col=REFLC[V.reflMat];
  if(col){
    const rc=fw/2/XNR, zc=fh/XNZ;        // one ring across, one level up
    const br=V.reflR*rc, bt=V.reflT*zc, bb=V.reflB*zc;
    ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); ctx.globalAlpha=.3;
    if(br>0){ fillRect(fx-br,fy-bt,br,fh+bt+bb,col);
              fillRect(fx+fw,fy-bt,br,fh+bt+bb,col); }
    if(bt>0) fillRect(fx,fy-bt,fw,bt,col);
    if(bb>0) fillRect(fx,fy+fh,fw,bb,col);
    ctx.restore();
  }
  coreField(fx,fy,fw,fh,V);
}

function coreField(x,y,w,h,V){
  // a negative box must not throw - this runs inside the frame loop and one
  // bad frame takes the whole plant with it
  if(w<=0||h<=0) return;
  const NC=XNR*2-1, cw=w/NC, ch=h/XNZ, rMax=Math.max(0,Math.min(cw,ch)*0.44);
  for(let c=0;c<NC;c++){
    const i=Math.abs(c-(XNR-1));
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), cx=x+(c+.5)*cw, cy=y+h-(j+.5)*ch;   // level 0 at the bottom
      if(V.xX){ const a=clamp(V.xX[k]/Math.max(V.X0,1e-9)*.34,0,.6);
        if(a>.02){ ctx.globalAlpha=a; fillRect(cx-cw/2,cy-ch/2,cw,ch,C.xe); ctx.globalAlpha=1; } }
      const t=V.nTf? clamp((V.nTf[k]-V.TfRef)/620,0,1) : 0;
      const col=t<.5? lerpC(C.cyan,C.amber,t*2) : lerpC(C.amber,C.red,(t-.5)*2);
      let r=rMax*Math.sqrt(clamp(V.phi[k]/2.6,.03,1));
      // the one animation in here: a node in film boiling is not steady
      if(t>.85) r*=.72+.28*Math.abs(Math.sin(fxClock()/0.09));
      // dot fades with how much fuel is actually in this ring, so a hole you
      // drew stays a hole rather than painting as a smaller full node
      const ff=V.frac? clamp(V.frac[i],0,1) : 1;
      if(ff<.985){ ctx.globalAlpha=.12+.88*ff;
        if(ff<.3) fillRect(cx-1,cy-1,2,2,"#1b2c33"); }   // an empty slot, as in the plan
      ctx.beginPath(); ctx.arc(cx,cy,r,0,7);
      if(V.nV && V.nV[k]>.12){ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.7,r*.55); ctx.stroke(); }
      else { ctx.fillStyle=col; ctx.fill(); }
      ctx.globalAlpha=1;
      // drawn bright rather than red: colour already means margin, and a mark
      // that changed colour with the thing it marks would say it twice
      if(V.peak && i===V.peak.i && j===V.peak.j){
        ctx.beginPath(); ctx.arc(cx,cy,Math.max(r+1.6,rMax*.85),0,7);
        ctx.strokeStyle=C.bright; ctx.lineWidth=.8; ctx.globalAlpha=.75;
        ctx.stroke(); ctx.globalAlpha=1;
      }
    }
  }
  for(let b=0;b<V.NB;b++){
    const ins=V.rodZ? clamp(V.rodZ[b],0,1) : .35, tip=XNZ*(1-ins);
    for(const sg of [-1,1]){
      const cx=x+((XNR-1)+sg*V.bankR[b]+.5)*cw, yTip=y+h-tip*ch;
      if(yTip>y) fillRect(cx-.9,y,1.8,yTip-y,C.metal);              // absorber
      const yF=Math.min(y+h,yTip+V.tipLen*ch);
      if(V.tipLen>0 && yF>yTip)                                     // follower
        frame(cx-1.5,yTip,3,yF-yTip,V.tipRho>0?C.graph:C.rail);
    }
  }
}

// maxw is optional: given, the tag steps DOWN the type ladder to fit it, through
// the same fitStep() fitTxt uses. A component name may overrun its own box (the
// grid clamp below keeps it on the page); a banner sat across a narrow symbol
// may not, or it reads as belonging to the component next door.
function tag(s,cx,base,size,sp,col,maxw){
  const o={size,sp};
  if(maxw) o.size=fitStep(s,maxw,o);
  const w=tw(s,o), Lx=GX+2, Rx=GX+GW*CELL-2;
  cx=clamp(cx,Lx+w/2,Rx-w/2);
  // sized from cap height, not the em, or it sat low and left a gap over the letters
  const c=capH(o.size);
  fillRect(cx-w/2-3,base-c-2,w+6,c+5,"rgba(6,10,11,.88)");
  txt(s,cx,base,{size:o.size,sp,align:"center",color:col});
}

/* THE component banner: one latched fault, said across the middle of the symbol
   on its own plate, with a frame round the box it belongs to. STILL, never
   flashing - every one of these is a state that sits there until somebody
   clears it, and a permanent flash only teaches the eye to skip it.
   Every component with a fault to announce comes through here, so the fifth one
   cannot quietly invent a fifth look. */
function banner(word,cx,x,y,w,h,col,ty){
  frame(x,y,w,h,col);
  const mw=w-4;
  /* letter spacing is the first thing to go. The ladder has a floor, so a
     wide-tracked word on a narrow symbol steps all the way down to 6px and
     STILL overruns - which is how RUPTURED came to sit on a pipe gauge two
     cells away. Track it tight first, then shrink. */
  const sp = tw(word,{size:9,sp:2})<=mw ? 2 : .3;
  // ty lets a caller lift the word off something already drawn across the
  // middle of its box; the frame is unaffected
  tag(word,cx,ty!=null?ty:midBase(y,h,9),9,sp,col,mw);
}

/* What the pressurizer's OWN (primary) relief valve is passing, off the
   SOLVED edge flow (reliefRate(), pipenet.js) - the mimic draws one plume
   for one valve, the same scope primaryRelief() gives every other legacy
   control (step.js). reliefRate() is the one reader outside the tick: the
   plume and the RELIEF FLOW readout both call it, so neither can describe a
   vent the sim is not performing. Unlike the old porvRateOf() this does not
   gate on !s.breach - a breached plant's open, passing relief valve reads
   whatever the solve actually gives it, not a forced zero. */
const porvRate = s => { const fid=primaryRelief(); return fid ? reliefRate(s,fid) : 0; };

function liveValue(p,s){
  const H_=s.Tavg+15*(s.n*.935+s.decay);
  switch(true){
    case p.id==="core":  return (s.n*100).toFixed(0)+"%";
    case p.id==="rods":  return (s.rodPos*100).toFixed(0)+"%";
    case p.id==="pzr":   return s.P.toFixed(1)+" MPa";
    case p.id.startsWith("sg"):   return sgLvl(s,p.id).toFixed(0)+"%";
    case roleHead(p.role): return (flowOf(s,p.id)*100).toFixed(0)+"%";
    case p.role==="turb": return mwE(s).toFixed(0)+" MWe";
    case p.role==="cond": return tankPoolPct(s,hostedTankIds()).toFixed(0)+"%";
    case p.id==="bkp":   return s.blackout?"LOAD":"rdy";
    case p.id==="cont":  return s.release.toFixed(1)+"%";
    case p.id==="ctrl":  return s.dose.toFixed(0)+"%";
    /* ONE ROW FOR EVERY TANK. A burst disc first, because a tank that is an
       opening to containment is not reporting a level any more. */
    case p.role==="tank": return s.burstBy[p.id] ? "BURST" : tankLvl(s,p.id).toFixed(0)+"%";
    default: return null;
  }
}

function liveColor(p,s){
  switch(true){
    case p.id==="pzr": return pColor(s.P);
    // an undersized condenser quietly takes output back off you; say so on
    // the diagram, or the only place it shows is an inspector nobody opened
    case p.role==="turb": return condPen(s)<0.98 ? C.amber : C.cyan;
    default: return C.cyan;
  }
}

// mirrors commission()'s formula (step.js) because ctlFor() is also called on
// the bench, before any plant is commissioned and P is still null
const pumpFloor=()=>P? P.flowMin : clamp(0.30+0.15*(totalPumpCap()-sgCount()),0.15,0.75);
const pumpTip=()=>"Primary flow. More flow carries heat away faster and directly buys DNBR margin; less flow heats the fuel and eventually boils the core. The pumps have inertia, so flow follows demand over about "+FLOW_TAU+" s and coasts down over "+FLOW_TAU_COAST+" s if the power goes. The pumps can be stopped completely: the red line on the track is the "+(pumpFloor()*100).toFixed(0)+"% floor the pumps were built for, and the protection system trips on LOW FLOW below it. Defeat the protection and nothing stops you - the core is left on buoyancy alone. The thin amber line is demand, the thumb is what the loop has.";
// rows, not a flat list: a slider sharing 30px with two buttons is 3.3% of
// rod travel per pixel, unusable
/* one press of the boron keys, and the range they work in - the same -6000..0
   the boron slider spans, so a key can never ask for a demand the slider could
   not be dragged to */
const BOR_STEP=200, BOR_LO=-6000, BOR_HI=0;
const borStep=dir=>clamp(S.boronDem-dir*BOR_STEP,BOR_LO,BOR_HI);
/* ONE step for every PERCENTAGE control on a strip - the rod bank and the
   turbine both, so the two keys cannot end up meaning different amounts. It
   lands on the 5% GRID rather than adding 5 to wherever the demand happens to
   sit, so repeated presses give round numbers; the strict floor/ceil is what
   guarantees a press off the grid still moves the way it was pressed. */
const PCT_STEP=5;
/* PCT_EPS is not a tolerance, it is the float grid's own error: 0.55*100 is
   55.00000000000001, so a demand sitting exactly ON a mark reads as a hair
   above it and the strict ceil()-1 hands back the mark it started on - the
   key draws, records an act, and moves nothing. */
const PCT_EPS=1e-9;
function pctStep(cur,dir,lo,hi){
  const g=cur*100/PCT_STEP;
  return clamp((dir>0?Math.floor(g+PCT_EPS)+1:Math.ceil(g-PCT_EPS)-1)*PCT_STEP/100,lo,hi);
}
/* The strip's row PITCH: one key (BTN_H, core/ui.js) plus the 3 px of air
   between two of them. The key's own height is never written here, or the strip
   would go on reserving room for a size the button no longer draws at. */
const CTL_STRIP_GAP=3;
const CTL_H=BTN_H+CTL_STRIP_GAP;
const STRIP_PAD=4;   // plinth inner margin, top and bottom, from one constant so they cannot drift apart
const ROD_TRIP_ROW=[  // shared: GANG and SPLIT both push this SCRAM/RESET row, or two copies drift
  {kind:"btn",flex:1,danger:()=>true,text:()=>"SCRAM",
   fn:()=>{ act("scram"); },
   tip:"SCRAM - drops every bank, split or not, and trips the turbine with it. Always safe, never free: the xenon that follows locks you out for minutes."},
  {kind:"btn",flex:1,on:()=>S.scrammed,text:()=>"RESET",
   fn:()=>{ act("resetTrip"); },
   tip:"TRIP RESET - clears the latch after a scram so the bank answers demand again. With protection armed it refuses while a trip condition is still present. Bypass the RPS and it clears anyway."}];
// live=false asks the DESIGN question (what room will this need once
// commissioned) so the bench can reserve it; nothing in the structure may
// read S in that case, only the closures, which run only while drawing a
// live plant. split is asked separately because stripH() reserves the taller
// of both modes.
/* Every tank's own strip, and it is the same strip for every tank: the
   operator's valve, and its overboard dump. What used to be three separate
   buttons on three different components - HPI's INJECT, the reactor's
   one-shot BORON DUMP and the condenser's HOTWELL DUMP - reading three
   different pieces of state. */
/* TWO ROWS, not three buttons. A tank is one cell wide and three labels
   collide in it - measured, not guessed (audit-text.js counts them). The arm
   switch goes on its own row, and only for a tank that HAS a rule to arm:
   a manual tank has nothing to defeat. */
function tankCtl(id){
  const t=()=>D.tanks[id]||{}, rule=()=>AUTORULE[t().auto];
  const valve=
    {kind:"btn",flex:1,on:()=>S.tankOpen[id],text:()=>S.tankOpen[id]?"OPEN":"SHUT",
     fn:()=>{ act("tankOpen",id); },
     tip:"TANK VALVE - lines this tank up with what it is piped to. It is "
       +(tankSide(id)==="primary"
         ? "a solved flow: full loop pressure against a tank charged below it delivers exactly nothing, and a depressurised loop takes a surge."
         : "drawn on by the feed pumps.")
       +"  Its automatic rule is "+(rule()?rule().label:"none")+", which opens it without you."};
  const dump=
    /* Dumping is only dangerous for a tank you DRAW ON - throwing away water
       something else needs. A sink (a primary tank with no non-return valve,
       which is what a vent header discharges into) is a tank you WANT empty,
       so an empty one lighting up red said the opposite of the truth. */
    {kind:"btn",flex:1,on:()=>S.tankDump[id],
     danger:()=>!(tankSide(id)==="primary" && !t().check) && tankLvl(S,id)<HOT_NPSH,
     text:()=>S.tankDump[id]?"DUMPING":"DUMP",
     fn:()=>{ act("tankDump",id); },
     tip:"TANK DUMP - puts the contents over the side. This is the answer to a ruptured tube filling a hotwell with primary water, which has to go somewhere and must not go back into the generators. It never refuses: open it on a healthy plant and you are throwing away the water the feed pumps live on, and they lose suction under "+HOT_NPSH+"%."};
  /* THE SAME SWITCH a system's bypass row is, so it goes through the same
     armRow() - green ARMED against amber BYPASSED. Drawn as an ordinary key it
     inherited button()'s `on` amber, so a tank whose rule was still armed lit
     up in the colour every other arming switch on the plant uses for DEFEATED,
     and the one that had been bypassed sat dark. */
  const arm=
    {kind:"arm",flex:1,label:()=>rule()?rule().label:"AUTO",on:()=>S.tankByp[id],
     fn:()=>{ act("tankByp",id); },
     title:()=>"TANK AUTO  [ "+(S.tankByp[id]?"BYPASSED":"ARMED")+" ]",
     tip:"AUTO / BYP - whether this tank's own rule ("+(rule()?rule().label:"none")
       +") may line it up without being asked. Bypassed, only the valve beside it does anything. The switch is on the TANK because the rule is the tank's: there is no system elsewhere on the plant that owns it."};
  const hasRule = t().auto && t().auto!=="manual" && t().auto!=="always";
  return hasRule ? [[valve,dump],[arm]] : [[valve,dump]];
}
function ctlFor(p,live,split){
  if(p.role==="tank") return tankCtl(p.id);
  /* ONE LOAD LEVER, on the FIRST turbine. There can be more than one now, and
     load demand is an order to the plant rather than to a machine - the same
     shape the coolant pump lever has, and the same reason: what changed is
     that "the turbine" is no longer a thing there is exactly one of. */
  if(p.role==="turb"){
    if(LAY.parts.find(q=>q.role==="turb")!==p) return null;
    return [
     [{kind:"sld",flex:1,val:()=>S.load*100,min:()=>0,max:()=>P.loadMax*100,dem:()=>S.loadDem*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{ act("loadDem",v/100); },
       tip:"LOAD DEMAND - turbine draw. Raising it cools the loop, and the reactor answers by raising its own power without you touching a rod. The governor valves take about "+LOAD_TAU+" s to stroke, so the thumb trails the thin line. A runback is the exception and slams shut."}],
     // the same 5% bite the rod strip takes, against the same demand the
     // slider writes - a load change is an order given in round numbers
     [{kind:"btn",flex:1,text:()=>"-5%",fn:()=>{ act("loadDem",pctStep(S.loadDem,-1,0,P.loadMax)); },
       tip:"UNLOAD 5% - drops turbine demand five percent, onto the nearest 5% mark. Less draw means less heat leaving the loop, so the primary warms and the reactor backs its own power off."},
      {kind:"btn",flex:1,text:()=>"+5%",fn:()=>{ act("loadDem",pctStep(S.loadDem,1,0,P.loadMax)); },
       tip:"LOAD 5% - raises turbine demand five percent, onto the nearest 5% mark, and never past the turbine's own ceiling. More draw cools the loop and the reactor answers by raising power."}]];
  }
  /* The tanks this machine HOSTS - a tank with no cell has no box of its own
     to carry a strip, so it gets one here, on the component it lives inside.
     One row per hosted tank, so two hotwells are two rows. On the FIRST
     condenser only, for the same reason the load lever is on the first
     turbine: two condensers must not each draw a copy of the same hotwell's
     strip. hostPartOf() (layout.js) is the one answer to "which machine hosts
     a cell-less tank". */
  if(p.role==="cond"){
    if(hostPartOf()!==p) return null;
    const h=hostedTankIds(); if(!h.length) return null;
    const out=[]; for(const id of h) for(const r of tankCtl(id)) out.push(r); return out;
  }

  /* ONE STRIP FOR EVERY PUMP, and what it ADDRESSES is the only difference: a
     coolant pump's lever is the order to ALL of them, the way a real board
     carries one RCP speed demand, and any other pump answers only for itself.
     Both write the same s.flowDemBy through the same ACT table - one
     mechanism, two spans. The floor is a trip setpoint, not a stop, so the
     mark says where it costs rather than where the slider ends. */
  if(roleHead(p.role)){
    const pri = primaryPump(p.id);
    return [[
    {kind:"sld",flex:1,val:()=>(pri?flowPri(S):flowOf(S,p.id))*100,min:()=>0,max:()=>100,
     dem:()=>(pri?flowDemPri(S):(S.flowDemBy[p.id]??1))*100,
     mark:()=>pri?pumpFloor()*100:null,markLo:true,
     fmt:v=>v.toFixed(0)+" %",
     set:v=>{ pri ? act("flowDem",v/100) : act("pumpDem",p.id,v/100); },
     tip:(pri?"COOLANT PUMPS - "+pumpTip()
            :"THIS PUMP ONLY - what it is told to deliver. It answers for itself: a pump that is not in a coolant loop is not part of the coolant order.")}]];
  }
  /* ══ A FITTING'S OWN HANDLES, ON ITS OWN PLINTH ══
     They used to float in the pipe margin on a hand-rolled strip with its own
     width and row count (FITSTRIP_W, fitStripRect()), because a fitting had
     no box to bolt one to. It has one now, so this is an ordinary ctlFor()
     row set and the boxless special case is gone with the three constants
     that served it. A TEE gets nothing at all, and that is the point of a
     tee: a junction has no gate, so there is nothing to work. */
  if(p.role==="fitting"){
    const mode=fitModeOf(p.id);
    if(mode==="tee") return null;
    if(mode==="throttle") return [[
      {kind:"sld",flex:1,val:()=>(S.valve[p.id]??1)*100,min:()=>0,max:()=>100,
       dem:()=>(S.valveDem[p.id]??1)*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{ act("valveDem",p.id,v/100); },
       tip:"THROTTLE - how far this valve stands open. Wide open it costs the line nothing at all; shut, it is a real break in the pipe, the same as a valve shut anywhere else."}]];
    /* One row per handle, and they are NOT side by side: two switches this
       narrow lose their labels before they lose their state, and these two
       are not read at a glance the same way. BLOCK is a COMMAND and stays a
       button; the arm is an arming switch and is drawn by armRow(), the one
       that draws every other arming switch on the plant. */
    return [
     [{kind:"btn",flex:1,danger:()=>!!(S.reliefBlocked&&S.reliefBlocked[p.id]),
       on:()=>!!(S.reliefBlocked&&S.reliefBlocked[p.id]),
       text:()=>(S.reliefBlocked&&S.reliefBlocked[p.id])?"BLOCKED":"BLOCK",
       fn:()=>{ act("porvBlockOf",p.id); },
       tip:"BLOCK VALVE - your last defence against a relief valve that lifts and will not reseat. Shutting it stops the leak and gives this relief path up for the rest of the run."}],
     [{kind:"arm",flex:1,label:()=>AUTOSYS.porv.label,
       on:()=>!porvLive(p.id), fn:()=>{ act("porvByp",p.id); },
       title:()=>AUTOSYS.porv.name+"  [ "+(porvLive(p.id)?"ARMED":"BYPASSED")+" ]",
       tip:"Whether THIS valve may lift by itself at its own setpoint. Bypass it and this one stays shut while every other relief valve goes on working - which is how you defeat one valve without giving up the relief path."}]];
  }
  switch(p.id){
    // GANGED holds exactly three rows, measured against the default plant's grid
    case "rods": {
      // the master control is the same row in both modes - setCommon() in
      // step.js is the only thing that carries it out
      const MASTER=[
       {kind:"sld",flex:1,val:()=>S.rodPos*100,min:()=>0,max:()=>100,dem:()=>S.rodDem*100,
        /* Only while the controller is actually driving: a band drawn for a
           system that is bypassed or was never fitted is two marks describing
           nobody. autoLive() is the one predicate for that. */
        marks:()=>autoLive("rod")?[S.arLo*100,S.arHi*100]:null,
        fmt:v=>v.toFixed(0)+" %",set:v=>{ act("rodCommon",v/100); },
        tip:"CONTROL BANK - moves the whole stack. Ganged that is one bank; split it carries every bank by the same amount, so the spread you set with the per-bank sliders is untouched, and it moves a bank on MANUAL too - MANUAL only means the temperature controller is not driving it. Fast, but it travels at only 1.2%/s, and deep insertion raises power peaking, which eats thermal margin. While a trip is latched the bank stays in whatever you ask of it. The two amber marks are the travel band the automatic controller may move inside; they are drawn only while it is armed, and they never bind you."}];
      /* The same demand the master slider writes, in fixed bites - the boron
         row's argument, for a control that is just as slow to drag: the bank
         travels at 1.2%/s, so a fine adjustment by hand is a fight with the
         gearing. Both keys go through act("rodCommon") like the slider, so a
         recording sees no difference. */
      const STEP=[
       {kind:"btn",flex:1,text:()=>"-5%",fn:()=>{ act("rodCommon",pctStep(S.rodDem,-1,0,1)); },
        tip:"WITHDRAW 5% - takes the whole stack five percent of core height further out, onto the nearest 5% mark. Withdrawing adds reactivity, so power rises until the loop settles."},
       {kind:"btn",flex:1,text:()=>"+5%",fn:()=>{ act("rodCommon",pctStep(S.rodDem,1,0,1)); },
        tip:"INSERT 5% - drives the whole stack five percent of core height further in, onto the nearest 5% mark. Deeper insertion removes reactivity and raises power peaking, which eats thermal margin."}];
      const bankRow=b=>[
       {kind:"btn",flex:1,on:()=>!S.bankAuto[b],text:()=>S.bankAuto[b]?"AUT":"MAN",
        fn:()=>{ act("bankAuto",b); },
        tip:"BANK "+(b+1)+" MODE - hands this bank to the temperature controller, or takes it back. On MANUAL the bank stops answering the controller, but it still answers you: its own slider and the master both still move it. Every bank you take off AUTO leaves the same temperature error to be answered by less rod worth, so the loop does not just move less, it moves slower."},
       {kind:"sld",flex:2.8,val:()=>S.rodZ[b]*100,min:()=>0,max:()=>100,
        dem:()=>S.rodZDem[b]*100,
        fmt:v=>"B"+(b+1)+" "+v.toFixed(0)+" %",set:v=>{ act("rodBank",b,v/100); },
        tip:"BANK "+(b+1)+" - insertion of this bank alone. While the banks are split these per-bank demands are the tilt handle: standing one bank against another is the whole of how you answer a radial xenon tilt here. A bank left on MANUAL is not answering the temperature controller at all, and the fewer banks on AUTO, the less rod worth is left to answer the same error - the loop gets slower, not just smaller."}];
      if(split){
        const rows=[MASTER, STEP, ROD_TRIP_ROW,
         [{kind:"btn",flex:1,on:()=>S.reGang,
          text:()=>S.reGang?"GANGING..":"BANK GANG",
          /* already a no-op once the walk is running: setSplit() refuses to
             re-seed a gang it is in the middle of */
          fn:()=>{ act("split",false); },
          tip:"GANG BANKS - drives every bank back onto one common position and gives the shape back to the tilt slider. It is not a flick of a switch: the banks walk together at drive rate and stay split until they arrive, so a wide spread costs you the seconds it takes to close. The master slider still steers the walk while it runs."}]];
        for(let b=0;b<(live?P.NB:D.nbank);b++) rows.push(bankRow(b));
        return rows;
      }
      return [
       MASTER,
       STEP,
       ROD_TRIP_ROW,
       /* the ganged handle on a radial xenon tilt: it stands the inner banks
          against the outer ones instead of moving the whole bank together */
       [{kind:"sld",flex:2.8,val:()=>S.tilt,min:()=>-1,max:()=>1,dem:()=>S.tiltDem,
         fmt:v=>"TILT "+(v>=0?"+":"")+v.toFixed(2),set:v=>{ act("tiltDem",v); },
         tip:"TILT TRIM - drives the inner banks against the outer ones, up to "+(XTILTZ*100).toFixed(0)+"% of core height apart. Positive pushes the inner banks in and the power out to the ring; negative does the reverse. Full travel takes "+(1/TILT_RATE).toFixed(0)+" s because the drives moving it are the drives that move the bank. It is your tilt handle only while the banks are ganged - split them and each bank's own demand takes over."},
        {kind:"btn",flex:1,text:()=>"SPL",
         fn:()=>{ act("split",true); },
         tip:"SPLIT BANKS - stops driving the banks as one and gives each its own demand. Splitting is bumpless by construction: every bank simply adopts where it already stands. From there the tilt slider stands down, the per-bank sliders are your tilt handle, and any bank you switch to MANUAL stops answering the temperature controller."}]];
    }
    case "core": return [
     /* the scale runs 0 -> -6000, clean water at the LEFT: "+B" adds poison and
        must drive the thumb right, and the -B / RST / +B row must read in the
        direction it moves. A slider() scale is allowed to run either way - see
        the ordered clamp in the drag handler in core/ui.js. */
     [{kind:"sld",flex:1,val:()=>S.boron,min:()=>0,max:()=>-6000,step:10,
       dem:()=>S.boronDem,
       fmt:v=>v.toFixed(0)+" pcm",set:v=>{ act("boronDem",v); },
       tip:"BORON - neutron poison dissolved in the coolant. Genuinely slow: the charging pumps borate at "+BOR_IN+" pcm/s and dilute at only "+BOR_OUT+" pcm/s, so the thin line is what you asked for and the thumb is what the loop has. The only way out of a deep xenon pit."}],
     /* the same demand the slider writes, in fixed bites. A poison you can only
        set by dragging is unusable at 60 pcm/s: the useful orders are "a bit
        more", "a bit less" and "back to clean water", and all three go through
        act("boronDem") like the slider, so a recording sees no difference. */
     [{kind:"btn",flex:1,text:()=>"-B",fn:()=>{ act("boronDem",borStep(-1)); },
       tip:"DILUTE "+BOR_STEP+" PCM - takes one step of boron back out, toward clean water. Dilution runs at only "+BOR_OUT+" pcm/s, so this is about "+(BOR_STEP/BOR_OUT).toFixed(0)+" s of charging every time you press it."},
      {kind:"btn",flex:1,text:()=>"RST",fn:()=>{ act("boronDem",0); },
       tip:"RESET BORON - asks for zero boron: clean water, no poison at all. It does not happen at once - the loop still has to dilute its way there at "+BOR_OUT+" pcm/s, so from a deep pit this is minutes, not seconds."},
      {kind:"btn",flex:1,text:()=>"+B",fn:()=>{ act("boronDem",borStep(1)); },
       tip:"BORATE "+BOR_STEP+" PCM - puts one step more poison in. Boration is the fast direction at "+BOR_IN+" pcm/s, about "+(BOR_STEP/BOR_IN).toFixed(0)+" s a press, and every step you add has to be diluted back out again slowly."}]];
    /* ── replaced by the role branches above ── */
  }
  return null;
}

function stripH(p,live){
  if(!fitted(p)) return 0;
  // reserve the WORST of the modes, never the current one - ganging/splitting
  // must not resize the plant under the operator; unused rows are empty plinth
  const rows=m=>{ const c=ctlFor(p,live,m); return c? c.length : 0; };
  const n=Math.max(rows(false),rows(true)), bh=autoOn(p.id)? CTL_H : 0;
  if(!n && !bh) return 0;   // nothing to mount, nothing to stand on (no plinth)
  return n*CTL_H + bh + STRIP_PAD;
}
function ctlBands(live){
  const b=new Array(GH).fill(0);
  for(const p of LAY.parts){
    const r=p.y+p.h-1;                       // the strip sits in the LAST row it spans
    if(r>=0&&r<GH) b[r]=Math.max(b[r],stripH(p,live));
  }
  return b;
}

/* ONE ARMING SWITCH, TWO HOSTS. A system's bypass row on a component plinth and
   a relief valve's own arm on its strip are the SAME control - a label, a state
   word, and the green/amber/dead palette that says whether something automatic
   is still doing its job. Drawn twice they drift, and the valve's copy is the
   one that ends up looking like a command button instead of an arming switch. */
function armRow(x,y,w,h,o){
  const wd=push({x,y,w,h,type:"btn",fn:o.fn});
  const hv=o.fit&&hov(wd);
  // the SAME fill a sunk key gets, or this reads as a black box cut into the
  // strip instead of another key standing on it
  fillRect(x,y,w,h, btnFill({sunk:1,on:o.lit},hv));
  const col = !o.fit?"#3c4c47" : o.lit?C.amber : C.green;
  const st  = !o.fit?"none" : o.lit?"BYP" : "AUTO";
  const t={size:6.5,sp:.3};
  // a narrow host loses the LABEL before the state (its name is already printed
  // beside it); centred, not stuck to the bottom edge
  const bl=midBase(y,h,6.5);
  if(w >= tw(o.label,t)+tw(st,t)+10){
    txt(o.label,x+3,bl,{size:6.5,sp:.3,color:o.fit?C.ink2:"#3c4c47"});
    txt(st,x+w-3,bl,{size:6.5,sp:.3,align:"right",color:col});
  } else txt(st,x+w/2,bl,{size:6.5,sp:.3,align:"center",color:col});
  TIP(x,y,w,h,o.title,o.tip);
}
function bypRow(k,x,y,w,h){
  const A=AUTOSYS[k], fit=autoFit(k);
  // no `if(fit)` guard: autoToggle() already refuses an unfitted system, so
  // this stays a dead (`none`, no hover) switch rather than a second refusal
  armRow(x,y,w,h,{label:A.label,fit,lit:fit&&S.byp[k],fn:()=>{ act("byp",k); },
    title:A.name+"  [ "+autoState(k)+" ]",
    tip:A.tip+(fit?"":"  None was fitted at the design bench, so there is nothing to arm and nothing to bypass.")});
}

function ctlStrip(list,x,y,w,h){
  const gap=4, tot=list.reduce((a,c)=>a+c.flex,0);
  const span=(w-gap*(list.length-1))/tot;
  let cx=x;
  for(const c of list){
    const cw=span*c.flex;
    const dan = c.danger? c.danger() : false, on = c.on? c.on() : false;
    if(c.kind==="sld"){ // LABEL: a control-strip WIDGET kind (slider vs button), unrelated to a pipe run's kind
      slider(cx,y+h/2,cw,c.val(),c.min(),c.max(),
        {th:h,tw:7,fmt:c.fmt,dem:c.dem?c.dem():null,mark:c.mark?c.mark():null,markLo:c.markLo,
         marks:c.marks?c.marks():null,
         fn:v=>c.set(c.step?Math.round(v/c.step)*c.step:v)});
    } else if(c.kind==="arm"){   // LABEL: the same control-strip WIDGET kind, unrelated to a pipe run's kind
      // armRow() states its own tooltip, so this row skips ctlStrip's below
      armRow(cx,y,cw,h,{label:c.label(),fit:true,lit:on,fn:c.fn,title:c.title(),tip:c.tip});
    } else {
      // a narrow box loses its letter spacing before it loses its label
      button(cx,y,cw,h,c.text(),{danger:dan,on:on,sunk:true,size:6.5,sp:cw<30?0:.5,fn:c.fn});
    }
    if(c.kind!=="arm") TIP(cx,y,cw,h,c.tip.split(" - ")[0],c.tip);   // LABEL: widget kind again, not a run kind
    cx+=cw+gap;
  }
}

// a pipe is steered by grabbing a point it must pass through and dropping it
// elsewhere - the same two-point router just runs twice, so there is no
// freehand drawing and no separate pathfinder to keep in step with it.
// Bench only: where a pipe runs feeds the mass/friction the plant is
// commissioned with, so the control room operates what was built rather than
// reshaping it. Grips are pushed AFTER the components so one lying over a
// vessel is still grabbable (hit test takes the LAST widget pushed).
const WPG=9;                          // the grab box; a grip has to be findable at fit scale
const WPL=9;                          // how close to the line a double-click counts as on it
/* THERE IS ONE KIND OF POINT ON A PIPE. A grip is a waypoint the player set,
   and the way to set one is to double-click the LINE - which is also the
   biggest target on the drawing. The automatic corners used to be pushed as
   grips of their own, so the same idea wore two names, two colours and two
   tooltips, and the grey one marked a point the router owned and would move
   out from under the hand anyway. */
function pipeGrip(pt,rid){
  const wd=push({x:pt.x-WPG/2,y:pt.y-WPG/2,w:WPG,h:WPG,type:"pipewp",rid,pt});
  const hv=hov(wd);
  fillRect(pt.x-2.5,pt.y-2.5,5,5,C.amber);
  if(hv) frame(pt.x-WPG/2,pt.y-WPG/2,WPG,WPG,C.amber);
  TIP(pt.x-WPG/2,pt.y-WPG/2,WPG,WPG,"PIPE WAYPOINT",
    "A corner you put in this run. Drag it to move it, or right-click to take it out - the pipe straightens between the corners on either side.");
}
function pipeGrips(runs){
  for(const r of runs) for(const p of r.wps) pipeGrip(p,r.rid);
}
// pushed with the pipes, UNDER the machines: a run passing behind a vessel
// belongs to the vessel, and a waypoint could not be dropped inside one anyway
function pipeLines(runs){
  for(const r of runs) for(let i=1;i<r.pts.length;i++){
    const [x0,y0]=r.pts[i-1], [x1,y1]=r.pts[i];
    const x=Math.min(x0,x1)-WPL/2, y=Math.min(y0,y1)-WPL/2;
    const w=Math.abs(x1-x0)+WPL, h=Math.abs(y1-y0)+WPL;
    if(w<=WPL&&h<=WPL) continue;                 // a zero-length segment is a corner artefact
    push({x,y,w,h,type:"pipewp",rid:r.rid,pt:null});
    TIP(x,y,w,h,"PIPE ROUTE",
      "Double-click anywhere on this run to add a corner there, then drag it wherever you want the pipe to go.");
  }
}
/* ══ THE GHOST PORT ══
   Hover a component, and the face nearest the hand shows where a NEW port
   would land - a preview of addPort(), never a placement of its own. Not
   drawn while laying a pipe onto somewhere else, or a ghost belonging to the
   machine on the far side of the room would flicker under a hand that is
   really aiming at the FINISH port under discussion. It draws over the box
   it stands on, so it is pushed with the box - see plantPortLayer(). */
const GHOSTG=8;
function ghostPort(){
  if(ui.drag && ui.drag.type!=="lay") return null;
  const ptr = vIn(ui.ptr) ? vPt(ui.ptr) : null; if(!ptr) return null;
  const p = partAt([ptr.x,ptr.y]); if(!p) return null;
  const g = gridPt([ptr.x,ptr.y]), f = faceAt(p,g.x,g.y);
  if(!f) return null;
  return {p,f};
}
function drawGhostPort(){
  const g = ghostPort(); if(!g) return;
  const [x,y]=ghostPortPos(g.p.id,g.f);
  const bx=x-GHOSTG/2, by=y-GHOSTG/2;
  const wd=push({x:bx,y:by,w:GHOSTG,h:GHOSTG,type:"ghostport",p:g.p.id,f:g.f});
  const hv=hov(wd);
  ctx.save(); ctx.globalAlpha=hv?0.9:0.45;
  ctx.strokeStyle=C.green; ctx.lineWidth=1.3; ctx.setLineDash([2,2]);
  ctx.strokeRect(bx,by,GHOSTG,GHOSTG);
  ctx.restore();
  TIP(bx,by,GHOSTG,GHOSTG,"NEW PORT",
    ui.lay ? "Click to place a port here and finish the pipe on it."
           : "Click to place a port here. A port exists with nothing piped to it until you draw a pipe from it.");
}
/* ══ AN EXISTING PORT ══
   One mark PER PORT (never per pipe, never per face) - a port is its own
   object now, so a face carrying two of them draws two marks side by side
   instead of one mark claiming to speak for both. Left click starts laying
   a pipe from here (or finishes one already in flight); right click toggles
   its mode; held-and-released opens the REMOVE PORT / mode menu
   (design-bench.js's own ctx registry). */
function drawPortMarks(){
  // ONE WORD PER (part, face), never one per port sharing it: two ports on
  // one face carrying the same side (both SUCT, say) would otherwise stack
  // an identical label on top of itself, close enough to read as one smear.
  // The box and the press are still drawn per PORT - each is its own place
  // to click - only the text is deduped.
  const seenWord={};
  for(const pid in D.ports){
    const port=D.ports[pid], p=LAY.parts.find(q=>q.id===port.p); if(!p) continue;
    const [x,y]=portPos(pid), bx=x-PORTG/2, by=y-PORTG/2;
    const IN=portPath(p,port.f), col=IN ? (IN.a===port.f?C.cyan:C.green) : C.metal;
    const n=portRunCount(pid);
    // A PIPED PORT'S NOZZLE IS DRAWN BY THE RUN (pipeNozzles()), landing on
    // this exact point. A BARE port has no run to draw it, so it draws its
    // own here - the same mark, not a placeholder for it - which is what
    // makes a fresh port read as placed before any pipe reaches it.
    if(!n) drawNozzle(x,y,port.f==="l"||port.f==="r",1,col);
    const wd=push({x:bx,y:by,w:PORTG,h:PORTG,type:"port",pid});
    const laying = ui.lay && ui.lay.pa===pid;
    if(hov(wd)||laying) fillRect(bx+2,by+2,PORTG-4,PORTG-4,col);
    if(laying) frame(bx,by,PORTG,PORTG,C.amber);
    const word = IN ? (port.m || IN.na) : null;
    const wk=p.id+port.f+word;
    if(word && !seenWord[wk]){ seenWord[wk]=1; txt(word,x+8,y+2.5,{size:6.5,color:col,align:"left",sp:.4}); }
    const nm=partName(p), longWord=IN&&portWord(p,port.f,true);
    TIP(bx,by,PORTG,PORTG, (longWord?longWord+" - ":"")+nm,
      (n? "Carries "+n+" pipe"+(n===1?"":"s")+". " : "Nothing is piped to this port yet. ")+
      (ui.lay ? "Click to finish the pipe here."
       : "Click to draw a pipe from here."+(IN?" Right-click to change which side of "+nm+" this is.":"")));
  }
}
/* ══ LAYING A PIPE ══
   ui.lay = {pa, pts} while a pipe is mid-draw: pa is the port it started
   from, pts the corners placed so far (see ui.js). Drawn as a solid line to
   the last corner and a dashed preview from there to the hand - the same
   "proposal, not a pipe yet" dashing the old box-to-box band used. */
function drawLayPreview(){
  if(!ui.lay) return;
  const ptr = vIn(ui.ptr) ? vPt(ui.ptr) : null; if(!ptr) return;
  const a=portPos(ui.lay.pa), pts=[a].concat(ui.lay.pts.map(w=>[w.x,w.y]));
  ctx.save();
  if(pts.length>1){
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.strokeStyle=C.amber; ctx.lineWidth=1.5; ctx.stroke();
  }
  // the SNAPPED corner a click would actually drop (laySnap(), core/ui.js) -
  // never the raw diagonal to the pointer, or the preview would promise a
  // leg the click cannot draw
  const last=pts[pts.length-1], next=laySnap(last,ptr);
  ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(last[0],last[1]); ctx.lineTo(next.x,next.y);
  ctx.strokeStyle=C.amber; ctx.lineWidth=1.5; ctx.stroke();
  ctx.restore();
}
/* ══ WHERE A DRAGGED MACHINE WOULD LAND ══
   The move half of the gesture had no picture at all: the part stayed drawn in
   the cell it came from and the only sign was its own outline going bright, so
   a drop was aimed blind and a refusal was indistinguishable from a drop the
   browser never delivered. This is the same proposal the pipe band is - dashed,
   because nothing has moved yet - and it asks groupFits(), the one predicate
   moveTo() will ask on release, so green means it WILL land and red means it
   will not. Red is the whole reason a drop is refused: off the grid, or on top
   of another machine. Reads gx/gy and writes nothing. */
function partGhost(){
  const d = ui.drag&&ui.drag.type==="part" ? ui.drag : null;
  if(!d || (d.gx===d.sx && d.gy===d.sy)) return;
  const cells=moveCells(d.part,d.gx,d.gy), ok=groupFits(cells);
  ctx.save(); ctx.setLineDash([4,4]);
  for(const {q,x,y} of cells){ const r=grect(x,y,q.w,q.h);
    fillRect(r.x,r.y,r.w,r.h, ok?"rgba(87,211,140,.10)":"rgba(255,90,69,.10)");
    frame(r.x,r.y,r.w,r.h, ok?C.green:C.red); }
  ctx.restore();
}
// Pushed after the component loop, so a mark wins the hit test over the box
// it sits on. Only where portPath() says there is a side to choose (a pump,
// a generator, a throttle) does a port carry a mode label at all - the
// reactor, the pressurizer, a tee and a tank are one node and wear their
// plain colour with nothing to click FOR beyond starting a pipe.
const PORTG=9;

/* ══ WHAT A FITTING STILL DRAWS ON THE PIPEWORK ══
   Almost nothing, now that it is a component: the box, the symbol, the name
   and the control strip are all the ordinary component loop's job. What is
   left is the two READINGS that belong beside the valve rather than inside
   it - a relief valve's margin to its own lift point, and a throttle's share
   of the loop's head. Both are numbers a box has no room for. */
function pipeFitMarks(L,net){
  if(!L) return;                      // both readings are live figures
  for(const p of LAY.parts){
    if(p.role!=="fitting") continue;
    const id=p.id, mode=fitModeOf(id), r=prect(p), cx=r.x+r.w/2;
    if(mode==="relief"){
      /* HOW FAR PRESSURE STILL HAS TO CLIMB before this valve lifts itself,
         signed, in the units the pressurizer's own gauge reads. A relief
         valve is the one instrument on the plant whose whole job is a
         THRESHOLD, and it was the only one not saying where that threshold
         was. Negative means pressure is past the setpoint: armed, it is
         lifting; bypassed or blocked, that is the number telling you nothing
         is going to. Against THIS valve's own lift point, never a plant-wide
         constant. */
      const marg = P.P0*reliefSet(id).lift - L.P;
      pipeTag(cx, r.y-4, (marg>=0?"+":"")+marg.toFixed(2)+" MPa",
              marg<0?C.red : marg<P.P0*0.02?C.amber : C.ink2);
    } else if(mode==="throttle"){
      /* THE DIFFERENTIAL IS WHAT A THROTTLE IS FOR. Position says what you
         asked for; only the drop says what it cost, and without it the knob
         is one whose effect has to be inferred from a flow meter three
         components away. Off the solve's own node heads (netDrops()), as a
         share of the whole loop's head, so it is comparable between a long
         leg and a short one. Its own edge, named once (fitEdgeKey(),
         pipenet.js), never a run key spelled out here. */
      const dk = fitEdgeKey(id);
      if(pipeDrop[dk]!=null)
        pipeTag(cx, r.y-4, (pipeDrop[dk]*100).toFixed(0)+"% dP",
                pipeDrop[dk]>0.5?C.amber:C.ink2);
    }
  }
}

// readoutsFor() is DATA - rows of [key,value,colour,tip,band,signedBar] - the
// ONE description of what a component is worth watching, consumed by the
// control room's HTML rail (fieldRowsSync() in inspector.js). Four numbers
// show up on more than one component; their band and sentence are written
// ONCE here so two readouts cannot describe the same quantity two ways.
const rowInv=s=>["INVENTORY",s.inv.toFixed(1)+" %",
  band(s.inv,80,100,[[95,C.red,"LEAKING"],[100,C.blue,"FULL"]],{dp:0}),
  "How much water is actually in the loop. A whole loop sits at 100%; under 95% you are losing it somewhere."];
const rowFat=s=>["VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",
  band(s.fatigue,0,100,[[50,C.cyan,"SOUND"],[100,C.amber,"WORN"]],{dp:0}),
  "Permanent metal damage from cold water hitting hot steel, mostly from emergency injection. It never resets, and the vessel bursts lower for every point of it."];
/* THIS generator's level when a generator is asking, the driest on the plant
   when the feed panel is - the feed system is one system serving all of them,
   and the one worth showing is the one closest to uncovering. It printed the
   same global number on every panel until Stage 6a split s.sglBy per machine. */
const rowSgl=(s,id)=>{ const v=id?sgLvl(s,id):sglMin(s), n=sgIds().length;
  return [id?"SG LEVEL":(n>1?"SG LEVEL (LOWEST)":"SG LEVEL"),v.toFixed(1)+" %",
  band(v,0,100,[[25,C.red,"LOW"],[100,C.cyan,"NORMAL"]],{dp:0}),
  "Water in the steam generator. Under 25% it is boiling dry and the core is losing its heat sink."]; };
// same s.nat used to be coloured three different ways on three components;
// shared here, as a percentage of RATED loop flow - the solved thermosiphon
// is a real flow now, so it is scaled against the same 100% every other flow
// readout uses instead of against a correlation's own ceiling
const rowNat=s=>["NAT CIRC",(s.nat*100).toFixed(0)+" %",
  band(s.nat*100,0,20,
    [[2,C.ink2,"NONE"],[20,C.green,"ESTABLISHED"]],{dp:0}),
  "Flow that buoyancy alone is making. It builds once the loop is hot, and it is all you have with the pumps dead. Generator height over the core sets it."];
const T_TRIP="What tripped the plant most recently. It stays here after a reset, so you can still see what you were fighting.";

// the key is the field on s.parts, except "net" which is the sum the sim already keeps
/* [label, s.parts key, tip, colour, limit]. ONE table: the ledger rows in
   readoutsFor(), the stack segments in rhoViz() and its key all read this, so a
   term cannot be given a colour in the picture and a different one in the list.
   Each colour is the thing it names - fuel red, coolant cyan, graphite brown.

   `limit` is the pcm marks a row carries, and ONLY THE NET HAS ANY. A doppler
   or a boron figure has no line you must not cross - it is just where that term
   stands - and inventing one would teach a limit the plant does not have. Beta
   is the one real line here: past it nothing on the ship is fast enough. (The
   xenon pit is a limit too, but it sits past RHO_BAR, so on this scale the mark
   would land on the end cap and say nothing. The VITALS bar carries it.) */
const RHO_ROWS=[
 ["RODS","rod","Negative reactivity from the inserted control rods. The deeper they go the stronger this gets, but not evenly: the rods bite hardest around mid-travel.",()=>C.metal],
 ["DOPPLER","dop","Feedback from hot fuel. As fuel heats it absorbs more neutrons, pushing power back down. Instant, automatic and always stabilising - this is what stops a runaway before a human could react.",()=>C.red],
 ["MODERATOR","mod","Feedback from coolant temperature. Hotter coolant is less dense and moderates neutrons less, so power drops. This is why the reactor follows turbine load on its own.",()=>C.cyan],
 ["XENON","xe","Xenon-135, a neutron poison that builds up after fission. It has memory: what you did minutes ago is still eating your reactivity now. Equilibrium sits near -2700; after a scram it deepens toward -4800 and locks you out of restarting.",()=>C.blue],
 ["BORON","bor","Poison dissolved in the coolant, and whatever you have dialled in on the boron control. Slow to change, but it is the only lever left once rods and temperature have run out.",()=>C.green],
 ["VOID","vd","Steam bubbles in the core. In a water design this is strongly negative and shuts the reactor down as it uncovers. In a graphite or sodium design it is POSITIVE, and voiding adds power instead.",()=>C.bright],
 ["ROD TIP","tip","Whatever hangs below the absorber. With a water follower this stays at zero all the way in. With a graphite one it goes POSITIVE as the bank drops, because graphite displaces water at the bottom of the core before the absorber has reached there - the reactivity you add before the reactivity you remove.",()=>C.graph],
 ["NET RHO","net","The sum of everything above. Zero means steady power, positive means it is climbing, negative means it is falling. The marks are your fuel's beta: past one of them the reactor is prompt critical and nothing can stop it in time.",()=>C.amber,()=>[-P.BETA*1e5,P.BETA*1e5]],
];
const RHO_TERMS=RHO_ROWS.filter(r=>r[1]!=="net");
/* full deflection of a ledger bar, pcm. Every term shares it, or the bars would
   be eight different scales sitting in one column pretending to be comparable. */
const RHO_BAR=2600;

/* ═══════════ WHAT IS HAPPENING IN REACTIVITY, AND WHERE IT IS GOING ═══════════
   The ledger below this says what every term IS. Eight signed numbers do not
   say which of them is winning, and that is the only question the operator
   actually has. This answers it in three registers, top to bottom:

     THE BALANCE - one stacked bar about zero. Everything holding the reactor
     down stacks to the left, everything pushing it up to the right, each term
     its own colour. The two arms are drawn on ONE scale, so the longer arm is
     genuinely the stronger side and the picture is a pair of scales.

     THE NET - the same sum as a single needle on a scale marked in BETA, which
     is the number that decides whether this is a transient or a prompt
     excursion. A ghost caret sits where the net was five seconds ago and an
     arrow runs from it to now: that is "where it is going", measured rather
     than guessed.

     THE LAST MINUTE - net rho against its own zero line. A term can be flat and
     still be losing, and only the trace shows that.

   Drawn through hostPaint(), so x,y start at 0,0 in its own canvas - see the
   note on HOST_K. Everything is laid out off `h` rather than pinned, because
   the rail width is the player's to change. */
function rhoViz(x,y,w,h){
  const s=S; if(!s) return;
  const L=x+2, R=x+w-2, cx=(L+R)/2, span=(R-L)/2;
  // P.BETA is the delayed fraction; everything on this widget is pcm
  const beta=P?P.BETA*1e5:650;

  const vals=RHO_TERMS.map(r=>({lab:r[0],v:s.parts[r[1]],col:r[3]()}));
  let neg=0,pos=0;
  for(const t of vals){ if(t.v<0) neg-=t.v; else pos+=t.v; }
  /* ONE scale for both arms, and it is CONTINUOUS in the total.

     A half-decade quantiser set it before, and a hard quantiser is the failure
     pipeDisplay() exists for: the step IS the snap. Full scale was a ceiling to
     the next mag/2, so one pcm of wobble across 5000 took the axis to 5500 and
     every segment in the bar changed width in a single frame with nothing in
     the plant having moved. Damping that target only trades the snap for a lag,
     and a lagging scale is worse than a snapping one here: a segment is placed
     at acc/full, so the instant full sits under the true total the bar and its
     labels run outside the widget.

     Headroom is ADDITIVE, not a factor. A factor pins the longer arm at the same
     length whatever the total is, which throws away the one thing the axis label
     is left saying. Adding a constant compresses instead: a few hundred pcm of
     imbalance draws short, thousands draws nearly full, and the ratio between the
     two arms - the actual question - is untouched either way, because both arms
     divide by the same number. */
  const RHO_HEAD=800;
  const raw=Math.max(neg,pos,1), full=raw+RHO_HEAD;

  /* ── how tall everything gets ──
     Four registers stacked in one column read as one solid block when every
     seam sits at its minimum, which is what a pinned pitch gave at any height.
     RHOVIZ_MIN is the height where nothing can give; whatever the row has over
     that is shared out - a little to each of the three seams, a little to the
     two bars, and the remainder to the trace. Shrink the row and it walks back
     to the old pinned layout instead of overflowing. */
  const KCOL=4, krows=Math.ceil(vals.length/KCOL);
  const slack=Math.max(0,h-(88+krows*8));
  const gap=Math.min(6,slack*.14), grow=Math.min(4,slack*.07);

  txt("REACTIVITY BALANCE",L,y+8,{size:7,sp:1.2,weight:700,color:C.amber});
  /* the GEOMETRY is continuous, the LABEL is not: printing full scale to the pcm
     would hunt its last digits on a plant that is standing still. 50 pcm is under
     a per cent of any axis this widget draws, so the caption is round and steady
     and still describes the bar under it. */
  txt("+/-"+(Math.round(full/50)*50).toFixed(0)+" pcm",R,y+8,{size:6.5,sp:.6,align:"right",color:C.ink2});

  /* ── the balance ── */
  const by=y+13+gap, bh=14+grow;
  fillRect(L,by,R-L,bh,C.well);
  const seg=(from,dir)=>{
    let acc=0;
    for(const t of vals){
      const m=dir>0? Math.max(0,t.v) : Math.max(0,-t.v);
      if(m<=0) continue;
      const a=cx+dir*(acc/full)*span, b=cx+dir*((acc+m)/full)*span;
      const x0=Math.min(a,b), wd=Math.abs(b-a);
      fillRect(x0,by,Math.max(.6,wd),bh,t.col);
      // the name only where it fits: a clipped label is worse than the colour
      // key below, which says the same thing and always fits
      if(wd>tw(t.lab,{size:6,sp:.4})+6)
        txt(t.lab,(a+b)/2,by+bh/2+2,{size:6,sp:.4,align:"center",color:C.inkOnLit});
      acc+=m;
    }
    return acc;
  };
  seg(cx,-1); seg(cx,1);
  frame(L,by,R-L,bh,C.edge);
  fillRect(cx,by-2,1,bh+4,C.bright);
  // fitTxt and not txt: these carry a figure that has no ceiling, so the string
  // grows with the plant. Given the room either side of the zero rule, a long
  // one steps down the ladder instead of running off the widget.
  fitTxt("HOLD DOWN "+neg.toFixed(0),cx-4,by+bh+8,span-6,{size:6,sp:.5,align:"right",color:C.blue});
  fitTxt(pos.toFixed(0)+" PUSH UP",cx+4,by+bh+8,span-6,{size:6,sp:.5,color:C.red});

  /* ── the key ──
     TWO ROWS. Seven across is about 30 units a column at a stock rail width,
     and MODERATOR alone is 34 at the smallest size the ladder has - so a single
     row could only ever be a row of labels overwriting each other. */
  const kw=(R-L)/KCOL, ky=by+bh+13+gap;
  vals.forEach((t,i)=>{
    const kx=L+(i%KCOL)*kw, kyy=ky+((i/KCOL)|0)*8;
    fillRect(kx,kyy,4,4,t.col);
    fitTxt(t.lab,kx+6,kyy+4,kw-8,{size:6,sp:.2,color:C.ink2});
  });

  /* ── the net, on a scale of beta ── */
  const ny=ky+krows*8+5+gap, nh=13+grow, bSpan=Math.max(beta*1.6,Math.abs(s.rho)*1.1,1);
  const atN=v=>cx+clamp(v/bSpan,-1,1)*span;
  fillRect(L,ny+nh/2,R-L,1,C.edge2);
  // the prompt-critical lines are the only marks on this scale that matter
  for(const d of [-1,1]){
    const px2=atN(d*beta);
    fillRect(px2,ny,1,nh,C.red);
    txt((d>0?"+":"-")+"BETA",px2+(d>0?2:-2),ny+nh-1,
      {size:6,sp:.4,align:d>0?"left":"right",color:C.red});
  }
  const nx=atN(s.rho);
  const nCol = s.rho>beta? C.red : Math.abs(s.rho)<50? C.green : s.rho<0? C.blue : C.amber;
  fillRect(Math.min(cx,nx),ny+nh/2-2,Math.max(1,Math.abs(nx-cx)),4,nCol);
  fillRect(nx-1,ny-2,3,nh+4,nCol);
  fillRect(cx,ny-2,1,nh+4,C.bright);
  /* where it was five seconds ago, and an arrow from there to here. hist is
     sampled every SAMP_TICKS, so the lookback is a sample count, not a guess. */
  const back=Math.round(5/(SAMP_TICKS*0.02));
  if(hlen>back+1){
    const was=chAt("rho",hlen-1-back), wx=atN(was);
    if(Math.abs(wx-nx)>1.5){
      fillRect(wx,ny+1,1,nh-2,C.rail);
      const dir=nx>wx?1:-1;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(nx-dir*5,ny+nh/2-3); ctx.lineTo(nx-dir*1,ny+nh/2); ctx.lineTo(nx-dir*5,ny+nh/2+3);
      ctx.fillStyle=nCol; ctx.fill(); ctx.restore();
    }
  }
  txt((s.rho>=0?"+":"")+s.rho.toFixed(0)+" pcm NET",L,ny+nh+8,{size:6.5,sp:.6,color:nCol});
  txt("BETA "+beta.toFixed(0),R,ny+nh+8,{size:6,sp:.6,align:"right",color:C.ink2});

  /* ── the last minute of it ── */
  const ty=ny+nh+12+gap, th=Math.max(16,y+h-ty-2);
  fillRect(L,ty,R-L,th,C.well); frame(L,ty,R-L,th,C.edge);
  const N=Math.min(hlen,Math.round(60/(SAMP_TICKS*0.02)));
  if(N>2){
    let lo=Infinity,hi2=-Infinity;
    for(let i=0;i<N;i++){ const v=chAt("rho",hlen-N+i); if(v<lo)lo=v; if(v>hi2)hi2=v; }
    lo=Math.min(lo,0); hi2=Math.max(hi2,0);
    let sp2=hi2-lo; if(sp2<1e-6) sp2=1;
    lo-=sp2*.1; sp2*=1.2;
    const zy=ty+th-((0-lo)/sp2)*th;
    ctx.save(); ctx.setLineDash([2,3]);
    line(L+1,zy,R-1,zy,C.edge2,1); ctx.restore();
    ctx.beginPath(); ctx.strokeStyle=C.amber; ctx.lineWidth=1.2;
    for(let i=0;i<N;i++){
      const X=L+1+(i/(N-1))*(R-L-2), Y=ty+th-((chAt("rho",hlen-N+i)-lo)/sp2)*th;
      i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);
    }
    ctx.stroke();
    txt("-"+(N*SAMP_TICKS*0.02).toFixed(0)+"s",L+3,ty+th-3,{size:6,color:C.ink2});
    txt("NOW",R-3,ty+th-3,{size:6,align:"right",color:C.ink2});
  } else {
    txt("COLLECTING DATA",cx,ty+th/2+2,{size:7,sp:1.4,align:"center",color:C.ink2});
  }
}
const RHOVIZ_TIP="Every term of the reactivity balance at once. The stacked bar splits at zero: what is holding the reactor down stacks left, what is pushing it up stacks right, both on one scale, so the longer arm is the side that is winning. Under it the SUM is drawn against your fuel's beta - past that line the reactor is prompt critical and no control on this ship is fast enough. The faint caret is where the sum stood five seconds ago and the arrow is the way it is heading. The trace is the last minute of it against its own zero.";
function readoutsFor(p,s){
  const heat=s.n*.935+s.decay, Th=s.Tavg+15*heat, Tc=s.Tavg-15*heat, sc=tsat(s.P)-Th;
  const id=p.id, R=[], m=P.rpsm;
  // a setpoint only exists while something is watching it: no mark drawn with
  // no protection fitted or bypassed - the overpower mechanic as a picture
  const trip=(v,l)=>rpsLive()?[[v,l]]:null;
  // a row hands in a colour OR a band; a band's colour comes off it, so the
  // figure and its tooltip strip cannot disagree about where the limit is.
  // `bar` is an optional centre-zero bar, {f:-1..1, full}, where `full` is what
  // either end of the strip is worth - drawn by fieldRowsSync() (inspector.js).
  const add=(k,v,c,tip,bar)=>{
    const g=(c&&typeof c==="object")?c:null;
    R.push([k,v, g?bandCol(g):(c||C.cyan), tip, g, bar]);
  };
  // a fitting is a part like any other, and what it is worth watching depends
  // on its mode rather than on its id - see readoutsForFit() below
  if(p.role==="fitting") return readoutsForFit(id,s);
  if(id==="core"){
    add("POWER",(s.n*100).toFixed(1)+" %",
      band(s.n*100,0,150,[[110,C.green,"NORMAL"],[150,C.red,"OVERPOWER"]],
        {dp:0,lim:trip((1.10+0.22*m)*100,"FLUX"),col:s.dnbr<1.3?C.red:null}),
      "Heat the core is making, as a share of what it is rated for. The real ceiling is DNBR, not this number.");
    add("THERMAL",(s.n*P.rated).toFixed(0)+" MWt",null,
      "The same power in megawatts of heat: the rating times the share above.");
    { const per=period(), fin=isFinite(per)&&Math.abs(per)<999;
      add("PERIOD", fin?per.toFixed(0)+" s":"INF",
        fin&&per>0&&per<30 ? C.red : fin&&per>0&&per<80 ? C.amber : C.cyan,
        "Seconds for power to multiply by 2.7 times at the rate it is moving right now. INF means steady. A short POSITIVE period is power running away from you, and under about ten seconds nothing you do will catch it."); }
    // scale top is measured off the plant: a sodium/salt core rests at 3.2
    // against water's 1.76, so a fixed 2.6 would peg the needle on half the
    // architectures from the first frame
    const dHi=Math.max(2.6,P.dnbr0*1.3);
    add("DNBR",s.dnbr.toFixed(2),
      band(s.dnbr,0.8,dHi,[[1.0,C.red,"FILM"],[1.3,C.amber,"MARGINAL"],[dHi,C.cyan,"SAFE"]],
        {dp:2,lim:trip(1.18-0.16*m,"TRIP")}),
      "How far the fuel is from a steam film that stops cooling it. Over 1.30 is comfortable; 1.00 damages fuel.");
    add("FUEL TEMP",s.Tf.toFixed(0)+" K",
      band(s.Tf,300,2200,[[1500,C.cyan,"NORMAL"],[2200,C.red,"FAILING"]],
        {dp:0,lim:trip(1600+280*m,"TRIP")}),
      "Temperature inside the pellets. Past 1500 K the cladding starts to fail, and that damage is permanent.");
    add("PEAK Fq",s.fq.toFixed(2),
      band(s.fq,1,5,[[3.2,C.cyan,"FLAT"],[5,C.amber,"PEAKED"]],{dp:2}),
      "How much hotter the hottest spot is than the core average. 1.00 is perfectly flat; past 3.2 one channel is doing far too much of the work.");
    add("HOT SPOT","R"+s.hotRing+" / EL"+s.hotLev,null,
      "Which mesh ring and which level is carrying that peak. It is ringed in the core field on the reactor symbol.");
    add("AX / RAD OFFSET",(s.ao*100).toFixed(0)+" / "+(s.ro*100).toFixed(0)+" %",
        Math.abs(s.ao)>.35||Math.abs(s.ro)>.35?C.amber:C.cyan,
      "How far the flux leans up-down and in-out from centred. Past 35% either way the peak has moved somewhere you did not design for.");
    add("VOID",s.vf.toFixed(2),
      band(s.vf,0,.6,[[.15,C.cyan,"LIQUID"],[.6,C.red,"BOILING"]],
        {dp:2,lim:trip(.30,"TRIP")}),
      "Share of the coolant that has turned to steam. Steam carries heat away far worse than water, and in a graphite core it adds reactivity as well.");
    add.apply(null,rowInv(s));
    // BORON and XENON aren't stated here: they're reactivity terms, so the
    // ledger below says them (with direction) instead of two rows quoting one number
    add("BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        Math.abs(s.boronDem-s.boron)>20?C.amber:C.ink2,
      "Where you have asked boron to go. It borates at "+BOR_IN+" pcm/s and only dilutes at "+BOR_OUT+", so poisoning yourself is the fast direction.");
    add("FUEL DAMAGE",s.dmg.toFixed(1)+" %",
      // any damage at all is the bad zone, so the good one is a sliver - the
      // strip saying honestly that this scale has no safe stretch
      band(s.dmg,0,100,[[1e-9,C.cyan,"NONE"],[100,C.red,"CLAD FAILED"]],{dp:0}),
      "Cladding that has already failed, and it is permanent. It grows whenever DNBR drops under 1.00 or the fuel passes 1500 K.");
    add.apply(null,rowFat(s));
    R.push({sec:"REACTIVITY"});
    // the picture first, the eight numbers it is a picture OF underneath
    R.push({viz:"rho",tip:RHOVIZ_TIP,title:"REACTIVITY BALANCE"});
    for(const r of RHO_ROWS){
      const v = r[1]==="net" ? s.rho : s.parts[r[1]];
      const col = r[1]==="net" ? (Math.abs(v)<50?C.green:(v<0?C.blue:C.red))
                               : (v<0?C.blue:C.amber);
      const lim = r[4] && r[4]();
      add(r[0],(v>=0?"+":"")+v.toFixed(0),col,r[2],
        {f:clamp(v/RHO_BAR,-1,1),full:RHO_BAR,
         m:lim&&lim.map(q=>clamp(q/RHO_BAR,-1,1))});
    }
  } else if(id==="rods"){
    add("BANK POSITION",(s.rodPos*100).toFixed(1)+" %",null,
      "Where the bank stands. 100% is fully inserted, and the rods bite hardest around mid-travel rather than evenly.");
    add("BANK DEMAND",(s.rodDem*100).toFixed(1)+" %",
        Math.abs(s.rodDem-s.rodPos)>.005?C.amber:C.ink2,
      "Where you have asked the bank to go. The drives walk to it at "+(ROD_RATE*100).toFixed(1)+" %/s, so this leads the position every time you move the slider.");
    add("WORTH HERE",coreRodWorth(s).toFixed(0)+" pcm",null,
      "What the bank is worth where it actually stands, solved on the live flux. Move a cluster inward at the bench and this changes.");
    add("DRIVES",s.rodJam?"JAMMED":"answering",s.rodJam?C.red:C.green,
      "Whether the drive mechanisms answer at all. A hit here jams the bank where it stands, and a scram will not move it either.");
    add("SCRAM TIME",(1/P.scram).toFixed(1)+" s",null,
      "How long a full insertion takes on a trip. You bought this at the bench, and faster gear is heavier gear.");
    add("TRIP LATCH",s.scrammed?"LATCHED":"clear",s.scrammed?C.amber:C.green,
      "Whether a trip is latched in. While it is, the drives are pinned fully inserted whatever the slider says.");
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2,T_TRIP);
    add("RESET WOULD",!s.scrammed?"n/a":resetVeto()?"REFUSE":"clear",
        !s.scrammed?C.ink2:resetVeto()?C.red:C.green,
      "What the trip reset would do if you pressed it now. Armed protection holds a veto for as long as a trip condition is still standing; bypass it and the latch clears on your word alone.");
    add("NET RHO",s.rho.toFixed(0)+" pcm",
      band(s.rho,-800,800,[[-50,C.amber,"FALLING"],[50,C.green,"STEADY"],[800,C.amber,"RISING"]],
        {dp:0,lim:[[P.BETA*1e5,"PROMPT"]]}),
      "Everything pushing the reactor up or down, added together. Zero is steady power; past your fuel's beta nothing can stop it in time.");
    add("TILT TRIM",(s.tilt>=0?"+":"")+s.tilt.toFixed(2),
      band(s.tilt,-.3,.3,[[-.05,C.amber,"LEANING"],[.05,C.ink2,"CENTRED"],[.3,C.amber,"LEANING"]],{dp:2}),
      "How far the banks are leaned against each other to shape the flux. Live in GANG only - SPLIT stands it down, because two things cannot own the same spacing.");
    add("TILT DEMAND",(s.tiltDem>=0?"+":"")+s.tiltDem.toFixed(2),
        Math.abs(s.tiltDem-s.tilt)>.01?C.amber:C.ink2,
      "Where you have asked the tilt to go. It walks there at drive speed, so it leads the trim above.");
    add("SHUTDOWN MGN",P.sdm.toFixed(0)+" pcm",
      band(P.sdm,-3000,3000,[[200,C.red,"THIN"],[3000,C.green,"AMPLE"]],{dp:0}),
      "How firmly the bank ALONE holds this core down once it cools and the xenon decays. Usually negative, and that is what boron is for.");
  } else if(id==="pzr"){
    add("PRESSURE",s.P.toFixed(2)+" MPa",
      band(s.P,P.P0*.80,P.P0*1.15,
        [[P.P0*0.935,C.amber,"LOW"],[P.P0*1.05,C.cyan,"NORMAL"],[P.P0*1.15,C.red,"HIGH"]],
        {dp:2,lim:rpsLive()?[[P.P0*(1.06+0.07*m),"HI"],[P.P0*0.86,"LO"]]:null}),
      "Loop pressure. It sets the temperature the coolant boils at, so every megapascal here is thermal margin.");
    add("LEVEL",s.lvl.toFixed(1)+" %",
      band(s.lvl,0,100,[[78,C.cyan,"NORMAL"],[100,C.amber,"HIGH"]],{dp:0}),
      "Water level in the pressurizer. Level RISING while pressure falls is a stuck relief valve - the trap that wrecked Three Mile Island.");
    // measured off the plant like DNBR's scale: a helium core sits 1400 K
    // below boiling, water only 22, so a fixed ceiling would peg one or squash
    // the other. The 8 K SATURATED line stays absolute regardless.
    const scHi=Math.max(60,(P.tsat0-P.Tref)*1.25);
    add("SUBCOOLING",sc.toFixed(1)+" K",
      band(sc,0,scHi,[[8,C.red,"SATURATED"],[scHi,C.cyan,"SUBCOOLED"]],
        {dp:0,lim:trip(3,"TRIP")}),
      "Degrees below boiling in the hot leg. The honest leak indicator: it collapses before anything else admits the loop is voiding.");
    add("SAT TEMP",tsat(s.P).toFixed(0)+" K",null,
      "The temperature the coolant would boil at, at the pressure it is held to right now.");
    /* Six rows about the relief valve used to live here, and every one of them
       resolved to the FIRST relief fitting placed - so on a plant with three
       relief valves this panel described one of them and pretended the other
       two did not exist. They are readoutsForFit() rows now, one panel per
       valve; the pressurizer keeps the four numbers that are genuinely its
       own. audit-geometry scans this branch to keep it that way. */
  } else if(id.startsWith("sg")){
    add.apply(null,rowSgl(s,id));
    /* secP(), not a second copy of its formula: CLAUDE.md's rule is that the
       node an SGTR leaks into is fixed at "the same expression the STEAM PRESS
       row prints", and this row printed its own copy - which stopped being the
       same expression the moment Stage 6b gave each generator its own. */
    add("STEAM PRESS",secP(s,id).toFixed(2)+" MPa",null,
      "Pressure on the secondary side of THIS generator. It follows how hard the turbine is drawing on it and how much water is left in it - a unit boiling dry raises less steam and falls back toward the condenser, which is also what slows a ruptured tube down.");
    add("T-HOT IN",Th.toFixed(0)+" K",null,
      "Coolant arriving from the core. The gap between this and T-COLD is the heat this unit is taking out.");
    add("T-COLD OUT",Tc.toFixed(0)+" K",null,
      "Coolant going back to the core, after the generator has taken its heat.");
    add("HEAT REMOVED",(Math.min(s.n,s.load)*P.rated).toFixed(0)+" MWt",null,
      "Heat actually leaving the primary loop. It is the LOWER of what the core makes and what the turbine will take.");
    add.apply(null,rowNat(s));
    add("TUBES",s.sgtr?"LEAKING":"intact",s.sgtr?C.red:C.green,
      "The barrier between primary and secondary. A rupture leaks coolant and activity straight past containment.");
  } else if(id.startsWith("pump")){
    /* s.flowNet, not s.flow: the LOW FLOW trip reads DELIVERED flow
       (tripCause(), step.js), so a gauge on the pump SETTING would sit at
       100% NORMAL, with its own trip mark on a number that no longer causes
       the trip, right up to the moment the plant tripped. Shut every throttle
       and that is exactly what it did. The two are equal to the bit on an
       undamaged, unthrottled plant, which is why nothing re-pins. */
    add("FLOW",(s.flowNet*100).toFixed(1)+" %",
      band(s.flowNet*100,0,110,[[P.flowMin*100,C.red,"STARVED"],[110,C.cyan,"NORMAL"]],
        {dp:0,lim:trip(P.flowMin*102,"TRIP")}),
      "Coolant actually reaching the core, which is what the protection system trips on - not what the pumps were told to do. A shut valve or a severed run shows up here and nowhere else.");
    add("FLOW DEMAND",(flowDemPri(s)*100).toFixed(1)+" %",
        Math.abs(flowDemPri(s)-s.flowNet)>.005?C.amber:C.ink2,
      "Where you have asked the pumps to go. Delivery lags it by "+FLOW_TAU+" s, by "+FLOW_TAU_COAST+" s while coasting down in a blackout, and falls short of it for good if the water has nowhere to go.");
    add("DESIGN FLOOR",(P.flowMin*100).toFixed(0)+" %",null,
      "The least flow this pump set still delivers after damage. It rises with how much spare pump capacity you actually placed on the grid, beyond one pump per loop.");
    add("HOT CHANNEL",(s.hotFlow*100).toFixed(0)+" %",
      band(s.hotFlow*100,0,110,[[80,C.amber,"STARVED"],[110,C.cyan,"FED"]],{dp:0}),
      "Flow in the WORST channel, not the average. A voiding channel loses the flow it needed to stop voiding, and that runaway is why the core is a place and not a number.");
    add("CAVITATION",(s.cav*100).toFixed(0)+" %",
      band(s.cav*100,0,60,[[15,C.cyan,"NONE"],[60,C.amber,"CAVITATING"]],{dp:0}),
      "Vapour forming at the pump inlet because pressure fell too far. It costs head, so losing pressure costs you flow as well.");
    add.apply(null,rowNat(s));
    add("PUMPS LOST",s.dmgParts.filter(k=>k.startsWith("pump")).length+" / "+
        LAY.parts.filter(q=>q.id.startsWith("pump")).length,
        s.dmgParts.some(k=>k.startsWith("pump"))?C.red:C.green,
      "How many of your coolant pumps have been destroyed, out of how many you paid for.");
  } else if(p.role==="turb"){
    add("LOAD",(s.load*100).toFixed(1)+" %",null,
      "How hard the turbine is drawing steam. This is the demand the reactor spends its whole time trying to follow.");
    add("LOAD DEMAND",(s.loadDem*100).toFixed(1)+" %",
        Math.abs(s.loadDem-s.load)>.005?C.amber:C.ink2,
      "Where you have set the load. The governor strokes there over about "+LOAD_TAU.toFixed(0)+" s.");
    add("ELECTRICAL",mwE(s).toFixed(0)+" MWe",null,
      "Electrical power the ship is actually getting. It is the lower of heat made and heat taken, priced by the machine you bought, and it is what a lost turbine or an undersized condenser takes straight off you.");
    add("T-AVG DEV",(s.Tavg-tProg(s)>=0?"+":"")+(s.Tavg-tProg(s)).toFixed(1)+" K",null,
      "How far coolant temperature sits from the programme for this load. Anything but zero means reactor and turbine are out of balance.");
    add("STEAM DUMP",(P.bypass*100).toFixed(0)+" %",null,
      "How much steam can go straight past the turbine to the condenser. It is what absorbs a trip without the relief valve lifting.");
    add("GOV STROKE",LOAD_TAU.toFixed(0)+" s",null,
      "How long the governor valves take to answer a change in load demand.");
    add("RUNBACK",autoState("runback").toLowerCase(),
        autoLive("runback")?C.green:C.amber,
      "Whether a trip also pulls the turbine back. Bypass it and a scram leaves the turbine drawing hard on a dead core, chilling the loop.");
  } else if(id==="ctrl"){
    add("RPS",rpsState().toLowerCase(),rpsLive()?C.green:C.amber,
      "The automatic protection. Live, it trips on eight conditions; bypassed, it watches you run the plant to destruction and says nothing.");
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2,T_TRIP);
    add("INSTRUMENTS",P.noise<.2?"VOTED":P.noise<.6?"2CH DRIFT":"1CH RAW",
        P.noise>.6?C.amber:C.green,
      "How many sensors watch each parameter. One channel jitters and hides a liar; three vote the liar out and the numbers hold still.");
    add("PARTY DOSE",s.dose.toFixed(1)+" %",
      band(s.dose,0,100,[[50,C.cyan,"LOW"],[100,C.red,"HIGH"]],{dp:0}),
      "Radiation your repair parties have taken so far. It costs whatever the job site itself reads, from behind whatever shielding is actually there - this room has nothing to do with it.");
    add("DOSE RATE",s.doseRate.toFixed(2)+" x",
      band(s.doseRate,0,RAD_CEIL,ZONE.map(z=>[z.t,z.col,z.lab]),{dp:2}),
      "How fast dose is piling up right now in the room the crew actually sit in. It moves with what has failed on the plant, not just with where you put the shielding.");
    add("WATCH DOSE",s.crewDose.toFixed(1)+" %",
      band(s.crewDose,0,100,[[50,C.cyan,"LOW"],[100,C.red,"HIGH"]],{dp:0}),
      "Radiation the control-room watch has taken, over the whole run. The watch never leaves this room; the repair party stands wherever the damage is. Different places, different doses - that gap is the entire reason both are tracked.");
    add("AS-BUILT RATE",P.dose.toFixed(2)+" x",C.ink2,
      "What this room was designed to read at rating, with nothing broken. Set it against DOSE RATE above to see how far the accident has pushed you off what you built.");
    add("EVENTS",LOG.length+"",null,
      "How many things have gone wrong this run. The LOG panel says what each of them was.");
  } else if(p.role==="tank"){
    /* ONE PANEL FOR EVERY TANK. Every row is read off the instance's own
       config and its own solved flow, so the same rows describe an
       accumulator, a boron tank, a relief tank and a hotwell. */
    const t=D.tanks[id], fl=tankFluid(id), rate=(s.tankRate&&s.tankRate[id])||0;
    add("CONTENTS",fl.label.toLowerCase()+", "+fl.temp.toFixed(0)+" K",null,
      "What is in this tank. Activity and reactivity worth follow from this and from nothing else"
      +(fl.boron?" - a tank of this is worth "+fl.boron+" pcm for every 1 % of loop inventory it pushes in.":"."));
    add("TANK LEVEL",tankLvl(s,id).toFixed(1)+" %",
      /* the same source/sink question the symbol asks, so the bar and the box
         can never disagree about whether full is good news */
      (tankSide(id)==="primary" && !t.check)
        ? band(tankLvl(s,id),0,100,[[1,C.green,"CLEAN"],[100,C.red,"FULL"]],{dp:1})
        : band(tankLvl(s,id),0,100,[[15,C.red,"LOW"],[100,C.cyan,"FULL"]],{dp:1}),
      "How much is left in it. It is not an infinite reservoir - run it dry and there is nothing behind it, and fill it past 100 % and what will not fit leaves the plant.");
    add("TANK PRESS",tankP(s,id).toFixed(2)+" MPa",null,
      t.pump
        ? "What the pumps behind it are holding. Steady until the tank is dry, and gone with the bus in a blackout - a tank with a gas charge instead is the one injection path a blackout does not kill."
        : t.gas
          ? "The gas charge behind the contents. It needs no electricity, so it still works in a blackout - and it moves as the level moves, because the gas is expanding or being compressed."
          : "Nothing is holding this tank up. With neither a pump nor a gas charge it sits at zero and can only ever be filled.");
    add("VALVE",tankOpen(s,id)?"OPEN":"shut",tankOpen(s,id)?C.green:C.ink2,
      "Whether this tank is lined up. Its automatic rule is "+(AUTORULE[t.auto]?AUTORULE[t.auto].label:"none")+", which opens it without you being asked.");
    if(tankSide(id)==="primary"){
      add("RATE",rate.toFixed(2)+" %/s",rate>0?C.cyan:rate<0?C.amber:null,
        "What this tank's own line is carrying, positive out. Not a setting: it is what the tank wins against the pressure in the loop, so it is near zero at full pressure and surges once the primary comes down. Negative means the loop is filling it.");
      add("HEAD",((P.lay&&P.lay.tankZ&&P.lay.tankZ[id])||0).toFixed(1)+" m",null,
        "How high this tank stands above the core. It is real static head in the solve: mount it high and it drains in fast, mount it level with the core and it barely trickles.");
    }
    if(t.burst) add("RUPTURE DISC",s.burstBy[id]?"BURST":"intact",s.burstBy[id]?C.red:C.green,
      "It lets go at "+t.burst.at.toFixed(2)+" MPa. Past that the tank is an opening to containment: it drains onto the floor and what was in it is in the air, not behind a wall. This is the TMI-2 sequence, and a burst disc does not reseat.");
    if(s.tankOver&&s.tankOver[id]>0) add("OVERFLOW",s.tankOver[id].toFixed(0)+" kg/s",C.red,
      "It is full and cannot take any more. This is leaving the plant, and after a tube rupture it is primary water.");
    if(tankSide(id)==="primary"){ add.apply(null,rowInv(s)); add.apply(null,rowFat(s)); }
  } else if(id==="cont"){
    add("RELEASE",s.release.toFixed(2)+" %",
      band(s.release,0,10,[[1,C.cyan,"CONTAINED"],[10,C.red,"RELEASING"]],{dp:2}),
      "Share of the core inventory that has escaped and reached the crew. Driven by fuel damage, cut down by the containment you paid for. Once loose it is airborne in every compartment, not sitting at a point a wall can stand between - containment is the only thing that touches it, and no amount of shielding anywhere on the plant helps against it.");
    add("HELD BACK",((1-P.contRel)*100).toFixed(0)+" %",null,
      "How much of any release this containment keeps in. It does nothing for the reactor and everything for the people around it.");
    add("CORE CATCHER",P.catcher?"fitted":"none",P.catcher?C.green:C.ink2,
      "A cooled basin under the vessel. It will not save the fuel, but it stops a melt burning through and breaching.");
    add("VESSEL",s.breach?"RUPTURED":"intact",s.breach?C.red:C.green,
      "Whether the pressure vessel is still whole. A rupture is the end of the run.");
  } else if(id==="bkp"){
    add("BLACKOUT",s.blackout?"ACTIVE":"no",s.blackout?C.red:C.green,
      "Whether main power to the coolant pumps has gone. Test it from the FAULTS panel before you ever need to know.");
    add("CAPACITY",(P.backup*100).toFixed(0)+" %",null,
      "Share of pump flow your backup supply can still turn. Everything above this has to come from buoyancy.");
    add("SUPPLY",s.bkpLost?"DESTROYED":"available",s.bkpLost?C.red:C.green,
      "Whether the backup set itself survived. A hit here means a blackout is natural circulation and nothing else.");
    add.apply(null,rowNat(s));
  /* A PUMP THAT FEEDS A GENERATOR'S SHELL - asked of the drawing (secGensOf(),
     layout.js), never of the id "feed". There is one pump role, so which
     panel a pump gets is a question about where it is piped. */
  } else if(roleHead(p.role) && secGensOf(id).length){
    add.apply(null,rowSgl(s));
    { const arm=tankRuleAny(s,"secondary"), any=secTankIds().some(id=>D.tanks[id].auto!=="always"&&D.tanks[id].auto!=="manual");
      add("EMERG FEED",!any?"none":arm?"armed":"bypassed",!any?C.ink2:arm?C.green:C.amber,
        "Whether any reserve tank on the secondary side will line itself up without being asked. Its switch is on that TANK's own strip, not here - this is a readout, because it is the generator's feed that it is about. Armed, it also adds a small dump while the reactor is scrammed, running the loop a few degrees cooler. It does not touch grace time."); }
    add("FEED PUMP",s.dmgParts.includes(id)?"DESTROYED":"running",
        s.dmgParts.includes(id)?C.red:C.green,
      "The main feedwater pump. Destroyed, the generator boils dry unless emergency feed picks it up.");
  } else if(p.role==="cond"){
    add("T-HOT",Th.toFixed(0)+" K",null,
      "Steam temperature arriving at the condenser.");
    add("HEAT REJECTED",mwRej(s).toFixed(0)+" MWt",null,
      "Heat being dumped overboard. It is the remainder, after the turbine has taken its share as electricity.");
    /* The tanks this machine hosts - a tank with no cell of its own has no
       panel of its own either, so it reports here, on the component it lives
       inside. One row per hosted tank. */
    for(const tid of hostedTankIds()){
      add(D.tanks[tid].name,tankLvl(s,tid).toFixed(1)+" %",
        band(tankLvl(s,tid),0,100,[[10,C.red,"LOW"],[95,C.cyan,"NORMAL"],[100,C.amber,"HIGH"]],{dp:0}),
        "Condensate waiting to be pumped back to the generators. In a healthy plant it does not move: what boils out comes back. It falls when a generator is losing water faster than the feed returns it, and it RISES when a ruptured tube is pushing primary water into the secondary - which is the one that has to be dealt with, because past 100% it overflows and what overflows is contaminated.");
      if(s.tankOver&&s.tankOver[tid]>0) add(D.tanks[tid].name+" OVERFLOW",s.tankOver[tid].toFixed(0)+" kg/s",C.red,
        "It is full and cannot take any more. This water is leaving the plant, and after a tube rupture it is primary water.");
    }
    add("CONDENSER",s.dmgParts.includes(id)?"DESTROYED":"in service",
        s.dmgParts.includes(id)?C.red:C.green,
      "The heat sink itself. Destroyed, the steam has nowhere to condense and the loop has nowhere to put its heat.");
  }
  // shielding has nothing to report, and neither has a component never
  // bought - the grid already draws the dashed outline and NOT FITTED itself
  if(!R.length||!fitted(p)) return [];
  if(s.dmgParts.includes(p.id)) R.unshift(["STATUS","DAMAGED",C.red,
    "This component has taken a hit. Send a party from the REPAIR panel, or from the key drawn on the component itself."]);
  if(!p.access && p.grp!=="shield") R.unshift(["ACCESS","BLOCKED",C.red,
    "Your layout walls this in on every side, so no repair party can ever reach it. It stays broken for the rest of the run."]);
  return R;
}

/* ══ WHAT A FITTING IS WORTH WATCHING ══
   A branch of readoutsFor(), not a sibling of it: a fitting is a PART now, so
   the rail that is built from LAY.parts reaches it like every other machine,
   and the second function this used to be existed only because it could not.
   Every row addresses THIS fitting - the six relief rows that used to sit on
   the pressurizer could only ever describe primaryRelief(), so a second or
   third valve was invisible to the panel that claimed to report it. */
function readoutsForFit(fid,s){
  const mode=fitModeOf(fid);
  const R=[], add=(k,v,c,tip)=>{ const g=(c&&typeof c==="object")?c:null;
    R.push([k,v, g?bandCol(g):(c||C.cyan), tip, g, null]); };
  const dk = mode==="throttle" ? fitEdgeKey(fid) : null;
  if(mode==="relief"){
    const set=reliefSet(fid);
    const open = !!s.reliefOpen[fid] && !s.reliefBlocked[fid];
    const blkd = !!s.reliefBlocked[fid], byp = !!s.porvByp[fid];
    add("LIFT SETPOINT",(P.P0*set.lift).toFixed(2)+" MPa",null,
      "Where THIS valve opens on its own. It has an 18% chance of sticking open every single time it lifts.");
    add("RESEAT SETPOINT",(P.P0*set.reseat).toFixed(2)+" MPa",null,
      "Where it shuts again. The gap up to the lift point is its deadband - narrow it and the valve cycles on the setpoint instead of lifting once and clearing it. Both are set at the design bench.");
    // scale is a share of THIS plant's pressure (a sodium loop runs at 0.2
    // MPa); the 0.3 MPa NEAR LIFT line stays absolute and can sit off the end
    // on a low-pressure plant, honestly saying it's always close to lifting
    const mlLo=Math.min(-0.1,-P.P0*.04), mlHi=Math.max(0.4,P.P0*.12);
    const marg = P.P0*set.lift - s.P;
    add("MARGIN TO LIFT",marg.toFixed(2)+" MPa",
      band(marg,mlLo,mlHi,[[0.3,C.amber,"NEAR LIFT"],[mlHi,C.cyan,"CLEAR"]],{dp:2}),
      "How much pressure is left before this valve lifts by itself. Negative means it is passing right now.");
    add("PORV",open?"PASSING":"shut", open?C.red:C.green,
      "The valve itself. PASSING means coolant is leaving the loop through it, whether you asked or not.");
    const rate=reliefRate(s,fid), full=reliefFullRate(s,fid);
    add("RELIEF FLOW",rate.toFixed(2)+" %/s",
      band(rate,0,Math.max(full,1e-6),[[1e-9,C.green,"SHUT"],[Math.max(full,1e-6),C.red,"PASSING"]],{dp:2}),
      "Coolant leaving the loop through this valve, as a share of the whole loop every second - the network's own solved flow through this valve's branch, not a fixed reference rate. A short, fat run to the tank vents faster than a long, thin one.");
    add("BLOCK VALVE",blkd?"SHUT":"open",blkd?C.red:C.green,
      "Your last defence against this valve sticking open. Shutting it stops the leak and gives this relief path up for good.");
    add("AUTO RELIEF", byp?"bypassed":autoState("porv").toLowerCase(),
        (autoLive("porv")&&!byp)?C.green:C.amber,
      "Whether THIS valve may lift by itself. Bypassing one valve leaves the others working; bypassing the master leaves nothing venting at all.");
  } else if(mode==="tee"){
    /* A TEE HAS NOTHING TO REPORT. It is one node with four faces - no gate,
       no position, no state at all - so it gets no rows and the rail hides
       its panel, exactly as it does for a component with nothing to say. */
    return R;
  } else {
    add("POSITION",(s.valve[fid]*100).toFixed(0)+" %",
      band(s.valve[fid]*100,0,100,[[1,C.ink2,"SHUT"],[100,C.green,"OPEN"]],{dp:0}),
      "Where this throttle actually is. It walks toward the demand below at its motor's own speed.");
    add("DEMAND",(s.valveDem[fid]*100).toFixed(0)+" %",null,
      "Where you have asked it to go.");
  }
  if(dk!=null && pipeDrop[dk]!=null)
    add("HEAD DROP",(pipeDrop[dk]*100).toFixed(0)+" % of span",
      band(pipeDrop[dk]*100,0,100,[[50,C.cyan,"CHEAP"],[100,C.amber,"COSTLY"]],{dp:0}),
      "The share of the loop's whole pump head this fitting is eating. Position says what you asked for; only this says what it cost.");
  return R;
}

// the layoutMetrics() a drawPlant() call already paid for is cached here so
// the bench rail (design-bench.js) can read PLANT_LM without recomputing it
let PLANT_LM=null;

// a widget hosted inside an HTML panel (trend chart, fuel lattice plan) still
// draws HERE, at the screen box its placeholder element occupies - matches
// local()'s page<->layout conversion (core/ui.js) so clicks land correctly
function hostRect(el){
  const rc=cv.getBoundingClientRect(), r=el.getBoundingClientRect();
  const sx=W/rc.width, sy=(H-TOPBAR_H)/rc.height;
  return {x:(r.left-rc.left)*sx, y:(r.top-rc.top)*sy+TOPBAR_H, w:r.width*sx, h:r.height*sy};
}

/* ...except inside a RAIL, which is opaque and paints over #cv, so anything
   drawn under it is invisible and its pointer events never reach cv. Those
   widgets paint into their own <canvas> instead.

   Their scale is FIXED, not the plant's. #cv stretches W=760 layout units
   across the stage, so canvas type grows with the window - fine for the plant,
   wrong for a widget sitting among HTML type that is plain px. One layout unit
   is HOST_K CSS px here, picked so the smallest size in use (6.5) lands on the
   10px floor src/style.css gives HTML type. Nothing in a rail resizes with the
   window any more.

   Because that space starts at 0,0 it OVERLAPS the plant's numerically, which
   is why push()/hov() are scoped by host - see hostScope()/ui.ptrHost. */
const HOST_K=1.5;
function hostLocal(el,e){ const r=el.getBoundingClientRect();
  return {x:(e.clientX-r.left)/HOST_K, y:(e.clientY-r.top)/HOST_K}; }
function hostForward(el){ uiForward(el, e=>hostLocal(el,e)); }
function hostPaint(el,draw){
  const box=el.getBoundingClientRect();
  if(box.width<4||box.height<4) return;
  const dpr=(typeof devicePixelRatio==="number"&&devicePixelRatio)||1;
  const bw=Math.max(1,Math.round(box.width*dpr)), bh=Math.max(1,Math.round(box.height*dpr));
  if(el.width!==bw||el.height!==bh){ el.width=bw; el.height=bh; }
  const c=el.getContext("2d"), s=dpr*HOST_K, w=box.width/HOST_K, h=box.height/HOST_K;
  c.setTransform(s,0,0,s,0,0);
  c.clearRect(0,0,w,h);
  const prev=ctx; ctx=c; hostScope(el);
  try{ draw(0,0,w,h); } finally { ctx=prev; hostScope(null); }
}

/* ══ THE LEADER STARTS SOMEWHERE FREE, NOT AT THE MIDDLE OF THE FACE ══
   It used to leave from the exact centre of the part's right edge, which is
   where port() puts a pipe whenever a face carries an odd number of them - so
   on the components that matter most the dashed leader set off along a pipe
   and read as one more branch of the plumbing for its first few pixels.

   So: walk candidate points down the face and take the one furthest from any
   pipe that actually lands on it. The middle is still FIRST in the list, so a
   face with nothing on it is unchanged; the offsets alternate above and below
   so a leader never has to travel far from where the eye expects it. */
const LEADER_SPOTS=[0.5,0.30,0.70,0.14,0.86];
const LEADER_CLEAR=7;
function leaderAnchor(part){
  const a=prect(part), x=a.x+a.w;
  // every pipe vertex sitting on this face, whichever run it belongs to
  const ys=[];
  for(const r of pipeNetwork()) for(const q of r.pts)
    if(Math.abs(q[0]-x)<=3 && q[1]>=a.y-2 && q[1]<=a.y+a.h+2) ys.push(q[1]);
  if(!ys.length) return {x, y:a.y+a.h/2};
  let best=null;
  for(const f of LEADER_SPOTS){
    const y=a.y+a.h*f;
    let d=Infinity;
    for(const py of ys) d=Math.min(d,Math.abs(py-y));
    if(d>=LEADER_CLEAR) return {x,y};
    if(!best||d>best.d) best={x,y,d};
  }
  return {x:best.x, y:best.y};
}

/* the panels live in HTML rails now, so a selected component and the panel that
   configures it no longer touch. This leader is redrawn every frame in LAYOUT
   space - outside drawPlant()'s view transform - and hostRect() reads the live
   DOM box, so pan, zoom and rail scroll all come out right with no listeners.
   It stops at the rail's left edge because the rail is opaque and the canvas
   is under it; dashed, so it never reads as one more pipe. */
function leaderLine(panelEl,railEl){
  const part=LAY&&LAY.parts.find(q=>q.id===sel);
  if(!part||!panelEl||!railEl) return;
  const r=hostRect(railEl), q=hostRect(panelEl);
  if(r.w<2||r.h<2||q.h<1) return;                 // rail unlaid, or a panel hidden by display:none
  const pad=3, vx0=VIEW.x+pad, vx1=VIEW.x+VIEW.w-pad, vy0=VIEW.y+pad, vy1=VIEW.y+VIEW.h-pad;
  if(vx1<=vx0||vy1<=vy0) return;
  // clamped, not culled: panned off the plant, the leader pins to the viewport
  // edge and still says which way the component went
  const s0 = vScr(leaderAnchor(part));
  const sx=clamp(s0.x,vx0,vx1), sy=clamp(s0.y,vy0,vy1);
  // scrolled away, the leader takes the first turn only and then runs clean off
  // the top or bottom of the canvas, so it reads as continuing to a panel that
  // is simply not on screen - never turning back in to claim an attachment the
  // rail edge does not have
  const ey0=q.y+q.h/2, vis=ey0>=r.y+4&&ey0<=r.y+r.h-4;
  const ey=vis? ey0 : (ey0<r.y? TOPBAR_H : H);
  if(r.x-sx<8) return;                            // rail sits on the plant, no room to turn
  const gx=(sx+r.x)/2;                            // turn halfway across, not against the rail
  // one path, not three line() calls: a corner can only be rounded where the
  // segments meet, and arcTo needs the run either side of it to do that
  const rad=Math.max(0,Math.min(8,Math.abs(gx-sx)/2,Math.abs(r.x-gx)/2,Math.abs(ey-sy)/2));
  ctx.save();
  ctx.lineCap="square"; ctx.lineJoin="round";
  ctx.setLineDash([4,3]);
  ctx.strokeStyle=C.amber; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(sx,sy);
  if(Math.abs(sy-ey)<1) ctx.lineTo(vis?r.x:gx,sy);
  else { ctx.arcTo(gx,sy,gx,ey,rad);
    if(vis){ ctx.arcTo(gx,ey,r.x,ey,rad); ctx.lineTo(r.x,ey); } else ctx.lineTo(gx,ey); }
  ctx.stroke();
  ctx.setLineDash([]);
  // a square at each end, so both read as attached rather than as a stray stroke.
  // each is CENTRED on what it marks, so the rail one is half swallowed by the
  // opaque rail and reads as slotted into its edge
  fillRect(sx-2,sy-2,4,4,C.amber);
  if(vis) fillRect(r.x-2,ey-2,4,4,C.amber);
  ctx.restore();
}

/* vx/vw are the viewport's left edge and width - GX/(W-2*GX) by default, or
   whatever the caller's own HTML rail leaves clear of the plant, so the
   canvas never draws under a docked panel. */
function drawPlant(y0,L,vh,vx,vw){
  PLANT_LM=layoutMetrics(); GY=y0;
  BANDS = ctlBands(!!L);
  layerTick();                                     // one memo/frame - see layers.js
  /* one clock/frame, and it is the PLANT's - so pause freezes every effect and
     16x runs them sixteen times over. The bench has no plant to take a time
     from, and nothing there should freeze, so it gets wall seconds. */
  fxSetClock(L ? L.t : fxWall());
  const GHp=gridH(), rowH=Y=>rowTop(Y+1)-rowTop(Y);
  // both screens are HTML rails now, so the content the view fits to is the grid alone
  vFit(vx==null?GX:vx, GY, vw==null?(W-2*GX):vw, vh||GHp, GX, GY, GW*CELL, GHp);
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  { const d=vPad();   // the halved letterbox - see vPad() in core/ui.js
    ctx.translate(VIEW.x+d.x-(VIEW.cx+VIEW.ox)*VIEW.s,
                  VIEW.y+d.y-(VIEW.cy+VIEW.oy)*VIEW.s); }
  ctx.scale(VIEW.s,VIEW.s);
  viewOn=true;
  fillRect(GX,GY,GW*CELL,GHp,C.well);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(X===0||X===GW-1||Y===0||Y===GH-1) fillRect(GX+X*CELL,rowTop(Y),CELL,rowH(Y),"#1c1210");
  const gl = L? "rgba(120,180,190,.03)" : "rgba(120,180,190,.05)";
  for(let X=0;X<=GW;X++) fillRect(GX+X*CELL,GY,1,GHp,gl);
  for(let Y=0;Y<=GH;Y++) fillRect(GX,rowTop(Y),GW*CELL,1,gl);
  frame(GX,GY,GW*CELL,GHp,C.edge2);
  for(let Y=0;Y<GH;Y++) txt("EL"+pad(GH-1-Y,1),GX+4,rowTop(Y)+11,{size:6.5,color:"#2c4148"});
  txt("KEEL / HULL",GX+GW*CELL/2,GY+GHp-6,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  txt("UPPER DECK / HULL",GX+GW*CELL/2,GY+12,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  ctx.save(); ctx.translate(GX+11,GY+GHp/2); ctx.rotate(-Math.PI/2);
  txt("FWD BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();
  ctx.save(); ctx.translate(GX+GW*CELL-7,GY+GHp/2); ctx.rotate(Math.PI/2);
  txt("AFT BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();

  // dark casing, then the coloured fluid line inside it, both round-jointed
  // (concentric radii) so a pipe bends rather than folds
  const PC=pipeColours(L), NET=pipeNetwork();
  pipeFieldRefresh(L);          // one solve read per frame, shared by every gauge and both pressure layers
  for(const pass of [0,1]) for(const r of NET){
    if(pass&&r.k==="hpi"&&L){ const tid=runTankId(r.key,r.k); if(tid&&!tankLive(L,tid)) continue; }   // LABEL: a VIEW declutter, pinned in tools/audit-geometry.js - see pipeRuns() (pipes.js)
    ctx.beginPath(); ctx.moveTo(r.pts[0][0],r.pts[0][1]);
    for(let i=1;i<r.pts.length;i++) ctx.lineTo(r.pts[i][0],r.pts[i][1]);
    ctx.lineCap="square"; ctx.lineJoin="round";
    const w = pipeWidth(runBore(r));
    ctx.lineWidth = pass? w : 2*w;
    ctx.strokeStyle = pass? pipeCol(PC,r.k) : PIPE_CASE;
    ctx.stroke();
  }
  ctx.lineJoin="miter";
  if(!L) pipeLines(NET);        // the line itself is where a waypoint is made
  if(L) pipeFlow(L);
  // over the pipes, under the machines - the one seam a layer can paint
  // without landing on a value tag, a control strip or a bypass row, because
  // every one of those belongs to the component loop that runs after this.
  // It is also the true seam for what a "field in the room" means: nobody
  // can survey the inside of a vessel, so the cells a layer may cover here
  // are exactly the cells a repair party could stand in. Move this call and
  // the next reactor to show dose gets it painted on top of its own gauges.
  layerPass("under",L);

  const tags=[];                // drawn last - see the push below
  for(const p of LAY.parts){
    const {x,y,w,h}=prect(p);
    const fit = fitted(p), live = L && fit;
    const ctl = live ? ctlFor(p,true,S.split) : null;
    // the strip is a property of the DESIGN: the bench reserves the room and
    // draws the plinth empty, so nothing jumps in size when you commission
    const byk = fit ? autoOn(p.id) : null,
          bh  = byk? CTL_H : 0,
          sh  = stripH(p,live), sy = y+h-sh;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p;
    // `fit &&`, or a NOT FITTED tag would draw a REPAIR key across itself -
    // the renderer should not rely on combatHit() never targeting one
    const dmgd = L && fit && L.dmgParts.includes(p.id);
    const ink = !fit?"#3c4c47" : dmgd?C.red : on?C.amber : (hov(wd)||drag)?C.bright : C.metal;
    const plinth = sh>0, py = sy+1-STRIP_PAD, pb = y+h-2;
    if(plinth) fillRect(x+2,y+2,w-4,h-4,C.panel);
    if(on) fillRect(x+1,y+1,w-2,h-2,"rgba(240,168,48,.07)");
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    if(fit) drawSym(p,x,y,w,h-sh-(plinth?4:0),ink,L);
    if(plinth) fillRect(x+2,py,w-4,pb-py,C.panelHi);   // tone, not a line, marks the plinth
    /* The bypass row used to get its own C.well band cut out of the plinth, so
       that defeating a safety system would not read as just another switch. It
       read as a black box with a key trapped in it instead, unrelated to the
       controls above it. The distinction it was buying is already carried by
       the switch itself - green AUTO against amber BYP, plus a board tile and a
       lamp - so the band is gone and the row stands on the plinth like every
       other row on the strip. */
    if(dmgd){ hatch(x+3,y+3,w-6,h-6,C.red,.4); badge(x+w-9,y+12,C.red);
      // a wrecked machine that is still energised. It dies down as the repair
      // party gets on top of it, so the effect tracks the work, not just the hit
      fxSparks(x+4,y+4,w-8,h-sh-8,fxEase(p.id+":dmg",L.repair&&L.repair.id===p.id?
        1-clamp(L.repair.t/L.repair.need,0,1):1),C.red);
      const symH=h-sh-(plinth?4:0);   // centred on the SYMBOL, not the whole component
      const busy=L.repair&&L.repair.id===p.id, kw=Math.min(w-16,86), kx=x+(w-kw)/2;
      button(kx,y+symH/2-9,kw,BTN_H,busy?Math.round(L.repair.t/L.repair.need*100)+"%"
             :p.access?"REPAIR":"NO ACCESS",
        {sunk:1,on:busy,danger:!p.access,size:7,sp:.8,fn:()=>act("repair",p.id)});
    }
    else if(!p.access && p.grp!=="shield" && fit) badge(x+w-9,y+12,C.amber);
    if(L&&fit){ const al=annLamp(p.id); if(al) lamp(x+10,y+11,al); }
    if(!L && fit && !dmgd){ const wc=warnFor(p.id); if(wc) dot(x+6,y+8,8,wc); }   // bench has no alarm lamp
    const v0 = L&&fit ? liveValue(p,L) : null, v = (ctl&&p.h<2)? null : v0;
    const nm = (v0&&!v)? partName(p)+"  "+v0 : partName(p);
    const tb = plinth ? sy-6 : sy-3;
    /* Held back to a last pass, below. A name and a value sit OUTSIDE their
       own box, in the same margin a pipe and its fittings run through, so a
       glyph landing on one buried the reading it was covering - the relief
       tank's level went under the very valve that fills it. The reading wins:
       a fitting is a thing you can find by looking, a number is not. Only the
       drawing waits; the TIP below still registers in loop order, because
       findTip() matches backwards and a deferred one would swallow the
       tooltip of every control mounted on this same box. */
    tags.push(()=>{
      tag(nm,x+w/2,tb-(v?11:1),6.5,.4,!fit?"#3c4c47":(on?C.amber:C.ink2));
      if(v) tag(v,x+w/2,tb,8,0,dmgd?C.red:liveColor(p,L));
      if(!fit) tag("NOT FITTED",x+w/2,y+h/2+2,6,.2,"#3c4c47");
    });
    // pushed LAST so findTip()'s backwards match doesn't swallow a control's own tooltip
    TIP(x,y,w,h,partName(p)+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ DAMAGED ]":"")+
        (p.access||p.grp==="shield"?"":"  [ NO ACCESS ]"),
      p.tip+(p.access||p.grp==="shield"?"":"  It is boxed in on every side - nobody could reach it to repair it."));
    if(ctl) ctl.forEach((row,i)=>ctlStrip(row,x+6,sy+i*CTL_H+1,w-12,BTN_H));
    if(byk && live) bypRow(byk,x+6,y+h-STRIP_PAD-bh+1,w-12,BTN_H);
  }
  pipeNozzles(NET);             // the joint, over the shell it lands on
  /* the break plumes go down BEFORE the layer pass, because a plume is behind
     a dial and not over it - and because an effect is not an instrument: the
     FLOW METERS switch must not be able to switch off the picture of a hole. */
  if(L) pipeBreaks(L);
  layerPass("over",L);          // instruments and annotations, on top of the machines
  /* ORDER IS PRIORITY: the hit test takes the LAST widget pushed. The tap
     the tap handle that used to ride the pointer here is gone with the tap
     shape: a fitting is placed in a CELL now, so nothing has to be aimed at a
     fraction along a pipe and nothing competes with the waypoint grips or the
     nozzles for the press. */
  if(!L){ partGhost();                  // where a machine would land...
          pipeGrips(NET);               // ...where a run runs...
          drawPortMarks();              // ...every port already placed...
          drawGhostPort();              // ...where the next one would go...
          drawLayPreview(); }           // ...and the pipe now being drawn
  pipeFitMarks(L,NET);
  for(const t of tags) t();     // every name and value, over the pipework
  viewOn=false; ctx.restore();

  // one key, not two: at fit the only useful move is in, and zoomed in the
  // only move is all the way back out. Reads FIT whenever off 1 in either
  // direction, since the view zooms out past fit too.
  { const zoomed=Math.abs(VIEW.z-1)>0.001, kw=52, kx=VIEW.x+VIEW.w-kw-4, ky=VIEW.y+4;
    button(kx,ky,kw,BTN_H,zoomed?"FIT "+VIEW.z.toFixed(1)+"X":"ZOOM",
      {sunk:1,size:6.5,sp:.6,fn:()=>{
        if(zoomed){ VIEW.z=1; VIEW.ox=VIEW.oy=0; }
        else { const p=LAY.parts.find(q=>q.id===sel), r=p&&prect(p);
          vZoom(1.8, r? r.x+r.w/2 : GX+GW*CELL/2, r? r.y+r.h/2 : GY+GHp/2); }
      }});
    TIP(kx,ky,kw,BTN_H,zoomed?"FIT THE WHOLE PLANT":"ZOOM IN",
      "The plant view pans and zooms. Roll the wheel over it to zoom about the pointer, hold the RIGHT button to drag the plant about, and this key jumps between the whole plant and a close look at whatever component is selected. Nothing about the plant itself changes - the hull is still sixteen cells by nine, and a component still has to fit in it.");
  }
  return VIEW.y+VIEW.h;
}
