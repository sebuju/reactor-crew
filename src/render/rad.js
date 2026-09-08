"use strict";
const ZONE=[
  {t:0.10,  col:C.green, lab:"CLEAR",      a:0.10},
  {t:0.30,  col:C.green, lab:"LOW",        a:0.20},
  {t:RAD_HI,col:C.amber, lab:"CONTROLLED", a:0.20},
  {t:3.00,  col:C.red,   lab:"HIGH",       a:0.24},
  {t:1e9,   col:C.red,   lab:"EXCLUSION",  a:0.40},
];
const zoneOf = r => { for(let i=0;i<ZONE.length;i++) if(r<ZONE[i].t) return i; return ZONE.length-1; };

// skips occupied cells: a component draws no opaque backing, so a fill would print through its art
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
  // iso-line runs over occupied cells too: a shield's footprint is where its shadow starts
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

// pipe value plates stand in free cells, so their boxes are skipped as well as occupancy
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

function radCells(data){
  ctx.lineWidth=1; ctx.strokeStyle=C.bright; ctx.globalAlpha=.30;
  for(const i of data.cells){
    const X=i%GW, Y=(i/GW)|0, y=rowTop(Y), h=rowTop(Y+1)-y;
    ctx.strokeRect(GX+X*CELL+3.5, y+3.5, CELL-7, h-7);
  }
  ctx.globalAlpha=1;
}

function radPart(data){
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    const r=radParty(data.f,p,data.g);
    const {x,y,w}=prect(p);
    txt(r.toFixed(2)+"x", x+w/2, y+11,
      {size:8, align:"center", color:ZONE[zoneOf(r)].col});
  }
}
