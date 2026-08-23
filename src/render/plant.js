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
/* The design floor is PUMPS[D.pumps].floor - commission() bakes exactly that into
   P.flowMin. The bench asks the design directly because it runs BEFORE any plant
   has been commissioned and P is still null there; ctlFor() is called on the bench
   now, to reserve the room the control room will need, so everything it builds
   eagerly has to survive P===null. */
const pumpFloor=()=>P? P.flowMin : PUMPS[D.pumps].floor;
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
const PLW=158, PLGAP=10, PLROW=13, PLLEAD=30;

function readoutsFor(p,s){
  const heat=s.n*.935+s.decay, Th=s.Tavg+15*heat, Tc=s.Tavg-15*heat, sc=tsat(s.P)-Th;
  const id=p.id, R=[];
  const add=(k,v,c)=>R.push([k,v,c||C.cyan]);
  if(id==="core"){
    add("POWER",(s.n*100).toFixed(1)+" %",(s.n>1.1||s.dnbr<1.3)?C.red:C.green);
    add("THERMAL",(s.n*P.rated).toFixed(0)+" MWt");
    add("DNBR",s.dnbr.toFixed(2),s.dnbr<1?C.red:s.dnbr<1.3?C.amber:C.cyan);
    add("FUEL TEMP",s.Tf.toFixed(0)+" K",s.Tf>1500?C.red:C.cyan);
    add("PEAK Fq",s.fq.toFixed(2),s.fq>3.2?C.amber:C.cyan);
    add("HOT SPOT","R"+s.hotRing+" / EL"+s.hotLev);
    add("AX / RAD OFFSET",(s.ao*100).toFixed(0)+" / "+(s.ro*100).toFixed(0)+" %",
        Math.abs(s.ao)>.35||Math.abs(s.ro)>.35?C.amber:C.cyan);
    add("VOID",s.vf.toFixed(2),s.vf>.15?C.red:C.cyan);
    add("INVENTORY",s.inv.toFixed(1)+" %",s.inv<95?C.red:C.blue);
    add("BORON",s.boron.toFixed(0)+" pcm");
    add("BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        Math.abs(s.boronDem-s.boron)>20?C.amber:C.ink2);
    add("EMERG BORON",!P.boroninj?"none":s.borInjUsed?"EXPENDED":"available",
        !P.boroninj?C.ink2:s.borInjUsed?C.red:C.green);
    add("XENON",s.parts.xe.toFixed(0)+" pcm");
    add("FUEL DAMAGE",s.dmg.toFixed(1)+" %",s.dmg>0?C.red:C.cyan);
    add("VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",s.fatigue>50?C.amber:C.cyan);
  } else if(id==="rods"){
    add("BANK POSITION",(s.rodPos*100).toFixed(1)+" %");
    add("BANK DEMAND",(s.rodDem*100).toFixed(1)+" %",
        Math.abs(s.rodDem-s.rodPos)>.005?C.amber:C.ink2);
    add("WORTH HERE",coreRodWorth(s).toFixed(0)+" pcm");
    add("DRIVES",s.rodJam?"JAMMED":"answering",s.rodJam?C.red:C.green);
    add("SCRAM TIME",(1/P.scram).toFixed(1)+" s");
    add("TRIP LATCH",s.scrammed?"LATCHED":"clear",s.scrammed?C.amber:C.green);
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2);
    add("RESET WOULD",!s.scrammed?"n/a":(P.rps&&tripCause())?"REFUSE":"clear",
        !s.scrammed?C.ink2:(P.rps&&tripCause())?C.red:C.green);
    add("NET RHO",s.rho.toFixed(0)+" pcm",Math.abs(s.rho)<50?C.green:C.amber);
    add("TILT TRIM",(s.tilt>=0?"+":"")+s.tilt.toFixed(2),
        Math.abs(s.tilt)>.05?C.amber:C.ink2);
    add("TILT DEMAND",(s.tiltDem>=0?"+":"")+s.tiltDem.toFixed(2),
        Math.abs(s.tiltDem-s.tilt)>.01?C.amber:C.ink2);
    add("SHUTDOWN MGN",P.sdm.toFixed(0)+" pcm",P.sdm<200?C.red:C.green);
  } else if(id==="pzr"){
    add("PRESSURE",s.P.toFixed(2)+" MPa",pColor(s.P));
    add("LEVEL",s.lvl.toFixed(1)+" %",s.lvl>78?C.amber:C.cyan);
    add("SUBCOOLING",sc.toFixed(1)+" K",sc<8?C.red:C.cyan);
    add("SAT TEMP",tsat(s.P).toFixed(0)+" K");
    add("LIFT SETPOINT",(P.P0*1.06).toFixed(2)+" MPa");
    add("MARGIN TO LIFT",(P.P0*1.06-s.P).toFixed(2)+" MPa",
        P.P0*1.06-s.P<0.3?C.amber:C.cyan);
    add("PORV",(s.porvOpen&&!s.porvBlocked)?"PASSING":"shut",
        (s.porvOpen&&!s.porvBlocked)?C.red:C.green);
    add("BLOCK VALVE",s.porvBlocked?"SHUT":"open",s.porvBlocked?C.red:C.green);
    add("AUTO RELIEF",autoState("porv").toLowerCase(),
        autoLive("porv")?C.green:C.amber);
  } else if(id.startsWith("sg")){
    add("SG LEVEL",s.sgl.toFixed(1)+" %",s.sgl<25?C.red:C.cyan);
    add("STEAM PRESS",(P.P0*.45*Math.pow(Math.max(s.load,.05),.25)).toFixed(2)+" MPa");
    add("T-HOT IN",Th.toFixed(0)+" K");
    add("T-COLD OUT",Tc.toFixed(0)+" K");
    add("HEAT REMOVED",(Math.min(s.n,s.load)*P.rated).toFixed(0)+" MWt");
    add("NAT CIRC",(s.nat*100).toFixed(0)+" %",s.nat>.1?C.green:C.ink2);
    add("TUBES",s.sgtr?"LEAKING":"intact",s.sgtr?C.red:C.green);
  } else if(id.startsWith("pump")){
    add("FLOW",(s.flow*100).toFixed(1)+" %",s.flow<P.flowMin?C.red:C.cyan);
    add("FLOW DEMAND",(s.flowDem*100).toFixed(1)+" %",
        Math.abs(s.flowDem-s.flow)>.005?C.amber:C.ink2);
    add("DESIGN FLOOR",(P.flowMin*100).toFixed(0)+" %");
    add("HOT CHANNEL",(s.hotFlow*100).toFixed(0)+" %",s.hotFlow<.8?C.amber:C.cyan);
    add("CAVITATION",(s.cav*100).toFixed(0)+" %",s.cav>.15?C.amber:C.cyan);
    add("NAT CIRC",(s.nat*100).toFixed(0)+" %");
    add("PUMPS LOST",s.dmgParts.filter(k=>k.startsWith("pump")).length+" / "+P.loops,
        s.dmgParts.some(k=>k.startsWith("pump"))?C.red:C.green);
  } else if(id==="turb"){
    add("LOAD",(s.load*100).toFixed(1)+" %");
    add("LOAD DEMAND",(s.loadDem*100).toFixed(1)+" %",
        Math.abs(s.loadDem-s.load)>.005?C.amber:C.ink2);
    add("ELECTRICAL",(Math.min(s.n,s.load)*P.rated/3).toFixed(0)+" MWe");
    add("T-AVG DEV",(s.Tavg-tProg(s)>=0?"+":"")+(s.Tavg-tProg(s)).toFixed(1)+" K");
    add("STEAM DUMP",(P.bypass*100).toFixed(0)+" %");
    add("GOV STROKE",LOAD_TAU.toFixed(0)+" s");
    add("RUNBACK",autoState("runback").toLowerCase(),
        autoLive("runback")?C.green:C.amber);
  } else if(id==="ctrl"){
    add("RPS",rpsState().toLowerCase(),rpsLive()?C.green:C.amber);
    add("LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2);
    add("INSTRUMENTS",P.noise<.2?"VOTED":P.noise<.6?"2CH DRIFT":"1CH RAW",
        P.noise>.6?C.amber:C.green);
    add("PARTY DOSE",s.dose.toFixed(1)+" %",s.dose>50?C.red:C.cyan);
    add("DOSE RATE",P.dose.toFixed(2)+" x",P.dose>1?C.amber:C.green);
    add("EVENTS",LOG.length+"");
  } else if(id==="hpi"){
    add("INJECTION",s.hpi?"RUNNING":"stopped",s.hpi?C.cyan:C.ink2);
    add("RATE",P.hpiRate.toFixed(2)+" %/s");
    add("HEAD OVER CORE",P.lay.hpiHead.toFixed(2)+" x");
    add("INVENTORY",s.inv.toFixed(1)+" %",s.inv<95?C.red:C.blue);
    add("VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",s.fatigue>50?C.amber:C.cyan);
  } else if(id==="cont"){
    add("RELEASE",s.release.toFixed(2)+" %",s.release>1?C.red:C.cyan);
    add("HELD BACK",((1-P.contRel)*100).toFixed(0)+" %");
    add("CORE CATCHER",P.catcher?"fitted":"none",P.catcher?C.green:C.ink2);
    add("VESSEL",s.breach?"RUPTURED":"intact",s.breach?C.red:C.green);
  } else if(id==="bkp"){
    add("BLACKOUT",s.blackout?"ACTIVE":"no",s.blackout?C.red:C.green);
    add("CAPACITY",(P.backup*100).toFixed(0)+" %");
    add("SUPPLY",s.bkpLost?"DESTROYED":"available",s.bkpLost?C.red:C.green);
    add("NAT CIRC",(s.nat*100).toFixed(0)+" %");
  } else if(id==="feed"){
    add("SG LEVEL",s.sgl.toFixed(1)+" %",s.sgl<25?C.red:C.cyan);
    add("EMERG FEED",autoState("efw").toLowerCase(),
        autoLive("efw")?C.green:C.amber);
    add("FEED PUMP",s.dmgParts.includes("feed")?"DESTROYED":"running",
        s.dmgParts.includes("feed")?C.red:C.green);
  } else if(id==="cond"){
    add("T-HOT",Th.toFixed(0)+" K");
    add("HEAT REJECTED",(Math.min(s.n,s.load)*P.rated*.66).toFixed(0)+" MWt");
    add("CONDENSER",s.dmgParts.includes("cond")?"DESTROYED":"in service",
        s.dmgParts.includes("cond")?C.red:C.green);
  }
  /* Shielding has nothing to report, and neither has a component you never
     bought: an empty plate reading NOT FITTED is a leader line, a slot in the
     margin and a share of the zoom spent saying nothing. The grid already draws
     the dashed outline and the words on the symbol itself. No plate. */
  if(!R.length||!fitted(p)) return [];
  if(s.dmgParts.includes(p.id)) R.unshift(["STATUS","DAMAGED",C.red]);
  if(!p.access && p.grp!=="shield") R.unshift(["ACCESS","BLOCKED",C.red]);
  return R;
}

function platesFor(){
  const L=[], R=[];
  for(const p of LAY.parts){
    const rows=readoutsFor(p,S); if(!rows.length) continue;
    const r=prect(p);
    (p.x+p.w/2 < GW/2 ? L : R).push({p,rows,cy:r.y+r.h/2,h:20+rows.length*PLROW});
  }
  /* Side by grid position alone leaves one margin twice as tall as the other, and
     the whole drawing is then as tall as its worst column - which is what sets the
     zoom you can read everything at. So the two margins are balanced: the plate
     whose component sits nearest the centre line changes sides, over and over,
     for exactly as long as that shortens the taller margin. Nearest the centre
     first, because that is the one whose leader line grows least. */
  const sum=A=>A.reduce((a,q)=>a+q.h,0)+PLGAP*Math.max(0,A.length-1);
  for(let guard=0;guard<40;guard++){
    const d=sum(L)-sum(R); if(!d) break;
    const A=d>0?L:R, B=d>0?R:L;
    let best=-1, bd=1e9;
    A.forEach((q,i)=>{ const t=Math.abs(q.p.x+q.p.w/2-GW/2); if(t<bd){ bd=t; best=i; } });
    if(best<0) break;
    const q=A[best];
    B.push(q); A.splice(best,1);
    if(Math.abs(sum(L)-sum(R))>=Math.abs(d)){ A.push(q); B.pop(); break; }
  }
  const mid=GY+gridH()/2, out=[];
  for(const [list,side] of [[L,"L"],[R,"R"]]){
    list.sort((a,b)=>a.cy-b.cy);
    const tot=list.reduce((a,q)=>a+q.h,0)+PLGAP*Math.max(0,list.length-1);
    let y=mid-tot/2;
    const x = side==="L" ? GX-PLLEAD-PLW : GX+GW*CELL+PLLEAD;
    for(const q of list){ q.x=x; q.y=y; q.w=PLW; q.side=side; y+=q.h+PLGAP; out.push(q); }
  }
  return out;
}

function drawPlate(q){
  const r=prect(q.p), dmg=S.dmgParts.includes(q.p.id), on=q.p.id===sel;
  const col=dmg?C.red:on?C.amber:C.edge2;
  const ax=q.side==="L"? q.x+q.w : q.x, ay=q.y+q.h/2;
  const bx=q.side==="L"? r.x : r.x+r.w, by=r.y+r.h/2;
  /* the leader turns once, square to the face it leaves, so it reads as a
     drawing callout rather than a wire */
  const mx=(ax+bx)/2;
  ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(mx,ay); ctx.lineTo(mx,by); ctx.lineTo(bx,by);
  ctx.strokeStyle=dmg?C.red:on?C.amber:"#1b2c31"; ctx.lineWidth=on||dmg?1.4:1;
  ctx.setLineDash(on||dmg?[]:[4,3]); ctx.stroke(); ctx.setLineDash([]);
  fillRect(bx-2,by-2,4,4,col);

  fillRect(q.x,q.y,q.w,q.h,C.panel); frame(q.x,q.y,q.w,q.h,col); accent(q.x,q.y,q.w,col);
  if(on) ticks(q.x+.5,q.y+.5,q.w-1,q.h-1,C.amber,6);
  txt(q.p.name,q.x+7,q.y+13,{size:7.5,sp:1.2,caps:1,color:col===C.edge2?C.ink:col});
  txt("EL"+(GH-1-q.p.y),q.x+q.w-7,q.y+13,{size:6.5,sp:.8,align:"right",color:C.ink2});
  fillRect(q.x+7,q.y+17,q.w-14,1,"rgba(120,180,190,.10)");
  q.rows.forEach((row,i)=>{
    const ry=q.y+20+i*PLROW+9;
    txt(row[0],q.x+7,ry,{size:7,sp:.9,color:C.ink2});
    txt(row[1],q.x+q.w-7,ry,{size:9,align:"right",color:row[2]});
    if(i<q.rows.length-1) fillRect(q.x+7,ry+3,q.w-14,1,"rgba(120,180,190,.05)");
  });
  /* the plate is the component: clicking it selects, and it carries the same tip */
  push({x:q.x,y:q.y,w:q.w,h:q.h,type:"btn",fn:()=>{ sel=q.p.id; }});
  TIP(q.x,q.y,q.w,q.h,q.p.name+" / LIVE READOUTS",q.p.tip);
}

function drawPlant(y0,L,vh){
  layoutMetrics(); GY=y0;
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
  const B=(()=>{
    let x0=GX,x1=GX+GW*CELL,y0=GY,y1=GY+GHp;
    if(L) for(const q of platesFor()){ x0=Math.min(x0,q.x); x1=Math.max(x1,q.x+q.w);
      y0=Math.min(y0,q.y); y1=Math.max(y1,q.y+q.h); }
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
  const PC=pipeColours(L);
  for(const pass of [0,1]) for(const r of pipeNetwork()){
    if(pass&&r.k==="hpi"&&L&&!L.hpi) continue;
    ctx.beginPath(); ctx.moveTo(r.pts[0][0],r.pts[0][1]);
    for(let i=1;i<r.pts.length;i++) ctx.lineTo(r.pts[i][0],r.pts[i][1]);
    ctx.lineCap="square"; ctx.lineJoin="round";
    const thin = r.k==="hpi"||r.k==="surge";
    ctx.lineWidth = pass? (thin?3:4) : (thin?6:8);
    ctx.strokeStyle = pass? PC[r.k] : "#22383e";
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
    const dmgd = L && L.dmgParts.includes(p.id);
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
    /* The registration marks go down AFTER the plinth, and they are the only part
       of the selection that does. The plinth covers the bottom third of a
       component, so drawn with the wash they were painted straight over and the
       bottom two corners of a selected part were all but invisible. The keys land
       clear of them: they start at x+6 and stop STRIP_PAD above the bottom edge. */
    if(on) ticks(x+2.5,y+2.5,w-5,h-5,C.amber,7);
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
  if(L){ const pl=platesFor();
    for(const q of pl) if(q.p.id!==sel) drawPlate(q);
    for(const q of pl) if(q.p.id===sel) drawPlate(q);   // the selected one on top
  }
  viewOn=false; ctx.restore();

  /* The one control the view itself has, drawn OUTSIDE the transform so it
     keeps its size and its place whatever the plant is doing. It is one key
     rather than two because it has one job at a time: at fit scale the only
     useful move is in, and once you are in the only move you cannot make with
     the hand is all the way back out. Zooming in aims at the component you have
     selected, because that is the one you were reading. */
  { const zoomed=VIEW.z>1.001, kw=52, kx=VIEW.x+VIEW.w-kw-4, ky=VIEW.y+4;
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
