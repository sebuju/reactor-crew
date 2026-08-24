"use strict";
/* paramsFor(): what a component lets you set, and the bench screen itself */

/* ══ WHAT A COMPONENT LETS YOU SET, AS BLOCKS ══
   The bench used to draw its parameters straight into four fixed 172px columns,
   which is why it could only ever be a 736-wide drawer: the layout was written
   into every call site. This is the same rule readoutsFor() follows on the
   control room - the panel is DATA, and something else decides where it goes.

   A block knows its own height BEFORE it is drawn, because the plate has to be
   laid out before anything goes in it: how many columns it needs is a question
   about how tall the stack is. Every block is built for PLCW, the one width a
   plate column has, so nothing is ever measured at one width and drawn at
   another - which is also why a note can be wrapped now and drawn later. */
const NOTE={size:8.5}, NOTE_LH=11;

function paramsFor(p){
  const d=derived(), B=[];
  const blk=(h,draw)=>B.push({h,draw});
  const note=(s,col)=>blk(wrapCount(s,PLCW,NOTE)*NOTE_LH+8,
    (x,y,w)=>wrap(s,x,y+9,w,NOTE_LH,{size:NOTE.size,color:col||C.ink2}));
  const id=p.id;

  /* A component nobody can reach cannot be repaired, and that blocks
     commissioning - so it is said on the component, not only in the review. */
  if(!p.access && p.grp!=="shield")
    note("NO ACCESS. This component is walled in on every side. No repair party could ever reach it, and the unit cannot be commissioned like this.",C.red);

  if(id==="core"){
    /* The lattice is the design now, so it leads the plate and the four sliders
       that used to sit here are gone: rated power, lattice pitch, core H/D and
       burnable poison are all MEASUREMENTS of it, printed at the foot.
       You still buy the coolant, the fuel and the reflector MATERIAL - the
       drawing decides how much of the last one there is. */
    blk(latPlanH(PLCW),(x,y,w)=>latPlan(x,y,w));
    blk(latToolsH(LATPEN_CORE),(x,y,w)=>latTools(x,y,w,LATPEN_CORE));
    blk(latDimRackH(),(x,y,w)=>latDimRack(x,y,w));
    blk(optListH(ARCH),(x,y,w)=>optList(x,y,w,"REACTOR TYPE",ARCH,"arch",
      "The coolant and moderator family. Sets power density, operating pressure, grace time and the sign of the void coefficient. It also decides how much heat a given lattice makes: the same assemblies rate differently in a different family."));
    blk(optListH(FUEL),(x,y,w)=>optList(x,y,w,"FUEL",FUEL,"fuel",
      "Sets beta - your reaction time before prompt criticality - plus excess reactivity and core density."));
    blk(LATROW_H,(x,y,w)=>latPreRow(x,y,w));
    blk(latReadH(LATREAD),(x,y,w)=>latReadRows(x,y,w));
  }
  else if(id==="rods"){
    /* the same plan, with the cluster pen in your hand - where a bank goes is
       decided looking down at the core, not on a list */
    blk(latPlanH(PLCW),(x,y,w)=>latPlan(x,y,w));
    blk(latToolsH(LATPEN_RODS),(x,y,w)=>latTools(x,y,w,LATPEN_RODS));
    blk(optListH(SCRAM),(x,y,w)=>optList(x,y,w,"SCRAM SYSTEM",SCRAM,"scram",
      "How the rods are driven in during an emergency shutdown."));
    blk(optListH(ABSORB),(x,y,w)=>optList(x,y,w,"ABSORBER",ABSORB,"__abs",
      "What the clusters are made of. This used to be solved for, until a fully-inserted bank came to whatever CONTROL BANK WORTH was set to. Now you buy a material, put the clusters where you want them, and the worth is what the solve measures."));
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"EMERG BORON INJECTION","boroninj",18,
      "A one-shot tank of concentrated poison worth 4000 pcm. Shuts the reactor down when the rods will not, and cannot be undone."));
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"AUTOMATIC ROD CONTROL","autorod",26,
      "A controller that holds coolant temperature on program so the plant follows load by itself. Limited to 15% of rod travel; you can always override it."));
    blk(optListH(FOLL),(x,y,w)=>optList(x,y,w,"ROD FOLLOWER",FOLL,"foll",
      "What occupies the channel below the absorber. It decides whether inserting the bank is monotonic: a graphite follower displaces water at the bottom of the core and adds reactivity there before any absorber arrives."));
    { const s = d.sdm<200 ? "Not enough. After a trip it creeps back to power."
                          : "Enough to hold this core down after a trip, cold.";
      blk(22+wrapCount(s,PLCW,NOTE)*NOTE_LH,(x,y,w)=>{
        seg(x,y,w,9,clamp(d.sdm/2000,0,1),d.sdm<200?C.red:C.green,18);
        wrap(s,x,y+22,w,NOTE_LH,{size:NOTE.size,color:C.ink2}); }); }
    blk(LATROW_H,(x,y,w)=>latBankRow(x,y,w));
    /* worth, bank count and margin are readouts now - every one of them a
       consequence of where the clusters went, and none of them dialled */
    blk(latReadH(LATREAD_RODS),(x,y,w)=>latReadRows(x,y,w,LATREAD_RODS));
  }
  else if(id==="pzr"){
    blk(SLDF_H,(x,y,w)=>sliderF(x,y,w,"DESIGN PRESSURE","pdes",.7,1.25,
      v=>(v*ARCH[D.arch].P0).toFixed(1)+" MPa",
      "Loop pressure as a multiple of this coolant's nominal. Higher raises the boiling point, so it buys thermal margin and resists voiding, but the vessel gets much heavier and a breach more violent.",.05,v=>(v-0.7)*220));
    blk(SLDF_H,(x,y,w)=>sliderF(x,y,w,"PRESSURIZER VOLUME","pzr",.5,2,v=>v.toFixed(2)+" x",
      "Size of the steam bubble. A big pressurizer damps pressure swings so the relief valve rarely lifts. A small one is light but pressure whips around on every load change.",.05,v=>(v-0.5)*45));
    note("Pressure is what keeps the rest of the loop liquid. Every design choice here trades vessel mass against how much boiling margin you carry.");
  }
  else if(id.startsWith("sg")){
    blk(SEGSEL_H,(x,y,w)=>segSel(x,y,w,"COOLANT LOOPS",["1","2","3","4"],"loops",
      "Parallel primary loops. More loops means losing one costs a smaller share of your flow, and each pipe is smaller so a break is less severe.",1));
    blk(optListH(SGT),(x,y,w)=>optList(x,y,w,"GENERATOR TYPE",SGT,"sg",
      "U-tube units hold a lot of secondary water that keeps removing heat for minutes after feedwater is lost. Once-through units are light, respond instantly, and boil dry just as fast."));
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"EMERGENCY FEEDWATER","efw",38,
      "An independent feed supply that keeps the generator removing heat after the main feed pumps are lost. Extends grace time considerably after a trip."));
    note("Height matters more than anything else on this component. Sitting above the reactor, it drives natural circulation with no pumps at all.");
    /* ══ GANGED: ONE PLATE FOR THE WHOLE SET ══
       Every loop is built the same, so all four steam generators return exactly
       these blocks and every one of them writes the same three design fields.
       Four loops used to mean four identical plates in the margins, any of which
       moved all four - the drawing said there were four decisions and there was
       one. benchPlates() keeps the first of a gang and drops the rest. */
    B.gang="sg";
  }
  else if(id.startsWith("pump")){
    blk(optListH(PUMPS),(x,y,w)=>optList(x,y,w,"PUMP REDUNDANCY",PUMPS,"pumps",
      "Spare coolant pumps. Sets the minimum flow the plant still delivers after damage, and flow is thermal margin."));
    note("Flow is the single biggest input to thermal margin. It is also the first thing you lose in a blackout, which is why the chimney height you gave the core matters so much.");
    B.gang="pump";   // same set, same field, same one plate
  }
  else if(id==="turb"){
    blk(SLDF_H,(x,y,w)=>sliderF(x,y,w,"TURBINE SIZE","turb",0,1,
      v=>(ARCH[D.arch].eff*(0.92+0.16*v)*100).toFixed(1)+" % gross",
      "How many stages the machine has. A big turbine turns more of the heat into electricity and can swallow a bigger overload, but it is heavy. The percentage is what this reactor's steam conditions plus this machine actually deliver together, so changing the reactor makes the same slider read differently.",.05,v=>v*50));
    blk(READF_H,(x,y,w)=>readF(x,y,w,"RATED OUTPUT",(D.power*d.eff).toFixed(0)+" MWe",
      "Electrical power at 100% reactor power with the condenser keeping up. This is the number the ship gets, and it is the whole reason the reactor is here."));
    blk(READF_H,(x,y,w)=>readF(x,y,w,"MAX LOAD",(d.loadMax*100).toFixed(0)+" %",
      "The furthest the load slider will go in the control room. Overpower is not free reach: it is turbine you paid mass for."));
    note("In the full game this is where weapons and ship systems draw from. A hit here rejects load instantly and the reactor has nowhere to put its heat.");
  }
  else if(id==="cond"){
    blk(SLDF_H,(x,y,w)=>sliderF(x,y,w,"CONDENSER SIZE","condCap",0,1,v=>(20+60*v).toFixed(0)+" % dump",
      "The heat sink, and it sets two things at once. It caps how much steam can be dumped straight past a tripped turbine, so a generous unit absorbs a scram without the relief valve ever lifting. It also sets how much steam you can condense at full draw: overload a small condenser and backpressure eats your electrical output while the reactor goes on making the heat.",.05,v=>v*40));
    blk(READF_H,(x,y,w)=>readF(x,y,w,"CONDENSING CAPACITY",(d.condCap*100).toFixed(0)+" % of rated",
      "How much steam this unit turns back into water. Draw more than this and exhaust pressure climbs, which costs the turbine work. Match it to the turbine's max load or accept the loss."));
    blk(READF_H,(x,y,w)=>readF(x,y,w,"TURBINE CAN DRAW",(d.loadMax*100).toFixed(0)+" %",
      "The turbine's own ceiling, shown here so the mismatch is visible from either component."));
    note(d.condShort
      ?"This condenser is far smaller than the turbine can overload to. Sustained overpower will hand a large part of itself straight back as backpressure."
      :"Condenser is matched to the turbine. A brief overload costs little or nothing.",
      d.condShort?C.amber:C.ink2);
  }
  else if(id==="ctrl"){
    blk(optListH(CHAN),(x,y,w)=>optList(x,y,w,"INSTRUMENT CHANNELS",CHAN,"chan",
      "How many independent sensors watch each parameter. This decides whether you can tell a broken gauge from a real emergency."));
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"REACTOR PROTECTION SYSTEM","rps",55,
      "The automatic trips. Fitted, it scrams the core on high flux, low DNBR, high or low pressure, high fuel temperature, low flow, core void or low subcooling. Leave it off and none of that happens: the reactor will run itself to destruction and wait for you to notice."));
    if(D.rps)
      blk(SLDF_H,(x,y,w)=>sliderF(x,y,w,"RPS TRIP MARGIN","rpsm",0,1,v=>(v*100).toFixed(0)+" % permissive",
        "How much overhead the automatic protection allows before it scrams. Conservative trips at 110% flux and 1.18 DNBR, so the plant is hard to damage and you can never push it. Permissive lets you reach 132% and 1.02 DNBR, which is real combat performance and a much smaller margin for error.",.05));
    note("Crew dose during an accident falls with distance from the reactor and drops sharply for every shield block between the two. Move this room and watch the dose figure in RESULTS.");
  }
  else if(id==="cont"){
    blk(optListH(CONT),(x,y,w)=>optList(x,y,w,"CONTAINMENT",CONT,"cont",
      "What holds the radioactivity in when fuel fails. Sets how much of a release reaches your crew."));
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"CORE CATCHER","catcher",66,
      "A cooled basin under the vessel. It will not save the fuel, but it stops a melted core burning through and breaching the vessel, which keeps the release contained."));
    note("Containment does nothing for the reactor and everything for the people around it. It is pure insurance, and it is heavy.");
  }
  else if(id==="hpi"){
    blk(TOGGLE_H,(x,y,w)=>toggleF(x,y,w,"PASSIVE ACCUMULATOR","accum",45,
      "Gravity and gas driven emergency water needing no electricity. Refills a leaking loop far faster than the pumped system, and still works in a blackout."));
    note(D.accum?"Fitted. Injection runs at 2.6 %/s instead of 1.6, and it works with no power at all. Mount it high."
                :"Not fitted. Emergency injection is limited to the pumped system, which needs power.",
      D.accum?C.green:C.amber);
  }
  else if(id==="bkp"){
    blk(optListH(BKP),(x,y,w)=>optList(x,y,w,"BACKUP POWER",BKP,"bkp",
      "What keeps the coolant pumps turning when main power is lost. Test it with the Station Blackout fault in the control room."));
    note("With no backup, a blackout leaves you nothing but natural circulation - which is set by how high you put the steam generators and how tall you made the core.");
  }
  else {
    note(p.tip);
    blk(14,(x,y,w)=>txt("NO ADJUSTABLE PARAMETERS",x,y+9,{size:8,sp:1.6,color:C.ink2}));
    /* ══ PLAIN: THIS PLATE SAYS NOTHING YOU HAVE TO READ ══
       Every bench plate is up at once now, so a component you cannot configure
       would stand a box in the margin whose whole content is that there is
       nothing in it - and seventeen of those are what makes a margin unreadable.
       benchPlates() drops a plain plate; the component is still selectable and
       still carries its tooltip on the plant.
       NOT plain when access is blocked, because that note is the one thing on
       such a plate that has to be read: it stops the unit commissioning. */
    B.plain = p.access || p.grp==="shield";
  }
  return B;
}

/* ══ THE BENCH IS ONE SCREEN TOO ══
   Same shape as the control room: a head, the plant filling everything left,
   and a bar along the bottom that opens the rest over it. */
function drawDesign(){
  layoutMetrics();
  const d=derived(), LM=layoutMetrics();
  rule("PLANT DESIGN",12,52,736,C.amber);
  txt("longitudinal section, looking to port / up is up / click a component to configure it, drag to move it",
      12,68,{size:8.5,color:C.ink2});
  button(596,42,152,18,"AUTO-ARRANGE",{size:8,fn:()=>{ LAY=null; layoutMetrics(); }});
  TIP(596,42,152,18,"AUTO-ARRANGE","Resets every component to its default position.");
  const bh=20, vy=76, vh=Math.max(120,H-vy-bh-4);
  drawPlant(vy,null,vh);
  /* No overlay is registered on this screen any more - the last two are plates
     in the margins - so the bar along the bottom carries no keys and is only
     the running total. It stays because that total is the one figure you want
     under your eye while you spend it, wherever the plant is panned to. */
  const hard=designBlocked(d,LM);
  ovlBar(H-bh,bh,
    "MASS "+d.mass.toFixed(0)+" / "+BUDGET+" t"+
    (hard?"   -   BLOCKED: SEE THE DESIGN REVIEW PLATE":d.over?"   -   OVER BUDGET":""));
}

/* ══ WHAT THE WHOLE DESIGN ADDS UP TO ══
   Two panels belong to no machine on the plant: what it IS, and what is wrong
   with it. They were overlays, and an overlay hides the plant you opened it to
   read about - which is the same objection that moved every per-component panel
   out into the margins in the first place. They are PLATES now, in the same box
   on the same head, placed by benchFree() in plant.js: RESULTS below the plant
   and every plate on it, REVIEW to the right of both. Neither carries a leader,
   because neither of them points at anything.
   These two functions say what stands inside; where they stand is not their
   question, exactly as it is not paramsFor()'s. Both are handed a content x, y
   and w and draw from that corner, so neither knows the page it is on. */

/* THREE columns, not two. Seventeen figures two abreast is 322 units tall and
   three abreast is 226, and it reads no worse, because each row is a label, a
   bar and a number and none of them wanted 362 units to say it in. */
const RES_NC=3, RES_HEAD=90;
/* PLANT_LM, not a fresh layoutMetrics() call: this runs from inside drawPlant()
   (through benchFree(), called out of benchPlates()), after BANDS has already
   been set from THAT layoutMetrics() call - and layoutMetrics() clears BANDS as
   the first thing it does, so calling it again here would clobber it back to
   null with nothing left downstream in the frame to set it again. */
const resStats=()=>planStats(derived()).concat(layoutStats(PLANT_LM));
const benchResultsH=()=>RES_HEAD-12+Math.ceil(resStats().length/RES_NC)*32;
function benchResults(x,y,w){
  const d=derived();
  rule("MASS BUDGET",x,y+9,w);
  seg(x,y+14,w,14,clamp(d.mass/BUDGET,0,1),
      d.over?C.red:(d.mass/BUDGET>.9?C.amber:C.green),48);
  txt(d.mass.toFixed(0)+" / "+BUDGET+" t",x+w,y+52,
      {size:13,align:"right",color:d.over?C.red:C.cyan});
  txt("EQUIPMENT "+(d.mass-layMass).toFixed(0)+" t   PIPING + SHIELDING "+layMass.toFixed(0)+
      " t   /   CORE "+d.dens.toFixed(0)+" kW/L   EXCESS "+d.excess.toFixed(0)+" pcm",
      x,y+52,{size:8.5,color:C.ink2});
  TIP(x,y,w,58,"MASS BUDGET",
    "You have "+BUDGET+" tonnes. Vessel, core, fuel, loops, scram gear, sensors, safeguards, pipe runs and shielding all compete for the same allowance.");
  rule("RESULTING PLANT",x,y+76,w);
  const stats=resStats(), cw=w/RES_NC;
  stats.forEach((st,i)=>{
    const sx=x+(i%RES_NC)*cw, sy=y+RES_HEAD+Math.floor(i/RES_NC)*32;
    txt(st[0],sx,sy,{size:8,sp:1.3,color:C.ink2});
    seg(sx,sy+5,130,9,st[2],st[3],20);
    txt(st[1],sx+cw-14,sy+13,{size:10,align:"right",color:C.bright});
    TIP(sx-6,sy-10,cw,28,st[0],st[4]);
  });
}

/* How much room the note block is given. RESERVED and not fitted, because the
   COMMISSION key stands at the foot of it: a block exactly as tall as it has
   something to say moves that key under the pointer every time a note appears
   or goes away. A floor and not a clamp - a design that finds more notes than
   the reserve still gets the room to print them.
   Swept over every architecture x fuel x loop count x RPS x containment x
   lattice preset - 2160 designs, worst case seven notes at 200 px at THIS
   plate's wrap width - and rounded up, because the sweep is the measurement.
   It was 150 while this was a 736-wide overlay; the plate is 382, so the same
   seven notes wrap half again as far. Re-measure it if a new warning is added
   or if the plate changes width. */
const REVIEW_H=210;
const REV_TAG=50, REV_LH=12, REV_O={size:8.5};
const revNoteH=w=>Math.max(REVIEW_H, designIssues(null,PLANT_LM)
  .reduce((a,q)=>a+wrapCount(q[1],w-REV_TAG,REV_O)*REV_LH+4,0));
const benchReviewH=w=>18+revNoteH(w)+12+34;
function benchReview(x,y,w){
  const d=derived(), LM=PLANT_LM;
  const W_=designIssues(d,LM), hard=designBlocked(d,LM);
  /* a review note is a sentence, not a label: it wraps, and the tag beside it
     keeps its own column so the sentences all start on one line */
  rule("DESIGN REVIEW",x,y+9,w,W_.length?(hard?C.red:C.amber):C.green);
  if(W_.length){
    let ry=y+30;
    for(const q of W_){
      const col=q[0]==="HARD"?C.red:C.amber;
      txt(q[0]==="HARD"?"[BLOCK]":"[WARN ]",x,ry,{size:8.5,color:col});
      ry=wrap(q[1],x+REV_TAG,ry,w-REV_TAG,REV_LH,{size:8.5,color:col})+4;
    }
  } else txt("NO OBJECTIONS - THIS PLANT IS INTERNALLY CONSISTENT",x,y+30,
      {size:8.5,sp:1,color:C.green});
  const by=y+18+revNoteH(w)+12;
  if(hard){
    fillRect(x,by,w,34,"#1a0d0b"); frame(x,by,w,34,C.red);
    txt("RESOLVE BLOCKING ISSUES BEFORE COMMISSIONING",x+w/2,by+21,
        {size:10,sp:2,align:"center",color:C.red});
  } else {
    button(x,by,w,34,P?">> RE-COMMISSION UNIT <<":">> COMMISSION UNIT <<",
      {on:true,size:10,fn:commission});
    TIP(x,by,w,34,"COMMISSION UNIT",
      "Builds this reactor and takes you to the control room. Every parameter and every position above is baked into the physics.");
  }
}
