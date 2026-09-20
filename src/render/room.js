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

// heat and blast cross a wall and are surveyed onto it; a SPECIES is not, because the cell holds no atmosphere to hold it
const roomAir = i => matRegions().of[i] >= 0;

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
  L = L && uiLive();
  const p = vPtr;
  if(!p) return;
  const X=Math.floor((p.x-GX)/CELL), Y=rowAt(p.y);
  if(X<0||X>=GW||Y<0||Y>=GH) return;
  const i=Y*GW+X, rows=[];
  const row=(lab,s)=>rows.push(lab+s);
  if(L){
    // through roomFace(), the layers' own door, or a wall cell reads ambient under a picture that says otherwise
    const rad=layerData("rad",L), r=rad.f[i], air=roomAir(i),
          T=roomFace(j=>L.roomT[j],i,Math.max),
          live=roomFace(j=>L.roomP[j],i,Math.max),
          worst=roomFace(j=>L.roomPPk[j],i,Math.max),
          h2=air ? eRoomH2Frac(i)*100 : 0;
    if(r>=0.005) row("DOSE         ",r.toFixed(2)+" x  "+ZONE[zoneOf(r)].lab);
    row("AIR TEMP     ",fmtT(T,0)+"  "+HEATZ[heatOf(T)].lab);
    if(h2>=0.05) row("HYDROGEN     ",h2.toFixed(1)+" %");
    if(air) row("OXYGEN       ",(eRoomO2Frac(i)*100).toFixed(1)+" %");
    if(L.roomFlame[i]>0) row("FLAME        ","BURNING");
    if(L.roomWater[i]>=0.01) row("WATER        ",L.roomWater[i].toFixed(0)+" kg  "+fmtT(eRoomWaterT(i),0));
    if(L.roomPool[i]>=0.01) row("METAL POOL   ",L.roomPool[i].toFixed(0)+" kg  "+
      fmtT(eRoomPoolT(i),0)+(roomPoolLit(L,i)?"  BURNING":""));
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

// per cell off roomH2Frac(), the expression the ignition test takes: a gas-tight cell holds no atmosphere of its own, so the cloud stops at the liner instead of being surveyed onto it
function roomH2Layer(data,L){
  L = L && uiLive();
  if(!L) return;
  let any=false;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=eRoomH2Frac(i);
      if(f>=H2_LFL) any=true;
      if(f<=0.002) continue;
      if(data.g[Y][X]) continue;
      ctx.globalAlpha = Math.min(0.22, 0.05+0.19*(f/H2_LFL));
      fillRect(GX+X*CELL,y,CELL,h, C.h2); ctx.globalAlpha=1;
    }
  }
  ctx.strokeStyle=C.h2; ctx.lineWidth=1.2;
  // the outline's closures and lists only where a cell is past the limit; an empty path is stroked either way
  if(any) roomH2Outline(data); else ctx.beginPath();
  ctx.stroke();
  ctx.lineWidth=1;
}
function roomH2Outline(data){
  const lit=i=>eRoomH2Frac(i)>=H2_LFL;
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
const scarSmoothTo = (raw,n,out) => { for(let j=0;j<n;j++)
  out[j]=(raw[Math.max(0,j-1)] + 2*raw[j] + raw[Math.min(n-1,j+1)])/4; return out; };
// scratch rows, grown and never shrunk: the scar pass runs per part per frame
let SCAR_RAW=new Float64Array(64), SCAR_D=new Float64Array(64);
const scarRows = n => { if(SCAR_RAW.length<n){ SCAR_RAW=new Float64Array(n); SCAR_D=new Float64Array(n); } };
const SCAR_RECT={x:0,y:0,w:0,h:0}, SCAR_MAT_R={x:0,y:0,w:0,h:0};
// a ship nobody has blasted has no soot, so the pass is a scan once a frame and nothing more
let scarPass=0, scarOn=false;
const scarAny = L => { const p=layPass();
  if(p && p===scarPass) return scarOn;
  scarPass=p; scarOn=false;
  const s=L.roomScar; for(let i=0;i<s.length;i++) if(s[i]>0){ scarOn=true; break; }
  return scarOn; };
// layer k's outline, u along the side and v in from the face; one call per layer, since a double handed per point to a helper is a heap number
function scarPath(sd,r,d,n,k){
  const f=k/SCAR_LAYERS;
  ctx.beginPath();
  for(let m=0;m<n+4;m++){
    const u = m<2 ? 0 : m<n+2 ? (m-1.5)*CELL : n*CELL;
    const v = m===0||m===n+3 ? 0 : m===1 ? d[0]*f : m<n+2 ? d[m-2]*f : d[n-1]*f;
    const x = sd==="l" ? r.x+v : sd==="r" ? r.x+r.w-v : r.x+u;
    const y = sd==="l"||sd==="r" ? r.y+u : sd==="t" ? r.y+v : r.y+r.h-v;
    if(m===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.fill();
}
// a box or a wall books no scar of its own; the air beside it does
const scarAt = (L,G,X,Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return 0; const i=Y*GW+X;
  return G.occ[i] || G.tight[i] ? 0 : L.roomScar[i]; };
// tools/wavemock.html's paintScars(), run straight between cell centres rather than in half-cell blocks
function scarPart(L,p){
  if(!fitted(p)) return;
  const G=roomGeom(), r=grectTo(SCAR_RECT,p.x,p.y,p.w,p.h);
  ctx.fillStyle=C.scar; ctx.globalAlpha=SCAR_A/SCAR_LAYERS;
  for(let s=0;s<4;s++){ const sd="lrtb"[s];
    const vert = sd==="l" || sd==="r", n = vert ? p.h : p.w, across = vert ? r.w : r.h;
    scarRows(n);
    const raw=SCAR_RAW; let any=false;
    for(let j=0;j<n;j++){
      const a = sd==="l" ? scarAt(L,G,p.x-1,p.y+j) : sd==="r" ? scarAt(L,G,p.x+p.w,p.y+j)
              : sd==="t" ? scarAt(L,G,p.x+j,p.y-1) : scarAt(L,G,p.x+j,p.y+p.h);
      raw[j] = a>0 ? SCAR_MIN + SCAR_DEEP*across*scarF(a) : 0;
      if(a>0) any=true;
    }
    if(!any) continue;
    const d=scarSmoothTo(raw,n,SCAR_D);
    for(let k=1;k<=SCAR_LAYERS;k++) scarPath(sd,r,d,n,k);
  }
  ctx.globalAlpha=1;
}
// the same soot on what else stands in the air: every pipe through a scarred cell, and every wall beside one
function scarSurfaces(L){
  const G=roomGeom();
  ctx.fillStyle=C.scar; ctx.strokeStyle=C.scar;
  ctx.lineCap="butt"; ctx.lineJoin="round";
  for(const r of pipeNetwork()){
    if(!r.cells || !r.cells.length) continue;
    const n=r.cells.length;
    scarRows(n);
    let any=false;
    for(let j=0;j<n;j++){ const c=r.cells[j], v=scarF(scarAt(L,G,c[0],c[1])); SCAR_RAW[j]=v; if(v>0) any=true; }
    if(!any) continue;
    const a=scarSmoothTo(SCAR_RAW,n,SCAR_D), cw=runDrawW(r).cw;
    const pts=runCellPts(r), R=runDrawR(r,cw);
    ctx.lineWidth=cw;
    for(let j=0;j<n;j++){
      if(!(a[j]>0)) continue;
      // each end is the midpoint to the next cell, or the run's own end on the last one
      const p=pts[j+1], q0=pts[j], q1=pts[j+2];
      const s0x = j===0 ? q0[0] : (q0[0]+p[0])/2, s0y = j===0 ? q0[1] : (q0[1]+p[1])/2;
      const s1x = j===n-1 ? q1[0] : (p[0]+q1[0])/2, s1y = j===n-1 ? q1[1] : (p[1]+q1[1])/2;
      ctx.globalAlpha=SCAR_A*a[j];
      ctx.beginPath(); ctx.moveTo(s0x,s0y); ctx.arcTo(p[0],p[1],s1x,s1y,R); ctx.lineTo(s1x,s1y); ctx.stroke();
    }
  }
  const RG=matRegions(), cells=matDrawCells();
  for(let c=0;c<cells.n;c++){
    const x=cells.x[c], y=cells.y[c];
    let v=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) v=Math.max(v, scarAt(L,G,x+dx,y+dy));
    if(!(v>0)) continue;
    const r=grectTo(SCAR_MAT_R,x,y,1,1);
    ctx.globalAlpha=SCAR_A*scarF(v);
    matBandPath(r, matInFaces(RG,x,y), matWallPx(x,y,r)); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// the worst reading per cell is the tooltip's, off s.roomPPk
function roomPLayer(data,L,seam,p){
  L = L && uiLive();
  if(!L || !scarAny(L)) return;
  if(seam==="skin") scarPart(L,p);
  else if(seam==="under") scarSurfaces(L);
}

/* grad p in kPa per cell over OPEN faces only, which is what a schlieren photograph is of: a level
   at any height has no step in it and draws black, and a wall face gives no slope. */
let gradX=null, gradY=null;
const WAVE_G={gx:null, gy:null};
function waveGrad(L){
  const P=L.roomP, G=uiRoomGeom(), bx=G.bx, by=G.by, N=P.length;
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
  WAVE_G.gx=gradX; WAVE_G.gy=gradY;
  return WAVE_G;
}
/* tools/wavemock.html's paint(): against the loudest slope since the plant was built, which never
   falls, or a fading wave holds full brightness and then blinks out. Floored at PNOW_LO kPa per cell,
   or float noise in a still room becomes the reference and draws at full. */
const PNOW_LO=0.5, PNOW_CUT=0.02, PNOW_A=0.92;
let waveRef=0, shownA=null, shownW=null;
// what PRESSURE NOW draws per cell, `a` the slope over the reference and `w` its brightness 0..1; the lean reads `w`, so nothing moves where the layer is dark
// once per layout window, into one register: the layer and the lean both ask it every frame
const WAVE_S={gx:null, gy:null, a:null, w:null};
let wavePass=0;
function waveShown(L){
  const pass=layPass();
  if(pass && pass===wavePass) return WAVE_S;
  wavePass=pass;
  const g=waveGrad(L), N=g.gx.length;
  if(!shownA || shownA.length!==N){ shownA=new Float64Array(N); shownW=new Float64Array(N); }
  let mx=PNOW_LO;
  /* sqrt, not hypot: hypot takes its arguments as a list and builds one per cell per frame */
  for(let i=0;i<N;i++){ const ax=g.gx[i], ay=g.gy[i], f=Math.sqrt(ax*ax+ay*ay); shownA[i]=f; if(f>mx) mx=f; }
  if(mx>waveRef) waveRef=mx;
  /* a face under WAVE_P_LO is at rest by the gas step's own gate, which stops solving there and leaves the step standing, so drawn it sticks on screen forever */
  for(let i=0;i<N;i++){ const a=shownA[i]/waveRef, on=a>=PNOW_CUT && Math.max(Math.abs(g.gx[i]), Math.abs(g.gy[i]))>=WAVE_P_LO;
    shownA[i]=on ? a : 0; shownW[i]=on ? Math.min(1, Math.sqrt(a)/PNOW_A) : 0; }
  WAVE_S.gx=g.gx; WAVE_S.gy=g.gy; WAVE_S.a=shownA; WAVE_S.w=shownW;
  return WAVE_S;
}
function roomPNowLayer(data,L){
  L = L && uiLive();
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
  L = L && uiLive();
  if(!L) return;
  const getO2=j=>eRoomO2Frac(j);
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=getO2(i);
      if(!roomAir(i) || f>=O2_FRAC0*0.9 || data.g[Y][X]) continue;
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
// scratch grown and never shrunk: standing runs per column, and per cell a band's width and flag, once rather than per neighbour
let LIQ_N=0, LIQ_SX=new Int32Array(0), LIQ_ST=new Int32Array(0), LIQ_Z0=new Float64Array(0), LIQ_SU=new Float64Array(0),
    LIQ_SV=new Float64Array(0), LIQ_YB=new Float64Array(0), LIQ_YT=new Float64Array(0), LIQ_W=new Float64Array(0), LIQ_B=new Uint8Array(0);
const LIQ_POOL_O={size:8, align:"center", color:C.amber};
function liqScratch(N){
  if(LIQ_W.length>=N) return;
  LIQ_SX=new Int32Array(N); LIQ_ST=new Int32Array(N); LIQ_Z0=new Float64Array(N); LIQ_SU=new Float64Array(N);
  LIQ_SV=new Float64Array(N); LIQ_YB=new Float64Array(N); LIQ_YT=new Float64Array(N); LIQ_W=new Float64Array(N); LIQ_B=new Uint8Array(N);
}
// one path per shade, so bodies side by side are one colour
function liqBody(on, lit, px, a, col){
  ctx.beginPath();
  for(let s=0;s<LIQ_N;s++){
    const top=LIQ_ST[s], yb=LIQ_YB[s], yt=LIQ_YT[s];
    if(!!(lit && lit(top))!==on || yb-yt<px) continue;
    const x0=GX+LIQ_SX[s]*CELL;
    ctx.rect(x0, yt, CELL, yb-yt);
    if(on) txt(fmtT(eRoomPoolT(top),0), x0+CELL/2, yb-3, LIQ_POOL_O);
  }
  ctx.globalAlpha=on ? 0.50 : a; ctx.fillStyle=on ? C.amber : col; ctx.fill(); ctx.globalAlpha=1;
}
function liqDraw(data, L, q, col, a, under, lit){
  const G=uiRoomGeom(), M=q.M, N=GW*GH;
  liqScratch(N);
  // nothing under one device pixel is drawn: a 0.04 kg film draws a 1.4 px line across a cell and reads as a body
  const sc=ctxScale(), px=sc>0 ? 1/sc : 0;
  LIQ_N=0;
  for(let X=0;X<GW;X++){
    let s=-1;
    for(let Y=GH-1;Y>=0;Y--){
      const i=Y*GW+X;
      if(liqShut(G,i) || !(M[i]>=LIQ_SEEN) || !liqStands(q,G,i)){ s=-1; continue; }
      if(s<0){ s=LIQ_N++; LIQ_SX[s]=X; LIQ_Z0[s]=zFloor(i); LIQ_SU[s]=0; LIQ_SV[s]=0; }
      if(under) LIQ_SU[s]+=liqFill(under.M,under.rho,i);
      LIQ_SV[s]+=liqFill(M,q.rho,i); LIQ_ST[s]=i;
    }
  }
  for(let s=0;s<LIQ_N;s++){ LIQ_YB[s]=liqY(LIQ_Z0[s]+LIQ_SU[s]); LIQ_YT[s]=liqY(LIQ_Z0[s]+LIQ_SU[s]+LIQ_SV[s]); }
  liqBody(false, lit, px, a, col);
  if(lit) liqBody(true, lit, px, a, col);
  ctx.beginPath();
  for(let s=0;s<LIQ_N;s++){ if(LIQ_YB[s]-LIQ_YT[s]<px) continue; const x0=GX+LIQ_SX[s]*CELL;
    ctx.moveTo(x0, LIQ_YT[s]); ctx.lineTo(x0+CELL, LIQ_YT[s]); }
  ctx.strokeStyle=col; ctx.lineWidth=1.4; ctx.stroke();
  /* The falling water: a trapezoid per moving cell, its width the fill of the cell, its ends the mean with the falling neighbour over and under it. The pixel gate is part of what a band IS, or a neighbour too thin to draw still counts as one. */
  const W=LIQ_W, B=LIQ_B;
  for(let i=0;i<N;i++){
    if(liqShut(G,i)){ W[i]=0; B[i]=0; continue; }
    const w=clamp(M[i]/Math.max(liqCap(q,i),1e-9),0,1)*CELL;
    W[i]=w; B[i]=M[i]>=LIQ_SEEN && !liqStands(q,G,i) && liqSpeed(q,i)>LIQ_REST && w>=px ? 1 : 0;
  }
  ctx.beginPath();
  for(let i=0;i<N;i++){
    const up=i>=GW && B[i-GW], dn=i+GW<N && B[i+GW];
    // a fall one cell tall is a splash, not a stream
    if(!B[i] || (!up && !dn)) continue;
    const X=i%GW, Y=(i/GW)|0, xc=GX+X*CELL+CELL/2, y0=rowTop(Y), y1=rowTop(Y+1), w=W[i];
    const wt=up ? (w+W[i-GW])/2 : w, wb=dn ? (w+W[i+GW])/2 : w;
    ctx.moveTo(xc-wt/2, y0); ctx.lineTo(xc+wt/2, y0); ctx.lineTo(xc+wb/2, y1); ctx.lineTo(xc-wb/2, y1); ctx.closePath();
  }
  ctx.globalAlpha=a; ctx.fillStyle=col; ctx.fill(); ctx.globalAlpha=1;
}
function roomNaLayer(data,L){
  L = L && uiLive();
  if(!L || !L.roomPool) return;
  liqDraw(data, L, liqMetal(L), C.ink2, 0.42, liqWater(L), i=>roomPoolLit(L,i));
}

// the skin, not the air: it has mass, so a box lags the room it stands in
function heatParts(L){
  L = L && uiLive();
  if(!L) return;
  const T=L.roomT, cellsOf={};
  for(const q of roomGeom().parts) cellsOf[q.p.id]=q.cells;
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    const lim=partTsurv(p), v=uiPartSkin(p.id) ?? T_HULL, {x,y,w}=prect(p);
    txt(fmtT(v,0), x+w/2, y+20,
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
  const G=roomGeom(), gz=uiRoomPStatic(), sh=waveShown(L), n=Math.ceil(dt/LEAN_H), h=dt/n;
  for(const p of LAY.parts){
    if(!fitted(p)) continue;
    // scaled by the brightest cell round the box, not weighted per cell: a dark flat side still pushes back
    const f=partLoad(L,p,gz,G,sh.w), k=partLeanK(p)*f.lit*LEAN_KICK;
    let o=leanSt.get(p.id);
    if(!o){ o={dx:0,dy:0,vx:0,vy:0}; leanSt.set(p.id,o); }
    leanSpring(o, f.fx*k, f.fy*k, n, h);
  }
  pipeLeanStep(sh,n,h);
}
// px; one register, read and dropped - LEAN_NONE is the still answer
const PART_LEAN={x:0,y:0}, LEAN_NONE=Object.freeze({x:0,y:0});
function partLean(p){
  const o=leanSt.get(p.id), dx=o?o.dx:0, dy=o?o.dy:0, k=leanCapK(dx,dy,LEAN_MAX)*CELL;
  PART_LEAN.x=dx*k; PART_LEAN.y=dy*k;
  return PART_LEAN;
}
/* A run bows off the pressure step across each of its cells, square to the run there, and its two
   nozzles hold. Cells per 10 kPa across one cell, the most one may bow, and what counts as at rest. */
const PIPE_LEAN_K=0.65, PIPE_LEAN_MAX=0.35, PIPE_LEAN_LO=0.002;
const pipeLeanSt=new Map();
// the traced line through every cell centre, before any bow; once per run object (pipeNetwork() holds it for its GY), never written
const runBaseMemo=new WeakMap();
const runBasePts = r => { let b=runBaseMemo.get(r);
  if(!b){ b=[r.pts[0], ...r.cells.map(c=>cellPos(c[0],c[1])), r.pts[r.pts.length-1]]; runBaseMemo.set(r,b); }
  return b; };
// scratch rows grown and never shrunk, and a pass stamp in place of a set: this steps every frame a plant runs
let leanTX=new Float64Array(64), leanTY=new Float64Array(64), leanPass=0;
const leanDrop=(st,k)=>{ if(st.mark!==leanPass) pipeLeanSt.delete(k); };
function pipeLeanStep(g,n,h){
  leanPass++;
  for(const r of pipeNetwork()){
    const m=r.cells ? r.cells.length : 0;
    if(!m) continue;
    if(leanTX.length<m+2){ leanTX=new Float64Array(m+2); leanTY=new Float64Array(m+2); }
    const base=runBasePts(r), tx=leanTX, ty=leanTY;
    tx.fill(0,0,m+2); ty.fill(0,0,m+2);
    let push=false;
    for(let j=0;j<m;j++){
      const X=r.cells[j][0], Y=r.cells[j][1];
      if(X<0||X>=GW||Y<0||Y>=GH) continue;
      const i=Y*GW+X, a=base[j], b=base[j+2];
      const dx=b[0]-a[0], dy=b[1]-a[1], l=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/l, uy=dy/l;
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
    if(live) st.mark=leanPass;
  }
  pipeLeanSt.forEach(leanDrop);
}
// the base line itself while nothing bows the run, so a caller only reads what this hands back
// the bowed line into one buffer per run, once per layout window: every pass that strokes a bowing run asks it
const runBowMemo=new WeakMap();
function runCellPts(r){
  const st=pipeLeanSt.get(r.key), base=runBasePts(r);
  if(!st) return base;
  let b=runBowMemo.get(r);
  if(!b){ b={pass:0, pts:base.map(p=>[p[0],p[1]])}; runBowMemo.set(r,b); }
  const pass=layPass();
  if(pass && b.pass===pass) return b.pts;
  b.pass=pass;
  const pts=b.pts;
  for(let j=0;j<base.length;j++){ pts[j][0]=base[j][0]; pts[j][1]=base[j][1]; }
  for(let j=0;j<st.length;j++){
    const dx=st[j].dx, dy=st[j].dy, k=leanCapK(dx,dy,PIPE_LEAN_MAX)*CELL;
    pts[j+1][0]+=dx*k; pts[j+1][1]+=dy*k;
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
// the same while the build and the damage list hold, which is nearly every frame; read only
let burnOccA=null, burnOccG=null, burnOccD=null;
const BURN_COMPS=new Set();
function burnOcc(s,G){
  if(burnOccA && burnOccG===G && burnOccD===s.dmgParts) return burnOccA;
  const N=GW*GH;
  if(!burnOccA || burnOccA.length!==N) burnOccA=new Uint8Array(N); else burnOccA.fill(0);
  const occ=burnOccA;
  for(let i=0;i<N;i++) if(G.occ[i] || (G.tight[i] && !matOpen(s,i%GW,(i/GW)|0))) occ[i]=1;
  burnOccG=G; burnOccD=s.dmgParts;
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
  s = s && uiLive();
  if(!s) return;
  if(!s.roomFlame) return;
  const T=s.roomT, Fl=s.roomFlame, Pr=s.roomP, N=Fl.length;
  const G=uiRoomGeom(), cm=roomComp(G), occ=burnOcc(s,G);
  const now=fxClock();
  if(now<burnClk){ burnReset(); burnClk=now; }
  const dt=clamp(now-burnClk,0,0.25); burnClk=now;
  leanStep(s,dt);
  const bn=uiBlastN();
  if(bn!==blastSeen){ if(blastSeen>=0 && bn>blastSeen) blastFx(uiBlastAt(),cm,occ);
    blastSeen=bn; }
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
  const comps=BURN_COMPS; comps.clear(); for(const c of flashC) comps.add(c);
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
  L = L && uiLive();
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
// geometry and a rating, both the drawing's: once per region object (matRegions() holds it for its DGEN) and GY
const contGaugeMemo=new WeakMap();
const CONT_DIAL_O={lim:1, max:PIPE_BURST_K};
// the region's top right cell and its weakest wall's rating, or null for a region with no wall
function contGaugeOf(g){
  const was=contGaugeMemo.get(g);
  if(was!==undefined && (was===null || was.gy===GY)) return was;
  let top=null, rate=Infinity;
  for(const i of g.cells){ const X=i%GW, Y=(i/GW)|0;
    if(!top || Y<top.Y || (Y===top.Y && X>top.X)) top={X,Y}; }
  for(const i of g.wall) rate=Math.min(rate, matRating(i%GW,(i/GW)|0));
  let at=null;
  if(top && isFinite(rate)){ const r=PIPE_DIAL_R, pad=2*DRAW_K, key=top.Y*GW+top.X;
    at={key, disp:"cont:"+key, rate, gy:GY, g, wall:"its weakest wall", title:"CONTAINMENT PRESSURE",
        cx:Math.round(GX+(top.X+1)*CELL-r-pad), cy:Math.round(rowTop(top.Y)+r+pad)}; }
  contGaugeMemo.set(g,at);
  return at;
}
const shipRegion = () => matRegions().regions.find(g=>!g.bounded) || null;
/* The volume the ship itself is: its boundary is the hull and not a painted cell, so the scale is what
   any boundary is built to hold, and it hangs one cell OUTSIDE the grid where nothing can be drawn. */
function shipGaugeOf(){
  const g=shipRegion(); if(!g) return null;
  const was=contGaugeMemo.get(g); if(was && was.gy===GY) return was;
  const r=PIPE_DIAL_R, pad=2*DRAW_K;
  const at={key:"ship", disp:"cont:ship", rate:MAT_PDES, gy:GY, g, wall:"the hull", title:"GRID PRESSURE",
          cx:Math.round(GX+(GW+1)*CELL-r-pad), cy:Math.round(rowTop(0)+r+pad)};
  contGaugeMemo.set(g,at);
  return at;
}
function contDialTip(at){
  const pr=regionDP(uiLive(),at.g), burst=at.rate*PIPE_BURST_K, wall=at.wall;
  return [at.title,
    (pr*1000).toFixed(1)+" kPa over the ship's air at the worst cell inside, "+
    (at.rate>0 ? Math.round(pr/at.rate*100)+" % of what "+wall+" is rated for ("+(at.rate*1000).toFixed(1)+" kPa)" : "and "+wall+" is rated for nothing")+
    ". That wall splits at "+(burst*1000).toFixed(1)+" kPa, where the dial ends; the red band is past its rating."];
}
// one dial wherever a volume's pressure is read: the scale is the rating it is judged against, marked at 1 and ending at its burst
function contDialAt(L,at,pr){
  const r=PIPE_DIAL_R;
  const fr=pipeDisplay(at.disp, at.rate>0 ? pr/at.rate : (pr>0 ? PIPE_BURST_K : 0));
  const m=graphSlot("contTxt"); let slot=m.get(at.disp); if(!slot){ slot=txtSlot(); m.set(at.disp,slot); }
  pipeDial(at.cx, at.cy, r, fr, C.cyan, fixTxt(slot,pr*1000,1," kPa"), CONT_DIAL_O);
  TIPF(at.cx-r, at.cy-r, 2*r, 2*r, contDialTip, at);
}
// not a layer, like the pressurizer's
function contDials(L){
  L = L && uiLive();
  const R=matRegions().regions;
  for(let i=0;i<R.length;i++){ const g=R[i];
    if(!g.bounded) continue;
    const at=contGaugeOf(g);
    if(at) contDialAt(L,at,regionDP(L,g));
  }
  const sh=shipGaugeOf();
  if(sh) contDialAt(L,sh,regionDP(L,sh.g));
}
// the ship is drawn in SECTION: water is a place, it falls, it runs and it stands where it stands
const FLOOD_R={x:0,y:0,w:0,h:0};
function floodLayer(data,L){
  L = L && uiLive();
  if(!L || !L.roomWater) return;
  const W=L.roomWater, G=uiRoomGeom(), q=liqWater(L);
  ctx.save();
  liqDraw(data, L, q, C.blue, 0.30, null, null);
  for(const id of uiWreckedIds()){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const j=id.indexOf(","), bx=+id.slice(5,j), by=+id.slice(j+1), i=by*GW+bx;
    if(!(W[i]>0)) continue;
    // off the opening's whole solved rate, liquid and flash: a drained tear bubbles nothing
    let rate=0;
    for(const key of pipeCellRuns(bx,by)) rate=Math.max(rate, uiSpill(breakKeyOf(key)));
    const br=grectTo(FLOOD_R,bx,by,1,1), bt=Math.max(br.y, liqY(liqSurf(q,G,i)));
    if(!(bt < br.y+br.h)) continue;
    fxCellOpen(br.x, bt);
    fxBubbles(0, 0, br.w/DRAW_K, (br.y+br.h-bt)/DRAW_K,
              fxEase(partKey(id,"fld"), clamp(rate/SPILL_FULL,0,1)), C.blue, "pool");
    ctx.restore();
  }
  ctx.restore();
}
