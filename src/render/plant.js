"use strict";
/* drawPlant(): the one plant renderer, used by both screens */

/* ══════════ ONE PLANT RENDERER, USED BY BOTH SCREENS ══════════
   design mode: static, selectable, draggable.   live mode: same symbols, animated. */
function drawSym(p,x,y,w,h,ink,L){
  const cx=x+w/2, X=x+5, Y=y+5, W=w-10, Hh=h-10;
  const shell=fn=>{ ctx.beginPath(); fn(); ctx.fillStyle=C.panel; ctx.fill();
    ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke(); };
  const lvl=(fx,fy,fw,fh,frac,col)=>{ const t=clamp(frac,0,1);
    ctx.save(); ctx.globalAlpha=.45; fillRect(fx,fy+fh*(1-t),fw,fh*t,col); ctx.restore(); };
  const id=p.id;
  if(id==="core"){
    shell(()=>{ ctx.moveTo(X,Y+10); ctx.quadraticCurveTo(cx,Y-6,X+W,Y+10);
      ctx.lineTo(X+W,Y+Hh-10); ctx.quadraticCurveTo(cx,Y+Hh+6,X,Y+Hh-10); ctx.closePath(); });
    const bx=X+7,by=Y+22,bw=W-14,bh=Hh-42;
    fillRect(bx,by,bw,bh,C.well);
    if(L) lvl(bx,by,bw,bh,clamp((L.inv-88)/12,0,1),L.dnbr<1.3?C.red:C.blue);
    else  lvl(bx,by,bw,bh,1,C.blue);
    if(L&&L.melt){ ctx.globalAlpha=.55+.4*Math.abs(Math.sin(performance.now()/300));
      fillRect(bx,by+bh*.62,bw,bh*.38,"#ff5a45"); ctx.globalAlpha=1; }
    if(L&&L.dmg>0.1) hatch(bx,by,bw,bh,C.red,clamp(.2+L.dmg/140,.2,.85));
    frame(bx,by,bw,bh,ink);
    for(let i=0;i<4;i++) fillRect(bx+4+i*((bw-8)/4),by+2,3,bh-4,"rgba(185,205,210,.35)");
  } else if(id==="rods"){
    shell(()=>ctx.rect(X+8,Y+2,W-16,Hh-10));
    const ins = L? 6+L.rodPos*16 : 10;
    for(let i=0;i<5;i++) fillRect(X+12+i*((W-24)/5),Y+Hh-10,4,ins,
      (L&&L.rodJam)?"#8a7a4a":"#b9cdd2");
  } else if(id==="pzr"){
    shell(()=>rr(X,Y+8,W,Hh-8,W/2.6));
    ctx.save(); ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.clip();
    lvl(X,Y+8,W,Hh-8, L? L.lvl/100 : .54, C.blue); ctx.restore();
    ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
    const open = L && L.porvOpen && !L.porvBlocked;
    ctx.beginPath(); ctx.moveTo(cx-6,Y+8); ctx.lineTo(cx+6,Y); ctx.lineTo(cx+6,Y+8);
    ctx.lineTo(cx-6,Y); ctx.closePath(); ctx.fillStyle=open?C.red:C.green; ctx.fill();
  } else if(id.startsWith("sg")){
    shell(()=>{ ctx.moveTo(X,Y+12); ctx.quadraticCurveTo(cx,Y-4,X+W,Y+12);
      ctx.lineTo(X+W,Y+Hh); ctx.lineTo(X,Y+Hh); ctx.closePath(); });
    ctx.save(); ctx.beginPath(); ctx.rect(X,Y+12,W,Hh-12); ctx.clip();
    lvl(X,Y+12,W,Hh-12, L? L.sgl/100 : .5, C.blue); ctx.restore();
    ctx.beginPath(); ctx.moveTo(X+7,Y+Hh-4); ctx.lineTo(X+7,Y+Hh*.4);
    ctx.quadraticCurveTo(cx,Y+Hh*.18,X+W-7,Y+Hh*.4); ctx.lineTo(X+W-7,Y+Hh-4);
    ctx.strokeStyle=ink; ctx.lineWidth=1.6; ctx.stroke();
  } else if(id.startsWith("pump")||id==="feed"){
    const r=Math.min(W,Hh)/2-1, cy=y+h/2;
    shell(()=>ctx.arc(cx,cy,r,0,7));
    ctx.save(); ctx.translate(cx,cy); if(L) ctx.rotate(L.spin*Math.PI/180);
    ctx.beginPath(); ctx.moveTo(-r*.45,-r*.55); ctx.lineTo(r*.7,0); ctx.lineTo(-r*.45,r*.55);
    ctx.closePath(); ctx.fillStyle=ink; ctx.fill(); ctx.restore();
    if(L&&L.cav>.15){ ctx.beginPath(); ctx.arc(cx,cy,r+3,0,7); ctx.strokeStyle=C.amber;
      ctx.lineWidth=1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); }
  } else if(id==="turb"){
    shell(()=>{ ctx.moveTo(X,Y+3); ctx.lineTo(X+W,Y-2); ctx.lineTo(X+W,Y+Hh+2);
      ctx.lineTo(X,Y+Hh-3); ctx.closePath(); });
    for(let i=1;i<5;i++) fillRect(X+i*(W/5),Y+4,1,Hh-8,"rgba(140,170,178,.5)");
  } else if(id==="cond"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    for(let i=1;i<7;i++) fillRect(X+i*(W/7),Y+5,1,Hh-10,"rgba(140,170,178,.45)");
  } else if(id==="ctrl"){
    shell(()=>{ ctx.moveTo(X,Y+Hh); ctx.lineTo(X,Y+6); ctx.lineTo(X+W,Y+2);
      ctx.lineTo(X+W,Y+Hh); ctx.closePath(); });
    for(let i=0;i<3;i++) fillRect(X+6+i*((W-12)/3),Y+9,(W-18)/3,4,"rgba(95,210,226,.45)");
  } else if(id==="cont"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4)); hatch(X+1,Y+3,W-2,Hh-6,ink,.35);
  } else if(id==="hpi"){
    shell(()=>rr(X,Y+2,W,Hh-4,6));
    lvl(X+2,Y+4,W-4,Hh-8, 1, (L&&L.hpi)?C.cyan:C.blue);
  } else if(id==="bkp"){
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    fillRect(X+4,Y+6,W-8,3,ink); fillRect(X+4,Y+Hh-11,W-8,3,ink);
  } else {
    shell(()=>ctx.rect(X,Y+2,W,Hh-4));
    for(let i=-Hh;i<W;i+=6){ ctx.beginPath(); ctx.moveTo(X+i,Y+Hh-2); ctx.lineTo(X+i+Hh,Y+2);
      ctx.strokeStyle="rgba(109,143,152,.5)"; ctx.lineWidth=1.4; ctx.stroke(); }
  }
}

/* live one-line readout shown inside a component in the control room */
function liveValue(p,s){
  const H_=s.Tavg+15*(s.n*.935+s.decay);
  switch(true){
    case p.id==="core":  return (s.n*100).toFixed(0)+"%";
    case p.id==="rods":  return (s.rodPos*100).toFixed(0)+"%";
    case p.id==="pzr":   return s.P.toFixed(1)+" MPa";
    case p.id.startsWith("sg"):   return s.sgl.toFixed(0)+"%";
    case p.id.startsWith("pump"): return (s.flow*100).toFixed(0)+"%";
    case p.id==="turb":  return (s.load*100).toFixed(0)+"%";
    case p.id==="cond":  return H_.toFixed(0)+"K";
    case p.id==="feed":  return s.sgl.toFixed(0)+"%";
    case p.id==="hpi":   return s.hpi?"INJ":"off";
    case p.id==="bkp":   return s.blackout?"LOAD":"rdy";
    case p.id==="cont":  return s.release.toFixed(1)+"%";
    case p.id==="ctrl":  return s.dose.toFixed(0)+"%";
    default: return null;
  }
}

function drawPlant(y0,L){
  layoutMetrics(); GY=y0;
  fillRect(GX,GY,GW*CELL,GH*CELL,C.well);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(X===0||X===GW-1||Y===0||Y===GH-1) fillRect(GX+X*CELL,GY+Y*CELL,CELL,CELL,"#1c1210");
  const gl = L? "rgba(120,180,190,.03)" : "rgba(120,180,190,.05)";
  for(let X=0;X<=GW;X++) fillRect(GX+X*CELL,GY,1,GH*CELL,gl);
  for(let Y=0;Y<=GH;Y++) fillRect(GX,GY+Y*CELL,GW*CELL,1,gl);
  frame(GX,GY,GW*CELL,GH*CELL,C.edge2);
  for(let Y=0;Y<GH;Y++) txt("EL"+pad(GH-1-Y,1),GX+4,GY+Y*CELL+11,{size:6.5,color:"#2c4148"});
  txt("KEEL / HULL",GX+GW*CELL/2,GY+GH*CELL-6,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  txt("UPPER DECK / HULL",GX+GW*CELL/2,GY+12,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  ctx.save(); ctx.translate(GX+11,GY+GH*CELL/2); ctx.rotate(-Math.PI/2);
  txt("FWD BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();
  ctx.save(); ctx.translate(GX+GW*CELL-7,GY+GH*CELL/2); ctx.rotate(Math.PI/2);
  txt("AFT BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();

  const Th = L? L.Tavg+15*(L.n*.935+L.decay) : 598;
  const Tc = L? L.Tavg-15*(L.n*.935+L.decay) : 568;
  const PC={ hot: L?lerpC("#5aa9d6","#ff5a45",(Th-520)/110):"#c8735e",
             cold:L?lerpC("#5aa9d6","#ff5a45",(Tc-520)/110):"#5aa9d6",
             surge:"#a98cf0", steam:"#c8d8dc", exh:"#7f9098", feed:"#5aa9d6", hpi:"#5fd2e2" };
  const DASH={hot:"hot",cold:"cold",steam:"stm",feed:"fw",hpi:"hpi",surge:null,exh:null};
  for(const pass of [0,1]) for(const r of pipeNetwork()){
    if(pass&&r.k==="hpi"&&L&&!L.hpi) continue;
    ctx.beginPath(); ctx.moveTo(r.pts[0][0],r.pts[0][1]);
    for(let i=1;i<r.pts.length;i++) ctx.lineTo(r.pts[i][0],r.pts[i][1]);
    ctx.lineCap="square"; ctx.lineJoin="miter";
    const thin = r.k==="hpi"||r.k==="surge";
    ctx.lineWidth = pass? (thin?3:4) : (thin?6:8);
    ctx.strokeStyle = pass? PC[r.k] : "#22383e";
    if(pass&&L&&DASH[r.k]){ ctx.setLineDash([7,9]); ctx.lineDashOffset=L.dash[DASH[r.k]]||0;
      ctx.lineCap="butt"; }
    ctx.stroke(); ctx.setLineDash([]);
  }

  for(const p of LAY.parts){
    const x=PXc(p.x), y=PYc(p.y), w=p.w*CELL, h=p.h*CELL;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p, fit=fitted(p);
    const dmgd = L && L.dmgParts.includes(p.id);
    const ink = !fit?"#3c4c47" : dmgd?C.red : on?C.amber : (hov(wd)||drag)?C.bright : C.metal;
    if(on){ fillRect(x+1,y+1,w-2,h-2,"rgba(240,168,48,.07)"); ticks(x+2.5,y+2.5,w-5,h-5,C.amber,7); }
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    else drawSym(p,x,y,w,h,ink,L);
    if(dmgd){ hatch(x+3,y+3,w-6,h-6,C.red,.4); badge(x+w-9,y+12,C.red); }
    else if(!p.access && p.grp!=="shield" && fit) badge(x+w-9,y+12,C.amber);
    const v = L&&fit ? liveValue(p,L) : null;
    txt(p.name,x+w/2,y+h-(v?13:4),{size:6.5,sp:.4,align:"center",
        color:!fit?"#3c4c47":(on?C.amber:C.ink2)});
    if(v) txt(v,x+w/2,y+h-3,{size:8,align:"center",color:dmgd?C.red:C.cyan});
    if(!fit) txt("NOT FITTED",x+w/2,y+h/2+2,{size:6,sp:.6,align:"center",color:"#3c4c47"});
    TIP(x,y,w,h,p.name+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ DAMAGED ]":"")+
        (p.access||p.grp==="shield"?"":"  [ NO ACCESS ]"),
      p.tip+(p.access||p.grp==="shield"?"":"  It is boxed in on every side - nobody could reach it to repair it."));
  }
  return GY+GH*CELL;
}
const drawGrid = y0 => drawPlant(y0,null);
