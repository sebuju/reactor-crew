"use strict";
/* room heat layers - see .claude/CLAUDE.md

   src/data/room.js OWNS the field; everything in here only reads it. The same
   split src/render/rad.js has from src/data/rad.js, and the same `data` memo
   key trick: all three layers below name "room", so the geometry is walked
   once a frame however many of them are on.

   ROOM HEAT   (roomz, under) - the banded fill, the survey map for heat.
   H2 CLOUD    (roomh, under) - where the hydrogen is, and where it will burn.
   PART TEMP   (roomc, over)  - what each machine is standing in, against what
                 it was built for. This is the triage number: the field says
                 the room is hot, this says which machine is about to go. */

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

/* THE ONE LINE THAT MATTERS ON THIS LAYER IS THE FLAMMABILITY LIMIT, so it is
   drawn as a hard edge and everything under it as a wash: below 4 % by volume
   hydrogen is a gas in a room, above it the room is a bomb waiting for
   something at 773 K. Read off roomH2Frac(), the SAME expression the ignition
   test uses, so a cell cannot draw as safe and burn. */
function roomH2Layer(data,L){
  if(!L) return;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=roomH2Frac(L,i);
      if(f<=0.002) continue;
      const lit = f>=H2_LFL;
      ctx.globalAlpha = lit ? 0.42 : 0.10+0.32*(f/H2_LFL);
      fillRect(GX+X*CELL,y,CELL,h, lit?C.red:C.amber); ctx.globalAlpha=1;
      if(lit) txt((f*100).toFixed(0)+"%", GX+X*CELL+CELL/2, y+h-3,
                  {size:8, align:"center", color:C.red});
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
