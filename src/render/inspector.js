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
    c[0]=optList(X[0],c[0],CW2,"REACTOR TYPE",ARCH,"arch",
      "The coolant and moderator family. Sets power density, operating pressure, grace time and the sign of the void coefficient.");
    c[1]=optList(X[1],c[1],CW2,"FUEL",FUEL,"fuel",
      "Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density.");
    c[2]=optList(X[2],c[2],CW2,"REFLECTOR",REFL,"refl",
      "Bounces escaping neutrons back into the core, so you need less excess reactivity. Beryllium and graphite nudge the void coefficient positive.")+8;
    c[2]=sliderF(X[2],c[2],CW2,"RATED POWER","power",400,2400,v=>pad(v,4)+" MWt",
      "How much heat the core makes. More power needs a bigger core, and shortens grace time because there is more decay heat to remove.",50,
      v=>{const o=D.power;D.power=v;const m=derived().mass;D.power=o;return m;});
    c[3]=sliderF(X[3],c[3],CW2,"LATTICE PITCH","pitch",.6,1.8,v=>v.toFixed(2)+" x",
      "Fuel pin spacing. TIGHT under-moderates: the moderator coefficient gets much stronger and safer, but less water gap means less thermal margin. OPEN over-moderates: better DNBR, weaker feedback, and past about 1.5 the void coefficient goes POSITIVE.",.05)+8;
    c[3]=sliderF(X[3],c[3],CW2,"CORE HEIGHT / DIA","hd",.5,2.5,v=>v.toFixed(2)+" H/D",
      "Core shape. Squat leaks fewest neutrons. Tall leaks more but drives far better natural circulation, and peaks harder axially.",.05)+8;
    c[3]=sliderF(X[3],c[3],CW2,"BURNABLE POISON","poison",0,1500,v=>v.toFixed(0)+" pcm",
      "Gadolinium in the fuel that burns away with age. Soaks up excess reactivity and flattens power across the core.",50);
  }
  else if(id==="rods"){
    c[0]=optList(X[0],c[0],CW2,"SCRAM SYSTEM",SCRAM,"scram","How the rods are driven in during an emergency shutdown.");
    c[1]=sliderF(X[1],c[1],CW2,"CONTROL BANK WORTH","rodw",1200,4000,v=>v.toFixed(0)+" pcm",
      "Total negative reactivity the rods can insert. This is your shutdown margin: too little and a scram will not hold the core down once it cools and the xenon decays. More worth also means more power peaking when inserted.",50,v=>(v-1200)/100*4);
    c[2]=toggleF(X[2],c[2],CW2,"EMERG BORON INJECTION","boroninj",18,
      "A one-shot tank of concentrated poison worth 4000 pcm. Shuts the reactor down when the rods will not, and cannot be undone.")+8;
    c[2]=toggleF(X[2],c[2],CW2,"AUTOMATIC ROD CONTROL","autorod",26,
      "A controller that holds coolant temperature on program so the plant follows load by itself. Limited to 15% of rod travel; you can always override it.");
    txt("SHUTDOWN MARGIN "+d.sdm.toFixed(0)+" pcm",X[3],c[3]+10,
      {size:8,sp:1.2,color:d.sdm<200?C.red:C.green});
    seg(X[3],c[3]+16,CW2,9,clamp(d.sdm/2000,0,1),d.sdm<200?C.red:C.green,18);
    wrap(d.sdm<200?"Not enough. After a trip this core creeps back to power on its own."
                  :"Enough to hold the core down after a trip, cold and xenon-free.",
      X[3],c[3]+40,CW2,11,{size:8.5,color:C.ink2});
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
    c[0]=sliderF(X[0],c[0],CW2,"TURBINE BYPASS","bypassCap",0,1,v=>(20+60*v).toFixed(0)+" % dump",
      "How much steam can be dumped straight to the condenser when the turbine trips. Generous bypass absorbs the heat surge after a scram so pressure never reaches the relief valve. Skimp on it and every trip lifts the PORV, which is how stuck-open-valve accidents start.",.05,v=>v*40);
    wrap("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat.",
      X[1],c[1]+10,CW2*2+8,11,{size:8.5,color:C.ink2});
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
