"use strict";
/* radiation layers - see .claude/CLAUDE.md

   src/data/rad.js SOLVES the field; everything in here only reads it. Four
   layers, all sharing one `data:"rad"` id (see layers.js) so the field is
   solved once a frame no matter how many of the four are switched on:
     RAD ZONES     (radz, under) - the five-band survey fill, plus the
                    boundary line that turns a shield's shadow into a shape.
     CELL DOSE      (radn, under) - the number in every free cell, text only.
     REPAIR CELLS  (radp, under) - the cells a party could actually stand in.
     PART DOSE      (radc, over)  - what each machine costs to reach.

   radz and radn only paint a cell data.g says is EMPTY - "under" is the room
   a body could stand in, not the inside of a vessel, and a component draws
   no opaque backing of its own on the bench, so an unfiltered fill or digit
   grid would show straight through its name and value tags. radp gets this
   for free (partyCells() only ever names free cells); radc is the one layer
   that is SUPPOSED to land on a component - see its own comment below.

   ROW GEOMETRY IS rowTop(Y), which is a flat GY+Y*CELL on both screens now: a
   machine declares the cells its own controls need, so no row is stretched to
   fit a strip and no layer can drift off the grid lines it is drawn against. */

/* THE ZONE TABLE IS THE READOUT.
   Five bands, not a gradient. A survey map has steps: you read "this cell is
   in the amber zone", which is a fact you can act on - send the party in
   from this side, not that one. A smooth ramp only ever gives you a mood.
   An earlier draft drew this as scintillation grain instead - dose density
   as sparkle, denser where it's hotter. It looked the part and told you
   nothing you could act on: there is no line on a grain field where "safe"
   stops and "not" begins, which is the one thing a survey exists to say. It
   was thrown away for exactly that reason.

   Green/amber/red is reserved elsewhere for alarm semantics only (see
   CLAUDE.md's colour table) - this does not steal that meaning, it USES it.
   A dose rate is not decoration being tinted for effect, it is itself an
   alarm semantic: CLEAR/LOW are green because they are fine, CONTROLLED is
   amber because it costs something to be there, HIGH/EXCLUSION are red
   because they hurt you. That is exactly what the three colours are for.

   RAD_HI (1.0, src/data/rad.js) is CONTROLLED's own threshold - named here
   rather than re-typed as 1.00, so the day RAD_HI moves this band moves
   with it instead of quietly disagreeing with the annunciator that already
   reads the same constant. */
const ZONE=[
  {t:0.10,  col:C.green, lab:"CLEAR",      a:0.10},
  {t:0.30,  col:C.green, lab:"LOW",        a:0.20},
  {t:RAD_HI,col:C.amber, lab:"CONTROLLED", a:0.20},
  {t:3.00,  col:C.red,   lab:"HIGH",       a:0.24},
  {t:1e9,   col:C.red,   lab:"EXCLUSION",  a:0.40},
];
const zoneOf = r => { for(let i=0;i<ZONE.length;i++) if(r<ZONE[i].t) return i; return ZONE.length-1; };

/* The fill, then the boundary. Colour ALONE here - no numbers, see radNumbers()
   below for why that is a separate layer rather than the same pass.

   FILL SKIPS ANY CELL data.g ALREADY OWNS. "under" is the seam for the room a
   body could stand in, not for the inside of a vessel - the big comment in
   layers.js says so for the seam as a whole, and on the design bench a
   component draws no opaque backing of its own (only a plinth strip does, and
   the bench never has one), so an unfiltered fill would sit in the open gaps
   of a component's own art and print straight through it. radp already gets
   this for free because partyCells() only ever names free cells; radz and
   radn have to ask data.g the same question by hand. */
function radZones(data){
  const f=data.f, g=data.g, GN=GW*GH, z=new Uint8Array(GN);
  for(let i=0;i<GN;i++) z[i]=zoneOf(f[i]);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      if(g[Y][X]) continue;
      const Z=ZONE[z[Y*GW+X]];
      ctx.globalAlpha=Z.a; fillRect(GX+X*CELL,y,CELL,h,Z.col); ctx.globalAlpha=1;
    }
  }
  /* the iso-line: one stroke wherever the zone index changes across an edge,
     drawn over the WHOLE grid regardless of occupancy - unlike the fill, a
     boundary that runs along a component's own edge is still a true fact
     about the field (a shield's own footprint is exactly where its shadow
     starts), and the component draws its own outline on top of it either
     way. A flat fill alone reads as a mood; the boundary is what makes a
     shield's shadow a SHAPE you can read at a glance rather than a smudge of
     colour - this line is the entire reason the field is drawn in bands. */
  ctx.lineWidth=1;
  for(let Y=0;Y<GH;Y++){
    const y1=rowTop(Y+1);
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, x0=GX+X*CELL;
      ctx.strokeStyle=ZONE[z[i]].col; ctx.globalAlpha=0.75;
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

/* text only, no fill of its own - it composes over radz rather than
   repainting it, which is deliberate: colour is one layer, number is
   another, and either has to be able to stand alone with the other switched
   off. Below RAD_FLOOR the field is background rather than a reading, so it
   prints a middle dot instead of a string of zeroes nobody needed. Skips an
   occupied cell for the same reason radZones() skips its fill there: a
   component's own name and value tags already live in that space, and a
   digit grid sitting behind them is exactly the vessel-interior survey the
   "under" seam is defined never to draw. */
/* A CELL A READING IS ALREADY STANDING IN IS NOT AN EMPTY CELL. The part
   occupancy grid answers "is there a machine here" and nothing else, so this
   used to print its figure straight through a pipe's own flow, pressure and
   subcooling plate - and once every run showed every value it has, that was
   the normal case rather than a corner one. The stack places are chosen once
   a frame, before anything draws (pipeFieldRefresh(), pipes.js), which is
   what makes the `under` seam's own promise - "it never lands on a value
   tag" - true rather than merely written down. */
function radNumbers(data){
  const f=data.f, g=data.g, boxes=pipeStackBoxes();
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), bl=midBase(y,rowTop(Y+1)-y,8);
    for(let X=0;X<GW;X++){
      if(g[Y][X]) continue;
      const r=f[Y*GW+X], cx=GX+X*CELL+CELL/2, dim=r<RAD_FLOOR;
      const bx=cx-CELL/2, by=bl-8, bw=CELL, bh=10;
      if(boxes.some(t=>bx+bw>t.x && bx<t.x+t.w && by+bh>t.y && by<t.y+t.h)) continue;
      txt(dim?"·":r.toFixed(2), cx, bl,
        {size:8, align:"center", color:dim?C.ink2:ZONE[zoneOf(r)].col});
    }
  }
}

/* a thin box in every cell partyCells() says a body could stand in. This is
   the question the whole survey exists to answer - not "how hot is it here"
   but "where can I actually send someone" - so it gets its own layer rather
   than riding along on the zone fill. Marks only, drawn with fillRect via
   strokeRect (no text), per the cell-mark convention. */
function radCells(data){
  ctx.lineWidth=1; ctx.strokeStyle=C.bright; ctx.globalAlpha=.30;
  for(const i of data.cells){
    const X=i%GW, Y=(i/GW)|0, y=rowTop(Y), h=rowTop(Y+1)-y;
    ctx.strokeRect(GX+X*CELL+3.5, y+3.5, CELL-7, h-7);
  }
  ctx.globalAlpha=1;
}

/* the ONE number that decides triage: what THIS machine costs to reach, from
   the coldest free cell beside it (radParty() already picks that side, not
   this file). This is why the seam matters and is not just ordering trivia -
   the reading has to sit ON the component it is about, which means drawn
   AFTER the component loop, painted over the machine the way a gauge is
   bolted to the outside of the thing it reads. The "under" layers above stop
   at the component's own footprint for exactly the opposite reason: you
   cannot survey the inside of a vessel.
   Shielding blocks a beam, it does not stand beside itself for repair, so a
   shield component is skipped - the same predicate radPeak() and
   partyCells() already use in src/data/rad.js. Unfitted parts are skipped
   too: there is no machine there to reach, and the number would only land on
   top of that component's own NOT FITTED tag. */
function radPart(data){
  for(const p of LAY.parts){
    if(p.grp==="shield" || !fitted(p)) continue;
    const r=radParty(data.f,p,data.g);
    const {x,y,w}=prect(p);
    txt(r.toFixed(2)+"x", x+w/2, y+11,
      {size:8, align:"center", color:ZONE[zoneOf(r)].col});
  }
}
