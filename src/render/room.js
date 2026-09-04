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

/* ONE CELL, EVERY LAYER'S READING, ONE VALUE TO A ROW. The washes are read as
   a shape, so the figures live on the pointer instead of in 2040 cells.
   A ROW THAT WOULD READ ZERO IS NOT DRAWN: eight rows on every cell of an
   undamaged ship were seven zeroes hiding the one temperature. The test is on
   the ROUNDED figure, so nothing reads "0.0 %". Air temperature and oxygen are
   unconditional - a compartment always has both, and 0 % oxygen is a finding
   rather than an absence. */
/* ══ ONE CELL, EVERY READING IT HAS, AND IT IS NOT ON A SWITCH ══
   It used to be called by the H2 and BLAST layers, so a WALL - structure on the
   board, and nothing to do with either field - only stated its material, its
   thickness and its rating while a gas layer happened to be up. drawPlant()
   calls it unconditionally now, once, at the layer seam: a cell has ONE
   tooltip and it says whatever that cell actually has.
   `L` may be null - the bench has no plant to have a temperature - so every
   live row is gated on it and the structure rows are not. */
function roomCellTip(L){
  const p = viewOn ? (vIn(ui.ptr)?vPt(ui.ptr):null) : ui.ptr;
  if(!p) return;
  const X=Math.floor((p.x-GX)/CELL), Y=rowAt(p.y);
  if(X<0||X>=GW||Y<0||Y>=GH) return;
  const i=Y*GW+X, rows=[];
  const row=(lab,s)=>rows.push(lab+s);
  if(L){
    const rad=layerData("rad",L), r=rad.f[i], T=L.roomT[i],
          live=L.roomP[i], worst=L.roomPPk[i], h2=roomH2Frac(L,i)*100;
    if(r>=0.005) row("DOSE         ",r.toFixed(2)+" x  "+ZONE[zoneOf(r)].lab);
    row("AIR TEMP     ",T.toFixed(0)+" K  "+HEATZ[heatOf(T)].lab);
    if(h2>=0.05) row("HYDROGEN     ",h2.toFixed(1)+" %");
    row("OXYGEN       ",(roomO2Frac(L,i)*100).toFixed(1)+" %");
    if(L.roomFlame[i]>0) row("FLAME        ","BURNING");
    if(live>=0.5) row("BLAST NOW    ",live.toFixed(0)+" kPa");
    if(worst>=BLAST_LO) row("BLAST PEAK   ",worst.toFixed(0)+" kPa  "+BLASTZ[blastOf(worst)].lab);
    if(rad.cells.has(i)) row("REPAIR CELL  ","YES");
  }
  /* THE WALL AND WHAT IT ENCLOSES. A painted cell states its own material,
     thickness, rating and arm; any cell inside a region adds the region,
     because that is the question a player standing anywhere inside one is
     actually asking. */
  { const m=matOf(X,Y);
    if(m){ row("WALL         ",m.name+"  "+matThick(X,Y).toFixed(1)+" mm"+(L&&matOpen(L,X,Y)?"  BREACHED":""));
           row("WALL RATING  ",(matRating(X,Y)*1000).toFixed(1)+" kPa   arm "+(matSpanEff(X,Y)*MPC).toFixed(1)+" m"); }
    const g=matSealAt(X,Y);
    if(g){
      row("REGION       ",g.cells.length+" cells   "+matRegVol(g).toFixed(1)+" m3   "+(matSealed(L||null,g)?"SEALED":"OPEN"));
      if(L){ row("REGION PRESS ",(regionDP(L,g)*1000).toFixed(1)+" kPa");
             const d=regionFloodM(L,g);
             if(d>0.05) row("FLOODED TO   ",d.toFixed(1)+" m   "+(regionSump(L,g)/1000).toFixed(1)+" t"); } } }
  if(!rows.length) return;
  TIP(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y), "CELL "+X+","+Y, rows.join("\n"));
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
  ctx.strokeStyle=C.h2; ctx.lineWidth=1.2;
  const lit=i=>roomH2Frac(L,i)>=H2_LFL;
  const segs=[], atCorner={}, px=X=>GX+X*CELL, py=Y=>rowTop(Y);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), y1=rowTop(Y+1);
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, on=lit(i);
      if(on && !data.g[Y][X]) hatch(GX+X*CELL,y,CELL,y1-y,C.h2,0.22);
      if(X<GW-1 && on!==lit(i+1)) segs.push([X+1,Y,X+1,Y+1]);
      if(Y<GH-1 && on!==lit(i+GW)) segs.push([X,Y+1,X+1,Y+1]);
    }
  }
  for(const s of segs) for(const k of [s[0]+","+s[1], s[2]+","+s[3]]) (atCorner[k]=atCorner[k]||[]).push(s);
  // exactly two edges meeting is a corner and is filleted; a tee or a loose end stays square
  const R=Math.min(5,CELL*0.35), corner=k=>(atCorner[k]||[]).length===2;
  const trim=(s,end)=>{
    const ax=px(s[0]), ay=py(s[1]), bx=px(s[2]), by=py(s[3]);
    const len=Math.hypot(bx-ax,by-ay)||1, r=Math.min(R,len*0.4);
    const ux=(bx-ax)/len, uy=(by-ay)/len;
    return end ? [bx-ux*(corner(s[2]+","+s[3])?r:0), by-uy*(corner(s[2]+","+s[3])?r:0)]
               : [ax+ux*(corner(s[0]+","+s[1])?r:0), ay+uy*(corner(s[0]+","+s[1])?r:0)];
  };
  ctx.beginPath();
  for(const s of segs){
    const p0=trim(s,0), p1=trim(s,1);
    ctx.moveTo(p0[0],p0[1]); ctx.lineTo(p1[0],p1[1]);
  }
  for(const k in atCorner){
    if(!corner(k)) continue;
    const cx=+k.split(",")[0], cy=+k.split(",")[1];
    const e=atCorner[k].map(s=>trim(s, s[0]+","+s[1]===k?0:1));
    ctx.moveTo(e[0][0],e[0][1]); ctx.quadraticCurveTo(px(cx),py(cy),e[1][0],e[1][1]);
  }
  ctx.stroke();
  ctx.lineWidth=1;
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
/* ══ THE EXPLOSION, PORTED FROM mockups/mock-explosion2.html ══
   This is the mockup's own effect code, moved across with the mockup's
   numbers, and the differences are only the two it has to have: it reads the
   sim's fields (s.roomFlame, s.roomP, s.roomT) instead of the mockup's, and it
   draws in board coordinates. Rebuilding it from a description was tried three
   times and produced three effects that were not it.
   THE EFFECT BELONGS TO A BANG, NOT TO A CELL. Every burning cell used to
   spawn its own ring, its own debris and its own smoke, so a deflagration read
   as a hundred small simultaneous detonations laid side by side - every one
   the same size, because every cell is the same size. The burn feeds EVENTS
   now: one centre, one footprint, one peak pressure each, as many as the
   compartment has fires, merging when their fires meet or their fireballs
   overlap. A cell belongs to whatever burnt beside it (evFor), which is the
   same question the flame spread already answers - asked of the centroid
   instead, a wide flat cloud tore its own event into three, because an
   equal-area radius is shorter than the long axis of the burnt region.
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
const P_FULL=600;                         // kPa of rise that reads as a full bang
const BED_DIM=0.42;                       // the flame bed under a fireball, not instead of one
const SMOKE_RMAX=CELL*2.6;                // a puff shears apart rather than swelling for ever
const RING_GAP=6;                         // m the last front must be clear before another leaves
const EV_END=0.30;                        // s of quiet before an event is over
const EV_NB=2;                            // cells of reach when a cell looks for its event
const MERGE_K=0.95;                       // how deep two fireballs overlap before they are one
const PX_M=CELL/MPC;                      // pixels per metre on the board
let burnRings=[], burnSparks=[], burnSmoke=[], burnEvs=[], burnTouch=[], burnShake=0, burnBlock=0,
    burnClk=0, flashT=0, flashA=0.5, glowF=null;
let burnSeed=0x9e3779b9;
const burnRnd=()=>{ burnSeed^=burnSeed<<13; burnSeed^=burnSeed>>>17; burnSeed^=burnSeed<<5;
                    return (burnSeed>>>0)/4294967296; };
function burnReset(){ burnRings=[]; burnSparks=[]; burnSmoke=[]; burnEvs=[]; burnTouch=[];
                      flashT=0; burnShake=0; if(glowF) glowF.fill(0); }
// a screen with no plant never steps this, so a live shake would kick for ever
function burnIdle(){
  if(burnShake||burnEvs.length||burnRings.length||burnSparks.length||burnSmoke.length) burnReset();
  burnClk=0;
}
/* THE DECK KICKS, AND THE WHOLE BOARD DOES. drawPlant() applies it, because a
   shake inside this function would move the explosion off the plant it is
   happening to instead of moving both. Floored, or a dead shake jitters the
   board for ever at a fifth of a pixel. */
const burnShakeAt=()=>burnShake>0.2?burnShake:0;
/* off the PLANT's clock, not a fresh die: a per-frame roll kept jittering the
   board while the sim was paused, and the amplitude alone froze. */
const burnShakeRnd=k=>fxHash(Math.round(fxClock()*120)*2+k)-0.5;

/* ══ ONE BANG IS ONE RECORD ══
   It opens on the first cell that burns, absorbs every cell that burns into
   its own footprint, and closes EV_END after the last flame. Its centre is
   weighted by HEAT, so the effect follows the fire as the front crosses
   instead of sitting where the spark was; its radius is the equal-area circle
   over the footprint, which is a real extent in metres. */
function evNew(n){
  const e={mask:new Uint8Array(n), wx:0,wy:0,w:0,cells:0,r:0,cx:0,cy:0,p:0,hot:0,hotF:0,wF:0,
           quiet:0,done:0,fade:1,burning:0,newF:0,ring:null,pEmit:0,flashed:0,sparkBudget:0,smokeT:0};
  burnEvs.push(e); return e;
}
// finding TWO neighbours is how two bangs discover they have met
function evFor(i,n){
  const X=i%GW, Y=(i/GW)|0;
  let home=null;
  for(let dy=-EV_NB;dy<=EV_NB;dy++) for(let dx=-EV_NB;dx<=EV_NB;dx++){
    const x=X+dx, y=Y+dy;
    if(x<0||y<0||x>=GW||y>=GH) continue;
    const j=y*GW+x;
    for(const e of burnEvs){
      if(e.done || !e.mask[j]) continue;
      if(!home) home=e;
      else if(home!==e) burnTouch.push([home,e]);
    }
  }
  return home || evNew(n);
}
function evFeed(e,i,g,p){
  const X=i%GW, Y=(i/GW)|0;
  e.wx+=X*g; e.wy+=Y*g; e.w+=g; e.wF+=g; e.burning=1;
  if(p>e.p) e.p=p;
  if(g>e.hotF) e.hotF=g;
  if(!e.mask[i]){ e.mask[i]=1; e.cells++; e.newF++; }
}
function evStep(dt){
  for(const e of burnEvs){
    e.hot=e.hotF; e.hotF=0;
    e.quiet = e.burning ? 0 : e.quiet+dt;
    if(e.w>0){ e.cx=e.wx/e.w; e.cy=e.wy/e.w; }
    e.r=Math.sqrt(e.cells/Math.PI);
    if(!e.burning && e.quiet>EV_END) e.done=1;
    e.fade = e.done ? Math.max(0, e.fade-dt/0.55) : 1;
  }
  evMerge();
  for(const e of burnEvs) e.burning=0;
  burnEvs=burnEvs.filter(e=>!(e.done && e.fade<=0));
}
/* AND TWO BANGS THAT REACH EACH OTHER ARE ONE BANG. Overlapping fireballs read
   as two fires side by side and their fronts cross like ripples, which is not
   what a compartment full of one gas does. */
function evFold(A,B){
  A.wx+=B.wx; A.wy+=B.wy; A.w+=B.w; A.wF+=B.wF;
  A.p=Math.max(A.p,B.p); A.hot=Math.max(A.hot,B.hot);
  A.fade=Math.max(A.fade,B.fade); A.quiet=Math.min(A.quiet,B.quiet);
  A.done=A.done&&B.done; A.burning=A.burning||B.burning;
  A.pEmit=Math.max(A.pEmit,B.pEmit); A.flashed=Math.max(A.flashed,B.flashed);
  A.sparkBudget+=B.sparkBudget; A.newF+=B.newF;
  for(let i=0;i<B.mask.length;i++) if(B.mask[i] && !A.mask[i]){ A.mask[i]=1; A.cells++; }
  A.r=Math.sqrt(A.cells/Math.PI);
  if(A.w>0){ A.cx=A.wx/A.w; A.cy=A.wy/A.w; }
  ringFold(A,B);
  const j=burnEvs.indexOf(B); if(j>=0) burnEvs.splice(j,1);
}
function evMerge(){
  for(const [A,B] of burnTouch)              // fires that have actually met
    if(A!==B && burnEvs.indexOf(A)>=0 && burnEvs.indexOf(B)>=0) evFold(A,B);
  burnTouch=[];
  for(let a=0;a<burnEvs.length;a++) for(let b=a+1;b<burnEvs.length;b++){
    const A=burnEvs[a], B=burnEvs[b];
    if(Math.hypot(A.cx-B.cx, A.cy-B.cy) > (A.r+B.r)*MERGE_K) continue;
    evFold(A,B); b--;
  }
}
/* Two fronts that catch each other are one front: the leading one survives and
   takes the other's overpressure, because two waves that meet superpose - and a
   wave already launched keeps its own origin, so no new circle is born. */
function ringFold(A,B){
  const keep = !A.ring ? B.ring : !B.ring ? A.ring : (A.ring.R>=B.ring.R ? A.ring : B.ring);
  const drop = keep===A.ring ? B.ring : A.ring;
  if(drop){ const j=burnRings.indexOf(drop); if(j>=0) burnRings.splice(j,1); }
  if(keep && drop){ keep.dp=Math.max(keep.dp,drop.dp); keep.dp0=Math.max(keep.dp0,drop.dp0); }
  A.ring=keep;
}

/* ══ WHAT ONE EVENT THROWS ══ every emission is the EVENT's, or at a rate the
   event sets - never one per burning cell. The magnitudes are its peak
   overpressure and its footprint, so a lean crawl over four cells and a
   stoichiometric flash over four hundred cannot look alike. */
function evFx(e,dt){
  const k=clamp(e.p/P_FULL,0,1);
  const cx=GX+(e.cx+0.5)*CELL, cy=rowTop(0)+(e.cy+0.5)*CELL, rad=e.r*CELL;
  /* A DEFLAGRATION RADIATES A TRAIN OF FRONTS, NOT ONE. The two clocks do not
     match: a wave crosses this compartment in about 60 ms and the burn behind
     it runs for a second, so one launched-and-forgotten front is off the board
     before the fire has made most of its pressure - it left at the first 20 kPa
     of a bang that went on to 650 and was down to 5 kPa by then. A closed
     compartment compresses its air continuously as the flame eats the room,
     which radiates one front every time the pressure climbs. One per 35 %,
     each carrying the source pressure of the moment it left.
     AND IT LEAVES FROM A REAL SOURCE SIZE: a wave in a compartment ROOM_DEPTH
     deep is not spreading cylindrically until it is wider than the deck is
     deep, so half the depth is the floor under the source radius. */
  /* AND THE TRAIN IS SPACED IN DISTANCE, NOT IN PRESSURE ALONE. The live plant
     goes from 20 kPa to its peak in a few tenths of a second, so a gate on
     pressure by itself let five fronts leave almost together and they read as
     one thick flickering ring rather than as a wave. A new front only leaves
     once the last one is RING_GAP clear of the source: what is drawn then
     stands for everything the burn radiated in between. */
  if(!e.done && e.p>20 && e.p > e.pEmit*1.6 &&
     (!e.ring || e.ring.R > Math.max(ROOM_DEPTH/2, e.r*MPC) + RING_GAP)){
    e.pEmit=e.p;
    e.ring={x:cx, y:cy, R:Math.max(ROOM_DEPTH/2, e.r*MPC), dp:e.p, dp0:e.p, u:0};
    burnRings.push(e.ring);
    /* AND A FRONT LEAVING THROWS SOMETHING. The trickle of debris off the
       advancing flame is what a FIRE does; the burst at the moment the wave
       goes is what a BANG does, and without it the picture had no instant in
       it - everything was a rate. */
    for(let j=0;j<Math.round(4+26*k);j++){
      const th=burnRnd()*6.283, sp=(90+e.p*2.2)*(0.35+burnRnd());
      burnSparks.push({x:cx+Math.cos(th)*rad*0.8, y:cy+Math.sin(th)*rad*0.8,
                       vx:Math.cos(th)*sp, vy:Math.sin(th)*sp,
                       life:(0.35+0.7*k)*(0.6+burnRnd()*0.8), t:0});
    }
    // and it kicks the deck: the mockup's own shake, off the same peak
    burnShake=Math.max(burnShake, Math.min(9, e.p/34));
  }
  // THE FLASH - off the peak and the footprint together, because a slow wide
  // burn is a big event at low pressure
  if(!e.done && e.p>12){
    const f=clamp(Math.max(k, e.cells/260),0,1);
    if(f>e.flashed){ e.flashed=f; flashT=Math.max(flashT,0.08+0.30*f); flashA=0.16+0.44*f; }
  }
  /* DEBRIS - one shower per bang, thrown from the fireball's EDGE outward, and
     priced off the CELLS THE FRONT TOOK THIS FRAME rather than off how many are
     alight. The mockup spent this budget out of the heat RELEASED in the tick,
     which falls to nothing the moment the front stops; standing lit cells kept
     paying instead, and a five-second burn stood 963 sparks in the air. */
  if(e.newF>0){
    e.sparkBudget += e.newF*(0.15+1.6*k);
    let n=Math.min(24, Math.floor(e.sparkBudget));
    e.sparkBudget-=n;
    while(n-- > 0){
      const th=burnRnd()*6.283, rr=Math.max(CELL*0.5,rad)*(0.35+0.65*burnRnd());
      const sp=(60+e.p*1.6)*(0.35+burnRnd());
      burnSparks.push({x:cx+Math.cos(th)*rr, y:cy+Math.sin(th)*rr,
                       vx:Math.cos(th)*sp, vy:Math.sin(th)*sp,
                       life:(0.35+0.6*k)*(0.6+burnRnd()*0.8), t:0});
    }
  }
  // SMOKE - steam is the PRODUCT and it is hot, so it goes up. Rate and size
  // are the event's: a lean crawl burns for longer and must not make as much.
  if(e.fade>0 && rad>0){
    e.smokeT-=dt;
    if(e.smokeT<=0){
      e.smokeT=(0.06+0.10*burnRnd())/(0.30+0.70*k);
      /* A PUFF IS A PUFF. On the mockup's board a burn was over in a second
         and a puff never had time to grow; here a fire feeds one for as long
         as it burns, and a metre a second of growth over seven seconds put
         bay-sized clouds over the whole deck. Born smaller, grown slower, and
         it stops widening at SMOKE_RMAX - a rising puff shears apart at that
         size rather than going on swelling. */
      const th=burnRnd()*6.283, rr=rad*Math.sqrt(burnRnd()), sc=0.5+1.6*Math.sqrt(k);
      burnSmoke.push({x:cx+Math.cos(th)*rr, y:cy+Math.sin(th)*rr,
                      r:CELL*(0.35+0.55*sc), vy:-CELL*(0.55+0.8*sc),
                      life:1.6+1.4*sc+burnRnd()*1.5, t:0,
                      a:0.17+0.20*sc, g:CELL*(0.18+0.35*sc)});
    }
  }
  e.wF=0; e.newF=0;
}

/* ══ THE WAVE IS A REAL FRONT, AND EVERY TERM IN IT IS A PUBLISHED RELATION ══
   SPEED is Rankine-Hugoniot for a normal shock in air, U = a0*sqrt(1 +
   (g+1)/(2g) * dp/P0): exactly the speed of sound when dp is zero and
   supersonic when it is not, so the front cannot travel at a made-up velocity.
   DECAY is geometric - this compartment is one deck of fixed depth, so the
   wave spreads CYLINDRICALLY and its area grows as R. A strong shock loses
   pressure as R^-2 and a weak one, carrying a conserved acoustic energy over
   that area, as R^-0.5; the exponent is blended on dp/P0 itself. Taken in ONE
   step per frame, R^-2 over a whole frame's travel halved the front between
   two drawn frames and it was gone in four - the decay is a function of
   DISTANCE, so the distance is taken in pieces rather than the law softened.
   WAVE_SLOW is the one number here that is not physics: a real front crosses
   this compartment in 60 ms, under four frames, so it is drawn at a stated
   fraction of its own speed. */
/* AND THE COMPARTMENT IS NOT FREE FIELD. Every front crossed the whole board
   whatever made it, because R^-0.5 in the weak limit is the ideal case: a wave
   spreading over open deck with nothing in the way. This deck is full of
   machines, and a wave loses energy to every box it has to wrap. The extra
   attenuation is priced off the BLOCKAGE the board actually has (burnBlock,
   the fraction of cells a machine stands on), so a bare grid still passes the
   ideal wave and a packed engine room stops a small bang within a few metres.
   AND IT STOPS WHERE THE SURVEY STOPS: DP_MIN is BLAST_LO, the same 15 kPa
   below which the BLAST layer draws nothing, so a front is visible exactly as
   far as it leaves a mark. At 1 kPa the tail ran half again the width of the
   board. */
const A0=347, GAM=1.4, DP_MIN=BLAST_LO, WAVE_SUB=4, WAVE_SLOW=16, OBS_K=2.2;
function burnParticles(dt){
  burnRings=burnRings.filter(o=>{
    for(let k=0;k<WAVE_SUB;k++){
      o.u=A0*Math.sqrt(1+(GAM+1)/(2*GAM)*o.dp/ROOM_P0);
      const R1=o.R+o.u*dt/WAVE_SLOW/WAVE_SUB;
      o.dp*=Math.pow(o.R/R1, 0.5+1.5*clamp(o.dp/ROOM_P0,0,1)+OBS_K*burnBlock);
      o.R=R1;
    }
    return o.dp>DP_MIN && o.R<GW*MPC*1.5;
  });
  for(const o of burnSparks){ o.t+=dt; o.x+=o.vx*dt; o.y+=o.vy*dt; o.vy+=90*dt;
                             o.vx*=0.96; o.vy*=0.96; }
  burnSparks=burnSparks.filter(o=>o.t<o.life);
  burnShake*=Math.exp(-dt/0.18);
  for(const o of burnSmoke){ o.t+=dt; o.y+=o.vy*dt; o.vy*=0.99;
                             o.r=Math.min(o.r+o.g*dt, SMOKE_RMAX); }
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
/* ══ THE BED IS ONE FILL PER SHADE, NOT ONE PER CELL ══
   A compartment well alight lit half of 2040 cells, and every one of them set
   globalAlpha, set a fill colour and painted a single rectangle - the whole of
   the 1009 to 2249 fillRect jump a burn costs. The colour is already a ladder
   of four; the alpha is banded to 1/32, which is finer than the screen can
   show, and each bucket is one path and one fill. */
const BED_A=32;
const bedBy=new Map();
function bedPush(col,a,x,y,w,h){
  const k=col+"|"+Math.round(clamp(a,0,1)*BED_A);
  let b=bedBy.get(k);
  if(!b){ b={col, a:Math.round(clamp(a,0,1)*BED_A)/BED_A, r:[]}; bedBy.set(k,b); }
  b.r.push(x,y,w,h);
}
function bedFlush(){
  for(const b of bedBy.values()){
    ctx.globalAlpha=b.a; ctx.fillStyle=b.col; ctx.beginPath();
    for(let i=0;i<b.r.length;i+=4) ctx.rect(b.r[i],b.r[i+1],b.r[i+2],b.r[i+3]);
    ctx.fill();
  }
  ctx.globalAlpha=1;
  bedBy.clear();
}
function roomBurnFx(s){
  if(!s.roomFlame) return;
  const T=s.roomT, Fl=s.roomFlame, Pr=s.roomP, N=Fl.length;
  const occ=burnOcc(N);
  { let b=0; for(let i=0;i<N;i++) if(occ[i]) b++; burnBlock=b/N; }
  const now=fxClock();
  if(now<burnClk){ burnReset(); burnClk=now; }
  const dt=clamp(now-burnClk,0,0.25); burnClk=now;
  /* LIT, the mockup's: how recently this cell burnt, so a front that has moved
     on fades out over a third of a second instead of snapping off. */
  if(!glowF || glowF.length!==N) glowF=new Float64Array(N);
  const gk=Math.exp(-dt/0.35);
  if(burnEvs.length && burnEvs[0].mask.length!==N) burnReset();
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, fl=Fl[i], p=Pr[i];
      glowF[i] = fl>0 ? 1 : glowF[i]*gk;
      if(occ[i]) continue;                  // a machine is a wall to this fire
      const lit=glowF[i];
      if(fl<=0 && lit<=0.02 && p<=0) continue;
      const x0=GX+X*CELL;
      if(fl>0 || lit>0.02){
        /* the mockup's colour ladder, off the cell's own gas temperature:
           white at a stoichiometric front, red for a lean crawl */
        /* THE MOCKUP'S OWN LADDER, and it is the GAS TEMPERATURE, not the rise
           over the hull: white at a stoichiometric front, orange at 1200 K,
           dull red as it dies. The bands here were 1800/1100/450 K OVER
           ambient, which puts white at 2100 K - above what the burn is capped
           at - so almost every cell drew red and a compartment on fire read as
           a rust-coloured stain. */
        const g=clamp((T[i]-600)/1600,0,1);
        const col = g>0.72 ? C.fire : g>0.42 ? C.fire2 : g>0.18 ? C.amber : C.red;
        /* AND THE FLAME FILLS AS MUCH OF ITS CELL AS IT HAS HEAT IN IT. A
           flat fillRect made every fire the same size by construction - a
           cool lean crawl and a stoichiometric front were both one solid
           cell, differing only in colour, so the only thing that could look
           big was a fire covering more cells. Inset off the same g the bloom
           weighs, and off the fade, so an ember shrinks as it dies. */
        const iv=(0.34+0.66*g)*(fl>0?1:Math.max(0.4,lit));
        const iw=CELL*iv, ih=h*iv;
        /* AND IT IS A BED, NOT THE BANG - but only where it is EMBERS. Dimmed
           flat, a live front lost its own brightness to the wash over it and
           the fire stopped looking like fire at all; what must not compete
           with the fireball is the glow a front has left behind, which is
           where the checkerboard came from. */
        const al=Math.min(0.95, Math.max(fl>0?0.55:0, lit))*(fl>0?1:BED_DIM);
        bedPush(col, al, x0+(CELL-iw)/2, y+(h-ih)/2, iw, ih);
      }
      // and the effects are BORN from the physics, never scheduled: a burning
      // cell feeds its BANG, weighted by the heat it is putting out
      if(fl>0) evFeed(evFor(i,N), i, clamp((T[i]-600)/1600,0,1), p);
    }
  }
  bedFlush();                 // the whole bed, still under the events it feeds
  evStep(dt);
  for(const e of burnEvs) evFx(e,dt);
  burnParticles(dt);
  /* ONE FIREBALL PER BANG, AND IT GOES DOWN BEFORE THE DEBRIS. A fire is one
     light source and a glow per cell reads as a checkerboard; weighed off
     whatever happened to be alight this frame it shrank back between fronts,
     where this is the event's own footprint and only grows. Drawn LAST it
     washed over the sparks, the smoke and the front - the light of a fireball
     is behind what is flying out of it. */
  for(const e of burnEvs){
    if(!(e.r>0 && e.fade>0)) continue;
    const cx=GX+(e.cx+0.5)*CELL, cy=rowTop(0)+(e.cy+0.5)*CELL;
    const r=Math.max(CELL*1.1, e.r*CELL*1.35), a=e.fade*(0.25+0.55*Math.max(e.hot,0.25));
    const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    gr.addColorStop(0,   alphaC(C.fire,  0.70*a));
    gr.addColorStop(0.35,alphaC(C.fire2, 0.42*a));
    gr.addColorStop(0.70,alphaC(C.amber, 0.18*a));
    gr.addColorStop(1,   alphaC(C.red,   0));
    ctx.fillStyle=gr; ctx.fillRect(cx-r,cy-r,r*2,r*2);
  }
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
  /* BRIGHTNESS IS THE FRONT'S OWN STRENGTH, COLOUR IS THE ABSOLUTE kPa, banded
     on the machines' own limits - 20 kPa takes a cabinet, 70 heavy plant, 120 a
     pipe. Alpha off kPa alone left a front below 0.1 for nine tenths of its
     run: invisible, though it was still a front and still doing what one does. */
  for(const o of burnRings){
    const f=clamp(o.dp/o.dp0,0,1);
    ctx.globalAlpha=clamp(0.10+0.72*Math.sqrt(f),0,0.9);
    ctx.strokeStyle = o.dp>=120 ? C.bright : o.dp>=70 ? C.fire2 : o.dp>=20 ? C.amber : C.ink;
    ctx.lineWidth=1+3.5*Math.sqrt(f)*clamp(0.35+o.dp0/300,0,1);
    ctx.beginPath(); ctx.arc(o.x,o.y,o.R*PX_M,0,6.284); ctx.stroke(); ctx.globalAlpha=1;
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
  /* THE FLASH is armed by the EVENT (evFx) and only ever grows while the bang
     is still growing, so a standing flame that lights a cell a second never
     accumulates one. It used to be armed by counting cells that lit in a single
     frame, which needed a CROWD to tell a flame from a bang. */
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


/* ══ CONTAINMENT: THE SURVEY ══
   It tints every bounded region and bands every wall cell by its own margin to
   its own rating. The bands are the WALL'S OWN LIMITS and not round numbers -
   the BLASTZ rule, one field over: the region's pressure against the cell's
   rating, and again against the rating times PIPE_BURST_K, which is where it
   actually opens. A cell under the first band prints nothing.
   NO FIGURE PER CELL. 144 numbers is too much ink and radn CELL DOSE exists
   for people who want that; one reading per REGION, at its centroid. */
const CONTZ=[
  {t:0.50, col:C.green, lab:"HELD",    a:0.14},
  {t:0.80, col:C.amber, lab:"WORKING", a:0.24},
  {t:1.00, col:C.red,   lab:"AT RATED",a:0.36},
  {t:1e9,  col:C.redHi, lab:"OPENING", a:0.50},
];
const contzOf = f => { for(let i=0;i<CONTZ.length;i++) if(f < CONTZ[i].t) return i;
                       return CONTZ.length-1; };
function contZones(data,L){
  const R=matRegions();
  ctx.save();
  for(const g of R.regions){
    if(!g.bounded) continue;
    for(const i of g.cells){
      const X=i%GW, Y=(i/GW)|0;
      if(data.g[Y][X]) continue;         // the radZones() rule: a survey paints the room, not the machines
      const y=rowTop(Y);
      ctx.globalAlpha=0.10; fillRect(GX+X*CELL,y,CELL,rowTop(Y+1)-y,C.cyan); ctx.globalAlpha=1;
    }
    const pr = L ? regionDP(L, g) : 0;
    for(const i of g.wall){
      const X=i%GW, Y=(i/GW)|0, rate=matRating(X,Y);
      const f = rate>0 ? pr/rate : 0;
      if(f < CONTZ[0].t) continue;
      const Z=CONTZ[contzOf(f)], y=rowTop(Y);
      ctx.globalAlpha=Z.a; fillRect(GX+X*CELL,y,CELL,rowTop(Y+1)-y,Z.col); ctx.globalAlpha=1;
    }
    /* ONE READING PER REGION, at its own centroid: what it is holding, and the
       margin of its weakest cell - which is the cell that will go. */
    let sx=0, sy=0, lo=Infinity;
    for(const i of g.cells){ sx+=i%GW; sy+=(i/GW)|0; }
    for(const i of g.wall) lo=Math.min(lo, matBurstP(i%GW,(i/GW)|0));
    if(!isFinite(lo)) continue;
    const cx=GX+(sx/g.cells.length+0.5)*CELL, cy=rowTop(Math.round(sy/g.cells.length))+11;
    /* kPa AT ONE DECIMAL, the unit the compartment's other canvas readings
       already use (BLASTZ). In MPa a region holding 4.7 kPa printed 0.0. */
    txt(L?(pr*1000).toFixed(1)+" kPa":"SEALED", cx, cy, {size:8, align:"center", color:C.cyan});
    if(L) txt(((lo-pr)*1000).toFixed(1)+" kPa MARGIN", cx, cy+10,
              {size:7, align:"center", color:(lo-pr)<0?C.red:C.ink2});
  }
  ctx.restore();
}
/* ══ FLOODING ══
   The ship is drawn in SECTION, so standing water is a horizontal line and
   there is no reason to draw it as anything else. Per region, from the bottom
   cell up, at the depth the water discharged into it stands at. It paints
   nothing at all until water is standing somewhere, which is the H2 CLOUD
   argument word for word and is why it ships ON. */
function floodLayer(data,L){
  if(!L) return;
  const R=matRegions();
  ctx.save();
  for(const g of R.regions){
    if(!g.bounded) continue;
    const d=regionFloodM(L,g); if(!(d>0.05)) continue;
    let bot=-1, x0=GW, x1=0;
    const inRegion=new Set(g.cells);
    for(const i of g.cells){ const X=i%GW, Y=(i/GW)|0;
      if(Y>bot) bot=Y; if(X<x0) x0=X; if(X>x1) x1=X; }
    const top=rowTop(Math.max(0, bot+1-Math.ceil(d/MPC)));
    const y1=rowTop(bot+1);
    ctx.globalAlpha=0.30; fillRect(GX+x0*CELL, top, (x1-x0+1)*CELL, y1-top, C.blue); ctx.globalAlpha=1;
    ctx.strokeStyle=C.blue; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(GX+x0*CELL, top+0.7); ctx.lineTo(GX+(x1+1)*CELL, top+0.7); ctx.stroke();
    txt(d.toFixed(1)+" m", GX+(x1+1)*CELL-3, top-3, {size:7, align:"right", color:C.blue});
    /* AND IT BUBBLES WHERE IT IS GOING IN. Every opening inside this region is
       a cell the water is arriving from, so that is where the disturbance is -
       the same argument the break plume makes about being drawn at the cell. */
    for(const id of (L.dmgParts||[])){
      if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
      const j=id.indexOf(","), bx=+id.slice(5,j), by=+id.slice(j+1);
      if(!inRegion.has(by*GW+bx)) continue;
      const br=grect(bx,by,1,1);
      fxBubbles(br.x, Math.max(br.y, top), br.w, br.y+br.h-Math.max(br.y, top),
                fxEase("fld:"+bx+","+by, 1), C.blue, "pool");
    }
  }
  ctx.restore();
}
