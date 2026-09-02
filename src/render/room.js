"use strict";
/* room heat layers - see .claude/CLAUDE.md

   src/data/room.js OWNS the field; everything in here only reads it. The same
   split src/render/rad.js has from src/data/rad.js, and the same `data` memo
   key trick: all three layers below name "room", so the geometry is walked
   once a frame however many of them are on.

   AIR TEMP    (roomz, under) - the banded fill, the survey map for heat.
   H2 CLOUD    (roomh, under) - where the hydrogen is, and where it will burn.
   OXYGEN      (roomo, under) - what is left to burn WITH. Depletion only.
   BLAST       (roomp, under) - overpressure, against the machines' own limits.
   PART TEMP   (roomc, over)  - what each machine is standing in, against what
                 it was built for. This is the triage number: the field says
                 the room is hot, this says which machine is about to go.

   THERE IS ONE LAYER PER FIELD ON S, and that is the rule rather than a
   coincidence: s.roomT, s.roomH2, s.roomO2 and s.roomP are all places, so all
   four are askable. s.roomFlame is the exception and deliberately so - it is
   drawn INSIDE the hydrogen layer, because "where is the gas" and "where is
   it burning" are one question. */

/* THE BANDS ARE THE READOUT, exactly as ZONE is for radiation - steps, not a
   gradient, because "this bay is in the red band" is a fact you can act on
   and a smooth ramp is only a mood. The thresholds are the machines' own
   limits (ROLE.tsurv, layout.js) rather than round numbers: 340 K is where
   the instrument cabinet gives up and 400 K is where motors do, so the two
   inner boundaries are the two failures a player will actually meet.
   Green/amber/red is the alarm semantic and this USES it rather than stealing
   it: warm is fine, hot costs you a cabinet, and past that it costs you
   machines. */
const HEATZ=[
  {t:310, col:C.blue,  lab:"AMBIENT",  a:0.06},
  {t:340, col:C.green, lab:"WARM",     a:0.12},
  {t:400, col:C.amber, lab:"HOT",      a:0.20},
  {t:600, col:C.red,   lab:"SEVERE",   a:0.28},
  {t:1e9, col:C.red,   lab:"UNTENABLE",a:0.44},
];
const heatOf = v => { for(let i=0;i<HEATZ.length;i++) if(v<HEATZ[i].t) return i; return HEATZ.length-1; };

/* Fill, then the iso-line, and it SKIPS AN OCCUPIED CELL for the identical
   reason radZones() does: "under" is the room a body could stand in, a
   component draws no opaque backing of its own on the bench, and an
   unfiltered fill prints straight through a machine's own name and value
   tags. The boundary is drawn over the whole grid regardless - a line running
   along a machine's edge is a true fact about the field, because a machine IS
   a wall to this field (ROOM_BLOCK, room.js) and that is exactly where its
   shadow starts. */
function roomZones(data){
  const T=data.T, g=data.g;
  if(!T) return;
  const GN=GW*GH, z=new Uint8Array(GN);
  for(let i=0;i<GN;i++) z[i]=heatOf(T[i]);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      if(g[Y][X]) continue;
      const Z=HEATZ[z[Y*GW+X]];
      ctx.globalAlpha=Z.a; fillRect(GX+X*CELL,y,CELL,h,Z.col); ctx.globalAlpha=1;
    }
  }
  ctx.lineWidth=1;
  for(let Y=0;Y<GH;Y++){
    const y1=rowTop(Y+1);
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, x0=GX+X*CELL;
      ctx.strokeStyle=HEATZ[z[i]].col; ctx.globalAlpha=0.75;
      if(X<GW-1 && z[i]!==z[i+1]){
        ctx.beginPath(); ctx.moveTo(x0+CELL-.5,rowTop(Y)); ctx.lineTo(x0+CELL-.5,y1); ctx.stroke();
      }
      if(Y<GH-1 && z[i]!==z[i+GW]){
        ctx.beginPath(); ctx.moveTo(x0,y1-.5); ctx.lineTo(x0+CELL,y1-.5); ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
  }
}

/* THE FIGURE THE CELLS NO LONGER PRINT. Two layers ship on together, so a
   number in every cell was two numbers in every cell - and a survey map is
   read as a shape, not digit by digit. The reading is still there, on the
   pointer: ONE tip, for the ONE cell under the hand, off the same fields the
   washes are drawn from. It states the compartment's whole story rather than
   whichever layer happens to be up, because a cell is one place.
   The pointer is mapped exactly as findTip() maps it (ptIn(), core/ui.js), or
   a zoomed board would name a cell the hand is nowhere near. */
function roomCellTip(L){
  const p = viewOn ? (vIn(ui.ptr)?vPt(ui.ptr):null) : ui.ptr;
  if(!p) return;
  const X=Math.floor((p.x-GX)/CELL), Y=rowAt(p.y);
  if(X<0||X>=GW||Y<0||Y>=GH) return;
  const i=Y*GW+X, f=roomH2Frac(L,i)*100, live=L.roomP[i], worst=L.roomPPk[i];
  const band = worst>=BLAST_LO ? BLASTZ[blastOf(worst)].lab : "NONE";
  TIP(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y), "COMPARTMENT CELL",
      "Hydrogen "+f.toFixed(1)+" % by volume"
      +(L.roomFlame[i]>0 ? ", BURNING" : f>=H2_LFL*100 ? ", above the 4 % flammable limit" : "")
      +". Overpressure now "+live.toFixed(0)+" kPa. Worst this cell has ever seen "
      +worst.toFixed(0)+" kPa, which is the "+band+" band - and the soot is that figure.");
}

/* THE ONE LINE THAT MATTERS ON THIS LAYER IS THE FLAMMABILITY LIMIT, so it is
   drawn as a hard edge and everything under it as a wash: below 4 % by volume
   hydrogen is a gas in a room, above it the room is a bomb waiting for
   something at 773 K. Read off roomH2Frac(), the SAME expression the ignition
   test uses, so a cell cannot draw as safe and burn.
   VIOLET, and it is the only layer down here that draws a LINE. The blast
   below takes blue, green, amber and both reds, and the two ship on together -
   so a line on the compartment means one thing and one thing only, and the
   two layers on at once are still two readings.
   NO FIGURE IS PRINTED. A per-cell percentage over a cloud a hundred cells
   across is a page of digits, and with a second layer up it was digits on top
   of digits; the boundary is the reading and the number is on the hover. */
function roomH2Layer(data,L){
  if(!L) return;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=roomH2Frac(L,i);
      if(f<=0.002) continue;
      /* THE FLAME IS NOT DRAWN HERE ANY MORE. A burning cell used to be an
         amber branch inside this layer, which made the fire something a menu
         switch could turn off - and an explosion is not an instrument. It is
         roomBurnFx() now, drawn unasked at the plume seam. This layer answers
         where the gas is, and only that.
         AND IT SKIPS AN OCCUPIED CELL, the way roomZones() does: a hundred
         kilograms of hydrogen fills EVERY cell of the compartment, so a wash
         over the machines as well as the deck is the whole board painted one
         colour with the plant somewhere underneath it. Capped lower than a
         survey layer for the same reason - this is the one that can cover
         everything at once. */
      if(data.g[Y][X]) continue;
      ctx.globalAlpha = Math.min(0.22, 0.05+0.19*(f/H2_LFL));
      fillRect(GX+X*CELL,y,CELL,h, C.h2); ctx.globalAlpha=1;
    }
  }
  // and the limit itself, as an edge round the pocket that can burn
  ctx.strokeStyle=C.h2; ctx.lineWidth=2;
  const lit=i=>roomH2Frac(L,i)>=H2_LFL;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), y1=rowTop(Y+1);
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, x0=GX+X*CELL, on=lit(i);
      if(on && !data.g[Y][X]) hatch(x0,y,CELL,y1-y,C.h2,0.22);
      if(X<GW-1 && on!==lit(i+1)){
        ctx.beginPath(); ctx.moveTo(x0+CELL,y); ctx.lineTo(x0+CELL,y1); ctx.stroke(); }
      if(Y<GH-1 && on!==lit(i+GW)){
        ctx.beginPath(); ctx.moveTo(x0,y1); ctx.lineTo(x0+CELL,y1); ctx.stroke(); }
    }
  }
  ctx.lineWidth=1;
  roomCellTip(L);
}

/* THE BLAST, AND ITS BANDS ARE THE MACHINES' OWN LIMITS - the HEATZ argument
   exactly, one field over: 20 kPa is where a cabinet goes, 70 heavy rotating
   plant, 120 a pipe and 200 a pressure vessel. So "that bay went past the pipe
   band" is a fact you can act on.
   FIVE BANDS, FIVE COLOURS, AND THE FIRST ONE IS REACHABLE. The layer starts
   at BLAST_LO, so the old first row - everything BELOW 15 kPa - could never be
   drawn and its colour was legend-only, which left the two bands that cost
   machines sharing one red and told apart only by the figure printed in the
   cell. Take the figure away and they were the same band. The top band carries
   the BRIGHT red for the same reason.
   NOTHING IS DRAWN INSIDE A CELL: no hatch, no glyph, no number. The colour is
   the whole reading, so this layer can sit under the hydrogen without the two
   of them fighting over the same cell. */
const BLAST_LO=15;                        // kPa, below which the layer is silent
const BLASTZ=[
  {t:20,  col:C.blue,  lab:"PANELS",   a:0.10},
  {t:70,  col:C.green, lab:"CABINETS", a:0.16},
  {t:120, col:C.amber, lab:"MACHINES", a:0.24},
  {t:200, col:C.red,   lab:"PIPEWORK", a:0.34},
  {t:1e9, col:C.redHi, lab:"VESSELS",  a:0.48},
];
const blastOf = v => { for(let k=0;k<BLASTZ.length;k++) if(v<BLASTZ[k].t) return k;
                       return BLASTZ.length-1; };
/* ══ A BLAST IS OVER BEFORE ANYONE CAN LOOK AT IT, SO THE MARK IS THE READING ══
   s.roomP relieves on ROOM_P_TAU, half a second, and that is the physics and
   stays the physics - it left this layer reading as permanently empty, because
   the whole picture existed for about a dozen frames and was gone. A renderer
   holding its own fading peak was the first answer and was the wrong one: it
   was display state, so it died on a reload and a replay of the same recording
   showed a clean room. The layer now draws s.roomPPk, the HIGH-WATER MARK ON
   S - the worst overpressure each cell has ever seen, monotonic, never bled and
   never cleared. A compartment that has been blown apart stays blown apart
   until something in the plant cleans it, which is a mechanic and not a fade.
   TWO CHANNELS, ONE FIGURE: soot says how hard, the band colour says what that
   pressure was enough to break. The live wave is the pulse on top. */
const SCAR_FULL=200;                      // the top band, so the darkest soot is a broken vessel
const scarF = v => v<BLAST_LO ? 0 : Math.min(1,(v-BLAST_LO)/(SCAR_FULL-BLAST_LO));
function roomPLayer(data,L){
  if(!L) return;
  const pk=L.roomPPk;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, v=pk[i];
      if(v<BLAST_LO) continue;
      const z=blastOf(v), Z=BLASTZ[z], x0=GX+X*CELL;
      // the burnt deck first, then what the pressure was enough to break
      ctx.globalAlpha=0.25+0.65*scarF(v); fillRect(x0,y,CELL,h,C.scar);
      ctx.globalAlpha=Z.a; fillRect(x0,y,CELL,h,Z.col); ctx.globalAlpha=1;
      /* THE FRONT ITSELF, over the standing mark: a cell the wave is in RIGHT
         NOW breathes, so the half-second the bang lasts is still visible as an
         event rather than only as the stain left behind by one. */
      if(L.roomP[i]>=BLAST_LO) fxPulse(x0,y,CELL,h,Z.col,1,4);
      // the boundary of the damaged region, drawn as an edge rather than left
      // as a change of wash - the same argument roomZones() makes
      if(X<GW-1 && blastOf(pk[i+1])!==z) fillRect(x0+CELL-1,y,1,h,Z.col);
      if(Y<GH-1 && blastOf(pk[i+GW])!==z) fillRect(x0,rowTop(Y+1)-1,CELL,1,Z.col);
    }
  }
  roomCellTip(L);
}

/* WHAT IS LEFT TO BURN WITH. Oxygen is a place too - s.roomO2 is on S in the
   same shape as the heat and the hydrogen - and the ONE line that matters on
   it is O2_LOC, below which nothing ignites whatever else is in the cell. So
   this draws DEPLETION and nothing else: a cell at what air actually holds
   prints nothing at all, because a picture of 2040 cells at ambient is noise
   and the question being asked is where the fire has eaten its own air.
   Read off roomO2Frac(), the same expression the flammability test uses, for
   the same reason the hydrogen layer reads roomH2Frac(). */
function roomO2Layer(data,L){
  if(!L) return;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=roomO2Frac(L,i);
      if(f>=O2_FRAC0*0.9) continue;
      const inert = f<O2_LOC;
      ctx.globalAlpha = inert ? 0.42 : 0.10+0.30*(1-f/O2_FRAC0);
      fillRect(GX+X*CELL,y,CELL,h, inert?C.blue:C.ink2); ctx.globalAlpha=1;
      if(inert) txt((f*100).toFixed(0)+"%", GX+X*CELL+CELL/2, y+h-3,
                    {size:8, align:"center", color:C.blue});
    }
  }
}

/* THIS MACHINE'S OWN METAL, against what THIS machine was built for - the
   triage number, and the reason the layer sits at the "over" seam: the
   reading has to be ON the box it is about. It is the skin (partSkin(),
   room.js) and not the air, because the skin has mass: a box lags the room it
   stands in, and it is the box that fails. A role with no tsurv is structure
   and prints nothing, which is the honest answer rather than a zero. */
function roomPart(data,L){
  if(!L) return;
  for(const p of LAY.parts){
    const lim=partTsurv(p);
    if(!lim || !fitted(p)) continue;
    const v=partSkin(L,p), {x,y,w}=prect(p);
    txt(v.toFixed(0)+"K", x+w/2, y+20,
      {size:8, align:"center", color:v>lim?C.red:v>lim-40?C.amber:C.ink2});
  }
}

/* ══ THE EXPLOSION IS AN EFFECT, NOT A LAYER ══
   Drawn unasked, at the same seam the break plumes are drawn at and for the
   same two reasons: an effect is behind a dial rather than over it, and a menu
   switch must not be able to turn off the picture of the compartment going up.
   The BLAST layer is the survey of what a bang LEFT; this is the bang. */
/* ══ THE EXPLOSION, PORTED FROM tools/mock-explosion.html ══
   This is the mockup's own effect code, moved across with the mockup's
   numbers, and the differences are only the two it has to have: it reads the
   sim's fields (s.roomFlame, s.roomP, s.roomT) instead of the mockup's, and it
   draws in board coordinates. Rebuilding it from a description was tried three
   times and produced three effects that were not it.
   IT KEEPS PARTICLES. rings, sparks and smoke are lists, exactly as they are
   in the mockup - a ring is born at a bang and lives its own second, which a
   phase off a clock cannot express: a pure function of "the pressure right
   now" has no way to remember that this ring started small. They are DISPLAY
   STATE and none of it is on S - the standing FXR (fx.js) and the damped
   meters (pipes.js) have. Off the PLANT's clock, so a pause freezes the
   debris in the air, and a clock that has gone backwards is a reset or a
   scrub, which throws every list away.
   THE DICE ARE THE RENDERER'S. src/sim rolls nothing loose (rng.js, cursor on
   S); this is a picture, and its scatter is a local generator seeded once, so
   it cannot touch the sim's stream and a headless draw needs nothing. */
const BURN_TSPAN=1400;                    // K over ambient that reads as fully lit
const FLASH_MIN=10;                       // cells lighting in ONE frame before it is a bang
let burnRings=[], burnSparks=[], burnSmoke=[], burnClk=0, flashT=0, flashA=0.5, glowF=null;
let burnSeed=0x9e3779b9;
const burnRnd=()=>{ burnSeed^=burnSeed<<13; burnSeed^=burnSeed>>>17; burnSeed^=burnSeed<<5;
                    return (burnSeed>>>0)/4294967296; };
function burnReset(){ burnRings=[]; burnSparks=[]; burnSmoke=[]; flashT=0; if(glowF) glowF.fill(0); }

/* the mockup's spawn(), one for one: the ring off the local overpressure, the
   sparks off the same, the smoke off the fact that something burnt here.
   EVERY EXTENT IS A FRACTION OF P_FULL, NOT A CONSTANT. The mockup varied
   alpha and width and left radius, speed and life fixed, so a 40 kPa puff and
   a stoichiometric front threw the same six-cell ring at the same speed and
   read as one size of bang at four opacities. What differs now is how far it
   REACHES: a lean crawl throws a spark two cells, a full deflagration throws
   a ring across the compartment and holds it there twice as long. */
const P_FULL=600;                         // kPa of rise that reads as a full bang
function burnSpawn(x,y,q,p,dt){
  const r=dt*50;                           // the mockup spawned per 20 ms tick
  const k=clamp(p/P_FULL,0,1);
  if(p>25 && burnRnd()<0.25*r)
    burnRings.push({x,y, r:CELL*(0.25+1.1*k), v:CELL*(5+30*k),
                    a:0.22+0.55*k, w:1+3.5*k, d:2.6-1.5*k});
  const n=Math.min(16,Math.round((0.6+7*k)*(0.35+0.65*q)*r));
  for(let j=0;j<n;j++){
    const th=burnRnd()*6.283, sp=(25+p*1.7)*(0.4+burnRnd());
    burnSparks.push({x,y,vx:Math.cos(th)*sp,vy:Math.sin(th)*sp,
                     life:(0.3+0.5*k)*(0.6+burnRnd()*0.8),t:0});
  }
  // steam is the PRODUCT and it is hot, so it goes up
  if(burnRnd()<0.30*r)
    burnSmoke.push({x,y, r:CELL*(0.25+0.6*q), vy:-CELL*(0.5+0.9*q),
                    life:1.6+q*1.8+burnRnd()*2, t:0, a:0.18+0.20*q, g:CELL*(0.3+0.6*q)});
}
function burnParticles(dt){
  for(const o of burnRings){ o.r+=o.v*dt; o.a-=dt*o.d; }
  burnRings=burnRings.filter(o=>o.a>0);
  for(const o of burnSparks){ o.t+=dt; o.x+=o.vx*dt; o.y+=o.vy*dt; o.vy+=90*dt;
                             o.vx*=0.96; o.vy*=0.96; }
  burnSparks=burnSparks.filter(o=>o.t<o.life);
  for(const o of burnSmoke){ o.t+=dt; o.y+=o.vy*dt; o.vy*=0.99; o.r+=o.g*dt; }
  burnSmoke=burnSmoke.filter(o=>o.t<o.life);
}

/* WHICH CELLS A MACHINE IS STANDING ON. The fire is a gas fire in the AIR of
   the compartment: a machine is a wall to it (ROOM_BLOCK, room.js), so nothing
   here may be drawn on a box. Left unmasked, a flame front running past a
   pump, its thrown debris and its shock rings all landed ON the pump, and a
   machine taking a hit read as the machine detonating - which is not what the
   sim does to it at all. A hit is a state change (DMGFX, step.js): a jammed
   drive, a severed line, a leak. It never explodes. */
function burnOcc(n){
  const occ=new Uint8Array(n);
  for(const p of LAY.parts)
    for(let y=p.y;y<p.y+p.h;y++) for(let x=p.x;x<p.x+p.w;x++)
      if(y>=0&&y<GH&&x>=0&&x<GW) occ[y*GW+x]=1;
  return occ;
}
const burnFree=(occ,x,y)=>{
  const X=Math.floor((x-GX)/CELL), Y=Math.floor((y-rowTop(0))/CELL);
  if(X<0||Y<0||X>=GW||Y>=GH) return false;
  return !occ[Y*GW+X];
};
function roomBurnFx(s){
  if(!s.roomFlame) return;
  const T=s.roomT, Fl=s.roomFlame, Pr=s.roomP, N=Fl.length;
  const occ=burnOcc(N);
  const now=fxClock();
  if(now<burnClk){ burnReset(); burnClk=now; }
  const dt=clamp(now-burnClk,0,0.25); burnClk=now;
  /* LIT, the mockup's: how recently this cell burnt, so a front that has moved
     on fades out over a third of a second instead of snapping off. */
  if(!glowF || glowF.length!==N) glowF=new Float64Array(N);
  const gk=Math.exp(-dt/0.35);
  let bx=0, by=0, bw=0, hot=0, fresh=0, pmax=0;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, fl=Fl[i], p=Pr[i];
      glowF[i] = fl>0 ? 1 : glowF[i]*gk;
      if(occ[i]) continue;                  // a machine is a wall to this fire
      const lit=glowF[i];
      if(fl<=0 && lit<=0.02 && p<=0) continue;
      const x0=GX+X*CELL, dT=T[i]-T_HULL;
      if(p>pmax) pmax=p;
      if(fl>0 || lit>0.02){
        /* the mockup's colour ladder, off the cell's own gas temperature:
           white at a stoichiometric front, red for a lean crawl */
        const col = dT>1800 ? C.fire : dT>1100 ? C.fire2 : dT>450 ? C.amber : C.red;
        const g=clamp(dT/BURN_TSPAN,0,1);
        /* AND THE FLAME FILLS AS MUCH OF ITS CELL AS IT HAS HEAT IN IT. A
           flat fillRect made every fire the same size by construction - a
           cool lean crawl and a stoichiometric front were both one solid
           cell, differing only in colour, so the only thing that could look
           big was a fire covering more cells. Inset off the same g the bloom
           weighs, and off the fade, so an ember shrinks as it dies. */
        const iv=(0.34+0.66*g)*(fl>0?1:Math.max(0.4,lit));
        const iw=CELL*iv, ih=h*iv;
        ctx.globalAlpha=Math.min(0.95, Math.max(fl>0?0.55:0, lit));
        fillRect(x0+(CELL-iw)/2, y+(h-ih)/2, iw, ih, col); ctx.globalAlpha=1;
        bx+=X*g; by+=Y*g; bw+=g; if(g>hot) hot=g;
        if(fl>0 && fl<0.15) fresh++;
      }
      // and the effects are BORN from the physics, never scheduled
      if(fl>0) burnSpawn(x0+CELL/2, y+h/2, clamp(dT/BURN_TSPAN,0,1), p, dt);
    }
  }
  burnParticles(dt);
  // SHOCK RINGS - born only where the overpressure was real
  /* THE WAVE IS CLIPPED TO THE DECK. A ring is one circle and it cannot be
     "skipped per cell", so the deck itself is the clip: every free cell is
     added to one path and the rings are stroked inside it. The wave stops at
     the machines, which is where the air stops. */
  ctx.save();
  ctx.beginPath();
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(!occ[Y*GW+X]) ctx.rect(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y));
  ctx.clip();
  for(const o of burnRings){
    ctx.globalAlpha=Math.max(0,o.a); ctx.strokeStyle=C.bright; ctx.lineWidth=o.w;
    ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,6.284); ctx.stroke(); ctx.globalAlpha=1;
  }
  ctx.restore();
  ctx.lineWidth=1;
  // SPARKS - thrown debris, cooling as they fly
  for(const o of burnSparks){
    if(!burnFree(occ,o.x,o.y)) continue;    // debris does not fly through a box
    const k=1-o.t/o.life;
    ctx.globalAlpha=Math.max(0,k); ctx.fillStyle = k>0.6?C.fire:k>0.3?C.amber:C.red;
    ctx.fillRect(o.x,o.y,2,2); ctx.globalAlpha=1;
  }
  // SMOKE - steam, and it rises because it is hot
  for(const o of burnSmoke){
    if(!burnFree(occ,o.x,o.y)) continue;
    const k=1-o.t/o.life;
    ctx.globalAlpha=Math.max(0,o.a*k); ctx.fillStyle=C.smoke;
    ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,6.284); ctx.fill(); ctx.globalAlpha=1;
  }
  /* ONE BLOOM over the burning region: a fire is one light source, and a glow
     per cell reads as a checkerboard. */
  if(bw>0.2 && hot>0.05){
    const cx=GX+(bx/bw+0.5)*CELL, cy=rowTop(0)+(by/bw+0.5)*CELL;
    // the floor was two and a half cells, which is a bigger glow than most
    // fires ever earn - a single lit cell bloomed like a bay alight
    const r=Math.max(CELL*1.2, Math.sqrt(bw)*CELL*2.2);
    const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    gr.addColorStop(0,   alphaC(C.fire, 0.40*hot));
    gr.addColorStop(0.45,alphaC(C.amber,0.16*hot));
    gr.addColorStop(1,   alphaC(C.red,  0));
    ctx.fillStyle=gr; ctx.fillRect(cx-r,cy-r,r*2,r*2);
  }
  /* THE FLASH - the mockup's 0.16 s of white at the moment of the bang. A
     STANDING FLAME lights one or two cells a second for as long as it is fed,
     so it takes a CROWD: measured on a severed hot leg, a standing fire lit
     0-2 cells a frame for ninety seconds and the deflagration that started it
     lit 142 in one frame.
     AND ITS SIZE IS THE BANG'S. 0.16 s of the same white was the one thing
     that did not care how big the event was, so the largest and smallest
     deflagration a compartment can hold flashed identically. Off BOTH the
     peak overpressure and how much of the deck lit at once, because a slow
     wide burn is a big event at low pressure. */
  if(fresh>=FLASH_MIN){
    const k=clamp(Math.max(pmax/P_FULL, fresh/120),0,1);
    flashT=Math.max(flashT, 0.08+0.30*k); flashA=0.18+0.42*k;
  }
  flashT=Math.max(0,flashT-dt);
  if(flashT>0){
    /* AND THE FLASH IS THE AIR TOO. Over the whole board it whited out every
       machine at the moment of a bang, which is the same lie the debris was
       telling: the boxes did not go off, the gas around them did. */
    ctx.globalAlpha=Math.min(flashA,flashT*3.2);
    for(let Y=0;Y<GH;Y++){
      const y=rowTop(Y), h=rowTop(Y+1)-y;
      for(let X=0;X<GW;X++) if(!occ[Y*GW+X]) fillRect(GX+X*CELL,y,CELL,h,C.fire);
    }
    ctx.globalAlpha=1;
  }
}
