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
    coreField(bx+2,by+2,bw-4,bh-4,coreView(L));
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
  const NC=XNR*2-1, cw=w/NC, ch=h/XNZ, rMax=Math.min(cw,ch)*0.44;
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
      ctx.beginPath(); ctx.arc(cx,cy,r,0,7);
      if(V.nV && V.nV[k]>.12){ ctx.strokeStyle=col; ctx.lineWidth=Math.max(.7,r*.55); ctx.stroke(); }
      else { ctx.fillStyle=col; ctx.fill(); }
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

/* Semantic colour for that readout, where the number carries an alarm meaning of
   its own. Everything else is plain data cyan. Mirrors liveValue() case for case. */
function liveColor(p,s){
  switch(true){
    case p.id==="pzr": return pColor(s.P);
    default: return C.cyan;
  }
}

/* ══════════ IN-COMPONENT CONTROLS (control room only) ══════════
   A control is not a separate box parked somewhere on the grid: it is a strip
   along the bottom of the component it drives, inside that component's own cells.
   Several controls share one strip by weight.  The design bench passes no live
   state, so its grid carries no strips at all. */
/* The pump tooltip is shown by the diagram strip and by the inspector, so it is
   written once. It is a function, not a constant, because the design floor it
   names is only known after commission(). */
const pumpTip=()=>"Primary flow. More flow carries heat away faster and directly buys DNBR margin; less flow heats the fuel and eventually boils the core. The pumps have inertia, so flow follows demand over about "+FLOW_TAU+" s and coasts down over "+FLOW_TAU_COAST+" s if the power goes. The pumps can be stopped completely: the red line on the track is the "+(P.flowMin*100).toFixed(0)+"% floor the pumps were built for, and the protection system trips on LOW FLOW below it. Defeat the protection and nothing stops you - the core is left on buoyancy alone. The thin amber line is demand, the thumb is what the loop has.";
/* ctlFor() returns ROWS of controls, not one flat list. A slider sharing a strip
   with two buttons got 30px of a 92px component, which is 3.3% of rod travel per
   pixel - unusable. Each row is CTL_H tall and the grid row underneath the
   component grows to fit them all, so a slider gets the whole component width. */
const CTL_H=13;
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
function ctlFor(p){
  if(p.id.startsWith("pump")) return [[
    /* the floor is a trip setpoint, not a stop: the panel may order the pumps
       off entirely, and the mark says where that starts costing */
    {kind:"sld",flex:1,val:()=>S.flow*100,min:()=>0,max:()=>100,
     dem:()=>S.flowDem*100,mark:()=>P.flowMin*100,
     fmt:v=>v.toFixed(0)+" %",set:v=>{S.flowDem=v/100;},
     tip:"COOLANT PUMPS - "+pumpTip()}]];
  switch(p.id){
    /* Two modes, one component. GANGED the plant has a single bank and the tilt
       slider is the only handle on the shape; SPLIT, the per-bank demands ARE
       that handle, so the tilt slider stands down and each bank takes a row of
       its own with its own AUTO switch. Ganged is held to exactly three rows,
       because that is the height the default plant's grid was measured with. */
    case "rods": {
      const bankRow=b=>[
       {kind:"btn",flex:1,on:()=>!S.bankAuto[b],text:()=>S.bankAuto[b]?"AUT":"MAN",
        fn:()=>{ S.bankAuto[b]=!S.bankAuto[b]; },
        tip:"BANK "+(b+1)+" MODE - hands this bank to the temperature controller, or takes it back. On MANUAL the bank goes exactly where you put it and stays there through everything short of a scram. Every bank you take off AUTO leaves the same temperature error to be answered by less rod worth, so the loop does not just move less, it moves slower."},
       {kind:"sld",flex:2.8,val:()=>S.rodZ[b]*100,min:()=>0,max:()=>100,
        dem:()=>S.rodZDem[b]*100,
        fmt:v=>"B"+(b+1)+" "+v.toFixed(0)+" %",set:v=>{S.rodZDem[b]=v/100;},
        tip:"BANK "+(b+1)+" - insertion of this bank alone. While the banks are split these per-bank demands are the tilt handle: standing one bank against another is the whole of how you answer a radial xenon tilt here. A bank left on MANUAL is not answering the temperature controller at all, and the fewer banks on AUTO, the less rod worth is left to answer the same error - the loop gets slower, not just smaller."}];
      if(S.split){
        const rows=[[{kind:"btn",flex:1,on:()=>S.reGang,
          text:()=>S.reGang?"GANGING..":"BANK GANG",
          /* already a no-op once the walk is running: setSplit() refuses to
             re-seed a gang it is in the middle of */
          fn:()=>{ setSplit(false); },
          tip:"GANG BANKS - drives every bank back onto one common position and gives the shape back to the tilt slider. It is not a flick of a switch: the banks walk together at drive rate and stay split until they arrive, so a wide spread costs you the seconds it takes to close."}]];
        for(let b=0;b<P.NB;b++) rows.push(bankRow(b));
        rows.push(ROD_TRIP_ROW);
        return rows;
      }
      return [
       [{kind:"sld",flex:1,val:()=>S.rodPos*100,min:()=>0,max:()=>100,dem:()=>S.rodDem*100,
         fmt:v=>v.toFixed(0)+" %",set:v=>{S.rodDem=v/100;},
         tip:"CONTROL BANK - rod insertion, every bank together. Fast, but it travels at only 1.2%/s, and deep insertion raises power peaking, which eats thermal margin. While a trip is latched the bank stays in whatever you ask of it."}],
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
      P.boroninj?[[{kind:"btn",flex:1,danger:()=>!S.borInjUsed,
       text:()=>S.borInjUsed?"SPENT":"BORON DUMP",
       fn:()=>{ if(!S.borInjUsed){ S.borInjUsed=true; S.boron-=4000; S.boronDem-=4000;
         logE("alarm","EMERGENCY BORON INJECTED",
           "4000 pcm dumped into the loop. Shut down hard, and it cannot be undone this run."); } },
       tip:"EMERGENCY BORON - one-shot poison dump worth 4000 pcm. Shuts the reactor down when the rods will not, and it cannot be undone."}]]:[]);
    case "turb": return [[
      {kind:"sld",flex:1,val:()=>S.load*100,min:()=>0,max:()=>125,dem:()=>S.loadDem*100,
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
function stripH(p){
  if(!fitted(p)) return 0;
  const ctl=ctlFor(p);
  return (ctl? ctl.length*CTL_H : 0) + (autoOn(p.id)? BYP_H : 0);
}
function ctlBands(){
  const b=new Array(GH).fill(0);
  for(const p of LAY.parts){
    const r=p.y+p.h-1;                       // the strip sits in the LAST row it spans
    if(r>=0&&r<GH) b[r]=Math.max(b[r],stripH(p));
  }
  return b;
}

/* ══════════ BYPASS SWITCHES (control room only) ══════════
   Defeating a system is not an operating control, so it does not share the
   control strip: it gets its own thinner strip along the very bottom of the
   component that carries the system. AUTOSYS says which component that is, so
   there is exactly one switch per system and no component carries two. */
const BYP_H=11;
function bypRow(k,x,y,w,h){
  const A=AUTOSYS[k], fit=autoFit(k), lit=fit&&S.byp[k];
  const wd=push({x,y,w,h,type:"btn",fn:()=>{ if(fit) autoToggle(k); }});
  const hv=fit&&hov(wd);
  fillRect(x,y,w,h, lit?"#2a1f08":(hv?C.panelHi:C.panel));
  frame(x,y,w,h, lit?C.amber:C.edge);
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
      const cy=y+h/2, lab=c.fmt(c.val());
      slider(cx,cy,cw,c.val(),c.min(),c.max(),
        {th:h,tw:7,ticks:false,dem:c.dem?c.dem():null,mark:c.mark?c.mark():null,
         fn:v=>c.set(c.step?Math.round(v/c.step)*c.step:v)});
      /* the readout sits at whichever end the thumb is not, or the opaque plate
         hides the very thing you are dragging.
         The gate is measured rather than picked: it used to be cw>=64, a number
         standing in for "the label is narrower than the track". It stopped being
         true the moment a slider carried a label that was not a bare percentage,
         so ask the label how wide it is - plate plus a 3px margin at each end. */
      if(cw >= tw(lab,{size:6.5})+16){ const lw=tw(lab,{size:6.5}),
            far=(c.val()-c.min())/(c.max()-c.min()) > .5;
        tag(lab, far? cx+lw/2+3 : cx+cw-lw/2-3, midBase(y,h,6.5), 6.5,0,C.cyan); }
    } else {
      /* a narrow box loses its letter spacing before it loses its label */
      button(cx,y,cw,h,c.text(),{danger:dan,on:on,size:6.5,sp:cw<30?0:.5,fn:c.fn});
    }
    TIP(cx,y,cw,h,c.tip.split(" - ")[0],c.tip);
    cx+=cw+gap;
  }
}

function drawPlant(y0,L){
  layoutMetrics(); GY=y0;
  /* layoutMetrics() measured the design with no bands; from here on the view has
     them, and every row position comes from rowTop() rather than Y*CELL */
  BANDS = L? ctlBands() : null;
  const GHp=gridH(), rowH=Y=>rowTop(Y+1)-rowTop(Y);
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

  const Th = L? L.Tavg+15*(L.n*.935+L.decay) : 598;
  const Tc = L? L.Tavg-15*(L.n*.935+L.decay) : 568;
  const PC={ hot: L?lerpC("#5aa9d6","#ff5a45",(Th-520)/110):"#c8735e",
             cold:L?lerpC("#5aa9d6","#ff5a45",(Tc-520)/110):"#5aa9d6",
             surge:"#a98cf0", steam:"#c8d8dc", exh:"#7f9098", feed:"#5aa9d6", hpi:"#5fd2e2" };
  const DASH={hot:"hot",cold:"cold",steam:"stm",feed:"fw",hpi:"hpi",surge:"surge",exh:"exh"};
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
    const {x,y,w,h}=prect(p);
    /* an accumulator you never fitted has no pump to start: it used to draw
       "NOT FITTED" and a working INJECT button in the same box */
    const live = L && fitted(p);
    const ctl = live ? ctlFor(p) : null,
          byk = live ? autoOn(p.id) : null,
          bh  = byk? BYP_H : 0,
          sh  = (ctl? ctl.length*CTL_H : 0) + bh, sy = y+h-sh;
    const wd=push({x,y,w,h,type:"part",part:p});
    const on=sel===p.id, drag=ui.drag&&ui.drag.part===p, fit=fitted(p);
    const dmgd = L && L.dmgParts.includes(p.id);
    const ink = !fit?"#3c4c47" : dmgd?C.red : on?C.amber : (hov(wd)||drag)?C.bright : C.metal;
    if(on){ fillRect(x+1,y+1,w-2,h-2,"rgba(240,168,48,.07)"); ticks(x+2.5,y+2.5,w-5,h-5,C.amber,7); }
    if(!fit){ ctx.setLineDash([3,3]); frame(x+3,y+3,w-6,h-6,"#3c4c47"); ctx.setLineDash([]); }
    else drawSym(p,x,y,w,h-sh,ink,L);
    if(dmgd){ hatch(x+3,y+3,w-6,h-6,C.red,.4); badge(x+w-9,y+12,C.red); }
    else if(!p.access && p.grp!=="shield" && fit) badge(x+w-9,y+12,C.amber);
    /* a one-cell component with a knob has no room for a separate value tag,
       and does not need one - the knob shows its own number */
    const v0 = L&&fit ? liveValue(p,L) : null, v = (ctl&&p.h<2)? null : v0;
    const nm = (v0&&!v)? p.name+"  "+v0 : p.name;
    tag(nm,x+w/2,sy-(v?14:4),6.5,.4,!fit?"#3c4c47":(on?C.amber:C.ink2));
    if(v) tag(v,x+w/2,sy-3,8,0,dmgd?C.red:liveColor(p,L));
    if(!fit) tag("NOT FITTED",x+w/2,y+h/2+2,6,.2,"#3c4c47");
    /* the component tooltip goes down FIRST: findTip() scans backwards and takes
       the first hit, so anything pushed after it wins inside its own rect. Push
       it last and it swallows every control tooltip in the strip. */
    TIP(x,y,w,h,p.name+(fit?"":"  [ NOT FITTED ]")+(dmgd?"  [ DAMAGED ]":"")+
        (p.access||p.grp==="shield"?"":"  [ NO ACCESS ]"),
      p.tip+(p.access||p.grp==="shield"?"":"  It is boxed in on every side - nobody could reach it to repair it."));
    if(ctl) ctl.forEach((row,i)=>ctlStrip(row,x+4,sy+i*CTL_H+1,w-8,CTL_H-3));
    if(byk) bypRow(byk,x+4,y+h-bh+1,w-8,bh-3);
  }
  return GY+GHp;
}
const drawGrid = y0 => drawPlant(y0,null);
