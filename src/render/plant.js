"use strict";

// the one valve symbol (two triangles nose to nose): the pressurizer relief
// valve and a junction tie share this drawing so they cannot drift apart
function bowtie(cx,cy,w,h,col){
  ctx.beginPath();
  ctx.moveTo(cx-w/2,cy-h/2); ctx.lineTo(cx+w/2,cy+h/2);
  ctx.lineTo(cx+w/2,cy-h/2); ctx.lineTo(cx-w/2,cy+h/2);
  ctx.closePath(); ctx.fillStyle=col; ctx.fill();
}
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
    coreDraw(bx+2,by+2,bw-4,bh-4,coreView(L));
  } else if(id==="rods"){
    shell(()=>ctx.rect(X+8,Y+2,W-16,Hh-10));
    // one stem per bank, each at its own insertion - drawing all from the mean
    // would hide exactly the spread SPLIT mode exists to show
    const nb = L&&L.rodZ? P.NB : 5, fol = L&&P&&P.tipLen>0, step=(W-24)/nb;
    for(let i=0;i<nb;i++){ const sx=X+12+i*step,
          ins = L? 4+clamp(L.rodZ? L.rodZ[i] : L.rodPos,0,1)*9 : 6;
      fillRect(sx,Y+Hh-10,4,ins,(L&&L.rodJam)?"#8a7a4a":"#b9cdd2");
      if(fol) fillRect(sx,Y+Hh-10+ins,4,3,P.tipRho>0?C.graph:C.rail);  // the follower
    }
  } else if(id==="pzr"){
    shell(()=>rr(X,Y+8,W,Hh-8,W/2.6));
    ctx.save(); ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.clip();
    lvl(X,Y+8,W,Hh-8, L? L.lvl/100 : .54, C.blue); ctx.restore();
    ctx.beginPath(); rr(X,Y+8,W,Hh-8,W/2.6); ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
    const open = L && L.porvOpen && !L.porvBlocked;
    bowtie(cx,Y+4,12,8,open?C.red:C.green);
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
    shell(()=>ctx.rect(X,Y+2,W,Hh-4)); hatch(X+1,Y+3,W-2,Hh-6,"#6d8f98",.5);
  }
}

const CORE_DIA_REF=2.9, CORE_HGT_REF=3.1, CORE_MIN=0.3;
// NONE draws nothing; the other three borrow tones already meaning the right
// thing elsewhere - steel is the rod-stem grey, graphite the follower brown,
// beryllium the pale one left
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

function coreField(x,y,w,h,V){
  // a negative box must not throw - this runs inside the frame loop and one
  // bad frame takes the whole plant with it
  if(w<=0||h<=0) return;
  const NC=XNR*2-1, cw=w/NC, ch=h/XNZ, rMax=Math.max(0,Math.min(cw,ch)*0.44);
  for(let c=0;c<NC;c++){
    const i=Math.abs(c-(XNR-1));
    for(let j=0;j<XNZ;j++){
      const k=XIX(i,j), cx=x+(c+.5)*cw, cy=y+h-(j+.5)*ch;   // level 0 at the bottom
      if(V.xX){ const a=clamp(V.xX[k]/Math.max(V.X0,1e-9)*.34,0,.6);
        if(a>.02){ ctx.globalAlpha=a; fillRect(cx-cw/2,cy-ch/2,cw,ch,C.xe); ctx.globalAlpha=1; } }
      const t=V.nTf? clamp((V.nTf[k]-V.TfRef)/620,0,1) : 0;
      const col=t<.5? lerpC(C.cyan,C.amber,t*2) : lerpC(C.amber,C.red,(t-.5)*2);
      let r=rMax*Math.sqrt(clamp(V.phi[k]/2.6,.03,1));
      // the one animation in here: a node in film boiling is not steady
      if(t>.85) r*=.72+.28*Math.abs(Math.sin(performance.now()/90));
      // dot fades with how much fuel is actually in this ring, so a hole you
      // drew stays a hole rather than painting as a smaller full node
      const ff=V.frac? clamp(V.frac[i],0,1) : 1;
      if(ff<.985){ ctx.globalAlpha=.12+.88*ff;
        if(ff<.3) fillRect(cx-1,cy-1,2,2,"#1b2c33"); }   // an empty slot, as in the plan
      ctx.beginPath(); ctx.arc(cx,cy,r,0,7);
      if(V.nV && V.nV[k]>.12){ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.7,r*.55); ctx.stroke(); }
      else { ctx.fillStyle=col; ctx.fill(); }
      ctx.globalAlpha=1;
      // drawn bright rather than red: colour already means margin, and a mark
      // that changed colour with the thing it marks would say it twice
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
      const cx=x+((XNR-1)+sg*V.bankR[b]+.5)*cw, yTip=y+h-tip*ch;
      if(yTip>y) fillRect(cx-.9,y,1.8,yTip-y,C.metal);              // absorber
      const yF=Math.min(y+h,yTip+V.tipLen*ch);
      if(V.tipLen>0 && yF>yTip)                                     // follower
        frame(cx-1.5,yTip,3,yF-yTip,V.tipRho>0?C.graph:C.rail);
    }
  }
}

function tag(s,cx,base,size,sp,col){
  const o={size,sp}, w=tw(s,o), Lx=GX+2, Rx=GX+GW*CELL-2;
  cx=clamp(cx,Lx+w/2,Rx-w/2);
  // sized from cap height, not the em, or it sat low and left a gap over the letters
  const c=capH(size);
  fillRect(cx-w/2-3,base-c-2,w+6,c+5,"rgba(6,10,11,.88)");
  txt(s,cx,base,{size,sp,align:"center",color:col});
}

function liveValue(p,s){
  const H_=s.Tavg+15*(s.n*.935+s.decay);
  switch(true){
    case p.id==="core":  return (s.n*100).toFixed(0)+"%";
    case p.id==="rods":  return (s.rodPos*100).toFixed(0)+"%";
    case p.id==="pzr":   return s.P.toFixed(1)+" MPa";
    case p.id.startsWith("sg"):   return s.sgl.toFixed(0)+"%";
    case p.id.startsWith("pump"): return (s.flow*100).toFixed(0)+"%";
    case p.id==="turb":  return mwE(s).toFixed(0)+" MWe";
    case p.id==="cond":  return H_.toFixed(0)+"K";
    case p.id==="feed":  return s.sgl.toFixed(0)+"%";
    case p.id==="hpi":   return s.hpi?"INJ":"off";
    case p.id==="bkp":   return s.blackout?"LOAD":"rdy";
    case p.id==="cont":  return s.release.toFixed(1)+"%";
    case p.id==="ctrl":  return s.dose.toFixed(0)+"%";
    default: return null;
  }
}

function liveColor(p,s){
  switch(true){
    case p.id==="pzr": return pColor(s.P);
    // an undersized condenser quietly takes output back off you; say so on
    // the diagram, or the only place it shows is an inspector nobody opened
    case p.id==="turb": return condPen(s)<0.98 ? C.amber : C.cyan;
    default: return C.cyan;
  }
}

// mirrors commission()'s formula (step.js) because ctlFor() is also called on
// the bench, before any plant is commissioned and P is still null
const pumpFloor=()=>P? P.flowMin : clamp(0.30+0.15*(totalPumpCap()-D.loops),0.15,0.75);
const pumpTip=()=>"Primary flow. More flow carries heat away faster and directly buys DNBR margin; less flow heats the fuel and eventually boils the core. The pumps have inertia, so flow follows demand over about "+FLOW_TAU+" s and coasts down over "+FLOW_TAU_COAST+" s if the power goes. The pumps can be stopped completely: the red line on the track is the "+(pumpFloor()*100).toFixed(0)+"% floor the pumps were built for, and the protection system trips on LOW FLOW below it. Defeat the protection and nothing stops you - the core is left on buoyancy alone. The thin amber line is demand, the thumb is what the loop has.";
// rows, not a flat list: a slider sharing 30px with two buttons is 3.3% of
// rod travel per pixel, unusable
const CTL_H=13;
const STRIP_PAD=4;   // plinth inner margin, top and bottom, from one constant so they cannot drift apart
const ROD_TRIP_ROW=[  // shared: GANG and SPLIT both push this SCRAM/RESET row, or two copies drift
  {kind:"btn",flex:1,danger:()=>true,text:()=>"SCRAM",
   fn:()=>{ act("scram"); },
   tip:"SCRAM - drops every bank, split or not, and trips the turbine with it. Always safe, never free: the xenon that follows locks you out for minutes."},
  {kind:"btn",flex:1,on:()=>S.scrammed,text:()=>"RESET",
   fn:()=>{ act("resetTrip"); },
   tip:"TRIP RESET - clears the latch after a scram so the bank answers demand again. With protection fitted it refuses while a trip condition is still present."}];
// live=false asks the DESIGN question (what room will this need once
// commissioned) so the bench can reserve it; nothing in the structure may
// read S in that case, only the closures, which run only while drawing a
// live plant. split is asked separately because stripH() reserves the taller
// of both modes.
function ctlFor(p,live,split){
  if(p.id.startsWith("pump")) return [[
    // the floor is a trip setpoint, not a stop - the mark says where it costs
    {kind:"sld",flex:1,val:()=>S.flow*100,min:()=>0,max:()=>100,
     dem:()=>S.flowDem*100,mark:()=>pumpFloor()*100,markLo:true,
     fmt:v=>v.toFixed(0)+" %",set:v=>{ act("flowDem",v/100); },
     tip:"COOLANT PUMPS - "+pumpTip()}]];
  // a junction has no box, so no control strip - its valve is drawn on the
  // pipe itself, see pipeJuncMarks() below
  switch(p.id){
    // GANGED holds exactly three rows, measured against the default plant's grid
    case "rods": {
      // the master control is the same row in both modes - setCommon() in
      // step.js is the only thing that carries it out
      const MASTER=[
       {kind:"sld",flex:1,val:()=>S.rodPos*100,min:()=>0,max:()=>100,dem:()=>S.rodDem*100,
        fmt:v=>v.toFixed(0)+" %",set:v=>{ act("rodCommon",v/100); },
        tip:"CONTROL BANK - moves the whole stack. Ganged that is one bank; split it carries every bank by the same amount, so the spread you set with the per-bank sliders is untouched, and it moves a bank on MANUAL too - MANUAL only means the temperature controller is not driving it. Fast, but it travels at only 1.2%/s, and deep insertion raises power peaking, which eats thermal margin. While a trip is latched the bank stays in whatever you ask of it."}];
      const bankRow=b=>[
       {kind:"btn",flex:1,on:()=>!S.bankAuto[b],text:()=>S.bankAuto[b]?"AUT":"MAN",
        fn:()=>{ act("bankAuto",b); },
        tip:"BANK "+(b+1)+" MODE - hands this bank to the temperature controller, or takes it back. On MANUAL the bank stops answering the controller, but it still answers you: its own slider and the master both still move it. Every bank you take off AUTO leaves the same temperature error to be answered by less rod worth, so the loop does not just move less, it moves slower."},
       {kind:"sld",flex:2.8,val:()=>S.rodZ[b]*100,min:()=>0,max:()=>100,
        dem:()=>S.rodZDem[b]*100,
        fmt:v=>"B"+(b+1)+" "+v.toFixed(0)+" %",set:v=>{ act("rodBank",b,v/100); },
        tip:"BANK "+(b+1)+" - insertion of this bank alone. While the banks are split these per-bank demands are the tilt handle: standing one bank against another is the whole of how you answer a radial xenon tilt here. A bank left on MANUAL is not answering the temperature controller at all, and the fewer banks on AUTO, the less rod worth is left to answer the same error - the loop gets slower, not just smaller."}];
      if(split){
        const rows=[MASTER, ROD_TRIP_ROW,
         [{kind:"btn",flex:1,on:()=>S.reGang,
          text:()=>S.reGang?"GANGING..":"BANK GANG",
          /* already a no-op once the walk is running: setSplit() refuses to
             re-seed a gang it is in the middle of */
          fn:()=>{ act("split",false); },
          tip:"GANG BANKS - drives every bank back onto one common position and gives the shape back to the tilt slider. It is not a flick of a switch: the banks walk together at drive rate and stay split until they arrive, so a wide spread costs you the seconds it takes to close. The master slider still steers the walk while it runs."}]];
        for(let b=0;b<(live?P.NB:D.nbank);b++) rows.push(bankRow(b));
        return rows;
      }
      return [
       MASTER,
       ROD_TRIP_ROW,
       /* the ganged handle on a radial xenon tilt: it stands the inner banks
          against the outer ones instead of moving the whole bank together */
       [{kind:"sld",flex:2.8,val:()=>S.tilt,min:()=>-1,max:()=>1,dem:()=>S.tiltDem,
         fmt:v=>"TILT "+(v>=0?"+":"")+v.toFixed(2),set:v=>{ act("tiltDem",v); },
         tip:"TILT TRIM - drives the inner banks against the outer ones, up to "+(XTILTZ*100).toFixed(0)+"% of core height apart. Positive pushes the inner banks in and the power out to the ring; negative does the reverse. Full travel takes "+(1/TILT_RATE).toFixed(0)+" s because the drives moving it are the drives that move the bank. It is your tilt handle only while the banks are ganged - split them and each bank's own demand takes over."},
        {kind:"btn",flex:1,text:()=>"SPL",
         fn:()=>{ act("split",true); },
         tip:"SPLIT BANKS - stops driving the banks as one and gives each its own demand. Splitting is bumpless by construction: every bank simply adopts where it already stands. From there the tilt slider stands down, the per-bank sliders are your tilt handle, and any bank you switch to MANUAL stops answering the temperature controller."}]];
    }
    case "core": return [
     [{kind:"sld",flex:1,val:()=>S.boron,min:()=>-6000,max:()=>0,step:10,
       dem:()=>S.boronDem,
       fmt:v=>v.toFixed(0)+" pcm",set:v=>{ act("boronDem",v); },
       tip:"BORON - neutron poison dissolved in the coolant. Genuinely slow: the charging pumps borate at "+BOR_IN+" pcm/s and dilute at only "+BOR_OUT+" pcm/s, so the thin line is what you asked for and the thumb is what the loop has. The only way out of a deep xenon pit."}]].concat(
      /* the bench asks D, because that is the design being edited right now; a
         commissioned plant asks P, because that is the design it was built to */
      (live?P.boroninj:D.boroninj)?[[{kind:"btn",flex:1,danger:()=>!S.borInjUsed,
       text:()=>S.borInjUsed?"SPENT":"BORON DUMP",
       fn:()=>{ act("boronDump"); },
       tip:"EMERGENCY BORON - one-shot poison dump worth 4000 pcm. Shuts the reactor down when the rods will not, and it cannot be undone."}]]:[]);
    case "turb": return [[
      {kind:"sld",flex:1,val:()=>S.load*100,min:()=>0,max:()=>P.loadMax*100,dem:()=>S.loadDem*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{ act("loadDem",v/100); },
       tip:"LOAD DEMAND - turbine draw. Raising it cools the loop, and the reactor answers by raising its own power without you touching a rod. The governor valves take about "+LOAD_TAU+" s to stroke, so the thumb trails the thin line. A runback is the exception and slams shut."}]];
    case "pzr": return [[
      {kind:"btn",flex:1,on:()=>S.porvBlocked,text:()=>S.porvBlocked?"SHUT":"OPEN",
       fn:()=>{ act("porvBlock"); },
       tip:"BLOCK VALVE - manual backup under the relief valve. Shut it when the PORV fails to reseat; that is the whole answer to a stuck-open valve."}]];
    case "hpi": return [[
      {kind:"btn",flex:1,on:()=>S.hpi,text:()=>S.hpi?"INJECT":"OFF",
       fn:()=>{ act("hpi"); },
       tip:"HIGH PRESSURE INJECTION - emergency cold water into the loop. Refills a leak, and the cold shock ages the vessel every second it runs."}]];
  }
  return null;
}

function stripH(p,live){
  if(!fitted(p)) return 0;
  // reserve the WORST of the modes, never the current one - ganging/splitting
  // must not resize the plant under the operator; unused rows are empty plinth
  const rows=m=>{ const c=ctlFor(p,live,m); return c? c.length : 0; };
  const n=Math.max(rows(false),rows(true)), bh=autoOn(p.id)? CTL_H : 0;
  if(!n && !bh) return 0;   // nothing to mount, nothing to stand on (no plinth)
  return n*CTL_H + bh + STRIP_PAD;
}
function ctlBands(live){
  const b=new Array(GH).fill(0);
  for(const p of LAY.parts){
    const r=p.y+p.h-1;                       // the strip sits in the LAST row it spans
    if(r>=0&&r<GH) b[r]=Math.max(b[r],stripH(p,live));
  }
  return b;
}

function bypRow(k,x,y,w,h){
  const A=AUTOSYS[k], fit=autoFit(k), lit=fit&&S.byp[k];
  // no `if(fit)` guard: autoToggle() already refuses an unfitted system, so
  // this stays a dead (`none`, no hover) switch rather than a second refusal
  const wd=push({x,y,w,h,type:"btn",fn:()=>{ act("byp",k); }});
  const hv=fit&&hov(wd);
  fillRect(x,y,w,h, lit?"#2a1f08":(hv?C.panelHi:C.panel));
  const col = !fit?"#3c4c47" : lit?C.amber : C.green;
  const st  = !fit?"none" : lit?"BYP" : "AUTO";
  const o={size:6.5,sp:.3};
  // a narrow component loses the label before the state (its name is already
  // printed above it); centred, not stuck to the bottom edge
  const bl=midBase(y,h,6.5);
  if(w >= tw(A.label,o)+tw(st,o)+10){
    txt(A.label,x+3,bl,{size:6.5,sp:.3,color:fit?C.ink2:"#3c4c47"});
    txt(st,x+w-3,bl,{size:6.5,sp:.3,align:"right",color:col});
  } else txt(st,x+w/2,bl,{size:6.5,sp:.3,align:"center",color:col});
  TIP(x,y,w,h,A.name+"  [ "+autoState(k)+" ]",
    A.tip+(fit?"":"  None was fitted at the design bench, so there is nothing to arm and nothing to bypass."));
}

function ctlStrip(list,x,y,w,h){
  const gap=4, tot=list.reduce((a,c)=>a+c.flex,0);
  const span=(w-gap*(list.length-1))/tot;
  let cx=x;
  for(const c of list){
    const cw=span*c.flex;
    const dan = c.danger? c.danger() : false, on = c.on? c.on() : false;
    if(c.kind==="sld"){
      slider(cx,y+h/2,cw,c.val(),c.min(),c.max(),
        {th:h,tw:7,fmt:c.fmt,dem:c.dem?c.dem():null,mark:c.mark?c.mark():null,markLo:c.markLo,
         fn:v=>c.set(c.step?Math.round(v/c.step)*c.step:v)});
    } else {
      // a narrow box loses its letter spacing before it loses its label
      button(cx,y,cw,h,c.text(),{danger:dan,on:on,sunk:true,size:6.5,sp:cw<30?0:.5,fn:c.fn});
    }
    TIP(cx,y,cw,h,c.tip.split(" - ")[0],c.tip);
    cx+=cw+gap;
  }
}

// a pipe is steered by grabbing a point it must pass through and dropping it
// elsewhere - the same two-point router just runs twice, so there is no
// freehand drawing and no separate pathfinder to keep in step with it.
// Bench only: where a pipe runs feeds the mass/friction the plant is
// commissioned with, so the control room operates what was built rather than
// reshaping it. Grips are pushed AFTER the components so one lying over a
// vessel is still grabbable (hit test takes the LAST widget pushed).
const WPG=9;                          // the grab box; a grip has to be findable at fit scale
/* the one point on a leg the hand can grab: its corner, or the middle of the
   run if the leg came out straight and has no corner to offer */
function legGrip(pts){
  if(pts.length<2) return null;
  if(pts.length<3) return {x:(pts[0][0]+pts[1][0])/2, y:(pts[0][1]+pts[1][1])/2};
  const seg=i=>Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  let tot=0; for(let i=1;i<pts.length;i++) tot+=seg(i);
  /* the corner nearest the middle of the leg: a leg with two of them offers the
     one the hand was most likely aiming at */
  let s=0, best=pts[1], bd=1e9;
  for(let i=1;i<pts.length-1;i++){
    s+=seg(i);
    const d=Math.abs(s-tot/2);
    if(d<bd){ bd=d; best=pts[i]; }
  }
  return {x:best[0],y:best[1]};
}
function pipeGrip(x,y,key,pt){
  const wd=push({x:x-WPG/2,y:y-WPG/2,w:WPG,h:WPG,type:"pipewp",key,pt});
  const hv=hov(wd);
  // placed waypoint is amber (yours); automatic corner is the rail tone the
  // pipe casing already sits in, so the drawing isn't peppered with marks
  fillRect(x-2.5,y-2.5,5,5, pt?C.amber : hv?C.bright : C.rail);
  if(hv) frame(x-WPG/2,y-WPG/2,WPG,WPG,C.amber);
  TIP(x-WPG/2,y-WPG/2,WPG,WPG, pt?"PIPE WAYPOINT":"PIPE ROUTE",
    pt?"A point you told this run to pass through. Drag it to move it, or double-click to take it out and hand that stretch of pipe back to the automatic route."
      :"Drag this corner and the run will be routed through wherever you drop it. It is still the same router doing the work - a run with a waypoint on it is two runs end to end.");
}
function pipeGrips(runs){
  for(const r of runs){
    if(!r.key) continue;   // the surge line has no route(), so nothing to steer
    for(const p of r.wps) pipeGrip(p.x,p.y,r.key,p);
    for(const leg of r.legs){ const g=legGrip(leg); if(g) pipeGrip(g.x,g.y,r.key,null); }
  }
}
// a junction has no box or control strip, so its bowtie() valve is drawn
// straight on the tapped point - fixed in position (only removal and open
// state change). Both screens draw a mark so a placed junction is findable
// to remove even before it's live: bench gets a dim dot, control room the
// clickable valve.
function pipeJuncMarks(L){
  const junc = L? P.junc : D.junc;
  for(const id in junc){
    const j=junc[id], tipBody="Bridges loop "+(j.loopA+1)+" and loop "+(j.loopB+1)+
      (L?". Open, they share whatever their pumps are still delivering, so a pump you lose on one is propped up by the other. Shut, each loop keeps its own water - which is what you want the moment one starts leaking, because an open junction will drain the good loop into the bad one. It moves the instant you press it."
        :". Right-click it to remove.");
    if(L){
      const open=S.juncOpen[id];
      const wd=push({x:j.x-7,y:j.y-7,w:14,h:14,type:"btn",fn:()=>{ act("junc",id); }});
      bowtie(j.x,j.y,14,10, open?C.green:(hov(wd)?C.bright:C.metal));
      TIP(j.x-7,j.y-7,14,14,"JUNCTION VALVE",tipBody);
    } else {
      dot(j.x-2,j.y-2,4,C.rail);
      TIP(j.x-7,j.y-7,14,14,"JUNCTION",tipBody);
    }
  }
}

// readoutsFor() is DATA - rows of [key,value,colour,tip,band,signedBar] - the
// ONE description of what a component is worth watching, consumed by the
// control room's HTML rail (fieldRowsSync() in inspector.js). Four numbers
// show up on more than one component; their band and sentence are written
// ONCE here so two readouts cannot describe the same quantity two ways.
const rowInv=s=>["INVENTORY",s.inv.toFixed(1)+" %",
  band(s.inv,80,100,[[95,C.red,"LEAKING"],[100,C.blue,"FULL"]],{dp:0}),
  "How much water is actually in the loop. A whole loop sits at 100%; under 95% you are losing it somewhere."];
const rowFat=s=>["VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",
  band(s.fatigue,0,100,[[50,C.cyan,"SOUND"],[100,C.amber,"WORN"]],{dp:0}),
  "Permanent metal damage from cold water hitting hot steel, mostly from emergency injection. It never resets, and the vessel bursts lower for every point of it."];
const rowSgl=s=>["SG LEVEL",s.sgl.toFixed(1)+" %",
  band(s.sgl,0,100,[[25,C.red,"LOW"],[100,C.cyan,"NORMAL"]],{dp:0}),
  "Water in the steam generator. Under 25% it is boiling dry and the core is losing its heat sink."];
// same s.nat used to be coloured three different ways on three components;
// shared here, scaled off the plant's own P.natCirc ceiling
const rowNat=s=>["NAT CIRC",(s.nat*100).toFixed(0)+" %",
  band(s.nat*100,0,Math.max(20,P.natCirc*100),
    [[10,C.ink2,"NONE"],[Math.max(20,P.natCirc*100),C.green,"ESTABLISHED"]],{dp:0}),
  "Flow that buoyancy alone is making. It builds once the loop is hot, and it is all you have with the pumps dead. Generator height over the core sets it."];
const T_TRIP="What tripped the plant most recently. It stays here after a reset, so you can still see what you were fighting.";

// the key is the field on s.parts, except "net" which is the sum the sim already keeps
const RHO_ROWS=[
 ["RODS","rod","Negative reactivity from the inserted control rods. The deeper they go the stronger this gets, but not evenly: the rods bite hardest around mid-travel."],
 ["DOPPLER","dop","Feedback from hot fuel. As fuel heats it absorbs more neutrons, pushing power back down. Instant, automatic and always stabilising - this is what stops a runaway before a human could react."],
 ["MODERATOR","mod","Feedback from coolant temperature. Hotter coolant is less dense and moderates neutrons less, so power drops. This is why the reactor follows turbine load on its own."],
 ["XENON","xe","Xenon-135, a neutron poison that builds up after fission. It has memory: what you did minutes ago is still eating your reactivity now. Equilibrium sits near -2700; after a scram it deepens toward -4800 and locks you out of restarting."],
 ["BORON","bor","Poison dissolved in the coolant, and whatever you have dialled in on the boron control. Slow to change, but it is the only lever left once rods and temperature have run out."],
 ["VOID","vd","Steam bubbles in the core. In a water design this is strongly negative and shuts the reactor down as it uncovers. In a graphite or sodium design it is POSITIVE, and voiding adds power instead."],
 ["ROD TIP","tip","Whatever hangs below the absorber. With a water follower this stays at zero all the way in. With a graphite one it goes POSITIVE as the bank drops, because graphite displaces water at the bottom of the core before the absorber has reached there - the reactivity you add before the reactivity you remove."],
 ["NET RHO","net","The sum of everything above. Zero means steady power, positive means it is climbing, negative means it is falling. If this exceeds your fuel's beta the reactor goes prompt critical and nothing can stop it in time."],
];
function readoutsFor(p,s){
  const heat=s.n*.935+s.decay, Th=s.Tavg+15*heat, Tc=s.Tavg-15*heat, sc=tsat(s.P)-Th;
  const id=p.id, R=[], m=P.rpsm;
  // a setpoint only exists while something is watching it: no mark drawn with
  // no protection fitted or bypassed - the overpower mechanic as a picture
  const trip=(v,l)=>rpsLive()?[[v,l]]:null;
  // a row hands in a colour OR a band; a band's colour comes off it, so the
  // figure and its tooltip strip cannot disagree about where the limit is.
  // `bar` is an optional signed fraction, -1..1, drawn by fieldRowsSync() (inspector.js).
  const add=(k,v,c,tip,bar)=>{
    const g=(c&&typeof c==="object")?c:null;
    R.push([k,v, g?bandCol(g):(c||C.cyan), tip, g, bar]);
  };
  if(id==="core"){
    add("POWER",(s.n*100).toFixed(1)+" %",
      band(s.n*100,0,150,[[110,C.green,"NORMAL"],[150,C.red,"OVERPOWER"]],
        {dp:0,lim:trip((1.10+0.22*m)*100,"FLUX"),col:s.dnbr<1.3?C.red:null}),
      "Heat the core is making, as a share of what it is rated for. The real ceiling is DNBR, not this number.");
    add("THERMAL",(s.n*P.rated).toFixed(0)+" MWt",null,
      "The same power in megawatts of heat: the rating times the share above.");
    { const per=period(), fin=isFinite(per)&&Math.abs(per)<999;
      add("PERIOD", fin?per.toFixed(0)+" s":"INF",
        fin&&per>0&&per<30 ? C.red : fin&&per>0&&per<80 ? C.amber : C.cyan,
        "Seconds for power to multiply by 2.7 times at the rate it is moving right now. INF means steady. A short POSITIVE period is power running away from you, and under about ten seconds nothing you do will catch it."); }
    // scale top is measured off the plant: a sodium/salt core rests at 3.2
    // against water's 1.76, so a fixed 2.6 would peg the needle on half the
    // architectures from the first frame
    const dHi=Math.max(2.6,P.dnbr0*1.3);
    add("DNBR",s.dnbr.toFixed(2),
      band(s.dnbr,0.8,dHi,[[1.0,C.red,"FILM"],[1.3,C.amber,"MARGINAL"],[dHi,C.cyan,"SAFE"]],
        {dp:2,lim:trip(1.18-0.16*m,"TRIP")}),
      "How far the fuel is from a steam film that stops cooling it. Over 1.30 is comfortable; 1.00 damages fuel.");
    add("FUEL TEMP",s.Tf.toFixed(0)+" K",
      band(s.Tf,300,2200,[[1500,C.cyan,"NORMAL"],[2200,C.red,"FAILING"]],
        {dp:0,lim:trip(1600+280*m,"TRIP")}),
      "Temperature inside the pellets. Past 1500 K the cladding starts to fail, and that damage is permanent.");
    add("PEAK Fq",s.fq.toFixed(2),
      band(s.fq,1,5,[[3.2,C.cyan,"FLAT"],[5,C.amber,"PEAKED"]],{dp:2}),
      "How much hotter the hottest spot is than the core average. 1.00 is perfectly flat; past 3.2 one channel is doing far too much of the work.");
    add("HOT SPOT","R"+s.hotRing+" / EL"+s.hotLev,null,
      "Which mesh ring and which level is carrying that peak. It is ringed in the core field on the reactor symbol.");
    add("AX / RAD OFFSET",(s.ao*100).toFixed(0)+" / "+(s.ro*100).toFixed(0)+" %",
        Math.abs(s.ao)>.35||Math.abs(s.ro)>.35?C.amber:C.cyan,
      "How far the flux leans up-down and in-out from centred. Past 35% either way the peak has moved somewhere you did not design for.");
    add("VOID",s.vf.toFixed(2),
      band(s.vf,0,.6,[[.15,C.cyan,"LIQUID"],[.6,C.red,"BOILING"]],
        {dp:2,lim:trip(.30,"TRIP")}),
      "Share of the coolant that has turned to steam. Steam carries heat away far worse than water, and in a graphite core it adds reactivity as well.");
    add.apply(null,rowInv(s));
    // BORON and XENON aren't stated here: they're reactivity terms, so the
    // ledger below says them (with direction) instead of two rows quoting one number
    add("BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        Math.abs(s.boronDem-s.boron)>20?C.amber:C.ink2,
      "Where you have asked boron to go. It borates at "+BOR_IN+" pcm/s and only dilutes at "+BOR_OUT+", so poisoning yourself is the fast direction.");
    add("EMERG BORON",!P.boroninj?"none":s.borInjUsed?"EXPENDED":"available",
        !P.boroninj?C.ink2:s.borInjUsed?C.red:C.green,
      "A one-shot 4000 pcm dump. It shuts the core down when the rods will not, and it cannot be undone for the rest of the run.");
    add("FUEL DAMAGE",s.dmg.toFixed(1)+" %",
      // any damage at all is the bad zone, so the good one is a sliver - the
      // strip saying honestly that this scale has no safe stretch
      band(s.dmg,0,100,[[1e-9,C.cyan,"NONE"],[100,C.red,"CLAD FAILED"]],{dp:0}),
      "Cladding that has already failed, and it is permanent. It grows whenever DNBR drops under 1.00 or the fuel passes 1500 K.");
    add.apply(null,rowFat(s));
    R.push({sec:"REACTIVITY"});
    for(const r of RHO_ROWS){
      const v = r[1]==="net" ? s.rho : s.parts[r[1]];
      const col = r[1]==="net" ? (Math.abs(v)<50?C.green:(v<0?C.blue:C.red))
                               : (v<0?C.blue:C.amber);
      add(r[0],(v>=0?"+":"")+v.toFixed(0),col,r[2],clamp(v/2600,-1,1));
    }
  } else if(id==="rods"){
    add("BANK POSITION",(s.rodPos*100).toFixed(1)+" %",null,
      "Where the bank stands. 100% is fully inserted, and the rods bite hardest around mid-travel rather than evenly.");
    add("BANK DEMAND",(s.rodDem*100).toFixed(1)+" %",
        Math.abs(s.rodDem-s.rodPos)>.005?C.amber:C.ink2,
      "Where you have asked the bank to go. The drives walk to it at "+(ROD_RATE*100).toFixed(1)+" %/s, so this leads the position every time you move the slider.");
    add("WORTH HERE",coreRodWorth(s).toFixed(0)+" pcm",null,
      "What the bank is worth where it actually stands, solved on the live flux. Move a cluster inward at the bench and this changes.");
    add("DRIVES",s.rodJam?"JAMMED":"answering",s.rodJam?C.red:C.green,
      "Whether the drive mechanisms answer at all. A hit here jams the bank where it stands, and a scram will not move it either.");
    add("SCRAM TIME",(1/P.scram).toFixed(1)+" s",null,
      "How long a full insertion takes on a trip. You bought this at the bench, and faster gear is heavier gear.");
    add("TRIP LATCH",s.scrammed?"LATCHED":"clear",s.scrammed?C.amber:C.green,
      "Whether a trip is latched in. While it is, the drives are pinned fully inserted whatever the slider says.");
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2,T_TRIP);
    add("RESET WOULD",!s.scrammed?"n/a":(P.rps&&tripCause())?"REFUSE":"clear",
        !s.scrammed?C.ink2:(P.rps&&tripCause())?C.red:C.green,
      "What the trip reset would do if you pressed it now. Protection holds a veto for as long as a trip condition is still standing.");
    add("NET RHO",s.rho.toFixed(0)+" pcm",
      band(s.rho,-800,800,[[-50,C.amber,"FALLING"],[50,C.green,"STEADY"],[800,C.amber,"RISING"]],
        {dp:0,lim:[[P.BETA*1e5,"PROMPT"]]}),
      "Everything pushing the reactor up or down, added together. Zero is steady power; past your fuel's beta nothing can stop it in time.");
    add("TILT TRIM",(s.tilt>=0?"+":"")+s.tilt.toFixed(2),
      band(s.tilt,-.3,.3,[[-.05,C.amber,"LEANING"],[.05,C.ink2,"CENTRED"],[.3,C.amber,"LEANING"]],{dp:2}),
      "How far the banks are leaned against each other to shape the flux. Live in GANG only - SPLIT stands it down, because two things cannot own the same spacing.");
    add("TILT DEMAND",(s.tiltDem>=0?"+":"")+s.tiltDem.toFixed(2),
        Math.abs(s.tiltDem-s.tilt)>.01?C.amber:C.ink2,
      "Where you have asked the tilt to go. It walks there at drive speed, so it leads the trim above.");
    add("SHUTDOWN MGN",P.sdm.toFixed(0)+" pcm",
      band(P.sdm,-3000,3000,[[200,C.red,"THIN"],[3000,C.green,"AMPLE"]],{dp:0}),
      "How firmly the bank ALONE holds this core down once it cools and the xenon decays. Usually negative, and that is what boron is for.");
  } else if(id==="pzr"){
    add("PRESSURE",s.P.toFixed(2)+" MPa",
      band(s.P,P.P0*.80,P.P0*1.15,
        [[P.P0*0.935,C.amber,"LOW"],[P.P0*1.05,C.cyan,"NORMAL"],[P.P0*1.15,C.red,"HIGH"]],
        {dp:2,lim:rpsLive()?[[P.P0*(1.06+0.07*m),"HI"],[P.P0*0.86,"LO"]]:null}),
      "Loop pressure. It sets the temperature the coolant boils at, so every megapascal here is thermal margin.");
    add("LEVEL",s.lvl.toFixed(1)+" %",
      band(s.lvl,0,100,[[78,C.cyan,"NORMAL"],[100,C.amber,"HIGH"]],{dp:0}),
      "Water level in the pressurizer. Level RISING while pressure falls is a stuck relief valve - the trap that wrecked Three Mile Island.");
    // measured off the plant like DNBR's scale: a helium core sits 1400 K
    // below boiling, water only 22, so a fixed ceiling would peg one or squash
    // the other. The 8 K SATURATED line stays absolute regardless.
    const scHi=Math.max(60,(P.tsat0-P.Tref)*1.25);
    add("SUBCOOLING",sc.toFixed(1)+" K",
      band(sc,0,scHi,[[8,C.red,"SATURATED"],[scHi,C.cyan,"SUBCOOLED"]],
        {dp:0,lim:trip(3,"TRIP")}),
      "Degrees below boiling in the hot leg. The honest leak indicator: it collapses before anything else admits the loop is voiding.");
    add("SAT TEMP",tsat(s.P).toFixed(0)+" K",null,
      "The temperature the coolant would boil at, at the pressure it is held to right now.");
    add("LIFT SETPOINT",(P.P0*1.06).toFixed(2)+" MPa",null,
      "Where the relief valve opens on its own. It has an 18% chance of sticking open every single time it lifts.");
    // scale is a share of THIS plant's pressure (a sodium loop runs at 0.2
    // MPa); the 0.3 MPa NEAR LIFT line stays absolute and can sit off the end
    // on a low-pressure plant, honestly saying it's always close to lifting
    const mlLo=Math.min(-0.1,-P.P0*.04), mlHi=Math.max(0.4,P.P0*.12);
    add("MARGIN TO LIFT",(P.P0*1.06-s.P).toFixed(2)+" MPa",
      band(P.P0*1.06-s.P,mlLo,mlHi,
        [[0.3,C.amber,"NEAR LIFT"],[mlHi,C.cyan,"CLEAR"]],{dp:2}),
      "How much pressure is left before that valve lifts by itself. Negative means it is passing right now.");
    add("PORV",(s.porvOpen&&!s.porvBlocked)?"PASSING":"shut",
        (s.porvOpen&&!s.porvBlocked)?C.red:C.green,
      "The relief valve itself. PASSING means coolant is leaving the loop through it, whether you asked or not.");
    add("BLOCK VALVE",s.porvBlocked?"SHUT":"open",s.porvBlocked?C.red:C.green,
      "Your last defence against a stuck relief valve. Shutting it stops the leak and gives the valve up for good.");
    add("AUTO RELIEF",autoState("porv").toLowerCase(),
        autoLive("porv")?C.green:C.amber,
      "Whether the valve is allowed to lift by itself at 106%. Bypass it and pressure climbs to the burst point instead.");
  } else if(id.startsWith("sg")){
    add.apply(null,rowSgl(s));
    add("STEAM PRESS",(P.P0*.45*Math.pow(Math.max(s.load,.05),.25)).toFixed(2)+" MPa",null,
      "Pressure on the secondary side. It follows how hard the turbine is drawing.");
    add("T-HOT IN",Th.toFixed(0)+" K",null,
      "Coolant arriving from the core. The gap between this and T-COLD is the heat this unit is taking out.");
    add("T-COLD OUT",Tc.toFixed(0)+" K",null,
      "Coolant going back to the core, after the generator has taken its heat.");
    add("HEAT REMOVED",(Math.min(s.n,s.load)*P.rated).toFixed(0)+" MWt",null,
      "Heat actually leaving the primary loop. It is the LOWER of what the core makes and what the turbine will take.");
    add.apply(null,rowNat(s));
    add("TUBES",s.sgtr?"LEAKING":"intact",s.sgtr?C.red:C.green,
      "The barrier between primary and secondary. A rupture leaks coolant and activity straight past containment.");
  } else if(id.startsWith("pump")){
    add("FLOW",(s.flow*100).toFixed(1)+" %",
      band(s.flow*100,0,110,[[P.flowMin*100,C.red,"STARVED"],[110,C.cyan,"NORMAL"]],
        {dp:0,lim:trip(P.flowMin*102,"TRIP")}),
      "Coolant moving through the core. Flow is the biggest single input to thermal margin, and the first thing a blackout takes off you.");
    add("FLOW DEMAND",(s.flowDem*100).toFixed(1)+" %",
        Math.abs(s.flowDem-s.flow)>.005?C.amber:C.ink2,
      "Where you have asked the pumps to go. Flow lags it by "+FLOW_TAU+" s, and by "+FLOW_TAU_COAST+" s while coasting down in a blackout.");
    add("DESIGN FLOOR",(P.flowMin*100).toFixed(0)+" %",null,
      "The least flow this pump set still delivers after damage. You bought it with the redundancy option at the bench.");
    add("HOT CHANNEL",(s.hotFlow*100).toFixed(0)+" %",
      band(s.hotFlow*100,0,110,[[80,C.amber,"STARVED"],[110,C.cyan,"FED"]],{dp:0}),
      "Flow in the WORST channel, not the average. A voiding channel loses the flow it needed to stop voiding, and that runaway is why the core is a place and not a number.");
    add("CAVITATION",(s.cav*100).toFixed(0)+" %",
      band(s.cav*100,0,60,[[15,C.cyan,"NONE"],[60,C.amber,"CAVITATING"]],{dp:0}),
      "Vapour forming at the pump inlet because pressure fell too far. It costs head, so losing pressure costs you flow as well.");
    add.apply(null,rowNat(s));
    add("PUMPS LOST",s.dmgParts.filter(k=>k.startsWith("pump")).length+" / "+
        LAY.parts.filter(q=>q.id.startsWith("pump")).length,
        s.dmgParts.some(k=>k.startsWith("pump"))?C.red:C.green,
      "How many of your coolant pumps have been destroyed, out of how many you paid for.");
  } else if(id==="turb"){
    add("LOAD",(s.load*100).toFixed(1)+" %",null,
      "How hard the turbine is drawing steam. This is the demand the reactor spends its whole time trying to follow.");
    add("LOAD DEMAND",(s.loadDem*100).toFixed(1)+" %",
        Math.abs(s.loadDem-s.load)>.005?C.amber:C.ink2,
      "Where you have set the load. The governor strokes there over about "+LOAD_TAU.toFixed(0)+" s.");
    add("ELECTRICAL",(Math.min(s.n,s.load)*P.rated/3).toFixed(0)+" MWe",null,
      "Electrical power the ship is actually getting. It is the lower of heat made and heat taken, priced by the machine you bought.");
    add("T-AVG DEV",(s.Tavg-tProg(s)>=0?"+":"")+(s.Tavg-tProg(s)).toFixed(1)+" K",null,
      "How far coolant temperature sits from the programme for this load. Anything but zero means reactor and turbine are out of balance.");
    add("STEAM DUMP",(P.bypass*100).toFixed(0)+" %",null,
      "How much steam can go straight past the turbine to the condenser. It is what absorbs a trip without the relief valve lifting.");
    add("GOV STROKE",LOAD_TAU.toFixed(0)+" s",null,
      "How long the governor valves take to answer a change in load demand.");
    add("RUNBACK",autoState("runback").toLowerCase(),
        autoLive("runback")?C.green:C.amber,
      "Whether a trip also pulls the turbine back. Bypass it and a scram leaves the turbine drawing hard on a dead core, chilling the loop.");
  } else if(id==="ctrl"){
    add("RPS",rpsState().toLowerCase(),rpsLive()?C.green:C.amber,
      "The automatic protection. Live, it trips on eight conditions; bypassed, it watches you run the plant to destruction and says nothing.");
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2,T_TRIP);
    add("INSTRUMENTS",P.noise<.2?"VOTED":P.noise<.6?"2CH DRIFT":"1CH RAW",
        P.noise>.6?C.amber:C.green,
      "How many sensors watch each parameter. One channel jitters and hides a liar; three vote the liar out and the numbers hold still.");
    add("PARTY DOSE",s.dose.toFixed(1)+" %",
      band(s.dose,0,100,[[50,C.cyan,"LOW"],[100,C.red,"HIGH"]],{dp:0}),
      "Radiation your repair parties have taken so far. Where you put this room, and what shielding is between, decides it.");
    add("DOSE RATE",P.dose.toFixed(2)+" x",
      band(P.dose,0,3,[[1,C.green,"SHIELDED"],[3,C.amber,"EXPOSED"]],{dp:2}),
      "How fast that dose piles up, against a nominal of 1.00. Move this room away from the reactor and watch it fall.");
    add("EVENTS",LOG.length+"",null,
      "How many things have gone wrong this run. The LOG panel says what each of them was.");
  } else if(id==="hpi"){
    add("INJECTION",s.hpi?"RUNNING":"stopped",s.hpi?C.cyan:C.ink2,
      "Whether emergency water is going into the loop right now. It is the safe act with a long bill: see fatigue below.");
    add("RATE",P.hpiRate.toFixed(2)+" %/s",null,
      "How fast injection refills the loop. A passive accumulator nearly doubles it and needs no power at all.");
    add("HEAD OVER CORE",P.lay.hpiHead.toFixed(2)+" x",null,
      "How high this tank sits above the core, as a multiplier on the rate above. Gravity does the work, so mount it high.");
    add.apply(null,rowInv(s));
    add.apply(null,rowFat(s));
  } else if(id==="cont"){
    add("RELEASE",s.release.toFixed(2)+" %",
      band(s.release,0,10,[[1,C.cyan,"CONTAINED"],[10,C.red,"RELEASING"]],{dp:2}),
      "Share of the core inventory that has escaped and reached the crew. Driven by fuel damage, cut down by the containment you paid for.");
    add("HELD BACK",((1-P.contRel)*100).toFixed(0)+" %",null,
      "How much of any release this containment keeps in. It does nothing for the reactor and everything for the people around it.");
    add("CORE CATCHER",P.catcher?"fitted":"none",P.catcher?C.green:C.ink2,
      "A cooled basin under the vessel. It will not save the fuel, but it stops a melt burning through and breaching.");
    add("VESSEL",s.breach?"RUPTURED":"intact",s.breach?C.red:C.green,
      "Whether the pressure vessel is still whole. A rupture is the end of the run.");
  } else if(id==="bkp"){
    add("BLACKOUT",s.blackout?"ACTIVE":"no",s.blackout?C.red:C.green,
      "Whether main power to the coolant pumps has gone. Test it from the FAULTS panel before you ever need to know.");
    add("CAPACITY",(P.backup*100).toFixed(0)+" %",null,
      "Share of pump flow your backup supply can still turn. Everything above this has to come from buoyancy.");
    add("SUPPLY",s.bkpLost?"DESTROYED":"available",s.bkpLost?C.red:C.green,
      "Whether the backup set itself survived. A hit here means a blackout is natural circulation and nothing else.");
    add.apply(null,rowNat(s));
  } else if(id==="feed"){
    add.apply(null,rowSgl(s));
    add("EMERG FEED",autoState("efw").toLowerCase(),
        autoLive("efw")?C.green:C.amber,
      "An independent supply that keeps the generator boiling after the main pumps are lost. Bypass it and grace time after a trip collapses.");
    add("FEED PUMP",s.dmgParts.includes("feed")?"DESTROYED":"running",
        s.dmgParts.includes("feed")?C.red:C.green,
      "The main feedwater pump. Destroyed, the generator boils dry unless emergency feed picks it up.");
  } else if(id==="cond"){
    add("T-HOT",Th.toFixed(0)+" K",null,
      "Steam temperature arriving at the condenser.");
    add("HEAT REJECTED",(Math.min(s.n,s.load)*P.rated*.66).toFixed(0)+" MWt",null,
      "Heat being dumped overboard. It is the remainder, after the turbine has taken its share as electricity.");
    add("CONDENSER",s.dmgParts.includes("cond")?"DESTROYED":"in service",
        s.dmgParts.includes("cond")?C.red:C.green,
      "The heat sink itself. Destroyed, the steam has nowhere to condense and the loop has nowhere to put its heat.");
  }
  // shielding has nothing to report, and neither has a component never
  // bought - the grid already draws the dashed outline and NOT FITTED itself
  if(!R.length||!fitted(p)) return [];
  if(s.dmgParts.includes(p.id)) R.unshift(["STATUS","DAMAGED",C.red,
    "This component has taken a hit. Send a party from the REPAIR panel, or from the key drawn on the component itself."]);
  if(!p.access && p.grp!=="shield") R.unshift(["ACCESS","BLOCKED",C.red,
    "Your layout walls this in on every side, so no repair party can ever reach it. It stays broken for the rest of the run."]);
  return R;
}

// the layoutMetrics() a drawPlant() call already paid for is cached here so
// the bench rail (design-bench.js) can read PLANT_LM without recomputing it
let PLANT_LM=null;

// a widget hosted inside an HTML panel (trend chart, fuel lattice plan) still
// draws HERE, at the screen box its placeholder element occupies - matches
// local()'s page<->layout conversion (core/ui.js) so clicks land correctly
function hostRect(el){
  const rc=cv.getBoundingClientRect(), r=el.getBoundingClientRect();
  const sx=W/rc.width, sy=(H-TOPBAR_H)/rc.height;
  return {x:(r.left-rc.left)*sx, y:(r.top-rc.top)*sy+TOPBAR_H, w:r.width*sx, h:r.height*sy};
}

/* vx/vw are the viewport's left edge and width - GX/(W-2*GX) by default, or
   whatever the caller's own HTML rail leaves clear of the plant, so the
   canvas never draws under a docked panel. */
function drawPlant(y0,L,vh,vx,vw){
  PLANT_LM=layoutMetrics(); GY=y0;
  BANDS = ctlBands(!!L);
  const GHp=gridH(), rowH=Y=>rowTop(Y+1)-rowTop(Y);
  // both screens are HTML rails now, so the content the view fits to is the grid alone
  vFit(vx==null?GX:vx, GY, vw==null?(W-2*GX):vw, vh||GHp, GX, GY, GW*CELL, GHp);
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x,VIEW.y,VIEW.w,VIEW.h); ctx.clip();
  ctx.translate(VIEW.x-(VIEW.cx+VIEW.ox)*VIEW.s, VIEW.y-(VIEW.cy+VIEW.oy)*VIEW.s);
  ctx.scale(VIEW.s,VIEW.s);
  viewOn=true;
  fillRect(GX,GY,GW*CELL,GHp,C.well);
  for(let Y=0;Y<GH;Y++) for(let X=0;X<GW;X++)
    if(X===0||X===GW-1||Y===0||Y===GH-1) fillRect(GX+X*CELL,rowTop(Y),CELL,rowH(Y),"#1c1210");
  const gl = L? "rgba(120,180,190,.03)" : "rgba(120,180,190,.05)";
  for(let X=0;X<=GW;X++) fillRect(GX+X*CELL,GY,1,GHp,gl);
  for(let Y=0;Y<=GH;Y++) fillRect(GX,rowTop(Y),GW*CELL,1,gl);
  frame(GX,GY,GW*CELL,GHp,C.edge2);
  for(let Y=0;Y<GH;Y++) txt("EL"+pad(GH-1-Y,1),GX+4,rowTop(Y)+11,{size:6.5,color:"#2c4148"});
  txt("KEEL / HULL",GX+GW*CELL/2,GY+GHp-6,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  txt("UPPER DECK / HULL",GX+GW*CELL/2,GY+12,{size:7,sp:1.6,align:"center",color:"#5a3128"});
  ctx.save(); ctx.translate(GX+11,GY+GHp/2); ctx.rotate(-Math.PI/2);
  txt("FWD BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();
  ctx.save(); ctx.translate(GX+GW*CELL-7,GY+GHp/2); ctx.rotate(Math.PI/2);
  txt("AFT BULKHEAD",0,0,{size:7,sp:1.6,align:"center",color:"#5a3128"}); ctx.restore();

  // dark casing, then the coloured fluid line inside it, both round-jointed
  // (concentric radii) so a pipe bends rather than folds
  const PC=pipeColours(L), NET=pipeNetwork();
  for(const pass of [0,1]) for(const r of NET){
    if(pass&&r.k==="hpi"&&L&&!L.hpi) continue;
    ctx.beginPath(); ctx.moveTo(r.pts[0][0],r.pts[0][1]);
    for(let i=1;i<r.pts.length;i++) ctx.lineTo(r.pts[i][0],r.pts[i][1]);
    ctx.lineCap="square"; ctx.lineJoin="round";
    const thin = r.k==="hpi"||r.k==="surge";
    ctx.lineWidth = pass? (thin?3:4) : (thin?6:8);
    ctx.strokeStyle = pass? pipeCol(PC,r.k) : "#22383e";
    ctx.stroke();
  }
  ctx.lineJoin="miter";
  if(L) pipeFlow(L);

  for(const p of LAY.parts){
    const {x,y,w,h}=prect(p);
    const fit = fitted(p), live = L && fit;
    const ctl = live ? ctlFor(p,true,S.split) : null;
    // the strip is a property of the DESIGN: the bench reserves the room and
    // draws the plinth empty, so nothing jumps in size when you commission
    const byk = fit ? autoOn(p.id) : null,
          bh  = byk? CTL_H : 0,
          sh  = stripH(p,live), sy = y+h-sh;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p;
    // `fit &&`, or a NOT FITTED tag would draw a REPAIR key across itself -
    // the renderer should not rely on combatHit() never targeting one
    const dmgd = L && fit && L.dmgParts.includes(p.id);
    const ink = !fit?"#3c4c47" : dmgd?C.red : on?C.amber : (hov(wd)||drag)?C.bright : C.metal;
    const plinth = sh>0, py = sy+1-STRIP_PAD, pb = y+h-2;
    if(plinth) fillRect(x+2,y+2,w-4,h-4,C.panel);
    if(on) fillRect(x+1,y+1,w-2,h-2,"rgba(240,168,48,.07)");
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    if(fit) drawSym(p,x,y,w,h-sh-(plinth?4:0),ink,L);
    if(plinth) fillRect(x+2,py,w-4,pb-py,C.panelHi);   // tone, not a line, marks the plinth
    // a bypass is cut back to grid tone with its key inverted, so defeating a
    // safety system never reads as just another switch
    if(plinth && bh) fillRect(x+2,y+h-STRIP_PAD-bh,w-4,STRIP_PAD+bh-2,C.well);
    if(dmgd){ hatch(x+3,y+3,w-6,h-6,C.red,.4); badge(x+w-9,y+12,C.red);
      const symH=h-sh-(plinth?4:0);   // centred on the SYMBOL, not the whole component
      const busy=L.repair&&L.repair.id===p.id, kw=Math.min(w-16,86), kx=x+(w-kw)/2;
      button(kx,y+symH/2-9,kw,14,busy?Math.round(L.repair.t/L.repair.need*100)+"%"
             :p.access?"REPAIR":"NO ACCESS",
        {sunk:1,on:busy,danger:!p.access,size:7,sp:.8,fn:()=>act("repair",p.id)});
    }
    else if(!p.access && p.grp!=="shield" && fit) badge(x+w-9,y+12,C.amber);
    if(L&&fit){ const al=annLamp(p.id); if(al) lamp(x+10,y+11,al); }
    if(!L && fit && !dmgd){ const wc=warnFor(p.id); if(wc) dot(x+6,y+8,8,wc); }   // bench has no alarm lamp
    const v0 = L&&fit ? liveValue(p,L) : null, v = (ctl&&p.h<2)? null : v0;
    const nm = (v0&&!v)? p.name+"  "+v0 : p.name;
    const tb = plinth ? sy-6 : sy-3;
    tag(nm,x+w/2,tb-(v?11:1),6.5,.4,!fit?"#3c4c47":(on?C.amber:C.ink2));
    if(v) tag(v,x+w/2,tb,8,0,dmgd?C.red:liveColor(p,L));
    if(!fit) tag("NOT FITTED",x+w/2,y+h/2+2,6,.2,"#3c4c47");
    // pushed LAST so findTip()'s backwards match doesn't swallow a control's own tooltip
    TIP(x,y,w,h,p.name+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ DAMAGED ]":"")+
        (p.access||p.grp==="shield"?"":"  [ NO ACCESS ]"),
      p.tip+(p.access||p.grp==="shield"?"":"  It is boxed in on every side - nobody could reach it to repair it."));
    if(ctl) ctl.forEach((row,i)=>ctlStrip(row,x+6,sy+i*CTL_H+1,w-12,CTL_H-3));
    if(byk && live) bypRow(byk,x+6,y+h-STRIP_PAD-bh+1,w-12,bh-3);
  }
  if(L) pipeGauges(L);
  else pipeGrips(NET);          // where a pipe runs is a bench question
  pipeJuncMarks(L);
  viewOn=false; ctx.restore();

  // one key, not two: at fit the only useful move is in, and zoomed in the
  // only move is all the way back out. Reads FIT whenever off 1 in either
  // direction, since the view zooms out past fit too.
  { const zoomed=Math.abs(VIEW.z-1)>0.001, kw=52, kx=VIEW.x+VIEW.w-kw-4, ky=VIEW.y+4;
    button(kx,ky,kw,14,zoomed?"FIT "+VIEW.z.toFixed(1)+"X":"ZOOM",
      {sunk:1,size:6.5,sp:.6,fn:()=>{
        if(zoomed){ VIEW.z=1; VIEW.ox=VIEW.oy=0; }
        else { const p=LAY.parts.find(q=>q.id===sel), r=p&&prect(p);
          vZoom(1.8, r? r.x+r.w/2 : GX+GW*CELL/2, r? r.y+r.h/2 : GY+GHp/2); }
      }});
    TIP(kx,ky,kw,14,zoomed?"FIT THE WHOLE PLANT":"ZOOM IN",
      "The plant view pans and zooms. Roll the wheel over it to zoom about the pointer, hold the RIGHT button to drag the plant about, and this key jumps between the whole plant and a close look at whatever component is selected. Nothing about the plant itself changes - the hull is still sixteen cells by nine, and a component still has to fit in it.");
  }
  return VIEW.y+VIEW.h;
}
