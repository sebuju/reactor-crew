"use strict";
// band edges are the machines' own ROLE.tsurv limits (340 K cabinets, 400 K motors), not round numbers
const HEATZ=[
  {t:310, col:C.blue,  lab:"AMBIENT",  a:0.06},
  {t:340, col:C.green, lab:"WARM",     a:0.12},
  {t:400, col:C.amber, lab:"HOT",      a:0.20},
  {t:600, col:C.red,   lab:"SEVERE",   a:0.28},
  {t:1e9, col:C.red,   lab:"UNTENABLE",a:0.44},
];
const heatOf = v => { for(let i=0;i<HEATZ.length;i++) if(v<HEATZ[i].t) return i; return HEATZ.length-1; };

/* A gas-tight wall cell holds no atmosphere of its own - matRegions() leaves it out of every region,
   so every room field stays at its seed there. A survey reads it off the faces it SEPARATES, worst
   first, which is what contZones() already bands a wall by. */
function roomFace(get, i, worse){
  const of=matRegions().of;
  if(of[i]>=0) return get(i);
  const X=i%GW, Y=(i/GW)|0;
  let v=null;
  const take=j=>{ if(of[j]>=0) v = v===null ? get(j) : worse(v, get(j)); };
  if(X>0) take(i-1); if(X<GW-1) take(i+1);
  if(Y>0) take(i-GW); if(Y<GH-1) take(i+GW);
  return v===null ? get(i) : v;
}

// fill skips an occupied cell (the radZones() rule); the iso-line does not, because a machine IS a wall to this field
function roomZones(data){
  const T=data.T, g=data.g;
  if(!T) return;
  const GN=GW*GH, z=new Uint8Array(GN), getT=j=>T[j];
  for(let i=0;i<GN;i++) z[i]=heatOf(roomFace(getT,i,Math.max));
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

function roomCellTip(L){
  const p = vPtr;
  if(!p) return;
  const X=Math.floor((p.x-GX)/CELL), Y=rowAt(p.y);
  if(X<0||X>=GW||Y<0||Y>=GH) return;
  const i=Y*GW+X, rows=[];
  const row=(lab,s)=>rows.push(lab+s);
  if(L){
    // through roomFace(), the layers' own door, or a wall cell reads ambient under a picture that says otherwise
    const rad=layerData("rad",L), r=rad.f[i],
          T=roomFace(j=>L.roomT[j],i,Math.max),
          live=roomFace(j=>L.roomP[j],i,Math.max),
          worst=roomFace(j=>L.roomPPk[j],i,Math.max),
          h2=roomFace(j=>roomH2Frac(L,j),i,Math.max)*100;
    if(r>=0.005) row("DOSE         ",r.toFixed(2)+" x  "+ZONE[zoneOf(r)].lab);
    row("AIR TEMP     ",T.toFixed(0)+" K  "+HEATZ[heatOf(T)].lab);
    if(h2>=0.05) row("HYDROGEN     ",h2.toFixed(1)+" %");
    row("OXYGEN       ",(roomFace(j=>roomO2Frac(L,j),i,Math.min)*100).toFixed(1)+" %");
    if(L.roomFlame[i]>0) row("FLAME        ","BURNING");
    if(L.roomWater[i]>=0.01) row("WATER        ",L.roomWater[i].toFixed(0)+" kg  "+roomWaterT(L,i).toFixed(0)+" K");
    if(L.roomPool[i]>=0.01) row("METAL POOL   ",L.roomPool[i].toFixed(0)+" kg  "+
      roomPoolT(L,i).toFixed(0)+" K"+(roomPoolLit(L,i)?"  BURNING":""));
    if(live>=0.5) row("BLAST NOW    ",live.toFixed(0)+" kPa");
    if(worst>=BLASTFX.lo) row("BLAST PEAK   ",worst.toFixed(0)+" kPa  "+BLASTZ[blastOf(worst)].lab);
    if(rad.cells.has(i)) row("REPAIR CELL  ","YES");
  }
  { const m=matOf(X,Y);
    if(m){ row("WALL         ",m.name+"  "+matThick(X,Y).toFixed(1)+" mm"+(L&&matOpen(L,X,Y)?"  BREACHED":""));
           row("WALL RATING  ",(matRating(X,Y)*1000).toFixed(1)+" kPa   arm "+(matSpanEff(X,Y)*MPC).toFixed(1)+" m"); }
    const g=matSealAt(X,Y);
    if(g){
      row("REGION       ",g.cells.length+" cells   "+matRegVol(g).toFixed(1)+" m3   "+(matSealed(L||null,g)?"SEALED":"OPEN"));
      if(L) row("REGION PRESS ",(regionDP(L,g)*1000).toFixed(1)+" kPa"); }
    const gf=matRegionIn(X,Y)||g;
    if(L && gf){ const f=regionFlood(L,gf);
      if(f) row("FLOODED TO   ",f.d.toFixed(2)+" m   "+(f.kg/1000).toFixed(1)+" t"); } }
  if(!rows.length) return;
  TIP(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y), "CELL "+X+","+Y, rows.join("\n"));
}

// off roomH2Frac(), the same expression the ignition test uses, so a cell cannot draw as safe and burn
function roomH2Layer(data,L){
  if(!L) return;
  const getH2=j=>roomH2Frac(L,j), h2At=i=>roomFace(getH2,i,Math.max);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=h2At(i);
      if(f<=0.002) continue;
      if(data.g[Y][X]) continue;
      ctx.globalAlpha = Math.min(0.22, 0.05+0.19*(f/H2_LFL));
      fillRect(GX+X*CELL,y,CELL,h, C.h2); ctx.globalAlpha=1;
    }
  }
  ctx.strokeStyle=C.h2; ctx.lineWidth=1.2;
  const lit=i=>h2At(i)>=H2_LFL;
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

const BLASTFX={
  lo:15,          // kPa below which the tooltip prints no peak
  full:600,       // kPa that reads as a full bang
  zones:[
    {t:20,  col:C.blue,  lab:"PANELS",   a:0.10},
    {t:70,  col:C.green, lab:"CABINETS", a:0.16},
    {t:120, col:C.amber, lab:"MACHINES", a:0.24},
    {t:200, col:C.red,   lab:"PIPEWORK", a:0.34},
    {t:1e9, col:C.redHi, lab:"VESSELS",  a:0.48},
  ],
};
const BLASTZ=BLASTFX.zones;
const blastOf = v => { for(let k=0;k<BLASTZ.length;k++) if(v<BLASTZ[k].t) return k;
                       return BLASTZ.length-1; };
// 1 only between two cells of open air: a machine face passes ROOM_BLOCK and a wall nothing
const faceOpen = b => b === 1;

const SCAR_DEEP=0.7, SCAR_LAYERS=8, SCAR_A=0.9, SCAR_MIN=1*DRAW_K;
const scarF = a => Math.min(1, a/(HIT_FULL-HIT_LO));
const scarSmooth = raw => raw.map((v,j)=>(raw[Math.max(0,j-1)] + 2*v + raw[Math.min(raw.length-1,j+1)])/4);
// a box or a wall books no scar of its own; the air beside it does
const scarAt = (L,G,X,Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return 0; const i=Y*GW+X;
  return G.occ[i] || G.tight[i] ? 0 : L.roomScar[i]; };
// tools/wavemock.html's paintScars(), run straight between cell centres rather than in half-cell blocks
function scarPart(L,p){
  if(!fitted(p)) return;
  const G=roomGeom(), r=prect(p);
  ctx.fillStyle=C.scar; ctx.globalAlpha=SCAR_A/SCAR_LAYERS;
  for(const sd of "lrtb"){
    const vert = sd==="l" || sd==="r", n = vert ? p.h : p.w, across = vert ? r.w : r.h;
    const raw=[]; let any=false;
    for(let j=0;j<n;j++){
      const a = sd==="l" ? scarAt(L,G,p.x-1,p.y+j) : sd==="r" ? scarAt(L,G,p.x+p.w,p.y+j)
              : sd==="t" ? scarAt(L,G,p.x+j,p.y-1) : scarAt(L,G,p.x+j,p.y+p.h);
      raw.push(a>0 ? SCAR_MIN + SCAR_DEEP*across*scarF(a) : 0);
      if(a>0) any=true;
    }
    if(!any) continue;
    const d=scarSmooth(raw);
    // u along the side, v in from the face
    const pt = (u,v) => sd==="l" ? [r.x+v, r.y+u] : sd==="r" ? [r.x+r.w-v, r.y+u]
                      : sd==="t" ? [r.x+u, r.y+v] : [r.x+u, r.y+r.h-v];
    for(let k=1;k<=SCAR_LAYERS;k++){
      const f=k/SCAR_LAYERS, path=[pt(0,0), pt(0,d[0]*f)];
      for(let j=0;j<n;j++) path.push(pt((j+0.5)*CELL, d[j]*f));
      path.push(pt(n*CELL, d[n-1]*f), pt(n*CELL,0));
      ctx.beginPath(); ctx.moveTo(path[0][0],path[0][1]);
      for(const q of path) ctx.lineTo(q[0],q[1]);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalAlpha=1;
}
// the same soot on what else stands in the air: every pipe through a scarred cell, and every wall beside one
function scarSurfaces(L){
  const G=roomGeom(), mid=(p,q)=>[(p[0]+q[0])/2, (p[1]+q[1])/2];
  ctx.fillStyle=C.scar; ctx.strokeStyle=C.scar;
  ctx.lineCap="butt"; ctx.lineJoin="round";
  for(const r of pipeNetwork()){
    if(!r.cells || !r.cells.length) continue;
    const a=scarSmooth(r.cells.map(c=>scarF(scarAt(L,G,c[0],c[1]))));
    if(!a.some(v=>v>0)) continue;
    const n=r.cells.length, cw=pipeWidth(runBore(r))+2*pipeWallPx(r);
    const pts=runCellPts(r), R=runDrawPts(r,cw).R;
    ctx.lineWidth=cw;
    for(let j=0;j<n;j++){
      if(!(a[j]>0)) continue;
      const p=pts[j+1], s0 = j===0 ? pts[0] : mid(pts[j],p), s1 = j===n-1 ? pts[n+1] : mid(p,pts[j+2]);
      ctx.globalAlpha=SCAR_A*a[j];
      ctx.beginPath(); ctx.moveTo(s0[0],s0[1]); ctx.arcTo(p[0],p[1],s1[0],s1[1],R); ctx.lineTo(s1[0],s1[1]); ctx.stroke();
    }
  }
  const RG=matRegions();
  for(const k in (D.mat||{})){
    const j=k.indexOf(","), x=+k.slice(0,j), y=+k.slice(j+1);
    if(x<0||x>=GW||y<0||y>=GH) continue;
    let v=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) v=Math.max(v, scarAt(L,G,x+dx,y+dy));
    if(!(v>0)) continue;
    const r=grect(x,y,1,1);
    ctx.globalAlpha=SCAR_A*scarF(v);
    matBandPath(r, matInFaces(RG,x,y), matWallPx(x,y,r)); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// the worst reading per cell is the tooltip's, off s.roomPPk
function roomPLayer(data,L,seam,p){
  if(!L) return;
  if(seam==="skin") scarPart(L,p);
  else if(seam==="under") scarSurfaces(L);
}

/* grad p in kPa per cell over OPEN faces only, which is what a schlieren photograph is of: a level
   at any height has no step in it and draws black, and a wall face gives no slope. */
let gradX=null, gradY=null;
function waveGrad(L){
  const P=L.roomP, G=roomGeomLive(L), bx=G.bx, by=G.by, N=P.length;
  if(!gradX || gradX.length!==N){ gradX=new Float64Array(N); gradY=new Float64Array(N); }
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++){
    const i=Y*GW+X;
    let gx=0, nx=0, gy=0, ny=0;
    if(X<GW-1 && faceOpen(bx[i]))   { gx+=P[i+1]-P[i];   nx++; }
    if(X>0    && faceOpen(bx[i-1])) { gx+=P[i]-P[i-1];   nx++; }
    if(Y<GH-1 && faceOpen(by[i]))   { gy+=P[i+GW]-P[i];  ny++; }
    if(Y>0    && faceOpen(by[i-GW])){ gy+=P[i]-P[i-GW];  ny++; }
    gradX[i]=nx ? gx/nx : 0; gradY[i]=ny ? gy/ny : 0;
  }
  return {gx:gradX, gy:gradY};
}
/* tools/wavemock.html's paint(): against the loudest slope since the plant was built, which never
   falls, or a fading wave holds full brightness and then blinks out. Floored at PNOW_LO kPa per cell,
   or float noise in a still room becomes the reference and draws at full. */
const PNOW_LO=0.5, PNOW_CUT=0.02, PNOW_A=0.92;
let waveRef=0, shownA=null, shownW=null;
// what PRESSURE NOW draws per cell, `a` the slope over the reference and `w` its brightness 0..1; the lean reads `w`, so nothing moves where the layer is dark
function waveShown(L){
  const g=waveGrad(L), N=g.gx.length;
  if(!shownA || shownA.length!==N){ shownA=new Float64Array(N); shownW=new Float64Array(N); }
  let mx=PNOW_LO;
  for(let i=0;i<N;i++){ const f=Math.hypot(g.gx[i], g.gy[i]); shownA[i]=f; if(f>mx) mx=f; }
  if(mx>waveRef) waveRef=mx;
  /* a face under WAVE_P_LO is at rest by the gas step's own gate, which stops solving there and leaves the step standing, so drawn it sticks on screen forever */
  for(let i=0;i<N;i++){ const a=shownA[i]/waveRef, on=a>=PNOW_CUT && Math.max(Math.abs(g.gx[i]), Math.abs(g.gy[i]))>=WAVE_P_LO;
    shownA[i]=on ? a : 0; shownW[i]=on ? Math.min(1, Math.sqrt(a)/PNOW_A) : 0; }
  return {gx:g.gx, gy:g.gy, a:shownA, w:shownW};
}
function roomPNowLayer(data,L){
  if(!L) return;
  const sh=waveShown(L);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, a=sh.a[i];
      if(data.g[Y][X] || !a) continue;
      ctx.globalAlpha=PNOW_A*sh.w[i];
      fillRect(GX+X*CELL,y,CELL,h,lerpC(C.wave,C.waveHi,a*a));
    }
  }
  ctx.globalAlpha=1;
}

// depletion only: a cell at what air actually holds prints nothing
function roomO2Layer(data,L){
  if(!L) return;
  const getO2=j=>roomO2Frac(L,j);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=roomFace(getO2,i,Math.min);
      if(f>=O2_FRAC0*0.9 || data.g[Y][X]) continue;
      const inert = f<O2_LOC;
      ctx.globalAlpha = inert ? 0.42 : 0.10+0.30*(1-f/O2_FRAC0);
      fillRect(GX+X*CELL,y,CELL,h, inert?C.blue:C.ink2); ctx.globalAlpha=1;
      if(inert) txt((f*100).toFixed(0)+"%", GX+X*CELL+CELL/2, y+h-3,
                    {size:8, align:"center", color:C.blue});
    }
  }
}

// kg in a cell before it draws at all
const LIQ_SEEN = 0.01;
// the board height of a level z metres over the keel, through the row it falls in
const liqY = z => { const k=clamp(Math.floor(z/MPC), 0, GH-1), y1=rowTop(GH-k); return y1-clamp(z/MPC-k, 0, 1)*(y1-rowTop(GH-1-k)); };
/* One primitive for both liquids: a standing run of a column is a rectangle from its floor, lifted by the liquid under it (`under`), to its surface. What is in the air and moving is a band as wide as the share of its cell it fills, tapered to the cells over and under it, so a stream thins as it falls by continuity alone; a film at rest in the air draws nothing. */
function liqDraw(data, L, q, col, a, under, lit){
  const G=roomGeomLive(L), M=q.M, segs=[];
  for(let X=0;X<GW;X++){
    let s=null;
    for(let Y=GH-1;Y>=0;Y--){
      const i=Y*GW+X;
      if(liqShut(G,i) || !(M[i]>=LIQ_SEEN) || !liqStands(q,G,i)){ s=null; continue; }
      if(!s){ s={X, z0:zFloor(i), u:0, v:0, top:i}; segs.push(s); }
      s.u+=under ? liqFill(under.M,under.rho,i) : 0; s.v+=liqFill(M,q.rho,i); s.top=i;
    }
  }
  for(const s of segs){ s.yb=liqY(s.z0+s.u); s.yt=liqY(s.z0+s.u+s.v); }
  // one path per shade, so bodies side by side are one colour
  const body=on=>{
    ctx.beginPath();
    for(const s of segs){
      if(!!(lit && lit(s.top))!==on) continue;
      const x0=GX+s.X*CELL;
      ctx.rect(x0, s.yt, CELL, s.yb-s.yt);
      if(on) txt(roomPoolT(L,s.top).toFixed(0)+" K", x0+CELL/2, s.yb-3, {size:8, align:"center", color:C.amber});
    }
    ctx.globalAlpha=on ? 0.50 : a; ctx.fillStyle=on ? C.amber : col; ctx.fill(); ctx.globalAlpha=1;
  };
  body(false);
  if(lit) body(true);
  ctx.beginPath();
  for(const s of segs){ const x0=GX+s.X*CELL; ctx.moveTo(x0, s.yt); ctx.lineTo(x0+CELL, s.yt); }
  ctx.strokeStyle=col; ctx.lineWidth=1.4; ctx.stroke();
  /* The falling water: a trapezoid per moving cell, its width the fill of the cell, its ends the mean with the falling neighbour over and under it. */
  const wOf=i=>{ const s=liqShut(G,i) ? 0 : M[i]/Math.max(liqCap(q,i),1e-9); return clamp(s,0,1)*CELL; };
  const band=i=>!liqShut(G,i) && M[i]>=LIQ_SEEN && !liqStands(q,G,i) && liqSpeed(q,i)>LIQ_REST;
  ctx.beginPath();
  for(let i=0;i<GW*GH;i++){
    if(!band(i)) continue;
    const X=i%GW, Y=(i/GW)|0, xc=GX+X*CELL+CELL/2, y0=rowTop(Y), y1=rowTop(Y+1), w=wOf(i);
    const wt=i>=GW && band(i-GW) ? (w+wOf(i-GW))/2 : w, wb=i+GW<GW*GH && band(i+GW) ? (w+wOf(i+GW))/2 : w;
    ctx.moveTo(xc-wt/2, y0); ctx.lineTo(xc+wt/2, y0); ctx.lineTo(xc+wb/2, y1); ctx.lineTo(xc-wb/2, y1); ctx.closePath();
  }
  ctx.globalAlpha=a; ctx.fillStyle=col; ctx.fill(); ctx.globalAlpha=1;
}
function roomNaLayer(data,L){
  if(!L || !L.roomPool) return;
  liqDraw(data, L, liqMetal(L), C.ink2, 0.42, liqWater(L), i=>roomPoolLit(L,i));
}

// the skin, not the air: it has mass, so a box lags the room it stands in
function heatParts(L){
  if(!L) return;
  const T=L.roomT, cellsOf={};
  for(const q of roomGeom().parts) cellsOf[q.p.id]=q.cells;
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    const lim=partTsurv(p), v=partSkin(L,p), {x,y,w}=prect(p);
    txt(v.toFixed(0)+"K", x+w/2, y+20,
      {size:8, align:"center", color:!lim?C.ink2:v>lim?C.red:v>lim-40?C.amber:C.ink2});
    const cells=cellsOf[p.id];
    if(!cells||!T) continue;
    let air=0; for(const i of cells) air+=T[i];
    // the arrow the room feels, so a box the air is heating reads the other colour
    const q=ROOM_HK*(cells.length*v-air);
    if(Math.abs(q)<1) continue;
    txt((q>0?"+":"")+q.toFixed(0)+" kW", x+w/2, y+29,
      {size:7, align:"center", color:q>0?C.amber:C.blue});
  }
}
const heatLayer=(data,L,seam)=> seam==="env" ? roomZones(data) : heatParts(L);

// the effect belongs to a BANG, not a cell; every list below is display state off the plant clock, never on S
const BED_DIM=0.42;                       // the flame bed under a fireball, not instead of one
const SMOKE_RMAX=CELL*2.6;                // a puff shears apart rather than swelling for ever
const EV_END=0.30;                        // s of quiet before an event is over
const EV_NB=2;                            // cells of reach when a cell looks for its event
const MERGE_K=0.95;                       // how deep two fireballs overlap before they are one
const PX_M=CELL/MPC;                      // pixels per metre on the board
const SPARK_PX=1.2*DRAW_K;                 // a fleck, not a chunk
let burnSparks=[], burnSmoke=[], burnEvs=[], burnTouch=[], burnShake=0,
    burnClk=0, flashT=0, flashA=0.5, glowF=null;
const flashC=new Set();                   // the air components the flash lights
let burnSeed=0x9e3779b9;
const burnRnd=()=>{ burnSeed^=burnSeed<<13; burnSeed^=burnSeed>>>17; burnSeed^=burnSeed<<5;
                    return (burnSeed>>>0)/4294967296; };
function burnReset(){ burnSparks=[]; burnSmoke=[]; burnEvs=[]; burnTouch=[];
                      flashT=0; flashC.clear(); burnShake=0; if(glowF) glowF.fill(0);
                      leanSt.clear(); pipeLeanSt.clear(); waveRef=0; blastSeen=-1; }
// a screen with no plant never steps this, so a live shake would kick for ever
function burnIdle(){
  if(burnShake||burnEvs.length||burnSparks.length||burnSmoke.length||pipeLeanSt.size) burnReset();
  burnClk=0;
}

/* Screen time, not the solver's: one spring the eye can follow, kicked by the load a frame sees. A
   one-frame kick peaks near half its target, hence LEAN_KICK (tools/wavemock.html). */
const LEAN_W=2*Math.PI/0.15, LEAN_Z=0.7, LEAN_KICK=2, LEAN_H=0.005;
const leanSt=new Map();
function leanSpring(o,tx,ty,n,h){
  const w2=LEAN_W*LEAN_W, c=2*LEAN_Z*LEAN_W;
  for(let k=0;k<n;k++){
    o.vx+=(w2*(tx-o.dx)-c*o.vx)*h; o.dx+=o.vx*h;
    o.vy+=(w2*(ty-o.dy)-c*o.vy)*h; o.dy+=o.vy*h;
  }
}
function leanStep(L,dt){
  if(!(dt>0)) return;
  const G=roomGeom(), gz=roomPStatic(L), sh=waveShown(L), n=Math.ceil(dt/LEAN_H), h=dt/n;
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    // scaled by the brightest cell round the box, not weighted per cell: a dark flat side still pushes back
    const f=partLoad(L,p,gz,G,sh.w), t=partLeanOf(p, {fx:f.fx*f.lit, fy:f.fy*f.lit});
    let o=leanSt.get(p.id);
    if(!o){ o={dx:0,dy:0,vx:0,vy:0}; leanSt.set(p.id,o); }
    leanSpring(o, t.x*LEAN_KICK, t.y*LEAN_KICK, n, h);
  }
  pipeLeanStep(sh,n,h);
}
// px
function partLean(p){
  const o=leanSt.get(p.id);
  const v=leanCap({x:o?o.dx:0, y:o?o.dy:0}, LEAN_MAX);
  return {x:v.x*CELL, y:v.y*CELL};
}
/* A run bows off the pressure step across each of its cells, square to the run there, and its two
   nozzles hold. Cells per 10 kPa across one cell, the most one may bow, and what counts as at rest. */
const PIPE_LEAN_K=0.65, PIPE_LEAN_MAX=0.35, PIPE_LEAN_LO=0.002;
const pipeLeanSt=new Map();
// the traced line through every cell centre, before any bow
const runBasePts = r => [r.pts[0], ...r.cells.map(c=>cellPos(c[0],c[1])), r.pts[r.pts.length-1]];
function pipeLeanStep(g,n,h){
  const seen=new Set();
  for(const r of pipeNetwork()){
    const m=r.cells ? r.cells.length : 0;
    if(!m) continue;
    const base=runBasePts(r), tx=new Float64Array(m+2), ty=new Float64Array(m+2);
    let push=false;
    for(let j=0;j<m;j++){
      const X=r.cells[j][0], Y=r.cells[j][1];
      if(X<0||X>=GW||Y<0||Y>=GH) continue;
      const i=Y*GW+X, a=base[j], b=base[j+2];
      const dx=b[0]-a[0], dy=b[1]-a[1], l=Math.hypot(dx,dy)||1, ux=dx/l, uy=dy/l;
      const fx=-g.gx[i]*g.w[i], fy=-g.gy[i]*g.w[i], ax=fx*ux+fy*uy;
      tx[j+1]=(fx-ax*ux)*PIPE_LEAN_K/10; ty[j+1]=(fy-ax*uy)*PIPE_LEAN_K/10;
      if(Math.abs(tx[j+1])>PIPE_LEAN_LO || Math.abs(ty[j+1])>PIPE_LEAN_LO) push=true;
    }
    let st=pipeLeanSt.get(r.key);
    if(st && st.length!==m) st=null;
    if(!st){ if(!push) continue;
      st=Array.from({length:m},()=>({dx:0,dy:0,vx:0,vy:0})); pipeLeanSt.set(r.key,st); }
    let live=push;
    for(let j=0;j<m;j++){
      const o=st[j];
      leanSpring(o, (tx[j]+2*tx[j+1]+tx[j+2])/4*LEAN_KICK, (ty[j]+2*ty[j+1]+ty[j+2])/4*LEAN_KICK, n, h);
      if(Math.abs(o.dx)>PIPE_LEAN_LO || Math.abs(o.dy)>PIPE_LEAN_LO
         || Math.abs(o.vx)>PIPE_LEAN_LO*LEAN_W || Math.abs(o.vy)>PIPE_LEAN_LO*LEAN_W) live=true;
    }
    if(live) seen.add(r.key);
  }
  for(const k of [...pipeLeanSt.keys()]) if(!seen.has(k)) pipeLeanSt.delete(k);
}
function runCellPts(r){
  const st=pipeLeanSt.get(r.key), pts=runBasePts(r);
  if(st) for(let j=0;j<st.length;j++){
    const v=leanCap({x:st[j].dx, y:st[j].dy}, PIPE_LEAN_MAX);
    pts[j+1]=[pts[j+1][0]+v.x*CELL, pts[j+1][1]+v.y*CELL];
  }
  return pts;
}
// null while nothing bows the run, so a still pipe is stroked on its own corners
const runLeanPts = r => pipeLeanSt.has(r.key) ? runCellPts(r) : null;
// floored, or a dead shake jitters the board for ever at a fifth of a pixel
const burnShakeAt=()=>burnShake>0.2?burnShake:0;
// off the plant clock, not a fresh die, or the board jitters while the sim is paused
const burnShakeRnd=k=>fxHash(Math.round(fxClock()*120)*2+k)-0.5;

// centre weighted by heat; radius is the equal-area circle over the footprint
function evNew(n,c){
  const e={c, mask:new Uint8Array(n), wx:0,wy:0,w:0,cells:0,r:0,cx:0,cy:0,p:0,hot:0,hotF:0,wF:0,
           quiet:0,done:0,fade:1,burning:0,newF:0,pEmit:0,flashed:0,sparkBudget:0,smokeT:0};
  burnEvs.push(e); return e;
}
// finding TWO neighbours is how two bangs discover they have met; a wall between them keeps them two
function evFor(i,n,c){
  const X=i%GW, Y=(i/GW)|0;
  let home=null;
  for(let dy=-EV_NB;dy<=EV_NB;dy++) for(let dx=-EV_NB;dx<=EV_NB;dx++){
    const x=X+dx, y=Y+dy;
    if(x<0||y<0||x>=GW||y>=GH) continue;
    const j=y*GW+x;
    for(const e of burnEvs){
      if(e.done || !e.mask[j] || e.c!==c) continue;
      if(!home) home=e;
      else if(home!==e) burnTouch.push([home,e]);
    }
  }
  return home || evNew(n,c);
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
  const j=burnEvs.indexOf(B); if(j>=0) burnEvs.splice(j,1);
}
function evMerge(){
  for(const [A,B] of burnTouch)
    if(A!==B && burnEvs.indexOf(A)>=0 && burnEvs.indexOf(B)>=0) evFold(A,B);
  burnTouch=[];
  for(let a=0;a<burnEvs.length;a++) for(let b=a+1;b<burnEvs.length;b++){
    const A=burnEvs[a], B=burnEvs[b];
    if(A.c!==B.c || Math.hypot(A.cx-B.cx, A.cy-B.cy) > (A.r+B.r)*MERGE_K) continue;
    evFold(A,B); b--;
  }
}
// every emission is the EVENT's, never one per burning cell
function evFx(e,dt,cm,occ){
  const k=clamp(e.p/BLASTFX.full,0,1);
  const cx=GX+(e.cx+0.5)*CELL, cy=rowTop(0)+(e.cy+0.5)*CELL, rad=e.r*CELL;
  if(!e.done && e.p>20 && e.p > e.pEmit*1.6){
    e.pEmit=e.p;
    for(let j=0;j<Math.round(4+26*k);j++){
      const th=burnRnd()*6.283, sp=(90+e.p*2.2)*(0.35+burnRnd());
      burnSpawn(burnSparks, {x:cx+Math.cos(th)*rad*0.8, y:cy+Math.sin(th)*rad*0.8,
                             vx:Math.cos(th)*sp, vy:Math.sin(th)*sp,
                             life:(0.35+0.7*k)*(0.6+burnRnd()*0.8), t:0}, e.c, cm, occ);
    }
    burnShake=Math.max(burnShake, Math.min(9, e.p/34));
  }
  // peak and footprint together: a slow wide burn is a big event at low pressure
  if(!e.done && e.p>12){
    const f=clamp(Math.max(k, e.cells/260),0,1);
    if(f>e.flashed){ e.flashed=f; flashT=Math.max(flashT,0.08+0.30*f); flashA=0.16+0.44*f; flashC.add(e.c); }
  }
  // debris is priced off the cells the front TOOK this frame, not off how many are alight
  if(e.newF>0){
    e.sparkBudget += e.newF*(0.15+1.6*k);
    let n=Math.min(24, Math.floor(e.sparkBudget));
    e.sparkBudget-=n;
    while(n-- > 0){
      const th=burnRnd()*6.283, rr=Math.max(CELL*0.5,rad)*(0.35+0.65*burnRnd());
      const sp=(60+e.p*1.6)*(0.35+burnRnd());
      burnSpawn(burnSparks, {x:cx+Math.cos(th)*rr, y:cy+Math.sin(th)*rr,
                             vx:Math.cos(th)*sp, vy:Math.sin(th)*sp,
                             life:(0.35+0.6*k)*(0.6+burnRnd()*0.8), t:0}, e.c, cm, occ);
    }
  }
  if(e.fade>0 && rad>0){
    e.smokeT-=dt;
    if(e.smokeT<=0){
      e.smokeT=(0.06+0.10*burnRnd())/(0.30+0.70*k);
      const th=burnRnd()*6.283, rr=rad*Math.sqrt(burnRnd()), sc=0.5+1.6*Math.sqrt(k);
      burnSpawn(burnSmoke, {x:cx+Math.cos(th)*rr, y:cy+Math.sin(th)*rr,
                            r:CELL*(0.35+0.55*sc), vx:0, vy:-CELL*(0.55+0.8*sc),
                            life:1.6+1.4*sc+burnRnd()*1.5, t:0,
                            a:0.17+0.20*sc, g:CELL*(0.18+0.35*sc)}, e.c, cm, occ);
    }
  }
  e.wF=0; e.newF=0;
}

// px/s of the air the wave solved, at the cell centre off its two staggered faces
function airAt(s,x,y){
  const X=clamp(Math.floor((x-GX)/CELL),0,GW-1), Y=clamp(Math.floor((y-rowTop(0))/CELL),0,GH-1), i=Y*GW+X;
  // the faces carry a mass flux; over the two cells' own gas it is a velocity
  const M=s.roomM, u=(F,a,b)=>F[a]/Math.max((M[a]+M[b])/(2*ROOM_VCELL), 1e-3);
  return [(u(s.roomPU,i,Math.min(i+1,GW*GH-1))+(X>0?u(s.roomPU,i-1,i):0))/2*PX_M,
          (u(s.roomPV,i,Math.min(i+GW,GW*GH-1))+(Y>0?u(s.roomPV,i-GW,i):0))/2*PX_M];
}
/* tools/wavemock.html's spawnFx(): a charge throws its own debris and smoke, in m/s through PX_M.
   The mark only says a charge went off; what it does is the field. */
let blastSeen=-1;
function blastFx(i,cm,occ){
  const cx=GX+(i%GW+0.5)*CELL, cy=rowTop((i/GW)|0)+CELL/2, c=cm[i];
  for(let k=0;k<160;k++){ const th=burnRnd()*6.283, sp=(15+burnRnd()*45)*PX_M;
    burnSpawn(burnSparks, {x:cx, y:cy, vx:Math.cos(th)*sp, vy:Math.sin(th)*sp, life:0.8+burnRnd()*1.2, t:0}, c, cm, occ); }
  for(let k=0;k<24;k++){ const th=burnRnd()*6.283, sp=burnRnd()*4*PX_M;
    burnSpawn(burnSmoke, {x:cx+Math.cos(th)*1.5*CELL, y:cy+Math.sin(th)*1.5*CELL,
                          vx:Math.cos(th)*sp, vy:Math.sin(th)*sp-1.5*PX_M,
                          r:0.6*CELL, g:0.8*CELL, life:2.5+burnRnd()*2, t:0, a:0.35}, c, cm, occ); }
}
// thrown into the air its source stands in, never into a box or through a wall into the next compartment
function burnSpawn(list,o,c,cm,occ){
  const i=burnCell(o.x,o.y);
  if(i<0 || occ[i] || cm[i]!==c) return;
  o.c=c; list.push(o);
}
// gravity 9.81 m/s2 and a 0.6 s drag, the mock's
function burnParticles(s,dt,occ){
  const drag=Math.exp(-dt/0.6);
  for(const o of burnSparks){ o.t+=dt; const a=airAt(s,o.x,o.y);
    const nx=o.x+(o.vx+a[0])*dt, ny=o.y+(o.vy+a[1])*dt;
    if(burnPath(occ,o.x,o.y,nx,ny)){ o.x=nx; o.y=ny; } else { o.vx=0; o.vy=0; }
    o.vy+=9.81*PX_M*dt; o.vx*=drag; o.vy*=drag; }
  burnSparks=burnSparks.filter(o=>o.t<o.life);
  burnShake*=Math.exp(-dt/0.18);
  for(const o of burnSmoke){ o.t+=dt; const a=airAt(s,o.x,o.y);
    const nx=o.x+(o.vx+a[0])*dt, ny=o.y+(o.vy+a[1])*dt;
    if(burnPath(occ,o.x,o.y,nx,ny)){ o.x=nx; o.y=ny; }
    o.vy*=0.99; o.r=Math.min(o.r+o.g*dt, SMOKE_RMAX); }
  burnSmoke=burnSmoke.filter(o=>o.t<o.life);
}

// a machine and a standing wall are solid to this fire, so nothing here may be drawn in one
function burnOcc(s,G){
  const N=GW*GH, occ=new Uint8Array(N);
  for(let i=0;i<N;i++) if(G.occ[i] || (G.tight[i] && !matOpen(s,i%GW,(i/GW)|0))) occ[i]=1;
  return occ;
}
const burnCell=(x,y)=>{
  const X=Math.floor((x-GX)/CELL), Y=Math.floor((y-rowTop(0))/CELL);
  return X<0||Y<0||X>=GW||Y>=GH ? -1 : Y*GW+X;
};
const burnFree=(occ,x,y)=>{ const i=burnCell(x,y); return i>=0 && !occ[i]; };
// sampled every quarter cell, or a fast spark steps over a one-cell wall between two frames
function burnPath(occ,x0,y0,x1,y1){
  const n=Math.ceil(Math.hypot(x1-x0,y1-y0)/(CELL/4));
  for(let k=1;k<=n;k++) if(!burnFree(occ,x0+(x1-x0)*k/n,y0+(y1-y0)*k/n)) return false;
  return true;
}
// one air component as row spans: an effect stops at the wall that would stop it
function compClip(cm,c){
  ctx.beginPath();
  for(let Y=0;Y<GH;Y++){
    let x0=-1;
    for(let X=0;X<=GW;X++){
      const on = X<GW && cm[Y*GW+X]===c;
      if(on && x0<0) x0=X;
      else if(!on && x0>=0){ ctx.rect(GX+x0*CELL, rowTop(Y), (X-x0)*CELL, CELL); x0=-1; }
    }
  }
  ctx.clip();
}
// one fill per shade, not one per cell: alpha banded to 1/32, finer than the screen can show
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
  const G=roomGeomLive(s), cm=roomComp(G), occ=burnOcc(s,G);
  const now=fxClock();
  if(now<burnClk){ burnReset(); burnClk=now; }
  const dt=clamp(now-burnClk,0,0.25); burnClk=now;
  leanStep(s,dt);
  if(s.blastEv.n!==blastSeen){ if(blastSeen>=0 && s.blastEv.n>blastSeen) blastFx(s.blastEv.at,cm,occ);
    blastSeen=s.blastEv.n; }
  // how recently a cell burnt, so a front that has moved on fades instead of snapping off
  if(!glowF || glowF.length!==N) glowF=new Float64Array(N);
  const gk=Math.exp(-dt/0.35);
  if(burnEvs.length && burnEvs[0].mask.length!==N) burnReset();
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, fl=Fl[i], p=Pr[i];
      glowF[i] = fl>0 ? 1 : glowF[i]*gk;
      if(occ[i]) continue;
      const lit=glowF[i];
      if(fl<=0 && lit<=0.02 && p<=0) continue;
      const x0=GX+X*CELL;
      if(fl>0 || lit>0.02){
        // the ladder is absolute GAS TEMPERATURE, not the rise over the hull
        const g=clamp((T[i]-600)/1600,0,1);
        const col = g>0.72 ? C.fire : g>0.42 ? C.fire2 : g>0.18 ? C.amber : C.red;
        const iv=(0.34+0.66*g)*(fl>0?1:Math.max(0.4,lit));
        const iw=CELL*iv, ih=h*iv;
        const al=Math.min(0.95, Math.max(fl>0?0.55:0, lit))*(fl>0?1:BED_DIM);
        bedPush(col, al, x0+(CELL-iw)/2, y+(h-ih)/2, iw, ih);
      }
      if(fl>0) evFeed(evFor(i,N,cm[i]), i, clamp((T[i]-600)/1600,0,1), p);
    }
  }
  bedFlush();
  evStep(dt);
  for(const e of burnEvs) evFx(e,dt,cm,occ);
  burnParticles(s,dt,occ);
  // armed by the EVENT, so a standing flame lighting a cell a second never accumulates one
  flashT=Math.max(0,flashT-dt);
  if(!(flashT>0)) flashC.clear();
  const comps=new Set(flashC);
  for(const e of burnEvs) if(e.r>0 && e.fade>0) comps.add(e.c);
  for(const o of burnSparks) comps.add(o.c);
  for(const o of burnSmoke) comps.add(o.c);
  for(const c of comps){
    ctx.save(); compClip(cm,c);
    // the fireball goes down before the debris: its light is behind what flies out of it
    for(const e of burnEvs){
      if(e.c!==c || !(e.r>0 && e.fade>0)) continue;
      const cx=GX+(e.cx+0.5)*CELL, cy=rowTop(0)+(e.cy+0.5)*CELL;
      const r=Math.max(CELL*1.1, e.r*CELL*1.35), a=e.fade*(0.25+0.55*Math.max(e.hot,0.25));
      const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      gr.addColorStop(0,   alphaC(C.fire,  0.70*a));
      gr.addColorStop(0.35,alphaC(C.fire2, 0.42*a));
      gr.addColorStop(0.70,alphaC(C.amber, 0.18*a));
      gr.addColorStop(1,   alphaC(C.red,   0));
      ctx.fillStyle=gr; ctx.fillRect(cx-r,cy-r,r*2,r*2);
    }
    ctx.lineWidth=1;
    for(const o of burnSparks){
      if(o.c!==c || !burnFree(occ,o.x,o.y)) continue;
      const k=1-o.t/o.life;
      ctx.globalAlpha=Math.max(0,k); ctx.fillStyle = k>0.6?C.fire:k>0.3?C.amber:C.red;
      ctx.fillRect(o.x-SPARK_PX/2,o.y-SPARK_PX/2,SPARK_PX,SPARK_PX); ctx.globalAlpha=1;
    }
    for(const o of burnSmoke){
      if(o.c!==c || !burnFree(occ,o.x,o.y)) continue;
      const k=1-o.t/o.life;
      ctx.globalAlpha=Math.max(0,o.a*k); ctx.fillStyle=C.smoke;
      ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,6.284); ctx.fill(); ctx.globalAlpha=1;
    }
    if(flashC.has(c)){
      ctx.globalAlpha=Math.min(flashA,flashT*3.2);
      for(let i=0;i<N;i++) if(cm[i]===c && !occ[i]) fillRect(GX+(i%GW)*CELL,rowTop((i/GW)|0),CELL,CELL,C.fire);
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }
}


// bands are the region's pressure over the WALL cell's own rating, not round numbers
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
      if(data.g[Y][X]) continue;
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
    const at = L ? null : contGaugeOf(g);
    if(at) pipeTag(at.cx, at.cy-5*DRAW_K, "SEALED", C.cyan);
  }
  ctx.restore();
}
// the region's top right cell and its weakest wall's rating, or null for a region with no wall
function contGaugeOf(g){
  let top=null, rate=Infinity;
  for(const i of g.cells){ const X=i%GW, Y=(i/GW)|0;
    if(!top || Y<top.Y || (Y===top.Y && X>top.X)) top={X,Y}; }
  for(const i of g.wall) rate=Math.min(rate, matRating(i%GW,(i/GW)|0));
  if(!top || !isFinite(rate)) return null;
  const r=PIPE_DIAL_R, pad=2*DRAW_K;
  return {key:top.Y*GW+top.X, rate,
          cx:Math.round(GX+(top.X+1)*CELL-r-pad), cy:Math.round(rowTop(top.Y)+r+pad)};
}
// not a layer, like the pressurizer's: the scale is the weakest wall's rating, marked at 1 and ending at its burst
function contDials(L){
  for(const g of matRegions().regions){
    if(!g.bounded) continue;
    const at=contGaugeOf(g);
    if(!at) continue;
    const pr=regionDP(L,g), burst=at.rate*PIPE_BURST_K, r=PIPE_DIAL_R;
    const fr=pipeDisplay("cont:"+at.key, at.rate>0 ? pr/at.rate : (pr>0 ? PIPE_BURST_K : 0));
    pipeDial(at.cx, at.cy, r, fr, C.cyan, (pr*1000).toFixed(1)+" kPa", {lim:1, max:PIPE_BURST_K});
    pipeTag(at.cx, at.cy+r+11*DRAW_K, ((burst-pr)*1000).toFixed(1)+" kPa MARGIN", burst-pr<0?C.red:C.ink2);
    TIP(at.cx-r, at.cy-r, 2*r, 2*r, "CONTAINMENT PRESSURE",
      (pr*1000).toFixed(1)+" kPa over the ship's air at the worst cell inside, "+
      (at.rate>0 ? Math.round(pr/at.rate*100)+" % of what its weakest wall is rated for ("+(at.rate*1000).toFixed(1)+" kPa)" : "and one of its walls is rated for nothing")+
      ". That wall splits at "+(burst*1000).toFixed(1)+" kPa, where the dial ends; the red band is past its rating.");
  }
}
// the ship is drawn in SECTION: water is a place, it falls, it runs and it stands where it stands
function floodLayer(data,L){
  if(!L || !L.roomWater) return;
  const W=L.roomWater, G=roomGeomLive(L), q=liqWater(L);
  ctx.save();
  liqDraw(data, L, q, C.blue, 0.30, null, null);
  for(const id of (L.dmgParts||[])){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const j=id.indexOf(","), bx=+id.slice(5,j), by=+id.slice(j+1), i=by*GW+bx;
    if(!(W[i]>0)) continue;
    // off the opening's whole solved rate, liquid and flash: a drained tear bubbles nothing
    let rate=0;
    for(const key of pipeCellRuns(bx,by)) rate=Math.max(rate, (L.spillBy&&L.spillBy["break:"+key])||0);
    const br=grect(bx,by,1,1), bt=Math.max(br.y, liqY(liqSurf(q,G,i)));
    if(!(bt < br.y+br.h)) continue;
    fxCellSpace(br.x, bt, ()=>
      fxBubbles(0, 0, br.w/DRAW_K, (br.y+br.h-bt)/DRAW_K,
                fxEase("fld:"+bx+","+by, clamp(rate/SPILL_FULL,0,1)), C.blue, "pool"));
  }
  ctx.restore();
}
