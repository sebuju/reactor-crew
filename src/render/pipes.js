"use strict";
// nothing here invents a flow: s.flowPos[k] is what the sim integrated
const PIPE_NAME={hot:"HOT LEG",cold:"COLD LEG",steam:"MAIN STEAM",feed:"FEEDWATER",
                 hpi:"HP INJECTION",surge:"SURGE LINE",exh:"EXHAUST",
                 relief:"RELIEF HEADER",cw:"CIRCULATING WATER",user:"UNCLASSIFIED PIPE"};
// a run wears its kind's name unless it DEAD-ENDS at a machine with one: a branch to a valve is not the header
const pipeLabel=(k,key)=>{
  const c = key && pipeMap().byKey[key], t = c && runDeadEnd(c.a, c.b);
  return t ? partName(t) : PIPE_NAME[k];
};
const pipeCol=(PC,k)=>PC[k]||C.ink2;

// linear in real bore, not quantised into classes: the cell's budget is 12 joint, 10 casing, 6 bore
const PIPE_W_MAX = 6*DRAW_K;
const PIPE_PX = 3.75*DRAW_K;
const pipeWidth = bore => clamp(PIPE_PX*bore, 0.8*DRAW_K, PIPE_W_MAX);
// WALL_PX is a STATED display exaggeration: a real 70 mm wall on a 750 mm bore is one pixel at true scale
const WALL_PX = 0.05*DRAW_K;
const PIPE_CASE_MAX = 10*DRAW_K;
const pipeWallPx = r => {
  const room = Math.max(0.5*DRAW_K, (PIPE_CASE_MAX - pipeWidth(runBore(r)))/2);
  return clamp(runWallMm(r)*WALL_PX, 0.5*DRAW_K, room);
};

// the one pipe colour table: the stroke and the packets both read it
function pipeColours(L){
  const heat = L? L.n*PROMPT_F+L.decay : 0;
  const Th = L? L.Tavg+15*heat : 598, Tc = L? L.Tavg-15*heat : 568;
  // the cold end of the lerp is the coolant family's own hue, or a sodium plant's primary draws water
  const cc = (COOLANT[priD().cool] && COOLANT[priD().cool].col) || "#5aa9d6";
  return { hot: L?lerpC(cc,"#ff5a45",(Th-520)/110):"#c8735e",
           cold:L?lerpC(cc,"#ff5a45",(Tc-520)/110):cc,
           surge:"#a98cf0", steam:"#c8d8dc", exh:"#7f9098", feed:"#5aa9d6", hpi:"#5fd2e2", cw:"#5aa9d6",
           // `user` is the only kind left with no row, and that is the point: grey IS the reading
           relief:"#7a6f9a" };
}

function pipeGeom(pts){
  const segs=[]; let tot=0;
  for(let i=1;i<pts.length;i++){
    const dx=pts[i][0]-pts[i-1][0], dy=pts[i][1]-pts[i-1][1], L=Math.hypot(dx,dy);
    if(L<0.01) continue;
    segs.push({x:pts[i-1][0],y:pts[i-1][1],dx:dx/L,dy:dy/L,L,s0:tot}); tot+=L;
  }
  return {segs,len:tot};
}
// a runway of `pad` past each nozzle, so a packet is full size before it is visible; the real pipe is pad..pad+core
function pipePad(g,pad){
  if(!pad || !g.segs.length) return g;
  const segs=g.segs.map(q=>Object.assign({},q,{s0:q.s0+pad}));
  const f=segs[0], l=segs[segs.length-1];
  segs.unshift({x:f.x-f.dx*pad, y:f.y-f.dy*pad, dx:f.dx, dy:f.dy, L:pad, s0:0});
  segs.push({x:l.x+l.dx*l.L, y:l.y+l.dy*l.L, dx:l.dx, dy:l.dy, L:pad, s0:l.s0+l.L});
  return {segs, len:g.len+2*pad, pad, core:g.len};
}
// hw is the CASING half-width across the run; ext is the FLUID line's along it, so the cut is where the paint stops
function pipeClip(g,hw,ext){
  ctx.beginPath();
  for(const q of g.segs){
    const ex=q.dx*ext, ey=q.dy*ext, nx=-q.dy*hw, ny=q.dx*hw;
    const ax=q.x-ex, ay=q.y-ey, bx=q.x+q.dx*q.L+ex, by=q.y+q.dy*q.L+ey;
    ctx.moveTo(ax+nx,ay+ny); ctx.lineTo(bx+nx,by+ny);
    ctx.lineTo(bx-nx,by-ny); ctx.lineTo(ax-nx,ay-ny); ctx.closePath();
  }
  ctx.clip();
}
// the CENTRELINE turns, so both edges are arcs about one centre; every pass must take the same radius
function pipeBendR(pts,cw){
  let minL=Infinity;
  for(let i=1;i<pts.length;i++)
    minL=Math.min(minL, Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]));
  return Math.max(0, Math.min(cw*0.75, minL/2));
}
// the line a run is stroked along: its traced corners, or every cell while a blast bows it, at the radius the corners set
function runDrawPts(r,cw){
  const R=pipeBendR(r.pts,cw), lp=runLeanPts(r);
  return lp ? {pts:lp, R:Math.min(R,CELL/2)} : {pts:r.pts, R};
}
function pipeBendPath(pts,R){
  const n=pts.length;
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  if(R>0) for(let i=1;i<n-1;i++)
    ctx.arcTo(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],R);
  else for(let i=1;i<n-1;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.lineTo(pts[n-1][0],pts[n-1][1]);
}
// the same elbow as POINTS, so a packet's travel is the shape the pipe is drawn as
function pipeBendPts(pts,R){
  if(!(R>0) || pts.length<3) return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i], a=pts[i-1], b=pts[i+1];
    let ux=a[0]-p[0], uy=a[1]-p[1], vx=b[0]-p[0], vy=b[1]-p[1];
    const lu=Math.hypot(ux,uy), lv=Math.hypot(vx,vy);
    if(lu<0.01||lv<0.01) continue;
    ux/=lu; uy/=lu; vx/=lv; vy/=lv;
    const th=Math.acos(clamp(ux*vx+uy*vy,-1,1));
    if(th>Math.PI-0.01 || th<0.01){ out.push(p); continue; }
    const tan=Math.tan(th/2);
    const t=Math.min(R/tan, lu/2, lv/2), r=t*tan;
    let bx=ux+vx, by=uy+vy; const lb=Math.hypot(bx,by);
    if(lb<1e-6){ out.push(p); continue; }
    const cx=p[0]+bx/lb*(r/Math.sin(th/2)), cy=p[1]+by/lb*(r/Math.sin(th/2));
    const a0=Math.atan2(p[1]+uy*t-cy, p[0]+ux*t-cx);
    let d=Math.atan2(p[1]+vy*t-cy, p[0]+vx*t-cx)-a0;
    while(d>Math.PI) d-=2*Math.PI;
    while(d<-Math.PI) d+=2*Math.PI;
    const n=Math.max(2,Math.ceil(Math.abs(d)/0.35));
    for(let k=0;k<=n;k++){ const ang=a0+d*k/n;
      out.push([cx+Math.cos(ang)*r, cy+Math.sin(ang)*r]); }
  }
  out.push(pts[pts.length-1]);
  return out;
}
function pipeSub(g,a,b){
  a=Math.max(0,a); b=Math.min(g.len,b);
  if(b<=a) return false;
  ctx.beginPath(); let first=true;
  for(const q of g.segs){
    const lo=Math.max(a,q.s0), hi=Math.min(b,q.s0+q.L);
    if(hi<=lo) continue;
    const ax=q.x+q.dx*(lo-q.s0), ay=q.y+q.dy*(lo-q.s0);
    const bx=q.x+q.dx*(hi-q.s0), by=q.y+q.dy*(hi-q.s0);
    if(first){ ctx.moveTo(ax,ay); first=false; } else ctx.lineTo(ax,ay);
    ctx.lineTo(bx,by);
  }
  return !first;
}
function pipeAt(g,s){
  s=clamp(s,0,g.len);
  for(const q of g.segs) if(s<=q.s0+q.L){
    const t=Math.max(0,s-q.s0);
    return {x:q.x+q.dx*t,y:q.y+q.dy*t,dx:q.dx,dy:q.dy};
  }
  const q=g.segs[g.segs.length-1];
  return {x:q.x+q.dx*q.L,y:q.y+q.dy*q.L,dx:q.dx,dy:q.dy};
}

// differentiated against S.t, never the wall clock: S.t advances by exactly the step that moved the fluid
const pipeLast={}, pipeSpd={}, pipeShown={};
// Nyquist: the display phase advances only by what the texture can carry, `over` says by how much it could not
const pipePh={}, pipeOver={}, pipePass={}, pipeAdv={};
function aliasStep(key,adv,per){
  const pass=typeof layPass==="function"?layPass():0;
  if(pass && pipePass[key]===pass) return {ph:pipePh[key], over:pipeOver[key], adv:pipeAdv[key]||0};
  pipePass[key]=pass; pipeAdv[key]=adv;
  pipePh[key]=(pipePh[key]||0)+clamp(adv,-per*0.4,per*0.4);
  pipeOver[key]=clamp(Math.abs(adv)/(per/2)-1,0,1);
  return {ph:pipePh[key], over:pipeOver[key], adv};
}
const aliasRate=(key,rate,per)=>aliasStep(key,rate*frameDt(),per);
// the SMOOTHED clock's, never the raw tick: S.t arrives 0.02 s at a time and a shaft driven by that stutters
const frameDt=()=>fxDt();
// view caches, never state: refilled (not rebuilt) once a frame off one solve, so no reader holds a stale object
const pipeDrop={};
const pipeP={};
const pipeKg={};
// nothing has been solved yet: a reader states no flow at all rather than the zero the empty cache reads as
let pipeFieldOn=false;
function pipeFieldRefresh(L){
  pipeFieldOn=false;
  for(const k in pipeDrop) delete pipeDrop[k];
  for(const k in pipeP) delete pipeP[k];
  for(const k in pipeKg) delete pipeKg[k];
  // the reading places are chosen before anything draws, so the `under` seam can keep off them
  pipeAnchorTick();
  pipeStackTick();
  pipeAnchors(pipeRuns(L));
  if(!L) return;
  netField(L, pipeDrop, pipeP, pipeKg);
  pipeFieldOn=true;
}
// null for a TAP-ENDED run, so a caller draws nothing rather than a zero; never floored at zero
function pipeRunP(r,L){
  const p=pipeP[runNodeOf(r.key)];
  return p===undefined ? null : p;
}
// a run is a steam line because BOTH its ends are steam SPACES, never because its kind is spelt "steam"
const runVapour = key => netVapourAt(runNodeOf(key));
function pipeRunSc(r,L){
  const pr=pipeRunP(r,L);
  if(pr===null) return null;
  // a vapour run is saturated by definition, so it reads exactly 0
  if(runVapour(r.key)) return 0;
  const sat = satT(satOfCirc(circOfNode(runNodeOf(r.key))), pr), t = pipeRunT(r,L);
  return t===null ? null : sat - t;
}
function pipeRunT(r,L){
  if(!L || !runEnds(r.key,r.k)) return null;   // a tap-ended run has no node of its own
  const t=netTempAt(L,runNodeOf(r.key));
  return isFinite(t) ? t : null;
}
let pipeT=null, pipeDt=0;
// the filter steps one PIPE_DT at a time, so it damps by plant time
const PIPE_DT=0.02, PIPE_DTMAX=1.0;
// smoothing is display state, so it is not on S and whoever moves the clock clears it by hand
function pipeReset(){
  for(const k in pipeLast)  delete pipeLast[k];
  for(const k in pipeSpd)   delete pipeSpd[k];
  for(const k in pipeShown) delete pipeShown[k];
  for(const k in pipePh)    delete pipePh[k];
  for(const k in pipeOver)  delete pipeOver[k];
  for(const k in pipePass)  delete pipePass[k];
  for(const k in pipeAdv)   delete pipeAdv[k];
  pipeT=null; pipeDt=0;
}
function pipeRate(s){
  const now=s.t, dt=pipeT===null?0:now-pipeT;
  pipeT=now; pipeDt=(dt>0&&dt<=PIPE_DTMAX)?dt:0;
  if(!pipeDt) return;
  const n=Math.max(1,Math.round(pipeDt/PIPE_DT));
  for(const k in s.flowPos){
    const v=s.flowPos[k];
    if(pipeLast[k]!==undefined){
      const tgt=(v-pipeLast[k])/pipeDt;
      for(let i=0;i<n;i++) pipeSpd[k]=approach(pipeSpd[k]||0,tgt,PIPE_DT,8);
    }
    pipeLast[k]=v;
  }
}

// a first-order approach, not a quantiser; the deadband is half the last PRINTED step, so it can only hide a digit
const DISP_EPS=0.0008;
const pipeStep = v => v>=1000 ? 10 : v>=100 ? 1 : 0.1;
function dispEase(k,fr,eps,rate){
  const cur=pipeShown[k];
  if(cur===undefined){ pipeShown[k]=fr; return fr; }
  if(!pipeDt) return cur;                    // a paused plant must still freeze
  if(Math.abs(fr-cur)<eps) return cur;
  const n=Math.max(1,Math.round(pipeDt/PIPE_DT));
  let v=cur;
  for(let i=0;i<n;i++) v=approach(v,fr,PIPE_DT,rate);
  pipeShown[k]=v;
  return v;
}
const pipeDisplay=(k,fr,scale)=>
  dispEase(k,fr,scale>0?0.5*pipeStep(Math.abs(fr)*scale)/scale:DISP_EPS,4);
// three significant figures, which is what an instrument face gives you
function pipeFmt(v){
  if(v>=1000) return String(Math.round(v/10)*10);
  if(v>=100)  return v.toFixed(0);
  return v.toFixed(1);
}

// the bench reads a run before anything is commissioned, and P is null until it is
const pipeConn = key => (P && P.net) ? P.net.byKey[key] : null;
// off the run's own END PARTS, never P.net.tankNid: a tank's node carries no face and a run end does
function runTankId(key){
  const r = pipeConn(key);
  if(!r) return null;
  return D.tanks[r.a] ? r.a : D.tanks[r.b] ? r.b : null;
}
// signed, and it IS the solve; a vent branch is a dead end there, so it reads what its own valves pass
function pipeRunKg(key,k,L){
  const r = pipeConn(key);
  if(r && L && !runPortsOpen(L,r)) return 0;
  const b = runVapour(key) ? steamBook(key,k) : null;
  if(b && b.vent){ let q=0;
    for(const fid of b.taps) q += (L && L.reliefSteam && L.reliefSteam[fid]) || 0;
    return q*steamDir(key,k); }
  return pipeKg[key]||0;
}
// what crossed the machine's own body, over whatever paths its ROLE declares: no per-role branching
function pipeThru(p,L){
  if(!P || !P.net) return "";
  const R = ROLE[p.role]; if(!R) return "";
  const paths = roleIntern(R).map(IN=>({k:"comp:"+p.id+":"+IN.a+IN.b, a:IN.a, b:IN.b}));
  if(R.vapPath) paths.push({k:"vap:"+p.id, a:R.vapPath.a, b:R.vapPath.b});
  const rows = [];
  for(const q of paths){ const v = pipeKg[q.k];
    if(v === undefined) continue;
    const wa = portWord(p,q.a,true)||FACE_NAME[q.a]||q.a,
          wb = portWord(p,q.b,true)||FACE_NAME[q.b]||q.b;
    rows.push((v<0?wb+" to "+wa:wa+" to "+wb)+" "+pipeFmt(Math.abs(v))+" kg/s"); }
  if(!rows.length) return "";
  let s = " ACROSS ITS OWN BODY: "+rows.join(", ")+".";
  if(netChokedPart(P.net, p.id)) s += " Its own path is CHOKED: what is crossing it is"
    + " already leaving at the speed of sound, so a lower pressure on the far side buys"
    + " nothing at all - only a wider bore or a denser fluid passes more.";
  if(R.sgtr) s += " Its feedwater lands in the shell's own water, which is a"
    + " boundary in the solve - the runs either side of it are not required to add up.";
  return s;
}

// the unit a run's rate is stated in
function pipeUnit(key,k){
  // the fallback only: a heat balance on rated power, 5.5 kJ/kg/K over a 30 K rise
  const per=Math.max(1,P.loops);
  const loop=P.rated*1000/(5.5*30)/per;
  const ends=runEnds(key,k);
  // `dir` is the sign of the run's own REFERENCE flow; a key's canonical order says nothing about direction
  const sref=P.netRefByRun[key];
  if(sref) return {nom:(P.netRefKg&&P.netRefKg[key])||0, u:"kg/s",
                   dir:sref<0?-1:1};
  if(!ends) return {nom:loop*0.02, u:"kg/s"};   // a tap-ended run: the surge line
  if(runVapour(key))
    return {nom:steamScale(key,k), u:"kg/s", dir:steamDir(key,k)};
  return null;
}
// the field's own quality at the run's ONE node, never the design label and never a gradient between two machines
function pipePhase(r,L){
  // the bench has no P until something commissions, and it draws these same runs
  const net=(typeof P!=="undefined" && P) ? P.net : null;
  const nid=runNodeOf(r.key);
  if(!net || !L || net.index[nid]===undefined) return null;
  const q=clamp(netQualAt(L,nid),0,1);
  return [q,q];
}
const pipeSteam=(r,L)=>{ const q=pipePhase(r,L); return q ? (q[0]+q[1])/2 : 0; };
// kg standing in the run: s.mBy at its own node, never a density product beside it
function pipeRunHoldKg(r,L){
  const net=(typeof P!=="undefined" && P) ? P.net : null;
  const nid=runNodeOf(r.key);
  if(!net || !L || net.index[nid]===undefined) return null;
  const m=L.mBy && L.mBy[nid];
  return m===undefined ? runVol(r)*netRhoAt(L,nid) : m;
}
// kg in a machine: every node the solve gave it, each asked of whichever book owns it
function partHoldKg(id,L){
  const net=(typeof P!=="undefined" && P) ? P.net : null;
  if(!net || !L || !net.nodesOfPart || !L.mBy) return null;
  const list=net.nodesOfPart[id]; if(!list || !list.length) return null;
  let m=0;
  for(const i of list){ const b=bookedKg(net,L,i);
    m += b!==undefined ? b : (L.mBy[net.name[i]]||0); }
  return m;
}
// ONE format for both readings, so a pipe and a vessel state the same quantity the same way
const holdFmt = v => v<1000 ? v.toFixed(0)+" kg" : (v/1000).toFixed(1)+" t";
// kind is the hue and phase is a lightness on top of it, both directions, so the two readings cannot be confused
const PIPE_VAP="#eef6f8", PIPE_LIQ_K=0.18, PIPE_VAP_K=0.55;
const PIPE_PH_COL={};
function pipePhaseCol(col,x){
  const q=Math.round(clamp(x,0,1)*8)/8, k=col+"|"+q;    // eight steps: a lerp per run per frame is a string per run per frame
  let v=PIPE_PH_COL[k];
  if(v===undefined){
    const liq=lerpC(col,C.bg,PIPE_LIQ_K);
    v=lerpC(liq,PIPE_VAP,q*PIPE_VAP_K);
    PIPE_PH_COL[k]=v;
  }
  return v;
}
function pipeStroke(r,PC,L){
  const col=pipeCol(PC,r.k), q=pipePhase(r,L);
  if(!q) return col;
  if(Math.abs(q[0]-q[1])<0.02) return pipePhaseCol(col,(q[0]+q[1])/2);
  const a=r.pts[0], b=r.pts[r.pts.length-1];
  const g=ctx.createLinearGradient(a[0],a[1],b[0],b[1]);
  // the run's key orders its ends the way netBuild did, so polyline end 0 is end u
  g.addColorStop(0,pipePhaseCol(col,q[0]));
  g.addColorStop(1,pipePhaseCol(col,q[1]));
  return g;
}
const pipePhaseWord=x => x===null ? "NOTHING"
  : x<=0.001 ? "LIQUID" : x>=0.999 ? "STEAM"
  : "WET STEAM, x="+x.toFixed(2);

const PIPE_RUNWAY=60*DRAW_K;
const PIPE_BUB_WALL=0.35*DRAW_K;  // bore left clear: a parcel touching the wall reads as a burr
const PIPE_BUB_STEP=0.25;         // of its own spacing a parcel may travel in one frame
const PIPE_BUB_MAXK=6;            // how far the spacing may stretch before the run is a streak
const pipeHash = k => Math.imul(k^0x9e3779b1,2654435761)>>>0;
const pipeRnd = (k,sh,m) => ((pipeHash(k)>>>sh)&m)/m;
const pipeSeed = key => { let a=0; for(let i=0;i<key.length;i++) a=Math.imul(a^key.charCodeAt(i),16777619); return a>>>0; };
// a parcel is a fixed STEP in brightness, not a fixed tint, so every run parts from its own colour by the same amount
const PIPE_BUB_DL=0.20;
const PIPE_BUB_DARK=0.5;
const PIPE_BUB_COL={};
const pipeLum = col => { const p=hexPack(col);
  return (0.299*(p>>16&255)+0.587*(p>>8&255)+0.114*(p&255))/255; };
function pipeBubCol(col){
  let v=PIPE_BUB_COL[col];
  if(v===undefined){
    const lum=pipeLum(col);
    v=lum>0.75 ? lerpC(col,C.bg,    clamp(PIPE_BUB_DL*PIPE_BUB_DARK/(lum-pipeLum(C.bg)),0.08,0.85))
               : lerpC(col,C.bright,clamp(PIPE_BUB_DL/(pipeLum(C.bright)-lum),0.35,0.9));
    PIPE_BUB_COL[col]=v;
  }
  return v;
}
function pipeStream(g,key,sp,col,w,st,seed){
  const moving=Math.min(1,Math.abs(sp)/(8*DRAW_K));
  // a wide bore carries more parcels, not bigger ones; the gap is a length on the board, so both ends carry DRAW_K
  const gap0=Math.max(6*DRAW_K,20*DRAW_K-w*2.2)*(1+st*0.3), lim=w/2-PIPE_BUB_WALL;
  // the smoothed rate over the smoothed frame, never the raw jump in s.flowPos, which moves in whole ticks
  const adv=sp*frameDt();
  // a fast run spreads its parcels out rather than dimming them
  const gap=clamp(Math.abs(adv)/PIPE_BUB_STEP, gap0, gap0*PIPE_BUB_MAXK);
  const a=aliasStep(key,adv,gap), ph=a.ph;
  // what the spacing could not buy back is spent on the line: too fast to resolve is a streak
  ctx.save(); ctx.globalAlpha=0.22+0.18*a.over; ctx.lineCap="square"; ctx.lineJoin="round";
  ctx.lineWidth=w; ctx.strokeStyle=col;
  const any=pipeSub(g,0,g.len);
  if(any) ctx.stroke();
  ctx.restore();
  if(!any) return;
  if(moving<0.01) return;

  ctx.save(); ctx.fillStyle=pipeBubCol(col);
  for(let s=((ph%gap)+gap)%gap-gap;s<g.len;s+=gap){
    const id=Math.round((ph-s)/gap)+(seed|0);
    const r=clamp((0.45+0.55*pipeRnd(id,9,255))*w*0.42, 0.55*DRAW_K, Math.max(0.55*DRAW_K,lim));
    // the offset is priced off what the radius leaves, never off the bore, or half of a fat parcel sits on the wall
    const off=(pipeRnd(id,19,255)-0.5)*2*Math.max(0,lim-r);
    // the surge is a frequency per SECOND on the clock: driven by phase it ran at the speed of the fluid
    const d=s+Math.sin(fxClock()*(1.6+0.9*pipeRnd(id,3,255))+id)*gap0*0.12*moving;
    const at=pipeAt(g,clamp(d,0,g.len));
    // past its own Nyquist a parcel is a mark in the wrong place, so it fades and the streak carries the run
    ctx.globalAlpha=0.9*moving*(0.55+0.45*pipeRnd(id,2,255))*(1-st*0.3)*(1-a.over);
    ctx.beginPath(); ctx.arc(at.x-at.dy*off, at.y+at.dx*off, r, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

// the scale does not END at design, it is only MARKED there: a meter that pins at the limit says nothing past it
const PIPE_A0=Math.PI*170/180, PIPE_SW=Math.PI*200/180, PIPE_OVER=1.25;
function pipeDial(x,y,r,fr,col,label,o){
  o=o||{};
  const lim=o.lim==null?1:o.lim, max=o.max==null?PIPE_OVER:o.max, lo=-0.2;
  const U=v=>(clamp(v,lo,max)-lo)/(max-lo);
  const dead=Math.abs(fr)<0.008, over=fr>lim+0.001, back=fr<-0.008;
  const ink=dead?C.ink2:over?C.red:back?C.amber:col;
  ctx.save();
  ctx.beginPath(); ctx.arc(x,y,r,0,6.2832);
  ctx.fillStyle=C.panel; ctx.fill();
  ctx.lineWidth=1*DRAW_K; ctx.strokeStyle=over?C.red:(dead?C.edge:C.edge2); ctx.stroke();
  // the band is always on the face, lit only when the needle is in it
  ctx.beginPath(); ctx.arc(x,y,r-2.6*DRAW_K, PIPE_A0+PIPE_SW*U(lim), PIPE_A0+PIPE_SW);
  ctx.strokeStyle=over?C.red:"#4a1712"; ctx.lineWidth=1.8*DRAW_K; ctx.stroke();
  const mark=(t,len,c)=>{
    const a=PIPE_A0+PIPE_SW*t, cs=Math.cos(a), sn=Math.sin(a), i0=r-1.5*DRAW_K;
    ctx.beginPath();
    ctx.moveTo(x+cs*i0, y+sn*i0);
    ctx.lineTo(x+cs*(i0-len), y+sn*(i0-len));
    ctx.strokeStyle=c; ctx.lineWidth=1*DRAW_K; ctx.stroke();
  };
  for(let i=0;i<=4;i++) mark(U(i/4),2.4*DRAW_K,C.edge2);   // 0 25 50 75 100 per cent
  mark(U(0),3.2*DRAW_K,C.amber);                           // the zero stop
  const a=PIPE_A0+PIPE_SW*U(fr);
  ctx.beginPath(); ctx.moveTo(x-Math.cos(a)*2*DRAW_K,y-Math.sin(a)*2*DRAW_K);
  ctx.lineTo(x+Math.cos(a)*(r-3*DRAW_K), y+Math.sin(a)*(r-3*DRAW_K));
  ctx.strokeStyle=ink; ctx.lineWidth=1.6*DRAW_K; ctx.lineCap="round"; ctx.stroke();
  ctx.beginPath(); ctx.arc(x,y,1.5*DRAW_K,0,6.2832); ctx.fillStyle=ink; ctx.fill();
  ctx.restore();
  if(label)
    pipeTag(x,y+r+1*DRAW_K,label,dead?C.ink2:over?C.red:back?C.amber:C.cyan);
}

// the one door every number that sits ON the diagram goes through, or the second drifts a half pixel from the first
function pipeTag(x,yTop,label,col){
  const o={size:6.5*DRAW_K,sp:.4*DRAW_K,align:"center"}, lw=tw(label,o)+6*DRAW_K;
  fillRect(x-lw/2,yTop,lw,10*DRAW_K,C.bg);
  txt(label,x,yTop+8*DRAW_K,Object.assign({},o,{color:col}));
}

// a run gets ONE place and every reading stacks there, one line per quantity
const STACK_H=10*DRAW_K;                  // one line of 6.5 ink and its plate
// centred on the anchor, so it reads as that pipe's label whatever it ends up holding
const stackTop = (y,n) => Math.round(y-(n*STACK_H)/2);
// one plate per stack, collected by anchor point and laid down once: butted plates leave a hairline of pipe between them
const STACK_W=48*DRAW_K;
let stackInk=new Map();
function pipeStackTick(){ stackInk=new Map(); }
function pipeStackLine(x,y,slot,label,col){
  const k=x+","+y;
  let e=stackInk.get(k);
  if(!e) stackInk.set(k, e={x,y,lines:[]});
  e.lines.push({slot,label,col});
}
// a stack that collected nothing gets no plate either
function pipeStackFlush(){
  for(const e of stackInk.values()){
    const ls=e.lines.slice().sort((a,b)=>a.slot-b.slot);
    if(!ls.length) continue;
    // slot is an ORDER, not a row: the lines are packed, so a switched-off layer leaves no band of empty plate
    const n=ls.length, top=stackTop(e.y,n);
    fillRect(e.x-STACK_W/2, top, STACK_W, n*STACK_H, C.bg);
    ls.forEach((l,i)=>txt(l.label, e.x, midBase(top+i*STACK_H,STACK_H,6.5*DRAW_K),
      {size:6.5*DRAW_K,sp:.4*DRAW_K,align:"center",color:l.col}));
  }
  stackInk.clear();
}

const PIPE_DIAL_R=10*DRAW_K;
// one helper, because valueBase() (plant.js) hangs the pressure figure under the dial off the same offset
const PZR_DIAL_CY=boxY=>boxY+PIPE_DIAL_R+18*DRAW_K;
// the one "in the way" test every widget floating in the pipe margin uses
function boxClear(x,y,w,h){
  return !LAY.parts.some(p=>{ const r=prect(p);
    return x+w>r.x && x<r.x+r.w && y+h>r.y && y<r.y+r.h; });
}
// a preference, not a permission: a shorter run still gets its readings, it just has fewer places to put them
const STACK_MIN_L=2*PIPE_DIAL_R+6*DRAW_K;
const stackBox=(x,y,n)=>({x:x-STACK_W/2, y:stackTop(y,n||STACK_N), w:STACK_W, h:(n||STACK_N)*STACK_H});
// a pure function of the drawing, so the run allocator can seed it as taken ground
const holdMarkBox = p => { const R=prect(p);
  return {x:R.x+R.w/2-STACK_W/2, y:R.y+R.h+2*DRAW_K, w:STACK_W, h:STACK_H}; };
// a fitting's reading is a line of its pipe's stack: one answer, for the allocator and pipeFitMarks() both
const STACK_N=5;                          // lines every run carries
const fitPidPart=pid=>{ const q=D.ports[pid]; return q?q.p:null; };
const fitReads=p=>p.role==="fitting" &&
  (fitModeOf(p.id)==="relief"||fitModeOf(p.id)==="throttle");
function fitRunKey(fid,runs){
  let best=null;
  for(const r of runs){
    if(fitPidPart(r.pa)!==fid && fitPidPart(r.pb)!==fid) continue;
    if(best===null||r.key<best) best=r.key;
  }
  return best;
}
function fitStackKeys(runs){
  const set=new Set();
  for(const p of LAY.parts){ if(!fitReads(p)) continue;
    const k=fitRunKey(p.id,runs); if(k!==null) set.add(k); }
  return set;
}
const hit=(a,b)=>a.x+a.w>b.x && a.x<b.x+b.w && a.y+a.h>b.y && a.y<b.y+b.h;
// one map a frame: every run takes the first spot clear of the machines and of every stack already placed, its best one anyway if none is
const STACK_OFF=STACK_H+2*DRAW_K;
const STACK_STEPS=[0,1,-1,2,-2,3,-3];
function pipeRunSpots(r){
  const out=[];
  for(const q of pipeGeom(r.pts).segs){
    // midpoint first, then in from each end: a long leg gets more chances than a stub
    const n = q.L>=STACK_MIN_L*2 ? 7 : 3;
    // and each may step BESIDE the pipe, perpendicular to the segment, which is the direction with room
    const px=-q.dy, py=q.dx;
    for(let i=0;i<n;i++){
      const t = n===1 ? 0.5 : 0.5 + (i%2?1:-1)*Math.ceil(i/2)/(n+1);
      const x=q.x+q.dx*q.L*t, y=q.y+q.dy*q.L*t;
      for(const o of STACK_STEPS)
        out.push({L:q.L, x:x+px*STACK_OFF*o, y:y+py*STACK_OFF*o, key:r.key,
                  fits:q.L>=STACK_MIN_L, off:Math.abs(o)});
    }
  }
  // on the pipe first, then one step off, then two: only a crowded plant pays for an offset reading
  return out.sort((a,b)=>a.off-b.off);
}
// kept across frames because every price below is GEOMETRY; the key is the design and the grid top
let anchorCache=null, anchorBoxes=[], anchorKey="";
function pipeAnchorTick(){
  const k=DGEN+"|"+GY;
  if(k!==anchorKey){ anchorKey=k; anchorCache=null; anchorBoxes=[]; }
}
// where the readings are this frame, for a layer that has to keep off them
function pipeStackBoxes(){ return anchorBoxes; }
function pipeAnchors(runs){
  if(anchorCache) return anchorCache;
  // panels and holdup plates are seeded as already-taken ground, so they cost a spot what another reading costs it
  const out={}, taken=(typeof marginBoxes==="function"?marginBoxes():[]).slice();
  for(const p of LAY.parts) if(fitted(p)) taken.push(holdMarkBox(p));
  // longest run first: a main leg has the most to say and the fewest places to say it
  const fitKeys=fitStackKeys(runs);
  const slots=r=>fitKeys.has(r.key)?STACK_N+1:STACK_N;
  const spotsBy=new Map(), longest=new Map();
  for(const r of runs){ const sp=pipeRunSpots(r); spotsBy.set(r,sp);
    let m=0; for(const s of sp) if(s.L>m) m=s.L; longest.set(r,m); }
  const order=runs.slice().sort((a,b)=>longest.get(b)-longest.get(a));
  for(const r of order){
    const spots=spotsBy.get(r);
    if(!spots.length) continue;
    // scored, not first-past-the-post: smear, then machine, then step off the pipe, then a stretch too short
    let pick=null, bestCost=Infinity;
    for(const sp of spots){
      const bx=stackBox(sp.x,sp.y,slots(r));
      let over=0;
      for(const t of taken){
        const ox=Math.min(bx.x+bx.w,t.x+t.w)-Math.max(bx.x,t.x);
        const oy=Math.min(bx.y+bx.h,t.y+t.h)-Math.max(bx.y,t.y);
        if(ox>0&&oy>0) over+=ox*oy;
      }
      const cost = over*1000
                 + (boxClear(bx.x,bx.y,bx.w,bx.h)?0:400)
                 + sp.off*40
                 + (sp.fits?0:120);
      if(cost<bestCost){ bestCost=cost; pick=sp; if(!cost) break; }
    }
    out[r.key]=pick;
    { const bx=stackBox(pick.x,pick.y,slots(r)); bx.key=r.key; taken.push(bx); }
  }
  anchorCache=out; anchorBoxes=taken;
  return out;
}
function pipeRunAnchor(r){ return (anchorCache && anchorCache[r.key]) || pipeRunSpots(r)[0] || null; }

// hovering stands the other runs down, and with the layers off it puts the hovered one's readings up
let pipeHov=null;
const pipeHovOn = () => LAYERS.press.on||LAYERS.subc.on||LAYERS.flow.on||LAYERS.hold.on||LAYERS.temp.on;
// the one predicate both label paths ask, so slot 0 and slots 1-2 cannot disagree about which run is showing
const pipeHovShow = key => !pipeHov || pipeHov===key;
let holdHov=null;
const holdPartShow = id => holdHov ? holdHov===id : !pipeHov;
function pipeHovResolve(){
  pipeHov=null; holdHov=null;
  if(ui.drag || !vPtr) return;
  const p=vPtr;
  // the label first, because a label draws over the pipes; only while a layer is on, or the box holds no ink
  if(pipeHovOn()){ const boxes=pipeStackBoxes();
    for(let i=boxes.length-1;i>=0;i--){ const b=boxes[i];
      if(p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h){ pipeHov=b.key; return; } } }
  const c=cellAt(p), keys=pipeCellRuns(c[0],c[1]);
  if(keys.length){ pipeHov=keys[keys.length-1]; return; }   // a crossing cell owns two: last wins, as hitAt() does
  // the machine's plate hangs BELOW its box, so both count as pointing at that machine
  const q=partAt([p.x,p.y]);
  if(q && fitted(q)){ holdHov=q.id; return; }
  for(const r of LAY.parts){ if(!fitted(r)) continue;
    const b=holdMarkBox(r);
    if(p.x>=b.x&&p.x<b.x+b.w&&p.y>=b.y&&p.y<b.y+b.h){ holdHov=r.id; return; } }
}

function pipeMeters(runs,L){
  const best=pipeAnchors(runs), PC=pipeColours(L);
  for(const r of runs){
    if(!pipeHovShow(r.key)) continue;        // a hidden reading keeps no TIP either - see pipeHovResolve()
    const a=best[r.key]; if(!a) continue;
    const k=r.k, key=r.key;
    const un=pipeUnit(key,k);
    if(!un) continue;                        // nothing forces this run - see pipeUnit()
    // ONE smoothing pass at one tau, so the digit IS the solve to the printed precision
    const nom=Math.max(1e-6,Math.abs(un.nom));
    const fr=pipeDisplay(key,pipeRunKg(key,k,L)/nom,nom);
    const mag=pipeFmt(Math.abs(fr)*nom);
    // judged against the run's own DESIGN direction, never the key's order
    const fd=fr*(un.dir||1), holdKg=pipeRunHoldKg(r,L);
    const dead=Math.abs(fd)<0.008, over=fd>1.001, back=fd<-0.008;
    const chok=netChokedRun(P&&P.net, key);
    pipeStackLine(a.x,a.y,0,(back?"-":"")+mag+" "+un.u,
                  dead?C.ink2:over?C.red:back?C.amber:chok?C.bright:pipeCol(PC,k));
    TIP(a.x-STACK_W/2,stackTop(a.y,STACK_N),STACK_W,STACK_N*STACK_H,pipeLabel(k,key)+"  FLOW METER",
      mag+" "+un.u+" - "+Math.abs(Math.round(fd*100))+
      " % of what this run carries as commissioned, undamaged, valves wide."+
      (over?" It is being pushed past what it was built for."
       :back?" It is running backwards."
       :dead?" The line is stagnant."
       :"")+
      (chok?" It is CHOKED: the vapour in it is already leaving at the speed of sound, so lowering the pressure downstream buys nothing at all - only a wider bore or a denser fluid will pass more.":"")+
      (pipeDrop[key]!=null
        ? " It spends "+(pipeDrop[key]*100).toFixed(0)+
          " % of the loop's whole pump head getting the water along it - that is the price of this run's length, its bore, and anything throttling it."
        : "")
      + " It holds "+runVol(r).toFixed(2)+" m3"
      + (holdKg==null ? "" : " - "+Math.round(holdKg)+" kg standing in it right now")
      + ", which the flow has to turn over before what is in it changes.");
  }
}

// UNDER the box, not in it, and in the format the runs' HOLDUP line uses: a pipe and a vessel hold water by one rule
function pipeHoldMarks(L){
  if(!L) return;
  for(const p of LAY.parts){
    if(!fitted(p) || !holdPartShow(p.id)) continue;
    const kg=partHoldKg(p.id,L);
    if(kg===null || !isFinite(kg)) continue;
    const b=holdMarkBox(p);
    fillRect(b.x,b.y,b.w,b.h,C.bg);
    txt(holdFmt(kg), b.x+b.w/2, midBase(b.y,STACK_H,6.5*DRAW_K),
        {size:6.5*DRAW_K,sp:.4*DRAW_K,align:"center",color:C.ink});
    TIP(b.x,b.y,b.w,b.h, partName(p).toUpperCase()+"  HOLDUP",
      holdFmt(kg)+" of water and steam standing in this machine right now, off its own nodes in the solve. It is a real time constant: everything arriving has to displace it before what leaves changes. A shell, a hotwell and a tank are read from their own level, so nothing here is counted twice.");
  }
}

// one gauge per HOLD TANK, reading the pressure that vessel holds - never an id literal and never s.P
function pipeVessel(L){ for(const id of holdTankIds()) pipeHoldDial(L, id); }
function pipeHoldDial(L, id){
  const p=partOf(id);
  if(!p || !fitted(p) || partWrecked(L,id)) return;
  const ci=tankCircuit(id), pv=loopP(L,ci), set=holdSetP(ci);
  const R=prect(p), r=PIPE_DIAL_R;
  const fr=pipeDisplay(id+":P", pv/Math.max(0.1,set));
  // low enough to sit in the steam space rather than over the water, and clear of the box's own name row
  const cx=Math.round(R.x+R.w/2), cy=Math.round(PZR_DIAL_CY(R.y));
  // the dial is a FRACTION of this vessel's own setpoint, so the valve's absolute MPa is divided into that scale
  const fid=primaryRelief(), lift=fid ? reliefSet(fid).lift/Math.max(set,1e-6) : Infinity;
  pipeDial(cx,cy,r,fr,C.cyan,null,{lim:lift,max:1.35});
  TIP(cx-r,cy-r,2*r,2*r,partName(p).toUpperCase()+"  PRESSURE",
    pv.toFixed(2)+" MPa, "+Math.round(fr*100)+" % of the "+set.toFixed(1)+
    " MPa setpoint. Level "+tankLvl(L,id).toFixed(0)+" %."+
    (fr>lift?" It is past the relief valve setpoint."
            :reliefAnyOpen(L)?" The relief valve is passing.":""));
}

// nothing is hidden: a line that is there and shut is the answer to "is my injection lined up"
const pipeRuns = L => pipeNetwork();

const PIPE_LAB_PAD=1.1*DRAW_K;  // clear board between the word and the casing
// each leg is clipped to the run's own clear span first, so a word never lands half under its own flange
function pipeLabSpots(g){
  const at=(q,t)=>({x:q.x+q.dx*t, y:q.y+q.dy*t, dx:q.dx, dy:q.dy});
  const clear=nozzleReach()+PIPE_LAB_PAD;
  const segs=[];
  for(const q of g.segs){
    const lo=Math.max(q.s0,clear), hi=Math.min(q.s0+q.L,g.len-clear);
    if(hi<=lo) continue;
    segs.push({x:q.x+q.dx*(lo-q.s0), y:q.y+q.dy*(lo-q.s0), dx:q.dx, dy:q.dy, L:hi-lo});
  }
  segs.sort((a,b)=>b.L-a.L);
  if(!segs.length) return [];
  const q=segs[0];
  if(segs.length<2 || segs[1].L < q.L*0.45)
    return [{p:at(q,q.L/3), room:q.L/3}, {p:at(q,q.L*2/3), room:q.L/3}];
  return [{p:at(q,q.L/2), room:q.L*0.9},
          {p:at(segs[1],segs[1].L/2), room:segs[1].L*0.9}];
}
// a cut run states no pressure: the MPa word is what it is HELD AT, and a holed run holds nothing. Its bore stays a fact
const runCut = (r,L) => !!(L && r.cells && runHoled(L,r));
// priced once per edit; the one live input is whether the run is cut, so that flag is part of each run's key
const labPlan=new Map(); let labKey="";
function pipeLabPlan(r,cut){
  const k=DGEN+"|"+GY;
  if(k!==labKey){ labKey=k; labPlan.clear(); }
  let e=labPlan.get(r.key);
  if(e && e.cut===cut) return e.items;
  const REF=10, o0={size:REF,sp:0}, items=[];
  const g=pipeGeom(r.pts);
  if(g.len){
    const w=pipeWidth(runBore(r)), p=runDesignP(r);
    const words=[Math.round(runBoreMm(r))+" mm"];
    if(!cut) words.push((p>=10?p.toFixed(1):p.toFixed(2))+" MPa");
    const spots=pipeLabSpots(g);
    const n=Math.min(spots.length, words.length);
    // one scale for both words, or the shorter one rides a step bigger and the two read as separate labels
    let sz=w-PIPE_LAB_PAD;
    for(let i=0;i<n;i++)
      sz=Math.min(sz, REF*spots[i].room/Math.max(tw(words[i],o0),1e-6));
    if(sz>0.8*DRAW_K) for(let i=0;i<n;i++){ const sp=spots[i];
      items.push({word:words[i], x:sp.p.x, y:sp.p.y,
                  vert:Math.abs(sp.p.dx)<Math.abs(sp.p.dy), sz}); }
  }
  labPlan.set(r.key,{cut,items});
  return items;
}
function pipeSizeLabels(NET,L){
  for(const r of NET) for(const it of pipeLabPlan(r,runCut(r,L))){
    ctx.save(); ctx.translate(it.x, it.y);
    if(it.vert) ctx.rotate(-Math.PI/2);
    txt(it.word,0,it.sz*0.36,{size:it.sz,sp:0,align:"center",color:C.inkOnLit});
    ctx.restore();
  }
}

function pipeFlow(L){
  pipeRate(L);
  const PC=pipeColours(L);
  for(const r of pipeRuns(L)){
    if(runCut(r,L)) continue;   // a severed run carries nothing: no packets over an empty bore
    const w=pipeWidth(runBore(r));
    // the SAME line and radius drawPlant() strokes the casing with, or the parcels leave the pipe at every elbow
    const dp=runDrawPts(r, w+2*pipeWallPx(r));
    const g=pipeGeom(pipeBendPts(dp.pts, dp.R));
    if(!g.len) continue;
    ctx.save(); pipeClip(g,w,w/2);
    // pipeSpd is keyed by the RUN, never the kind: a kind has no entry of its own
    pipeStream(pipePad(g,PIPE_RUNWAY), r.key, pipeSpd[r.key]||0,
              pipePhaseCol(pipeCol(PC,r.k),pipeSteam(r,L)), w,
              pipeSteam(r,L), pipeSeed(r.key));
    ctx.restore();
  }
}
// only what flashes at the opening is a plume, off the split the room books it by; the liquid lands on the deck and liqDraw() draws it
const breakPlume = (L, key, i) => clamp((L.spillBy[key]||0)*openFlashX(L, openFluidH(L, key), i)/SPILL_FULL, 0, 1);
// one plume per open end, at the end's own point and that opening's own solved rate
function pipeBreaks(L){
  if(!L || !L.spillBy || !L.dmgParts) return;
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const k=id.slice(5), i=k.indexOf(","); if(i<0) continue;
    const x=+k.slice(0,i), y=+k.slice(i+1);
    // the rate is the connection's, because that is what the solve prices, but the plume is drawn AT THE CELL
    let q=0;
    for(const key of pipeCellRuns(x,y)) q=Math.max(q, breakPlume(L, "break:"+key, y*GW+x));
    if(!(q>0)) continue;
    const [px,py]=cellPos(x,y);
    fxCellSpace(px, py, ()=>
      fxSteam(0, 0, 22, fxEase("brk:"+k, q), "#ffd0c4", 29));
  }
  // a wrecked nozzle valve is an opening too, and it discharges at the JOINT rather than at a pipe cell
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("port:")!==0) continue;
    const pid=id.slice(5), c=portCell(pid), at=c ? c[1]*GW+c[0] : -1;
    let q=0;
    for(const r of pipeNetwork()) if(r.pa===pid||r.pb===pid)
      q=Math.max(q, breakPlume(L, "break:"+r.key, at));
    if(!(q>0)) continue;
    const [px,py]=portPos(pid);
    fxCellSpace(px, py, ()=>
      fxSteam(0, 0, 22, fxEase("brk:"+id, q), "#ffd0c4", 29));
  }
}
// the cell is grown by one casing width, since a stroke reaches at most half of that from its centreline
function pipeCellPath(pts,r,pad,keep){
  const x0=r.x-pad, x1=r.x+r.w+pad, y0=r.y-pad, y1=r.y+r.h+pad;
  if(!keep) ctx.beginPath();
  let pen=false, any=false;
  for(let j=1;j<pts.length;j++){
    const ax=pts[j-1][0], ay=pts[j-1][1], bx=pts[j][0], by=pts[j][1];
    const dx=bx-ax, dy=by-ay;
    let t0=0, t1=1, ok=true;
    for(const [d,p,lo,hi] of [[dx,ax,x0,x1],[dy,ay,y0,y1]]){
      if(Math.abs(d)<1e-9){ if(p<lo||p>hi){ ok=false; break; } continue; }
      let a=(lo-p)/d, b=(hi-p)/d; if(a>b){ const c=a; a=b; b=c; }
      t0=Math.max(t0,a); t1=Math.min(t1,b);
    }
    if(!ok || t1<=t0){ pen=false; continue; }
    if(!pen || t0>0){ ctx.moveTo(ax+dx*t0, ay+dy*t0); }
    ctx.lineTo(ax+dx*t1, ay+dy*t1);
    any=true; pen = t1>=1;
  }
  return any;
}
// the machines' own tear mark, laid ALONG the pipe: it is the bore that is wrecked, not the tile it crosses
function pipeTearHatch(w){
  if(!hatchOK()) return;
  ctx.save();
  ctx.globalAlpha=.4; ctx.lineWidth=w;
  ctx.strokeStyle=hatchPat(C.red, HATCH_P*DRAW_K, HATCH_W*DRAW_K);
  ctx.stroke();
  ctx.restore();
}
// one clip per RUN, not per hole: a clip forces the rasteriser to start again
function pipeDamage(L){
  if(!L || !L.dmgParts) return;
  const NET=pipeNetwork(), byKey=new Map();
  for(const q of NET) byKey.set(q.key,q);
  const byRun=new Map(), loose=[];
  const mark=(key,r)=>{ let a=byRun.get(key); if(!a){ a=[]; byRun.set(key,a); } a.push(r); };
  // a wrecked nozzle is a torn part too, and the pipe it holds stands in the PORT'S cell, which owns no run
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("port:")!==0) continue;
    const pid=id.slice(5), c=portCell(pid); if(!c) continue;
    const r=grect(c[0],c[1],1,1);
    for(const q of NET) if(q.pa===pid || q.pb===pid) mark(q.key,r);
  }
  for(const id of L.dmgParts){
    if(typeof id!=="string" || id.indexOf("pipe:")!==0) continue;
    const k=id.slice(5), i=k.indexOf(","); if(i<0) continue;
    const x=+k.slice(0,i), y=+k.slice(i+1), r=grect(x,y,1,1);
    let drew=false;
    for(const key of pipeCellRuns(x,y)){
      if(!byKey.has(key)) continue;
      drew=true; mark(key,r);
    }
    if(!drew) loose.push([k,r]);
  }
  ctx.save();
  ctx.lineCap="square"; ctx.lineJoin="round";
  for(const [key,cells] of byRun){
    const run=byKey.get(key);
    const w=pipeWidth(runBore(run)), cw=w+2*pipeWallPx(run);
    ctx.save();
    ctx.beginPath();
    for(const r of cells) ctx.rect(r.x,r.y,r.w,r.h);
    ctx.clip();
    ctx.beginPath();
    let any=false;
    for(const r of cells) any = pipeCellPath(run.pts,r,cw,true) || any;
    if(any){
      ctx.lineWidth=w; ctx.strokeStyle=C.well; ctx.stroke();
      pipeTearHatch(cw);
    }
    ctx.restore();
  }
  // a cell no connection claims has no polyline to borrow, so it takes pipeLoose()'s
  for(const [k,r] of loose){
    const cell=D.pipes[k], sh=cell&&PIPE_SHAPE[cell.s];
    if(!sh) continue;
    const cx=r.x+r.w/2, cy=r.y+r.h/2, h=r.w/2;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
    ctx.beginPath();
    for(const pr of sh.paths){
      const a=rotFace(pr[0],cell.r), b=rotFace(pr[1],cell.r);
      ctx.moveTo(cx+DIRV[a][0]*h, cy+DIRV[a][1]*h);
      ctx.lineTo(cx,cy);
      ctx.lineTo(cx+DIRV[b][0]*h, cy+DIRV[b][1]*h);
    }
    ctx.stroke();
    pipeTearHatch(3*DRAW_K);
    ctx.restore();
  }
  ctx.restore();
}
// drawn from the same PIPE_SHAPE rows the trace walks, so the picture cannot disagree with pipeExit()
function pipeLoose(L){
  const own=pipeMap().cellOwner;
  ctx.save(); ctx.strokeStyle=C.ink2; ctx.lineCap="butt"; ctx.lineJoin="round";
  for(const k in D.pipes){
    if(own[k]) continue;
    const i=k.indexOf(","), x=+k.slice(0,i), y=+k.slice(i+1);
    const cell=D.pipes[k], sh=PIPE_SHAPE[cell.s];
    const r=grect(x,y,1,1), cx=r.x+r.w/2, cy=r.y+r.h/2, h=r.w/2;
    if(sh){ ctx.lineWidth=3*DRAW_K;
      for(const pr of sh.paths){
        const a=rotFace(pr[0],cell.r), b=rotFace(pr[1],cell.r);
        ctx.beginPath();
        ctx.moveTo(cx+DIRV[a][0]*h, cy+DIRV[a][1]*h);
        ctx.lineTo(cx,cy);
        ctx.lineTo(cx+DIRV[b][0]*h, cy+DIRV[b][1]*h);
        ctx.stroke();
      } }
    ctx.save(); ctx.setLineDash([3*DRAW_K,3*DRAW_K]); ctx.lineWidth=1.5*DRAW_K;
    ctx.strokeRect(r.x+3*DRAW_K,r.y+3*DRAW_K,r.w-6*DRAW_K,r.h-6*DRAW_K); ctx.restore();
  }
  // a run's stamped cells begin one clear of the port cell, so the half-plumbed one needs its stub drawn here
  ctx.lineWidth=3*DRAW_K;
  for(const rid in D.runs){
    const r=D.runs[rid], cs=r.cells; if(!cs||!cs.length) continue;
    for(const which of ["a","b"]){
      const e=r[which], pid=portAtCell(e[0],e[1]); if(pid==null) continue;
      const c = which==="a" ? cs[0] : cs[cs.length-1];
      if(own[pipeKey(c[0],c[1])]) continue;
      const [px,py]=portPos(pid), [qx,qy]=cellPos(c[0],c[1]);
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(qx,qy); ctx.stroke();
    }
  }
  ctx.restore();
}


// MAT_PX is WALL_PX's stated exaggeration on the scale a WALL is set in: a 20 mm liner and a 900 mm shell must differ across one cell
const MAT_PX = 0.016*DRAW_K;
// it is the BAND that is hatched, not the cell, so the pitch is a fraction of the band
const MAT_HATCH_P = 4*DRAW_K, MAT_HATCH_W = 0.9*DRAW_K;
// the TAKEN stripes are a fraction of the CELL instead: few, fat bars read as solid, where the band's fine pitch reads as a surface
// C2 is every other bar: lerpC(C.ink2, C.bg, 0.55) darkens them, C.ink2 is one flat grey
const MAT_TAKEN_P = 0.62*CELL, MAT_TAKEN_W = 0.26*CELL, MAT_TAKEN_C2 = C.ink2;
const matWallPx = (x,y,r) => clamp(matThick(x,y)*MAT_PX, 1*DRAW_K, Math.min(r.w,r.h));
// a wall grows from its INNER face outward; a cell with no inner face - a shield - fills its whole cell
/* hoisted, and the answer handed back in one array: this is asked per painted cell per frame, and the
   closure, the list and the diagonal table were all built again each time. Callers read it and drop it. */
const matFaceIn=(R,X,Y)=>{ if(X<0||X>=GW||Y<0||Y>=GH) return false;
  if(matWall(X,Y)) return false;
  const g=R.regions[R.of[Y*GW+X]]; return !!(g && g.bounded); };
const MAT_DIAG=[[-1,-1,"lt"],[1,-1,"rt"],[-1,1,"lb"],[1,1,"rb"]], MAT_FACES=[];
function matInFaces(R,x,y){
  const out=MAT_FACES; out.length=0;
  if(matFaceIn(R,x-1,y)) out.push("l");
  if(matFaceIn(R,x+1,y)) out.push("r");
  if(matFaceIn(R,x,y-1)) out.push("t");
  if(matFaceIn(R,x,y+1)) out.push("b");
  // a corner's inside is DIAGONAL: the orthogonal test comes back empty there, and the diagonal names both faces
  if(!out.length){
    for(let i=0;i<MAT_DIAG.length;i++){ const d=MAT_DIAG[i];
      if(matFaceIn(R,x+d[0],y+d[1])) out.push(d[2]); }
  }
  return out;
}
// one path filled once, because a gap at a corner is the one thing a containment must never draw
function matBandPath(r,faces,w){
  ctx.beginPath();
  if(!faces.length){ ctx.rect(r.x,r.y,r.w,r.h); return; }
  for(const f of faces){
    // a corner is the OVERLAP of the two strips, not their union, or a tail hangs past the turn on each side
    if(f.length===2){ ctx.rect(f[0]==="l" ? r.x : r.x+r.w-w,
                               f[1]==="t" ? r.y : r.y+r.h-w, w, w); continue; }
    if(f==="l") ctx.rect(r.x, r.y, w, r.h);
    if(f==="r") ctx.rect(r.x+r.w-w, r.y, w, r.h);
    if(f==="t") ctx.rect(r.x, r.y, r.w, w);
    if(f==="b") ctx.rect(r.x, r.y+r.h-w, r.w, w);
  }
}
// placed off the CELL's own coordinates, never a die: a texture that moves between frames is a fault light nobody lit
const AGG_R=1.2*DRAW_K;
function matAgg(r,x,y,col){
  ctx.fillStyle=col; ctx.globalAlpha=.55;
  const o=((x*7+y*13)%5)/5;
  for(const d of [[.28,.22],[.66,.48],[.38,.78]]){
    ctx.beginPath();
    ctx.arc(r.x+r.w*((d[0]+o)%1), r.y+r.h*((d[1]+o)%1), AGG_R, 0, 7); ctx.fill(); }
  ctx.globalAlpha=1;
}
// the band's two LONG edges only, each stopping at the other band's outer edge so a turn mitres instead of running a rung
function matSealLines(r,faces,w,dead){
  ctx.save();
  ctx.strokeStyle = dead ? C.red : C.bright;
  // half the band, so the two lines and the cut between them are always all three visible
  const lw = Math.min(2*DRAW_K, w*0.5);
  ctx.globalAlpha = 1; ctx.lineWidth = lw;
  const V=(X,y0,y1)=>{ ctx.beginPath(); ctx.moveTo(X,y0); ctx.lineTo(X,y1); ctx.stroke(); };
  const H=(Y,x0,x1)=>{ ctx.beginPath(); ctx.moveTo(x0,Y); ctx.lineTo(x1,Y); ctx.stroke(); };
  const has={}; for(const f of faces) if(f.length===1) has[f]=1;
  for(const f of faces){
    if(f.length===2){
      const bx=f[0]==="l"?r.x:r.x+r.w-w, by=f[1]==="t"?r.y:r.y+r.h-w;
      V(f[0]==="l"?r.x+w:r.x+r.w-w, by, by+w);
      H(f[1]==="t"?r.y+w:r.y+r.h-w, bx, bx+w);
      continue;
    }
    const x0=has.l?r.x+w:r.x, x1=has.r?r.x+r.w-w:r.x+r.w;
    const y0=has.t?r.y+w:r.y, y1=has.b?r.y+r.h-w:r.y+r.h;
    if(f==="l"){ V(r.x,y0,y1); V(r.x+w,y0,y1); }
    if(f==="r"){ V(r.x+r.w,y0,y1); V(r.x+r.w-w,y0,y1); }
    if(f==="t"){ H(r.y,x0,x1); H(r.y+w,x0,x1); }
    if(f==="b"){ H(r.y+r.h,x0,x1); H(r.y+r.h-w,x0,x1); }
  }
  // the turn is a patch on the diagonal cell: neither inner line can reach into the corner, and a cap would be clipped away
  ctx.fillStyle = ctx.strokeStyle;
  for(const f of faces) if(f.length===2)
    ctx.fillRect((f[0]==="l"?r.x:r.x+r.w)-lw/2, (f[1]==="t"?r.y:r.y+r.h)-lw/2, lw, lw);
  ctx.restore();
}
/* Its own bars, not hatch()'s tile: a fat line in that tile shows the butt cap the tile corners put inside the cell. Odd bars take MAT_TAKEN_C2, and the phase is absolute, so the lattice runs on across a wall. */
function matTakenBars(r){
  const P=MAT_TAKEN_P, over=r.w+r.h, y0=r.y-over, y1=r.y+r.h+over;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
  ctx.globalAlpha=.22; ctx.lineWidth=MAT_TAKEN_W; ctx.lineCap="butt";
  const m1=Math.ceil((r.x+r.w+r.y+r.h)/P)+1;
  for(let m=Math.floor((r.x+r.y)/P)-1; m<=m1; m++){
    const s=m*P;
    ctx.strokeStyle = (m&1) ? MAT_TAKEN_C2 : C.ink2;
    ctx.beginPath(); ctx.moveTo(s-y0,y0); ctx.lineTo(s-y1,y1); ctx.stroke();
  }
  ctx.restore();
}
function matPaintDraw(L){
  if(!D.mat) return;
  ctx.save();
  const RG=matRegions();
  // a seal is selected, not a cell: the amber goes round the BAND, under it
  const selCells=(()=>{
    if(typeof sel!=="string" || sel.indexOf("mat:")!==0) return null;
    const j=sel.indexOf(","), x=+sel.slice(4,j), y=+sel.slice(j+1);
    if(!matCell(x,y)) return null;
    const cs=matSealCells(x,y);
    return cs ? cs.map(i=>[i%GW,(i/GW)|0]) : [[x,y]]; })();
  if(selCells){
    ctx.save(); ctx.strokeStyle=C.amber; ctx.fillStyle=C.amber;
    ctx.lineJoin="round"; ctx.lineWidth=3*DRAW_K;
    for(const c of selCells){ const r=grect(c[0],c[1],1,1);
      matBandPath(r, matInFaces(RG,c[0],c[1]), matWallPx(c[0],c[1],r));
      ctx.fill(); ctx.stroke(); }
    ctx.restore(); }
  for(const k in D.mat){
    const i=k.indexOf(","), x=+k.slice(0,i), y=+k.slice(i+1);
    if(x<0||x>=GW||y<0||y>=GH) continue;
    const m=matRow(D.mat[k].m), r=grect(x,y,1,1);
    const dead = L && matWrecked(L,x,y);
    const w = matWallPx(x,y,r), faces = matInFaces(RG,x,y);
    const col = dead ? C.well : m.col;
    // a GAS-TIGHT cell is out of every region and no field may fill it, so the whole cell is struck through in grey; the band's own hatch stays clipped to the real thickness on top
    if(m.tight) matTakenBars(r);
    matBandPath(r,faces,w);
    ctx.save(); ctx.clip();
    ctx.fillStyle = lerpC(col, C.bg, m.tight ? 0.58 : 0.66);
    ctx.fillRect(r.x,r.y,r.w,r.h);
    hatch(r.x,r.y,r.w,r.h,col,m.tight?.85:.7,MAT_HATCH_P,MAT_HATCH_W);
    if(m.agg) matAgg(r,x,y,col);
    // gas-tight is a FACE: the band's two long edges, never an outline that would rung across every cell join
    if(m.tight && faces.length) matSealLines(r,faces,w,dead);
    ctx.restore();
    // clipped to the band, or a shot liner hatches a cell it does not occupy
    if(dead){ ctx.save(); matBandPath(r,faces,w); ctx.clip();
      hatch(r.x,r.y,r.w,r.h,C.red,.45); ctx.restore(); }
  }
  ctx.restore();
}
