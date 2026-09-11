"use strict";
/* D.mat["x,y"] = {m:material id, t:wall mm or absent for the suggestion}. mu = ray attenuation per cell (lower attenuates harder), rel = release share past the wall, t0 = shipped thickness mm, S = allowable stress MPa. */
const MAT=[
 {id:"steel", name:"STEEL SHIELD",  mu:0.18, rho:7850, tsurv:null, tight:false, rel:1, t0:300, S:138,
  col:"#6d8f98",
  tip:"Dense plate. It stops rays and nothing else - gas walks straight through it, so a box drawn in this is shielding and never a containment."},
 {id:"conc",  name:"CONCRETE",      mu:0.30, rho:2400, tsurv:null, tight:false, rel:1, t0:900, S:3, agg:true,
  col:"#8a8578",
  tip:"Bulk shielding. Lighter per cell than steel and weaker per cell too, and it is not gas-tight either."},
 {id:"liner", name:"STEEL LINER",   mu:0.35, rho:7850, tsurv:700,  tight:true,  rel:0.10, t0:20,  S:138,
  col:"#8fa9ae",
  tip:"A welded gas-tight plate. It is what makes a closed shape a CONTAINMENT: gas, heat and hydrogen stop at it, and so does most of a release. It has a temperature it fails at, because a liner and its seals are what go long before the structure cares."},
 {id:"lined", name:"LINED CONCRETE",mu:0.16, rho:3600, tsurv:700,  tight:true,  rel:0.04, t0:400, S:8, agg:true,
  col:"#9fb6a0",
  tip:"Concrete with a liner behind it: gas-tight AND the best shielding on the table. It is also the heaviest thing you can paint, per cell, by a long way."},
];
const MAT_BY = (()=>{ const o={}; for(const m of MAT) o[m.id]=m; return o; })();
const MAT_DEF = "liner";
const matRow = id => MAT_BY[id] || MAT[0];

const matKey = (x,y) => x+","+y;
const matCell = (x,y) => D.mat ? D.mat[matKey(x,y)] : undefined;
const matOf = (x,y) => { const c=matCell(x,y); return c ? matRow(c.m) : null; };
const matIds = () => { const out=[]; for(const k in (D.mat||{})) out.push("mat:"+k); return out; };
const matCells = () => Object.keys(D.mat||{});
const matWrecked = (s,x,y) => partWrecked(s, "mat:"+matKey(x,y));
/* matWall() is a design fact so damage never enters the fill's cache; matOpen() is the live half. */
const matWall = (x,y) => { const m=matOf(x,y); return !!(m && m.tight); };
const matOpen = (s,x,y) => matWall(x,y) && !!s && matWrecked(s,x,y);

/* Joined into laySrcSig(), so painting invalidates buildLayout()'s occupancy the way laying a pipe does. */
const matSig = sigMemo(()=>{ let out="";
  for(const k in (D.mat||{})){ const c=D.mat[k]; out += "|"+k+":"+c.m+":"+(c.t===undefined?"-":c.t); }
  return out; });

/* The ship is the component touching the hull ring at the most cells; every other component is a region. Keyed on paint and hull only - a shot wall still separates. */
let matRegCache=null, matRegSig="", matRegGen=-1;
function matRegions(){
  // both terms are sigMemo keyed on DGEN, and this is re-entered per CELL
  if(matRegCache && matRegGen===DGEN) return matRegCache;
  const sig = matSig()+gridSig();
  matRegGen = DGEN;
  if(matRegCache && matRegSig===sig) return matRegCache;
  const N=GW*GH, of=new Int32Array(N).fill(-1), tight=new Uint8Array(N);
  for(const k in (D.mat||{})){ const i=k.indexOf(","), x=+k.slice(0,i), y=+k.slice(i+1);
    if(x<0||x>=GW||y<0||y>=GH) continue;
    if(matWall(x,y)) tight[y*GW+x]=1; }
  const regions=[], q=new Int32Array(N);
  for(let i0=0;i0<N;i0++){
    if(tight[i0] || of[i0]>=0) continue;
    const idx=regions.length, cells=[];
    let head=0, tail=0, ring=0;
    q[tail++]=i0; of[i0]=idx;
    while(head<tail){
      const i=q[head++]; cells.push(i);
      const X=i%GW, Y=(i/GW)|0;
      if(X===0||X===GW-1||Y===0||Y===GH-1) ring++;
      if(X>0)    { const j=i-1;  if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(X<GW-1) { const j=i+1;  if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(Y>0)    { const j=i-GW; if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(Y<GH-1) { const j=i+GW; if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
    }
    regions.push({idx, cells, ring, bounded:false, wall:[]});
  }
  let ship=-1, best=-1;
  for(const g of regions) if(g.ring>best){ best=g.ring; ship=g.idx; }
  for(const g of regions) g.bounded = g.idx !== ship;
  const wallOf={};
  for(let i=0;i<N;i++){
    if(!tight[i]) continue;
    const X=i%GW, Y=(i/GW)|0, seen={};
    const put=j=>{ const r=of[j]; if(r>=0 && !seen[r]){ seen[r]=1; regions[r].wall.push(i);
      if(regions[r].bounded) (wallOf[i] || (wallOf[i]=[])).push(r); } };
    if(X>0) put(i-1); if(X<GW-1) put(i+1);
    if(Y>0) put(i-GW); if(Y<GH-1) put(i+GW);
  }
  /* A region's `wall` misses the corners of a painted box; a seal is the connected component of tight cells, corners in. */
  const seal=new Int32Array(N).fill(-1), seals=[];
  for(let i0=0;i0<N;i0++){
    if(!tight[i0] || seal[i0]>=0) continue;
    const idx=seals.length, cells=[];
    let head=0, tail=0;
    q[tail++]=i0; seal[i0]=idx;
    while(head<tail){
      const i=q[head++]; cells.push(i);
      const X=i%GW, Y=(i/GW)|0;
      if(X>0)    { const j=i-1;  if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(X<GW-1) { const j=i+1;  if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(Y>0)    { const j=i-GW; if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(Y<GH-1) { const j=i+GW; if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
    }
    seals.push(cells);
  }
  for(const g of regions){ let rel=0;
    for(const i of g.wall){ const m=matOf(i%GW,(i/GW)|0); if(m) rel=Math.max(rel, m.rel); }
    g.rel = rel || 1; }
  matRegCache={of, tight, regions, wallOf, seal, seals, rate:new Float64Array(N).fill(NaN),
               spanD:new Float64Array(N).fill(NaN), thick:new Float64Array(N).fill(NaN)}; matRegSig=sig;
  return matRegCache;
}
/* Any region, the ship included: water lands on a floor whether or not a wall is round it. */
function matRegionIn(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH) return null;
  const R=matRegions(), r=R.of[y*GW+x];
  return r<0 ? null : R.regions[r];
}
function matRegionAt(x,y){ const g=matRegionIn(x,y); return g && g.bounded ? g : null; }
/* A tight cell is in no region of its own, so it speaks for what it walls - the first of the two, where it is shared. */
function matWallRegionAt(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH) return null;
  const rs=matRegions().wallOf[y*GW+x];
  return rs && rs.length ? matRegions().regions[rs[0]] : null;
}
const matSealAt = (x,y) => matWall(x,y) ? matWallRegionAt(x,y) : matRegionAt(x,y);
function matSealCells(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH || !matWall(x,y)) return null;
  const R=matRegions(), i=R.seal[y*GW+x];
  return i>=0 ? R.seals[i] : null;
}
const matRegionsBounded = () => matRegions().regions.filter(g=>g.bounded);
function matRegionOf(p){ return p ? matRegionAt(p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : null; }
const matRegionInOf = p => p ? matRegionIn(p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : null;

/* Edges, not a field on a region: a hole belongs to both sides equally, and one whose sides are the same volume is absent. */
const HOLE_A = () => MPC*ROOM_DEPTH;          // m2
function matHoles(s){
  if(!s || !s.dmgParts || !s.dmgParts.length) return [];
  const R = matRegions(), out = [];
  for(const id of s.dmgParts){
    if(typeof id !== "string" || id.indexOf("mat:") !== 0) continue;
    const j = id.indexOf(","), x = +id.slice(4,j), y = +id.slice(j+1);
    if(!matWall(x,y)) continue;
    const seen = [];
    const put = (X,Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return;
      const r = R.of[Y*GW+X];
      if(r>=0 && seen.indexOf(r)<0) seen.push(r); };
    put(x-1,y); put(x+1,y); put(x,y-1); put(x,y+1);
    for(let a=0;a<seen.length;a++) for(let b=a+1;b<seen.length;b++)
      out.push({x, y, a:seen[a], b:seen[b], area:HOLE_A()});
  }
  return out;
}
const matSealed = (s,g) => !matHoles(s).some(h=>h.a===g.idx||h.b===g.idx);

const matRegVol = g => g.cells.length*MPC*MPC*ROOM_DEPTH;
const matRegEqD = g => Math.sqrt(4*g.cells.length*MPC*MPC/Math.PI);
const matRegPerim = g => g.wall.length*MPC;
/* The region MEAN of the blast field, one pass per solve: a choked orifice discharges against the
   volume, not against the cell it stands in, because the wave crosses the compartment in four ticks
   and the discharge takes seconds. Measured at a hot-leg break, the hole's own cell alternates
   between the vacuum floor and 1585 kPa while the region climbs smoothly, which on the cell would
   hand the break a back-pressure of 0.049 MPa one tick and 1.74 the next. */
let regPMeanScr = null, regPMeanCnt = null, regPMeanFor = null, regPMeanAt = -1;
function regionPMean(s){
  if(regPMeanFor === s && regPMeanAt === roomPGen) return regPMeanScr;
  const R = matRegions(), n = R.regions.length;
  if(!regPMeanScr || regPMeanScr.length !== n){
    regPMeanScr = new Float64Array(n); regPMeanCnt = new Float64Array(n); }
  const m = regPMeanScr.fill(0), cnt = regPMeanCnt.fill(0);
  for(let i=0;i<GW*GH;i++){ const r = R.of[i]; if(r<0) continue; m[r] += s.roomP[i]; cnt[r]++; }
  for(let r=0;r<n;r++) if(cnt[r]) m[r] /= cnt[r];
  regPMeanFor = s; regPMeanAt = roomPGen;
  return m;
}
/* MPa absolute: P.Pcont is the ship's compartment pressure, s.roomP the gauge field roomStep() writes in kPa. */
function regionP(s,x,y){
  const base = (typeof P!=="undefined" && P && P.Pcont) ? P.Pcont : 0.15;
  if(!s || !s.roomP || x==null || x<0||x>=GW||y==null||y<0||y>=GH) return base;
  const r = matRegions().of[y*GW+x];
  if(r < 0) return base;
  return base + regionPMean(s)[r]/1000;
}
const regionPAt = (s,p) => p ? regionP(s, p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : regionP(s,null,null);

const regionRel = (s,g) => (!g || !g.wall.length || !matSealed(s,g)) ? 1 : g.rel;
const contRelAt = (s,x,y) => regionRel(s, matRegionAt(x,y));
const contRelPart = (s,p) => p ? contRelAt(s, p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : 1;
const contRelCores = s => { const c = coreIds(); if(!c.length) return 1;
  let r = 0; for(const id of c) r += contRelPart(s, partOf(id)); return r/c.length; };

/* Walks the pressure boundary, not the paint: same tightness or the run ends, so shielding butted against a wall adds no span. */
const matWalk = (x,y,dx,dy) => { const t=!!(matOf(x,y)||{}).tight;
  let n=0, X=x+dx, Y=y+dy;
  while(X>=0&&X<GW&&Y>=0&&Y<GH&&matCell(X,Y)&&!!(matOf(X,Y)||{}).tight===t
        &&n<=Math.max(GW,GH)){ n++; X+=dx; Y+=dy; }
  return n; };
function matSpan(x,y){
  if(!matCell(x,y)) return 1;
  return Math.max(1+matWalk(x,y,-1,0)+matWalk(x,y,1,0),
                  1+matWalk(x,y,0,-1)+matWalk(x,y,0,1));
}
/* Twice the distance to the nearer turn, not half the flat span: a turn is a support, so only mid-span sees the whole arm. */
function matSpanEff(x,y){
  if(!matCell(x,y)) return 1;
  const arm=(dx,dy)=>{ const a=matWalk(x,y,dx,dy), b=matWalk(x,y,-dx,-dy);
    return 1+2*Math.min(a,b); };
  return Math.max(arm(1,0), arm(0,1));
}
const matSpanDRaw = (x,y) => matSpanEff(x,y)*MPC*1000;   // mm
/* Cached beside matRating(); NaN is the empty slot. Four matWalk() sweeps a cell, every cell, every frame. */
const matSpanD = (x,y) => { if(x<0||x>=GW||y<0||y>=GH) return matSpanDRaw(x,y);
  const A=matRegions().spanD, i=y*GW+x, v=A[i];
  return v===v ? v : (A[i]=matSpanDRaw(x,y)); };
/* wallSuggestMm()'s pipeK is a penalty on stress, so STEEL_S/S reads this material as a fraction of steel. */
const matStressK = m => ({pipeK: STEEL_S/m.S});
const matThickSuggest = (x,y) => { const m=matOf(x,y); if(!m) return 0;
  return m.tight ? Math.max(m.t0, wallSuggestMm(matSpanD(x,y), MAT_PDES, matStressK(m))) : m.t0; };
const matThickRaw = (x,y) => { const c=matCell(x,y);
  return (c && c.t !== undefined) ? c.t : matThickSuggest(x,y); };
const matThick = (x,y) => { if(x<0||x>=GW||y<0||y>=GH) return matThickRaw(x,y);
  const A=matRegions().thick, i=y*GW+x, v=A[i];
  return v===v ? v : (A[i]=matThickRaw(x,y)); };
const MAT_PDES = 0.5;   // MPa differential a region's boundary is built to hold
/* The worst cell's gauge kPa, as MPa. A READOUT: the panels and the room layer print it, and the wall is judged on matCellDP() instead, because the worst cell of a whole region is not a load on any one cell of its boundary. */
function regionDP(s,g){
  if(!s || !s.roomP) return 0;
  let v=0; for(const i of g.cells) if(s.roomP[i]>v) v=s.roomP[i];
  return v/1000;
}
/* What one wall cell is actually carrying, MPa: the difference across it, over the neighbours that are gas. With the same volume on both faces it is zero, which is correct; with one face it is the gauge, which already carries the difference against ambient. */
function matCellDP(s,x,y){
  if(!s || !s.roomP) return 0;
  const of=matRegions().of;
  let hi=-Infinity, lo=Infinity, n=0;
  const put=(X,Y)=>{ if(X<0||X>=GW||Y<0||Y>=GH) return;
    const i=Y*GW+X; if(of[i]<0) return;
    const p=s.roomP[i]; if(p>hi) hi=p; if(p<lo) lo=p; n++; };
  put(x-1,y); put(x+1,y); put(x,y-1); put(x,y+1);
  if(!n) return 0;
  return (n===1 ? Math.max(0,hi) : hi-lo)/1000;
}
const matRatingRaw = (x,y) => { const m=matOf(x,y); if(!m) return 0;
  return 2*m.S*Math.max(matThick(x,y)-WALL_CORR,0)/Math.max(matSpanD(x,y),1); };
/* Cached on matSig()+gridSig(); NaN is the empty slot. */
const matRating = (x,y) => { if(x<0||x>=GW||y<0||y>=GH) return 0;
  const R=matRegions().rate, i=y*GW+x, v=R[i];
  return v===v ? v : (R[i]=matRatingRaw(x,y)); };
const matBurstP = (x,y) => matRating(x,y)*PIPE_BURST_K;
// tonnes
const matCellMass = (x,y) => matThick(x,y)/1000*MPC*ROOM_DEPTH*matRow((matCell(x,y)||{}).m).rho/1000;
function matMass(){ let m=0;
  for(const k in (D.mat||{})){ const i=k.indexOf(","); m+=matCellMass(+k.slice(0,i), +k.slice(i+1)); }
  return m; }

/* The pseudo-part shape pipeCellPart() and portCellPart() use, so damage and repair need no fourth code path. */
function matCellPart(x,y){
  const c=matCell(x,y); if(!c) return null;
  const cells=[[x,y]], stand=pipeStandCells(cells);
  return {id:"mat:"+matKey(x,y), name:matRow(c.m).name, w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true, isMat:true};
}
// K, or null where a temperature is not how the material fails
const matTsurv = (x,y) => { const m=matOf(x,y); return m ? m.tsurv : null; };

/* One thing per cell, except a pipe: a pipe through a gas-tight cell is a penetration. */
function matPaint(x,y,m){
  if(x<0||y<0||x>=GW||y>=GH) return false;
  const g=occupied(null,{pipes:false, mat:false});
  if(g[y][x]) return false;
  D.mat[matKey(x,y)]={m: m||MAT_DEF};
  return true;
}
function matLift(x,y){ const k=matKey(x,y);
  if(!D.mat[k]) return false;
  delete D.mat[k];
  return true;
}

/* Keyed by a cell index, never a region index: a region index renumbers the moment the paint changes. */
const regionKey = g => { let lo=g.cells[0];
  for(const i of g.cells) if(i>lo) lo=i;          // the highest index IS the lowest row
  return lo; };
const regionSump = (s,g) => (s && s.sump && s.sump[regionKey(g)]) || 0;
const regionSpanX = g => { let x0=GW, x1=0;
  for(const i of g.cells){ const X=i%GW; if(X<x0) x0=X; if(X>x1) x1=X; }
  return x1-x0+1; };
/* kg the compartment's own volume holds; what will not fit never enters the sump (sumpStep(), step.js). */
const regionSumpCap = g => matRegVol(g)*1000;
/* m. The ship is drawn in section, so the surface is a horizontal line over the region's width by ROOM_DEPTH. */
function regionFloodM(s,g){
  const kg = regionSump(s,g); if(!(kg>0)) return 0;
  return kg/1000/Math.max(0.01, regionSpanX(g)*MPC*ROOM_DEPTH);
}
function regionFlooded(s,g){
  const d=regionFloodM(s,g); if(!(d>0)) return null;
  let bot=-1;
  for(const i of g.cells){ const Y=(i/GW)|0; if(Y>bot) bot=Y; }
  return {bot, rows: d/MPC, d};
}

/* Share of a machine's height the water must cover before it drowns: the motor and the electrics stand off the floor, set by the user 11/09/26. */
const FLOOD_DROWN = 2/3;
const floodDrowns = (p, line) => line <= p.y + p.h*(1 - FLOOD_DROWN);
// the water surface over a part, in rows from the top, or null
function regionFloodLine(s,p){
  if(!p) return null;
  const g = matRegionInOf(p); if(!g) return null;
  const f = regionFlooded(s,g); if(!f) return null;
  const line = f.bot + 1 - f.rows;
  return (p.y + p.h > line) ? line : null;
}
