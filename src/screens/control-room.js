"use strict";
/* the live control screen */

/* ─────────────── CONTROL ROOM: same plant, same inspector, live ─────────────── */
function vital(x,y,w,label,value,unit,col,tip,ch){
  const on=ch&&plot.includes(ch);
  let hv=false;
  if(ch){ const wd=push({x,y,w,h:44,type:"btn",fn:()=>togglePlot(ch)}); hv=hov(wd); }
  fillRect(x,y,w,44,C.panel); frame(x,y,w,44,on?CH[ch].col:(hv?C.edge2:C.edge));
  accent(x,y,w,on?CH[ch].col:C.edge2);
  txt(label,x+7,y+16,{size:7,sp:1.1,caps:1,color:C.ink2});
  txt(value,x+7,y+36,{size:15,color:col||C.cyan});
  if(unit) txt(unit,x+w-6,y+36,{size:8,align:"right",color:C.ink2});
  if(tip) TIP(x,y,w,44,label,tip);
}

function ctrlInspector(y0){
  const s=S, p=LAY.parts.find(q=>q.id===sel)||LAY.parts[0];
  const IH=232, X=[22,202,382,562], W2=172;
  const dmgd=s.dmgParts.includes(p.id);
  well(12,y0,736,IH,"COMPONENT READOUTS / "+p.name,dmgd?C.red:C.amber);
  txt("EL"+(GH-1-p.y)+"  ·  "+(dmgd?"DAMAGED":fitted(p)?"in service":"not fitted"),738,y0+15,
      {size:8,sp:1.2,align:"right",color:dmgd?C.red:C.ink2});
  const Y0=y0+34;
  const row=(cx,i,k,v,col)=>{ const yy=Y0+8+i*20;
    txt(k,cx,yy,{size:8,sp:1.1,color:C.ink2});
    txt(v,cx+W2,yy,{size:10,align:"right",color:col||C.cyan});
    fillRect(cx,yy+5,W2,1,"rgba(120,180,190,.07)"); };
  const heat=s.n*.935+s.decay, Th=s.Tavg+15*heat, Tc=s.Tavg-15*heat, sc=tsat(s.P)-Th;
  const id=p.id;

  if(id==="core"){
    row(X[0],0,"POWER",(s.n*100).toFixed(1)+" %",(s.n>1.1||s.dnbr<1.3)?C.red:C.green);
    row(X[0],1,"THERMAL",(s.n*P.rated).toFixed(0)+" MWt");
    row(X[0],2,"FUEL TEMP",s.Tf.toFixed(0)+" K",s.Tf>1500?C.red:C.cyan);
    row(X[0],3,"DNBR",s.dnbr.toFixed(2),s.dnbr<1?C.red:s.dnbr<1.3?C.amber:C.cyan);
    row(X[1],0,"INVENTORY",s.inv.toFixed(1)+" %",s.inv<95?C.red:C.blue);
    row(X[1],1,"VOID",s.vf.toFixed(2),s.vf>.15?C.red:C.cyan);
    row(X[1],2,"FUEL DAMAGE",s.dmg.toFixed(1)+" %",s.dmg>0?C.red:C.cyan);
    row(X[1],3,"VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",s.fatigue>50?C.amber:C.cyan);
    row(X[2],0,"BORON",s.boron.toFixed(0)+" pcm");
    row(X[2],1,"BORON DEMAND",s.boronDem.toFixed(0)+" pcm",
        Math.abs(s.boronDem-s.boron)>20?C.amber:C.ink2);
    row(X[2],2,"EMERG BORON",!P.boroninj?"none":s.borInjUsed?"EXPENDED":"available",
        !P.boroninj?C.ink2:s.borInjUsed?C.red:C.green);
    row(X[2],3,"XENON",s.parts.xe.toFixed(0)+" pcm");
    TIP(X[2],Y0,W2,84,"BORON","Neutron poison dissolved in the coolant. Genuinely slow: the charging pumps borate at "+BOR_IN+" pcm/s and dilute at only "+BOR_OUT+" pcm/s. Demand is what you asked the charging pumps for; boron is what the loop actually has. Drive it from the slider on the reactor itself.");
    rule("CORE FLUX",X[3],Y0+9,W2);
    coreField(X[3],Y0+16,W2,116,coreView(s));
    const fr=(i,k,v,col)=>{ const yy=Y0+146+i*16;
      txt(k,X[3],yy,{size:8,sp:1.1,color:C.ink2});
      txt(v,X[3]+W2,yy,{size:10,align:"right",color:col||C.cyan}); };
    fr(0,"PEAK Fq",s.fq.toFixed(2),s.fq>3.2?C.amber:C.cyan);
    fr(1,"HOT SPOT","R"+s.hotRing+" / EL"+s.hotLev);
    fr(2,"AXIAL / RADIAL",(s.ao*100).toFixed(0)+" / "+(s.ro*100).toFixed(0)+" %",
       Math.abs(s.ao)>.35||Math.abs(s.ro)>.35?C.amber:C.cyan);
    TIP(X[3],Y0,W2,198,"CORE FLUX",
      "The core seen along its axis, mirrored about the centreline. Dot size is local power, colour is how hard that spot is running, a hollow ring is steam, and the violet shadow is xenon eating the neutrons where it has built up. The vertical marks are the rod banks, with the follower drawn below each absorber.");
  }
  else if(id==="rods"){
    row(X[0],0,"BANK POSITION",(s.rodPos*100).toFixed(1)+" %");
    row(X[0],1,"BANK DEMAND",(s.rodDem*100).toFixed(1)+" %",
        Math.abs(s.rodDem-s.rodPos)>.005?C.amber:C.ink2);
    row(X[0],2,"BANK WORTH HERE",coreRodWorth(s).toFixed(0)+" pcm");
    row(X[0],3,"DRIVES",s.rodJam?"JAMMED":"answering",s.rodJam?C.red:C.green);
    TIP(X[0],Y0,W2,84,"CONTROL BANK","Rod insertion. Fast, but it travels at only 1.2%/s, and deep insertion raises power peaking which eats thermal margin. Demand is where you asked for; position is where the drives have got to. The slider is on the rod drives themselves.");
    row(X[1],0,"TRIP LATCH",s.scrammed?"LATCHED":"clear",s.scrammed?C.amber:C.green);
    row(X[1],1,"LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2);
    row(X[1],2,"SCRAM TIME",(1/P.scram).toFixed(1)+" s");
    row(X[1],3,"RESET WOULD",!s.scrammed?"n/a":(P.rps&&tripCause())?"REFUSE":"clear",
        !s.scrammed?C.ink2:(P.rps&&tripCause())?C.red:C.green);
    TIP(X[1],Y0,W2,84,"TRIP STATE","A scram latches. The latch has to be cleared on purpose, and with protection fitted it refuses while a trip condition is still present. SCRAM and RESET are mounted on the rod drives on the diagram.");
    row(X[2],0,"TILT TRIM",(s.tilt>=0?"+":"")+s.tilt.toFixed(2),
        Math.abs(s.tilt)>.05?C.amber:C.ink2);
    row(X[2],1,"TILT DEMAND",(s.tiltDem>=0?"+":"")+s.tiltDem.toFixed(2),
        Math.abs(s.tiltDem-s.tilt)>.01?C.amber:C.ink2);
    row(X[2],2,"RADIAL OFFSET",(s.ro*100).toFixed(0)+" %",Math.abs(s.ro)>.35?C.amber:C.cyan);
    row(X[2],3,"AXIAL OFFSET",(s.ao*100).toFixed(0)+" %",Math.abs(s.ao)>.35?C.amber:C.cyan);
    TIP(X[2],Y0,W2,84,"TILT TRIM","Drives the inner banks against the outer ones, up to "+(XTILTZ*100).toFixed(0)+"% of core height apart, so it is the one handle you have on a radial xenon tilt. Radial offset is what the flux field is actually doing about it. The trim slider is on the rod drives.");
    row(X[3],0,"PERIOD",(()=>{const dn=(s.n-lastN)/0.05; lastN=s.n;
      const pr=Math.abs(dn)<1e-4?Infinity:s.n/dn;
      return (isFinite(pr)&&Math.abs(pr)<999?pr.toFixed(0):"INF")+" s";})());
    row(X[3],1,"NET RHO",s.rho.toFixed(0)+" pcm",Math.abs(s.rho)<50?C.green:C.amber);
    row(X[3],2,"XENON",s.parts.xe.toFixed(0)+" pcm");
    row(X[3],3,"SHUTDOWN MGN",P.sdm.toFixed(0)+" pcm",P.sdm<200?C.red:C.green);
    row(X[3],4,"  W/ FULL BORON",P.sdmB.toFixed(0)+" pcm",P.sdmB<200?C.red:C.green);
  }
  else if(id==="pzr"){
    row(X[0],0,"PRESSURE",s.P.toFixed(2)+" MPa",pColor(s.P));
    row(X[0],1,"LEVEL",s.lvl.toFixed(1)+" %",s.lvl>78?C.amber:C.cyan);
    row(X[0],2,"SUBCOOLING",sc.toFixed(1)+" K",sc<8?C.red:C.cyan);
    row(X[0],3,"SAT TEMP",tsat(s.P).toFixed(0)+" K");
    const open=s.porvOpen&&!s.porvBlocked;
    row(X[1],0,"BLOCK VALVE",s.porvBlocked?"SHUT":"open",s.porvBlocked?C.red:C.green);
    row(X[1],1,"PORV",open?"PASSING":"shut",open?C.red:C.green);
    row(X[1],2,"RELIEF PATH",s.porvBlocked?"ISOLATED":"available",s.porvBlocked?C.red:C.ink2);
    row(X[1],3,"AUTO RELIEF",autoState("porv").toLowerCase(),
        autoLive("porv")?C.green:C.amber);
    TIP(X[1],Y0,W2,84,"RELIEF PATH","Manual backup under the relief valve. Shut the block valve when the PORV fails to reseat - that is the whole answer to a stuck-open valve. Both switches are on the pressurizer on the diagram.");
    row(X[2],0,"LIFT SETPOINT",(P.P0*1.06).toFixed(2)+" MPa");
    row(X[2],1,"MARGIN TO LIFT",(P.P0*1.06-s.P).toFixed(2)+" MPa",
        P.P0*1.06-s.P<0.3?C.amber:C.cyan);
    wrap(s.lvl>78&&sc<12?"Level reads HIGH while subcooling collapses. That combination means the core is voiding and pushing water up the surge line - the loop is emptying, not filling."
        :"Level and subcooling agree. Watch them diverge and you are looking at a leak, not an overfill.",
      X[3],Y0+12,W2,11,{size:8.5,color:s.lvl>78&&sc<12?C.red:C.ink2});
  }
  else if(id.startsWith("sg")){
    row(X[0],0,"SG LEVEL",s.sgl.toFixed(1)+" %");
    row(X[0],1,"STEAM PRESS",(P.P0*.45*Math.pow(Math.max(s.load,.05),.25)).toFixed(2)+" MPa");
    row(X[0],2,"T-HOT IN",Th.toFixed(0)+" K");
    row(X[0],3,"T-COLD OUT",Tc.toFixed(0)+" K");
    row(X[1],0,"TUBE RUPTURE",s.sgtr?"LEAKING":"intact",s.sgtr?C.red:C.green);
    row(X[1],1,"HEAT REMOVED",(Math.min(s.n,s.load)*P.rated).toFixed(0)+" MWt");
    row(X[1],2,"NAT CIRC",(s.nat*100).toFixed(0)+" %",s.nat>.1?C.green:C.ink2);
    wrap("This unit sits "+(cen(p).y<cen(LAY.parts.find(q=>q.id==="core")).y?"above":"BELOW")+
      " the reactor. Buoyancy flow is "+(s.nat*100).toFixed(0)+"% right now, and that is all you get if the pumps stop.",
      X[2],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id.startsWith("pump")){
    row(X[0],0,"FLOW",(s.flow*100).toFixed(1)+" %",
        s.flow<P.flowMin?C.red:C.cyan);
    row(X[0],1,"FLOW DEMAND",(s.flowDem*100).toFixed(1)+" %",
        Math.abs(s.flowDem-s.flow)>.005?C.amber:C.ink2);
    row(X[0],2,"DESIGN FLOOR",(P.flowMin*100).toFixed(0)+" %");
    row(X[0],3,"HOT CHANNEL",(s.hotFlow*100).toFixed(0)+" %",
        s.hotFlow<.8?C.amber:C.cyan);
    TIP(X[0],Y0,W2,84,"COOLANT PUMPS",pumpTip());
    row(X[1],0,"CAVITATION",(s.cav*100).toFixed(0)+" %",s.cav>.15?C.amber:C.cyan);
    row(X[1],1,"NAT CIRC",(s.nat*100).toFixed(0)+" %");
    row(X[1],2,"PUMPS LOST",s.dmgParts.filter(k=>k.startsWith("pump")).length+" / "+P.loops,
      s.dmgParts.some(k=>k.startsWith("pump"))?C.red:C.green);
    row(X[1],3,"BLACKOUT",s.blackout?"YES":"no",s.blackout?C.red:C.green);
    wrap("Pipe friction from your layout already caps demand at "+((P.flowK)*100).toFixed(0)+
      "% of nominal before anything breaks.",X[2],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="turb"){
    row(X[0],0,"LOAD",(s.load*100).toFixed(1)+" %");
    row(X[0],1,"LOAD DEMAND",(s.loadDem*100).toFixed(1)+" %",
        Math.abs(s.loadDem-s.load)>.005?C.amber:C.ink2);
    row(X[0],2,"RUNBACK",autoState("runback").toLowerCase(),
        autoLive("runback")?C.green:C.amber);
    row(X[0],3,"GOVERNOR STROKE",LOAD_TAU.toFixed(0)+" s");
    TIP(X[0],Y0,W2,84,"LOAD DEMAND","Turbine draw - weapons and ship systems in the full game. Raising it cools the loop, and the reactor answers by raising its own power without you touching a rod. The governor valves take about "+LOAD_TAU+" s to stroke, so load trails demand. The slider is on the turbine.");
    row(X[1],0,"ELECTRICAL",(Math.min(s.n,s.load)*P.rated/3).toFixed(0)+" MWe");
    row(X[1],1,"T-AVG VS PROGRAM",(s.Tavg-tProg(s)>=0?"+":"")+
      (s.Tavg-tProg(s)).toFixed(1)+" K");
    row(X[1],2,"STEAM DUMP",(P.bypass*100).toFixed(0)+" %");
    wrap("Ride the moderator feedback instead of fighting it: raise load and power follows on its own.",
      X[2],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="ctrl"){
    row(X[0],0,"INSTRUMENTS",P.noise<.2?"VOTED":P.noise<.6?"2CH DRIFT":"1CH RAW",
      P.noise>.6?C.amber:C.green);
    row(X[0],1,"PARTY DOSE",s.dose.toFixed(1)+" %",s.dose>50?C.red:C.cyan);
    row(X[0],2,"DOSE RATE",P.dose.toFixed(2)+" x",P.dose>1?C.amber:C.green);
    row(X[1],0,"RPS",rpsState().toLowerCase()==="armed"?"armed":rpsState(),
        rpsLive()?C.green:C.amber);
    row(X[1],1,"LAST TRIP",s.trip||"none",s.trip?C.amber:C.ink2);
    row(X[1],2,"EVENTS",LOG.length+"");
    wrap("Crew dose is set by how far you put this room from the reactor and how much shielding sits between them - both decided on the design bench.",
      X[2],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="hpi"){
    row(X[0],0,"INJECTION",s.hpi?"RUNNING":"stopped",s.hpi?C.cyan:C.ink2);
    row(X[0],1,"ACCUMULATOR",fitted(p)?"fitted":"none",fitted(p)?C.green:C.ink2);
    row(X[0],2,"HEAD OVER CORE",(P.lay.hpiHead).toFixed(2)+" x");
    TIP(X[0],Y0,W2,64,"HIGH PRESSURE INJECTION","Emergency cold water into the loop. Refills a leak, and the cold shock ages the vessel every second it runs. The switch is on the tank on the diagram.");
    row(X[1],0,"RATE",P.hpiRate.toFixed(2)+" %/s");
    row(X[1],1,"INVENTORY",s.inv.toFixed(1)+" %",s.inv<95?C.red:C.blue);
    row(X[1],2,"VESSEL FATIGUE",s.fatigue.toFixed(1)+" %",s.fatigue>50?C.amber:C.cyan);
    wrap("Injection is gravity assisted: this tank's height above the core is why the rate is "+
      P.hpiRate.toFixed(2)+" %/s and not something else.",X[2],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="cont"){
    row(X[0],0,"RELEASE",s.release.toFixed(2)+" %",s.release>1?C.red:C.cyan);
    row(X[0],1,"HELD BY CONTAINMENT",((1-P.contRel)*100).toFixed(0)+" %");
    row(X[0],2,"CORE CATCHER",P.catcher?"fitted":"none",P.catcher?C.green:C.ink2);
    row(X[0],3,"VESSEL",s.breach?"RUPTURED":"intact",s.breach?C.red:C.green);
    wrap("Containment does nothing for the reactor and everything for the people around it.",
      X[1],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="bkp"){
    row(X[0],0,"BLACKOUT",s.blackout?"ACTIVE":"no",s.blackout?C.red:C.green);
    row(X[0],1,"BACKUP CAPACITY",(P.backup*100).toFixed(0)+" % of pump flow");
    row(X[0],2,"SUPPLY",s.bkpLost?"DESTROYED":"available",s.bkpLost?C.red:C.green);
    row(X[0],3,"NAT CIRC",(s.nat*100).toFixed(0)+" %");
    wrap("With no backup and no chimney, a blackout leaves the core with nothing but buoyancy.",
      X[1],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="feed"){
    row(X[0],0,"SG LEVEL",s.sgl.toFixed(1)+" %",s.sgl<25?C.red:C.cyan);
    row(X[0],1,"EMERG FEED",autoState("efw").toLowerCase(),
        autoLive("efw")?C.green:C.amber);
    row(X[0],2,"FEED PUMP",s.dmgParts.includes("feed")?"DESTROYED":"running",
        s.dmgParts.includes("feed")?C.red:C.green);
    wrap("Emergency feedwater is the only thing that keeps a sink under decay heat after a trip. Its bypass switch is on this pump on the diagram.",
      X[1],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="cond"){
    row(X[0],0,"T-HOT",Th.toFixed(0)+" K");
    row(X[0],1,"HEAT REJECTED",(Math.min(s.n,s.load)*P.rated*.66).toFixed(0)+" MWt");
    row(X[0],2,"CONDENSER",s.dmgParts.includes("cond")?"DESTROYED":"in service",
        s.dmgParts.includes("cond")?C.red:C.green);
    wrap(p.tip,X[1],Y0+12,W2*2+8,11,{size:8.5,color:C.ink2});
  }
  else {
    wrap(p.tip,X[0],Y0+14,W2*2+8,12,{size:9,color:C.ink});
    txt("NO LIVE READOUTS",X[0],Y0+80,{size:8,sp:1.6,color:C.ink2});
  }
  return y0+IH;
}

function drawMimic(){
  const s=S, heat=s.n*.935+s.decay, Th=s.Tavg+15*heat, sc=tsat(s.P)-Th;
  rule("PLANT",12,58,736,C.amber);
  txt("as built / every control is on the plant itself - click a component for its readouts",12,73,{size:8.5,color:C.ink2});
  let y=drawPlant(84,s)+12;

  const V=[["REACTOR POWER",(s.n*100).toFixed(1),"%",
      (s.n>1.1||s.dnbr<1.3)?C.red:C.green,"Heat the core is making as a share of rated output.","pwr"],
    ["DNBR",s.dnbr.toFixed(2),"",s.dnbr<1?C.red:s.dnbr<1.3?C.amber:C.cyan,
      "Departure from Nucleate Boiling Ratio. Nucleate boiling is bubbles forming and collapsing on the fuel pins, which cools them very well. Departure is those bubbles joining into one continuous steam film, which does not. The number is how far you are from that: above 1.30 safe, 1.00 is failure. This, not the rating, limits how hard you can push.","dnbr"],
    ["PRESSURE",s.P.toFixed(2),"MPa",pColor(s.P),
      "Primary loop pressure. Raises the boiling point, so it directly buys thermal margin.","prs"],
    ["SUBCOOLING",sc.toFixed(1),"K",sc<8?C.red:C.cyan,
      "Degrees below boiling in the hot leg. The honest leak indicator - it collapses before anything else admits the loop is voiding.","sub"],
    ["INVENTORY",s.inv.toFixed(1),"%",s.inv<95?C.red:C.blue,
      "How much water is actually in the loop. A real plant has no such gauge.","inv"],
    ["XENON",s.parts.xe.toFixed(0),"pcm",-s.parts.xe>3200?C.blue:C.cyan,
      "Xenon-135 poison. Slow, remembers your power history, and can lock you out of restarting.","xe"]];
  V.forEach((v,i)=>vital(12+i*124,y,116,v[0],v[1],v[2],v[3],v[4],v[5]));
  y+=56;
  if(s.melt||s.breach){
    const bl=performance.now()%1000<500;
    fillRect(12,y,736,30,bl?"#3a0d08":"#1a0605"); frame(12,y,736,30,C.red);
    txt(s.melt?"CORE MELT — UNRECOVERABLE":"VESSEL RUPTURE — UNRECOVERABLE",380,y+20,
      {size:12,weight:700,sp:3,align:"center",color:C.red});
    y+=42;
  } else if(s.trip){
    fillRect(12,y,736,22,"#1a1206"); frame(12,y,736,22,C.amber);
    txt("LAST TRIP / "+s.trip,380,y+15,{size:9,weight:700,sp:1.6,align:"center",color:C.amber});
    y+=34;
  }
  return ctrlInspector(y)+12;
}

function drawAnnunciator(y0){
  const colw=742/6, tw_=Math.round(colw)-6;
  rule("ANNUNCIATOR",12,y0+8,736);
  ANN.forEach((a,i)=>{
    const x=Math.round(12+(i%6)*colw), y=y0+14+Math.floor(i/6)*40, on=a[2](S);
    const col=a[1]==="red"?C.red:a[1]==="amber"?C.amber:C.blue;
    const blink=on&&a[1]==="red"&&(performance.now()%900<450);
    const lit=on&&!blink;
    fillRect(x,y,tw_,34, lit?col:C.panel); frame(x,y,tw_,34, lit?col:C.edge);
    txt(pad(i+1,2),x+5,y+11,{size:6.5,color:lit?"#2a0a06":"#2c3f45"});
    txt(a[0],x+tw_/2,y+23,{size:8,weight:700,sp:1.1,align:"center",
        color:lit?"#120404":"#33484e"});
    TIP(x,y,tw_,34,a[0]+(on?"  [ LIT ]":"  [ clear ]"),a[3]);
  });
  return y0+14+Math.ceil(ANN.length/6)*40-6+12;
}
function drawLedger(y0){
  const s=S;
  const LH=194;
  well(12,y0,364,LH,"REACTIVITY LEDGER / TRAINING AID",C.amber);
  TIP(12,y0,364,18,"REACTIVITY LEDGER",
    "Reactivity is the reactor's tendency to speed up or slow down, measured in pcm. Bars pointing left are pushing the reactor down, right is pushing it up. When Net Rho sits at zero, power is steady. Real operators never get this view.");
  const rows=[["RODS","rod","Negative reactivity from the inserted control rods. The deeper they go the stronger this gets, but not evenly: the rods bite hardest around mid-travel."],
              ["DOPPLER","dop","Feedback from hot fuel. As fuel heats it absorbs more neutrons, pushing power back down. Instant, automatic, and always stabilising. This is what stops a runaway before a human could react."],
              ["MODERATOR","mod","Feedback from coolant temperature. Hotter coolant is less dense and moderates neutrons less, so power drops. This is why the reactor follows turbine load on its own."],
              ["XENON","xe","Xenon-135, a neutron poison that builds up after fission. It has memory: what you did minutes ago is still eating your reactivity now. Scram, and this bar grows until the reactor cannot restart."],
              ["BORON","bor","Whatever you dialled in on the boron bench. Slow to change, but it is your only lever when rods and temperature have run out."],
              ["VOID","vd","Steam bubbles in the core. In a water design this is strongly negative and shuts the reactor down as it uncovers. In a graphite or sodium design it is POSITIVE, and voiding adds power instead."],
              ["ROD TIP","tip","Whatever hangs below the absorber. With a water follower this stays at zero all the way in. With a graphite one it goes POSITIVE as the bank drops, because graphite displaces water at the bottom of the core and the absorber has not reached there yet - the reactivity you add before the reactivity you remove."],
              ["NET RHO","net","The sum of everything above. Zero means steady power. Positive means power is climbing, negative means it is falling. If this exceeds your fuel's beta the reactor goes prompt critical and nothing can stop it in time."]];
  rows.forEach((r,i)=>{
    const y=y0+34+i*18, v=r[1]==="net"?s.rho:s.parts[r[1]];
    txt(r[0],22,y+9,{size:8,sp:1.1,color:r[1]==="net"?C.bright:C.ink2});
    const col=r[1]==="net"?(Math.abs(v)<50?C.green:(v<0?C.blue:C.red)):(v<0?C.blue:C.amber);
    segSigned(88,y+1,200,10,clamp(v/2600,-1,1),col);
    txt(pad((v>=0?"+":"")+v.toFixed(0),6),366,y+10,{size:10,align:"right",color:C.bright});
    const lch={xe:"xe",vd:"vd",net:"rho"}[r[1]];
    if(lch) push({x:18,y,w:352,h:14,type:"btn",fn:()=>togglePlot(lch)});
    if(lch&&plot.includes(lch)) chip(13,y+2,CH[lch].col);
    TIP(18,y,352,14,r[0],r[2]+(lch?"  Click to plot it on the trend chart.":""));
  });
  well(384,y0,364,LH,"SECONDARY INDICATIONS");
  const dn=(s.n-lastN)/0.05; lastN=s.n;
  const per=Math.abs(dn)<1e-4?Infinity:s.n/dn, dev=s.Tavg-tProg(s);
  const rows2=[
    ["PERIOD",(isFinite(per)&&Math.abs(per)<999?per.toFixed(0):"INF")+" s",null,
     "How many seconds it takes power to multiply by 2.7x at the current rate. Infinity means steady. A short positive period means power is running away from you; under about 10 seconds you are in trouble."],
    ["TAVG VS PROGRAM",(dev>=0?"+":"")+dev.toFixed(1)+" K",null,
     "How far average coolant temperature is from the target for the current load. Non-zero means the reactor and turbine are out of balance and something is drifting."],
    ["XENON WORTH",s.parts.xe.toFixed(0)+" pcm","xe",
     "Current xenon poison in pcm. At equilibrium it sits near -2700. After a shutdown it deepens toward -4800 over about eighty seconds, and that is the window where you cannot restart."],
    ["FUEL DAMAGE",s.dmg.toFixed(1)+" %","dmg",
     "Percentage of fuel cladding that has failed. Permanent. It accumulates whenever DNBR drops below 1.00 or fuel temperature exceeds 1500 K."],
    ["VESSEL FATIGUE",s.fatigue.toFixed(1)+" %","fat",
     "Permanent metal damage from thermal shock, mostly caused by emergency injection dumping cold water into a hot vessel. The safe action has a long-term bill, and it never resets."],
    ["NAT CIRCULATION",(s.nat*100).toFixed(0)+" %",null,
     "Flow the core is generating by buoyancy alone right now. It only develops once the loop is hot, and it is all you have if the pumps stop."],
    ["RADIOLOGICAL RELEASE",s.release.toFixed(2)+" %",null,
     "Fraction of the core inventory that has escaped containment and reached the crew. Driven by fuel damage and cut down by whatever containment you paid for."],
    ["INSTRUMENTATION",P.noise<.2?"VOTED / CLEAN":P.noise<.6?"2CH / DRIFTING":"1CH / UNVERIFIED",null,
     "How many sensors watch each parameter, set at the design bench. With one channel your readings jitter and a failed sensor is undetectable. Three channels vote a liar out and the numbers hold still."],
  ];
  rows2.forEach((r,i)=>{
    const y=y0+42+i*16, ch=r[2], on=ch&&plot.includes(ch);
    if(ch) push({x:384,y:y-11,w:364,h:17,type:"btn",fn:()=>togglePlot(ch)});
    txt(r[0],394,y,{size:8.5,sp:1.1,color:on?CH[ch].col:C.ink2});
    txt(r[1],738,y,{size:10,align:"right",color:on?CH[ch].col:C.cyan});
    fillRect(394,y+5,344,1,"rgba(120,180,190,.07)");
    TIP(384,y-11,364,17,r[0],r[3]+(ch?"  Click to plot it on the trend chart.":""));
  });
  return y0+LH+12;
}
function drawTrend(yy){
  const x=12,y=yy,w=736,h=176;
  well(x,y,w,h,"TREND / CLICK ANY GAUGE, BENCH OR READOUT TO PLOT IT",C.amber);
  const px=22,py=y+24,pw=716,ph=112;
  fillRect(px,py,pw,ph,C.well); frame(px,py,pw,ph,C.edge);
  for(let g=1;g<4;g++) fillRect(px,py+ph*g/4,pw,1,"rgba(120,180,190,.06)");
  for(let g=1;g<6;g++) fillRect(px+pw*g/6,py,1,ph,"rgba(120,180,190,.05)");

  if(!plot.length||hlen<2){
    txt(hlen<2?"COLLECTING DATA":"NO CHANNELS SELECTED",px+pw/2,py+ph/2+4,
        {size:10,sp:2,align:"center",color:C.ink2});
  } else {
    const stepN=Math.max(1,Math.ceil(hlen/pw));
    plot.forEach(k=>{
      let lo=Infinity,hiV=-Infinity;
      for(let i=0;i<hlen;i+=stepN){ const v=chAt(k,i); if(v<lo)lo=v; if(v>hiV)hiV=v; }
      let span=hiV-lo; if(span<1e-6){ span=Math.max(Math.abs(hiV)*.2,1); lo-=span/2; }
      else { lo-=span*.08; span*=1.16; }
      CH[k]._lo=lo; CH[k]._hi=lo+span;
      ctx.beginPath(); ctx.strokeStyle=CH[k].col; ctx.lineWidth=1.6;
      let first=true;
      for(let i=0;i<hlen;i+=stepN){
        const X=px+(i/(hlen-1))*pw, Y=py+ph-((chAt(k,i)-lo)/span)*ph;
        first?(ctx.moveTo(X,Y),first=false):ctx.lineTo(X,Y);
      }
      ctx.stroke();
    });
  }
  txt("-"+(hlen/10).toFixed(0)+"s",px+3,py+ph-4,{size:7,color:C.ink2});
  txt("NOW",px+pw-3,py+ph-4,{size:7,align:"right",color:C.ink2});

  plot.forEach((k,i)=>{
    const lx=22+i*179, c=CH[k];
    fillRect(lx,y+145,7,7,c.col);
    txt(c.lab,lx+12,y+152,{size:7.5,sp:.9,color:C.ink});
    const cur=hlen?chAt(k,hlen-1):0;
    txt(cur.toFixed(Math.abs(cur)>=100?0:2)+" "+c.u,lx+12,y+166,{size:10,color:c.col});
    if(c._lo!==undefined)
      txt(c._lo.toFixed(0)+" .. "+c._hi.toFixed(0),lx+172,y+166,{size:7.5,align:"right",color:C.ink2});
  });
  if(!plot.length) txt("click a gauge to add a channel  /  four maximum",22,y+160,
      {size:8.5,sp:.8,color:C.ink2});
  TIP(x,y,w,20,"TREND CHART",
    "Rolling three-minute history of any value on the panel. Click any gauge, control bench or readout to add it; click again to remove. Up to four at once, each auto-scaled to its own range shown in the legend.");
  return y+h+12;
}

function drawLog(yy){
  const x=12,y=yy,w=736;
  const shown=LOG.slice(-4).reverse(), body={size:9,color:C.ink2};
  /* the panel is as tall as the entries it holds - four long ones used to spill out */
  let need=0;
  for(const e of shown) need += 13 + wrapCount(e.why,700,body)*12 + 9;
  const h = LOG.length ? 36+need-9+12 : 56;
  well(x,y,w,h,"EVENT LOG / WHAT WENT WRONG AND WHY",C.amber);
  txt(LOG.length+" EVENTS",738,y+15,{size:8,sp:1.2,align:"right",color:C.ink2});
  if(!LOG.length){
    txt("NO EVENTS - PLANT NOMINAL",x+w/2,y+42,{size:10,sp:2,align:"center",color:C.ink2});
  } else {
    let ly=y+36;
    for(const e of shown){
      const col = e.sev==="alarm"?C.red : e.sev==="warn"?C.amber : C.ink2;
      const tag = e.sev==="alarm"?"[ALARM]" : e.sev==="warn"?"[WARN ]" : "[INFO ]";
      chip(22,ly-8,col);
      txt("T+"+pad(e.t.toFixed(1),7),30,ly,{size:9,color:C.ink2});
      txt(tag,96,ly,{size:9,color:col});
      txt(e.msg,152,ly,{size:9.5,weight:700,sp:.7,color:col});
      ly=wrap(e.why,30,ly+13,700,12,{size:9,color:C.ink2})+9;
    }
  }
  TIP(x,y,w,20,"EVENT LOG",
    "Everything that has gone wrong this run, newest first, each with the reason it happened and what it means. Cleared by Reset Plant.");
  return y+h+12;
}

function combatHit(){
  const parts=LAY.parts.filter(q=>q.grp!=="shield"&&fitted(q)&&!S.dmgParts.includes(q.id));
  if(!parts.length) return;
  const wgt=parts.map(q=>{ let e=0;
    for(let X=q.x;X<q.x+q.w;X++) for(let Y=q.y;Y<q.y+q.h;Y++)
      if(X===0||X===GW-1||Y===0||Y===GH-1) e++;
    return 0.15 + e*1.6; });
  let r=Math.random()*wgt.reduce((a,b)=>a+b,0), k=0;
  while(r>wgt[k] && k<wgt.length-1){ r-=wgt[k]; k++; }
  const p=parts[k];
  S.dmgParts.push(p.id);
  const eff = p.id.startsWith("pump")
    ? ["COOLANT PUMP HIT","That pump is dead. Loop flow drops by its share and thermal margin goes with it."]
    : p.id.startsWith("sg")
    ? ["STEAM GENERATOR TUBE RUPTURE","Primary coolant is leaking into the secondary side and venting past containment. Inventory falls and activity escapes."]
    : ({core:["REACTOR VESSEL HIT","A penetration in the vessel wall. Coolant is leaking and the metal is permanently damaged."],
        rods:["ROD DRIVE HIT","The drive mechanisms are wrecked. The bank is stuck where it stands and a scram will not move it. Boron is the only shutdown you have left."],
        pzr :["PRESSURIZER HIT","The relief valve has been knocked open and will not reseat. Close the block valve on the mimic."],
        turb:["TURBINE HIT","Load rejected. The turbine is offline, so the reactor has nowhere to send its heat."],
        cond:["CONDENSER HIT","Heat rejection lost. Steam has nowhere to condense."],
        feed:["FEED PUMP HIT","Feedwater down to a quarter. The steam generator will boil dry if this is not fixed."],
        ctrl:["INSTRUMENT CABINET HIT","Sensor channels lost. Every reading on the panel is now far less trustworthy."],
        bkp :["BACKUP POWER HIT","Your emergency supply is gone. A blackout now means natural circulation only."],
        hpi :["HPI TANK HIT","Emergency injection is unavailable. You cannot refill a leaking loop."]}[p.id]
       || ["EQUIPMENT HIT","A component has been knocked out."]);
  if(p.id==="core"){ S.inv-=6; S.fatigue=Math.min(100,S.fatigue+12); }
  if(p.id==="rods") S.rodJam=true;
  if(p.id==="pzr"){ S.porvOpen=true; S.porvStuck=true; S.porvAuto=true; }
  if(p.id==="turb"||p.id==="cond") S.load=S.loadDem=0.05;   // a stop valve slams, it does not stroke
  if(p.id==="ctrl") S.noiseMul=3.5;
  if(p.id==="bkp") S.bkpLost=true;
  if(p.id.startsWith("sg")) S.sgtr=true;
  logE("alarm","COMBAT DAMAGE / "+eff[0], eff[1]+
    (p.access?"  A repair party can reach it.":"  IT IS WALLED IN - no repair is possible with this layout."));
}

function drawDamage(yy){
  const x=12,y=yy,w=736,h=S.dmgParts.length?110:56;
  well(x,y,w,h,"DAMAGE CONTROL",S.dmgParts.length?C.red:C.amber);
  txt("PARTY DOSE "+S.dose.toFixed(1)+" %",738,y+15,
      {size:8,sp:1.2,align:"right",color:S.dose>50?C.red:C.ink2});
  if(!S.dmgParts.length){
    txt("ALL EQUIPMENT IN SERVICE",x+w/2,y+42,{size:10,sp:2,align:"center",color:C.ink2});
  } else {
    let bx=22;
    for(const k of S.dmgParts){
      const part=LAY.parts.find(q=>q.id===k); if(!part) continue;
      const busy=S.repair&&S.repair.id===k, blocked=!part.access, bw=172;
      const need=14+part.w*part.h*4;
      const wd=push({x:bx,y:y+30,w:bw,h:56,type:"btn",fn:()=>{
        if(blocked||S.repair) return;
        S.repair={id:k,t:0,need};
        logE("info","REPAIR PARTY DISPATCHED / "+part.name,
          "Estimated "+need+" seconds. The party takes dose the whole time, at the rate your layout allows.");
      }});
      fillRect(bx,y+30,bw,56, busy?"#2a1f08":(blocked?"#1a0d0b":(hov(wd)?C.panelHi:C.panel)));
      frame(bx,y+30,bw,56, busy?C.amber:(blocked?C.red:C.edge2));
      accent(bx,y+30,bw,part.col);
      txt(part.name,bx+11,y+48,{size:8.5,sp:.5,color:C.bright});
      if(blocked) txt("NO ACCESS / UNREPAIRABLE",bx+11,y+64,{size:7.5,sp:.8,color:C.red});
      else if(busy){ txt("REPAIR IN PROGRESS",bx+11,y+64,{size:7.5,sp:.8,color:C.amber});
        seg(bx+11,y+70,bw-22,8,S.repair.t/S.repair.need,C.amber,18); }
      else txt("CLICK TO DISPATCH PARTY",bx+11,y+64,{size:7.5,sp:.8,color:C.ink2});
      TIP(bx,y+30,bw,56,part.name+(blocked?"  [ UNREACHABLE ]":""),
        blocked?"Your layout walls this component in on every side, so no repair party can reach it. It stays broken for the rest of the run."
        :"Click to send a repair party. Roughly "+need+" seconds, and the party accumulates dose throughout, scaled by how close your control space sits to the reactor.");
      bx+=bw+8; if(bx>x+w-172) break;
    }
  }
  TIP(x,y,w,20,"DAMAGE CONTROL",
    "Equipment knocked out by combat damage. What gets hit is decided by where you put it: hull cells are roughly ten times likelier to be struck, and anything with no free adjacent cell can never be repaired.");
  return y+h+12;
}

/* the stacked panels, as one block that can live in either column */
function drawPanels(y){
  y=drawAnnunciator(y); y=drawDamage(y); y=drawTrend(y);
  y=drawLog(y); y=drawLedger(y); return drawFaults(y);
}
function drawFaults(y0){
  const y=y0+16;
  rule("FAULT INJECTION / TEST HARNESS",12,y0+8,736);
  TIP(12,y0,736,14,"FAULT INJECTION",
    "Developer buttons for triggering emergencies on demand. In the real game these would be caused by combat damage, not by you.");
  button(12,y,178,26,"STUCK PORV",{fn:()=>{S.porvOpen=true;S.porvBlocked=false;}});
  TIP(12,y,178,26,"STUCK PORV",
    "The relief valve lifts and fails to reseat, quietly draining the loop. Watch pressure fall while pressurizer level RISES, which is the trap that wrecked Three Mile Island. Close the block valve on the diagram, then start HPI.");
  button(198,y,178,26,"ROD BANK JAM",{on:S.rodJam,fn:()=>S.rodJam=!S.rodJam});
  TIP(198,y,178,26,"ROD BANK JAM",
    "The control rods stop answering commands, including a scram. You are left steering the reactor with boron, coolant flow and turbine load only.");
  button(384,y,178,26,"LOAD STEP 125%",{fn:()=>S.loadDem=1.25});
  TIP(384,y,178,26,"LOAD STEP 125%",
    "Slams turbine demand to 125% instantly, like a full weapons volley. The primary loop cools, the reactor raises its own power to follow, and thermal margin gets squeezed.");
  button(570,y,178,26,"RESET PLANT",{fn:resetPlant});

  button(384,y+34,178,26,"COMBAT HIT",{fn:combatHit});
  TIP(384,y+34,178,26,"COMBAT HIT",
    "Takes a hit somewhere in the engineering space. What it destroys is decided by your layout: components sitting in hull cells are roughly ten times more likely to be struck.");
  button(12,y+34,178,26,"STATION BLACKOUT",{on:S.blackout,fn:()=>S.blackout=!S.blackout});
  TIP(12,y+34,178,26,"STATION BLACKOUT",
    "Cuts main power to the coolant pumps. Flow collapses to whatever your backup power and natural circulation can provide - both chosen at the design bench. This is the test that tells you whether the chimney was worth its mass.");
  if(P.boroninj){
    const used=S.borInjUsed;
    button(198,y+34,178,26,used?"BORON EXPENDED":"EMERGENCY BORON",
      {danger:!used,fn:()=>{ if(!S.borInjUsed){ S.borInjUsed=true; S.boron-=4000; S.boronDem-=4000;
        logE("alarm","EMERGENCY BORON INJECTED",
          "4000 pcm of poison dumped into the loop. The reactor is shut down hard and cannot be restarted this run."); } }});
    TIP(198,y+34,178,26,"EMERGENCY BORON INJECTION",
      "One-shot poison dump worth 4000 pcm. Shuts the reactor down when the rods will not, and it cannot be undone for the rest of the run.");
  }
  TIP(570,y,178,26,"RESET PLANT",
    "Returns the reactor to steady 100% power with all faults cleared and damage counters zeroed. Keeps your current design.");
  return y0+88;
}
