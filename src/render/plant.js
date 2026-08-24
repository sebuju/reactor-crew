"use strict";
/* drawPlant(): the one plant renderer, used by both screens */

/* ══════════ ONE PLANT RENDERER, USED BY BOTH SCREENS ══════════
   design mode: static, selectable, draggable.   live mode: same symbols, animated. */
/* The one valve symbol: two triangles nose to nose. The relief valve on top of
   the pressurizer and a cross-tie between two pumps are the same drawing at two
   sizes, so it is drawn in one place - the second one is where a copy starts
   drifting from the first. */
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
    /* One stem per bank on a live plant, each at its own insertion: split banks
       are not in the same place, and five identical stems drawn from the mean
       would be exactly the lie the split mode exists to expose. The bench has no
       banks standing anywhere yet, so it keeps its five even drives. */
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

/* ══════════ THE CORE AT THE SIZE YOU DREW IT ══════════
   The mesh is 14 rings by 10 levels whatever the lattice is, so a core drawn at
   two thirds the diameter painted exactly the same picture as a full one. That
   is the bench and the panel between them telling you the drawing did not
   matter. The FIELD keeps its mesh - it is a mesh, not a photograph - and the
   BOX it is painted into is scaled by the metres the revolve measured.

   One reference per axis, and deliberately not the same number: the space
   inside the vessel symbol is 110 x 82 and a reactor is not. Scaled
   isotropically, a 2.5 m square core sits as a small square in the middle with
   three quarters of the width left empty. So width answers to the diameter and
   height answers to the height, each against a little more than the biggest the
   bench draws - 2.73 m across at the loosest preset pitch. A little more,
   because what is left over round the edges is where the reflector goes, and a
   band has to have somewhere to be.

   The band is CLIPPED to the vessel, not fitted to it. Three cells of reflector
   round a full-diameter core is wider than the gap, and the honest thing for a
   symbol to do there is run out of room. */
const CORE_DIA_REF=2.9, CORE_HGT_REF=3.1, CORE_MIN=0.3;
/* NONE draws nothing, which is the whole point of a bare face. The other three
   borrow tones that already mean the right thing here: steel is the metal grey
   the rod stems are drawn in, graphite is the warm brown the follower is drawn
   in, and beryllium takes the pale one left. */
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

/* ══════════ THE CORE AS A FIELD ══════════
   Drawn the way the core behaves rather than the way a schematic looks: a
   lattice of points, mirrored about the centreline so it reads as a section.
   Four quantities on four channels that do not compete for the same ink -
     size    is local power
     colour  is local margin, cyan through amber to red
     hollow  is steam, because steam is an absence
     shadow  is xenon, drawn as darkness because that is what a poison does
   One function serves both screens: the bench passes no live state and gets
   the shape this design is predicted to settle into. */
function coreField(x,y,w,h,V){
  /* A negative box is a caller's bug, not a drawing to attempt - but it must
     not be a thrown exception either, because this runs inside the frame loop
     and one bad frame takes the whole plant with it. */
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
      /* the one animation in here: a node in film boiling is not steady */
      if(t>.85) r*=.72+.28*Math.abs(Math.sin(performance.now()/90));
      /* ── how much fuel is actually in this ring ──
         The mesh has 14 rings whatever you drew, so a ring you left half empty
         used to paint a full node with a slightly smaller dot on it - the flux
         fell, but nothing said the fuel was missing. The dot now fades with the
         fill, so a hole you drew stays a hole while you operate it, and a rim
         ring that is only half full reads as half there. The solver has known
         this all along; it is what nPen is. */
      const ff=V.frac? clamp(V.frac[i],0,1) : 1;
      if(ff<.985){ ctx.globalAlpha=.12+.88*ff;
        if(ff<.3) fillRect(cx-1,cy-1,2,2,"#1b2c33"); }   // an empty slot, as in the plan
      ctx.beginPath(); ctx.arc(cx,cy,r,0,7);
      if(V.nV && V.nV[k]>.12){ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.7,r*.55); ctx.stroke(); }
      else { ctx.fillStyle=col; ctx.fill(); }
      ctx.globalAlpha=1;
      /* The hot spot, ringed on both sides of the centreline because the field
         is mirrored and the node genuinely is a whole annulus. This is the node
         that sets DNBR, so it is the one place the lattice you drew and the
         limit you are pushing against are the same object. Drawn bright rather
         than red: the colour channel already means margin, and a mark that
         changed colour with the thing it is marking would say it twice. */
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

/* an equipment tag on its own plate, clamped to the grid so the symbol never
   shows through it and an outer-column part is never clipped by the panel edge */
function tag(s,cx,base,size,sp,col){
  const o={size,sp}, w=tw(s,o), Lx=GX+2, Rx=GX+GW*CELL-2;
  cx=clamp(cx,Lx+w/2,Rx-w/2);
  /* the plate is sized from cap height, not from the em: built from the em it
     sat low and left a gap over the letters it was meant to back */
  const c=capH(size);
  fillRect(cx-w/2-3,base-c-2,w+6,c+5,"rgba(6,10,11,.88)");
  txt(s,cx,base,{size,sp,align:"center",color:col});
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

/* Semantic colour for that readout, where the number carries an alarm meaning of
   its own. Everything else is plain data cyan. Mirrors liveValue() case for case. */
function liveColor(p,s){
  switch(true){
    case p.id==="pzr": return pColor(s.P);
    /* an undersized condenser is quietly taking output back off you. Say so on
       the diagram, or the only place it shows is an inspector nobody opened. */
    case p.id==="turb": return condPen(s)<0.98 ? C.amber : C.cyan;
    default: return C.cyan;
  }
}

/* ══════════ IN-COMPONENT CONTROLS (control room only) ══════════
   A control is not a separate box parked somewhere on the grid: it is a strip
   along the bottom of the component it drives, inside that component's own cells.
   Several controls share one strip by weight.  The design bench passes no live
   state, so its grid carries no strips at all. */
/* The design floor is derived from pump capacity actually on the grid - see
   commission() (step.js) for the exact formula, mirrored here because the
   bench asks the design directly: it runs BEFORE any plant has been
   commissioned and P is still null there. ctlFor() is called on the bench
   now, to reserve the room the control room will need, so everything it
   builds eagerly has to survive P===null. */
const pumpFloor=()=>P? P.flowMin : clamp(0.30+0.15*(totalPumpCap()-D.loops),0.15,0.75);
/* The pump tooltip is shown by the diagram strip and by the inspector, so it is
   written once. It is a function, not a constant, because the floor it names
   depends on the design. */
const pumpTip=()=>"Primary flow. More flow carries heat away faster and directly buys DNBR margin; less flow heats the fuel and eventually boils the core. The pumps have inertia, so flow follows demand over about "+FLOW_TAU+" s and coasts down over "+FLOW_TAU_COAST+" s if the power goes. The pumps can be stopped completely: the red line on the track is the "+(pumpFloor()*100).toFixed(0)+"% floor the pumps were built for, and the protection system trips on LOW FLOW below it. Defeat the protection and nothing stops you - the core is left on buoyancy alone. The thin amber line is demand, the thumb is what the loop has.";
/* ctlFor() returns ROWS of controls, not one flat list. A slider sharing a strip
   with two buttons got 30px of a 92px component, which is 3.3% of rod travel per
   pixel - unusable. Each row is CTL_H tall and the grid row underneath the
   component grows to fit them all, so a slider gets the whole component width. */
const CTL_H=13;
/* The plinth's inner margin, top AND bottom, from one constant so the two cannot
   drift apart - they did, and an even lip above the first key with a deeper one
   below the last read as a mistake. The bottom half is reserved by stripH(), so
   the grid row grows to hold it rather than eating into the keys; the top half
   falls out of where the plinth starts. */
const STRIP_PAD=4;
/* SCRAM and RESET are the same pair whether the banks are ganged or split, and
   they are the controls you reach for without looking, so the row is built once
   and both modes push the same object. Two copies would drift. */
const ROD_TRIP_ROW=[
  {kind:"btn",flex:1,danger:()=>true,text:()=>"SCRAM",
   fn:()=>{ manualScram(); },
   tip:"SCRAM - drops every bank, split or not, and trips the turbine with it. Always safe, never free: the xenon that follows locks you out for minutes."},
  {kind:"btn",flex:1,on:()=>S.scrammed,text:()=>"RESET",
   fn:()=>{ resetTrip(); },
   tip:"TRIP RESET - clears the latch after a scram so the bank answers demand again. With protection fitted it refuses while a trip condition is still present."}];
/* live=false asks the DESIGN question - what will this component need once it is
   commissioned - so the bench can reserve exactly the room the control room will
   fill. Nothing in the structure may read S in that case; the closures below still
   may, because they are only ever called while drawing a live plant.
   split is asked for separately from S, because stripH() has to be able to ask
   for BOTH modes and reserve the taller of the two. */
function ctlFor(p,live,split){
  if(p.id.startsWith("pump")) return [[
    /* the floor is a trip setpoint, not a stop: the panel may order the pumps
       off entirely, and the mark says where that starts costing */
    {kind:"sld",flex:1,val:()=>S.flow*100,min:()=>0,max:()=>100,
     dem:()=>S.flowDem*100,mark:()=>pumpFloor()*100,markLo:true,
     fmt:v=>v.toFixed(0)+" %",set:v=>{S.flowDem=v/100;},
     tip:"COOLANT PUMPS - "+pumpTip()}]];
  /* A junction has no box, so it has no control strip - its open/shut valve
     is drawn and clicked straight on the pipe at its own tap point instead.
     See pipeJuncMarks() below. */
  switch(p.id){
    /* Two modes, one component. GANGED the plant has a single bank and the tilt
       slider is the only handle on the shape; SPLIT, the per-bank demands ARE
       that handle, so the tilt slider stands down and each bank takes a row of
       its own with its own AUTO switch. Ganged is held to exactly three rows,
       because that is the height the default plant's grid was measured with. */
    case "rods": {
      /* The master is the same control, in the same row, in both modes, because
         it is the one you reach for without looking. What it means is one
         sentence everywhere - "move the whole stack to here" - and setCommon()
         in step.js is the only thing that carries it out. Splitting the banks
         changes what the stack IS, never whether you have a handle on it. */
      const MASTER=[
       {kind:"sld",flex:1,val:()=>S.rodPos*100,min:()=>0,max:()=>100,dem:()=>S.rodDem*100,
        fmt:v=>v.toFixed(0)+" %",set:v=>{ setCommon(v/100); },
        tip:"CONTROL BANK - moves the whole stack. Ganged that is one bank; split it carries every bank by the same amount, so the spread you set with the per-bank sliders is untouched, and it moves a bank on MANUAL too - MANUAL only means the temperature controller is not driving it. Fast, but it travels at only 1.2%/s, and deep insertion raises power peaking, which eats thermal margin. While a trip is latched the bank stays in whatever you ask of it."}];
      const bankRow=b=>[
       {kind:"btn",flex:1,on:()=>!S.bankAuto[b],text:()=>S.bankAuto[b]?"AUT":"MAN",
        fn:()=>{ S.bankAuto[b]=!S.bankAuto[b]; },
        tip:"BANK "+(b+1)+" MODE - hands this bank to the temperature controller, or takes it back. On MANUAL the bank stops answering the controller, but it still answers you: its own slider and the master both still move it. Every bank you take off AUTO leaves the same temperature error to be answered by less rod worth, so the loop does not just move less, it moves slower."},
       {kind:"sld",flex:2.8,val:()=>S.rodZ[b]*100,min:()=>0,max:()=>100,
        dem:()=>S.rodZDem[b]*100,
        fmt:v=>"B"+(b+1)+" "+v.toFixed(0)+" %",set:v=>{S.rodZDem[b]=v/100;},
        tip:"BANK "+(b+1)+" - insertion of this bank alone. While the banks are split these per-bank demands are the tilt handle: standing one bank against another is the whole of how you answer a radial xenon tilt here. A bank left on MANUAL is not answering the temperature controller at all, and the fewer banks on AUTO, the less rod worth is left to answer the same error - the loop gets slower, not just smaller."}];
      if(split){
        const rows=[MASTER, ROD_TRIP_ROW,
         [{kind:"btn",flex:1,on:()=>S.reGang,
          text:()=>S.reGang?"GANGING..":"BANK GANG",
          /* already a no-op once the walk is running: setSplit() refuses to
             re-seed a gang it is in the middle of */
          fn:()=>{ setSplit(false); },
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
         fmt:v=>"TILT "+(v>=0?"+":"")+v.toFixed(2),set:v=>{S.tiltDem=v;},
         tip:"TILT TRIM - drives the inner banks against the outer ones, up to "+(XTILTZ*100).toFixed(0)+"% of core height apart. Positive pushes the inner banks in and the power out to the ring; negative does the reverse. Full travel takes "+(1/TILT_RATE).toFixed(0)+" s because the drives moving it are the drives that move the bank. It is your tilt handle only while the banks are ganged - split them and each bank's own demand takes over."},
        {kind:"btn",flex:1,text:()=>"SPL",
         fn:()=>{ setSplit(true); },
         tip:"SPLIT BANKS - stops driving the banks as one and gives each its own demand. Splitting is bumpless by construction: every bank simply adopts where it already stands. From there the tilt slider stands down, the per-bank sliders are your tilt handle, and any bank you switch to MANUAL stops answering the temperature controller."}]];
    }
    case "core": return [
     [{kind:"sld",flex:1,val:()=>S.boron,min:()=>-6000,max:()=>0,step:10,
       dem:()=>S.boronDem,
       fmt:v=>v.toFixed(0)+" pcm",set:v=>{S.boronDem=v;},
       tip:"BORON - neutron poison dissolved in the coolant. Genuinely slow: the charging pumps borate at "+BOR_IN+" pcm/s and dilute at only "+BOR_OUT+" pcm/s, so the thin line is what you asked for and the thumb is what the loop has. The only way out of a deep xenon pit."}]].concat(
      /* the bench asks D, because that is the design being edited right now; a
         commissioned plant asks P, because that is the design it was built to */
      (live?P.boroninj:D.boroninj)?[[{kind:"btn",flex:1,danger:()=>!S.borInjUsed,
       text:()=>S.borInjUsed?"SPENT":"BORON DUMP",
       fn:()=>{ if(!S.borInjUsed){ S.borInjUsed=true; S.boron-=4000; S.boronDem-=4000;
         logE("alarm","EMERGENCY BORON INJECTED",
           "4000 pcm dumped into the loop. Shut down hard, and it cannot be undone this run."); } },
       tip:"EMERGENCY BORON - one-shot poison dump worth 4000 pcm. Shuts the reactor down when the rods will not, and it cannot be undone."}]]:[]);
    case "turb": return [[
      {kind:"sld",flex:1,val:()=>S.load*100,min:()=>0,max:()=>P.loadMax*100,dem:()=>S.loadDem*100,
       fmt:v=>v.toFixed(0)+" %",set:v=>{S.loadDem=v/100;},
       tip:"LOAD DEMAND - turbine draw. Raising it cools the loop, and the reactor answers by raising its own power without you touching a rod. The governor valves take about "+LOAD_TAU+" s to stroke, so the thumb trails the thin line. A runback is the exception and slams shut."}]];
    case "pzr": return [[
      {kind:"btn",flex:1,on:()=>S.porvBlocked,text:()=>S.porvBlocked?"SHUT":"OPEN",
       fn:()=>{S.porvBlocked=!S.porvBlocked;},
       tip:"BLOCK VALVE - manual backup under the relief valve. Shut it when the PORV fails to reseat; that is the whole answer to a stuck-open valve."}]];
    case "hpi": return [[
      {kind:"btn",flex:1,on:()=>S.hpi,text:()=>S.hpi?"INJECT":"OFF",
       fn:()=>{S.hpi=!S.hpi;},
       tip:"HIGH PRESSURE INJECTION - emergency cold water into the loop. Refills a leak, and the cold shock ages the vessel every second it runs."}]];
  }
  return null;
}

/* How much room this component's controls need, and therefore how far the grid
   row it ends in has to grow. Asked once per part per frame, before anything
   is drawn, because the row heights decide where everything lands. */
function stripH(p,live){
  if(!fitted(p)) return 0;
  /* The room a component reserves is the WORST of its modes, never the mode it
     happens to be in. Ganging and splitting the rod banks must not resize the
     plant under the operator - the rows DRAWN are still the live ones, and the
     rows it is not using are simply empty plinth. */
  const rows=m=>{ const c=ctlFor(p,live,m); return c? c.length : 0; };
  const n=Math.max(rows(false),rows(true)), bh=autoOn(p.id)? CTL_H : 0;
  /* Nothing to mount, nothing to stand on. STRIP_PAD is the plinth's margin, so
     adding it unconditionally gave a component with no controls a 4px plinth
     holding nothing - and, because plinth is sh>0, a body to go with it. */
  if(!n && !bh) return 0;
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

/* ══════════ BYPASS SWITCHES (control room only) ══════════
   Defeating a system is not an operating control, so it gets its own row along
   the very bottom of the component that carries the system. AUTOSYS says which
   component that is, so there is exactly one switch per system and no component
   carries two.

   That row used to be 11px against the controls' 13, and was fenced off with a
   hairline above it. The hairline is gone, and a 2px height difference on its own
   does not read as a decision - it reads as a misalignment. So a bypass is now
   exactly the same height as every other key in the plant view, and it carries no
   visual distinction at all. If one is wanted back, give it tone, not size: two
   key heights in one strip is the thing that looked untidy. */
function bypRow(k,x,y,w,h){
  const A=AUTOSYS[k], fit=autoFit(k), lit=fit&&S.byp[k];
  const wd=push({x,y,w,h,type:"btn",fn:()=>{ if(fit) autoToggle(k); }});
  const hv=fit&&hov(wd);
  /* no border, for the same reason the control keys above it lost theirs: the
     tone step off the plinth already says where the switch is */
  fillRect(x,y,w,h, lit?"#2a1f08":(hv?C.panelHi:C.panel));
  const col = !fit?"#3c4c47" : lit?C.amber : C.green;
  const st  = !fit?"none" : lit?"BYP" : "AUTO";
  const o={size:6.5,sp:.3};
  /* a narrow component loses the label before it loses the state: the component
     name is printed directly above it anyway */
  const bl=midBase(y,h,6.5);   // centred, not stuck to the bottom edge
  if(w >= tw(A.label,o)+tw(st,o)+10){
    txt(A.label,x+3,bl,{size:6.5,sp:.3,color:fit?C.ink2:"#3c4c47"});
    txt(st,x+w-3,bl,{size:6.5,sp:.3,align:"right",color:col});
  } else txt(st,x+w/2,bl,{size:6.5,sp:.3,align:"center",color:col});
  TIP(x,y,w,h,A.name+"  [ "+autoState(k)+" ]",
    A.tip+(fit?"":"  None was fitted at the design bench, so there is nothing to arm and nothing to bypass."));
}

/* the control strip along the bottom of one component */
function ctlStrip(list,x,y,w,h){
  const gap=4, tot=list.reduce((a,c)=>a+c.flex,0);
  const span=(w-gap*(list.length-1))/tot;
  let cx=x;
  for(const c of list){
    const cw=span*c.flex;
    const dan = c.danger? c.danger() : false, on = c.on? c.on() : false;
    if(c.kind==="sld"){
      /* The readout is the slider's own now, and it stands beside the track
         rather than on it. It used to be an opaque plate dodging from one end to
         the other to keep clear of the thumb, which on a one-cell component
         covered the bar completely. */
      slider(cx,y+h/2,cw,c.val(),c.min(),c.max(),
        {th:h,tw:7,fmt:c.fmt,dem:c.dem?c.dem():null,mark:c.mark?c.mark():null,markLo:c.markLo,
         fn:v=>c.set(c.step?Math.round(v/c.step)*c.step:v)});
    } else {
      /* a narrow box loses its letter spacing before it loses its label */
      button(cx,y,cw,h,c.text(),{danger:dan,on:on,sunk:true,size:6.5,sp:cw<30?0:.5,fn:c.fn});
    }
    TIP(cx,y,cw,h,c.tip.split(" - ")[0],c.tip);
    cx+=cw+gap;
  }
}

/* ══════════ A PIPE IS STEERED BY A POINT ON IT (design bench only) ══════════
   The router is a two-point geometric construction and not a search, so there
   is no open list to add a constraint to and no way to ask it for a shape. What
   the player gets instead is a point the run has to pass THROUGH: grab the
   corner a leg already has, drop it somewhere else, and that leg becomes two
   legs from the same router. Drawing pipes freehand was considered and set
   aside - hand-rolled pathfinding never quite works - and this keeps the router
   in charge of every metre of the result.

   The gesture vocabulary is the plate's, exactly: automatic by default, grab to
   override, double-click to hand it back. Bench only, the same way dragging a
   component is: where a pipe runs is a design decision that feeds the mass and
   the friction the plant is commissioned with, and the control room operates
   what was built rather than reshaping it.

   The grips go down AFTER the components, so one lying over a vessel is still
   grabbable - the hit test takes the LAST widget pushed. */
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
  /* a placed waypoint is amber because it is yours; an automatic corner is the
     rail tone the pipe casing already sits in, so the drawing is not peppered
     with marks until you go looking for one */
  fillRect(x-2.5,y-2.5,5,5, pt?C.amber : hv?C.bright : C.rail);
  if(hv) frame(x-WPG/2,y-WPG/2,WPG,WPG,C.amber);
  TIP(x-WPG/2,y-WPG/2,WPG,WPG, pt?"PIPE WAYPOINT":"PIPE ROUTE",
    pt?"A point you told this run to pass through. Drag it to move it, or double-click to take it out and hand that stretch of pipe back to the automatic route."
      :"Drag this corner and the run will be routed through wherever you drop it. It is still the same router doing the work - a run with a waypoint on it is two runs end to end.");
}
function pipeGrips(runs){
  for(const r of runs){
    /* the surge line is not a route() - it drops onto whatever hot leg passes
       underneath - so there is nothing here to steer */
    if(!r.key) continue;
    for(const p of r.wps) pipeGrip(p.x,p.y,r.key,p);
    for(const leg of r.legs){ const g=legGrip(leg); if(g) pipeGrip(g.x,g.y,r.key,null); }
  }
}
/* ══ A JUNCTION HAS NO BOX, SO ITS VALVE IS DRAWN ON THE PIPE ITSELF ══
   Confirmed explicitly: no component, no cell, no control strip to mount an
   open/shut button in - so the same bowtie() glyph the pressurizer relief
   valve and the old fixed cross-ties both already drew goes straight on the
   tapped point instead, exactly the way a waypoint grip is a mark on the pipe
   rather than a widget on a component. Unlike a grip it never drags - a
   junction's position is fixed the moment it is placed, only its removal
   (right-click, design-bench.js) and its open state change.
   Both screens draw a mark, because a placed junction has to be findable to
   be removed even before it is live: the bench gets a dim, passive dot, and
   only the control room's fitted plant gets the clickable valve, matching
   how a bypass switch only exists once a system is actually commissioned. */
function pipeJuncMarks(L){
  const junc = L? P.junc : D.junc;
  for(const id in junc){
    const j=junc[id], tipBody="Bridges loop "+(j.loopA+1)+" and loop "+(j.loopB+1)+
      (L?". Open, they share whatever their pumps are still delivering, so a pump you lose on one is propped up by the other. Shut, each loop keeps its own water - which is what you want the moment one starts leaking, because an open junction will drain the good loop into the bad one. It moves the instant you press it."
        :". Right-click it to remove.");
    if(L){
      const open=S.juncOpen[id];
      const wd=push({x:j.x-7,y:j.y-7,w:14,h:14,type:"btn",fn:()=>{ S.juncOpen[id]=!open; }});
      bowtie(j.x,j.y,14,10, open?C.green:(hov(wd)?C.bright:C.metal));
      TIP(j.x-7,j.y-7,14,14,"JUNCTION VALVE",tipBody);
    } else {
      dot(j.x-2,j.y-2,4,C.rail);
      TIP(j.x-7,j.y-7,14,14,"JUNCTION",tipBody);
    }
  }
}

/* y0 is where the VIEWPORT starts and vh is how tall it is - the room the
   screen has decided to give the plant, which is not the same thing as how tall
   the plant is. Leave vh out and the viewport is exactly the grid, which is
   what the design bench still does until it moves too. */
/* ══════════ THE PLANT VIEW IS THE READOUT ══════════
   There is no component readout panel. EVERY fitted component draws its FULL
   table, every frame, at every zoom. The tables are plates standing in the two
   margins beside the grid, each on a leader line back to the component that
   owns it, ordered top to bottom so no two leaders ever cross. It is an exploded
   callout drawing, and it is complete the moment it opens - nothing is hidden
   behind a click you have not made.

   ZOOM IS MAGNIFICATION, NOT DISCLOSURE. Fit shows the whole plant and every
   number at once but small; zooming in makes them bigger without ever making a
   different set of them appear. The trade, stated plainly: at fit you can see
   that a number is red without being able to read it. A panel could not show it
   to you at all.

   readoutsFor() is DATA - rows of [key, value, colour] - and it is the ONE
   description of what a component is worth watching. It replaced ctrlInspector(),
   which hard-coded the same rows into fixed 172px columns and so could not be
   drawn at any other size. Ported from .trash/mockups/z1-liveplant.js. */
const PLW=158, PLGAP=10, PLROW=13, PLLEAD=30, PLSNAP=8;
/* The plate's own top/bottom padding, on a READOUT plate only. plateShell()'s
   head is a whole heading - a PLROW-tall title cell, its rule, 3 units of air -
   not padding, so squeezing it to buy a bottom margin just makes the heading
   cramped. The plate grows by PLPAD at each end instead: PLPAD above the
   heading, PLPAD below the last row, h = 20+2*PLPAD+rows*PLROW.
   READOUT PLATES ONLY. benchPlateFor()'s bench-parameter plates and benchFree()'s
   RESULTS/REVIEW already reserve their own bottom pad (head=20, pad=8) against a
   content-start of q.y+20 - handing plateShell() a pad there too would push
   their content down without their own height budget growing to match, and
   quietly shrink their bottom margin from 8 units to 2. So only platesFor() and
   drawPlate() pass PLPAD; every other plateShell() caller omits it and gets the
   original q.y+20. */
const PLPAD=6;

/* Four numbers show up on more than one component's plate. Their band and their
   sentence are written ONCE here, so two plates cannot end up describing the
   same quantity in two different ways. */
const rowInv=s=>["INVENTORY",s.inv.toFixed(1)+" %",
  band(s.inv,80,100,[[95,C.red,"LEAKING"],[100,C.blue,"FULL"]],{dp:0}),
  "How much water is actually in the loop. A whole loop sits at 100%; under 95% you are losing it somewhere."];
const rowFat=s=>["VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",
  band(s.fatigue,0,100,[[50,C.cyan,"SOUND"],[100,C.amber,"WORN"]],{dp:0}),
  "Permanent metal damage from cold water hitting hot steel, mostly from emergency injection. It never resets, and the vessel bursts lower for every point of it."];
const rowSgl=s=>["SG LEVEL",s.sgl.toFixed(1)+" %",
  band(s.sgl,0,100,[[25,C.red,"LOW"],[100,C.cyan,"NORMAL"]],{dp:0}),
  "Water in the steam generator. Under 25% it is boiling dry and the core is losing its heat sink."];
/* Natural circulation was the case AGAINST sharing these and then the case for
   it: the same s.nat was printed green-or-grey on the steam generator and flat
   cyan on the pump and the backup, so one number gave three answers depending
   on which plate you happened to be looking at. Its ceiling is the plant's own
   P.natCirc, which is why the scale is measured off that rather than picked. */
const rowNat=s=>["NAT CIRC",(s.nat*100).toFixed(0)+" %",
  band(s.nat*100,0,Math.max(20,P.natCirc*100),
    [[10,C.ink2,"NONE"],[Math.max(20,P.natCirc*100),C.green,"ESTABLISHED"]],{dp:0}),
  "Flow that buoyancy alone is making. It builds once the loop is hot, and it is all you have with the pumps dead. Generator height over the core sets it."];
const T_TRIP="What tripped the plant most recently. It stays here after a reset, so you can still see what you were fighting.";

/* Every term in the reactivity balance, and what each one is. The key is the
   field on `s.parts`, except "net" which is the sum the sim already keeps. One
   table, because the reactor's plate is now the only thing that draws it. */
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
  /* A setpoint only exists while something is watching it. With no protection
     fitted, or the bypass thrown, there is no mark to draw - which is the
     overpower mechanic stated as a picture rather than as a sentence. */
  const trip=(v,l)=>rpsLive()?[[v,l]]:null;
  /* A row hands in a colour OR a band. Hand in a band and the colour comes off
     it, which is the whole point: the figure and the strip under its tooltip
     cannot then disagree about where the limit is. */
  /* `bar` is an optional signed fraction, -1..1. A row that hands one in draws
     it where its hairline would have gone; see plateRows(). */
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
    /* period() and not a subtraction done here: readoutsFor() runs twice a
       frame, so a differentiator in this function reports half the answer */
    { const per=period(), fin=isFinite(per)&&Math.abs(per)<999;
      add("PERIOD", fin?per.toFixed(0)+" s":"INF",
        fin&&per>0&&per<30 ? C.red : fin&&per>0&&per<80 ? C.amber : C.cyan,
        "Seconds for power to multiply by 2.7 times at the rate it is moving right now. INF means steady. A short POSITIVE period is power running away from you, and under about ten seconds nothing you do will catch it."); }
    /* The top of this scale is MEASURED off the plant, not picked. A sodium or
       salt core sits at 3.2 at rest against a water core's 1.76, so a fixed 2.6
       pegs the needle on three of the six architectures from the first frame -
       a gauge that is hard over before you have touched anything. The bottom
       end and both zone boundaries are absolute, because film boiling is. */
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
    /* BORON and XENON are not stated here any more. They are reactivity terms,
       so the ledger section below says them - with a direction on them, which is
       what they are actually for. Two rows quoting one number is how a panel
       starts disagreeing with itself. */
    add("BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        Math.abs(s.boronDem-s.boron)>20?C.amber:C.ink2,
      "Where you have asked boron to go. It borates at "+BOR_IN+" pcm/s and only dilutes at "+BOR_OUT+", so poisoning yourself is the fast direction.");
    add("EMERG BORON",!P.boroninj?"none":s.borInjUsed?"EXPENDED":"available",
        !P.boroninj?C.ink2:s.borInjUsed?C.red:C.green,
      "A one-shot 4000 pcm dump. It shuts the core down when the rods will not, and it cannot be undone for the rest of the run.");
    add("FUEL DAMAGE",s.dmg.toFixed(1)+" %",
      /* any damage at all is the bad zone, so the good one is a sliver - which
         is the strip saying honestly that this scale has no safe stretch */
      band(s.dmg,0,100,[[1e-9,C.cyan,"NONE"],[100,C.red,"CLAD FAILED"]],{dp:0}),
      "Cladding that has already failed, and it is permanent. It grows whenever DNBR drops under 1.00 or the fuel passes 1500 K.");
    add.apply(null,rowFat(s));
    /* ══ THE LEDGER IS THE REACTOR'S ══
       This was a 364-wide overlay called REACTIVITY LEDGER, opened over the
       plant by a key. Every line in it is a property of the core, so it is on
       the core's plate, under its own head - and the bar each row used to carry
       is still there, in the 3 units the row already spent on a hairline.
       Nothing else on the plant wanted it, and nothing else can now show it. */
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
    /* Measured off the plant for the same reason DNBR is: a helium core runs
       1400 K below its own boiling point and a water one runs 22, so one fixed
       ceiling either pegs the gas plants or squashes the water ones into the
       first pixel. The 8 K line stays absolute - that is where the coolant
       stops being liquid, whatever it is made of. */
    const scHi=Math.max(60,(P.tsat0-P.Tref)*1.25);
    add("SUBCOOLING",sc.toFixed(1)+" K",
      band(sc,0,scHi,[[8,C.red,"SATURATED"],[scHi,C.cyan,"SUBCOOLED"]],
        {dp:0,lim:trip(3,"TRIP")}),
      "Degrees below boiling in the hot leg. The honest leak indicator: it collapses before anything else admits the loop is voiding.");
    add("SAT TEMP",tsat(s.P).toFixed(0)+" K",null,
      "The temperature the coolant would boil at, at the pressure it is held to right now.");
    add("LIFT SETPOINT",(P.P0*1.06).toFixed(2)+" MPa",null,
      "Where the relief valve opens on its own. It has an 18% chance of sticking open every single time it lifts.");
    /* The scale is a share of THIS plant's pressure - a sodium loop runs at
       0.2 MPa, so half a megapascal of scale is two and a half times its whole
       operating pressure. The 0.3 MPa line is absolute and stays that way; on a
       low-pressure plant it simply sits off the end, which is the reading
       saying honestly that such a plant is always within 0.3 of lifting. */
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
  /* Shielding has nothing to report, and neither has a component you never
     bought: an empty plate reading NOT FITTED is a leader line, a slot in the
     margin and a share of the zoom spent saying nothing. The grid already draws
     the dashed outline and the words on the symbol itself. No plate. */
  if(!R.length||!fitted(p)) return [];
  if(s.dmgParts.includes(p.id)) R.unshift(["STATUS","DAMAGED",C.red,
    "This component has taken a hit. Send a party from the REPAIR panel, or from the key drawn on the component itself."]);
  if(!p.access && p.grp!=="shield") R.unshift(["ACCESS","BLOCKED",C.red,
    "Your layout walls this in on every side, so no repair party can ever reach it. It stays broken for the rest of the run."]);
  return R;
}

/* ══ ONE PACKER, BOTH SCREENS ══
   The control room stands a plate beside every fitted component; the bench does
   the same with every component's parameters. That is one question asked twice -
   given a set of boxes that each belong to a component, which margin does each
   go in and where in it does it sit - so it is answered once, here. The caller
   brings boxes that already know their own size, because that is the part that
   genuinely differs: a readout plate is always PLW wide and a bench plate is as
   wide as the columns its parameters needed.

   `sides` is the margins the caller is willing to use. The bench uses all four:
   seventeen parameter plates in two side margins come to roughly 1500 units of
   column EACH against a grid 633 tall, so the deck above and below the plant is
   the only unspent room on the page. The control room stays on two, because its
   plates ARE measured into the view fit and a top margin would push the plant
   down the screen - say the word and it can have four as well. */
/* the packed position, then whatever the player has dragged it by. Every plate
   on the page moves this way, packed or placed, so it is one function: what is
   stored is an OFFSET from wherever it was put, never an absolute point. */
function plateDrag(q){ const o=plateOff[q.p.id]; if(o){ q.x+=o.dx; q.y+=o.dy; } return q; }
function plateStack(items,sides,anchor){
  sides = sides || ["L","R"]; anchor = anchor || "mid";
  const G={L:[],R:[],T:[],B:[]};
  /* the nearest edge in CELLS, because that is the face a leader wants to leave:
     a component on the keel calls out downwards whatever its x is */
  const near=q=>{
    const d={L:q.p.x, R:GW-(q.p.x+q.p.w), T:q.p.y, B:GH-(q.p.y+q.p.h)};
    return sides.reduce((a,k)=>d[k]<d[a]?k:a, sides[0]);
  };
  for(const q of items) G[near(q)].push(q);
  /* A margin's RUN is how far it stretches along its own axis - down the page in
     the side margins, across it above and below - and the drawing is as big as
     its worst margin, which is what sets the scale you can read everything at.
     So the run is levelled: take from the longest margin, give to the shortest,
     and take the plate whose component sits nearest the receiving edge, because
     that is the one whose leader grows least. Keep the move only while it
     actually shortens the longest margin. */
  const ax=k=>(k==="L"||k==="R");
  const run=k=>G[k].reduce((a,q)=>a+(ax(k)?q.h:q.w),0)+PLGAP*Math.max(0,G[k].length-1);
  const worst=()=>Math.max(...sides.map(run));
  const edge=(q,k)=>k==="L"?q.p.x : k==="R"?GW-(q.p.x+q.p.w)
                   : k==="T"?q.p.y : GH-(q.p.y+q.p.h);
  for(let guard=0;guard<60 && sides.length>1;guard++){
    const before=worst();
    const from=sides.reduce((a,k)=>run(k)>run(a)?k:a, sides[0]);
    const to  =sides.reduce((a,k)=>run(k)<run(a)?k:a, sides[0]);
    if(from===to || !G[from].length) break;
    let best=-1, bd=1e9;
    G[from].forEach((q,i)=>{ const t=edge(q,to); if(t<bd){ bd=t; best=i; } });
    const q=G[from][best];
    G[from].splice(best,1); G[to].push(q);
    if(worst()>=before){ G[to].pop(); G[from].splice(best,0,q); break; }
  }
  /* ══ EVERY EDGE THAT CAN BE A LINE IS A LINE ══
     Two alignments, and each is one line shared by a whole margin.
     ACROSS the margin, plates hang off their INNER edge - the one facing the
     plant, the one the leader leaves from - so all four margins present a
     straight edge to the drawing. A bench plate's width is modular by
     construction (n columns of PLBW with PLGAP between), so squaring the inner
     edge puts the outer edges on a ladder of the same module instead of
     nowhere in particular. The alternative, squaring the OUTER edge, is what
     was here and it left the inner edge ragged against the plant.
     ALONG the margin, `anchor:"start"` begins the stack on the grid's own corner
     rather than centred on its middle: a centred stack begins at whatever y the
     total run happens to make, which is a line shared with nothing, while
     started at GX/GY the first plate of every margin lines up with the edge of
     the plant itself. The control room stays on `"mid"` and that is not taste -
     alarmStack() floats at VIEW.x+4, VIEW.y+44, in the top left corner of the
     viewport, and a left margin started at the grid's top corner lands straight
     underneath it. Align the control room the day that stack moves. */
  const out=[];
  for(const k of sides){
    const list=G[k]; if(!list.length) continue;
    const st=(from,len)=>anchor==="start"? from : from+len/2-run(k)/2;
    if(ax(k)){
      list.sort((a,b)=>a.cy-b.cy);
      let y=st(GY,gridH());
      for(const q of list){
        q.x = k==="L" ? GX-PLLEAD-q.w : GX+GW*CELL+PLLEAD;
        q.y=y; q.side=k; y+=q.h+PLGAP; out.push(plateDrag(q)); }
    } else {
      list.sort((a,b)=>a.cx-b.cx);
      let x=st(GX,GW*CELL);
      for(const q of list){
        q.y = k==="T" ? GY-PLLEAD-q.h : GY+gridH()+PLLEAD;
        q.x=x; q.side=k; x+=q.w+PLGAP; out.push(plateDrag(q)); }
    }
  }
  return out;
}
function platesFor(){
  const items=[];
  for(const p of LAY.parts){
    const rows=readoutsFor(p,S); if(!rows.length) continue;
    const r=prect(p);
    items.push({p,rows,cx:r.x+r.w/2,cy:r.y+r.h/2,w:PLW,h:20+2*PLPAD+rows.length*PLROW});
  }
  return plateStack(items,["L","R"]);
}

/* ══ A PLATE IS A PLATE ON EITHER SCREEN ══
   The control room stands a table of live readouts beside every component. The
   bench stands the SELECTED component's parameters beside it - in the same box,
   on the same leader, in the same margin. So the leader, the box, the title row
   and the click target are drawn ONCE and neither screen has its own idea of
   what a callout looks like; only what goes inside differs. */

/* one label-and-value list, at whatever width it is handed. The control room's
   live table and the bench's MEASURED figures are the same object, so there is
   one of them and neither screen owns it. */
function plateRows(x,y,w,rows){
  rows.forEach((row,i)=>{
    const ry=y+i*PLROW+9;
    /* A section head is a row like any other - it costs PLROW and nothing else
       has to know it is there. It exists because the reactor's plate carries
       two different kinds of number now: what the core IS doing, and the
       reactivity that is making it do that. */
    if(row.sec){ rule(row.sec,x,ry,w,C.ink2); return; }
    txt(row[0],x,ry,{size:7,sp:.9,color:C.ink2});
    txt(row[1],x+w,ry,{size:9,align:"right",color:row[2]||C.cyan});
    /* A row that brought a sentence gets its own region. The plate pushed its
       own catcher first and findTip() takes the LAST match, so the row wins
       inside it and the component's tooltip still covers the gaps between rows.
       A row with nothing to add pushes nothing and falls through to it. */
    if(row[3]) TIP(x,ry-9,w,PLROW,row[0],row[3],row[4]);
    /* ══ THE ROW SEPARATOR IS THE LEDGER BAR ══
       A reactivity term is a DIRECTION before it is a number - left is pushing
       the core down, right is pushing it up - and that was the whole point of
       the ledger panel. A plate row is 144 units wide and the label and the
       figure take about 95 of them, so there is no lane in the middle for a bar
       that reads. There is one under it: the 3 units every row already reserves
       for its hairline. So a row that brings a signed fraction spends that on a
       bargraph instead, full width, and a row that does not still gets its
       hairline. Nothing grew to make room. */
    if(row[5]!=null) segSigned(x,ry+3,w,2,clamp(row[5],-1,1),row[2]);
    else if(i<rows.length-1) fillRect(x,ry+3,w,1,"rgba(120,180,190,.05)");
  });
  return y+rows.length*PLROW;
}
/* ══ A LEADER FINDS ITS OWN WAY ══
   The old leader was a fixed two-turn route through the midpoint, which is the
   right SHAPE and the wrong PATH: it went wherever the midpoint happened to be,
   straight across component labels, across the NOT FITTED tags on empty slots
   and across other plates. So the shape is now searched for rather than assumed
   - a 4-connected A* on a lattice a third of a cell across, with a turn penalty
   so it still comes out as a few long straight runs instead of a staircase.

   Everything a leader must not cross is a rectangle grown by LEAD_PAD, which is
   the "slight margin": every component (fitted or not - an empty slot still
   carries a dashed frame and a tag), every other plate, and the grid's own
   lettering, which is text nobody thinks of as an obstacle until a leader is
   drawn through it. The target component and the plate the leader belongs to
   are the two the search is allowed to touch, because they are its endpoints.

   The search is CACHED on a signature of every part and plate position, so it
   runs on the frame something moves and not on the 59 frames after it, and it
   gives up after LEAD_CAP expansions and falls back to the old two-turn route -
   a leader that is drawn late is worse than one drawn through a label. */
const LEAD_PAD=6, LEAD_STEP=CELL/3, LEAD_TURN=CELL*0.7, LEAD_CAP=9000;
let LEADOBS=[], LEADSIG="", LEADCACHE={};
function leadSetup(list){
  const obs=[], sig=[], GHp=gridH(), GWp=GW*CELL;
  const box=(x,y,w,h,id)=>obs.push({x:x-LEAD_PAD,y:y-LEAD_PAD,
                                    w:w+2*LEAD_PAD,h:h+2*LEAD_PAD,id});
  for(const p of LAY.parts){ const r=prect(p);
    box(r.x,r.y,r.w,r.h,p.id); sig.push(p.id,p.x,p.y); }
  for(const q of list){ box(q.x,q.y,q.w,q.h,"@"+q.p.id);
    sig.push("@"+q.p.id,q.x|0,q.y|0,q.w|0,q.h|0); }
  /* The grid's own captions, boxed where the WORDS are and not as bands round
     the whole perimeter. A band is what this was first, and it walled the plant
     off from its own margins: every leader has to cross the edge of the grid to
     reach anything inside it, so a full-width caption strip made every route
     impossible and every leader fell back. The elevation ruler down the left
     edge is left out for exactly that reason - it runs the full height, it is
     the faintest thing on the screen, and it is the one caption a leader is
     allowed to cross. */
  const cx=GX+GWp/2, cy=GY+GHp/2;
  box(cx-55,GY+3,110,12,"#deck");        // UPPER DECK / HULL
  box(cx-36,GY+GHp-15,72,12,"#keel");    // KEEL / HULL
  box(GX+5,cy-38,12,76,"#fwd");          // FWD BULKHEAD, read sideways
  box(GX+GWp-17,cy-38,12,76,"#aft");     // AFT BULKHEAD
  sig.push(GX|0,GY|0,GWp,GHp|0);
  const k=sig.join(",");
  if(k!==LEADSIG){ LEADSIG=k; LEADCACHE={}; }
  LEADOBS=obs;
}
/* the two rectangles a leader is allowed inside are its own two ends */
function leadBlocked(x,y,a,b){
  for(const o of LEADOBS){
    if(o.id===a||o.id===b) continue;
    if(x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h) return true; }
  return false;
}
function leadSearch(from,to,a,b){
  const x0=Math.min(from.x,to.x)-2*CELL, y0=Math.min(from.y,to.y)-2*CELL;
  const x1=Math.max(from.x,to.x)+2*CELL, y1=Math.max(from.y,to.y)+2*CELL;
  const nx=Math.ceil((x1-x0)/LEAD_STEP)+1, ny=Math.ceil((y1-y0)/LEAD_STEP)+1;
  if(nx*ny>LEAD_CAP*2) return null;
  const px=i=>x0+i*LEAD_STEP, py=j=>y0+j*LEAD_STEP;
  const IX=(i,j,d)=>(j*nx+i)*4+d;                       // d = the way we arrived
  const si=Math.round((from.x-x0)/LEAD_STEP), sj=Math.round((from.y-y0)/LEAD_STEP);
  const gi=Math.round((to.x-x0)/LEAD_STEP),   gj=Math.round((to.y-y0)/LEAD_STEP);
  const DX=[1,-1,0,0], DY=[0,0,1,-1];
  const prev={}, open=[[0,si,sj,-1]], seen={};
  seen[IX(si,sj,0)]=0;
  const h=(i,j)=>(Math.abs(i-gi)+Math.abs(j-gj))*LEAD_STEP;
  let n=0, endKey=null;
  while(open.length && n++<LEAD_CAP){
    let bi=0; for(let i=1;i<open.length;i++) if(open[i][0]<open[bi][0]) bi=i;
    const [,ci,cj,cd]=open.splice(bi,1)[0];
    const ck=IX(ci,cj,cd<0?0:cd), cg=seen[ck];
    if(cg===undefined) continue;
    if(ci===gi&&cj===gj){ endKey=ck; break; }
    for(let d=0;d<4;d++){
      const ni=ci+DX[d], nj=cj+DY[d];
      if(ni<0||nj<0||ni>=nx||nj>=ny) continue;
      const X=px(ni), Y=py(nj);
      const isEnd=(ni===gi&&nj===gj);
      if(!isEnd && leadBlocked(X,Y,a,b)) continue;
      const ng=cg+LEAD_STEP+(cd>=0&&cd!==d?LEAD_TURN:0);
      const nk=IX(ni,nj,d);
      if(seen[nk]!==undefined && seen[nk]<=ng) continue;
      seen[nk]=ng; prev[nk]=ck;
      open.push([ng+h(ni,nj),ni,nj,d]);
    }
  }
  if(endKey===null) return null;
  const pts=[]; let k=endKey;
  while(k!==undefined){ const c=Math.floor(k/4), i=c%nx, j=Math.floor(c/nx);
    pts.push([px(i),py(j)]); k=prev[k]; }
  pts.reverse();
  /* three points on one line are two points and a dot */
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const A=out[out.length-1], B=pts[i], C=pts[i+1];
    if((A[0]===B[0]&&B[0]===C[0])||(A[1]===B[1]&&B[1]===C[1])) continue;
    out.push(B); }
  out.push(pts[pts.length-1]);
  return out;
}
/* The leader turns twice, square to the face it leaves and square to the face it
   lands on, so it reads as a drawing callout rather than a wire. A plate above or
   below the plant is the same move rotated: out of the plate's near edge, across,
   and into the component's top or bottom face. */
/* the polyline only - separated from the stroke so the auditor can measure the
   route without a canvas, which is the whole reason the invariant is checkable */
function leadPts(q){
  const tgt=q.lead||q.p, r=prect(tgt), side=q.side;
  let pts, ax, ay, bx, by, sx=0, sy=0, tx=0, ty=0;
  if(side==="L"||side==="R"){
    ax=side==="L"? q.x+q.w : q.x; ay=q.y+q.h/2;
    bx=side==="L"? r.x : r.x+r.w; by=r.y+r.h/2;
    sx=side==="L"? 1 : -1; tx=-sx;
    const mx=(ax+bx)/2;
    pts=[[ax,ay],[mx,ay],[mx,by],[bx,by]];
  } else {
    ax=q.x+q.w/2; ay=side==="T"? q.y+q.h : q.y;
    bx=r.x+r.w/2; by=side==="T"? r.y : r.y+r.h;
    sy=side==="T"? 1 : -1; ty=-sy;
    const my=(ay+by)/2;
    pts=[[ax,ay],[ax,my],[bx,my],[bx,by]];
  }
  /* the searched path, or the old midpoint route if there is no way through */
  const key=q.p.id+">"+tgt.id+side;
  let found=LEADCACHE[key];
  if(found===undefined){
    const st=LEAD_PAD+2;
    found=leadSearch({x:ax+sx*st,y:ay+sy*st},{x:bx+tx*st,y:by+ty*st},
                     "@"+q.p.id,tgt.id) || null;
    LEADCACHE[key]=found;
  }
  if(found) pts=[[ax,ay]].concat(found).concat([[bx,by]]);
  return pts;
}
function plateLead(q,col,firm){
  const pts=leadPts(q), e=pts[pts.length-1];
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.strokeStyle=firm?col:"#1b2c31"; ctx.lineWidth=firm?1.4:1;
  ctx.setLineDash(firm?[]:[4,3]); ctx.stroke(); ctx.setLineDash([]);
  fillRect(e[0]-2,e[1]-2,4,4,col);
}
/* The box, and the fact that a plate IS the component: clicking it selects, and
   it carries the same tooltip. Both go down BEFORE whatever fills the plate,
   because the hit test and findTip() each take the LAST match - so a slider
   inside a bench plate has to be pushed after the plate's own catcher if it is
   to win inside it. Returns the y the content starts at. */
function plateShell(q,col,on,what,pad){
  pad=pad||0;
  fillRect(q.x,q.y,q.w,q.h,C.panel);
  /* the heading is a BAND now, not a line under some text. A hairline rule was
     the only thing separating the title cell from the table below, which is a
     border doing a job a change of ground does better; the band is flush to the
     plate's top edge and full width, so it reads as the heading rather than as
     a box drawn inside the box. */
  fillRect(q.x,q.y,q.w,20,C.panelHi);
  /* DESIGN REVIEW carries q.noBorder: it is already red, amber or green in
     three other places at once - its own title text, the [BLOCK]/[WARN] tag on
     every line, and "NO OBJECTIONS" in green when the list is empty - so an
     outline would be a fourth cue for a state the plate had already said three
     times over. Every other plate's border is still state carried where
     nothing else says it (a selected or damaged readout plate, an over-budget
     RESULTS) and stays. */
  if(!q.noBorder) frame(q.x,q.y,q.w,q.h,col);
  const titleF={size:7.5,sp:1.2,caps:1};
  txt(q.title||q.p.name,q.x+7,q.y+13,{...titleF,color:col===C.edge2?C.ink:col});
  /* the same warning circle the component itself carries on the bench (design
     review is its own plate and needs no dot pointing at itself, hence !q.free) */
  if(!q.free && screen==="design"){ const wc=warnFor(q.p.id);
    if(wc) dot(q.x+9+tw(q.title||q.p.name,titleF),q.y+6,6,wc); }
  /* a FREE plate belongs to the whole design and to no machine on it, so it has
     no elevation to print and nothing to select - but it still catches its own
     clicks, or a click on bare plate would reach the plant behind it */
  if(!q.free) txt("EL"+(GH-1-q.p.y),q.x+q.w-7,q.y+13,{size:6.5,sp:.8,align:"right",color:C.ink2});
  push({x:q.x,y:q.y,w:q.w,h:q.h,type:"btn",fn:q.free?null:()=>{ sel=q.p.id; }});
  /* The HEAD is the handle. Pushed after the plate's own catcher so it wins
     inside it, and it is only the 18 units above the hairline - everything
     below is a slider or an option row and has to stay clickable. */
  push({x:q.x,y:q.y,w:q.w,h:18,type:"plate",id:q.p.id});
  TIP(q.x,q.y,q.w,18,q.title||q.p.name,
    "Drag this head to move the plate. Double-click it to hand the plate back to the automatic layout. What is moved is the plate, not the component - the leader keeps pointing at the machine it belongs to.");
  TIP(q.x,q.y,q.w,q.h,q.p.name+what,q.p.tip);
  return q.y+20+pad;
}
function drawPlate(q){
  const dmg=S.dmgParts.includes(q.p.id), on=q.p.id===sel;
  const col=dmg?C.red:on?C.amber:C.edge2;
  plateLead(q,col,on||dmg);
  plateRows(q.x+7,plateShell(q,col,on," / LIVE READOUTS",PLPAD),q.w-14,q.rows);
}

/* ══ THE BENCH IS THE PLANT TOO ══
   The bench's parameters used to be a 736-wide drawer opened OVER the plant, so
   configuring a component hid the plant you were configuring it into. They
   stand in the margin now, in a plate, on a leader back to the machine.

   ALL SEVENTEEN, the same as the control room, and the old objection to that is
   dead rather than forgotten. The seventeen parameter stacks come to roughly
   3000 units of column against a grid that is 633 tall, so while the bench
   measured its plates into the view fit, drawing them all made the whole plant
   fit at about a quarter scale - too small to read and far too small to put a
   slider thumb on. The bench fits to the grid alone now, so a tall margin costs
   a pan and nothing else. What it buys is that a plate stops appearing and
   vanishing under the pointer as you click about the plant.

   The plate takes as many columns as it needs to stand inside the grid's own
   height, so it never becomes the thing that sets the scale everything else has
   to be drawn at. */
/* A bench column is 172, not the readout plate's 158, and that is measured
   rather than chosen: every bench widget - the option lists, the lattice plan,
   the dimension rack - was laid out and audited at 172, and at 158 the longest
   option names run straight into their own mass tags. What the two screens
   share is the BOX, not a number: a plate is as wide as what stands in it. */
const PLCW=172, PLBW=PLCW+14;
/* one component's parameters, measured into columns. No x or y: where it goes
   in the margin is plateStack()'s question, not this one's. */
function benchPlateFor(p){
  const blocks=paramsFor(p); if(!blocks.length || blocks.plain) return null;
  const gang=blocks.gang;
  const gap=6, head=20, pad=8;
  const tot=blocks.reduce((a,b)=>a+b.h+gap,0)-gap;
  const cap=Math.max(120,gridH()-head-pad);
  let n=1; while(n<4 && tot/n>cap) n++;
  const target=tot/n, cols=[[]];
  let cy=0;
  for(const b of blocks){
    /* break on the block's MIDDLE, so a tall one lands wherever it leaves the
       columns least uneven rather than always being pushed to the next */
    if(cols.length<n && cy>0 && cy+b.h/2>target){ cols.push([]); cy=0; }
    cols[cols.length-1].push(b); cy+=b.h+gap;
  }
  const colH=cols.map(c=>c.reduce((a,b)=>a+b.h+gap,0)-gap);
  const r=prect(p);
  return {p,cols,gap,gang,cx:r.x+r.w/2,cy:r.y+r.h/2,
          w:cols.length*PLBW+(cols.length-1)*PLGAP,
          h:head+Math.max(...colH)+pad};
}
/* ══ EVERY PLATE IS UP, ALL THE TIME ══
   It used to be exactly one, the selected component's, and it appeared and
   vanished under you as you clicked about the plant - which reads as the UI
   rearranging itself rather than as you reading a drawing. Nothing opens or
   shuts now: every component that has parameters has a plate, the same way the
   control room stands one beside every fitted component, and `sel` only says
   which of them is drawn in amber. Seventeen plates come to roughly 3000 units
   of column, which was the old objection to drawing them all - but the bench no
   longer measures its plates into the view fit, so a tall margin costs a pan and
   not the whole plant's scale. */
function benchPlates(){
  const items=[], gangs={};
  for(const p of LAY.parts){
    const q=benchPlateFor(p); if(!q) continue;
    /* a ganged component keeps the FIRST plate and lends the rest their ids: the
       set is one decision, so it is one box, and clicking any member lights it
       and swings the leader onto the member you actually clicked */
    if(q.gang){
      const first=gangs[q.gang];
      if(first){ first.ids.push(p.id); first.title=first.p.name.replace(/ \d+$/,"")+" x"+first.ids.length; continue; }
      q.ids=[p.id]; gangs[q.gang]=q;
    }
    items.push(q);
  }
  const packed=plateStack(items,["L","R","T","B"],"start");
  return packed.concat(benchFree(packed));
}

/* ══ TWO PLATES BELONG TO THE PLANT AND NOT TO ANY MACHINE ON IT ══
   What the design adds up to, and what is wrong with it. Neither is a property
   of a component, so neither HAS a component: no leader, no elevation, nothing
   to select. That is also why they cannot go through plateStack() - the packer
   picks a margin by asking which grid edge the plate's component sits nearest,
   and there is no component to ask.

   So they are placed against what the packer has already done rather than
   inside it: RESULTS across the foot of the drawing, below the lowest plate on
   the page, and REVIEW down the right of it, clear of the rightmost. Measured
   off the packed list every frame, so they stay clear however the margins fall
   and wherever a plate has been dragged to. RESULTS is exactly the width of the
   grid and starts on its corner - it is the whole plant's figure, so it lines
   up with the whole plant.

   They are still plates: same shell, same head, dragged by the same offset. */
const FREE_W=2*PLBW+PLGAP;
function benchFree(packed){
  let x1=GX+GW*CELL, y1=GY+gridH();
  for(const q of packed){ x1=Math.max(x1,q.x+q.w); y1=Math.max(y1,q.y+q.h); }
  const d=derived(), hard=designBlocked(null,PLANT_LM);
  const plate=(id,name,tip,w,ch,draw,col)=>
    ({free:1,draw,col,w,h:20+ch+8,p:{id,name,tip}});
  const res=plate("#results","RESULTS",
    "What this design adds up to: the mass it spends, and the seventeen figures that come out of the choices you made.",
    GW*CELL,benchResultsH(),benchResults,d.over?C.red:C.edge2);
  res.x=GX; res.y=y1+PLLEAD;
  const rev=plate("#review","DESIGN REVIEW",
    "What is wrong with this design, and the key that builds it. A blocking issue has to be cleared before the unit can be commissioned.",
    FREE_W,benchReviewH(FREE_W-14),benchReview,
    hard?C.red:(designIssues(null,PLANT_LM).length?C.amber:C.green));
  /* the plate's own title, its BLOCK/WARN tags and its NO OBJECTIONS line
     already say this state three times over - see plateShell() */
  rev.noBorder=1;
  rev.x=Math.max(x1,res.x+res.w)+PLLEAD; rev.y=GY;
  return [res,rev].map(plateDrag);
}
function drawBenchPlate(q){
  /* a free plate points at nothing and is never the selection, so it is the box
     and whatever stands in it - and its frame carries its own state instead,
     which is what says BLOCKED without anything having to be opened */
  if(q.free){ q.draw(q.x+7,plateShell(q,q.col,false,""),q.w-14); return; }
  const on=q.ids? q.ids.includes(sel) : q.p.id===sel, col=on?C.amber:C.edge2;
  q.lead = on&&q.ids ? LAY.parts.find(p=>p.id===sel) : q.p;
  plateLead(q,col,on);
  const y0=plateShell(q,col,on," / PARAMETERS");
  q.cols.forEach((c,i)=>{
    let cy=y0; const cx=q.x+7+i*(PLBW+PLGAP);
    for(const b of c){ b.draw(cx,cy,PLCW); cy+=b.h+q.gap; }
  });
}

/* the layoutMetrics() a drawPlant() call already paid for, so the bench's two
   FREE plates - which read layout figures too - do not pay for it again. They
   are measured and drawn from inside this same call, after BANDS has been set
   from the layoutMetrics() below, and layoutMetrics() clears BANDS as the very
   first thing it does: a second call anywhere downstream of that line would
   clobber it back to null with nothing left in the frame to set it again. */
let PLANT_LM=null;
/* the RESULTS/REVIEW plate rects, current as of the last bench frame - read
   by the bottom bar's MASS/WARNINGS click handlers to pan-and-zoom to them */
let BENCH_PLATES=null;
function drawPlant(y0,L,vh){
  PLANT_LM=layoutMetrics(); GY=y0;
  /* layoutMetrics() measured the design with no bands; from here on the view has
     them, and every row position comes from rowTop() rather than Y*CELL */
  /* BANDS is computed on BOTH screens now. It used to be null on the bench, which
     made every operable component shorter there than in the control room - the
     plant changed size the moment you commissioned it. */
  BANDS = ctlBands(!!L);
  const GHp=gridH(), rowH=Y=>rowTop(Y+1)-rowTop(Y);
  /* ══ the viewport ══
     Everything from here to the restore below is drawn in PLANT coordinates and
     shown through VIEW: clipped to the grid box, then scaled and offset. At
     s=1 that is the identity, so the plant is where it has always been and the
     geometry audit still measures it there. viewOn tags the widgets and the
     tooltip regions pushed inside, which is how the hit test knows to bring the
     pointer into this space instead of taking it at face value. */
  /* The VIEWPORT is the room the screen gives the plant - the content column,
     12..748 - and the CONTENT is the grid, which is now wider than that and is
     meant to be. These two were the same number while a cell was 46px, so
     passing the grid width as the viewport looked right and was not: it made
     fit come out at 1 and the plant hung a whole screen off the right margin. */
  /* the bench's ONE plate, laid out before anything is drawn, because the
     drawing needs it in hand by the time the components go down */
  const BP = L? null : benchPlates();
  /* ON THE BENCH THE FIT IS THE GRID, AND ONLY THE GRID. Measuring the plate
     into it made the whole plant re-scale and re-centre on every selection: a
     reactor plate is 382x465 and a turbine's is a fifth of that, so picking a
     component moved the drawing under the hand that picked it. The plate stands
     off the left or right edge of a grid that is already the full width of the
     viewport, so it is off-screen at fit and you PAN to it - which is what the
     view is for. The control room still measures its plates in, because there
     every fitted component has one and the set does not change with the
     selection. */
  /* THE FIT MEASURES WHERE THE PACKER PUT EACH PLATE, NEVER WHERE THE PLAYER
     DRAGGED IT. plateOff is subtracted back off here, because the view
     transform must not depend on the thing the pointer is currently moving:
     the drag delta is computed in PLANT units through vPt(), so a dragged
     plate that grows this box re-scales the view, which changes vPt(), which
     changes the next frame's delta - a runaway. Measured: a hand moving a
     steady 6 page px per frame moved the turbine plate 9 units on the first
     frame and 72 on the tenth, dragged it 87 units DOWN that it was never
     pushed, and shrank the whole plant from 0.64 to 0.47 under the hand. The
     bench dodges this by fitting the grid alone; the control room still wants
     its plates in the fit, because every fitted component has one and the set
     does not change with the selection - it only must not count the drag. */
  const B=(()=>{
    let x0=GX,x1=GX+GW*CELL,y0=GY,y1=GY+GHp;
    for(const q of (L? platesFor() : [])){
      const o=plateOff[q.p.id]||{dx:0,dy:0};
      const px=q.x-o.dx, py=q.y-o.dy;
      x0=Math.min(x0,px); x1=Math.max(x1,px+q.w);
      y0=Math.min(y0,py); y1=Math.max(y1,py+q.h); }
    return {x:x0-18,y:y0-18,w:x1-x0+36,h:y1-y0+36};
  })();
  vFit(GX,GY,W-2*GX,vh||GHp,B.x,B.y,B.w,B.h);
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

  /* The pipe itself: a dark casing, then the coloured fluid line inside it. A ROUND
     join, because a pipe bends and does not fold - the radius is half the line width,
     so the casing curves on 4px and the fluid inside it on 2px, concentric, which is
     what a real elbow does. What is IN the pipe is pipeFlow(), in render/pipes.js. */
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
  /* the fluid goes down BEFORE the components, because a pipe runs behind the plant
     and a packet should disappear under a vessel. The instruments go down after them
     - see pipeGauges() at the end of this function. */
  if(L) pipeFlow(L);

  for(const p of LAY.parts){
    const {x,y,w,h}=prect(p);
    /* an accumulator you never fitted has no pump to start: it used to draw
       "NOT FITTED" and a working INJECT button in the same box */
    const fit = fitted(p), live = L && fit;
    const ctl = live ? ctlFor(p,true,S.split) : null;
    /* The strip is a property of the DESIGN, not of the screen. The bench reserves
       exactly the room the control room will fill and draws the plinth empty, so
       the plant is the same size on both and nothing jumps when you commission. */
    const byk = fit ? autoOn(p.id) : null,
          bh  = byk? CTL_H : 0,
          sh  = stripH(p,live), sy = y+h-sh;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p;
    /* `fit &&`, or a component you never bought draws a REPAIR key straight
       across its own NOT FITTED tag. combatHit() only ever picks fitted parts
       so the game cannot reach that state - but the renderer should not depend
       on somebody else's filter to stay correct, and the auditor now damages
       every part at once precisely to ask whether it does. */
    const dmgd = L && fit && L.dmgParts.includes(p.id);
    const ink = !fit?"#3c4c47" : dmgd?C.red : on?C.amber : (hov(wd)||drag)?C.bright : C.metal;
    /* ══ a component you operate is ONE object ══
       A body outline round the whole part, the symbol in the top of it, and the
       controls inset into a plinth at the bottom. The outline is drawn in the
       component's own live ink, so the controls dim, brighten, select and go red
       WITH the machine they drive - that tie is the whole point, and it is why
       the plinth carries no colour of its own.
       A part with nothing to operate gets no body, because a body means "this is
       a machine you work". The design bench passes no live state, so it has no
       strips, so it has no bodies either - it is still the same renderer. */
    /* keys start at sy+1, so a top margin of STRIP_PAD puts the plinth here; the
       bottom margin is the STRIP_PAD that stripH() already reserved */
    const plinth = sh>0, py = sy+1-STRIP_PAD, pb = y+h-2;
    if(plinth) fillRect(x+2,y+2,w-4,h-4,C.panel);
    if(on) fillRect(x+1,y+1,w-2,h-2,"rgba(240,168,48,.07)");
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    if(fit) drawSym(p,x,y,w,h-sh-(plinth?4:0),ink,L);
    /* No outline and no divider. Tone alone says where the machine ends and its
       base begins: body, then a step lighter for the plinth, then the keys sunk
       back down into it. A line on top of that boundary was drawing an edge the
       fills had already drawn. The ink tie is carried by the symbol, which still
       brightens, selects and goes red with the component. */
    if(plinth) fillRect(x+2,py,w-4,pb-py,C.panelHi);   // the base the controls are set into
    /* Defeating a safety system should not look like flicking a pump switch. The
       distinction used to be a hairline and a shorter key; both are gone, because
       both read as untidiness rather than as meaning. It is tone now: the bypass
       stands in a band cut right back to the grid tone, so the bottom of a
       component visibly is not part of its control base. One step was not enough
       to see - C.panel against C.panelHi is a shade - so this is the full drop,
       and the key is INVERTED to match: every operating control is sunk into the
       plinth, a bypass stands proud out of a cut. Same height, same inset. */
    if(plinth && bh) fillRect(x+2,y+h-STRIP_PAD-bh,w-4,STRIP_PAD+bh-2,C.well);
    /* The keys land clear of the plinth: they start at x+6 and stop STRIP_PAD
       above the bottom edge. */
    if(dmgd){ hatch(x+3,y+3,w-6,h-6,C.red,.4); badge(x+w-9,y+12,C.red);
      /* the party is dispatched from the broken thing itself; the damage panel
         still lists them, because you want one place that says how many */
      /* centred in the SYMBOL, not in the component: a component with controls
         on it is mostly plinth below the symbol, and the middle of the whole
         box is somebody else's row of readouts. Measured by the auditor, which
         caught this key sitting on TILT. */
      const symH=h-sh-(plinth?4:0);
      const busy=L.repair&&L.repair.id===p.id, kw=Math.min(w-16,86), kx=x+(w-kw)/2;
      button(kx,y+symH/2-9,kw,14,busy?Math.round(L.repair.t/L.repair.need*100)+"%"
             :p.access?"REPAIR":"NO ACCESS",
        {sunk:1,on:busy,danger:!p.access,size:7,sp:.8,fn:()=>repairSend(p)});
    }
    else if(!p.access && p.grp!=="shield" && fit) badge(x+w-9,y+12,C.amber);
    /* what this component is shouting about, if anything */
    if(L&&fit){ const al=annLamp(p.id); if(al) lamp(x+10,y+11,al); }
    /* the bench has no alarm lamp (L is null, no live state to light one), so
       that top-left corner is free for the same thing the DESIGN REVIEW plate
       says about this component - a warning circle, not the fault triangle,
       because nothing is broken yet */
    if(!L && fit && !dmgd){ const wc=warnFor(p.id); if(wc) dot(x+6,y+8,8,wc); }
    /* a one-cell component with a knob has no room for a separate value tag,
       and does not need one - the knob shows its own number */
    const v0 = L&&fit ? liveValue(p,L) : null, v = (ctl&&p.h<2)? null : v0;
    const nm = (v0&&!v)? p.name+"  "+v0 : p.name;
    /* the tags stop above the divider rather than sitting on it */
    const tb = plinth ? sy-6 : sy-3;
    tag(nm,x+w/2,tb-(v?11:1),6.5,.4,!fit?"#3c4c47":(on?C.amber:C.ink2));
    if(v) tag(v,x+w/2,tb,8,0,dmgd?C.red:liveColor(p,L));
    if(!fit) tag("NOT FITTED",x+w/2,y+h/2+2,6,.2,"#3c4c47");
    /* the component tooltip goes down FIRST: findTip() scans backwards and takes
       the first hit, so anything pushed after it wins inside its own rect. Push
       it last and it swallows every control tooltip in the strip. */
    TIP(x,y,w,h,p.name+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ DAMAGED ]":"")+
        (p.access||p.grp==="shield"?"":"  [ NO ACCESS ]"),
      p.tip+(p.access||p.grp==="shield"?"":"  It is boxed in on every side - nobody could reach it to repair it."));
    /* inset far enough that a margin of plinth shows all the way round each
       control - at 4px the body outline and the control frame were touching */
    if(ctl) ctl.forEach((row,i)=>ctlStrip(row,x+6,sy+i*CTL_H+1,w-12,CTL_H-3));
    if(byk && live) bypRow(byk,x+6,y+h-STRIP_PAD-bh+1,w-12,bh-3);
  }
  /* an instrument is bolted to the outside of the thing it measures, so it goes down
     last. Drawn before the components, the pressurizer gauge was painted over by the
     pressurizer. */
  if(L) pipeGauges(L);
  else pipeGrips(NET);          // where a pipe runs is a bench question - see pipeGrips()
  pipeJuncMarks(L);             // both screens - see pipeJuncMarks()
  if(L){ const pl=platesFor(); leadSetup(pl);
    for(const q of pl) if(q.p.id!==sel) drawPlate(q);
    for(const q of pl) if(q.p.id===sel) drawPlate(q);   // the selected one on top
  }
  else { leadSetup(BP); for(const q of BP) drawBenchPlate(q); BENCH_PLATES=BP; }
  viewOn=false; ctx.restore();

  /* The one control the view itself has, drawn OUTSIDE the transform so it
     keeps its size and its place whatever the plant is doing. It is one key
     rather than two because it has one job at a time: at fit scale the only
     useful move is in, and once you are in the only move you cannot make with
     the hand is all the way back out. Zooming in aims at the component you have
     selected, because that is the one you were reading. */
  /* OFF FIT, not just zoomed IN: the view zooms out past fit as well now, and a
     key that only offered the way home from above left the far side stranded */
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
