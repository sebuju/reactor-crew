"use strict";

// the lane left of the hull for the EL labels: part of the view's content box, not of the grid
const EL_GUT=22;

// how much ship z=1 shows, in CELLS
const VIEW_CELLS_W=34, VIEW_CELLS_H=19;

function bowtie(cx,cy,w,h,col){
  ctx.beginPath();
  ctx.moveTo(cx-w/2,cy-h/2); ctx.lineTo(cx+w/2,cy+h/2);
  ctx.lineTo(cx+w/2,cy-h/2); ctx.lineTo(cx-w/2,cy+h/2);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
}
// what sits on the stem tells the three fittings apart, the way a P&ID does it
function fitGlyph(cx,cy,w,h,mode,col){
  bowtie(cx,cy,w,h,col);
  if(mode==="tee") return;
  const t=cy-h/2;
  line(cx,t,cx,t-2,col,1.3);                       // the stem a driven valve has
  if(mode==="throttle") line(cx-3,t-2,cx+3,t-2,col,1.4);   // the handwheel
  else { line(cx-3,t-2,cx+3,t-4,col,1.2);          // a spring seen from the side
         line(cx-3,t-4,cx+3,t-2,col,1.2); }
}
// every stood-down state gets its own mark, on the BODY: there is no room above the actuator
function reliefBowtie(cx,cy,w,h,L,fid){
  const open = !!(L && fid && L.reliefOpen[fid] && !L.reliefBlocked[fid]);
  const blkd = !!(L && fid && L.reliefBlocked[fid]);
  const byp  = !!(L && fid && !fitSpring(fid) && !sinkDriver(L,"relief",fid));
  fitGlyph(cx,cy,w,h,"relief", open?C.red : (blkd||byp)?C.dis : C.green);
  if(blkd) line(cx-w/1.5,cy,cx+w/1.5,cy,C.red,1.6);
  else if(byp){ const r=Math.max(w,h)/1.6;
    line(cx-r,cy-r,cx+r,cy+r,C.amber,1.3); line(cx-r,cy+r,cx+r,cy-r,C.amber,1.3); }
}
// the bar stands UP, where a blocked relief valve's lies flat
function throttleShut(cx,cy,w,h){
  fitGlyph(cx,cy,w,h,"throttle",C.dis);
  line(cx,cy-h/1.5,cx,cy+h/1.5,C.red,1.6);
}
// the nozzle has to be the same dark as the pipe it caps
const PIPE_CASE="#22383e";

// only a real port gets one (r.nz): a branch ends on another pipe and already carries the fitting's glyph
function nozzleEnds(r){
  const out=[], n=r.pts.length;
  if(!r.nz || n<2) return out;
  // `end` names WHOSE nozzle this is
  const add=(p,q,end)=>{
    const dx=q[0]-p[0], dy=q[1]-p[1];
    if(Math.abs(dx)<0.5 && Math.abs(dy)<0.5) return;   // coincident: no facing
    out.push({p, flat:Math.abs(dx)>Math.abs(dy), end});
  };
  if(r.nz[0]) add(r.pts[0],r.pts[1],"a");
  if(r.nz[1]) add(r.pts[n-1],r.pts[n-2],"b");
  return out;
}
// two pixels short of the cell, so the gap survives the deck's grid dot on both sides
const NOZZLE_HALF_MAX = 5*DRAW_K;
// one size for every joint: the CELL's own budget, so nothing about a flange has to be compared
const pipeNozzleHalf = () => NOZZLE_HALF_MAX;
// addressed by PORT, not by (part, face) - two ports can share a face; takes the live state, never S, because the bench draws nozzles too
function portColOf(pid,L){
  // a wrecked joint is empty: the bore is deck
  if(portWrecked(L,pid)) return C.well;
  if(L && L.portShut && L.portShut[pid]) return C.red;
  const q=D.ports[pid]; if(!q) return C.metal;
  const f=portFaceOf(pid), IN=portPath(partOf(q.p), f);
  return !IN ? C.metal : portEnd(partOf(q.p),f)==="a" ? C.portA : C.portB;
}
// the flange stands proud by a fraction of the CELL, so it grows with DRAW_K like the bore does
const NOZZLE_CASE=1*DRAW_K;
const NOZZLE_DEEP=2.5*DRAW_K;   // how far it stands proud of the shell
// how far a joint reaches along its own run, so a word placed on that run can be kept off it
const nozzleReach=()=>NOZZLE_DEEP+NOZZLE_CASE;
function nozzleRect(px,py,flat,bore){
  const half=pipeNozzleHalf(), deep=NOZZLE_DEEP;
  const bx=flat?deep:half, by=flat?half:deep;
  return {x:px-bx-NOZZLE_CASE, y:py-by-NOZZLE_CASE,
          w:2*bx+2*NOZZLE_CASE, h:2*by+2*NOZZLE_CASE};
}
function drawNozzle(px,py,flat,bore,col){
  const r=nozzleRect(px,py,flat,bore);
  fillRect(r.x,r.y,r.w,r.h,PIPE_CASE);
  fillRect(r.x+NOZZLE_CASE,r.y+NOZZLE_CASE,
           r.w-2*NOZZLE_CASE,r.h-2*NOZZLE_CASE,col);
}
// one answer for the bore every pass draws a joint at; a port with nothing piped to it is a bore of 1
function portBores(){
  const b={};
  for(const r of pipeNetwork()){ const v=runBore(r);
    b[r.pa]=Math.max(b[r.pa]||0,v); b[r.pb]=Math.max(b[r.pb]||0,v); }
  return b;
}
const portFlat = f => f==="l"||f==="r";
function portNozzleRect(pid,f,bore){
  const [nx,ny]=portPos(pid);
  return nozzleRect(nx,ny,portFlat(f),bore||1);
}
// the word lies along the joint's own long axis, scaled rather than clipped
const PORT_WORD_PAD=1*DRAW_K;
function portWordDraw(pid,f,word,r){
  const vert=portFlat(f), REF=10, pad=2*PORT_WORD_PAD;
  const long=(vert?r.h:r.w)-pad, short=(vert?r.w:r.h)-pad;
  const sz=Math.min(short, REF*long/Math.max(tw(word,{size:REF,sp:0}),1e-6));
  if(!(sz>0.5*DRAW_K)) return;
  ctx.save();
  ctx.translate(r.x+r.w/2, r.y+r.h/2);
  if(vert) ctx.rotate(-Math.PI/2);
  txt(word,0,sz*0.36,{size:sz,color:C.inkOnLit,align:"center",sp:0});
  ctx.restore();
}
function pipeNozzles(NET,L){
  for(const r of NET){
    for(const e of nozzleEnds(r)){
      const pid=e.end==="a"?r.pa:r.pb;
      drawNozzle(e.p[0],e.p[1],e.flat,runBore(r),portColOf(pid,L));
    }
  }
}
// past SPIN_LO a vane cannot carry a direction, so the mark becomes the ARC it covered; the shown rate saturates but never falls
const SPIN_LO=52, SPIN_HI=80, SPIN_KNEE=50, SPIN_CAP=66, SPIN_FULL=400;
const spinRate=dpf=>{ const m=Math.abs(dpf);
  if(m<=SPIN_KNEE) return dpf;
  const k=SPIN_CAP-SPIN_KNEE;
  return (dpf<0?-1:1)*(SPIN_KNEE+k*(1-Math.exp(-(m-SPIN_KNEE)/k))); };
// fraction of rated this shaft turns at: its own drive, or the water pushed through it
const pumpSpinK = (s,id) => Math.max(pumpDrive(s,id), pumpQOf(s,id)/Math.max(pumpRefKgs(id),1e-9));
function spinVane(cx,cy,r,deg,dpf,col){
  const t=clamp((Math.abs(dpf)-SPIN_LO)/(SPIN_HI-SPIN_LO),0,1), a=deg*Math.PI/180;
  if(t<1){
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(-r*.45,-r*.55); ctx.lineTo(r*.7,0); ctx.lineTo(-r*.45,r*.55);
    ctx.closePath(); ctx.globalAlpha=1-t; ctx.fillStyle=col; ctx.fill(); ctx.restore();
  }
  if(!t) return;
  // how far past "a blur" it is, and the three things that say so
  const u=clamp((Math.abs(dpf)-SPIN_HI)/(SPIN_FULL-SPIN_HI),0,1);
  // the arc arrives quickly and then goes on getting brighter, or the crossover shows less ink than the vane it replaced
  const fade=clamp(t*3,0,1);
  const dir=dpf<0?-1:1, span=clamp(Math.abs(dpf)*2.6,60,358)*Math.PI/180;
  const r0=r*(.36-.10*u), r1=r*(.68+.06*u), peak=(0.55+0.40*u)*fade, tail=a-span*dir;
  const g=ctx.createConicGradient(dir>0?tail:a,cx,cy), f=clamp(span/6.2832,.001,1);
  g.addColorStop(0,alphaC(col,dir>0?0.08*fade:peak));
  g.addColorStop(f,alphaC(col,dir>0?peak:0.08*fade));
  if(f<0.999) g.addColorStop(Math.min(1,f+0.0005),alphaC(col,0));
  ctx.beginPath();
  ctx.arc(cx,cy,r1,Math.min(a,tail),Math.max(a,tail));
  ctx.arc(cx,cy,r0,Math.max(a,tail),Math.min(a,tail),true);
  ctx.closePath(); ctx.fillStyle=g; ctx.fill();
  // the head, so which way it is going survives a closed ring
  ctx.beginPath();
  ctx.arc(cx,cy,r1+r*.04,a-0.12,a+0.03);
  ctx.arc(cx,cy,r0-r*.04,a+0.03,a-0.12,true);
  ctx.closePath(); ctx.fillStyle=alphaC(C.bright,0.85*fade); ctx.fill();
}
// the tank shell's own corner radius, read by the shell AND by the box it stands in
const tankRad=id=>tankHeld(id)?9:3;
// the whole symbol stands in the cell, stem and spring included
function fitGlyphWH(id,boxW,boxH){
  const fw=clamp(pipeWidth(fitBoreK(id))*1.6, 8, Math.max(8, boxW-4));
  return {fw, fh:clamp(fw*11/16, 5, Math.max(5, boxH-10))};
}
// ART EXEMPT: symAt()'s id chain draws each part's own glyph, never a network decision; it is authored in a 16-unit cell and scaled once, here
function drawSym(p,x,y,w,h,ink,L){
  ctx.save();
  ctx.translate(x,y); ctx.scale(DRAW_K,DRAW_K);
  symAt(p,0,0,w/DRAW_K,h/DRAW_K,ink,L);
  ctx.restore();
}
function symAt(p,x,y,w,h,ink,L){
  const cx=x+w/2, X=x+5, Y=y+5, W=w-10, Hh=h-10;
  const shell=fn=>{ ctx.beginPath(); fn(); ctx.fillStyle=C.machBg; ctx.fill();
    ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke(); };
  const lvl=(fx,fy,fw,fh,frac,col)=>{ const t=clamp(frac,0,1);
    ctx.save(); ctx.globalAlpha=.45; fillRect(fx,fy+fh*(1-t),fw,fh*t,col); ctx.restore(); };
  // every tank draws through this: shell, water clipped to that shell, a waterline, and the space above in the charge's own tint - bare where the vessel is vented to the air
  const tank=(bx,by,bw,bh,rad,frac,col,gasCol)=>{
    const path=()=>{ ctx.beginPath(); rr(bx,by,bw,bh,rad); };
    path(); ctx.fillStyle=C.machBg; ctx.fill();
    const t=clamp(frac,0,1);
    if(gasCol && t<0.999){
      ctx.save(); path(); ctx.clip();
      ctx.globalAlpha=.16; fillRect(bx,by,bw,bh*(1-t),gasCol);
      ctx.restore();
    }
    if(t>0.001){
      const wy=by+bh*(1-t);
      ctx.save(); path(); ctx.clip();
      ctx.globalAlpha=.45; fillRect(bx,wy,bw,bh*t,col); ctx.globalAlpha=1;
      fillRect(bx,wy-0.6,bw,1.2,col);                    // the surface itself
      ctx.restore();
    }
    path(); ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
  };
  const id=p.id;
  // wrecked machinery does not turn, asked once here rather than at each moving symbol
  const dead = partWrecked(L,id);
  if(p.role==="core"){
    shell(()=>{ ctx.moveTo(X,Y+10); ctx.quadraticCurveTo(cx,Y-6,X+W,Y+10);
      ctx.lineTo(X+W,Y+Hh-10); ctx.quadraticCurveTo(cx,Y+Hh+6,X,Y+Hh-10); ctx.closePath(); });
    const bx=X+7,by=Y+22,bw=W-14,bh=Hh-42;
    fillRect(bx,by,bw,bh,C.well);
    if(L) lvl(bx,by,bw,bh,clamp((L.inv-88)/12,0,1),L.dnbr<1.3?C.red:C.blue);
    else  lvl(bx,by,bw,bh,1,C.blue);
    if(L&&L.melt){ ctx.globalAlpha=.55+.4*Math.abs(Math.sin(fxClock()/0.3));
      fillRect(bx,by+bh*.62,bw,bh*.38,"#ff5a45"); ctx.globalAlpha=1; }
    if(L&&L.dmg>0.1) hatch(bx,by,bw,bh,C.red,clamp(.2+L.dmg/140,.2,.85));
    frame(bx,by,bw,bh,ink);
    coreDraw(bx+2,by+2,bw-4,bh-4,coreView(L,id));
    // normalised on the SAME 0..0.6 the VOID readout's band uses
    if(L) fxBubbles(bx+1,by+1,bw-2,bh-2,fxEase(id+":boil",clamp(L.vf/.6,0,1)),C.bright,"chan");
    // the melt flicker owns the end state, so this stands down once that takes over
    if(L) fxPulse(bx,by,bw,bh,C.red,fxEase(id+":dnb",L.dnbr<1&&!L.melt?1:0),1.6);
    // driven by THIS opening's own solved outflow, never the s.breach flag, so it stops with the thing it depicts
    if(L) fxSteam(cx,Y+6,W*.6,
      fxEase(id+":breach",clamp((L.spillBy["break:core"]||0)/SPILL_FULL,0,1)),"#ffd0c4",31);
    // BREACHED beats SCRAM beats NEAR TRIP: only the last has not happened yet
    const near = L && !L.breach && !L.scrammed && tripNear();
    // the three the mimic already owns lead, so their tiles are dropped rather than said twice
    const said={"RX BREACH":1,"CORE MELT":1,"NEAR TRIP":1};
    if(L) bannerRows([
      L.breach && ["BREACHED",C.red],
      L.melt && ["MELT",C.red],
      L.scrammed && ["SCRAM",C.red],
      ...annOnPart(id).filter(a=>!said[a[0]]).map(a=>[a[0],annSevCol(a[1])]),
      near && ["TRIP: "+near,C.amber],
    ],cx,bx-2,by-2,bw+4,bh+4);
  } else if(p.role==="rods"){
    shell(()=>ctx.rect(X+8,Y+2,W-16,Hh-10));
    // the DRIVE MECHANISMS, not the rods: what this component owns is whether the drives ANSWER
    const K=P&&P.cores&&P.cores[coreOf(p.id)]; const nb = L&&L.rodZ&&K? K.NB : 5;
    const DW=5, step=Math.min((W-24)/nb, DW*3), x0=cx-nb*step/2+(step-DW)/2;
    const jam = L&&L.rodJam, scram = L&&L.scrammed;
    const hcol = jam?"#8a7a4a" : scram?C.red : "#b9cdd2";
    const ht=Math.max(4,Hh-16), hy=Y+6;
    // where the nut sits for an insertion 0..1: the top of the screw is fully OUT, its foot fully IN
    const at=v=>hy+3+clamp(v,0,1)*Math.max(0,ht-8);
    for(let i=0;i<nb;i++){ const sx=Math.round(x0+i*step);
      fillRect(sx,hy,DW,ht,C.well);                // the housing the lead screw runs in
      fillRect(sx,hy,DW,3,hcol);                   // the motor on top of it
      fillRect(sx+1,hy+ht-2,3,2,hcol);             // the gearbox at its foot
      const z = L? (L.rodZ?L.rodZ[i]:L.rodPos) : 0.2;
      const d = L? (L.rodZDem?L.rodZDem[i]:L.rodDem) : 0.2;
      // the stretch of screw still to run, so a walking drive says HOW FAR it has to go
      if(L&&!jam&&!scram&&Math.abs(d-z)>.002){
        const a=Math.min(at(z),at(d)), b=Math.max(at(z),at(d));
        fillRect(sx+1,a,3,Math.max(1,b-a),"rgba(240,168,48,.5)");
      }
      // the nut says where the MACHINE has got to, which is the reading that survives a jam
      fillRect(sx-1,Math.round(at(z)),DW+2,2,hcol);
    }
    fxSparks(X+8,Y+2,W-16,Math.max(4,Hh-10),fxEase(id+":jam",jam?1:0),C.red);
    // JAMMED wins over SCRAM, and both over ROD LIMIT: pinned near the TOP, clear of the REPAIR key's own centre
    if(jam||scram)
      banner(jam?"JAMMED":"SCRAM",cx,X+7,Y+1,W-14,Math.max(8,Hh-8),C.red,Y+9);
    else if(L&&annLit("ROD LIMIT"))
      banner("ROD LIMIT",cx,X+7,Y+1,W-14,Math.max(8,Hh-8),C.amber,Y+9);
  } else if(p.role==="sg"){
    const burst = !!(L && L.sgBurst && L.sgBurst[id]);
    // a burst shell is OPEN: the lid is torn instead of domed
    const sgPath=()=>{ ctx.moveTo(X,Y+12);
      if(burst){ const n=7; for(let i=1;i<=n;i++){ const t=i/n;
          ctx.lineTo(X+W*t, Y+12-(1-Math.abs(2*t-1))*13 + (i%2?6:-4)); } }
      else ctx.quadraticCurveTo(cx,Y-4,X+W,Y+12);
      ctx.lineTo(X+W,Y+Hh); ctx.lineTo(X,Y+Hh); ctx.closePath(); };
    shell(sgPath);
    ctx.save(); ctx.beginPath(); ctx.rect(X,Y+12,W,Hh-12); ctx.clip();
    lvl(X,Y+12,W,Hh-12, L? sgLvl(L,id)/100 : .5, C.blue); ctx.restore();
    ctx.beginPath(); ctx.moveTo(X+7,Y+Hh-4); ctx.lineTo(X+7,Y+Hh*.4);
    ctx.quadraticCurveTo(cx,Y+Hh*.18,X+W-7,Y+Hh*.4); ctx.lineTo(X+W-7,Y+Hh-4);
    ctx.strokeStyle=ink; ctx.lineWidth=1.6; ctx.stroke();
    if(L){
      // a kettle only boils while there is water left in it
      const wet=clamp(sgLvl(L,id)/25,0,1);
      // clipped to the SHELL, not the body box: the steam space is the domed lid
      ctx.save(); ctx.beginPath(); sgPath(); ctx.clip();
      fxBubbles(X+2,Y+4,W-4,Hh-6,fxEase(id+":boil",clamp(Math.min(L.n,L.load),0,1)*wet),C.bright,"pool");
      ctx.restore();
      // boiling dry, on the same 25% the SG LEVEL band calls LOW
      fxPulse(X+2,Y+14,W-4,Hh-16,C.amber,fxEase(id+":dry",sgLvl(L,id)<SG_DRY?1-wet*.7:0),1.5);
      // on THIS generator's own solved leak, so it slows as the primary comes down to the secondary
      const sgtrQ = (L.sgtrBy && L.sgtrBy["sgtr:"+id]) || 0;
      fxJet(cx,Y+Hh*.42,W*.45,fxEase(id+":sgtr",clamp(sgtrQ/SGTR_RATE,0,1)),C.red,0,-1,53);
      // what the hole is actually passing, on the same scale step() gives it
      if(burst) fxSteam(cx,Y+8,W*.75,
        fxEase(id+":burst",clamp(((L.sgVentBy&&L.sgVentBy[id])||0)
                                 /Math.max(SG_RELIEF_CAP*ratedSteam(),1e-9),0,1)),"#ffd0c4",67);
      // the shell has no setpoint of its own, so the warning is its own distance to the hole
      const ruptured = sgtrLive(L, id), lv=sgLvl(L,id);
      const pFrac = burst ? 0
        : clamp((secP(L,id)-sgDesignP(id))/Math.max(sgBurstP(id)-sgDesignP(id),1e-9),0,1);
      fxPulse(X+2,Y+14,W-4,Hh-16,pFrac>SG_P_HI?C.red:C.amber,
              fxEase(id+":press",pFrac>SG_P_WARN?pFrac:0),2.2);
      // one ladder, on the same constants the board's tiles read
      const word = burst?"BURST" : ruptured?"RUPTURED" : pFrac>SG_P_WARN?"HIGH PRESS"
                 : lv<SG_DRY_LO?"DRY" : lv<SG_DRY?"DRYING" : "LOW";
      if(burst||ruptured||pFrac>SG_P_WARN||lv<SG_LOW)
        // a wrecked shell prints no level, so its word takes the middle back
        banner(word,cx,X+1,Y+11,W-2,Hh-12,
               (burst||ruptured||lv<SG_DRY_LO||pFrac>SG_P_HI)?C.red:C.amber,
               ruptured?null:midBase(Y+13,(Hh-12)*.36,9));
    }
  } else if(p.role==="ihx"){
    // no steam space, so it is drawn full and has no level
    shell(()=>{ ctx.moveTo(X,Y+5); ctx.quadraticCurveTo(cx,Y-4,X+W,Y+5);
      ctx.lineTo(X+W,Y+Hh-5); ctx.quadraticCurveTo(cx,Y+Hh+4,X,Y+Hh-5); ctx.closePath(); });
    ctx.beginPath();
    for(let i=1;i<=3;i++){ const yy=Y+5+(Hh-10)*i/4;
      ctx.moveTo(X+4,yy); ctx.lineTo(X+W-4,yy); }
    ctx.strokeStyle=ink; ctx.lineWidth=1.2; ctx.stroke();
  } else if(roleHead(p.role)){
    // floored: a box shorter than the 5 px inset gives a negative radius, and arc() throws on one
    const r=Math.max(6,Math.min(W,Hh)/2-1), cy=y+h/2;
    shell(()=>ctx.arc(cx,cy,r,0,7));
    // s.spinV is the PLANT's flux, so the rate is that machine's own and the phase is keyed per pump
    { const still = !L || dead, dpf = still?0:L.spinV*pumpSpinK(L,id)*frameDt();
      spinVane(cx,cy,r, !L?0 : dead?fxIdPhase(id)*360 : aliasStep("spin:"+id,spinRate(dpf),360).ph,
               dpf, ink); }
    if(L&&L.cav>.15){ ctx.beginPath(); ctx.arc(cx,cy,r+3,0,7); ctx.strokeStyle=C.amber;
      ctx.lineWidth=1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); }
    // on the same 0..0.6 the CAVITATION readout's band uses
    if(L) fxBubbles(cx-r,cy-r,r*2,r*2,fxEase(id+":cav",dead?0:clamp(L.cav/.6,0,1)),C.amber,"chan");
  } else if(p.role==="turb"){
    shell(()=>{ ctx.moveTo(X,Y+3); ctx.lineTo(X+W,Y-2); ctx.lineTo(X+W,Y+Hh+2);
      ctx.lineTo(X,Y+Hh-3); ctx.closePath(); });
    // drawn from the front: the vanes lean one way and the rotor blades the other, or a ring of spokes reads as a wheel
    const cyT=y+h/2, rT=Math.max(6,Math.min(W,Hh)/2-1);
    fillRect(X,cyT-1,W,2,"rgba(140,170,178,.45)");            // the shaft, through
    shell(()=>ctx.arc(cx,cyT,rT,0,7));
    const r0=rT*.70, r1=rT*.94;
    ctx.save(); ctx.strokeStyle="rgba(140,170,178,.55)"; ctx.lineWidth=1;
    for(let i=0;i<10;i++){ const a=i*.6283;                    // STATOR - fixed
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*r0,cyT+Math.sin(a)*r0);
      ctx.lineTo(cx+Math.cos(a+.26)*r1,cyT+Math.sin(a+.26)*r1);
      ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.translate(cx,cyT);
    // six blades, so the rotor repeats every 60 degrees - see aliasStep() (pipes.js)
    ctx.rotate((L?(dead?fxIdPhase(id)*360:aliasRate("spinT",L.spinTV,60).ph):0)*Math.PI/180);
    ctx.strokeStyle=ink; ctx.lineWidth=2.2; ctx.lineCap="round"; // ROTOR - turns
    for(let i=0;i<6;i++){ const a=i*1.0472;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*rT*.14,Math.sin(a)*rT*.14);
      ctx.lineTo(Math.cos(a-.5)*rT*.64,Math.sin(a-.5)*rT*.64);
      ctx.stroke(); }
    ctx.restore();
    dot(cx-2,cyT-2,4,ink);                                     // the hub
  } else if(p.role==="radiator"){
    // a blind panel radiates nothing at all, so the verdict goes on the box
    const blind=!radLive(p.id);
    const hot=blind?0:clamp((radTOf(L,p.id)-RAD_TDES)/60,0,1);
    if(hot>0) fillRect(X,Y,W,Hh,"rgba(255,150,90,"+(0.06+0.30*hot).toFixed(2)+")");
    for(let i=1;i<W/7;i++) fillRect(X+i*7,Y+3,2,Hh-6,
      blind?"rgba(184,196,207,.18)":"rgba(184,196,207,.55)");
    if(!blind){ ctx.save(); ctx.strokeStyle="rgba(255,150,90,"+(0.15+0.55*hot).toFixed(2)+")";
      ctx.lineWidth=1;
      for(let i=0;i<4;i++){ const yy=Y+Hh*0.2+i*Hh*0.2;
        ctx.beginPath(); ctx.moveTo(X+3,yy); ctx.lineTo(X+W-3,yy); ctx.stroke(); }
      ctx.restore(); }
    else { hatch(X,Y,W,Hh,C.amber,.22); frame(X,Y,W,Hh,C.amber);
      // one word: clipTxt() truncates, and a cut label is a different label
      clipTxt("BLIND",X+W/2,Y+Hh/2+2,W-6,
        {size:6.5,sp:.6,step:false,align:"center",color:C.amber}); }
  } else if(p.role==="cond"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    for(let i=1;i<7;i++) fillRect(X+i*(W/7),Y+5,1,Hh-10,"rgba(140,170,178,.45)");
    // the hotwell is a hosted tank with no cell of its own, so the machine it lives inside draws it; two pool as one
    const hosted=hostedTankIds();
    const hwPct = L ? tankPoolPct(L,hosted)
                    : (hosted.length ? D.tanks[hosted[0]].level : 0);
    const hw=Math.max(3,Hh*.5*clamp(hwPct/100,0,1));
    ctx.save(); ctx.globalAlpha=.45;
    fillRect(X+1,Y+Hh-2-hw,W-2,hw,C.blue); ctx.restore();
    if(L){ ctx.save(); ctx.beginPath(); ctx.rect(X,Y+2,W,Hh-4-hw); ctx.clip();
      fxJet(cx,Y+6,W*.62,fxEase(id+":cond",clamp(Math.min(L.n,L.load),0,1)*.8),"rgba(150,195,225,.95)",0,1,23);
      ctx.restore(); }
    // held high in the shell, so the rising water never reaches the word
    if(L&&annLit("HOTWELL HI"))
      banner("HOTWELL HI",cx,X,Y+2,W,Hh-4,C.red,Y+14);
  } else if(p.role==="ctrl"){
    shell(()=>{ ctx.moveTo(X,Y+Hh); ctx.lineTo(X,Y+6); ctx.lineTo(X+W,Y+2);
      ctx.lineTo(X+W,Y+Hh); ctx.closePath(); });
    const dark = L && L.blackout;
    for(let i=0;i<3;i++) fillRect(X+6+i*((W-12)/3),Y+9,(W-18)/3,4,
      dark?"rgba(255,90,69,.40)":"rgba(95,210,226,.45)");
    fxPulse(X+2,Y+4,W-4,Hh-8,C.red,fxEase(id+":dark",dark?1:0),0.7);
  } else if(p.role==="fitting"){
    const mode=fitModeOf(id);
    // the box is the CASING and the opening the BORE, the same sentence the pipe stroke makes, drawn front-on
    const {fw,fh}=fitGlyphWH(id,w,h);
    if(mode==="relief" && L) reliefBowtie(cx,y+h/2,fw,fh,L,id);
    else if(mode==="throttle" && L && (L.valve[id]??1)<0.005) throttleShut(cx,y+h/2,fw,fh);
    else fitGlyph(cx,y+h/2,fw,fh,mode,ink);
    // what the VALVE is passing, judged against its own fully-open rate, piped or not: where the discharge goes is a separate question
    if(L && mode==="relief")
      fxSteam(cx,y+4,W*.7,fxEase(id+":porv",
        clamp(reliefRate(L,id)/Math.max(1e-9,reliefFullRate(L,id)),0,1)),"#cfe6ea");
  } else if(p.role==="vent"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    const r=Math.min(W,Hh-4)/2-3, a=L&&!L.blackout&&!dead?fxClock()*2.2:0;
    ctx.save(); ctx.translate(cx,y+h/2); ctx.rotate(a);
    ctx.strokeStyle=ink; ctx.lineWidth=1.5;
    for(let i=0;i<3;i++){ ctx.rotate(Math.PI*2/3);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(r*.7,-r*.4,r,0); ctx.stroke(); }
    ctx.restore();
    line(cx,y+2,cx,y-2,ink,1.5);
  } else if(p.role==="tank"){
    // a source alarms when it is EMPTY and a sink when it is FULL, and which it is is structural, never a name
    const lv = L ? tankLvl(L,id) : D.tanks[id].level;
    const rate = L ? ((L.tankRate&&L.tankRate[id])||0) : 0;
    const src = !(tankPrimary(id) && !D.tanks[id].check);
    // a vessel that holds pressure gets a second inset hoop and domed ends; an open tank keeps the plain shell
    const TX=x+1, TY=y+1, TW=w-2, TH=h-2;
    if(tankHeld(id) && TW>10 && TH>16){
      ctx.beginPath(); rr(TX+2.5,TY+2.5,TW-5,TH-5,7);
      ctx.strokeStyle=ink; ctx.lineWidth=1; ctx.globalAlpha=.55; ctx.stroke(); ctx.globalAlpha=1;
    }
    // the rate comes off the solve, so it sits on ±1e-15 at rest: tankInjecting() is the floor the sim judges by
    tank(TX,TY,TW,TH,tankRad(id), lv/100,
      tankInjecting(id,rate) ? C.cyan
      : src ? (lv<=15 ? C.red : lv<50 ? C.amber : C.blue)
            : (lv>=SINK_RED ? C.red : lv>SINK_AMB ? C.amber : C.blue),
      tankHeld(id) ? C.amber : null);
    // on what the tank is ACTUALLY pushing, never the operator's switch: injection is a solved flow
    if(L) fxJet(cx,TY+TH-3,TW*.35,
      fxEase(id+":inj",clamp(rate/tankRateRef(id),0,1)),C.cyan,0,1,71);
    // burst, the tank is an opening to containment, so it stops being a tank and says so
    if(L&&L.burstBy&&L.burstBy[id]) hatch(TX+1,TY+1,TW-2,TH-2,C.red,.55);
    if(L&&tankHold(id)&&annLit("HI PRESS"))
      banner("HI PRESS",cx,TX,TY,TW,TH,C.red,TY+TH-7);
  } else if(p.role==="bkp"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    fillRect(X+4,Y+6,W-8,3,ink);
    // how much pump flow this set can turn, as cells
    const cap = L? P.backup : BKP[D.bkp].bk;
    const dead = L && (L.bkpLost || !(P.backup>0));
    const bx2=X+4, by2=Y+Hh-13, bw2=W-8, n=6, cw2=bw2/n;
    for(let i=0;i<n;i++){
      const lit=(i+.5)/n<=clamp(cap,0,1);
      fillRect(bx2+i*cw2,by2,cw2-1.4,5, !lit?C.well : dead?"#3a1a14" : C.green);
    }
    // carrying the pumps right now, not merely able to
    if(L) fxPulse(bx2,by2,bw2,5,C.green,fxEase(id+":bkp",L.blackout&&!dead&&cap>0?1:0),1.4);
  } else if(p.role==="inert"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    const bw3=(W-8)/3;
    for(let i=0;i<3;i++){ const bx3=X+4+i*bw3+1;
      ctx.strokeStyle=ink; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.rect(bx3,Y+8,bw3-3,Hh-14); ctx.stroke();
      line(bx3+(bw3-3)/2,Y+8,bx3+(bw3-3)/2,Y+4,ink,1.4); }
  } else if(p.role==="pan"){
    ctx.strokeStyle=ink; ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.moveTo(X+1,Y+3); ctx.lineTo(X+1,Y+Hh-3);
    ctx.lineTo(X+W-1,Y+Hh-3); ctx.lineTo(X+W-1,Y+3); ctx.stroke();
    line(cx,Y+Hh-3,cx,Y+Hh+3,ink,1.8);
  } else {
    shell(()=>ctx.rect(X,Y+2,W,Hh-4)); hatch(X+1,Y+3,W-2,Hh-6,"#6d8f98",.5);
  }
}

// a sink tank's two warning levels, % full
const SINK_AMB=50, SINK_RED=75;
const CORE_DIA_REF=2.9, CORE_HGT_REF=3.1, CORE_MIN=0.3;
const REFLC=[null,C.metal,C.ink,C.graph];
function coreDraw(x,y,w,h,V){
  if(w<=0||h<=0) return;
  const fw=w*clamp(V.dia/CORE_DIA_REF,CORE_MIN,1);
  const fh=h*clamp(V.hgt/CORE_HGT_REF,CORE_MIN,1);
  const fx=x+(w-fw)/2, fy=y+(h-fh)/2, col=REFLC[V.reflMat];
  if(col){
    const rc=fw/2/XNR, zc=fh/XNZ;        // one ring across, one level up
    const br=V.reflR*rc, bt=V.reflT*zc, bb=V.reflB*zc;
    ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); ctx.globalAlpha=.3;
    if(br>0){ fillRect(fx-br,fy-bt,br,fh+bt+bb,col);
              fillRect(fx+fw,fy-bt,br,fh+bt+bb,col); }
    if(bt>0) fillRect(fx,fy-bt,fw,bt,col);
    if(bb>0) fillRect(fx,fy+fh,fw,bb,col);
    ctx.restore();
  }
  coreField(fx,fy,fw,fh,V);
}

// the mirrored column arithmetic lives here and nowhere else: 2*XNR-1 columns, level 0 at the bottom
function coreCellGeom(x,y,w,h){
  const NC=XNR*2-1, cw=w/NC, ch=h/XNZ;
  return {NC,cw,ch, rMax:Math.max(0,Math.min(cw,ch)*0.44),
    ring:c=>Math.abs(c-(XNR-1)),
    cx:c=>x+(c+.5)*cw, cy:j=>y+h-(j+.5)*ch};
}
function coreField(x,y,w,h,V){
  // a negative box must not throw: one bad frame takes the whole plant with it
  if(w<=0||h<=0) return;
  const g=coreCellGeom(x,y,w,h), NC=g.NC, cw=g.cw, ch=g.ch, rMax=g.rMax;
  for(let c=0;c<NC;c++){
    const i=g.ring(c);
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), cx=g.cx(c), cy=g.cy(j);
      // the damage wash is the substrate, so it goes down before the xenon rect
      if(V.nDmg){ const st=fuelStage(V,k);
        if(st>0){ ctx.globalAlpha=.16+.16*st;
          fillRect(cx-cw/2,cy-ch/2,cw,ch,FAIL[st].col()); ctx.globalAlpha=1; } }
      if(V.xX){ const a=clamp(V.xX[k]/Math.max(V.X0,1e-9)*.34,0,.6);
        if(a>.02){ ctx.globalAlpha=a; fillRect(cx-cw/2,cy-ch/2,cw,ch,C.xe); ctx.globalAlpha=1; } }
      const t=V.nTf? clamp((V.nTf[k]-V.TfRef)/620,0,1) : 0;
      const col=t<.5? lerpC(C.cyan,C.amber,t*2) : lerpC(C.amber,C.red,(t-.5)*2);
      let r=rMax*Math.sqrt(clamp(V.phi[k]/2.6,.03,1));
      // the one animation in here: a node in film boiling is not steady
      if(t>.85) r*=.72+.28*Math.abs(Math.sin(fxClock()/0.09));
      // fades with how much fuel is in this ring, so a hole stays a hole rather than a smaller full node
      const ff=V.frac? clamp(V.frac[i],0,1) : 1;
      if(ff<.985){ ctx.globalAlpha=.12+.88*ff;
        if(ff<.3) fillRect(cx-1,cy-1,2,2,"#1b2c33"); }   // an empty slot, as in the plan
      // melt is a square, never a stroke: void already owns stroke-vs-fill on this dot
      if((V.nMelt && V.nMelt[k]>0) || (V.nDisp && V.nDisp[k]>0)){ fillRect(cx-r,cy-r,r*2,r*2,col); }
      else {
        ctx.beginPath(); ctx.arc(cx,cy,r,0,7);
        if(V.nV && V.nV[k]>.12){ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.7,r*.55); ctx.stroke(); }
        else { ctx.fillStyle=col; ctx.fill(); }
        // a burst pin: one short slash through the dot, on its own channel
        if(V.nDmg && V.nDmg[k]>0){
          ctx.beginPath(); ctx.moveTo(cx-r,cy+r); ctx.lineTo(cx+r,cy-r);
          ctx.strokeStyle=C.bg; ctx.lineWidth=Math.max(.6,r*.35); ctx.stroke(); }
      }
      ctx.globalAlpha=1;
      // bright rather than red: colour already means margin on this dot
      if(V.peak && i===V.peak.i && j===V.peak.j){
        ctx.beginPath(); ctx.arc(cx,cy,Math.max(r+1.6,rMax*.85),0,7);
        ctx.strokeStyle=C.bright; ctx.lineWidth=.8; ctx.globalAlpha=.75;
        ctx.stroke(); ctx.globalAlpha=1;
      }
    }
  }
  for(let b=0;b<V.NB;b++){
    const ins=V.rodZ? clamp(V.rodZ[b],0,1) : .35, tip=XNZ*(1-ins);
    for(const sg of [-1,1]){
      const cx=g.cx((XNR-1)+sg*V.bankR[b]), yTip=y+h-tip*ch;
      if(yTip>y) fillRect(cx-.9,y,1.8,yTip-y,C.metal);              // absorber
      const yF=Math.min(y+h,yTip+V.tipLen*ch);
      if(V.tipLen>0 && yF>yTip)                                     // follower
        frame(cx-1.5,yTip,3,yF-yTip,V.tipRho>0?C.graph:C.rail);
    }
  }
}

// one break for both readers: the draw needs the lines, valueBase() how far down they reach
const NAME_TXT={size:6.5*DRAW_K,sp:.4*DRAW_K,step:false,align:"center"};
const NAME_LH=capH(NAME_TXT.size)+4*DRAW_K;
const nameInner=w=>w-14*DRAW_K;        // held clear of the case and its corner radius
const nameLines=(s,w)=>wrapLines(s,nameInner(w),NAME_TXT);
// the lowest pixel the plate reaches, off the same first baseline the draw uses
const nameBot=(s,y,w,nameH)=>y+nameH+(nameLines(s,w).length-1)*NAME_LH;
// on the machine's own name row, centred on the CAPS; both marks are one point, one radius
const MARK_R=4*DRAW_K;
const nameMark=(x,y,nameH)=>({x:x+10*DRAW_K,
  y:y+(nameH? nameH-3*DRAW_K-capH(NAME_TXT.size)/2 : 11*DRAW_K)});

// extra: room for the rows BELOW the first, so a label that breaks is one plate
function txtPlate(cx,base,w,size,extra,col){
  const c=capH(size);
  fillRect(cx-w/2-3,base-c-2,w+6,c+5+(extra||0),col||"rgba(6,10,11,.88)");
}

// maxw optional: given, the tag steps DOWN the type ladder to fit it
function tag(s,cx,base,size,sp,col,maxw){
  const o={size,sp};
  if(maxw) o.size=fitStep(s,maxw,o);
  const w=tw(s,o), Lx=GX+2, Rx=GX+GW*CELL-2;
  cx=clamp(cx,Lx+w/2,Rx-w/2);
  txtPlate(cx,base,w,o.size);
  txt(s,cx,base,{size:o.size,sp,align:"center",color:col});
}

const BANNER_LH=capH(9)+7;
// rows are [word,colour] WORST FIRST, the caller's job: the tail is dropped rather than run over the machine below
function bannerRows(rows,cx,x,y,w,h,ty){
  rows=rows.filter(r=>r);
  if(!rows.length) return;
  const fit=Math.max(1,Math.floor((h-4)/BANNER_LH));
  if(rows.length>fit) rows=rows.slice(0,fit);
  frame(x,y,w,h,rows[0][1]);
  const mw=w-4;
  // ty lifts the word off something already drawn across the middle of the box; the frame is unaffected
  let base=(ty!=null?ty:midBase(y,h,9))-BANNER_LH*(rows.length-1)/2;
  for(const r of rows){
    // letter spacing goes first: the type ladder has a floor, so track it tight before shrinking
    const sp = tw(r[0],{size:9,sp:2})<=mw ? 2 : .3;
    tag(r[0],cx,base,9,sp,r[1],mw);
    base+=BANNER_LH;
  }
}
const banner=(word,cx,x,y,w,h,col,ty)=>bannerRows([[word,col]],cx,x,y,w,h,ty);

// off the SOLVED edge flow, so the plume and the RELIEF FLOW readout cannot describe a vent the sim is not performing
const porvRate = s => { const fid=primaryRelief(); return fid ? reliefRate(s,fid) : 0; };

function liveValue(p,s){
  const H_=s.Tavg+15*(s.n*PROMPT_F+s.decay);
  switch(true){
    // the chain reaction, then the four decay groups summed on top
    case p.role==="core":  { const c=coreSeen(s,p.id); return (c.n*100).toFixed(0)+"%"+(c.decay*100>=.05?" (+"+(c.decay*100).toFixed(1)+"%)":""); }
    case p.role==="rods":  return (coreSeen(s,coreOf(p.id)).rodPos*100).toFixed(0)+"%";
    case p.role==="sg":          return sgLvl(s,p.id).toFixed(0)+"%";
    case p.role==="ihx":         return ((S.ihxQBy&&S.ihxQBy[p.id]||0)/1000).toFixed(0)+" MW";
    case roleHead(p.role): return (flowOf(s,p.id)*100).toFixed(0)+"%";
    case p.role==="turb": return mwE(s).toFixed(0)+" MWe";
    case p.role==="radiator": return (radRejOf(s,p.id)/1000).toFixed(0)+" MW";
    case p.role==="cond": return tankPoolPct(s,hostedTankIds()).toFixed(0)+"%";
    // null rather than a word for the ordinary case; the PLACE stays, so the REPAIR key keeps its anchor
    case p.role==="bkp":   return s.blackout?"LOAD":null;
    case p.role==="pan":   { const kg=s.panBy[p.id]||0;
      return kg>0 ? (kg/1000).toFixed(1)+" t" : null; }
    case p.role==="ctrl":  return s.dose.toFixed(0)+"%";
    // a burst disc first: a tank that is an opening to containment is not reporting a level
    case p.role==="tank": return s.burstBy[p.id] ? "BURST"
      : tankHold(p.id) ? loopP(s,tankCircuit(p.id)).toFixed(1)+" MPa"
      /* the charge is what makes the vessel push, so it belongs on the box beside the level */
      : tankLvl(s,p.id).toFixed(0)+"%"+(D.tanks[p.id].gas ? "  "+tankP(s,p.id).toFixed(1)+" MPa" : "");
    default: return null;
  }
}

// a text BASELINE, always centred on the box; null means the machine already says it in its own picture
const VAL_TXT_SIZE=8*DRAW_K;
function valueBase(p,x,y,w,h,sh,nameH,nmw){
  const symTop=y+nameH, symH=h-sh-nameH, mid=symTop+symH/2+3*DRAW_K;
  switch(true){
    case p.role==="rods": return null;
    // the two machines drawn front-on: the wheel is the machine, so the number goes on it
    case p.role==="turb":
    case roleHead(p.role): return mid;
    case p.role==="core":   return symTop+symH-20*DRAW_K+9*DRAW_K;   // under the vessel's inner box
    case p.id==="pzr":    return PZR_DIAL_CY(y)+PIPE_DIAL_R+10*DRAW_K;  // under its own dial
    case p.role==="sg":   return symTop+12*DRAW_K+(symH-12*DRAW_K)/2+3*DRAW_K;  // mid SHELL, not mid box
    case p.role==="bkp":
    case p.role==="cond":
    case p.role==="radiator": return mid;
    // a tank's symbol takes the whole footprint, so this is the middle of the BOX, driven down off the name block
    case p.role==="tank":
      return Math.max(y+h/2+3*DRAW_K,
                      nameBot(nmw,y,w,nameH)+3*DRAW_K+capH(VAL_TXT_SIZE));
    default: return y+h+9*DRAW_K;
  }
}

// mirrors commission()'s formula because ctlFor() is also called on the bench, with P still null
const pumpFloor=()=>P? P.flowMin : clamp(0.30+0.15*(corePumpCap()-sgCount()),0.15,0.75);
// a WARNING threshold only: what costs a pump its head is its own suction going to vapour
const SUC_LOW=10;
const pumpTip=()=>"Primary flow. More flow carries heat away faster and directly buys DNBR margin; less flow heats the fuel and eventually boils the core. The pumps have inertia, so flow follows demand over about "+FLOW_TAU+" s and coasts on the rotor - half speed "+(2*PUMP_ROTOR_S)+" s after the power goes. The pumps can be stopped completely: the red line on the track is the "+(pumpFloor()*100).toFixed(0)+"% floor the pumps were built for, and the protection system trips on LOW FLOW below it. Defeat the protection and nothing stops you - the core is left on buoyancy alone. The thin amber line is demand, the thumb is what the loop has.";
// the same span the boron slider covers, so a key can never ask for a demand the slider could not be dragged to
const BOR_STEP=200, BOR_LO=-6000, BOR_HI=0;
// the bench has no S: the keys label off the commissioned figure the slider draws there
const borNow=()=>S?S.boronDem:clamp(derived().boronOp,BOR_LO,BOR_HI);
const borStep=dir=>clamp(borNow()-dir*BOR_STEP,BOR_LO,BOR_HI);
// the CLAMPED step, so a key against the end of its travel says nothing is left
const borDelta=dir=>borStep(dir)-borNow();
const borLabel=dir=>{ const d=borDelta(dir);
  return (d>0?"+":"")+d.toFixed(0)+" pcm"; };
// one step for every percentage control, landing on the 5% GRID rather than adding 5 to where the demand sits
const PCT_STEP=5;
// not a tolerance, the float grid's own error: 0.55*100 is 55.00000000000001
const PCT_EPS=1e-9;
function pctStep(cur,dir,lo,hi){
  const g=cur*100/PCT_STEP;
  return clamp((dir>0?Math.floor(g+PCT_EPS)+1:Math.ceil(g-PCT_EPS)-1)*PCT_STEP/100,lo,hi);
}
const ROD_TRIP_ROW=[  // shared: GANG and SPLIT both push this SCRAM/RESET row, or two copies drift
  {kind:"btn",flex:1,danger:()=>true,text:()=>"SCRAM",
   fn:()=>{ act("scram"); },
   tip:"SCRAM - drops every bank, split or not, and trips the turbine with it. Always safe, never free: the xenon that follows locks you out for minutes."},
  {kind:"btn",flex:1,on:()=>S.scrammed,text:()=>"RESET",
   fn:()=>{ act("resetTrip"); },
   tip:"TRIP RESET - clears the latch after a scram so the bank answers demand again. With protection armed it refuses while a trip condition is still present. Bypass the RPS and it clears anyway."}];
// live=false asks the DESIGN question, so nothing in the structure may read S - only the closures
// the valve and the dump are ONE row, one decision about the same line; the arm switch only for a tank with a rule
function tankCtl(id){
  const t=()=>D.tanks[id]||{}, rule=()=>AUTORULE[t().auto];
  const valve=
    {kind:"btn",flex:1,k:id+":tankOpen",def:false,words:["SHUT","OPEN"],on:()=>S.tankOpen[id],text:()=>S.tankOpen[id]?"OPEN":"SHUT",
     fn:()=>{ act("tankOpen",id); },
     tip:"TANK VALVE - lines this tank up with what it is piped to. It is "
       +(tankPrimary(id)
         ? "a solved flow: full loop pressure against a tank charged below it delivers exactly nothing, and a depressurised loop takes a surge."
         : "drawn on by the feed pumps.")
       +" Its automatic rule is "+(rule()?rule().label:"none")+", which opens it without you."};
  const dump=
    // dumping is only dangerous for a tank you DRAW ON: a sink is a tank you WANT empty
    {kind:"btn",flex:1,k:id+":tankDump",def:false,words:["DUMP","DUMP"],on:()=>S.tankDump[id],
     danger:()=>S.tankDump[id] ||
       (!(tankPrimary(id) && !t().check) && tankLvl(S,id)<SUC_LOW),
     text:()=>"DUMP",
     fn:()=>{ act("tankDump",id); },
     tip:"TANK DUMP - puts the contents over the side. This is the answer to a ruptured tube filling a hotwell with primary water, which has to go somewhere and must not go back into the generators. It never refuses: open it on a healthy plant and you are throwing away the water the feed pumps live on, and they lose suction under "+SUC_LOW+"%."};
  // the same `arm` kind a system's bypass row is: green ARMED against amber BYPASSED
  const arm=
    {kind:"arm",flex:1,k:id+":tankByp",def:false,name:"TANK AUTO",label:()=>rule()?rule().label:"AUTO",on:()=>S.tankByp[id],
     fn:()=>{ act("tankByp",id); },
     title:()=>"TANK AUTO  [ "+(S.tankByp[id]?"BYPASSED":"ARMED")+" ]",
     tip:"AUTO / BYP - whether this tank's own rule ("+(rule()?rule().label:"none")
       +") may line it up without being asked. Bypassed, only the valve beside it does anything. The switch is on the TANK because the rule is the tank's: there is no system elsewhere on the plant that owns it."};
  const hasRule = t().auto && t().auto!=="manual" && t().auto!=="always";
  return hasRule ? [[valve,dump],[arm]] : [[valve,dump]];
}
// D.start[k] is where an actuator stands on entry; a cell with no `k` is MOMENTARY
// the bench writes D.start directly, never act(): a design edit must not land on the tape as a crew action
function benchCell(c){
  const o=Object.assign({},c);
  const sc=c.sc||1;
  if(!c.k){                          // momentary: nothing to set, so it draws dead
    o.fn=()=>{}; o.set=()=>{};
    o.on=()=>false; o.danger=()=>false;
    // `bench` is for a control whose starting position is COMMISSIONED rather than chosen
    if(c.kind==="sld"){ o.val=c.bench||(()=>0); o.dem=null; o.min=c.min; o.max=c.max; o.inert=true; }
    return o;
  }
  if(c.kind==="sld"){
    o.val=()=>startOf(c.k,c.def)*sc; o.dem=()=>startOf(c.k,c.def)*sc;
    o.set=v=>{ D.start[c.k]=(c.step?Math.round(v/c.step)*c.step:v)/sc; };
    o.mark=c.mark; o.marks=null;
  } else {
    const on=()=>!!startOf(c.k,c.def);
    o.on=on; o.danger=()=>false;
    if(c.words) o.text=()=>c.words[on()?1:0];
    if(c.label) o.label=c.label;
    // the same sentence the live switch builds off S, built here off the starting position
    if(c.kind==="arm") o.title=()=>(c.name||"")+"  [ "+(on()?"BYPASSED":"ARMED")+" ]";
    o.fn=()=>{ D.start[c.k]=!on(); };
  }
  return o;
}
const ctlBench=rows=>rows&&rows.map(r=>r.map(benchCell));
// the same cell shape benchCell() makes, so the strip still measures: nothing is hidden, it just does not answer
const deadCell=c=>{ const o=Object.assign({},c);
  o.fn=()=>{}; o.set=()=>{}; o.on=()=>false; o.danger=()=>false; o.inert=true;
  if(c.kind==="arm") o.label=c.label||(()=>"");
  return o; };
// a nozzle valve is its own part, and isolating a wreck is what you reach for
const ctlDead=rows=>rows&&rows.map(r=>r.map(c=>c.ownPart?c:deadCell(c)));
// said in the NAME, which is always drawn: a stood-down valve must not go away with the control that set it
function partStateWord(p){
  if(p.role==="fitting"){
    const mode=fitModeOf(p.id);
    if(mode==="relief")
      return S.reliefBlocked[p.id] ? "BLOCKED"
           : S.reliefOpen[p.id]    ? "OPEN"
           : (!fitSpring(p.id) && !sinkDriver(S,"relief",p.id)) ? "BYP" : null;
    if(mode==="throttle") return (S.valve[p.id]??1)<0.005 ? "SHUT" : null;
    return null;
  }
  // no AUTOSYS row to look these up in any more, so the two are asked directly
  if(p.role==="ctrl"  && rpsState()==="BYPASSED") return "BYP";
  if(p.role==="turb"  && sinkWired(S,"runback",null) && !runbackLive()) return "BYP";
  return null;
}
function ctlBase(p,live,split){
  if(p.role==="tank") return tankCtl(p.id);
  // one load lever, on the FIRST turbine: load demand is an order to the plant, not to a machine
  if(p.role==="turb"){
    if(LAY.parts.find(q=>q.role==="turb")!==p) return null;
    return [
     // always the DESIGN's own ceiling: P is the last plant commissioned, so on the bench it is the wrong machine
     [{kind:"sld",flex:1,k:"loadDem",def:1,sc:100,val:()=>S.load*100,min:()=>0,max:()=>derived().loadMax*100,dem:()=>S.loadDem*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{ act("loadDem",v/100); },
       tip:"LOAD DEMAND - turbine draw. Raising it cools the loop, and the reactor answers by raising its own power without you touching a rod. The governor valves take about "+LOAD_TAU+" s to stroke, so the thumb trails the thin line. A runback is the exception and slams shut."}],
     // the same 5% bite the rod strip takes, against the same demand the slider writes
     [{kind:"btn",flex:1,text:()=>"-5%",fn:()=>{ act("loadDem",pctStep(S.loadDem,-1,0,P.loadMax)); },
       tip:"UNLOAD 5% - drops turbine demand five percent, onto the nearest 5% mark. Less draw means less heat leaving the loop, so the primary warms and the reactor backs its own power off."},
      {kind:"btn",flex:1,text:()=>"+5%",fn:()=>{ act("loadDem",pctStep(S.loadDem,1,0,P.loadMax)); },
       tip:"LOAD 5% - raises turbine demand five percent, onto the nearest 5% mark, and never past the turbine's own ceiling. More draw cools the loop and the reactor answers by raising power."}]];
  }
  // one row per hosted tank, on the FIRST condenser only, or two condensers each draw a copy of the same hotwell's strip
  if(p.role==="cond"){
    if(hostPartOf()!==p) return null;
    const h=hostedTankIds(); if(!h.length) return null;
    const out=[]; for(const id of h) for(const r of tankCtl(id)) out.push(r); return out;
  }

  // one strip for every pump; what it ADDRESSES is the only difference, and the floor is a trip setpoint, not a stop
  if(roleHead(p.role)){
    const pri = primaryPump(p.id);
    return [[
    // the DEFAULT is the machine's own, so the bench draws a standby train stopped rather than at rated
    {kind:"sld",flex:1,k:pri?"flowDem":p.id+":pumpDem",def:pri?1:pumpDem0(p.id),sc:100,
     val:()=>(pri?flowPri(S):flowOf(S,p.id))*100,min:()=>0,max:()=>100,
     dem:()=>(pri?flowDemPri(S):(S.flowDemBy[p.id]??pumpDem0(p.id)))*100,
     // the mark is the TRIP, so it stands on any pump the CORE's own circuit carries
     mark:()=>corePump(p.id)?pumpFloor()*100:null,markLo:true,
     fmt:v=>v.toFixed(0)+" %",
     set:v=>{ pri ? act("flowDem",v/100) : act("pumpDem",p.id,v/100); },
     tip:(pri?"COOLANT PUMPS - "+pumpTip()
            :"THIS PUMP ONLY - what it is told to deliver. It develops its own head at its own speed, exactly like the coolant pumps; what it does not answer to is their one lever.")}]];
  }
  // a TEE gets nothing at all, and that is the point of a tee: a junction has no gate
  if(p.role==="fitting"){
    const mode=fitModeOf(p.id);
    if(mode==="tee") return null;
    if(mode==="throttle") return [[
      {kind:"sld",flex:1,k:p.id+":valve",def:1,sc:100,val:()=>(S.valve[p.id]??1)*100,min:()=>0,max:()=>100,
       dem:()=>(S.valveDem[p.id]??1)*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{ act("valveDem",p.id,v/100); },
       tip:"THROTTLE - how far this valve stands open. Wide open it costs the line nothing at all; shut, it is a real break in the pipe, the same as a valve shut anywhere else."}]];
    // one row per handle: two switches this narrow lose their labels before they lose their state
    return [
     // OPEN / SHUT, the same two words every other valve wears; the key reports where the block valve stands
     [{kind:"btn",flex:1,k:p.id+":porvBlock",def:false,words:["OPEN","SHUT"],
       danger:()=>!!(S.reliefBlocked&&S.reliefBlocked[p.id]),
       on:()=>!!(S.reliefBlocked&&S.reliefBlocked[p.id]),
       text:()=>(S.reliefBlocked&&S.reliefBlocked[p.id])?"SHUT":"OPEN",
       fn:()=>{ act("porvBlockOf",p.id); },
       tip:"BLOCK VALVE - your last defence against a relief valve that lifts and will not reseat. Shutting it stops the leak and gives this relief path up for the rest of the run."}]]
  }
  switch(p.role){
    case "rods": {
      // this vessel's own drives: every order is the addressed act and every reading is coreSeen()
      const cid=coreOf(p.id), cS=()=>coreSeen(S,cid);
      split = live && !!cS().split;
      // no master slider: ganging is what happens to an INPUT, so a ganged bank goes through act("rodCommon")
      const STEP=[
       {kind:"btn",flex:1,text:()=>"-5%",fn:()=>{ act("coreRodDem",cid,pctStep(cS().rodDem,-1,0,1)); },
        tip:"WITHDRAW 5% - takes the whole stack five percent of core height further out, onto the nearest 5% mark. Withdrawing adds reactivity, so power rises until the loop settles."},
       {kind:"btn",flex:1,text:()=>"+5%",fn:()=>{ act("coreRodDem",cid,pctStep(cS().rodDem,1,0,1)); },
        tip:"INSERT 5% - drives the whole stack five percent of core height further in, onto the nearest 5% mark. Deeper insertion removes reactivity and raises power peaking, which eats thermal margin."}];
      // ganged, a bank's slider IS the common one; split, each addresses its own bank
      const bankRow=b=>[
       {kind:"btn",flex:1,k:"bankAuto:"+b,def:false,words:["AUT","MAN"],on:()=>!cS().bankAuto[b],text:()=>cS().bankAuto[b]?"AUT":"MAN",
        fn:()=>{ act("coreBankAuto",cid,b); },
        tip:"BANK "+(b+1)+" MODE - hands this bank to the temperature controller, or takes it back. On MANUAL the bank stops answering the controller, but it still answers you: its own slider still moves it, ganged or split. Every bank you take off AUTO leaves the same temperature error to be answered by less rod worth, so the loop does not just move less, it moves slower."},
       {kind:"sld",flex:2.8,k:split?"rodBank:"+b:"rodCommon",def:RODX0,sc:100,min:()=>0,max:()=>100,
        val:()=>(split?cS().rodZ[b]:cS().rodPos)*100,
        dem:()=>(split?cS().rodZDem[b]:cS().rodDem)*100,
        // only while the controller is actually driving: a band drawn for a bypassed system describes nobody
        marks:()=>sinkDriver(S,"rodStep",cid)?[S.arLo*100,S.arHi*100]:null,
        fmt:v=>"B"+(b+1)+" "+v.toFixed(0)+" %",
        set:v=>{ split ? act("coreRodBank",cid,b,v/100) : act("coreRodDem",cid,v/100); },
        tip:"BANK "+(b+1)+" - insertion of this bank. GANGED, moving it carries every bank by the same amount and the whole stack goes with it. SPLIT, it is this bank alone, and standing one bank against another is the whole of how you answer a radial xenon tilt here. It moves a bank on MANUAL too - MANUAL only means the temperature controller is not driving it. The stack travels at only 1.2%/s. The two amber marks are the travel band the automatic controller may move inside; they are drawn only while it is armed, and they never bind you."}];
      if(split){
        const rows=[STEP, ROD_TRIP_ROW,
         [{kind:"btn",flex:1,on:()=>cS().reGang,
          text:()=>cS().reGang?"GANGING..":"BANK GANG",
          // already a no-op once the walk is running: setSplit() refuses to re-seed a gang mid-walk
          fn:()=>{ act("coreSplit",cid,false); },
          tip:"GANG BANKS - drives every bank back onto one common position and gives the shape back to the tilt slider. It is not a flick of a switch: the banks walk together at drive rate and stay split until they arrive, so a wide spread costs you the seconds it takes to close. A bank slider still steers the walk while it runs."}]];
        for(let b=0;b<(live?P.cores[cid].NB:coreBag(cid).nbank);b++) rows.push(bankRow(b));
        return rows;
      }
      const rows=[
       STEP,
       ROD_TRIP_ROW,
       // the ganged handle on a radial xenon tilt: inner banks against outer ones
       [{kind:"sld",flex:2.8,k:"tiltDem",def:0,val:()=>cS().tilt,min:()=>-1,max:()=>1,dem:()=>cS().tiltDem,
         fmt:v=>"TILT "+(v>=0?"+":"")+v.toFixed(2),set:v=>{ act("coreTiltDem",cid,v); },
         tip:"TILT TRIM - drives the inner banks against the outer ones, up to "+(XTILTZ*100).toFixed(0)+"% of core height apart. Positive pushes the inner banks in and the power out to the ring; negative does the reverse. Full travel takes "+(1/tiltRate()).toFixed(0)+" s because the drives moving it are the drives that move the bank. It is your tilt handle only while the banks are ganged - split them and each bank's own demand takes over."},
        {kind:"btn",flex:1,text:()=>"SPL",
         fn:()=>{ act("coreSplit",cid,true); },
         tip:"SPLIT BANKS - stops driving the banks as one and gives each its own demand. Splitting is bumpless by construction: every bank simply adopts where it already stands. From there the tilt slider stands down, the per-bank sliders are your tilt handle, and any bank you switch to MANUAL stops answering the temperature controller."}]];
      for(let b=0;b<(live?P.cores[cid].NB:coreBag(cid).nbank);b++) rows.push(bankRow(b));
      return rows;
    }
    case "core": return [
     // the scale runs 0 -> -6000, clean water at the LEFT, so "+B" drives the thumb right
     [{kind:"sld",flex:1,val:()=>S.boron,min:()=>0,max:()=>-6000,step:10,
       dem:()=>S.boronDem,bench:()=>derived().boronOp,
       fmt:v=>v.toFixed(0)+" pcm",set:v=>{ act("boronDem",v); },
       tip:"BORON - neutron poison dissolved in the coolant. Genuinely slow: the charging pumps borate at "+BOR_IN+" pcm/s and dilute at only "+BOR_OUT+" pcm/s, so the thin line is what you asked for and the thumb is what the loop has. The only way out of a deep xenon pit."}],
     // the same demand the slider writes, in fixed bites, through the same act
     [{kind:"btn",flex:1,text:()=>borLabel(-1),fn:()=>{ act("boronDem",borStep(-1)); },
       tip:"DILUTE "+BOR_STEP+" PCM - takes one step of boron back out, toward clean water. Dilution runs at only "+BOR_OUT+" pcm/s, so this is about "+(BOR_STEP/BOR_OUT).toFixed(0)+" s of charging every time you press it."},
      // the commissioned figure, not zero: RST and the mark on the slider are one number by construction
      {kind:"btn",flex:1,text:()=>"RST "+clamp(derived().boronOp,BOR_LO,BOR_HI).toFixed(0),
       fn:()=>{ act("boronDem",clamp(derived().boronOp,BOR_LO,BOR_HI)); },
       tip:"RESET BORON - back to the "+derived().boronOp.toFixed(0)+" pcm this core was commissioned critical at, which is the mark on the slider above. It does not happen at once: the loop still has to charge or dilute its way there, and dilution runs at only "+BOR_OUT+" pcm/s, so from a deep pit this is minutes, not seconds."},
      {kind:"btn",flex:1,text:()=>borLabel(1),fn:()=>{ act("boronDem",borStep(1)); },
       tip:"BORATE "+BOR_STEP+" PCM - puts one step more poison in. Boration is the fast direction at "+BOR_IN+" pcm/s, about "+(BOR_STEP/BOR_IN).toFixed(0)+" s a press, and every step you add has to be diluted back out again slowly."}]];
  }
  return null;
}

// what the run landing on this nozzle is passing, off this frame's own solve; absolute kg, because a nozzle has no canonical order
function portRunRead(pid,byPort){
  const r=byPort[pid]; if(!r||!P.net) return "";
  const far=partOf(r.pa===pid ? r.b : r.a);
  const kg=pipeRunKg(r.key,r.k,S), pr=pipeRunP(r,S), sc=pipeRunSc(r,S);
  // the break is in the label: the first line is what the nozzle IS, the second what the run is doing
  return (far ? "  "+partName(far) : "")
       + "\n"+Math.abs(kg).toFixed(0)+" kg/s"
       + (pr===null ? "" : "  "+(pr>=10?pr.toFixed(1):pr.toFixed(2))+" MPa")
       + (sc===null ? "" : "  "+sc.toFixed(0)+" K");
}
function portCtlRows(p){
  const cells=[], byPort={};
  for(const c of pipeMap().conns){ byPort[c.pa]=c; byPort[c.pb]=c; }
  for(const pid in D.ports){
    if(D.ports[pid].p!==p.id) continue;
    const f=portFaceOf(pid);
    const nm=(f&&portWord(p,f,false))||FACE_NAME[f]||pid;
    cells.push({kind:"port",flex:1,k:"port:"+pid+":shut",def:false,ownPart:true,
      inert:portWrecked(S,pid),
      on:()=>!portOpen(S,pid),
      danger:()=>!portOpen(S,pid),
      text:()=>nm+" "+(portWrecked(S,pid) ? (portOpen(S,pid)?"JAM OPEN":"JAM SHUT")
                                          : (portOpen(S,pid)?"OPEN":"SHUT"))
              +portRunRead(pid,byPort),
      fn:()=>{ act("portShut",pid); },
      tip:"The isolation valve in this nozzle, and what the run landing on it is carrying: mass flow, the pressure that run is held at, and how far below boiling it is. Shut, the run carries nothing - which is how a leaking line is cut out of the plant, and how a repair party gets a machine to work on. A wrecked nozzle jams where it stood and takes no orders at all."});
  }
  // one container, not a grid of keys: a valve list reads as a list
  return cells.length ? [cells] : [];
}
// a demand a block owns is marked on the machine's own strip, and the key switches that block off
const DRIVEN_TIP="A block in the control room is wired to this demand. Switched ON it owns the demand - the control still draws and still moves, but what it shows is the block's order. Press to switch that block OFF and take the demand back by hand, and press again to hand it back.";
function drivenRows(p){
  const pairs=[], m=D.machines[p.id];
  if(p.role==="rods"&&m&&m.on) pairs.push(["rodStep",m.on]);
  if(p.role==="pump") pairs.push(["flowDem",p.id]);
  // the protection system's own switch, on the vessel it protects
  if(p.role==="core"){ pairs.push(["scram",p.id]); pairs.push(["nearTrip",p.id]); }
  if(p.role==="turb"&&LAY.parts.find(q=>q.role==="turb")===p){ pairs.push(["loadDem",null]); pairs.push(["runback",null]); }
  if(p.role==="sg") pairs.push(["freg",p.id]);
  if(p.role==="tank") pairs.push(["tankOpen",p.id]);
  if(p.role==="fitting"){ const j=P&&P.fittings[p.id];
    if(j&&j.mode==="relief"&&!j.spring) pairs.push(["relief",p.id]);
    if(j&&j.mode==="throttle") pairs.push(["valveDem",p.id]); }
  const cells=[];
  // the key stays on the strip once the block is off, or the one door back to automatic closes behind the hand
  for(const [sink,arg] of pairs){ const id=sinkWired(S,sink,arg); if(!id) continue;
    const lit=()=>!!(S.blkBy[id]&&S.blkBy[id].on);
    // a named block speaks for itself; the sink's label is only there for an unnamed one
    const own=()=>nameFor(id,null);
    cells.push({kind:"btn",flex:1,ownPart:true,on:lit,
      text:()=>(own()||SINK[sink].lab+(lit()?" BY ":" - ")+id.toUpperCase())+(lit()?"":" OFF"),
      fn:()=>{ act("blkOn",id); },tip:DRIVEN_TIP}); }
  return cells.length?[cells]:[];
}
function ctlFor(p,live,split){
  let out=ctlBase(p,live,split);
  // the plant has to be welded down for a valve to have a position at all
  if(live){ const dr=drivenRows(p); if(dr.length) out=(out||[]).concat(dr); }
  if(live){ const pr=portCtlRows(p); if(pr.length) out=(out||[]).concat(pr); }
  return out;
}
// the name row is all the box reserves: every control stands in the machine's own PANEL
const nameRowH = p => (p.role==="tank" || p.h*CELL>CELL) ? 14*DRAW_K : 0;
// a preview of addPortAt(), never a placement of its own; the hand names the CELL, not a face
const GHOSTG=CELL-4*DRAW_K;
function ghostPort(){
  if(ui.drag) return null;
  if(TOOL.active!=="select") return null;
  const ptr = vPtr; if(!ptr) return null;
  const g = gridPt([ptr.x,ptr.y]);
  const gx=Math.floor(g.x), gy=Math.floor(g.y);
  if(gx<0||gy<0||gx>=GW||gy>=GH) return null;
  if(portAtCell(gx,gy)) return null;
  if(occupied(null,{ports:false})[gy][gx]) return null;
  // a cell can only ever be on the shell of one machine
  for(const p of LAY.parts){
    const dx=gx-p.x, dy=gy-p.y;
    const f=faceOfOffset(p,dx,dy);
    if(f && portFaceOK(p.id,f)) return {p, dx, dy, f, gx, gy};
  }
  return null;
}
function drawGhostPort(){
  const g = ghostPort(); if(!g) return;
  const [x,y]=cellPos(g.gx,g.gy);
  const bx=x-GHOSTG/2, by=y-GHOSTG/2;
  const wd=push({x:bx,y:by,w:GHOSTG,h:GHOSTG,type:"ghostport",p:g.p.id,dx:g.dx,dy:g.dy});
  const hv=hov(wd);
  ctx.save(); ctx.globalAlpha=hv?0.9:0.45;
  ctx.strokeStyle=C.green; ctx.lineWidth=1.3*DRAW_K; ctx.setLineDash([2*DRAW_K,2*DRAW_K]);
  ctx.strokeRect(bx,by,GHOSTG,GHOSTG);
  ctx.restore();
  TIP(bx,by,GHOSTG,GHOSTG,"NEW PIPE",
    "Press to start a pipe here, and keep the button down to pull the other end straight to the machine you want it to reach. The nozzle appears because the pipe's end stands on this cell.");
}
// hitAimAt() is the one resolver, so the outline can never name a machine the press would miss
function drawHitAim(){
  if(TOOL.active!=="hit"||ui.drag) return;
  const ptr = vPtr; if(!ptr) return;
  const id = hitAimAt(ptr); if(!id) return;
  const p = dmgPart(id); if(!p) return;
  let bx,by,bw,bh;
  if(p.isRun){ const [x,y]=cellPos(p.cells[0][0],p.cells[0][1]);
    bx=x-CELL/2; by=y-CELL/2; bw=bh=CELL; }
  else { const r=prect(p); bx=r.x; by=r.y; bw=r.w; bh=r.h; }
  ctx.save(); ctx.strokeStyle=C.red; ctx.lineWidth=1.6*DRAW_K; ctx.setLineDash([3*DRAW_K,3*DRAW_K]);
  ctx.strokeRect(bx,by,bw,bh);
  ctx.restore();
}
// one mark PER PORT, and a port is a CELL: a face carrying two draws two marks a cell apart
const PORTG=CELL-4*DRAW_K;
// one walk over the ports, taken by both passes, so both skip a broken one for the same reason
function eachPort(fn){
  for(const pid in D.ports){
    const port=D.ports[pid], p=partOf(port.p); if(!p) continue;
    const f=portFaceOf(pid), c=portCell(pid); if(!f||!c) continue;
    fn(pid,p,f,c);
  }
}
function drawPortMarks(){
  const owner=pipeMap().cellOwner, bore=portBores();
  eachPort((pid,p,f,c)=>{
    const [x,y]=cellPos(c[0],c[1]), bx=x-PORTG/2, by=y-PORTG/2;
    const IN=portPath(p,f), col=IN ? (portEnd(p,f)==="a"?C.portA:C.portB) : C.metal;
    const nr=portNozzleRect(pid,f,bore[pid]);
    // asked of the CELL the pipe would occupy, never of a run count, so two connections cannot double-draw the joint
    const out=[c[0]+DIRV[f][0], c[1]+DIRV[f][1]];
    const piped=!!owner[out[0]+","+out[1]];
    if(!piped){ const [nx,ny]=portPos(pid); drawNozzle(nx,ny,portFlat(f),bore[pid]||1,col); }
    const wd=push({x:bx,y:by,w:PORTG,h:PORTG,type:"port",pid});
    // the JOINT lights up, not a square drawn near it: the same rect drawPortValves() rings
    if(hov(wd)) fillRect(nr.x+DRAW_K,nr.y+DRAW_K,nr.w-2*DRAW_K,nr.h-2*DRAW_K,col);
    // one word per nozzle, IN the nozzle: a plate in the margin lands in the lane the pipework runs through
    const word = portWord(p,f);
    if(word) portWordDraw(pid,f,word,nr);
    const nm=partName(p), longWord=IN&&portWord(p,f,true);
    TIP(bx,by,PORTG,PORTG, (longWord?longWord+" - ":"")+nm,
      (piped? "A pipe is landed on it. " : "Nothing is piped to this port yet. ")+
      "Click to take it away."+(IN?" Which side of "+nm+" it is on is the FACE it stands beside, so move it by taking it away and placing it on the other face.":""));
  });
}
// nothing is drawn for an OPEN port: every nozzle has one, so marking them all would be marking nothing
const PORT_RING=2*DRAW_K;       // how far past the joint a press still counts
// one port is hovered at a time, so this is a rect; deferred to the last pass, or the mark goes under the next thing painted
let portRing=null;
function drawPortValves(L){
  portRing=null;
  const bore=portBores();
  eachPort((pid,p,f,c)=>{
    const shut=!portOpen(L,pid);
    const wreck=portWrecked(L,pid);
    const col=portColOf(pid,L);
    const [nx,ny]=portPos(pid);
    const nr=portNozzleRect(pid,f,bore[pid]);
    const r={x:nr.x-PORT_RING, y:nr.y-PORT_RING,
             w:nr.w+2*PORT_RING, h:nr.h+2*PORT_RING};
    const wd=push({x:r.x,y:r.y,w:r.w,h:r.h,type:"portv",pid});
    if(hov(wd)) portRing=nr;
    // a port with no run has no joint drawn for it, so it draws its own: piped or not, a shut valve looks the same
    if(shut||wreck) drawNozzle(nx,ny,portFlat(f),bore[pid]||1,col);
    // the machines' own tear mark: red alone is the SHUT valve, which is a position and not this
    if(wreck) hatch(nr.x,nr.y,nr.w,nr.h,C.red,.4);
    // portWordDraw() is the one primitive, so the bench and the control room cannot label a joint differently
    const word=wreck?null:portWord(p,f);
    if(word) portWordDraw(pid,f,word,nr);
    TIP(r.x,r.y,r.w,r.h, portLabel(pid)+"  [ "+(wreck?"WRECKED":shut?"SHUT":"OPEN")+" ]",
      "The isolation valve in this nozzle. Every port has one, it costs nothing, and it commissions open. Shutting it takes the run landed here out of the network entirely - which is how a leak is cut out of a live plant, and equally how a loop is starved by mistake. "+(wreck?"This one is WRECKED: it is jammed where it stood and takes no orders until the repair party has it.":"Click to work it."));
  });
}
// a finished run wears grips only when selected; an unfinished one always, because they are its only handle
// the dot is pushed last, so it takes the press before the machine or the pipe cell underneath it
const RUNG=CELL*0.62;
function drawRunGrips(){
  const selRid=D.runs[sel]?sel:null;      // `sel` IS the rid - see freeRid()
  const dot=(x,y,col,label)=>{
    const [px,py]=cellPos(x,y);
    ctx.beginPath(); ctx.arc(px,py,RUNG/2,0,7); ctx.fillStyle=col; ctx.fill();
    if(label!=null) txt(label, px, py+2.5*DRAW_K, {size:7,align:"center",color:C.inkOnLit});
  };
  for(const rid in D.runs){
    const r=D.runs[rid], err=runErr(rid), on=rid===selRid;
    const loose = portAtCell(r.a[0],r.a[1])==null || portAtCell(r.b[0],r.b[1])==null;
    if(!on && !err && !loose) continue;
    // a grip standing on a grip is a joint waiting for the release, not a refusal
    const join={a:runJoinAt(rid,"a"), b:runJoinAt(rid,"b")};
    const dup=r.pins.some((c,i)=>runPinDup(rid,i));   // ...and so is a waypoint about to collapse
    // an unfinished pipe is drawn as the line its recipe already is: red where the router refused, amber where it is not plumbed yet
    const unlaid = !(r.cells && r.cells.length);
    if(unlaid && !(err && (join.a || join.b || dup))){
      ctx.save(); ctx.setLineDash([4*DRAW_K,4*DRAW_K]);
      ctx.strokeStyle=err?C.red:C.amber; ctx.lineWidth=1.4*DRAW_K; ctx.beginPath();
      const path=[r.a].concat(r.pins,[r.b]);
      path.forEach((c,i)=>{ const [px,py]=cellPos(c[0],c[1]);
        if(i) ctx.lineTo(px,py); else ctx.moveTo(px,py); });
      ctx.stroke(); ctx.restore(); }
    for(const which of ["a","b"]){
      const c=r[which], [px,py]=cellPos(c[0],c[1]);
      const at=portAtCell(c[0],c[1])!=null;
      const jn=join[which];
      push({x:px-RUNG/2, y:py-RUNG/2, w:RUNG, h:RUNG, type:"runend", rid, which});
      TIP(px-RUNG/2, py-RUNG/2, RUNG, RUNG, jn?"PIPE END - JOINS HERE":(err?"PIPE END - "+err:"PIPE END"),
        "Drag it where you want it. Put it on a cell beside a machine and a nozzle appears there; drop it on another pipe's end and the two become one pipe; anywhere else the end is loose. Right click it to take the whole pipe off."+
        (at||jn?"":" It is loose: nothing is piped to a machine at this end."));
      // green is "this end has landed on something", and a joint is the other way an end stops being loose
      dot(c[0],c[1], (at||jn)?C.green:(err?C.red:C.amber));
    }
    r.pins.forEach((c,i)=>{ const [px,py]=cellPos(c[0],c[1]);
      const dp=runPinDup(rid,i);
      push({x:px-RUNG/2, y:py-RUNG/2, w:RUNG, h:RUNG, type:"runpin", rid, i});
      TIP(px-RUNG/2, py-RUNG/2, RUNG, RUNG, dp?"WAYPOINT "+(i+1)+" - COLLAPSES HERE":"WAYPOINT "+(i+1),
        "A cell this run has to go through. Drag it to move it, right click to drop it. Drop it on another waypoint or on either end of the pipe and it goes. Drag the pipe itself to pull a new one out of it.");
      dot(c[0],c[1], dp?C.green:C.amber, String(i+1)); });
  }
}
// asks groupFits(), the one predicate moveTo() will ask on release, so green means it WILL land
function partGhost(){
  const d = ui.drag&&ui.drag.type==="part" ? ui.drag : null;
  if(!d || (d.gx===d.sx && d.gy===d.sy)) return;
  const cells=moveCells(d.part,d.gx,d.gy), ok=groupFits(cells);
  ctx.save(); ctx.setLineDash([4*DRAW_K,4*DRAW_K]);
  for(const {q,x,y} of cells){ const r=grect(x,y,q.w,q.h);
    fillRect(r.x,r.y,r.w,r.h, ok?"rgba(87,211,140,.10)":"rgba(255,90,69,.10)");
    frame(r.x,r.y,r.w,r.h, ok?C.green:C.red); }
  ctx.restore();
}
// all a fitting still draws on the pipework: a throttle's share of the head, and a relief valve's margin to its lift point
function pipeFitMarks(L,net){
  if(!L) return;                      // both readings are live figures
  const anch=pipeAnchors(net);
  // slot 5 of the run's own stack, the line the allocator reserved; a valve with no pipe keeps its own tag
  const put=(id,label,col,cx,yTop)=>{
    const key=fitRunKey(id,net), a=key!==null && anch[key];
    if(!a){ pipeTag(cx,yTop,label,col); return; }
    if(pipeHovShow(key)) pipeStackLine(a.x,a.y,5,label,col);
  };
  for(const p of LAY.parts){
    if(p.role!=="fitting") continue;
    const id=p.id, mode=fitModeOf(id), r=prect(p), cx=r.x+r.w/2;
    if(mode==="relief"){
      // how far pressure still has to climb, signed, against THIS valve's own lift point
      const marg = reliefSet(id).lift - reliefAtP(L,id);
      // it stands under the glyph, so the room it has is what the bowtie leaves
      squeezeTxt((marg>=0?"+":"")+marg.toFixed(2), cx, r.y+r.h-2*DRAW_K, r.w-2*DRAW_K,
        {size:8*DRAW_K,align:"center",
         maxh:Math.max(2*DRAW_K,r.h/2-fitGlyphWH(id,r.w,r.h).fh/2-3*DRAW_K),
         color:marg<0?C.red : marg<reliefRefP(id)*0.02?C.amber : C.ink2});
    } else if(mode==="throttle"){
      // a share of the whole loop's head, so it is comparable between a long leg and a short one
      const dk = fitEdgeKey(id);
      if(pipeDrop[dk]!=null)
        put(id, (pipeDrop[dk]*100).toFixed(0)+"% dP",
            pipeDrop[dk]>0.5?C.amber:C.ink2, cx, r.y+DRAW_K);
    }
  }
}

// readoutsFor() is DATA - rows of [key,value,colour,tip,band,signedBar] - and a plant-wide number belongs to ONE panel
const rowInv=s=>["INVENTORY",(invNodesKg(s)/1000).toFixed(1)+" t",
  band(invNodesKg(s)/1000,P.invKg0*.8/1000,P.invKg0/1000,
    [[P.invKg0*.95/1000,C.red,"LEAKING"],[P.invKg0*.985/1000,C.amber,"LOSING"],
     [P.invKg0/1000,C.blue,"FULL"]],{dp:1}),
  "How much water is actually in the loop, in tonnes - summed over the nodes the primary circuit owns. It was commissioned with "
    +(P.invKg0/1000).toFixed(1)+" t, so this is "+s.inv.toFixed(1)+"% of the charge; under 95% you are losing it somewhere."];
const rowFat=s=>["VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",
  band(s.fatigue,0,100,[[50,C.cyan,"SOUND"],[80,C.amber,"WORN"],[100,C.red,"SPENT"]],{dp:0}),
  "Permanent metal damage from cold water hitting hot steel, mostly from emergency injection. It never resets, and the vessel bursts lower for every point of it."];
// a level is THIS generator's, never a plant-wide minimum
const rowSgl=(s,id)=>{ const v=sgLvl(s,id);
  return ["SG LEVEL",v.toFixed(1)+" %",
  band(v,0,100,[[25,C.red,"LOW"],[40,C.amber,"LOW"],[100,C.cyan,"NORMAL"]],{dp:0}),
  "Water in the steam generator. Under 25% it is boiling dry and the core is losing its heat sink."]; };
// in kilograms, against the same reference CORE FLOW is read on; full scale is the reference and a fifth, because a sodium loop thermosiphons past its own
const rowNat=s=>{ const ref=P.netRef>0?P.netRef:0, q=s.nat*ref;
  return ["NAT CIRC",q.toFixed(0)+" kg/s",
  band(q,0,ref*1.2,[[ref*.02,C.ink2,"NONE"],[ref*1.2,C.green,"ESTABLISHED"]],{dp:0}),
  "Flow that buoyancy alone is making. It builds once the loop is hot, and it is all you have with the pumps dead. Generator height over the core sets it."]; };
const T_TRIP="What tripped the plant most recently. It stays here after a reset, so you can still see what you were fighting.";

// [label, s.parts key, tip, colour, limit]. ONE table, so a term cannot wear one colour in the picture and another in the list
// `limit` is the pcm marks a row carries, and only the NET has any
const RHO_ROWS=[
 ["RODS","rod","Negative reactivity from the inserted control rods. The deeper they go the stronger this gets, but not evenly: the rods bite hardest around mid-travel.",()=>C.metal],
 ["DOPPLER","dop","Feedback from hot fuel. As fuel heats it absorbs more neutrons, pushing power back down. Instant, automatic and always stabilising - this is what stops a runaway before a human could react.",()=>C.red],
 ["EXPANSION","exp","Feedback from hot metal growing. Hot fuel columns lengthen, the grid plate spreads the assemblies apart and the rod drivelines push the bank in - all of it leaks neutrons out. Small in a water core; in a fast core it is most of what holds the reactor down.",()=>C.ink2],
 ["MODERATOR","mod","Feedback from moderator temperature, the coolant and any blocks packed between the assemblies. Hotter water is less dense and moderates neutrons less, so power drops. This is why the reactor follows turbine load on its own.",()=>C.cyan],
 ["XENON","xe","Xenon-135, a neutron poison that builds up after fission. It has memory: what you did minutes ago is still eating your reactivity now. Equilibrium sits near -2700; after a scram it deepens toward -4800 and locks you out of restarting.",()=>C.blue],
 ["BORON","bor","Poison dissolved in the coolant, and whatever you have dialled in on the boron control. Slow to change, but it is the only lever left once rods and temperature have run out.",()=>C.green],
 ["VOID","vd","Steam bubbles in the core. In a water design this is strongly negative and shuts the reactor down as it uncovers. In a graphite or sodium design it is POSITIVE, and voiding adds power instead.",()=>C.bright],
 ["DISASSEMBLY","dis","Fuel that a power pulse has blown out of its pins. It is no longer in the lattice, so it multiplies nothing - this is what actually stops a prompt excursion, and it is not a control.",()=>C.h2],
 ["ROD TIP","tip","Whatever hangs below the absorber. With a water follower this stays at zero all the way in. With a graphite one it goes POSITIVE as the bank drops, because graphite displaces water at the bottom of the core before the absorber has reached there - the reactivity you add before the reactivity you remove.",()=>C.graph],
 ["NET RHO","net","The sum of everything above. Zero means steady power, positive means it is climbing, negative means it is falling. The marks are your fuel's beta: past one of them the reactor is prompt critical and nothing can stop it in time.",()=>C.amber,()=>[-P.BETA*1e5,P.BETA*1e5]],
];
const RHO_TERMS=RHO_ROWS.filter(r=>r[1]!=="net");
// full deflection of a ledger bar, pcm; every term shares it, or the bars are eight scales in one column
const RHO_BAR=2600;
// the smallest move worth drawing, so a settled plant reads settled instead of magnified
const RHO_TRACE_MIN=150, TAVG_TRACE_MIN=1;

// which vessel the two balances are read off: null is the plant, and the control room's tab row is the one writer
const CRUNIT={id:null};
const crUnits=()=>{ const ids=typeof coreIds==="function"?coreIds():[]; return ids.length>1?ids:[]; };
// a tab naming a vessel this design no longer has falls back to the plant
const crUnit=()=>{ const id=CRUNIT.id;
  return id && S && S.coreBy && S.coreBy[id] ? id : null; };
// addressed by ring name, never TREND.unit, which is the SCENARIO chart's own pick
const crCh=k=>{ const id=crUnit(); return id && crUnits().length ? k+":"+id : k; };

// three registers: the balance, the net against beta, and the last minute; laid out off `h`, because the rail width is the player's
function rhoViz(x,y,w,h){
  const s=coreSeen(S,crUnit()||primaryCore()); if(!s) return;
  const L=x+2, R=x+w-2, cx=(L+R)/2, span=(R-L)/2;
  // P.BETA is the delayed fraction; everything on this widget is pcm
  const beta=P?P.BETA*1e5:650;

  const vals=RHO_TERMS.map(r=>({lab:r[0],v:s.parts[r[1]],col:r[3]()}));
  let neg=0,pos=0;
  for(const t of vals){ if(t.v<0) neg-=t.v; else pos+=t.v; }
  // one scale for both arms, continuous in the total; headroom is ADDITIVE, or the longer arm pins whatever the total is
  const RHO_HEAD=800;
  const raw=Math.max(neg,pos,1), full=raw+RHO_HEAD;

  // whatever the row has over its minimum is shared out: a little to each seam, a little to the bars, the rest to the trace
  const KCOL=4, krows=Math.ceil(vals.length/KCOL);
  const slack=Math.max(0,h-(88+krows*8));
  const gap=Math.min(6,slack*.14), grow=Math.min(4,slack*.07);

  txt("REACTIVITY BALANCE",L,y+8,{size:7,sp:1.2,weight:700,color:C.amber});
  // the GEOMETRY is continuous, the LABEL is not: to the pcm it would hunt its last digits on a standing plant
  txt("+/-"+(Math.round(full/50)*50).toFixed(0)+" pcm",R,y+8,{size:7,sp:.6,align:"right",color:C.bright});

  const by=y+13+gap, bh=14+grow;
  fillRect(L,by,R-L,bh,C.well);
  const seg=(from,dir)=>{
    let acc=0;
    for(const t of vals){
      const m=dir>0? Math.max(0,t.v) : Math.max(0,-t.v);
      if(m<=0) continue;
      const a=cx+dir*(acc/full)*span, b=cx+dir*((acc+m)/full)*span;
      const x0=Math.min(a,b), wd=Math.abs(b-a);
      fillRect(x0,by,Math.max(.6,wd),bh,t.col);
      // the name only where it fits: the colour key below says the same thing and always does
      if(wd>tw(t.lab,{size:6,sp:.4})+6)
        txt(t.lab,(a+b)/2,by+bh/2+2,{size:6,sp:.4,align:"center",color:C.inkOnLit});
      acc+=m;
    }
    return acc;
  };
  seg(cx,-1); seg(cx,1);
  frame(L,by,R-L,bh,C.edge);
  fillRect(cx,by-2,1,bh+4,C.bright);
  // fitTxt and not txt: these figures have no ceiling, so a long one steps down the ladder
  fitTxt("HOLD DOWN "+neg.toFixed(0),cx-4,by+bh+8,span-6,{size:6,sp:.5,align:"right",color:C.blue});
  fitTxt(pos.toFixed(0)+" PUSH UP",cx+4,by+bh+8,span-6,{size:6,sp:.5,color:C.red});

  // two rows: one across is a row of labels overwriting each other at a stock rail width
  const kw=(R-L)/KCOL, ky=by+bh+13+gap;
  vals.forEach((t,i)=>{
    const kx=L+(i%KCOL)*kw, kyy=ky+((i/KCOL)|0)*8;
    fillRect(kx,kyy,4,4,t.col);
    fitTxt(t.lab,kx+6,kyy+4,kw-8,{size:6,sp:.2,color:C.ink2});
  });

  const ny=ky+krows*8+5+gap, nh=13+grow, bSpan=Math.max(beta*1.6,Math.abs(s.rho)*1.1,1);
  const atN=v=>cx+clamp(v/bSpan,-1,1)*span;
  fillRect(L,ny+nh/2,R-L,1,C.edge2);
  // the prompt-critical lines are the only marks on this scale that matter
  for(const d of [-1,1]){
    const px2=atN(d*beta);
    fillRect(px2,ny,1,nh,C.red);
    txt((d>0?"+":"-")+"BETA",px2+(d>0?2:-2),ny+nh-1,
      {size:6,sp:.4,align:d>0?"left":"right",color:C.red});
  }
  const nx=atN(s.rho);
  const nCol = s.rho>beta? C.red : Math.abs(s.rho)<50? C.green : s.rho<0? C.blue : C.amber;
  fillRect(Math.min(cx,nx),ny+nh/2-2,Math.max(1,Math.abs(nx-cx)),4,nCol);
  fillRect(nx-1,ny-2,3,nh+4,nCol);
  fillRect(cx,ny-2,1,nh+4,C.bright);
  // hist is sampled every SAMP_TICKS, so the five-second lookback is a sample count
  const back=Math.round(5/(SAMP_TICKS*0.02));
  if(hlen>back+1){
    const was=chAt("rho",hlen-1-back), wx=atN(was);
    if(Math.abs(wx-nx)>1.5){
      fillRect(wx,ny+1,1,nh-2,C.rail);
      const dir=nx>wx?1:-1;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(nx-dir*5,ny+nh/2-3); ctx.lineTo(nx-dir*1,ny+nh/2); ctx.lineTo(nx-dir*5,ny+nh/2+3);
      ctx.fillStyle=nCol; ctx.fill(); ctx.restore();
    }
  }
  txt((s.rho>=0?"+":"")+s.rho.toFixed(0)+" pcm NET",L,ny+nh+8,{size:7,sp:.6,color:nCol});
  txt("BETA "+beta.toFixed(0),R,ny+nh+8,{size:6,sp:.6,align:"right",color:C.ink2});

  vizTrace(L,R,ny+nh+12+gap,Math.max(16,y+h-(ny+nh+12+gap)-2),crCh("rho"),C.amber,0,"",RHO_TRACE_MIN,"pcm");
}
// the zero line is the middle of the box, always: the span is the worst excursion either way, so the line never moves
// `zero` is that quantity's own nothing: 0 pcm for reactivity, the commissioned T-avg for temperature
function vizTrace(L,R,ty,th,ch,col,zero,lab,floor,unit){
  fillRect(L,ty,R-L,th,C.well); frame(L,ty,R-L,th,C.edge);
  const N=Math.min(hlen,Math.round(60/(SAMP_TICKS*0.02)));
  if(N<=2){ txt("COLLECTING DATA",(L+R)/2,ty+th/2+2,{size:7,sp:1.4,align:"center",color:C.ink2}); return; }
  let dev=0;
  for(let i=0;i<N;i++) dev=Math.max(dev,Math.abs(chAt(ch,hlen-N+i)-zero));
  // the floor is the smallest deviation worth looking at, so a channel standing still draws flat
  const half=Math.max(dev*1.2,floor);
  const zy=ty+th/2;
  ctx.save(); ctx.setLineDash([2,3]);
  line(L+1,zy,R-1,zy,C.edge2,1); ctx.restore();
  ctx.beginPath(); ctx.strokeStyle=col; ctx.lineWidth=1.2;
  for(let i=0;i<N;i++){
    const X=L+1+(i/(N-1))*(R-L-2), Y=zy-((chAt(ch,hlen-N+i)-zero)/half)*(th/2-1);
    i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);
  }
  ctx.stroke();
  txt(zero?fmtSpan(zero)+" "+unit:"0",L+3,zy-2,{size:6,color:C.ink2});
  txt("+/-"+fmtSpan(half)+" "+unit,R-3,ty+8,{size:6,align:"right",color:C.ink2});
  txt(lab+"-"+(N*SAMP_TICKS*0.02).toFixed(0)+"s",L+3,ty+th-3,{size:6,color:C.ink2});
  txt("NOW",R-3,ty+th-3,{size:6,align:"right",color:C.ink2});
}
const fmtSpan=v=>v>=10?v.toFixed(0):v>=1?v.toFixed(1):v.toFixed(2);
const RHOVIZ_TIP="Every term of the reactivity balance at once. The stacked bar splits at zero: what is holding the reactor down stacks left, what is pushing it up stacks right, both on one scale, so the longer arm is the side that is winning. Under it the SUM is drawn against your fuel's beta - past that line the reactor is prompt critical and no control on this ship is fast enough. The faint caret is where the sum stood five seconds ago and the arrow is the way it is heading. The trace is the last minute of it against its own zero.";
// [label, HEATBAL/s key, tip, colour]. SOURCES ONLY: the sinks come off the machines actually fitted
const HEAT_ROWS=[
 ["PROMPT FISSION","prompt","Heat from the chain reaction itself. It follows power instantly and it is the only term a scram takes away.",()=>C.red],
 ["DECAY 7 s","d0","Short-lived fission products, half-life about 7 seconds. The first thing to fade after a trip, and the largest of the four while it lasts.",()=>C.amber],
 ["DECAY 145 s","d1","Fission products with a half-life around 145 seconds. This is most of what is still cooking the core two minutes after a scram.",()=>C.graph],
 ["DECAY 28 min","d2","Half-life about 28 minutes. Long after the plant looks shut down, this is still worth around one per cent of rated power.",()=>C.metal],
 ["DECAY 8.8 h","d3","Half-life about 8.8 hours. On any timescale this ship cares about it is a floor that never goes away - the heat you must keep removing forever.",()=>C.bright],
];
// a stage charges a core when its NEAR side stands on that core's own circuit; `cid` null is the plant and takes everything
const heatOnUnit=(cid,id)=>!cid || sgPrimCirc(id)===coreCircOf(cid);
function heatSinks(cid){
  const out=[], rated=heatRated(cid)*1000;
  if(!rated) return out;
  for(const id of ihxIds()){
    if(!sgActive(id) || !heatOnUnit(cid,id)) continue;
    out.push({lab:nameOf(id),v:(S.ihxQBy[id]||0)/rated,col:C.cyan,
      tip:"Heat crossing this intermediate exchanger, out of the core and into the circuit behind it. Whatever that circuit feeds is a stage further on."});
  }
  for(const id of sgIds()){
    if(!sgActive(id) || !heatOnUnit(cid,id)) continue;
    out.push({lab:nameOf(id),v:(HEATBAL.sgQBy[id]||0)/rated,col:C.green,
      tip:"Heat this generator is taking out of the core. It goes to zero when the tubes uncover, and a core with no sink at all keeps heating on decay heat alone."});
  }
  return out;
}
// a share of ITS OWN rating: over the plant's, one unit of two reads half the power it is making
const heatRated=cid=>{ const K=cid&&P&&P.cores&&P.cores[cid];
  return K ? K.rated : (P?P.rated:0); };
// full deflection of a heat ledger bar, share of rated power
const HEAT_BAR=0.10;
// the needle's deadband and its green band both, so the two cannot disagree
const HEAT_DEAD=0.01;

// the same three registers rhoViz() uses: the balance, the net in K/s, and the last minute of T-avg
function heatViz(x,y,w,h){
  const cid=crUnit(), s=cid?coreSeen(S,cid):S; if(!s) return;
  const L=x+2, R=x+w-2, cx=(L+R)/2, span=(R-L)/2;
  const rated=heatRated(cid);

  // a vessel's prompt term is its own n, never the plant's rated-weighted mean
  const src=HEAT_ROWS.map(r=>({lab:r[0],
    v:r[1]==="prompt"?(cid?s.n*PROMPT_F:HEATBAL.prompt):(s.dec[+r[1][1]]||0), col:r[3]()}));
  const snk=heatSinks(cid);
  let made=0,rem=0;
  for(const t of src) made+=Math.max(0,t.v);
  for(const t of snk) rem+=Math.max(0,t.v);
  // additive headroom, continuous in the total - see the scale note in rhoViz()
  const full=Math.max(made,rem,0.005)+0.06;

  const KCOL=3, kall=src.concat(snk), krows=Math.ceil(kall.length/KCOL);
  const slack=Math.max(0,h-(88+krows*8));
  const gap=Math.min(6,slack*.14), grow=Math.min(4,slack*.07);

  txt("HEAT BALANCE",L,y+8,{size:7,sp:1.2,weight:700,color:C.amber});
  txt("+/-"+(full*100).toFixed(0)+" % rated",R,y+8,{size:7,sp:.6,align:"right",color:C.bright});

  const by=y+13+gap, bh=14+grow;
  fillRect(L,by,R-L,bh,C.well);
  const seg=(list,dir)=>{
    let acc=0;
    for(const t of list){
      const m=Math.max(0,t.v); if(m<=0) continue;
      const a=cx+dir*(acc/full)*span, b=cx+dir*((acc+m)/full)*span;
      const x0=Math.min(a,b), wd=Math.abs(b-a);
      fillRect(x0,by,Math.max(.6,wd),bh,t.col);
      if(wd>tw(t.lab,{size:6,sp:.4})+6)
        txt(t.lab,(a+b)/2,by+bh/2+2,{size:6,sp:.4,align:"center",color:C.inkOnLit});
      acc+=m;
    }
  };
  seg(snk,-1); seg(src,1);
  frame(L,by,R-L,bh,C.edge);
  fillRect(cx,by-2,1,bh+4,C.bright);
  fitTxt("REMOVED "+(rem*100).toFixed(1)+"%",cx-4,by+bh+8,span-6,{size:6,sp:.5,align:"right",color:C.green});
  fitTxt((made*100).toFixed(1)+"% MADE",cx+4,by+bh+8,span-6,{size:6,sp:.5,color:C.red});

  const kw=(R-L)/KCOL, ky=by+bh+13+gap;
  kall.forEach((t,i)=>{
    const kx=L+(i%KCOL)*kw, kyy=ky+((i/KCOL)|0)*8;
    fillRect(kx,kyy,4,4,t.col);
    fitTxt(t.lab,kx+6,kyy+4,kw-8,{size:6,sp:.2,color:C.ink2});
  });

  const ny=ky+krows*8+5+gap, nh=13+grow;
  // the raw derivative spikes a tenth of a K/s on a settled loop; needle, colour and digits read one eased figure
  const dT=dispEase("heat:dT:"+(cid||"plant"),s.dTavg||0,HEAT_DEAD,4);
  const dSpan=Math.max(.5,Math.abs(dT)*1.2);
  const atN=v=>cx+clamp(v/dSpan,-1,1)*span;
  fillRect(L,ny+nh/2,R-L,1,C.edge2);
  const nx=atN(dT);
  const nCol = dT>.15? C.red : dT<-.05? C.blue : Math.abs(dT)<HEAT_DEAD? C.green : C.amber;
  fillRect(Math.min(cx,nx),ny+nh/2-2,Math.max(1,Math.abs(nx-cx)),4,nCol);
  fillRect(nx-1,ny-2,3,nh+4,nCol);
  fillRect(cx,ny-2,1,nh+4,C.bright);
  txt((dT>=0?"+":"")+dT.toFixed(2)+" K/s",L,ny+nh+8,{size:7,sp:.6,color:nCol});
  txt(rated?(made*rated).toFixed(0)+" MWt MADE":"NOT COMMISSIONED",R,ny+nh+8,
    {size:6,sp:.6,align:"right",color:C.ink2});

  // temperature's zero is the plant's own commissioned T-avg, so the centre line is where this loop was built to sit
  const ty=ny+nh+12+gap;
  vizTrace(L,R,ty,Math.max(16,y+h-ty-2),crCh("tavg"),C.cyan,
    (cid&&P&&P.cores&&P.cores[cid])?P.cores[cid].Tref:(P?P.Tref:0),"T-AVG ",TAVG_TRACE_MIN,"K");
}
// the map off the same coreCellGeom() the reactor symbol draws, so a cell in one is a cell in the other
// cid comes from the panel this canvas is IN, not from sel: a rail panel is painted whether or not its machine is selected
function dmgViz(x,y,w,h,cid){
  const s=coreSeen(S,cid); if(!s||!s.nDmg) return;
  const L=x+2, R=x+w-2;

  txt("FUEL DAMAGE",L,y+8,{size:7,sp:1.2,weight:700,color:C.amber});
  txt(s.dmg.toFixed(1)+" % CLAD",R,y+8,{size:6.5,sp:.6,align:"right",color:C.ink2});

  // the map takes whatever is left after the ledger and its legend
  const krows=Math.ceil(FAIL.length/2);
  const foot=34+krows*8;
  const my=y+13, mh=Math.max(30,y+h-my-foot);
  fillRect(L,my,R-L,mh,C.well);
  const g=coreCellGeom(L,my,R-L,mh);
  for(let c=0;c<g.NC;c++){
    const i=g.ring(c);
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), cx=g.cx(c), cy=g.cy(j), st=fuelStage(s,k);
      ctx.globalAlpha=st>0?.35+.2*st:.18;
      fillRect(cx-g.cw/2,cy-g.ch/2,g.cw-.5,g.ch-.5,FAIL[st].col());
      ctx.globalAlpha=1;
      // a ring the lattice never filled has no fuel to hurt, and says so
      const ff=P&&P.frac?clamp(P.frac[i],0,1):1;
      if(ff<.3) fillRect(cx-1,cy-1,2,2,C.edge2);
    }
  }
  // the least margin anywhere, ringed: it is where the NEXT cell to fail is
  { const cx=g.cx((XNR-1)+s.dnbrRing), cy=g.cy(s.dnbrLev);
    ctx.beginPath(); ctx.arc(cx,cy,Math.min(g.cw,g.ch)*.42,0,7);
    ctx.strokeStyle=C.bright; ctx.lineWidth=.8; ctx.globalAlpha=.8;
    ctx.stroke(); ctx.globalAlpha=1; }
  frame(L,my,R-L,mh,C.edge);
  txt("MIN NODE DNBR "+s.dnbrMin.toFixed(2)+" @ R"+s.dnbrRing+"/EL"+s.dnbrLev,
    L,my+mh+8,{size:6,sp:.4,color:C.ink2});

  const st=fuelStages(s), by=my+mh+14, bh=12;
  fillRect(L,by,R-L,bh,C.well);
  let acc=0;
  for(let q=0;q<FAIL.length;q++){
    const f=st[q]; if(f<=0) continue;
    const a=L+acc*(R-L), b=L+(acc+f)*(R-L);
    fillRect(a,by,Math.max(.6,b-a),bh,FAIL[q].col());
    if(b-a>tw(FAIL[q].lab,{size:6,sp:.4})+6)
      txt(FAIL[q].lab,(a+b)/2,by+bh/2+2,{size:6,sp:.4,align:"center",color:C.inkOnLit});
    acc+=f;
  }
  frame(L,by,R-L,bh,C.edge);
  const kw=(R-L)/2, ky=by+bh+9;
  FAIL.forEach((f,q)=>{
    const kx=L+(q%2)*kw, kyy=ky+((q/2)|0)*8;
    fillRect(kx,kyy,4,4,f.col());
    fitTxt(f.lab+"  "+(st[q]*100).toFixed(1)+"%",kx+6,kyy+4,kw-8,
      {size:6,sp:.2,color:C.ink2});
  });
}
const DMGVIZ_TIP="Where the core is hurt, cell by cell, on the same picture the reactor symbol draws. Amber is cladding that has burst, red is cladding the steam has eaten through, violet is fuel a power pulse has blown apart inside the channel, and the pale cells are fuel that is actually molten. The ring marks the node with the least thermal margin left - that is where the next failure happens. Under it, what share of the core is in each stage.";
const HEATVIZ_TIP="The core's whole heat balance. Everything it is MAKING stacks right - prompt fission plus four groups of decay heat on their own clocks - and everything a generator or exchanger is TAKING stacks left, both on one scale, so the longer arm is the side that is winning. A scram takes the prompt segment away and nothing else, which is why a shut-down core still needs a sink. Under it the net as K/s on T-avg, and the last minute of T-avg itself.";
// a demand in transit is not a caution: amber says the machine is walking to where it was asked
const MOVING=new Set(["BORON DEMAND","TILT DEMAND","SPEED DEMAND","LOAD DEMAND"]);
const movingCol=(dem,act,tol)=>Math.abs(dem-act)>tol?C.amber:C.ink2;
// one scale for a circuit's pressure: fractions of holdSetP(), because the shape is the same at 0.2 MPa and 15.5
// the two limit marks are read off the channel, never spelt out here, or two panels alarm at different pressures
const loopPBand=ci=>{ const set=holdSetP(ci);
  return v=>band(v,set*.80,set*1.15,
    [[set*0.86,C.red,"LOW"],[set*0.935,C.amber,"LOW"],[set*1.05,C.cyan,"NORMAL"],
     [set*1.15,C.red,"HIGH"]],
    {dp:2,lim:rpsLive()?[[rpsSetOf("php",0),"HI"],[rpsSetOf("plp",0),"LO"]]:null}); };
function readoutsFor(p,s){
  const id=p.id, R=[];
  // a setpoint only exists while something is watching it
  const trip=(v,l)=>rpsLive()?[[v,l]]:null;
  // a row hands in a colour OR a band; `bar` is an optional centre-zero bar, {f:-1..1, full}
  const add=(k,v,c,tip,bar)=>{
    const g=(c&&typeof c==="object")?c:null;
    R.push([k,v, g?bandCol(g):(c||C.cyan), tip, g, bar]);
  };
  // a section only says where one group of rows ends and the next begins; the row order is unchanged
  const secRow=t=>R.push({sec:t});
  // what a fitting is worth watching depends on its mode, never on its id
  if(p.role==="fitting") return readoutsForFit(id,s);
  const K=(P&&P.cores&&P.cores[coreOf(id)])||P; if(p.role==="core"||p.role==="rods") s=coreSeen(s,coreOf(id));
  if(p.role==="core"){
    // power is coloured by power: DNBR has its own row below and its own caution
    secRow("POWER");
    add("POWER",(s.n*100).toFixed(1)+" %",
      // amber at 105, not at 100: a salt plant rests at 102 % of its own rating
      band(s.n*100,0,150,[[105,C.green,"NORMAL"],[110,C.amber,"HIGH"],[150,C.red,"OVERPOWER"]],
        {dp:0,lim:trip(rpsSetOf("flux",0),"FLUX")}),
      "Heat the core is making, as a share of what it is rated for. This is the chain reaction alone - decay heat is on top of it, and TOTAL MADE below is the two together. The real ceiling is DNBR, not this number.");
    add("THERMAL",(s.n*K.rated).toFixed(0)+" MWt",null,
      "The same power in megawatts of heat: the rating times the share above.");
    // the one number an operator scrams on; the ledger below states it four times, once per group
    add("DECAY HEAT",(s.decay*100).toFixed(2)+" %",
      s.decay*K.rated>0?C.amber:C.ink2,
      "Heat from fission products, as a share of rating. It does not scram: right after a trip it is around 6 % of full power and it takes hours to fall away. TOTAL MADE below is this plus the chain reaction.");
    { const per=period(), fin=isFinite(per)&&Math.abs(per)<999;
      add("PERIOD", fin?per.toFixed(0)+" s":"INF",
        fin&&per>0&&per<30 ? C.red : fin&&per>0&&per<80 ? C.amber : C.cyan,
        "Seconds for power to multiply by 2.7 times at the rate it is moving right now. INF means steady. A short POSITIVE period is power running away from you, and under about ten seconds nothing you do will catch it."); }
    // asked of the core's own circuit: s.coreDT is the rise the solve carried, and the pressure is that circuit's
    { const cci=coreCircOf(id), pv=loopP(s,cci), dT=s.coreDT||0;
      const dT0=coreDT0(coreD(id)), scH=(s.scBy&&s.scBy[cci]!==undefined)?s.scBy[cci]:(s.sc||0);
      const scHi=Math.max(60,(P.tsat0-P.Tref)*1.25);
      secRow("COOLANT");
      // four temperatures on ONE axis: the question is the DISTANCE from the hot leg to saturation, pinned to the commissioned plant
      { const Tc=s.Tavg-dT/2, Th=s.Tavg+dT/2, ts=tsatSec(pv,cci);
        const tLo=P.Tref-Math.max(40,dT0*1.5), tHi=Math.max(P.tsat0,P.Tref)+Math.max(20,dT0);
        add("COLD / AVG / HOT",Tc.toFixed(0)+" / "+s.Tavg.toFixed(0)+" / "+Th.toFixed(0)+" K",
          band(s.Tavg,tLo,tHi,[[tHi,C.cyan,""]],
            {dp:0,marks:["cold","hot","sat"],mv:[Tc,Th,ts]}),
          "The whole loop on one scale. The bright line is the mean the energy balance is kept on; blue is the coolant coming back from the generators, amber is what leaves the core, and red is where this coolant boils at the pressure it is held at right now ("+ts.toFixed(0)+" K). The gap between amber and red is the margin, and MARGIN TO BOIL below is that gap as a number."); }
      add("CORE RISE",dT.toFixed(1)+" K",
        band(dT,0,Math.max(1,dT0*2),[[dT0*1.15,C.cyan,"NORMAL"],[dT0*1.6,C.amber,"WIDE"],
          [Math.max(1,dT0*2),C.red,"STARVED"]],{dp:1,lim:[[dT0,"DESIGN"]]}),
        "How much hotter the coolant is leaving than arriving. It is power over flow: the same heat through half the flow is twice this, so a wide rise is the first thing a failing pump does and it is what puts the hot channel into boiling.");
      add("LOOP PRESSURE",pv.toFixed(2)+" MPa",loopPBand(cci)(pv),
        "What this circuit is being held at, off its own vessel. It is not a knob here - it is a reading of whatever is holding the loop up, and losing it costs the margin below. The marks are where the protection trips, high and low, and they are the same limits the vessel holding this loop reads against.");
      add("MARGIN TO BOIL",scH.toFixed(1)+" K",
        band(scH,0,scHi,[[8,C.red,"SATURATED"],[Math.max(10,P.sc0*.6),C.amber,"THIN"],
          [scHi,C.cyan,"SUBCOOLED"]],{dp:0}),
        "Degrees the hottest liquid in this circuit is below boiling. It is the honest leak indicator: it collapses before anything else on this panel admits the loop is voiding, and VOID FRACTION below is what happens after it reaches zero."); }
    // scale top measured off the plant: a fixed one pegs the needle on half the architectures from the first frame
    const dHi=Math.max(2.6,K.dnbr0*1.3);
    secRow("THERMAL MARGIN");
    add("DNBR",s.dnbr.toFixed(2),
      band(s.dnbr,0.8,dHi,[[1.0,C.red,"FILM"],[1.3,C.amber,"MARGINAL"],[dHi,C.cyan,"SAFE"]],
        {dp:2,lim:trip(rpsSetOf("dnbr",0),"TRIP")}),
      "How far the fuel is from a steam film that stops cooling it. Over 1.30 is comfortable; 1.00 damages fuel. This is the hot-channel figure, and it is the one the protection system trips on.");
    add("MIN NODE DNBR",s.dnbrMin.toFixed(2)+"  R"+s.dnbrRing+"/EL"+s.dnbrLev,
      band(s.dnbrMin,0.8,dHi,[[1.0,C.red,"FILM"],[1.3,C.amber,"MARGINAL"],[dHi,C.cyan,"SAFE"]],{dp:2}),
      "The same margin asked of every mesh node separately, and the worst answer, with where it is. It reads the enthalpy actually carried to that node rather than a peaking factor, so it will not agree with DNBR above and is not meant to. Nothing trips on it - it is what the damage map is looking at.");
    add("FUEL TEMP",s.Tf.toFixed(0)+" K",
      // amber as a FRACTION of this fuel's own limit, or a hot-running core sits amber by design
      band(s.Tf,300,Math.max(2200,K.tdmg+700),[[K.tdmg*.95,C.cyan,"NORMAL"],[K.tdmg,C.amber,"HOT"],[Math.max(2200,K.tdmg+700),C.red,"FAILING"]],
        {dp:0,lim:trip(rpsSetOf("tf",0),"TRIP")}),
      "Temperature inside the pellets. Past "+K.tdmg.toFixed(0)+" K the cladding starts to fail, and that damage is permanent.");
    add("PEAK Fq",s.fq.toFixed(2),
      band(s.fq,1,5,[[3.2,C.cyan,"FLAT"],[4.2,C.amber,"PEAKED"],[5,C.red,"HOT SPOT"]],{dp:2}),
      "How much hotter the hottest spot is than the core average. 1.00 is perfectly flat; past 3.2 one channel is doing far too much of the work.");
    add("HOT SPOT","R"+s.hotRing+" / EL"+s.hotLev,null,
      "Which mesh ring and which level is carrying that peak. It is ringed in the core field on the reactor symbol.");
    add("AX / RAD OFFSET",(s.ao*100).toFixed(0)+" / "+(s.ro*100).toFixed(0)+" %",
        Math.abs(s.ao)>.35||Math.abs(s.ro)>.35?C.amber:C.cyan,
      "How far the flux leans up-down and in-out from centred. Past 35% either way the peak has moved somewhere you did not design for.");
    add("VOID FRACTION",s.vf.toFixed(2),
      band(s.vf,0,.6,[[.15,C.cyan,"LIQUID"],[.30,C.amber,"VOIDING"],[.6,C.red,"BOILING"]],
        {dp:2,lim:trip(.30,"TRIP")}),
      "Share of the coolant that has turned to steam. Steam carries heat away far worse than water, and in a graphite core it adds reactivity as well.");
    add.apply(null,rowInv(s));
    // s.flowNet, not s.flow: the LOW FLOW trip reads DELIVERED flow, and it is one number about the CORE
    // in kilograms, and the scale tops at twice the reference, because a plant piped wider than nominal rests above it
    const fref=(K.netRef>0?K.netRef:0);
    secRow("FLOW");
    add("CORE FLOW",(s.flowNet*fref).toFixed(0)+" kg/s",
      band(s.flowNet*fref,0,fref*2,
        [[K.flowMin*fref,C.red,"STARVED"],[fref*0.9,C.amber,"LOW"],[fref*2,C.cyan,"NORMAL"]],
        {dp:0,lim:trip(K.flowMin*1.02*fref,"TRIP")}),
      "Coolant actually reaching the core, which is what the protection system trips on - not what the pumps were told to do. The reference this plant was solved on is "+fref.toFixed(0)+" kg/s, and the scale runs to twice it. Where the strip turns red at "+(K.flowMin*fref).toFixed(0)+" kg/s is the design floor: the least this pump set still delivers after damage, "+(K.flowMin*100).toFixed(0)+" % of the reference, and it rises with the spare pump capacity you actually placed on the grid. A shut valve or a severed run shows up here and nowhere else.");
    // to 200 %, because a channel CAN carry more than the average and two presets do
    add("HOT CHANNEL",(s.hotFlow*100).toFixed(0)+" %",
      band(s.hotFlow*100,0,200,[[50,C.red,"STARVED"],[70,C.amber,"MARGINAL"],[200,C.cyan,"FED"]],{dp:0}),
      "Flow in the WORST channel, not the average. A voiding channel loses the flow it needed to stop voiding, and that runaway is why the core is a place and not a number.");
    add.apply(null,rowNat(s));
    // BORON and XENON are reactivity terms, so the ledger below says them instead
    add("BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        movingCol(s.boronDem,s.boron,20),
      "Where you have asked boron to go. It borates at "+BOR_IN+" pcm/s and only dilutes at "+BOR_OUT+", so poisoning yourself is the fast direction.");
    secRow("DAMAGE");
    add("PEAK CLAD",s.TcladHot.toFixed(0)+" K",
      band(s.TcladHot,300,1600,[[1000,C.cyan,"NORMAL"],[1200,C.amber,"HOT"],[1600,C.red,"FAILING"]],{dp:0}),
      "The hottest cladding anywhere in the core. This is the number every kind of fuel failure turns on, and it is not the fuel temperature above: while water is going past the rods the cladding sits close to the coolant, and the moment a node goes dry it climbs to meet the pellet.");
    add("FUEL DAMAGE",s.dmg.toFixed(1)+" %",
      // any damage at all is the bad zone, so the good one is a sliver: this scale has no safe stretch
      band(s.dmg,0,100,[[1e-9,C.cyan,"NONE"],[100,C.red,"CLAD FAILED"]],{dp:0}),
      "Cladding that has already burst, counted over the whole core, and it is permanent. A rod bursts when its cladding gets hot while the loop pressure is below the gas sealed inside it - so a depressurised core fails its fuel hundreds of degrees earlier than one still at pressure.");
    add("OXIDISED",(s.oxMax*100).toFixed(1)+" %",
      band(s.oxMax*100,0,100,[[17,C.cyan,"WITHIN LIMIT"],[50,C.amber,"DEEP"],[100,C.red,"THROUGH"]],{dp:0}),
      "How much of the cladding wall the steam has burnt away at the worst node, as a share of its thickness. 17% is the licensing limit for a real plant. At 100% there is no cladding left there at all.");
    add("MOLTEN",(s.meltFrac*100).toFixed(1)+" %",
      band(s.meltFrac*100,0,100,[[1e-9,C.cyan,"NONE"],[100,C.red,"MELTING"]],
        {dp:0,lim:[[MELT_LATCH*100,"MELT"]]}),
      "Fuel that is actually liquid, by volume. Cladding has to fail before a pellet can melt, so this can never run ahead of FUEL DAMAGE. Past "+(MELT_LATCH*100).toFixed(0)+"% the plant latches CORE MELT.");
    add("OXIDATION HEAT",(s.qOx*K.rated).toFixed(1)+" MWt",
      s.qOx>s.n*PROMPT_F?C.red:s.qOx>0?C.amber:C.ink2,
      "Heat the burning cladding is making. When this passes what the chain reaction is making, the reaction feeds itself and nothing on this ship can stop it.");
    add("HYDROGEN",s.h2.toFixed(1)+" kg",
        s.h2>0?C.amber:C.ink2,
      "Hydrogen made by steam burning the cladding. It is not modelled as burning here - no explosion, no containment pressure - but it is a direct measure of how much cladding has gone.");
    add.apply(null,rowFat(s));
    R.push({viz:"dmg",tip:DMGVIZ_TIP,title:"FUEL DAMAGE"});
    // the two balances draw in the VITALS panel; the numbers they are a picture OF stay here
    secRow("REACTIVITY");
    for(const r of RHO_ROWS){
      const v = r[1]==="net" ? s.rho : s.parts[r[1]];
      const col = r[1]==="net" ? (Math.abs(v)<50?C.green:(v<0?C.blue:C.red))
                               : (v<0?C.blue:C.amber);
      const lim = r[4] && r[4]();
      add(r[0],(v>=0?"+":"")+v.toFixed(0),col,r[2],
        {f:clamp(v/RHO_BAR,-1,1),full:RHO_BAR,
         m:lim&&lim.map(q=>clamp(q/RHO_BAR,-1,1))});
    }
    // in megawatts, so a decay term compares against a generator's own duty; the bars stay on the shared fractional scale
    secRow("HEAT BALANCE");
    { const hbar=v=>({f:clamp(v/HEAT_BAR,-1,1),full:HEAT_BAR});
      const mw=v=>(v*K.rated).toFixed(1)+" MWt";
      for(const r of HEAT_ROWS){
        const v = r[1]==="prompt" ? HEATBAL.prompt : (s.dec[+r[1][1]]||0);
        add(r[0],mw(v),C.amber,r[2],hbar(v));
      }
      // not red: in a column of readouts red means trouble, and 85 % made is a plant running normally
      add("TOTAL MADE",mw(HEATBAL.heat),C.bright,
        "Everything the core is making, chain reaction and decay heat together. This is the number that heats the coolant, and POWER above is only its first term.",hbar(HEATBAL.heat));
      for(const t of heatSinks())
        add(t.lab,mw(t.v),t.col,t.tip,hbar(t.v));
      add("TOTAL REMOVED",mw(HEATBAL.removal),
        HEATBAL.removal<HEATBAL.heat*.5?C.red:C.green,
        "Everything leaving the core through the generators and any exchangers in front of them. Relief valves and breaks cost inventory and pressure, not T-avg, so they are not on this side.",hbar(HEATBAL.removal));
      // a QUARTER of this plant's own no-sink rate: at the full rate the range it is actually steered in is a sliver
      { const dTfull=Math.max(0.05, K.rated*1000/Math.max(1,loopKg()*P.sat.cp)*0.25);
        add("NET ON T-AVG",(s.dTavg>=0?"+":"")+s.dTavg.toFixed(3)+" K/s",
          s.dTavg>.15?C.red:s.dTavg<-.05?C.blue:C.green,
          "What the difference is doing to the loop temperature right now. Positive is heating up, negative is cooling down, and zero is a plant in balance. Either end of the strip is "+dTfull.toFixed(2)+" K/s, a quarter of what this core alone would do to this loop's own water with no sink at all; the marks are where the reading turns red and blue.",
          // dp: the end labels are tenths of a kelvin a second, and a whole number prints 0.50 as "1"
          {f:clamp(s.dTavg/dTfull,-1,1),full:dTfull,dp:2,
           m:[0.15/dTfull,-0.05/dTfull].map(q=>clamp(q,-1,1))}); }
    }
  } else if(p.role==="rods"){
    secRow("BANK");
    add("BANK POSITION",(s.rodPos*100).toFixed(1)+" %",null,
      "Where the bank stands. 100% is fully inserted, and the rods bite hardest around mid-travel rather than evenly.");
    add("BANK DEMAND",(s.rodDem*100).toFixed(1)+" %",null,
      "Where you have asked the bank to go. The drives walk to it at "+(rodRate()*100).toFixed(1)+" %/s, so this leads the position every time you move the slider.");
    add("WORTH HERE",coreRodWorth(K,s).toFixed(0)+" pcm",null,
      "What the bank is worth where it actually stands, solved on the live flux. Move a cluster inward at the bench and this changes.");
    add("DRIVES",s.rodJam?"JAMMED":"answering",s.rodJam?C.red:C.green,
      "Whether the drive mechanisms answer at all. A hit here jams the bank where it stands, and a scram will not move it either.");
    secRow("TRIP");
    add("SCRAM TIME",(1/K.scram).toFixed(1)+" s",null,
      "How long a full insertion takes on a trip. You bought this at the bench, and faster gear is heavier gear.");
    add("TRIP LATCH",s.scrammed?"LATCHED":"clear",s.scrammed?C.amber:C.green,
      "Whether a trip is latched in. While it is, the drives are pinned fully inserted whatever the slider says.");
    add("RESET WOULD",!s.scrammed?"n/a":resetVeto()?"REFUSE":"clear",
        !s.scrammed?C.ink2:resetVeto()?C.red:C.green,
      "What the trip reset would do if you pressed it now. Armed protection holds a veto for as long as a trip condition is still standing; bypass it and the latch clears on your word alone.");
    secRow("SHAPE");
    add("TILT TRIM",(s.tilt>=0?"+":"")+s.tilt.toFixed(2),
      band(s.tilt,-.3,.3,[[-.05,C.amber,"LEANING"],[.05,C.ink2,"CENTRED"],[.3,C.amber,"LEANING"]],{dp:2}),
      "How far the banks are leaned against each other to shape the flux. Live in GANG only - SPLIT stands it down, because two things cannot own the same spacing.");
    add("TILT DEMAND",(s.tiltDem>=0?"+":"")+s.tiltDem.toFixed(2),
        movingCol(s.tiltDem,s.tilt,.01),
      "Where you have asked the tilt to go. It walks there at drive speed, so it leads the trim above.");
    add("SHUTDOWN MGN",K.sdm.toFixed(0)+" pcm",
      // to -5000, because a graphite plant's bank alone holds it down past -3000
      band(K.sdm,-5000,3000,[[200,C.red,"THIN"],[1000,C.amber,"SLIM"],[3000,C.green,"AMPLE"]],{dp:0}),
      "How firmly the bank ALONE holds this core down once it cools and the xenon decays. Usually negative, and that is what boron is for.");
  } else if(p.role==="sg"){
    secRow("SHELL");
    add.apply(null,rowSgl(s,id));
    // secP(), never a second copy of its formula; the valves are asked of the drawing, and none fitted is a real answer
    { const vents = reliefSecIds().filter(fid => shellsOf(fid).indexOf(id)>=0);
      add("STEAM PRESS",secP(s,id).toFixed(2)+" MPa",
        band(secP(s,id),0,sgBurstP(id),
          [[sgDesignP(id)+(sgBurstP(id)-sgDesignP(id))*SG_P_WARN,C.green,"NORMAL"],
           [sgDesignP(id)+(sgBurstP(id)-sgDesignP(id))*SG_P_HI,C.amber,"HIGH"],
           [sgBurstP(id),C.red,"NEAR BURST"]],{dp:2}),
        "Pressure on the secondary side of THIS generator, and it is what saturation says about the shell temperature below - not a formula about load. Steam raised faster than it can get away puts it up; "+
        (vents.length
          ? vents.map(fid => nameOf(fid)+" lifts at "+reliefSet(fid).lift.toFixed(1)+" MPa").join(", ")+"."
          : "nothing is fitted to let it out, so it climbs until the shell bursts at "+sgBurstP(id).toFixed(1)+" MPa.")); }
    add("SHELL TEMP",sgTemp(s,id).toFixed(0)+" K",null,
      "The temperature of the water and steam in this shell. Heat crosses the tubes on the gap between this and the primary, so a shell that heats up stops cooling the core.");
    secRow("STEAM");
    add("STEAM OUT",(s.steamBy&&s.steamBy[id]||0).toFixed(0)+" kg/s",
      (s.sgVentBy&&s.sgVentBy[id]>0)?C.red:null,
      "What the steam line is actually carrying away. Zero with the shell still boiling means the steam has nowhere to go, and the pressure climbs.");
    // off the same sgHot() the heat term reads: behind a barrier the coolant here is the intermediate circuit's
    secRow("TUBE SIDE");
    { const act=sgActive(id);
      add(act?"T-HOT IN":"INTER IN",sgHot(s,id).toFixed(0)+" K",null,
        act?"Coolant arriving from the core. The gap between this and T-COLD is the heat this unit is taking out."
           :"Intermediate coolant arriving from the exchanger in front. The core's own coolant never reaches this machine.");
      add(act?"T-COLD OUT":"INTER OUT",stageOutT(s,id,0).toFixed(0)+" K",null,
        "Coolant going back the way it came, after the generator has taken its heat."); }
    add("HEAT REMOVED",((HEATBAL.sgQBy[id]||0)/1000).toFixed(0)+" MWt",null,
      "Heat actually crossing these tubes. It is a conductance times the gap between the primary and the shell - not a share of what the turbine asked for.");
    secRow("BOUNDARY");
    add("SHELL",(s.sgBurst&&s.sgBurst[id])?"BURST":"intact",
        (s.sgBurst&&s.sgBurst[id])?C.red:C.green,
      "The secondary pressure boundary. It bursts at "+sgBurstP(id).toFixed(1)+" MPa, and nothing stops it getting there except a relief valve you placed. Burst, it is open to atmosphere: it will not hold pressure again and it stops cooling its loop the moment it is empty.");
    add("TUBES",s.sgtr?"LEAKING":"intact",s.sgtr?C.red:C.green,
      sgActive(id)
        ?"The barrier between primary and secondary. A rupture leaks coolant and activity straight past containment."
        :"The barrier between the intermediate circuit and the secondary. What is in these tubes never came from the core, so a rupture here costs coolant and no activity at all - that is what the exchanger is for.");
  } else if(p.role==="ihx"){
    const served=ihxFeeds(id);
    secRow("EXCHANGER");
    add("T-HOT IN",stageInT(s,id,0).toFixed(0)+" K",null,
      "Coolant arriving on the hot side. The gap between this and INTER IN is what this exchanger has to work across.");
    add("INTER IN",stageInT(s,id,1).toFixed(0)+" K",null,
      "Coolant arriving on the second side, from the circuit behind this machine. It leaves hotter by what crosses the tubes.");
    add("HEAT CROSSED",(((s.ihxQBy&&s.ihxQBy[id])||0)/1000).toFixed(0)+" MWt",null,
      "Heat crossing these tubes into the second circuit. It is bounded by the tube area and by the smaller of the two flows - two stages in series, and each one costs a temperature drop.");
    add("FEEDS",served.length?nameList(served):"nothing",
        served.length?null:C.amber,
      "Which stages stand on this exchanger's second circuit. Traced off the drawing - an exchanger with nothing behind it heats nothing at all.");
  } else if(roleHead(p.role)){
    // a pump panel is about THIS pump: delivered core flow is the core's number and says so from the reactor's panel
    const cav=(s.cavP&&s.cavP[id])||0;
    secRow("PUMP");
    add("PUMP SPEED",(flowOf(s,id)*100).toFixed(1)+" %",
      band(flowOf(s,id)*100,0,110,
        [[5,C.red,"STOPPED"],[40,C.amber,"SLOW"],[110,C.cyan,"RUNNING"]],{dp:0}),
      "How fast THIS pump is actually turning. It is not what reaches the core: a shut valve downstream leaves this at 100% and starves the core anyway. CORE FLOW on the reactor panel is that number.");
    // no scale: a pump sits wherever its own droop curve meets the circuit, which is well past its stated swallow on most presets
    add("PASSING",pumpQOf(s,id).toFixed(0)+" kg/s",null,
      "What this machine is moving right now, against the "+pumpFlow(id).toFixed(0)+" kg/s it was bought to swallow. A pump follows its own curve, so it can pass more than that against an easy circuit and far less against a shut valve. It falls with speed, with cavitation, and with anything the plumbing downstream is doing to it.");
    add("SPEED DEMAND",((s.flowDemBy&&s.flowDemBy[id]!==undefined?s.flowDemBy[id]:1)*100).toFixed(1)+" %",
        movingCol(s.flowDemBy&&s.flowDemBy[id]!==undefined?s.flowDemBy[id]:1,flowOf(s,id),.005),
      "Where you have asked THIS pump to go. The main slider writes every pump at once; this pump's own strip writes only this one. Delivery lags it by "+FLOW_TAU+" s; in a blackout the rotor coasts to half speed in "+(2*PUMP_ROTOR_S)+" s.");
    secRow("SUCTION");
    add("CAVITATION",(cav*100).toFixed(0)+" %",
      band(cav*100,0,100,[[5,C.cyan,"NONE"],[30,C.amber,"CAVITATING"],
        [100,C.red,"BREAKING DOWN"]],{dp:0}),
      "Vapour forming at THIS pump's own inlet because pressure fell too far. It costs head, so losing pressure costs you flow as well. Every pump reads its own suction: two pumps on one loop can be in different trouble, and a feedwater pump is the one a real plant loses this way.");
    add("DEVELOPED HEAD",pumpHead(id).toFixed(2)+" MPa",null,
      "The pressure rise this machine makes at rated speed. It is what the solve is given: what the pump actually delivers is that head against whatever the plumbing and the pressure on the far side cost it.");
    // a readout and not a control: it is this pump's own suction a reserve lining itself up is about
    if(secGensOf(id).length){
      const arm=tankRuleAny(s,tankSecondary), any=secTankIds().some(tid=>D.tanks[tid].auto!=="always"&&D.tanks[tid].auto!=="manual");
      secRow("FEED");
      add("EMERG FEED",!any?"none":arm?"armed":"bypassed",!any?C.ink2:arm?C.green:C.amber,
        "Whether any reserve tank on the secondary side will line itself up without being asked. Its switch is on that TANK's own strip, not here - this is a readout, because it is the generator's feed that it is about. Armed, it also adds a small dump while the reactor is scrammed, running the loop a few degrees cooler. It does not touch grace time.");
    }
  } else if(p.role==="turb"){
    // s.load is a fraction of P.steamRef, a real flow, so the kilograms are a multiplication
    // the scale's ceiling is P.swallow, what the fitted machines can pass, with a tenth of headroom past it
    secRow("LOAD");
    { const sw=Math.max(P.swallow||0,1e-9), top=Math.max(sw,P.steamRef)*1.1;
      add("LOAD",(s.load*P.steamRef).toFixed(0)+" kg/s",
        band(s.load*P.steamRef,0,top,
          [[sw*.02,C.ink2,"SHUT"],[top,C.cyan,"DRAWING"]],{dp:0,lim:[[sw,"SWALLOW"]]}),
        "How hard the turbine is drawing steam, out of the "+P.steamRef.toFixed(0)+" kg/s this plant raises at rating - "+(s.load*100).toFixed(1)+"% of it. The mark is the "+sw.toFixed(0)+" kg/s the fitted machines can actually swallow, and nothing you ask for past it is passed. This is the demand the reactor spends its whole time trying to follow."); }
    add("LOAD DEMAND",(s.loadDem*100).toFixed(1)+" %",
        movingCol(s.loadDem,s.load,.005),
      "Where you have set the load. The governor strokes there over about "+LOAD_TAU.toFixed(0)+" s.");
    add("ELECTRICAL",mwE(s).toFixed(0)+" MWe",null,
      "Electrical power the ship is actually getting. It is the lower of heat made and heat taken, priced by the machine you bought, and it is what a lost turbine or an undersized condenser takes straight off you.");
    secRow("BALANCE");
    add("T-AVG DEV",(s.Tavg-tProg(s)>=0?"+":"")+(s.Tavg-tProg(s)).toFixed(1)+" K",null,
      "How far coolant temperature sits from the programme for this load. Anything but zero means reactor and turbine are out of balance.");
    add("STEAM DUMP",(P.bypass*P.steamRef).toFixed(0)+" kg/s",null,
      "How much steam can go straight past the turbine to the condenser, out of the "+P.steamRef.toFixed(0)+" kg/s this plant raises at rating. It is what absorbs a trip without the relief valve lifting.");
    secRow("GOVERNOR");
    add("GOV STROKE",LOAD_TAU.toFixed(0)+" s",null,
      "How long the governor valves take to answer a change in load demand.");
    // "bypassed" is the WORD the caution list filters on, so it stays the word
    add("RUNBACK",!sinkWired(s,"runback",null)?"not fitted":runbackLive()?"armed":"bypassed",
        runbackLive()?C.green:C.amber,
      "Whether a trip also pulls the turbine back. It is a block in the control cabinet; switch it off and a scram leaves the turbine drawing hard on a dead core, chilling the loop.");
  } else if(p.role==="ctrl"){
    secRow("PROTECTION");
    add("RPS",rpsState().toLowerCase(),rpsLive()?C.green:C.amber,
      "The automatic protection. Live, it trips on eight conditions; bypassed, it watches you run the plant to destruction and says nothing.");
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2,T_TRIP);
    secRow("AUTOMATION");
    { const B=s.blkBy||{}, n=Object.keys(B).length, on=Object.values(B).filter(b=>b.on).length, live=ctlLive(s);
      add("AUTOMATION", n?on+"/"+n+" BLOCKS ON":"none", n?(live?C.green:C.amber):C.ink2,
        "How many blocks are wired in this cabinet and how many are switched on. Every controller on the plant except the protection system is one of these graphs - open this panel to see them.");
      if(n) add("CABINET", live?"computing":supplyK(s)>0?"WRECKED":"DARK", live?C.green:C.red,
        "Whether the blocks are being evaluated. Automation runs on electricity: with the switchboard dark and no backup, or the cabinet hit, every block holds its last output and every demand it owned stays where it was."); }
    secRow("DOSE");
    add("PARTY DOSE",s.dose.toFixed(1)+" %",
      band(s.dose,0,100,[[50,C.cyan,"LOW"],[80,C.amber,"HIGH"],[100,C.red,"AT LIMIT"]],{dp:0}),
      "Radiation your repair parties have taken so far. It costs whatever the job site itself reads, from behind whatever shielding is actually there - this room has nothing to do with it.");
    add("DOSE RATE",s.doseRate.toFixed(2)+" x",
      band(s.doseRate,0,RAD_CEIL,ZONE.map(z=>[z.t,z.col,z.lab]),{dp:2}),
      "How fast dose is piling up right now in the room the crew actually sit in. It moves with what has failed on the plant, not just with where you put the shielding.");
    add("WATCH DOSE",s.crewDose.toFixed(1)+" %",
      band(s.crewDose,0,100,[[50,C.cyan,"LOW"],[80,C.amber,"HIGH"],[100,C.red,"AT LIMIT"]],{dp:0}),
      "Radiation the control-room watch has taken, over the whole run. The watch never leaves this room; the repair party stands wherever the damage is. Different places, different doses - that gap is the entire reason both are tracked.");
    add("AS-BUILT RATE",P.dose.toFixed(2)+" x",C.ink2,
      "What this room was designed to read at rating, with nothing broken. Set it against DOSE RATE above to see how far the accident has pushed you off what you built.");
    secRow("RUN");
    add("EVENTS",LOG.length+"",null,
      "How many things have gone wrong this run. The LOG panel says what each of them was.");
  } else if(p.role==="tank"){
    // every row is read off the instance's own config and its own solved flow
    const t=D.tanks[id], fl=tankFluid(id), rate=(s.tankRate&&s.tankRate[id])||0;
    // asked of the CIRCUIT this vessel stands on, so a second hold tank prints its own numbers
    if(t.hold){
      const ci=tankCircuit(id), set=holdSetP(ci);
      // the VESSEL's own pressure, not its circuit's: the two part the moment a valve isolates it
      const pv=tankP(s,id), live=P.net?holdLive(P.net,s,ci):true;
      const scH=(s.scBy && s.scBy[ci]!==undefined) ? s.scBy[ci] : s.sc;
      secRow("PRESSURE");
      add("PRESSURE",pv.toFixed(2)+" MPa",loopPBand(ci)(pv),
        "The pressure this vessel holds its circuit at. It sets the temperature the coolant boils at, so every megapascal here is thermal margin.");
      // measured off the plant like DNBR's scale; the 8 K SATURATED line stays absolute regardless
      const scHi=Math.max(60,(P.tsat0-P.Tref)*1.25);
      add("SUBCOOLING",scH.toFixed(1)+" K",
        band(scH,0,scHi,[[8,C.red,"SATURATED"],[Math.max(10,P.sc0*.6),C.amber,"THIN"],
          [scHi,C.cyan,"SUBCOOLED"]],
          {dp:0,lim:trip(3,"TRIP")}),
        "Degrees below boiling at this vessel. The honest leak indicator: it collapses before anything else admits the loop is voiding.");
      add("SAT TEMP",tsatSec(loopP(s,ci),ci).toFixed(0)+" K",null,
        "The temperature the coolant would boil at, at the pressure it is held to right now.");
      add("SETPOINT",set.toFixed(2)+" MPa",C.ink2,
        "What this vessel is asked to hold. Set it on the bench; the plant walks its programme about this figure.");
      add("CONTROL",live?"HOLDING":"ISOLATED",live?C.green:C.amber,
        "Whether this vessel still reaches its circuit. Cut it off - a shut nozzle valve, a severed surge line - and it keeps its own bubble while the circuit it left has nothing holding it up.");
    }
    secRow("VESSEL");
    add("CONTENTS",fl.label.toLowerCase()+", "+fl.temp.toFixed(0)+" K",null,
      "What is in this tank. Activity and reactivity worth follow from this and from nothing else"
      +(fl.boron?" - a tank of this is worth "+fl.boron+" pcm for every 1 % of loop inventory it pushes in.":"."));
    // in tonnes: the vessel is cubic metres of a real fluid, so what is in it is a mass
    { const kg=tankKg(id), lv=tankLvl(s,id), held=lv/100*kg/1000, cap=kg/1000;
      // three kinds of good news: a reserve wants to be full, a catch tank empty, and a hold tank at its own mid level
      add("TANK LEVEL",held.toFixed(1)+" t",
        t.hold
          ? band(held,0,cap,[[cap*.20,C.red,"LOW"],[cap*.35,C.amber,"LOW"],
                             [cap*.80,C.cyan,"NORMAL"],[cap,C.amber,"HIGH"]],{dp:1})
          // a catch tank is one full of something ACTIVE, asked of its own fluid and not of which circuit it stands on
          : fl.act>0
          ? band(held,0,cap,[[cap*.10,C.green,"EMPTY"],[cap*.75,C.amber,"FILLING"],
                             [cap,C.red,"FULL"]],{dp:1})
          : band(held,0,cap,[[cap*.15,C.red,"LOW"],[cap*.35,C.amber,"LOW"],
                             [cap,C.cyan,"FULL"]],{dp:1}),
        "How much is left in it, out of "+cap.toFixed(1)+" t the vessel holds - "+lv.toFixed(0)+"% full, and the bar is that share. It is not an infinite reservoir - run it dry and there is nothing behind it, and fill it past full and what will not fit leaves the plant."); }
    if(!t.hold) add("TANK PRESS",tankP(s,id).toFixed(2)+" MPa",null,
      t.gas
        ? "The gas charge behind the contents. It needs no electricity, so it still works in a blackout - and it moves as the level moves, because the gas is expanding or being compressed."
        : "Nothing is holding this tank up. It is vented to the compartment, so it sits at compartment pressure - anything that has to be pushed out of it needs a pump on the board.");
    secRow("LINE-UP");
    add("VALVE",tankOpen(s,id)?"OPEN":"shut",tankOpen(s,id)?C.green:C.ink2,
      "Whether this tank is lined up. Its automatic rule is "+(AUTORULE[t.auto]?AUTORULE[t.auto].label:"none")+", which opens it without you being asked.");
    if(tankPrimary(id)){
      // rounded FIRST, so the colour reads the PRINTED number: a solved rate sits on -1e-17 at rest
      const shown=Math.round(rate/100*loopKg()*10)/10 || 0;
      add("RATE",shown.toFixed(1)+" kg/s",shown>0?C.cyan:shown<0?C.amber:null,
        "What this tank's own line is carrying, positive out. Not a setting: it is what the tank wins against the pressure in the loop, so it is near zero at full pressure and surges once the primary comes down. Negative means the loop is filling it.");
      add("HEAD",((P.lay&&P.lay.tankZ&&P.lay.tankZ[id])||0).toFixed(1)+" m",null,
        "How high this tank stands above the core. It is real static head in the solve: mount it high and it drains in fast, mount it level with the core and it barely trickles.");
    }
    // only where there is something to say: a heading over no rows is a box with nothing in it
    if(t.burst || (s.tankOver&&s.tankOver[id]>0)) secRow("SAFETY");
    if(t.burst) add("RUPTURE DISC",s.burstBy[id]?"BURST":"intact",s.burstBy[id]?C.red:C.green,
      "It lets go at "+t.burst.at.toFixed(2)+" MPa. Past that the tank is an opening to containment: it drains onto the floor and what was in it is in the air, not behind a wall. This is the TMI-2 sequence, and a burst disc does not reseat.");
    if(s.tankOver&&s.tankOver[id]>0) add("OVERFLOW",s.tankOver[id].toFixed(0)+" kg/s",C.red,
      "It is full and cannot take any more. This is leaving the plant, and after a tube rupture it is primary water.");
  } else if(p.role==="bkp"){
    secRow("SUPPLY");
    add("BLACKOUT",s.blackout?"ACTIVE":"no",s.blackout?C.red:C.green,
      "Whether main power to the coolant pumps has gone. Test it from the FAULTS panel before you ever need to know.");
    add("CAPACITY",(P.backup*(P.netRef>0?P.netRef:0)).toFixed(0)+" kg/s",null,
      "Coolant flow your backup supply can still turn, against the "+(P.netRef>0?P.netRef:0).toFixed(0)+" kg/s reference this plant is measured on. Everything above this has to come from buoyancy.");
  } else if(p.role==="radiator"){
    // the LIVE half of the radiator panel: the bench has no S
    secRow("PANEL");
    add("PANEL TEMP",radTOf(s,id).toFixed(0)+" K",
      band(radTOf(s,id),RAD_TDES*0.7,tsatSec(COND_ATM)-COND_DT0,
        [[RAD_TDES,C.cyan,"NORMAL"],[tsatSec(TURB_TRIP_P)-COND_DT0,C.amber,"HOT"],
         [Infinity,C.red,"NO SINK"]],{dp:0,lim:[[RAD_TDES,"DESIGN"]]}),
      "How hot THIS panel is running - its own pot, because a panel cools whatever it is plumbed to and two panels need not be on the same circuit. Design is "+RAD_TDES+" K at rated rejection; rejection goes as the FOURTH power of this, so a modest overload costs little and a large one costs the turbine.");
    add("THIS PANEL SHEDS",(radRejOf(s,id)/1000).toFixed(0)+" MWt",null,
      "What this one panel is radiating. Blind or destroyed, it is zero and the rest of the fleet carries the whole load.");
    add("TAKING FROM WATER",((s.radQBy[id]||0)/1000).toFixed(0)+" MWt",null,
      "What this panel is pulling out of the coolant running through it. Piped to nothing, or with nothing turning that coolant, it is zero however much area the panel has - a radiator is a heat exchanger first and a surface second.");
    add("CAN SHED",radLive(id)?"YES":"NO",radLive(id)?C.green:C.red,
      "Whether this panel has a face on the skin. Walled in, it sheds nothing and warms the compartment instead.");
  } else if(p.role==="cond"){
    // banded against the limit it PRECEDES, never against the vacuum floor
    secRow("VACUUM");
    add("BACK PRESS",condP(s).toFixed(4)+" MPa",
      band(condP(s),0,TURB_TRIP_P,[[TURB_TRIP_P*0.5,C.cyan,"NORMAL"],
        [TURB_TRIP_P*0.8,C.amber,"HIGH"],[Infinity,C.red,"NEAR TRIP"]],
        {dp:4,lim:[[TURB_TRIP_P,"TRIP"]]}),
      "The pressure the turbine has to exhaust against, and it is this machine's own saturation pressure: whatever it cannot reject warms the water it rejects into. Losing vacuum costs the turbine work and, far enough, backs the steam up into the generators. At "+TURB_TRIP_P+" MPa the stop valve shuts, and that trip does not reset. Cutting LOAD will not save it: the bypass sends that steam to this same condenser, and dumping rejects MORE heat than generating, because none of it leaves as electricity. Cut reactor power.");
    add("COND TEMP",condTAt(s,id).toFixed(0)+" K",null,
      "How hot the water in this machine actually is. It moves below the vacuum floor, where BACK PRESS cannot: a condenser with margin sits on that floor and this is what says how much margin. Drowned tubes, a lost circulating water pump or simply too much steam all show up here first.");
    secRow("DUTY");
    add("HEAT REJECTED",(condRejOf(s,id)/1000).toFixed(0)+" MWt",null,
      "Heat being dumped overboard. It is the remainder, after the turbine has taken its share as electricity.");
    add("CW OUTLET",cwOutOf(s,id).toFixed(0)+" K",
      // the scale starts BELOW the inlet: a healthy plant's panels run cooler than their design point
      band(cwOutOf(s,id),RAD_TDES-CW_RISE,RAD_TDES+CW_RISE*3,[[RAD_TDES+CW_RISE*1.6,C.cyan,"NORMAL"],
        [RAD_TDES+CW_RISE*2.5,C.amber,"HIGH"],[Infinity,C.red,"HOT"]],{dp:0}),
      "The temperature the circulating water leaves at. It is what says the sink is finite: the flow carries rated rejection away on about "+CW_RISE+" K of rise, and a machine working harder than it was bought for sends it out hotter.");
    // two pots in series, so the chain is stated end to end and it is visible which one is failing
    add("TERMINAL DIFF",(condTAt(s,id)-cwInAt(s,id)).toFixed(0)+" K",
      band(condTAt(s,id)-cwInAt(s,id),0,COND_DT0*3,[[COND_DT0*1.3,C.cyan,"NORMAL"],
        [COND_DT0*2,C.amber,"WIDE"],[Infinity,C.red,"FOULED"]],{dp:0}),
      "How far this machine sits above the water arriving to cool it. Design is "+COND_DT0+" K at rated duty; a small or a drowned condenser sits further above for the same heat, and pays for it in backpressure.");
    add("DROWNED TUBES",((1-condFrac(s))*100).toFixed(0)+" %",
      band((1-condFrac(s))*100,0,100,[[1,C.cyan,"CLEAR"],[25,C.amber,"FLOODING"],[Infinity,C.red,"DROWNED"]],{dp:0}),
      "How much of the tube bundle is standing in its own condensate. A hotwell that has filled up takes the capacity with it, which is how a turbine ends up exhausting into a full condenser for nothing.");
    secRow("SINK");
    add("REJECTS INTO",radCount()?nameList(radIds().filter(radLive)) || "nothing that can shed":"nothing",
      radCount()&&radIds().some(radLive)?C.green:C.red,
      "Where the heat finally goes. It leaves as light, off the panels, and a panel that cannot see the skin is not in this list.");
    add("CIRC WATER",s.blackout?"STOPPED":"running",s.blackout?C.red:C.green,
      "The circulating water pumps. They sit on the main board, so a blackout stops them dead - and with no water moving there is no heat sink at all, whatever the condenser itself is worth.");
    add("VACUUM",s.condLost?"LOST":"holding",s.condLost?C.red:C.green,
      "Whether this machine still holds a vacuum. Past atmospheric it relieves, the air is in, and it does not come back: the condenser stops being a heat sink for good and the steam backs up into the generators.");
    // a hosted tank has no panel of its own, so it reports here, one row each
    if(hostedTankIds().length) secRow("HOTWELL");
    for(const tid of hostedTankIds()){
      const kg=tankKg(tid), lv=tankLvl(s,tid), cap=kg/1000;
      add(D.tanks[tid].name,(lv/100*cap).toFixed(1)+" t",
        band(lv/100*cap,0,cap,[[cap*.10,C.red,"LOW"],[cap*.95,C.cyan,"NORMAL"],
          [cap,C.amber,"HIGH"]],{dp:1}),
        "Condensate waiting to be pumped back to the generators, out of "+cap.toFixed(1)+" t this pool holds - "+lv.toFixed(0)+"% full. In a healthy plant it does not move: what boils out comes back. It falls when a generator is losing water faster than the feed returns it, and it RISES when a ruptured tube is pushing primary water into the secondary - which is the one that has to be dealt with, because past 100% it overflows and what overflows is contaminated.");
      if(s.tankOver&&s.tankOver[tid]>0) add(D.tanks[tid].name+" OVERFLOW",s.tankOver[tid].toFixed(0)+" kg/s",C.red,
        "It is full and cannot take any more. This water is leaving the plant, and after a tube rupture it is primary water.");
    }
  }
  // shielding has nothing to report, and neither has a component never bought
  if(!R.length||!fitted(p)) return [];
  // one damage row, and the consequence it carries comes off DMGFX
  if(partWrecked(s,p.id)) R.unshift(["STATUS","DESTROYED / "+dmgWhyOf(s,p.id),C.red,
    "This component has taken a hit. "+dmgFx(p.id).why+" Send a party from the REPAIR panel, or from the key drawn on the component itself."]);
  if(!partAccess(p)) R.unshift(["ACCESS","BLOCKED",C.red,
    "Your layout walls this in on every side, so no repair party can ever reach it. It stays broken for the rest of the run."]);
  return R;
}

// every row addresses THIS fitting; the design half is asked once per edit and the live half on every call
const fitDesignMemo=new Map(); let fitDesignGen=-1;
function fitDesign(fid){
  if(fitDesignGen!==DGEN){ fitDesignMemo.clear(); fitDesignGen=DGEN; }
  let d=fitDesignMemo.get(fid);
  if(!d){ const mode=fitModeOf(fid);
    d={mode, dk: mode==="throttle"?fitEdgeKey(fid):null,
       set: mode==="relief"?reliefSet(fid):null,
       shells: mode==="relief"?shellsOf(fid):null,
       refP: mode==="relief"?reliefRefP(fid):0};
    fitDesignMemo.set(fid,d); }
  return d;
}
function readoutsForFit(fid,s){
  const DES=fitDesign(fid), mode=DES.mode;
  const R=[], add=(k,v,c,tip)=>{ const g=(c&&typeof c==="object")?c:null;
    R.push([k,v, g?bandCol(g):(c||C.cyan), tip, g, null]); };
  const secRow=t=>R.push({sec:t});
  const dk = DES.dk;
  if(mode==="relief"){
    const set=DES.set;
    const open = !!s.reliefOpen[fid] && !s.reliefBlocked[fid];
    const blkd = !!s.reliefBlocked[fid];
    // which pressure this valve is about is asked of the drawing, on the same pair the tick lifts on
    const sec = DES.shells.length>0, refP = DES.refP, atP = reliefAtP(s,fid);
    const iso = reliefIso(s,fid);
    secRow("SETPOINTS");
    add("PROTECTS",sec?(iso?"ISOLATED":nameList(shellsLive(s,fid))):"PRIMARY LOOP",
      iso?C.amber:null,
      sec?"The steam generator shells this valve can reach on the steam side. It lifts on the worst of them, which is what a valve on a common header actually sees. A shut port valve on its branch cuts it off from all of them, and a valve that can see no shell can neither lift nor pass."
         :"This valve is on the primary. It lifts on loop pressure and vents inventory through its own branch.");
    add("LIFT SETPOINT",set.lift.toFixed(2)+" MPa",null,
      "Where THIS valve opens on its own. It has an 18% chance of sticking open every single time it lifts.");
    add("RESEAT SETPOINT",set.reseat.toFixed(2)+" MPa",null,
      "Where it shuts again. The gap up to the lift point is its deadband - narrow it and the valve cycles on the setpoint instead of lifting once and clearing it. Both are set at the design bench.");
    // a share of THIS plant's pressure; the 0.3 MPa NEAR LIFT line stays absolute and may sit off the end
    const mlLo=Math.min(-0.1,-refP*.04), mlHi=Math.max(0.4,refP*.12);
    const marg = set.lift - atP;
    add("MARGIN TO LIFT",marg.toFixed(2)+" MPa",
      band(marg,mlLo,mlHi,[[0,C.red,"LIFTED"],[0.3,C.amber,"NEAR LIFT"],[mlHi,C.cyan,"CLEAR"]],{dp:2}),
      "How much pressure is left before this valve lifts by itself. Negative means it is passing right now.");
    secRow("STATE");
    add("PORV",open?"PASSING":"shut", open?C.red:C.green,
      "The valve itself. PASSING means coolant is leaving the loop through it, whether you asked or not.");
    // both sides in kilograms: the primary's share of loop inventory comes back off that same inventory
    if(sec){
      const kg=(s.reliefSteam&&s.reliefSteam[fid])||0;
      const full=SG_RELIEF_CAP*ratedSteam()*fitBoreK(fid)*fitBoreK(fid);
      add("RELIEF FLOW",kg.toFixed(0)+" kg/s",
        band(kg,0,Math.max(full,1e-6),[[1e-9,C.green,"SHUT"],[Math.max(full,1e-6),C.red,"PASSING"]],{dp:0}),
        "Steam leaving this generator to atmosphere through this valve. It goes over the side and the water in it does not come back, so a shell held on its valve boils itself dry. What it can pass is set by its BORE - undersize it and the shell bursts anyway.");
    } else {
      const kgs=loopKg()/100, rate=reliefRate(s,fid)*kgs, full=reliefFullRate(s,fid)*kgs;
      add("RELIEF FLOW",rate.toFixed(1)+" kg/s",
        band(rate,0,Math.max(full,1e-6),[[1e-9,C.green,"SHUT"],[Math.max(full,1e-6),C.red,"PASSING"]],{dp:1}),
        "Coolant leaving the loop through this valve - the network's own solved flow through this valve's branch, not a fixed reference rate. A short, fat run to the tank vents faster than a long, thin one.");
    }
    add("BLOCK VALVE",blkd?"SHUT":"open",blkd?C.red:C.green,
      "Your last defence against this valve sticking open. Shutting it stops the leak and gives this relief path up for good.");
    if(fitSpring(fid)) add("ACTUATION","spring",C.green,
      "A code safety: the spring is the controller. It lifts at its own setpoint with no power, no block and no arm, and nothing in the control room can hold it shut.");
    else { const drv=sinkDriver(s,"relief",fid);
      add("ACTUATION", drv?"PORV, wired "+drv.toUpperCase():"PORV, unwired", drv?C.green:C.amber,
        "A power-operated relief valve: a block in the control room watches its pressure and lifts it. Unwired, or with the cabinet dark, it lifts for nobody and pressure ends at the vessel. Make it a SPRING SAFETY at the bench and it needs none of that."); }
  } else if(mode==="tee"){
    // a tee is one node with four faces: no gate, no position, no state to report
    return R;
  } else {
    secRow("VALVE");
    add("POSITION",(s.valve[fid]*100).toFixed(0)+" %",
      band(s.valve[fid]*100,0,100,[[1,C.ink2,"SHUT"],[100,C.green,"OPEN"]],{dp:0}),
      "Where this throttle actually is. It walks toward the demand below at its motor's own speed.");
    add("DEMAND",(s.valveDem[fid]*100).toFixed(0)+" %",null,
      "Where you have asked it to go.");
  }
  if(dk!=null && pipeDrop[dk]!=null)
    add("HEAD DROP",(pipeDrop[dk]*100).toFixed(0)+" % of span",
      band(pipeDrop[dk]*100,0,100,[[50,C.cyan,"CHEAP"],[80,C.amber,"COSTLY"],[100,C.red,"THROTTLED"]],{dp:0}),
      "The share of the loop's whole pump head this fitting is eating. Position says what you asked for; only this says what it cost.");
  return R;
}

// cached so the bench rail can read the layoutMetrics() drawPlant() already paid for
let PLANT_LM=null;

// a widget hosted in an HTML panel still draws HERE, at the screen box its placeholder occupies
function hostRect(el){
  const rc=cv.getBoundingClientRect(), r=el.getBoundingClientRect();
  const sx=W/rc.width, sy=(H-TOPBAR_H)/rc.height;
  return {x:(r.left-rc.left)*sx, y:(r.top-rc.top)*sy+TOPBAR_H, w:r.width*sx, h:r.height*sy};
}

// a rail widget paints into its own canvas at a FIXED scale, so its type does not grow with the window
// that space starts at 0,0 and so overlaps the plant's, which is why push()/hov() are scoped by host
const HOST_K=1.5;
const hostDpr=()=>(typeof devicePixelRatio==="number"&&devicePixelRatio)||1;
// a whole number of DEVICE pixels per layout unit, or every hairline spreads across two of them
const hostK=()=>{ const d=hostDpr(); return Math.max(1,Math.round(d*HOST_K))/d; };
// offsetWidth is the LAYOUT box and a transform never touches it, so the ratio IS whatever the panel is scaled by
const hostScale=el=>{ const o=el.offsetWidth;
  return o>0 ? el.getBoundingClientRect().width/o : 1; };
function hostLocal(el,e){ const r=el.getBoundingClientRect(), k=hostK()*hostScale(el);
  return {x:(e.clientX-r.left)/k, y:(e.clientY-r.top)/k}; }
function hostForward(el){ uiForward(el, e=>hostLocal(el,e)); }
function hostPaint(el,draw,arg){
  const box=el.getBoundingClientRect();
  if(box.width<4||box.height<4) return;
  const dpr=hostDpr(), k=hostK()*hostScale(el);
  const bw=Math.max(1,Math.round(box.width*dpr)), bh=Math.max(1,Math.round(box.height*dpr));
  if(el.width!==bw||el.height!==bh){ el.width=bw; el.height=bh; }
  const c=el.getContext("2d"), s=dpr*k, w=box.width/k, h=box.height/k;
  c.setTransform(s,0,0,s,0,0);
  c.clearRect(0,0,w,h);
  const prev=ctx; ctx=c; hostScope(el);
  try{ draw(0,0,w,h,arg); } finally { ctx=prev; hostScope(null); }
}

// the leader starts at the candidate point furthest from any pipe landing on the face; the middle is first in the list
const LEADER_SPOTS=[0.5,0.30,0.70,0.14,0.86];
const LEADER_CLEAR=7;
function leaderAnchor(a,face){
  const flat = face==="t"||face==="b";           // the face runs left-right
  const fx = face==="l"? a.x : a.x+a.w, fy = face==="t"? a.y : a.y+a.h;
  const at = t => flat? {x:a.x+a.w*t, y:fy} : {x:fx, y:a.y+a.h*t};
  // every pipe vertex sitting on this face, whichever run it belongs to
  const on=[];
  for(const r of pipeNetwork()) for(const q of r.pts){
    if(flat){ if(Math.abs(q[1]-fy)<=3 && q[0]>=a.x-2 && q[0]<=a.x+a.w+2) on.push(q[0]); }
    else    { if(Math.abs(q[0]-fx)<=3 && q[1]>=a.y-2 && q[1]<=a.y+a.h+2) on.push(q[1]); }
  }
  if(!on.length) return at(0.5);
  let best=null;
  for(const f of LEADER_SPOTS){
    const p=at(f), v=flat?p.x:p.y;
    let d=Infinity;
    for(const q of on) d=Math.min(d,Math.abs(q-v));
    if(d>=LEADER_CLEAR) return p;
    if(!best||d>best.d) best={p,d};
  }
  return best.p;
}

// the PATH is always in layout units; `ink` and `rad` are the caller's, because a rail leader and a margin leader are in different spaces
const LEADER_RAD=8;
function leaderStroke(pts,col,caps,ink,rad){
  if(pts.length<2) return;
  const k=ink;
  ctx.save();
  ctx.lineCap="square"; ctx.lineJoin="round";
  ctx.strokeStyle=col; ctx.lineWidth=2*k;
  // one path, not a line() per leg: arcTo needs the run either side of a corner to round it
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i], a=pts[i-1], b=pts[i+1];
    ctx.arcTo(p.x,p.y,b.x,b.y, Math.min(rad,
      Math.hypot(p.x-a.x,p.y-a.y)/2, Math.hypot(b.x-p.x,b.y-p.y)/2));
  }
  const e=pts[pts.length-1]; ctx.lineTo(e.x,e.y);
  ctx.stroke();
  for(const c of caps||[]) fillRect(c.x-2*k,c.y-2*k,4*k,4*k,col);
  ctx.restore();
}

// redrawn every frame in LAYOUT space, outside the view transform, off the live DOM box: no listeners
function leaderLine(panelEl,railEl){
  const part=LAY&&partOf(sel);
  if(!part||!panelEl||!railEl) return;
  const r=hostRect(railEl), q=hostRect(panelEl);
  if(r.w<2||r.h<2||q.h<1) return;                 // rail unlaid, or a panel hidden by display:none
  const pad=3, vx0=VIEW.x+pad, vx1=VIEW.x+VIEW.w-pad, vy0=VIEW.y+pad, vy1=VIEW.y+VIEW.h-pad;
  if(vx1<=vx0||vy1<=vy0) return;
  // clamped, not culled: panned off the plant it pins to the viewport edge and still says which way the component went
  const s0 = vScr(leaderAnchor(prect(part),"r"));
  const sx=clamp(s0.x,vx0,vx1), sy=clamp(s0.y,vy0,vy1);
  // scrolled away it takes the first turn only and runs off the canvas, never claiming an attachment the rail edge has not got
  const ey0=q.y+q.h/2, vis=ey0>=r.y+4&&ey0<=r.y+r.h-4;
  const ey=vis? ey0 : (ey0<r.y? TOPBAR_H : H);
  if(r.x-sx<8) return;                            // rail sits on the plant, no room to turn
  const gx=(sx+r.x)/2;                            // turn halfway across, not against the rail
  const a={x:sx,y:sy}, b={x:vis?r.x:gx, y:ey};
  const pts = Math.abs(sy-ey)<1 ? [a,b]
    : vis ? [a,{x:gx,y:sy},{x:gx,y:ey},b] : [a,{x:gx,y:sy},b];
  // a square CENTRED on each attached end; a panel scrolled out of the rail gets none, because it is attached to nothing
  leaderStroke(pts, C.amber, vis? [a,b] : [a], cvPx(), LEADER_RAD);
}

// the hull picture is a pure function of the hull, so it is baked once at device scale and blitted
// the view's sub-pixel offset is baked in and quantised to a quarter pixel, or a pan rebuilds it every frame
let backCv=null, backKey="";
function plantBack(L,GHp,rowH){
  const m=ctx.getTransform&&ctx.getTransform();
  // the headless DOM has no bitmap to bake into, and a headless reader must still see these rectangles
  if(!m||!m.a){ plantBackPaint(L,GHp,rowH); return; }
  const sc=m.a;
  // only what is on screen is baked, quantised to a cell so a pan reuses it
  const cvw=ctx.canvas?ctx.canvas.width:0, cvh=ctx.canvas?ctx.canvas.height:0;
  const bx0=Math.max(GX-EL_GUT, Math.floor(((0-m.e)/m.a-CELL)/CELL)*CELL);
  const by0=Math.max(GY,        Math.floor(((0-m.f)/m.d-CELL)/CELL)*CELL);
  const x0=bx0, y0=by0;
  const w=Math.min(GX-EL_GUT+GW*CELL+EL_GUT, Math.ceil(((cvw-m.e)/m.a+CELL)/CELL)*CELL)-x0;
  const h=Math.min(GY+GHp,                   Math.ceil(((cvh-m.f)/m.d+CELL)/CELL)*CELL)-y0;
  if(w<=0||h<=0) return;
  const dx=m.a*x0+m.c*y0+m.e, dy=m.b*x0+m.d*y0+m.f;
  const ix=Math.floor(dx), iy=Math.floor(dy);
  const q=v=>Math.round(v*4)/4, fx=q(dx-ix), fy=q(dy-iy);
  const key=[GW,GH,GY,sc.toFixed(4),fx,fy,x0,y0,w,h,L?1:0].join("|");
  if(key!==backKey){
    if(!backCv) backCv=document.createElement("canvas");
    const bw=Math.ceil(w*sc)+2, bh=Math.ceil(h*sc)+2;
    if(backCv.width!==bw||backCv.height!==bh){ backCv.width=bw; backCv.height=bh; }
    const c=backCv.getContext("2d");
    c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,bw,bh);
    c.setTransform(sc,0,0,sc, fx-x0*sc, fy-y0*sc);
    const prev=ctx; ctx=c;
    try{ plantBackPaint(L,GHp,rowH); } finally { ctx=prev; }
    backKey=key;
  }
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(backCv,ix,iy); ctx.restore();
}
function plantBackPaint(L,GHp,rowH){
  fillRect(GX,GY,GW*CELL,GHp,C.well);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(X===0||X===GW-1||Y===0||Y===GH-1) fillRect(GX+X*CELL,rowTop(Y),CELL,rowH(Y),"#1c1210");
  // opaque, so a line reads the same wherever it lands: pre-blended onto C.well
  const gl = L? "#080d0f" : "#0a1011";
  // a grid line is a FRACTION of the cell it bounds, never one unit
  const glw = 1*DRAW_K;
  for(let X=0;X<=GW;X++) fillRect(GX+X*CELL,GY,glw,GHp,gl);
  for(let Y=0;Y<=GH;Y++) fillRect(GX,rowTop(Y),GW*CELL,glw,gl);
  frame(GX,GY,GW*CELL,GHp,C.edge2);
  // outside the hull, clear of the FWD BULKHEAD label and the first column of cells
  for(let Y=0;Y<GH;Y++)
    txt("EL"+pad(GH-1-Y,1),GX-4*DRAW_K,rowTop(Y)+11*DRAW_K,
        {size:6.5*DRAW_K,align:"right",color:"#2c4148"});
  const deck={size:7*DRAW_K,sp:1.6*DRAW_K,align:"center",color:"#5a3128"};
  txt("KEEL / HULL",GX+GW*CELL/2,GY+GHp-6*DRAW_K,deck);
  txt("UPPER DECK / HULL",GX+GW*CELL/2,GY+12*DRAW_K,deck);
  ctx.save(); ctx.translate(GX+11*DRAW_K,GY+GHp/2); ctx.rotate(-Math.PI/2);
  txt("FWD BULKHEAD",0,0,deck); ctx.restore();
  ctx.save(); ctx.translate(GX+GW*CELL-7*DRAW_K,GY+GHp/2); ctx.rotate(Math.PI/2);
  txt("AFT BULKHEAD",0,0,deck); ctx.restore();
}

const HULL_GRIP_PX=10;
// vx/vw are the viewport's left edge and width, so the canvas never draws under a docked panel
function drawPlant(y0,L,vh,vx,vw,padX,padY){
  PLANT_LM=layoutMetrics(); GY=y0;
  layerTick();                                     // one memo/frame
  // one clock a frame, the PLANT's, at the rate the tape is SET to; the bench has no plant, so it gets wall seconds
  fxSetClock(L ? L.t : fxWall(), L ? trClockRate() : 1);
  const GHp=gridH(), rowH=Y=>rowTop(Y+1)-rowTop(Y);
  // the content box is the grid plus the elevation gutter, and while a wall is dragged it covers the GHOST too
  const dh=ui.drag&&ui.drag.type==="hull"?ui.drag:null;
  const fitW=Math.max(GW,dh&&dh.gw||0)*CELL, fitH=Math.max(GHp,(dh&&dh.gh||0)*CELL);
  // the view is a WINDOW on the ship, stated in cells: the second half of the CELL knob
  const win=Math.min(VIEW_CELLS_W, GW), winH=Math.min(VIEW_CELLS_H, GH);
  vFit(vx==null?GX:vx, GY, vw==null?(W-2*GX):vw, vh||GHp, GX-EL_GUT, GY, fitW+EL_GUT, fitH,
       padX, padY, win*CELL+EL_GUT, winH*CELL);
  vPtrSet();                                       // before the transform - see vPtr (core/ui.js)
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  // vOrigin() is the one place the letterbox is computed, and the hit test reads the same one
  { const o=vOrigin(); ctx.translate(o.x,o.y); }
  ctx.scale(VIEW.s,VIEW.s);
  // the kick is a fraction of a cell, like every other drawn size
  { const k=burnShakeAt()*DRAW_K;
    if(k) ctx.translate(burnShakeRnd(0)*k, burnShakeRnd(1)*k); }
  viewOn=true;
  plantBack(L,GHp,rowH);
  // only the two walls that can move without renumbering every cell under them; bench only, a commissioned ship is welded
  if(!L){
    // the handle is put away until the hand is on its own wall, but the hit stays live either way
    // screen furniture straddling the wall, but never wider than the cell it stands in when zoomed out
    const t=Math.min(HULL_GRIP_PX/VIEW.s, CELL);
    const grab=(edge,title,body)=>{
      const r = edge==="r" ? {x:GX+GW*CELL-t/2, y:GY, w:t, h:GHp} : {x:GX, y:GY+GHp-t/2, w:GW*CELL, h:t};
      const zone = edge==="r" ? {x:GX+(GW-1)*CELL, y:GY, w:CELL+t/2, h:GHp} : {x:GX, y:rowTop(GH-1), w:GW*CELL, h:CELL+t/2};
      const wd=push({...r,type:"hull",edge});
      const held = !!ui.drag&&ui.drag.type==="hull"&&ui.drag.edge===edge;
      if(held || hovHold({...zone,v:1,host:ui.host})){ const b=t/3, col=held||hov(wd)?C.amber:"#3a2a22";
        if(edge==="r") fillRect(r.x+(t-b)/2, r.y, b, r.h, col); else fillRect(r.x, r.y+(t-b)/2, r.w, b, col); }
      TIP(r.x,r.y,r.w,r.h,title,body);
    };
    grab("r", "AFT BULKHEAD",
      "Drag it aft to make the ship longer, forward to make it shorter. Every machine standing outside the hull is marked and blocks commissioning until it is dragged back in.");
    grab("b", "KEEL",
      "Drag it down to make the ship deeper, up to make it shallower. Every machine standing outside the hull is marked and blocks commissioning until it is dragged back in.");
    // the board is not re-laid until the release, so the size under the hand is drawn rather than built
    if(ui.drag&&ui.drag.type==="hull"){ const d=ui.drag;
      frame(GX, GY, (d.gw||GW)*CELL, (d.gh||GH)*CELL, C.amber); }
  }

  // dark casing, then the coloured fluid line inside it, both on concentric radii so a pipe bends rather than folds
  const PC=pipeColours(L), NET=pipeNetwork();
  pipeFieldRefresh(L);          // one solve read per frame, shared by every gauge and both pressure layers
  pipeHovResolve();             // AFTER it: the label boxes it asks about are allocated in there
  // a cell no connection claims is still pipe on the grid; dashed grey says so in the picture
  pipeLoose(L);
  for(const pass of [0,1]) for(const r of NET){
    if(pass&&r.k==="hpi"&&L){ const tid=runTankId(r.key); if(tid&&!tankLive(L,tid)) continue; }   // a VIEW declutter
    ctx.lineCap="square"; ctx.lineJoin="round";
    // BORE is the fluid line's width and WALL the casing beyond it; a run states both in millimetres
    const w = pipeWidth(runBore(r)), cw = w + 2*pipeWallPx(r);
    // ONE radius for every stroke of this run, off the CASING - see pipeBendPath()
    const dp = runDrawPts(r, cw);
    pipeBendPath(dp.pts, dp.R);
    // the outline is around the CASING, so the highlight is the pipe's own shape; a selected run keeps it without the pointer
    if(!pass && (pipeHov===r.key || sel===runIdOf(r))){
      ctx.lineWidth=cw+3*DRAW_K; ctx.strokeStyle=C.amber; ctx.stroke(); }
    ctx.lineWidth = pass? w : cw;
    // a severed run is destroyed along its WHOLE length: the same two marks pipeDamage() puts on the torn cell
    const cut = runCut(r,L);
    // the bore is the colour of what is IN it; the casing is the pipe itself and does not change with its contents
    ctx.strokeStyle = pass? (cut?C.well:pipeStroke(r,PC,L)) : (cut?C.red:PIPE_CASE);
    ctx.stroke();
  }
  ctx.lineJoin="miter";
  if(L) pipeFlow(L);
  // AFTER the packets: a broken cell is EMPTY, and a packet drawn over it insists the run still carries something
  if(L) pipeDamage(L);
  // a wall is structure and the run behind it is a PENETRATION, so the wall is in front and what is written on the run passes under it
  pipeSizeLabels(NET,L);
  matPaintDraw(L);
  // over the pipes, under the machines: the cells a layer may cover here are exactly the cells a repair party could stand in
  layerPass("under",L);
  // one cell, one tooltip, on no switch: before the component loop, because a machine's own tooltip is the more specific answer
  roomCellTip(L);

  const tags=[];                // drawn last
  // the mark stands on the machine's own name row, so it is painted after the name, the symbol and every tag
  const wdots=[];
  for(const p of LAY.parts){
    const {x,y,w,h}=prect(p);
    const fit = fitted(p), live = L && fit;
    // a control is on the machine's PANEL, never on the drawing, so a box reserves nothing but its name row
    const dmgd = live && partWrecked(L,p.id);
    const sh = 0;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p;
    const hovd = hov(wd)||drag;
    const ink = !fit?"#3c4c47" : dmgd?C.red : hovd?C.bright : C.metal;
    // not a valve's: a fitting says it on its own glyph, so the word is not stacked into a label over the pipework
    const stw = live && p.role!=="fitting" ? partStateWord(p) : null;
    const nameH = nameRowH(p);
    const symFull = p.role==="tank";
    // the shell sits 1 symbol unit in from the footprint and the case takes it back, both in SCREEN px
    const boxR = symFull ? (tankRad(p.id)+1)*DRAW_K : 0;
    const boxPath=()=>{ ctx.beginPath(); rr(x,y,w,h,boxR); };
    // the machine leans off its grid cell; its name, lamp, tags and hit rect do not
    const lean = live ? partLean(p) : {x:0,y:0};
    ctx.save(); ctx.translate(lean.x, lean.y);
    if(fit){ if(boxR){ boxPath(); ctx.fillStyle=C.machBg; ctx.fill(); }
             else fillRect(x,y,w,h,C.machBg); }
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    // a tank's shell is the one glyph whose SIZE is the design figure, so it takes the whole footprint
    if(fit && (symFull || h-sh-nameH > 0))
      drawSym(p, x, symFull?y:y+nameH, w, symFull?h:h-sh-nameH, ink, L);
    layerPass("skin", L, p);
    if(dmgd) hatch(x+3,y+3,w-6,h-6,C.red,.4);
    else if(!partAccess(p) && fit) cornerTab(x+w,y,9,C.amber);
    // a part in limbo keeps the mark the drop preview gave it, so letting go changes nothing but that it is now true
    if(p.limbo){ ctx.save(); ctx.setLineDash([4,4]);
      fillRect(x,y,w,h,"rgba(255,90,69,.10)"); frame(x,y,w,h,C.red); ctx.restore(); }
    ctx.restore();
    // deferred, so the plate, the symbol and the selection frame all pass underneath the mark
    const mark = fit ? (L ? annLamp(p.id) : (dmgd?null:warnFor(p.id))) : null;
    if(mark){ const c=nameMark(x,y,nameH);
      wdots.push(()=> L ? lamp(c.x,c.y,MARK_R,mark) : dot(c.x-MARK_R,c.y-MARK_R,MARK_R*2,mark)); }
    // off the same partFloodLine() the panel's HOLDS row and the drowning sweep read
    if(live){ const fl=partFloodLine(L,p);
      if(fl!==null){ const wy=Math.max(y, rowTop(Math.max(0,Math.ceil(fl))));
        if(wy < y+h){ ctx.save(); ctx.globalAlpha=0.32;
          fillRect(x,wy,w,y+h-wy,C.blue); ctx.globalAlpha=1;
          ctx.strokeStyle=C.blue; ctx.lineWidth=1.2;
          ctx.beginPath(); ctx.moveTo(x,wy+0.6); ctx.lineTo(x+w,wy+0.6); ctx.stroke();
          ctx.restore(); } } }
    // a blast leaves a scar and is history; a live squeeze pulses and goes away when the pressure does
    if(live && !dmgd){ const lim=partPburst(p);
      if(lim) fxPulse(x+2,y+2,w-4,h-4,C.red,
        fxEase(p.id+":sqz", roomPAt(L,p) >= lim*0.6 && !L.roomBurnOn ? 1 : 0), 1.1); }
    // selection is an OUTLINE, one stroke for both shapes, inset by half the pen so it lands inside the box
    if(on){ const lw=1*DRAW_K, i=lw/2; ctx.beginPath();
      rr(x+i,y+i,w-lw,h-lw,Math.max(0,boxR-i));
      ctx.strokeStyle=C.amber; ctx.lineWidth=lw; ctx.stroke(); }
    // a wrecked machine has no reading: the box, the tear and the REPAIR key are what it has to say
    const v = L&&fit&&!dmgd ? liveValue(p,L) : null;
    // clipTxt with the ladder off, not fitTxt: a narrow machine must not get a smaller name than its neighbour
    // the cause takes the state word's slot: a wreck has no state left to be in
    const nmw=partName(p)+(dmgd?"  "+dmgWhyOf(L,p.id):(stw?"  "+stw:""));
    if(fit && nameH){
      const nmo=Object.assign({},NAME_TXT,{color:dmgd?C.red:(stw?C.amber:(on?C.amber:C.ink2))});
      // a full-box symbol runs under its own name, so the name carries a ground - held clear of the CASE, which is the drawing
      if(symFull){
        const inner=nameInner(w), ls=nameLines(nmw,w);
        let nb=y+nameH-3*DRAW_K, mw=0;
        for(const l of ls) mw=Math.max(mw,tw(l,nmo));
        txtPlate(x+w/2,nb,Math.min(mw,inner),NAME_TXT.size,(ls.length-1)*NAME_LH,C.machBg);
        for(const l of ls){ clipTxt(l,x+w/2,nb,inner,nmo); nb+=NAME_LH; }
      } else clipTxt(nmw,x+w/2,y+nameH-3*DRAW_K,w-8*DRAW_K,nmo);
    }
    // asked whether or not there is a value to print: the PLACE is the machine's, and the REPAIR key stands in it too
    const vb = fit ? valueBase(p,x,y,w,h,sh,nameH,nmw) : null;
    // the repair key stands where the value tag does, in the last pass, so nothing can be drawn over a key you must press
    const rb = vb!=null ? vb : y+nameH+(h-sh-nameH)/2+3;
    const busy = dmgd && L.repair && L.repair.id===p.id;
    // on hover, or while a party is on it: the progress figure is the only report that stands on the machine itself
    const showRep = dmgd && (hovd||busy);
    tags.push(()=>{
      // a fitting's name is put away until the hand is on it, on the same terms as its handles
      if(!nameH && (p.role!=="fitting" || hovd || on))
        tag(nmw,x+w/2,y-3*DRAW_K,6.5*DRAW_K,.4*DRAW_K,!fit?"#3c4c47":(dmgd?C.red:(stw?C.amber:(on?C.amber:C.ink2))));
      // annLamp() is the SAME predicate as the lamp already on this box, so the number and the lamp cannot disagree
      if(v!=null && vb!=null && !showRep)
        tag(v,x+w/2,vb,VAL_TXT_SIZE,0,dmgd?C.red:(annLamp(p.id)||(on?C.amber:C.ink2)));
      if(showRep){ const kw=Math.min(w-8*DRAW_K,86*DRAW_K), kx=x+(w-kw)/2;
        button(kx,rb-11*DRAW_K,kw,BTN_H,busy?Math.round(L.repair.t/L.repair.need*100)+"%"
               :partAccess(p)?"REPAIR":"NO ACCESS",
          {sunk:1,on:busy,danger:!partAccess(p),size:7*DRAW_K,sp:.8*DRAW_K,fn:()=>act("repair",p.id)}); }
      if(!fit) tag("NOT FITTED",x+w/2,y+h/2+2*DRAW_K,6*DRAW_K,.2*DRAW_K,"#3c4c47");
    });
    // pushed LAST so findTip()'s backwards match doesn't swallow a control's own tooltip
    TIP(x,y,w,h,partName(p)+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ "+dmgWhyOf(L,p.id)+" ]":"")+
        (partAccess(p)?"":"  [ NO ACCESS ]"),
      (L?opTipOf(p):p.tip)+(partAccess(p)?"":" It is boxed in on every side - nobody could reach it to repair it.")
        +(L?pipeThru(p,L):""));
  }
  pipeNozzles(NET,L);           // the joint, over the shell it lands on
  // a joint STRADDLES a shell, so its valve goes after the component loop: order is priority, and the port is the smaller target
  if(L) drawPortValves(L);
  // what is in the room is IN FRONT of what stands in it, so the compartment layers go over the joints too
  layerPass("env",L);
  // the plumes go down BEFORE the layer pass: an effect is behind an instrument, and no switch may turn off the picture of a hole
  if(L) pipeBreaks(L);
  if(L) roomBurnFx(L); else burnIdle();
  layerPass("over",L);          // instruments and annotations, on top of the machines
  // the pressurizer's dial is not a layer: it is the only instrument plant pressure has, so no switch stands it down
  if(L) pipeVessel(L);
  // order is priority: the hit test takes the LAST widget pushed
  if(!L){ partGhost();                  // where a machine would land...
          drawPortMarks();              // ...every port already placed...
          drawGhostPort();              // ...where the next pipe would start...
          drawRunGrips(); }             // ...and the grips on the one picked
  pipeFitMarks(L,NET);
  pipeStackFlush();             // every run reading, one plate per stack
  if(L) drawHitAim();           // what the aimed hit would wreck, over the machine it names
  for(const t of tags) t();     // every name and value, over the pipework
  for(const d of wdots) d();    // ...and every alarm mark over all of them
  // the hovered port's ring last of all; strokeRect and not frame(), whose snap to whole screen pixels leaves it lopsided
  if(portRing){ const r=portRing;
    ctx.strokeStyle=C.amber; ctx.lineWidth=1;
    ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1);
    portRing=null; }
  viewOn=false; ctx.restore();

  return VIEW.y+VIEW.h;
}

// the keys are real HTML buttons, not pictures: they must not grow with the window the way the canvas does
// one ZOOM key, snapping between the working view and the whole ship; vFitAll() is the z the content box fits at
const zoomedOut=()=>VIEW.z < vFitAll()*1.02;
function zoomToggle(){
  if(zoomedOut()){ const p=partOf(sel), r=p&&prect(p);
    // vCenterOn() is the one writer, so the key and the WASD walk cannot frame a machine differently
    vScale(1);
    vCenterOn(r || {x:GX, y:GY, w:GW*CELL, h:gridH()}); }
  else { VIEW.ox=VIEW.oy=0; vScale(vFitAll()); }
  uiDirty();
}
function zoomKeySync(mount){
  if(!mount) return;
  let keys=mount.querySelector(".plant-keys");
  if(!keys){ keys=document.createElement("div"); keys.className="plant-keys";
    const nb=document.createElement("button");
    nb.className="kit-btn kit-btn-sunk plant-zoom";
    MOUSE.on(nb,{click:zoomToggle});
    keys.append(layerMenu().el, nb);
    mount.appendChild(keys); }
  const b=keys.querySelector(".plant-zoom");
  const z=!zoomedOut();
  const want=z?"SHIP":"BOARD "+VIEW.z.toFixed(2)+"X";
  if(b.textContent!==want) b.textContent=want;
  b.title=(z?"FIT THE WHOLE SHIP":"BACK TO THE BOARD")+
    "\nThe plant view pans and zooms. Roll the wheel over it to zoom about the pointer, hold the RIGHT button to drag the plant about, and this key jumps between the whole plant and a close look at whatever component is selected.";
}
