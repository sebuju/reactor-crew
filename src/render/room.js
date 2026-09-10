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

// fill skips an occupied cell (the radZones() rule); the iso-line does not, because a machine IS a wall to this field
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
      if(L){ row("REGION PRESS ",(regionDP(L,g)*1000).toFixed(1)+" kPa");
             const d=regionFloodM(L,g);
             if(d>0.05) row("FLOODED TO   ",d.toFixed(1)+" m   "+(regionSump(L,g)/1000).toFixed(1)+" t"); } } }
  if(!rows.length) return;
  TIP(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y), "CELL "+X+","+Y, rows.join("\n"));
}

// off roomH2Frac(), the same expression the ignition test uses, so a cell cannot draw as safe and burn
function roomH2Layer(data,L){
  if(!L) return;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, f=roomH2Frac(L,i);
      if(f<=0.002) continue;
      if(data.g[Y][X]) continue;
      ctx.globalAlpha = Math.min(0.22, 0.05+0.19*(f/H2_LFL));
      fillRect(GX+X*CELL,y,CELL,h, C.h2); ctx.globalAlpha=1;
    }
  }
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

/* One table for the whole blast picture. The front is one cell thick because at 0.4667 m cells the
   physics cannot resolve a real shock, which is millimetres; `smooth` reads between cell centres and
   adds no information, and `trailTau` fades a passed cell rather than slowing the front down. */
const BLASTFX={
  trailTau:0,     // s a cell keeps glowing after the front has passed
  smooth:0,       // 0 blocky, 1 fully blended between cell centres
  lo:15,          // kPa below which the layer is silent
  full:600,       // kPa that reads as a full bang
  scar:200,       // kPa that reads as a full scar
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
// draws s.roomPPk, the high-water mark on S: the live field relieves in half a second and would read empty
const scarF = v => v<BLASTFX.lo ? 0 : Math.min(1,(v-BLASTFX.lo)/(BLASTFX.scar-BLASTFX.lo));
/* Display state off the plant clock, never on S, like every other list in this file. The leading edge
   still moves at the true speed; this is a fading tail behind it. */
let blastTrail=null, blastTrailT=null;
function blastLive(L){
  if(!(BLASTFX.trailTau>0)){ blastTrailT=null; return L.roomP; }
  const N=L.roomP.length, dt=blastTrailT===null ? 0 : clamp(burnClk-blastTrailT,0,0.25);
  blastTrailT=burnClk;
  if(!blastTrail || blastTrail.length!==N) blastTrail=new Float32Array(N);
  const k=dt>0 ? Math.exp(-dt/BLASTFX.trailTau) : 1;
  for(let i=0;i<N;i++){ const t=blastTrail[i]*k, v=L.roomP[i];
    blastTrail[i]= v>t ? v : t; }
  return blastTrail;
}
/* Centred over the four neighbours; a cell on the edge of the grid reads itself in place of the one
   that is not there. It adds no information and is not pretending to - at 0.4667 m cells the physics
   cannot resolve a front thinner than one cell. */
function blastSmooth(F,X,Y){
  const i=Y*GW+X;
  return 0.5*F[i] + 0.125*(F[X>0?i-1:i] + F[X<GW-1?i+1:i] + F[Y>0?i-GW:i] + F[Y<GH-1?i+GW:i]);
}
function roomPLayer(data,L){
  if(!L) return;
  const pk=L.roomPPk, live=blastLive(L), sm=BLASTFX.smooth;
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, v=pk[i];
      if(v<BLASTFX.lo) continue;
      const z=blastOf(v), Z=BLASTZ[z], x0=GX+X*CELL;
      ctx.globalAlpha=0.25+0.65*scarF(v); fillRect(x0,y,CELL,h,C.scar);
      ctx.globalAlpha=Z.a; fillRect(x0,y,CELL,h,Z.col); ctx.globalAlpha=1;
      const now = sm>0 ? live[i]+(blastSmooth(live,X,Y)-live[i])*sm : live[i];
      if(now>=BLASTFX.lo) fxPulse(x0,y,CELL,h,Z.col,1,4);
      if(X<GW-1 && blastOf(pk[i+1])!==z) fillRect(x0+CELL-1,y,1,h,Z.col);
      if(Y<GH-1 && blastOf(pk[i+GW])!==z) fillRect(x0,rowTop(Y+1)-1,CELL,1,Z.col);
    }
  }
}

// depletion only: a cell at what air actually holds prints nothing
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

function roomNaLayer(data,L){
  if(!L || !L.roomPool) return;
  const cell = ROOM_VCELL*fireRho();
  for(let Y=0;Y<GH;Y++){
    const y=rowTop(Y), h=rowTop(Y+1)-y;
    for(let X=0;X<GW;X++){
      const i=Y*GW+X, kg=L.roomPool[i];
      if(!(kg>=0.01)) continue;
      const lit=roomPoolLit(L,i);
      ctx.globalAlpha = lit ? 0.50 : 0.12+0.30*Math.min(1,kg/cell);
      fillRect(GX+X*CELL,y,CELL,h, lit?C.amber:C.ink2); ctx.globalAlpha=1;
      if(lit) txt(roomPoolT(L,i).toFixed(0)+" K", GX+X*CELL+CELL/2, y+h-3,
                  {size:8, align:"center", color:C.amber});
    }
  }
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
const heatLayer=(data,L,seam)=> seam==="under" ? roomZones(data) : heatParts(L);

// the effect belongs to a BANG, not a cell; every list below is display state off the plant clock, never on S
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
// floored, or a dead shake jitters the board for ever at a fifth of a pixel
const burnShakeAt=()=>burnShake>0.2?burnShake:0;
// off the plant clock, not a fresh die, or the board jitters while the sim is paused
const burnShakeRnd=k=>fxHash(Math.round(fxClock()*120)*2+k)-0.5;

// centre weighted by heat; radius is the equal-area circle over the footprint
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
  for(const [A,B] of burnTouch)
    if(A!==B && burnEvs.indexOf(A)>=0 && burnEvs.indexOf(B)>=0) evFold(A,B);
  burnTouch=[];
  for(let a=0;a<burnEvs.length;a++) for(let b=a+1;b<burnEvs.length;b++){
    const A=burnEvs[a], B=burnEvs[b];
    if(Math.hypot(A.cx-B.cx, A.cy-B.cy) > (A.r+B.r)*MERGE_K) continue;
    evFold(A,B); b--;
  }
}
// the leading front survives and takes the other's overpressure
function ringFold(A,B){
  const keep = !A.ring ? B.ring : !B.ring ? A.ring : (A.ring.R>=B.ring.R ? A.ring : B.ring);
  const drop = keep===A.ring ? B.ring : A.ring;
  if(drop){ const j=burnRings.indexOf(drop); if(j>=0) burnRings.splice(j,1); }
  if(keep && drop){ keep.dp=Math.max(keep.dp,drop.dp); keep.dp0=Math.max(keep.dp0,drop.dp0); }
  A.ring=keep;
}

// every emission is the EVENT's, never one per burning cell
function evFx(e,dt){
  const k=clamp(e.p/BLASTFX.full,0,1);
  const cx=GX+(e.cx+0.5)*CELL, cy=rowTop(0)+(e.cy+0.5)*CELL, rad=e.r*CELL;
  // fronts are spaced in distance, not pressure
  if(!e.done && e.p>20 && e.p > e.pEmit*1.6 &&
     (!e.ring || e.ring.R > Math.max(ROOM_DEPTH/2, e.r*MPC) + RING_GAP)){
    e.pEmit=e.p;
    e.ring={x:cx, y:cy, R:Math.max(ROOM_DEPTH/2, e.r*MPC), dp:e.p, dp0:e.p, u:0};
    burnRings.push(e.ring);
    for(let j=0;j<Math.round(4+26*k);j++){
      const th=burnRnd()*6.283, sp=(90+e.p*2.2)*(0.35+burnRnd());
      burnSparks.push({x:cx+Math.cos(th)*rad*0.8, y:cy+Math.sin(th)*rad*0.8,
                       vx:Math.cos(th)*sp, vy:Math.sin(th)*sp,
                       life:(0.35+0.7*k)*(0.6+burnRnd()*0.8), t:0});
    }
    burnShake=Math.max(burnShake, Math.min(9, e.p/34));
  }
  // peak and footprint together: a slow wide burn is a big event at low pressure
  if(!e.done && e.p>12){
    const f=clamp(Math.max(k, e.cells/260),0,1);
    if(f>e.flashed){ e.flashed=f; flashT=Math.max(flashT,0.08+0.30*f); flashA=0.16+0.44*f; }
  }
  // debris is priced off the cells the front TOOK this frame, not off how many are alight
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
  if(e.fade>0 && rad>0){
    e.smokeT-=dt;
    if(e.smokeT<=0){
      e.smokeT=(0.06+0.10*burnRnd())/(0.30+0.70*k);
      const th=burnRnd()*6.283, rr=rad*Math.sqrt(burnRnd()), sc=0.5+1.6*Math.sqrt(k);
      burnSmoke.push({x:cx+Math.cos(th)*rr, y:cy+Math.sin(th)*rr,
                      r:CELL*(0.35+0.55*sc), vy:-CELL*(0.55+0.8*sc),
                      life:1.6+1.4*sc+burnRnd()*1.5, t:0,
                      a:0.17+0.20*sc, g:CELL*(0.18+0.35*sc)});
    }
  }
  e.wF=0; e.newF=0;
}

// Rankine-Hugoniot front speed with cylindrical decay; WAVE_SLOW is not physics
const A0=347, GAM=1.4, DP_MIN=BLASTFX.lo, WAVE_SUB=4, WAVE_SLOW=16, OBS_K=2.2;
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

// a machine is a wall to this fire, so nothing here may be drawn on a box
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
  const occ=burnOcc(N);
  { let b=0; for(let i=0;i<N;i++) if(occ[i]) b++; burnBlock=b/N; }
  const now=fxClock();
  if(now<burnClk){ burnReset(); burnClk=now; }
  const dt=clamp(now-burnClk,0,0.25); burnClk=now;
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
      if(fl>0) evFeed(evFor(i,N), i, clamp((T[i]-600)/1600,0,1), p);
    }
  }
  bedFlush();
  evStep(dt);
  for(const e of burnEvs) evFx(e,dt);
  burnParticles(dt);
  // the fireball goes down before the debris: its light is behind what flies out of it
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
  // a ring is one circle and cannot be skipped per cell, so the free deck is the clip
  ctx.save();
  ctx.beginPath();
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(!occ[Y*GW+X]) ctx.rect(GX+X*CELL, rowTop(Y), CELL, rowTop(Y+1)-rowTop(Y));
  ctx.clip();
  for(const o of burnRings){
    const f=clamp(o.dp/o.dp0,0,1);
    ctx.globalAlpha=clamp(0.10+0.72*Math.sqrt(f),0,0.9);
    ctx.strokeStyle = o.dp>=120 ? C.bright : o.dp>=70 ? C.fire2 : o.dp>=20 ? C.amber : C.ink;
    ctx.lineWidth=1+3.5*Math.sqrt(f)*clamp(0.35+o.dp0/300,0,1);
    ctx.beginPath(); ctx.arc(o.x,o.y,o.R*PX_M,0,6.284); ctx.stroke(); ctx.globalAlpha=1;
  }
  ctx.restore();
  ctx.lineWidth=1;
  for(const o of burnSparks){
    if(!burnFree(occ,o.x,o.y)) continue;
    const k=1-o.t/o.life;
    ctx.globalAlpha=Math.max(0,k); ctx.fillStyle = k>0.6?C.fire:k>0.3?C.amber:C.red;
    ctx.fillRect(o.x,o.y,2,2); ctx.globalAlpha=1;
  }
  for(const o of burnSmoke){
    if(!burnFree(occ,o.x,o.y)) continue;
    const k=1-o.t/o.life;
    ctx.globalAlpha=Math.max(0,o.a*k); ctx.fillStyle=C.smoke;
    ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,6.284); ctx.fill(); ctx.globalAlpha=1;
  }
  // armed by the EVENT, so a standing flame lighting a cell a second never accumulates one
  flashT=Math.max(0,flashT-dt);
  if(flashT>0){
    ctx.globalAlpha=Math.min(flashA,flashT*3.2);
    for(let Y=0;Y<GH;Y++){
      const y=rowTop(Y), h=rowTop(Y+1)-y;
      for(let X=0;X<GW;X++) if(!occ[Y*GW+X]) fillRect(GX+X*CELL,y,CELL,h,C.fire);
    }
    ctx.globalAlpha=1;
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
    let sx=0, sy=0, lo=Infinity;
    for(const i of g.cells){ sx+=i%GW; sy+=(i/GW)|0; }
    for(const i of g.wall) lo=Math.min(lo, matBurstP(i%GW,(i/GW)|0));
    if(!isFinite(lo)) continue;
    const cx=GX+(sx/g.cells.length+0.5)*CELL, cy=rowTop(Math.round(sy/g.cells.length))+11;
    txt(L?(pr*1000).toFixed(1)+" kPa":"SEALED", cx, cy, {size:8, align:"center", color:C.cyan});
    if(L) txt(((lo-pr)*1000).toFixed(1)+" kPa MARGIN", cx, cy+10,
              {size:7, align:"center", color:(lo-pr)<0?C.red:C.ink2});
  }
  ctx.restore();
}
// the ship is drawn in SECTION, so standing water is a horizontal line
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
    for(const id of (L.dmgParts||[])){
      if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
      const j=id.indexOf(","), bx=+id.slice(5,j), by=+id.slice(j+1);
      if(!inRegion.has(by*GW+bx)) continue;
      const br=grect(bx,by,1,1), bt=Math.max(br.y, top);
      fxCellSpace(br.x, bt, ()=>
        fxBubbles(0, 0, br.w/DRAW_K, (br.y+br.h-bt)/DRAW_K,
                  fxEase("fld:"+bx+","+by, 1), C.blue, "pool"));
    }
  }
  ctx.restore();
}
