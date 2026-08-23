"use strict";
/* the 232px inspector shared by both screens */

/* the inspector shows only the parameters belonging to the selected component */
function inspector(y0){
  const p=LAY.parts.find(q=>q.id===sel)||LAY.parts[0], d=derived();
  const IH=232, X=[22,202,382,562], CW2=172;
  well(12,y0,736,IH,"COMPONENT / "+p.name, C.amber);
  txt("EL"+(GH-1-p.y)+"  ·  "+(p.access?"reachable":"NO ACCESS"),738,y0+15,
      {size:8,sp:1.2,align:"right",color:p.access?C.ink2:C.red});
  let c=[y0+34,y0+34,y0+34,y0+34];
  const id=p.id;

  if(id==="core"){
    /* The lattice is the design now, so it gets the first column and the four
       sliders that used to sit here are gone: rated power, lattice pitch, core
       H/D and burnable poison are all MEASUREMENTS of it, printed in column 3.
       You still buy the coolant, the fuel and the reflector MATERIAL - the
       drawing decides how much of the last one there is. */
    c[0]=latPlan(X[0],c[0],CW2);
    c[1]=latTools(X[1],c[1],CW2,LATPEN_CORE)+6;
    c[1]=latDimRack(X[1],c[1],CW2);
    c[2]=optList(X[2],c[2],CW2,"REACTOR TYPE",ARCH,"arch",
      "The coolant and moderator family. Sets power density, operating pressure, grace time and the sign of the void coefficient. It also decides how much heat a given lattice makes: the same assemblies rate differently in a different family.");
    c[3]=optList(X[3],c[3],CW2,"FUEL",FUEL,"fuel",
      "Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density.");
    latMeasuredBar(22,y0+IH-26,712);
  }
  else if(id==="rods"){
    /* the same plan, with the cluster pen in your hand - where a bank goes is
       decided looking down at the core, not on a list */
    c[0]=latPlan(X[0],c[0],CW2);
    c[1]=latTools(X[1],c[1],CW2,LATPEN_RODS)+6;
    c[1]=optList(X[1],c[1],CW2,"SCRAM SYSTEM",SCRAM,"scram","How the rods are driven in during an emergency shutdown.");
    c[2]=optList(X[2],c[2],CW2,"ABSORBER",ABSORB,"__abs",
      "What the clusters are made of. This used to be solved for, until a fully-inserted bank came to whatever CONTROL BANK WORTH was set to. Now you buy a material, put the clusters where you want them, and the worth is what the solve measures.")+8;
    c[2]=toggleF(X[2],c[2],CW2,"EMERG BORON INJECTION","boroninj",18,
      "A one-shot tank of concentrated poison worth 4000 pcm. Shuts the reactor down when the rods will not, and cannot be undone.")+8;
    c[2]=toggleF(X[2],c[2],CW2,"AUTOMATIC ROD CONTROL","autorod",26,
      "A controller that holds coolant temperature on program so the plant follows load by itself. Limited to 15% of rod travel; you can always override it.");
    c[3]=optList(X[3],c[3],CW2,"ROD FOLLOWER",FOLL,"foll",
      "What occupies the channel below the absorber. It decides whether inserting the bank is monotonic: a graphite follower displaces water at the bottom of the core and adds reactivity there before any absorber arrives.")+8;
    seg(X[3],c[3],CW2,9,clamp(d.sdm/2000,0,1),d.sdm<200?C.red:C.green,18);
    wrap(d.sdm<200?"Not enough. After a trip this core creeps back to power on its own."
                  :"Enough to hold the core down after a trip, cold and xenon-free.",
      X[3],c[3]+22,CW2,11,{size:8.5,color:C.ink2});
    /* worth, bank count and margin are readouts now - every one of them a
       consequence of where the clusters went, and none of them dialled */
    latMeasuredBar(22,y0+IH-26,712,LATREAD_RODS);
  }
  else if(id==="pzr"){
    c[0]=sliderF(X[0],c[0],CW2,"DESIGN PRESSURE","pdes",.7,1.25,v=>(v*ARCH[D.arch].P0).toFixed(1)+" MPa",
      "Loop pressure as a multiple of this coolant's nominal. Higher raises the boiling point, so it buys thermal margin and resists voiding, but the vessel gets much heavier and a breach more violent.",.05,v=>(v-0.7)*220);
    c[1]=sliderF(X[1],c[1],CW2,"PRESSURIZER VOLUME","pzr",.5,2,v=>v.toFixed(2)+" x",
      "Size of the steam bubble. A big pressurizer damps pressure swings so the relief valve rarely lifts. A small one is light but pressure whips around on every load change.",.05,v=>(v-0.5)*45);
    wrap("Pressure is what keeps the rest of the loop liquid. Every design choice here trades vessel mass against how much boiling margin you carry.",
      X[2],c[2]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id.startsWith("sg")){
    c[0]=segSel(X[0],c[0],CW2,"COOLANT LOOPS",["1","2","3","4"],"loops",
      "Parallel primary loops. More loops means losing one costs a smaller share of your flow, and each pipe is smaller so a break is less severe.",1);
    c[1]=optList(X[1],c[1],CW2,"GENERATOR TYPE",SGT,"sg",
      "U-tube units hold a lot of secondary water that keeps removing heat for minutes after feedwater is lost. Once-through units are light, respond instantly, and boil dry just as fast.");
    c[2]=toggleF(X[2],c[2],CW2,"EMERGENCY FEEDWATER","efw",38,
      "An independent feed supply that keeps the generator removing heat after the main feed pumps are lost. Extends grace time considerably after a trip.");
    wrap("Height matters more than anything else on this component. Sitting above the reactor, it drives natural circulation with no pumps at all.",
      X[3],c[3]+10,CW2,11,{size:8.5,color:C.ink2});
  }
  else if(id.startsWith("pump")){
    c[0]=optList(X[0],c[0],CW2,"PUMP REDUNDANCY",PUMPS,"pumps",
      "Spare coolant pumps. Sets the minimum flow the plant still delivers after damage, and flow is thermal margin.");
    wrap("Flow is the single biggest input to thermal margin. It is also the first thing you lose in a blackout, which is why the chimney height you gave the core matters so much.",
      X[1],c[1]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="turb"){
    c[0]=sliderF(X[0],c[0],CW2,"TURBINE SIZE","turb",0,1,
      v=>(ARCH[D.arch].eff*(0.92+0.16*v)*100).toFixed(1)+" % gross",
      "How many stages the machine has. A big turbine turns more of the heat into electricity and can swallow a bigger overload, but it is heavy. The percentage is what this reactor's steam conditions plus this machine actually deliver together, so changing the reactor makes the same slider read differently.",.05,v=>v*50);
    c[1]=readF(X[1],c[1],CW2,"RATED OUTPUT",(D.power*d.eff).toFixed(0)+" MWe",
      "Electrical power at 100% reactor power with the condenser keeping up. This is the number the ship gets, and it is the whole reason the reactor is here.");
    c[1]=readF(X[1],c[1],CW2,"MAX LOAD",(d.loadMax*100).toFixed(0)+" %",
      "The furthest the load slider will go in the control room. Overpower is not free reach: it is turbine you paid mass for.");
    wrap("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat.",
      X[2],c[2]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="cond"){
    c[0]=sliderF(X[0],c[0],CW2,"CONDENSER SIZE","condCap",0,1,v=>(20+60*v).toFixed(0)+" % dump",
      "The heat sink, and it sets two things at once. It caps how much steam can be dumped straight past a tripped turbine, so a generous unit absorbs a scram without the relief valve ever lifting. It also sets how much steam you can condense at full draw: overload a small condenser and backpressure eats your electrical output while the reactor goes on making the heat.",.05,v=>v*40);
    c[1]=readF(X[1],c[1],CW2,"CONDENSING CAPACITY",(d.condCap*100).toFixed(0)+" % of rated",
      "How much steam this unit turns back into water. Draw more than this and exhaust pressure climbs, which costs the turbine work. Match it to the turbine's max load or accept the loss.");
    c[1]=readF(X[1],c[1],CW2,"TURBINE CAN DRAW",(d.loadMax*100).toFixed(0)+" %",
      "The turbine's own ceiling, shown here so the mismatch is visible from either component.");
    wrap(d.condShort
      ?"This condenser is far smaller than the turbine can overload to. Sustained overpower will hand a large part of itself straight back as backpressure."
      :"Condenser is matched to the turbine. A brief overload costs little or nothing.",
      X[2],c[2]+10,CW2*2+8,11,{size:8.5,color:d.condShort?C.amber:C.ink2});
  }
  else if(id==="ctrl"){
    c[0]=optList(X[0],c[0],CW2,"INSTRUMENT CHANNELS",CHAN,"chan",
      "How many independent sensors watch each parameter. This decides whether you can tell a broken gauge from a real emergency.");
    c[1]=toggleF(X[1],c[1],CW2,"REACTOR PROTECTION SYSTEM","rps",55,
      "The automatic trips. Fitted, it scrams the core on high flux, low DNBR, high or low pressure, high fuel temperature, low flow, core void or low subcooling. Leave it off and none of that happens: the reactor will run itself to destruction and wait for you to notice.");
    if(D.rps)
      c[1]=sliderF(X[1],c[1],CW2,"RPS TRIP MARGIN","rpsm",0,1,v=>(v*100).toFixed(0)+" % permissive",
        "How much overhead the automatic protection allows before it scrams. Conservative trips at 110% flux and 1.18 DNBR, so the plant is hard to damage and you can never push it. Permissive lets you reach 132% and 1.02 DNBR, which is real combat performance and a much smaller margin for error.",.05);
    wrap("Crew dose during an accident falls with distance from the reactor and drops sharply for every shield block between the two. Move this room and watch the dose figure below.",
      X[2],c[2]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="cont"){
    c[0]=optList(X[0],c[0],CW2,"CONTAINMENT",CONT,"cont",
      "What holds the radioactivity in when fuel fails. Sets how much of a release reaches your crew.");
    c[1]=toggleF(X[1],c[1],CW2,"CORE CATCHER","catcher",66,
      "A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained.");
    wrap("Containment does nothing for the reactor and everything for the people around it. It is pure insurance, and it is heavy.",
      X[2],c[2]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else if(id==="hpi"){
    c[0]=toggleF(X[0],c[0],CW2,"PASSIVE ACCUMULATOR","accum",45,
      "Gravity and gas driven emergency water needing no electricity. Refills a leaking loop far faster than the pumped system, and still works in a blackout.");
    wrap(D.accum?"Fitted. Injection runs at 2.6 %/s instead of 1.6, and it works with no power at all. Mount it high."
                :"Not fitted. Emergency injection is limited to the pumped system, which needs power.",
      X[1],c[1]+10,CW2*2+8,11,{size:8.5,color:D.accum?C.green:C.amber});
  }
  else if(id==="bkp"){
    c[0]=optList(X[0],c[0],CW2,"BACKUP POWER",BKP,"bkp",
      "What keeps the coolant pumps turning when main power is lost. Test it with the Station Blackout fault in the control room.");
    wrap("With no backup, a blackout leaves you nothing but natural circulation - which is set by how high you put the steam generators and how tall you made the core.",
      X[1],c[1]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
  }
  else {
    wrap(p.tip,X[0],c[0]+12,CW2*2+8,12,{size:9,color:C.ink});
    txt("NO ADJUSTABLE PARAMETERS",X[0],c[0]+72,{size:8,sp:1.6,color:C.ink2});
  }
  return y0+IH;
}

/* left column: the plant itself and the component inspector */
function designLeft(){
  rule("PLANT DESIGN",12,58,736,C.amber);
  txt("longitudinal section, looking to port / up is up: elevation drives gravity, buoyancy and passive cooling",
      12,73,{size:8.5,color:C.ink2});
  txt("click a component to configure it, drag to reposition",12,84,{size:8.5,color:C.ink2});
  button(596,47,152,20,"AUTO-ARRANGE",{size:8,fn:()=>{ LAY=null; layoutMetrics(); }});
  TIP(596,47,152,20,"AUTO-ARRANGE","Resets every component to its default position.");
  return inspector(drawGrid(94)+12)+12;
}

/* right column: what the design adds up to, and the button that builds it */
function designRight(y,d,LM){
  rule("MASS BUDGET",12,y,736);
  seg(12,y+12,736,14,clamp(d.mass/BUDGET,0,1),
      d.over?C.red:(d.mass/BUDGET>.9?C.amber:C.green),48);
  txt(d.mass.toFixed(0)+" / "+BUDGET+" t",748,y+50,{size:13,align:"right",color:d.over?C.red:C.cyan});
  txt("EQUIPMENT "+(d.mass-layMass).toFixed(0)+" t   PIPING + SHIELDING "+layMass.toFixed(0)+
      " t   /   CORE "+d.dens.toFixed(0)+" kW/L   EXCESS "+d.excess.toFixed(0)+" pcm",
      12,y+50,{size:8.5,color:C.ink2});
  TIP(12,y-8,736,62,"MASS BUDGET",
    "You have "+BUDGET+" tonnes. Vessel, core, fuel, loops, scram gear, sensors, safeguards, pipe runs and shielding all compete for the same allowance.");
  y+=64;

  const stats=planStats(d).concat(layoutStats(LM));
  well(12,y,736,Math.ceil(stats.length/2)*32+34,"RESULTING PLANT");
  stats.forEach((st,i)=>{
    const sx=22+(i%2)*362, sy=y+40+Math.floor(i/2)*32;
    txt(st[0],sx,sy,{size:8,sp:1.3,color:C.ink2});
    seg(sx,sy+5,204,9,st[2],st[3],20);
    txt(st[1],sx+354,sy+13,{size:10,align:"right",color:C.bright});
    TIP(sx-10,sy-10,362,28,st[0],st[4]);
  });
  y+=Math.ceil(stats.length/2)*32+46;

  const W_=designIssues(d,LM), hard=designBlocked(d,LM);
  if(W_.length){
    /* a review note is a sentence, not a label: wrap it and size the well to fit */
    const rx=78, rw=748-rx-12, ro={size:8.5};
    const hh=30+W_.reduce((a,w)=>a+wrapCount(w[1],rw,ro)*12+4,0);
    well(12,y,736,hh,"DESIGN REVIEW",hard?C.red:C.amber);
    let ry=y+34;
    for(const w of W_){
      const col=w[0]==="HARD"?C.red:C.amber;
      txt(w[0]==="HARD"?"[BLOCK]":"[WARN ]",22,ry,{size:8.5,color:col});
      ry=wrap(w[1],rx,ry,rw,12,{size:8.5,color:col})+4;
    }
    y+=hh+12;
  } else {
    well(12,y,736,44,"DESIGN REVIEW",C.green);
    txt("NO OBJECTIONS - THIS PLANT IS INTERNALLY CONSISTENT",22,y+34,{size:8.5,sp:1,color:C.green});
    y+=56;
  }
  if(hard){
    fillRect(12,y,736,34,"#1a0d0b"); frame(12,y,736,34,C.red);
    txt("RESOLVE BLOCKING ISSUES BEFORE COMMISSIONING",380,y+21,
        {size:10,sp:2,align:"center",color:C.red});
  } else {
    button(12,y,736,34,P?">> RE-COMMISSION UNIT <<":">> COMMISSION UNIT <<",{on:true,size:10,fn:commission});
    TIP(12,y,736,34,"COMMISSION UNIT",
      "Builds this reactor and takes you to the control room. Every parameter and every position above is baked into the physics.");
  }
  return y+50;
}

function drawDesign(){
  layoutMetrics();
  const d=derived(), lb=designLeft(), LM=layoutMetrics();
  if(screen==="design") setPageH(designRight(lb,d,LM)+16);
}
